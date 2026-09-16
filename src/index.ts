#!/usr/bin/env node
/**
 * Keel MCP server.
 *
 * A thin Model Context Protocol wrapper over the Keel public API (`/api/v1`), so an
 * MCP client (Claude Desktop, Claude Code, Cursor, etc.) can read and act on a
 * Keel workspace in natural language. Every action maps to a real API endpoint and
 * is scoped to the API key's organization (the same RLS-scoped surface the REST API
 * exposes), so the MCP grants no more access than the key already has.
 *
 * The tools are RESOURCE-shaped: one tool per API resource, taking an `action`
 * argument, rather than one tool per operation. `src/tools.ts` explains why, and
 * holds every description the model sees.
 *
 * Config (env):
 *   KEEL_API_KEY   required: a workspace API key (create one under Integrations).
 *   KEEL_BASE_URL  optional: workspace origin (default https://app.keelgrc.com).
 *
 * Run:  KEEL_API_KEY=… npx keelgrc-mcp     (stdio transport)
 */
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { baseUrl } from './api.js';
import { registerTools } from './tools.js';

// Single source for the version: the manifest. A hand-copied string here drifted
// from package.json before, and a wrong version in the MCP handshake is invisible
// until someone is debugging a client against the wrong release.
const { version: VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

const server = new McpServer({ name: 'keel', version: VERSION });
registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport: never log to stdout (it is the protocol channel); stderr is safe.
  process.stderr.write(`keelgrc-mcp ${VERSION} ready → ${baseUrl}/api/v1\n`);
}

main().catch((e) => {
  process.stderr.write(`keelgrc-mcp failed to start: ${(e as Error).message}\n`);
  process.exit(1);
});
