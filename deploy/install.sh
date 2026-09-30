#!/usr/bin/env bash
# DMARK-Hole installer for Debian 12/13 and Ubuntu 22.04/24.04.
# Run as root inside an LXC container or VM.
#
#   ./deploy/install.sh            # install (idempotent)
#   ./deploy/install.sh --update   # pull / sync, rebuild, restart
#
# Environment overrides:
#   REPO_URL     git repo to clone when not run from a checkout
#   REPO_BRANCH  branch to clone/update (default: repo default branch)
#   APP_DIR      install dir            (default /opt/dmark-hole)
#   DATA_DIR     data dir               (default /var/lib/dmark-hole)
#   ENV_DIR      config dir             (default /etc/dmark-hole)
#   NODE_MAJOR   Node major to install  (default 24)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/CHANGE_ME/dmark-hole.git}"
REPO_BRANCH="${REPO_BRANCH:-}"
APP_DIR="${APP_DIR:-/opt/dmark-hole}"
DATA_DIR="${DATA_DIR:-/var/lib/dmark-hole}"
ENV_DIR="${ENV_DIR:-/etc/dmark-hole}"
NODE_MAJOR="${NODE_MAJOR:-24}"
APP_USER="dmark"
SERVICE="dmark-hole"
ENV_FILE="${ENV_DIR}/dmark-hole.env"

# --- output helpers ------------------------------------------------------------
if [[ -t 1 ]]; then
  C_B=$'\033[1;34m'; C_G=$'\033[1;32m'; C_Y=$'\033[1;33m'; C_R=$'\033[1;31m'; C_0=$'\033[0m'
else
  C_B=""; C_G=""; C_Y=""; C_R=""; C_0=""
fi
step() { echo "${C_B}==>${C_0} ${C_G}$*${C_0}"; }
info() { echo "    $*"; }
warn() { echo "${C_Y}[warn]${C_0} $*" >&2; }
die()  { echo "${C_R}[error]${C_0} $*" >&2; exit 1; }

UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --update|-u) UPDATE=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "This script must be run as root."

export DEBIAN_FRONTEND=noninteractive
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Locate a local checkout (script lives in <repo>/deploy/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
LOCAL_SRC=""
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../package.json" && -f "$SCRIPT_DIR/../pnpm-workspace.yaml" ]]; then
  LOCAL_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# --- OS check --------------------------------------------------------------------
check_os() {
  step "Checking operating system"
  [[ -r /etc/os-release ]] || die "Cannot read /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  local ok=0
  case "${ID:-}:${VERSION_ID:-}" in
    debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ok=1 ;;
  esac
  if [[ $ok -eq 0 ]]; then
    if [[ "${FORCE:-0}" == "1" ]]; then
      warn "Unsupported OS (${PRETTY_NAME:-unknown}); continuing because FORCE=1"
    else
      die "Unsupported OS (${PRETTY_NAME:-unknown}). Supported: Debian 12/13, Ubuntu 22.04/24.04. Set FORCE=1 to try anyway."
    fi
  fi
  info "${PRETTY_NAME:-$ID}"
}

install_prereqs() {
  step "Installing system packages"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git rsync openssl >/dev/null
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$major" -ge "$NODE_MAJOR" ]]
}

install_node() {
  step "Installing Node.js ${NODE_MAJOR}"
  if node_ok; then
    info "Node $(node -v) already installed"
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
    info "Installed Node $(node -v)"
  fi
  # NodeSource ships corepack in Node 24; fall back to npm if it is missing.
  if ! command -v corepack >/dev/null 2>&1; then
    npm install -g corepack >/dev/null
  fi
  corepack enable
}

ensure_user() {
  step "Creating system user '${APP_USER}'"
  if id -u "$APP_USER" >/dev/null 2>&1; then
    info "User already exists"
  else
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR"
}

# --- application source --------------------------------------------------------------
git_update() {
  git -C "$APP_DIR" fetch --quiet origin ${REPO_BRANCH:+"$REPO_BRANCH"}
  if [[ -n "$REPO_BRANCH" ]]; then
    git -C "$APP_DIR" checkout --quiet "$REPO_BRANCH"
    git -C "$APP_DIR" reset --hard --quiet "origin/$REPO_BRANCH"
  else
    git -C "$APP_DIR" pull --ff-only --quiet
  fi
}

fetch_source() {
  if [[ -n "$LOCAL_SRC" && "$LOCAL_SRC" == "$APP_DIR" ]]; then
    step "Using existing checkout in ${APP_DIR}"
    if [[ $UPDATE -eq 1 && -d "$APP_DIR/.git" ]]; then
      info "Pulling latest changes"
      git_update
    fi
    return
  fi
  if [[ -n "$LOCAL_SRC" ]]; then
    step "Syncing local checkout ${LOCAL_SRC} -> ${APP_DIR}"
    mkdir -p "$APP_DIR"
    rsync -a --delete \
      --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
      --exclude '/data' --include '.env.example' --exclude '.env' --exclude '.env.*' \
      "$LOCAL_SRC"/ "$APP_DIR"/
    return
  fi
  if [[ -d "$APP_DIR/.git" ]]; then
    step "Updating ${APP_DIR} from git"
    git_update
  else
    [[ $UPDATE -eq 0 ]] || die "--update: ${APP_DIR} is not a git checkout and no local checkout was found."
    [[ "$REPO_URL" != *CHANGE_ME* ]] || die "Set REPO_URL to your repository (or run this script from a checkout)."
    step "Cloning ${REPO_URL} into ${APP_DIR}"
    [[ ! -e "$APP_DIR" || -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]] || die "${APP_DIR} exists and is not empty."
    git clone --quiet ${REPO_BRANCH:+--branch "$REPO_BRANCH"} "$REPO_URL" "$APP_DIR"
  fi
}

build_app() {
  step "Installing dependencies and building"
  cd "$APP_DIR"
  local pm
  pm="$(node -p 'require("./package.json").packageManager || ""')"
  if [[ -n "$pm" ]]; then
    corepack prepare "$pm" --activate >/dev/null
  fi
  pnpm install --frozen-lockfile
  pnpm build
  [[ -f packages/server/dist/index.js ]] || die "Build finished but packages/server/dist/index.js is missing."
  [[ -f packages/web/dist/index.html ]] || die "Build finished but packages/web/dist/index.html is missing."
  # Code is owned by root and only readable by the service user.
  chmod -R go-w "$APP_DIR"
}

write_env() {
  step "Configuring ${ENV_FILE}"
  install -d -o root -g "$APP_USER" -m 0750 "$ENV_DIR"
  if [[ -f "$ENV_FILE" ]]; then
    info "Config already exists, keeping it"
    return
  fi
  local example="$APP_DIR/.env.example"
  [[ -f "$example" ]] || die "Missing $example"
  install -o root -g "$APP_USER" -m 0640 "$example" "$ENV_FILE"
  # Point DATA_DIR at the state directory (replace the commented default).
  sed -i "s|^#[[:space:]]*DATA_DIR=.*|DATA_DIR=${DATA_DIR}|" "$ENV_FILE"
  grep -q '^DATA_DIR=' "$ENV_FILE" || echo "DATA_DIR=${DATA_DIR}" >> "$ENV_FILE"
  info "Created ${ENV_FILE} (DATA_DIR=${DATA_DIR})"
}

install_unit() {
  step "Installing systemd unit"
  install -m 0644 "$APP_DIR/deploy/dmark-hole.service" "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload
}

env_get() { # env_get KEY DEFAULT
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  echo "${v:-$2}"
}

wait_healthy() {
  local port url
  port="$(env_get PORT 8080)"
  url="http://127.0.0.1:${port}/api/health"
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      info "Health check OK (${url})"
      return 0
    fi
    sleep 1
  done
  warn "Health check did not succeed within 30s. See: journalctl -u ${SERVICE} -e"
  return 1
}

print_summary() {
  local ip port
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  port="$(env_get PORT 8080)"
  echo
  echo "${C_G}DMARK-Hole is running.${C_0}"
  echo "  URL:      http://${ip:-<host-ip>}:${port}"
  echo "  Config:   ${ENV_FILE}"
  echo "  Data:     ${DATA_DIR}"
  echo "  Logs:     journalctl -u ${SERVICE} -f"
  echo "  Update:   ${APP_DIR}/deploy/install.sh --update"
  echo
  echo "Open the URL to create the admin account (first-run setup)."
}

main() {
  check_os
  if [[ $UPDATE -eq 1 ]]; then
    [[ -f "/etc/systemd/system/${SERVICE}.service" ]] || die "Nothing to update: ${SERVICE} is not installed. Run without --update."
    install_prereqs
    install_node
    fetch_source
    build_app
    install_unit
    step "Restarting ${SERVICE}"
    systemctl restart "$SERVICE"
    wait_healthy || true
    step "Update complete"
    return
  fi
  install_prereqs
  install_node
  ensure_user
  fetch_source
  build_app
  write_env
  install_unit
  step "Enabling and starting ${SERVICE}"
  systemctl enable "$SERVICE" >/dev/null 2>&1
  systemctl restart "$SERVICE"
  wait_healthy || true
  print_summary
}

main
