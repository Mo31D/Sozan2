# D1 installation runbook

Do this only after `main` CI is green.

## 1. Create the database

Create a new Cloudflare D1 database named:

```text
sozan2-db
```

Do not reuse the Sozan1 database.

## 2. Bind it

Add the returned D1 database id to `wrangler.jsonc` using binding name `DB`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "sozan2-db",
    "database_id": "<cloudflare-database-id>"
  }
]
```

## 3. Apply the frozen initial schema

```bash
npx wrangler d1 migrations apply DB --remote
```

The migration creates the platform core plus the currently implemented tutoring/finance persistence tables.

## 4. Do not import Sozan1 data yet

The old database remains a behavioural/data migration source only. Import happens later through an explicit migration tool after authentication and business services are complete.

## 5. Security gate

After D1 exists, the next implementation gate is:

- user/workspace bootstrap;
- passcode hashing and signed HttpOnly session;
- workspace membership authorization;
- login abuse control;
- idempotency middleware;
- only then expose non-health cloud APIs.

## Local-only mode

D1 is optional for the product architecture. Local mode uses IndexedDB adapters and must remain usable without a paid external API or cloud database.
