🇬🇧 English · 🇪🇸 [Español](README.es.md)

# DMARK-Hole

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Node 24](https://img.shields.io/badge/Node-24-339933?logo=nodedotjs&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white) ![Proxmox LXC](https://img.shields.io/badge/Proxmox-LXC-E57000?logo=proxmox&logoColor=white)

A self-hosted DMARC report receiver and analyzer. A single process (Node.js 24 + `node:sqlite`): no external database, no Redis, no native modules.

## Languages

The web UI is available in **English and Spanish**. The language is detected automatically from your browser and can be switched at any time with the language selector in the UI. The server localizes DNS checks, recommendations, alerts and API errors per request (via the `x-locale` header). The language of **notifications** (webhook and email) is configurable in Settings (`language`: `en` or `es`, default `en`).

## What it does

- **Receives** aggregate (**rua**) and forensic (**ruf**) reports for one or more domains: **IMAP** mailbox polling, a **built-in SMTP receiver**, **HTTP ingest with a token**, or **manual upload** of files (XML, gz, zip, eml).
- **Parses** every report and **enriches** source IPs with reverse DNS, ASN and country.
- **Classifies** traffic into four categories: `pass`, `forwarded` (legitimate forwarding), `misaligned` and `fail`.
- **Checks DNS** for each domain (DMARC, SPF, DKIM, MTA-STS, TLS-RPT and BIMI) and produces recommendations.
- **Alerts** you through a webhook or email.
- **Modern web UI** (Vue 3), bilingual (English and Spanish), served by the same process alongside the API under `/api` (port 8080).

## Quick install

**Proxmox (LXC): one command.** In the Proxmox host shell, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

It creates an unprivileged Debian 12 (or 13) container, installs DMARK-Hole as a service and prints the URL when done (`http://<container-ip>:8080`). Open that URL and create the administrator account.

**Docker:**

```bash
git clone https://github.com/NaturalDevCR/dmark-hole.git && cd dmark-hole && docker compose up -d
```

**Debian / Ubuntu (VM, existing LXC or server):**

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/install.sh)"
```

After installing: add your domains, choose how reports reach DMARK-Hole (IMAP mailbox, SMTP receiver or HTTP; see [How to receive reports](#how-to-receive-reports)) and publish your DMARC record with `rua=` pointing to that address.

## Detailed installation

Requirements: none with Docker or the installers. To run it by hand: Node.js >= 22.13 (it uses `node:sqlite`; Node 24 LTS is recommended) and pnpm 10.

### Proxmox VE (LXC container)

The script runs **on the Proxmox host** as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

What it does, step by step:

1. Checks that it is running on a Proxmox host (`pct`, `pveam`).
2. Asks for the ID, hostname, storage, bridge, CPU/RAM/disk and IP (press Enter to accept a default).
3. Downloads the Debian template (12 by default) if it is not already present.
4. Creates an **unprivileged** container with `nesting=1` and start-on-boot, then starts it.
5. Runs `deploy/install.sh` inside the container: installs Node 24, clones this repository into `/opt/dmark-hole`, builds it and registers the `dmark-hole` systemd service.
6. Prints the IP and the URL.

Default resources: 1 core, 1 GB RAM, 4 GB disk (enough for dozens of domains; increase the disk if you keep many months of reports).

Unattended install (no prompts), for example with a static IP:

```bash
CTID=150 CT_HOSTNAME=dmarc STORAGE=local-lvm BRIDGE=vmbr0 IP=192.168.1.50/24 GATEWAY=192.168.1.1 NONINTERACTIVE=1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

| Variable | Default | Description |
|---|---|---|
| `CTID` | next free ID | Container ID |
| `CT_HOSTNAME` | `dmark-hole` | Hostname |
| `STORAGE` | `local-lvm` / first available | Storage for the container disk |
| `TEMPLATE_STORAGE` | `local` | Storage for OS templates |
| `BRIDGE` / `VLAN` | `vmbr0` / none | Network |
| `CORES` / `RAM` / `DISK` | `1` / `1024` (MB) / `4` (GB) | Resources |
| `IP` / `GATEWAY` / `DNS` | `dhcp` | IP in CIDR notation and gateway when static |
| `DEBIAN_VERSION` | `12` | `12` or `13` |
| `REPO_URL` / `REPO_BRANCH` | this repository / `main` | Install from a fork or a branch |

No GitHub access from the container? Copy the whole repository to the host and run the script from there. It packages the local code and pushes it into the container:

```bash
scp -r dmark-hole root@proxmox:/root/
ssh -t root@proxmox bash /root/dmark-hole/deploy/proxmox/dmark-hole-lxc.sh
```

To receive reports through the **SMTP receiver** in the LXC, forward port 25 on your router/firewall to the container's IP and set `SMTP_PORT=25` in `/etc/dmark-hole/dmark-hole.env` (see below).

### Docker

```bash
git clone https://github.com/NaturalDevCR/dmark-hole.git
cd dmark-hole
docker compose up -d
```

The UI is available at `http://<host>:8080`. On first access, the initial setup page creates the administrator account (or set `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

- Data (the SQLite database and the generated secret) lives in the `dmark-data` volume, mounted at `/data`.
- Customize the variables in the `environment` section of `docker-compose.yml`. Port 2525 is only used if you enable the SMTP receiver.

### Debian / Ubuntu (systemd)

On a VM, LXC or server running Debian 12/13 or Ubuntu 22.04/24.04, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/install.sh)"
```

or from a clone of the repository:

```bash
git clone https://github.com/NaturalDevCR/dmark-hole.git
cd dmark-hole
./deploy/install.sh
```

The installer is idempotent and:

1. installs Node 24 (NodeSource) and enables corepack/pnpm;
2. creates the `dmark` system user;
3. installs the application in `/opt/dmark-hole` and builds it (`pnpm install` + `pnpm build`);
4. creates `/etc/dmark-hole/dmark-hole.env` (with `DATA_DIR=/var/lib/dmark-hole`);
5. installs and starts the `dmark-hole` systemd service and checks `/api/health`.

Useful commands:

```bash
systemctl status dmark-hole
journalctl -u dmark-hole -f
systemctl restart dmark-hole   # after editing /etc/dmark-hole/dmark-hole.env
```

The systemd unit is hardened (`ProtectSystem=strict`, `NoNewPrivileges`, etc.) and grants `CAP_NET_BIND_SERVICE`, so it can bind `SMTP_PORT=25` directly.

## Updating

| Method | Procedure |
|---|---|
| Docker | `git pull && docker compose up -d --build` |
| LXC / systemd | `/opt/dmark-hole/deploy/install.sh --update` (inside the container) |
| LXC from the host | `pct exec <CTID> -- /opt/dmark-hole/deploy/install.sh --update` |
| LXC without GitHub access | Copy the new version into the container (`pct push` a `.tar.gz`, or `scp`), extract it and run `./deploy/install.sh --update` from that folder |

`--update` runs `git pull` (or syncs the local checkout), rebuilds and restarts the service. Your configuration and data are left untouched. Take a backup before updating (see [Backups](#backups)).

## Configuration

All variables are optional. See [`.env.example`](.env.example). With systemd, edit them in `/etc/dmark-hole/dmark-hole.env`; with Docker, in `docker-compose.yml`.

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `./data` (Docker: `/data`) | SQLite database and generated secret |
| `PORT` | `8080` | HTTP port (UI + API) |
| `HOST` | `0.0.0.0` | Listen address |
| `SECRET_KEY` | auto-generated | Signs sessions and encrypts stored credentials (>= 32 characters). If unset, it is generated in `DATA_DIR/.secret` |
| `LOG_LEVEL` | `info` | Log level |
| `TRUST_PROXY` | `false` | `true` when behind a reverse proxy |
| `SECURE_COOKIES` | `false` | `true` when served over HTTPS |
| `WEB_DIST` | bundled | Path to the built web UI |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | empty | Initial administrator; if unset, the first-run setup page is used |
| `SMTP_ENABLED` | `false` | Initial value for the built-in SMTP receiver; once the settings are saved from the UI, the UI value wins |
| `SMTP_ALLOWED_RECIPIENTS` | empty | Recipients accepted by the SMTP receiver, comma separated (`dmarc@reports.example.com`, `@reports.example.com`). **Required**: without a list, the receiver rejects everything. Editable in the UI |
| `SMTP_PORT` | `2525` | SMTP receiver port |
| `SMTP_LISTEN_HOST` | `0.0.0.0` | SMTP listen address |
| `SMTP_MAX_SIZE_MB` | `25` | Maximum message size |
| `SMTP_TLS_KEY` / `SMTP_TLS_CERT` | empty | Paths to a PEM key and certificate for STARTTLS |
| `DISABLE_SCHEDULER` | `false` | Disables scheduled tasks (IMAP, DNS, alerts) |

Behind an HTTPS reverse proxy (Caddy, Traefik, nginx): point it at port 8080 and set `TRUST_PROXY=true` and `SECURE_COOKIES=true`.

The notification language (`language`: `en` | `es`, default `en`) is not an environment variable: change it in Settings in the UI.

Health check: `GET /api/health` returns 200 with JSON.

## How to receive reports

### 1. Publish the DMARC record

In the DNS of each domain you want to monitor:

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain"
```

`p=none` only observes, so it is the recommended starting point. Add `ruf=mailto:...` if you want forensic reports (few providers send them). DMARK-Hole will tell you when it is safe to move to `quarantine` or `reject`.

### External destination authorization

If the `rua` address is in a **different domain** than the one being monitored (for example `rua=mailto:dmarc@receiver.com` for `example.com`), the receiving domain must authorize it with this TXT record:

```
example.com._report._dmarc.receiver.com.  TXT  "v=DMARC1"
```

Without it, providers will not send the reports. You can use a wildcard: `*._report._dmarc.receiver.com TXT "v=DMARC1"`.

### Option A: dedicated mailbox + IMAP

Create a mailbox (e.g. `dmarc@yourdomain`) with your mail provider, use that address in `rua`, and add the mailbox in DMARK-Hole (IMAP server, username and password; they are stored encrypted). The application polls it periodically and imports the attached reports. This is the simplest option if you already have email.

### Option B: built-in SMTP receiver

DMARK-Hole receives the mail directly, with no intermediate mailbox.

1. Enable `SMTP_ENABLED=true` (or turn it on in the UI) and set the allowed recipients (`SMTP_ALLOWED_RECIPIENTS`, or Ingest → SMTP receiver). Without them the receiver rejects all mail, so nobody can inject fake reports.
2. Create an **MX** record for a reports domain or subdomain pointing to the host, e.g. `reports.example.com. MX 10 dmark.example.com.`, plus an A/AAAA record for `dmark.example.com`.
3. Use `rua=mailto:dmarc@reports.example.com`. If it is a different domain from the monitored one, add the authorization record described above.
4. Ports: the service listens on `SMTP_PORT` (2525 by default). Incoming mail arrives on port **25**, so:
   - Docker: publish `"25:2525"` in `docker-compose.yml`.
   - systemd: set `SMTP_PORT=25` (the unit already grants `CAP_NET_BIND_SERVICE`) or redirect 25 → 2525 with nftables/iptables.
   - LXC/Proxmox: open port 25 on the host firewall and forward it to the container's IP.
5. **Firewall**: allow inbound 25/TCP from the Internet. Many ISPs block inbound port 25 on residential connections; check with your provider.
6. Optional: set `SMTP_TLS_KEY` and `SMTP_TLS_CERT` to offer STARTTLS.

The receiver should only be exposed for reports: it does not send mail or act as a relay.

### Option C: HTTP (scripts, Postfix pipes, webhooks)

Every instance has an ingest token (Ingest → API / HTTP in the UI). Any supported format (`.xml`, `.gz`, `.zip`, `.eml`) can be sent this way:

```bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/gzip" \
  --data-binary @report.xml.gz http://<host>:8080/api/ingest/raw
```

Handy, for example, with a Postfix alias: `dmarc: "|curl -s -X POST -H 'Authorization: Bearer <token>' --data-binary @- http://127.0.0.1:8080/api/ingest/raw"`.

### Manual upload

In the UI you can upload `.xml`, `.gz`, `.zip` or `.eml` report files to import them without configuring anything.

## How the analysis works

Each record in an aggregate report (a source IP + authentication results + message count) is processed as follows:

1. **Alignment**: recomputed from `auth_results` using the published mode (`adkim`/`aspf`, relaxed or strict) and the organizational domain according to the Public Suffix List. SPF only counts if it is for the `MAIL FROM`.
2. **DMARC result**: the receiver's evaluation (`policy_evaluated`) is respected; it passes if SPF **or** DKIM pass aligned.
3. **Traffic classification**:

| Category | Meaning | What to do |
|---|---|---|
| **Authenticated** (`pass`) | Passes DMARC with aligned SPF and/or DKIM | Nothing |
| **Forwarded** (`forwarded`) | Forwarding and mailing lists: aligned DKIM survives but SPF for your own domain fails, or the receiver reports `forwarded`/`mailing_list`/`trusted_forwarder` | Usually nothing; make sure everything is DKIM-signed |
| **Misaligned** (`misaligned`) | SPF or DKIM pass, but for **another domain** (e.g. `sendgrid.net`). Almost always a legitimate service that is not fully configured | Set up custom DKIM / your own Return-Path in that service before tightening your policy |
| **Unauthenticated** (`fail`) | Neither SPF nor DKIM pass | Spoofing, or one of your own servers that is not declared |

4. **IP enrichment**: reverse DNS (PTR), ASN and country via Team Cymru DNS (no external APIs or keys). From PTR, ASN and signing domains, the **provider** is detected (Google, Microsoft 365, Amazon SES, SendGrid, Mailchimp, Mailgun, Zoho, Salesforce, HubSpot, etc.) and IPs are grouped by service.
5. **Source status**: *Authorized* (>= 90% authenticated), *Forwarder*, *Needs setup* (mostly misaligned), *Suspicious* (mostly unauthenticated) or *Mixed*.
6. **Domain health** (0-100): 60% DMARC compliance over the last 30 days + 40% DNS score (DMARC, policy, rua, SPF and its 10-lookup limit, DKIM keys and their size, MTA-STS, TLS-RPT).
7. **Prioritized recommendations**: missing or invalid records, SPF with more than 10 lookups, weak DKIM keys or unpublished selectors, services to align, unauthorized external `rua` destinations, and **when it is safe to move to `quarantine` / `reject`** (with the suggested record ready to copy).

Automatic alerts: a new IP sending unauthenticated mail, daily compliance dropping below the threshold, DNS record changes and the arrival of forensic reports. They are delivered by webhook (Slack, Discord, Teams or generic JSON) and/or email, plus an optional weekly digest.

Forensic reports (RUF) contain personal data (headers of real messages); they are stored separately and deleted after `forensicRetentionDays` (30 days by default).

## Backups

All state lives in `DATA_DIR` (the SQLite database and `.secret`). Keep both: without `.secret` (or `SECRET_KEY`), the stored IMAP credentials cannot be decrypted.

Simple copy, with the service stopped:

```bash
systemctl stop dmark-hole
cp -a /var/lib/dmark-hole /backup/dmark-hole-$(date +%F)
systemctl start dmark-hole
```

Consistent hot backup using SQLite's backup command:

```bash
sqlite3 /var/lib/dmark-hole/dmark-hole.db ".backup '/backup/dmark-hole-$(date +%F).db'"
cp /var/lib/dmark-hole/.secret /backup/
```

With Docker:

```bash
docker run --rm -v dmark-hole_dmark-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/dmark-data-$(date +%F).tgz -C /data .
```

(The actual volume name is `<project>_dmark-data`; check it with `docker volume ls`.) To restore, stop the service and put the files back into `DATA_DIR`.

## Development

Requirements: Node >= 22.13 and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env   # optional
pnpm dev               # server on :8080 and web (Vite) on :5173
```

`pnpm dev` starts both packages; the web app at `http://localhost:5173` proxies `/api` to the server on port 8080 (change the target with `API_URL`).

Demo data (generates realistic reports to try out the UI; do not use in production):

```bash
DATA_DIR=./data pnpm --filter @dmark-hole/server demo -- --days 60
```

Other commands:

```bash
pnpm build      # builds web (packages/web/dist) and server (packages/server/dist)
pnpm start      # node packages/server/dist/index.js
pnpm test       # server tests
pnpm typecheck
```

Layout: `packages/server` (`@dmark-hole/server`, Fastify + `node:sqlite`) and `packages/web` (`@dmark-hole/web`, Vue 3 + Vite). In production the server serves the built SPA and the API under `/api`.

## License

[MIT](LICENSE): you may use, modify and redistribute it freely, including commercially, as long as you keep the copyright notice.
