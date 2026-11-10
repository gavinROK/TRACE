# TRACE architecture

TRACE is two products in one repository, sharing a database connection and
a NestJS process but nothing else in their domain models:

1. **Developer intelligence** (`apps/api/src/{organizations,github,
   telemetry,security,devices,graph}`) — the original product. Tracks an
   organization's departments, developers, GitHub activity, API usage,
   and employee-endpoint device inventory (laptops, not infrastructure).
   Unchanged by the infra work below.
2. **Infrastructure control plane** (`apps/api/src/infra/*`) — everything
   this phase added: discovering, enrolling, monitoring, and administering
   real infrastructure (servers, VMs, switches, printers, …).

They share nothing but the Prisma client and the HTTP server. An
`InfraDevice` is not a `Device`; an `InfraEnvironment` is not an
`Organization`. See `apps/api/prisma/schema.prisma`'s "Infrastructure
control plane" section comment for the full data model.

## Module map (`apps/api/src/infra`)

| Module | Owns |
| --- | --- |
| `environments` | `InfraEnvironment` CRUD — the tenant boundary for everything below. |
| `devices` | `InfraDevice` CRUD, capability derivation, dashboard summary. |
| `credentials` | AES-256-GCM encryption of secrets; the macOS Keychain-backed master key. |
| `connectors` | One class per management protocol (SSH, Proxmox API, SNMPv3), behind a shared `InfraConnector` interface. |
| `discovery` | Local network probes (interfaces, ARP, ping, optional nmap) and Proxmox-driven VM/container enumeration. |
| `console` | The command-execution engine — device-name resolution, bounded concurrency, timeouts, cancellation, history. |
| `actions` | `performAction` dispatch (start/stop/reboot a VM, …), with a confirm-gate for destructive actions. |
| `monitoring` | Scheduled + on-demand polling that calls a connector's `getHealth`/`getMetrics` and persists real samples. |
| `topology` | Assembles the graph (nodes + verified/inferred edges) the frontend renders. |
| `audit` | The security/audit trail — every credential change, command, and action. |
| `auth` | Password + WebAuthn login, cookie sessions, and the combined guard the MCP service token also goes through. |

Every one of these is a real NestJS module with its own controller,
service, and Jest tests — not a stub. `src/infra/infra.module.ts` wires
them together; `src/infra/infra.module.spec.ts` resolves the entire
dependency graph as a test, which is what actually caught the
dependency-hoisting bug described below.

## Connectors

`InfraConnector` (`connectors/connector.types.ts`) is the interface from
the product spec: `getCapabilities`, `getHealth`, `getMetrics`,
`getConfiguration`, `executeCommand`, `performAction`, `discover` — every
method but `getCapabilities` is optional, and a connector only implements
what the real protocol actually supports. `InfraDevicesService` only
reports a capability to the frontend when **both** the device claims the
protocol **and** the connector for it implements the method — this is the
single enforcement point for "don't show a control that isn't real."

- **SSH** (`ssh2`) — real command execution, health (a trivial `true`
  exec), and metrics (one probe command parsing `/proc/loadavg`,
  `free -b`, `/proc/uptime`, `df`). Trust-on-first-use host-key pinning,
  with a per-device fingerprint override once you've recorded one.
- **Proxmox API** (`node:https`, no extra dependency) — node/VM/container
  discovery, health, metrics, and start/stop/shutdown/reboot. Verifies TLS
  by default; a device's credential can opt into `allowSelfSigned` once
  the operator has actually decided to accept a self-signed cert's risk.
- **SNMPv3** (`net-snmp`) — read-only: `sysDescr`/`sysUpTime` and an
  interface-table walk for link speed. Deliberately has no
  `executeCommand`/`performAction` — SNMP read access must never be
  treated as implying write/configuration access.
- **Documented, not implemented**: Windows (WinRM), Docker, ZimaBoard,
  router management, JetKVM, Bambu Lab. Each needs its actual protocol
  verified against the real device before a connector is written — see
  "Known limitations" below.

## Security model

- **Credentials** are encrypted at rest (AES-256-GCM, Node's built-in
  `crypto` — no custom cryptography) before ever reaching Postgres. The
  master key lives in the macOS Keychain (`security` CLI, invoked via
  `execFile` with a fixed argument array — never a shell string), not in
  the database or a file this repo could commit. No controller endpoint
  ever returns a decrypted payload; `CredentialsService.getDecryptedForDevice`
  is called only by connectors/console/monitoring, never by anything that
  produces an HTTP response.
- **Auth**: a single operator account (password, bcrypt-hashed) plus
  optional WebAuthn (YubiKey) second factor. Sessions are opaque random
  tokens; only their SHA-256 hash is persisted (same pattern as the
  developer-intelligence module's `ApiKey.hashedKey`). `TraceAccessGuard`
  accepts either a valid session cookie (the browser) or a fixed
  `TRACE_MCP_SERVICE_TOKEN` bearer token (the MCP server only) — there is
  no third "trust the caller" path. Setting `TRACE_MCP_READ_ONLY=true`
  additionally restricts *only* the service token (never a browser
  session) to GET/HEAD/OPTIONS — meant for verifying a new MCP
  registration before trusting it with write access; live-verified end
  to end (`trace_execute_command` correctly 403s under this flag, both
  over raw HTTP and through a real MCP client call).
- **Policy**: read-only operations (health checks, listing, metrics) run
  without extra gating. Destructive actions (`stop`/`shutdown`/`reboot`
  on a VM, running a command against more than one device at once)
  require an explicit `confirm: true` in the request body, checked
  server-side — `ActionsService`/`ConsoleController`.
- **Command execution** never does shell interpolation: SSH commands are
  sent as a single string to `ssh2`'s `exec()` (which the remote shell
  parses, same as a real SSH session — TRACE never builds a shell command
  by concatenating untrusted input into one locally executed via
  `exec()`/`spawn()` with `shell: true`), and every `execFile` call
  elsewhere (Keychain, `arp`, `ping`, `nmap`) passes a fixed argument
  array, never a template string.
- **MCP**: the server (`packages/mcp-server`) is a thin REST client — it
  never re-implements connector logic, and it never receives a
  credential. Claude only ever sees what TRACE's own API already decided
  it's allowed to return.

## Known limitations

- **The backend's `npm run dev` (`tsx watch`) silently breaks dependency
  injection for some services.** `tsx`'s esbuild-based transform doesn't
  reliably emit `emitDecoratorMetadata` the way `tsc` does — a
  constructor-injected service can come back `undefined` at request
  time with no error at startup (confirmed live: `TraceAuthService`
  injected into `TraceAuthController`/`TraceAccessGuard` was `undefined`
  under `tsx watch` and correctly populated in the identical compiled
  build). Build and run the compiled server
  (`npm run build && npm run start`) instead until this is root-caused.
- **`arp -a` returns completely empty output when invoked from Node on
  at least one real macOS machine, even though the same command run
  directly in a shell shows a fully populated ARP table.** Confirmed via
  `execFile`/`exec`/`spawn`, all empty with exit code 0 and no error —
  almost certainly macOS's "Local Network" privacy permission gating
  ARP cache visibility per requesting binary (Terminal/shell has
  presumably been granted it at some point; a freshly-spawned `node`
  process hasn't, and there's no way to trigger the permission dialog
  from a non-interactive process). `route -n get default` (gateway
  detection) and `nmap -sn` (ping sweep) are unaffected — discovery
  still finds real hosts and the likely router, it just can't attach a
  MAC address or vendor guess until this is granted. See the README's
  Troubleshooting for how to check/grant it.
- **`next build` (Turbopack) fails with a panic ("binding to a
  port... Operation not permitted") on this Next.js version (16.4.2),
  reproduced on two different machines including a real, unsandboxed
  Mac.** This looks like a genuine Turbopack/macOS compatibility issue
  in this release, not an environment-specific quirk. `next build
  --webpack` produces an identical app and is the documented reliable
  path — see the README's Troubleshooting.
- **The Proxmox connector auto-discovers the cluster node name only
  when there's exactly one** (`ProxmoxConnector.requireNode`) — found
  live: nothing ever set `metadata.node` for a manually-enrolled
  hypervisor device (only VMs/containers created via
  `proxmox-discovery.service.ts` had it), so every health check on a
  manually-enrolled Proxmox host threw until this fallback was added. A
  real multi-node cluster still needs `metadata.node` set explicitly —
  guessing which node a device means would be an invented fact.
- **WebAuthn/YubiKey is unit-tested against a mocked
  `@simplewebauthn/server`, never against a real browser + hardware
  security key in this environment.** The registration/assertion logic
  (challenge bookkeeping, credential storage, counter updates) has
  automated coverage; the actual WebAuthn ceremony has not been run.
  Verify this yourself once you have a browser and a YubiKey: register
  one via the UI, sign out, sign back in with it.
- **Challenges for in-flight WebAuthn ceremonies are kept in memory**
  (`WebauthnService`), not persisted — a server restart mid-registration
  loses that specific attempt (not any already-registered credential).
  Acceptable for a single-operator local app; would need a real store for
  multi-instance deployment.
- **The master key store has no persisted host-key or Keychain migration
  path** — if you ever need to rotate `TRACE_MASTER_KEY`, every existing
  `InfraCredential` row becomes undecryptable (there is no re-encryption
  tool yet). Back up credentials via re-entering them, not via the
  database, until this exists.
- **SSH host-key trust-on-first-use is in-memory per process**, not
  persisted across restarts — a restarted API will silently re-trust
  whatever key a host presents on its next first connection. Pin a
  fingerprint in the device's credential (`hostKeyFingerprint`) if you
  need persistence today.
- **Live-infrastructure testing so far covers Proxmox and local network
  discovery, not SSH or SNMP.** The Proxmox connector and the local
  discovery scan have both been run against a real homelab (a real
  Beelink/Proxmox VE host, a real LAN); the SSH and SNMPv3 connectors
  still have only unit-test coverage against a mocked transport (`ssh2`,
  `net-snmp`) — neither has been run against a real Linux host or a real
  managed switch. See the root README's "What's tested" for the exact,
  current split.
- **`@nestjs/schedule`'s and `@nestjs/mapped-types`'s current npm
  releases ship ESM-only** (`"type": "module"`), which a CommonJS-compiled
  NestJS app cannot `require()` at runtime (confirmed by actually booting
  the compiled server, not just `tsc --noEmit` — see the DEVELOPMENT_STATUS
  log). Pinned `@nestjs/schedule` to `6.1.3` (last CJS release) and
  hand-wrote `UpdateInfraDeviceDto` instead of using `@nestjs/mapped-types`'
  `PartialType`.
- **npm workspace hoisting can split `@nestjs/core`/`common` from
  `@nestjs/platform-express`/`config`/`schedule` across two different
  `node_modules` trees**, which breaks NestJS's internal package loader at
  runtime ("No driver (HTTP) has been selected") even though `tsc` and
  Jest never notice (they resolve node_modules differently than Nest's
  own `require()`-relative-to-itself loader does). Fixed by declaring
  those packages directly in the **root** `package.json` so npm hoists
  all of them to the same place — if you add another `@nestjs/*` package
  to `apps/api` later and see this error again, add it to root
  `package.json` too.
- **`@modelcontextprotocol/sdk`'s `server.tool()`/`registerTool()`
  TypeScript signature is expensive enough to type-check that registering
  more than a handful of tools with object schemas directly against it
  sent `tsc` into a multi-minute (and sometimes stack-overflowing)
  type-inference loop.** `packages/mcp-server/src/server.ts` works around
  this with one type assertion narrowing the call shape — see that file's
  top comment. Runtime behavior (including zod validation) is unaffected.
- **`claude mcp get <name>` prints a registered server's env vars —
  including any secret token passed via `-e` — in plain text to the
  terminal.** This is the Claude Code CLI's own documented behavior
  (it's showing *you* your own config), not a TRACE bug, but it means
  running `get` anywhere the output might be logged, screen-shared, or
  pasted is a real exposure path. `claude mcp list` shows connection
  status without this risk — prefer it for routine checks; rotate the
  token (regenerate, update `apps/api/.env`, `claude mcp remove` +
  `add` again) if `get`'s output is ever shared.
- **`packages/mcp-server`'s `tsconfig.json` originally had `rootDir:
  "."` while its sources live under `src/`, so `tsc` emitted to
  `dist/src/index.js` instead of the `dist/index.js` that
  `package.json`'s `main`/`bin` fields and this README's own
  `claude mcp add` example both assumed.** Found by actually checking
  the build output before registering it, not by the build "succeeding"
  — `tsc` gave no error either way. Fixed by setting `rootDir: "./src"`.
- **No `trace_get_services` MCP tool / service-level inspection.** Nothing
  in the backend inspects what services run on a device (beyond SSH
  command output) — this is listed in the product spec as a tool name but
  has no real implementation to back it, so it was left out rather than
  faked.
- **No interactive terminal session** (a real PTY/streaming shell) — the
  console runs one command at a time and returns its full output once
  finished, not a live interactive shell.
- **The topology layout (`lib/infra-layout.ts`) is a simple BFS layered
  layout**, fine for a homelab-scale topology (tens of devices); a denser
  environment would want a real graph-layout library.
