# SEEcret — plateforme immobilière

**SEEcret** est une plateforme immobilière complète :

1. **La plateforme publique** (le produit) — destinée aux propriétaires vendeurs :
   - Landing page (`index.html`) ;
   - Parcours d'adhésion (`candidature.html`) ;
   - Espace membre (`espace.html`, `connexion.html`) ;
   - Pages légales.

2. **Le CRM back-office** (`crm.html`) — l'outil interne des agents immobiliers :
   - Leads, Produits (biens), Recherches (critères acquéreurs), Club (candidatures/membres) ;
   - Rapprochements (matching vendeurs↔acquéreurs), Pipeline, Tâches, Notifications.

3. **Immo Data Robot** — le moteur de prospection intégré au CRM : détection automatique de vendeurs à partir des DPE.

## Architecture

- **Backend** : Node.js / Express (`server.js`), persistance `data.json`.
- **Frontend** : HTML + CSS + JavaScript vanilla (`assets/js/*`, `*.html`).
- **Moteur Python** (projet séparé) : `immo-data-robot-foundation` (FastAPI + JWT) — connecté via `ROBOT_URL`.

## Chaîne de prospection (Immo Data Robot)

```
DPE (ADEME) → BAN → GPS → RNB → Cadastre → DVF → FPMU → Aucadastre
→ SCI + SIREN → SIRENE/RNE (gérants) → contacts (Exa/Lusha)
→ Scoring → Prospect vendeur dans le CRM
```

Sources gratuites connectées : ADEME, BAN, Aucadastre, FPMU (DGFiP personnes morales), SIRENE/recherche-entreprises, DVF. Fournisseurs optionnels : Exa (clé gratuite), Pappers, Lusha, Hunter, Dropcontact.

## Installation

```bash
npm install
cp .env.example .env   # puis remplir les valeurs
npm start
```

- CRM admin : http://localhost:3157/crm.html
- Plateforme vendeurs : http://localhost:3157/ (index.html)
- Adhésion : http://localhost:3157/candidature.html

## Moteur Python (optionnel, pour l'enrichissement propriétaire)

Le moteur historique vit dans un dépôt séparé (`immo-data-robot-foundation`). Démarrez-le avec `start-local.command`, puis configurez `ROBOT_URL`, `ROBOT_USER` et `ROBOT_PASS` dans `.env`.

## Données

- `data.json` : base locale du CRM (non commitée, générée au runtime).
- FPMU : parquet 376 Mo (DGFiP personnes morales) dans le projet Python.
- DVF : `ValeursFoncieres-2025.txt` (496 Mo) dans le projet Python.

## Sécurité

`.env` et `data.json` sont **ignorés** par git (secrets + données personnelles).
