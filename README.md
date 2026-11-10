# TRACE

TRACE is two products in one local-first, open-source monorepo:

1. **Developer intelligence** — visualizes an organization's departments,
   developers, GitHub activity, API usage, security events, and
   employee-endpoint devices as an interactive node graph.
2. **Infrastructure control plane** — discovers, enrolls, monitors, and
   administers real infrastructure (servers, VMs, hypervisors, switches,
   printers, …) through a unified device model, a command console, and
   two independent AI integrations: an MCP server (the primary path —
   Claude Code or Claude Desktop, your existing subscription, no
   Anthropic API key) and an optional native chat assistant built into
   the UI (your own Anthropic API key, configured in Settings).
   Administrative/destructive actions from either one require your
   explicit approval in TRACE's own UI before they run.

They share a database connection and an HTTP server, nothing else — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the two are kept
separate, the infra module map, and the full security model.

## Status

Developer intelligence: phases 1–2 of the original roadmap (org graph,
GitHub integration, telemetry, security detection, device inventory) are
implemented and were verified against a live database in earlier sessions
— see [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for the
full, dated log.

Infrastructure control plane: implemented across two sessions and, as of
the second, **verified live against the operator's real homelab** —
real Postgres, a real Proxmox host (the Beelink), and a real LAN scan —
not just unit tests. See "What's tested" below for the exact split that
remains between what's live-verified and what's still only unit-tested.

## What's tested

| Area | Tested how |
| --- | --- |
| Backend logic (devices, environments, console, discovery, actions, monitoring, credentials, auth) | 227 Jest tests, each connector/service's own logic against a mocked transport, **plus live against a real Postgres database** |
| Proxmox connector | Unit tests mocking `node:https`, **plus a real live connection to a real Proxmox VE host**: password/ticket auth, automatic node-name discovery, real CPU/memory/disk metrics collected, 4 real VMs/containers discovered and added to inventory, all confirmed to survive a backend restart |
| Local network discovery (interfaces, default gateway, nmap ping sweep) | Unit tests, **plus a real scan of the operator's actual LAN** — correctly detected the real subnet/gateway and found real live hosts via nmap |
| ARP-based MAC/vendor discovery | Unit tests only. **Live-tested and found not to work on this specific Mac**: `arp -a` returns empty output when invoked from Node (but not from an interactive shell), almost certainly macOS's "Local Network" privacy permission gating ARP visibility per-binary. Discovery still works via nmap + gateway detection; it just can't add a MAC/vendor hint until this permission is granted — see "Known limitations." |
| SSH connector (health/metrics/exec/diagnostics/actions) | Unit tests mocking `ssh2`'s `Client`, **plus a real disposable Docker container** (`lscr.io/linuxserver/openssh-server`, removed after testing): password auth, host-key TOFU pinning and its persistence across a real process restart, 4 of 10 read-only diagnostics, command-injection rejection, clean 404/502 for unknown-device/unreachable-host, and an approval-gated `perform_action` proposal through a real MCP client session | `service_status`/the `service_*` actions assume `systemctl` (not tested against a non-systemd init); `firewall_rules` returns an empty string rather than an explicit "not found" when no firewall tool exists; `security_posture`'s sshd check doesn't account for PAM keyboard-interactive — see `docs/ARCHITECTURE.md`'s "Known limitations" |
| SNMP connector | Unit tests mocking `net-snmp` | Not yet tested against a real SNMPv3-capable device |
| WebAuthn/YubiKey | Unit tests mocking `@simplewebauthn/server` (challenge/credential logic) | Not yet tested against a real browser + hardware security key |
| MCP server (21 tools; stdio — Claude Code **and** Claude Desktop use the same command/args/env shape) | A real `@modelcontextprotocol/sdk` `Client` connects over the SDK's in-memory transport and calls tools end to end, including the approval-gated ones (`packages/mcp-server/src/server.integration.spec.ts`); a real `claude mcp add` registration was verified live against a real backend in an earlier session (16 tools, pre-dating the approval gate) | The approval gate and the 5 tools added since have not been exercised by a real Claude Code/Desktop conversation — see `packages/mcp-server/README.md`'s "What's verified vs. what isn't" |
| NestJS dependency wiring | `infra.module.spec.ts` resolves the entire DI graph; **the compiled server was booted against a real database** and every route, including live Proxmox calls, worked | — |
| Frontend (unified `/` dashboard) | `tsc --noEmit`, ESLint, and a production build (via webpack — see Troubleshooting) all pass; the dev server was booted and every route (`/`, `/dev-intel`, `/infra` redirect) confirmed to respond correctly | Not click-tested in an actual browser in this environment — no GUI access here; verify the click-through yourself |

**A real gotcha found live, now fixed (commit `8d17002`)**: the backend's
normal dev command, `npm run dev` (`tsx watch`), used to silently break
dependency injection for every constructor-injected provider in
`apps/api/src` — `tsx`'s esbuild-based transform never emits
`emitDecoratorMetadata` the way `tsc` does, so a service came back
`undefined` at request time with no error at startup. Fixed by adding
explicit `@Inject()` tokens to every affected constructor parameter
(105 of them, across 50 files) — confirmed live, side by side, that
`npm run dev` and `npm run build && npm run start` now resolve
dependencies identically. `npm run dev` is safe to use normally again.

No live device metrics, IP addresses, or topology connections anywhere in
this repository are invented — see
[`apps/api/prisma/seed-infra.ts`](apps/api/prisma/seed-infra.ts), which
seeds only the hardware facts given directly by the operator, with every
device starting `DISCOVERED`/`UNKNOWN` until real credentials are enrolled
and a live check succeeds.

## Architecture

- **Frontend:** Next.js, TypeScript, React, Tailwind CSS, React Flow
- **Backend:** NestJS, TypeScript — a modular monolith, no microservices
- **Database:** PostgreSQL, Prisma
- **MCP server:** `packages/mcp-server`, `@modelcontextprotocol/sdk`
- **Dev tooling:** npm workspaces, GitHub Actions CI, Docker Compose, Git

Full module map, connector details, and the security model:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

Requirements: **Node.js 20+**, npm, Docker Desktop (for Postgres), and
macOS (for Keychain-backed credential encryption — see Security model).

```bash
git clone https://github.com/gavinROK/TRACE.git
cd TRACE
npm install                        # installs every workspace

docker compose up -d postgres       # Postgres on localhost:5433
cd apps/api
cp .env.example .env                # adjust if needed
npx prisma migrate deploy           # apply every migration
npx tsx prisma/seed.ts              # developer-intelligence demo data
npx tsx prisma/seed-infra.ts        # "Gavin's Home Infrastructure" environment
npm run build && npm run start      # API on http://localhost:4000 — see Troubleshooting for why not `npm run dev`

# in a second terminal
cd apps/web
cp .env.example .env.local          # adjust if needed
npm run dev                         # frontend on http://localhost:3000
```

Open **`http://localhost:3000`** — one unified dashboard: a left sidebar
(Overview, Topology, Devices, Monitoring, Settings), the selected view in
the middle, a device's details/edit form on the right when one is
selected, and a command console you can expand from the bottom at any
time, in any view. `/infra` now redirects to `/`. The original
developer-intelligence org graph is preserved, unchanged, at `/dev-intel`.

First load asks you to set up the one operator account (email +
password) — see "Security model" below for WebAuthn/YubiKey.

## Network discovery

Click **Discover My Network** on the Overview page. TRACE detects your
active interface, subnet, and default gateway, shows you exactly what
it's about to scan, and only scans after you confirm. It never scans
outside that subnet, never port-scans (ARP/neighbor-table inspection plus
an optional `nmap -sn` ping sweep only), and never invents a device's
identity — the gateway is labeled a router *candidate*, nothing more,
and a MAC vendor match is labeled a guess. Pick which discovered hosts to
import into inventory; nothing already enrolled is ever duplicated or
deleted by a re-scan.

## Device enrollment

1. Open the Devices view, select (or create) a device.
2. Click **Edit settings** to set its management IP/hostname, port, and
   protocol(s) — or import one straight from network discovery.
3. Add a credential for it from the same panel (SSH: username + password
   or private key; Proxmox: an API token, or username + password;
   SNMPv3: auth/priv keys). It's encrypted immediately and never echoed
   back by any endpoint or shown in the UI again.
4. Click **Test connection** (calls the real `getHealth`), or wait for
   the next scheduled poll (`TRACE_METRICS_POLL_INTERVAL_MS`, default 5
   minutes).

### Proxmox integration — **live-verified against a real Beelink/Proxmox VE host**

Either an API token (`Datacenter → Permissions → API Tokens` in the
Proxmox web UI — recommended for anything beyond first testing, since a
token can be revoked independently of the account password) or the
account's own username + password works:

```json
{ "label": "beelink-proxmox", "protocol": "PROXMOX_API", "deviceId": "<hypervisor device id>",
  "payload": { "tokenUser": "root@pam", "tokenId": "trace", "tokenSecret": "<secret>" } }
```
```json
{ "label": "beelink-proxmox", "protocol": "PROXMOX_API", "deviceId": "<hypervisor device id>",
  "payload": { "username": "root@pam", "password": "<password>", "allowSelfSigned": true } }
```

Password auth is exchanged for a Proxmox session ticket on every call,
real-tested end to end: ONLINE status, 8 real metrics (CPU/memory/disk/
uptime) collected, and 4 real VMs/containers discovered into inventory
from an actual homelab Proxmox host — all confirmed to persist across a
backend restart. Proxmox's web UI serves a self-signed certificate by
default — TRACE verifies TLS and refuses to connect until you either
install a real certificate or explicitly add `"allowSelfSigned": true`
(a deliberate choice you make, not a default). The Proxmox *node name*
is auto-discovered when there's exactly one (the common single-host
case); a real cluster needs it set explicitly via the device's metadata
to disambiguate. Once enrolled, click **Discover guests** (or
`POST /infra/environments/:id/discovery/proxmox/:hypervisorDeviceId`) to
enumerate its VMs and containers into the topology — a re-run updates
existing ones in place rather than duplicating them.

### SSH configuration

```json
{ "label": "beelink-ssh", "protocol": "SSH", "deviceId": "<device id>",
  "payload": { "username": "gavin", "privateKey": "<PEM private key>" } }
```

The first successful connection to a host records its SSH host-key
fingerprint (trust-on-first-use, in-memory for the life of the process —
see `docs/ARCHITECTURE.md` "Known limitations"). Pin a fingerprint
explicitly via `hostKeyFingerprint` in the payload if you want that
checked from the very first connection instead.

## MCP configuration

TRACE's primary AI integration path — no Anthropic API key needed, works
with your existing Claude Code or Claude Desktop. (TRACE's *native* chat
assistant, in Settings, is the separate optional path that does need
your own Anthropic API key — see "Two AI integration surfaces" in
`docs/ARCHITECTURE.md` for how the two stay independent.) Administrative
and destructive tool calls (`trace_execute_command`,
`trace_execute_group_command`, `trace_perform_action`) never execute
directly — they create a pending action you approve in TRACE's own UI
(Settings → Pending approvals), the same gate the native assistant's own
tool calls use.

**Live-verified in an earlier session**: registered with a real Claude
Code CLI, a real client called 4 tools against the real backend and
real Beelink (16 tools, pre-dating the approval gate below). **Not
re-verified against a real Claude Code/Desktop process since** — see
`packages/mcp-server/README.md`'s "What's verified vs. what isn't" for
exactly what has and hasn't been exercised live.

See [`packages/mcp-server/README.md`](packages/mcp-server/README.md) for
the full 20-tool list and setup steps (Claude Code **and** Claude
Desktop). In short:

```bash
openssl rand -base64 32
```

Add to `apps/api/.env`:
```
TRACE_MCP_SERVICE_TOKEN="<token>"
TRACE_MCP_READ_ONLY=true
```
`TRACE_MCP_READ_ONLY=true` is strongly recommended to start — it
restricts *only* the service token to GET/HEAD/OPTIONS, so a brand-new
registration genuinely can't run a command or change anything until you
unset it. Build the server (`npm run build --workspace packages/mcp-server`),
then register it, passing the token directly as an env var for the MCP
process (stored in Claude Code's own `~/.claude.json`, mode `0600` — not
in this repo):

```bash
claude mcp add trace \
  -e TRACE_MCP_SERVICE_TOKEN=<token> \
  -e TRACE_API_BASE_URL=http://localhost:4000 \
  -- node /absolute/path/to/TRACE/packages/mcp-server/dist/index.js
```

Run `claude mcp list` (not `get` — see "Known limitations," `get` prints
the token in plain text) to confirm `trace` shows **✔ Connected**, then
ask Claude to call `trace_list_environments` as a harmless first test.

## Security model

- **Credentials** are AES-256-GCM encrypted before they ever reach
  Postgres. On macOS, the encryption key lives in your login Keychain
  (generated automatically on first run) — never in the database, never
  in a file this repo could commit. Set `TRACE_MASTER_KEY` only for
  CI/test or a non-macOS deployment (see `apps/api/.env.example`).
- **Auth**: one operator account (password + optional WebAuthn/YubiKey),
  session cookies, and a single fixed service token for the MCP server —
  no other way in. See `docs/ARCHITECTURE.md` "Security model" for the
  exact guard logic.
- **Policy**: destructive actions (stopping/rebooting a VM, running a
  command against more than one device) require an explicit
  `confirm: true`; read-only operations don't need it.
- Full detail, including what's deliberately *not* built yet (persisted
  host-key pinning, credential rotation, a remote access gateway): see
  `docs/ARCHITECTURE.md` "Known limitations".
- The optional ZimaBoard gateway (for reaching your homelab from outside
  your home network) is **documented, not built** — see
  `docs/ARCHITECTURE.md`. No router or ZimaBoard configuration was
  touched automatically.

## Development commands

```bash
npm run dev         # apps/web's dev server (apps/api: cd apps/api && npm run dev)
npm run build       # production build of every workspace
npm run lint        # ESLint across every workspace
npm run typecheck   # tsc --noEmit across every workspace
npm run test        # Jest across every workspace with tests
```

Each fans out via `--workspaces --if-present`, so adding a workspace with
matching scripts needs no root-level change.

## Troubleshooting

- **`npm run dev` for the backend returns 500s with "Cannot read
  properties of undefined"** on routes that look fine at startup: `tsx
  watch`'s esbuild-based transform doesn't reliably emit
  `emitDecoratorMetadata`, so some constructor-injected services come
  back `undefined`. Build and run the compiled server instead:
  `npm run build && npm run start` (or `node dist/main.js`) — confirmed
  this fixes it by comparing the exact same request against both.
- **`next build` fails with a Turbopack panic** ("binding to a port...
  Operation not permitted"): reproduced on two different machines with
  this Next.js version (16.4.2), including a real (non-sandboxed) Mac —
  this looks like a genuine Turbopack/macOS compatibility issue in this
  release, not an environment quirk. **Use `next build --webpack`** as
  the reliable local build; it produces the identical app. If you'd
  rather chase the Turbopack bug, a stale `.next` cache or another
  `next dev` instance holding Next.js's project-wide dev-server lock are
  the other usual suspects — `rm -rf apps/web/.next` and stop any other
  `next dev` first.
- **Network discovery finds live hosts via nmap but never any MAC
  address or vendor guess**, even though `arp -a` shows rich data when
  you run it yourself in Terminal: confirmed live that `arp -a` returns
  completely empty output when invoked from Node specifically (not from
  an interactive shell) — almost certainly macOS's "Local Network"
  privacy permission gating ARP visibility per requesting binary. Check
  **System Settings → Privacy & Security → Local Network** and ensure
  the app you're running TRACE's backend from (Terminal, or whichever
  app launched `node`) is enabled; if it isn't listed, running the
  backend once from a normal interactive Terminal session (not a
  background/headless process) is what gives macOS the opportunity to
  show the permission prompt. Discovery still works without this — it
  just can't suggest "likely NETGEAR switch" from a MAC prefix until
  it's granted.
- **`node dist/main.js` fails with "No driver (HTTP) has been
  selected... install @nestjs/platform-express"** even though it's
  installed: an npm workspace hoisting split across `node_modules`
  trees — see `docs/ARCHITECTURE.md` "Known limitations" for the exact
  fix (declaring the affected `@nestjs/*` packages in the root
  `package.json`). Already fixed in this repo; documented in case a
  future dependency change reintroduces it.
- **Database connection errors on startup**: confirm
  `docker compose up -d postgres` is running and `apps/api/.env`'s
  `DATABASE_URL` matches `docker-compose.yml` (port 5433, not 5432, to
  avoid clashing with any other local Postgres).

## Continuous integration

Every pull request runs lint, type-check, and a production build via
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Security principles

- No credentials are ever placed in frontend code, logged, or returned by
  any API response — they live encrypted in the database and decrypted
  only just-in-time, inside the specific connector call that needs them.
- Infrastructure discovery only ever touches what the operator explicitly
  asks it to (an IP, a CIDR range, an enrolled hypervisor) — TRACE never
  invents a target to scan.
- GitHub/third-party integrations must be explicitly authorized by the
  organization; no credentials, private message content, or browser
  activity are collected.

## License

[MIT](LICENSE)

## Contributing

This project is built in stages; each phase is implemented, verified, and
documented before the next one begins. See
[`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for the
complete, dated history of what's been built and verified, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the current
architecture and known limitations.
