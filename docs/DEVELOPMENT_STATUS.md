# TRACE Development Status

Last updated: 2026-10-18 (autonomous engineering session, branch `feature/backend-foundation`)

This document is the single source of truth for what exists, what's in
progress, and what's next. Read this first in any new session before making
changes.

## How to resume this work

```bash
cd ~/Developer/TRACE
git checkout feature/backend-foundation   # this branch has the backend work
npm install
npm run build                             # verifies everything still compiles

# Live database (see apps/api/.env.example for the expected vars):
docker compose up -d postgres             # trace-postgres-1 on port 5433
cd apps/api && npx prisma migrate deploy  # apply migrations (non-interactive-safe)
npx tsx prisma/seed.ts                     # idempotent — safe to re-run
node dist/main.js                          # or `npm run dev` for watch mode

# Frontend, in another terminal — copy apps/web/.env.example to .env.local
# and set TRACE_API_KEY to the key the seed script printed, to see the
# backend-status badge actually report "connected":
cd apps/web && npm run dev
```

Nothing on this branch has been pushed to GitHub — it exists only in the
local working copy pending the repository owner's approval to push.

## Completed (verified working)

### Phase 1 — Frontend org graph
- Next.js 16 + React + TypeScript app at `apps/web`.
- Interactive org graph (React Flow): Organization → Department → Developer →
  GitHub/API Usage/Security metric leaves.
- Expand/collapse, drag, zoom/pan, minimap, detail panel, activity/metric
  filters, stats row, JSON Canvas export.
- All data simulated (`apps/web/lib/data.ts`) — no backend yet at this point.
- Verified: `tsc --noEmit`, ESLint, `next build` (Turbopack) all pass.

### Repo foundation
- npm workspaces at the root (`apps/*`).
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, typecheck, build on
  every PR/push. **Currently green** (run `17f1fc3`).
- MIT license.

## In progress (this session)

Building the backend foundation that Phases 2–6 of the original roadmap all
depend on. Nothing in `apps/web` is being changed — this is additive.

- [x] `apps/api` — NestJS backend scaffold (health check, strict TS, lint,
      Jest, verified end-to-end — see log below)
- [x] Prisma schema (Organization/Department/Developer/ApiKey/
      GithubInstallation/Repository/ActivityEvent/ApiUsageEvent/
      SecurityAlert) + Docker Compose Postgres config — **migrated and
      seeded against a real local Postgres; see the live-verification log
      entry below.**
- [x] Organizations/developers module with org-scoped authorization
      (`OrgApiKeyGuard`) — unit-tested AND verified live against the
      seeded database (including a real 401 on a missing key).
- [x] GitHub integration module (Octokit-based sync + webhook signature
      verification + connect/sync endpoints) — the *sync logic, database
      writes, and API surface* are now verified live end-to-end (see log
      below), using `MockGithubApiClient` since no real GitHub App
      credentials exist in this environment. **Still unverified:** an
      actual call to the real GitHub REST API — `OctokitGithubApiClient`
      itself has never run against github.com.
- [x] API telemetry ingestion SDK + aggregation endpoints — unit-tested
      AND verified live (real spike data in, correct summary/trend out).
- [x] Deterministic security alert rule engine — unit-tested AND verified
      live (the rules fired correctly against real seeded + reported
      data, with correct dedup on a second run).
- [x] Playwright tests for the existing graph UI (see log below)
- [x] Frontend ↔ backend communication — a server-only proxy route plus a
      status badge, verified live in both the connected and
      backend-unreachable states (see log below).
- [x] **The graph itself now renders from live backend data** when
      configured, with demo mode preserved as an explicit, clearly-labeled
      fallback (see "Graph connected to live backend data" log entry) —
      this was the primary objective of the most recent work.
- [x] Repository and developer detail panels backed by real data; API
      usage dashboard and security alert explorer panels, each reachable
      only by clicking a node in the graph (not a separate page).
- [x] GitHub organization onboarding UI — a "Connect GitHub" button
      (live mode only) opens a modal, connects an installation, triggers
      a sync, and refetches the graph, all from the graph itself.

This list is updated as each item lands; see the detailed log below for
what's actually been verified so far.

## Detailed log

Entries are appended chronologically, newest first. Each entry says exactly
what was verified and how.

### GitHub organization onboarding UI, and a Playwright flakiness fix

Added `ConnectGithubModal.tsx` — a "Connect GitHub" button in the filter
bar (rendered only in live mode; there's nothing to connect to in demo
mode) opens a form, `POST`s to the existing connect endpoint, then the
existing sync endpoint, then calls the graph's `refetch`. The modal's
copy is explicit that this stands in for GitHub's real App-install
redirect (which TRACE doesn't implement — no registered App exists to
redirect from): "In production, these fields are filled in automatically
... This demo doesn't have a registered App, so enter them manually."

**Verified live**, twice: once by hand (a real browser, a real
installation row confirmed via `curl` afterward with a matching id), and
once via a new permanent test
(`e2e-live/graph-live.spec.ts`: "connects a GitHub installation and syncs
it from the onboarding modal") using a timestamp-based installation id so
repeated runs never collide.

**A real, reproducible flakiness issue found and fixed in the existing
demo-mode suite** (not a new bug — this predates today's changes, just
surfaced now): running the full suite with Playwright's default
CPU-core-based worker count (5, in this sandboxed environment) made one
test fail reliably, while the exact same test passed reliably in
isolation or with `--workers=1`. Confirmed by testing both ends: the
test logic itself is correct, it just wasn't getting enough wall-clock
time to settle under that much simultaneous Chromium load. Fixed by
capping `workers: 2` in `playwright.config.ts` — confirmed clean across
3 separate, properly-spaced runs afterward.

**Verified:** full `lint`/`typecheck`/`test`/`build` clean across all
three workspaces. Demo suite 8/8 (×3 runs). Live suite 6/6, including
the new onboarding test.

### Graph connected to live backend data, with demo mode preserved

The primary objective of this round: the interactive graph itself — not
just a status badge — now renders from real database records when a
backend is configured, falling back to the existing static demo data
(unchanged) otherwise. Every graph relationship in live mode traces back
to an actual row: Organization/Department/Developer/Repository tables and
counts derived from ActivityEvent/ApiUsageEvent/SecurityAlert — nothing
arbitrary.

**Backend:** added `GET /graph/snapshot` (`apps/api/src/graph`) —
deliberately lean: it returns the graph's *structure* (org, departments,
developers, repositories) plus small per-node summary counts, computed
from real rows. It does not duplicate the richer `/telemetry/*` or
`/security/alerts` logic — the frontend fetches those separately, lazily,
only when a user opens that specific panel.

**Frontend:**
- `lib/useGraphData.ts` — starts with demo data synchronously (interactive
  immediately, no loading flash), fetches the live snapshot, and swaps to
  it on success or stays on demo data on any failure. Exposes `mode`
  ("checking" | "live" | "demo") and a `refetch` used after actions that
  change backend data.
- `lib/map-snapshot.ts` — converts a live snapshot into the exact same
  `OrgEntity[]` shape demo data already used, so every existing
  graph/filter/stats/layout component works completely unchanged in
  either mode — no special-casing needed in `OrgGraph.tsx` beyond where
  the entity array comes from.
- Four new entity kinds (`lib/types.ts`): `repositoryGroup`/`repository`
  (a new top-level branch under the org, parallel to departments) and two
  org-wide nodes, `apiUsageDashboard` and `securityAlertsGroup`, each
  opening a dedicated panel (`ApiUsageDashboardPanel.tsx`,
  `SecurityAlertsPanel.tsx`) that fetches its own richer data on open —
  a provider/cost/error table plus a 14-day trend chart for usage; a
  filterable, status-editable alert list for security.
- `BackendStatusBadge` reworked into a pure presentational component (no
  longer does its own fetch — the old standalone `/api/backend-status`
  route was deleted, since the graph's one snapshot fetch already has
  everything the badge needs) with three states: checking / live /
  **demo mode** (explicitly labeled, amber, as required).
- `app/api/trace/[...path]/route.ts` — one catch-all server-side proxy
  (GET/POST/PATCH) replacing what would otherwise have been several
  near-identical route files; `TRACE_API_KEY` is read only inside
  `lib/trace-api.ts`, never in client-side code.

**A real bug found and fixed before it reached any test:** the first
version reset `selectedId`/`collapsedIds` on every change to the fetched
entity array — correct for the demo→live transition, but it meant
updating a security alert's status (which triggers a `refetch`) would
yank the very panel the user was looking at out from under them,
immediately after they used it. Fixed by keying the reset on `mode`
*transitions* specifically (checking→live, checking→demo) rather than on
every entities change — a refetch within the same mode now preserves
whatever the user has open/selected/dragged.

**Testing — two separate Playwright suites, not one:**
- `playwright.config.ts` (existing `e2e/`) now explicitly clears
  `TRACE_API_BASE_URL`/`TRACE_API_KEY` for its spawned dev server and
  always starts fresh rather than reusing one — this makes the suite
  deterministically exercise demo mode regardless of what `.env.local`
  happens to contain on a given machine. (Discovered why this mattered:
  running the suite with `.env.local` configured silently broke it, since
  it started testing *live* data against ids/labels hardcoded for demo
  data — not a bug in the app, but exactly the kind of environment
  dependency a test suite shouldn't have.)
- `playwright.live.config.ts` (new `e2e-live/`) runs against a real
  backend — explicitly documented as requiring one, run via
  `npm run test:e2e:live --workspace apps/web`. 5 tests: real org data
  renders, the repository group shows real synced repos, the API usage
  dashboard shows real provider data, the security alerts panel shows
  real alerts and updates status, and — the most meaningful one —
  resolving an alert decrements the graph's own open-alert count by
  exactly one, verified with `expect.poll`, then restored for
  idempotency. Two authoring bugs were caught and fixed while writing
  this suite (not app bugs): one test clicked a toggle on a node that
  starts expanded by default (collapsing it instead of revealing
  children), and another asserted a stale element's value after an
  action correctly removed it from the current filter view.

**Verified:** full `lint`/`typecheck`/`test`/`build` clean across all
three workspaces. `apps/web`'s demo-mode suite: 8/8. The new live-mode
suite: 5/5 (confirmed exercising the real resolve path, not skipping it,
by setting an alert back to OPEN first and checking after).

### Live database verification, two real bugs found and fixed, frontend↔backend wiring

The Docker blocker from earlier is resolved — the daemon's host-side
bridge was stuck even though the VM underneath it was still alive (a
`docker ps`/raw socket `curl` both hung with zero response, while the VM's
own console log showed it actively serving other requests); a full quit
and relaunch of Docker Desktop fixed it. Confirmed before and after that
the unrelated `merchant-platform-lab-postgres-1` container and all
existing volumes (including another project's, `ark-outreach-os_*`) were
untouched — it auto-restarted on its own `restart: unless-stopped` policy.

Brought up `trace-postgres-1` (port 5433, its own volume, nothing shared
with other projects), ran the initial migration, and seeded the database
— all for real, against a live Postgres:

```
npx prisma migrate dev --name init   # 20261018225434_init
npx tsx prisma/seed.ts                # Acme Corp, 3 departments, 7 developers, 1 dev API key
```

Then booted the real compiled server (`node dist/main.js`) against that
database and drove it with `curl` through every flow:

- **Organizations**: `GET /organizations/me` (+ `/departments`, `/developers`)
  returned the real seeded rows; a request with no `Authorization` header
  correctly got `401`.
- **GitHub sync**: connected a fake installation via
  `POST /github/installations`, then — newly added `POST
  /github/installations/:id/sync` (this endpoint didn't exist before;
  `GithubSyncService` had no caller) — ran a real sync against
  `MockGithubApiClient`.
- **Telemetry**: posted 7 days of baseline `openai` usage plus a deliberate
  24h spike (80 requests, 30 errors) via `POST /telemetry/api-usage`, then
  confirmed `GET /telemetry/summary` and `/telemetry/trend` aggregated
  correctly (150 total requests, $0.30, trend bucketed by day exactly as
  posted). Also confirmed `actorType: "verified"` without a `developerId`
  correctly rejects with `400`.
- **Security detection**: `POST /security/alerts/run` against that same
  data correctly produced an `api_usage_spike` (HIGH) and an
  `elevated_api_error_rate` (MEDIUM) alert, each with accurate evidence
  numbers; running detection again produced zero new alerts (dedup
  working); `PATCH /security/alerts/:id/status` and the `?status=` filter
  on `GET /security/alerts` both worked correctly.

**Two real bugs found this way — neither one the mocked unit tests could
have caught, which is exactly why this pass mattered:**

1. **BigInt JSON serialization crash.** `POST /github/installations`
   500'd immediately — Prisma returns `BigInt` for the schema's
   `installationId`/`githubId` columns, and neither `JSON.stringify` nor
   Express's `res.json()` know how to serialize a `BigInt`. Fixed with
   the standard `BigInt.prototype.toJSON` override in `main.ts`
   (rendering as a numeric string — using `number` would risk precision
   loss on GitHub's real id range).
2. **Wrong dedup scope on `ActivityEvent`.** Syncing two repositories
   produced 3 activity events instead of 6 — GitHub's mock (and, for pull
   requests, *real* GitHub data too) can have the same commit sha or PR
   `number` show up under more than one repository, but the old unique
   constraint was `(organizationId, type, externalId)` with no
   `repositoryId`, so the second repo's events silently overwrote the
   first's via upsert. A PR number is only unique *within its own
   repository*, never organization-wide, so this wasn't just a mock-data
   quirk — it was a real design bug. Fixed by widening the constraint to
   `(organizationId, repositoryId, type, externalId)` (migration
   `20261018225858_fix_activity_event_dedupe_scope`, generated via
   `prisma migrate diff` + applied via `prisma migrate deploy`, since
   `migrate dev`'s interactive confirmation can't run in this
   environment) and updating `GithubSyncService` to match. Re-verified:
   syncing twice now correctly produces 6 events with no duplicates.
   Added `github-sync.service.spec.ts` (5 tests, including a direct
   regression test for this exact scenario) — this class had no unit
   test before, which is exactly why the bug reached live testing instead
   of being caught earlier.

**Frontend ↔ backend communication**, added and verified live in both
directions:
- `apps/web/app/api/backend-status/route.ts` — a Next.js Route Handler
  (server-only; `TRACE_API_KEY` never reaches the browser bundle) that
  calls the backend's authenticated `/organizations/me` endpoints and
  returns a sanitized `{connected, organizationName, developerCount}` /
  `{connected: false, reason}`.
- `components/BackendStatusBadge.tsx` — a small client-side badge in the
  header showing that status. **Does not change the graph's data
  source** — `OrgGraph` still reads `lib/data.ts` exactly as before, so
  existing functionality is untouched regardless of backend availability.
- Verified with a real browser (Playwright, headed through `node -e`)
  in both states: backend running → badge read *"Backend connected —
  Acme Corp (7 developers)"* with real data from the live database;
  backend stopped → badge read *"Backend offline — showing local demo
  data"* and the graph still rendered correctly from mock data. Added a
  permanent e2e test for this that deliberately doesn't assert which
  state it's in (most future contributors won't have the backend
  configured) — only that the badge renders and the graph is unaffected
  either way.

**Verified overall:** full `lint`/`typecheck`/`test`/`build` across all
three workspaces still pass (`apps/api` now at 57 Jest tests, `apps/web`'s
Playwright suite now at 8). The backend server was left running against
the live database at the end of this session; the frontend dev server
was stopped. To pick back up: `docker compose up -d postgres` (if not
already up), `cd apps/api && node dist/main.js`, `cd apps/web && npm run
dev`.

### NestJS backend scaffold (`apps/api`)

Added a minimal NestJS app to the workspace: `main.ts` bootstrap with a
global `ValidationPipe`, `AppModule` wiring `ConfigModule`, and a
`HealthModule` (`GET /health`) with a unit test.

**Dependency note:** NestJS v12 ships `@nestjs/testing` (and presumably the
rest of the v12 family) as ESM-only (`"type": "module"`), which breaks under
our CommonJS ts-jest setup (`Must use import to load ES Module`). Converting
the whole backend to ESM (NodeNext module resolution, `.js`-suffixed
relative imports, ESM-mode Jest) was the "correct" long-term fix but adds
real ceremony for a day-one scaffold. Pinned to **NestJS v11.2.7** instead
(current, non-deprecated, confirmed CommonJS) to keep the toolchain simple;
revisit the ESM migration later as a deliberate, isolated piece of work if
the project wants to track NestJS's latest major.

Root scripts (`lint`/`typecheck`/`test`/`build`) fan out to every workspace
via `--workspaces --if-present`, so `apps/api` needed no CI workflow changes
beyond adding a `test` step (there was none before, since `apps/web` has no
test suite yet).

**Verified (clean-room, from `npm ci` at the repo root):**
- `npm run lint` — clean (both `apps/api` and `apps/web`).
- `npm run typecheck` — clean (both workspaces).
- `npm run test` — `apps/api`'s one Jest suite passes; `apps/web` has no
  tests yet so this is a no-op there.
- `npm run build` — both workspaces build successfully.
- Ran the compiled `dist/main.js` directly and `curl`'d `GET /health` ->
  `200 {"status":"ok","timestamp":"..."}`. This is a real process start and
  a real HTTP round-trip, not just a passing compile.
- Confirmed `apps/web` is untouched and still builds/serves correctly.

**Environment note:** local disk space was critically low (459MB free)
before this work, which made `npm install` fail with `ENOSPC`. Freed ~3.5GB
by clearing the npm cache and Docker's build cache (both pure, regenerable
caches — no project or user data touched) before continuing.

### Data model, org-scoped auth, and GitHub integration module

Added `apps/api/prisma/schema.prisma` (see the file for the full model —
Organization, Department, Developer, ApiKey, GithubInstallation,
Repository, ActivityEvent, ApiUsageEvent, SecurityAlert) and
`docker-compose.yml` at the repo root (Postgres on host port 5433, chosen
to avoid clashing with an unrelated Postgres container already running
locally on 5432 for a different project — never touched that container).

**Dependency note:** `prisma`/`@prisma/client` latest (7.x) removed the
conventional `datasource { url = env("DATABASE_URL") }` schema syntax in
favor of a separate `prisma.config.ts` plus a driver-adapter package passed
to the `PrismaClient` constructor. Same judgment call as the NestJS v12
issue above: pinned to **Prisma 6.19.3** (current, non-deprecated) to keep
one `url = env(...)` line instead of adding a second config file and an
adapter dependency for a day-one schema.

Built:
- `OrgApiKeyGuard` — resolves the calling organization strictly from a
  bearer API key (hashed, never stored raw); the organization id is never
  accepted as client input anywhere, which is what makes cross-org access
  structurally impossible rather than just checked-for.
- `OrganizationsModule` — `GET /organizations/me`, `/me/departments`,
  `/me/developers`, all guarded and scoped to the caller's own org.
- `GithubModule` — `GithubApiClient` interface with two implementations
  (`MockGithubApiClient` for local dev, `OctokitGithubApiClient` for the
  real API via `@octokit/rest` + `@octokit/auth-app`); `GithubSyncService`
  maps repositories/commits/pull requests into `Repository`/`ActivityEvent`
  rows, attributing a developer only on an exact `githubLogin` match
  (never a fuzzy guess); `POST /github/installations` lets an authenticated
  org connect an installation it completed on GitHub's side;
  `POST /webhooks/github` verifies `X-Hub-Signature-256` (HMAC-SHA256,
  timing-safe compare) before processing anything and currently acts only
  on `ping` and `installation.deleted` — other event types are
  acknowledged but not yet processed (tracked below, not silently ignored).

**Verified:**
- `npm run typecheck` / `lint` / `test` / `build` all pass (22 Jest tests:
  the guard's authorization behavior including "never trusts a
  client-supplied org id", the organizations service's query scoping, the
  webhook signature verifier against valid/tampered/wrong-secret/
  malformed-length signatures, and the webhook controller's event
  routing).
- **NOT verified:** an actual `prisma migrate dev` against a live
  database, the seed script, or a real GitHub API/webhook round-trip.
  Docker's daemon became unresponsive partway through this session (see
  below) before migrations could be run — this is the next thing to do
  once Docker is working again.

**Environment blocker encountered:** after the disk-space issue above was
resolved and Postgres was brought up once successfully, the Docker daemon
stopped responding to `docker ps`/`docker compose` entirely (commands hung
indefinitely, no error). Did not force-restart Docker Desktop to fix this,
because doing so would also stop an unrelated Postgres container
(`merchant-platform-lab-postgres-1`) already running on this machine for a
different project — that's not this session's call to make unilaterally.
**If you're reading this to resume: restart Docker Desktop (or tell me to),
then run `docker compose up -d postgres`, `npm run prisma:migrate
--workspace apps/api`, and `npm run prisma:seed --workspace apps/api`
from the repo root, and the rest of this plan can proceed to a real
end-to-end verification.**

### API telemetry SDK and ingestion/aggregation endpoints

Added `packages/telemetry-sdk` (new `packages/*` workspace glob at the
root) — a zero-runtime-dependency `TraceTelemetryClient` that POSTs API
usage metadata to `apps/api`'s new `TelemetryModule`. Its `ApiUsageReport`
type has no field for API keys, prompt text, or response bodies at all,
so misuse in that direction is a compile error, not just a documented
rule. `actorType` ("verified" | "inferred" | "unknown") is required on
every report — there's no default that could silently overstate how
confident an attribution is.

Backend side: `POST /telemetry/api-usage` (validates the report, rejects
`actorType: "verified"` without a `developerId`, rejects a `developerId`
that doesn't resolve inside the caller's own organization), `GET
/telemetry/summary` (per-provider totals), `GET /telemetry/trend` (daily
request/cost totals over a lookback window, bucketed in application code
rather than a raw SQL date-trunc query — simpler to keep correct without a
live database to test a raw query against; revisit if usage volume ever
makes the in-memory bucketing too costly).

**Verified:** `npm run lint`/`typecheck`/`test`/`build` all pass across
all three workspaces (`apps/web`, `apps/api`, `packages/telemetry-sdk`)
from a clean `npm ci` at the root — 34 Jest tests total (5 new for the SDK
itself: request shape, trailing-slash handling, ISO date serialization,
error-on-non-2xx, success-on-2xx; 5 new for `TelemetryService`: default
values, the two authorization-adjacent rejections above, provider summary
aggregation and sorting, and daily trend bucketing across a day boundary).
**NOT verified:** these endpoints have never received a request from a
real NestJS HTTP server or a live database — all tests mock `PrismaService`
and `fetch`. See "Known limitations" / the Docker blocker above.

### Deterministic security alert rule engine

Added `apps/api/src/security`: a `SecurityRule` interface and three
implementations, each computing only from data already in our own
database (no dependency on GitHub's audit log API, which most accounts
can't call anyway):

- `ApiUsageSpikeRule` — a provider's last-24h request volume vs. its own
  trailing 7-day daily average.
- `ElevatedApiErrorRateRule` — a provider's last-24h error rate.
- `UnusualCommitVolumeRule` — a developer's last-24h commit count vs.
  their own trailing 13-day average.

Every finding carries `reason` and `recommendedSteps` written as "worth a
human look," never as an accusation — per the explicit requirement not to
label anyone malicious from a statistical anomaly alone.
`SecurityDetectionService.runDetection` runs all registered rules for an
org and persists findings as `SecurityAlert` rows, skipping a finding if
an equivalent alert (same type + developer scope) is already `OPEN` within
a 24h dedupe window, so re-running detection doesn't spam duplicates.
`SecurityAlertsController` exposes `GET /security/alerts`,
`POST /security/alerts/run` (manual trigger — there is no scheduler; see
upcoming work), and `PATCH /security/alerts/:id/status`.

**Full dependency-injection graph verified end-to-end:** built `apps/api`
and ran the compiled server directly. Every module (Health, Organizations,
Github, Telemetry, Security) initialized and every route mapped
correctly; the *only* failure was `PrismaClientInitializationError: Can't
reach database server at localhost:5433` — i.e. the sole remaining gap is
the live database connection (blocked on the Docker issue below), not
anything in the application wiring itself.

**Verified:** typecheck/lint/build clean; `apps/api` is now at 52 passing
Jest tests total (23 new in this change: 18 for the three rules'
threshold/severity math, 5 for the detection service's dedupe logic and
rule aggregation).

### Playwright end-to-end tests for the existing graph UI

Added `apps/web/e2e/org-graph.spec.ts` (7 tests) against a real Chromium
browser driving a real `next dev` server — these are genuine browser
interactions, not mocked. Added small `data-testid` attributes to
`EntityNode` and `DetailPanel` (invisible, behavior-preserving) so
selectors don't depend on fragile text/DOM-structure matching. Covers:
initial render (header, stats row, root/department/developer nodes,
metric leaves correctly collapsed by default), expanding/collapsing a
developer to reveal its GitHub/API/Security leaves, collapsing/expanding
a department to hide/show its developers, opening and closing the detail
panel, the activity-level filter, the metric-kind visibility toggle, and
the JSON Canvas export (via a real Playwright download event).

One real failure was caught and fixed during this work: the first draft
of the "renders the header" test used `getByText("TRACE")`, which matched
both the header and an unrelated body string containing "TRACE" and threw
a strict-mode violation — fixed by scoping to the header's role instead.
That's the kind of thing this suite exists to catch.

**Run locally** with `npm run test:e2e --workspace apps/web` (needs
Chromium installed once via `npx playwright install chromium` inside
`apps/web`). **Deliberately not wired into CI yet** — the script is named
`test:e2e`, not `test`, specifically so the root `test` fan-out (and
`.github/workflows/ci.yml`) doesn't pick it up; adding it there would
need a browser-install step added to the workflow, which is real added
CI complexity/time that wasn't asked for. Tracked as upcoming work below.

**Verified:** all 7 tests pass against a real server + real browser (run
twice: once that caught the failure above, once clean after the fix).
Full repo-wide `lint`/`typecheck`/`test`/`build` across all three
workspaces still pass after these additions.

### Fixed: missing seed script

Caught during a self-review pass: `apps/api/package.json`'s
`prisma:seed` script (`tsx prisma/seed.ts`) pointed at a file that was
never actually created — a leftover from the very first backend-scaffold
commit. Wrote `apps/api/prisma/seed.ts`: Acme Corp org, the same three
departments and seven developers apps/web/lib/data.ts already uses (so a
demo of the real backend lines up with the frontend's existing mock
data), and one local-dev API key (printed once on first run — its hash,
not the raw key, is what's stored; re-running seed detects the existing
key and doesn't print a key you can no longer retrieve). Two developers'
`githubLogin` match `MockGithubApiClient`'s sample commit authors, so a
sync run against the mock client (the default with no real GitHub App
configured) demonstrates real developer attribution without needing live
GitHub credentials. Every write is an upsert, safe to re-run. Also
widened `apps/api`'s lint script to cover `prisma/**/*.ts`, which it had
been silently skipping.

**Verified:** typecheck/lint/test/build all still pass. **NOT verified:**
actually running this script, which needs the live database that's still
blocked — see below.

<!-- New entries go above this line -->

## Known limitations (be honest about these)

- **No test against the real GitHub API.** The sync pipeline (connect →
  sync → database writes → attribution) is now verified end-to-end
  against a live database — but only through `MockGithubApiClient`, since
  no GitHub App ID/private key/webhook secret is configured anywhere in
  this environment. `OctokitGithubApiClient` and the webhook signature
  path have never run against github.com or a real installation. Treat
  the *pipeline* as verified and the *live GitHub connection* as
  "implemented, needs a real App registration to validate."
- **No production authentication system.** Org-scoped authorization in the
  backend currently uses a development-only mechanism (see the relevant
  module's code/tests for exactly what) until a real auth provider is wired
  up. Do not deploy this as-is.
- **Docker Compose Postgres is for local development only.** It is not a
  production database configuration (no backups, no TLS, a throwaway
  password in `.env.example`).
- **API cost estimation is illustrative**, based on simple per-request/token
  heuristics documented in the telemetry module, not live provider pricing
  APIs.
- **No API-key management endpoint.** `ApiKey` rows (what `OrgApiKeyGuard`
  authenticates against) can currently only be created by the seed script
  or a direct database write — there is no API to create, list, or revoke
  one yet. Fine for local dev/demo; a real onboarding flow needs this.
- **CORS is wide open** (`app.enableCors()` with no allowlist) and there is
  no rate limiting anywhere, including on the webhook and telemetry
  ingestion endpoints. Both are explicitly fine for local development,
  not for any real deployment.

## Upcoming work (not started)

- Activity timelines.
- Real GitHub App registration and end-to-end validation against the
  actual GitHub API once credentials are available (the sync pipeline
  itself is now verified against a live database — see above — just not
  against github.com).
- Adding the Playwright e2e suite to CI (needs a browser-install step in
  the workflow — deliberately not done yet, see the log entry above).
- A scheduler for GitHub sync and security detection (both currently
  manual-trigger-only endpoints — see their controllers' doc comments).
