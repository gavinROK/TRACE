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

## Features (Phase 1)

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

## Installation

Requirements: **Node.js 20+** and npm.

```bash
git clone https://github.com/<your-org>/TRACE.git
cd TRACE
npm install   # installs all workspaces (apps/web today; future apps/api too)
npm run dev   # starts the web app at http://localhost:3000
```

The repository root is an **npm workspaces** monorepo, so a single
`npm install` at the root installs every app under `apps/`. Per-app commands
can still be run directly (e.g. `cd apps/web && npm run dev`), or from the
root via `npm run <script> --workspace apps/web`.

Root-level scripts (each fans out to every workspace that defines the script):

```bash
npm run dev        # starts apps/web's dev server
npm run build       # production build of every app
npm run lint        # ESLint across every app
npm run typecheck   # tsc --noEmit across every app
```

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

## Technology

- **Frontend:** Next.js, TypeScript, React, Tailwind CSS, React Flow
- **Backend (Phase 2+):** NestJS, TypeScript
- **Database (Phase 2+):** PostgreSQL, Prisma
- **Dev tooling:** npm workspaces, GitHub Actions CI, Docker Compose (added
  in Phase 2), Git

## Development roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Next.js + React Flow org graph, simulated data | ✅ Done |
| 2 | NestJS backend + PostgreSQL + Prisma | Not started |
| 3 | GitHub integration | Not started |
| 4 | Developer activity analytics | Not started |
| 5 | API telemetry | Not started |
| 6 | Security event detection | Not started |

Each phase is implemented, verified (lint, type-check, build, and manual
testing), and documented before the next one begins.

## Continuous integration

Every pull request runs lint, type-check, and a production build via
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Security principles

TRACE is designed around a few hard rules that apply to every phase:

- No credentials, private message content, or browser activity are ever
  collected.
- Integrations (GitHub, etc.) must be explicitly authorized by the
  organization.
- Secrets and API tokens are never placed in frontend code — they live only
  in the backend, added in Phase 2.

## License

[MIT](LICENSE)

## Contributing

This project is built in stages (see the roadmap above). Each phase is
implemented, verified, and documented before the next one begins.
