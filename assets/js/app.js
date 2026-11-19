/* ------------------------------------------------------------------
   Seecret — Espace membre (back office)
   100 % statique : état dans localStorage, aucun serveur.
   Routes : #/connexion #/accueil #/mon-bien #/catalogue #/bien/:id
            #/visites #/offres #/messages #/profil #/outils #/agence
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ============================== utilitaires ============================== */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const num = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
  const uid = (p) => (p || 'id') + Math.random().toString(36).slice(2, 9);
  const nowISO = () => new Date().toISOString();
  const dateFR = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFR = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);

  /* ============================== réseau ============================== */
  const API = {
    async get(url) {
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erreur ' + r.status);
      return d;
    },
    async send(method, url, body) {
      const r = await fetch(url, {
        method: method, credentials: 'same-origin',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erreur ' + r.status);
      return d;
    },
    async upload(url, form) {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Erreur ' + r.status);
      return d;
    }
  };

  const ICONS = {
    home: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"/></svg>',
    building: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V4h8v13M12 8h4v9M2 17h16"/><path d="M7 7h2M7 10h2M7 13h2"/></svg>',
    grid: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>',
    calendar: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/></svg>',
    tag: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3H17v6.5L9.8 16.7a1.6 1.6 0 0 1-2.3 0L3.3 12.5a1.6 1.6 0 0 1 0-2.3z"/><circle cx="13.6" cy="6.4" r="1.1"/></svg>',
    chat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 9.5a6.5 6.5 0 0 1-9.4 5.8L3 16.5l1.2-4.4A6.5 6.5 0 1 1 17 9.5z"/></svg>',
    tools: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12.5 7.5 5 5-3 3-5-5M7.5 12.5l-5-5 3-3 5 5"/><path d="m3 17 2.5-2.5M14.5 5.5 17 3"/></svg>',
    users: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="7" r="3"/><path d="M2.5 17a5.5 5.5 0 0 1 11 0M13.5 4.2a3 3 0 0 1 0 5.6M15 12.4a5 5 0 0 1 2.5 4.6"/></svg>',
    user: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.5" r="3.2"/><path d="M3.5 17a6.5 6.5 0 0 1 13 0"/></svg>',
    arrow: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11M11 6l4 4-4 4"/></svg>',
    check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10.5 4 4 8-9"/></svg>',
    plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>',
    eye: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.2"/></svg>',
    out: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M13 6l4 4-4 4M17 10H7"/></svg>'
  };

  /* ================================= données ============================== */

  const KEY = 'seecret.espace.v1';
  const MEMBRES = 'seecret.membres.v1';
  const BIENS = 'seecret.biens.v1';

  const PRIX_M2 = { 1: 13800, 2: 11200, 3: 12500, 4: 12400, 5: 13300, 6: 14600, 7: 14300, 8: 12000, 9: 10500, 10: 10800, 11: 9800, 12: 9400, 13: 9200, 14: 9000, 15: 10200, 16: 11500, 17: 10100, 18: 8900, 19: 8300, 20: 7900 };

  // mandat/sous-compromis manquaient ici : tant que le catalogue n'affichait
  // que des biens de démonstration (toujours avant-premiere/ouvert/sous-offre),
  // ça ne se voyait pas. Avec de vrais biens venus du CRM (qui connaît aussi
  // mandat et sous-compromis, cf. ST_BIEN de crm.js), un bien en mandat
  // retombait sur le label par défaut "Brouillon" — trompeur pour un membre,
  // qui pouvait croire le bien non réel alors qu'il est bien validé.
  const STATUTS = {
    brouillon: { label: 'Brouillon', cls: 'muted' },
    mandat: { label: 'Mandat signé', cls: '' },
    'avant-premiere': { label: 'Avant-première', cls: '' },
    ouvert: { label: 'Ouvert aux visites', cls: 'open' },
    'sous-offre': { label: 'Sous offre', cls: 'offer' },
    'sous-compromis': { label: 'Sous compromis', cls: 'offer' },
    vendu: { label: 'Vendu', cls: 'muted' }
  };
  // Ce que voit un membre dans le catalogue des AUTRES biens se limite à deux
  // statuts réels : avant-première (visible, visites pas encore ouvertes) et
  // ouvert (visite ouverte). Dès qu'un bien passe sous offre, sous compromis
  // ou vendu, il quitte la plateforme — ce sont des étapes internes au suivi
  // de la vente par l'agence, pas des statuts à afficher aux membres. (Le
  // libellé complet de STATUTS ci-dessus reste utile par ailleurs pour que
  // le membre voie le vrai statut de SON PROPRE bien sur sa page "Mon bien".)
  const surLaPlateforme = (statut) => statut === 'avant-premiere' || statut === 'ouvert';

  const TYPES = ['Appartement', 'Maison', 'Duplex', 'Loft', 'Hôtel particulier', 'Terrain'];

  const ATOUTS = ['Terrasse', 'Jardin', 'Vue', 'Parquet d’origine', 'Cheminée', 'Verrière', 'Ascenseur', 'Cave', 'Parking', 'Dernier étage', 'Calme', 'Lumineux'];

  const QUARTIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => ({
    id: 'p' + n,
    arrondissement: n,
    label: 'Paris ' + n + (n === 1 ? 'ᵉʳ' : 'ᵉ'),
    ville: 'Paris'
  })).concat([
    { id: 'boulogne', arrondissement: 0, label: 'Boulogne-Billancourt', ville: 'Boulogne-Billancourt' },
    { id: 'neuilly', arrondissement: 0, label: 'Neuilly-sur-Seine', ville: 'Neuilly-sur-Seine' },
    { id: 'vincennes', arrondissement: 0, label: 'Vincennes', ville: 'Vincennes' }
  ]);

  function seedBiens() {
    return [
      {
        id: 'b1', type: 'Appartement', quartier: 'p4', label: 'Paris 4ᵉ', titre: 'Quatre pièces sur la Seine',
        surface: 112, pieces: 4, chambres: 2, sdb: 2, etage: '3ᵉ', dpe: 'D', prix: 2079000,
        description: 'La Seine par trois fenêtres, un parquet de Versailles d’origine, et la lumière des quatre expositions.',
        atouts: ['Vue', 'Parquet d’origine', 'Calme'], photos: ['ilesaintlouis-1.jpg', 'ilesaintlouis-3.jpg'],
        statut: 'avant-premiere', suiveurs: 14, cree: '2026-10-02T10:00:00.000Z', mien: false
      },
      {
        id: 'b2', type: 'Maison', quartier: 'p18', label: 'Paris 18ᵉ', titre: 'La maison au figuier',
        surface: 96, pieces: 4, chambres: 2, sdb: 2, etage: 'RDC', dpe: 'E', prix: 1270500,
        description: 'Une verrière d’atelier qui prend la lumière du nord toute la journée, et un figuier dans la cour.',
        atouts: ['Jardin', 'Verrière', 'Calme'], photos: ['montmartre-1.jpg', 'montmartre-3.jpg'],
        statut: 'avant-premiere', suiveurs: 9, cree: '2026-10-06T10:00:00.000Z', mien: false
      },
      {
        id: 'b3', type: 'Duplex', quartier: 'p6', label: 'Paris 6ᵉ', titre: 'Les deux derniers étages',
        surface: 128, pieces: 4, chambres: 3, sdb: 2, etage: '5ᵉ', dpe: 'C', prix: 2604000,
        description: 'Deux niveaux qui se répondent, une terrasse plein sud, et l’adresse la plus sûre de la rive gauche.',
        atouts: ['Terrasse', 'Dernier étage', 'Lumineux'], photos: ['saintgermain-1.jpg', 'saintgermain-3.jpg'],
        statut: 'ouvert', suiveurs: 23, cree: '2026-09-18T10:00:00.000Z', mien: false
      },
      {
        id: 'b4', type: 'Appartement', quartier: 'p16', label: 'Paris 16ᵉ', titre: 'Six pièces face aux toits',
        surface: 185, pieces: 6, chambres: 4, sdb: 3, etage: '6ᵉ', dpe: 'D', prix: 3412500,
        description: 'La rotonde du dernier étage, une vue que rien ne viendra fermer, et l’ascenseur d’époque.',
        atouts: ['Vue', 'Ascenseur', 'Dernier étage'], photos: ['trocadero-1.jpg', 'home-5.jpg'],
        statut: 'avant-premiere', suiveurs: 31, cree: '2026-10-10T10:00:00.000Z', mien: false
      },
      {
        id: 'b5', type: 'Loft', quartier: 'p3', label: 'Paris 3ᵉ', titre: 'L’atelier et sa verrière',
        surface: 142, pieces: 3, chambres: 2, sdb: 2, etage: '4ᵉ', dpe: 'C', prix: 1774500,
        description: 'Des moulures d’origine, le calme d’un dernier étage, et Paris qui se déplie par les fenêtres.',
        atouts: ['Verrière', 'Dernier étage', 'Calme'], photos: ['marais-1.jpg', 'home-loft-bright.jpg'],
        statut: 'avant-premiere', suiveurs: 18, cree: '2026-10-12T10:00:00.000Z', mien: false
      },
      {
        id: 'b6', type: 'Appartement', quartier: 'p7', label: 'Paris 7ᵉ', titre: 'Un rez-de-jardin rue de Grenelle',
        surface: 138, pieces: 5, chambres: 3, sdb: 2, etage: 'RDC', dpe: 'D', prix: 2350000,
        description: 'Un jardin de 90 m² à l’abri des regards, deux expositions, et le silence d’une cour pavée.',
        atouts: ['Jardin', 'Calme', 'Cheminée'], photos: ['home-jardin.jpg', 'home-1.jpg'],
        statut: 'ouvert', suiveurs: 27, cree: '2026-09-28T10:00:00.000Z', mien: false
      },
      {
        id: 'b7', type: 'Appartement', quartier: 'p9', label: 'Paris 9ᵉ', titre: 'Sous les toits de Notre-Dame',
        surface: 88, pieces: 3, chambres: 2, sdb: 1, etage: '5ᵉ', dpe: 'E', prix: 1415000,
        description: 'Une charpente apparente, une verrière plein ciel et le marché Saint-Georges à trois minutes.',
        atouts: ['Dernier étage', 'Lumineux'], photos: ['home-5.jpg', 'home-3.jpg'],
        statut: 'avant-premiere', suiveurs: 12, cree: '2026-10-14T10:00:00.000Z', mien: false
      },
      {
        id: 'b8', type: 'Maison', quartier: 'boulogne', label: 'Boulogne-Billancourt', titre: 'La maison des deux cèdres',
        surface: 210, pieces: 7, chambres: 4, sdb: 3, etage: 'R+2', dpe: 'C', prix: 2890000,
        description: 'Un jardin planté de deux cèdres centenaires, une véranda d’hiver et un garage double.',
        atouts: ['Jardin', 'Parking', 'Calme'], photos: ['home-6.jpg', 'home-3.jpg'],
        statut: 'sous-offre', suiveurs: 21, cree: '2026-09-05T10:00:00.000Z', mien: false
      }
    ];
  }

  function seedState() {
    return {
      v: 1,
      session: null,
      membre: null,
      docs: [],
      mesNotifications: [],
      profil: {
        prenom: 'Camille', nom: 'Renaud', email: '', tel: '', ville: 'Paris',
        role: 'acheteur-vendeur',
        verifications: { identite: false, financement: false, bien: false },
        notifs: { email: true, whatsapp: true, visites: true, offres: true },
        agent: { nom: 'Gabriel Taieb', role: 'Agent Seecret · Paris centre' }
      },
      monBien: null,
      // Avant ce correctif, le catalogue n'affichait que des biens de
      // démonstration codés en dur, sans aucun lien avec le CRM : un bien
      // validé par un agent n'apparaissait jamais ici. demarrer() le
      // remplace par le vrai catalogue (/api/catalogue) une fois le membre
      // authentifié ; vide par défaut pour ne jamais montrer de faux biens
      // à un vrai membre avant ou en l'absence de connexion.
      biens: [],
      suivis: ['b3'],
      visites: [],
      offres: [],
      compare: [],
      messages: [
        { de: 'agent', texte: 'Bonjour Camille. Un propriétaire vient d’ouvrir ses visites dans le 6ᵉ. Deux derniers étages, 128 m², vue sur les toits. Je vous l’envoie ?', at: '2026-10-20T09:12:00.000Z' },
        { de: 'moi', texte: 'Avec plaisir.', at: '2026-10-20T09:20:00.000Z' },
        { de: 'agent', texte: 'Voici la fiche. Le propriétaire reçoit jeudi et vendredi. Je vous réserve un créneau ?', at: '2026-10-20T09:21:00.000Z' }
      ],
      onboarding: { etape: 1, fait: false },
      recherche: { types: [], quartiers: [], prixMax: '', piecesMin: '', surfaceMin: '', surfaceMax: '' }
    };
  }

  let state = load();
  let modal = null;
  let monBienEdit = false;
  let draftPhotos = null;
  let lastRoute = '';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) return Object.assign(seedState(), parsed);
      }
    } catch (e) { /* localStorage indisponible : on reste en mémoire */ }
    return seedState();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function commit() { save(); render(); }

  /* ---------- passerelle parcours / agence (seecret.biens.v1) ---------- */
  function readBiens() {
    try { return JSON.parse(localStorage.getItem(BIENS) || '[]'); } catch (e) { return []; }
  }
  function readMembres() {
    try { return JSON.parse(localStorage.getItem(MEMBRES) || '[]'); } catch (e) { return []; }
  }
  function writeBiens(list) {
    try { localStorage.setItem(BIENS, JSON.stringify((list || []).slice(0, 60))); } catch (e) { /* ignore */ }
  }
  function syncFromParcours(email) {
    if (!email) return;
    const membres = readMembres();
    const m = membres.find((x) => (x.email || '').toLowerCase() === String(email).toLowerCase()) || (membres.length ? membres[membres.length - 1] : null);
    if (m) {
      state.profil.prenom = m.prenom || state.profil.prenom;
      state.profil.nom = m.nom || state.profil.nom;
      state.profil.tel = m.tel || state.profil.tel;
      state.profil.ville = m.ville || state.profil.ville;
      if (m.role) state.profil.role = m.role;
    }
    const biens = readBiens();
    const mb = biens.find((b) => (b.email || '').toLowerCase() === String(email).toLowerCase());
    if (mb) {
      const prev = state.monBien;
      state.monBien = Object.assign({}, mb, {
        mien: true,
        label: nomQuartier(mb.quartier),
        suiveurs: mb.suiveurs || (prev ? prev.suiveurs : 0)
      });
    }
  }

  /* ============================== sélecteurs ============================== */

  const bien = (id) => state.biens.find((b) => b.id === id) || (state.monBien && state.monBien.id === id ? state.monBien : null);
  const tousBiens = () => (state.monBien ? [state.monBien].concat(state.biens) : state.biens);
  const maFiche = () => (state.monBien ? state.monBien : null);

  // Complétude de la fiche bien — chaque champ compte, 100 % débloque le marché.
  function completionOf(b) {
    if (!b) return { pct: 0, complet: false, manquants: [] };
    const v = (x) => (typeof x === 'string' ? x.trim() : x);
    const items = [
      ['Type de bien', !!v(b.type)],
      ['Transaction', !!v(b.transaction)],
      ['Titre', !!v(b.titre)],
      ['Description', !!v(b.description)],
      ['Adresse', !!v(b.adresse)],
      ['Ville', !!v(b.ville)],
      ['Code postal', !!v(b.codePostal)],
      ['Quartier', !!v(b.quartier)],
      ['Surface', Number(b.surface) > 0],
      ['Pièces', Number(b.pieces) > 0],
      ['Étage', !!v(b.etage)],
      ['État', !!v(b.etat)],
      ['Année de construction', Number(b.anneeConstruction) > 0],
      ['DPE', !!v(b.dpe)],
      ['GES', !!v(b.ges)],
      ['Prix', Number(b.prix) > 0],
      ['3 photos minimum', ((b.photos || []).length) >= 3]
    ];
    const manquants = items.filter((x) => !x[1]).map((x) => x[0]);
    const pct = Math.round(((items.length - manquants.length) / items.length) * 100);
    return { pct: pct, complet: manquants.length === 0, manquants: manquants };
  }
  const membreValide = () => !!(state.membre && state.membre.statut === 'accepte');
  const bienValide = () => !!(state.monBien && state.monBien.validation === 'valide');
  const marcheDebloque = () => membreValide() && bienValide();
  const estVerrouille = (b) => !!(b && !b.mien && !marcheDebloque());
  // Un membre sans bien (acheteur simple) ne voit jamais les avant-premières.
  const visiblesPourMembre = (list) => {
    const estAcheteur = state.membre && state.membre.typeMembre === 'membre_acheteur';
    return list.filter((b) => surLaPlateforme(b.statut) && (!estAcheteur || b.statut === 'ouvert'));
  };
  const nomQuartier = (id) => (QUARTIERS.find((q) => q.id === id) || { label: id }).label;
  const prixM2 = (b) => (b.surface ? Math.round(b.prix / b.surface) : 0);
  const suivisCount = () => state.suivis.length;
  const visitesEnAttente = () => state.visites.filter((v) => v.statut === 'demandee').length;
  const offresRecues = () => state.offres.filter((o) => o.sens === 'recue' && o.statut === 'recue').length;
  const offresEnCours = () => state.offres.filter((o) => o.statut === 'envoyee' || o.statut === 'recue').length;

  /* ================================ rendu ================================ */

  /* ---------- écoles, coordonnées approx, estimation (page produit) ---------- */
  const ECOLES = {
    p1: { primaire: 'École élémentaire Louvre', college: 'Collège Malherbe', lycee: 'Lycée Charlemagne' },
    p2: { primaire: 'École élémentaire Montorgueil', college: 'Collège Béranger', lycee: 'Lycée Voltaire' },
    p3: { primaire: 'École élémentaire Bretagne', college: 'Collège Pierre-Jean-de-Béranger', lycee: 'Lycée Victor-Hugo' },
    p4: { primaire: 'École élémentaire Saint-Paul', college: 'Collège Massillon', lycee: 'Lycée Charlemagne' },
    p5: { primaire: 'École élémentaire Buffon', college: 'Collège Valmy', lycee: 'Lycée Lavoisier' },
    p6: { primaire: 'École élémentaire Cherche-Midi', college: 'Collège Sévigné', lycee: 'Lycée Montaigne' },
    p7: { primaire: 'École élémentaire Grenelle', college: 'Collège Évariste-Galois', lycee: 'Lycée Victor-Duruy' },
    p8: { primaire: 'École élémentaire Monceau', college: 'Collège Condorcet', lycee: 'Lycée Carnot' },
    p9: { primaire: 'École élémentaire Saint-Georges', college: 'Collège Lamartine', lycee: 'Lycée Jules-Ferry' },
    p10: { primaire: 'École élémentaire Saint-Maur', college: 'Collège Jean-Baptiste-Clément', lycee: 'Lycée Colbert' },
    p11: { primaire: 'École élémentaire Voltaire', college: 'Collège Léon-Gambetta', lycee: 'Lycée Voltaire' },
    p12: { primaire: 'École élémentaire Daumesnil', college: 'Collège Élisa-Lemonnier', lycee: 'Lycée Paul-Valéry' },
    p13: { primaire: 'École élémentaire Jeanne-d\'Arc', college: 'Collège Claude-Monet', lycee: 'Lycée Claude-Monet' },
    p14: { primaire: 'École élémentaire Montsouris', college: 'Collège Jean-Moulin', lycee: 'Lycée Rodin' },
    p15: { primaire: 'École élémentaire Grenelle', college: 'Collège Camille-Sée', lycee: 'Lycée Buffon' },
    p16: { primaire: 'École élémentaire Passy', college: 'Collège La Fontaine', lycee: 'Lycée Jean-de-La-Fontaine' },
    p17: { primaire: 'École élémentaire Batignolles', college: 'Collège Carnot', lycee: 'Lycée Chaptal' },
    p18: { primaire: 'École élémentaire Montmartre', college: 'Collège Yvonne-Le-Tac', lycee: 'Lycée Jacques-Decour' },
    p19: { primaire: 'École élémentaire Buttes-Chaumont', college: 'Collège Georges-Méliès', lycee: 'Lycée Hélène-Boucher' },
    p20: { primaire: 'École élémentaire Belleville', college: 'Collège Pierre-Mendès-France', lycee: 'Lycée Maurice-Ravel' },
    boulogne: { primaire: 'École élémentaire Jean-Jaurès', college: 'Collège Jean-Renoir', lycee: 'Lycée Jacques-Prévert' },
    neuilly: { primaire: 'École élémentaire Peretti', college: 'Collège Théophile-Gautier', lycee: 'Lycée Pasteur' },
    vincennes: { primaire: 'École élémentaire Est', college: 'Collège Antoine-de-Saint-Exupéry', lycee: 'Lycée Hector-Berlioz' }
  };
  const COORDS = {
    p1: [48.863, 2.336], p2: [48.867, 2.341], p3: [48.864, 2.362], p4: [48.856, 2.355],
    p5: [48.846, 2.350], p6: [48.850, 2.332], p7: [48.858, 2.310], p8: [48.873, 2.308],
    p9: [48.877, 2.336], p10: [48.871, 2.356], p11: [48.858, 2.379], p12: [48.841, 2.387],
    p13: [48.832, 2.356], p14: [48.833, 2.324], p15: [48.842, 2.292], p16: [48.864, 2.276],
    p17: [48.885, 2.322], p18: [48.892, 2.344], p19: [48.882, 2.382], p20: [48.865, 2.398],
    boulogne: [48.835, 2.241], neuilly: [48.884, 2.268], vincennes: [48.848, 2.439]
  };
  function pm2Of(b) {
    const q = QUARTIERS.find((x) => x.id === b.quartier);
    return PRIX_M2[q ? q.arrondissement : 0] || 10000;
  }
  function estimationBien(b) {
    let p = (b.surface || 0) * pm2Of(b);
    const et = String(b.etage || '').toLowerCase();
    if (/dernier|6e|7e/.test(et)) p *= 1.05;
    if (b.dpe === 'A' || b.dpe === 'B') p *= 1.04;
    if (b.dpe === 'F' || b.dpe === 'G') p *= 0.94;
    if ((b.atouts || []).some((a) => /terrasse|jardin|vue/i.test(a))) p *= 1.06;
    if ((b.atouts || []).some((a) => /renov/i.test(a))) p *= 0.92;
    return Math.round(p / 1000) * 1000;
  }
  function evolutionBars(pm2) {
    const bars = [];
    for (let m = 0; m < 12; m++) bars.push(pm2 * (1 + 0.004 * m + 0.005 * Math.sin(m * 0.7)));
    const min = Math.min.apply(null, bars);
    const max = Math.max.apply(null, bars);
    return '<div class="se-evo">' + bars.map((v) => '<i style="height:' + Math.round(18 + 82 * (v - min) / (max - min || 1)) + '%"></i>').join('') + '</div>';
  }
  function mapEmbed(b) {
    const c = COORDS[b.quartier] || [48.8566, 2.3522];
    const label = nomQuartier(b.quartier);
    const x = Math.round(8 + 84 * (c[1] - 2.24) / 0.28);
    const y = Math.round(12 + 76 * (48.98 - c[0]) / 0.18);
    return '<div class="se-map">' +
      '<div class="se-map-grid"></div>' +
      '<svg class="se-map-pin" viewBox="0 0 24 24" style="left:' + x + '%;top:' + y + '%"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>' +
      '<div class="se-map-label">' + esc(label) + '<span>Localisation approximative</span></div>' +
    '</div>';
  }
  function ecolesBlock(b) {
    const e = ECOLES[b.quartier] || { primaire: 'Sectorisation à confirmer', college: 'Sectorisation à confirmer', lycee: 'Sectorisation à confirmer' };
    return '<div class="se-card"><h3>Écoles à proximité</h3><p class="se-muted">Sectorisation indicative du quartier.</p>' +
      '<div class="se-ecoles">' +
        '<div><span class="kicker">Primaire</span><b>' + esc(e.primaire) + '</b></div>' +
        '<div><span class="kicker">Collège</span><b>' + esc(e.college) + '</b></div>' +
        '<div><span class="kicker">Lycée</span><b>' + esc(e.lycee) + '</b></div>' +
      '</div></div>';
  }
  function carouselSuivis(list) {
    return '<div class="se-hero" data-hero>' +
      list.map((b, i) => '<div class="se-hero-slide ' + (i === 0 ? 'on' : '') + '">' +
        (photoOf(b) ? '<img src="' + photoOf(b) + '" alt=""/>' : '') +
        '<div class="se-hero-grad"></div>' +
        '<div class="se-hero-txt">' +
          '<span class="kicker" style="color:rgba(255,255,255,.72)">Le plus suivi du mois</span>' +
          '<h3>' + esc(b.titre) + '</h3>' +
          '<div style="color:rgba(255,255,255,.85);font-size:13.5px">' + esc(b.label) + ' · ' + euro(b.prix) + ' · ' + num(b.suiveurs || 0) + ' membres le suivent</div>' +
          '<a class="se-btn light" href="#/bien/' + b.id + '" style="margin-top:14px">Découvrir ' + ICONS.arrow + '</a>' +
        '</div>' +
      '</div>').join('') +
      '<div class="se-hero-dots">' + list.map((_, i) => '<button type="button" data-hero-dot="' + i + '" class="' + (i === 0 ? 'on' : '') + '"></button>').join('') + '</div>' +
    '</div>';
  }
  function sectionMaRecherche(matchs, rec) {
    const crit = (rec && rec.quartiers && rec.quartiers.length ? rec.quartiers.map(nomQuartier).join(' · ') : 'Tous secteurs') +
      (rec && rec.prixMax ? ' · ≤ ' + euro(rec.prixMax) : '') +
      (rec && rec.piecesMin ? ' · ' + rec.piecesMin + '+ pièces' : '');
    return '<div class="se-card" style="margin-bottom:18px">' +
      '<div class="se-row" style="justify-content:space-between;margin-bottom:4px">' +
        '<div><h3>Biens de ma recherche</h3><p class="se-muted" style="margin:0">' + esc(crit) + '</p></div>' +
        '<a class="se-btn ghost sm" href="#/catalogue">Tout le catalogue</a>' +
      '</div>' +
      (matchs.length ? '<div class="se-bien-grid" style="margin-top:14px">' + matchs.slice(0, 4).map(bienCard).join('') + '</div>'
        : '<p class="se-muted" style="margin-top:12px">Aucun bien ne correspond pour l’instant. Parcourez le catalogue ou affinez votre recherche.</p>') +
    '</div>';
  }
  function blocsBien(b) {
    const est = estimationBien(b);
    const pm2 = pm2Of(b);
    const delta = b.prix ? Math.round(((est - b.prix) / b.prix) * 1000) / 10 : 0;
    return '<div class="se-grid cols-2" style="margin-top:18px;align-items:start">' +
      '<div class="se-card">' +
        '<span class="kicker">Estimation Seecret</span>' +
        '<div class="se-estim-prix">' + euro(est) + '</div>' +
        '<div class="se-hint">' + euro(pm2) + ' / m² · ' + (delta > 0 ? '+' : '') + delta + ' % vs votre prix</div>' +
        evolutionBars(pm2) +
        '<div class="se-hint">Évolution estimée sur 12 mois</div>' +
        '<div class="se-note" style="margin-top:14px">Une estimation précise pourra être réalisée avant la mise sur la plateforme du bien.</div>' +
      '</div>' +
      '<div class="se-card" style="padding:0;overflow:hidden">' +
        '<div style="padding:18px 18px 10px"><h3>Localisation approximative</h3><p class="se-muted" style="margin:0">L’adresse exacte n’est jamais visible des membres — uniquement par votre agent.</p></div>' +
        mapEmbed(b) +
      '</div>' +
    '</div>' +
    ecolesBlock(b);
  }

  const app = () => $('#app');

  function showPremiumNotification(titre, message, type) {
    const old = document.querySelector('.se-premium-notification');
    if (old) old.remove();
    const t = type || 'info';
    const dotColor = t === 'success' ? '#1b3a32' : t === 'error' ? '#b08d3e' : '#3b2b4a';
    const el = document.createElement('div');
    el.className = 'se-premium-notification';
    const dot = document.createElement('span');
    dot.className = 'se-premium-dot';
    dot.style.background = dotColor;
    const body = document.createElement('div');
    body.className = 'se-premium-body';
    const tt = document.createElement('div');
    tt.className = 'se-premium-titre';
    tt.textContent = titre;
    const mm = document.createElement('div');
    mm.className = 'se-premium-msg';
    mm.textContent = message;
    body.appendChild(tt); body.appendChild(mm);
    el.appendChild(dot); el.appendChild(body);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 400); }, 3000);
  }

  function toast(message, kind) {
    const type = kind === 'ok' ? 'success' : kind === 'warn' ? 'error' : 'info';
    const titre = type === 'success' ? 'Confirmé' : type === 'error' ? 'Attention' : 'Information';
    showPremiumNotification(titre, message, type);
  }

  /* ================= PLATEFORME ÉDITORIALE (Belle Demeure / Kindred) ================= */

  function edShell(r, content) {
    const p = state.profil;
    const role = state.membre && state.membre.role;
    const admin = role === 'admin' || role === 'superadmin';
    return '<div class="ed-shell">' +
      '<header class="ed-header">' +
        '<a class="ed-brand" href="#/accueil"><span class="ed-logo">S</span><span><b>Seecret</b><small>Espace membre</small></span></a>' +
        '<nav class="ed-nav">' +
          '<a href="#/catalogue" class="' + (r.name === 'catalogue' || r.name === 'bien' ? 'active' : '') + '">Catalogue</a>' +
          '<a href="#/mon-bien" class="' + (r.name === 'mon-bien' ? 'active' : '') + '">Mon bien</a>' +
          '<a href="#/recherche" class="' + (r.name === 'recherche' ? 'active' : '') + '">Ma recherche</a>' +
          '<a href="#/profil" class="' + (r.name === 'profil' ? 'active' : '') + '">Mon profil</a>' +
          (admin ? '<a href="/crm.html">CRM agence</a>' : '') +
        '</nav>' +
        '<a class="ed-user" href="#/profil">' + esc((p.prenom + ' ' + p.nom).trim() || 'Mon compte') + '</a>' +
      '</header>' +
      banniereNotifications() +
      banniereAdhesion() +
      '<main class="ed-main">' + content + '</main>' +
    '</div>';
  }

  function edHead(kicker, titre, sub) {
    return '<div style="margin-bottom:26px"><span class="ed-kicker">' + esc(kicker) + '</span>' +
      '<h1 class="ed-title">' + titre + '</h1>' +
      (sub ? '<p class="ed-sub">' + esc(sub) + '</p>' : '') + '</div>';
  }

  function progressionBien(b) {
    const c = completionOf(b);
    const pct = c.pct;
    const couleurs = pct === 100 ? '#1b3a32' : '#b08d3e';
    return '<div class="ed-panel" style="margin-bottom:22px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<span class="ed-kicker">Complétude de votre fiche</span>' +
        '<b style="font-size:20px">' + pct + ' %</b>' +
      '</div>' +
      '<div style="height:8px;background:var(--color-stroke-faint);border-radius:999px;overflow:hidden;margin-top:10px">' +
        '<div style="height:100%;width:' + pct + '%;background:' + couleurs + ';transition:width .4s var(--ease-club)"></div>' +
      '</div>' +
      (c.complet
        ? '<p class="se-hint" style="margin:10px 0 0;color:var(--color-ok)">Fiche complète — le marché est débloqué.</p>'
        : '<p class="se-hint" style="margin:10px 0 0">Il manque : ' + c.manquants.join(', ') + '.</p>') +
    '</div>';
  }

  function manquesAdhesion() {
    const docs = state.docs || [];
    const types = [['identite', 'Pièce d’identité'], ['financement', 'Justificatif de financement'], ['bien', 'Titre de propriété']];
    const docsManquants = types.filter((t) => !docs.some((d) => d.type === t[0])).map((t) => t[1]);
    const photos = (state.monBien && state.monBien.photos) || [];
    const photosManquantes = Math.max(0, 3 - photos.length);
    const rec = state.recherche || {};
    const rechercheIncomplete = !(rec.prixMax || (rec.quartiers && rec.quartiers.length) || rec.piecesMin || rec.surfaceMin);
    return { docsManquants, photosManquantes, rechercheIncomplete };
  }

  function banniereAdhesion() {
    if (marcheDebloque()) return '';
    if (state.membre && state.membre.statut === 'suspendu') {
      return '<div class="ed-panel" style="margin-bottom:22px;border:1px solid #e5c98a;background:#fbf6ea">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' +
          '<span style="font-size:22px">🔒</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:600">Votre compte est suspendu.</div>' +
            '<p class="se-muted" style="margin:4px 0 0">En attente de régularisation. Contactez votre agent Seecret pour plus d’informations.</p>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    if (membreValide()) {
      const brouillon = !!(state.monBien && state.monBien.statut === 'brouillon');
      return '<div class="ed-panel" style="margin-bottom:22px;border:1px solid #e5c98a;background:#fbf6ea">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' +
          '<span style="font-size:22px">🔒</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:600">' + (brouillon ? 'Votre bien est en brouillon, publiez-le.' : 'Votre bien est en cours de validation par l’agence.') + '</div>' +
            '<p class="se-muted" style="margin:4px 0 0">' + (brouillon ? 'Ajoutez vos photos et informations, puis demandez sa mise en ligne.' : 'Dès qu’il sera validé, vous aurez accès au marché complet.') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    const m = manquesAdhesion();
    const lignes = [];
    if (m.docsManquants.length) lignes.push('Documents manquants : ' + m.docsManquants.join(', '));
    if (m.photosManquantes > 0) lignes.push('Photos manquantes : ' + m.photosManquantes);
    if (m.rechercheIncomplete) lignes.push('Recherche incomplète');
    return '<div class="ed-panel" style="margin-bottom:22px;border:1px solid #e5c98a;background:#fbf6ea">' +
      '<div style="display:flex;gap:12px;align-items:flex-start">' +
        '<span style="font-size:22px">🔒</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600">Votre accès au marché Seecret est restreint.</div>' +
          '<p class="se-muted" style="margin:4px 0 0">Pour découvrir les biens nets, vous devez finaliser votre adhésion.</p>' +
          '<div class="se-hint" style="margin-top:8px">' + (lignes.length ? lignes.join(' · ') + '.' : 'Tous vos documents sont déposés.') + '</div>' +
          (state.membre && state.membre.dossierEnvoye ? '<p class="se-hint" style="margin:10px 0 0;color:var(--color-ok)">✅ Dossier bien reçu. Nos équipes analysent vos documents pour valider votre accès complet à la plateforme.</p>' : '') +
          '<button class="se-btn block" style="margin-top:12px" data-act="finaliser-adhesion">Finaliser mon adhésion</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Messages déposés par l'agence à chaque validation/refus côté CRM (pièce,
  // adhésion, bien, offre, modification…) — vus ici à la reconnexion, en plus
  // de l'email déjà envoyé. Une case à cocher les marque lus (persisté côté
  // serveur), comme les notifications agent dans le CRM.
  function banniereNotifications() {
    const non = (state.mesNotifications || []).filter((n) => !n.lue);
    if (!non.length) return '';
    return '<div class="ed-panel" style="margin-bottom:22px;border:1px solid var(--color-club-green,#1b3a32);background:var(--color-club-mist)">' +
      '<div style="display:flex;gap:12px;align-items:flex-start">' +
        '<span style="font-size:22px">🔔</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600">' + non.length + ' nouveau' + (non.length > 1 ? 'x' : '') + ' message' + (non.length > 1 ? 's' : '') + ' de l’agence</div>' +
          '<div class="se-list" style="margin-top:8px">' + non.map((n) => '<div class="se-list-item" style="align-items:flex-start">' +
            '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">' + esc(n.titre || 'Message') + '</div>' +
            '<p class="se-muted" style="margin:2px 0 0">' + esc(n.message || '') + '</p></div>' +
            '<button class="se-btn ghost sm" data-act="notif-lu" data-id="' + n.id + '">Marquer comme lu</button>' +
          '</div>').join('') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function edStat(label, value) {
    return '<div><div class="ed-kicker" style="margin:0">' + esc(label) + '</div><div style="font-size:14px;font-weight:500">' + value + '</div></div>';
  }

  function edCard(b) {
    const lock = estVerrouille(b);
    const img = photoOf(b)
      ? '<img src="' + photoOf(b) + '" alt="" loading="lazy" style="' + (lock ? 'filter:blur(16px);transform:scale(1.06);' : '') + '"/>'
      : '';
    const badges = '<span class="ed-card-badge">' + badge(b.statut) + '</span>';
    if (lock) {
      return '<div class="ed-card" style="cursor:not-allowed">' +
        '<div class="ed-card-photo">' + img + badges + '</div>' +
        '<div class="ed-card-body">' +
          '<span class="ed-card-type">' + esc(b.type) + ' · ' + esc(b.label) + '</span>' +
          '<span class="ed-card-title">' + esc(b.titre) + '</span>' +
          '<span class="ed-card-foot" style="color:var(--color-taupe)">Finalisez votre adhésion pour voir ce bien</span>' +
        '</div>' +
      '</div>';
    }
    return '<a class="ed-card" href="#/bien/' + b.id + '">' +
      '<div class="ed-card-photo">' + img + badges + '</div>' +
      '<div class="ed-card-body">' +
        '<span class="ed-card-type">' + esc(b.type) + ' · ' + esc(b.label) + '</span>' +
        '<span class="ed-card-title">' + esc(b.titre) + '</span>' +
        '<span class="ed-card-price">' + euro(b.prix) + '</span>' +
        '<span class="ed-card-foot">' + num(b.surface) + ' m² · ' + b.pieces + ' pièces · ' + b.chambres + ' ch.</span>' +
      '</div>' +
    '</a>';
  }

  function edHero(list) {
    return '<div class="ed-hero" data-hero>' +
      list.map((b, i) => {
        const lock = estVerrouille(b);
        return '<div class="ed-hero-slide ' + (i === 0 ? 'on' : '') + '">' +
          (photoOf(b) ? '<img src="' + photoOf(b) + '" alt="" style="' + (lock ? 'filter:blur(16px);transform:scale(1.06);' : '') + '"/>' : '') +
          '<div class="ed-hero-grad"></div>' +
          '<div class="ed-hero-txt">' +
            '<span class="ed-kicker" style="color:rgba(255,255,255,.75)">Le plus suivi du mois</span>' +
            '<h2>' + esc(b.titre) + '</h2>' +
            '<div style="color:rgba(255,255,255,.9);font-size:14px">' + esc(b.label) + (lock ? '' : ' · ' + euro(b.prix)) + ' · ' + num(b.suiveurs || 0) + ' membres</div>' +
            (lock
              ? '<button class="se-btn light" style="margin-top:14px" data-act="finaliser-adhesion">Finalisez votre adhésion pour débloquer</button>'
              : '<a class="se-btn light" href="#/bien/' + b.id + '" style="margin-top:14px">Découvrir</a>') +
          '</div>' +
        '</div>';
      }).join('') +
      '<div class="ed-hero-dots">' + list.map((_, i) => '<button type="button" data-hero-dot="' + i + '" class="' + (i === 0 ? 'on' : '') + '"></button>').join('') + '</div>' +
    '</div>';
  }

  function edSection(titre, sub, list) {
    return '<div style="margin-bottom:32px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">' +
        '<div><span class="ed-kicker">' + esc(sub) + '</span><h2 class="ed-title" style="font-size:26px;margin:4px 0 0">' + esc(titre) + '</h2></div>' +
        '<a class="se-btn ghost sm" href="#/catalogue">Tout voir</a>' +
      '</div>' +
      (list.length ? '<div class="ed-grid">' + list.slice(0, 4).map(edCard).join('') + '</div>' : '<p class="ed-sub" style="margin:0">Aucun bien pour l’instant.</p>') +
    '</div>';
  }

  function edViewAccueil() {
    const p = state.profil;
    const mien = maFiche();
    const plusSuivis = visiblesPourMembre(state.biens).sort((a, b) => (b.suiveurs || 0) - (a.suiveurs || 0)).slice(0, 5);
    const rec = state.recherche || {};
    const matchs = visiblesPourMembre(state.biens).filter((b) => {
      if (rec.quartiers && rec.quartiers.length && rec.quartiers.indexOf(b.quartier) === -1) return false;
      if (rec.types && rec.types.length && rec.types.indexOf(b.type) === -1) return false;
      if (rec.prixMax && b.prix > Number(rec.prixMax)) return false;
      if (rec.piecesMin && b.pieces < Number(rec.piecesMin)) return false;
      return true;
    });
    return edHead('Bonjour ' + (p.prenom || 'vous').toLowerCase(), 'Votre cercle off-market',
      'Les biens les plus suivis, et ceux qui correspondent à votre recherche.') +
      edHero(plusSuivis) +
      (mien
        ? '<a class="ed-panel ed-mien" href="#/mon-bien" style="display:flex;gap:16px;align-items:center;text-decoration:none;color:inherit;margin-bottom:32px">' +
            '<img src="' + photoOf(mien) + '" alt="" style="width:84px;height:64px;object-fit:cover;border-radius:12px;flex:0 0 84px"/>' +
            '<div style="flex:1;min-width:0"><span class="ed-kicker">Mon bien</span>' +
            '<div class="ed-card-title" style="font-size:19px">' + esc(mien.titre) + '</div>' +
            '<div style="font-size:13px;color:var(--color-graphite)">' + badge(mien.statut) + ' · ' + euro(mien.prix) + ' · ' + num(mien.suiveurs || 0) + ' membres le suivent</div></div>' +
            '<span style="font-family:var(--font-serif)">Gérer →</span>' +
          '</a>'
        : '<div class="ed-panel" style="margin-bottom:32px;background:var(--color-button-ink);color:#fff;border:0">' +
            '<span class="ed-kicker" style="color:rgba(255,255,255,.6)">Adhésion</span>' +
            '<div class="ed-card-title" style="font-size:24px;color:#fff;margin:8px 0">Pour entrer au club, présentez votre bien.</div>' +
            '<a class="se-btn light" href="#/mon-bien">Déposer mon bien</a>' +
          '</div>') +
      edSection('Biens de ma recherche', 'Selon vos critères', matchs) +
      edSection('À la une', 'Les plus demandés', visiblesPourMembre(state.biens).slice(0, 4));
  }

  function edViewCatalogue() {
    const f = state.__filtres || {};
    const estAcheteur = state.membre && state.membre.typeMembre === 'membre_acheteur';
    const biens = tousBiens().filter((b) => {
      if (!surLaPlateforme(b.statut)) return false;
      // Un membre sans bien (acheteur simple) ne voit jamais les avant-premières.
      if (estAcheteur && b.statut !== 'ouvert') return false;
      if (f.q) { const hay = (b.titre + ' ' + b.label + ' ' + b.type + ' ' + b.description).toLowerCase(); if (hay.indexOf(f.q.toLowerCase()) === -1) return false; }
      if (f.type && b.type !== f.type) return false;
      if (f.statut && b.statut !== f.statut) return false;
      if (f.prix && b.prix > Number(f.prix)) return false;
      if (f.pieces && b.pieces < Number(f.pieces)) return false;
      return true;
    });
    const statutOptions = estAcheteur
      ? '<option value="ouvert"' + (f.statut === 'ouvert' ? ' selected' : '') + '>Ouvert aux visites</option>'
      : '<option value="avant-premiere"' + (f.statut === 'avant-premiere' ? ' selected' : '') + '>Avant-première</option>' +
        '<option value="ouvert"' + (f.statut === 'ouvert' ? ' selected' : '') + '>Ouvert aux visites</option>' +
        '<option value="sous-offre"' + (f.statut === 'sous-offre' ? ' selected' : '') + '>Sous offre</option>';
    return edHead('Catalogue', 'Les biens du club', 'Visibles nulle part ailleurs. ' + biens.length + ' bien(s).') +
      '<div class="ed-panel" style="margin-bottom:22px"><div class="se-filters">' +
        '<input class="se-input se-search" data-filter="q" placeholder="Rechercher un bien, un quartier…" value="' + esc(f.q || '') + '"/>' +
        '<select class="se-select" data-filter="type"><option value="">Tous les types</option>' + TYPES.map((t) => '<option' + (f.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
        '<select class="se-select" data-filter="statut"><option value="">Tous les statuts</option>' + statutOptions + '</select>' +
        '<select class="se-select" data-filter="prix"><option value="">Tous les prix</option>' + [1500000, 2000000, 2500000, 3000000].map((p) => '<option value="' + p + '"' + (String(f.prix) === String(p) ? ' selected' : '') + '>≤ ' + num(p) + ' €</option>').join('') + '</select>' +
        '<button class="se-btn ghost sm" data-act="filtres-reset">Réinitialiser</button>' +
      '</div></div>' +
      (biens.length ? '<div class="ed-grid">' + biens.map(edCard).join('') + '</div>' : '<div class="ed-panel"><div class="ed-card-title">Aucun bien ne correspond</div><p class="ed-sub" style="margin:6px 0 0">Élargissez les critères.</p></div>');
  }

  function bookmarkSvg(filled) {
    return '<svg viewBox="0 0 20 20" width="16" height="16" ' + (filled ? 'fill="currentColor"' : 'fill="none"') + ' stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M5.5 3h9A1.5 1.5 0 0 1 16 4.5V18l-6-3.5L4 18V4.5A1.5 1.5 0 0 1 5.5 3z"/></svg>';
  }

  function edViewBien(r) {
    const b = bien(r.param);
    if (!b) return '<div class="ed-panel"><div class="ed-card-title">Bien introuvable</div><a class="se-btn" style="margin-top:12px" href="#/catalogue">Retour au catalogue</a></div>';
    const suivi = state.suivis.indexOf(b.id) > -1;
    const mien = b.mien || (state.monBien && state.monBien.id === b.id);
    const lock = !mien && !marcheDebloque();
    // En avant-première, le propriétaire n'a pas encore ouvert son bien aux
    // visites ni aux offres — les autres membres peuvent seulement le
    // suivre et marquer leur intérêt. C'est le cœur de la distinction du
    // produit, donc elle doit être respectée ici, pas seulement présentée
    // ailleurs : voir aussi le garde-fou côté serveur sur /api/visites et
    // /api/offres, qui refuse la demande même si ce bouton était contourné.
    const ouvertAuxVisites = b.statut === 'ouvert' || b.statut === 'sous-offre';
    return '<div style="margin-bottom:20px"><a class="se-btn ghost sm" href="#/catalogue">← Catalogue</a></div>' +
      '<div class="ed-detail-grid">' +
        '<div>' +
          '<div class="ed-gallery"><div class="ed-gallery-main" style="position:relative">' + (photoOf(b) ? '<img src="' + photoOf(b) + '" alt="" style="width:100%;height:100%;object-fit:cover;' + (lock ? 'filter:blur(18px);transform:scale(1.06);' : '') + '"/>' : '') + (lock ? '<div style="position:absolute;inset:0;display:grid;place-items:center;background:rgba(20,18,16,.3)"><span class="se-btn light" style="pointer-events:none">Accès restreint</span></div>' : '') + '</div></div>' +
          '<div class="ed-panel" style="margin-top:18px">' +
            '<span class="ed-kicker">' + esc(b.type) + ' · ' + esc(b.label) + '</span>' +
            '<h1 class="ed-title">' + esc(b.titre) + '</h1>' +
            '<p class="ed-sub" style="margin:8px 0 0">' + esc(b.description) + '</p>' +
            '<div class="se-chips" style="margin-top:14px">' + (b.atouts || []).map((a) => '<span class="se-chip" style="cursor:default">' + esc(a) + '</span>').join('') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:18px">' +
          '<div class="ed-panel">' +
            '<div class="ed-price-big">' + euro(b.prix) + '</div>' +
            '<div class="ed-kicker" style="margin-top:4px">' + euro(prixM2(b)) + ' / m²</div>' +
            '<div class="se-divider"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
              edStat('Surface', num(b.surface) + ' m²') + edStat('Pièces', b.pieces) +
              edStat('Chambres', b.chambres) + edStat('Étage', b.etage || '—') +
              edStat('DPE', b.dpe) + edStat('Statut', STATUTS[b.statut].label) +
            '</div>' +
            (mien
              ? '<a class="se-btn block" style="margin-top:16px" href="#/mon-bien">Gérer mon bien</a>'
              : (lock
                  ? '<div class="se-note" style="margin-top:16px">Complétez votre fiche à 100 % pour débloquer les photos, les visites et les offres.</div>' +
                    '<a class="se-btn block" style="margin-top:10px" href="#/mon-bien">Compléter ma fiche</a>'
                  : '<button class="se-btn ' + (suivi ? 'soft' : 'ghost') + ' block" style="margin-top:12px;gap:8px" data-act="suivre" data-id="' + b.id + '">' + bookmarkSvg(suivi) + (suivi ? 'Enregistré' : 'Suivre ce bien') + '</button>' +
                    (ouvertAuxVisites
                      ? '<button class="se-btn block" style="margin-top:8px" data-act="visite-open" data-id="' + b.id + '">Demander une visite</button>' +
                        '<button class="se-btn ghost block" style="margin-top:8px" data-act="offre-open" data-id="' + b.id + '">Faire une offre</button>'
                      : '<p class="se-hint" style="margin-top:10px">Ce bien est en avant-première : le propriétaire n’a pas encore ouvert les visites. Suivez-le pour être informé dès que ce sera possible.</p>'))) +
          '</div>' +
          '<div class="ed-panel"><span class="ed-kicker">Quartier</span><div style="margin-top:10px">' + ecolesBlock(b) + '</div></div>' +
        '</div>' +
      '</div>';
  }

  function edViewMonBien() {
    const b = state.monBien;
    if (!b) {
      return edHead('Mon bien', 'Votre bien', '') +
        '<div class="ed-panel"><p class="se-muted">Votre fiche est en cours de préparation. Rechargez la page dans un instant.</p></div>';
    }
    const photos = b.photos || [];
    const demande = b.statutDemande;
    const libelleDemande = 'passage en visite ouverte';
    const champ = (label, name, value, opt) => {
      const o = opt || {};
      return '<div class="se-field ' + (o.full ? 'full' : '') + '"><label>' + label + '</label>' +
        (o.options
          ? '<select class="se-select" name="' + name + '">' + o.options.map((x) => '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(value) ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select>'
          : '<input class="se-input" name="' + name + '" type="' + (o.type || 'text') + '" value="' + esc(value == null ? '' : value) + '"/>') +
      '</div>';
    };

    return edHead('Mon bien', esc(b.titre || 'Votre bien'),
      (b.type || '') + (b.ville ? ' · ' + b.ville : '') + (b.surface ? ' · ' + num(b.surface) + ' m²' : '') +
      (b.exterieur && b.exterieur !== 'Aucun' ? ' · ' + esc(b.exterieur) : '')) +
      '<div class="ed-detail-grid">' +
        '<div>' +
          '<div class="ed-gallery"><div class="ed-gallery-main">' +
            (photos[0] ? '<img src="' + esc(photos[0]) + '" alt=""/>' : '<div style="display:grid;place-items:center;height:100%;color:var(--color-taupe);font-size:13px">Aucune photo pour l’instant</div>') +
          '</div></div>' +
          '<div class="se-row" style="gap:10px;margin-top:12px;flex-wrap:wrap">' +
            photos.map((p, i) => '<div style="position:relative">' +
              '<button type="button" data-act="photo-principale" data-url="' + esc(p) + '" title="Définir comme principale" style="padding:0;border:' + (i === 0 ? '2px solid var(--color-ink)' : '1px solid var(--color-stroke)') + ';border-radius:12px;overflow:hidden;background:none;cursor:pointer;width:88px;height:66px">' +
                '<img src="' + esc(p) + '" alt="" style="width:100%;height:100%;object-fit:cover"/>' +
              '</button>' +
              '<button type="button" data-act="photo-suppr" data-url="' + esc(p) + '" title="Supprimer" style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;border:1px solid var(--color-stroke);background:var(--color-surface);color:var(--color-graphite);font-size:13px;line-height:1;cursor:pointer">×</button>' +
            '</div>').join('') +
            '<label class="se-btn ghost sm" style="margin:0;cursor:pointer">' + ICONS.plus + ' Ajouter des photos' +
              '<input type="file" accept="image/*" multiple hidden data-photos/></label>' +
          '</div>' +
          '<p class="se-hint" style="margin-top:8px">Minimum 3 photos. Cliquez une vignette pour la définir comme principale.</p>' +
          '<div class="se-note" style="margin-top:10px;font-size:12.5px;line-height:1.6"><b>Conseils photo :</b> tournez le téléphone à l’horizontal, prenez d’angle à angle, enlevez les objets, gardez l’équilibre sol / plafond.</div>' +
          '<div class="ed-panel" style="margin-top:18px">' +
            '<span class="ed-kicker">Estimation</span>' +
            '<div class="ed-price-big" style="font-size:26px;margin-top:6px">' + (b.prix ? euro(b.prix) : '—') + '</div>' +
            '<div class="se-hint">Prix de présentation actuel</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:18px">' +
          '<div class="ed-panel">' +
            '<span class="ed-kicker">Statut de mon bien</span>' +
            '<div style="margin-top:10px">' + badge(b.statut) + '</div>' +
            (b.statut === 'avant-premiere' && !demande
              ? '<p class="se-hint" style="margin-top:10px">Votre bien est visible des membres, mais les visites ne sont pas encore ouvertes. Quand vous êtes prêt·e à recevoir des demandes de visite, envoyez une demande à votre agent.</p>' +
                '<button class="se-btn block" type="button" data-act="visibilite" style="margin-top:10px">Demander l’ouverture des visites</button>'
              : demande
                ? '<p class="se-hint" style="margin-top:10px">Demande de ' + libelleDemande + ' envoyée à votre agent, en attente de validation.</p>'
                : b.statut === 'brouillon'
                  ? '<p class="se-hint" style="margin-top:10px">Votre fiche est en brouillon : complétez-la puis publiez-la pour la rendre visible aux membres.</p>'
                  : '<p class="se-hint" style="margin-top:10px">Le suivi de ce statut se fait désormais avec votre agent.</p>') +
          '</div>' +
          '<form class="ed-panel" data-form="mon-bien">' +
            '<h3>Mon annonce</h3>' +
            '<div class="se-form-grid" style="margin-top:12px">' +
              '<div class="se-field full"><label>Titre de l’annonce</label><input class="se-input" name="titre" value="' + esc(b.titre || '') + '"/></div>' +
              '<div class="se-field full"><label>Prix (€)</label><input class="se-input" name="prix" type="number" value="' + esc(b.prix || '') + '"/></div>' +
              '<div class="se-field full"><label>Description</label><textarea class="se-textarea" name="description" style="min-height:110px">' + esc(b.description || '') + '</textarea></div>' +
            '</div>' +
            '<button class="se-btn block" type="submit" style="margin-top:14px">Demander une modification</button>' +
          '</form>' +
        '</div>' +
      '</div>';
  }

  function edViewRecherche() {
    const rec = state.recherche || {};
    const chip = (name, value, label, checked, type) =>
      '<label class="se-chip" style="cursor:pointer"><input type="' + (type || 'radio') + '" name="' + name + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + ' style="margin-right:6px"/>' + esc(label) + '</label>';
    const ANNX = ['Balcon', 'Terrasse', 'Jardin', 'Parking', 'Cave', 'Ascenseur'];
    const ETATS = ['Neuf', 'Bon état', 'À rénover'];
    const DPE = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

    return edHead('Ma recherche', 'Vos critères', 'Modifiez librement vos critères : ils sont mis à jour immédiatement.') +
      '<form class="ed-panel" data-form="mon-recherche">' +
        '<h3>Budget & surface</h3>' +
        '<div class="se-form-grid" style="margin-top:12px">' +
          '<div class="se-field"><label>Budget max (€)</label><input class="se-input" name="prixMax" type="number" value="' + esc(rec.prixMax || '') + '"/></div>' +
          '<div class="se-field"><label>Pièces minimum</label><input class="se-input" name="piecesMin" type="number" value="' + esc(rec.piecesMin || '') + '"/></div>' +
          '<div class="se-field"><label>Surface min (m²)</label><input class="se-input" name="surfaceMin" type="number" value="' + esc(rec.surfaceMin || '') + '"/></div>' +
          '<div class="se-field"><label>Surface max (m²)</label><input class="se-input" name="surfaceMax" type="number" value="' + esc(rec.surfaceMax || '') + '"/></div>' +
        '</div>' +
        '<h3 style="margin-top:20px">Type de bien</h3>' +
        '<div class="se-chips" style="margin-top:10px">' +
          TYPES.map((t) => chip('type', t, t, (rec.type || (rec.types && rec.types[0])) === t)).join('') +
        '</div>' +
        '<h3 style="margin-top:20px">Étage</h3>' +
        '<div class="se-form-grid" style="margin-top:10px">' +
          '<div class="se-field"><label>Étage min</label><input class="se-input" name="etageMin" type="number" value="' + esc(rec.etageMin || '') + '"/></div>' +
          '<div class="se-field"><label>Étage max</label><input class="se-input" name="etageMax" type="number" value="' + esc(rec.etageMax || '') + '"/></div>' +
        '</div>' +
        '<h3 style="margin-top:20px">État du bien</h3>' +
        '<div class="se-chips" style="margin-top:10px">' +
          ETATS.map((e) => chip('etat', e, e, rec.etat === e)).join('') +
        '</div>' +
        '<h3 style="margin-top:20px">DPE</h3>' +
        '<div class="se-chips" style="margin-top:10px">' +
          DPE.map((d) => chip('dpe', d, d, rec.dpe === d)).join('') +
        '</div>' +
        '<h3 style="margin-top:20px">Extérieurs & annexes</h3>' +
        '<div class="se-chips" style="margin-top:10px">' +
          ANNX.map((a) => chip('annexe', a, a, (rec.annexes || []).indexOf(a) > -1, 'checkbox')).join('') +
        '</div>' +
        '<h3 style="margin-top:20px">Secteurs</h3>' +
        '<div class="se-chips" style="margin-top:10px">' +
          QUARTIERS.map((q) => chip('quartier', q.id, q.label, (rec.quartiers || []).indexOf(q.id) > -1, 'checkbox')).join('') +
        '</div>' +
        '<h3 style="margin-top:20px">Financement</h3>' +
        '<div class="se-chips" style="margin-top:10px">' +
          chip('bienAVendre', 'oui', 'J\'ai un bien à vendre pour financer ma recherche', rec.bienAVendre, 'checkbox') +
        '</div>' +
        '<div class="se-form-grid" style="margin-top:10px">' +
          '<div class="se-field"><label>Prix de vente estimé (€)</label><input class="se-input" name="prixVenteEstime" type="number" value="' + esc(rec.prixVenteEstime || '') + '"/></div>' +
        '</div>' +
        '<button class="se-btn block" type="submit" style="margin-top:20px">Mettre à jour ma recherche</button>' +
      '</form>';
  }

  function modifModal() {
    return '<h3>Demander une modification</h3><p class="se-muted">Votre demande part à votre agent Seecret, qui validera la modification.</p>' +
      '<form data-form="modification">' +
        '<div class="se-field"><label>Ce que vous voulez modifier</label>' +
        '<select class="se-select" name="type"><option>Prix</option><option>Description</option><option>Photos</option><option>Statut (visite possible)</option><option>Autre</option></select></div>' +
        '<div class="se-field" style="margin-top:12px"><label>Nouveau prix (€) — si changement de prix</label><input class="se-input" name="prix" type="number" min="0" placeholder="Optionnel"/></div>' +
        '<div class="se-field" style="margin-top:12px"><label>Détail</label><textarea class="se-textarea" name="message" style="min-height:90px" placeholder="Décrivez la modification souhaitée…"></textarea></div>' +
        '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Envoyer à mon agent</button></div>' +
      '</form>';
  }


  function render() {
    const r = parseRoute();
    $$('.se-modal-back').forEach((m) => m.remove());

    if (!state.session) {
      app().innerHTML = viewAuth(r);
      closeModalIfNeeded();
      return;
    }

    const views = {
      accueil: edViewAccueil,
      'mon-bien': edViewMonBien,
      'recherche': edViewRecherche,
      catalogue: edViewCatalogue,
      bien: edViewBien,
      visites: viewVisites,
      offres: viewOffres,
      messages: viewMessages,
      profil: viewProfil,
      outils: viewOutils,
      agence: viewAgence
    };

    const view = views[r.name] || edViewAccueil;
    app().innerHTML = edShell(r, view(r));

    if (modal) {
      const back = document.createElement('div');
      back.className = 'se-modal-back';
      back.setAttribute('data-act', 'modal-close');
      back.innerHTML = '<div class="se-modal" data-stop="1">' + modal + '</div>';
      document.body.appendChild(back);
    }

    if (r.name !== lastRoute) {
      window.scrollTo({ top: 0 });
      lastRoute = r.name;
    }
  }

  function closeModalIfNeeded() {
    $$('.se-modal-back').forEach((m) => m.remove());
    modal = null;
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'accueil', param: parts[1] || null };
  }

  function navLink(route, active, icon, label, badge) {
    return '<a href="#/' + route + '" class="' + (active === route ? 'active' : '') + '">' +
      ICONS[icon] + '<span>' + label + '</span>' +
      (badge ? '<span class="se-count">' + badge + '</span>' : '') + '</a>';
  }

  function shell(r, content) {
    const p = state.profil;
    const initiales = ((p.prenom || 'C').charAt(0) + (p.nom || '').charAt(0)).toUpperCase();
    const mien = maFiche();

    return '' +
      '<div class="se-app">' +
        '<aside class="se-side">' +
          '<a class="se-brand" href="#/accueil"><span class="se-logo">S</span><span><b>Seecret</b><small>Espace membre</small></span></a>' +
          '<nav class="se-nav">' +
            navLink('accueil', r.name, 'home', 'Accueil') +
            navLink('mon-bien', r.name, 'building', 'Mon bien', mien ? '' : '') +
            navLink('catalogue', r.name, 'grid', 'Catalogue') +
            navLink('visites', r.name, 'calendar', 'Visites', visitesEnAttente() || '') +
            navLink('offres', r.name, 'tag', 'Offres', offresRecues() || '') +
            navLink('messages', r.name, 'chat', 'Messages') +
            '<a href="#" class="se-more" data-act="more">' + ICONS.grid + '<span>Plus</span></a>' +
          '</nav>' +
          '<div class="se-nav-label">Coulisses</div>' +
          '<nav class="se-nav se-nav-more">' +
            navLink('agence', r.name, 'users', 'Pipeline agence') +
            navLink('outils', r.name, 'tools', 'Outils') +
            navLink('profil', r.name, 'user', 'Mon profil') +
          '</nav>' +
          '<div class="se-side-foot">' +
            '<a class="se-userchip" href="#/profil">' +
              '<span class="se-avatar">' + esc(initiales) + '</span>' +
              '<span><b>' + esc((p.prenom + ' ' + p.nom).trim() || 'Mon compte') + '</b>' +
              '<span>' + (mien ? 'Membre · bien publié' : 'Membre du club') + '</span></span>' +
            '</a>' +
          '</div>' +
        '</aside>' +
        '<div class="se-main">' +
          '<div class="se-topbar">' +
            '<span class="se-crumb">Seecret</span><h2>' + esc(pageTitle(r)) + '</h2>' +
            '<span class="se-spacer"></span>' +
            '<a class="se-btn ghost sm" href="crm.html">CRM agence</a>' + '<a class="se-btn ghost sm" href="index.html">Voir le site</a>' +
          '</div>' +
          '<div class="se-view">' + content + '</div>' +
        '</div>' +
      '</div>';
  }

  function pageTitle(r) {
    const map = {
      accueil: 'Accueil', 'mon-bien': 'Mon bien', catalogue: 'Catalogue', bien: 'Fiche du bien',
      visites: 'Visites', offres: 'Offres', messages: 'Messages', profil: 'Mon profil',
      outils: 'Outils', agence: 'Pipeline agence'
    };
    return map[r.name] || 'Espace membre';
  }

  function viewHead(kicker, title, text, actions) {
    return '<div class="se-view-head"><div><p class="kicker" style="margin:0;color:var(--color-taupe)">' + esc(kicker) + '</p>' +
      '<h1>' + title + '</h1>' + (text ? '<p>' + text + '</p>' : '') + '</div>' +
      (actions ? '<div class="se-actions">' + actions + '</div>' : '') + '</div>';
  }

  function badge(statut) {
    const s = STATUTS[statut] || STATUTS.brouillon;
    return '<span class="se-badge ' + s.cls + '">' + s.label + '</span>';
  }

  function photoOf(b, i) {
    const p = b.photos && b.photos.length ? b.photos[(i || 0) % b.photos.length] : null;
    if (!p) return '';
    return /^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p;
  }

  function bienCard(b) {
    return '<a class="se-card se-bien" href="#/bien/' + b.id + '">' +
      '<div class="se-bien-photo">' +
        (photoOf(b) ? '<img src="' + photoOf(b) + '" alt="" loading="lazy"/>' : '') +
        badge(b.statut) +
      '</div>' +
      '<div class="se-bien-body">' +
        '<span class="se-sub">' + esc(b.type) + ' · ' + esc(b.label) + '</span>' +
        '<h3>' + esc(b.titre) + '</h3>' +
        '<span class="se-price">' + euro(b.prix) + '</span>' +
        '<div class="se-bien-foot">' + num(b.surface) + ' m² · ' + b.pieces + ' pièces · ' + b.chambres + ' ch.</div>' +
      '</div>' +
    '</a>';
  }

  /* ================================ vues ================================ */

  /* ------------------------------ connexion ------------------------------ */

  function viewAuth() {
    // Le token ?token= est traité en amont (connexion auto dans demarrer).
    return authLogin();
  }

  function authBrand() {
    return '<a class="kicker" href="index.html" style="text-decoration:none;color:var(--color-taupe)">Seecret</a>';
  }

  function authLogin() {
    return '<div class="se-auth"><div class="se-auth-card">' + authBrand() +
      '<h1>Votre espace</h1>' +
      '<p class="se-muted">Recevez un code par email, puis saisissez-le. Aucun mot de passe.</p>' +
      '<form data-form="auth-code">' +
        '<div class="se-field"><label for="email">Email</label>' +
        '<input class="se-input" id="email" name="email" type="email" autocomplete="email" placeholder="vous@exemple.fr" value="' + esc(state.__pendingEmail || '') + '"/></div>' +
        '<button class="se-btn ghost block" type="button" data-act="send-code" style="margin-top:10px">Recevoir mon code par email</button>' +
        '<div class="se-field" style="margin-top:16px"><label for="code">Code à 6 chiffres</label>' +
        '<input class="se-input" id="code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" style="letter-spacing:.35em;font-size:22px;text-align:center"/></div>' +
        '<button class="se-btn block" type="submit" style="margin-top:16px">Entrer dans Seecret</button>' +
      '</form>' +
      (state.__authErreur ? '<p class="se-hint" style="margin-top:12px;color:var(--color-alert)">' + esc(state.__authErreur) + '</p>' : '') +
      '<p class="se-hint" style="margin-top:12px">Réservé aux membres dont la candidature est validée.</p>' +
      '</div></div>';
  }

  async function demarrer() {
    const token = new URLSearchParams(location.search).get('token');
    if (token) {
      try {
        await API.send('POST', '/api/auth/verify-token', { token: token });
        location.href = '/espace.html';
        return;
      } catch (e) {
        state.__authErreur = (e && e.message) || 'Lien invalide ou expiré.';
        try { history.replaceState({}, '', '/espace.html'); } catch (e2) { /* ignore */ }
      }
    }
    try {
      const me = await API.get('/api/auth/me');
      state.membre = me.membre;
      state.session = { email: me.membre.email };
      state.profil.prenom = me.membre.prenom || state.profil.prenom;
      state.profil.nom = me.membre.nom || state.profil.nom;
      state.profil.email = me.membre.email || '';
      try { const b = await API.get('/api/mon-bien'); state.monBien = Object.assign({ mien: true }, b.bien); } catch (e) { /* pas de bien */ }
      try { const c = await API.get('/api/catalogue'); state.biens = c.biens || []; } catch (e) { /* catalogue indisponible */ }
      try { const r = await API.get('/api/mon-recherche'); state.recherche = Object.assign({}, state.recherche, r.recherche); } catch (e) { /* pas de recherche */ }
      try { const d = await API.get('/api/documents'); state.docs = d.documents || []; } catch (e) { /* pas de docs */ }
      try { const n = await API.get('/api/mes-notifications'); state.mesNotifications = n.notifications || []; } catch (e) { /* pas de notifications */ }
      try { const md = await API.get('/api/mandat?apercu=0'); state.mandatActif = md.mandat || null; } catch (e) { /* pas de mandat */ }
    } catch (e) {
      state.membre = null;
      state.session = null;
    }
    render();
  }

  /* -------------------------------- accueil ------------------------------- */

  function viewAccueil() {
    const p = state.profil;
    const hello = (p.prenom || 'vous').toLowerCase();
    const mien = maFiche();
    const prochaines = state.visites.filter((v) => v.statut === 'demandee' || v.statut === 'confirmee').slice(0, 3);
    const recues = state.offres.filter((o) => o.sens === 'recue' && o.statut === 'recue');

    const bienBloc = mien
      ? '<div class="se-card pad-sm" style="display:flex;gap:14px;align-items:center">' +
          '<img class="se-thumb" src="' + photoOf(mien) + '" alt=""/>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="se-row" style="gap:8px">' + badge(mien.statut) + '<span class="se-hint">' + esc(mien.label) + '</span></div>' +
            '<div style="font-family:var(--font-serif);font-size:18px;margin-top:4px">' + esc(mien.titre) + '</div>' +
            '<div class="se-hint">' + euro(mien.prix) + ' · ' + num(mien.surface) + ' m² · ' + mien.suiveurs + ' membres le suivent</div>' +
          '</div>' +
          '<a class="se-btn ghost sm" href="#/mon-bien">Gérer</a>' +
        '</div>'
      : '<div class="se-card" style="background:var(--color-button-ink);color:#fff;border:0">' +
          '<p class="kicker" style="color:rgba(255,255,255,.6);margin:0">Adhésion</p>' +
          '<h3 style="font-family:var(--font-serif);font-weight:420;font-size:24px;margin:8px 0 6px;color:#fff">Pour entrer au club, présentez votre bien.</h3>' +
          '<p style="color:rgba(255,255,255,.75);font-size:14px;margin:0 0 16px;max-width:52ch">Sans mandat, sans engagement. Votre bien reste invisible du marché : seuls les membres le voient.</p>' +
          '<a class="se-btn light" href="#/mon-bien">Déposer mon bien ' + ICONS.arrow + '</a>' +
        '</div>';

    const aLaUne = state.biens.filter((b) => surLaPlateforme(b.statut)).slice(0, 3);
    const plusSuivis = state.biens.filter((b) => surLaPlateforme(b.statut)).sort((a, b) => (b.suiveurs || 0) - (a.suiveurs || 0)).slice(0, 5);
    const rec = state.recherche || {};
    const matchs = state.biens.filter((b) => {
      if (!surLaPlateforme(b.statut)) return false;
      if (rec.quartiers && rec.quartiers.length && rec.quartiers.indexOf(b.quartier) === -1) return false;
      if (rec.types && rec.types.length && rec.types.indexOf(b.type) === -1) return false;
      if (rec.prixMax && b.prix > Number(rec.prixMax)) return false;
      if (rec.piecesMin && b.pieces < Number(rec.piecesMin)) return false;
      if (rec.surfaceMin && b.surface < Number(rec.surfaceMin)) return false;
      return true;
    });

    return viewHead('Bonjour ' + hello, 'Votre club, en un regard',
      'Les biens les plus suivis, et ceux qui correspondent à votre recherche.', '') +

      carouselSuivis(plusSuivis) +
      sectionMaRecherche(matchs, rec) +

      '<div class="se-grid cols-4" style="margin-bottom:18px">' +
        '<div class="se-card se-stat"><span class="se-kicker">Mon bien</span><span class="se-num">' + (mien ? '1' : '—') + '</span><span class="se-sub">' + (mien ? STATUTS[mien.statut].label : 'à déposer') + '</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Visites</span><span class="se-num">' + state.visites.filter((v) => v.statut !== 'annulee').length + '</span><span class="se-sub">' + visitesEnAttente() + ' en attente</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Offres</span><span class="se-num">' + state.offres.length + '</span><span class="se-sub">' + recues.length + ' reçue(s)</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Biens suivis</span><span class="se-num">' + suivisCount() + '</span><span class="se-sub">dans le catalogue</span></div>' +
      '</div>' +

      '<div class="se-split">' +
        '<div class="se-grid" style="gap:18px">' +
          bienBloc +
          '<div class="se-card">' +
            '<div class="se-row" style="justify-content:space-between;margin-bottom:6px"><h3>À la une cette semaine</h3><a class="se-btn ghost sm" href="#/catalogue">Tout voir</a></div>' +
            '<div class="se-bien-grid" style="margin-top:12px">' + aLaUne.map(bienCard).join('') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card">' +
            '<h3>Prochaines visites</h3>' +
            (prochaines.length
              ? '<div class="se-list">' + prochaines.map((v) => {
                  const b = bien(v.bienId);
                  return '<div class="se-list-item"><img class="se-thumb" src="' + (b ? photoOf(b) : '') + '" alt=""/>' +
                    '<div style="flex:1;min-width:0"><div style="font-size:14px">' + esc(b ? b.titre : 'Bien') + '</div>' +
                    '<div class="se-hint">' + esc(v.creneau) + ' · ' + (v.statut === 'confirmee' ? 'confirmée' : 'en attente') + '</div></div></div>';
                }).join('') + '</div>'
              : '<p class="se-muted" style="margin-top:8px">Aucune visite programmée.</p>') +
          '</div>' +
          '<div class="se-card">' +
            '<h3>Votre agent</h3>' +
            '<div class="se-row" style="margin-top:10px">' +
              '<span class="se-avatar" style="background:var(--color-club-violet)">' + esc(p.agent.nom.charAt(0)) + '</span>' +
              '<div><div style="font-size:14px">' + esc(p.agent.nom) + '</div><div class="se-hint">' + esc(p.agent.role) + '</div></div>' +
            '</div>' +
            '<a class="se-btn soft block" style="margin-top:14px" href="#/messages">Ouvrir la conversation</a>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------- mon bien ------------------------------- */

  function viewMonBien() {
    const mien = maFiche();

    if (!mien) {
      draftPhotos = null;
      return viewHead('Adhésion', 'Déposez votre bien',
        'C’est la condition d’entrée : votre bien ouvre le catalogue des autres membres. Sans mandat, sans engagement, sans commission.') +
        bienForm(null);
    }

    if (monBienEdit) {
      return viewHead('Mon bien', 'Modifier ma fiche', 'Vos modifications sont visibles par les membres dès l’enregistrement.',
        '<button class="se-btn ghost" data-act="mon-bien-annuler">Annuler</button>') + bienForm(mien);
    }

    const offres = state.offres.filter((o) => o.sens === 'recue' && o.bienId === mien.id);
    const visites = state.visites.filter((v) => v.bienId === mien.id);

    return viewHead('Mon bien', esc(mien.titre),
      esc(mien.type) + ' · ' + esc(mien.label) + ' · ' + num(mien.surface) + ' m²',
      '<button class="se-btn ghost" data-act="mon-bien-sync">Rafraîchir</button>' +
      '<button class="se-btn ghost" data-act="mon-bien-edit">Modifier</button>' +
      '<button class="se-btn" data-act="mon-bien-statut">' + (mien.statut === 'ouvert' ? 'Repasser en avant-première' : 'Ouvrir aux visites') + '</button>') +

      '<div class="se-split">' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card" style="padding:0;overflow:hidden">' +
            '<div class="se-bien-photo" style="aspect-ratio:16/9">' +
              (photoOf(mien) ? '<img src="' + photoOf(mien) + '" alt=""/>' : '') +
              badge(mien.statut) +
            '</div>' +
            '<div style="padding:20px">' +
              '<p style="margin:0;color:var(--color-graphite);font-size:14.5px;line-height:1.6">' + esc(mien.description) + '</p>' +
              '<div class="se-chips" style="margin-top:14px">' + mien.atouts.map((a) => '<span class="se-chip" style="cursor:default">' + esc(a) + '</span>').join('') + '</div>' +
              '<div class="se-divider"></div>' +
              '<div class="se-grid cols-4" style="gap:12px">' +
                stat('Prix', euro(mien.prix)) + stat('€/m²', euro(prixM2(mien))) +
                stat('Surface', num(mien.surface) + ' m²') + stat('DPE', mien.dpe) +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="se-card">' +
            '<h3>Demandes de visite</h3>' +
            (visites.length ? '<div class="se-list">' + visites.map((v) => '<div class="se-list-item">' +
              '<div style="flex:1"><div style="font-size:14px">' + esc(v.demandeur || 'Membre') + '</div><div class="se-hint">' + esc(v.creneau) + '</div></div>' +
              '<span class="se-badge ' + (v.statut === 'confirmee' ? 'open' : v.statut === 'annulee' ? 'muted' : 'warn') + '">' + statutVisite(v.statut) + '</span>' +
            '</div>').join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Personne n’a encore demandé de visite.</p>') +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card">' +
            '<h3>Offres reçues</h3>' +
            (offres.length ? '<div class="se-list">' + offres.map((o) => '<div class="se-list-item">' +
              '<div style="flex:1"><div style="font-size:14px">' + euro(o.montant) + ' <span class="se-hint">(' + (pct(o.montant, mien.prix) > 0 ? '+' : '') + pct(o.montant, mien.prix) + ' %)</span></div>' +
              '<div class="se-hint">' + esc(o.auteur || 'Membre vérifié') + ' · ' + dateFR(o.at) + '</div></div>' +
              (o.statut === 'recue'
                ? '<button class="se-btn ghost sm" data-act="offre-refuser" data-id="' + o.id + '">Refuser</button>' +
                  '<button class="se-btn sm" data-act="offre-accepter" data-id="' + o.id + '">Accepter</button>'
                : '<span class="se-badge ' + (o.statut === 'acceptee' ? 'open' : 'muted') + '">' + (o.statut === 'acceptee' ? 'Acceptée' : 'Refusée') + '</span>') +
            '</div>').join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucune offre pour l’instant.</p>') +
          '</div>' +
          '<div class="se-card">' +
            '<h3>Diffusion</h3>' +
            '<div class="se-list" style="margin-top:8px">' +
              ligne('Statut', STATUTS[mien.statut].label) +
              ligne('Adresse', mien.adresseMasquee ? 'Quartier uniquement' : 'Adresse complète') +
              ligne('Membres qui suivent', num(mien.suiveurs)) +
              ligne('Publié le', dateFR(mien.cree)) +
            '</div>' +
            '<button class="se-btn danger block" style="margin-top:16px" data-act="mon-bien-supprimer">Retirer mon bien</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      blocsBien(mien);
  }

  function stat(label, value) {
    return '<div class="se-stat"><span class="se-kicker">' + label + '</span><span style="font-size:17px;font-weight:500">' + value + '</span></div>';
  }

  function ligne(label, value) {
    return '<div class="se-list-item" style="padding:9px 0"><span class="se-hint" style="flex:1">' + label + '</span><span style="font-size:13.5px">' + value + '</span></div>';
  }

  function statutVisite(s) {
    return { demandee: 'En attente', confirmee: 'Confirmée', realisee: 'Réalisée', annulee: 'Annulée' }[s] || s;
  }

  function bienForm(b) {
    const v = b || {
      type: 'Appartement', quartier: 'p11', surface: '', pieces: '', chambres: '', sdb: '', etage: '',
      dpe: 'D', prix: '', description: '', atouts: [], photos: [], statut: 'brouillon', adresseMasquee: true
    };
    if (draftPhotos === null) draftPhotos = (v.photos || []).slice();
    const photos = draftPhotos;

    const options = (list, cur) => list.map((o) => '<option value="' + o + '"' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('');
    const quartiers = QUARTIERS.map((q) => '<option value="' + q.id + '"' + (q.id === v.quartier ? ' selected' : '') + '>' + q.label + '</option>').join('');

    return '<form data-form="bien">' +
      '<div class="se-grid cols-2" style="gap:18px;align-items:start">' +
        '<div class="se-card">' +
          '<h3>Le bien</h3><p class="se-muted">Ce que verront les membres.</p>' +
          '<div class="se-form-grid" style="margin-top:16px">' +
            '<div class="se-field"><label>Type</label><select class="se-select" name="type">' + options(TYPES, v.type) + '</select></div>' +
            '<div class="se-field"><label>Quartier</label><select class="se-select" name="quartier">' + quartiers + '</select></div>' +
            '<div class="se-field"><label>Surface (m²)</label><input class="se-input" name="surface" type="number" min="1" value="' + esc(v.surface) + '" data-live="prix"/></div>' +
            '<div class="se-field"><label>Pièces</label><input class="se-input" name="pieces" type="number" min="1" value="' + esc(v.pieces) + '"/></div>' +
            '<div class="se-field"><label>Chambres</label><input class="se-input" name="chambres" type="number" min="0" value="' + esc(v.chambres) + '"/></div>' +
            '<div class="se-field"><label>Salles de bain</label><input class="se-input" name="sdb" type="number" min="0" value="' + esc(v.sdb) + '"/></div>' +
            '<div class="se-field"><label>Étage</label><input class="se-input" name="etage" value="' + esc(v.etage) + '" placeholder="4ᵉ"/></div>' +
            '<div class="se-field"><label>DPE</label><select class="se-select" name="dpe">' + options(['A', 'B', 'C', 'D', 'E', 'F', 'G'], v.dpe) + '</select></div>' +
            '<div class="se-field full"><label>Titre de la fiche</label><input class="se-input" name="titre" value="' + esc(v.titre || '') + '" placeholder="Quatre pièces sur la Seine"/></div>' +
            '<div class="se-field full"><label>Description</label><textarea class="se-textarea" name="description" placeholder="Ce qui fait la différence : lumière, vue, volumes…">' + esc(v.description) + '</textarea></div>' +
            '<div class="se-field full"><label>Points forts</label><div class="se-chips">' +
              ATOUTS.map((a) => '<button type="button" class="se-chip" data-act="atout" data-id="' + esc(a) + '" aria-pressed="' + (v.atouts.indexOf(a) > -1) + '">' + esc(a) + '</button>').join('') +
            '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card">' +
            '<h3>Prix</h3>' +
            '<div class="se-field" style="margin-top:10px"><label>Prix de présentation</label><input class="se-input" name="prix" type="number" min="0" value="' + esc(v.prix) + '" data-live="prix"/></div>' +
            '<p class="se-hint" id="prix-conseil">Le conseil s’affiche ici.</p>' +
            '<div class="se-hint">Sans mandat, sans commission : vous restez libre.</div>' +
          '</div>' +
          '<div class="se-card">' +
            '<h3>Photos</h3>' +
            '<div class="se-photos" style="margin-top:12px">' +
              photos.map((p, i) => '<div class="se-photo"><img src="' + (/^data:/.test(p) ? p : 'assets/img/' + p) + '" alt=""/><button type="button" data-act="photo-del" data-id="' + i + '">×</button></div>').join('') +
              '<label class="se-photo-add"><input type="file" accept="image/*" multiple hidden data-upload="photos"/>' + ICONS.plus + '<span>Ajouter</span></label>' +
            '</div>' +
            '<p class="se-hint" style="margin-top:10px">Jusqu’à 8 photos. Elles restent sur votre appareil (démo).</p>' +
          '</div>' +
          '<div class="se-card">' +
            '<h3>Diffusion</h3>' +
            '<div class="se-field" style="margin-top:10px"><label>Visibilité</label><select class="se-select" name="statut">' +
              '<option value="brouillon"' + (v.statut === 'brouillon' ? ' selected' : '') + '>Brouillon — invisible</option>' +
              '<option value="avant-premiere"' + (v.statut === 'avant-premiere' ? ' selected' : '') + '>Avant-première — membres uniquement</option>' +
              '<option value="ouvert"' + (v.statut === 'ouvert' ? ' selected' : '') + '>Ouvert aux visites</option>' +
            '</select></div>' +
            '<label class="se-switch" style="margin-top:14px"><input type="checkbox" name="adresseMasquee"' + (v.adresseMasquee !== false ? ' checked' : '') + '/> Masquer l’adresse exacte</label>' +
            '<button class="se-btn block" type="submit" style="margin-top:18px">' + (b ? 'Enregistrer' : 'Créer ma fiche') + '</button>' +
            (b ? '<button class="se-btn ghost block" type="button" style="margin-top:8px" data-act="mon-bien-annuler">Annuler</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</form>';
  }

  /* ------------------------------- catalogue ------------------------------ */

  function viewCatalogue() {
    const f = state.__filtres || {};
    const biens = tousBiens().filter((b) => {
      if (!surLaPlateforme(b.statut)) return false;
      if (f.q) {
        const hay = (b.titre + ' ' + b.label + ' ' + b.type + ' ' + b.description).toLowerCase();
        if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
      }
      if (f.type && b.type !== f.type) return false;
      if (f.statut && b.statut !== f.statut) return false;
      if (f.prix && b.prix > Number(f.prix)) return false;
      if (f.pieces && b.pieces < Number(f.pieces)) return false;
      return true;
    });

    return viewHead('Catalogue', 'Les biens du club',
      'Visibles nulle part ailleurs. ' + biens.length + ' bien(s) correspondent à votre recherche.',
      '<button class="se-btn soft" data-act="outils-compare">Comparer (' + state.compare.length + ')</button>') +

      '<div class="se-card pad-sm" style="margin-bottom:18px">' +
        '<div class="se-filters">' +
          '<input class="se-input se-search" data-filter="q" placeholder="Rechercher un bien, un quartier…" value="' + esc(f.q || '') + '"/>' +
          '<select class="se-select" data-filter="type"><option value="">Tous les types</option>' + TYPES.map((t) => '<option' + (f.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
          '<select class="se-select" data-filter="statut"><option value="">Tous les statuts</option>' +
            '<option value="avant-premiere"' + (f.statut === 'avant-premiere' ? ' selected' : '') + '>Avant-première</option>' +
            '<option value="ouvert"' + (f.statut === 'ouvert' ? ' selected' : '') + '>Ouvert aux visites</option>' +
            '<option value="sous-offre"' + (f.statut === 'sous-offre' ? ' selected' : '') + '>Sous offre</option>' +
          '</select>' +
          '<select class="se-select" data-filter="prix"><option value="">Tous les prix</option>' +
            [1500000, 2000000, 2500000, 3000000].map((p) => '<option value="' + p + '"' + (String(f.prix) === String(p) ? ' selected' : '') + '>≤ ' + num(p) + ' €</option>').join('') +
          '</select>' +
          '<select class="se-select" data-filter="pieces"><option value="">Toutes surfaces</option>' +
            [3, 4, 5].map((p) => '<option value="' + p + '"' + (String(f.pieces) === String(p) ? ' selected' : '') + '>' + p + ' pièces et +</option>').join('') +
          '</select>' +
          '<button class="se-btn ghost sm" data-act="filtres-reset">Réinitialiser</button>' +
        '</div>' +
      '</div>' +

      (biens.length
        ? '<div class="se-bien-grid">' + biens.map(bienCard).join('') + '</div>'
        : '<div class="se-card se-empty"><div class="se-empty-title">Aucun bien ne correspond</div><p>Élargissez les critères ou réinitialisez les filtres.</p></div>');
  }

  /* -------------------------------- fiche --------------------------------- */

  function viewBien(r) {
    const b = bien(r.param);
    if (!b) return '<div class="se-card se-empty"><div class="se-empty-title">Bien introuvable</div><a class="se-btn" href="#/catalogue">Retour au catalogue</a></div>';

    const suivi = state.suivis.indexOf(b.id) > -1;
    const compares = state.compare.indexOf(b.id) > -1;
    const mien = b.mien || (state.monBien && state.monBien.id === b.id);

    return viewHead(b.type + ' · ' + b.label, esc(b.titre), '',
      (mien
        ? '<button class="se-btn" data-act="mon-bien-edit">Modifier ma fiche</button>'
        : '<button class="se-btn ghost" data-act="suivre" data-id="' + b.id + '">' + (suivi ? 'Ne plus suivre' : 'Suivre ce bien') + '</button>' +
          '<button class="se-btn ghost" data-act="comparer" data-id="' + b.id + '">' + (compares ? 'Retirer du comparateur' : 'Comparer') + '</button>' +
          '<button class="se-btn soft" data-act="offre-open" data-id="' + b.id + '">Faire une offre</button>') +
      '<button class="se-btn" data-act="visite-open" data-id="' + b.id + '">Demander une visite</button>') +

      '<div class="se-split">' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card" style="padding:0;overflow:hidden">' +
            '<div class="se-bien-photo" style="aspect-ratio:16/9">' + (photoOf(b) ? '<img src="' + photoOf(b) + '" alt=""/>' : '') + badge(b.statut) + '</div>' +
            '<div class="se-photos" style="padding:12px;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">' +
              (b.photos || []).map((p) => '<div class="se-photo"><img src="' + (/^data:/.test(p) ? p : 'assets/img/' + p) + '" alt=""/></div>').join('') +
            '</div>' +
          '</div>' +
          '<div class="se-card">' +
            '<h3>Le bien</h3>' +
            '<p style="color:var(--color-graphite);font-size:15px;line-height:1.65;margin:10px 0 0">' + esc(b.description) + '</p>' +
            '<div class="se-chips" style="margin-top:14px">' + (b.atouts || []).map((a) => '<span class="se-chip" style="cursor:default">' + esc(a) + '</span>').join('') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card">' +
            '<div class="se-stat"><span class="se-kicker">Prix</span><span class="se-num" style="font-size:34px">' + euro(b.prix) + '</span>' +
            '<span class="se-sub">' + euro(prixM2(b)) + ' / m²</span></div>' +
            '<div class="se-divider"></div>' +
            '<div class="se-grid cols-2" style="gap:14px">' +
              stat('Surface', num(b.surface) + ' m²') + stat('Pièces', b.pieces) +
              stat('Chambres', b.chambres) + stat('Salles d’eau', b.sdb) +
              stat('Étage', b.etage || '—') + stat('DPE', b.dpe) +
            '</div>' +
            '<div class="se-divider"></div>' +
            '<div class="se-list" style="margin-top:4px">' +
              ligne('Quartier', esc(b.label)) +
              ligne('Adresse', b.adresseMasquee === false ? 'Communiquée après visite' : 'Masquée — quartier seulement') +
              ligne('Membres qui suivent', num(b.suiveurs || 0)) +
              ligne('Statut', badge(b.statut)) +
            '</div>' +
          '</div>' +
          '<div class="se-note"><b>Pourquoi c’est ici&nbsp;:</b> ce bien n’est pas sur le marché. Son propriétaire le présente en avant-première au club, et l’ouvrira aux visites quand il sera prêt.</div>' +
        '</div>' +
      '</div>';
  }

  /* -------------------------------- visites ------------------------------- */

  function viewVisites() {
    const mes = state.visites.filter((v) => v.sens !== 'recue');
    const recues = state.visites.filter((v) => v.sens === 'recue');

    const item = (v) => {
      const b = bien(v.bienId);
      return '<div class="se-list-item">' +
        (b ? '<img class="se-thumb" src="' + photoOf(b) + '" alt=""/>' : '') +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14.5px">' + esc(b ? b.titre : 'Bien retiré') + '</div>' +
          '<div class="se-hint">' + esc(b ? b.label : '') + ' · ' + esc(v.creneau) + (v.demandeur ? ' · ' + esc(v.demandeur) : '') + '</div>' +
        '</div>' +
        '<span class="se-badge ' + (v.statut === 'confirmee' ? 'open' : v.statut === 'annulee' ? 'muted' : v.statut === 'realisee' ? 'muted' : 'warn') + '">' + statutVisite(v.statut) + '</span>' +
        (v.sens === 'recue' && v.statut === 'demandee'
          ? '<button class="se-btn sm" data-act="visite-confirmer" data-id="' + v.id + '">Confirmer</button>'
          : v.statut === 'demandee' || v.statut === 'confirmee'
            ? '<button class="se-btn ghost sm" data-act="visite-annuler" data-id="' + v.id + '">Annuler</button>'
            : '') +
      '</div>';
    };

    return viewHead('Visites', 'Vos visites',
      'Seecret organise chaque visite. Vous n’avez rien à coordonner.') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<div class="se-card"><h3>Mes demandes</h3>' +
          (mes.length ? '<div class="se-list" style="margin-top:8px">' + mes.map(item).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucune demande. <a href="#/catalogue">Parcourir le catalogue</a>.</p>') +
        '</div>' +
        '<div class="se-card"><h3>Demandes reçues</h3>' +
          (recues.length ? '<div class="se-list" style="margin-top:8px">' + recues.map(item).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">' + (maFiche() ? 'Aucune demande pour votre bien.' : 'Déposez votre bien pour recevoir des demandes.') + '</p>') +
        '</div>' +
      '</div>';
  }

  /* --------------------------------- offres ------------------------------- */

  function viewOffres() {
    const envoyees = state.offres.filter((o) => o.sens === 'envoyee');
    const recues = state.offres.filter((o) => o.sens === 'recue');

    const item = (o, recue) => {
      const b = bien(o.bienId);
      const ref = b ? b.prix : o.montant;
      const delta = pct(o.montant, ref);
      return '<div class="se-list-item" style="align-items:flex-start">' +
        (b ? '<img class="se-thumb" src="' + photoOf(b) + '" alt=""/>' : '') +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14.5px">' + esc(b ? b.titre : 'Bien retiré') + '</div>' +
          '<div class="se-hint">' + euro(o.montant) + ' · ' + (delta > 0 ? '+' : '') + delta + ' % vs prix · ' + dateFR(o.at) + '</div>' +
          (o.message ? '<div class="se-hint" style="margin-top:4px;font-style:italic">« ' + esc(o.message) + ' »</div>' : '') +
          (recue ? '<div class="se-hint" style="margin-top:4px">De ' + esc(o.auteur || 'membre vérifié') + '</div>' : '') +
        '</div>' +
        (recue && o.statut === 'recue'
          ? '<div class="se-row" style="gap:6px"><button class="se-btn ghost sm" data-act="offre-refuser" data-id="' + o.id + '">Refuser</button><button class="se-btn sm" data-act="offre-accepter" data-id="' + o.id + '">Accepter</button></div>'
          : '<span class="se-badge ' + (o.statut === 'acceptee' ? 'open' : o.statut === 'refusee' ? 'muted' : 'warn') + '">' + statutOffre(o.statut) + '</span>') +
      '</div>';
    };

    return viewHead('Offres', 'Vos offres',
      'Une offre se fait avant même que le bien n’apparaisse sur le marché.') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<div class="se-card"><h3>Offres envoyées</h3>' +
          (envoyees.length ? '<div class="se-list" style="margin-top:8px">' + envoyees.map((o) => item(o, false)).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucune offre envoyée.</p>') +
        '</div>' +
        '<div class="se-card"><h3>Offres reçues</h3>' +
          (recues.length ? '<div class="se-list" style="margin-top:8px">' + recues.map((o) => item(o, true)).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">' + (maFiche() ? 'Aucune offre pour votre bien.' : 'Déposez votre bien pour recevoir des offres.') + '</p>') +
        '</div>' +
      '</div>';
  }

  function statutOffre(s) {
    return { envoyee: 'Envoyée', recue: 'Nouvelle', acceptee: 'Acceptée', refusee: 'Refusée', contre: 'Contre-offre' }[s] || s;
  }

  /* -------------------------------- messages ------------------------------ */

  function viewMessages() {
    const p = state.profil;
    return viewHead('Messages', 'Votre agent',
      esc(p.agent.nom) + ' · ' + esc(p.agent.role)) +
      '<div class="se-card" style="max-width:720px">' +
        '<div class="se-row" style="gap:10px;margin-bottom:14px">' +
          '<span class="se-avatar">' + esc(p.agent.nom.charAt(0)) + '</span>' +
          '<div><div style="font-size:14px">' + esc(p.agent.nom) + '</div><div class="se-hint">Répond en général en quelques minutes</div></div>' +
        '</div>' +
        '<div class="se-chat" id="chat">' +
          state.messages.map((m) => '<div class="se-bubble ' + (m.de === 'moi' ? 'me' : 'agent') + '">' + esc(m.texte) + '<time>' + timeFR(m.at) + '</time></div>').join('') +
        '</div>' +
        '<form class="se-composer" data-form="message">' +
          '<input class="se-input" name="texte" placeholder="Écrire à votre agent…" autocomplete="off"/>' +
          '<button class="se-btn" type="submit">Envoyer</button>' +
        '</form>' +
      '</div>';
  }

  /* --------------------------------- profil ------------------------------- */

  const shortUA = (ua) => {
    const t = String(ua || '');
    const nav = /Edg\//.test(t) ? 'Edge' : /Chrome\//.test(t) ? 'Chrome' : /Safari\//.test(t) ? 'Safari' : /Firefox\//.test(t) ? 'Firefox' : 'Navigateur';
    const os = /iPhone|iPad/.test(t) ? 'iOS' : /Mac OS X/.test(t) ? 'macOS' : /Android/.test(t) ? 'Android' : /Windows/.test(t) ? 'Windows' : '';
    return os ? nav + ' · ' + os : nav;
  };

  function viewProfil() {
    const m = state.membre || state.profil || {};
    const docs = state.docs || [];
    const valides = docs.filter((d) => d.statut === 'valide').length;
    const types = [
      ['identite', 'Pièce d’identité', 'Recto/verso · JPG ou PDF'],
      ['financement', 'Justificatif de financement', 'Accord de principe, attestation'],
      ['bien', 'Titre de propriété', 'Ou justificatif de propriété']
    ];
    const uploades = types.filter((t) => docs.some((d) => d.type === t[0])).length;
    const ligne = (key, label, aide) => {
      const list = docs.filter((d) => d.type === key);
      const last = list[0];
      const statut = last
        ? (last.statut === 'valide' ? '<span class="se-badge open">Validé</span>' : '<span class="se-badge warn">À vérifier</span>')
        : '<span class="se-badge muted">Non fourni</span>';
      return '<div class="se-list-item">' +
        '<div style="flex:1;min-width:0"><div style="font-size:14px">' + label + '</div>' +
        '<div class="se-hint">' + (last ? esc(last.nom) + ' · ' + dateFR(last.cree) : aide) + '</div></div>' +
        statut +
        (last ? '<a class="se-btn ghost sm" href="' + esc(last.fichier) + '" target="_blank" rel="noopener">Voir</a>' : '') +
        '<label class="se-btn ghost sm" style="margin:0;cursor:pointer">' + (last ? 'Remplacer' : 'Ajouter') +
          '<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden data-doc="' + key + '"/></label>' +
      '</div>';
    };

    return edHead('Mon profil', 'Votre compte', 'Vos informations et vos documents de vérification.') +
      '<div class="ed-detail-grid">' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="ed-panel">' +
            '<span class="ed-kicker">Identité</span>' +
            '<h3 style="margin:8px 0 2px">' + esc(((m.prenom || '') + ' ' + (m.nom || '')).trim() || 'Membre') + '</h3>' +
            '<p class="se-muted" style="margin:0">' + esc(m.email || '') + '</p>' +
            '<div class="se-divider"></div>' +
            '<div class="se-row" style="justify-content:space-between"><span class="se-hint">Statut</span><b style="font-weight:500">' + (m.statut === 'accepte' ? 'Membre validé' : '—') + '</b></div>' +
            '<div class="se-row" style="justify-content:space-between;margin-top:8px"><span class="se-hint">Passkeys</span><b style="font-weight:500">' + (m.passkeys || 0) + ' appareil(s)</b></div>' +
            '<div class="se-row" style="justify-content:space-between;margin-top:8px"><span class="se-hint">Dernière connexion</span><b style="font-weight:500">' + (m.derniereConnexion ? dateFR(m.derniereConnexion) : '—') + '</b></div>' +
          '</div>' +
          '<div class="ed-panel">' +
            '<div class="se-row" style="justify-content:space-between"><h3 style="margin:0">Vérification</h3><span class="se-badge ' + (valides === 3 ? 'open' : 'warn') + '">' + valides + '/3</span></div>' +
            '<p class="se-muted" style="margin:6px 0 4px">Vos documents sont examinés par l’agence.</p>' +
            '<div class="se-list" style="margin-top:8px">' + types.map((t) => ligne(t[0], t[1], t[2])).join('') + '</div>' +
            '<button class="se-btn block" style="margin-top:14px' + (uploades < 3 ? ';opacity:.45;pointer-events:none' : '') + '"' + (uploades < 3 ? ' disabled title="Ajoutez vos 3 documents pour envoyer"' : '') + ' data-act="adhesion-envoyer">Envoyer mon dossier</button>' +
            (m.dossierEnvoye ? '<p class="se-hint" style="margin:10px 0 0;color:var(--color-ok)">✅ Dossier bien reçu. Nos équipes analysent vos documents pour valider votre accès complet à la plateforme.</p>' : '') +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="ed-panel">' +
            '<div class="se-row" style="justify-content:space-between"><h3 style="margin:0">Mandat de recherche</h3>' + (state.mandatActif ? '<span class="se-badge open">Signé</span>' : '<span class="se-badge muted">Non signé</span>') + '</div>' +
            (state.mandatActif
              ? '<p class="se-muted" style="margin:6px 0 0">N° ' + esc(state.mandatActif.numero) + ' · signé le ' + dateFR(state.mandatActif.signeLe) + ' · valable jusqu’au ' + dateFR(state.mandatActif.expireLe) + '.</p>' +
                '<a class="se-btn ghost block" style="margin-top:12px" href="/api/mandat/' + encodeURIComponent(state.mandatActif.id) + '/document" target="_blank" rel="noopener">Voir mon mandat signé</a>'
              : '<p class="se-muted" style="margin:6px 0 0">Il vous sera proposé à votre première demande de visite. Gratuit : les honoraires ne sont dus qu’à l’achat.</p>') +
          '</div>' +
          '<div class="ed-panel">' +
            '<h3>Connexions récentes</h3>' +
            '<div class="se-list" style="margin-top:8px">' +
              ((m.connexions || []).length
                ? m.connexions.slice(0, 5).map((c) => '<div class="se-list-item"><div style="flex:1"><div style="font-size:13.5px">' + dateFR(c.at) + ' · ' + timeFR(c.at) + '</div><div class="se-hint">' + esc(c.ip) + ' · ' + esc(shortUA(c.ua)) + '</div></div></div>').join('')
                : '<p class="se-muted">Aucune connexion enregistrée.</p>') +
            '</div>' +
          '</div>' +
          '<div class="ed-panel">' +
            '<h3>Session</h3><p class="se-muted">Votre accès est protégé par une clé stockée sur cet appareil.</p>' +
            '<button class="se-btn ghost block" style="margin-top:12px" data-act="logout">Se déconnecter</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function switchRow(name, label, checked) {
    return '<label class="se-switch"><input type="checkbox" data-notif="' + name + '"' + (checked ? ' checked' : '') + '/> ' + label + '</label>';
  }

  function verifRow(key, titre, texte, done) {
    return '<div class="se-list-item">' +
      '<span class="se-avatar" style="background:' + (done ? 'var(--color-ok)' : 'var(--color-stroke)') + ';color:' + (done ? '#fff' : 'var(--color-graphite)') + ';width:26px;height:26px;flex:0 0 26px;font-size:12px">' + (done ? '✓' : '·') + '</span>' +
      '<div style="flex:1"><div style="font-size:14px">' + titre + '</div><div class="se-hint">' + texte + '</div></div>' +
      (done ? '<span class="se-badge open">Vérifié</span>' : '<button class="se-btn ghost sm" data-act="verifier" data-id="' + key + '">Vérifier</button>') +
    '</div>';
  }

  /* --------------------------------- outils ------------------------------- */

  function viewOutils() {
    const compare = state.compare.map(bien).filter(Boolean);

    return viewHead('Outils', 'Boîte à outils',
      'Tout ce qu’un membre a besoin de calculer, comparer ou imprimer.') +
      '<div class="se-grid cols-2" style="align-items:start">' +

        '<div class="se-card">' +
          '<h3>Simulateur de financement</h3><p class="se-muted">Mensualité, frais et coût total.</p>' +
          '<form data-form="simu" class="se-form-grid" style="margin-top:16px">' +
            '<div class="se-field"><label>Prix du bien</label><input class="se-input" name="prix" type="number" value="1280000"/></div>' +
            '<div class="se-field"><label>Apport</label><input class="se-input" name="apport" type="number" value="200000"/></div>' +
            '<div class="se-field"><label>Taux annuel (%)</label><input class="se-input" name="taux" type="number" step="0.05" value="3.4"/></div>' +
            '<div class="se-field"><label>Durée (années)</label><input class="se-input" name="duree" type="number" value="25"/></div>' +
            '<div class="full"><button class="se-btn" type="submit">Calculer</button></div>' +
          '</form>' +
          '<div id="simu-out" style="margin-top:16px"></div>' +
        '</div>' +

        '<div class="se-card">' +
          '<h3>Estimation rapide</h3><p class="se-muted">Fourchette indicative au m², par arrondissement.</p>' +
          '<form data-form="estim" class="se-form-grid" style="margin-top:16px">' +
            '<div class="se-field"><label>Quartier</label><select class="se-select" name="quartier">' +
              QUARTIERS.filter((q) => q.arrondissement).map((q) => '<option value="' + q.id + '">' + q.label + '</option>').join('') +
            '</select></div>' +
            '<div class="se-field"><label>Surface (m²)</label><input class="se-input" name="surface" type="number" value="85"/></div>' +
            '<div class="full"><button class="se-btn" type="submit">Estimer</button></div>' +
          '</form>' +
          '<div id="estim-out" style="margin-top:16px"></div>' +
        '</div>' +

        '<div class="se-card">' +
          '<h3>Comparateur</h3><p class="se-muted">Sélectionnez des biens pour les comparer.</p>' +
          '<form data-form="compare" style="margin-top:12px">' +
            '<select class="se-select" multiple size="6" name="ids" style="height:auto">' +
              tousBiens().filter((b) => b.statut !== 'brouillon').map((b) => '<option value="' + b.id + '"' + (state.compare.indexOf(b.id) > -1 ? ' selected' : '') + '>' + esc(b.titre) + ' — ' + euro(b.prix) + '</option>').join('') +
            '</select>' +
            '<button class="se-btn block" type="submit" style="margin-top:12px">Comparer</button>' +
          '</form>' +
          (compare.length ? compareTable(compare) : '<p class="se-hint" style="margin-top:12px">Aucun bien sélectionné.</p>') +
        '</div>' +

        '<div class="se-card">' +
          '<h3>Données & impression</h3>' +
          '<p class="se-muted">Sauvegardez ou rechargez votre espace, imprimez une fiche.</p>' +
          '<div class="se-grid" style="margin-top:14px;gap:8px">' +
            '<button class="se-btn ghost block" data-act="export">Exporter (JSON)</button>' +
            '<label class="se-btn ghost block" style="cursor:pointer">Importer un JSON<input type="file" accept="application/json" hidden data-upload="import"/></label>' +
            '<button class="se-btn ghost block" data-act="print">Imprimer la fiche de mon bien</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function compareTable(list) {
    const rows = [
      ['Prix', (b) => euro(b.prix)],
      ['€ / m²', (b) => euro(prixM2(b))],
      ['Surface', (b) => num(b.surface) + ' m²'],
      ['Pièces', (b) => b.pieces],
      ['Chambres', (b) => b.chambres],
      ['DPE', (b) => b.dpe],
      ['Quartier', (b) => esc(b.label)],
      ['Statut', (b) => STATUTS[b.statut].label]
    ];
    return '<div style="overflow-x:auto;margin-top:14px"><table class="se-table"><thead><tr><th></th>' +
      list.map((b) => '<th>' + esc(b.titre) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(([label, fn]) => '<tr><td class="se-hint">' + label + '</td>' + list.map((b) => '<td>' + fn(b) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  /* --------------------------------- agence ------------------------------- */

  function viewAgence() {
    const biens = tousBiens().filter((b) => b.statut !== 'brouillon');
    const colonnes = [
      { statut: 'avant-premiere', titre: 'Avant-première' },
      { statut: 'ouvert', titre: 'Ouvert aux visites' },
      { statut: 'sous-offre', titre: 'Sous offre' },
      { statut: 'vendu', titre: 'Vendu' }
    ];
    const valeur = biens.reduce((n, b) => n + b.prix, 0);
    const visits = state.visites.filter((v) => v.statut === 'demandee').length;

    return viewHead('Coulisses', 'Pipeline agence',
      'Vue cabinet : où en est chaque bien, et ce qui attend une décision.') +
      '<div class="se-grid cols-4" style="margin-bottom:18px">' +
        '<div class="se-card se-stat"><span class="se-kicker">Biens au club</span><span class="se-num">' + biens.length + '</span><span class="se-sub">' + colonnes.reduce((n, c) => n + biens.filter((b) => b.statut === c.statut).length, 0) + ' actifs</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Valeur du portefeuille</span><span class="se-num" style="font-size:22px">' + euro(valeur) + '</span><span class="se-sub">prix de présentation</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Visites à organiser</span><span class="se-num">' + visits + '</span><span class="se-sub">demandes en attente</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Offres en cours</span><span class="se-num">' + offresEnCours() + '</span><span class="se-sub">à arbitrer</span></div>' +
      '</div>' +
      '<div class="se-kanban">' +
        colonnes.map((c) => {
          const items = biens.filter((b) => b.statut === c.statut);
          return '<div class="se-col"><h4>' + c.titre + '<span>' + items.length + '</span></h4>' +
            (items.length ? items.map((b) => '<div class="se-mini"><b>' + esc(b.titre) + '</b><span>' + esc(b.label) + ' · ' + euro(b.prix) + '</span></div>').join('') : '<div class="se-hint" style="padding:10px 4px">—</div>') +
          '</div>';
        }).join('') +
      '</div>';
  }

  /* ================================ actions ================================ */

  const actions = {
    'send-code': async (el) => {
      const form = el.closest('form');
      const input = form ? form.querySelector('[name="email"]') : null;
      const email = String((input && input.value) || '').trim().toLowerCase();
      if (!email) { toast('Saisissez votre email.', 'warn'); return; }
      try {
        await API.send('POST', '/api/auth/enroll', { email: email, turnstileToken: window.SeecretTurnstile ? await window.SeecretTurnstile.jeton() : '' });
        state.__pendingEmail = email;
        toast('Code envoyé à ' + email + '.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible.', 'warn'); }
    },
    'logout': async () => {
      try { await API.send('POST', '/api/auth/logout'); } catch (e) { /* ignore */ }
      state.session = null; state.membre = null; state.monBien = null; state.docs = []; state.mesNotifications = [];
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      location.href = '/espace.html';
    },
    'notif-lu': async (el) => {
      const id = el.getAttribute('data-id');
      try {
        await API.send('POST', '/api/mes-notifications/' + id + '/lu');
        const n = (state.mesNotifications || []).find((x) => x.id === id);
        if (n) n.lue = true;
        render();
      } catch (e) { toast(e.message || 'Action impossible.', 'warn'); }
    },
    'visibilite': async (el) => {
      try {
        await API.send('POST', '/api/mon-bien/visibilite', { demande: 'ouvert' });
        state.monBien.statutDemande = 'ouvert';
        render();
        toast('Demande de visite ouverte envoyée à votre agent.');
      } catch (e) { toast(e.message, 'warn'); }
    },
    'adhesion-envoyer': async () => {
      try {
        await API.send('POST', '/api/adhesion/submit', {});
        if (state.membre) state.membre.dossierEnvoye = true;
        render();
        toast('Dossier bien reçu. Nos équipes analysent vos documents.', 'ok');
      } catch (e) { toast(e.message || 'Envoi impossible.', 'warn'); }
    },
    'photo-principale': async (el) => {
      const url = el.getAttribute('data-url');
      try {
        const r = await API.send('PATCH', '/api/mon-bien/photos', { principale: url });
        state.monBien.photos = r.photos;
        render();
      } catch (e) { toast(e.message, 'warn'); }
    },
    'photo-suppr': async (el) => {
      const url = el.getAttribute('data-url');
      try {
        const r = await API.send('DELETE', '/api/mon-bien/photos', { url: url });
        state.monBien.photos = r.photos;
        render();
      } catch (e) { toast(e.message, 'warn'); }
    },
    'mon-bien-edit': () => { draftPhotos = (state.monBien && state.monBien.photos ? state.monBien.photos : []).slice(); monBienEdit = true; render(); },
    'mon-bien-annuler': () => { draftPhotos = null; monBienEdit = false; render(); },
    'mon-bien-supprimer': () => {
      if (!confirm('Retirer votre bien du club ?')) return;
      state.monBien = null;
      monBienEdit = false;
      commit();
      toast('Votre bien a été retiré.');
    },
    'modif-open': () => { modal = modifModal(); render(); },
    'mon-bien-sync': () => {
      syncFromParcours(state.profil.email || (state.session && state.session.email));
      commit();
      toast('Fiche synchronisée avec l’agence.', 'ok');
    },
    'mon-bien-statut': () => {
      const b = state.monBien;
      if (!b) return;
      const versOuvert = b.statut !== 'ouvert';
      b.statut = versOuvert ? 'ouvert' : 'avant-premiere';
      if (versOuvert) b.suiveurs = (b.suiveurs || 0) + 1;
      // Notification à l'agent (CRM) : demande de changement de statut.
      pousserDemande({
        id: uid('d'), type: 'statut', bienId: b.id, email: state.profil.email,
        nom: (state.profil.prenom + ' ' + state.profil.nom).trim(),
        message: versOuvert ? 'Demande de mise en visite possible.' : 'Demande de retour en avant-première.',
        statut: versOuvert ? 'ouvert' : 'avant-premiere', source: 'Espace membre', cree: nowISO()
      });
      const biens = readBiens();
      const i = biens.findIndex((x) => (x.email || '').toLowerCase() === (state.profil.email || '').toLowerCase());
      if (i > -1) { biens[i].statutDemande = versOuvert ? 'ouvert' : 'avant-premiere'; writeBiens(biens); }
      commit();
      toast(versOuvert ? 'Demande envoyée à votre agent : passage en visite possible.' : 'Demande de retour en avant-première envoyée.');
    },
    'suivre': (el, id) => {
      const i = state.suivis.indexOf(id);
      if (i > -1) { state.suivis.splice(i, 1); toast('Bien retiré de vos favoris.'); }
      else { state.suivis.push(id); toast('Bien ajouté à vos favoris.'); }
      commit();
    },
    'comparer': (el, id) => {
      const i = state.compare.indexOf(id);
      if (i > -1) state.compare.splice(i, 1);
      else { if (state.compare.length >= 4) state.compare.shift(); state.compare.push(id); }
      commit();
    },
    'outils-compare': () => { location.hash = '#/outils'; },
    'more': () => { modal = moreSheet(); render(); },
    'visite-open': (el, id) => { modal = visiteModal(id); render(); },
    'mandat-ouvrir': () => { ouvrirMandat(); },
    'mandat-code': async (el) => {
      const statut = document.querySelector('[data-mandat-statut]');
      el.disabled = true;
      try {
        const r = await API.send('POST', '/api/mandat/code', {});
        if (statut) statut.textContent = 'Code envoyé à ' + r.envoyeA + ' (valable 10 minutes).';
        el.textContent = 'Renvoyer un code';
      } catch (e) {
        if (statut) statut.textContent = e.message || 'Envoi impossible.';
      }
      setTimeout(() => { el.disabled = false; }, 30000);
    },
    'offre-open': (el, id) => { modal = offreModal(id); render(); },
    'finaliser-adhesion': (el) => {
      const m = manquesAdhesion();
      if (m.docsManquants.length) {
        toast('Il vous manque : ' + m.docsManquants.join(', ') + '. Redirection vers votre profil…', 'warn');
        location.hash = '#/profil';
        return;
      }
      if (m.photosManquantes > 0) {
        toast('Il vous manque ' + m.photosManquantes + ' photo(s) de votre bien. Redirection vers « Mon bien »…', 'warn');
        location.hash = '#/mon-bien';
        return;
      }
      if (m.rechercheIncomplete) {
        toast('Il manque des informations dans votre recherche. Redirection vers « Ma recherche »…', 'warn');
        location.hash = '#/recherche';
        return;
      }
      toast('Votre dossier est complet et en cours d’analyse par l’agence.', 'ok');
    },
    'modal-close': (el, id, e) => {
      if (e.target.closest('[data-stop]') && !e.target.hasAttribute('data-act')) return;
      modal = null; render();
    },
    'visite-annuler': (el, id) => {
      const v = state.visites.find((x) => x.id === id);
      if (v) { v.statut = 'annulee'; commit(); toast('Demande de visite annulée.'); }
    },
    'visite-confirmer': (el, id) => {
      const v = state.visites.find((x) => x.id === id);
      if (v) { v.statut = 'confirmee'; commit(); toast('Visite confirmée.'); }
    },
    'offre-accepter': (el, id) => {
      const o = state.offres.find((x) => x.id === id);
      if (!o) return;
      o.statut = 'acceptee';
      state.offres.forEach((x) => { if (x !== o && x.bienId === o.bienId && x.sens === 'recue') x.statut = 'refusee'; });
      const b = bien(o.bienId); if (b && b.mien) b.statut = 'sous-offre';
      commit();
      toast('Offre acceptée. Seecret prend le relais.');
    },
    'offre-refuser': (el, id) => {
      const o = state.offres.find((x) => x.id === id);
      if (o) { o.statut = 'refusee'; commit(); toast('Offre refusée.'); }
    },
    'verifier': (el, key) => {
      el.disabled = true;
      el.textContent = 'Vérification…';
      setTimeout(() => {
        state.profil.verifications[key] = true;
        commit();
        toast('Vérification validée.', 'ok');
      }, 1100);
    },
    'atout': (el) => {
      const pressed = el.getAttribute('aria-pressed') === 'true';
      el.setAttribute('aria-pressed', String(!pressed));
    },
    'photo-del': (el, i) => {
      if (!draftPhotos) return;
      draftPhotos.splice(Number(i), 1);
      render();
    },
    'export': () => downloadJSON(),
    'print': () => window.print(),
    'reset': () => {
      if (!confirm('Réinitialiser la démonstration ? Toutes les données locales seront effacées.')) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      state = seedState();
      render();
      toast('Démonstration réinitialisée.');
    },
    'logout': () => {
      state.session = null;
      save();
      location.hash = '#/connexion';
      render();
    },
    'filtres-reset': () => { state.__filtres = {}; commit(); }
  };

  function currentPhotos(form) {
    if (form && form.dataset.photos) { try { return JSON.parse(form.dataset.photos); } catch (e) { return []; } }
    return (state.monBien && state.monBien.photos ? state.monBien.photos.slice() : []);
  }

  function moreSheet() {
    return '<h3>Menu</h3><p class="se-muted">Tout l’espace.</p>' +
      '<div class="se-list se-more-sheet">' +
        '<a class="se-list-item" href="#/offres" data-act="modal-close" style="text-decoration:none;color:inherit;padding:14px 4px">' + ICONS.tag + '<span style="flex:1;margin-left:10px">Offres</span>' + (offresRecues() ? '<span class="se-badge offer">' + offresRecues() + '</span>' : '') + '</a>' +
        '<a class="se-list-item" href="#/agence" style="text-decoration:none;color:inherit;padding:14px 4px">' + ICONS.users + '<span style="flex:1;margin-left:10px">Pipeline agence</span></a>' +
        '<a class="se-list-item" href="#/outils" style="text-decoration:none;color:inherit;padding:14px 4px">' + ICONS.tools + '<span style="flex:1;margin-left:10px">Outils</span></a>' +
        '<a class="se-list-item" href="#/profil" style="text-decoration:none;color:inherit;padding:14px 4px">' + ICONS.user + '<span style="flex:1;margin-left:10px">Mon profil</span></a>' +
        '<a class="se-list-item" href="index.html" style="text-decoration:none;color:inherit;padding:14px 4px">' + ICONS.out + '<span style="flex:1;margin-left:10px">Voir le site</span></a>' +
      '</div>';
  }

  function visiteModal(id) {
    const b = bien(id);
    const demain = new Date(Date.now() + 24 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const min = demain.getFullYear() + '-' + pad(demain.getMonth() + 1) + '-' + pad(demain.getDate()) + 'T08:00';
    const champ = (n, requis) => '<input class="se-input" type="datetime-local" name="creneau' + n + '" min="' + min + '" step="900"' + (requis ? ' required' : '') + ' style="margin-top:6px"/>';
    return '<h3>Demander une visite</h3><p class="se-muted">' + esc(b ? b.titre : '') + ' · ' + esc(b ? b.label : '') + '</p>' +
      '<form data-form="visite" data-bien="' + id + '">' +
        '<div class="se-field"><label>Vos disponibilités (jusqu’à 3 créneaux)</label>' + champ(1, true) + champ(2, false) + champ(3, false) + '</div>' +
        '<div class="se-field" style="margin-top:14px"><label>Message à l’agent (optionnel)</label><textarea class="se-textarea" name="note" style="min-height:80px" placeholder="Je suis disponible en fin de journée…"></textarea></div>' +
        '<p class="se-hint" style="margin-top:10px">' + (state.mandatActif ? 'Votre mandat de recherche est signé : l’agent confirme le créneau et vous envoie l’adresse par email et WhatsApp.' : 'Étape suivante : la signature en ligne de votre mandat de recherche (gratuit, honoraires dus uniquement à l’achat). L’adresse vous est envoyée à la confirmation de la visite.') + '</p>' +
        '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Envoyer la demande</button></div>' +
      '</form>';
  }

  // ---- Mandat de recherche : lecture, code par email, signature ----
  function mandatModal(info) {
    if (!info) return '<h3>Mandat de recherche</h3><p class="se-muted">Chargement du mandat…</p>';
    if (info.indisponible) {
      return '<h3>Demande enregistrée</h3><p class="se-muted">' + esc(info.message) + '</p><div class="se-modal-foot"><button class="se-btn" type="button" data-act="modal-close">Fermer</button></div>';
    }
    if (info.signeOk) {
      const m = info.mandat || {};
      return '<h3>Mandat signé</h3>' +
        '<p class="se-muted">Mandat n° ' + esc(m.numero || '') + ' signé le ' + esc(dateFR(m.signeLe)) + '. Une copie vient de vous être envoyée par email.</p>' +
        '<p style="margin-top:10px">Votre agent confirme maintenant le créneau de visite : vous recevrez <b>l’heure et l’adresse</b> par email et par WhatsApp.</p>' +
        (info.visitePossible && !info.visitePossible.ok ? '<p class="se-hint" style="margin-top:8px">' + esc(info.visitePossible.raison) + '</p>' : '') +
        '<div class="se-modal-foot"><a class="se-btn ghost" href="/api/mandat/' + encodeURIComponent(m.id || '') + '/document" target="_blank" rel="noopener">Voir mon mandat</a><button class="se-btn" type="button" data-act="modal-close">Fermer</button></div>';
    }
    if (info.mandat && info.mandat.statut === 'signe') {
      return '<h3>Mandat déjà signé</h3><p class="se-muted">Votre mandat de recherche n° ' + esc(info.mandat.numero) + ' est valable jusqu’au ' + esc(dateFR(info.mandat.expireLe)) + '. Votre agent confirme la visite et vous envoie l’adresse.</p><div class="se-modal-foot"><button class="se-btn" type="button" data-act="modal-close">Fermer</button></div>';
    }
    return '<h3>Signez votre mandat de recherche</h3>' +
      '<p class="se-muted">Gratuit, sans engagement d’achat : les honoraires ne sont dus qu’à la signature de l’acte de vente d’un bien présenté par l’agence. Ce mandat permet à votre agent de vous transmettre l’adresse et d’organiser la visite.</p>' +
      '<div class="se-mandat-texte">' + (info.apercu || '') + '</div>' +
      '<form data-form="mandat-signer" style="margin-top:14px">' +
        '<div class="se-field"><label>Votre adresse postale</label><input class="se-input" name="adresse" autocomplete="street-address" required placeholder="12 rue de l’Exemple, 75011 Paris"/></div>' +
        '<label class="se-switch" style="margin:12px 0 6px;align-items:flex-start"><input type="checkbox" name="accepte" required/> <span>J’ai lu le mandat de recherche et j’en accepte les termes.</span></label>' +
        '<label class="se-switch" style="margin:6px 0;align-items:flex-start"><input type="checkbox" name="demarrage" checked/> <span>Je demande que les visites puissent avoir lieu avant la fin de mon délai de rétractation de 14 jours (je conserve mon droit de rétractation).</span></label>' +
        '<div class="se-row" style="gap:8px;margin-top:12px;align-items:flex-end;flex-wrap:wrap">' +
          '<button class="se-btn ghost" type="button" data-act="mandat-code">Recevoir mon code par email</button>' +
          '<span class="se-hint" data-mandat-statut></span>' +
        '</div>' +
        '<div class="se-field" style="margin-top:12px"><label>Code reçu par email</label><input class="se-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required placeholder="6 chiffres"/></div>' +
        '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Plus tard</button><button class="se-btn" type="submit">Signer le mandat</button></div>' +
      '</form>';
  }

  async function ouvrirMandat() {
    modal = mandatModal(null);
    render();
    try {
      const info = await API.get('/api/mandat');
      if (info.mandat && info.mandat.statut === 'signe') state.mandatActif = info.mandat;
      modal = mandatModal(info);
    } catch (e) {
      modal = '<h3>Mandat indisponible</h3><p class="se-muted">' + esc(e.message || 'Réessayez dans un instant.') + '</p><div class="se-modal-foot"><button class="se-btn" type="button" data-act="modal-close">Fermer</button></div>';
    }
    render();
  }

  function offreModal(id) {
    const b = bien(id);
    const prix = b ? b.prix : 0;
    return '<h3>Faire une offre</h3><p class="se-muted">' + esc(b ? b.titre : '') + ' · prix affiché ' + euro(prix) + '</p>' +
      '<form data-form="offre" data-bien="' + id + '">' +
        '<div class="se-field"><label>Votre offre</label><input class="se-input" name="montant" type="number" value="' + Math.round(prix * 0.97) + '"/></div>' +
        '<div class="se-chips" style="margin-top:10px">' +
          [-5, -3, -1, 0].map((d) => '<button type="button" class="se-chip" data-act="offre-preset" data-id="' + d + '">' + (d === 0 ? 'Prix demandé' : d + ' %') + '</button>').join('') +
        '</div>' +
        '<div class="se-field" style="margin-top:14px"><label>Message</label><textarea class="se-textarea" name="message" style="min-height:80px" placeholder="Financement validé, disponible rapidement…"></textarea></div>' +
        '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Envoyer mon offre</button></div>' +
      '</form>';
  }

  // Les demandes des membres arrivent dans la boîte du CRM agence.
  function pousserDemande(demande) {
    try {
      const list = JSON.parse(localStorage.getItem('seecret.demandes.v1') || '[]');
      list.unshift(demande);
      localStorage.setItem('seecret.demandes.v1', JSON.stringify(list.slice(0, 60)));
    } catch (e) { /* stockage indisponible */ }
  }

  function downloadJSON() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'seecret-espace-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Export prêt.');
  }

  /* ================================ events ================================ */

  document.addEventListener('click', (e) => {
    // Un bouton « submit » dans une modale ne doit jamais être intercepté :
    // le fond de la modale porte data-act="modal-close", et le
    // preventDefault() ci-dessous annulait l'envoi de TOUS les formulaires
    // affichés en modale (demande de visite, offre, mandat…).
    if (e.target.closest('button[type="submit"], input[type="submit"]')) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const zoneProtegee = e.target.closest('[data-stop]');
    if (zoneProtegee && !zoneProtegee.contains(el)) return;
    const act = el.getAttribute('data-act');
    if (act === 'offre-preset') {
      const form = el.closest('form');
      const b = bien(form.getAttribute('data-bien'));
      const d = Number(el.getAttribute('data-id'));
      form.querySelector('[name="montant"]').value = Math.round(b.prix * (1 + d / 100));
      return;
    }
    const fn = actions[act];
    if (!fn) return;
    e.preventDefault();
    fn(el, el.getAttribute('data-id'), e);
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.getAttribute('data-form');
    const data = new FormData(form);

    if (kind === 'auth-email') {
      const email = String(data.get('email') || '').trim().toLowerCase();
      if (!email) return;
      try {
        await API.send('POST', '/api/auth/enroll', { email: email, turnstileToken: window.SeecretTurnstile ? await window.SeecretTurnstile.jeton() : '' });
        state.__pendingEmail = email;
        state.__lienEnvoye = true;
        render();
      } catch (err) {
        toast(err.message || 'Envoi impossible.', 'warn');
      }
      return;
    }

    if (kind === 'auth-code') {
      const email = String(data.get('email') || '').trim().toLowerCase();
      const code = String(data.get('code') || '').replace(/\D/g, '').slice(0, 6);
      if (!email || code.length !== 6) { toast('Email et code à 6 chiffres requis.', 'warn'); return; }
      try {
        await API.send('POST', '/api/auth/verify-code', { email: email, code: code });
        location.href = '/espace.html';
      } catch (err) {
        state.__authErreur = err.message || 'Code invalide.';
        render();
      }
      return;
    }

    if (kind === 'mon-bien') {
      try {
        await API.send('POST', '/api/mon-bien/modification', {
          type: 'Modification',
          message: 'Demande de modification de mon bien',
          titre: String(data.get('titre') || ''),
          prix: Number(data.get('prix')) || 0,
          description: String(data.get('description') || '')
        });
        toast('Votre demande de modification a été envoyée à l’agence pour validation.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible.', 'warn'); }
      return;
    }

    if (kind === 'mon-recherche') {
      try {
        const checked = (name) => Array.prototype.slice.call(form.querySelectorAll('input[name="' + name + '"]:checked')).map((c) => c.value);
        const type = String(data.get('type') || '');
        const payload = {
          prixMax: Number(data.get('prixMax')) || 0,
          piecesMin: Number(data.get('piecesMin')) || 0,
          surfaceMin: Number(data.get('surfaceMin')) || 0,
          surfaceMax: Number(data.get('surfaceMax')) || 0,
          quartiers: checked('quartier'),
          type: type,
          types: type ? [type] : [],
          etageMin: Number(data.get('etageMin')) || 0,
          etageMax: Number(data.get('etageMax')) || 0,
          etat: String(data.get('etat') || ''),
          dpe: String(data.get('dpe') || ''),
          annexes: checked('annexe'),
          bienAVendre: !!form.querySelector('input[name="bienAVendre"]:checked'),
          prixVenteEstime: Number(data.get('prixVenteEstime')) || 0
        };
        const r = await API.send('PATCH', '/api/mon-recherche', payload);
        state.recherche = Object.assign({}, state.recherche, r.recherche);
        render();
        toast('Votre recherche a bien été mise à jour.', 'ok');
      } catch (err) { toast(err.message || 'Mise à jour impossible.', 'warn'); }
      return;
    }

    if (kind === 'bien') {
      const photos = (draftPhotos || []).slice();
      const obj = {
        id: (state.monBien && state.monBien.id) || uid('m'),
        type: data.get('type'),
        quartier: data.get('quartier'),
        label: nomQuartier(String(data.get('quartier'))),
        titre: String(data.get('titre') || 'Mon bien').trim() || 'Mon bien',
        surface: Number(data.get('surface')) || 0,
        pieces: Number(data.get('pieces')) || 0,
        chambres: Number(data.get('chambres')) || 0,
        sdb: Number(data.get('sdb')) || 0,
        etage: String(data.get('etage') || ''),
        dpe: data.get('dpe'),
        prix: Number(data.get('prix')) || 0,
        description: String(data.get('description') || ''),
        atouts: $$('.se-chip[aria-pressed="true"]', form).map((c) => c.getAttribute('data-id')),
        photos: photos,
        statut: data.get('statut'),
        adresseMasquee: data.get('adresseMasquee') === 'on',
        suiveurs: (state.monBien && state.monBien.suiveurs) || 0,
        cree: (state.monBien && state.monBien.cree) || nowISO(),
        mien: true
      };
      if (!obj.surface || !obj.prix) { toast('Surface et prix sont nécessaires.', 'warn'); return; }
      const first = !state.monBien;
      state.monBien = obj;
      if (first && obj.statut !== 'brouillon') seedInterest(obj);
      monBienEdit = false;
      draftPhotos = null;
      commit();
      toast(first ? 'Bien déposé. Bienvenue au club.' : 'Fiche mise à jour.', 'ok');
      location.hash = '#/mon-bien';
      return;
    }

    if (kind === 'visite') {
      const bienId = form.getAttribute('data-bien');
      const creneaux = ['creneau1', 'creneau2', 'creneau3'].map((k) => String(data.get(k) || '')).filter(Boolean);
      const creneau = creneaux.map((c) => c.replace('T', ' à ')).join(' · ');
      const note = String(data.get('note') || '');
      // La demande part vraiment vers le serveur (et donc vers l'agent dans
      // le CRM) depuis cette correction — avant, elle n'était écrite que
      // dans le localStorage du navigateur du membre et n'arrivait jamais
      // à l'agence. Le serveur refuse aussi la demande si le bien est
      // encore en avant-première (pas encore ouvert aux visites).
      try {
        if (!creneaux.length) { toast('Proposez au moins un créneau.', 'warn'); return; }
        const rep = await API.send('POST', '/api/visites', { bienId: bienId, creneaux: creneaux, note: note });
        state.visites.unshift({
          id: uid('v'), bienId: bienId, sens: 'envoyee', creneau: creneau,
          note: note, statut: 'demandee', at: nowISO(), demandeur: (state.profil.prenom + ' ' + state.profil.nom).trim()
        });
        commit();
        if (rep.mandatRequis) { await ouvrirMandat(); return; }
        modal = null;
        render();
        toast('Demande envoyée. Votre agent confirme le créneau et vous envoie l’adresse.');
      } catch (e) {
        toast((e && e.message) || 'Demande impossible pour l’instant.', 'warn');
      }
      return;
    }

    if (kind === 'mandat-signer') {
      const bouton = form.querySelector('button[type="submit"]');
      if (bouton) bouton.disabled = true;
      try {
        const res = await API.send('POST', '/api/mandat/signer', {
          adresse: String(data.get('adresse') || ''),
          accepte: data.get('accepte') === 'on',
          demarrageAnticipe: data.get('demarrage') === 'on',
          code: String(data.get('code') || '')
        });
        state.mandatActif = res.mandat;
        modal = mandatModal({ signeOk: true, mandat: res.mandat, visitePossible: res.visitePossible });
        render();
      } catch (err) {
        if (bouton) bouton.disabled = false;
        toast(err.message || 'Signature impossible.', 'warn');
      }
      return;
    }

    if (kind === 'offre') {
      const bienId = form.getAttribute('data-bien');
      const montant = Number(data.get('montant'));
      if (!montant) { toast('Indiquez un montant.', 'warn'); return; }
      try {
        await API.send('POST', '/api/offres', {
          bienId: bienId,
          montant: montant,
          message: String(data.get('message') || '')
        });
        modal = null;
        toast('Votre offre a été transmise à l’agence (statut : en attente).', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible.', 'warn'); }
      return;
    }

    if (kind === 'message') {
      const texte = String(data.get('texte') || '').trim();
      if (!texte) return;
      state.messages.push({ de: 'moi', texte: texte, at: nowISO() });
      form.reset();
      save();
      render();
      setTimeout(() => {
        state.messages.push({ de: 'agent', texte: 'Bien noté. Je regarde et je reviens vers vous rapidement.', at: nowISO() });
        save();
        render();
      }, 1400);
      return;
    }

    if (kind === 'modification') {
      const type = String(data.get('type') || '');
      const message = String(data.get('message') || '');
      const prix = Number(data.get('prix')) || 0;
      if (!message && !prix) { toast('Décrivez la modification souhaitée.', 'warn'); return; }
      try {
        await API.send('POST', '/api/mon-bien/modification', { type: type, message: message, prix: prix });
        modal = null;
        toast('Demande envoyée à votre agent.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible.', 'warn'); }
      return;
    }

    if (kind === 'profil') {
      state.profil.prenom = String(data.get('prenom') || '');
      state.profil.nom = String(data.get('nom') || '');
      state.profil.email = String(data.get('email') || '');
      state.profil.tel = String(data.get('tel') || '');
      state.profil.ville = String(data.get('ville') || '');
      commit();
      toast('Profil enregistré.', 'ok');
      return;
    }

    if (kind === 'simu') {
      const prix = Number(data.get('prix')) || 0;
      const apport = Number(data.get('apport')) || 0;
      const taux = Number(data.get('taux')) || 0;
      const annees = Number(data.get('duree')) || 0;
      const notaire = Math.round(prix * 0.075);
      const emprunt = Math.max(prix + notaire - apport, 0);
      const r = taux / 100 / 12;
      const n = annees * 12;
      const mensualite = r > 0 ? (emprunt * r) / (1 - Math.pow(1 + r, -n)) : emprunt / n;
      const total = mensualite * n;
      $('#simu-out').innerHTML = '<div class="se-grid cols-2">' +
        stat('Mensualité', euro(Math.round(mensualite))) +
        stat('Frais de notaire', euro(notaire)) +
        stat('Montant emprunté', euro(Math.round(emprunt))) +
        stat('Coût total du crédit', euro(Math.round(total - emprunt))) +
        '</div>';
      return;
    }

    if (kind === 'estim') {
      const q = QUARTIERS.find((x) => x.id === data.get('quartier'));
      const surface = Number(data.get('surface')) || 0;
      const pm2 = PRIX_M2[q.arrondissement] || 10000;
      const centre = Math.round((surface * pm2) / 1000) * 1000;
      $('#estim-out').innerHTML = '<div class="se-grid cols-2">' +
        stat('Prix conseillé', euro(centre)) +
        stat('Fourchette', euro(Math.round(centre * 0.92 / 1000) * 1000) + ' – ' + euro(Math.round(centre * 1.08 / 1000) * 1000)) +
        '</div><p class="se-hint" style="margin-top:10px">Ordre de grandeur : le prix réel dépend de l’étage, de la vue et de l’état.</p>';
      return;
    }

    if (kind === 'compare') {
      const ids = Array.prototype.slice.call(form.querySelector('[name="ids"]').selectedOptions).map((o) => o.value);
      state.compare = ids.slice(0, 4);
      commit();
      return;
    }
  });

  document.addEventListener('input', (e) => {
    const live = e.target.getAttribute('data-live');
    if (live === 'prix') {
      const form = e.target.closest('form');
      const q = form.querySelector('[name="quartier"]').value;
      const surface = Number(form.querySelector('[name="surface"]').value) || 0;
      const prix = Number(form.querySelector('[name="prix"]').value) || 0;
      const out = $('#prix-conseil');
      if (!out) return;
      const info = QUARTIERS.find((x) => x.id === q);
      const pm2 = PRIX_M2[info.arrondissement] || 10000;
      const conseil = Math.round((surface * pm2) / 1000) * 1000;
      out.textContent = conseil
        ? 'Conseil : environ ' + euro(conseil) + ' (' + euro(pm2) + '/m² dans ' + info.label + ')' + (prix ? ' · vous êtes à ' + pct(prix, conseil) + ' % de cette référence' : '')
        : 'Renseignez la surface et le quartier.';
    }

    const filter = e.target.getAttribute('data-filter');
    if (filter) {
      state.__filtres = state.__filtres || {};
      state.__filtres[filter] = e.target.value;
      clearTimeout(window.__filtreT);
      window.__filtreT = setTimeout(() => { save(); render(); const el = $('[data-filter="' + filter + '"]'); if (el && filter === 'q') { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 220);
    }
  });

  document.addEventListener('change', async (e) => {
    const docType = e.target.getAttribute('data-doc');
    if (docType) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('type', docType);
      fd.append('fichier', file);
      try {
        await API.upload('/api/documents', fd);
        const d = await API.get('/api/documents');
        state.docs = d.documents || [];
        render();
        toast('Document reçu. L’agence va le vérifier.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible.', 'warn'); }
      return;
    }

    if (e.target.hasAttribute('data-photos')) {
      const files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      const fd = new FormData();
      files.slice(0, 8).forEach((f) => fd.append('photos', f));
      try {
        const r = await API.upload('/api/mon-bien/photos', fd);
        state.monBien.photos = r.photos;
        render();
        toast('Photos ajoutées.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible.', 'warn'); }
      return;
    }

    if (e.target.getAttribute('name') === 'exterieur') {
      const box = document.getElementById('champ-surf-ext');
      if (box) box.style.display = e.target.value && e.target.value !== 'Aucun' ? '' : 'none';
    }

    const notif = e.target.getAttribute('data-notif');
    if (notif) {
      state.profil.notifs[notif] = e.target.checked;
      save();
      toast('Notification ' + (e.target.checked ? 'activée' : 'désactivée') + '.');
      return;
    }

    if (e.target.getAttribute('data-upload') === 'photos') {
      const files = Array.prototype.slice.call(e.target.files || []).slice(0, 8);
      if (draftPhotos === null) draftPhotos = [];
      const list = draftPhotos;
      let pending = files.length;
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const max = 1100;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            list.push(canvas.toDataURL('image/jpeg', 0.72));
            pending--;
            if (pending <= 0) render();
          };
          img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
      return;
    }

    if (e.target.getAttribute('data-upload') === 'import') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          state = Object.assign(seedState(), parsed);
          save();
          render();
          toast('Données importées.', 'ok');
        } catch (err) { toast('Fichier illisible.', 'warn'); }
      };
      reader.readAsText(file);
      return;
    }

    if (e.target.matches('[data-filter]')) {
      state.__filtres = state.__filtres || {};
      state.__filtres[e.target.getAttribute('data-filter')] = e.target.value;
      save();
      render();
    }
  });

  window.addEventListener('hashchange', () => { modal = null; render(); });

  /* ---------------------------- données de départ -------------------------- */

  function seedInterest(b) {
    // Quand le bien est publié, le club réagit : 2 offres reçues + 1 demande de visite.
    const acheteurs = ['Membre vérifié · Paris 6ᵉ', 'Membre vérifié · Neuilly', 'Membre vérifié · Lyon'];
    b.suiveurs = Math.max(b.suiveurs || 0, 3);
    for (let i = 0; i < 2; i++) {
      state.offres.push({
        id: uid('o'), bienId: b.id, sens: 'recue', montant: Math.round(b.prix * (0.96 - i * 0.02)),
        message: i === 0 ? 'Financement validé, disponible rapidement.' : 'Offre ferme, sous réserve de la visite.',
        statut: 'recue', at: nowISO(), auteur: acheteurs[i]
      });
    }
    state.visites.push({
      id: uid('v'), bienId: b.id, sens: 'recue', creneau: 'Samedi 8 novembre, 10 h',
      note: '', statut: 'demandee', at: nowISO(), demandeur: acheteurs[2]
    });
  }

  /* -------------------------------- démarrage ------------------------------ */

  demarrer();
})();

setInterval(() => {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;
  const slides = Array.prototype.slice.call(hero.querySelectorAll('.ed-hero-slide'));
  const dots = Array.prototype.slice.call(hero.querySelectorAll('[data-hero-dot]'));
  if (!slides.length) return;
  const cur = slides.findIndex((x) => x.classList.contains('on'));
  const next = (cur + 1) % slides.length;
  slides.forEach((x) => x.classList.remove('on'));
  dots.forEach((x) => x.classList.remove('on'));
  slides[next].classList.add('on');
  if (dots[next]) dots[next].classList.add('on');
}, 4500);
