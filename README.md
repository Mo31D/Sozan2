# Sozan2 1.0

Sozan2 is the production rebuild of Sozan1: a **local-first tutoring workspace** with optional Cloudflare sync, multi-device accounts, auditable finance, package billing, planning, correction/history tools and deterministic reports.

The user-facing tutoring product is intentionally simple and Arabic-first. The reusable platform architecture remains hidden behind that interface.

## Daily product

The main navigation is deliberately small:

- **اليوم** — today's lessons, quick collection/expense actions, current cash picture and package progress.
- **فلوسي** — received, spent, due and collection status.
- **جدولي** — week, month, free-time planning, pending schedules and recurring schedule editing.
- **أنا** — students, packages, account/sync and Sozan1 migration.

A unified **الإدارة والسجل** center provides correction and review without exposing technical architecture. It includes:

- receipt edit / soft-delete / restore and duplicate-payment warnings;
- expense edit / soft-delete / restore;
- other-income create / edit / delete / restore;
- cash reconciliation with editable history;
- student profiles and student-data editing;
- advanced recurring-session editing, group/student assignment, pricing basis, center cut, duration/travel and safe archival;
- activity history and supported undo operations;
- deterministic 28-day reports and attention signals.

## Local-first + cloud

```text
User action
   ↓
IndexedDB — immediate/offline working copy
   ↓
sync outbox
   ↓
Cloudflare Worker
   ↓
D1 shared cloud copy
```

Local writes happen first. Sync is push-first and idempotent: if a pending mutation cannot be pushed, Sozan2 does not pull a cloud snapshot over that unsynced local change. Automatic sync runs when a linked workspace opens and when connectivity returns.

The PWA shell is installable and cached separately from business data. `/api/*` is never cached by the service worker; canonical offline business state remains in IndexedDB.

## Accounts and security

Cloud accounts support:

- username + password;
- PBKDF2-SHA256 password hashing using the Cloudflare-compatible iteration limit;
- secure HttpOnly session cookies;
- server-side sessions and rate limiting;
- recovery codes;
- multiple devices and workspace authorization.

No paid authentication provider or paid AI API is required.

## Tutoring and billing

Sozan2 supports:

- students, guardians and groups;
- confirmed or pending recurring schedules;
- weekly/monthly planner and travel time;
- one-off lesson rescheduling without rewriting the recurring timetable;
- completed, cancelled, restored and reopened lesson states;
- per-session or package billing;
- native opening package progress for already-started packages;
- group occurrences advancing the correct package for each linked student;
- receipts, automatic oldest-obligation allocation and prepaid credit;
- automatic reallocation after payment corrections or tutoring-state changes;
- package `open / due / paid` state normalized both locally and in D1;
- historical accounting protection: financial shape/student membership cannot be silently rewritten after historical lesson activity exists.

Money is stored as integer pence and business records use application-generated TEXT IDs so offline records can later sync without ID collisions.

## Migration from Sozan1

Sozan1 remains a behavioural and migration source, not a runtime dependency.

The supported migration path is:

```text
Sozan1 /api/v7/migration-export
        ↓ JSON
Sozan2 migration preview
        ↓
D1 import + reconciliation
        ↓
local sync
```

The migration converts legacy package-opening shadow records into native opening progress rather than importing fake lessons. Students, schedules, real occurrences, packages, receipts/payments, allocations, expenses, other income, cash checks, settings and activity history are mapped into the Sozan2 schema.

## Architecture

```text
Core
├── identity / users / workspaces / members
├── auth / activity / idempotency
├── module registry + terminology
└── persistence + sync contracts

Modules
├── tutoring
├── finance
├── planner
└── reports
```

Modules own their domains and tables. Cross-module work is explicit through contracts/services rather than browser monkey patches or direct coupling.

Sozan1's runtime schema creation, V3–V7 compatibility layers, synthetic package sessions and accumulated patch scripts are deliberately not carried into Sozan2.

## Stack

- React 19 + TypeScript
- Vite
- Hono
- IndexedDB
- Cloudflare Workers + D1
- Zod
- Vitest
- PWA manifest + service worker

## Quality gates

```bash
npm run check
npm run build
```

CI additionally applies every SQL migration to SQLite with foreign keys enabled, validates required modular tables and core invariants, runs strict TypeScript checks and the Vitest suite, then performs the production Vite build.

## Version status

**Sozan2 1.0** is the first release intended to replace the old Sozan runtime after migration and live-device acceptance testing. The repository is still modular enough to support future templates, but only the tutoring template is implemented and should be presented as available today.
