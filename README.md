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

## Rules

- The old `sozan` repository is a behavioural reference only.
- No V3/V4/V6 compatibility layers.
- No runtime schema creation.
- No monkey-patching browser APIs.
- Financial logic must live in domain services and be covered by tests.
- Database changes happen only through migrations.
- Production data will not be copied until migration validation is complete.

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
npm run db:migrate:local
npm run dev
```

## Checks

```bash
npm run check
npm run build
```

## Cloudflare deployment

The first deployment can run without D1 while the shell is being verified. After creating the new `sozan2-db` database, add a D1 binding named `DB` to `wrangler.jsonc` and apply migrations.

Recommended Cloudflare build command:

```bash
npm run build
```

Recommended deploy command:

```bash
npx wrangler deploy
```

## Status

Foundation only. Business behaviour will be migrated feature-by-feature after tests define the expected behaviour.
