# TRACE

TRACE is an open-source developer intelligence and cybersecurity monitoring
platform. It visualizes an organization — its departments, developers, and
their GitHub activity, API usage, and security events — as an interactive,
branching node graph inspired by [Obsidian Canvas](https://obsidian.md/canvas)
and built on the open [JSON Canvas](https://jsoncanvas.org) specification.

TRACE does not copy or depend on any proprietary Obsidian code.

## Status: Phase 1 complete

Phase 1 delivers a fully working **frontend-only** prototype: a Next.js app
with an interactive org graph driven by realistic simulated data. There is no
backend, database, or real integration yet — those arrive in later phases.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Next.js + React Flow org graph, simulated data | ✅ Done |
| 2 | NestJS backend + PostgreSQL + Prisma | Not started |
| 3 | GitHub integration | Not started |
| 4 | Developer activity analytics | Not started |
| 5 | API telemetry | Not started |
| 6 | Security event detection | Not started |

## What's in Phase 1

- **Interactive org graph** — Organization → Department → Developer →
  GitHub / API Usage / Security metrics, rendered with
  [React Flow](https://reactflow.dev).
- **Expand/collapse branches**, drag nodes, zoom/pan, and a minimap.
- **Detail panel** — click any node to see its details and children.
- **Filter bar** — filter developers by activity level, toggle which metric
  types (GitHub/API/Security) are shown, expand/collapse everything at once.
- **Stats row** — org-wide totals and a top-contributors chart.
- **JSON Canvas export** — the "Export JSON Canvas" button downloads the
  current graph as a `.canvas` file conforming to the open spec, so it can be
  opened in any compatible tool.
- **Professional dark theme** built with Tailwind CSS.

All data in Phase 1 (`apps/web/lib/data.ts`) is simulated — no real GitHub,
API, or security data is collected.

## Project structure

This is a monorepo laid out as a modular monolith (no microservices):

```
apps/
  web/            Next.js frontend (Phase 1 — implemented)
  api/            NestJS backend (Phase 2 — not yet created)
```

Inside `apps/web/`:

```
app/              Next.js App Router entry point
components/       OrgGraph, DetailPanel, FilterBar, StatsRow, node renderers
lib/              Domain types, simulated data, layout, stats, JSON Canvas
```

## Running locally

Requirements: Node.js 20+.

```bash
cd apps/web
npm install
npm run dev
```

Then open http://localhost:3000.

> **Turbopack note:** `next dev`/`next build` use Turbopack by default in
> this Next.js version. On some local setups the Turbopack CSS pipeline can
> fail to spawn its worker process (an `Operation not permitted` /
> port-binding error, unrelated to this project's code). If you hit that,
> fall back to webpack:
> ```bash
> npm run dev -- --webpack
> npm run build -- --webpack
> ```

Other commands (run from `apps/web/`):

```bash
npm run build   # production build
npm run lint    # ESLint
npx tsc --noEmit  # type-check
```

## Technology

- **Frontend:** Next.js, TypeScript, React, Tailwind CSS, React Flow
- **Backend (Phase 2+):** NestJS, TypeScript
- **Database (Phase 2+):** PostgreSQL, Prisma
- **Dev tooling:** Docker Compose (added in Phase 2), Git

## Security principles

TRACE is designed around a few hard rules that apply to every phase:

- No credentials, private message content, or browser activity are ever
  collected.
- Integrations (GitHub, etc.) must be explicitly authorized by the
  organization.
- Secrets and API tokens are never placed in frontend code — they live only
  in the backend, added in Phase 2.

## Contributing

This project is built in stages (see the phase table above). Each phase is
implemented, verified, and documented before the next one begins.
