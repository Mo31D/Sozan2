# Sozan2

Clean rebuild of Sozan Tutor OS.

## Goal

Sozan2 preserves the useful product behaviour of the current Sozan app while replacing accumulated compatibility layers with one testable architecture.

The current product was audited before the first Sozan2 D1 database was created. The audit and explicit keep/redesign/drop decisions live in [`docs/FEATURE_AUDIT.md`](docs/FEATURE_AUDIT.md).

## Architecture

```text
React UI
   ↓
Hono API routes / middleware
   ↓
Application + domain services
   ↓
Repositories
   ↓
Cloudflare D1
```

## Product model now frozen around

- students and guardian details;
- recurring lessons and groups;
- confirmed/pending schedule planning;
- weekly availability and travel time;
- one-off lesson rescheduling;
- attendance state transitions;
- per-session and package billing;
- existing package progress when a student is entered mid-cycle;
- one canonical student receipt model, allocation and prepaid credit;
- expenses and other income;
- cash reconciliation;
- activity log and correction/review signals;
- dashboard, deterministic insights and reports;
- PWA/mobile-first operation.

## Non-negotiable rules

- The old `sozan` repository is a behavioural reference only.
- No V3/V4/V5/V6/V7 compatibility layers.
- No runtime schema creation or migration.
- No browser/API monkey patching.
- No hidden fake sessions or synthetic lesson dates for package progress.
- No second student-payment ledger alongside receipts.
- Financial logic belongs in services/domain rules and must be covered by tests.
- Database changes happen only through migrations.
- Production data is not copied until migration validation is complete.
- No private data endpoint is exposed before authentication is in place.

## Stack

- TypeScript
- React + Vite
- Hono
- Cloudflare Workers
- Cloudflare D1
- Zod
- Vitest

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run build
npm run dev:worker
```

For UI hot reload in a second terminal:

```bash
npm run dev
```

Vite proxies `/api` to the local Worker on port 8787.

## Checks

```bash
npm run check
npm run build
```

## Cloudflare deployment

The Worker/static shell has already been proven deployable without D1.

**Build command**

```bash
npm run build
```

**Deploy command**

```bash
npx wrangler deploy
```

Do not create/apply the production D1 binding until the product/schema freeze checks are green. After that, create `sozan2-db`, bind it as `DB`, apply `migrations/0001_core.sql`, then implement authentication before exposing data routes.

## Status

**Stage 0:** foundation complete.

**Stage 0.5:** latest-product audit and schema freeze. The initial schema has been redesigned to include the latest planner, package-progress, idempotency and reconciliation requirements without porting the old runtime patches.

See:

- [`docs/FEATURE_AUDIT.md`](docs/FEATURE_AUDIT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
