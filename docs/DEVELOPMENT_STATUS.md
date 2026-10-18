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
npm run build        # verifies everything still compiles
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
      SecurityAlert) + Docker Compose Postgres config — **schema and client
      generation verified; migrations NOT yet run against a live database.
      See "Known limitations."**
- [x] Organizations/developers module with org-scoped authorization
      (`OrgApiKeyGuard` — see log below), unit-tested
- [x] GitHub integration module (Octokit-based sync + webhook signature
      verification + a "connect installation" endpoint) — **note:** no real
      GitHub App credentials exist in this environment, so this is
      implemented and unit-tested against mocked GitHub API responses /
      hand-constructed webhook payloads, not exercised against the live
      API. See "Known limitations" before claiming this works end-to-end.
- [x] API telemetry ingestion SDK + aggregation endpoints (see log below)
- [ ] Deterministic security alert rule engine
- [ ] Playwright tests for the existing graph UI

This list is updated as each item lands; see the detailed log below for
what's actually been verified so far.

## Detailed log

Entries are appended chronologically, newest first. Each entry says exactly
what was verified and how.

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

<!-- New entries go above this line -->

## Known limitations (be honest about these)

- **No live GitHub integration test.** The GitHub sync/webhook code is real
  and unit-tested, but has never been run against GitHub's actual API or a
  real GitHub App installation, because no App ID/private key/webhook secret
  is configured anywhere in this environment. Treat it as "implemented,
  needs a real App registration to validate end-to-end" — not "working."
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

## Upcoming work (not started)

- Wiring `apps/web` to read from `apps/api` instead of static mock data
  (with graceful fallback to mock data if the API is unreachable, so the
  existing frontend never regresses).
- Repository analytics dashboard, API usage dashboard, security alert
  dashboard views reachable from the graph (per the product vision, these
  should be graph-driven, not disconnected pages).
- Activity timelines.
- Real GitHub App registration and end-to-end validation once credentials
  are available.
- Wiring a `test` step into CI once there's a meaningful test suite to run
  there (currently CI runs lint/typecheck/build only).
