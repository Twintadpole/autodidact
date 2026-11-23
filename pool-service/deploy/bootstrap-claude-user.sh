#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 / Debian 12 VPS so Claude Code can work on it.
#
# Run once as root (e.g. in your VPS provider's web console):
#   curl -fsSL https://raw.githubusercontent.com/Twintadpole/autodidact/claude/new-session-q17smb/pool-service/deploy/bootstrap-claude-user.sh | bash
#
# What it does (safe to run again):
#   - creates the user "claude" with passwordless sudo
#   - installs git, tmux, curl, ufw, unattended-upgrades
#   - firewall: allows SSH in, blocks everything else in (Cloudflare Tunnel connects outbound)
#   - adds a 2 GB swapfile on small machines (< 3 GB RAM)
#   - installs Claude Code for the claude user
#   - clones the repo to /home/claude/autodidact
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Twintadpole/autodidact.git}"
BRANCH="${BRANCH:-claude/new-session-q17smb}"
APP_USER="claude"
APP_HOME="/home/${APP_USER}"
REPO_DIR="${APP_HOME}/autodidact"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (in the provider console you are usually root already, or use: sudo bash)." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script supports Ubuntu / Debian (apt) only." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

say "Installing base packages"
apt-get update -y
apt-get install -y sudo git tmux curl ca-certificates openssl ufw unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades || true

say "Creating user '${APP_USER}' with passwordless sudo"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${APP_USER}"
fi
SUDOERS_FILE="/etc/sudoers.d/90-${APP_USER}"
echo "${APP_USER} ALL=(ALL) NOPASSWD:ALL" > "${SUDOERS_FILE}"
chmod 440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}" >/dev/null

say "Checking memory / swap"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [[ "${mem_kb}" -lt 3000000 ]] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Added a 2 GB swapfile."
else
  echo "Swap not needed or already present."
fi

say "Configuring firewall (SSH in only)"
ufw allow OpenSSH >/dev/null || ufw allow 22/tcp >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

say "Cloning ${REPO_URL} (${BRANCH})"
if [[ -d "${REPO_DIR}/.git" ]]; then
  sudo -u "${APP_USER}" git -C "${REPO_DIR}" fetch --quiet origin "${BRANCH}"
  sudo -u "${APP_USER}" git -C "${REPO_DIR}" checkout --quiet "${BRANCH}"
  sudo -u "${APP_USER}" git -C "${REPO_DIR}" pull --quiet --ff-only origin "${BRANCH}" || echo "(local changes present; not pulling)"
else
  sudo -u "${APP_USER}" git clone --quiet --branch "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
fi

say "Installing Claude Code for '${APP_USER}'"
if ! su - "${APP_USER}" -c 'export PATH="$HOME/.local/bin:$PATH"; command -v claude >/dev/null 2>&1'; then
  # Download first, then run: with "curl | bash" a failed download would still exit 0.
  if ! su - "${APP_USER}" -c 'set -e; f=$(mktemp); curl -fsSL https://claude.ai/install.sh -o "$f"; bash "$f"; rm -f "$f"'; then
    echo "Official installer failed; falling back to npm."
    # Claude Code needs Node.js 22+; distro packages are older, so use NodeSource.
    if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
      curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
      bash /tmp/nodesource_setup.sh
      apt-get install -y nodejs
    fi
    su - "${APP_USER}" -c 'npm install -g --prefix "$HOME/.local" @anthropic-ai/claude-code'
  fi
fi
# Make sure ~/.local/bin (where the installer puts claude) is on PATH for login shells.
if ! grep -q 'HOME/.local/bin' "${APP_HOME}/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "${APP_HOME}/.bashrc"
  chown "${APP_USER}:${APP_USER}" "${APP_HOME}/.bashrc"
fi
su - "${APP_USER}" -c 'export PATH="$HOME/.local/bin:$PATH"; claude --version' || {
  echo "Claude Code did not install correctly. Check the output above." >&2
  exit 1
}

cat <<'EOF'

============================================================
 Done. Now paste these commands, one at a time:

   su - claude
   tmux new -s claude
   cd ~/autodidact && claude

 Claude Code shows a login link: open it on your phone,
 approve, and paste the code back. Then type:  /exit

 Still inside tmux, start Remote Control and leave it running:

   claude remote-control

 You can close the console now (tmux keeps it running).
 Then tell Claude "ready" in the Claude app.

 (To get back into it later:  su - claude  then  tmux attach -t claude)
============================================================
EOF
