# Open-source integration evaluation

Research conducted 2026-11-10, on branch `feature/infrastructure-control-plane`,
in response to a direct request to pause new feature work and determine
which parts of the infrastructure-management problem are better solved by
existing open-source projects versus TRACE's own code. This document is the
deliverable: a cited, evidence-based recommendation, not an implementation.

**Method**: five independent research passes (LibreNMS; NetBox + NetBox
Labs; Zabbix; FreeSDN + Argus; and a broader ecosystem sweep of Nmap,
net-snmp, Prometheus, OpenTelemetry, Grafana, Ansible, Nornir, Netmiko,
Nautobot), each fetching current official docs/source repos rather than
relying on training-data memory, cross-referenced against a fresh audit of
TRACE's actual code in this repo. Every factual claim below is tagged
**[verified]** with a source, or **[inference]**/**[unverified]** where the
source didn't say so directly. Nothing here was invented.

---

## 1. Executive summary

TRACE's existing infrastructure code (`apps/api/src/infra/*`) is
already small, focused, and appropriate for its actual job: one operator,
a homelab-scale device count, running on a MacBook or a ZimaBoard. None of
the five named platforms (LibreNMS, NetBox, Zabbix, FreeSDN, Argus) can be
embedded into TRACE without turning it into "TRACE plus a second full
application stack" — every one of them requires its own database, its own
web server or UI, and in three of five cases, Linux-only deployment. That
directly contradicts the product's core requirement: one unified
application, lightweight enough to run alongside everything else on a
single small machine.

**Recommendation: do not integrate, embed, or depend on any of the five
named platforms.** Continue building TRACE-native connectors and
discovery. Three ideas are worth borrowing (not importing) from this
research, all low-risk and additive:

1. Use SNMP (LLDP/CDP neighbor-table walks) on devices TRACE already has a
   credential for, to produce **verified** (not inferred) topology edges —
   LibreNMS proved this pattern out at scale; TRACE's own
   `InfraRelationshipKind.VERIFIED | INFERRED` model is actually better
   suited to representing it than LibreNMS's own data model appears to be.
2. Consume NetBox's community **Device Type Library**
   (CC0-1.0, i.e. public domain) as an optional, cached enrichment lookup
   for vendor/model metadata — zero new runtime dependency, zero license
   risk.
3. Adopt a **maturity-tier label per connector capability**
   (Production/Beta/Preview/Not-implemented), a convention FreeSDN uses
   well — TRACE already has an informal version of this in
   `docs/ARCHITECTURE.md`'s "Documented, not implemented" list; formalizing
   it in the API response is a genuinely low-risk, additive improvement.

Everything else — NetBox-as-inventory, Zabbix-as-monitoring,
Ansible/Nornir/Netmiko-as-automation, Grafana/Prometheus-as-dashboarding —
is either not a net improvement at TRACE's target scale, blocked by
deployment/license friction, or both. These are recorded below as
**documented future options**, gated behind an explicit, optional,
default-off provider — never a default or mandatory dependency.

---

## 2. Current TRACE architecture (audit)

Audited directly in this repo (`apps/api/src/infra/*`, 55 non-test
`.ts` files; `apps/api/package.json`; `packages/mcp-server/package.json`).
See `docs/ARCHITECTURE.md` for the authoritative module map — this is a
summary oriented toward the comparison below.

| Capability | Current implementation | Classification |
| --- | --- | --- |
| Device discovery | `discovery/` — local ARP + optional `nmap` ping sweep + gateway detection (`network-discovery.service.ts`, 130 lines) and Proxmox-driven VM/container enumeration (`proxmox-discovery.service.ts`, 112 lines) via `discovery-scan.service.ts` (186 lines) | **(2) functional but incomplete** — no SNMP-based neighbor discovery yet; `arp -a` is currently broken from Node on macOS (documented, unresolved — see `ARCHITECTURE.md` known limitations) |
| Device inventory | `devices/`, `environments/` — `InfraDevice`/`InfraEnvironment` in Postgres via Prisma | **(1) already reliable** — this is TRACE's own system of record; nothing researched here does this job better at this scale |
| SNMP | `connectors/snmp/snmp-connector.ts` (142 lines) via `net-snmp` npm package, SNMPv3 read-only (`sysDescr`, interface table) | **(2) functional but incomplete** — correctly scoped as read-only (SNMP read access must never imply write access), but doesn't yet walk LLDP/CDP MIBs for topology |
| Proxmox integration | `connectors/proxmox/proxmox-connector.ts` (272 lines), raw `node:https`, discover/health/metrics/start/stop/shutdown/reboot | **(1) already reliable** — live-tested against a real Beelink/Proxmox VE host per `DEVELOPMENT_STATUS.md` |
| SSH | `connectors/ssh/ssh-connector.ts` (212 lines) via `ssh2`, command execution + metrics parsing (`/proc/loadavg`, `free`, `df`), trust-on-first-use host-key pinning | **(2) functional but incomplete** — unit-tested only, not yet run against a real Linux host |
| Metrics collection | `monitoring/` — scheduled + on-demand polling, persists real samples from a connector's `getHealth`/`getMetrics` | **(1) already reliable**, narrow by design |
| Network topology | `topology/` — assembles a node/edge graph from `InfraRelationshipKind.VERIFIED | INFERRED`, rendered via React Flow in `apps/web` | **(5) better retained as TRACE-native** — this verified/inferred distinction is sharper than what LibreNMS or NetBox expose on their own data (see §3/§5) |
| Authentication | `auth/` — password (bcrypt) + optional WebAuthn, opaque session tokens (SHA-256 hashed at rest), `TraceAccessGuard` also gates the MCP bearer token | **(1) already reliable** |
| Credential storage | `credentials/` — AES-256-GCM via Node's built-in `crypto`, macOS Keychain-backed master key, never returned by any controller | **(1) already reliable** |
| Command execution | `console/` — device-name resolution, bounded concurrency, timeouts, cancellation, history; `confirm: true` gate for multi-device/destructive calls | **(1) already reliable** |
| MCP tools | `packages/mcp-server` — 16 tools, thin REST client over the same API/auth/audit path as the browser, never sees a raw credential | **(1) already reliable** |
| AI integration | None of the researched platforms' "AI-assisted" features are embedded-assistant shaped the way TRACE's MCP-server-as-tool-provider is; closest analogue is Argus's own MCP tool set (see §3) | **(5) better retained as TRACE-native** |

**Dependency footprint** — confirmed from `package.json`
**[verified, this repo]**: backend depends on `@nestjs/*`, `@prisma/client`,
`@simplewebauthn/server`, `bcryptjs`, `ssh2`, `net-snmp`, `@octokit/*` — no
heavy monitoring or automation framework. `packages/mcp-server` depends
only on `@modelcontextprotocol/sdk` and `zod`. This confirms the premise
of the research request: TRACE is already lightweight, and the bar for
adding a dependency should be high.

No component here is currently "(3) duplicating a mature open-source
solution" to a degree that would justify a swap — the closest cases
(SNMP, discovery) are narrower than their OSS counterparts by design, not
by accident, because TRACE's target device count (tens, not thousands) and
target footprint (one process, no RRDtool/MariaDB/Redis) make the mature
tools' extra machinery a cost with no matching benefit.

---

## 3. Open-source alternatives researched

### LibreNMS — [librenms.org](https://www.librenms.org/) / [github.com/librenms/librenms](https://github.com/librenms/librenms)

- License: **GPLv3**, with an explicit linking exception for bundled
  third-party code **[verified, LICENSE.txt]**.
- Stack: PHP 8.4+/PHP-FPM, **MariaDB required**, **RRDtool required**,
  NGINX/Apache, cron — **Linux only, no macOS support**
  **[verified, docs.librenms.org/Installation/Install-LibreNMS]**.
- Auto-discovery every 6 hours (new devices within 5 minutes), with real
  LLDP/CDP/FDP neighbor discovery enabled by default, plus OSPF/BGP
  neighbor tables, ARP tables of already-known devices, and a bounded
  (configurable `nets` list) SNMP range-scan
  **[verified, docs.librenms.org/Extensions/Auto-Discovery]**.
- REST API: token-based (SHA-256-hashed at rest), current stable version
  is **v0** (v1 exists only as documented Beta)
  **[verified, docs.librenms.org/API]**.
- Actively maintained: monthly-or-faster releases through 2026
  (26.1.0→26.8.0), 5,000+ stars, 24,000+ commits
  **[verified, github.com/librenms/librenms releases]**.
- **Gap found**: LLDP/CDP-sourced neighbor data does not appear to carry a
  verified/inferred provenance flag in LibreNMS's own data model — once
  discovered, it's treated as fact, with no equivalent to TRACE's
  `VERIFIED | INFERRED` distinction **[inference, from docs — no explicit
  statement either way]**.

**Verdict: do not integrate — deployment stack is disqualifying for a
MacBook/ZimaBoard target.** Worth borrowing: querying LLDP/CDP MIBs over
SNMP on devices TRACE already holds a credential for, to produce verified
topology edges, layered on top of (not replacing) TRACE's existing
ARP/nmap discovery.

### NetBox — [netboxlabs.com](https://netboxlabs.com/) / [github.com/netbox-community/netbox](https://github.com/netbox-community/netbox)

- Core NetBox: **Apache 2.0**, Python/Django, **requires PostgreSQL +
  Redis**, biweekly release cadence (v4.7.2–v4.7.4, Sep–Oct 2026), 21.9k
  stars **[verified, LICENSE.txt + github.com/netbox-community/netbox]**.
- Data model: sites/racks/devices/components/cables, full IPAM
  (prefixes/ranges/addresses/VRFs), VLANs, VMs, tenancy; REST **and**
  GraphQL APIs; a real Django-app plugin architecture
  **[verified, netboxlabs.com/docs/netbox]**.
- **NetBox does not discover or compute topology itself** — it's a system
  of record for data you (or another tool) give it, not a discovery
  engine **[verified, absence confirmed — no discovery/auto-layout feature
  in docs or README]**.
- **Device Type Library** (`netbox-community/devicetype-library`):
  community-sourced YAML device definitions, **CC0-1.0 (public domain)**,
  thousands of real vendor/model entries **[verified, repo license]**.
- **Commercial vs. open-source split** — explicitly distinct products:
  - NetBox (community) — free, OSS, self-hosted. The thing above.
  - NetBox Cloud / NetBox Enterprise — **commercial**, hosted or
    enterprise-scale self-hosted.
  - NetBox Discovery — a discovery *agent* product; the underlying
    agent (`netboxlabs/orb-agent`) is **Apache-2.0** and genuinely open,
    but NetBox Labs' own messaging reserves the right to add commercial
    capability on top over time **[verified: license on current code;
    unverified: "free forever" is marketing, not a license guarantee]**.
  - NetBox Assurance (drift detection, "intent vs. live state") —
    **commercial-only**, requires NetBox Cloud/Enterprise
    **[verified, NetBox Labs blog + GlobeNewswire press release]**.
  - Nitro AI (natural-language querying/orchestration layer) —
    **[unverified]** whether any part is open source; treat as
    commercial-tier until shown otherwise.

**Verdict: do not run NetBox-the-software.** It's a second Python/Django
+ Redis + Postgres stack with its own UI — the same "second dashboard"
problem as LibreNMS, for a job (device/IP inventory) TRACE's own
`InfraDevice`/`InfraEnvironment`/`InfraRelationship` schema already covers
at homelab scale. Two things worth doing: (a) consume the CC0 Device Type
Library as a zero-risk, zero-dependency enrichment lookup; (b) keep
"optional one-way sync into a user's own NetBox" as a documented future
provider for a multi-site/MSP future, never a near-term build.

### Zabbix — [zabbix.com](https://www.zabbix.com/) / [github.com/zabbix/zabbix](https://github.com/zabbix/zabbix)

- License: **AGPL-3.0-only** **[verified, raw COPYING file]** — network
  copyleft; safe to call as an arm's-length external service, unsafe to
  vendor or fork code from.
- Stack: C server + optional proxy + PHP frontend + **MySQL/PostgreSQL/
  TimescaleDB required** — a 3–4 component stack, not a single binary
  **[verified, zabbix.com/documentation/current/en/manual/introduction/about]**.
- Agentless coverage is real: SNMP, IPMI, JMX, VMware, generic HTTP/TCP
  checks, in addition to its own agent **[verified, same source]**.
- Auto-discovery: IP-range sweep + service checks, auto-creates hosts,
  auto-links templates. **Explicitly states it does NOT discover network
  topology** — no LLDP/CDP **[verified,
  zabbix.com/.../discovery/network_discovery — direct quote]**.
- API: mature JSON-RPC 2.0, bearer/session auth, full read/write CRUD
  **[verified, zabbix.com/.../manual/api]**.
- Actively maintained: 113,961+ commits, 112 open PRs at fetch time
  **[verified, github.com/zabbix/zabbix]**.

**Verdict: do not integrate as the platform.** Deployment footprint and
no-topology gap both work against it for TRACE's goals; AGPL forecloses
code reuse. Two ideas worth taking as patterns, not code: its
discovery-action model (scan → match rule → auto-create + auto-link a
template) and its template concept (a declarative bundle of expected
checks per device class) — both map cleanly onto formalizing what TRACE's
discovery/connector code already does ad hoc. If a user already runs
Zabbix, a strictly read-only, optional data-ingestion provider is a
reasonable far-future option — not a near-term build, and never
write-capable from TRACE's side.

### FreeSDN — [freesdn.org](https://freesdn.org/) / [github.com/freesdn/freesdn](https://github.com/freesdn/freesdn)

- License: **AGPL-3.0-only** **[verified]** — forecloses code reuse.
- Real, substantial codebase (~24.5MB Python, ~10MB TypeScript); 10
  feature modules (Network, Firewall, Cameras, VoIP, Hypervisor, Backup,
  Observability, AI Assistant, Fabric; Access Control explicitly listed as
  **not implemented**) **[verified, repo contents + README]**.
- Solo maintainer, 7 stars, 1 fork, 17 open issues, active commits through
  2026-10-27, real CI, calendar-versioned releases (`v26.10.4`) — not
  abandoned, but a single point of failure, and the project's own README
  states no third-party security audit and no SLA **[verified]**.
- Proxmox integration is **broader than TRACE's today**: snapshots,
  storage, backups, clustering, HA groups, Ceph, per-VM/node firewall
  rules — tier "Production" in its own maturity labeling **[verified]**.
- Vendor matrix (its own maturity tiers): Omada/OPNsense (Production);
  pfSense/FreePBX/Grandstream (Beta); MikroTik/Hikvision/UniFi
  (Production); OpenWrt/TrueNAS/ONVIF (Preview). **No NETGEAR, no JetKVM,
  no Bambu Lab** — none of the user's actual non-Proxmox hardware is
  covered **[verified, README's vendor table]**.
- Deployment: Docker Compose, **Linux amd64 only, ARM64 explicitly "not
  qualified"** — cannot run on the user's Mac; sizing guidance starts at
  2 vCPU/4GB RAM minimum **[verified]**.

**Verdict: do not integrate or depend on.** Real and honestly documented,
but AGPL blocks code reuse, it's Linux-amd64-only, and it doesn't cover
the actual homelab gear (switch, KVM, printer) that's the real gap. Worth
studying its Proxmox feature breadth as a roadmap reference for what a
more complete TRACE Proxmox connector could eventually cover, and its
Production/Beta/Preview/Not-implemented labeling convention as a pattern
(see §1, item 3).

### Argus — [github.com/freed-dev-llc/argus](https://github.com/freed-dev-llc/argus)

- License: **Apache-2.0** **[verified]** — no reuse obstacle.
- Real and currently maintained: weekly commits through 2026-11-09, 17
  releases, real CI, PyPI package, GHCR images — but tiny adoption (3
  stars, 0 forks, 3 open issues), solo maintainer **[verified]**.
- What it actually is: a Python (FastAPI + MCP server) + React dashboard
  that treats **NetBox as the source of truth** and reconciles live
  network state against it — **it requires a running NetBox instance**,
  it does not replace one **[verified, README]**.
- Real MCP tools (`list_devices`, `discovery_scan`, `network_topology`,
  `drift_report`, `reconcile_apply`, etc.), writes dry-run by default and
  confirmation-gated — a genuinely working approval-workflow pattern, not
  aspirational **[verified, README's tool list + described write-gating
  behavior]**.
- Vendor coverage: UniFi and pfSense/OPNsense only, via a plugin-via-
  entry-point architecture. **No Proxmox, no NETGEAR, no JetKVM, no Bambu
  Lab** **[verified]**.
- "AI-assisted" here means Argus *is* an MCP tool provider for coding
  agents — the same shape as TRACE's own MCP server, just NetBox-shaped.

**Verdict: do not depend on — it only has value on top of NetBox, which
this report already recommends against running.** The transferable ideas
are the **discover → diff → confirmation-gated-reconcile loop** and the
**vendor-pack-via-plugin-entry-point** pattern — both are clean,
provable architecture patterns, directly relevant to TRACE's own future
drift-detection and connector-plugin design, even though the code (Python)
isn't portable into a NestJS/TypeScript backend.

### Additional ecosystem projects

| Project | License | Verdict | Why |
| --- | --- | --- | --- |
| **Nmap** | NPSL (GPLv2-based) **[verified]** | **Keep current pattern** | Invoking the installed binary via `execFile` (TRACE's existing pattern) doesn't trigger NPSL's redistribution/embedding restrictions — no code is copied or bundled. No change needed. |
| **net-snmp (npm)** | MIT **[verified, npm + Snyk Advisor]** | **Keep, already correct** | Already the exact version in use; "Sustainable" maintenance rating; distinct from the Net-SNMP *C* toolchain. No better alternative found. |
| **Prometheus** (exposition format) | Apache-2.0 for the format/spec **[verified]** | **Consider later** | Exposing an optional `/metrics` endpoint is small, additive, non-breaking, and lets a power user point their own external Prometheus at TRACE without TRACE taking on Prometheus as a dependency. Not urgent — no current user-facing gap. |
| **OpenTelemetry** | — | **Skip for now** | Instruments TRACE's own backend requests, not the infrastructure TRACE manages (reached via SSH/Proxmox-API/SNMP, none of which speak OTel). Revisit only if TRACE's own operational debugging becomes a pain point. |
| **Grafana** | Relicensed **AGPLv3** (from Apache-2.0) as of the current release **[verified, grafana/LICENSING.md + Grafana's own relicensing post]** | **Skip as a dependency** | No license conflict for an unrelated, user-run instance scraping an optional TRACE `/metrics` endpoint, but building toward a second dashboard directly contradicts the "one unified app" requirement. |
| **Ansible** | GPLv3, `ansible-core` **[verified]** | **Skip** | Actively maintained, but pure Python with its own inventory/module/idempotency model. Integrating means shelling out to a second runtime with a second config format to keep in sync with TRACE's own device model — the "heavyweight mandatory dependency" the request says to avoid, for a homelab scale TRACE's own SSH/Proxmox connectors already cover. |
| **Nornir** | Apache-2.0 **[verified]** | **Skip** | Same Python-only, no-Node-bridge problem as Ansible; no capability gap it closes that TRACE's connectors don't already cover. |
| **Netmiko** | MIT **[verified]** | **Consider later** | Narrow, genuine value-add: handling vendor-CLI quirks (paging, enable mode, config prompts) that TRACE's generic `ssh2` connector doesn't handle — relevant only if/when TRACE automates CLI config on the NETGEAR switch or router beyond SNMP reads. Still Python-only (same sidecar tradeoff); worth it only if that specific feature becomes a real priority. |
| **Nautobot** | Apache-2.0, a NetBox fork **[verified]** | **Skip, same category as NetBox** | Functionally a NetBox alternative, not something additive — the NetBox verdict above applies here too. |

**Cross-cutting finding**: Ansible, Nornir, and Netmiko are all mature,
well-licensed, and well-maintained — and all pure Python with no
first-class Node/TypeScript binding. TRACE already shells out to simple,
stateless OS binaries (`nmap`, `arp`, `ping`, `route`) via `execFile`,
which is low-risk. Shelling out to a *Python automation framework* is a
different commitment: a second runtime, a second inventory/credential
representation to keep in sync with TRACE's own Postgres model, and a
second output format to parse into TRACE's audit log. That crosses into
"architectural migration" territory the request says needs explicit
approval — recorded as a documented future option, not adopted now.

---

## 4. Comparison matrix

| | LibreNMS | NetBox | Zabbix | FreeSDN | Argus | TRACE (current) |
| --- | --- | --- | --- | --- | --- | --- |
| License | GPLv3 | Apache-2.0 | AGPL-3.0 | AGPL-3.0 | Apache-2.0 | MIT |
| macOS support | No | No (Docker possible, heavy) | No (Docker possible, heavy) | No (Linux amd64 only) | No (Docker possible) | **Yes, native** |
| Own database required | MariaDB + RRDtool | PostgreSQL + Redis | MySQL/PG/TimescaleDB | — (own stack) | Requires NetBox (and its DB) | Postgres (already TRACE's own) |
| Own web UI | Yes | Yes | Yes | Yes | Yes | N/A — would be a second UI |
| Topology discovery (LLDP/CDP) | **Yes** | No | No | Unverified | Via NetBox, no LLDP/CDP itself | No (planned improvement) |
| SNMP discovery | Yes | No | Yes | Unverified | No | Yes (connector exists, read-only) |
| REST/GraphQL API | REST (v0 stable) | REST + GraphQL | JSON-RPC | Unverified | REST (FastAPI) + MCP | REST + MCP |
| Maintenance activity | Very active | Very active | Very active | Active, solo maintainer | Active, solo maintainer, tiny adoption | Active (this repo) |
| Fits "lightweight, one machine" goal | No | No | No | No | No (+ requires NetBox) | **Yes, by design** |

---

## 5. Build-versus-integrate recommendations

| Capability | Decision | Rationale |
| --- | --- | --- |
| Device/IP inventory | **Build (keep TRACE-native)** | `InfraDevice`/`InfraEnvironment` already covers this; NetBox adds a second stack with no matching benefit at this scale. |
| SNMP topology (LLDP/CDP) | **Build, pattern borrowed from LibreNMS** | Extend the existing `snmp-connector.ts` to walk LLDP/CDP MIBs for devices with an existing credential; feed into TRACE's own `VERIFIED` relationship kind. No new dependency. |
| Vendor/model enrichment | **Integrate narrowly** | Consume NetBox's CC0 Device Type Library as a cached/optional lookup — public domain, no runtime dependency, no license risk. |
| Monitoring/metrics | **Build (keep TRACE-native)** | Zabbix/LibreNMS both require a second stack; TRACE's scheduled polling against its own connectors already fits a homelab's scale. |
| Discovery-action pattern (scan → match → auto-create/auto-link) | **Build, pattern borrowed from Zabbix** | Formalize as a TRACE-native rule shape layered onto `discovery-scan.service.ts` — no code or dependency imported. |
| Drift detection / approval workflows | **Build, pattern borrowed from Argus** | The discover → diff → confirmation-gated-reconcile loop is directly applicable to TRACE's own `confirm: true` gating convention — implement natively, no NetBox dependency required. |
| Vendor-CLI automation (beyond SSH generic exec) | **Defer** | Netmiko is the right tool if/when this becomes a real need; Python-sidecar cost not justified yet. |
| Bulk config automation (Ansible/Nornir-shaped) | **Defer** | Same cross-language cost; TRACE's SSH/Proxmox connectors already cover the current scale. |
| Metrics export for external dashboards | **Optional, low-risk, deferrable** | A Prometheus-format `/metrics` endpoint is additive and non-breaking; not urgent. |
| Connector maturity labeling | **Build, pattern borrowed from FreeSDN** | Formalize Production/Beta/Preview/Not-implemented per connector capability in the API response — low-risk, additive. |

---

## 6. Licensing considerations

- **MIT (TRACE's own license)** has no obligations that any of the above
  trigger merely by *calling* another service's API at arm's length.
- **GPLv3 (LibreNMS, Ansible)**: copying source code into TRACE would
  require TRACE to relicense the derived portions under GPLv3. Calling a
  separately-run LibreNMS instance's REST API is unaffected — no
  LibreNMS source is proposed for reuse here, only an architectural
  pattern (LLDP/CDP-over-SNMP), which is not copyrightable.
- **AGPL-3.0 (Zabbix, FreeSDN)**: network copyleft — modifying and then
  *operating* a modified copy as a network service would require
  publishing those modifications. No AGPL code is proposed for reuse;
  any future optional integration must treat these as external,
  unmodified, arm's-length services only (same relationship TRACE already
  has with a user's Proxmox).
- **Apache-2.0 (NetBox, Argus, Nautobot, net-snmp's npm package, Nornir)**:
  permissive, patent grant included — no obstacle, but no code is being
  copied from any of these either; only the CC0 Device Type Library data
  (not NetBox's code) is proposed for actual reuse.
- **CC0-1.0 (NetBox Device Type Library)**: public domain — the single
  cleanest reuse case in this entire research pass. Safe to consume
  directly, with attribution as a courtesy (not a legal requirement).
- **NPSL (Nmap)**: restricts redistributing/embedding Nmap in a product;
  does not restrict invoking an independently-installed binary via
  subprocess, which is TRACE's existing and continuing pattern.
- **General rule applied throughout**: no source code from any GPL/AGPL
  project is proposed for copying into TRACE anywhere in this report —
  every recommendation above is either (a) calling an independent,
  unmodified external service via its public API, (b) reusing public
  domain data, or (c) reproducing an architectural *pattern* in TRACE's
  own original code, not its implementation.

---

## 7. Proposed integration architecture (proposal only — not implemented)

This is a design proposal for future work, consistent with the request's
instruction to present major architectural changes and wait for approval
before building them. Nothing in this section has been implemented.

The shape: TRACE keeps one authorization/audit boundary
(`InfraAccessGuard`/`AuditService`, as today) that every provider —
native or external — must pass through, so the frontend, CLI, and MCP
server never gain a second code path for the same operation.

```
                        ┌─────────────────────────────┐
                        │   TRACE API (NestJS)         │
                        │   — single authZ/audit path  │
                        └──────────────┬────────────────┘
                                       │
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        │              │              │              │              │
  Discovery        Monitoring     Inventory      Automation         AI
  provider          provider       provider       provider       provider
        │              │              │              │              │
 ┌──────┴──────┐ ┌─────┴─────┐ ┌──────┴──────┐ ┌─────┴─────┐  ┌─────┴─────┐
 │ native ARP/ │ │  native   │ │   TRACE     │ │    SSH    │  │ Anthropic │
 │ mDNS, nmap  │ │  Proxmox  │ │  Postgres   │ │ (current) │  │  Claude   │
 │ (current)   │ │ (current) │ │ (current)   │ │           │  │ (current) │
 │             │ │           │ │             │ │  Proxmox  │  │           │
 │ + SNMP/LLDP │ │  SNMP     │ │ optional:   │ │  API      │  │ future:   │
 │   (new)     │ │ (current) │ │  NetBox     │ │ (current) │  │ other     │
 │             │ │           │ │  push-sync  │ │           │  │ model     │
 │ optional:   │ │ optional: │ │  (future,   │ │ optional: │  │ providers │
 │ external    │ │  Zabbix   │ │  default    │ │  Netmiko, │  │           │
 │ inventory   │ │  ingest   │ │  off)       │ │  Ansible  │  │           │
 │ (future)    │ │ (future,  │ │             │ │  (future) │  │           │
 │             │ │  read-only)│ │             │ │           │  │           │
 └─────────────┘ └───────────┘ └─────────────┘ └───────────┘  └───────────┘
```

Each provider implements a shared interface per category (mirroring the
existing `InfraConnector` pattern — one interface, multiple optional
capability methods), selected by configuration, never hardcoded. A
provider that wraps an external platform (Zabbix ingest, NetBox sync) is
always optional, default-off, and — for anything that could write to a
user's existing external system — read-only from TRACE's side unless a
future, separately-approved design says otherwise. No provider bypasses
`InfraAccessGuard`/`AuditService`; the frontend, CLI, and MCP server
continue to call TRACE's own API/service layer only, never a provider
directly, so business logic is never duplicated across surfaces.

---

## 8. Expected performance and resource requirements

Per-project figures, where stated by the source **[verified]**, or marked
**[inference]** where TRACE's own usage would differ from the source's
stated numbers:

- **LibreNMS, NetBox, Zabbix, FreeSDN**: each requires standing up a
  second multi-process stack (web server + database + the application
  itself, sometimes + Redis/RRDtool). None publish numbers below roughly
  2 vCPU / 2–4GB RAM for even light use **[FreeSDN: verified, "lite" tier
  2 vCPU/4GB minimum; others: inference from stack composition, no single
  authoritative minimum-RAM figure was fetched for all four]**. On a
  ZimaBoard 2 (a low-power ARM/x86 board) or sharing a MacBook with
  everything else TRACE already runs, this is a materially larger
  footprint than TRACE's own single NestJS process + Postgres.
- **TRACE's own additions proposed here** (SNMP LLDP/CDP walk, Device
  Type Library lookup, discovery-action rules, maturity labeling) add
  **no new process, no new database, no new mandatory network
  dependency** — they extend code already running inside the existing
  NestJS process, using a dependency (`net-snmp`) already installed.
  Expected marginal resource cost: negligible (a few extra SNMP
  round-trips during a scheduled poll; an optional, cached HTTP fetch for
  device-type data).
- **Zabbix read-only ingest, NetBox push-sync (future, optional
  providers)**: resource cost is borne entirely by the *external* system
  the user already chose to run; TRACE's side is just an additional
  outbound API call on its existing polling schedule — no meaningful
  marginal cost to TRACE itself.

---

## 9. Security implications

- **No credential model from any researched project is proposed for
  reuse.** TRACE's AES-256-GCM + Keychain-backed master key design
  (`docs/ARCHITECTURE.md` §Security model) is unaffected by anything in
  this report.
- **SNMP LLDP/CDP walk (proposed)**: read-only, uses the same SNMPv3
  credential model already in place; no new credential type, no new
  attack surface beyond what the existing SNMP connector already has.
- **Device Type Library lookup (proposed)**: if fetched live rather than
  bundled, this is an outbound HTTP call to a third-party GitHub-hosted
  resource — should be read-only, non-blocking (a lookup failure must
  never block device enrollment), and ideally cached/bundled rather than
  fetched on every request, to avoid a new runtime dependency on GitHub's
  availability.
- **Any future optional provider that calls an external platform
  (Zabbix, NetBox) must be**: (a) off by default, (b) configured with its
  own, separately-stored, separately-revocable credential — never reusing
  a TRACE-internal secret, (c) read-only from TRACE's side for any
  platform where TRACE doesn't already enforce its own authorization
  model (Zabbix ingest), and (d) still routed through TRACE's own
  `AuditService` so an external-sourced action is indistinguishable, in
  the audit log, from a locally-initiated one in terms of who authorized
  it.
- **AGPL/GPL services called only as external, unmodified services**
  (never vendored) — consistent with §6 — means no new license-driven
  disclosure obligation is introduced by any recommendation here.
- **No default-password guessing, credential extraction, or
  unauthorized-access technique was used, attempted, or is proposed
  anywhere in this research** — all five platforms were evaluated via
  their public docs/source/release metadata only.

---

## 10. Implementation priorities

Ordered by value-to-risk ratio, consistent with §8 of the original
request (only low-risk, non-architectural, non-breaking changes may be
implemented without further approval; anything larger is a proposal
awaiting approval):

1. **(Low-risk, implementable now)** Extend `snmp-connector.ts` with an
   LLDP/CDP MIB walk, feeding TRACE's existing `VERIFIED` relationship
   kind — additive, no new dependency, no breaking change to any existing
   method signature.
2. **(Low-risk, implementable now)** Add a maturity/capability-tier field
   to the connector-capability API response (Production/Beta/Preview/
   Not-implemented), formalizing what `ARCHITECTURE.md` already documents
   informally — additive, no behavior change to existing clients that
   ignore the new field.
3. **(Low-risk, implementable now)** Add an optional, cached lookup
   against the CC0 Device Type Library for vendor/model enrichment during
   enrollment — must fail open (never block enrollment on a lookup
   miss/timeout).
4. **(Needs approval — architectural)** Formalize the discovery-action
   pattern (scan → match rule → suggest a device profile) as a first-class
   TRACE concept, generalizing the current ad hoc logic in
   `discovery-scan.service.ts`.
5. **(Needs approval — architectural)** Implement a native discover →
   diff → confirmation-gated-reconcile loop (the Argus pattern) as a
   TRACE-native drift-detection feature.
6. **(Needs approval — optional, external, off by default)** Prometheus-
   format `/metrics` endpoint for external dashboard consumers.
7. **(Deferred, revisit only if a concrete need appears)** Netmiko-backed
   vendor-CLI automation; Zabbix read-only ingest provider; NetBox
   push-sync provider; Ansible/Nornir-backed bulk automation.

Items 1–3 are candidates for implementation in this same session, subject
to the full verification/secret-scan process already standard in this
repo. Items 4–7 require explicit approval before any implementation
begins.

---

## Sources

- LibreNMS: [librenms.org](https://www.librenms.org/) · [github.com/librenms/librenms](https://github.com/librenms/librenms) · [docs.librenms.org](https://docs.librenms.org/)
- NetBox: [netboxlabs.com](https://netboxlabs.com/) · [github.com/netbox-community/netbox](https://github.com/netbox-community/netbox) · [netbox-community/devicetype-library](https://github.com/netbox-community/devicetype-library) · [netboxlabs/orb-agent](https://github.com/netboxlabs/orb-agent) · [NetBox Assurance announcement](https://netboxlabs.com/blog/netbox-assurance-adds-fleet-management-and-a-new-way-to-clear-drift/)
- Zabbix: [zabbix.com](https://www.zabbix.com/) · [github.com/zabbix/zabbix](https://github.com/zabbix/zabbix) · [raw COPYING](https://raw.githubusercontent.com/zabbix/zabbix/master/COPYING)
- FreeSDN: [freesdn.org](https://freesdn.org/) · [github.com/freesdn/freesdn](https://github.com/freesdn/freesdn)
- Argus: [github.com/freed-dev-llc/argus](https://github.com/freed-dev-llc/argus)
- Nmap legal: [nmap.org/book/man-legal.html](https://nmap.org/book/man-legal.html) · [NPSL annotated](https://nmap.org/npsl/npsl-annotated.html)
- net-snmp (npm): [npmjs.com/package/net-snmp](https://www.npmjs.com/package/net-snmp)
- Grafana relicensing: [grafana.com/blog](https://grafana.com/blog/grafana-loki-tempo-relicensing-to-agplv3/) · [grafana/LICENSING.md](https://github.com/grafana/grafana/blob/main/LICENSING.md)
- Ansible: [github.com/ansible/ansible](https://github.com/ansible/ansible)
- Nornir: [github.com/nornir-automation/nornir](https://github.com/nornir-automation/nornir)
- Netmiko: [pypi.org/project/netmiko](https://pypi.org/project/netmiko/)
- Nautobot comparison: [netpilot.io/blog/nautobot-vs-netbox](https://www.netpilot.io/blog/nautobot-vs-netbox)
- TRACE's own `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_STATUS.md`, and a direct audit of `apps/api/src/infra/*` and the two `package.json` dependency manifests in this repo (2026-11-10).
