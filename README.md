# Sozan2

Clean rebuild of Sozan Tutor OS.

## Goal

Sozan2 keeps the useful product behaviour of the current Sozan app, but replaces the accumulated compatibility layers with a single, testable architecture.

## Architecture

```text
React UI
   ↓
Hono API routes
   ↓
Domain services
   ↓
Repositories
   ↓
Cloudflare D1
```

## Non-negotiable rules

- The old `sozan` repository is a behavioural reference only.
- No V3/V4/V6 compatibility layers.
- No runtime schema creation.
- No monkey-patching browser APIs.
- Financial logic belongs in domain services and must be covered by tests.
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

For the first shell deployment use:

**Build command**

```bash
npm run build
```

**Deploy command**

```bash
npx wrangler deploy
```

The first deployment does not require D1. After `sozan2-db` is created, add a D1 binding named `DB` to `wrangler.jsonc`, apply `migrations/0001_core.sql`, then enable authenticated data routes.

## Status

Foundation only. Business behaviour will be migrated feature-by-feature after tests define the expected behaviour.
