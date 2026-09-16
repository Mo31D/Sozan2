# Sozan → Sozan2 feature audit

Audit baseline: `Mo31D/sozan@b3187092b051ecbd0e1e6b7161acd7b57213a5a3`.

This document freezes the product behaviour that Sozan2 must preserve or deliberately redesign before the first Sozan2 D1 database is created.

## Decision rule

The old repository is a product specification, not a code foundation.

For each old behaviour:

- **KEEP** — user-facing behaviour is valuable and should exist in Sozan2.
- **REDESIGN** — preserve the outcome, replace the implementation.
- **DROP** — compatibility/patch machinery that must not enter Sozan2.

## 1. Core daily workflow

| Capability | Decision | Sozan2 target |
|---|---|---|
| Today view with today's lessons | KEEP | Native Today query/service |
| Mark lesson completed and paid | KEEP + REDESIGN | Complete occurrence + create one canonical receipt/allocation |
| Mark lesson completed but unpaid | KEEP | Attendance service |
| Cancel / restore / reopen lesson | KEEP | Explicit state transitions with audit events |
| Move one lesson without changing the weekly schedule | KEEP | Occurrence override fields |
| Edit the recurring schedule for future lessons only | KEEP | Schedule service regenerates future scheduled occurrences only |
| Quick receipt: “قبضت فلوس” | KEEP | Receipt service |
| Quick expense entry | KEEP | Expense service |

## 2. Students and accounts

| Capability | Decision | Sozan2 target |
|---|---|---|
| Student profile | KEEP | Student aggregate endpoint |
| Guardian name and phone | KEEP | Student fields |
| Age, level, notes | KEEP | Student fields |
| Student balance: due / paid / credit | KEEP | Derived from obligations + allocations |
| Last payment | KEEP | Derived receipt query |
| Student timeline | KEEP | Activity/account query |
| Multiple recurring schedules for one student | KEEP | Many-to-many schedule participants |
| Groups | KEEP + IMPROVE | A recurring session can contain multiple students instead of a fake single-student model |

## 3. Schedule and availability planner

The latest Sozan added a meaningful product concept: a recurring schedule can be **confirmed** or **pending**.

| Capability | Decision | Sozan2 target |
|---|---|---|
| Weekly availability board | KEEP | First-class planner view |
| Display lessons, free time and travel time | KEEP | Derived planner projection |
| Pending schedule: “هظبطه بعدين” | KEEP | `recurring_sessions.schedule_status` |
| Pending schedule must not generate live occurrences | KEEP | Service invariant, covered by tests |
| Keep last known day/time while pending | KEEP | Day/time may remain as reference |
| Quick change of future weekday/time | KEEP | Schedule command |
| Planner date range endpoint | KEEP | Schedule read model |
| No continuous UI polling | KEEP | Event/refetch based UI |

## 4. Billing

Current product billing is **per-session or lesson package**. The old monthly model is legacy compatibility and is not a Sozan2 product mode.

| Capability | Decision | Sozan2 target |
|---|---|---|
| Per-session billing | KEEP | Session price snapshot on occurrence |
| Package billing | KEEP | Student billing plan + package cycles |
| Configurable package size and price | KEEP | Billing plan |
| Package progress `x / n` | KEEP | Native cycle progress |
| Payment becomes due when package completes | KEEP | Cycle state transition `open → due` |
| Paid cycle | KEEP | `due → paid` after allocations cover cycle price |
| Work done inside open package but not due yet | KEEP | Derived `work_not_due` metric |
| New schedule inherits student's package configuration | KEEP | Billing service, not route patch |
| Prevent unsafe billing-mode changes after history exists | KEEP | Domain invariant |

### Existing package progress at onboarding

Latest Sozan supports a student who already completed part of the current package before being entered into the app:

- cycle start date;
- number of lessons already completed;
- current progress, remaining lessons and next position;
- opening progress becomes fixed after real new lessons are recorded.

**KEEP the feature, REDESIGN the implementation.**

Old Sozan represents opening progress with hidden/shadow recurring sessions and synthetic occurrences. Sozan2 will store it directly as `billing_cycles.opening_completed_count`. No fake lessons, fake dates, hidden sessions or sentinel titles.

## 5. Money model

Old Sozan has two teaching-money paths: direct occurrence payments and student receipts. Sozan2 should have one canonical incoming-money model.

### Sozan2 rule

All teaching cash is a **receipt**.

- Normal “قبضت فلوس” receipts are linked to a student.
- A lesson-level group payment may be linked directly to its occurrence when there is no individual student account.
- A “تمت واتدفعت” action creates the same receipt entity automatically.

This removes duplicate financial truth while preserving the old ability to record income for group lessons that are not attached to one named student.

| Capability | Decision | Sozan2 target |
|---|---|---|
| Manual receipt by student | KEEP | `receipts.student_id` |
| Lesson/group payment without a named student | KEEP + REDESIGN | Receipt tied to `source_occurrence_id` |
| Automatic allocation to oldest due items | KEEP | Allocation service |
| Surplus becomes prepaid credit | KEEP | Unallocated student receipt balance |
| Edit receipt and reallocate deterministically | KEEP | Rebalance service |
| Soft-delete / restore receipt | KEEP | Rebalance after mutation |
| Per-session payment correction | KEEP + REDESIGN | Correct the underlying canonical receipt/allocation |
| Package receipt allocation | KEEP | Same allocation table, package-cycle target |
| Duplicate mutation protection | KEEP | Idempotency table/middleware |

## 6. Expenses, other income and reconciliation

| Capability | Decision | Sozan2 target |
|---|---|---|
| Business expenses | KEEP | Expense entity |
| Personal expenses | KEEP | Expense entity |
| Expense categories | KEEP | Domain enum/config |
| Other income | KEEP | Other-income entity |
| Edit/delete/restore | KEEP | Soft delete + activity event |
| Expected current balance | KEEP | Derived ledger calculation |
| Cash check: expected vs actual | KEEP | `cash_checks` |
| Difference / unrecorded spending signal | KEEP | Reconciliation service |

## 7. Activity, correction and intelligence

| Capability | Decision | Sozan2 target |
|---|---|---|
| Searchable activity log | KEEP | Append-only activity events |
| Before/after snapshots where useful | KEEP | JSON snapshots |
| Correction centre | KEEP | Read model / rules, not stored duplicate truth |
| Duplicate-expense warning | KEEP | Review rule |
| Old unpaid lesson warning | KEEP | Review rule |
| Package completed and ready for payment | KEEP | Review rule |
| Local numerical insights | KEEP | Deterministic insight service |
| No paid AI dependency | KEEP | Core product remains deterministic |

## 8. Reports and dashboard

Sozan2 must preserve the separation between three concepts:

1. **Work earned/performed**.
2. **Cash received**.
3. **Amount currently due**.

For packages, work can exist inside an open cycle before the package price is due.

Required reports:

- monthly work value;
- completed lessons;
- student cash received;
- other income;
- business/personal expenses;
- cash net;
- due now;
- package work not due;
- breakdown by lesson type;
- breakdown by billing mode;
- expense categories;
- true hourly return including travel time.

## 9. Security and reliability

| Capability | Decision | Sozan2 target |
|---|---|---|
| Passcode login | KEEP | Auth service |
| Signed HttpOnly cookie | KEEP | Auth middleware |
| Rate limiting / abuse control | ADD | Missing hardening in old app |
| Idempotent mutations | KEEP | First-class middleware |
| Soft deletion for financial records | KEEP | Schema invariant |
| CI/type checks/tests | IMPROVE | Required before merge/deploy |

## 10. PWA and performance

Keep the useful outcomes from recent performance work:

- PWA installability;
- cache-first application shell with background refresh;
- no continuous hidden-view polling;
- load expensive views only when needed;
- indexed planner/report queries;
- fast Worker startup.

Do **not** port the implementation hacks used to reach those outcomes.

## 11. Explicitly NOT ported

The following are legacy/compatibility mechanisms, not product features:

- `runtime-entry → final → v6 → worker` request interception chain;
- runtime `CREATE TABLE` / compatibility DDL;
- database proxy that suppresses compatibility SQL;
- `runtime-pre.js` / `runtime-post.js` browser monkey patches;
- HTML/script injection at runtime;
- V3/V4/V5/V6/V7 API/version compatibility layers;
- old monthly billing tables and monthly-to-package runtime conversion;
- shadow recurring sessions and synthetic 1900-date occurrences for opening package progress;
- separate direct-payment truth alongside receipts.

## 12. Sozan2 bounded contexts

Sozan2 is frozen around these modules:

1. **Auth**
2. **Students**
3. **Schedule & Planner**
4. **Lessons / Attendance**
5. **Billing & Packages**
6. **Receipts & Allocation**
7. **Expenses & Other Income**
8. **Reconciliation**
9. **Activity & Review**
10. **Dashboard / Reports / Insights**
11. **Settings**
12. **Migration**

Each module may expose routes, but cross-module financial rules must run through domain services rather than direct SQL from route handlers.

## 13. Freeze result

The Sozan2 architecture is compatible with the current product direction, but the original `0001_core.sql` was incomplete for the newest planner, package-opening-progress, reconciliation and idempotency behaviours.

The initial Sozan2 migration must be updated **before any D1 database is created**. That is safe because no Sozan2 production D1 migration has been applied yet.
