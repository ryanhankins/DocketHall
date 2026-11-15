# CivicDesk

CivicDesk is a self-hosted workspace for managing meeting agendas, tracking agenda-driven to-dos and item backlogs, generating agenda PDFs, and archiving records.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop, Colima, or Docker Engine with Swarm mode support)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/ryanhankins/CivicDesk.git
cd CivicDesk
```

### 2. Deploy the stack

Run the deployment script. It initializes Docker Swarm (if not already active), generates Swarm secrets on first run, builds the container images, and deploys the stack:

```bash
./scripts/deploy.sh
```

### 3. Open CivicDesk

Once the services are running:

- **Web App:** <http://localhost:8080>
- **MinIO Console:** <http://localhost:9001> (username is stored in the `minio_root_user` Docker secret, defaulting to `civicdesk`)

### 4. First-time sign-in

On first startup, the API seeds a default administrator account:

- **Username:** `admin`
- **Password:** `admin`

Change the password after your first sign-in.

## Managing the Stack

Check service status:

```bash
docker stack services civicdesk
```

View logs for a service (for example, `api` or `web`):

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

## Configuration

`./scripts/deploy.sh` and `docker-stack.yml` support the following optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `STACK_NAME` | `civicdesk` | Docker Swarm stack name |
| `CIVICDESK_TAG` | `latest` | Image tag for built services |
| `CIVICDESK_REGISTRY` | *(empty)* | Optional registry prefix (e.g. `registry.example.com/`); pushes images if set |
| `POSTGRES_PASSWORD` | *(random)* | Initial password for `postgres_password` Swarm secret |
| `MINIO_ROOT_USER` | `civicdesk` | Initial username for `minio_root_user` Swarm secret |
| `MINIO_ROOT_PASSWORD` | *(random)* | Initial password for `minio_root_password` Swarm secret |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |

Secrets are created once and are never overwritten by subsequent `./scripts/deploy.sh` runs.

## Repository Layout

- `web/` — Nginx reverse proxy and frontend application (`HTML`/`CSS`/vanilla `JS`)
- `api/` — Python FastAPI backend (`agendas`, `agenda_pdf`, `auth`, `users`, `db`)
- `db/` — PostgreSQL initialization script (`init.sql`)
- `minio/` — MinIO object storage image and bucket initialization (`minio/init/`)
- `scripts/` — Swarm deployment (`deploy.sh`) and removal (`teardown.sh`) scripts
- `docker-stack.yml` — Docker Swarm stack definition

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
