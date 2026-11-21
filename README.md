# <img src="web/public/dockethall-logo.svg" alt="DocketHall logo" width="32" height="32" align="absmiddle" /> DocketHall

DocketHall is a self-hosted, modular municipal operations platform built for city clerks, staff, councilmembers, inspectors, and residents. It combines a **Public Services & Records Portal** with an authenticated **Workspace** for managing meeting agendas, live meetings, permits, licensing, municipal code, public records, code-enforcement complaints, 311 work orders, community calendars, utility billing, citations, and public communications.

## Key Capabilities

### Public Portal (`/`, `/portal`, `/code`)
Every public section and published item has a clean, bookmarkable URL:
- **Public Services Overview (`/`)**: Global public search, customizable welcome banner and city blog feed preview, service tiles, **Transparency Snapshot** bar, and **Public Email Alerts** (self-service citizen subscriptions with one-click unsubscribe links).
- **Meeting Agendas & Minutes (`/agendas`, `/agendas/<id>`)**: Filter finalized meetings by **Board / Body**, **Year**, and keyword; view **Summary PDF**, **Full Packet PDF**, **Minutes PDF** (watermarked `DRAFT` until approved, or attested official minutes when approved), **Amended** badges, **Video / Audio** recordings, and online public comments.
- **Permits & Fees (`/portal`, `/permits`)**: Search permit types and uses, review fee schedules and required documents, and launch online permit applications (`/app/permits-apply`).
- **Municipal City Code (`/code`, `/codification`)**: Browse chapters and nested sections, search with **highlighted text snippets**, jump between sections via **clickable cross-references** (e.g. `§ 618.040`), copy section permalinks, view per-section PDFs, or download the **Full-Code Compiled PDF** with a Table of Contents.
- **Public Records & FOIA (`/records`)**: Search and download publicly published contracts, resolutions, ordinances, and agreements, or submit/track public records (FOIA / Data Practices) requests.
- **Administrative Complaints & 311 (`/complaints`, `/complaints/<number>`)**: Browse the public Complaint Log Book, file confidential or anonymous complaints, or submit and track 311 Public Works requests.
- **Communications & Community Hub**:
  - **City Blog (`/blog`, `/blog/<slug>`)**: Categorized articles, tags, RSS feed (`/api/blog/rss.xml`), moderated/open comments, and optional live inline editing.
  - **News, Public Notices, Bids & Jobs (`/notices`, `/notices/<id>`)**: Public notices, RFPs/plan-holder registration, and online job applications.
  - **City Information Pages (`/pages`, `/pages/<slug>`)**: Custom rich-text pages and Quick Links cards.
  - **Forms & Opinion Polls (`/forms`, `/forms/<id>`)**: Dynamic public forms and community polls.
  - **City Directory & FAQs (`/directory`)**: Elected officials, department contacts, boards/commissions, and searchable FAQs.
- **Calendar & Facility Reservations (`/calendar`)**: Public meetings/events and online park/hall reservation requests.
- **Online Payments & Transparency (`/pay`, `/utilities`, `/citations`, `/transparency`)**: Utility bill and municipal citation lookup/contest/payment, plus a public transparency dashboard.

### Pluggable Workspace Modules (`/app/...`)
Modules can be enabled or disabled individually under **Administration → Manage Modules** without losing stored data, and every workspace route supports clean `/app/<route>` deep-linking:

1. **Agendas & Live Meetings (`agendas`)**
   - Configurable governing bodies, agenda sections, workflow categories, default meeting times/locations, **Councilmember Roster**, and **Open-Meeting Posting Notice Window** warnings with a **Proof-of-Posting Audit** badge (`Posted Xh before meeting`).
   - **Live Meeting Mode**: Step-by-step in-meeting clerk & council view with a configurable **Public Comment Speaker Timer** (`2m` / `3m` / `5m`), **Call to Order / Adjourn** timestamping, and live **Motion / Second / Roll-Call Voting** that compiles straight into Draft Minutes.
   - Reusable **Agenda Templates**, agenda **Cloning**, **Todos & Backlog** (including recurring monthly/quarterly/annual items), and **Councilmember Item Submissions** with attachment approval.
   - Multi-format packet compilation (`.pdf`, `.docx`, `.xlsx`, `.pptx`, `.csv`, `.txt`, `.md`, `.png`, `.jpg`) with optional item cover sheets, continuous page numbers, and **Tagged PDF/UA accessibility** checks.
   - Structured **Minutes** entry generating watermarked `DRAFT` PDFs until marked **Approved** (which adds an **Official Clerk Attestation** & verification block).
2. **Permits & Inspections (`permits`)**
   - Configurable permit catalog (types, uses, fees, custom fields, required documents) and **Parcel / Property Profile Directory**.
   - Online application intake (`/app/my-permits/<id>`), multi-step department review workflow, inspection scheduling & Field Inspector mode, staff/applicant messaging, CSV export, and generated Permit/Receipt PDFs.
3. **Contractor Licensing & Compliance Programs (`licensing`)**
   - Track contractor licenses, liability insurance, surety bonds (automatically blocking non-compliant contractors at permit submission), and recurring **Rental / STR / Fire / Backflow Compliance Programs** with automated 30-day renewal reminders and Compliance Certificates.
4. **City Code (`codification`)**
   - Chapter & section tree editor, bulk import & codify studio (PDF/URL/sync), full revision history, per-section PDFs, and **Full-Code Compiled PDF** generation.
5. **Public Records & FOIA (`records`)**
   - Document repository for contracts, resolutions, ordinances, and agreements with multi-file attachments, expiration/renewal alerts, and a **FOIA / Data Requests** workflow.
6. **Complaints, 311 & Work Orders (`complaints`)**
   - Anonymous, resident, and staff oral complaint intake, investigation workbench, reinspection & NOV deadline queue, 311 / Public Works work orders, and confidential vs. public attachments.
7. **Calendar & Facility Reservations (`calendar`)**
   - Municipal meeting and event calendar, facility catalog, reservation approvals, and public calendar feeds.
8. **Communications Suite (`communications` — `blog`, `notices`, `pages`, `forms`, `directory`)**
   - City Blog management & public feed settings, News/Notices/Bids/Jobs, Custom Pages & Quick Links, Dynamic Forms & Opinion Polls, and Directory & FAQs.
9. **Utility Billing (`utilities`) & Municipal Citations (`citations`)**
   - Manage water/sewer/trash utility bills, municipal code/parking citations, online payments, and hearing/contest requests.

### Administration, Notifications & Security
- **Users & Permissions**: Role-based access (`admin`, `council_member`, `admin_staff`, `non_admin_staff`, `applicant`, `read_only`) with per-user permission overrides.
- **General & Branding**: Custom city title, city logo, urgent alert banner, workspace theme/colors, home page text & blog feed layout, and backup reminder intervals.
- **Email, SLA & Integrations**: Customer-configurable **SMTP**, per-module notification routing, **SLA & Escalation** rules, public alert subscribers, and **Audit Log**.
- **Backup & Restore**: Export and restore full PostgreSQL + object storage archives.

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

- **Public Portal & Clean Routes:** <http://localhost:8080> (e.g. `/blog`, `/pages`, `/notices`, `/forms`, `/agendas`, `/complaints`)
- **Standalone Permits Portal:** <http://localhost:8080/portal>
- **Standalone Municipal Code:** <http://localhost:8080/code>
- **Authenticated Workspace:** <http://localhost:8080/app>

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
| `APP_BASE_URL` | *(from request)* | Optional override for base URL used in notification emails and PDF verification links |

Secrets are created once and are never overwritten by subsequent `./scripts/deploy.sh` runs.

## Repository Layout

- `web/` — Nginx reverse proxy and React 19 + Vite frontend (`index.html`, `app.html`, `portal.html`, `code.html`, `src/core/`, and `src/modules/` for `agendas`, `blog`, `calendar`, `citations`, `codification`, `communications`, `complaints`, `directory`, `forms`, `licensing`, `notices`, `pages`, `permits`, `records`, `utilities`)
- `api/` — Python FastAPI backend (`main.py`, `auth.py`, `users.py`, `branding.py`, `integrations.py`, `subscriptions.py`, `backup.py`, `registry.py`, `search.py`, `sla.py`, `payments.py`, `agenda_pdf.py`, `agendas.py`, `blog.py`, `calendar_mod.py`, `codification.py`, `complaints.py`, `directory.py`, `forms.py`, `notices.py`, `pages.py`, `permits.py`, `records.py`, and `modules/`)
- `db/` — PostgreSQL initialization script (`init.sql`)
- `scripts/` — Swarm deployment (`deploy.sh`), provisioning (`provision-city.sh`), health check (`health-check.sh`), offsite backup (`backup-offsite.sh`), and removal (`teardown.sh`) scripts
- `docker-stack.yml` — Docker Swarm stack definition

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
