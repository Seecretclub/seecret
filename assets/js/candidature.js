/* ------------------------------------------------------------------
   Seecret — parcours d'adhésion (Kindred)
   profil (Acquéreur / Vendeur / Mixte) → recherche → budget
   → bien → vente → vous → vérifications → récapitulatif
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const num = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
  const uid = (p) => (p || 'id') + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();

  const KEY_MEMBRES = 'seecret.membres.v1';
  const KEY_DEMANDES = 'seecret.demandes.v1';
  const KEY_BIENS = 'seecret.biens.v1';

  const QUARTIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    .map((n) => ({ id: 'p' + n, label: 'Paris ' + n + (n === 1 ? 'ᵉʳ' : 'ᵉ') }))
    .concat([
      { id: 'boulogne', label: 'Boulogne' },
      { id: 'neuilly', label: 'Neuilly' },
      { id: 'vincennes', label: 'Vincennes' }
    ]);
  const qLabel = (id) => (QUARTIERS.find((q) => q.id === id) || { label: id }).label;

  const TYPES = ['Appartement', 'Maison', 'Duplex', 'Loft', 'Hôtel particulier', 'Terrain'];
  const PHOTOS = ['home-1.jpg', 'ilesaintlouis-1.jpg', 'saintgermain-1.jpg', 'home-3.jpg', 'trocadero-1.jpg', 'home-6.jpg', 'home-jardin.jpg', 'marais-1.jpg'];

  const PRIX_M2 = { 1: 13800, 2: 11200, 3: 12500, 4: 12400, 5: 13300, 6: 14600, 7: 14300, 8: 12000, 9: 10500, 10: 10800, 11: 9800, 12: 9400, 13: 9200, 14: 9000, 15: 10200, 16: 11500, 17: 10100, 18: 8900, 19: 8300, 20: 7900 };
  const arrond = (id) => { const m = String(id || '').match(/^p(\d+)$/); return m ? Number(m[1]) : 0; };
  const pm2Of = () => PRIX_M2[arrond(rep.bien.quartier)] || 10000;
  const estim = () => {
    let p = (Number(rep.bien.surface) || 0) * pm2Of();
    const ext = Number(rep.bien.surfaceExterieur) || 0;
    p += ext * pm2Of() / 3; // extérieur pondéré à 1/3 du prix au m²
    const dpe = rep.bien.dpe;
    if (dpe === 'A' || dpe === 'B') p *= 1.04;
    if (dpe === 'F' || dpe === 'G') p *= 0.94;
    if (rep.bien.etat === 'Rénové') p *= 1.03;
    if (rep.bien.etat === 'À rénover') p *= 0.9;
    return Math.round(p / 1000) * 1000;
  };
  const COORDS = {
    p1: [48.859, 2.341], p2: [48.867, 2.341], p3: [48.863, 2.361], p4: [48.855, 2.355], p5: [48.846, 2.347],
    p6: [48.851, 2.332], p7: [48.857, 2.320], p8: [48.873, 2.309], p9: [48.877, 2.335], p10: [48.874, 2.357],
    p11: [48.858, 2.379], p12: [48.840, 2.388], p13: [48.829, 2.356], p14: [48.833, 2.327], p15: [48.842, 2.293],
    p16: [48.862, 2.276], p17: [48.885, 2.321], p18: [48.892, 2.344], p19: [48.883, 2.382], p20: [48.866, 2.398],
    boulogne: [48.835, 2.241], neuilly: [48.884, 2.268], vincennes: [48.848, 2.438]
  };
  const comparables = () => {
    const pm2 = pm2Of();
    const s = Number(rep.bien.surface) || 0;
    return [0.92, 1.04, 0.97].map((f, i) => ({
      prix: Math.round(s * pm2 * f / 1000) * 1000,
      surface: Math.round(s * (0.95 + i * 0.03)),
      date: ['il y a 1 mois', 'il y a 2 mois', 'il y a 4 mois'][i]
    }));
  };
  const mapBlock = () => {
    const q = rep.bien.quartier;
    const c = COORDS[q] || [48.8566, 2.3522];
    const dLon = 0.02, dLat = 0.015;
    const bbox = (c[1] - dLon) + ',' + (c[0] - dLat) + ',' + (c[1] + dLon) + ',' + (c[0] + dLat);
    return '<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + c[0] + ',' + c[1] + '" loading="lazy" style="width:100%;height:160px;border:0;border-radius:12px;margin-top:12px"></iframe>';
  };
  const evoBars = () => {
    const pm2 = pm2Of();
    const bars = [];
    for (let m = 0; m < 12; m++) bars.push(pm2 * (1 + 0.004 * m + 0.005 * Math.sin(m * 0.7)));
    const min = Math.min.apply(null, bars), max = Math.max.apply(null, bars);
    return '<div class="cand-evo">' + bars.map((v) => '<i style="height:' + Math.round(18 + 82 * (v - min) / (max - min || 1)) + '%"></i>').join('') + '</div>';
  };
  const estimationBlock = () => {
    return '<div class="cand-estim">' +
      '<p class="kicker" style="margin:0 0 8px;color:var(--color-taupe)">Estimation Seecret</p>' +
      (rep.bien.surface && rep.bien.quartier
        ? '<div class="cand-estim-prix">' + euro(estim()) + '</div>' +
          '<div class="cand-estim-sub">' + euro(pm2Of()) + ' / m² · extérieur pondéré à 1/3</div>' +
          evoBars() +
          mapBlock() +
          '<div class="se-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">' +
            comparables().map((c) => '<div class="se-card" style="padding:10px"><b style="font-size:14px">' + euro(c.prix) + '</b><div class="se-hint" style="margin-top:3px">' + c.surface + ' m² · ' + c.date + '</div></div>').join('') +
          '</div>' +
          '<div class="cand-estim-note" style="margin-top:10px">Comparatifs de biens vendus dans le même secteur (± 20 %, récents).</div>'
        : '<div class="cand-estim-sub">Renseignez la surface et le quartier de votre bien (étape précédente) pour voir l’estimation.</div>') +
    '</div>';
  };

  const ICONS = {
    swap: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5h13"/><path d="m13.5 3 2.5 2.5-2.5 2.5"/><path d="M17 13.5H4"/><path d="m6.5 11-2.5 2.5L6.5 16"/></svg>',
    home: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 9.5 8 4.5l5.5 5"/><path d="M4.5 8v8h8V11"/><path d="M9 12.5H17"/><path d="m15 10 2 2.5-2 2.5"/></svg>',
    search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 9.5 8 4.5l5.5 5"/><path d="M4.5 8v7.5h3.5"/><circle cx="13.5" cy="13.5" r="2.6"/><path d="m15.4 15.4 2.1 2.1"/></svg>',
    check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10.5 3.5 3.5L16 6"/></svg>',
    file: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3H5.5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V7z"/><path d="M11 3v4h4"/></svg>'
  };

  /* ------------------------------- état ---------------------------------- */

  const rep = {
    projet: null,
    recherche: { types: [], quartiers: [], prixMax: '', piecesMin: '', surfaceMin: '', surfaceMax: '', delai: '', autreSecteur: '', autreSuggestion: '' },
    budget: { apport: '', financement: '', courtier: false, bienAVendre: false },
    bien: { type: '', quartier: '', surface: '', pieces: '', chambres: '', sdb: '', etage: '', dpe: '', etat: '', exterieur: '', surfaceExterieur: '' },
    vente: { prix: '', delai: '', dejaEnVente: '', mandat: '', motif: '' },
    vous: { prenom: '', nom: '', email: '', tel: '', ville: '' },
    verifs: { identite: '', financement: '', bien: '', consent: false }
  };

  let etape = 0;
  let envoye = false;
  let erreur = '';

  /* ----------------------------- progression ----------------------------- */

  function steps() {
    const s = [{ id: 'projet' }];
    if (rep.projet !== 'vendeur') s.push({ id: 'recherche' }, { id: 'budget' });
    if (rep.projet !== 'acheteur') s.push({ id: 'bien' }, { id: 'vente' });
    s.push({ id: 'vous' }, { id: 'verifs' }, { id: 'recap' });
    return s;
  }

  const TITRES = {
    projet: 'Votre projet',
    recherche: 'Votre recherche',
    budget: 'Votre budget',
    bien: 'Votre bien',
    vente: 'Votre projet de vente',
    vous: 'Vous',
    verifs: 'Vérifications',
    recap: 'Récapitulatif'
  };

  const QUESTIONS = {
    projet: 'Quel est votre projet ?',
    recherche: 'Que cherchez-vous ?',
    budget: 'Votre budget',
    bien: 'Parlez-nous de votre bien',
    vente: 'Votre projet de vente',
    vous: 'Qui êtes-vous ?',
    verifs: 'Dernière étape',
    recap: 'Tout est prêt'
  };

  const SOUS_TITRES = {
    projet: 'Choisissez le parcours qui vous ressemble. Il s’adapte à votre choix.',
    recherche: 'Ces critères nous servent à vous proposer les bons biens, en avant-première.',
    budget: 'Pour vous présenter les biens qui vous correspondent vraiment.',
    bien: 'Plus votre bien est précis, mieux il sera présenté au cercle.',
    vente: 'Votre bien ouvre le catalogue off-market. Sans mandat, sans engagement.',
    vous: 'Vos coordonnées restent confidentielles.',
    verifs: 'Elles protègent le club — le vôtre comme celui des autres membres.',
    recap: 'Vérifiez une dernière fois, puis envoyez votre candidature.'
  };

  const current = () => steps()[Math.min(etape, steps().length - 1)];

  /* -------------------------------- rendu -------------------------------- */

  function render() {
    const list = steps();
    etape = Math.min(etape, list.length - 1);
    const step = list[etape];

    if (envoye) { $('#app').innerHTML = confirmation(); return; }

    $('#app').innerHTML =
      '<div class="cand">' +
        '<div class="cand-main">' +
          '<div class="cand-top">' +
            '<a class="se-brand" href="index.html">' +
              '<span class="se-logo">S</span>' +
              '<span><b>Seecret</b><small>Adhésion</small></span>' +
            '</a>' +
            '<div class="cand-progress">' +
              '<div class="cand-progress-row"><span>' + esc(TITRES[step.id]) + '</span><b>' + (etape + 1) + ' sur ' + list.length + '</b></div>' +
              '<div class="cand-bars">' + list.map((s, i) => '<span class="' + (i < etape ? 'done' : i === etape ? 'current' : '') + '"><i></i></span>').join('') + '</div>' +
            '</div>' +
          '</div>' +
          '<h1 class="cand-q">' + QUESTIONS[step.id] + '</h1>' +
          '<p class="cand-sub">' + SOUS_TITRES[step.id] + '</p>' +
          '<div class="cand-body">' + corps(step.id) + '</div>' +
          '<div class="cand-error" id="err">' + esc(erreur) + '</div>' +
          '<div class="cand-foot">' +
            (etape > 0 ? '<button class="se-btn ghost" data-act="retour">Retour</button>' : '') +
            (step.id === 'projet' ? '' : '<button class="se-btn" data-act="suivant">' + (step.id === 'recap' ? 'Envoyer ma candidature' : 'Continuer') + '</button>') +
          '</div>' +
        '</div>' +
        '<aside class="cand-aside">' +
          '<div class="cand-carousel">' + PHOTOS.map((p, i) => '<img src="assets/img/' + p + '" alt="" class="' + (i === 0 ? 'on' : '') + '"/>').join('') + '</div>' +
          '<div class="cand-aside-grad"></div>' +
          '<p>Des biens premium, inédits.</p>' +
        '</aside>' +
      '</div>';
  }

  /* ------------------------------ contenus ------------------------------- */

  function corps(id) {
    if (id === 'projet') {
      return choix('acheteur', '01', ICONS.search, 'Acquéreur', 'Ma recherche',
        'Accédez à une sélection de biens off-market, présentés en avant-première, qui répondent à vos critères.') +
        choix('vendeur', '02', ICONS.home, 'Vendeur', 'Mon bien',
          'Présentez votre bien à un cercle d’acquéreurs discrets, sans mandat et sans engagement.') +
        choix('mixte', '03', ICONS.swap, 'Acquéreur et Vendeur', 'Les deux',
          'Achetez et vendez à la fois : profitez du catalogue complet tout en exposant votre bien.');
    }

    if (id === 'recherche') {
      return bloc('Type de bien', chips('typeBien', TYPES, rep.recherche.types, true)) +
        bloc('Secteurs', chips('secteur', QUARTIERS, rep.recherche.quartiers, true)) +
        '<div class="se-field" style="margin-bottom:18px"><label>Autre secteur (code postal ou ville)</label>' +
          '<input class="se-input" data-model="recherche.autreSecteur" value="' + esc(rep.recherche.autreSecteur || '') + '" placeholder="Ex : 92, Nanterre, Lyon…"/>' +
          (rep.recherche.autreSuggestion ? '<div class="se-hint" style="margin-top:6px;display:flex;align-items:center;gap:8px">' + esc(rep.recherche.autreSuggestion) + ' <button type="button" class="se-btn ghost sm" data-act="secteur-ajouter">Ajouter</button></div>' : '') +
        '</div>' +
        bloc('Pièces minimum', chips('piecesMin', ['2', '3', '4', '5', '6+'], rep.recherche.piecesMin, false)) +
        '<div class="se-form-grid" style="margin-bottom:18px">' +
          field('Surface min (m²)', 'recherche.surfaceMin', rep.recherche.surfaceMin, { type: 'number', placeholder: '60' }) +
          field('Surface max (m²)', 'recherche.surfaceMax', rep.recherche.surfaceMax, { type: 'number', placeholder: '120' }) +
        '</div>' +
        bloc('Dans quel délai ?', chips('delai', ['Dès que possible', '3 mois', '6 mois', '12 mois', 'Sans urgence'], rep.recherche.delai, false));
    }

    if (id === 'budget') {
      return '<div class="se-form-grid">' +
        field('Budget maximum (€)', 'recherche.prixMax', rep.recherche.prixMax, { type: 'number', placeholder: '1 800 000' }) +
        field('Apport (€)', 'budget.apport', rep.budget.apport, { type: 'number', placeholder: '200 000' }) +
        '</div>' +
        bloc('Votre financement', chips('financement', ['Comptant', 'Prêt accordé', 'Prêt en cours', 'À définir'], rep.budget.financement, false)) +
        bloc('Êtes-vous accompagné par un courtier ?', chips('courtier', ['Oui', 'Non'], rep.budget.courtier ? 'Oui' : rep.budget.courtier === false ? 'Non' : '', false)) +
        bloc('J’ai un bien à vendre pour financer ma recherche', chips('bienAVendre', ['Oui', 'Non'], rep.budget.bienAVendre ? 'Oui' : rep.budget.bienAVendre === false ? 'Non' : '', false)) +
        '<div class="se-note" style="margin-top:6px">Un financement validé accélère votre dossier : vous pouvez faire une offre avant les autres.</div>';
    }

    if (id === 'bien') {
      return bloc('Type de bien', chips('bienType', TYPES, rep.bien.type, false)) +
        '<div class="se-form-grid" style="margin-bottom:18px">' +
          field('Quartier ou ville', 'bien.quartier', rep.bien.quartier, { type: 'select', options: [{ id: '', label: '— choisir —' }].concat(QUARTIERS) }) +
          field('Étage', 'bien.etage', rep.bien.etage, { placeholder: '4ᵉ' }) +
          field('Surface (m²)', 'bien.surface', rep.bien.surface, { type: 'number' }) +
          field('Pièces', 'bien.pieces', rep.bien.pieces, { type: 'number' }) +
          field('Chambres', 'bien.chambres', rep.bien.chambres, { type: 'number' }) +
          field('Salles de bain', 'bien.sdb', rep.bien.sdb, { type: 'number' }) +
        '</div>' +
        bloc('DPE', chips('dpe', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], rep.bien.dpe, false)) +
        bloc('État', chips('etat', ['À rénover', 'Bon état', 'Rénové'], rep.bien.etat, false)) +
        bloc('Extérieur', chips('exterieur', ['Aucun', 'Balcon', 'Terrasse', 'Jardin'], rep.bien.exterieur, false)) +
        field('Surface extérieure (m²)', 'bien.surfaceExterieur', rep.bien.surfaceExterieur, { type: 'number', placeholder: '12' });
    }

    if (id === 'vente') {
      return estimationBlock() + '<div class="se-form-grid" style="margin-bottom:18px">' +
          field('Prix souhaité (€)', 'vente.prix', rep.vente.prix, { type: 'number', placeholder: '1 200 000' }) +
          field('Dans quel délai ?', 'vente.delai', rep.vente.delai, { type: 'select', options: [{ id: '', label: '— choisir —' }, { id: 'Dès que possible', label: 'Dès que possible' }, { id: '3 mois', label: '3 mois' }, { id: '6 mois', label: '6 mois' }, { id: '12 mois', label: '12 mois' }, { id: 'Quand j’aurai trouvé', label: 'Quand j’aurai trouvé' }] }) +
        '</div>' +
        bloc('Le bien est-il déjà en vente ailleurs ?', chips('dejaEnVente', ['Non', 'Oui'], rep.vente.dejaEnVente, false)) +
        bloc('Un mandat est-il en cours ?', chips('mandat', ['Non', 'Oui'], rep.vente.mandat, false)) +
        bloc('Pourquoi vendez-vous ?', field('', 'vente.motif', rep.vente.motif, { type: 'textarea', min: '90px', placeholder: 'Ce qui vous fait bouger…' }));
    }

    if (id === 'vous') {
      return '<div class="se-form-grid">' +
        field('Prénom', 'vous.prenom', rep.vous.prenom, { placeholder: 'Camille' }) +
        field('Nom', 'vous.nom', rep.vous.nom, { placeholder: 'Renaud' }) +
        field('Email', 'vous.email', rep.vous.email, { type: 'email', placeholder: 'vous@exemple.fr' }) +
        field('Téléphone', 'vous.tel', rep.vous.tel, { type: 'tel', placeholder: '06 12 34 56 78' }) +
        field('Ville', 'vous.ville', rep.vous.ville, { full: true, placeholder: 'Paris' }) +
        '</div>' +
        '<div class="se-note" style="margin-top:18px">Aucun engagement : votre candidature est étudiée avant tout accès.</div>';
    }

    if (id === 'verifs') {
      const ach = rep.projet !== 'vendeur';
      const ven = rep.projet !== 'acheteur';
      return (ach ? upload('identite', 'Pièce d’identité', 'Une photo recto/verso suffit.') : '') +
        (ach ? upload('financement', 'Justificatif de financement', 'Accord de principe, relevé ou attestation.') : '') +
        (ven ? upload('bien', 'Titre de propriété', 'Ou un justificatif de propriété du bien.') : '') +
        '<label class="se-switch" style="margin-top:20px;align-items:flex-start">' +
          '<input type="checkbox" data-consent' + (rep.verifs.consent ? ' checked' : '') + '/>' +
          '<span>J’accepte que Seecret utilise ces informations pour vérifier mon dossier, conformément aux <a href="donnees-personnelles.html">règles de confidentialité</a>.</span>' +
        '</label>' +
        '<div class="se-note" style="margin-top:16px">Démonstration : les fichiers restent sur votre appareil, rien n’est envoyé à un serveur.</div>';
    }

    if (id === 'recap') {
      return '<div class="cand-recap">' +
        recapRow('Profil', libelleProjet(rep.projet), 0) +
        (rep.projet !== 'vendeur' ? recapRow('Recherche', resumeRecherche(), 'recherche') : '') +
        (rep.projet !== 'vendeur' ? recapRow('Budget', resumeBudget(), 'budget') : '') +
        (rep.projet !== 'acheteur' ? recapRow('Bien', resumeBien(), 'bien') : '') +
        (rep.projet !== 'acheteur' ? recapRow('Vente', resumeVente(), 'vente') : '') +
        recapRow('Vous', esc((rep.vous.prenom + ' ' + rep.vous.nom).trim()) + (rep.vous.email ? ' · ' + esc(rep.vous.email) : ''), 'vous') +
        recapRow('Vérifications', (rep.verifs.consent ? 'Consentement donné' : 'Consentement manquant') + ' · ' + nbPieces() + ' pièce(s)', 'verifs') +
        '</div>' +
        '<div class="se-note" style="margin-top:18px">Votre candidature part à l’agence. Elle est étudiée sous 48 h : si elle est validée, votre espace s’ouvre automatiquement.</div>';
    }

    return '';
  }

  function choix(id, numero, icon, titre, tagline, desc) {
    const on = rep.projet === id;
    return '<button type="button" class="cand-choice' + (on ? ' on' : '') + '" data-projet="' + id + '" aria-pressed="' + on + '">' +
      '<span class="cand-choice-num" aria-hidden="true">' + numero + '</span>' +
      '<span class="cand-choice-ico">' + icon + '</span>' +
      '<span class="cand-choice-txt"><b>' + titre + '</b><em>' + tagline + '</em><span class="desc">' + desc + '</span></span>' +
      '<span class="cand-choice-mark" aria-hidden="true">' + ICONS.check + '</span>' +
    '</button>';
  }

  function bloc(label, contenu) {
    return '<div class="se-bloc"><p class="kicker">' + label + '</p>' + contenu + '</div>';
  }

  function chips(name, items, value, multi) {
    return '<div class="se-chips">' + items.map((it) => {
      const v = typeof it === 'string' ? it : it.id;
      const label = typeof it === 'string' ? it : it.label;
      const on = multi ? (value || []).indexOf(v) > -1 : value === v;
      return '<button type="button" class="se-chip" data-pick="' + name + '" data-value="' + esc(v) + '" data-multi="' + (multi ? '1' : '') + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
  }

  function field(label, path, value, opts) {
    const o = opts || {};
    return '<div class="se-field ' + (o.full ? 'full' : '') + '"><label>' + label + '</label>' +
      (o.type === 'textarea'
        ? '<textarea class="se-textarea" data-model="' + path + '" placeholder="' + esc(o.placeholder || '') + '"' + (o.min ? ' style="min-height:' + o.min + '"' : '') + '>' + esc(value) + '</textarea>'
        : o.type === 'select'
          ? '<select class="se-select" data-model="' + path + '">' + o.options.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === value ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select>'
          : '<input class="se-input" type="' + (o.type || 'text') + '" data-model="' + path + '" value="' + esc(value) + '" placeholder="' + esc(o.placeholder || '') + '"/>') +
      '</div>';
  }

  function upload(key, titre, aide) {
    const fait = rep.verifs[key];
    return '<label class="cand-drop ' + (fait ? 'ok' : '') + '" style="margin-bottom:12px">' +
      '<span style="flex:0 0 20px">' + (fait ? ICONS.check : ICONS.file) + '</span>' +
      '<span style="flex:1"><b style="display:block;font-size:14px;color:var(--color-ink)">' + titre + '</b>' +
      '<span style="font-size:12.5px">' + (fait ? esc(fait) : aide) + '</span></span>' +
      '<input type="file" hidden data-file="' + key + '"/>' +
      '<span class="se-btn ghost sm">' + (fait ? 'Remplacer' : 'Choisir') + '</span>' +
    '</label>';
  }

  function recapRow(k, v, cible) {
    return '<div class="cand-recap-row"><div style="flex:1;min-width:0"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>' +
      (cible === 0 ? '' : '<button type="button" data-goto="' + cible + '">Modifier</button>') + '</div>';
  }

  function nbPieces() {
    return ['identite', 'financement', 'bien'].filter((k) => rep.verifs[k]).length;
  }

  function libelleProjet(p) {
    return { mixte: 'Acquéreur et Vendeur', vendeur: 'Vendeur', acheteur: 'Acquéreur' }[p] || '—';
  }

  function resumeRecherche() {
    if (!rep.recherche.types.length && !rep.recherche.quartiers.length) return '<span class="se-hint">non renseigné</span>';
    return [
      rep.recherche.types.join(', ') || 'Tous types',
      rep.recherche.quartiers.length ? rep.recherche.quartiers.map(qLabel).join(', ') : 'Tous secteurs',
      rep.recherche.piecesMin ? rep.recherche.piecesMin + ' pièces et +' : '',
      rep.recherche.surfaceMin ? rep.recherche.surfaceMin + ' m² et +' : '',
      rep.recherche.delai ? 'délai : ' + rep.recherche.delai : ''
    ].filter(Boolean).join(' · ');
  }

  function resumeBudget() {
    return [
      rep.recherche.prixMax ? 'max ' + euro(rep.recherche.prixMax) : 'budget non précisé',
      rep.budget.apport ? 'apport ' + euro(rep.budget.apport) : '',
      rep.budget.financement || '',
      rep.budget.bienAVendre ? 'avec un bien à vendre' : ''
    ].filter(Boolean).join(' · ');
  }

  function resumeBien() {
    const b = rep.bien;
    if (!b.type && !b.quartier) return '<span class="se-hint">non renseigné</span>';
    return [
      b.type, b.quartier ? qLabel(b.quartier) : '',
      b.surface ? num(b.surface) + ' m²' : '',
      b.pieces ? b.pieces + ' pièces' : '',
      b.dpe ? 'DPE ' + b.dpe : '',
      b.etat
    ].filter(Boolean).join(' · ');
  }

  function resumeVente() {
    return [
      rep.vente.prix ? euro(rep.vente.prix) : 'prix non précisé',
      rep.vente.delai || '',
      rep.vente.dejaEnVente ? 'déjà en vente : ' + rep.vente.dejaEnVente : ''
    ].filter(Boolean).join(' · ');
  }

  function confirmation() {
    return '<div class="cand"><div class="cand-main">' +
      '<div class="cand-confirm">' +
        '<div class="se-logo-big">✓</div>' +
        '<h1 class="cand-q" style="margin-top:0">Candidature bien reçue</h1>' +
        '<p class="cand-sub" style="margin:8px auto 0;text-align:left">Merci ' + esc(rep.vous.prenom || '') + '. Votre candidature a bien été prise en compte. Seecret revient vers vous sous 48 h maximum.</p>' +
        '<div class="se-card" style="text-align:left;margin-top:24px">' +
          '<div class="se-row" style="justify-content:space-between"><span class="kicker">Récapitulatif</span><span class="se-badge">En attente de validation</span></div>' +
          '<div class="se-divider"></div>' +
          '<div style="font-size:14px;line-height:1.7">' +
            '<div><b style="font-weight:500">Profil :</b> ' + libelleProjet(rep.projet) + '</div>' +
            (rep.projet !== 'vendeur' ? '<div><b style="font-weight:500">Recherche :</b> ' + resumeRecherche() + '</div>' : '') +
            (rep.projet !== 'acheteur' ? '<div><b style="font-weight:500">Bien :</b> ' + resumeBien() + '</div>' : '') +
            '<div><b style="font-weight:500">Contact :</b> ' + esc(rep.vous.email || '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="se-grid" style="margin-top:22px;gap:10px">' +
          
          
          '<a class="se-btn ghost" href="index.html">Retour à l’accueil</a>' +
        '</div>' +
      '</div>' +
    '</div></div>';
  }

  /* ------------------------------ validation ----------------------------- */

  function valider(step) {
    const r = rep;
    switch (step) {
      case 'projet': return r.projet ? '' : 'Choisissez votre profil pour continuer.';
      case 'recherche':
        if (!r.recherche.types.length) return 'Indiquez au moins un type de bien.';
        if (!r.recherche.quartiers.length) return 'Indiquez au moins un secteur.';
        if (!r.recherche.piecesMin) return 'Indiquez le nombre de pièces minimum.';
        return '';
      case 'budget':
        if (!r.recherche.prixMax) return 'Indiquez votre budget maximum.';
        if (!r.budget.financement) return 'Précisez votre financement.';
        return '';
      case 'bien':
        if (!r.bien.type) return 'Indiquez le type de votre bien.';
        if (!r.bien.quartier) return 'Indiquez le quartier de votre bien.';
        if (!r.bien.surface) return 'Indiquez la surface.';
        if (!r.bien.pieces) return 'Indiquez le nombre de pièces.';
        return '';
      case 'vente':
        if (!r.vente.prix) return 'Indiquez le prix souhaité.';
        if (!r.vente.delai) return 'Indiquez votre délai de vente.';
        return '';
      case 'vous':
        if (!r.vous.prenom || !r.vous.nom) return 'Indiquez votre prénom et votre nom.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.vous.email)) return 'Indiquez un email valide.';
        if (!r.vous.tel || r.vous.tel.replace(/\D/g, '').length < 9) return 'Indiquez un téléphone valide.';
        return '';
      case 'verifs':
        if (!rep.verifs.consent) return 'Cochez la case pour envoyer votre dossier.';
        return '';
      default: return '';
    }
  }

  /* -------------------------------- envoi -------------------------------- */

  function envoyer() {
    const dossier = JSON.parse(JSON.stringify(rep));
    const nom = (rep.vous.prenom + ' ' + rep.vous.nom).trim();
    const role = rep.projet;

    const demande = {
      id: uid('d'), type: 'candidature', nom: nom, email: rep.vous.email,
      role: role, montant: 0, message: resumeDemande(), dossier: dossier,
      source: 'Site', statut: 'nouvelle', cree: nowISO()
    };

    const membre = {
      id: uid('m'), email: rep.vous.email, prenom: rep.vous.prenom, nom: rep.vous.nom,
      tel: rep.vous.tel, ville: rep.vous.ville, role: role,
      statut: 'en_attente', dossier: dossier, cree: nowISO()
    };

    try {
      const demandes = JSON.parse(localStorage.getItem(KEY_DEMANDES) || '[]');
      demandes.unshift(demande);
      localStorage.setItem(KEY_DEMANDES, JSON.stringify(demandes.slice(0, 60)));

      const membres = JSON.parse(localStorage.getItem(KEY_MEMBRES) || '[]');
      const existant = membres.findIndex((m) => m.email === membre.email);
      if (existant > -1) membres[existant] = membre; else membres.push(membre);
      localStorage.setItem(KEY_MEMBRES, JSON.stringify(membres.slice(0, 200)));

      // Le bien déposé dans le parcours rejoint le portefeuille partagé (espace + CRM).
      if (rep.projet !== 'acheteur') {
        const biens = JSON.parse(localStorage.getItem(KEY_BIENS) || '[]');
        const mb = {
          id: uid('mb'), email: rep.vous.email, nom: nom,
          titre: '', type: rep.bien.type || 'Appartement', quartier: rep.bien.quartier || '',
          surface: Number(rep.bien.surface) || 0, pieces: Number(rep.bien.pieces) || 0,
          chambres: Number(rep.bien.chambres) || 0, sdb: Number(rep.bien.sdb) || 0,
          etage: rep.bien.etage || '', dpe: rep.bien.dpe || '',
          prix: Number(rep.vente.prix) || 0, description: '', photos: [], atouts: [],
          statut: 'brouillon', statutDemande: null, suiveurs: 0,
          agent: 'Léa Marchand', cree: nowISO()
        };
        const i = biens.findIndex((b) => b.email === rep.vous.email);
        if (i > -1) {
          const prev = biens[i];
          biens[i] = Object.assign({}, mb, { id: prev.id, titre: prev.titre, statut: prev.statut, statutDemande: prev.statutDemande, description: prev.description, prix: prev.prix || mb.prix, photos: prev.photos });
        } else {
          biens.unshift(mb);
        }
        localStorage.setItem(KEY_BIENS, JSON.stringify(biens.slice(0, 60)));
      }
    } catch (e) { /* stockage indisponible : la démo continue */ }

    // Envoi au serveur : source de vérité du CRM (data.json).
    fetch('/api/candidature', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dossier)
    }).then((r) => { if (!r.ok) return r.json().then((e) => { throw new Error(e.error || 'Erreur serveur'); }); })
      .catch((e) => console.error('[candidature] envoi serveur échoué :', e.message));

    envoye = true;
    render();
    window.scrollTo({ top: 0 });
  }

  function resumeDemande() {
    const parts = ['Profil : ' + libelleProjet(rep.projet)];
    if (rep.projet !== 'vendeur') parts.push(resumeRecherche());
    if (rep.projet !== 'acheteur') parts.push(resumeBien());
    return parts.filter(Boolean).join(' — ');
  }

  /* -------------------------------- events ------------------------------- */

  $('#app').addEventListener('click', (e) => {
    const projet = e.target.closest('[data-projet]');
    if (projet) {
      rep.projet = projet.getAttribute('data-projet'); etape++; window.scrollTo({ top: 0 });
      erreur = '';
      render();
      return;
    }

    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const name = pick.getAttribute('data-pick');
      const value = pick.getAttribute('data-value');
      const multi = pick.getAttribute('data-multi') === '1';
      appliquer(name, value, multi);
      erreur = '';
      render();
      return;
    }

    const goto = e.target.closest('[data-goto]');
    if (goto) {
      const id = goto.getAttribute('data-goto');
      const idx = steps().findIndex((s) => s.id === id);
      if (idx > -1) { etape = idx; erreur = ''; render(); window.scrollTo({ top: 0 }); }
      return;
    }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    const action = act.getAttribute('data-act');

    if (action === 'retour') {
      etape = Math.max(0, etape - 1);
      erreur = '';
      render();
      window.scrollTo({ top: 0 });
      return;
    }

    if (action === 'secteur-ajouter') {
      const s = (rep.recherche.autreSuggestion || rep.recherche.autreSecteur || '').trim();
      if (s && rep.recherche.quartiers.indexOf(s) === -1) rep.recherche.quartiers.push(s);
      rep.recherche.autreSecteur = '';
      rep.recherche.autreSuggestion = '';
      erreur = '';
      render();
      return;
    }

    if (action === 'suivant') {
      const step = current();
      const msg = valider(step.id);
      if (msg) { erreur = msg; render(); return; }
      erreur = '';
      if (step.id === 'recap') { envoyer(); return; }
      etape++;
      render();
      window.scrollTo({ top: 0 });
    }
  });

  $('#app').addEventListener('input', (e) => {
    const path = e.target.getAttribute('data-model');
    if (path) {
      setPath(rep, path, e.target.value);
      if (path === 'recherche.autreSecteur') suggererSecteur(e.target.value);
      return;
    }
    if (e.target.hasAttribute('data-consent')) {
      rep.verifs.consent = e.target.checked;
      erreur = '';
    }
  });

  $('#app').addEventListener('change', (e) => {
    const file = e.target.getAttribute('data-file');
    if (file) {
      const f = e.target.files && e.target.files[0];
      rep.verifs[file] = f ? f.name : '';
      render();
    }
  });

  function suggererSecteur(value) {
    const v = String(value || '').trim();
    rep.recherche.autreSuggestion = '';
    if (!v) return;
    clearTimeout(window.__secteurT);
    window.__secteurT = setTimeout(async () => {
      if (/^\d{5}$/.test(v) || v.length >= 3) {
        try {
          const r = await fetch('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(v) + '&limit=1');
          const d = await r.json();
          const f = d.features && d.features[0];
          if (f && f.properties) {
            const p = f.properties;
            rep.recherche.autreSuggestion = [p.city || p.name, p.postcode].filter(Boolean).join(' ');
            render();
          }
        } catch (e) { /* BAN indisponible */ }
      }
    }, 500);
  }

  function appliquer(name, value, multi) {
    const r = rep;
    if (name === 'typeBien') toggle(r.recherche.types, value, true);
    else if (name === 'secteur') toggle(r.recherche.quartiers, value, true);
    else if (name === 'piecesMin') r.recherche.piecesMin = value;
    else if (name === 'surfaceMin') r.recherche.surfaceMin = value;
    else if (name === 'delai') r.recherche.delai = value;
    else if (name === 'financement') r.budget.financement = value;
    else if (name === 'courtier') r.budget.courtier = value === 'Oui';
    else if (name === 'bienAVendre') r.budget.bienAVendre = value === 'Oui';
    else if (name === 'bienType') r.bien.type = value;
    else if (name === 'dpe') r.bien.dpe = value;
    else if (name === 'etat') r.bien.etat = value;
    else if (name === 'exterieur') r.bien.exterieur = value;
    else if (name === 'dejaEnVente') r.vente.dejaEnVente = value;
    else if (name === 'mandat') r.vente.mandat = value;
  }

  function toggle(list, value, multi) {
    const i = list.indexOf(value);
    if (i > -1) list.splice(i, 1);
    else list.push(value);
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }

  render();
})();

setInterval(() => {
  const wrap = document.querySelector('.cand-carousel');
  if (!wrap) return;
  const imgs = Array.prototype.slice.call(wrap.querySelectorAll('img'));
  if (!imgs.length) return;
  const cur = imgs.findIndex((im) => im.classList.contains('on'));
  imgs.forEach((im) => im.classList.remove('on'));
  imgs[(cur + 1) % imgs.length].classList.add('on');
}, 4000);
