# Sozan2 staged roadmap

The latest old-Sozan product behaviour was audited before the first Sozan2 D1 database was created. See `FEATURE_AUDIT.md`.

## Stage 0 — Foundation — DONE

- TypeScript strict mode
- React/Vite shell
- Hono Worker
- CI + unit tests
- Cloudflare build/deploy verified
- health endpoint only

## Stage 0.5 — Product/schema freeze — DONE

- Audited current `sozan` through planner and package-progress behaviour
- Froze bounded contexts
- Replaced opening-package shadow records with native cycle progress
- Added pending/confirmed schedule state to the target model
- Unified teaching cash around canonical receipts
- Preserved session-level group payments without requiring a fake student
- Added cash checks and idempotency to the initial schema
- Added domain tests for package progress and schedule generation
- Added CI execution/validation of `migrations/0001_core.sql`
- CI passed schema validation, type checks, tests and production build

## Stage 1 — Security and database — NEXT

- Create `sozan2-db`
- Bind as `DB`
- Apply frozen `0001_core.sql`
- Passcode login with signed HttpOnly session cookie
- Protect every non-health API route
- Add login rate limiting / abuse control
- Add mutation idempotency middleware

## Stage 2 — Students and schedule planner

- Students CRUD
- Guardian / age / level / notes
- Recurring sessions
- Group participants
- Confirmed vs pending schedule
- Weekly availability planner
- Quick “set later” / quick schedule
- Future-only recurring schedule edits
- One-off occurrence reschedule
- Activity events for schedule changes

## Stage 3 — Attendance and billing

- Occurrence generation only from confirmed schedules
- Complete / cancel / restore / reopen
- Per-session billing snapshots
- Package billing cycles
- Current package progress `x / n`
- Existing/opening package progress when onboarding mid-cycle
- Lock opening progress after real lessons begin
- Work-not-due vs due-now separation
- Golden tests for all state transitions

## Stage 4 — Money

- Canonical receipts for student and lesson-level teaching income
- “Completed and paid” implemented as receipt creation
- Deterministic allocation to oldest due obligations
- Package-cycle allocation
- Prepaid student credit
- Receipt edit / soft delete / restore / full rebalance
- Safe payment correction workflow
- Expenses and other income
- Reconciliation tests

## Stage 5 — Product read models and UI

- Today
- Money
- Schedule / availability
- Student account
- Package progress
- Activity log
- Correction/review centre
- Cash reconciliation
- Insights
- Monthly reports
- PWA installability and cache strategy

## Stage 6 — Migration tool

- Extract old D1
- Transform old direct payments into receipts
- Transform package progress, including opening progress
- Ignore compatibility-only V3/V4/V5/V6/V7 structures after extracting meaning
- Import into new D1
- Compare totals down to the penny

## Stage 7 — Parallel verification and cutover

- Run old and new calculations against the same snapshot
- Compare students, attendance, package progress, cash, due, credit and expenses
- Fix every mismatch before cutover
- Switch daily use only after acceptance checks pass
- Keep old Sozan read-only as rollback evidence for an agreed window
