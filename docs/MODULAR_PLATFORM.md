# Sozan2 modular platform contract

This document supersedes the earlier assumption that Sozan2 itself is a tutoring-only product.

## Product boundary

Sozan2 is a small local-first workspace platform. Tutoring is the first fully implemented template/module set because Sozan1 gives us real product evidence for it.

The platform core must not know what a student, lesson, package or appointment is.

```text
Core
├── identity
├── workspaces
├── members
├── enabled modules
├── labels / terminology
├── surface layouts
├── activity/audit
├── idempotency
└── persistence contracts

Modules
├── tutoring
├── finance
├── planner
└── reports
```

Future modules may add appointments, clients, tasks, inventory or other workflows without renaming tutoring tables or adding compatibility branches to tutoring code.

## Lego rule

Every business module owns its domain, services, ports, UI contribution and persistence adapter.

A module may depend only on documented contracts/events from another module. It must not import another module's private repository or query another module's tables directly.

Example:

```text
Tutoring
  └── emits: tutoring.lesson.completed

Finance
  └── receives a command/event and records a receipt/allocation

Reports
  └── consumes read contracts/events
```

This keeps a finance refactor from forcing changes inside tutoring attendance, and vice versa.

## Persistence

Sozan2 supports two persistence modes behind repository contracts:

### Local mode

```text
React/PWA → IndexedDB
```

- no paid external API;
- no D1 required;
- offline-capable;
- intended to remain usable for a single user/device at zero backend cost.

### Cloud mode

```text
React/PWA → internal Worker API → D1
```

- optional;
- enables shared workspaces and multi-device use;
- still has no dependency on a paid AI API.

The internal Worker API is an implementation boundary, not a paid third-party API dependency.

Module services must depend on repository interfaces rather than D1 or IndexedDB directly. The tutoring student module already has both a D1 and IndexedDB adapter as the reference pattern.

## IDs and sync

Canonical entity IDs are TEXT IDs created by the application (UUID/ULID-style), not database auto-increment IDs.

This is required so records created offline can later be synchronized without ID collision.

## Workspaces and users

A user may belong to multiple workspaces. A workspace has:

- its own name;
- template key;
- enabled modules and order;
- locale/timezone/currency;
- terminology overrides;
- page/widget layout.

No core record assumes the user is named Sozan.

## Templates and terminology

Templates configure the workspace without changing the domain model.

The implemented template is `tutoring`.

Reserved future templates include `appointments`, `small_business` and `custom`, but they are explicitly marked `implemented: false` until their real modules exist. The UI must not pretend those workflows are complete.

Terminology is configurable. For example:

```text
tutoring:     طالب / حصة
appointments: عميل / موعد
```

Changing labels is not used as a shortcut to pretend that a tutoring lesson is an appointment. When behaviour differs, a separate module is required.

## Customisable "Me" / personal surface

The personal surface is composed from module widgets rather than hard-coded sections.

Examples:

- profile/workspace identity;
- today widget;
- money summary;
- review/correction widget;
- insights;
- cash check.

`core_surface_layouts` stores layout only. It must never store canonical financial totals.

## Sozan1 relationship

Sozan1 remains a behavioural reference for the tutoring template only.

Keep product ideas such as:

- pending vs confirmed schedule;
- availability planner;
- one-off lesson rescheduling;
- per-session/package billing;
- package opening progress;
- receipts/credit/reallocation;
- expenses and other income;
- cash reconciliation;
- activity/review;
- deterministic reports/insights.

Do not copy its compatibility layers, runtime DDL, browser monkey patches, hidden synthetic package sessions, versioned API wrappers or duplicate payment ledgers.
