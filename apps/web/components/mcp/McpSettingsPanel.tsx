"use client";

import { useEffect, useState } from "react";
import { mcpApi } from "@/lib/mcp-api";
import type { McpStatus } from "@/lib/mcp-types";

const CLAUDE_CODE_COMMAND = `claude mcp add trace \\
  -e TRACE_MCP_SERVICE_TOKEN=<your-token> \\
  -e TRACE_API_BASE_URL=http://localhost:4000 \\
  -- node /absolute/path/to/TRACE/packages/mcp-server/dist/index.js`;

const CLAUDE_DESKTOP_CONFIG = `{
  "mcpServers": {
    "trace": {
      "command": "node",
      "args": ["/absolute/path/to/TRACE/packages/mcp-server/dist/index.js"],
      "env": {
        "TRACE_MCP_SERVICE_TOKEN": "<your-token>",
        "TRACE_API_BASE_URL": "http://localhost:4000"
      }
    }
  }
}`;

/**
 * PRODUCT_SPEC v0.4 section 8: "Provide a straightforward MCP
 * configuration experience... including connection instructions and
 * configuration examples." TRACE never shows the service token itself
 * here — it's a `.env` secret, and no endpoint in this app ever
 * returns a secret to the browser (see mcp-status.controller.ts) — so
 * this is instructions plus a live "is it set up" status, not a
 * generate/copy-the-real-token flow.
 */
export function McpSettingsPanel() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    mcpApi.getStatus().then(setStatus).catch(() => undefined);
  }, []);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be denied (e.g. no HTTPS/localhost
      // exception, or a locked-down browser profile) — the text is
      // still visible to select and copy manually, so this fails
      // silently rather than showing an alarming error for something
      // this low-stakes.
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-400">
        Connect Claude Code or Claude Desktop directly to TRACE over MCP — this uses your existing Claude subscription, not a
        separate Anthropic API key. No API credits are purchased or spent; MCP is independent of the native AI assistant above.
      </p>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Status</span>
        </div>
        {!status ? (
          <p className="mt-1 text-slate-500">Loading…</p>
        ) : status.serviceTokenConfigured ? (
          <p className="mt-1 text-emerald-400">
            ● Service token configured{status.readOnly ? " — read-only mode (Claude can read, not act)" : " — read/write enabled"}
          </p>
        ) : (
          <p className="mt-1 text-amber-400">● No TRACE_MCP_SERVICE_TOKEN set yet — follow the setup steps below.</p>
        )}
      </div>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
        <p className="text-slate-300">1. Generate a service token and add it to <code className="text-sky-300">apps/api/.env</code>:</p>
        <CodeBlock text="openssl rand -base64 32" onCopy={() => copy("key", "openssl rand -base64 32")} copied={copied === "key"} />
        <p className="mt-2 text-slate-500">
          Save it as <code className="text-sky-300">TRACE_MCP_SERVICE_TOKEN=&quot;&lt;generated value&gt;&quot;</code>. Keep{" "}
          <code className="text-sky-300">TRACE_MCP_READ_ONLY=true</code> set until you&apos;ve verified the connection — it
          restricts the token to read-only requests. Restart the API after editing <code className="text-sky-300">.env</code>.
        </p>
      </div>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
        <p className="text-slate-300">2a. Claude Code:</p>
        <CodeBlock text={CLAUDE_CODE_COMMAND} onCopy={() => copy("code", CLAUDE_CODE_COMMAND)} copied={copied === "code"} multiline />
      </div>

      <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
        <p className="text-slate-300">
          2b. Claude Desktop — add to its <code className="text-sky-300">claude_desktop_config.json</code>:
        </p>
        <CodeBlock text={CLAUDE_DESKTOP_CONFIG} onCopy={() => copy("desktop", CLAUDE_DESKTOP_CONFIG)} copied={copied === "desktop"} multiline />
      </div>

      <p className="text-slate-500">
        Administrative and destructive operations (running a command, starting/stopping/rebooting a VM) never execute directly
        from either client — they create a pending action you approve below, under &quot;Pending approvals,&quot; the same gate
        the native assistant uses. See{" "}
        <code className="text-sky-300">packages/mcp-server/README.md</code> for the full tool list and setup detail.
      </p>
    </div>
  );
}

function CodeBlock({ text, onCopy, copied, multiline }: { text: string; onCopy: () => void; copied: boolean; multiline?: boolean }) {
  return (
    <div className="relative mt-1">
      <pre className={`overflow-x-auto rounded-md bg-slate-950 p-2 font-mono text-[11px] text-slate-300 ${multiline ? "whitespace-pre" : ""}`}>
        {text}
      </pre>
      <button
        onClick={onCopy}
        className="absolute right-1.5 top-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
