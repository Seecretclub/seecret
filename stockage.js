// Stockage SQLite de Seecret.
//
// Avant : toute la base vivait dans un seul fichier data.json, réécrit en
// entier à chaque modification. Deux actions simultanées (deux agents, un
// membre qui écrit pendant qu'un agent valide…) pouvaient s'écraser : la
// dernière écriture effaçait la modification de l'autre.
//
// Maintenant : une base SQLite (fichier seecret.db sur le volume). Chaque
// enregistrement (un lead, un bien, une demande…) est une ligne. Le reste du
// code ne change pas : readDb() renvoie toujours le même objet { leads: [...],
// biens: [...], ... } et writeDb(db) l'enregistre. Mais writeDb n'écrit plus
// que les enregistrements réellement modifiés depuis la lecture, dans une
// transaction : deux requêtes qui modifient des enregistrements différents ne
// s'écrasent plus.
//
// Au premier démarrage, data.json est importé automatiquement puis renommé
// data.json.importe (rien n'est supprimé).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const VALEUR = '__valeur__'; // valeurs non-tableaux (objets, booléens) du document

class Stockage {
  constructor(dossier) {
    this.dossier = dossier;
    this.fichier = path.join(dossier, 'seecret.db');
    this.sql = new Database(this.fichier);
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('synchronous = NORMAL');
    this.sql.pragma('busy_timeout = 5000');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS enregistrements (' +
      '  collection TEXT NOT NULL, cle TEXT NOT NULL, position REAL NOT NULL, donnees TEXT NOT NULL,' +
      '  modifie TEXT NOT NULL, PRIMARY KEY (collection, cle))'
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_collection_position ON enregistrements (collection, position)');
    this.q = {
      tout: this.sql.prepare('SELECT collection, cle, position, donnees FROM enregistrements ORDER BY collection, position'),
      inserer: this.sql.prepare('INSERT INTO enregistrements (collection, cle, position, donnees, modifie) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (collection, cle) DO UPDATE SET donnees = excluded.donnees, modifie = excluded.modifie'),
      supprimer: this.sql.prepare('DELETE FROM enregistrements WHERE collection = ? AND cle = ?'),
      compter: this.sql.prepare('SELECT COUNT(*) AS n FROM enregistrements')
    };
    // Copie en mémoire de la base (processus unique : toutes les écritures
    // passent par ici, la copie est donc toujours à jour).
    this.cache = new Map(); // collection -> Map(cle -> { position, donnees })
    this.chargerCache();
  }

  chargerCache() {
    this.cache = new Map();
    for (const r of this.q.tout.all()) {
      if (!this.cache.has(r.collection)) this.cache.set(r.collection, new Map());
      this.cache.get(r.collection).set(r.cle, { position: r.position, donnees: r.donnees });
    }
  }

  estVide() { return this.q.compter.get().n === 0; }

  // Clé stable d'un élément de tableau : son id s'il en a un (unique dans le
  // tableau), sinon une empreinte de son contenu.
  static cles(tableau) {
    const vues = new Map();
    return tableau.map((x) => {
      let base = (x && typeof x === 'object' && (typeof x.id === 'string' || typeof x.id === 'number') && String(x.id)) ? 'id:' + String(x.id) : null;
      if (!base) base = 'h:' + crypto.createHash('sha1').update(JSON.stringify(x === undefined ? null : x)).digest('hex').slice(0, 16);
      const n = vues.get(base) || 0;
      vues.set(base, n + 1);
      return n ? base + '#' + n : base;
    });
  }

  // Lecture : reconstruit le document complet. Chaque objet renvoyé garde
  // (de façon invisible) la photo de ce qu'il contenait à la lecture, pour
  // que ecrire() sache ce qui a changé.
  lire() {
    const doc = {};
    const photo = new Map();
    for (const [collection, lignes] of this.cache) {
      const p = new Map();
      if (collection === VALEUR) {
        for (const [cle, l] of lignes) {
          p.set(cle, l.donnees);
          // Marqueur « cette clé est un tableau » : un tableau vide n'a aucune
          // ligne, mais doit réapparaître comme [] à la lecture.
          if (cle.indexOf('@tableau:') === 0) { const nom = cle.slice(9); if (doc[nom] === undefined) doc[nom] = []; continue; }
          doc[cle] = JSON.parse(l.donnees);
        }
      } else {
        const tri = Array.from(lignes.entries()).sort((a, b) => a[1].position - b[1].position);
        doc[collection] = tri.map(([cle, l]) => { p.set(cle, l.donnees); return JSON.parse(l.donnees); });
      }
      photo.set(collection, p);
    }
    Object.defineProperty(doc, '__photo', { value: photo, enumerable: false, writable: true });
    return doc;
  }

  // Écriture : n'enregistre que les différences avec la photo prise à la
  // lecture de CE document (ajouts, modifications, suppressions).
  ecrire(doc) {
    const photo = doc.__photo || new Map();
    const maintenant = new Date().toISOString();
    const ops = [];
    const valeurs = new Map();
    for (const nom of Object.keys(doc)) {
      const v = doc[nom];
      if (v === undefined || typeof v === 'function') continue;
      if (!Array.isArray(v)) { valeurs.set(nom, JSON.stringify(v)); continue; }
      valeurs.set('@tableau:' + nom, 'true');
      const avant = photo.get(nom) || new Map();
      const cles = Stockage.cles(v);
      const actuel = this.cache.get(nom) || new Map();
      // Position des nouveaux éléments : entre leurs voisins déjà connus, pour
      // garder l'ordre du tableau (ajout au début, à la fin ou au milieu).
      const pos = cles.map((c) => (actuel.has(c) ? actuel.get(c).position : null));
      for (let i = 0; i < pos.length; i++) {
        if (pos[i] !== null) continue;
        let j = i; while (j < pos.length && pos[j] === null) j++;
        const gauche = i > 0 ? pos[i - 1] : null;
        const droite = j < pos.length ? pos[j] : null;
        const n = j - i;
        for (let k = 0; k < n; k++) {
          if (gauche !== null && droite !== null) pos[i + k] = gauche + (droite - gauche) * (k + 1) / (n + 1);
          else if (gauche !== null) pos[i + k] = gauche + k + 1;
          else if (droite !== null) pos[i + k] = droite - (n - k);
          else pos[i + k] = k;
        }
        i = j - 1;
      }
      const presentes = new Set();
      v.forEach((x, i) => {
        const cle = cles[i];
        presentes.add(cle);
        const json = JSON.stringify(x === undefined ? null : x);
        if (avant.get(cle) === json) return; // inchangé depuis la lecture
        ops.push(['set', nom, cle, pos[i], json]);
      });
      // Suppressions : seulement ce qui existait à la lecture et a disparu.
      avant.forEach((json, cle) => { if (!presentes.has(cle)) ops.push(['del', nom, cle]); });
    }
    const avantValeurs = photo.get(VALEUR) || new Map();
    valeurs.forEach((json, cle) => { if (avantValeurs.get(cle) !== json) ops.push(['set', VALEUR, cle, 0, json]); });
    if (!ops.length) return 0;
    const appliquer = this.sql.transaction((liste) => {
      for (const op of liste) {
        if (op[0] === 'set') this.q.inserer.run(op[1], op[2], op[3], op[4], maintenant);
        else this.q.supprimer.run(op[1], op[2]);
      }
    });
    appliquer(ops);
    for (const op of ops) {
      if (!this.cache.has(op[1])) this.cache.set(op[1], new Map());
      if (op[0] === 'set') {
        const ex = this.cache.get(op[1]).get(op[2]);
        this.cache.get(op[1]).set(op[2], { position: ex ? ex.position : op[3], donnees: op[4] });
      } else this.cache.get(op[1]).delete(op[2]);
    }
    // La photo du document devient l'état qu'il vient d'écrire (il peut être
    // réécrit plus loin dans la même requête).
    doc.__photo = this.lire().__photo;
    return ops.length;
  }

  // Import initial depuis data.json (une seule fois, base vide).
  importer(document) {
    const doc = {};
    Object.defineProperty(doc, '__photo', { value: new Map(), enumerable: false, writable: true });
    Object.assign(doc, document);
    return this.ecrire(doc);
  }

  // Sauvegarde cohérente de la base (pendant qu'elle tourne).
  sauvegarder(cible) { return this.sql.backup(cible); }

  exporterJson() { const d = this.lire(); return JSON.stringify(d, null, 2); }
}

module.exports = { Stockage };
