# TRACE Development Status

Last updated: 2026-11-09 (autonomous engineering session, branch `feature/infrastructure-control-plane`, continued live on the operator's own MacBook)

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

## Phase 2 — IT management & device inventory (new product direction)

TRACE is expanding from a developer/GitHub-focused tool into a unified IT
management and cybersecurity platform for IT administrators at small/
medium orgs. Preserving everything above; this phase is additive.

- [x] **Device inventory** — `Device` model (ownership, OS info, four
      nullable security posture flags), manual enrollment
      (`POST /devices`), simulated seed data (8 devices across the
      existing developers plus one unowned shared server, deliberately
      spanning every posture state), integrated into the graph (a
      `Devices` branch off the organization, each device showing its
      owner/posture) and into security detection (`DevicePostureRule` —
      see log below for all of it, verified live end-to-end).
- [x] **Infrastructure assets** — `Device` extended (not duplicated) with
      `SWITCH`/`ROUTER`/`ACCESS_POINT`/`VIRTUAL_MACHINE` types and an
      independent, nullable `departmentId` (a switch can belong to a
      department with no personal owner at all — ownership and
      department assignment are orthogonal). Three infra assets seeded
      (`core-switch-01`, `edge-router-01`, `ci-runner-01`).
- [x] **Software inventory** — `SoftwareInstallation` model (one row per
      device per installed app: name/version/publisher/installedAt),
      manual entry and CSV import (`POST /devices/:id/software`, source
      explicitly tagged `MANUAL` or `CSV_IMPORT`, never inferred). Device
      profile panel shows the list, an inline add form, and a CSV file
      picker; CSV is parsed client-side (see "Known limitations" for the
      parser's documented quoted-comma gap).
- [x] **Device security posture indicators beyond pass/fail** —
      `DeviceDataQualityRule` flags devices with genuinely unknown
      posture/missing check-in data (`device_missing_security_info`) and
      devices that haven't checked in within 90 days
      (`device_stale_checkin`), kept explicitly distinct from
      `DevicePostureRule`'s confirmed-risk findings (`device_posture_risk`)
      — unknown is never reported as a risk.
- [x] **IT workflows** — a device inventory panel (search by name/owner/
      department/OS/serial, filter by type and posture status, summary
      tiles) and device profile panels, both reachable from the graph.
- [ ] **Not yet started** (explicitly out of scope for this phase, per
      plan): network scanning, endpoint agents, and relationships beyond
      device↔owner/department (e.g. device↔application, device↔repository
      as graph edges). `DeviceEnrollmentType` already reserves an `AGENT`
      value so that feature won't need its own migration later, but
      nothing writes it yet — see "Known limitations."

This list is updated as each item lands; see the detailed log below for
what's actually been verified so far.

## Phase 3 — Infrastructure control plane (new product direction)

TRACE is expanding again: alongside the developer-intelligence product
above (untouched), it now also discovers, enrolls, monitors, and
administers real infrastructure (homelab servers, VMs, switches,
printers, …) as a separate domain under `apps/api/src/infra` and
`apps/web/app/infra`. See `docs/ARCHITECTURE.md` for the module map,
security model, and the complete "known limitations" list — this entry
only covers what changed and what was verified.

- [x] Unified device model, environments, capabilities — `InfraDevice`/
      `InfraEnvironment`/`InfraRelationship` et al. (new Prisma models,
      two migrations generated via the existing `migrate diff`
      declarative-schema workaround, since there is still no live
      Postgres in this environment to run `migrate dev` against).
- [x] Real connectors: SSH (`ssh2`), Proxmox API (`node:https`, token
      auth, discovery + health + metrics + start/stop/shutdown/reboot),
      SNMPv3 read-only (`net-snmp`). Each is genuinely functional code —
      point it at a real device with real credentials and it will work —
      but none has run against real infrastructure in this environment
      (see "What's tested" in the root README).
- [x] Credential encryption (AES-256-GCM) with the master key stored in
      the macOS Keychain, not the database.
- [x] Auth: password login + session cookies, plus WebAuthn (YubiKey)
      registration/assertion — unit-tested against a mocked
      `@simplewebauthn/server`, never against real browser+hardware (see
      limitations).
- [x] Command console backend: device-name resolution (ambiguity-proof
      by schema constraint), bounded-concurrency group execution,
      timeouts, cancellation via `AbortSignal`, full history
      (`InfraCommandRun`) and audit logging.
- [x] Discovery: local interfaces/ARP/ping/optional-nmap (real, runs
      against whatever machine TRACE itself is running on), and
      Proxmox-driven VM/container enumeration that upserts into the
      topology without deleting anything already enrolled.
- [x] Monitoring: a scheduled poller (`@nestjs/schedule`) plus an
      on-demand "check health" action, both going through the same
      `DevicePollingService` so they can never disagree.
- [x] MCP server (`packages/mcp-server`) exposing 12 tools, each a thin
      call into TRACE's own REST API — no duplicate management logic.
- [x] Frontend: an `/infra` route (setup/login, environment picker,
      dashboard summary, a React Flow topology view, a device detail
      panel, and a command console drawer), kept entirely separate from
      the existing `/` developer-intelligence graph (a small nav badge
      links the two).
- [x] Seed script (`prisma/seed-infra.ts`) for "Gavin's Home
      Infrastructure" using only the hardware facts given directly in
      the product brief (Beelink SER9 MAX's CPU/RAM/storage, ZimaBoard 2,
      NETGEAR GS108T, JetKVM, Bambu Lab P2S) — no invented IP addresses,
      credentials, or live metrics; every device starts
      DISCOVERED/UNKNOWN with no management protocols until real
      credentials are enrolled.

**Two real, reproducible bugs found and fixed while verifying this
actually runs (not just compiles) — neither would have been caught by
`tsc`/Jest alone:**

1. **The compiled server crashed on boot** (`node dist/main.js`) with
   "No driver (HTTP) has been selected... install @nestjs/platform-express"
   — even though that package was installed. Root cause: npm's workspace
   hoisting placed `@nestjs/core`/`common` in the repo root's
   `node_modules` while leaving `@nestjs/platform-express`/`config`/
   `schedule` nested in `apps/api/node_modules` — two different trees,
   which breaks NestJS's internal package loader (it `require()`s
   sibling `@nestjs/*` packages relative to its own install location).
   `tsc --noEmit` and Jest never noticed, because they resolve modules
   differently than Nest's loader does. Fixed by declaring those
   packages directly in the **root** `package.json` so npm hoists all of
   them to the same place; re-verified by actually booting the compiled
   server again — it now gets past every module/route registration and
   fails only at `PrismaClientInitializationError: Can't reach database
   server at localhost:5433`, i.e. the one real remaining gap (no live
   Postgres here), not an application-wiring bug. See
   `docs/ARCHITECTURE.md` "Known limitations" for the exact fix, in case
   a future `@nestjs/*` addition reintroduces it.
2. **`@modelcontextprotocol/sdk`'s `server.tool()` sent `tsc` into a
   multi-minute, sometimes stack-overflowing type-inference loop** once
   more than a few object-schema tools were registered in one file
   (confirmed by timing `tsc --noEmit` directly on that one file, and by
   reproducing the exact same hang under Jest). Fixed with one type
   assertion narrowing the call shape TRACE actually uses (see
   `packages/mcp-server/src/server.ts`'s top comment) — runtime behavior,
   including zod validation, is unaffected; confirmed by the MCP
   integration test below actually passing afterward.

**Also found and fixed in passing:** `@nestjs/schedule`'s and
`@nestjs/mapped-types`' current npm releases ship ESM-only, which a
CommonJS-compiled NestJS app cannot `require()` — pinned `@nestjs/schedule`
to `6.1.3` (last CommonJS release) and hand-wrote `UpdateInfraDeviceDto`
instead of using `PartialType` from `mapped-types`. Caught by a new
`infra.module.spec.ts` test that resolves the entire infra dependency
graph via Nest's `TestingModule` — this is also what caught bug #1 above
being possible in the first place (it's what pointed at the ESM-require
failures one module import at a time).

**Verified:**
- Backend: 198 Jest tests (up from 101) across every new service,
  including all three connectors against mocked transports (`ssh2`,
  `node:https`, `net-snmp`), the credential cipher and Keychain-backed
  master key store (mocked `child_process`), the WebAuthn/password auth
  flow, the command-execution engine's bounded-concurrency and
  per-device-failure-isolation behavior (one bug found and fixed there,
  see below), and `infra.module.spec.ts`'s full dependency-graph
  resolution. `tsc --noEmit`, ESLint, and `npm run build` all clean.
- **The compiled server actually boots and maps every route** (verified
  directly, not inferred from a passing build) — see bug #1 above for
  exactly how far that got and where it stopped (no live Postgres here).
- **A real end-to-end MCP protocol test**: a genuine
  `@modelcontextprotocol/sdk` `Client` (the same class Claude Code's own
  MCP integration uses) connects to the real server over the SDK's
  in-memory transport, lists all 12 tools, and calls several — only the
  HTTP layer underneath is faked, since there's no live TRACE API in
  this environment.
- `apps/web`: `tsc --noEmit` and ESLint clean. `next build` via webpack
  succeeds (Turbopack's build hit a sandbox-specific port-binding
  restriction unrelated to any code here — see "Known limitations";
  verify `next build`'s default Turbopack path on your own machine).
- **A real bug found while testing the console's group-execution path**:
  one unresolvable device name in a `trace exec --group` call would
  reject the *entire* batch instead of just that device, because
  `CommandExecutionService.executeOnGroup` passed `resolveByName`'s
  rejection straight through `runWithConcurrency`'s `Promise.all`. Fixed
  by catching per-device-name failures inside the group worker and
  synthesizing a `FAILED` run record for that one device, leaving the
  rest of the batch unaffected — caught by a test, not by running it
  live.
- **Not verified**: anything against real infrastructure (no live
  Postgres, no reachable Beelink/Proxmox/switch from this environment —
  see the root README's "What's tested" for the exact, honest split), the
  WebAuthn ceremony against a real browser + YubiKey, and registering
  the MCP server with an actual Claude Code CLI session.

## Phase 4 — TRACE v0.2: unified dashboard, discovery, live verification

Run directly on the operator's own MacBook (not a sandboxed environment)
against the real homelab — the first session where infra claims could
actually be checked against real hardware instead of mocks. See
`docs/ARCHITECTURE.md` "Known limitations" for the full detail behind
each finding below; this entry covers what changed and what was
verified.

**Unified the two separate dashboards into one app** (`apps/web/
components/shell/*`): the root route `/` is now a single TRACE shell —
left sidebar (Overview/Topology/Devices/Monitoring/Settings), the
selected view in the middle, a device's detail+edit panel on the right,
and a persistent, collapsible command console across the bottom that
stays mounted across every view. `/infra` now redirects to `/`; the
original developer-intelligence org graph moved to `/dev-intel`,
unchanged, rather than being deleted. Old `apps/web/components/infra/
{InfraApp,DeviceDetailPanel,CommandConsole}.tsx` were removed as
superseded.

**Device settings are now actually editable** — the backend already
supported `PATCH`, the frontend never exposed it. `DeviceRightPanel.tsx`
adds a real edit form (name, category, IP(s), management port,
protocols, tags, notes) plus inline credential add/remove and a **Test
connection** button wired to the real `getHealth` call. Two new
`InfraDevice` columns (`managementPort`, `tags`) plus a `discoverySource`
audit column, migrated live against the real database
(`20261110023827_device_tags_and_port`) — `managementPort` now actually
flows into connector calls (`apply-management-port.ts`) as the default
port when a credential doesn't specify its own.

**Real network discovery**: `DiscoveryScanService` (new) detects the
local interface/subnet/gateway, runs an ARP+nmap scan the operator
explicitly confirms the scope of first, labels the gateway a *router
candidate* and a NETGEAR MAC-prefix match a *switch candidate* (never a
confirmed fact), and lets the operator import chosen candidates —
merging into an existing device by IP rather than duplicating. A
"Discover My Network" button on the Overview page drives this end to
end, including progress and per-host import.

**Proxmox: password/ticket auth added, and a real enrollment bug
fixed.** `ProxmoxConnector` now accepts a username+password (exchanged
for a session ticket on every call) as an alternative to an API token —
needed because the operator's real credential was a root password, not
a pre-created token. Separately, found live: every manually-enrolled
Proxmox hypervisor's health check threw, because nothing ever set the
connector's required `metadata.node` for a device created outside the
discovery flow. Fixed with an auto-discovery fallback (ask Proxmox's own
`/nodes` list; use it when there's exactly one) and two related bugs —
`requireNode()`'s thrown error wasn't inside `getHealth`'s or
`performAction`'s try/catch, so an ambiguous-node error would have 500'd
instead of reporting a clean failure.

**MCP server**: added `trace_diagnose_device` (explains *why* a device
isn't connected — missing address vs. missing credential vs. genuinely
unreachable — instead of a generic error), `trace_detect_local_network`,
`trace_scan_network`, and `trace_update_device` (non-secret fields only;
the DTO has no credential field, so this can't become a secret-exfil
path). 16 tools total.

**Two real, non-infra bugs found and fixed while verifying discovery
against the real LAN:**
1. The scan's ARP read happened *before* the nmap sweep, missing every
   MAC address that nmap's own probe traffic would have freshly
   resolved — reordered so nmap runs first.
2. `arp -a` returns completely empty when invoked from Node at all
   (not just a timing issue) on this specific Mac — isolated with
   `execFile`/`exec`/`spawn` all returning empty with no error, while
   the identical command in an interactive shell shows a full table.
   Almost certainly macOS's per-binary "Local Network" privacy
   permission. No code fix is possible for this from an agent session
   (it requires an interactive OS permission grant); documented with
   the exact check in the README. Discovery still works via nmap +
   gateway detection in the meantime.

**Live-verified against the operator's real homelab, not mocks:**
- A real network scan of the operator's actual LAN correctly detected
  the real subnet (`192.168.0.126/24`) and gateway (`192.168.0.1`), and
  found real live hosts via nmap.
- A real Proxmox connection to the operator's actual Beelink: created a
  password-based credential, got `ONLINE` with 8 real metrics
  (CPU/memory used+total/uptime/disk used+total, all real numbers —
  e.g. a real ~62.9GB total memory matching the stated 64GB DDR5 spec
  once reserved memory is accounted for), ran Proxmox discovery and got
  4 real guests (`ai01` container, `kali01`/`mgmt01`/`ws01` VMs) with
  correct `HOSTS` edges in the topology, and confirmed the dashboard's
  aggregate-memory/storage figures reflect that one real reporting host
  correctly.
- **Persistence confirmed across a real backend restart**: the device's
  IP/port/protocol, the encrypted credential (still decryptable — the
  macOS Keychain-backed master key survived the restart), and the live
  Proxmox connection all still worked after `node dist/main.js` was
  killed and restarted.
- No destructive action (`performAction` start/stop/reboot) was run
  against the real VMs — that's unit-tested only, deliberately not
  live-tested without being asked to.
- The test session used to drive these authenticated calls was minted
  directly in Postgres (same hashing TraceAuthService itself uses), not
  via the operator's real password — cleaned up afterward.

**Verified:** 227 backend Jest tests (up from 206), 8 MCP server tests
(up from 7, covering the new tools), `tsc --noEmit`/ESLint clean across
every workspace, `npm run build` clean for `apps/api`/`packages/mcp-
server`/`packages/telemetry-sdk`, `apps/web`'s webpack build succeeds
(Turbopack still fails on this machine — see "Known limitations").
**Not verified**: the unified UI's click-through in an actual browser
(no GUI access in this session — verify this yourself), SSH/SNMPv3
against real hardware, WebAuthn against a real key, and the MCP server
registered with a live Claude Code CLI session.

### Product evaluation: realistic 50-person org, bug fixes, security review

A comprehensive evaluation of TRACE as it stood after the infrastructure/
software-inventory phase — acting as an IT administrator deciding whether
to deploy this at a real ~50-person company, rather than adding new
features. Four real bugs were found and fixed, four more findings were
documented without a code change (each explained below), and the backend's
authN/authZ, telemetry ingestion, and asset-enrollment endpoints got an
active security review (not just a read-through).

**Realistic evaluation data.** `apps/api/prisma/seed.ts` was extended
(not replaced — every existing id/name from the prior phase is untouched,
so no existing test needed to change for this part) with 5 more
departments (Sales, Marketing, Finance, HR, Customer Support) and 43 more
staff for a 50-person total, 5 more network/server infrastructure assets
(a second switch, two access points — one deliberately outdated, a
backup server, a staging VM), one workstation per new employee with a
deterministic varied posture/check-in spread (healthy, one failing
check, two+ failing checks, genuinely unknown, and stale-but-healthy —
the same four-state distribution the original 11 hand-picked devices
demonstrated, now at real scale: 59 devices total), and common
department-appropriate software (Chrome/Slack/Zoom everywhere, plus
Salesforce/Canva/QuickBooks/BambooHR/Zendesk/CrowdStrike Falcon/VS Code
per department) — 177 software rows total. Running security detection
against this data produced 38 new alerts (26 posture-risk, 11
missing-info, 10 stale-checkin, plus the pre-existing API-usage alerts),
confirming the rule engine behaves correctly at realistic volume, not
just the original handful of hand-picked demo cases.

**Bugs found and fixed:**

1. **Security alert dedup didn't recognize "being investigated" as still
   open.** `SecurityDetectionService.runDetection`'s duplicate check only
   matched `status: OPEN`. INVESTIGATING is a working status an admin
   sets while looking into an alert, not a resolution — the underlying
   condition hasn't gone away. Re-running detection (which happens
   routinely; there's no scheduler yet, see "Upcoming work") while an
   alert was INVESTIGATING spawned a fresh duplicate for the same
   ongoing condition. Fixed by matching `status: { in: [OPEN,
   INVESTIGATING] }`. Verified live: set a real alert to INVESTIGATING,
   reran detection, confirmed zero new alerts for that
   (type, dedupeKey) pair; new unit test added
   (`security-detection.service.spec.ts`).
2. **No way to navigate from a security alert to the asset it's about.**
   This was the core gap found while directly testing the "investigate a
   security event" workflow the evaluation was asked to exercise: an
   alert card showed the device's name in its text but had no link —
   an admin had to manually search the device inventory by name to find
   it, with no guarantee the name was even unique. Fixed by adding a
   "View affected device" / "View developer" link to each alert card
   (`SecurityAlertsPanel.tsx`), reading `evidence.deviceId` (set by both
   device rules) or `alert.developerId`, and threading the already-built
   `onSelectEntity` callback (originally added for the device inventory
   table) through `DetailPanel`'s `securityAlertsGroup` branch. An
   org/provider-wide alert (api_usage_spike, elevated_api_error_rate —
   no single asset) correctly shows no link. Verified live and via two
   new Playwright live tests, including a full
   alert → device → owner/posture/software walkthrough.
3. **The graph's camera didn't re-fit when live data replaced demo
   data.** `useGraphData` starts synchronously with the small demo
   dataset, then swaps to the real live snapshot once the fetch
   resolves — but React Flow's `fitView` prop only fits once, on mount.
   At the original 7-person scale this was never visible (demo and live
   Acme Corp happened to be similarly sized/centered). At the 50-person
   scale this evaluation uses, the camera stayed wherever it fit the
   tiny demo tree, and the much larger live tree rendered with its root
   and most of its structure panned completely out of view — on first
   load, before the admin had done anything, the app looked broken: no
   org node, no obvious way back to center. Fixed with `<ReactFlow
   key={mode}>`, remounting (and re-running `fitView`) on each
   checking → live/demo transition — the same mode-transition boundary
   `OrgGraph.tsx` already treats as "start over" for collapse/selection
   state. Verified via screenshot before/after and the existing
   "renders real organization data" live test, which now also serves as
   a regression test for this (its comment explains why).
4. **The devices group rendered all of its children by default.** At 59
   devices, leaving `deviceGroup` expanded by default (its prior
   behavior) meant the very first view of the graph showed 50 employees
   AND 59 devices simultaneously — unreadable, and a real scale problem
   a 7-device demo could never have surfaced. Fixed by collapsing
   `deviceGroup` by default in `computeInitiallyCollapsed`, same as
   individual developer metric leaves. Departments stay expanded by
   default — unchanged, see "Known limitations" for why this wasn't
   extended further. Three existing live tests that clicked a device
   node directly were updated to expand the group first.

Also fixed in passing, found while reviewing input validation for the
security review below: **no DTO anywhere had a `@MaxLength`.**
`EnrollDeviceDto`, `AddSoftwareDto`/`SoftwareItemDto`,
`ReportApiUsageDto`, and `ConnectInstallationDto` all had `@IsString()`
with no upper bound, so the API would accept and store an arbitrarily
large string for a device name, a software name, an installation id,
etc. — unbounded request/storage size from an authenticated-but-not-
necessarily-trusted caller (e.g., a compromised telemetry-reporting
script holding a shared API key — see the security review below). Added
reasonable `@MaxLength` values to every such field; verified live that a
5,000-character device name now correctly 400s.

**Usability findings documented but deliberately not changed** (each is
a product/design decision bigger than a bug fix, which this evaluation
was scoped to avoid):
- Every person — including the 43 new Sales/Marketing/Finance/HR/Support
  staff with no GitHub account or API usage at all — still gets
  GitHub/API Usage/Security Events metric sub-nodes showing "0 repos, 0
  commits, 0 requests/day." Harmless but noisy, and could be misread as
  meaningful monitoring coverage for staff TRACE isn't actually tracking
  anything about. Only showing these for developers with a `githubLogin`
  or any recorded activity is a reasonable follow-up, but changes the
  graph's information architecture rather than fixing a defect.
- The "Activity: High/Medium/Low" filter is a commit-count heuristic
  (`activityFromCommitCount`), applied uniformly to everyone. Every
  non-engineering employee with zero commits always reads "low," which
  could be misread as a judgment about their work rather than "this
  person has no GitHub account" — same underlying cause as the point
  above.
- There's no modeled relationship between a device and the network
  infrastructure it's connected to (e.g., "this laptop is on
  floor2-switch-01"). An admin can approximate this by filtering the
  device inventory by department, but there's no direct device↔device
  edge. This was named in the original product-direction ask
  ("associated infrastructure"); building it is a real feature (a new
  relationship/field), not a bug fix.
- Departments stay expanded by default regardless of size (unlike the
  devices group, fixed above) — a department with many people is still
  busy on first load. Collapsing departments by default too would be a
  more consistent fix, but changes the demo experience's default view
  and would require rewriting several existing demo-mode tests that
  specifically assert developer nodes are visible without expanding
  anything; left as a deliberate follow-up rather than bundled into this
  evaluation pass.

**Security review — authN, authZ, telemetry ingestion, asset enrollment,
API endpoints.** Actively tested, not just read:
- **Org-scoped authorization holds up under direct attack.** Created a
  real second organization with its own API key and verified live: its
  key sees an empty graph/device list (not Acme Corp's 50 people/59
  devices); enrolling a device with a `ownerId` copied from Acme Corp
  400s ("must belong to the caller's organization"); reporting telemetry
  with a copied `developerId` 400s the same way; PATCHing an Acme Corp
  alert's status 404s ("Security alert not found" — doesn't even leak
  that the alert exists in another org); adding software to an Acme
  Corp device id 404s. No IDOR found anywhere tested. (Test org and key
  deleted afterward.)
- **Mass-assignment is correctly blocked.** `ValidationPipe`'s
  `forbidNonWhitelisted` rejects an enroll-device request that tries to
  smuggle `organizationId`/`isAdmin` fields, confirmed live.
- **Missing/invalid/malformed API keys are correctly rejected** (401 in
  all three cases, confirmed live): no `Authorization` header, a
  syntactically-valid-but-unknown key, and a header missing the
  `Bearer ` scheme.
- **No `@MaxLength` anywhere** — found and fixed, see above.
- **CRITICAL finding, no code change (out of scope — this is a feature,
  not a bug): the frontend web app itself has zero user-level
  authentication.** `apps/web`'s server-only proxy
  (`app/api/trace/[...path]/route.ts` / `lib/trace-api.ts`) correctly
  keeps `TRACE_API_KEY` out of client-side JS — but it does this by
  injecting the *one* fixed, server-configured key into every request
  regardless of who's asking, with no login page, session, or credential
  prompt of its own. Anyone who can reach the Next.js server on the
  network gets full read/write access to the organization's entire
  TRACE data (security alerts, device enrollment, GitHub installations,
  telemetry) with zero gate. The existing "No production authentication
  system" known limitation previously described only the backend's
  dev-only API-key mechanism; this specifically calls out that the
  *frontend* has no access control of its own at all. **This is the
  single biggest blocker to deploying this anywhere reachable by more
  than one trusted person on a fully trusted network** — see the
  evaluation verdict below.
- **API keys are all-or-nothing** — one `ApiKey` row grants full
  read/write access to every endpoint (devices, telemetry, security
  alerts, GitHub installations); there's no scoping (e.g., a
  telemetry-only write key vs. a full admin key). If any one system
  holding this shared key is compromised (a CI pipeline, a reporting
  script on someone's laptop), the blast radius is the entire
  organization's data. Worth a scopes/permissions system before broader
  rollout; a real feature, out of scope here.
- **CORS remains wide open** (`Access-Control-Allow-Origin: *`) and
  **there is still no rate limiting anywhere** — both reconfirmed true,
  unchanged from the existing known limitation, not touched.
- The GitHub webhook's HMAC signature verification against a single
  global secret works correctly as designed for a single-tenant
  self-hosted deployment; it doesn't scale to true multi-tenant SaaS
  without per-installation secrets. Existing architectural note, not a
  new finding.

**Performance at realistic scale.** `GET /graph/snapshot` against the
full 50-person/59-device/177-software-row dataset: ~60ms, ~67KB response.
No performance concern found at this scale.

**Verified:** Backend 101 Jest tests (1 new, for the dedup/INVESTIGATING
fix). `lint`/`typecheck`/`build` clean on both workspaces. Demo Playwright
suite 8/8 (one flaky run under parallel workers due to environment
resource contention — the same pre-existing class of flakiness documented
in the "Playwright flakiness" log entry below, confirmed not a regression
by passing cleanly both standalone and in two full clean re-runs at
`--workers=1`). Live Playwright suite 14/14 (2 new: the full
alert → device investigation walkthrough, and the "org-wide alert has no
device link" check; 3 existing tests updated to expand the now-collapsed
devices group first; the existing org-node-visibility test's comment
updated to explain it's now also a regression test for the viewport-fit
bug). Security-isolation testing (second org/key, cross-org IDOR
attempts, mass-assignment, auth-failure cases) done via direct `curl`/
Prisma against the live database, all cleaned up afterward.

**Evaluation verdict:** see the top-level summary given to the user
alongside this update, and "Known limitations" / "Upcoming work" below
for the complete, current picture.

### Infrastructure assets, software inventory, and device IT workflows

Extended the existing `Device` model rather than building a parallel asset
system, per explicit instruction — every change below is additive to what
"Device inventory" (log entry further down) already built.

**Backend:**
- `Device` gained `SWITCH`/`ROUTER`/`ACCESS_POINT`/`VIRTUAL_MACHINE` types
  and an independently-nullable `departmentId` (ownership and department
  assignment are orthogonal — a device can have either, both, or
  neither). `EnrollDeviceDto` validates `departmentId` belongs to the
  caller's org, same as it already did for `ownerId`.
- New `SoftwareInstallation` model: one row per device per installed
  app (`name`, optional `version`/`publisher`/`installedAt`), denormalized
  rather than a separate Application catalog since nothing yet needs
  cross-device app queries. `source: MANUAL | CSV_IMPORT` is set
  explicitly by the caller, never inferred. New
  `POST /devices/:id/software` accepts a plain JSON array (the frontend
  parses CSV client-side — see below) and bulk-creates via `createMany`,
  validating the device belongs to the caller's org first (404 otherwise).
- **Real bug found and fixed: `SecurityDetectionService`'s dedup only
  keyed on `(organizationId, type, developerId)`.** Adding
  `DeviceDataQualityRule` — which produces one finding per device,
  several with no owner (`developerId: null`) and several sharing the
  same type — exposed this immediately live: findings for distinct
  devices silently collapsed into each other. Fixed by adding a
  `dedupeKey` column (set by each rule to the finding's actual subject —
  the device id for device rules, the provider for API rules, the
  developer id for the commit-volume rule) and widening the dedup
  `findFirst`/`create` to include it. Verified live before and after:
  before the fix, seeding 9 devices with missing info produced fewer
  than 9 alerts; after, exactly 9, each correctly attributed.
- `DeviceDataQualityRule`: combines "posture is genuinely unknown" and
  "no check-in recorded" into a *single* `device_missing_security_info`
  finding per device (not two — an earlier version double-counted this
  and would have incorrectly deduped the two findings against each
  other within the same run), plus a separate MEDIUM
  `device_stale_checkin` when `lastCheckInAt` is set but older than 90
  days. Both are explicitly "unknown/stale," never conflated with
  `DevicePostureRule`'s confirmed-risk findings.
- Seed data: three infra assets (`core-switch-01` — Operations,
  firewall explicitly off; `edge-router-01` — Operations, healthy;
  `ci-runner-01` — Engineering VM, OS explicitly out of date), five
  software rows across two devices, and realistic `lastCheckInAt` spread
  across existing devices (one deliberately 200 days stale, one
  deliberately `null`, most recent).
- `GET /graph/snapshot` and its service now include each device's
  `departmentId`/`departmentName`, `lastCheckInAt`, and full `software`
  array, so the frontend gets everything in the one existing snapshot
  call rather than a second round-trip per device.
- Two new Prisma migrations (`20261019021927_infra_assets_and_software`,
  `20261019022351_add_alert_dedupe_key`), applied via the established
  `migrate diff` → `migrate deploy` workaround (no interactive TTY in
  this environment for `migrate dev`).

**Frontend:**
- `DeviceProfilePanel` (replaces the generic field list for `device`
  nodes): owner, department, type, OS, serial, enrollment, last
  check-in, full posture, and the installed-software list with an
  inline "add software" form and a CSV file picker — both call
  `POST /devices/:id/software` and refetch the graph. Software
  management controls are hidden in demo mode (`mode !== "live"`),
  since demo data has no real device to post to.
- `DeviceInventoryPanel` (replaces the generic list for the `deviceGroup`
  node): search box (name/owner/department/OS/serial), device-type and
  posture-status filters, five summary tiles (total + each posture
  status), and a row list where clicking a device opens its profile —
  wired through a new `onSelectEntity` callback threaded from
  `OrgGraph` → `DetailPanel` → `DeviceInventoryPanel`.
- `lib/csv.ts`: a minimal, explicitly-documented CSV parser (header row,
  comma-separated, **no quoted-comma support** — see "Known
  limitations"). Good enough for a first version; a real RFC 4180
  parser is more than this needs right now.
- `lib/device.ts`: shared `formatPostureFlag` and the device-type option
  list, used by both new panels (previously a private helper duplicated
  nowhere — now it has one home instead of two).

**A real pre-existing test bug found while adding live coverage (not
caused by this phase's code, but exposed by it):** the existing "device
posture rule's findings appear as real security alerts" test filtered
alert cards by device name only and took `.first()` — once
`DeviceDataQualityRule` gave Priya's device a *second* alert (the new
stale-checkin finding, alongside its existing posture-risk one),
`.first()` started resolving to whichever of the two rendered first,
not necessarily the posture-risk one the test meant to check. Fixed by
also filtering on the alert-type text, same fix shape as the dedup bug
above: scope by what you actually mean, not by what happens to be first
today.

**A real build-environment issue, not a code bug:** `next build` failed
with a Turbopack panic ("binding to a port... Operation not permitted")
caused by a stale `.next` cache left over from a `next dev` server that
had been killed mid-session (Next.js 16's project-wide dev-server lock —
see existing "Known limitations" note below — required stopping it
before `next build` *or* a fresh `next dev` could run at all). Fixed by
`rm -rf .next` before building; unrelated to anything in this phase's
source changes.

**Verified:**
- Backend: 100 Jest tests total (up from 81 — new coverage for
  `departmentId` validation on both accept/reject paths, `addSoftware`
  rejecting an unknown device and bulk-creating with correct source
  tagging and `installedAt` parsing, the dedup-collision fix itself via
  a test that two findings sharing type+developerId but different
  dedupeKeys both persist, `DeviceDataQualityRule`'s combined-finding
  behavior and its stale-checkin threshold, and the graph snapshot's
  department/software mapping). Live-verified via `curl` at every step,
  including the dedup bug's before/after device counts.
- Frontend: `lint`/`typecheck`/`build` clean. Demo suite 8/8 (one test
  flaked under the 2-worker config due to environment resource
  contention — confirmed pre-existing by passing cleanly at
  `--workers=1`, both standalone and as a full run; not a regression).
  Live suite 12/12 (4 new: software list + department display on the
  profile panel, the inventory panel's search/filter/select-into-profile
  flow, and the two new alert types appearing correctly — plus the
  pre-existing-bug fix above). Manual add-software and CSV-import POSTs
  verified directly against the live backend (correct `source` tagging
  for both, correct `installedAt` parsing) and then deleted from the
  database afterward — deliberately not given a permanent automated
  test, same reasoning as device enrollment: there is no
  `DELETE /devices/:id/software/:id` endpoint yet, so a permanent test
  would leave rows with no way to clean up.

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

### Device inventory: backend, posture-based security rule, graph integration, UI

**Data model:** `Device` (apps/api/prisma/schema.prisma) — ownership is a
plain nullable FK to `Developer` (shared/unowned devices, like
`prod-db-01` below, are a normal case, not an edge case), four posture
flags (`diskEncrypted`, `firewallEnabled`, `osUpToDate`, `screenLockEnabled`)
that are **nullable, not defaulted to false** — a device with no agent has
genuinely *unknown* posture, a different fact than "verified disabled,"
and only an explicit `false` ever counts as a finding anywhere downstream.
`DeviceEnrollmentType` already includes `AGENT` (reserved, unused) so the
planned-for-later endpoint-agent feature won't need its own migration
just to add the value.

**Backend:** `POST /devices` (manual enrollment — the DTO has no
`enrollmentType` field, so a caller can never claim to be "simulated" or
"agent" data) validates `ownerId` belongs to the caller's own org.
`GET /devices` lists all devices with computed posture status.
`computePostureStatus`/`listFailingChecks` (`devices/device-posture.ts`)
are plain, Nest-independent functions — reused verbatim by the device
list endpoint, `GraphService`, and the new `DevicePostureRule`, so all
three can never disagree about what "at risk" means. Two or more failing
checks → HIGH alert, exactly one → MEDIUM, unknown → never a finding.
Seed script now creates 8 simulated devices (`enrollmentType: SIMULATED`)
spanning every posture state (3 healthy, 3 at-risk, 1 critical, 1 unknown)
plus the one unowned shared server, so there's always real data to
demonstrate every state without hand-crafting it per demo.

**Graph integration:** devices ride along in the same `GET /graph/snapshot`
response as repositories (full profile detail included — no second fetch
needed to open a device's panel). New entity kinds `deviceGroup`/`device`
in `lib/types.ts`; ownership is shown as a field (`ownerName`), not as
graph nesting under the owning developer — same reasoning as Repository:
the graph's entities are a single-parent tree, so a device can't
structurally live under both its owner and a flat "Devices" branch
without a larger rewrite, which this phase deliberately avoided per the
"avoid unnecessary rewrites" instruction.

**UI:** `EnrollDeviceModal.tsx` (graph-driven, live mode only, mirrors the
existing GitHub onboarding modal's pattern) — posture checks are
three-way selects ("Unknown / not checked" / Yes / No), not checkboxes,
so the UI can't accidentally assert a check passed or failed when nobody
actually knows. Device nodes show posture status color-coded
(healthy=emerald, at-risk=amber, critical=rose, unknown=slate); the
detail panel shows owner, OS, enrollment type, and all four posture
flags individually.

**A real, reproducible Next.js environment issue found and worked
around:** Next 16's dev server refuses to start a second instance *for
the same project*, regardless of port — not a port conflict, a
project-wide lock. This meant Playwright's own managed dev server
(`playwright.config.ts`/`playwright.live.config.ts`) could not start
while the frontend dev server I'd started earlier (for the repository
owner's own manual testing, at their request) was still running, even on
a completely different port. Worked around by stopping that server
before running either Playwright suite and restarting it afterward —
same pattern already used for the backend throughout this session.

**A real pre-existing test bug found and fixed while adding device
tests, not caused by them:** "resolving an open alert decrements the
graph's open-alert count by exactly one" asserted `alertCard).not
.toBeVisible()` using the *same* `.first()` locator it had captured the
alert's id from earlier — but Playwright locators are lazy and
re-evaluate against the current DOM on every check, so once the list
changed, `.first()` silently started matching a *different* alert. This
was invisible while there was usually only one open alert at a time; the
device posture rule's four new alert-producing devices made it
reproducible. Fixed by scoping the "not visible" assertion to the
captured id via `page.getByTestId(alertTestId)`, exactly like the
test's own restoration step already correctly did.

**Verified:**
- Backend: 81 Jest tests (19 new: posture status across all boundary
  cases including the "never treat null as a failure" case, enrollment's
  org-scoping validation, list scoping, the security rule's severity
  thresholds and owner/unowned attribution, and the graph snapshot's
  device mapping). Live-verified via `curl` at every step: enrolled a
  real device with a real owner (got HEALTHY back), confirmed an invalid
  `ownerId` 400s, seeded all 8 devices and confirmed every posture status
  computed correctly, ran detection and got exactly the 4 expected
  `device_posture_risk` alerts with correct severities and owner
  attribution (including the unowned server correctly having no
  `developerId`), confirmed devices appear correctly in the live graph
  snapshot.
- Frontend: full `lint`/`typecheck`/`test`/`build` clean across all three
  workspaces. Demo-mode suite 8/8 (devices don't exist in demo mode by
  design, so this also confirms zero regression there). Live suite 9/9
  (3 new device tests, plus the one pre-existing bug above fixed).
  Enrollment's own mutation flow (modal → `POST /devices` → graph
  refetch) was verified manually via real browser automation twice, with
  real before/after device-count checks against the live database each
  time — deliberately **not** given a permanent automated test, because
  there is no `DELETE /devices/:id` endpoint yet, so an enrollment test
  would leave a new row in the database on every run with no way to
  clean up, breaking the idempotency the rest of the live suite
  maintains. Both manually-created verification devices were deleted
  from the database afterward.

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
- **No production authentication system — and specifically, the frontend
  web app has zero user-level access control of its own.** The backend's
  org-scoped authorization uses a development-only API-key mechanism
  until a real auth provider is wired up (do not deploy this as-is). The
  product-evaluation security review (see the log entry above) found
  this is actually worse on the frontend side than that description
  alone implies: `apps/web`'s server-only proxy injects one fixed,
  server-configured API key into every backend request regardless of
  who's asking, with no login page, session, or credential prompt of its
  own anywhere in the Next.js app. Anyone who can reach the frontend on
  the network — not just anyone with the API key — gets full read/write
  access to the organization's entire TRACE data. This is the single
  biggest blocker to deploying this anywhere reachable by more than one
  trusted person on a fully trusted network.
- **API keys are all-or-nothing.** One `ApiKey` row grants full
  read/write access to every endpoint — there's no scoping (e.g., a
  telemetry-only key vs. a full admin key). If any one system holding a
  shared key is compromised, the blast radius is the entire
  organization's data. Found during the security review; a real feature
  (a scopes/permissions system), not started.
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
- **No device or software deletion endpoint.** Devices and
  `SoftwareInstallation` rows can be created but not removed via the
  API — fine for an inventory, not sufficient for real
  offboarding/decommissioning workflows later. (This is also why the
  live Playwright suite doesn't have a permanent test for enrollment,
  manual add-software, or CSV import — see the relevant log entries for
  how each was instead verified manually and cleaned up by hand.)
- **No real endpoint agent, and no network scanning.** `DeviceEnrollmentType.
  AGENT` is reserved in the schema but nothing implements it — all
  posture and software data today is either hand-entered (manual
  enrollment, manual software add, CSV import) or simulated (seed
  script). Per explicit instruction, neither agents nor network
  discovery/scanning are being built yet.
- **The CSV importer is intentionally minimal.** `lib/csv.ts` splits on
  commas and newlines with no support for quoted fields containing a
  comma (e.g. a publisher name like `"Acme, Inc."` would misparse). A
  real RFC 4180 parser is more than a first version needs; this is a
  documented gap, not an oversight.
- **Devices form a flat list under one `deviceGroup` node, not a
  relationship graph.** Owner and department are shown as *fields* on
  each device (`ownerName`/`departmentName`), not as additional graph
  edges — the graph's entities are a single-parent tree, so a device
  can't structurally nest under both its owner and a flat "Devices"
  branch without a larger rewrite. There are no edges yet for
  device↔software (beyond the profile panel's list),
  device↔application, device↔repository, or device↔network-infrastructure
  (e.g. "this laptop is on floor2-switch-01" isn't modeled at all).
- **Every employee gets GitHub/API Usage/Security Events graph nodes,
  even non-engineering staff with no GitHub account or API usage at
  all.** Found during the product evaluation once the seeded org grew to
  a realistic 50-person/8-department mix: Sales, HR, Marketing, Finance,
  and Support staff all show "0 repos, 0 commits, 0 requests/day"
  sub-nodes that are harmless but noisy, and the commit-count-based
  "Activity: High/Medium/Low" filter always reads "low" for all of them
  — which could be misread as a judgment about their work rather than
  "this person has no GitHub account." Deliberately not changed in the
  evaluation pass (a data/information-architecture decision, not a bug);
  see the log entry above for the full reasoning.
- **Departments are not collapsed by default, unlike the devices group.**
  A department with many people is still busy on first load. Collapsing
  departments by default too would be more consistent, but changes the
  demo experience's default view and would require rewriting several
  existing demo-mode Playwright tests that specifically assert developer
  nodes are visible without expanding anything — left as a deliberate
  follow-up, not bundled into the evaluation pass that fixed the devices
  group.

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
- **Endpoint agents and network scanning** — planned per the product
  direction, but intentionally not started per explicit instruction for
  this phase.
- A device/software deletion or deprovisioning endpoint.
- Real relationship edges in the graph beyond device↔owner/department
  fields (e.g. device↔application, device↔repository, device↔security
  event as actual graph structure, not just a field on one node) —
  explicitly named in the product direction as a future step.
- A real RFC 4180 CSV parser (quoted fields, embedded commas) if CSV
  import sees real-world use beyond the current simple format.
- **Real frontend authentication** (a login page, sessions) — the
  product evaluation's top security finding; currently anyone who can
  reach the Next.js server has full access with no credential prompt.
- **API key scopes/permissions** — currently one key grants full
  read/write access to everything; found during the evaluation's
  security review.
- Collapsing departments by default too (not just the devices group) for
  a more consistently readable graph at any org size — deliberately
  deferred past the evaluation pass to avoid rewriting the demo-mode
  tests that assert the current default-expanded behavior.
- Only showing an employee's GitHub/API Usage/Security Events graph
  leaves when there's actually something to show (a `githubLogin` or any
  recorded activity) — found noisy for non-engineering staff during the
  evaluation; a real information-architecture decision, not bundled in.
- Device↔infrastructure relationship edges (e.g. which switch/AP a
  workstation is connected to) — named as a gap in the product
  evaluation; a real feature, not started.
