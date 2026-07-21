#!/usr/bin/env bash
# Installateur de l'agent DEV Neocosive (boîte aux lettres GitHub).
# A lancer UNE fois sur le VPS de dev, en root :
#   curl -fsSL https://raw.githubusercontent.com/doclmy-stack/neo-deploy-tmp/main/dev-agent-install.sh | sudo bash
# Aucun secret n'est contenu ici : le token GitHub est saisi de façon masquée.
set -euo pipefail

echo "==================================================="
echo "   Agent DEV Neocosive  —  installation"
echo "==================================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "ERREUR : relance avec sudo."
  echo "  curl -fsSL https://raw.githubusercontent.com/doclmy-stack/neo-deploy-tmp/main/dev-agent-install.sh | sudo bash"
  exit 1
fi

GH_USER_DEFAULT="doclmy-stack"
REPO="neo-dev-ops"

read -rp "Utilisateur GitHub [${GH_USER_DEFAULT}] : " GH_USER
GH_USER="${GH_USER:-$GH_USER_DEFAULT}"
read -rsp "Token GitHub (fine-grained : repo ${REPO}, Contents = Read/Write) : " GH_TOKEN
echo
if [ -z "${GH_TOKEN}" ]; then echo "Token vide -> abandon."; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
echo "-> Installation de git/curl ..."
apt-get update -y >/dev/null 2>&1 || apt-get update -y
apt-get install -y git curl ca-certificates >/dev/null

REMOTE="https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO}.git"
install -d /opt
if [ -d "/opt/${REPO}/.git" ]; then
  echo "-> Repo déjà présent, mise à jour du remote."
  cd "/opt/${REPO}"
  git remote set-url origin "${REMOTE}"
  git pull --quiet origin main || true
else
  echo "-> Clonage de ${REPO} ..."
  git clone "${REMOTE}" "/opt/${REPO}"
  cd "/opt/${REPO}"
fi

git config user.email "neo-dev-agent@neocosive.local"
git config user.name  "neo-dev-agent"
chmod 600 "/opt/${REPO}/.git/config" || true

echo "-> Installation du runner ..."
install -m 0755 "/opt/${REPO}/runner/runner.sh" /usr/local/bin/neo-runner.sh

cat >/etc/systemd/system/neo-runner.service <<'UNIT'
[Unit]
Description=NEO dev runner (GitHub mailbox)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/neo-runner.sh
UNIT

cat >/etc/systemd/system/neo-runner.timer <<'UNIT'
[Unit]
Description=NEO dev runner timer
[Timer]
OnBootSec=15
OnUnitActiveSec=30
AccuracySec=5
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now neo-runner.timer

echo
echo ">>> Agent installé et ACTIF (vérifie l'inbox toutes les 30 s)."
echo ">>> Test rapide :"
systemctl list-timers neo-runner.timer --no-pager 2>/dev/null | head -n 3 || true
echo ">>> Fin."
