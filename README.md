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

Alternativa: copia el script al host y ejecútalo.

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

1. Activa `SMTP_ENABLED=true` (o desde la interfaz).
2. Crea un registro **MX** para un dominio o subdominio de reportes apuntando al host, p. ej. `reports.example.com. MX 10 dmark.example.com.`, y un registro A/AAAA para `dmark.example.com`.
3. Usa `rua=mailto:dmarc@reports.example.com`. Si es un dominio distinto al monitorizado, añade el registro de autorización descrito arriba.
4. Puertos: el servicio escucha en `SMTP_PORT` (2525 por defecto). El correo entrante llega al **25**, así que:
   - Docker: publica `"25:2525"` en `docker-compose.yml`.
   - systemd: define `SMTP_PORT=25` (la unidad ya concede `CAP_NET_BIND_SERVICE`) o redirige 25 → 2525 con nftables/iptables.
   - LXC/Proxmox: abre el 25 en el firewall del host y redirige hacia la IP del contenedor.
5. **Firewall**: abre el puerto 25/TCP entrante desde Internet. Muchos ISP bloquean el 25 entrante en conexiones residenciales; comprueba con tu proveedor.
6. Opcional: define `SMTP_TLS_KEY` y `SMTP_TLS_CERT` para ofrecer STARTTLS.

El receptor solo debe exponerse para reportes: no envía correo ni actúa como relay.

### Subida manual

En la interfaz puedes subir archivos `.xml`, `.gz` o `.zip` de reportes para importarlos sin configurar nada.

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

`pnpm dev` arranca ambos paquetes; la web en `http://localhost:5173` redirige `/api` al servidor en el puerto 8080.

Otros comandos:

```bash
pnpm build      # compila web (packages/web/dist) y servidor (packages/server/dist)
pnpm start      # node packages/server/dist/index.js
pnpm test       # pruebas del servidor
pnpm typecheck
```

Estructura: `packages/server` (`@dmark-hole/server`, Fastify + `node:sqlite`) y `packages/web` (`@dmark-hole/web`, Vue 3 + Vite). En producción el servidor sirve la SPA compilada y la API bajo `/api`.
