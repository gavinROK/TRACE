# @trace/mcp-server

An MCP (Model Context Protocol) server that exposes TRACE's infrastructure
control plane to Claude. It is a thin client over TRACE's own REST API —
every tool call here goes through the exact same backend code (connectors,
credential decryption, audit logging) as the browser console. It never
builds a separate management implementation, and it never has access to a
raw stored credential: TRACE's API responses never include one.

## Tools

| Tool | What it does |
| --- | --- |
| `trace_list_environments` | List every infrastructure environment. |
| `trace_list_devices` | List devices in one environment. |
| `trace_get_topology` | Get the device graph (nodes + verified/inferred edges). |
| `trace_get_device` | Full detail for one device. |
| `trace_get_capabilities` | Just a device's supported capabilities. |
| `trace_get_health` | Actively check a device's reachability (read-only). |
| `trace_get_metrics` | Historical metric samples for a device. |
| `trace_get_logs` | The environment's audit log. |
| `trace_execute_command` | Run a shell command on one device over SSH. |
| `trace_execute_group_command` | Run a shell command across multiple devices (requires `confirm: true` for more than one target). |
| `trace_perform_action` | Start/stop/reboot a VM, etc. (destructive actions require `confirm: true`). |
| `trace_get_operation_status` | Check the status of a previously started command run. |
| `trace_diagnose_device` | Explain exactly why a device isn't connected (missing address, missing credential, unreachable) instead of a generic error. |
| `trace_detect_local_network` | Detect TRACE's own machine's active interface, subnet, and default gateway. |
| `trace_scan_network` | Scan a subnet for devices (ARP + optional nmap ping sweep, no port scanning). |
| `trace_update_device` | Update a device's non-secret settings (name, IPs, port, protocols, tags, notes) — never accepts a credential. |

Not implemented (see the root README's "Current limitations"):
`trace_get_services`, interactive terminal sessions, importing a discovered candidate into inventory (use the UI's Discover My Network flow for that — it needs an explicit per-candidate choice, which doesn't fit a single tool call well).

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
5. Register it with Claude Code, passing the token as an environment
   variable for the MCP server process directly — `-e` values are stored
   in Claude Code's own project config (`~/.claude.json`, `0600`
   permissions), not in this repo:
   ```bash
   claude mcp add trace \
     -e TRACE_MCP_SERVICE_TOKEN=<the token> \
     -e TRACE_API_BASE_URL=http://localhost:4000 \
     -- node /absolute/path/to/TRACE/packages/mcp-server/dist/index.js
   ```
6. Run `claude mcp list` to confirm `trace` shows **✔ Connected** — note
   that `claude mcp get trace` (unlike `list`) prints the configured
   token in plain text to your terminal, by design (it's showing you
   your own config); avoid running `get` where the output might be
   logged or shared, and rotate the token if it ever is.
7. Try a harmless read-only call: ask Claude to run `trace_list_environments`.

## What's verified vs. what isn't

- **Verified in this repo's test suite**: the MCP protocol wiring itself —
  `src/server.integration.spec.ts` connects a real `@modelcontextprotocol/sdk`
  `Client` to this server over the SDK's in-memory transport (the same
  protocol layer Claude Code's MCP integration uses), lists the tools, and
  calls several of them end to end. Only the HTTP layer underneath
  `TraceClient` is faked there, since there's no live TRACE API in CI.
- **Verified live, once, against a real `claude mcp add` registration**:
  a real `@modelcontextprotocol/sdk` `Client` connected over real stdio
  to the compiled `dist/index.js`, which called a real running TRACE API
  backed by a real Postgres database. Listed all 16 tools, retrieved
  real inventory and a real enrolled device's real Proxmox status/
  metrics/topology, and confirmed `trace_execute_command` is correctly
  blocked (403, surfaced as a tool error, not a crash) when
  `TRACE_MCP_READ_ONLY=true`. `claude mcp list` reported **✔ Connected**.
- **Not verified**: a live session where Claude itself (not a scripted
  test client) calls a tool through a running Claude Code conversation —
  functionally identical to the above, just not literally exercised that
  way yet.

## Known limitation

`server.tool(...)`'s real type signature in the installed SDK version is a
heavily-overloaded generic. Registering more than a handful of
object-schema tools against it directly sent `tsc` into a multi-minute (and
occasionally stack-overflowing) type-inference blowup. `src/server.ts`
works around this by narrowing `server.tool` to one simple, non-generic
call shape via a single type assertion — the runtime behavior is identical
(zod still validates every argument), only the compile-time inference is
avoided.
