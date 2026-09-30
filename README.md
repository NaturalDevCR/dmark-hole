# DMARK-Hole

Receptor y analizador de reportes DMARC auto-alojado. Un único proceso (Node.js + SQLite), sin base de datos externa, sin Redis, sin módulos nativos.

## Qué hace

- **Recibe** reportes agregados (**rua**) y forenses (**ruf**) de uno o varios dominios por tres vías: sondeo **IMAP** de un buzón, **receptor SMTP integrado** o **subida manual** de archivos (XML, gz, zip).
- **Analiza** cada reporte y **enriquece** las IP de origen con DNS inverso, ASN y país.
- **Clasifica** el tráfico en cuatro categorías: `pass`, `forwarded` (reenvíos legítimos), `misaligned` (desalineado) y `fail`.
- **Comprueba el DNS** de cada dominio (DMARC, SPF, DKIM, MTA-STS, TLS-RPT y BIMI) y genera recomendaciones.
- **Alerta** por webhook o correo electrónico.
- **Interfaz web moderna** (Vue 3) servida por el mismo proceso, junto con la API bajo `/api`.

Requisitos: Node.js >= 22.13 (usa `node:sqlite`; se recomienda Node 24 LTS). Con Docker o el instalador no hace falta instalar nada a mano.

## Instalación

### Docker

```bash
git clone https://github.com/CHANGE_ME/dmark-hole.git
cd dmark-hole
docker compose up -d
```

La interfaz queda en `http://<host>:8080`. En el primer acceso, la página de configuración inicial crea el usuario administrador (o define `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

- Los datos (SQLite y secreto generado) viven en el volumen `dmark-data`, montado en `/data`.
- Personaliza las variables en la sección `environment` de `docker-compose.yml`. El puerto 2525 solo se usa si activas el receptor SMTP.

### Contenedor LXC en Proxmox

Ejecuta esto **en el host Proxmox** como root. Crea un contenedor Debian sin privilegios (nesting activado, inicio automático) e instala la aplicación dentro:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/CHANGE_ME/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

Alternativa (sin publicar el código en GitHub): copia **el repositorio completo** al host y ejecuta el script desde ahí. El script empaqueta el código local, lo sube al contenedor e instala desde esa copia:

```bash
scp -r dmark-hole root@proxmox:/root/
ssh root@proxmox bash /root/dmark-hole/deploy/proxmox/dmark-hole-lxc.sh
```

O, si el código está en un repositorio git accesible, copia solo el script y define las URLs:

```bash
scp deploy/proxmox/dmark-hole-lxc.sh root@proxmox:/root/
ssh root@proxmox
export REPO_URL=https://github.com/CHANGE_ME/dmark-hole.git
export REPO_RAW_URL=https://raw.githubusercontent.com/CHANGE_ME/dmark-hole/main
bash /root/dmark-hole-lxc.sh
```

El script pregunta los valores con opciones por defecto. Para uso desatendido, pásalos como variables de entorno (y `NONINTERACTIVE=1`):

| Variable | Por defecto | Descripción |
|---|---|---|
| `CTID` | siguiente libre | ID del contenedor |
| `CT_HOSTNAME` (o `HOSTNAME`) | `dmark-hole` | Nombre de host |
| `STORAGE` | `local-lvm` / primero disponible | Almacenamiento del disco |
| `TEMPLATE_STORAGE` | `local` | Almacenamiento de plantillas |
| `BRIDGE` | `vmbr0` | Bridge de red |
| `CORES` / `RAM` / `DISK` | `1` / `1024` (MB) / `4` (GB) | Recursos |
| `IP` / `GATEWAY` | `dhcp` | IP en formato CIDR y puerta de enlace si es estática |
| `DEBIAN_VERSION` | `12` | `12` o `13` |
| `REPO_URL` / `REPO_RAW_URL` | placeholder | Repositorio git y URL raw de GitHub |

Al terminar imprime la IP y la URL (`http://<ip>:8080`).

### Debian / Ubuntu (manual)

En un LXC o una VM con Debian 12/13 o Ubuntu 22.04/24.04, como root:

```bash
git clone https://github.com/CHANGE_ME/dmark-hole.git
cd dmark-hole
./deploy/install.sh
```

Si no lo ejecutas desde un checkout, define `REPO_URL` y el script clona el repositorio por ti. El instalador es idempotente y:

1. instala Node 24 (NodeSource), habilita corepack/pnpm;
2. crea el usuario de sistema `dmark`;
3. instala la aplicación en `/opt/dmark-hole` y la compila (`pnpm install` + `pnpm build`);
4. crea `/etc/dmark-hole/dmark-hole.env` (con `DATA_DIR=/var/lib/dmark-hole`);
5. instala y arranca el servicio systemd `dmark-hole`.

Comandos útiles:

```bash
systemctl status dmark-hole
journalctl -u dmark-hole -f
systemctl restart dmark-hole   # tras editar /etc/dmark-hole/dmark-hole.env
```

La unidad systemd tiene hardening (`ProtectSystem=strict`, `NoNewPrivileges`, etc.) y concede `CAP_NET_BIND_SERVICE`, de modo que puedes usar `SMTP_PORT=25` directamente.

## Actualización

| Método | Procedimiento |
|---|---|
| Docker | `git pull && docker compose up -d --build` |
| LXC / systemd | `/opt/dmark-hole/deploy/install.sh --update` (dentro del contenedor) |
| LXC desde el host | `pct exec <CTID> -- /opt/dmark-hole/deploy/install.sh --update` |
| LXC sin repositorio git | Copia la nueva versión al contenedor (`pct push` de un `.tar.gz` o `scp`), descomprímela y ejecuta `./deploy/install.sh --update` desde esa carpeta: sincroniza el código a `/opt/dmark-hole`, recompila y reinicia |

`--update` hace `git pull` (o sincroniza el checkout local), reconstruye y reinicia el servicio. La configuración y los datos no se tocan. Haz una copia de seguridad antes de actualizar (ver más abajo).

## Configuración

Todas las variables son opcionales. Ver [`.env.example`](.env.example). En systemd se editan en `/etc/dmark-hole/dmark-hole.env`; en Docker, en `docker-compose.yml`.

| Variable | Por defecto | Descripción |
|---|---|---|
| `DATA_DIR` | `./data` (Docker: `/data`) | Base de datos SQLite y secreto generado |
| `PORT` | `8080` | Puerto HTTP (UI + API) |
| `HOST` | `0.0.0.0` | Dirección de escucha |
| `SECRET_KEY` | autogenerada | Firma de sesiones y cifrado de credenciales (>= 32 caracteres). Si falta se genera en `DATA_DIR/.secret` |
| `LOG_LEVEL` | `info` | Nivel de log |
| `TRUST_PROXY` | `false` | `true` si hay un proxy inverso delante |
| `SECURE_COOKIES` | `false` | `true` si sirves por HTTPS |
| `WEB_DIST` | incluido | Ruta de la interfaz compilada |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | vacío | Administrador inicial; si faltan, se usa la página de configuración inicial |
| `SMTP_ENABLED` | `false` | Activa el receptor SMTP integrado (también desde la UI) |
| `SMTP_ALLOWED_RECIPIENTS` | vacío | Destinatarios aceptados por el receptor SMTP, separados por comas (`dmarc@reports.example.com`, `@reports.example.com`). **Obligatorio**: sin lista, el receptor rechaza todo. Editable en la UI |
| `SMTP_PORT` | `2525` | Puerto del receptor SMTP |
| `SMTP_LISTEN_HOST` | `0.0.0.0` | Dirección de escucha SMTP |
| `SMTP_MAX_SIZE_MB` | `25` | Tamaño máximo de mensaje |
| `SMTP_TLS_KEY` / `SMTP_TLS_CERT` | vacío | Rutas a clave y certificado PEM para STARTTLS |
| `DISABLE_SCHEDULER` | `false` | Desactiva tareas programadas (IMAP, DNS, alertas) |

Detrás de un proxy HTTPS (Caddy, Traefik, nginx): apunta al puerto 8080 y define `TRUST_PROXY=true` y `SECURE_COOKIES=true`.

Comprobación de salud: `GET /api/health` devuelve 200 con JSON.

## Cómo recibir los reportes

### 1. Publica el registro DMARC

En el DNS de cada dominio a monitorizar:

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain"
```

`p=none` solo observa: es el punto de partida recomendado. Añade `ruf=mailto:...` si quieres reportes forenses (pocos proveedores los envían). DMARK-Hole te recomendará cuándo pasar a `quarantine` o `reject`.

### Autorización de destino externo

Si la dirección `rua` está en **otro dominio** distinto del monitorizado (por ejemplo `rua=mailto:dmarc@receiver.com` para `example.com`), el dominio receptor debe autorizarlo con este registro TXT:

```
example.com._report._dmarc.receiver.com.  TXT  "v=DMARC1"
```

Sin él, los proveedores no enviarán los reportes. Puedes usar un comodín: `*._report._dmarc.receiver.com TXT "v=DMARC1"`.

### Opción A: buzón dedicado + IMAP

Crea un buzón (p. ej. `dmarc@yourdomain`) en tu proveedor de correo, usa esa dirección en `rua` y añade el buzón en DMARK-Hole (servidor IMAP, usuario y contraseña; se guardan cifrados). La aplicación lo consulta periódicamente e importa los reportes adjuntos. Es la opción más sencilla si ya tienes correo.

### Opción B: receptor SMTP integrado

DMARK-Hole recibe el correo directamente, sin buzón intermedio.

1. Activa `SMTP_ENABLED=true` (o desde la interfaz) y define los destinatarios permitidos (`SMTP_ALLOWED_RECIPIENTS` o Ingesta → Receptor SMTP). Sin ellos el receptor rechaza todo el correo, para que nadie pueda inyectar reportes falsos.
2. Crea un registro **MX** para un dominio o subdominio de reportes apuntando al host, p. ej. `reports.example.com. MX 10 dmark.example.com.`, y un registro A/AAAA para `dmark.example.com`.
3. Usa `rua=mailto:dmarc@reports.example.com`. Si es un dominio distinto al monitorizado, añade el registro de autorización descrito arriba.
4. Puertos: el servicio escucha en `SMTP_PORT` (2525 por defecto). El correo entrante llega al **25**, así que:
   - Docker: publica `"25:2525"` en `docker-compose.yml`.
   - systemd: define `SMTP_PORT=25` (la unidad ya concede `CAP_NET_BIND_SERVICE`) o redirige 25 → 2525 con nftables/iptables.
   - LXC/Proxmox: abre el 25 en el firewall del host y redirige hacia la IP del contenedor.
5. **Firewall**: abre el puerto 25/TCP entrante desde Internet. Muchos ISP bloquean el 25 entrante en conexiones residenciales; comprueba con tu proveedor.
6. Opcional: define `SMTP_TLS_KEY` y `SMTP_TLS_CERT` para ofrecer STARTTLS.

El receptor solo debe exponerse para reportes: no envía correo ni actúa como relay.

### Opción C: HTTP (scripts, pipes de Postfix, webhooks)

Cada instancia tiene un token de ingesta (Ingesta → API / HTTP en la interfaz). Cualquier formato aceptado (`.xml`, `.gz`, `.zip`, `.eml`) se puede enviar así:

```bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/gzip" \
  --data-binary @reporte.xml.gz http://<host>:8080/api/ingest/raw
```

Útil, por ejemplo, con un alias de Postfix `dmarc: "|curl -s -X POST -H 'Authorization: Bearer <token>' --data-binary @- http://127.0.0.1:8080/api/ingest/raw"`.

### Subida manual

En la interfaz puedes subir archivos `.xml`, `.gz`, `.zip` o `.eml` de reportes para importarlos sin configurar nada.

## Cómo analiza los reportes

Cada registro de un reporte agregado (una IP de origen + resultados de autenticación + número de mensajes) se procesa así:

1. **Alineación**: se recalcula a partir de `auth_results` usando el modo publicado (`adkim`/`aspf`, relajado o estricto) y el dominio organizacional según la Public Suffix List. SPF solo cuenta si es del `MAIL FROM`.
2. **Resultado DMARC**: se respeta la evaluación del receptor (`policy_evaluated`); pasa si SPF **o** DKIM pasan alineados.
3. **Clasificación** del tráfico:

| Categoría | Significado | Qué hacer |
|---|---|---|
| **Autenticado** (`pass`) | Pasa DMARC con SPF y/o DKIM alineado | Nada |
| **Reenviado** (`forwarded`) | Reenvíos y listas de correo: DKIM alineado sobrevive pero SPF de su propio dominio falla, o el receptor indica `forwarded`/`mailing_list`/`trusted_forwarder` | Normalmente nada; asegúrese de firmar todo con DKIM |
| **Sin alinear** (`misaligned`) | SPF o DKIM pasan, pero para **otro dominio** (p. ej. `sendgrid.net`). Casi siempre un servicio legítimo mal configurado | Configure DKIM personalizado / Return-Path propio en ese servicio antes de endurecer la política |
| **No autenticado** (`fail`) | Ni SPF ni DKIM pasan | Suplantación o un servidor propio no declarado |

4. **Enriquecimiento de IPs**: DNS inverso (PTR), ASN y país vía DNS de Team Cymru (sin APIs externas ni claves). Con PTR, ASN y los dominios de firma se detecta el **proveedor** (Google, Microsoft 365, Amazon SES, SendGrid, Mailchimp, Mailgun, Zoho, Salesforce, HubSpot, etc.) y las IPs se agrupan por servicio.
5. **Estado de cada fuente**: *Autorizado* (≥90 % autenticado), *Reenviador*, *Requiere configuración* (mayoría sin alinear), *Sospechoso* (mayoría no autenticado) o *Mixto*.
6. **Salud del dominio** (0–100): 60 % cumplimiento DMARC de los últimos 30 días + 40 % puntuación DNS (DMARC, política, rua, SPF y su límite de 10 consultas, claves DKIM y su tamaño, MTA-STS, TLS-RPT).
7. **Recomendaciones** priorizadas: registros ausentes o inválidos, SPF con más de 10 consultas, claves DKIM débiles o selectores no publicados, servicios a alinear, destinos `rua` externos sin autorizar y **cuándo es seguro subir a `quarantine` / `reject`** (con el registro sugerido listo para copiar).

Alertas automáticas: nueva IP que envía correo no autenticado, caída del cumplimiento diario bajo el umbral, cambios en los registros DNS y llegada de reportes forenses. Se notifican por webhook (Slack, Discord, Teams o JSON genérico) y/o correo, más un resumen semanal opcional.

Los reportes forenses (RUF) contienen datos personales (cabeceras de mensajes reales); se guardan aparte y se eliminan tras `forensicRetentionDays` (30 días por defecto).

## Copias de seguridad

Todo el estado está en `DATA_DIR` (base de datos SQLite y `.secret`). Conserva ambos: sin `.secret` (o `SECRET_KEY`) no se pueden descifrar las credenciales IMAP guardadas.

Copia simple, con el servicio parado:

```bash
systemctl stop dmark-hole
cp -a /var/lib/dmark-hole /backup/dmark-hole-$(date +%F)
systemctl start dmark-hole
```

Copia en caliente y consistente con el backup de SQLite:

```bash
sqlite3 /var/lib/dmark-hole/dmark-hole.db ".backup '/backup/dmark-hole-$(date +%F).db'"
cp /var/lib/dmark-hole/.secret /backup/
```

En Docker:

```bash
docker run --rm -v dmark-hole_dmark-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/dmark-data-$(date +%F).tgz -C /data .
```

(el nombre real del volumen es `<proyecto>_dmark-data`; consúltalo con `docker volume ls`.) Para restaurar, detén el servicio y devuelve los archivos a `DATA_DIR`.

## Desarrollo

Requisitos: Node >= 22.13 y pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env   # opcional
pnpm dev               # servidor en :8080 y web (Vite) en :5173
```

`pnpm dev` arranca ambos paquetes; la web en `http://localhost:5173` redirige `/api` al servidor en el puerto 8080 (cambie el destino con `API_URL`).

Datos de demostración (genera reportes realistas para probar la interfaz; no usar en producción):

```bash
DATA_DIR=./data pnpm --filter @dmark-hole/server demo -- --days 60
```

Otros comandos:

```bash
pnpm build      # compila web (packages/web/dist) y servidor (packages/server/dist)
pnpm start      # node packages/server/dist/index.js
pnpm test       # pruebas del servidor
pnpm typecheck
```

Estructura: `packages/server` (`@dmark-hole/server`, Fastify + `node:sqlite`) y `packages/web` (`@dmark-hole/web`, Vue 3 + Vite). En producción el servidor sirve la SPA compilada y la API bajo `/api`.
