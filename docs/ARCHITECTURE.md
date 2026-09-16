# Sozan2 architecture

Product baseline: see `docs/FEATURE_AUDIT.md`.

## Dependency direction

```text
React client
   ↓ HTTP
Hono routes / middleware
   ↓
Application services
   ↓
Domain rules ←→ repositories
                   ↓
                   D1
```

The domain layer must not import Cloudflare, Hono, React, DOM or browser APIs.

## Bounded modules

1. **Auth** — passcode, session cookie, abuse control.
2. **Students** — profile, guardian details, status.
3. **Schedule & Planner** — recurring sessions, participants, pending/confirmed planning, availability range.
4. **Lessons** — occurrence generation, completion, cancellation, reopen, one-off reschedule.
5. **Billing** — per-session vs package, package cycles, opening progress.
6. **Receipts & Allocation** — one canonical student-money model, credit and deterministic reallocation.
7. **Expenses & Other Income**.
8. **Reconciliation** — expected balance and cash checks.
9. **Activity & Review** — append-only audit log and derived correction signals.
10. **Dashboard / Reports / Insights**.
11. **Settings**.
12. **Migration** — old Sozan import only; never runtime compatibility.

## Ownership

### Client

Rendering, forms, local interaction state and API calls. Client code never calculates canonical balances or mutates financial state optimistically as truth.

### Routes

HTTP-only concerns: authentication, request validation, idempotency key handling, status codes and response shape.

### Services

Business transactions and cross-entity rules. Examples:

- generate occurrences only for confirmed schedules;
- complete/cancel/reopen a lesson;
- create/rebalance a package cycle;
- create/edit/delete/restore a receipt and fully rebalance allocations;
- calculate dashboard/report projections;
- append activity events.

### Repositories

SQL and persistence only. Repositories do not decide whether a billing transition is valid.

### Domain

Pure types, validation, calculations and invariants. This is the highest-priority unit-test surface.

### Migrations

The only place allowed to create or alter production tables.

## Canonical financial model

Sozan2 deliberately removes the old split between direct lesson payments and student receipts.

```text
money from student
      ↓
   receipt
      ↓
allocation service
   ↙       ↘
lesson      completed package cycle
```

A quick “completed and paid” action creates the same receipt entity as the manual “قبضت فلوس” flow. This leaves one source of truth for cash received.

## Billing model

### Per-session

The recurring session supplies the default price. When an occurrence becomes billable, the occurrence stores a financial snapshot (`gross_pence`, `center_cut_pence`, `earned_pence`). Future schedule-price changes never rewrite completed history.

### Package

A student's current package configuration lives in `billing_plans`. Each cycle snapshots its own size and price.

Package progress is:

```text
opening_completed_count + real linked completed occurrences
```

`opening_completed_count` represents lessons completed before the current cycle was entered into Sozan2. It replaces the old hidden-session/synthetic-occurrence technique.

Once a real occurrence is attached to a cycle, the opening count is locked unless a dedicated correction workflow explicitly proves the change safe.

## Schedule model

A recurring schedule has one of two states:

- `confirmed` — eligible to generate occurrences;
- `pending` — visible in the planner but must not generate occurrences.

A pending schedule may retain its last known day/time as reference. New pending schedules may have no day/time yet.

A one-off reschedule belongs to the occurrence. Changing the recurring schedule affects future generated/scheduled occurrences only.

## Read models

Dashboard, student account, planner, review centre and reports are projections of canonical tables. They do not maintain duplicate financial totals as stored truth.

Important report concepts stay separate:

1. work performed/earned;
2. cash received;
3. amount due now;
4. package work performed but not due yet;
5. prepaid credit.

## Idempotency

Every money-changing or state-changing HTTP mutation must support a stable idempotency mechanism. Duplicate retries must replay the previous successful result rather than duplicate receipts, attendance or expenses.

## Financial invariants

Tests must prove at least:

1. Money is represented as integer pence.
2. A receipt cannot allocate more than its value.
3. An occurrence or completed package cycle cannot be overpaid by automatic allocation.
4. Editing/deleting/restoring a receipt deterministically recalculates allocations.
5. Completing/cancelling/reopening a lesson cannot silently duplicate cash received.
6. Package progress and package payment are separate concepts.
7. Opening package progress is native state, not fake lessons.
8. Pending schedules never generate occurrences.
9. Historical completed work is never rewritten by future schedule or billing edits.
10. Every destructive financial correction is auditable.

## Performance rules

Keep the outcomes of the old performance work without its compatibility hacks:

- indexed planner/report queries;
- lazy-load non-visible product views;
- no background UI polling loops;
- PWA shell cache-first with background refresh;
- no runtime DDL or schema probes on normal requests;
- no DB proxy/no-op interception;
- no browser API monkey patching.

## Migration from old Sozan

The old system is not queried live by Sozan2.

```text
old D1
  ↓ extract
normalised migration model
  ↓ validate
new D1
```

Migration responsibilities include:

- map old direct payments into canonical receipts;
- map per-session and package data into the new billing model;
- convert old package-opening shadow progress into `opening_completed_count`;
- ignore old monthly compatibility structures after extracting their final business meaning;
- preserve activity/history where it is meaningful;
- never import runtime compatibility tables as new product architecture.

Cutover is blocked until old/new totals match for students, completed lessons, receipts/cash, outstanding balances, package progress, prepaid credit, expenses, other income and expected final balance.
