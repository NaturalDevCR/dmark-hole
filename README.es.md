🇬🇧 [English](README.md) · 🇪🇸 Español

# DMARK-Hole

![Licencia MIT](https://img.shields.io/badge/licencia-MIT-green) ![Node 24](https://img.shields.io/badge/Node-24-339933?logo=nodedotjs&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-listo-2496ED?logo=docker&logoColor=white) ![Proxmox LXC](https://img.shields.io/badge/Proxmox-LXC-E57000?logo=proxmox&logoColor=white)

Receptor y analizador de reportes DMARC auto-alojado. Un único proceso (Node.js 24 + `node:sqlite`), sin base de datos externa, sin Redis, sin módulos nativos.

## Idiomas

La interfaz está disponible en **inglés y español**: se detecta automáticamente a partir del navegador y se puede cambiar en cualquier momento con el selector de idioma de la interfaz. El servidor traduce según cada petición (cabecera `x-locale`) las comprobaciones DNS, las recomendaciones, las alertas y los errores de la API. El idioma de las **notificaciones** (webhook y correo) se configura en Ajustes (`language`: `en` o `es`; por defecto `en`).

## Qué hace

- **Recibe** reportes agregados (**rua**) y forenses (**ruf**) de uno o varios dominios: sondeo **IMAP** de un buzón, **receptor SMTP integrado**, **HTTP con token** o **subida manual** de archivos (XML, gz, zip, eml).
- **Analiza** cada reporte y **enriquece** las IP de origen con DNS inverso, ASN y país.
- **Clasifica** el tráfico en cuatro categorías: `pass`, `forwarded` (reenvíos legítimos), `misaligned` (desalineado) y `fail`.
- **Comprueba el DNS** de cada dominio (DMARC, SPF, DKIM, MTA-STS, TLS-RPT y BIMI) y genera recomendaciones.
- **Alerta** por webhook o correo electrónico.
- **Interfaz web moderna** (Vue 3), bilingüe (inglés y español), servida por el mismo proceso, junto con la API bajo `/api` (puerto 8080).

## Instalación rápida

**Proxmox (LXC) — un solo comando.** En la shell del host Proxmox, como root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

Crea un contenedor Debian 12 (o 13) sin privilegios, instala DMARK-Hole como servicio y al final muestra la URL (`http://<ip-del-contenedor>:8080`). Abra esa URL y cree la cuenta de administrador.

**Docker:**

```bash
git clone https://github.com/NaturalDevCR/dmark-hole.git && cd dmark-hole && docker compose up -d
```

**Debian / Ubuntu (VM, LXC existente o servidor):**

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/install.sh)"
```

Después de instalar: agregue sus dominios, configure cómo llegan los reportes (buzón IMAP, receptor SMTP o HTTP; ver [Cómo recibir los reportes](#cómo-recibir-los-reportes)) y publique el registro DMARC con `rua=` apuntando a esa dirección.

## Instalación detallada

Requisitos: ninguno con Docker o los instaladores. Para ejecutar a mano: Node.js >= 22.13 (usa `node:sqlite`; se recomienda Node 24 LTS) y pnpm 10.

### Proxmox VE (contenedor LXC)

El script se ejecuta **en el host Proxmox** como root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

Qué hace, paso a paso:

1. Verifica que es un host Proxmox (`pct`, `pveam`).
2. Pregunta ID, nombre, almacenamiento, bridge, CPU/RAM/disco e IP (Enter acepta el valor por defecto).
3. Descarga la plantilla Debian (12 por defecto) si no existe.
4. Crea un contenedor **sin privilegios** con `nesting=1` e inicio automático, y lo arranca.
5. Dentro del contenedor ejecuta `deploy/install.sh`: instala Node 24, clona este repositorio en `/opt/dmark-hole`, compila y registra el servicio systemd `dmark-hole`.
6. Imprime la IP y la URL.

Recursos por defecto: 1 CPU, 1 GB de RAM, 4 GB de disco (suficiente para decenas de dominios; aumente el disco si guarda muchos meses de reportes).

Instalación desatendida (sin preguntas), por ejemplo con IP fija:

```bash
CTID=150 CT_HOSTNAME=dmarc STORAGE=local-lvm BRIDGE=vmbr0 IP=192.168.1.50/24 GATEWAY=192.168.1.1 NONINTERACTIVE=1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/proxmox/dmark-hole-lxc.sh)"
```

| Variable | Por defecto | Descripción |
|---|---|---|
| `CTID` | siguiente libre | ID del contenedor |
| `CT_HOSTNAME` | `dmark-hole` | Nombre de host |
| `STORAGE` | `local-lvm` / primero disponible | Almacenamiento del disco |
| `TEMPLATE_STORAGE` | `local` | Almacenamiento de plantillas |
| `BRIDGE` / `VLAN` | `vmbr0` / ninguna | Red |
| `CORES` / `RAM` / `DISK` | `1` / `1024` (MB) / `4` (GB) | Recursos |
| `IP` / `GATEWAY` / `DNS` | `dhcp` | IP en formato CIDR y puerta de enlace si es estática |
| `DEBIAN_VERSION` | `12` | `12` o `13` |
| `REPO_URL` / `REPO_BRANCH` | este repositorio / `main` | Para instalar desde un fork o una rama |

¿Sin acceso a GitHub desde el contenedor? Copie el repositorio completo al host y ejecute el script desde ahí; empaqueta el código local y lo sube al contenedor:

```bash
scp -r dmark-hole root@proxmox:/root/
ssh -t root@proxmox bash /root/dmark-hole/deploy/proxmox/dmark-hole-lxc.sh
```

Para recibir reportes por el **receptor SMTP** en el LXC, redirija el puerto 25 del router/firewall a la IP del contenedor y defina `SMTP_PORT=25` en `/etc/dmark-hole/dmark-hole.env` (ver más abajo).

### Docker

```bash
git clone https://github.com/NaturalDevCR/dmark-hole.git
cd dmark-hole
docker compose up -d
```

La interfaz queda en `http://<host>:8080`. En el primer acceso, la página de configuración inicial crea el usuario administrador (o defina `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Después puede elegir el idioma de la interfaz con el selector.

- Los datos (SQLite y secreto generado) viven en el volumen `dmark-data`, montado en `/data`.
- Personalice las variables en la sección `environment` de `docker-compose.yml`. El puerto 2525 solo se usa si activa el receptor SMTP.

### Debian / Ubuntu (systemd)

En una VM, LXC o servidor con Debian 12/13 o Ubuntu 22.04/24.04, como root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NaturalDevCR/dmark-hole/main/deploy/install.sh)"
```

o desde una copia del repositorio:

```bash
git clone https://github.com/NaturalDevCR/dmark-hole.git
cd dmark-hole
./deploy/install.sh
```

El instalador es idempotente y:

1. instala Node 24 (NodeSource) y habilita corepack/pnpm;
2. crea el usuario de sistema `dmark`;
3. instala la aplicación en `/opt/dmark-hole` y la compila (`pnpm install` + `pnpm build`);
4. crea `/etc/dmark-hole/dmark-hole.env` (con `DATA_DIR=/var/lib/dmark-hole`);
5. instala y arranca el servicio systemd `dmark-hole` y comprueba `/api/health`.

Comandos útiles:

```bash
systemctl status dmark-hole
journalctl -u dmark-hole -f
systemctl restart dmark-hole   # tras editar /etc/dmark-hole/dmark-hole.env
```

La unidad systemd tiene hardening (`ProtectSystem=strict`, `NoNewPrivileges`, etc.) y concede `CAP_NET_BIND_SERVICE`, de modo que puede usar `SMTP_PORT=25` directamente.

## Actualización

| Método | Procedimiento |
|---|---|
| Docker | `git pull && docker compose up -d --build` |
| LXC / systemd | `/opt/dmark-hole/deploy/install.sh --update` (dentro del contenedor) |
| LXC desde el host | `pct exec <CTID> -- /opt/dmark-hole/deploy/install.sh --update` |
| LXC sin acceso a GitHub | Copie la nueva versión al contenedor (`pct push` de un `.tar.gz` o `scp`), descomprímala y ejecute `./deploy/install.sh --update` desde esa carpeta |

`--update` hace `git pull` (o sincroniza el checkout local), reconstruye y reinicia el servicio. La configuración y los datos no se tocan. Haga una copia de seguridad antes de actualizar (ver más abajo).

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
| `SMTP_ENABLED` | `false` | Valor inicial del receptor SMTP integrado; una vez guardada la configuración desde la UI, manda la UI |
| `SMTP_ALLOWED_RECIPIENTS` | vacío | Destinatarios aceptados por el receptor SMTP, separados por comas (`dmarc@reports.example.com`, `@reports.example.com`). **Obligatorio**: sin lista, el receptor rechaza todo. Editable en la UI |
| `SMTP_PORT` | `2525` | Puerto del receptor SMTP |
| `SMTP_LISTEN_HOST` | `0.0.0.0` | Dirección de escucha SMTP |
| `SMTP_MAX_SIZE_MB` | `25` | Tamaño máximo de mensaje |
| `SMTP_TLS_KEY` / `SMTP_TLS_CERT` | vacío | Rutas a clave y certificado PEM para STARTTLS |
| `DISABLE_SCHEDULER` | `false` | Desactiva tareas programadas (IMAP, DNS, alertas) |

Detrás de un proxy HTTPS (Caddy, Traefik, nginx): apunta al puerto 8080 y define `TRUST_PROXY=true` y `SECURE_COOKIES=true`.

El idioma de las notificaciones (`language`: `en` | `es`, por defecto `en`) no es una variable de entorno: se cambia en Ajustes desde la interfaz.

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

## Licencia

[MIT](LICENSE): puede usarlo, modificarlo y redistribuirlo libremente, incluso con fines comerciales, manteniendo el aviso de copyright.
