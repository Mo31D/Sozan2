# Sozan2 staged roadmap

## Stage 0 — Foundation — DONE

- TypeScript strict mode
- React/Vite shell
- Hono Worker shell
- CI + unit tests
- Cloudflare build/deploy verified
- health endpoint only

## Stage 0.5 — Product/platform/schema freeze — DONE

- Audit latest useful Sozan1 tutoring behaviour
- Reframe Sozan2 as user-neutral workspace platform
- Add module registry and dependency graph
- Add configurable terminology and surface layout model
- Add local-first persistence contracts
- Add IndexedDB and D1 reference adapters for tutoring students
- Make IDs sync-safe TEXT IDs
- Scope business data by workspace
- Split tutoring and finance storage ownership
- Keep pending/confirmed schedule model
- Keep native opening package progress
- Keep canonical Finance receipt model
- Add idempotency and audit foundations
- Validate initial SQLite/D1 schema in CI

## Stage 1 — Create D1 + security/bootstrap

- Create `sozan2-db`
- Bind it as `DB`
- Apply frozen `0001_core.sql`
- Bootstrap first user + workspace + tutoring template
- Hash passcode; never store plain text
- Signed HttpOnly cloud session cookie
- Workspace membership authorization
- Login abuse/rate control
- Idempotency middleware
- Keep all non-health cloud APIs closed until authorization is in place

## Stage 2 — Persistence parity and workspace shell

- Workspace selector/profile
- Enabled module loading
- Terminology resolution
- Configurable navigation
- Widget/surface composition for Home and “أنا”
- Local mode selection
- Cloud mode selection
- Continue IndexedDB/D1 adapter parity for each repository added

## Stage 3 — Tutoring + Planner

- Students CRUD
- Guardian / age / level / notes
- Groups and participants
- Recurring tutoring sessions
- Confirmed vs pending schedule
- Weekly planner/availability
- Quick “set later” / quick schedule
- Future-only recurring schedule edits
- One-off occurrence reschedule
- Activity events for schedule changes
- Occurrence generation only from confirmed schedules

## Stage 4 — Attendance + package billing

- Complete / cancel / restore / reopen
- Per-session financial snapshots
- Package billing cycles
- Current package progress `x / n`
- Existing/opening progress when onboarding mid-cycle
- Lock opening progress after real lessons begin
- Work-not-due vs due-now separation
- Golden transition tests

## Stage 5 — Finance

- Canonical receipts
- Tutoring quick “completed and paid” through Finance contract
- Deterministic oldest-due allocation
- Package-cycle allocation
- Prepaid credit
- Receipt edit / soft delete / restore / rebalance
- Safe correction workflow
- Expenses and other income
- Cash reconciliation
- Finance tests independent of tutoring persistence implementation

## Stage 6 — Reports and polished UI

- Today
- Money
- Tutoring
- Planner
- Student account
- Package progress
- Activity/review centre
- Customisable “أنا” page
- Insights
- Monthly reports
- PWA installability/cache strategy

## Stage 7 — Sozan1 migration tool

- Extract old D1
- Convert old numeric IDs into sync-safe IDs
- Map direct payments into Finance receipts
- Transform package progress including opening progress
- Ignore compatibility-only V3/V4/V5/V6/V7 structures after extracting meaning
- Import into one target workspace
- Compare totals to the penny

## Stage 8 — Parallel verification and cutover

- Compare old/new attendance, package progress, cash, due, credit and expenses
- Fix every mismatch before cutover
- Switch daily use only after acceptance checks pass
- Keep old Sozan read-only for an agreed rollback/evidence window

## Future modules

The platform architecture may later add real modules/templates such as appointments, clients, tasks or inventory. These should be added as new modules/migrations, not as conditionals inside tutoring.
