# Sozan2

A modular, local-first workspace platform rebuilt from the useful product behaviour of Sozan1.

Tutoring is the first implemented template. It is **not** the platform core.

## Architecture

```text
Core
├── users / workspaces / members
├── module registry
├── terminology + layouts
├── activity + idempotency
└── persistence contracts

Modules
├── tutoring
├── finance
├── planner
└── reports
```

Each module owns its domain and persistence tables. Cross-module behaviour goes through contracts/events, not direct access to another module's private repositories.

## Persistence modes

### Local — free/offline

```text
PWA → IndexedDB
```

No D1 and no paid external API are required.

### Cloud — optional

```text
PWA → internal Cloudflare Worker API → D1
```

Cloud mode enables shared workspaces and multi-device use. The internal API is not a paid third-party API dependency.

## Workspace model

The core is user-neutral:

- `core_users`
- `core_workspaces`
- `core_workspace_members`
- `core_workspace_modules`
- terminology overrides
- custom surface/widget layouts

No core schema assumes the user is named Sozan.

The `tutoring` template currently enables:

```text
tutoring + finance + planner + reports
```

Future templates such as appointments, small business and custom are reserved in the catalog but explicitly marked unimplemented until real modules are built.

## Tutoring behaviour retained from Sozan1

- students, guardians and groups;
- confirmed/pending recurring schedules;
- weekly planner and travel time;
- one-off lesson rescheduling;
- completed/cancelled/reopened lesson states;
- per-session and package billing;
- package progress including an already-started package;
- receipts, automatic allocation and prepaid credit;
- expenses and other income;
- cash reconciliation;
- activity/review signals;
- reports and deterministic insights.

Sozan1 is a behavioural reference only. Its runtime schema creation, V3–V7 compatibility wrappers, browser monkey patches, synthetic package sessions/dates and duplicate payment ledgers are not ported.

## Repository pattern

Business services depend on ports, not storage technology:

```text
StudentsService
      ↓
StudentRepository
   ↙       ↘
IndexedDB   D1
```

The tutoring student module contains both adapters as the reference pattern for subsequent modules.

## Important data rules

- money is integer pence;
- entity IDs are application-generated TEXT IDs for offline/cloud compatibility;
- all business data is scoped by `workspace_id`;
- finance does not foreign-key directly into tutoring;
- package opening progress is native data, never fake lessons;
- pending schedules never generate occurrences;
- completed historical work is not rewritten by future edits;
- financial mutations must be idempotent and auditable.

## Stack

- TypeScript
- React + Vite
- Hono
- IndexedDB for local mode
- Cloudflare Workers + D1 for optional cloud mode
- Zod
- Vitest

## Checks

```bash
npm install
npm run check
npm run build
```

CI also executes `migrations/0001_core.sql` against SQLite before allowing the build to pass.

## Cloudflare shell

The Worker/static shell has already been deployed successfully without D1.

Build command:

```bash
npm run build
```

Deploy command:

```bash
npx wrangler deploy
```

## Current status

**Foundation + product/platform/schema freeze complete.**

The next step is to create a new D1 database named `sozan2-db`, bind it as `DB`, and apply the initial migration. Do not import Sozan1 production data yet.

Read:

- [`docs/MODULAR_PLATFORM.md`](docs/MODULAR_PLATFORM.md)
- [`docs/FEATURE_AUDIT.md`](docs/FEATURE_AUDIT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/D1_INSTALL.md`](docs/D1_INSTALL.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
