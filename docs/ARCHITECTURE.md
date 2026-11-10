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
| `ai` | The native AI assistant (TRACE v0.3) — see "Two AI integration surfaces" below. |
| `approvals` | `AiPendingAction` — the one approval queue both AI surfaces share (TRACE v0.4). |
| `mcp` | Read-only MCP connection status for the Settings page — never the service token's value. |

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

## Two AI integration surfaces

TRACE supports two independent ways to drive it with AI — "independent"
meaning either can be absent with the other fully functional, and both
are consumers of the same backend services, never a second
implementation of them:

1. **Native AI assistant** (`apps/api/src/infra/ai`,
   `apps/web/components/ai`) — optional, requires the operator's own
   Anthropic API key (Settings → Native AI assistant). A chat panel
   built into the browser UI.
2. **MCP integration** (`packages/mcp-server`, plus the gating this
   phase added to `ConsoleController`/`ActionsController`) — primary,
   no Anthropic API key needed at all. Lets an already-running Claude
   Code or Claude Desktop connect to TRACE directly, using whichever
   Claude subscription that client already has.

Both share the same tool-execution reality: every capability either
surface exposes dispatches to the exact same
`EnvironmentsService`/`InfraDevicesService`/`DevicePollingService`/
`TopologyService`/`CommandExecutionService`/`ActionsService`/
`DiscoveryScanService` methods the browser console itself calls — no
second Proxmox/SSH/SNMP client exists anywhere in either integration.
They are deliberately kept as two separate call paths rather than one
layered on the other: `AiController` refuses the MCP service-token actor
(`claude-mcp`) on every one of its routes, and nothing in
`packages/mcp-server` calls into `apps/api/src/infra/ai` — each surface
can be removed independently without the other noticing.

### Native AI assistant

- **Providers** (`ai/providers`) — `AiProvider` is the only interface
  `ai-chat.service.ts` and the tool registry know about; `AnthropicProviderService`
  is the one implementation today. Adding OpenAI/a local model later
  means a new provider service plus a branch in `AiSettingsService`,
  never a change to the orchestration code.
- **Tool classification** (`ai-tools.registry.ts`) — every tool is
  `READ_ONLY` (auto-executes), `ADMINISTRATIVE`, or `DESTRUCTIVE`.
  `perform_action`'s classification is computed from its `action`
  argument against `ActionsService.DESTRUCTIVE_ACTIONS` (exported,
  imported — not a second list that could drift).
- **Conversation persistence** (`ai-conversations.service.ts`) —
  `AiConversation`/`AiMessage`/`AiPendingAction` in Postgres, scoped to
  `(environmentId, actor)`; every mutation checks ownership first.
- **Secret redaction** (`secret-redaction.ts`, now shared — see below)
  — applied to tool inputs/outputs before they're persisted or fed back
  to the model, as defense in depth. The primary control is structural:
  no tool handler ever calls `CredentialsService.getDecryptedForDevice`
  or returns a connector credential — every handler calls the same
  controller-reachable service methods the REST API itself exposes.
- **Known, stated scope cut**: approving a pending action executes it
  and persists the result as its own `TOOL`-role message, but does not
  resume the paused Anthropic tool-use turn so the model can narrate the
  result in its own next sentence — that turn's provider-message history
  already ended when the stream yielded `pending_approval`. The UI
  renders the result as its own card; asking a follow-up question (e.g.
  "is it back online now?") works normally and the model can call
  `check_device_health` etc. to see the aftermath itself.
- **Frontend** (`apps/web/components/ai`) — `AiChatPanel` is mounted
  once in `Workspace.tsx`, not per-view, so it's reachable from every
  view. `MarkdownLite` is a small hand-rolled renderer (fenced code,
  inline code, bold/italic, links, lists, headers) rather than a
  `react-markdown` dependency — `apps/web` has no Markdown dependency
  today and the assistant's responses don't need tables/images/footnotes.

### MCP integration (TRACE v0.4)

`packages/mcp-server` is a thin MCP server (stdio transport only — no
HTTP/SSE listener, so no new network attack surface) exposing 20 tools
to any MCP client; see that package's own README for the full list and
setup (Claude Code and Claude Desktop both use the identical
command/args/env shape). It authenticates to TRACE's API with a fixed
bearer token (`TRACE_MCP_SERVICE_TOKEN`), set once in `apps/api/.env` —
unrelated to, and never billed against, any Anthropic API key.
`TraceAccessGuard` assigns the `claude-mcp` actor to any request bearing
that token (see `auth/mcp-actor.ts`), never to a browser session.

**Administrative/destructive operations cannot bypass approval through
MCP.** Before this phase, `trace_execute_command`/
`trace_execute_group_command`/`trace_perform_action` passed a client-
supplied `confirm` flag straight through to the backend, which executed
immediately if it was `true` — meaning an external MCP client (not a
human looking at TRACE's own UI) could self-authorize a destructive
action, inconsistent with the native assistant's own stronger,
structural approval gate. Now, `ConsoleController.exec`/`execGroup` and
`ActionsController.perform` check the caller's actor first: for
`claude-mcp`, they ignore `confirm` and instead call
`ApprovalsService.create` (same service, same `AiPendingAction` table,
same Settings → Pending approvals queue the native assistant's own
gated tool calls land in) and return
`{ pending: true, pendingActionId, classification, message }` instead
of executing. A real browser session's own calls to these same
endpoints are completely unaffected — the check is purely on `req.actor`.

- **`approvals/approvals.service.ts`** (moved out of `ai/`, this
  phase) — the shared enforcement point for "an AI surface can propose
  a gated action but never approve its own": `create` is called from
  the native assistant's tool-call loop *and* from the two MCP-actor
  gates above; `decide` is called from exactly one place,
  `AiController`'s `approve`/`reject` endpoints, which require a real
  browser-session request and additionally refuse a
  `claude-mcp`-prefixed decider as defense in depth. `AiPendingAction
  .conversationId` is nullable (migration `20261110141325_mcp_shared_approvals`)
  specifically so an MCP-proposed action — which has no chat
  conversation — can still use this exact same table and queue.
- **Read-only exception**: `GET .../ai/pending-actions/:id` (check one
  action's status) is the one AI-related route *not* restricted to a
  browser session — an MCP client needs to ask "is my proposed action
  done yet?" (`trace_get_pending_action_status`), which discloses
  nothing it couldn't already see and cannot approve anything.
- **Settings UI** (`apps/web/components/mcp/McpSettingsPanel.tsx`) —
  connection instructions and copy-paste `claude mcp add`/Claude Desktop
  config snippets, plus a live status check
  (`GET /infra/mcp/status`, `mcp-status.controller.ts`) that reports
  only whether `TRACE_MCP_SERVICE_TOKEN` is set and whether
  `TRACE_MCP_READ_ONLY` is on — never the token's value. There is
  deliberately no "generate/rotate the token from the browser" flow;
  it stays a `.env` value, consistent with every other secret in this
  app never round-tripping through the browser.
- **Pending-approvals UI**
  (`apps/web/components/ai/PendingApprovalsPanel.tsx`) — lists every
  `PENDING` `AiPendingAction` in the environment regardless of which
  surface proposed it, reusing `ApprovalCard` and the exact same
  approve/reject endpoints the chat panel uses. This is the one place
  a human sees and decides an MCP-proposed action, which — unlike a
  chat message — has no conversation to render an inline card inside.

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
- **Approving an AI-proposed action does not resume that turn's model
  conversation for a narrated follow-up** — see the AI assistant
  section above. The result is a UI card, not a generated sentence;
  genuinely a scope cut, not a bug.
- **The AI assistant has not been exercised end to end with a real
  Anthropic API key in this environment** — the full tool-use/approval/
  persistence loop is covered by 53 Jest tests against a mocked
  `AnthropicProviderService`, and the actor/authorization boundary was
  confirmed live over real HTTP (unauthenticated → 401, the MCP service
  token → 403 with the expected message), but no real `sk-ant-...` key
  has been entered into Settings and used to hold an actual streamed
  conversation here. Do that once before relying on it.
- **Secret redaction in `secret-redaction.ts` is pattern-based
  defense in depth, not the primary control** — see that file's own
  header comment. It will not catch every possible secret shape; the
  real guarantee is structural (no AI tool handler ever receives a
  decrypted credential in the first place).
- **No rate-limit/retry logic was hand-written for the Anthropic
  provider** — `@anthropic-ai/sdk`'s own `maxRetries`/`timeout` client
  options are used as-is; a 429 that outlives the SDK's own retries
  surfaces to the user as a plain error with `retryable: true`, with no
  additional backoff loop in TRACE's own code.
- **The MCP approval gate (TRACE v0.4) has not been exercised with a
  real Claude Code or Claude Desktop process issuing the destructive
  call** — the gate itself (controller-level actor check →
  `AiPendingAction` row → browser-only approve/reject) is covered by
  unit tests and a live, un-mocked HTTP check of the surrounding
  authorization boundaries (401/403s, the pre-existing
  `TRACE_MCP_READ_ONLY` block still working), but the full "MCP client
  proposes → human approves in the UI → it actually runs" path was not
  run end to end against a live, non-read-only backend in this
  environment, and no real Claude Code/Desktop session has exercised
  any of the 4 tools added this phase. See `packages/mcp-server/README.md`'s
  "What's verified vs. what isn't" for the precise split.
- **No token rotation/generation UI** — `TRACE_MCP_SERVICE_TOKEN` stays
  a `.env` value, set via `openssl rand -base64 32` and a server
  restart, same as before this phase. The Settings page's MCP panel
  shows setup instructions and a configured/not-configured status, not
  a "click to generate" flow — deliberately, since that would mean
  either returning the token to the browser once or storing it
  somewhere other than the environment `TraceAccessGuard` already
  trusts.
