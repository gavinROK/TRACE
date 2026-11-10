# @trace/mcp-server

An MCP (Model Context Protocol) server that exposes TRACE's infrastructure
control plane to Claude Code, Claude Desktop, or any other MCP client. It
is a thin client over TRACE's own REST API — every tool call here goes
through the exact same backend code (connectors, credential decryption,
audit logging) as the browser console. It never builds a separate
management implementation, and it never has access to a raw stored
credential: TRACE's API responses never include one.

**No Anthropic API key or API credits required.** This is a separate
integration surface from TRACE's own optional native AI assistant (see
`docs/ARCHITECTURE.md`'s "Two AI integration surfaces") — MCP uses
whatever Claude subscription/login your MCP client (Claude Code, Claude
Desktop) already has. `TRACE_MCP_SERVICE_TOKEN` below is TRACE's own
bearer secret, unrelated to and never charged against any Anthropic
billing.

## Tools

| Tool | What it does | Gated? |
| --- | --- | --- |
| `trace_list_environments` | List every infrastructure environment. | read-only |
| `trace_list_devices` | List devices in one environment. | read-only |
| `trace_list_unenrolled_devices` | Devices discovered but not yet enrolled. | read-only |
| `trace_get_topology` | Get the device graph (nodes + verified/inferred edges). | read-only |
| `trace_get_device` | Full detail for one device. | read-only |
| `trace_get_vm_inventory` | VMs/containers hosted on a given hypervisor device. | read-only |
| `trace_get_capabilities` | Just a device's supported capabilities. | read-only |
| `trace_get_health` | Actively check a device's reachability (read-only). | read-only |
| `trace_get_metrics` | Historical metric samples for a device. | read-only |
| `trace_get_logs` | The environment's audit log. | read-only |
| `trace_list_alerts` | Honestly reports TRACE has no alerting engine yet, plus the closest available signals. | read-only |
| `trace_execute_command` | **Propose** running a shell command on one device over SSH. | **approval required** |
| `trace_execute_group_command` | **Propose** running a shell command across multiple devices. | **approval required** |
| `trace_perform_action` | **Propose** start/stop/reboot a VM, etc. | **approval required** |
| `trace_get_pending_action_status` | Check whether a proposed action above has been approved/rejected yet. | read-only |
| `trace_get_operation_status` | Check the status of a previously started (and approved) command run. | read-only |
| `trace_diagnose_device` | Explain exactly why a device isn't connected (missing address, missing credential, unreachable) instead of a generic error. | read-only |
| `trace_detect_local_network` | Detect TRACE's own machine's active interface, subnet, and default gateway. | read-only |
| `trace_scan_network` | Scan a subnet for devices (ARP + optional nmap ping sweep, no port scanning). | read-only |
| `trace_update_device` | Update a device's non-secret settings (name, IPs, port, protocols, tags, notes) — never accepts a credential. | **approval required** |
| `trace_run_diagnostic` | Read-only inspection on a device: OS info, CPU/memory/disk, network interfaces, service status, system logs, process list, package inventory, firewall rules, filesystem info, or a structured security-posture assessment. SSH hosts today. | read-only |

**The four "approval required" tools never execute anything directly.**
Calling one creates an `AiPendingAction` row and returns
`{ pending: true, pendingActionId, classification, message }` instead of
a result — a human must approve it from TRACE's own web UI (Settings →
Pending approvals) before it runs. This is enforced by TRACE's backend
(`ConsoleController`/`ActionsController`/`InfraDevicesController` each
check the caller's actor, independent of any `confirm` flag the tool
call itself sends), not by
this package or by trusting the calling client to ask first — see
`docs/ARCHITECTURE.md`'s "MCP integration" section for why. Poll
`trace_get_pending_action_status` (or just ask the user to check TRACE)
to see the real outcome once approved. This is the exact same approval
queue, and the exact same `AiPendingAction` database rows, that TRACE's
native chat assistant's own administrative/destructive tool calls use —
one shared security control, not two.

SSH hosts now support structured diagnostics (`trace_run_diagnostic`) and
a curated set of administrative actions through `trace_perform_action`
(`service_start`/`service_stop`/`service_restart`/`service_enable`/
`service_disable`/`package_install`/`reboot`) — see
`docs/ARCHITECTURE.md`'s "Infrastructure execution framework" section
for the full catalog, the identifier-allowlist validation that makes
interpolating a service/package name into a shell command safe, and
what's deliberately out of scope (arbitrary firewall-rule edits, a write
path for any protocol besides SSH).

Not implemented (see the root README's "Current limitations"):
interactive terminal sessions, importing a discovered candidate into inventory (use the UI's Discover My Network flow for that — it needs an explicit per-candidate choice, which doesn't fit a single tool call well), VM/container provisioning, Windows/WinRM or Docker API management, Docker container inspection, SFTP, HTTP/DNS/TLS website diagnostics.

## Setup

1. Start the TRACE API (`apps/api`) — see the root README's Quick start.
2. Generate a service token:
   ```bash
   openssl rand -base64 32
   ```
3. Add to `apps/api/.env`:
   ```
   TRACE_MCP_SERVICE_TOKEN="<the token>"
   TRACE_MCP_READ_ONLY=true
   ```
   **`TRACE_MCP_READ_ONLY=true` is strongly recommended for initial
   setup** — it restricts the service token to GET/HEAD/OPTIONS only, so
   the very first time this is wired up, Claude genuinely cannot run a
   command or change anything through it, only read. A browser session
   is never affected by this flag. Unset it once you've verified the
   connection and are ready to let Claude execute commands/actions.
4. Build this package (this also regenerates the Prisma-adjacent `dist/`
   layout flat at `dist/index.js`, matching `package.json`'s `main`):
   ```bash
   npm run build --workspace packages/mcp-server
   ```
5. **Claude Code** — register it, passing the token as an environment
   variable for the MCP server process directly; `-e` values are stored
   in Claude Code's own project config (`~/.claude.json`, `0600`
   permissions), not in this repo:
   ```bash
   claude mcp add trace \
     -e TRACE_MCP_SERVICE_TOKEN=<the token> \
     -e TRACE_API_BASE_URL=http://localhost:4000 \
     -- node /absolute/path/to/TRACE/packages/mcp-server/dist/index.js
   ```
   Run `claude mcp list` to confirm `trace` shows **✔ Connected** — note
   that `claude mcp get trace` (unlike `list`) prints the configured
   token in plain text to your terminal, by design (it's showing you
   your own config); avoid running `get` where the output might be
   logged or shared, and rotate the token if it ever is.

   **Claude Desktop** — add the same command/args/env to its
   `claude_desktop_config.json` (Settings → Developer → Edit Config):
   ```json
   {
     "mcpServers": {
       "trace": {
         "command": "node",
         "args": ["/absolute/path/to/TRACE/packages/mcp-server/dist/index.js"],
         "env": {
           "TRACE_MCP_SERVICE_TOKEN": "<the token>",
           "TRACE_API_BASE_URL": "http://localhost:4000"
         }
       }
     }
   }
   ```
   Both clients use the identical stdio transport (this server speaks
   only stdio — no HTTP/SSE listener, no additional network attack
   surface) with the same `command`/`args`/`env` shape; TRACE's Settings
   page (Settings → MCP integration) shows both snippets with a copy
   button and a live "is `TRACE_MCP_SERVICE_TOKEN` configured" status
   check (never the token's actual value).
6. Restart Claude Code/Desktop after editing its config, then try a
   harmless read-only call: ask it to run `trace_list_environments`.

## What's verified vs. what isn't

- **Verified in this repo's test suite**: the MCP protocol wiring itself —
  `src/server.integration.spec.ts` connects a real `@modelcontextprotocol/sdk`
  `Client` to this server over the SDK's in-memory transport (the same
  protocol layer Claude Code's MCP integration uses), lists all 21 tools
  (tool discovery), calls several of them end to end including the
  approval-gated ones (confirming they pass through the backend's
  `{pending: true, ...}` response rather than claiming success), and
  confirms `trace_get_pending_action_status` never approves anything
  itself. Only the HTTP layer underneath `TraceClient` is faked there,
  since there's no live TRACE API in CI.
- **Verified live (an earlier session), once, against a real `claude mcp
  add` registration**: a real `@modelcontextprotocol/sdk` `Client`
  connected over real stdio to the compiled `dist/index.js`, which called
  a real running TRACE API backed by a real Postgres database. Listed
  the (then-16) tools, retrieved real inventory and a real enrolled
  device's real Proxmox status/metrics/topology, and confirmed
  `trace_execute_command` is correctly blocked (403, surfaced as a tool
  error, not a crash) when `TRACE_MCP_READ_ONLY=true`. `claude mcp list`
  reported **✔ Connected**. This predates the approval-gating and the 4
  new tools added since — see the next line.
- **Verified live (TRACE v0.5), through this exact already-`claude mcp
  add`-registered session's real stdio connection**: `trace_perform_action`
  against a real disposable SSH container, both a benign `package_install`
  and a command-injection attempt in `params` — both correctly came back
  `{ pending: true, ... }`, never executed, and the pending action's
  stored `toolInput` preserved the exact unaltered params for a human
  reviewer. `trace_get_health`/`trace_list_devices`/`trace_get_device`
  against the same real device. **`trace_run_diagnostic` itself was
  *not* exercised through this live stdio connection** — the bridge
  process was already running (spawned by `claude mcp add` before this
  tool existed) and needs a reconnect (`/mcp`, or restarting Claude Code)
  to pick up the rebuilt `dist/index.js`; it was instead verified over
  raw HTTP with the same bearer token the bridge itself would use,
  against the real container (`os_info`, `security_posture`,
  `firewall_rules`, injection rejection, a clean 404 for an unknown
  device, a clean 502 for an unreachable one) — see
  `docs/ARCHITECTURE.md`'s "Known limitations" for what that live run
  also found (a sshd-config check gap, a firewall-tool-missing gap, a
  non-systemd-init gap).
- **Verified live (an earlier session this phase), over real HTTP,
  without a real MCP client**: with a real running API and a real
  service token, confirmed
  (a) an unauthenticated request still gets 401, (b) the MCP actor gets
  403 from the browser-only `/infra/mcp/status` and `/infra/ai/pending-actions`
  endpoints, (c) `TRACE_MCP_READ_ONLY=true` still blocks a POST to the
  actions endpoint before it ever reaches the new approval-gating code
  (no regression), and (d) the MCP actor *can* read a single pending
  action's status (`GET .../ai/pending-actions/:id` correctly 404s for a
  made-up id rather than 403ing). The actual "MCP proposes an action and
  it becomes a pending approval row" path was verified only through the
  Jest suite above (`console.controller.spec.ts`, `actions.controller.spec.ts`,
  `server.integration.spec.ts`), not a live un-mocked HTTP call — doing
  that live would have meant temporarily turning off
  `TRACE_MCP_READ_ONLY` on this machine's real, currently-read-only
  configuration, which wasn't worth the live security-posture change for
  this check given the automated coverage already in place.
- **Not verified, and not claimed**: a live session where a real Claude
  Code or Claude Desktop process (not a scripted SDK test client) calls
  any of the 4 new tools or hits the new approval gate through an actual
  conversation. The stdio transport and tool/argument shapes are
  unchanged from what was live-verified before (see the line above), so
  basic connectivity is expected to keep working, but that is an
  expectation grounded in the earlier verification plus this session's
  passing test suite — it is not itself a new live test, and should not
  be read as one.

## Known limitation

`server.tool(...)`'s real type signature in the installed SDK version is a
heavily-overloaded generic. Registering more than a handful of
object-schema tools against it directly sent `tsc` into a multi-minute (and
occasionally stack-overflowing) type-inference blowup. `src/server.ts`
works around this by narrowing `server.tool` to one simple, non-generic
call shape via a single type assertion — the runtime behavior is identical
(zod still validates every argument), only the compile-time inference is
avoided.
