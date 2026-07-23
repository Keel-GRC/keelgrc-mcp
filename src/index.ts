#!/usr/bin/env node
/**
 * Keel MCP server.
 *
 * A thin Model Context Protocol wrapper over the Keel public API (`/api/v1`), so an
 * MCP client (Claude Desktop, Claude Code, Cursor, etc.) can read and act on a
 * Keel workspace in natural language. Every tool maps 1:1 to a real API endpoint and
 * is scoped to the API key's organization (the same RLS-scoped surface the REST API
 * exposes), so the MCP grants no more access than the key already has.
 *
 * Config (env):
 *   KEEL_API_KEY   required: a workspace API key (create one under Integrations).
 *   KEEL_BASE_URL  optional: workspace origin (default https://app.keelgrc.com).
 *
 * Run:  KEEL_API_KEY=… npx keelgrc-mcp     (stdio transport)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.KEEL_BASE_URL || 'https://app.keelgrc.com').replace(/\/+$/, '');
const API_KEY = process.env.KEEL_API_KEY?.trim() ?? '';

/** Call the Keel API and return the raw response body, throwing on non-2xx. */
async function keelFetch(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<string> {
  if (!API_KEY) {
    throw new Error(
      'KEEL_API_KEY is not set. Create an API key under Integrations in your Keel workspace and set KEEL_API_KEY.',
    );
  }
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Keel API ${res.status} ${res.statusText}: ${text || '(empty body)'}`);
  }
  return text || '{}';
}

/** Wrap a tool body so any error surfaces to the client as an isError text result. */
async function tool(run: () => Promise<string>) {
  try {
    return { content: [{ type: 'text' as const, text: await run() }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: (e as Error).message }],
    };
  }
}

const server = new McpServer({ name: 'keel', version: '0.1.0' });

// --- Identity ---------------------------------------------------------------
server.tool(
  'keel_whoami',
  'Verify the API key and return the connected Keel organization (id, name, plan tier). Use this first to confirm which workspace you are acting on.',
  {},
  () => tool(() => keelFetch('/me')),
);

// --- Controls ---------------------------------------------------------------
server.tool(
  'keel_list_controls',
  "List the workspace's security controls with their status (not_started / in_progress / implemented / gap / not_applicable) and owner.",
  {},
  () => tool(() => keelFetch('/controls')),
);

// --- Readiness --------------------------------------------------------------
server.tool(
  'keel_readiness',
  'Get the ISO/IEC 27001 audit-readiness summary: percent covered plus counts of covered / in-progress / gap / unaddressed / not-applicable requirements.',
  {},
  () => tool(() => keelFetch('/readiness')),
);

// --- Tasks ------------------------------------------------------------------
server.tool(
  'keel_list_tasks',
  'List the workspace compliance tasks (open, in-progress, and done).',
  {},
  () => tool(() => keelFetch('/tasks')),
);

server.tool(
  'keel_create_task',
  'Create a compliance task in the workspace. Returns the new task id.',
  {
    title: z.string().min(1).describe('Short task title (required).'),
    description: z.string().optional().describe('Optional longer description.'),
    dueAt: z
      .string()
      .optional()
      .describe('Optional due date as an ISO-8601 date-time (e.g. 2026-09-01T00:00:00Z).'),
  },
  ({ title, description, dueAt }) =>
    tool(() => keelFetch('/tasks', { method: 'POST', body: { title, description, dueAt } })),
);

// --- Webhooks ---------------------------------------------------------------
server.tool(
  'keel_list_webhooks',
  'List the workspace webhook subscriptions.',
  {},
  () => tool(() => keelFetch('/hooks')),
);

server.tool(
  'keel_create_webhook',
  'Subscribe a target URL to Keel events. Use event "all" to receive every event.',
  {
    targetUrl: z.string().url().describe('HTTPS URL that will receive event POSTs.'),
    event: z
      .string()
      .optional()
      .describe('Event name to subscribe to (e.g. control.status_changed) or "all".'),
  },
  ({ targetUrl, event }) =>
    tool(() => keelFetch('/hooks', { method: 'POST', body: { targetUrl, event } })),
);

server.tool(
  'keel_delete_webhook',
  'Delete a webhook subscription by id.',
  { id: z.string().describe('The webhook subscription id to remove.') },
  ({ id }) => tool(() => keelFetch(`/hooks/${encodeURIComponent(id)}`, { method: 'DELETE' })),
);

// --- Boot -------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport: never log to stdout (it is the protocol channel); stderr is safe.
  process.stderr.write(`keelgrc-mcp ready → ${BASE_URL}/api/v1\n`);
}

main().catch((e) => {
  process.stderr.write(`keelgrc-mcp failed to start: ${(e as Error).message}\n`);
  process.exit(1);
});
