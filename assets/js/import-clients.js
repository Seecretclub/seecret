// Import du fichier clients historique : lecture (Excel, CSV), reconnaissance
// des colonnes, nettoyage, dédoublonnage, classement en segments et
// propositions de messages personnalisés. Tout se passe dans le navigateur ;
// rien n'est envoyé au serveur avant le clic « Importer ».
(function (racine) {
  'use strict';

  const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // ---- Lecture du fichier ----
  function lireCsv(texte) {
    texte = String(texte || '').replace(/^﻿/, '');
    const premiere = texte.split(/\r?\n/)[0] || '';
    const sep = [';', ',', '\t', '|'].map((c) => [c, premiere.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const lignes = []; let ligne = []; let champ = ''; let guill = false;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (guill) {
        if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guill = false; else champ += c;
      } else if (c === '"') guill = true;
      else if (c === sep) { ligne.push(champ); champ = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && texte[i + 1] === '\n') i++; ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
      else champ += c;
    }
    if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
    return lignes.filter((l) => l.some((x) => String(x).trim()));
  }
  // Renvoie { entetes: [...], lignes: [[...], ...] } — première ligne non vide = en-têtes.
  async function lireFichier(fichier) {
    const nom = sansAccents(fichier.name);
    let tableau;
    if (/\.(xlsx|xlsm|xls|ods)$/.test(nom)) {
      if (!racine.XLSX) throw new Error('Lecteur Excel non chargé.');
      const wb = racine.XLSX.read(await fichier.arrayBuffer(), { type: 'array', cellDates: true });
      // Toutes les feuilles, mises bout à bout (mêmes en-têtes que la première).
      tableau = [];
      wb.SheetNames.forEach((n, k) => {
        const t = racine.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }).filter((l) => l.some((x) => String(x).trim()));
        tableau = tableau.concat(k === 0 ? t : t.slice(1));
      });
    } else {
      const buf = await fichier.arrayBuffer();
      let texte = new TextDecoder('utf-8').decode(buf);
      if (texte.indexOf('�') > -1) texte = new TextDecoder('windows-1252').decode(buf); // export Excel « CSV » français
      tableau = lireCsv(texte);
    }
    if (!tableau.length) throw new Error('Le fichier est vide.');
    // En-tête = première ligne qui contient au moins 2 libellés reconnus, sinon la première.
    let iEntete = 0;
    for (let i = 0; i < Math.min(10, tableau.length); i++) {
      if (tableau[i].filter((h) => devinerChamp(h)).length >= 2) { iEntete = i; break; }
    }
    return { entetes: tableau[iEntete].map((h, i) => String(h || '').trim() || ('Colonne ' + (i + 1))), lignes: tableau.slice(iEntete + 1) };
  }

  // ---- Reconnaissance des colonnes ----
  const CHAMPS = [
    ['civilite', 'Civilité', /^(civilite|titre|genre|sexe|mr\/mme)$/],
    ['prenom', 'Prénom', /(^|\b)(prenom|first ?name|given)/],
    ['nomComplet', 'Nom complet', /(nom complet|full ?name|nom et prenom|nom prenom|prenom nom|^contact$|^client$|^name$)/],
    ['nom', 'Nom', /(^nom$|^nom |nom de famille|last ?name|surname|^noms?$)/],
    ['email', 'Email', /(e-?mail|courriel|^mail)/],
    ['tel', 'Téléphone', /(tel|phone|portable|mobile|gsm|fixe)/],
    ['adresse', 'Adresse', /(adresse|address|^rue|domicile)/],
    ['cp', 'Code postal', /(code ?postal|^cp$|zip|postal)/],
    ['ville', 'Ville', /(^ville|city|commune|localite)/],
    ['projet', 'Type / projet', /(^type( de client| client)?$|profil|projet|categorie|statut|acheteur|vendeur|nature)/],
    ['typeBien', 'Type de bien', /(type de bien|type bien|bien recherche|typologie|appartement|maison)/],
    ['budget', 'Budget / prix', /(budget|prix|montant|estimation|valeur)/],
    ['surface', 'Surface', /(surface|m2|m²|superficie)/],
    ['pieces', 'Pièces', /(pieces|nb p|chambres|^p$)/],
    ['quartier', 'Quartier / secteur', /(quartier|secteur|arrondissement|arr\.?$|zone)/],
    ['date', 'Date (contact, création…)', /(date|cree|creation|dernier contact|derniere|annee|ajoute)/],
    ['notes', 'Notes / commentaires', /(note|comment|remarque|observation|historique|suivi|info|detail|description)/]
  ];
  function devinerChamp(entete) {
    const h = sansAccents(entete);
    if (!h) return '';
    const c = CHAMPS.find((x) => x[2].test(h));
    return c ? c[0] : '';
  }
  function devinerCorrespondance(entetes) {
    const pris = new Set();
    return entetes.map((h) => {
      const c = devinerChamp(h);
      if (!c || (pris.has(c) && c !== 'notes' && c !== 'tel')) return '';
      pris.add(c); return c;
    });
  }

  // ---- Nettoyage ----
  const majuscule = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-'’])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).trim();
  function formatTel(t) {
    let d = String(t || '').replace(/[^\d+]/g, '');
    if (d.indexOf('+33') === 0) d = '0' + d.slice(3); else if (d.indexOf('0033') === 0) d = '0' + d.slice(4);
    if (d.indexOf('+') === 0) return d; // numéro étranger : tel quel
    d = d.replace(/\D/g, '');
    if (d.length === 9 && /^[1-9]/.test(d)) d = '0' + d;
    return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : d;
  }
  function lireDate(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) return new Date(Math.round(v.getTime() / 864e5) * 864e5); // Excel : arrondi au jour
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)); // date Excel
    const s = String(v).trim();
    let m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
    if (m) { const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); const d = new Date(Date.UTC(a, Number(m[2]) - 1, Number(m[1]))); return isNaN(d) ? null : d; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    m = /^(19|20)\d{2}$/.exec(s);
    if (m) return new Date(Date.UTC(Number(s), 5, 30));
    return null;
  }
  const nombre = (v) => { const n = Number(String(v == null ? '' : v).replace(/\s|€|eur/gi, '').replace(/k$/i, '000').replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };
  // 75011 / « Paris 11 » / « 11e » → p11 ; Boulogne, Neuilly…
  function quartierDe(texte) {
    const t = sansAccents(texte);
    if (!t) return '';
    let m = /\b75(0\d{2}|1(0\d|1[0-6]))\b/.exec(t);
    if (m) { const n = Number(m[1]) > 100 ? Number(m[1]) - 100 : Number(m[1]); if (n >= 1 && n <= 20) return 'p' + n; }
    m = /paris\s*(\d{1,2})\s*(e|er|eme|ème)?\b/.exec(t) || /^(\d{1,2})\s*(e|er|eme)\b/.exec(t);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) return 'p' + Number(m[1]);
    if (/boulogne|92100/.test(t)) return 'boulogne';
    if (/neuilly|92200/.test(t)) return 'neuilly';
    return '';
  }
  function projetDe(texte) {
    const t = sansAccents(texte);
    const v = /(vend|vendeur|mandat|proprietaire|estimation|cession)/.test(t);
    const a = /(achat|acheteur|acquereur|acquisition|recherch|investisseur|locataire)/.test(t);
    return v && a ? 'mixte' : v ? 'vendeur' : a ? 'acquereur' : '';
  }

  // Lignes brutes + correspondance → clients propres, dédoublonnés et classés.
  function transformer(lignes, correspondance) {
    const vus = new Map();
    const out = [];
    lignes.forEach((l, i) => {
      const v = {}; const notes = [];
      correspondance.forEach((champ, k) => {
        const val = l[k];
        if (!champ || val === '' || val == null) return;
        if (champ === 'notes') notes.push(String(val).trim());
        else if (champ === 'date') v.date = v.date || val;
        else if (champ === 'tel') { v.tels = v.tels || []; v.tels.push(val); }
        else v[champ] = val;
      });
      let prenom = String(v.prenom || '').trim(); let nom = String(v.nom || '').trim();
      if (v.nomComplet && (!prenom || !nom)) {
        const civ = /^(m\.|mr\.?|mme|mlle|monsieur|madame)\s+/i.exec(String(v.nomComplet).trim());
        if (civ && !v.civilite) v.civilite = /^(m\.|mr|monsieur)/i.test(civ[1]) ? 'M.' : 'Mme';
        const p = String(v.nomComplet).trim().replace(/^(m\.|mr\.?|mme|mlle|monsieur|madame)\s+/i, '').trim().split(/\s+/);
        // « DUPONT Jean » (nom en capitales d'abord) ou « Jean Dupont ».
        if (p.length > 1 && p[0] === p[0].toUpperCase() && p[0].length > 1 && p[p.length - 1] !== p[p.length - 1].toUpperCase()) { nom = nom || p.slice(0, -1).join(' '); prenom = prenom || p[p.length - 1]; }
        else { prenom = prenom || p[0]; nom = nom || p.slice(1).join(' '); }
      }
      prenom = majuscule(prenom); nom = majuscule(nom);
      const email = String(v.email || '').trim().toLowerCase().replace(/^mailto:/, '');
      const emailOk = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
      const tels = (v.tels || []).map(formatTel).filter((t) => t.replace(/\D/g, '').length >= 9);
      const adresse = [v.adresse, v.cp, v.ville].filter((x) => x && String(x).trim()).map((x) => String(x).trim()).join(' ').replace(/\s+/g, ' ');
      const quartier = quartierDe(v.quartier) || quartierDe(v.cp) || quartierDe(adresse);
      const date = lireDate(v.date);
      const texteProjet = [v.projet, notes.join(' ')].join(' ');
      const projet = projetDe(v.projet) || projetDe(notes.join(' ')) || '';
      const c = {
        ligne: i + 2, civilite: String(v.civilite || '').trim(), prenom: prenom, nom: nom,
        email: emailOk ? email : '', emailInvalide: email && !emailOk ? email : '', tel: tels[0] || '', tel2: tels[1] || '',
        adresse: adresse, ville: majuscule(v.ville || ''), quartier: quartier, projet: projet || 'prospect',
        typeBien: majuscule(v.typeBien || ''), budgetMax: nombre(v.budget), surface: nombre(v.surface), pieces: nombre(v.pieces),
        date: date, notes: notes.join(' · ').slice(0, 3000), texteProjet: texteProjet
      };
      // Rejetée : ni nom, ni moyen de contact.
      if (!c.prenom && !c.nom) { c.etat = 'ignore'; c.raison = 'Sans nom'; }
      else if (!c.email && !c.tel && !c.adresse) { c.etat = 'ignore'; c.raison = 'Ni email, ni téléphone, ni adresse'; }
      else {
        // Même email = même personne ; même téléphone seulement avec le même nom
        // (un couple ou un bureau partage souvent un numéro).
        const cle = c.email || (c.tel ? c.tel.replace(/\D/g, '') + '|' + sansAccents(c.nom || c.prenom) : sansAccents(c.prenom + c.nom) + '|' + sansAccents(c.adresse));
        if (vus.has(cle)) {
          // Doublon dans le fichier : on complète la première fiche.
          const p = vus.get(cle);
          ['prenom', 'nom', 'email', 'tel', 'adresse', 'ville', 'quartier', 'typeBien'].forEach((k) => { if (!p[k] && c[k]) p[k] = c[k]; });
          if (!p.budgetMax && c.budgetMax) p.budgetMax = c.budgetMax;
          if (c.notes && p.notes.indexOf(c.notes) === -1) p.notes = (p.notes ? p.notes + ' · ' : '') + c.notes;
          if (c.date && (!p.date || c.date > p.date)) p.date = c.date;
          if (p.projet === 'prospect' && c.projet !== 'prospect') p.projet = c.projet;
          else if ((p.projet === 'vendeur' && c.projet === 'acquereur') || (p.projet === 'acquereur' && c.projet === 'vendeur')) p.projet = 'mixte';
          p.fusions = (p.fusions || 1) + 1;
          c.etat = 'fusion'; c.raison = 'Doublon de la ligne ' + p.ligne;
        } else { vus.set(cle, c); c.etat = 'ok'; }
      }
      out.push(c);
    });
    out.filter((c) => c.etat === 'ok').forEach((c) => { c.segment = segmentDe(c); });
    return out;
  }

  // ---- Segments et messages ----
  const SEGMENTS = {
    vendeur: { nom: 'Anciens vendeurs / propriétaires', tag: 'Ancien vendeur', idee: 'Leur proposer une estimation offerte et la vente discrète en off-market.' },
    acquereurAncien: { nom: 'Anciens acquéreurs (plus de 2 ans)', tag: 'Ancien acquéreur', idee: 'Ils sont peut-être devenus propriétaires : valeur actuelle de leur bien, projet de revente, ou nouvelle recherche.' },
    acquereurRecent: { nom: 'Acquéreurs récents', tag: 'Acquéreur', idee: 'Les inviter dans le club : des biens qui ne sont publiés nulle part ailleurs.' },
    aQualifier: { nom: 'À qualifier', tag: 'Profil à qualifier', idee: 'Reprendre contact simplement et demander s’ils ont un projet.' }
  };
  function segmentDe(c) {
    if (c.projet === 'vendeur' || c.projet === 'mixte') return 'vendeur';
    if (c.projet === 'acquereur') return c.date && (Date.now() - c.date.getTime()) > 2 * 365 * 864e5 ? 'acquereurAncien' : 'acquereurRecent';
    return 'aQualifier';
  }
  function libelleQuartier(q) {
    if (!q) return '';
    if (q === 'boulogne') return 'à Boulogne'; if (q === 'neuilly') return 'à Neuilly';
    const n = Number(q.slice(1)); return 'dans le ' + n + (n === 1 ? 'er' : 'e');
  }
  function message(c, agent) {
    const bonjour = 'Bonjour ' + (c.prenom || (c.civilite ? c.civilite + ' ' + c.nom : c.nom)) + ',';
    const quand = c.date ? (' en ' + c.date.getFullYear()) : '';
    const ou = libelleQuartier(c.quartier);
    const sign = '\n\nBelle journée,\n' + (agent || 'Votre agent') + ' — Seecret';
    const club = 'J’ai lancé Seecret, un club immobilier off-market à Paris : les biens y sont présentés en toute discrétion à des membres vérifiés, sans annonce publique.';
    switch (c.segment) {
      case 'vendeur':
        return bonjour + '\n\nNous avions échangé' + quand + ' au sujet de votre bien' + (ou ? ' ' + ou : '') + '. ' + club +
          '\n\nSi vous pensez à vendre, ou simplement à connaître la valeur de votre bien aujourd’hui, je vous propose une estimation offerte, sans engagement.' + sign;
      case 'acquereurAncien':
        return bonjour + '\n\nNous nous étions rencontrés' + quand + ' lors de votre recherche' + (ou ? ' ' + ou : '') + '. ' + club +
          '\n\nSi vous êtes devenu propriétaire depuis, votre bien a peut-être pris de la valeur : je peux vous en donner une estimation à jour. Et si vous cherchez à nouveau, le club vous donne accès à des biens qui ne sont publiés nulle part ailleurs.' + sign;
      case 'acquereurRecent':
        return bonjour + '\n\nVous m’aviez confié votre recherche' + (c.typeBien ? ' d’un ' + c.typeBien.toLowerCase() : '') + (ou ? ' ' + ou : '') + (c.budgetMax ? ' (budget autour de ' + Math.round(c.budgetMax / 1000) + ' k€)' : '') + '. ' + club +
          '\n\nJe serais ravi de vous y inviter : votre recherche y est suivie en priorité et vous êtes prévenu dès qu’un bien correspond.' + sign;
      default:
        return bonjour + '\n\nCela fait un moment ! ' + club + '\n\nAvez-vous un projet immobilier en ce moment, à l’achat ou à la vente ? Je serais heureux d’en parler avec vous.' + sign;
    }
  }
  // Ligne prête pour POST /api/leads/import.
  function versServeur(c, lot) {
    const s = SEGMENTS[c.segment] || SEGMENTS.aQualifier;
    return {
      civilite: c.civilite, prenom: c.prenom, nom: c.nom, email: c.email, tel: c.tel, adresse: c.adresse, ville: c.ville,
      projet: c.projet, typeBien: c.typeBien, budgetMax: c.budgetMax, surface: c.surface, pieces: c.pieces,
      quartiers: c.quartier ? [c.quartier] : [], dateContact: c.date ? c.date.toISOString().slice(0, 10) : '',
      notes: [c.notes, c.tel2 ? 'Autre téléphone : ' + c.tel2 : '', c.emailInvalide ? 'Email illisible dans le fichier : ' + c.emailInvalide : ''].filter(Boolean).join('\n'),
      tags: ['Fichier clients', s.tag].concat(lot ? [lot] : [])
    };
  }

  racine.ImportClients = { lireFichier, lireCsv, devinerCorrespondance, transformer, message, versServeur, SEGMENTS, CHAMPS: CHAMPS.map((c) => ({ id: c[0], label: c[1] })), quartierDe, formatTel };
})(typeof window !== 'undefined' ? window : globalThis);
