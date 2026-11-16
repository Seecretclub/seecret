'use strict';
/* Construit assets/data/dvf/<code postal>.json à partir des CSV DVF (Etalab).
   Usage : node tools/build-dvf.js /tmp/dvf-75-2024.csv.gz /tmp/dvf-75-2025.csv.gz ... */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CP = new Set(['75001','75002','75003','75004','75005','75006','75007','75008','75009','75010','75011','75012','75013','75014','75015','75016','75017','75018','75019','75020','92100','92200','94300']);

function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ')
  .trim();

function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Aucun fichier DVF fourni'); process.exit(1); }
  const byCp = new Map();
  let total = 0, kept = 0;

  for (const file of files) {
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    const lines = text.split('\n');
    const head = parseLine(lines[0]);
    const idx = (name) => head.indexOf(name);
    const col = {
      date: idx('date_mutation'), nature: idx('nature_mutation'), valeur: idx('valeur_fonciere'),
      num: idx('adresse_numero'), voie: idx('adresse_nom_voie'), cp: idx('code_postal'),
      commune: idx('nom_commune'), lots: idx('nombre_lots'), type: idx('type_local'),
      surface: idx('surface_reelle_bati'), pieces: idx('nombre_pieces_principales'),
      lon: idx('longitude'), lat: idx('latitude')
    };
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      total++;
      const f = parseLine(line);
      if (f[col.nature] !== 'Vente') continue;
      const type = f[col.type];
      if (type !== 'Appartement' && type !== 'Maison') continue;
      const cp = f[col.cp];
      if (!CP.has(cp)) continue;
      const surface = Number(f[col.surface]);
      const valeur = Number(f[col.valeur]);
      const lots = Number(f[col.lots]) || 1;
      if (!(surface >= 9) || !(valeur >= 50000) || lots > 1) continue;
      const pm2 = valeur / surface;
      if (!(pm2 >= 3000 && pm2 <= 30000)) continue;
      const date = f[col.date];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2024-01-01') continue;
      const lon = Number(f[col.lon]), lat = Number(f[col.lat]);
      if (!lon || !lat) continue;
      const voie = f[col.voie] || '';
      if (!voie) continue;
      if (!byCp.has(cp)) byCp.set(cp, { cp, ville: f[col.commune] || '', rues: [], ventes: [] });
      const bucket = byCp.get(cp);
      if (!bucket.ville) bucket.ville = f[col.commune] || '';
      const v = bucket.ventes;
      v.push({
        d: date, p: Math.round(valeur), s: Math.round(surface),
        n: Number(f[col.pieces]) || 0, t: type === 'Maison' ? 'M' : 'A',
        num: (f[col.num] || '').trim(), voie, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5
      });
      kept++;
    }
  }

  const outDir = path.join(__dirname, '..', 'assets', 'data', 'dvf');
  fs.mkdirSync(outDir, { recursive: true });
  let totalFiles = 0;
  for (const [cp, bucket] of byCp) {
    const rues = [];
    const index = new Map();
    const ventes = bucket.ventes
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
      .map((v) => {
        const key = norm(v.voie);
        if (!index.has(key)) { index.set(key, rues.length); rues.push(v.voie.trim()); }
        return [v.d, v.p, v.s, v.n, v.t, v.num, index.get(key), v.lon, v.lat];
      });
    const payload = { cp, ville: bucket.ville, source: 'DVF Etalab', maj: ventes[0] ? ventes[0][0] : '', rues, ventes };
    fs.writeFileSync(path.join(outDir, cp + '.json'), JSON.stringify(payload));
    totalFiles++;
  }
  const sizes = fs.readdirSync(outDir).reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`${total} lignes, ${kept} ventes retenues, ${byCp.size} fichiers, ${(sizes / 1024).toFixed(0)} Ko au total`);
  console.log('postcodes:', Array.from(byCp.keys()).sort().join(' '));
  console.log('manquants:', Array.from(CP).filter((c) => !byCp.has(c)).join(' ') || 'aucun');
}

main();
