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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A NOTE ON TOOL DESCRIPTIONS
 *
 * The description and the input schema are the only things the model sees before it
 * calls a tool. So they are treated here as part of the contract, not as prose:
 *
 *   - Field names are quoted EXACTLY as the API returns them. Saying "status" when
 *     the payload says `state` sends the model looking for a key that is not there,
 *     and it has no way to discover the mistake.
 *   - Enum-valued inputs are `z.enum(...)` with the API's own accepted values, so a
 *     wrong value is a schema error the model can fix rather than a 400 it must
 *     guess its way out of.
 *   - Scope limits are stated (readiness is ISO 27001 only; evidence upload is
 *     link-only here). An unstated limit reads as full coverage.
 */
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Single source for the version: the manifest. A hand-copied string here drifted
// from package.json before, and a wrong version in the MCP handshake is invisible
// until someone is debugging a client against the wrong release.
const { version: VERSION } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

const BASE_URL = (process.env.KEEL_BASE_URL || 'https://app.keelgrc.com').replace(/\/+$/, '');
const API_KEY = process.env.KEEL_API_KEY?.trim() ?? '';

/** Drop undefined entries so an optional field is omitted rather than sent as null. */
function compact(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

/** `?a=b` from the defined entries only, or '' when nothing is set. */
function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

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
  // A 204 has no body. Returning a bare `{}` made a successful delete
  // indistinguishable from "nothing happened"; say what the status actually was.
  if (!text) return JSON.stringify({ ok: true, status: res.status });
  return text;
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

const server = new McpServer({ name: 'keel', version: VERSION });

// --- Identity ---------------------------------------------------------------
server.tool(
  'keel_whoami',
  'Verify the API key and return the connected Keel organization as {"org":{"id","name","tier"}}, where "tier" is the plan (free / starter / pro / enterprise / msp). Use this first to confirm which workspace you are acting on.',
  {},
  () => tool(() => keelFetch('/me')),
);

// --- Controls ---------------------------------------------------------------
server.tool(
  'keel_list_controls',
  'List the workspace security controls. Each item has "id", "key", "name", "description", "state", "ownerEmail" and "ownerName". Note the status field is named "state", and its values are not_started / in_progress / implemented / gap / not_applicable.',
  {
    query: z
      .string()
      .optional()
      .describe('Optional case-insensitive substring filter over the control key or name.'),
  },
  ({ query }) => tool(() => keelFetch(`/controls${qs({ query })}`)),
);

// --- Readiness --------------------------------------------------------------
server.tool(
  'keel_readiness',
  'Get the audit-readiness summary for ISO/IEC 27001:2022 — this endpoint covers that framework only, not whichever framework the workspace has applied. Returns "framework", "version", "readiness" (percent, integer), "total", "applicable", "covered", "inProgress", "gap", "unaddressed" and "notApplicable".',
  {},
  () => tool(() => keelFetch('/readiness')),
);

// --- Tasks ------------------------------------------------------------------
server.tool(
  'keel_list_tasks',
  'List the workspace compliance tasks. Each item has "id", "title", "description", "status" (open / in_progress / done), "dueAt", "createdAt", "relatedEntityType" and the assignee as "assigneeId" / "assigneeName" / "assigneeEmail".',
  {},
  () => tool(() => keelFetch('/tasks')),
);

server.tool(
  'keel_create_task',
  'Create a compliance task in the workspace. Returns the new task id. Note: an unparseable dueAt is silently ignored by the API and the task is created without a due date, so send a valid ISO-8601 value or omit it.',
  {
    title: z.string().min(1).describe('Short task title (required).'),
    description: z.string().optional().describe('Optional longer description.'),
    dueAt: z
      .string()
      .optional()
      .describe('Optional due date as an ISO-8601 date-time (e.g. 2026-09-01T00:00:00Z).'),
  },
  ({ title, description, dueAt }) =>
    tool(() =>
      keelFetch('/tasks', { method: 'POST', body: compact({ title, description, dueAt }) }),
    ),
);

// --- Risks ------------------------------------------------------------------
server.tool(
  'keel_list_risks',
  'List the workspace risk register. Each item has "id", "title", "description", "category", "likelihood", "impact", "inherentScore", "treatment", "residualLikelihood", "residualImpact", "residualScore", "status", "owner", "ownerEmail", "level" (low / medium / high), "mitigatingControls" and "implementedControls". Sorted by status first (open before closed), then level, then score — so an open low risk appears above a closed high one.',
  {},
  () => tool(() => keelFetch('/risks')),
);

server.tool(
  'keel_create_risk',
  'Add a risk to the workspace risk register. Returns the new risk id. Likelihood and impact are on a 1-5 scale.',
  {
    title: z.string().min(1).describe('Short risk title (required).'),
    likelihood: z.number().describe('Inherent likelihood, 1-5 (required).'),
    impact: z.number().describe('Inherent impact, 1-5 (required).'),
    treatment: z
      .enum(['accept', 'mitigate', 'transfer', 'avoid'])
      .describe('How the risk is being treated (required).'),
    status: z.enum(['open', 'treating', 'accepted', 'closed']).optional().describe('Defaults to open.'),
    description: z.string().optional(),
    category: z.string().optional().describe('Free-text category, e.g. "Access control".'),
    owner: z.string().optional().describe('Owner name.'),
    ownerEmail: z.string().optional().describe('Owner email address.'),
    residualLikelihood: z.number().optional().describe('Post-treatment likelihood, 1-5.'),
    residualImpact: z.number().optional().describe('Post-treatment impact, 1-5.'),
  },
  (args) => tool(() => keelFetch('/risks', { method: 'POST', body: compact(args) })),
);

// --- Vendors ----------------------------------------------------------------
server.tool(
  'keel_list_vendors',
  'List the third-party vendors tracked in the workspace, with "id", "name", "website", "contactEmail", "tier", "inherentTier", "residualTier", "status", "dataAccess", "notes", "lastReviewedAt" and "reviewDue".',
  {
    query: z
      .string()
      .optional()
      .describe('Optional case-insensitive substring filter over the vendor name.'),
  },
  ({ query }) => tool(() => keelFetch(`/vendors${qs({ query })}`)),
);

server.tool(
  'keel_create_vendor',
  'Add a vendor to the workspace vendor register. Returns the new vendor id and tier.',
  {
    name: z.string().min(1).describe('Vendor name (required).'),
    tier: z
      .enum(['critical', 'high', 'medium', 'low'])
      .optional()
      .describe('Criticality tier. Defaults to medium.'),
    status: z.enum(['active', 'in_review', 'offboarded']).optional(),
    website: z.string().optional(),
    contactEmail: z.string().optional(),
    dataAccess: z
      .string()
      .optional()
      .describe('What customer or company data this vendor can reach.'),
    notes: z.string().optional(),
  },
  (args) => tool(() => keelFetch('/vendors', { method: 'POST', body: compact(args) })),
);

// --- People -----------------------------------------------------------------
server.tool(
  'keel_list_people',
  'List the workspace personnel directory, with "id", "source", "externalId", "email", "fullName", "jobTitle", "department", "groups", "managerEmail", "status" and "lastSyncedAt".',
  {
    query: z
      .string()
      .optional()
      .describe('Optional case-insensitive substring filter over full name and email.'),
  },
  ({ query }) => tool(() => keelFetch(`/people${qs({ query })}`)),
);

server.tool(
  'keel_upsert_person',
  'Add a person to the workspace directory, or update them if the email already exists. Idempotent: the response includes "created" (true for a new record, false for an update). Only manually-created records are updated — a person synced from an identity provider is returned unchanged.',
  {
    email: z.string().min(1).describe('Email address — the identity key (required).'),
    fullName: z.string().optional(),
    jobTitle: z.string().optional(),
    department: z.string().optional(),
    groups: z.array(z.string()).optional().describe('Group or team names.'),
    managerEmail: z.string().optional(),
    status: z.enum(['active', 'suspended', 'deprovisioned']).optional(),
  },
  (args) => tool(() => keelFetch('/people', { method: 'POST', body: compact(args) })),
);

// --- Policies ---------------------------------------------------------------
server.tool(
  'keel_list_policies',
  'List the workspace policies, with "id", "key", "title", "status", "version", "updatedAt", "approvedAt", "reviewDue" and "ownerMembershipId".',
  {
    query: z
      .string()
      .optional()
      .describe('Optional case-insensitive substring filter over the policy title.'),
  },
  ({ query }) => tool(() => keelFetch(`/policies${qs({ query })}`)),
);

server.tool(
  'keel_create_policy',
  'Create a policy from Markdown. Returns the new policy id, key and title. The key is derived from the title when not supplied; a policy is identified by its key, so reusing a key targets the existing policy.',
  {
    title: z.string().min(1).describe('Policy title (required).'),
    key: z
      .string()
      .optional()
      .describe('Stable slug, max 60 chars. Derived from the title when omitted.'),
    markdown: z.string().optional().describe('Policy body as Markdown, up to 200 KB.'),
    description: z.string().optional().describe('Used as the body when markdown is omitted.'),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .describe('Template variables to substitute. Up to 100 keys, values up to 5000 chars.'),
  },
  (args) => tool(() => keelFetch('/policies', { method: 'POST', body: compact(args) })),
);

// --- Evidence ---------------------------------------------------------------
server.tool(
  'keel_list_evidence',
  'List collected evidence, with "id", "type" (file / link), "title", "description", "filename", "sizeBytes", "contentType", "url", "collectedAt" and "expiresAt".',
  {
    since: z
      .string()
      .optional()
      .describe(
        'Optional ISO-8601 date-time. Returns only evidence collected strictly after it.',
      ),
  },
  ({ since }) => tool(() => keelFetch(`/evidence${qs({ since })}`)),
);

server.tool(
  'keel_add_evidence_link',
  'Attach a URL as evidence, optionally against a control. This tool covers link evidence only — uploading a file is a multipart request the REST API supports but this stdio server does not, so use the Keel app or the REST API directly for file evidence.',
  {
    url: z.string().min(1).describe('http(s) URL of the evidence (required).'),
    title: z.string().optional().describe('Defaults to the URL hostname.'),
    description: z.string().optional(),
    controlId: z.string().optional().describe('Control id to attach the evidence to.'),
    controlKey: z
      .string()
      .optional()
      .describe('Control key to attach to, resolved server-side. Alternative to controlId.'),
  },
  (args) => tool(() => keelFetch('/evidence', { method: 'POST', body: compact(args) })),
);

// --- Webhooks ---------------------------------------------------------------
server.tool(
  'keel_list_webhooks',
  'List the workspace webhook subscriptions, with "id", "targetUrl", "event" and "createdVia". The signing secret is never returned.',
  {},
  () => tool(() => keelFetch('/hooks')),
);

server.tool(
  'keel_create_webhook',
  'Subscribe a target URL to Keel events. Use event "all" to receive every event. The URL must be a public HTTPS endpoint — the API rejects http://, localhost and private network addresses.',
  {
    targetUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), {
        message: 'targetUrl must be an https:// URL — the Keel API rejects plain HTTP.',
      })
      .describe('Public HTTPS URL that will receive event POSTs.'),
    event: z
      .string()
      .optional()
      .describe('Event name to subscribe to (e.g. control.status_changed) or "all".'),
  },
  ({ targetUrl, event }) =>
    tool(() => keelFetch('/hooks', { method: 'POST', body: compact({ targetUrl, event }) })),
);

server.tool(
  'keel_delete_webhook',
  'Delete a webhook subscription by id. Idempotent — deleting an id that does not exist also succeeds, so a success result does not prove a subscription was removed. Call keel_list_webhooks to confirm.',
  { id: z.string().describe('The webhook subscription id to remove.') },
  ({ id }) => tool(() => keelFetch(`/hooks/${encodeURIComponent(id)}`, { method: 'DELETE' })),
);

// --- Boot -------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport: never log to stdout (it is the protocol channel); stderr is safe.
  process.stderr.write(`keelgrc-mcp ${VERSION} ready → ${BASE_URL}/api/v1\n`);
}

main().catch((e) => {
  process.stderr.write(`keelgrc-mcp failed to start: ${(e as Error).message}\n`);
  process.exit(1);
});
