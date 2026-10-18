# TRACE — Web (Phase 1)

The Next.js frontend for TRACE. See the [repository root README](../../README.md)
for the full project overview, roadmap, and security principles — this file
covers only what's specific to this app.

## Running locally

This app is part of an npm workspaces monorepo — see the
[root README](../../README.md) to install from the repository root. To run
just this app directly:

```bash
npm install
npm run dev
```

Open http://localhost:3000. The page auto-updates as you edit files under
`app/`, `components/`, or `lib/`.

## Layout

- `app/page.tsx` — renders the `OrgGraph` component; this is the entire app.
- `components/OrgGraph.tsx` — owns graph state (selection, filters,
  collapsed branches, dragged positions) and renders React Flow.
- `components/nodes/EntityNode.tsx` — the custom node renderer for every
  entity kind (organization, department, developer, github, apiUsage,
  security).
- `components/DetailPanel.tsx`, `FilterBar.tsx`, `StatsRow.tsx` — the
  surrounding UI chrome.
- `lib/types.ts` — the `OrgEntity` union that every node's data conforms to.
- `lib/data.ts` — simulated org data for Phase 1.
- `lib/layout.ts` — positions the tree (no external layout library needed).
- `lib/stats.ts` — derives the stats row's totals and top contributors.
- `lib/visibleEntities.ts` — applies collapse/filter state to the full data
  set to produce the entities currently on screen.
- `lib/jsonCanvas.ts` — exports the graph as an open
  [JSON Canvas](https://jsoncanvas.org) `.canvas` file.

## Scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm run start       # run a production build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```
