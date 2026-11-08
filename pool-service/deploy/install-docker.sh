#!/usr/bin/env bash
# Installs Docker Engine + the compose plugin and adds the claude user to the docker group.
# Usage: sudo bash deploy/install-docker.sh
set -euo pipefail
[[ "${EUID}" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
APP_USER="${APP_USER:-claude}"
export DEBIAN_FRONTEND=noninteractive

if docker compose version >/dev/null 2>&1; then
  echo "Docker and compose already installed: $(docker --version)"
else
  . /etc/os-release
  arch="$(dpkg --print-architecture)"
  repo="https://download.docker.com/linux/${ID}"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  # Docker's own repo only lists released codenames; fall back to the distro packages otherwise.
  if curl -fsSI "${repo}/dists/${VERSION_CODENAME}/Release" >/dev/null 2>&1; then
    echo "Using Docker's apt repository for ${VERSION_CODENAME}"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "${repo}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] ${repo} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    echo "Docker's repo has no ${VERSION_CODENAME} yet; using ${ID}'s docker.io packages"
    apt-get install -y docker.io docker-buildx || apt-get install -y docker.io
    apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
  fi
fi

systemctl enable --now docker
usermod -aG docker "${APP_USER}"
docker --version
docker compose version
echo "Done. (${APP_USER} can use docker without sudo after its next login.)"
