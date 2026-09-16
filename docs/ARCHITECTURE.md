# Sozan2 architecture

Sozan2 is a **modular, local-first workspace platform**. The tutoring workflow is the first implemented template and uses Sozan1 as behavioural evidence; it is not part of the platform core.

See `MODULAR_PLATFORM.md` for the product contract and `FEATURE_AUDIT.md` for the Sozan1 keep/redesign/drop decisions.

## Layers

```text
UI surfaces
   ↓
application services
   ↓
domain rules + module ports
   ↓
persistence adapters
  ↙              ↘
IndexedDB         D1
```

HTTP/Hono exists only in cloud mode. Core business services must not require HTTP, Cloudflare or D1.

## Core ownership

Core owns only platform concerns:

- users;
- workspaces and membership;
- enabled modules and order;
- terminology overrides;
- user/workspace surface layouts;
- activity/audit envelope;
- idempotency;
- persistence contracts and IDs.

Core does **not** know what a student, lesson, package, appointment or client is.

## Module ownership

### Tutoring

Owns students, recurring teaching sessions, lesson occurrences, attendance state, per-session billing configuration and package cycles.

### Finance

Owns receipts, receipt allocations, expenses, other income and cash reconciliation.

Finance does not foreign-key directly into tutoring tables. It stores typed external references such as:

```text
module=tutoring
type=occurrence
id=<text-id>
```

Application services validate these references when commands cross module boundaries.

### Planner

Owns the planning surface and consumes schedule-provider contracts from enabled modules. A tutoring recurring schedule remains tutoring-owned data.

### Reports

Produces derived read models and deterministic insights. It does not store duplicate canonical totals.

## Lego boundary

A module may not:

- query another module's private tables directly;
- import another module's persistence adapter;
- write another module's canonical state;
- require an unrelated module unless declared as a dependency.

Cross-module effects use a public contract or a domain event.

Example:

```text
Tutoring completes lesson
        ↓
tutoring.lesson.completed
        ↓
Finance / Activity / Reports react independently
```

This prevents a change in one piece from forcing edits across the whole product.

## Persistence and zero-backend mode

### Local mode

```text
React/PWA → IndexedDB
```

Local mode is a supported architecture, not a demo fallback. It requires no D1 and no paid external API.

### Cloud mode

```text
React/PWA → Hono Worker → D1
```

Cloud mode is optional and enables multi-device/shared-workspace use.

Module services depend on repository interfaces. The tutoring student repository is the reference implementation with both IndexedDB and D1 adapters.

## Identity and workspaces

Entity IDs are application-generated TEXT IDs so offline-created records can later sync without integer collisions.

Every business record is scoped to a workspace. `workspace_id` is a mandatory security and data-isolation boundary in module tables.

A workspace carries:

- name;
- template key;
- locale/timezone/currency;
- enabled modules;
- label overrides;
- surface layout.

No schema default contains a personal user's name.

## Templates

Templates select modules and default vocabulary. They do not change core schema semantics.

`tutoring` is implemented. `appointments`, `small_business` and `custom` are catalogued as future templates but are marked unimplemented until their real modules exist.

Changing `حصة` to `موعد` is allowed as a display label only when the underlying workflow is actually compatible. Behaviourally different workflows receive separate modules instead of conditionals inside tutoring.

## Customisable surfaces

Navigation and pages such as "أنا" are compositions of module contributions.

A module may contribute:

- navigation items;
- widgets;
- actions;
- read models.

`core_surface_layouts` stores ordering/visibility/size configuration. Canonical business values remain in module data and are always derived at render/query time.

## Tutoring rules preserved from Sozan1

### Schedule

A recurring tutoring schedule is `confirmed` or `pending`.

- confirmed schedules can generate occurrences;
- pending schedules remain visible to planning but generate none;
- changing the recurring schedule affects future scheduled work only;
- one-off movement belongs to the occurrence.

### Package billing

Current configuration is stored on a student billing plan. Every package cycle snapshots its own size and price.

Package progress is:

```text
opening_completed_count + real completed occurrences
```

Opening progress represents work completed before onboarding. It is native state and is locked after real new occurrences begin unless a dedicated correction workflow proves the change safe.

### Finance

All incoming teaching cash is a finance receipt. "Completed and paid" is a convenience command that creates the same receipt entity as manual collection; it is not a second payment ledger.

Receipt allocation may target a tutoring occurrence or completed package cycle through typed cross-module references.

### Reporting concepts

Never merge these concepts:

1. work performed/earned;
2. cash received;
3. amount due now;
4. package work performed but not due yet;
5. prepaid credit.

## Audit and idempotency

State-changing commands emit activity events. Destructive financial corrections preserve before/after evidence where useful.

Every money-changing or attendance-changing cloud mutation must support a stable idempotency key. Local adapters must preserve the same command-level invariants even though network retry is not involved.

## Migration discipline

Production schema changes happen only in migrations. No request may create or alter tables.

Sozan1 migration is explicit:

```text
old D1 → extract → normalise → validate → Sozan2 import
```

Compatibility tables, runtime wrappers and patch scripts are never imported as architecture.

## Non-negotiable invariants

1. Money is integer pence.
2. IDs are globally safe for local/cloud creation.
3. All module data is workspace-scoped.
4. Pending schedules never create occurrences.
5. Historical completed work is not rewritten by future schedule/billing edits.
6. Package opening progress is native state, not fake lessons.
7. A receipt cannot allocate more than its value.
8. Automatic allocation cannot overpay a target obligation.
9. Edit/delete/restore of receipts causes deterministic reallocation.
10. Module boundaries are crossed only through public contracts/events.
11. No paid AI/external API is required for core operation.
