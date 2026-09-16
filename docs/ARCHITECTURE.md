# Sozan2 architecture

## Direction of dependencies

```text
client → HTTP API
routes → services → repositories → D1
                 ↘ domain
```

The domain layer must not import Cloudflare, Hono, React, or browser APIs.

## Ownership

### Client
Rendering, forms, interaction state, and calling the HTTP API.

### Routes
HTTP concerns only: authentication, request parsing, status codes, and response shape.

### Services
Business rules: attendance, billing, receipt allocation, outstanding balances, package progression, corrections, and reporting.

### Repositories
SQL and persistence only. No business decisions.

### Domain
Pure types, validation, calculations, and invariants. This is the highest-priority unit-test surface.

### Migrations
The only place allowed to create or alter production tables.

## Financial invariants

Before financial features are enabled, tests must prove at least these invariants:

1. Money is represented as integer pence.
2. A receipt cannot allocate more than its value.
3. An occurrence or package cannot be overpaid by automatic allocation.
4. Editing or deleting a receipt deterministically recalculates allocations.
5. Completing/cancelling/reopening a lesson does not silently duplicate income.
6. Package progress and package payment are separate concepts.
7. Every destructive correction is auditable.

## Migration from old Sozan

The old system is not queried live by Sozan2. Migration will be an explicit process:

```text
old D1 → extract → normalise → validate → new D1
```

Cutover is blocked until old/new totals match for students, completed lessons, receipts, outstanding balances, credit, expenses, and final balance.
