# <img src="web/public/dockethall-logo.svg" alt="DocketHall logo" width="32" height="32" align="absmiddle" /> DocketHall

DocketHall is a self-hosted, modular municipal operations platform built for city clerks, staff, councilmembers, and residents. It combines a **Public Services & Records Portal** with an authenticated **Workspace** for managing meeting agendas, permits, municipal code, public records, code-enforcement complaints, and community calendars.

## Key Capabilities

### Public Portal (`/`, `/portal`, `/code`)
- **Public Services Overview (`/`)**: Presents enabled public services with service-specific icons, sign-in/applicant registration, and **Public Email Alerts** (self-service citizen email subscriptions for Agendas, City Code updates, and Public Records with one-click unsubscribe links).
- **Meeting Agendas & Minutes**: Filter finalized meetings by **Board / Body**, **Year**, and keyword; view **Summary PDF**, **Full Packet PDF**, **Minutes PDF** (labeled *Draft* with a diagonal `DRAFT` watermark until approved), **Amended** badges, and **Watch Video / Listen Audio** recording links.
- **Permits & Fees (`/portal` & `/#permits`)**: Search permit types and uses, review fee schedules and required documents, and launch online permit applications.
- **Municipal City Code (`/code` & `/#codification`)**: Browse chapters and sections, search with **highlighted text snippets**, jump between sections via **clickable cross-references** (e.g. `§ 618.040`), view per-section PDFs, or download the **Full-Code Compiled PDF** with a Table of Contents.
- **Public Records (`/#records`)**: Search and download publicly published contracts, resolutions, ordinances, and agreements.
- **Administrative Complaints (`/#complaints`)**: Browse the public Complaint Log Book or file a complaint at no cost (anonymous or authenticated, with complainant confidentiality per MN Stat. 13.44).

### Pluggable Workspace Modules (`/app`)
Modules can be enabled or disabled individually under **Administration → Manage Modules** without losing stored data:

1. **Agendas (`agendas`)**
   - Configurable governing bodies, agenda sections, workflow categories, default meeting times/locations, and **Open-Meeting Posting Notice Window** warnings (e.g. 72-hour notice).
   - Reusable **Agenda Templates**, agenda **Cloning**, **Todos & Backlog** (including recurring monthly/quarterly/annual items), and **Councilmember Item Submissions** with attachment approval.
   - Automatic **Amended** timestamp & badge when items or attachments are modified after finalization.
   - Multi-format packet compilation (`.pdf`, `.docx`, `.xlsx`, `.pptx`, `.csv`, `.txt`, `.md`, `.png`, `.jpg`) with optional item cover sheets and continuous page numbers.
   - Structured **Minutes** entry (attendance, motions, seconds, votes, notes) generating watermarked `DRAFT` PDFs until marked **Approved**, plus **Video / Audio** media links.
   - Built-in dismissible **Getting Started** checklist and **Clerk & Councilmember Quick Guide** modal.
2. **Permits (`permits`)**
   - Configurable permit catalog (types, uses, fees, required documents) and **Parcel / Property Directory**.
   - Online application intake, multi-step department review workflow, inspection scheduling & results, staff/applicant messaging, and generated Permit PDFs.
   - **Expiration Date** tracking with *Expired* / *Expires in Xd* badges, **CSV Export** (`/api/permits/export.csv`) with live assessed/paid/unpaid fee totals, and automatic **Applicant Email Notifications** on status updates, inspections, and messages.
3. **City Code (`codification`)**
   - Chapter & section editor, full revision history, PDF upload & text extraction, per-section PDFs, and **Full-Code Compiled PDF** generation.
4. **Public Records (`records`)**
   - Document repository for contracts, resolutions, ordinances, and agreements with multi-file attachments, effective/expiration dates, renewal notice tracking, and public visibility toggles.
5. **Complaints (`complaints`)**
   - Anonymous, resident, and staff oral complaint intake, investigation queue, activity log, confidential vs. public attachments, and Section 618.040 **Notice of Violation** issuance.
6. **Calendar (`calendar`)**
   - Municipal meeting and event calendar with public and workspace views.

### Administration, Notifications & Security
- **Users & Permissions**: Role-based access (`admin`, `council_member`, `admin_staff`, `non_admin_staff`, `applicant`, `read_only`) with per-user permission overrides and email addresses.
- **General & Branding**: Custom city title, city logo upload, workspace theme preferences, and configurable backup reminder intervals.
- **Email & Integrations**:
  - Customer-configurable outgoing **SMTP** server (`smtp_host`, `smtp_port`, sender email, password/App Password, and test email sender).
  - **Per-Module Notification Routing** inside **Agenda Preferences**, **Permit Preferences**, and **Complaint Preferences**, allowing each event type to notify specific DocketHall users and/or external email addresses with authenticated deep-links directly to the item.
  - **Public Alert Subscribers** management and optional Google Cloud API key validation.
- **Backup & Restore**: Export and restore full PostgreSQL + MinIO archives.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop, Colima, or Docker Engine with Swarm mode support)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/ryanhankins/DocketHall.git
cd DocketHall
```

### 2. Deploy the stack

Run the deployment script. It builds the React/Vite frontend bundle, initializes Docker Swarm (if not already active), generates Swarm secrets on first run, builds the container images, and deploys the stack:

```bash
./scripts/deploy.sh
```

### 3. Open DocketHall

Once the services are running:

- **Public Portal & Web App:** <http://localhost:8080>
- **Standalone Permits Portal:** <http://localhost:8080/portal>
- **Standalone Municipal Code:** <http://localhost:8080/code>

### 4. First-time sign-in

On first startup, the API seeds a default administrator account:

- **Username:** `admin`
- **Password:** `admin`

Change the password immediately after your first sign-in.

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
| `STORAGE_BACKEND` | `s3` | Object storage backend (`s3` for SeaweedFS or `local` for `/data/records`) |
| `S3_REPLICAS` | `1` | SeaweedFS service replicas (`0` when using `STORAGE_BACKEND=local`) |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `APP_BASE_URL` | *(from request)* | Optional override for base URL used in notification email links |

Secrets are created once and are never overwritten by subsequent `./scripts/deploy.sh` runs.

## Repository Layout

- `web/` — Nginx reverse proxy and React 19 + Vite frontend (`index.html`, `app.html`, `portal.html`, `code.html`, `src/core/`, and `src/modules/` for `agendas`, `calendar`, `codification`, `complaints`, `permits`, `records`)
- `api/` — Python FastAPI backend (`main.py`, `auth.py`, `users.py`, `branding.py`, `integrations.py`, `subscriptions.py`, `backup.py`, `registry.py`, `agenda_pdf.py`, `agendas.py`, `calendar_mod.py`, `codification.py`, `complaints.py`, `permits.py`, `records.py`, and `modules/`)
- `db/` — PostgreSQL initialization script (`init.sql`)
- `scripts/` — Swarm deployment (`deploy.sh`) and removal (`teardown.sh`) scripts
- `docker-stack.yml` — Docker Swarm stack definition

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
