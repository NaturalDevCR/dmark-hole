#!/usr/bin/env bash
# DMARK-Hole - create an LXC container on a Proxmox VE host and install the app.
# Run this ON THE PROXMOX HOST, as root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/CHANGE_ME/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
#
# Every setting can be preset through environment variables (skips its prompt),
# e.g. for unattended use:
#   CTID=120 CT_HOSTNAME=dmark STORAGE=local-lvm BRIDGE=vmbr0 NONINTERACTIVE=1 ./dmark-hole-lxc.sh
#
#   CTID              container id                      (default: next free id)
#   CT_HOSTNAME       container hostname (HOSTNAME also accepted)  (dmark-hole)
#   STORAGE           rootfs storage                    (local-lvm if present, else first rootdir storage)
#   TEMPLATE_STORAGE  storage for the OS template       (local if present, else first vztmpl storage)
#   BRIDGE            network bridge                    (vmbr0)
#   VLAN              optional VLAN tag                 (none)
#   CORES / RAM / DISK   1 core / 1024 MB / 4 GB
#   IP                dhcp or CIDR, e.g. 192.168.1.50/24  (dhcp)
#   GATEWAY           gateway when IP is static
#   DNS               optional nameserver
#   DEBIAN_VERSION    12 or 13                          (12)
#   REPO_URL          git repo cloned inside the container
#   REPO_BRANCH       optional branch
#   REPO_RAW_URL      raw base URL used to fetch install.sh if not next to this script
#   NONINTERACTIVE=1  never prompt, use defaults/env
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/CHANGE_ME/dmark-hole.git}"
REPO_BRANCH="${REPO_BRANCH:-}"
REPO_RAW_URL="${REPO_RAW_URL:-https://raw.githubusercontent.com/CHANGE_ME/dmark-hole/main}"

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

# --- preflight -----------------------------------------------------------------
command -v pct >/dev/null 2>&1 || die "'pct' not found. This script must run on a Proxmox VE host."
command -v pveam >/dev/null 2>&1 || die "'pveam' not found. This script must run on a Proxmox VE host."
[[ $EUID -eq 0 ]] || die "Run as root on the Proxmox host."

INTERACTIVE=1
[[ -t 0 && "${NONINTERACTIVE:-0}" != "1" ]] || INTERACTIVE=0

# ask VAR "Prompt" DEFAULT : env value wins, then prompt (if interactive), then default.
ask() {
  local var="$1" prompt="$2" def="$3" reply
  if [[ -n "${!var:-}" ]]; then return 0; fi
  if [[ $INTERACTIVE -eq 1 ]]; then
    read -r -p "${prompt} [${def}]: " reply || true
    printf -v "$var" '%s' "${reply:-$def}"
  else
    printf -v "$var" '%s' "$def"
  fi
}

first_storage() { # first_storage CONTENT [PREFERRED...]
  local content="$1"; shift
  local list pref
  list="$(pvesm status --content "$content" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}')"
  for pref in "$@"; do
    if grep -qx "$pref" <<<"$list"; then echo "$pref"; return; fi
  done
  head -n1 <<<"$list"
}

# --- settings ------------------------------------------------------------------
step "Configuration"

# HOSTNAME is a bash builtin; only honour it when it differs from the host's own name.
CT_HOSTNAME="${CT_HOSTNAME:-}"
if [[ -z "$CT_HOSTNAME" && -n "${HOSTNAME:-}" && "$HOSTNAME" != "$(hostname)" ]]; then
  CT_HOSTNAME="$HOSTNAME"
fi

DEFAULT_CTID="$(pvesh get /cluster/nextid 2>/dev/null || echo 100)"
DEFAULT_STORAGE="$(first_storage rootdir local-lvm local-zfs local)"
DEFAULT_TSTORAGE="$(first_storage vztmpl local)"
[[ -n "$DEFAULT_STORAGE" ]] || die "No storage with 'rootdir' content found."
[[ -n "$DEFAULT_TSTORAGE" ]] || die "No storage with 'vztmpl' content found (enable it on a storage)."

CTID="${CTID:-}"; STORAGE="${STORAGE:-}"; TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-}"
BRIDGE="${BRIDGE:-}"; CORES="${CORES:-}"; RAM="${RAM:-}"; DISK="${DISK:-}"
IP="${IP:-}"; GATEWAY="${GATEWAY:-}"; VLAN="${VLAN:-}"; DNS="${DNS:-}"
DEBIAN_VERSION="${DEBIAN_VERSION:-12}"

ask CTID             "Container ID"                 "$DEFAULT_CTID"
ask CT_HOSTNAME      "Hostname"                     "dmark-hole"
ask STORAGE          "Storage for container disk"  "$DEFAULT_STORAGE"
ask TEMPLATE_STORAGE "Storage for OS template"      "$DEFAULT_TSTORAGE"
ask BRIDGE           "Network bridge"               "vmbr0"
ask CORES            "CPU cores"                    "1"
ask RAM              "RAM (MB)"                     "1024"
ask DISK             "Disk size (GB)"               "4"
ask IP               "IPv4 address (dhcp or CIDR)"  "dhcp"
if [[ "$IP" != "dhcp" ]]; then
  ask GATEWAY        "Gateway"                      ""
  [[ -n "$GATEWAY" ]] || die "A static IP needs GATEWAY."
fi

[[ "$CTID" =~ ^[0-9]+$ && "$CTID" -ge 100 ]] || die "Invalid CTID: $CTID"
[[ "$CORES" =~ ^[0-9]+$ && "$RAM" =~ ^[0-9]+$ && "$DISK" =~ ^[0-9]+$ ]] || die "CORES, RAM and DISK must be integers."
[[ "$DEBIAN_VERSION" =~ ^(12|13)$ ]] || die "DEBIAN_VERSION must be 12 or 13."
if pct status "$CTID" >/dev/null 2>&1 || qm status "$CTID" >/dev/null 2>&1; then
  die "ID $CTID is already in use."
fi
pvesm status >/dev/null 2>&1 || die "Cannot query storages."
pvesm status | awk 'NR>1{print $1}' | grep -qx "$STORAGE" || die "Storage '$STORAGE' not found."
pvesm status | awk 'NR>1{print $1}' | grep -qx "$TEMPLATE_STORAGE" || die "Storage '$TEMPLATE_STORAGE' not found."

info "CT $CTID '$CT_HOSTNAME' | ${CORES} cores, ${RAM} MB RAM, ${DISK} GB on ${STORAGE} | ${BRIDGE} / ${IP}"

# --- template ------------------------------------------------------------------------
step "Preparing Debian ${DEBIAN_VERSION} template"
pveam update >/dev/null || warn "pveam update failed; using cached template list"
TEMPLATE="$(pveam available --section system | awk '{print $2}' \
  | grep -E "^debian-${DEBIAN_VERSION}-standard_.*_amd64\.tar\.(zst|gz|xz)$" | sort -V | tail -n1 || true)"
[[ -n "$TEMPLATE" ]] || die "No debian-${DEBIAN_VERSION}-standard template available (try DEBIAN_VERSION=12/13)."
if pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep -q "/${TEMPLATE}\$"; then
  info "Template already downloaded: $TEMPLATE"
else
  info "Downloading $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

# --- container ------------------------------------------------------------------------
step "Creating container $CTID"
NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
[[ "$IP" == "dhcp" || -z "$GATEWAY" ]] || NET+=",gw=${GATEWAY}"
[[ -z "$VLAN" ]] || NET+=",tag=${VLAN}"

CREATE_ARGS=(
  "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
  --hostname "$CT_HOSTNAME"
  --cores "$CORES" --memory "$RAM" --swap 512
  --rootfs "${STORAGE}:${DISK}"
  --net0 "$NET"
  --unprivileged 1 --features nesting=1
  --onboot 1 --ostype debian
  --tags dmark-hole
)
[[ -z "$DNS" ]] || CREATE_ARGS+=(--nameserver "$DNS")
pct create "${CREATE_ARGS[@]}"

on_error() {
  warn "Failed. The container $CTID was left in place for inspection; remove with: pct stop $CTID; pct destroy $CTID"
}
trap on_error ERR

step "Starting container"
pct start "$CTID"

step "Waiting for network"
CT_IP=""
for _ in $(seq 1 60); do
  CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "$CT_IP" ]] && break
  sleep 1
done
[[ -n "$CT_IP" ]] || die "Container did not get an IP address."
ONLINE=0
for _ in $(seq 1 30); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then ONLINE=1; break; fi
  sleep 2
done
[[ $ONLINE -eq 1 ]] || die "Container has no working DNS/Internet access (IP: $CT_IP). Check bridge, gateway and DNS."
info "Container IP: $CT_IP"

# --- install ------------------------------------------------------------------------------
step "Installing DMARK-Hole inside the container"
SELF="${BASH_SOURCE[0]:-}"
INSTALL_SRC=""
if [[ -n "$SELF" && -f "$SELF" ]]; then
  CAND="$(cd "$(dirname "$SELF")" && pwd)/../install.sh"
  [[ -f "$CAND" ]] && INSTALL_SRC="$CAND"
fi
TMP_INSTALL=""
if [[ -z "$INSTALL_SRC" ]]; then
  [[ "$REPO_RAW_URL" != *CHANGE_ME* ]] || die "install.sh not found next to this script and REPO_RAW_URL is a placeholder. Set REPO_RAW_URL."
  TMP_INSTALL="$(mktemp)"
  trap 'rm -f "$TMP_INSTALL"' EXIT
  info "Fetching ${REPO_RAW_URL}/deploy/install.sh"
  curl -fsSL "${REPO_RAW_URL}/deploy/install.sh" -o "$TMP_INSTALL"
  INSTALL_SRC="$TMP_INSTALL"
fi
pct push "$CTID" "$INSTALL_SRC" /root/install.sh --perms 0755
pct exec "$CTID" -- env "REPO_URL=${REPO_URL}" "REPO_BRANCH=${REPO_BRANCH}" bash /root/install.sh

CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || echo "$CT_IP")"
PORT=8080
echo
echo "${C_G}DMARK-Hole is ready.${C_0}"
echo "  Container: $CTID ($CT_HOSTNAME)"
echo "  URL:       http://${CT_IP}:${PORT}"
echo "  Shell:     pct enter $CTID"
echo "  Update:    pct exec $CTID -- /opt/dmark-hole/deploy/install.sh --update"
echo "  Config:    /etc/dmark-hole/dmark-hole.env (inside the container)"
