# Sozan2 staged roadmap

## Stage 0 — Foundation

- TypeScript strict mode
- React/Vite shell
- Hono Worker
- D1 schema migration
- CI + unit tests
- health endpoint only

## Stage 1 — Security and database

- Create `sozan2-db`
- Bind as `DB`
- Apply migration
- Passcode login with signed HttpOnly session cookie
- Protect every non-health API route
- Add rate limiting / login abuse control

## Stage 2 — Students and recurring schedule

- Students CRUD
- Guardian details
- Recurring sessions
- Group participants
- One-off reschedule
- Activity log

## Stage 3 — Attendance and billing

- Lesson occurrences
- Per-session billing
- Package billing
- Complete / cancel / reopen
- Golden tests for all state transitions

## Stage 4 — Money

- Student receipts
- Deterministic receipt allocation
- Credit
- Corrections / soft delete / restore
- Expenses and other income
- Reconciliation tests

## Stage 5 — Product UI

- Today
- Money
- Schedule
- Student account
- Activity / correction centre
- Reports

## Stage 6 — Migration and cutover

- Extract old D1
- Transform and import
- Compare totals down to the penny
- Parallel verification
- Final cutover only after acceptance checks pass
