# Self-Hosting & Deployment Guide

**[Back to README](../README.md)** · **[Feature Tour](FEATURES.md)** · **[Live Demo](https://demo.dockethall.com/)**

DocketHall runs on any Linux VPS or Docker host. Choose either the **Turnkey VPS Installer** (for a production single-server setup with automatic HTTPS, backups, and unattended security updates) or **Docker Swarm** (for local evaluation or custom infrastructure).

---

## Option 1: Turnkey Ubuntu / Debian VPS (Recommended for Production)

On a fresh Ubuntu 22.04/24.04 or Debian 12 server with DNS pointed at the server:

```bash
DOMAIN=portal.yourcity.gov \
  curl -fsSL https://raw.githubusercontent.com/ryanhankins/DocketHall/main/scripts/install-vps.sh | sudo -E bash
```

What `scripts/install-vps.sh` configures automatically:
- **Docker + Caddy** with automatic Let's Encrypt HTTPS for `$DOMAIN`
- **Firewall & SSH hardening**: `ufw` (`22`, `80`, `443`), `fail2ban`, and key-only SSH when `authorized_keys` are present
- **OS & Disk Maintenance**: `unattended-upgrades` (off-peak `03:30` reboots), Docker log rotation (`10m` × `3`), `journald` cap (`200M`), `2 GB` swapfile, and a weekly `systemd` image-maintenance timer (`dockethall-maintenance.timer`)
- **Host-assisted upgrades & monitoring**: `civicdesk-upgrade.path` for in-app upgrades, `/api/health` cron check, and optional `restic` nightly off-site backups

---

## Option 2: Docker Swarm (`./scripts/deploy.sh`)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop, Colima, or Docker Engine with Swarm mode support)

### 1. Clone and deploy

```bash
git clone https://github.com/ryanhankins/DocketHall.git
cd DocketHall
./scripts/deploy.sh
```

`./scripts/deploy.sh` builds the React/Vite frontend bundle, initializes Docker Swarm (if not already active), generates Swarm secrets on first run, builds the container images, and deploys the stack.

### 2. Open DocketHall
- **Public Portal & Clean Routes:** <http://localhost:8080> (e.g. `/agendas`, `/blog`, `/pages`, `/notices`, `/forms`, `/complaints`, `/directory`)
- **Standalone Permits Portal:** <http://localhost:8080/portal>
- **Standalone Municipal Code:** <http://localhost:8080/code>
- **Authenticated Workspace:** <http://localhost:8080/app>

### 3. First-time sign-in
On first startup, the API seeds a default administrator account:
- **Username:** `admin`
- **Password:** `admin`

Change the password immediately after your first sign-in.

---

## Managing the Stack

Check service status:
```bash
docker stack services civicdesk
```

View logs for a service (`api` or `web`):
```bash
docker service logs -f civicdesk_api
```

Rebuild and redeploy after pulling or editing code:
```bash
./scripts/deploy.sh
```

Stop and remove the stack (keeps volumes and secrets):
```bash
./scripts/teardown.sh
```

Stop and remove the stack **and** delete all volumes, secrets, and configs:
```bash
./scripts/teardown.sh --purge
```

---

## Configuration

`./scripts/deploy.sh` and `docker-stack.yml` support the following optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `STACK_NAME` | `civicdesk` | Docker Swarm stack name |
| `CIVICDESK_TAG` | `latest` | Image tag for built services |
| `CIVICDESK_REGISTRY` | *(empty)* | Optional registry prefix (e.g. `ghcr.io/ryanhankins/`); pushes images if set |
| `CIVICDESK_PULL_ONLY` | `false` | Set to `true` to pull prebuilt registry images without building locally |
| `POSTGRES_PASSWORD` | *(random)* | Initial password for `postgres_password` Swarm secret |
| `STORAGE_BACKEND` | `s3` | Object storage backend (`s3` for SeaweedFS or `local` for `/data/records`) |
| `S3_REPLICAS` | `1` | SeaweedFS service replicas (`0` when using `STORAGE_BACKEND=local`) |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `APP_BASE_URL` | *(from request)* | Optional override for base URL used in notification emails and PDF verification links |

Secrets are created once and are never overwritten by subsequent `./scripts/deploy.sh` runs.
