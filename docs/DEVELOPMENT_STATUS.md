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

- [ ] `apps/api` — NestJS backend scaffold
- [ ] Prisma schema + PostgreSQL via Docker Compose (local dev only)
- [ ] Organizations/developers module with org-scoped authorization
- [ ] GitHub integration module (Octokit-based sync + webhook signature
      verification) — **note:** no real GitHub App credentials exist in this
      environment, so this is implemented and unit-tested against mocked
      GitHub API responses, not exercised against the live API. See the
      "Known limitations" section below before claiming this works end-to-end.
- [ ] API telemetry ingestion SDK + aggregation endpoints
- [ ] Deterministic security alert rule engine
- [ ] Playwright tests for the existing graph UI

This list is updated as each item lands; see the detailed log below for
what's actually been verified so far.

## Detailed log

Entries are appended chronologically, newest first. Each entry says exactly
what was verified and how.

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
