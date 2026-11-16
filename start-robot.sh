#!/bin/bash
# start-robot.sh — Démarre le moteur Python IMMO DATA ROBOT et configure l'auth pour Seecret.
# Usage : ./start-robot.sh
# Idempotent : relançable sans risque.
set -euo pipefail

ROBOT_DIR="${ROBOT_DIR:-/Users/taieb/Desktop/immo-data-robot-foundation}"
SEECRET_ENV="${SEECRET_ENV:-/Users/taieb/Desktop/seecret_final/.env}"
ROBOT_URL="${ROBOT_URL:-http://127.0.0.1:8000}"
ADMIN_EMAIL="${ROBOT_ADMIN_EMAIL:-robot@seecret.club}"
ADMIN_PASS_FILE="$ROBOT_DIR/data/local/robot_admin_password"

echo "== IMMO DATA ROBOT — démarrage & configuration =="

# 0) Prérequis
if [ ! -d "$ROBOT_DIR" ]; then
  echo "✗ Dossier moteur introuvable : $ROBOT_DIR" >&2
  exit 1
fi
mkdir -p "$ROBOT_DIR/data/local"

# 1) Venv + dépendances
echo "1/6 Vérification de l'environnement Python…"
PY="$ROBOT_DIR/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "  Création du venv…"
  python3 -m venv "$ROBOT_DIR/.venv"
  PY="$ROBOT_DIR/.venv/bin/python"
fi
if ! "$PY" -c 'import fastapi, uvicorn, sqlalchemy, alembic' >/dev/null 2>&1; then
  echo "  Installation des dépendances (backend/requirements.txt)…"
  "$PY" -m pip install -r "$ROBOT_DIR/backend/requirements.txt" -q
fi

# 2) Clé secrète + env de base
if [ ! -f "$ROBOT_DIR/data/local/secret_key" ]; then
  umask 077
  openssl rand -hex 32 > "$ROBOT_DIR/data/local/secret_key"
fi
export APP_ENV=local
export SECRET_KEY="$(cat "$ROBOT_DIR/data/local/secret_key")"
export DATABASE_URL="sqlite:///$ROBOT_DIR/data/local/immo_data_robot.sqlite3"
export FPMU_PARQUET_PATH="${FPMU_PARQUET_PATH:-$ROBOT_DIR/data/fpmu/parcelles_personnes_morales.parquet}"

# 3) Migration de la base
echo "2/6 Migration de la base locale (alembic)…"
(cd "$ROBOT_DIR/backend" && "$PY" -m alembic upgrade head > /tmp/immo-data-robot-alembic.log 2>&1) || {
  echo "✗ Échec de la migration. Voir /tmp/immo-data-robot-alembic.log" >&2
  exit 1
}

# 4) Démarrage uvicorn (arrière-plan) si absent
echo "3/6 Démarrage du serveur (uvicorn :8000)…"
if curl -s -m 2 "$ROBOT_URL/health" >/dev/null 2>&1; then
  echo "  Moteur déjà lancé."
else
  (cd "$ROBOT_DIR/backend" && nohup "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/immo-data-robot.log 2>&1 & echo $! > /tmp/immo-data-robot.pid)
  for i in $(seq 1 30); do
    curl -s -m 2 "$ROBOT_URL/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -s -m 3 "$ROBOT_URL/health" >/dev/null || { echo "✗ Le moteur n'a pas répondu. Voir /tmp/immo-data-robot.log" >&2; exit 1; }
echo "  Moteur OK ($ROBOT_URL/health)."

# 5) Admin local — détecter l'existant, sinon créer
echo "4/6 Configuration de l'admin local…"
DB_PATH="$ROBOT_DIR/data/local/immo_data_robot.sqlite3"
EXISTING_ADMIN="$(sqlite3 "file:$DB_PATH?mode=ro" "SELECT email FROM users WHERE role='admin' LIMIT 1;" 2>/dev/null || true)"
if [ -n "$EXISTING_ADMIN" ]; then
  ADMIN_EMAIL="$EXISTING_ADMIN"
  echo "  Admin existant détecté : $ADMIN_EMAIL"
  if [ -n "${ROBOT_ADMIN_PASS:-}" ]; then
    ADMIN_PASS="$ROBOT_ADMIN_PASS"
  else
    read -r -s -p "  Mot de passe de $ADMIN_EMAIL : " ADMIN_PASS
    echo
  fi
else
  # Premier démarrage : créer l'admin local
  if [ -f "$ADMIN_PASS_FILE" ]; then
    ADMIN_PASS="$(cat "$ADMIN_PASS_FILE")"
  else
    ADMIN_PASS="$(openssl rand -hex 12)"
    umask 077
    printf '%s' "$ADMIN_PASS" > "$ADMIN_PASS_FILE"
  fi
  echo "  Création de l'admin : $ADMIN_EMAIL"
  curl -s -m 8 -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\",\"full_name\":\"Robot Admin\"}" \
    "$ROBOT_URL/auth/local-setup" >/dev/null
fi

# 6) Écrire les identifiants dans le .env de Seecret (ROBOT_USER/ROBOT_PASS → auto-login)
echo "5/6 Écriture de ROBOT_USER / ROBOT_PASS dans .env…"
TMP="$SEECRET_ENV.tmp"
if [ -f "$SEECRET_ENV" ]; then
  grep -vE '^ROBOT_(URL|USER|PASS|TOKEN)=' "$SEECRET_ENV" > "$TMP" || true
else
  : > "$TMP"
fi
{
  echo "# Immo Data Robot (auto-configuré par start-robot.sh le $(date +%Y-%m-%d))"
  echo "ROBOT_URL=$ROBOT_URL"
  echo "ROBOT_USER=$ADMIN_EMAIL"
  echo "ROBOT_PASS=$ADMIN_PASS"
} >> "$TMP"
mv "$TMP" "$SEECRET_ENV"
echo "  Fait."

echo "6/6 Vérification de la connexion (login)…"
TOKEN="$(curl -s -m 5 -X POST -d "username=$ADMIN_EMAIL&password=$ADMIN_PASS" "$ROBOT_URL/auth/login" | "$PY" -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)"
if [ -n "$TOKEN" ]; then
  echo "  ✔ Authentification OK (JWT obtenu)."
else
  echo "  ⚠ Authentification échouée — vérifiez l'admin existant ou les identifiants."
fi

echo
echo "== Terminé =="
echo "  Moteur : $ROBOT_URL"
echo "  Admin  : $ADMIN_EMAIL"
echo "  .env   : ROBOT_USER / ROBOT_PASS renseignés."
echo "  → Redémarre Seecret (Ctrl+C puis « npm start ») pour charger les nouvelles variables, puis teste « Enrichir » dans le CRM."
