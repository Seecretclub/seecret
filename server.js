'use strict';

require('dotenv').config();

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
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
// data-comparables.json est une donnée de référence livrée avec le code
// (pas générée par les utilisateurs), elle reste dans le dépôt / __dirname.
const COMPARABLES_FILE = path.join(__dirname, 'data-comparables.json');

app.use(cors());
// Relevé à 8 Mo (au lieu de 1 Mo) pour laisser passer l'audio dicté à Célia
// (quelques dizaines de secondes de voix encodées en base64).
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
  let db = {};
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { db = {}; }
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
  // Migration : relie chaque bien/recherche à son lead (leadId) via l'email si manquant.
  db.biens.forEach((b) => {
    if (!b.leadId && b.email) {
      const lead = db.leads.find((l) => (l.email || '').toLowerCase() === (b.email || '').toLowerCase());
      if (lead) b.leadId = lead.id;
    }
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

function writeDb(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// Journal d'activité unifié : une seule source de vérité pour tout ce qui arrive
// à un lead/bien (candidature, admission, mise au catalogue, offres, relances
// Réseau…), consommée par le CRM (fiche contact → bloc "Activité"). N'écrit
// jamais dans data.json elle-même : appelant responsable de writeDb(db) après.
function logActivite(db, { leadId, bienId, type, auteur }) {
  db.activites = Array.isArray(db.activites) ? db.activites : [];
  db.activites.push({ id: uid('act'), leadId: leadId || null, bienId: bienId || null, type: type, auteur: auteur || 'Système', at: nowISO() });
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

function decoupe(dossier) {
  const v = dossier.vous || {};
  const r = dossier.recherche || {};
  const b = dossier.bien || {};
  const vente = dossier.vente || {};
  const budget = dossier.budget || {};
  const projet = dossier.projet || 'acheteur';
  const nom = ((v.prenom || '') + ' ' + (v.nom || '')).trim();
  const email = v.email || '';

  const lead = { id: uid('l'), prenom: v.prenom || '', nom: v.nom || '', email: email, tel: v.tel || '', ville: v.ville || '', projet: projet, role: 'membre', budgetMax: Number(r.prixMax) || 0, quartiers: Array.isArray(r.quartiers) ? r.quartiers : [], piecesMin: Number(r.piecesMin) || 0, surfaceMin: Number(r.surfaceMin) || 0, surfaceMax: Number(r.surfaceMax) || 0, delai: r.delai || '', typeBien: (Array.isArray(r.types) && r.types[0]) || '', apport: Number(budget.apport) || 0, financement: budget.financement || '', courtier: !!budget.courtier, bienAVendre: !!budget.bienAVendre, statut: 'en_attente', source: 'Candidature', cree: nowISO() };

  const recherche = projet !== 'vendeur' ? { id: uid('r'), clientId: lead.id, leadId: lead.id, titre: titreRecherche(r), types: Array.isArray(r.types) ? r.types : [], type: (Array.isArray(r.types) && r.types[0]) || '', quartiers: Array.isArray(r.quartiers) ? r.quartiers : [], prixMax: Number(r.prixMax) || 0, piecesMin: Number(r.piecesMin) || 0, surfaceMin: Number(r.surfaceMin) || 0, surfaceMax: Number(r.surfaceMax) || 0, delai: r.delai || '', apport: Number(budget.apport) || 0, financement: budget.financement || '', courtier: !!budget.courtier, bienAVendre: !!budget.bienAVendre, etageMin: Number(r.etageMin) || 0, etageMax: Number(r.etageMax) || 0, etat: r.etat || '', dpe: r.dpe || '', annexes: Array.isArray(r.annexes) ? r.annexes : [], prixVenteEstime: Number(budget.prixVenteEstime) || 0, statut: 'active', alertes: true, cree: nowISO() } : null;

  const bien = projet !== 'acheteur' ? { id: uid('mb'), leadId: lead.id, email: email, nom: nom, titre: '', adresse: b.adresse || '', codePostal: b.codePostal || '', ville: b.ville || '', type: b.type || 'Appartement', quartier: b.quartier || '', surface: Number(b.surface) || 0, pieces: Number(b.pieces) || 0, chambres: Number(b.chambres) || 0, sdb: Number(b.sdb) || 0, etage: b.etage || '', dpe: b.dpe || '', etat: b.etat || '', exterieur: b.exterieur || '', surfaceExterieur: Number(b.surfaceExterieur) || 0, prix: Number(vente.prix) || 0, delai: vente.delai || '', dejaEnVente: vente.dejaEnVente || '', mandat: vente.mandat || '', motif: vente.motif || '', description: b.description || '', photos: Array.isArray(b.photos) ? b.photos.slice(0, 12) : [], atouts: Array.isArray(b.atouts) ? b.atouts : [], annexes: Array.isArray(b.annexes) ? b.annexes : [], ges: b.ges || '', charges: Number(b.charges) || 0, ascenseur: !!b.ascenseur, lat: b.lat || null, lon: b.lon || null, exclusivite: { statut: 'scan_en_cours', liens: [] }, validation: 'en_attente', statut: 'brouillon', statutDemande: null, suiveurs: 0, agent: DEFAULT_AGENT_NOM, cree: nowISO() } : null;

  const demande = { id: uid('d'), type: 'candidature', nom: nom || 'Candidat', email: email, leadId: lead.id, clientId: lead.id, role: projet, montant: 0, message: resumeDemande(dossier), source: 'Site', statut: 'nouvelle', cree: nowISO() };

  return { lead, recherche, bien, demande };
}

app.get('/api/candidatures', requireAdmin, (req, res) => {
  const db = readDb();
  // On ne diffuse jamais les clés publiques ni l'historique de connexions.
  const leads = db.leads.map((l) => {
    const copy = Object.assign({}, l);
    delete copy.passkeys;
    delete copy.connexions;
    return copy;
  });
  res.json({ leads: leads, recherches: db.recherches, biens: db.biens, demandes: db.demandes });
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

app.post('/api/candidature', async (req, res) => {
  const dossier = req.body;
  if (!dossier || typeof dossier !== 'object' || !dossier.vous) {
    return res.status(400).json({ error: 'Dossier invalide' });
  }
  const db = readDb();
  const result = decoupe(dossier);
  const email = ((dossier.vous && dossier.vous.email) || '').toLowerCase();

  let lead = email ? db.leads.find((l) => (l.email || '').toLowerCase() === email) : null;
  if (lead) {
    const fresh = result.lead;
    fresh.id = lead.id;
    fresh.cree = lead.cree;
    Object.assign(lead, fresh);
  } else {
    lead = result.lead;
    db.leads.push(lead);
  }

  if (result.recherche) {
    result.recherche.clientId = lead.id;
    const prev = db.recherches.find((x) => x.clientId === lead.id);
    if (prev) Object.assign(prev, result.recherche, { id: prev.id });
    else db.recherches.push(result.recherche);
  }

  if (result.bien) {
    result.bien.leadId = lead.id;
    result.bien.email = lead.email;
    const prev = db.biens.find((x) => x.leadId === lead.id);
    if (prev) Object.assign(prev, result.bien, { id: prev.id });
    else db.biens.push(result.bien);
  }

  if (result.demande) {
    result.demande.clientId = lead.id;
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
    mailer.sendMail({
      from: '"Seecret Notifications" <' + FROM_EMAIL + '>',
      to: process.env.EMAIL_USER,
      subject: 'Nouvelle candidature reçue : ' + nomClient,
      html: 'Une nouvelle demande d’adhésion vient d’être soumise par <b>' + nomClient + '</b>. Connectez-vous au CRM pour la traiter.'
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

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function originOf(req) {
  const base = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
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
    connexions: (lead.connexions || []).slice(-10).reverse()
  };
}

// Rôles : 'membre' par défaut, 'admin' / 'superadmin' pour l'agence.
// Les emails super-admin peuvent être fournis via ADMIN_EMAILS (séparés par des virgules).
function roleOf(lead) {
  if (!lead) return 'membre';
  const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (admins.indexOf((lead.email || '').toLowerCase()) > -1) return 'superadmin';
  return ['admin', 'superadmin', 'membre'].indexOf(lead.role) > -1 ? lead.role : 'membre';
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const role = roleOf(req.lead);
    if (role !== 'admin' && role !== 'superadmin') {
      return res.status(403).json({ error: 'Accès réservé à l’agence' });
    }
    next();
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
    ['Prix', bien.prix ? bien.prix.toLocaleString('fr-FR') + ' €' : '—'],
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
    '<div style="color:#5f5a54;font-size:16px;margin-bottom:24px;">' + (bien.adresse || '') + (bien.codePostal ? ' ' + bien.codePostal : '') + (bien.ville ? ' ' + bien.ville : '') + '</div>',
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
    '<p style="font-size:16px;line-height:1.6;color:#5f5a54;margin:6px 0 0;">' + (bien.prix ? bien.prix.toLocaleString('fr-FR') + ' €' : '') + (bien.surface ? ' · ' + bien.surface + ' m²' : '') + (bien.quartier ? ' · ' + bien.quartier : '') + '</p>',
    (bien.description ? '<p style="font-size:15px;line-height:1.6;color:#5f5a54;margin:14px 0 0;">' + bien.description + '</p>' : ''),
    '</td></tr>',
    '</table>',
    '<p style="font-size:12px;color:#5f5a54;margin:22px 0 0;text-align:center;">L’équipe Seecret</p>',
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
app.post('/api/auth/enroll', (req, res) => {
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
  res.json({ ok: true, redirect: '/espace.html' });
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
  res.json({ ok: true, redirect: '/espace.html' });
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
    res.json({ ok: true, redirect: '/espace.html' });
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
    res.json({ ok: true, redirect: '/espace.html' });
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

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));
app.use('/vendor/simplewebauthn', express.static(path.join(__dirname, 'node_modules/@simplewebauthn/browser/esm')));

const TYPES_DOC = {
  identite: 'Pièce d’identité',
  financement: 'Justificatif de financement',
  bien: 'Titre de propriété'
};

function bienDuMembre(db, lead) {
  let b = db.biens.find((x) => x.leadId === lead.id || (x.email || '').toLowerCase() === (lead.email || '').toLowerCase());
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

function rechercheDuMembre(db, lead) {
  let r = db.recherches.find((x) => x.clientId === lead.id);
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
    const lien = obj && (obj.url || obj.link || obj.permalinkUrl || obj.displayedUrl || null);
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

function bienPublic(b) {
  const c = completionBien(b);
  return {
    id: b.id, titre: b.titre || '', adresse: b.adresse || '', codePostal: b.codePostal || '', ville: b.ville || '',
    type: b.type || 'Appartement', quartier: b.quartier || '', transaction: b.transaction || 'Vente',
    surface: b.surface || 0, pieces: b.pieces || 0, chambres: b.chambres || 0, sdb: b.sdb || 0,
    etage: b.etage || '', ascenseur: !!b.ascenseur, anneeConstruction: b.anneeConstruction || 0,
    dpe: b.dpe || '', ges: b.ges || '', etat: b.etat || '',
    exterieur: b.exterieur || '', surfaceExterieur: b.surfaceExterieur || 0,
    annexes: Array.isArray(b.annexes) ? b.annexes : [], prix: b.prix || 0, charges: b.charges || 0,
    description: b.description || '', photos: b.photos || [], statut: b.statut || 'brouillon',
    statutDemande: b.statutDemande || null, cree: b.cree || null,
    completion: c.pct, complet: c.complet,
    exclusivite: b.exclusivite || { statut: 'scan_en_cours', liens: [] },
    validation: b.validation || 'en_attente',
    insee: b.insee || '', lat: b.lat || null, lon: b.lon || null
  };
}

function nomComplet(lead) {
  return ((lead.prenom || '') + ' ' + (lead.nom || '')).trim() || lead.email || 'Membre';
}

// ---- Mon bien (membre connecté) ----
app.get('/api/mon-bien', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  res.json({ ok: true, bien: bienPublic(b) });
});

app.patch('/api/mon-bien', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const body = req.body || {};
  ['titre', 'description', 'adresse', 'codePostal', 'ville', 'type', 'quartier', 'transaction', 'etage', 'dpe', 'ges', 'etat', 'exterieur']
    .forEach((k) => { if (typeof body[k] === 'string') b[k] = body[k].slice(0, 400); });
  ['surface', 'pieces', 'chambres', 'sdb', 'prix', 'surfaceExterieur', 'anneeConstruction', 'charges']
    .forEach((k) => { if (body[k] !== undefined) b[k] = Math.max(0, Number(body[k]) || 0); });
  if (typeof body.ascenseur === 'boolean') b.ascenseur = body.ascenseur;
  if (Array.isArray(body.annexes)) b.annexes = body.annexes.map(String).slice(0, 20);
  if (['brouillon', 'ouvert', 'mandat', 'avant-premiere'].indexOf(body.statut) > -1) {
    const avant = b.statut;
    b.statut = body.statut;
    if (avant === 'brouillon' && (b.statut === 'avant-premiere' || b.statut === 'ouvert' || b.statut === 'mandat')) {
      logActivite(req.db, { leadId: req.lead.id, bienId: b.id, type: 'mise_au_catalogue', auteur: nomComplet(req.lead) });
    }
    if (avant !== 'ouvert' && b.statut === 'ouvert') {
      logActivite(req.db, { leadId: req.lead.id, bienId: b.id, type: 'ouverture_visites', auteur: nomComplet(req.lead) });
    }
  }
  writeDb(req.db);
  res.json({ ok: true, bien: bienPublic(b) });
});

// ---- Photos du bien ----
app.post('/api/mon-bien/photos', requireAuth, upload.array('photos', 8), (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const urls = (req.files || []).map((f) => '/uploads/' + f.filename);
  b.photos = (b.photos || []).concat(urls).slice(0, 12);
  writeDb(req.db);
  res.json({ ok: true, photos: b.photos });
});

app.delete('/api/mon-bien/photos', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const url = String((req.body && req.body.url) || '');
  b.photos = (b.photos || []).filter((p) => p !== url);
  writeDb(req.db);
  res.json({ ok: true, photos: b.photos });
});

app.patch('/api/mon-bien/photos', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const url = String((req.body && req.body.principale) || '');
  if ((b.photos || []).indexOf(url) === -1) return res.status(404).json({ error: 'Photo introuvable' });
  b.photos = [url].concat(b.photos.filter((p) => p !== url));
  writeDb(req.db);
  res.json({ ok: true, photos: b.photos });
});

// ---- Demande de visibilité ----
app.post('/api/mon-bien/visibilite', requireAuth, (req, res) => {
  const b = bienDuMembre(req.db, req.lead);
  const cible = (req.body && req.body.demande) === 'vente' ? 'vente' : 'ouvert';
  b.statutDemande = cible;
  b.demandeAt = nowISO();
  const demande = {
    id: uid('d'), type: 'statut', leadId: req.lead.id, bienId: b.id, email: req.lead.email,
    nom: nomComplet(req.lead),
    message: cible === 'vente' ? 'Demande de mise en vente' : 'Demande de passage en visite ouverte',
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
  if (!message && !prix && !nouveauTitre && !nouvelleDescription) return res.status(400).json({ error: 'Aucune modification précisée' });
  const role = (type === 'Prix' || prix > 0) ? 'prix' : (type.indexOf('Statut') > -1 ? 'statut' : 'autre');
  const demande = {
    id: uid('d'), type: 'modification', role: role, leadId: req.lead.id, bienId: b.id,
    email: req.lead.email, nom: nomComplet(req.lead),
    message: type + ' — ' + message,
    prix: prix || null, titre: nouveauTitre || null, description: nouvelleDescription || null,
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
  const r = rechercheDuMembre(req.db, req.lead);
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
  res.json({ ok: true, biens: db.biens });
});

app.patch('/api/biens/:id/valider', requireAdmin, (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  bien.validation = 'valide';
  bien.valideAt = nowISO();
  writeDb(db);
  res.json({ ok: true, validation: 'valide' });
});

// ---- Enregistrement (PATCH) des fiches Lead / Bien / Recherche ----
app.patch('/api/leads/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const lead = db.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  const body = req.body || {};
  ['prenom', 'nom', 'email', 'tel', 'ville', 'typeBien', 'source', 'notes', 'financement'].forEach((k) => { if (typeof body[k] === 'string') lead[k] = body[k]; });
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
  if (typeof body.statut === 'string') lead.statut = body.statut.slice(0, 20);
  writeDb(db);
  res.json({ ok: true, lead: lead });
});

app.patch('/api/biens/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).json({ error: 'Bien introuvable' });
  const body = req.body || {};
  ['ref', 'titre', 'adresse', 'ville', 'codePostal', 'type', 'quartier', 'etage', 'dpe', 'ges', 'etat', 'statut', 'description', 'exterieur'].forEach((k) => { if (typeof body[k] === 'string') bien[k] = body[k]; });
  ['surface', 'pieces', 'chambres', 'sdb', 'prix', 'charges', 'surfaceExterieur'].forEach((k) => { if (body[k] !== undefined) bien[k] = Math.max(0, Number(body[k]) || 0); });
  if (Array.isArray(body.annexes)) bien.annexes = body.annexes.map(String);
  if (Array.isArray(body.atouts)) bien.atouts = body.atouts.map(String);
  if (Array.isArray(body.photos)) bien.photos = body.photos.map(String).slice(0, 12);
  // Pipeline Propositions → Offres (étape 4 du plan de fusion) : étape avant
  // l'offre écrite, post-visite — à_présenter / présentée / réponse_reçue.
  if (['a_presenter', 'presentee', 'reponse_recue', ''].indexOf(body.etapeProposition) > -1) {
    bien.etapeProposition = body.etapeProposition || null;
  }
  writeDb(db);
  res.json({ ok: true, bien: bien });
});

app.patch('/api/recherches/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const rec = db.recherches.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recherche introuvable' });
  const body = req.body || {};
  ['titre', 'type', 'delai', 'financement', 'dpe'].forEach((k) => { if (typeof body[k] === 'string') rec[k] = body[k]; });
  ['prixMax', 'piecesMin', 'surfaceMin', 'surfaceMax', 'apport'].forEach((k) => { if (body[k] !== undefined) rec[k] = Math.max(0, Number(body[k]) || 0); });
  if (Array.isArray(body.quartiers)) rec.quartiers = body.quartiers.map(String);
  if (Array.isArray(body.types)) rec.types = body.types.map(String);
  if (typeof body.courtier === 'boolean') rec.courtier = body.courtier;
  if (typeof body.bienAVendre === 'boolean') rec.bienAVendre = body.bienAVendre;
  writeDb(db);
  res.json({ ok: true, recherche: rec });
});

// ---- Fiche produit (HTML imprimable en PDF) ----
app.get('/api/biens/:id/pdf', (req, res) => {
  const db = readDb();
  const bien = db.biens.find((b) => b.id === req.params.id);
  if (!bien) return res.status(404).send('Bien introuvable');
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
        subject: (bien.titre || 'Un bien') + ' — ' + (bien.prix ? bien.prix.toLocaleString('fr-FR') + ' €' : ''),
        html: emailBienPreview(bien, nom, message) + '<p style="font-size:13px;color:#5f5a54;margin:18px 0 0;">Téléchargez la fiche confidentielle complète : <a href="' + originOf(req) + '/api/biens/' + bien.id + '/pdf" style="color:#3b2b4a;">voir la fiche (PDF)</a></p>'
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

app.get('/api/recherches', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, recherches: db.recherches });
});

// ---- Offres (Silent Offer) ----
app.post('/api/offres', requireAuth, (req, res) => {
  const bienId = String((req.body && req.body.bienId) || '');
  const montant = Number((req.body && req.body.montant) || 0) || 0;
  const message = String((req.body && req.body.message) || '');
  if (!bienId || !montant) return res.status(400).json({ error: 'Bien et montant requis' });
  const bien = req.db.biens.find((b) => b.id === bienId);
  const bienAdresse = bien ? (bien.adresse || bien.titre || '') : '';
  const offre = { id: uid('o'), bienId: bienId, leadId: req.lead.id, email: req.lead.email, nom: nomComplet(req.lead), montant: montant, message: message, statut: 'en_attente', cree: nowISO() };
  req.db.offres.unshift(offre);
  const demande = {
    id: uid('d'), type: 'offre', leadId: req.lead.id, bienId: bienId, email: req.lead.email,
    nom: nomComplet(req.lead), message: 'Montant : ' + montant.toLocaleString('fr-FR') + ' €' + (bienAdresse ? ' · ' + bienAdresse : '') + (message ? ' — ' + message : ''),
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
  writeDb(db);
  res.json({ ok: true });
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
  writeDb(db);
  res.json({ ok: true });
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
    res.json({ ok: false, error: 'Serveur Python injoignable (' + ROBOT_URL + '). Lancez ./start-local.command puis réessayez.', url: ROBOT_URL });
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
  res.json({ ok: true, biens: db.robotBiens || [] });
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
const ADEME_SELECT = 'etiquette_dpe,etiquette_ges,type_batiment,surface_habitable_logement,surface_habitable_immeuble,annee_construction,date_reception_dpe,date_etablissement_dpe,date_fin_validite_dpe,numero_dpe,adresse_ban,code_postal_ban,code_insee_ban,nom_commune_ban,coordonnee_cartographique_y_ban,coordonnee_cartographique_x_ban,conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2';

app.get('/api/robot/dpe', requireAdmin, async (req, res) => {
  const clauses = [];
  const qParts = [];
  const adresse = String(req.query.adresse || '').trim();
  const ville = normalizeVille(String(req.query.ville || '').trim());
  const codePostal = String(req.query.code_postal || '').trim();
  if (adresse) qParts.push(adresse);
  if (ville) qParts.push(ville);
  if (codePostal) qParts.push(codePostal);
  const q = qParts.join(' ');
  const classes = String(req.query.classes || '').toUpperCase().split(',').map((s) => s.trim()).filter((c) => /^[A-G]$/.test(c));
  const dateDebut = String(req.query.date_debut || '').trim();
  const dateFin = String(req.query.date_fin || '').trim();
  const surfaceMin = String(req.query.surface_min || '').trim();
  const surfaceMax = String(req.query.surface_max || '').trim();
  const type = String(req.query.type || '').trim().toLowerCase();
  const tri = String(req.query.tri || 'recent').trim();
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));

  if (!q) return res.status(400).json({ error: 'Saisissez une ville, une adresse ou un code postal.' });

  // Géo = full-text `q` (fiable) ; critères structurés = `qs` (sans code_postal_ban, bloqué par le WAF ADEME)
  if (classes.length === 1) clauses.push('etiquette_dpe:' + classes[0]);
  else if (classes.length > 1) clauses.push('(' + classes.map((c) => 'etiquette_dpe:' + c).join(' OR ') + ')');
  if (dateDebut || dateFin) clauses.push('date_reception_dpe:[' + (dateDebut || '*') + ' TO ' + (dateFin || '*') + ']');
  if (surfaceMin || surfaceMax) clauses.push('surface_habitable_logement:[' + (surfaceMin || '*') + ' TO ' + (surfaceMax || '*') + ']');
  if (type && type !== 'tout') clauses.push('type_batiment:' + type);

  const params = new URLSearchParams();
  params.set('size', String(limit));
  params.set('select', ADEME_SELECT);
  if (q) params.set('q', q);
  if (clauses.length) params.set('qs', clauses.join(' AND '));
  const sortMap = {
    recent: '-date_reception_dpe', ancien: 'date_reception_dpe',
    surface_desc: '-surface_habitable_logement', surface_asc: 'surface_habitable_logement',
    classe_asc: 'etiquette_dpe', classe_desc: '-etiquette_dpe'
  };
  if (sortMap[tri]) params.set('sort', sortMap[tri]);

  try {
    const r = await fetch(ADEME_URL + '?' + params.toString(), { headers: { 'User-Agent': 'Seecret/1.0 (immo-data-robot)', 'Accept': 'application/json' }, signal: AbortSignal.timeout(90000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const hint = (data.meta && data.meta.hints) ? ' ' + data.meta.hints.join(' ') : '';
      return res.status(502).json({ error: (data.detail || ('Erreur ADEME ' + r.status)) + hint });
    }
    res.json({ ok: true, source: 'ADEME dpe03existant', total: data.total || 0, count: (data.results || []).length, results: data.results || [] });
  } catch (e) {
    res.status(502).json({ error: 'API ADEME injoignable.' });
  }
});

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
    const r = await fetch('https://recherche-entreprises.api.gouv.fr/search?q=' + encodeURIComponent(siren), { signal: AbortSignal.timeout(15000) });
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

// Chemin du fichier DVF (ValeursFoncieres-*.txt). Configurable via la variable
// d'environnement DVF_PATH (ex. un volume Railway ou un stockage monté en
// production) — fallback sur le chemin de dev local si elle n'est pas définie.
const DVF_PATH = process.env.DVF_PATH || '/Users/taieb/Desktop/immo-data-robot-foundation/data/dvf/ValeursFoncieres-2025.txt';

// Historique des mutations foncières d'une parcelle (DVF). Lecture streaming,
// filtre sur code_departement|code_commune|prefixe|section|no_plan (commune sans zéros).
app.get('/api/robot/dvf', requireAdmin, async (req, res) => {
  const codeInsee = String(req.query.code_insee || '').trim();
  const section = String(req.query.section || '').trim().toUpperCase();
  const numero = String(req.query.numero || '').trim();
  if (!codeInsee || !section || !numero) return res.status(400).json({ error: 'code_insee, section et numero requis.' });
  const dept = codeInsee.slice(0, 2);
  const commune = String(parseInt(codeInsee.slice(2) || '0', 10));
  const plan = String(parseInt(numero, 10));
  const needle = '|' + dept + '|' + commune + '||' + section + '|' + plan + '|';
  const mutations = [];
  try {
    const { createReadStream } = require('fs');
    const { createInterface } = require('readline');
    const rl = createInterface({ input: createReadStream(DVF_PATH, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.includes(needle)) {
        const f = line.split('|');
        mutations.push({
          date: f[8] || '', nature: f[9] || '', valeur: f[10] || '',
          adresse: [f[13], f[14], f[15]].filter(Boolean).join(' ') || f[15] || '',
          codePostal: f[16] || '', commune: f[17] || '',
          typeLocal: f[36] || '', surface: f[38] || '', pieces: f[39] || '',
          section: f[21] || '', plan: f[22] || ''
        });
        if (mutations.length >= 100) break;
      }
    }
    res.json({ ok: true, parcelle: codeInsee + section + numero, mutations: mutations });
  } catch (e) {
    res.status(502).json({ error: 'Lecture DVF impossible : ' + String(e.message || e) });
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
  const dept = codeInsee.slice(0, 2);
  const commune = String(parseInt(codeInsee.slice(2) || '0', 10));
  const needle = '|' + dept + '|' + commune + '||';
  const comparables = [];
  try {
    const { createReadStream } = require('fs');
    const { createInterface } = require('readline');
    const rl = createInterface({ input: createReadStream(DVF_PATH, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes(needle)) continue;
      const f = line.split('|');
      const nature = f[9] || '';
      if (!/vente/i.test(nature)) continue; // écarte adjudications, expropriations, etc.
      const tl = f[36] || '';
      if (typeLocal && tl.toLowerCase() !== typeLocal.toLowerCase()) continue;
      const surface = parseFloat(String(f[38] || '').replace(',', '.'));
      // Comparables pertinents : surface à ±30 % de celle du bien à estimer (si fournie).
      if (surfaceCible && surface && (surface < surfaceCible * 0.7 || surface > surfaceCible * 1.3)) continue;
      comparables.push({
        date: f[8] || '', nature: nature, valeur: f[10] || '',
        adresse: [f[13], f[14], f[15]].filter(Boolean).join(' ') || f[15] || '',
        typeLocal: tl, surface: f[38] || '', pieces: f[39] || ''
      });
      if (comparables.length >= 300) break;
    }
    const stats = statsPrixM2(comparables);
    res.json({ ok: true, codeInsee: codeInsee, typeLocal: typeLocal || 'tous types', comparables: comparables.slice(0, 20), stats: stats });
  } catch (e) {
    res.status(502).json({ error: 'Lecture DVF impossible : ' + String(e.message || e) });
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

// Transformer une prospection en Lead CRM
app.post('/api/leads', requireAdmin, (req, res) => {
  const db = readDb();
  const body = req.body || {};
  const nom = String(body.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Identité du propriétaire inconnue — impossible de créer un Lead nominatif.' });
  const email = String(body.email || '').trim().toLowerCase();
  const siren = String(body.siren || '').trim();
  const tel = String(body.tel || '').trim();
  const adresseBien = String(body.adresseBien || body.adresse || '').trim();
  // Anti-doublons : email, SIREN, nom complet, ou bien (adresse normalisée + parcelle)
  if (email && db.leads.some((l) => (l.email || '').toLowerCase() === email)) {
    return res.status(409).json({ error: 'Un lead avec cet email existe déjà.' });
  }
  if (siren && db.leads.some((l) => (l.siren || '') === siren)) {
    return res.status(409).json({ error: 'Une société avec ce SIREN existe déjà.' });
  }
  if (db.leads.some((l) => ((l.nom || '') + ' ' + (l.prenom || '')).trim().toLowerCase() === nom.toLowerCase())) {
    return res.status(409).json({ error: 'Un lead avec ce nom existe déjà.' });
  }
  const lead = {
    id: uid('l'), prenom: String(body.prenom || ''), nom: nom, email: email, tel: tel,
    ville: String(body.ville || ''), projet: 'prospect', role: 'membre', type: String(body.type || 'personne'),
    siren: siren, dirigeants: Array.isArray(body.dirigeants) ? body.dirigeants : [],
    source: 'Immo Data Robot', statut: 'prospect', budgetMax: 0, quartiers: [], piecesMin: 0, surfaceMin: 0,
    notes: String(body.notes || ''), adresseBien: adresseBien, parcelle: String(body.parcelle || ''),
    dpe: String(body.dpe || ''), cree: nowISO()
  };
  db.leads.push(lead);
  writeDb(db);
  res.json({ ok: true, lead: lead });
});

app.get('/api/leads', requireAdmin, (req, res) => {
  const db = readDb();
  const leads = db.leads.map((l) => {
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
  const statut = String((req.body && req.body.statut) || 'accepte');
  lead.statut = statut;
  writeDb(db);
  res.json({ ok: true, lead: { id: lead.id, statut: lead.statut } });
});

app.get('/api/leads/:id/documents', requireAdmin, (req, res) => {
  const db = readDb();
  const lead = db.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  res.json({ ok: true, documents: (lead.documents || []).slice().reverse(), types: TYPES_DOC });
});

app.patch('/api/documents/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const statut = (req.body && req.body.statut) === 'refuse' ? 'refuse' : 'valide';
  let found = null;
  db.leads.forEach((l) => (l.documents || []).forEach((d) => {
    if (d.id === req.params.id) { d.statut = statut; d.valideAt = nowISO(); found = d; }
  }));
  if (!found) return res.status(404).json({ error: 'Document introuvable' });
  writeDb(db);
  res.json({ ok: true, document: found });
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
  if (lead) {
    lead.statut = 'accepte';
    (lead.documents || []).forEach((d) => { d.statut = 'valide'; d.valideAt = nowISO(); });
    logActivite(db, { leadId: lead.id, type: 'admission', auteur: 'Agent' });
  }
  tache.statut = 'validee';
  tache.traiteeAt = nowISO();
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/refuser', requireAdmin, (req, res) => {
  const db = readDb();
  const tache = db.tasks.find((t) => t.id === req.params.id);
  if (!tache) return res.status(404).json({ error: 'Tâche introuvable' });
  tache.statut = 'refusee';
  tache.traiteeAt = nowISO();
  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/demandes', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ ok: true, demandes: db.demandes });
});

app.patch('/api/demandes/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const d = db.demandes.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  d.statut = 'traitee';
  d.traiteeAt = nowISO();
  if (d.type === 'statut' && d.bienId) {
    const b = db.biens.find((x) => x.id === d.bienId);
    if (b) {
      b.statut = (req.body && req.body.action) === 'vente' ? 'vendu' : 'ouvert';
      b.statutDemande = null;
    }
  }
  writeDb(db);
  res.json({ ok: true });
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
  if (decision === 'refuser') {
    d.statut = 'refusee';
    d.traiteeAt = nowISO();
    writeDb(db);
    return res.json({ ok: true, decision: 'refuser', lien: lien, tel: tel, prenom: prenom });
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
    writeDb(db);
    return res.json({ ok: true, decision: 'suspendre', lien: lien, tel: tel, prenom: prenom });
  }

  d.statut = 'traitee';
  d.traiteeAt = nowISO();

  if (d.type === 'candidature') {
    const token = crypto.randomBytes(32).toString('hex');
    db.magicLinks.push({ id: sha256(token), codeHash: sha256(crypto.randomBytes(16).toString('hex')), leadId: lead ? lead.id : null, email: d.email, cree: nowISO(), expire: Date.now() + MAGIC_TTL, utilise: false, codeUtilise: false });
    if (lead) {
      lead.statut = 'accepte';
      logActivite(db, { leadId: lead.id, type: 'admission', auteur: 'Agent' });
      if (!db.biens.some((x) => x.leadId === lead.id || (x.email || '').toLowerCase() === (lead.email || '').toLowerCase())) {
        const nb = { id: uid('mb'), leadId: lead.id, email: lead.email, nom: ((lead.prenom || '') + ' ' + (lead.nom || '')).trim(), titre: '', adresse: '', codePostal: '', ville: '', type: 'Appartement', quartier: '', transaction: 'Vente', surface: 0, pieces: 0, chambres: 0, sdb: 0, etage: '', ascenseur: false, anneeConstruction: 0, etat: '', dpe: '', ges: '', exterieur: '', surfaceExterieur: 0, annexes: [], prix: 0, charges: 0, description: '', photos: [], atouts: [], exclusivite: { statut: 'scan_en_cours', liens: [] }, statut: 'brouillon', statutDemande: null, suiveurs: 0, agent: DEFAULT_AGENT_NOM, cree: nowISO() };
        db.biens.push(nb);
        lancerScanExclusivite(nb.id).catch(() => {});
      }
      if (!db.recherches.some((x) => x.clientId === lead.id)) {
        db.recherches.push({ id: uid('r'), clientId: lead.id, titre: 'Recherche de ' + ((lead.prenom || '') + ' ' + (lead.nom || '')).trim(), types: [], type: '', quartiers: lead.quartiers || [], prixMax: lead.budgetMax || 0, piecesMin: lead.piecesMin || 0, surfaceMin: lead.surfaceMin || 0, delai: '', apport: 0, financement: '', courtier: false, statut: 'active', alertes: true, cree: nowISO() });
      }
    }
    lien = originOf(req) + '/espace.html?token=' + token;
    if (mailer) {
      try {
        await mailer.sendMail({
          from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
          to: d.email,
          subject: 'Félicitations, votre accès à Seecret est validé',
          html: emailValidationPremium(prenom, lien)
        });
        emailEnvoye = true;
      } catch (err) { emailErreur = (err && err.message) || 'Erreur SMTP'; }
    }
  } else if (d.type === 'statut' && d.bienId) {
    const b = db.biens.find((x) => x.id === d.bienId);
    if (b) { b.statut = d.role === 'vente' ? 'mandat' : 'ouvert'; b.statutDemande = null; }
    if (mailer) {
      mailer.sendMail({
        from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
        to: d.email,
        subject: 'Votre demande est validée',
        html: emailValidationLegere(prenom, 'Votre demande de changement de statut a été validée par l’agence.')
      }).catch((err) => console.error('[email] envoi échoué :', err.message));
    }
  } else if (d.type === 'modification') {
    if (d.bienId) {
      const b = db.biens.find((x) => x.id === d.bienId);
      if (b) {
        if (d.prix) b.prix = d.prix;
        if (d.titre) b.titre = d.titre;
        if (d.description) b.description = d.description;
      }
    }
    if (mailer) {
      mailer.sendMail({
        from: '"Bonjour Seecret" <' + FROM_EMAIL + '>',
        to: d.email,
        subject: 'Votre modification est validée',
        html: emailValidationLegere(prenom, 'Votre demande de modification a été validée par l’agence.')
      }).catch((err) => console.error('[email] envoi échoué :', err.message));
    }
  }

  writeDb(db);
  res.json({ ok: true, decision: 'valider', lien: lien, tel: tel, prenom: prenom, emailEnvoye: emailEnvoye, emailErreur: emailErreur });
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
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
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

function trouverLeadParNom(db, texte) {
  const q = String(texte || '').trim().toLowerCase();
  if (!q) return null;
  let lead = db.leads.find((l) => ((l.prenom || '') + ' ' + (l.nom || '')).trim().toLowerCase() === q);
  if (lead) return lead;
  const candidats = db.leads.filter((l) => (l.nom || '').length > 1 && q.indexOf((l.nom || '').toLowerCase()) > -1);
  candidats.sort((a, b) => new Date(b.cree) - new Date(a.cree));
  return candidats[0] || null;
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
      trouverLeadParNom(db, ((input.prenom || '') + ' ' + nom).trim());
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
    if (!lead) return { resultat: { ok: false, erreur: 'Lead introuvable : ' + input.nomComplet } };
    const avant = lead.pipeline;
    lead.pipeline = String(input.statut || '').slice(0, 40);
    if (avant !== lead.pipeline && (lead.pipeline === 'a_relancer' || lead.pipeline === 'converti')) {
      logActivite(db, { leadId: lead.id, type: lead.pipeline === 'converti' ? 'converti' : 'retour_silence', auteur: auteur });
    }
    return { resultat: { ok: true }, resume: 'Statut mis à jour (' + lead.pipeline + ') : ' + nomComplet(lead), lien: '/crm.html#/client/' + lead.id };
  }

  if (nomOutil === 'programmer_rappel') {
    const lead = trouverLeadParNom(db, input.nomComplet);
    if (!lead) return { resultat: { ok: false, erreur: 'Lead introuvable : ' + input.nomComplet } };
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
    if (!lead) return { resultat: { ok: false, erreur: 'Lead introuvable : ' + input.nomComplet } };
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
    if (!lead) return { resultat: { ok: false, erreur: 'Lead introuvable : ' + input.nomComplet } };
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
    if (!lead) return { resultat: { ok: false, erreur: 'Lead introuvable : ' + input.nomComplet } };
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

// Accès au CRM : réservé aux administrateurs. Les autres sont renvoyés à la connexion.
app.get('/crm.html', (req, res, next) => {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return res.redirect('/espace.html');
  const db = readDb();
  pruneAuth(db);
  const session = db.sessions.find((s) => s.id === sha256(token));
  const lead = session ? db.leads.find((l) => l.id === session.leadId) : null;
  const role = roleOf(lead);
  if (role !== 'admin' && role !== 'superadmin') return res.redirect('/espace.html');
  next();
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  try { writeDb(readDb()); } catch (e) { /* migration leadId */ }
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
});
