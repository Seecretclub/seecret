# Seecret — Modèle de données canonique

Ce modèle est partagé entre le front (démo `localStorage`) et le backend Supabase
(`supabase/schema.sql`). Les noms de champs sont identiques dans les deux.

## Rôles & niveaux d'accès

| Rôle candidature | Niveau d'accès | Catalogue visible |
|---|---|---|
| `acquereur` (acheteur) | `acheteur` | uniquement les biens `ouvert` |
| `vendeur` (a déposé un bien) | `vendeur` | tout (`avant_premiere`, `ouvert`, `sous_offre`, `vendu`) + page « Mon bien » |

## Entités

### `membres`
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| email | text unique | identifiant de connexion |
| prenom, nom, tel, ville | text | |
| role | enum `acquereur` `vendeur` | `vendeur` = a déposé un bien |
| statut | enum `en_attente` `valide` `refuse` `actif` | |
| niveau | enum `acheteur` `vendeur` | niveau d'accès catalogue |
| created_at | timestamptz | |

### `leads`
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| type | enum `acquereur` `vendeur` `mixte` | |
| prenom, nom, email, tel, ville | text | |
| societe, siren | text | pour les SCI / prospection |
| source | enum `site` `radar` `manuel` | **sépare plateforme vs prospection** |
| statut | enum `nouveau` `qualifie` `en_contact` `client` `archive` | |
| note | text | |
| agent | text | |
| created_at, updated_at | timestamptz | |

### `recherches` (1 lead → N recherches)
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| lead_id | uuid FK → leads | cascade |
| type | text | |
| quartiers | text[] | |
| prix_max, apport | numeric | |
| pieces_min, surface_min | int | |
| delai, financement | text | |
| statut | enum `active` `satisfaite` `archive` | |
| created_at | timestamptz | |

### `biens` (1 lead → N biens)
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| lead_id | uuid FK → leads nullable | |
| membre_id | uuid FK → membres nullable | propriétaire côté plateforme |
| ref, titre, type, quartier, adresse | text | |
| surface, pieces, chambres, sdb | int | |
| etage, dpe, etat | text | |
| prix, prix_net_vendeur, honoraires | numeric | **net vendeur = prix − honoraires** |
| statut | enum `brouillon` `mandat` `avant_premiere` `ouvert` `sous_offre` `vendu` | |
| photos, atouts | text[] | |
| description | text | |
| created_at, updated_at | timestamptz | |

### `demandes_modification` (vendeur → CRM → validation)
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| bien_id | uuid FK → biens | |
| membre_id, lead_id | uuid FK nullable | |
| champ, ancien, nouveau, message | text | |
| statut | enum `en_attente` `validee` `refusee` | |
| created_at, traite_at | timestamptz | |

### `acces` (accès unique)
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| membre_id | uuid FK → membres | |
| token | text unique | lien unique `espace.html?token=…` |
| niveau | enum `acheteur` `vendeur` | |
| email | text | |
| statut | enum `envoye` `utilise` `expire` | |
| created_at | timestamptz | |

### `radar` (pipeline DPE → SCI → contact → lead)
| champ | type | notes |
|---|---|---|
| id | uuid | PK |
| ref, adresse, ville, cp | text | |
| dpe, ges, surface, annee | text/numeric | issus de l'Ademe / BDNB |
| source_dpe | enum `ademe` `import` `manuel` | |
| statut | enum `nouveau` `enrichi` `sci_identifiee` `contact_trouve` `converti` | |
| sci_nom, sci_siren | text | |
| dirigeants | jsonb | |
| contact_nom, contact_tel, contact_email, contact_linkedin | text | |
| lead_id | uuid FK → leads nullable | posé à la conversion |
| created_at, updated_at | timestamptz | |

### `demandes` (boîte de réception partagée)
`type` ∈ `candidature` `visite` `offre` `modification` `info`, plus un payload `dossier`
(structuré : lead + recherches + biens) et le statut `nouvelle` / `traitee`.

## Règles d'accès (RLS)

- **membres `acheteur`** : `SELECT biens WHERE statut = 'ouvert'`.
- **membres `vendeur`** : `SELECT biens WHERE statut IN ('avant_premiere','ouvert','sous_offre','vendu')`.
- **membres** : lecture/écriture de *leurs* biens (`membre_id = auth.uid()`), création de
  `demandes_modification` pour leurs biens.
- **leads / recherches / radar / demandes** : réservés à l'agence (aucune lecture membre).
- **agence** : accès total (service role / profil `agence`).

## Sources externes (Edge Functions)

| source | usage | endpoint interne |
|---|---|---|
| Pappers / societe.com | identifier SCI (SIREN, dirigeants, bénéficiaires) | `enrich-societe` |
| Bercail | identifier le propriétaire d'un bien | `enrich-bercail` |
| Ademe / BDNB (data.ademe.fr) | DPE (classe, GES, surface, année) | `enrich-dpe` |
| Lusha / LinkedIn | retrouver tel + email d'un dirigeant | `enrich-contact` |

Logique « DPE en cascade » : partir des DPE récents → enrichir (SCI via societe.com/Pappers,
propriétaire via Bercail) → retrouver le contact (Lusha/LinkedIn) → convertir en lead.
