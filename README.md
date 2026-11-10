# TRACE

TRACE is two products in one local-first, open-source monorepo:

1. **Developer intelligence** — visualizes an organization's departments,
   developers, GitHub activity, API usage, security events, and
   employee-endpoint devices as an interactive node graph.
2. **Infrastructure control plane** — discovers, enrolls, monitors, and
   administers real infrastructure (servers, VMs, hypervisors, switches,
   printers, …) through a unified device model, a command console, and an
   MCP server so Claude can operate it too.

They share a database connection and an HTTP server, nothing else — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the two are kept
separate, the infra module map, and the full security model.

## Status

Developer intelligence: phases 1–2 of the original roadmap (org graph,
GitHub integration, telemetry, security detection, device inventory) are
implemented and were verified against a live database in earlier sessions
— see [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) for the
full, dated log.

Infrastructure control plane: implemented this session (devices,
environments, SSH/Proxmox/SNMP connectors, credential encryption, auth,
command console, discovery, monitoring, MCP server, frontend). **Every
connector and service has real automated test coverage, and the compiled
server has been verified to actually boot** — but nothing has run against
a live database or real infrastructure in this environment. See
"What's tested" below before relying on this against your own homelab.

## What's tested

| Area | Tested how | NOT yet verified |
| --- | --- | --- |
| Backend logic (devices, environments, console, discovery, actions, monitoring, credentials, auth) | 198 Jest tests, each connector/service's own logic against a mocked transport | Against a live Postgres database |
| SSH connector | Unit tests mocking `ssh2`'s `Client` | Against a real SSH host (point it at your Beelink to find out) |
| Proxmox connector | Unit tests mocking `node:https` | Against a real Proxmox VE cluster |
| SNMP connector | Unit tests mocking `net-snmp` | Against a real SNMPv3-capable switch |
| Local discovery (interfaces/ARP/ping/nmap) | Unit tests mocking `child_process`/`os` | Runs real commands on whatever machine executes it — genuinely works, just not exercised against your actual LAN here |
| WebAuthn/YubiKey | Unit tests mocking `@simplewebauthn/server` (challenge/credential logic) | The real browser+hardware ceremony |
| MCP server | **A real `@modelcontextprotocol/sdk` `Client` connects over the SDK's in-memory transport and calls tools end-to-end** (`packages/mcp-server/src/server.integration.spec.ts`) | Registering it with an actual Claude Code CLI session |
| NestJS dependency wiring | `infra.module.spec.ts` resolves the entire DI graph; the **compiled server was actually booted** (`node dist/main.js`) and mapped every route, failing only at the Postgres connection | — |
| Frontend (`/infra`) | `tsc --noEmit`, ESLint, and a production build (via webpack — see Troubleshooting) all pass | Never opened in a browser in this environment — no live backend to click through against |

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
npm run dev                         # API on http://localhost:4000

# in a second terminal
cd apps/web
cp .env.example .env.local          # adjust if needed
npm run dev                         # frontend on http://localhost:3000
```

Open `http://localhost:3000` for the developer-intelligence graph, or
`http://localhost:3000/infra` for the infrastructure control plane (a
small badge in the corner links between the two). The infra page's first
load asks you to set up the one operator account (email + password) — see
"Security model" below for WebAuthn/YubiKey.

## Device enrollment

1. Open `/infra`, select (or create) an environment.
2. Create a device (name, category, IP address if known) — or run
   discovery first (`POST /infra/environments/:id/discovery/...`, or the
   corresponding MCP tool) and enroll a discovered one.
3. Add a credential for it: SSH (username + password or private key),
   Proxmox (API token), or SNMPv3 (auth/priv keys) — via
   `POST /infra/environments/:id/credentials`. The payload is encrypted
   immediately and never echoed back by any endpoint.
4. Click "Check health" on the device, or wait for the next scheduled
   poll (`TRACE_METRICS_POLL_INTERVAL_MS`, default 5 minutes).

### Proxmox integration

Create an API token in the Proxmox web UI (`Datacenter → Permissions → API
Tokens`), then enroll a credential with:

```json
{ "label": "beelink-proxmox", "protocol": "PROXMOX_API", "deviceId": "<hypervisor device id>",
  "payload": { "tokenUser": "root@pam", "tokenId": "trace", "tokenSecret": "<secret>" } }
```

Proxmox's web UI serves a self-signed certificate by default — TRACE
verifies TLS and will refuse to connect until you either install a real
certificate or explicitly add `"allowSelfSigned": true` to the payload
(a deliberate choice you make, not a default). Once enrolled, run
discovery (`POST /infra/environments/:id/discovery/proxmox/:hypervisorDeviceId`)
to enumerate its VMs and containers into the topology.

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

See [`packages/mcp-server/README.md`](packages/mcp-server/README.md) for
the full tool list and setup steps. In short:

```bash
openssl rand -base64 32   # put this in both places below
```

Add to `apps/api/.env`: `TRACE_MCP_SERVICE_TOKEN=<token>`. Build the
server (`npm run build --workspace packages/mcp-server`), then register
it with Claude Code:

```bash
claude mcp add trace -- node /absolute/path/to/TRACE/packages/mcp-server/dist/index.js
```

with `TRACE_MCP_SERVICE_TOKEN` and `TRACE_API_BASE_URL` set in its
environment. Run `/mcp` in Claude Code to confirm it connected, then ask
Claude to call `trace_list_environments` as a harmless first test.

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

- **`next build` fails with a Turbopack panic** ("binding to a port...
  Operation not permitted"): this is an environment/sandbox restriction
  on spawning a listening socket, not a code issue — confirmed by
  building the same code successfully with `next build --webpack`. If
  you hit this on your own Mac (not just a sandboxed CI runner), it's
  usually a stale `.next` cache or another `next dev` instance still
  holding Next.js's project-wide dev-server lock; stop it and
  `rm -rf apps/web/.next` first.
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
