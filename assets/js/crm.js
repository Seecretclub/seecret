/* ------------------------------------------------------------------
   Seecret — CRM agence
   Fiches clients · fiches biens · recherches · demandes · visites ·
   offres · tâches · messagerie. 100 % statique (localStorage).
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ============================== utilitaires ============================== */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const num = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
  const uid = (p) => (p || 'id') + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();
  // '—' plutôt que la chaîne "Invalid Date" quand iso est vide/absent (ex. un
  // mandat sans échéance renseignée) — ça arrivait notamment sur chaque bien
  // synchronisé depuis le serveur, dont mapBienServeur() pose mandat.fin à ''
  // par défaut, faute de ce champ côté serveur.
  const dFR = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const dCourt = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const tFR = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const ilYa = (iso) => {
    const j = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (j <= 0) return 'aujourd’hui';
    if (j === 1) return 'hier';
    return 'il y a ' + j + ' j';
  };
  const dansX = (iso) => {
    const j = Math.round((new Date(iso) - Date.now()) / 86400000);
    if (j < 0) return 'en retard de ' + Math.abs(j) + ' j';
    if (j === 0) return 'aujourd’hui';
    if (j === 1) return 'demain';
    return 'dans ' + j + ' j';
  };

  const ICONS = {
    home: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"/></svg>',
    inbox: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h3l1.5 2.5h5L14 11h3"/><path d="M3 11 5.5 4h9L17 11v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
    users: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="7" r="3"/><path d="M2.5 17a5.5 5.5 0 0 1 11 0M13.5 4.2a3 3 0 0 1 0 5.6M15 12.4a5 5 0 0 1 2.5 4.6"/></svg>',
    user: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.5" r="3.2"/><path d="M3.5 17a6.5 6.5 0 0 1 13 0"/></svg>',
    building: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V4h8v13M12 8h4v9M2 17h16"/><path d="M7 7h2M7 10h2M7 13h2"/></svg>',
    grid: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>',
    search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3 3"/></svg>',
    robot: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="10" height="8" rx="2"/><path d="M10 8V5M10 5a1.5 1.5 0 1 0-1.5-1.5M13 5v3M7 5v3M7.5 12h.01M12.5 12h.01"/></svg>',
    calendar: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/></svg>',
    tag: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3H17v6.5L9.8 16.7a1.6 1.6 0 0 1-2.3 0L3.3 12.5a1.6 1.6 0 0 1 0-2.3z"/><circle cx="13.6" cy="6.4" r="1.1"/></svg>',
    check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 8 14.5 16 5"/></svg>',
    chat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 9.5a6.5 6.5 0 0 1-9.4 5.8L3 16.5l1.2-4.4A6.5 6.5 0 1 1 17 9.5z"/></svg>',
    plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>',
    arrow: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11M11 6l4 4-4 4"/></svg>',
    phone: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h3l1.5 4-2 1.5a10 10 0 0 0 4 4L13 10.5 17 12v3a1 1 0 0 1-1 1A13 13 0 0 1 3 4a1 1 0 0 1 1-1z"/></svg>',
    mail: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m3 6 7 5 7-5"/></svg>',
    tools: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12.5 7.5 5 5-3 3-5-5M7.5 12.5l-5-5 3-3 5 5"/><path d="m3 17 2.5-2.5M14.5 5.5 17 3"/></svg>',
    out: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M13 6l4 4-4 4M17 10H7"/></svg>',
    mic: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7 17.5h6"/></svg>',
    x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>',
    volume: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3.5v-10.5L6 8z"/><path d="M14 7a4 4 0 0 1 0 6"/></svg>',
    volumeOff: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3.5v-10.5L6 8z"/><path d="m13 7.5 4 4m0-4-4 4"/></svg>'
  };

  /* ================================= données ============================== */

  const KEY = 'seecret.crm.v1';
  const SHARED = 'seecret.demandes.v1';
  const BIENS_MEMBRES = 'seecret.biens.v1';

  const QUARTIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    .map((n) => ({ id: 'p' + n, label: 'Paris ' + n + (n === 1 ? 'ᵉʳ' : 'ᵉ'), cp: '750' + String(n).padStart(2, '0') }))
    .concat([
      { id: 'boulogne', label: 'Boulogne-Billancourt', cp: '92100' },
      { id: 'neuilly', label: 'Neuilly-sur-Seine', cp: '92200' },
      { id: 'vincennes', label: 'Vincennes', cp: '94300' }
    ]);
  const qLabel = (id) => (QUARTIERS.find((q) => q.id === id) || { label: id }).label;
  const qSecteur = (id) => QUARTIERS.find((q) => q.id === id) || null;

  // Ordre des classes DPE, de la meilleure à la pire — utilisé pour comparer
  // « au moins aussi bonne que » la classe souhaitée par un acquéreur, pas
  // seulement une égalité stricte (un acquéreur qui veut du D accepte aussi
  // du C, B ou A).
  const DPE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const adresseKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const TYPES = ['Appartement', 'Maison', 'Duplex', 'Triplex', 'Loft', 'Hôtel particulier', 'Villa', 'Maison de ville', 'Maison de village', 'Propriété', 'Château', 'Immeuble', 'Péniche', 'Terrain', 'Terrain constructible', 'Parking', 'Box', 'Bureau', 'Local commercial', 'Commerce'];
  const ATOUTS = ['Terrasse', 'Jardin', 'Vue', 'Parquet d’origine', 'Cheminée', 'Verrière', 'Ascenseur', 'Cave', 'Parking', 'Dernier étage', 'Calme', 'Lumineux'];

  // Le parcours d'un bien, dans l'ordre (aligné sur l'onboarding vendeur).
  const ST_BIEN = {
    brouillon: { label: 'En préparation', cls: 'muted', aide: 'Fiche en cours (vendeur ou agence) : pas visible des membres.' },
    a_valider: { label: 'À valider', cls: 'warn', aide: 'Le vendeur a demandé la mise en ligne : vérifiez la fiche puis passez-la en Avant-première.' },
    'avant-premiere': { label: 'Avant-première', cls: '', aide: 'Visible des membres, qui peuvent le suivre ; les visites ne sont pas encore ouvertes.' },
    ouvert: { label: 'En vente', cls: 'open', aide: 'Visible des membres, visites ouvertes (mandat de recherche signé par l’acquéreur avant chaque visite).' },
    'sous-offre': { label: 'Sous offre', cls: 'offer', aide: 'Une offre est acceptée ou en négociation.' },
    'sous-compromis': { label: 'Sous compromis', cls: 'offer', aide: 'Compromis signé, en attente de l’acte.' },
    vendu: { label: 'Vendu', cls: 'muted', aide: 'Vente conclue.' },
    // Anciens statuts encore présents sur certains biens : affichés proprement.
    mandat: { label: 'En préparation', cls: 'muted', ancien: true },
    en_attente_offmarket: { label: 'Bloqué : annonce publique trouvée', cls: 'warn', ancien: true }
  };
  const ST_BIEN_CHOIX = () => Object.keys(ST_BIEN).filter((k) => !ST_BIEN[k].ancien);

  const ST_CLIENT = {
    prospect: { label: 'Prospect', cls: 'warn' },
    actif: { label: 'Actif', cls: '' },
    client: { label: 'Client', cls: 'open' },
    suspendu: { label: 'Suspendu', cls: 'warn' },
    archive: { label: 'Archivé', cls: 'muted' }
  };

  const DEMANDE = {
    visite: { label: 'Demande de visite', icon: 'calendar' },
    offre: { label: 'Offre', icon: 'tag' },
    candidature: { label: 'Candidature', icon: 'user' },
    statut: { label: 'Changement de statut', icon: 'building' },
    modification: { label: 'Modification de bien', icon: 'building' },
    info: { label: 'Message', icon: 'chat' }
  };

  // Journal d'activité unifié (fusion CRM, étape 2) — une seule source de vérité
  // pour tout ce qui arrive à un lead/bien, alimentée par le serveur (/api/activites)
  // et affichée dans la fiche contact, à la place des blocs ad hoc visites/demandes/offres.
  const ACTIVITE = {
    dossier_transmis: { label: 'Candidature reçue', icon: 'inbox' },
    admissible: { label: 'Bien jugé recevable (pas de doublon d’exclusivité)', icon: 'check' },
    admission: { label: 'Admission validée par l’agence', icon: 'user' },
    mise_au_catalogue: { label: 'Bien mis au catalogue (avant-première)', icon: 'building' },
    ouverture_visites: { label: 'Bien ouvert aux visites', icon: 'home' },
    offre_faite: { label: 'Offre faite', icon: 'tag' },
    offre_acceptee: { label: 'Offre acceptée', icon: 'check' },
    vente_conclue: { label: 'Vente conclue', icon: 'check' },
    retour_silence: { label: 'Contacté, puis silence — à relancer', icon: 'chat' },
    visite_demandee: { label: 'Visite demandée par un acquéreur', icon: 'calendar' },
    converti: { label: 'Converti en membre', icon: 'check' },
    lead_cree_assistant: { label: 'Lead créé par Célia', icon: 'chat' },
    lead_maj_assistant: { label: 'Lead mis à jour par Célia', icon: 'chat' },
    rappel_programme: { label: 'Rappel programmé par Célia', icon: 'calendar' },
    candidature_envoyee: { label: 'Invitation à candidater envoyée', icon: 'inbox' },
    document_envoye: { label: 'Pièce envoyée par le client', icon: 'inbox' },
    document_valide: { label: 'Pièce validée par l’agence', icon: 'check' },
    document_refuse: { label: 'Pièce refusée par l’agence', icon: 'chat' },
    bien_valide: { label: 'Bien validé par l’agence', icon: 'building' },
    bien_cree: { label: 'Bien créé', icon: 'building' },
    recherche_creee: { label: 'Recherche créée', icon: 'search' },
    modification: { label: 'Fiche modifiée', icon: 'edit' },
    archive: { label: 'Fiche archivée', icon: 'archive' },
    restauration: { label: 'Fiche restaurée', icon: 'check' }
  };

  function seed() {
    const biens = [
      { id: 'b1', adresse: 'Île Saint-Louis, Paris 4e', ref: 'SC-1042', titre: 'Quatre pièces sur la Seine', type: 'Appartement', quartier: 'p4', surface: 112, pieces: 4, chambres: 2, sdb: 2, etage: 3, dpe: 'D', prix: 2079000, statut: 'avant-premiere', proprietaireId: 'c2', photos: ['ilesaintlouis-1.jpg', 'ilesaintlouis-3.jpg'], description: 'La Seine par trois fenêtres, un parquet de Versailles d’origine, et la lumière des quatre expositions.', atouts: ['Vue', 'Parquet d’origine', 'Calme'], mandat: { type: 'exclusif', fin: '2027-03-31' }, cree: '2026-10-02T10:00:00.000Z' },
      { id: 'b2', adresse: 'Rue des Abbesses, Paris 18e', ref: 'SC-1043', titre: 'La maison au figuier', type: 'Maison', quartier: 'p18', surface: 96, pieces: 4, chambres: 2, sdb: 2, etage: 0, dpe: 'E', prix: 1270500, statut: 'avant-premiere', proprietaireId: null, photos: ['montmartre-1.jpg', 'montmartre-3.jpg'], description: 'Une verrière d’atelier qui prend la lumière du nord toute la journée, et un figuier dans la cour.', atouts: ['Jardin', 'Verrière', 'Calme'], mandat: { type: 'simple', fin: '2027-01-31' }, cree: '2026-10-06T10:00:00.000Z' },
      { id: 'b3', adresse: 'Rue de Verneuil, Paris 6e', ref: 'SC-1044', titre: 'Les deux derniers étages', type: 'Duplex', quartier: 'p6', surface: 128, pieces: 4, chambres: 3, sdb: 2, etage: 5, dpe: 'C', prix: 2604000, statut: 'ouvert', proprietaireId: 'c4', photos: ['saintgermain-1.jpg', 'saintgermain-3.jpg'], description: 'Deux niveaux qui se répondent, une terrasse plein sud, et l’adresse la plus sûre de la rive gauche.', atouts: ['Terrasse', 'Dernier étage', 'Lumineux'], mandat: { type: 'exclusif', fin: '2027-06-30' }, cree: '2026-09-18T10:00:00.000Z' },
      { id: 'b4', adresse: 'Avenue du Président Kennedy, Paris 16e', ref: 'SC-1045', titre: 'Six pièces face aux toits', type: 'Appartement', quartier: 'p16', surface: 185, pieces: 6, chambres: 4, sdb: 3, etage: 6, dpe: 'D', prix: 3412500, statut: 'avant-premiere', proprietaireId: null, photos: ['trocadero-1.jpg', 'home-5.jpg'], description: 'La rotonde du dernier étage, une vue que rien ne viendra fermer, et l’ascenseur d’époque.', atouts: ['Vue', 'Ascenseur', 'Dernier étage'], mandat: { type: 'simple', fin: '2027-04-30' }, cree: '2026-10-10T10:00:00.000Z' },
      { id: 'b5', adresse: 'Rue des Archives, Paris 3e', ref: 'SC-1046', titre: 'L’atelier et sa verrière', type: 'Loft', quartier: 'p3', surface: 142, pieces: 3, chambres: 2, sdb: 2, etage: 4, dpe: 'C', prix: 1774500, statut: 'brouillon', proprietaireId: 'c6', photos: ['marais-1.jpg', 'home-loft-bright.jpg'], description: 'Des moulures d’origine, le calme d’un dernier étage, et Paris qui se déplie par les fenêtres.', atouts: ['Verrière', 'Dernier étage', 'Calme'], mandat: { type: 'exclusif', fin: '2027-02-28' }, cree: '2026-10-12T10:00:00.000Z' },
      { id: 'b6', adresse: 'Rue de Grenelle, Paris 7e', ref: 'SC-1047', titre: 'Un rez-de-jardin rue de Grenelle', type: 'Appartement', quartier: 'p7', surface: 138, pieces: 5, chambres: 3, sdb: 2, etage: 0, dpe: 'D', prix: 2350000, statut: 'ouvert', proprietaireId: null, photos: ['home-jardin.jpg', 'home-1.jpg'], description: 'Un jardin de 90 m² à l’abri des regards, deux expositions, et le silence d’une cour pavée.', atouts: ['Jardin', 'Calme', 'Cheminée'], mandat: { type: 'simple', fin: '2027-05-31' }, cree: '2026-09-28T10:00:00.000Z' },
      { id: 'b7', adresse: 'Quai de Montebello, Paris 5e', ref: 'SC-1048', titre: 'Sous les toits de Notre-Dame', type: 'Appartement', quartier: 'p9', surface: 88, pieces: 3, chambres: 2, sdb: 1, etage: 5, dpe: 'E', prix: 1415000, statut: 'avant-premiere', proprietaireId: null, photos: ['home-5.jpg', 'home-3.jpg'], description: 'Une charpente apparente, une verrière plein ciel et le marché Saint-Georges à trois minutes.', atouts: ['Dernier étage', 'Lumineux'], mandat: { type: 'simple', fin: '2027-01-15' }, cree: '2026-10-14T10:00:00.000Z' },
      { id: 'b8', adresse: 'Boulogne-Billancourt', ref: 'SC-1049', titre: 'La maison des deux cèdres', type: 'Maison', quartier: 'boulogne', surface: 210, pieces: 7, chambres: 4, sdb: 3, etage: 2, dpe: 'C', prix: 2890000, statut: 'sous-offre', proprietaireId: null, photos: ['home-6.jpg', 'home-3.jpg'], description: 'Un jardin planté de deux cèdres centenaires, une véranda d’hiver et un garage double.', atouts: ['Jardin', 'Parking', 'Calme'], mandat: { type: 'exclusif', fin: '2027-07-31' }, cree: '2026-09-05T10:00:00.000Z' }
    ];

    const clients = [
      { id: 'c1', type: 'acquereur', prenom: 'Camille', nom: 'Renaud', email: 'camille.renaud@example.com', tel: '06 12 34 56 78', statut: 'actif', source: 'Candidature', budgetMin: 1200000, budgetMax: 2200000, quartiers: ['p4', 'p5', 'p6', 'p7'], piecesMin: 3, surfaceMin: 90, typeBien: 'Appartement', notes: 'Cherche la lumière et un dernier étage. Prête à se positionner vite.', tags: ['VIP', 'Financement validé'], agent: 'Gabriel Taieb', cree: '2026-10-18T09:00:00.000Z' },
      { id: 'c2', type: 'vendeur', prenom: 'Antoine', nom: 'Mercier', email: 'a.mercier@example.com', tel: '06 22 11 44 90', statut: 'client', source: 'Recommandation', budgetMin: 0, budgetMax: 0, quartiers: [], piecesMin: 0, surfaceMin: 0, typeBien: '', notes: 'Vend pour acheter ailleurs. Très attaché à la discrétion.', tags: ['Exclusif'], agent: 'Gabriel Taieb', cree: '2026-09-12T09:00:00.000Z' },
      { id: 'c3', type: 'acquereur', prenom: 'Sofia', nom: 'Belkacem', email: 'sofia.b@example.com', tel: '07 88 21 33 05', statut: 'actif', source: 'Site web', budgetMin: 2500000, budgetMax: 3500000, quartiers: ['p7', 'p8', 'p16'], piecesMin: 5, surfaceMin: 150, typeBien: 'Appartement', notes: 'Famille de 4, écoles du 7e. Visite uniquement le samedi.', tags: ['Sérieux'], agent: 'Karim B.', cree: '2026-10-04T09:00:00.000Z' },
      { id: 'c4', type: 'vendeur', prenom: 'Hugo', nom: 'Lefèvre', email: 'hugo.lefevre@example.com', tel: '06 45 09 77 12', statut: 'client', source: 'Candidature', budgetMin: 0, budgetMax: 0, quartiers: [], piecesMin: 0, surfaceMin: 0, typeBien: '', notes: 'Duplex du 6e. Veut vendre avant l’été.', tags: ['Exclusif'], agent: 'Gabriel Taieb', cree: '2026-09-18T09:00:00.000Z' },
      { id: 'c5', type: 'acquereur', prenom: 'Inès', nom: 'Fontaine', email: 'ines.fontaine@example.com', tel: '06 30 55 21 84', statut: 'prospect', source: 'Instagram', budgetMin: 1000000, budgetMax: 1500000, quartiers: ['p9', 'p10', 'p11', 'p18'], piecesMin: 3, surfaceMin: 70, typeBien: 'Appartement', notes: 'Primo-accédante, prêt obtenu.', tags: [], agent: 'Karim B.', cree: '2026-10-21T09:00:00.000Z' },
      { id: 'c6', type: 'mixte', prenom: 'Paul', nom: 'Girard', email: 'paul.girard@example.com', tel: '07 12 65 43 21', statut: 'actif', source: 'Bouche à oreille', budgetMin: 1700000, budgetMax: 2600000, quartiers: ['p3', 'p4', 'p11'], piecesMin: 4, surfaceMin: 100, typeBien: 'Loft', notes: 'Vend son loft du Marais, cherche plus grand dans le centre.', tags: ['VIP'], agent: 'Gabriel Taieb', cree: '2026-10-08T09:00:00.000Z' }
    ];

    const recherches = [
      { id: 'r1', clientId: 'c1', titre: 'Trois pièces et plus, rive gauche', type: 'Appartement', quartiers: ['p4', 'p5', 'p6', 'p7'], prixMax: 2200000, piecesMin: 3, surfaceMin: 90, statut: 'active', alertes: true, cree: '2026-10-18T09:10:00.000Z' },
      { id: 'r2', clientId: 'c3', titre: 'Grand appartement familial', type: 'Appartement', quartiers: ['p7', 'p8', 'p16'], prixMax: 3500000, piecesMin: 5, surfaceMin: 150, statut: 'active', alertes: true, cree: '2026-10-04T09:10:00.000Z' },
      { id: 'r3', clientId: 'c5', titre: 'Premier achat, rive droite', type: 'Appartement', quartiers: ['p9', 'p10', 'p11', 'p18'], prixMax: 1500000, piecesMin: 3, surfaceMin: 70, statut: 'active', alertes: false, cree: '2026-10-21T09:10:00.000Z' },
      { id: 'r4', clientId: 'c6', titre: 'Loft ou dernier étage, Marais', type: 'Loft', quartiers: ['p3', 'p4', 'p11'], prixMax: 2600000, piecesMin: 4, surfaceMin: 100, statut: 'active', alertes: true, cree: '2026-10-08T09:10:00.000Z' }
    ];

    const demandes = [];

    const visites = [
      { id: 'v1', bienId: 'b3', clientId: 'c1', date: '2026-11-06', heure: '18:00', statut: 'confirmee', note: '' },
      { id: 'v2', bienId: 'b6', clientId: 'c3', date: '2026-11-08', heure: '10:30', statut: 'demandee', note: 'Samedi uniquement.' },
      { id: 'v3', bienId: 'b5', clientId: 'c6', date: '2026-10-28', heure: '11:00', statut: 'realisee', note: '' }
    ];

    const offres = [
      { id: 'o1', bienId: 'b8', clientId: 'c2', montant: 2750000, statut: 'recue', cree: '2026-11-03T11:05:00.000Z' },
      { id: 'o2', bienId: 'b3', clientId: 'c3', montant: 2520000, statut: 'contre', cree: '2026-10-29T14:00:00.000Z' }
    ];

    const taches = [
      { id: 't1', titre: 'Rappeler Camille pour confirmer la visite de jeudi', clientId: 'c1', bienId: 'b3', echeance: '2026-11-04', fait: false },
      { id: 't2', titre: 'Préparer le mandat exclusif du loft Marais', clientId: 'c6', bienId: 'b5', echeance: '2026-11-05', fait: false },
      { id: 't3', titre: 'Relancer le notaire sur le dossier des deux cèdres', bienId: 'b8', echeance: '2026-11-02', fait: false },
      { id: 't4', titre: 'Envoyer les photos du 9e à Inès', clientId: 'c5', bienId: 'b7', echeance: '2026-10-31', fait: true }
    ];

    return {
      v: 1,
      agent: { prenom: 'Gabriel', nom: 'Taieb', email: 'gabriel.taieb@seecret.club', tel: '06 81 29 21 02', agence: 'Seecret — Paris centre' },
      // Identité réelle de la personne connectée (serveur, via /api/auth/me) —
      // distincte de `agent` ci-dessus qui n'est qu'un profil d'affichage local.
      // null jusqu'au premier appel réussi à syncIdentite().
      moi: null,
      clients, biens, recherches, demandes, visites, offres, taches,
      threads: {
        c1: [
          { de: 'client', texte: 'Bonjour, je confirme pour jeudi soir si possible.', at: '2026-11-03T18:22:00.000Z' },
          { de: 'agent', texte: 'C’est noté, je bloque 18 h avec le propriétaire.', at: '2026-11-03T18:30:00.000Z' }
        ],
        c3: [
          { de: 'client', texte: 'Uniquement le samedi pour les visites, merci.', at: '2026-10-29T09:10:00.000Z' }
        ]
      },
      filtres: {},
      membresBiens: []
    };
  }

  let state = load();
  state.demandes = (state.demandes || []).filter((d) => d.serverDemandeId);
  let modal = null;
  let modalLarge = false;
  let lastRoute = '';
  // Célia : état purement éphémère de la bulle (jamais persisté, comme `modal`) —
  // ouverte/fermée, et si une écoute vocale est en cours.
  let celiaOuvert = false;
  let celiaEcoute = false;
  let celiaRecorder = null; // MediaRecorder en cours, le temps de l'enregistrement
  let celiaTranscription = false; // true pendant l'appel serveur qui transcrit l'audio
  // Texte transcrit, posé dans le champ pour relecture/modification avant
  // envoi (jamais envoyé automatiquement) — vidé juste après avoir servi à
  // un render(), pour ne pas écraser ce que l'utilisateur tape ensuite.
  let celiaBrouillon = '';
  state.docsParLead = state.docsParLead || {};
  state.tachesVerif = state.tachesVerif || [];
  state.biensServeur = state.biensServeur || [];
  state.recherchesServeur = state.recherchesServeur || [];
  // Fiches archivées (jamais supprimées) : celles du serveur sont reconstruites à
  // chaque synchronisation, celles qui n'existent que sur cet appareil restent ici.
  state.archivesServeur = state.archivesServeur || { clients: [], biens: [], recherches: [] };
  state.archives = state.archives || { clients: [], biens: [], recherches: [] };
  // Historique des fiches qui n'existent que sur cet appareil (le serveur tient le reste).
  state.journal = state.journal || [];
  // Célia (assistant CRM conversationnel et vocal) : messages affichés à l'écran
  // (avec le résumé des actions exécutées) + l'historique brut envoyé à l'API
  // pour qu'elle se souvienne du fil de la conversation. Purement local (jamais
  // resynchronisé depuis le serveur), comme la cadence de relance. Migration
  // depuis les anciens noms de clés (panneau "Assistant" avant Célia).
  state.celiaMessages = state.celiaMessages || state.assistantMessages || [];
  state.celiaHistorique = state.celiaHistorique || state.assistantHistorique || [];
  // Action(s) proposée(s) par Célia en attente de validation/refus par l'agent
  // (tableau de { id, outil, input, resume }, jamais exécutées tant que
  // l'agent n'a pas tapé sur « Valider »). Purement local, comme le reste.
  state.celiaAttente = state.celiaAttente || null;
  delete state.assistantMessages;
  delete state.assistantHistorique;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) {
          const s = Object.assign(seed(), parsed);
          s.filtres = s.filtres || {};
          // La recherche texte ne survit pas à un rechargement : sinon un ancien
          // mot (« romain ») filtre en silence toutes les listes.
          delete s.filtres.q;
          s.threads = s.threads || {};
          s.membresBiens = s.membresBiens || [];
          mergeShared(s);
          mergeBiensMembres(s);
          return s;
        }
      }
    } catch (e) { /* ignore */ }
    const s = seed();
    mergeShared(s);
    mergeBiensMembres(s);
    return s;
  }

  function mergeShared(s) {
    try {
      const raw = localStorage.getItem(SHARED);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      list.forEach((d) => {
        if (!s.demandes.some((x) => x.id === d.id)) s.demandes.unshift(Object.assign({ statut: 'nouvelle' }, d));
      });
    } catch (e) { /* ignore */ }
  }

  function mergeBiensMembres(s) {
    try {
      const raw = localStorage.getItem(BIENS_MEMBRES);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      s.membresBiens = list.map((b) => Object.assign({}, b, { label: qLabel(b.quartier) }));
    } catch (e) { /* ignore */ }
  }
  function readBiensMembres() {
    try { return JSON.parse(localStorage.getItem(BIENS_MEMBRES) || '[]'); } catch (e) { return []; }
  }
  function writeBiensMembres(list) {
    try { localStorage.setItem(BIENS_MEMBRES, JSON.stringify((list || []).slice(0, 60))); } catch (e) { /* ignore */ }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  const commit = () => { save(); render(); };

  /* ============================== sélecteurs ============================== */

  const archivees = (k) => ((state.archivesServeur || {})[k] || []).concat((state.archives || {})[k] || []);
  const client = (id) => state.clients.find((c) => c.id === id) || archivees('clients').find((c) => c.id === id) || null;
  const bien = (id) => state.biens.find((b) => b.id === id) || (state.biensServeur || []).find((b) => b.id === id) || archivees('biens').find((b) => b.id === id) || null;
  // Une demande venue du serveur (modification, visite, offre…) porte le
  // bienId BRUT du serveur (ex. "bmwm..."), alors que ce même bien, une fois
  // synchronisé côté CRM, vit dans state.biensServeur sous l'id préfixé
  // "srv-b-<id>" (cf. mapBienServeur). bien(d.bienId) seul ne le trouvait
  // donc jamais pour un vrai bien de production.
  const bienParServeur = (serverId) => (serverId ? (bien('srv-b-' + serverId) || bien(serverId)) : null);
  const recherche = (id) => state.recherches.find((r) => r.id === id) || (state.recherchesServeur || []).find((r) => r.id === id) || archivees('recherches').find((r) => r.id === id) || null;
  const nomClient = (c) => (c ? (c.prenom + ' ' + c.nom).trim() : '—');
  const prixM2 = (b) => (b.surface ? Math.round(b.prix / b.surface) : 0);
  // ---- Prix net vendeur / HAI ----
  // b.prix = prix NET vendeur. Le prix honoraires inclus (HAI) dépend de
  // l'acquéreur : taux du bien (ou barème agence), taux réduit seulement pour
  // un client dont le bien a été VENDU par nous. Barème chargé depuis
  // /api/agence (même calcul que le serveur, source de vérité du catalogue).
  const BAREME = { acq: 5, mixte: 3, pas: 1 };
  const tauxTxt = (t) => String(t).replace('.', ',');
  const REDUIT = { reduit: true };
  function estMixte(c) {
    if (!c) return false;
    if (c.reduit) return true;
    const cl = c.clientId ? client(c.clientId) : c;
    if (!cl || !cl.id) return false;
    return ((state.biensServeur || []).concat(state.biens || [])).some((b) =>
      b.statut === 'vendu' && b.venduParAgence === true && (b.proprietaireId === cl.id || (cl.serverId && b.leadId === cl.serverId)));
  }
  function tauxPour(b, c) {
    const propre = (b && b.tauxHonoraires !== null && b.tauxHonoraires !== undefined && b.tauxHonoraires !== '') ? Number(b.tauxHonoraires) : null;
    const base = propre != null && !isNaN(propre) ? propre : BAREME.acq;
    return estMixte(c) ? Math.min(base, BAREME.mixte) : base;
  }
  // ---- Écoles de secteur (secteurs officiels de la Ville de Paris) ----
  function carteEcoles(b) {
    if (!b.serverId) return '';
    state.ecoles = state.ecoles || {};
    const e = state.ecoles[b.serverId];
    if (e === undefined) {
      state.ecoles[b.serverId] = null;
      fetch('/api/biens/' + encodeURIComponent(b.serverId) + '/ecoles', { credentials: 'same-origin' }).then((r) => r.json())
        .then((j) => { state.ecoles[b.serverId] = j; render(); })
        .catch(() => { state.ecoles[b.serverId] = { ok: false, error: 'Secteurs scolaires indisponibles.' }; render(); });
    }
    const ligne = (titre, x) => x ? kv(titre, esc(x.etablissements.join(' · ') || '—') + (x.adresses && x.adresses.length ? '<div class="se-hint">' + esc(x.adresses.join(' · ')) + '</div>' : '')) : kv(titre, '—');
    return '<div class="se-card"><h3>Écoles de secteur</h3>' +
      (!e ? '<p class="se-hint" style="margin-top:8px">Recherche des secteurs scolaires…</p>'
        : e.error ? '<p class="se-note" style="margin-top:8px">' + esc(e.error) + '</p>'
        : !e.disponible ? '<p class="se-hint" style="margin-top:8px">' + esc(e.raison || 'Sectorisation indisponible.') + '</p>'
        : '<div class="se-kv" style="margin-top:10px">' + ligne('Maternelle', e.maternelle) + ligne('Élémentaire', e.elementaire) + ligne('Collège', e.college) + '</div>' +
          '<p class="se-hint" style="margin-top:8px">Secteurs officiels ' + esc((e.elementaire && e.elementaire.annee) || '') + ' — ' + esc(e.source || '') + '. Lycées : affectation par Affelnet, sans secteur à l’adresse.</p>') +
    '</div>';
  }

  // ---- Visite virtuelle : parcours pièce par pièce (photos et/ou 360°) ----
  function brouillonVisite(b) {
    state.visiteEdition = state.visiteEdition || {};
    if (!state.visiteEdition[b.serverId]) {
      state.visiteEdition[b.serverId] = ((b.visite && b.visite.etapes) || []).map((e) => Object.assign({}, e));
    }
    return state.visiteEdition[b.serverId];
  }
  function srcImg(p) { return /^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p; }
  function carteVisite(b) {
    if (!b.serverId) return '';
    const etapes = brouillonVisite(b);
    const v = b.visite || {};
    const utilisees = new Set(etapes.map((e) => e.image));
    const libres = (b.photos || []).filter((p) => !utilisees.has(p));
    const id = esc(b.serverId);
    return '<div class="se-card se-visite-carte" data-visite="' + id + '">' +
      '<div class="se-row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><h3>Visite virtuelle</h3>' +
        (v.publie ? '<span class="se-badge open">En ligne sur la fiche</span>' : '<span class="se-badge muted">Non publiée</span>') + '</div>' +
      '<p class="se-hint" style="margin:6px 0 12px">Rangez les pièces dans l’ordre du parcours (entrée → séjour → cuisine…). Le membre « avance » d’une pièce à l’autre. Ajoutez des panoramas 360° pour qu’il puisse aussi tourner la tête dans une pièce.</p>' +
      (etapes.length ? '<ol class="se-visite-liste">' + etapes.map((e, i) =>
        '<li><img src="' + esc(srcImg(e.image)) + '" alt=""/>' +
          '<div class="se-visite-champs"><input class="se-input" data-visite-piece="' + i + '" maxlength="40" value="' + esc(e.piece || '') + '" placeholder="Nom de la pièce (ex. Séjour)"/>' +
          '<span class="se-badge ' + (e.mode === '360' ? 'offer' : 'muted') + '">' + (e.mode === '360' ? '360°' : 'Photo') + '</span></div>' +
          '<div class="se-visite-actions">' +
            '<button type="button" class="se-btn ghost sm" data-act="visite-monter" data-id="' + id + '" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Monter">↑</button>' +
            '<button type="button" class="se-btn ghost sm" data-act="visite-descendre" data-id="' + id + '" data-i="' + i + '"' + (i === etapes.length - 1 ? ' disabled' : '') + ' aria-label="Descendre">↓</button>' +
            '<button type="button" class="se-btn ghost sm" data-act="visite-retirer" data-id="' + id + '" data-i="' + i + '" aria-label="Retirer">✕</button>' +
          '</div></li>').join('') + '</ol>'
        : '<p class="se-muted">Aucune pièce pour l’instant.</p>') +
      (libres.length ? '<div class="se-visite-ajout"><span class="se-sub">Ajouter une photo du bien :</span><div class="se-visite-vignettes">' +
        libres.map((p) => '<button type="button" data-act="visite-ajouter-photo" data-id="' + id + '" data-url="' + esc(p) + '"><img src="' + esc(srcImg(p)) + '" alt="Ajouter"/></button>').join('') + '</div></div>' : '') +
      '<div class="se-row" style="gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<label class="se-btn ghost" style="cursor:pointer">' + (state.panoEnvoi === b.serverId ? 'Envoi du panorama…' : 'Ajouter un panorama 360°') +
          '<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-pano="' + id + '"/></label>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="se-btn ghost" data-act="visite-enregistrer" data-id="' + id + '" data-publie="0">Enregistrer sans publier</button>' +
        '<button type="button" class="se-btn" data-act="visite-enregistrer" data-id="' + id + '" data-publie="1">Publier sur la fiche</button>' +
      '</div>' +
      '<details class="se-visite-aide"><summary>Comment faire un panorama 360° ?</summary>' +
        '<p>Placez-vous au centre de la pièce, téléphone à hauteur des yeux. Avec une appli de photo 360° gratuite (sphère complète) ou une caméra 360°, prenez la photo en tournant lentement sur vous-même. Exportez l’image « équirectangulaire » : une photo deux fois plus large que haute (ex. 6000 × 3000 px), puis ajoutez-la ici.</p></details>' +
    '</div>';
  }

  // ---- Vidéo « home tour » (format Reel 9:16) ----
  // Fabriquée dans le navigateur, sans service externe : les photos défilent
  // avec un lent zoom (effet Ken Burns) et des fondus, encadrées d'une
  // ouverture (titre, quartier) et d'une fin « Visible uniquement sur
  // Seecret ». La musique est une nappe d'ambiance composée à la volée
  // (Web Audio) : aucun droit d'auteur en jeu.
  function videoSupportee() {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  }
  function typeVideo() {
    const choix = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return choix.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
  }
  function chargerImage(src) {
    return new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => ok(null);
      img.src = /^(data:|https?:|\/)/.test(src) ? src : 'assets/img/' + src;
    });
  }
  function ambiance(ctx, dest, duree) {
    // Nappe douce : accords Cmaj7 – Am7 – Fmaj7 – G6, enveloppes lentes.
    const accords = [[261.63, 329.63, 392.0, 493.88], [220.0, 261.63, 329.63, 392.0], [174.61, 220.0, 261.63, 329.63], [196.0, 246.94, 293.66, 329.63]];
    const filtre = ctx.createBiquadFilter(); filtre.type = 'lowpass'; filtre.frequency.value = 1400;
    const maitre = ctx.createGain(); maitre.gain.value = 0;
    filtre.connect(maitre); maitre.connect(dest);
    const t0 = ctx.currentTime + 0.05;
    maitre.gain.linearRampToValueAtTime(0.6, t0 + 2);
    maitre.gain.setValueAtTime(0.6, t0 + duree - 2.5);
    maitre.gain.linearRampToValueAtTime(0, t0 + duree);
    const pas = 4;
    for (let t = 0, i = 0; t < duree; t += pas, i++) {
      accords[i % accords.length].forEach((f, k) => {
        [f, f / 2].forEach((fr, oct) => {
          const o = ctx.createOscillator(); o.type = oct ? 'sine' : 'triangle'; o.frequency.value = fr;
          o.detune.value = (k - 1.5) * 4;
          const g = ctx.createGain(); g.gain.value = 0;
          o.connect(g); g.connect(filtre);
          const debut = t0 + t; const fin = Math.min(t0 + duree, debut + pas + 1.2);
          g.gain.linearRampToValueAtTime(0, debut);
          g.gain.linearRampToValueAtTime(oct ? 0.05 : 0.035, debut + 1.2);
          g.gain.linearRampToValueAtTime(0, fin);
          o.start(debut); o.stop(fin + 0.05);
        });
      });
    }
  }
  function lignesTexte(c, texte, largeur) {
    const mots = String(texte || '').split(/\s+/); const lignes = []; let l = '';
    mots.forEach((m) => { const essai = l ? l + ' ' + m : m; if (c.measureText(essai).width > largeur && l) { lignes.push(l); l = m; } else l = essai; });
    if (l) lignes.push(l);
    return lignes;
  }
  // Ce que la vidéo affiche : l'agent choisit, puis valide.
  const VIDEO_OPTIONS = [
    ['prix', 'Prix', true], ['surface', 'Surface', true], ['pieces', 'Pièces et chambres', true], ['secteur', 'Secteur (quartier)', true],
    ['rue', 'Nom de la rue (sans numéro)', false], ['etage', 'Étage', false], ['exterieur', 'Extérieur (balcon, terrasse…)', true], ['dpe', 'Classe énergie (DPE)', false],
    ['mention', 'Mention « Visible uniquement sur Seecret »', true], ['musique', 'Musique d’ambiance', true]
  ];
  function videoOptions(id) {
    state.videoOptions = state.videoOptions || {};
    if (!state.videoOptions[id]) { const o = {}; VIDEO_OPTIONS.forEach(([k, , d]) => { o[k] = d; }); o.formats = { horizontal: true, vertical: true }; state.videoOptions[id] = o; }
    return state.videoOptions[id];
  }
  function rueSansNumero(adresse) {
    return String(adresse || '').split(',')[0].replace(/^\s*\d+\s*(bis|ter|b|t)?\s*/i, '').trim();
  }
  // Formats : horizontal 16:9 (fiche du bien) et vertical 9:16 (réels).
  // Vidéos compressées (disque du site limité) : ~1,2 Mb/s.
  async function genererHomeTour(b, progres, opts) {
    opts = opts || {};
    const vertical = opts.format === 'vertical';
    const O = opts.options || videoOptions(b.serverId);
    const W = vertical ? 720 : 1280, H = vertical ? 1280 : 720, FPS = 30;
    const U = Math.min(W, H) / 720; // unité de taille (texte identique dans les deux formats)
    const sources = (b.photos || []).filter((p) => !/^https?:/.test(p) || p.indexOf(location.origin) === 0).slice(0, 8);
    const images = (await Promise.all(sources.map(chargerImage))).filter(Boolean);
    if (images.length < 2) throw new Error('Il faut au moins 2 photos du bien pour créer la vidéo.');
    const INTRO = 2.6, PAR_PHOTO = 3.0, FONDU = 0.7, FIN = 2.8;
    const duree = INTRO + images.length * PAR_PHOTO + FIN;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    const serif = (getComputedStyle(document.documentElement).getPropertyValue('--font-serif') || 'Georgia, serif').trim();
    const sans = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    const titre = (b.editorial && b.editorial.titre) || b.titre || 'Un bien du club';
    const quartier = O.secteur ? ((typeof qLabel === 'function' ? qLabel(b.quartier) : '') || b.ville || 'Paris') : '';
    const rue = O.rue ? rueSansNumero(b.adresse) : '';
    const lieu = [quartier, rue].filter(Boolean).join(' · ');
    const e = parseInt(b.etage, 10);
    const infos1 = [O.surface && b.surface ? b.surface + ' m²' : '', O.pieces && b.pieces ? b.pieces + ' pièces' : '', O.pieces && b.chambres ? b.chambres + ' chambre' + (b.chambres > 1 ? 's' : '') : '', O.etage && !isNaN(e) ? (e === 0 ? 'Rez-de-chaussée' : e + (e === 1 ? 'er' : 'e') + ' étage') : ''].filter(Boolean).join('  ·  ');
    const infos2 = [O.exterieur && b.exterieur && b.exterieur !== 'Aucun' ? b.exterieur + (b.surfaceExterieur ? ' ' + b.surfaceExterieur + ' m²' : '') : '', O.dpe && b.dpe ? 'DPE ' + b.dpe : ''].filter(Boolean).join('  ·  ');
    const prix = O.prix && b.prix ? euro(b.prix) : '';

    function photo(img, t, sens) {
      const z = 1.06 + 0.12 * t;
      const ratio = Math.max(W / img.width, H / img.height) * z;
      const w = img.width * ratio, h = img.height * ratio;
      const dx = (W - w) / 2 + (sens ? 1 : -1) * (t - 0.5) * W * 0.05;
      c.drawImage(img, dx, (H - h) / 2, w, h);
    }
    function voile(haut, opacite) {
      const g = c.createLinearGradient(0, haut ? 0 : H * 0.45, 0, haut ? H * 0.35 : H);
      g.addColorStop(0, haut ? 'rgba(10,9,8,' + opacite + ')' : 'rgba(10,9,8,0)');
      g.addColorStop(1, haut ? 'rgba(10,9,8,0)' : 'rgba(10,9,8,' + opacite + ')');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    function texte(txt, y, taille, police, couleur, espacement) {
      c.font = Math.round(taille * U) + 'px ' + police; c.fillStyle = couleur; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      if (espacement) { try { c.letterSpacing = espacement + 'px'; } catch (e2) { /* ancien navigateur */ } }
      c.fillText(txt, W / 2, y);
      try { c.letterSpacing = '0px'; } catch (e2) { /* ignore */ }
    }
    function image(t) {
      c.fillStyle = '#141210'; c.fillRect(0, 0, W, H);
      if (t < INTRO) {
        // Première image : la photo est là dès l'image 0 (jamais d'écran noir).
        const k = t / INTRO;
        photo(images[0], k * 0.4, true);
        c.fillStyle = 'rgba(10,9,8,.45)'; c.fillRect(0, 0, W, H);
        texte('SEECRET', H * (vertical ? 0.36 : 0.28), 22, sans, 'rgba(255,255,255,.85)', 8);
        c.font = Math.round(58 * U) + 'px ' + serif;
        const lignes = lignesTexte(c, titre, W - 140 * U).slice(0, vertical ? 4 : 2);
        const y0 = H * (vertical ? 0.46 : 0.45);
        lignes.forEach((l, i) => texte(l, y0 + i * 66 * U, 58, serif, '#fff'));
        if (lieu) texte(lieu.toUpperCase(), y0 + lignes.length * 66 * U + 30 * U, 22, sans, 'rgba(255,255,255,.88)', 5);
        return;
      }
      const tp = t - INTRO;
      if (tp < images.length * PAR_PHOTO) {
        const i = Math.min(images.length - 1, Math.floor(tp / PAR_PHOTO));
        const local = (tp - i * PAR_PHOTO) / PAR_PHOTO;
        photo(images[i], local, i % 2 === 0);
        const reste = PAR_PHOTO - (tp - i * PAR_PHOTO);
        if (reste < FONDU && i < images.length - 1) { c.globalAlpha = 1 - reste / FONDU; photo(images[i + 1], 0, (i + 1) % 2 === 0); c.globalAlpha = 1; }
        voile(false, 0.55); voile(true, 0.3);
        texte('SEECRET', 60 * U, 18, sans, 'rgba(255,255,255,.85)', 7);
        const a = Math.min(1, local * 3);
        c.globalAlpha = a;
        // Vertical : texte au-dessus du tiers bas (là où les réseaux et la page Vidéos affichent leurs boutons).
        const bas = vertical ? H * 0.6 : H - 70 * U;
        if (i === 0 && (infos1 || prix)) { if (prix) texte(prix, bas - 46 * U, 40, serif, '#fff'); if (infos1) texte(infos1, bas, 26, sans, '#fff'); }
        else if (i === 1 && lieu) texte(lieu, bas, 40, serif, '#fff');
        else if (i === 2 && infos2) texte(infos2, bas, 26, sans, '#fff');
        c.globalAlpha = 1;
        return;
      }
      const tf = (t - INTRO - images.length * PAR_PHOTO) / FIN;
      photo(images[images.length - 1], 1, true);
      c.fillStyle = 'rgba(10,9,8,' + Math.min(0.82, 0.3 + tf * 1.2) + ')'; c.fillRect(0, 0, W, H);
      c.globalAlpha = Math.min(1, tf * 2.5);
      const ym = H * (vertical ? 0.42 : 0.38);
      if (O.mention) { texte('Visible uniquement', ym, 54, serif, '#fff'); texte('sur Seecret', ym + 64 * U, 54, serif, '#fff'); texte('LE CLUB OFF-MARKET', ym + 130 * U, 20, sans, 'rgba(255,255,255,.8)', 6); }
      else { texte(titre.length > 34 ? titre.slice(0, 32) + '…' : titre, ym + 30 * U, 46, serif, '#fff'); texte('SEECRET', ym + 100 * U, 20, sans, 'rgba(255,255,255,.8)', 6); }
      if (prix && !O.mention) texte(prix, ym + 150 * U, 30, serif, '#fff');
      c.globalAlpha = 1;
    }

    image(0);
    const flux = canvas.captureStream(FPS);
    let actx = null;
    if (O.musique) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        await actx.resume();
        const dest = actx.createMediaStreamDestination();
        ambiance(actx, dest, duree);
        dest.stream.getAudioTracks().forEach((tr) => flux.addTrack(tr));
      } catch (e2) { /* vidéo sans musique */ }
    }
    const type = typeVideo();
    const rec = new MediaRecorder(flux, Object.assign({ videoBitsPerSecond: 1200000, audioBitsPerSecond: 96000 }, type ? { mimeType: type } : {}));
    const morceaux = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) morceaux.push(ev.data); };
    const fini = new Promise((ok) => { rec.onstop = ok; });
    rec.start(1000);
    const debut = performance.now();
    await new Promise((ok) => {
      const tic = () => {
        const t = (performance.now() - debut) / 1000;
        image(Math.min(t, duree));
        if (progres) progres(Math.min(1, t / duree));
        if (t >= duree) return ok();
        setTimeout(tic, 1000 / FPS);
      };
      tic();
    });
    rec.stop();
    await fini;
    flux.getTracks().forEach((tr) => tr.stop());
    if (actx) actx.close().catch(() => {});
    const mime = (rec.mimeType || type || 'video/webm').split(';')[0];
    return { blob: new Blob(morceaux, { type: mime }), type: mime, duree: Math.round(duree) };
  }
  const posterBien = (b) => { const p = (b.photos || [])[0]; return p ? (/^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p) : ''; };
  function blocVideoFormat(b, fmt) {
    const champ = fmt === 'vertical' ? 'videoVerticale' : 'video';
    const v = b[champ];
    const ap = state.videoApercu && state.videoApercu[b.serverId + '|' + fmt];
    const nomF = fmt === 'vertical' ? 'Format réel (vertical 9:16)' : 'Format plateforme (horizontal 16:9)';
    const usage = fmt === 'vertical' ? 'Pour vos réseaux (Instagram, TikTok…) et la page « Vidéos » de la plateforme.' : 'Affichée sur la fiche du bien, sur la plateforme.';
    const fichier = 'home-tour-' + (fmt === 'vertical' ? 'reel-' : '') + String(b.titre || 'bien').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const lecteur = (url) => '<video class="se-video ' + fmt + '" src="' + esc(url) + '" poster="' + esc(posterBien(b)) + '" controls playsinline preload="metadata"></video>';
    return '<div class="se-video-format"><div class="se-row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + nomF + '</b>' +
        (ap ? '<span class="se-badge warn">Aperçu, pas encore publié</span>' : v ? (v.publie ? '<span class="se-badge open">Publiée</span>' : '<span class="se-badge muted">Non publiée</span>') : '<span class="se-badge muted">Pas encore créée</span>') + '</div>' +
      '<p class="se-hint" style="margin:4px 0 8px">' + usage + '</p>' +
      (ap ? lecteur(ap.url) + '<div class="se-row" style="gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="se-btn sm" data-act="video-publier" data-id="' + esc(b.serverId) + '" data-format="' + fmt + '">Publier</button>' +
          '<a class="se-btn ghost sm" href="' + ap.url + '" download="' + fichier + (ap.type === 'video/mp4' ? '.mp4' : '.webm') + '">Télécharger</a>' +
          '<button type="button" class="se-btn ghost sm" data-act="video-oublier" data-id="' + esc(b.serverId) + '" data-format="' + fmt + '">Annuler</button></div>'
        : v ? lecteur(v.url) + '<div class="se-row" style="gap:8px;flex-wrap:wrap;margin-top:8px">' +
            '<a class="se-btn ghost sm" href="' + esc(v.url) + '" download>Télécharger</a>' +
            '<button type="button" class="se-btn ghost sm" data-act="video-visibilite" data-id="' + esc(b.serverId) + '" data-format="' + fmt + '">' + (v.publie ? 'Retirer de la plateforme' : 'Publier') + '</button>' +
            '<button type="button" class="se-btn ghost sm" data-act="video-supprimer" data-id="' + esc(b.serverId) + '" data-format="' + fmt + '">Supprimer</button></div>'
        : '') +
    '</div>';
  }
  function carteVideo(b) {
    if (!b.serverId) return '';
    const O = videoOptions(b.serverId);
    const enCours = state.videoEnCours === b.serverId;
    const nbPhotos = (b.photos || []).length;
    const formats = ['horizontal', 'vertical'].filter((f) => O.formats[f]);
    return '<div class="se-card se-video-carte">' +
      '<h3>Vidéos home tour</h3>' +
      '<p class="se-hint" style="margin:6px 0 12px">Créées à partir des photos du bien (8 maximum, ~' + Math.round(2.6 + Math.min(8, nbPhotos) * 3 + 2.8) + ' s). Choisissez ce qui s’affiche, puis validez : les vidéos se créent dans votre navigateur (gardez l’onglet ouvert), vous les regardez, puis vous les publiez.</p>' +
      (!videoSupportee() ? '<p class="se-note">Ce navigateur ne sait pas créer de vidéo. Utilisez Chrome, Edge ou Safari récent.</p>'
        : nbPhotos < 2 ? '<p class="se-note">Ajoutez au moins 2 photos au bien pour créer les vidéos.</p>'
        : '<div class="se-video-options">' +
            '<span class="se-kicker">CE QUI S’AFFICHE</span><div class="se-video-cases">' +
              VIDEO_OPTIONS.map(([k, l]) => '<label><input type="checkbox" data-video-opt="' + k + '" data-id="' + esc(b.serverId) + '"' + (O[k] ? ' checked' : '') + '/> ' + l + '</label>').join('') + '</div>' +
            (O.rue ? '<p class="se-hint" style="margin:6px 0 0">Le nom de la rue rend le bien plus facile à repérer : à réserver à vos réseaux si le vendeur est d’accord.</p>' : '') +
            '<span class="se-kicker" style="margin-top:12px;display:block">FORMATS</span><div class="se-video-cases">' +
              '<label><input type="checkbox" data-video-format="horizontal" data-id="' + esc(b.serverId) + '"' + (O.formats.horizontal ? ' checked' : '') + '/> Horizontal 16:9 (fiche sur la plateforme)</label>' +
              '<label><input type="checkbox" data-video-format="vertical" data-id="' + esc(b.serverId) + '"' + (O.formats.vertical ? ' checked' : '') + '/> Vertical 9:16 (réels et page « Vidéos »)</label></div>' +
            '<div class="se-row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button type="button" class="se-btn" data-act="video-generer" data-id="' + esc(b.serverId) + '"' + (enCours || !formats.length ? ' disabled' : '') + '>' +
              (enCours ? 'Création ' + (state.videoFormatEnCours === 'vertical' ? 'du format réel' : 'du format plateforme') + '…' : 'Valider et créer ' + (formats.length > 1 ? 'les 2 vidéos' : 'la vidéo')) + '</button></div>' +
          '</div>') +
      (enCours ? '<div class="se-video-progres"><i style="width:' + Math.round((state.videoProgres || 0) * 100) + '%"></i></div><p class="se-hint" data-video-statut>Création en cours… ' + Math.round((state.videoProgres || 0) * 100) + ' %</p>' : '') +
      '<div class="se-video-formats">' + blocVideoFormat(b, 'horizontal') + blocVideoFormat(b, 'vertical') + '</div>' +
    '</div>';
  }

  // ---- Texte éditorial de la fiche (rédigé par Célia, validé par l'agent) ----
  function carteEditorial(b) {
    if (!b.serverId) return '';
    const e = b.editorial || {};
    const brouillon = state.editorialBrouillon && state.editorialBrouillon[b.serverId];
    const titre = brouillon ? brouillon.titre : (e.titre || e.brouillonTitre || '');
    const texte = brouillon ? brouillon.texte : (e.texte || e.brouillonTexte || '');
    const enCours = state.editorialEnCours === b.serverId;
    return '<div class="se-card se-editorial" data-editorial="' + esc(b.serverId) + '">' +
      '<div class="se-row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><h3>Texte de la fiche</h3>' +
        (e.publie ? '<span class="se-badge open">Publié' + (e.publieLe ? ' le ' + dFR(e.publieLe) : '') + '</span>' : '<span class="se-badge muted">Non publié</span>') + '</div>' +
      '<p class="se-hint" style="margin:6px 0 12px">Célia rédige un titre et un texte au ton éditorial à partir des caractéristiques et des photos. Relisez, ajustez, puis publiez : les membres voient ce texte sur la fiche.</p>' +
      '<form data-form="editorial" data-id="' + esc(b.serverId) + '" class="se-form-grid">' +
        '<div class="se-field full"><label>Titre</label><input class="se-input" name="titre" maxlength="90" value="' + esc(titre) + '" placeholder="Ex. Un atelier d’artiste sous la verrière"/></div>' +
        '<div class="se-field full"><label>Texte</label><textarea class="se-textarea" name="texte" style="min-height:190px" placeholder="Cliquez sur « Rédiger avec Célia »…">' + esc(texte) + '</textarea></div>' +
        '<div class="se-field full"><label>« Ses propriétaires l’aiment pour… »</label><textarea class="se-textarea" name="coupDeCoeur" maxlength="280" style="min-height:70px" placeholder="La phrase du propriétaire (laisser vide pour ne rien afficher)">' + esc(b.coupDeCoeur || '') + '</textarea></div>' +
        '<div class="se-row full" style="gap:8px;flex-wrap:wrap">' +
          '<button type="button" class="se-btn ghost" data-act="editorial-generer" data-id="' + esc(b.serverId) + '"' + (enCours ? ' disabled' : '') + '>' + (enCours ? 'Célia rédige…' : (texte ? 'Proposer une autre version' : 'Rédiger avec Célia')) + '</button>' +
          '<span style="flex:1"></span>' +
          '<button type="submit" class="se-btn ghost" name="publie" value="0">Enregistrer sans publier</button>' +
          '<button type="submit" class="se-btn" name="publie" value="1">Publier sur la fiche</button>' +
        '</div>' +
      '</form>' +
    '</div>';
  }

  function haiPour(b, c) {
    const n = Number(b && b.prix) || 0;
    if (!n) return 0;
    return Math.round((n * (1 + tauxPour(b, c) / 100)) / BAREME.pas) * BAREME.pas;
  }
  const mandatsActifs = () => state.biens.filter((b) => b.statut !== 'brouillon' && b.statut !== 'vendu');
  const valeurPortefeuille = () => mandatsActifs().reduce((n, b) => n + b.prix, 0);
  const demandesNouvelles = () => state.demandes.filter((d) => d.statut === 'nouvelle').length;
  const visitesAVenir = () => state.visites.filter((v) => v.statut !== 'annulee' && v.statut !== 'realisee');
  const tachesOuvertes = () => state.taches.filter((t) => !t.fait);

  /* ------------------------------- scoring -------------------------------- */

  // Un bien du Radar a un étage estimé numérique (etageEstime, déduit de
  // l'adresse ADEME) ; un bien du portefeuille a son étage saisi à la main
  // (etage, nombre — 0 = RDC). Donnée absente ou non numérique → null,
  // ignorée comme un critère inconnu plutôt que de le faire échouer.
  const etageSaisie = (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };
  const etageComparable = (b) => {
    if (typeof b.etageEstime === 'number') return b.etageEstime;
    if (typeof b.etage === 'number') return b.etage;
    return null;
  };

  // Époque de construction comparable : un bien du portefeuille a une année
  // libre (anneeConstruction, saisie à la main) ; un bien du Radar a l'année
  // ADEME exacte (anneeConstruction) ou, à défaut, une période ADEME en texte
  // (periodeConstruction, ex. « 1948-1974 ») dont on extrait la première
  // année à titre indicatif. Donnée inconnue → null, ignorée comme l'étage.
  const EPOQUES = [
    { id: 'avant-1950', label: 'Ancien (avant 1950)', min: null, max: 1949 },
    { id: '1950-2000', label: '1950 à 2000', min: 1950, max: 2000 },
    { id: 'apres-2000', label: 'Récent (après 2000)', min: 2001, max: null }
  ];
  function anneeComparable(b) {
    if (b.anneeConstruction != null && b.anneeConstruction !== '') {
      const n = parseInt(b.anneeConstruction, 10);
      if (!isNaN(n)) return n;
    }
    if (b.periodeConstruction) {
      const m = /\d{4}/.exec(String(b.periodeConstruction));
      if (m) return parseInt(m[0], 10);
    }
    return null;
  }
  // true/false si comparable, null si l'époque demandée ou l'année du bien
  // est inconnue (dans ce cas : ni bonus ni exclusion, même logique que l'étage).
  function epoqueCorrespond(annee, epoqueId) {
    const ep = EPOQUES.find((e) => e.id === epoqueId);
    if (!ep || annee == null) return null;
    if (ep.min != null && annee < ep.min) return false;
    if (ep.max != null && annee > ep.max) return false;
    return true;
  }

  function scoreBien(b, c) {
    let s = 0;
    // Secteur 25%
    if (c.quartiers && c.quartiers.length) { if (c.quartiers.indexOf(b.quartier) > -1) s += 25; }
    // Budget 25%
    // Le budget de l'acquéreur s'entend honoraires inclus : on le compare au HAI.
    const max = c.prixMax || c.budgetMax;
    const hai = haiPour(b, c);
    if (max) { if (hai <= max * 1.05) s += 25; else if (hai <= max * 1.2) s += 12; }
    // Surface 15%
    if (c.surfaceMin) { if (b.surface >= c.surfaceMin) s += 15; else if (b.surface >= c.surfaceMin * 0.9) s += 7; }
    // Pièces 15%
    if (c.piecesMin) { if (b.pieces >= c.piecesMin) s += 15; }
    // Type(s) 10%
    const typesVoulus = (c.types && c.types.length) ? c.types : (c.type ? [c.type] : []);
    if (typesVoulus.length) { if (typesVoulus.indexOf(b.type) > -1) s += 10; } else s += 10;
    // Chambres / salles de bain / étage / époque 10% au total
    if (c.chambresMin) { if ((b.chambres || 0) >= c.chambresMin) s += 3; } else s += 3;
    if (c.sdbMin) { if ((b.sdb || 0) >= c.sdbMin) s += 2; } else s += 2;
    const etage = etageComparable(b);
    if (c.etageMin || c.etageMax) {
      if (etage == null) { /* donnée inconnue : ni bonus ni pénalité */ }
      else if ((!c.etageMin || etage >= c.etageMin) && (!c.etageMax || etage <= c.etageMax)) s += 2;
    } else s += 2;
    if (c.epoque) {
      const ok = epoqueCorrespond(anneeComparable(b), c.epoque);
      if (ok === true) s += 3;
      // ok === null ou false : ni bonus ni pénalité (donnée inconnue ou hors cible, cf. correspond())
    } else s += 3;
    return Math.round(s);
  }

  function correspond(b, c) {
    const max = c.prixMax || c.budgetMax;
    if (max && haiPour(b, c) > max * 1.2) return false;
    if (c.surfaceMax && b.surface > c.surfaceMax * 1.1) return false;
    if (c.surfaceMin && b.surface < c.surfaceMin * 0.9) return false;
    if (b.quartier && c.quartiers && c.quartiers.length && c.quartiers.indexOf(b.quartier) === -1) return false;
    const typesVoulus = (c.types && c.types.length) ? c.types : (c.type ? [c.type] : []);
    if (b.type && typesVoulus.length && typesVoulus.indexOf(b.type) === -1) return false;
    if (c.chambresMin && (b.chambres || 0) < c.chambresMin) return false;
    if (c.sdbMin && (b.sdb || 0) < c.sdbMin) return false;
    const etage = etageComparable(b);
    if (etage != null) {
      if (c.etageMin && etage < c.etageMin) return false;
      if (c.etageMax && etage > c.etageMax) return false;
    }
    if (c.epoque && epoqueCorrespond(anneeComparable(b), c.epoque) === false) return false;
    return true;
  }

  function biensCompatibles(critere, seuil) {
    return ((state.biensServeur || []).concat(state.biens))
      .filter((b) => b.statut !== 'vendu' && b.statut !== 'brouillon')
      .filter((b) => correspond(b, critere))
      .map((b) => ({ bien: b, score: scoreBien(b, critere) }))
      .filter((x) => x.score >= (seuil || 40))
      .sort((a, b) => b.score - a.score);
  }

  function clientsCompatibles(b) {
    const recherches = (state.recherchesServeur || []).concat(state.recherches);
    return state.clients
      .filter((c) => c.type !== 'vendeur' && c.statut !== 'archive')
      .map((c) => {
        const rec = recherches.find((r) => r.clientId === c.id || r.clientId === c.serverId);
        const budgetMax = c.budgetMax || (rec ? rec.prixMax : 0) || 0;
        const critere = Object.assign({}, c, { budgetMax: budgetMax, prixMax: budgetMax });
        return { client: c, budgetMax: budgetMax, critere: critere, score: scoreBien(b, critere) };
      })
      .filter((x) => correspond(b, x.critere))
      .filter((x) => x.score >= 20)
      .sort((a, b) => b.score - a.score);
  }

  /* ============================ IMMO DATA ROBOT ============================ */

  const ST_MATCHING = {
    nouveau: 'Nouveau', a_examiner: 'À examiner', validee: 'Validée', a_qualifier: 'À qualifier',
    proprietaire_contacte: 'Propriétaire contacté', dispo_a_confirmer: 'Disponibilité à confirmer',
    presentee: 'Présentée au client', visite_envisagee: 'Visite envisagée', visite_realisee: 'Visite réalisée',
    interet_confirme: 'Intérêt confirmé', refus_client: 'Refus client', refus_proprietaire: 'Refus propriétaire',
    sans_suite: 'Sans suite', en_negociation: 'En négociation', transaction: 'Transaction réalisée'
  };

  function normalizeRobotBien(b) {
    if (!b) return b;
    // Migration des anciens champs → nouveaux (sans rien inventer)
    if (b.surface_habitable_m2 == null && b.surface != null && b.terrain != null) b.surface_habitable_m2 = b.surface > 0 ? b.surface : null;
    if (b.contenance_cadastrale_m2 == null && b.terrain != null) b.contenance_cadastrale_m2 = b.terrain;
    if (b.contenance_cadastrale_m2 == null && b.surface != null && b.terrain == null) b.contenance_cadastrale_m2 = b.surface; // ancien format : surface = contenance
    if (b.confidence_geocoding == null && b.confianceGeo != null) b.confidence_geocoding = b.confianceGeo;
    if (b.confidence_owner == null && b.scoreFiabilite != null) b.confidence_owner = b.scoreFiabilite;
    return b;
  }

  function robotBiens() {
    (state.robotBiens || []).forEach(normalizeRobotBien);
    (state.dpeAuto || []).forEach(normalizeRobotBien);
    // state.dpeAuto (détections automatiques, voir syncServeur) est fusionné
    // en lecture seule ici — c'est ce qui permet au tableau de bord, aux
    // rapprochements et à la fiche bien de traiter un bien détecté par le
    // moteur quotidien exactement comme un bien du Radar manuel, sans
    // dupliquer la logique d'affichage. On exclut les adresses déjà dans
    // state.robotBiens : un bien promu (voir 'robot-promouvoir') existe
    // alors dans les deux tableaux le temps d'un rafraîchissement serveur,
    // et ne doit apparaître qu'une fois.
    const connues = new Set((state.robotBiens || []).map((b) => adresseKey(b.adresse)));
    const auto = (state.dpeAuto || []).filter((b) => !connues.has(adresseKey(b.adresse)));
    return (state.robotBiens || []).concat(auto);
  }

  function mapVerifRobot(s) {
    const st = String(s || '').toUpperCase();
    if (st.includes('UNVERIFIED') || st.includes('GENERATED') || st.includes('FOUND')) return 'GENERATED';
    if (st.includes('VERIFIED')) return 'VERIFIED';
    if (st.includes('INVALID')) return 'INVALID';
    if (st.includes('NOT_FOUND') || st.includes('NOT_SEARCHED')) return 'NOT_FOUND';
    return 'NOT_FOUND';
  }

  function mapContactsSignal(s) {
    const out = [];
    if (s.phone) out.push({ valeur: s.phone, type: 'tel', verification: mapVerifRobot(s.phone_status), source: s.phone_source || '' });
    if (s.email) out.push({ valeur: s.email, type: 'email', verification: mapVerifRobot(s.email_status), source: s.email_source || '' });
    (s.contact_candidates || []).forEach((c) => {
      const v = c.value;
      if (v && !out.some((x) => x.valeur === v)) {
        out.push({ valeur: v, type: String(c.channel || '').toUpperCase() === 'EMAIL' ? 'email' : 'tel', verification: mapVerifRobot(c.verification_status || c.status), source: c.source || '' });
      }
    });
    return out;
  }

  // Un bien venu de l'ADEME n'a qu'un code postal (pas d'id de secteur
  // Seecret) : on retrouve le secteur correspondant pour qu'il puisse matcher
  // les recherches clients filtrées par secteur (comme n'importe quel bien).
  const quartierDeCp = (cp) => (QUARTIERS.find((q) => q.cp === String(cp || '').trim()) || null);

  // L'ADEME n'a pas de colonne « étage » structurée pour les logements : ça
  // n'existe nulle part dans ses données publiques (vérifié). Mais l'adresse
  // brute du DPE (non nettoyée par la BAN) mentionne parfois l'étage en texte
  // libre, ex. « 12 rue de Seine, étage 3, porte 2 » — on l'extrait en best
  // effort, toujours affiché comme une estimation non garantie, jamais
  // comme une donnée certaine.
  // Note : on évite \b juste avant « étage »/« ét. » car le \w de JS est
  // ASCII uniquement — « é » n'est pas considéré comme un caractère de mot,
  // donc un \b entre une espace et « é » ne matche jamais (bug constaté en
  // test). On utilise un lookbehind négatif sur les lettres (accents inclus)
  // à la place.
  const ETAGE_RE = /(?<![a-zàâäéèêëïîôöùûüÿñç])(?:étage|etage|ét\.?|et\.?)\s*n?°?\s*(rdc|rez[- ]de[- ]chauss[ée]e|\d{1,2})\b/i;
  function etageDepuisAdresseBrute(adresseBrut) {
    const m = ETAGE_RE.exec(String(adresseBrut || ''));
    if (!m) return null;
    const v = m[1].toLowerCase();
    return /rdc|rez/.test(v) ? 'RDC' : v;
  }

  // Liste des champs déjà exploités explicitement ailleurs (affichés avec
  // leur propre libellé) — tout le reste d'une ligne ADEME est néanmoins
  // conservé dans `ademeBrut` et proposé en complément dans les fiches, pour
  // enrichir au maximum sans dépendre d'une liste de champs codée en dur.
  function mapSignalRobotBien(s) {
    const secteur = quartierDeCp(s.code_postal_ban);
    return {
      id: s.signal_id ? 'sig-' + s.signal_id : (s.parcelle || s.dpe_id || uid('rb')),
      signalId: s.signal_id || null,
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
      dpeId: s.numero_dpe || s.dpe_id || '',
      dpeDate: s.date_reception_dpe || s.dpe_observed_at || null,
      anneeConstruction: s.annee_construction || null,
      periodeConstruction: s.periode_construction || null,
      etageEstime: etageDepuisAdresseBrute(s.adresse_brut),
      proprietaire: {
        nom: s.owner_name || '',
        type: String(s.owner_type || '').toLowerCase().indexOf('sci') > -1 ? 'sci' : (s.owner_type === 'societe' || s.siren ? 'societe' : 'personne'),
        siren: s.siren || '',
        dirigeants: []
      },
      contacts: mapContactsSignal(s),
      confidence_geocoding: (s.ban_score != null) ? Math.round(Number(s.ban_score) * 100) : null,
      confidence_geocoding_source: s.ban_source_status || 'BAN',
      confidence_owner: (s.owner_confidence != null) ? Math.round(Number(s.owner_confidence) * 100) : null,
      confidence_owner_source: s.owner_status || null,
      dateDetection: new Date().toISOString(),
      statutProspection: 'nouveau',
      coords: (s.coordonnee_cartographique_y_ban != null && s.coordonnee_cartographique_x_ban != null && Math.abs(Number(s.coordonnee_cartographique_y_ban)) <= 90 && Math.abs(Number(s.coordonnee_cartographique_x_ban)) <= 180) ? [Number(s.coordonnee_cartographique_y_ban), Number(s.coordonnee_cartographique_x_ban)] : null,
      ademeBrut: s
    };
  }

  // Formate en français lisible toute donnée ADEME supplémentaire non déjà
  // exploitée par un champ dédié — c'est ce qui permet d'enrichir avec
  // « le maximum de critères » sans dépendre d'une liste de noms de colonnes
  // devinée à l'avance (voir /api/robot/dpe, qui ne restreint plus les champs
  // renvoyés par l'ADEME).
  const ADEME_CHAMPS_DEJA_AFFICHES = new Set([
    'etiquette_dpe', 'etiquette_ges', 'type_batiment', 'surface_habitable_logement', 'surface_habitable_immeuble',
    'annee_construction', 'periode_construction', 'date_reception_dpe', 'date_etablissement_dpe', 'date_fin_validite_dpe',
    'numero_dpe', 'adresse_ban', 'adresse_brut', 'code_postal_ban', 'code_insee_ban', 'nom_commune_ban',
    'coordonnee_cartographique_y_ban', 'coordonnee_cartographique_x_ban', 'conso_5_usages_par_m2_ep', 'emission_ges_5_usages_par_m2',
    '_id', '_rand', '_score', 'geo_point_2d', '_geopoint', '_i'
  ]);
  const ADEME_LABEL = (k) => k.replace(/_/g, ' ').replace(/\bban\b/g, 'BAN').replace(/\bep\b/g, 'ÉP').replace(/^./, (c) => c.toUpperCase());
  function autresChampsAdeme(ademeBrut) {
    if (!ademeBrut || typeof ademeBrut !== 'object') return [];
    return Object.keys(ademeBrut)
      .filter((k) => !ADEME_CHAMPS_DEJA_AFFICHES.has(k) && ademeBrut[k] !== null && ademeBrut[k] !== '' && ademeBrut[k] !== undefined)
      .map((k) => ({ label: ADEME_LABEL(k), valeur: ademeBrut[k] }))
      .filter((x) => typeof x.valeur !== 'object');
  }

  let ENRICH_POLL = null;
  function pollEnrichissement() {
    if (ENRICH_POLL) clearInterval(ENRICH_POLL);
    ENRICH_POLL = setInterval(async () => {
      try {
        const r = await fetch('/api/robot/enrichir-statut', { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.biens) {
          state.robotBiens = r.biens.map(normalizeRobotBien);
          state.robotEnrichStats = r.stats;
          render();
          if (r.stats && r.stats.enCours === 0 && r.stats.enAttente === 0) { clearInterval(ENRICH_POLL); ENRICH_POLL = null; }
        }
      } catch (e) { /* ignore */ }
    }, 2000);
  }

  async function enrichirDpeAuto() {
    const biens = (state.robotBiens || []).filter((b) => b.adresse && (!b.proprietaire || !b.proprietaire.nom));
    for (let i = 0; i < biens.length; i += 5) {
      const lot = biens.slice(i, i + 5);
      await Promise.all(lot.map(async (b) => {
        try {
          const r = await fetch('/api/robot/enrichir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ adresse: b.adresse }) }).then((x) => x.json());
          if (r.ok && r.dossiers && r.dossiers.length) {
            const d0 = r.dossiers[0];
            if (d0.parcel_ref) b.parcelle = d0.parcel_ref;
            if (d0.code_insee) { b.codeInsee = d0.code_insee; b.section = d0.section; b.numero = d0.numero; }
            const o = d0.owner || {};
            const cand = (o.candidates || [])[0] || {};
            if (cand.name || cand.nom) {
              b.proprietaire = {
                nom: cand.name || cand.nom || '',
                type: String(cand.owner_type || '').toLowerCase().indexOf('sci') > -1 ? 'sci' : (cand.siren ? 'societe' : 'personne'),
                siren: cand.siren || '', dirigeants: []
              };
              if (r.dossiers[0].scores && r.dossiers[0].scores.data_reliability) b.confidence_owner = r.dossiers[0].scores.data_reliability;
              b.enrichStatut = 'enrichi';
              if (cand.siren) {
                try {
                  const dr = await fetch('/api/robot/dirigeants?siren=' + encodeURIComponent(cand.siren), { credentials: 'same-origin' }).then((x) => x.json());
                  if (dr.ok && dr.dirigeants && dr.dirigeants.length) b.proprietaire.dirigeants = dr.dirigeants;
                } catch (e) { /* dirigeants indisponibles */ }
              }
            } else { b.enrichStatut = 'non-identifie'; }
          } else { b.enrichStatut = 'non-identifie'; }
        } catch (e) { b.enrichStatut = 'attente'; }
        // Aucadastre : personnes morales de la voie (complément FPMU, sans clé)
        if (b.adresse && (!b.proprietaire || !b.proprietaire.nom)) {
          try {
            const ar = await fetch('/api/robot/aucadastre-owners?adresse=' + encodeURIComponent(b.adresse), { credentials: 'same-origin' }).then((x) => x.json());
            if (ar.ok && ar.owners && ar.owners.length) {
              const first = ar.owners[0];
              b.proprietaire = { nom: first.nom, type: 'societe', siren: first.siren || '', dirigeants: [] };
              b.confidence_owner = 90;
              b.confidence_owner_source = 'Aucadastre /street (DGFiP personnes morales)';
              b.enrichStatut = 'enrichi';
              if (first.siren) {
                try {
                  const dr = await fetch('/api/robot/dirigeants?siren=' + encodeURIComponent(first.siren), { credentials: 'same-origin' }).then((x) => x.json());
                  if (dr.ok && dr.dirigeants && dr.dirigeants.length) { b.proprietaire.dirigeants = dr.dirigeants; b.enrichStatut = 'enrichi'; }
                } catch (e2) { /* dirigeants indisponibles */ }
              }
            }
          } catch (e2) { /* Aucadastre indisponible */ }
        }
      }));
      saveRobotBiens();
      render();
    }
    enrichirEstimation();
  }

  function postalToInsee(cp) {
    const m = /^75(\d{3})$/.exec(String(cp || '').trim());
    return m ? '751' + m[1] : null; // Paris : 75016 → 75116
  }

  async function enrichirEstimation() {
    const biens = state.robotBiens || [];
    const insees = new Set(biens.map((b) => postalToInsee(b.codePostal)).filter(Boolean));
    const prix = {};
    for (const insee of insees) {
      try {
        const r = await fetch('/api/robot/aucadastre/commune/' + insee, { credentials: 'same-origin' }).then((x) => x.json());
        const med = r.data && r.data.market && r.data.market.median_price_per_m2_flat && r.data.market.median_price_per_m2_flat.value;
        if (med) prix[insee] = med;
      } catch (e) { /* Aucadastre indisponible */ }
    }
    let nb = 0;
    biens.forEach((b) => {
      const med = postalToInsee(b.codePostal) ? prix[postalToInsee(b.codePostal)] : null;
      if (med && b.surface_habitable_m2) {
        const base = med * b.surface_habitable_m2;
        b.estimationMin = Math.round(base * 0.9);
        b.estimationMax = Math.round(base * 1.1);
        b.estimationSource = 'Aucadastre (prix médian/m²)';
        nb++;
      }
    });
    if (nb) { saveRobotBiens(); render(); toast(nb + ' estimation(s) calculée(s) via Aucadastre.', 'ok'); }
  }

  function saveRobotBiens() {
    fetch('/api/robot-biens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ biens: state.robotBiens || [] }) }).catch(() => {});
  }

  function mapRobotBien(f) {
    const p = (f && f.properties) || {};
    return {
      id: p.parcel_ref || (f && f.id) || uid('rb'),
      adresse: p.address || p.adresse || '',
      ville: p.city || '',
      codePostal: p.postal_code || p.code_postal || '',
      type: p.type_batiment || p.type || '',
      // Surfaces : uniquement la source correspondante, null si absente (aucune substitution)
      surface_habitable_m2: (p.surface_habitable_logement != null) ? Number(p.surface_habitable_logement) : null,
      surface_reference_dpe_m2: (p.surface_habitable_immeuble != null) ? Number(p.surface_habitable_immeuble) : null,
      surface_terrain_m2: (p.surface_terrain != null) ? Number(p.surface_terrain) : null,
      contenance_cadastrale_m2: (p.area_m2 != null) ? Number(p.area_m2) : null,
      parcelle: p.parcel_ref || '',
      quartiers: [],
      dpe: Array.isArray(p.dpe_classes) ? p.dpe_classes.join(',') : (p.dpe_class || ''),
      proprietaire: { nom: '', type: '', siren: '', dirigeants: [] },
      contacts: [],
      // Confiances indépendantes (jamais de substitution géocodage→propriété)
      confidence_geocoding: (p.match_score != null ? Math.round(Number(p.match_score) * 100) : (p.confidence != null ? Math.round(Number(p.confidence) * 100) : null)),
      confidence_geocoding_source: (p.match_status ? p.match_status + ' · ' : '') + (p.source || 'API Carto IGN'),
      confidence_owner: null,
      confidence_owner_source: null,
      dateDetection: new Date().toISOString(),
      statutProspection: 'nouveau',
      coords: (p.centroid && p.centroid.length >= 2) ? [Number(p.centroid[1]), Number(p.centroid[0])] : null,
      feature: f || null
    };
  }

  function clientDeRecherche(rec) {
    // Chaque comparaison ne compte que si les deux côtés sont renseignés :
    // sans ce garde-fou, deux recherches/clients qui n'ont ni l'un ni l'autre
    // de leadId/serverId (undefined === undefined) matchaient le premier
    // client de la liste par accident, au lieu du bon acquéreur.
    return state.clients.find((c) =>
      c.id === rec.clientId ||
      (!!rec.leadId && c.id === rec.leadId) ||
      (!!rec.clientId && c.serverId === rec.clientId) ||
      (!!rec.leadId && c.serverId === rec.leadId)) ||
      (state.clientsServeur || []).find((c) => c.id === rec.clientId || (!!rec.leadId && c.id === rec.leadId)) || null;
  }

  // Nombre total de critères examinés par scoreRobotBien (chacun finit soit
  // scoré, soit dans `inconnus` — jamais les deux) : Localisation, Type,
  // Surface, Budget, Pièces, DPE, Étage, Époque. Partagé avec explicationMatching
  // pour ne pas avoir à resynchroniser ce chiffre à la main si un critère est
  // ajouté ou retiré un jour.
  const ROBOT_CRITERES_TOTAL = 8;

  function scoreRobotBien(rb, rec) {
    let s = 0, tot = 0;
    const inconnus = [];
    const types = (rec.types && rec.types.length) ? rec.types : (rec.type ? [rec.type] : []);
    // Localisation 30
    if (rec.quartiers && rec.quartiers.length) {
      tot += 30;
      if ((rb.quartiers || []).some((q) => rec.quartiers.indexOf(q) > -1)) s += 30;
      else inconnus.push('Localisation');
    } else if (rec.villes && rec.villes.length) {
      tot += 30;
      if (rec.villes.some((v) => (rb.ville || '').toLowerCase().includes(v.toLowerCase()))) s += 30;
      else inconnus.push('Localisation');
    } else if (rec.codePostaux && rec.codePostaux.length) {
      tot += 30;
      if (rec.codePostaux.indexOf(rb.codePostal) > -1) s += 30;
      else inconnus.push('Localisation');
    } else { inconnus.push('Localisation'); }
    // Type 20 — comparaison insensible à la casse : les biens issus de
    // l'ADEME ont un type_batiment en minuscules ('appartement'), alors que
    // les recherches utilisent la casse de TYPES ('Appartement').
    if (types.length) {
      tot += 20;
      if (types.some((t) => String(t).toLowerCase() === String(rb.type || '').toLowerCase())) s += 20;
      else inconnus.push('Type de bien');
    } else { inconnus.push('Type de bien'); }
    // Surface 20
    if (rec.surfaceMin) {
      tot += 20;
      if (rb.surface_habitable_m2 != null && rb.surface_habitable_m2 >= rec.surfaceMin) s += 20;
      else if (rb.surface_habitable_m2 != null && rb.surface_habitable_m2 >= rec.surfaceMin * 0.9) s += 10;
      else inconnus.push('Surface');
    } else { inconnus.push('Surface'); }
    // Budget 15 — prix du bien détecté toujours inconnu → jamais comparé
    inconnus.push('Budget');
    // Pièces 10
    if (rec.piecesMin) {
      tot += 10;
      if (rb.pieces && rb.pieces >= rec.piecesMin) s += 10;
      else inconnus.push('Pièces');
    } else { inconnus.push('Pièces'); }
    // DPE 5 — « au moins aussi bonne que » la classe souhaitée, pas une égalité
    // stricte : un acquéreur qui accepte du D accepte aussi du C, B ou A.
    if (rec.dpe) {
      tot += 5;
      const ir = DPE_ORDER.indexOf(rec.dpe), ib = DPE_ORDER.indexOf(rb.dpe);
      if (ib > -1 && ir > -1 && ib <= ir) s += 5;
      else inconnus.push('DPE');
    } else { inconnus.push('DPE'); }
    // Étage 5 — uniquement comparable quand l'étage a pu être estimé depuis
    // l'adresse (etageEstime) ; les données DPE n'ont ni chambres ni salles
    // de bain, ce critère ne peut donc pas être confronté ici (contrairement
    // au portefeuille, cf. scoreBien).
    if (rec.etageMin || rec.etageMax) {
      tot += 5;
      if (typeof rb.etageEstime === 'number' &&
          (!rec.etageMin || rb.etageEstime >= rec.etageMin) &&
          (!rec.etageMax || rb.etageEstime <= rec.etageMax)) s += 5;
      else inconnus.push('Étage');
    } else { inconnus.push('Étage'); }
    // Époque de construction 5 — comparée à l'année ADEME exacte, ou à
    // défaut à la période ADEME (cf. anneeComparable).
    if (rec.epoque) {
      tot += 5;
      if (epoqueCorrespond(anneeComparable(rb), rec.epoque) === true) s += 5;
      else inconnus.push('Époque de construction');
    } else { inconnus.push('Époque de construction'); }
    const score = tot ? Math.round(s / tot * 100) : 0;
    const couverture = Math.round((1 - inconnus.length / ROBOT_CRITERES_TOTAL) * 100);
    return { score, couverture, inconnus };
  }

  function niveauPriorite(score) {
    if (score >= 90) return { label: 'Exceptionnelle', cls: 'open' };
    if (score >= 75) return { label: 'Forte', cls: 'open' };
    if (score >= 60) return { label: 'Intéressante', cls: '' };
    if (score >= 40) return { label: 'À étudier', cls: 'warn' };
    return { label: 'Faible', cls: 'muted' };
  }

  function matchings() {
    const biens = robotBiens();
    const recherches = (state.recherchesServeur || []).concat(state.recherches);
    const out = [];
    biens.forEach((rb) => {
      recherches.forEach((rec) => {
        const client = clientDeRecherche(rec);
        if (!client) return;
        const s = scoreRobotBien(rb, rec);
        if (s.score < 40) return;
        const key = rb.id + ':' + rec.id;
        const existing = (state.matchings || []).find((m) => m.key === key);
        if (existing) {
          existing.score = s.score;
          existing.couverture = s.couverture;
          existing.historique = existing.historique || [];
          const last = existing.historique[existing.historique.length - 1];
          if (!last || last.score !== s.score) {
            existing.historique.push({ at: new Date().toISOString(), score: s.score, couverture: s.couverture });
          }
          out.push(existing);
        } else {
          out.push({ key: key, bienId: rb.id, rechercheId: rec.id, clientId: client.id, score: s.score, couverture: s.couverture, statut: 'nouveau', dateDetection: rb.dateDetection, historique: [{ at: new Date().toISOString(), score: s.score, couverture: s.couverture }] });
        }
      });
    });
    state.matchings = out;
    return out;
  }

  function robotBien(id) { return robotBiens().find((b) => b.id === id) || null; }

  // Pour qu'un agent ait toujours de la matière à démarcher : à partir des
  // critères d'une recherche active (secteur, type, surface, DPE), interroge
  // la base DPE publique de l'ADEME pour trouver des biens réels qui y
  // correspondent, les ajoute au Radar (dédoublonnés par adresse) et lance
  // leur enrichissement propriétaire automatique — exactement le même
  // pipeline que la recherche DPE manuelle, mais ciblé sur cette recherche.
  async function rechercherDpePourRecherche(rec) {
    const secteurs = (rec.quartiers || []).map(qSecteur).filter(Boolean);
    if (!secteurs.length) return { ajoutes: 0, erreur: 'secteur' };
    const typeMap = { Appartement: 'appartement', Maison: 'maison' };
    const classes = rec.dpe ? DPE_ORDER.slice(0, DPE_ORDER.indexOf(rec.dpe) + 1) : [];
    const dejaConnues = new Set((state.robotBiens || []).map((b) => adresseKey(b.adresse)));
    let ajoutes = 0;
    for (const sec of secteurs) {
      const params = new URLSearchParams();
      params.set('code_postal', sec.cp);
      params.set('ville', sec.label);
      if (rec.surfaceMin) params.set('surface_min', String(rec.surfaceMin));
      if (rec.type && typeMap[rec.type]) params.set('type', typeMap[rec.type]);
      if (classes.length) params.set('classes', classes.join(','));
      params.set('tri', 'recent');
      params.set('limit', '20');
      try {
        const r = await fetch('/api/robot/dpe?' + params.toString(), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.results && r.results.length) {
          const nouveaux = r.results
            .filter((row) => !dejaConnues.has(adresseKey(row.adresse_ban || row.adresse_brut)))
            .map(mapSignalRobotBien);
          nouveaux.forEach((b) => { b.rechercheOrigine = rec.id; dejaConnues.add(adresseKey(b.adresse)); });
          if (nouveaux.length) { state.robotBiens = (state.robotBiens || []).concat(nouveaux); ajoutes += nouveaux.length; }
        }
      } catch (e) { /* secteur suivant */ }
    }
    if (ajoutes) { saveRobotBiens(); enrichirDpeAuto(); }
    return { ajoutes: ajoutes, erreur: null };
  }

  /* ================================ rendu ================================ */

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

  // Lien d'un email de notification : /crm.html?ouvrir=demande/xxx → #/demande/xxx
  try {
    const ouvrir = new URLSearchParams(location.search).get('ouvrir');
    if (ouvrir && /^[\w\-\/]+$/.test(ouvrir)) history.replaceState(null, '', '/crm.html#/' + ouvrir);
  } catch (e) { /* rien */ }
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { name: parts[0] || 'tableau', param: parts[1] || null };
  }

  /* ====================== synchronisation serveur ====================== */

  const libelleDoc = (t) => ({ identite: 'Pièce d’identité', financement: 'Justification de financement', bien: 'Titre de propriété' }[t] || t);

  // Identité réelle (rôle + id serveur) de la personne connectée. Permet à
  // l'interface de savoir si elle doit proposer la gestion des agents
  // (super-admin) ou simplement travailler sur « mes clients » (agent) —
  // le filtrage réel et contraignant se fait côté serveur, ceci ne sert
  // qu'à adapter l'affichage.
  async function syncIdentite() {
    try {
      const r = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
      if (!r.ok) return;
      const data = await r.json();
      if (data && data.membre) {
        state.moi = { id: data.membre.id, role: data.membre.role, prenom: data.membre.prenom, nom: data.membre.nom, email: data.membre.email };
        if (state.moi.role === 'superadmin') syncAgents();
        render();
      }
    } catch (e) { /* pas bloquant : l'interface reste utilisable sans */ }
  }

  // Liste des comptes agents — réservé au super-admin (les routes serveur
  // le vérifient aussi ; ceci n'est que pour l'affichage).
  async function syncAgents() {
    try {
      const r = await fetch('/api/agents', { headers: { accept: 'application/json' } });
      if (!r.ok) return;
      const data = await r.json();
      state.agents = (data && data.agents) || [];
      render();
    } catch (e) { /* non bloquant */ }
  }

  // Biens restés seulement dans ce navigateur (créés quand le propriétaire
  // n'était pas encore synchronisé) : impossibles à publier. On les envoie au
  // serveur dès que leur propriétaire y existe, puis la copie serveur fait foi.
  // Les biens d'exemple (b1…b8) ne sont jamais envoyés.
  async function rattraperBiensLocaux() {
    const surServeur = new Set((state.biensServeur || []).map((b) => b.id));
    const avant = state.biens.length;
    state.biens = state.biens.filter((b) => !(b.serverId && surServeur.has(b.serverId)));
    let envoyes = 0;
    for (const b of state.biens.slice()) {
      if (b.serverId || /^b\d+$/.test(b.id) || b.demo) continue;
      const proprio = client(b.proprietaireId);
      if (!proprio || !proprio.serverId) continue;
      try {
        const r = await fetch('/api/biens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, b, { proprietaireId: proprio.serverId })) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok || !res.bien) continue;
        state.biensServeur.push(mapBienServeur(res.bien));
        state.biens = state.biens.filter((x) => x !== b);
        envoyes++;
      } catch (e) { /* on réessaiera au prochain chargement */ }
    }
    if (envoyes) toast(envoyes + ' bien(s) qui n’existai(en)t que sur cet appareil ont été enregistrés : ils peuvent maintenant être publiés.', 'ok');
    if (envoyes || state.biens.length !== avant) commit();
  }
  async function syncServeur() {
    try {
      const [rl, rd, rt, rb, rr, ra, ro] = await Promise.all([
        fetch('/api/leads', { headers: { accept: 'application/json' } }),
        fetch('/api/demandes', { headers: { accept: 'application/json' } }),
        fetch('/api/tasks', { headers: { accept: 'application/json' } }),
        fetch('/api/biens', { headers: { accept: 'application/json' } }),
        fetch('/api/recherches', { headers: { accept: 'application/json' } }),
        fetch('/api/activites', { headers: { accept: 'application/json' } }),
        fetch('/api/offres', { headers: { accept: 'application/json' } })
      ]);
      const leads = rl.ok ? (await rl.json()).leads || [] : [];
      const rdj = rd.ok ? await rd.json() : {};
      const demandes = rdj.demandes || [];
      state.tachesVerif = rt.ok ? ((await rt.json()).tasks || []) : [];
      state.activites = ra.ok ? ((await ra.json()).activites || []) : [];
      const offresServeur = ro.ok ? ((await ro.json()).offres || []) : [];

      leads.forEach((l) => {
        let c = state.clients.find((x) => x.serverId === l.id) ||
                state.clients.find((x) => x.email && l.email && x.email.toLowerCase() === l.email.toLowerCase());
        if (c) {
          Object.assign(c, {
            serverId: l.id, serveurStatut: l.statut,
            documents: l.documents || 0, documentsValides: l.documentsValides || 0,
            bienInfo: l.bienInfo || null, agentId: l.agentId || null, demo: !!l.demo,
            archive: !!l.archive, archiveLe: l.archiveLe || '', archivePar: l.archivePar || ''
          });
          // Identité saisie dans la candidature : complète la fiche lead sans écraser l'agence.
          ['civilite', 'adresse', 'raisonSociale', 'siren', 'representant', 'ville'].forEach((k) => { if (!c[k] && l[k]) c[k] = l[k]; });
          if ((!c.natureLead || c.natureLead === 'personne') && (l.natureLead === 'sci' || l.natureLead === 'societe')) c.natureLead = l.natureLead;
          if (!c.budgetMin && l.budgetMin) c.budgetMin = l.budgetMin;
          if (l.statut === 'accepte' && c.statut === 'prospect') c.statut = 'actif';
        } else {
          state.clients.push({
            id: 'srv-' + l.id, serverId: l.id, serveurStatut: l.statut,
            type: l.projet === 'vendeur' ? 'vendeur' : l.projet === 'mixte' ? 'mixte' : 'acquereur',
            prenom: l.prenom || '', nom: l.nom || '', email: l.email || '', tel: l.tel || '',
            statut: l.statut === 'accepte' ? 'actif' : l.statut === 'suspendu' ? 'suspendu' : 'prospect', source: /^Fichier/.test(l.source || '') ? l.source : 'Candidature',
            autresTelephones: l.autresTelephones || [], autresEmails: l.autresEmails || [], telAVerifier: !!l.telAVerifier,
            budgetMin: l.budgetMin || 0, budgetMax: l.budgetMax || 0, quartiers: l.quartiers || [], ville: l.ville || '',
            piecesMin: l.piecesMin || 0, surfaceMin: l.surfaceMin || 0, surfaceMax: l.surfaceMax || 0, delai: l.delai || '', typeBien: l.typeBien || '',
            apport: l.apport || 0, financement: l.financement || '', courtier: !!l.courtier, bienAVendre: !!l.bienAVendre,
            notes: l.notes || '', tags: Array.isArray(l.tags) ? l.tags.slice() : [], agent: 'Gabriel Taieb', cree: l.cree || nowISO(),
            documents: l.documents || 0, documentsValides: l.documentsValides || 0,
            pipeline: l.pipeline || '', adresseBien: l.adresseBien || '', siren: l.siren || '', parcelle: l.parcelle || '', dirigeants: l.dirigeants || [],
            natureLead: l.natureLead || (l.type === 'sci' ? 'sci' : l.type === 'societe' ? 'societe' : 'personne'), civilite: l.civilite || '', adresse: l.adresse || '', raisonSociale: l.raisonSociale || '', representant: l.representant || '',
            agentId: l.agentId || null, demo: !!l.demo,
            archive: !!l.archive, archiveLe: l.archiveLe || '', archivePar: l.archivePar || ''
          });
        }
      });
      // Leads archivés : retirés des listes de travail, gardés dans « Archivés ».
      const leadsArchives = new Set(leads.filter((l) => l.archive).map((l) => l.id));
      state.archivesServeur.clients = state.clients.filter((c) => c.serverId && leadsArchives.has(c.serverId));
      state.clients = state.clients.filter((c) => !(c.serverId && leadsArchives.has(c.serverId)));

      try {
        const rag = await fetch('/api/agence', { headers: { accept: 'application/json' } });
        if (rag.ok) {
          const ag = await rag.json();
          if (ag.tauxAcquereur >= 0) BAREME.acq = Number(ag.tauxAcquereur);
          if (ag.tauxMixte >= 0) BAREME.mixte = Number(ag.tauxMixte);
          if (ag.arrondiHai > 0) BAREME.pas = Number(ag.arrondiHai);
        }
      } catch (e) { /* barème par défaut */ }
      state.biensServeur = rb.ok ? ((await rb.json()).biens || []).map(mapBienServeur) : [];
      if (rb.ok) await rattraperBiensLocaux();
      state.archivesServeur.biens = state.biensServeur.filter((b) => b.archive);
      state.biensServeur = state.biensServeur.filter((b) => !b.archive);
      try {
        const rm = await fetch('/api/messages', { headers: { accept: 'application/json' } });
        if (rm.ok) state.conversations = (await rm.json()).conversations || [];
        const rr = parseRoute();
        if (rr.name === 'messages' && rr.param) await chargerFil(leadDuFil(rr.param));
      } catch (e) { /* messagerie indisponible */ }
      state.recherchesServeur = rr.ok ? ((await rr.json()).recherches || []).map(mapRechercheServeur) : [];
      state.archivesServeur.recherches = state.recherchesServeur.filter((r) => r.archive);
      state.recherchesServeur = state.recherchesServeur.filter((r) => !r.archive);

      // Les offres réelles n'étaient jusqu'ici jamais synchronisées : la vue
      // "Offres" du CRM ne montrait que les données de démo, jamais une vraie
      // offre soumise par un acquéreur. On les fusionne comme les demandes,
      // en résolvant client/bien locaux via leurs id serveur (leadId/bienId).
      offresServeur.forEach((o) => {
        const id = 'srv-' + o.id;
        const c = state.clients.find((x) => x.serverId === o.leadId);
        const b = state.biensServeur.find((x) => x.serverId === o.bienId);
        const fresh = {
          id: id, serverId: o.id, serveur: true, clientId: c ? c.id : null, bienId: b ? b.id : o.bienId,
          montant: o.montant || 0, contre: o.contre || 0, message: o.message || '', statut: o.statut || 'en_attente', cree: o.cree || nowISO(),
          prixAffiche: o.prixAffiche || 0, montantNet: o.montantNet || 0, tauxHonoraires: o.tauxHonoraires != null ? o.tauxHonoraires : null
        };
        const existing = state.offres.find((x) => x.id === id);
        if (existing) Object.assign(existing, fresh); else state.offres.unshift(fresh);
      });

      try {
        const rbt = await fetch('/api/robot-biens', { headers: { accept: 'application/json' } });
        const rbtj = await rbt.json().catch(() => ({}));
        if (rbtj.ok && Array.isArray(rbtj.biens) && rbtj.biens.length) {
          state.robotBiens = rbtj.biens.map(normalizeRobotBien);
        }
        // dpeAuto : détections du moteur quotidien, gardées à part (voir
        // server.js, db.dpeAuto) pour ne jamais être écrasées par
        // saveRobotBiens() — state.robotBiens reste la seule chose que ce
        // client réécrit en entier.
        if (rbtj.ok && Array.isArray(rbtj.dpeAuto)) state.dpeAuto = rbtj.dpeAuto.map(normalizeRobotBien);
        if (rbtj.ok && Array.isArray(rbtj.scanLog)) state.dpeScanLog = rbtj.scanLog;
      } catch (e) { /* pas de biens radar persistés */ }
      // Indépendant des biens Radar : le Portefeuille foncier (sociétés FPMU × permis) peut exister
      // même sans aucun bien détecté — ne pas conditionner son chargement à rbtj.biens.length.
      fetch('/api/portefeuille-foncier', { credentials: 'same-origin' }).then((x) => x.json()).then((pf) => { if (pf.ok && pf.societes) { state.portefeuilleFoncier = pf.societes; } }).catch(() => {});
      try {
        const rn = await fetch('/api/notifications', { headers: { accept: 'application/json' } });
        const rnj = await rn.json().catch(() => ({}));
        if (rnj.ok && Array.isArray(rnj.traitees)) state.notificationsTraitees = rnj.traitees;
      } catch (e) { /* pas de notifications persistées */ }

      state.agenceManquants = Array.isArray(rdj.agenceManquants) ? rdj.agenceManquants : (state.agenceManquants || []);
      demandes.forEach((d) => {
        const id = 'srv-' + d.id;
        const fresh = {
          id: id, serverDemandeId: d.id, type: d.type || 'statut',
          nom: d.nom || '', email: d.email || '', tel: d.tel || (d.dossier && d.dossier.vous && d.dossier.vous.tel) || '', message: d.message || '',
          statut: d.statut || 'nouvelle',
          source: d.source || 'Espace membre', cree: d.cree || nowISO(),
          role: d.role, serveur: true,
          montant: d.montant || 0, offreId: d.offreId || null, bienId: d.bienId || null, leadId: d.leadId || d.clientId || null, bienAdresse: d.bienAdresse || '',
          creneaux: d.creneaux || [], creneauxLisibles: d.creneauxLisibles || [], note: d.note || '',
          mandat: d.mandat || null, visitePossible: d.visitePossible || null, rdv: d.rdv || null
        };
        const existing = state.demandes.find((x) => x.id === id);
        if (existing) Object.assign(existing, fresh);
        else state.demandes.unshift(fresh);
      });

      await Promise.all(leads.filter((l) => l.documents > 0).map(async (l) => {
        try {
          const r = await fetch('/api/leads/' + l.id + '/documents');
          if (r.ok) state.docsParLead[l.id] = (await r.json()).documents || [];
        } catch (e) { /* ignore */ }
      }));

      save();
      render();
    } catch (e) { /* serveur indisponible : le CRM reste utilisable */ }
  }

  function render() {
    const r = parseRoute();
    $$('.se-modal-back').forEach((m) => m.remove());

    // Un render() peut être déclenché pendant que l'agent tape un message à
    // Célia — notamment par la synchronisation serveur automatique toutes les
    // 15s (voir plus bas), qui ignore le panneau Célia car ce n'est pas un
    // `modal`. Comme le champ n'est pas resynchronisé en continu avec l'état
    // (sa valeur ne vit que dans le DOM pendant la frappe), reconstruire tout
    // le HTML effaçait ce qui était tapé et fermait le clavier mobile. On
    // capture donc sa valeur et sa position de curseur avant de reconstruire,
    // puis on les restaure sur le nouveau champ.
    const champCelia = document.querySelector('.se-celia-panel input[name="texte"]');
    const celiaAvaitFocus = !!champCelia && document.activeElement === champCelia;
    const celiaValeurVive = champCelia ? champCelia.value : null;
    const celiaSelection = champCelia ? [champCelia.selectionStart, champCelia.selectionEnd] : null;
    const champMsg = document.querySelector('.se-composer [name="texte"]');
    const msgFocus = !!champMsg && document.activeElement === champMsg;
    const msgValeur = champMsg ? champMsg.value : null;

    const views = {
      tableau: viewTableau,
      demandes: viewDemandes,
      demande: viewDemandeDetail,
      clients: viewClients,
      radar: viewRadar,
      'radar-fiche': viewRadarFiche,
      sci: viewSci,
      import: viewImport,
      // L'ancien onglet Réseau vit maintenant dans Leads › À prospecter.
      reseau: () => { state.filtres.leadType = 'prospecter'; setTimeout(() => { location.replace('#/clients'); }, 0); return ''; },
      pipeline: viewPipeline,
      notifications: viewNotifications,
      client: viewClient,
      biens: viewBiens,
      bien: viewBien,
      recherches: viewRecherches,
      recherche: viewRecherche,
      robot: viewRobotDashboard,
      'robot-radar': viewRobot,
      'robot-proprietaires': viewProprietaires,
      'robot-proprietaire': viewProprietaire,
      'portefeuille-foncier': viewPortefeuilleFoncier,
      bodacc: viewBodacc,
      'societe-fonciere': viewSocieteFonciere,
      'robot-opportunites': viewOpportunites,
      'robot-bien': viewRobotBien,
      'robot-dpe': viewRobotDpe,
      rapprochements: viewRapprochements,
      tracking: viewTracking,
      membres: viewMembres,
      'biens-club': viewBiensClub,
      visites: viewVisites,
      offres: viewOffres,
      verifications: viewVerifications,
      taches: viewTaches,
      messages: viewMessages,
      gazette: viewGazette,
      reglages: viewReglages,
      agents: viewAgents
    };

    const view = (r.name === 'messages' && r.param) ? viewThread : (views[r.name] || viewTableau);
    app().innerHTML = shell(r, view(r));
    if (r.name === 'robot-radar' && state.robotShowMap) setTimeout(initRobot, 60);
    if (r.name === 'radar' && radar.vue === 'carte') setTimeout(initRadarCarte, 60);
    if (r.name === 'radar-fiche') setTimeout(initRadarFicheCarte, 60);

    if (modal) {
      const back = document.createElement('div');
      back.className = 'se-modal-back';
      back.setAttribute('data-act', 'modal-close');
      back.innerHTML = '<div class="' + (modalLarge ? 'se-modal se-modal-xl' : 'se-modal') + '" data-stop="1">' + modal + '</div>';
      document.body.appendChild(back);
    }

    if (celiaValeurVive !== null) {
      const nouveauChampCelia = document.querySelector('.se-celia-panel input[name="texte"]');
      if (nouveauChampCelia) {
        nouveauChampCelia.value = celiaValeurVive;
        if (celiaAvaitFocus) {
          nouveauChampCelia.focus();
          try { nouveauChampCelia.setSelectionRange(celiaSelection[0], celiaSelection[1]); } catch (e) {}
        }
      }
    }

    if (msgValeur !== null) {
      const n = document.querySelector('.se-composer [name="texte"]');
      if (n) { n.value = msgValeur; if (msgFocus) n.focus(); }
    }
    const filMsg = document.querySelector('[data-fil-messages]');
    if (filMsg) filMsg.scrollTop = filMsg.scrollHeight;

    if (r.name !== lastRoute) { window.scrollTo({ top: 0 }); lastRoute = r.name; }
  }

  function nav(route, active, icon, label, badge) {
    return '<a href="#/' + route + '" class="' + (active === route ? 'active' : '') + '">' + ICONS[icon] +
      '<span>' + label + '</span>' + (badge ? '<span class="se-count">' + badge + '</span>' : '') + '</a>';
  }

  // Barre d'onglets mobile (téléphone) : une seule rangée fixe, 4 destinations
  // clés + "Plus", façon appli (ex. Appimo) — par opposition à la sidebar
  // desktop qui, elle, garde toutes les sections en détail. Le reste du CRM
  // reste accessible via moreSheet(). Hauteur fixe et prévisible (contrairement
  // à l'ancienne sidebar empilée sur mobile), ce qui permet aussi à la bulle
  // Célia de se positionner au-dessus sans jamais chevaucher un lien.
  function tab(route, active, icon, label, badge) {
    return '<a href="#/' + route + '" class="se-tab ' + (active === route ? 'active' : '') + '">' + ICONS[icon] +
      '<span>' + label + '</span>' + (badge ? '<span class="se-count">' + badge + '</span>' : '') + '</a>';
  }

  function tabbarMobile(r) {
    return '<nav class="se-tabbar">' +
      tab('tableau', r.name, 'home', 'Accueil') +
      tab('clients', r.name, 'users', 'Leads') +
      tab('pipeline', r.name, 'chat', 'Pipeline') +
      tab('biens', r.name, 'building', 'Biens') +
      '<a href="#" class="se-tab" data-act="more">' + ICONS.grid + '<span>Plus</span></a>' +
    '</nav>';
  }

  function shell(r, content) {
    const a = state.agent;
    return '<div class="se-app">' +
      '<aside class="se-side">' +
        '<a class="se-brand" href="#/tableau"><span class="se-logo">S</span><span><b>Seecret</b><small>CRM agence</small></span></a>' +
        '<div class="se-nav-scroll">' +
        '<nav class="se-nav">' +
          nav('tableau', r.name, 'home', 'Tableau de bord') +
        '</nav>' +
        '<div class="se-nav-label">Prospection</div>' +
        '<nav class="se-nav">' +
          nav('clients', r.name, 'users', 'Leads') +
          nav('biens', r.name, 'building', 'Produits') +
          nav('recherches', r.name, 'search', 'Recherches') +
          nav('radar', r.name, 'search', 'Radar') +
          nav('sci', r.name, 'building', 'SCI') +
          nav('robot', r.name, 'robot', 'Immo Data Robot', (matchings().filter((m) => m.statut === 'nouveau').length) || '') +
          nav('notifications', r.name, 'inbox', 'À prévenir', (notifications().length) || '') +
        '</nav>' +
        '<div class="se-nav-label">Le Club</div>' +
        '<nav class="se-nav">' +
          nav('demandes', r.name, 'inbox', 'Candidatures', demandesNouvelles() || '') +
          nav('membres', r.name, 'users', 'Membres') +
          nav('biens-club', r.name, 'building', 'Biens') +
          nav('gazette', r.name, 'chat', 'La Gazette') +
        '</nav>' +
        '<div class="se-nav-label">Intelligence</div>' +
        '<nav class="se-nav se-nav-more">' +
          nav('rapprochements', r.name, 'tag', 'Rapprochements') +
          nav('tracking', r.name, 'search', 'Tracking') +
        '</nav>' +
        '<div class="se-nav-label">Suivi</div>' +
        '<nav class="se-nav se-nav-more">' +
          nav('visites', r.name, 'calendar', 'Visites') +
          nav('offres', r.name, 'tag', 'Propositions', offresNouvelles() || '') +
          nav('taches', r.name, 'check', 'Tâches', tachesOuvertes().length || '') +
          nav('verifications', r.name, 'check', 'Vérifications', verifEnAttente() || '') +
          nav('messages', r.name, 'chat', 'Messages', messagesNonLus() || '') +
          nav('reglages', r.name, 'tools', 'Réglages') +
          (state.moi && state.moi.role === 'superadmin' ? nav('agents', r.name, 'users', 'Agents') : '') +
        '</nav>' +
        '<nav class="se-nav">' +
          '<a href="#" class="se-more" data-act="more">' + ICONS.grid + '<span>Plus</span></a>' +
        '</nav>' +
        '</div>' +
        '<div class="se-side-foot">' +
          '<a class="se-userchip" href="#/reglages">' +
            '<span class="se-avatar">' + esc((a.prenom.charAt(0) + a.nom.charAt(0)).toUpperCase()) + '</span>' +
            '<span><b>' + esc(a.prenom + ' ' + a.nom) + '</b><span>' + esc(a.agence) + '</span></span>' +
          '</a>' +
        '</div>' +
      '</aside>' +
      '<div class="se-main">' +
        '<div class="se-topbar">' +
          '<span class="se-crumb">CRM</span><h2>' + esc(titre(r)) + '</h2>' +
          '<span class="se-spacer"></span>' +
          '<label class="se-search-top' + (state.filtres.q ? ' actif' : '') + '">' + ICONS.search + '<input data-search placeholder="Rechercher un client, un bien…" value="' + esc(state.filtres.q || '') + '"/>' + (state.filtres.q ? '<button type="button" class="se-search-effacer" data-act="recherche-effacer" aria-label="Effacer la recherche">×</button>' : '') + '</label>' +
          '<a class="se-btn ghost sm" href="espace.html">Espace membre</a>' +
        '</div>' +
        '<div class="se-view">' + content + '</div>' +
      '</div>' +
    '</div>' +
    tabbarMobile(r) +
    celiaWidget();
  }

  function titre(r) {
    const map = { tableau: 'Tableau de bord', demandes: 'Candidatures', demande: 'Fiche demande', clients: 'Leads', import: 'Import clients', radar: 'Radar', 'radar-fiche': 'Fiche Radar', sci: 'SCI', reseau: 'Réseau', pipeline: 'Pipeline de relance', notifications: 'À prévenir', client: 'Fiche lead', biens: 'Produits', bien: 'Fiche produit', recherches: 'Recherches', recherche: 'Recherche', robot: 'Immo Data Robot', 'robot-radar': 'Radar — Biens détectés', 'robot-opportunites': 'Opportunités Clients', 'robot-bien': 'Fiche bien Radar', 'robot-dpe': 'Recherche DPE', 'robot-proprietaires': 'Propriétaires', 'robot-proprietaire': 'Fiche propriétaire', 'portefeuille-foncier': 'Portefeuille foncier', 'societe-fonciere': 'Fiche société', bodacc: 'Signaux BODACC', membres: 'Membres', 'biens-club': 'Biens du club', rapprochements: 'Rapprochements', tracking: 'Tracking', visites: 'Visites', offres: 'Propositions → Offres', verifications: 'Vérifications', taches: 'Tâches', messages: 'Messages', reglages: 'Réglages', agents: 'Agents' };
    return map[r.name] || 'CRM';
  }

  function offresNouvelles() {
    return state.offres.filter((o) => o.statut === 'recue' || o.statut === 'en_attente').length;
  }

  function verifEnAttente() {
    return (state.tachesVerif || []).filter((t) => t.statut === 'en_attente').length;
  }

  function head(kicker, title, text, actions) {
    return '<div class="se-view-head"><div><p class="kicker" style="margin:0;color:var(--color-taupe)">' + esc(kicker) + '</p>' +
      '<h1>' + title + '</h1>' + (text ? '<p>' + text + '</p>' : '') + '</div>' +
      (actions ? '<div class="se-actions">' + actions + '</div>' : '') + '</div>';
  }

  function badgeBien(s) {
    const st = ST_BIEN[s] || ST_BIEN.brouillon;
    return '<span class="se-badge ' + st.cls + '">' + st.label + '</span>';
  }
  function badgeClient(s) {
    const st = ST_CLIENT[s] || ST_CLIENT.prospect;
    return '<span class="se-badge ' + st.cls + '">' + st.label + '</span>';
  }

  // Température d'un client (chaud/tiède/froid) : un repère visuel rapide
  // pour savoir qui relancer en priorité, basé sur des signaux déjà présents
  // dans le CRM plutôt qu'une case à cocher de plus à remplir à la main :
  //   - une offre en cours (ni refusée ni retirée) : signal d'achat fort
  //   - une visite récente (< 14 jours) ou à venir : intérêt concret
  //   - financement avancé (apport renseigné, courtier, ou financement défini)
  //   - une urgence déclarée dans le champ « délai »
  //   - l'ancienneté depuis le dernier contact (activité, visite, offre ou
  //     demande la plus récente — à défaut, la date de création du dossier)
  // Un dossier archivé n'affiche pas de température : ce n'est plus un sujet
  // à relancer. Ce n'est qu'un indice, pas un jugement — l'agent reste juge.
  function temperatureClient(c) {
    if (!c || c.statut === 'archive') return null;
    const activites = (state.activites || []).filter((a) => a.leadId === c.serverId);
    const visites = (state.visites || []).filter((v) => v.clientId === c.id);
    const offres = (state.offres || []).filter((o) => o.clientId === c.id);
    const demandes = (state.demandes || []).filter((d) => d.clientId === c.id);
    const dates = []
      .concat(activites.map((a) => a.at))
      .concat(visites.map((v) => v.date))
      .concat(offres.map((o) => o.cree))
      .concat(demandes.map((d) => d.cree))
      .filter(Boolean);
    const dernierContact = dates.length ? dates.slice().sort().slice(-1)[0] : c.cree;
    const joursDepuis = dernierContact ? Math.floor((Date.now() - new Date(dernierContact).getTime()) / 86400000) : 999;

    let score = 0;
    if (offres.some((o) => o.statut !== 'refusee')) score += 3;
    if (visites.some((v) => v.date && Math.abs(new Date(v.date).getTime() - Date.now()) <= 14 * 86400000)) score += 2;
    if (c.type !== 'vendeur' && (c.courtier || Number(c.apport) > 0 || c.financement)) score += 1;
    if (/imm[eé]diat|urgent|asap|1\s*mois/i.test(c.delai || '')) score += 2;
    if (c.statut === 'client') score += 1;

    if (score >= 3 || joursDepuis <= 2) return 'chaud';
    if (score >= 1 || joursDepuis <= 14) return 'tiede';
    return 'froid';
  }
  const TEMP_CLIENT = {
    chaud: { label: 'Chaud', cls: 'temp-chaud' },
    tiede: { label: 'Tiède', cls: 'temp-tiede' },
    froid: { label: 'Froid', cls: 'temp-froid' }
  };
  function badgeTemperature(c) {
    const t = temperatureClient(c);
    if (!t) return '';
    const st = TEMP_CLIENT[t];
    return '<span class="se-badge ' + st.cls + '" title="Température du dossier — basée sur l’activité récente, les offres et visites, et l’urgence déclarée.">' + st.label + '</span>';
  }
  // Les clients/biens de démo (seedés côté serveur pour peupler la plateforme
  // avant les premières vraies candidatures) restent visuellement distincts
  // de vrais clients, pour qu'un agent ne les traite jamais comme réels.
  function badgeDemo(o) {
    return (o && o.demo) ? '<span class="se-badge warn" title="Donnée de démonstration, pas un vrai client/bien — à purger quand la plateforme aura ses premières vraies candidatures.">Démo</span>' : '';
  }
  function scoreTag(v) {
    const cls = v >= 70 ? '' : v >= 45 ? 'mid' : 'low';
    return '<span class="se-score ' + cls + '"><span class="se-score-bar"><i style="width:' + v + '%"></i></span>' + v + ' %</span>';
  }
  function photo(b) {
    const p = b.photos && b.photos.length ? b.photos[0] : null;
    return p ? (/^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p) : '';
  }

  function mapBienServeur(b) {
    const lead = state.clients.find((c) => c.serverId === b.leadId);
    return {
      id: 'srv-b-' + b.id, serverId: b.id, leadId: b.leadId || null, lat: b.lat || null, lon: b.lon || null,
      ref: (b.id || '').slice(0, 6).toUpperCase(),
      titre: b.titre || 'Bien sans titre', adresse: b.adresse || '', ville: b.ville || '', codePostal: b.codePostal || '',
      type: b.type || 'Appartement', quartier: b.quartier || '',
      surface: b.surface || 0, pieces: b.pieces || 0, chambres: b.chambres || 0, sdb: b.sdb || 0,
      etage: etageSaisie(b.etage), dpe: b.dpe || '', ges: b.ges || '', etat: b.etat || '', anneeConstruction: b.anneeConstruction || null, prix: b.prix || 0, charges: b.charges || 0,
      tauxHonoraires: (b.tauxHonoraires === null || b.tauxHonoraires === undefined) ? null : b.tauxHonoraires,
      historiquePrix: Array.isArray(b.historiquePrix) ? b.historiquePrix : [],
      ascenseur: !!b.ascenseur, exterieur: b.exterieur || '', surfaceExterieur: b.surfaceExterieur || 0,
      delai: b.delai || '', dejaEnVente: b.dejaEnVente || '', motif: b.motif || '',
      statut: b.statut || 'brouillon', etapeProposition: b.etapeProposition || '', proprietaireId: lead ? lead.id : null,
      photos: b.photos || [], description: b.description || '',
      coupDeCoeur: b.coupDeCoeur || '', editorial: b.editorial || null, video: b.video || null, videoVerticale: b.videoVerticale || null, visite: b.visite || null, panoramas: b.panoramas || [], venduParAgence: b.venduParAgence === true ? true : (b.venduParAgence === false ? false : null),
      atouts: b.atouts || b.annexes || [], annexes: b.annexes || [], mandat: { type: 'simple', fin: '' }, cree: b.cree || nowISO(),
      exclusivite: b.exclusivite || { statut: 'scan_en_cours', liens: [] },
      validation: b.validation || 'en_attente', surSeecret: b.surSeecret !== false,
      serveur: true, email: b.email || '', demo: !!b.demo,
      refAgence: b.refAgence || '', nomProprio: b.nom || '', source: b.source || '', sourceFichier: b.sourceFichier || '', importLot: b.importLot || '',
      archive: !!b.archive, archiveLe: b.archiveLe || '', archivePar: b.archivePar || '',
      notesLibres: b.notesLibres || '', suiviAgence: b.suiviAgence || null, details: b.details || null, mandatOrigine: b.mandatOrigine || null, accesVisites: b.accesVisites || '', verifs: b.verifs || null
    };
  }

  function mapRechercheServeur(r) {
    const c = state.clients.find((x) => x.serverId === r.clientId);
    return {
      id: 'srv-r-' + r.id, serverId: r.id, clientId: c ? c.id : r.clientId,
      archive: !!r.archive, archiveLe: r.archiveLe || '', archivePar: r.archivePar || '',
      titre: r.titre || 'Recherche', type: r.type || '', types: r.types || [],
      prixMin: r.prixMin || 0, prixMax: r.prixMax || 0, piecesMin: r.piecesMin || 0, chambresMin: r.chambresMin || 0, sdbMin: r.sdbMin || 0, surfaceMin: r.surfaceMin || 0, surfaceMax: r.surfaceMax || 0, dernierEtageOk: !!r.dernierEtageOk, delai: r.delai || '',
      apport: r.apport || 0, financement: r.financement || '', courtier: !!r.courtier, bienAVendre: !!r.bienAVendre,
      etageMin: r.etageMin || 0, etageMax: r.etageMax || 0, etat: r.etat || '', dpe: r.dpe || '', epoque: r.epoque || '', annexes: r.annexes || [], prixVenteEstime: r.prixVenteEstime || 0,
      quartiers: r.quartiers || [], statut: r.statut || 'active', alertes: true,
      cree: r.cree || nowISO(), serveur: true
    };
  }

  function badgeExclusivite(b) {
    const ex = (b && b.exclusivite) || { statut: 'scan_en_cours' };
    if (ex.statut === 'verifie_exclusif') return '<span class="se-badge open">Vérifié exclusif</span>';
    if (ex.statut === 'alerte_doublon') return '<span class="se-badge" style="background:var(--color-alert-soft);color:var(--color-alert)">Alerte doublon</span>';
    return '<span class="se-badge warn">Scan en cours…</span>';
  }

  function badgeValidation(b) {
    if (b && b.validation === 'valide') return '<span class="se-badge open">Bien validé</span>';
    return '<span class="se-badge warn">Bien en attente</span>';
  }

  /* ================================ écrans ================================ */

  /* ------------------------------ tableau de bord ------------------------- */

  // --- Tableau de bord Jour/Semaine (étape 6 du plan de fusion) ---------------
  // Mêmes 4 compteurs (candidatures, biens entrés, visites faites, propositions)
  // affichés en valeur du jour ou en delta vs la période précédente ; les blocs
  // "Au long cours" (volumétrie totale) et "La prospection" (funnel Réseau)
  // n'apparaissent qu'en vue Semaine, comme demandé par le plan de fusion.
  function debutJourDecale(offsetJours) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetJours);
    return d;
  }
  function dansPeriode(dateStr, debut, fin) {
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    return !isNaN(t) && t >= debut.getTime() && t < fin.getTime();
  }
  function compteursPeriode(debut, fin) {
    const biens = (state.biensServeur || []).concat(state.biens);
    return {
      candidatures: state.demandes.filter((d) => d.type === 'candidature' && dansPeriode(d.cree, debut, fin)).length,
      biensEntres: biens.filter((b) => dansPeriode(b.cree, debut, fin)).length,
      visitesFaites: state.visites.filter((v) => v.statut === 'realisee' && dansPeriode(v.date, debut, fin)).length,
      propositions: state.offres.filter((o) => dansPeriode(o.cree, debut, fin)).length
    };
  }
  function deltaHtml(actuel, precedent) {
    const d = actuel - precedent;
    if (d === 0) return '<span class="se-hint">= vs semaine préc.</span>';
    return '<span class="se-hint" style="color:' + (d > 0 ? '#1E4038' : '#b42318') + '">' + (d > 0 ? '+' : '') + d + ' vs semaine préc.</span>';
  }
  function carteCompteurPeriode(kicker, valeur, sousTexteJour, deltaTexte, periode) {
    return '<div class="se-card se-stat"><span class="se-kicker">' + kicker + '</span><span class="se-num">' + valeur + '</span><span class="se-sub">' + (periode === 'jour' ? sousTexteJour : deltaTexte) + '</span></div>';
  }
  function blocTableauPeriode() {
    const periode = state.filtres.periodeTableau === 'semaine' ? 'semaine' : 'jour';
    const debutJour = debutJourDecale(0), finJour = debutJourDecale(1);
    const debutSemaine = debutJourDecale(-6), finSemaine = debutJourDecale(1);
    const debutSemainePrec = debutJourDecale(-13);
    const cJour = compteursPeriode(debutJour, finJour);
    const cSemaine = compteursPeriode(debutSemaine, finSemaine);
    const cSemainePrec = compteursPeriode(debutSemainePrec, debutSemaine);
    const c = periode === 'jour' ? cJour : cSemaine;
    const biensTotal = (state.biensServeur || []).concat(state.biens);
    const clientsReseau = state.clients.filter((cl) => cl.type === 'vendeur' || cl.type === 'mixte' || cl.pipeline);
    const prisesDeContact = clientsReseau.filter((cl) => cl.pipeline && cl.pipeline !== 'a_contacter').length;
    const reponsesObtenues = clientsReseau.filter((cl) => cl.pipeline === 'a_relancer' || cl.pipeline === 'converti' || cl.pipeline === 'ecarte').length;
    const conversions = clientsReseau.filter((cl) => cl.pipeline === 'converti').length;
    return '<div class="se-card" style="margin-bottom:18px">' +
      '<div class="se-row" style="justify-content:space-between;margin-bottom:12px">' +
        '<h3>' + (periode === 'jour' ? 'Aujourd’hui' : 'Cette semaine') + '</h3>' +
        '<div class="se-tabs" style="margin:0">' +
          '<a href="#" data-act="filtre" data-id="periodeTableau:jour" class="' + (periode === 'jour' ? 'active' : '') + '">Jour</a>' +
          '<a href="#" data-act="filtre" data-id="periodeTableau:semaine" class="' + (periode === 'semaine' ? 'active' : '') + '">Semaine</a>' +
        '</div>' +
      '</div>' +
      '<div class="se-grid cols-4">' +
        carteCompteurPeriode('Candidatures', c.candidatures, 'aujourd’hui', deltaHtml(cSemaine.candidatures, cSemainePrec.candidatures), periode) +
        carteCompteurPeriode('Biens entrés', c.biensEntres, 'aujourd’hui', deltaHtml(cSemaine.biensEntres, cSemainePrec.biensEntres), periode) +
        carteCompteurPeriode('Visites faites', c.visitesFaites, 'aujourd’hui', deltaHtml(cSemaine.visitesFaites, cSemainePrec.visitesFaites), periode) +
        carteCompteurPeriode('Propositions', c.propositions, 'aujourd’hui', deltaHtml(cSemaine.propositions, cSemainePrec.propositions), periode) +
      '</div>' +
      (periode === 'semaine'
        ? '<div class="se-split" style="margin-top:16px">' +
            '<div class="se-card"><h3>Au long cours</h3><div class="se-grid cols-2" style="margin-top:10px;gap:10px">' +
              '<div class="se-card se-stat"><span class="se-kicker">Clients au book</span><span class="se-num">' + state.clients.length + '</span></div>' +
              '<div class="se-card se-stat"><span class="se-kicker">Biens au catalogue</span><span class="se-num">' + biensTotal.length + '</span></div>' +
              '<div class="se-card se-stat"><span class="se-kicker">Mandats convertis</span><span class="se-num">' + conversions + '</span></div>' +
              '<div class="se-card se-stat"><span class="se-kicker">Offres acceptées</span><span class="se-num">' + state.offres.filter((o) => o.statut === 'acceptee').length + '</span></div>' +
            '</div></div>' +
            '<div class="se-card"><h3>La prospection</h3><div class="se-grid cols-2" style="margin-top:10px;gap:10px">' +
              '<div class="se-card se-stat"><span class="se-kicker">Relances envoyées</span><span class="se-num">' + prisesDeContact + '</span><span class="se-sub">Réseau</span></div>' +
              '<div class="se-card se-stat"><span class="se-kicker">Réponses obtenues</span><span class="se-num">' + reponsesObtenues + '</span></div>' +
              '<div class="se-card se-stat"><span class="se-kicker">Prises de contact</span><span class="se-num">' + prisesDeContact + '</span></div>' +
              '<div class="se-card se-stat"><span class="se-kicker">Convertis</span><span class="se-num">' + conversions + '</span></div>' +
            '</div></div>' +
          '</div>'
        : '');
  }

  // ---- Tableau de bord : la journée de l'agent, par ordre de priorité ----
  // Une seule liste, chaque ligne mène à la page où l'on agit.
  // Priorité 1 « À faire tout de suite », 2 « Aujourd'hui », 3 « Relances »,
  // 4 « Opportunités », 5 « À venir ».
  function matchCle(b, c) { return (b.serverId || b.id) + '|' + (c.serverId || c.id); }
  function matchsAProposer() {
    const faits = state.matchsProposes || {};
    const tousBiens = (state.biensServeur || []).concat(state.biens);
    const recherches = (state.recherchesServeur || []).concat(state.recherches);
    const out = []; const vus = {};
    recherches.forEach((r) => {
      const c = client(r.clientId);
      if (!c || c.type === 'vendeur') return;
      tousBiens.filter((b) => b.statut === 'avant-premiere' || b.statut === 'ouvert').forEach((b) => {
        const k = matchCle(b, c);
        if (vus[k] || faits[k] || !correspond(b, c)) return;
        const score = scoreBien(b, c);
        if (score >= 70) { vus[k] = 1; out.push({ bien: b, client: c, score: score }); }
      });
    });
    return out.sort((a, b) => b.score - a.score);
  }
  function journeeAgent() {
    const items = [];
    const auj = new Date(); auj.setHours(0, 0, 0, 0);
    const demain = new Date(auj.getTime() + 86400000);
    const dans7 = new Date(auj.getTime() + 8 * 86400000);
    const jour = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const add = (o) => items.push(o);
    const clientDe = (d) => d.clientId ? client(d.clientId) : (d.leadId ? state.clients.find((x) => x.serverId === d.leadId) : null);

    // Visites
    visitesAVenir().forEach((v) => {
      const b = bien(v.bienId); const c = client(v.clientId); const d = jour(v.date);
      const qui = nomClient(c) + (b ? ' · ' + (b.titre || '') : '');
      if (d < auj) add({ prio: 1, cat: 'visite', titre: 'Visite passée à clôturer', detail: dCourt(v.date) + ' · ' + qui, lien: '#/visites', quand: v.date });
      else if (d.getTime() === auj.getTime()) add({ prio: 1, cat: 'visite', titre: 'Visite aujourd’hui à ' + (v.heure || '—'), detail: qui + (v.statut !== 'confirmee' ? ' · pas encore confirmée' : ''), lien: '#/visites', quand: v.date + 'T' + (v.heure || '00:00') });
      else if (d < dans7) add({ prio: v.statut === 'confirmee' ? 5 : 2, cat: 'visite', titre: (v.statut === 'confirmee' ? 'Visite le ' : 'Visite à confirmer le ') + dCourt(v.date) + ' à ' + (v.heure || '—'), detail: qui, lien: '#/visites', quand: v.date });
    });
    // Demandes venues de la plateforme
    state.demandes.filter((d) => d.statut === 'nouvelle').forEach((d) => {
      const c = clientDe(d); const b = d.bienId ? bienParServeur(d.bienId) : null;
      const nom = d.nom || (c ? nomClient(c) : 'Visiteur');
      const lien = '#/demande/' + d.id;
      if (d.type === 'visite') add({ prio: 1, cat: 'demande', titre: 'Demande de visite à traiter', detail: nom + (b ? ' · ' + b.titre : '') + (d.mandat && d.mandat.statut === 'signe' ? ' · mandat signé' : ' · mandat de recherche à signer'), lien: lien, quand: d.cree });
      else if (d.type === 'offre') add({ prio: 1, cat: 'demande', titre: 'Offre reçue', detail: nom + (b ? ' · ' + b.titre : ''), lien: lien, quand: d.cree });
      // Une candidature est la porte d'entrée du club : toujours en tête de « À faire tout de suite ».
      else if (d.type === 'candidature') add({ prio: 1, score: 100, cat: 'demande', titre: 'Nouvelle candidature à valider', detail: nom + (d.cree ? ' · reçue ' + (Date.now() - new Date(d.cree).getTime() < 864e5 ? 'aujourd’hui' : 'le ' + dCourt(d.cree)) : ''), lien: lien, quand: d.cree });
      else if (d.type === 'modification' || d.type === 'statut') add({ prio: 2, cat: 'modif', titre: d.type === 'statut' ? 'Demande de changement de statut' : 'Demande de modification d’un bien', detail: nom + (b ? ' · ' + b.titre : ''), lien: lien, quand: d.cree });
      else add({ prio: 2, cat: 'demande', titre: 'Nouveau message depuis la plateforme', detail: nom + (d.message ? ' · « ' + String(d.message).slice(0, 70) + ' »' : ''), lien: lien, quand: d.cree });
    });
    // Offres en cours
    state.offres.filter((o) => o.statut === 'recue' || o.statut === 'en_attente' || o.statut === 'contre').forEach((o) => {
      const b = bien(o.bienId); const c = client(o.clientId);
      add({ prio: 1, cat: 'demande', titre: o.statut === 'contre' ? 'Contre-offre en attente' : 'Offre à présenter au vendeur', detail: nomClient(c) + (b ? ' · ' + b.titre : '') + (o.montant ? ' · ' + euro(o.montant) : ''), lien: '#/offres', quand: o.date || o.cree });
    });
    // Messages des membres non lus
    (state.conversations || []).filter((c) => c.nonLus).forEach((c) => add({ prio: 2, cat: 'demande', titre: c.nonLus + ' message' + (c.nonLus > 1 ? 's' : '') + ' non lu' + (c.nonLus > 1 ? 's' : ''), detail: c.nom + (c.dernier ? ' · « ' + String(c.dernier.texte || '').slice(0, 70) + ' »' : ''), lien: '#/messages/' + c.leadId, quand: c.dernier && c.dernier.at }));
    // Pièces à vérifier
    Object.keys(state.docsParLead || {}).forEach((sid) => {
      const n = (state.docsParLead[sid] || []).filter((d) => d.statut === 'a_verifier').length;
      if (!n) return;
      const c = state.clients.find((x) => x.serverId === sid);
      add({ prio: 2, cat: 'demande', titre: n > 1 ? n + ' pièces à vérifier' : 'Pièce à vérifier', detail: c ? nomClient(c) : 'Membre', lien: c ? '#/client/' + c.id : '#/notifications', quand: null });
    });
    // Produits à valider (le vendeur attend la mise en ligne)
    (state.biensServeur || []).filter((b) => b.statut === 'a_valider').forEach((b) => add({ prio: 2, cat: 'modif', titre: 'Bien à valider pour la mise en ligne', detail: (b.titre || b.adresse || 'Bien') + (b.proprietaireId ? ' · ' + nomClient(client(b.proprietaireId)) : ''), lien: '#/bien/' + b.id, quand: b.cree }));
    // Tâches
    tachesOuvertes().forEach((t) => {
      const c = t.clientId ? client(t.clientId) : null;
      const e = t.echeance ? jour(t.echeance) : null;
      const lien = c ? '#/client/' + c.id : '#/taches';
      if (e && e < auj) add({ prio: 1, cat: 'tache', titre: t.titre, detail: 'En retard depuis le ' + dCourt(t.echeance) + (c ? ' · ' + nomClient(c) : ''), lien: lien, quand: t.echeance });
      else if (e && e < demain) add({ prio: 2, cat: 'tache', titre: t.titre, detail: 'Aujourd’hui' + (c ? ' · ' + nomClient(c) : ''), lien: lien, quand: t.echeance });
      else if (e && e < dans7) add({ prio: 5, cat: 'tache', titre: t.titre, detail: 'Le ' + dCourt(t.echeance) + (c ? ' · ' + nomClient(c) : ''), lien: lien, quand: t.echeance });
      else if (!e) add({ prio: 4, cat: 'tache', titre: t.titre, detail: 'Sans échéance' + (c ? ' · ' + nomClient(c) : ''), lien: lien, quand: null });
    });
    // Relances
    state.clients.forEach((c) => {
      if (cadenceDue(c)) add({ prio: 3, cat: 'relance', titre: 'Relance à envoyer', detail: nomClient(c) + ' · ' + (cadenceLabel(c) || 'cadence due'), lien: '#/client/' + c.id, quand: c.cadence && c.cadence.prochaine });
      else if (c.pipeline === 'a_relancer') add({ prio: 3, cat: 'relance', titre: 'Lead à relancer', detail: nomClient(c) + (c.adresseBien ? ' · ' + c.adresseBien : ''), lien: '#/client/' + c.id, quand: c.cree });
    });
    // Matchs pas encore proposés
    matchsAProposer().slice(0, 15).forEach((m) => add({ prio: 4, cat: 'match', titre: 'Proposer ' + (m.bien.titre || 'un bien') + ' à ' + nomClient(m.client), detail: 'Correspondance ' + m.score + ' % · ' + euro(m.bien.prix), lien: '#/rapprochements', quand: null, score: m.score }));

    const ordreQuand = (x) => (x.quand ? new Date(x.quand).getTime() : 9e15);
    return items.sort((a, b) => a.prio - b.prio || (b.score || 0) - (a.score || 0) || ordreQuand(a) - ordreQuand(b));
  }
  const JOURNEE_SECTIONS = [[1, 'À faire tout de suite'], [2, 'Aujourd’hui'], [3, 'Relances'], [4, 'Opportunités'], [5, 'Cette semaine']];
  const JOURNEE_CATS = { visite: ['Visites', 'calendar'], demande: ['Demandes', 'inbox'], modif: ['Modifications', 'building'], tache: ['Tâches', 'check'], relance: ['Relances', 'chat'], match: ['Matchs', 'tag'] };
  function viewTableau() {
    const items = journeeAgent();
    const filtre = state.filtres.journee || '';
    const vus = filtre ? items.filter((x) => x.cat === filtre) : items;
    const compte = (cat) => items.filter((x) => x.cat === cat).length;
    const urgents = items.filter((x) => x.prio === 1).length;
    const dateJour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const ligne = (x) => {
      const ic = JOURNEE_CATS[x.cat] || ['', 'check'];
      return '<a class="se-journee-ligne p' + x.prio + '" href="' + x.lien + '"><span class="se-journee-ico">' + (ICONS[ic[1]] || '') + '</span>' +
        '<span class="se-journee-txt"><b>' + esc(x.titre) + '</b><span>' + esc(x.detail || '') + '</span></span>' +
        '<span class="se-journee-cat">' + esc(ic[0]) + '</span><span class="se-journee-fleche" aria-hidden="true">›</span></a>';
    };
    return head('Bonjour ' + state.agent.prenom, dateJour.charAt(0).toUpperCase() + dateJour.slice(1),
        items.length ? (urgents ? urgents + ' chose' + (urgents > 1 ? 's' : '') + ' à faire tout de suite, ' : '') + items.length + ' au total, de la plus urgente à la moins urgente. Cliquez sur une ligne pour agir.' : 'Rien à traiter pour l’instant.', '') +
      '<div class="se-journee-filtres">' +
        '<a href="#" data-act="filtre" data-id="journee:" class="' + (filtre ? '' : 'actif') + '">Tout <span>' + items.length + '</span></a>' +
        Object.keys(JOURNEE_CATS).map((k) => compte(k) ? '<a href="#" data-act="filtre" data-id="journee:' + k + '" class="' + (filtre === k ? 'actif' : '') + '">' + JOURNEE_CATS[k][0] + ' <span>' + compte(k) + '</span></a>' : '').join('') +
      '</div>' +
      (vus.length ? JOURNEE_SECTIONS.map(([p, titre]) => {
        const l = vus.filter((x) => x.prio === p);
        return l.length ? '<section class="se-journee-section"><h3 class="se-journee-titre p' + p + '">' + titre + ' <span>' + l.length + '</span></h3><div class="se-journee-liste">' + l.slice(0, p === 4 ? 12 : 60).map(ligne).join('') +
          (p === 4 && l.length > 12 ? '<a class="se-journee-plus" href="#/rapprochements">Voir les ' + l.length + ' opportunités →</a>' : '') + '</div></section>' : '';
      }).join('') : '<div class="se-card se-empty"><div class="se-empty-title">Tout est à jour</div><p>Aucune demande, tâche ou relance en attente.</p></div>') +
      '<details class="se-journee-stats"><summary>Activité de la période</summary>' + blocTableauPeriode() + '</details>';
  }

  /* -------------------------------- demandes ------------------------------ */

  function mailItem(d) {
    const meta = DEMANDE[d.type] || DEMANDE.info;
    const b = d.bienId ? bienParServeur(d.bienId) : null;
    const n = d.statut === 'nouvelle';
    const badgeStatut = d.statut === 'refusee' ? '<span class="se-badge muted">Refusée</span>' : d.statut === 'suspendue' ? '<span class="se-badge warn">Suspendue</span>' : n ? '<span class="se-badge warn">Nouvelle</span>' : '<span class="se-badge open">Validée</span>';
    // Pour une demande de modification, l'agent doit pouvoir modifier le bien,
    // valider ou refuser directement depuis cette carte — sans passer par la
    // fiche détaillée (c'est précisément ce qui manquait : avant, seuls les
    // boutons génériques « Accepter/Refuser l'adhésion » apparaissaient ici,
    // sans rapport avec une modification de bien).
    const actionsModif = ((d.type === 'modification' || d.type === 'statut') && n)
      ? '<button class="se-btn sm" data-act="demande-modif-editer" data-id="' + d.id + '">' + (d.type === 'statut' ? 'Voir le bien' : 'Modifier le bien') + '</button>' +
        '<button class="se-btn soft sm" data-act="demande-modif-valider" data-id="' + d.id + '">Valider</button>' +
        '<button class="se-btn ghost sm" data-act="demande-modif-refuser" data-id="' + d.id + '">Refuser</button>'
      : '';
    return '<div class="se-mail' + (n ? ' neuf' : '') + '">' +
      '<span class="se-mail-ico">' + ICONS[meta.icon] + '</span>' +
      '<div class="se-mail-body">' +
        '<b>' + esc(meta.label) + ' — ' + esc(d.nom || 'Visiteur') + '</b>' +
        '<p>' + esc(d.message || '') + (b ? ' <span class="se-hint">· ' + esc(b.titre) + '</span>' : '') + '</p>' +
        '<div class="se-mail-actions" style="margin-top:8px;flex-wrap:wrap;gap:6px">' +
          actionsModif +
          (d.type === 'visite' && n ? badgeMandat(d) : '') +
          '<button class="se-btn ghost sm" data-act="demande-ouvrir" data-id="' + d.id + '">Voir la fiche</button>' +
          badgeStatut +
        '</div>' +
      '</div>' +
      '<span class="se-mail-meta">' + esc(d.source || '') + '<br/>' + ilYa(d.cree) + '</span>' +
    '</div>';
  }

  function viewDemandes() {
    const filtre = state.filtres.demandes || 'toutes';
    const cat = (d) => {
      if (d.statut === 'refusee') return 'refusees';
      if (d.type === 'candidature') return 'candidatures';
      if (d.type === 'statut') return 'statuts';
      if (d.type === 'modification' && d.role === 'prix') return 'prix';
      if (d.type === 'modification') return 'statuts';
      return 'autres';
    };
    const list = state.demandes.filter((d) => filtre === 'toutes' ? true : cat(d) === filtre);
    const count = (f) => state.demandes.filter((d) => f === 'toutes' ? true : cat(d) === f).length;
    return head('Boîte de réception', 'Demandes',
      'Candidatures, changements de statut et de prix : tout ce qui entre dans l’agence.', '') +
      '<div class="se-tabs">' +
        tabDem('toutes', 'Toutes', state.demandes.length, filtre) +
        tabDem('candidatures', 'Candidatures', count('candidatures'), filtre) +
        tabDem('statuts', 'Statut', count('statuts'), filtre) +
        tabDem('prix', 'Prix', count('prix'), filtre) +
        tabDem('refusees', 'Refusées', count('refusees'), filtre) +
      '</div>' +
      '<div class="se-inbox">' + (list.length ? list.map(mailItem).join('') : '<div class="se-card se-empty"><div class="se-empty-title">Aucune demande</div><p>Cette catégorie est vide.</p></div>') + '</div>';
  }

  function whatsappHref(tel, prenom, lien) {
    const msg = 'Bonjour ' + prenom + ', bonne nouvelle ! Votre demande a été validée par l\'agence Seecret. Connectez-vous pour découvrir le marché : ' + lien;
    return 'https://wa.me/' + String(tel || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(msg);
  }

  // Confirmation affichée après CHAQUE action de validation/refus côté CRM
  // (pièce, adhésion, bien, offre, modification…) : le serveur a déjà déposé
  // le même message dans l'espace du client et tenté l'email ; ici on ne fait
  // que proposer, à l'agent, d'envoyer AUSSI un WhatsApp — jamais automatique,
  // seul un clic humain sur le bouton déclenche l'ouverture de wa.me.
  function notifieModal(notif, titre) {
    const tel = notif && notif.tel ? String(notif.tel).replace(/[^0-9]/g, '') : '';
    const wa = tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(notif.waMessage || notif.message || '') : '';
    return '<h3>' + esc(titre) + '</h3>' +
      '<p class="se-muted">Le client a été prévenu par email, et le même message l’attend dans son espace à la reconnexion.' + (tel ? '' : ' Pas de numéro de téléphone enregistré : pas de WhatsApp possible.') + '</p>' +
      '<div class="se-modal-foot" style="justify-content:flex-start;gap:8px">' +
        (wa ? '<a class="se-btn soft" target="_blank" rel="noopener" href="' + wa + '">Envoyer aussi par WhatsApp</a>' : '') +
        '<button class="se-btn ghost" type="button" data-act="modal-close">Fermer</button>' +
      '</div>';
  }

  function ouvrirNotifieModal(notif, titre) {
    if (!notif) return;
    modal = notifieModal(notif, titre);
    render();
  }

  function tabDem(id, label, n, cur) {
    return '<a href="#" data-act="filtre" data-id="demandes:' + id + '" class="' + (cur === id ? 'active' : '') + '">' + label + '<span>' + n + '</span></a>';
  }

  const COORDS_CRM = {
    p1: [48.859, 2.341], p2: [48.867, 2.341], p3: [48.863, 2.361], p4: [48.855, 2.355], p5: [48.846, 2.347],
    p6: [48.851, 2.332], p7: [48.857, 2.320], p8: [48.873, 2.309], p9: [48.877, 2.335], p10: [48.874, 2.357],
    p11: [48.858, 2.379], p12: [48.840, 2.388], p13: [48.829, 2.356], p14: [48.833, 2.327], p15: [48.842, 2.293],
    p16: [48.862, 2.276], p17: [48.885, 2.321], p18: [48.892, 2.344], p19: [48.883, 2.382], p20: [48.866, 2.398],
    boulogne: [48.835, 2.241], neuilly: [48.884, 2.268], vincennes: [48.848, 2.438]
  };

  function joursEnLigne(b) {
    if (!b || !b.cree) return 0;
    return Math.floor((Date.now() - new Date(b.cree).getTime()) / 86400000);
  }

  function prixMoyenM2() {
    const biens = ((state.biensServeur || []).concat(state.biens)).filter((b) => b.surface > 0 && b.prix > 0);
    if (!biens.length) return 0;
    return Math.round(biens.reduce((s, b) => s + b.prix / b.surface, 0) / biens.length);
  }

  function tensionQuartiers() {
    const map = {};
    ((state.biensServeur || []).concat(state.biens)).forEach((b) => {
      const q = b.quartier;
      if (!q || !COORDS_CRM[q]) return;
      map[q] = map[q] || { offres: 0, demandes: 0 };
      map[q].offres++;
    });
    ((state.recherchesServeur || []).concat(state.recherches)).forEach((r) => {
      (r.quartiers || []).forEach((q) => {
        if (!COORDS_CRM[q]) return;
        map[q] = map[q] || { offres: 0, demandes: 0 };
        map[q].demandes++;
      });
    });
    return map;
  }

  function opportunites() {
    const out = [];
    const tousBiens = (state.biensServeur || []).concat(state.biens);
    const pm2 = prixMoyenM2();
    tousBiens.forEach((b) => {
      if (b.statut === 'vendu' || b.statut === 'brouillon') return;
      const jours = joursEnLigne(b);
      if (jours > 60) out.push({ type: 'souffrance', bien: b, label: 'En souffrance — ' + jours + ' jours en ligne' });
      if (b.surface > 0 && b.prix > 0 && pm2 > 0 && (b.prix / b.surface) < pm2 * 0.9) {
        out.push({ type: 'decote', bien: b, label: 'Décote — ' + Math.round((1 - (b.prix / b.surface) / pm2) * 100) + '% sous le marché' });
      }
    });
    const tension = tensionQuartiers();
    Object.keys(tension).forEach((q) => {
      const t = tension[q];
      if (t.demandes > 0 && t.offres > 0 && (t.demandes / t.offres) > 3) {
        out.push({ type: 'tension', quartier: q, label: 'Tension — ' + qLabel(q) + ' : ' + t.demandes + ' acheteurs pour ' + t.offres + ' bien' });
      }
    });
    return out;
  }

  function robotStatsDetectes() {
    const biens = robotBiens();
    return {
      parcelles: biens.length,
      proprietaires: biens.filter((b) => b.proprietaire && b.proprietaire.nom).length,
      sci: biens.filter((b) => b.proprietaire && b.proprietaire.type === 'sci').length,
      contacts: biens.reduce((n, b) => n + (b.contacts || []).length, 0)
    };
  }

  function robotBiensFiltres() {
    const f = state.robotFiltres || {};
    const ms = matchings();
    const nb = (id) => ms.filter((m) => m.bienId === id).length;
    let biens = robotBiens().slice();
    if (state.robotPriorite) biens = biens.filter((b) => prioriteRobot(b).level === state.robotPriorite);
    if (f.type) biens = biens.filter((b) => b.type === f.type);
    if (f.surfaceMin) biens = biens.filter((b) => (b.surface_habitable_m2 || 0) >= Number(f.surfaceMin));
    if (f.surfaceMax) biens = biens.filter((b) => (b.surface_habitable_m2 || 0) <= Number(f.surfaceMax));
    if (f.piecesMin) biens = biens.filter((b) => (b.pieces || 0) >= Number(f.piecesMin));
    if (f.etageMin) biens = biens.filter((b) => typeof b.etageEstime === 'number' && b.etageEstime >= Number(f.etageMin));
    if (f.epoque) biens = biens.filter((b) => epoqueCorrespond(anneeComparable(b), f.epoque) === true);
    if (f.proprio === 'oui') biens = biens.filter((b) => b.proprietaire && b.proprietaire.nom);
    if (f.proprio === 'non') biens = biens.filter((b) => !(b.proprietaire && b.proprietaire.nom));
    if (f.sci) biens = biens.filter((b) => b.proprietaire && b.proprietaire.type === 'sci');
    if (f.societe) biens = biens.filter((b) => b.proprietaire && b.proprietaire.type === 'societe');
    if (f.contacts) biens = biens.filter((b) => (b.contacts || []).length);
    if (f.avecMatch) biens = biens.filter((b) => nb(b.id) > 0);
    if (f.client) {
      const ids = new Set(ms.filter((m) => m.clientId === f.client).map((m) => m.bienId));
      biens = biens.filter((b) => ids.has(b.id));
    }
    if (f.secteur) biens = biens.filter((b) => (b.ville || 'Secteur inconnu') === f.secteur);
    const tri = f.tri || 'priorite';
    biens.sort((a, b) => {
      if (tri === 'fiabilite') return (b.confidence_geocoding || 0) - (a.confidence_geocoding || 0);
      if (tri === 'surface') return (b.surface_habitable_m2 || 0) - (a.surface_habitable_m2 || 0);
      if (tri === 'clients') return nb(b.id) - nb(a.id);
      if (tri === 'date') return new Date(b.dateDetection || 0) - new Date(a.dateDetection || 0);
      const pa = prioriteRobot(a).level, pb = prioriteRobot(b).level;
      if (pa !== pb) return pa - pb;
      return (scorePriorite(b).score || 0) - (scorePriorite(a).score || 0);
    });
    return biens;
  }

  function barreFiltresRobot() {
    const f = state.robotFiltres || {};
    const types = ['Appartement', 'Maison', 'Duplex', 'Immeuble', 'Terrain'];
    const sel = (name, opts, cur) => '<select class="se-select" data-rf="' + name + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    const chk = (name, label) => '<label class="se-check" style="cursor:pointer"><input type="checkbox" data-rf="' + name + '"' + (f[name] ? ' checked' : '') + ' style="margin-right:6px"/>' + label + '</label>';
    return '<h4 style="margin:0 0 2px">Filtres & tri</h4>' +
      '<div class="se-form-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:10px">' +
        '<div class="se-field"><label>Type de bien</label>' + sel('type', [['', 'Tous']].concat(types.map((t) => [t, t])), f.type || '') + '</div>' +
        '<div class="se-field"><label>Surface min (m²)</label><input class="se-input" type="number" data-rf="surfaceMin" value="' + esc(f.surfaceMin || '') + '" placeholder="0"/></div>' +
        '<div class="se-field"><label>Surface max (m²)</label><input class="se-input" type="number" data-rf="surfaceMax" value="' + esc(f.surfaceMax || '') + '" placeholder="0"/></div>' +
        '<div class="se-field"><label>Pièces min</label><input class="se-input" type="number" data-rf="piecesMin" value="' + esc(f.piecesMin || '') + '" placeholder="0"/></div>' +
        '<div class="se-field"><label>Étage min</label><input class="se-input" type="number" data-rf="etageMin" value="' + esc(f.etageMin || '') + '" placeholder="0"/></div>' +
        '<div class="se-field"><label>Propriétaire</label>' + sel('proprio', [['tous', 'Tous'], ['oui', 'Identifié'], ['non', 'Non identifié']], f.proprio || 'tous') + '</div>' +
        '<div class="se-field"><label>Époque (ancien/récent)</label>' + sel('epoque', [['', 'Toutes']].concat(EPOQUES.map((e) => [e.id, e.label])), f.epoque || '') + '</div>' +
      '</div>' +
      '<div class="se-row" style="gap:16px;margin-top:10px;flex-wrap:wrap">' +
        chk('sci', 'SCI') + chk('societe', 'Société') + chk('contacts', 'Coordonnées disponibles') + chk('avecMatch', 'Avec correspondance client') +
      '</div>' +
      '<div class="se-row" style="gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">' +
        '<span class="se-hint">Client :</span>' +
        sel('client', [['', 'Tous']].concat([...new Set(matchings().map((m) => m.clientId))].map((cid) => { const cl = state.clients.find((c) => c.id === cid); return cl ? [cid, nomClient(cl)] : null; }).filter(Boolean)), f.client || '') +
        '<span class="se-hint">Tri :</span>' +
        sel('tri', [['date', 'Date de détection'], ['fiabilite', 'Fiabilité'], ['surface', 'Surface'], ['clients', 'Clients correspondants']], f.tri || 'date') +
        '<button class="se-btn ghost sm" data-act="robot-reset-filtres">Réinitialiser</button>' +
      '</div>';
  }

  function pctScore(cs) {
    const total = cs.reduce((s, c) => s + c.max, 0);
    const pts = cs.reduce((s, c) => s + c.points, 0);
    return total ? Math.round(pts / total * 100) : 0;
  }

  // Trois scores indépendants + priorité pondérée
  function scoresRobot(b) {
    const prop = b.proprietaire || {};
    const contacts = b.contacts || [];
    const verif = contacts.some((c) => c.verification === 'VERIFIED');
    const tel = contacts.some((c) => c.type === 'tel');
    const email = contacts.some((c) => c.type === 'email');
    const dirigeant = (prop.dirigeants && prop.dirigeants.length) ? 1 : 0;
    const dvf = (b.dvfMutations && b.dvfMutations.length) ? 1 : 0;
    const nb = matchings().filter((m) => m.bienId === b.id).length;
    const energivore = (b.dpe === 'F' || b.dpe === 'G') ? 1 : 0;
    // Trois signaux comportementaux déjà collectés (visibles sous forme de
    // tags/signaux ailleurs dans l'écran) mais qui, jusqu'ici, ne comptaient
    // pour rien dans le score de priorité lui-même — "Détention ancienne"
    // valait 0 point en dur, et le DPE récent / les permis d'urbanisme
    // n'étaient tout simplement pas pris en compte. Résultat : deux biens
    // pouvaient avoir la même priorité affichée alors que l'un montrait un
    // vrai signe de projet de vente (DPE tout juste commandé, permis de
    // démolition déposé) et l'autre non. On les intègre ici pour que le
    // score reflète vraiment "qui approcher en premier".
    const detention = dureeDetentionInfo(b);
    const joursDpe = joursDepuis(b.dpeDate);
    const dpeRecent = joursDpe != null && joursDpe <= 180;
    const permis = permisPourBien(b) || [];
    const permisForts = permis.some((p) => p.family === 'demolition' || p.family === 'construction');

    const idContribs = [
      { label: 'Propriétaire identifié', points: prop.nom ? 40 : 0, max: 40 },
      { label: 'Confiance du rapprochement', points: b.confidence_owner != null ? Math.round(b.confidence_owner * 30 / 100) : 0, max: 30 },
      { label: 'SIREN', points: prop.siren ? 15 : 0, max: 15 },
      { label: 'Dirigeant identifié', points: dirigeant ? 15 : 0, max: 15 }
    ];
    const coContribs = [
      { label: 'Téléphone trouvé', points: tel ? 40 : 0, max: 40 },
      { label: 'Email trouvé', points: email ? 30 : 0, max: 30 },
      { label: 'Contact vérifié (VERIFIED)', points: verif ? 30 : 0, max: 30 }
    ];
    const potContribs = [
      { label: 'Passoire thermique (F/G)', points: energivore ? 30 : 0, max: 30 },
      { label: 'Historique DVF (mutations)', points: dvf ? 25 : 0, max: 25 },
      { label: 'Acquéreurs compatibles', points: nb > 0 ? Math.min(25, nb * 5) : 0, max: 25 },
      { label: 'Détention ancienne', points: detention ? (detention.niveau === 'forte' ? 20 : detention.niveau === 'moyenne' ? 10 : 0) : 0, max: 20 },
      { label: 'DPE réalisé récemment', points: dpeRecent ? (joursDpe <= 60 ? 25 : 15) : 0, max: 25 },
      { label: 'Permis d’urbanisme en cours', points: permisForts ? 20 : (permis.length ? 10 : 0), max: 20 }
    ];

    const identification = pctScore(idContribs);
    const coordonnees = pctScore(coContribs);
    const potentiel = pctScore(potContribs);
    const priorite = Math.round(identification * 0.40 + coordonnees * 0.25 + potentiel * 0.35);
    return { identification, coordonnees, potentiel, priorite, idContribs, coContribs, potContribs };
  }

  function scorePriorite(b) {
    const s = scoresRobot(b);
    const contribs = s.idContribs.concat(s.coContribs).concat(s.potContribs);
    const points = contribs.reduce((x, c) => x + c.points, 0);
    if (points === 0) return { score: null, contribs, scores: s };
    return { score: s.priorite, contribs, scores: s };
  }

  function ancienneteDpe(b) {
    if (!b.dpeDate) return { texte: 'Aucun DPE disponible', alerte: false };
    const jours = Math.floor((Date.now() - new Date(b.dpeDate).getTime()) / 86400000);
    if (jours < 0 || isNaN(jours)) return { texte: 'DPE récent', alerte: false };
    return { texte: 'DPE il y a ' + jours + ' jour' + (jours > 1 ? 's' : ''), alerte: jours > 15 };
  }

  // Tag de structure de détention — 4 cas du plan de fusion (immeuble détenu par une société /
  // SCI mono-actif / immeuble en mouvement / portefeuille institutionnel), déduits des champs déjà
  // collectés (type de propriétaire, type de bâti, taille du portefeuille par SIREN/nom, fraîcheur du DPE).
  // Calculé à l'affichage (comme prioriteRobot/typeRobot) plutôt que stocké, pour ne jamais diverger
  // entre deux copies de la même règle.
  const TAG_STRUCTURE_LABEL = {
    immeuble_societe: 'Immeuble détenu par une société',
    sci_un_bien: 'SCI mono-actif',
    immeuble_mouvement: 'Immeuble en mouvement',
    institutionnel: 'Portefeuille institutionnel'
  };
  function tagStructure(b, allBiens) {
    const prop = b.proprietaire || {};
    if (!prop.nom) return null;
    const cle = prop.siren || prop.nom;
    const portefeuille = (allBiens || []).filter((x) => (((x.proprietaire || {}).siren) || ((x.proprietaire || {}).nom)) === cle);
    const estImmeuble = String(b.type || '').toLowerCase().indexOf('immeuble') > -1;
    const dixHuitMois = 18 * 30 * 24 * 3600 * 1000;
    const dpeRecent = !!(b.dpeDate && (Date.now() - new Date(b.dpeDate).getTime()) < dixHuitMois);
    if (prop.type === 'societe' && portefeuille.length >= 3) return 'institutionnel';
    if (prop.type === 'societe' && estImmeuble) return 'immeuble_societe';
    if (prop.type === 'sci' && portefeuille.length === 1) return 'sci_un_bien';
    if (estImmeuble && dpeRecent) return 'immeuble_mouvement';
    return null;
  }

  function tagsRobot(b, allBiens) {
    const prop = b.proprietaire || {};
    const tags = [];
    if (b.type) tags.push(b.type.toUpperCase());
    if (prop.type === 'sci') tags.push('SCI');
    else if (prop.type === 'societe') tags.push('SOCIÉTÉ');
    else if (prop.type === 'personne') tags.push('PARTICULIER');
    if (prop.nom) tags.push('PROPRIÉTAIRE IDENTIFIÉ');
    if ((b.contacts || []).some((c) => c.verification === 'VERIFIED')) tags.push('CONTACT VÉRIFIÉ');
    if (b.dpe === 'F' || b.dpe === 'G') tags.push('DPE ' + b.dpe);
    const struct = tagStructure(b, allBiens || robotBiens());
    if (struct) tags.push(TAG_STRUCTURE_LABEL[struct].toUpperCase());
    const detention = dureeDetentionInfo(b);
    if (detention && detention.niveau === 'forte') tags.push('DÉTENTION ' + detention.ans + ' ANS');
    return tags;
  }

  const STATUTS_PROSPECTION = [
    ['non-analyse', 'Non analysée', 'muted'],
    ['analyse', 'Analyse en cours', ''],
    ['proprietaire', 'Propriétaire identifié', 'open'],
    ['contacts', 'Contacts disponibles', 'open'],
    ['opportunite', 'Opportunité détectée', 'warn'],
    ['a-prospecter', 'À prospecter', ''],
    ['prospection', 'En cours de prospection', ''],
    ['converti', 'Convertie en prospect', 'open'],
    ['ignore', 'Ignorée', 'muted']
  ];

  function etatRobot(b) {
    if (b.statutProspection && b.statutProspection !== 'non-analyse') {
      const s = STATUTS_PROSPECTION.find((x) => x[0] === b.statutProspection);
      if (s) return { label: s[1], cls: s[2] };
    }
    const prop = b.proprietaire || {};
    if (!prop.nom) return { label: 'Non analysée', cls: 'muted' };
    if ((b.contacts || []).length) return { label: 'Contacts disponibles', cls: 'open' };
    return { label: 'Propriétaire identifié', cls: 'open' };
  }

  // Score de durée de détention : plus un propriétaire détient son bien depuis longtemps, plus
  // la probabilité statistique de revente à moyen terme augmente (retour à la moyenne de la durée
  // de détention en France, ~7-10 ans). Calculé à partir de la dernière vente DVF connue sur la
  // parcelle — indicateur statistique, pas une science exacte, à combiner avec les autres signaux.
  function parseDateFR(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  // Les dates DVF sont au format JJ/MM/AAAA, celles de l'ADEME (date_reception_dpe
  // notamment) au format ISO AAAA-MM-JJ : on essaie les deux plutôt que de se
  // limiter à un seul format et de perdre silencieusement l'information.
  function parseDateFlexible(s) {
    return parseDateFR(s) || (/^\d{4}-\d{2}-\d{2}/.test(String(s || '').trim()) ? new Date(String(s).trim().slice(0, 10)) : null);
  }

  function joursDepuis(dateStr) {
    const d = parseDateFlexible(dateStr);
    if (!d || isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
  }

  function dureeDetentionInfo(b) {
    const ventes = (b.dvfMutations || []).filter((m) => /vente/i.test(m.nature || ''));
    if (!ventes.length) return null;
    let plusRecente = null;
    ventes.forEach((m) => { const d = parseDateFR(m.date); if (d && (!plusRecente || d > plusRecente)) plusRecente = d; });
    if (!plusRecente) return null;
    const ans = Math.floor((Date.now() - plusRecente.getTime()) / (365.25 * 24 * 3600 * 1000));
    let niveau, label;
    if (ans >= 15) { niveau = 'forte'; label = 'Détenu depuis ' + ans + ' ans — probabilité de revente élevée.'; }
    else if (ans >= 7) { niveau = 'moyenne'; label = 'Détenu depuis ' + ans + ' ans — dans la moyenne de détention.'; }
    else { niveau = 'faible'; label = 'Détenu depuis ' + ans + ' ans — revente peu probable à court terme.'; }
    return { ans: ans, dateVente: plusRecente, niveau: niveau, label: label };
  }

  // Bouton « Voir sur Maps » : ouvre Google Maps (façade Street View, plan,
  // satellite) dans une fenêtre intégrée au CRM — jamais un nouvel onglet.
  function lienCarteRobot(b, libelle) {
    if (!b || !b.adresse) return '';
    return '<button class="se-btn ghost sm" data-act="voir-maps" data-id="' + esc(b.id) + '">' + (libelle || 'Voir sur Maps') + '</button>';
  }

  function adresseComplete(b) {
    let a = String(b.adresse || '').trim();
    if (b.codePostal && a.indexOf(b.codePostal) === -1) a += ' ' + b.codePostal;
    const ville = String(b.ville || '').replace(/^\d{5}\s*/, '').trim();
    if (ville && a.toLowerCase().indexOf(ville.toLowerCase()) === -1) a += ' ' + ville;
    return a;
  }

  let CARTE_CONFIG = null;
  async function configCarte() {
    if (CARTE_CONFIG) return CARTE_CONFIG;
    try { CARTE_CONFIG = await fetch('/api/robot/carte-config', { credentials: 'same-origin' }).then((x) => x.json()); } catch (e) { CARTE_CONFIG = {}; }
    return CARTE_CONFIG || {};
  }

  async function geocoderAdresse(adresse) {
    try {
      const d = await fetch('https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(adresse)).then((x) => x.json());
      const f = d.features && d.features[0];
      if (f && f.geometry && f.geometry.coordinates) return [f.geometry.coordinates[1], f.geometry.coordinates[0]];
    } catch (e) { /* repli : pas de Street View, plan sur l'adresse seulement */ }
    return null;
  }

  function fermerCarte() {
    const ov = document.querySelector('.se-maps-overlay');
    if (ov) ov.remove();
    document.removeEventListener('keydown', toucheCarte);
    document.body.classList.remove('se-maps-open');
  }
  function toucheCarte(e) { if (e.key === 'Escape') fermerCarte(); }

  // Fenêtre indépendante du système de modales : render() ne la reconstruit pas,
  // donc l'iframe (et la navigation de l'agent dans Street View) n'est jamais
  // rechargée par la synchronisation automatique ou l'enrichissement en cours.
  async function ouvrirCarte(b) {
    fermerCarte();
    const adresse = adresseComplete(b);
    const ov = document.createElement('div');
    ov.className = 'se-maps-overlay';
    ov.innerHTML = '<div class="se-maps-box" role="dialog" aria-modal="true" aria-label="Carte du bien">' +
      '<div class="se-maps-head">' +
        '<div class="se-maps-titre"><span class="se-kicker">Google Maps</span><b>' + esc(adresse) + '</b></div>' +
        '<div class="se-maps-tabs">' +
          '<button type="button" class="se-studio-tab active" data-vue="sv">Façade</button>' +
          '<button type="button" class="se-studio-tab" data-vue="plan">Plan</button>' +
          '<button type="button" class="se-studio-tab" data-vue="sat">Satellite</button>' +
        '</div>' +
        '<button type="button" class="se-maps-close" aria-label="Fermer la carte">×</button>' +
      '</div>' +
      '<div class="se-maps-frame"><div class="se-maps-msg">Localisation de l’adresse…</div></div>' +
      '<div class="se-maps-foot se-hint">Dans la vue Façade, glissez pour tourner et cliquez sur les flèches au sol pour avancer dans la rue.</div>' +
    '</div>';
    document.body.appendChild(ov);
    document.body.classList.add('se-maps-open');
    document.addEventListener('keydown', toucheCarte);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.se-maps-close')) fermerCarte(); });

    const [cfg, coords] = await Promise.all([configCarte(), (b.coords && b.coords.length > 1) ? Promise.resolve([Number(b.coords[0]), Number(b.coords[1])]) : geocoderAdresse(adresse)]);
    if (!document.body.contains(ov)) return;
    const cle = cfg.googleEmbedKey || '';
    const q = encodeURIComponent(adresse);
    const urls = {
      sv: coords
        ? (cle ? 'https://www.google.com/maps/embed/v1/streetview?key=' + encodeURIComponent(cle) + '&location=' + coords[0] + ',' + coords[1] + '&fov=80'
               : 'https://maps.google.com/maps?q=&layer=c&cbll=' + coords[0] + ',' + coords[1] + '&cbp=11,0,0,0,0&output=svembed&hl=fr')
        : null,
      plan: cle ? 'https://www.google.com/maps/embed/v1/place?key=' + encodeURIComponent(cle) + '&q=' + q + '&zoom=18'
                : 'https://maps.google.com/maps?q=' + q + '&z=18&output=embed&hl=fr',
      sat: cle ? 'https://www.google.com/maps/embed/v1/place?key=' + encodeURIComponent(cle) + '&q=' + q + '&zoom=19&maptype=satellite'
               : 'https://maps.google.com/maps?q=' + q + '&z=19&t=k&output=embed&hl=fr'
    };
    const zone = ov.querySelector('.se-maps-frame');
    const afficher = (vue) => {
      ov.querySelectorAll('[data-vue]').forEach((x) => x.classList.toggle('active', x.getAttribute('data-vue') === vue));
      const url = urls[vue];
      zone.innerHTML = url
        ? '<iframe src="' + esc(url) + '" title="Google Maps — ' + esc(adresse) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>'
        : '<div class="se-maps-msg">Adresse introuvable dans la Base Adresse Nationale : la vue façade n’est pas disponible, utilisez Plan ou Satellite.</div>';
    };
    ov.querySelectorAll('[data-vue]').forEach((btn) => btn.addEventListener('click', () => afficher(btn.getAttribute('data-vue'))));
    afficher(urls.sv ? 'sv' : 'plan');
  }

  /* ---------- Enrichissement automatique de la fiche bien (sources gratuites) ----------
     À l'ouverture d'une fiche, on interroge en parallèle :
       · le fichier DGFiP des locaux des personnes morales (indexé sur le serveur) :
         toutes les sociétés propriétaires dans l'immeuble, étage, bâtiment, porte ;
       · SIRENE (recherche-entreprises.api.gouv.fr) : sociétés domiciliées à l'adresse,
         avec le complément d'adresse (étage / gauche-droite) et leurs dirigeants ;
       · puis, si le propriétaire du bien est connu : dirigeants SIRENE et BODACC.
     Les résultats restent en mémoire (pas dans localStorage : un immeuble peut
     compter des dizaines de lots) et sont affichés directement dans la fiche. */
  const AUTO = {};
  const PATRIMOINE = {};
  let PM_STATUT = null;
  let PM_SUIVI = null;

  const getJson = (url) => fetch(url, { credentials: 'same-origin' }).then((x) => x.json());

  function suivreImportPm() {
    if (PM_SUIVI) return;
    PM_SUIVI = setInterval(async () => {
      try {
        const s = await getJson('/api/robot/pm/statut');
        PM_STATUT = s;
        if (!s.import || !s.import.enCours) {
          clearInterval(PM_SUIVI); PM_SUIVI = null;
          if (s.disponible) {
            // l'index vient d'arriver : on relance l'enrichissement des fiches ouvertes
            Object.keys(AUTO).forEach((k) => { if (AUTO[k].immeuble && AUTO[k].immeuble.disponible === false) delete AUTO[k]; });
            Object.keys(PATRIMOINE).forEach((k) => { if (PATRIMOINE[k].disponible === false) delete PATRIMOINE[k]; });
          }
        }
        render();
      } catch (e) { /* on réessaie au prochain tour */ }
    }, 4000);
  }

  async function lancerEnrichissementAuto(bienId) {
    if (AUTO[bienId]) return;
    const b0 = robotBien(bienId);
    if (!b0 || !b0.adresse) return;
    const a = AUTO[bienId] = { chargement: true, erreurs: [] };
    render();
    const adresse = encodeURIComponent(adresseComplete(b0));
    const [imm, soc] = await Promise.all([
      getJson('/api/robot/pm/immeuble?adresse=' + adresse).catch(() => ({ error: 'Serveur injoignable.' })),
      getJson('/api/robot/societes-adresse?adresse=' + adresse).catch(() => ({ error: 'Serveur injoignable.' }))
    ]);
    if (imm && imm.ok) { a.immeuble = imm; if (imm.disponible === false) { PM_STATUT = { disponible: false, import: imm.import }; if (imm.import && imm.import.enCours) suivreImportPm(); } }
    else a.erreurs.push('Fichier DGFiP : ' + ((imm && imm.error) || 'erreur'));
    if (soc && soc.ok) a.societes = soc.societes || [];
    else a.erreurs.push('SIRENE : ' + ((soc && soc.error) || 'erreur'));
    a.chargement = false;
    render();

    // Propriétaire déjà identifié (par une association ou la cascade) : dirigeants + BODACC.
    const b = robotBien(bienId);
    const prop = (b && b.proprietaire) || {};
    if (prop.siren && /^\d{9}$/.test(prop.siren)) {
      if (!(prop.dirigeants && prop.dirigeants.length)) {
        const dir = (a.societes || []).find((s) => s.siren === prop.siren);
        if (dir && dir.dirigeants.length) a.dirigeants = dir.dirigeants;
        else {
          try { const r = await getJson('/api/robot/dirigeants?siren=' + prop.siren); if (r.ok) a.dirigeants = r.dirigeants || []; } catch (e) { a.erreurs.push('Dirigeants SIRENE injoignables.'); }
        }
      }
      try { const r = await getJson('/api/robot/bodacc?siren=' + prop.siren); if (r.ok) { a.bodacc = r.annonces || []; state.bodaccAlertes = state.bodaccAlertes || {}; state.bodaccAlertes[prop.siren] = a.bodacc; } } catch (e) { /* signal optionnel */ }
      render();
    }
  }

  async function chargerPatrimoine(siren) {
    if (!/^\d{9}$/.test(String(siren || '')) || PATRIMOINE[siren]) return;
    PATRIMOINE[siren] = { chargement: true };
    render();
    try {
      const [p, d] = await Promise.all([getJson('/api/robot/pm/siren/' + siren), getJson('/api/robot/dirigeants?siren=' + siren).catch(() => ({}))]);
      PATRIMOINE[siren] = Object.assign({}, p, { chargement: false, dirigeants: (d && d.ok) ? (d.dirigeants || []) : [] });
      if (p && p.disponible === false && p.import && p.import.enCours) suivreImportPm();
    } catch (e) {
      PATRIMOINE[siren] = { chargement: false, erreur: true };
    }
    render();
  }

  // Étage du bien : déduit du fichier DGFiP quand le propriétaire (SIREN) est connu
  // et n'a qu'un seul niveau dans l'immeuble ; sinon l'étage associé à la main ;
  // sinon l'estimation tirée de l'adresse du DPE.
  function etageDuBien(b) {
    if (b.etageDgfip) return { valeur: b.etageDgfip, source: 'fichier DGFiP des locaux (lot associé)' };
    const a = AUTO[b.id];
    const siren = b.proprietaire && b.proprietaire.siren;
    if (a && a.immeuble && a.immeuble.lots && siren) {
      const niveaux = [];
      a.immeuble.lots.filter((l) => l.siren === siren && l.droit !== 'S').forEach((l) => { if (l.niveauLibelle && niveaux.indexOf(l.niveauLibelle) === -1) niveaux.push(l.niveauLibelle); });
      if (niveaux.length === 1) return { valeur: niveaux[0], source: 'fichier DGFiP — seul lot de ' + (b.proprietaire.nom || 'la société') + ' dans l’immeuble' };
      if (niveaux.length > 1) return { valeur: niveaux.join(' ou '), source: 'fichier DGFiP — ' + (b.proprietaire.nom || 'la société') + ' possède plusieurs lots ici' };
    }
    if (a && a.societes && siren) {
      const s = a.societes.find((x) => x.siren === siren && x.lot && x.lot.etage);
      if (s) return { valeur: s.lot.etage + (s.lot.position ? ' ' + s.lot.position : ''), source: 'complément d’adresse SIRENE du siège de la société' };
    }
    if (b.etageEstime) return { valeur: b.etageEstime, source: 'estimé depuis l’adresse du DPE, non garanti' };
    return null;
  }

  const lotCle = (l) => [l.siren, l.niveau, l.porte, l.batiment, l.entree].join('|');

  function lotDetailHtml(l) {
    return [l.batiment ? 'Bât. ' + esc(l.batiment) : '', l.entree ? 'Esc. ' + esc(l.entree) : '', l.porte ? 'Porte ' + esc(l.porte) : ''].filter(Boolean).join(' · ');
  }

  function lienSociete(siren, nom) {
    return /^\d{9}$/.test(String(siren || ''))
      ? '<a href="#/robot-proprietaire/' + encodeURIComponent(siren) + '" style="font-weight:600">' + esc(nom || siren) + '</a>'
      : '<b>' + esc(nom || '—') + '</b>';
  }

  function pmIndisponibleHtml(imm) {
    const st = (PM_STATUT && PM_STATUT.import) || (imm && imm.import) || {};
    if (st.enCours) return '<p class="se-hint" style="margin-top:10px"><span class="se-badge warn">Chargement</span> ' + esc(st.etape || 'Import du fichier DGFiP en cours…') + (st.lignes ? ' — ' + Number(st.lignes).toLocaleString('fr-FR') + ' locaux indexés' : '') + '</p>';
    return '<p class="se-muted" style="margin-top:10px">Le fichier DGFiP des locaux des sociétés n’est pas encore chargé sur le serveur (téléchargement unique, puis mise à jour automatique chaque mois).' + (st.erreur ? ' Dernière tentative : ' + esc(st.erreur) + '.' : '') + '</p>' +
      '<button class="se-btn sm" style="margin-top:10px" data-act="pm-importer">Charger le fichier DGFiP maintenant</button>';
  }

  function immeubleHtml(b) {
    const a = AUTO[b.id];
    let corps;
    if (!a || a.chargement) corps = '<p class="se-hint" style="margin-top:10px">Recherche des sociétés propriétaires dans l’immeuble…</p>';
    else if (!a.immeuble) corps = '<p class="se-muted" style="margin-top:10px">Source indisponible pour l’instant.</p>';
    else if (a.immeuble.disponible === false) corps = pmIndisponibleHtml(a.immeuble);
    else if (!a.immeuble.adresseComprise) corps = '<p class="se-muted" style="margin-top:10px">Adresse non reconnue (numéro ou code postal manquant).</p>';
    else if (!a.immeuble.lots.length) corps = '<p class="se-muted" style="margin-top:10px">Aucun lot détenu par une société à cette adresse : l’immeuble appartient vraisemblablement à des particuliers (non publiés par la DGFiP).</p>';
    else {
      const lots = a.immeuble.lots;
      const sirenBien = b.proprietaire && b.proprietaire.siren;
      const domicilies = {};
      (a.societes || []).forEach((x) => { domicilies[x.siren] = x.estSiege ? 'siege' : 'etab'; });
      const proprios = a.immeuble.proprietaires || [];
      const nbSci = proprios.filter((p) => p.type === 'sci').length;
      const parNiveau = [];
      lots.forEach((l, i) => {
        const k = l.niveauLibelle || 'Niveau non précisé';
        let g = parNiveau.find((x) => x.k === k);
        if (!g) { g = { k, lots: [] }; parNiveau.push(g); }
        g.lots.push({ l, i });
      });
      corps = '<p class="se-hint" style="margin-top:6px">' + lots.length + ' lot(s) détenu(s) par ' + proprios.length + ' société(s)' + (nbSci ? ', dont ' + nbSci + ' SCI' : '') + ' · ' + esc(a.immeuble.commune || '') + ' · cadastre ' + esc((lots[0].section || '') + ' ' + (lots[0].plan || '')) + '</p>' +
        '<div class="se-pm-immeuble">' + parNiveau.map((g) =>
          '<div class="se-pm-niveau"><div class="se-pm-niveau-titre">' + esc(g.k) + '</div>' +
          g.lots.map(({ l, i }) => {
            const estLeBien = sirenBien && l.siren === sirenBien && (!b.lotDgfip || b.lotDgfip === lotCle(l));
            const detail = lotDetailHtml(l);
            return '<div class="se-pm-lot' + (estLeBien ? ' is-on' : '') + '">' +
              '<div style="flex:1;min-width:0">' +
                '<div>' + lienSociete(l.siren, l.nom) + ' <span class="se-hint">' + esc(l.forme || '') + '</span>' +
                  (domicilies[l.siren] ? ' <span class="se-badge open" title="D’après SIRENE, cette société est domiciliée à cette adresse">' + (domicilies[l.siren] === 'siege' ? 'Siège ici' : 'Établissement ici') + '</span>' : '') +
                  (estLeBien ? ' <span class="se-badge">Propriétaire du bien</span>' : '') + '</div>' +
                '<div class="se-hint">' + esc(l.droitLibelle) + (detail ? ' · ' + detail : '') + (l.siren ? ' · SIREN ' + esc(l.siren) : '') + '</div>' +
              '</div>' +
              (l.droit !== 'S' && !estLeBien ? '<button class="se-btn ghost sm" data-act="robot-associer-lot" data-id="' + esc(b.id) + '" data-idx="' + i + '">C’est ce bien</button>' : '') +
            '</div>';
          }).join('') + '</div>').join('') + '</div>' +
        '<p class="se-hint" style="margin-top:10px">« C’est ce bien » rattache le lot au bien du DPE : propriétaire, SIREN et étage sont alors remplis. Le DPE ne nomme pas son propriétaire — la correspondance reste à confirmer par l’agent.</p>';
    }
    return '<div class="se-card" style="margin-top:16px"><h3>L’immeuble : sociétés propriétaires, étage par étage</h3>' +
      '<p class="se-hint">Fichier DGFiP des locaux des personnes morales' + (a && a.immeuble && a.immeuble.millesime ? ' (millésime ' + a.immeuble.millesime + ')' : '') + ', open data gratuit — les particuliers n’y figurent pas (secret fiscal).</p>' +
      corps + '</div>';
  }

  function societesAdresseHtml(b) {
    const a = AUTO[b.id];
    let corps;
    if (!a || a.chargement) corps = '<p class="se-hint" style="margin-top:10px">Interrogation de SIRENE…</p>';
    else if (!a.societes) corps = '<p class="se-muted" style="margin-top:10px">SIRENE injoignable pour l’instant.</p>';
    else if (!a.societes.length) corps = '<p class="se-muted" style="margin-top:10px">Aucune société active domiciliée à ce numéro.</p>';
    else {
      const sirenBien = b.proprietaire && b.proprietaire.siren;
      corps = '<div class="se-list" style="margin-top:10px">' + a.societes.map((s, i) => {
        const lot = s.lot || {};
        const chips = [lot.etage, lot.position, lot.batiment ? 'Bât. ' + lot.batiment : '', lot.escalier ? 'Esc. ' + lot.escalier : '', lot.appartement ? 'Appt ' + lot.appartement : '', lot.porte ? 'Porte ' + lot.porte : ''].filter(Boolean);
        return '<div class="se-list-item" style="align-items:flex-start">' +
          '<div style="flex:1;min-width:0">' +
            '<div>' + lienSociete(s.siren, s.nom) + ' <span class="se-badge ' + (s.type === 'sci' ? 'open' : 'muted') + '">' + (s.type === 'sci' ? 'SCI' : 'Société') + '</span>' + (s.estSiege ? '' : ' <span class="se-badge muted">Établissement</span>') + '</div>' +
            '<div class="se-hint">SIREN ' + esc(s.siren) + (s.dateCreation ? ' · créée le ' + dFR(s.dateCreation) : '') + (s.complementAdresse ? ' · « ' + esc(s.complementAdresse) + ' »' : '') + '</div>' +
            (chips.length ? '<div class="se-chips" style="margin-top:6px">' + chips.map((c) => '<span class="se-chip">' + esc(c) + '</span>').join('') + '</div>' : '') +
            (s.dirigeants && s.dirigeants.length ? '<div class="se-hint" style="margin-top:4px">Dirigeant(s) : ' + s.dirigeants.map((d) => esc(d.nom) + (d.role ? ' (' + esc(d.role) + ')' : '')).join(', ') + '</div>' : '') +
          '</div>' +
          (sirenBien === s.siren ? '<span class="se-badge">Propriétaire du bien</span>' : '<button class="se-btn ghost sm" data-act="robot-associer-societe" data-id="' + esc(b.id) + '" data-idx="' + i + '">Propriétaire du bien</button>') +
        '</div>';
      }).join('') + '</div>';
    }
    return '<div class="se-card" style="margin-top:16px"><h3>Sociétés domiciliées à cette adresse</h3>' +
      '<p class="se-hint">SIRENE (recherche-entreprises.api.gouv.fr) — une SCI a souvent son siège dans l’immeuble qu’elle possède ; son complément d’adresse précise parfois l’étage ou la porte.</p>' +
      corps + '</div>';
  }

  function patrimoineHtml(siren, bienCourantId) {
    const p = PATRIMOINE[siren];
    if (!/^\d{9}$/.test(String(siren || ''))) return '';
    if (!p) setTimeout(() => chargerPatrimoine(siren), 0);
    let corps;
    if (!p || p.chargement) corps = '<p class="se-hint" style="margin-top:10px">Recherche des autres biens de la société…</p>';
    else if (p.erreur) corps = '<p class="se-muted" style="margin-top:10px">Source indisponible pour l’instant.</p>';
    else if (p.disponible === false) corps = pmIndisponibleHtml(p);
    else if (!p.biens || !p.biens.length) corps = '<p class="se-muted" style="margin-top:10px">Aucun local au nom de cette société dans les départements couverts (' + esc((p.departements || []).join(', ')) + ').</p>';
    else {
      const radar = robotBiens();
      corps = '<p class="se-hint" style="margin-top:6px">' + p.nbLots + ' lot(s) répartis sur ' + p.biens.length + ' adresse(s) — départements ' + esc((p.departements || []).join(', ')) + ', millésime ' + esc(p.millesime) + '.</p>' +
        '<div class="se-list" style="margin-top:8px">' + p.biens.map((x) => {
          const cleX = adresseKey(x.adresse);
          const dansRadar = radar.find((rb) => rb.id !== bienCourantId && adresseKey(rb.adresse).indexOf(cleX) === 0);
          const estCourant = bienCourantId && radar.some((rb) => rb.id === bienCourantId && adresseKey(rb.adresse).indexOf(cleX) === 0);
          const niveaux = [];
          x.lots.forEach((l) => { const t = l.niveauLibelle + (l.porte ? ' (porte ' + l.porte + ')' : ''); if (l.niveauLibelle && niveaux.indexOf(t) === -1) niveaux.push(t); });
          return '<div class="se-list-item" style="align-items:flex-start">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13.5px;font-weight:500">' + esc(x.adresse) + ' <span class="se-hint">· ' + esc(x.commune) + '</span></div>' +
              '<div class="se-hint">' + x.lots.length + ' lot(s)' + (niveaux.length ? ' · ' + esc(niveaux.join(', ')) : '') + ' · ' + esc(x.lots[0].droitLibelle) + ' · cadastre ' + esc(x.section + ' ' + x.plan) + '</div>' +
            '</div>' +
            (estCourant ? '<span class="se-badge">Ce bien</span>' : dansRadar ? '<a class="se-btn ghost sm" href="#/robot-bien/' + esc(dansRadar.id) + '">Fiche Radar</a>' : '') +
          '</div>';
        }).join('') + '</div>';
    }
    return '<div class="se-card" style="margin-top:16px"><h3>Patrimoine de la société</h3>' +
      '<p class="se-hint">Tous les locaux que cette société détient, d’après le fichier DGFiP des personnes morales.</p>' + corps + '</div>';
  }

  // Rattache un lot DGFiP (ou une société SIRENE) au bien. Un bien du moteur
  // quotidien est d'abord ajouté au Radar, sinon l'association serait perdue.
  function bienEditable(bienId) {
    let b = (state.robotBiens || []).find((x) => x.id === bienId);
    if (b) return b;
    const auto = (state.dpeAuto || []).find((x) => x.id === bienId);
    if (!auto) return null;
    b = Object.assign({}, auto);
    state.robotBiens = (state.robotBiens || []).concat([b]);
    return b;
  }

  function robotBiensList() {
    const all = robotBiensFiltres().filter((b) => !b.ignore);
    const toutesLesFiches = robotBiens();
    const ms = matchings();
    const perPage = 20;
    const totalPages = Math.max(1, Math.ceil(all.length / perPage));
    const cur = Math.min(Math.max(1, Number(state.robotPage) || 1), totalPages);
    state.robotPage = cur;
    const biens = all.slice((cur - 1) * perPage, cur * perPage);
    if (!all.length) return '<div class="se-card" style="padding:28px;text-align:center"><p class="se-muted" style="margin:0">Aucun bien détecté.</p><p class="se-muted" style="margin:6px 0 0;font-size:12px">Lancez une prospection pour alimenter le Radar.</p></div>';
    const pagination = '<div class="se-pagination">' +
      '<button class="se-btn ghost sm" data-act="robot-page" data-page="' + (cur - 1) + '"' + (cur <= 1 ? ' disabled' : '') + '>Précédent</button>' +
      '<span class="se-hint">Page ' + cur + ' / ' + totalPages + ' · ' + all.length + ' résultat(s)</span>' +
      '<button class="se-btn ghost sm" data-act="robot-page" data-page="' + (cur + 1) + '"' + (cur >= totalPages ? ' disabled' : '') + '>Suivant</button>' +
    '</div>';
    return pagination + biens.map((b) => {
      const prop = b.proprietaire || {};
      const sc = scorePriorite(b);
      const dpeAge = ancienneteDpe(b);
      const tags = tagsRobot(b, toutesLesFiches);
      const etat = etatRobot(b);
      const msBien = ms.filter((m) => m.bienId === b.id);
      const club = msBien.filter((m) => { const c = client(m.clientId); return c && (c.statut === 'actif' || c.statut === 'client'); }).length;
      const leads = msBien.length - club;
      const aReconfirmer = msBien.filter((m) => { const c = client(m.clientId); return c && (c.pipeline === 'À relancer' || c.pipeline === 'À contacter'); }).length;
      const typeProp = prop.type === 'sci' ? 'SCI' : prop.type === 'societe' ? 'Société' : prop.type === 'personne' ? 'Particulier' : '';
      const surf = b.surface_habitable_m2 != null ? b.surface_habitable_m2 + ' m² hab.' : (b.contenance_cadastrale_m2 != null ? 'parcelle ' + b.contenance_cadastrale_m2 + ' m²' : 'Surf. à vérifier');
      const secteur = b.ville || (b.quartiers && b.quartiers.length ? qLabel(b.quartiers[0]) : 'secteur inconnu');
      const scoreHtml = sc.score != null
        ? '<div class="se-score-badge" title="Identification ' + sc.scores.identification + '/100 · Coordonnées ' + sc.scores.coordonnees + '/100 · Potentiel ' + sc.scores.potentiel + '/100\n' + esc(sc.contribs.map((c) => c.label + ' : ' + c.points + '/' + c.max).join('\n')) + '">' + sc.score + '</div>'
        : '<div class="se-score-badge se-score-attente" title="Score en attente — aucun critère exploitable disponible">—</div>';
      const telVerifie = (b.contacts || []).find((c) => c.type === 'tel' && c.verification === 'VERIFIED');
      const actions =
        '<a class="se-btn ghost sm" href="#/robot-bien/' + b.id + '">Dossier</a>' +
        (prop.nom ? '<button class="se-btn ghost sm" data-act="robot-ajouter" data-json="' + esc(JSON.stringify({ nom: prop.nom, type: prop.type || 'personne', siren: prop.siren || '', email: ((b.contacts || []).find((c) => c.type === 'email') || {}).valeur || '', tel: ((b.contacts || []).find((c) => c.type === 'tel') || {}).valeur || '', adresseBien: b.adresse, ville: b.ville || '', parcelle: b.parcelle || '', dpe: b.dpe || '' })) + '">+ Prospect</button>' : '') +
        (telVerifie ? '<a class="se-btn ghost sm" href="https://wa.me/' + String(telVerifie.valeur).replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener">Contacter</a>' : '') +
        ((club + leads) > 0 ? '<a class="se-btn ghost sm" href="#/robot-opportunites">' + (club + leads) + ' acquéreurs</a>' : '');
      const tel = (b.contacts || []).find((c) => c.type === 'tel');
      const eml = (b.contacts || []).find((c) => c.type === 'email');
      const contactsHtml = '<div class="se-robot-contacts">' +
        'Téléphone : ' + (tel ? '<b>' + esc(tel.valeur) + '</b> ' + verifTag(tel.verification) : '<span class="se-hint">À rechercher</span>') +
        ' · Email : ' + (eml ? '<b>' + esc(eml.valeur) + '</b> ' + verifTag(eml.verification) : '<span class="se-hint">À rechercher</span>') +
      '</div>';
      const d0 = (prop.dirigeants && prop.dirigeants[0]) ? prop.dirigeants[0] : null;
      const dirigeant = d0 ? (typeof d0 === 'string' ? d0 : (d0.nom || d0.name || '')) : '';
      const addJson = esc(JSON.stringify({ nom: prop.nom, type: prop.type || 'personne', siren: prop.siren || '', email: ((b.contacts || []).find((c) => c.type === 'email') || {}).valeur || '', tel: ((b.contacts || []).find((c) => c.type === 'tel') || {}).valeur || '', adresseBien: b.adresse, ville: b.ville || '', parcelle: b.parcelle || '', dpe: b.dpe || '', dirigeants: prop.dirigeants || [] }));
      return '<div class="se-robot-card">' +
        scoreHtml +
        '<div class="se-robot-body">' +
          '<div class="se-robot-head"><b>' + esc(typeRobot(b)) + '</b><span> · ' + esc(surf) + ' · ' + esc(secteur) + '</span></div>' +
          '<div class="se-robot-prix">' + (b.estimationMin && b.estimationMax ? euro(b.estimationMin) + ' – ' + euro(b.estimationMax) : 'Estimation indisponible') + '</div>' +
          '<div class="se-robot-adr">' + esc(b.adresse || 'Adresse inconnue') + (b.etage ? ' · ' + esc(b.etage) + 'ᵉ étage' : '') + (b.parcelle ? ' · ' + esc(b.parcelle) : '') + '</div>' +
          '<div class="se-robot-dpe' + (dpeAge.alerte ? ' se-robot-dpe-alerte' : '') + '">' + esc(dpeAge.texte) + (b.dpe ? ' · Classe ' + esc(b.dpe) : '') + '</div>' +
          '<div class="se-robot-owner">' + (prop.nom ? '<span class="se-badge open">IDENTIFIÉ</span> <b>' + esc(prop.nom) + '</b>' + (typeProp ? '<span class="se-hint"> · ' + typeProp + '</span>' : '') + (prop.siren ? '<span class="se-hint"> · SIREN ' + esc(prop.siren) + '</span>' : '') + (dirigeant ? '<span class="se-hint"> · ' + esc(dirigeant) + '</span>' : '') : (b.enrichStatut === 'attente' ? '<span class="se-badge" style="background:#F8E9D5;color:#A56A2D;font-size:11px;padding:4px 8px;text-transform:uppercase">En attente du moteur</span>' : '<span class="se-badge muted">NON IDENTIFIÉ</span>')) + '</div>' +
          contactsHtml +
          (tags.length ? '<div class="se-robot-tags">' + tags.map((t) => '<span class="se-pill">' + esc(t) + '</span>').join('') + '</div>' : '') +
        '</div>' +
        '<div class="se-robot-match">' +
          '<div class="se-match-label">ACQUÉREURS<br>POTENTIELS</div>' +
          '<div class="se-match-num"><b>' + club + '</b> <span class="se-hint">club</span></div>' +
          '<div class="se-match-num"><b>' + leads + '</b> <span class="se-hint">leads</span></div>' +
          (aReconfirmer > 0 ? '<div class="se-hint">dont ' + aReconfirmer + ' à reconfirmer</div>' : '') +
          '<div class="se-match-actions">' +
            '<a class="se-btn ghost sm" href="#/robot-bien/' + b.id + '">Ouvrir la fiche</a>' +
            lienCarteRobot(b) +
            (prop.nom ? '<button class="se-btn ghost sm" data-act="robot-ajouter" data-json="' + addJson + '">Ajouter aux prospects</button>' : '') +
            (tel ? '<button class="se-btn ghost sm" data-act="copier-contact" data-value="' + esc(tel.valeur) + '">Copier tél</button>' : '') +
            (eml ? '<button class="se-btn ghost sm" data-act="copier-contact" data-value="' + esc(eml.valeur) + '">Copier email</button>' : '') +
            '<button class="se-btn ghost sm" data-act="robot-ignorer" data-id="' + b.id + '">Ignorer</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + pagination;
  }

  function secteurBarsHtml(list) {
    if (!list.length) return '<p class="se-muted" style="margin-top:8px">Aucun secteur détecté pour l’instant.</p>';
    const maxBiens = Math.max.apply(null, list.map((s) => s.biens).concat([1]));
    return '<div class="se-list" style="margin-top:8px">' + list.map((s) => {
      const pctBiens = Math.max(4, Math.round((s.biens / maxBiens) * 100));
      const pctProp = s.biens ? Math.round((s.proprietaires / s.biens) * 100) : 0;
      return '<a class="se-rowlink" href="#/robot-radar" data-act="robot-filtre-secteur" data-sec="' + esc(s.secteur) + '" style="flex-direction:column;align-items:stretch;gap:6px">' +
        '<div style="display:flex;justify-content:space-between"><b style="font-size:13.5px">' + esc(s.secteur.toUpperCase()) + '</b><span class="se-hint">' + s.matchs + ' match(s) · ' + s.verifies + ' contact(s) vérifié(s)</span></div>' +
        '<div><div class="se-hint" style="margin-bottom:2px">Logements repérés · <b>' + s.biens + '</b></div><div class="se-bar"><div class="se-bar-fill" style="width:' + pctBiens + '%"></div></div></div>' +
        '<div><div class="se-hint" style="margin-bottom:2px">Propriétaires identifiés · <b>' + s.proprietaires + '</b> (' + pctProp + ' %)</div><div class="se-bar"><div class="se-bar-fill" style="width:' + pctProp + '%;background:#1A3C34"></div></div></div>' +
      '</a>';
    }).join('') + '</div>';
  }

  function secteurDashboardHtml() {
    return '<div class="se-card" style="margin-bottom:14px"><h3>Tableau de bord par secteur</h3>' +
      '<p class="se-hint" style="margin-top:4px">Logements repérés vs propriétaires identifiés, par secteur — cliquer un secteur pour filtrer la liste ci-dessous.</p>' +
      secteurBarsHtml(secteursPrioritaires()) + '</div>';
  }

  function viewRobot() {
    const res = state.robot || null;
    const stats = robotStatsDetectes();
    return head('Prospection', 'Radar', 'Intelligence de prospection · tableau sectoriel, parcelles, propriétaires, SCI, DPE.', '') +
      tabsRobot('robot-radar') +
      secteurDashboardHtml() +
      '<div class="se-card" style="margin-bottom:14px">' +
        '<h3>Recherche &amp; filtres</h3>' +
        '<p class="se-hint" style="margin-top:4px">Lancer une recherche charge les biens correspondants ; les filtres et le tri ci-dessous s’appliquent ensuite à tout ce qui est chargé, sans relancer de recherche.</p>' +
        '<form data-form="dpe-search" style="margin-top:12px">' +
          '<div class="se-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
            '<div class="se-field" style="flex:1;min-width:200px"><label>Adresse ou ville</label><input class="se-input" name="ville" data-rr="dpe_ville" value="' + rr('dpe_ville') + '" placeholder="75011 Paris"/></div>' +
            '<div class="se-field" style="width:150px"><label>Code postal</label><input class="se-input" name="code_postal" data-rr="dpe_code_postal" value="' + rr('dpe_code_postal') + '" placeholder="75011"/></div>' +
            '<div class="se-field" style="width:130px"><label>Section</label><input class="se-input" name="section" data-rr="dpe_section" value="' + rr('dpe_section') + '" placeholder="EC"/></div>' +
            '<div class="se-field" style="width:140px"><label>N° parcelle</label><input class="se-input" name="numero" data-rr="dpe_numero" value="' + rr('dpe_numero') + '" placeholder="32"/></div>' +
          '</div>' +
          '<p class="se-hint" style="margin-top:8px">Type de bien, surface, étage, époque… se règlent une seule fois ci-dessous, dans « Filtres &amp; tri » : ils affinent aussi bien la recherche (Lancer la recherche) que l’affichage de ce qui est déjà chargé.</p>' +
        '</form>' +
        '<hr style="margin:16px 0;border:none;border-top:1px solid var(--color-stroke-faint)"/>' +
        barreFiltresRobot() +
        '<div class="se-lancer"><button class="se-btn" type="button" data-act="dpe-search">Lancer la recherche</button><span class="se-hint" id="dpe-status"></span></div>' +
      '</div>' +
      '<div class="se-chips" style="margin-bottom:10px">' + [1,2,3,4,5,6].map((lvl) => {
        const label = ['Propriétaire + tél', 'Propriétaire + email', 'Propriétaire + LinkedIn', 'Société à enrichir', 'Propriétaire sans coord', 'Non identifié'][lvl - 1];
        const count = robotBiens().filter((b) => prioriteRobot(b).level === lvl).length;
        return '<button class="se-chip" style="cursor:pointer' + (state.robotPriorite === lvl ? ' is-on' : '') + '" data-act="robot-priorite-filtre" data-niveau="' + lvl + '">' + label + ' (' + count + ')</button>';
      }).join('') + '<button class="se-chip" style="cursor:pointer' + (!state.robotPriorite ? ' is-on' : '') + '" data-act="robot-priorite-filtre" data-niveau="">Tous</button>' +
      '</div>' +
      '<div class="se-row" style="gap:8px;margin-bottom:12px;justify-content:flex-end">' +
        '<button class="se-btn ghost sm" data-act="robot-enrichir-masse">Enrichir toutes les fiches incomplètes</button>' +
        '<button class="se-btn ghost sm" data-act="robot-map-toggle">' + (state.robotShowMap ? 'Masquer la carte' : 'Afficher la carte') + '</button>' +
      '</div>' +
      (state.robotShowMap
        ? '<div class="se-split" style="align-items:start;gap:16px">' +
            '<div id="robot-map" style="height:440px;border-radius:16px;overflow:hidden;border:1px solid var(--color-stroke-faint)"></div>' +
            '<div class="se-card" style="max-height:440px;overflow:auto"><h3>Biens détectés' + (state.robotEnrichStats ? ' <span class="se-hint" style="font-weight:400">· ' + state.robotEnrichStats.enrichis + ' enrichi(s) · ' + state.robotEnrichStats.enCours + ' en cours · ' + state.robotEnrichStats.enAttente + ' en attente</span>' : '') + '</h3>' + robotBiensList() + '</div>' +
          '</div>'
        : '<div class="se-card"><h3>Biens détectés' + (state.robotEnrichStats ? ' <span class="se-hint" style="font-weight:400">· ' + state.robotEnrichStats.enrichis + ' enrichi(s) · ' + state.robotEnrichStats.enCours + ' en cours · ' + state.robotEnrichStats.enAttente + ' en attente</span>' : '') + '</h3>' + robotBiensList() + '</div>');
  }

  function initRadarCarte() {
    const el = document.getElementById('radar-carte');
    if (!el || typeof L === 'undefined' || el._leaflet_id) return;
    const pts = ((radar.data && radar.data.vues) || {}).carte || [];
    const map = L.map(el, { scrollWheelZoom: true }).setView([48.8566, 2.3422], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const coul = { forte: '#2f6b4f', moyenne: '#c07a2c', faible: '#9a9088' };
    pts.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: p.n === 'forte' ? 8 : 6, color: '#fff', weight: 1.5, fillColor: coul[p.n] || '#9a9088', fillOpacity: 0.9 }).addTo(map)
      .bindPopup('<b>' + esc(p.t) + '</b><br>' + esc(p.a) + (p.p ? '<br>' + esc(p.p) : '') + '<br>Chances : ' + p.s + '/100<br><a href="#/radar-fiche/' + encodeURIComponent(p.id) + '">Ouvrir la fiche →</a>'));
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.05));
  }
  function initRadarFicheCarte() {
    const el = document.getElementById('radar-fiche-carte');
    if (!el || typeof L === 'undefined' || el._leaflet_id) return;
    const lat = Number(el.getAttribute('data-lat')), lon = Number(el.getAttribute('data-lon'));
    const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lon], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    L.circleMarker([lat, lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#1f3b2f', fillOpacity: 0.95 }).addTo(map);
  }
  function initRobot() {
    const el = document.getElementById('robot-map');
    if (!el || typeof L === 'undefined') return;
    const map = L.map(el, { scrollWheelZoom: false }).setView([48.8566, 2.3522], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const pts = [];
    robotBiensFiltres().forEach((b) => {
      // couleur selon le statut de prospection
      let fill = '#1A3C34';               // à traiter (non analysée)
      if (b.ignore) fill = '#b0aca6';     // ignorée
      else if (b.proprietaire && b.proprietaire.nom) fill = '#1E4038'; // propriétaire identifié
      else if (b.contacts && b.contacts.length) fill = '#3D2A49';      // contacts disponibles
      const nb = (matchings() || []).filter((m) => m.bienId === b.id).length;
      const popup = '<div class="radar-pop"><b>' + esc(b.adresse || 'Parcelle') + '</b><div>' + esc(typeRobot(b)) + (b.surface_habitable_m2 != null ? ' · ' + b.surface_habitable_m2 + ' m²' : (b.contenance_cadastrale_m2 != null ? ' · parcelle ' + b.contenance_cadastrale_m2 + ' m²' : '')) + '</div><div>' + (b.proprietaire && b.proprietaire.nom ? 'Propriétaire : ' + esc(b.proprietaire.nom) : 'Propriétaire non identifié') + ' · ' + nb + ' client(s)</div><div style="margin-top:4px"><a href="#/robot-bien/' + b.id + '">Ouvrir la fiche</a></div></div>';
      // contour de parcelle (polygone) si la géométrie est disponible
      let drewPolygon = false;
      if (b.feature && b.feature.geometry && b.feature.geometry.coordinates) {
        try {
          const geo = b.feature.geometry;
          const polys = geo.type === 'Polygon' ? [geo.coordinates] : (geo.type === 'MultiPolygon' ? geo.coordinates : []);
          polys.forEach((poly) => poly.forEach((ring) => {
            if (Array.isArray(ring) && ring.length >= 3) {
              const latlngs = ring.map((pt) => [Number(pt[1]), Number(pt[0])]).filter((ll) => ll[0] > -90 && ll[0] < 90 && ll[1] > -180 && ll[1] < 180);
              if (latlngs.length >= 3) { L.polygon(latlngs, { color: '#fff', weight: 1, fillColor: fill, fillOpacity: 0.45 }).addTo(map).bindPopup(popup); drewPolygon = true; }
            }
          }));
        } catch (e) { /* géométrie invalide */ }
      }
      if (drewPolygon && b.coords && b.coords.length >= 2) pts.push([Number(b.coords[0]), Number(b.coords[1])]);
      else if (b.coords && b.coords.length >= 2) {
        const latlng = [Number(b.coords[0]), Number(b.coords[1])];
        pts.push(latlng);
        L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 2, fillColor: fill, fillOpacity: 0.9 }).addTo(map).bindPopup(popup);
      }
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1));
  }

  // Les formulaires de recherche du Robot (Radar, Recherche DPE, Recherche
  // cadastrale) n'avaient aucune valeur persistée : un simple clic sur un
  // filtre ailleurs sur la page (ex. la case SCI) déclenche un render() qui
  // reconstruit tout le HTML, donc efface ce qui venait d'être tapé et pas
  // encore validé par « Rechercher ». `rr()` relit la valeur sauvegardée
  // dans state.robotRecherche pour que les champs survivent à ces renders.
  const rr = (key) => esc((state.robotRecherche || {})[key] || '');

  function tabsRobot(active) {
    const t = (route, label) => '<a href="#/' + route + '" class="' + (active === route ? 'active' : '') + '">' + label + '</a>';
    return '<div class="se-tabs" style="margin-bottom:14px">' +
      t('robot', 'Vue d’ensemble') + t('robot-radar', 'Radar') + t('robot-proprietaires', 'Propriétaires') + t('robot-opportunites', 'Signaux vendeurs') + t('portefeuille-foncier', 'Portefeuille foncier') + t('bodacc', 'Signaux BODACC') +
    '</div>';
  }

  /* --------------------------- Signaux BODACC ------------------------------ */
  // Canal de prospection supplémentaire, en plus d'Immo Data Robot : croise les SIREN déjà repérés
  // par le Radar (biens détectés + Portefeuille foncier) avec le BODACC, l'annuaire légal public et
  // gratuit des procédures collectives. Une société/SCI propriétaire d'un bien qui apparaît en
  // liquidation ou redressement est un signal de vente potentiellement forcée — légal, public,
  // jamais exploité nativement par les CRM généralistes du marché (voir étude de marché).
  function sirensAVerifier() {
    const out = {};
    robotBiens().forEach((b) => {
      const p = b.proprietaire || {};
      if (p.siren && (p.type === 'sci' || p.type === 'societe')) {
        out[p.siren] = out[p.siren] || { siren: p.siren, nom: p.nom || '', biens: [] };
        out[p.siren].biens.push(b);
      }
    });
    (state.portefeuilleFoncier || []).forEach((s) => {
      if (s.siren) {
        out[s.siren] = out[s.siren] || { siren: s.siren, nom: s.denomination || '', biens: [] };
      }
    });
    return Object.values(out);
  }

  async function verifierBodacc() {
    const cibles = sirensAVerifier().filter((c) => !(state.bodaccAlertes && state.bodaccAlertes[c.siren]));
    if (!cibles.length) { toast('Toutes les sociétés connues ont déjà été vérifiées au BODACC.'); return; }
    state.bodaccAlertes = state.bodaccAlertes || {};
    toast('Vérification BODACC de ' + cibles.length + ' société(s)/SCI…');
    for (let i = 0; i < cibles.length; i += 3) {
      const lot = cibles.slice(i, i + 3);
      await Promise.all(lot.map(async (c) => {
        try {
          const r = await fetch('/api/robot/bodacc?siren=' + c.siren, { credentials: 'same-origin' }).then((x) => x.json());
          state.bodaccAlertes[c.siren] = (r.ok && Array.isArray(r.annonces)) ? r.annonces : [];
        } catch (e) { state.bodaccAlertes[c.siren] = state.bodaccAlertes[c.siren] || []; }
      }));
      save(); render();
    }
    const procedures = Object.values(state.bodaccAlertes).reduce((n, a) => n + a.length, 0);
    toast(procedures ? procedures + ' annonce(s) BODACC trouvée(s) sur les sociétés suivies.' : 'Aucune procédure trouvée sur les sociétés suivies.', procedures ? 'warn' : 'ok');
  }

  // Enrichissement en cascade (waterfall) : formalise la chaîne ad-hoc SIRENE → Aucadastre → Exa
  // en une séquence explicite, étape par étape, qui s'arrête dès qu'un contact exploitable est
  // trouvé, et garde la provenance de chaque résultat visible (à la Clay/Apollo).
  const CASCADE_LABELS = { sirene: 'SIRENE (dirigeants)', aucadastre: 'Aucadastre (personnes morales)', exa: 'Exa Search (coordonnées publiées)' };
  const CASCADE_BADGE = { succes: ['open', 'Trouvé'], vide: ['muted', 'Vide'], ignore: ['muted', 'Ignoré'], erreur: ['alert', 'Erreur'] };

  function cascadeStepsHtml(b) {
    const casc = b.cascadeEnrichissement;
    if (!casc || !casc.etapes || !casc.etapes.length) {
      return '<p class="se-muted" style="margin-top:10px">Lance la cascade pour voir le détail des sources interrogées, dans l’ordre, avec le résultat de chacune.</p>';
    }
    const resumeFinal = { trouve: 'contact exploitable trouvé.', partiel: 'propriétaire identifié, mais pas de contact direct — à rechercher manuellement.', introuvable: 'aucune information nouvelle.' };
    return '<div class="se-list" style="margin-top:10px">' + casc.etapes.map((e) => {
      const b2 = CASCADE_BADGE[e.statut] || ['muted', e.statut];
      return '<div class="se-list-item" style="align-items:flex-start">' +
        '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">' + esc(CASCADE_LABELS[e.cle] || e.cle) + '</div>' +
        '<div class="se-hint">' + esc(e.detail || '') + '</div></div>' +
        '<span class="se-badge ' + b2[0] + '">' + b2[1] + '</span></div>';
    }).join('') + '</div>' +
    (casc.statutFinal && casc.statutFinal !== 'en_cours' ? '<p class="se-hint" style="margin-top:10px">Résultat : ' + (resumeFinal[casc.statutFinal] || '') + '</p>' : '');
  }

  async function enrichirCascade(bienId) {
    const b = robotBien(bienId);
    if (!b) return;
    const prop = b.proprietaire || (b.proprietaire = { nom: '', type: 'inconnu', siren: '', dirigeants: [] });
    const etapes = [];
    const maj = (cle, statut, detail) => {
      etapes.push({ cle: cle, statut: statut, detail: detail });
      b.cascadeEnrichissement = { etapes: etapes.slice(), statutFinal: 'en_cours', misAJour: new Date().toISOString() };
      commit();
    };
    toast('Cascade d’enrichissement lancée — SIRENE → Aucadastre → Exa…');

    // Étape 1 — SIRENE : dirigeants de la société/SCI déjà identifiée
    if (!prop.siren) {
      maj('sirene', 'ignore', 'Pas de SIREN connu pour ce propriétaire.');
    } else if (prop.dirigeants && prop.dirigeants.length) {
      maj('sirene', 'ignore', 'Dirigeants déjà connus (' + prop.dirigeants.length + ').');
    } else {
      try {
        const r = await fetch('/api/robot/dirigeants?siren=' + encodeURIComponent(prop.siren), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.dirigeants && r.dirigeants.length) { prop.dirigeants = r.dirigeants.map((d) => d.nom).filter(Boolean); maj('sirene', 'succes', r.dirigeants.length + ' dirigeant(s) trouvé(s).'); }
        else if (r.ok) maj('sirene', 'vide', 'Aucun dirigeant publié pour ce SIREN.');
        else maj('sirene', 'erreur', r.error || 'SIRENE injoignable.');
      } catch (e) { maj('sirene', 'erreur', 'SIRENE injoignable.'); }
    }

    // Étape 2 — Aucadastre : propriétaires personnes morales de la voie, en repli si le
    // propriétaire n'est toujours pas identifié (l'étape SIRENE suppose qu'on a déjà un SIREN).
    if (prop.nom) {
      maj('aucadastre', 'ignore', 'Propriétaire déjà identifié (' + prop.nom + ').');
    } else if (!b.adresse) {
      maj('aucadastre', 'ignore', 'Pas d’adresse exploitable pour interroger la voie.');
    } else {
      try {
        const r = await fetch('/api/robot/aucadastre-owners?adresse=' + encodeURIComponent(b.adresse), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.owners && r.owners.length) {
          const o = r.owners[0];
          prop.nom = o.nom; if (!prop.type || prop.type === 'inconnu') prop.type = 'societe'; prop.siren = prop.siren || o.siren || '';
          maj('aucadastre', 'succes', 'Propriétaire retrouvé : ' + o.nom + (r.owners.length > 1 ? ' (+' + (r.owners.length - 1) + ' autre(s) sur la voie).' : '.'));
        } else if (r.ok) maj('aucadastre', 'vide', 'Aucun propriétaire personne morale recensé sur cette voie.');
        else maj('aucadastre', 'erreur', r.error || 'Aucadastre injoignable.');
      } catch (e) { maj('aucadastre', 'erreur', 'Aucadastre injoignable.'); }
    }

    // Étape 3 — Exa : coordonnées publiées (téléphone). On cherche sur le nom du propriétaire
    // (société/SCI/personne), ou à défaut sur le premier dirigeant trouvé à l'étape SIRENE —
    // sinon une société identifiée sans nom encore connu bloquerait cette étape pour rien.
    const contacts = b.contacts || (b.contacts = []);
    const sujetExa = prop.nom || (prop.dirigeants && prop.dirigeants[0]) || '';
    if (!sujetExa) {
      maj('exa', 'ignore', 'Aucun nom de propriétaire ni dirigeant à rechercher.');
    } else if (contacts.some((c) => c.type === 'tel')) {
      maj('exa', 'ignore', 'Un contact téléphonique est déjà enregistré.');
    } else {
      try {
        const requetes = ['"' + sujetExa + '" téléphone contact', '"' + sujetExa + '" coordonnées siège'];
        const telTrouves = new Set();
        let erreurExa = null;
        for (const q of requetes) {
          const r = await fetch('/api/robot/exa-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ query: q }) }).then((x) => x.json());
          if (r.ok && r.results) r.results.forEach((res) => { ((res.text || '').match(/0[1-9](?:[ .-]?\d{2}){4}/g) || []).forEach((n) => telTrouves.add(n.replace(/[ .-]/g, ''))); });
          else if (r.error) erreurExa = r.error;
        }
        if (telTrouves.size) {
          telTrouves.forEach((n) => contacts.push({ type: 'tel', valeur: n, source: 'Exa (publication web)', verification: 'FOUND_UNVERIFIED' }));
          maj('exa', 'succes', telTrouves.size + ' numéro(s) trouvé(s) — à vérifier.');
        } else if (erreurExa && /EXA_API_KEY/i.test(erreurExa)) {
          maj('exa', 'ignore', 'Clé Exa non configurée côté serveur.');
        } else {
          maj('exa', 'vide', 'Aucun numéro public trouvé.');
        }
      } catch (e) { maj('exa', 'erreur', 'Exa injoignable.'); }
    }

    const contactTrouve = contacts.some((c) => c.type === 'tel' || c.type === 'email');
    b.cascadeEnrichissement.statutFinal = contactTrouve ? 'trouve' : (prop.nom ? 'partiel' : 'introuvable');
    commit();
    toast(contactTrouve ? 'Cascade terminée — contact trouvé.' : prop.nom ? 'Cascade terminée — propriétaire identifié, pas de contact direct.' : 'Cascade terminée — rien trouvé.', contactTrouve ? 'ok' : 'warn');
  }

  function viewBodacc() {
    const cibles = sirensAVerifier();
    const alertes = state.bodaccAlertes || {};
    const verifiees = cibles.filter((c) => alertes[c.siren]);
    const avecProcedure = verifiees.filter((c) => (alertes[c.siren] || []).length > 0);
    const rows = avecProcedure.length
      ? '<div class="se-list" style="margin-top:10px">' + avecProcedure.map((c) => {
          const annonces = alertes[c.siren] || [];
          const derniere = annonces[0] || {};
          return '<div class="se-list-item" style="align-items:flex-start">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:14px;font-weight:600">' + esc(c.nom || c.siren) + ' <span class="se-badge warn">' + esc(derniere.natureJugement || derniere.familleavis || 'Procédure BODACC') + '</span></div>' +
              '<div class="se-hint">SIREN ' + esc(c.siren) + (derniere.tribunal ? ' · ' + esc(derniere.tribunal) : '') + (derniere.dateparution ? ' · publié le ' + dFR(derniere.dateparution) : '') + ' · ' + annonces.length + ' annonce(s)</div>' +
              (c.biens.length ? '<div class="se-hint" style="margin-top:4px">Bien(s) suivi(s) : ' + c.biens.map((b) => '<a href="#/robot-bien/' + b.id + '">' + esc(b.adresse || 'bien') + '</a>').join(', ') + '</div>' : '') +
            '</div>' +
            (c.biens[0] ? '<button class="se-btn ghost sm" data-act="robot-tache" data-id="' + c.biens[0].id + '">Créer une tâche</button>' : '') +
          '</div>';
        }).join('') + '</div>'
      : '<p class="se-muted" style="margin-top:10px">' + (verifiees.length ? 'Aucune procédure collective en cours sur les sociétés vérifiées.' : 'Aucune société vérifiée pour l’instant.') + '</p>';
    return head('Prospection', 'Signaux BODACC', 'Procédures collectives (liquidation, redressement) touchant les sociétés et SCI déjà repérées par le Radar — source publique et gratuite, data.gouv.fr.', '') +
      tabsRobot('bodacc') +
      '<div class="se-card" style="margin-bottom:14px">' +
        '<div class="se-row" style="justify-content:space-between;align-items:center">' +
          '<div><h3>Vérification BODACC</h3><p class="se-hint" style="margin-top:4px">' + cibles.length + ' société(s)/SCI connue(s) · ' + verifiees.length + ' déjà vérifiée(s)</p></div>' +
          '<button class="se-btn" data-act="bodacc-verifier">Vérifier au BODACC</button>' +
        '</div>' +
      '</div>' +
      '<div class="se-card"><h3>Procédures collectives détectées (' + avecProcedure.length + ')</h3>' + rows + '</div>';
  }

  function secteursPrioritaires() {
    const biens = robotBiens();
    const ms = matchings();
    const map = {};
    biens.forEach((b) => {
      const sec = b.ville || 'Secteur inconnu';
      map[sec] = map[sec] || { secteur: sec, biens: 0, proprietaires: 0, verifies: 0, matchs: 0 };
      map[sec].biens++;
      if (b.proprietaire && b.proprietaire.nom) map[sec].proprietaires++;
      if ((b.contacts || []).some((c) => c.verification === 'VERIFIED')) map[sec].verifies++;
    });
    ms.forEach((m) => {
      const b = robotBien(m.bienId);
      const sec = b ? (b.ville || 'Secteur inconnu') : 'Secteur inconnu';
      if (map[sec]) map[sec].matchs++;
    });
    return Object.values(map).sort((a, b) => b.biens - a.biens);
  }

  function dernieresDetections() {
    const biens = robotBiens().slice().sort((a, b) => new Date(b.dateDetection || 0) - new Date(a.dateDetection || 0)).slice(0, 5);
    if (!biens.length) return '<p class="se-muted" style="margin-top:8px">Aucune détection pour l’instant.</p>';
    return '<div class="se-list" style="margin-top:6px">' + biens.map((b) => {
      const sc = scorePriorite(b);
      return '<a class="se-rowlink" href="#/robot-bien/' + b.id + '">' +
        '<div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(typeRobot(b)) + (b.surface_habitable_m2 != null ? ' · ' + b.surface_habitable_m2 + ' m²' : '') + '</div>' +
        '<div class="se-hint">' + esc(b.adresse || 'Adresse inconnue') + '</div></div>' +
        '<span class="se-badge ' + (sc.score != null ? 'open' : 'muted') + '">' + (sc.score != null ? sc.score : '—') + '</span>' +
      '</a>';
    }).join('') + '</div>';
  }

  function prioriteRobot(b) {
    const prop = b.proprietaire || {};
    const cs = b.contacts || [];
    const telVerifie = cs.some((c) => c.type === 'tel' && c.verification === 'VERIFIED');
    const emailVerifie = cs.some((c) => c.type === 'email' && c.verification === 'VERIFIED');
    const linkedin = cs.some((c) => c.type === 'linkedin');
    if (prop.nom && telVerifie) return { level: 1, label: 'Propriétaire + téléphone' };
    if (prop.nom && emailVerifie) return { level: 2, label: 'Propriétaire + email' };
    if (prop.nom && linkedin) return { level: 3, label: 'Propriétaire + LinkedIn' };
    if (prop.nom && prop.type !== 'personne') return { level: 4, label: 'Société à enrichir' };
    if (prop.nom) return { level: 5, label: 'Propriétaire sans coordonnées' };
    return { level: 6, label: 'Non identifié' };
  }

  function typeRobot(b) {
    if (b.type) return b.type;
    if (b.contenance_cadastrale_m2 != null) return 'Parcelle';
    return 'Bien non typé';
  }

  function rappelsRobot() {
    const today = new Date().toDateString();
    const taches = (state.taches || []).filter((t) => !t.fait);
    const enRetard = taches.filter((t) => t.echeance && new Date(t.echeance) < new Date(today));
    const duJour = taches.filter((t) => t.echeance && new Date(t.echeance).toDateString() === today);
    if (!enRetard.length && !duJour.length) return '<p class="se-muted" style="margin-top:8px">Aucune relance en attente.</p>';
    let h = '<div class="se-list" style="margin-top:6px">';
    enRetard.slice(0, 4).forEach((t) => {
      h += '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(t.titre) + '</div><div class="se-hint late">En retard</div></div><a class="se-btn ghost sm" href="#/taches">Voir</a></div>';
    });
    duJour.slice(0, 4).forEach((t) => {
      h += '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(t.titre) + '</div><div class="se-hint">Aujourd\'hui</div></div><a class="se-btn ghost sm" href="#/taches">Voir</a></div>';
    });
    return h + '</div>';
  }

  function viewRobotDashboard() {
    const biens = robotBiens();
    const ms = matchings();
    const ids = new Set(ms.map((m) => m.bienId));
    const stats = {
      total: biens.length,
      nouveaux: biens.filter((b) => b.statutProspection === 'nouveau').length,
      proprio: biens.filter((b) => b.proprietaire && b.proprietaire.nom).length,
      sci: biens.filter((b) => b.proprietaire && b.proprietaire.type === 'sci').length,
      verifies: biens.filter((b) => (b.contacts || []).some((c) => c.verification === 'VERIFIED')).length,
      avecMatch: ids.size,
      forts: ms.filter((m) => m.score >= 75).length,
      etudier: ms.filter((m) => m.score >= 40 && m.score < 75).length,
      sans: biens.length - ids.size,
      clients: new Set(ms.map((m) => m.clientId)).size
    };
    const ind = (kicker, num, route, sub) => '<a class="se-card se-stat se-stat-link" href="#/' + route + '"><span class="se-kicker">' + kicker + '</span><span class="se-num">' + num + '</span><span class="se-sub">' + sub + '</span></a>';
    return head('Prospection', 'Immo Data Robot', 'Le Radar détecte les biens. Le CRM connaît les clients. Le Robot rapproche les deux.', '') +
      tabsRobot('robot') +
      '<div class="se-card" style="margin-bottom:14px">' +
        '<h3>Recherche cadastrale (moteur Python)</h3>' +
        '<p class="se-hint" style="margin-top:4px">Différente de la recherche DPE de l’onglet « Radar » : celle-ci passe par le moteur Python dédié (cadastre + dossier propriétaire), quand il est configuré et lancé.</p>' +
        '<form class="se-form-grid" data-form="robot-search" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
          '<div class="se-field"><label>Adresse</label><input class="se-input" name="adresse" data-rr="cad_adresse" value="' + rr('cad_adresse') + '" placeholder="12 boulevard Flandrin"/></div>' +
          '<div class="se-field"><label>Ville</label><input class="se-input" name="ville" data-rr="cad_ville" value="' + rr('cad_ville') + '" placeholder="Paris"/></div>' +
          '<div class="se-field"><label>Code postal</label><input class="se-input" name="code_postal" data-rr="cad_code_postal" value="' + rr('cad_code_postal') + '" placeholder="75116"/></div>' +
          '<div class="se-field"><label>Section cadastrale</label><input class="se-input" name="section" data-rr="cad_section" value="' + rr('cad_section') + '" placeholder="EC"/></div>' +
          '<div class="se-field"><label>Numéro de parcelle</label><input class="se-input" name="numero" data-rr="cad_numero" value="' + rr('cad_numero') + '" placeholder="32"/></div>' +
          '<div class="se-field"><label>DPE (A–G)</label><input class="se-input" name="dpe" data-rr="cad_dpe" value="' + rr('cad_dpe') + '" maxlength="1" placeholder="E"/></div>' +
        '</form>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:12px">' +
          '<button class="se-btn" data-act="robot-search">Lancer la recherche</button>' +
          '<span class="se-hint" id="robot-status"></span>' +
        '</div>' +
      '</div>' +
      '<div class="se-grid cols-4" style="margin-bottom:14px">' +
        ind('Biens détectés', stats.total, 'robot-radar', 'portefeuille radar') +
        ind('Nouveaux biens', stats.nouveaux, 'robot-radar', 'détections récentes') +
        ind('Propriétaires identifiés', stats.proprio, 'robot-radar', 'enrichissement') +
        ind('Biens en SCI', stats.sci, 'robot-radar', 'personnes morales') +
      '</div>' +
      '<div class="se-grid cols-4" style="margin-bottom:14px">' +
        ind('Contacts vérifiés', stats.verifies, 'robot-radar', 'VERIFIED') +
        ind('Biens avec correspondance', stats.avecMatch, 'robot-opportunites', '1+ client') +
        ind('Correspondances fortes', stats.forts, 'robot-opportunites', 'score ≥ 75') +
        ind('À étudier', stats.etudier, 'robot-opportunites', 'score 40–74') +
      '</div>' +
      '<div class="se-grid cols-4">' +
        ind('Sans acquéreur', stats.sans, 'robot-radar', 'à qualifier') +
        ind('Clients concernés', stats.clients, 'robot-opportunites', 'nouvelles opportunités') +
        '<div class="se-card se-stat"><span class="se-kicker">Correspondances</span><span class="se-num">' + ms.length + '</span><span class="se-sub">couples bien × recherche</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Pipeline</span><span class="se-num">' + Object.keys(ST_MATCHING).length + '</span><span class="se-sub">statuts commerciaux</span></div>' +
      '</div>' +
      '<div class="se-grid cols-3" style="margin-top:16px">' +
        '<div class="se-card"><h3>Secteurs prioritaires</h3>' +
          '<div class="se-list" style="margin-top:8px">' + secteursPrioritaires().slice(0, 8).map((s) => {
            const pct = s.biens ? Math.round(s.proprietaires / s.biens * 100) : 0;
            return '<a class="se-rowlink" href="#/robot-radar" data-act="robot-filtre-secteur" data-sec="' + esc(s.secteur) + '">' +
              '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">' + esc(s.secteur.toUpperCase()) + '</div>' +
              '<div class="se-hint">' + s.biens + ' logement(s) · ' + s.proprietaires + ' propriétaire(s) · ' + s.verifies + ' contact(s) vérifié(s) · ' + s.matchs + ' match(s)</div>' +
              '<div class="se-bar" style="margin-top:6px"><div class="se-bar-fill" style="width:' + pct + '%"></div></div></div>' +
              '<span class="se-hint" style="flex:0 0 auto;margin-left:8px">' + pct + '%</span>' +
            '</a>';
          }).join('') + '</div>' +
          (!secteursPrioritaires().length ? '<p class="se-muted" style="margin-top:8px">Aucun secteur détecté.</p>' : '') +
        '</div>' +
        '<div class="se-card"><h3>Dernières détections</h3>' + dernieresDetections() + '</div>' +
        '<div class="se-card"><h3>Relances</h3>' + rappelsRobot() + '</div>' +
      '</div>';
  }

  function explicationMatching(m, rb, rec) {
    const s = scoreRobotBien(rb, rec);
    const connus = s.inconnus.length;
    const manquants = s.inconnus.slice(0, 3);
    let txt = 'Ce bien correspond à ' + (ROBOT_CRITERES_TOTAL - connus) + ' des ' + ROBOT_CRITERES_TOTAL + ' critères de la recherche.';
    if (manquants.length) txt += ' À confirmer : ' + manquants.join(', ') + '.';
    txt += ' Couverture : ' + s.couverture + ' %.';
    return txt;
  }

  async function synchroniserPermis() {
    const biens = robotBiens();
    const insees = new Set();
    biens.forEach((b) => {
      const insee = postalToInsee(b.codePostal) || b.codeInsee;
      if (insee) insees.add(insee);
    });
    if (!insees.size) { toast('Aucune commune identifiée (code postal / INSEE manquant sur les biens).', 'warn'); return; }
    toast('Synchronisation des permis sur ' + insees.size + ' commune(s)…');
    const all = [];
    for (const insee of insees) {
      try {
        const r = await fetch('/api/robot/aucadastre/commune/' + encodeURIComponent(insee) + '/permits', { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.permits) all.push(...r.permits);
      } catch (e) { /* commune en erreur */ }
    }
    state.permis = all;
    commit(); render();
    toast(all.length + ' permis synchronisés sur ' + insees.size + ' commune(s).', 'ok');
  }

  function permisPourBien(b) {
    const permis = state.permis || [];
    const siren = (b.proprietaire && b.proprietaire.siren) || '';
    const adresseNorm = String((b.adresse || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
    return permis.filter((p) => {
      if (siren && p.applicant_siren && String(p.applicant_siren) === siren) return true;
      const wa = String((p.works_address || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
      return adresseNorm && wa && (wa.indexOf(adresseNorm.slice(0, 30)) > -1 || adresseNorm.indexOf(wa.slice(0, 30)) > -1);
    });
  }

  function signauxVendeurs() {
    const biens = robotBiens();
    const signaux = [];
    biens.forEach((b) => {
      const prop = b.proprietaire || {};
      if (b.dpe === 'F' || b.dpe === 'G') {
        signaux.push({ bien: b, nature: 'Passoire thermique', explication: 'DPE classe ' + b.dpe + ' — interdiction progressive de location', source: 'ADEME', intensite: 'forte' });
      }
      // Idée reprise d'outils de prospection concurrents (ex. Bluu chez Guy
      // Hoquet) : un DPE commandé récemment précède souvent un projet de
      // vente ou de mise en location — ce n'est jamais une certitude, mais
      // un DPE qui vient d'être réalisé est un moment propice pour approcher
      // le propriétaire pendant qu'il réfléchit encore à son projet.
      const joursDpe = joursDepuis(b.dpeDate);
      if (joursDpe != null && joursDpe <= 180) {
        const mois = Math.max(1, Math.round(joursDpe / 30));
        signaux.push({ bien: b, nature: 'DPE récent', explication: 'DPE réalisé il y a environ ' + mois + ' mois — souvent le signe d’un projet de vente ou de location en préparation (indice, pas une certitude)', source: 'ADEME', intensite: joursDpe <= 60 ? 'forte' : 'moyenne' });
      }
      if (b.dvfMutations && b.dvfMutations.length) {
        const d = b.dvfMutations[0];
        signaux.push({ bien: b, nature: 'Mutation récente', explication: 'Vente du ' + d.date + ' · ' + d.valeur + ' €', source: 'DVF', intensite: 'moyenne' });
      }
      const detention = dureeDetentionInfo(b);
      if (detention && detention.niveau !== 'faible') {
        signaux.push({ bien: b, nature: 'Détention longue', explication: detention.label, source: 'DVF (durée de détention)', intensite: detention.niveau });
      }
      if (b.confidence_owner != null && b.confidence_owner < 50 && prop.nom) {
        signaux.push({ bien: b, nature: 'Propriétaire à confirmer', explication: 'Identification à confirmer (confiance ' + b.confidence_owner + ' %)', source: 'FPMU', intensite: 'faible' });
      }
      (permisPourBien(b) || []).slice(0, 3).forEach((p) => {
        const nature = { demolition: 'Permis de démolition', construction: 'Permis de construire', extension: 'Extension', surelevation: 'Surélévation', reabilitation: 'Réhabilitation' }[p.family] || 'Autorisation d’urbanisme';
        signaux.push({ bien: b, nature: nature, explication: (p.state || '') + ' · ' + (p.date || '') + ' · ' + (p.applicant || '') + (p.works_address ? ' · ' + p.works_address : ''), source: 'Aucadastre (urbanisme)', intensite: p.family === 'demolition' ? 'forte' : 'moyenne' });
      });
    });
    return signaux;
  }

  function viewOpportunites() {
    const ms = matchings();
    const recherches = (state.recherchesServeur || []).concat(state.recherches);

    // Un bien peut correspondre à plusieurs recherches : on groupe par bien et
    // on annonce un nombre de correspondances en langage clair plutôt qu'un
    // score en %, qui n'aide pas l'agent à savoir quoi faire.
    const parBien = {};
    ms.forEach((m) => { (parBien[m.bienId] = parBien[m.bienId] || []).push(m); });
    const groupes = Object.keys(parBien).map((bid) => {
      const items = parBien[bid].slice().sort((a, b) => b.score - a.score);
      const rb = robotBien(bid);
      return { bienId: bid, rb: rb, items: items, dateDetection: (rb && rb.dateDetection) || '' };
    }).sort((a, b) => (b.dateDetection || '').localeCompare(a.dateDetection || ''));

    const rows = groupes.map((g) => {
      const rb = g.rb;
      const clientsHtml = g.items.map((m) => {
        const rec = recherches.find((r) => r.id === m.rechercheId) || {};
        const cli = clientDeRecherche(rec);
        const statuts = Object.keys(ST_MATCHING).map((k) =>
          '<button class="se-btn ghost sm' + (m.statut === k ? ' is-on' : '') + '" data-act="matching-statut" data-key="' + m.key + '" data-statut="' + k + '">' + ST_MATCHING[k] + '</button>').join('');
        return '<div class="se-list-item" style="align-items:flex-start;flex-direction:column;gap:6px">' +
          '<div class="se-row" style="width:100%;justify-content:space-between">' +
            '<a href="#/client/' + (cli ? cli.id : '') + '" style="font-size:13.5px;font-weight:500">' + (cli ? esc(nomClient(cli)) : '—') + '</a>' +
            '<span class="se-badge ' + (m.statut === 'nouveau' ? 'warn' : 'muted') + '">' + (ST_MATCHING[m.statut] || m.statut) + '</span>' +
          '</div>' +
          '<div class="se-hint">' + (rec.titre ? esc(rec.titre) : 'Recherche') + (rec.prixMax ? ' · budget ' + euro(rec.prixMax) : '') + '</div>' +
          '<div class="se-hint" style="line-height:1.5">' + explicationMatching(m, rb || {}, rec) + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px">' + statuts +
            (m.relancesCreees
              ? '<span class="se-hint">Relances programmées</span>'
              : (cli ? '<button class="se-btn ghost sm" data-act="matching-relancer" data-key="' + m.key + '">Programmer les relances (J+1/J+3/J+7)</button>' : '')) +
          '</div>' +
        '</div>';
      }).join('');
      return '<div class="se-card" style="margin-bottom:12px">' +
        '<div class="se-row" style="justify-content:space-between;align-items:flex-start">' +
          '<div style="min-width:0"><b style="font-weight:600">' + esc((rb && rb.adresse) || 'Bien') + '</b>' +
          '<div class="se-hint">' + esc((rb && rb.type) || '') + (rb && rb.ville ? ' · ' + esc(rb.ville) : '') + (rb && rb.surface_habitable_m2 != null ? ' · ' + rb.surface_habitable_m2 + ' m² hab.' : (rb && rb.contenance_cadastrale_m2 != null ? ' · parcelle ' + rb.contenance_cadastrale_m2 + ' m²' : '')) + (rb && rb.dpe ? ' · DPE ' + esc(rb.dpe) : '') + (rb && rb.etageEstime ? ' · étage ' + esc(rb.etageEstime) + ' (estimé)' : '') + '</div></div>' +
          '<div style="text-align:right;flex:0 0 auto">' +
            '<span class="se-badge open">Correspond à ' + g.items.length + ' recherche' + (g.items.length > 1 ? 's' : '') + '</span>' +
            (rb ? '<div style="margin-top:6px"><a class="se-btn ghost sm" href="#/robot-bien/' + rb.id + '">Démarcher</a></div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="se-list" style="margin-top:10px">' + clientsHtml + '</div>' +
      '</div>';
    }).join('');

    // Pour que l'agent ait toujours de la matière : les recherches actives
    // encore sans opportunité (ou avec peu) sont mises en avant, avec un
    // accès direct pour lancer une recherche DPE publique ciblée dessus.
    const actives = recherches.filter((r) => r.statut !== 'archivee');
    const aDemarcher = actives.map((r) => ({ r: r, n: ms.filter((m) => m.rechercheId === r.id).length }))
      .sort((a, b) => (a.n - b.n) || (b.r.cree || '').localeCompare(a.r.cree || ''));
    const demarcheHtml = aDemarcher.length
      ? '<div class="se-list" style="margin-top:10px">' + aDemarcher.map(({ r, n }) => {
          const cli = client(r.clientId);
          const secteurs = (r.quartiers || []).map(qLabel).join(', ');
          return '<div class="se-list-item">' +
            '<div style="flex:1;min-width:0"><a href="#/recherche/' + r.id + '" style="font-size:13.5px;font-weight:500">' + esc(r.titre) + '</a>' +
            '<div class="se-hint">' + (cli ? esc(nomClient(cli)) : '—') + (secteurs ? ' · ' + esc(secteurs) : ' · aucun secteur défini') + '</div></div>' +
            '<span class="se-badge ' + (n ? 'open' : 'muted') + '">' + n + ' opportunité' + (n > 1 ? 's' : '') + '</span>' +
            (secteurs ? '<button class="se-btn ghost sm" data-act="recherche-dpe-opportunite" data-id="' + r.id + '">Chercher des biens DPE</button>' : '<span class="se-hint">Ajoutez un secteur pour lancer une recherche</span>') +
          '</div>';
        }).join('') + '</div>'
      : '<p class="se-muted" style="margin-top:10px">Aucune recherche active pour l’instant.</p>';

    const signaux = signauxVendeurs();
    const signauxHtml = signaux.length
      ? '<div class="se-list" style="margin-top:10px">' + signaux.map((s) => '<div class="se-list-item">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13.5px;font-weight:600">' + esc(s.nature) + ' <span class="se-badge ' + (s.intensite === 'forte' ? 'open' : 'muted') + '">' + s.intensite + '</span></div>' +
            '<div class="se-hint">' + esc((s.bien.adresse) || 'Bien') + ' · ' + esc(s.explication) + '</div>' +
          '</div>' +
          '<a class="se-btn ghost sm" href="#/robot-bien/' + s.bien.id + '">Voir le bien</a>' +
        '</div>').join('') + '</div>'
      : '<p class="se-muted" style="margin-top:10px">Aucun signal vendeur détecté pour l’instant.</p>';
    return head('Prospection', 'Signaux vendeurs', 'Événements et indices pouvant annoncer une vente. Un indice n’est jamais une certitude.', '') +
      tabsRobot('robot-opportunites') +
      '<div class="se-row" style="gap:8px;margin-bottom:12px;justify-content:flex-end"><button class="se-btn ghost sm" data-act="synchroniser-permis">Synchroniser les permis</button></div>' +
      '<div class="se-card"><h3>' + signaux.length + ' signal(s) vendeur(s)</h3>' + signauxHtml + '</div>' +
      '<div class="se-card" style="margin-top:16px">' + moteurDpeQuotidienHtml() + '</div>' +
      '<div class="se-card" style="margin-top:16px"><h3>Recherches à démarcher</h3><p class="se-muted">Pour toujours avoir des biens à proposer : lancez une recherche DPE publique ciblée sur les recherches qui ont le moins d’opportunités.</p>' + demarcheHtml + '</div>' +
      '<div class="se-card" style="margin-top:16px"><h3>Opportunités clients</h3>' + (groupes.length ? rows : '<p class="se-muted" style="margin-top:10px">Aucune correspondance acquéreur.</p>') + '</div>';
  }

  // Statut du moteur quotidien (voir server.js : planifierScanDpeQuotidien /
  // scannerDpeRecherchesActives) — tourne tout seul en production une fois
  // par jour sur toutes les recherches actives ; ce bouton permet en plus à
  // l'agent de le relancer tout de suite sans attendre le lendemain.
  function moteurDpeQuotidienHtml() {
    const log = (state.dpeScanLog || [])[0];
    const nonPromus = (state.dpeAuto || []).filter((b) => !(state.robotBiens || []).some((x) => adresseKey(x.adresse) === adresseKey(b.adresse)));
    return '<div class="se-row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
      '<div><h3>Moteur quotidien DPE</h3>' +
      '<p class="se-hint" style="margin-top:4px">' + (log
        ? 'Dernier passage ' + ilYa(log.at) + ' · ' + log.recherchesScannees + ' recherche(s) scannée(s) · ' + log.biensAjoutes + ' nouveau(x) bien(s)' + (log.erreurs && log.erreurs.length ? ' · ' + log.erreurs.length + ' secteur(s) en erreur' : '')
        : 'Aucun passage enregistré pour l’instant.') + '</p></div>' +
      '<button class="se-btn ghost sm" data-act="dpe-scan-quotidien">Lancer le scan maintenant</button>' +
      '</div>' +
      (nonPromus.length ? '<div class="se-list" style="margin-top:10px">' + nonPromus.slice(0, 5).map((b) => '<a class="se-rowlink" href="#/robot-bien/' + b.id + '"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(b.adresse || 'Adresse inconnue') + '</div><div class="se-hint">' + esc(b.type || '') + (b.surface_habitable_m2 != null ? ' · ' + b.surface_habitable_m2 + ' m²' : '') + (b.dpe ? ' · DPE ' + esc(b.dpe) : '') + '</div></div><span class="se-badge warn">Non ajouté au Radar</span></a>').join('') + '</div>' +
        (nonPromus.length > 5 ? '<p class="se-hint" style="margin-top:6px">+ ' + (nonPromus.length - 5) + ' autre(s) détection(s) non traitée(s).</p>' : '')
        : '');
  }

  // Identité sociale d'un propriétaire/dirigeant (personne physique) détecté par le Radar.
  // On ne scrape ni ne devine un profil précis (risque de cibler la mauvaise personne et de
  // violer la vie privée) : on ouvre la recherche officielle du réseau, affinée avec le plus
  // de critères connus (société, ville) pour réduire mécaniquement les homonymes, et on donne
  // en plus des indices de recoupement publics (autres mandats RNE) pour que l'agent tranche
  // lui-même lequel des résultats correspond — jamais un profil choisi à sa place.
  function motsClesIdentite(nom, contexte) { return contexte ? nom + ' ' + contexte : nom; }
  function lienLinkedIn(nom, contexte) { return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(motsClesIdentite(nom, contexte)); }
  function lienInstagram(nom, contexte) { return 'https://www.instagram.com/explore/search/keyword/?q=' + encodeURIComponent(motsClesIdentite(nom, contexte)); }

  function recoupementHtml(nom) {
    const r = (state.recoupements || {})[nom];
    if (!r) {
      return '<button class="se-btn ghost sm" style="margin-top:8px" data-act="chercher-recoupement" data-nom="' + esc(nom) + '">' + ICONS.search + ' Chercher ses autres mandats (RNE, gratuit)</button>' +
        '<p class="se-hint" style="margin-top:4px">Les autres sociétés où cette personne est dirigeante (secteur, ville) sont un indice public pour reconnaître le bon profil parmi les homonymes.</p>';
    }
    if (r.chargement) return '<p class="se-hint" style="margin-top:8px">Recherche des autres mandats en cours…</p>';
    if (r.erreur) return '<p class="se-muted" style="margin-top:8px">Le Répertoire national des entreprises (RNE) n’a pas répondu — ce n’est pas que la personne n’a aucun autre mandat, la recherche a simplement échoué. <button class="se-btn ghost sm" data-act="chercher-recoupement" data-nom="' + esc(nom) + '" style="margin-left:4px">Réessayer</button></p>';
    if (!r.mandats.length) return '<p class="se-hint" style="margin-top:8px">Aucun autre mandat trouvé pour ce nom dans le RNE — soit la personne n’en a pas d’autre déclaré, soit l’homonymie rend le recoupement impossible par cette voie.</p>';
    return '<div class="se-kv" style="margin-top:8px">' +
      r.mandats.map((m) => kv(esc(m.entreprise), (m.ville ? esc(m.ville) : 'ville inconnue') + (m.role ? ' · ' + esc(m.role) : ''))).join('') +
      '</div>' +
      '<p class="se-hint" style="margin-top:6px">Comparez ces sociétés et villes avec ce qu’affiche le profil LinkedIn trouvé (employeur actuel/passé, localisation) pour confirmer qu’il s’agit bien de la même personne.</p>';
  }

  // Coordonnées pro (email/téléphone) : cascade sur plusieurs annuaires B2B freemium
  // (Societeinfo, Dropcontact, Datagma côté serveur) + enrichissement Kaspr d'un profil
  // LinkedIn que l'agent a lui-même confirmé. On ne bascule jamais en payant tout seul : si
  // tous les quotas gratuits sont épuisés, on le dit clairement plutôt que de dépenser de
  // l'argent réel sans accord explicite à chaque fois.
  function coordonneesProHtml(nom, societeNom, siren) {
    const r = (state.coordonneesPro || {})[nom];
    const attrs = ' data-nom="' + esc(nom) + '" data-societe="' + esc(societeNom || '') + '" data-siren="' + esc(siren || '') + '"';
    let bloc;
    if (!r) {
      bloc = '<button class="se-btn ghost sm" style="margin-top:8px"' + attrs + ' data-act="chercher-coordonnees-pro">' + ICONS.mail + ' Chercher un email/téléphone pro (gratuit)</button>' +
        '<p class="se-hint" style="margin-top:4px">Essaie successivement Societeinfo, Dropcontact puis Datagma (annuaires professionnels légaux) et s’arrête au premier résultat — seuls ceux dont la clé est configurée sont utilisés.</p>';
    } else if (r.chargement) {
      bloc = '<p class="se-hint" style="margin-top:8px">Recherche en cours sur les annuaires professionnels…</p>';
    } else if (r.erreur) {
      bloc = '<p class="se-muted" style="margin-top:8px">La recherche a échoué (problème réseau). <button class="se-btn ghost sm"' + attrs + ' data-act="chercher-coordonnees-pro" style="margin-left:4px">Réessayer</button></p>';
    } else if (r.trouve) {
      bloc = '<div class="se-kv" style="margin-top:8px">' +
        (r.email ? kv('Email pro', esc(r.email)) : '') +
        (r.telephone ? kv('Téléphone pro', esc(r.telephone)) : '') +
        '</div><p class="se-hint" style="margin-top:4px">Source : ' + esc(r.source) + ' — coordonnée d’annuaire (parfois générique à l’entreprise plutôt qu’à la personne), à vérifier avant tout envoi.</p>';
    } else if (r.tousEpuises) {
      bloc = '<p class="se-muted" style="margin-top:8px">Quotas gratuits épuisés sur tous les annuaires configurés (ou aucun n’est configuré). Passer en payant n’est jamais automatique — demandez-le explicitement si vous voulez activer un plan payant sur l’un d’eux.</p>';
    } else {
      bloc = '<p class="se-hint" style="margin-top:8px">Rien trouvé sur les annuaires essayés (' + ((r.etapes || []).map((e) => esc(e.fournisseur)).join(', ') || 'aucun fournisseur configuré') + ').</p>' +
        '<button class="se-btn ghost sm" style="margin-top:6px"' + attrs + ' data-act="chercher-coordonnees-pro">Réessayer</button>';
    }
    return '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--color-stroke-faint)">' + bloc + coordonneesLinkedinHtml(nom) + '</div>';
  }

  function coordonneesLinkedinHtml(nom) {
    const r = (state.coordonneesPro || {})[nom + '__linkedin'];
    let bloc = '<div style="margin-top:10px"><label class="se-hint" style="display:block;margin-bottom:4px">Profil LinkedIn confirmé ci-dessus ? Collez son URL pour tenter un enrichissement direct (Kaspr) :</label>' +
      '<div class="se-row" data-stop style="gap:6px;flex-wrap:wrap">' +
      '<input type="text" class="se-input li-url-input" style="flex:1;min-width:200px" placeholder="https://www.linkedin.com/in/…"/>' +
      '<button class="se-btn ghost sm" data-act="enrichir-linkedin" data-nom="' + esc(nom) + '">Enrichir (Kaspr)</button>' +
      '</div></div>';
    if (r) {
      if (r.chargement) bloc += '<p class="se-hint" style="margin-top:6px">Enrichissement Kaspr en cours…</p>';
      else if (r.trouve) bloc += '<div class="se-kv" style="margin-top:6px">' + (r.email ? kv('Email pro', esc(r.email)) : '') + (r.telephone ? kv('Téléphone pro', esc(r.telephone)) : '') + '</div>';
      else if (r.epuise) bloc += '<p class="se-muted" style="margin-top:6px">Quota Kaspr gratuit épuisé. Passer en payant n’est pas automatique.</p>';
      else if (r.erreur) bloc += '<p class="se-muted" style="margin-top:6px">' + esc(r.erreur) + '</p>';
      else bloc += '<p class="se-hint" style="margin-top:6px">Rien trouvé pour ce profil.</p>';
    }
    return bloc;
  }

  function reseauxSociauxHtml(nom, label, contexte, societeNom, siren) {
    if (!nom) return '';
    return '<div class="se-row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<a class="se-btn ghost sm" target="_blank" rel="noopener" href="' + esc(lienLinkedIn(nom, contexte)) + '">' + ICONS.out + ' LinkedIn</a>' +
      '<a class="se-btn ghost sm" target="_blank" rel="noopener" href="' + esc(lienInstagram(nom, contexte)) + '">' + ICONS.out + ' Instagram</a>' +
      '</div>' +
      '<p class="se-hint" style="margin-top:6px">Recherche de ' + esc(label || 'ce profil') + ' sur "' + esc(motsClesIdentite(nom, contexte)) + '"' + (contexte ? ' (société/ville ajoutées pour réduire les homonymes)' : '') + ' — vérifiez vous-même qu’il s’agit bien de la bonne personne avant tout contact.</p>' +
      recoupementHtml(nom) +
      coordonneesProHtml(nom, societeNom, siren);
  }

  async function chercherRecoupement(nom) {
    state.recoupements = state.recoupements || {};
    state.recoupements[nom] = { chargement: true };
    render();
    try {
      const r = await fetch('/api/robot/autres-mandats?nom=' + encodeURIComponent(nom), { credentials: 'same-origin' }).then((x) => x.json());
      state.recoupements[nom] = r.ok ? { mandats: r.mandats || [] } : { erreur: true, mandats: [] };
    } catch (e) {
      state.recoupements[nom] = { erreur: true, mandats: [] };
    }
    commit();
  }

  async function chercherCoordonneesPro(nom, societe, siren) {
    state.coordonneesPro = state.coordonneesPro || {};
    state.coordonneesPro[nom] = { chargement: true };
    render();
    try {
      const params = new URLSearchParams({ nom: nom, societe: societe || '', siren: siren || '' });
      const r = await fetch('/api/robot/coordonnees-pro?' + params.toString(), { credentials: 'same-origin' }).then((x) => x.json());
      if (r.ok && r.trouve) state.coordonneesPro[nom] = { trouve: true, email: r.email, telephone: r.telephone, source: r.source };
      else if (r.ok && r.tousEpuises) state.coordonneesPro[nom] = { tousEpuises: true, etapes: r.etapes };
      else if (r.ok) state.coordonneesPro[nom] = { trouve: false, etapes: r.etapes };
      else state.coordonneesPro[nom] = { erreur: true };
    } catch (e) {
      state.coordonneesPro[nom] = { erreur: true };
    }
    commit();
  }

  async function enrichirLinkedin(nom, url) {
    const cle = nom + '__linkedin';
    state.coordonneesPro = state.coordonneesPro || {};
    state.coordonneesPro[cle] = { chargement: true };
    render();
    try {
      const r = await fetch('/api/robot/enrichir-linkedin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ linkedinUrl: url }) }).then((x) => x.json());
      if (r.ok && r.trouve) state.coordonneesPro[cle] = { trouve: true, email: r.email, telephone: r.telephone };
      else if (r.ok && r.epuise) state.coordonneesPro[cle] = { epuise: true };
      else if (r.ok) state.coordonneesPro[cle] = { trouve: false };
      else state.coordonneesPro[cle] = { erreur: r.error || 'Erreur.' };
    } catch (e) {
      state.coordonneesPro[cle] = { erreur: 'Kaspr injoignable.' };
    }
    commit();
  }

  function verifTag(v) {
    const s = String(v || '').toUpperCase();
    if (s === 'VERIFIED') return '<span class="se-badge open">VERIFIED</span>';
    if (s === 'GENERATED') return '<span class="se-badge warn">GENERATED</span>';
    if (s === 'PUBLISHED') return '<span class="se-badge">PUBLISHED</span>';
    if (s === 'INVALID') return '<span class="se-badge muted">INVALID</span>';
    if (s === 'NOT_FOUND' || s === 'NOT FOUND') return '<span class="se-badge muted">À rechercher</span>';
    return '<span class="se-badge muted">' + esc(v || 'À rechercher') + '</span>';
  }

  function categorieSociete(s) {
    const d = String(s.denomination || '').toUpperCase();
    const rules = [
      { re: /SNCF|RATP|RTE|RESEAU|TRANSPORT|ENEDIS|GRTGAZ|RFF|SNCF RESEAU/, cat: 'Transport et infrastructures' },
      { re: /ENERGIE|ELECTRI|GAZ DE|DISTRIBUTION/, cat: 'Énergie et réseaux' },
      { re: /HLM|HABITAT|OPH|LOGEMENT|SEQENS|ICF|ESPACIL|VILOGIA|3F|IN.LI|IMMOBILIERE 3F/, cat: 'Bailleur social' },
      { re: /PROMOTION|IMMOBILIER|BOUYGUES/, cat: 'Promoteur immobilier' },
      { re: /FONCIER|AMENAGEMENT|EPA|EPF|SEM|GRAND PARIS/, cat: 'Aménageur / opérateur public' },
      { re: /SCI|CIVILE IMMOBILIERE/, cat: 'Société immobilière (SCI)' },
      { re: /DEPARTEMENT|COMMUNE|REGION|VILLE|ETAT|MINISTERE|AP-HP/, cat: 'Opérateur public' }
    ];
    for (const r of rules) if (r.re.test(d)) return { categorie: r.cat, justification: 'Dénomination (règle documentée)', source: 'SIRENE (dénomination)', confiance: 'moyenne' };
    return { categorie: 'À qualifier', justification: 'Profil non déterminé par la dénomination', source: '—', confiance: 'faible' };
  }

  function scorePotentielSociete(s) {
    const nb = s.nbParcelles || 0;
    const perm = s.nbPermis || 0;
    const cat = categorieSociete(s).categorie;
    const patrimoine = nb >= 50000 ? 35 : nb >= 10000 ? 28 : nb >= 1000 ? 20 : nb >= 100 ? 12 : 5;
    const activite = perm >= 5 ? 30 : perm >= 2 ? 22 : perm >= 1 ? 14 : 0;
    const profil = /Promoteur|Foncière|Aménageur|Investisseur/.test(cat) ? 20 : /Bailleur|Immobilière/.test(cat) ? 12 : /Transport|Énergie|Public/.test(cat) ? 4 : 8;
    const relationnel = Math.min(15, (s.dirigeants && s.dirigeants.length ? 10 : 0) + (s.contacts && s.contacts.length ? 5 : 0));
    const parts = [
      { label: 'Patrimoine', points: patrimoine, max: 35 },
      { label: 'Activité urbanistique', points: activite, max: 30 },
      { label: 'Profil immobilier', points: profil, max: 20 },
      { label: 'Potentiel relationnel', points: relationnel, max: 15 }
    ];
    const total = parts.reduce((a, c) => a + c.max, 0);
    const pts = parts.reduce((a, c) => a + c.points, 0);
    return { score: Math.round(pts / total * 100), parts };
  }

  function viewPortefeuilleFoncier() {
    const list = (state.portefeuilleFoncier || []).slice().sort((a, b) => scorePotentielSociete(b).score - scorePotentielSociete(a).score);
    const rows = list.length
      ? '<div class="se-list" style="margin-top:10px">' + list.map((s) => {
          const cat = categorieSociete(s);
          const sc = scorePotentielSociete(s);
          return '<a class="se-rowlink" href="#/societe-fonciere/' + encodeURIComponent(s.siren) + '"><div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:600">' + esc(s.denomination || '—') + ' <span class="se-hint">· ' + esc(cat.categorie) + '</span></div>' +
            '<div class="se-hint">SIREN ' + esc(s.siren || '—') + ' · ' + (s.nbParcelles || 0) + ' parcelles · ' + (s.nbCommunes || 0) + ' communes · ' + (s.nbPermis || 0) + ' permis' + (s.asnieres ? ' · Asnières' : '') + '</div>' +
          '</div><span class="se-score-badge" style="width:40px;height:40px;font-size:15px" title="' + esc(sc.parts.map((p) => p.label + ' : ' + p.points + '/' + p.max).join('\n')) + '">' + sc.score + '</span></a>';
        }).join('') + '</div>'
      : '<p class="se-muted" style="margin-top:10px">Aucune société enregistrée. Lancez le croisement FPMU × permis.</p>';
    return head('Prospection', 'Portefeuille foncier', 'Sociétés cumulant patrimoine immobilier (FPMU) et activité urbanistique (permis).', '') +
      tabsRobot('portefeuille-foncier') +
      '<div class="se-card"><h3>' + list.length + ' société(s) à patrimoine et activité urbanistique</h3>' + rows + '</div>';
  }

  function viewSocieteFonciere(r) {
    const siren = decodeURIComponent(r.param || '');
    const s = (state.portefeuilleFoncier || []).find((x) => x.siren === siren);
    if (!s) return head('Prospection', 'Société', '', '') + tabsRobot('portefeuille-foncier') + '<div class="se-card"><p class="se-muted">Société introuvable.</p></div>';
    return head('Prospection', 'Société foncière', 'Dossier société.', '') +
      tabsRobot('portefeuille-foncier') +
      '<div class="se-card">' +
        '<div style="font-size:20px;font-weight:700">' + esc(s.denomination || '—') + '</div>' +
        '<div class="se-hint" style="margin-top:4px">SIREN ' + esc(s.siren) + ' · source Aucadastre × FPMU (DGFiP)</div>' +
      '</div>' +
      '<div class="se-grid cols-4" style="margin-top:12px">' +
        '<div class="se-card se-stat"><span class="se-kicker">Parcelles FPMU</span><span class="se-num">' + (s.nbParcelles || 0).toLocaleString('fr-FR') + '</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Communes</span><span class="se-num">' + (s.nbCommunes || 0) + '</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Permis</span><span class="se-num">' + (s.nbPermis || 0) + '</span></div>' +
        '<div class="se-card se-stat"><span class="se-kicker">Asnières</span><span class="se-num">' + (s.asnieres ? 'Oui' : 'Non') + '</span></div>' +
      '</div>' +
      '<div class="se-card" style="margin-top:12px"><h3>Droits fonciers</h3><div class="se-chips" style="margin-top:8px">' + (s.droits || []).map((d) => '<span class="se-chip">' + esc(d) + '</span>').join('') + '</div></div>' +
      '<div class="se-card" style="margin-top:12px"><h3>Communes de détention (' + (s.nbCommunes || 0) + ')</h3><p class="se-hint" style="margin-top:6px">' + esc((s.communes || []).slice(0, 40).join(', ')) + ((s.communes || []).length > 40 ? '…' : '') + '</p></div>' +
      '<div class="se-row" style="gap:8px;margin-top:12px;flex-wrap:wrap">' +
        '<button class="se-btn ghost" data-act="societe-enrichir" data-siren="' + esc(s.siren) + '">Rechercher les dirigeants (SIRENE)</button>' +
        '<button class="se-btn ghost" data-act="societe-favori" data-siren="' + esc(s.siren) + '">' + (s.favori ? '★ Favori' : '☆ Favori') + '</button>' +
        '<button class="se-btn ghost" data-act="societe-tache" data-siren="' + esc(s.siren) + '">Créer une tâche</button>' +
      '</div>';
  }

  // Valorisation interne : estime un prix au m² à partir des ventes DVF comparables du même
  // secteur et du même type de bien (surface à ±30 %), sans dépendre d'un outil externe payant.
  // Toujours une fourchette avec le détail des comparables, jamais un chiffre seul.
  function typeLocalDVF(b) {
    const t = String(b.type || '').toLowerCase();
    if (t.indexOf('appartement') > -1) return 'Appartement';
    if (t.indexOf('maison') > -1) return 'Maison';
    return '';
  }

  async function estimerValorisation(bienId) {
    const b = robotBien(bienId);
    if (!b) return;
    const insee = b.codeInsee || postalToInsee(b.codePostal);
    if (!insee) { toast('Code INSEE introuvable pour ce secteur — valorisation impossible.', 'warn'); return; }
    const surface = b.surface_habitable_m2 || b.surface_reference_dpe_m2 || 0;
    toast('Recherche de ventes comparables (DVF) dans le secteur…');
    try {
      const params = new URLSearchParams({ code_insee: insee });
      const tl = typeLocalDVF(b);
      if (tl) params.set('type_local', tl);
      if (surface) params.set('surface', String(surface));
      const r = await fetch('/api/robot/dvf-secteur?' + params.toString(), { credentials: 'same-origin' }).then((x) => x.json());
      if (!r.ok) { toast(r.error || 'Valorisation impossible.', 'warn'); return; }
      b.valorisation = { stats: r.stats, comparables: r.comparables || [], surfaceUtilisee: surface, typeLocal: r.typeLocal, avertissement: r.avertissement || '', calculeLe: new Date().toISOString() };
      commit();
      toast(r.stats ? r.stats.nbComparables + ' comparable(s) trouvé(s).' : 'Aucun comparable DVF trouvé dans ce secteur.', r.stats ? 'ok' : 'warn');
    } catch (e) { toast('Valorisation impossible.', 'warn'); }
  }

  function valorisationHtml(b) {
    const v = b.valorisation;
    if (!v) return '<p class="se-muted" style="margin-top:10px">Lance l’estimation pour obtenir une fourchette de prix au m² à partir des ventes comparables (DVF) du secteur.</p>';
    if (!v.stats) return '<p class="se-muted" style="margin-top:10px">Aucune vente comparable trouvée dans ce secteur' + (v.typeLocal ? ' (' + esc(v.typeLocal) + ')' : '') + '.</p>';
    const s = v.stats;
    const surface = v.surfaceUtilisee;
    const html = '<div class="se-kv" style="margin-top:10px">' +
      kv('Comparables retenus', s.nbComparables + ' vente(s) · ' + esc(v.typeLocal)) +
      kv('Prix au m² (médiane)', s.prixM2Median.toLocaleString('fr-FR') + ' €/m²') +
      kv('Fourchette au m²', s.prixM2Min.toLocaleString('fr-FR') + ' – ' + s.prixM2Max.toLocaleString('fr-FR') + ' €/m²') +
      (surface ? kv('Estimation du bien (' + surface + ' m²)', Math.round(s.prixM2Min * surface).toLocaleString('fr-FR') + ' – ' + Math.round(s.prixM2Max * surface).toLocaleString('fr-FR') + ' € (médiane ' + Math.round(s.prixM2Median * surface).toLocaleString('fr-FR') + ' €)') : '') +
      '</div>' +
      (v.avertissement ? '<p class="se-hint" style="margin-top:10px;color:var(--color-warn, #a8562a)">⚠ ' + esc(v.avertissement) + '</p>' : '') +
      '<p class="se-hint" style="margin-top:10px">Estimation indicative à partir de ' + s.nbComparables + ' transaction(s) DVF (source officielle, gratuite) — ne remplace pas une estimation professionnelle sur place.</p>';
    const liste = (v.comparables || []).length
      ? '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--color-taupe)">Voir les comparables (' + v.comparables.length + ')</summary><div class="se-list" style="margin-top:8px">' +
          v.comparables.map((c) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(c.adresse || ((c.typeLocal || 'Vente') + (parseFloat(c.surface) > 0 ? ' · ' + Math.round(parseFloat(c.surface)) + ' m²' : ''))) + '</div><div class="se-hint">' + esc(c.date || '') + ' · ' + Math.round(parseFloat(String(c.valeur || '0').replace(',', '.'))).toLocaleString('fr-FR') + ' €' + (parseFloat(c.surface) > 0 ? ' · ' + Math.round(parseFloat(String(c.valeur || '0')) / parseFloat(c.surface)).toLocaleString('fr-FR') + ' €/m²' : '') + '</div></div></div>').join('') +
        '</div></details>'
      : '';
    return html + liste;
  }

  function viewProprietaires() {
    const biens = robotBiens().filter((b) => b.proprietaire && b.proprietaire.nom);
    const groupes = {};
    biens.forEach((b) => {
      const key = b.proprietaire.siren || b.proprietaire.nom;
      groupes[key] = groupes[key] || { nom: b.proprietaire.nom, siren: b.proprietaire.siren || '', type: b.proprietaire.type || '', biens: [] };
      groupes[key].biens.push(b);
    });
    const list = Object.values(groupes);
    const rows = list.length
      ? '<div class="se-list" style="margin-top:10px">' + list.map((g) => '<div class="se-list-item">' +
          '<a class="se-rowlink" href="#/robot-proprietaire/' + encodeURIComponent(g.siren || g.nom) + '" style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:600">' + esc(g.nom) + (g.type === 'sci' ? ' · SCI' : g.type === 'societe' ? ' · Société' : ' · Particulier') + '</div>' +
            '<div class="se-hint">SIREN ' + esc(g.siren || '—') + ' · ' + g.biens.length + ' bien(s) identifié(s)</div>' +
          '</a>' +
          '<a class="se-btn ghost sm" href="#/robot-radar">Voir les biens</a>' +
        '</div>').join('') + '</div>'
      : '<p class="se-muted" style="margin-top:10px">Aucun propriétaire identifié pour l’instant. Lancez une recherche DPE puis l’enrichissement automatique.</p>';
    return head('Prospection', 'Propriétaires', 'Sociétés et personnes identifiées par le moteur, avec leur patrimoine.', '') +
      tabsRobot('robot-proprietaires') +
      '<div class="se-card"><h3>' + list.length + ' propriétaire(s) identifié(s)</h3>' + rows + '</div>';
  }

  function viewProprietaire(r) {
    const key = decodeURIComponent(r.param || '');
    const biens = robotBiens().filter((b) => b.proprietaire && (b.proprietaire.siren === key || b.proprietaire.nom === key));
    const estSiren = /^\d{9}$/.test(key);
    // Une société repérée dans un immeuble (fichier DGFiP / SIRENE) a sa fiche même
    // si aucun de ses biens n'est encore dans le Radar.
    if (!biens.length && !estSiren) return head('Prospection', 'Propriétaire', '', '') + tabsRobot('robot-proprietaires') + '<div class="se-card"><p class="se-muted">Propriétaire introuvable.</p></div>';
    const pat = estSiren ? (PATRIMOINE[key] || null) : null;
    if (estSiren && !pat) setTimeout(() => chargerPatrimoine(key), 0);
    const g = biens.length ? biens[0].proprietaire : { nom: (pat && pat.nom) || ('SIREN ' + key), siren: key, type: (pat && pat.type) || 'societe', dirigeants: [] };
    const dirigeants = (g.dirigeants && g.dirigeants.length) ? g.dirigeants : ((pat && pat.dirigeants) || []).map((d) => d.nom);
    const biensHtml = '<div class="se-list" style="margin-top:10px">' + biens.map((b) => {
      const sc = scorePriorite(b);
      const surf = b.surface_habitable_m2 != null ? b.surface_habitable_m2 + ' m²' : '—';
      return '<a class="se-rowlink" href="#/robot-bien/' + b.id + '"><div style="flex:1;min-width:0">' +
        '<div style="font-size:13.5px;font-weight:500">' + esc(b.adresse || 'Adresse inconnue') + '</div>' +
        '<div class="se-hint">' + esc(typeRobot(b)) + ' · ' + surf + (b.dpe ? ' · DPE ' + esc(b.dpe) : '') + '</div>' +
      '</div><div style="flex:0 0 auto;text-align:right">' +
        '<span class="se-score-badge" style="width:36px;height:36px;font-size:15px">' + (sc.score != null ? sc.score : '—') + '</span>' +
        '<div class="se-hint" style="margin-top:2px">ID ' + sc.scores.identification + ' · CT ' + sc.scores.coordonnees + ' · PV ' + sc.scores.potentiel + '</div>' +
      '</div></a>';
    }).join('') + '</div>';
    const nomsDirigeants = dirigeants.map((d) => (typeof d === 'string' ? d : (d.nom || d.name || ''))).filter(Boolean);
    const estPersonneMorale = g.type === 'sci' || g.type === 'societe';
    const ville = (biens[0] && biens[0].ville) || '';
    const contexteDirigeant = [g.nom, ville].filter(Boolean).join(' ');
    return head('Prospection', 'Propriétaire', 'Patrimoine immobilier identifié.', '') +
      tabsRobot('robot-proprietaires') +
      '<div class="se-card">' +
        '<div style="font-size:20px;font-weight:700">' + esc(g.nom) + '</div>' +
        '<div class="se-hint" style="margin-top:4px">SIREN ' + esc(g.siren || '—') + ' · ' + (g.type === 'sci' ? 'SCI' : g.type === 'societe' ? 'Société' : 'Particulier') + '</div>' +
        (nomsDirigeants.length ? '<div class="se-hint" style="margin-top:4px">Dirigeants : ' + nomsDirigeants.map(esc).join(', ') + '</div>' : '') +
        (!estPersonneMorale ? reseauxSociauxHtml(g.nom, 'ce propriétaire', ville, '', '') : '') +
      '</div>' +
      (estPersonneMorale && nomsDirigeants.length
        ? '<div class="se-card" style="margin-top:16px"><h3>Identité des dirigeants</h3>' +
          nomsDirigeants.map((n) => '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-stroke-faint)"><b style="font-size:14px">' + esc(n) + '</b>' + reseauxSociauxHtml(n, 'ce dirigeant', contexteDirigeant, g.nom, g.siren) + '</div>').join('') +
          '</div>'
        : '') +
      (biens.length ? '<div class="se-card" style="margin-top:16px"><h3>Biens dans le Radar (' + biens.length + ')</h3>' + biensHtml + '</div>' : '') +
      (estSiren ? patrimoineHtml(key, null) : '');
  }

  function viewRobotBien(r) {
    const b = robotBien(r.param);
    if (!b) return '<div class="se-card se-empty"><div class="se-empty-title">Bien introuvable</div><a class="se-btn" href="#/robot-radar">Retour au Radar</a></div>';
    const tab = state.robotBienTab || 'immo';
    const prop = b.proprietaire || {};
    const ms = matchings().filter((m) => m.bienId === b.id);
    if (!AUTO[b.id]) setTimeout(() => lancerEnrichissementAuto(b.id), 0);
    const etage = etageDuBien(b);
    const onglets = [['immo', 'Immobilier'], ['cadastre', 'Cadastre & géo'], ['proprietaire', 'Propriétaire'], ['societe', 'Société & dirigeants'], ['contacts', 'Coordonnées'], ['clients', 'Clients correspondants'], ['historique', 'Historique'], ['actions', 'Actions']];
    const tabBar = '<div class="se-tabs" style="margin-bottom:14px">' + onglets.map(([k, label]) => '<button class="se-btn ghost sm' + (tab === k ? ' is-on' : '') + '" data-act="robot-bien-tab" data-tab="' + k + '">' + label + '</button>').join('') + '</div>';

    const typeProp = prop.type === 'sci' ? 'SCI' : prop.type === 'societe' ? 'Société' : prop.type === 'personne' ? 'Personne physique' : '—';

    let body = '';
    if (tab === 'immo') {
      const autresAdeme = autresChampsAdeme(b.ademeBrut);
      body = '<div class="se-card"><h3>Informations immobilières</h3><div class="se-kv" style="margin-top:12px">' +
        kv('Adresse', esc(b.adresse)) + kv('Ville', esc(b.ville || '—')) + kv('Code postal', esc(b.codePostal || '—')) +
        kv('Type', esc(b.type || '—')) + kv('Surface habitable', b.surface_habitable_m2 != null ? b.surface_habitable_m2 + ' m²' : '—') + kv('Surface réf. DPE', b.surface_reference_dpe_m2 != null ? b.surface_reference_dpe_m2 + ' m²' : '—') + kv('Terrain', b.surface_terrain_m2 != null ? b.surface_terrain_m2 + ' m²' : '—') + kv('Contenance cadastrale', b.contenance_cadastrale_m2 != null ? b.contenance_cadastrale_m2 + ' m²' : '—') +
        kv('Pièces', b.pieces || '—') + kv('Chambres', b.chambres || '—') + kv('DPE', b.dpe || '—') +
        kv('DPE réalisé le', (b.dpeDate ? dFR(b.dpeDate) : '—') + ((() => { const j = joursDepuis(b.dpeDate); return (j != null && j <= 180) ? ' <span class="se-badge ' + (j <= 60 ? 'open' : 'warn') + '" style="margin-left:6px">Récent — signe possible d’un projet</span>' : ''; })())) +
        kv('Construction', b.anneeConstruction || b.periodeConstruction || '—') +
        kv('Étage', etage ? esc(etage.valeur) + ' <span class="se-hint">(' + esc(etage.source) + ')</span>' : ((AUTO[b.id] && AUTO[b.id].chargement) ? '<span class="se-hint">recherche en cours…</span>' : 'Non déterminé — rattachez le bien à son lot ci-dessous')) +
        (prop.nom ? kv('Propriétaire', lienSociete(prop.siren, prop.nom) + (prop.type === 'sci' ? ' · SCI' : prop.type === 'societe' ? ' · Société' : '')) : '') +
        '</div>' +
        (autresAdeme.length ? '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:13px;color:var(--color-taupe)">Toutes les données ADEME disponibles sur ce logement (' + autresAdeme.length + ')</summary><div class="se-kv" style="margin-top:8px">' + autresAdeme.map((x) => kv(esc(x.label), esc(String(x.valeur)))).join('') + '</div></details>' : '') +
        '</div>' +
        immeubleHtml(b) +
        societesAdresseHtml(b) +
        '<div class="se-card" style="margin-top:16px"><h3>Valorisation interne</h3>' +
        '<p class="se-hint">Prix au m² estimé à partir des ventes DVF comparables du secteur (même type de bien, surface à ±30 %) — gratuit, sans outil externe.</p>' +
        '<button class="se-btn ghost sm" style="margin-top:10px" data-act="robot-valorisation" data-id="' + b.id + '">Estimer via comparables DVF</button>' +
        valorisationHtml(b) +
        '</div>';
    } else if (tab === 'cadastre') {
      body = '<div class="se-card"><h3>Cadastre & géolocalisation</h3><div class="se-kv" style="margin-top:12px">' +
        kv('Parcelle cadastrale', esc(b.parcelle || '—')) + kv('Coordonnées', b.coords ? b.coords[0].toFixed(5) + ', ' + b.coords[1].toFixed(5) : '—') +
        kv('Date de détection', dFR(b.dateDetection)) + kv('Statut prospection', esc(b.statutProspection || 'nouveau')) + kv('Confiance géocodage', (b.confidence_geocoding != null ? b.confidence_geocoding + ' %' : '—')) + kv('Confiance propriétaire', (b.confidence_owner != null ? b.confidence_owner + ' %' : '—')) +
        '</div><div style="margin-top:12px">' + lienCarteRobot(b) + '</div></div>';
    } else if (tab === 'proprietaire') {
      body = '<div class="se-card"><h3>Propriétaire</h3><div class="se-kv" style="margin-top:12px">' +
        kv('Nom', esc(prop.nom || 'Non identifié')) + kv('Type', typeProp) +
        '</div>' +
        (prop.nom && typeProp === 'Personne physique' ? reseauxSociauxHtml(prop.nom, 'ce propriétaire', b.ville || '', '', '') : '') +
        (prop.nom ? '' : '<p class="se-muted" style="margin-top:10px">Le propriétaire n’est pas encore identifié. Lancez l’enrichissement pour le rechercher.</p>') + '</div>';
    } else if (tab === 'societe') {
      const auto = AUTO[b.id] || {};
      const dirigeantsAuto = (auto.dirigeants || []).map((d) => d.nom + (d.role ? ' (' + d.role + ')' : ''));
      const nomsDirigeants = (prop.dirigeants || []).map((d) => (typeof d === 'string' ? d : (d.nom || d.name || ''))).filter(Boolean).concat((prop.dirigeants && prop.dirigeants.length) ? [] : (auto.dirigeants || []).map((d) => d.nom));
      const bodacc = prop.siren ? (auto.bodacc || (state.bodaccAlertes || {})[prop.siren]) : null;
      body = '<div class="se-card"><h3>Société & dirigeants</h3><div class="se-kv" style="margin-top:12px">' +
        kv('Société', prop.nom ? lienSociete(prop.siren, prop.nom) : '—') + kv('SIREN', esc(prop.siren || '—')) +
        kv('Dirigeants', esc((prop.dirigeants && prop.dirigeants.length ? nomsDirigeants : dirigeantsAuto).join(', ')) || (prop.siren && auto.chargement !== false ? '<span class="se-hint">recherche en cours…</span>' : '—')) +
        (prop.siren ? kv('BODACC', !bodacc ? '<span class="se-hint">vérification en cours…</span>' : bodacc.length ? '<span class="se-badge warn">' + bodacc.length + ' annonce(s)</span> ' + esc((bodacc[0].natureJugement || bodacc[0].familleavis || '') + (bodacc[0].dateparution ? ' · ' + dFR(bodacc[0].dateparution) : '')) : 'Aucune procédure collective publiée') : '') +
        '</div>' +
        (prop.siren ? '<a class="se-btn ghost sm" style="margin-top:12px" href="#/robot-proprietaire/' + encodeURIComponent(prop.siren) + '">Ouvrir la fiche de la société</a>' : '') +
        (prop.nom ? '' : '<p class="se-muted" style="margin-top:10px">Propriétaire pas encore identifié : rattachez le bien à un lot de l’immeuble ou à une société domiciliée (onglet Immobilier).</p>') +
        (prop.nom && !(typeProp === 'SCI' || typeProp === 'Société') ? '<p class="se-muted" style="margin-top:10px">Ce bien est détenu par une personne physique (pas de société).</p>' : '') +
        '</div>' +
        (prop.siren ? patrimoineHtml(prop.siren, b.id) : '') +
        (nomsDirigeants.length
          ? '<div class="se-card" style="margin-top:16px"><h3>Cibler les dirigeants sur les réseaux</h3><p class="se-hint">Le ou les gérants de la ' + esc(typeProp) + ', pour les approcher directement.</p>' +
            nomsDirigeants.map((n) => '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-stroke-faint)"><b style="font-size:14px">' + esc(n) + '</b>' + reseauxSociauxHtml(n, 'ce dirigeant', [prop.nom, b.ville].filter(Boolean).join(' '), prop.nom, prop.siren) + '</div>').join('') +
            '</div>'
          : '');
    } else if (tab === 'contacts') {
      body = '<div class="se-card"><h3>Coordonnées & vérifications</h3>' +
        ((b.contacts || []).length
          ? '<div class="se-list" style="margin-top:10px">' + b.contacts.map((ct) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(ct.valeur) + '</div><div class="se-hint">' + (ct.type === 'email' ? 'Email' : 'Téléphone') + (ct.source ? ' · ' + esc(ct.source) : '') + '</div></div>' + verifTag(ct.verification) + '</div>').join('') + '</div>'
          : '<p class="se-muted" style="margin-top:10px">Aucune coordonnée disponible.</p>') +
        '<p class="se-hint" style="margin-top:10px">Distinction stricte : GENERATED = hypothèse, VERIFIED = vérifié.</p></div>';
    } else if (tab === 'clients') {
      body = '<div class="se-card"><h3>Clients correspondants</h3>' +
        (ms.length ? '<div class="se-list" style="margin-top:10px">' + ms.map((m) => {
          const rec = ((state.recherchesServeur || []).concat(state.recherches)).find((x) => x.id === m.rechercheId) || {};
          const cli = clientDeRecherche(rec);
          const prio = niveauPriorite(m.score);
          return '<a class="se-rowlink" href="#/client/' + (cli ? cli.id : '') + '"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + (cli ? esc(nomClient(cli)) : '—') + '</div><div class="se-sub">' + (rec.titre ? esc(rec.titre) : 'Recherche') + ' · budget ' + (rec.prixMax ? euro(rec.prixMax) : '—') + '</div></div><span class="se-badge ' + prio.cls + '">' + m.score + '%</span></a>';
        }).join('') + '</div>' : '<p class="se-muted" style="margin-top:10px">Aucun client ne correspond à ce bien.</p>') + '</div>';
    } else if (tab === 'historique') {
      const dvf = b.dvfMutations || [];
      const dvfHtml = dvf.length
        ? '<div class="se-list" style="margin-top:10px">' + dvf.map((m) => '<div class="se-list-item" style="align-items:flex-start">' +
            '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">' + esc(m.nature || 'Mutation') + ' · ' + esc(m.date || '') + '</div>' +
            '<div class="se-hint">' + esc(m.valeur || '—') + ' € · ' + esc(m.typeLocal || '—') + (m.surface ? ' · ' + esc(m.surface) + ' m²' : '') + (m.pieces ? ' · ' + esc(m.pieces) + ' pièces' : '') + '</div></div>' +
            '<span class="se-badge muted">DVF</span></div>').join('') + '</div>'
        : '<p class="se-muted" style="margin-top:10px">Aucune mutation DVF chargée pour cette parcelle.</p>';
      const detention = dureeDetentionInfo(b);
      const detentionCls = { forte: 'alert', moyenne: 'warn', faible: 'muted' };
      const detentionHtml = detention
        ? '<div class="se-card" style="margin-top:16px"><h3>Score de durée de détention</h3>' +
          '<div class="se-list-item" style="margin-top:4px"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(detention.label) + '</div>' +
          '<div class="se-hint">Dernière vente DVF connue : ' + detention.dateVente.toLocaleDateString('fr-FR') + '</div></div>' +
          '<span class="se-badge ' + detentionCls[detention.niveau] + '">' + detention.ans + ' ans</span></div>' +
          '<p class="se-hint" style="margin-top:10px">Indicateur statistique (durée moyenne de détention en France ≈ 7-10 ans) — à combiner avec les autres signaux, pas une certitude de mise en vente.</p></div>'
        : '';
      body = '<div class="se-card"><h3>Historique des recherches</h3><div class="se-list" style="margin-top:10px">' +
        '<div class="se-list-item"><div style="flex:1"><div style="font-size:13.5px">Détection initiale</div><div class="se-hint">' + dFR(b.dateDetection) + '</div></div><span class="se-badge muted">' + (b.confidence_geocoding != null ? b.confidence_geocoding + '%' : '—') + ' confiance géo</span></div>' +
        '</div></div>' +
        '<div class="se-card" style="margin-top:16px"><h3>Mutations DVF</h3>' + dvfHtml +
        '<button class="se-btn ghost sm" style="margin-top:10px" data-act="robot-dvf" data-id="' + b.id + '">Charger l’historique DVF</button></div>' +
        detentionHtml;
    } else if (tab === 'actions') {
      const estDpeAuto = b.source === 'dpe-auto' && !(state.robotBiens || []).some((x) => adresseKey(x.adresse) === adresseKey(b.adresse));
      const promotionHtml = estDpeAuto
        ? '<div class="se-card" style="margin-bottom:16px"><h3>Détecté par le moteur quotidien</h3>' +
          '<p class="se-hint">Ce bien vient du scan automatique DPE, pas d’une recherche manuelle — il n’est pas encore éditable (statut, notes, enrichissement). Ajoutez-le au Radar pour commencer à le travailler.</p>' +
          '<button class="se-btn sm" style="margin-top:10px" data-act="robot-promouvoir" data-id="' + b.id + '">Ajouter au Radar</button>' +
          '</div>'
        : '';
      const statutBtns = '<div class="se-row" style="gap:6px;flex-wrap:wrap;margin-top:10px">' + STATUTS_PROSPECTION.map(([k, label]) =>
        '<button class="se-btn ghost sm' + (b.statutProspection === k ? ' is-on' : '') + '" data-act="robot-statut" data-id="' + b.id + '" data-statut="' + k + '"' + (estDpeAuto ? ' disabled' : '') + '>' + label + '</button>').join('') + '</div>';
      body = promotionHtml + '<div class="se-card"><h3>Statut de prospection</h3>' + statutBtns + '</div>' +
        '<div class="se-card" style="margin-top:16px"><h3>Enrichissement en cascade</h3>' +
        '<p class="se-hint">Interroge successivement SIRENE, Aucadastre puis Exa, dans cet ordre, et s’arrête dès qu’un contact exploitable est trouvé — la provenance de chaque résultat reste visible.</p>' +
        '<button class="se-btn ghost sm" style="margin-top:10px" data-act="robot-cascade" data-id="' + b.id + '">Lancer la cascade</button>' +
        cascadeStepsHtml(b) +
        '</div>' +
        '<div class="se-card" style="margin-top:16px"><h3>Actions commerciales</h3>' +
        '<div class="se-row" style="gap:8px;flex-wrap:wrap;margin-top:10px">' +

          '<button class="se-btn" data-act="robot-ajouter" data-json="' + esc(JSON.stringify({ nom: prop.nom || '', prenom: '', email: ((b.contacts || []).find((c) => c.type === 'email') || {}).valeur || '', tel: ((b.contacts || []).find((c) => c.type === 'tel') || {}).valeur || '', type: prop.type || 'personne', siren: prop.siren || '', dirigeants: prop.dirigeants || [], adresseBien: b.adresse, ville: b.ville || '', parcelle: b.parcelle || '', dpe: b.dpe || '' })) + '">Ajouter comme prospect vendeur</button>' +
          '<button class="se-btn ghost" data-act="prospection-message" data-id="' + b.id + '">Générer un message de prospection</button>' +
          '<button class="se-btn ghost" data-act="rechercher-telephones" data-id="' + b.id + '">Rechercher les téléphones (Exa)</button>' +
          '<button class="se-btn ghost" data-act="robot-favori" data-id="' + b.id + '">' + (b.favori ? '★ Favori' : '☆ Favori') + '</button>' +
          '<button class="se-btn ghost" data-act="robot-tache" data-id="' + b.id + '">Créer une tâche</button>' +
          '<button class="se-btn ghost" data-act="robot-note" data-id="' + b.id + '">Ajouter une note</button>' +
        '</div>' +
        '<p class="se-hint" style="margin-top:12px">La qualification reste humaine : un bien détecté n’est pas automatiquement à vendre, et un contact GENERATED n’est pas VERIFIED.</p></div>';
    }

    return '<div class="se-fiche-head"><div style="flex:1"><div class="kicker" style="color:var(--color-taupe)">Bien détecté · ' + esc(b.statutProspection || 'nouveau') + '</div>' +
      '<h1 class="display" style="font-size:28px;margin:4px 0 2px">' + esc(b.adresse) + '</h1>' +
      '<div class="se-row" style="gap:8px">' + (b.type ? '<span class="se-pill">' + esc(b.type) + '</span>' : '') + (b.ville ? '<span class="se-pill">' + esc(b.ville) + '</span>' : '') + (b.proprietaire && b.proprietaire.nom ? '<span class="se-pill">' + typeProp + '</span>' : '') + '</div></div>' +
      '<div class="se-row" style="gap:8px;flex-wrap:wrap">' + lienCarteRobot(b).replace('se-btn ghost sm', 'se-btn') + '<a class="se-btn ghost" href="#/robot-radar">← Radar</a></div></div>' +
      tabBar + body;
  }

  function dpeKey(r) {
    return String(r.adresse_ban || r.adresse_brut || r.adresse_complete_brut || r.numero_dpe || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function classeBadge(c) {
    const map = { A: '#1b3a32', B: '#2e6b4f', C: '#7da860', D: '#e5c94e', E: '#e8a33d', F: '#d97b34', G: '#c0392b' };
    return '<span class="se-badge" style="background:' + (map[c] || '#999') + ';color:#fff">' + (c || '—') + '</span>';
  }

  function viewRobotDpe() {
    const res = state.dpe || null;
    const cls = state.dpeClasses || [];
    const rows = (res && res.results) ? res.results : [];
    const DPE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const chk = (c) => '<label class="se-chip" style="cursor:pointer"><input type="checkbox" name="classe" value="' + c + '"' + (cls.indexOf(c) > -1 ? ' checked' : '') + ' style="margin-right:5px"/>' + c + '</label>';
    const groupes = {};
    rows.forEach((r) => {
      const k = dpeKey(r) || ('n' + Math.random());
      groupes[k] = groupes[k] || { key: k, adresse: r.adresse_ban || 'Adresse inconnue', dpes: [] };
      groupes[k].dpes.push(r);
    });
    const dedupes = Object.values(groupes);
    const liste = dedupes.length
      ? '<div class="se-list" style="margin-top:10px">' + dedupes.map((g) => {
          const latest = g.dpes[0];
          const historique = g.dpes.map((d) =>
            '<div class="se-list-item" style="align-items:flex-start">' +
              '<div style="flex:1;min-width:0">' +
                '<div class="se-hint">' + esc(d.date_reception_dpe || '—') + ' · ' + esc(d.numero_dpe || '') + (d.annee_construction ? ' · ' + d.annee_construction : '') + '</div>' +
                '<div class="se-hint">' + (d.conso_5_usages_par_m2_ep != null ? d.conso_5_usages_par_m2_ep + ' kWhEP/m²/an' : '') + (d.emission_ges_5_usages_par_m2 != null ? ' · ' + d.emission_ges_5_usages_par_m2 + ' kgCO₂/m²/an' : '') + '</div>' +
              '</div>' +
              '<div style="flex:0 0 auto">' + classeBadge(d.etiquette_dpe) + '</div>' +
            '</div>').join('');
          const etage = etageDepuisAdresseBrute(latest.adresse_brut);
          const autres = autresChampsAdeme(latest);
          return '<div class="se-list-item" style="align-items:stretch;flex-direction:column;gap:6px">' +
            '<div class="se-row" style="width:100%;justify-content:space-between;align-items:flex-start">' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-size:13.5px;font-weight:500">' + esc(g.adresse) + '</div>' +
                '<div class="se-hint">' + esc(latest.type_batiment || '') + (latest.surface_habitable_logement ? ' · ' + latest.surface_habitable_logement + ' m²' : '') + (latest.annee_construction ? ' · ' + latest.annee_construction : (latest.periode_construction ? ' · construit ' + esc(latest.periode_construction) : '')) + (etage ? ' · étage ' + esc(etage) + ' (estimé)' : '') + '</div>' +
                '<div class="se-hint" style="margin-top:2px">' + (latest.conso_5_usages_par_m2_ep != null ? latest.conso_5_usages_par_m2_ep + ' kWhEP/m²/an' : '') + (latest.emission_ges_5_usages_par_m2 != null ? ' · ' + latest.emission_ges_5_usages_par_m2 + ' kgCO₂/m²/an' : '') + '</div>' +
              '</div>' +
              '<div style="flex:0 0 auto;text-align:right">' + classeBadge(latest.etiquette_dpe) + '<div class="se-hint" style="margin-top:2px">' + g.dpes.length + ' DPE</div><div style="margin-top:4px"><button class="se-btn ghost sm" data-act="dpe-fiche" data-key="' + esc(g.key || g.adresse) + '">Fiche</button></div></div>' +
            '</div>' +
            (g.dpes.length > 1 ? '<details style="width:100%"><summary style="cursor:pointer;font-size:12px;color:var(--color-taupe)">Historique des ' + g.dpes.length + ' diagnostics</summary><div class="se-list" style="margin-top:6px">' + historique + '</div></details>' : '') +
            (autres.length ? '<details style="width:100%"><summary style="cursor:pointer;font-size:12px;color:var(--color-taupe)">Toutes les données ADEME (' + autres.length + ')</summary><div class="se-kv" style="margin-top:6px">' + autres.map((x) => kv(esc(x.label), esc(String(x.valeur)))).join('') + '</div></details>' : '') +
          '</div>';
        }).join('') + '</div>'
      : '<p class="se-muted" style="margin-top:10px">Lancez une recherche pour interroger la base DPE de l’ADEME (données réelles).</p>';
    return head('Prospection', 'Recherche DPE', 'Diagnostics de performance énergétique — source ADEME (données réelles). L’étage affiché est une estimation extraite de l’adresse du DPE quand elle le mentionne, jamais une donnée certaine (l’ADEME ne la fournit pas en tant que telle) — chaque fiche propose aussi toutes les autres données ADEME disponibles sur ce logement.', '') +
      tabsRobot('robot-dpe') +
      '<div class="se-card" style="margin-bottom:16px">' +
        '<h3>Recherche DPE</h3>' +
        '<form data-form="dpe-search" style="margin-top:12px">' +
          '<div class="se-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
            '<div class="se-field" style="flex:1;min-width:200px"><label>Adresse ou ville</label><input class="se-input" name="ville" data-rr="dpe_ville" value="' + rr('dpe_ville') + '" placeholder="75011 Paris"/></div>' +
            '<div class="se-field" style="width:150px"><label>Code postal</label><input class="se-input" name="code_postal" data-rr="dpe_code_postal" value="' + rr('dpe_code_postal') + '" placeholder="75011"/></div>' +
            '<div class="se-field" style="width:130px"><label>Section</label><input class="se-input" name="section" data-rr="dpe_section" value="' + rr('dpe_section') + '" placeholder="EC"/></div>' +
            '<div class="se-field" style="width:140px"><label>N° parcelle</label><input class="se-input" name="numero" data-rr="dpe_numero" value="' + rr('dpe_numero') + '" placeholder="32"/></div>' +
          '</div>' +
          '<details style="margin-top:14px">' +
            '<summary style="cursor:pointer;font-size:13px;color:var(--color-taupe);user-select:none">Critères avancés</summary>' +
            '<div class="se-form-grid" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
              '<div class="se-field"><label>Date début (AAAA-MM-JJ)</label><input class="se-input" name="date_debut" data-rr="dpe_date_debut" value="' + rr('dpe_date_debut') + '" placeholder="2024-01-01"/></div>' +
              '<div class="se-field"><label>Date fin (AAAA-MM-JJ)</label><input class="se-input" name="date_fin" data-rr="dpe_date_fin" value="' + rr('dpe_date_fin') + '" placeholder="2025-12-31"/></div>' +
              '<div class="se-field"><label>Surface min (m²)</label><input class="se-input" name="surface_min" data-rr="dpe_surface_min" value="' + rr('dpe_surface_min') + '" type="number" placeholder="40"/></div>' +
              '<div class="se-field"><label>Surface max (m²)</label><input class="se-input" name="surface_max" data-rr="dpe_surface_max" value="' + rr('dpe_surface_max') + '" type="number" placeholder="100"/></div>' +
              '<div class="se-field"><label>Type de bien</label><select class="se-select" name="type"><option value="tout">Tous</option><option value="appartement">Appartement</option><option value="maison">Maison</option><option value="immeuble">Immeuble</option></select></div>' +
              '<div class="se-field"><label>Tri</label><select class="se-select" name="tri"><option value="recent">DPE le plus récent</option><option value="ancien">DPE le plus ancien</option><option value="surface_desc">Surface décroissante</option><option value="surface_asc">Surface croissante</option><option value="classe_asc">Classe A→G</option><option value="classe_desc">Classe G→A</option></select></div>' +
            '</div>' +
            '<div style="margin-top:12px"><span class="se-hint">Classes énergétiques :</span></div>' +
            '<div class="se-chips" style="margin-top:8px">' + DPE_CLASSES.map(chk).join('') + '<label class="se-chip" style="cursor:pointer"><input type="checkbox" data-dpe-toutes style="margin-right:5px"/> Toutes</label>' + '</div>' +
            '<div class="se-row" style="gap:8px;margin-top:8px;flex-wrap:wrap">' +
              '<button class="se-btn ghost sm" type="button" data-act="dpe-preset" data-preset="passoires">Passoires thermiques (F/G)</button>' +
              '<button class="se-btn ghost sm" type="button" data-act="dpe-preset" data-preset="anciens">DPE anciens (&lt; 2023)</button>' +
            '</div>' +
          '</details>' +
          '<div class="se-lancer"><button class="se-btn" type="button" data-act="dpe-search">Lancer la recherche</button><span class="se-hint" id="dpe-status"></span></div>' +
        '</form>' +
      '</div>' +
      (res ? '<div class="se-card"><div class="se-row" style="justify-content:space-between"><h3>Résultats</h3><span class="se-hint">' + res.count + ' affiché(s) · ' + res.total + ' DPE au total · source ADEME</span></div>' + liste + '</div>' : '');
  }

  function dpeFicheModal() {
    const key = state.dpeFiche;
    const rows = (state.dpe && state.dpe.results) || [];
    const groupes = {};
    rows.forEach((r) => { const k = dpeKey(r); groupes[k] = groupes[k] || { adresse: r.adresse_ban || 'Adresse inconnue', dpes: [] }; groupes[k].dpes.push(r); });
    const g = groupes[key];
    if (!g) return '<h3>Bien introuvable</h3><p class="se-muted">Relancez une recherche DPE.</p>';
    const enrichi = state.dpeEnrichi || null;
    const dpesHtml = g.dpes.map((d) =>
      '<div class="se-list-item"><div style="flex:1;min-width:0"><div class="se-hint">' + esc(d.date_reception_dpe || '—') + ' · ' + esc(d.numero_dpe || '') + '</div><div class="se-hint">' + (d.conso_5_usages_par_m2_ep != null ? d.conso_5_usages_par_m2_ep + ' kWhEP/m²/an' : '') + (d.emission_ges_5_usages_par_m2 != null ? ' · ' + d.emission_ges_5_usages_par_m2 + ' kgCO₂/m²/an' : '') + '</div></div>' + classeBadge(d.etiquette_dpe) + '</div>').join('');
    let enrichHtml = '';
    if (enrichi) {
      if (enrichi.error) {
        enrichHtml = '<div class="se-note" style="margin-top:12px">' + esc(enrichi.error) + '</div>';
      } else if (enrichi.message) {
        enrichHtml = '<div class="se-note" style="margin-top:12px">' + esc(enrichi.message) + '</div>';
      } else if (enrichi.dossiers && enrichi.dossiers.length) {
        enrichHtml = '<div style="margin-top:12px"><div class="se-hint" style="font-weight:600">' + enrichi.dossiers.length + ' dossier(s) propriétaire</div>' + enrichi.dossiers.map((d) => {
          const o = d.owner || {};
          const cand = (o.candidates && o.candidates[0]) || {};
          const parc = d.parcel || {};
          return '<div class="se-list-item" style="align-items:flex-start"><div style="flex:1;min-width:0">' +
            '<div class="se-hint">' + esc(parc.parcel_ref || 'Parcelle') + (parc.address ? ' · ' + esc(parc.address) : '') + '</div>' +
            (cand.nom || cand.name || cand.raison_sociale ? '<div class="se-hint" style="margin-top:2px">Propriétaire : ' + esc(cand.nom || cand.name || cand.raison_sociale) + '</div>' : '') +
            (cand.siren ? '<div class="se-hint">SIREN : ' + esc(cand.siren) + '</div>' : '') +
            ((cand.dirigeants || []).length ? '<div class="se-hint">Dirigeants : ' + esc(cand.dirigeants.join(', ')) + '</div>' : '') +
            '<div class="se-hint">Statut : ' + esc(o.status || 'UNKNOWN') + '</div>' +
          '</div></div>';
        }).join('') + '</div>';
      }
    }
    const etage = etageDepuisAdresseBrute((g.dpes[0] || {}).adresse_brut);
    const autres = autresChampsAdeme(g.dpes[0] || {});
    return '<h3>Fiche DPE</h3><div style="font-size:15px;font-weight:600;margin-top:4px">' + esc(g.adresse) + '</div>' +
      '<p class="se-muted">' + g.dpes.length + ' diagnostic(s) DPE · source ADEME' + (etage ? ' · étage ' + esc(etage) + ' (estimé, non garanti)' : '') + '</p>' +
      '<div class="se-list" style="margin-top:12px">' + dpesHtml + '</div>' +
      (autres.length ? '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--color-taupe)">Toutes les données ADEME disponibles (' + autres.length + ')</summary><div class="se-kv" style="margin-top:8px">' + autres.map((x) => kv(esc(x.label), esc(String(x.valeur)))).join('') + '</div></details>' : '') +
      enrichHtml +
      '<div class="se-modal-foot">' +
        '<button class="se-btn ghost" type="button" data-act="modal-close">Fermer</button>' +
      '</div>';
  }

  function viewMembres() {
    const membres = state.clients.filter((c) => c.serveurStatut === 'accepte' || c.statut === 'actif' || c.statut === 'client');
    return head('Le Club', 'Membres', membres.length + ' membre(s) validé(s).', '') +
      '<div class="se-card" style="padding:8px 16px">' +
        '<div class="se-table-wrap"><table class="se-table"><thead><tr><th>Membre</th><th>Email</th><th>Profil</th><th>Accès</th><th></th></tr></thead><tbody>' +
        membres.map((c) => '<tr><td><b style="font-weight:500">' + esc(nomClient(c)) + '</b></td><td class="se-hint">' + esc(c.email) + '</td><td>' + (c.type === 'vendeur' ? 'Vendeur' : c.type === 'acquereur' ? 'Acquéreur' : 'Mixte') + '</td><td>' + badgeClient(c.statut) + '</td><td><a class="se-btn ghost sm" href="#/client/' + c.id + '">Ouvrir</a></td></tr>').join('') +
        '</tbody></table></div>' +
      '</div>';
  }

  // Sur la plateforme Seecret = option « Sur Seecret » active + bien validé
  // + statut avant-première ou ouvert (même règle que le serveur).
  function surPlateforme(b) { return !!(b && b.serveur && b.surSeecret !== false && b.validation === 'valide' && (b.statut === 'avant-premiere' || b.statut === 'ouvert')); }
  function raisonHorsPlateforme(b) {
    if (!b.serveur) return 'Bien de démonstration local : il ne peut pas être publié.';
    if (b.surSeecret === false) return 'Option « Sur Seecret » désactivée : le bien reste dans le CRM uniquement.';
    const manque = [];
    if (b.validation !== 'valide') manque.push('valider le bien');
    if (!(b.statut === 'avant-premiere' || b.statut === 'ouvert')) manque.push('le passer en Avant-première ou En vente (statut actuel : ' + ((ST_BIEN[b.statut] || {}).label || b.statut || '—') + ')');
    return manque.length ? 'Option active, mais pas encore visible : il reste à ' + manque.join(' et à ') + '.' : '';
  }
  // Import de fiches vendeurs préparées (.json) : envoi par paquets de 15.
  async function envoyerFiches(items, lot, simulation, progres) {
    const tot = { leadsCrees: 0, leadsCompletes: 0, biensCrees: 0, biensCompletes: 0, photos: 0, erreurs: [] };
    for (let i = 0; i < items.length; i += 15) {
      const r = await fetch('/api/import/fiches-vendeurs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 15), lot: lot, simulation: simulation }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'HTTP ' + r.status);
      ['leadsCrees', 'leadsCompletes', 'biensCrees', 'biensCompletes', 'photos'].forEach((k) => { tot[k] += res[k] || 0; });
      (res.erreurs || []).forEach((x) => tot.erreurs.push({ i: x.i + i, raison: x.raison }));
      if (progres) progres(Math.min(items.length, i + 15), items.length);
    }
    return tot;
  }
  function carteImportFiches() {
    const f = state.impFiches;
    const ligne = (r) => r.leadsCrees + ' lead(s) propriétaire créé(s), ' + r.leadsCompletes + ' complété(s) · ' + r.biensCrees + ' bien(s) créé(s), ' + r.biensCompletes + ' complété(s)' + (r.photos ? ' · ' + r.photos + ' photo(s)' : '') + (r.erreurs.length ? ' · ' + r.erreurs.length + ' écarté(s)' : '');
    let corps = '<p class="se-hint" style="margin:4px 0 10px">Fichier .json préparé à partir des fiches d’une agence : chaque propriétaire devient un lead vendeur, chaque fiche un bien (en préparation, hors plateforme) avec sa photo.</p>' +
      '<label class="se-btn ghost sm">Choisir le fichier<input type="file" accept=".json,application/json" multiple hidden data-import-fiches/></label>';
    if (f && f.chargement) corps += '<p class="se-hint" style="margin-top:10px">Lecture de ' + esc(f.fichiers.join(', ')) + '…</p>';
    if (f && f.erreur) corps += '<p class="se-hint" style="margin-top:10px;color:var(--color-alert)">' + esc(f.erreur) + '</p>';
    if (f && f.sim && !f.fait) corps += '<div class="se-note" style="margin-top:10px">Aperçu (' + f.items.length + ' fiches) : ' + esc(ligne(f.sim)) + '</div>' +
      '<button class="se-btn" style="margin-top:10px" data-act="import-fiches-go"' + (f.envoi ? ' disabled' : '') + '>' + (f.envoi ? 'Import… ' + esc(f.envoi) : 'Importer ' + f.items.length + ' fiches') + '</button>';
    if (f && f.fait) corps += '<div class="se-note" style="margin-top:10px;background:var(--color-ok-soft);border:0;color:var(--color-ok)">Import terminé : ' + esc(ligne(f.fait)) + '. Vérification vendu / en ligne lancée en arrière-plan.</div>';
    return '<details class="se-card pad-sm" style="margin-bottom:18px"' + (f ? ' open' : '') + '><summary style="cursor:pointer;font-weight:500">Importer des fiches vendeurs</summary>' + corps + '</details>';
  }
  async function suivreVerifLot() {
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 8000));
      try {
        const e = await (await fetch('/api/biens/verifier')).json();
        state.verifEtat = e;
        if (!e.enCours && !e.enAttente) break;
        if (location.hash.indexOf('#/biens') === 0) render();
      } catch (x) { break; }
    }
    state.verifLot = false; state.verifEtat = null;
    try {
      const rb = await fetch('/api/biens', { headers: { accept: 'application/json' } });
      if (rb.ok) state.biensServeur = ((await rb.json()).biens || []).map(mapBienServeur);
    } catch (x) { /* rien */ }
    render(); toast('Vérification des biens terminée.', 'ok');
  }
  function carteBien(b) {
    return '<a class="se-card se-bien" href="#/bien/' + b.id + '">' +
      '<div class="se-bien-photo">' + (photo(b) ? '<img src="' + photo(b) + '" alt=""/>' : '') + badgeBien(b.statut) + '</div>' +
      '<div class="se-bien-body"><span class="se-sub">' + esc(b.refAgence || b.ref) + ' · ' + esc(b.type) + (surPlateforme(b) ? ' · <span style="color:var(--color-club-violet)">Sur Seecret</span>' : '') + '</span>' +
      '<h3>' + esc(b.titre) + '</h3><span class="se-price">' + euro(b.prix) + '</span>' +
      (b.verifs || b.suiviAgence ? '<div class="se-row" style="gap:4px;margin-top:6px">' + badgesVerifs(b) + '</div>' : '') +
      '<div class="se-bien-foot">' + esc(qLabel(b.quartier)) + ' · ' + num(b.surface) + ' m² · ' + b.pieces + ' p.</div></div></a>';
  }
  function viewBiensClub() {
    const list = (state.biensServeur || []).filter(surPlateforme);
    const prets = (state.biensServeur || []).filter((b) => !surPlateforme(b) && b.surSeecret !== false);
    return head('Le Club', 'Biens du club', list.length + ' bien(s) visible(s) par les membres sur la plateforme.', '') +
      (list.length
        ? '<div class="se-bien-grid">' + list.map(carteBien).join('') + '</div>'
        : '<div class="se-card se-empty"><div class="se-empty-title">Aucun bien sur la plateforme</div><p>Activez « Sur Seecret » sur la fiche d’un bien validé, en avant-première ou ouvert aux visites.</p></div>') +
      (prets.length
        ? '<div class="se-card" style="margin-top:18px"><h3>Option « Sur Seecret » active, pas encore visibles</h3><div class="se-list" style="margin-top:8px">' +
            prets.map((b) => '<a class="se-list-item" href="#/bien/' + b.id + '" style="text-decoration:none;color:inherit"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(b.titre) + '</div><div class="se-hint">' + esc(raisonHorsPlateforme(b)) + '</div></div><span class="se-hint">›</span></a>').join('') +
          '</div></div>'
        : '');
  }

  // Candidature : ce que la personne a rempli (lead, recherche, bien) et, une
  // fois la décision prise, ce qui vient de se passer et les prochaines étapes.
  function blocsParcoursCandidature(d, lead, rec, bienMembre, estAcheteur, estVendeur) {
    const manque = (liste) => liste.filter((x) => !x[1]).map((x) => x[0]);
    const etat = (m, total) => m.length === 0 ? '<span class="se-badge open">Complet</span>' : '<span class="se-badge warn">' + (total - m.length) + ' / ' + total + '</span>';
    const blocs = [];
    // Lead (toujours)
    const mL = lead ? manque([['téléphone', lead.tel], ['email', lead.email], ['civilité', lead.civilite], ['ville', lead.ville]].concat(estAcheteur ? [['financement', lead.financement], ['apport', lead.apport]] : [])) : ['fiche lead'];
    blocs.push({ titre: 'Fiche lead', icone: ICONS.users, etat: lead ? etat(mL, estAcheteur ? 6 : 4) : '<span class="se-badge muted">…</span>',
      texte: lead ? (mL.length ? 'À compléter : ' + mL.join(', ') + '.' : 'Coordonnées et profil complets.') : 'La fiche lead apparaîtra après synchronisation.',
      bouton: lead ? '<a class="se-btn sm" href="#/client/' + lead.id + '">Ouvrir sa fiche</a>' : '' });
    // Recherche (acheteur)
    if (estAcheteur) {
      const mR = rec ? manque([['type de bien', rec.type || (lead && lead.typeBien)], ['secteurs', (rec.quartiers || []).length || (lead && (lead.quartiers || []).length)], ['budget', rec.prixMax || (lead && lead.budgetMax)], ['surface', rec.surfaceMin || (lead && lead.surfaceMin)]]) : ['critères'];
      const nbMatch = lead ? ((state.biensServeur || []).concat(state.biens).filter((b) => b.statut !== 'vendu' && b.statut !== 'brouillon' && correspond(b, lead)).length) : 0;
      blocs.push({ titre: 'Recherche', icone: ICONS.search, etat: rec ? etat(mR, 4) : '<span class="se-badge muted">Absente</span>',
        texte: rec ? (mR.length ? 'À préciser : ' + mR.join(', ') + '. ' : 'Critères complets. ') + (nbMatch ? nbMatch + ' bien' + (nbMatch > 1 ? 's' : '') + ' du club correspond' + (nbMatch > 1 ? 'ent' : '') + ' déjà.' : 'Aucun bien du club ne correspond encore.') : 'Aucune recherche enregistrée : créez-la depuis sa fiche.',
        bouton: (rec ? '<a class="se-btn sm" href="#/recherche/' + rec.id + '">Voir sa recherche</a>' : '') + (nbMatch ? ' <a class="se-btn ghost sm" href="#/rapprochements">Proposer des biens</a>' : '') });
    }
    // Bien (vendeur)
    if (estVendeur) {
      const b = bienMembre;
      const mB = b ? manque([['photos', (b.photos || []).length], ['prix', b.prix], ['surface', b.surface], ['pièces', b.pieces], ['adresse', b.adresse], ['DPE', b.dpe], ['description', b.description && String(b.description).length > 40]]) : ['fiche bien'];
      const st = b ? ((typeof ST_BIEN !== 'undefined' && ST_BIEN[b.statut] && ST_BIEN[b.statut].label) || b.statut || '') : '';
      blocs.push({ titre: 'Son bien', icone: ICONS.building, etat: b ? etat(mB, 7) : '<span class="se-badge muted">Absent</span>',
        texte: b ? (st ? 'Statut : ' + esc(st) + '. ' : '') + (mB.length ? 'À compléter avant la mise en ligne : ' + mB.join(', ') + '.' : 'Fiche complète : vous pouvez la passer en Avant-première.') : 'Aucun bien enregistré : ajoutez-le depuis sa fiche lead.',
        bouton: b ? '<a class="se-btn sm" href="#/bien/' + b.id + '">' + (mB.length ? 'Compléter la fiche bien' : 'Ouvrir la fiche bien') + '</a>' : '' });
    }
    const S = d.__suite || null;
    const decide = d.statut !== 'nouvelle';
    const accepte = d.statut === 'validee' || d.statut === 'traitee';
    const prenom = (lead && lead.prenom) || String(d.nom || '').trim().split(/\s+/)[0] || 'La personne';
    let etapes = '';
    if (decide) {
      const ok = (t) => '<li class="se-suite-ok">' + t + '</li>';
      const ko = (t) => '<li class="se-suite-ko">' + t + '</li>';
      if (accepte) etapes = ok('Adhésion acceptée : ' + esc(prenom) + ' est maintenant membre du club.') + ok('Son espace est ouvert : connexion avec son email, sans mot de passe.') +
        (S && S.emailEnvoye === false ? ko('L’email d’accès n’est pas parti (' + esc(S.emailErreur || 'erreur') + ') : utilisez « Renvoyer l’email d’accès ».') : ok('Email d’accès envoyé à ' + esc(d.email || 'son adresse') + ', avec son lien et son code.')) +
        (estVendeur && bienMembre ? ok('Son bien reste hors plateforme tant que vous ne l’avez pas passé en Avant-première.') : '') +
        (estAcheteur ? ok('Les biens qui correspondent à sa recherche lui arriveront dès que vous les proposerez.') : '');
      else if (d.statut === 'refusee') etapes = ok('Candidature refusée : aucun accès n’est ouvert.') + ok(esc(prenom) + ' est prévenu (« Votre demande n’a pas été retenue »).') + ok('Sa fiche lead reste dans le CRM : vous pouvez garder le contact ou relancer la demande.');
      else if (d.statut === 'suspendue') etapes = ok('Adhésion suspendue : pas d’accès pour l’instant.') + ok(esc(prenom) + ' est prévenu, le motif est noté dans sa timeline.') + ok('Vous pouvez la reprendre à tout moment depuis cette page.');
    }
    const titre = !decide ? 'Son parcours' : accepte ? 'Accepté : la suite' : d.statut === 'refusee' ? 'Refusé : ce qui se passe' : 'Suspendu : ce qui se passe';
    const sous = !decide ? 'Ce que ' + esc(prenom) + ' a rempli. Après votre décision, voici ce qui se passera et ce qu’il restera à faire.' : accepte ? 'Ce qui vient de se passer, puis les prochaines étapes.' : '';
    const affiche = d.statut === 'refusee' ? blocs.slice(0, 1) : blocs;
    return '<div class="se-card se-suite' + (decide ? ' faite ' + (accepte ? 'validee' : d.statut) : '') + '" style="margin-bottom:18px">' +
      '<div class="se-row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><div><h3 style="margin:0">' + titre + '</h3>' + (sous ? '<p class="se-hint" style="margin:4px 0 0">' + sous + '</p>' : '') + '</div>' +
        (decide ? '' : '<span class="se-hint">' + blocs.length + ' bloc' + (blocs.length > 1 ? 's' : '') + ' : ' + blocs.map((x) => x.titre.toLowerCase()).join(', ') + '</span>') + '</div>' +
      (etapes ? '<ul class="se-suite-etapes">' + etapes + '</ul>' : '') +
      (affiche.length ? '<div class="se-suite-blocs">' + affiche.map((x) => '<div class="se-suite-bloc"><div class="se-row" style="justify-content:space-between;gap:8px;align-items:center"><div class="se-row" style="gap:8px;align-items:center"><span class="se-suite-ico">' + (x.icone || '') + '</span><b>' + x.titre + '</b></div>' + x.etat + '</div><p class="se-hint" style="margin:8px 0 10px;line-height:1.5">' + x.texte + '</p>' + (x.bouton ? '<div class="se-row" style="gap:6px;flex-wrap:wrap">' + x.bouton + '</div>' : '') + '</div>').join('') + '</div>' : '') +
      (decide && accepte && d.__whatsapp ? '<a class="se-btn soft sm" style="margin-top:12px" href="' + d.__whatsapp + '" target="_blank" rel="noopener">Lui envoyer aussi un WhatsApp</a>' : '') +
    '</div>';
  }

  // Deux personnes du même nom ne sont pas la même personne : si la fiche lead
  // rattachée n'a ni le même email ni le même téléphone, on le signale.
  function alerteIdentiteDemande(d, lead) {
    if (!lead) return '';
    const tel = (x) => String(x || '').replace(/\D/g, '').slice(-9);
    const emailDiff = d.email && lead.email && d.email.toLowerCase() !== lead.email.toLowerCase();
    const telDiff = d.tel && lead.tel && tel(d.tel) !== tel(lead.tel);
    if (!emailDiff && !telDiff) return '';
    return '<div class="se-note" style="margin-top:10px;background:var(--color-warn-soft);border:0">Coordonnées différentes de la fiche lead rattachée (' + esc(nomClient(lead)) + ' · ' + esc([emailDiff ? lead.email : '', telDiff ? lead.tel : ''].filter(Boolean).join(' · ')) + '). Vérifiez qu’il s’agit bien de la même personne.</div>';
  }
  function viewDemandeDetail(r) {
    const d = state.demandes.find((x) => x.id === r.param || x.serverDemandeId === r.param);
    if (!d) return '<div class="se-card se-empty"><div class="se-empty-title">Demande introuvable</div><a class="se-btn" href="#/demandes">Retour aux candidatures</a></div>';
    const lead = (d.leadId ? state.clients.find((c) => c.serverId === d.leadId) || archivees('clients').find((c) => c.serverId === d.leadId) : null) ||
      state.clients.find((c) => d.email && c.email && c.email.toLowerCase() === d.email.toLowerCase()) || null;
    const rec = lead ? (state.recherchesServeur || []).concat(state.recherches).find((x) => x.clientId === lead.id || x.clientId === lead.serverId) : null;
    const b = d.bienId ? bienParServeur(d.bienId) : null;
    const docs = lead ? (state.docsParLead[lead.serverId] || []) : [];
    const n = d.statut === 'nouvelle';
    const refusee = d.statut === 'refusee';
    const bienMembre = (state.biensServeur || []).find((x) => d.email && x.email && x.email.toLowerCase() === d.email.toLowerCase());
    const bloquee = !!(bienMembre && bienMembre.exclusivite && bienMembre.exclusivite.statut === 'alerte_doublon');
    const statutBadge = refusee ? '<span class="se-badge muted">Refusée</span>' : d.statut === 'suspendue' ? '<span class="se-badge warn">Suspendue</span>' : n ? '<span class="se-badge warn">En attente</span>' : '<span class="se-badge open">Validée</span>';
    const profil = lead ? lead.type : (d.role === 'vendeur' ? 'vendeur' : d.role === 'mixte' ? 'mixte' : 'acquereur');
    const estAcheteur = profil !== 'vendeur';
    const estVendeur = profil !== 'acquereur';
    const typeBien = (lead && lead.typeBien) || (rec && rec.type) || '';
    const secteurs = (lead && lead.quartiers && lead.quartiers.length) ? lead.quartiers : (rec && rec.quartiers) || [];
    const budgetMax = (lead && lead.budgetMax) || (rec && rec.prixMax) || 0;
    const surfaceMin = (lead && lead.surfaceMin) || (rec && rec.surfaceMin) || 0;
    const surfaceMax = (lead && lead.surfaceMax) || (rec && rec.surfaceMax) || 0;
    const piecesMin = (lead && lead.piecesMin) || (rec && rec.piecesMin) || 0;
    const delai = (lead && lead.delai) || (rec && rec.delai) || '';
    const apport = (lead && lead.apport) || (rec && rec.apport) || 0;
    const financement = (lead && lead.financement) || (rec && rec.financement) || '';
    const courtier = (lead && lead.courtier) || (rec && rec.courtier) || false;
    const bienAVendre = (lead && lead.bienAVendre) || (rec && rec.bienAVendre) || false;
    const villeClient = (lead && lead.ville) || '';
    const profilLabel = profil === 'vendeur' ? 'Vendeur' : profil === 'mixte' ? 'Acheteur et vendeur' : 'Acheteur';
    const NR = 'Non renseigné';
    const photoSrc = (p) => (/^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p);
    const criteresCard = (d.type === 'candidature' && estAcheteur)
      ? '<div class="se-card"><h3>Critères de recherche</h3><div class="se-kv" style="margin-top:10px">' +
          kv('Type de bien', esc(typeBien || NR)) +
          kv('Secteurs', secteurs.length ? secteurs.map(qLabel).join(', ') : NR) +
          kv('Budget max', budgetMax ? euro(budgetMax) : NR) +
          kv('Apport', apport ? euro(apport) : NR) +
          kv('Surface', (surfaceMin || surfaceMax) ? (surfaceMin ? surfaceMin + ' m² min' : '') + (surfaceMax ? ' · ' + surfaceMax + ' m² max' : '') : NR) +
          kv('Pièces min', piecesMin ? piecesMin + ' et +' : NR) +
          kv('Délai', esc(delai || NR)) +
          kv('Bien à vendre pour financer', bienAVendre ? 'Oui' : 'Non') +
        '</div></div>'
      : '';
    const bienCard = (d.type === 'candidature' && estVendeur && bienMembre)
      ? '<div class="se-card"><h3>Fiche du bien (vendeur)</h3><div class="se-kv" style="margin-top:10px">' +
          kv('Type', esc(bienMembre.type || NR)) +
          kv('Adresse', esc([bienMembre.adresse, bienMembre.codePostal, bienMembre.ville].filter(Boolean).join(' ') || NR)) +
          kv('Étage', esc(bienMembre.etage || NR)) +
          kv('Surface', bienMembre.surface ? bienMembre.surface + ' m²' : NR) +
          kv('Pièces', bienMembre.pieces ? bienMembre.pieces : NR) +
          kv('Chambres', bienMembre.chambres ? bienMembre.chambres : NR) +
          kv('Salles de bain', bienMembre.sdb ? bienMembre.sdb : NR) +
          kv('État', esc(bienMembre.etat || NR)) +
          kv('DPE', esc(bienMembre.dpe || NR)) +
          kv('GES', esc(bienMembre.ges || NR)) +
          kv('Extérieur / annexes', ([bienMembre.exterieur].concat(bienMembre.annexes || [], bienMembre.atouts || [])).filter(Boolean).join(', ') || NR) +
          kv('Prix', bienMembre.prix ? euro(bienMembre.prix) : NR) +
          kv('Charges', bienMembre.charges ? euro(bienMembre.charges) + ' / an' : NR) +
          kv('Description', esc(bienMembre.description || NR)) +
          (bienMembre.photos && bienMembre.photos.length
            ? '<div style="margin-top:10px"><div class="se-hint">Photos (' + bienMembre.photos.length + ')</div><div class="se-row" style="gap:6px;margin-top:6px;flex-wrap:wrap">' +
                bienMembre.photos.slice(0, 12).map((p) => '<a href="' + esc(photoSrc(p)) + '" target="_blank" rel="noopener"><img src="' + esc(photoSrc(p)) + '" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;display:block"/></a>').join('') +
              '</div></div>'
            : '<p class="se-hint" style="margin-top:8px">Aucune photo.</p>') +
        '</div></div>'
      : '';
    return '<div style="margin-bottom:16px"><a class="se-btn ghost sm" href="#/demandes">← Retour</a></div>' +
      '<div class="se-fiche-head">' +
        '<span class="se-avatar">' + esc((d.nom || '?').trim().charAt(0).toUpperCase()) + '</span>' +
        '<div style="flex:1"><div class="kicker" style="color:var(--color-taupe)">' + esc((DEMANDE[d.type] || DEMANDE.info).label) + '</div>' +
        '<h1 class="display" style="font-size:28px;margin:4px 0 6px">' + esc(d.nom || 'Demande') + '</h1>' +
        '<div class="se-row" style="gap:8px">' + statutBadge + '<span class="se-hint">Reçue le ' + dFR(d.cree) + '</span></div></div>' +
      '</div>' +
      (d.type === 'candidature' ? blocsParcoursCandidature(d, lead, rec, bienMembre, estAcheteur, estVendeur) : '') +
      '<div class="se-split">' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card"><h3>Coordonnées & financement</h3>' + alerteIdentiteDemande(d, lead) + '<div class="se-kv" style="margin-top:10px">' +
            // Coordonnées saisies DANS cette demande (pas celles d'une autre fiche du même nom).
            kv('Nom', esc(d.nom || (lead ? nomClient(lead) : NR))) +
            kv('Email', esc(d.email || NR)) +
            kv('Téléphone', esc(d.tel || (lead && lead.tel) || NR)) +
            kv('Ville', esc(villeClient || NR)) +
            kv('Profil', profilLabel) +
            kv('Apport', apport ? euro(apport) : NR) +
            kv('Financement', esc(financement || NR)) +
            kv('Courtier', courtier ? 'Oui' : 'Non') +
          '</div></div>' +
          criteresCard +
          bienCard +
          (d.type !== 'candidature' ? '<div class="se-card"><h3>Message</h3><p class="se-muted" style="margin-top:8px">' + esc(d.message || '—') + '</p>' + (d.type === 'modification' && d.prix ? kv('Prix proposé', euro(d.prix)) : '') + '</div>' : '') +
          (b ? '<div class="se-card"><h3>Bien concerné</h3><div class="se-kv" style="margin-top:10px">' + kv('Titre', esc(b.titre || '—')) + kv('Adresse', esc(b.adresse || '—')) + kv('Prix', euro(b.prix)) + (d.montant ? kv('Montant proposé', euro(d.montant)) : '') + kv('Statut', badgeBien(b.statut)) + '</div></div>' : '') +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card"><h3>Documents</h3><div class="se-list" style="margin-top:8px">' +
            ['identite', 'financement', 'bien'].map((t) => {
              const doc = docs.find((x) => x.type === t);
              return '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(libelleDoc(t)) + '</div><div class="se-hint">' + (doc ? esc(doc.nom) : 'Non renseigné') + '</div></div>' + (doc ? '<a class="se-btn ghost sm" href="' + esc(doc.fichier) + '" target="_blank" rel="noopener">Voir</a>' : '<span class="se-hint">—</span>') + '</div>';
            }).join('') +
          '</div></div>' +
          '<div class="se-card"><h3>Actions</h3>' +
            (d.type === 'offre'
              ? (n
                  ? '<button class="se-btn soft block" data-act="offre-accepter" data-id="' + d.id + '">Accepter l’offre</button>' +
                    '<button class="se-btn ghost block" style="margin-top:8px" data-act="offre-contre" data-id="' + d.id + '">Contre-offre</button>'
                  : '<span class="se-hint">Offre traitée.</span>')
              : d.type === 'modification'
              // Avant ce correctif, une demande de modification affichait ici
              // les boutons « Accepter/Suspendre l'adhésion » — sans rapport
              // avec une modification de bien (ils appelaient bien le même
              // décisionnaire côté serveur, qui applique déjà prix/titre/
              // description sur « valider », mais le libellé induisait en
              // erreur et n'offrait aucun accès direct au formulaire du bien).
              ? (n
                  ? (b ? '<button class="se-btn block" data-act="demande-modif-editer" data-id="' + d.id + '">Modifier le bien</button>' : '') +
                    '<button class="se-btn soft block" style="margin-top:8px" data-act="demande-modif-valider" data-id="' + d.id + '">Valider la modification</button>' +
                    '<button class="se-btn danger ghost block" style="margin-top:8px" data-act="demande-modif-refuser" data-id="' + d.id + '">Refuser</button>'
                  : '<span class="se-hint">Demande traitée.</span>')
              : d.type === 'visite'
              ? actionsVisiteHtml(d)
              : d.type === 'statut'
              // Même défaut que pour les demandes de modification : « Accepter
              // / Suspendre l'adhésion » n'a aucun sens pour une demande de
              // passage en visite ouverte. Le décisionnaire serveur applique
              // déjà b.statut = 'ouvert' sur « valider » — seul le libellé
              // et les actions proposées à l'agent étaient à corriger ici.
              ? (n
                  ? (b ? '<button class="se-btn block" data-act="demande-modif-editer" data-id="' + d.id + '">Voir / modifier le bien</button>' : '') +
                    '<button class="se-btn soft block" style="margin-top:8px" data-act="demande-modif-valider" data-id="' + d.id + '">Valider le passage en visite ouverte</button>' +
                    '<button class="se-btn danger ghost block" style="margin-top:8px" data-act="demande-modif-refuser" data-id="' + d.id + '">Refuser</button>'
                  : '<span class="se-hint">Demande traitée.</span>')
              : ((n ? (bloquee
                  ? '<div class="se-note" style="background:var(--color-alert-soft);color:var(--color-alert)">Résolvez l’alerte d’exclusivité de son bien avant de valider son compte.</div>'
                  : '<button class="se-btn soft block" data-act="accepter-adhesion" data-id="' + d.id + '">Accepter l’adhésion</button>') : '') +
                (n ? '<button class="se-btn ghost block" style="margin-top:8px" data-act="suspendre-adhesion" data-id="' + d.id + '">Suspendre l’adhésion</button>' : '') +
                (n ? '<button class="se-btn danger ghost block" style="margin-top:8px" data-act="refuser-adhesion" data-id="' + d.id + '">Refuser</button>' : '') +
                (refusee ? '<button class="se-btn ghost block" data-act="demande-relancer" data-id="' + d.id + '">Relancer la demande</button>' : ''))) +
            (d.type === 'candidature' && !n && !refusee ? '<button class="se-btn ghost block" style="margin-top:8px" data-act="renvoyer-email" data-id="' + (d.serverDemandeId || '') + '">Renvoyer l’email d’accès</button>' : '') +
            (d.__whatsapp ? '<a class="se-btn soft block" style="margin-top:8px" href="' + d.__whatsapp + '" target="_blank" rel="noopener">Envoyer WhatsApp</a>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ---- Visites : mandat de recherche puis confirmation avec adresse ----
  function badgeMandat(d) {
    const m = d.mandat;
    if (m && m.statut === 'signe') return '<span class="se-badge open">Mandat signé</span>';
    return '<span class="se-badge warn">Mandat à signer</span>';
  }

  function actionsVisiteHtml(d) {
    const m = d.mandat;
    const possible = d.visitePossible || { ok: false };
    const creneaux = (d.creneauxLisibles && d.creneauxLisibles.length) ? d.creneauxLisibles : (d.creneau ? [d.creneau] : []);
    const premier = (d.creneaux || [])[0] || '';
    const infoMandat = m && m.statut === 'signe'
      ? '<div class="se-kv" style="margin-top:4px">' + kv('Mandat', 'n° ' + esc(m.numero) + ' · signé le ' + dFR(m.signeLe)) + kv('Valable jusqu’au', dFR(m.expireLe)) + kv('Rétractation', m.demarrageAnticipe ? 'exécution immédiate demandée' : 'jusqu’au ' + dFR(m.retractationFin)) + '</div>' +
        '<a class="se-btn ghost sm" style="margin-top:8px" href="/api/mandat/' + encodeURIComponent(m.id) + '/document" target="_blank" rel="noopener">Voir le mandat signé</a>'
      : '<p class="se-hint" style="margin-top:4px">' + ((state.agenceManquants || []).length
          ? 'Le mandat ne peut pas encore être proposé : identité de l’agence incomplète dans Railway (' + esc(state.agenceManquants.join(', ')) + ').'
          : 'Le membre doit signer son mandat de recherche depuis son espace avant que la visite puisse être confirmée.') + '</p>';
    if (d.statut !== 'nouvelle') {
      return '<div>' + badgeMandat(d) + '</div>' + (d.rdv ? '<p class="se-hint" style="margin-top:8px">Visite confirmée pour le ' + esc(d.rdv.date.split('-').reverse().join('/')) + ' à ' + esc(d.rdv.heure) + '. Adresse envoyée au membre.</p>' : '<span class="se-hint">Demande traitée.</span>') + infoMandat;
    }
    return '<div>' + badgeMandat(d) + '</div>' + infoMandat +
      '<div style="margin-top:14px"><div class="se-hint" style="margin-bottom:6px">Créneaux proposés par le membre</div>' +
        (creneaux.length ? creneaux.map((c) => '<div style="font-size:13.5px">' + esc(c) + '</div>').join('') : '<div class="se-hint">—</div>') +
      '</div>' +
      '<form data-form="visite-confirmer" data-id="' + d.id + '" style="margin-top:14px">' +
        '<div class="se-row" style="gap:8px;flex-wrap:wrap">' +
          '<div class="se-field" style="flex:1;min-width:140px"><label>Date</label><input class="se-input" type="date" name="date" value="' + esc(premier.slice(0, 10)) + '" required/></div>' +
          '<div class="se-field" style="flex:0 1 150px;min-width:130px"><label>Heure</label><input class="se-input" type="time" name="heure" value="' + esc(premier.slice(11, 16)) + '" required/></div>' +
        '</div>' +
        (possible.ok ? '' : '<p class="se-hint" style="margin-top:8px;color:var(--color-alert)">' + esc(possible.raison || 'Mandat non signé.') + '</p>') +
        '<button class="se-btn soft block" style="margin-top:10px" type="submit"' + (possible.ok || possible.apresRetractation ? '' : ' disabled') + '>Confirmer la visite et envoyer l’adresse</button>' +
      '</form>' +
      '<button class="se-btn danger ghost block" style="margin-top:8px" data-act="visite-refuser-agent" data-id="' + d.id + '">Refuser la demande</button>';
  }

  async function confirmerVisite(id, date, heure) {
    const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id);
    if (!d || !d.serverDemandeId) return;
    try {
      const r = await fetch('/api/demandes/' + d.serverDemandeId + '/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ decision: 'valider', rdv: { date: date, heure: heure } }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'Erreur serveur');
      d.statut = 'validee';
      d.rdv = res.rdv || { date: date, heure: heure };
      if (res.notif && res.notif.tel) d.__whatsapp = 'https://wa.me/' + String(res.notif.tel).replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(res.notif.waMessage || '');
      commit();
      ouvrirNotifieModal(res.notif, 'Visite confirmée — adresse envoyée');
    } catch (e) { toast('Confirmation impossible : ' + (e.message || 'erreur'), 'warn'); }
  }

  async function decisionDemande(id, decision, motif) {
    const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id);
    if (!d) return;
    const serverId = d.serverDemandeId || d.id;
    if (!d.serverDemandeId) {
      toast('Ceci est une fiche de test, veuillez utiliser une vraie candidature.', 'warn');
      return;
    }
    try {
      const r = await fetch('/api/demandes/' + serverId + '/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: decision, motif: motif || '' }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'Erreur serveur');
      d.statut = decision === 'valider' ? 'validee' : decision === 'suspendre' ? 'suspendue' : 'refusee';
      d.__suite = { decision: decision, emailEnvoye: res.emailEnvoye !== false, emailErreur: res.emailErreur || '', notif: !!res.notif, tel: res.tel || '', at: new Date().toISOString() };
      setTimeout(() => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } }, 60);
      if (decision === 'valider' && res.lien) d.__whatsapp = whatsappHref(res.tel, res.prenom, res.lien);
      else if (res.notif && res.notif.tel) d.__whatsapp = 'https://wa.me/' + String(res.notif.tel).replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(res.notif.waMessage || '');
      const tv = (state.tachesVerif || []).find((x) => x.demandeId === serverId && x.statut === 'en_attente');
      if (tv) tv.statut = 'terminee';
      commit();
      // Recharge lead, recherche et bien créés côté serveur pour les afficher dans « la suite ».
      if (d.type === 'candidature') { try { await syncServeur(); } catch (e) { /* affichage partiel */ } render(); }
      if (decision === 'valider' && res.emailEnvoye === false) {
        toast('Adhésion acceptée, mais l’email a échoué : ' + (res.emailErreur || 'erreur SMTP'), 'warn');
      } else {
        toast(decision === 'valider' ? 'Adhésion acceptée. Email envoyé et WhatsApp prêt.' : decision === 'suspendre' ? 'Adhésion suspendue, client prévenu.' : 'Demande refusée, client prévenu.', 'ok');
      }
    } catch (e) { toast('Action impossible : ' + (e.message || 'erreur'), 'warn'); }
  }

  function suspendreModal(id) {
    return '<h3>Suspendre l’adhésion</h3><p class="se-muted">Indiquez un motif. Il sera enregistré dans la timeline du membre.</p>' +
      '<form data-form="suspendre" data-id="' + id + '">' +
        '<div class="se-field" style="margin-top:12px"><label>Motif</label><textarea class="se-textarea" name="motif" style="min-height:80px" placeholder="Ex : bien trouvé sur un autre site"></textarea></div>' +
        '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Suspendre</button></div>' +
      '</form>';
  }

  function viewRapprochements() {
    const tousBiens = (state.biensServeur || []).concat(state.biens);
    const recherches = (state.recherchesServeur || []).concat(state.recherches);
    const matches = [];
    recherches.forEach((r) => {
      const c = client(r.clientId);
      if (!c || c.type === 'vendeur') return;
      tousBiens.filter((b) => b.statut !== 'vendu' && b.statut !== 'brouillon').forEach((b) => {
        if (correspond(b, c)) {
          const score = scoreBien(b, c);
          if (score >= 40) matches.push({ bien: b, client: c, score: score });
        }
      });
    });
    matches.sort((a, b) => b.score - a.score);
    const fort = matches.filter((m) => m.score >= 70).length;
    return head('Intelligence', 'Rapprochements',
      matches.length + ' correspondance(s) · ' + fort + ' forte(s) (≥ 70 %).',
      '<a class="se-btn ghost sm" href="#/recherches">Recherche manuelle</a>') +
      (matches.length ? '<div class="se-grid" style="gap:14px">' + matches.slice(0, 40).map((m) => {
        const c = m.client, b = m.bien;
        const tel = (c.tel || '').replace(/[^0-9]/g, '');
        const texte = 'Bonjour ' + (c.prenom || '') + ', nous avons trouvé un bien qui correspond à votre recherche : ' + (b.titre || '') + ' — ' + euro(haiPour(b, c)) + ' honoraires inclus. Souhaitez-vous le visiter ? L’adresse vous sera communiquée à la confirmation de la visite.';
        const wa = tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texte) : null;
        const mailto = c.email ? 'mailto:' + c.email + '?subject=' + encodeURIComponent('Un bien pour vous : ' + (b.titre || '')) + '&body=' + encodeURIComponent(texte) : null;
        return '<div class="se-card">' +
          '<div class="se-row" style="justify-content:space-between;align-items:center">' +
            '<span class="kicker" style="color:var(--color-taupe);margin:0">' + esc(nomClient(c)) + '</span>' +
            scoreTag(m.score) +
          '</div>' +
          '<div style="margin-top:10px"><div style="font-weight:500">' + esc(b.titre || 'Bien') + '</div>' +
          '<div class="se-hint">' + esc(b.adresse || b.ref || '') + ' · ' + euro(b.prix) + ' net · ' + euro(haiPour(b, c)) + ' HAI · ' + (b.surface || 0) + ' m² · ' + (b.pieces || 0) + ' p.</div></div>' +
          '<div class="se-row" style="gap:8px;margin-top:12px">' +
            '<a class="se-btn ghost sm" href="#/bien/' + b.id + '">Voir le bien</a>' +
            (wa ? '<a class="se-btn soft sm" href="' + wa + '" target="_blank" rel="noopener" data-match-propose="' + esc(matchCle(b, c)) + '">Proposer (WhatsApp)</a>' : '') +
            (mailto ? '<a class="se-btn ghost sm" href="' + mailto + '" data-match-propose="' + esc(matchCle(b, c)) + '">Proposer (Email)</a>' : '') +
            ((state.matchsProposes || {})[matchCle(b, c)] ? '<span class="se-badge open">Proposé le ' + dCourt(state.matchsProposes[matchCle(b, c)]) + '</span>'
              : '<button class="se-btn ghost sm" data-act="match-fait" data-id="' + esc(matchCle(b, c)) + '">Déjà proposé / à ignorer</button>') +
          '</div>' +
        '</div>';
      }).join('') + '</div>' : '<div class="se-card se-empty"><div class="se-empty-title">Aucun rapprochement</div><p>Les correspondances apparaîtront dès qu\'un client et un bien matchent.</p></div>');
  }

  // Candidat (demande d'adhésion) ou membre : jamais un lead ajouté par l'agence
  // (import, fichier, saisie), qui reste un prospect sans accès à la plateforme.
  function estCandidatOuMembre(c) {
    return !!c && ['en_attente', 'accepte', 'suspendu', 'refuse'].indexOf(c.serveurStatut) > -1;
  }
  function viewTracking() {
    const enAttente = state.clients.filter((c) => c.serveurStatut === 'en_attente');
    const suspendus = state.clients.filter((c) => c.serveurStatut === 'suspendu');
    const relance = (c, motif) => {
      const tel = (c.tel || '').replace(/[^0-9]/g, '');
      const msg = 'Bonjour ' + (c.prenom || '') + ', ' + motif;
      const wa = tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg) : null;
      const mailto = c.email ? 'mailto:' + c.email + '?subject=' + encodeURIComponent('Votre candidature Seecret') + '&body=' + encodeURIComponent(msg) : null;
      return (wa ? '<a class="se-btn soft sm" href="' + wa + '" target="_blank" rel="noopener">Relancer (WhatsApp)</a>' : '') +
        (mailto ? '<a class="se-btn ghost sm" href="' + mailto + '">Relancer (Email)</a>' : '');
    };
    const row = (c, motif) => '<div class="se-list-item">' +
      '<div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(nomClient(c)) + '</div>' +
      '<div class="se-hint">' + esc(c.email || '') + ' · ' + motif + '</div></div>' +
      relance(c, motif) + '</div>';
    return head('Intelligence', 'Tracking & relances', 'Les candidatures à relancer pour ne rien laisser de côté.', '') +
      '<div class="se-grid cols-2" style="gap:18px;align-items:start">' +
        '<div class="se-card"><h3>Dossiers incomplets ou en attente (' + enAttente.length + ')</h3>' +
          (enAttente.length ? '<div class="se-list" style="margin-top:8px">' + enAttente.map((c) => row(c, 'votre dossier est incomplet : il manque des documents ou des photos. Souhaitez-vous de l\'aide pour finaliser ?')).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Rien à relancer.</p>') +
        '</div>' +
        '<div class="se-card"><h3>Comptes suspendus (' + suspendus.length + ')</h3>' +
          (suspendus.length ? '<div class="se-list" style="margin-top:8px">' + suspendus.map((c) => row(c, 'votre accès a été suspendu. Souhaitez-vous en discuter ?')).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucun compte suspendu.</p>') +
        '</div>' +
      '</div>';
  }

  function offreContreModal(d) {
    return '<h3>Contre-offre</h3><p class="se-muted">Proposez un contre-montant à ' + esc(d.nom || '') + '.</p>' +
      '<form data-form="offre-contre" data-offre="' + (d.offreId || d.id) + '">' +
        '<div class="se-field"><label>Contre-montant (€)</label><input class="se-input" name="contre" type="number" value="' + esc(d.montant || '') + '"/></div>' +
        '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Envoyer la contre-offre</button></div>' +
      '</form>';
  }

  /* --------------------------------- clients ------------------------------ */

  function notifications() {
    const out = [];
    const traitees = state.notificationsTraitees || [];
    (state.taches || []).filter((t) => !t.fait && t.echeance && new Date(t.echeance) < new Date()).forEach((t) => {
      out.push({ id: 'tache-' + t.id, clientId: t.clientId || '', sujet: t.titre, actionAuto: 'Rappel programmé', actionHumaine: 'Relance à effectuer', date: t.echeance, priorite: 'haute', type: 'relance' });
    });
    state.demandes.filter((d) => d.statut === 'nouvelle').forEach((d) => {
      // Les demandes synchronisées depuis le serveur portent leadId (l'id Lead
      // côté serveur), jamais clientId (champ propre aux demandes locales/démo) :
      // on résout le client local via serverId pour que le message pré-rempli et
      // le bouton WhatsApp fonctionnent aussi pour une vraie candidature reçue.
      const c = d.clientId ? client(d.clientId) : (d.leadId ? state.clients.find((x) => x.serverId === d.leadId) : null);
      out.push({ id: 'demande-' + d.id, lien: '#/demande/' + d.id, lienTexte: 'Ouvrir la demande', clientId: c ? c.id : '', sujet: 'Nouvelle demande d’adhésion', actionAuto: 'Dossier reçu', actionHumaine: 'Traiter la demande', date: d.cree || new Date().toISOString(), priorite: 'haute', type: 'demande' });
    });
    state.clients.filter((c) => c.serveurStatut === 'suspendu').forEach((c) => {
      out.push({ id: 'suspendu-' + c.id, clientId: c.id, sujet: 'Adhésion suspendue', actionAuto: 'Suspension enregistrée', actionHumaine: 'Régularisation à suivre', date: new Date().toISOString(), priorite: 'moyenne', type: 'adhesion' });
    });
    // Une pièce envoyée par un client (statut "a_verifier", jamais encore traitée
    // par l'agence) déclenche une notification CRM — une par client, pas par pièce.
    Object.keys(state.docsParLead || {}).forEach((serverId) => {
      const docs = (state.docsParLead[serverId] || []).filter((d) => d.statut === 'a_verifier');
      if (!docs.length) return;
      const c = state.clients.find((x) => x.serverId === serverId);
      out.push({
        id: 'documents-' + serverId, clientId: c ? c.id : '',
        sujet: docs.length > 1 ? docs.length + ' pièces envoyées' : 'Pièce envoyée',
        actionAuto: 'Pièce(s) d’identité reçue(s)', actionHumaine: 'Vérifier et valider la pièce',
        date: docs.map((d) => d.cree).sort().slice(-1)[0] || new Date().toISOString(),
        priorite: 'haute', type: 'documents'
      });
    });
    return out.filter((n) => traitees.indexOf(n.id) === -1);
  }

  // Message pré-rempli pour une relance "À prévenir", adapté au motif (tâche en
  // retard, candidature à traiter, adhésion suspendue) — jamais envoyé
  // automatiquement : seul un clic humain sur WhatsApp ou Copier agit.
  function prevenirMessage(n, c) {
    const prenom = c ? (c.prenom || '') : '';
    if (n.type === 'relance') return 'Bonjour ' + prenom + ', je reviens vers vous au sujet de « ' + n.sujet + ' ». Où en êtes-vous ?\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    if (n.type === 'demande') return 'Bonjour ' + prenom + ', nous avons bien reçu votre demande et revenons vers vous très rapidement.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    if (n.type === 'adhesion') return 'Bonjour ' + prenom + ', votre adhésion à Seecret est actuellement suspendue. Je reste à votre disposition si vous souhaitez en discuter.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    if (n.type === 'documents') return 'Bonjour ' + prenom + ', nous avons bien reçu votre/vos pièce(s). Je reviens vers vous rapidement après vérification.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    return 'Bonjour ' + prenom + ', je reviens vers vous au sujet de « ' + n.sujet + ' ».\n\nBien cordialement,\nGabriel Taieb\nSeecret';
  }

  function viewNotifications() {
    const list = notifications();
    const anciennete = (iso) => { const j = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return j < 1 ? 'Aujourd’hui' : 'Il y a ' + j + ' jour' + (j > 1 ? 's' : ''); };
    const carte = (n) => {
      const c = n.clientId ? client(n.clientId) : null;
      const tel = c ? String(c.tel || '').replace(/[^0-9]/g, '') : '';
      const msg = c ? prevenirMessage(n, c) : '';
      const wa = tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg) : '';
      return '<div class="se-list-item se-notif-item">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="se-kicker" style="font-size:9.5px">' + esc(n.type.toUpperCase()) + '</div>' +
          '<div style="font-size:13.5px;font-weight:500">' + esc(n.sujet) + '</div>' +
          '<div class="se-hint">' + esc(n.actionAuto) + ' → ' + esc(n.actionHumaine) + '</div>' +
          '<div class="se-hint">' + anciennete(n.date) + (c ? ' · ' + esc(nomClient(c)) : '') + '</div>' +
          (c ? '<p class="se-reseau-msg">' + esc(msg.replace(/\n+/g, ' ')) + '</p>' : '') +
        '</div>' +
        '<div class="se-notif-actions">' +
          (n.lien ? '<a class="se-btn soft sm" href="' + n.lien + '">' + esc(n.lienTexte || 'Ouvrir') + '</a>' : '') +
          (c ? '<button class="se-btn ghost sm" data-act="copier-contact" data-value="' + esc(msg) + '">Copier le message</button>' : '') +
          (wa ? '<a class="se-btn ghost sm" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
          (c ? '<a class="se-btn ghost sm" href="#/client/' + c.id + '">Fiche</a>' : '') +
          '<button class="se-btn sm" data-act="notification-traiter" data-id="' + n.id + '">' + ICONS.check + ' Fait</button>' +
        '</div>' +
      '</div>';
    };
    const dernier = state.notifDerniere && Date.now() - (state.notifDerniere.at || 0) < 10 * 60 * 1000 ? state.notifDerniere : null;
    return head('Intelligence', 'À prévenir', 'Ce que vous devez faire vous-même : traiter une demande, rappeler un client, vérifier une pièce… Une fois fait, cliquez « Fait » : la ligne quitte la liste.', '') +
      (dernier ? '<div class="se-note" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:0">« ' + esc(dernier.sujet) + ' » est marquée comme faite.</span><button class="se-btn ghost sm" data-act="notification-annuler" data-id="' + dernier.id + '">Annuler</button></div>' : '') +
      (list.length ? '<div class="se-card"><div class="se-list">' + list.map(carte).join('') + '</div></div>' : '<div class="se-card"><p class="se-muted">Aucune action en attente. Tout est à jour.</p></div>');
  }

  const PIPELINE_COLS = [
    ['a_contacter', 'À contacter'], ['contacte', 'Contacté'], ['a_relancer', 'À relancer'], ['converti', 'Converti'],
    ['ecarte', 'Écarté'], ['hors_cible', 'Hors cible'], ['a_completer', 'À compléter']
  ];

  function whatsappMessage(c) {
    return 'Bonjour ' + (c.prenom || '') + ',\n\nJe me permets de vous contacter au sujet de votre bien situé ' + (c.adresseBien || c.ville || 'dans votre secteur') + '.\n\nJe souhaiterais échanger avec vous afin de savoir si vous envisagez une évolution de votre situation immobilière.\n\nSeriez-vous disponible pour un court échange ?\n\nBien cordialement,\nGabriel Taieb\nSeecret';
  }

  // Signaux vendeurs détectés pour un seul bien (sous-ensemble de signauxVendeurs(),
  // filtré) — réutilisé pour construire un message de prospection qui s'appuie sur
  // de vraies données plutôt que sur une formule générique.
  function signauxPourBien(b) {
    return signauxVendeurs().filter((s) => s.bien && s.bien.id === b.id);
  }

  // Synthèse + argumentaire de prospection générés localement à partir des
  // données déjà collectées (DPE, signaux, propriétaire) — sans appel à une IA
  // externe, pour ne pas consommer le quota Gemini réservé à la dictée vocale.
  // Toujours présenté comme un brouillon à relire et personnaliser, jamais un
  // message à envoyer tel quel.
  function messageProspectionBien(b) {
    const prop = b.proprietaire || {};
    const civilite = prop.type === 'personne' ? '' : '';
    const nomDest = prop.nom ? prop.nom : (prop.type === 'sci' ? 'Madame, Monsieur' : 'Madame, Monsieur');
    const signaux = signauxPourBien(b);
    const argumentaire = [];
    if (b.dpe === 'F' || b.dpe === 'G') {
      argumentaire.push('votre bien est actuellement classé DPE ' + b.dpe + ', ce qui limite progressivement sa mise en location — un sujet que beaucoup de propriétaires anticipent en ce moment');
    }
    if (signaux.some((s) => s.nature === 'DPE récent')) {
      argumentaire.push('un diagnostic énergétique a été réalisé récemment sur ce bien, ce qui correspond souvent à un projet en réflexion (vente, location, ou simple mise à jour)');
    }
    if (signaux.some((s) => s.nature === 'Détention longue')) {
      argumentaire.push('ce bien est détenu depuis plusieurs années, une situation où beaucoup de propriétaires sont ouverts à un échange sur sa valorisation actuelle');
    }
    if (signaux.some((s) => /Permis|Extension|Surélévation|Réhabilitation/.test(s.nature))) {
      argumentaire.push('une démarche d’urbanisme récente a été identifiée sur ce bien ou à proximité');
    }
    const corps = argumentaire.length
      ? 'Je me permets de vous contacter car ' + argumentaire.join(', et par ailleurs ') + '.'
      : 'Je me permets de vous contacter au sujet de votre bien situé ' + (b.adresse || 'dans votre secteur') + '.';
    return 'Bonjour ' + nomDest + ',\n\n' + corps +
      '\n\nSeecret accompagne régulièrement des propriétaires dans ce type de projet (vente, estimation, mise en conformité énergétique) et je serais heureux d’échanger avec vous, sans engagement, pour faire un point sur votre bien.' +
      '\n\nSeriez-vous disponible pour un court échange dans les prochains jours ?' +
      '\n\nBien cordialement,\nGabriel Taieb\nSeecret';
  }

  function prospectionMessageModal(b) {
    const tel = String(((b.contacts || []).find((c) => c.type === 'tel') || {}).valeur || '').replace(/[^0-9]/g, '');
    const signaux = signauxPourBien(b);
    return '<h3>Message de prospection — brouillon</h3>' +
      '<p class="se-muted">' + esc(b.adresse || 'Bien') + (b.dpe ? ' · DPE ' + esc(b.dpe) : '') + '</p>' +
      (signaux.length ? '<p class="se-hint" style="margin-top:6px">Généré à partir de ' + signaux.length + ' signal(aux) détecté(s) : ' + signaux.map((s) => esc(s.nature)).join(', ') + '.</p>' : '<p class="se-hint" style="margin-top:6px">Aucun signal particulier détecté : message générique.</p>') +
      '<div class="se-field" style="margin-top:12px"><label>Message (à relire et personnaliser avant tout envoi)</label><textarea class="se-textarea" id="prospection-msg" style="min-height:220px">' + esc(messageProspectionBien(b)) + '</textarea></div>' +
      '<div class="se-modal-foot">' +
        '<button class="se-btn ghost" type="button" data-act="modal-close">Fermer</button>' +
        '<button class="se-btn" data-act="prospection-copier">Copier le message</button>' +
        (tel ? '<a class="se-btn ghost" target="_blank" rel="noopener" href="https://wa.me/' + tel + '">Ouvrir WhatsApp</a>' : '') +
      '</div>' +
      '<p class="se-hint" style="margin-top:10px">Un brouillon n’est jamais envoyé automatiquement : c’est toujours vous qui décidez du canal (email, SMS, WhatsApp, courrier) et du moment.</p>';
  }

  /* ----------------------- Réseau (relance de masse) ---------------------- */
  // Message WhatsApp pré-rempli, adapté à la provenance du lead (fichier agence
  // déjà en mandat, estimation sans vente, ou lead générique) — jamais envoyé
  // automatiquement : seul un clic humain sur « Envoyer par WhatsApp » ouvre wa.me.
  function reseauMessage(c) {
    const prenomCivil = (c.civilite === 'Mme' ? 'Madame' : c.civilite === 'M.' ? 'Monsieur' : '') ;
    const nom = (prenomCivil ? prenomCivil + ' ' : '') + (c.nom || c.prenom || '');
    if (c.pipeline === 'contacte' || c.pipeline === 'a_relancer') {
      return 'Bonjour ' + (c.prenom || '') + ', je reviens vers vous au sujet de votre projet' +
        (c.adresseBien ? ' concernant ' + c.adresseBien : '') +
        '. Avez-vous eu l’occasion d’y réfléchir ?\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    }
    if (/mandat/i.test(c.source || '') || (c.type === 'vendeur' && c.adresseBien)) {
      return 'Bonjour ' + nom + ', je suis Gabriel Taieb, nous avons déjà été en contact pour votre projet de vente' +
        (c.adresseBien ? ' (' + c.adresseBien + ')' : '') +
        '. Nous lançons Seecret, notre nouveau club immobilier privé, et j’aimerais vous en parler.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    }
    if (/estimation/i.test(c.source || '')) {
      return 'Bonjour ' + nom + ', vous aviez fait estimer votre bien avec nous sans donner suite à l’époque. Nous lançons Seecret, un club privé off-market, qui pourrait vous intéresser pour relancer votre projet au bon moment.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    }
    return whatsappMessage(c);
  }

  function marquerPipeline(c, val, skipCommit) {
    c.pipeline = val;
    if (!skipCommit) commit(); else save();
    if (c.serverId) {
      fetch('/api/leads/' + c.serverId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pipeline: val }) }).catch(() => {});
    }
  }

  // Cadence de relance programmée : J+0 (premier contact) → J+15 → J+45, formalisée à partir du
  // mass-relance existant. Chaque étape ne progresse que sur un clic humain explicite sur
  // « Envoyer par WhatsApp » (jamais d'envoi automatique) ; elle sert seulement à calculer la
  // prochaine échéance et à adapter le ton du message pré-rempli, pas à envoyer quoi que ce soit.
  function cadenceMessage(c) {
    const etape = c.cadence ? c.cadence.etape : 0;
    if (etape === 1) {
      return 'Bonjour ' + (c.prenom || '') + ', je me permets de revenir vers vous' + (c.adresseBien ? ' au sujet de ' + c.adresseBien : '') + '. Avez-vous eu l’occasion d’avancer sur votre projet ? Je reste à votre disposition pour en discuter.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    }
    if (etape >= 2) {
      return 'Bonjour ' + (c.prenom || '') + ', je ne voudrais pas être insistant — ceci sera mon dernier message pour le moment' + (c.adresseBien ? ' au sujet de ' + c.adresseBien : '') + '. N’hésitez pas à revenir vers moi quand votre projet sera plus avancé.\n\nBien cordialement,\nGabriel Taieb\nSeecret';
    }
    return reseauMessage(c);
  }

  function avancerCadence(c) {
    const etapeEnvoyee = c.cadence ? c.cadence.etape : 0;
    const historique = (c.cadence && c.cadence.historique) ? c.cadence.historique.slice() : [];
    historique.push({ etape: etapeEnvoyee, date: new Date().toISOString() });
    let prochaine = null;
    if (etapeEnvoyee === 0) prochaine = new Date(Date.now() + 15 * 86400000).toISOString();
    else if (etapeEnvoyee === 1) prochaine = new Date(Date.now() + 30 * 86400000).toISOString();
    // Après l'étape 2 (J+45), la cadence s'arrête : pas de 4e relance automatique programmée.
    c.cadence = { etape: etapeEnvoyee + 1, prochaine: prochaine, historique: historique };
  }

  function cadenceDue(c) {
    return !!(c.cadence && c.cadence.prochaine && new Date(c.cadence.prochaine).getTime() <= Date.now());
  }

  function cadenceLabel(c) {
    if (!c.cadence || !c.cadence.historique || !c.cadence.historique.length) return '';
    const e = c.cadence.etape;
    if (e === 1) return cadenceDue(c) ? 'Relance J+15 due' : 'Relance J+15 prévue le ' + dFR(c.cadence.prochaine);
    if (e === 2) return cadenceDue(c) ? 'Dernière relance J+45 due' : 'Dernière relance J+45 prévue le ' + dFR(c.cadence.prochaine);
    if (e >= 3) return 'Cadence terminée (3 messages sans réponse)';
    return '';
  }

  function reseauHref(c) {
    const tel = String(c.tel || '').replace(/[^0-9]/g, '');
    return tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(cadenceMessage(c)) : '';
  }

  function aProspecter() {
    return state.clients.filter((c) => c.type === 'vendeur' || c.type === 'mixte' || c.projet === 'prospect' ||
      c.source === 'Immo Data Robot' || c.type === 'societe' || c.type === 'sci' || c.type === 'personne' || c.pipeline);
  }
  function viewReseau(dansLeads) {
    const tab = state.filtres.reseauTab || 'a_contacter';
    const q = (state.filtres.reseauQ || '').toLowerCase();
    const typeF = state.filtres.reseauType || '';
    const ordre = state.filtres.reseauOrdre || 'ancien';
    const tous = state.clients.filter((c) => c.type === 'vendeur' || c.type === 'mixte' || c.projet === 'prospect' ||
      c.source === 'Immo Data Robot' || c.type === 'societe' || c.type === 'sci' || c.type === 'personne' || c.pipeline);
    const parStatut = (k) => tous.filter((c) => (c.pipeline || 'a_contacter') === k);
    let list = parStatut(tab);
    if (typeF) list = list.filter((c) => c.type === typeF);
    if (q) list = list.filter((c) => (nomClient(c) + ' ' + (c.adresseBien || '') + ' ' + (c.ville || '')).toLowerCase().indexOf(q) > -1);
    const dueSeulement = !!state.filtres.reseauCadenceDue;
    if (dueSeulement) list = list.filter((c) => cadenceDue(c));
    list = list.slice().sort((a, b) => ordre === 'alpha'
      ? nomClient(a).localeCompare(nomClient(b))
      : new Date(a.cree || 0) - new Date(b.cree || 0));
    const nbDues = parStatut(tab).filter((c) => cadenceDue(c)).length;

    const ligne = (c) => {
      const tel = String(c.tel || '').replace(/[^0-9]/g, '');
      const msg = cadenceMessage(c);
      const cLabel = cadenceLabel(c);
      return '<div class="se-reseau-row">' +
        '<label class="se-reseau-check"><input type="checkbox" class="sel-reseau" data-id="' + c.id + '"/></label>' +
        '<div class="se-reseau-info">' +
          '<a href="#/client/' + c.id + '"><b>' + esc(nomClient(c)) + '</b></a>' +
          '<div class="se-hint">' + esc(c.source || 'Lead') + (c.adresseBien ? ' · ' + esc(c.adresseBien) : (c.ville ? ' · ' + esc(c.ville) : '')) + (cLabel ? ' · <span style="color:' + (cadenceDue(c) ? 'var(--color-alert)' : 'var(--color-taupe)') + '">' + esc(cLabel) + '</span>' : '') + '</div>' +
          '<p class="se-reseau-msg">' + esc(msg.replace(/\n+/g, ' ')) + '</p>' +
        '</div>' +
        '<div class="se-reseau-actions">' +
          (tel
            ? '<button class="se-btn sm" data-act="reseau-envoyer" data-id="' + c.id + '">' + ICONS.chat + ' Envoyer par WhatsApp</button>'
            : '<span class="se-hint">Numéro indisponible</span>') +
        '</div>' +
      '</div>';
    };

    return (dansLeads ? '<div class="se-note" style="margin-bottom:14px"><b>À prospecter</b> : les propriétaires que vous démarchez (Radar, Immo Data Robot, fichier importé…), du premier message jusqu’à la conversion. Chaque colonne est une étape ; le message WhatsApp est prêt et la relance se programme toute seule (J+15, J+45). Un lead « Converti » devient un lead normal : on crée son produit, puis ses recherches et son suivi.</div>' : head('Prospection', 'À prospecter', tous.length + ' lead(s) · ' + parStatut(tab).length + ' dans cet onglet.', '')) +
      (nbDues
        ? '<div class="se-row" style="margin-bottom:10px">' +
            '<a href="#" data-act="filtre" data-id="reseauCadenceDue:' + (dueSeulement ? '' : '1') + '" class="se-btn sm' + (dueSeulement ? '' : ' ghost') + '" style="border-color:var(--color-alert);color:' + (dueSeulement ? '#fff' : 'var(--color-alert)') + ';background:' + (dueSeulement ? 'var(--color-alert)' : 'transparent') + '">' +
              (dueSeulement ? 'Afficher tout l’onglet' : nbDues + ' relance(s) de cadence due(s) dans cet onglet') +
            '</a>' +
          '</div>'
        : '') +
      '<div class="se-tabs se-reseau-tabs">' +
        PIPELINE_COLS.map(([k, l]) => '<a href="#" data-act="filtre" data-id="reseauTab:' + k + '" class="' + (tab === k ? 'active' : '') + '">' + l + '<span>' + parStatut(k).length + '</span></a>').join('') +
      '</div>' +
      '<div class="se-card pad-sm se-reseau-toolbar">' +
        '<div class="se-filters">' +
          '<input class="se-input se-search" data-filter="reseauQ" placeholder="Nom, adresse…" value="' + esc(state.filtres.reseauQ || '') + '"/>' +
          '<select class="se-select" data-filter="reseauType"><option value="">Tous les projets</option>' +
            '<option value="acquereur"' + (typeF === 'acquereur' ? ' selected' : '') + '>Acquéreur</option>' +
            '<option value="vendeur"' + (typeF === 'vendeur' ? ' selected' : '') + '>Vendeur</option>' +
            '<option value="mixte"' + (typeF === 'mixte' ? ' selected' : '') + '>Acheteur-vendeur</option>' +
          '</select>' +
          '<select class="se-select" data-filter="reseauOrdre">' +
            '<option value="ancien"' + (ordre === 'ancien' ? ' selected' : '') + '>Ordre d’appel : le plus ancien d’abord</option>' +
            '<option value="alpha"' + (ordre === 'alpha' ? ' selected' : '') + '>Ordre d’appel : alphabétique</option>' +
          '</select>' +
        '</div>' +
        '<label class="se-check-all"><input type="checkbox" class="sel-tous-reseau"/> Tout cocher sur la page</label>' +
      '</div>' +
      '<div class="se-reseau-list">' +
        (list.length ? list.map(ligne).join('') : '<p class="se-muted" style="padding:20px 4px">Aucun lead dans cet onglet pour ces filtres.</p>') +
      '</div>' +
      '<div class="se-reseau-bulkbar" id="reseau-bulkbar" hidden>' +
        '<span id="reseau-bulk-count">0 sélectionné(s)</span>' +
        '<span class="se-spacer"></span>' +
        '<button class="se-btn ghost sm" data-act="reseau-marquer-masse" data-vers="contacte">Marquer « Contacté »</button>' +
        '<button class="se-btn ghost sm" data-act="reseau-marquer-masse" data-vers="hors_cible">Marquer « Hors cible »</button>' +
        '<button class="se-btn ghost sm" data-act="reseau-marquer-masse" data-vers="a_completer">Marquer « À compléter »</button>' +
      '</div>';
  }

  function whatsappModal(c) {
    const tel = String(c.tel || '').replace(/[^0-9]/g, '');
    return '<h3>Envoyer par WhatsApp</h3><p class="se-muted">' + esc(nomClient(c)) + ' · ' + esc(c.tel || 'numéro indisponible') + '</p>' +
      '<div class="se-field" style="margin-top:12px"><label>Message (modifiable)</label><textarea class="se-textarea" id="wa-msg" style="min-height:170px">' + esc(whatsappMessage(c)) + '</textarea></div>' +
      '<div class="se-modal-foot">' +
        '<button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button>' +
        (tel ? '<button class="se-btn" data-act="whatsapp-ouvrir" data-tel="' + tel + '">Ouvrir WhatsApp</button>' : '<button class="se-btn" disabled>Numéro indisponible</button>') +
      '</div>' +
      '<p class="se-hint" style="margin-top:10px">Aucun envoi n’est enregistré tant que vous n’avez pas confirmé le contact.</p>';
  }

  function viewPipeline() {
    const leads = state.clients.filter((c) => c.type === 'vendeur' || c.projet === 'prospect' || c.source === 'Immo Data Robot' || c.type === 'societe' || c.type === 'sci' || c.type === 'personne');
    const parColonne = (k) => leads.filter((c) => (c.pipeline || 'a_contacter') === k);
    const typeLead = (c) => c.type === 'sci' ? 'SCI' : c.type === 'societe' ? 'Société' : c.type === 'personne' ? 'Particulier' : c.type === 'vendeur' ? 'Vendeur' : c.type === 'acquereur' ? 'Acquéreur' : 'Lead';
    const carte = (c) => {
      const tel = String(c.tel || '').replace(/[^0-9]/g, '');
      return '<div class="se-pipe-card">' +
        '<div class="se-row" style="justify-content:space-between;align-items:flex-start;gap:6px">' +
          '<div class="se-pipe-nom">' + esc(nomClient(c)) + '</div>' + badgeTemperature(c) + badgeDemo(c) +
        '</div>' +
        '<div class="se-hint">' + typeLead(c) + (c.siren ? ' · SIREN ' + esc(c.siren) : '') + '</div>' +
        (c.adresseBien ? '<div class="se-hint">' + esc(c.adresseBien) + '</div>' : (c.ville ? '<div class="se-hint">' + esc(c.ville) + '</div>' : '')) +
        (c.tel || c.email ? '<div class="se-hint">' + esc(c.tel || '') + (c.tel && c.email ? ' · ' : '') + esc(c.email || '') + '</div>' : '<div class="se-hint muted">Aucun contact</div>') +
        '<div class="se-pipe-actions">' +
          (tel ? '<button class="se-btn ghost sm" data-act="whatsapp-preview" data-id="' + c.id + '">WhatsApp</button>' : '') +
          '<a class="se-btn ghost sm" href="#/client/' + c.id + '">Fiche</a>' +
          '<select class="se-select" style="width:auto" data-act="pipeline-deplacer" data-id="' + c.id + '">' + PIPELINE_COLS.map(([k, l]) => '<option value="' + k + '"' + ((c.pipeline || 'a_contacter') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '</div>' +
      '</div>';
    };
    return head('Prospection', 'Pipeline de relance', leads.length + ' lead(s) dans le pipeline de prospection.', '<a class="se-btn ghost sm" href="#/clients">Liste Leads</a>') +
      '<div class="se-pipe">' + PIPELINE_COLS.map(([k, label]) => {
        const items = parColonne(k);
        return '<div class="se-pipe-col"><div class="se-pipe-col-head">' + label + ' <span class="se-badge muted">' + items.length + '</span></div>' +
          (items.length ? items.map(carte).join('') : '<p class="se-muted" style="font-size:12px;padding:10px">Aucun lead</p>') +
        '</div>';
      }).join('') + '</div>';
  }

  // ---- Import du fichier clients (assets/js/import-clients.js) ----
  // Gardé en mémoire seulement (un fichier de plusieurs milliers de lignes ne
  // doit pas aller dans la sauvegarde locale du CRM).
  let imp = null; // { nom, entetes, lignes, corresp, clients, filtre, envoi, resultat, simulation }
  const IC = () => window.ImportClients;
  function chargerXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'assets/vendor/xlsx/xlsx.full.min.js'; sc.onload = ok; sc.onerror = () => ko(new Error('Lecteur Excel indisponible.')); document.head.appendChild(sc); });
  }
  const nomAgent = () => state.moi ? [state.moi.prenom, state.moi.nom].filter(Boolean).join(' ') : '';
  function importAppliquer() {
    imp.clients = IC().transformer(imp.lignes, imp.corresp);
    imp.simulation = null; imp.resultat = null;
    importSimuler();
  }
  async function importEnvoyer(simulation) {
    const ok = imp.clients.filter((c) => c.etat === 'ok');
    const total = { crees: 0, completes: 0, ignores: 0, details: [] };
    for (let i = 0; i < ok.length; i += 500) {
      const lot = ok.slice(i, i + 500);
      const r = await fetch('/api/leads/import', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ simulation: simulation, lot: imp.lot, lignes: lot.map((c) => IC().versServeur(c, imp.lot)) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Import impossible');
      total.crees += d.crees; total.completes += d.completes; total.ignores += d.ignores;
      d.details.forEach((x) => { const c = lot[x.i]; if (c) c.serveur = x.etat; });
      if (!simulation) { imp.progression = Math.min(ok.length, i + 500) + ' / ' + ok.length; render(); }
    }
    return total;
  }
  async function importSimuler() {
    render();
    try { imp.simulation = await importEnvoyer(true); } catch (e) { imp.simulation = { erreur: e.message }; }
    render();
  }
  function viewImport() {
    const I = IC();
    const intro = head('Prospection', 'Importer mon fichier clients', 'Déposez votre fichier (Excel ou CSV, même brut). Les colonnes sont reconnues, les clients nettoyés, dédoublonnés et classés. Rien n’est enregistré avant votre clic « Importer », et aucun email n’est envoyé.', '<a class="se-btn ghost sm" href="#/clients">← Leads</a>');
    if (!I) return intro + '<div class="se-card"><p class="se-hint">Module d’import non chargé : rechargez la page.</p></div>';
    const depot = '<div class="se-card"><label class="se-import-depot">' + ICONS.plus + '<b>' + (imp ? 'Choisir un autre fichier' : 'Choisir mon fichier clients') + '</b><span class="se-hint">.xlsx, .xls, .csv, .ods — toutes les feuilles du classeur sont lues</span>' +
      '<input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt" hidden data-import-fichier/></label></div>';
    if (!imp) return intro + depot;
    if (imp.chargement) return intro + '<div class="se-card"><p>Lecture de « ' + esc(imp.nom) + ' »…</p></div>';
    if (imp.erreur) return intro + '<div class="se-note" style="margin-bottom:14px">' + esc(imp.erreur) + '</div>' + depot;
    const champs = I.CHAMPS;
    const exemple = (k) => { const l = imp.lignes.find((x) => String(x[k] == null ? '' : x[k]).trim()); const v = l ? l[k] : ''; return v instanceof Date ? v.toLocaleDateString('fr-FR') : String(v).slice(0, 40); };
    const corresp = '<div class="se-card" style="margin-top:18px"><h3>1 · Colonnes reconnues</h3><p class="se-hint" style="margin:4px 0 12px">« ' + esc(imp.nom) + ' » : ' + num(imp.lignes.length) + ' lignes. Corrigez si une colonne est mal reconnue, puis « Appliquer ».</p>' +
      '<div class="se-import-colonnes">' + imp.entetes.map((h, k) => '<div class="se-import-col"><div style="min-width:0"><b>' + esc(h) + '</b><div class="se-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(exemple(k) || '—') + '</div></div>' +
        '<select class="se-select" data-import-col="' + k + '"><option value="">— ignorer —</option>' + champs.map((c) => '<option value="' + c.id + '"' + (imp.corresp[k] === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select></div>').join('') + '</div>' +
      '<button class="se-btn soft" style="margin-top:12px" data-act="import-appliquer">Appliquer</button></div>';
    const C = imp.clients || [];
    const ok = C.filter((c) => c.etat === 'ok'); const fusions = C.filter((c) => c.etat === 'fusion'); const ignores = C.filter((c) => c.etat === 'ignore');
    const sim = imp.simulation;
    const dejaCrm = ok.filter((c) => c.serveur === 'complete').length;
    const seg = {}; ok.forEach((c) => { seg[c.segment] = (seg[c.segment] || 0) + 1; });
    const stat = (n, t) => '<div class="se-import-stat"><b>' + num(n) + '</b><span>' + t + '</span></div>';
    const bilan = '<div class="se-card" style="margin-top:18px"><h3>2 · Tri</h3>' +
      '<div class="se-import-stats">' + stat(ok.length, 'clients uniques') + stat(fusions.length, 'doublons fusionnés') + stat(ignores.length, 'lignes ignorées') +
        stat(sim && !sim.erreur ? dejaCrm : '…', 'déjà dans le CRM (complétés)') + stat(sim && !sim.erreur ? ok.length - dejaCrm : '…', 'nouveaux') + '</div>' +
      (sim && sim.erreur ? '<div class="se-note" style="margin-top:10px">Vérification des doublons avec le CRM impossible : ' + esc(sim.erreur) + '</div>' : '') +
      '<div class="se-import-stats" style="margin-top:10px">' + Object.keys(I.SEGMENTS).map((k) => stat(seg[k] || 0, I.SEGMENTS[k].nom)).join('') + '</div>' +
      '<div class="se-tabs" style="margin:16px 0 10px;flex-wrap:wrap">' + [['ok', 'À importer'], ['fusion', 'Doublons'], ['ignore', 'Ignorées']].concat(Object.keys(I.SEGMENTS).map((k) => [k, I.SEGMENTS[k].tag])).map((f) => '<a href="#" data-act="import-filtre" data-id="' + f[0] + '" class="' + ((imp.filtre || 'ok') === f[0] ? 'active' : '') + '">' + f[1] + '</a>').join('') + '</div>' +
      (function () {
        const f = imp.filtre || 'ok';
        const liste = C.filter((c) => (I.SEGMENTS[f] ? c.etat === 'ok' && c.segment === f : c.etat === f));
        return '<div class="se-list">' + liste.slice(0, 150).map((c) => '<div class="se-list-item" style="gap:10px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:200px">' +
            '<b>' + esc([c.civilite, c.prenom, c.nom].filter(Boolean).join(' ') || '(sans nom)') + '</b>' + (c.fusions > 1 ? ' <span class="se-hint">· ' + c.fusions + ' lignes réunies</span>' : '') +
            '<div class="se-hint">' + esc([c.email, c.tel, c.adresse].filter(Boolean).join(' · ') || '—') + '</div>' +
            (c.notes ? '<div class="se-hint" style="margin-top:2px">' + esc(c.notes.slice(0, 160)) + (c.notes.length > 160 ? '…' : '') + '</div>' : '') + '</div>' +
            '<div class="se-hint" style="text-align:right">' + (c.etat === 'ok' ? esc((I.SEGMENTS[c.segment] || {}).tag || '') + (c.serveur === 'complete' ? '<br>déjà dans le CRM' : '') : esc(c.raison || '')) + (c.date ? '<br>' + c.date.getFullYear() : '') + '<br>ligne ' + c.ligne + '</div></div>').join('') +
          (liste.length > 150 ? '<p class="se-hint" style="padding:10px 0">… et ' + num(liste.length - 150) + ' autres.</p>' : '') + (liste.length ? '' : '<p class="se-hint">Aucune ligne.</p>') + '</div>';
      })() + '</div>';
    const r = imp.resultat;
    const action = '<div class="se-card" style="margin-top:18px"><h3>3 · Importer</h3>' +
      (r ? '<div class="se-note" style="margin-top:8px">Import terminé : <b>' + num(r.crees) + '</b> clients créés, <b>' + num(r.completes) + '</b> fiches existantes complétées. Ils sont dans Leads, étiquetés « Fichier clients » et par segment.</div>'
        : '<p class="se-hint" style="margin:6px 0 12px">Les nouveaux clients arrivent en « prospect », étiquetés « Fichier clients » + leur segment. Les clients déjà connus (même email ou téléphone) sont seulement complétés, rien n’est écrasé. Aucun email ni message n’est envoyé.</p>' +
          '<button class="se-btn" data-act="import-lancer"' + (imp.envoi || !ok.length ? ' disabled' : '') + '>' + (imp.envoi ? 'Import en cours… ' + (imp.progression || '') : 'Importer ' + num(ok.length) + ' clients') + '</button>') + '</div>';
    // Propositions de messages par segment.
    const messages = '<div class="se-card" style="margin-top:18px"><h3>4 · Messages proposés</h3><p class="se-hint" style="margin:4px 0 12px">Un message par segment, personnalisé pour chaque client (prénom, année, quartier, recherche). À copier ou envoyer par WhatsApp / email vous-même : rien ne part automatiquement.</p>' +
      Object.keys(I.SEGMENTS).filter((k) => seg[k]).map((k) => {
        const liste = ok.filter((c) => c.segment === k);
        const ouvert = imp.segOuvert === k;
        return '<div class="se-import-seg"><div class="se-row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><div style="min-width:0;flex:1"><b>' + esc(I.SEGMENTS[k].nom) + '</b> <span class="se-hint">· ' + num(liste.length) + '</span><div class="se-hint">' + esc(I.SEGMENTS[k].idee) + '</div></div>' +
          '<button class="se-btn ghost sm" data-act="import-seg" data-id="' + k + '">' + (ouvert ? 'Fermer' : 'Voir les messages') + '</button></div>' +
          '<pre class="se-import-msg">' + esc(I.message(liste[0], nomAgent())) + '</pre>' +
          (ouvert ? '<div class="se-list">' + liste.slice(0, 200).map((c) => {
            const m = I.message(c, nomAgent());
            const telWa = c.tel.replace(/\D/g, '').replace(/^0/, '33');
            return '<div class="se-list-item" style="gap:8px;flex-wrap:wrap"><div style="flex:1;min-width:180px"><b>' + esc([c.prenom, c.nom].join(' ')) + '</b><div class="se-hint">' + esc(c.email || c.tel) + '</div></div><div class="se-actions">' +
              '<button class="se-btn ghost sm" data-act="copier-contact" data-value="' + esc(m) + '">Copier</button>' +
              (/^33[67]/.test(telWa) ? '<a class="se-btn ghost sm" target="_blank" rel="noopener" href="https://wa.me/' + telWa + '?text=' + encodeURIComponent(m) + '">WhatsApp</a>' : '') +
              (c.email ? '<a class="se-btn ghost sm" href="mailto:' + esc(c.email) + '?subject=' + encodeURIComponent('Seecret — des nouvelles de votre agent') + '&body=' + encodeURIComponent(m) + '">Email</a>' : '') +
              '</div></div>';
          }).join('') + (liste.length > 200 ? '<p class="se-hint">… et ' + num(liste.length - 200) + ' autres (filtrez par étiquette dans Leads).</p>' : '') + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    return intro + depot + corresp + bilan + action + messages;
  }

  // ===================== RADAR — futurs vendeurs =====================
  // Une ligne = un DPE. Tout le reste (propriétaire, gérant, annonces,
  // ventes, contacts, clients intéressés) sert à remplir sa fiche.
  const RD_CRIT = () => ({ periode: 'mois', secteurs: [], type: '', surfaceMin: '', surfaceMax: '', etageMin: '', etageMax: '', dernierEtage: false, prixMin: '', prixMax: '', classes: [], epoque: '', proprio: '', signal: '', niveau: '', client: '', contact: false, statut: '', tri: 'chances' });
  const radar = Object.assign({ data: null, chargement: false, erreur: '', page: 1, lignes: [], fiches: {}, aide: false, vue: 'liste', siren: '', sirenNom: '' }, RD_CRIT());
  const mEuro = (n) => n >= 1e6 ? (Math.round(n / 1e4) / 100).toString().replace('.', ',') + ' M€' : Math.round(n / 1000) + ' k€';
  const etageTxt = (e) => e == null ? '' : e === 0 ? 'RDC' : e === 1 ? '1er étage' : e + 'e étage';
  const rdJours = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso || 0).getTime()) / 864e5));
  const rdDate = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const qLib = (q) => (QUARTIERS.find((x) => x.id === q) || (radar.zones || []).find((x) => x.quartier === q) || {}).label || q;
  const rdAnnees = () => { const a = new Date().getFullYear(); return [a, a - 1, a - 2, a - 3, a - 4, a - 5].map(String); };
  // Secteurs : un bouton qui résume la sélection ; le panneau s'ouvre, on coche,
  // on valide. Rien ne change tant qu'on n'a pas validé.
  function rdChoixSecteurs(chip) {
    const zones = radar.zones || [];
    const resume = !radar.secteurs.length ? (zones.length ? 'Toutes les zones' : 'Tout Paris') : radar.secteurs.length <= 3 ? radar.secteurs.map((q) => qLib(q).replace('Paris ', '')).join(', ') : radar.secteurs.length + ' secteurs';
    const enAttente = (radar.pmCommunes || []).filter((x) => !x.proprietaires).map((x) => (zones.find((z) => z.quartier === x.quartier) || {}).label).filter(Boolean);
    const bouton = '<button type="button" class="rd-choix-btn" data-act="radar-secteurs-ouvrir" aria-expanded="' + (radar.choixSecteurs ? 'true' : 'false') + '"><span>' + esc(resume) + '</span><span aria-hidden="true">' + (radar.choixSecteurs ? '▴' : '▾') + '</span></button>';
    if (!radar.choixSecteurs) return bouton + (enAttente.length ? '<p class="se-hint" style="margin:6px 0 0">⏳ Propriétaires sociétés en cours d’ajout pour ' + esc(enAttente.join(', ')) + '.</p>' : '');
    const t = radar.secteursTemp || [];
    const coche = (id, txt) => '<button type="button" class="rd-chip' + (t.indexOf(id) > -1 ? ' on' : '') + '" data-act="radar-secteur-temp" data-id="' + esc(id) + '">' + txt + '</button>';
    return bouton + '<div class="rd-choix-panneau">' +
      '<div class="rd-choix-titre">Paris</div><div class="rd-choix-grille">' + QUARTIERS.filter((q) => /^p\d+$/.test(q.id)).map((q) => coche(q.id, q.label.replace('Paris ', ''))).join('') + '</div>' +
      '<div class="rd-choix-titre">Autres communes</div><div class="rd-chips">' +
        zones.map((z) => { const pm = (radar.pmCommunes || []).find((x) => x.quartier === z.quartier); return '<span class="rd-zone">' + coche(z.quartier, esc(z.label) + (pm && !pm.proprietaires ? ' ⏳' : '')) + '<button type="button" class="rd-zone-x" data-act="radar-zone-retirer" data-id="' + esc(z.quartier) + '" aria-label="Retirer ' + esc(z.label) + '">×</button></span>'; }).join('') +
        (radar.ajoutZone ? '<span class="rd-zone-form"><input class="se-input" inputmode="numeric" maxlength="5" placeholder="Code postal" data-rd-cp value="' + esc(radar.cpSaisi || '') + '"/><button type="button" class="se-btn sm" data-act="radar-zone-ajouter"' + (radar.ajoutEnCours ? ' disabled' : '') + '>' + (radar.ajoutEnCours ? '…' : 'Ajouter') + '</button><button type="button" class="se-btn ghost sm" data-act="radar-zone-annuler">Annuler</button></span>'
          : '<button type="button" class="rd-chip rd-chip-ajout" data-act="radar-zone-form">+ Code postal</button>') +
      '</div>' +
      (enAttente.length ? '<p class="se-hint" style="margin:8px 0 0">⏳ Propriétaires sociétés en cours d’ajout pour ' + esc(enAttente.join(', ')) + ' : les DPE arrivent tout de suite, les SCI dans quelques minutes.</p>' : '') +
      '<div class="rd-choix-actions"><button type="button" class="se-btn ghost sm" data-act="radar-secteurs-tout">' + (t.length ? 'Tout décocher' : (zones.length ? 'Toutes les zones' : 'Tout Paris')) + '</button><span class="se-hint">' + (t.length ? t.length + ' sélectionné' + (t.length > 1 ? 's' : '') : 'Aucun coché = tout') + '</span><button type="button" class="se-btn sm" data-act="radar-secteurs-valider">Valider</button></div>' +
    '</div>';
  }
  async function chargerRadar(ajout) {
    if (radar.chargement) return;
    radar.chargement = true; if (!ajout) render();
    const q = new URLSearchParams({ periode: radar.periode, secteurs: radar.secteurs.join(','), type: radar.type, surfaceMin: radar.surfaceMin || '', surfaceMax: radar.surfaceMax || '', etageMin: radar.etageMin, etageMax: radar.etageMax, dernierEtage: radar.dernierEtage ? '1' : '',
      prixMin: radar.prixMin ? String(Number(radar.prixMin) * 1000) : '', prixMax: radar.prixMax ? String(Number(radar.prixMax) * 1000) : '', classes: radar.classes.join(''), epoque: radar.epoque, proprio: radar.proprio, signal: radar.signal, niveau: radar.niveau,
      client: radar.client, contact: radar.contact ? '1' : '', statut: radar.statut, tri: radar.tri, siren: radar.siren, page: String(radar.page) });
    try {
      const r = await fetch('/api/radar/liste?' + q.toString(), { credentials: 'same-origin' });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
      radar.lignes = radar.page > 1 ? radar.lignes.concat(d.lignes) : d.lignes;
      if (d.zones) { radar.zones = d.zones; radar.pmCommunes = d.pmCommunes || []; radar.pmAjout = d.pmAjout || null; }
      radar.data = d; radar.erreur = '';
    } catch (e) { radar.erreur = e.message; }
    radar.chargement = false; render();
    if (radar.data && (radar.data.chargement || (radar.data.proprietaires.import || {}).enCours)) setTimeout(() => { if (parseRoute().name === 'radar' && radar.page === 1) chargerRadar(true); }, 3000);
  }
  function rdCritJson() { const c = {}; Object.keys(RD_CRIT()).forEach((k) => { c[k] = radar[k]; }); c.siren = radar.siren; return JSON.stringify(c); }
  function rdRelancer() { radar.applique = rdCritJson(); radar.page = 1; radar.lignes = []; chargerRadar(); }
  // Les critères ne partent qu'au clic sur « Rechercher » : on signale ceux pas encore appliqués.
  function rdMajBouton() {
    const enAttente = radar.applique && rdCritJson() !== radar.applique;
    document.querySelectorAll('[data-rd-attente]').forEach((el) => { el.hidden = !enAttente; });
    document.querySelectorAll('[data-act="radar-rechercher"]').forEach((el) => { el.classList.toggle('rd-a-lancer', !!enAttente); });
  }
  function rdProprio(p, liens) {
    p = p || {};
    if (p.statut === 'identifie') {
      const d = p.dirigeant; const li = liens && p.contacts && (p.contacts.linkedin || [])[0];
      const nomD = d ? ((d.prenom || '') + ' ' + String(d.nom || '').toUpperCase()).trim() : '';
      const societe = liens ? '<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/' + esc(p.siren || '') + '" target="_blank" rel="noopener"><b>' + esc(p.nom) + '</b></a>' : '<b>' + esc(p.nom) + '</b>';
      const gerant = d ? (liens ? '<a href="' + esc(li ? li.url : 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(nomD)) + '" target="_blank" rel="noopener">' + esc(nomD) + (d.age ? ', ' + d.age + ' ans' : '') + '</a>' : esc(nomD) + (d.age ? ', ' + d.age + ' ans' : '')) : '';
      return '<span class="rd-badge noir">' + (p.institutionnel ? 'INSTITUTIONNEL' : p.estSci ? 'SCI' : 'SOCIÉTÉ') + '</span>' + societe + (gerant ? '<span class="rd-sep">·</span>' + gerant : '');
    }
    if (p.statut === 'fichier_absent') return '<span class="rd-badge gris">PROPRIÉTAIRE</span><span class="se-hint">fichier des sociétés pas encore chargé</span>';
    return '<span class="rd-badge clair">PARTICULIER PROBABLE</span><span class="se-hint">aucune société propriétaire à cet étage</span>';
  }
  function rdLigne(x) {
    const a = x.acquereurs || {}; const ch = x.chances || {};
    const etiquette = { contacte: 'CONTACTÉ', en_cours: 'EN COURS', ecarte: 'ÉCARTÉ' }[x.statut];
    return '<a class="rd-carte" href="#/radar-fiche/' + encodeURIComponent(x.id) + '">' +
      '<div class="rd-score ' + (ch.niveau === 'forte' ? 'fort' : ch.niveau === 'moyenne' ? 'moyen' : '') + '" title="Chances de vendre sur 100">' + (ch.score || 0) + '</div>' +
      '<div class="rd-corps">' +
        '<div class="rd-tags-haut">' + (ch.niveau === 'forte' ? '<span class="rd-pastille vert">Forte chance de vendre</span>' : ch.niveau === 'moyenne' ? '<span class="rd-pastille orange">Chance moyenne</span>' : '') + (x.leadId ? '<span class="rd-pastille bleu">Dans mes prospects</span>' : '') + (etiquette ? '<span class="rd-tag statut">' + etiquette + '</span>' : '') + '</div>' +
        '<div class="rd-titre">' + esc(x.type) + ' · ' + num(x.surface) + ' m² · ' + esc(qLib(x.quartier)) + '</div>' +
        '<div class="rd-ligne">📍 ' + esc(String(x.adresse || '').replace(/\s\d{5}\s.*$/, '')) + (x.etage != null ? ' · <b>' + etageTxt(x.etage) + '</b>' : '') + (x.porte ? ' · porte ' + esc(x.porte) : '') + ' · DPE <b>' + esc(x.dpe || '?') + '</b> du ' + rdDate(x.dpeDate) + ' (il y a ' + rdJours(x.dpeDate) + ' j)</div>' +
        '<div class="rd-proprio">' + rdProprio(x.proprietaire) + (x.contact ? ' <span class="rd-ico">contact trouvé</span>' : '') + '</div>' +
        (ch.raison ? '<div class="rd-raison">' + esc(ch.raison) + '</div>' : '') +
      '</div>' +
      '<div class="rd-acq"><div class="rd-acq-t">CLIENTS <br>INTÉRESSÉS</div><div class="rd-acq-n"><div><b class="' + (a.club ? 'vert' : '') + '">' + (a.club || 0) + '</b><span>club</span></div><div><b class="' + (a.leads ? 'vert' : '') + '">' + (a.leads || 0) + '</b><span>lead' + (a.leads > 1 ? 's' : '') + '</span></div></div></div>' +
    '</a>';
  }

  /* ============================ OUTIL SCI ============================ */
  const sci = { zones: [], temp: [], choix: false, q: '', tri: 'score', mono: false, dpe: false, horsInstit: true, signal: '', suivies: false, page: 1, data: null, chargement: false, erreur: '', zonesSup: null, fiches: {}, analyse: {}, lot: null };
  const SCI_SIGNAUX = { deces: 'Gérant décédé', age: 'Gérant âgé', radiee: 'Société cessée', dissolution: 'Dissolution', gerant: 'Nouveau gérant', cession: 'Cession de parts', mono: 'Un seul bien', ancienne: 'SCI ancienne', dpe: 'DPE récent', passoire: 'Passoire F/G' };
  const sciNiveau = (n) => n === 'forte' ? 'alert' : n === 'moyenne' ? 'warn' : 'muted';
  async function sciChargerZones() {
    if (sci.zonesSup) return;
    try { const d = await (await fetch('/api/radar/zones')).json(); sci.zonesSup = (d.zones || []).map((z) => ({ id: z.quartier, label: z.label })); } catch (e) { sci.zonesSup = []; }
  }
  async function sciCharger() {
    sci.chargement = true; sci.erreur = ''; render();
    await sciChargerZones();
    const q = new URLSearchParams({ zones: sci.zones.join(','), q: sci.q, tri: sci.tri, mono: sci.mono ? '1' : '', dpe: sci.dpe ? '1' : '', horsInstit: sci.horsInstit ? '1' : '0', signal: sci.signal, suivies: sci.suivies ? '1' : '', page: String(sci.page) });
    try {
      const r = await fetch('/api/sci/liste?' + q.toString());
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
      sci.data = sci.page > 1 && sci.data ? Object.assign(d, { lignes: sci.data.lignes.concat(d.lignes) }) : d;
    } catch (e) { sci.erreur = e.message || 'erreur'; }
    sci.chargement = false; render();
  }
  function sciZonesTout() { return QUARTIERS.filter((q) => /^p\d+$/.test(q.id)).map((q) => ({ id: q.id, label: q.label.replace('Paris ', '') })).concat(sci.zonesSup || []); }
  function sciLabelZones() {
    if (!sci.zones.length) return (sci.zonesSup || []).length ? 'Toutes les zones' : 'Tout Paris';
    const t = sciZonesTout();
    return sci.zones.length <= 3 ? sci.zones.map((z) => (t.find((x) => x.id === z) || {}).label || z).join(', ') : sci.zones.length + ' secteurs';
  }
  function viewSci(r) {
    if (r && r.param) return viewSciFiche(r.param);
    if (!sci.data && !sci.chargement && !sci.erreur) setTimeout(sciCharger, 0);
    const D = sci.data;
    const choix = sci.choix ? '<div class="rd-choix-panneau">' +
      '<div class="rd-choix-titre">Paris</div><div class="rd-choix-grille">' + QUARTIERS.filter((q) => /^p\d+$/.test(q.id)).map((q) => '<button type="button" class="rd-chip' + (sci.temp.indexOf(q.id) > -1 ? ' on' : '') + '" data-act="sci-zone" data-id="' + q.id + '">' + q.label.replace('Paris ', '') + '</button>').join('') + '</div>' +
      ((sci.zonesSup || []).length ? '<div class="rd-choix-titre">Autres communes</div><div class="rd-chips">' + sci.zonesSup.map((z) => '<button type="button" class="rd-chip' + (sci.temp.indexOf(z.id) > -1 ? ' on' : '') + '" data-act="sci-zone" data-id="' + esc(z.id) + '">' + esc(z.label) + '</button>').join('') + '</div>' : '<p class="se-hint">Ajoutez une commune depuis le Radar (« + Code postal ») pour la retrouver ici.</p>') +
      '<div class="rd-choix-actions"><button type="button" class="se-btn ghost sm" data-act="sci-zones-tout">Tout décocher</button><span class="se-hint">' + (sci.temp.length ? sci.temp.length + ' sélectionné(s)' : 'Aucun coché = tout') + '</span><button type="button" class="se-btn sm" data-act="sci-zones-valider">Valider</button></div></div>' : '';
    const filtres = '<div class="se-card" style="margin-bottom:16px"><div class="sci-filtres">' +
      '<input class="se-input" placeholder="Nom de SCI, SIREN ou gérant" data-sci-q value="' + esc(sci.q) + '" style="flex:2;min-width:180px"/>' +
      '<button type="button" class="rd-choix-btn" data-act="sci-zones-ouvrir"><span>' + esc(sciLabelZones()) + '</span><span>' + (sci.choix ? '▴' : '▾') + '</span></button>' +
      '<select class="se-select" data-sci-f="signal"><option value="">Tous les signaux</option>' + Object.keys(SCI_SIGNAUX).map((k) => '<option value="' + k + '"' + (sci.signal === k ? ' selected' : '') + '>' + SCI_SIGNAUX[k] + '</option>').join('') + '</select>' +
      '<select class="se-select" data-sci-f="tri">' + [['score', 'Probabilité de vendre'], ['dpe', 'DPE le plus récent'], ['biens', 'Plus de biens'], ['nom', 'Nom']].map((o) => '<option value="' + o[0] + '"' + (sci.tri === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '</div>' + choix +
      '<div class="sci-cases">' +
        [['mono', 'Un seul bien'], ['dpe', 'Avec DPE récent'], ['horsInstit', 'Hors institutionnels'], ['suivies', 'Suivies']].map((c) => '<label class="se-check"><input type="checkbox" data-sci-c="' + c[0] + '"' + (sci[c[0]] ? ' checked' : '') + '/> ' + c[1] + '</label>').join('') +
        '<button class="se-btn sm" data-act="sci-chercher">Rechercher</button>' +
      '</div></div>';
    let corps;
    if (sci.erreur) corps = '<div class="se-card"><p class="se-hint">Erreur : ' + esc(sci.erreur) + '</p></div>';
    else if (!D) corps = '<div class="se-card"><p class="se-hint">Chargement des SCI…</p></div>';
    else if (D.disponible === false) corps = '<div class="se-card"><p class="se-hint">Le fichier des propriétaires (DGFiP) n’est pas encore chargé sur le serveur.</p></div>';
    else {
      const aAnalyser = D.lignes.filter((x) => !x.analysee).slice(0, 20);
      corps = '<div class="rd-resultats"><b>' + num(D.total) + ' SCI</b><span class="se-hint">' + esc(sciLabelZones()) + ' · ' + num(D.analysees || 0) + ' analysée(s)</span>' +
        (aAnalyser.length ? '<button class="se-btn ghost sm" data-act="sci-analyser-lot"' + (sci.lot ? ' disabled' : '') + '>' + (sci.lot ? 'Analyse… ' + sci.lot.fait + ' / ' + sci.lot.total : 'Analyser les ' + aAnalyser.length + ' suivantes') + '</button>' : '') + '</div>' +
        '<p class="se-hint" style="margin:0 0 10px">Le score complet (gérant âgé ou décédé, BODACC, ancienneté) apparaît une fois la SCI analysée : touchez « Analyser ».</p>' +
        '<div class="sci-liste">' + D.lignes.map((x) => '<div class="sci-ligne"><a href="#/sci/' + x.siren + '" class="sci-ligne-lien">' +
          '<div class="sci-score ' + sciNiveau(x.niveau) + '">' + x.score + '</div>' +
          '<div style="flex:1;min-width:0"><div class="sci-nom">' + esc(x.nom) + (x.suivie ? ' <span class="se-badge muted">suivie</span>' : '') + '</div>' +
          '<div class="se-hint">' + x.adresses + ' adresse' + (x.adresses > 1 ? 's' : '') + ' · ' + x.lots + ' lot' + (x.lots > 1 ? 's' : '') + ' · ' + esc(x.communes.slice(0, 3).join(', ')) + (x.dirigeants.length ? ' · ' + esc(x.dirigeants.join(' ; ')) : '') + '</div>' +
          (x.resume ? '<div class="sci-resume">' + esc(x.resume) + '</div>' : '') +
          '<div class="se-row" style="gap:4px;margin-top:4px;flex-wrap:wrap">' + x.signaux.map((k) => '<span class="se-badge ' + (k === 'deces' || k === 'dissolution' || k === 'radiee' ? 'alert' : 'warn') + '">' + (SCI_SIGNAUX[k] || k) + '</span>').join('') + (x.dpe ? '<span class="se-badge muted">' + x.dpe + ' DPE</span>' : '') + '</div></div></a>' +
          (x.analysee ? '' : '<button class="se-btn ghost sm" data-act="sci-analyser" data-id="' + x.siren + '"' + (sci.analyse[x.siren] ? ' disabled' : '') + '>' + (sci.analyse[x.siren] ? '…' : 'Analyser') + '</button>') + '</div>').join('') + '</div>' +
        (D.lignes.length < D.total ? '<div style="text-align:center;margin-top:14px"><button class="se-btn ghost" data-act="sci-plus">Voir plus</button></div>' : '');
    }
    return head('Prospection', 'SCI', 'Toutes les SCI propriétaires dans vos secteurs, leur patrimoine, leurs gérants et les signaux de vente.') + filtres + (sci.chargement && !D ? '<div class="se-card"><p class="se-hint">Chargement…</p></div>' : corps);
  }
  async function sciAnalyserUne(siren) {
    sci.analyse[siren] = true; render();
    try {
      const r = await fetch('/api/sci/' + siren + '?analyser=1');
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
      sci.fiches[siren] = d;
      if (sci.data) { const x = sci.data.lignes.find((l) => l.siren === siren); if (x) Object.assign(x, { analysee: true, score: d.score.score, niveau: d.score.niveau, signaux: d.score.signaux.slice(0, 3).map((s) => s.code), resume: d.score.signaux[0] ? d.score.signaux[0].texte : '', dirigeants: ((d.infos && d.infos.dirigeants) || []).filter((g) => g.nom).map((g) => [g.prenom, g.nom].filter(Boolean).join(' ') + (g.deces ? ' (décédé)' : g.age ? ', ' + g.age + ' ans' : '')).slice(0, 2) }); }
    } catch (e) { toast('Analyse impossible : ' + (e.message || 'erreur'), 'warn'); }
    delete sci.analyse[siren]; render();
  }
  function viewSciFiche(siren) {
    const F = sci.fiches[siren];
    if (!F && !sci.analyse[siren]) setTimeout(async () => {
      sci.analyse[siren] = true;
      try { const d = await (await fetch('/api/sci/' + siren)).json(); sci.fiches[siren] = d; if (!d.infos) { delete sci.analyse[siren]; await sciAnalyserUne(siren); return; } } catch (e) { toast('Fiche indisponible', 'warn'); }
      delete sci.analyse[siren]; render();
    }, 0);
    if (!F) return head('Outil SCI', 'Fiche SCI', 'Analyse en cours : annuaire des entreprises, gérants, fichier des décès, BODACC…') + '<div class="se-card"><p class="se-hint">Analyse de la SCI ' + esc(siren) + '…</p></div>';
    const I = F.infos || {}; const S = F.score || { score: 0, signaux: [] };
    const kvs = (k, v) => v ? kv(k, v) : '';
    const dirs = (I.dirigeants || []).map((d) => d.societe
      ? '<div class="se-list-item"><div style="flex:1"><b>' + esc(d.societe) + '</b> <span class="se-hint">' + esc(d.qualite || '') + '</span></div>' + (d.siren ? '<a class="se-btn ghost sm" href="#/sci/' + esc(d.siren) + '">Voir</a>' : '') + '</div>'
      : '<div class="se-list-item" style="display:block"><div><b>' + esc([d.prenoms || d.prenom, d.nom].filter(Boolean).join(' ')) + '</b> <span class="se-hint">' + esc(d.qualite || '') + (d.age ? ' · ' + d.age + ' ans' : '') + (d.naissance ? ' · né(e) en ' + esc(String(d.naissance).slice(0, 7).split('-').reverse().join('/')) : '') + '</span>' +
        (d.deces ? ' <span class="se-badge alert">Décédé' + (d.deces.date ? ' le ' + esc(String(d.deces.date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1')) : '') + (d.deces.lieu ? ' à ' + esc(d.deces.lieu) : '') + '</span>' : d.decesVerifie ? ' <span class="se-hint">· pas dans le fichier des décès</span>' : '') + '</div>' +
        ((d.autresSocietes || []).length ? '<div class="se-hint" style="margin-top:6px">Autres sociétés : ' + d.autresSocietes.map((o) => '<a href="#/sci/' + esc(o.siren) + '">' + esc(o.nom) + '</a>' + (o.biensDgfip ? ' (' + o.biensDgfip + ' adresse' + (o.biensDgfip > 1 ? 's' : '') + ')' : '') + (o.etat === 'C' ? ' <i>cessée</i>' : '')).join(' · ') + '</div>' : '') + '</div>').join('');
    const biens = (F.biens || []).map((b) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(b.adresse) + '</div><div class="se-hint">' + esc(b.commune || '') + ' · ' + b.lots + ' lot' + (b.lots > 1 ? 's' : '') + (b.niveaux && b.niveaux.length ? ' · ' + esc(b.niveaux.slice(0, 6).join(', ')) : '') + '</div></div></div>').join('');
    const dpe = F.dpe && F.dpe.fiches ? F.dpe.fiches.map((f) => '<a class="se-list-item" href="#/radar-fiche/' + esc(f.id) + '" style="text-decoration:none;color:inherit"><div style="flex:1"><div style="font-size:13.5px">' + esc(f.adresse) + '</div><div class="se-hint">DPE ' + esc(f.dpe || '?') + ' · ' + esc(f.type || '') + ' ' + (f.surface || '') + ' m² · ' + dFR(f.date) + '</div></div><span>↗</span></a>').join('') : '';
    const achats = F.achats || (I.achats || null);
    const bod = (I.bodacc || []).map((b) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(b.type || b.famille || 'Annonce') + '</div><div class="se-hint">' + dFR(b.date) + (b.tribunal ? ' · ' + esc(b.tribunal) : '') + '</div>' + (b.detail ? '<div class="se-hint" style="margin-top:2px">' + esc(b.detail.slice(0, 220)) + '</div>' : '') + '</div></div>').join('');
    const lead = (F.leads || [])[0];
    return head('Outil SCI', esc(F.nom || 'SCI'), 'SIREN ' + esc(siren) + (F.forme ? ' · ' + esc(F.forme) : '')) +
      '<div class="se-row" style="gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
        (lead ? '<a class="se-btn" href="#/client/' + esc(lead.id) + '">Ouvrir le lead</a>' : '<button class="se-btn" data-act="sci-lead" data-id="' + siren + '">Créer le lead vendeur</button>') +
        '<button class="se-btn ghost" data-act="sci-suivre" data-id="' + siren + '">' + (F.suivie ? 'Ne plus suivre' : 'Suivre cette SCI') + '</button>' +
        '<button class="se-btn ghost" data-act="sci-lettre" data-id="' + siren + '">Lettre au gérant</button>' +
        '<button class="se-btn ghost" data-act="sci-radar" data-id="' + siren + '" data-nom="' + esc(F.nom || '') + '">Ses DPE dans le Radar</button>' +
        '<button class="se-btn ghost" data-act="sci-reanalyser" data-id="' + siren + '"' + (sci.analyse[siren] ? ' disabled' : '') + '>' + (sci.analyse[siren] ? 'Analyse…' : 'Réanalyser') + '</button>' +
      '</div>' +
      '<div class="sci-grille">' +
        '<div class="se-card"><div class="se-row" style="gap:14px;align-items:center"><div class="sci-score grand ' + sciNiveau(S.niveau) + '">' + S.score + '</div><div><h3 style="margin:0">Probabilité de vendre : ' + esc(S.niveau || '') + '</h3><p class="se-hint" style="margin:2px 0 0">Score sur 100, raisons ci-dessous.</p></div></div>' +
          (S.signaux.length ? '<div class="se-list" style="margin-top:10px">' + S.signaux.map((x) => '<div class="se-list-item"><div style="flex:1;font-size:13.5px">' + esc(x.texte) + '</div><span class="se-badge ' + (x.niveau === 'fort' ? 'alert' : x.niveau === 'moyen' ? 'warn' : 'muted') + '">+' + x.points + '</span></div>').join('') + '</div>' : '<p class="se-hint" style="margin-top:10px">Aucun signal de vente pour l’instant.</p>') +
          ((S.negatifs || []).length ? '<p class="se-hint" style="margin-top:6px">' + S.negatifs.map((x) => esc(x.texte)).join(' ') + '</p>' : '') + '</div>' +
        '<div class="se-card"><h3>Identité</h3><div class="se-kv" style="margin-top:10px">' + kvs('État', esc(I.etat || '')) + kvs('Créée le', I.creation ? dFR(I.creation) : '') + kvs('Siège', esc(I.siege || '')) + kvs('Fermée le', I.dateFermeture ? dFR(I.dateFermeture) : '') + kvs('Analyse', I.maj ? dFR(I.maj) : '') + '</div>' +
          ((I.erreurs || []).length ? '<p class="se-hint" style="margin-top:8px">' + I.erreurs.map(esc).join(' · ') + '</p>' : '') + '</div>' +
        '<div class="se-card"><h3>Gérants</h3>' + (dirs ? '<div class="se-list" style="margin-top:8px">' + dirs + '</div>' : '<p class="se-hint">Non renseignés.</p>') + '<p class="se-hint" style="margin-top:8px">Décès vérifiés dans le fichier INSEE des personnes décédées (nom, prénom et mois de naissance).</p></div>' +
        '<div class="se-card"><h3>Patrimoine (fichier DGFiP)</h3>' + (biens ? '<div class="se-list" style="margin-top:8px">' + biens + '</div>' : '<p class="se-hint">Aucun bien dans les départements suivis.</p>') + '</div>' +
        '<div class="se-card"><div class="se-row" style="justify-content:space-between;gap:8px"><h3>Achats et ventes (DVF)</h3><button class="se-btn ghost sm" data-act="sci-achats" data-id="' + siren + '"' + (sci.analyse['dvf' + siren] ? ' disabled' : '') + '>' + (sci.analyse['dvf' + siren] ? 'Recherche…' : achats ? 'Actualiser' : 'Chercher') + '</button></div>' +
          (achats ? (achats.length ? '<div class="se-list" style="margin-top:8px">' + achats.map((a) => '<div class="se-list-item"><div style="flex:1"><div style="font-size:13.5px"><b>' + euro(a.prix) + '</b>' + (a.surface ? ' · ' + num(a.surface) + ' m²' : '') + ' · ' + esc(a.type || '') + '</div><div class="se-hint">' + esc(a.adresse) + ' · ' + dFR(a.date) + '</div></div></div>').join('') + '</div>' : '<p class="se-hint" style="margin-top:8px">Aucune mutation trouvée sur ses parcelles depuis 2014.</p>') : '<p class="se-hint" style="margin-top:8px">Date et prix d’achat des biens, sur les parcelles de la SCI.</p>') + '</div>' +
        (dpe ? '<div class="se-card"><h3>DPE récents sur ses biens</h3><div class="se-list" style="margin-top:8px">' + dpe + '</div></div>' : '') +
        '<div class="se-card"><h3>Annonces légales (BODACC)</h3>' + (bod ? '<div class="se-list" style="margin-top:8px">' + bod + '</div>' : '<p class="se-hint">Aucune annonce.</p>') + '</div>' +
      '</div>';
  }
  function sciLettre(siren) {
    const F = sci.fiches[siren] || {}; const I = F.infos || {};
    const g = (I.dirigeants || []).find((d) => d.nom && !d.deces) || (I.dirigeants || []).find((d) => d.nom) || {};
    const bien = (F.biens || [])[0];
    const moi = (state.moi && (state.moi.prenom || state.moi.nom)) ? [state.moi.prenom, state.moi.nom].filter(Boolean).join(' ') : 'Seecret';
    return [[g.prenoms || g.prenom, g.nom].filter(Boolean).join(' ') || 'Madame, Monsieur', (I.nom || F.nom || ''), I.siege || '', '', 'Paris, le ' + new Date().toLocaleDateString('fr-FR'), '',
      'Objet : votre bien' + (bien ? ' du ' + bien.adresse + (bien.commune ? ' (' + bien.commune + ')' : '') : ''), '',
      (g.nom ? 'Madame, Monsieur ' + g.nom + ',' : 'Madame, Monsieur,'), '',
      'Je dirige Seecret, un club d’acquéreurs qualifiés qui recherchent des biens à Paris et dans l’ouest parisien, en toute discrétion, sans publicité ni visites inutiles.',
      'Plusieurs de nos membres recherchent actuellement un bien comparable à celui que détient ' + (I.nom || F.nom || 'votre société') + '. Si une vente ou un arbitrage est envisagé, même à moyen terme, je serais heureux d’en parler avec vous et de vous donner une estimation confidentielle.', '',
      'Je reste à votre disposition.', '', 'Bien cordialement,', moi].join('\n');
  }

  function viewRadar() {
    const D = radar.data;
    if (!D && !radar.chargement && !radar.erreur) rdRelancer();
    const intro = head('Prospection', 'Radar des futurs vendeurs', 'Chaque ligne est un DPE : un logement qui va être vendu ou loué. Cliquez une ligne : la fiche réunit le propriétaire, ses raisons de vendre, comment le contacter et vos clients intéressés.', '<button class="se-btn ghost sm" data-act="radar-aide">' + (radar.aide ? 'Fermer' : 'Comment ça marche ?') + '</button>');
    if (!D) return intro + '<div class="se-card"><p class="se-hint">' + (radar.erreur ? 'Radar indisponible : ' + esc(radar.erreur) : 'Chargement…') + '</p></div>';
    const U = D.une || {};
    const derniere = U.derniere && U.derniere < new Date().toISOString().slice(0, 10) ? U.derniere : '';
    const une = '<a href="#" class="rd-une" data-act="radar-une"><b>' + (derniere ? 'Dernière publication ADEME (' + rdDate(derniere) + ')' : 'Aujourd’hui') + ' : ' + num(U.jour) + ' DPE</b> correspondent à vos clients (membres du club ou leads du CRM)<span>' + (derniere ? 'Dernière semaine publiée' : 'Cette semaine') + ' : ' + num(U.semaine) + ' sur ' + num(U.semaineTotal) + ' DPE à Paris · voir la liste →</span>' +
      (derniere ? '<span class="rd-une-note">L’ADEME met en ligne les DPE avec une à deux semaines de retard : « Aujourd’hui » et « Cette semaine » partent donc du ' + rdDate(derniere) + '.</span>' : '') + '</a>';
    const P = D.proprietaires || {}; const imp = P.import || {};
    const pm = P.disponible ? '' : '<div class="se-note rd-pm" style="margin-bottom:14px">' + (imp.enCours ? '<span><b>Chargement du fichier des propriétaires</b> · ' + esc(imp.etape || '') + '</span>' : '<span>Pour reconnaître les propriétaires (SCI, sociétés), chargez une fois le fichier officiel DGFiP' + (imp.erreur ? ' (dernier essai : ' + esc(imp.erreur) + ')' : '') + '.</span><button class="se-btn sm" data-act="radar-pm-importer">Charger le fichier (Paris)</button>') + '</div>';
    const aide = radar.aide ? '<div class="se-card rd-aide"><h3>Comment fonctionne le Radar</h3><ol>' +
      '<li><b>Les lignes</b> : tous les DPE (diagnostics de performance énergétique) faits à Paris sur la période choisie, lus dans la base nationale de l’ADEME. Un DPE est obligatoire avant de vendre ou de louer : un DPE récent signale un logement qui va changer de main.</li>' +
      '<li><b>Le propriétaire</b> : quand c’est une société (SCI, SAS…), le fichier DGFiP la donne étage par étage ; on ajoute ses gérants (nom, âge), ses annonces légales, ses autres biens. Les particuliers ne sont dans aucun fichier public : on les contacte par courrier, avec la lettre prête à imprimer.</li>' +
      '<li><b>Chances de vendre (sur 100)</b> : DPE récent, classe F ou G (location interdite), immeuble qui bouge, SCI d’un seul bien, gérant âgé, dissolution ou changement de gérant, bien détenu depuis longtemps, clients intéressés… Chaque raison est écrite dans la fiche.</li>' +
      '<li><b>Clients intéressés</b> : membres du club et leads du CRM dont le secteur, le type, la surface, le budget et l’étage correspondent.</li>' +
      '<li><b>Contacter</b> : téléphone, email et site de la société, LinkedIn du gérant (clé Exa), téléphone et email du gérant via les annuaires pro (Dropcontact, Société Info, Datagma, FullEnrich — si une clé est configurée) ou Kaspr depuis son LinkedIn, adresse du siège, lettre au propriétaire, et « Ajouter aux prospects ».</li>' +
      '<li><b>Toutes les briques d’Immo Data Robot sont dans la fiche</b> : sociétés domiciliées à l’adresse (SIRENE) quand le fichier DGFiP ne trouve pas le propriétaire, autres sociétés du gérant, permis de construire (AuCadastre), parcelle cadastrale et toutes ses ventes, lots de l’immeuble étage par étage, carte. Les onglets Carte, Secteurs et Propriétaires donnent les vues d’ensemble. Seul le robot Python, qui ne tourne que sur votre ordinateur, n’est pas utilisé en ligne.</li></ol></div>' : '';
    const chip = (on, act, id, txt) => '<button type="button" class="rd-chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' + id + '">' + txt + '</button>';
    const periodes = [['aujourdhui', 'Aujourd’hui'], ['semaine', 'Cette semaine'], ['mois', 'Ce mois'], ['3mois', '3 mois']].concat(rdAnnees().map((a) => [a, a]));
    const sel = (k, opts) => '<label class="rd-crit"><span>' + opts[0] + '</span><select class="se-select" data-rdf="' + k + '">' + opts[1].map((o) => '<option value="' + o[0] + '"' + (String(radar[k] || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
    const duo = (titre, k1, k2, ph) => '<label class="rd-crit"><span>' + titre + '</span><div class="rd-duo"><input class="se-input" type="number" inputmode="numeric" placeholder="' + (ph || 'min') + '" data-rdf="' + k1 + '" value="' + esc(radar[k1] || '') + '"/><input class="se-input" type="number" inputmode="numeric" placeholder="max" data-rdf="' + k2 + '" value="' + esc(radar[k2] || '') + '"/></div></label>';
    const modifie = Object.keys(RD_CRIT()).some((k) => k !== 'periode' && k !== 'tri' && JSON.stringify(radar[k]) !== JSON.stringify(RD_CRIT()[k]));
    const barre = '<div class="se-card rd-barre-filtres">' +
      '<div class="rd-form-ligne"><span class="rd-form-l">DPE fait</span><div class="rd-chips">' + periodes.map((x) => chip(radar.periode === x[0], 'radar-periode', x[0], x[1])).join('') + '</div></div>' +
      '<div class="rd-form-ligne"><span class="rd-form-l">Secteurs</span><div style="flex:1;min-width:0">' + rdChoixSecteurs(chip) + '</div></div>' +
      '<div class="rd-form-ligne"><span class="rd-form-l">Classe DPE</span><div class="rd-chips">' + ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k) => chip(radar.classes.indexOf(k) > -1, 'radar-classe', k, k)).join('') + '<span class="se-hint">' + (radar.classes.length ? '' : 'toutes') + '</span></div></div>' +
      '<div class="rd-criteres-grille">' +
        sel('type', ['Type de bien', [['', 'Appartements et maisons'], ['Appartement', 'Appartements'], ['Maison', 'Maisons']]]) +
        duo('Surface (m²)', 'surfaceMin', 'surfaceMax') +
        duo('Étage', 'etageMin', 'etageMax', 'min (0 = RDC)') +
        duo('Prix estimé (k€)', 'prixMin', 'prixMax') +
        sel('epoque', ['Construction', [['', 'Toutes les époques'], ['avant1948', 'Avant 1948 (ancien)'], ['1948-1974', '1948 – 1974'], ['1975-2000', '1975 – 2000'], ['apres2000', 'Après 2000']]]) +
        sel('proprio', ['Propriétaire', [['', 'Tous'], ['societe', 'Sociétés identifiées'], ['sci', 'SCI seulement'], ['hors-institutionnel', 'Sociétés hors institutionnels'], ['particulier', 'Particuliers']]]) +
        sel('signal', ['Signal de vente', [['', 'Tous'], ['sci-un-bien', 'SCI / société d’un seul bien'], ['gerant-age', 'Gérant de 70 ans et plus'], ['gerance', 'Changement de gérant récent'], ['dissolution', 'Dissolution / procédure'], ['passoire', 'Passoire F ou G'], ['mouvement', 'Immeuble qui bouge'], ['longtemps', 'Détenu depuis 10 ans et plus']]]) +
        sel('niveau', ['Chances de vendre', [['', 'Toutes'], ['moyenne', 'Moyennes et fortes'], ['forte', 'Fortes seulement']]]) +
        sel('client', ['Clients intéressés', [['', 'Peu importe'], ['1', 'Au moins un client'], ['club', 'Un membre du club'], ['leads', 'Un lead du CRM']]]) +
        sel('statut', ['Suivi', [['', 'À traiter (hors écartés)'], ['a_revoir', 'À revoir'], ['en_cours', 'En cours'], ['contacte', 'Contactés'], ['prospect', 'Dans mes prospects'], ['ecarte', 'Écartés']]]) +
        sel('tri', ['Tri', [['chances', 'Plus de chances de vendre'], ['recent', 'DPE le plus récent'], ['ancien', 'DPE le plus ancien'], ['clients', 'Plus de clients intéressés'], ['surface', 'Plus grande surface']]]) +
      '</div>' +
      '<div class="rd-form-actions"><label class="rd-toggle"><input type="checkbox" data-rdf="dernierEtage"' + (radar.dernierEtage ? ' checked' : '') + '/> Dernier étage</label><label class="rd-toggle"><input type="checkbox" data-rdf="contact"' + (radar.contact ? ' checked' : '') + '/> Contact trouvé (tél., email ou LinkedIn)</label>' +
        (modifie ? '<button class="se-btn ghost sm" data-act="radar-reset">Effacer les critères</button>' : '') +
        '<span class="rd-attente" data-rd-attente' + (radar.applique && rdCritJson() !== radar.applique ? '' : ' hidden') + '>Critères modifiés : lancez la recherche</span>' +
        '<button class="se-btn rd-rechercher' + (radar.applique && rdCritJson() !== radar.applique ? ' rd-a-lancer' : '') + '" data-act="radar-rechercher"' + (radar.chargement ? ' disabled' : '') + '>' + (radar.chargement ? 'Recherche…' : 'Rechercher') + '</button></div></div>';
    const ch = D.chargement;
    const charg = ch ? '<div class="se-card rd-job"><b>Chargement des DPE ' + esc(D.periode.libelle) + '…</b><div class="rd-barre" style="margin-top:8px"><i style="width:' + Math.round(ch.faits / Math.max(1, ch.total) * 100) + '%"></i></div><div class="se-hint" style="margin-top:6px">' + ch.faits + '/' + ch.total + ' arrondissement' + (ch.total > 1 ? 's' : '') + ' · ' + num(ch.lus) + ' DPE lus. La liste se complète toute seule.</div></div>' : '';
    const entete = '<div class="rd-resultats"><b>' + num(D.total) + ' DPE ' + esc(D.periode.libelle) + '</b><span class="se-hint">' + esc(radar.secteurs.length ? radar.secteurs.map((q) => qLib(q).replace('Paris ', '')).join(', ') : 'tout Paris') + (radar.client ? ' · qui intéressent un client' : '') + '</span></div>' +
      (D.plafond ? '<p class="se-hint">Beaucoup de DPE sur cette période : choisissez un arrondissement pour tout voir.</p>' : '') + ((D.erreurs || []).length ? '<p class="se-hint">' + D.erreurs.map(esc).join(' · ') + '</p>' : '');
    const liste = '<div class="rd-liste">' + (radar.lignes.length ? radar.lignes.map(rdLigne).join('') : '<div class="se-card"><p class="se-hint">' + (ch ? 'Les premiers DPE arrivent…' : 'Aucun DPE avec ces filtres.') + '</p></div>') + '</div>' +
      (radar.lignes.length < D.total ? '<button class="se-btn ghost" style="margin-top:12px;width:100%" data-act="radar-plus"' + (radar.chargement ? ' disabled' : '') + '>Afficher les 50 suivants (' + num(D.total - radar.lignes.length) + ' restants)</button>' : '');
    const V = D.vues || { secteurs: [], portefeuilles: [], carte: [] };
    const vues = '<div class="rd-onglets">' + [['liste', 'Liste des DPE · ' + num(D.total)], ['carte', 'Carte'], ['secteurs', 'Secteurs'], ['proprietaires', 'Propriétaires · ' + num(V.portefeuilles.length)]].map((o) => '<a href="#" data-act="radar-vue" data-id="' + o[0] + '" class="' + (radar.vue === o[0] ? 'active' : '') + '">' + o[1] + '</a>').join('') + '</div>' +
      (radar.siren ? '<div class="se-note" style="margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1">DPE de la société <b>' + esc(radar.sirenNom || radar.siren) + '</b> seulement.</span><button class="se-btn ghost sm" data-act="radar-siren" data-id="">Voir tous les DPE</button></div>' : '');
    let contenu = entete + liste;
    if (radar.vue === 'carte') contenu = '<div id="radar-carte" class="rd-carte-map"></div><p class="se-hint" style="margin-top:6px">' + num(V.carte.length) + ' DPE placés sur la carte (vert : fortes chances, orange : moyennes, gris : faibles). Cliquez un point pour ouvrir la fiche.</p>';
    if (radar.vue === 'secteurs') { const mx = Math.max(1, ...V.secteurs.map((x) => x.dpe)); contenu = '<div class="se-card">' + (V.secteurs.length ? V.secteurs.map((x, i) => '<a class="rd-sect" href="#" data-act="radar-vers-secteur" data-id="' + x.quartier + '"><span class="rd-sect-n">' + (i + 1) + '</span><div style="flex:1;min-width:0"><div class="rd-sect-l"><b>' + esc(x.label) + '</b><div class="rd-barre"><i style="width:' + Math.round(x.dpe / mx * 100) + '%"></i></div></div><div class="se-hint">' + num(x.dpe) + ' DPE · ' + num(x.fortes) + ' à fortes chances · ' + num(x.identifies) + ' propriétaires sociétés · ' + num(x.clients) + ' client' + (x.clients > 1 ? 's' : '') + ' y cherche' + (x.clients > 1 ? 'nt' : '') + '</div></div></a>').join('') : '<p class="se-hint">Aucun DPE.</p>') + '</div>'; }
    if (radar.vue === 'proprietaires') contenu = '<div class="se-card"><p class="se-hint" style="margin-top:0">Les sociétés propriétaires des logements de la sélection, avec leur portefeuille à Paris.</p>' + (V.portefeuilles.length ? '<div class="se-list">' + V.portefeuilles.map((x) => '<div class="se-list-item" style="flex-wrap:wrap;gap:8px;align-items:flex-start"><div style="flex:1;min-width:220px"><b>' + esc(x.nom) + '</b> <span class="se-hint">' + (x.institutionnel ? 'institutionnel · ' : x.estSci ? 'SCI · ' : 'société · ') + num(x.dpe) + ' DPE dans la sélection · ' + num(x.nbBiens) + ' immeuble' + (x.nbBiens > 1 ? 's' : '') + ' à Paris' + (x.dirigeant ? ' · ' + esc(x.dirigeant) : '') + '</span><div class="se-hint" style="margin-top:4px">' + x.fiches.map((f) => '<a href="#/radar-fiche/' + encodeURIComponent(f.id) + '">' + esc(String(f.adresse).replace(/\s\d{5}\s.*$/, '')) + (f.etage != null ? ' (' + etageTxt(f.etage) + ')' : '') + '</a>').join(' · ') + '</div></div><button class="se-btn ghost sm" data-act="radar-siren" data-id="' + esc(x.siren) + '" data-nom="' + esc(x.nom) + '">Voir ses DPE</button></div>').join('') + '</div>' : '<p class="se-hint">Aucune société identifiée dans la sélection.</p>') + '</div>';
    return intro + une + pm + aide + barre + charg + vues + contenu +
      '';
  }
  async function chargerFicheRadar(id, enrichir) {
    if (!radar.fiches[id] || !radar.fiches[id].fiche) radar.fiches[id] = { chargement: true };
    try {
      const r = await fetch('/api/radar/fiche/' + encodeURIComponent(id) + (enrichir ? '?enrichir=1' : ''), { credentials: 'same-origin' });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
      d.enrichi = !d.enCours && (!!enrichir || !!d.fiche.enrichiLe);
      radar.fiches[id] = d;
    } catch (e) { if (!radar.fiches[id] || !radar.fiches[id].fiche) radar.fiches[id] = { erreur: e.message }; }
    render();
    const F = radar.fiches[id];
    if (!enrichir && F && F.fiche && (!F.fiche.enrichiLe || !F.fiche.enrichiComplet)) chargerFicheRadar(id, true);
    // Recherche encore en cours côté serveur : on revient chercher le résultat.
    else if (F && F.enCours && location.hash.indexOf(encodeURIComponent(id)) > -1) setTimeout(() => chargerFicheRadar(id, true), 4000);
  }
  // ---- Téléphone et email du gérant : action volontaire, outil par outil ----
  // +33612345678 → +33 6 12 34 56 78 ; 0612345678 → 06 12 34 56 78
  function rdTel(t) {
    const v = String(t || '').replace(/[^\d+]/g, '');
    if (/^\+33\d{9}$/.test(v)) return '+33 ' + v.slice(3, 4) + ' ' + v.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ');
    if (/^0\d{9}$/.test(v)) return v.replace(/(\d{2})(?=\d)/g, '$1 ');
    return t;
  }
  const RD_STATUT_OUTIL = { trouve: 'trouvé', vide: 'rien trouvé', epuise: 'crédits épuisés', erreur: 'erreur (vérifiez la clé)', non_configure: 'pas de clé' };
  function rdJauge(o) {
    if (!o.configure) return '<span class="se-hint">pas de clé dans Railway</span>';
    if (o.soldeConnu && typeof o.solde === 'number') {
      const max = Math.max(o.max || 0, o.solde, 1); const pc = Math.round(o.solde / max * 100);
      const cls = o.solde <= 0 ? 'vide' : pc < 20 ? 'bas' : '';
      return '<span class="rd-jauge ' + cls + '" title="' + o.solde + ' crédits sur ' + max + ' (plus haut solde vu)"><i style="width:' + pc + '%"></i></span><span class="rd-jauge-txt">' + num(o.solde) + ' crédit' + (o.solde > 1 ? 's' : '') + ' restant' + (o.solde > 1 ? 's' : '') + '</span>';
    }
    return '<span class="rd-jauge inconnue" title="Cet outil ne donne pas son solde"><i style="width:100%"></i></span><span class="rd-jauge-txt">solde non communiqué · ' + o.utilisesMois + ' recherche' + (o.utilisesMois > 1 ? 's' : '') + ' ce mois' +
      (o.dernier && (o.dernier.statut === 'epuise' || o.dernier.statut === 'erreur') ? ' · dernier essai : ' + esc(RD_STATUT_OUTIL[o.dernier.statut]) : '') + '</span>';
  }
  function rdBlocCoordonnees(F, p) {
    const d = p.dirigeant;
    if (!d || !d.nom) return '';
    const nomD = ((d.prenom || '') + ' ' + d.nom).trim();
    const cp = p.coordPro;
    const res = cp && (cp.etapes || []).length ? '<p class="se-hint" style="margin:6px 0 0">Dernière recherche' + (cp.le ? ' le ' + dFR(cp.le) : '') + ' : ' + cp.etapes.map((e) => esc(e.fournisseur) + ' — ' + esc(RD_STATUT_OUTIL[e.statut] || e.statut)).join(' · ') + '</p>' : '';
    if (!radar.coordOuvert || radar.coordOuvert !== F.fiche.id) {
      return '<div class="rd-coord"><button class="se-btn sm" data-act="radar-coord-ouvrir" data-id="' + esc(F.fiche.id) + '">📞 Téléphone et email du gérant</button>' +
        '<span class="se-hint"> Recherche payante en crédits : vous choisissez les outils.</span>' + res + '</div>';
    }
    const outils = radar.outilsCoord;
    if (!outils) return '<div class="rd-coord"><p class="se-hint">Lecture des crédits restants…</p></div>';
    const choix = radar.coordChoix || {};
    const lignes = outils.map((o) => {
      const vide = o.soldeConnu && typeof o.solde === 'number' && o.solde <= 0;
      const ok = o.configure && !vide;
      const coche = ok && choix[o.id] !== false;
      return '<label class="rd-outil' + (ok ? '' : ' off') + '"><input type="checkbox" data-coord-outil="' + o.id + '"' + (coche ? ' checked' : '') + (ok ? '' : ' disabled') + '/>' +
        '<span class="rd-outil-nom">' + esc(o.nom) + '</span>' + rdJauge(o) +
        (o.configure ? ' <a class="se-hint" href="' + esc(o.site) + '" target="_blank" rel="noopener">recharger</a>' : '') + '</label>';
    }).join('');
    const nb = outils.filter((o) => o.configure && !(o.soldeConnu && typeof o.solde === 'number' && o.solde <= 0) && choix[o.id] !== false).length;
    return '<div class="rd-coord ouvert"><div class="rd-coord-tete"><b>Téléphone et email de ' + esc(nomD) + '</b><button class="se-btn ghost sm" data-act="radar-coord-fermer">Fermer</button></div>' +
      '<p class="se-hint" style="margin:4px 0 10px">Chaque outil coché coûte environ 1 crédit par recherche. Les outils sont interrogés dans l’ordre.</p>' +
      '<div class="rd-outils">' + lignes + '</div>' +
      '<label class="rd-outil-opt"><input type="checkbox" data-coord-tout' + (choix._tout ? ' checked' : '') + '/> Interroger tous les outils cochés, même après un premier résultat (plus de chances, plus de crédits)</label>' +
      '<div class="se-row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="se-btn" data-act="radar-coord-lancer" data-id="' + esc(F.fiche.id) + '"' + (nb && !radar.coordEnCours ? '' : ' disabled') + '>' +
        (radar.coordEnCours ? 'Recherche en cours… (jusqu’à 1 min par outil)' : 'Lancer la recherche · ' + nb + ' outil' + (nb > 1 ? 's' : '') + ' · ' + (choix._tout ? nb : 'jusqu’à ' + nb) + ' crédit' + (nb > 1 ? 's' : '')) + '</button>' +
        '<button class="se-btn ghost sm" data-act="radar-coord-soldes">Actualiser les soldes</button></div>' + res + '</div>';
  }
  async function rdChargerOutils(rafraichir) {
    try { const r = await fetch('/api/radar/credits' + (rafraichir ? '?rafraichir=1' : ''), { credentials: 'same-origin' }); const d = await r.json(); if (r.ok) radar.outilsCoord = d.outils; } catch (e) { /* hors ligne */ }
    render();
  }
  function rdLettre(F) {
    const x = F.fiche; const p = x.proprietaire || {}; const d = p.dirigeant; const ag = F.agent || {};
    const ou = x.adresse + (x.etage != null ? ', ' + etageTxt(x.etage) : '') + (x.porte ? ', porte ' + x.porte : '');
    const dest = p.statut === 'identifie' ? (p.nom + (d ? '\nÀ l’attention de ' + (d.prenom || '') + ' ' + (d.nom || '') : '') + '\n' + ((p.societe && p.societe.siege) || '')) : 'Madame, Monsieur le Propriétaire\n' + ou;
    const corps = (p.statut === 'identifie' && d ? 'Madame, Monsieur,' : 'Madame, Monsieur,') + '\n\n' +
      'Je suis ' + (ag.nom || 'agent immobilier') + ', de Seecret, un club immobilier parisien qui vend des biens en toute discrétion, sans annonce publique, à des acquéreurs déjà vérifiés.\n\n' +
      (function () { const n = ((F.acquereurs || {}).club || []).length + ((F.acquereurs || {}).leads || []).length; return n >= 2 ? 'Plusieurs de nos clients recherchent précisément un ' + x.type.toLowerCase() + ' comme le vôtre (' + ou + ').' : n === 1 ? 'L’un de nos clients recherche précisément un ' + x.type.toLowerCase() + ' comme le vôtre (' + ou + ').' : 'Nos clients recherchent des biens dans votre quartier, et votre ' + x.type.toLowerCase() + ' (' + ou + ') pourrait les intéresser.'; })() +
      (x.prixBas ? ' Les ventes récentes du quartier situent un bien de ' + x.surface + ' m² entre ' + mEuro(x.prixBas) + ' et ' + mEuro(x.prixHaut) + '.' : '') + '\n\n' +
      'Si vous envisagez de vendre, ou si vous souhaitez simplement connaître la valeur de votre bien aujourd’hui, je serais heureux de vous rencontrer, sans engagement.\n\n' +
      'Bien cordialement,\n\n' + (ag.nom || '') + '\nSeecret' + (ag.tel ? '\n' + ag.tel : '') + (ag.email ? '\n' + ag.email : '');
    return { dest: dest, corps: corps };
  }
  function viewRadarFiche(r) {
    const id = decodeURIComponent(r.param || '');
    const F = radar.fiches[id];
    const retour = '<a class="se-btn ghost sm" href="#/radar">← Radar</a>';
    if (!F) { chargerFicheRadar(id); return head('Radar', 'Fiche', '', retour) + '<div class="se-card"><p class="se-hint">Chargement…</p></div>'; }
    if (F.chargement) return head('Radar', 'Fiche', '', retour) + '<div class="se-card"><p class="se-hint">Chargement…</p></div>';
    if (F.erreur) return head('Radar', 'Fiche', '', retour) + '<div class="se-card"><p class="se-hint">' + esc(F.erreur) + '</p></div>';
    const x = F.fiche; const p = x.proprietaire || {}; const ch = x.chances || { signaux: [] };
    const st = x.statut || 'a_revoir';
    const enCours = !F.enrichi ? '<div class="se-note" style="margin-bottom:14px">Recherche en cours : gérant, LinkedIn, téléphone et email, annonces légales, ventes… La fiche se complète toute seule (jusqu’à une minute la première fois).</div>' : '';
    const bouton = (v, t) => '<button class="se-btn ' + (st === v ? '' : 'ghost ') + 'sm" data-act="radar-statut" data-id="' + esc(x.id) + '" data-statut="' + v + '">' + t + '</button>';
    const actions = retour + (x.leadId ? '<a class="se-btn sm" href="#/client/srv-' + esc(x.leadId) + '">Voir dans mes prospects</a>' : '<button class="se-btn sm" data-act="radar-prospect" data-id="' + esc(x.id) + '">+ Ajouter aux prospects</button>');
    const kv = (k, v) => v ? '<div><span>' + k + '</span><b>' + v + '</b></div>' : '';
    const ou = esc(x.adresse) + (x.etage != null ? ' · ' + etageTxt(x.etage) : '') + (x.porte ? ' · porte ' + esc(x.porte) : '');
    // 1. Pourquoi c'est un futur vendeur
    const pourquoi = '<div class="se-card"><div class="rd-chances"><div class="rd-score ' + (ch.niveau === 'forte' ? 'fort' : ch.niveau === 'moyenne' ? 'moyen' : '') + '">' + ch.score + '</div><div><h3 style="margin:0">Chances de vendre : ' + (ch.niveau === 'forte' ? 'fortes' : ch.niveau === 'moyenne' ? 'moyennes' : 'faibles') + '</h3><p class="se-hint" style="margin:2px 0 0">Score sur 100, calculé à partir des signaux ci-dessous.</p></div></div>' +
      '<ul class="rd-signaux">' + ch.signaux.map((sg) => '<li class="' + (sg.pts > 0 ? 'plus' : sg.pts < 0 ? 'moins' : 'info') + '"><span>' + (sg.pts > 0 ? '+' + sg.pts : sg.pts < 0 ? sg.pts : 'ℹ') + '</span>' + esc(sg.txt) + '</li>').join('') + '</ul></div>';
    // 2. Contacter
    const c = p.contacts || {};
    const lettre = rdLettre(F);
    let contact;
    if (p.statut === 'identifie') {
      const dirs = (p.dirigeants || []).filter((d) => d.nom || d.societe);
      contact = '<div class="rd-proprio" style="margin:8px 0 12px">' + rdProprio(p, true) + '</div><ul class="rd-ul rd-contacts">' +
        dirs.map((d) => d.societe ? '<li><span class="se-hint">Dirigeant (société)</span> <b>' + esc(d.societe) + '</b></li>' : (function () {
          const nomD = ((d.prenoms || d.prenom || '') + ' ' + String(d.nom || '').toUpperCase()).trim();
          const li = (c.linkedin || []).find((l) => radarNormC(l.nom).indexOf(radarNormC(d.nom)) > -1);
          return '<li><span class="se-hint">' + esc(d.qualite || 'Dirigeant') + '</span> <b>' + esc(nomD) + '</b>' + (d.age ? ', ' + d.age + ' ans' : '') + ' · ' + (li ? '<a href="' + esc(li.url) + '" target="_blank" rel="noopener">LinkedIn ✓</a>' : '<a href="https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(nomD) + '" target="_blank" rel="noopener">chercher sur LinkedIn</a>') + '</li>';
        })()).join('') +
        (c.telephones || []).map((t) => '<li><span class="se-hint">Téléphone</span> <a href="tel:' + esc(t) + '"><b>' + esc(rdTel(t)) + '</b></a></li>').join('') +
        (c.emails || []).map((m) => '<li><span class="se-hint">Email</span> <a href="mailto:' + esc(m) + '"><b>' + esc(m) + '</b></a></li>').join('') +
        (c.site ? '<li><span class="se-hint">Site</span> <a href="' + esc(c.site.url) + '" target="_blank" rel="noopener">' + esc(c.site.titre || c.site.url) + '</a></li>' : '') +
        (p.societe && p.societe.siege ? '<li><span class="se-hint">Courrier au siège</span> ' + esc(p.societe.siege) + '</li>' : '') +
        '<li><span class="se-hint">Fiches officielles</span> <a href="https://annuaire-entreprises.data.gouv.fr/entreprise/' + esc(p.siren) + '" target="_blank" rel="noopener">Annuaire</a> · <a href="https://www.pappers.fr/entreprise/' + esc(p.siren) + '" target="_blank" rel="noopener">Pappers</a> · <a href="https://www.societe.com/cgi-bin/search?champs=' + esc(p.siren) + '" target="_blank" rel="noopener">Societe.com</a></li></ul>' +
        (!(c.telephones || []).length && !(c.emails || []).length ? '<p class="se-hint">' + (F.enrichi ? (c.linkedin ? 'Pas de téléphone ni d’email publiés par la société : passez par LinkedIn ou le courrier.' : 'Téléphones, emails et LinkedIn trouvés automatiquement avec la clé Exa (voir « Comment ça marche ? »).') : '') + '</p>' : '') +
        (c.sourcePro ? '<p class="se-hint">Coordonnées du gérant trouvées via ' + esc(c.sourcePro) + '.</p>' : '') +
        rdBlocCoordonnees(F, p) +

        (F.kaspr && (c.linkedin || [])[0] ? '<button class="se-btn ghost sm" data-act="radar-kaspr" data-id="' + esc(x.id) + '" data-url="' + esc(c.linkedin[0].url) + '">Téléphone et email du gérant via Kaspr (profil LinkedIn ci-dessus)</button>' : '') +
        ((p.autresMandats || []).length ? '<div style="margin-top:12px"><span class="se-kicker">AUTRES SOCIÉTÉS DU GÉRANT · ' + p.autresMandats.length + '</span><ul class="rd-ul">' + p.autresMandats.slice(0, 10).map((m) => '<li><a href="https://annuaire-entreprises.data.gouv.fr/entreprise/' + esc(m.siren) + '" target="_blank" rel="noopener">' + esc(m.entreprise) + '</a> <span class="se-hint">' + esc([m.role, m.ville].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul></div>' : (F.enrichi && p.dirigeant ? '<p class="se-hint">Aucun autre mandat trouvé pour ce gérant.</p>' : ''));
    } else {
      contact = '<div class="rd-proprio" style="margin:8px 0 12px">' + rdProprio(p, true) + '</div>' +
        '<p>Aucune société ne possède ce logement : c’est très probablement un particulier, dont le nom n’est dans aucun fichier public. Le moyen le plus efficace : une lettre adressée « au propriétaire » à ' + ou + ', ou un passage dans l’immeuble.</p>' +
        ((p.domiciliees || []).length ? '<div style="margin-top:10px"><span class="se-kicker">SOCIÉTÉS DOMICILIÉES À L’ADRESSE (SIRENE)</span><ul class="rd-ul">' + p.domiciliees.map((d) => '<li><a href="https://annuaire-entreprises.data.gouv.fr/entreprise/' + esc(d.siren) + '" target="_blank" rel="noopener">' + esc(d.nom) + '</a> <span class="se-hint">' + esc([d.type === 'sci' ? 'SCI' : 'société', d.etage, d.porte, d.complement].filter(Boolean).join(' · ')) + (d.dirigeants && d.dirigeants[0] ? ' · ' + esc(d.dirigeants[0].nom) : '') + '</span></li>').join('') + '</ul><p class="se-hint">Une SCI domiciliée au même étage est souvent la propriétaire.</p></div>' : '') +
        ((p.societes || []).length ? '<p class="se-hint">Sociétés propriétaires d’autres lots de l’immeuble : ' + p.societes.map((s2) => esc(s2.nom) + ' (' + s2.nbLots + ')').join(', ') + ' — le syndic ou ces sociétés peuvent aussi vous orienter.</p>' : '');
    }
    const contacter = '<div class="se-card"><h3>Contacter le propriétaire</h3>' + contact +
      '<details class="rd-lettre"><summary>Lettre au propriétaire, prête à envoyer</summary><pre>' + esc(lettre.dest) + '\n\n' + esc(lettre.corps) + '</pre><div class="se-actions"><button class="se-btn ghost sm" data-act="copier-contact" data-value="' + esc(lettre.corps) + '">Copier le texte</button><button class="se-btn ghost sm" data-act="radar-imprimer" data-id="' + esc(x.id) + '">Imprimer</button></div></details></div>';
    // 3. Clients intéressés
    const A = F.acquereurs || { club: [], leads: [] };
    const listeAcq = (l, vide) => l.length ? '<div class="se-list">' + l.map((cl) => '<a class="se-list-item" href="#/client/srv-' + esc(cl.id) + '" style="text-decoration:none;color:inherit;flex-wrap:wrap;gap:6px"><div style="flex:1;min-width:160px"><b>' + esc(cl.nom || 'Client') + '</b>' + (cl.aReconfirmer ? ' <span class="rd-pastille orange">à reconfirmer</span>' : '') + '<div class="rd-criteres">' + cl.criteres.map((k) => '<span class="' + (k.ok ? 'ok' : 'ko') + '">' + (k.ok ? '✓' : '!') + ' ' + esc(k.c) + ' : ' + esc(k.d) + '</span>').join('') + '</div></div></a>').join('') + '</div>' : '<p class="se-hint">' + vide + '</p>';
    const clients = '<div class="se-card"><h3>Clients intéressés · ' + (A.club.length + A.leads.length) + '</h3><div class="rd-acq-cols" style="margin-top:10px"><div><span class="se-kicker">CLUB · ' + A.club.length + '</span>' + listeAcq(A.club, 'Aucun membre du club.') + '</div><div><span class="se-kicker">LEADS · ' + A.leads.length + '</span>' + listeAcq(A.leads, 'Aucun lead du CRM.') + '</div></div></div>';
    // 4. Le bien
    const carteMaps = x.lat ? 'https://www.google.com/maps?q=' + x.lat + ',' + x.lon : 'https://www.google.com/maps/search/' + encodeURIComponent(x.adresse);
    const ventes = x.ventes ? ((x.ventes.ventes || []).length ? '<ul class="rd-ul">' + x.ventes.ventes.slice(0, 8).map((v) => '<li>' + esc(v.date ? new Date(v.date).toLocaleDateString('fr-FR') : '') + ' · ' + euro(v.valeur) + (v.surface ? ' · ' + num(v.surface) + ' m²' : '') + ((x.ventes.memeLogement || []).some((m) => m.date === v.date && m.valeur === v.valeur) ? ' <span class="rd-pastille vert">même surface</span>' : '') + '</li>').join('') + '</ul>' : '<p class="se-hint">Aucune vente enregistrée à cette adresse depuis 2014.</p>') : '<p class="se-hint">' + (F.enrichi ? 'Position GPS inconnue.' : 'Recherche…') + '</p>';
    const bien = '<div class="se-card"><h3>Le bien</h3><div class="se-kv" style="margin-top:12px">' +
      kv('Adresse', esc(x.adresse) + ' · <a href="' + carteMaps + '" target="_blank" rel="noopener">carte</a>') + kv('Étage', esc(etageTxt(x.etage)) + (x.niveauxImmeuble ? ' (immeuble de ' + x.niveauxImmeuble + ' niveaux)' : '')) +
      kv('Porte / bâtiment', esc([x.porte && 'porte ' + x.porte, x.batiment && 'bât. ' + x.batiment, x.escalier && 'esc. ' + x.escalier].filter(Boolean).join(' · '))) + kv('Surface', num(x.surface) + ' m²') +
      kv('DPE', esc(x.dpe || '?') + ' · fait le ' + rdDate(x.dpeDate) + ' (n° ' + esc(x.numeroDpe || '') + ')') + kv('Construction', esc(x.annee || x.periode || '')) +
      kv('Prix estimé', x.prixBas ? mEuro(x.prixBas) + ' – ' + mEuro(x.prixHaut) + ' <span class="se-hint">(' + num(x.prixM2) + ' €/m² médian du quartier, ± 7 %)</span>' : '') + '</div>' +
      (x.lat ? '<div id="radar-fiche-carte" class="rd-mini-carte" data-lat="' + x.lat + '" data-lon="' + x.lon + '"></div>' : '') +
      (x.parcelle ? '<div style="margin-top:12px"><span class="se-kicker">PARCELLE CADASTRALE</span><p style="margin:4px 0">Section ' + esc(x.parcelle.section) + ' n° ' + esc(String(x.parcelle.numero).replace(/^0+/, '')) + (x.parcelle.contenance ? ' · ' + num(x.parcelle.contenance) + ' m² de terrain' : '') + ' <span class="se-hint">(' + esc(x.parcelle.idu) + ')</span></p>' +
        ((x.parcelle.ventes || []).length ? '<span class="se-kicker">VENTES DE LA PARCELLE (TOUT L’IMMEUBLE)</span><ul class="rd-ul">' + x.parcelle.ventes.slice(0, 12).map((v) => '<li>' + esc(v.date ? new Date(v.date).toLocaleDateString('fr-FR') : '') + ' · ' + euro(v.valeur) + (v.surface ? ' · ' + num(v.surface) + ' m²' : '') + (v.typeLocal ? ' · ' + esc(v.typeLocal) : '') + '</li>').join('') + '</ul>' : '') + '</div>' : '') +
      '<div style="margin-top:12px"><span class="se-kicker">VENTES AUTOUR DE L’ADRESSE</span>' + ventes + '</div>' +
      (x.permis ? '<div style="margin-top:12px"><span class="se-kicker">PERMIS DE CONSTRUIRE / TRAVAUX</span>' + (x.permis.length ? '<ul class="rd-ul">' + x.permis.map((pm) => { const k = Object.keys(pm); const dt = k.filter((z) => /date/i.test(z)).map((z) => pm[z]).sort().reverse()[0]; const ty = k.filter((z) => /type|nature|kind/i.test(z)).map((z) => pm[z])[0]; const de = k.filter((z) => /description|nb_|logement|housing|surface/i.test(z)).map((z) => z.replace(/_/g, ' ') + ' : ' + pm[z]).slice(0, 2).join(' · '); return '<li>' + esc(dt ? new Date(dt).toLocaleDateString('fr-FR') : '') + (ty ? ' · ' + esc(ty) : '') + (pm.applicant_name || pm.applicant ? ' · ' + esc(pm.applicant_name || pm.applicant) : '') + (de ? '<div class="se-hint">' + esc(de) + '</div>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="se-hint">Aucun permis ni déclaration de travaux à cette adresse.</p>') + '</div>' : '') +
      ((F.memeImmeuble || []).length ? '<div style="margin-top:12px"><span class="se-kicker">AUTRES DPE DANS L’IMMEUBLE</span><ul class="rd-ul">' + F.memeImmeuble.map((m) => '<li><a href="#/radar-fiche/' + encodeURIComponent(m.id) + '">' + esc(etageTxt(m.etage) || 'étage ?') + ', ' + m.surface + ' m², DPE ' + esc(m.dpe || '?') + ' du ' + rdDate(m.dpeDate) + '</a></li>').join('') + '</ul></div>' : '') + '</div>';
    // 5. La société
    const societe = p.statut === 'identifie' ? '<div class="se-card"><h3>La société</h3><div class="se-kv" style="margin-top:12px">' + kv('SIREN', esc(p.siren)) + kv('Forme', esc(p.forme || '')) + kv('Créée le', p.societe && p.societe.creation ? esc(new Date(p.societe.creation).toLocaleDateString('fr-FR')) : '') + kv('Dans l’immeuble', num(p.lotsSociete) + ' lot' + (p.lotsSociete > 1 ? 's' : '') + ' sur ' + num(p.lotsImmeuble) + ' détenus par des sociétés') + '</div>' +
      '<div style="margin-top:12px"><span class="se-kicker">ANNONCES LÉGALES (BODACC)</span>' + (p.bodacc ? (p.bodacc.length ? '<ul class="rd-ul">' + p.bodacc.slice(0, 8).map((a) => '<li><b>' + esc(a.date ? new Date(a.date).toLocaleDateString('fr-FR') : '') + '</b> · ' + esc(a.famille || a.type) + (a.detail ? '<div class="se-hint">' + esc(a.detail.slice(0, 180)) + '</div>' : '') + '</li>').join('') + '</ul>' : '<p class="se-hint">Aucune annonce publiée.</p>') : '<p class="se-hint">Recherche…</p>') + '</div>' +
      ((F.biensSociete || []).length ? '<div style="margin-top:12px"><span class="se-kicker">SES BIENS À PARIS · ' + F.biensSociete.length + '</span><ul class="rd-ul">' + F.biensSociete.slice(0, 12).map((b) => '<li>' + esc(b.adresse) + ' <span class="se-hint">· ' + esc(qLib('p' + Number(String(b.insee).slice(3)))) + ' · ' + b.lots + ' lot' + (b.lots > 1 ? 's' : '') + (b.niveaux.length ? ' (' + esc(b.niveaux.slice(0, 4).join(', ')) + ')' : '') + '</span></li>').join('') + '</ul></div>' : '') + '</div>' : '';
    // 5 bis. L'immeuble, étage par étage (fichier DGFiP : lots détenus par des sociétés)
    const lots = F.lotsImmeuble || [];
    const immeuble = lots.length ? '<div class="se-card"><h3>L’immeuble, étage par étage</h3><p class="se-hint" style="margin:4px 0 10px">Lots détenus par des sociétés (les lots des particuliers n’apparaissent pas).</p><div class="rd-lots"><table><thead><tr><th>Étage</th><th>Porte</th><th>Propriétaire</th><th>Droit</th></tr></thead><tbody>' +
      lots.map((l) => '<tr' + (p.siren && l.siren === p.siren ? ' class="moi"' : '') + '><td>' + esc(l.niveau || '?') + (l.batiment ? ' · bât. ' + esc(l.batiment) : '') + '</td><td>' + esc(l.porte || '') + '</td><td>' + (l.siren ? '<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/' + esc(l.siren) + '" target="_blank" rel="noopener">' + esc(l.nom) + '</a>' : esc(l.nom)) + '</td><td>' + esc(l.droit || '') + '</td></tr>').join('') + '</tbody></table></div></div>' : '';
    // 6. Suivi
    const suivi = '<div class="se-card"><h3>Suivi</h3><div class="se-actions" style="margin-top:10px;flex-wrap:wrap">' + bouton('a_revoir', 'À revoir') + bouton('en_cours', 'En cours') + bouton('contacte', 'Contacté') + bouton('ecarte', 'Écarter') + '</div>' +
      '<form data-form="radar-note" data-id="' + esc(x.id) + '" class="se-form-grid" style="margin-top:12px"><div class="se-field"><label>Rappel le</label><input class="se-input" type="date" name="rappel" value="' + esc(x.rappel || '') + '"/></div>' +
      '<div class="se-field full"><label>Note</label><textarea class="se-textarea" name="note" placeholder="Appel, lettre envoyée, réponse…"></textarea></div><div class="se-field full" style="display:flex;flex-direction:row"><button class="se-btn soft" type="submit">Enregistrer</button></div></form>' +
      ((x.historique || []).length ? '<ul class="rd-ul" style="margin-top:12px">' + x.historique.slice().reverse().map((h) => '<li><span class="se-hint">' + dFR(h.at) + (h.par ? ' · ' + esc(h.par) : '') + '</span> — ' + (h.action === 'statut' ? 'statut : ' + esc({ a_revoir: 'à revoir', en_cours: 'en cours', contacte: 'contacté', ecarte: 'écarté' }[h.valeur] || h.valeur) : esc(h.valeur)) + '</li>').join('') + '</ul>' : '') + '</div>';
    return head('Radar · DPE du ' + rdDate(x.dpeDate), esc(x.type) + ' · ' + num(x.surface) + ' m² · ' + esc(qLib(x.quartier)), '📍 ' + ou + (x.prixBas ? ' · ' + mEuro(x.prixBas) + ' – ' + mEuro(x.prixHaut) : ''), actions) +
      enCours + '<div class="se-split"><div class="se-grid" style="gap:18px">' + pourquoi + contacter + clients + '</div><div class="se-grid" style="gap:18px">' + suivi + bien + societe + immeuble + '</div></div>';
  }
  const radarNormC = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function viewClients() {
    const q = (state.filtres.q || '').toLowerCase();
    const type = state.filtres.typeClient || '';
    const leadType = state.filtres.leadType || 'plateforme';
    const isPlateforme = (c) => !!c.serverId;
    const list = state.clients.filter((c) => {
      if (leadType === 'plateforme' && !isPlateforme(c)) return false;
      if (leadType === 'manuel' && isPlateforme(c)) return false;
      if (type && c.type !== type) return false;
      if (q && (nomClient(c) + ' ' + c.email + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const count = (lt) => state.clients.filter((c) => lt === 'plateforme' ? isPlateforme(c) : !isPlateforme(c)).length;
    const nbProspecter = aProspecter().filter((c) => ['converti', 'ecarte', 'hors_cible'].indexOf(c.pipeline || 'a_contacter') === -1).length;
    const ongletsLeads = '<div class="se-tabs" style="margin-bottom:18px">' +
        '<a href="#" data-act="filtre" data-id="leadType:plateforme" class="' + (leadType === 'plateforme' ? 'active' : '') + '">Leads Plateforme<span>' + count('plateforme') + '</span></a>' +
        '<a href="#" data-act="filtre" data-id="leadType:manuel" class="' + (leadType === 'manuel' ? 'active' : '') + '">Leads Manuels<span>' + count('manuel') + '</span></a>' +
        '<a href="#" data-act="filtre" data-id="leadType:prospecter" class="' + (leadType === 'prospecter' ? 'active' : '') + '">À prospecter<span>' + nbProspecter + '</span></a>' +
        '<a href="#" data-act="filtre" data-id="leadType:archives" class="' + (leadType === 'archives' ? 'active' : '') + '">Archivés<span>' + archivees('clients').length + '</span></a>' +
      '</div>';
    if (leadType === 'archives') {
      return head('Prospection', 'Leads archivés', 'Rien n’est supprimé : chaque lead garde son historique et peut être restauré.', '') + ongletsLeads + viewArchives('lead');
    }
    if (leadType === 'prospecter') {
      return head('Prospection', 'Leads', 'Propriétaires à démarcher, étape par étape.',
        '<a class="se-btn ghost sm" href="#/import">Importer un fichier</a><a class="se-btn ghost sm" href="#/pipeline">Vue pipeline</a><button class="se-btn ghost sm" data-act="client-nouveau">' + ICONS.plus + ' Nouveau lead</button>') +
        ongletsLeads + viewReseau(true);
    }

    return head('Prospection', 'Leads',
      list.length + ' lead(s) · ' + count('plateforme') + ' plateforme · ' + count('manuel') + ' manuel(s).',
      '<a class="se-btn ghost sm" href="#/import">Importer un fichier</a><a class="se-btn ghost sm" href="#/pipeline">Pipeline de relance</a><button class="se-btn ghost sm" data-act="client-nouveau">' + ICONS.plus + ' Nouveau lead</button>') +
      ongletsLeads +
      '<div class="se-card pad-sm" style="margin-bottom:18px"><div class="se-filters">' +
        '<select class="se-select" data-filter="typeClient"><option value="">Tous</option>' +
          '<option value="acquereur"' + (type === 'acquereur' ? ' selected' : '') + '>Acquéreurs</option>' +
          '<option value="vendeur"' + (type === 'vendeur' ? ' selected' : '') + '>Vendeurs</option>' +
          '<option value="mixte"' + (type === 'mixte' ? ' selected' : '') + '>Acheteurs-vendeurs</option>' +
        '</select>' +
        '<span class="se-hint">' + list.length + ' résultat(s)</span>' +
      '</div></div>' +
      '<div class="se-card" style="padding:8px 16px">' +
        '<div class="se-table-wrap"><table class="se-table"><thead><tr><th>Client</th><th>Type</th><th>Budget / critères</th><th>Statut</th><th>Température</th><th>Agent</th><th></th></tr></thead><tbody>' +
        list.map((c) => '<tr>' +
          '<td><a href="#/client/' + c.id + '" style="color:inherit;text-decoration:none"><b style="font-weight:500">' + esc(nomClient(c)) + '</b> ' + badgeDemo(c) + '<div class="se-hint">' + esc(c.email) + '</div></a></td>' +
          '<td>' + (c.type === 'acquereur' ? 'Acquéreur' : c.type === 'vendeur' ? 'Vendeur' : 'Les deux') + '</td>' +
          '<td>' + (() => {
            if (c.type === 'vendeur') return '<span class="se-hint">propriétaire</span>';
            const recs = ((state.recherchesServeur || []).concat(state.recherches)).filter((x) => x.clientId === c.id);
            if (!recs.length) return '<span class="se-hint">Aucune recherche</span>';
            const r0 = recs[0];
            return (r0.prixMax ? '≤ ' + euro(r0.prixMax) : '—') + '<div class="se-hint">' + (r0.piecesMin ? r0.piecesMin + '+ pièces · ' : '') + (r0.quartiers || []).map(qLabel).join(', ') + (recs.length > 1 ? ' · +' + (recs.length - 1) + ' autre(s)' : '') + '</div>';
          })() + '</td>' +
          '<td>' + badgeClient(c.statut) + '</td>' +
          '<td>' + (badgeTemperature(c) || '<span class="se-hint">—</span>') + '</td>' +
          '<td class="se-hint">' + esc(c.agent || '') + '</td>' +
          '<td><a class="se-btn ghost sm" href="#/client/' + c.id + '">Ouvrir</a></td>' +
        '</tr>').join('') +
        '</tbody></table></div>' +
      '</div>';
  }

  function carteOpportunitesRadar(c) {
    if (!c || c.type === 'vendeur') return '';
    const ms = matchings().filter((m) => m.clientId === c.id).sort((a, b) => b.score - a.score);
    return '<div class="se-card"><h3>Opportunités Radar</h3>' +
      (ms.length
        ? '<div class="se-list" style="margin-top:8px">' + ms.slice(0, 8).map((m) => {
            const rb = robotBien(m.bienId);
            const prio = niveauPriorite(m.score);
            return '<a class="se-rowlink" href="#/robot-opportunites">' +
              '<div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc((rb && rb.adresse) || 'Bien') + '</div>' +
              '<div class="se-sub">' + (rb ? esc(rb.type || '') + ' · ' + (rb.surface_habitable_m2 != null ? rb.surface_habitable_m2 + ' m²' : (rb.contenance_cadastrale_m2 != null ? rb.contenance_cadastrale_m2 + ' m² parcelle' : '—')) : '') + ' · ' + (ST_MATCHING[m.statut] || m.statut) + '</div></div>' +
              '<span class="se-badge ' + prio.cls + '">' + m.score + '%</span></a>';
          }).join('') + '</div>'
        : '<p class="se-muted" style="margin-top:8px">Aucune opportunité Radar pour ce client. Le Robot croise automatiquement les biens détectés et ses recherches.</p>') +
      '</div>';
  }

  function viewClient(r) {
    const c = client(r.param);
    if (!c) return '<div class="se-card se-empty"><div class="se-empty-title">Client introuvable</div><a class="se-btn" href="#/clients">Retour</a></div>';

    const recherches = ((state.recherchesServeur || []).concat(state.recherches)).filter((x) => x.clientId === c.id);
    const compat = c.type !== 'vendeur' ? biensCompatibles(c, 30) : [];
    const demandes = state.demandes.filter((d) => d.clientId === c.id);
    const visites = state.visites.filter((v) => v.clientId === c.id);
    const offres = state.offres.filter((o) => o.clientId === c.id);
    const biensPossedes = ((state.biensServeur || []).concat(state.biens)).filter((b) => b.proprietaireId === c.id || b.leadId === c.serverId);
    const activites = (state.activites || []).filter((a) => a.leadId === c.serverId).slice().sort((a, b) => new Date(b.at) - new Date(a.at));

    return bandeauArchive('lead', c) + '<div class="se-fiche-head">' +
        '<span class="se-avatar">' + esc((c.prenom.charAt(0) + c.nom.charAt(0)).toUpperCase()) + '</span>' +
        '<div style="flex:1"><div class="kicker" style="color:var(--color-taupe)">' + (c.type === 'acquereur' ? 'Acquéreur' : c.type === 'vendeur' ? 'Vendeur' : 'Acquéreur & vendeur') + ' · ' + esc(c.source) + '</div>' +
        '<h1 class="display" style="font-size:30px;margin:4px 0 2px">' + esc(nomClient(c)) + '</h1>' +
        '<div class="se-row" style="gap:8px">' + badgeClient(c.statut) + badgeTemperature(c) + badgeDemo(c) + (c.tags || []).map((t) => '<span class="se-pill">' + esc(t) + '</span>').join('') + '</div></div>' +
        '<div class="se-actions">' +
          ((estCandidatOuMembre(c) && biensPossedes.some((x) => x.validation === 'en_attente')) ? '<button class="se-btn soft" data-act="bien-valider" data-id="' + biensPossedes.find((x) => x.validation === 'en_attente').id + '">Valider ce bien</button>' : '') +
          (biensPossedes.length ? '<a class="se-btn ghost" href="#/bien/' + biensPossedes[0].id + '">Voir son Bien</a>' : '') +
          (recherches.length ? '<a class="se-btn ghost" href="#/recherche/' + recherches[0].id + '">Voir sa Recherche</a>' : '') +
          '<button class="se-btn ghost" data-act="historique" data-kind="lead" data-id="' + c.id + '">Historique</button>' +
          '<button class="se-btn ghost" data-act="client-editer" data-id="' + c.id + '">Modifier</button>' +
          '<button class="se-btn ghost" data-act="recherche-nouvelle" data-id="' + c.id + '">Nouvelle recherche</button>' +
          '<button class="se-btn" data-act="visite-nouvelle" data-id="' + c.id + '">Planifier une visite</button>' +
        '</div>' +
      '</div>' +

      '<div class="se-split">' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card"><h3>Identité</h3><div class="se-kv" style="margin-top:12px">' +
            kv('Email', esc(c.email)) + kv('Téléphone', esc(c.tel) + (c.telAVerifier ? ' <span class="se-badge muted" title="Numéro mal formé dans le fichier d’origine">à vérifier</span>' : '')) +
            ((c.autresTelephones || []).length ? kv('Autres téléphones', (c.autresTelephones || []).map(esc).join('<br>')) : '') +
            ((c.autresEmails || []).length ? kv('Autres emails', (c.autresEmails || []).map(esc).join('<br>')) : '') +
            kv('Civilité', c.civilite === 'homme' ? 'Homme' : c.civilite === 'femme' ? 'Femme' : '—') +
            kv('Adresse', esc(c.adresse || '—')) +
            kv('Le lead est', c.natureLead === 'sci' ? 'Une SCI' : c.natureLead === 'societe' ? 'Une société' : 'Une personne') +
            (estSocieteLead(c) ? (
              kv('Raison sociale', esc(c.raisonSociale || '—')) + kv('SIREN', c.siren ? '<a href="https://annuaire-entreprises.data.gouv.fr/entreprise/' + esc(c.siren) + '" target="_blank" rel="noopener">' + esc(c.siren) + '</a>' : '—') + kv('Représentée par', esc([nomClient(c), c.representant ? '(' + c.representant + ')' : ''].filter(Boolean).join(' ') || '—'))
            ) : '') +
            kv('Financement', esc(c.financement || '—')) + kv('Apport', c.apport ? euro(c.apport) : '—') + kv('Courtier', c.courtier ? 'Oui' : 'Non') +
            kv('Source', esc(c.source)) + kv('Agent', esc(c.agent || '—')) +
            kv('Créé le', dFR(c.cree)) +
          '</div>' + (c.notes ? '<div class="se-note" style="margin-top:14px">' + esc(c.notes) + '</div>' : '') +
          (state.moi && state.moi.role === 'superadmin' && c.serverId ? (
            '<div class="se-field" style="margin-top:12px"><label>Agent attribué</label>' +
            '<select class="se-select" data-act="client-reattribuer" data-id="' + esc(c.serverId) + '">' +
              '<option value="">Non attribué (visible par vous seul)</option>' +
              (state.agents || []).filter((a) => a.role !== 'superadmin').map((a) => '<option value="' + esc(a.id) + '"' + (c.agentId === a.id ? ' selected' : '') + '>' + esc((a.prenom + ' ' + a.nom).trim() || a.email) + '</option>').join('') +
            '</select></div>'
          ) : '') + '</div>' +

          carteOpportunitesRadar(c) +

          (recherches.length ? '<div class="se-card"><h3>Recherches</h3><div class="se-list" style="margin-top:8px">' + recherches.map((x) => {
            const n = biensCompatibles(x, 50).length;
            return '<a class="se-rowlink" href="#/recherche/' + x.id + '"><div style="flex:1"><div style="font-size:14px">' + esc(x.titre) + '</div>' +
              '<div class="se-sub">≤ ' + euro(x.prixMax) + ' · ' + x.piecesMin + '+ pièces · ' + (x.quartiers || []).map(qLabel).join(', ') + '</div></div>' +
              '<span class="se-badge ' + (n ? 'open' : 'muted') + '">' + n + ' bien(s)</span></a>';
          }).join('') + '</div></div>' : '') +

          (c.type !== 'vendeur' ? '<div class="se-card"><h3>Biens compatibles</h3>' +
            (compat.length ? '<div class="se-list" style="margin-top:8px">' + compat.slice(0, 5).map((x) => '<a class="se-rowlink" href="#/bien/' + x.bien.id + '">' +
              '<img class="se-thumb" src="' + photo(x.bien) + '" alt="" style="width:40px;height:40px;flex:0 0 40px"/>' +
              '<div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(x.bien.titre) + '</div><div class="se-sub">' + esc(x.bien.ref) + ' · ' + euro(x.bien.prix) + '</div></div>' +
              scoreTag(x.score) + '</a>').join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucun bien ne correspond pour l’instant.</p>') +
            '</div>' : '') +
        '</div>' +

        '<div class="se-grid" style="gap:18px">' +
          (biensPossedes.length ? '<div class="se-card"><h3>Biens au portefeuille</h3><div class="se-list" style="margin-top:8px">' + biensPossedes.map((b) => '<a class="se-rowlink" href="#/bien/' + b.id + '"><div style="flex:1"><div style="font-size:13.5px">' + esc(b.titre) + '</div><div class="se-sub">' + esc(b.ref) + ' · ' + euro(b.prix) + '</div></div>' + badgeBien(b.statut) + '</a>').join('') + '</div></div>' : '') +
          '<div class="se-card"><h3>Activité</h3><div class="se-timeline" style="margin-top:12px">' +
            (activites.length ? activites.map((a) => '<div class="se-timeline-item">' + esc((ACTIVITE[a.type] || { label: a.type }).label) + '<span>' + ilYa(a.at) + (a.auteur ? ' · ' + esc(a.auteur) : '') + '</span></div>').join('') : '') +
            (visites.length ? visites.map((v) => '<div class="se-timeline-item">Visite ' + esc(bien(v.bienId) ? bien(v.bienId).titre : '') + '<span>' + dFR(v.date) + ' · ' + v.heure + ' · ' + statutVisite(v.statut) + '</span></div>').join('') : '') +
            (demandes.length ? demandes.map((d) => '<div class="se-timeline-item">' + esc((DEMANDE[d.type] || DEMANDE.info).label) + '<span>' + ilYa(d.cree) + '</span></div>').join('') : '') +
            (offres.length ? offres.map((o) => '<div class="se-timeline-item">Offre ' + euro(o.montant) + '<span>' + dFR(o.cree) + ' · ' + statutOffre(o.statut) + '</span></div>').join('') : '') +
            (!activites.length && !visites.length && !demandes.length && !offres.length ? '<p class="se-muted">Aucune activité.</p>' : '') +
          '</div></div>' +
          (c.serverId && !estCandidatOuMembre(c) ? '<div class="se-card"><h3>Lead ajouté par l’agence</h3><p class="se-hint" style="margin-top:8px">' + esc(c.source || 'Ajout manuel') + ' · aucune demande d’adhésion. Ce lead n’a pas accès à la plateforme et n’apparaît pas dans les candidatures.</p></div>' : '') +
          (c.serverId && estCandidatOuMembre(c) ? '<div class="se-card"><h3>Accès & documents du membre</h3>' +
            '<div class="se-row" style="justify-content:space-between;margin-top:10px"><span class="se-hint">Accès</span>' +
              (c.serveurStatut === 'accepte' ? '<span class="se-badge open">Validé</span>' : '<span class="se-badge warn">En attente</span>') + '</div>' +
            (c.serveurStatut !== 'accepte'
              ? '<button class="se-btn block" style="margin-top:10px" data-act="lead-valider" data-id="' + c.serverId + '">Valider l’accès</button>'
              : '') +
            (c.bienInfo ? '<div class="se-hint" style="margin-top:10px">' + esc(c.bienInfo.titre || 'Bien du membre') +
              (c.bienInfo.exterieur && c.bienInfo.exterieur !== 'Aucun' ? ' · ' + esc(c.bienInfo.exterieur) + (c.bienInfo.surfaceExterieur ? ' ' + c.bienInfo.surfaceExterieur + ' m²' : '') : '') +
              ' · ' + c.bienInfo.photos + ' photo(s)</div>' : '') +
            '<div class="se-list" style="margin-top:12px">' +
              ((state.docsParLead[c.serverId] || []).length
                ? (state.docsParLead[c.serverId] || []).map((d) => '<div class="se-list-item">' +
                    '<div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(libelleDoc(d.type)) + '</div>' +
                    '<div class="se-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.nom) + '</div></div>' +
                    (d.statut === 'valide' ? '<span class="se-badge open">Validé</span>'
                      : d.statut === 'refuse' ? '<span class="se-badge warn">Refusé</span>'
                      : '<button class="se-btn ghost sm" data-act="doc-valider" data-id="' + d.id + '">Valider la pièce</button>' +
                        '<button class="se-btn ghost sm" data-act="doc-refuser" data-id="' + d.id + '">Refuser</button>') +
                    '<a class="se-btn ghost sm" href="' + esc(d.fichier) + '" target="_blank" rel="noopener">Voir</a>' +
                  '</div>').join('')
                : '<p class="se-muted" style="margin:8px 0 0">Aucun document reçu pour l’instant.</p>') +
            '</div></div>' : '') +
          (function () {
            const k = canauxContact(c);
            const via = k.membre && k.email ? 'Reçu dans son espace membre et par email.' : k.membre ? 'Reçu dans son espace membre.' : 'Envoyé par email (' + esc(c.email) + ') : il n’a pas encore d’espace membre.';
            return '<div class="se-card"><h3>Contacter</h3>' +
              (k.message ? '<button class="se-btn ghost block" style="margin-top:10px" data-act="message-ouvrir" data-id="' + c.id + '">Écrire un message</button><p class="se-hint" style="margin:6px 0 0">' + via + '</p>' : '') +
              (k.tel ? '<a class="se-btn soft block" style="margin-top:8px" href="tel:' + esc(c.tel) + '">Appeler ' + esc(c.tel) + '</a>' +
                '<a class="se-btn ghost block" style="margin-top:8px" href="sms:' + esc(c.tel) + '">Envoyer un SMS</a>' : '') +
              (!k.message && !k.tel ? blocSansContact(c) : '') +
              (!k.message && k.tel ? '<p class="se-hint" style="margin:8px 0 0">Pas d’email ni d’espace membre : pas de message possible depuis le CRM, seulement l’appel ou le SMS.</p>' : '') +
            '</div>';
          })() +
        '</div>' +
      '</div>';
  }

  function kv(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }

  /* ---------------------------------- biens ------------------------------- */

  function viewBiens() {
    const q = (state.filtres.q || '').toLowerCase();
    const st = state.filtres.statutBien || '';
    const mk = state.filtres.marcheBien || '';
    const src = state.filtres.sourceBien || '';
    const toutes = (state.biensServeur || []).concat(state.biens);
    const sources = Array.from(new Set(toutes.map((b) => b.source).filter(Boolean)));
    const list = toutes.filter((b) => {
      if (st && b.statut !== st) return false;
      if (src && b.source !== src) return false;
      if (mk) {
        const v = b.verifs || {};
        if (mk === 'non_verifie' && b.verifs) return false;
        if (mk === 'vendu' && !(v.dvf && v.dvf.statut === 'vendu_probable')) return false;
        if (mk === 'en_ligne' && !(v.enLigne && ['en_ligne', 'a_verifier'].indexOf(v.enLigne.statut) > -1)) return false;
        if (mk === 'libre' && !(v.enLigne && v.enLigne.statut === 'non_trouve' && v.dvf && v.dvf.statut !== 'vendu_probable')) return false;
        if (mk === 'retire_agence' && !(b.suiviAgence && b.suiviAgence.statut === 'retire')) return false;
        if (mk === 'baisse_agence' && !(b.suiviAgence && b.suiviAgence.derniereBaisse)) return false;
        if (mk === 'mandat_echu' && !(b.mandatOrigine && b.mandatOrigine.fin && b.mandatOrigine.fin < new Date().toISOString().slice(0, 10))) return false;
      }
      if (q && (b.titre + ' ' + b.ref + ' ' + (b.refAgence || '') + ' ' + (b.adresse || '') + ' ' + qLabel(b.quartier) + ' ' + (b.nomProprio || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const aVerifier = (state.biensServeur || []).filter((b) => b.importLot && !b.verifs).length;
    const vueBiens = state.filtres.vueBiens || '';
    const ongletsBiens = ongletsArchive('vueBiens', vueBiens, toutes.length, archivees('biens').length, 'Portefeuille');
    if (vueBiens === 'archives') {
      return head('Portefeuille', 'Biens archivés', 'Retirés du portefeuille, de la plateforme et du matching. Rien n’est supprimé.', '') + ongletsBiens + viewArchives('bien');
    }

    return head('Portefeuille', 'Biens',
      list.length + ' bien(s) · ' + euro(list.reduce((n, b) => n + b.prix, 0)) + ' de valeur de présentation.',
      '<button class="se-btn" data-act="bien-nouveau">' + ICONS.plus + ' Nouveau bien</button>') +
      ongletsBiens +
      carteImportFiches() +
      '<div class="se-card pad-sm" style="margin-bottom:18px"><div class="se-filters">' +
        '<select class="se-select" data-filter="statutBien"><option value="">Tous les statuts</option>' +
          Object.keys(ST_BIEN).map((k) => '<option value="' + k + '"' + (st === k ? ' selected' : '') + '>' + ST_BIEN[k].label + '</option>').join('') +
        '</select>' +
        (sources.length ? '<select class="se-select" data-filter="sourceBien"><option value="">Toutes les origines</option>' + sources.map((x) => '<option' + (src === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' : '') +
        '<select class="se-select" data-filter="marcheBien"><option value="">Marché : tout</option>' +
          [['retire_agence', 'Retiré du site de l’agence'], ['baisse_agence', 'Prix baissé par l’agence'], ['libre', 'Ni vendu ni en ligne'], ['en_ligne', 'Toujours en ligne'], ['vendu', 'Vendu (DVF)'], ['mandat_echu', 'Mandat d’origine échu'], ['non_verifie', 'Pas encore vérifié']].map((o) => '<option value="' + o[0] + '"' + (mk === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
        '</select><span class="se-hint">' + list.length + ' résultat(s)</span>' +
        (aVerifier ? '<button class="se-btn ghost sm" data-act="biens-verifier-tous"' + (state.verifLot ? ' disabled' : '') + '>' + (state.verifLot ? 'Vérification en cours…' + (state.verifEtat ? ' ' + state.verifEtat.faits + ' faits, ' + state.verifEtat.enAttente + ' restants' : '') : 'Vérifier vendu / en ligne (' + aVerifier + ')') + '</button>' : '') +
      '</div></div>' +
      '<div class="se-bien-grid">' + list.map(carteBien).join('') + '</div>';
  }

  function carteSurSeecret(b) {
    if (!b.serveur) return '';
    const visible = surPlateforme(b);
    const actif = b.surSeecret !== false;
    return '<div class="se-card"><div class="se-row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:nowrap">' +
        '<div style="min-width:0"><h3>Sur Seecret</h3><p class="se-hint" style="margin:4px 0 0">Publier ce bien sur la plateforme des membres.</p></div>' +
        '<button type="button" class="se-switch' + (actif ? ' on' : '') + '" role="switch" aria-checked="' + actif + '" aria-label="Sur Seecret" data-act="bien-sur-seecret" data-id="' + b.id + '"><span></span></button>' +
      '</div>' +
      (visible
        ? '<p class="se-hint" style="margin-top:10px;color:var(--color-ok)">Visible par les membres · <a href="#/biens-club">Voir dans Biens du club</a></p>'
        : '<p class="se-hint" style="margin-top:10px">' + esc(raisonHorsPlateforme(b)) + '</p>' +
          (actif && !(b.statut === 'avant-premiere' || b.statut === 'ouvert') && ['brouillon', 'a_valider', 'mandat'].indexOf(b.statut) > -1 ? '<button class="se-btn soft sm" style="margin-top:8px" data-act="bien-valider" data-id="' + b.id + '">Valider et mettre en Avant-première</button>' : '')) +
    '</div>';
  }
  function photosCrm(b) {
    const src = (p) => (/^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p);
    const photos = b.photos || [];
    if (!b.serveur) return '<div class="se-photos" style="padding:12px">' + photos.map((p) => '<div class="se-photo"><img src="' + src(p) + '" alt=""/></div>').join('') + '</div>';
    const envoi = state.photoEnvoi === b.id;
    // Glisser une photo (souris, ou appui long au doigt) pour la déplacer ;
    // la première est la photo principale (tri-photos.js).
    return '<div style="padding:12px"><div class="se-crm-photos" data-tri-photos="crm:' + esc(b.id) + '">' +
        photos.map((p, i) => '<div class="se-crm-photo' + (i === 0 ? ' principale' : '') + '" data-tri-index="' + i + '"><img src="' + esc(src(p)) + '" alt="" draggable="false"/>' +
          (i === 0 ? '<span class="se-crm-photo-tag">Principale</span>' : '') +
          '<div class="se-crm-photo-actions">' +
            '<button type="button" title="Retirer" data-tri-fixe data-act="bien-photo" data-op="retirer" data-i="' + i + '" data-id="' + b.id + '">×</button>' +
          '</div></div>').join('') +
        (photos.length < 12
          ? '<label class="se-crm-photo-add">' + (envoi ? 'Envoi…' : ICONS.plus + '<span>Ajouter</span>') + '<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-bien-photos="' + b.id + '"' + (envoi ? ' disabled' : '') + '/></label>'
          : '') +
      '</div><p class="se-hint" style="margin-top:8px">' + photos.length + ' / 12 photos · faites glisser une photo pour la déplacer (appui long sur téléphone) ; la première est la photo principale. Format horizontal conseillé. Le membre ne peut plus modifier ses photos une fois le bien validé : c’est ici que vous les gérez.</p></div>';
  }
  async function enregistrerBien(b, champs, okMsg) {
    try {
      const r = await fetch('/api/biens/' + encodeURIComponent(b.serverId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(champs) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'erreur');
      Object.assign(b, champs);
      render(); if (okMsg) toast(okMsg, 'ok');
      return true;
    } catch (e) { toast('Enregistrement impossible : ' + (e.message || 'erreur'), 'warn'); return false; }
  }

  const DETAILS_LIB = [
    ['prixAffiche', 'Prix affiché d’origine', 'euro'], ['honorairesAcheteur', 'Honoraires d’origine (acquéreur)', 'euro'],
    ['surfaceCarrez', 'Surface Carrez', 'm2'], ['surfaceTotale', 'Surface totale', 'm2'], ['niveaux', 'Niveaux'],
    ['etageTexte', 'Étage / étages de l’immeuble'], ['exposition', 'Exposition'], ['vue', 'Vue'], ['standing', 'Standing'], ['style', 'Style'],
    ['chauffage', 'Chauffage'], ['eauChaude', 'Eau chaude'], ['eauxUsees', 'Eaux usées'], ['anneeRenovation', 'Année de rénovation'],
    ['dpeKwh', 'Consommation énergie', 'kwh'], ['gesKg', 'Émissions GES', 'kg'], ['taxeFonciere', 'Taxe foncière', 'euro'],
    ['lotsCopropriete', 'Lots de copropriété'], ['residence', 'Copropriété / résidence'], ['quartierOrigine', 'Quartier (fichier)'], ['disponibilite', 'Disponibilité']
  ];
  function carteDetailsOrigine(b) {
    const d = b.details;
    if (!d && !b.refAgence) return '';
    const fmt = (v, f) => f === 'euro' ? euro(v) : f === 'm2' ? num(v) + ' m²' : f === 'kwh' ? esc(String(v)) + ' kWh/m²/an' : f === 'kg' ? esc(String(v)) + ' kg CO₂/m²/an' : esc(String(v));
    const lignes = DETAILS_LIB.filter((x) => d && d[x[0]] !== undefined && d[x[0]] !== null && d[x[0]] !== '').map((x) => kv(x[1], fmt(d[x[0]], x[2]))).join('');
    const liste = (titre, arr) => arr && arr.length ? '<div class="se-hint" style="margin-top:14px;text-transform:uppercase;letter-spacing:.06em;font-size:11px">' + titre + '</div><div class="se-chips" style="margin-top:6px">' + arr.map((a) => '<span class="se-chip" style="cursor:default">' + esc(typeof a === 'object' ? a.piece + (a.surface ? ' · ' + num(a.surface) + ' m²' : '') : a) + '</span>').join('') + '</div>' : '';
    return '<div class="se-card"><h3>Informations du fichier d’origine</h3>' +
      '<p class="se-hint" style="margin:4px 0 0">' + esc(b.source || 'Import') + (b.refAgence ? ' · réf. ' + esc(b.refAgence) : '') + (b.sourceFichier ? ' · ' + esc(b.sourceFichier) : '') + '</p>' +
      (lignes ? '<div class="se-kv" style="margin-top:12px">' + lignes + '</div>' : '') +
      liste('Pièces', d && d.surfacesDetail) + liste('Prestations', d && d.prestations) + liste('À proximité', d && d.proximites) +
      (b.description ? '<details style="margin-top:14px"><summary class="se-hint" style="cursor:pointer">Descriptif d’origine</summary><p style="white-space:pre-line;font-size:13.5px;line-height:1.6;margin:8px 0 0">' + esc(b.description) + '</p></details>' : '') +
    '</div>';
  }
  const VERIF_DVF = { vendu_probable: ['Vendu (DVF)', 'alert'], pas_de_vente: ['Pas de vente DVF', 'muted'], sans_position: ['Adresse non localisée', 'muted'], erreur: ['DVF indisponible', 'muted'] };
  const VERIF_LIGNE = { en_ligne: ['En ligne', 'warn'], a_verifier: ['Annonce possible', 'muted'], non_trouve: ['Pas trouvé en ligne', 'ok'], indisponible: ['Recherche en ligne indisponible', 'muted'], quota: ['Crédits Exa épuisés', 'muted'], erreur: ['Recherche en ligne en erreur', 'muted'] };
  function badgeSuiviAgence(b) {
    const s = b.suiviAgence;
    if (!s) return '';
    if (s.statut === 'retire') return '<span class="se-badge alert" title="Annonce disparue du site de l’agence d’origine">Retiré du site agence</span>';
    if (s.derniereBaisse) return '<span class="se-badge warn">Prix baissé</span>';
    return '';
  }
  function badgesVerifs(b) {
    const v = b.verifs;
    if (!v) return badgeSuiviAgence(b);
    const bd = (m, k) => (m[k] ? '<span class="se-badge ' + m[k][1] + '">' + m[k][0] + '</span>' : '');
    return badgeSuiviAgence(b) + (v.dvf ? bd(VERIF_DVF, v.dvf.statut) : '') + (v.enLigne ? bd(VERIF_LIGNE, v.enLigne.statut) : '');
  }
  function carteSuiviAgence(b) {
    const s = b.suiviAgence;
    if (!s) return '';
    const agence = (b.mandatOrigine && b.mandatOrigine.agence) || 'l’agence d’origine';
    const prixFichier = Number(b.details && b.details.prixAffiche) || 0;
    const etat = s.statut === 'retire'
      ? '<div class="se-note" style="margin-top:10px;border-color:var(--color-alert)"><b>Annonce retirée du site ' + esc(agence) + '</b>' + (s.retireLe ? ' le ' + dFR(s.retireLe) : ' (avant le ' + dFR(s.retireAvant) + ')') + ' : vendu, sous compromis ou mandat terminé. Bon moment pour appeler le vendeur.</div>'
      : '<div class="se-note" style="margin-top:10px">Toujours en vente chez ' + esc(agence) + ' à <b>' + euro(s.prix) + '</b>' + (prixFichier && s.prix && s.prix !== prixFichier ? ' (fichier : ' + euro(prixFichier) + ')' : '') + '.</div>';
    const hist = (s.historique || []).slice().reverse().map((h) => '<div class="se-list-item"><div style="flex:1"><div style="font-size:13.5px">' + esc(h.evenement) + (h.ancien ? ' : ' + euro(h.ancien) + ' → ' + euro(h.nouveau) : '') + '</div><div class="se-hint">' + dFR(h.date) + '</div></div></div>').join('');
    return '<div class="se-card"><h3>Suivi de l’annonce d’origine</h3>' + etat +
      (hist ? '<div class="se-list" style="margin-top:8px">' + hist + '</div>' : '') +
      '<p class="se-hint" style="margin-top:8px">Vérifié chaque jour sur le site de l’agence · dernier passage le ' + dFR(s.verifieLe) + '.</p></div>';
  }
  function carteVerifsMarche(b) {
    if (!b.serveur) return '';
    const v = b.verifs;
    const enCours = state.verifEnCours && state.verifEnCours[b.serverId];
    const bouton = '<button class="se-btn ghost sm" data-act="bien-verifier" data-id="' + b.id + '"' + (enCours ? ' disabled' : '') + '>' + (enCours ? 'Vérification…' : v ? 'Relancer' : 'Vérifier') + '</button>';
    if (!v) return '<div class="se-card"><div class="se-row" style="justify-content:space-between;gap:10px"><h3>Vendu ? Toujours en ligne ?</h3>' + bouton + '</div><p class="se-hint" style="margin-top:6px">Cherche une vente dans les données DVF (ventes publiées par l’État) et une annonce sur les portails.</p></div>';
    const d = v.dvf || {}; const l = v.enLigne || {};
    const ventes = (d.ventes || []).map((x) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13.5px"><b>' + euro(x.prix) + '</b> · ' + num(x.surface) + ' m² · ' + esc(x.type) + '</div><div class="se-hint">' + dFR(x.date) + (x.apresMandat ? ' · après le début du mandat' : ' · avant le mandat') + '</div></div></div>').join('');
    const liens = (l.liens || []).map((x) => '<a class="se-list-item" href="' + esc(x.url) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(x.plateforme) + ' · ' + [x.surface ? 'surface' : '', x.lieu ? 'lieu' : '', x.prix ? 'prix' : ''].filter(Boolean).join(' + ') + ' identiques</div><div class="se-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.titre || x.url) + '</div></div><span>↗</span></a>').join('');
    return '<div class="se-card"><div class="se-row" style="justify-content:space-between;gap:10px"><h3>Vendu ? Toujours en ligne ?</h3>' + bouton + '</div>' +
      '<div class="se-row" style="gap:6px;margin-top:8px">' + badgesVerifs(b) + '</div>' +
      '<div class="se-hint" style="margin-top:12px;text-transform:uppercase;letter-spacing:.06em;font-size:11px">Ventes DVF à cette adresse (même type, surface proche)</div>' +
      (ventes ? '<div class="se-list" style="margin-top:6px">' + ventes + '</div>' : '<p class="se-hint" style="margin-top:6px">' + esc(d.raison || 'Aucune vente correspondante.') + '</p>') +
      (d.adresseBan ? '<p class="se-hint" style="margin-top:4px">Contrôlé sur la parcelle du ' + esc(d.adresseBan) + (d.parcelle ? ' (' + esc(d.parcelle.slice(-6)) + ')' : '') + '.</p>' : '') +
      (d.donneesJusquau ? '<p class="se-hint" style="margin-top:6px">Données DVF disponibles jusqu’au ' + dFR(d.donneesJusquau) + (d.couvreMandat === false && b.mandatOrigine && b.mandatOrigine.debut ? ' : la période du mandat n’est pas encore couverte (DVF paraît avec plusieurs mois de retard).' : '.') + '</p>' : '') +
      '<div class="se-hint" style="margin-top:14px;text-transform:uppercase;letter-spacing:.06em;font-size:11px">Annonces trouvées</div>' +
      (liens ? '<div class="se-list" style="margin-top:6px">' + liens + '</div>' : '<p class="se-hint" style="margin-top:6px">' + (l.statut === 'non_trouve' ? 'Aucune annonce correspondante trouvée sur les portails.' : esc(l.raison || 'Recherche non faite.')) + '</p>') +
      ((l.recherches || []).length ? '<details style="margin-top:10px"><summary class="se-hint" style="cursor:pointer">Vérifier à la main sur chaque portail</summary><div class="se-list" style="margin-top:6px">' + l.recherches.map((x) => '<a class="se-list-item" href="' + esc(x.url) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div style="flex:1">' + esc(x.plateforme) + '</div><span>↗</span></a>').join('') + '</div></details>' : '') +
      '<p class="se-hint" style="margin-top:10px">Vérifié le ' + dFR(d.maj || l.maj) + '.</p>' +
    '</div>';
  }

  function viewBien(r) {
    const b = bien(r.param);
    if (!b) return '<div class="se-card se-empty"><div class="se-empty-title">Bien introuvable</div><a class="se-btn" href="#/biens">Retour</a></div>';

    const prop = client(b.proprietaireId);
    const compat = clientsCompatibles(b);
    const visites = state.visites.filter((v) => v.bienId === b.id);
    const offres = state.offres.filter((o) => o.bienId === b.id);
    const scan = state.scan && state.scan.id === b.id ? state.scan : null;

    // Bloc de résultat du scanner Off-Market.
    let scanHtml = '';
    if (scan && scan.loading) {
      scanHtml = '<div class="se-muted" style="margin-top:10px;display:flex;align-items:center;gap:8px">Recherche des annonces en cours…</div>';
    } else if (scan && scan.error) {
      scanHtml = '<div class="se-note" style="margin-top:10px">' + esc(scan.error) + '</div>';
    } else if (scan && scan.data) {
      const d = scan.data;
      if (d.statut === 'doublon') {
        scanHtml = '<div class="se-note" style="margin-top:10px;background:var(--color-alert-soft);border:0;color:var(--color-alert)"><b>Forte probabilité de doublon.</b></div>' +
          '<div class="se-list" style="margin-top:8px">' + d.trouves.map((t) => '<a class="se-list-item" href="' + esc(t.url) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div style="flex:1"><div style="font-size:13.5px">' + esc(t.plateforme) + '</div><div class="se-hint">' + esc(t.query) + '</div></div><span>↗</span></a>').join('') + '</div>';
      } else if (d.statut === 'valide') {
        scanHtml = '<div class="se-note" style="margin-top:10px;background:var(--color-ok-soft);border:0;color:var(--color-ok)"><b>Bien non trouvé sur le marché. Validé pour l’Off-Market.</b></div>';
      } else {
        scanHtml = '<div class="se-note" style="margin-top:10px;background:var(--color-warn-soft);border:0;color:var(--color-warn)"><b>Vérification manuelle conseillée.</b> Google a bloqué la recherche automatique — ouvrez les recherches ci-dessous.</div>';
      }
      if (d.requetes && d.requetes.length) {
        scanHtml += '<div class="se-list" style="margin-top:10px">' + d.requetes.map((t) => '<a class="se-list-item" href="' + esc(t.url) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(t.plateforme) + '</div><div class="se-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.query) + '</div></div><span>↗</span></a>').join('') + '</div>';
      }
    }

    return bandeauArchive('bien', b) + '<div class="se-fiche-head">' +
      '<div style="flex:1"><div class="kicker" style="color:var(--color-taupe)">' + esc(b.ref) + ' · ' + esc(b.type) + ' · ' + esc(qLabel(b.quartier)) + (prop ? ' · <a href="#/client/' + prop.id + '" style="color:var(--color-club-violet);text-decoration:none">Propriétaire : ' + esc(nomClient(prop)) + '</a>' : '') + '</div>' +
      '<h1 class="display" style="font-size:30px;margin:4px 0 2px">' + esc(b.titre) + '</h1>' +
      '<div class="se-row" style="gap:8px">' + badgeBien(b.statut) + badgeExclusivite(b) + badgeValidation(b) + badgeDemo(b) + '<span class="se-pill" title="Prix net vendeur">Net <b>' + euro(b.prix) + '</b></span><span class="se-pill" title="Prix affiché aux acquéreurs">HAI <b>' + euro(haiPour(b, null)) + '</b> · ' + tauxTxt(tauxPour(b, null)) + ' %</span><span class="se-pill" title="Prix affiché à un membre dont le bien a été VENDU par l’agence (statut Vendu)">Si son bien est vendu par nous : ' + euro(haiPour(b, REDUIT)) + '</span><span class="se-pill">' + euro(prixM2(b)) + ' /m² net</span></div></div>' +
      '<div class="se-actions">' +
        '<button class="se-btn ghost" data-act="historique" data-kind="bien" data-id="' + b.id + '">Historique</button>' +
        '<button class="se-btn ghost" data-act="bien-editer" data-id="' + b.id + '">Modifier</button>' +
        '<button class="se-btn ghost" data-act="bien-statut" data-id="' + b.id + '">Changer le statut</button>' +
        '<button class="se-btn" data-act="visite-nouvelle" data-id="' + b.id + '" data-bien="' + b.id + '">Planifier une visite</button>' +
      '</div></div>' +

      '<div class="se-split">' +
        '<div class="se-grid" style="gap:18px">' +
          carteSurSeecret(b) +
          '<div class="se-card" style="padding:0;overflow:hidden"><div class="se-bien-photo" style="aspect-ratio:16/9">' + (photo(b) ? '<img src="' + photo(b) + '" alt=""/>' : '') + '</div>' +
            photosCrm(b) + '</div>' +
          carteEditorial(b) +
          carteVideo(b) +
          carteVisite(b) +
          carteEcoles(b) +
          '<div class="se-card"><h3>Prix et honoraires</h3><div class="se-kv" style="margin-top:10px">' +
            kv('Prix net vendeur', euro(b.prix)) +
            kv('Honoraires acquéreur', tauxTxt(tauxPour(b, null)) + ' % TTC' + ((b.tauxHonoraires === null || b.tauxHonoraires === undefined || b.tauxHonoraires === '') ? ' (barème)' : ' (propre au bien)')) +
            kv('Prix affiché (HAI)', euro(haiPour(b, null))) +
            kv('Prix affiché à un membre dont le bien a été vendu par nous', euro(haiPour(b, REDUIT)) + ' · ' + tauxTxt(tauxPour(b, REDUIT)) + ' %') +
          '</div>' +
          ((b.historiquePrix || []).length
            ? '<div class="se-list" style="margin-top:12px">' + b.historiquePrix.slice().reverse().map((h) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13.5px">' + (h.ancien ? euro(h.ancien) + ' → ' : '') + '<b>' + euro(h.nouveau) + '</b> net</div><div class="se-hint">' + dFR(h.at) + (h.auteur ? ' · ' + esc(h.auteur) : '') + (h.source ? ' · ' + esc(h.source) : '') + '</div></div></div>').join('') + '</div>'
            : '<p class="se-hint" style="margin-top:10px">Aucun changement de prix enregistré.</p>') +
          '</div>' +
          (b.importLot ? '' : '<div class="se-card"><h3>Descriptif</h3><p style="color:var(--color-graphite);font-size:14.5px;line-height:1.65;margin:10px 0 0">' + esc(b.description) + '</p>' +
            '<div class="se-chips" style="margin-top:14px">' + (b.atouts || []).map((a) => '<span class="se-chip" style="cursor:default">' + esc(a) + '</span>').join('') + '</div></div>') +
          (b.serveur ? '<div class="se-card"><h3>Infos libres</h3><p class="se-hint" style="margin:4px 0 10px">Tout ce que vous voulez noter sur ce bien. Visible seulement dans le CRM.</p>' +
            '<form data-form="bien-notes" data-id="' + esc(b.serverId) + '"><textarea class="se-textarea" name="notesLibres" rows="5" placeholder="Échange avec le vendeur, travaux, prix plancher, contraintes de visite…" style="width:100%">' + esc(b.notesLibres || '') + '</textarea>' +
            '<div class="se-row" style="justify-content:flex-end;margin-top:8px"><button class="se-btn sm" type="submit">Enregistrer</button></div></form></div>' : '') +
          '<div class="se-card"><h3>Acquéreurs compatibles</h3>' +
            (compat.length
              ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:10px">' +
                  '<label style="font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" class="sel-tous" style="margin:0"/> Tout sélectionner</label>' +
                  '<button class="se-btn ghost sm" id="btn-envoi-sel" data-act="bien-envoyer-sel" data-bien="' + b.id + '" data-all="' + esc(JSON.stringify(compat.map((x) => x.client.id))) + '">Envoyer à tous les matchs</button>' +
                '</div>' +
                '<div class="se-list" style="margin-top:8px">' + compat.slice(0, 8).map((x) => '<div class="se-list-item">' +
                  '<input type="checkbox" class="sel-acq" value="' + x.client.id + '" style="margin:0;flex:0 0 auto;width:16px;height:16px"/>' +
                  '<a href="#/client/' + x.client.id + '" style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit">' +
                    '<span class="se-avatar" style="width:32px;height:32px;flex:0 0 32px;font-size:12px">' + esc((x.client.prenom.charAt(0) + x.client.nom.charAt(0)).toUpperCase()) + '</span>' +
                    '<div style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(nomClient(x.client)) + '</div><div class="se-sub">' + (x.budgetMax ? euro(x.budgetMax) + ' max' : 'Budget non renseigné') + '</div></div>' +
                    scoreTag(x.score) +
                  '</a>' +
                  '<button class="se-btn ghost sm" data-act="bien-envoyer" data-bien="' + b.id + '" data-client="' + x.client.id + '">Envoyer</button>' +
                '</div>').join('') + '</div>'
              : '<p class="se-muted" style="margin-top:8px">Aucun acquéreur ne correspond pour l’instant.</p>') +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card"><h3>Le bien</h3><div class="se-kv" style="margin-top:12px">' +
            kv('Référence', esc(b.refAgence ? b.refAgence + ' (fichier)' : b.ref)) + kv('Surface', num(b.surface) + ' m²') +
            kv('Pièces', b.pieces + ' · ' + b.chambres + ' ch. · ' + b.sdb + ' sdb') +
            kv('Étage', b.etage != null ? (b.etage === 0 ? 'RDC' : esc(String(b.etage))) : '—') + kv('DPE', esc(b.dpe)) + kv('Année de construction', b.anneeConstruction || '—') + kv('Statut', badgeBien(b.statut)) +
          '</div></div>' +
          carteSuiviAgence(b) +
          carteVerifsMarche(b) +
          '<div class="se-card"><h3>Propriétaire' + (b.mandatOrigine ? ' & mandat d’origine' : '') + '</h3><div class="se-kv" style="margin-top:12px">' +
            kv('Propriétaire', prop ? '<a href="#/client/' + prop.id + '">' + esc(nomClient(prop)) + '</a>' : '<span class="se-hint">non renseigné</span>') +
            (b.mandatOrigine ? (
              kv('Agence', esc(b.mandatOrigine.agence || '—')) +
              kv('Type de mandat', esc(b.mandatOrigine.type || 'non précisé') + (b.mandatOrigine.numero ? ' · n° ' + esc(b.mandatOrigine.numero) : '')) +
              kv('Début', b.mandatOrigine.debut ? dFR(b.mandatOrigine.debut) : '—') +
              kv('Échéance', b.mandatOrigine.fin ? dFR(b.mandatOrigine.fin) + (b.mandatOrigine.fin < new Date().toISOString().slice(0, 10) ? ' <span class="se-badge open">échu</span>' : '') : '—')
            ) : '') +
            kv('Créé dans le CRM', dFR(b.cree)) +
          '</div>' +
          (b.accesVisites ? '<div class="se-divider"></div><div class="se-hint" style="text-transform:uppercase;letter-spacing:.06em;font-size:11px">Accès & notes de visite · interne</div><p style="white-space:pre-line;font-size:13.5px;line-height:1.55;margin:6px 0 0">' + esc(b.accesVisites) + '</p>' : '') +
          '</div>' +
          carteDetailsOrigine(b) +
          '<div class="se-card"><h3>Exclusivité</h3>' +
            '<div class="se-row" style="margin-top:8px">' + badgeExclusivite(b) + '</div>' +
            '<p class="se-muted" style="margin-top:6px">Vérifie si ce bien est déjà diffusé sur les portails immobiliers.</p>' +
            (b.exclusivite && b.exclusivite.erreur ? '<p class="se-hint" style="margin-top:8px;color:var(--color-alert)">' + esc(b.exclusivite.erreur) + '</p>' : '') +
            '<button class="se-btn block" style="margin-top:12px" data-act="exclusivite-scan" data-id="' + b.id + '">Lancer le scan d’exclusivité</button>' +
            (b.validation === 'en_attente' ? '<button class="se-btn soft block" style="margin-top:8px" data-act="bien-valider" data-id="' + b.id + '">Valider ce bien</button>' : '') +
            (b.exclusivite && b.exclusivite.liens && b.exclusivite.liens.length
              ? '<div class="se-list" style="margin-top:10px">' + b.exclusivite.liens.map((l) => '<a class="se-list-item" href="' + esc(l) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px">' + esc(l) + '</div><span class="se-hint">↗</span></a>').join('') + '</div>'
              : (b.exclusivite && b.exclusivite.statut === 'verifie_exclusif' ? '<p class="se-hint" style="margin-top:10px;color:var(--color-ok)">Aucune annonce concurrente trouvée.</p>' : '')) +
          '</div>' +
          '<div class="se-card"><h3>Visites & offres</h3>' +
            (visites.length ? '<div class="se-list" style="margin-top:8px">' + visites.map((v) => '<div class="se-list-item"><div style="flex:1"><div style="font-size:13.5px">' + esc(nomClient(client(v.clientId))) + '</div><div class="se-hint">' + dCourt(v.date) + ' · ' + v.heure + '</div></div><span class="se-badge muted">' + statutVisite(v.statut) + '</span></div>').join('') + '</div>' : '') +
            (offres.length ? '<div class="se-divider"></div><div class="se-list">' + offres.map((o) => '<div class="se-list-item"><div style="flex:1"><div style="font-size:13.5px">' + euro(o.montant) + '</div><div class="se-hint">' + esc(nomClient(client(o.clientId))) + ' · ' + dFR(o.cree) + '</div></div></div>').join('') + '</div>' : '') +
            (!visites.length && !offres.length ? '<p class="se-muted" style="margin-top:8px">Rien pour l’instant.</p>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------- recherches ----------------------------- */

  function viewRecherches() {
    const tri = state.rechTri || 'recent';
    let list = (state.recherchesServeur || []).concat(state.recherches).map((r) => ({ r, n: biensCompatibles(r, 50).length }));
    list = tri === 'recent'
      ? list.sort((a, b) => (b.r.cree || '').localeCompare(a.r.cree || ''))
      : list.sort((a, b) => b.n - a.n);
    const vueRech = state.filtres.vueRech || '';
    const ongletsRech = ongletsArchive('vueRech', vueRech, list.length, archivees('recherches').length, 'Recherches actives');
    if (vueRech === 'archives') {
      return head('Matching', 'Recherches archivées', 'Elles ne reçoivent plus de biens compatibles. Rien n’est supprimé.', '') + ongletsRech + viewArchives('recherche');
    }
    const triBtn = (id, label) => '<button class="se-btn ghost sm' + (tri === id ? ' is-on' : '') + '" data-act="recherches-tri" data-tri="' + id + '">' + label + '</button>';
    return head('Matching', 'Recherches',
      'Les critères de vos acquéreurs, confrontés en continu au portefeuille et aux données publiques.',
      '<button class="se-btn" data-act="recherche-nouvelle">' + ICONS.plus + ' Nouvelle recherche</button>') +
      ongletsRech +
      '<div class="se-row" style="gap:6px;margin-bottom:12px">' + triBtn('recent', 'Plus récentes') + triBtn('match', 'Plus de correspondances') + '</div>' +
      '<div class="se-grid cols-2">' + list.map(({ r, n }) => {
        const c = client(r.clientId);
        return '<a class="se-card" href="#/recherche/' + r.id + '" style="text-decoration:none;color:inherit">' +
          '<div class="se-row" style="justify-content:space-between"><span class="kicker" style="color:var(--color-taupe)">' + esc(nomClient(c)) + '</span>' +
          '<span class="se-badge ' + (n ? 'open' : 'muted') + '">' + n + ' bien(s)</span></div>' +
          '<h3 style="font-family:var(--font-serif);font-weight:420;font-size:20px;margin:8px 0 6px">' + esc(r.titre) + '</h3>' +
          '<div class="se-hint">≤ ' + euro(r.prixMax) + ' · ' + r.piecesMin + '+ pièces · ' + r.surfaceMin + '+ m²' + (r.dpe ? ' · DPE ' + r.dpe + '+' : '') + '</div>' +
          '<div class="se-hint" style="margin-top:4px">' + (r.quartiers || []).map(qLabel).join(' · ') + '</div>' +
          '</a>';
      }).join('') + '</div>';
  }

  function viewRecherche(r) {
    const rec = recherche(r.param);
    if (!rec) return '<div class="se-card se-empty"><div class="se-empty-title">Recherche introuvable</div><a class="se-btn" href="#/recherches">Retour</a></div>';
    // Recherche venant du serveur : son clientId est l'identifiant serveur du lead.
    const c = client(rec.clientId) || (state.clients || []).find((x) => x.serverId === rec.clientId) || null;
    const matches = biensCompatibles(rec, 40);
    const oppPubliques = matchings().filter((m) => m.rechercheId === rec.id).sort((a, b) => b.score - a.score);
    const secteurs = (rec.quartiers || []).map(qLabel).join(', ');

    const oppHtml = oppPubliques.length
      ? '<div class="se-list" style="margin-top:8px">' + oppPubliques.map((m) => {
          const rb = robotBien(m.bienId);
          return '<div class="se-list-item">' +
            '<div style="flex:1;min-width:0"><div style="font-size:14px">' + esc((rb && rb.adresse) || 'Bien') + '</div>' +
            '<div class="se-sub">' + esc((rb && rb.type) || '') + (rb && rb.ville ? ' · ' + esc(rb.ville) : '') + (rb && rb.dpe ? ' · DPE ' + esc(rb.dpe) : '') + (rb && rb.etageEstime ? ' · étage ' + esc(rb.etageEstime) + ' (estimé)' : '') + '</div></div>' +
            (rb ? '<a class="se-btn ghost sm" href="#/robot-bien/' + rb.id + '">Démarcher</a>' : '') +
          '</div>';
        }).join('') + '</div>'
      : '<p class="se-muted" style="margin-top:8px">Aucune opportunité détectée pour l’instant dans les données publiques.</p>';

    return bandeauArchive('recherche', rec) + head(esc(nomClient(c)), esc(rec.titre), 'Critères confrontés à ' + state.biens.length + ' biens du portefeuille et aux données publiques.',
      '<button class="se-btn ghost" data-act="historique" data-kind="recherche" data-id="' + rec.id + '">Historique</button>' +
      '<button class="se-btn ghost" data-act="recherche-editer" data-id="' + rec.id + '">Modifier</button>' +
      '<button class="se-btn" data-act="recherche-envoyer" data-id="' + rec.id + '">Envoyer la sélection</button>') +
      '<div class="se-split">' +
        '<div>' +
          '<div class="se-card"><h3>Biens compatibles (portefeuille)</h3>' +
            (matches.length ? '<div class="se-list" style="margin-top:8px">' + matches.map((m) => '<div class="se-list-item">' +
              '<a href="#/bien/' + m.bien.id + '" style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit">' +
                '<img class="se-thumb" src="' + photo(m.bien) + '" alt="" style="width:40px;height:40px;flex:0 0 40px"/>' +
                '<div style="flex:1;min-width:0"><div style="font-size:14px">' + esc(m.bien.titre) + '</div>' +
                '<div class="se-sub">' + esc(m.bien.ref) + ' · ' + euro(m.bien.prix) + ' · ' + num(m.bien.surface) + ' m² · ' + esc(qLabel(m.bien.quartier)) + '</div></div>' +
                scoreTag(m.score) +
              '</a>' +
              (c ? '<button class="se-btn ghost sm" data-act="bien-envoyer" data-bien="' + m.bien.id + '" data-client="' + c.id + '">Envoyer</button>' : '') +
            '</div>').join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucun bien ne correspond encore.</p>') +
          '</div>' +
          '<div class="se-card" style="margin-top:16px"><div class="se-row" style="justify-content:space-between;align-items:flex-start">' +
            '<h3>Opportunités publiques (DPE)</h3>' +
            (secteurs ? '<button class="se-btn ghost sm" data-act="recherche-dpe-opportunite" data-id="' + rec.id + '">Chercher des biens DPE correspondants</button>' : '') +
          '</div>' +
          (secteurs ? '' : '<p class="se-hint" style="margin-top:6px">Ajoutez un secteur à cette recherche pour pouvoir lancer une recherche DPE ciblée.</p>') +
            oppHtml +
          '</div>' +
        '</div>' +
        '<div class="se-card"><h3>Critères</h3><div class="se-kv" style="margin-top:12px">' +
          kv('Budget', (rec.prixMin ? euro(rec.prixMin) + ' – ' : '≤ ') + euro(rec.prixMax)) +
          kv('Type(s)', (rec.types && rec.types.length ? rec.types.join(', ') : (rec.type || 'tout'))) +
          kv('Pièces min', rec.piecesMin || '—') + kv('Chambres min', rec.chambresMin || '—') + kv('Salles de bain min', rec.sdbMin || '—') +
          kv('Surface', (rec.surfaceMin ? rec.surfaceMin + ' m² min' : '—') + (rec.surfaceMax ? ' · ' + rec.surfaceMax + ' m² max' : '')) +
          kv('Étage', (rec.etageMin ? rec.etageMin + ' min' : '—') + (rec.etageMax ? ' · ' + rec.etageMax + ' max' : '') + (rec.dernierEtageOk ? ' · dernier étage OK' : '')) +
          kv('DPE', rec.dpe ? rec.dpe + ' ou mieux' : 'Indifférent') +
          kv('Époque', rec.epoque ? (EPOQUES.find((e) => e.id === rec.epoque) || {}).label || rec.epoque : 'Indifférent') +
          kv('Délai', esc(rec.delai || '—')) +
          kv('Secteurs', secteurs || '—') +
          kv('Alertes', rec.alertes ? 'Activées' : 'Désactivées') +
        '</div>' + (c ? '<a class="se-btn ghost block" style="margin-top:14px" href="#/client/' + c.id + '">Acquéreur : ' + esc(nomClient(c)) + '</a>' : '') + '</div>' +
      '</div>';
  }

  /* --------------------------------- visites ------------------------------ */

  function viewVisites() {
    const avenir = state.visites.filter((v) => v.statut === 'demandee' || v.statut === 'confirmee').sort((a, b) => a.date.localeCompare(b.date));
    const passees = state.visites.filter((v) => v.statut === 'realisee' || v.statut === 'annulee');

    const row = (v) => {
      const b = bien(v.bienId);
      const c = client(v.clientId);
      return '<div class="se-list-item">' +
        '<div style="flex:1;min-width:0"><div style="font-size:14px">' + esc(b ? b.titre : 'Bien') + '</div>' +
        '<div class="se-hint">' + esc(nomClient(c)) + ' · ' + dCourt(v.date) + ' · ' + v.heure + (v.note ? ' · ' + esc(v.note) : '') + '</div></div>' +
        '<span class="se-badge ' + (v.statut === 'confirmee' ? 'open' : v.statut === 'demandee' ? 'warn' : 'muted') + '">' +
          ({ demandee: 'À confirmer', confirmee: 'Confirmée', realisee: 'Réalisée', annulee: 'Annulée' }[v.statut]) + '</span>' +
        (v.statut === 'demandee' ? '<button class="se-btn sm" data-act="visite-confirmer" data-id="' + v.id + '">Confirmer</button>' : '') +
        (v.statut !== 'annulee' && v.statut !== 'realisee' ? '<button class="se-btn ghost sm" data-act="visite-annuler" data-id="' + v.id + '">Annuler</button>' : '') +
      '</div>';
    };

    return head('Agenda', 'Visites', 'Ce que Seecret organise pour vous.',
      '<button class="se-btn" data-act="visites-nouvelle">' + ICONS.plus + ' Planifier</button>') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<div class="se-card"><h3>À venir</h3>' + (avenir.length ? '<div class="se-list" style="margin-top:8px">' + avenir.map(row).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Aucune visite programmée.</p>') + '</div>' +
        '<div class="se-card"><h3>Historique</h3>' + (passees.length ? '<div class="se-list" style="margin-top:8px">' + passees.map(row).join('') + '</div>' : '<p class="se-muted" style="margin-top:8px">Rien encore.</p>') + '</div>' +
      '</div>';
  }

  /* ---------------------------------- offres ------------------------------ */

  function statutOffre(s) {
    return { recue: 'Reçue', en_attente: 'Reçue', contre: 'Contre-offre', acceptee: 'Acceptée', refusee: 'Refusée' }[s] || s;
  }

  function statutVisite(s) {
    return { demandee: 'À confirmer', confirmee: 'Confirmée', realisee: 'Réalisée', annulee: 'Annulée' }[s] || s;
  }

  // Pipeline Propositions → Offres (étape 4, fusion CRM) : 3 étapes avant
  // l'offre écrite — post-visite, pas de nouvelle entité, juste un champ sur
  // le bien (etapeProposition) — puis l'offre comme 4e étape (déjà existante).
  const PROPOSITION_COLS = [['a_presenter', 'À présenter'], ['presentee', 'Présentée'], ['reponse_recue', 'Réponse reçue']];

  function viewOffres() {
    const list = state.offres.slice().sort((a, b) => (a.cree < b.cree ? 1 : -1));
    const biensOuverts = (state.biensServeur || []).concat(state.biens).filter((b) => b.statut === 'ouvert' || b.statut === 'avant-premiere');
    const colonne = (k) => biensOuverts.filter((b) => (b.etapeProposition || (k === 'a_presenter' ? '' : null)) === k || (k === 'a_presenter' && !b.etapeProposition));
    const carteBien = (b) => '<div class="se-list-item">' +
      '<a href="#/bien/' + b.id + '" style="flex:1;min-width:0"><div style="font-size:13.5px">' + esc(b.titre) + '</div>' +
      '<div class="se-hint">' + esc(b.ref) + ' · ' + euro(b.prix) + '</div></a>' +
      '<select class="se-select" style="width:auto" data-act="proposition-deplacer" data-id="' + b.id + '">' +
        PROPOSITION_COLS.map(([k, l]) => '<option value="' + k + '"' + ((b.etapeProposition || 'a_presenter') === k ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select></div>';
    const board = '<div class="se-card"><h3>Propositions (post-visite, avant l’offre écrite)</h3>' +
      '<div class="se-grid cols-3" style="gap:14px;margin-top:10px;align-items:start">' +
        PROPOSITION_COLS.map(([k, l]) => {
          const items = colonne(k);
          return '<div><div class="se-kicker" style="margin-bottom:8px">' + esc(l) + ' (' + items.length + ')</div>' +
            (items.length ? items.map(carteBien).join('') : '<p class="se-muted" style="font-size:13px">Aucun bien.</p>') + '</div>';
        }).join('') +
      '</div></div>';
    return head('Négociation', 'Propositions → Offres', 'De la présentation du bien jusqu’à la décision sur l’offre.') +
      board +
      '<div class="se-card" style="padding:8px 16px;margin-top:18px"><h3 style="padding:8px 0 0">Offres (4e étape)</h3><div class="se-table-wrap"><table class="se-table"><thead><tr><th>Bien</th><th>Client</th><th>Montant</th><th>Écart</th><th>Date</th><th>Statut</th><th></th></tr></thead><tbody>' +
      list.map((o) => {
        const b = bien(o.bienId);
        const c = client(o.clientId);
        // L'offre est faite sur le prix affiché (HAI) : écart calculé sur ce prix,
        // avec l'équivalent net vendeur à transmettre au propriétaire.
        const ref = o.prixAffiche || (b ? haiPour(b, c) : 0);
        const delta = ref ? Math.round(((o.montant - ref) / ref) * 1000) / 10 : 0;
        const net = o.montantNet || (b ? Math.round(o.montant / (1 + tauxPour(b, c) / 100)) : 0);
        return '<tr><td><a href="#/bien/' + o.bienId + '" style="color:inherit">' + esc(b ? b.titre : '—') + '</a></td>' +
          '<td>' + esc(nomClient(c)) + '</td><td><b>' + euro(o.montant) + '</b> <span class="se-hint">HAI</span>' + (net ? '<div class="se-hint">soit ' + euro(net) + ' net vendeur</div>' : '') + '</td>' +
          '<td class="' + (delta < 0 ? '' : '') + '">' + (delta > 0 ? '+' : '') + delta + ' %</td>' +
          '<td class="se-hint">' + dFR(o.cree) + '</td><td>' + statutOffre(o.statut) + '</td>' +
          '<td>' + (o.statut === 'recue' || o.statut === 'en_attente' || o.statut === 'contre'
            ? '<div class="se-row" style="gap:6px"><button class="se-btn ghost sm" data-act="offre-refusee" data-id="' + o.id + '">Refuser</button><button class="se-btn sm" data-act="offre-acceptee" data-id="' + o.id + '">Accepter</button></div>'
            : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ---------------------------------- tâches ------------------------------ */

  // Relances automatiques J+1/J+3/J+7 : à chaque nouveau client (créé à la
  // main ou via le Robot DPE) ou à chaque mise en relation acquéreur/vendeur
  // détectée sur la plateforme, trois rappels sont programmés d'emblée pour
  // qu'un contact ne tombe jamais dans l'oubli — ce sont des tâches comme les
  // autres (visibles, modifiables, décochables dans l'onglet Tâches), jamais
  // un message envoyé automatiquement à l'insu de l'agent.
  function programmerRelances(clientId, titre, contexte) {
    state.taches = state.taches || [];
    [1, 3, 7].forEach((j) => {
      const echeance = new Date(Date.now() + j * 86400000).toISOString().slice(0, 10);
      state.taches.push({
        id: uid('t'), titre: 'Relancer ' + titre + ' (J+' + j + (contexte ? ' — ' + contexte : '') + ')',
        clientId: clientId, echeance: echeance, fait: false, auto: true
      });
    });
  }

  function taskRow(t) {
    const late = !t.fait && t.echeance && new Date(t.echeance) < new Date(new Date().toDateString());
    return '<div class="se-task ' + (t.fait ? 'done' : '') + '">' +
      '<input type="checkbox" data-act="tache-toggle" data-id="' + t.id + '"' + (t.fait ? ' checked' : '') + ' style="cursor:pointer"/>' +
      '<span style="flex:1"><span class="se-task-titre">' + esc(t.titre) + (t.auto ? ' <span class="se-hint">· auto</span>' : '') + '</span>' +
      '<span class="se-hint ' + (late ? 'late' : '') + '">' + (t.echeance ? dansX(t.echeance) : 'sans date') + (t.clientId ? ' · ' + esc(nomClient(client(t.clientId))) : '') + '</span></span>' +
    '</div>';
  }

  function verifTaskRow(t) {
    const done = t.statut !== 'en_attente';
    return '<div class="se-task' + (done ? ' done' : '') + '">' +
      '<span style="flex:1"><span class="se-task-titre">' + esc(t.titre || 'Tâche') + '</span>' +
      '<span class="se-hint">' + esc(t.nom || '') + ' · ' + ilYa(t.cree) + '</span></span>' +
      (t.demandeId ? '<button class="se-btn ghost sm" data-act="demande-ouvrir" data-id="' + t.demandeId + '">Voir</button>' : '') +
    '</div>';
  }

  function viewTaches() {
    const ouvertes = state.taches.filter((t) => !t.fait);
    const finies = state.taches.filter((t) => t.fait);
    const verifOuvertes = (state.tachesVerif || []).filter((t) => t.type === 'demande' && t.statut === 'en_attente');
    const verifFinies = (state.tachesVerif || []).filter((t) => t.type === 'demande' && t.statut !== 'en_attente');
    return head('Suivi', 'Tâches', 'Les relances qui font la différence.',
      '<button class="se-btn" data-act="tache-nouvelle">' + ICONS.plus + ' Nouvelle tâche</button>') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<div class="se-card"><h3>En cours (' + (ouvertes.length + verifOuvertes.length) + ')</h3>' + verifOuvertes.map(verifTaskRow).join('') + (ouvertes.length ? ouvertes.map(taskRow).join('') : '') + (!verifOuvertes.length && !ouvertes.length ? '<p class="se-muted" style="margin-top:8px">Tout est fait.</p>' : '') + '</div>' +
        '<div class="se-card"><h3>Terminées</h3>' + verifFinies.map(verifTaskRow).join('') + (finies.length ? finies.map(taskRow).join('') : '') + (!verifFinies.length && !finies.length ? '<p class="se-muted" style="margin-top:8px">—</p>' : '') + '</div>' +
      '</div>';
  }

  function viewVerifications() {
    const list = (state.tachesVerif || []).slice().sort((a, b) => (a.statut === 'en_attente' ? 0 : 1) - (b.statut === 'en_attente' ? 0 : 1));
    return head('Adhésions', 'Vérifications', 'Les dossiers des membres en attente de validation.') +
      (list.length
        ? '<div class="se-grid" style="gap:14px">' + list.map((t) => {
            const docs = t.documents || [];
            const enAttente = t.statut === 'en_attente';
            const statutBadge = enAttente ? '<span class="se-badge warn">En attente</span>' : (t.statut === 'validee' ? '<span class="se-badge open">Validé</span>' : '<span class="se-badge muted">Refusé</span>');
            return '<div class="se-card">' +
              '<div class="se-row" style="justify-content:space-between">' +
                '<div><div style="font-weight:600;font-size:15px">' + esc(t.nom || ((t.prenom || '') + ' ' + (t.nomFamille || '')).trim()) + '</div>' +
                '<div class="se-hint">' + esc(t.email || '') + ' · reçu le ' + dFR(t.cree) + '</div></div>' +
                statutBadge +
              '</div>' +
              '<div class="se-list" style="margin-top:10px">' +
                (docs.length ? docs.map((d) => '<div class="se-list-item"><div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(libelleDoc(d.type)) + '</div><div class="se-hint" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.nom || d.type) + '</div></div><a class="se-btn ghost sm" href="' + esc(d.fichier) + '" target="_blank" rel="noopener">Voir</a></div>').join('') : '<p class="se-muted">Aucun document.</p>') +
              '</div>' +
              (enAttente ? '<div class="se-row" style="gap:8px;margin-top:14px">' +
                '<button class="se-btn block" data-act="verif-valider" data-id="' + t.id + '">Valider le compte</button>' +
                '<button class="se-btn ghost block" data-act="verif-refuser" data-id="' + t.id + '">Refuser</button>' +
              '</div>' : '') +
            '</div>';
          }).join('') + '</div>'
        : '<div class="se-card se-empty"><div class="se-empty-title">Aucune vérification en attente</div><p>Les dossiers soumis par les membres apparaîtront ici.</p></div>');
  }

  /* -------------------------------- messages ------------------------------ */

  // ---- Messagerie membre ↔ agence (vraie, côté serveur) ----
  // Le paramètre de route est un id client du CRM (srv-…) ou directement
  // l'identifiant du membre côté serveur.
  // Comment joindre ce contact ? Un message part dans l'espace membre (s'il est
  // membre accepté) et par email (s'il en a un). Sinon : téléphone, ou rien.
  function canauxContact(c) {
    const membre = !!c && (c.serveurStatut === 'accepte' || c.statut === 'actif');
    const email = !!(c && String(c.email || '').trim());
    const tel = !!(c && String(c.tel || '').trim());
    return { membre: membre, email: email, tel: tel, message: membre || email };
  }
  function blocSansContact(c) {
    return '<div class="se-notice" style="margin-top:10px"><strong>Aucun moyen de le joindre pour l’instant.</strong> Ce contact n’a ni email, ni téléphone, ni espace membre : un message ne lui arriverait pas. ' +
      'Ajoutez son email ou son téléphone' + (c && c.adresseBien ? ', ou écrivez-lui par courrier au ' + esc(c.adresseBien) : '') + '.' +
      (c ? '<div style="margin-top:10px"><button class="se-btn sm" data-act="client-editer" data-id="' + esc(c.id) + '">Ajouter un email ou un téléphone</button></div>' : '') + '</div>';
  }
  function leadDuFil(param) {
    const c = client(param);
    return (c && c.serverId) || String(param || '').replace(/^srv-/, '');
  }
  function messagesNonLus() { return (state.conversations || []).reduce((n, c) => n + (c.nonLus || 0), 0); }
  async function chargerFil(leadId) {
    if (!leadId) return;
    try {
      const r = await fetch('/api/messages/' + encodeURIComponent(leadId), { headers: { accept: 'application/json' } });
      if (!r.ok) return;
      state.fils = state.fils || {};
      state.fils[leadId] = (await r.json()).messages || [];
      const conv = (state.conversations || []).find((c) => c.leadId === leadId);
      if (conv) conv.nonLus = 0;
    } catch (e) { /* ignore */ }
  }
  function viewMessages() {
    const convs = state.conversations || [];
    return head('Messagerie', 'Messages des membres', 'Les questions posées par les membres depuis leur espace. Chaque réponse leur est envoyée par email.') +
      '<div class="se-card" style="max-width:820px"><div class="se-list">' +
        (convs.length ? convs.map((c) => {
          const ini = (c.nom || '?').split(' ').map((x) => x.charAt(0)).join('').slice(0, 2).toUpperCase();
          return '<a class="se-rowlink" href="#/messages/' + esc(c.leadId) + '"><span class="se-avatar" style="width:34px;height:34px;flex:0 0 34px;font-size:11px">' + esc(ini) + '</span>' +
            '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:' + (c.nonLus ? 600 : 400) + '">' + esc(c.nom) + '</div>' +
            '<div class="se-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (c.dernier && c.dernier.de === 'agent' ? 'Vous : ' : '') + esc(c.dernier ? c.dernier.texte : '') + '</div></div>' +
            (c.nonLus ? '<span class="se-count">' + c.nonLus + '</span>' : '') +
            '<span class="se-hint">' + (c.dernier ? dCourt(c.dernier.at) : '') + '</span></a>';
        }).join('') : '<p class="se-muted">Aucun message pour l’instant. Les membres écrivent depuis le bouton « Mon agent » de leur espace.</p>') +
      '</div></div>';
  }
  function viewThread(r) {
    const leadId = leadDuFil(r.param);
    const conv = (state.conversations || []).find((c) => c.leadId === leadId);
    const c = client(r.param) || (state.clients || []).find((x) => x.serverId === leadId);
    const nom = conv ? conv.nom : nomClient(c);
    const fil = state.fils && state.fils[leadId];
    if (!fil) { chargerFil(leadId).then(render); }
    return '<div style="margin-bottom:14px"><a class="se-btn ghost sm" href="#/messages">← Messages</a></div>' +
      head(esc(nom || 'Membre'), 'Conversation', esc((conv && conv.email) || (c && c.email) || '')) +
      '<div class="se-card" style="max-width:760px">' +
        '<div class="se-chat" data-fil-messages style="max-height:min(60vh,560px);overflow-y:auto">' +
          (fil ? (fil.length ? fil.map((m) => '<div class="se-bubble ' + (m.de === 'agent' ? 'me' : 'agent') + '">' + esc(m.texte).replace(/\n/g, '<br>') + '<time>' + (m.de === 'agent' && m.auteur ? esc(m.auteur) + ' · ' : '') + dCourt(m.at) + ' ' + tFR(m.at) + '</time></div>').join('')
            : '<p class="se-muted">Aucun message pour l’instant.</p>')
            : '<p class="se-muted">Chargement…</p>') +
        '</div>' +
        (function () {
          const k = c ? canauxContact(c) : { message: true, membre: true, email: !!(conv && conv.email) };
          if (!k.message) return blocSansContact(c) + (k.tel ? '<p class="se-hint" style="margin-top:8px">Il a un téléphone : <a href="tel:' + esc(c.tel) + '">appeler ' + esc(c.tel) + '</a> ou <a href="sms:' + esc(c.tel) + '">envoyer un SMS</a>.</p>' : '');
          const via = k.membre && k.email ? 'Reçu dans son espace membre et par email.' : k.membre ? 'Reçu dans son espace membre.' : 'Envoyé par email : pas encore d’espace membre.';
          return '<form class="se-composer" data-form="msg" data-lead="' + esc(leadId) + '"><input class="se-input" name="texte" placeholder="Écrire à ' + esc(nom || 'ce contact') + '…" autocomplete="off" maxlength="2000"/><button class="se-btn" type="submit">Envoyer</button></form><p class="se-hint" style="margin:6px 0 0">' + via + '</p>';
        })() +
      '</div>';
  }

  /* ----------------------------------- célia -------------------------------- */
  // Célia (clin d'œil à « IA ») : l'assistant conversationnel et vocal du CRM,
  // sous forme de bulle flottante présente sur tout l'écran (pas un onglet) —
  // un agent qui sort de rendez-vous lui parle directement au micro, où qu'il
  // soit dans le CRM, et elle agit (lead, pipeline, rappel, candidature).

  function vocalActif() {
    try { return localStorage.getItem('seecret.celia.vocal') !== 'off'; } catch (e) { return true; }
  }
  function basculerVocal() {
    try { localStorage.setItem('seecret.celia.vocal', vocalActif() ? 'off' : 'on'); } catch (e) { /* ignore */ }
    if (!vocalActif() && window.speechSynthesis) window.speechSynthesis.cancel();
    render();
  }
  function direAVoixHaute(texte) {
    if (!window.speechSynthesis || !vocalActif() || !texte) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = 'fr-FR';
      const voix = window.speechSynthesis.getVoices().find((v) => /^fr/i.test(v.lang));
      if (voix) u.voice = voix;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  // On enregistre l'audio nous-mêmes (MediaRecorder) et on le transcrit côté
  // serveur (via Gemini) plutôt que d'utiliser la reconnaissance vocale native
  // du navigateur (SpeechRecognition / Web Speech API). Cette dernière a un
  // support cassé sur iPhone : Safari ET Chrome y sont tous les deux forcés
  // par iOS d'utiliser le même moteur WebKit, qui a un bug de longue date
  // jamais corrigé par Apple (service de reconnaissance indisponible, même
  // micro autorisé). MediaRecorder, lui, est largement supporté partout, y
  // compris sur iOS depuis plusieurs années.
  function reconnaissanceDisponible() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function blobVersBase64(blob) {
    return new Promise((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onloadend = () => resolve(String(lecteur.result || '').split(',')[1] || '');
      lecteur.onerror = reject;
      lecteur.readAsDataURL(blob);
    });
  }

  // Centralise l'envoi d'un message à Célia (texte tapé OU dicté au micro) —
  // appelée directement par le code, jamais via un événement `submit` simulé :
  // un `render()` peut avoir lieu entre-temps (ex. à la fin de l'écoute vocale)
  // et détacherait le formulaire du DOM, empêchant l'événement de remonter.
  // Traite la réponse commune aux deux points d'entrée (nouveau message /
  // décision sur une proposition) : soit une nouvelle proposition d'action
  // à valider, soit une réponse finale en texte.
  function traiterReponseCelia(res) {
    if (res.enAttente && res.enAttente.length) {
      state.celiaAttente = res.enAttente;
      // Historique gardé intact (jamais tronqué) tant qu'une action est en
      // attente : il contient l'appel d'outil du modèle, qu'il faut pouvoir
      // lui renvoyer exactement tel quel une fois la décision connue.
      state.celiaHistorique = res.historique || state.celiaHistorique;
      state.celiaMessages.push({ role: 'proposition', texte: res.enAttente.map((a) => a.resume).join('\n'), at: nowISO() });
      return '';
    }
    state.celiaAttente = null;
    const reponseTexte = res.reponse || '…';
    state.celiaMessages.push({ role: 'assistant', texte: reponseTexte, actions: res.actions || [], at: nowISO() });
    // On ne garde que les 30 derniers messages envoyés à l'API, pour que
    // l'historique ne grossisse pas indéfiniment au fil d'une longue session.
    state.celiaHistorique = (res.historique || []).slice(-30);
    return reponseTexte;
  }

  async function envoyerMessageCelia(texte) {
    texte = String(texte || '').trim();
    if (!texte || state.celiaEnCours || (state.celiaAttente && state.celiaAttente.length)) return;
    state.celiaMessages.push({ role: 'user', texte: texte, at: nowISO() });
    state.celiaEnCours = true;
    commit();
    let reponseTexte = '';
    try {
      const r = await fetch('/api/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ message: texte, historique: state.celiaHistorique })
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'Erreur serveur');
      reponseTexte = traiterReponseCelia(res);
    } catch (e) {
      reponseTexte = 'Désolé, une erreur est survenue : ' + (e.message || 'inconnue') + '.';
      state.celiaMessages.push({ role: 'assistant', texte: reponseTexte, actions: [] });
    }
    state.celiaEnCours = false;
    commit();
    if (reponseTexte) direAVoixHaute(reponseTexte);
    setTimeout(() => {
      const box = document.querySelector('[data-celia-scroll]');
      if (box) box.scrollTop = box.scrollHeight;
    }, 30);
  }

  // Appelée quand l'agent tape sur « Valider » ou « Annuler » sous une
  // proposition d'action de Célia — jamais exécutée automatiquement avant ça.
  async function repondreActionCelia(accepter) {
    const attente = state.celiaAttente;
    if (!attente || !attente.length || state.celiaEnCours) return;
    const decisions = attente.map((a) => ({ id: a.id, outil: a.outil, input: a.input, accepter: accepter }));
    state.celiaAttente = null;
    state.celiaEnCours = true;
    state.celiaMessages.push({ role: 'user', texte: accepter ? '✓ Validé' : '✕ Annulé', at: nowISO() });
    commit();
    let reponseTexte = '';
    try {
      const r = await fetch('/api/assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ decisions: decisions, historique: state.celiaHistorique })
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'Erreur serveur');
      reponseTexte = traiterReponseCelia(res);
    } catch (e) {
      reponseTexte = 'Désolé, une erreur est survenue : ' + (e.message || 'inconnue') + '.';
      state.celiaMessages.push({ role: 'assistant', texte: reponseTexte, actions: [] });
    }
    state.celiaEnCours = false;
    commit();
    if (reponseTexte) direAVoixHaute(reponseTexte);
    setTimeout(() => {
      const box = document.querySelector('[data-celia-scroll]');
      if (box) box.scrollTop = box.scrollHeight;
    }, 30);
  }

  async function basculerEcoute() {
    if (celiaEcoute) {
      // Un second tap arrête l'enregistrement ; la transcription + l'envoi se
      // font dans recorder.onstop (ci-dessous).
      if (celiaRecorder && celiaRecorder.state !== 'inactive') celiaRecorder.stop();
      return;
    }
    if (!reconnaissanceDisponible()) { toast('Micro non disponible sur ce navigateur — utilisez le clavier.', 'warn'); return; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    try {
      // navigator.mediaDevices.getUserMedia() doit être appelé de façon
      // synchrone dans le geste de l'utilisateur (le tap) — c'est le cas ici,
      // basculerEcoute() étant appelée directement depuis le clic, avant ce
      // premier `await`.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
      const mime = candidats.find((m) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const morceaux = [];
      celiaRecorder = recorder;
      celiaEcoute = true;
      celiaTranscription = false;
      render();
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) morceaux.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const typeFinal = recorder.mimeType || mime || 'audio/webm';
        const blob = new Blob(morceaux, { type: typeFinal });
        celiaEcoute = false;
        celiaRecorder = null;
        celiaTranscription = true;
        render();
        try {
          const b64 = await blobVersBase64(blob);
          const r = await fetch('/api/assistant/transcrire', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ audio: b64, mimeType: typeFinal })
          });
          const res = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(res.error || ('Erreur de transcription (code ' + r.status + ')'));
          const texte = String(res.texte || '').trim();
          celiaTranscription = false;
          if (texte) {
            // On pose le texte dicté dans le champ pour relecture — l'utilisateur
            // peut le corriger avant de valider, il n'est jamais envoyé seul.
            celiaBrouillon = texte;
            render();
            celiaBrouillon = ''; // consommé par le render() qui précède, on vide pour ne pas écraser une future saisie
            setTimeout(() => {
              const input = document.querySelector('.se-celia-panel input[name="texte"]');
              if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
            }, 30);
          } else {
            render();
            toast('Rien n’a été compris — réessayez en parlant juste après avoir appuyé.', 'warn');
          }
        } catch (e) {
          celiaTranscription = false;
          render();
          toast('Transcription impossible : ' + (e.message || 'erreur inconnue') + '.', 'warn');
        }
      };
      recorder.start();
      // Filet de sécurité : si on oublie de retaper pour arrêter (ou qu'on ne
      // trouve pas comment), on coupe automatiquement après 90s au lieu de
      // laisser l'enregistrement — et le fichier à transcrire — grossir
      // indéfiniment.
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 90000);
    } catch (e) {
      celiaEcoute = false;
      celiaRecorder = null;
      render();
      const nom = e && e.name;
      const messages = {
        NotAllowedError: 'Micro refusé — autorisez l’accès au micro pour ce site dans les réglages de votre navigateur.',
        PermissionDeniedError: 'Micro refusé — autorisez l’accès au micro pour ce site dans les réglages de votre navigateur.',
        NotFoundError: 'Aucun micro détecté sur cet appareil.',
        NotReadableError: 'Le micro est déjà utilisé par une autre application.'
      };
      toast((nom && messages[nom]) || ('Erreur du micro (' + (nom || (e && e.message) || 'inconnue') + ') — réessayez ou utilisez le clavier.'), 'warn');
    }
  }

  function celiaWidget() {
    if (!celiaOuvert) {
      // Un tap sur la bulle ouvre Célia en mode texte (pas d'écoute micro
      // automatique : la transcription vocale a un coût réel à chaque appel,
      // elle ne se lance que si l'agent le demande explicitement via le
      // bouton micro du panneau — voir l'action « celia-micro »).
      return '<button class="se-celia-btn" data-act="celia-toggle" aria-label="Parler à Célia">' +
        '<span class="se-celia-btn-dot"></span>' + ICONS.mic +
      '</button>';
    }
    const msgs = state.celiaMessages || [];
    return '<div class="se-celia-panel">' +
      '<div class="se-celia-head">' +
        '<span class="nom"><span class="se-celia-avatar">C</span>Célia</span>' +
        '<div class="se-row" style="gap:2px">' +
          '<button class="se-celia-icon" data-act="celia-vocal-toggle" title="' + (vocalActif() ? 'Couper la voix' : 'Activer la voix') + '">' + (vocalActif() ? ICONS.volume : ICONS.volumeOff) + '</button>' +
          (msgs.length ? '<button class="se-celia-icon" data-act="celia-reset" title="Nouvelle conversation">' + ICONS.plus + '</button>' : '') +
          '<button class="se-celia-icon" data-act="celia-toggle" title="Fermer">' + ICONS.x + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="se-celia-body se-chat" data-celia-scroll>' +
        (msgs.length ? msgs.map((m) => (
          m.role === 'proposition' ?
            // Action que Célia propose, pas encore exécutée — ne s'affiche
            // jamais comme un fait accompli.
            '<div class="se-bubble agent se-celia-proposition">' +
              '<strong>Célia souhaite :</strong><br>' + esc(m.texte).replace(/\n/g, '<br>') +
            '</div>'
          :
          '<div class="se-bubble ' + (m.role === 'user' ? 'me' : 'agent') + '">' +
            esc(m.texte).replace(/\n/g, '<br>') +
            ((m.actions && m.actions.length) ? '<div class="se-row" style="flex-wrap:wrap;gap:6px;margin-top:8px">' +
              m.actions.map((a) => (a.lien ? '<a class="se-badge open" href="' + a.lien + '">' + esc(a.resume) + '</a>' : '<span class="se-badge open">' + esc(a.resume) + '</span>')).join('') +
            '</div>' : '') +
          '</div>'
        )).join('') :
          // Message d'accueil affiché tant qu'aucun échange n'a eu lieu — à
          // l'ouverture, pas de son ni d'écoute : juste ce message, le champ
          // texte prêt à recevoir, et le micro disponible à côté si l'agent
          // préfère dicter.
          '<div class="se-bubble agent">' +
            'Que puis-je pour vous' + ((state.moi && state.moi.prenom) ? ', ' + esc(state.moi.prenom) : '') + ' ?' +
          '</div>' +
          '<p class="se-muted">Par exemple : « Je sors de chez Mme Intel, 12 rue de Seine, elle veut vendre. Envoie-lui la candidature et programme un rappel pour le 28. »' + (reconnaissanceDisponible() ? ' — au clavier, ou au micro si vous préférez dicter.' : '') + '</p>') +
        ((state.celiaAttente && state.celiaAttente.length) ?
          // L'action proposée reste affichée (bulle ci-dessus) jusqu'à ce
          // que l'agent valide ou refuse explicitement — jamais automatique.
          '<div class="se-row se-celia-confirm" style="gap:8px;margin:2px 0 6px">' +
            '<button type="button" class="se-btn sm" data-act="celia-valider" ' + (state.celiaEnCours ? 'disabled' : '') + '>Valider</button>' +
            '<button type="button" class="se-btn sm ghost" data-act="celia-refuser" ' + (state.celiaEnCours ? 'disabled' : '') + '>Annuler</button>' +
          '</div>'
        : state.celiaEnCours ? '<div class="se-bubble agent"><span class="se-muted">…</span></div>' : '') +
      '</div>' +
      '<div class="se-celia-foot">' +
        (celiaEcoute ?
          // Grande zone de tap unique pendant l'enregistrement : pas de petit
          // bouton à viser, tout le bandeau arrête l'écoute et envoie ce qui a
          // été dit (la transcription se fait après, côté serveur).
          '<button type="button" class="se-celia-stop" data-act="celia-micro">' +
            '<span class="se-celia-stop-dot"></span>' + ICONS.mic +
            '<span>Je vous écoute… touchez pour arrêter et envoyer</span>' +
          '</button>'
        : celiaTranscription ?
          '<div class="se-celia-stop se-celia-stop-attente">' +
            '<span class="se-celia-stop-dot"></span>' + ICONS.mic +
            '<span>Transcription en cours…</span>' +
          '</div>'
        :
          (function () {
            // Le clavier/micro restent désactivés tant qu'une action proposée
            // par Célia attend d'être validée ou refusée (voir ci-dessus) :
            // pas de nouveau message tant que celle-ci n'est pas tranchée.
            const bloque = state.celiaEnCours || !!(state.celiaAttente && state.celiaAttente.length);
            return '<form data-form="celia">' +
              (reconnaissanceDisponible() ? '<button type="button" class="se-celia-mic" data-act="celia-micro" title="Parler à Célia" ' + (bloque ? 'disabled' : '') + '>' + ICONS.mic + '</button>' : '') +
              '<input class="se-input" name="texte" placeholder="Écrivez ou parlez…" value="' + esc(celiaBrouillon) + '" autocomplete="off" ' + (bloque ? 'disabled' : '') + '/>' +
              '<button class="se-btn sm" type="submit" ' + (bloque ? 'disabled' : '') + '>Envoyer</button>' +
            '</form>';
          })()
        ) +
      '</div>' +
    '</div>';
  }

  /* --------------------------------- réglages ----------------------------- */

  // ---- La Gazette : le mot du mois et le coup de cœur de l'agent ----
  function viewGazette() {
    const e = state.gazetteEdition;
    if (!e) {
      fetch('/api/gazette/edition').then((r) => r.json()).then((d) => { state.gazetteEdition = d; render(); }).catch(() => {});
      return head('Le Club', 'La Gazette', 'Chargement…');
    }
    const g = e.gazette || {};
    const mot = g.mot || {};
    const coup = g.coupDeCoeur || {};
    return head('Le Club', 'La Gazette', 'Le magazine du club, sur la page d’accueil des membres. Les chiffres (biens, membres, visites, record, quartier, bien du mois) se calculent seuls ; vous écrivez le mot du mois et choisissez votre coup de cœur.') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<form class="se-card" data-form="gazette-mot"><h3>Le mot du mois</h3>' +
          '<p class="se-hint" style="margin:6px 0 12px">Votre regard sur le marché, une tendance, une nouvelle du club. Laisser vide pour ne rien afficher.</p>' +
          '<div class="se-form-grid">' +
            '<div class="se-field full"><label>Titre</label><input class="se-input" name="titre" maxlength="120" value="' + esc(mot.titre || '') + '" placeholder="Ex. Paris rive gauche : les acheteurs reviennent"/></div>' +
            '<div class="se-field full"><label>Texte</label><textarea class="se-textarea" name="texte" maxlength="3000" style="min-height:170px">' + esc(mot.texte || '') + '</textarea></div>' +
          '</div>' +
          (mot.date ? '<p class="se-hint" style="margin-top:8px">Publié le ' + dFR(mot.date) + (mot.auteur ? ' par ' + esc(mot.auteur) : '') + '</p>' : '') +
          '<button class="se-btn" type="submit" style="margin-top:12px">Publier dans la Gazette</button></form>' +
        '<form class="se-card" data-form="gazette-coup"><h3>Le coup de cœur de l’agent</h3>' +
          '<p class="se-hint" style="margin:6px 0 12px">Un bien en ligne que vous voulez mettre en avant, avec une phrase.</p>' +
          '<div class="se-form-grid">' +
            '<div class="se-field full"><label>Bien</label><select class="se-select" name="bienId"><option value="">— Aucun —</option>' +
              (e.biens || []).map((b) => '<option value="' + esc(b.id) + '"' + (coup.bienId === b.id ? ' selected' : '') + '>' + esc(b.titre + (b.quartier ? ' · ' + b.quartier : '')) + '</option>').join('') + '</select></div>' +
            '<div class="se-field full"><label>Pourquoi ce bien</label><textarea class="se-textarea" name="phrase" maxlength="400" style="min-height:90px">' + esc(coup.phrase || '') + '</textarea></div>' +
          '</div>' +
          '<button class="se-btn" type="submit" style="margin-top:12px">Publier dans la Gazette</button></form>' +
      '</div>' + carteArticlesAuto();
  }

  // Articles rédigés automatiquement par Célia (marché immobilier, conseils).
  function carteArticlesAuto() {
    const A = state.gazetteArticles;
    if (!A) {
      if (!state.gazetteArticlesCharge) { state.gazetteArticlesCharge = true; chargerArticlesGazette(); }
      return '<div class="se-card" style="margin-top:18px"><h3>Articles automatiques</h3><p class="se-hint">Chargement…</p></div>';
    }
    const r = A.reglages || {};
    const enCours = state.gazetteRedaction;
    const statut = { publie: ['open', 'Publié'], a_valider: ['warn', 'À valider'], retire: ['', 'Retiré'] };
    const rub = { marche: 'Le marché', conseil: 'Conseil vendeur' };
    const opt = (v, cur, txt) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + txt + '</option>';
    return '<div class="se-card" style="margin-top:18px">' +
      '<h3>Articles automatiques</h3>' +
      '<p class="se-hint" style="margin:6px 0 14px">Célia rédige seule l’actualité du marché immobilier en France (taux, prix, ventes, mesures — avec les sources citées) et un conseil vendeur. Ils s’ajoutent à la Gazette des membres, en plus du bien à la une, des ventes récentes dans leur secteur et des chiffres du club.</p>' +
      (A.cle ? '' : '<div class="se-note" style="margin-bottom:12px">La clé Gemini (GEMINI_API_KEY) n’est pas configurée sur le serveur : aucun article ne peut être rédigé.</div>') +
      '<form class="se-form-grid" data-form="gazette-reglages">' +
        '<div class="se-field"><label>Rédaction automatique</label><select class="se-select" name="auto">' + opt('true', r.auto, 'Activée') + opt('false', r.auto, 'En pause') + '</select></div>' +
        '<div class="se-field"><label>Publication</label><select class="se-select" name="publication">' + opt('auto', r.publication, 'Directement dans la Gazette') + opt('validation', r.publication, 'Après ma validation') + '</select></div>' +
        '<div class="se-field"><label>Actualité du marché</label><select class="se-select" name="marcheJours">' + opt(2, r.marcheJours, 'Tous les 2 jours') + opt(3, r.marcheJours, 'Tous les 3 jours') + opt(7, r.marcheJours, 'Chaque semaine') + '</select></div>' +
        '<div class="se-field"><label>Conseil vendeur</label><select class="se-select" name="conseilJours">' + opt(7, r.conseilJours, 'Chaque semaine') + opt(14, r.conseilJours, 'Toutes les 2 semaines') + '</select></div>' +
        '<div class="se-field full" style="display:flex;flex-direction:row"><button class="se-btn soft" type="submit">Enregistrer les réglages</button></div>' +
      '</form>' +
      '<div class="se-actions" style="margin-top:14px">' +
        '<button class="se-btn" data-act="gazette-rediger" data-id="marche"' + (enCours || !A.cle ? ' disabled' : '') + '>' + (enCours === 'marche' ? 'Rédaction… (jusqu’à 1 min)' : 'Rédiger l’actualité du marché maintenant') + '</button>' +
        '<button class="se-btn ghost" data-act="gazette-rediger" data-id="conseil"' + (enCours || !A.cle ? ' disabled' : '') + '>' + (enCours === 'conseil' ? 'Rédaction…' : 'Rédiger un conseil vendeur') + '</button>' +
      '</div>' +
      '<div class="se-list" style="margin-top:16px">' +
        ((A.articles || []).length ? A.articles.slice(0, 30).map((a) => {
          const st = statut[a.statut] || ['', a.statut];
          const ouvert = state.gazetteArticleOuvert === a.id;
          return '<div class="se-list-item" style="flex-wrap:wrap;align-items:flex-start;gap:10px">' +
            '<div style="flex:1;min-width:220px"><div class="se-hint">' + esc(rub[a.rubrique] || '') + ' · ' + dFR(a.cree) + ' · <span class="se-badge ' + st[0] + '">' + st[1] + '</span></div>' +
              '<b style="display:block;margin-top:4px">' + esc(a.titre) + '</b><div class="se-hint" style="margin-top:2px">' + esc(a.chapo || '') + '</div></div>' +
            '<div class="se-actions">' +
              '<button class="se-btn ghost sm" data-act="gazette-article-ouvrir" data-id="' + a.id + '">' + (ouvert ? 'Fermer' : 'Lire / modifier') + '</button>' +
              (a.statut !== 'publie' ? '<button class="se-btn sm" data-act="gazette-article-statut" data-id="' + a.id + '" data-statut="publie">Publier</button>' : '<button class="se-btn ghost sm" data-act="gazette-article-statut" data-id="' + a.id + '" data-statut="retire">Retirer</button>') +
            '</div>' +
            (ouvert ? '<form data-form="gazette-article" data-id="' + a.id + '" style="flex:1 1 100%" class="se-form-grid">' +
                '<div class="se-field full"><label>Titre</label><input class="se-input" name="titre" maxlength="110" value="' + esc(a.titre) + '"/></div>' +
                '<div class="se-field full"><label>Chapô</label><input class="se-input" name="chapo" maxlength="260" value="' + esc(a.chapo || '') + '"/></div>' +
                '<div class="se-field full"><label>Texte</label><textarea class="se-textarea" name="texte" style="min-height:260px">' + esc(a.texte) + '</textarea></div>' +
                ((a.sources || []).length ? '<div class="se-field full"><label>Sources</label><div class="se-hint">' + a.sources.map((x) => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.titre) + '</a>').join(' · ') + '</div></div>' : '') +
                '<div class="se-field full" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:center"><button class="se-btn" type="submit">Enregistrer</button><button class="se-btn danger sm" type="button" data-act="gazette-article-suppr" data-id="' + a.id + '">Supprimer</button></div>' +
              '</form>' : '') +
          '</div>';
        }).join('') : '<p class="se-hint">Aucun article pour l’instant. Le premier arrive dans l’heure qui suit l’activation, ou tout de suite avec « Rédiger… ».</p>') +
      '</div></div>';
  }
  async function chargerArticlesGazette() {
    try { const r = await fetch('/api/gazette/articles', { credentials: 'same-origin' }); const d = await r.json(); if (r.ok) state.gazetteArticles = d; } catch (e) { /* hors ligne */ }
    state.gazetteArticlesCharge = false;
    render();
  }
  async function appelGazette(methode, url, corps) {
    const r = await fetch(url, { method: methode, headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: corps ? JSON.stringify(corps) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erreur');
    return d;
  }

  function viewReglages() {
    const a = state.agent;
    return head('Compte', 'Réglages', 'Votre agent, l’agence, et vos données.') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<form class="se-card" data-form="agent">' +
          '<h3>Agent</h3><div class="se-form-grid" style="margin-top:14px">' +
            '<div class="se-field"><label>Prénom</label><input class="se-input" name="prenom" value="' + esc(a.prenom) + '"/></div>' +
            '<div class="se-field"><label>Nom</label><input class="se-input" name="nom" value="' + esc(a.nom) + '"/></div>' +
            '<div class="se-field"><label>Email</label><input class="se-input" name="email" value="' + esc(a.email) + '"/></div>' +
            '<div class="se-field"><label>Téléphone</label><input class="se-input" name="tel" value="' + esc(a.tel) + '"/></div>' +
            '<div class="se-field full"><label>Agence</label><input class="se-input" name="agence" value="' + esc(a.agence) + '"/></div>' +
          '</div><button class="se-btn" type="submit" style="margin-top:16px">Enregistrer</button>' +
        '</form>' +
        '<div class="se-grid" style="gap:18px">' +
          '<div class="se-card"><h3>Données</h3><p class="se-muted">Tout est stocké dans ce navigateur.</p>' +
            '<div class="se-grid" style="margin-top:12px;gap:8px">' +
              '<button class="se-btn ghost block" data-act="export-clients">Exporter les clients (CSV)</button>' +
              '<button class="se-btn ghost block" data-act="export-biens">Exporter les biens (CSV)</button>' +
              '<button class="se-btn ghost block" data-act="export-json">Sauvegarde complète (JSON)</button>' +
              '<label class="se-btn ghost block" style="cursor:pointer">Restaurer un JSON<input type="file" accept="application/json" hidden data-upload="import"/></label>' +
              '<button class="se-btn danger block" data-act="reset">Réinitialiser le CRM</button>' +
            '</div>' +
          '</div>' +
          (state.moi && state.moi.role === 'superadmin' ? '<div class="se-card"><h3>Sauvegarde du serveur</h3><p class="se-muted">Toute la base (leads, biens, recherches, messages…) et toutes les photos et documents, en un fichier à garder chez vous. Contient des données personnelles : à conserver en lieu sûr.</p>' +
            '<a class="se-btn block" style="margin-top:12px" href="/api/admin/sauvegarde" download>Télécharger une sauvegarde complète</a></div>' : '') +
          '<div class="se-card"><h3>Accès</h3><p class="se-muted">Deux faces du même club.</p>' +
            '<a class="se-btn ghost block" style="margin-top:12px" href="espace.html">Espace membre</a>' +
            '<a class="se-btn ghost block" style="margin-top:8px" href="index.html">Site public</a>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* --------------------------------- agents -------------------------------- */
  // Réservé au super-admin (côté serveur, requireSuperadmin). Au 18/11/2026
  // personne n'a encore été invité (usage solo) — cette page sert à préparer
  // le passage à plusieurs agents sans avoir à retoucher le reste du CRM
  // plus tard : chaque agent invité ne verra que les clients qui lui sont
  // attribués ci-dessous (ou qu'il crée lui-même), et verra tous les biens
  // de la plateforme pour y chercher des correspondances avec ses clients.
  function viewAgents() {
    const agents = (state.agents || []).filter((a) => a.role !== 'superadmin');
    return head('Équipe', 'Agents', 'Chaque agent ne voit que ses propres clients, mais tous les biens de la plateforme.') +
      '<div class="se-grid cols-2" style="align-items:start">' +
        '<div class="se-card"><h3>Inviter un agent</h3>' +
        '<p class="se-hint" style="margin-top:4px">Il recevra un email avec un code de connexion. Il apparaît ci-contre dès l’envoi, avec le statut « Invitation en attente » jusqu’à sa première connexion.</p>' +
        '<form data-form="invite-agent" class="se-form-grid" style="margin-top:12px">' +
          '<div class="se-field"><label>Prénom</label><input class="se-input" name="prenom"/></div>' +
          '<div class="se-field"><label>Nom</label><input class="se-input" name="nom"/></div>' +
          '<div class="se-field full"><label>Email</label><input class="se-input" type="email" name="email" required/></div>' +
          '<div class="se-field full"><button class="se-btn" type="submit">Envoyer l’invitation</button></div>' +
        '</form></div>' +
        '<div class="se-card"><h3>Équipe (' + agents.length + ')</h3>' +
        (agents.length ? '<div class="se-list" style="margin-top:8px">' + agents.map((a) => (
          '<div class="se-row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--color-ligne)">' +
            '<div><div style="font-size:14px">' + esc((a.prenom + ' ' + a.nom).trim() || a.email) + '</div>' +
            '<div class="se-sub">' + esc(a.email) + ' · ' + (a.nbClients || 0) + ' client(s) · ' + (a.derniereConnexion ? 'connecté le ' + dFR(a.derniereConnexion) : 'jamais connecté') + '</div></div>' +
            '<span class="se-badge ' + (a.actif ? 'open' : 'warn') + '">' + (a.actif ? 'Actif' : 'Invitation en attente') + '</span>' +
          '</div>'
        )).join('') + '</div>' : '<p class="se-muted" style="margin-top:10px">Aucun agent pour l’instant — vous gérez seul toute la plateforme.</p>') +
        '</div>' +
      '</div>';
  }

  /* ================================ modales =============================== */

  function field(label, name, value, opts) {
    const o = opts || {};
    return '<div class="se-field ' + (o.full ? 'full' : '') + '"><label>' + label + '</label>' +
      (o.type === 'select'
        ? '<select class="se-select" name="' + name + '">' + o.options.map((x) => '<option value="' + esc(x.value) + '"' + (String(x.value) === String(value) ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select>'
        : o.type === 'textarea'
          ? '<textarea class="se-textarea" name="' + name + '" placeholder="' + esc(o.placeholder || '') + '">' + esc(value) + '</textarea>'
          : '<input class="se-input" name="' + name + '" type="' + (o.type || 'text') + '"' + (o.step ? ' step="' + o.step + '"' : '') + ' value="' + esc(value) + '" placeholder="' + esc(o.placeholder || '') + '"/>') +
      '</div>';
  }

  /* ------------------------- archivage & historique ------------------------- */
  const CLE_ARCHIVE = { lead: 'clients', bien: 'biens', recherche: 'recherches' };
  const NOM_FICHE = { lead: 'ce lead', bien: 'ce bien', recherche: 'cette recherche' };
  const ficheDe = (kind, id) => (kind === 'lead' ? client(id) : kind === 'bien' ? bien(id) : recherche(id));
  const nomFiche = (kind, f) => (!f ? '—' : kind === 'lead' ? nomClient(f) : (f.titre || (kind === 'bien' ? 'Bien' : 'Recherche')));
  const estArchivee = (kind, f) => !!f && (f.archive || archivees(CLE_ARCHIVE[kind]).indexOf(f) > -1);
  const dateHeure = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  function boutonArchiver(kind, id) {
    return '<button class="se-btn ghost se-btn-archiver" type="button" data-act="archiver-demander" data-kind="' + kind + '" data-id="' + esc(id) + '">Archiver</button>';
  }
  function bandeauArchive(kind, f) {
    if (!estArchivee(kind, f)) return '';
    return '<div class="se-archive-bandeau"><div><b>Fiche archivée</b>' + (f.archiveLe ? ' le ' + esc(dateHeure(f.archiveLe)) : '') + (f.archivePar ? ' par ' + esc(f.archivePar) : '') +
      '<div class="se-hint">Elle n’apparaît plus dans les listes, ni sur la plateforme, ni dans le matching. Rien n’a été supprimé.</div></div>' +
      '<button class="se-btn sm" data-act="restaurer" data-kind="' + kind + '" data-id="' + esc(f.id) + '">Restaurer</button></div>';
  }
  function archiveModal(kind, id) {
    const f = ficheDe(kind, id);
    const recs = kind === 'lead' && f ? ((state.recherchesServeur || []).concat(state.recherches)).filter((x) => x.clientId === f.id) : [];
    return '<h3>Archiver ' + NOM_FICHE[kind] + ' ?</h3>' +
      '<p class="se-muted">« ' + esc(nomFiche(kind, f)) + ' » quitte les listes' + (kind === 'bien' ? ', la plateforme' : '') + (kind !== 'lead' ? ' et le matching' : '') + '. Rien n’est supprimé : la fiche reste consultable dans l’onglet <b>Archivés</b>, avec son historique, et peut être restaurée à tout moment.</p>' +
      (recs.length ? '<label class="se-row" style="gap:8px;margin-top:14px;align-items:flex-start"><input type="checkbox" data-archive-recherches checked/> <span>Archiver aussi ' + (recs.length > 1 ? 'ses ' + recs.length + ' recherches' : 'sa recherche') + ' (sinon elle' + (recs.length > 1 ? 's continuent' : ' continue') + ' de recevoir des biens compatibles)</span></label>' : '') +
      (kind === 'lead' && f && f.serverId && estCandidatOuMembre(f) ? '<p class="se-hint" style="margin-top:10px">Son accès membre à la plateforme n’est pas modifié : utilisez « Suspendre » sur sa fiche si besoin.</p>' : '') +
      '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="button" data-act="archiver-confirmer" data-kind="' + kind + '" data-id="' + esc(id) + '">Archiver</button></div>';
  }
  async function archiverFiche(kind, id, archiver, avecRecherches) {
    const f = ficheDe(kind, id);
    if (!f) { toast('Fiche introuvable.', 'warn'); return false; }
    const auteur = ((state.agent && (state.agent.prenom + ' ' + state.agent.nom)) || 'Agent').trim();
    if (f.serverId) {
      try {
        const r = await fetch('/api/archives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: kind, id: f.serverId, archive: archiver, avecRecherches: !!avecRecherches }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Erreur serveur');
      } catch (e) { toast('Erreur : ' + (e.message || 'serveur'), 'warn'); return false; }
    }
    // Fiches locales (et recherches locales d'un lead archivé) : déplacées entre liste et archives.
    const deplacer = (k, x) => {
      const cle = CLE_ARCHIVE[k];
      if (x.serverId) return;
      const depuis = archiver ? state[cle] : state.archives[cle];
      const vers = archiver ? state.archives[cle] : state[cle];
      const i = depuis.indexOf(x);
      if (i > -1) depuis.splice(i, 1);
      if (vers.indexOf(x) === -1) vers.push(x);
      if (archiver) { x.archive = true; x.archiveLe = nowISO(); x.archivePar = auteur; } else { delete x.archive; }
      state.journal.push({ kind: k, id: x.id, leadLocalId: k === 'lead' ? x.id : (x.clientId || x.proprietaireId || null), type: archiver ? 'archive' : 'restauration', auteur: auteur, at: nowISO() });
    };
    deplacer(kind, f);
    if (kind === 'lead' && avecRecherches) state.recherches.filter((x) => x.clientId === f.id && !x.serverId).forEach((x) => deplacer('recherche', x));
    if (f.serverId || (kind === 'lead' && avecRecherches)) { try { await syncServeur(); } catch (e) { /* liste rafraîchie au prochain chargement */ } }
    return true;
  }
  const CHAMPS_LOCAUX = {
    lead: { prenom: 'Prénom', nom: 'Nom', email: 'Email', tel: 'Téléphone', adresse: 'Adresse', civilite: 'Civilité', natureLead: 'Le lead est', raisonSociale: 'Raison sociale', siren: 'SIREN', type: 'Type', statut: 'Statut', source: 'Source', notes: 'Notes' },
    bien: { titre: 'Titre', adresse: 'Adresse', type: 'Type', quartier: 'Quartier', statut: 'Statut', surface: 'Surface', pieces: 'Pièces', chambres: 'Chambres', sdb: 'Salles de bain', etage: 'Étage', dpe: 'DPE', ges: 'GES', prix: 'Prix net vendeur', description: 'Description' },
    recherche: { titre: 'Intitulé', types: 'Types', quartiers: 'Secteurs', prixMin: 'Budget min', prixMax: 'Budget max', piecesMin: 'Pièces min', chambresMin: 'Chambres min', surfaceMin: 'Surface min', surfaceMax: 'Surface max', dpe: 'DPE', epoque: 'Époque' }
  };
  function journaliserLocal(kind, avant, apres) {
    const val = (v) => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : String(v).slice(0, 140));
    const lib = CHAMPS_LOCAUX[kind];
    const detail = Object.keys(lib).filter((k) => val(avant[k]) !== val(apres[k])).map((k) => ({ champ: k, libelle: lib[k], avant: val(avant[k]), apres: val(apres[k]) }));
    if (!detail.length) return;
    state.journal.push({ kind: kind, id: avant.id, leadLocalId: kind === 'lead' ? avant.id : (avant.clientId || avant.proprietaireId || null), type: 'modification', auteur: ((state.agent && (state.agent.prenom + ' ' + state.agent.nom)) || 'Agent').trim(), at: nowISO(), detail: detail });
  }
  const valHisto = (v, champ) => (v === undefined || v === null || v === '' ? '—' : ['prix', 'prixMin', 'prixMax', 'budgetMin', 'budgetMax', 'apport', 'charges'].indexOf(champ) > -1 && /^\d+$/.test(String(v)) ? Number(v).toLocaleString('fr-FR') + ' €' : String(v));
  function historiqueModal(kind, id, chargement) {
    const f = ficheDe(kind, id);
    const sid = f && f.serverId;
    const serveur = (state.activites || []).filter((a) => sid && (kind === 'lead' ? a.leadId === sid : kind === 'bien' ? a.bienId === sid : a.rechercheId === sid));
    const locaux = (state.journal || []).filter((j) => f && (j.id === f.id && j.kind === kind || (kind === 'lead' && j.leadLocalId === f.id)));
    const tout = serveur.concat(locaux).sort((a, b) => new Date(b.at) - new Date(a.at));
    const contexte = (a) => {
      if (kind !== 'lead') return '';
      if (a.rechercheId || a.kind === 'recherche') return '<span class="se-pill">Recherche</span>';
      if (a.bienId || a.kind === 'bien') return '<span class="se-pill">Bien</span>';
      return '';
    };
    const ligne = (a) => '<li class="se-histo-item">' +
      '<div class="se-histo-tete"><b>' + esc((ACTIVITE[a.type] || { label: a.type }).label) + '</b>' + contexte(a) + '</div>' +
      '<div class="se-hint">' + esc(dateHeure(a.at)) + (a.auteur ? ' · ' + esc(a.auteur) : '') + '</div>' +
      ((a.detail || []).length ? '<ul class="se-histo-detail">' + a.detail.map((d) => '<li><span>' + esc(d.libelle) + '</span> ' + '<s>' + esc(valHisto(d.avant, d.champ)) + '</s> → <b>' + esc(valHisto(d.apres, d.champ)) + '</b></li>').join('') + '</ul>' : '') +
      '</li>';
    return '<h3>Historique</h3><p class="se-muted">' + esc(nomFiche(kind, f)) + (kind === 'lead' ? ' · y compris ses recherches et ses biens' : '') + '</p>' +
      (chargement ? '<p class="se-muted" style="margin-top:14px">Chargement…</p>'
        : tout.length ? '<ul class="se-histo">' + tout.map(ligne).join('') + '</ul>'
        : '<p class="se-muted" style="margin-top:14px">Aucune action enregistrée pour l’instant. Les prochaines modifications, archivages et restaurations apparaîtront ici.</p>') +
      '<div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Fermer</button></div>';
  }
  function viewArchives(kind) {
    const list = archivees(CLE_ARCHIVE[kind]).slice().sort((a, b) => String(b.archiveLe || '').localeCompare(String(a.archiveLe || '')));
    const lien = (f) => '#/' + (kind === 'lead' ? 'client' : kind) + '/' + f.id;
    const sous = (f) => kind === 'lead' ? esc(f.email || f.tel || '')
      : kind === 'bien' ? esc([f.type, qLabel(f.quartier), f.prix ? euro(f.prix) : ''].filter(Boolean).join(' · '))
      : esc([nomClient(client(f.clientId)), f.prixMax ? '≤ ' + euro(f.prixMax) : ''].filter((x) => x && x !== '—').join(' · '));
    if (!list.length) return '<div class="se-card se-empty"><div class="se-empty-title">Aucune fiche archivée</div><p class="se-muted">Pour archiver, ouvrez une fiche, cliquez sur « Modifier » puis « Archiver ».</p></div>';
    return '<div class="se-card" style="padding:6px 16px"><div class="se-list">' + list.map((f) => '<div class="se-list-item se-archive-ligne">' +
      '<a href="' + lien(f) + '" style="flex:1;min-width:0;text-decoration:none;color:inherit"><div style="font-size:14px">' + esc(nomFiche(kind, f)) + '</div>' +
        '<div class="se-sub">' + sous(f) + '</div>' +
        '<div class="se-hint">Archivé' + (kind === 'recherche' ? 'e' : '') + (f.archiveLe ? ' le ' + esc(dateHeure(f.archiveLe)) : '') + (f.archivePar ? ' par ' + esc(f.archivePar) : '') + '</div></a>' +
      '<div class="se-row" style="gap:6px;flex-wrap:wrap"><button class="se-btn ghost sm" data-act="historique" data-kind="' + kind + '" data-id="' + esc(f.id) + '">Historique</button>' +
      '<button class="se-btn sm" data-act="restaurer" data-kind="' + kind + '" data-id="' + esc(f.id) + '">Restaurer</button></div>' +
    '</div>').join('') + '</div></div>';
  }
  function ongletsArchive(cle, valeur, nbActifs, nbArchives, libelle) {
    return '<div class="se-tabs" style="margin-bottom:18px">' +
      '<a href="#" data-act="filtre" data-id="' + cle + ':" class="' + (valeur !== 'archives' ? 'active' : '') + '">' + libelle + '<span>' + nbActifs + '</span></a>' +
      '<a href="#" data-act="filtre" data-id="' + cle + ':archives" class="' + (valeur === 'archives' ? 'active' : '') + '">Archivés<span>' + nbArchives + '</span></a>' +
    '</div>';
  }

  function estSocieteLead(c) { return !!c && (c.natureLead === 'societe' || c.natureLead === 'sci'); }
  function clientModal(c) {
    const v = c || { type: 'acquereur', natureLead: 'personne', civilite: '', prenom: '', nom: '', email: '', tel: '', adresse: '', raisonSociale: '', siren: '', representant: '', statut: 'prospect', source: 'Candidature', notes: '', agent: state.agent.prenom + ' ' + state.agent.nom };
    return '<h3>' + (c ? 'Modifier le lead' : 'Nouveau lead') + '</h3><p class="se-muted">L’identité du lead. Ce qu’il recherche se renseigne à part, dans sa (ou ses) recherche(s).</p>' +
      '<form data-form="client" data-id="' + (c ? c.id : '') + '"><div class="se-form-grid">' +
        field('Type', 'type', v.type, { type: 'select', options: [{ value: 'acquereur', label: 'Acquéreur' }, { value: 'vendeur', label: 'Vendeur' }, { value: 'mixte', label: 'Acheteur & vendeur' }] }) +
        field('Statut', 'statut', v.statut, { type: 'select', options: Object.keys(ST_CLIENT).map((k) => ({ value: k, label: ST_CLIENT[k].label })) }) +
        field('Le lead est', 'natureLead', estSocieteLead(v) ? (v.natureLead === 'sci' ? 'sci' : 'societe') : 'personne', { type: 'select', options: [{ value: 'personne', label: 'Une personne' }, { value: 'sci', label: 'Une SCI' }, { value: 'societe', label: 'Une société (SARL, SAS…)' }] }) +
        // Société : son identité, puis la personne qui la représente (toujours renseignée).
        '<div class="se-field full se-bloc-societe" data-si-societe' + (estSocieteLead(v) ? '' : ' hidden') + '><div class="se-form-grid">' +
          field('Raison sociale', 'raisonSociale', v.raisonSociale || '', { placeholder: 'SCI Les Tilleuls' }) +
          field('SIREN', 'siren', v.siren || '', { placeholder: '552032534' }) +
          field('Qualité du représentant', 'representant', v.representant || '', { full: true, placeholder: 'Gérant, associé, président…' }) +
        '</div></div>' +
        '<div class="se-field full"><p class="se-hint" data-libelle-personne style="margin:4px 0 0">' + (estSocieteLead(v) ? 'La personne qui représente la société (c’est elle que vous contactez) :' : 'La personne :') + '</p></div>' +
        field('Civilité', 'civilite', v.civilite || '', { type: 'select', options: [{ value: '', label: 'Non précisée' }, { value: 'homme', label: 'Homme' }, { value: 'femme', label: 'Femme' }] }) +
        field('Prénom', 'prenom', v.prenom) + field('Nom', 'nom', v.nom) +
        field('Email', 'email', v.email, { type: 'email' }) + field('Téléphone', 'tel', v.tel) +
        field('Adresse', 'adresse', v.adresse || '', { full: true, placeholder: '12 rue de la Paix, 75002 Paris' }) +
        field('Source', 'source', v.source, { type: 'select', options: ['Candidature', 'Site web', 'Instagram', 'Recommandation', 'Bouche à oreille', 'Portail'].map((s) => ({ value: s, label: s })) }) +
        field('Notes', 'notes', v.notes, { type: 'textarea', full: true, placeholder: 'Ce qu’il faut retenir de ce lead…' }) +
      '</div><div class="se-modal-foot">' + (c ? boutonArchiver('lead', c.id) : '') + '<button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">' + (c ? 'Enregistrer' : 'Créer le lead') + '</button></div></form>';
  }

  function bienModal(b, proprietaireId) {
    const v = b || { ref: 'SC-' + Math.floor(1000 + Math.random() * 8999), titre: '', adresse: '', type: 'Appartement', quartier: 'p11', surface: '', pieces: '', chambres: '', sdb: '', etage: '', dpe: 'D', prix: '', statut: 'brouillon', proprio: proprietaireId || '', description: '', atouts: [], photos: [] };
    return '<h3>' + (b ? 'Modifier le bien' : 'Nouveau bien') + '</h3><p class="se-muted">Référence, mandat et photos. Le propriétaire (lead) est obligatoire — c’est lui qui porte le mandat.</p>' +
      '<form data-form="bien" data-id="' + (b ? b.id : '') + '"><div class="se-form-grid">' +
        (state.clients.length
          ? field('Propriétaire', 'proprio', v.proprio || (b && b.proprietaireId) || '', { type: 'select', options: state.clients.map((c) => ({ value: c.id, label: nomClient(c) })) })
          : '<div class="se-field full"><label>Propriétaire</label><p class="se-muted">Aucun lead enregistré. <button type="button" class="se-btn ghost sm" data-act="client-nouveau">' + ICONS.plus + ' Créer le propriétaire</button></p></div>') +
        field('Référence', 'ref', v.ref) +
        field('Adresse', 'adresse', v.adresse, { full: true, placeholder: '12 rue de la Verrerie, Paris 4e' }) +
        field('Type', 'type', v.type, { type: 'select', options: TYPES.map((t) => ({ value: t, label: t })) }) +
        field('Quartier', 'quartier', v.quartier, { type: 'select', options: QUARTIERS.map((q) => ({ value: q.id, label: q.label })) }) +
        field('Statut', 'statut', v.statut === 'mandat' ? 'brouillon' : v.statut, { type: 'select', options: ST_BIEN_CHOIX().map((k, i) => ({ value: k, label: (i + 1) + '. ' + ST_BIEN[k].label })) }) +
        '<div class="se-field full"><p class="se-hint" data-aide-statut style="margin:0">' + esc((ST_BIEN[v.statut === 'mandat' ? 'brouillon' : v.statut] || {}).aide || '') + ' Passer en Avant-première ou En vente valide le bien et le publie sur la plateforme.</p></div>' +
        '<div class="se-field" data-si-vendu' + (v.statut === 'vendu' ? '' : ' hidden') + '><label>Vendu par Seecret ?</label>' +
          '<select class="se-select" name="venduParAgence"><option value="">— Choisir —</option>' +
          '<option value="oui"' + (v.venduParAgence === true ? ' selected' : '') + '>Oui, vendu par l’agence</option>' +
          '<option value="non"' + (v.venduParAgence === false ? ' selected' : '') + '>Non, vendu ailleurs / retiré</option></select>' +
          '<span class="se-hint">Seule une vente par Seecret donne au propriétaire le taux réduit sur ses achats.</span></div>' +
        field('Titre', 'titre', v.titre, { full: true, placeholder: 'Quatre pièces sur la Seine' }) +
        field('Surface (m²)', 'surface', v.surface, { type: 'number' }) +
        field('Pièces', 'pieces', v.pieces, { type: 'number' }) +
        field('Chambres', 'chambres', v.chambres, { type: 'number' }) +
        field('Salles de bain', 'sdb', v.sdb, { type: 'number' }) +
        field('Étage', 'etage', v.etage, { type: 'number', placeholder: '0 = RDC' }) + field('DPE', 'dpe', v.dpe, { type: 'select', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((d) => ({ value: d, label: d })) }) +
        field('GES', 'ges', v.ges || '', { type: 'select', options: [{ value: '', label: 'Non renseigné' }].concat(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((d) => ({ value: d, label: d }))) }) +
        field('Année de construction', 'anneeConstruction', v.anneeConstruction || '', { type: 'number', placeholder: '1975' }) +
        field('État', 'etat', v.etat || '', { type: 'select', options: [{ value: '', label: 'Non renseigné' }].concat(['À rénover', 'Bon état', 'Rénové'].map((d) => ({ value: d, label: d }))) }) +
        field('Extérieur', 'exterieur', v.exterieur || '', { type: 'select', options: [{ value: '', label: 'Aucun' }].concat(['Balcon', 'Terrasse', 'Jardin'].map((d) => ({ value: d, label: d }))) }) +
        field('Surface extérieure (m²)', 'surfaceExterieur', v.surfaceExterieur || '', { type: 'number' }) +
        field('Charges annuelles (€)', 'charges', v.charges || '', { type: 'number' }) +
        '<div class="se-field"><label>Ascenseur</label><label class="se-row" style="gap:6px;margin-top:6px"><input type="checkbox" name="ascenseur" ' + (v.ascenseur ? 'checked' : '') + '/> L’immeuble a un ascenseur</label></div>' +
        field('Prix net vendeur (€)', 'prix', v.prix, { type: 'number' }) +
        field('Honoraires acquéreur (%)', 'tauxHonoraires', (v.tauxHonoraires === null || v.tauxHonoraires === undefined) ? '' : v.tauxHonoraires, { type: 'number', step: 'any', placeholder: 'Barème : ' + tauxTxt(BAREME.acq) + ' %' }) +
        field('Description', 'description', v.description, { type: 'textarea', full: true }) +
      '</div><div class="se-modal-foot">' + (b ? boutonArchiver('bien', b.id) : '') + '<button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">' + (b ? 'Enregistrer' : 'Créer le bien') + '</button></div></form>';
  }

  function rechercheModal(r, clientId) {
    const v = r || {
      clientId: clientId || (state.clients.filter((c) => c.type !== 'vendeur')[0] && state.clients.filter((c) => c.type !== 'vendeur')[0].id),
      titre: '', types: [], prixMin: 0, prixMax: 2000000, piecesMin: 3, chambresMin: 0, sdbMin: 0, surfaceMin: 80, surfaceMax: 0,
      etageMin: 0, etageMax: 0, dernierEtageOk: false, dpe: '', epoque: '', quartiers: [], alertes: true
    };
    const typesSelectionnes = (v.types && v.types.length) ? v.types : (v.type ? [v.type] : []);
    // Le lead actuel de la recherche est TOUJOURS proposé (et sélectionné), même
    // vendeur ou archivé : sinon le menu affichait le premier nom de la liste et
    // l'enregistrement rattachait la recherche à une autre personne.
    const actuel = v.clientId ? (client(v.clientId) || state.clients.find((c) => c.serverId === v.clientId) || archivees('clients').find((c) => c.serverId === v.clientId)) : null;
    if (actuel) v.clientId = actuel.id;
    const libelleLead = (c) => nomClient(c) + (c.email ? ' · ' + c.email : c.tel ? ' · ' + c.tel : '') + (c.type === 'vendeur' ? ' (vendeur)' : '') + (c.demo || /^c\d+$/.test(c.id) ? ' (démo)' : '');
    let chercheurs = state.clients.filter((c) => c.type !== 'vendeur');
    if (actuel && chercheurs.indexOf(actuel) === -1) chercheurs = [actuel].concat(chercheurs);
    else if (actuel) chercheurs = [actuel].concat(chercheurs.filter((c) => c !== actuel));
    const optionsLead = chercheurs.map((c) => ({ value: c.id, label: libelleLead(c) }));
    if (r && v.clientId && !actuel) optionsLead.unshift({ value: v.clientId, label: 'Lead actuel (fiche introuvable sur cet appareil)' });
    return '<h3>' + (r ? 'Modifier la recherche' : 'Nouvelle recherche') + '</h3><p class="se-muted">Le CRM confrontera ces critères au portefeuille et aux données publiques (DPE ADEME).</p>' +
      '<form data-form="recherche" data-id="' + (r ? r.id : '') + '"><div class="se-form-grid">' +
        (optionsLead.length
          ? field('Lead', 'clientId', v.clientId, { type: 'select', options: optionsLead })
          : '<div class="se-field full"><label>Lead</label><p class="se-muted">Aucun lead acquéreur/mixte enregistré. <button type="button" class="se-btn ghost sm" data-act="client-nouveau">' + ICONS.plus + ' Créer le lead</button></p></div>') +
        '<div class="se-field full"><div class="se-row" style="justify-content:flex-end"><button type="button" class="se-btn ghost sm" data-act="client-nouveau">' + ICONS.plus + ' Nouveau lead</button></div></div>' +
        field('Intitulé', 'titre', v.titre, { full: true, placeholder: 'Trois pièces et plus, rive gauche' }) +
        '<div class="se-field full"><label>Type(s) de bien</label><div class="se-chips">' +
          TYPES.map((t) => '<button type="button" class="se-chip" data-act="q-toggle" data-group="types" data-id="' + esc(t) + '" aria-pressed="' + (typesSelectionnes.indexOf(t) > -1) + '">' + esc(t) + '</button>').join('') +
        '</div><p class="se-hint">Aucune case cochée = tous types acceptés.</p></div>' +
        field('Budget min (€)', 'prixMin', v.prixMin || '', { type: 'number' }) +
        field('Budget max (€)', 'prixMax', v.prixMax, { type: 'number' }) +
        field('Pièces min', 'piecesMin', v.piecesMin, { type: 'number' }) +
        field('Chambres min', 'chambresMin', v.chambresMin || '', { type: 'number' }) +
        field('Salles de bain min', 'sdbMin', v.sdbMin || '', { type: 'number' }) +
        field('Surface min (m²)', 'surfaceMin', v.surfaceMin, { type: 'number' }) +
        field('Surface max (m²)', 'surfaceMax', v.surfaceMax || '', { type: 'number' }) +
        field('Étage min', 'etageMin', v.etageMin || '', { type: 'number' }) +
        field('Étage max', 'etageMax', v.etageMax || '', { type: 'number' }) +
        field('DPE (classe acceptée)', 'dpe', v.dpe || '', { type: 'select', options: [{ value: '', label: 'Indifférent' }].concat(DPE_ORDER.map((c) => ({ value: c, label: c + ' ou mieux' }))) }) +
        field('Époque (ancien/récent)', 'epoque', v.epoque || '', { type: 'select', options: [{ value: '', label: 'Indifférent' }].concat(EPOQUES.map((e) => ({ value: e.id, label: e.label }))) }) +
        '<div class="se-field"><label>Dernier étage</label><label class="se-row" style="gap:6px;margin-top:6px"><input type="checkbox" name="dernierEtageOk" ' + (v.dernierEtageOk ? 'checked' : '') + '/> Dernier étage accepté (voire recherché)</label></div>' +
        '<div class="se-field full"><label>Secteurs</label><div class="se-chips">' +
          QUARTIERS.map((q) => '<button type="button" class="se-chip" data-act="q-toggle" data-group="quartiers" data-id="' + q.id + '" aria-pressed="' + ((v.quartiers || []).indexOf(q.id) > -1) + '">' + q.label + '</button>').join('') +
        '</div><p class="se-hint">Aucun secteur coché = tous secteurs acceptés.</p></div>' +
      '</div><div class="se-modal-foot">' + (r ? boutonArchiver('recherche', r.id) : '') + '<button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">' + (r ? 'Enregistrer' : 'Créer la recherche') + '</button></div></form>';
  }

  // Petites modales de « suite logique » : après la création d'un lead, d'un
  // bien ou d'une recherche, on propose l'étape suivante cohérente plutôt que
  // de forcer l'agent à y penser lui-même (lead → bien/recherche, bien → sa
  // recherche si le propriétaire est aussi acquéreur).
  function suiteLeadModal(c) {
    const peutVendre = c.type === 'vendeur' || c.type === 'mixte';
    const peutChercher = c.type === 'acquereur' || c.type === 'mixte';
    return '<h3>Lead créé</h3><p class="se-muted">' + esc(nomClient(c)) + ' est enregistré. Étape suivante ?</p>' +
      '<div class="se-modal-foot" style="flex-wrap:wrap;gap:8px;justify-content:flex-start">' +
        (peutVendre ? '<button class="se-btn" data-act="suite-bien" data-id="' + c.id + '">' + ICONS.plus + ' Créer son bien à vendre</button>' : '') +
        (peutChercher ? '<button class="se-btn' + (peutVendre ? ' ghost' : '') + '" data-act="suite-recherche" data-id="' + c.id + '">' + ICONS.plus + ' Créer sa recherche</button>' : '') +
        '<button class="se-btn ghost" data-act="suite-plus-tard-lead" data-id="' + c.id + '">Plus tard, voir sa fiche</button>' +
      '</div>';
  }

  function suiteBienModal(b, c) {
    return '<h3>Bien créé</h3><p class="se-muted">' + esc(nomClient(c)) + ', propriétaire de « ' + esc(b.titre) + ' », est aussi acquéreur. Créer sa recherche maintenant ?</p>' +
      '<div class="se-modal-foot">' +
        '<button class="se-btn" data-act="suite-recherche" data-id="' + c.id + '">' + ICONS.plus + ' Créer sa recherche</button>' +
        '<button class="se-btn ghost" data-act="suite-plus-tard-bien" data-id="' + b.id + '">Plus tard, voir le bien</button>' +
      '</div>';
  }

  function previewModal(bienId, clientId, tab) {
    const b = bien(bienId);
    const c = client(clientId);
    const t = tab || 'email';
    const pdf = b ? ('/api/biens/' + (b.serverId || b.id) + '/pdf') : '';
    const msgDefaut = 'Bonjour ' + (c ? c.prenom : '') + ', voici un bien qui correspond à votre recherche : ' + (b ? b.titre : '') + ' — ' + (b ? euro(haiPour(b, c)) + ' honoraires inclus' : '') + (b && b.quartier ? ' (' + (QUARTIERS.find((q) => q.id === b.quartier) || {}).label + ')' : '') + '. Souhaitez-vous le visiter ? L’adresse vous sera communiquée à la confirmation de la visite.';
    const msg = state.__previewMsg !== undefined ? state.__previewMsg : msgDefaut;
    const ph = photo(b);
    const photos = (b && b.photos) || [];
    const pdfName = 'Fiche_Seecret_' + (b ? (b.titre || 'Bien').replace(/[^a-z0-9]+/gi, '_') : 'Bien') + '.pdf';
    const tabBtn = (id, label) => '<button class="se-studio-tab' + (t === id ? ' active' : '') + '" data-act="preview-tab" data-tab="' + id + '" data-bien="' + bienId + '" data-client="' + clientId + '">' + label + '</button>';

    const emailView = '<div class="se-mail-preview">' +
      '<div class="se-mail-top">' +
        '<div class="se-mail-from">Bonjour Seecret <small>&lt;contact.immogroupe@gmail.com&gt;</small></div>' +
        '<div class="se-mail-subject">Objet : Découvrez ce bien exceptionnel</div>' +
      '</div>' +
      '<div class="se-mail-body" style="padding:24px">' +
        '<div style="max-width:560px;margin:0 auto">' +
          '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#3b2b4a;font-weight:600;">Seecret</div>' +
          '<h2 style="font-family:Georgia,serif;font-weight:400;font-size:26px;color:#141210;margin:14px 0 0;">' + esc(b ? b.titre : '') + '</h2>' +
          '<p style="color:#5f5a54;margin:12px 0 0;line-height:1.6;">' + esc(msg) + '</p>' +
          (b ? '<div style="margin-top:20px;display:flex;align-items:center;gap:14px;border:1px solid #eeebe6;border-radius:14px;padding:12px;background:#fff">' + (ph ? '<img src="' + ph + '" style="width:72px;height:54px;object-fit:cover;border-radius:8px"/>' : '') + '<div><div style="font-weight:500">' + esc(b.titre) + '</div><div style="color:#5f5a54;font-size:13px">' + euro(haiPour(b, c)) + ' HAI' + (b.surface ? ' · ' + b.surface + ' m²' : '') + '</div></div></div>' : '') +
          '<div style="margin-top:22px"><span style="display:inline-block;background:#241c2e;color:#fff;padding:13px 28px;border-radius:999px;font-size:14px;">Voir le bien sur Seecret</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="se-mail-attach"><span>📎</span> ' + esc(pdfName) + ' <span class="se-hint">(PDF)</span></div>' +
    '</div>';

    const waView = '<div class="se-wa-preview">' +
      '<div class="se-wa-head">' + esc(c ? nomClient(c) : 'Client') + '</div>' +
      '<div class="se-wa-chat">' +
        '<div class="se-wa-bubble">' + esc(msg) + '</div>' +
        (b ? '<div class="se-wa-card">' + (ph ? '<img src="' + ph + '" alt=""/>' : '') + '<div class="se-wa-card-body"><div style="font-weight:600">' + esc(b.titre) + '</div><div>' + euro(haiPour(b, c)) + ' HAI' + (b.surface ? ' · ' + b.surface + ' m²' : '') + '</div><div style="color:#027eb5;margin-top:4px;word-break:break-all">' + esc(pdf) + '</div></div></div>' : '') +
      '</div>' +
    '</div>';

    const pdfRows = [['Prix honoraires inclus', b ? euro(haiPour(b, null)) : '—'], ['Surface', b && b.surface ? b.surface + ' m²' : '—'], ['Pièces', b && b.pieces ? b.pieces : '—'], ['Chambres', b && b.chambres != null ? b.chambres : '—'], ['Salles de bain', b && b.sdb != null ? b.sdb : '—'], ['Étage', b && b.etage != null ? (b.etage === 0 ? 'RDC' : b.etage) : '—'], ['DPE', b && b.dpe ? b.dpe : '—'], ['GES', b && b.ges ? b.ges : '—']];
    const pdfView = '<div class="se-pdf-preview">' +
      '<div class="se-pdf-head"><div class="se-pdf-logo">SEECRET</div><div class="se-pdf-tag">Fiche confidentielle</div></div>' +
      '<div class="se-pdf-body">' +
        (ph ? '<img class="se-pdf-hero" src="' + ph + '" alt=""/>' : '') +
        (photos.length > 1 ? '<div class="se-pdf-thumbs">' + photos.slice(1, 5).map((p) => '<img src="' + (/^(data:|https?:|\/)/.test(p) ? p : 'assets/img/' + p) + '" alt=""/>').join('') + '</div>' : '') +
        '<div class="se-pdf-title">' + esc(b ? b.titre : '') + '</div>' +
        '<div style="color:#5f5a54;margin-top:6px">' + esc(b && b.adresse ? b.adresse : '') + '</div>' +
        '<table class="se-pdf-table">' + pdfRows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</table>' +
        (b && b.description ? '<p style="line-height:1.7;color:#4e4759;font-size:14.5px">' + esc(b.description) + '</p>' : '') +
        '<div class="se-pdf-foot">Document strictement confidentiel. Voir sur Seecret pour plus d\'informations.</div>' +
      '</div>' +
    '</div>';

    return '<div class="se-studio">' +
      '<div class="se-studio-head"><h3>Studio d\'envoi</h3><div class="se-studio-tabs">' + tabBtn('email', 'Aperçu de l\'Email') + tabBtn('whatsapp', 'Aperçu WhatsApp') + tabBtn('pdf', 'Fiche Produit (PDF)') + '</div></div>' +
      '<div class="se-studio-body">' + (t === 'whatsapp' ? waView : t === 'pdf' ? pdfView : emailView) + '</div>' +
      '<div class="se-studio-msg"><label>Message (modifiable)</label><textarea id="preview-msg">' + esc(msg) + '</textarea></div>' +
      '<div class="se-studio-foot">' +
        '<button class="se-btn ghost" data-act="modal-close">Annuler</button>' +
        '<button class="se-btn ghost" data-act="preview-wa" data-client="' + clientId + '">Envoyer par WhatsApp</button>' +
        '<button class="se-btn" data-act="preview-email" data-bien="' + bienId + '" data-client="' + clientId + '">Envoyer par Email</button>' +
      '</div>' +
    '</div>';
  }

  function visiteModal(opts) {
    const o = opts || {};
    const today = new Date().toISOString().slice(0, 10);
    return '<h3>Planifier une visite</h3><p class="se-muted">Le client reçoit une confirmation.</p>' +
      '<form data-form="visite"><div class="se-form-grid">' +
        field('Bien', 'bienId', o.bienId || (state.biens[0] && state.biens[0].id), { type: 'select', full: true, options: state.biens.map((b) => ({ value: b.id, label: b.ref + ' — ' + b.titre })) }) +
        field('Client', 'clientId', o.clientId || '', { type: 'select', full: true, options: [{ value: '', label: '— visiteur externe —' }].concat(state.clients.map((c) => ({ value: c.id, label: nomClient(c) }))) }) +
        field('Date', 'date', o.date || today, { type: 'date' }) +
        field('Heure', 'heure', o.heure || '18:00', { type: 'time' }) +
        field('Note', 'note', '', { full: true, placeholder: 'Accès, code, remarque…' }) +
      '</div><div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Planifier</button></div></form>';
  }

  function offreModal(opts) {
    const o = opts || {};
    const b = o.bienId ? bien(o.bienId) : state.biens[0];
    return '<h3>Enregistrer une offre</h3><p class="se-muted">' + esc(b ? b.titre + ' · ' + euro(b.prix) : '') + '</p>' +
      '<form data-form="offre"><div class="se-form-grid">' +
        field('Bien', 'bienId', o.bienId || (state.biens[0] && state.biens[0].id), { type: 'select', full: true, options: state.biens.map((x) => ({ value: x.id, label: x.ref + ' — ' + x.titre })) }) +
        field('Client', 'clientId', o.clientId || '', { type: 'select', full: true, options: [{ value: '', label: '— acheteur externe —' }].concat(state.clients.map((c) => ({ value: c.id, label: nomClient(c) }))) }) +
        field('Montant (€)', 'montant', o.montant || (b ? Math.round(b.prix * 0.97) : 0), { type: 'number', full: true }) +
      '</div><div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Enregistrer</button></div></form>';
  }

  function tacheModal() {
    return '<h3>Nouvelle tâche</h3><p class="se-muted">Une relance, un document, un appel.</p>' +
      '<form data-form="tache"><div class="se-form-grid">' +
        field('Intitulé', 'titre', '', { full: true, placeholder: 'Rappeler Camille…' }) +
        field('Échéance', 'echeance', new Date().toISOString().slice(0, 10), { type: 'date' }) +
        field('Client', 'clientId', '', { type: 'select', options: [{ value: '', label: '—' }].concat(state.clients.map((c) => ({ value: c.id, label: nomClient(c) }))) }) +
        field('Bien', 'bienId', '', { type: 'select', options: [{ value: '', label: '—' }].concat(state.biens.map((b) => ({ value: b.id, label: b.ref + ' — ' + b.titre }))) }) +
      '</div><div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Créer</button></div></form>';
  }

  function bienMembreModal(id) {
    const d = state.demandes.find((x) => x.id === id);
    const mb = d ? state.membresBiens.find((b) => (b.email || '').toLowerCase() === (d.email || '').toLowerCase()) : null;
    const v = mb || { titre: '', adresse: '', quartier: 'p11', statut: 'avant-premiere', prix: 0, description: '' };
    const statuts = [{ value: 'avant-premiere', label: 'Avant-première' }, { value: 'ouvert', label: 'Ouvert aux visites' }, { value: 'sous-offre', label: 'Sous offre' }, { value: 'vendu', label: 'Vendu' }];
    return '<h3>Compléter la fiche du bien</h3><p class="se-muted">' + esc((d && d.nom) || '') + ' · le membre verra ces informations dans son espace.</p>' +
      '<form data-form="bien-membre" data-email="' + esc((d && d.email) || '') + '"><div class="se-form-grid">' +
        field('Titre', 'titre', v.titre, { full: true, placeholder: 'Quatre pièces sur la Seine' }) +
        field('Adresse', 'adresse', v.adresse || '', { full: true, placeholder: '12 rue de Turenne' }) +
        field('Quartier', 'quartier', v.quartier, { type: 'select', options: QUARTIERS.map((q) => ({ value: q.id, label: q.label })) }) +
        field('Statut', 'statut', v.statut, { type: 'select', options: statuts }) +
        field('Prix final (€)', 'prix', v.prix, { type: 'number' }) +
        field('Description', 'description', v.description, { type: 'textarea', full: true, placeholder: 'Ce qui fait la différence : lumière, vue, volumes…' }) +
      '</div><div class="se-modal-foot"><button class="se-btn ghost" type="button" data-act="modal-close">Annuler</button><button class="se-btn" type="submit">Enregistrer</button></div></form>';
  }

  function moreSheet() {
    const item = (route, icon, label, badge, href) => '<a class="se-list-item" href="' + (href || ('#/' + route)) + '" style="text-decoration:none;color:inherit;padding:14px 4px">' + icon + '<span style="flex:1;margin-left:10px">' + label + '</span>' + (badge ? '<span class="se-badge offer">' + badge + '</span>' : '') + '</a>';
    const groupe = (titre) => '<div class="se-nav-label" style="padding:14px 4px 4px">' + titre + '</div>';
    return '<h3>Menu</h3><p class="se-muted">Tout le CRM.</p><div class="se-list">' +
      groupe('Prospection') +
      item('radar', ICONS.search, 'Radar') +
      item('sci', ICONS.building, 'SCI') +
      item('recherches', ICONS.search, 'Recherches') +
      item('robot', ICONS.robot, 'Immo Data Robot', matchings().filter((m) => m.statut === 'nouveau').length) +
      item('notifications', ICONS.inbox, 'À prévenir', notifications().length) +
      groupe('Le Club') +
      item('demandes', ICONS.inbox, 'Candidatures', demandesNouvelles()) +
      item('membres', ICONS.users, 'Membres') +
      item('biens-club', ICONS.building, 'Biens du Club') +
      item('gazette', ICONS.chat, 'La Gazette') +
      groupe('Intelligence') +
      item('rapprochements', ICONS.tag, 'Rapprochements') +
      item('tracking', ICONS.search, 'Tracking') +
      groupe('Suivi') +
      item('visites', ICONS.calendar, 'Visites') +
      item('offres', ICONS.tag, 'Offres', offresNouvelles()) +
      item('taches', ICONS.check, 'Tâches') +
      item('verifications', ICONS.check, 'Vérifications', verifEnAttente()) +
      item('messages', ICONS.chat, 'Messages') +
      item('reglages', ICONS.tools, 'Réglages') +
      (state.moi && state.moi.role === 'superadmin' ? item('agents', ICONS.users, 'Agents') : '') +
      item('espace', ICONS.out, 'Espace membre', 0, 'espace.html') +
      '</div>';
  }

  /* ================================ actions =============================== */

  function csv(rows, cols) {
    const esc2 = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    return [cols.join(';')].concat(rows.map((r) => cols.map((c) => esc2(r[c])).join(';'))).join('\n');
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  const actions = {
    'more': () => { modal = moreSheet(); render(); },
    'modal-close': (el, id, e) => {
      if (e.target.closest('[data-stop]') && !e.target.hasAttribute('data-act')) return;
      modal = null; modalLarge = false; state.__previewMsg = undefined; render();
    },
    'match-fait': (el, id) => { state.matchsProposes = state.matchsProposes || {}; state.matchsProposes[id] = new Date().toISOString(); commit(); toast('Retiré des matchs à réaliser.', 'ok'); },
    'filtre': (el) => {
      const [key, val] = el.getAttribute('data-id').split(':');
      state.filtres[key] = val;
      commit();
    },
    'client-nouveau': () => { modal = clientModal(null); render(); },
    'client-editer': (el, id) => { modal = clientModal(client(id)); render(); },
    'recherche-effacer': () => { state.filtres.q = ''; save(); render(); },
    'archiver-demander': (el, id) => { modal = archiveModal(el.getAttribute('data-kind'), id); render(); },
    'archiver-confirmer': async (el, id) => {
      const kind = el.getAttribute('data-kind');
      const avec = !!document.querySelector('[data-archive-recherches]:checked');
      el.disabled = true; el.textContent = 'Archivage…';
      if (!(await archiverFiche(kind, id, true, avec))) { el.disabled = false; el.textContent = 'Archiver'; return; }
      modal = null;
      location.hash = kind === 'lead' ? '#/clients' : kind === 'bien' ? '#/biens' : '#/recherches';
      commit();
      toast('Fiche archivée : retrouvez-la dans l’onglet « Archivés ».', 'ok');
    },
    'restaurer': async (el, id) => {
      const kind = el.getAttribute('data-kind');
      el.disabled = true;
      if (!(await archiverFiche(kind, id, false, kind === 'lead'))) { el.disabled = false; return; }
      commit();
      toast('Fiche restaurée.', 'ok');
    },
    'historique': async (el, id) => {
      const kind = el.getAttribute('data-kind');
      modal = historiqueModal(kind, id, true); render();
      try {
        const r = await fetch('/api/activites', { headers: { accept: 'application/json' } });
        if (r.ok) state.activites = (await r.json()).activites || state.activites;
      } catch (e) { /* on affiche ce qui est déjà chargé */ }
      modal = historiqueModal(kind, id, false); render();
    },
    'bien-nouveau': () => {
      if (!state.clients.length) {
        toast('Créez d’abord le lead propriétaire à rattacher à ce bien.', 'warn');
        modal = clientModal(null);
      } else modal = bienModal(null);
      render();
    },
    'bien-editer': (el, id) => { modal = bienModal(bien(id)); render(); },
    'recherche-nouvelle': (el, id) => {
      if (!id && !state.clients.filter((c) => c.type !== 'vendeur').length) {
        toast('Créez d’abord un lead acquéreur (ou mixte) à rattacher à cette recherche.', 'warn');
        modal = clientModal(null);
      } else modal = rechercheModal(null, id);
      render();
    },
    'recherche-editer': (el, id) => { modal = rechercheModal(recherche(id)); render(); },
    'suite-bien': (el, id) => { modal = bienModal(null, id); render(); },
    'suite-recherche': (el, id) => { modal = rechercheModal(null, id); render(); },
    'suite-plus-tard-lead': (el, id) => { modal = null; render(); location.hash = '#/client/' + id; },
    'suite-plus-tard-bien': (el, id) => { modal = null; render(); location.hash = '#/bien/' + id; },
    'recherche-envoyer': (el, id) => {
      const rec = recherche(id);
      const n = biensCompatibles(rec, 40).length;
      toast('Sélection de ' + n + ' bien(s) envoyée à ' + nomClient(client(rec.clientId)) + ' (simulation).', 'ok');
    },
    'visite-nouvelle': (el, id) => { modal = visiteModal({ clientId: el.getAttribute('data-id') === 'null' ? '' : (client(id) ? id : ''), bienId: el.getAttribute('data-bien') || '' }); render(); },
    'visites-nouvelle': () => { modal = visiteModal({}); render(); },
    'tache-nouvelle': () => { modal = tacheModal(); render(); },
    'tache-toggle': (el, id) => {
      const t = state.taches.find((x) => x.id === id);
      if (t) { t.fait = el.checked; commit(); }
    },
    'q-toggle': (el) => {
      const pressed = el.getAttribute('aria-pressed') === 'true';
      el.setAttribute('aria-pressed', String(!pressed));
    },
    'demande-traiter': (el, id) => {
      const d = state.demandes.find((x) => x.id === id);
      if (d) { d.statut = 'traitee'; commit(); toast('Demande traitée.'); }
    },
    'demande-client': (el, id) => {
      const d = state.demandes.find((x) => x.id === id);
      if (!d) return;
      const c = {
        id: uid('c'), type: d.type === 'candidature' ? 'acquereur' : 'acquereur',
        prenom: (d.nom || 'Nouveau').split(' ')[0], nom: (d.nom || '').split(' ').slice(1).join(' ') || '',
        email: d.email || '', tel: '', statut: 'prospect', source: d.source || 'Site web',
        budgetMin: 0, budgetMax: d.montant || 0, quartiers: [], piecesMin: 0, surfaceMin: 0, typeBien: '',
        notes: d.message || '', tags: [], agent: state.agent.prenom + ' ' + state.agent.nom, cree: nowISO()
      };
      state.clients.push(c);
      d.clientId = c.id;
      d.statut = 'traitee';
      commit();
      toast('Fiche client créée : ' + nomClient(c), 'ok');
      location.hash = '#/client/' + c.id;
    },
    'demande-visite': (el, id) => {
      const d = state.demandes.find((x) => x.id === id);
      modal = visiteModal({ bienId: (d && d.bienId) || '', clientId: (d && d.clientId) || '' });
      render();
    },
    'demande-traitement': (el, id) => {
      const d = state.demandes.find((x) => x.id === id);
      modal = offreModal({ bienId: (d && d.bienId) || '', clientId: (d && d.clientId) || '', montant: (d && d.montant) || 0 });
      render();
    },
    'bien-membre-completer': (el, id) => { modal = bienMembreModal(id); render(); },
    'lead-valider': async (el, id) => {
      try {
        const r = await fetch('/api/leads/' + id + '/statut', {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ statut: 'accepte' })
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        const c = state.clients.find((x) => x.serverId === id);
        if (c) { c.serveurStatut = 'accepte'; if (c.statut === 'prospect') c.statut = 'actif'; }
        commit();
        toast('Accès validé. Le membre est débloqué et prévenu.', 'ok');
        ouvrirNotifieModal(res.notif, 'Accès validé');
      } catch (e) { toast('Validation impossible.', 'warn'); }
    },
    'verif-valider': async (el, id) => {
      try {
        const r = await fetch('/api/tasks/' + id + '/valider', { method: 'POST' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        const t = (state.tachesVerif || []).find((x) => x.id === id);
        if (t) t.statut = 'validee';
        const c = state.clients.find((x) => x.serverId === (t && t.leadId));
        if (c) { c.serveurStatut = 'accepte'; if (c.statut === 'prospect') c.statut = 'actif'; }
        commit();
        toast('Compte validé. Le membre est débloqué et prévenu.', 'ok');
        ouvrirNotifieModal(res.notif, 'Compte validé');
      } catch (e) { toast('Validation impossible.', 'warn'); }
    },
    'verif-refuser': async (el, id) => {
      try {
        const r = await fetch('/api/tasks/' + id + '/refuser', { method: 'POST' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        const t = (state.tachesVerif || []).find((x) => x.id === id);
        if (t) t.statut = 'refusee';
        commit();
        toast('Dossier refusé, client prévenu.', 'warn');
        ouvrirNotifieModal(res.notif, 'Dossier refusé');
      } catch (e) { toast('Action impossible.', 'warn'); }
    },
    'demande-ouvrir': (el, id) => { const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id); if (d) { location.hash = '#/demande/' + d.id; } },
    'accepter-adhesion': async (el, id) => { await decisionDemande(id, 'valider'); },
    'suspendre-adhesion': (el, id) => { modal = suspendreModal(id); render(); },
    'refuser-adhesion': async (el, id) => { await decisionDemande(id, 'refuser'); },
    'visite-refuser-agent': async (el, id) => { await decisionDemande(id, 'refuser'); },
    // Actions dédiées aux demandes de modification : ouvrir directement le
    // formulaire du bien concerné (modale, sans quitter la page), ou valider/
    // refuser la demande en un clic — decisionDemande() applique déjà le
    // nouveau prix/titre/description sur « valider » et prévient le membre.
    'demande-modif-editer': (el, id) => {
      const d = state.demandes.find((x) => x.id === id);
      const b = d && d.bienId ? bienParServeur(d.bienId) : null;
      if (!b) { toast('Bien introuvable pour cette demande — ouvrez-la via « Voir la fiche ».', 'warn'); return; }
      modal = bienModal(b);
      render();
    },
    'demande-modif-valider': async (el, id) => { await decisionDemande(id, 'valider'); },
    'demande-modif-refuser': async (el, id) => { await decisionDemande(id, 'refuser'); },
    'offre-accepter': async (el, id) => {
      const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id);
      const offreId = d ? (d.offreId || d.serverDemandeId) : id;
      try {
        const r = await fetch('/api/offres/' + offreId + '/accepter', { method: 'POST' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        if (d) d.statut = 'traitee';
        const b = d && d.bienId ? bien(d.bienId) : null;
        if (b) b.statut = 'sous-compromis';
        modal = null;
        commit();
        toast('Offre acceptée. Le bien passe sous compromis, acquéreur prévenu.', 'ok');
        ouvrirNotifieModal(res.notif, 'Offre acceptée');
      } catch (e) { toast('Action impossible.', 'warn'); }
    },
    'offre-contre': (el, id) => {
      const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id);
      if (d) { modal = offreContreModal(d); render(); }
    },
    'demande-relancer': (el, id) => {
      const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id);
      if (d) { d.statut = 'nouvelle'; commit(); toast('Demande relancée.', 'ok'); }
    },
    'radar-aide': () => { radar.aide = !radar.aide; render(); },
    'radar-periode': (el, id) => { radar.periode = id; render(); },
    'radar-rechercher': () => { rdRelancer(); },
    'radar-vue': (el, id) => { radar.vue = id; render(); },
    'radar-zone-form': () => { radar.ajoutZone = true; render(); setTimeout(() => { const i = document.querySelector('[data-rd-cp]'); if (i) i.focus(); }, 30); },
    'radar-zone-annuler': () => { radar.ajoutZone = false; radar.cpSaisi = ''; render(); },
    'radar-zone-ajouter': async () => {
      const i = document.querySelector('[data-rd-cp]');
      const cp = String((i && i.value) || '').trim();
      if (!/^\d{5}$/.test(cp)) { toast('Code postal à 5 chiffres.', 'warn'); return; }
      radar.ajoutEnCours = true; radar.cpSaisi = cp; render();
      try {
        const r = await fetch('/api/radar/zones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cp: cp }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'erreur');
        radar.zones = (d.zones || []).map((z) => ({ quartier: z.quartier, label: z.label, cp: z.cp }));
        const noms = (d.ajoutees || []).map((z) => z.label);
        toast(noms.length ? noms.join(', ') + ' ajouté' + (noms.length > 1 ? 's' : '') + ' au Radar. Les DPE arrivent, les SCI suivent.' : 'Déjà dans le Radar.', 'ok');
        radar.ajoutZone = false; radar.cpSaisi = '';
        radar.secteursTemp = Array.from(new Set((radar.secteursTemp || []).concat((d.ajoutees || []).map((z) => z.quartier))));
        radar.choixSecteurs = true;
      } catch (e) { toast('Ajout impossible : ' + (e.message || 'erreur'), 'warn'); }
      radar.ajoutEnCours = false; render();
    },
    'radar-zone-retirer': async (el, id) => {
      const z = (radar.zones || []).find((x) => x.quartier === id);
      if (!z) return;
      if (radar.zoneARetirer !== id) { radar.zoneARetirer = id; toast('Touchez encore × pour retirer ' + z.label + ' du Radar (les fiches déjà trouvées restent).', 'warn'); setTimeout(() => { if (radar.zoneARetirer === id) radar.zoneARetirer = null; }, 5000); return; }
      radar.zoneARetirer = null;
      try {
        const r = await fetch('/api/radar/zones/' + encodeURIComponent(id), { method: 'DELETE' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'erreur');
        radar.zones = (d.zones || []).map((x) => ({ quartier: x.quartier, label: x.label, cp: x.cp }));
        radar.secteurs = radar.secteurs.filter((x) => x !== id);
        radar.secteursTemp = (radar.secteursTemp || []).filter((x) => x !== id);
        render();
      } catch (e) { toast('Impossible : ' + (e.message || 'erreur'), 'warn'); }
    },
    'radar-vers-secteur': (el, id) => { radar.secteurs = [id]; radar.vue = 'liste'; rdRelancer(); },
    'sci-zones-ouvrir': () => { sci.choix = !sci.choix; sci.temp = sci.zones.slice(); render(); },
    'sci-zone': (el, id) => { sci.temp = sci.temp.indexOf(id) > -1 ? sci.temp.filter((x) => x !== id) : sci.temp.concat([id]); render(); },
    'sci-zones-tout': () => { sci.temp = []; render(); },
    'sci-zones-valider': () => { sci.zones = sci.temp.slice(); sci.choix = false; sci.page = 1; sciCharger(); },
    'sci-chercher': () => { const i = document.querySelector('[data-sci-q]'); sci.q = i ? i.value : sci.q; sci.page = 1; sciCharger(); },
    'sci-radar': (el, id) => { radar.siren = id; radar.sirenNom = el.getAttribute('data-nom') || ''; radar.vue = 'liste'; radar.page = 1; location.hash = '#/radar'; setTimeout(rdRelancer, 50); },
    'sci-plus': () => { sci.page++; sciCharger(); },
    'sci-analyser': (el, id) => sciAnalyserUne(id),
    'sci-reanalyser': async (el, id) => { sci.analyse[id] = true; render(); try { const d = await (await fetch('/api/sci/' + id + '?analyser=1&forcer=1')).json(); sci.fiches[id] = d; } catch (e) { toast('Analyse impossible', 'warn'); } delete sci.analyse[id]; render(); },
    'sci-analyser-lot': async () => {
      const ids = ((sci.data && sci.data.lignes) || []).filter((x) => !x.analysee).slice(0, 20).map((x) => x.siren);
      sci.lot = { fait: 0, total: ids.length }; render();
      for (const id of ids) { await sciAnalyserUne(id); sci.lot.fait++; render(); }
      sci.lot = null; if (sci.tri === 'score' && sci.data) sci.data.lignes.sort((a, z) => z.score - a.score); render();
    },
    'sci-achats': async (el, id) => { sci.analyse['dvf' + id] = true; render(); try { const r = await fetch('/api/sci/' + id + '/achats', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur'); if (sci.fiches[id]) sci.fiches[id].achats = d.achats; } catch (e) { toast('DVF : ' + (e.message || 'erreur'), 'warn'); } delete sci.analyse['dvf' + id]; render(); },
    'sci-lead': async (el, id) => { try { const r = await fetch('/api/sci/' + id + '/lead', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur'); toast(d.deja ? 'Ce lead existe déjà.' : 'Lead vendeur créé (sans coordonnées pour l’instant).', 'ok'); await syncServeur(); location.hash = '#/client/' + d.lead.id; } catch (e) { toast('Création impossible : ' + (e.message || 'erreur'), 'warn'); } },
    'sci-suivre': async (el, id) => { const F = sci.fiches[id] || {}; try { const r = await fetch('/api/sci/' + id + '/suivre', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suivre: !F.suivie }) }); const d = await r.json(); F.suivie = d.suivie; toast(d.suivie ? 'SCI suivie : alerte à chaque DPE, annonce BODACC ou décès.' : 'SCI plus suivie.', 'ok'); } catch (e) { toast('Impossible', 'warn'); } render(); },
    'sci-lettre': (el, id) => {
      const t = sciLettre(id);
      const w = window.open('', '_blank');
      if (!w) { try { navigator.clipboard.writeText(t); toast('Lettre copiée dans le presse-papiers.', 'ok'); } catch (e) { toast('Ouverture bloquée par le navigateur.', 'warn'); } return; }
      w.document.write('<!doctype html><meta charset="utf-8"><title>Lettre</title><body style="font:15px/1.6 Georgia,serif;max-width:640px;margin:48px auto;padding:0 24px;white-space:pre-wrap" contenteditable="true">' + t.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</body>');
      w.document.close();
    },
    'radar-siren': (el, id) => { radar.siren = id || ''; radar.sirenNom = el.getAttribute('data-nom') || ''; radar.vue = 'liste'; rdRelancer(); },
    'radar-coord-ouvrir': (el, id) => { radar.coordOuvert = id; radar.coordChoix = radar.coordChoix || {}; render(); rdChargerOutils(false); },
    'radar-coord-fermer': () => { radar.coordOuvert = null; render(); },
    'radar-coord-soldes': () => { radar.outilsCoord = null; render(); rdChargerOutils(true); },
    'radar-coord-lancer': async (el, id) => {
      const choix = radar.coordChoix || {};
      const outils = (radar.outilsCoord || []).filter((o) => o.configure && !(o.soldeConnu && typeof o.solde === 'number' && o.solde <= 0) && choix[o.id] !== false).map((o) => o.id);
      if (!outils.length) { toast('Cochez au moins un outil.', 'warn'); return; }
      radar.coordEnCours = true; render();
      try {
        const r = await fetch('/api/radar/fiche/' + encodeURIComponent(id) + '/coordonnees', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outils: outils, toutEssayer: !!choix._tout }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Recherche impossible');
        const F = radar.fiches[id];
        if (F && F.fiche) { F.fiche.proprietaire.coordPro = d.resultat; F.fiche.proprietaire.contacts = d.contacts; }
        radar.outilsCoord = d.outils;
        toast(d.resultat.trouve ? 'Coordonnées trouvées : ' + [d.resultat.telephone, d.resultat.email].filter(Boolean).join(' · ') : 'Aucun outil n’a trouvé de téléphone ni d’email pour ce gérant.', d.resultat.trouve ? 'ok' : 'warn');
        chargerFicheRadar(id, false);
      } catch (e) { toast(e.message, 'warn'); }
      radar.coordEnCours = false; render();
    },
    'radar-kaspr': async (el, id) => {
      const url = el.getAttribute('data-url');
      el.disabled = true; el.textContent = 'Recherche Kaspr…';
      try {
        const r = await fetch('/api/robot/enrichir-linkedin', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkedinUrl: url }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
        const F = radar.fiches[id];
        if (d.trouve && F && F.fiche) { const c = F.fiche.proprietaire.contacts = F.fiche.proprietaire.contacts || { linkedin: [], telephones: [], emails: [] }; if (d.telephone) c.telephones = [d.telephone].concat(c.telephones || []); if (d.email) c.emails = [d.email].concat(c.emails || []); toast('Coordonnées trouvées par Kaspr.', 'ok'); }
        else toast(d.epuise ? 'Quota Kaspr épuisé.' : 'Kaspr n’a rien trouvé pour ce profil.', 'warn');
      } catch (e) { toast(e.message, 'warn'); }
      render();
    },
    'radar-secteurs-ouvrir': () => { radar.choixSecteurs = !radar.choixSecteurs; radar.secteursTemp = radar.secteurs.slice(); render(); },
    'radar-secteur-temp': (el, id) => { const t = radar.secteursTemp || []; radar.secteursTemp = t.indexOf(id) > -1 ? t.filter((x) => x !== id) : t.concat([id]); render(); },
    'radar-secteurs-tout': () => { radar.secteursTemp = []; render(); },
    'radar-secteurs-valider': () => { radar.secteurs = (radar.secteursTemp || []).slice(); radar.choixSecteurs = false; radar.ajoutZone = false; radar.page = 1; rdRelancer(); },
    'radar-secteur': (el, id) => { radar.secteurs = id === 'tout' ? [] : (radar.secteurs.indexOf(id) > -1 ? radar.secteurs.filter((x) => x !== id) : radar.secteurs.concat([id])); render(); },
    'radar-classe': (el, id) => { radar.classes = radar.classes.indexOf(id) > -1 ? radar.classes.filter((x) => x !== id) : radar.classes.concat([id]).sort(); render(); },
    'radar-reset': () => { const p = radar.periode, t = radar.tri; Object.assign(radar, RD_CRIT(), { periode: p, tri: t }); render(); },
    'radar-une': () => { radar.periode = 'semaine'; radar.client = '1'; radar.tri = 'recent'; rdRelancer(); },
    'radar-plus': () => { radar.page += 1; chargerRadar(true); },
    'radar-pm-importer': async () => {
      try { await fetch('/api/robot/pm/importer', { method: 'POST', credentials: 'same-origin' }); toast('Chargement du fichier des propriétaires lancé (quelques minutes).', 'ok'); } catch (e) { toast(e.message, 'warn'); }
      chargerRadar(true);
    },
    'radar-statut': async (el, id) => {
      const st = el.getAttribute('data-statut');
      try {
        const r = await fetch('/api/radar/fiche/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ statut: st }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
        const F = radar.fiches[id]; if (F && F.fiche) Object.assign(F.fiche, { statut: d.statut, historique: d.historique });
        radar.lignes.forEach((l) => { if (l.id === id) l.statut = d.statut; });
        toast({ a_revoir: 'Remise à revoir.', en_cours: 'Fiche en cours.', contacte: 'Marquée contactée.', ecarte: 'Fiche écartée : elle n’apparaît plus dans la liste.' }[st], 'ok'); render();
      } catch (e) { toast(e.message, 'warn'); }
    },
    'radar-prospect': async (el, id) => {
      try {
        const r = await fetch('/api/radar/fiche/' + encodeURIComponent(id) + '/prospect', { method: 'POST', credentials: 'same-origin' });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
        const F = radar.fiches[id]; if (F && F.fiche) { F.fiche.leadId = d.leadId; if (F.fiche.statut === 'a_revoir') F.fiche.statut = 'en_cours'; }
        radar.lignes.forEach((l) => { if (l.id === id) l.leadId = d.leadId; });
        toast(d.deja ? 'Déjà dans vos prospects.' : 'Ajouté à vos prospects (Leads › vendeurs, « à contacter »).', 'ok');
        if (typeof syncServeur === 'function') syncServeur();
        render();
      } catch (e) { toast('Ajout impossible : ' + e.message, 'warn'); }
    },
    'radar-imprimer': (el, id) => {
      const F = radar.fiches[id]; if (!F || !F.fiche) return;
      const l = rdLettre(F);
      const w = window.open('', '_blank');
      if (!w) { toast('Autorisez les fenêtres pour imprimer la lettre.', 'warn'); return; }
      w.document.write('<!doctype html><meta charset="utf-8"><title>Lettre au propriétaire</title><style>body{font:15px/1.6 Georgia,serif;max-width:640px;margin:60px auto;padding:0 24px;color:#111}pre{white-space:pre-wrap;font:inherit}.dest{margin-left:55%;margin-bottom:48px}@media print{button{display:none}}</style>' +
        '<button onclick="print()">Imprimer</button><pre class="dest">' + esc(l.dest) + '</pre><p>Paris, le ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + '</p><pre>' + esc(l.corps) + '</pre>');
      w.document.close();
    },
    'import-appliquer': () => {
      document.querySelectorAll('[data-import-col]').forEach((s) => { imp.corresp[Number(s.getAttribute('data-import-col'))] = s.value; });
      importAppliquer();
    },
    'import-filtre': (el, id) => { imp.filtre = id; render(); },
    'import-seg': (el, id) => { imp.segOuvert = imp.segOuvert === id ? null : id; render(); },
    'import-lancer': async () => {
      if (!imp || imp.envoi) return;
      imp.envoi = true; imp.progression = ''; render();
      try {
        imp.resultat = await importEnvoyer(false);
        toast(num(imp.resultat.crees) + ' clients importés, ' + num(imp.resultat.completes) + ' complétés.', 'ok');
        if (typeof syncServeur === 'function') syncServeur();
      } catch (e) { toast('Import interrompu : ' + e.message + ' (relancez : les clients déjà importés seront seulement complétés).', 'warn'); }
      imp.envoi = false; render();
    },
    'gazette-rediger': async (el, id) => {
      state.gazetteRedaction = id; render();
      try {
        const d = await appelGazette('POST', '/api/gazette/articles/generer', { rubrique: id });
        toast('Article rédigé : « ' + d.article.titre + ' »' + (d.article.statut === 'publie' ? ' — publié.' : ' — à valider.'), 'ok');
        state.gazetteArticleOuvert = d.article.id;
      } catch (err) { toast('Rédaction impossible : ' + err.message, 'warn'); }
      state.gazetteRedaction = null;
      await chargerArticlesGazette();
    },
    'gazette-article-ouvrir': (el, id) => { state.gazetteArticleOuvert = state.gazetteArticleOuvert === id ? null : id; render(); },
    'gazette-article-statut': async (el, id) => {
      const st = el.getAttribute('data-statut');
      try { await appelGazette('PATCH', '/api/gazette/articles/' + encodeURIComponent(id), { statut: st }); toast(st === 'publie' ? 'Article publié dans la Gazette.' : 'Article retiré de la Gazette.', 'ok'); } catch (err) { toast(err.message, 'warn'); }
      await chargerArticlesGazette();
    },
    'gazette-article-suppr': async (el, id) => {
      if (el.getAttribute('data-confirme') !== '1') { el.setAttribute('data-confirme', '1'); el.textContent = 'Confirmer la suppression'; return; }
      try { await appelGazette('DELETE', '/api/gazette/articles/' + encodeURIComponent(id)); state.gazetteArticleOuvert = null; toast('Article supprimé.', 'ok'); } catch (err) { toast(err.message, 'warn'); }
      await chargerArticlesGazette();
    },
    'bien-sur-seecret': async (el, id) => {
      const b = bien(id); if (!b || !b.serveur) return;
      const v = b.surSeecret === false;
      await enregistrerBien(b, { surSeecret: v }, v ? (surPlateforme(Object.assign({}, b, { surSeecret: true })) ? 'Le bien est maintenant visible sur Seecret.' : 'Option activée. ' + raisonHorsPlateforme(Object.assign({}, b, { surSeecret: true }))) : 'Bien retiré de la plateforme : il reste dans le CRM.');
    },
    'bien-photo': async (el, id) => {
      const b = bien(id); if (!b || !b.serveur) return;
      const i = Number(el.getAttribute('data-i')); const op = el.getAttribute('data-op');
      const p = (b.photos || []).slice(); if (!(i >= 0 && i < p.length)) return;
      if (op === 'principale') p.unshift(p.splice(i, 1)[0]);
      else if (op === 'gauche' && i > 0) { const t = p[i - 1]; p[i - 1] = p[i]; p[i] = t; }
      else if (op === 'droite' && i < p.length - 1) { const t = p[i + 1]; p[i + 1] = p[i]; p[i] = t; }
      else if (op === 'retirer') p.splice(i, 1);
      await enregistrerBien(b, { photos: p }, op === 'retirer' ? 'Photo retirée.' : op === 'principale' ? 'Photo principale changée.' : '');
    },
    'bien-valider': async (el, id) => {
      const b = bien(id);
      const serverId = b ? (b.serverId || b.id) : id;
      try {
        const r = await fetch('/api/biens/' + serverId + '/valider', { method: 'PATCH' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Erreur');
        if (b) { b.validation = 'valide'; if (['brouillon', 'a_valider', 'mandat', ''].indexOf(b.statut || '') > -1) b.statut = 'avant-premiere'; if (b.surSeecret === undefined) b.surSeecret = true; }
        commit();
        toast('Bien validé et mis en Avant-première : il est visible des membres.', 'ok');
        ouvrirNotifieModal(res.notif, 'Bien validé');
      } catch (e) { toast('Validation impossible : ' + (e.message || 'erreur'), 'warn'); }
    },
    'sel-tous': (el) => {
      const checked = el.checked;
      document.querySelectorAll('.sel-acq').forEach((b) => { b.checked = checked; });
      const n = document.querySelectorAll('.sel-acq:checked').length;
      const btn = document.getElementById('btn-envoi-sel');
      if (btn) btn.textContent = n ? ('Envoyer à la sélection (' + n + ')') : 'Envoyer à tous les matchs';
    },
    'bien-envoyer-sel': (el) => {
      const bienId = el.getAttribute('data-bien');
      const all = JSON.parse(el.getAttribute('data-all') || '[]');
      const ids = Array.prototype.slice.call(document.querySelectorAll('.sel-acq:checked')).map((b) => b.getAttribute('value'));
      const cibles = ids.length ? ids : all;
      if (!cibles.length) { toast('Aucun acquéreur à contacter.', 'warn'); return; }
      state.__sel = cibles;
      state.__previewMsg = undefined;
      modalLarge = true;
      modal = previewModal(bienId, cibles[0]);
      render();
    },
    'prospection-dpe': async (el) => {
      const input = document.querySelector('input[name="prospection-ville"]');
      const ville = String((input && input.value) || '').trim();
      if (!ville) { toast('Saisissez une ville ou un secteur.', 'warn'); return; }
      const status = document.getElementById('prospection-status');
      if (status) status.textContent = 'Prospection DPE en cours…';
      try {
        const r = await fetch('/api/robot/prospecting?ville=' + encodeURIComponent(ville), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.data && r.data.results) {
          const biens = r.data.results.map(mapSignalRobotBien);
          state.robotBiens = biens;
          state.robot = r.data;
          state.robotFiltres = {};
          state.robotPage = 1;
          if (biens.length) { toast(biens.length + ' signal(s) DPE détecté(s).', 'ok'); }
          else { toast('Aucun signal DPE trouvé.', 'warn'); }
        } else { toast(r.error || 'Aucun résultat.', 'warn'); }
      } catch (e) { toast(e.message || 'Prospection impossible.', 'warn'); }
      if (status) status.textContent = '';
      saveRobotBiens();
      render();
    },
    'robot-search': async (el) => {
      const form = document.querySelector('form[data-form="robot-search"]');
      const fd = form ? new FormData(form) : new FormData();
      const params = new URLSearchParams();
      ['adresse', 'ville', 'code_postal', 'dpe', 'section', 'numero'].forEach((k) => {
        const v = String(fd.get(k) || '').trim();
        if (v) params.set(k, v);
      });
      if (!params.toString()) { toast('Saisissez au moins une adresse ou une ville.', 'warn'); return; }
      const status = document.getElementById('robot-status');
      if (status) status.textContent = 'Prospection en cours…';
      try {
        const r = await fetch('/api/robot/search?' + params.toString(), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.data) {
          const feats = (r.data.features || []).map(mapRobotBien);
          state.robotBiens = feats;
          state.robot = r.data;
          state.robotFiltres = {};
          state.robotPage = 1;
          if (feats.length) { toast(feats.length + ' bien(s) trouvé(s) par le moteur.', 'ok'); }
          else { toast('Aucun bien trouvé.', 'warn'); }
          const feats2 = feats.map((b) => b.feature).filter(Boolean);
          if (feats2.length) {
            fetch('/api/robot/enrichir-lot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ features: feats2 }) }).then(() => pollEnrichissement()).catch(() => {});
          }
        } else { state.robot = null; toast(r.error || 'Aucun résultat.', 'warn'); }
      } catch (e) {
        state.robot = null;
        toast(e.message || 'Prospection impossible (moteur Python injoignable).', 'warn');
      }
      if (status) status.textContent = '';
      saveRobotBiens();
      render();
    },
    'robot-ajouter': async (el) => {
      const d = JSON.parse(el.getAttribute('data-json') || '{}');
      if (!d.nom) { toast('Propriétaire non identifié — enrichissez d’abord le bien.', 'warn'); return; }
      try {
        const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({
          nom: d.nom, prenom: d.prenom || '', email: d.email || '', tel: d.tel || '', type: d.type || 'personne',
          siren: d.siren || '', dirigeants: d.dirigeants || [], ville: d.ville || '', adresseBien: d.adresseBien || d.adresse || '',
          parcelle: d.ref || d.parcelle || '', dpe: d.dpe || '', notes: 'Prospection Immo Data Robot'
        }) }).then((x) => x.json());
        if (r.ok) {
          await syncServeur();
          // L'id local d'un lead venu du serveur est préfixé 'srv-' (voir
          // syncServeur) : on peut donc programmer les relances dès que la
          // synchronisation a rattaché le lead fraîchement créé.
          programmerRelances('srv-' + r.lead.id, ((d.prenom || '') + ' ' + (d.nom || '')).trim(), 'prospection DPE');
          commit();
          toast('Prospect vendeur ajouté aux Leads. 3 relances programmées (J+1, J+3, J+7).', 'ok');
          location.hash = '#/clients';
        }
        else toast(r.error || 'Ajout impossible.', 'warn');
      } catch (e) { toast(e.message || 'Ajout impossible.', 'warn'); }
    },
    'robot-bien-tab': (el) => { state.robotBienTab = el.getAttribute('data-tab'); render(); },
    'recherches-tri': (el) => { state.rechTri = el.getAttribute('data-tri'); render(); },
    'robot-enrichir': async (el) => {
      const id = el.getAttribute('data-id');
      const b = robotBien(id);
      if (!b || !b.feature) { toast('L\'enrichissement nécessite la référence cadastrale complète.', 'warn'); return; }
      try {
        const r = await fetch('/api/robot/enrichir-parcelle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ feature: b.feature }) }).then((x) => x.json());
        if (r.ok && r.dossier) {
          const o = r.dossier.owner || {};
          const cand = (o.candidates && o.candidates[0]) || {};
          b.proprietaire = {
            nom: cand.name || cand.nom || '',
            type: String(cand.owner_type || cand.type || '').toLowerCase().indexOf('sci') > -1 ? 'sci' : (cand.siren ? 'societe' : 'personne'),
            siren: cand.siren || '',
            dirigeants: []
          };
          if (r.dossier.scores && r.dossier.scores.data_reliability) {
            b.confidence_owner = r.dossier.scores.data_reliability.score;
            b.confidence_owner_source = (r.dossier.owner && r.dossier.owner.source_status) || 'dossier cadastre';
          }
          if (r.parcelId) b.parcelId = r.parcelId;
          commit(); render();
          toast(b.proprietaire.nom ? 'Propriétaire identifié : ' + b.proprietaire.nom : 'Enrichissement effectué (propriétaire non identifié).', 'ok');
        } else toast(r.error || 'Enrichissement impossible.', 'warn');
      } catch (e) { toast(e.message || 'Enrichissement impossible.', 'warn'); }
    },
    'dpe-fiche': (el) => {
      state.dpeFiche = el.getAttribute('data-key');
      state.dpeEnrichi = null;
      modal = dpeFicheModal();
      render();
    },
    'dpe-preset': (el) => {
      const p = el.getAttribute('data-preset');
      const boxes = document.querySelectorAll('input[name="classe"]');
      if (p === 'passoires') {
        boxes.forEach((b) => { b.checked = (b.value === 'F' || b.value === 'G'); });
      } else if (p === 'anciens') {
        boxes.forEach((b) => { b.checked = true; });
        const df = document.querySelector('input[name="date_fin"]');
        if (df) df.value = '2022-12-31';
      }
    },
    'dpe-enrichir': async (el) => {
      const adresse = el.getAttribute('data-adresse');
      toast('Pipeline : cadastre → parcelle → propriétaire…');
      try {
        const r = await fetch('/api/robot/enrichir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ adresse: adresse }) }).then((x) => x.json());
        state.dpeEnrichi = r;
      } catch (e) { state.dpeEnrichi = { error: e.message || 'Enrichissement impossible.' }; }
      modal = dpeFicheModal();
      render();
    },
    'dpe-search': async (el) => {
      const form = document.querySelector('form[data-form="dpe-search"]');
      const fd = form ? new FormData(form) : new FormData();
      const classes = Array.prototype.slice.call(document.querySelectorAll('input[name="classe"]:checked')).map((c) => c.value);
      state.dpeClasses = classes;
      const params = new URLSearchParams();
      ['ville', 'code_postal', 'section', 'numero', 'date_debut', 'date_fin', 'surface_min', 'surface_max', 'type', 'tri'].forEach((k) => {
        const v = String(fd.get(k) || '').trim();
        if (v) params.set(k, v);
      });
      // Page Radar fusionnée (#/robot) : ce formulaire n'a plus ses propres
      // champs Surface/Type (volontairement retirés, cf. « Filtres & tri »
      // juste en dessous) — on réutilise alors les réglages de ce panneau
      // pour que « Rechercher » aille chercher plus loin avec les mêmes
      // critères, au lieu de les ignorer. Le formulaire du tab DPE garde ses
      // propres champs et n'est donc jamais concerné par ce repli.
      if (!form || !form.elements.namedItem('surface_min')) {
        const rf = state.robotFiltres || {};
        if (!params.has('surface_min') && rf.surfaceMin) params.set('surface_min', String(rf.surfaceMin));
        if (!params.has('surface_max') && rf.surfaceMax) params.set('surface_max', String(rf.surfaceMax));
        if (!params.has('type') && rf.type) params.set('type', String(rf.type));
      }
      if (classes.length) params.set('classes', classes.join(','));
      if (!params.has('ville') && !params.has('code_postal')) { toast('Saisissez une adresse, une ville ou un code postal.', 'warn'); return; }
      const status = document.getElementById('dpe-status');
      if (status) status.textContent = 'Recherche ADEME en cours…';
      try {
        const r = await fetch('/api/robot/dpe?' + params.toString(), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.results && r.results.length) {
          state.dpe = r;
          let biens = r.results.map(mapSignalRobotBien);
          // fusionner la recherche cadastrale si section/numero renseignés
          const section = String(fd.get('section') || '').trim();
          const numero = String(fd.get('numero') || '').trim();
          if (section || numero) {
            try {
              const cp = new URLSearchParams();
              ['ville', 'code_postal', 'section', 'numero'].forEach((k) => { const v = String(fd.get(k) || '').trim(); if (v) cp.set(k, v); });
              const cr = await fetch('/api/robot/search?' + cp.toString(), { credentials: 'same-origin' }).then((x) => x.json());
              if (cr.ok && cr.data && cr.data.features) biens = biens.concat(cr.data.features.map(mapRobotBien));
            } catch (e) { /* cadastre indisponible */ }
          }
          state.robotBiens = biens;
          state.robotFiltres = {};
          state.robotPage = 1;
          saveRobotBiens();
          toast(biens.length + ' bien(s) DPE détecté(s) — enrichissement automatique lancé.', 'ok');
          enrichirDpeAuto();
          location.hash = '#/robot-radar';
        } else {
          state.dpe = r;
          toast('Aucun DPE trouvé.', 'warn');
        }
      } catch (e) { state.dpe = null; toast(e.message || 'Recherche impossible.', 'warn'); }
      if (status) status.textContent = '';
      render();
    },
    'recherche-dpe-opportunite': async (el) => {
      const id = el.getAttribute('data-id');
      const rec = recherche(id);
      if (!rec) return;
      el.disabled = true;
      const texteInitial = el.textContent;
      el.textContent = 'Recherche en cours…';
      try {
        const res = await rechercherDpePourRecherche(rec);
        if (res.erreur === 'secteur') toast('Ajoutez un secteur à cette recherche pour cibler la recherche DPE.', 'warn');
        else toast(res.ajoutes ? res.ajoutes + ' bien(s) DPE trouvé(s) et ajouté(s) aux opportunités.' : 'Aucun nouveau bien DPE trouvé pour ce secteur — réessayez plus tard.', res.ajoutes ? 'ok' : 'warn');
      } catch (e) {
        toast('Recherche DPE impossible.', 'warn');
      }
      el.disabled = false;
      el.textContent = texteInitial;
      render();
    },
    'notification-annuler': (el) => {
      const id = el.getAttribute('data-id');
      state.notificationsTraitees = (state.notificationsTraitees || []).filter((x) => x !== id);
      state.notifDerniere = null;
      commit();
      fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ traitees: state.notificationsTraitees }) }).catch(() => {});
      toast('Action remise dans la liste.', 'ok');
    },
    'notification-traiter': async (el) => {
      const id = el.getAttribute('data-id');
      const n = notifications().find((x) => x.id === id);
      state.notifDerniere = n ? { at: Date.now(), id: id, sujet: n.sujet + (n.clientId && client(n.clientId) ? ' — ' + nomClient(client(n.clientId)) : '') } : null;
      state.notificationsTraitees = state.notificationsTraitees || [];
      if (state.notificationsTraitees.indexOf(id) === -1) state.notificationsTraitees.push(id);
      commit();
      fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ traitees: state.notificationsTraitees }) }).catch(() => {});
      toast('Marqué comme fait. Vous pouvez annuler en haut de la liste.', 'ok');
    },
    'notification-whatsapp': (el) => {
      const id = el.getAttribute('data-id');
      const n = notifications().find((x) => x.id === id);
      const c = n && n.clientId ? client(n.clientId) : null;
      if (!c) return;
      modal = whatsappModal(c);
      render();
    },
    'pipeline-deplacer': (el) => {
      const c = client(el.getAttribute('data-id'));
      if (c) { c.pipeline = el.value; commit(); }
      if (c && c.serverId) {
        fetch('/api/leads/' + c.serverId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pipeline: el.value }) }).catch(() => {});
      }
    },
    'proposition-deplacer': (el) => {
      const b = bien(el.getAttribute('data-id'));
      if (b) { b.etapeProposition = el.value; commit(); }
      const serverId = b && (b.serverId || (b.id || '').replace(/^srv-b-/, ''));
      if (serverId) {
        fetch('/api/biens/' + serverId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ etapeProposition: el.value }) }).catch(() => {});
      }
    },
    'whatsapp-preview': (el) => {
      const c = client(el.getAttribute('data-id'));
      if (!c) return;
      modal = whatsappModal(c);
      render();
    },
    'whatsapp-ouvrir': (el) => {
      const tel = el.getAttribute('data-tel');
      const msg = document.getElementById('wa-msg');
      const texte = msg ? msg.value : '';
      window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(texte), '_blank');
      toast('WhatsApp ouvert. Pensez à consigner le contact après échange.', 'info');
    },
    'prospection-message': (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (!b) return;
      modal = prospectionMessageModal(b);
      render();
    },
    'prospection-copier': async () => {
      const ta = document.getElementById('prospection-msg');
      const texte = ta ? ta.value : '';
      if (!texte) return;
      try {
        await navigator.clipboard.writeText(texte);
        toast('Message copié.', 'ok');
      } catch (e) {
        ta.select();
        try { document.execCommand('copy'); toast('Message copié.', 'ok'); } catch (e2) { toast('Copie impossible — sélectionnez le texte manuellement.', 'warn'); }
      }
    },
    'reseau-envoyer': (el, id) => {
      const c = client(id);
      if (!c) return;
      const href = reseauHref(c);
      if (!href) { toast('Numéro indisponible.', 'warn'); return; }
      window.open(href, '_blank');
      // Jamais d'envoi automatique : on ouvre WhatsApp, l'humain clique "Envoyer" lui-même.
      // On avance juste le statut du lead de "à contacter" vers "contacté", et on fait progresser
      // la cadence programmée (J+0 → J+15 → J+45) pour calculer la prochaine échéance de relance.
      // skipCommit=true : window.open() retire le focus du champ de recherche, ce qui peut
      // déclencher un re-rendu concurrent (sur blur) ; on ne committe/rend qu'une seule fois,
      // à la fin, une fois toutes les mutations appliquées, pour éviter une collision de rendu.
      if ((c.pipeline || 'a_contacter') === 'a_contacter') marquerPipeline(c, 'contacte', true);
      avancerCadence(c);
      commit();
      toast('WhatsApp ouvert pour ' + nomClient(c) + '.', 'info');
    },
    'reseau-marquer-masse': (el) => {
      const vers = el.getAttribute('data-vers');
      const ids = $$('.sel-reseau:checked').map((b) => b.getAttribute('data-id'));
      if (!ids.length) return;
      ids.forEach((id) => { const c = client(id); if (c) marquerPipeline(c, vers, true); });
      commit();
      toast(ids.length + ' lead(s) marqué(s) « ' + (PIPELINE_COLS.find(([k]) => k === vers) || [, vers])[1] + ' ».', 'ok');
    },
    'copier-contact': async (el) => {
      const value = el.getAttribute('data-value') || '';
      try {
        await navigator.clipboard.writeText(value);
        toast('Copié : ' + value, 'ok');
      } catch (e) {
        const ta = document.createElement('textarea'); ta.value = value; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast('Copié', 'ok'); } catch (e2) { toast('Copie impossible.', 'warn'); }
        document.body.removeChild(ta);
      }
    },
    'rechercher-telephones': async (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (!b || !b.proprietaire || !b.proprietaire.nom) { toast('Propriétaire SCI non identifié — enrichissez d’abord.', 'warn'); return; }
      const nom = b.proprietaire.nom;
      toast('Recherche des coordonnées publiées (Exa)…');
      const requetes = ['"' + nom + '" téléphone contact', '"' + nom + '" coordonnées siège'];
      const telTrouves = new Set();
      try {
        for (const q of requetes) {
          const r = await fetch('/api/robot/exa-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ query: q }) }).then((x) => x.json());
          if (r.ok && r.results) {
            r.results.forEach((res) => {
              const txt = res.text || '';
              const nums = txt.match(/0[1-9](?:[ .-]?\d{2}){4}/g) || [];
              nums.forEach((n) => telTrouves.add(n.replace(/[ .-]/g, '')));
            });
          }
        }
        const contacts = b.contacts || [];
        telTrouves.forEach((n) => {
          if (!contacts.some((c) => c.type === 'tel' && c.valeur === n)) {
            contacts.push({ type: 'tel', valeur: n, source: 'Exa (publication web)', verification: 'FOUND_UNVERIFIED' });
          }
        });
        b.contacts = contacts;
        commit(); render();
        toast(telTrouves.size ? telTrouves.size + ' numéro(s) trouvé(s) — à vérifier.' : 'Aucun numéro public trouvé.', telTrouves.size ? 'ok' : 'warn');
      } catch (e) { toast('Recherche Exa impossible.', 'warn'); }
    },
    'robot-dvf': async (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (!b) return;
      if (!b.codeInsee || !b.section || !b.numero) { toast('Référence cadastrale incomplète — relancez l’enrichissement pour la récupérer.', 'warn'); return; }
      toast('Lecture DVF en cours…');
      try {
        const r = await fetch('/api/robot/dvf?code_insee=' + encodeURIComponent(b.codeInsee) + '&section=' + encodeURIComponent(b.section) + '&numero=' + encodeURIComponent(b.numero), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.mutations) { b.dvfMutations = r.mutations; commit(); render(); toast(r.avertissement || (r.mutations.length + ' mutation(s) DVF trouvée(s).'), r.avertissement ? 'warn' : 'ok'); }
        else toast(r.error || 'Aucune mutation DVF.', 'warn');
      } catch (e) { toast('Lecture DVF impossible.', 'warn'); }
    },
    'robot-favori': (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (b) { b.favori = !b.favori; commit(); render(); toast(b.favori ? 'Ajouté aux favoris.' : 'Retiré des favoris.', 'ok'); }
    },
    'bodacc-verifier': () => { verifierBodacc(); },
    'robot-cascade': async (el) => { await enrichirCascade(el.getAttribute('data-id')); },
    'voir-maps': (el) => { const b = robotBien(el.getAttribute('data-id')); if (b) ouvrirCarte(b); },
    'pm-importer': async (el) => {
      el.disabled = true;
      try {
        const r = await fetch('/api/robot/pm/importer', { method: 'POST', credentials: 'same-origin' }).then((x) => x.json());
        PM_STATUT = { disponible: false, import: r.import || { enCours: true } };
        toast('Chargement du fichier DGFiP lancé — quelques minutes, la fiche se mettra à jour toute seule.', 'ok');
        suivreImportPm();
      } catch (e) { toast('Impossible de lancer le chargement.', 'warn'); }
      render();
    },
    'robot-associer-lot': (el) => {
      const id = el.getAttribute('data-id');
      const a = AUTO[id];
      const l = a && a.immeuble && a.immeuble.lots[Number(el.getAttribute('data-idx'))];
      const b = l && bienEditable(id);
      if (!b) { toast('Lot introuvable.', 'warn'); return; }
      const ancien = b.proprietaire || {};
      b.proprietaire = { nom: l.nom, type: l.type, siren: l.siren, dirigeants: ancien.siren === l.siren ? (ancien.dirigeants || []) : [] };
      b.etageDgfip = l.niveauLibelle || '';
      b.lotDgfip = lotCle(l);
      b.lotDetail = { batiment: l.batiment, entree: l.entree, porte: l.porte, droit: l.droitLibelle, section: l.section, plan: l.plan };
      if (!b.parcelle && l.section) b.parcelle = (a.immeuble.insee || '') + ' ' + l.section + ' ' + l.plan;
      saveRobotBiens();
      delete AUTO[id];
      commit();
      toast('Bien rattaché à ' + l.nom + (l.niveauLibelle ? ' — ' + l.niveauLibelle : '') + '.', 'ok');
    },
    'robot-associer-societe': (el) => {
      const id = el.getAttribute('data-id');
      const a = AUTO[id];
      const s2 = a && a.societes && a.societes[Number(el.getAttribute('data-idx'))];
      const b = s2 && bienEditable(id);
      if (!b) { toast('Société introuvable.', 'warn'); return; }
      b.proprietaire = { nom: s2.nom, type: s2.type, siren: s2.siren, dirigeants: (s2.dirigeants || []).map((d) => d.nom) };
      saveRobotBiens();
      delete AUTO[id];
      commit();
      toast(s2.nom + ' enregistrée comme propriétaire du bien.', 'ok');
    },
    'celia-toggle': () => {
      const ouverture = !celiaOuvert; // true si on passe de fermé à ouvert
      celiaOuvert = !celiaOuvert;
      // Fermer pendant une écoute en cours l'arrête proprement (sans envoyer
      // ce qui a déjà été dicté : l'agent a changé d'avis en refermant).
      if (!ouverture && celiaRecorder && celiaRecorder.state !== 'inactive') celiaRecorder.stop();
      render();
      setTimeout(() => { const box = document.querySelector('[data-celia-scroll]'); if (box) box.scrollTop = box.scrollHeight; }, 30);
    },
    'celia-reset': () => { state.celiaMessages = []; state.celiaHistorique = []; state.celiaAttente = null; commit(); },
    'celia-micro': () => basculerEcoute(),
    'celia-vocal-toggle': () => basculerVocal(),
    'celia-valider': () => repondreActionCelia(true),
    'celia-refuser': () => repondreActionCelia(false),
    'robot-valorisation': async (el) => { await estimerValorisation(el.getAttribute('data-id')); },
    'chercher-recoupement': async (el) => { await chercherRecoupement(el.getAttribute('data-nom')); },
    'chercher-coordonnees-pro': async (el) => { await chercherCoordonneesPro(el.getAttribute('data-nom'), el.getAttribute('data-societe'), el.getAttribute('data-siren')); },
    'enrichir-linkedin': async (el) => {
      const input = el.closest('.se-row') && el.closest('.se-row').querySelector('input.li-url-input');
      const url = input ? input.value.trim() : '';
      if (!url) { toast('Collez d’abord l’URL du profil LinkedIn confirmé.', 'warn'); return; }
      if (!/^https:\/\/(www\.)?linkedin\.com\/in\//.test(url)) { toast('URL de profil LinkedIn invalide (attendu : linkedin.com/in/…).', 'warn'); return; }
      await enrichirLinkedin(el.getAttribute('data-nom'), url);
    },
    'robot-tache': (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (!b) return;
      const echeance = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      state.taches = state.taches || [];
      state.taches.push({ id: uid('t'), titre: 'Prospecter : ' + (b.adresse || 'bien'), bienId: b.id, echeance: echeance, fait: false });
      commit(); render(); toast('Tâche créée.', 'ok');
    },
    'robot-note': (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (!b) return;
      const texte = (window.prompt('Note :') || '').trim();
      if (!texte) return;
      b.notes = b.notes || [];
      b.notes.push({ texte: texte, date: new Date().toISOString() });
      commit(); render(); toast('Note ajoutée.', 'ok');
    },
    'robot-statut': (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (b) { b.statutProspection = el.getAttribute('data-statut'); commit(); render(); toast('Statut mis à jour.', 'ok'); }
    },
    'dpe-scan-quotidien': async (el) => {
      el.disabled = true;
      const texte = el.textContent;
      el.textContent = 'Scan en cours…';
      try {
        const r = await fetch('/api/robot/dpe/scan-quotidien', { method: 'POST', credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok) {
          const rb = await fetch('/api/robot-biens', { headers: { accept: 'application/json' } }).then((x) => x.json());
          if (rb.ok) {
            if (Array.isArray(rb.dpeAuto)) state.dpeAuto = rb.dpeAuto.map(normalizeRobotBien);
            if (Array.isArray(rb.scanLog)) state.dpeScanLog = rb.scanLog;
          }
          toast(r.resultat.biensAjoutes ? r.resultat.biensAjoutes + ' nouveau(x) bien(s) détecté(s) sur ' + r.resultat.recherchesScannees + ' recherche(s).' : 'Scan terminé — aucun nouveau bien sur ' + r.resultat.recherchesScannees + ' recherche(s) scannée(s).', r.resultat.biensAjoutes ? 'ok' : 'warn');
        } else { toast(r.error || 'Scan impossible.', 'warn'); }
      } catch (e) { toast('Scan impossible.', 'warn'); }
      el.disabled = false;
      el.textContent = texte;
      render();
    },
    'robot-promouvoir': (el) => {
      const id = el.getAttribute('data-id');
      const b = (state.dpeAuto || []).find((x) => x.id === id);
      if (!b) { toast('Bien introuvable.', 'warn'); return; }
      // Copie dans state.robotBiens, qui devient désormais la copie
      // éditable (statut, notes, enrichissement) — l'original reste dans
      // state.dpeAuto comme trace du scan, mais robotBiens() l'exclura de
      // l'affichage dès que cette adresse existe aussi dans state.robotBiens.
      state.robotBiens = (state.robotBiens || []).concat([Object.assign({}, b)]);
      saveRobotBiens();
      render();
      toast('Bien ajouté au Radar — vous pouvez maintenant le travailler.', 'ok');
    },
    'robot-ignorer': (el) => {
      const b = robotBien(el.getAttribute('data-id'));
      if (b) { b.ignore = true; commit(); render(); toast('Bien ignoré — retiré des résultats actifs.', 'ok'); }
    },
    'societe-enrichir': async (el) => {
      const siren = el.getAttribute('data-siren');
      toast('Recherche des dirigeants (SIRENE)…');
      try {
        const r = await fetch('/api/robot/dirigeants?siren=' + encodeURIComponent(siren), { credentials: 'same-origin' }).then((x) => x.json());
        if (r.ok && r.dirigeants) {
          const s = (state.portefeuilleFoncier || []).find((x) => x.siren === siren);
          if (s) { s.dirigeants = r.dirigeants; s.enrichi = new Date().toISOString(); commit(); render(); toast((r.dirigeants.length || 0) + ' dirigeant(s) trouvé(s).', 'ok'); }
        } else toast(r.error || 'Aucun dirigeant.', 'warn');
      } catch (e) { toast('Recherche impossible.', 'warn'); }
    },
    'societe-favori': (el) => {
      const s = (state.portefeuilleFoncier || []).find((x) => x.siren === el.getAttribute('data-siren'));
      if (s) { s.favori = !s.favori; commit(); render(); toast(s.favori ? 'Ajouté aux favoris.' : 'Retiré des favoris.', 'ok'); }
    },
    'societe-tache': (el) => {
      const s = (state.portefeuilleFoncier || []).find((x) => x.siren === el.getAttribute('data-siren'));
      if (s) { state.taches = state.taches || []; state.taches.push({ id: uid('t'), titre: 'Prospecter : ' + (s.denomination || s.siren), echeance: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), fait: false }); commit(); render(); toast('Tâche créée.', 'ok'); }
    },
    'synchroniser-permis': async (el) => { await synchroniserPermis(); },
    'robot-enrichir-masse': async (el) => {
      const aTraiter = robotBiens().filter((b) => b.adresse && (!b.proprietaire || !b.proprietaire.nom));
      if (!aTraiter.length) { toast('Aucune fiche à enrichir.', 'ok'); return; }
      toast('Enrichissement en masse lancé sur ' + aTraiter.length + ' bien(s)…');
      enrichirDpeAuto();
    },
    'robot-priorite-filtre': (el) => {
      const n = el.getAttribute('data-niveau');
      state.robotPriorite = n ? Number(n) : null;
      commit(); render();
    },
    'robot-map-toggle': (el) => {
      state.robotShowMap = !state.robotShowMap;
      render();
      if (state.robotShowMap) setTimeout(initRobot, 60);
    },
    'robot-page': (el) => {
      const p = Number(el.getAttribute('data-page')) || 1;
      state.robotPage = Math.max(1, p);
      commit(); render();
    },
    'robot-filtre-secteur': (el) => {
      state.robotFiltres = state.robotFiltres || {};
      state.robotFiltres.secteur = el.getAttribute('data-sec');
      // Le tableau de bord par secteur vit désormais sur /robot-radar lui-même : si on y est déjà,
      // changer location.hash ne déclenche pas de hashchange (même valeur) donc rien ne se
      // réaffiche. On force le rendu explicitement, et on met aussi à jour le hash pour les cas où
      // ce lien est cliqué depuis une autre vue.
      location.hash = '#/robot-radar';
      render();
    },
    'robot-reset-filtres': () => { state.robotFiltres = {}; render(); },
    'matching-statut': (el) => {
      const key = el.getAttribute('data-key');
      const statut = el.getAttribute('data-statut');
      const m = (state.matchings || []).find((x) => x.key === key);
      if (m) { m.statut = statut; commit(); render(); }
    },
    // Extension demandée des relances J+1/J+3/J+7 : quand un acquéreur et un
    // bien repéré par le robot se correspondent sur la plateforme, l'agent
    // peut programmer les mêmes rappels que pour un nouveau client — un choix
    // explicite (pas automatique) puisqu'un rapprochement n'a pas la même
    // certitude qu'une création de fiche.
    'matching-relancer': (el) => {
      const key = el.getAttribute('data-key');
      const m = (state.matchings || []).find((x) => x.key === key);
      if (!m || m.relancesCreees) return;
      const rec = (state.recherchesServeur || []).concat(state.recherches).find((r) => r.id === m.rechercheId);
      const cli = rec ? clientDeRecherche(rec) : client(m.clientId);
      const rb = robotBien(m.bienId);
      if (!cli) { toast('Client introuvable pour cette correspondance.', 'warn'); return; }
      programmerRelances(cli.id, nomClient(cli), 'correspondance avec ' + ((rb && rb.adresse) || 'un bien'));
      m.relancesCreees = true;
      commit();
      render();
      toast('3 relances programmées (J+1, J+3, J+7).', 'ok');
    },
    'radar-zone': (el) => {
      const q = el.getAttribute('data-id');
      const c = COORDS_CRM[q];
      if (c && window.__radarMap) window.__radarMap.setView(c, 13);
    },
    'bien-envoyer': (el, id, e) => {
      const bienId = el.getAttribute('data-bien') || id;
      const clientId = el.getAttribute('data-client');
      if (bienId && clientId) { modalLarge = true; state.__previewMsg = undefined; modal = previewModal(bienId, clientId); render(); }
    },
    'bien-envoyer-tous': (el) => {
      const bienId = el.getAttribute('data-bien');
      const ids = JSON.parse(el.getAttribute('data-clients') || '[]');
      const b = bien(bienId);
      if (!b || !ids.length) return;
      (async () => {
        let n = 0;
        for (const cid of ids) {
          const c = client(cid);
          if (!c || !c.email) continue;
          try {
            const r = await fetch('/api/biens/' + (b.serverId || b.id) + '/envoi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, nom: c.prenom }) });
            if (r.ok) n++;
          } catch (e) { /* continue */ }
        }
        toast('Emails envoyés à ' + n + ' acquéreur(s).', 'ok');
      })();
    },
    'preview-tab': (el) => {
      const tab = el.getAttribute('data-tab');
      const bienId = el.getAttribute('data-bien');
      const clientId = el.getAttribute('data-client');
      const ta = document.getElementById('preview-msg');
      state.__previewMsg = ta ? ta.value : undefined;
      modal = previewModal(bienId, clientId, tab);
      render();
    },
    'preview-email': async (el) => {
      const bienId = el.getAttribute('data-bien');
      const clientId = el.getAttribute('data-client');
      const b = bien(bienId);
      const c = client(clientId);
      const message = (document.getElementById('preview-msg') ? document.getElementById('preview-msg').value : '');
      if (!b || !c || !c.email) { toast('Email du client introuvable.', 'warn'); return; }
      const dom = (c.email || '').toLowerCase().split('@')[1] || '';
      if (/^(example\.(com|org|net)|test\.com|localhost|invalid\.com|mailinator\.com)$/.test(dom)) { toast('Adresse email invalide ou non délivrable. Veuillez vérifier.', 'warn'); return; }
      try {
        const r = await fetch('/api/biens/' + (b.serverId || b.id) + '/envoi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, nom: c.prenom, message: message }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.emailErreur || res.error || 'Erreur serveur');
        modal = null;
        commit();
        if (res.emailEnvoye === false) toast('Email échoué : ' + (res.emailErreur || 'SMTP'), 'warn');
        else toast('Email envoyé à ' + c.prenom + '.', 'ok');
      } catch (e) { toast('Envoi impossible : ' + (e.message || 'erreur'), 'warn'); }
    },
    'preview-wa': (el) => {
      const clientId = el.getAttribute('data-client');
      const c = client(clientId);
      const message = (document.getElementById('preview-msg') ? document.getElementById('preview-msg').value : '');
      if (!c || !c.tel) { toast('Téléphone du client introuvable.', 'warn'); return; }
      const wa = 'https://wa.me/' + String(c.tel).replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(message);
      window.open(wa, '_blank');
    },
    'renvoyer-email': async (el, id) => {
      if (!id) { toast('Ceci est une fiche de test, veuillez utiliser une vraie candidature.', 'warn'); return; }
      try {
        const r = await fetch('/api/demandes/' + id + '/renvoyer', { method: 'POST' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Erreur');
        if (res.emailEnvoye === false) toast('Email échoué : ' + (res.emailErreur || 'SMTP'), 'warn');
        else toast('Email d’accès renvoyé au client.', 'ok');
      } catch (e) { toast('Envoi impossible : ' + (e.message || 'erreur'), 'warn'); }
    },
    'bien-verifier': async (el, id) => {
      const b = bien(id);
      if (!b || !b.serverId) return;
      state.verifEnCours = state.verifEnCours || {};
      state.verifEnCours[b.serverId] = true; render();
      try {
        const r = await fetch('/api/biens/verifier', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [b.serverId] }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'erreur');
        for (let i = 0; i < 40; i++) {
          await new Promise((ok) => setTimeout(ok, 3000));
          const v = await (await fetch('/api/biens/' + encodeURIComponent(b.serverId) + '/verifs')).json();
          if (!v.enFile) { b.verifs = v.verifs; break; }
        }
        toast('Vérification terminée.', 'ok');
      } catch (e) { toast('Vérification impossible : ' + (e.message || 'erreur'), 'warn'); }
      delete state.verifEnCours[b.serverId]; render();
    },
    'import-fiches-go': async () => {
      const f = state.impFiches;
      if (!f || !f.items) return;
      f.envoi = '0 / ' + f.items.length; render();
      try {
        f.fait = await envoyerFiches(f.items, f.lot, false, (n, t) => { f.envoi = n + ' / ' + t; render(); });
        f.items = []; f.envoi = '';
        const rb = await fetch('/api/biens', { headers: { accept: 'application/json' } });
        if (rb.ok) state.biensServeur = ((await rb.json()).biens || []).map(mapBienServeur);
        await fetch('/api/biens/verifier', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lot: f.lot }) });
        state.verifLot = true; suivreVerifLot();
        toast('Import terminé.', 'ok');
      } catch (e) { f.envoi = ''; toast('Import interrompu : ' + (e.message || 'erreur') + '. Relancez : les fiches déjà importées ne seront pas dupliquées.', 'warn'); }
      render();
    },
    'biens-verifier-tous': async () => {
      const ids = (state.biensServeur || []).filter((b) => b.importLot && !b.verifs).map((b) => b.serverId);
      if (!ids.length) { toast('Tous les biens importés sont déjà vérifiés.', 'ok'); return; }
      try {
        const r = await fetch('/api/biens/verifier', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ids }) });
        const res = await r.json();
        toast(res.ajoutes + ' bien(s) en cours de vérification, en arrière-plan (environ ' + Math.max(1, Math.round(res.enAttente * 6 / 60)) + ' min).', 'ok');
        state.verifLot = true; render(); suivreVerifLot();
      } catch (e) { toast('Lancement impossible', 'warn'); }
    },
    'exclusivite-scan': async (el, id) => {
      const b = bien(id);
      const serverId = b ? (b.serverId || b.id) : id;
      try {
        const r = await fetch('/api/biens/' + serverId + '/exclusivite-scan', { method: 'POST' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Erreur');
        if (b && res.exclusivite) b.exclusivite = res.exclusivite;
        commit();
        if (res.exclusivite && res.exclusivite.erreur) toast('Scan : ' + res.exclusivite.erreur, 'warn');
        else if (res.exclusivite && res.exclusivite.statut === 'alerte_doublon') toast('Alerte : ' + ((res.exclusivite.liens || []).length) + ' annonce(s) suspecte(s).', 'warn');
        else if (res.exclusivite && res.exclusivite.statut === 'verifie_exclusif') toast('Scan terminé : aucun doublon trouvé.', 'ok');
        else toast('Scan lancé.', 'ok');
      } catch (e) { toast('Scan impossible : ' + (e.message || 'erreur'), 'warn'); }
    },
    'doc-valider': async (el, id) => {
      try {
        const r = await fetch('/api/documents/' + id, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ statut: 'valide' })
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        Object.keys(state.docsParLead).forEach((k) => {
          (state.docsParLead[k] || []).forEach((d) => { if (d.id === id) d.statut = 'valide'; });
        });
        commit();
        toast('Pièce validée, client prévenu.', 'ok');
        ouvrirNotifieModal(res.notif, 'Pièce validée');
      } catch (e) { toast('Validation impossible.', 'warn'); }
    },
    'doc-refuser': async (el, id) => {
      try {
        const r = await fetch('/api/documents/' + id, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ statut: 'refuse' })
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        Object.keys(state.docsParLead).forEach((k) => {
          (state.docsParLead[k] || []).forEach((d) => { if (d.id === id) d.statut = 'refuse'; });
        });
        commit();
        toast('Pièce refusée, client prévenu.', 'warn');
        ouvrirNotifieModal(res.notif, 'Pièce refusée');
      } catch (e) { toast('Action impossible.', 'warn'); }
    },
    'market-scan': async (el, id) => {
      const b = bien(id);
      if (!b) return;
      const adresse = b.adresse || (b.titre ? b.titre + ', ' + qLabel(b.quartier) : qLabel(b.quartier));
      if (!adresse) { toast('Renseignez l’adresse du bien avant de scanner.', 'warn'); return; }
      state.scan = { id: id, loading: true };
      render();
      try {
        const r = await fetch('/api/market-search?adresse=' + encodeURIComponent(adresse) + '&surface=' + (b.surface || 0) + '&prix=' + (b.prix || 0), { headers: { accept: 'application/json' } });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Scan impossible');
        state.scan = { id: id, loading: false, data: d };
      } catch (e) {
        state.scan = { id: id, loading: false, error: (e.message || 'Scan impossible — réessayez.') };
      }
      render();
    },
    'statut-valider': (el, id) => {
      const d = state.demandes.find((x) => x.id === id);
      if (!d) return;
      if (d.serveur && d.serverDemandeId) {
        fetch('/api/demandes/' + d.serverDemandeId, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ statut: 'traitee', action: d.role })
        }).then(async (r) => {
          const res = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error('Erreur');
          d.statut = 'traitee';
          commit();
          toast('Demande validée côté membre, client prévenu.', 'ok');
          ouvrirNotifieModal(res.notif, 'Demande validée');
        }).catch(() => toast('Validation impossible.', 'warn'));
        return;
      }
      const cible = d.statut === 'ouvert' ? 'ouvert' : 'avant-premiere';
      const biens = readBiensMembres();
      const i = biens.findIndex((b) => (b.email || '').toLowerCase() === (d.email || '').toLowerCase());
      if (i > -1) { biens[i].statut = cible; biens[i].statutDemande = null; writeBiensMembres(biens); }
      d.statut = 'traitee';
      state.membresBiens = biens.map((b) => Object.assign({}, b, { label: qLabel(b.quartier) }));
      commit();
      toast(cible === 'ouvert' ? 'Validé : le bien passe en visite possible. Les abonnés sont notifiés.' : 'Validé : retour en avant-première.', 'ok');
    },
    'visite-confirmer': (el, id) => {
      const v = state.visites.find((x) => x.id === id);
      if (v) { v.statut = 'confirmee'; commit(); toast('Visite confirmée.'); }
    },
    'visite-annuler': (el, id) => {
      const v = state.visites.find((x) => x.id === id);
      if (v) { v.statut = 'annulee'; commit(); toast('Visite annulée.'); }
    },
    'offre-acceptee': (el, id) => {
      const o = state.offres.find((x) => x.id === id);
      if (!o) return;
      o.statut = 'acceptee';
      state.offres.forEach((x) => { if (x !== o && x.bienId === o.bienId && (x.statut === 'recue' || x.statut === 'en_attente')) x.statut = 'refusee'; });
      const b = bien(o.bienId);
      if (b) b.statut = o.serveur ? 'sous-compromis' : 'sous-offre';
      commit();
      if (o.serveur && o.serverId) {
        fetch('/api/offres/' + o.serverId + '/accepter', { method: 'POST', credentials: 'same-origin' }).then(syncServeur).catch(() => {});
      }
      toast('Offre acceptée. Le bien passe en « sous ' + (o.serveur ? 'compromis' : 'offre') + ' ».', 'ok');
    },
    'offre-refusee': (el, id) => {
      const o = state.offres.find((x) => x.id === id);
      if (!o) return;
      o.statut = 'refusee';
      commit();
      if (o.serveur && o.serverId) {
        fetch('/api/offres/' + o.serverId + '/refuser', { method: 'POST', credentials: 'same-origin' }).then(syncServeur).catch(() => {});
      }
      toast('Offre refusée.');
    },
    'message-ouvrir': (el, id) => { location.hash = '#/messages/' + id; },
    'visite-ajouter-photo': (el, id) => {
      const b = (state.biensServeur || []).find((x) => x.serverId === id); if (!b) return;
      brouillonVisite(b).push({ piece: '', image: el.getAttribute('data-url'), mode: 'photo' });
      render();
    },
    'visite-monter': (el, id) => { const l = state.visiteEdition[id]; const i = Number(el.getAttribute('data-i')); if (i > 0) { const x = l[i]; l[i] = l[i - 1]; l[i - 1] = x; } render(); },
    'visite-descendre': (el, id) => { const l = state.visiteEdition[id]; const i = Number(el.getAttribute('data-i')); if (i < l.length - 1) { const x = l[i]; l[i] = l[i + 1]; l[i + 1] = x; } render(); },
    'visite-retirer': (el, id) => { state.visiteEdition[id].splice(Number(el.getAttribute('data-i')), 1); render(); },
    'visite-enregistrer': async (el, id) => {
      const publie = el.getAttribute('data-publie') === '1';
      const etapes = state.visiteEdition[id] || [];
      try {
        const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/visite', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ etapes: etapes, publie: publie }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Enregistrement impossible');
        const b = (state.biensServeur || []).find((x) => x.serverId === id);
        if (b) { b.visite = res.visite; b.panoramas = res.panoramas; }
        state.visiteEdition[id] = res.visite.etapes.map((e) => Object.assign({}, e));
        toast(publie ? 'Visite virtuelle publiée sur la fiche.' : 'Visite enregistrée (non publiée).', 'ok');
      } catch (err) { toast(err.message || 'Enregistrement impossible', 'warn'); }
      render();
    },
    'video-generer': async (el, id) => {
      const b = (state.biensServeur || []).find((x) => x.serverId === id);
      if (!b || state.videoEnCours) return;
      const O = videoOptions(id);
      const formats = ['horizontal', 'vertical'].filter((f) => O.formats[f]);
      state.videoEnCours = id; state.videoApercu = state.videoApercu || {};
      for (const fmt of formats) {
        state.videoFormatEnCours = fmt; state.videoProgres = 0; render();
        try {
          let dernier = 0;
          const res = await genererHomeTour(b, (p) => {
            state.videoProgres = p;
            if (p - dernier > 0.04 || p === 1) {
              dernier = p;
              const barre = document.querySelector('.se-video-progres i'); if (barre) barre.style.width = Math.round(p * 100) + '%';
              const st = document.querySelector('[data-video-statut]'); if (st) st.textContent = 'Création ' + (fmt === 'vertical' ? 'du format réel' : 'du format plateforme') + '… ' + Math.round(p * 100) + ' %';
            }
          }, { format: fmt, options: O });
          const cle = id + '|' + fmt;
          if (state.videoApercu[cle]) URL.revokeObjectURL(state.videoApercu[cle].url);
          state.videoApercu[cle] = { url: URL.createObjectURL(res.blob), blob: res.blob, type: res.type };
        } catch (err) { toast(err.message || 'Création impossible', 'warn'); break; }
      }
      state.videoEnCours = null; state.videoFormatEnCours = null; render();
      toast('Vidéos prêtes : regardez-les, puis publiez-les.', 'ok');
    },
    'video-oublier': (el, id) => {
      const cle = id + '|' + (el.getAttribute('data-format') || 'horizontal');
      if (state.videoApercu && state.videoApercu[cle]) { URL.revokeObjectURL(state.videoApercu[cle].url); delete state.videoApercu[cle]; }
      render();
    },
    'video-publier': async (el, id) => {
      const fmt = el.getAttribute('data-format') || 'horizontal';
      const cle = id + '|' + fmt;
      const ap = state.videoApercu && state.videoApercu[cle];
      if (!ap) return;
      el.disabled = true; el.textContent = 'Envoi…';
      try {
        const O = videoOptions(id);
        const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/video?publier=1&format=' + fmt + '&options=' + encodeURIComponent(JSON.stringify(O)), { method: 'POST', headers: { 'content-type': ap.type }, body: ap.blob });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Envoi impossible');
        const b = (state.biensServeur || []).find((x) => x.serverId === id); if (b) b[res.champ] = res.video;
        URL.revokeObjectURL(ap.url); delete state.videoApercu[cle];
        toast(fmt === 'vertical' ? 'Réel publié : il apparaît dans la page « Vidéos » de la plateforme.' : 'Vidéo publiée sur la fiche du bien.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible', 'warn'); }
      render();
    },
    'video-visibilite': async (el, id) => {
      const fmt = el.getAttribute('data-format') || 'horizontal'; const champ = fmt === 'vertical' ? 'videoVerticale' : 'video';
      const b = (state.biensServeur || []).find((x) => x.serverId === id); if (!b || !b[champ]) return;
      const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/video?format=' + fmt, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publie: !b[champ].publie }) });
      const res = await r.json().catch(() => ({}));
      if (r.ok) { b[champ] = res.video; toast(res.video.publie ? 'Vidéo publiée.' : 'Vidéo retirée de la plateforme.', 'ok'); } else toast(res.error || 'Erreur', 'warn');
      render();
    },
    'video-supprimer': async (el, id) => {
      const fmt = el.getAttribute('data-format') || 'horizontal'; const champ = fmt === 'vertical' ? 'videoVerticale' : 'video';
      const b = (state.biensServeur || []).find((x) => x.serverId === id); if (!b) return;
      if (!el.dataset.confirme) { el.dataset.confirme = '1'; el.textContent = 'Confirmer la suppression'; return; }
      const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/video?format=' + fmt, { method: 'DELETE' });
      if (r.ok) { b[champ] = null; toast('Vidéo supprimée.', 'ok'); } else toast('Suppression impossible', 'warn');
      render();
    },
    'editorial-generer': async (el, id) => {
      const form = el.closest('form');
      state.editorialBrouillon = state.editorialBrouillon || {};
      state.editorialEnCours = id;
      render();
      try {
        const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/editorial/generer', { method: 'POST', headers: { 'content-type': 'application/json' } });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Rédaction impossible');
        state.editorialBrouillon[id] = { titre: res.titre, texte: res.texte };
        if (res.sansIa) toast('Célia est indisponible pour l’instant (quota de l’IA atteint) : voici un premier jet construit à partir de la fiche, à retoucher avant de publier.', 'warn');
        else toast('Célia a rédigé une proposition' + (res.photosAnalysees ? ' (' + res.photosAnalysees + ' photo' + (res.photosAnalysees > 1 ? 's' : '') + ' analysée' + (res.photosAnalysees > 1 ? 's' : '') + ')' : '') + '. Relisez avant de publier.', 'ok');
      } catch (err) { toast(err.message || 'Rédaction impossible', 'warn'); }
      state.editorialEnCours = null;
      render();
    },
    'export-clients': () => {
      download('clients.csv', csv(state.clients.map((c) => Object.assign({}, c, { quartiers: (c.quartiers || []).map(qLabel).join(' / ') })), ['id', 'prenom', 'nom', 'email', 'tel', 'type', 'statut', 'budgetMin', 'budgetMax', 'piecesMin', 'surfaceMin', 'quartiers', 'agent']), 'text/csv');
      toast('Export clients prêt.');
    },
    'export-biens': () => {
      download('biens.csv', csv(state.biens.map((b) => Object.assign({}, b, { quartier: qLabel(b.quartier), proprietaire: nomClient(client(b.proprietaireId)) })), ['id', 'ref', 'titre', 'type', 'quartier', 'surface', 'pieces', 'prix', 'statut', 'proprietaire']), 'text/csv');
      toast('Export biens prêt.');
    },
    'export-json': () => { download('seecret-crm.json', JSON.stringify(state, null, 2), 'application/json'); toast('Sauvegarde prête.'); },
    'reset': () => {
      if (!confirm('Réinitialiser le CRM ? Toutes les données locales seront effacées.')) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      state = seed(); mergeShared(state); render(); toast('CRM réinitialisé.');
    },
    'bien-statut': (el, id) => {
      const b = bien(id);
      if (!b) return;
      // Bien du serveur : le statut se change dans le formulaire (enregistré
      // côté serveur), pas par un simple cycle local qui n'était pas sauvegardé.
      if (b.serverId) { modal = bienModal(b); render(); return; }
      const order = ST_BIEN_CHOIX();
      b.statut = order[(order.indexOf(b.statut) + 1) % order.length];
      commit();
      toast('Statut : ' + ST_BIEN[b.statut].label);
    }
  };

  /* ================================ events =============================== */

  document.addEventListener('click', (e) => {
    // Ne pas intercepter les clics sur les boutons submit : laisse le formulaire se soumettre.
    if (e.target.closest('button[type="submit"], input[type="submit"]')) return;
    const el = e.target.closest('[data-act]');
    if (!el) return;
    // Un élément interne sans data-act (ex: un lien <a href="#/..."> dans le
    // menu "Plus") ne doit jamais remonter jusqu'à l'action du fond de modale
    // (data-act="modal-close") simplement parce qu'il est affiché dedans :
    // ça annulait sa navigation native sans rien faire d'autre. On ignore un
    // data-act trouvé hors de la zone "data-stop" qui contient le clic.
    const zoneProtegee = e.target.closest('[data-stop]');
    if (zoneProtegee && !zoneProtegee.contains(el)) return;
    const fn = actions[el.getAttribute('data-act')];
    if (!fn) return;
    e.preventDefault();
    fn(el, el.getAttribute('data-id'), e);
  });

  document.addEventListener('tri-photos', (e) => {
    const cle = String(e.detail.cle || '');
    if (cle.indexOf('crm:') !== 0) return;
    const b = bien(cle.slice(4)); if (!b || !b.serveur) return;
    const p = window.TriPhotos.reordonner(b.photos || [], e.detail.de, e.detail.vers);
    enregistrerBien(b, { photos: p }, e.detail.vers === 0 ? 'Nouvelle photo principale.' : 'Ordre des photos enregistré.');
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-match-propose]');
    if (a) { state.matchsProposes = state.matchsProposes || {}; state.matchsProposes[a.getAttribute('data-match-propose')] = new Date().toISOString(); save(); setTimeout(render, 300); }
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-video-opt')) { videoOptions(t.getAttribute('data-id'))[t.getAttribute('data-video-opt')] = t.checked; render(); return; }
    if (t.hasAttribute('data-video-format')) { videoOptions(t.getAttribute('data-id')).formats[t.getAttribute('data-video-format')] = t.checked; render(); return; }
    if (t.hasAttribute('data-coord-outil')) { radar.coordChoix = radar.coordChoix || {}; radar.coordChoix[t.getAttribute('data-coord-outil')] = t.checked; render(); }
    else if (t.hasAttribute('data-coord-tout')) { radar.coordChoix = radar.coordChoix || {}; radar.coordChoix._tout = t.checked; render(); }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.hasAttribute('data-rdf')) { const k = e.target.getAttribute('data-rdf'); radar[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; rdMajBouton(); return; }
    if (e.target.hasAttribute('data-import-fichier')) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      imp = { nom: f.name, chargement: true, lot: 'Import ' + new Date().toLocaleDateString('fr-FR') };
      render();
      try {
        if (!/\.(csv|txt)$/i.test(f.name)) await chargerXlsx();
        const t = await window.ImportClients.lireFichier(f);
        imp = { nom: f.name, lot: imp.lot, entetes: t.entetes, lignes: t.lignes, corresp: window.ImportClients.devinerCorrespondance(t.entetes) };
        importAppliquer();
      } catch (err) { imp = { nom: f.name, erreur: 'Lecture impossible : ' + err.message }; render(); }
      return;
    }
    if (e.target.hasAttribute('data-sci-f')) { sci[e.target.getAttribute('data-sci-f')] = e.target.value; sci.page = 1; sciCharger(); return; }
    if (e.target.hasAttribute('data-sci-c')) { sci[e.target.getAttribute('data-sci-c')] = e.target.checked; sci.page = 1; sciCharger(); return; }
    if (e.target.hasAttribute('data-import-fiches')) {
      const fichiers = Array.from(e.target.files || []);
      if (!fichiers.length) return;
      state.impFiches = { chargement: true, fichiers: fichiers.map((f) => f.name) }; render();
      try {
        let items = []; let lot = '';
        for (const f of fichiers) {
          const d = JSON.parse(await f.text());
          items = items.concat(d.items || []); lot = lot || d.lot || '';
        }
        const sim = await envoyerFiches(items, lot, true);
        state.impFiches = { fichiers: fichiers.map((f) => f.name), items: items, lot: lot || 'fiches-vendeurs', sim: sim };
      } catch (err) { state.impFiches = { erreur: 'Lecture impossible : ' + err.message }; }
      render();
      return;
    }
    if (e.target.hasAttribute('data-bien-photos')) {
      const b = bien(e.target.getAttribute('data-bien-photos'));
      const fichiers = Array.from(e.target.files || []);
      if (!b || !fichiers.length) return;
      const fd = new FormData(); fichiers.slice(0, 8).forEach((f) => fd.append('photos', f));
      state.photoEnvoi = b.id; render();
      try {
        const r = await fetch('/api/biens/' + encodeURIComponent(b.serverId) + '/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'erreur');
        b.photos = res.photos || b.photos;
        toast(fichiers.length > 1 ? fichiers.length + ' photos ajoutées.' : 'Photo ajoutée.', 'ok');
      } catch (err) { toast('Envoi impossible : ' + (err.message || 'erreur'), 'warn'); }
      state.photoEnvoi = null; render();
      return;
    }
    if (e.target.hasAttribute('data-pano')) {
      const id = e.target.getAttribute('data-pano');
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const charger = () => new Promise((ok) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => ok(null); img.src = URL.createObjectURL(f); });
      const img = await charger();
      if (!img) { toast('Image illisible.', 'warn'); return; }
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio < 1.9 || ratio > 2.1) toast('Attention : un panorama 360° doit être deux fois plus large que haut (celui-ci fait ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px). Il risque d’être déformé.', 'warn');
      state.panoEnvoi = id; render();
      try {
        const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/panorama', { method: 'POST', headers: { 'content-type': f.type || 'image/jpeg' }, body: f });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Envoi impossible');
        const b = (state.biensServeur || []).find((x) => x.serverId === id);
        if (b) { b.panoramas = (b.panoramas || []).concat([res.url]); brouillonVisite(b).push({ piece: '', image: res.url, mode: '360' }); }
        toast('Panorama ajouté. Nommez la pièce puis enregistrez.', 'ok');
      } catch (err) { toast(err.message || 'Envoi impossible', 'warn'); }
      state.panoEnvoi = null; render();
      return;
    }
    if (e.target.matches('form[data-form="client"] [name="natureLead"]')) {
      const soc = e.target.value !== 'personne';
      const bloc = e.target.form.querySelector('[data-si-societe]'); if (bloc) bloc.hidden = !soc;
      const lib = e.target.form.querySelector('[data-libelle-personne]'); if (lib) lib.textContent = soc ? 'La personne qui représente la société (c’est elle que vous contactez) :' : 'La personne :';
    }
    if (e.target.matches('form[data-form="bien"] [name="statut"]')) {
      const aide = e.target.form.querySelector('[data-aide-statut]'); if (aide) aide.textContent = ((ST_BIEN[e.target.value] || {}).aide || '') + ' Passer en Avant-première ou En vente valide le bien et le publie sur la plateforme.';
      const bloc = e.target.form.querySelector('[data-si-vendu]');
      if (bloc) bloc.hidden = e.target.value !== 'vendu';
    }
    if (e.target.matches('[data-act="client-reattribuer"]')) {
      const select = e.target;
      const serverId = select.getAttribute('data-id');
      const agentId = select.value || null;
      select.disabled = true;
      try {
        const r = await fetch('/api/leads/' + serverId, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Erreur serveur');
        const c = state.clients.find((x) => x.serverId === serverId);
        if (c) c.agentId = agentId;
        toast(agentId ? 'Client attribué.' : 'Client désattribué (visible par vous seul).', 'ok');
      } catch (e2) { toast('Erreur : ' + (e2.message || 'serveur'), 'warn'); }
      select.disabled = false;
    }
    if (e.target.classList.contains('sel-tous')) {
      document.querySelectorAll('.sel-acq').forEach((b) => { b.checked = e.target.checked; });
    }
    if (e.target.classList.contains('sel-tous') || e.target.classList.contains('sel-acq')) {
      const n = document.querySelectorAll('.sel-acq:checked').length;
      const btn = document.getElementById('btn-envoi-sel');
      if (btn) btn.textContent = n ? ('Envoyer à la sélection (' + n + ')') : 'Envoyer à tous les matchs';
    }
    if (e.target.classList.contains('sel-tous-reseau')) {
      $$('.sel-reseau').forEach((b) => { b.checked = e.target.checked; });
    }
    if (e.target.classList.contains('sel-tous-reseau') || e.target.classList.contains('sel-reseau')) {
      const n = $$('.sel-reseau:checked').length;
      const bar = document.getElementById('reseau-bulkbar');
      const count = document.getElementById('reseau-bulk-count');
      if (bar) bar.hidden = n === 0;
      if (count) count.textContent = n + ' sélectionné(s)';
    }
    if (e.target.matches('[data-rf]')) {
      const key = e.target.getAttribute('data-rf');
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      state.robotFiltres = state.robotFiltres || {};
      state.robotFiltres[key] = v;
      commit(); render();
    }
    if (e.target.matches('[data-dpe-toutes]')) {
      const on = e.target.checked;
      document.querySelectorAll('input[name="classe"]').forEach((b) => { b.checked = on; });
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.getAttribute('data-form');
    const data = new FormData(form);
    const chiffres = (v) => Number(String(v || '').replace(/[^\d.-]/g, '')) || 0;

    if (kind === 'invite-agent') {
      const body = { prenom: String(data.get('prenom') || '').trim(), nom: String(data.get('nom') || '').trim(), email: String(data.get('email') || '').trim() };
      try {
        const r = await fetch('/api/agents/inviter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Erreur serveur');
        form.reset();
        toast('Invitation envoyée à ' + body.email + '.', 'ok');
        syncAgents();
      } catch (e) { toast('Erreur : ' + (e.message || 'serveur'), 'warn'); }
      return;
    }

    if (kind === 'client') {
      const id = form.getAttribute('data-id');
      const existing = id ? client(id) : null;
      const obj = {
        id: id || uid('c'), type: data.get('type'), natureLead: data.get('natureLead') || 'personne',
        civilite: data.get('civilite') || '', prenom: String(data.get('prenom') || '').trim(),
        nom: String(data.get('nom') || '').trim(), email: String(data.get('email') || ''), tel: String(data.get('tel') || ''),
        adresse: String(data.get('adresse') || '').trim(),
        raisonSociale: String(data.get('raisonSociale') || '').trim(), siren: String(data.get('siren') || '').trim(),
        representant: String(data.get('representant') || '').trim(),
        statut: data.get('statut'), source: data.get('source'),
        notes: String(data.get('notes') || ''),
        tags: existing ? existing.tags : [], agent: state.agent.prenom + ' ' + state.agent.nom,
        cree: id ? (existing ? existing.cree : nowISO()) : nowISO()
      };
      if (!obj.nom && !obj.prenom) { toast('Un nom est nécessaire.', 'warn'); return; }
      if (existing && existing.serverId) {
        try {
          const r = await fetch('/api/leads/' + existing.serverId, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
          const res = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(res.error || 'Erreur serveur');
          Object.assign(existing, obj);
          modal = null; commit();
          toast('Modifications enregistrées.', 'ok');
        } catch (e) { toast('Erreur : ' + (e.message || 'serveur'), 'warn'); }
        return;
      }
      if (id) { journaliserLocal('lead', existing, obj); Object.assign(existing, obj); }
      else {
        // Un nouveau client vit désormais d'emblée côté serveur (et non plus
        // seulement dans le localStorage du navigateur) : c'est ce qui permet
        // au super-admin de le réattribuer plus tard à un agent, et à un
        // agent de ne voir que ses propres clients. `projet` (acquereur/
        // vendeur/mixte) est le champ serveur équivalent à `type` ici — ne
        // pas confondre avec le `type` serveur qui désigne le propriétaire
        // (personne/SCI) pour les leads venus du Radar.
        try {
          const r = await fetch('/api/leads', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(Object.assign({}, obj, {
              projet: obj.type === 'vendeur' ? 'vendeur' : obj.type === 'mixte' ? 'mixte' : 'acquereur',
              type: undefined
            }))
          });
          const res = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(res.error || 'Erreur serveur');
          obj.serverId = res.lead.id;
        } catch (e) { toast('Enregistré en local seulement (' + (e.message || 'erreur serveur') + ') — invisible des autres agents pour l’instant.', 'warn'); }
        state.clients.push(obj);
        programmerRelances(obj.id, nomClient(obj));
      }
      commit();
      if (id) {
        modal = null;
        toast('Modifications enregistrées.', 'ok');
        location.hash = '#/client/' + obj.id;
      } else {
        // Suite logique : on propose tout de suite de créer le bien et/ou
        // la recherche de ce lead, plutôt que de le laisser filer sur sa
        // fiche sans suite (cf. retour explicite : lead → bien/recherche).
        modal = suiteLeadModal(obj);
        toast('Lead enregistré. 3 relances programmées (J+1, J+3, J+7).', 'ok');
      }
      render();
      return;
    }

    if (kind === 'celia') {
      const texte = String(data.get('texte') || '').trim();
      form.reset();
      await envoyerMessageCelia(texte);
      return;
    }

    if (kind === 'demande-edit') {
      const id = form.getAttribute('data-id');
      const d = state.demandes.find((x) => x.id === id || x.serverDemandeId === id);
      if (!d) return;
      d.nom = String(data.get('nom') || '');
      d.email = String(data.get('email') || '');
      d.message = String(data.get('message') || '');
      if (data.get('prix') !== null) d.prix = Number(data.get('prix')) || 0;
      commit();
      toast('Fiche mise à jour.', 'ok');
      return;
    }

    if (kind === 'visite-confirmer') {
      const date = String(data.get('date') || ''), heure = String(data.get('heure') || '');
      if (!date || !heure) { toast('Indiquez la date et l’heure.', 'warn'); return; }
      await confirmerVisite(form.getAttribute('data-id'), date, heure);
      return;
    }

    if (kind === 'suspendre') {
      const id = form.getAttribute('data-id');
      const motif = String(data.get('motif') || '').trim();
      const ta = form.querySelector('textarea[name="motif"]');
      if (!motif) {
        if (ta) { ta.style.borderColor = 'var(--color-alert)'; ta.style.borderWidth = '2px'; }
        toast('Indiquez un motif de suspension.', 'warn');
        return;
      }
      if (ta) { ta.style.borderColor = ''; ta.style.borderWidth = ''; }
      modal = null;
      await decisionDemande(id, 'suspendre', motif);
      return;
    }

    if (kind === 'offre-contre') {
      const offreId = form.getAttribute('data-offre');
      const contre = Number(data.get('contre')) || 0;
      try {
        const r = await fetch('/api/offres/' + offreId + '/contre', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contre: contre })
        });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Erreur');
        const d = state.demandes.find((x) => (x.offreId === offreId) || x.id === offreId || x.serverDemandeId === offreId);
        if (d && res.contre) {
          d.__whatsapp = 'https://wa.me/' + String(res.tel || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent('Bonjour ' + (res.prenom || '') + ', nous vous proposons une contre-offre de ' + res.contre + ' €. Souhaitez-vous en discuter ?');
        }
        modal = null;
        commit();
        toast('Contre-offre enregistrée.', 'ok');
      } catch (e) { toast('Action impossible.', 'warn'); }
      return;
    }

    if (kind === 'bien') {
      const id = form.getAttribute('data-id');
      const existing = id ? bien(id) : null;
      const obj = {
        id: id || uid('b'), ref: String(data.get('ref') || ''), titre: String(data.get('titre') || 'Bien').trim(),
        adresse: String(data.get('adresse') || '').trim(),
        type: data.get('type'), quartier: data.get('quartier'), surface: chiffres(data.get('surface')),
        pieces: chiffres(data.get('pieces')), chambres: chiffres(data.get('chambres')), sdb: chiffres(data.get('sdb')),
        etage: etageSaisie(data.get('etage')), dpe: data.get('dpe'),
        anneeConstruction: chiffres(data.get('anneeConstruction')) || null, prix: chiffres(data.get('prix')),
        ges: String(data.get('ges') || ''), etat: String(data.get('etat') || ''), exterieur: String(data.get('exterieur') || ''),
        surfaceExterieur: chiffres(data.get('surfaceExterieur')), charges: chiffres(data.get('charges')), ascenseur: data.get('ascenseur') === 'on',
        tauxHonoraires: String(data.get('tauxHonoraires') || '').trim() === '' ? null : Number(String(data.get('tauxHonoraires')).replace(',', '.')),
        statut: data.get('statut'), proprietaireId: data.get('proprio') || null,
        venduParAgence: data.get('statut') === 'vendu' && data.get('venduParAgence') ? data.get('venduParAgence') === 'oui' : undefined,
        exclusivite: { statut: 'scan_en_cours', liens: [] },
        description: String(data.get('description') || ''),
        atouts: existing ? existing.atouts : [],
        photos: existing ? existing.photos : ['home-1.jpg'],
        mandat: existing ? existing.mandat : { type: 'simple', fin: '2027-06-30' },
        cree: existing ? existing.cree : nowISO()
      };
      if (!obj.titre || !obj.prix) { toast('Titre et prix sont nécessaires.', 'warn'); return; }
      if (!obj.proprietaireId) { toast('Un propriétaire (lead) est nécessaire pour créer ce bien.', 'warn'); return; }
      if (existing && existing.serverId) {
        try {
          const r = await fetch('/api/biens/' + existing.serverId, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
          const res = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(res.error || 'Erreur serveur');
          Object.assign(existing, obj);
          if (res.bien && Array.isArray(res.bien.historiquePrix)) existing.historiquePrix = res.bien.historiquePrix;
          if (res.bien) { existing.validation = res.bien.validation || existing.validation; if (typeof res.bien.surSeecret === 'boolean') existing.surSeecret = res.bien.surSeecret; existing.statut = res.bien.statut || existing.statut; }
          modal = null; commit();
          toast(res.notif ? 'Bien validé et publié : le vendeur est prévenu.' : 'Modifications enregistrées.', 'ok');
          if (res.notif) ouvrirNotifieModal(res.notif, 'Bien en ligne');
        } catch (e) { toast('Erreur : ' + (e.message || 'serveur'), 'warn'); }
        return;
      }
      if (id) { journaliserLocal('bien', existing, obj); Object.assign(existing, obj); }
      else {
        // Un nouveau bien vit désormais d'emblée côté serveur (et non plus
        // seulement dans le localStorage de l'agent) : avant ce correctif,
        // aucune route de création n'existait, donc "Valider" échouait en
        // 404 sur un bien jamais synchronisé, et un bien validé ne pouvait
        // jamais apparaître dans le catalogue de la plateforme.
        const proprio = client(obj.proprietaireId);
        if (proprio && proprio.serverId) {
          try {
            const r = await fetch('/api/biens', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(Object.assign({}, obj, { proprietaireId: proprio.serverId }))
            });
            const res = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(res.error || 'Erreur serveur');
            obj.serverId = res.bien.id;
          } catch (e) {
            toast('Enregistré en local seulement (' + (e.message || 'erreur serveur') + ') — ne pourra pas être validé ni publié tant qu’il n’est pas synchronisé.', 'warn');
          }
        } else {
          toast('Propriétaire non synchronisé : ce bien reste local pour l’instant et ne pourra pas être validé ni publié.', 'warn');
        }
        state.biens.push(obj);
      }
      commit();
      if (id) {
        modal = null;
        toast('Modifications enregistrées.', 'ok');
        location.hash = '#/bien/' + obj.id;
      } else {
        const proprio = client(obj.proprietaireId);
        if (proprio && (proprio.type === 'acquereur' || proprio.type === 'mixte')) {
          // Suite logique : ce propriétaire est aussi acquéreur — on propose
          // de créer sa recherche tout de suite plutôt que de l'oublier.
          modal = suiteBienModal(obj, proprio);
        } else {
          modal = null;
          location.hash = '#/bien/' + obj.id;
        }
        toast('Bien enregistré.', 'ok');
      }
      render();
      return;
    }

    if (kind === 'recherche') {
      const id = form.getAttribute('data-id');
      const existing = id ? recherche(id) : null;
      const types = $$('.se-chip[data-group="types"][aria-pressed="true"]', form).map((c) => c.getAttribute('data-id'));
      const obj = {
        id: id || uid('r'), clientId: data.get('clientId'), titre: String(data.get('titre') || 'Recherche').trim(),
        type: types[0] || '', types: types,
        prixMin: chiffres(data.get('prixMin')), prixMax: chiffres(data.get('prixMax')),
        piecesMin: chiffres(data.get('piecesMin')), chambresMin: chiffres(data.get('chambresMin')), sdbMin: chiffres(data.get('sdbMin')),
        surfaceMin: chiffres(data.get('surfaceMin')), surfaceMax: chiffres(data.get('surfaceMax')),
        etageMin: chiffres(data.get('etageMin')), etageMax: chiffres(data.get('etageMax')),
        dernierEtageOk: data.get('dernierEtageOk') === 'on',
        dpe: String(data.get('dpe') || ''), epoque: String(data.get('epoque') || ''),
        quartiers: $$('.se-chip[data-group="quartiers"][aria-pressed="true"]', form).map((c) => c.getAttribute('data-id')),
        statut: existing ? existing.statut : 'active', alertes: existing ? existing.alertes : true,
        cree: existing ? existing.cree : nowISO()
      };
      if (!obj.clientId) { toast('Un lead est nécessaire pour créer cette recherche.', 'warn'); return; }
      if (existing && existing.serverId) {
        try {
          const r = await fetch('/api/recherches/' + existing.serverId, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
          const res = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(res.error || 'Erreur serveur');
          Object.assign(existing, obj);
          modal = null; commit();
          toast('Modifications enregistrées.', 'ok');
        } catch (e) { toast('Erreur : ' + (e.message || 'serveur'), 'warn'); }
        return;
      }
      if (id) { journaliserLocal('recherche', existing, obj); Object.assign(existing, obj); }
      else {
        // Même logique que pour un nouveau client : la recherche est créée
        // d'emblée côté serveur, rattachée au lead serveur du client (et non
        // à son id local), pour être visible par le bon agent et par le
        // super-admin — pas seulement dans ce navigateur.
        const c = client(obj.clientId);
        if (c && c.serverId) {
          try {
            const r = await fetch('/api/recherches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({}, obj, { clientId: c.serverId })) });
            const res = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(res.error || 'Erreur serveur');
            obj.serverId = res.recherche.id;
          } catch (e) { toast('Enregistrée en local seulement (' + (e.message || 'erreur serveur') + ').', 'warn'); }
        } else {
          toast('Client non synchronisé — recherche enregistrée en local seulement.', 'warn');
        }
        state.recherches.push(obj);
      }
      modal = null;
      commit();
      toast('Recherche enregistrée.', 'ok');
      location.hash = '#/recherche/' + obj.id;
      return;
    }

    if (kind === 'visite') {
      state.visites.push({
        id: uid('v'), bienId: data.get('bienId'), clientId: data.get('clientId') || null,
        date: data.get('date'), heure: data.get('heure'), statut: 'confirmee', note: String(data.get('note') || '')
      });
      modal = null;
      commit();
      toast('Visite planifiée.', 'ok');
      return;
    }

    if (kind === 'offre') {
      const montant = chiffres(data.get('montant'));
      if (!montant) { toast('Indiquez un montant.', 'warn'); return; }
      state.offres.push({ id: uid('o'), bienId: data.get('bienId'), clientId: data.get('clientId') || null, montant, statut: 'recue', cree: nowISO() });
      const d = state.demandes.find((x) => x.type === 'offre' && x.statut === 'nouvelle' && x.bienId === data.get('bienId'));
      if (d) d.statut = 'traitee';
      modal = null;
      commit();
      toast('Offre enregistrée.', 'ok');
      return;
    }

    if (kind === 'tache') {
      state.taches.push({
        id: uid('t'), titre: String(data.get('titre') || 'Tâche'), clientId: data.get('clientId') || null,
        bienId: data.get('bienId') || null, echeance: data.get('echeance'), fait: false
      });
      modal = null;
      commit();
      toast('Tâche créée.', 'ok');
      return;
    }

    if (kind === 'radar-note') {
      const id = form.getAttribute('data-id');
      try {
        const r = await fetch('/api/radar/fiche/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: data.get('note') || '', rappel: data.get('rappel') || null }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'erreur');
        Object.assign(radar.fiches[id].fiche, { historique: d.historique, rappel: d.rappel });
        toast('Enregistré.', 'ok'); render();
      } catch (err) { toast(err.message, 'warn'); }
      return;
    }
    if (kind === 'gazette-reglages') {
      try {
        const d = await appelGazette('PUT', '/api/gazette/reglages', { auto: data.get('auto') === 'true', publication: data.get('publication'), marcheJours: Number(data.get('marcheJours')), conseilJours: Number(data.get('conseilJours')) });
        state.gazetteArticles = Object.assign({}, state.gazetteArticles, { reglages: d.reglages });
        render(); toast('Réglages de la Gazette enregistrés.', 'ok');
      } catch (err) { toast(err.message, 'warn'); }
      return;
    }
    if (kind === 'gazette-article') {
      const id = form.getAttribute('data-id');
      try {
        await appelGazette('PATCH', '/api/gazette/articles/' + encodeURIComponent(id), { titre: data.get('titre'), chapo: data.get('chapo'), texte: data.get('texte') });
        state.gazetteArticleOuvert = null; await chargerArticlesGazette(); toast('Article enregistré.', 'ok');
      } catch (err) { toast(err.message, 'warn'); }
      return;
    }
    if (kind === 'gazette-mot' || kind === 'gazette-coup') {
      const corps = kind === 'gazette-mot'
        ? { mot: { titre: data.get('titre'), texte: data.get('texte') } }
        : { coupDeCoeur: { bienId: data.get('bienId'), phrase: data.get('phrase') } };
      try {
        const r = await fetch('/api/gazette/edition', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Enregistrement impossible');
        state.gazetteEdition = Object.assign({}, state.gazetteEdition, { gazette: res.gazette });
        render();
        toast('Publié dans la Gazette.', 'ok');
      } catch (err) { toast(err.message || 'Enregistrement impossible', 'warn'); }
      return;
    }

    if (kind === 'bien-notes') {
      const sid = form.getAttribute('data-id');
      const txt = String(data.get('notesLibres') || '');
      try {
        const r = await fetch('/api/biens/' + encodeURIComponent(sid), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notesLibres: txt }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'erreur');
        const b = (state.biensServeur || []).find((x) => x.serverId === sid);
        if (b) b.notesLibres = txt;
        toast('Infos enregistrées.', 'ok');
      } catch (err) { toast('Enregistrement impossible : ' + (err.message || 'erreur'), 'warn'); }
      return;
    }
    if (kind === 'editorial') {
      const id = form.getAttribute('data-id');
      const publie = e.submitter ? e.submitter.value === '1' : false;
      try {
        const r = await fetch('/api/biens/' + encodeURIComponent(id) + '/editorial', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titre: data.get('titre'), texte: data.get('texte'), coupDeCoeur: data.get('coupDeCoeur'), publie: publie }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Enregistrement impossible');
        const b = (state.biensServeur || []).find((x) => x.serverId === id);
        if (b) { b.editorial = res.editorial; b.coupDeCoeur = res.coupDeCoeur; }
        if (state.editorialBrouillon) delete state.editorialBrouillon[id];
        render();
        toast(publie ? 'Texte publié : les membres le voient sur la fiche.' : 'Texte enregistré (non publié).', 'ok');
      } catch (err) { toast(err.message || 'Enregistrement impossible', 'warn'); }
      return;
    }

    if (kind === 'msg') {
      const leadId = form.getAttribute('data-lead');
      const champ = form.querySelector('[name="texte"]');
      const texte = String(data.get('texte') || '').trim();
      if (!texte || !leadId) return;
      const bouton = form.querySelector('button'); bouton.disabled = true;
      try {
        const r = await fetch('/api/messages/' + encodeURIComponent(leadId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texte: texte }) });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Envoi impossible');
        state.fils = state.fils || {};
        state.fils[leadId] = (state.fils[leadId] || []).concat([res.message]);
        champ.value = '';
        render();
        const n = document.querySelector('.se-composer [name="texte"]'); if (n) { n.value = ''; n.focus(); }
        { const cc = (state.clients || []).find((x) => x.serverId === leadId); const k = cc ? canauxContact(cc) : { membre: true, email: true }; toast(k.membre && k.email ? 'Message envoyé : dans son espace membre et par email.' : k.membre ? 'Message envoyé dans son espace membre.' : 'Message envoyé par email.', 'ok'); }
      } catch (err) { toast(err.message || 'Envoi impossible', 'warn'); bouton.disabled = false; }
      return;
    }

    if (kind === 'bien-membre') {
      const email = form.getAttribute('data-email');
      const biens = readBiensMembres();
      const i = biens.findIndex((b) => (b.email || '').toLowerCase() === (email || '').toLowerCase());
      const prev = i > -1 ? biens[i] : null;
      const obj = {
        id: prev ? prev.id : uid('mb'),
        email: email || (prev ? prev.email : ''),
        nom: prev ? prev.nom : '',
        titre: String(data.get('titre') || ''),
        adresse: String(data.get('adresse') || (prev && prev.adresse) || ''),
        codePostal: prev ? prev.codePostal : '',
        ville: prev ? prev.ville : '',
        type: prev ? prev.type : 'Appartement',
        quartier: data.get('quartier') || (prev ? prev.quartier : 'p11'),
        surface: prev ? prev.surface : 0,
        pieces: prev ? prev.pieces : 0,
        chambres: prev ? prev.chambres : 0,
        sdb: prev ? prev.sdb : 0,
        etage: prev ? prev.etage : '',
        dpe: prev ? prev.dpe : 'D',
        etat: prev ? prev.etat : '',
        prix: chiffres(data.get('prix')),
        description: String(data.get('description') || ''),
        photos: prev ? prev.photos : [],
        atouts: prev ? prev.atouts : [],
        statut: data.get('statut') || 'avant-premiere',
        statutDemande: null,
        suiveurs: prev ? prev.suiveurs : 0,
        agent: state.agent.prenom + ' ' + state.agent.nom,
        cree: prev ? prev.cree : nowISO()
      };
      if (i > -1) biens[i] = obj; else biens.unshift(obj);
      writeBiensMembres(biens);
      state.membresBiens = biens.map((b) => Object.assign({}, b, { label: qLabel(b.quartier) }));
      const dd = state.demandes.find((x) => (x.email || '').toLowerCase() === (email || '').toLowerCase() && x.type === 'statut' && x.statut === 'nouvelle');
      if (dd) dd.statut = 'traitee';
      modal = null;
      commit();
      toast('Fiche du bien enregistrée. Le membre la verra dans son espace.', 'ok');
      return;
    }

    if (kind === 'agent') {
      state.agent.prenom = String(data.get('prenom') || '');
      state.agent.nom = String(data.get('nom') || '');
      state.agent.email = String(data.get('email') || '');
      state.agent.tel = String(data.get('tel') || '');
      state.agent.agence = String(data.get('agence') || '');
      commit();
      toast('Réglages enregistrés.', 'ok');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-sci-q')) { e.preventDefault(); sci.q = e.target.value; sci.page = 1; sciCharger(); return; }
    if (e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-rd-cp')) { e.preventDefault(); const b = document.querySelector('[data-act="radar-zone-ajouter"]'); if (b) b.click(); return; }
    if (e.key === 'Enter' && e.target.hasAttribute && e.target.hasAttribute('data-rdf') && e.target.tagName === 'INPUT') { e.preventDefault(); radar[e.target.getAttribute('data-rdf')] = e.target.value; rdRelancer(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.hasAttribute && e.target.hasAttribute('data-rdf') && e.target.type !== 'checkbox') { radar[e.target.getAttribute('data-rdf')] = e.target.value; rdMajBouton(); return; }
    if (e.target.hasAttribute && e.target.hasAttribute('data-visite-piece')) {
      const carte = e.target.closest('[data-visite]');
      const l = state.visiteEdition && state.visiteEdition[carte.getAttribute('data-visite')];
      if (l && l[Number(e.target.getAttribute('data-visite-piece'))]) l[Number(e.target.getAttribute('data-visite-piece'))].piece = e.target.value;
    }
    const fEdito = e.target.closest && e.target.closest('form[data-form="editorial"]');
    if (fEdito) {
      const id = fEdito.getAttribute('data-id');
      state.editorialBrouillon = state.editorialBrouillon || {};
      state.editorialBrouillon[id] = { titre: fEdito.querySelector('[name="titre"]').value, texte: fEdito.querySelector('[name="texte"]').value };
      const b = (state.biensServeur || []).find((x) => x.serverId === id);
      if (b) b.coupDeCoeur = fEdito.querySelector('[name="coupDeCoeur"]').value;
    }
    if (e.target.matches('[data-rr]')) {
      // Persiste la saisie sans re-render : le champ affiche déjà ce qui
      // vient d'être tapé, un render() ici ne ferait que couper le curseur
      // au milieu de la frappe. La sauvegarde suffit à ce que la valeur
      // survive au prochain render() déclenché par autre chose sur la page.
      state.robotRecherche = state.robotRecherche || {};
      state.robotRecherche[e.target.getAttribute('data-rr')] = e.target.value;
      save();
      return;
    }
    if (e.target.matches('[data-search]')) {
      state.filtres.q = e.target.value;
      const v = e.target.value;
      clearTimeout(window.__s);
      window.__s = setTimeout(() => {
        save();
        const r = parseRoute();
        if (['clients', 'biens'].indexOf(r.name) === -1) location.hash = '#/clients';
        render();
        const input = $('[data-search]');
        if (input) { input.focus(); input.setSelectionRange(v.length, v.length); }
      }, 260);
    }
  });

  document.addEventListener('change', (e) => {
    const f = e.target.getAttribute('data-filter');
    if (f) { state.filtres[f] = e.target.value; save(); render(); return; }

    if (e.target.getAttribute('data-upload') === 'import') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          state = Object.assign(seed(), parsed);
          save();
          render();
          toast('CRM restauré.', 'ok');
        } catch (err) { toast('Fichier illisible.', 'warn'); }
      };
      reader.readAsText(file);
    }
  });

  window.addEventListener('hashchange', () => { modal = null; state.notifDerniere = null; fermerCarte(); render(); });

  /* -------------------------------- démarrage ------------------------------ */

  render();
  syncIdentite();
  syncServeur();
  // Pas de rafraîchissement automatique pendant qu'un agent saisit dans un formulaire.
  setInterval(() => {
    const actif = document.activeElement;
    if (!modal && !(actif && actif.closest && actif.closest('form') && /^(INPUT|TEXTAREA|SELECT)$/.test(actif.tagName))) syncServeur();
  }, 15000);
})();
