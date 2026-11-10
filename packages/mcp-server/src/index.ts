#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { TraceClient } from "./trace-client";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required. See packages/mcp-server/README.md for setup.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const client = new TraceClient({
    baseUrl: process.env.TRACE_API_BASE_URL ?? "http://localhost:4000",
    serviceToken: requiredEnv("TRACE_MCP_SERVICE_TOKEN"),
  });

  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
