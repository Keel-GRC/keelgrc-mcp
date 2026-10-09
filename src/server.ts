/**
 * Library entry (`keelgrc-mcp/server`): build a Keel MCP server bound to one API key,
 * without a transport. The stdio binary (`src/index.ts`) and the hosted endpoint at
 * https://app.keelgrc.com/mcp both register exactly the tools in `./tools.ts`, so the
 * two cannot offer different capabilities.
 *
 * Nothing here reads the environment or the filesystem, so it bundles into a
 * Cloudflare Worker. The caller supplies the version (the hosted server reads it from
 * this package's package.json, which is exported for that).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createKeelFetch, type KeelClientOptions } from './api.js';
import { registerTools } from './tools.js';

export type { KeelClientOptions, KeelFetch } from './api.js';
export { createKeelFetch } from './api.js';

export interface KeelMcpServerOptions extends KeelClientOptions {
  /** Reported in the MCP handshake as `serverInfo.version`. */
  version: string;
}

export function createKeelMcpServer(opts: KeelMcpServerOptions): McpServer {
  const server = new McpServer({ name: 'keel', version: opts.version });
  registerTools(server, createKeelFetch(opts));
  return server;
}
