# Sozan1 → Sozan2 tutoring feature audit

Audit baseline: `Mo31D/sozan@b3187092b051ecbd0e1e6b7161acd7b57213a5a3`.

This audit is intentionally limited to the **tutoring template and the reusable finance/planner/report ideas learned from Sozan1**. Platform-wide decisions are defined in `MODULAR_PLATFORM.md` and supersede the old assumption that Sozan2 itself is a tutoring-only app.

## Decision rule

The old repository is a behavioural specification, not a code foundation.

- **KEEP** — valuable user behaviour.
- **REDESIGN** — preserve outcome, replace implementation.
- **DROP** — compatibility/patch machinery that must not enter Sozan2.

## Daily tutoring workflow

| Capability | Decision | Sozan2 target |
|---|---|---|
| Today view with today's lessons | KEEP | Tutoring read model/widget |
| Completed and paid | KEEP + REDESIGN | Complete occurrence + command Finance to create canonical receipt |
| Completed but unpaid | KEEP | Tutoring attendance service |
| Cancel / restore / reopen | KEEP | Explicit audited transitions |
| Move one lesson only | KEEP | Occurrence override |
| Change future recurring schedule | KEEP | Tutoring schedule service |
| Quick “قبضت فلوس” | KEEP | Finance receipt command |
| Quick expense | KEEP | Finance expense command |

## Students, groups and accounts

Keep student profile, guardian details, age, level, notes, due/credit state, last payment, timeline and multiple schedules.

Groups are redesigned as real many-to-many session participants instead of relying on a fake single-student representation.

All of this belongs to the `tutoring` module. The platform core does not contain a Student entity.

## Schedule and availability

Keep the latest useful Sozan1 concept: a recurring tutoring schedule is either `confirmed` or `pending`.

- pending means “هظبطه بعدين”;
- pending schedules stay visible to planning but create no occurrences;
- the last known day/time may remain as reference;
- quick future weekday/time changes are preserved;
- one-off rescheduling remains occurrence-specific;
- weekly availability and travel time remain planner projections;
- no continuous hidden-view polling.

Tutoring owns its recurring schedule data. The `planner` module consumes a public schedule-provider contract rather than querying tutoring tables directly.

## Billing and packages

The product modes are **per-session** and **lesson package**. Old monthly billing is compatibility history only.

Keep:

- configurable package size and price;
- progress `x / n`;
- `open → due → paid` cycle states;
- work performed in an open package before payment is due;
- package configuration inherited by new tutoring schedules;
- protection against unsafe billing-mode changes after history exists.

### Existing package progress at onboarding

Keep the ability to add a student who is already part-way through the current package:

- cycle start date;
- opening completed count;
- current progress / remaining / next position;
- lock opening progress after real new lessons begin.

Redesign: opening progress is stored directly on `tutoring_billing_cycles.opening_completed_count`.

Drop hidden recurring sessions, sentinel titles and synthetic 1900-date occurrences.

## Finance model

Old Sozan has more than one path representing incoming teaching money. Sozan2 has one Finance receipt model.

- a normal collection can reference a tutoring student as payer;
- a group/session quick payment can reference a tutoring occurrence as source;
- “تمت واتدفعت” creates the same Finance receipt entity;
- allocations target typed external obligations such as a tutoring occurrence or package cycle;
- surplus student cash remains prepaid credit;
- editing/deleting/restoring a receipt deterministically recalculates allocation;
- payment correction edits the canonical receipt/allocation rather than a second ledger;
- duplicate mutations are protected by idempotency.

Finance stores typed cross-module references and does not foreign-key into tutoring tables. This is required by the Lego boundary.

## Expenses, other income and reconciliation

Keep:

- business and personal expenses;
- categories;
- other income;
- edit / soft-delete / restore;
- expected current balance;
- expected-vs-actual cash check;
- unrecorded spending/income signal.

These belong to the `finance` module and can later be reused by non-tutoring templates.

## Activity, review and insights

Keep:

- searchable activity history;
- before/after snapshots where useful;
- correction/review centre;
- duplicate-expense warning;
- old unpaid obligation warning;
- package-ready-for-payment warning;
- deterministic local insights;
- no paid AI dependency.

Core owns the audit envelope; modules own the meaning of their events/review rules.

## Reports

Preserve these as separate concepts:

1. work performed/earned;
2. cash received;
3. amount due now;
4. package work performed but not due yet;
5. prepaid credit.

Required tutoring/finance reports include monthly work value, completed lessons, student cash, other income, business/personal expenses, cash net, due now, package work not due, lesson type, billing mode, expense categories and true hourly return including travel time.

Reports are derived projections. They are not stored duplicate financial truth.

## Security and reliability

Keep passcode-style simple access where appropriate, but redesign cloud auth around users/workspaces and signed HttpOnly sessions.

Add:

- workspace membership authorization;
- login abuse/rate control;
- idempotency as a first-class platform facility;
- CI/type/tests as merge/deploy gates.

## PWA and performance outcomes

Keep:

- installable PWA direction;
- cacheable application shell;
- lazy loading of expensive views;
- no hidden background polling loops;
- indexed planner/report queries;
- fast Worker startup.

Do not copy the implementation hacks used in Sozan1.

## Explicitly not ported

- `runtime-entry → final → v6 → worker` interception chain;
- runtime `CREATE TABLE` / compatibility DDL;
- DB proxy/no-op SQL suppression;
- browser API monkey patches;
- runtime HTML/script injection;
- V3/V4/V5/V6/V7 compatibility APIs;
- old monthly billing compatibility structures;
- shadow package sessions / fake 1900 dates;
- duplicate direct-payment and receipt ledgers.

## Platform mapping

The retained behaviour maps to these pieces:

```text
Core
├── identity/workspaces
├── module registry
├── labels/layouts
├── audit
└── idempotency

Tutoring
├── students/groups
├── schedule/occurrences
└── package billing state

Finance
├── receipts/allocations
├── expenses/income
└── reconciliation

Planner
└── combined planning/availability surface

Reports
└── derived reports and deterministic insights
```

## Freeze result

Sozan1's useful product behaviour has been retained as evidence for the first template, while the new platform remains user-neutral, workspace-scoped, local-first and modular.

The first Sozan2 D1 schema therefore uses:

- TEXT application-generated IDs;
- `workspace_id` on business data;
- module-prefixed tables;
- no personal name defaults;
- no cross-module tutoring→finance foreign keys;
- native package opening progress;
- configurable labels and page layouts;
- optional cloud persistence rather than a cloud-only product assumption.
