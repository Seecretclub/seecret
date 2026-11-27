'use strict';

require('dotenv').config();

// Sentry : alerte et détail de chaque erreur serveur (activé seulement si
// SENTRY_DSN est défini). Aucune donnée personnelle envoyée : pas de cookies,
// pas d'en-têtes d'authentification, pas de corps de requête.
const Sentry = process.env.SENTRY_DSN ? require('@sentry/node') : null;
if (Sentry) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) { delete event.request.headers.cookie; delete event.request.headers.authorization; }
      }
      if (event.user) event.user = { id: event.user.id };
      return event;
    }
  });
}

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const sw = require('@simplewebauthn/server');

const app = express();
// Railway (et tout reverse proxy) : récupérer la vraie IP et le bon protocole.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
// DATA_DIR pointe vers un volume persistant en production (Railway, etc.) :
// sans ça, data.json et uploads/ vivent sur le disque éphémère du conteneur
// et sont perdus à chaque redéploiement. En local, DATA_DIR vaut __dirname
// comme avant (rien ne change pour le développement).
// Noms de clés acceptés tels que saisis dans Railway (ex. DATAGMA_API au lieu de DATAGMA_API_KEY).
[['DATAGMA_API_KEY', ['DATAGMA_API', 'DATAGMA_KEY', 'DATAGMA']],
  ['DROPCONTACT_API_KEY', ['DROP_CONTACT_API', 'DROPCONTACT_API', 'DROP_CONTACT_API_KEY', 'DROPCONTACT_KEY', 'DROPCONTACT']],
  ['FULLENRICH_API_KEY', ['FULL_ENRICH', 'FULLENRICH', 'FULL_ENRICH_API_KEY', 'FULLENRICH_API', 'FULL_ENRICH_API']],
  ['SOCIETEINFO_API_KEY', ['SOCIETE_INFO', 'SOCIETEINFO', 'SOCIETE_INFO_API_KEY', 'SOCIETEINFO_API', 'SOCIETE_INFO_API']],
  ['KASPR_API_KEY', ['KASPR', 'KASPR_API', 'KASPR_KEY']]
].forEach(([nom, autres]) => {
  if (process.env[nom]) return;
  const trouve = autres.find((x) => String(process.env[x] || '').trim());
  if (trouve) process.env[nom] = String(process.env[trouve]).trim();
});
const DATA_DIR = process.env.DATA_DIR || __dirname;

// Annuaire des entreprises (recherche-entreprises.api.gouv.fr) : environ 7 appels
// par seconde au maximum. Au-delà il répond 429 (ou une page d'erreur) et on
// croyait à tort qu'une société n'avait pas de gérant. On espace les appels
// (4 par seconde) et on réessaie après une limite.
// Deux files : ce que l'agent ouvre passe avant l'enrichissement en arrière-plan.
const { AsyncLocalStorage } = require('async_hooks');
const ARRIERE_PLAN = new AsyncLocalStorage();
const SIRENE_FILES = { haute: [], basse: [] };
let SIRENE_DERNIER = 0;
let SIRENE_ALERTE = 0;
let SIRENE_POMPE = null;
function sirenePomper() {
  if (SIRENE_POMPE) return;
  const suivant = () => {
    SIRENE_POMPE = null;
    const t = SIRENE_FILES.haute.shift() || SIRENE_FILES.basse.shift();
    if (!t) return;
    const attente = Math.max(0, SIRENE_DERNIER + 260 - Date.now());
    SIRENE_POMPE = setTimeout(() => { SIRENE_DERNIER = Date.now(); t(); SIRENE_POMPE = null; sirenePomper(); }, attente);
  };
  suivant();
}
function sireneCreneau(fond) { return new Promise((r) => { SIRENE_FILES[fond ? 'basse' : 'haute'].push(r); sirenePomper(); }); }
async function sireneFetch(url, opts) {
  const fond = !!(ARRIERE_PLAN.getStore() || {}).fond;
  for (let essai = 0; essai < 4; essai++) {
    await sireneCreneau(fond);
    // Délai compté à partir de l'envoi réel (pas pendant l'attente dans la file).
    const o = Object.assign({ headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0 (contact@seecret.fr)' } }, opts || {}, { signal: AbortSignal.timeout(15000) });
    const r = await fetch(url, o);
    if (r.status !== 429 && r.status < 500) return r;
    if (Date.now() - SIRENE_ALERTE > 60000) { SIRENE_ALERTE = Date.now(); console.warn('[sirene] réponse ' + r.status + ', nouvel essai'); }
    const ra = parseInt(r.headers.get('retry-after') || '', 10);
    await new Promise((res) => setTimeout(res, (ra > 0 ? ra * 1000 : 1500 * (essai + 1))));
  }
  await sireneCreneau(fond);
  return fetch(url, Object.assign({}, opts || {}, { signal: AbortSignal.timeout(15000) }));
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ---- Place sur le volume ----
// Le volume Railway gratuit fait 500 Mo. Quand il est plein, SQLite ne peut
// plus ouvrir la base des membres : on vérifie la place AVANT de l'ouvrir.
function placeLibreMo(dossier) {
  try { const st = fs.statfsSync(dossier || DATA_DIR); return Math.round(st.bavail * st.bsize / 1048576); } catch (e) { return null; }
}
function tailleMo(chemin) {
  let total = 0;
  try {
    const st = fs.lstatSync(chemin);
    if (st.isDirectory()) fs.readdirSync(chemin).forEach((n) => { total += tailleMo(path.join(chemin, n)) * 1048576; });
    else total = st.size;
  } catch (e) { /* ignoré */ }
  return Math.round(total / 1048576 * 10) / 10;
}
function etatDisque() {
  const parts = {};
  try { fs.readdirSync(DATA_DIR).forEach((n) => { parts[n] = tailleMo(path.join(DATA_DIR, n)); }); } catch (e) { /* ignoré */ }
  return { libreMo: placeLibreMo(), parts: parts };
}
(function libererPlaceSiPlein() {
  const avant = etatDisque();
  console.log('[disque] place libre : ' + avant.libreMo + ' Mo · ' + Object.keys(avant.parts).sort((a, b) => avant.parts[b] - avant.parts[a]).map((n) => n + ' ' + avant.parts[n] + ' Mo').join(', '));
  if (avant.libreMo === null || avant.libreMo >= 50) return;
  console.warn('[disque] presque plein : on libère la place des données qui se rechargent seules.');
  // 1. Import inachevé du fichier des propriétaires (dossier temporaire).
  try { fs.rmSync(path.join(DATA_DIR, 'pm-locaux.tmp'), { recursive: true, force: true }); } catch (e) { /* ignoré */ }
  // 2. Radar : on garde les fiches travaillées (suivi, notes, prospect), on vide les DPE téléchargés.
  const fichier = path.join(DATA_DIR, 'radar.db');
  if (fs.existsSync(fichier)) {
    let gardees = [];
    try {
      const Database = require('better-sqlite3');
      const sql = new Database(fichier, { readonly: true });
      gardees = sql.prepare('SELECT id, quartier, date, type, surface, ban, data FROM fiches').all().filter((r) => {
        try { const f = JSON.parse(r.data); return (f.statut && f.statut !== 'a_revoir') || f.leadId || (f.historique || []).length || f.rappel; } catch (e) { return false; }
      });
      sql.close();
    } catch (e) { console.error('[disque] lecture radar.db :', e.message); }
    ['', '-wal', '-shm'].forEach((x) => { try { fs.unlinkSync(fichier + x); } catch (e) { /* ignoré */ } });
    if (gardees.length) {
      try {
        const Database = require('better-sqlite3');
        const sql = new Database(fichier);
        sql.exec('CREATE TABLE IF NOT EXISTS fiches (id TEXT PRIMARY KEY, quartier TEXT, date TEXT, type TEXT, surface REAL, ban TEXT, data TEXT)');
        const ins = sql.prepare('INSERT OR REPLACE INTO fiches VALUES (@id, @quartier, @date, @type, @surface, @ban, @data)');
        sql.transaction((l) => l.forEach((r) => ins.run(r)))(gardees);
        sql.close();
      } catch (e) { console.error('[disque] réécriture radar.db :', e.message); }
    }
    console.warn('[disque] Radar vidé, ' + gardees.length + ' fiche(s) suivie(s) gardée(s).');
  }
  console.log('[disque] place libre après : ' + placeLibreMo() + ' Mo');
})();
// Base de données : SQLite (seecret.db sur le volume), voir stockage.js.
// Au premier démarrage, data.json est importé puis renommé data.json.importe.
// Filet de sécurité : si SQLite ne peut pas démarrer (module natif absent,
// disque en lecture seule…), le site continue sur data.json comme avant au
// lieu de tomber, et l'erreur est journalisée.
let stockage = null;
try {
  const { Stockage } = require('./stockage');
  stockage = new Stockage(DATA_DIR);
} catch (e) {
  console.error('[base] SQLite indisponible, repli sur data.json :', e.message);
  stockage = null;
}
if (stockage && stockage.estVide() && fs.existsSync(DATA_FILE)) {
  try {
    const ancien = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const n = stockage.importer(ancien);
    fs.renameSync(DATA_FILE, DATA_FILE + '.importe');
    console.log('[base] data.json importé dans SQLite (' + n + ' enregistrements) ; fichier renommé data.json.importe');
  } catch (e) {
    console.error('[base] import de data.json impossible :', e.message);
    throw e;
  }
}
// data-comparables.json est une donnée de référence livrée avec le code
// (pas générée par les utilisateurs), elle reste dans le dépôt / __dirname.
const COMPARABLES_FILE = path.join(__dirname, 'data-comparables.json');

app.use(cors());
// Relevé à 8 Mo (au lieu de 1 Mo) pour laisser passer l'audio dicté à Célia
// (quelques dizaines de secondes de voix encodées en base64).
// Adresse officielle du site. L'ancienne adresse Railway redirige vers elle
// (pages seulement : les appels /api continuent de fonctionner partout).
const SITE_OFFICIEL = (process.env.PUBLIC_URL || 'https://www.seecret.fr').replace(/\/+$/, '');
function hoteTechnique(h) { return /\.up\.railway\.app$/i.test(String(h || '')); }
app.use((req, res, next) => {
  // Active par défaut ; REDIRECTION_DOMAINE=0 dans Railway la coupe sans redéployer de code.
  if (process.env.REDIRECTION_DOMAINE !== '0' && (req.method === 'GET' || req.method === 'HEAD') && hoteTechnique(req.hostname) && !req.path.startsWith('/api/') && req.path !== '/sante' && req.path !== '/health') {
    return res.redirect(301, SITE_OFFICIEL + req.originalUrl);
  }
  next();
});
app.use(express.json({ limit: '20mb' }));
// Si le corps de la requête est invalide ou trop gros (ex. un audio dicté
// trop long envoyé à Célia), express renvoie par défaut une page d'erreur
// texte/HTML — qui casse le `.json()` côté client et finit en message
// générique illisible ("Erreur de transcription" sans aucun détail). On
// répond ici en JSON avec un message clair à la place.
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Enregistrement trop volumineux (plus de 20 Mo) — parlez plus brièvement et réessayez.' });
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'Requête invalide.' });
  next(err);
});

const uid = (p) => (p || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowISO = () => new Date().toISOString();
const LIBELLE = { acheteur: 'Acquéreur', vendeur: 'Vendeur', mixte: 'Acquéreur et Vendeur' };

// Agent par défaut auquel sont attribuées toutes les nouvelles demandes (biens/leads)
// tant qu'aucun agent ne les a reprises manuellement dans le CRM. Modifiable sans
// redéploiement de code via la variable d'environnement DEFAULT_AGENT_NOM.
const DEFAULT_AGENT_NOM = process.env.DEFAULT_AGENT_NOM || 'Gabriel Taieb';

function readDb() {
  let db;
  if (stockage) db = stockage.lire();
  else { try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { db = {}; } }
  db.leads = Array.isArray(db.leads) ? db.leads : [];
  db.recherches = Array.isArray(db.recherches) ? db.recherches : [];
  db.biens = Array.isArray(db.biens) ? db.biens : [];
  db.demandes = Array.isArray(db.demandes) ? db.demandes : [];
  db.magicLinks = Array.isArray(db.magicLinks) ? db.magicLinks : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.tasks = Array.isArray(db.tasks) ? db.tasks : [];
  db.offres = Array.isArray(db.offres) ? db.offres : [];
  db.offMarket = (db.offMarket && !Array.isArray(db.offMarket) && typeof db.offMarket === 'object') ? db.offMarket : {};
  db.activites = Array.isArray(db.activites) ? db.activites : [];
  db.rappels = Array.isArray(db.rappels) ? db.rappels : [];
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  // Migration : relie chaque bien/recherche à son lead (leadId) via l'email si manquant.
  db.biens.forEach((b) => {
    if (!b.leadId && b.email) {
      const lead = db.leads.find((l) => (l.email || '').toLowerCase() === (b.email || '').toLowerCase());
      if (lead) b.leadId = lead.id;
    }
  });
  // Une candidature renvoyée avec un email déjà connu gardait l'identifiant
  // provisoire de son lead (jamais créé) : on la rattache au vrai lead (clientId).
  (db.demandes || []).forEach((d) => {
    if (d.leadId && d.clientId && d.leadId !== d.clientId && !db.leads.some((l) => l.id === d.leadId) && db.leads.some((l) => l.id === d.clientId)) d.leadId = d.clientId;
  });
  db.recherches.forEach((r) => {
    if (!r.leadId) r.leadId = r.clientId || null;
    if (r.leadId && !db.leads.some((l) => l.id === r.leadId)) {
      const lead = db.leads.find((l) => l.id === r.clientId);
      if (lead) r.leadId = lead.id;
    }
  });
  return db;
}

// Écriture : transaction SQLite qui n'enregistre que les enregistrements
// modifiés (voir stockage.js). Une sauvegarde complète et cohérente de la
// base est faite une fois par jour dans backups/ (14 jours conservés).
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
let derniereSauvegarde = '';
function sauvegardeQuotidienne() {
  const jour = new Date().toISOString().slice(0, 10);
  if (derniereSauvegarde === jour) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const cible = path.join(BACKUP_DIR, 'seecret-' + jour + '.db');
    derniereSauvegarde = jour;
    if (!fs.existsSync(cible)) {
      if (stockage) stockage.sauvegarder(cible).catch((e) => console.error('[sauvegarde] échec :', e.message));
      else if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, cible.replace(/\.db$/, '.json'));
    }
    fs.readdirSync(BACKUP_DIR).filter((f) => /^(data|seecret)-\d{4}-\d{2}-\d{2}\.(json|db)$/.test(f)).sort().reverse().slice(14)
      .forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) {} });
  } catch (e) { console.error('[sauvegarde] échec :', e.message); }
}
function writeDb(db) {
  if (stockage) stockage.ecrire(db);
  else {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }
  sauvegardeQuotidienne();
}

// Journal d'activité unifié : une seule source de vérité pour tout ce qui arrive
// à un lead/bien (candidature, admission, mise au catalogue, offres, relances
// Réseau…), consommée par le CRM (fiche contact → bloc "Activité"). N'écrit
// jamais dans data.json elle-même : appelant responsable de writeDb(db) après.
function logActivite(db, { leadId, bienId, rechercheId, type, auteur, detail }) {
  db.activites = Array.isArray(db.activites) ? db.activites : [];
  const a = { id: uid('act'), leadId: leadId || null, bienId: bienId || null, type: type, auteur: auteur || 'Système', at: nowISO() };
  if (rechercheId) a.rechercheId = rechercheId;
  if (Array.isArray(detail) && detail.length) a.detail = detail.slice(0, 40);
  db.activites.push(a);
}

// Historique des fiches : libellés lisibles des champs suivis, par type de fiche.
const CHAMPS_JOURNAL = {
  lead: { prenom: 'Prénom', nom: 'Nom', email: 'Email', tel: 'Téléphone', adresse: 'Adresse', ville: 'Ville', civilite: 'Civilité', natureLead: 'Le lead est', raisonSociale: 'Raison sociale', siren: 'SIREN', representant: 'Représentant', projet: 'Projet', source: 'Source', notes: 'Notes', statut: 'Statut', financement: 'Financement', apport: 'Apport', budgetMin: 'Budget min', budgetMax: 'Budget max', pipeline: 'Étape de relance', agentId: 'Agent attribué' },
  bien: { titre: 'Titre', ref: 'Référence', adresse: 'Adresse', type: 'Type', quartier: 'Quartier', statut: 'Statut', surface: 'Surface', pieces: 'Pièces', chambres: 'Chambres', sdb: 'Salles de bain', etage: 'Étage', dpe: 'DPE', ges: 'GES', etat: 'État', exterieur: 'Extérieur', surfaceExterieur: 'Surface extérieure', charges: 'Charges', ascenseur: 'Ascenseur', anneeConstruction: 'Année de construction', prix: 'Prix net vendeur', tauxHonoraires: 'Honoraires', description: 'Description', surSeecret: 'Sur Seecret', notesLibres: 'Infos libres', etapeProposition: 'Étape proposition' },
  recherche: { titre: 'Intitulé', types: 'Types', quartiers: 'Secteurs', prixMin: 'Budget min', prixMax: 'Budget max', piecesMin: 'Pièces min', chambresMin: 'Chambres min', sdbMin: 'Salles de bain min', surfaceMin: 'Surface min', surfaceMax: 'Surface max', etageMin: 'Étage min', etageMax: 'Étage max', dernierEtageOk: 'Dernier étage', dpe: 'DPE', epoque: 'Époque', etat: 'État', annexes: 'Indispensables', delai: 'Délai', financement: 'Financement', apport: 'Apport', statut: 'Statut' }
};
const valeurJournal = (v) => {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  const t = String(v);
  return t.length > 140 ? t.slice(0, 140) + '…' : t;
};
function champsModifies(kind, avant, apres) {
  const libelles = CHAMPS_JOURNAL[kind] || {};
  return Object.keys(libelles).filter((k) => valeurJournal(avant[k]) !== valeurJournal(apres[k]))
    .map((k) => ({ champ: k, libelle: libelles[k], avant: valeurJournal(avant[k]), apres: valeurJournal(apres[k]) }));
}
const copieJournal = (o) => JSON.parse(JSON.stringify(o || {}));

// Notification client unifiée : chaque action de validation/refus côté CRM
// (pièce d'identité, adhésion, bien, offre, demande de modification, visite…)
// déclenche TOUJOURS la même chose, de la même façon : un email réel, un
// message déposé dans l'espace membre (vu à la reconnexion via
// GET /api/mes-notifications), et un lien wa.me pré-rempli renvoyé au CRM
// pour qu'un agent l'envoie d'un clic — jamais d'envoi WhatsApp automatique,
// même convention que le reste du produit (voir prevenirMessage/wa.me côté
// crm.js). N'écrit pas elle-même via writeDb : l'appelant reste responsable,
// comme pour logActivite.
function notifierClient(db, { leadId, email, tel, prenom, titre, message, lien }) {
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  const dest = String(email || '').trim();
  const notif = { id: uid('ntf'), leadId: leadId || null, email: dest, titre: titre, message: message, lien: lien || null, lue: false, cree: nowISO() };
  db.notifications.push(notif);
  if (mailer && dest) {
    mailer.sendMail({
      from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: dest, subject: titre,
      html: emailValidationLegere(prenom || '', String(message || '').replace(/\n/g, '<br>'))
    }).catch((err) => console.error('[notif] email échoué :', err.message));
  }
  return { tel: tel || '', prenom: prenom || '', message: message, lien: lien || '', waMessage: 'Bonjour ' + (prenom || '') + ', ' + message + (lien ? ' ' + lien : '') };
}

function titreRecherche(r) {
  const type = (Array.isArray(r.types) && r.types[0]) || '';
  const pieces = r.piecesMin ? r.piecesMin + ' pièces et +' : '';
  const base = (type + ' ' + pieces).trim();
  return base || 'Recherche';
}

function resumeDemande(dossier) {
  const parts = ['Profil : ' + (LIBELLE[dossier.projet] || dossier.projet || '—')];
  if (dossier.projet !== 'vendeur') {
    const r = dossier.recherche || {};
    const bits = [(Array.isArray(r.types) ? r.types.join(', ') : '') || 'Tous types', r.piecesMin ? r.piecesMin + ' pièces et +' : '', r.surfaceMin ? r.surfaceMin + ' m² et +' : '', r.prixMax ? 'max ' + Number(r.prixMax).toLocaleString('fr-FR') + ' €' : '', r.delai ? 'délai : ' + r.delai : ''].filter(Boolean);
    parts.push('Recherche : ' + (bits.join(', ') || 'non renseigné'));
  }
  if (dossier.projet !== 'acheteur') {
    const b = dossier.bien || {};
    const adresse = String(b.adresse || '');
    const lieu = b.codePostal && adresse.indexOf(b.codePostal) === -1
      ? b.codePostal + ' ' + (b.ville || '')
      : (b.codePostal ? '' : b.quartier);
    const bits = [b.adresse, b.type, lieu, b.surface ? b.surface + ' m²' : '', b.pieces ? b.pieces + ' pièces' : '', b.dpe ? 'DPE ' + b.dpe : '', b.exterieur && b.exterieur !== 'Aucun' ? b.exterieur + (b.surfaceExterieur ? ' ' + b.surfaceExterieur + ' m²' : '') : '', b.etat].filter(Boolean);
    parts.push('Bien : ' + (bits.join(', ') || 'non renseigné'));
  }
  return parts.join(' — ');
}

const TYPES_BIEN_CRM = ['Appartement', 'Maison', 'Duplex', 'Triplex', 'Loft', 'Hôtel particulier', 'Villa', 'Maison de ville', 'Maison de village', 'Propriété', 'Château', 'Immeuble', 'Péniche', 'Terrain', 'Terrain constructible', 'Parking', 'Box', 'Bureau', 'Local commercial', 'Commerce'];
// Complète une fiche existante avec une fiche fraîche, sans écraser ce que
// l'agence a déjà saisi : seuls les champs vides (0, '', [], null) sont remplis.
function completerFiche(cible, source, exclus) {
  const vide = (x) => x === undefined || x === null || x === '' || x === 0 || (Array.isArray(x) && !x.length);
  Object.keys(source || {}).forEach((k) => {
    if ((exclus || []).indexOf(k) > -1) return;
    if (vide(cible[k]) && !vide(source[k])) cible[k] = source[k];
  });
  return cible;
}

function decoupe(dossier) {
  const v = dossier.vous || {};
  const r = dossier.recherche || {};
  const b = dossier.bien || {};
  const vente = dossier.vente || {};
  const budget = dossier.budget || {};
  const projet = dossier.projet || 'acheteur';
  const nom = ((v.prenom || '') + ' ' + (v.nom || '')).trim();
  const email = v.email || '';

  const n = (x) => { const k = parseInt(String(x == null ? '' : x).replace(/[^\d-]/g, ''), 10); return isNaN(k) ? 0 : k; };
  const liste = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === 'string' && y).slice(0, 30) : []);
  const classe = (x) => (/^[A-G]$/.test(String(x || '')) ? String(x) : '');
  const nature = ['sci', 'societe'].indexOf(v.nature) > -1 ? v.nature : 'personne';
  const types = liste(r.types);
  const quartiers = liste(r.quartiers);

  // Le lead reprend exactement les champs de la fiche « lead » du CRM.
  const lead = { id: uid('l'), natureLead: nature, raisonSociale: nature !== 'personne' ? String(v.raisonSociale || '').trim() : '', siren: nature !== 'personne' ? String(v.siren || '').replace(/\D/g, '').slice(0, 9) : '', representant: nature !== 'personne' ? String(v.representant || '').trim() : '', civilite: ['homme', 'femme'].indexOf(v.civilite) > -1 ? v.civilite : '', prenom: v.prenom || '', nom: v.nom || '', email: email, tel: v.tel || '', adresse: String(v.adresse || '').trim(), ville: v.ville || '', projet: projet, role: 'membre', budgetMin: n(r.prixMin), budgetMax: n(r.prixMax), quartiers: quartiers, piecesMin: n(r.piecesMin), surfaceMin: n(r.surfaceMin), surfaceMax: n(r.surfaceMax), delai: r.delai || '', typeBien: types[0] || '', apport: n(budget.apport), financement: budget.financement || '', courtier: !!budget.courtier, bienAVendre: !!budget.bienAVendre, statut: 'en_attente', source: 'Candidature', cree: nowISO() };

  // La recherche reprend les critères de la fiche « recherche » du CRM.
  const recherche = projet !== 'vendeur' ? { id: uid('r'), clientId: lead.id, leadId: lead.id, titre: titreRecherche(Object.assign({}, r, { types: types, quartiers: quartiers })), types: types, type: types[0] || '', quartiers: quartiers, prixMin: n(r.prixMin), prixMax: n(r.prixMax), piecesMin: n(r.piecesMin), chambresMin: n(r.chambresMin), sdbMin: n(r.sdbMin), surfaceMin: n(r.surfaceMin), surfaceMax: n(r.surfaceMax), etageMin: n(r.etageMin), etageMax: n(r.etageMax), dernierEtageOk: !!r.dernierEtageOk, dpe: classe(r.dpe), epoque: ['avant-1950', '1950-2000', 'apres-2000'].indexOf(r.epoque) > -1 ? r.epoque : '', etat: r.etat || '', annexes: liste(r.annexes), delai: r.delai || '', apport: n(budget.apport), financement: budget.financement || '', courtier: !!budget.courtier, bienAVendre: !!budget.bienAVendre, prixVenteEstime: n(budget.prixVenteEstime), statut: 'active', alertes: true, cree: nowISO() } : null;

  // Le bien reprend les champs de la fiche « bien » du CRM (+ ce que seul le candidat sait : motif, coup de cœur…).
  const annexesBien = liste(b.annexes);
  const bien = projet !== 'acheteur' ? { id: uid('mb'), leadId: lead.id, email: email, nom: nom, titre: '', adresse: b.adresse || '', codePostal: b.codePostal || '', ville: b.ville || '', type: TYPES_BIEN_CRM.indexOf(b.type) > -1 ? b.type : 'Appartement', quartier: b.quartier || '', transaction: 'Vente', surface: n(b.surface), pieces: n(b.pieces), chambres: n(b.chambres), sdb: n(b.sdb), etage: String(b.etage == null ? '' : b.etage).replace(/[^\d-]/g, ''), anneeConstruction: n(b.anneeConstruction) || null, dpe: classe(b.dpe), ges: classe(b.ges), etat: b.etat || '', exterieur: b.exterieur && b.exterieur !== 'Aucun' ? b.exterieur : '', surfaceExterieur: n(b.surfaceExterieur), prix: n(vente.prix), delai: vente.delai || '', dejaEnVente: vente.dejaEnVente || '', mandat: vente.mandat || '', motif: vente.motif || '', description: String(b.description || '').trim(), coupDeCoeur: String(b.coupDeCoeur || '').trim().slice(0, 280), photos: Array.isArray(b.photos) ? b.photos.slice(0, 12) : [], atouts: liste(b.atouts).concat(annexesBien).concat(b.exterieur && b.exterieur !== 'Aucun' ? [b.exterieur] : []).filter((x, i, a) => a.indexOf(x) === i), annexes: annexesBien, charges: n(b.charges), ascenseur: !!b.ascenseur || annexesBien.indexOf('Ascenseur') > -1, lat: b.lat || null, lon: b.lon || null, exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon', statutDemande: null, suiveurs: 0, agent: DEFAULT_AGENT_NOM, cree: nowISO() } : null;
  if (bien) {
    // Titre éditorial sans l'adresse (off-market), comme pour les biens importés.
    try { bien.titre = titreEditorialImport(bien); } catch (e) { bien.titre = ''; }
  }

  const dossierGarde = JSON.parse(JSON.stringify({ projet: projet, vous: v, recherche: r, budget: budget, bien: b, vente: vente }));
  const demande = { id: uid('d'), type: 'candidature', nom: nom || 'Candidat', email: email, tel: v.tel || '', leadId: lead.id, clientId: lead.id, role: projet, montant: 0, message: resumeDemande(dossier), dossier: dossierGarde, source: 'Site', statut: 'nouvelle', cree: nowISO() };

  return { lead, recherche, bien, demande };
}

app.get('/api/candidatures', requireAdmin, (req, res) => {
  const db = readDb();
  // On ne diffuse jamais les clés publiques ni l'historique de connexions.
  const leads = leadsVisibles(req, db).map((l) => {
    const copy = Object.assign({}, l);
    delete copy.passkeys;
    delete copy.connexions;
    return copy;
  });
  res.json({ leads: leads, recherches: recherchesVisibles(req, db), biens: db.biens, demandes: db.demandes });
});

// Comparables du book d'estimation (ventes DVF + annonces du marché).
app.get('/api/comparables', requireAdmin, (req, res) => {
  try {
    const list = JSON.parse(fs.readFileSync(COMPARABLES_FILE, 'utf8'));
    if (!Array.isArray(list)) throw new Error('format');
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'Comparables indisponibles' });
  }
});

// Clés PUBLIQUES utilisées par le navigateur (le DSN Sentry et la clé de site
// Turnstile sont conçus pour être visibles ; les secrets restent côté serveur).
app.get('/api/config-public', (req, res) => {
  res.json({
    sentryDsn: String(process.env.SENTRY_DSN_FRONT || process.env.SENTRY_DSN || ''),
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || 'production',
    turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || '')
  });
});

// Cloudflare Turnstile : vérifie qu'un humain a envoyé le formulaire
// (candidature, envoi d'un code de connexion). Sans TURNSTILE_SECRET_KEY, la
// vérification est désactivée. Si Cloudflare est injoignable, on laisse
// passer plutôt que de bloquer de vrais candidats.
async function verifierTurnstile(req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  const token = String((req.body && req.body.turnstileToken) || '');
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secret, response: token, remoteip: req.ip || '' }).toString(),
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json().catch(() => ({}));
    return !!d.success;
  } catch (e) {
    console.error('[turnstile] vérification impossible, requête acceptée :', e.message);
    return true;
  }
}
const MSG_TURNSTILE = 'Vérification anti-robot échouée : rechargez la page et réessayez.';

app.post('/api/candidature', async (req, res) => {
  if (!(await verifierTurnstile(req))) return res.status(403).json({ error: MSG_TURNSTILE });
  const dossier = Object.assign({}, req.body);
  delete dossier.turnstileToken;
  if (!dossier || typeof dossier !== 'object' || !dossier.vous) {
    return res.status(400).json({ error: 'Dossier invalide' });
  }
  const db = readDb();
  const result = decoupe(dossier);
  const email = ((dossier.vous && dossier.vous.email) || '').toLowerCase();

  let lead = email ? db.leads.find((l) => (l.email || '').toLowerCase() === email) : null;
  // Une fiche archivée (ex. candidature refusée) qui revient avec une nouvelle
  // candidature ressort des Archivés : sinon la nouvelle demande pointerait
  // vers des fiches invisibles (« Recherche absente »).
  const restaurer = (k, f) => {
    if (!f || !f.archive) return;
    delete f.archive; delete f.archiveMotif; f.restaureLe = nowISO(); f.restaurePar = 'Plateforme';
    logActivite(db, { leadId: lead.id, bienId: k === 'bien' ? f.id : null, rechercheId: k === 'recherche' ? f.id : null, type: 'restauration', auteur: 'Plateforme', detail: 'Nouvelle candidature' });
  };
  const nonVide = (x) => !(x === undefined || x === null || x === '' || x === 0 || (Array.isArray(x) && !x.length));
  if (lead) {
    const fresh = result.lead;
    const dejaMembre = lead.statut === 'accepte';
    // Les nouvelles réponses remplacent les anciennes, sans effacer ce que
    // l'agence a saisi quand le candidat laisse un champ vide.
    Object.keys(fresh).forEach((k) => { if (['id', 'cree', 'statut', 'role'].indexOf(k) === -1 && nonVide(fresh[k])) lead[k] = fresh[k]; });
    // Un membre déjà accepté garde son accès ; sinon la candidature repart à l'étude.
    if (!dejaMembre) lead.statut = 'en_attente';
    restaurer('lead', lead);
  } else {
    lead = result.lead;
    db.leads.push(lead);
  }

  if (result.recherche) {
    result.recherche.clientId = lead.id;
    result.recherche.leadId = lead.id;
    const prev = db.recherches.find((x) => x.clientId === lead.id && !x.archive) || db.recherches.find((x) => x.clientId === lead.id);
    if (prev) { Object.assign(prev, result.recherche, { id: prev.id, cree: prev.cree || result.recherche.cree }); restaurer('recherche', prev); result.recherche = prev; }
    else db.recherches.push(result.recherche);
  }

  if (result.bien) {
    result.bien.leadId = lead.id;
    result.bien.email = lead.email;
    const prev = db.biens.find((x) => x.leadId === lead.id && !x.archive) || db.biens.find((x) => x.leadId === lead.id);
    if (prev) { Object.assign(prev, result.bien, { id: prev.id, cree: prev.cree || result.bien.cree }); restaurer('bien', prev); result.bien = prev; }
    else db.biens.push(result.bien);
  }

  if (result.demande) {
    result.demande.clientId = lead.id;
    result.demande.leadId = lead.id;
    db.demandes.unshift(result.demande);
    creerTacheDemande(db, result.demande, 'Valider la candidature de ' + (result.demande.nom || 'nouveau membre'));
  }

  logActivite(db, { leadId: lead.id, bienId: result.bien ? result.bien.id : null, type: 'dossier_transmis', auteur: 'Plateforme' });

  if (result.bien) {
    try { await normaliserAdresse(result.bien); } catch (e) { /* BAN indisponible */ }
    lancerScanExclusivite(result.bien.id).catch(() => {});
  }
  const emailValide = validerEmail(email);
  if (mailer && emailValide.ok) {
    const prenomAccuse = (dossier.vous && dossier.vous.prenom) || '';
    mailer.sendMail({
      from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
      to: email,
      subject: 'Votre candidature Seecret a bien été reçue',
      html: emailAccuseReception(prenomAccuse)
    }).catch((err) => console.error('[email] envoi échoué :', err.message));
  }
  if (mailer && process.env.EMAIL_USER) {
    const nomClient = ((lead.prenom || '') + ' ' + (lead.nom || '')).trim() || 'Candidat';
    const projet = { acheteur: 'Acheter', acquereur: 'Acheter', vendeur: 'Vendre', mixte: 'Acheter et vendre' }[lead.projet] || lead.projet || '';
    const eur = (n) => (Number(n) ? Math.round(Number(n)).toLocaleString('fr-FR') + ' €' : '');
    const budget = lead.budgetMax ? (lead.budgetMin ? eur(lead.budgetMin) + ' – ' : 'jusqu’à ') + eur(lead.budgetMax) : '';
    const secteurs = (lead.quartiers || []).map((q) => /^p(\d+)$/.test(q) ? 'Paris ' + q.slice(1) + (q === 'p1' ? 'er' : 'e') : q).join(', ');
    const b = result.bien;
    const cible = result.demande ? 'demande/' + result.demande.id : 'client/' + lead.id;
    mailer.sendMail({
      from: '"Seecret Notifications" <' + FROM_EMAIL + '>',
      to: process.env.EMAIL_USER,
      subject: 'Nouvelle candidature : ' + nomClient + (projet ? ' · ' + projet : ''),
      html: emailAgent({
        etiquette: 'Candidature', titre: 'Nouvelle candidature de ' + escHtml(nomClient),
        intro: 'Une demande d’adhésion vient d’arriver sur la plateforme. Elle attend votre validation.',
        lignes: [['Projet', projet], ['Budget', budget], ['Secteurs', secteurs], ['Bien proposé', b ? [b.type, b.surface ? b.surface + ' m²' : '', b.ville || b.quartier || ''].filter(Boolean).join(' · ') : ''], ['Email', lead.email], ['Téléphone', lead.tel], ['Reçue le', new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' })]],
        bouton: { texte: 'Traiter la candidature', lien: lienCrm(req, cible), ecran: 'la fiche de cette candidature' },
        pied: 'Candidatures'
      })
    }).catch((err) => console.error('[email] notification agent échouée :', err.message));
  }
  writeDb(db);
  res.status(201).json({ ok: true, id: lead.id });
});

/* =====================================================================
   Accès membres — Magic link + Passkeys (FIDO2 / WebAuthn)
   ===================================================================== */

const MAGIC_TTL = 60 * 60 * 1000;              // lien magique + code : 1 heure
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;   // session : 7 jours
const FLOW_TTL = 5 * 60 * 1000;                // challenge WebAuthn : 5 minutes
const SESSION_COOKIE = 'seecret_session';
const FLOW_COOKIE = 'seecret_flow';

// Envoi d'email : l'API Resend (HTTPS, port 443) en priorité — les PaaS
// comme Railway bloquent les connexions SMTP sortantes (465 et 587 testés,
// les deux timeout systématiquement), donc le SMTP Gmail classique ne
// fonctionne pas en production ici. En local (ou si RESEND_API_KEY n'est
// pas défini), on retombe sur Gmail SMTP pour ne rien casser en dev.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'contact@seecret.fr';

const smtpFallback = (process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    })
  : null;

// Resend exige un expéditeur sur un domaine vérifié (pas une adresse Gmail) :
// on réécrit l'affichage ("Nom <adresse>") en gardant le nom mais en forçant
// l'adresse vers RESEND_FROM_EMAIL quand on passe par Resend.
function withResendFrom(from) {
  const m = /^"?([^"<]*)"?\s*<[^>]+>$/.exec(from || '');
  const nom = m ? m[1].trim() : 'Seecret';
  return '"' + nom + '" <' + RESEND_FROM_EMAIL + '>';
}

async function sendViaResend({ from, to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: withResendFrom(from), to: [to], subject, html })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error('Resend ' + resp.status + ' : ' + body.slice(0, 300));
  }
  return resp.json();
}

const mailer = (RESEND_API_KEY || smtpFallback)
  ? { sendMail: (opts) => (RESEND_API_KEY ? sendViaResend(opts) : smtpFallback.sendMail(opts)) }
  : null;

const FROM_EMAIL = process.env.EMAIL_USER || 'contact.immogroupe@gmail.com';
// Adresse publique de Seecret : celle à laquelle les candidats répondent.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@seecret.fr';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function originOf(req) {
  // Les liens des emails pointent toujours vers l'adresse officielle.
  const base = process.env.PUBLIC_URL || (hoteTechnique(req.get('host')) ? SITE_OFFICIEL : (req.protocol + '://' + req.get('host')));
  return base.replace(/\/+$/, '');
}

function rpIDOf(req) {
  try { return new URL(originOf(req)).hostname; } catch (e) { return req.hostname; }
}

const clientIp = (req) => req.ip || (req.connection && req.connection.remoteAddress) || 'inconnue';

function cookieFlags(req) {
  const secure = req.protocol === 'https' || /^https:/i.test(originOf(req));
  return '; Path=/; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}

function setCookie(res, req, name, value, maxAge) {
  res.append('Set-Cookie', name + '=' + encodeURIComponent(value) + cookieFlags(req) + '; Max-Age=' + Math.floor(maxAge / 1000));
}

function clearCookie(res, req, name) {
  res.append('Set-Cookie', name + '=;' + cookieFlags(req) + '; Max-Age=0');
}

// Challenges WebAuthn : en mémoire, courte durée de vie.
const flows = new Map();
function newFlow(challenge, extra) {
  const id = crypto.randomBytes(24).toString('hex');
  flows.set(id, Object.assign({ challenge: challenge, exp: Date.now() + FLOW_TTL }, extra || {}));
  return id;
}
function readFlow(req) {
  const id = getCookie(req, FLOW_COOKIE);
  const flow = id ? flows.get(id) : null;
  if (!flow || flow.exp < Date.now()) { if (id) flows.delete(id); return null; }
  return flow;
}

function pruneAuth(db) {
  const now = Date.now();
  db.magicLinks = db.magicLinks.filter((l) => !l.utilise && l.expire > now);
  db.sessions = db.sessions.filter((s) => s.expire > now);
}

function publicLead(lead) {
  return {
    id: lead.id, prenom: lead.prenom || '', nom: lead.nom || '', email: lead.email || '',
    statut: lead.statut, passkeys: (lead.passkeys || []).length,
    role: roleOf(lead),
    derniereConnexion: lead.derniereConnexion || null,
    connexions: (lead.connexions || []).slice(-10).reverse(),
    suivis: Array.isArray(lead.suivis) ? lead.suivis : [],
    onboarding: lead.onboarding || {},
    musique: lead.musique || null
  };
}

// Rôles : 'membre' par défaut, 'admin' / 'superadmin' pour l'agence.
// Les emails super-admin peuvent être fournis via ADMIN_EMAILS (séparés par des virgules).
// Rôles internes à l'agence (en plus de 'membre', le rôle par défaut des
// clients/leads de l'espace membre public) :
//   - 'agent'      : un agent de l'agence, voit UNIQUEMENT ses propres clients
//                    (ceux qui lui sont attribués, cf. lead.agentId), mais voit
//                    TOUS les biens de la plateforme (robotBiens + catalogue)
//                    pour pouvoir croiser avec ses propres clients.
//   - 'admin'      : alias historique d'agent (gardé pour compat, traité pareil).
//   - 'superadmin' : Gabriel (ou toute adresse listée dans ADMIN_EMAILS) — voit
//                    et modifie tout, sans aucune restriction par agentId.
// Au 18/11/2026, aucun compte 'agent' n'existe encore en production (usage
// solo) : ce système est posé maintenant pour ne pas avoir à retoucher toute
// la couche de permissions plus tard, mais il n'a aucun effet tant qu'aucun
// lead n'a role === 'agent' — le superadmin voit tout exactement comme avant.
const ROLES_STAFF = ['agent', 'admin', 'superadmin'];

function roleOf(lead) {
  if (!lead) return 'membre';
  const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (admins.indexOf((lead.email || '').toLowerCase()) > -1) return 'superadmin';
  return ROLES_STAFF.concat('membre').indexOf(lead.role) > -1 ? lead.role : 'membre';
}

function estAgentSimple(role) { return role === 'agent' || role === 'admin'; }

// Après connexion, un client est redirigé vers son espace membre public ;
// un agent ou le super-admin vers le CRM interne — même mécanisme de
// connexion (lien magique / code / passkey) que l'espace membre, seule la
// destination change.
function redirectPostLogin(lead) {
  const role = roleOf(lead);
  return (role === 'agent' || role === 'admin' || role === 'superadmin') ? '/crm.html' : '/espace.html';
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const role = roleOf(req.lead);
    if (ROLES_STAFF.indexOf(role) === -1) {
      return res.status(403).json({ error: 'Accès réservé à l’agence' });
    }
    next();
  });
}

function requireSuperadmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (roleOf(req.lead) !== 'superadmin') {
      return res.status(403).json({ error: 'Accès réservé au super-admin' });
    }
    next();
  });
}

// Un lead/client est visible par l'agent courant s'il lui est explicitement
// attribué (agentId), ou si l'agent est lui-même l'auteur de sa création
// (creePar, renseigné automatiquement à la création — cf. POST /api/leads).
// Un lead non attribué (agentId vide) n'est visible que par le super-admin,
// le temps qu'il le répartisse — jamais par un agent au hasard.
function leadVisibleParAgent(lead, agentLeadId) {
  return (lead.agentId || lead.creePar) === agentLeadId;
}

// Filtre la liste des leads selon le rôle de la requête courante. Ne change
// RIEN pour 'superadmin' (tout est visible, comme aujourd'hui) — ne fait
// quoi que ce soit que pour un rôle 'agent'/'admin', et ignore les comptes
// internes eux-mêmes (role agent/admin/superadmin) qui ne sont pas des
// clients à afficher dans la liste de clientèle.
function leadsVisibles(req, db) {
  const role = roleOf(req.lead);
  const clientsSeuls = db.leads.filter((l) => ROLES_STAFF.indexOf(l.role) === -1);
  if (role === 'superadmin') return clientsSeuls;
  return clientsSeuls.filter((l) => leadVisibleParAgent(l, req.lead.id));
}

// Même principe pour les recherches : une recherche est visible si son
// client (clientId/leadId) est visible.
function recherchesVisibles(req, db) {
  const role = roleOf(req.lead);
  if (role === 'superadmin') return db.recherches;
  return db.recherches.filter((r) => {
    const lead = db.leads.find((l) => l.id === (r.clientId || r.leadId));
    return lead && leadVisibleParAgent(lead, req.lead.id);
  });
}

function createSession(db, lead, req) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    id: sha256(token), leadId: lead.id, cree: nowISO(), expire: Date.now() + SESSION_TTL,
    ip: clientIp(req), ua: (req.get('user-agent') || '').slice(0, 200)
  });
  return token;
}

function requireAuth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = bearer || getCookie(req, SESSION_COOKIE);
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  const db = readDb();
  pruneAuth(db);
  const session = db.sessions.find((s) => s.id === sha256(token));
  if (!session) return res.status(401).json({ error: 'Session expirée' });
  const lead = db.leads.find((l) => l.id === session.leadId);
  if (!lead) return res.status(401).json({ error: 'Compte introuvable' });
  req.session = session;
  req.lead = lead;
  req.db = db;
  next();
}

// Email HTML — design crème, gros code + bouton.
function emailHTML(prenom, code, lien) {
  const hello = prenom ? 'Bonjour ' + prenom : 'Bonjour';
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:Georgia,\'Times New Roman\',serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 16px;">',
    '<div style="max-width:460px;width:100%;background:#ffffff;border:1px solid #eeebe6;border-radius:24px;padding:44px 36px;text-align:left;">',
    '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a54;font-weight:600;">Seecret</div>',
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.15;color:#141210;margin:14px 0 8px;">' + hello + ',</h1>',
    '<p style="font-size:15px;line-height:1.6;color:#5f5a54;margin:0 0 20px;">Cliquez sur le bouton pour entrer directement, ou utilisez votre code :</p>',
    '<div style="text-align:center;"><a href="' + lien + '" style="display:inline-block;background:#141210;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:999px;font-size:15px;font-weight:500;">Entrer dans Seecret</a></div>',
    '<p style="font-size:13px;line-height:1.6;color:#5f5a54;margin:24px 0 8px;text-align:center;">Votre code à 6 chiffres</p>',
    '<div style="font-size:38px;font-weight:700;letter-spacing:.35em;color:#141210;text-align:center;padding:16px 0;">' + code + '</div>',
    '<p style="font-size:12px;color:#9a948c;margin:28px 0 0;text-align:center;">Ce code et ce lien expirent dans 1 heure.</p>',
    '</div>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

function creerTacheDemande(db, demande, titre) {
  db.tasks.push({
    id: uid('t'), type: 'demande', titre: titre, demandeId: demande.id,
    leadId: demande.leadId || null, email: demande.email || '', nom: demande.nom || '',
    statut: 'en_attente', cree: nowISO(), traiteeAt: null
  });
}

function validerEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e.indexOf('@') === -1 || e.indexOf('.') === -1 || /\s/.test(e)) return { ok: false, raison: 'format invalide' };
  const dom = (e.split('@')[1] || '').trim();
  const bloques = ['example.com', 'example.org', 'example.net', 'test.com', 'localhost', 'invalid.com', 'mailinator.com'];
  if (bloques.indexOf(dom) > -1) return { ok: false, raison: 'domaine de test non délivrable (' + dom + ')' };
  return { ok: true };
}

// ---- Données de démonstration ----
// Au lancement du produit, le CRM et le catalogue membre sont vides (aucune
// vraie candidature encore) : pour pouvoir montrer la plateforme et recueillir
// des réactions, on peuple une fois des clients/biens de démo réalistes,
// couvrant tout le parcours (candidature en attente, avant-première, visite
// ouverte, sous offre, vendu). Chaque enregistrement est marqué `demo: true`
// pour rester identifiable et purgeable séparément des vraies données (voir
// DELETE /api/admin/demo). Ne s'exécute qu'une fois (db.demoSeeded), jamais
// sur une base qui a déjà été seedée, pour ne jamais dupliquer au redémarrage.
function joursAvant(n) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString(); }

// Photos ajoutées après le premier seed (v1 n'avait aucune photo) : plutôt que
// de resseeder (dupliquerait tout), on rattrape juste les biens de démo déjà
// en base qui n'ont pas encore de photo, en les retrouvant par email — sans
// jamais toucher un bien réel (jamais marqué `demo`).
function rattraperPhotosDemo(db) {
  if (db.demoPhotosV2) return;
  db.demoPhotosV2 = true;
  const photosParEmail = {
    'sophie.marchal@demo.seecret.fr': ['ilesaintlouis-1.jpg', 'saintsulpice-1.jpg'],
    'marc.lemoine@demo.seecret.fr': ['home-1.jpg', 'home-loft-bright.jpg'],
    'antoine.roussel@demo.seecret.fr': ['home-6.jpg', 'trocadero-1.jpg'],
    'helene.girard@demo.seecret.fr': ['montmartre-1.jpg', 'home-jardin.jpg']
  };
  db.biens.forEach((b) => {
    if (b.demo && photosParEmail[b.email] && (!b.photos || !b.photos.length)) {
      b.photos = photosParEmail[b.email];
    }
  });
}

function seedDemoData(db) {
  if (db.demoSeeded) { rattraperPhotosDemo(db); return; }
  db.demoSeeded = true;
  db.demoPhotosV2 = true;

  const lead = (over) => Object.assign({
    id: uid('l'), tel: '', budgetMax: 0, quartiers: [], piecesMin: 0, surfaceMin: 0, surfaceMax: 0,
    delai: '', typeBien: '', apport: 0, financement: '', courtier: false, bienAVendre: false,
    role: 'membre', source: 'Candidature (démo)', demo: true
  }, over);
  const bien = (over) => Object.assign({
    id: uid('mb'), codePostal: '', chambres: 0, sdb: 0, etage: '', dpe: '', etat: '',
    exterieur: '', surfaceExterieur: 0, delai: '', dejaEnVente: 'non', mandat: '', motif: '',
    description: '', photos: [], atouts: [], annexes: [], ges: '', charges: 0, ascenseur: false,
    lat: null, lon: null, statutDemande: null, suiveurs: 0, agent: DEFAULT_AGENT_NOM, demo: true
  }, over);
  const recherche = (over) => Object.assign({
    id: uid('r'), types: [], type: '', quartiers: [], prixMax: 0, piecesMin: 0, surfaceMin: 0,
    surfaceMax: 0, delai: '', apport: 0, financement: '', courtier: false, bienAVendre: false,
    etageMin: 0, etageMax: 0, etat: '', dpe: '', annexes: [], prixVenteEstime: 0, statut: 'active',
    alertes: true, demo: true
  }, over);

  // L1 — Acquéreuse acceptée, recherche active (pas encore de bien suivi)
  const l1 = lead({
    prenom: 'Claire', nom: 'Fontaine', email: 'claire.fontaine@demo.seecret.fr', tel: '0612345678',
    ville: 'Paris', projet: 'acheteur', statut: 'accepte', cree: joursAvant(18),
    budgetMax: 850000, quartiers: ['Le Marais', 'Bastille'], piecesMin: 3, surfaceMin: 60,
    delai: '3 à 6 mois', typeBien: 'Appartement', apport: 200000, financement: 'Prêt bancaire en cours', courtier: true
  });
  const r1 = recherche({
    clientId: l1.id, leadId: l1.id, titre: 'Appartement 3 pièces et +', types: ['Appartement'],
    type: 'Appartement', quartiers: l1.quartiers, prixMax: 850000, piecesMin: 3, surfaceMin: 60,
    surfaceMax: 95, delai: '3 à 6 mois', apport: 200000, financement: l1.financement, cree: joursAvant(18)
  });

  // L2 — Vendeuse, bien validé en avant-première (pas encore en vente)
  const l2 = lead({
    prenom: 'Sophie', nom: 'Marchal', email: 'sophie.marchal@demo.seecret.fr', tel: '0623456789',
    ville: 'Paris', projet: 'vendeur', statut: 'accepte', cree: joursAvant(30)
  });
  const b1 = bien({
    leadId: l2.id, email: l2.email, nom: 'Sophie Marchal', titre: 'Trois pièces lumineux rue de Turenne',
    adresse: '14 rue de Turenne',
    codePostal: '75003', ville: 'Paris', type: 'Appartement', quartier: 'Le Marais', surface: 72,
    pieces: 3, chambres: 2, sdb: 1, etage: '3e étage', dpe: 'C', ges: 'D', etat: 'Bon état',
    exterieur: 'Balcon', surfaceExterieur: 6, prix: 920000, delai: '6 à 12 mois',
    motif: 'Agrandissement familial', description: 'Bel appartement traversant, lumineux, dans une rue calme du Marais.',
    atouts: ['Parquet d’origine', 'Lumineux', 'Calme'], charges: 280,
    photos: ['ilesaintlouis-1.jpg', 'saintsulpice-1.jpg'],
    exclusivite: { statut: 'verifie_exclusif', liens: [] }, validation: 'valide', statut: 'avant-premiere',
    suiveurs: 4, cree: joursAvant(25)
  });

  // L3 — Vendeur, bien ouvert aux visites, sous offre en cours
  const l3 = lead({
    prenom: 'Marc', nom: 'Lemoine', email: 'marc.lemoine@demo.seecret.fr', tel: '0634567890',
    ville: 'Paris', projet: 'vendeur', statut: 'accepte', cree: joursAvant(45)
  });
  const b2 = bien({
    leadId: l3.id, email: l3.email, nom: 'Marc Lemoine', titre: 'Deux pièces refait à neuf, rue Oberkampf',
    adresse: '8 rue Oberkampf',
    codePostal: '75011', ville: 'Paris', type: 'Appartement', quartier: 'Oberkampf', surface: 54,
    pieces: 2, chambres: 1, sdb: 1, etage: '5e étage', dpe: 'B', ges: 'C', etat: 'Refait à neuf',
    prix: 610000, delai: 'Dès que possible', dejaEnVente: 'non', mandat: 'Mandat simple signé',
    motif: 'Départ en province', description: 'Appartement refait à neuf, cuisine ouverte, exposé sud.',
    atouts: ['Lumineux', 'Cuisine ouverte'], charges: 150, ascenseur: true,
    photos: ['home-1.jpg', 'home-loft-bright.jpg'],
    exclusivite: { statut: 'verifie_exclusif', liens: [] }, validation: 'valide', statut: 'sous-offre',
    suiveurs: 9, cree: joursAvant(40)
  });

  // L4 — Acquéreur, auteur d'une offre sur le bien de Marc + d'une visite sur celui d'Hélène
  const l4 = lead({
    prenom: 'Julien', nom: 'Perret', email: 'julien.perret@demo.seecret.fr', tel: '0645678901',
    ville: 'Paris', projet: 'acheteur', statut: 'accepte', cree: joursAvant(20),
    budgetMax: 650000, quartiers: ['Oberkampf', 'Belleville'], piecesMin: 2, surfaceMin: 45,
    delai: 'Immédiat', apport: 150000, financement: 'Financement validé'
  });
  const r4 = recherche({
    clientId: l4.id, leadId: l4.id, titre: 'Appartement 2 pièces et +', types: ['Appartement'],
    type: 'Appartement', quartiers: l4.quartiers, prixMax: 650000, piecesMin: 2, surfaceMin: 45,
    delai: 'Immédiat', apport: 150000, financement: l4.financement, cree: joursAvant(20)
  });
  const offre1 = {
    id: uid('o'), bienId: b2.id, leadId: l4.id, email: l4.email, nom: 'Julien Perret',
    montant: 590000, message: 'Offre au prix moins négociation mineure.', statut: 'en_attente',
    demo: true, cree: joursAvant(3)
  };
  const demandeOffre1 = {
    id: uid('d'), type: 'offre', leadId: l4.id, bienId: b2.id, email: l4.email, nom: 'Julien Perret',
    montant: 590000, offreId: offre1.id, bienAdresse: b2.adresse, role: 'offre', statut: 'nouvelle',
    source: 'Espace membre (démo)', demo: true, cree: joursAvant(3)
  };

  // L5 — Mixte, candidature en attente de validation (démontre la file d'attente)
  const l5 = lead({
    prenom: 'Nadia', nom: 'Belkacem', email: 'nadia.belkacem@demo.seecret.fr', tel: '0656789012',
    ville: 'Lyon', projet: 'mixte', statut: 'en_attente', cree: joursAvant(2),
    budgetMax: 600000, quartiers: ['11e arrondissement, Paris'], piecesMin: 3, surfaceMin: 65,
    delai: '6 à 12 mois', typeBien: 'Appartement', apport: 120000, financement: 'À étudier'
  });
  const b3 = bien({
    leadId: l5.id, email: l5.email, nom: 'Nadia Belkacem', titre: 'Maison familiale, Croix-Rousse',
    adresse: '', codePostal: '', ville: 'Lyon',
    type: 'Maison', quartier: 'Croix-Rousse', surface: 110, pieces: 5, chambres: 3, sdb: 2,
    prix: 480000, delai: '6 à 12 mois', motif: 'Mutation professionnelle vers Paris',
    exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon',
    suiveurs: 0, cree: joursAvant(2)
  });
  const r5 = recherche({
    clientId: l5.id, leadId: l5.id, titre: 'Appartement 3 pièces et +', types: ['Appartement'],
    type: 'Appartement', quartiers: l5.quartiers, prixMax: 600000, piecesMin: 3, surfaceMin: 65,
    delai: '6 à 12 mois', apport: 120000, financement: l5.financement, cree: joursAvant(2)
  });
  const demandeCandidature5 = {
    id: uid('d'), type: 'candidature', nom: 'Nadia Belkacem', email: l5.email, leadId: l5.id,
    clientId: l5.id, role: 'mixte', montant: 0, message: 'Profil : Acquéreur et Vendeur. Dossier complet en cours d’examen.',
    source: 'Site (démo)', statut: 'nouvelle', demo: true, cree: joursAvant(2)
  };
  const tacheCandidature5 = {
    id: uid('t'), type: 'demande', titre: 'Candidature de Nadia Belkacem', demandeId: demandeCandidature5.id,
    leadId: l5.id, email: l5.email, nom: 'Nadia Belkacem', statut: 'en_attente', demo: true,
    cree: joursAvant(2), traiteeAt: null
  };

  // L6 — Vendeur, bien déjà vendu (historique / succès)
  const l6 = lead({
    prenom: 'Antoine', nom: 'Roussel', email: 'antoine.roussel@demo.seecret.fr', tel: '0667890123',
    ville: 'Paris', projet: 'vendeur', statut: 'accepte', cree: joursAvant(90)
  });
  const b4 = bien({
    leadId: l6.id, email: l6.email, nom: 'Antoine Roussel', titre: 'Deux pièces vendu, rue des Martyrs',
    adresse: '22 rue des Martyrs',
    codePostal: '75009', ville: 'Paris', type: 'Appartement', quartier: 'Pigalle / SOPI', surface: 48,
    pieces: 2, chambres: 1, sdb: 1, etage: '2e étage', dpe: 'D', ges: 'E', prix: 540000,
    motif: 'Investissement revendu', photos: ['home-6.jpg', 'trocadero-1.jpg'],
    exclusivite: { statut: 'verifie_exclusif', liens: [] },
    validation: 'valide', statut: 'vendu', suiveurs: 12, cree: joursAvant(85)
  });

  // L7 — Vendeuse, bien ouvert aux visites (pas encore d'offre)
  const l7 = lead({
    prenom: 'Hélène', nom: 'Girard', email: 'helene.girard@demo.seecret.fr', tel: '0678901234',
    ville: 'Paris', projet: 'vendeur', statut: 'accepte', cree: joursAvant(15)
  });
  const b5 = bien({
    leadId: l7.id, email: l7.email, nom: 'Hélène Girard', titre: 'Loft atypique rez-de-jardin, Charonne',
    adresse: '5 rue de Charonne',
    codePostal: '75011', ville: 'Paris', type: 'Loft', quartier: 'Bastille / Charonne', surface: 95,
    pieces: 3, chambres: 2, sdb: 2, etage: 'RDC', dpe: 'E', ges: 'E', prix: 780000,
    delai: 'Dès que possible', dejaEnVente: 'oui', mandat: 'Mandat exclusif',
    motif: 'Investissement revendu', description: 'Loft atypique en rez-de-jardin, volumes exceptionnels.',
    atouts: ['Volumes', 'Rez-de-jardin'], charges: 310, photos: ['montmartre-1.jpg', 'home-jardin.jpg'],
    exclusivite: { statut: 'verifie_exclusif', liens: [] }, validation: 'valide', statut: 'ouvert',
    suiveurs: 6, cree: joursAvant(12)
  });
  const demandeVisite4 = {
    id: uid('d'), type: 'visite', leadId: l4.id, bienId: b5.id, email: l4.email, nom: 'Julien Perret',
    message: 'Créneau souhaité : samedi matin', creneau: 'Samedi matin', statut: 'nouvelle',
    source: 'Espace membre (démo)', demo: true, cree: joursAvant(1)
  };
  const tacheVisite4 = {
    id: uid('t'), type: 'demande', titre: 'Demande de visite de Julien Perret', demandeId: demandeVisite4.id,
    leadId: l4.id, email: l4.email, nom: 'Julien Perret', statut: 'en_attente', demo: true,
    cree: joursAvant(1), traiteeAt: null
  };

  db.leads.push(l1, l2, l3, l4, l5, l6, l7);
  db.recherches.push(r1, r4, r5);
  db.biens.push(b1, b2, b3, b4, b5);
  db.offres.push(offre1);
  db.demandes.push(demandeOffre1, demandeCandidature5, demandeVisite4);
  db.tasks.push(tacheCandidature5, tacheVisite4);

  logActivite(db, { leadId: l2.id, bienId: b1.id, type: 'mise_au_catalogue', auteur: 'Agence (démo)' });
  logActivite(db, { leadId: l3.id, bienId: b2.id, type: 'offre_faite', auteur: 'Julien Perret (acquéreur, démo)' });
  logActivite(db, { leadId: l5.id, bienId: null, type: 'dossier_transmis', auteur: 'Nadia Belkacem (démo)' });
  logActivite(db, { leadId: l6.id, bienId: b4.id, type: 'vente_conclue', auteur: 'Agence (démo)' });
  logActivite(db, { leadId: l7.id, bienId: b5.id, type: 'visite_demandee', auteur: 'Julien Perret (acquéreur, démo)' });
}

function emailAccuseReception(prenom) {
  const hello = prenom ? 'Bonjour ' + prenom + ',' : 'Bonjour,';
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px;">',
    '<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #eeebe6;border-radius:20px;border-collapse:separate;">',
    '<tr><td style="padding:40px 40px 44px;">',
    '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#3b2b4a;font-weight:600;">Seecret</div>',
    '<h1 style="font-family:Georgia,\'Times New Roman\',serif;font-weight:400;font-size:30px;line-height:1.12;color:#141210;margin:16px 0 0;letter-spacing:-.01em;">' + hello + '</h1>',
    '<p style="font-size:16px;line-height:1.6;color:#5f5a54;margin:14px 0 0;">Nous avons bien reçu votre candidature. Nos équipes la traitent et vous recevrez une réponse sous 48 h.</p>',
    '</td></tr>',
    '</table>',
    '<p style="font-size:12px;color:#5f5a54;margin:22px 0 0;text-align:center;">L’équipe Seecret</p>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

function emailValidationPremium(prenom, lien) {
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px;">',
    '<table role="presentation" width="100%" style="max-width:540px;background:#ffffff;border-radius:20px;border-collapse:separate;overflow:hidden;">',
    '<tr><td style="background:linear-gradient(135deg,#1A3C34 0%,#2e5d51 55%,#8C7A5B 100%);padding:44px 44px 40px;">',
    '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.85);font-weight:600;">Seecret</div>',
    '<h1 style="font-family:Georgia,\'Times New Roman\',serif;font-weight:400;font-size:34px;line-height:1.1;color:#ffffff;margin:16px 0 0;letter-spacing:-.01em;">Bienvenue sur Seecret.</h1>',
    '<p style="font-size:15px;line-height:1.6;color:rgba(255,255,255,.92);margin:12px 0 0;">La plateforme du off market. Des biens visibles nulle part ailleurs.</p>',
    '</td></tr>',
    '<tr><td style="padding:30px 44px 44px;">',
    '<a href="' + lien + '" style="display:inline-block;background:#1A3C34;color:#ffffff;text-decoration:none;padding:16px 34px;border-radius:999px;font-size:15px;font-weight:500;">Accéder à mon espace</a>',
    '</td></tr>',
    '</table>',
    '<p style="font-size:12px;color:#5f5a54;margin:22px 0 0;text-align:center;">Ce lien sécurisé expire dans 1 heure.</p>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

function ficheProduitHtml(bien) {
  const photo = (p) => (/^(data:|https?:|\/)/.test(p) ? p : '/assets/img/' + p);
  const photos = (bien.photos || []).slice(0, 8);
  const rows = [
    ['Prix honoraires inclus', bien.prix ? prixHai(bien.prix, tauxHonorairesPour(bien, null)).toLocaleString('fr-FR') + ' €' : '—'],
    ['Surface', bien.surface ? bien.surface + ' m²' : '—'],
    ['Pièces', bien.pieces || '—'],
    ['Chambres', bien.chambres || '—'],
    ['Salles de bain', bien.sdb || '—'],
    ['Étage', bien.etage || '—'],
    ['DPE', bien.dpe || '—'],
    ['GES', bien.ges || '—'],
    ['État', bien.etat || '—'],
    ['Extérieur', (bien.exterieur && bien.exterieur !== 'Aucun') ? bien.exterieur : '—'],
    ['Annexes', (bien.annexes || []).join(', ') || '—'],
    ['Charges', bien.charges ? bien.charges.toLocaleString('fr-FR') + ' € / an' : '—']
  ];
  return [
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + (bien.titre || 'Fiche confidentielle') + '</title></head>',
    '<body style="margin:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#141210;">',
    '<div style="max-width:820px;margin:0 auto;padding:48px 40px;background:#ffffff;">',
    '<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #141210;padding-bottom:18px;">',
    '<div style="font-family:Georgia,serif;font-size:30px;letter-spacing:.08em;">SEECRET</div>',
    '<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a54;">Fiche confidentielle</div>',
    '</div>',
    (photos[0] ? '<img src="' + photo(photos[0]) + '" style="width:100%;max-height:420px;object-fit:cover;display:block;margin:28px 0 18px;border-radius:12px;"/>' : ''),
    (photos.length > 1 ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px;">' + photos.slice(1).map((p) => '<img src="' + photo(p) + '" style="width:118px;height:88px;object-fit:cover;border-radius:8px;"/>').join('') + '</div>' : ''),
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:40px;line-height:1.1;margin:0 0 6px;">' + (bien.titre || '') + '</h1>',
    '<div style="color:#5f5a54;font-size:16px;margin-bottom:24px;">' + escHtml([labelQuartier(bien.quartier) || '', bien.codePostal || '', bien.ville || ''].filter(Boolean).join(' · ')) + ' — adresse communiquée à la confirmation de la visite</div>',
    '<table style="width:100%;border-collapse:collapse;margin-bottom:28px;">' + rows.map((r, i) => '<tr style="border-top:' + (i === 0 ? '1px solid #e3dfd9' : '') + '"><td style="padding:12px 0;border-bottom:1px solid #eeebe6;color:#5f5a54;width:40%;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">' + r[0] + '</td><td style="padding:12px 0;border-bottom:1px solid #eeebe6;font-size:15px;">' + r[1] + '</td></tr>').join('') + '</table>',
    (bien.description ? '<p style="font-size:15.5px;line-height:1.7;color:#4e4759;">' + bien.description + '</p>' : ''),
    '<div style="margin-top:36px;padding-top:18px;border-top:1px solid #eeebe6;font-size:11px;color:#9a948c;text-align:center;">Document strictement confidentiel. Voir sur Seecret pour plus d\'informations.</div>',
    '</div></body></html>'
  ].join('');
}

function emailBienPreview(bien, nom, message) {
  const hello = message || (nom ? 'Bonjour ' + nom + ',' : 'Bonjour,');
  const photo = (bien.photos && bien.photos[0]) ? bien.photos[0] : '';
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 20px;">',
    '<table role="presentation" width="100%" style="max-width:540px;background:#ffffff;border:1px solid #eeebe6;border-radius:20px;border-collapse:separate;overflow:hidden;">',
    (photo ? '<tr><td style="padding:0;"><img src="' + photo + '" alt="" style="display:block;width:100%;max-height:300px;object-fit:cover;"/></td></tr>' : ''),
    '<tr><td style="padding:40px 40px 44px;">',
    '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#3b2b4a;font-weight:600;">Seecret</div>',
    '<h1 style="font-family:Georgia,\'Times New Roman\',serif;font-weight:400;font-size:28px;line-height:1.12;color:#141210;margin:16px 0 0;">' + (bien.titre || 'Un bien') + '</h1>',
    '<p style="font-size:16px;line-height:1.6;color:#5f5a54;margin:12px 0 0;">' + hello + '</p>',
    '<p style="font-size:16px;line-height:1.6;color:#5f5a54;margin:6px 0 0;">' + (bien.prix ? prixHai(bien.prix, tauxHonorairesPour(bien, null)).toLocaleString('fr-FR') + ' € honoraires inclus' : '') + (bien.surface ? ' · ' + bien.surface + ' m²' : '') + (bien.quartier ? ' · ' + bien.quartier : '') + '</p>',
    (bien.description ? '<p style="font-size:15px;line-height:1.6;color:#5f5a54;margin:14px 0 0;">' + bien.description + '</p>' : ''),
    '</td></tr>',
    '</table>',
    '<p style="font-size:12px;color:#5f5a54;margin:22px 0 0;text-align:center;">L’équipe Seecret</p>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

// Email pour l'agence (notifications) : même univers que les emails clients,
// avec les informations utiles et un bouton qui ouvre directement le bon écran
// du CRM (après connexion si besoin).
function lienCrm(req, cible) {
  return originOf(req) + '/crm.html?ouvrir=' + encodeURIComponent(String(cible || '').replace(/^#?\/?/, ''));
}
function emailAgent(o) {
  const lignes = (o.lignes || []).filter((l) => l && l[1] !== undefined && l[1] !== null && String(l[1]).trim() !== '');
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:Georgia,\'Times New Roman\',serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">',
    '<div style="max-width:520px;width:100%;background:#ffffff;border:1px solid #eeebe6;border-radius:24px;padding:40px 36px;text-align:left;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>',
    '<td style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a54;font-weight:600;">Seecret · Agence</td>',
    '<td align="right"><span style="display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a5c1e;background:#f6efe1;border-radius:999px;padding:5px 12px;">' + escHtml(o.etiquette || 'Notification') + '</span></td>',
    '</tr></table>',
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.2;color:#141210;margin:18px 0 8px;">' + o.titre + '</h1>',
    o.intro ? '<p style="font-size:15px;line-height:1.65;color:#5f5a54;margin:0 0 22px;">' + o.intro + '</p>' : '',
    lignes.length ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeebe6;margin:0 0 26px;font-family:Helvetica,Arial,sans-serif;">' + lignes.map((l) =>
      '<tr><td style="padding:11px 0;border-bottom:1px solid #f1eee9;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9a948c;width:38%;vertical-align:top;">' + escHtml(l[0]) + '</td>' +
      '<td style="padding:11px 0;border-bottom:1px solid #f1eee9;font-size:14px;line-height:1.5;color:#141210;vertical-align:top;">' + (l[2] ? l[1] : escHtml(String(l[1]))) + '</td></tr>').join('') + '</table>' : '',
    o.citation ? '<div style="border-left:3px solid #e6dcc7;padding:4px 0 4px 16px;margin:0 0 26px;font-size:15px;line-height:1.65;color:#3a3631;font-style:italic;">« ' + o.citation + ' »</div>' : '',
    o.bouton ? '<div style="text-align:center;"><a href="' + o.bouton.lien + '" style="display:inline-block;background:#141210;color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;">' + escHtml(o.bouton.texte) + '</a></div>' : '',
    o.bouton ? '<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9a948c;margin:14px 0 0;text-align:center;">Le lien ouvre directement ' + escHtml(o.bouton.ecran || 'le bon écran du CRM') + '. Si vous n’êtes pas connecté, Seecret vous y amène juste après votre code.</p>' : '',
    '</div>',
    '<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#b3ada4;margin:18px 0 0;">Notification interne · ' + escHtml(o.pied || 'CRM Seecret') + '</p>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}
function emailValidationLegere(prenom, texte) {
  const hello = prenom ? 'Bonjour ' + prenom : 'Bonjour';
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:Georgia,\'Times New Roman\',serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 16px;">',
    '<div style="max-width:480px;width:100%;background:#ffffff;border:1px solid #eeebe6;border-radius:24px;padding:40px 36px;text-align:left;">',
    '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a54;font-weight:600;">Seecret</div>',
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;line-height:1.15;color:#141210;margin:14px 0 8px;">' + hello + ',</h1>',
    '<p style="font-size:15px;line-height:1.7;color:#5f5a54;margin:0;">' + texte + '</p>',
    '<p style="font-size:12px;color:#9a948c;margin:28px 0 0;text-align:center;">L’équipe Seecret</p>',
    '</div>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

// 1) L'admin valide le lead → le client reçoit un email avec un code et un lien.
app.post('/api/auth/enroll', async (req, res) => {
  if (!(await verifierTurnstile(req))) return res.status(403).json({ error: MSG_TURNSTILE });
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }
  const db = readDb();
  pruneAuth(db);
  const lead = db.leads.find((l) => (l.email || '').toLowerCase() === email);

  // Réponse identique dans tous les cas : pas d'énumération de comptes.
  if (lead && lead.statut === 'accepte') {
    const token = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    db.magicLinks.push({
      id: sha256(token), codeHash: sha256(code), leadId: lead.id, email: email,
      cree: nowISO(), expire: Date.now() + MAGIC_TTL, utilise: false, codeUtilise: false
    });
    writeDb(db);
    const lien = originOf(req) + '/espace.html?token=' + token;
    console.log('[TEST] Connexion ' + email + ' → code: ' + code + ' · lien: ' + lien);
    if (mailer) {
      mailer.sendMail({
        from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
        to: email,
        subject: 'Votre code pour Seecret',
        html: emailHTML(lead.prenom || '', code, lien)
      }).catch((err) => console.error('[email] envoi échoué :', err.message));
    } else {
      console.warn('[email] SMTP non configuré (EMAIL_USER / EMAIL_PASS) — aucun email envoyé pour ' + email + '.');
    }
  }
  res.json({ ok: true, message: 'Si votre accès est validé, un email avec votre code vient de vous être envoyé.' });
});

// 1b) Connexion par code à 6 chiffres (alternative au lien magique).
app.post('/api/auth/verify-code', (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && req.body.code) || '').replace(/\D/g, '').slice(0, 6);
  if (!email || code.length !== 6) return res.status(400).json({ error: 'Code à 6 chiffres requis' });
  const db = readDb();
  pruneAuth(db);
  const link = db.magicLinks.find((l) => l.email === email && l.codeHash === sha256(code) && !l.codeUtilise && l.expire > Date.now());
  if (!link) return res.status(401).json({ error: 'Code invalide ou expiré' });
  const lead = db.leads.find((l) => l.id === link.leadId);
  if (!lead) return res.status(404).json({ error: 'Compte introuvable' });

  link.codeUtilise = true;
  lead.derniereConnexion = nowISO();
  lead.connexions = lead.connexions || [];
  lead.connexions.push({ at: nowISO(), ip: clientIp(req), ua: (req.get('user-agent') || '').slice(0, 200) });

  const token = createSession(db, lead, req);
  writeDb(db);
  setCookie(res, req, SESSION_COOKIE, token, SESSION_TTL);
  res.json({ ok: true, redirect: redirectPostLogin(lead) });
});

// 1c) Connexion auto par le lien magique (?token=...) — sans code ni Passkey.
app.post('/api/auth/verify-token', (req, res) => {
  const token = String((req.body && req.body.token) || '');
  if (!token) return res.status(400).json({ error: 'Lien invalide' });
  const db = readDb();
  pruneAuth(db);
  const link = db.magicLinks.find((l) => l.id === sha256(token));
  if (!link || link.utilise || link.expire < Date.now()) return res.status(401).json({ error: 'Lien invalide ou expiré' });
  const lead = db.leads.find((l) => l.id === link.leadId);
  if (!lead) return res.status(404).json({ error: 'Compte introuvable' });

  link.utilise = true;
  lead.derniereConnexion = nowISO();
  lead.connexions = lead.connexions || [];
  lead.connexions.push({ at: nowISO(), ip: clientIp(req), ua: (req.get('user-agent') || '').slice(0, 200) });

  const sessionToken = createSession(db, lead, req);
  writeDb(db);
  setCookie(res, req, SESSION_COOKIE, sessionToken, SESSION_TTL);
  res.json({ ok: true, redirect: redirectPostLogin(lead) });
});

// 2) Le lien est valide → on prépare la création du Passkey.
app.post('/api/auth/verify-enrollment', async (req, res) => {
  try {
    const token = String((req.body && req.body.token) || '');
    const db = readDb();
    pruneAuth(db);
    const link = token ? db.magicLinks.find((l) => l.id === sha256(token)) : null;
    if (!link) return res.status(400).json({ error: 'Lien invalide ou expiré' });

    const lead = db.leads.find((l) => l.id === link.leadId);
    if (!lead || lead.statut !== 'accepte') return res.status(403).json({ error: 'Accès non autorisé' });

    const options = await sw.generateRegistrationOptions({
      rpName: 'Seecret',
      rpID: rpIDOf(req),
      userID: Buffer.from(String(lead.id)),
      userName: lead.email,
      userDisplayName: ((lead.prenom || '') + ' ' + (lead.nom || '')).trim() || lead.email,
      attestationType: 'none',
      excludeCredentials: (lead.passkeys || []).map((k) => ({ id: k.id, transports: k.transports || [] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
    });

    const flow = newFlow(options.challenge, { token: link.id, leadId: lead.id });
    setCookie(res, req, FLOW_COOKIE, flow, FLOW_TTL);
    res.json({ ok: true, options: options, email: lead.email, prenom: lead.prenom || '' });
  } catch (e) {
    console.error('verify-enrollment :', e.message);
    res.status(500).json({ error: 'Impossible de préparer la création du Passkey' });
  }
});

// 3) Le navigateur a créé le Passkey → on vérifie et on enregistre la clé publique.
app.post('/api/auth/complete-enrollment', async (req, res) => {
  try {
    const token = String((req.body && req.body.token) || '');
    const response = req.body && req.body.response;
    const flow = readFlow(req);
    const db = readDb();
    pruneAuth(db);
    const link = token ? db.magicLinks.find((l) => l.id === sha256(token)) : null;
    if (!link || !flow || flow.token !== link.id) {
      return res.status(400).json({ error: 'Session d’inscription invalide ou expirée' });
    }
    const lead = db.leads.find((l) => l.id === link.leadId);
    if (!lead) return res.status(404).json({ error: 'Compte introuvable' });

    const verification = await sw.verifyRegistrationResponse({
      response: response,
      expectedChallenge: flow.challenge,
      expectedOrigin: originOf(req),
      expectedRPID: rpIDOf(req),
      requireUserVerification: false
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey non vérifié' });
    }

    const cred = verification.registrationInfo.credential;
    lead.passkeys = lead.passkeys || [];
    lead.passkeys.push({
      id: cred.id,
      publicKey: Buffer.from(cred.publicKey).toString('base64url'),
      counter: cred.counter || 0,
      transports: cred.transports || [],
      cree: nowISO(),
      appareil: (req.get('user-agent') || '').slice(0, 180)
    });
    link.utilise = true;
    lead.passkeyCree = nowISO();
    lead.statut = 'accepte';

    const sessionToken = createSession(db, lead, req);
    writeDb(db);
    flows.delete(getCookie(req, FLOW_COOKIE));
    clearCookie(res, req, FLOW_COOKIE);
    setCookie(res, req, SESSION_COOKIE, sessionToken, SESSION_TTL);
    res.json({ ok: true, redirect: redirectPostLogin(lead) });
  } catch (e) {
    console.error('complete-enrollment :', e.message);
    res.status(400).json({ error: 'Réponse WebAuthn invalide' });
  }
});

// 4) Connexion. Sans `response` : options (challenge). Avec : vérification de la signature.
app.post('/api/auth/login', async (req, res) => {
  try {
    const body = req.body || {};

    if (!body.response) {
      const options = await sw.generateAuthenticationOptions({
        rpID: rpIDOf(req),
        userVerification: 'preferred',
        allowCredentials: []   // passkeys découvrables : l'appareil choisit le compte
      });
      const flow = newFlow(options.challenge);
      setCookie(res, req, FLOW_COOKIE, flow, FLOW_TTL);
      return res.json({ ok: true, options: options });
    }

    const flow = readFlow(req);
    if (!flow) return res.status(400).json({ error: 'Session de connexion expirée' });
    const db = readDb();
    pruneAuth(db);

    const credId = String(body.response.id || '');
    let lead = null;
    let passkey = null;
    for (const l of db.leads) {
      const k = (l.passkeys || []).find((x) => x.id === credId);
      if (k) { lead = l; passkey = k; break; }
    }
    if (!lead || !passkey) return res.status(401).json({ error: 'Passkey inconnu' });

    const verification = await sw.verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: flow.challenge,
      expectedOrigin: originOf(req),
      expectedRPID: rpIDOf(req),
      credential: {
        id: passkey.id,
        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
        counter: passkey.counter || 0,
        transports: passkey.transports || []
      },
      requireUserVerification: false
    });
    if (!verification.verified) return res.status(401).json({ error: 'Signature invalide' });

    passkey.counter = verification.authenticationInfo.newCounter;
    lead.connexions = lead.connexions || [];
    lead.connexions.push({
      at: nowISO(), ip: clientIp(req), ua: (req.get('user-agent') || '').slice(0, 200)
    });
    lead.derniereConnexion = nowISO();

    const sessionToken = createSession(db, lead, req);
    writeDb(db);
    flows.delete(getCookie(req, FLOW_COOKIE));
    clearCookie(res, req, FLOW_COOKIE);
    setCookie(res, req, SESSION_COOKIE, sessionToken, SESSION_TTL);
    res.json({ ok: true, redirect: redirectPostLogin(lead) });
  } catch (e) {
    console.error('login :', e.message);
    res.status(400).json({ error: 'Connexion impossible' });
  }
});

// 5) Profil protégé + déconnexion.
app.get('/api/auth/me', requireAuth, (req, res) => {
  const aUnBien = req.db.biens.some((b) =>
    b.leadId === req.lead.id || (b.email || '').toLowerCase() === (req.lead.email || '').toLowerCase()
  );
  const membre = publicLead(req.lead);
  membre.typeMembre = aUnBien ? 'membre_vendeur' : 'membre_acheteur';
  membre.dossierEnvoye = req.db.tasks.some((t) => t.leadId === req.lead.id && t.statut === 'en_attente');
  res.json({
    ok: true,
    membre: membre,
    session: { cree: req.session.cree, expire: req.session.expire }
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) {
    const db = readDb();
    db.sessions = db.sessions.filter((s) => s.id !== sha256(token));
    writeDb(db);
  }
  clearCookie(res, req, SESSION_COOKIE);
  res.json({ ok: true });
});

/* =====================================================================
   Espace membre — documents, photos, visibilité + endpoints CRM
   ===================================================================== */

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
    cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Format non autorisé (JPG, PNG, WEBP ou PDF)'), ok);
  }
});

// Les photos des biens restent publiques (emails, catalogue), mais une pièce
// d'identité, un justificatif de financement ou un titre de propriété n'est
// servi qu'à son propriétaire et à l'agence.
app.use('/uploads', (req, res, next) => {
  const fichier = '/uploads/' + path.basename(decodeURIComponent(req.path || ''));
  const db = readDb();
  const titulaire = db.leads.find((l) => (l.documents || []).some((d) => d.fichier === fichier));
  if (!titulaire) return next();
  const token = getCookie(req, SESSION_COOKIE);
  const session = token ? db.sessions.find((x) => x.id === sha256(token)) : null;
  const lecteur = session ? db.leads.find((l) => l.id === session.leadId) : null;
  if (lecteur && (lecteur.id === titulaire.id || ROLES_STAFF.indexOf(roleOf(lecteur)) > -1)) {
    res.setHeader('Cache-Control', 'private, no-store');
    return next();
  }
  return res.status(404).send('Introuvable');
});
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));
app.use('/vendor/simplewebauthn', express.static(path.join(__dirname, 'node_modules/@simplewebauthn/browser/esm')));

const TYPES_DOC = {
  identite: 'Pièce d’identité',
  financement: 'Justificatif de financement',
  bien: 'Titre de propriété'
};

// Consulter « mon bien » ne crée rien (un acquéreur seul n'a pas de bien) :
// le brouillon n'est créé que quand le membre agit sur son bien (creer = true).
function bienDuMembre(db, lead, creer) {
  let b = db.biens.find((x) => !x.archive && (x.leadId === lead.id || (lead.email && (x.email || '').toLowerCase() === (lead.email || '').toLowerCase())));
  if (!b && creer === false) return null;
  if (!b) {
    b = {
      id: uid('mb'), leadId: lead.id, email: lead.email,
      nom: ((lead.prenom || '') + ' ' + (lead.nom || '')).trim(),
      titre: '', adresse: '', codePostal: '', ville: '', type: 'Appartement', quartier: '',
      transaction: 'Vente',
      surface: 0, pieces: 0, chambres: 0, sdb: 0, etage: '', ascenseur: false,
      anneeConstruction: 0, etat: '', dpe: '', ges: '',
      exterieur: '', surfaceExterieur: 0, annexes: [], prix: 0, charges: 0, description: '',
      photos: [], atouts: [], exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon', statutDemande: null,
      agent: DEFAULT_AGENT_NOM, cree: nowISO()
    };
    db.biens.push(b);
    writeDb(db);
  }
  b.photos = Array.isArray(b.photos) ? b.photos : [];
  return b;
}

// Lire la recherche d'un membre ne la crée jamais : un vendeur seul n'a pas de
// recherche (acquéreur = recherche, vendeur = bien). Sans recherche, on renvoie
// une fiche vide non enregistrée ; elle n'est créée que si le membre enregistre
// réellement des critères (creer = true).
function rechercheDuMembre(db, lead, creer) {
  let r = db.recherches.find((x) => x.clientId === lead.id && !x.archive);
  if (!r && !creer) {
    return { id: null, clientId: lead.id, leadId: lead.id, titre: '', types: [], type: '', quartiers: [], prixMax: 0, piecesMin: 0, surfaceMin: 0, surfaceMax: 0, delai: '', apport: 0, financement: '', courtier: false, bienAVendre: false, etageMin: 0, etageMax: 0, etat: '', dpe: '', annexes: [], prixVenteEstime: 0, statut: 'active', alertes: true };
  }
  if (!r) {
    r = { id: uid('r'), clientId: lead.id, leadId: lead.id, titre: 'Recherche de ' + ((lead.prenom || '') + ' ' + (lead.nom || '')).trim(), types: [], type: '', quartiers: [], prixMax: 0, piecesMin: 0, surfaceMin: 0, surfaceMax: 0, delai: '', apport: 0, financement: '', courtier: false, bienAVendre: false, etageMin: 0, etageMax: 0, etat: '', dpe: '', annexes: [], prixVenteEstime: 0, statut: 'active', alertes: true, cree: nowISO() };
    db.recherches.push(r);
    writeDb(db);
  }
  return r;
}

function completionBien(b) {
  const v = (x) => (typeof x === 'string' ? x.trim() : x);
  const items = [
    !!v(b.type), !!v(b.transaction), !!v(b.titre), !!v(b.description),
    !!v(b.adresse), !!v(b.ville), !!v(b.codePostal), !!v(b.quartier),
    Number(b.surface) > 0, Number(b.pieces) > 0,
    !!v(b.etage), !!v(b.etat), Number(b.anneeConstruction) > 0, !!v(b.dpe), !!v(b.ges),
    Number(b.prix) > 0, (Array.isArray(b.photos) ? b.photos.length : 0) >= 3
  ];
  const filled = items.filter(Boolean).length;
  const pct = Math.round((filled / items.length) * 100);
  return { pct: pct, complet: pct === 100 };
}

async function normaliserAdresse(bien) {
  const q = [bien.adresse, bien.codePostal, bien.ville].filter(Boolean).join(' ');
  if (!q) return bien;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(q) + '&limit=1', { headers: { accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return bien;
    const data = await r.json();
    const feat = (data.features && data.features[0]) || null;
    if (!feat) return bien;
    const p = feat.properties || {};
    const geom = (feat.geometry && feat.geometry.coordinates) || [];
    if (p.citycode) bien.insee = p.citycode;
    if (p.postcode) bien.codePostal = p.postcode;
    if (p.city) bien.ville = p.city;
    if (geom.length >= 2) { bien.lon = geom[0]; bien.lat = geom[1]; }
  } catch (e) { /* BAN indisponible : on continue sans géocodage */ }
  return bien;
}

const SITES_IMMO = 'site:leboncoin.fr OR site:seloger.com OR site:bienici.com OR site:pap.fr OR site:logic-immo.com OR site:figaroimmo.fr OR site:avendrealouer.fr OR site:paruvendu.fr OR site:superimmo.com OR site:goflint.fr OR site:bazzile.com OR site:ouestfrance-immo.com OR site:immobilier.notaires.fr OR site:green-acres.fr OR site:acheter-louer.fr OR site:entreparticuliers.com OR site:maisons-travaux.com OR site:jinka.fr OR site:moteurimmo.fr OR site:bellesdemeures.com OR site:properties.lefigaro.com OR site:jamesedition.com OR site:lux-residence.com OR site:luxuryestate.com OR site:barnes-international.com OR site:engelvoelkers.com OR site:danielfeau.com OR site:sothebysrealty.com OR site:john-taylor.com OR site:knightfrank.fr OR site:junot.fr OR site:emilegarcin.com OR site:patrice-besse.com OR site:christiesrealestate.com OR site:coldwellbanker.fr OR site:century21.fr OR site:orpi.com OR site:laforet.com OR site:foncia.com OR site:citya-immobilier.com OR site:guy-hoquet.com OR site:capifrance.fr OR site:vaneau.com OR site:sextant-france.com';

const ACTEUR_GOOGLE_SEARCH = 'apify~google-search-scraper';

function construireRequete(bien) {
  const adresse = (bien.adresse || bien.ville || '').trim();
  const parts = [];
  if (adresse) parts.push('"' + adresse + '"');
  if (bien.surface) parts.push('"' + bien.surface + ' m2"');
  parts.push('(' + SITES_IMMO + ')');
  return parts.join(' ');
}

function lienDe(item) {
  return item.url || item.link || item.permalinkUrl || item.detailUrl || item.url_detail || null;
}

function surfaceDe(item) {
  const v = item.surface || item.surface_area || item.area || item.m2 || item.surface_m2 || item.surfaceM2 || item.livingArea;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function texteDe(item) {
  return [item.title, item.adresse, item.address, item.city, item.ville, item.location, item.description].filter(Boolean).map(String).join(' ').toLowerCase();
}

function correspondAuBien(bien, item) {
  const bienSurf = Number(bien.surface) || 0;
  const itemSurf = surfaceDe(item);
  if (bienSurf && itemSurf) return Math.abs(itemSurf - bienSurf) <= 5;
  const cible = [bien.adresse, bien.codePostal, bien.ville].filter(Boolean).join(' ').toLowerCase();
  const tokens = cible.split(/\s+/).filter((t) => t.length >= 3);
  if (!tokens.length) return true;
  const texte = texteDe(item);
  return tokens.some((t) => texte.indexOf(t) > -1);
}

async function lancerActorApify(actorId, input, token) {
  const run = await fetch('https://api.apify.com/v2/acts/' + actorId + '/runs?token=' + encodeURIComponent(token), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!run.ok) {
    const txt = await run.text().catch(() => '');
    throw new Error('Apify ' + actorId + ' : HTTP ' + run.status + (txt ? ' — ' + txt.slice(0, 180) : ''));
  }
  const runData = await run.json();
  const runId = runData.data && runData.data.id;
  if (!runId) throw new Error('Apify ' + actorId + ' : id de run introuvable');

  let status = (runData.data && runData.data.status) || 'RUNNING';
  for (let i = 0; i < 40 && ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].indexOf(status) === -1; i++) {
    await new Promise((s) => setTimeout(s, 3000));
    const sr = await fetch('https://api.apify.com/v2/actor-runs/' + runId + '?token=' + encodeURIComponent(token));
    const sd = await sr.json();
    status = sd.data && sd.data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error('Apify ' + actorId + ' : run ' + status);

  const ds = await fetch('https://api.apify.com/v2/actor-runs/' + runId + '/dataset/items?token=' + encodeURIComponent(token));
  const items = await ds.json();
  return Array.isArray(items) ? items : [];
}

async function rechercherAnnonces(bien) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN manquant dans le .env');

  const input = {
    queries: construireRequete(bien),
    resultsPerPage: 100,
    maxPagesPerQuery: 1,
    languageCode: 'fr',
    countryCode: 'fr'
  };

  const items = await lancerActorApify(ACTEUR_GOOGLE_SEARCH, input, token);

  const liens = [];
  const ajouter = (obj) => {
    if (!obj || !correspondAuBien(bien, obj)) return;
    const lien = lienDe(obj) || obj.displayedUrl || null;
    if (lien && liens.indexOf(lien) === -1) liens.push(lien);
  };
  items.forEach((item) => {
    if (item && Array.isArray(item.organicResults)) item.organicResults.forEach(ajouter);
    else ajouter(item);
  });
  return liens.slice(0, 30);
}

async function lancerScanExclusivite(bienId) {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === bienId);
  if (!bien) return null;
  const ex = bien.exclusivite || { statut: 'scan_en_cours', liens: [] };
  ex.statut = 'scan_en_cours';
  ex.liens = [];
  bien.exclusivite = ex;
  writeDb(db);

  try {
    const liens = await rechercherAnnonces(bien);
    ex.statut = liens.length ? 'alerte_doublon' : 'verifie_exclusif';
    ex.liens = liens;
    ex.scanneAt = nowISO();
    if (ex.statut === 'verifie_exclusif') {
      logActivite(db, { leadId: bien.leadId, bienId: bien.id, type: 'admissible', auteur: 'Système' });
    }
  } catch (e) {
    ex.statut = 'scan_en_cours';
    ex.erreur = (e && e.message) || 'Scan impossible';
  }
  bien.exclusivite = ex;
  writeDb(db);
  return ex;
}

// Même convention de libellé que le QUARTIERS de crm.js (agent), pour que le
// catalogue membre (app.js) affiche "Paris 4ᵉ" etc. sans dupliquer de données
// de référence incohérentes entre le CRM et la plateforme.
const QUARTIERS_LABELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  .reduce((acc, n) => { acc['p' + n] = 'Paris ' + n + (n === 1 ? 'ᵉʳ' : 'ᵉ'); return acc; }, {});
QUARTIERS_LABELS.boulogne = 'Boulogne-Billancourt';
QUARTIERS_LABELS.neuilly = 'Neuilly-sur-Seine';
QUARTIERS_LABELS.vincennes = 'Vincennes';
function labelQuartier(q) { return QUARTIERS_LABELS[q] || ''; }

// ---- Prix net vendeur / prix honoraires inclus (HAI) ----
// bien.prix est TOUJOURS le prix net vendeur (ce que le propriétaire touche).
// Le prix HAI est calculé ici, côté serveur, au moment de répondre : le
// propriétaire et le CRM voient le net, les autres membres ne reçoivent que le
// HAI (le net ne sort jamais dans /api/catalogue). Honoraires à la charge de
// l'acquéreur, calculés sur le net vendeur (cf. assiette du mandat de recherche).
function pasArrondiHai() {
  const n = Number(process.env.AGENCE_ARRONDI_HAI || 1);
  return n > 0 ? n : 1;
}
function tauxValide(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) || n < 0 || n > 20 ? null : Math.round(n * 100) / 100;
}
// Taux applicable à un acquéreur : taux propre au bien s'il a été fixé dans le
// CRM, sinon le barème de l'agence. Le taux réduit (3 %) ne s'applique qu'à un
// membre dont le bien a été VENDU par nous — être simplement acquéreur et
// vendeur ne suffit pas. Jamais plus que le taux du bien.
function aVenduChezNous(db, lead) {
  if (!db || !lead) return false;
  return (db.biens || []).some((b) => b.leadId === lead.id && b.statut === 'vendu' && b.venduParAgence === true);
}
function tauxHonorairesPour(bien, lead, reduit) {
  const a = agence();
  const propre = tauxValide(bien && bien.tauxHonoraires);
  const base = propre != null ? propre : a.tauxAcquereur;
  return reduit ? Math.min(base, a.tauxMixte) : base;
}
function prixHai(net, taux) {
  const n = Number(net) || 0;
  if (!n) return 0;
  const pas = pasArrondiHai();
  return Math.round((n * (1 + (Number(taux) || 0) / 100)) / pas) * pas;
}
function mentionHonoraires(taux) {
  return 'Honoraires inclus : dont ' + String(taux).replace('.', ',') + ' % TTC à la charge de l’acquéreur, calculés sur le prix net vendeur.';
}
// Toute modification du prix net laisse une trace (date, ancien, nouveau, auteur).
function changerPrixNet(bien, nouveau, auteur, source) {
  const n = Math.max(0, Math.round(Number(nouveau) || 0));
  const avant = Number(bien.prix) || 0;
  if (n === avant) return false;
  bien.prix = n;
  bien.historiquePrix = (Array.isArray(bien.historiquePrix) ? bien.historiquePrix : []).concat([
    { at: nowISO(), ancien: avant, nouveau: n, auteur: auteur || '', source: source || '' }
  ]).slice(-50);
  return true;
}
// Champs prix ajoutés aux biens renvoyés au CRM (vue agent : net + HAI standard).
function prixPourCrm(b) {
  const taux = tauxHonorairesPour(b, null);
  return Object.assign({}, b, {
    prixNet: b.prix || 0, tauxHonoraires: tauxValide(b.tauxHonoraires), tauxApplique: taux,
    tauxReduit: Math.min(taux, agence().tauxMixte), prixHai: prixHai(b.prix, taux),
    prixHaiReduit: prixHai(b.prix, Math.min(taux, agence().tauxMixte))
  });
}

function bienPublic(b) {
  const c = completionBien(b);
  const tauxStd = tauxHonorairesPour(b, null);
  return {
    id: b.id, titre: b.titre || '', adresse: b.adresse || '', codePostal: b.codePostal || '', ville: b.ville || '',
    type: b.type || 'Appartement', quartier: b.quartier || '', label: labelQuartier(b.quartier), transaction: b.transaction || 'Vente',
    surface: b.surface || 0, pieces: b.pieces || 0, chambres: b.chambres != null ? b.chambres : 0, sdb: b.sdb != null ? b.sdb : 0,
    etage: b.etage != null ? b.etage : '', ascenseur: !!b.ascenseur, anneeConstruction: b.anneeConstruction || 0,
    dpe: b.dpe || '', ges: b.ges || '', etat: b.etat || '',
    exterieur: b.exterieur || '', surfaceExterieur: b.surfaceExterieur || 0,
    annexes: Array.isArray(b.annexes) ? b.annexes : [], prix: b.prix || 0, charges: b.charges || 0,
    prixNet: b.prix || 0, prixHai: prixHai(b.prix, tauxStd), tauxHonoraires: tauxStd,
    historiquePrix: Array.isArray(b.historiquePrix) ? b.historiquePrix : [],
    description: b.description || '', photos: b.photos || [], statut: b.statut || 'brouillon',
    coupDeCoeur: b.coupDeCoeur || '',
    video: b.video && b.video.publie && b.video.url ? { url: b.video.url, type: b.video.type || 'video/mp4' } : null,
    videoVerticale: b.videoVerticale && b.videoVerticale.publie && b.videoVerticale.url ? { url: b.videoVerticale.url, type: b.videoVerticale.type || 'video/mp4' } : null,
    visite: b.visite && b.visite.publie && Array.isArray(b.visite.etapes) && b.visite.etapes.length ? { etapes: b.visite.etapes.map((e) => ({ piece: e.piece || '', image: e.image, mode: e.mode === '360' ? '360' : 'photo' })) } : null,
    editorial: b.editorial && b.editorial.publie && b.editorial.texte ? { titre: b.editorial.titre || '', texte: b.editorial.texte } : null,
    statutDemande: b.statutDemande || null, cree: b.cree || null,
    suiveurs: Number(b.suiveurs) || 0,
    completion: c.pct, complet: c.complet,
    exclusivite: b.exclusivite || { statut: 'scan_en_cours', liens: [] },
    validation: b.validation || 'en_attente',
    insee: b.insee || '', lat: b.lat || null, lon: b.lon || null
  };
}

// Version catalogue d'un bien, vue par les AUTRES membres : ni adresse exacte
// ni coordonnées GPS. L'adresse n'est communiquée qu'à la confirmation d'une
// visite (mandat signé + validation de l'agent), par email et WhatsApp.
// Le prix renvoyé est le prix HAI calculé pour CE membre (taux réduit s'il a
// vendu son bien chez nous). Ni le net, ni le taux, ni le montant des
// honoraires ne sont transmis : l'acquéreur ne voit que le prix HAI.
const SEUIL_POPULARITE = Number(process.env.SEUIL_POPULARITE || 5);
function bienCatalogue(b, lead, reduit) {
  const p = bienPublic(b);
  delete p.adresse;
  delete p.lat;
  delete p.lon;
  p.adresseMasquee = true;
  const taux = tauxHonorairesPour(b, lead, reduit);
  p.prix = prixHai(b.prix, taux);
  p.honoraires = { inclus: true };
  if (process.env.AGENCE_AFFICHER_PRIX_NET === '1') {
    p.honoraires.mention = mentionHonoraires(taux);
    p.honoraires.prixHorsHonoraires = b.prix || 0;
  }
  // Popularité : on ne la montre qu'à partir d'un seuil, pour ne jamais
  // desservir un bien peu suivi (« suivi par 1 membre »).
  if (p.suiveurs < SEUIL_POPULARITE) p.suiveurs = 0;
  delete p.prixNet;
  delete p.prixHai;
  delete p.tauxHonoraires;
  delete p.historiquePrix;
  return p;
}

function nomComplet(lead) {
  return ((lead.prenom || '') + ' ' + (lead.nom || '')).trim() || lead.email || 'Membre';
}

// ---- Mon bien (membre connecté) ----
app.get('/api/mon-bien', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead, false);
  res.json({ ok: true, bien: b ? bienPublic(b) : null });
});

// ---- Catalogue (membres) : biens validés en CRM, visibles sur la plateforme ----
// Avant cette route, le catalogue côté plateforme (espace.html/app.js) ne
// montrait que des données de démonstration codées en dur, sans aucun lien
// avec les biens réellement saisis et validés dans le CRM : un bien marqué
// "validé" par un agent ne pouvait jamais apparaître ici.
// Suivre / ne plus suivre un bien du catalogue. Le compteur bien.suiveurs est
// partagé (tous les membres) ; la liste des biens suivis reste propre au membre.
app.post('/api/suivis/:bienId', requireAuth, (req, res) => {
  const db = req.db;
  const b = db.biens.find((x) => x.id === req.params.bienId);
  if (!bienSurPlateforme(b)) {
    return res.status(404).json({ error: 'Bien introuvable.' });
  }
  if (b.leadId === req.lead.id) return res.status(400).json({ error: 'C’est votre bien.' });
  const suivis = Array.isArray(req.lead.suivis) ? req.lead.suivis : [];
  const deja = suivis.indexOf(b.id) > -1;
  req.lead.suivis = deja ? suivis.filter((x) => x !== b.id) : suivis.concat([b.id]);
  b.suiveurs = Math.max(0, (Number(b.suiveurs) || 0) + (deja ? -1 : 1));
  if (!deja) logActivite(db, { leadId: b.leadId, bienId: b.id, type: 'bien_suivi', auteur: nomComplet(req.lead) });
  writeDb(db);
  res.json({ ok: true, suivi: !deja, suivis: req.lead.suivis, suiveurs: b.suiveurs >= SEUIL_POPULARITE ? b.suiveurs : 0 });
});

// Étapes de découverte vues par le membre (fenêtre de bienvenue, visite guidée).
app.post('/api/membre/onboarding', requireAuth, (req, res) => {
  const etape = String((req.body && req.body.etape) || '');
  if (['bienvenue', 'visite'].indexOf(etape) === -1) return res.status(400).json({ error: 'Étape inconnue.' });
  req.lead.onboarding = Object.assign({}, req.lead.onboarding || {}, { [etape]: nowISO() });
  writeDb(req.db);
  res.json({ ok: true, onboarding: req.lead.onboarding });
});

// Une fois : ville des biens importés nettoyée (champs du fichier collés
// derrière), nombre de lots récupéré, titres de « Texte de la fiche » refaits.
setTimeout(() => {
  try {
    const db = readDb();
    db.migrations = db.migrations || {};
    if (db.migrations.villesImport) return;
    let n = 0;
    (db.biens || []).forEach((b) => {
      if (!b.importLot) return;
      const v = String(b.ville || '');
      const lots = v.match(/Nombre de lots dans la copropri[ée]t[ée]\s*(\d+)/i);
      if (lots) { b.details = b.details || {}; if (!b.details.lotsCopropriete) b.details.lotsCopropriete = Number(lots[1]); }
      const arr = /^750(\d\d)$/.test(String(b.codePostal || '')) ? Number(String(b.codePostal).slice(3)) : 0;
      const propre = arr ? 'Paris ' + arr + (arr === 1 ? 'er' : 'e') : villePropre(v, b.codePostal);
      if (propre && propre !== v) { b.ville = propre; n++; }
      b.adresse = String(b.adresse || '').split(/\s+[—–]\s+/)[0].trim();
      if (b.editorial && b.editorial.auteur === 'Import') b.editorial.titre = titreEditorialImport(b);
    });
    db.migrations.villesImport = { le: nowISO(), biens: n };
    writeDb(db);
    console.log('[biens] villes nettoyées : ' + n);
  } catch (e) { console.error('[biens] villes', e.message); }
}, 5000);

// Une fois (demandé par l'agence) : les biens importés dont la vente est
// confirmée (vente DVF après le début du mandat ET annonce retirée du site de
// l'agence) passent « Vendu », vente faite par une autre agence. Rien n'est
// supprimé. Attend que le contrôle DVF et le bot aient tourné.
setTimeout(() => {
  try {
    const db = readDb();
    db.migrations = db.migrations || {};
    if (db.migrations.vendusConfirmes1) return;
    const ids = [];
    (db.biens || []).forEach((b) => {
      if (!b.importLot || b.statut === 'vendu') return;
      const d = b.verifs && b.verifs.dvf;
      const vente = d && d.statut === 'vendu_probable' && (d.ventes || []).find((v) => v.apresMandat);
      if (!vente || !(b.suiviAgence && b.suiviAgence.statut === 'retire')) return;
      b.statut = 'vendu'; b.venduParAgence = false; b.venduLe = vente.date; b.venteConstatee = { source: 'DVF + annonce retirée', date: vente.date, prix: vente.prix, le: nowISO() };
      if (b.leadId) logActivite(db, { leadId: b.leadId, bienId: b.id, type: 'bien_vendu_ailleurs', auteur: 'Bot de suivi', detail: 'Vendu le ' + vente.date + ' (' + vente.prix + ' €, DVF) par une autre agence' });
      ids.push(b.id);
    });
    if (!ids.length && !(db.suiviAgence && db.suiviAgence.le)) return; // le bot n'a pas encore tourné : on réessaiera
    db.migrations.vendusConfirmes1 = { le: nowISO(), biens: ids };
    writeDb(db);
    console.log('[biens] ' + ids.length + ' bien(s) importé(s) passés « Vendu » (vente confirmée)');
  } catch (e) { console.error('[biens] vendus confirmés', e.message); }
}, 20000);

// Une fois : titres sans adresse. Biens importés : le titre de « Texte de la
// fiche » est refait (s'il n'a pas été retouché à la main). Biens sans titre :
// on leur en donne un, construit de la même façon.
setTimeout(() => {
  try {
    const db = readDb();
    db.migrations = db.migrations || {};
    if (db.migrations.titresSansAdresse) return;
    let edit = 0, vides = 0;
    (db.biens || []).forEach((b) => {
      if (b.importLot && b.editorial && b.editorial.auteur === 'Import') { b.editorial.titre = titreEditorialImport(b); edit++; }
      if (!String(b.titre || '').trim() || /^bien sans titre$/i.test(String(b.titre).trim())) { b.titre = titreEditorialImport(b); vides++; }
    });
    db.migrations.titresSansAdresse = { le: nowISO(), editoriaux: edit, titres: vides };
    writeDb(db);
    console.log('[biens] titres sans adresse : ' + edit + ' texte(s) de fiche, ' + vides + ' bien(s) sans titre');
  } catch (e) { console.error('[biens] titres', e.message); }
}, 6000);

// Une fois : biens validés dans le CRM et « Sur Seecret » activé, mais restés
// invisibles des membres (créés directement en Avant-première sans validation,
// ou validés mais laissés en préparation). Aucun email n'est envoyé.
setTimeout(() => {
  try {
    const db = readDb();
    db.migrations = db.migrations || {};
    if (db.migrations.visibilite3) return;
    const ids = [];
    (db.biens || []).forEach((b) => {
      if (b.importLot || b.surSeecret !== true) return;
      const enLigne = b.statut === 'avant-premiere' || b.statut === 'ouvert';
      if (enLigne && b.validation !== 'valide') { b.validation = 'valide'; b.valideAt = b.valideAt || nowISO(); ids.push(b.id); }
      else if (b.validation === 'valide' && ['brouillon', 'a_valider', ''].indexOf(b.statut || '') > -1) { b.statut = 'avant-premiere'; ids.push(b.id); }
    });
    db.migrations.visibilite3 = { le: nowISO(), biens: ids };
    writeDb(db);
    if (ids.length) console.log('[biens] ' + ids.length + ' bien(s) validé(s) rendus visibles sur la plateforme');
  } catch (e) { console.error('[biens] migration visibilité', e.message); }
}, 4000);

// Une fois : statuts des biens alignés sur le parcours vendeur.
// « Mandat signé » disparaît (le seul mandat est le mandat de recherche de
// l'acquéreur) ; un bien publié par le vendeur mais pas encore validé passe
// « À valider » ; un bien que l'agent a mis en ligne depuis le CRM (Sur Seecret
// activé) mais jamais validé devient visible, comme il l'attendait.
setTimeout(() => {
  try {
    const db = readDb();
    db.migrations = db.migrations || {};
    if (db.migrations.statutsBien2) return;
    let n = 0;
    (db.biens || []).forEach((b) => {
      if (b.statut === 'mandat') { b.statut = 'brouillon'; n++; }
      else if (b.statut === 'avant-premiere' && b.validation !== 'valide' && b.surSeecret !== true) { b.statut = 'a_valider'; n++; }
      else if ((b.statut === 'avant-premiere' || b.statut === 'ouvert') && b.validation !== 'valide' && b.surSeecret === true) { b.validation = 'valide'; b.valideAt = nowISO(); n++; }
    });
    db.migrations.statutsBien2 = nowISO();
    writeDb(db);
    console.log('[biens] statuts alignés sur le parcours vendeur : ' + n + ' bien(s) mis à jour');
  } catch (e) { console.error('[biens] migration statuts :', e.message); }
}, 5000);

// ---------------- Vidéo « home tour » ----------------
// La vidéo verticale est fabriquée dans le navigateur de l'agent (CRM) à
// partir des photos du bien, puis envoyée ici. Une seule vidéo par bien :
// la précédente est supprimée du disque.
const VIDEO_MAX = 80 * 1024 * 1024;
function supprimerVideoFichier(v) {
  if (!v || !v.url || !/^\/uploads\/video-[\w-]+\.(mp4|webm)$/.test(v.url)) return;
  // (formats horizontal et vertical : même dossier, même règle)
  try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(v.url))); } catch (e) { /* déjà supprimée */ }
}
// Deux formats par bien : horizontal (16:9, fiche du bien sur la plateforme)
// et vertical (9:16, réseaux sociaux de l'agent et page « Vidéos » à faire
// défiler). ?format=vertical choisit le second ; par défaut, horizontal.
const champVideo = (req) => (String(req.query.format || '') === 'vertical' ? 'videoVerticale' : 'video');
app.post('/api/biens/:id/video', requireAdmin, express.raw({ type: ['video/mp4', 'video/webm'], limit: VIDEO_MAX }), (req, res) => {
  const type = String(req.headers['content-type'] || '').split(';')[0];
  if (['video/mp4', 'video/webm'].indexOf(type) === -1 || !Buffer.isBuffer(req.body) || req.body.length < 1000) {
    return res.status(400).json({ error: 'Vidéo invalide (MP4 ou WebM attendu).' });
  }
  // Disque gratuit limité : on garde de la marge pour la base des membres.
  const libre = placeLibreMo();
  if (libre !== null && libre - req.body.length / 1048576 < 80) return res.status(507).json({ error: 'Plus assez de place sur le disque du site (' + libre + ' Mo libres) pour enregistrer cette vidéo.' });
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  const champ = champVideo(req);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const nom = 'video-' + String(b.id).replace(/[^\w-]/g, '') + (champ === 'videoVerticale' ? '-v' : '') + '-' + crypto.randomBytes(6).toString('hex') + (type === 'video/mp4' ? '.mp4' : '.webm');
  fs.writeFileSync(path.join(UPLOADS_DIR, nom), req.body);
  supprimerVideoFichier(b[champ]);
  const options = (() => { try { return JSON.parse(String(req.query.options || '{}')); } catch (e) { return {}; } })();
  b[champ] = { url: '/uploads/' + nom, type: type, taille: req.body.length, cree: nowISO(), auteur: nomComplet(req.lead), publie: String(req.query.publier || '1') === '1', format: champ === 'videoVerticale' ? 'vertical' : 'horizontal', options: options };
  writeDb(db);
  res.json({ ok: true, video: b[champ], champ: champ });
});
app.patch('/api/biens/:id/video', requireAdmin, (req, res) => {
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  const champ = champVideo(req);
  if (!b || !b[champ]) return res.status(404).json({ error: 'Aucune vidéo pour ce bien.' });
  b[champ].publie = !!(req.body && req.body.publie);
  writeDb(db);
  res.json({ ok: true, video: b[champ], champ: champ });
});
app.delete('/api/biens/:id/video', requireAdmin, (req, res) => {
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  const champ = champVideo(req);
  supprimerVideoFichier(b[champ]);
  delete b[champ];
  writeDb(db);
  res.json({ ok: true, champ: champ });
});
// Une fois : les vidéos créées avant les deux formats étaient verticales.
setTimeout(() => {
  try {
    const db = readDb(); db.migrations = db.migrations || {};
    if (db.migrations.videosFormats) return;
    let n = 0;
    (db.biens || []).forEach((b) => { if (b.video && !b.video.format && !b.videoVerticale) { b.videoVerticale = Object.assign({}, b.video, { format: 'vertical' }); delete b.video; n++; } });
    db.migrations.videosFormats = nowISO(); writeDb(db);
    if (n) console.log('[vidéos] ' + n + ' vidéo(s) verticale(s) rangée(s) dans le format réel');
  } catch (e) { console.error('[vidéos] migration :', e.message); }
}, 6000);
// Page « Vidéos » de la plateforme : les vidéos verticales publiées des biens visibles.
app.get('/api/videos', requireAuth, (req, res) => {
  const db = readDb();
  const liste = db.biens.filter((b) => bienSurPlateforme(b) && b.videoVerticale && b.videoVerticale.publie && b.videoVerticale.url)
    .sort((a, b) => String(b.videoVerticale.cree).localeCompare(String(a.videoVerticale.cree)))
    .map((b) => ({ id: b.id, url: b.videoVerticale.url, type: b.videoVerticale.type, titre: (b.editorial && b.editorial.publie && b.editorial.titre) || b.titre || '', quartier: labelQuartier(b.quartier) || b.ville || '', statut: b.statut, surface: b.surface || 0, pieces: b.pieces || 0, poster: (b.photos || [])[0] || '' }));
  res.json({ ok: true, videos: liste });
});

// ---------------- Sectorisation scolaire (Ville de Paris, open data) ----------------
// Maternelle, élémentaire et collège de secteur pour la position EXACTE du
// bien (secteurs officiels de la rentrée la plus récente). Les lycées
// parisiens ne sont pas sectorisés à l'adresse (affectation Affelnet).
// Côté membres, la sectorisation est réservée au propriétaire et aux
// visites confirmées : un secteur d'école élémentaire couvre quelques rues
// et dévoilerait l'adresse.
const ECOLES_CACHE = {};
const ECOLES_JEUX = { maternelle: 'secteurs-scolaires-maternelles', elementaire: 'secteurs-scolaires-ecoles-elementaires', college: 'secteurs-scolaires-colleges' };
function casse(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/(^|[\s'’(-])([a-zàâçéèêëîïôûùüÿñæœ])/g, (m, a, c) => a + c.toUpperCase())
    .replace(/\b(De|Du|Des|La|Le|Les|Et|D'|L')\b/g, (m) => m.toLowerCase()).replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(Rue|Avenue|Boulevard|Place|Quai|Impasse|Passage|Square|Cité|Villa|Allée)\b/g, (m) => m.toLowerCase());
}
// « QUATRE FILS 10 B ELEM - DANIEL CORDIER » + « 10 bis RUE DES QUATRE FILS »
//   → « École élémentaire Daniel Cordier, 10 bis rue des Quatre Fils »
function nomEtablissement(lib, adr, type) {
  const brut = String(lib || '').replace(/\s+/g, ' ').trim();
  if (type === 'college') return 'Collège ' + casse(brut);
  const m = /^(.*?)\s+(\d+\s*(?:B(?:IS)?|T(?:ER)?)?)\s+(MAT|ELEM|POLY)\b\s*(?:-\s*(.*))?$/i.exec(brut);
  const genre = type === 'maternelle' ? 'École maternelle' : 'École élémentaire';
  if (!m) return genre + ' ' + casse(brut.replace(/\b(MAT|ELEM|POLY)\b/gi, ''));
  const nom = m[4] ? ' ' + casse(m[4]) : '';
  if (adr) return genre + nom + ', ' + casse(adr).replace(/ (Bis|Ter)\b/g, (x) => x.toLowerCase());
  if (adr === null) return genre + (nom || ' ' + casse(m[1])); // sans adresse : ni rue ni numéro
  return genre + (nom || ' ' + casse(m[1])) + ' (' + m[2].replace(/\s*B(IS)?$/i, ' bis').trim() + ')';
}
async function sectorisationEcoles(lat, lon, sansAdresse) {
  const cle = Number(lat).toFixed(5) + ',' + Number(lon).toFixed(5) + (sansAdresse ? '|sa' : '');
  if (ECOLES_CACHE[cle] && Date.now() - ECOLES_CACHE[cle].at < 7 * 24 * 3600 * 1000) return ECOLES_CACHE[cle].data;
  const point = "geom'POINT(" + Number(lon) + ' ' + Number(lat) + ")'";
  const out = { source: 'Ville de Paris — secteurs scolaires (open data)' };
  for (const type of Object.keys(ECOLES_JEUX)) {
    const url = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/' + ECOLES_JEUX[type] + '/records?' + new URLSearchParams({ where: 'intersects(geo_shape, ' + point + ')', order_by: 'annee_scol desc', limit: '1', select: 'lib_etab_1,lib_etab_2,adr_etab_1,adr_etab_2,annee_scol' }).toString();
    const r = await fetchAvecRetry(url, { headers: { Accept: 'application/json' } }, 2);
    if (!r.ok) throw new Error('Open data Paris HTTP ' + r.status);
    const x = ((await r.json()).results || [])[0];
    out[type] = x ? { etablissements: [[x.lib_etab_1, x.adr_etab_1], [x.lib_etab_2, x.adr_etab_2]].filter((e) => e[0]).map((e) => nomEtablissement(e[0], sansAdresse ? null : e[1], type)), annee: x.annee_scol || '' } : null;
  }
  ECOLES_CACHE[cle] = { at: Date.now(), data: out };
  return out;
}
function bienEstParis(b) { return /^75\d{3}$/.test(String(b.codePostal || '')) || /^p\d{1,2}$/.test(String(b.quartier || '')) || /paris/i.test(String(b.ville || '')); }
// Position du bien : celle enregistrée, sinon géocodage de son adresse
// (Base Adresse Nationale), mémorisé sur le bien.
async function positionBien(b) {
  if (b.lat && b.lon) return true;
  const adr = [b.adresse, b.codePostal, b.ville].filter(Boolean).join(' ').trim();
  if (!adr || !/\d/.test(b.adresse || '')) return false;
  try {
    const r = await fetch('https://api-adresse.data.gouv.fr/search/?' + new URLSearchParams({ q: adr, limit: '1' }).toString(), { signal: AbortSignal.timeout(8000) });
    const f = ((await r.json()).features || [])[0];
    if (!f || (f.properties && f.properties.score < 0.5)) return false;
    const db = readDb();
    const bb = db.biens.find((x) => x.id === b.id);
    if (bb) { bb.lat = f.geometry.coordinates[1]; bb.lon = f.geometry.coordinates[0]; writeDb(db); }
    b.lat = f.geometry.coordinates[1]; b.lon = f.geometry.coordinates[0];
    return true;
  } catch (e) { return false; }
}
async function repondreEcoles(res, b, sansAdresse) {
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  if (!bienEstParis(b)) return res.json({ ok: true, disponible: false, raison: 'La sectorisation automatique couvre Paris intra-muros.' });
  if (!(await positionBien(b))) return res.json({ ok: true, disponible: false, raison: 'Position du bien inconnue : renseignez son adresse exacte (numéro et rue).' });
  try {
    const e = await sectorisationEcoles(b.lat, b.lon, sansAdresse);
    if (!e.maternelle && !e.elementaire && !e.college) return res.json({ ok: true, disponible: false, raison: sansAdresse ? 'Écoles de secteur communiquées par votre agent.' : 'Aucun secteur scolaire trouvé à la position enregistrée : vérifiez l’adresse exacte du bien.' });
    res.json(Object.assign({ ok: true, disponible: true, sansAdresse: !!sansAdresse }, e));
  }
  catch (e) { res.status(502).json({ error: 'Secteurs scolaires indisponibles pour le moment.' }); }
}
app.get('/api/biens/:id/ecoles', requireAdmin, async (req, res) => {
  const db = readDb();
  await repondreEcoles(res, db.biens.find((x) => x.id === req.params.id));
});
app.get('/api/ecoles/:bienId', requireAuth, async (req, res) => {
  const db = req.db;
  const b = db.biens.find((x) => x.id === req.params.bienId);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  const proprietaire = b.leadId === req.lead.id;
  const visiteConfirmee = db.demandes.some((d) => d.type === 'visite' && d.leadId === req.lead.id && d.bienId === b.id && d.rdv);
  // Avant la visite : noms des écoles visibles, mais sans leurs adresses
  // (l'adresse du bien reste réservée aux visites confirmées).
  const complet = proprietaire || visiteConfirmee || ROLES_STAFF.indexOf(roleOf(req.lead)) > -1;
  await repondreEcoles(res, b, !complet);
});

// ---------------- Visite virtuelle (pas à pas + 360°) ----------------
// Une visite = une suite d'étapes (pièces) : soit une photo du bien (visite
// « pas à pas » : on avance d'une pièce à l'autre), soit un panorama 360°
// équirectangulaire (on tourne la tête dans la pièce). Les panoramas sont
// envoyés depuis le CRM ; le visionneur 360° (Pannellum, libre) est servi
// par le site lui-même.
const PANO_MAX = 30 * 1024 * 1024;
app.post('/api/biens/:id/panorama', requireAdmin, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: PANO_MAX }), (req, res) => {
  const type = String(req.headers['content-type'] || '').split(';')[0];
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'Panorama invalide (JPEG, PNG ou WebP).' });
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const nom = 'pano-' + String(b.id).replace(/[^\w-]/g, '') + '-' + crypto.randomBytes(6).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, nom), req.body);
  b.panoramas = (Array.isArray(b.panoramas) ? b.panoramas : []).concat(['/uploads/' + nom]).slice(-30);
  writeDb(db);
  res.json({ ok: true, url: '/uploads/' + nom });
});
app.put('/api/biens/:id/visite', requireAdmin, (req, res) => {
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  const body = req.body || {};
  const autorisees = new Set((b.photos || []).concat(b.panoramas || []));
  const etapes = (Array.isArray(body.etapes) ? body.etapes : []).slice(0, 25).map((e) => ({
    piece: String((e && e.piece) || '').trim().slice(0, 40), image: String((e && e.image) || ''), mode: e && e.mode === '360' ? '360' : 'photo'
  })).filter((e) => autorisees.has(e.image));
  const publie = !!body.publie;
  if (publie && etapes.length < 2 && !etapes.some((e) => e.mode === '360')) return res.status(400).json({ error: 'Ajoutez au moins 2 pièces (ou un panorama 360°) avant de publier.' });
  b.visite = { etapes: etapes, publie: publie, modifieLe: nowISO(), auteur: nomComplet(req.lead) };
  // Panoramas retirés de la visite : supprimés du disque.
  const gardes = new Set(etapes.map((e) => e.image));
  (b.panoramas || []).filter((u) => !gardes.has(u)).forEach((u) => { if (/^\/uploads\/pano-[\w-]+\.(jpg|png|webp)$/.test(u)) { try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(u))); } catch (e) { /* ignore */ } } });
  b.panoramas = (b.panoramas || []).filter((u) => gardes.has(u));
  writeDb(db);
  res.json({ ok: true, visite: b.visite, panoramas: b.panoramas });
});

// ---------------- La Gazette du club ----------------
// Chiffres calculés sur les vraies données du club (aucune donnée de marché
// inventée) + le mot du mois et le coup de cœur, rédigés par l'agence.
const COMMISSION_REFERENCE = Number(process.env.GAZETTE_COMMISSION_REFERENCE || 5);

// ---- Articles automatiques de la Gazette (Célia + Gemini) ----
// Deux rubriques rédigées seules :
//  • « marche »  : l'actualité de l'immobilier en France (taux de crédit,
//    prix, volume de ventes, mesures…). Gemini cherche l'actualité de la
//    semaine sur le web (Google Search) ; les sources sont citées.
//  • « conseil » : un conseil concret pour vendre plus vite / mieux.
// Fréquences et publication (automatique ou après validation) se règlent dans
// le CRM (Le Club › La Gazette). Rien n'est inventé côté club : les rubriques
// « bien à la une », « vendus dans votre secteur », chiffres… restent
// calculées sur les vraies données.
const GAZETTE_RUBRIQUES = {
  marche: { nom: 'Le marché', images: ['trocadero-1.jpg', 'ilesaintlouis-1.jpg', 'montmartre-1.jpg', 'saintsulpice-1.jpg', 'ilesaintlouis-3.jpg', 'montmartre-3.jpg'] },
  conseil: { nom: 'Conseil vendeur', images: ['home-6.jpg', 'home-3.jpg', 'home-loft-bright.jpg', 'home-jardin.jpg', 'home-5.jpg', 'saintgermain-3.jpg'] }
};
const GAZETTE_REGLAGES_DEFAUT = { auto: true, publication: 'auto', marcheJours: 3, conseilJours: 7 };
const SUJETS_CONSEIL = [
  'Fixer le juste prix dès le départ (et pourquoi un bien surévalué se vend moins cher au final)',
  'Les photos qui font vendre : lumière, angles, home staging léger',
  'Préparer son dossier vendeur (diagnostics, PV d’AG, taxe foncière…) pour signer plus vite',
  'Vendre en off-market : discrétion, acheteurs qualifiés et négociation',
  'Réussir les visites : ce que les acheteurs regardent vraiment',
  'Négocier une offre : prix, conditions suspensives, délais',
  'Petits travaux qui rapportent avant de vendre (et ceux qui ne servent à rien)',
  'Le DPE et la vente : ce qui change pour les vendeurs',
  'Vendre occupé ou vide : avantages et pièges',
  'Choisir le bon moment pour vendre dans l’année'
];
function reglagesGazette(db) { return Object.assign({}, GAZETTE_REGLAGES_DEFAUT, (db.gazette && db.gazette.auto) || {}); }
function articlePublic(a) {
  return { id: a.id, slug: a.slug, rubrique: a.rubrique, kicker: (GAZETTE_RUBRIQUES[a.rubrique] || {}).nom || 'La Gazette', titre: a.titre, chapo: a.chapo, texte: a.texte, sources: a.sources || [], image: a.image, date: a.publieLe || a.cree };
}
// Ventes du club des 6 derniers mois (sans adresse ni photo : quartier, type,
// surface et prix au m² arrondi à la centaine).
function ventesRecentesClub(db) {
  const depuis = Date.now() - 183 * 864e5;
  return db.biens.filter((b) => b.statut === 'vendu' && !b.importLot && new Date(b.venduLe || b.majLe || b.cree || 0).getTime() > depuis)
    .sort((a, b) => new Date(b.venduLe || b.cree || 0) - new Date(a.venduLe || a.cree || 0)).slice(0, 20)
    .map((b) => ({ quartier: b.quartier || '', label: labelQuartier(b.quartier) || '', type: b.type || '', surface: Number(b.surface) || null, pieces: Number(b.pieces) || null,
      prixM2: b.surface && b.prix ? Math.round(prixHai(b.prix, 5) / b.surface / 100) * 100 : null, venduLe: b.venduLe || null, parSeecret: b.venduParAgence === true }));
}
function slugArticle(titre, id) {
  return String(titre || 'article').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + id.slice(-4);
}
function consigneArticle(rubrique, recents, sujet) {
  const aujourd = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const commun = 'Tu es Célia, la plume de la Gazette de Seecret, un club immobilier off-market à Paris. Nous sommes le ' + aujourd + '. ' +
    'Ton : élégant, clair, concret, sans jargon ni superlatifs creux, vouvoiement. Pas de conseil financier personnalisé. ' +
    'Titres déjà publiés récemment (ne les répète pas, trouve un autre angle) : ' + (recents.length ? recents.map((t) => '« ' + t + ' »').join(', ') : 'aucun') + '.\n\n' +
    'Réponds EXACTEMENT dans ce format, sans rien d’autre :\nTITRE: <titre court et accrocheur, 70 caractères max>\nCHAPO: <une phrase de résumé, 180 caractères max>\nTEXTE:\n<4 à 6 paragraphes séparés par une ligne vide, 350 à 550 mots au total>';
  if (rubrique === 'marche') {
    return commun + '\n\nSujet : l’actualité du marché immobilier en France des 7 derniers jours. Cherche sur le web (sources fiables : notaires, Banque de France, courtiers comme Meilleurtaux ou CAFPI, INSEE, presse économique) le fait marquant de la semaine : ' +
      'taux de crédit immobilier en hausse ou en baisse, évolution des prix (France, Paris, grandes villes), volume de ventes, conditions d’octroi, mesures publiques (PTZ, DPE, fiscalité)… ' +
      'Choisis UN sujet principal, donne les chiffres récents avec leur date et leur source dans le texte (ex. « selon l’Observatoire Crédit Logement de novembre »), puis explique ce que cela change concrètement pour un vendeur et pour un acheteur à Paris. ' +
      'N’invente aucun chiffre : si tu n’en trouves pas de récent et sourcé, ne le donne pas.';
  }
  return commun + '\n\nSujet : un conseil pratique pour les propriétaires qui vendent. Thème : ' + sujet + '. Donne des conseils concrets et actionnables ; termine par une phrase qui rappelle que l’agent Seecret du membre peut l’accompagner (sans formule commerciale lourde). ' +
    'Ne cite aucun chiffre daté ni aucune règle dont tu n’es pas certain qu’elle est en vigueur aujourd’hui.';
}
// Actualité immobilière des 7 derniers jours via Google Actualités (RSS,
// gratuit, sans clé) : titres, médias, dates et liens.
async function actualitesImmo() {
  const requetes = ['taux crédit immobilier', 'prix immobilier France', 'marché immobilier notaires', 'immobilier Paris prix'];
  const vus = new Set();
  const out = [];
  for (const q of requetes) {
    try {
      const url = 'https://news.google.com/rss/search?' + new URLSearchParams({ q: q + ' when:7d', hl: 'fr', gl: 'FR', ceid: 'FR:fr' }).toString();
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Seecret Gazette)' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = xml.split('<item>').slice(1, 9);
      items.forEach((it) => {
        const tag = (t) => { const m = new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>').exec(it); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : ''; };
        const media = tag('source'); const lien = tag('link'); const date = tag('pubDate');
        let titre = tag('title');
        if (media && titre.endsWith(' - ' + media)) titre = titre.slice(0, -(media.length + 3)); // Google ajoute « - Média »
        const cle = titre.toLowerCase().slice(0, 60);
        if (!titre || vus.has(cle)) return;
        vus.add(cle);
        out.push({ titre: titre, lien: lien, media: media, date: date ? new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '' });
      });
    } catch (e) { /* requête suivante */ }
  }
  return out.slice(0, 24);
}
async function appelGemini(texte, recherche) {
  // Sans recherche Google : mêmes modèles de secours que la rédaction des fiches.
  if (!recherche) return (await geminiGenerer({ contents: [{ role: 'user', parts: [{ text: texte }] }], generationConfig: { temperature: 0.6 } })).data;
  const resp = await fetch(GEMINI_API_BASE + '/v1beta/models/' + encodeURIComponent(GEMINI_MODEL) + ':generateContent', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ contents: [{ role: 'user', parts: [{ text: texte }] }], generationConfig: { temperature: 0.6 } }, recherche ? { tools: [{ google_search: {} }] } : {}))
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error((data && data.error && data.error.message) || ('Gemini ' + resp.status)), { code: 'API_ERROR', status: resp.status });
  return data;
}
async function redigerArticle(db, rubrique) {
  if (!GEMINI_API_KEY) throw Object.assign(new Error('La rédaction automatique nécessite la clé Gemini (GEMINI_API_KEY).'), { code: 'NO_KEY' });
  const tous = db.gazetteArticles || [];
  const recents = tous.filter((a) => a.rubrique === rubrique).slice(0, 8).map((a) => a.titre);
  const nbConseils = tous.filter((a) => a.rubrique === 'conseil').length;
  const sujet = SUJETS_CONSEIL[nbConseils % SUJETS_CONSEIL.length];
  const consigne = consigneArticle(rubrique, recents, sujet);
  let data = null;
  let sourcesRss = null;
  if (rubrique === 'marche') {
    // 1. Recherche Google intégrée à Gemini (si le quota de la clé le permet).
    try { data = await appelGemini(consigne, true); } catch (e) { data = null; }
    // 2. Sinon (quota gratuit épuisé…) : l'actualité de la semaine lue sur
    //    Google Actualités, transmise à Célia qui rédige UNIQUEMENT à partir d'elle.
    if (!data) {
      const actus = await actualitesImmo();
      if (actus.length < 3) throw Object.assign(new Error('Actualité immobilière introuvable pour le moment (Google Actualités ne répond pas). Réessayez plus tard.'), { code: 'API_ERROR' });
      sourcesRss = actus;
      data = await appelGemini(consigne.replace('Cherche sur le web (sources fiables', 'Appuie-toi UNIQUEMENT sur les actualités listées ci-dessous (sources fiables') +
        '\n\nActualités immobilières de la semaine (titre — média, date) :\n' + actus.map((a, i) => (i + 1) + '. ' + a.titre + ' — ' + a.media + (a.date ? ', ' + a.date : '')).join('\n') +
        '\n\nN’utilise que les chiffres présents dans ces titres. Termine ta réponse par une dernière ligne « SOURCES: » suivie des numéros des actualités utilisées, séparés par des virgules.', false);
    }
  } else {
    data = await appelGemini(consigne, false);
  }
  const cand = (data.candidates || [])[0] || {};
  const brut = ((cand.content || {}).parts || []).map((x) => x.text || '').join('').trim();
  let corpsBrut = brut;
  let utilisees = null;
  const ls = /\n\s*SOURCES?\s*:\s*([\d,\s]+)\s*$/i.exec(corpsBrut);
  if (ls) { utilisees = ls[1].split(/[,\s]+/).map(Number).filter((n) => n > 0); corpsBrut = corpsBrut.slice(0, ls.index); }
  const m = /TITRE\s*:\s*(.+)\s*\n+\s*CHAPO\s*:\s*(.+)\s*\n+\s*TEXTE\s*:\s*\n?([\s\S]+)/i.exec(corpsBrut);
  if (!m) throw Object.assign(new Error('Célia n’a pas renvoyé un article exploitable. Réessayez.'), { code: 'API_ERROR' });
  const nettoie = (t) => String(t).replace(/\*\*|__|^#+\s*/gm, '').trim();
  const sources = [];
  ((cand.groundingMetadata || {}).groundingChunks || []).forEach((c) => {
    const w = c.web || {}; if (!w.uri || sources.some((x) => x.titre === w.title)) return;
    sources.push({ titre: String(w.title || w.uri).slice(0, 120), url: String(w.uri) });
  });
  if (sourcesRss) {
    const choisies = utilisees && utilisees.length ? utilisees.map((n) => sourcesRss[n - 1]).filter(Boolean) : sourcesRss.slice(0, 4);
    choisies.forEach((a) => sources.push({ titre: (a.media ? a.media + ' — ' : '') + a.titre, url: a.lien }));
  }
  const id = uid('ga');
  const titre = nettoie(m[1]).replace(/^« |»$/g, '').replace(/\.$/, '').slice(0, 110);
  const images = GAZETTE_RUBRIQUES[rubrique].images;
  return {
    id: id, slug: slugArticle(titre, id), rubrique: rubrique, titre: titre, chapo: nettoie(m[2]).slice(0, 260), texte: nettoie(m[3]).replace(/\s*\[\d+(,\s*\d+)*\]/g, '').slice(0, 6000),
    sources: sources.slice(0, 6), image: 'assets/img/' + images[tous.filter((a) => a.rubrique === rubrique).length % images.length],
    sujet: rubrique === 'conseil' ? sujet : null, auteur: 'Célia (IA)', cree: nowISO()
  };
}
async function creerArticleGazette(rubrique, publier) {
  const art = await redigerArticle(readDb(), rubrique);
  const db = readDb();
  art.statut = publier ? 'publie' : 'a_valider';
  if (publier) art.publieLe = nowISO();
  db.gazetteArticles = [art].concat(db.gazetteArticles || []).slice(0, 200);
  writeDb(db);
  return art;
}
// Vérifie (au plus une fois toutes les 30 min) si un article est dû.
let gazetteAutoEnCours = false;
let gazetteAutoDernier = 0;
function gazetteAutoVerifier() {
  if (gazetteAutoEnCours || !GEMINI_API_KEY || Date.now() - gazetteAutoDernier < 30 * 60 * 1000) return;
  gazetteAutoDernier = Date.now();
  const db = readDb();
  const r = reglagesGazette(db);
  if (!r.auto) return;
  const dernier = (rub) => Math.max(0, ...(db.gazetteArticles || []).filter((a) => a.rubrique === rub).map((a) => new Date(a.cree).getTime()));
  const du = ['marche', 'conseil'].find((rub) => Date.now() - dernier(rub) > (rub === 'marche' ? r.marcheJours : r.conseilJours) * 864e5 - 3600e3);
  if (!du) return;
  gazetteAutoEnCours = true;
  creerArticleGazette(du, r.publication === 'auto')
    .then((a) => console.log('[gazette] article « ' + a.titre + ' » (' + du + ', ' + a.statut + ')'))
    .catch((e) => console.warn('[gazette] rédaction impossible :', e.message))
    .finally(() => { gazetteAutoEnCours = false; });
}
setTimeout(gazetteAutoVerifier, 60 * 1000);
setInterval(gazetteAutoVerifier, 60 * 60 * 1000).unref();

app.get('/api/gazette/articles', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, reglages: reglagesGazette(db), cle: !!GEMINI_API_KEY, articles: db.gazetteArticles || [] });
});
app.put('/api/gazette/reglages', requireAdmin, (req, res) => {
  const db = readDb();
  const b = req.body || {};
  const r = reglagesGazette(db);
  if (typeof b.auto === 'boolean') r.auto = b.auto;
  if (b.publication === 'auto' || b.publication === 'validation') r.publication = b.publication;
  if ([2, 3, 7].indexOf(Number(b.marcheJours)) > -1) r.marcheJours = Number(b.marcheJours);
  if ([7, 14].indexOf(Number(b.conseilJours)) > -1) r.conseilJours = Number(b.conseilJours);
  db.gazette = db.gazette || {};
  db.gazette.auto = r;
  writeDb(db);
  res.json({ ok: true, reglages: r });
});
app.post('/api/gazette/articles/generer', requireAdmin, async (req, res) => {
  const rubrique = (req.body && req.body.rubrique) === 'conseil' ? 'conseil' : 'marche';
  try {
    const r = reglagesGazette(readDb());
    const a = await creerArticleGazette(rubrique, r.publication === 'auto');
    res.json({ ok: true, article: a });
  } catch (e) { res.status(e.code === 'NO_KEY' ? 503 : 502).json({ error: e.message || 'Rédaction impossible.' }); }
});
app.patch('/api/gazette/articles/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const a = (db.gazetteArticles || []).find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Article introuvable.' });
  const b = req.body || {};
  if (typeof b.titre === 'string' && b.titre.trim()) a.titre = b.titre.trim().slice(0, 110);
  if (typeof b.chapo === 'string') a.chapo = b.chapo.trim().slice(0, 260);
  if (typeof b.texte === 'string' && b.texte.trim()) a.texte = b.texte.trim().slice(0, 6000);
  if (['publie', 'retire', 'a_valider'].indexOf(b.statut) > -1) { if (b.statut === 'publie' && a.statut !== 'publie') a.publieLe = nowISO(); a.statut = b.statut; }
  a.modifieLe = nowISO();
  writeDb(db);
  res.json({ ok: true, article: a });
});
app.delete('/api/gazette/articles/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const avant = (db.gazetteArticles || []).length;
  db.gazetteArticles = (db.gazetteArticles || []).filter((x) => x.id !== req.params.id);
  if (db.gazetteArticles.length === avant) return res.status(404).json({ error: 'Article introuvable.' });
  writeDb(db);
  res.json({ ok: true });
});
app.get('/api/gazette', requireAuth, (req, res) => {
  const db = req.db;
  const g = db.gazette || {};
  const surPlateforme = db.biens.filter(bienSurPlateforme);
  const vendusAgence = db.biens.filter((b) => b.statut === 'vendu' && b.venduParAgence === true);
  // Record : le délai le plus court entre l'ouverture aux visites et la
  // première offre reçue (90 derniers jours).
  const depuis = Date.now() - 90 * 864e5;
  let record = null;
  db.biens.forEach((b) => {
    const offres = (db.offres || []).filter((o) => o.bienId === b.id && new Date(o.cree).getTime() > depuis);
    if (!offres.length) return;
    const premiere = offres.map((o) => new Date(o.cree).getTime()).sort((a, c) => a - c)[0];
    const ouverture = new Date(b.ouvertLe || b.cree || 0).getTime();
    if (!ouverture || premiere < ouverture) return;
    const heures = Math.max(1, Math.round((premiere - ouverture) / 36e5));
    if (!record || heures < record.heures) record = { bienId: b.id, titre: b.titre || 'Un bien du club', quartier: labelQuartier(b.quartier) || '', type: b.type || '', heures: heures, surPlateforme: bienSurPlateforme(b), photo: (b.photos || [])[0] || null };
  });
  const membres = db.leads.filter((l) => l.statut === 'accepte' && ROLES_STAFF.indexOf(roleOf(l)) === -1).length;
  const visites = db.demandes.filter((d) => d.type === 'visite' && d.rdv).length;
  const evitees = Math.round(vendusAgence.reduce((n, b) => n + (Number(b.prix) || 0), 0) * COMMISSION_REFERENCE / 100);
  const coup = g.coupDeCoeur && g.coupDeCoeur.bienId ? db.biens.find((b) => b.id === g.coupDeCoeur.bienId && bienSurPlateforme(b)) : null;
  res.json({
    ok: true,
    numero: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    chiffres: { biens: surPlateforme.length, membres: membres, visites: visites, ventes: vendusAgence.length, commissionsEvitees: evitees, commissionReference: COMMISSION_REFERENCE },
    record: record,
    mot: g.mot && g.mot.texte ? { titre: g.mot.titre || '', texte: g.mot.texte, auteur: g.mot.auteur || '', date: g.mot.date || null } : null,
    coupDeCoeur: coup ? { bienId: coup.id, phrase: g.coupDeCoeur.phrase || '', auteur: g.coupDeCoeur.auteur || '' } : null,
    articles: (db.gazetteArticles || []).filter((a) => a.statut === 'publie').slice(0, 12).map(articlePublic),
    vendus: ventesRecentesClub(db)
  });
  gazetteAutoVerifier(); // en arrière-plan : rédige l'article du moment s'il est dû
});
app.get('/api/gazette/edition', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, gazette: db.gazette || {}, biens: db.biens.filter(bienSurPlateforme).map((b) => ({ id: b.id, titre: b.titre || 'Sans titre', quartier: labelQuartier(b.quartier) || '' })) });
});
app.put('/api/gazette/edition', requireAdmin, (req, res) => {
  const db = readDb();
  const body = req.body || {};
  const g = db.gazette = db.gazette || {};
  if (body.mot) g.mot = { titre: String(body.mot.titre || '').trim().slice(0, 120), texte: String(body.mot.texte || '').trim().slice(0, 3000), auteur: nomComplet(req.lead), date: nowISO() };
  if (body.coupDeCoeur) {
    const id = String(body.coupDeCoeur.bienId || '');
    g.coupDeCoeur = id ? { bienId: id, phrase: String(body.coupDeCoeur.phrase || '').trim().slice(0, 400), auteur: nomComplet(req.lead), date: nowISO() } : null;
  }
  writeDb(db);
  res.json({ ok: true, gazette: g });
});

// ---------------- Texte éditorial des fiches (Célia) ----------------
// Célia rédige, à partir des caractéristiques ET des photos du bien, un titre
// et un texte au ton « magazine de décoration haut de gamme ». L'agent relit,
// corrige, puis publie : rien n'est montré aux membres sans validation.
const EDITORIAL_CONSIGNE = [
  'Tu es la rédactrice de Seecret, club immobilier off-market haut de gamme à Paris.',
  'Rédige pour une fiche de bien un TITRE (6 à 10 mots, sans point final, sans adresse) et un TEXTE de 110 à 170 mots, en 2 ou 3 courts paragraphes.',
  'Ton : éditorial, élégant et sobre, comme un magazine de décoration (AD, The World of Interiors). Phrases vivantes, vocabulaire précis : matières, lumière, volumes, circulation, vues.',
  'Mets en valeur les qualités réelles du bien, puis l’art de vivre du quartier en termes généraux (ambiance, rythme, type de rues), sans citer de commerces, d’écoles ou de lieux précis.',
  'N’invente AUCUNE caractéristique absente des données ou des photos. Jamais d’adresse, de numéro de rue, de prix, de superlatif creux (« exceptionnel », « rare », « coup de cœur assuré »), ni de point d’exclamation.',
  'Réponds uniquement en JSON : {"titre": "…", "texte": "…"} — paragraphes séparés par \n\n.'
].join('\n');
function donneesEditorial(b) {
  const lignes = [
    ['Type', b.type], ['Quartier', labelQuartier(b.quartier) || b.ville], ['Surface', b.surface ? b.surface + ' m²' : ''],
    ['Pièces', b.pieces], ['Chambres', b.chambres], ['Salles de bain', b.sdb], ['Étage', b.etage], ['Ascenseur', b.ascenseur ? 'oui' : ''],
    ['Année de construction', b.anneeConstruction], ['État', b.etat], ['Extérieur', b.exterieur && b.exterieur !== 'Aucun' ? b.exterieur + (b.surfaceExterieur ? ' de ' + b.surfaceExterieur + ' m²' : '') : ''],
    ['Annexes', (b.annexes || []).join(', ')], ['Atouts', (b.atouts || []).join(', ')], ['DPE', b.dpe],
    ['Description du propriétaire', b.description], ['Ce que le propriétaire aime dans son bien', b.coupDeCoeur]
  ].filter((x) => x[1] !== undefined && x[1] !== null && String(x[1]).trim() !== '' && String(x[1]) !== '0');
  return lignes.map((x) => x[0] + ' : ' + x[1]).join('\n');
}
// Jusqu'à 4 photos du bien envoyées à l'IA (fichiers locaux uniquement).
function photosPourIa(b) {
  const parts = [];
  (b.photos || []).slice(0, 6).forEach((p) => {
    if (parts.length >= 4) return;
    try {
      let fichier = null;
      if (/^\/?uploads\//.test(p)) fichier = path.join(UPLOADS_DIR, p.replace(/^\/?uploads\//, ''));
      else if (/^\/?assets\/img\/[\w.-]+$/.test(p)) fichier = path.join(__dirname, p.replace(/^\//, ''));
      else if (/^[\w.-]+\.(jpe?g|png|webp)$/i.test(p)) fichier = path.join(__dirname, 'assets', 'img', p);
      if (fichier && fichier.indexOf(UPLOADS_DIR) !== 0 && fichier.indexOf(path.join(__dirname, 'assets', 'img')) !== 0) fichier = null;
      if (fichier && fs.existsSync(fichier) && fs.statSync(fichier).size < 3.5 * 1024 * 1024) {
        const ext = path.extname(fichier).toLowerCase();
        parts.push({ inline_data: { mime_type: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(fichier).toString('base64') } });
      } else {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p || '');
        if (m && m[2].length < 4.5 * 1024 * 1024) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
      }
    } catch (e) { /* photo ignorée */ }
  });
  return parts;
}
// Modèles Gemini de secours : chaque modèle a son propre quota gratuit par
// jour. Quand le modèle principal est saturé (429) ou surchargé (503), on
// essaie les autres modèles « flash » disponibles sur la clé.
let GEMINI_MODELES = null; let GEMINI_MODELES_LE = 0;
async function geminiModeles() {
  if (GEMINI_MODELES && Date.now() - GEMINI_MODELES_LE < 3600e3) return GEMINI_MODELES;
  const liste = [GEMINI_MODEL];
  try {
    const r = await fetch(GEMINI_API_BASE + '/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': GEMINI_API_KEY }, signal: AbortSignal.timeout(10000) });
    const d = await r.json().catch(() => ({}));
    (d.models || []).filter((m) => (m.supportedGenerationMethods || []).indexOf('generateContent') > -1 && /flash/i.test(m.name) && !/image|tts|audio|live|thinking|exp/i.test(m.name))
      .map((m) => String(m.name).replace(/^models\//, '')).sort((a, b) => b.localeCompare(a))
      .forEach((n) => { if (liste.indexOf(n) === -1 && liste.length < 6) liste.push(n); });
  } catch (e) { /* liste par défaut */ }
  GEMINI_MODELES = liste; GEMINI_MODELES_LE = Date.now();
  return liste;
}
async function geminiGenerer(corps) {
  const modeles = await geminiModeles();
  let derniere = null;
  for (const m of modeles) {
    const resp = await fetchAvecRetry(GEMINI_API_BASE + '/v1beta/models/' + encodeURIComponent(m) + ':generateContent', {
      method: 'POST', headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
    }, 1).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) return { data: data, modele: m };
    derniere = (data && data.error && data.error.message) || ('Gemini ' + resp.status);
    if ([429, 503, 500, 404, 0].indexOf(resp.status) === -1) break; // erreur de requête : inutile d'essayer ailleurs
  }
  throw Object.assign(new Error(derniere || 'Gemini indisponible'), { code: 'API_ERROR' });
}
// Dernier recours, sans IA : un premier jet construit à partir des données du
// bien, à retoucher par l'agent (jamais publié sans relecture).
function editorialSansIa(b) {
  const q = labelQuartier(b.quartier) || b.ville || 'Paris';
  const type = String(b.type || 'appartement').toLowerCase();
  const titre = (b.surface ? (b.pieces ? b.pieces + ' pièces' : 'Un ' + type) + ', ' + b.surface + ' m²' : 'Un ' + type) + ' · ' + q;
  const p1 = ['Un ' + type + (b.surface ? ' de ' + b.surface + ' m²' : '') + (function () { const e = parseInt(b.etage, 10); return e === 0 ? ' en rez-de-chaussée' : e > 0 ? ' au ' + e + (e === 1 ? 'er' : 'e') + ' étage' : ''; })() + (b.ascenseur ? ' avec ascenseur' : '') + '.',
    b.pieces ? 'Il se compose de ' + b.pieces + ' pièces' + (b.chambres ? ', dont ' + b.chambres + ' chambre' + (b.chambres > 1 ? 's' : '') : '') + (b.sdb ? ' et ' + b.sdb + ' salle' + (b.sdb > 1 ? 's' : '') + ' d’eau' : '') + '.' : '',
    b.exterieur && b.exterieur !== 'Aucun' ? 'À l’extérieur : ' + String(b.exterieur).toLowerCase() + (b.surfaceExterieur ? ' de ' + b.surfaceExterieur + ' m²' : '') + '.' : ''].filter(Boolean).join(' ');
  const p2 = [(b.atouts || []).length ? 'Ses atouts : ' + b.atouts.join(', ').toLowerCase() + '.' : '', b.description ? String(b.description).trim() : ''].filter(Boolean).join(' ');
  const p3 = b.coupDeCoeur ? 'Ses propriétaires l’aiment pour ' + String(b.coupDeCoeur).trim().replace(/\.$/, '') + '.' : '';
  return { titre: titre.slice(0, 90), texte: [p1, p2, p3].filter(Boolean).join('\n\n'), photos: 0, sansIa: true };
}
async function genererEditorial(b) {
  if (!GEMINI_API_KEY) return editorialSansIa(b);
  const photos = photosPourIa(b);
  const parts = [{ text: 'Données du bien :\n' + donneesEditorial(b) + (photos.length ? '\n\nPhotos du bien ci-jointes : appuie-toi sur ce que tu vois (lumière, matières, style), sans inventer.' : '') }].concat(photos);
  let data;
  try {
    data = (await geminiGenerer({ system_instruction: { parts: [{ text: EDITORIAL_CONSIGNE }] }, contents: [{ role: 'user', parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.8 } })).data;
  } catch (e) {
    console.warn('[célia] rédaction IA impossible, premier jet sans IA :', e.message);
    return Object.assign(editorialSansIa(b), { raison: e.message });
  }
  const brut = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const texte = brut.map((x) => x.text || '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out = null;
  try { out = JSON.parse(texte); } catch (e) { /* format inattendu */ }
  if (!out || !out.texte) throw Object.assign(new Error('Célia n’a pas renvoyé de texte exploitable. Réessayez.'), { code: 'API_ERROR' });
  return { titre: String(out.titre || '').trim().replace(/\.$/, '').slice(0, 90), texte: String(out.texte).trim().slice(0, 2500), photos: photos.length };
}
app.post('/api/biens/:id/editorial/generer', requireAdmin, async (req, res) => {
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  try {
    const g = await genererEditorial(b);
    const db2 = readDb();
    const b2 = db2.biens.find((x) => x.id === b.id);
    b2.editorial = Object.assign({}, b2.editorial || {}, { brouillonTitre: g.titre, brouillonTexte: g.texte, genereLe: nowISO() });
    writeDb(db2);
    res.json({ ok: true, titre: g.titre, texte: g.texte, photosAnalysees: g.photos, sansIa: !!g.sansIa });
  } catch (e) {
    res.status(e.code === 'NO_KEY' ? 503 : 502).json({ error: e.message || 'Rédaction impossible.' });
  }
});
app.put('/api/biens/:id/editorial', requireAdmin, (req, res) => {
  const db = readDb();
  const b = db.biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable.' });
  const body = req.body || {};
  const publie = !!body.publie;
  const texte = String(body.texte || '').trim().slice(0, 2500);
  if (publie && !texte) return res.status(400).json({ error: 'Le texte est vide.' });
  b.editorial = Object.assign({}, b.editorial || {}, {
    titre: String(body.titre || '').trim().slice(0, 90), texte: texte, publie: publie,
    modifieLe: nowISO(), auteur: nomComplet(req.lead), publieLe: publie ? nowISO() : null
  });
  if (body.coupDeCoeur !== undefined) b.coupDeCoeur = String(body.coupDeCoeur || '').trim().slice(0, 280);
  writeDb(db);
  res.json({ ok: true, editorial: b.editorial, coupDeCoeur: b.coupDeCoeur || '' });
});

// État de la base (agence) : moteur utilisé et volume, pour vérifier un déploiement.
app.get('/api/admin/base', requireAdmin, (req, res) => {
  const fichier = stockage ? stockage.fichier : DATA_FILE;
  let taille = 0; try { taille = fs.statSync(fichier).size + (stockage && fs.existsSync(fichier + '-wal') ? fs.statSync(fichier + '-wal').size : 0); } catch (e) { /* ignore */ }
  const db = readDb();
  res.json({ ok: true, moteur: stockage ? 'sqlite' : 'json', tailleOctets: taille, ancienFichierImporte: fs.existsSync(DATA_FILE + '.importe'),
    collections: Object.keys(db).filter((k) => Array.isArray(db[k])).reduce((o, k) => { o[k] = db[k].length; return o; }, {}) });
});

// ---------------- Journal de bord du membre ----------------
// Tout est calculé pour CE membre : ses visites, ses offres, les baisses de
// prix des biens qu'il suit ou a visités (en prix HAI, jamais le net d'un
// autre propriétaire), et l'activité anonyme autour de son propre bien.
// Un bien est sur la plateforme Seecret si : l'option « Sur Seecret » est
// active dans le CRM (un bien en prospection, un ancien bien… peut rester
// dans le CRM sans être publié), qu'il est validé par l'agent, et qu'il est
// en avant-première ou ouvert aux visites.
function bienSurPlateforme(b) { return !!b && !b.archive && b.surSeecret !== false && b.validation === 'valide' && (b.statut === 'avant-premiere' || b.statut === 'ouvert'); }
// Agent qui suit le membre : l'agent attribué dans le CRM (agentId, ou
// l'agent qui l'a créé), sinon l'agent par défaut de l'agence.
function agentAttribue(db, lead) {
  const id = lead && (lead.agentId || lead.creePar);
  const a = id ? db.leads.find((l) => l.id === id && ROLES_STAFF.indexOf(roleOf(l)) > -1) : null;
  return a || null;
}
function agentDuMembre(db, lead) {
  const a = agentAttribue(db, lead);
  if (a) return { nom: nomComplet(a) || DEFAULT_AGENT_NOM };
  const mien = db.biens.find((b) => b.leadId === lead.id);
  return { nom: (mien && mien.agent) || DEFAULT_AGENT_NOM };
}
app.get('/api/mon-journal', requireAuth, (req, res) => {
  const db = req.db;
  const lead = req.lead;
  const reduit = aVenduChezNous(db, lead);
  const titreDe = (id) => { const b = db.biens.find((x) => x.id === id); return b ? (b.titre || 'Un bien du club') : 'Un bien du club'; };
  const visites = db.demandes.filter((d) => d.type === 'visite' && d.leadId === lead.id).map((d) => ({
    id: d.id, bienId: d.bienId, titre: titreDe(d.bienId), cree: d.cree,
    etat: d.statut === 'traitee' && d.rdv ? 'confirmee' : (d.statut === 'refusee' ? 'refusee' : 'en_attente'),
    rdv: d.rdv ? { date: d.rdv.date, heure: d.rdv.heure } : null,
    creneaux: Array.isArray(d.creneaux) ? d.creneaux.map(creneauLisible) : []
  })).sort((a, b) => String(b.cree).localeCompare(String(a.cree))).slice(0, 20);
  const offres = (db.offres || []).filter((o) => o.leadId === lead.id).map((o) => ({
    id: o.id, bienId: o.bienId, titre: titreDe(o.bienId), montant: o.montant, statut: o.statut, contre: o.contre || 0, cree: o.cree
  })).sort((a, b) => String(b.cree).localeCompare(String(a.cree))).slice(0, 20);
  const interesses = new Set((lead.suivis || []).concat(visites.map((v) => v.bienId)));
  const baisses = [];
  interesses.forEach((id) => {
    const b = db.biens.find((x) => x.id === id);
    if (!bienSurPlateforme(b) || b.leadId === lead.id) return;
    const taux = tauxHonorairesPour(b, lead, reduit);
    (b.historiquePrix || []).forEach((h) => {
      if (h.ancien > 0 && h.nouveau > 0 && h.nouveau < h.ancien) {
        baisses.push({ bienId: b.id, titre: b.titre || 'Un bien du club', at: h.at, ancien: prixHai(h.ancien, taux), nouveau: prixHai(h.nouveau, taux) });
      }
    });
  });
  baisses.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const mien = db.biens.find((b) => b.leadId === lead.id);
  const monBien = mien ? {
    suiveurs: Number(mien.suiveurs) || 0,
    visitesDemandees: db.demandes.filter((d) => d.type === 'visite' && d.bienId === mien.id).length,
    visitesConfirmees: db.demandes.filter((d) => d.type === 'visite' && d.bienId === mien.id && d.rdv).length,
    offres: (db.offres || []).filter((o) => o.bienId === mien.id).length
  } : null;
  const messages = (db.messages || []).filter((m) => m.leadId === lead.id);
  res.json({
    ok: true, agent: agentDuMembre(db, lead), visites: visites, offres: offres, baisses: baisses.slice(0, 12), monBien: monBien,
    messagesNonLus: messages.filter((m) => m.de === 'agent' && !m.luMembre).length
  });
});

// ---------------- Messagerie membre ↔ agent ----------------
// Fil unique par membre, lu dans l'espace membre (fenêtre de discussion) et
// dans le CRM (Messages). Chaque message prévient l'autre côté par email.
const MESSAGE_MAX = 2000;
function escHtml(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function messageSortant(m) { return { id: m.id, de: m.de, auteur: m.auteur || '', texte: m.texte, at: m.at }; }
// Destinataire de l'email « nouveau message » : l'adresse de connexion au CRM
// de l'agent attribué au membre ; à défaut (membre pas encore attribué),
// AGENCE_EMAIL_MESSAGES, sinon les super-admins (ADMIN_EMAILS).
function emailsAgence(db, lead) {
  const a = agentAttribue(db, lead);
  if (a && a.email) return [a.email];
  return String(process.env.AGENCE_EMAIL_MESSAGES || process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim()).filter(Boolean);
}
// Un agent ne voit que les conversations de ses membres ; le super-admin voit tout.
function conversationVisible(req, db, leadId) {
  if (roleOf(req.lead) === 'superadmin') return true;
  const l = db.leads.find((x) => x.id === leadId);
  return !!(l && leadVisibleParAgent(l, req.lead.id));
}
app.get('/api/mes-messages', requireAuth, (req, res) => {
  const db = req.db;
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  const fil = db.messages.filter((m) => m.leadId === req.lead.id);
  let change = false;
  fil.forEach((m) => { if (m.de === 'agent' && !m.luMembre) { m.luMembre = true; change = true; } });
  (db.notifications || []).forEach((n) => { if (n.leadId === req.lead.id && n.type === 'message' && !n.lue) { n.lue = true; change = true; } });
  if (change) writeDb(db);
  res.json({ ok: true, agent: agentDuMembre(db, req.lead), messages: fil.map(messageSortant) });
});
app.post('/api/mes-messages', requireAuth, (req, res) => {
  const texte = String((req.body && req.body.texte) || '').trim().slice(0, MESSAGE_MAX);
  if (!texte) return res.status(400).json({ error: 'Message vide.' });
  const db = req.db;
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  const m = { id: uid('msg'), leadId: req.lead.id, de: 'membre', auteur: nomComplet(req.lead), texte: texte, at: nowISO(), luMembre: true, luAgence: false };
  db.messages.push(m);
  logActivite(db, { leadId: req.lead.id, type: 'message_membre', auteur: nomComplet(req.lead) });
  writeDb(db);
  const dest = emailsAgence(db, req.lead);
  if (mailer && dest.length) {
    mailer.sendMail({
      from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: dest.join(','),
      subject: 'Nouveau message de ' + nomComplet(req.lead),
      html: emailAgent({ etiquette: 'Message', titre: escHtml(nomComplet(req.lead)) + ' vous a écrit', intro: 'Nouveau message reçu depuis l’espace membre.', citation: escHtml(String(texte).slice(0, 1200)), lignes: [['Membre', nomComplet(req.lead)], ['Email', req.lead.email], ['Téléphone', req.lead.tel]], bouton: { texte: 'Répondre', lien: lienCrm(req, 'messages/' + req.lead.id), ecran: 'la conversation' }, pied: 'Messages' })
    }).catch((err) => console.error('[messages] email agence échoué :', err.message));
  }
  res.json({ ok: true, message: messageSortant(m) });
});
app.get('/api/messages', requireAdmin, (req, res) => {
  const db = readDb();
  const parLead = {};
  (db.messages || []).forEach((m) => { (parLead[m.leadId] = parLead[m.leadId] || []).push(m); });
  const conversations = Object.keys(parLead).filter((id) => conversationVisible(req, db, id)).map((id) => {
    const l = db.leads.find((x) => x.id === id) || {};
    const fil = parLead[id];
    const dernier = fil[fil.length - 1];
    return { leadId: id, nom: nomComplet(l) || l.email || 'Membre', email: l.email || '', dernier: messageSortant(dernier), nonLus: fil.filter((m) => m.de === 'membre' && !m.luAgence).length };
  }).sort((a, b) => String(b.dernier.at).localeCompare(String(a.dernier.at)));
  res.json({ ok: true, conversations: conversations });
});
app.get('/api/messages/:leadId', requireAdmin, (req, res) => {
  const db = readDb();
  if (!conversationVisible(req, db, req.params.leadId)) return res.status(404).json({ error: 'Conversation introuvable.' });
  const fil = (db.messages || []).filter((m) => m.leadId === req.params.leadId);
  let change = false;
  fil.forEach((m) => { if (m.de === 'membre' && !m.luAgence) { m.luAgence = true; change = true; } });
  if (change) writeDb(db);
  res.json({ ok: true, messages: fil.map(messageSortant) });
});
app.post('/api/messages/:leadId', requireAdmin, (req, res) => {
  const texte = String((req.body && req.body.texte) || '').trim().slice(0, MESSAGE_MAX);
  if (!texte) return res.status(400).json({ error: 'Message vide.' });
  const db = readDb();
  const lead = db.leads.find((l) => l.id === req.params.leadId);
  if (!lead || !conversationVisible(req, db, lead.id)) return res.status(404).json({ error: 'Membre introuvable.' });
  // Un message n'arrive que dans l'espace membre (membre accepté) ou par email.
  if (lead.statut !== 'accepte' && !String(lead.email || '').trim()) return res.status(409).json({ error: 'Ce contact n’a ni email ni espace membre : le message ne lui arriverait pas. Ajoutez son email, ou appelez-le.', code: 'SANS_CONTACT' });
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  const m = { id: uid('msg'), leadId: lead.id, de: 'agent', auteur: String((req.body && req.body.signature) || '').trim().slice(0, 80) || nomComplet(req.lead) || DEFAULT_AGENT_NOM, texte: texte, at: nowISO(), luMembre: false, luAgence: true };
  db.messages.push(m);
  const membre = lead.statut === 'accepte';
  if (membre) {
    // Membre accepté : notification dans son espace + email qui l'y renvoie.
    const resume = m.auteur + ' vous a répondu : « ' + texte.slice(0, 300) + (texte.length > 300 ? '…' : '') + ' »';
    db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
    db.notifications.push({ id: uid('ntf'), leadId: lead.id, email: lead.email || '', titre: 'Nouveau message de votre agent', message: resume, lien: originOf(req) + '/espace.html#/messages', lue: false, type: 'message', cree: nowISO() });
    if (mailer && lead.email) {
      mailer.sendMail({
        from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: lead.email, subject: 'Nouveau message de votre agent Seecret',
        html: emailValidationLegere(escHtml(lead.prenom || ''), escHtml(resume) + '<br><br><a href="' + originOf(req) + '/espace.html#/messages" style="color:#141210">Répondre dans votre espace</a>')
      }).catch((err) => console.error('[messages] email membre échoué :', err.message));
    }
  } else if (mailer && lead.email) {
    // Pas encore accepté : son espace est fermé (aucun code de connexion ne
    // part). Le message entier part donc par email ; il répond par email.
    mailer.sendMail({
      from: '"' + String(m.auteur).replace(/"/g, '') + ' · Seecret" <' + FROM_EMAIL + '>', to: lead.email, replyTo: CONTACT_EMAIL,
      subject: 'Votre candidature Seecret · un message de ' + m.auteur,
      html: emailValidationLegere(escHtml(lead.prenom || ''), escHtml(texte).replace(/\n/g, '<br>') + '<br><br><span style="color:#141210">' + escHtml(m.auteur) + '</span><br>Seecret · Club immobilier privé<br><br><span style="font-size:13px">Pour répondre, répondez simplement à cet email (' + escHtml(CONTACT_EMAIL) + ').</span>')
    }).catch((err) => console.error('[messages] email candidat échoué :', err.message));
  }
  writeDb(db);
  res.json({ ok: true, message: messageSortant(m) });
});

// Navigation en musique (option) : ambiance choisie par le membre, ou son
// propre lien Spotify / YouTube. Seuls ces deux lecteurs sont acceptés.
function lienMusique(u) {
  const s = String(u || '').trim();
  let m = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album|track|artist)\/([A-Za-z0-9]{10,40})/.exec(s);
  if (m) return { source: 'spotify', type: m[1], id: m[2] };
  m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(s);
  if (m) return { source: 'youtube', type: 'video', id: m[1] };
  m = /youtube\.com\/(?:playlist|watch)\?(?:.*&)?list=([\w-]{10,60})/.exec(s);
  if (m) return { source: 'youtube', type: 'playlist', id: m[1] };
  return null;
}
app.put('/api/membre/musique', requireAuth, (req, res) => {
  const body = req.body || {};
  if (body.actif === false) {
    req.lead.musique = { actif: false, choisiLe: nowISO() };
  } else {
    const ambiance = String(body.ambiance || '').slice(0, 30);
    let lien = null;
    if (body.lien) { lien = lienMusique(body.lien); if (!lien) return res.status(400).json({ error: 'Lien non reconnu : collez un lien de playlist, d’album ou de titre Spotify, ou un lien YouTube.' }); }
    if (!ambiance && !lien) return res.status(400).json({ error: 'Choisissez une ambiance.' });
    req.lead.musique = { actif: true, ambiance: lien ? '' : ambiance, lien: lien, choisiLe: nowISO() };
  }
  writeDb(req.db);
  res.json({ ok: true, musique: req.lead.musique });
});

app.get('/api/catalogue', requireAuth, (req, res) => {
  const db = req.db;
  // Même recherche que bienDuMembre(), mais sans créer de brouillon ici —
  // consulter le catalogue ne doit pas avoir d'effet de bord sur "mon bien".
  const monBien = db.biens.find((x) => x.leadId === req.lead.id || (x.email || '').toLowerCase() === (req.lead.email || '').toLowerCase());
  // Seuls deux statuts existent réellement pour un membre : "avant-première"
  // (visible, visites pas encore ouvertes) et "ouvert" (visite ouverte). Dès
  // qu'un bien passe sous offre, sous compromis ou vendu, il quitte purement
  // et simplement la plateforme — ce ne sont pas des badges à afficher, ce
  // sont des étapes internes au suivi de la vente par l'agence (CRM).
  const biens = db.biens.filter((b) => bienSurPlateforme(b) && (!monBien || b.id !== monBien.id));
  const reduit = aVenduChezNous(db, req.lead);
  res.json({ ok: true, biens: biens.map((b) => bienCatalogue(b, req.lead, reduit)) });
});

app.patch('/api/mon-bien', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const body = req.body || {};
  // Une fois le bien validé par l'agence, plus aucune modification directe :
  // tout changement passe par une demande de modification (POST
  // /api/mon-bien/modification) que l'agent valide dans le CRM.
  if (b.validation === 'valide') {
    return res.status(409).json({ error: 'Votre bien est validé par l’agence : envoyez une demande de modification, votre agent la valide.' });
  }
  ['titre', 'description', 'coupDeCoeur', 'adresse', 'codePostal', 'ville', 'type', 'quartier', 'transaction', 'etage', 'dpe', 'ges', 'etat', 'exterieur']
    .forEach((k) => { if (typeof body[k] === 'string') b[k] = body[k].slice(0, 400); });
  ['surface', 'pieces', 'chambres', 'sdb', 'surfaceExterieur', 'anneeConstruction', 'charges']
    .forEach((k) => { if (body[k] !== undefined) b[k] = Math.max(0, Number(body[k]) || 0); });
  if (body.prix !== undefined) changerPrixNet(b, body.prix, nomComplet(req.lead), 'propriétaire');
  if (typeof body.ascenseur === 'boolean') b.ascenseur = body.ascenseur;
  if (Array.isArray(body.annexes)) b.annexes = body.annexes.map(String).slice(0, 20);
  // Avant ce correctif, un membre pouvait aussi passer directement à "ouvert"
  // (visite ouverte) ou "mandat" ("en vente") ici — un raccourci qui
  // court-circuitait entièrement l'agent. Seul le passage brouillon→avant-
  // première (publier son annonce pour relecture) reste une action du
  // membre ; l'ouverture des visites passe désormais UNIQUEMENT par
  // POST /api/mon-bien/visibilite (demande) → décision de l'agent, et
  // "mandat" est un statut interne au CRM que seul l'agent manie.
  if (['brouillon', 'avant-premiere'].indexOf(body.statut) > -1) {
    const avant = b.statut;
    // Publier = demander la mise en ligne : l'agent valide (statut « À valider »).
    b.statut = body.statut === 'avant-premiere' && b.validation !== 'valide' ? 'a_valider' : body.statut;
    if (avant === 'brouillon' && (b.statut === 'avant-premiere' || b.statut === 'a_valider')) {
      logActivite(req.db, { leadId: req.lead.id, bienId: b.id, type: 'mise_au_catalogue', auteur: nomComplet(req.lead) });
    }
  }
  writeDb(req.db);
  res.json({ ok: true, bien: bienPublic(b) });
});

// ---- Photos du bien ----
// Une fois le bien validé par l'agent, le membre ne modifie plus ses photos :
// il écrit à son agent, qui les gère depuis le CRM.
const PHOTOS_VERROUILLEES = 'Vos photos ont été validées par votre agent : écrivez-lui pour les modifier.';
app.post('/api/mon-bien/photos', requireAuth, upload.array('photos', 8), (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  if (b.validation === 'valide') {
    (req.files || []).forEach((f) => { try { fs.unlinkSync(f.path); } catch (e) { /* déjà absent */ } });
    return res.status(409).json({ error: PHOTOS_VERROUILLEES });
  }
  const urls = (req.files || []).map((f) => '/uploads/' + f.filename);
  b.photos = (b.photos || []).concat(urls).slice(0, 12);
  writeDb(req.db);
  res.json({ ok: true, photos: b.photos });
});

app.delete('/api/mon-bien/photos', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  if (b.validation === 'valide') return res.status(409).json({ error: PHOTOS_VERROUILLEES });
  const url = String((req.body && req.body.url) || '');
  b.photos = (b.photos || []).filter((p) => p !== url);
  writeDb(req.db);
  res.json({ ok: true, photos: b.photos });
});

app.patch('/api/mon-bien/photos', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  if (b.validation === 'valide') return res.status(409).json({ error: PHOTOS_VERROUILLEES });
  // Nouvel ordre complet (glisser-déposer) : mêmes photos, autre ordre.
  if (Array.isArray(req.body && req.body.ordre)) {
    const ordre = req.body.ordre.map(String);
    const actuelles = (b.photos || []).slice();
    if (ordre.length !== actuelles.length || ordre.slice().sort().join('\n') !== actuelles.slice().sort().join('\n')) return res.status(400).json({ error: 'Ordre des photos invalide : rechargez la page.' });
    b.photos = ordre;
    writeDb(req.db);
    return res.json({ ok: true, photos: b.photos });
  }
  const url = String((req.body && req.body.principale) || '');
  if ((b.photos || []).indexOf(url) === -1) return res.status(404).json({ error: 'Photo introuvable' });
  b.photos = [url].concat(b.photos.filter((p) => p !== url));
  writeDb(req.db);
  res.json({ ok: true, photos: b.photos });
});

// ---- Demande de visibilité ----
// Seule demande possible côté membre, désormais : l'ouverture des visites.
// "vente" (mandat) n'est plus une cible atteignable depuis la plateforme —
// c'est un statut interne au CRM, piloté par l'agent (fiche bien côté CRM).
app.post('/api/mon-bien/visibilite', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const cible = 'ouvert';
  b.statutDemande = cible;
  b.demandeAt = nowISO();
  const demande = {
    id: uid('d'), type: 'statut', leadId: req.lead.id, bienId: b.id, email: req.lead.email,
    nom: nomComplet(req.lead),
    message: 'Demande de passage en visite ouverte',
    role: cible, montant: 0, statut: 'nouvelle', source: 'Espace membre', cree: nowISO()
  };
  req.db.demandes.unshift(demande);
  creerTacheDemande(req.db, demande, 'Traiter la demande de statut de ' + nomComplet(req.lead));
  writeDb(req.db);
  res.json({ ok: true, statutDemande: cible });
});

app.post('/api/mon-bien/modification', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const type = String((req.body && req.body.type) || 'Autre');
  const message = String((req.body && req.body.message) || '');
  const prix = Number((req.body && req.body.prix) || 0) || 0;
  const nouveauTitre = String((req.body && req.body.titre) || '');
  const nouvelleDescription = String((req.body && req.body.description) || '');
  const nouveauCoupDeCoeur = String((req.body && req.body.coupDeCoeur) || '').trim().slice(0, 280);
  if (!message && !prix && !nouveauTitre && !nouvelleDescription && !nouveauCoupDeCoeur) return res.status(400).json({ error: 'Aucune modification précisée' });
  const role = (type === 'Prix' || prix > 0) ? 'prix' : (type.indexOf('Statut') > -1 ? 'statut' : 'autre');
  const demande = {
    id: uid('d'), type: 'modification', role: role, leadId: req.lead.id, bienId: b.id,
    email: req.lead.email, nom: nomComplet(req.lead),
    message: type + ' — ' + message,
    prix: prix || null, titre: nouveauTitre || null, description: nouvelleDescription || null,
    coupDeCoeur: nouveauCoupDeCoeur && nouveauCoupDeCoeur !== (b.coupDeCoeur || '') ? nouveauCoupDeCoeur : null,
    ancienPrix: b.prix || 0, ancienTitre: b.titre || '', ancienDescription: b.description || '',
    montant: 0, statut: 'nouvelle', source: 'Espace membre', cree: nowISO()
  };
  req.db.demandes.unshift(demande);
  creerTacheDemande(req.db, demande, 'Modification de bien : ' + nomComplet(req.lead));
  writeDb(req.db);
  res.json({ ok: true, id: demande.id });
});

// ---- Ma recherche (modification directe par le membre) ----
app.get('/api/mon-recherche', requireAuth, (req, res) => {
  const r = rechercheDuMembre(req.db, req.lead);
  res.json({ ok: true, recherche: r });
});

app.patch('/api/mon-recherche', requireAuth, (req, res) => {
  const r = rechercheDuMembre(req.db, req.lead, true);
  const body = req.body || {};
  if (typeof body.prixMax !== 'undefined') r.prixMax = Math.max(0, Number(body.prixMax) || 0);
  if (typeof body.piecesMin !== 'undefined') r.piecesMin = Math.max(0, Number(body.piecesMin) || 0);
  if (typeof body.surfaceMin !== 'undefined') r.surfaceMin = Math.max(0, Number(body.surfaceMin) || 0);
  if (typeof body.surfaceMax !== 'undefined') r.surfaceMax = Math.max(0, Number(body.surfaceMax) || 0);
  if (Array.isArray(body.quartiers)) r.quartiers = body.quartiers.map(String).slice(0, 30);
  if (Array.isArray(body.types)) r.types = body.types.map(String).slice(0, 10);
  if (typeof body.type === 'string') r.type = body.type.slice(0, 40);
  if (typeof body.delai === 'string') r.delai = body.delai.slice(0, 60);
  if (typeof body.etageMin !== 'undefined') r.etageMin = Math.max(0, Number(body.etageMin) || 0);
  if (typeof body.etageMax !== 'undefined') r.etageMax = Math.max(0, Number(body.etageMax) || 0);
  if (typeof body.etat === 'string') r.etat = body.etat.slice(0, 30);
  if (typeof body.dpe === 'string') r.dpe = body.dpe.slice(0, 2);
  if (Array.isArray(body.annexes)) r.annexes = body.annexes.map(String).slice(0, 20);
  if (typeof body.prixVenteEstime !== 'undefined') r.prixVenteEstime = Math.max(0, Number(body.prixVenteEstime) || 0);
  if (typeof body.bienAVendre === 'boolean') r.bienAVendre = body.bienAVendre;
  writeDb(req.db);
  res.json({ ok: true, recherche: r });
});

// ---- Documents de vérification ----
app.get('/api/documents', requireAuth, (req, res) => {
  res.json({ ok: true, documents: (req.lead.documents || []).slice().reverse(), types: TYPES_DOC });
});

app.post('/api/documents', requireAuth, upload.single('fichier'), (req, res) => {
  const type = String((req.body && req.body.type) || '');
  if (!TYPES_DOC[type]) return res.status(400).json({ error: 'Type de document inconnu' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  req.lead.documents = req.lead.documents || [];
  const doc = {
    id: uid('doc'), type: type, nom: req.file.originalname,
    fichier: '/uploads/' + req.file.filename, mime: req.file.mimetype,
    taille: req.file.size, statut: 'a_verifier', cree: nowISO()
  };
  req.lead.documents.push(doc);
  logActivite(req.db, { leadId: req.lead.id, type: 'document_envoye', auteur: nomComplet(req.lead) + ' (client)' });
  writeDb(req.db);
  res.json({ ok: true, document: doc });
});

// ---- Vérification Off-Market (données conservées pour l'agent) ----
function offMarketOf(db, id) {
  const store = db.offMarket || {};
  return store[id] || { plateformes: [], url: '', correspondance: false, enAttente: false, at: null };
}

app.get('/api/biens/:id/offmarket', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, offMarket: offMarketOf(db, req.params.id) });
});

app.patch('/api/biens/:id/offmarket', requireAdmin, (req, res) => {
  const db = readDb();
  const cur = offMarketOf(db, req.params.id);
  const b = req.body || {};
  if (Array.isArray(b.plateformes)) cur.plateformes = b.plateformes.map(String).slice(0, 20);
  if (typeof b.url === 'string') cur.url = b.url.trim().slice(0, 500);
  if (typeof b.correspondance === 'boolean') cur.correspondance = b.correspondance;
  // URL renseignée sans confirmation de non-correspondance → blocage.
  cur.enAttente = !!cur.url && !cur.correspondance;
  cur.at = nowISO();
  db.offMarket[req.params.id] = cur;

  const bien = db.biens.find((x) => x.id === req.params.id);
  if (bien) {
    bien.offMarket = cur;
    if (cur.enAttente) bien.statut = 'en_attente_offmarket';
    else if (bien.statut === 'en_attente_offmarket') bien.statut = 'brouillon';
  }
  writeDb(db);
  res.json({ ok: true, offMarket: cur, statut: bien ? bien.statut : null });
});

// ---- Scanner Off-Market (Google Dorking, vérification assistée) ----
const MARKET_PLATEFORMES = [
  { label: 'Le Bon Coin', domaine: 'leboncoin.fr' },
  { label: 'SeLoger', domaine: 'seloger.com' },
  { label: 'PAP', domaine: 'pap.fr' },
  { label: 'Bien\u2019ici', domaine: 'bienici.com' },
  { label: 'Figaro Immo', domaine: 'immobilier.lefigaro.fr' },
  { label: 'Belle Demeure', domaine: 'belledemeure.com' }
];

// Best-effort : tente de détecter une annonce sur un portail via une recherche Google.
// En cas de blocage ou d'ambiguïté, on renvoie 'bloque' sans planter : l'agent vérifie
// manuellement via les liens de recherche générés.
function detecterDoublon(url, domaine) {
  return new Promise((resolve) => {
    let regle = false;
    const finir = (v) => { if (!regle) { regle = true; clearTimeout(timer); resolve(v); } };
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = setTimeout(() => { if (controller) controller.abort(); finir('bloque'); }, 6000);
    fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'fr-FR,fr;q=0.9'
      },
      signal: controller ? controller.signal : undefined
    }).then((r) => {
      if (!r.ok) { finir('bloque'); return null; }
      return r.text();
    }).then((txt) => {
      if (txt == null) return;
      const bas = String(txt).toLowerCase();
      if (/unusual traffic|recaptcha|captcha|consent\.google|our systems have detected/i.test(bas)) { finir('bloque'); return; }
      if (/did not match any documents|aucun document ne correspond|no results found/i.test(bas)) { finir('aucun'); return; }
      // Signal positif : un lien de résultat pointe réellement vers le domaine
      // (et pas le simple écho « site:… » de la requête).
      const re = new RegExp('https?:\\/\\/[^"\\s]*' + domaine.replace(/\./g, '\\.'), 'i');
      finir(re.test(bas) ? 'trouve' : 'bloque');
    }).catch(() => finir('bloque'));
  });
}

app.get('/api/market-search', requireAdmin, async (req, res) => {
  try {
    const adresse = String(req.query.adresse || '').trim();
    if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });
    const codePostal = (adresse.match(/\b\d{5}\b/) || [null])[0];
    const suffix = (codePostal && adresse.indexOf(codePostal) === -1) ? ' ' + codePostal : '';
    const requetes = MARKET_PLATEFORMES.map((p) => {
      const query = 'site:' + p.domaine + ' "' + adresse + '"' + suffix;
      return { plateforme: p.label, domaine: p.domaine, query: query, url: 'https://www.google.com/search?q=' + encodeURIComponent(query) };
    });

    const hits = await Promise.all(requetes.map((r) => detecterDoublon(r.url, r.domaine)));
    const trouves = [];
    let bloque = false;
    requetes.forEach((r, i) => {
      if (hits[i] === 'trouve') trouves.push(r);
      else if (hits[i] === 'bloque') bloque = true;
    });

    const statut = trouves.length ? 'doublon' : (bloque ? 'indetermine' : 'valide');
    res.json({ ok: true, adresse, codePostal, surface: req.query.surface || null, prix: req.query.prix || null, statut, trouves, requetes, bloque });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Scan impossible : ' + ((e && e.message) || 'erreur inconnue') });
  }
});

// ---- CRM ----
app.get('/api/biens', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, biens: db.biens.map(prixPourCrm) });
});

// Photos d'un bien, gérées par l'agent depuis le CRM (ajout ici ; ordre et
// suppression via PATCH /api/biens/:id { photos }).
app.post('/api/biens/:id/photos', requireAdmin, upload.array('photos', 8), (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  const fichiers = (req.files || []).filter((f) => /^image\//i.test(f.mimetype));
  if (!bien) { (req.files || []).forEach((f) => { try { fs.unlinkSync(f.path); } catch (e) { /* rien */ } }); return res.status(404).json({ error: 'Bien introuvable' }); }
  const place = 12 - (bien.photos || []).length;
  if (place <= 0) { (req.files || []).forEach((f) => { try { fs.unlinkSync(f.path); } catch (e) { /* rien */ } }); return res.status(400).json({ error: '12 photos maximum : retirez-en avant d’en ajouter.' }); }
  bien.photos = (bien.photos || []).concat(fichiers.slice(0, place).map((f) => '/uploads/' + f.filename));
  writeDb(db);
  res.json({ ok: true, photos: bien.photos, ignorees: Math.max(0, fichiers.length - place) });
});

app.patch('/api/biens/:id/valider', requireAdmin, (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  bien.validation = 'valide';
  bien.valideAt = nowISO();
  // Valider un bien en préparation / à valider le met en avant-première.
  if (['brouillon', 'a_valider', 'mandat', ''].indexOf(bien.statut || '') > -1) bien.statut = 'avant-premiere';
  bien.surSeecret = true;
  let notif = null;
  if (bien.leadId) {
    const lead = db.leads.find((l) => l.id === bien.leadId);
    logActivite(db, { leadId: bien.leadId, bienId: bien.id, type: 'bien_valide', auteur: 'Agent' });
    notif = notifierClient(db, {
      leadId: bien.leadId, email: (lead && lead.email) || bien.email, tel: (lead && lead.tel) || '', prenom: (lead && lead.prenom) || '',
      titre: 'Votre bien a été validé',
      message: 'Votre bien « ' + (bien.titre || bien.adresse || 'votre annonce') + ' » a été validé par l’agence et est désormais visible sur le marché Seecret.',
      lien: originOf(req) + '/espace.html'
    });
  }
  writeDb(db);
  res.json({ ok: true, validation: 'valide', notif: notif });
});

// ---- Enregistrement (PATCH) des fiches Lead / Bien / Recherche ----
app.patch('/api/leads/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const lead = db.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  const role = roleOf(req.lead);
  if (role !== 'superadmin' && !leadVisibleParAgent(lead, req.lead.id)) {
    return res.status(403).json({ error: 'Ce client est attribué à un autre agent.' });
  }
  const body = req.body || {};
  const avantLead = copieJournal(lead);
  // Seul le super-admin peut réattribuer un client à un autre agent.
  if (role === 'superadmin' && typeof body.agentId !== 'undefined') {
    lead.agentId = body.agentId ? String(body.agentId) : null;
  }
  ['prenom', 'nom', 'email', 'tel', 'ville', 'typeBien', 'source', 'notes', 'financement', 'natureLead', 'civilite', 'adresse', 'raisonSociale', 'siren', 'representant'].forEach((k) => { if (typeof body[k] === 'string') lead[k] = body[k]; });
  if (['personne', 'sci', 'societe'].indexOf(lead.natureLead) === -1) lead.natureLead = 'personne';
  // (siren inclus ci-dessus : utile pour un lead société retrouvé ensuite dans les registres publics)
  ['budgetMin', 'budgetMax', 'piecesMin', 'surfaceMin', 'surfaceMax', 'apport'].forEach((k) => { if (body[k] !== undefined) lead[k] = Math.max(0, Number(body[k]) || 0); });
  if (Array.isArray(body.quartiers)) lead.quartiers = body.quartiers.map(String);
  if (typeof body.courtier === 'boolean') lead.courtier = body.courtier;
  if (typeof body.bienAVendre === 'boolean') lead.bienAVendre = body.bienAVendre;
  // Pipeline Réseau (relance de masse — vue Réseau du CRM) : à_contacter / contacte /
  // a_relancer / converti / ecarte / hors_cible / a_completer. Avant ce correctif, ce
  // champ n'était en réalité jamais persisté côté serveur (une 2e route dupliquée plus
  // bas gérait ce champ mais n'était jamais atteinte — Express ne garde que la 1ère
  // route déclarée pour un même verbe+chemin) : les mouvements de pipeline restaient
  // coincés dans le localStorage du navigateur de l'agent, jamais partagés ni journalisés.
  if (typeof body.pipeline === 'string') {
    const avant = lead.pipeline;
    lead.pipeline = body.pipeline.slice(0, 40);
    if (avant !== lead.pipeline && (lead.pipeline === 'a_relancer' || lead.pipeline === 'converti')) {
      logActivite(db, { leadId: lead.id, type: lead.pipeline === 'converti' ? 'converti' : 'retour_silence', auteur: 'Agent' });
    }
  }
  // Le statut du formulaire CRM (prospect / actif / client…) n'est PAS le statut
  // d'accès du membre (en_attente / accepte / suspendu / refuse) : l'écraser
  // coupait la connexion d'un membre dès que l'agence enregistrait sa fiche.
  // L'accès ne change que par les routes dédiées (décision, /statut).
  if (typeof body.statut === 'string') {
    const ACCES = ['en_attente', 'accepte', 'suspendu', 'refuse'];
    if (ACCES.indexOf(lead.statut) > -1) lead.statutCrm = body.statut.slice(0, 20);
    else lead.statut = body.statut.slice(0, 20);
  }
  const modifsLead = champsModifies('lead', avantLead, lead);
  if (modifsLead.length) logActivite(db, { leadId: lead.id, type: 'modification', auteur: nomComplet(req.lead) || 'Agent', detail: modifsLead });
  writeDb(db);
  res.json({ ok: true, lead: lead });
});

// Avant ce correctif, un nouveau bien créé dans le CRM (formulaire "Nouveau
// bien") ne vivait que dans le localStorage de l'agent : aucune route POST
// n'existait, seul un PATCH existait pour un bien déjà connu du serveur.
// Concrètement, un bien jamais synchronisé ne pouvait ni être validé (le
// PATCH .../valider échouait en 404) ni, une fois le catalogue connecté au
// CRM, apparaître sur la plateforme. On lui donne une vraie création serveur,
// sur le modèle de POST /api/recherches.
app.post('/api/biens', requireAdmin, (req, res) => {
  const db = readDb();
  const body = req.body || {};
  const leadId = String(body.proprietaireId || body.leadId || '');
  const lead = leadId ? db.leads.find((l) => l.id === leadId) : null;
  if (leadId && !lead) return res.status(400).json({ error: 'Propriétaire introuvable — enregistrez d’abord le client.' });
  if (lead && roleOf(req.lead) !== 'superadmin' && !leadVisibleParAgent(lead, req.lead.id)) {
    return res.status(403).json({ error: 'Ce client est attribué à un autre agent.' });
  }
  const etageN = (() => { const n = Number(body.etage); return (body.etage === null || body.etage === '' || isNaN(n)) ? null : n; })();
  const bien = {
    id: uid('b'), leadId: lead ? lead.id : null, email: lead ? lead.email : '', nom: lead ? nomComplet(lead) : '',
    ref: String(body.ref || ''), titre: String(body.titre || '').trim() || titreEditorialImport(body),
    adresse: String(body.adresse || '').trim(), ville: String(body.ville || ''), codePostal: String(body.codePostal || ''),
    type: String(body.type || 'Appartement'), quartier: String(body.quartier || ''), transaction: 'Vente',
    surface: Math.max(0, Number(body.surface) || 0), pieces: Math.max(0, Number(body.pieces) || 0),
    chambres: Math.max(0, Number(body.chambres) || 0), sdb: Math.max(0, Number(body.sdb) || 0),
    etage: etageN, ascenseur: !!body.ascenseur, anneeConstruction: Math.max(0, Number(body.anneeConstruction) || 0),
    dpe: String(body.dpe || ''), ges: String(body.ges || ''), etat: String(body.etat || ''),
    exterieur: String(body.exterieur || ''), surfaceExterieur: Math.max(0, Number(body.surfaceExterieur) || 0),
    annexes: Array.isArray(body.annexes) ? body.annexes.map(String) : [],
    prix: Math.max(0, Number(body.prix) || 0), charges: Math.max(0, Number(body.charges) || 0),
    tauxHonoraires: tauxValide(body.tauxHonoraires),
    historiquePrix: Number(body.prix) > 0 ? [{ at: nowISO(), ancien: 0, nouveau: Math.max(0, Number(body.prix) || 0), auteur: nomComplet(req.lead) || 'Agent', source: 'création' }] : [],
    description: String(body.description || ''),
    photos: Array.isArray(body.photos) ? body.photos.map(String).slice(0, 12) : [],
    atouts: Array.isArray(body.atouts) ? body.atouts.map(String) : [],
    exclusivite: { statut: 'scan_en_cours', liens: [] },
    validation: ['avant-premiere', 'ouvert'].indexOf(String(body.statut || '')) > -1 ? 'valide' : 'en_attente', statut: String(body.statut || 'brouillon'), statutDemande: null,
    // Créé depuis le CRM : pas sur la plateforme tant que l'agent n'active pas « Sur Seecret ».
    surSeecret: body.surSeecret === true || (body.surSeecret !== false && ['avant-premiere', 'ouvert'].indexOf(String(body.statut || '')) > -1),
    agent: nomComplet(req.lead) || DEFAULT_AGENT_NOM, cree: nowISO()
  };
  db.biens.push(bien);
  if (lead) logActivite(db, { leadId: lead.id, bienId: bien.id, type: 'bien_cree', auteur: nomComplet(req.lead) || 'Agent' });
  writeDb(db);
  res.json({ ok: true, bien: prixPourCrm(bien) });
});

app.patch('/api/biens/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  const body = req.body || {};
  const avantBien = copieJournal(bien);
  // Date d'ouverture aux visites : sert au « record du mois » de la Gazette.
  if (body.statut === 'ouvert' && bien.statut !== 'ouvert') bien.ouvertLe = nowISO();
  // « Vendu » : l'agent précise si la vente a été faite par l'agence — seule
  // une vente par Seecret ouvre au propriétaire le taux réduit sur ses achats.
  if (body.statut === 'vendu') {
    if (typeof body.venduParAgence !== 'boolean' && bien.statut !== 'vendu') {
      return res.status(400).json({ error: 'Précisez si le bien a été vendu par Seecret.' });
    }
    if (typeof body.venduParAgence === 'boolean') bien.venduParAgence = body.venduParAgence;
    if (bien.statut !== 'vendu') bien.venduLe = nowISO(); // pour « vendu récemment dans votre secteur »
  } else if (typeof body.statut === 'string' && body.statut !== 'vendu') {
    delete bien.venduParAgence;
  }
  const statutAvant = bien.statut;
  ['ref', 'titre', 'adresse', 'ville', 'codePostal', 'type', 'quartier', 'dpe', 'ges', 'etat', 'statut', 'description', 'exterieur'].forEach((k) => { if (typeof body[k] === 'string') bien[k] = body[k]; });
  if (bien.statut === 'mandat') bien.statut = 'brouillon'; // ancien statut, retiré
  // Avant-première / En vente choisis par l'agent = bien validé et publié.
  let notifValidation = null;
  if ((bien.statut === 'avant-premiere' || bien.statut === 'ouvert') && statutAvant !== bien.statut) {
    if (body.surSeecret !== false) bien.surSeecret = true;
    if (bien.validation !== 'valide') {
      bien.validation = 'valide'; bien.valideAt = nowISO();
      if (bien.leadId) {
        const lead = db.leads.find((l) => l.id === bien.leadId);
        logActivite(db, { leadId: bien.leadId, bienId: bien.id, type: 'bien_valide', auteur: nomComplet(req.lead) || 'Agent' });
        notifValidation = notifierClient(db, { leadId: bien.leadId, email: (lead && lead.email) || bien.email, tel: (lead && lead.tel) || '', prenom: (lead && lead.prenom) || '',
          titre: 'Votre bien est en ligne', message: 'Votre bien « ' + (bien.titre || bien.adresse || 'votre annonce') + ' » a été validé par l’agence et est désormais visible des membres Seecret.', lien: originOf(req) + '/espace.html' });
      }
    }
    if (bien.statut === 'ouvert' && !bien.ouvertLe) bien.ouvertLe = nowISO();
  }
  // L'étage est un nombre comparable (0 = RDC) depuis #62 : un simple "typeof === 'string'"
  // ignorait silencieusement toute mise à jour envoyée par le CRM, y compris le cas RDC.
  if (body.etage !== undefined) {
    const n = Number(body.etage);
    bien.etage = (body.etage === null || body.etage === '' || isNaN(n)) ? null : n;
  }
  ['surface', 'pieces', 'chambres', 'sdb', 'charges', 'surfaceExterieur'].forEach((k) => { if (body[k] !== undefined) bien[k] = Math.max(0, Number(body[k]) || 0); });
  if (typeof body.ascenseur === 'boolean') bien.ascenseur = body.ascenseur;
  if (body.prix !== undefined) changerPrixNet(bien, body.prix, nomComplet(req.lead) || 'Agent', 'CRM');
  if (body.tauxHonoraires !== undefined) bien.tauxHonoraires = tauxValide(body.tauxHonoraires);
  if (Array.isArray(body.annexes)) bien.annexes = body.annexes.map(String);
  if (Array.isArray(body.atouts)) bien.atouts = body.atouts.map(String);
  if (Array.isArray(body.photos)) bien.photos = body.photos.map(String).slice(0, 12);
  if (typeof body.surSeecret === 'boolean') bien.surSeecret = body.surSeecret;
  if (typeof body.notesLibres === 'string') bien.notesLibres = body.notesLibres.slice(0, 5000);
  // « Sur Seecret » activé par l'agent : il veut le bien visible. S'il est déjà
  // validé mais encore en préparation, il passe en Avant-première ; s'il est
  // déjà en Avant-première / En vente sans validation, il devient validé.
  if (body.surSeecret === true && !bien.importLot) {
    if (bien.validation === 'valide' && ['brouillon', 'a_valider', ''].indexOf(bien.statut || '') > -1) bien.statut = 'avant-premiere';
    if ((bien.statut === 'avant-premiere' || bien.statut === 'ouvert') && bien.validation !== 'valide') { bien.validation = 'valide'; bien.valideAt = nowISO(); }
  }
  // Pipeline Propositions → Offres (étape 4 du plan de fusion) : étape avant
  // l'offre écrite, post-visite — à_présenter / présentée / réponse_reçue.
  if (['a_presenter', 'presentee', 'reponse_recue', ''].indexOf(body.etapeProposition) > -1) {
    bien.etapeProposition = body.etapeProposition || null;
  }
  const modifsBien = champsModifies('bien', avantBien, bien);
  if (modifsBien.length) logActivite(db, { leadId: bien.leadId, bienId: bien.id, type: 'modification', auteur: nomComplet(req.lead) || 'Agent', detail: modifsBien });
  writeDb(db);
  res.json({ ok: true, bien: prixPourCrm(bien), notif: notifValidation });
});

// Avant ce correctif, une recherche nouvellement créée dans le CRM ne
// vivait que dans le localStorage du navigateur (jamais de POST serveur,
// seul un PATCH existait, pour une recherche déjà connue du serveur) — donc
// invisible depuis un autre poste/agent, et hors de portée du filtrage par
// agent ci-dessus. On lui donne une vraie création côté serveur.
app.post('/api/recherches', requireAdmin, (req, res) => {
  const db = readDb();
  const body = req.body || {};
  const clientId = String(body.clientId || '');
  const client = db.leads.find((l) => l.id === clientId);
  if (!client) return res.status(400).json({ error: 'Client introuvable — enregistrez d’abord le client.' });
  if (roleOf(req.lead) !== 'superadmin' && !leadVisibleParAgent(client, req.lead.id)) {
    return res.status(403).json({ error: 'Ce client est attribué à un autre agent.' });
  }
  const rec = {
    id: uid('r'), clientId: clientId, titre: String(body.titre || 'Recherche').trim(),
    type: String(body.type || ''), types: Array.isArray(body.types) ? body.types.map(String) : [],
    prixMin: Math.max(0, Number(body.prixMin) || 0), prixMax: Math.max(0, Number(body.prixMax) || 0),
    piecesMin: Math.max(0, Number(body.piecesMin) || 0), chambresMin: Math.max(0, Number(body.chambresMin) || 0),
    sdbMin: Math.max(0, Number(body.sdbMin) || 0),
    surfaceMin: Math.max(0, Number(body.surfaceMin) || 0), surfaceMax: Math.max(0, Number(body.surfaceMax) || 0),
    etageMin: Math.max(0, Number(body.etageMin) || 0), etageMax: Math.max(0, Number(body.etageMax) || 0),
    dernierEtageOk: !!body.dernierEtageOk,
    dpe: String(body.dpe || ''), epoque: String(body.epoque || ''), etat: String(body.etat || ''), annexes: Array.isArray(body.annexes) ? body.annexes.map(String) : [],
    delai: String(body.delai || ''), financement: String(body.financement || ''),
    apport: Math.max(0, Number(body.apport) || 0), courtier: !!body.courtier, bienAVendre: !!body.bienAVendre,
    quartiers: Array.isArray(body.quartiers) ? body.quartiers.map(String) : [],
    statut: 'active', alertes: true, cree: nowISO()
  };
  db.recherches.push(rec);
  logActivite(db, { leadId: clientId, rechercheId: rec.id, type: 'recherche_creee', auteur: nomComplet(req.lead) || 'Agent' });
  writeDb(db);
  res.json({ ok: true, recherche: rec });
});

app.patch('/api/recherches/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const rec = db.recherches.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recherche introuvable' });
  if (roleOf(req.lead) !== 'superadmin') {
    const client = db.leads.find((l) => l.id === (rec.clientId || rec.leadId));
    if (!client || !leadVisibleParAgent(client, req.lead.id)) {
      return res.status(403).json({ error: 'Cette recherche appartient à un client attribué à un autre agent.' });
    }
  }
  const body = req.body || {};
  const avantRec = copieJournal(rec);
  ['titre', 'type', 'delai', 'financement', 'dpe', 'epoque', 'etat'].forEach((k) => { if (typeof body[k] === 'string') rec[k] = body[k]; });
  if (Array.isArray(body.annexes)) rec.annexes = body.annexes.map(String);
  ['prixMin', 'prixMax', 'piecesMin', 'chambresMin', 'sdbMin', 'surfaceMin', 'surfaceMax', 'etageMin', 'etageMax', 'apport'].forEach((k) => { if (body[k] !== undefined) rec[k] = Math.max(0, Number(body[k]) || 0); });
  if (Array.isArray(body.quartiers)) rec.quartiers = body.quartiers.map(String);
  if (Array.isArray(body.types)) rec.types = body.types.map(String);
  if (typeof body.courtier === 'boolean') rec.courtier = body.courtier;
  if (typeof body.bienAVendre === 'boolean') rec.bienAVendre = body.bienAVendre;
  if (typeof body.dernierEtageOk === 'boolean') rec.dernierEtageOk = body.dernierEtageOk;
  const modifsRec = champsModifies('recherche', avantRec, rec);
  if (modifsRec.length) logActivite(db, { leadId: rec.clientId || rec.leadId, rechercheId: rec.id, type: 'modification', auteur: nomComplet(req.lead) || 'Agent', detail: modifsRec });
  writeDb(db);
  res.json({ ok: true, recherche: rec });
});

// ---- Fiche produit (HTML imprimable en PDF) ----
// Clé serveur (créée une fois, sur le volume) pour signer les liens de fiche.
function cleServeur() {
  const fichier = path.join(DATA_DIR, 'secret.key');
  try { return fs.readFileSync(fichier, 'utf8').trim(); } catch (e) {
    const cle = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(fichier, cle, { mode: 0o600 }); } catch (e2) {}
    return cle;
  }
}
function jetonFiche(bienId) { return crypto.createHmac('sha256', cleServeur()).update('fiche:' + bienId).digest('hex').slice(0, 32); }

app.get('/api/biens/:id/pdf', (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  // Accès : lien signé envoyé par l'agence (?t=…), ou session de l'agence.
  const token = getCookie(req, SESSION_COOKIE);
  const session = token ? db.sessions.find((x) => x.id === sha256(token)) : null;
  const lecteur = session ? db.leads.find((l) => l.id === session.leadId) : null;
  const staff = lecteur && ROLES_STAFF.indexOf(roleOf(lecteur)) > -1;
  const jetonOk = bien && typeof req.query.t === 'string' && req.query.t.length === 32 && crypto.timingSafeEqual(Buffer.from(req.query.t), Buffer.from(jetonFiche(bien.id)));
  if (!bien || (!staff && !jetonOk)) return res.status(404).send('Fiche introuvable');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(ficheProduitHtml(bien));
});

// ---- Envoi d'un bien à un client (email) ----
app.post('/api/biens/:id/envoi', requireAdmin, async (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  const email = String((req.body && req.body.email) || '');
  const nom = String((req.body && req.body.nom) || '');
  const message = String((req.body && req.body.message) || '');
  if (!email) return res.status(400).json({ error: 'Email du destinataire requis' });
  const emailValide = validerEmail(email);
  if (!emailValide.ok) return res.status(400).json({ ok: false, emailEnvoye: false, emailErreur: 'Adresse email invalide ou non délivrable : ' + emailValide.raison });
  let emailEnvoye = false, emailErreur = '';
  if (mailer) {
    try {
      await mailer.sendMail({
        from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
        to: email,
        subject: (bien.titre || 'Un bien') + ' — ' + (bien.prix ? prixHai(bien.prix, tauxHonorairesPour(bien, null)).toLocaleString('fr-FR') + ' €' : ''),
        html: emailBienPreview(bien, nom, message) + '<p style="font-size:13px;color:#5f5a54;margin:18px 0 0;">Téléchargez la fiche confidentielle complète : <a href="' + originOf(req) + '/api/biens/' + bien.id + '/pdf?t=' + jetonFiche(bien.id) + '" style="color:#3b2b4a;">voir la fiche (PDF)</a></p>'
      });
      emailEnvoye = true;
    } catch (err) { emailErreur = (err && err.message) || 'Erreur SMTP'; }
  }
  res.json({ ok: true, emailEnvoye, emailErreur });
});

app.post('/api/biens/:id/exclusivite-scan', requireAdmin, async (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  try {
    const ex = await lancerScanExclusivite(bien.id);
    res.json({ ok: true, exclusivite: ex });
  } catch (e) {
    res.status(500).json({ error: 'Scan impossible : ' + ((e && e.message) || 'erreur') });
  }
});

// Archivage (jamais de suppression) : la fiche quitte les listes du CRM, la
// plateforme et le matching, reste consultable dans « Archivés » et peut être
// restaurée. Chaque archivage / restauration est inscrit dans l'historique.
app.post('/api/archives', requireAdmin, (req, res) => {
  const db = readDb();
  const body = req.body || {};
  const kind = ['lead', 'bien', 'recherche'].indexOf(body.kind) > -1 ? body.kind : '';
  if (!kind) return res.status(400).json({ error: 'Type de fiche inconnu' });
  const coll = kind === 'lead' ? db.leads : kind === 'bien' ? db.biens : db.recherches;
  const fiche = coll.find((x) => x.id === String(body.id || ''));
  if (!fiche) return res.status(404).json({ error: 'Fiche introuvable' });
  const leadId = kind === 'lead' ? fiche.id : (fiche.leadId || fiche.clientId || null);
  const lead = leadId ? db.leads.find((l) => l.id === leadId) : null;
  if (roleOf(req.lead) !== 'superadmin' && lead && !leadVisibleParAgent(lead, req.lead.id)) {
    return res.status(403).json({ error: 'Cette fiche appartient à un client attribué à un autre agent.' });
  }
  const archiver = body.archive !== false;
  const auteur = nomComplet(req.lead) || 'Agent';
  const appliquer = (k, f) => {
    if (archiver) { f.archive = true; f.archiveLe = nowISO(); f.archivePar = auteur; }
    else { delete f.archive; f.restaureLe = nowISO(); f.restaurePar = auteur; }
    logActivite(db, { leadId: k === 'lead' ? f.id : (f.leadId || f.clientId), bienId: k === 'bien' ? f.id : null, rechercheId: k === 'recherche' ? f.id : null, type: archiver ? 'archive' : 'restauration', auteur: auteur });
  };
  appliquer(kind, fiche);
  let recherchesAussi = 0;
  if (kind === 'lead' && body.avecRecherches) {
    db.recherches.filter((r) => (r.clientId === fiche.id || r.leadId === fiche.id) && !!r.archive !== archiver).forEach((r) => { appliquer('recherche', r); recherchesAussi++; });
  }
  writeDb(db);
  res.json({ ok: true, archive: archiver, recherches: recherchesAussi });
});

app.get('/api/recherches', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, recherches: recherchesVisibles(req, db) });
});

// Un bien n'est ouvert aux visites et aux offres qu'à partir du moment où
// son propriétaire l'a lui-même fait passer en « visite ouverte » — c'est le
// cœur du produit (voir la note de vision) : en avant-première, les autres
// membres peuvent le suivre et marquer leur intérêt, mais le propriétaire
// n'a pas encore accepté de recevoir des visites ou des offres. On vérifie
// ça côté serveur (pas seulement en cachant les boutons côté client) pour
// qu'aucun appel direct à l'API ne puisse contourner la règle.
const STATUTS_VISITABLES = ['ouvert', 'sous-offre', 'sous-compromis'];
function bienOuvertAuxVisites(b) {
  return !!b && STATUTS_VISITABLES.indexOf(b.statut) > -1;
}

// ---- Notifications (vues par le client dans son espace, à la reconnexion) ----
// Alimentée par notifierClient() à chaque validation/refus côté CRM
// (pièce, adhésion, bien, offre, modification, visite…) : le client retrouve
// ici le même message que celui envoyé par email, sans dépendre de sa boîte mail.
app.get('/api/mes-notifications', requireAuth, (req, res) => {
  const db = readDb();
  const mien = (n) => n.leadId === req.lead.id || (n.email || '').toLowerCase() === (req.lead.email || '').toLowerCase();
  const mes = (db.notifications || []).filter(mien).slice().sort((a, b) => new Date(b.cree) - new Date(a.cree));
  res.json({ ok: true, notifications: mes });
});

app.post('/api/mes-notifications/:id/lu', requireAuth, (req, res) => {
  const db = readDb();
  const n = (db.notifications || []).find((x) => x.id === req.params.id && (x.leadId === req.lead.id || (x.email || '').toLowerCase() === (req.lead.email || '').toLowerCase()));
  if (!n) return res.status(404).json({ error: 'Notification introuvable' });
  n.lue = true;
  n.lueAt = nowISO();
  writeDb(db);
  res.json({ ok: true });
});

// ---- Visites (demande du membre) ----
// ============================================================================
// MANDAT DE RECHERCHE — signature électronique simple par code envoyé par email
// ----------------------------------------------------------------------------
// Parcours : le membre demande une visite → s'il n'a pas de mandat valide, il
// signe le mandat de recherche (code à usage unique reçu par email) → l'agent
// confirme la visite (date + heure) → l'adresse exacte part par email (et par
// WhatsApp, un clic de l'agent). L'adresse n'est JAMAIS envoyée avant.
//
// Preuves conservées pour chaque signature : texte exact du mandat (gelé),
// empreinte SHA-256, date et heure, IP, navigateur, email de réception du code.
// C'est une signature électronique « simple » au sens du règlement eIDAS :
// valable, mais à faire valider (niveau suffisant ?) par le conseil de l'agence.
// Le texte du mandat est un MODÈLE : à relire et valider avant mise en ligne.
//
// Identité de l'agence : variables d'environnement (Railway → Variables). Tant
// que les mentions obligatoires manquent, aucun mandat n'est proposé au membre.
// ============================================================================
const MANDAT_VERSION = 'MR-2026-11-v1';
const MANDAT_CODE_TTL = 10 * 60 * 1000;

// Société exploitant la marque Seecret (données publiques SIRENE). Chaque
// valeur peut être remplacée par la variable d'environnement correspondante.
const AGENCE_DEFAUT = {
  raisonSociale: 'EASYMMOBILIER',
  forme: 'SAS au capital de 1 000 €',
  siren: '921 577 938',
  adresse: '18 rue Henri Say, 92600 Asnières-sur-Seine',
  representant: 'Gabriel Taieb, président',
  // Carte professionnelle (CCI France), « Transaction sur immeubles et fonds de commerce »
  carteT: 'CPI 9201 2023 000 000 081, délivrée par la CCI Paris Île-de-France',
  garantie: 'aucune, l’agence ne détenant aucun fonds, effet ou valeur pour le compte de ses clients (non-détention de fonds)',
  rcp: 'MMA IARD, 160 rue Henri Champion, 72030 Le Mans Cedex 9, contrat MMA PRO-PME n° 148 348 540'
};
function agence() {
  return {
    raisonSociale: String(process.env.AGENCE_RAISON_SOCIALE || AGENCE_DEFAUT.raisonSociale).trim(),
    forme: String(process.env.AGENCE_FORME || AGENCE_DEFAUT.forme).trim(),
    siren: String(process.env.AGENCE_SIREN || AGENCE_DEFAUT.siren).trim(),
    adresse: String(process.env.AGENCE_ADRESSE || AGENCE_DEFAUT.adresse).trim(),
    carteT: String(process.env.AGENCE_CARTE_T || AGENCE_DEFAUT.carteT).trim(),
    garantie: String(process.env.AGENCE_GARANTIE || AGENCE_DEFAUT.garantie).trim(),
    rcp: String(process.env.AGENCE_RCP || AGENCE_DEFAUT.rcp).trim(),
    representant: String(process.env.AGENCE_REPRESENTANT || AGENCE_DEFAUT.representant).trim(),
    mediateur: String(process.env.AGENCE_MEDIATEUR || '').trim(),
    tauxAcquereur: Number(process.env.AGENCE_TAUX_ACQUEREUR || 5),
    tauxMixte: Number(process.env.AGENCE_TAUX_MIXTE || 3),
    assiette: String(process.env.AGENCE_ASSIETTE || 'du prix de vente du bien hors honoraires (prix net vendeur)').trim(),
    nonContournementMois: Number(process.env.AGENCE_NON_CONTOURNEMENT_MOIS || 12)
  };
}
const AGENCE_OBLIGATOIRE = { raisonSociale: 'AGENCE_RAISON_SOCIALE', adresse: 'AGENCE_ADRESSE', carteT: 'AGENCE_CARTE_T', garantie: 'AGENCE_GARANTIE' };
function agenceManquants() {
  const a = agence();
  return Object.keys(AGENCE_OBLIGATOIRE).filter((k) => !a[k]).map((k) => AGENCE_OBLIGATOIRE[k]);
}

function ajouterMois(date, mois) { const d = new Date(date); d.setMonth(d.getMonth() + mois); return d; }
function dateLongue(iso) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }); } catch (e) { return String(iso); }
}
function dateHeure(iso) {
  try { return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Paris' }); } catch (e) { return String(iso); }
}

// Le mandat applicable : signé, non expiré, non révoqué (le plus récent).
function mandatApplicable(db, leadId) {
  const now = Date.now();
  return (db.mandats || [])
    .filter((m) => m.leadId === leadId && m.statut === 'signe' && new Date(m.expireLe).getTime() > now)
    .sort((a, b) => new Date(b.signature.at) - new Date(a.signature.at))[0] || null;
}

// Une visite peut-elle être confirmée sous ce mandat ? (délai de rétractation)
function mandatPermetVisite(m, dateVisite) {
  if (!m) return { ok: false, raison: 'Le membre n’a pas encore signé son mandat de recherche.' };
  const quand = dateVisite ? new Date(dateVisite).getTime() : Date.now();
  if (!m.demarrageAnticipe && quand < new Date(m.retractationFin).getTime()) {
    return { ok: false, apresRetractation: true, raison: 'Mandat signé le ' + dateLongue(m.signature.at) + ', sans demande d’exécution immédiate : la visite doit avoir lieu après la fin du délai de rétractation (' + dateLongue(m.retractationFin) + ').' };
  }
  return { ok: true };
}

function resumeMandat(m) {
  if (!m) return null;
  return {
    id: m.id, numero: m.numero, statut: m.statut, version: m.version, taux: m.taux,
    cree: m.cree, signeLe: m.signature ? m.signature.at : null, expireLe: m.expireLe || null,
    retractationFin: m.retractationFin || null, demarrageAnticipe: !!m.demarrageAnticipe,
    empreinte: m.document && m.document.sha256 ? m.document.sha256 : null
  };
}

function prochainNumeroMandat(db) {
  const annee = new Date().getFullYear();
  const n = (db.mandats || []).filter((m) => String(m.numero || '').indexOf('MR-' + annee + '-') === 0).length + 1;
  return 'MR-' + annee + '-' + String(n).padStart(4, '0');
}

function criteresTexte(r) {
  if (!r) return 'Tout bien présenté par le mandataire via la plateforme Seecret.';
  const bits = [];
  const types = (Array.isArray(r.types) && r.types.length) ? r.types : (r.type ? [r.type] : []);
  if (types.length) bits.push('type : ' + types.join(', '));
  if (Array.isArray(r.quartiers) && r.quartiers.length) bits.push('secteurs : ' + r.quartiers.map(labelQuartier).filter(Boolean).join(', '));
  if (r.prixMax) bits.push('budget maximum : ' + Number(r.prixMax).toLocaleString('fr-FR') + ' €');
  if (r.surfaceMin) bits.push('surface minimale : ' + r.surfaceMin + ' m²');
  if (r.piecesMin) bits.push(r.piecesMin + ' pièces minimum');
  return bits.length ? bits.join(' ; ') + '.' : 'Tout bien présenté par le mandataire via la plateforme Seecret.';
}

// Texte du mandat (modèle à faire valider). `s` = données du signataire figées
// au moment de la signature ; sans `s`, c'est l'aperçu montré avant signature.
function mandatCorpsHtml(m, s) {
  const a = m.agence;
  const e = escHtml;
  const blanc = '<span style="color:#b0472c">[à compléter]</span>';
  const v = (x) => (x ? e(x) : blanc);
  const signataire = s || {};
  return [
    '<h1>Mandat de recherche d’un bien immobilier</h1>',
    '<p class="ref">Mandat n° ' + (m.numero ? e(m.numero) : 'attribué à la signature') + ' — non exclusif — modèle ' + e(m.version) + '</p>',
    '<h2>Entre les soussignés</h2>',
    '<p><b>Le mandant</b> : ' + e(m.mandant.prenom + ' ' + m.mandant.nom) + ', adresse électronique ' + e(m.mandant.email) + (m.mandant.tel ? ', téléphone ' + e(m.mandant.tel) : '') + ', demeurant ' + (signataire.adresse ? e(signataire.adresse) : '<i>adresse indiquée lors de la signature</i>') + '.</p>',
    '<p><b>Le mandataire</b> : ' + v(a.raisonSociale) + (a.forme ? ', ' + e(a.forme) : '') + (a.siren ? ', SIREN ' + e(a.siren) : '') + ', dont le siège est ' + v(a.adresse) + ', titulaire de la carte professionnelle « Transaction sur immeubles et fonds de commerce » n° ' + v(a.carteT) + ', garantie financière : ' + v(a.garantie) + (a.rcp ? ', assurance responsabilité civile professionnelle : ' + e(a.rcp) : '') + (a.representant ? ', représenté par ' + e(a.representant) : '') + '. Activité régie par la loi n° 70-9 du 2 janvier 1970 (loi Hoguet) et son décret d’application n° 72-678 du 20 juillet 1972.</p>',
    '<h2>1. Objet</h2>',
    '<p>Le mandant charge le mandataire, qui accepte, de rechercher et de lui présenter un bien immobilier en vue de son acquisition, de lui faire visiter les biens retenus et de l’assister jusqu’à la signature de l’acte authentique. Critères de recherche : ' + e(m.criteres) + ' Le présent mandat couvre également tout bien présenté au mandant par le mandataire sur la plateforme Seecret pendant sa durée.</p>',
    '<h2>2. Durée</h2>',
    '<p>Le mandat est consenti pour une durée de douze (12) mois à compter de sa signature. Il prend fin de plein droit à son terme, sans reconduction tacite. Le mandant peut le résilier à tout moment par écrit (courrier ou email), sans frais ; la résiliation ne remet pas en cause les stipulations de l’article 6 pour les biens déjà présentés.</p>',
    '<h2>3. Rémunération du mandataire</h2>',
    '<p>En cas d’acquisition d’un bien présenté par le mandataire, le mandant versera au mandataire des honoraires de <b>' + e(String(m.taux).replace('.', ',')) + ' % TTC ' + e(a.assiette) + '</b>, conformément au barème affiché par le mandataire. Ces honoraires sont à la charge du mandant (acquéreur). Les prix communiqués sur la plateforme sont exprimés honoraires inclus.</p>',
    '<p>Conformément à l’article 6 de la loi du 2 janvier 1970, <b>aucune somme n’est due ni ne peut être exigée avant que l’opération ait été effectivement conclue</b>, c’est-à-dire constatée par un acte authentique de vente. Les visites, la présentation des biens et la signature du présent mandat ne donnent lieu à aucun paiement.</p>',
    '<h2>4. Obligations du mandataire</h2>',
    '<p>Le mandataire s’engage à rechercher des biens correspondant aux critères du mandant, à lui communiquer les informations utiles, à organiser les visites et à l’informer de l’avancement de sa mission. Il rendra compte de sa mission sur simple demande.</p>',
    '<h2>5. Confidentialité</h2>',
    '<p>Les biens présentés sur la plateforme Seecret sont confidentiels (« off-market »). Le mandant s’engage à ne communiquer à aucun tiers les informations reçues, notamment l’adresse des biens, l’identité des propriétaires et les documents transmis.</p>',
    '<h2>6. Non-contournement</h2>',
    '<p>Pendant la durée du mandat et pendant ' + e(String(a.nonContournementMois)) + ' mois après son expiration ou sa résiliation, le mandant s’interdit d’acquérir, directement ou par personne interposée, un bien qui lui a été présenté par le mandataire sans l’intermédiaire de celui-ci. À défaut, il sera redevable envers le mandataire d’une indemnité égale au montant des honoraires prévus à l’article 3.</p>',
    '<h2>7. Droit de rétractation</h2>',
    '<p>Le mandat étant conclu à distance, le mandant dispose d’un délai de quatorze (14) jours à compter de sa signature pour se rétracter, sans motif ni frais, par courrier ou par email adressé au mandataire (articles L. 221-18 et suivants du Code de la consommation). Si le mandant demande expressément que l’exécution du mandat (organisation de visites) commence avant la fin de ce délai, il conserve son droit de rétractation ; aucune somme n’est due à ce titre.</p>',
    '<p>Exécution avant la fin du délai de rétractation : <b>' + (s ? (s.demarrageAnticipe ? 'demandée expressément par le mandant' : 'non demandée — les visites auront lieu après la fin du délai') : '<i>choix effectué lors de la signature</i>') + '</b>.</p>',
    '<h2>8. Données personnelles</h2>',
    '<p>Les données du mandant sont traitées par le mandataire pour l’exécution du présent mandat et conservées pendant la durée nécessaire à cette exécution puis aux obligations légales (dont le registre des mandats). Le mandant dispose d’un droit d’accès, de rectification et d’effacement en écrivant au mandataire.</p>',
    '<h2>9. Signature électronique et remise</h2>',
    '<p>Le présent mandat est signé électroniquement par la saisie d’un code à usage unique adressé à l’adresse électronique du mandant. Le mandataire conserve le texte signé, son empreinte numérique, la date et l’heure de signature et les éléments techniques de la signature. Un exemplaire est remis au mandant par email dès la signature. Le mandat est inscrit au registre des mandats du mandataire sous le numéro ci-dessus.</p>'
  ].join('');
}

function mandatDocumentHtml(corps, signatureHtml) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mandat de recherche</title>' +
    '<style>body{margin:0;background:#faf9f7;color:#141210;font:15px/1.65 Georgia,"Times New Roman",serif}main{max-width:760px;margin:0 auto;padding:32px 20px 48px}h1{font-weight:400;font-size:28px;line-height:1.2;margin:0 0 4px}h2{font-size:15px;letter-spacing:.04em;text-transform:uppercase;margin:26px 0 6px;font-family:Arial,sans-serif}.ref{color:#5f5a54;font-size:13px;margin:0 0 18px;font-family:Arial,sans-serif}.sig{margin-top:30px;padding:18px 20px;border:1px solid #d9d3cb;border-radius:14px;background:#fff;font:13px/1.6 Arial,sans-serif}.sig code{word-break:break-all}@media print{body{background:#fff}}</style></head><body><main>' +
    corps + (signatureHtml || '') + '</main></body></html>';
}

function preparerMandat(db, lead) {
  const a = agence();
  const r = rechercheDuMembre(db, lead);
  const m = {
    id: uid('mdt'), numero: null, version: MANDAT_VERSION, type: 'recherche', perimetre: 'global',
    leadId: lead.id, statut: 'a_signer', cree: nowISO(),
    taux: lead.projet === 'mixte' ? a.tauxMixte : a.tauxAcquereur,
    agence: a,
    mandant: { prenom: lead.prenom || '', nom: lead.nom || '', email: lead.email || '', tel: lead.tel || '' },
    criteres: criteresTexte(r),
    code: null, signature: null, document: null
  };
  db.mandats = Array.isArray(db.mandats) ? db.mandats : [];
  db.mandats.push(m);
  return m;
}

function mandatEnCours(db, leadId) {
  return (db.mandats || []).filter((m) => m.leadId === leadId && m.statut === 'a_signer').slice(-1)[0] || null;
}

// État du mandat pour le membre connecté (et texte à lire avant de signer).
app.get('/api/mandat', requireAuth, (req, res) => {
  const db = req.db;
  const actif = mandatApplicable(db, req.lead.id);
  if (actif) return res.json({ ok: true, mandat: resumeMandat(actif), visitePossible: mandatPermetVisite(actif) });
  if (req.query.apercu === '0') return res.json({ ok: true, mandat: null });
  const manquants = agenceManquants();
  if (manquants.length) return res.json({ ok: true, mandat: null, indisponible: true, message: 'Le mandat de recherche est en cours de mise en place par l’agence. Votre demande de visite est bien enregistrée : votre agent revient vers vous rapidement.' });
  let m = mandatEnCours(db, req.lead.id);
  if (!m) m = preparerMandat(db, req.lead);
  else {
    // Brouillon non signé : on le remet à jour (identité de l'agence, barème,
    // critères) pour que le texte signé soit exactement celui affiché.
    const a = agence();
    m.agence = a;
    m.taux = req.lead.projet === 'mixte' ? a.tauxMixte : a.tauxAcquereur;
    m.criteres = criteresTexte(rechercheDuMembre(db, req.lead));
    m.mandant = { prenom: req.lead.prenom || '', nom: req.lead.nom || '', email: req.lead.email || '', tel: req.lead.tel || '' };
  }
  writeDb(db);
  res.json({ ok: true, mandat: resumeMandat(m), apercu: mandatCorpsHtml(m, null) });
});

// Envoi du code à usage unique (6 chiffres, 10 minutes, 5 envois par heure).
app.post('/api/mandat/code', requireAuth, async (req, res) => {
  const db = req.db;
  if (agenceManquants().length) return res.status(409).json({ error: 'Le mandat n’est pas encore disponible.' });
  const m = mandatEnCours(db, req.lead.id);
  if (!m) return res.status(404).json({ error: 'Aucun mandat à signer.' });
  const heure = Date.now() - 60 * 60 * 1000;
  m.envoisCode = (m.envoisCode || []).filter((t) => t > heure);
  if (m.envoisCode.length >= 5) return res.status(429).json({ error: 'Trop de codes demandés. Réessayez dans une heure.' });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  m.code = { hash: sha256(m.id + ':' + code), expire: Date.now() + MANDAT_CODE_TTL, tentatives: 0, envoyeA: req.lead.email, envoyeLe: nowISO() };
  m.envoisCode.push(Date.now());
  writeDb(db);
  let emailEnvoye = false;
  if (mailer && req.lead.email) {
    try {
      await mailer.sendMail({
        from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: req.lead.email,
        subject: 'Votre code de signature : ' + code,
        html: emailValidationLegere(req.lead.prenom || '', 'Voici votre code pour signer votre mandat de recherche : <b style="font-size:22px;letter-spacing:.2em;color:#141210">' + code + '</b><br>Il est valable 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.')
      });
      emailEnvoye = true;
    } catch (err) { console.error('[mandat] email du code échoué :', err.message); }
  }
  if (!emailEnvoye) return res.status(502).json({ error: 'L’email n’a pas pu être envoyé. Réessayez dans un instant ou contactez votre agent.' });
  res.json({ ok: true, envoyeA: req.lead.email.replace(/^(.).*(@.*)$/, '$1•••$2') });
});

// Signature : vérification du code, gel du texte, empreinte, preuves, remise par email.
app.post('/api/mandat/signer', requireAuth, async (req, res) => {
  const db = req.db;
  const body = req.body || {};
  const m = mandatEnCours(db, req.lead.id);
  if (!m) return res.status(404).json({ error: 'Aucun mandat à signer.' });
  const adresse = String(body.adresse || '').trim().slice(0, 300);
  if (adresse.length < 8) return res.status(400).json({ error: 'Indiquez votre adresse postale complète.' });
  if (body.accepte !== true) return res.status(400).json({ error: 'Vous devez accepter les termes du mandat.' });
  if (!m.code || Date.now() > m.code.expire) return res.status(400).json({ error: 'Code expiré : demandez un nouveau code.' });
  if (m.code.tentatives >= 5) return res.status(429).json({ error: 'Trop de tentatives : demandez un nouveau code.' });
  const code = String(body.code || '').replace(/\D/g, '');
  if (sha256(m.id + ':' + code) !== m.code.hash) {
    m.code.tentatives++;
    writeDb(db);
    return res.status(400).json({ error: 'Code incorrect.' });
  }
  const signeLe = nowISO();
  m.numero = prochainNumeroMandat(db); // numéro au registre des mandats, attribué à la signature
  const signataire = { adresse: adresse, demarrageAnticipe: body.demarrageAnticipe === true };
  const corps = mandatCorpsHtml(m, signataire);
  const empreinte = crypto.createHash('sha256').update(corps, 'utf8').digest('hex');
  const ip = clientIp(req);
  const ua = (req.get('user-agent') || '').slice(0, 300);
  const blocSignature = '<div class="sig"><b>Signé électroniquement</b> par ' + escHtml(m.mandant.prenom + ' ' + m.mandant.nom) +
    ' le ' + escHtml(dateHeure(signeLe)) + ' (heure de Paris).<br>Méthode : code à usage unique envoyé à ' + escHtml(m.code.envoyeA) + ' le ' + escHtml(dateHeure(m.code.envoyeLe)) + '.<br>Adresse IP : ' + escHtml(ip) +
    '<br>Empreinte SHA-256 du texte signé : <code>' + empreinte + '</code><br>Mandat n° ' + escHtml(m.numero) + ' — valable jusqu’au ' + escHtml(dateLongue(ajouterMois(signeLe, 12).toISOString())) + '.</div>';
  m.statut = 'signe';
  m.signature = { at: signeLe, ip: ip, ua: ua, methode: 'code-email', email: m.code.envoyeA, codeEnvoyeLe: m.code.envoyeLe };
  m.adresseMandant = adresse;
  m.demarrageAnticipe = signataire.demarrageAnticipe;
  m.document = { html: mandatDocumentHtml(corps, blocSignature), sha256: empreinte };
  m.expireLe = ajouterMois(signeLe, 12).toISOString();
  m.retractationFin = new Date(new Date(signeLe).getTime() + 14 * 24 * 3600 * 1000).toISOString();
  m.code = null;
  // Les demandes de visite en attente de ce membre passent « mandat signé ».
  (db.demandes || []).forEach((d) => {
    if (d.type === 'visite' && d.leadId === req.lead.id && d.statut === 'nouvelle') {
      d.mandatId = m.id;
      const t = (db.tasks || []).find((x) => x.demandeId === d.id && x.statut === 'en_attente');
      if (t && t.titre && t.titre.indexOf('mandat signé') === -1) t.titre += ' — mandat signé, visite à confirmer';
    }
  });
  logActivite(db, { leadId: req.lead.id, type: 'mandat_signe', auteur: nomComplet(req.lead) + ' (mandat ' + m.numero + ')' });
  writeDb(db);
  // Remise d'un exemplaire au mandant (obligatoire) : le texte signé complet.
  if (mailer && req.lead.email) {
    mailer.sendMail({
      from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: req.lead.email,
      subject: 'Votre mandat de recherche signé — n° ' + m.numero,
      html: m.document.html
    }).catch((err) => console.error('[mandat] remise par email échouée :', err.message));
  }
  res.json({ ok: true, mandat: resumeMandat(m), visitePossible: mandatPermetVisite(m) });
});

// Document signé : lisible par son signataire et par l'agence uniquement.
app.get('/api/mandat/:id/document', requireAuth, (req, res) => {
  const m = (req.db.mandats || []).find((x) => x.id === req.params.id);
  const staff = ROLES_STAFF.indexOf(roleOf(req.lead)) > -1;
  if (!m || (!staff && m.leadId !== req.lead.id)) return res.status(404).send('Mandat introuvable');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(m.document ? m.document.html : mandatDocumentHtml(mandatCorpsHtml(m, null), '<div class="sig">Mandat non signé.</div>'));
});

// Liste des mandats (CRM).
app.get('/api/mandats', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, agenceManquants: agenceManquants(), mandats: (db.mandats || []).map((m) => Object.assign(resumeMandat(m), { leadId: m.leadId, mandant: m.mandant })) });
});

// Informations réglementées affichées dans les mentions légales (publiques).
app.get('/api/agence', (req, res) => {
  const a = agence();
  res.json({ raisonSociale: a.raisonSociale, siren: a.siren, adresse: a.adresse, carteT: a.carteT, garantie: a.garantie, rcp: a.rcp, mediateur: a.mediateur, tauxAcquereur: a.tauxAcquereur, tauxMixte: a.tauxMixte, arrondiHai: pasArrondiHai() });
});

// Créneaux proposés par le membre : jusqu'à 3, au format « AAAA-MM-JJTHH:MM ».
function creneauxPropres(liste) {
  return (Array.isArray(liste) ? liste : []).map((c) => String(c || '').trim()).filter((c) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c)).slice(0, 3);
}
function creneauLisible(c) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(c || '');
  if (!m) return String(c || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) + ' à ' + m[4] + ' h ' + m[5];
}

app.post('/api/visites', requireAuth, (req, res) => {
  const body = req.body || {};
  const bienId = String(body.bienId || '');
  const creneaux = creneauxPropres(body.creneaux);
  const creneauLibre = String(body.creneau || '').slice(0, 120);
  const note = String(body.note || '').slice(0, 500);
  if (!bienId) return res.status(400).json({ error: 'Bien requis' });
  const bien = req.db.biens.find((b) => b.id === bienId);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  // Seul un bien validé et en « visite ouverte » peut être visité (pas un
  // bien sous offre ou sous compromis, retiré du catalogue membre).
  if (!bienSurPlateforme(bien)) return res.status(404).json({ error: 'Bien introuvable' });
  if (bien.statut !== 'ouvert') {
    return res.status(409).json({ error: 'Ce bien est en avant-première : le propriétaire n’a pas encore ouvert les visites. Suivez-le pour être informé dès que ce sera possible.' });
  }
  if (!creneaux.length && !creneauLibre) return res.status(400).json({ error: 'Proposez au moins un créneau.' });
  const texteCreneaux = creneaux.length ? creneaux.map(creneauLisible).join(' · ') : creneauLibre;
  const mandat = mandatApplicable(req.db, req.lead.id);
  // Une seule demande en attente par membre et par bien : une nouvelle
  // demande met à jour les créneaux au lieu de créer un doublon.
  let demande = req.db.demandes.find((d) => d.type === 'visite' && d.leadId === req.lead.id && d.bienId === bienId && d.statut === 'nouvelle');
  const nouvelle = !demande;
  if (nouvelle) {
    demande = { id: uid('d'), type: 'visite', leadId: req.lead.id, bienId: bienId, email: req.lead.email, nom: nomComplet(req.lead), statut: 'nouvelle', source: 'Espace membre', cree: nowISO() };
    req.db.demandes.unshift(demande);
  }
  demande.creneaux = creneaux;
  demande.creneau = texteCreneaux;
  demande.note = note;
  demande.message = 'Créneaux proposés : ' + texteCreneaux + (note ? '\n' + note : '');
  demande.mandatId = mandat ? mandat.id : null;
  if (nouvelle) {
    creerTacheDemande(req.db, demande, 'Demande de visite de ' + nomComplet(req.lead) + (mandat ? ' — mandat signé, visite à confirmer' : ' — mandat à signer'));
    logActivite(req.db, { leadId: bien.leadId || null, bienId: bienId, type: 'visite_demandee', auteur: nomComplet(req.lead) + ' (acquéreur)' });
  }
  writeDb(req.db);
  res.json({ ok: true, id: demande.id, mandatRequis: !mandat, mandat: resumeMandat(mandat), mandatDisponible: agenceManquants().length === 0 });
});

// ---- Offres (Silent Offer) ----
app.post('/api/offres', requireAuth, (req, res) => {
  const bienId = String((req.body && req.body.bienId) || '');
  const montant = Number((req.body && req.body.montant) || 0) || 0;
  const message = String((req.body && req.body.message) || '');
  if (!bienId || !montant) return res.status(400).json({ error: 'Bien et montant requis' });
  const bien = req.db.biens.find((b) => b.id === bienId);
  if (!bien || bien.surSeecret === false) return res.status(404).json({ error: 'Bien introuvable' });
  if (!bienOuvertAuxVisites(bien)) {
    return res.status(409).json({ error: 'Ce bien est en avant-première : le propriétaire n’a pas encore ouvert les visites, donc pas encore les offres. Suivez-le pour être informé dès que ce sera possible.' });
  }
  const bienAdresse = bien ? (bien.adresse || bien.titre || '') : '';
  // L'acquéreur fait son offre sur le prix affiché (honoraires inclus). Le taux
  // et l'équivalent net vendeur sont gardés pour l'agence (CRM uniquement) :
  // ils ne sont jamais renvoyés à l'acquéreur.
  const tauxOffre = tauxHonorairesPour(bien, req.lead, aVenduChezNous(req.db, req.lead));
  const offre = {
    id: uid('o'), bienId: bienId, leadId: req.lead.id, email: req.lead.email, nom: nomComplet(req.lead),
    montant: montant, tauxHonoraires: tauxOffre, prixAffiche: prixHai(bien.prix, tauxOffre),
    montantNet: Math.round(montant / (1 + tauxOffre / 100)),
    message: message, statut: 'en_attente', cree: nowISO()
  };
  req.db.offres.unshift(offre);
  const demande = {
    id: uid('d'), type: 'offre', leadId: req.lead.id, bienId: bienId, email: req.lead.email,
    nom: nomComplet(req.lead), message: 'Montant : ' + montant.toLocaleString('fr-FR') + ' € HAI (soit ' + offre.montantNet.toLocaleString('fr-FR') + ' € net vendeur, info agence)' + (bienAdresse ? ' · ' + bienAdresse : '') + (message ? ' — ' + message : ''),
    montant: montant, offreId: offre.id, bienAdresse: bienAdresse, role: 'offre', statut: 'nouvelle', source: 'Espace membre', cree: nowISO()
  };
  req.db.demandes.unshift(demande);
  creerTacheDemande(req.db, demande, 'Traiter l’offre de ' + nomComplet(req.lead));
  logActivite(req.db, { leadId: bien ? bien.leadId : null, bienId: bienId, type: 'offre_faite', auteur: nomComplet(req.lead) + ' (acquéreur)' });
  writeDb(req.db);
  res.json({ ok: true, id: offre.id });
});

app.get('/api/offres', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, offres: db.offres });
});

app.post('/api/offres/:id/accepter', requireAdmin, (req, res) => {
  const db = readDb();
  const offre = db.offres.find((o) => o.id === req.params.id);
  if (!offre) return res.status(404).json({ error: 'Offre introuvable' });
  offre.statut = 'acceptee';
  offre.traiteeAt = nowISO();
  const bien = db.biens.find((b) => b.id === offre.bienId);
  if (bien) bien.statut = 'sous-compromis';
  logActivite(db, { leadId: bien ? bien.leadId : null, bienId: offre.bienId, type: 'offre_acceptee', auteur: 'Agent' });
  db.offres.forEach((o) => { if (o.id !== offre.id && o.bienId === offre.bienId && o.statut === 'en_attente') { o.statut = 'refusee'; o.traiteeAt = nowISO(); } });
  const demande = db.demandes.find((d) => d.offreId === offre.id);
  if (demande) {
    demande.statut = 'traitee';
    demande.traiteeAt = nowISO();
    const tache = db.tasks.find((t) => t.demandeId === demande.id && t.statut === 'en_attente');
    if (tache) { tache.statut = 'terminee'; tache.traiteeAt = nowISO(); }
  }
  const acheteur = db.leads.find((l) => l.id === offre.leadId);
  const notif = notifierClient(db, {
    leadId: offre.leadId, email: offre.email || (acheteur && acheteur.email), tel: (acheteur && acheteur.tel) || '',
    prenom: (acheteur && acheteur.prenom) || (offre.nom || '').split(' ')[0] || '',
    titre: 'Votre offre a été acceptée',
    message: 'Excellente nouvelle, votre offre de ' + Number(offre.montant || 0).toLocaleString('fr-FR') + ' € a été acceptée par le propriétaire.',
    lien: originOf(req) + '/espace.html'
  });
  writeDb(db);
  res.json({ ok: true, notif: notif });
});

app.post('/api/offres/:id/refuser', requireAdmin, (req, res) => {
  const db = readDb();
  const offre = db.offres.find((o) => o.id === req.params.id);
  if (!offre) return res.status(404).json({ error: 'Offre introuvable' });
  offre.statut = 'refusee';
  offre.traiteeAt = nowISO();
  const demande = db.demandes.find((d) => d.offreId === offre.id);
  if (demande) {
    demande.statut = 'traitee';
    demande.traiteeAt = nowISO();
    const tache = db.tasks.find((t) => t.demandeId === demande.id && t.statut === 'en_attente');
    if (tache) { tache.statut = 'terminee'; tache.traiteeAt = nowISO(); }
  }
  const acheteurRef = db.leads.find((l) => l.id === offre.leadId);
  const notif = notifierClient(db, {
    leadId: offre.leadId, email: offre.email || (acheteurRef && acheteurRef.email), tel: (acheteurRef && acheteurRef.tel) || '',
    prenom: (acheteurRef && acheteurRef.prenom) || (offre.nom || '').split(' ')[0] || '',
    titre: 'Votre offre n’a pas été retenue',
    message: 'Votre offre de ' + Number(offre.montant || 0).toLocaleString('fr-FR') + ' € n’a malheureusement pas été retenue par le propriétaire.',
    lien: originOf(req) + '/espace.html'
  });
  writeDb(db);
  res.json({ ok: true, notif: notif });
});

app.post('/api/offres/:id/contre', requireAdmin, (req, res) => {
  const db = readDb();
  const offre = db.offres.find((o) => o.id === req.params.id);
  if (!offre) return res.status(404).json({ error: 'Offre introuvable' });
  const contre = Number((req.body && req.body.contre) || 0) || offre.montant;
  offre.statut = 'contre';
  offre.contre = contre;
  offre.traiteeAt = nowISO();
  const lead = db.leads.find((l) => l.id === offre.leadId);
  writeDb(db);
  res.json({ ok: true, contre: contre, tel: lead ? (lead.tel || '') : '', email: offre.email, prenom: lead ? (lead.prenom || '') : '' });
});

// ---- Passerelle Immo Data Robot (moteur Python FastAPI) ----
const ROBOT_URL = process.env.ROBOT_URL || 'http://localhost:8000';

// Auto-authentification auprès du moteur Python (cache le JWT 55 min).
let ROBOT_CACHE = { token: null, at: 0 };
async function robotToken() {
  if (process.env.ROBOT_TOKEN) return process.env.ROBOT_TOKEN;
  if (ROBOT_CACHE.token && Date.now() - ROBOT_CACHE.at < 3300 * 1000) return ROBOT_CACHE.token;
  const user = process.env.ROBOT_USER;
  const pass = process.env.ROBOT_PASS;
  if (!user || !pass) return null;
  try {
    const body = new URLSearchParams({ username: user, password: pass });
    const r = await fetch(ROBOT_URL + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: AbortSignal.timeout(6000)
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.access_token) {
      ROBOT_CACHE = { token: data.access_token, at: Date.now() };
      return data.access_token;
    }
    return null;
  } catch (e) { return null; }
}

app.get('/api/robot/health', async (req, res) => {
  try {
    const r = await fetch(ROBOT_URL + '/health', { signal: AbortSignal.timeout(3000) });
    res.json({ ok: r.ok, status: r.status, url: ROBOT_URL, body: await r.json().catch(() => ({})) });
  } catch (e) {
    const local = /localhost|127\.0\.0\.1/.test(ROBOT_URL);
    res.json({ ok: false, error: local && process.env.RAILWAY_ENVIRONMENT
      ? 'Le moteur Python (recherche cadastrale) tourne uniquement sur l’ordinateur de l’agence : il n’est pas installé sur le site en ligne. Utilisez la recherche DPE et le Radar, ou lancez le moteur en local.'
      : 'Serveur Python injoignable (' + ROBOT_URL + '). Lancez ./start-local.command puis réessayez.', url: ROBOT_URL, horsLigne: local && !!process.env.RAILWAY_ENVIRONMENT });
  }
});

app.get('/api/robot/search', requireAdmin, async (req, res) => {
  const q = new URLSearchParams();
  const adresse = String(req.query.adresse || req.query.address || '').trim();
  const ville = String(req.query.ville || req.query.city || '').trim();
  const codePostal = String(req.query.code_postal || req.query.postal_code || '').trim();
  const dpe = String(req.query.dpe || req.query.dpe_class || '').trim().toUpperCase();
  const section = String(req.query.section || '').trim();
  const numero = String(req.query.numero || req.query.number || '').trim();
  if (!adresse && !ville && !codePostal) {
    return res.status(400).json({ error: 'Saisissez au moins une adresse, une ville ou un code postal.' });
  }
  if (adresse) q.set('address', adresse);
  if (ville) q.set('city', ville);
  if (codePostal) q.set('postal_code', codePostal);
  if (section) q.set('section', section);
  if (numero) q.set('number', numero);
  if (/^[A-G]$/.test(dpe)) q.set('dpe_class', dpe);
  try {
    const headers = {};
    const token = await robotToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(ROBOT_URL + '/cadastre/search?' + q.toString(), { headers, signal: AbortSignal.timeout(60000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = data.detail || data.error || ('Erreur moteur Python ' + r.status);
      return res.status(502).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    }
    res.json({ ok: true, source: 'robot', data: data });
  } catch (e) {
    res.status(502).json({ error: 'Serveur Python injoignable. Lancez le moteur (./start-local.command) puis réessayez.' });
  }
});

// Enrichissement propriétaire d'une parcelle (dossier complet du moteur Python)
app.post('/api/robot/dossier', requireAdmin, async (req, res) => {
  const parcelId = Number(req.body && req.body.parcelId);
  if (!parcelId) return res.status(400).json({ error: 'Identifiant de parcelle requis.' });
  try {
    const token = await robotToken();
    if (!token) return res.status(502).json({ error: 'Moteur Python non authentifié. Configurez ROBOT_TOKEN ou ROBOT_USER/ROBOT_PASS dans le fichier .env.' });
    const r = await fetch(ROBOT_URL + '/cadastre/parcels/' + parcelId + '/dossier', { headers: { 'Authorization': 'Bearer ' + token }, signal: AbortSignal.timeout(60000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = data.detail || data.error || ('Erreur moteur Python ' + r.status);
      return res.status(502).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    }
    res.json({ ok: true, dossier: data });
  } catch (e) {
    res.status(502).json({ error: 'Serveur Python injoignable. Lancez le moteur (./start-local.command) puis réessayez.' });
  }
});

// Persistance des biens détectés par le Radar (résultats de prospection)
app.get('/api/robot-biens', requireAdmin, (req, res) => {
  const db = readDb();
  // dpeAuto : détections du moteur quotidien (voir scannerDpeRecherchesActives
  // plus bas), gardées à part de `biens` (voir le commentaire sur db.dpeAuto)
  // pour ne jamais être écrasées par la sauvegarde complète du Radar manuel.
  res.json({ ok: true, biens: db.robotBiens || [], dpeAuto: db.dpeAuto || [], scanLog: db.dpeScanLog || [] });
});

app.post('/api/robot-biens', requireAdmin, (req, res) => {
  const db = readDb();
  const biens = Array.isArray(req.body && req.body.biens) ? req.body.biens : [];
  db.robotBiens = biens;
  writeDb(db);
  res.json({ ok: true, count: biens.length });
});

// Recherche DPE — source ADEME data-fair (données publiques réelles, sans clé API)
const ADEME_URL = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';
// Pas de `select` restreint à une liste de champs : on ne connaît pas à
// l'avance tous les noms exacts de colonnes utiles côté ADEME (chauffage,
// isolation, coût énergétique, niveaux du bâtiment…), et une liste mal
// orthographiée casserait la recherche en silence. On récupère la ligne
// complète telle que l'ADEME la fournit et on l'enrichit côté client avec
// tout ce qu'elle contient — c'est aussi ce qui permet d'ajouter des
// critères sans dépendre d'un redéploiement si l'ADEME ajoute des champs.

// Extrait de l'ancien handler de /api/robot/dpe pour être réutilisé tel
// quel par le moteur quotidien (scannerDpeRecherchesActives, plus bas) :
// même construction de requête, même appel ADEME, mêmes erreurs — on ne
// veut pas que la recherche manuelle et le scan automatique divergent.
async function interrogerAdemeDpe(q) {
  const clauses = [];
  const qParts = [];
  if (q.adresse) qParts.push(q.adresse);
  if (q.ville) qParts.push(q.ville);
  if (q.codePostal) qParts.push(q.codePostal);
  const qText = qParts.join(' ');
  if (!qText) return { ok: false, statut: 400, error: 'Saisissez une ville, une adresse ou un code postal.' };

  const classes = (q.classes || []).map((c) => String(c).toUpperCase().trim()).filter((c) => /^[A-G]$/.test(c));
  if (classes.length === 1) clauses.push('etiquette_dpe:' + classes[0]);
  else if (classes.length > 1) clauses.push('(' + classes.map((c) => 'etiquette_dpe:' + c).join(' OR ') + ')');
  if (q.dateDebut || q.dateFin) clauses.push('date_reception_dpe:[' + (q.dateDebut || '*') + ' TO ' + (q.dateFin || '*') + ']');
  if (q.surfaceMin || q.surfaceMax) clauses.push('surface_habitable_logement:[' + (q.surfaceMin || '*') + ' TO ' + (q.surfaceMax || '*') + ']');
  if (q.type && q.type !== 'tout') clauses.push('type_batiment:' + q.type);

  const params = new URLSearchParams();
  params.set('size', String(Math.min(100, Math.max(10, Number(q.limit) || 50))));
  params.set('q', qText);
  if (clauses.length) params.set('qs', clauses.join(' AND '));
  const sortMap = {
    recent: '-date_reception_dpe', ancien: 'date_reception_dpe',
    surface_desc: '-surface_habitable_logement', surface_asc: 'surface_habitable_logement',
    classe_asc: 'etiquette_dpe', classe_desc: '-etiquette_dpe'
  };
  if (sortMap[q.tri || 'recent']) params.set('sort', sortMap[q.tri || 'recent']);

  try {
    const r = await fetch(ADEME_URL + '?' + params.toString(), { headers: { 'User-Agent': 'Seecret/1.0 (immo-data-robot)', 'Accept': 'application/json' }, signal: AbortSignal.timeout(90000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const hint = (data.meta && data.meta.hints) ? ' ' + data.meta.hints.join(' ') : '';
      return { ok: false, statut: 502, error: (data.detail || ('Erreur ADEME ' + r.status)) + hint };
    }
    return { ok: true, total: data.total || 0, results: data.results || [] };
  } catch (e) {
    return { ok: false, statut: 502, error: 'API ADEME injoignable.' };
  }
}

app.get('/api/robot/dpe', requireAdmin, async (req, res) => {
  const r = await interrogerAdemeDpe({
    adresse: String(req.query.adresse || '').trim(),
    ville: normalizeVille(String(req.query.ville || '').trim()),
    codePostal: String(req.query.code_postal || '').trim(),
    classes: String(req.query.classes || '').split(','),
    dateDebut: String(req.query.date_debut || '').trim(),
    dateFin: String(req.query.date_fin || '').trim(),
    surfaceMin: String(req.query.surface_min || '').trim(),
    surfaceMax: String(req.query.surface_max || '').trim(),
    type: String(req.query.type || '').trim().toLowerCase(),
    tri: String(req.query.tri || 'recent').trim(),
    limit: req.query.limit
  });
  if (!r.ok) return res.status(r.statut || 502).json({ error: r.error });
  res.json({ ok: true, source: 'ADEME dpe03existant', total: r.total, count: r.results.length, results: r.results });
});

// ---- Moteur quotidien de prospection DPE ----
// Le CRM (assets/js/crm.js : rechercherDpePourRecherche/mapSignalRobotBien)
// permet déjà à un agent de lancer, recherche par recherche, une requête
// ADEME DPE ciblée pour trouver des biens réels correspondant à un acheteur,
// et de les ajouter au Radar (db.robotBiens). Ce qui suit fait exactement
// la même chose, mais automatiquement pour TOUTES les recherches actives,
// sans qu'un agent ait besoin de cliquer — c'est le « moteur quotidien »
// demandé. Même logique de conversion ADEME → bien du Radar (portée ici
// côté serveur pour pouvoir tourner sans navigateur ouvert), même
// dédoublonnage par adresse, même absence de filtre sur le prix (l'ADEME ne
// fournit aucune estimation de prix exploitable — décision actée : pas de
// prix estimé, matching sur secteur/surface/type/pièces uniquement).
//
// Point de vigilance (vérifié par recherche documentaire, pas par test en
// conditions réelles — ce sandbox n'atteint pas data.ademe.fr) : le DPE
// « logements existants » de l'ADEME ne contient PAS de champ fiable de
// nombre de pièces (seule la surface habitable est structurée). Le critère
// « pièces » de scoreRobotBien (crm.js) est déjà écrit pour être best-effort
// et ne jamais bloquer un match quand `pieces` est absent — rien à changer
// ici, mais autant le documenter pour ne pas prétendre à un matching plus
// précis que ce que la donnée permet réellement.
const QUARTIERS_CP = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  .map((n) => ({ id: 'p' + n, label: 'Paris ' + n + (n === 1 ? 'ᵉʳ' : 'ᵉ'), cp: '750' + String(n).padStart(2, '0') }))
  .concat([
    { id: 'boulogne', label: 'Boulogne-Billancourt', cp: '92100' },
    { id: 'neuilly', label: 'Neuilly-sur-Seine', cp: '92200' },
    { id: 'vincennes', label: 'Vincennes', cp: '94300' }
  ]);
const quartierDeCpServeur = (cp) => QUARTIERS_CP.find((q) => q.cp === String(cp || '').trim()) || null;
const secteurDeQuartier = (id) => QUARTIERS_CP.find((q) => q.id === id) || null;
const adresseKeyServeur = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const DPE_ORDER_SERVEUR = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
// Même regex que côté CRM (voir crm.js, etageDepuisAdresseBrute) : l'étage
// n'est jamais une donnée ADEME structurée, seulement une extraction best
// effort depuis l'adresse brute du DPE quand elle le mentionne en texte libre.
const ETAGE_RE_SERVEUR = /(?<![a-zàâäéèêëïîôöùûüÿñç])(?:étage|etage|ét\.?|et\.?)\s*n?°?\s*(rdc|rez[- ]de[- ]chauss[ée]e|\d{1,2})\b/i;
function etageDepuisAdresseBrute(adresseBrut) {
  const m = ETAGE_RE_SERVEUR.exec(String(adresseBrut || ''));
  if (!m) return null;
  const v = m[1].toLowerCase();
  return /rdc|rez/.test(v) ? 'RDC' : v;
}

// Conversion d'une ligne ADEME DPE brute vers le même format de « bien du
// Radar » que mapSignalRobotBien() côté CRM (assets/js/crm.js) — gardé
// volontairement identique champ à champ pour que les deux chemins
// (recherche manuelle et scan automatique) alimentent exactement la même
// structure, lue par scoreRobotBien/viewRobotBien sans distinction.
function dpeVersRobotBien(s) {
  const secteur = quartierDeCpServeur(s.code_postal_ban);
  return {
    id: s.numero_dpe ? 'dpe-' + s.numero_dpe : (s.parcelle || uid('rb')),
    signalId: null,
    adresse: s.adresse_ban || s.adresse_brut || '',
    ville: s.nom_commune_ban || '',
    codePostal: s.code_postal_ban || '',
    type: s.type_batiment || '',
    surface_habitable_m2: (s.surface_habitable_logement != null) ? Number(s.surface_habitable_logement) : null,
    surface_reference_dpe_m2: (s.surface_habitable_immeuble != null) ? Number(s.surface_habitable_immeuble) : null,
    surface_terrain_m2: null,
    contenance_cadastrale_m2: null,
    parcelle: s.parcelle || '',
    quartiers: secteur ? [secteur.id] : [],
    dpe: s.etiquette_dpe || '',
    dpeId: s.numero_dpe || '',
    dpeDate: s.date_reception_dpe || null,
    anneeConstruction: s.annee_construction || null,
    periodeConstruction: s.periode_construction || null,
    etageEstime: etageDepuisAdresseBrute(s.adresse_brut),
    proprietaire: { nom: '', type: 'personne', siren: '', dirigeants: [] },
    contacts: [],
    confidence_geocoding: null,
    confidence_geocoding_source: 'BAN',
    confidence_owner: null,
    confidence_owner_source: null,
    dateDetection: nowISO(),
    statutProspection: 'nouveau',
    coords: null,
    ademeBrut: s,
    source: 'dpe-auto'
  };
}

// Exécute, pour chaque recherche active ayant au moins un secteur, la même
// requête ADEME que l'agent lancerait manuellement (voir
// rechercherDpePourRecherche côté CRM), et ajoute dans db.dpeAuto les biens
// pas déjà connus (dédoublonnage par adresse, contre db.robotBiens ET
// db.dpeAuto). N'appelle PAS l'enrichissement propriétaire
// (/api/robot/enrichir) : ce pipeline dépend du moteur Python, non
// configuré en production à ce jour — l'agent reste libre de lancer cet
// enrichissement manuellement sur les biens détectés, comme pour un bien
// trouvé via la recherche DPE manuelle.
//
// db.dpeAuto est une collection SÉPARÉE de db.robotBiens, et c'est
// volontaire : côté CRM, POST /api/robot-biens remplace tout le tableau
// db.robotBiens avec l'état en mémoire du navigateur de l'agent
// (saveRobotBiens(), voir crm.js) — si ce moteur ajoutait directement dans
// db.robotBiens, un agent qui a le CRM ouvert au moment où le scan
// quotidien tourne écraserait les détections du jour à la prochaine action
// qui déclenche cette sauvegarde. db.dpeAuto n'est jamais réécrit par ce
// chemin client, donc jamais à risque d'être effacé par inadvertance ;
// côté CRM, robotBiens() lit désormais les deux collections combinées.
async function scannerDpeRecherchesActives(db) {
  const recherches = (db.recherches || []).filter((r) => r.statut !== 'archivee' && !r.archive && Array.isArray(r.quartiers) && r.quartiers.length);
  db.dpeAuto = Array.isArray(db.dpeAuto) ? db.dpeAuto : [];
  const dejaConnues = new Set((db.robotBiens || []).concat(db.dpeAuto).map((b) => adresseKeyServeur(b.adresse)));
  const nouveaux = [];
  const erreurs = [];
  const typeMap = { Appartement: 'appartement', Maison: 'maison' };
  for (const rec of recherches) {
    const secteurs = (rec.quartiers || []).map(secteurDeQuartier).filter(Boolean);
    for (const sec of secteurs) {
      const types = (rec.types && rec.types.length) ? rec.types : (rec.type ? [rec.type] : []);
      const type = types.map((t) => typeMap[t]).find(Boolean) || '';
      const classes = rec.dpe ? DPE_ORDER_SERVEUR.slice(0, DPE_ORDER_SERVEUR.indexOf(rec.dpe) + 1) : [];
      const r = await interrogerAdemeDpe({
        codePostal: sec.cp, ville: sec.label,
        surfaceMin: rec.surfaceMin ? String(rec.surfaceMin) : '',
        type: type, classes: classes, tri: 'recent', limit: 20
      });
      if (!r.ok) { erreurs.push({ rechercheId: rec.id, secteur: sec.id, erreur: r.error }); continue; }
      r.results.forEach((row) => {
        const key = adresseKeyServeur(row.adresse_ban || row.adresse_brut);
        if (!key || dejaConnues.has(key)) return;
        dejaConnues.add(key);
        const b = dpeVersRobotBien(row);
        b.rechercheOrigine = rec.id;
        nouveaux.push(b);
      });
    }
  }
  if (nouveaux.length) {
    db.dpeAuto = db.dpeAuto.concat(nouveaux);
  }
  db.dpeScanLog = db.dpeScanLog || [];
  db.dpeScanLog.unshift({
    at: nowISO(), recherchesScannees: recherches.length, biensAjoutes: nouveaux.length,
    erreurs: erreurs.length ? erreurs.slice(0, 5) : []
  });
  db.dpeScanLog = db.dpeScanLog.slice(0, 30);
  return { recherchesScannees: recherches.length, biensAjoutes: nouveaux.length, erreurs: erreurs };
}

app.post('/api/robot/dpe/scan-quotidien', requireAdmin, async (req, res) => {
  const db = readDb();
  try {
    const resultat = await scannerDpeRecherchesActives(db);
    enregistrerScanDpe(db);
    res.json({ ok: true, resultat: resultat });
  } catch (e) {
    res.status(500).json({ error: 'Scan impossible : ' + ((e && e.message) || 'erreur') });
  }
});

// Lancé une première fois peu après le démarrage du serveur (pour ne pas
// faire attendre le tout premier déploiement jusqu'au lendemain), puis
// toutes les 24h — c'est la partie réellement « quotidienne » du moteur :
// sans action de l'agent, en production. Volontairement silencieux en cas
// d'échec (ADEME temporairement indisponible, par exemple) : le prochain
// passage réessaiera, et le détail de chaque passage reste consultable via
// db.dpeScanLog (exposé par GET /api/robot-biens) pour que l'agent voie que
// le moteur tourne même quand il ne trouve rien de nouveau.
const UNE_JOURNEE_MS = 24 * 60 * 60 * 1000;
// Le scan attend longtemps l'ADEME : entre sa lecture de la base et la fin du
// scan, des agents ou des membres ont pu écrire. On relit donc la base au
// dernier moment et on n'y reporte que les deux champs que le scan possède.
function enregistrerScanDpe(dbScan) {
  const frais = readDb();
  frais.dpeAuto = dbScan.dpeAuto || [];
  frais.dpeScanLog = dbScan.dpeScanLog || [];
  writeDb(frais);
}

function planifierScanDpeQuotidien() {
  const executer = async () => {
    try {
      const db = readDb();
      const resultat = await scannerDpeRecherchesActives(db);
      enregistrerScanDpe(db);
      console.log('[moteur DPE quotidien] ' + resultat.recherchesScannees + ' recherche(s) scannée(s), ' + resultat.biensAjoutes + ' bien(s) ajouté(s).');
    } catch (e) {
      console.error('[moteur DPE quotidien] échec :', (e && e.message) || e);
    }
  };
  setTimeout(executer, 60 * 1000);
  setInterval(executer, UNE_JOURNEE_MS);
}

// Pipeline d'enrichissement complet : adresse → cadastre → sauvegarde parcelle → dossier propriétaire
// Enrichissement d'une parcelle précise : sauvegarde → dossier propriétaire (SCI/dirigeants/contacts)
app.post('/api/robot/enrichir-parcelle', requireAdmin, async (req, res) => {
  const feature = req.body && req.body.feature;
  if (!feature || !feature.properties) return res.status(400).json({ error: 'Référence cadastrale incomplète.' });
  try {
    const token = await robotToken();
    if (!token) return res.status(502).json({ error: 'Moteur Python non authentifié. Configurez ROBOT_USER/ROBOT_PASS.' });
    const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    // 1) sauvegarder la parcelle côté Python
    const pr = await fetch(ROBOT_URL + '/cadastre/parcels', { method: 'POST', headers: H, body: JSON.stringify({ feature: feature, prospecting_status: 'TO_EXAMINE', confirm: false }), signal: AbortSignal.timeout(15000) });
    const pdata = await pr.json().catch(() => ({}));
    if (!pr.ok || !pdata.id) return res.status(502).json({ error: typeof pdata.detail === 'string' ? pdata.detail : 'Sauvegarde de parcelle impossible.' });
    // 2) dossier propriétaire
    const dr = await fetch(ROBOT_URL + '/cadastre/parcels/' + pdata.id + '/dossier', { headers: H, signal: AbortSignal.timeout(60000) });
    const ddata = await dr.json().catch(() => ({}));
    if (!dr.ok) return res.status(502).json({ error: typeof ddata.detail === 'string' ? ddata.detail : 'Dossier propriétaire impossible.' });
    res.json({ ok: true, parcelId: pdata.id, dossier: ddata });
  } catch (e) {
    res.status(502).json({ error: 'Serveur Python injoignable.' });
  }
});

// ---- File d'enrichissement automatique (traitement par lots, survit au redémarrage) ----
let ENRICH_RUNNING = false;
const ENRICH_BATCH = 5;

async function robotEnrichirLot() {
  if (ENRICH_RUNNING) return;
  ENRICH_RUNNING = true;
  try {
    for (;;) {
      const db = readDb();
      const files = (db.robotEnrichment || []).filter((f) => f.statut === 'attente');
      if (!files.length) break;
      const lot = files.slice(0, ENRICH_BATCH);
      lot.forEach((f) => { f.statut = 'en_cours'; });
      writeDb(db);
      await Promise.all(lot.map(async (f) => {
        try {
          const token = await robotToken();
          if (!token) { f.statut = 'erreur'; f.error = 'Non authentifié'; return; }
          const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
          const pr = await fetch(ROBOT_URL + '/cadastre/parcels', { method: 'POST', headers: H, body: JSON.stringify({ feature: f.feature, prospecting_status: 'TO_EXAMINE', confirm: false }), signal: AbortSignal.timeout(15000) });
          const pdata = await pr.json().catch(() => ({}));
          if (!pr.ok || !pdata.id) { f.statut = 'erreur'; f.error = 'Sauvegarde parcelle impossible'; return; }
          const dr = await fetch(ROBOT_URL + '/cadastre/parcels/' + pdata.id + '/dossier', { headers: H, signal: AbortSignal.timeout(60000) });
          const ddata = await dr.json().catch(() => ({}));
          if (!dr.ok) { f.statut = 'erreur'; f.error = 'Dossier impossible'; return; }
          const o = ddata.owner || {};
          const cand = (o.candidates && o.candidates[0]) || {};
          const bien = (db.robotBiens || []).find((b) => b.parcelle === f.parcel_ref || b.id === f.parcel_ref);
          if (bien) {
            bien.proprietaire = {
              nom: cand.name || cand.nom || '',
              type: String(cand.owner_type || '').toLowerCase().indexOf('sci') > -1 ? 'sci' : (cand.siren ? 'societe' : 'personne'),
              siren: cand.siren || '',
              dirigeants: []
            };
            if (ddata.scores && ddata.scores.data_reliability) bien.confidence_owner = ddata.scores.data_reliability.score;
          }
          f.statut = cand.name ? 'enrichi' : 'sans_info';
        } catch (e) { f.statut = 'erreur'; f.error = String(e.message || 'Erreur'); }
      }));
      writeDb(db);
    }
  } finally {
    ENRICH_RUNNING = false;
  }
}

app.post('/api/robot/enrichir-lot', requireAdmin, (req, res) => {
  const db = readDb();
  const features = Array.isArray(req.body && req.body.features) ? req.body.features : [];
  const files = features.map((f) => ({ parcel_ref: (f && f.properties && f.properties.parcel_ref) || (f && f.id) || '', feature: f, statut: 'attente', error: '' }));
  db.robotEnrichment = (db.robotEnrichment || []).concat(files);
  writeDb(db);
  robotEnrichirLot();
  res.json({ ok: true, enFiles: files.length });
});

app.get('/api/robot/enrichir-statut', requireAdmin, (req, res) => {
  const db = readDb();
  const files = db.robotEnrichment || [];
  const stats = {
    total: files.length,
    enAttente: files.filter((f) => f.statut === 'attente').length,
    enCours: files.filter((f) => f.statut === 'en_cours').length,
    enrichis: files.filter((f) => f.statut === 'enrichi').length,
    sansInfo: files.filter((f) => f.statut === 'sans_info').length,
    erreurs: files.filter((f) => f.statut === 'erreur').length
  };
  res.json({ ok: true, stats: stats, biens: db.robotBiens || [] });
});

app.get('/api/robot/dirigeants', requireAdmin, async (req, res) => {
  const siren = String(req.query.siren || '').trim();
  if (!siren) return res.status(400).json({ error: 'SIREN requis.' });
  try {
    const r = await sireneFetch('https://recherche-entreprises.api.gouv.fr/search?q=' + encodeURIComponent(siren), { signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    const results = data.results || [];
    const exact = results.find((x) => String(x.siren) === siren) || results[0];
    if (!exact) return res.json({ ok: true, dirigeants: [] });
    const dirigeants = (exact.dirigeants || [])
      .filter((d) => String(d.type_dirigeant || '').toLowerCase() === 'personne physique')
      .map((d) => ({ nom: ((d.prenoms ? d.prenoms + ' ' : '') + (d.nom || '')).trim(), role: d.qualite || '' }));
    res.json({ ok: true, dirigeants: dirigeants });
  } catch (e) { res.status(502).json({ error: 'SIRENE injoignable.' }); }
});

// Recoupement d'identité (anti-homonymie) : cherche les AUTRES sociétés où une personne déjà
// repérée comme dirigeante d'une SCI/société du Radar apparaît elle aussi comme dirigeante.
// Source : le Répertoire National des Entreprises (RNE), via la même API publique et gratuite
// de l'État que /api/robot/dirigeants — une information que la loi oblige déjà à publier pour
// tout dirigeant de société, donc rien de privé n'est exposé ici. Objectif : donner à l'agent
// des indices vérifiables (autres sociétés, villes, secteurs) pour reconnaître, parmi les
// homonymes d'un réseau social, lequel correspond vraiment à cette personne — jamais pour
// choisir un profil à sa place.
function normaliserNom(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
async function autresMandats(nom, exclureSiren) {
  const cible = normaliserNom(nom);
  {
    const r = await sireneFetch('https://recherche-entreprises.api.gouv.fr/search?q=' + encodeURIComponent(nom) + '&page=1&per_page=15', { signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    const results = data.results || [];
    const mandats = [];
    results.forEach((entreprise) => {
      if (exclureSiren && String(entreprise.siren) === exclureSiren) return;
      (entreprise.dirigeants || []).forEach((d) => {
        if (String(d.type_dirigeant || '').toLowerCase() !== 'personne physique') return;
        const nomComplet = ((d.prenoms ? d.prenoms + ' ' : '') + (d.nom || '')).trim();
        if (normaliserNom(nomComplet) !== cible) return;
        mandats.push({
          entreprise: entreprise.nom_complet || entreprise.nom_raison_sociale || ('SIREN ' + entreprise.siren),
          siren: entreprise.siren,
          ville: (entreprise.siege && (entreprise.siege.ville || entreprise.siege.libelle_commune)) || '',
          role: d.qualite || ''
        });
      });
    });
    return mandats;
  }
}
app.get('/api/robot/autres-mandats', requireAdmin, async (req, res) => {
  const nom = String(req.query.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom requis.' });
  try { res.json({ ok: true, mandats: await autresMandats(nom, String(req.query.exclureSiren || '').trim()) }); }
  catch (e) { res.status(502).json({ error: 'RNE injoignable.' }); }
});

// Coordonnées professionnelles (email/téléphone) — cascade sur plusieurs annuaires B2B
// freemium (Societeinfo, Dropcontact, Datagma), demandée par l'agence pour tenter d'obtenir
// systématiquement un contact pro légal sur chaque propriétaire/dirigeant identifié par le
// Radar. Chaque fournisseur est optionnel : sans clé API en variable d'environnement, on le
// saute silencieusement. On s'arrête au premier résultat trouvé. Important : on ne bascule
// JAMAIS automatiquement sur un plan payant quand les quotas gratuits sont épuisés — dépenser
// de l'argent réel sans accord explicite à chaque fois n'est pas acceptable ; on le signale
// clairement à l'agent à la place, pour qu'il décide lui-même d'activer un plan payant.
function fournisseurConfigure(cle) { return !!(process.env[cle] && String(process.env[cle]).trim()); }

// API réelle Societeinfo (https://societeinfo.com/api-doc/?ae=115) : base
// https://societeinfo.com/app/rest/api/v2/, auth par paramètre "key" (pas "apiKey"),
// recherche par SIREN (le plus fiable) ou, à défaut, par nom de société. Il n'existe
// pas d'endpoint fiable par simple nom de personne : dans ce cas on ne tente rien.
async function appelSocieteinfo(nomComplet, societe, siren) {
  if (!fournisseurConfigure('SOCIETEINFO_API_KEY')) return { statut: 'non_configure' };
  if (!siren && !societe) return { statut: 'vide' };
  try {
    const base = 'https://societeinfo.com/app/rest/api/v2/contacts.json';
    const url = siren
      ? base + '/' + encodeURIComponent(siren) + '?' + new URLSearchParams({ key: process.env.SOCIETEINFO_API_KEY, withemail: 'true' }).toString()
      : base + '?' + new URLSearchParams({ key: process.env.SOCIETEINFO_API_KEY, name: societe, withemail: 'true' }).toString();
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    // Vérifié en conditions réelles : un quota dépassé renvoie un HTTP 403 avec
    // success:false et errorCode "API_MAX_MATCH_EXCEEDED" — PAS un 402/429.
    if (r.status === 402 || r.status === 429 || (data && data.errorCode === 'API_MAX_MATCH_EXCEEDED')) return { statut: 'epuise' };
    if (!r.ok) return { statut: 'erreur' };
    const cible = normaliserNom(nomComplet);
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    let hit = contacts.find((c) => normaliserNom(((c.firstName || '') + ' ' + (c.lastName || '')).trim()) === cible && String(c.level_code || '').toUpperCase() === 'DIRIGEANT');
    if (!hit) hit = contacts.find((c) => normaliserNom(((c.firstName || '') + ' ' + (c.lastName || '')).trim()) === cible);
    if (hit && (hit.email || '')) return { statut: 'trouve', email: hit.email || '', telephone: hit.phone || hit.telephone || '', source: 'Societeinfo (contact nominatif)' };
    const generique = (data.company && (data.company.generic_email || data.company.generic_phone)) ? data.company : null;
    if (generique) return { statut: 'trouve', email: generique.generic_email || '', telephone: generique.generic_phone || '', source: 'Societeinfo (générique société, pas nominatif)' };
    return { statut: 'vide' };
  } catch (e) { return { statut: 'erreur' }; }
}

// Vérifié en conditions réelles le 2026-11-18 : l'endpoint réel est /batch
// (/v1/enrich/all répond "Missing Authentication Token", signe d'une route
// inexistante). Le code erreur 403 signale un quota dépassé (pas 402/429).
// Le téléphone retourné est une simple chaîne (champ "phone"), pas un tableau
// d'objets comme l'email.
async function appelDropcontact(prenom, nomFamille, societe) {
  if (!fournisseurConfigure('DROPCONTACT_API_KEY')) return { statut: 'non_configure' };
  try {
    const lancement = await fetch('https://api.dropcontact.io/batch', {
      method: 'POST',
      headers: { 'X-Access-Token': process.env.DROPCONTACT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [{ first_name: prenom, last_name: nomFamille, company: societe || '' }] }),
      signal: AbortSignal.timeout(15000)
    });
    if (lancement.status === 403 || lancement.status === 429) return { statut: 'epuise' };
    if (!lancement.ok) return { statut: 'erreur' };
    const lancementData = await lancement.json().catch(() => ({}));
    const requestId = lancementData.request_id;
    if (!requestId) return { statut: 'vide' };
    // Vérifié en conditions réelles : Dropcontact répond "Request not ready
    // yet, try again in 30 seconds" pendant ~30s avant de livrer le résultat
    // (observé jusqu'à 33s sur un cas réel) — 5×2s (10s) était bien trop court
    // et faisait conclure à tort "rien trouvé". On patiente jusqu'à ~36s.
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const resultat = await fetch('https://api.dropcontact.io/batch/' + requestId, {
        headers: { 'X-Access-Token': process.env.DROPCONTACT_API_KEY },
        signal: AbortSignal.timeout(15000)
      });
      const resultatData = await resultat.json().catch(() => ({}));
      if (resultatData && resultatData.data && resultatData.data.length) {
        const c = resultatData.data[0];
        const email = c.email && c.email.length ? c.email[0].email : '';
        const telephone = c.phone || c.mobile_phone || '';
        if (email || telephone) return { statut: 'trouve', email: email || '', telephone: telephone || '', source: 'Dropcontact' };
        if (resultatData.success === true) return { statut: 'vide' };
      }
    }
    return { statut: 'vide' };
  } catch (e) { return { statut: 'erreur' }; }
}

// Vérifié en conditions réelles le 2026-11-18 : le paramètre "data" est
// obligatoire (sinon 400 "data field must have value") — on y met le nom
// complet. "phoneFull" nécessite un plan supérieur et fait échouer tout
// l'appel avec un 400 explicite si le plan ne l'inclut pas ; on ne le
// demande donc plus par défaut (le champ "phone" de base reste disponible).
async function appelDatagma(prenom, nomFamille, societe) {
  if (!fournisseurConfigure('DATAGMA_API_KEY')) return { statut: 'non_configure' };
  try {
    const nomComplet = (prenom + ' ' + nomFamille).trim();
    const params = new URLSearchParams({ apiId: process.env.DATAGMA_API_KEY, data: nomComplet, firstName: prenom, lastName: nomFamille, company: societe || '' });
    const r = await fetch('https://gateway.datagma.net/api/ingress/v2/full?' + params.toString(), { signal: AbortSignal.timeout(15000) });
    if (r.status === 402 || r.status === 429) return { statut: 'epuise' };
    const data = await r.json().catch(() => ({}));
    if (r.status === 404 || data.code === 5) return { statut: 'vide' };
    if (!r.ok) return { statut: 'erreur' };
    if (data.email || data.phone) return { statut: 'trouve', email: data.email || '', telephone: data.phone || '', source: 'Datagma' };
    return { statut: 'vide' };
  } catch (e) { return { statut: 'erreur' }; }
}

// FullEnrich (https://docs.fullenrich.com, API v2) : emails professionnels et
// téléphones, à partir du nom + société. Traitement asynchrone : on lance
// l'enrichissement puis on interroge le résultat (≈ 30 à 60 s). Les emails
// PERSONNELS ne sont jamais demandés. Résultat marqué « à vérifier ».
async function appelFullEnrich(prenom, nomFamille, societe) {
  if (!fournisseurConfigure('FULLENRICH_API_KEY')) return { statut: 'non_configure' };
  if (!prenom || !nomFamille || !societe) return { statut: 'vide' };
  const H = { Authorization: 'Bearer ' + process.env.FULLENRICH_API_KEY, 'Content-Type': 'application/json' };
  try {
    const lancement = await fetch('https://app.fullenrich.com/api/v2/contact/enrich/bulk', {
      method: 'POST', headers: H, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ name: 'Seecret — ' + societe.slice(0, 60), data: [{ first_name: prenom, last_name: nomFamille, company_name: societe, enrich_fields: ['contact.work_emails', 'contact.phones'] }] })
    });
    if (lancement.status === 402 || lancement.status === 429) return { statut: 'epuise' };
    const ld = await lancement.json().catch(() => ({}));
    if (!lancement.ok || !ld.enrichment_id) return { statut: 'erreur' };
    for (let i = 0; i < 15; i++) {
      await new Promise((ok) => setTimeout(ok, 5000));
      const r = await fetch('https://app.fullenrich.com/api/v2/contact/enrich/bulk/' + encodeURIComponent(ld.enrichment_id), { headers: H, signal: AbortSignal.timeout(15000) });
      if (r.status === 400) continue; // pas encore prêt
      const d = await r.json().catch(() => ({}));
      if (r.status === 402 || d.status === 'CREDITS_INSUFFICIENT') return { statut: 'epuise' };
      if (d.status !== 'FINISHED') { if (['CANCELED', 'UNKNOWN', 'RATE_LIMIT'].indexOf(d.status) > -1) return { statut: 'erreur' }; continue; }
      const info = (d.data && d.data[0] && d.data[0].contact_info) || {};
      const email = (info.most_probable_work_email && info.most_probable_work_email.email) || '';
      const telephone = (info.most_probable_phone && info.most_probable_phone.number) || '';
      if (email || telephone) return { statut: 'trouve', email: email, telephone: telephone, source: 'FullEnrich (base fournisseur, à vérifier)' };
      return { statut: 'vide' };
    }
    return { statut: 'vide' };
  } catch (e) { return { statut: 'erreur' }; }
}

// ---- Crédits des outils de téléphone / email ----
// Solde réel quand l'outil le donne (FullEnrich, Dropcontact), sinon nombre de
// recherches faites ce mois-ci et dernier état connu (épuisé, erreur…).
const OUTILS_COORD = [
  { id: 'dropcontact', nom: 'Dropcontact', cle: 'DROPCONTACT_API_KEY', site: 'https://app.dropcontact.com', solde: async () => { const r = await fetch('https://api.dropcontact.com/v1/account/credits', { headers: { 'X-Access-Token': process.env.DROPCONTACT_API_KEY }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); return Number(d.credits); } },
  { id: 'fullenrich', nom: 'FullEnrich', cle: 'FULLENRICH_API_KEY', site: 'https://app.fullenrich.com', solde: async () => { const r = await fetch('https://app.fullenrich.com/api/v2/account/credits', { headers: { Authorization: 'Bearer ' + process.env.FULLENRICH_API_KEY }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); return Number(d.balance); } },
  { id: 'datagma', nom: 'Datagma', cle: 'DATAGMA_API_KEY', site: 'https://app.datagma.com' },
  { id: 'societeinfo', nom: 'Société Info', cle: 'SOCIETEINFO_API_KEY', site: 'https://societeinfo.com/app' }
];
const moisCourant = () => new Date().toISOString().slice(0, 7);
function creditsLus(id) { return (RS && cacheLu('credits', id)) || { utilises: {}, dernier: null, max: null, solde: null }; }
function creditsNoter(id, statut, solde) {
  if (!RS) return;
  const c = creditsLus(id);
  c.utilises = c.utilises || {};
  if (statut && statut !== 'non_configure') { const m = moisCourant(); c.utilises[m] = (c.utilises[m] || 0) + 1; c.dernier = { statut: statut, at: nowISO() }; }
  if (typeof solde === 'number' && isFinite(solde)) { c.solde = solde; c.soldeLe = nowISO(); c.max = Math.max(c.max || 0, solde); }
  RS.cacheSet.run('credits', id, nowISO(), JSON.stringify(c));
}
async function creditsOutils(rafraichir) {
  return Promise.all(OUTILS_COORD.map(async (o) => {
    const configure = fournisseurConfigure(o.cle);
    let c = creditsLus(o.id);
    if (configure && o.solde && (rafraichir || !c.soldeLe || Date.now() - Date.parse(c.soldeLe) > 5 * 60e3)) {
      try { creditsNoter(o.id, null, await o.solde()); c = creditsLus(o.id); c.soldeErreur = null; } catch (e) { c.soldeErreur = e.message; }
    }
    return { id: o.id, nom: o.nom, site: o.site, configure: configure, soldeConnu: !!o.solde, solde: c.solde, max: c.max, soldeLe: c.soldeLe || null, soldeErreur: c.soldeErreur || null,
      utilisesMois: (c.utilises || {})[moisCourant()] || 0, dernier: c.dernier || null, cout: 1 };
  }));
}
async function appelOutilCoord(id, nomComplet, societe, siren) {
  const parts = nomComplet.split(/\s+/);
  const prenom = parts[0] || ''; const nomFamille = parts.slice(1).join(' ') || parts[0] || '';
  if (id === 'dropcontact') return appelDropcontact(prenom, nomFamille, societe);
  if (id === 'fullenrich') return appelFullEnrich(prenom, nomFamille, societe);
  if (id === 'datagma') return appelDatagma(prenom, nomFamille, societe);
  if (id === 'societeinfo') return appelSocieteinfo(nomComplet, societe, siren);
  return { statut: 'non_configure' };
}
app.get('/api/radar/credits', requireAdmin, async (req, res) => {
  res.json({ ok: true, outils: await creditsOutils(req.query.rafraichir === '1') });
});
// Téléphone et email du gérant, avec les outils choisis par l'agent.
app.post('/api/radar/fiche/:id/coordonnees', requireAdmin, async (req, res) => {
  if (!RS) return res.status(503).json({ error: 'Base du Radar indisponible.' });
  const f = rsFiche(req.params.id);
  if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
  radarAppliquerCache(f);
  const p = f.proprietaire || {};
  const dg = p.dirigeant;
  if (p.statut !== 'identifie' || !dg || !dg.nom) return res.status(400).json({ error: 'Il faut d’abord connaître le gérant de la société.' });
  const choisis = (Array.isArray(req.body && req.body.outils) ? req.body.outils : []).filter((id) => OUTILS_COORD.some((o) => o.id === id && fournisseurConfigure(o.cle)));
  if (!choisis.length) return res.status(400).json({ error: 'Choisissez au moins un outil.' });
  const toutEssayer = !!(req.body && req.body.toutEssayer);
  const nomD = ((dg.prenoms || dg.prenom || '') + ' ' + dg.nom).trim();
  const etapes = []; const trouves = [];
  for (const id of choisis) {
    const o = OUTILS_COORD.find((x) => x.id === id);
    let r;
    try { r = await appelOutilCoord(id, nomD, p.nom, p.siren); } catch (e) { r = { statut: 'erreur' }; }
    creditsNoter(id, r.statut);
    etapes.push({ fournisseur: o.nom, id: id, statut: r.statut, email: r.email || '', telephone: r.telephone || '', source: r.source || '' });
    if (r.statut === 'trouve') { trouves.push(r); if (!toutEssayer) break; }
  }
  const premier = trouves[0];
  p.coordPro = { ok: true, trouve: !!premier, email: premier ? premier.email : '', telephone: premier ? premier.telephone : '', source: premier ? premier.source : '', etapes: etapes, le: nowISO(), gerant: nomD };
  // Tous les numéros / emails trouvés vont dans les contacts de la fiche.
  p.contacts = p.contacts || { linkedin: [], site: null, telephones: [], emails: [] };
  trouves.forEach((t) => {
    if (t.telephone && p.contacts.telephones.indexOf(t.telephone) === -1) p.contacts.telephones.push(t.telephone);
    if (t.email && p.contacts.emails.indexOf(t.email) === -1) p.contacts.emails.push(t.email);
  });
  if (premier) { RS.cacheSet.run('coordpro', p.siren + '|' + nomD, nowISO(), JSON.stringify(p.coordPro)); p.contacts.sourcePro = trouves.map((t) => t.source).join(', '); }
  f.historique = Array.isArray(f.historique) ? f.historique : [];
  const LIB = { trouve: 'trouvé', vide: 'rien', epuise: 'crédits épuisés', erreur: 'erreur', non_configure: 'pas de clé' };
  f.historique.push({ at: nowISO(), par: [req.lead.prenom, req.lead.nom].filter(Boolean).join(' '), action: 'note', valeur: 'Recherche téléphone / email de ' + nomD + ' : ' + etapes.map((e) => e.fournisseur + ' ' + (LIB[e.statut] || e.statut)).join(', ') });
  rsEcrire(f);
  res.json({ ok: true, resultat: p.coordPro, contacts: p.contacts, outils: await creditsOutils(true) });
});
async function coordonneesPro(nomComplet, societe, siren) {
  const parts = nomComplet.split(/\s+/);
  const prenom = parts[0] || '';
  const nomFamille = parts.slice(1).join(' ') || parts[0] || '';

  const fournisseurs = [
    { nom: 'Societeinfo', fn: () => appelSocieteinfo(nomComplet, societe, siren) },
    { nom: 'Dropcontact', fn: () => appelDropcontact(prenom, nomFamille, societe) },
    { nom: 'Datagma', fn: () => appelDatagma(prenom, nomFamille, societe) },
    { nom: 'FullEnrich', fn: () => appelFullEnrich(prenom, nomFamille, societe) }
  ];
  const etapes = [];
  for (const f of fournisseurs) {
    const r = await f.fn();
    const o = OUTILS_COORD.find((x) => x.nom.replace(/\s/g, '').toLowerCase() === f.nom.toLowerCase());
    if (o) creditsNoter(o.id, r.statut);
    etapes.push({ fournisseur: f.nom, statut: r.statut });
    if (r.statut === 'trouve') return { ok: true, trouve: true, email: r.email, telephone: r.telephone, source: r.source, etapes: etapes };
  }
  const tousEpuises = etapes.every((e) => e.statut === 'epuise' || e.statut === 'non_configure');
  return { ok: true, trouve: false, tousEpuises: tousEpuises, aucunConfigure: etapes.every((e) => e.statut === 'non_configure'), etapes: etapes };
}
app.get('/api/robot/coordonnees-pro', requireAdmin, async (req, res) => {
  const nomComplet = String(req.query.nom || '').trim();
  if (!nomComplet) return res.status(400).json({ error: 'Nom requis.' });
  res.json(await coordonneesPro(nomComplet, String(req.query.societe || '').trim(), String(req.query.siren || '').trim()));
});

// Enrichissement d'un profil LinkedIn précis, déjà identifié et confirmé par l'agent (pas une
// recherche par nom) — Kaspr ne fonctionne qu'à partir d'une URL de profil exacte, ce qui colle
// justement au principe retenu : jamais choisir un profil à la place de l'agent, seulement
// enrichir celui qu'il a lui-même vérifié.
app.post('/api/robot/enrichir-linkedin', requireAdmin, async (req, res) => {
  const url = String((req.body && req.body.linkedinUrl) || '').trim();
  if (!url || !/^https:\/\/(www\.)?linkedin\.com\/in\//.test(url)) return res.status(400).json({ error: 'URL de profil LinkedIn (linkedin.com/in/…) requise.' });
  if (!fournisseurConfigure('KASPR_API_KEY')) return res.status(400).json({ error: 'Kaspr non configuré (clé KASPR_API_KEY manquante).' });
  try {
    const r = await fetch('https://api.developers.kaspr.io/profile/linkedin', {
      method: 'POST',
      headers: { Authorization: process.env.KASPR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkedinUrl: url }),
      signal: AbortSignal.timeout(15000)
    });
    if (r.status === 402 || r.status === 429) return res.json({ ok: true, trouve: false, epuise: true });
    const data = await r.json().catch(() => ({}));
    const email = data.email || (Array.isArray(data.emails) && data.emails[0]) || '';
    const telephone = data.phone || (Array.isArray(data.phones) && data.phones[0]) || '';
    if (!email && !telephone) return res.json({ ok: true, trouve: false });
    res.json({ ok: true, trouve: true, email: email, telephone: telephone });
  } catch (e) { res.status(502).json({ error: 'Kaspr injoignable.' }); }
});

// Signal BODACC — Bulletin officiel des annonces civiles et commerciales (data.gouv.fr /
// Opendatasoft, API publique et gratuite, sans clé). Sert à détecter qu'une société ou SCI déjà
// repérée comme propriétaire par le Radar fait l'objet d'une procédure collective (liquidation,
// redressement) ou d'une radiation — signal légal et public de vente potentiellement forcée.
const BODACC_URL = 'https://bodacc-datadila.opendatasoft.com/api/records/1.0/search/';
app.get('/api/robot/bodacc', requireAdmin, async (req, res) => {
  const siren = String(req.query.siren || '').replace(/\s/g, '').trim();
  if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN à 9 chiffres requis.' });
  try {
    const params = new URLSearchParams();
    params.set('dataset', 'annonces-commerciales');
    params.set('q', siren);
    params.set('rows', '20');
    params.set('sort', '-dateparution');
    const r = await fetch(BODACC_URL + '?' + params.toString(), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).json({ error: 'BODACC a répondu ' + r.status + '.' });
    const data = await r.json().catch(() => ({}));
    const records = Array.isArray(data.records) ? data.records : [];
    // Le paramètre q est une recherche plein texte côté BODACC : on revérifie nous-mêmes que le
    // SIREN apparaît bien dans le champ registre pour écarter les faux positifs (homonymes, etc.).
    const annonces = records
      .map((rec) => rec.fields || {})
      .filter((f) => (Array.isArray(f.registre) ? f.registre : []).some((x) => String(x).indexOf(siren) > -1))
      .map((f) => ({
        dateparution: f.dateparution || null,
        commercant: f.commercant || '',
        ville: f.ville || '',
        tribunal: f.tribunal || '',
        familleavis: f.familleavis_lib || f.familleavis || '',
        natureJugement: (f.jugement && (f.jugement.nature || f.jugement.famille)) || '',
        dateJugement: (f.jugement && f.jugement.date) || null
      }));
    res.json({ ok: true, siren: siren, annonces: annonces });
  } catch (e) {
    res.status(502).json({ error: 'BODACC injoignable.' });
  }
});

app.post('/api/robot/enrichir', requireAdmin, async (req, res) => {
  const adresse = String((req.body && req.body.adresse) || '').trim();
  if (!adresse) return res.status(400).json({ error: 'Adresse requise.' });
  try {
    const token = await robotToken();
    if (!token) return res.status(502).json({ error: 'Moteur Python non authentifié. Configurez ROBOT_TOKEN ou ROBOT_USER/ROBOT_PASS dans le fichier .env.' });
    const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    // 1) recherche cadastrale
    const sr = await fetch(ROBOT_URL + '/cadastre/search?' + new URLSearchParams({ address: adresse }), { headers: H, signal: AbortSignal.timeout(60000) });
    const sdata = await sr.json().catch(() => ({}));
    if (!sr.ok) return res.status(502).json({ error: typeof sdata.detail === 'string' ? sdata.detail : 'Recherche cadastrale impossible.' });
    const features = (sdata.features || []).slice(0, 3);
    if (!features.length) return res.json({ ok: true, enrichi: false, message: 'Aucune parcelle identifiée pour cette adresse.', parcelles: 0, dossiers: [] });
    // 2) sauvegarde de chaque parcelle + dossier (propriétaire, SIREN, contacts)
    const dossiers = [];
    for (const f of features) {
      try {
        const pr = await fetch(ROBOT_URL + '/cadastre/parcels', { method: 'POST', headers: H, body: JSON.stringify({ feature: f, prospecting_status: 'TO_EXAMINE', confirm: false }), signal: AbortSignal.timeout(15000) });
        const pdata = await pr.json().catch(() => ({}));
        if (!pr.ok || !pdata.id) continue;
        const dr = await fetch(ROBOT_URL + '/cadastre/parcels/' + pdata.id + '/dossier', { headers: H, signal: AbortSignal.timeout(60000) });
        const ddata = await dr.json().catch(() => ({}));
        if (dr.ok) dossiers.push(Object.assign({ parcel_ref: (f.properties && f.properties.parcel_ref) || '', code_insee: (f.properties && f.properties.code_insee) || '', section: (f.properties && f.properties.section) || '', numero: (f.properties && f.properties.number) || '' }, ddata));
      } catch (e) { /* parcelle suivante */ }
    }
    res.json({ ok: true, enrichi: dossiers.length > 0, parcelles: features.length, dossiers: dossiers });
  } catch (e) {
    res.status(502).json({ error: 'Serveur Python injoignable. Lancez le moteur (./start-local.command) puis réessayez.' });
  }
});

// Pipeline de prospection DPE (moteur Python) : détection + enrichissement propriétaire/contacts
function normalizeVille(v) {
  const raw = String(v || '').trim();
  const m = /^(?:paris\s*)?(\d{1,2})(?:\s*(?:er|e|eme|ème|ᵉ))?$/i.exec(raw);
  if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 20) return '750' + String(n).padStart(2, '0'); }
  return raw;
}

app.get('/api/robot/prospecting', requireAdmin, async (req, res) => {
  const ville = normalizeVille(String(req.query.ville || req.query.city || '').trim());
  if (!ville) return res.status(400).json({ error: 'Saisissez une ville ou un secteur.' });
  try {
    const token = await robotToken();
    if (!token) return res.status(502).json({ error: 'Moteur Python non authentifié. Configurez ROBOT_USER/ROBOT_PASS.' });
    const r = await fetch(ROBOT_URL + '/search?' + new URLSearchParams({ city: ville, limit: String(req.query.limit || 50) }), { headers: { 'Authorization': 'Bearer ' + token }, signal: AbortSignal.timeout(90000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: typeof data.detail === 'string' ? data.detail : 'Prospection Python impossible.' });
    res.json({ ok: true, source: 'prospecting', data: data });
  } catch (e) {
    res.status(502).json({ error: 'Serveur Python injoignable.' });
  }
});

// DVF (ventes réelles) : API publique DVF+ open data du Cerema, sans clé.
// (Avant : lecture d'un fichier ValeursFoncieres posé sur l'ordinateur de
// l'agence — introuvable une fois le site en ligne.) Résultats gardés en
// mémoire 24 h par requête.
const DVF_API = 'https://apidf-preprod.cerema.fr/dvf_opendata/mutations/';
const DVF_CACHE = {};
const CODES_TYPE_DVF = { appartement: '121', maison: '111' };
// Budget de temps : Railway coupe une requête qui ne répond pas en ~100 s, et
// l'API du Cerema peut mettre 10 à 30 s par page. On s'arrête donc à temps et
// on renvoie ce qui a été lu (out.partiel = true) plutôt qu'une erreur 502.
const DVF_BUDGET_MS = parseInt(process.env.DVF_BUDGET_MS || '25000', 10);
async function dvfCerema(params, pagesMax, options) {
  const opt = options || {};
  const base = opt.geo ? DVF_API.replace('/mutations/', '/geomutations/') : DVF_API;
  const budget = opt.budgetMs || DVF_BUDGET_MS;
  const cle = base + JSON.stringify(params) + '|' + pagesMax;
  const enCache = DVF_CACHE[cle];
  if (enCache && Date.now() - enCache.at < (enCache.data.partiel ? 3600 * 1000 : 24 * 3600 * 1000)) return enCache.data;
  const fin = Date.now() + budget;
  const out = [];
  out.total = 0;
  let url = base + '?' + new URLSearchParams(Object.assign({ page_size: '500' }, params)).toString();
  for (let p = 0; p < pagesMax && url; p++) {
    const reste = fin - Date.now();
    if (reste < 1500) { out.partiel = true; break; }
    let j;
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(reste) });
      if (!r.ok) throw new Error('DVF Cerema HTTP ' + r.status);
      j = await r.json();
    } catch (e) {
      const delai = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      // Rien lu du tout : vraie erreur. Sinon on garde les pages déjà lues.
      if (!out.length && p === 0) throw new Error(delai ? 'le Cerema met trop de temps à répondre' : String(e.message || e));
      out.partiel = true;
      break;
    }
    out.total = j.count || out.total;
    (j.results || j.features || []).forEach((x) => out.push(x.properties || x));
    url = j.next || null;
  }
  if (url && !out.partiel && out.length < out.total) out.tronque = true; // plafond de pages atteint
  const cles = Object.keys(DVF_CACHE);
  if (cles.length > 40) delete DVF_CACHE[cles[0]];
  DVF_CACHE[cle] = { at: Date.now(), data: out };
  return out;
}

// Contour d'une parcelle (cadastre IGN, sans clé) → rectangle englobant
// "xmin,ymin,xmax,ymax". Paris, Lyon et Marseille : commune + arrondissement.
async function bboxParcelle(codeInsee, section, numero) {
  const villes = { '75': '75056', '69': '69123', '13': '13055' };
  const p = new URLSearchParams({ section: section, numero: numero });
  const arr = /^(751|6938|132)/.test(codeInsee) ? villes[codeInsee.slice(0, 2)] : null;
  if (arr) { p.set('code_insee', arr); p.set('code_arr', codeInsee.slice(2)); } else p.set('code_insee', codeInsee);
  const r = await fetch('https://apicarto.ign.fr/api/cadastre/parcelle?' + p.toString(), { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const j = await r.json();
  const f = j.features && j.features[0];
  if (!f || !f.geometry) return null;
  const xs = []; const ys = [];
  JSON.stringify(f.geometry.coordinates).replace(/\[(-?[\d.]+),(-?[\d.]+)\]/g, (m, x, y) => { xs.push(+x); ys.push(+y); return m; });
  if (!xs.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => v.toFixed(6)).join(',');
}
function mutationDvf(x) {
  return {
    date: x.datemut || '', nature: x.libnatmut || '', valeur: x.valeurfonc || '',
    adresse: '', codePostal: '', commune: (x.l_codinsee || [])[0] || '',
    typeLocal: String(x.libtypbien || '').replace(/^(UN|UNE|DES)\s+/i, '').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    surface: x.sbati || '', pieces: '', parcelles: x.l_idpar || [], lots: x.nblocmut || 0
  };
}

// Historique des mutations foncières d'une parcelle (DVF).
app.get('/api/robot/dvf', requireAdmin, async (req, res) => {
  const codeInsee = String(req.query.code_insee || '').trim();
  const section = String(req.query.section || '').trim().toUpperCase();
  const numero = String(req.query.numero || '').trim();
  if (!codeInsee || !section || !numero) return res.status(400).json({ error: 'code_insee, section et numero requis.' });
  // Identifiant de parcelle DVF : INSEE (5) + préfixe (3) + section (2) + numéro (4).
  const idpar = codeInsee + '000' + section.padStart(2, '0') + String(parseInt(numero, 10) || 0).padStart(4, '0');
  try {
    // Rapide : on lit seulement les ventes situées sur le contour de la
    // parcelle (1 à 2 s). Secours si le cadastre ne répond pas : balayage de
    // la commune dans la limite du budget de temps (résultat possiblement partiel).
    let toutes = null;
    let methode = 'contour';
    try {
      const bbox = await bboxParcelle(codeInsee, section, String(parseInt(numero, 10) || 0).padStart(4, '0'));
      if (bbox) toutes = await dvfCerema({ code_insee: codeInsee, in_bbox: bbox }, 6, { geo: true });
    } catch (e) { toutes = null; }
    if (!toutes) { methode = 'commune'; toutes = await dvfCerema({ code_insee: codeInsee, anneemut_min: String(new Date().getFullYear() - 12) }, 40); }
    const mutations = toutes.filter((x) => (x.l_idpar || []).indexOf(idpar) > -1).map(mutationDvf)
      .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 100);
    const incomplet = !!(toutes.partiel || toutes.tronque);
    res.json({ ok: true, source: 'DVF (Cerema, open data)', parcelle: idpar, methode: methode, mutations: mutations, partiel: incomplet,
      avertissement: incomplet ? 'Recherche incomplète : le Cerema a répondu trop lentement, certaines ventes peuvent manquer. Réessayez plus tard.' : '' });
  } catch (e) {
    res.status(502).json({ error: 'DVF indisponible pour le moment (' + String(e.message || e) + '). Réessayez dans quelques minutes.' });
  }
});

// Valorisation interne : calcule un prix au m² médian/moyen à partir des ventes DVF comparables
// (même commune, même type de bien, surface proche) — une alternative gratuite et interne aux
// outils d'estimation externes. Donne toujours une fourchette avec le détail des comparables
// retenus, jamais un chiffre seul : l'estimation reste indicative et l'agent juge la pertinence.
function statsPrixM2(comparables) {
  const prix = comparables
    .map((m) => {
      const valeur = parseFloat(String(m.valeur || '').replace(',', '.'));
      const surface = parseFloat(String(m.surface || '').replace(',', '.'));
      return (valeur > 0 && surface > 0) ? valeur / surface : null;
    })
    .filter((x) => x != null && isFinite(x))
    .sort((a, b) => a - b);
  if (!prix.length) return null;
  const mediane = prix.length % 2
    ? prix[(prix.length - 1) / 2]
    : (prix[prix.length / 2 - 1] + prix[prix.length / 2]) / 2;
  const moyenne = prix.reduce((s, x) => s + x, 0) / prix.length;
  return { nbComparables: prix.length, prixM2Median: Math.round(mediane), prixM2Moyen: Math.round(moyenne), prixM2Min: Math.round(prix[0]), prixM2Max: Math.round(prix[prix.length - 1]) };
}

app.get('/api/robot/dvf-secteur', requireAdmin, async (req, res) => {
  const codeInsee = String(req.query.code_insee || '').trim();
  const typeLocal = String(req.query.type_local || '').trim();
  const surfaceCible = parseFloat(String(req.query.surface || '0').replace(',', '.')) || 0;
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(codeInsee)) return res.status(400).json({ error: 'code_insee invalide (5 caractères attendus).' });
  const params = { code_insee: codeInsee, anneemut_min: String(new Date().getFullYear() - 3) };
  const code = CODES_TYPE_DVF[typeLocal.toLowerCase()];
  if (code) params.codtypbien = code;
  // Comparables pertinents : surface à ±30 % de celle du bien à estimer (si fournie).
  if (surfaceCible) { params.sbati_min = String(Math.floor(surfaceCible * 0.7)); params.sbati_max = String(Math.ceil(surfaceCible * 1.3)); }
  try {
    const brut = await dvfCerema(params, 4);
    const comparables = brut
      .filter((x) => /^vente$/i.test(x.libnatmut || '') && Number(x.nblocmut || 0) <= 2 && Number(x.valeurfonc) > 0 && Number(x.sbati) > 0)
      .map(mutationDvf)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const stats = statsPrixM2(comparables);
    const incomplet = !!(brut.partiel || brut.tronque);
    res.json({ ok: true, source: 'DVF (Cerema, open data)', codeInsee: codeInsee, typeLocal: typeLocal || 'tous types', periode: 'depuis ' + params.anneemut_min, comparables: comparables.slice(0, 20), stats: stats,
      echantillon: { lues: brut.length, total: brut.total || brut.length }, partiel: incomplet,
      avertissement: incomplet ? 'Calcul sur un échantillon de ' + brut.length + ' ventes sur ' + (brut.total || '?') + (brut.partiel ? ' (le Cerema a répondu lentement)' : '') + '. Précisez le type et la surface pour un calcul plus précis.' : '' });
  } catch (e) {
    res.status(502).json({ error: 'DVF indisponible pour le moment (' + String(e.message || e) + '). Réessayez dans quelques minutes.' });
  }
});

const AUCADASTRE_URL = 'https://aucadastre.fr/api';
const AUCADASTRE_CACHE = {};

// Proxy Aucadastre : /commune/{insee} et /parcel/{id} (gratuit, sans clé), cache 24h.
app.get('/api/robot/aucadastre/:resource/:id', requireAdmin, async (req, res) => {
  const resource = String(req.params.resource || ''); // 'commune' | 'parcel' | 'street'
  const id = String(req.params.id || '').trim();
  if (!/^(commune|parcel|street)$/.test(resource) || !id) return res.status(400).json({ error: 'Ressource Aucadastre invalide.' });
  const key = resource + '/' + id;
  const now = Date.now();
  if (AUCADASTRE_CACHE[key] && now - AUCADASTRE_CACHE[key].at < 24 * 3600 * 1000) {
    return res.json(AUCADASTRE_CACHE[key].data);
  }
  try {
    const r = await fetch(AUCADASTRE_URL + '/' + resource + '/' + encodeURIComponent(id), { headers: { 'Accept': 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(30000) });
    if (r.status === 304) return res.json({ ok: true, notModified: true });
    if (r.status === 429) { res.set('Retry-After', r.headers.get('retry-after') || '60'); return res.status(429).json({ error: 'Limite de débit Aucadastre.' }); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: typeof data.detail === 'string' ? data.detail : 'Erreur Aucadastre ' + r.status });
    AUCADASTRE_CACHE[key] = { at: now, data: { ok: true, source: 'aucadastre', resource: resource, id: id, data: data } };
    res.json(AUCADASTRE_CACHE[key].data);
  } catch (e) { res.status(502).json({ error: 'Aucadastre injoignable.' }); }
});

// Permis d'urbanisme d'une commune (Aucadastre), pagination complète
app.get('/api/robot/aucadastre/commune/:insee/permits', requireAdmin, async (req, res) => {
  const insee = String(req.params.insee || '').trim();
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(insee)) return res.status(400).json({ error: 'Code INSEE invalide.' });
  try {
    const all = [];
    let url = AUCADASTRE_URL + '/commune/' + insee + '/permits?limit=1000&offset=0';
    for (let i = 0; i < 20; i++) {
      const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { res.set('Retry-After', r.headers.get('retry-after') || '60'); return res.status(429).json({ error: 'Limite de débit Aucadastre.' }); }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status).json({ error: 'Erreur Aucadastre ' + r.status });
      const permits = data.permits || [];
      all.push(...permits);
      const pg = data.page || {};
      if (!pg.more || !pg.next) break;
      url = pg.next;
    }
    res.json({ ok: true, source: 'aucadastre', insee: insee, total: all.length, permits: all });
  } catch (e) { res.status(502).json({ error: 'Aucadastre injoignable.' }); }
});

// Exa Search API (gratuit selon l'offre, clé EXA_API_KEY) — recherche de coordonnées professionnelles publiées
app.post('/api/robot/exa-search', requireAdmin, async (req, res) => {
  const key = process.env.EXA_API_KEY;
  if (!key) return res.status(400).json({ error: 'EXA_API_KEY non configurée. Ajoutez la clé gratuite dans .env.' });
  const q = String((req.body && req.body.query) || '').trim();
  if (!q) return res.status(400).json({ error: 'Requête vide.' });
  try {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, numResults: 5, contents: { text: true, maxCharacters: 2000 } }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 429) return res.status(429).json({ error: 'Quota gratuit Exa épuisé.' });
    if (!r.ok) return res.status(r.status).json({ error: data.message || ('Erreur Exa ' + r.status) });
    res.json({ ok: true, results: data.results || [] });
  } catch (e) { res.status(502).json({ error: 'Exa injoignable.' }); }
});

// Chaîne automatique : adresse → BAN (id voie) → Aucadastre /street/{id} → propriétaires personnes morales
app.get('/api/robot/aucadastre-owners', requireAdmin, async (req, res) => {
  const adresse = String(req.query.adresse || '').trim();
  if (!adresse) return res.status(400).json({ error: 'Adresse requise.' });
  try {
    const b = await fetch('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&type=street', { signal: AbortSignal.timeout(15000) });
    const bdata = await b.json().catch(() => ({}));
    const feat = (bdata.features || [])[0];
    const streetId = feat && feat.properties && feat.properties.id;
    if (!streetId) return res.json({ ok: true, streetId: null, owners: [], message: 'Aucune voie BAN identifiée pour cette adresse.' });
    const a = await fetch(AUCADASTRE_URL + '/street/' + encodeURIComponent(streetId), { headers: { 'Accept': 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(30000) });
    const adata = await a.json().catch(() => ({}));
    const owners = (adata.owners && adata.owners.in_street) || [];
    const mapped = owners.map((o) => ({ nom: o.name || o.denomination || '', siren: o.siren || '', type: 'societe' })).filter((o) => o.nom);
    res.json({ ok: true, streetId: streetId, streetName: (adata.street && adata.street.name) || '', owners: mapped, source: 'Aucadastre /street (DGFiP personnes morales)' });
  } catch (e) { res.status(502).json({ error: 'Aucadastre/BAN injoignable.' }); }
});

// ============================================================================
// Fichier DGFiP des LOCAUX DES PERSONNES MORALES (open data, Licence Ouverte 2.0)
// ----------------------------------------------------------------------------
// C'est la source qu'utilisent bercail.com & co : pour chaque local (appartement,
// commerce, cave…) détenu par une société (SCI, SAS, bailleur…), la DGFiP publie
// gratuitement l'adresse, le bâtiment, l'entrée, le NIVEAU (étage), la PORTE, le
// SIREN et la dénomination du propriétaire. Les particuliers n'y figurent pas
// (secret fiscal) — d'où le fait que seules les sociétés apparaissent.
// Descriptif officiel (24 colonnes séparées par « ; ») :
// https://data.economie.gouv.fr/explore/dataset/fichiers-des-locaux-et-des-parcelles-des-personnes-morales/
//
// Le fichier national est trop gros pour être interrogé à chaque clic : on le
// télécharge une fois (puis on vérifie chaque mois s'il y a un millésime plus
// récent), on ne garde que les départements utiles (PM_DEPTS, par défaut
// Paris + 92 + 94) et on l'indexe sur disque (volume DATA_DIR) en petits fichiers :
//   pm-locaux/insee/<code INSEE>.ndjson   → recherche « qui possède quoi dans cet immeuble »
//   pm-locaux/siren/<2 premiers chiffres>.ndjson → « tous les biens de cette SCI »
// ============================================================================
const PM_DIR = path.join(DATA_DIR, 'pm-locaux');
const PM_DATASET = 'fichiers-des-locaux-et-des-parcelles-des-personnes-morales';
const PM_ATTACHMENTS = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/' + PM_DATASET + '/attachments';
const PM_DEPTS = String(process.env.PM_DEPTS || '75').split(',').map((s) => s.trim()).filter(Boolean);
const PM_IMPORT = { enCours: false, etape: '', erreur: '', lignes: 0, debut: null };

// Colonnes compactes d'une ligne indexée (tableau JSON, pour rester léger sur disque)
const PMC = { siren: 0, nom: 1, forme: 2, droit: 3, bat: 4, entree: 5, niveau: 6, porte: 7, num: 8, indice: 9, nature: 10, voie: 11, section: 12, plan: 13, groupe: 14, insee: 15, formeCode: 16 };

const PM_DROITS = {
  P: 'Propriétaire', U: 'Usufruitier', N: 'Nu-propriétaire', B: 'Bailleur à construction', R: 'Preneur à construction',
  F: 'Foncier', T: 'Tenuyer', D: 'Domanier', V: 'Bailleur emphytéotique', W: 'Preneur bail à réhabilitation',
  A: 'Locataire-attributaire', E: 'Emphytéote', K: 'Antichrésiste', L: 'Fonctionnaire logé', G: 'Administrateur',
  S: 'Syndic de copropriété', H: 'Associé (transparence fiscale)', O: 'Autorisation d’occupation temporaire',
  J: 'Jeune agriculteur', Q: 'Gestionnaire taxe bureaux', X: 'La Poste occupant', Y: 'La Poste propriétaire', C: 'Fiduciaire', M: 'Occupant (bail emphytéotique)'
};

function pmMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(PM_DIR, 'meta.json'), 'utf8')); } catch (e) { return null; }
}

function pmNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Types de voie (forme longue et abrégée MAJIC) retirés pour comparer deux noms de rue.
const PM_TYPES_VOIE = new Set(('RUE R AVENUE AV AVE BOULEVARD BD BLD BOUL PLACE PL QUAI QU QUA IMPASSE IMP ALLEE ALL VILLA VLA VIL PASSAGE PAS PASS CITE CTE ' +
  'SQUARE SQ SQU COURS CRS CHEMIN CHE CHEM ROUTE RTE RUELLE RLE HAMEAU HAM SENTIER SEN SENTE ESPLANADE ESP PARVIS PRV PROMENADE PROM PRO ' +
  'RPT CARREFOUR CAR CARR GALERIE GAL FAUBOURG FG FBG CHAUSSEE CHS PONT PNT PORT MAIL PARC VOIE CLOS COUR TERRASSE TSSE TER BERGE BRG ' +
  'RESIDENCE RES LOTISSEMENT LOT DOMAINE DOM ZONE ZA ZI ROND POINT').split(' '));
const PM_MOTS_VIDES = new Set('DE DU DES LA LE LES L D ET AU AUX A EN SUR'.split(' '));
const PM_SYNONYMES = { SAINT: 'ST', SAINTE: 'STE', GENERAL: 'GAL', GEN: 'GAL', MARECHAL: 'MAL', PRESIDENT: 'PDT', DOCTEUR: 'DR', PROFESSEUR: 'PR', NOTRE: 'N', DAME: 'D' };

function pmMotsVoie(nomVoie, nature) {
  const mots = pmNorm((nature ? nature + ' ' : '') + nomVoie).split(' ').filter(Boolean);
  // on retire les types de voie seulement en tête (« RUE DE LA PAIX », pas « RUE DU PONT NEUF »)
  while (mots.length > 1 && PM_TYPES_VOIE.has(mots[0])) mots.shift();
  return mots.filter((m) => !PM_MOTS_VIDES.has(m)).map((m) => PM_SYNONYMES[m] || m);
}

// Code INSEE à partir d'un code postal, pour les secteurs couverts (Paris : 750XX → 751XX).
function pmInseeDepuisCp(cp) {
  const c = String(cp || '');
  if (/^750(0[1-9]|1[0-9]|20)$/.test(c)) return '751' + c.slice(3);
  if (c === '75116') return '75116';
  const table = { '92100': '92012', '92200': '92051', '94300': '94080' };
  return table[c] || RADAR_CP_INSEE[c] || '';
}

function pmParserAdresse(adresse) {
  const s = pmNorm(adresse);
  const mCp = /\b(\d{5})\b/.exec(s);
  const cp = mCp ? mCp[1] : '';
  const avantCp = mCp ? s.slice(0, mCp.index).trim() : s;
  const m = /^(\d{1,4})\s*(BIS|TER|QUATER|B|T|Q)?\s+(.+)$/.exec(avantCp);
  if (!m) return { cp, insee: pmInseeDepuisCp(cp), numero: '', indice: '', mots: [] };
  const ind = m[2] ? m[2][0] : '';
  return { cp, insee: pmInseeDepuisCp(cp), numero: String(parseInt(m[1], 10)), indice: ind, mots: pmMotsVoie(m[3], '') };
}

// Repli : la Base Adresse Nationale (gratuite, sans clé) donne le code INSEE,
// le numéro et la voie quand l'adresse n'a pas de code postal exploitable.
async function pmGeocoderBan(adresse) {
  try {
    const r = await fetch('https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(adresse), { signal: AbortSignal.timeout(10000) });
    const d = await r.json().catch(() => ({}));
    const p = d.features && d.features[0] && d.features[0].properties;
    if (!p || !p.housenumber) return null;
    const mNum = /^(\d+)\s*([a-z]*)/i.exec(p.housenumber) || [];
    return { cp: p.postcode || '', insee: p.citycode || '', numero: String(parseInt(mNum[1], 10) || ''), indice: (mNum[2] || '').toUpperCase().slice(0, 1), mots: pmMotsVoie(p.street || '', '') };
  } catch (e) { return null; }
}

function pmNiveauLibelle(n) {
  const v = String(n || '').trim();
  if (!v) return '';
  if (/^0+$/.test(v)) return 'RDC';
  if (/^-?\d+$/.test(v)) { const k = parseInt(v, 10); return k < 0 ? 'Sous-sol ' + (-k) : (k === 1 ? '1er étage' : k + 'e étage'); }
  return v;
}

// Millésime 2026 : texte en UTF-8 (lu comme Latin-1 → « PropriÃ©taire ») et
// droit écrit « P - Propriétaire » au lieu de « P ». On répare à la lecture.
function pmTexte(v) {
  const t = String(v == null ? '' : v);
  return /Ã[\u0080-\u00bf]|Â[\u0080-\u00bf ]/.test(t) ? Buffer.from(t, 'latin1').toString('utf8') : t;
}
function pmLigneReparee(row) { return row.map((v, i) => (i === PMC.droit ? String(v || '').split(' - ')[0].trim() : pmTexte(v))); }
function pmLotDepuisLigne(row) {
  const forme = row[PMC.forme] || '';
  const estSci = /^SCI/i.test(forme) || /^654/.test(row[PMC.formeCode] || '') || /\bSCI\b|CIVILE IMMOBILIERE/i.test(row[PMC.nom] || '');
  return {
    siren: row[PMC.siren], nom: row[PMC.nom], type: estSci ? 'sci' : 'societe', forme: forme,
    droit: row[PMC.droit], droitLibelle: PM_DROITS[row[PMC.droit]] || row[PMC.droit] || '',
    batiment: row[PMC.bat], entree: row[PMC.entree], niveau: row[PMC.niveau], niveauLibelle: pmNiveauLibelle(row[PMC.niveau]), porte: row[PMC.porte],
    section: row[PMC.section], plan: row[PMC.plan], insee: row[PMC.insee],
    adresse: [row[PMC.num] + (row[PMC.indice] ? ' ' + row[PMC.indice] : ''), row[PMC.nature], row[PMC.voie]].filter(Boolean).join(' ')
  };
}

// Petit cache mémoire des derniers fichiers lus (un arrondissement ≈ quelques Mo).
const PM_CACHE = new Map();
function pmLireBucket(sousDossier, nom) {
  const fichier = path.join(PM_DIR, sousDossier, nom + '.ndjson');
  const cle = sousDossier + '/' + nom;
  let st;
  try { st = fs.statSync(fichier); } catch (e) { return []; }
  const c = PM_CACHE.get(cle);
  if (c && c.mtime === st.mtimeMs) return c.rows;
  const rows = fs.readFileSync(fichier, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  PM_CACHE.set(cle, { mtime: st.mtimeMs, rows });
  if (PM_CACHE.size > 4) PM_CACHE.delete(PM_CACHE.keys().next().value);
  return rows;
}

function pmScoreVoie(motsA, motsB) {
  if (!motsA.length || !motsB.length) return 0;
  const a = motsA.join(''), b = motsB.join('');
  if (a === b) return 3;
  if (a.indexOf(b) > -1 || b.indexOf(a) > -1) return 2;
  if (motsA[motsA.length - 1] === motsB[motsB.length - 1]) return 1;
  return 0;
}

// Base compacte (pm.db) ; l'ancien format ndjson reste lu s'il est encore là.
let PM_BASE = null;
function pmBase() {
  if (PM_BASE) return PM_BASE;
  const f = path.join(PM_DIR, 'pm.db');
  if (!fs.existsSync(f)) return null;
  try {
    const Database = require('better-sqlite3');
    const b = new Database(f, { readonly: true, fileMustExist: true });
    const sel = 'SELECT s.siren, s.nom, s.forme, l.droit, l.bat, l.entree, l.niveau, l.porte, l.num, l.ind, v.nature, v.nom AS voie, l.section, l.plan, s.groupe, l.insee, s.formeCode FROM lot l JOIN soc s ON s.id = l.soc JOIN voie v ON v.id = l.voie';
    PM_BASE = { b, adr: b.prepare(sel + ' WHERE l.insee = ? AND l.num = ?').raw(true), siren: b.prepare(sel + ' WHERE l.soc IN (SELECT id FROM soc WHERE siren = ?)').raw(true), parc: b.prepare(sel + ' WHERE l.insee = ? AND l.plan IN (?, ?, ?)').raw(true) };
    return PM_BASE;
  } catch (e) { console.error('[pm-locaux] base illisible :', e.message); return null; }
}
function pmFermerBase() { try { if (PM_BASE) PM_BASE.b.close(); } catch (e) { /* rien */ } PM_BASE = null; if (typeof RADAR_BIENS_CACHE !== 'undefined') RADAR_BIENS_CACHE.clear(); }
function pmLignesAdresse(insee, numero) {
  const b = pmBase();
  if (b) return b.adr.all(insee, String(parseInt(numero, 10) || numero)).map(pmLigneReparee);
  return pmLireBucket('insee', insee).filter((r) => String(parseInt(r[PMC.num], 10)) === numero);
}
// Lots d'une parcelle cadastrale (section + numéro de plan), quand l'adresse
// du DPE ne correspond pas à celle du fichier (« 6-10 rue… », sans numéro…).
const pmSection = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+/, '');
function pmLotsParcelle(insee, section, plan) {
  const b = pmBase();
  const n = parseInt(plan, 10);
  if (!b || !insee || !section || !n) return [];
  const sec = pmSection(section);
  return b.parc.all(insee, String(n), String(n).padStart(4, '0'), String(plan)).map(pmLigneReparee)
    .filter((r) => pmSection(r[PMC.section]) === sec).map(pmLotDepuisLigne);
}
// Index par parcelle ajouté une fois au fichier déjà importé (quelques secondes).
function pmAssurerIndexParcelle() {
  const f = path.join(PM_DIR, 'pm.db');
  if (!fs.existsSync(f)) return;
  try {
    const Database = require('better-sqlite3');
    const ro = new Database(f, { readonly: true });
    const existe = ro.prepare("SELECT 1 FROM sqlite_master WHERE name = 'i_lot_parc'").get();
    ro.close();
    if (existe) return;
    const libre = placeLibreMo();
    if (libre !== null && libre < 80) { console.warn('[pm-locaux] index parcelle reporté : ' + libre + ' Mo libres'); return; }
    pmFermerBase();
    const rw = new Database(f);
    rw.exec('CREATE INDEX IF NOT EXISTS i_lot_parc ON lot (insee, plan)');
    rw.close();
    console.log('[pm-locaux] index par parcelle créé');
  } catch (e) { console.error('[pm-locaux] index parcelle :', e.message); }
}
setTimeout(pmAssurerIndexParcelle, 45 * 1000);
function pmLignesSiren(siren) {
  const b = pmBase();
  if (b) return b.siren.all(siren).map(pmLigneReparee);
  return pmLireBucket('siren', siren.slice(0, 2)).filter((r) => r[PMC.siren] === siren);
}
function pmLotsImmeuble(q) {
  const rows = pmLignesAdresse(q.insee, q.numero);
  if (!rows.length) return [];
  let meilleur = 0;
  const notes = rows.map((r) => { const sc = pmScoreVoie(q.mots, pmMotsVoie(r[PMC.voie], '')); if (sc > meilleur) meilleur = sc; return sc; });
  let retenus = rows.filter((r, i) => meilleur > 0 && notes[i] === meilleur);
  // indice de répétition (bis/ter) : on préfère le même, sinon on garde tout
  const memeIndice = retenus.filter((r) => String(r[PMC.indice] || '').slice(0, 1).toUpperCase() === q.indice);
  if (memeIndice.length) retenus = memeIndice;
  return retenus.map(pmLotDepuisLigne);
}

function pmTriNiveau(a, b) {
  const na = /^-?\d+$/.test(String(a.niveau || '').trim()) ? parseInt(a.niveau, 10) : 999;
  const nb = /^-?\d+$/.test(String(b.niveau || '').trim()) ? parseInt(b.niveau, 10) : 999;
  return na - nb || String(a.porte || '').localeCompare(String(b.porte || '')) || String(a.nom || '').localeCompare(String(b.nom || ''));
}

// --- Import (téléchargement + indexation) -----------------------------------
// Départements à lire dans le fichier DGFiP : ceux de PM_DEPTS, plus ceux des
// communes ajoutées au Radar (dont on ne garde que ces communes).
function pmDepartementsSuivis() {
  const d = PM_DEPTS.slice();
  (typeof RADAR_ZONES_SUP !== 'undefined' ? RADAR_ZONES_SUP : []).forEach((z) => { const dep = String(z.insee).slice(0, 2); if (d.indexOf(dep) === -1) d.push(dep); });
  return d;
}
async function pmTrouverFichiers() {
  if (process.env.PM_LOCAUX_URL) return { annee: null, fichiers: [{ id: 'PM_LOCAUX_URL', url: process.env.PM_LOCAUX_URL }] };
  const r = await fetch(PM_ATTACHMENTS, { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('liste des fichiers DGFiP indisponible (HTTP ' + r.status + ')');
  const texte = await r.text();
  // Deux formats publiés : par tranches (…_2023_dpts_01_a_19_zip) jusqu'en 2023,
  // puis un fichier national par an (…_2025_zip, fichiers_des_locaux_situation_2026zip).
  const re = /fichiers?_des_locaux_situation_(\d{4})(?:_dpts?_(\d+)_a_(\d+))?_?zip/gi;
  const vus = {};
  let m;
  while ((m = re.exec(texte))) vus[m[0].toLowerCase()] = { id: m[0].toLowerCase(), annee: +m[1], de: m[2] ? +m[2] : 0, a: m[3] ? +m[3] : 999 };
  const tous = Object.values(vus);
  if (!tous.length) throw new Error('aucun fichier « locaux » trouvé dans la liste DGFiP');
  const annee = Math.max.apply(null, tous.map((f) => f.annee));
  const fichiers = [];
  pmDepartementsSuivis().forEach((dep) => {
    const n = parseInt(dep, 10);
    const f = tous.filter((x) => x.annee === annee && n >= x.de && n <= x.a)[0];
    if (f && !fichiers.some((x) => x.id === f.id)) fichiers.push({ id: f.id, url: PM_ATTACHMENTS + '/' + f.id });
  });
  if (!fichiers.length) throw new Error('aucun fichier ' + annee + ' ne couvre les départements ' + PM_DEPTS.join(', '));
  return { annee, fichiers };
}

async function pmTelecharger(url, dest) {
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  const r = await fetch(url, { headers: { 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error('téléchargement impossible (HTTP ' + r.status + ')');
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
}

// Parcourt un zip (et les zips imbriqués) et appelle onLigne(texte) pour chaque
// ligne de chaque fichier texte, sans jamais tout charger en mémoire.
function pmLireZip(fichierZip, onLigne, dossierTmp) {
  const yauzl = require('yauzl');
  const readline = require('readline');
  return new Promise((resolve, reject) => {
    yauzl.open(fichierZip, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const nom = entry.fileName;
        if (/\/$/.test(nom)) return zip.readEntry();
        // Fichiers nommés PM_AA_B_DDD… : on saute d'emblée les départements non suivis.
        const mDep = /PM_\d{2}_B_(\d{2}|2A|2B)/i.exec(path.basename(nom));
        const suivis = pmDepartementsSuivis();
        if (mDep && suivis.indexOf(mDep[1].toUpperCase()) === -1 && suivis.indexOf(String(parseInt(mDep[1], 10))) === -1) return zip.readEntry();
        const estZip = /\.zip$/i.test(nom);
        const estTexte = /\.(txt|csv)$/i.test(nom);
        if (!estZip && !estTexte) return zip.readEntry();
        zip.openReadStream(entry, (e2, flux) => {
          if (e2) return reject(e2);
          if (estZip) {
            const tmp = path.join(dossierTmp, 'imbrique-' + Date.now() + '.zip');
            const out = fs.createWriteStream(tmp);
            flux.pipe(out);
            out.on('finish', () => {
              pmLireZip(tmp, onLigne, dossierTmp).then(() => { try { fs.unlinkSync(tmp); } catch (e) {} zip.readEntry(); }, reject);
            });
            out.on('error', reject);
            return;
          }
          // Les fichiers DGFiP sont en Latin-1 : on décode octet par octet.
          const iconv = require('iconv-lite');
          const rl = readline.createInterface({ input: flux.pipe(iconv.decodeStream('latin1')), crlfDelay: Infinity });
          rl.on('line', onLigne);
          rl.on('close', () => zip.readEntry());
          rl.on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

async function pmImporter(raison) {
  if (PM_IMPORT.enCours) return;
  Object.assign(PM_IMPORT, { enCours: true, etape: 'Recherche du dernier millésime DGFiP…', erreur: '', lignes: 0, debut: nowISO() });
  const tmpDir = PM_DIR + '.tmp';
  let base = null;
  const fermerTout = () => { try { if (base) base.close(); } catch (e) { /* déjà fermée */ } base = null; return Promise.resolve(); };
  try {
    const { annee, fichiers } = await pmTrouverFichiers();
    const meta = pmMeta();
    if (raison === 'mensuel' && meta && annee && meta.annee >= annee) {
      Object.assign(PM_IMPORT, { enCours: false, etape: 'Déjà à jour (millésime ' + meta.annee + ').' });
      return;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const libre = placeLibreMo();
    if (libre !== null && libre < 150) throw new Error('disque du site presque plein (' + libre + ' Mo libres) : import reporté');
    fs.mkdirSync(tmpDir, { recursive: true });
    const communes = {};
    let nbEcrits = 0; let disquePlein = '';
    // Format compact : chaque local une seule fois ; sociétés et rues écrites
    // une fois puis désignées par un numéro (≈ 4 fois moins de place).
    const Database = require('better-sqlite3');
    base = new Database(path.join(tmpDir, 'pm.db'));
    base.pragma('journal_mode = OFF'); base.pragma('synchronous = OFF');
    base.exec('CREATE TABLE soc (id INTEGER PRIMARY KEY, siren TEXT, nom TEXT, forme TEXT, groupe TEXT, formeCode TEXT);' +
      'CREATE TABLE voie (id INTEGER PRIMARY KEY, nature TEXT, nom TEXT);' +
      'CREATE TABLE lot (insee TEXT, num TEXT, ind TEXT, voie INTEGER, soc INTEGER, droit TEXT, bat TEXT, entree TEXT, niveau TEXT, porte TEXT, section TEXT, plan TEXT);');
    const insSoc = base.prepare('INSERT INTO soc VALUES (?, ?, ?, ?, ?, ?)');
    const insVoie = base.prepare('INSERT INTO voie VALUES (?, ?, ?)');
    const insLot = base.prepare('INSERT INTO lot VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const socIds = new Map(); const voieIds = new Map();
    let lotEnAttente = [];
    const vider = base.transaction((l) => l.forEach((r) => insLot.run(r)));
    const ecrireLigne = (row) => {
      if (disquePlein) return;
      const kS = row[PMC.siren] + '|' + row[PMC.nom] + '|' + row[PMC.forme];
      let idS = socIds.get(kS);
      if (!idS) { idS = socIds.size + 1; socIds.set(kS, idS); insSoc.run(idS, row[PMC.siren], row[PMC.nom], row[PMC.forme], row[PMC.groupe], row[PMC.formeCode]); }
      const kV = row[PMC.nature] + '|' + row[PMC.voie];
      let idV = voieIds.get(kV);
      if (!idV) { idV = voieIds.size + 1; voieIds.set(kV, idV); insVoie.run(idV, row[PMC.nature], row[PMC.voie]); }
      lotEnAttente.push([row[PMC.insee], row[PMC.num], row[PMC.indice], idV, idS, row[PMC.droit], row[PMC.bat], row[PMC.entree], row[PMC.niveau], row[PMC.porte], row[PMC.section], row[PMC.plan]]);
      if (lotEnAttente.length >= 5000) { vider(lotEnAttente); lotEnAttente = []; }
      // Garde-fou : on arrête l'import avant de remplir le disque.
      if (++nbEcrits % 5000 === 0) { const l = placeLibreMo(); if (l !== null && l < 100) disquePlein = 'import arrêté : il ne restait que ' + l + ' Mo sur le disque du site'; }
    };
    // Le zip national (plusieurs centaines de Mo) va dans le dossier temporaire du
    // conteneur, pas sur le volume : seul l'index final (Paris) occupe le disque.
    const tmpZip = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pm-'));
    for (const f of fichiers) {
      const zipLocal = path.join(tmpZip, 'source.zip');
      PM_IMPORT.etape = 'Téléchargement du fichier DGFiP (' + f.id + ')…';
      await pmTelecharger(f.url, zipLocal);
      PM_IMPORT.etape = 'Indexation des locaux (' + PM_DEPTS.join(', ') + ')…';
      await pmLireZip(zipLocal, (ligne) => {
        const c = ligne.split(';');
        if (c.length < 24) return;
        const dep = c[0].trim();
        if (!/^(\d{2}|2A|2B|97)$/.test(dep)) return;
        const insee = dep + String(c[2].trim()).padStart(3, '0');
        if (PM_DEPTS.indexOf(dep) === -1 && !RADAR_ZONES_SUP.some((z) => z.insee === insee)) return;
        const siren = c[19].trim();
        const row = [siren, c[23].trim(), c[22].trim(), c[17].trim(), c[7].trim(), c[8].trim(), c[9].trim(), c[10].trim(),
          String(parseInt(c[11], 10) || c[11].trim()), c[12].trim(), c[15].trim(), c[16].trim(), c[5].trim(), c[6].trim(), c[20].trim(), insee, c[21].trim()];
        ecrireLigne(row);
        communes[insee] = c[3].trim();
        PM_IMPORT.lignes++;
      }, tmpZip);
      try { fs.unlinkSync(zipLocal); } catch (e) {}
      if (disquePlein) break;
    }
    fs.rmSync(tmpZip, { recursive: true, force: true });
    if (disquePlein) throw new Error(disquePlein);
    if (lotEnAttente.length) vider(lotEnAttente);
    PM_IMPORT.etape = 'Création des index…';
    base.exec('CREATE INDEX i_lot_adr ON lot (insee, num); CREATE INDEX i_lot_soc ON lot (soc); CREATE INDEX i_soc_siren ON soc (siren); CREATE INDEX i_lot_parc ON lot (insee, plan);');
    await fermerTout();
    if (!PM_IMPORT.lignes) throw new Error('aucune ligne retenue pour les départements ' + PM_DEPTS.join(', '));
    pmFermerBase();
    fs.writeFileSync(path.join(tmpDir, 'meta.json'), JSON.stringify({ format: 'sqlite', annee, importeLe: nowISO(), lignes: PM_IMPORT.lignes, departements: PM_DEPTS, communes, source: fichiers.map((f) => f.url) }, null, 1));
    fs.rmSync(PM_DIR, { recursive: true, force: true });
    fs.renameSync(tmpDir, PM_DIR);
    PM_CACHE.clear();
    setTimeout(() => { radarReidentifier().catch((e) => console.error('[radar] ré-identification :', e.message)); }, 1000);
    Object.assign(PM_IMPORT, { enCours: false, etape: 'Import terminé : ' + PM_IMPORT.lignes.toLocaleString('fr-FR') + ' locaux de sociétés indexés (millésime ' + annee + ').' });
    console.log('[pm-locaux] ' + PM_IMPORT.etape);
  } catch (e) {
    await fermerTout().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
    Object.assign(PM_IMPORT, { enCours: false, erreur: String(e.message || e), etape: 'Échec de l’import' });
    console.error('[pm-locaux] échec :', e.message || e);
  }
}

function planifierImportPm() {
  if (process.env.PM_AUTO_IMPORT === '0') return;
  // Premier import automatique peu après le démarrage si l'index n'existe pas,
  // puis vérification mensuelle d'un millésime plus récent.
  // Import automatique au démarrage seulement si PM_AUTO_IMPORT=1 (sinon : bouton dans le Radar).
  if (process.env.PM_AUTO_IMPORT === '1') setTimeout(() => { if (!pmMeta()) pmImporter('initial'); }, 2 * 60 * 1000);
  setInterval(() => pmImporter('mensuel'), 30 * 24 * 60 * 60 * 1000);
}

app.get('/api/robot/pm/statut', requireAdmin, (req, res) => {
  res.json({ ok: true, disponible: !!pmMeta(), meta: pmMeta() ? Object.assign({}, pmMeta(), { communes: undefined }) : null, import: PM_IMPORT });
});

app.post('/api/robot/pm/importer', requireAdmin, (req, res) => {
  if (PM_IMPORT.enCours) return res.json({ ok: true, dejaEnCours: true, import: PM_IMPORT });
  pmImporter('manuel');
  res.json({ ok: true, lance: true, import: PM_IMPORT });
});

// Clé (facultative) de l'API Google Maps Embed — gratuite et sans quota, mais
// liée à un compte Google Cloud. Sans clé, le CRM utilise l'intégration publique
// de Google Maps, qui fonctionne aussi sans compte.
app.get('/api/robot/carte-config', requireAdmin, (req, res) => {
  res.json({ ok: true, googleEmbedKey: String(process.env.GOOGLE_MAPS_EMBED_KEY || '').trim() });
});

// Qui (quelles sociétés) possède quoi, étage par étage, dans l'immeuble de cette adresse.
app.get('/api/robot/pm/immeuble', requireAdmin, async (req, res) => {
  const adresse = String(req.query.adresse || '').trim();
  if (!adresse) return res.status(400).json({ error: 'Adresse requise.' });
  const meta = pmMeta();
  if (!meta) return res.json({ ok: true, disponible: false, import: PM_IMPORT, lots: [], proprietaires: [] });
  let q = pmParserAdresse(adresse);
  if (!q.insee || !q.numero || !q.mots.length) {
    const ban = await pmGeocoderBan(adresse);
    if (ban) q = ban;
  }
  if (!q.insee || !q.numero) return res.json({ ok: true, disponible: true, millesime: meta.annee, adresseComprise: false, lots: [], proprietaires: [] });
  const lots = pmLotsImmeuble(q).sort(pmTriNiveau);
  const parSiren = {};
  lots.forEach((l) => {
    const k = l.siren || l.nom;
    parSiren[k] = parSiren[k] || { siren: l.siren, nom: l.nom, type: l.type, forme: l.forme, nbLots: 0, niveaux: [] };
    parSiren[k].nbLots++;
    if (l.niveauLibelle && parSiren[k].niveaux.indexOf(l.niveauLibelle) === -1) parSiren[k].niveaux.push(l.niveauLibelle);
  });
  res.json({ ok: true, disponible: true, millesime: meta.annee, adresseComprise: true, insee: q.insee, commune: (meta.communes || {})[q.insee] || '', lots, proprietaires: Object.values(parSiren).sort((a, b) => b.nbLots - a.nbLots) });
});

// Tout le patrimoine (dans les départements indexés) d'une société, regroupé par adresse.
app.get('/api/robot/pm/siren/:siren', requireAdmin, (req, res) => {
  const siren = String(req.params.siren || '').replace(/\s/g, '');
  if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN à 9 chiffres requis.' });
  const meta = pmMeta();
  if (!meta) return res.json({ ok: true, disponible: false, import: PM_IMPORT, biens: [] });
  const lots = pmLignesSiren(siren).map(pmLotDepuisLigne);
  const parAdresse = {};
  lots.forEach((l) => {
    const k = l.insee + '|' + l.adresse;
    parAdresse[k] = parAdresse[k] || { adresse: l.adresse, insee: l.insee, commune: (meta.communes || {})[l.insee] || '', section: l.section, plan: l.plan, lots: [] };
    parAdresse[k].lots.push(l);
  });
  const biens = Object.values(parAdresse).map((b) => Object.assign(b, { lots: b.lots.sort(pmTriNiveau) })).sort((a, b) => a.insee.localeCompare(b.insee) || a.adresse.localeCompare(b.adresse));
  res.json({ ok: true, disponible: true, millesime: meta.annee, siren, nom: lots[0] ? lots[0].nom : '', type: lots[0] ? lots[0].type : '', nbLots: lots.length, biens, departements: meta.departements });
});

// ============================================================================
// RADAR — fiches « bien à prospecter » (inspiré des outils de prospection pro)
// ----------------------------------------------------------------------------
// 1. Collecte : les DPE récents (ADEME, gratuit) des 20 arrondissements de
//    Paris. Un DPE récent = un logement qui bouge (vente, location, travaux).
//    Le DPE donne l'adresse, la surface, l'étage, souvent la porte.
// 2. Propriétaire : fichier DGFiP des locaux des personnes morales (sociétés
//    uniquement — les particuliers sont protégés par le secret fiscal). On
//    cherche la société qui possède un lot au même étage (et même porte), ou
//    tout l'immeuble.
// 3. Dirigeant : nom, prénom et âge du gérant de la SCI (SIRENE, gratuit).
// 4. Autres biens de la société (même fichier DGFiP), prix estimé (DVF du
//    secteur), étiquettes, score.
// 5. Acquéreurs potentiels : membres du club et leads du CRM dont les
//    critères (secteur, type, surface, budget, étage, DPE) correspondent.
// ============================================================================
const RADAR_ARRONDISSEMENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  .map((n) => ({ quartier: 'p' + n, cp: n === 16 ? '75016' : '750' + String(n).padStart(2, '0'), insee: '751' + String(n).padStart(2, '0'), label: 'Paris ' + n + (n === 1 ? 'ᵉʳ' : 'ᵉ') }));
// Zones ajoutées par l'agence (un code postal → une ou plusieurs communes).
// Enregistrées dans la base ; Paris reste toujours présent.
let RADAR_ZONES_SUP = [];
const RADAR_CP_INSEE = {};
function radarZonesCharger() {
  try {
    RADAR_ZONES_SUP = (readDb().radarZones || []).filter((z) => z && z.quartier && z.cp && z.insee);
    Object.keys(RADAR_CP_INSEE).forEach((k) => delete RADAR_CP_INSEE[k]);
    const parCp = {};
    RADAR_ZONES_SUP.forEach((z) => { (parCp[z.cp] = parCp[z.cp] || []).push(z.insee); });
    Object.keys(parCp).forEach((cp) => { if (parCp[cp].length === 1) RADAR_CP_INSEE[cp] = parCp[cp][0]; });
  } catch (e) { RADAR_ZONES_SUP = []; }
}
function radarZones() { return RADAR_ARRONDISSEMENTS.concat(RADAR_ZONES_SUP); }
const RADAR_INSTITUTIONNELS = /\b(ASSURANCE|ASSURANCES|MUTUELLE|BANQUE|CAISSE|CREDIT|SCPI|OPCI|FONCIERE|REIT|HABITAT|LOGEMENT|BAILLEUR|PARIS HABITAT|RIVP|ICF|CDC|ALLIANZ|AXA|GENERALI|MACIF|MAIF|COVEA|AVIVA|PREDICA|AMUNDI|GECINA|ICADE|COVIVIO|UNIBAIL|SOCIETE GENERALE|BNP|LCL)\b/;
const radarAnnee = (d) => { const t = new Date(d || 0).getTime(); return isFinite(t) ? t : 0; };

// Tous les DPE d'un arrondissement qui répondent aux critères (toutes les pages).
const RADAR_SELECT = 'numero_dpe,date_reception_dpe,adresse_ban,adresse_brut,code_postal_ban,identifiant_ban,type_batiment,surface_habitable_logement,numero_etage_appartement,complement_adresse_logement,complement_adresse_batiment,etiquette_dpe,nombre_niveau_immeuble,_geopoint,annee_construction,periode_construction';
function radarQsAdeme(arr, c) {
  const q = ['code_postal_ban:' + arr.cp];
  if (arr.plusieursCommunes) q.push('code_insee_ban:' + arr.insee);
  q.push('date_reception_dpe:[' + (c.depuis || '*') + ' TO ' + (c.jusqua || '*') + ']');
  if (c.type === 'appartement' || c.type === 'maison') q.push('type_batiment:' + c.type); else q.push('(type_batiment:appartement OR type_batiment:maison)');
  q.push('surface_habitable_logement:[' + (c.surfaceMin || 9) + ' TO ' + (c.surfaceMax || '*') + ']');
  if (c.etageMin || c.etageMax) q.push('numero_etage_appartement:[' + (c.etageMin || 0) + ' TO ' + (c.etageMax || '*') + ']');
  const cl = (c.classes || []).filter((x) => /^[A-G]$/.test(x));
  if (cl.length && cl.length < 7) q.push('(' + cl.map((x) => 'etiquette_dpe:' + x).join(' OR ') + ')');
  return q.join(' AND ');
}
async function radarDpeArrondissement(arr, c, max) {
  const out = [];
  let url = ADEME_URL + '?' + new URLSearchParams({ size: '1000', sort: c.tri === 'ancien' ? 'date_reception_dpe' : '-date_reception_dpe', qs: radarQsAdeme(arr, c), select: RADAR_SELECT }).toString();
  let total = 0;
  while (url && out.length < max) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Seecret/1.0 (radar)', Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('ADEME ' + r.status + (d.detail ? ' : ' + d.detail : ''));
    total = d.total || total;
    (d.results || []).forEach((x) => out.push(x));
    url = d.next || null;
  }
  out.total = total;
  return out;
}

function radarFicheDepuisDpe(s, arr) {
  const comp = analyserComplementAdresse([s.complement_adresse_logement, s.complement_adresse_batiment].filter(Boolean).join(' '));
  let etage = (s.numero_etage_appartement != null && s.numero_etage_appartement !== '') ? parseInt(s.numero_etage_appartement, 10) : null;
  // L'ADEME met souvent 0 par défaut : le complément (« Etage 5 », « 6ème étage ») fait foi.
  if ((etage == null || etage === 0) && comp.etage && comp.etage !== 'RDC') etage = parseInt(comp.etage, 10);
  if (etage == null && comp.etage === 'RDC') etage = 0;
  if (etage == null) { const e = etageDepuisAdresseBrute(s.adresse_brut); if (e) etage = e === 'RDC' ? 0 : parseInt(e, 10); }
  const geo = String(s._geopoint || '').split(',').map(Number);
  return {
    id: 'rd-' + (s.numero_dpe || uid('x')), numeroDpe: s.numero_dpe || '', dpeDate: s.date_reception_dpe || null, dpe: s.etiquette_dpe || '',
    adresse: s.adresse_ban || s.adresse_brut || '', cp: s.code_postal_ban || arr.cp, insee: arr.insee, quartier: arr.quartier, identifiantBan: s.identifiant_ban || '',
    type: /maison/i.test(s.type_batiment || '') ? 'Maison' : 'Appartement', surface: Math.round(Number(s.surface_habitable_logement) || 0),
    etage: isFinite(etage) ? etage : null, porte: comp.position || comp.porte || '', batiment: comp.batiment || '', escalier: comp.escalier || '',
    niveauxImmeuble: Number(s.nombre_niveau_immeuble) || null, annee: s.annee_construction || null, periode: s.periode_construction || '',
    lat: isFinite(geo[0]) ? geo[0] : null, lon: isFinite(geo[1]) ? geo[1] : null
  };
}

// Société propriétaire (fichier DGFiP) : lot au même étage / même porte, ou immeuble entier.
function radarProprietaire(f, lotsFournis) {
  if (!pmMeta()) return { statut: 'fichier_absent' };
  let lots;
  if (lotsFournis) lots = lotsFournis.filter((l) => /^[PUN]$/.test(l.droit || 'P'));
  else {
    const q = pmParserAdresse(f.adresse + ' ' + f.cp);
    if (f.insee) q.insee = f.insee;
    if (!q.insee || !q.numero) return { statut: 'non_identifie' };
    lots = pmLotsImmeuble(q).filter((l) => /^[PUN]$/.test(l.droit || 'P'));
  }
  if (!lots.length) return { statut: 'non_identifie', societesImmeuble: 0 };
  const sirens = Array.from(new Set(lots.map((l) => l.siren || l.nom)));
  const immeubleEntier = sirens.length === 1 && lots.length >= 3;
  const niv = (l) => (/^-?\d+$/.test(String(l.niveau || '').trim()) ? parseInt(l.niveau, 10) : null);
  let auNiveau = f.etage != null ? lots.filter((l) => niv(l) === f.etage) : [];
  if (auNiveau.length && f.porte) {
    const p = pmNorm(f.porte);
    const memePorte = auNiveau.filter((l) => l.porte && (pmNorm(l.porte) === p || pmNorm(l.porte).indexOf(p.slice(0, 1)) === 0));
    if (memePorte.length) auNiveau = memePorte;
  }
  const sirensNiveau = Array.from(new Set(auNiveau.map((l) => l.siren || l.nom)));
  let lot = null; let confiance = '';
  if (sirensNiveau.length === 1) { lot = auNiveau[0]; confiance = f.porte && auNiveau.some((l) => l.porte) ? 'étage et porte' : 'étage'; }
  else if (immeubleEntier) { lot = lots[0]; confiance = 'immeuble entier'; }
  else if (f.type === 'Maison' && sirens.length === 1) { lot = lots[0]; confiance = 'maison'; }
  const societes = sirens.slice(0, 8).map((k) => { const l = lots.find((x) => (x.siren || x.nom) === k); return { siren: l.siren, nom: l.nom, type: l.type, nbLots: lots.filter((x) => (x.siren || x.nom) === k).length }; });
  if (!lot) return { statut: auNiveau.length ? 'plusieurs' : 'societes_immeuble', societesImmeuble: sirens.length, societes: societes, lotsSocietes: lots.length };
  return {
    statut: 'identifie', confiance: confiance, siren: lot.siren, nom: lot.nom, forme: lot.forme, estSci: lot.type === 'sci',
    droit: lot.droitLibelle, niveau: lot.niveauLibelle, porte: lot.porte, immeubleEntier: immeubleEntier,
    lotsImmeuble: lots.length, lotsSociete: lots.filter((x) => x.siren === lot.siren).length, societesImmeuble: sirens.length, societes: societes,
    institutionnel: RADAR_INSTITUTIONNELS.test(pmNorm(lot.nom))
  };
}

function radarProprietaireParcelle(f) {
  if (!f.parcelle || !f.parcelle.section || !f.parcelle.numero) return null;
  const lots = pmLotsParcelle(f.insee, f.parcelle.section, f.parcelle.numero);
  if (!lots.length) return null;
  const p = radarProprietaire(f, lots);
  if (p.statut === 'identifie') { p.confiance = (p.confiance || '') + ' · parcelle ' + f.parcelle.section + ' ' + f.parcelle.numero; p.source = 'parcelle'; }
  return p;
}
// Autres biens de la société dans le fichier (Paris) : adresses distinctes.
// Une requête groupée (adresse → nombre de lots, étages) au lieu de relire
// tous les lots : les gros bailleurs en ont des dizaines de milliers.
const RADAR_BIENS_CACHE = new Map();
function radarBiensSociete(siren) {
  if (!siren || !/^\d{9}$/.test(siren)) return [];
  if (RADAR_BIENS_CACHE.has(siren)) return RADAR_BIENS_CACHE.get(siren);
  const b = pmBase();
  if (b) {
    if (!b.biens) b.biens = b.b.prepare("SELECT l.insee, l.num, l.ind, v.nature, v.nom, COUNT(*) AS n, GROUP_CONCAT(DISTINCT l.niveau) AS niv FROM lot l JOIN voie v ON v.id = l.voie WHERE l.soc IN (SELECT id FROM soc WHERE siren = ?) GROUP BY l.insee, l.num, l.ind, l.voie ORDER BY n DESC");
    const res = b.biens.all(siren).map((r) => ({
      adresse: pmTexte([String(parseInt(r.num, 10) || r.num || ''), r.ind || '', r.nature || '', r.nom || ''].filter(Boolean).join(' ').replace(/\s+/g, ' ')),
      insee: r.insee, lots: r.n,
      niveaux: String(r.niv || '').split(',').filter(Boolean).sort().map(pmNiveauLibelle).filter(Boolean)
    }));
    if (RADAR_BIENS_CACHE.size > 2000) RADAR_BIENS_CACHE.clear();
    RADAR_BIENS_CACHE.set(siren, res);
    return res;
  }
  const lots = pmLignesSiren(siren).map(pmLotDepuisLigne);
  const par = {};
  lots.forEach((l) => { const k = l.insee + '|' + l.adresse; par[k] = par[k] || { adresse: l.adresse, insee: l.insee, lots: 0, niveaux: [] }; par[k].lots++; if (l.niveauLibelle && par[k].niveaux.indexOf(l.niveauLibelle) === -1) par[k].niveaux.push(l.niveauLibelle); });
  return Object.values(par).sort((a, b) => b.lots - a.lots);
}

// Dirigeants d'une société (SIRENE), mis en cache 30 jours.
async function radarDirigeants(db, siren) {
  db.radarSocietes = db.radarSocietes || {};
  const c = db.radarSocietes[siren];
  if (c && Date.now() - radarAnnee(c.maj) < 30 * 864e5) return c;
  const r = await sireneFetch('https://recherche-entreprises.api.gouv.fr/search?q=' + siren + '&per_page=1', { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0 (contact@seecret.fr)' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 429) throw Object.assign(new Error('SIRENE 429'), { limite: true });
  if (!r.ok) throw new Error('SIRENE ' + r.status);
  const d = await r.json().catch(() => null);
  if (!d || !Array.isArray(d.results)) throw new Error('SIRENE réponse illisible');
  const e = (d.results || []).find((x) => String(x.siren) === siren) || null;
  const an = new Date().getFullYear();
  const out = {
    maj: nowISO(), trouve: !!e, nomComplet: e ? (e.nom_complet || '') : '', creation: e ? (e.date_creation || '') : '', etat: e ? (e.etat_administratif || '') : '',
    siege: e && e.siege ? (e.siege.adresse || '') : '',
    dirigeants: e ? (e.dirigeants || []).slice(0, 4).map((x) => x.type_dirigeant === 'personne morale'
      ? { societe: x.denomination || '', siren: x.siren || '', qualite: x.qualite || '' }
      : { prenom: String(x.prenoms || '').split(' ')[0], prenoms: x.prenoms || '', nom: x.nom || '', qualite: x.qualite || '', age: x.annee_de_naissance ? an - Number(String(x.annee_de_naissance).slice(0, 4)) : null }) : []
  };
  db.radarSocietes[siren] = out;
  return out;
}

// Prix au m² médian de l'arrondissement (DVF, 3 dernières années), cache 30 jours.
async function radarPrixM2(db, arr, type) {
  db.radarPrix = db.radarPrix || {};
  const cle = arr.insee + '|' + type;
  const c = db.radarPrix[cle];
  if (c && Date.now() - radarAnnee(c.maj) < 30 * 864e5) return c;
  const brut = await dvfCerema({ code_insee: arr.insee, anneemut_min: String(new Date().getFullYear() - 3), codtypbien: type === 'Maison' ? '111' : '121' }, 2, { budgetMs: 20000 });
  const comp = brut.filter((x) => /^vente$/i.test(x.libnatmut || '') && Number(x.nblocmut || 0) <= 2 && Number(x.valeurfonc) > 0 && Number(x.sbati) > 0).map(mutationDvf);
  const st = statsPrixM2(comp);
  const out = { maj: nowISO(), m2: st && st.prixM2Median ? Math.round(st.prixM2Median) : null, n: comp.length };
  db.radarPrix[cle] = out;
  return out;
}

// Critères d'un client : sa recherche active (CRM) sinon sa fiche.
function radarCriteres(db, l) {
  const r = (db.recherches || []).filter((x) => x.clientId === l.id && x.statut !== 'archivee' && !x.archive).sort((a, b) => radarAnnee(b.cree) - radarAnnee(a.cree))[0];
  const src = r || l;
  const types = [].concat(r && r.types && r.types.length ? r.types : [], r && r.type ? [r.type] : [], l.typeBien ? [l.typeBien] : []).join(' ').toLowerCase();
  return {
    quartiers: (src.quartiers && src.quartiers.length ? src.quartiers : (l.quartiers || [])).map(String),
    budgetMax: Number((r && r.prixMax) || l.budgetMax || 0), surfaceMin: Number(src.surfaceMin || 0), surfaceMax: Number(src.surfaceMax || 0),
    maison: /maison/.test(types), appart: /appart/.test(types),
    etageMin: r ? Number(r.etageMin || 0) : 0, etageMax: r ? Number(r.etageMax || 0) : 0, dpe: r ? String(r.dpe || '') : '',
    maj: (r && (r.majLe || r.cree)) || l.majCriteres || l.cree || null, source: r ? 'recherche' : 'fiche'
  };
}
// Critère par critère, pour que l'agent voie POURQUOI un client correspond.
function radarCorrespondance(f, c) {
  const crit = [];
  if (!c.quartiers.length || c.quartiers.indexOf(f.quartier) === -1) return null; // secteur obligatoire
  crit.push({ c: 'Secteur', ok: true, d: labelQuartier(f.quartier) });
  if (c.maison || c.appart) { const ok = f.type === 'Maison' ? c.maison : c.appart; if (!ok) return null; crit.push({ c: 'Type', ok: true, d: f.type }); }
  if (c.surfaceMin) { if (f.surface < c.surfaceMin * 0.9) return null; crit.push({ c: 'Surface', ok: true, d: f.surface + ' m² ≥ ' + c.surfaceMin + ' m²' }); }
  if (c.surfaceMax && f.surface > c.surfaceMax * 1.15) return null;
  if (c.budgetMax && f.prixBas) { if (f.prixBas > c.budgetMax * 1.1) return null; crit.push({ c: 'Budget', ok: true, d: 'jusqu’à ' + (c.budgetMax >= 1e6 ? String(Math.round(c.budgetMax / 1e4) / 100).replace('.', ',') + ' M€' : Math.round(c.budgetMax / 1000) + ' k€') }); }
  if (c.etageMin && f.etage != null) { if (f.etage < c.etageMin) return null; crit.push({ c: 'Étage', ok: true, d: (f.etage === 0 ? 'RDC' : f.etage + 'e') + ' ≥ ' + c.etageMin + 'e' }); }
  if (c.dpe && f.dpe && DPE_ORDER_SERVEUR.indexOf(f.dpe) > DPE_ORDER_SERVEUR.indexOf(c.dpe)) crit.push({ c: 'DPE', ok: false, d: f.dpe + ' (souhaité ' + c.dpe + ' ou mieux) — travaux à prévoir' });
  const aReconfirmer = !c.maj || Date.now() - radarAnnee(c.maj) > 180 * 864e5;
  return { criteres: crit, aReconfirmer: aReconfirmer };
}
// Contexte calculé une fois par requête (critères de chaque client, DPE par adresse).
function radarContexte(db) {
  const clients = db.leads.filter((l) => ROLES_STAFF.indexOf(roleOf(l)) === -1 && l.statut !== 'suspendu' && l.statut !== 'refuse' && l.projet !== 'vendeur')
    .map((l) => ({ l: l, c: radarCriteres(db, l) })).filter((x) => x.c.quartiers.length);
  return { clients: clients, parBan: {} };
}
function radarAcquereurs(ctx, f) {
  const club = []; const leads = [];
  ctx.clients.forEach(({ l, c }) => {
    const m = radarCorrespondance(f, c);
    if (!m) return;
    const x = { id: l.id, nom: [l.prenom, l.nom].filter(Boolean).join(' '), criteres: m.criteres, aReconfirmer: m.aReconfirmer };
    (l.statut === 'accepte' ? club : leads).push(x);
  });
  return { club: club, leads: leads };
}

// Étiquettes et score (0-100) : plus c'est haut, plus la fiche mérite un appel.
function radarEtiquettes(f, nbDpeAdresse) {
  const t = []; const p = f.proprietaire || {};
  const jours = Math.floor((Date.now() - radarAnnee(f.dpeDate)) / 864e5);
  if (p.statut === 'identifie') {
    if (p.institutionnel) t.push({ id: 'institutionnel', l: 'Investisseur institutionnel' });
    if (p.immeubleEntier) t.push({ id: 'immeuble-entier', l: 'Immeuble entier à une société' });
    if (p.nbBiens === 1) t.push({ id: 'sci-un-bien', l: (p.estSci ? 'SCI' : 'Société') + ' d’un seul bien' });
    else if (p.nbBiens > 1) t.push({ id: 'multi-biens', l: p.nbBiens + ' immeubles à Paris' });
    if (p.dirigeantAge >= 70) t.push({ id: 'dirigeant-age', l: 'Gérant de ' + p.dirigeantAge + ' ans' });
  }
  const an = new Date().getFullYear();
  (p.bodacc || []).forEach((a) => {
    const y = Number(String(a.date || '').slice(0, 4)); const txt = radarNorm(a.famille + ' ' + a.type + ' ' + a.detail);
    if (y >= an - 1 && /dirigeant|gerant|gerance|administration/.test(txt) && !t.some((x) => x.id === 'gerance')) t.push({ id: 'gerance', l: 'Gérance changée en ' + y });
    if (/dissolution|liquidation/.test(txt) && y >= an - 2 && !t.some((x) => x.id === 'dissolution')) t.push({ id: 'dissolution', l: 'Dissolution / liquidation (' + y + ')' });
    if (/procedure(s)? collective|redressement|sauvegarde/.test(txt) && y >= an - 3 && !t.some((x) => x.id === 'procedure')) t.push({ id: 'procedure', l: 'Procédure collective (' + y + ')' });
  });
  const vente = f.ventes && f.ventes.memeLogement && f.ventes.memeLogement[0];
  if (vente && vente.date) t.push({ id: 'acquis', l: 'Acquis en ' + String(vente.date).slice(0, 4) });
  if (nbDpeAdresse >= 2) t.push({ id: 'immeuble-mouvement', l: 'Immeuble en mouvement · ' + nbDpeAdresse + ' DPE' });
  if (jours <= 15) t.push({ id: 'dpe-recent', l: 'DPE de moins de 15 jours' });
  if (f.dpe === 'F' || f.dpe === 'G') t.push({ id: 'passoire', l: 'Passoire thermique (' + f.dpe + ') : location bientôt interdite' });
  return t;
}
function radarScore(f, acq) {
  const p = f.proprietaire || {}; const tags = (f.etiquettes || []).map((x) => x.id);
  let s = 20;
  if (p.statut === 'identifie') s += 20 + (p.confiance === 'étage et porte' ? 5 : 0);
  if (tags.indexOf('sci-un-bien') > -1) s += 10;
  if (tags.indexOf('immeuble-entier') > -1) s += 5;
  if (tags.indexOf('dirigeant-age') > -1) s += 5;
  if (tags.indexOf('immeuble-mouvement') > -1) s += 8;
  if (tags.indexOf('dpe-recent') > -1) s += 8;
  if (tags.indexOf('passoire') > -1) s += 6;
  if (tags.indexOf('gerance') > -1) s += 8;
  if (tags.indexOf('dissolution') > -1) s += 10;
  if (tags.indexOf('procedure') > -1) s += 6;
  if (tags.indexOf('institutionnel') > -1) s -= 25;
  s += Math.min(18, acq.club.length * 9) + Math.min(12, acq.leads.length * 3);
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Lance fn sur chaque élément, n à la fois (au lieu d'un par un).
async function enParallele(liste, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, async () => { while (i < liste.length) { const k = i++; await fn(liste[k], k); } }));
}
// Critères par défaut : tout Paris, DPE des 4 derniers mois.
function radarCriteresDefaut() { return { secteurs: radarZones().map((a) => a.quartier), type: '', surfaceMin: 25, surfaceMax: 0, etageMin: 0, etageMax: 0, classes: [], depuis: new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10), jusqua: '', proprio: '' }; }
function radarCriteresPropres(b) {
  const d = radarCriteresDefaut();
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  const secteurs = Array.isArray(b.secteurs) ? b.secteurs.filter((q) => radarZones().some((a) => a.quartier === q)) : [];
  return {
    secteurs: secteurs.length ? secteurs : d.secteurs, type: ['appartement', 'maison'].indexOf(b.type) > -1 ? b.type : '',
    surfaceMin: n(b.surfaceMin), surfaceMax: n(b.surfaceMax), etageMin: n(b.etageMin), etageMax: n(b.etageMax),
    classes: Array.isArray(b.classes) ? b.classes.filter((x) => /^[A-G]$/.test(x)) : [],
    depuis: date(b.depuis) || (b.depuis === '' ? '' : d.depuis), jusqua: date(b.jusqua), proprio: ['societe', 'sci', 'identifie'].indexOf(b.proprio) > -1 ? b.proprio : ''
  };
}
function radarLibelleCriteres(c) {
  const sect = c.secteurs.length === 20 ? 'Tout Paris' : c.secteurs.map((q) => labelQuartier(q).replace('Paris ', '')).join(', ');
  return [sect, c.type === 'maison' ? 'maisons' : c.type === 'appartement' ? 'appartements' : '', c.surfaceMin || c.surfaceMax ? (c.surfaceMin || 0) + '–' + (c.surfaceMax || '…') + ' m²' : '',
    c.etageMin || c.etageMax ? 'étage ' + (c.etageMin || 0) + '–' + (c.etageMax || '…') : '', c.classes.length ? 'DPE ' + c.classes.join('') : '',
    c.depuis ? 'DPE depuis le ' + c.depuis.split('-').reverse().join('/') : '', c.proprio === 'sci' ? 'SCI' : c.proprio === 'societe' ? 'sociétés' : ''].filter(Boolean).join(' · ');
}

// Enrichissement en ricochet, en tâche de fond : chaque étape s'appuie sur la
// précédente (adresse → société → dirigeants → annonces légales → autres
// biens → ventes passées → LinkedIn / site).
async function enParallele(liste, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, async () => { while (i < liste.length) { const k = i++; await fn(liste[k], k); } }));
}
async function radarBodacc(db, siren) {
  db.radarBodacc = db.radarBodacc || {};
  const c = db.radarBodacc[siren];
  if (c && Date.now() - radarAnnee(c.maj) < 30 * 864e5) return c;
  const p = new URLSearchParams({ dataset: 'annonces-commerciales', q: siren, rows: '20', sort: '-dateparution' });
  const r = await fetch(BODACC_URL + '?' + p.toString(), { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('BODACC ' + r.status);
  const d = await r.json().catch(() => ({}));
  const annonces = (d.records || []).map((x) => x.fields || {}).filter((f) => (Array.isArray(f.registre) ? f.registre : [f.registre]).some((x) => String(x || '').replace(/\s/g, '').indexOf(siren) > -1))
    .map((f) => ({ date: f.dateparution || null, famille: f.familleavis_lib || f.familleavis || '', type: f.typeavis_lib || '', detail: String(f.modificationsgenerales ? JSON.stringify(f.modificationsgenerales) : (f.acte ? JSON.stringify(f.acte) : (f.jugement ? JSON.stringify(f.jugement) : ''))).replace(/[{}"\[\]]/g, ' ').replace(/\s+/g, ' ').slice(0, 300), tribunal: f.tribunal || '' }));
  const out = { maj: nowISO(), annonces: annonces };
  db.radarBodacc[siren] = out;
  return out;
}
// Ventes passées à l'adresse (DVF autour du point GPS, même surface ± 15 %).
async function radarVentesAdresse(f) {
  if (!f.lat || !f.lon) return null;
  const d = 0.00025;
  const bbox = [f.lon - d, f.lat - d, f.lon + d, f.lat + d].map((v) => v.toFixed(6)).join(',');
  const brut = await dvfCerema({ code_insee: f.insee, in_bbox: bbox }, 2, { geo: true, budgetMs: 15000 });
  const ventes = brut.filter((x) => /^vente/i.test(x.libnatmut || '') && Number(x.valeurfonc) > 0).map(mutationDvf).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const memeLogement = ventes.filter((v) => v.surface && f.surface && Math.abs(Number(v.surface) - f.surface) <= f.surface * 0.15);
  return { maj: nowISO(), ventes: ventes.slice(0, 15), memeLogement: memeLogement.slice(0, 5) };
}
// LinkedIn du dirigeant et site de la société (Exa, si EXA_API_KEY est configurée).
async function radarExa(query, categorie) {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify(Object.assign({ query: query, numResults: 5, contents: { text: { maxCharacters: 1500 } } }, categorie ? { category: categorie } : {})) });
  if (r.status === 429 || r.status === 402) throw Object.assign(new Error('quota Exa'), { quota: true });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Exa ' + r.status);
  return d.results || [];
}
const radarNorm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function radarContactsSociete(db, siren) {
  db.radarContacts = db.radarContacts || {};
  const c = db.radarContacts[siren];
  if (c && Date.now() - radarAnnee(c.maj) < 60 * 864e5) return c;
  const soc = (db.radarSocietes || {})[siren] || {};
  const out = { maj: nowISO(), linkedin: [], site: null, telephones: [], emails: [], source: 'Exa' };
  for (const d of (soc.dirigeants || []).filter((x) => x.nom).slice(0, 2)) {
    const res = await radarExa(d.prenom + ' ' + d.nom + ' ' + (soc.nomComplet || ''), 'linkedin profile');
    (res || []).forEach((x) => {
      const t = radarNorm(x.title + ' ' + x.url);
      if (/linkedin\.com\/in\//.test(x.url) && t.indexOf(radarNorm(d.nom).split(' ')[0]) > -1 && t.indexOf(radarNorm(d.prenom)) > -1 && !out.linkedin.some((l) => l.url === x.url))
        out.linkedin.push({ nom: d.prenom + ' ' + d.nom, url: x.url, titre: String(x.title || '').slice(0, 140) });
    });
  }
  if (soc.nomComplet && !/^SCI\b/i.test(soc.nomComplet)) {
    const res = await radarExa(soc.nomComplet + ' Paris site officiel', 'company');
    const mots = radarNorm(soc.nomComplet).split(/\s+/).filter((m) => m.length > 3);
    const site = (res || []).find((x) => mots.some((m) => radarNorm(x.title + ' ' + x.url).indexOf(m) > -1) && !/linkedin|societe\.com|pappers|annuaire|verif\.com|infogreffe|manageo/.test(x.url));
    if (site) {
      out.site = { url: site.url, titre: String(site.title || '').slice(0, 140) };
      const txt = String(site.text || '');
      out.telephones = Array.from(new Set((txt.match(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g) || []).map((t) => t.replace(/[^\d+]/g, '')))).slice(0, 3);
      out.emails = Array.from(new Set(txt.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])).slice(0, 3);
    }
  }
  db.radarContacts[siren] = out;
  return out;
}

const RADAR_JOBS = {};
function radarJob(id) { return RADAR_JOBS[id] || null; }
async function radarRechercher(rechercheId, criteres) {
  const job = RADAR_JOBS[rechercheId] = { enCours: true, etape: 'Lecture des DPE…', trouves: 0, total: 0, enrichis: 0, aEnrichir: 0, debut: Date.now(), erreurs: [] };
  try {
    const arrs = radarZones().filter((a) => criteres.secteurs.indexOf(a.quartier) > -1);
    const lus = [];
    let faits = 0;
    const max = Math.floor(6000 / Math.max(1, arrs.length)) + 200;
    await enParallele(arrs, 5, async (arr) => {
      try { const res = await radarDpeArrondissement(arr, criteres, max); job.total += res.total || res.length; res.forEach((x) => lus.push(radarFicheDepuisDpe(x, arr))); }
      catch (e) { job.erreurs.push(arr.label + ' : ' + e.message); }
      job.etape = 'Lecture des DPE · ' + (++faits) + '/' + arrs.length + ' secteurs · ' + lus.length + ' trouvés…';
    });
    // Fusion avec les fiches connues (un logement = adresse + étage + surface).
    let db = readDb();
    db.radarFiches = Array.isArray(db.radarFiches) ? db.radarFiches : [];
    const cleLogement = (f) => [f.identifiantBan || pmNorm(f.adresse), f.etage, Math.round(f.surface / 3)].join('|');
    const parId = new Map(db.radarFiches.map((f) => [f.id, f]));
    const parLogement = new Map(db.radarFiches.map((f) => [cleLogement(f), f]));
    const ids = [];
    lus.forEach((f) => {
      let g = parId.get(f.id) || parLogement.get(cleLogement(f));
      if (g) { if (radarAnnee(f.dpeDate) > radarAnnee(g.dpeDate)) Object.assign(g, f, { id: g.id, statut: g.statut, historique: g.historique, proprietaire: g.proprietaire }); }
      else { g = Object.assign(f, { statut: 'a_revoir', cree: nowISO(), historique: [] }); db.radarFiches.push(g); parId.set(g.id, g); parLogement.set(cleLogement(g), g); }
      if (ids.indexOf(g.id) === -1) ids.push(g.id);
    });
    const rec = (db.radarRecherches || []).find((r) => r.id === rechercheId);
    if (rec) { rec.ficheIds = ids; rec.majLe = nowISO(); rec.total = job.total; }
    job.trouves = ids.length;
    // Étape 1 (immédiate, fichier local) : propriétaire + autres biens.
    job.etape = 'Propriétaires (fichier DGFiP)…';
    const fiches = ids.map((id) => parId.get(id));
    const annee = (pmMeta() || {}).annee || null;
    const parInsee = {};
    fiches.forEach((f) => (parInsee[f.insee] = parInsee[f.insee] || []).push(f));
    Object.keys(parInsee).forEach((insee) => {
      parInsee[insee].forEach((f) => {
        if (f.proprietaire && f.proprietaire.statut !== 'fichier_absent' && f.proprietaire.millesime === annee) return;
        const p = radarProprietaire(f);
        if (p.statut === 'identifie') p.nbBiens = radarBiensSociete(p.siren).length || 1;
        p.millesime = annee; f.proprietaire = p;
      });
      PM_CACHE.clear();
    });
    writeDb(db);
    // Étape 2 (réseau) : dirigeants, annonces légales, prix du secteur, ventes passées, LinkedIn.
    db = readDb();
    const F = ids.map((id) => db.radarFiches.find((x) => x.id === id)).filter(Boolean);
    const sirens = Array.from(new Set(F.filter((f) => f.proprietaire && f.proprietaire.statut === 'identifie' && /^\d{9}$/.test(f.proprietaire.siren || '')).map((f) => f.proprietaire.siren)));
    const ventesAFaire = F.filter((f) => f.lat && (!f.ventes || Date.now() - radarAnnee(f.ventes.maj) > 60 * 864e5))
      .sort((a, b) => (b.proprietaire && b.proprietaire.statut === 'identifie' ? 1 : 0) - (a.proprietaire && a.proprietaire.statut === 'identifie' ? 1 : 0)).slice(0, 400);
    const prix = [];
    arrs.forEach((arr) => ['Appartement', 'Maison'].forEach((type) => { if (F.some((f) => f.insee === arr.insee && f.type === type)) prix.push([arr, type]); }));
    job.aEnrichir = sirens.length * 2 + ventesAFaire.length + prix.length;
    const fait = () => { job.enrichis++; job.etape = 'Enrichissement · ' + job.enrichis + '/' + job.aEnrichir + ' recherches faites (dirigeants, annonces légales, ventes, prix)…'; };
    let pause = 0;
    const essai = async (fn) => { for (let k = 0; k < 3; k++) { try { return await fn(); } catch (e) { await new Promise((r) => setTimeout(r, e.limite ? 3000 : 600)); } } return null; };
    await Promise.all([
      enParallele(sirens, 3, async (siren) => { await essai(() => radarDirigeants(db, siren)); fait(); await essai(() => radarBodacc(db, siren)); fait(); await new Promise((r) => setTimeout(r, 300)); }),
      enParallele(prix, 4, async ([arr, type]) => { await essai(() => radarPrixM2(db, arr, type)); fait(); }),
      enParallele(ventesAFaire, 3, async (f) => { const v = await essai(() => radarVentesAdresse(f)); if (v) f.ventes = v; fait(); if (++pause % 25 === 0) writeDb(db); })
    ]);
    radarAppliquer(db, F);
    writeDb(db);
    // Étape 3 : LinkedIn et site (quota Exa) pour les sociétés les plus prometteuses.
    if (process.env.EXA_API_KEY) {
      job.etape = 'Recherche LinkedIn et sites…';
      const ctx = radarContexte(db);
      const prioritaires = Array.from(new Set(F.filter((f) => f.proprietaire && f.proprietaire.statut === 'identifie' && !f.proprietaire.institutionnel).map((f) => ({ f, s: radarAvecCalculs(ctx, f).fiche.score })).sort((a, b) => b.s - a.s).map((x) => x.f.proprietaire.siren))).slice(0, 40);
      let quota = false;
      await enParallele(prioritaires, 2, async (siren) => { if (quota) return; try { await radarContactsSociete(db, siren); } catch (e) { if (e.quota) quota = true; } });
      if (quota) job.erreurs.push('Quota Exa atteint : LinkedIn et sites limités aux premières sociétés.');
      radarAppliquer(db, F);
      writeDb(db);
    }
    db.radarLog = [{ at: nowISO(), rechercheId: rechercheId, dpeLus: lus.length, fiches: ids.length }].concat(db.radarLog || []).slice(0, 30);
    writeDb(db);
    Object.assign(job, { enCours: false, etape: '', fin: Date.now() });
    console.log('[radar] recherche ' + rechercheId + ' : ' + ids.length + ' biens, ' + sirens.length + ' sociétés');
  } catch (e) {
    Object.assign(job, { enCours: false, etape: '', erreur: String(e.message || e) });
    console.error('[radar] échec :', e);
  }
}
// Recopie dans chaque fiche ce que les étapes ont trouvé (dirigeant, annonces, contacts, prix).
function radarAppliquer(db, fiches) {
  fiches.forEach((f) => {
    const p = f.proprietaire || {};
    const soc = p.siren && db.radarSocietes && db.radarSocietes[p.siren];
    if (soc) { const d = soc.dirigeants.find((x) => x.nom); p.dirigeant = d || null; p.dirigeantAge = d ? d.age : null; p.dirigeants = soc.dirigeants; p.societe = { creation: soc.creation, siege: soc.siege, etat: soc.etat, nomComplet: soc.nomComplet }; }
    const bo = p.siren && db.radarBodacc && db.radarBodacc[p.siren];
    if (bo) p.bodacc = bo.annonces;
    const ct = p.siren && db.radarContacts && db.radarContacts[p.siren];
    if (ct) p.contacts = { linkedin: ct.linkedin, site: ct.site, telephones: ct.telephones, emails: ct.emails };
    const px = db.radarPrix && db.radarPrix[f.insee + '|' + f.type];
    if (px && px.m2 && f.surface) { f.prixM2 = px.m2; f.prixBas = Math.round(f.surface * px.m2 * 0.93 / 10000) * 10000; f.prixHaut = Math.round(f.surface * px.m2 * 1.07 / 10000) * 10000; }
  });
}
// ============================================================================
// RADAR « FUTURS VENDEURS » — une ligne = un DPE ; tout le reste sert à
// remplir sa fiche (propriétaire, signaux de vente, contacts, clients
// intéressés) pour repérer les futurs vendeurs et pouvoir les contacter.
// Les DPE vivent dans leur propre base SQLite (radar.db), indexée par
// arrondissement et par date, pour ne pas alourdir la base principale.
// ============================================================================
const RadarSQL = (() => {
  try {
    const Database = require('better-sqlite3');
    const sql = new Database(path.join(DATA_DIR, 'radar.db'));
    sql.pragma('journal_mode = WAL');
    sql.exec('CREATE TABLE IF NOT EXISTS fiches (id TEXT PRIMARY KEY, quartier TEXT, date TEXT, type TEXT, surface REAL, ban TEXT, data TEXT)');
    sql.exec('CREATE INDEX IF NOT EXISTS i_fiches_qd ON fiches (quartier, date)');
    sql.exec('CREATE INDEX IF NOT EXISTS i_fiches_d ON fiches (date)');
    sql.exec('CREATE INDEX IF NOT EXISTS i_fiches_ban ON fiches (ban)');
    sql.exec('CREATE TABLE IF NOT EXISTS couverture (cle TEXT PRIMARY KEY, maj TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS cache (type TEXT, cle TEXT, maj TEXT, data TEXT, PRIMARY KEY (type, cle))');
    return sql;
  } catch (e) { console.error('[radar] base indisponible :', e.message); return null; }
})();
const RS = RadarSQL ? {
  put: RadarSQL.prepare('INSERT INTO fiches (id, quartier, date, type, surface, ban, data) VALUES (@id, @quartier, @date, @type, @surface, @ban, @data) ON CONFLICT(id) DO UPDATE SET date = excluded.date, data = excluded.data, surface = excluded.surface, type = excluded.type'),
  get: RadarSQL.prepare('SELECT data FROM fiches WHERE id = ?'),
  parBan: RadarSQL.prepare('SELECT id, data FROM fiches WHERE ban = ?'),
  liste: RadarSQL.prepare('SELECT data FROM fiches WHERE date >= @de AND date <= @a AND (@q = \'\' OR quartier = @q) AND (@t = \'\' OR type = @t) AND surface >= @smin ORDER BY date DESC LIMIT 20000'),
  cpt: RadarSQL.prepare('SELECT COUNT(*) AS n FROM fiches'),
  derniere: RadarSQL.prepare('SELECT MAX(date) AS d FROM fiches'),
  couvGet: RadarSQL.prepare('SELECT maj FROM couverture WHERE cle = ?'),
  couvSet: RadarSQL.prepare('INSERT INTO couverture (cle, maj) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET maj = excluded.maj'),
  cacheGet: RadarSQL.prepare('SELECT maj, data FROM cache WHERE type = ? AND cle = ?'),
  cacheSet: RadarSQL.prepare('INSERT INTO cache (type, cle, maj, data) VALUES (?, ?, ?, ?) ON CONFLICT(type, cle) DO UPDATE SET maj = excluded.maj, data = excluded.data')
} : null;
// Une fois : recharger les DPE déjà stockés pour corriger les étages (0 par défaut).
if (RS) { try { if (!RS.cacheGet.get('meta', 'etage-v2')) { RadarSQL.exec('DELETE FROM couverture'); RS.cacheSet.run('meta', 'etage-v2', new Date().toISOString(), '1'); } } catch (e) { /* rien */ } }
const rsLire = (row) => { try { return JSON.parse(row.data); } catch (e) { return null; } };
function rsEcrire(f) { RS.put.run({ id: f.id, quartier: f.quartier, date: String(f.dpeDate || '').slice(0, 10), type: f.type, surface: f.surface || 0, ban: f.identifiantBan || '', data: JSON.stringify(f) }); }
function rsFiche(id) { const r = RS.get.get(id); return r ? rsLire(r) : null; }
// Petits caches (sociétés, annonces, contacts, prix) : un objet « db-like »
// rempli pour une clé, pour réutiliser radarDirigeants & co tels quels.
function avecCache(type, champ, cle, maxJours, fn) {
  const r = RS.cacheGet.get(type, cle);
  if (r && Date.now() - radarAnnee(r.maj) < maxJours * 864e5) { try { return Promise.resolve(JSON.parse(r.data)); } catch (e) { /* recalcul */ } }
  const tmp = {}; tmp[champ] = {};
  return fn(tmp).then((v) => { const val = v || tmp[champ][cle]; if (val) RS.cacheSet.run(type, cle, nowISO(), JSON.stringify(val)); return val; });
}
const cacheLu = (type, cle) => { const r = RS && RS.cacheGet.get(type, cle); try { return r ? JSON.parse(r.data) : null; } catch (e) { return null; } };

// ---- Périodes de DPE ----
// L'ADEME publie avec une à deux semaines de retard : « aujourd'hui » et
// « cette semaine » partent de la dernière date publiée, pas du calendrier.
function radarDernierePublication() {
  try { const r = RS && RS.derniere.get(); return r && r.d ? r.d : null; } catch (e) { return null; }
}
function radarPeriode(code) {
  const j = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const today = j(0);
  const der = radarDernierePublication();
  const ref = der && der < today ? der : null;
  const jr = (n) => new Date(Date.parse(ref) - n * 864e5).toISOString().slice(0, 10);
  if (code === 'aujourdhui') return ref ? { de: ref, a: today, recent: true, libelle: 'le ' + ref.split('-').reverse().join('/') + ' (dernière publication ADEME)', reference: ref } : { de: j(1), a: today, recent: true, libelle: 'aujourd’hui' };
  if (code === 'semaine') return ref ? { de: jr(6), a: today, recent: true, libelle: 'la dernière semaine publiée', reference: ref } : { de: j(7), a: today, recent: true, libelle: 'cette semaine' };
  if (code === 'mois' || !code) return { de: j(31), a: today, recent: true, libelle: 'ce mois-ci' };
  if (code === '3mois') return { de: j(92), a: today, recent: false, libelle: 'ces 3 derniers mois' };
  if (/^\d{4}$/.test(code)) return { de: code + '-01-01', a: code + '-12-31', recent: false, annee: code, libelle: 'en ' + code };
  return radarPeriode('mois');
}
// ---- Chargement des DPE (à la demande, puis gardés) ----
const RADAR_CHARGEMENTS = {};
function radarCouvertureCle(arr, per) { return arr.quartier + '|' + (per.recent ? 'recent' : per.annee || per.de); }
function radarCouvert(arr, per) {
  const r = RS.couvGet.get(radarCouvertureCle(arr, per));
  if (!r) return false;
  const age = Date.now() - radarAnnee(r.maj);
  return per.recent ? age < 6 * 3600e3 : (per.annee && Number(per.annee) < new Date().getFullYear() ? true : age < 24 * 3600e3);
}
// Place gardée libre sur le volume, et nombre maximum de DPE stockés : au-delà,
// les plus anciens jamais travaillés sont retirés (ils se rechargent au besoin).
const RADAR_MARGE_MO = Number(process.env.RADAR_MARGE_MO) || 120;
const RADAR_MAX_FICHES = Number(process.env.RADAR_MAX_FICHES) || 40000;
function radarPlafonner() {
  try {
    const n = RS.cpt.get().n;
    const libre = placeLibreMo();
    const enTrop = Math.max(n - RADAR_MAX_FICHES, libre !== null && libre < RADAR_MARGE_MO ? Math.ceil(n * 0.25) : 0);
    if (enTrop <= 0) return;
    const ids = RadarSQL.prepare('SELECT id, data FROM fiches ORDER BY date ASC').all().filter((r) => {
      try { const f = JSON.parse(r.data); return !((f.statut && f.statut !== 'a_revoir') || f.leadId || (f.historique || []).length || f.rappel); } catch (e) { return true; }
    }).slice(0, enTrop).map((r) => r.id);
    const del = RadarSQL.prepare('DELETE FROM fiches WHERE id = ?');
    RadarSQL.transaction((l) => l.forEach((id) => del.run(id)))(ids);
    RadarSQL.pragma('wal_checkpoint(TRUNCATE)');
    console.warn('[radar] ' + ids.length + ' DPE anciens retirés pour garder de la place (' + placeLibreMo() + ' Mo libres).');
  } catch (e) { console.error('[radar] plafond :', e.message); }
}
// Une fois : oublier les sociétés enregistrées « introuvables » pendant que
// l'annuaire nous limitait (elles seront redemandées).
if (RS) { try { if (!RS.cacheGet.get('meta', 'soc-purge-1')) { const n = RadarSQL.prepare("DELETE FROM cache WHERE type = 'soc' AND data LIKE '%\"trouve\":false%'").run().changes; RadarSQL.prepare("DELETE FROM cache WHERE type = 'soc' AND data LIKE '%\"dirigeants\":[]%'").run(); RS.cacheSet.run('meta', 'soc-purge-1', new Date().toISOString(), '1'); console.log('[radar] ' + n + ' société(s) « introuvable(s) » à redemander à l\'annuaire'); } } catch (e) { console.error('[radar] purge sociétés :', e.message); } }
if (RS) { try { if (!RS.cacheGet.get('meta', 'contacts-purge-1')) { RadarSQL.prepare("DELETE FROM cache WHERE type = 'contacts' AND data LIKE '%\"linkedin\":[]%' AND data NOT LIKE '%\"site\":{%'").run(); RadarSQL.prepare("DELETE FROM cache WHERE type = 'coordpro' AND data NOT LIKE '%\"trouve\":true%'").run(); RS.cacheSet.run('meta', 'contacts-purge-1', new Date().toISOString(), '1'); } } catch (e) { /* rien */ } }
// Une fois : reconnaître de nouveau après la correction du format 2026.
setTimeout(() => {
  try {
    if (!RS || !pmMeta() || RS.cacheGet.get('meta', 'reident-2026b')) return;
    RS.cacheSet.run('meta', 'reident-2026b', new Date().toISOString(), '1');
    radarReidentifier().catch((e) => console.error('[radar] ré-identification :', e.message));
  } catch (e) { console.error('[radar] ré-identification :', e.message); }
}, 30 * 1000);
// Après un import du fichier des propriétaires : on reconnaît les sociétés
// propriétaires de tous les DPE déjà stockés, sans rien retélécharger.
let RADAR_REIDENT = false;
async function radarReidentifier() {
  if (!RS || RADAR_REIDENT) return;
  RADAR_REIDENT = true;
  try {
    const annee = (pmMeta() || {}).annee || null;
    const rows = RadarSQL.prepare('SELECT data FROM fiches').all();
    let n = 0; const t0 = Date.now();
    const maj = RadarSQL.transaction((l) => l.forEach((r) => {
      const f = rsLire(r); if (!f) return;
      if (f.proprietaire && f.proprietaire.statut === 'identifie' && f.proprietaire.millesime === annee) return;
      const p = radarProprietaire(f);
      if (p.statut === 'identifie') { p.nbBiens = radarBiensSociete(p.siren).length || 1; n++; }
      p.millesime = annee; f.proprietaire = p; rsEcrire(f);
    }));
    // Par lots de 200, en rendant la main entre deux lots : le site reste réactif.
    for (let i = 0; i < rows.length; i += 200) { maj(rows.slice(i, i + 200)); await new Promise((r) => setImmediate(r)); }
    console.log('[radar] ' + n + ' propriétaire(s) société identifié(s) sur ' + rows.length + ' DPE stockés (' + Math.round((Date.now() - t0) / 1000) + ' s).');
  } finally { RADAR_REIDENT = false; }
}
async function radarCharger(cle, arrs, per) {
  if (RADAR_CHARGEMENTS[cle] && RADAR_CHARGEMENTS[cle].enCours) return;
  const job = RADAR_CHARGEMENTS[cle] = { enCours: true, faits: 0, total: arrs.length, lus: 0, erreurs: [] };
  const libre = placeLibreMo();
  // Une commune ajoutée pèse peu (quelques centaines de DPE) : marge réduite.
  const marge = arrs.every((a) => !/^p\d+$/.test(a.quartier)) ? Math.min(50, RADAR_MARGE_MO) : RADAR_MARGE_MO;
  if (libre !== null && libre < marge) { job.enCours = false; job.erreurs.push('Disque du site presque plein (' + libre + ' Mo libres) : chargement des DPE suspendu.'); return; }
  const annee = (pmMeta() || {}).annee || null;
  // Les périodes récentes chargent 31 jours d'un coup (aujourd'hui, semaine et mois en même temps).
  const crit = per.recent ? { depuis: radarPeriode('mois').de, jusqua: '' } : { depuis: per.de, jusqua: per.a };
  await enParallele(arrs, 4, async (arr) => {
    try {
      // Déjà chargé une fois : on ne redemande que ce qui a pu paraître depuis
      // (30 jours avant le dernier passage, car l'ADEME publie avec retard).
      const deja = RS.couvGet.get(radarCouvertureCle(arr, per));
      const c2 = Object.assign({}, crit);
      if (deja) { const depuis = new Date(radarAnnee(deja.maj) - 30 * 864e5).toISOString().slice(0, 10); if (depuis > (c2.depuis || '')) c2.depuis = depuis; }
      const res = await radarDpeArrondissement(arr, c2, 4000);
      const ecrire = RadarSQL.transaction((liste) => liste.forEach((x) => {
        const f = radarFicheDepuisDpe(x, arr);
        const ancien = rsFiche(f.id);
        if (ancien) { f.statut = ancien.statut; f.historique = ancien.historique; f.leadId = ancien.leadId; f.rappel = ancien.rappel; f.proprietaire = ancien.proprietaire; f.ventes = ancien.ventes; }
        else { f.statut = 'a_revoir'; f.historique = []; f.cree = nowISO(); }
        if (!f.proprietaire || f.proprietaire.millesime !== annee || f.proprietaire.statut === 'fichier_absent') {
          const p = radarProprietaire(f);
          if (p.statut === 'identifie') p.nbBiens = radarBiensSociete(p.siren).length || 1;
          p.millesime = annee; f.proprietaire = p;
        }
        rsEcrire(f);
      }));
      ecrire(res);
      job.lus += res.length;
      RS.couvSet.run(radarCouvertureCle(arr, per), nowISO());
      if (per.recent) RS.couvSet.run(arr.quartier + '|recent', nowISO());
      PM_CACHE.clear();
    } catch (e) { job.erreurs.push(arr.label + ' : ' + e.message); }
    job.faits++;
  });
  job.enCours = false;
  radarPlafonner();
  console.log('[radar] chargement ' + cle + ' : ' + job.lus + ' DPE');
  radarEnrichirFond(arrs, per);
}
// En tâche de fond : enrichit d'avance les fiches les plus prometteuses
// (propriétaire société identifié, DPE le plus récent) pour que la liste
// montre déjà gérant, annonces et contacts.
let RADAR_FOND = false;
async function radarEnrichirFond(arrs, per) {
  if (RADAR_FOND) return;
  return ARRIERE_PLAN.run({ fond: true }, () => radarEnrichirFondInterne(arrs, per));
}
async function radarEnrichirFondInterne(arrs, per) {
  RADAR_FOND = true;
  try {
    const rows = [];
    arrs.forEach((a) => RS.liste.all({ de: per.de, a: per.a + 'z', q: a.quartier, t: '', smin: 0 }).forEach((r) => { const f = rsLire(r); if (f && radarAEnrichir(f) && f.proprietaire && f.proprietaire.statut === 'identifie' && !f.proprietaire.institutionnel) rows.push(f); }));
    rows.sort((a, b) => radarAnnee(b.dpeDate) - radarAnnee(a.dpeDate));
    await enParallele(rows.slice(0, 80), 2, async (f) => { try { await radarEnrichirUneFois(f); } catch (e) { /* suivante */ } });
    // DPE dont l'adresse n'est pas reconnue : parcelle cadastrale (IGN), puis fichier DGFiP.
    if (pmMeta()) {
      const sans = [];
      arrs.forEach((a) => RS.liste.all({ de: per.de, a: per.a + 'z', q: a.quartier, t: '', smin: 0 }).forEach((r) => { const f = rsLire(r); if (f && f.lat && !f.parcelle && (!f.proprietaire || f.proprietaire.statut !== 'identifie')) sans.push(f); }));
      sans.sort((a, b) => radarAnnee(b.dpeDate) - radarAnnee(a.dpeDate));
      let n = 0;
      await enParallele(sans.slice(0, 300), 3, async (f) => {
        try {
          const v = await radarParcelle(f, { sansVentes: true });
          f.parcelle = v || { section: '', numero: '', ventesAFaire: true, introuvable: true };
          const pp = radarProprietaireParcelle(f);
          if (pp && pp.statut === 'identifie') { pp.millesime = (pmMeta() || {}).annee || null; pp.nbBiens = radarBiensSociete(pp.siren).length || 1; f.proprietaire = pp; n++; }
          rsEcrire(f);
        } catch (e) { /* suivante */ }
      });
      if (sans.length) console.log('[radar] parcelle : ' + n + ' propriétaire(s) trouvé(s) sur ' + Math.min(300, sans.length) + ' DPE non reconnus par l\'adresse');
    }
  } finally { RADAR_FOND = false; }
}
// Les fiches de l'ancienne version (dans la base principale) passent dans radar.db.
setTimeout(() => {
  if (!RS) return;
  const db = readDb();
  if (!Array.isArray(db.radarFiches) || !db.radarFiches.length) return;
  RadarSQL.transaction((l) => l.forEach((f) => { if (f && f.id && f.quartier) rsEcrire(f); }))(db.radarFiches);
  console.log('[radar] ' + db.radarFiches.length + ' anciennes fiches déplacées dans radar.db');
  db.radarFiches = []; db.radarSocietes = {}; db.radarBodacc = {}; db.radarContacts = {};
  writeDb(db);
}, 20 * 1000);
// Toutes les heures : les DPE du mois pour tout Paris (pour « aujourd'hui »).
if (RS) {
  const rafraichir = () => {
    const per = radarPeriode('mois');
    const arrs = RADAR_ARRONDISSEMENTS.filter((a) => !radarCouvert(a, per)); if (arrs.length) radarCharger('auto|recent', arrs, per);
    const zs = RADAR_ZONES_SUP.filter((a) => !radarCouvert(a, per)); if (zs.length) radarCharger('auto|zones|recent', zs, per);
    // Propriétaires des zones ajoutées : on réessaie tant que ce n'est pas fait.
    const manq = RADAR_ZONES_SUP.filter((z) => !pmCommuneIndexee(z.insee)).map((z) => z.insee);
    if (manq.length) pmAjouterCommunes(manq).catch(() => {});
  };
  setTimeout(rafraichir, 90 * 1000);
  setInterval(rafraichir, 3600e3).unref();
}

// ---- Chances de vendre : signaux, chacun expliqué ----
function radarChances(f, acq, nbDpeAdresse) {
  const p = f.proprietaire || {}; const sig = [];
  const add = (pts, txt, type) => sig.push({ pts: pts, txt: txt, type: type || 'plus' });
  const jours = Math.floor((Date.now() - radarAnnee(f.dpeDate)) / 864e5);
  if (jours <= 7) add(20, 'DPE fait il y a ' + (jours <= 1 ? 'moins de 2 jours' : jours + ' jours') + ' : il est obligatoire pour vendre ou louer, le logement est sans doute en train de changer de main.');
  else if (jours <= 31) add(14, 'DPE fait il y a ' + jours + ' jours : obligatoire avant une vente ou une location.');
  else if (jours <= 92) add(10, 'DPE fait il y a ' + Math.round(jours / 30) + ' mois.');
  else add(3, 'DPE fait il y a plus de 3 mois.');
  if (f.dpe === 'G') add(15, 'Classé G : déjà interdit à la location depuis 2025 — beaucoup de propriétaires bailleurs vendent.');
  else if (f.dpe === 'F') add(12, 'Classé F : interdit à la location en 2028 — le propriétaire doit choisir entre travaux et vente.');
  if (nbDpeAdresse >= 3) add(8, nbDpeAdresse + ' DPE dans l’immeuble en un an : l’immeuble bouge (succession, vente à la découpe, ravalement…).');
  else if (nbDpeAdresse === 2) add(4, '2 DPE dans l’immeuble en un an.');
  const an = new Date().getFullYear();
  if (p.statut === 'identifie') {
    if (p.institutionnel) add(-20, 'Propriétaire institutionnel (banque, assureur, bailleur, collectivité) : vend rarement un logement isolé.', 'moins');
    if (p.nbBiens === 1) add(10, (p.estSci ? 'SCI' : 'Société') + ' qui ne possède que ce bien à Paris : une décision de vente dépend d’une ou deux personnes.');
    if (p.immeubleEntier) add(4, 'La société possède tout l’immeuble.');
    if (p.dirigeant && p.dirigeant.age >= 70) add(10, 'Gérant de ' + p.dirigeant.age + ' ans : transmission ou succession à préparer.');
    (p.bodacc || []).forEach((a) => {
      const y = Number(String(a.date || '').slice(0, 4)); const t = radarNorm(a.famille + ' ' + a.type + ' ' + a.detail);
      if (/dissolution|liquidation/.test(t) && y >= an - 2 && !sig.some((x) => x.k === 'diss')) sig.push({ pts: 20, txt: 'Dissolution ou liquidation publiée en ' + y + ' : les biens de la société vont être vendus.', type: 'plus', k: 'diss' });
      else if (/procedure|redressement|sauvegarde/.test(t) && y >= an - 3 && !sig.some((x) => x.k === 'proc')) sig.push({ pts: 15, txt: 'Procédure collective en ' + y + ' : vente d’actifs probable.', type: 'plus', k: 'proc' });
      else if (/dirigeant|gerant|gerance|administration/.test(t) && y >= an - 1 && !sig.some((x) => x.k === 'ger')) sig.push({ pts: 8, txt: 'Changement de gérant publié en ' + y + '.', type: 'plus', k: 'ger' });
    });
  } else if (p.statut === 'non_identifie' || p.statut === 'plusieurs' || p.statut === 'societes_immeuble') {
    add(0, 'Propriétaire particulier probable : à contacter par courrier ou au porte-à-porte.', 'info');
  }
  const permisRecent = (f.permis || []).find((x) => { const dt = Object.keys(x).filter((k) => /date/i.test(k)).map((k) => radarAnnee(x[k])).sort((a, b) => b - a)[0]; return dt && Date.now() - dt < 3 * 365 * 864e5; });
  if (permisRecent) add(6, 'Permis ou déclaration de travaux récent à cette adresse : rénovation ou division, souvent avant une vente.');
  const v = f.ventes && f.ventes.memeLogement && f.ventes.memeLogement[0];
  if (v && v.date) {
    const ans = an - Number(String(v.date).slice(0, 4));
    if (ans >= 10) add(8, 'Acheté en ' + String(v.date).slice(0, 4) + ' (il y a ' + ans + ' ans) : forte plus-value possible.');
    else if (ans <= 2) add(-8, 'Acheté récemment (' + String(v.date).slice(0, 4) + ').', 'moins');
  }
  const nbClients = (acq.club || []).length + (acq.leads || []).length;
  if (nbClients) add(Math.min(12, nbClients * 4), nbClients + ' client' + (nbClients > 1 ? 's' : '') + ' du CRM cherche' + (nbClients > 1 ? 'nt' : '') + ' ce type de bien ici : argument fort pour convaincre le propriétaire.');
  const score = Math.max(0, Math.min(100, sig.reduce((t, x) => t + x.pts, 10)));
  return { score: score, niveau: score >= 60 ? 'forte' : score >= 40 ? 'moyenne' : 'faible', signaux: sig.filter((x) => x.pts !== 0 || x.type === 'info') };
}
function radarCalcul(ctx, f, nbBan) {
  const acq = radarAcquereurs(ctx, f);
  const ch = radarChances(f, acq, nbBan || 1);
  return Object.assign({}, f, { chances: ch, acquereurs: { club: acq.club.length, leads: acq.leads.length, aReconfirmer: acq.club.concat(acq.leads).filter((x) => x.aReconfirmer).length }, _acq: acq });
}
function radarLigne(g) {
  const p = g.proprietaire || {};
  return { id: g.id, dpeDate: g.dpeDate, dpe: g.dpe, adresse: g.adresse, quartier: g.quartier, etage: g.etage, porte: g.porte, type: g.type, surface: g.surface, statut: g.statut, leadId: g.leadId || null,
    proprietaire: { statut: p.statut, nom: p.nom, estSci: p.estSci, institutionnel: p.institutionnel, dirigeant: p.dirigeant ? { prenom: p.dirigeant.prenom, nom: p.dirigeant.nom, age: p.dirigeant.age } : null },
    contact: !!(p.contacts && ((p.contacts.telephones || []).length || (p.contacts.emails || []).length || (p.contacts.linkedin || []).length)),
    chances: { score: g.chances.score, niveau: g.chances.niveau, raison: (g.chances.signaux.filter((x) => x.pts > 0).sort((a, b) => b.pts - a.pts)[0] || {}).txt || '' },
    acquereurs: g.acquereurs };
}

// ============================================================================
// OUTIL SCI — toutes les SCI propriétaires dans les zones suivies, leur
// patrimoine, leurs gérants et les signaux qui annoncent une vente.
// Sources gratuites : fichier DGFiP des locaux des personnes morales,
// Annuaire des entreprises (SIRENE + RNE), BODACC, fichier INSEE des
// personnes décédées (via matchID), DVF (Cerema), DPE (ADEME, via le Radar).
// ============================================================================
const SCI_CACHE = new Map();
function sciInsees(zones) {
  const toutes = radarZones();
  const z = zones && zones.length ? toutes.filter((a) => zones.indexOf(a.quartier) > -1) : toutes;
  return z.map((a) => a.insee);
}
const SCI_SQL_FILTRE = "(s.formeCode LIKE '654%' OR s.forme LIKE 'SCI%' OR s.nom LIKE '% SCI %' OR s.nom LIKE 'SCI %' OR s.nom LIKE '%CIVILE IMMOBILIERE%')";
// DPE récents par société, à partir des fiches du Radar (calculé toutes les 10 min).
let SCI_DPE = { le: 0, par: new Map() };
function sciDpeParSociete() {
  if (!RS || Date.now() - SCI_DPE.le < 10 * 60 * 1000) return SCI_DPE.par;
  const par = new Map();
  try {
    RadarSQL.prepare('SELECT data FROM fiches').all().forEach((r) => {
      let f; try { f = JSON.parse(r.data); } catch (e) { return; }
      const p = f.proprietaire || {};
      if (p.statut !== 'identifie' || !p.siren) return;
      const x = par.get(p.siren) || { n: 0, dernier: '', fiches: [] };
      x.n++; if (String(f.dpeDate || '') > x.dernier) x.dernier = String(f.dpeDate || '');
      if (x.fiches.length < 8) x.fiches.push({ id: f.id, adresse: f.adresse, date: f.dpeDate, dpe: f.dpe, surface: f.surface, etage: f.etage, type: f.type });
      par.set(p.siren, x);
    });
  } catch (e) { /* radar indisponible */ }
  SCI_DPE = { le: Date.now(), par: par };
  return par;
}
// Signaux de vente et score (0-100), expliqués un par un.
function sciSignaux(base, infos, dpe) {
  const sig = [];
  const ajout = (points, code, texte, niveau) => sig.push({ points: points, code: code, texte: texte, niveau: niveau || (points >= 25 ? 'fort' : points >= 12 ? 'moyen' : 'faible') });
  const dir = (infos && infos.dirigeants) || [];
  const decedes = dir.filter((d) => d.deces && d.deces.date);
  if (decedes.length) ajout(40, 'deces', 'Gérant décédé (' + decedes.map((d) => [d.prenom, d.nom].filter(Boolean).join(' ') + ', le ' + String(d.deces.date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1')).join(' ; ') + ') : succession probable.');
  const ages = dir.filter((d) => d.age && !d.deces).map((d) => d.age);
  const ageMax = ages.length ? Math.max.apply(null, ages) : 0;
  if (ageMax >= 80) ajout(25, 'age', 'Gérant de ' + ageMax + ' ans : transmission ou vente à prévoir.');
  else if (ageMax >= 70) ajout(15, 'age', 'Gérant de ' + ageMax + ' ans.');
  if (infos && /cess|ferm|radi/i.test(infos.etat || '')) ajout(30, 'radiee', 'Société cessée ou radiée : les biens doivent sortir.');
  const bod = (infos && infos.bodacc) || [];
  const dissol = bod.find((b) => /dissolution|liquidation|radiation/i.test(b.type + ' ' + b.famille + ' ' + b.detail));
  if (dissol) ajout(35, 'dissolution', 'BODACC ' + (dissol.date || '') + ' : ' + (/(liquidation)/i.test(dissol.detail + dissol.type) ? 'liquidation' : 'dissolution / radiation') + '.');
  const chgt = bod.find((b) => /gérant|gerant|dirigeant|administration/i.test(b.detail) && b.date && Date.now() - new Date(b.date).getTime() < 730 * 864e5);
  if (chgt) ajout(15, 'gerant', 'Changement de gérant récent (BODACC ' + chgt.date + ').');
  const cession = bod.find((b) => /cession de parts|cession des parts/i.test(b.detail) && b.date && Date.now() - new Date(b.date).getTime() < 730 * 864e5);
  if (cession) ajout(15, 'cession', 'Cession de parts récente (BODACC ' + cession.date + ').');
  if (base.adresses === 1) ajout(12, 'mono', 'Une seule adresse au patrimoine : SCI créée pour ce bien, souvent familiale.');
  if (infos && infos.creation) { const ans = new Date().getFullYear() - Number(String(infos.creation).slice(0, 4)); if (ans >= 20) ajout(10, 'ancienne', 'SCI créée il y a ' + ans + ' ans : bien détenu depuis longtemps, forte plus-value.'); }
  if (dpe && dpe.n) {
    const jours = dpe.dernier ? Math.floor((Date.now() - new Date(dpe.dernier).getTime()) / 864e5) : 999;
    if (jours <= 120) ajout(20, 'dpe', dpe.n + ' DPE récent' + (dpe.n > 1 ? 's' : '') + ' sur ses biens (dernier il y a ' + jours + ' jours) : bien en train de changer de main.');
    if (dpe.fiches.some((f) => /^[FG]$/.test(f.dpe || ''))) ajout(10, 'passoire', 'Passoire énergétique (F/G) : location bientôt interdite.');
  }
  if (base.institutionnel) ajout(-30, 'institutionnel', 'Investisseur institutionnel : vend rarement à l’unité.');
  const score = Math.max(0, Math.min(100, sig.reduce((t, x) => t + x.points, 0)));
  return { score: score, niveau: score >= 50 ? 'forte' : score >= 25 ? 'moyenne' : 'faible', signaux: sig.filter((x) => x.points > 0).sort((a, b) => b.points - a.points), negatifs: sig.filter((x) => x.points < 0) };
}
function sciInfosCache(siren) { try { return (readDb().sciInfos || {})[siren] || null; } catch (e) { return null; } }
app.get('/api/sci/liste', requireAdmin, (req, res) => {
  const b = pmBase();
  if (!b) return res.json({ ok: true, disponible: false, total: 0, lignes: [] });
  const zones = String(req.query.zones || '').split(',').filter(Boolean);
  const insees = sciInsees(zones);
  if (!insees.length) return res.json({ ok: true, disponible: true, total: 0, lignes: [] });
  const cle = insees.join(',');
  let base = SCI_CACHE.get(cle);
  if (!base || Date.now() - base.le > 10 * 60 * 1000) {
    const rows = b.b.prepare('SELECT s.siren AS siren, MAX(s.nom) AS nom, MAX(s.forme) AS forme, COUNT(*) AS lots, COUNT(DISTINCT l.insee || \'|\' || l.num || \'|\' || l.voie) AS adresses, GROUP_CONCAT(DISTINCT l.insee) AS insees FROM lot l JOIN soc s ON s.id = l.soc WHERE l.insee IN (' + insees.map(() => '?').join(',') + ') AND ' + SCI_SQL_FILTRE + " AND s.siren <> '' GROUP BY s.siren").all(...insees);
    base = { le: Date.now(), rows: rows.map((r) => Object.assign(r, { nom: pmTexte(r.nom || ''), institutionnel: RADAR_INSTITUTIONNELS.test(pmTexte(r.nom || '').toUpperCase()) })) };
    SCI_CACHE.set(cle, base);
    if (SCI_CACHE.size > 30) SCI_CACHE.delete(SCI_CACHE.keys().next().value);
  }
  const db = readDb(); const infosTout = db.sciInfos || {};
  const suivies = new Set(Object.keys(db.sciSuivies || {}));
  const dpe = sciDpeParSociete();
  const q = radarNorm(req.query.q || '').trim();
  const zLabel = {}; radarZones().forEach((z) => { zLabel[z.insee] = z.label; });
  let liste = base.rows.map((r) => {
    const infos = infosTout[r.siren] || null;
    const d = dpe.get(r.siren) || null;
    const sc = sciSignaux(r, infos, d);
    const dir = infos && infos.dirigeants ? infos.dirigeants.filter((x) => x.nom).map((x) => [x.prenom, x.nom].filter(Boolean).join(' ') + (x.deces ? ' (décédé)' : x.age ? ', ' + x.age + ' ans' : '')) : [];
    return { siren: r.siren, nom: r.nom, lots: r.lots, adresses: r.adresses, communes: String(r.insees || '').split(',').map((i) => zLabel[i] || i), institutionnel: r.institutionnel, analysee: !!infos, dirigeants: dir.slice(0, 2), dpe: d ? d.n : 0, dernierDpe: d ? d.dernier : '', score: sc.score, niveau: sc.niveau, signaux: sc.signaux.slice(0, 3).map((x) => x.code), resume: sc.signaux[0] ? sc.signaux[0].texte : '', suivie: suivies.has(r.siren) };
  });
  if (q) liste = liste.filter((x) => radarNorm(x.nom + ' ' + x.siren + ' ' + x.dirigeants.join(' ')).indexOf(q) > -1);
  if (req.query.horsInstit !== '0') liste = liste.filter((x) => !x.institutionnel);
  if (req.query.mono === '1') liste = liste.filter((x) => x.adresses === 1);
  if (req.query.dpe === '1') liste = liste.filter((x) => x.dpe > 0);
  if (req.query.signal) liste = liste.filter((x) => x.signaux.indexOf(String(req.query.signal)) > -1);
  if (req.query.suivies === '1') liste = liste.filter((x) => x.suivie);
  const tri = String(req.query.tri || 'score');
  liste.sort(tri === 'biens' ? (a, z) => z.lots - a.lots : tri === 'nom' ? (a, z) => a.nom.localeCompare(z.nom) : tri === 'dpe' ? (a, z) => String(z.dernierDpe).localeCompare(String(a.dernierDpe)) : (a, z) => z.score - a.score || z.dpe - a.dpe || a.adresses - z.adresses);
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json({ ok: true, disponible: true, total: liste.length, analysees: liste.filter((x) => x.analysee).length, page: page, lignes: liste.slice((page - 1) * 50, page * 50) });
});
// Décès d'un gérant : fichier INSEE des personnes décédées via matchID (gratuit,
// 1 requête/s). On ne retient qu'une correspondance nom + prénom + mois de naissance.
let MATCHID_DERNIER = 0;
async function sciDeces(d) {
  if (!d || !d.nom || !d.naissance) return null;
  const attente = MATCHID_DERNIER + 1100 - Date.now();
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
  MATCHID_DERNIER = Date.now();
  const an = String(d.naissance).slice(0, 4);
  const p = new URLSearchParams({ lastName: d.nom, firstName: String(d.prenoms || d.prenom || '').split(' ')[0], birthDate: an, size: '10' });
  const r = await fetch('https://deces.matchid.io/deces/api/v1/search?' + p.toString(), { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('matchID ' + r.status);
  const j = await r.json().catch(() => ({}));
  const pers = (j.response && j.response.persons) || j.persons || [];
  const mois = String(d.naissance).replace('-', '').slice(0, 6);
  const nomN = radarNorm(d.nom); const prenomN = radarNorm(String(d.prenoms || d.prenom || '').split(' ')[0]);
  const ok = pers.find((x) => {
    const n = x.name || {}; const last = radarNorm(n.last || ''); const firsts = (Array.isArray(n.first) ? n.first : [n.first]).map(radarNorm);
    const naiss = String((x.birth && x.birth.date) || '');
    return last === nomN && firsts.some((f) => f === prenomN) && (mois.length === 6 ? naiss.slice(0, 6) === mois : naiss.slice(0, 4) === an);
  });
  return ok ? { date: String((ok.death && ok.death.date) || ''), lieu: ((ok.death && ok.death.location) || {}).city || '' } : { aucun: true };
}
// Autres sociétés d'un gérant (Annuaire des entreprises, recherche par personne).
async function sciAutresSocietes(d, siren) {
  if (!d || !d.nom) return [];
  const p = new URLSearchParams({ nom_personne: d.nom, prenoms_personne: String(d.prenoms || d.prenom || '').split(' ')[0], per_page: '25' });
  if (d.naissance) { const a = String(d.naissance).slice(0, 7); p.set('date_naissance_personne_min', a + '-01'); p.set('date_naissance_personne_max', a + '-28'); }
  const r = await sireneFetch('https://recherche-entreprises.api.gouv.fr/search?' + p.toString());
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.results || []).filter((e) => String(e.siren) !== siren).map((e) => ({ siren: String(e.siren), nom: e.nom_complet || '', etat: e.etat_administratif || '', creation: e.date_creation || '', sci: /^654/.test(String(e.nature_juridique || '')) || /\bSCI\b/i.test(e.nom_complet || ''), biensDgfip: radarBiensSociete(String(e.siren)).length })).slice(0, 25);
}
// Analyse complète d'une SCI (mise en cache 30 jours dans la base).
async function sciAnalyser(siren, forcer) {
  const db0 = readDb();
  const c = (db0.sciInfos || {})[siren];
  if (c && !forcer && Date.now() - radarAnnee(c.maj) < 30 * 864e5) return c;
  const out = { maj: nowISO(), siren: siren, erreurs: [] };
  try {
    const r = await sireneFetch('https://recherche-entreprises.api.gouv.fr/search?q=' + siren + '&per_page=1');
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    const e = (j.results || []).find((x) => String(x.siren) === siren);
    const an = new Date().getFullYear();
    if (e) {
      Object.assign(out, { nom: e.nom_complet || '', creation: e.date_creation || '', etat: e.etat_administratif === 'C' ? 'cessée' : e.etat_administratif === 'A' ? 'active' : (e.etat_administratif || ''), natureJuridique: e.nature_juridique || '', siege: e.siege ? (e.siege.adresse || '') : '', siegeCommune: e.siege ? (e.siege.libelle_commune || '') : '', dateFermeture: e.date_fermeture || '' });
      out.dirigeants = (e.dirigeants || []).slice(0, 6).map((x) => x.type_dirigeant === 'personne morale'
        ? { societe: x.denomination || '', siren: x.siren || '', qualite: x.qualite || '' }
        : { prenom: String(x.prenoms || '').split(' ')[0], prenoms: x.prenoms || '', nom: x.nom || '', qualite: x.qualite || '', naissance: x.date_de_naissance || (x.annee_de_naissance ? String(x.annee_de_naissance) : ''), age: x.annee_de_naissance ? an - Number(String(x.annee_de_naissance).slice(0, 4)) : (x.date_de_naissance ? an - Number(String(x.date_de_naissance).slice(0, 4)) : null) });
    } else out.erreurs.push('Société introuvable dans l’Annuaire des entreprises.');
  } catch (e) { out.erreurs.push('Annuaire des entreprises : ' + e.message); }
  const pers = (out.dirigeants || []).filter((d) => d.nom);
  for (const d of pers.slice(0, 3)) {
    try { const dc = await sciDeces(d); if (dc && dc.date) d.deces = dc; else if (dc) d.decesVerifie = true; } catch (e) { out.erreurs.push('Fichier des décès : ' + e.message); break; }
    try { d.autresSocietes = await sciAutresSocietes(d, siren); } catch (e) { /* facultatif */ }
  }
  try { const bo = await radarBodacc(db0, siren); out.bodacc = (bo.annonces || []).slice(0, 15); } catch (e) { out.erreurs.push('BODACC : ' + e.message); }
  const db = readDb();
  db.sciInfos = db.sciInfos || {};
  db.sciInfos[siren] = out;
  // Garde-fou disque : on ne garde que les 3 000 dernières analyses.
  const cles = Object.keys(db.sciInfos);
  if (cles.length > 3000) cles.sort((a, z) => radarAnnee(db.sciInfos[a].maj) - radarAnnee(db.sciInfos[z].maj)).slice(0, cles.length - 3000).forEach((k) => delete db.sciInfos[k]);
  writeDb(db);
  return out;
}
// Achats DVF des biens de la SCI : parcelle du lot (section + plan) → ventes de la parcelle.
async function sciAchatsDvf(biensAdresses, siren) {
  const lots = pmLignesSiren(siren).map(pmLotDepuisLigne);
  const parcelles = {};
  lots.forEach((l) => { if (l.section && l.plan) { const idu = l.insee + '000' + String(l.section).padStart(2, '0') + String(l.plan).padStart(4, '0'); parcelles[idu] = parcelles[idu] || { idu: idu, insee: l.insee, adresse: l.adresse }; } });
  const out = [];
  for (const p of Object.values(parcelles).slice(0, 6)) {
    try {
      const g = await geocoderNumero({ adresse: p.adresse.replace(/^(\d+)\s+(B|T|Q)\s/, '$1 '), codePostal: '', ville: (radarZones().find((z) => z.insee === p.insee) || {}).label || '' });
      if (!g) continue;
      const d = 0.0015;
      const muts = await dvfCerema({ code_insee: p.insee, in_bbox: [g.lon - d, g.lat - d, g.lon + d, g.lat + d].map((v) => v.toFixed(6)).join(',') }, 3, { geo: true, budgetMs: 15000 });
      muts.filter((x) => (x.l_idpar || []).some((i) => String(i) === p.idu) && /vente/i.test(x.libnatmut || '')).forEach((x) => out.push({ adresse: p.adresse, date: x.datemut, prix: Math.round(Number(x.valeurfonc) || 0), surface: Number(x.sbati) || null, type: String(x.libtypbien || '').toLowerCase() }));
    } catch (e) { /* parcelle suivante */ }
  }
  return out.sort((a, z) => String(z.date).localeCompare(String(a.date))).slice(0, 20);
}
app.get('/api/sci/:siren', requireAdmin, async (req, res) => {
  const siren = String(req.params.siren || '').replace(/\s/g, '');
  if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN à 9 chiffres.' });
  try {
    const infos = req.query.analyser === '1' ? await ARRIERE_PLAN.run({ fond: false }, () => sciAnalyser(siren, req.query.forcer === '1')) : sciInfosCache(siren);
    const biens = radarBiensSociete(siren);
    const zl = {}; radarZones().forEach((z) => { zl[z.insee] = z.label; });
    const meta = pmMeta() || {};
    const lignes = pmLignesSiren(siren);
    const nomPm = lignes[0] ? pmTexte(lignes[0][PMC.nom] || '') : '';
    const base = { adresses: biens.length, institutionnel: RADAR_INSTITUTIONNELS.test(String(nomPm || (infos && infos.nom) || '').toUpperCase()) };
    const dpe = sciDpeParSociete().get(siren) || null;
    const sc = sciSignaux(base, infos, dpe);
    const db = readDb();
    const leads = (db.leads || []).filter((l) => String(l.siren || '') === siren).map((l) => ({ id: l.id, nom: nomComplet(l) || l.raisonSociale || '' }));
    res.json({ ok: true, siren: siren, nom: (infos && infos.nom) || nomPm, forme: lignes[0] ? lignes[0][PMC.forme] : '', infos: infos, score: sc, dpe: dpe,
      biens: biens.map((x) => Object.assign({}, x, { commune: zl[x.insee] || (meta.communes || {})[x.insee] || x.insee })),
      achats: infos && infos.achats ? infos.achats : null, leads: leads, suivie: !!(db.sciSuivies || {})[siren] });
  } catch (e) { res.status(502).json({ error: 'Analyse impossible : ' + e.message }); }
});
app.post('/api/sci/:siren/achats', requireAdmin, async (req, res) => {
  const siren = String(req.params.siren || '');
  if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN à 9 chiffres.' });
  try {
    const achats = await sciAchatsDvf(radarBiensSociete(siren), siren);
    const db = readDb(); db.sciInfos = db.sciInfos || {}; db.sciInfos[siren] = Object.assign(db.sciInfos[siren] || { maj: nowISO(), siren: siren }, { achats: achats, achatsMaj: nowISO() }); writeDb(db);
    res.json({ ok: true, achats: achats });
  } catch (e) { res.status(502).json({ error: 'DVF : ' + e.message }); }
});
// Créer le lead vendeur de la SCI (sans coordonnées : pas de message possible).
app.post('/api/sci/:siren/lead', requireAdmin, (req, res) => {
  const siren = String(req.params.siren || '');
  if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN à 9 chiffres.' });
  const db = readDb();
  const deja = (db.leads || []).find((l) => String(l.siren || '') === siren);
  if (deja) return res.json({ ok: true, lead: { id: deja.id }, deja: true });
  const infos = (db.sciInfos || {})[siren] || {};
  const lignes = pmLignesSiren(siren);
  const nom = infos.nom || (lignes[0] ? pmTexte(lignes[0][PMC.nom] || '') : 'SCI ' + siren);
  const g = (infos.dirigeants || []).find((d) => d.nom && !d.deces) || (infos.dirigeants || []).find((d) => d.nom) || null;
  const biens = radarBiensSociete(siren);
  const lead = {
    id: uid('l'), prenom: g ? g.prenom || '' : '', nom: g ? g.nom || '' : nom, email: '', tel: '', civilite: '',
    projet: 'vendeur', role: 'membre', type: 'sci', natureLead: 'sci', raisonSociale: nom, siren: siren, representant: g ? [g.prenom, g.nom].filter(Boolean).join(' ') + (g.qualite ? ' (' + g.qualite + ')' : '') : '',
    adresse: infos.siege || '', adresseBien: biens[0] ? biens[0].adresse : '', dirigeants: infos.dirigeants || [],
    source: 'Outil SCI', statut: 'prospect', pipeline: 'a_contacter', bienAVendre: true, quartiers: [], budgetMin: 0, budgetMax: 0,
    notes: 'Patrimoine (fichier DGFiP) : ' + biens.slice(0, 10).map((b) => b.adresse + ' (' + b.lots + ' lot' + (b.lots > 1 ? 's' : '') + ')').join(' ; '),
    tags: ['SCI'], creePar: req.lead.id, agentId: estAgentSimple(roleOf(req.lead)) ? req.lead.id : null, cree: nowISO()
  };
  db.leads.push(lead);
  logActivite(db, { leadId: lead.id, type: 'lead_sci', auteur: nomComplet(req.lead), detail: 'Lead créé depuis l’outil SCI (' + nom + ')' });
  writeDb(db);
  res.json({ ok: true, lead: { id: lead.id } });
});
// Suivre une SCI : alerte quand un DPE, une annonce BODACC ou un décès apparaît.
app.post('/api/sci/:siren/suivre', requireAdmin, (req, res) => {
  const siren = String(req.params.siren || '');
  if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN à 9 chiffres.' });
  const db = readDb(); db.sciSuivies = db.sciSuivies || {};
  if (req.body && req.body.suivre === false) delete db.sciSuivies[siren];
  else db.sciSuivies[siren] = db.sciSuivies[siren] || { depuis: nowISO(), par: nomComplet(req.lead), vu: { dpe: (sciDpeParSociete().get(siren) || {}).n || 0, bodacc: (((db.sciInfos || {})[siren] || {}).bodacc || []).length } };
  writeDb(db);
  res.json({ ok: true, suivie: !!db.sciSuivies[siren] });
});
// Une fois par jour : les SCI suivies sont réanalysées ; nouveauté = alerte (activité).
setInterval(() => {
  try {
    const db = readDb(); const suivies = Object.keys(db.sciSuivies || {});
    if (!suivies.length) return;
    const jour = new Date().toISOString().slice(0, 10);
    if (db.sciSuiviJour === jour) return;
    db.sciSuiviJour = jour; writeDb(db);
    ARRIERE_PLAN.run({ fond: true }, async () => {
      for (const siren of suivies.slice(0, 200)) {
        try {
          const infos = await sciAnalyser(siren, true);
          const d2 = readDb(); const s0 = (d2.sciSuivies || {})[siren]; if (!s0) continue;
          const nDpe = (sciDpeParSociete().get(siren) || {}).n || 0; const nBod = (infos.bodacc || []).length; const deces = (infos.dirigeants || []).some((x) => x.deces);
          const nouveau = [];
          if (nDpe > (s0.vu.dpe || 0)) nouveau.push((nDpe - (s0.vu.dpe || 0)) + ' nouveau(x) DPE');
          if (nBod > (s0.vu.bodacc || 0)) nouveau.push('nouvelle annonce BODACC');
          if (deces && !s0.vu.deces) nouveau.push('gérant décédé');
          if (nouveau.length) {
            const lead = (d2.leads || []).find((l) => String(l.siren || '') === siren);
            logActivite(d2, { leadId: lead ? lead.id : null, type: 'alerte_sci', auteur: 'Outil SCI', detail: (infos.nom || siren) + ' : ' + nouveau.join(', ') });
          }
          s0.vu = { dpe: nDpe, bodacc: nBod, deces: deces }; s0.verifieLe = nowISO();
          writeDb(d2);
        } catch (e) { /* SCI suivante */ }
      }
    });
  } catch (e) { /* prochain tour */ }
}, 3600 * 1000).unref();

// ---- Zones du Radar ajoutées par code postal ----
function pmCommuneIndexee(insee) {
  const m = pmMeta();
  if (!m) return false;
  return PM_DEPTS.indexOf(String(insee).slice(0, 2)) > -1 || !!(m.communes && m.communes[insee]);
}
const PM_AJOUT = { enCours: false, etape: '', erreur: '' };
// Ajoute au fichier propriétaires (DGFiP) les locaux des sociétés de quelques
// communes, sans tout réimporter : le zip national est lu dans le dossier
// temporaire du conteneur, seules les lignes de ces communes sont ajoutées.
async function pmAjouterCommunes(insees) {
  if (PM_AJOUT.enCours || PM_IMPORT.enCours) return;
  const meta = pmMeta();
  if (!meta) return; // pas encore de fichier : l'import complet inclura ces communes
  const aFaire = insees.filter((i) => !pmCommuneIndexee(i));
  if (!aFaire.length) return;
  Object.assign(PM_AJOUT, { enCours: true, etape: 'Recherche du fichier DGFiP…', erreur: '' });
  let base = null;
  const tmpZip = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pm-aj-'));
  try {
    const libre = placeLibreMo();
    if (libre !== null && libre < 40) throw new Error('disque presque plein (' + libre + ' Mo libres)');
    const { fichiers } = await pmTrouverFichiers();
    pmFermerBase();
    const Database = require('better-sqlite3');
    base = new Database(path.join(PM_DIR, 'pm.db'));
    const socId = base.prepare('SELECT id FROM soc WHERE siren = ? AND nom = ? AND forme = ? LIMIT 1');
    const voieId = base.prepare('SELECT id FROM voie WHERE nature = ? AND nom = ? LIMIT 1');
    const insSoc = base.prepare('INSERT INTO soc (siren, nom, forme, groupe, formeCode) VALUES (?, ?, ?, ?, ?)');
    const insVoie = base.prepare('INSERT INTO voie (nature, nom) VALUES (?, ?)');
    const insLot = base.prepare('INSERT INTO lot VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const viser = new Set(aFaire);
    const communes = {};
    let lignes = [];
    const vider = base.transaction((l) => l.forEach((c) => {
      const insee = c[0].trim() + String(c[2].trim()).padStart(3, '0');
      // Mêmes colonnes que l'import complet (voir PMC) : société c19/c23/c22,
      // groupe c20, forme juridique c21, droit c17, bâtiment c7, entrée c8,
      // niveau c9, porte c10, numéro c11, indice c12, voie c15/c16, section c5, plan c6.
      const siren = c[19].trim(); const nom = c[23].trim(); const forme = c[22].trim();
      const s1 = socId.get(siren, nom, forme); const idS = s1 ? s1.id : insSoc.run(siren, nom, forme, c[20].trim(), c[21].trim()).lastInsertRowid;
      const v1 = voieId.get(c[15].trim(), c[16].trim()); const idV = v1 ? v1.id : insVoie.run(c[15].trim(), c[16].trim()).lastInsertRowid;
      insLot.run(insee, String(parseInt(c[11], 10) || c[11].trim()), c[12].trim(), idV, idS, c[17].trim(), c[7].trim(), c[8].trim(), c[9].trim(), c[10].trim(), c[5].trim(), c[6].trim());
      communes[insee] = c[3].trim();
    }));
    let n = 0;
    for (const f of fichiers) {
      const zipLocal = path.join(tmpZip, 'source.zip');
      PM_AJOUT.etape = 'Téléchargement du fichier DGFiP…';
      await pmTelecharger(f.url, zipLocal);
      PM_AJOUT.etape = 'Lecture des locaux des sociétés (' + aFaire.join(', ') + ')…';
      await pmLireZip(zipLocal, (ligne) => {
        const c = ligne.split(';');
        if (c.length < 24) return;
        const insee = c[0].trim() + String(c[2].trim()).padStart(3, '0');
        if (!viser.has(insee)) return;
        lignes.push(c); n++;
        if (lignes.length >= 2000) { vider(lignes); lignes = []; }
      }, tmpZip);
      try { fs.unlinkSync(zipLocal); } catch (e) { /* rien */ }
    }
    if (lignes.length) vider(lignes);
    base.close(); base = null;
    const m = pmMeta() || {};
    m.communes = Object.assign({}, m.communes || {}, communes);
    aFaire.forEach((i) => { if (!m.communes[i]) m.communes[i] = '(aucune société)'; });
    m.communesSup = Array.from(new Set((m.communesSup || []).concat(aFaire)));
    fs.writeFileSync(path.join(PM_DIR, 'meta.json'), JSON.stringify(m, null, 1));
    pmFermerBase(); PM_CACHE.clear();
    Object.assign(PM_AJOUT, { enCours: false, etape: n + ' locaux de sociétés ajoutés pour ' + aFaire.join(', ') });
    console.log('[pm-locaux] ' + PM_AJOUT.etape);
    setTimeout(() => { radarReidentifier().catch((e) => console.error('[radar] ré-identification :', e.message)); }, 1000);
  } catch (e) {
    try { if (base) base.close(); } catch (x) { /* rien */ }
    Object.assign(PM_AJOUT, { enCours: false, erreur: String(e.message || e), etape: 'Échec' });
    console.error('[pm-locaux] ajout de communes :', e.message || e);
  } finally { fs.rmSync(tmpZip, { recursive: true, force: true }); }
}
app.get('/api/radar/zones', requireAdmin, (req, res) => {
  res.json({ ok: true, zones: RADAR_ZONES_SUP, proprietaires: PM_AJOUT });
});
app.post('/api/radar/zones', requireAdmin, async (req, res) => {
  const cp = String((req.body && req.body.cp) || '').trim();
  if (!/^\d{5}$/.test(cp)) return res.status(400).json({ error: 'Code postal à 5 chiffres.' });
  if (/^75\d{3}$/.test(cp)) return res.status(400).json({ error: 'Paris est déjà couvert par le Radar.' });
  let communes = [];
  try {
    const r = await fetch('https://geo.api.gouv.fr/communes?codePostal=' + cp + '&fields=nom,code&format=json', { signal: AbortSignal.timeout(10000) });
    communes = (await r.json().catch(() => [])) || [];
  } catch (e) { return res.status(502).json({ error: 'Service des communes injoignable, réessayez.' }); }
  if (!communes.length) return res.status(404).json({ error: 'Aucune commune pour le code postal ' + cp + '.' });
  const db = readDb();
  db.radarZones = db.radarZones || [];
  const ajoutees = [];
  communes.forEach((c) => {
    const quartier = 'c' + c.code;
    if (db.radarZones.some((z) => z.quartier === quartier)) return;
    const z = { quartier: quartier, cp: cp, insee: c.code, label: c.nom + (communes.length > 1 ? ' (' + cp + ')' : ''), plusieursCommunes: communes.length > 1, ajouteLe: nowISO(), ajoutePar: nomComplet(req.lead) };
    db.radarZones.push(z); ajoutees.push(z);
  });
  writeDb(db);
  radarZonesCharger();
  if (ajoutees.length) {
    // DPE récents de la zone tout de suite, et propriétaires sociétés en tâche de fond.
    if (RS) { const per = radarPeriode('mois'); radarCharger('zone|' + cp, ajoutees, per); }
    setTimeout(() => pmAjouterCommunes(ajoutees.map((z) => z.insee)).catch(() => {}), 500);
  }
  res.json({ ok: true, ajoutees: ajoutees, zones: RADAR_ZONES_SUP });
});
app.delete('/api/radar/zones/:quartier', requireAdmin, (req, res) => {
  // Retire la zone de la liste des secteurs ; les fiches déjà trouvées restent.
  const db = readDb();
  const avant = (db.radarZones || []).length;
  db.radarZones = (db.radarZones || []).filter((z) => z.quartier !== req.params.quartier);
  if (db.radarZones.length === avant) return res.status(404).json({ error: 'Zone introuvable' });
  writeDb(db);
  radarZonesCharger();
  res.json({ ok: true, zones: RADAR_ZONES_SUP });
});
setTimeout(radarZonesCharger, 0);
setTimeout(() => {
  try {
    const m = pmMeta();
    if (!m) return;
    // Communes ajoutées avec des colonnes décalées (1re version) : on retire leurs
    // lots et on les réindexe correctement.
    if (!m.correctionColonnesSup && (m.communesSup || []).length) {
      const Database = require('better-sqlite3');
      pmFermerBase();
      const b = new Database(path.join(PM_DIR, 'pm.db'));
      const ins = m.communesSup.filter((x) => PM_DEPTS.indexOf(String(x).slice(0, 2)) === -1);
      if (ins.length) {
        b.prepare('DELETE FROM lot WHERE insee IN (' + ins.map(() => '?').join(',') + ')').run(...ins);
        b.exec('DELETE FROM soc WHERE id NOT IN (SELECT DISTINCT soc FROM lot); DELETE FROM voie WHERE id NOT IN (SELECT DISTINCT voie FROM lot);');
        ins.forEach((k) => { if (m.communes) delete m.communes[k]; });
      }
      b.close();
      m.communesSup = (m.communesSup || []).filter((k) => ins.indexOf(k) === -1);
      m.correctionColonnesSup = nowISO();
      fs.writeFileSync(path.join(PM_DIR, 'meta.json'), JSON.stringify(m, null, 1));
      pmFermerBase(); PM_CACHE.clear();
      console.log('[pm-locaux] ' + ins.length + ' commune(s) à réindexer (colonnes décalées)');
    }
    if (m.correctionCommunesSup) return;
    let n = 0;
    Object.keys(m.communes || {}).forEach((k) => { if (m.communes[k] === '(aucune société)') { delete m.communes[k]; n++; } });
    m.communesSup = (m.communesSup || []).filter((k) => m.communes && m.communes[k]);
    m.correctionCommunesSup = nowISO();
    fs.writeFileSync(path.join(PM_DIR, 'meta.json'), JSON.stringify(m, null, 1));
    pmFermerBase(); PM_CACHE.clear();
    if (n) console.log('[pm-locaux] ' + n + ' commune(s) à réindexer (département sauté par erreur)');
  } catch (e) { console.error('[pm-locaux] correction communes', e.message); }
}, 3000);

// Liste : période + filtres ; charge les DPE manquants en tâche de fond.
app.get('/api/radar/liste', requireAdmin, (req, res) => {
  if (!RS) return res.status(503).json({ error: 'Base du Radar indisponible sur ce serveur.' });
  const per = radarPeriode(String(req.query.periode || 'mois'));
  const Q = req.query;
  const secteurs = String(Q.secteurs || Q.secteur || '').split(',').filter((q) => radarZones().some((a) => a.quartier === q));
  const secteur = secteurs.length === 1 ? secteurs[0] : '';
  const type = Q.type === 'Maison' || Q.type === 'Appartement' ? String(Q.type) : '';
  const smin = Math.max(0, Number(Q.surfaceMin) || 0);
  const arrs = radarZones().filter((a) => !secteurs.length || secteurs.indexOf(a.quartier) > -1);
  const manquants = arrs.filter((a) => !radarCouvert(a, per));
  const cleCharg = (secteurs.length ? secteurs.join('+') : 'paris') + '|' + (per.recent ? 'recent' : per.annee || per.de);
  if (manquants.length) {
    // Communes ajoutées chargées à part (marge disque réduite, voir radarCharger).
    const mP = manquants.filter((a) => /^p\d+$/.test(a.quartier)); const mZ = manquants.filter((a) => !/^p\d+$/.test(a.quartier));
    if (mP.length) radarCharger(cleCharg, mP, per);
    if (mZ.length) radarCharger(cleCharg + '|zones', mZ, per);
  }
  const db = readDb();
  const ctx = radarContexte(db);
  let rows = RS.liste.all({ de: per.de, a: per.a + 'z', q: secteur, t: type, smin: smin }).map(rsLire).filter(Boolean);
  // Critères avancés (appliqués sur les fiches chargées).
  const nombre = (v) => (v === undefined || v === '' ? null : Number(v));
  const smax = nombre(Q.surfaceMax), emin = nombre(Q.etageMin), emax = nombre(Q.etageMax), pmin = nombre(Q.prixMin), pmax = nombre(Q.prixMax);
  const classes = String(Q.classes || '').toUpperCase().replace(/[^A-G]/g, '');
  const anneeDe = (f) => { const a = Number(f.annee); if (a > 1000) return a; const m = /(\d{4})/.exec(String(f.periode || '')); return m ? Number(m[1]) : null; };
  const epoques = { avant1948: [0, 1947], '1948-1974': [1948, 1974], '1975-2000': [1975, 2000], apres2000: [2001, 3000] };
  const prixCache = {};
  const prixDe = (f) => { const k = f.insee + '|' + f.type; if (!(k in prixCache)) prixCache[k] = cacheLu('prix', k); const px = prixCache[k]; return px && px.m2 && f.surface ? f.surface * px.m2 : null; };
  rows = rows.filter((f) => {
    if (secteurs.length > 1 && secteurs.indexOf(f.quartier) === -1) return false;
    if (smax && f.surface > smax) return false;
    if (emin !== null && (f.etage == null || f.etage < emin)) return false;
    if (emax !== null && (f.etage == null || f.etage > emax)) return false;
    if (Q.dernierEtage === '1' && !(f.etage != null && f.niveauxImmeuble && f.etage >= f.niveauxImmeuble - 1)) return false;
    if (classes && classes.indexOf(f.dpe) === -1) return false;
    if (Q.epoque && epoques[Q.epoque]) { const a = anneeDe(f); if (!a || a < epoques[Q.epoque][0] || a > epoques[Q.epoque][1]) return false; }
    if (pmin !== null || pmax !== null) { const v = prixDe(f); if (!v) return false; if (pmin !== null && v < pmin) return false; if (pmax !== null && v > pmax) return false; }
    return true;
  });
  // DPE par immeuble sur un an (« immeuble en mouvement »).
  const parBan = {};
  rows.forEach((f) => { if (f.identifiantBan) parBan[f.identifiantBan] = (parBan[f.identifiantBan] || 0) + 1; });
  let liste = rows.map((f) => radarCalcul(ctx, f, parBan[f.identifiantBan]));
  // Le chiffre du jour : DPE de la semaine qui correspondent à un client.
  const semaine = radarPeriode('semaine').de; const hier = radarPeriode('aujourdhui').de;
  const avecClient = (g) => g.acquereurs.club + g.acquereurs.leads > 0;
  const recents = RS.liste.all({ de: semaine, a: per.a + 'z', q: '', t: '', smin: 0 }).map(rsLire).filter(Boolean).map((f) => radarCalcul(ctx, f, 1));
  const une = { jour: recents.filter((g) => String(g.dpeDate) >= hier && avecClient(g)).length, semaine: recents.filter(avecClient).length, semaineTotal: recents.length, derniere: radarDernierePublication() };
  if (Q.client === '1') liste = liste.filter(avecClient);
  if (Q.client === 'club') liste = liste.filter((g) => g.acquereurs.club > 0);
  if (Q.client === 'leads') liste = liste.filter((g) => g.acquereurs.leads > 0);
  const pr = (g) => g.proprietaire || {};
  if (Q.proprio === 'societe') liste = liste.filter((g) => pr(g).statut === 'identifie');
  if (Q.proprio === 'sci') liste = liste.filter((g) => pr(g).statut === 'identifie' && pr(g).estSci);
  if (Q.proprio === 'hors-institutionnel') liste = liste.filter((g) => pr(g).statut === 'identifie' && !pr(g).institutionnel);
  if (Q.proprio === 'particulier') liste = liste.filter((g) => pr(g).statut !== 'identifie');
  if (Q.contact === '1') liste = liste.filter((g) => { const c = pr(g).contacts || {}; return (c.telephones || []).length || (c.emails || []).length || (c.linkedin || []).length; });
  if (Q.niveau === 'forte') liste = liste.filter((g) => g.chances.niveau === 'forte');
  if (Q.niveau === 'moyenne') liste = liste.filter((g) => g.chances.niveau !== 'faible');
  const signaux = { 'sci-un-bien': /ne possède que ce bien/, 'gerant-age': /Gérant de \d+ ans/, passoire: /Classé [FG]/, mouvement: /DPE dans l’immeuble/, gerance: /Changement de gérant/, dissolution: /Dissolution|Procédure collective/, longtemps: /il y a \d+ ans\) : forte plus-value/ };
  if (signaux[Q.signal]) liste = liste.filter((g) => g.chances.signaux.some((x) => signaux[Q.signal].test(x.txt)));
  if (/^\d{9}$/.test(String(Q.siren || ''))) liste = liste.filter((g) => pr(g).siren === Q.siren);
  if (Q.statut === 'prospect') liste = liste.filter((g) => g.leadId);
  else if (['a_revoir', 'en_cours', 'contacte', 'ecarte'].indexOf(Q.statut) > -1) liste = liste.filter((g) => (g.statut || 'a_revoir') === Q.statut);
  else liste = liste.filter((g) => g.statut !== 'ecarte');
  const tri = String(req.query.tri || 'chances');
  const d = (g) => radarAnnee(g.dpeDate);
  const nbCli = (g) => g.acquereurs.club * 2 + g.acquereurs.leads;
  liste.sort(tri === 'ancien' ? (a, b) => d(a) - d(b) : tri === 'recent' ? (a, b) => d(b) - d(a) : tri === 'surface' ? (a, b) => b.surface - a.surface : tri === 'clients' ? (a, b) => nbCli(b) - nbCli(a) || b.chances.score - a.chances.score : (a, b) => b.chances.score - a.chances.score || d(b) - d(a));
  const page = Math.max(1, Number(req.query.page) || 1);
  const jobP = RADAR_CHARGEMENTS[cleCharg] || null; const jobZ = RADAR_CHARGEMENTS[cleCharg + '|zones'] || null;
  const job = jobP || jobZ ? { enCours: !!((jobP && jobP.enCours) || (jobZ && jobZ.enCours)), faits: ((jobP || {}).faits || 0) + ((jobZ || {}).faits || 0), total: ((jobP || {}).total || 0) + ((jobZ || {}).total || 0), lus: ((jobP || {}).lus || 0) + ((jobZ || {}).lus || 0), erreurs: ((jobP || {}).erreurs || []).concat((jobZ || {}).erreurs || []) } : null;
  // Vues d'ensemble (sur la sélection) : secteurs, portefeuilles des sociétés, carte.
  const vues = page > 1 ? null : (() => {
    const secteursV = radarZones().map((a) => {
      const l = liste.filter((g) => g.quartier === a.quartier);
      return { quartier: a.quartier, label: a.label, dpe: l.length, identifies: l.filter((g) => pr(g).statut === 'identifie').length, fortes: l.filter((g) => g.chances.niveau === 'forte').length, clients: ctx.clients.filter((x) => x.c.quartiers.indexOf(a.quartier) > -1).length };
    }).filter((x) => x.dpe || x.clients).sort((a, b) => (b.fortes * 3 + b.dpe + b.clients * 5) - (a.fortes * 3 + a.dpe + a.clients * 5));
    const parSoc = {};
    liste.forEach((g) => { const p = pr(g); if (p.statut !== 'identifie' || !p.siren) return; const x = parSoc[p.siren] = parSoc[p.siren] || { siren: p.siren, nom: p.nom, estSci: p.estSci, institutionnel: p.institutionnel, nbBiens: p.nbBiens || 0, dirigeant: p.dirigeant ? ((p.dirigeant.prenom || '') + ' ' + (p.dirigeant.nom || '')).trim() + (p.dirigeant.age ? ', ' + p.dirigeant.age + ' ans' : '') : '', dpe: 0, fiches: [], meilleur: 0 }; x.dpe++; if (x.fiches.length < 6) x.fiches.push({ id: g.id, adresse: g.adresse, etage: g.etage, surface: g.surface }); x.meilleur = Math.max(x.meilleur, g.chances.score); });
    const portefeuilles = Object.values(parSoc).sort((a, b) => b.dpe - a.dpe || b.meilleur - a.meilleur).slice(0, 60);
    const carte = liste.filter((g) => g.lat && g.lon).slice(0, 1500).map((g) => ({ id: g.id, lat: g.lat, lon: g.lon, n: g.chances.niveau, s: g.chances.score, t: g.type + ' · ' + g.surface + ' m² · ' + (g.etage == null ? '' : g.etage === 0 ? 'RDC' : g.etage + 'e') + ' · DPE ' + (g.dpe || '?'), a: g.adresse, p: pr(g).statut === 'identifie' ? pr(g).nom : '' }));
    return { secteurs: secteursV, portefeuilles: portefeuilles, carte: carte };
  })();
  res.json({ ok: true, zones: RADAR_ZONES_SUP.map((z) => ({ quartier: z.quartier, label: z.label, cp: z.cp })), pmCommunes: RADAR_ZONES_SUP.map((z) => ({ quartier: z.quartier, proprietaires: pmCommuneIndexee(z.insee) })), pmAjout: { enCours: PM_AJOUT.enCours, etape: PM_AJOUT.etape, erreur: PM_AJOUT.erreur }, periode: per, total: liste.length, page: page, lignes: liste.slice((page - 1) * 50, page * 50).map(radarLigne), une: une, vues: vues,
    chargement: job && job.enCours ? { faits: job.faits, total: job.total, lus: job.lus } : null, erreurs: job ? job.erreurs.slice(0, 3) : [],
    proprietaires: { disponible: !!pmMeta(), millesime: (pmMeta() || {}).annee || null, import: PM_IMPORT }, exa: !!process.env.EXA_API_KEY,
    plafond: rows.length >= 20000 });
});

// ---- Briques d'Immo Data Robot branchées sur la fiche ----
// Permis de construire de l'arrondissement (AuCadastre), gardés 7 jours ; on ne garde que l'utile.
async function radarPermisCommune(insee) {
  const r0 = RS.cacheGet.get('permis', insee);
  if (r0 && Date.now() - radarAnnee(r0.maj) < 7 * 864e5) { try { return JSON.parse(r0.data); } catch (e) { /* recharge */ } }
  const all = [];
  let url = AUCADASTRE_URL + '/commune/' + insee + '/permits?limit=1000&offset=0';
  for (let i = 0; i < 30 && url; i++) {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) break;
    const d = await r.json().catch(() => ({}));
    (d.permits || []).forEach((p) => {
      const o = {};
      Object.keys(p).forEach((k) => { if (/address|adresse|applicant|demandeur|date|type|nature|kind|status|statut|description|surface|logement|housing|nb_|number|reference|id$/i.test(k) && p[k] != null && typeof p[k] !== 'object') o[k] = p[k]; });
      all.push(o);
    });
    const pg = d.page || {};
    url = pg.more && pg.next ? pg.next : null;
  }
  RS.cacheSet.run('permis', insee, nowISO(), JSON.stringify(all));
  return all;
}
function radarPermisAdresse(liste, f) {
  const q = pmParserAdresse(f.adresse + ' ' + f.cp);
  if (f.insee) q.insee = f.insee;
  const siren = f.proprietaire && f.proprietaire.siren;
  return (liste || []).filter((p) => {
    if (siren && String(p.applicant_siren || '') === siren) return true;
    const a = pmParserAdresse(String(p.works_address || p.address || p.adresse || ''));
    return a.numero && a.numero === q.numero && pmScoreVoie(q.mots, a.mots) >= 2;
  }).slice(0, 15);
}
// Parcelle cadastrale du point GPS (IGN), puis toutes les ventes DVF de la parcelle.
async function radarParcelle(f, opts) {
  if (!f.lat || !f.lon) return null;
  const geom = JSON.stringify({ type: 'Point', coordinates: [f.lon, f.lat] });
  const r = await fetch('https://apicarto.ign.fr/api/cadastre/parcelle?geom=' + encodeURIComponent(geom), { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const ft = j.features && j.features[0];
  if (!ft) return null;
  const pr = ft.properties || {};
  const xs = []; const ys = [];
  JSON.stringify(ft.geometry.coordinates).replace(/\[(-?[\d.]+),(-?[\d.]+)\]/g, (m, x, y) => { xs.push(+x); ys.push(+y); return m; });
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => v.toFixed(6)).join(',');
  const idu = pr.idu || ((pr.code_dep || '') + (pr.code_com || '') + (pr.com_abs || '000') + (pr.section || '') + (pr.numero || ''));
  const out = { idu: idu, section: pr.section || '', numero: pr.numero || '', contenance: pr.contenance || null, ventes: [] };
  if (opts && opts.sansVentes) { out.ventesAFaire = true; return out; }
  try {
    const brut = await dvfCerema({ code_insee: f.insee, in_bbox: bbox }, 3, { geo: true, budgetMs: 15000 });
    out.ventes = brut.filter((x) => (x.l_idpar || []).some((p) => String(p).slice(-6) === String(idu).slice(-6) || String(p) === idu) && Number(x.valeurfonc) > 0)
      .map(mutationDvf).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30);
  } catch (e) { /* ventes indisponibles */ }
  return out;
}
// Propriétaire non trouvé dans le fichier DGFiP : sociétés domiciliées à l'adresse (SIRENE),
// avec l'étage indiqué dans leur complément d'adresse.
async function radarDomiciliees(f) {
  const d = await societesAdresse(f.adresse + ' ' + f.cp);
  const soc = (d.societes || []).map((x) => ({ siren: x.siren, nom: x.nom, type: x.type, etage: x.lot && x.lot.etage || '', porte: x.lot && (x.lot.position || x.lot.porte) || '', complement: x.complementAdresse || '', dirigeants: x.dirigeants || [], estSiege: x.estSiege }));
  const etageTxtF = f.etage == null ? null : f.etage === 0 ? 'RDC' : f.etage === 1 ? '1er étage' : f.etage + 'e étage';
  const memeEtage = soc.filter((x) => x.type === 'sci' && etageTxtF && x.etage === etageTxtF);
  return { societes: soc.slice(0, 12), probable: memeEtage.length === 1 ? memeEtage[0] : null };
}

// Fiche complète. ?enrichir=1 : lance (et attend, 25 s max) toutes les recherches.
// Enrichissements en cours (une seule fois par fiche, même si on la rouvre).
const RADAR_ENRICH = new Map();
function radarEnrichirUneFois(f) {
  if (RADAR_ENRICH.has(f.id)) return RADAR_ENRICH.get(f.id);
  const pr = radarEnrichirFiche(f).finally(() => RADAR_ENRICH.delete(f.id));
  RADAR_ENRICH.set(f.id, pr);
  return pr;
}
// Fiche à (re)compléter : jamais enrichie, trop ancienne, ou société sans gérant /
// sans recherche de coordonnées (ex. annuaire indisponible lors du premier passage).
function radarAEnrichir(f) {
  if (!f.enrichiLe) return true;
  const age = Date.now() - radarAnnee(f.enrichiLe);
  if (age > 7 * 864e5) return true;
  const p = f.proprietaire || {};
  if (p.statut === 'identifie' && /^\d{9}$/.test(p.siren || '') && !f.enrichiComplet) return age > 10 * 60e3;
  return false;
}
async function radarEnrichirFiche(f) {
  const p = f.proprietaire || {};
  const fin = Date.now() + 60000;
  const avant = (pr) => Promise.race([pr, new Promise((r) => setTimeout(r, Math.max(1000, fin - Date.now())))]);
  const t = [];
  if (p.statut === 'identifie' && /^\d{9}$/.test(p.siren || '')) {
    t.push(avant(avecCache('soc', 'radarSocietes', p.siren, 30, (tmp) => radarDirigeants(tmp, p.siren)).catch(() => null)).then(() => {
      const soc = cacheLu('soc', p.siren) || {};
      // LinkedIn des gérants : seulement quand on connaît leurs noms (sinon rien à chercher, et rien à mémoriser).
      if (!process.env.EXA_API_KEY || !(soc.dirigeants || []).some((x) => x.nom)) return null;
      return avant(avecCache('contacts', 'radarContacts', p.siren, 60, (tmp) => { tmp.radarSocietes = {}; tmp.radarSocietes[p.siren] = soc; return radarContactsSociete(tmp, p.siren); }).catch(() => null));
    }));
    t.push(avant(avecCache('bodacc', 'radarBodacc', p.siren, 30, (tmp) => radarBodacc(tmp, p.siren)).catch(() => null)));
  }
  if (!f.ventes && f.lat) t.push(avant(radarVentesAdresse(f).then((v) => { if (v) f.ventes = v; }).catch(() => null)));
  if ((!f.parcelle || f.parcelle.ventesAFaire) && f.lat) t.push(avant(radarParcelle(f).then((v) => { if (v) f.parcelle = v; }).catch(() => null)));
  t.push(avant(radarPermisCommune(f.insee).then((l) => { f.permis = radarPermisAdresse(l, f); }).catch(() => null)));
  if (p.statut !== 'identifie') {
    t.push(avant(radarDomiciliees(f).then((dm) => {
      p.domiciliees = dm.societes;
      if (dm.probable) Object.assign(p, { statut: 'identifie', confiance: 'siège SIRENE au même étage', siren: dm.probable.siren, nom: dm.probable.nom, estSci: true, source: 'sirene', dirigeantsSirene: dm.probable.dirigeants });
    }).catch(() => null)));
  }
  const arr = radarZones().find((a) => a.insee === f.insee);
  if (arr) t.push(avant(avecCache('prix', 'radarPrix', arr.insee + '|' + f.type, 30, (tmp) => radarPrixM2(tmp, arr, f.type)).catch(() => null)));
  await Promise.all(t);
  // Adresse non reconnue dans le fichier DGFiP : on essaie la parcelle cadastrale.
  if ((f.proprietaire || {}).statut !== 'identifie' || (f.proprietaire || {}).source === 'sirene') {
    const pp = radarProprietaireParcelle(f);
    if (pp && pp.statut === 'identifie') { pp.domiciliees = (f.proprietaire || {}).domiciliees; pp.millesime = (pmMeta() || {}).annee || null; pp.nbBiens = radarBiensSociete(pp.siren).length || 1; f.proprietaire = pp; }
  }
  // Deuxième ricochet (dépend des gérants trouvés) : autres mandats et coordonnées pro.
  radarAppliquerCache(f);
  const p2 = f.proprietaire || {};
  const dg = p2.dirigeant;
  let coordTente = false;
  if (p2.statut === 'identifie' && dg && dg.nom) {
    const nomD = ((dg.prenoms || dg.prenom || '') + ' ' + dg.nom).trim();
    const cleCoord = p2.siren + '|' + nomD;
    await Promise.all([
      avant(avecCache('mandats', 'x', nomD, 30, () => autresMandats(nomD, p2.siren).then((m) => ({ mandats: m }))).then((v) => { if (v) p2.autresMandats = v.mandats; }).catch(() => null)),
      // Téléphone et email : jamais automatiques (ils consomment des crédits).
      // L'agent les lance depuis la fiche en choisissant les outils. On réutilise
      // seulement un résultat déjà trouvé.
      Promise.resolve().then(() => { const deja = cacheLu('coordpro', cleCoord); if (deja && deja.trouve) p2.coordPro = deja; coordTente = true; })
    ]);
    radarAppliquerCache(f);
  }
  f.enrichiLe = nowISO();
  f.enrichiComplet = p2.statut !== 'identifie' || !/^\d{9}$/.test(p2.siren || '') || (!!p2.dirigeant && coordTente) || (!!cacheLu('soc', p2.siren) && !(cacheLu('soc', p2.siren).dirigeants || []).some((x) => x.nom));
  rsEcrire(f);
  return f;
}
function radarAppliquerCache(f) {
  const p = f.proprietaire || {};
  if (p.siren) {
    const soc = cacheLu('soc', p.siren);
    if (soc) { const d = (soc.dirigeants || []).find((x) => x.nom); p.dirigeant = d || null; p.dirigeants = soc.dirigeants; p.societe = { creation: soc.creation, siege: soc.siege, etat: soc.etat, nomComplet: soc.nomComplet }; }
    const bo = cacheLu('bodacc', p.siren); if (bo) p.bodacc = bo.annonces;
    const ct = cacheLu('contacts', p.siren); if (ct) p.contacts = { linkedin: ct.linkedin, site: ct.site, telephones: ct.telephones, emails: ct.emails };
    if (p.coordPro && p.coordPro.trouve) {
      p.contacts = p.contacts || { linkedin: [], site: null, telephones: [], emails: [] };
      if (p.coordPro.telephone && p.contacts.telephones.indexOf(p.coordPro.telephone) === -1) p.contacts.telephones = [p.coordPro.telephone].concat(p.contacts.telephones);
      if (p.coordPro.email && p.contacts.emails.indexOf(p.coordPro.email) === -1) p.contacts.emails = [p.coordPro.email].concat(p.contacts.emails);
      p.contacts.sourcePro = p.coordPro.source || 'annuaire pro';
    }
    if (p.source === 'sirene' && !p.dirigeants && p.dirigeantsSirene) { p.dirigeants = p.dirigeantsSirene.map((d) => { const x = d.nom.split(' '); return { prenom: x[0], nom: x.slice(1).join(' '), qualite: d.role }; }); p.dirigeant = p.dirigeants[0] || null; }
  }
  const px = cacheLu('prix', f.insee + '|' + f.type);
  if (px && px.m2 && f.surface) { f.prixM2 = px.m2; f.prixBas = Math.round(f.surface * px.m2 * 0.93 / 10000) * 10000; f.prixHaut = Math.round(f.surface * px.m2 * 1.07 / 10000) * 10000; }
}
app.get('/api/radar/fiche/:id', requireAdmin, async (req, res) => {
  if (!RS) return res.status(503).json({ error: 'Base du Radar indisponible.' });
  let f = rsFiche(req.params.id);
  if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
  let enCours = false;
  if (req.query.enrichir === '1' && (RADAR_ENRICH.has(f.id) || radarAEnrichir(f))) {
    const pr = radarEnrichirUneFois(f);
    const r = await Promise.race([pr.then((x) => ({ x })), new Promise((ok) => setTimeout(() => ok(null), 20000))]);
    if (r && r.x) f = r.x; else { enCours = true; radarAppliquerCache(f); }
  } else radarAppliquerCache(f);
  enCours = enCours || RADAR_ENRICH.has(f.id);
  const db = readDb();
  const memes = RS.parBan.all(f.identifiantBan || '-').map(rsLire).filter((x) => x && x.id !== f.id);
  const nbBan = 1 + memes.filter((x) => Date.now() - radarAnnee(x.dpeDate) < 365 * 864e5).length;
  const g = radarCalcul(radarContexte(db), f, nbBan);
  const p = g.proprietaire || {};
  const agent = [req.lead.prenom, req.lead.nom].filter(Boolean).join(' ');
  res.json({ ok: true, enCours: enCours, fiche: Object.assign({}, g, { _acq: undefined }), acquereurs: g._acq,
    biensSociete: p.statut === 'identifie' ? radarBiensSociete(p.siren).slice(0, 30) : [],
    memeImmeuble: memes.slice(0, 12).map((x) => ({ id: x.id, etage: x.etage, surface: x.surface, dpeDate: x.dpeDate, dpe: x.dpe })),
    lotsImmeuble: pmMeta() ? (() => { const q = pmParserAdresse(f.adresse + ' ' + f.cp); if (f.insee) q.insee = f.insee; return q.insee && q.numero ? pmLotsImmeuble(q).sort(pmTriNiveau).slice(0, 120).map((l) => ({ niveau: l.niveauLibelle, porte: l.porte, batiment: l.batiment, nom: l.nom, siren: l.siren, type: l.type, droit: l.droitLibelle })) : []; })() : [],
    kaspr: fournisseurConfigure('KASPR_API_KEY'), fournisseursPro: ['SOCIETEINFO_API_KEY', 'DROPCONTACT_API_KEY', 'DATAGMA_API_KEY', 'FULLENRICH_API_KEY'].filter(fournisseurConfigure).length,
    agent: { nom: agent, email: req.lead.email || '', tel: req.lead.tel || '' }, lead: g.leadId ? (db.leads.find((l) => l.id === g.leadId) ? { id: g.leadId } : null) : null });
});
app.patch('/api/radar/fiche/:id', requireAdmin, (req, res) => {
  const f = RS && rsFiche(req.params.id);
  if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
  const b = req.body || {};
  const qui = [req.lead.prenom, req.lead.nom].filter(Boolean).join(' ');
  if (['a_revoir', 'en_cours', 'contacte', 'ecarte'].indexOf(b.statut) > -1 && b.statut !== f.statut) {
    f.historique = (f.historique || []).concat([{ at: nowISO(), par: qui, action: 'statut', valeur: b.statut }]);
    f.statut = b.statut;
  }
  if (typeof b.note === 'string' && b.note.trim()) f.historique = (f.historique || []).concat([{ at: nowISO(), par: qui, action: 'note', valeur: b.note.trim().slice(0, 1000) }]);
  if (b.rappel !== undefined) f.rappel = b.rappel ? String(b.rappel).slice(0, 10) : null;
  rsEcrire(f);
  res.json({ ok: true, statut: f.statut, historique: f.historique, rappel: f.rappel || null });
});
// « Ajouter aux prospects » : crée le vendeur dans les leads du CRM.
app.post('/api/radar/fiche/:id/prospect', requireAdmin, (req, res) => {
  const f = RS && rsFiche(req.params.id);
  if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
  radarAppliquerCache(f);
  const db = readDb();
  if (f.leadId && db.leads.some((l) => l.id === f.leadId)) return res.json({ ok: true, leadId: f.leadId, deja: true });
  const p = f.proprietaire || {}; const d = p.dirigeant || {};
  const c = p.contacts || {};
  const ou = f.adresse + (f.etage != null ? ', ' + (f.etage === 0 ? 'RDC' : f.etage + 'e étage') : '') + (f.porte ? ', porte ' + f.porte : '');
  const lead = {
    id: uid('l'), prenom: p.statut === 'identifie' ? (d.prenom || '') : '', nom: p.statut === 'identifie' ? (d.nom ? d.nom : p.nom) : 'Propriétaire ' + ou,
    email: ((c.emails || [])[0] || '').toLowerCase(), tel: (c.telephones || [])[0] || '', ville: 'Paris', adresse: p.societe ? p.societe.siege || '' : '', adresseBien: ou,
    projet: 'vendeur', role: 'membre', type: p.statut === 'identifie' ? (p.estSci ? 'sci' : 'societe') : 'personne', natureLead: p.statut === 'identifie' ? (p.estSci ? 'sci' : 'societe') : 'personne',
    raisonSociale: p.statut === 'identifie' ? p.nom : '', representant: d.nom ? (d.qualite || 'Gérant') : '', siren: p.siren || '', dirigeants: p.dirigeants || [],
    source: 'Radar', statut: 'prospect', pipeline: 'a_contacter', bienAVendre: true, typeBien: f.type, surfaceMin: f.surface || 0, quartiers: [f.quartier], dpe: f.dpe || '',
    notes: 'Repéré par le Radar : DPE ' + (f.dpe || '?') + ' du ' + String(f.dpeDate || '').split('-').reverse().join('/') + ', ' + f.type.toLowerCase() + ' de ' + f.surface + ' m² — ' + ou + '.' + ((c.linkedin || [])[0] ? '\nLinkedIn : ' + c.linkedin[0].url : ''),
    tags: ['Radar', 'Futur vendeur'], radarFicheId: f.id, budgetMin: 0, budgetMax: 0, creePar: req.lead.id, agentId: estAgentSimple(roleOf(req.lead)) ? req.lead.id : null, cree: nowISO()
  };
  db.leads.push(lead);
  writeDb(db);
  f.leadId = lead.id;
  f.statut = f.statut === 'a_revoir' ? 'en_cours' : f.statut;
  f.historique = (f.historique || []).concat([{ at: nowISO(), par: [req.lead.prenom, req.lead.nom].filter(Boolean).join(' '), action: 'note', valeur: 'Ajouté aux prospects du CRM' }]);
  rsEcrire(f);
  res.json({ ok: true, leadId: lead.id });
});

// ---- Sociétés domiciliées à une adresse (SIRENE, API publique gratuite) ----
// Complément du fichier DGFiP : une SCI a très souvent son siège dans l'immeuble
// qu'elle possède, et le « complément d'adresse » SIRENE précise parfois l'étage,
// le bâtiment ou la porte (« 3EME ETAGE GAUCHE », « BAT B ESC 2 »…).
function analyserComplementAdresse(texte) {
  const s = pmNorm(texte);
  const out = {};
  if (!s) return out;
  if (/\b(RDC|REZ DE CHAUSSEE)\b/.test(s)) out.etage = 'RDC';
  let m = /\b(\d{1,2})\s*(?:E|EME|IEME|ER|ERE)\s*(?:ETAGE|ETG|ET)\b/.exec(s) || /\b(\d{1,2})\s*(?:ETAGE|ETG)\b/.exec(s) || /\b(?:ETAGE|ETG)\s*N?\s*(\d{1,2})\b/.exec(s);
  if (m && !out.etage) out.etage = m[1] === '1' ? '1er étage' : parseInt(m[1], 10) + 'e étage';
  m = /\b(GAUCHE|DROITE|FACE|FOND|MILIEU)\b/.exec(s) || /\b(?:PORTE|PTE|ETAGE|ETG)\s+(G|D)\b/.exec(s);
  if (m) out.position = { G: 'gauche', D: 'droite' }[m[1]] || m[1].toLowerCase();
  m = /\b(?:BAT|BATIMENT|BT)\s*([A-Z0-9]{1,3})\b/.exec(s); if (m) out.batiment = m[1];
  m = /\b(?:ESC|ESCALIER)\s*([A-Z0-9]{1,3})\b/.exec(s); if (m) out.escalier = m[1];
  m = /\b(?:APT|APPT|APPARTEMENT|APP|LOGT|LOGEMENT)\s*N?\s*([A-Z0-9]{1,5})\b/.exec(s); if (m) out.appartement = m[1];
  m = /\bPORTE\s*N?\s*(\d{1,5})\b/.exec(s); if (m) out.porte = m[1];
  return out;
}

const SIRENE_ADRESSE_CACHE = {};
async function societesAdresse(adresse) {
  const cle = pmNorm(adresse);
  if (SIRENE_ADRESSE_CACHE[cle] && Date.now() - SIRENE_ADRESSE_CACHE[cle].at < 24 * 3600 * 1000) return SIRENE_ADRESSE_CACHE[cle].data;
  const q = pmParserAdresse(adresse);
  const appel = async (extra) => {
    const p = new URLSearchParams(Object.assign({ q: adresse, per_page: '25', page: '1', etat_administratif: 'A' }, q.cp ? { code_postal: q.cp } : {}, extra));
    // L'API publique limite le nombre d'appels par seconde : on réessaie après
    // une courte pause si elle répond 429 ou 5xx.
    let r = null;
    for (let essai = 0; essai < 4; essai++) {
      r = await sireneFetch('https://recherche-entreprises.api.gouv.fr/search?' + p.toString(), { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0 (contact@seecret.fr)' }, signal: AbortSignal.timeout(15000) });
      if (r.status !== 429 && r.status < 500) break;
      await new Promise((ok) => setTimeout(ok, 800 * (essai + 1)));
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json().catch(() => ({}));
    return Array.isArray(d.results) ? d.results : [];
  };
  {
    // Deux requêtes : une limitée aux SCI (nature juridique 6540) pour ne pas les
    // noyer sous les commerces de la rue, une générale pour les autres sociétés.
    // Appels l'un après l'autre (deux appels simultanés déclenchaient la limite
    // de débit de l'API, d'où « injoignable » en production).
    let derniereErreur = '';
    const scis = await appel({ nature_juridique: '6540' }).catch((e) => { derniereErreur = e.message; return []; });
    const autres = await appel({}).catch((e) => { derniereErreur = e.message; return null; });
    if (autres === null && !scis.length) throw new Error(derniereErreur || 'injoignable');
    const vus = {};
    const societes = [];
    scis.concat(autres || []).forEach((e) => {
      if (!e || !e.siren || vus[e.siren]) return;
      const siege = e.siege || {};
      const adresses = [siege].concat(Array.isArray(e.matching_etablissements) ? e.matching_etablissements : []);
      // On ne garde que les sociétés réellement domiciliées à CE numéro de CETTE rue.
      const correspondant = adresses.find((a) => {
        const texte = pmNorm(a.adresse || [a.numero_voie, a.indice_repetition, a.type_voie, a.libelle_voie, a.code_postal].filter(Boolean).join(' '));
        const num = String(a.numero_voie || (/(?:^|\s)(\d{1,4})\s/.exec(' ' + texte + ' ') || [])[1] || '');
        if (q.numero && String(parseInt(num, 10)) !== q.numero) return false;
        if (q.cp && texte.indexOf(q.cp) === -1 && String(a.code_postal || '') !== q.cp) return false;
        const motsA = pmMotsVoie(a.libelle_voie || texte.replace(/^\D*\d+\s*/, '').replace(/\b\d{5}\b.*$/, ''), a.type_voie || '');
        return !q.mots.length || pmScoreVoie(q.mots, motsA) > 0 || q.mots.every((m) => texte.indexOf(m) > -1);
      });
      if (!correspondant) return;
      vus[e.siren] = true;
      const nom = e.nom_complet || e.nom_raison_sociale || ('SIREN ' + e.siren);
      const nj = String(e.nature_juridique || '');
      const complement = correspondant.complement_adresse || siege.complement_adresse || '';
      societes.push({
        siren: e.siren, nom, natureJuridique: nj,
        type: (nj.indexOf('654') === 0 || /\bSCI\b|CIVILE IMMOBILIERE/i.test(nom)) ? 'sci' : 'societe',
        dateCreation: e.date_creation || '',
        estSiege: correspondant === siege || !!correspondant.est_siege,
        adresse: correspondant.adresse || siege.adresse || '',
        complementAdresse: complement,
        lot: analyserComplementAdresse(complement + ' ' + (correspondant.adresse || '')),
        dirigeants: (e.dirigeants || []).filter((d) => String(d.type_dirigeant || '').toLowerCase() === 'personne physique')
          .map((d) => ({ nom: ((d.prenoms ? d.prenoms + ' ' : '') + (d.nom || '')).trim(), role: d.qualite || '' }))
      });
    });
    societes.sort((a, b) => (a.type === 'sci' ? 0 : 1) - (b.type === 'sci' ? 0 : 1));
    const data = { ok: true, societes };
    SIRENE_ADRESSE_CACHE[cle] = { at: Date.now(), data };
    return data;
  }
}
app.get('/api/robot/societes-adresse', requireAdmin, async (req, res) => {
  const adresse = String(req.query.adresse || '').trim();
  if (!adresse) return res.status(400).json({ error: 'Adresse requise.' });
  try { res.json(await societesAdresse(adresse)); }
  catch (e) { res.status(502).json({ error: 'API SIRENE (recherche-entreprises.api.gouv.fr) injoignable.' }); }
});

// Enrichissement contacts d'un signal DPE (propriétaire + téléphone/email avec statuts)
app.post('/api/robot/prospecting/:id/enrich', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identifiant de signal requis.' });
  try {
    const token = await robotToken();
    if (!token) return res.status(502).json({ error: 'Moteur Python non authentifié.' });
    const r = await fetch(ROBOT_URL + '/search/' + id + '/enrich', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, signal: AbortSignal.timeout(60000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: typeof data.detail === 'string' ? data.detail : 'Enrichissement Python impossible.' });
    res.json({ ok: true, source: 'contact_enrichment', data: data });
  } catch (e) {
    res.status(502).json({ error: 'Serveur Python injoignable.' });
  }
});

// Journal d'activité unifié — lu par le CRM (fiche contact)
app.get('/api/activites', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, activites: db.activites || [] });
});

// Notifications : persistance des éléments traités
app.get('/api/portefeuille-foncier', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, societes: db.portefeuilleFoncier || [] });
});

app.get('/api/notifications', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, traitees: db.notificationsTraitees || [] });
});

app.post('/api/notifications', requireAdmin, (req, res) => {
  const db = readDb();
  db.notificationsTraitees = Array.isArray(req.body && req.body.traitees) ? req.body.traitees : [];
  writeDb(db);
  res.json({ ok: true, count: db.notificationsTraitees.length });
});

// Création d'un client CRM — à la fois pour « transformer une prospection
// DPE en Lead » (robot-ajouter) et pour le formulaire « Nouveau client »
// classique, qui jusqu'ici ne créait le client QUE dans le localStorage du
// navigateur (jamais côté serveur) : invisible pour un autre agent ou poste,
// et hors de portée du filtrage par agentId mis en place ci-dessus.
app.post('/api/leads', requireAdmin, (req, res) => {
  const db = readDb();
  const body = req.body || {};
  const nom = String(body.nom || '').trim();
  const prenom = String(body.prenom || '').trim();
  if (!nom && !prenom) return res.status(400).json({ error: 'Un nom (ou prénom) est nécessaire.' });
  const email = String(body.email || '').trim().toLowerCase();
  const siren = String(body.siren || '').trim();
  const tel = String(body.tel || '').trim();
  const adresseBien = String(body.adresseBien || body.adresse || '').trim();
  // Anti-doublons : email ou SIREN déjà connus (un nom seul n'est plus
  // bloquant — deux clients homonymes sont courants en agence).
  if (email && db.leads.some((l) => (l.email || '').toLowerCase() === email)) {
    return res.status(409).json({ error: 'Un lead avec cet email existe déjà.' });
  }
  if (siren && db.leads.some((l) => (l.siren || '') === siren)) {
    return res.status(409).json({ error: 'Une société avec ce SIREN existe déjà.' });
  }
  const role = roleOf(req.lead);
  // Un agent qui crée un client en devient automatiquement propriétaire
  // (« enregistré de lui-même »). Le super-admin peut, lui, attribuer
  // directement le client à l'agent de son choix via agentId ; à défaut le
  // client reste non attribué (visible seulement par le super-admin, comme
  // les clients déjà existants avant ce système).
  const agentId = estAgentSimple(role) ? req.lead.id : (body.agentId ? String(body.agentId) : null);
  const lead = {
    id: uid('l'), prenom: prenom, nom: nom, email: email, tel: tel,
    ville: String(body.ville || ''), projet: 'prospect', role: 'membre', type: String(body.type || 'personne'),
    siren: siren, dirigeants: Array.isArray(body.dirigeants) ? body.dirigeants : [],
    source: String(body.source || 'Immo Data Robot'), statut: String(body.statut || 'prospect'),
    budgetMin: Math.max(0, Number(body.budgetMin) || 0), budgetMax: Math.max(0, Number(body.budgetMax) || 0),
    quartiers: Array.isArray(body.quartiers) ? body.quartiers.map(String) : [],
    piecesMin: Math.max(0, Number(body.piecesMin) || 0), surfaceMin: Math.max(0, Number(body.surfaceMin) || 0),
    surfaceMax: Math.max(0, Number(body.surfaceMax) || 0), delai: String(body.delai || ''),
    financement: String(body.financement || ''), apport: Math.max(0, Number(body.apport) || 0),
    courtier: !!body.courtier, bienAVendre: !!body.bienAVendre, typeBien: String(body.typeBien || ''),
    notes: String(body.notes || ''), adresseBien: adresseBien, parcelle: String(body.parcelle || ''),
    dpe: String(body.dpe || ''),
    // Distinct du `type` ci-dessus (réservé à personne/sci/societe côté Radar,
    // sur le propriétaire d'un bien) : `natureLead` dit si CE lead du CRM est
    // une personne physique ou une société (SCI, SARL immobilière…), avec son
    // représentant/dirigeant si c'est le cas.
    natureLead: String(body.natureLead || 'personne'), civilite: String(body.civilite || ''),
    adresse: String(body.adresse || ''), raisonSociale: String(body.raisonSociale || ''),
    representant: String(body.representant || ''),
    creePar: req.lead.id, agentId: agentId, cree: nowISO()
  };
  db.leads.push(lead);
  writeDb(db);
  res.json({ ok: true, lead: lead });
});

// ---- Import du fichier clients historique (CRM › Leads › Importer) ----
// Le navigateur lit le fichier (Excel / CSV), trie et classe les clients, puis
// envoie les lignes par lots de 500. Ici : création des nouveaux clients et,
// pour ceux déjà connus (même email ou même téléphone), complément des champs
// vides + ajout de la note, sans rien écraser. AUCUN email n'est envoyé.
function telNormalise(t) {
  let d = String(t || '').replace(/[^\d+]/g, '');
  if (d.indexOf('+33') === 0) d = '0' + d.slice(3);
  else if (d.indexOf('0033') === 0) d = '0' + d.slice(4);
  d = d.replace(/\D/g, '');
  if (d.length === 9 && /^[1-9]/.test(d)) d = '0' + d;
  return d;
}
app.post('/api/leads/import', requireAdmin, (req, res) => {
  const lignes = Array.isArray(req.body && req.body.lignes) ? req.body.lignes.slice(0, 1000) : [];
  const simulation = !!(req.body && req.body.simulation);
  const lot = String((req.body && req.body.lot) || '').slice(0, 40) || ('import-' + new Date().toISOString().slice(0, 10));
  const db = readDb();
  const role = roleOf(req.lead);
  const agentId = estAgentSimple(role) ? req.lead.id : null;
  // Téléphone partagé (couple, standard de bureau…) : on ne rapproche par
  // téléphone que si le nom de famille correspond aussi.
  const nomCle = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const parEmail = new Map(); const parTel = new Map();
  const ajouterTel = (t, l) => { if (t.length < 9) return; if (!parTel.has(t)) parTel.set(t, []); parTel.get(t).push(l); };
  db.leads.forEach((l) => {
    if (l.email) parEmail.set(String(l.email).toLowerCase(), l);
    ajouterTel(telNormalise(l.tel), l);
  });
  const parTelEtNom = (t, nom, prenom) => (parTel.get(t) || []).find((l) => {
    const a = nomCle(l.nom); const b = nomCle(nom);
    return (a && b && a === b) || (!a && !b && nomCle(l.prenom) === nomCle(prenom));
  }) || null;
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
  const PROJETS = ['acquereur', 'vendeur', 'mixte', 'prospect'];
  const resultat = { crees: 0, completes: 0, ignores: 0, details: [] };
  lignes.forEach((x, i) => {
    const prenom = str(x.prenom, 80); const nom = str(x.nom, 80);
    const email = str(x.email, 160).toLowerCase(); const tel = str(x.tel, 40);
    const telN = telNormalise(tel);
    if ((!nom && !prenom) || (!email && telN.length < 9 && !str(x.adresse))) { resultat.ignores++; resultat.details.push({ i: i, etat: 'ignore' }); return; }
    const existant = (email && parEmail.get(email)) || (telN.length >= 9 && parTelEtNom(telN, nom, prenom)) || null;
    const note = str(x.notes, 4000);
    const tags = Array.isArray(x.tags) ? x.tags.map((t) => str(t, 40)).filter(Boolean).slice(0, 8) : [];
    if (existant) {
      resultat.completes++; resultat.details.push({ i: i, etat: 'complete', id: existant.id });
      if (simulation) return;
      ['prenom', 'nom', 'tel', 'ville', 'adresse', 'typeBien'].forEach((k) => { if (!existant[k] && str(x[k])) existant[k] = str(x[k]); });
      if (!existant.email && email && !parEmail.has(email)) { existant.email = email; parEmail.set(email, existant); }
      if (!existant.budgetMax && Number(x.budgetMax) > 0) existant.budgetMax = Math.round(Number(x.budgetMax));
      if ((!existant.quartiers || !existant.quartiers.length) && Array.isArray(x.quartiers)) existant.quartiers = x.quartiers.map(String).slice(0, 6);
      if (note && String(existant.notes || '').indexOf(note.slice(0, 60)) === -1) existant.notes = (existant.notes ? existant.notes + '\n\n' : '') + '[Fichier clients] ' + note;
      existant.tags = Array.from(new Set((existant.tags || []).concat(tags)));
      return;
    }
    const lead = {
      id: uid('l'), prenom: prenom, nom: nom, email: email, tel: tel, civilite: str(x.civilite, 10),
      ville: str(x.ville, 80), adresse: str(x.adresse), adresseBien: str(x.adresseBien || ''),
      projet: PROJETS.indexOf(x.projet) > -1 ? x.projet : 'prospect', role: 'membre', type: 'personne', natureLead: 'personne',
      source: 'Fichier clients', statut: 'prospect', importLot: lot,
      budgetMin: 0, budgetMax: Math.max(0, Math.round(Number(x.budgetMax) || 0)),
      quartiers: Array.isArray(x.quartiers) ? x.quartiers.map(String).slice(0, 6) : [],
      piecesMin: Math.max(0, Number(x.pieces) || 0), surfaceMin: Math.max(0, Number(x.surface) || 0), surfaceMax: 0,
      delai: '', financement: '', apport: 0, courtier: false, bienAVendre: x.projet === 'vendeur' || x.projet === 'mixte', typeBien: str(x.typeBien, 40),
      notes: note, tags: tags, dernierContact: str(x.dateContact, 30) || null,
      siren: '', dirigeants: [], parcelle: '', dpe: '', raisonSociale: '', representant: '',
      creePar: req.lead.id, agentId: agentId, cree: nowISO()
    };
    resultat.crees++; resultat.details.push({ i: i, etat: 'cree', id: lead.id });
    if (simulation) return;
    db.leads.push(lead);
    if (email) parEmail.set(email, lead);
    ajouterTel(telN, lead);
  });
  if (!simulation) writeDb(db);
  res.json(Object.assign({ ok: true, simulation: simulation, lot: lot }, resultat));
});

// ---- Import de fiches vendeurs (export du logiciel d'agence) ----
// Chaque élément : le propriétaire (lead vendeur) + son bien + la photo du bien.
// Rapprochement : lead par email, ou téléphone + même nom ; bien par référence
// d'origine (refAgence). On complète sans jamais écraser ce qui existe.
// Les biens restent hors plateforme (« Sur Seecret » désactivé, En préparation) :
// ce sont des mandats d'une autre agence, rien n'est publié sans l'agent.
const DETAILS_BIEN = ['prixAffiche', 'honorairesAcheteur', 'surfaceCarrez', 'surfaceTotale', 'niveaux', 'etagesImmeuble', 'etageTexte', 'exposition', 'vue', 'standing', 'chauffage', 'eauChaude', 'eauxUsees', 'anneeRenovation', 'style', 'dpeKwh', 'gesKg', 'taxeFonciere', 'lotsCopropriete', 'residence', 'quartierOrigine', 'disponibilite', 'prestations', 'surfacesDetail', 'proximites'];
function nettoyerDetails(d) {
  const out = {};
  DETAILS_BIEN.forEach((k) => {
    const v = d && d[k];
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) out[k] = v.slice(0, 60).map((x) => (typeof x === 'object' ? { piece: String(x.piece || '').slice(0, 60), surface: Number(x.surface) || null } : String(x).slice(0, 80)));
    else out[k] = typeof v === 'number' ? v : String(v).slice(0, 200);
  });
  return out;
}
// Titre éditorial « logique » d'un bien importé, sans IA, à partir de ses données.
const normTitre = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const NB_PIECES = ['', 'Studio', 'Deux pièces', 'Trois pièces', 'Quatre pièces', 'Cinq pièces', 'Six pièces', 'Sept pièces', 'Huit pièces'];
function texteEditorialImport(b) {
  let t = String(b.description || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // En-tête d'annonce collé au texte : « PARIS XIVème : » / « Denfert Rochereau : »
  t = t.replace(/^[^.:\n]{3,40}\s:\s+/, (m) => (/\b[A-ZÉÈ]{4,}\b/.test(m) && !/\d{2,}\s*m|pi[eè]ces/i.test(m) ? '' : m));
  if (t.length > 2500) { const c = t.slice(0, 2500); const p = c.lastIndexOf('. '); t = (p > 1500 ? c.slice(0, p + 1) : c).trim(); }
  return t;
}
function titreEditorialImport(b) {
  const d = normTitre(b.description); const det = b.details || {};
  const type = normTitre(b.type); const p = Number(b.pieces) || 0;
  let nom;
  if (/atelier d.?artiste/.test(d)) nom = 'Atelier d’artiste';
  else if (/hotel particulier/.test(type)) nom = 'Hôtel particulier';
  else if (/chateau/.test(type)) nom = 'Château';
  else if (/propriete/.test(type) || (/maison|villa/.test(type) && /\bpropriete\b/.test(d.slice(0, 200)))) nom = 'Propriété';
  else if (/villa/.test(type)) nom = 'Villa';
  else if (/maison de ville/.test(type)) nom = 'Maison de ville';
  else if (/maison de village/.test(type)) nom = 'Maison de village';
  else if (/maison/.test(type)) nom = 'Maison' + (p >= 5 ? ' familiale' : '');
  else if (/peniche/.test(type)) nom = 'Péniche';
  else if (/immeuble/.test(type)) nom = 'Immeuble';
  else if (/terrain/.test(type)) nom = 'Terrain';
  else if (/parking|box/.test(type)) nom = /box/.test(type) ? 'Box' : 'Parking';
  else if (/bureau/.test(type)) nom = 'Bureaux';
  else if (/local|commerce/.test(type)) nom = 'Local commercial';
  else if (/loft/.test(type) || /\bloft\b/.test(d.slice(0, 120))) nom = 'Loft';
  else if (/duplex|triplex/.test(type)) nom = (p > 1 && p < NB_PIECES.length ? NB_PIECES[p] : 'Appartement') + ' en ' + (/triplex/.test(type) ? 'triplex' : 'duplex');
  else if (/penthouse/.test(d)) nom = 'Penthouse';
  else nom = p >= 1 && p < NB_PIECES.length ? NB_PIECES[p] : 'Appartement';
  // Un trait distinctif, du plus parlant au plus courant.
  const ext = normTitre(b.exterieur);
  const traits = [
    [/piscine (de la residence|en copropriete|de la copropriete|commune)/.test(d) || (b.details && (b.details.prestations || []).some((x) => /piscine en copropri/i.test(x))), 'dans une résidence avec piscine'],
    [/(avec|sa|une|belle|grande) piscine|piscine (privative|chauffee|exterieure|interieure)/.test(d) && !/piscine (municipale|olympique)/.test(d), 'avec piscine'],
    [/vue (sur la |sur )?tour eiffel/.test(d), 'avec vue sur la tour Eiffel'],
    [/vue (sur la |sur )?seine/.test(d), 'avec vue sur la Seine'],
    [/rooftop|toit.terrasse/.test(d), 'avec toit-terrasse'],
    [/terrasse/.test(ext) || /(une|sa|belle|grande|vaste|large|agreable) terrasse/.test(d), 'avec terrasse'],
    [/jardin/.test(ext) || /\bjardin (privatif|prive)/.test(d), 'avec jardin'],
    [/dernier etage/.test(d), 'au dernier étage'],
    [/art deco/.test(d), 'Art déco'],
    [/haussmann/.test(d), 'haussmannien'],
    [/balcon/.test(ext) || /(un|son|petit|grand|beau|joli) balcon/.test(d), 'avec balcon'],
    [/traversant/.test(d), 'traversant'],
    [/plein sud/.test(d) || /^sud$/.test(normTitre(det.exposition)), 'plein sud'],
    [/vue degagee|sans vis.a.vis/.test(d), 'sans vis-à-vis'],
    [/calme/.test(d) && /lumineu/.test(d), 'calme et lumineux'],
    [/renove|refait a neuf/.test(d), 'rénové'],
    [/a renover|travaux a prevoir|rafraichir/.test(d), 'à rénover']
  ];
  const tr = (traits.find((x) => x[0]) || [])[1] || '';
  // accorde « rénové / lumineux » au féminin pour maison, villa, propriété
  const fem = /^(Maison|Villa|Propriété|Péniche)/.test(nom);
  const trait = fem ? tr.replace(/^rénové$/, 'rénovée').replace('calme et lumineux', 'calme et lumineuse').replace('haussmannien', 'haussmannienne').replace('traversant', 'traversante') : tr;
  // Le lieu, sans jamais l'adresse (off-market) : l'arrondissement à Paris, sinon la ville.
  const cp = String(b.codePostal || '');
  const arr = /^75(0\d\d|116)$/.test(cp) ? (cp === '75116' ? 16 : Number(cp.slice(3))) : 0;
  const ville = String(b.ville || '').replace(/\s*\d+\s*(er|e|ème|eme|ᵉ)?\b.*$/i, '').trim();
  const lieu = arr ? 'Paris ' + arr + (arr === 1 ? 'er' : 'e') : ville;
  let titre = [nom, trait].filter(Boolean).join(' ') + (lieu ? ', ' + lieu : '');
  if (titre.length > 90) titre = nom + (lieu ? ', ' + lieu : '');
  return titre.slice(0, 90);
}

function editorialImport(b) {
  return { titre: titreEditorialImport(b), texte: texteEditorialImport(b), publie: false, modifieLe: nowISO(), auteur: 'Import', publieLe: null, source: 'description du fichier' };
}
// Reprend le descriptif des biens importés dans « Texte de la fiche » avec un titre.
// Sans écraser un texte déjà saisi (sauf ecraser: true). Rien n'est publié.
app.post('/api/import/editorial', requireAdmin, (req, res) => {
  const body = req.body || {};
  const db = readDb();
  let faits = 0, gardes = 0;
  db.biens.filter((b) => b.importLot && (!body.lot || b.importLot === String(body.lot))).forEach((b) => {
    const e = b.editorial || {};
    if (!body.ecraser && (e.titre || e.texte)) { gardes++; return; }
    b.editorial = Object.assign({}, e, editorialImport(b));
    faits++;
  });
  if (faits) writeDb(db);
  res.json({ ok: true, faits: faits, gardes: gardes });
});
app.post('/api/import/fiches-vendeurs', requireAdmin, (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 120) : [];
  const simulation = !!(req.body && req.body.simulation);
  const lot = String((req.body && req.body.lot) || 'fiches-vendeurs').slice(0, 60);
  const db = readDb();
  const agentId = estAgentSimple(roleOf(req.lead)) ? req.lead.id : null;
  const nomCle = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const r = { leadsCrees: 0, leadsCompletes: 0, biensCrees: 0, biensCompletes: 0, photos: 0, erreurs: [] };
  const libre = placeLibreMo();
  items.forEach((it, i) => {
    try {
      const p = it.proprio || {}; const b = it.bien || {};
      const email = str(p.email, 160).toLowerCase(); const tel = str(p.tel, 40); const telN = telNormalise(tel);
      if (!email && telN.length < 9) { r.erreurs.push({ i: i, raison: 'sans contact' }); return; }
      let lead = (email && db.leads.find((l) => String(l.email || '').toLowerCase() === email)) ||
        (telN.length >= 9 && db.leads.find((l) => telNormalise(l.tel) === telN && nomCle(l.nom) === nomCle(p.nom))) || null;
      if (lead) {
        r.leadsCompletes++;
        if (!simulation) {
          ['nom', 'tel', 'adresse', 'civilite', 'raisonSociale'].forEach((k) => { if (!lead[k] && str(p[k])) lead[k] = str(p[k]); });
          if (!lead.email && email) lead.email = email;
          lead.bienAVendre = true; if (lead.projet === 'acquereur') lead.projet = 'mixte';
          lead.tags = Array.from(new Set((lead.tags || []).concat(['Fichier De Ferla'])));
        }
      } else {
        r.leadsCrees++;
        lead = {
          id: uid('l'), prenom: str(p.prenom, 80), nom: str(p.nom, 120), email: email, tel: tel, civilite: str(p.civilite, 10),
          ville: str(b.ville, 80), adresse: str(p.adresse), adresseBien: [str(b.adresse), str(b.codePostal), str(b.ville)].filter(Boolean).join(' '),
          projet: 'vendeur', role: 'membre', type: p.natureLead === 'sci' ? 'sci' : p.natureLead === 'societe' ? 'societe' : 'personne', natureLead: ['sci', 'societe'].indexOf(p.natureLead) > -1 ? p.natureLead : 'personne',
          raisonSociale: str(p.raisonSociale, 120), representant: '', siren: '', dirigeants: [],
          source: 'Fichier De Ferla', statut: 'prospect', pipeline: 'a_contacter', importLot: lot,
          autresTelephones: (p.autresTels || []).map((x) => str(x, 40)).slice(0, 4), autresEmails: (p.autresEmails || []).map((x) => str(x, 160)).slice(0, 4),
          telAVerifier: !!p.telAVerifier, civiliteTexte: str(p.civiliteTexte, 20),
          budgetMin: 0, budgetMax: 0, quartiers: b.quartier ? [str(b.quartier, 20)] : [], piecesMin: 0, surfaceMin: 0, surfaceMax: 0,
          delai: '', financement: '', apport: 0, courtier: false, bienAVendre: true, typeBien: str(b.type, 40),
          notes: '', tags: ['Fichier De Ferla'].concat(b.mandatOrigine && b.mandatOrigine.type ? ['Mandat ' + b.mandatOrigine.type.toLowerCase()] : []),
          creePar: req.lead.id, agentId: agentId, cree: nowISO()
        };
        if (!simulation) db.leads.push(lead);
      }
      const ref = str(b.refAgence, 40);
      let bien = ref && db.biens.find((x) => x.refAgence === ref);
      const champs = {
        adresse: str(b.adresse), codePostal: str(b.codePostal, 10), ville: str(b.ville, 80), quartier: str(b.quartier, 20),
        lat: Number(b.lat) || null, lon: Number(b.lon) || null, type: str(b.type, 40) || 'Appartement',
        surface: num(b.surface), pieces: num(b.pieces), chambres: num(b.chambres), sdb: num(b.sdb),
        etage: b.etage === null || b.etage === undefined ? null : num(b.etage), ascenseur: !!b.ascenseur, anneeConstruction: num(b.anneeConstruction),
        etat: str(b.etat, 60), dpe: /^[A-G]$/.test(b.dpe || '') ? b.dpe : '', ges: /^[A-G]$/.test(b.ges || '') ? b.ges : '',
        exterieur: str(b.exterieur, 40), surfaceExterieur: num(b.surfaceExterieur), annexes: Array.isArray(b.annexes) ? b.annexes.map(String).slice(0, 10) : [],
        prix: num(b.prix), charges: num(b.charges), description: str(b.description, 6000), atouts: Array.isArray(b.atouts) ? b.atouts.map(String).slice(0, 12) : []
      };
      if (bien) {
        r.biensCompletes++;
        if (!simulation) {
          Object.keys(champs).forEach((k) => { const v = champs[k]; const vide = bien[k] === undefined || bien[k] === null || bien[k] === '' || bien[k] === 0 || (Array.isArray(bien[k]) && !bien[k].length); if (vide && v !== '' && v !== 0 && v !== null && !(Array.isArray(v) && !v.length)) bien[k] = v; });
          bien.details = Object.assign({}, nettoyerDetails(b.details), bien.details || {});
        }
      } else {
        r.biensCrees++;
        bien = Object.assign({ id: uid('b'), leadId: lead.id, email: lead.email || '', nom: [lead.prenom, lead.nom].filter(Boolean).join(' '), titre: '' }, champs, {
          titre: [champs.type, champs.pieces ? champs.pieces + ' pièces' : '', champs.surface ? Math.round(champs.surface) + ' m²' : '', champs.quartier ? labelQuartier(champs.quartier) : champs.ville].filter(Boolean).join(' · '),
          refAgence: ref, details: nettoyerDetails(b.details), accesVisites: str(b.accesVisites, 1500),
          mandatOrigine: { agence: str(b.mandatOrigine && b.mandatOrigine.agence, 60), type: str(b.mandatOrigine && b.mandatOrigine.type, 30), numero: str(b.mandatOrigine && b.mandatOrigine.numero, 30), debut: str(b.mandatOrigine && b.mandatOrigine.debut, 10) || null, fin: str(b.mandatOrigine && b.mandatOrigine.fin, 10) || null },
          tauxHonoraires: tauxValide(b.tauxHonoraires),
          historiquePrix: champs.prix ? [{ at: nowISO(), ancien: 0, nouveau: champs.prix, auteur: 'Import', source: 'Fichier De Ferla' }] : [],
          photos: [], exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon', statutDemande: null,
          surSeecret: false, source: 'Fichier De Ferla', sourceFichier: str(b.sourceFichier, 120), importLot: lot,
          agent: nomComplet(req.lead) || DEFAULT_AGENT_NOM, cree: nowISO()
        });
        bien.editorial = editorialImport(bien);
        if (!simulation) db.biens.push(bien);
      }
      // Photo du bien (JPEG/PNG en base64), si le bien n'en a pas encore.
      const ph = it.photo;
      if (!simulation && ph && ph.data && !(bien.photos || []).length && (libre === null || libre > 60)) {
        const ext = /png/.test(ph.type || '') ? '.png' : '.jpg';
        const buf = Buffer.from(String(ph.data), 'base64');
        if (buf.length > 500 && buf.length < 3 * 1024 * 1024) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          const nom = 'imp-' + String(bien.id).replace(/[^\w-]/g, '') + '-' + crypto.randomBytes(4).toString('hex') + ext;
          fs.writeFileSync(path.join(UPLOADS_DIR, nom), buf);
          bien.photos = ['/uploads/' + nom]; r.photos++;
        }
      }
    } catch (e) { r.erreurs.push({ i: i, raison: e.message }); }
  });
  if (!simulation) writeDb(db);
  res.json(Object.assign({ ok: true, simulation: simulation }, r));
});

// ---- Vérifications marché d'un bien : vendu (DVF) ? toujours en ligne (portails) ? ----
// Tâche de fond, un bien à la fois, pour ne pas saturer le Cerema ni Exa.
const VERIF = { file: [], enCours: null, faits: 0, debut: null, erreurs: 0, seulDvf: {} };
function insseeDepuisCp(cp) {
  const c = String(cp || '');
  if (/^750(\d\d)$/.test(c)) return c === '75016' || c === '75116' ? '75116' : '751' + c.slice(3);
  return '';
}
const typeDvfCompatible = (type, lib) => {
  const t = radarNorm(type); const l = radarNorm(lib);
  if (/maison|villa|hotel particulier|propriete|chateau/.test(t)) return /maison/.test(l);
  if (/terrain/.test(t)) return /terrain/.test(l);
  if (/parking|box/.test(t)) return /dependance|activite|indetermine/.test(l);
  if (/bureau|local|commerce|immeuble/.test(t)) return /activite|mixte|indetermine|appartement|maison/.test(l);
  return /appartement/.test(l);
};
// Géocodage à l'adresse exacte (BAN) : on n'utilise jamais la position du
// fichier d'origine, souvent celle du quartier.
// Ville lisible : le fichier d'origine colle parfois d'autres champs derrière
// (« Paris 7ème  Nombre de lots dans la copropriété 36 », « Levallois-Perret (Hôtel de Ville - »).
function villePropre(ville, cp) {
  if (/^75\d{3}$/.test(String(cp || ''))) return 'Paris';
  return String(ville || '').replace(/\s*(Nombre de lots.*|\(.*|\d+\s*(er|e|ème|eme|ᵉ)?\b.*)$/i, '').replace(/\s{2,}/g, ' ').trim();
}
const DVF_METHODE = 'parcelle2';
async function cadastreParcelle(lon, lat) {
  const appel = async (geom) => {
    const r = await fetch('https://apicarto.ign.fr/api/cadastre/parcelle?geom=' + encodeURIComponent(JSON.stringify(geom)), { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('Cadastre ' + r.status);
    return ((await r.json().catch(() => ({}))).features || []);
  };
  let f = await appel({ type: 'Point', coordinates: [lon, lat] });
  if (!f.length) { await new Promise((ok) => setTimeout(ok, 800)); f = await appel({ type: 'Point', coordinates: [lon, lat] }); }
  if (!f.length) {
    // Le point de l'adresse tombe parfois sur le trottoir : carré de ~12 m autour.
    const d = 0.00008;
    f = await appel({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
  }
  return f[0] || null;
}
async function geocoderNumero(b) {
  const adr = String(b.adresse || '').split(/\s+[—–]\s+|\n/)[0].trim();
  const q = [adr, b.codePostal, villePropre(b.ville, b.codePostal)].filter(Boolean).join(' ');
  if (!q || !/^\s*\d/.test(adr)) return null;
  const r = await fetch('https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(q) + (b.codePostal ? '&postcode=' + encodeURIComponent(b.codePostal) : ''), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('BAN ' + r.status);
  const f = ((await r.json()).features || [])[0];
  if (!f || (f.properties || {}).type !== 'housenumber' || (f.properties.score || 0) < 0.6) return null;
  return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], insee: f.properties.citycode, label: f.properties.label };
}
async function verifierDvf(b) {
  const g = await geocoderNumero(b);
  if (!g) return { statut: 'sans_position', methode: DVF_METHODE, raison: 'Adresse sans numéro ou introuvable : pas de contrôle DVF fiable.', maj: nowISO() };
  b.lat = g.lat; b.lon = g.lon; b.insee = g.insee;
  // Parcelle cadastrale du numéro, puis les ventes de cette parcelle seulement.
  const ft = await cadastreParcelle(g.lon, g.lat);
  if (!ft) return { statut: 'sans_position', methode: DVF_METHODE, raison: 'Parcelle cadastrale introuvable.', adresseBan: g.label, maj: nowISO() };
  const pr = ft.properties || {};
  const idu = String(pr.idu || ((pr.code_dep || '') + (pr.code_com || '') + (pr.com_abs || '000') + (pr.section || '') + (pr.numero || '')));
  const xs = []; const ys = [];
  JSON.stringify(ft.geometry.coordinates).replace(/\[(-?[\d.]+),(-?[\d.]+)\]/g, (m, x, y) => { xs.push(+x); ys.push(+y); return m; });
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => v.toFixed(6)).join(',');
  const muts = await dvfCerema({ code_insee: g.insee, in_bbox: bbox }, 4, { geo: true, budgetMs: 25000 });
  const depuis = (b.mandatOrigine && b.mandatOrigine.debut) || '';
  const surf = Number(b.surface) || 0;
  let derniere = '';
  const ventes = [];
  muts.forEach((x) => {
    const date = String(x.datemut || '');
    if (date > derniere) derniere = date;
    if (!(x.l_idpar || []).some((p) => String(p) === idu)) return;
    if (!/vente/i.test(x.libnatmut || '')) return;
    if (!typeDvfCompatible(b.type, x.libtypbien)) return;
    const sb = Number(x.sbati) || 0;
    const prix = Math.round(Number(x.valeurfonc) || 0);
    // Prix symbolique (cession familiale, euro symbolique) : écarté.
    if (prix < 20000 || (sb && prix / sb < 1000)) return;
    if (!(surf && sb && Math.abs(sb - surf) <= Math.max(4, surf * 0.12))) return;
    ventes.push({ date: date, prix: prix, surface: sb, type: String(x.libtypbien || '').toLowerCase(), apresMandat: !!(depuis && date >= depuis) });
  });
  ventes.sort((a, z) => z.date.localeCompare(a.date));
  const apres = ventes.filter((v) => v.apresMandat);
  return {
    statut: apres.length ? 'vendu_probable' : 'pas_de_vente', maj: nowISO(), methode: DVF_METHODE,
    adresseBan: g.label, parcelle: idu, ventes: ventes.slice(0, 6), mutationsLues: muts.length, donneesJusquau: derniere,
    // DVF est publié avec plusieurs mois de retard : une vente récente n'y figure pas encore.
    couvreMandat: !!(depuis && derniere && derniere >= depuis)
  };
}
const PORTAILS_VERIF = MARKET_PLATEFORMES.map((p) => p.domaine).concat(['logic-immo.com', 'meilleursagents.com', 'barnes-international.com', 'daniel-feau.com', 'kretzrealestate.com', 'proprietesparisiennes.com', 'immobilier.notaires.fr']);
async function verifierEnLigne(b) {
  const key = process.env.EXA_API_KEY;
  const cp = String(b.codePostal || '');
  const arr = /^750(\d\d)$/.test(cp) ? Number(cp.slice(3)) : 0;
  const surfR = Math.round(Number(b.surface) || 0);
  const recherches = MARKET_PLATEFORMES.map((p) => {
    const q = 'site:' + p.domaine + ' ' + (b.type || '') + ' ' + (surfR ? surfR + ' m² ' : '') + (b.adresse ? '"' + String(b.adresse).replace(/^\d+\s*(bis|ter)?\s*/i, '') + '" ' : '') + (cp || b.ville || '');
    return { plateforme: p.label, url: 'https://www.google.com/search?q=' + encodeURIComponent(q.trim()) };
  });
  if (!key) return { statut: 'indisponible', raison: 'Clé EXA_API_KEY absente', recherches: recherches, maj: nowISO() };
  const extrait = String(b.description || '').replace(/\s+/g, ' ').slice(0, 220);
  const query = [b.type, b.pieces ? b.pieces + ' pièces' : '', surfR ? surfR + ' m²' : '', arr ? 'Paris ' + arr + 'e' : (b.ville || ''), extrait].filter(Boolean).join(' ');
  const r = await fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ query: query, numResults: 8, includeDomains: PORTAILS_VERIF, contents: { text: { maxCharacters: 2500 } } }) });
  if (r.status === 429 || r.status === 402) throw Object.assign(new Error('quota Exa'), { quota: true });
  const dj = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Exa ' + r.status);
  const prix = Number((b.details && b.details.prixAffiche) || 0) || Number(b.prix) || 0;
  const rue = radarNorm(String(b.adresse || '').replace(/^\d+\s*(bis|ter)?\s*/i, '')).replace(/^(rue|avenue|boulevard|bd|place|quai|square|villa|impasse|allee|cite|passage)\s+(de la |de l'|du |des |de )?/, '');
  const liens = (dj.results || []).map((x) => {
    const t = radarNorm((x.title || '') + ' ' + (x.text || '') + ' ' + (x.url || ''));
    const plat = (MARKET_PLATEFORMES.find((p) => String(x.url || '').indexOf(p.domaine) > -1) || {}).label || String(x.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    const surfOk = surfR > 0 && [surfR, surfR - 1, surfR + 1].some((n) => new RegExp('\\b' + n + '([.,]\\d+)?\\s*m', 'i').test(t));
    const lieuOk = (cp && t.indexOf(cp) > -1) || (arr && new RegExp('paris\\s*' + arr + '(e|eme|er)?\\b|\\b' + arr + '(e|eme|er)\\s*arr').test(t)) || (rue.length > 4 && t.indexOf(rue) > -1);
    const rueOk = rue.length > 4 && t.indexOf(rue) > -1;
    const nums = (t.match(/\d[\d\s.]{4,10}\s*(€|eur)/g) || []).map((m) => Number(m.replace(/[^\d]/g, '')));
    const prixOk = prix > 0 && nums.some((n) => Math.abs(n - prix) / prix < 0.08);
    const score = (surfOk ? 2 : 0) + (lieuOk ? 1 : 0) + (prixOk ? 2 : 0) + (rueOk ? 1 : 0);
    return { url: x.url, titre: String(x.title || '').slice(0, 140), plateforme: plat, date: x.publishedDate || '', score: score, surface: surfOk, lieu: lieuOk, prix: prixOk };
  }).filter((l) => l.lieu && l.score >= 3).sort((a, z) => z.score - a.score).slice(0, 5);
  const fort = liens.some((l) => l.surface && l.lieu && (l.prix || l.score >= 4));
  return { statut: fort ? 'en_ligne' : liens.length ? 'a_verifier' : 'non_trouve', liens: liens, recherches: recherches, maj: nowISO() };
}
async function verifTraiter() {
  if (VERIF.enCours) return;
  while (VERIF.file.length) {
    const id = VERIF.file.shift();
    VERIF.enCours = id;
    try {
      const b0 = readDb().biens.find((x) => x.id === id);
      if (!b0) continue;
      const copie = JSON.parse(JSON.stringify(b0));
      const res = {};
      try { res.dvf = await verifierDvf(copie); } catch (e) { res.dvf = { statut: 'erreur', raison: String(e.message || e).slice(0, 120), maj: nowISO() }; }
      if (VERIF.seulDvf[id] && b0.verifs && b0.verifs.enLigne) res.enLigne = b0.verifs.enLigne;
      else { try { res.enLigne = await verifierEnLigne(copie); } catch (e) { res.enLigne = { statut: e.quota ? 'quota' : 'erreur', raison: String(e.message || e).slice(0, 120), maj: nowISO() }; } }
      delete VERIF.seulDvf[id];
      const db = readDb();
      const b = db.biens.find((x) => x.id === id);
      if (b) {
        if (res.dvf && res.dvf.adresseBan && copie.lat) { b.lat = copie.lat; b.lon = copie.lon; }
        if (!b.insee && copie.insee) b.insee = copie.insee;
        b.verifs = res;
        writeDb(db);
      }
      VERIF.faits++;
      if (res.dvf.statut === 'erreur' || res.enLigne.statut === 'erreur') VERIF.erreurs++;
      if (res.enLigne.statut === 'quota') { VERIF.file = []; VERIF.arret = 'Crédits Exa épuisés'; }
    } catch (e) { VERIF.erreurs++; }
    await new Promise((r) => setTimeout(r, 1200));
  }
  VERIF.enCours = null;
}
app.post('/api/biens/verifier', requireAdmin, (req, res) => {
  const body = req.body || {};
  const db = readDb();
  let ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (body.lot) ids = db.biens.filter((b) => b.importLot === String(body.lot) && (body.forcer || body.seulDvf || !b.verifs)).map((b) => b.id);
  if (body.seulDvf) ids.forEach((id) => { VERIF.seulDvf[id] = true; });
  ids = ids.filter((id) => db.biens.some((b) => b.id === id) && VERIF.file.indexOf(id) === -1 && VERIF.enCours !== id);
  VERIF.file = VERIF.file.concat(ids);
  if (!VERIF.debut || (!VERIF.enCours && !VERIF.file.length)) { VERIF.debut = nowISO(); VERIF.faits = 0; VERIF.erreurs = 0; }
  VERIF.arret = null;
  setImmediate(() => verifTraiter().catch(() => { VERIF.enCours = null; }));
  res.json({ ok: true, ajoutes: ids.length, enAttente: VERIF.file.length });
});
// Refaire le contrôle DVF (à l'adresse exacte) des biens importés encore
// vérifiés avec l'ancienne méthode. La recherche en ligne est conservée.
setTimeout(() => {
  try {
    const db = readDb();
    db.migrations = db.migrations || {};
    // À chaque démarrage : reprend là où un redéploiement a interrompu la file.
    const ids = db.biens.filter((b) => b.importLot && b.verifs && b.verifs.dvf && b.verifs.dvf.methode !== DVF_METHODE).map((b) => b.id);
    if (!ids.length) return;
    ids.forEach((id) => { VERIF.seulDvf[id] = true; });
    VERIF.file = VERIF.file.concat(ids.filter((id) => VERIF.file.indexOf(id) === -1));
    VERIF.debut = nowISO(); VERIF.faits = 0; VERIF.erreurs = 0;
    console.log('[dvf] contrôle à l’adresse exacte relancé pour ' + ids.length + ' bien(s)');
    verifTraiter().catch(() => { VERIF.enCours = null; });
  } catch (e) { console.error('[dvf] relance', e.message); }
}, 15000);
app.get('/api/biens/:id/verifs', requireAdmin, (req, res) => {
  const b = readDb().biens.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bien introuvable' });
  res.json({ verifs: b.verifs || null, enFile: VERIF.enCours === b.id || VERIF.file.indexOf(b.id) > -1 });
});
app.get('/api/biens/verifier', requireAdmin, (req, res) => {
  res.json({ enCours: !!VERIF.enCours, enAttente: VERIF.file.length, faits: VERIF.faits, erreurs: VERIF.erreurs, debut: VERIF.debut, arret: VERIF.arret || null });
});

// ---- Bot de suivi de l'agence d'origine (gratuit, sans clé) ----
// Le site De Ferla publie toutes ses annonces dans un flux public (une seule
// requête par jour). Pour chaque bien importé, on regarde si sa référence y
// est encore : disparue = vendu, sous compromis ou mandat terminé, le bon
// moment pour rappeler le vendeur. Une baisse de prix est aussi relevée.
const SUIVI_FLUX = { 'De Ferla': process.env.SUIVI_DEFERLA_URL || 'https://immobilier.altelis.com/deferla' };
const SUIVI = { enCours: false, derniere: null, resultat: null };
async function suiviAgenceLancer(origine) {
  if (SUIVI.enCours) return SUIVI.resultat;
  SUIVI.enCours = true;
  try {
    const r = await fetch(SUIVI_FLUX['De Ferla'], { headers: { Accept: 'application/json', 'User-Agent': 'Seecret/1.0 (suivi des mandats)' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('flux ' + r.status);
    const liste = await r.json();
    if (!Array.isArray(liste) || liste.length < 20) throw new Error('flux vide ou incomplet (' + (Array.isArray(liste) ? liste.length : 0) + ')');
    const parRef = new Map(liste.filter((x) => x && x.Bien_Reference).map((x) => [String(x.Bien_Reference), x]));
    const db = readDb();
    const auj = nowISO();
    const res = { verifies: 0, enLigne: 0, retires: 0, nouveauxRetraits: 0, baisses: 0, retoursEnLigne: 0, annoncesAgence: liste.length, le: auj, origine: origine || 'auto' };
    db.biens.forEach((b) => {
      if (!b.refAgence || !b.mandatOrigine || !/ferla/i.test(b.mandatOrigine.agence || b.source || '')) return;
      res.verifies++;
      const s0 = b.suiviAgence || null;
      const x = parRef.get(String(b.refAgence));
      const s = Object.assign({ historique: [] }, s0 || {});
      s.verifieLe = auj;
      if (x) {
        res.enLigne++;
        const prix = Number(x.Bien_Prix) || 0;
        if (s.statut === 'retire') { s.historique.push({ date: auj, evenement: 'de nouveau en ligne' }); res.retoursEnLigne++; }
        const ancien = s.prix || Number(b.details && b.details.prixAffiche) || 0;
        if (prix && ancien && prix < ancien - 500) {
          s.historique.push({ date: auj, evenement: 'baisse de prix', ancien: ancien, nouveau: prix });
          s.derniereBaisse = { date: auj, ancien: ancien, nouveau: prix };
          res.baisses++;
          if (b.leadId) logActivite(db, { leadId: b.leadId, bienId: b.id, type: 'baisse_prix_agence', auteur: 'Bot de suivi', detail: 'Prix sur le site De Ferla : ' + ancien + ' € → ' + prix + ' €' });
        } else if (prix && ancien && prix > ancien + 500) {
          s.historique.push({ date: auj, evenement: 'hausse de prix', ancien: ancien, nouveau: prix });
        }
        s.statut = 'en_ligne'; s.prix = prix || s.prix || 0; s.libelle = String(x['Bien_Libellés'] || '').slice(0, 160);
        s.vuLe = auj; delete s.retireLe; delete s.retireAvant;
      } else {
        res.retires++;
        if (s.statut !== 'retire') {
          res.nouveauxRetraits++;
          s.statut = 'retire';
          // Premier passage du bot : on sait seulement que l'annonce a disparu
          // entre l'export du fichier et aujourd'hui.
          if (!s0) { s.retireAvant = auj; } else { s.retireLe = auj; s.historique.push({ date: auj, evenement: 'retirée du site' }); }
          if (s0 && b.leadId) logActivite(db, { leadId: b.leadId, bienId: b.id, type: 'annonce_retiree_agence', auteur: 'Bot de suivi', detail: 'Annonce retirée du site De Ferla : vendu, sous compromis ou mandat terminé ?' });
        }
      }
      s.historique = s.historique.slice(-20);
      b.suiviAgence = s;
    });
    db.suiviAgence = res;
    writeDb(db);
    SUIVI.resultat = res; SUIVI.derniere = auj;
    console.log('[suivi] ' + res.verifies + ' biens : ' + res.enLigne + ' en ligne, ' + res.retires + ' retirés (' + res.nouveauxRetraits + ' nouveaux), ' + res.baisses + ' baisse(s)');
    return res;
  } catch (e) {
    SUIVI.resultat = { erreur: String(e.message || e).slice(0, 160), le: nowISO() };
    console.error('[suivi] ' + SUIVI.resultat.erreur);
    return SUIVI.resultat;
  } finally { SUIVI.enCours = false; }
}
// Une fois par jour (premier passage une minute après le démarrage si le dernier date de plus de 20 h).
setTimeout(() => {
  const tour = () => {
    try {
      const d = (readDb().suiviAgence || {}).le;
      if (!d || Date.now() - new Date(d).getTime() > 20 * 3600 * 1000) suiviAgenceLancer('auto');
    } catch (e) { /* prochain tour */ }
  };
  tour();
  setInterval(tour, 3600 * 1000);
}, 60000);
app.post('/api/biens/suivi-agence', requireAdmin, async (req, res) => {
  res.json(Object.assign({ ok: true }, await suiviAgenceLancer('manuel')));
});
app.get('/api/biens/suivi-agence', requireAdmin, (req, res) => {
  res.json({ ok: true, enCours: SUIVI.enCours, dernier: readDb().suiviAgence || null });
});

// ---- Sauvegarde complète du serveur (super-admin) ----
// Archive .tar.gz envoyée en flux : la base (copie cohérente faite dans le
// dossier temporaire du conteneur, pas sur le volume) + toutes les photos et
// documents. Les bases Radar / propriétaires (rechargeables) sont exclues.
function tarEntete(nom, taille, mtime) {
  const h = Buffer.alloc(512, 0);
  const ecrire = (txt, off, len) => h.write(String(txt).slice(0, len), off, len, 'utf8');
  ecrire(nom, 0, 100);
  ecrire('0000644\0', 100, 8); ecrire('0000000\0', 108, 8); ecrire('0000000\0', 116, 8);
  ecrire(taille.toString(8).padStart(11, '0') + '\0', 124, 12);
  ecrire(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  ecrire('        ', 148, 8); ecrire('0', 156, 1); ecrire('ustar\0', 257, 6); ecrire('00', 263, 2);
  let somme = 0; for (let i = 0; i < 512; i++) somme += h[i];
  ecrire(somme.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
function listerFichiers(dossier, prefixe) {
  const out = [];
  if (!fs.existsSync(dossier)) return out;
  fs.readdirSync(dossier, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...listerFichiers(p, prefixe + e.name + '/'));
    else if (e.isFile()) out.push({ chemin: p, nom: prefixe + e.name });
  });
  return out;
}
app.get('/api/admin/sauvegarde', requireSuperadmin, async (req, res) => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sauv-'));
  const jour = new Date().toISOString().slice(0, 10);
  try {
    const fichiers = [];
    const base = path.join(DATA_DIR, 'seecret.db');
    if (fs.existsSync(base)) {
      const Database = require('better-sqlite3');
      const src = new Database(base, { readonly: true });
      await src.backup(path.join(tmp, 'seecret.db'));
      src.close();
      fichiers.push({ chemin: path.join(tmp, 'seecret.db'), nom: 'seecret.db' });
    } else if (fs.existsSync(path.join(DATA_DIR, 'data.json'))) {
      fichiers.push({ chemin: path.join(DATA_DIR, 'data.json'), nom: 'data.json' });
    }
    fs.writeFileSync(path.join(tmp, 'LISEZMOI.txt'), 'Sauvegarde Seecret du ' + jour + '\n\nseecret.db : toute la base (leads, biens, recherches, messages, activité…), lisible avec n’importe quel outil SQLite.\nuploads/ : photos des biens, vidéos et documents des membres.\n\nPour restaurer : remettre ces fichiers dans le dossier de données (DATA_DIR) du serveur.\nCe fichier contient des données personnelles : à conserver en lieu sûr, jamais sur GitHub.\n');
    fichiers.push({ chemin: path.join(tmp, 'LISEZMOI.txt'), nom: 'LISEZMOI.txt' });
    fichiers.push(...listerFichiers(UPLOADS_DIR, 'uploads/'));
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="seecret-sauvegarde-' + jour + '.tar.gz"');
    const gz = require('zlib').createGzip({ level: 6 });
    gz.pipe(res);
    const ecrire = (buf) => new Promise((ok) => { if (gz.write(buf)) ok(); else gz.once('drain', ok); });
    for (const f of fichiers) {
      let st; try { st = fs.statSync(f.chemin); } catch (e) { continue; }
      const nom = f.nom.length > 99 ? f.nom.slice(0, 60) + '…' + f.nom.slice(-35) : f.nom;
      await ecrire(tarEntete(nom, st.size, st.mtimeMs));
      await new Promise((ok, ko) => {
        const rs = fs.createReadStream(f.chemin);
        rs.on('data', (c) => { if (!gz.write(c)) { rs.pause(); gz.once('drain', () => rs.resume()); } });
        rs.on('end', ok); rs.on('error', ko);
      });
      const reste = st.size % 512;
      if (reste) await ecrire(Buffer.alloc(512 - reste, 0));
    }
    await ecrire(Buffer.alloc(1024, 0));
    gz.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Sauvegarde impossible : ' + e.message });
    else res.end();
  } finally {
    res.on('finish', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* rien */ } });
  }
});

// ---- Gestion des comptes agents (super-admin uniquement) ----
// Au 18/11/2026, aucun agent n'est encore employé (usage solo) — ces routes
// posent les fondations pour plus tard sans rien changer à l'usage actuel :
// seul un compte dont le rôle est explicitement 'agent' ou 'admin' est
// concerné par le filtrage par agentId mis en place ci-dessus.
app.get('/api/agents', requireSuperadmin, (req, res) => {
  const db = readDb();
  const agents = db.leads.filter((l) => estAgentSimple(l.role) || roleOf(l) === 'superadmin').map((l) => ({
    id: l.id, prenom: l.prenom || '', nom: l.nom || '', email: l.email || '',
    role: roleOf(l), cree: l.cree || null, derniereConnexion: l.derniereConnexion || null,
    actif: !!l.derniereConnexion || roleOf(l) === 'superadmin',
    nbClients: db.leads.filter((c) => !estAgentSimple(c.role) && roleOf(c) !== 'superadmin' && (c.agentId || c.creePar) === l.id).length
  }));
  res.json({ ok: true, agents: agents });
});

app.post('/api/agents/inviter', requireSuperadmin, (req, res) => {
  const db = readDb();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const prenom = String((req.body && req.body.prenom) || '').trim();
  const nom = String((req.body && req.body.nom) || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return res.status(400).json({ error: 'Adresse email invalide' });
  if (!prenom && !nom) return res.status(400).json({ error: 'Le nom de l’agent est nécessaire' });
  let agent = db.leads.find((l) => (l.email || '').toLowerCase() === email);
  if (agent) {
    if (estAgentSimple(agent.role)) return res.status(409).json({ error: 'Cet agent a déjà un compte' });
    agent.role = 'agent';
    agent.statut = 'accepte';
    if (prenom) agent.prenom = prenom;
    if (nom) agent.nom = nom;
  } else {
    agent = {
      id: uid('l'), prenom: prenom, nom: nom, email: email, tel: '', ville: '',
      projet: 'agent', role: 'agent', statut: 'accepte', source: 'Invitation agence',
      quartiers: [], cree: nowISO()
    };
    db.leads.push(agent);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.magicLinks.push({
    id: sha256(token), codeHash: sha256(code), leadId: agent.id, email: email,
    cree: nowISO(), expire: Date.now() + MAGIC_TTL, utilise: false, codeUtilise: false
  });
  writeDb(db);
  const lien = originOf(req) + '/espace.html?token=' + token;
  console.log('[TEST] Invitation agent ' + email + ' → code: ' + code + ' · lien: ' + lien);
  if (mailer) {
    mailer.sendMail({
      from: '"Seecret" <' + FROM_EMAIL + '>', to: email,
      subject: 'Votre accès agent Seecret', html: emailHTML(prenom, code, lien)
    }).catch((err) => console.error('[email] invitation agent échouée :', err.message));
  } else {
    console.warn('[email] SMTP non configuré — aucun email d’invitation envoyé pour ' + email + '.');
  }
  res.json({ ok: true, agent: { id: agent.id, prenom: agent.prenom, nom: agent.nom, email: agent.email, role: agent.role } });
});

// Purge des données de démonstration (clients/biens/demandes/offres/tâches/
// activités marqués `demo: true` par seedDemoData) — à utiliser une fois que
// la plateforme a de vraies candidatures et que la démo n'est plus utile.
// Réservé au super-admin ; n'affecte jamais une donnée réelle.
app.delete('/api/admin/demo', requireSuperadmin, (req, res) => {
  const db = readDb();
  const leadIdsDemo = db.leads.filter((l) => l.demo).map((l) => l.id);
  const avant = {
    leads: db.leads.length, biens: db.biens.length, recherches: db.recherches.length,
    demandes: db.demandes.length, tasks: db.tasks.length, offres: db.offres.length, activites: db.activites.length
  };
  db.leads = db.leads.filter((l) => !l.demo);
  db.biens = db.biens.filter((b) => !b.demo);
  db.recherches = db.recherches.filter((r) => !r.demo);
  db.demandes = db.demandes.filter((d) => !d.demo);
  db.tasks = db.tasks.filter((t) => !t.demo);
  db.offres = db.offres.filter((o) => !o.demo);
  db.activites = db.activites.filter((a) => leadIdsDemo.indexOf(a.leadId) === -1);
  db.demoSeeded = true; // ne jamais re-seeder automatiquement après une purge volontaire
  writeDb(db);
  res.json({
    ok: true,
    supprimes: {
      leads: avant.leads - db.leads.length, biens: avant.biens - db.biens.length,
      recherches: avant.recherches - db.recherches.length, demandes: avant.demandes - db.demandes.length,
      tasks: avant.tasks - db.tasks.length, offres: avant.offres - db.offres.length,
      activites: avant.activites - db.activites.length
    }
  });
});

app.get('/api/leads', requireAdmin, (req, res) => {
  const db = readDb();
  const leads = leadsVisibles(req, db).map((l) => {
    const c = Object.assign({}, l);
    delete c.passkeys;
    delete c.connexions;
    c.documents = (l.documents || []).length;
    c.documentsValides = (l.documents || []).filter((d) => d.statut === 'valide').length;
    const b = db.biens.find((x) => x.leadId === l.id || (x.email || '').toLowerCase() === (l.email || '').toLowerCase());
    c.bienInfo = b ? {
      id: b.id, titre: b.titre || '', statut: b.statut || 'brouillon', prix: b.prix || 0,
      exterieur: b.exterieur || '', surfaceExterieur: b.surfaceExterieur || 0,
      photos: (b.photos || []).length
    } : null;
    return c;
  });
  res.json({ ok: true, leads: leads });
});

app.patch('/api/leads/:id/statut', requireAdmin, (req, res) => {
  const db = readDb();
  const lead = db.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  if (roleOf(req.lead) !== 'superadmin' && !leadVisibleParAgent(lead, req.lead.id)) {
    return res.status(403).json({ error: 'Ce client est attribué à un autre agent.' });
  }
  const statut = String((req.body && req.body.statut) || 'accepte');
  // Un lead ajouté par l'agence (prospect) n'a pas fait de demande d'adhésion :
  // on ne lui ouvre pas la plateforme par ce bouton.
  if (statut === 'accepte' && lead.statut === 'prospect') return res.status(409).json({ error: 'Ce lead n’a pas fait de demande d’adhésion.' });
  lead.statut = statut;
  let notif = null;
  if (statut === 'accepte') {
    logActivite(db, { leadId: lead.id, type: 'admission', auteur: 'Agent' });
    notif = notifierClient(db, {
      leadId: lead.id, email: lead.email, tel: lead.tel, prenom: lead.prenom,
      titre: 'Votre accès à Seecret est validé',
      message: 'Bonne nouvelle, votre accès a été validé par l’agence. Vous pouvez dès maintenant vous reconnecter à votre espace.',
      lien: originOf(req) + '/espace.html'
    });
  }
  writeDb(db);
  res.json({ ok: true, lead: { id: lead.id, statut: lead.statut }, notif: notif });
});

app.get('/api/leads/:id/documents', requireAdmin, (req, res) => {
  const db = readDb();
  const lead = db.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  if (roleOf(req.lead) !== 'superadmin' && !leadVisibleParAgent(lead, req.lead.id)) {
    return res.status(403).json({ error: 'Ce client est attribué à un autre agent.' });
  }
  res.json({ ok: true, documents: (lead.documents || []).slice().reverse(), types: TYPES_DOC });
});

app.patch('/api/documents/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const statut = (req.body && req.body.statut) === 'refuse' ? 'refuse' : 'valide';
  let found = null, leadFound = null;
  db.leads.forEach((l) => (l.documents || []).forEach((d) => {
    if (d.id === req.params.id) { d.statut = statut; d.valideAt = nowISO(); found = d; leadFound = l; }
  }));
  if (!found) return res.status(404).json({ error: 'Document introuvable' });
  let notif = null;
  if (leadFound) {
    logActivite(db, { leadId: leadFound.id, type: statut === 'valide' ? 'document_valide' : 'document_refuse', auteur: 'Agent' });
    const libelle = TYPES_DOC[found.type] || found.type || 'document';
    notif = notifierClient(db, {
      leadId: leadFound.id, email: leadFound.email, tel: leadFound.tel, prenom: leadFound.prenom,
      titre: statut === 'valide' ? 'Votre pièce a été validée' : 'Votre pièce a été refusée',
      message: statut === 'valide'
        ? 'Votre pièce (' + libelle + ') a été validée par l’agence.'
        : 'Votre pièce (' + libelle + ') a été refusée par l’agence. Merci d’en envoyer une nouvelle depuis votre espace.',
      lien: originOf(req) + '/espace.html'
    });
  }
  writeDb(db);
  res.json({ ok: true, document: found, notif: notif });
});

// ---- Workflow de validation : documents -> tâche -> valider/refuser ----
app.post('/api/adhesion/submit', requireAuth, (req, res) => {
  const lead = req.lead;
  const docs = (lead.documents || []).filter((d) => d.statut !== 'refuse');
  const db = req.db;
  const docSnap = docs.map((d) => ({ id: d.id, type: d.type, fichier: d.fichier, nom: d.nom, statut: d.statut }));
  let tache = db.tasks.find((t) => t.leadId === lead.id && t.statut === 'en_attente');
  if (!tache) {
    tache = { id: uid('t'), type: 'verification', leadId: lead.id, email: lead.email, nom: nomComplet(lead), documents: docSnap, statut: 'en_attente', cree: nowISO(), traiteeAt: null };
    db.tasks.push(tache);
  } else {
    tache.documents = docSnap;
    tache.cree = nowISO();
  }
  writeDb(db);
  res.json({ ok: true, taskId: tache.id });
});

app.get('/api/tasks', requireAdmin, (req, res) => {
  const db = readDb();
  const tasks = db.tasks.map((t) => {
    const lead = db.leads.find((l) => l.id === t.leadId);
    return Object.assign({}, t, { prenom: lead ? lead.prenom : '', nomFamille: lead ? lead.nom : '', leadStatut: lead ? lead.statut : null });
  });
  res.json({ ok: true, tasks: tasks });
});

app.post('/api/tasks/:id/valider', requireAdmin, (req, res) => {
  const db = readDb();
  const tache = db.tasks.find((t) => t.id === req.params.id);
  if (!tache) return res.status(404).json({ error: 'Tâche introuvable' });
  const lead = db.leads.find((l) => l.id === tache.leadId);
  let notif = null;
  if (lead) {
    lead.statut = 'accepte';
    (lead.documents || []).forEach((d) => { d.statut = 'valide'; d.valideAt = nowISO(); });
    logActivite(db, { leadId: lead.id, type: 'admission', auteur: 'Agent' });
    notif = notifierClient(db, {
      leadId: lead.id, email: lead.email, tel: lead.tel, prenom: lead.prenom,
      titre: 'Votre dossier a été vérifié',
      message: 'Bonne nouvelle, vous avez bien été accepté(e) : votre dossier a été vérifié et votre accès à Seecret est confirmé.',
      lien: originOf(req) + '/espace.html'
    });
  }
  tache.statut = 'validee';
  tache.traiteeAt = nowISO();
  writeDb(db);
  res.json({ ok: true, notif: notif });
});

app.post('/api/tasks/:id/refuser', requireAdmin, (req, res) => {
  const db = readDb();
  const tache = db.tasks.find((t) => t.id === req.params.id);
  if (!tache) return res.status(404).json({ error: 'Tâche introuvable' });
  const lead = db.leads.find((l) => l.id === tache.leadId);
  let notif = null;
  if (lead) {
    notif = notifierClient(db, {
      leadId: lead.id, email: lead.email, tel: lead.tel, prenom: lead.prenom,
      titre: 'Votre dossier n’a pas été validé',
      message: 'Votre dossier n’a pas pu être validé en l’état. L’agence revient vers vous pour les pièces manquantes ou à corriger.',
      lien: originOf(req) + '/espace.html'
    });
  }
  tache.statut = 'refusee';
  tache.traiteeAt = nowISO();
  writeDb(db);
  res.json({ ok: true, notif: notif });
});

app.get('/api/demandes', requireAdmin, (req, res) => {
  const db = readDb();
  const demandes = db.demandes.map((d) => {
    if (d.type !== 'visite') return d;
    const actif = d.leadId ? mandatApplicable(db, d.leadId) : null;
    const enCours = !actif && d.leadId ? mandatEnCours(db, d.leadId) : null;
    return Object.assign({}, d, {
      mandat: resumeMandat(actif || enCours),
      visitePossible: mandatPermetVisite(actif),
      creneauxLisibles: (d.creneaux || []).map(creneauLisible)
    });
  });
  res.json({ ok: true, demandes: demandes, agenceManquants: agenceManquants() });
});

app.patch('/api/demandes/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const d = db.demandes.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  d.statut = 'traitee';
  d.traiteeAt = nowISO();
  const lead = db.leads.find((l) => l.id === d.leadId || (l.email || '').toLowerCase() === (d.email || '').toLowerCase());
  let notif = null;
  if (d.type === 'statut' && d.bienId) {
    const b = db.biens.find((x) => x.id === d.bienId);
    if (b) {
      b.statut = (req.body && req.body.action) === 'vente' ? 'vendu' : 'ouvert';
      if (b.statut === 'ouvert') b.ouvertLe = nowISO();
      b.statutDemande = null;
    }
    notif = notifierClient(db, {
      leadId: lead ? lead.id : (d.leadId || null), email: d.email, tel: lead ? lead.tel : '', prenom: (lead && lead.prenom) || (d.nom || '').split(' ')[0] || '',
      titre: 'Votre demande est validée',
      message: 'Votre demande de changement de statut a été validée par l’agence.',
      lien: originOf(req) + '/espace.html'
    });
  }
  writeDb(db);
  res.json({ ok: true, notif: notif });
});

app.post('/api/demandes/:id/decision', requireAdmin, async (req, res) => {
  const db = readDb();
  const d = db.demandes.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  const decision = (req.body && req.body.decision) === 'refuser' ? 'refuser' : (req.body && req.body.decision) === 'suspendre' ? 'suspendre' : 'valider';
  const lead = db.leads.find((l) => l.id === d.leadId || (l.email || '').toLowerCase() === (d.email || '').toLowerCase());
  const prenom = (lead && lead.prenom) || (d.nom || '').split(' ')[0] || '';
  const tel = lead ? (lead.tel || '') : '';

  const tache = db.tasks.find((t) => t.demandeId === d.id && t.statut === 'en_attente');
  if (tache) { tache.statut = 'terminee'; tache.traiteeAt = nowISO(); }

  let lien = originOf(req) + '/espace.html';
  let emailEnvoye = false, emailErreur = '';
  if (decision === 'refuser' && d.type === 'candidature') {
    d.statut = 'refusee';
    d.traiteeAt = nowISO();
    // Candidature refusée : la fiche lead et ses recherches / biens partent aux
    // Archivés (rien n'est supprimé, tout reste restaurable) pour ne pas
    // encombrer le CRM.
    const auteur = nomComplet(req.lead) || 'Agent';
    if (lead) {
      lead.statut = 'refuse';
      const archiver = (k, f) => {
        if (f.archive) return;
        f.archive = true; f.archiveLe = nowISO(); f.archivePar = auteur; f.archiveMotif = 'Candidature refusée';
        logActivite(db, { leadId: lead.id, bienId: k === 'bien' ? f.id : null, rechercheId: k === 'recherche' ? f.id : null, type: 'archive', auteur: auteur, detail: 'Candidature refusée' });
      };
      archiver('lead', lead);
      db.recherches.filter((r) => r.clientId === lead.id || r.leadId === lead.id).forEach((r) => archiver('recherche', r));
      db.biens.filter((b) => b.leadId === lead.id).forEach((b) => archiver('bien', b));
    }
    const notif = notifierClient(db, {
      leadId: lead ? lead.id : (d.leadId || null), email: d.email, tel: tel, prenom: prenom,
      titre: 'Votre candidature au club Seecret',
      message: 'Merci sincèrement pour l’intérêt que vous portez à Seecret et pour le temps consacré à votre candidature.\n\n' +
        'Le club réunit volontairement un cercle restreint de membres, et nous ne sommes malheureusement pas en mesure de donner une suite favorable à votre demande pour le moment.\n\n' +
        'Cette décision ne dit rien de la qualité de votre projet : nos critères évoluent avec les biens que nous accompagnons, et nous serions heureux d’étudier à nouveau votre candidature à l’avenir.\n\n' +
        'Nous vous souhaitons pleine réussite dans votre projet immobilier.',
      lien: null
    });
    writeDb(db);
    return res.json({ ok: true, decision: 'refuser', lien: '', tel: tel, prenom: prenom, notif: notif, archive: !!lead });
  }

  if (decision === 'refuser') {
    d.statut = 'refusee';
    d.traiteeAt = nowISO();
    const notif = notifierClient(db, {
      leadId: lead ? lead.id : (d.leadId || null), email: d.email, tel: tel, prenom: prenom,
      titre: 'Votre demande n’a pas été retenue',
      message: 'Votre demande n’a malheureusement pas été retenue par l’agence.',
      lien: lien
    });
    writeDb(db);
    return res.json({ ok: true, decision: 'refuser', lien: lien, tel: tel, prenom: prenom, notif: notif });
  }

  if (decision === 'suspendre') {
    d.statut = 'suspendue';
    d.traiteeAt = nowISO();
    const motif = String((req.body && req.body.motif) || '').trim();
    if (motif) d.motif = motif;
    if (lead) {
      lead.statut = 'suspendu';
      lead.timeline = lead.timeline || [];
      lead.timeline.push({ at: nowISO(), type: 'suspension', motif: motif || 'Adhésion suspendue' });
    }
    const notif = notifierClient(db, {
      leadId: lead ? lead.id : null, email: d.email, tel: tel, prenom: prenom,
      titre: 'Votre adhésion Seecret est suspendue',
      message: 'Votre adhésion a été suspendue par l’agence.' + (motif ? ' Motif : ' + motif + '.' : ''),
      lien: lien
    });
    writeDb(db);
    return res.json({ ok: true, decision: 'suspendre', lien: lien, tel: tel, prenom: prenom, notif: notif });
  }

  if (d.type === 'visite') {
    const rdv = (req.body && req.body.rdv) || {};
    const date = String(rdv.date || ''), heure = String(rdv.heure || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) return res.status(400).json({ error: 'Indiquez la date et l’heure de la visite.' });
    const mandat = lead ? mandatApplicable(db, lead.id) : null;
    const autorise = mandatPermetVisite(mandat, date + 'T' + heure + ':00+01:00');
    if (!autorise.ok) return res.status(409).json({ error: autorise.raison });
    const bienVisite = db.biens.find((x) => x.id === d.bienId);
    if (!bienVisite) return res.status(404).json({ error: 'Bien introuvable' });
    if (!String(bienVisite.adresse || '').trim()) return res.status(409).json({ error: 'L’adresse du bien n’est pas renseignée dans le CRM.' });
    const nettoie = (x) => String(x || '').replace(/[<>]/g, '').trim();
    const adresseRdv = [nettoie(bienVisite.adresse), [nettoie(bienVisite.codePostal), nettoie(bienVisite.ville)].filter(Boolean).join(' ')].filter(Boolean).join(', ') + (bienVisite.etage ? ' (étage ' + nettoie(bienVisite.etage) + ')' : '');
    const quand = creneauLisible(date + 'T' + heure);
    d.statut = 'traitee';
    d.traiteeAt = nowISO();
    d.rdv = { date: date, heure: heure, confirmeLe: nowISO(), mandatId: mandat.id };
    const notifVisite = notifierClient(db, {
      leadId: lead ? lead.id : null, email: d.email, tel: tel, prenom: prenom,
      titre: 'Votre visite est confirmée',
      message: 'Votre visite est confirmée le ' + quand + '. Adresse du rendez-vous : ' + adresseRdv + '. Cette adresse est confidentielle (mandat de recherche n° ' + mandat.numero + ') : merci de ne pas la communiquer.',
      lien: lien
    });
    logActivite(db, { leadId: lead ? lead.id : null, bienId: d.bienId, type: 'visite_confirmee', auteur: 'Agent' });
    writeDb(db);
    return res.json({ ok: true, decision: 'valider', rdv: d.rdv, tel: tel, prenom: prenom, notif: notifVisite });
  }

  d.statut = 'traitee';
  d.traiteeAt = nowISO();

  // Titre/message par défaut : chaque type de demande déclenche la même
  // notification (email + espace membre + wa.me), avec un libellé adapté.
  let titreNotif = 'Votre demande a été validée';
  let messageNotif = 'Votre demande a été validée par l’agence.';
  let emailDejaEnvoye = false;

  if (d.type === 'candidature') {
    const token = crypto.randomBytes(32).toString('hex');
    db.magicLinks.push({ id: sha256(token), codeHash: sha256(crypto.randomBytes(16).toString('hex')), leadId: lead ? lead.id : null, email: d.email, cree: nowISO(), expire: Date.now() + MAGIC_TTL, utilise: false, codeUtilise: false });
    if (lead) {
      lead.statut = 'accepte';
      logActivite(db, { leadId: lead.id, type: 'admission', auteur: 'Agent' });
      // Fiches créées selon le parcours rempli : un bien pour un vendeur, une
      // recherche pour un acquéreur (les deux si mixte). Les fiches sont reconstruites depuis le dossier de candidature (tout ce
      // que le candidat a saisi), puis complètent celles qui existent déjà sans
      // écraser ce que l'agence a modifié entre-temps.
      const frais = d.dossier ? decoupe(d.dossier) : null;
      if (frais) completerFiche(lead, frais.lead, ['id', 'statut', 'cree', 'role', 'source']);
      const nomLead = ((lead.prenom || '') + ' ' + (lead.nom || '')).trim();
      const vend = lead.projet === 'vendeur' || lead.projet === 'mixte' || !!lead.bienAVendre;
      const achete = lead.projet !== 'vendeur';
      if (vend) {
        let bienLead = db.biens.find((x) => x.leadId === lead.id || (lead.email && (x.email || '').toLowerCase() === (lead.email || '').toLowerCase()));
        const baseBien = (frais && frais.bien) || { id: uid('mb'), titre: '', adresse: lead.adresseBien || '', codePostal: '', ville: '', type: 'Appartement', quartier: '', transaction: 'Vente', surface: 0, pieces: 0, chambres: 0, sdb: 0, etage: '', ascenseur: false, anneeConstruction: null, etat: '', dpe: '', ges: '', exterieur: '', surfaceExterieur: 0, annexes: [], prix: 0, charges: 0, description: '', photos: [], atouts: [], exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon', statutDemande: null, suiveurs: 0, agent: DEFAULT_AGENT_NOM, cree: nowISO() };
        Object.assign(baseBien, { leadId: lead.id, email: lead.email, nom: nomLead });
        if (bienLead) completerFiche(bienLead, baseBien, ['id', 'statut', 'validation', 'cree', 'exclusivite', 'suiveurs']);
        else { bienLead = baseBien; db.biens.push(bienLead); lancerScanExclusivite(bienLead.id).catch(() => {}); }
        if (!bienLead.titre) { try { bienLead.titre = titreEditorialImport(bienLead); } catch (e) { /* titre laissé vide */ } }
      }
      if (achete) {
        let rec = db.recherches.find((x) => x.clientId === lead.id);
        const baseRec = (frais && frais.recherche) || { id: uid('r'), titre: '', types: lead.typeBien ? [lead.typeBien] : [], type: lead.typeBien || '', quartiers: lead.quartiers || [], prixMin: lead.budgetMin || 0, prixMax: lead.budgetMax || 0, piecesMin: lead.piecesMin || 0, surfaceMin: lead.surfaceMin || 0, surfaceMax: lead.surfaceMax || 0, delai: lead.delai || '', apport: lead.apport || 0, financement: lead.financement || '', courtier: !!lead.courtier, bienAVendre: !!lead.bienAVendre, statut: 'active', alertes: true, cree: nowISO() };
        Object.assign(baseRec, { clientId: lead.id, leadId: lead.id });
        if (!baseRec.titre) baseRec.titre = titreRecherche(baseRec) === 'Recherche' ? 'Recherche de ' + nomLead : titreRecherche(baseRec);
        if (rec) {
          if (/^Recherche( de |$)/.test(rec.titre || '')) rec.titre = '';
          completerFiche(rec, baseRec, ['id', 'statut', 'cree']);
        } else db.recherches.push(baseRec);
      }
    }
    lien = originOf(req) + '/espace.html?token=' + token;
    titreNotif = 'Félicitations, votre accès à Seecret est validé';
    messageNotif = 'Bonne nouvelle ! Votre demande a été validée par l’agence. Connectez-vous pour découvrir le marché.';
    // Email « premium » avec le lien magique (différent du template générique
    // des autres notifications) : envoyé ici, pas re-envoyé par notifierClient.
    if (mailer) {
      try {
        await mailer.sendMail({
          from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
          to: d.email,
          subject: titreNotif,
          html: emailValidationPremium(prenom, lien)
        });
        emailEnvoye = true;
        emailDejaEnvoye = true;
      } catch (err) { emailErreur = (err && err.message) || 'Erreur SMTP'; }
    }
  } else if (d.type === 'statut' && d.bienId) {
    const b = db.biens.find((x) => x.id === d.bienId);
    if (b) { b.statut = 'ouvert'; b.statutDemande = null; if (!b.ouvertLe) b.ouvertLe = nowISO(); }
    titreNotif = 'Votre demande est validée';
    messageNotif = 'Votre demande de changement de statut a été validée par l’agence.';
  } else if (d.type === 'modification') {
    if (d.bienId) {
      const b = db.biens.find((x) => x.id === d.bienId);
      if (b) {
        if (d.prix) changerPrixNet(b, d.prix, d.nom || 'Propriétaire', 'demande de modification validée');
        if (d.titre) b.titre = d.titre;
        if (d.description) b.description = d.description;
        if (d.coupDeCoeur) b.coupDeCoeur = d.coupDeCoeur;
      }
    }
    titreNotif = 'Votre modification est validée';
    messageNotif = 'Votre demande de modification a été validée par l’agence.';
  } else if (d.type === 'visite') {
    titreNotif = 'Votre visite est confirmée';
    messageNotif = 'Votre demande de visite a été confirmée par l’agence.' + (d.creneau ? ' Créneau : ' + d.creneau + '.' : '');
  }

  // Dépôt systématique dans l'espace membre ; email générique sauf pour la
  // candidature, dont l'email premium (lien magique) a déjà été envoyé ci-dessus.
  let notif;
  if (emailDejaEnvoye) {
    db.notifications.push({ id: uid('ntf'), leadId: lead ? lead.id : null, email: d.email, titre: titreNotif, message: messageNotif, lien: lien, lue: false, cree: nowISO() });
    notif = { tel: tel, prenom: prenom, message: messageNotif, lien: lien, waMessage: 'Bonjour ' + prenom + ', ' + messageNotif + ' ' + lien };
  } else {
    notif = notifierClient(db, { leadId: lead ? lead.id : null, email: d.email, tel: tel, prenom: prenom, titre: titreNotif, message: messageNotif, lien: lien });
  }

  writeDb(db);
  res.json({ ok: true, decision: 'valider', lien: lien, tel: tel, prenom: prenom, emailEnvoye: emailEnvoye, emailErreur: emailErreur, notif: notif });
});

// Renvoyer l'email d'accès (magic link) à un membre validé.
app.post('/api/demandes/:id/renvoyer', requireAdmin, async (req, res) => {
  const db = readDb();
  const d = db.demandes.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  const lead = db.leads.find((l) => l.id === d.leadId || (l.email || '').toLowerCase() === (d.email || '').toLowerCase());
  const prenom = (lead && lead.prenom) || (d.nom || '').split(' ')[0] || '';
  const token = crypto.randomBytes(32).toString('hex');
  db.magicLinks.push({ id: sha256(token), codeHash: sha256(crypto.randomBytes(16).toString('hex')), leadId: lead ? lead.id : null, email: d.email, cree: nowISO(), expire: Date.now() + MAGIC_TTL, utilise: false, codeUtilise: false });
  const lien = originOf(req) + '/espace.html?token=' + token;
  writeDb(db);
  let emailEnvoye = false, emailErreur = '';
  if (mailer) {
    try {
      await mailer.sendMail({ from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: d.email, subject: 'Félicitations, votre accès à Seecret est validé', html: emailValidationPremium(prenom, lien) });
      emailEnvoye = true;
    } catch (err) { emailErreur = (err && err.message) || 'Erreur SMTP'; }
  }
  res.json({ ok: true, emailEnvoye: emailEnvoye, emailErreur: emailErreur });
});

// Renvoyer l'email d'accès à un membre validé, identifié par son email.
app.post('/api/membres/renvoyer', requireAdmin, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email requis' });
  const db = readDb();
  const lead = db.leads.find((l) => (l.email || '').toLowerCase() === email);
  if (!lead) return res.status(404).json({ error: 'Membre introuvable sur le serveur' });
  if (lead.statut !== 'accepte') return res.status(400).json({ error: 'Ce membre n’est pas encore validé' });
  const token = crypto.randomBytes(32).toString('hex');
  db.magicLinks.push({ id: sha256(token), codeHash: sha256(crypto.randomBytes(16).toString('hex')), leadId: lead.id, email: lead.email, cree: nowISO(), expire: Date.now() + MAGIC_TTL, utilise: false, codeUtilise: false });
  const lien = originOf(req) + '/espace.html?token=' + token;
  writeDb(db);
  let emailEnvoye = false, emailErreur = '';
  if (mailer) {
    try {
      await mailer.sendMail({ from: '"Bonjour Seecret" <' + FROM_EMAIL + '>', to: lead.email, subject: 'Félicitations, votre accès à Seecret est validé', html: emailValidationPremium(lead.prenom || '', lien) });
      emailEnvoye = true;
    } catch (err) { emailErreur = (err && err.message) || 'Erreur SMTP'; }
  }
  res.json({ ok: true, emailEnvoye: emailEnvoye, emailErreur: emailErreur });
});

// Photos envoyées pendant la candidature (avant création du compte).
app.post('/api/candidature/photos', upload.array('photos', 8), (req, res) => {
  const urls = (req.files || []).map((f) => '/uploads/' + f.filename);
  res.json({ ok: true, photos: urls });
});

// Erreurs d'upload (multer)
app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || /Format non autorisé/.test(err.message || ''))) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (10 Mo max)' : err.message });
  }
  next(err);
});

// ====================================================================
// Assistant CRM conversationnel (Célia) — un agent qui sort de rendez-vous lui
// parle en langage naturel (ou au micro, côté client) et elle exécute les
// actions correspondantes directement dans le CRM : créer/mettre à jour un
// lead, changer son statut pipeline, programmer un rappel daté, envoyer
// l'invitation au parcours de candidature.
//
// Deux fournisseurs d'IA supportés, au choix via la variable AI_PROVIDER :
//   - 'anthropic' (par défaut si ANTHROPIC_API_KEY est présente) : API
//                 Anthropic (Claude) — payante à l'usage (carte déjà
//                 enregistrée sur console.anthropic.com si la clé existe).
//   - 'gemini'    (par défaut sinon, si GEMINI_API_KEY est présente) : API
//                 Gemini de Google (Google AI Studio) — gratuite, sans
//                 carte bancaire, MAIS limitée à 20 requêtes/jour sur le
//                 palier gratuit.
// Quand les deux clés sont présentes, on privilégie Anthropic par défaut
// pour la CONVERSATION : ça laisse tout le quota gratuit Gemini (très
// limité) disponible pour la dictée vocale (transcrireAudioGemini,
// ci-dessous), seul des deux fournisseurs à accepter l'audio en entrée —
// au lieu que les deux usages se partagent les 20 requêtes/jour. Un
// AI_PROVIDER explicite sur Railway reste toujours prioritaire sur ce choix
// par défaut. Sans clé pour le fournisseur actif, l'endpoint répond une
// erreur claire plutôt que de planter.
// ====================================================================
const AI_PROVIDER = (process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : (process.env.GEMINI_API_KEY ? 'gemini' : 'anthropic'))).toLowerCase();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// Configurable pour les tests (pointé vers un faux serveur qui imite l'API
// Anthropic) — en production, reste toujours l'API officielle par défaut.
const ANTHROPIC_API_BASE = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Modèle gratuit (sans carte bancaire) sur Google AI Studio au moment de
// l'écriture — vérifiable/ajustable sur aistudio.google.com si Google change
// l'offre gratuite. gemini-2.5-flash a été retiré pour les nouvelles clés API
// (erreur « no longer available to new users »). On utilise l'alias
// "gemini-flash-latest", maintenu par Google et automatiquement « basculé »
// vers le dernier modèle Flash recommandé à chaque nouvelle sortie — ce qui
// évite de revivre ce genre de retrait à chaque fois que Google change de
// modèle. Compatible avec le même endpoint generateContent (function
// calling et audio compris).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Définition neutre (indépendante du fournisseur) des outils de Célia — adaptée
// au format Anthropic (`input_schema`) ou Gemini (`functionDeclarations`/
// `parameters`) selon AI_PROVIDER, voir ASSISTANT_TOOLS_ANTHROPIC/GEMINI plus bas.
const OUTILS_ASSISTANT = [
  {
    name: 'creer_ou_maj_lead',
    description: "Crée un nouveau lead (prospect/contact) dans le CRM, ou met à jour un lead existant si un lead avec le même email, téléphone ou nom complet existe déjà. À utiliser dès qu'un agent rapporte un échange ou un rendez-vous avec un propriétaire ou un contact à suivre.",
    parameters: {
      type: 'object',
      properties: {
        prenom: { type: 'string', description: 'Prénom du contact, si connu' },
        nom: { type: 'string', description: 'Nom de famille du contact (obligatoire)' },
        email: { type: 'string', description: 'Email, si connu' },
        tel: { type: 'string', description: 'Téléphone, si connu' },
        adresseBien: { type: 'string', description: 'Adresse du bien concerné, si mentionnée (ex. le logement visité)' },
        ville: { type: 'string', description: 'Ville' },
        notes: { type: 'string', description: "Résumé libre de ce qui a été dit/fait lors de l'échange (contexte, intention, détails utiles)" },
        intentionVendeur: { type: 'boolean', description: 'true si le contact souhaite vendre son bien' }
      },
      required: ['nom']
    }
  },
  {
    name: 'changer_pipeline',
    description: "Change le statut de suivi commercial (pipeline) d'un lead déjà identifié par son nom complet.",
    parameters: {
      type: 'object',
      properties: {
        nomComplet: { type: 'string', description: 'Nom complet (prénom + nom) du lead concerné' },
        statut: { type: 'string', enum: ['a_contacter', 'contacte', 'a_relancer', 'converti', 'ecarte', 'hors_cible', 'a_completer'], description: 'Nouveau statut pipeline' }
      },
      required: ['nomComplet', 'statut']
    }
  },
  {
    name: 'programmer_rappel',
    description: "Programme un rappel daté (ex. un rendez-vous, une relance à faire) lié à un lead déjà identifié par son nom complet.",
    parameters: {
      type: 'object',
      properties: {
        nomComplet: { type: 'string', description: 'Nom complet (prénom + nom) du lead concerné' },
        titre: { type: 'string', description: 'Ex. "Rendez-vous de visite", "Rappeler pour la décision"' },
        dateEcheance: { type: 'string', description: "Date au format AAAA-MM-JJ, ou AAAA-MM-JJTHH:MM si une heure est précisée" },
        notes: { type: 'string', description: 'Détails complémentaires, si utiles' }
      },
      required: ['nomComplet', 'titre', 'dateEcheance']
    }
  },
  {
    name: 'envoyer_invitation_candidature',
    description: "Envoie par email le lien vers le parcours de candidature/adhésion Seecret à un lead déjà identifié par son nom complet et qui a un email connu.",
    parameters: {
      type: 'object',
      properties: {
        nomComplet: { type: 'string', description: 'Nom complet (prénom + nom) du lead concerné' },
        messagePersonnalise: { type: 'string', description: "Courte phrase personnalisée à inclure dans l'email, en fonction du contexte de l'échange" }
      },
      required: ['nomComplet']
    }
  },
  {
    name: 'creer_bien',
    description: "Crée une fiche bien immobilier (brouillon) dans le portefeuille, à partir d'une visite ou d'un mandat rapporté par l'agent. Si le bien appartient à un lead déjà identifié, le lier via nomComplet.",
    parameters: {
      type: 'object',
      properties: {
        adresse: { type: 'string', description: 'Adresse du bien (obligatoire)' },
        ville: { type: 'string', description: 'Ville' },
        codePostal: { type: 'string', description: 'Code postal, si connu' },
        type: { type: 'string', enum: ['Appartement', 'Maison', 'Terrain', 'Local', 'Parking', 'Autre'], description: 'Type de bien' },
        transaction: { type: 'string', enum: ['Vente', 'Location'], description: 'Vente ou location' },
        surface: { type: 'number', description: 'Surface en m², si connue' },
        pieces: { type: 'number', description: 'Nombre de pièces, si connu' },
        prix: { type: 'number', description: 'Prix (ou loyer) en euros, si connu' },
        description: { type: 'string', description: "Résumé libre de ce qui a été vu/dit lors de la visite (état, atouts, points d'attention)" },
        nomComplet: { type: 'string', description: 'Nom complet du propriétaire/lead déjà identifié à qui lier ce bien, si applicable' }
      },
      required: ['adresse']
    }
  },
  {
    name: 'creer_recherche',
    description: "Crée ou met à jour les critères de recherche (budget, secteur, type de bien souhaité) d'un lead acquéreur déjà identifié par son nom complet.",
    parameters: {
      type: 'object',
      properties: {
        nomComplet: { type: 'string', description: 'Nom complet (prénom + nom) du lead concerné' },
        type: { type: 'string', description: 'Type de bien recherché (ex. Appartement, Maison)' },
        quartiers: { type: 'array', items: { type: 'string' }, description: 'Quartiers/secteurs souhaités, si mentionnés' },
        prixMax: { type: 'number', description: 'Budget maximum en euros' },
        piecesMin: { type: 'number', description: 'Nombre de pièces minimum souhaité' },
        surfaceMin: { type: 'number', description: 'Surface minimum souhaitée en m²' },
        delai: { type: 'string', description: 'Délai/urgence du projet, si mentionné (ex. "sous 3 mois")' }
      },
      required: ['nomComplet']
    }
  },
  {
    name: 'envoyer_email',
    description: "Envoie un email libre et personnalisé à un lead déjà identifié par son nom complet et qui a un email connu — pour un message qui ne correspond pas à l'invitation de candidature standard (ex. compte-rendu de visite, relance personnalisée, information demandée).",
    parameters: {
      type: 'object',
      properties: {
        nomComplet: { type: 'string', description: 'Nom complet (prénom + nom) du lead destinataire' },
        sujet: { type: 'string', description: "Sujet de l'email" },
        message: { type: 'string', description: "Corps du message, en français, ton professionnel et chaleureux" }
      },
      required: ['nomComplet', 'sujet', 'message']
    }
  }
];
const ASSISTANT_TOOLS_ANTHROPIC = OUTILS_ASSISTANT.map((o) => ({ name: o.name, description: o.description, input_schema: o.parameters }));
const ASSISTANT_TOOLS_GEMINI = [{ functionDeclarations: OUTILS_ASSISTANT.map((o) => ({ name: o.name, description: o.description, parameters: o.parameters })) }];

const ASSISTANT_SYSTEM = "Tu es Célia, l'assistante interne vocale du CRM Seecret, une agence immobilière. Un agent te parle à l'oral ou à l'écrit, en général juste après un rendez-vous ou une visite, pour te raconter ce qui s'est passé. Comprends ce qu'il raconte et appelle toi-même les outils correspondants dans le CRM — ne te contente jamais de répondre en texte si une action est possible. Tu peux : créer/mettre à jour un lead, changer son statut pipeline, programmer un rappel daté (qui sert aussi pour un rendez-vous/rdv ou une relance à faire — mets-le simplement dans le titre, ex. \"RDV de visite\", \"Relancer sur l'offre\"), envoyer l'invitation de candidature standard, créer la fiche d'un bien visité, enregistrer les critères de recherche d'un acquéreur, et envoyer un email libre personnalisé. Si plusieurs actions sont nécessaires (ex. créer le lead ET créer le bien ET programmer un rappel), appelle plusieurs outils, dans un ordre logique (toujours créer/identifier le lead avant d'agir sur lui ou de créer un bien qui lui est lié). Si une information nécessaire manque (ex. aucune date pour un rappel, aucune adresse pour un bien), pose la question à l'agent au lieu d'inventer une valeur. Réponds toujours en français, de façon brève, orale et naturelle (ta réponse peut être lue à voix haute), en confirmant ce que tu as fait.";

// Un nom ne suffit jamais à identifier une personne : deux « Romain Dias »
// avec des emails et téléphones différents sont deux leads distincts. On ne
// renvoie un lead que si le nom désigne une seule fiche ; sinon null (ambigu).
function leadsParNom(db, texte) {
  const q = String(texte || '').trim().toLowerCase();
  if (!q) return [];
  const exacts = db.leads.filter((l) => ((l.prenom || '') + ' ' + (l.nom || '')).trim().toLowerCase() === q);
  if (exacts.length) return exacts;
  return db.leads.filter((l) => (l.nom || '').length > 1 && q.indexOf((l.nom || '').toLowerCase()) > -1);
}
function trouverLeadParNom(db, texte) {
  const l = leadsParNom(db, texte);
  return l.length === 1 ? l[0] : null;
}

function dFRServer(iso) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return iso; }
}

async function envoyerInvitationCandidatureEmail(req, lead, messagePersonnalise) {
  if (!lead.email) return { ok: false, erreur: "Ce lead n'a pas d'email connu." };
  if (!mailer) return { ok: false, erreur: "Aucun service d'email configuré sur ce serveur (RESEND_API_KEY ou EMAIL_USER/EMAIL_PASS manquants)." };
  const lien = originOf(req) + '/candidature.html';
  const intro = messagePersonnalise ? '<p style="font-size:15px;line-height:1.6;color:#5f5a54;margin:0 0 20px;">' + escHtml(messagePersonnalise) + '</p>' : '';
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:Georgia,\'Times New Roman\',serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 16px;">',
    '<div style="max-width:460px;width:100%;background:#ffffff;border:1px solid #eeebe6;border-radius:24px;padding:44px 36px;text-align:left;">',
    '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a54;font-weight:600;">Seecret</div>',
    '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.15;color:#141210;margin:14px 0 8px;">' + (lead.prenom ? 'Bonjour ' + escHtml(lead.prenom) : 'Bonjour') + ',</h1>',
    intro,
    '<p style="font-size:15px;line-height:1.6;color:#5f5a54;margin:0 0 20px;">Voici le lien pour déposer votre candidature au club Seecret — une dizaine de minutes suffisent.</p>',
    '<div style="text-align:center;"><a href="' + lien + '" style="display:inline-block;background:#141210;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:999px;font-size:15px;font-weight:500;">Déposer ma candidature</a></div>',
    '</div></td></tr></table></body></html>'
  ].join('');
  try {
    await mailer.sendMail({ from: '"' + DEFAULT_AGENT_NOM + ' · Seecret" <' + FROM_EMAIL + '>', to: lead.email, subject: 'Votre invitation à rejoindre Seecret', html: html });
    return { ok: true };
  } catch (err) {
    return { ok: false, erreur: (err && err.message) || 'Erreur d’envoi' };
  }
}

// Décrit en français, AVANT de l'exécuter, l'action qu'un outil est en train
// de proposer — affiché à l'agent pour qu'il valide ou refuse (voir plus bas,
// le modèle ne déclenche plus jamais une action directement).
function decrireActionProposee(nomOutil, input) {
  input = input || {};
  if (nomOutil === 'creer_ou_maj_lead') {
    const nom = ((input.prenom || '') + ' ' + (input.nom || '')).trim() || '(nom non précisé)';
    return 'Créer ou mettre à jour le lead ' + nom + (input.intentionVendeur ? ' (intention de vendre)' : '') +
      (input.notes ? ' — note : « ' + input.notes + ' »' : '');
  }
  if (nomOutil === 'changer_pipeline') {
    return 'Changer le statut de ' + (input.nomComplet || '(lead non précisé)') + ' → ' + (input.statut || '?');
  }
  if (nomOutil === 'programmer_rappel') {
    return 'Programmer le rappel « ' + (input.titre || 'Rappel') + ' » pour ' + (input.nomComplet || '(lead non précisé)') +
      (input.dateEcheance ? ', le ' + input.dateEcheance : '');
  }
  if (nomOutil === 'envoyer_invitation_candidature') {
    return 'Envoyer une invitation à candidater à ' + (input.nomComplet || '(lead non précisé)');
  }
  if (nomOutil === 'creer_bien') {
    return 'Créer le bien ' + (input.adresse || '(adresse non précisée)') +
      (input.nomComplet ? ', lié à ' + input.nomComplet : '') + (input.prix ? ' — ' + input.prix + ' €' : '');
  }
  if (nomOutil === 'creer_recherche') {
    return 'Enregistrer les critères de recherche de ' + (input.nomComplet || '(lead non précisé)') +
      (input.prixMax ? ' (budget ' + input.prixMax + ' €)' : '');
  }
  if (nomOutil === 'envoyer_email') {
    return 'Envoyer un email à ' + (input.nomComplet || '(lead non précisé)') + ' — sujet : « ' + (input.sujet || '') + ' »';
  }
  return 'Exécuter l’action « ' + nomOutil + ' »';
}

// Exécute un appel d'outil décidé par le modèle. Toujours { resultat, resume?, lien? } :
// `resultat` est renvoyé au modèle (tool_result), `resume`/`lien` alimentent le journal
// d'actions affiché à l'agent dans le panneau de chat.
async function dispatchOutilAssistant(db, req, nomOutil, input) {
  input = input || {};
  const auteur = 'Célia · ' + nomComplet(req.lead);

  if (nomOutil === 'creer_ou_maj_lead') {
    const nom = String(input.nom || '').trim();
    if (!nom) return { resultat: { ok: false, erreur: 'Le nom du contact est obligatoire.' } };
    const email = String(input.email || '').trim().toLowerCase();
    const telBrut = String(input.tel || '').trim();
    const telDigits = telBrut.replace(/\D/g, '');
    let lead = (email && db.leads.find((l) => (l.email || '').toLowerCase() === email)) ||
      (telDigits && db.leads.find((l) => (l.tel || '').replace(/\D/g, '') === telDigits)) ||
      // Rapprochement par le nom seulement sans email ni téléphone fournis :
      // sinon un homonyme aux coordonnées différentes serait écrasé.
      (!email && !telDigits ? trouverLeadParNom(db, ((input.prenom || '') + ' ' + nom).trim()) : null);
    let cree = false;
    if (!lead) {
      lead = {
        id: uid('l'), prenom: String(input.prenom || ''), nom: nom, email: email, tel: telBrut,
        ville: String(input.ville || ''), projet: input.intentionVendeur ? 'vendeur' : 'prospect',
        role: 'membre', type: 'personne', source: 'Assistant CRM', statut: 'prospect', pipeline: 'a_contacter',
        budgetMax: 0, quartiers: [], piecesMin: 0, surfaceMin: 0,
        notes: String(input.notes || ''), adresseBien: String(input.adresseBien || ''), cree: nowISO()
      };
      db.leads.push(lead);
      cree = true;
    } else {
      if (input.prenom) lead.prenom = String(input.prenom);
      if (email) lead.email = email;
      if (telBrut) lead.tel = telBrut;
      if (input.ville) lead.ville = String(input.ville);
      if (input.adresseBien) lead.adresseBien = String(input.adresseBien);
      if (input.notes) lead.notes = (lead.notes ? lead.notes + '\n\n' : '') + String(input.notes);
      if (input.intentionVendeur) lead.projet = 'vendeur';
    }
    logActivite(db, { leadId: lead.id, type: cree ? 'lead_cree_assistant' : 'lead_maj_assistant', auteur: auteur });
    return {
      resultat: { ok: true, leadId: lead.id, cree: cree },
      resume: (cree ? 'Lead créé : ' : 'Lead mis à jour : ') + nomComplet(lead),
      lien: '/crm.html#/client/' + lead.id
    };
  }

  if (nomOutil === 'changer_pipeline') {
    const lead = trouverLeadParNom(db, input.nomComplet);
    if (!lead) return { resultat: { ok: false, erreur: leadsParNom(db, input.nomComplet).length > 1 ? 'Plusieurs leads s’appellent ' + input.nomComplet + ' : précisez son email ou son téléphone.' : 'Lead introuvable : ' + input.nomComplet } };
    const avant = lead.pipeline;
    lead.pipeline = String(input.statut || '').slice(0, 40);
    if (avant !== lead.pipeline && (lead.pipeline === 'a_relancer' || lead.pipeline === 'converti')) {
      logActivite(db, { leadId: lead.id, type: lead.pipeline === 'converti' ? 'converti' : 'retour_silence', auteur: auteur });
    }
    return { resultat: { ok: true }, resume: 'Statut mis à jour (' + lead.pipeline + ') : ' + nomComplet(lead), lien: '/crm.html#/client/' + lead.id };
  }

  if (nomOutil === 'programmer_rappel') {
    const lead = trouverLeadParNom(db, input.nomComplet);
    if (!lead) return { resultat: { ok: false, erreur: leadsParNom(db, input.nomComplet).length > 1 ? 'Plusieurs leads s’appellent ' + input.nomComplet + ' : précisez son email ou son téléphone.' : 'Lead introuvable : ' + input.nomComplet } };
    const titre = String(input.titre || 'Rappel').trim();
    const dateEcheance = String(input.dateEcheance || '').trim();
    const dateValide = dateEcheance && !isNaN(new Date(dateEcheance).getTime());
    if (!dateValide) return { resultat: { ok: false, erreur: 'Date invalide : ' + input.dateEcheance } };
    const rappel = { id: uid('rap'), leadId: lead.id, titre: titre, dateEcheance: new Date(dateEcheance).toISOString(), notes: String(input.notes || ''), statut: 'ouvert', cree: nowISO() };
    db.rappels.push(rappel);
    logActivite(db, { leadId: lead.id, type: 'rappel_programme', auteur: auteur });
    return { resultat: { ok: true, rappelId: rappel.id }, resume: 'Rappel programmé (' + dFRServer(rappel.dateEcheance) + ') : ' + titre + ' — ' + nomComplet(lead), lien: '/crm.html#/client/' + lead.id };
  }

  if (nomOutil === 'envoyer_invitation_candidature') {
    const lead = trouverLeadParNom(db, input.nomComplet);
    if (!lead) return { resultat: { ok: false, erreur: leadsParNom(db, input.nomComplet).length > 1 ? 'Plusieurs leads s’appellent ' + input.nomComplet + ' : précisez son email ou son téléphone.' : 'Lead introuvable : ' + input.nomComplet } };
    const r = await envoyerInvitationCandidatureEmail(req, lead, input.messagePersonnalise);
    if (!r.ok) return { resultat: { ok: false, erreur: r.erreur } };
    logActivite(db, { leadId: lead.id, type: 'candidature_envoyee', auteur: auteur });
    return { resultat: { ok: true }, resume: 'Invitation à candidater envoyée à ' + nomComplet(lead) + ' (' + lead.email + ')', lien: '/crm.html#/client/' + lead.id };
  }

  if (nomOutil === 'creer_bien') {
    const adresse = String(input.adresse || '').trim();
    if (!adresse) return { resultat: { ok: false, erreur: "L'adresse du bien est obligatoire." } };
    const leadLie = input.nomComplet ? trouverLeadParNom(db, input.nomComplet) : null;
    const bien = {
      id: uid('b'), leadId: leadLie ? leadLie.id : null, nom: leadLie ? nomComplet(leadLie) : '',
      titre: '', adresse: adresse, codePostal: String(input.codePostal || ''), ville: String(input.ville || ''),
      type: input.type || 'Appartement', quartier: '', transaction: input.transaction || 'Vente',
      surface: Number(input.surface) || 0, pieces: Number(input.pieces) || 0, chambres: 0, sdb: 0, etage: '', ascenseur: false,
      anneeConstruction: 0, etat: '', dpe: '', ges: '',
      exterieur: '', surfaceExterieur: 0, annexes: [], prix: Number(input.prix) || 0, charges: 0, description: String(input.description || ''),
      photos: [], atouts: [], exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon', statutDemande: null,
      agent: nomComplet(req.lead) || DEFAULT_AGENT_NOM, cree: nowISO()
    };
    db.biens.push(bien);
    if (leadLie) logActivite(db, { leadId: leadLie.id, type: 'bien_cree_assistant', auteur: auteur });
    return { resultat: { ok: true, bienId: bien.id }, resume: 'Bien créé : ' + adresse, lien: '/crm.html#/bien/' + bien.id };
  }

  if (nomOutil === 'creer_recherche') {
    const lead = trouverLeadParNom(db, input.nomComplet);
    if (!lead) return { resultat: { ok: false, erreur: leadsParNom(db, input.nomComplet).length > 1 ? 'Plusieurs leads s’appellent ' + input.nomComplet + ' : précisez son email ou son téléphone.' : 'Lead introuvable : ' + input.nomComplet } };
    let recherche = db.recherches.find((x) => x.clientId === lead.id || x.leadId === lead.id);
    if (!recherche) {
      recherche = {
        id: uid('r'), clientId: lead.id, leadId: lead.id, titre: 'Recherche de ' + nomComplet(lead),
        types: [], type: '', quartiers: [], prixMax: 0, piecesMin: 0, surfaceMin: 0, surfaceMax: 0,
        delai: '', apport: 0, financement: '', courtier: false, bienAVendre: false, etageMin: 0, etageMax: 0,
        etat: '', dpe: '', annexes: [], prixVenteEstime: 0, statut: 'active', alertes: true, cree: nowISO()
      };
      db.recherches.push(recherche);
    }
    if (input.type) { recherche.type = String(input.type); recherche.types = [String(input.type)]; }
    if (Array.isArray(input.quartiers) && input.quartiers.length) recherche.quartiers = input.quartiers.map(String);
    if (input.prixMax) recherche.prixMax = Number(input.prixMax) || recherche.prixMax;
    if (input.piecesMin) recherche.piecesMin = Number(input.piecesMin) || recherche.piecesMin;
    if (input.surfaceMin) recherche.surfaceMin = Number(input.surfaceMin) || recherche.surfaceMin;
    if (input.delai) recherche.delai = String(input.delai);
    logActivite(db, { leadId: lead.id, type: 'recherche_maj_assistant', auteur: auteur });
    return { resultat: { ok: true, rechercheId: recherche.id }, resume: 'Critères de recherche enregistrés pour ' + nomComplet(lead), lien: '/crm.html#/client/' + lead.id };
  }

  if (nomOutil === 'envoyer_email') {
    const lead = trouverLeadParNom(db, input.nomComplet);
    if (!lead) return { resultat: { ok: false, erreur: leadsParNom(db, input.nomComplet).length > 1 ? 'Plusieurs leads s’appellent ' + input.nomComplet + ' : précisez son email ou son téléphone.' : 'Lead introuvable : ' + input.nomComplet } };
    if (!lead.email) return { resultat: { ok: false, erreur: "Ce lead n'a pas d'email connu." } };
    if (!mailer) return { resultat: { ok: false, erreur: "Aucun service d'email configuré sur ce serveur." } };
    const sujet = String(input.sujet || 'Message de ' + (nomComplet(req.lead) || DEFAULT_AGENT_NOM));
    const corps = String(input.message || '').trim();
    if (!corps) return { resultat: { ok: false, erreur: 'Le message est vide.' } };
    try {
      const html = '<!doctype html><html><body style="margin:0;padding:0;background:#faf9f7;font-family:Georgia,\'Times New Roman\',serif;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 16px;">' +
        '<div style="max-width:460px;width:100%;background:#ffffff;border:1px solid #eeebe6;border-radius:24px;padding:44px 36px;text-align:left;">' +
        '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#5f5a54;font-weight:600;">Seecret</div>' +
        '<h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;line-height:1.2;color:#141210;margin:14px 0 18px;">' + (lead.prenom ? 'Bonjour ' + escHtml(lead.prenom) : 'Bonjour') + ',</h1>' +
        '<p style="font-size:15px;line-height:1.6;color:#5f5a54;margin:0;white-space:pre-wrap;">' + escHtml(corps) + '</p>' +
        '</div></td></tr></table></body></html>';
      await mailer.sendMail({ from: '"' + (nomComplet(req.lead) || DEFAULT_AGENT_NOM) + ' · Seecret" <' + FROM_EMAIL + '>', to: lead.email, subject: sujet, html: html });
    } catch (err) {
      return { resultat: { ok: false, erreur: (err && err.message) || "Erreur d'envoi" } };
    }
    logActivite(db, { leadId: lead.id, type: 'email_envoye_assistant', auteur: auteur });
    return { resultat: { ok: true }, resume: 'Email envoyé à ' + nomComplet(lead) + ' (' + lead.email + ') : « ' + sujet + ' »', lien: '/crm.html#/client/' + lead.id };
  }

  return { resultat: { ok: false, erreur: 'Outil inconnu : ' + nomOutil } };
}

// Délai maximal avant d'abandonner UNE tentative d'appel à l'IA et de passer
// à la suivante, au lieu de laisser le client « mouliner » indéfiniment sans
// jamais savoir si ça a planté ou si c'est juste lent.
const DELAI_IA_MS = 30000;

function erreurDelaiDepasse(fournisseur) {
  return Object.assign(new Error(fournisseur + ' n’a pas répondu à temps (' + (3 * DELAI_IA_MS / 1000) + 's au total, malgré plusieurs tentatives) — réessayez.'), { code: 'TIMEOUT' });
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Un modèle « surchargé » (503, pic de demande côté Google/Anthropic) est en
// général rétabli en quelques secondes, et une tentative trop lente (délai
// dépassé) est souvent juste un aléa réseau ponctuel (ex. sur Railway) plutôt
// qu'une vraie panne — dans les deux cas on réessaie automatiquement avant de
// renvoyer l'erreur à l'utilisateur, pour lui éviter de retaper lui-même.
// Le signal d'abandon est recréé à chaque tentative (un AbortSignal.timeout
// ne se réarme pas).
async function fetchAvecRetry(url, options, tentatives) {
  for (let i = 0; ; i++) {
    let resp;
    try {
      resp = await fetch(url, Object.assign({}, options, { signal: AbortSignal.timeout(DELAI_IA_MS) }));
    } catch (e) {
      const estTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      if (!estTimeout || i >= (tentatives - 1)) throw e;
      await attendre(800 * (i + 1));
      continue;
    }
    if (resp.status !== 503 || i >= (tentatives - 1)) return resp;
    await attendre(1500 * (i + 1));
  }
}

async function callAnthropic(messages) {
  if (!ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY non configurée sur ce serveur.'), { code: 'NO_KEY' });
  let resp;
  try {
    resp = await fetchAvecRetry(ANTHROPIC_API_BASE + '/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system: ASSISTANT_SYSTEM, tools: ASSISTANT_TOOLS_ANTHROPIC, messages: messages })
    }, 3);
  } catch (e) { if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw erreurDelaiDepasse('Anthropic'); throw e; }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error((data && data.error && data.error.message) || ('Anthropic ' + resp.status)), { code: 'API_ERROR' });
  return data;
}

async function callGemini(contents) {
  if (!GEMINI_API_KEY) throw Object.assign(new Error('GEMINI_API_KEY non configurée sur ce serveur.'), { code: 'NO_KEY' });
  let resp;
  try {
    resp = await fetchAvecRetry(GEMINI_API_BASE + '/v1beta/models/' + encodeURIComponent(GEMINI_MODEL) + ':generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: ASSISTANT_SYSTEM }] }, contents: contents, tools: ASSISTANT_TOOLS_GEMINI })
    }, 3);
  } catch (e) { if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw erreurDelaiDepasse('Gemini'); throw e; }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error((data && data.error && data.error.message) || ('Gemini ' + resp.status)), { code: 'API_ERROR' });
  return data;
}

// Transcription audio → texte, via Gemini (seul des deux fournisseurs à
// accepter l'audio en entrée). Utilisée en secours quand la reconnaissance
// vocale native du navigateur (Web Speech API) n'est pas fiable ou pas
// disponible — notamment sur iPhone, où Safari ET Chrome (contraints par
// iOS à utiliser le même moteur WebKit) ont un support de SpeechRecognition
// connu pour être cassé (bug WebKit ouvert depuis des années, jamais
// corrigé par Apple). On enregistre l'audio côté client avec MediaRecorder
// (largement supporté, y compris sur iOS) et on le transcrit ici.
async function transcrireAudioGemini(base64Audio, mimeType) {
  if (!GEMINI_API_KEY) throw Object.assign(new Error('La dictée audio nécessite une clé Gemini configurée sur le serveur (GEMINI_API_KEY).'), { code: 'NO_KEY' });
  let resp;
  try {
    resp = await fetchAvecRetry(GEMINI_API_BASE + '/v1beta/models/' + encodeURIComponent(GEMINI_MODEL) + ':generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType || 'audio/webm', data: base64Audio } },
            { text: 'Transcris fidèlement cet enregistrement audio en français, mot pour mot. Réponds uniquement avec le texte transcrit, sans guillemets, sans commentaire, sans rien ajouter. Si rien d’intelligible n’est dit, réponds avec une chaîne vide.' }
          ]
        }]
      })
    }, 3);
  } catch (e) { if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw erreurDelaiDepasse('Gemini'); throw e; }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error((data && data.error && data.error.message) || ('Gemini ' + resp.status)), { code: 'API_ERROR' });
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.filter((p) => p.text).map((p) => p.text).join(' ').trim();
}

// Garde-fou contre une boucle infinie : au-delà de ce nombre de tours
// outil → validation/refus → outil, on arrête et on répond en texte plutôt
// que de redemander une nouvelle validation indéfiniment.
const TOURS_OUTIL_MAX = 8;

async function conversationAnthropic(db, req, historique, message) {
  const messages = historique.concat([{ role: 'user', content: message }]);
  return etapeAnthropic(db, req, messages, []);
}

// Appelle le modèle puis s'arrête : si le modèle veut utiliser un ou plusieurs
// outils, on NE les exécute PAS — on renvoie la proposition d'action au client
// pour que l'agent la valide ou la refuse (voir poursuivreApresDecisionAnthropic).
async function etapeAnthropic(db, req, messages, actions) {
  const toursDeja = messages.filter((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use')).length;
  if (toursDeja >= TOURS_OUTIL_MAX) {
    return { texte: 'Trop d’étapes pour cette demande — reformulez-la de façon plus simple.', actions: actions, historique: messages };
  }
  const data = await callAnthropic(messages);
  messages.push({ role: 'assistant', content: data.content });
  const blocs = (data.content || []).filter((b) => b.type === 'tool_use');
  if (data.stop_reason === 'tool_use' && blocs.length) {
    return {
      enAttente: blocs.map((b) => ({ id: b.id, outil: b.name, input: b.input, resume: decrireActionProposee(b.name, b.input) })),
      actions: actions,
      historique: messages
    };
  }
  const texte = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || 'Fait.';
  return { texte: texte, actions: actions, historique: messages };
}

// Exécute (ou refuse) les actions que l'agent vient de valider/refuser, renvoie
// le résultat au modèle comme tool_result, puis laisse la conversation continuer.
async function poursuivreApresDecisionAnthropic(db, req, messages, decisions, actions) {
  const toolResults = [];
  for (const d of decisions) {
    if (d.accepter) {
      const r = await dispatchOutilAssistant(db, req, d.outil, d.input);
      if (r && r.resume) actions.push({ outil: d.outil, resume: r.resume, lien: r.lien || null });
      toolResults.push({ type: 'tool_result', tool_use_id: d.id, content: JSON.stringify((r && r.resultat) || r) });
    } else {
      toolResults.push({ type: 'tool_result', tool_use_id: d.id, content: JSON.stringify({ ok: false, erreur: 'Action refusée par l’agent — ne pas la retenter sans nouvelle demande explicite.' }) });
    }
  }
  writeDb(db);
  messages.push({ role: 'user', content: toolResults });
  return etapeAnthropic(db, req, messages, actions);
}

async function conversationGemini(db, req, historique, message) {
  const contents = historique.concat([{ role: 'user', parts: [{ text: message }] }]);
  return etapeGemini(db, req, contents, []);
}

async function etapeGemini(db, req, contents, actions) {
  const toursDeja = contents.filter((c) => c.role === 'model' && Array.isArray(c.parts) && c.parts.some((p) => p.functionCall)).length;
  if (toursDeja >= TOURS_OUTIL_MAX) {
    return { texte: 'Trop d’étapes pour cette demande — reformulez-la de façon plus simple.', actions: actions, historique: contents };
  }
  const data = await callGemini(contents);
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  contents.push({ role: 'model', parts: parts });
  const appels = parts.filter((p) => p.functionCall);
  if (appels.length) {
    return {
      enAttente: appels.map((p) => ({ id: p.functionCall.id, outil: p.functionCall.name, input: p.functionCall.args, resume: decrireActionProposee(p.functionCall.name, p.functionCall.args) })),
      actions: actions,
      historique: contents
    };
  }
  const texte = parts.filter((p) => p.text).map((p) => p.text).join('\n').trim() || 'Fait.';
  return { texte: texte, actions: actions, historique: contents };
}

async function poursuivreApresDecisionGemini(db, req, contents, decisions, actions) {
  const reponses = [];
  for (const d of decisions) {
    if (d.accepter) {
      const r = await dispatchOutilAssistant(db, req, d.outil, d.input);
      if (r && r.resume) actions.push({ outil: d.outil, resume: r.resume, lien: r.lien || null });
      reponses.push({ functionResponse: { name: d.outil, id: d.id, response: { result: (r && r.resultat) || r } } });
    } else {
      reponses.push({ functionResponse: { name: d.outil, id: d.id, response: { result: { ok: false, erreur: 'Action refusée par l’agent — ne pas la retenter sans nouvelle demande explicite.' } } } });
    }
  }
  writeDb(db);
  contents.push({ role: 'user', parts: reponses });
  return etapeGemini(db, req, contents, actions);
}

// Conversation avec tool use : le modèle propose une action (il ne l'exécute
// jamais lui-même), le client l'affiche à l'agent et renvoie sa décision via
// `decisions` ; on continue alors la conversation jusqu'à une réponse en
// texte (ou jusqu'à TOURS_OUTIL_MAX, garde-fou contre une boucle infinie). Le
// format de `historique` dépend du fournisseur actif (AI_PROVIDER) — le
// client le traite comme une donnée opaque, à retourner telle quelle.
app.post('/api/assistant/chat', requireAdmin, async (req, res) => {
  const historique = Array.isArray(req.body && req.body.historique) ? req.body.historique : [];
  const db = readDb();
  try {
    let resultat;
    if (req.body && Array.isArray(req.body.decisions) && req.body.decisions.length) {
      resultat = AI_PROVIDER === 'gemini'
        ? await poursuivreApresDecisionGemini(db, req, historique, req.body.decisions, [])
        : await poursuivreApresDecisionAnthropic(db, req, historique, req.body.decisions, []);
    } else {
      const message = String((req.body && req.body.message) || '').trim();
      if (!message) return res.status(400).json({ error: 'Message vide.' });
      resultat = AI_PROVIDER === 'gemini'
        ? await conversationGemini(db, req, historique, message)
        : await conversationAnthropic(db, req, historique, message);
    }
    if (resultat.enAttente) {
      return res.json({ ok: true, enAttente: resultat.enAttente, actions: resultat.actions, historique: resultat.historique });
    }
    res.json({ ok: true, reponse: resultat.texte, actions: resultat.actions, historique: resultat.historique });
  } catch (err) {
    if (err && err.code === 'NO_KEY') return res.status(503).json({ error: err.message });
    res.status(502).json({ error: (err && err.message) || "Impossible de contacter l'assistant." });
  }
});

// Dictée vocale de Célia : le client enregistre l'audio (MediaRecorder) et
// l'envoie ici en base64 pour transcription, plutôt que de s'appuyer sur la
// reconnaissance vocale native du navigateur (peu fiable sur iOS — voir le
// commentaire sur transcrireAudioGemini ci-dessus).
app.post('/api/assistant/transcrire', requireAdmin, async (req, res) => {
  const audio = (req.body && req.body.audio) || '';
  if (!audio) return res.status(400).json({ error: 'Audio manquant.' });
  try {
    const texte = await transcrireAudioGemini(audio, req.body && req.body.mimeType);
    res.json({ ok: true, texte: texte });
  } catch (err) {
    if (err && err.code === 'NO_KEY') return res.status(503).json({ error: err.message });
    res.status(502).json({ error: (err && err.message) || 'Transcription impossible.' });
  }
});

app.get('/api/rappels', requireAdmin, (req, res) => {
  const db = readDb();
  const rappels = db.rappels.map((r) => {
    const lead = db.leads.find((l) => l.id === r.leadId);
    return Object.assign({}, r, { leadNom: lead ? nomComplet(lead) : '' });
  }).sort((a, b) => new Date(a.dateEcheance) - new Date(b.dateEcheance));
  res.json({ ok: true, rappels: rappels });
});

app.patch('/api/rappels/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const rappel = db.rappels.find((r) => r.id === req.params.id);
  if (!rappel) return res.status(404).json({ error: 'Rappel introuvable' });
  if (typeof (req.body && req.body.statut) === 'string') rappel.statut = req.body.statut === 'fait' ? 'fait' : 'ouvert';
  writeDb(db);
  res.json({ ok: true, rappel: rappel });
});

// Accès au CRM : réservé à l'agence (agent/admin/superadmin). Les autres
// sont renvoyés à l'espace membre public. Avant correctif, ce garde ne
// listait que 'admin'/'superadmin' — oublié lors de l'ajout du rôle
// 'agent', ce qui aurait renvoyé tout agent invité vers l'espace membre au
// lieu du CRM malgré un rôle correct partout ailleurs (trouvé en testant un
// compte agent de bout en bout, pas seulement via l'API).
app.get('/crm.html', (req, res, next) => {
  const token = getCookie(req, SESSION_COOKIE);
  const versConnexion = () => res.redirect('/espace.html' + (req.query.ouvrir ? '?suite=' + encodeURIComponent(req.originalUrl) : ''));
  if (!token) return versConnexion();
  const db = readDb();
  pruneAuth(db);
  const session = db.sessions.find((s) => s.id === sha256(token));
  const lead = session ? db.leads.find((l) => l.id === session.leadId) : null;
  const role = roleOf(lead);
  if (!lead) return versConnexion();
  if (ROLES_STAFF.indexOf(role) === -1) return res.redirect('/espace.html');
  next();
});

if (Sentry) Sentry.setupExpressErrorHandler(app);

// Seules les pages HTML et les ressources publiques sont servies : jamais le
// code du serveur, la documentation interne, les outils, les dépendances, ni
// surtout data.json (si le volume DATA_DIR se trouve dans ce dossier).
const CHEMINS_PUBLICS = /^\/(?:$|[a-z0-9-]+\.html$|assets\/)/i;
app.use((req, res, next) => {
  if ((req.method === 'GET' || req.method === 'HEAD') && !CHEMINS_PUBLICS.test(req.path)) return res.status(404).send('Introuvable');
  next();
});
// Pages, scripts et feuilles de style : le navigateur doit revérifier à chaque
// visite (réponse 304 instantanée si rien n'a changé). Sans cela, il gardait
// d'anciennes versions en cache pendant des heures après une mise à jour.
app.use(express.static(__dirname, {
  dotfiles: 'deny', index: 'index.html',
  setHeaders: (res, fichier) => { if (/\.(html|js|css)$/i.test(fichier)) res.setHeader('Cache-Control', 'no-cache'); }
}));

app.listen(PORT, () => {
  try {
    const db = readDb();
    seedDemoData(db);
    writeDb(db);
  } catch (e) { /* migration leadId / seed démo */ }
  console.log('Seecret backend démarré sur http://localhost:' + PORT);
  console.log('  CRM : http://localhost:' + PORT + '/crm.html');
  console.log('  Adhésion : http://localhost:' + PORT + '/candidature.html');
  if (RESEND_API_KEY) {
    console.log('  Email : Resend configuré (expéditeur ' + RESEND_FROM_EMAIL + ')');
  } else if (smtpFallback) {
    console.log('  Email : SMTP configuré (' + process.env.EMAIL_USER + ')');
    smtpFallback.verify((err) => {
      if (err) console.error('  [SMTP] ÉCHEC de connexion Gmail : ' + err.message);
      else console.log('  [SMTP] Connexion Gmail OK — envoi des emails opérationnel');
    });
  } else {
    console.warn('  Email : NON configuré (ni RESEND_API_KEY ni EMAIL_USER/EMAIL_PASS) — aucun email ne sera envoyé');
  }
  planifierScanDpeQuotidien();
  planifierImportPm();
});
