/**
 * The Keel MCP tool layer: one tool per API resource, with an `action` parameter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY RESOURCE TOOLS RATHER THAN ONE TOOL PER OPERATION (D578)
 *
 * The Keel app has 354 server actions. Exposing them one tool each is faithful and
 * unusable: MCP clients degrade badly past roughly 100 tools, which is why tool
 * search exists at all. So a resource is one tool, and the operation is an argument:
 * `keel_policies` with `action: "list" | "get" | "create" | "update" | "delete"`.
 *
 * The cost of that shape is that the input schema cannot say which fields an action
 * needs, because the fields of five actions share one flat object. `need()` carries
 * that instead, and names the tool, the action and the missing field so a failed
 * call tells the model what to send next.
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
 *   - An action a resource does NOT have is named and explained rather than left
 *     out. A missing `delete` reads as an oversight; "Keel has no delete-a-task
 *     operation on any surface" reads as the answer it is.
 *   - Scope limits are stated (readiness is ISO 27001 only; evidence upload is
 *     link-only here). An unstated limit reads as full coverage.
 *   - Every input schema is STRICT, and every action calls `only()`. An argument no
 *     action takes is a validation error, and one this action does not send is an
 *     error naming it. Both used to be dropped while the call reported success, which
 *     cost a real migration its start dates and vendor links without a word.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROLES
 *
 * The API key acts as the member who created it. Writes are refused for the auditor
 * role, and deletes mostly need owner or admin, matching what the same person can do
 * in the browser. A key created BEFORE keys carried an actor has no member and
 * therefore no role: it can still read, and every write answers 403 until the key is
 * re-created. The API's own 403 body says so, and it is
 * passed through verbatim rather than reworded here.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compact, keelFetch, need, only, qs, seg, tool } from './api.js';

/** `id` field, phrased per resource so the model knows which id is wanted. */
const idField = (what: string) =>
  z.string().optional().describe(`The ${what} id. Required for get, update and delete.`);

/**
 * A date input that can also be cleared.
 *
 * `null` is not the same as omitting the field, and both are reachable here on
 * purpose: omitted leaves the stored value alone, null clears it. Collapsing them
 * would make every partial update wipe the dates it did not mention.
 */
const clearableDate = (what: string) =>
  z
    .string()
    .nullable()
    .optional()
    .describe(`${what} as an ISO-8601 date-time, or null to clear it. Omit to leave unchanged.`);

export function registerTools(server: McpServer): void {
  // --- Identity -------------------------------------------------------------
  server.registerTool(
    'keel_whoami',
    {
      description:
        'Verify the API key and return the connected Keel organization as {"org":{"id","name","tier"}}, where "tier" is the plan (free / starter / pro / enterprise / msp). Takes no arguments. Use this first to confirm which workspace you are acting on.',
      inputSchema: z.strictObject({}),
    },
    () => tool(() => keelFetch('/me')),
  );

  // --- Members --------------------------------------------------------------
  server.registerTool(
    'keel_members',
    {
      description:
        'List the people with a seat in this workspace, as {"members":[{"id","email","name","role"}]}, where "role" is owner / admin / member / auditor. Takes no arguments; read-only. These ids are what "ownerMembershipId" on a policy, "ownerId" on evidence and "assigneeId" on a task hold, and the emails are what "ownerEmail" (policies) and "assigneeEmail" (tasks) must match. This is not the HR directory: keel_people lists employees, including ones with no Keel seat.',
      inputSchema: z.strictObject({}),
    },
    () => tool(() => keelFetch('/members')),
  );

  // --- Frameworks -----------------------------------------------------------
  server.registerTool(
    'keel_frameworks',
    {
      description:
        'List every compliance framework the workspace has APPLIED, each with its readiness. Takes no arguments. Each item has "key", "name", "version", "primary" (true for the one the dashboard leads with), "readiness" (percent, integer), "total", "applicable", "covered", "inProgress", "gap", "unaddressed", "notApplicable", "clauseCount" and "bundle". "total" is the clauses still in scope for this workspace, so clauseCount minus total is what has been excluded. This is the tool to use when asked how the workspace is doing: keel_readiness answers for ISO/IEC 27001 only, whether or not the workspace runs it.',
      inputSchema: z.strictObject({}),
    },
    () => tool(() => keelFetch('/frameworks')),
  );

  // --- Readiness ------------------------------------------------------------
  server.registerTool(
    'keel_readiness',
    {
      description:
        'Get the audit-readiness summary for ISO/IEC 27001:2022. This endpoint covers that framework only, not whichever framework the workspace has applied, so use keel_frameworks for the workspace\'s own frameworks. Takes no arguments. Returns "framework", "version", "readiness" (percent, integer), "total", "applicable", "covered", "inProgress", "gap", "unaddressed" and "notApplicable".',
      inputSchema: z.strictObject({}),
    },
    () => tool(() => keelFetch('/readiness')),
  );

  // --- Controls -------------------------------------------------------------
  server.registerTool(
    'keel_controls',
    {
      description:
        'Read and maintain the workspace security controls. Actions: "list" (optional "query" substring over key and name), "get", "update", "delete". Each control has "id", "key", "name", "description", "state", "ownerEmail" and "ownerName" — note the status field is called "state", not "status". There is no "create": controls come from the framework content Keel ships and from the app, and the REST API has no endpoint that creates one. Updating "name", "description" or "ownerEmail" needs the owner or admin role; moving "state" alone is open to any role except auditor. Deleting a control also removes its framework mappings and its evidence and risk links, which moves the readiness denominator for every framework it was mapped to.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'update', 'delete']),
        id: idField('control'),
        query: z
          .string()
          .optional()
          .describe('list only: case-insensitive substring filter over the control key or name.'),
        name: z.string().optional().describe('update only. Owner or admin.'),
        description: z.string().nullable().optional().describe('update only. Owner or admin.'),
        ownerEmail: z
          .string()
          .nullable()
          .optional()
          .describe('update only. Null clears the owner. Owner or admin.'),
        state: z
          .enum(['not_started', 'in_progress', 'implemented', 'gap', 'not_applicable'])
          .optional()
          .describe('update only: the implementation state. Any role except auditor.'),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_controls';
        switch (a.action) {
          case 'list':
            only(T, 'list', a, ['query']);
            return keelFetch(`/controls${qs({ query: a.query })}`);
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/controls/${seg(need(T, 'get', 'id', a.id))}`);
          case 'update':
            only(T, 'update', a, ['id', 'name', 'description', 'ownerEmail', 'state']);
            return keelFetch(`/controls/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: compact({
                name: a.name,
                description: a.description,
                ownerEmail: a.ownerEmail,
                state: a.state,
              }),
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/controls/${seg(need(T, 'delete', 'id', a.id))}`, {
              method: 'DELETE',
            });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- Tasks ----------------------------------------------------------------
  server.registerTool(
    'keel_tasks',
    {
      description:
        'Read and maintain the workspace compliance tasks. Actions: "list", "get", "create", "update". Each task has "id", "title", "description", "status" (open / in_progress / blocked / done / cancelled), "dueAt", "createdAt", "relatedEntityType" and the assignee as "assigneeId" / "assigneeName" / "assigneeEmail". There is NO "delete", and that is not a gap in this server: Keel has no delete-a-task operation on any surface, the app included, so nothing to map exists. Retire a task by updating its "status" to "cancelled", which keeps it as a record of what was decided. "update" changes the status, the assignee, or both; title, description and due date are not editable after creation, in the app either. Assign with "assigneeEmail", which must be the email of a workspace member (see keel_members) or the call fails and nothing is written; the assignment fires the task.assigned webhook but sends no email. Tasks have no start date. Any role except auditor.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'create', 'update']),
        id: idField('task'),
        title: z.string().optional().describe('create only: short task title (required).'),
        description: z.string().optional().describe('create only.'),
        dueAt: z
          .string()
          .optional()
          .describe(
            'create only: due date as an ISO-8601 date or date-time. An unparseable value is refused and no task is created.',
          ),
        assigneeEmail: z
          .string()
          .nullable()
          .optional()
          .describe(
            'create and update: email of the workspace member to assign. On update, null unassigns.',
          ),
        status: z
          .enum(['open', 'in_progress', 'blocked', 'done', 'cancelled'])
          .optional()
          .describe('update only: the new lifecycle status.'),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_tasks';
        switch (a.action) {
          case 'list':
            only(T, 'list', a, []);
            return keelFetch('/tasks');
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/tasks/${seg(need(T, 'get', 'id', a.id))}`);
          case 'create':
            only(T, 'create', a, ['title', 'description', 'dueAt', 'assigneeEmail']);
            return keelFetch('/tasks', {
              method: 'POST',
              body: compact({
                title: need(T, 'create', 'title', a.title),
                description: a.description,
                dueAt: a.dueAt,
                assigneeEmail: a.assigneeEmail ?? undefined,
              }),
            });
          case 'update':
            only(T, 'update', a, ['id', 'status', 'assigneeEmail']);
            if (a.status === undefined && a.assigneeEmail === undefined) {
              throw new Error(`${T}: the "update" action requires "status" or "assigneeEmail".`);
            }
            return keelFetch(`/tasks/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: compact({ status: a.status, assigneeEmail: a.assigneeEmail }),
            });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- Risks ----------------------------------------------------------------
  server.registerTool(
    'keel_risks',
    {
      description:
        'Read and maintain the workspace risk register. Actions: "list", "get", "create", "update", "delete". Each risk has "id", "title", "description", "category", "likelihood", "impact", "inherentScore", "treatment", "residualLikelihood", "residualImpact", "residualScore", "status", "owner", "ownerEmail", "level" (low / medium / high), "mitigatingControls" and "implementedControls". The list is sorted by status first (open before closed), then level, then score, so an open low risk appears above a closed high one. Likelihood and impact are 1-5 and are clamped to that range. "update" changes only the fields you send. Creating and updating need any role except auditor; deleting needs the owner or admin role and is irreversible.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        id: idField('risk'),
        title: z.string().optional().describe('Required for create.'),
        likelihood: z.number().optional().describe('Inherent likelihood, 1-5. Required for create.'),
        impact: z.number().optional().describe('Inherent impact, 1-5. Required for create.'),
        treatment: z
          .enum(['accept', 'mitigate', 'transfer', 'avoid'])
          .optional()
          .describe('How the risk is being treated. Required for create.'),
        status: z
          .enum(['open', 'treating', 'accepted', 'closed'])
          .optional()
          .describe('Defaults to open on create.'),
        description: z.string().optional(),
        category: z.string().optional().describe('Free-text category, e.g. "Access control".'),
        owner: z.string().optional().describe('Owner name.'),
        ownerEmail: z.string().optional().describe('Owner email address.'),
        residualLikelihood: z.number().optional().describe('Post-treatment likelihood, 1-5.'),
        residualImpact: z.number().optional().describe('Post-treatment impact, 1-5.'),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_risks';
        const fields = compact({
          title: a.title,
          description: a.description,
          category: a.category,
          likelihood: a.likelihood,
          impact: a.impact,
          treatment: a.treatment,
          status: a.status,
          owner: a.owner,
          ownerEmail: a.ownerEmail,
          residualLikelihood: a.residualLikelihood,
          residualImpact: a.residualImpact,
        });
        switch (a.action) {
          case 'list':
            only(T, 'list', a, []);
            return keelFetch('/risks');
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/risks/${seg(need(T, 'get', 'id', a.id))}`);
          case 'create':
            only(T, 'create', a, ['title', 'description', 'category', 'likelihood', 'impact', 'treatment', 'status', 'owner', 'ownerEmail', 'residualLikelihood', 'residualImpact']);
            need(T, 'create', 'title', a.title);
            need(T, 'create', 'likelihood', a.likelihood);
            need(T, 'create', 'impact', a.impact);
            need(T, 'create', 'treatment', a.treatment);
            return keelFetch('/risks', { method: 'POST', body: fields });
          case 'update':
            only(T, 'update', a, ['id', 'title', 'description', 'category', 'likelihood', 'impact', 'treatment', 'status', 'owner', 'ownerEmail', 'residualLikelihood', 'residualImpact']);
            return keelFetch(`/risks/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: fields,
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/risks/${seg(need(T, 'delete', 'id', a.id))}`, { method: 'DELETE' });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- Vendors --------------------------------------------------------------
  server.registerTool(
    'keel_vendors',
    {
      description:
        'Read and maintain the third-party vendor register. Actions: "list" (optional "query" substring over the name), "get", "create", "update", "delete". Each vendor has "id", "name", "website", "contactEmail", "tier", "inherentTier", "residualTier", "auth", "authCredits", "status", "dataAccess", "notes", "lastReviewedAt" and "reviewDue". READ THE TIER FIELDS CAREFULLY: "tier" on the way out is the EFFECTIVE (residual) criticality after the vendor\'s access controls are credited, while "tier" on the way in sets the INHERENT criticality. Reading a vendor and sending its "tier" straight back therefore writes the residual into the inherent value and ratchets it down; send "inherentTier" back as "tier" instead. The authentication posture ("auth": mfa, passwordPolicy, sso) is readable and NOT writable here, because the underlying update treats any one of the three as the caller owning all three and would silently clear the other two. Change it in the Keel app. Creating and updating need any role except auditor; deleting does too, matching the app.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        id: idField('vendor'),
        query: z
          .string()
          .optional()
          .describe('list only: case-insensitive substring filter over the vendor name.'),
        name: z.string().optional().describe('Required for create.'),
        tier: z
          .enum(['critical', 'high', 'medium', 'low'])
          .optional()
          .describe(
            'The INHERENT criticality. Defaults to medium on create. Do not pass the "tier" you read back from a get; pass its "inherentTier".',
          ),
        residualTier: z
          .enum(['critical', 'high', 'medium', 'low'])
          .optional()
          .describe(
            'update only: record an assessed residual criticality. Raises the inherent tier if needed to keep inherent at least as high as residual.',
          ),
        status: z.enum(['active', 'in_review', 'offboarded']).optional(),
        website: z.string().optional(),
        contactEmail: z.string().optional(),
        dataAccess: z
          .string()
          .optional()
          .describe('What customer or company data this vendor can reach.'),
        notes: z.string().optional(),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_vendors';
        switch (a.action) {
          case 'list':
            only(T, 'list', a, ['query']);
            return keelFetch(`/vendors${qs({ query: a.query })}`);
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/vendors/${seg(need(T, 'get', 'id', a.id))}`);
          case 'create':
            only(T, 'create', a, ['name', 'tier', 'status', 'website', 'contactEmail', 'dataAccess', 'notes']);
            return keelFetch('/vendors', {
              method: 'POST',
              body: compact({
                name: need(T, 'create', 'name', a.name),
                tier: a.tier,
                status: a.status,
                website: a.website,
                contactEmail: a.contactEmail,
                dataAccess: a.dataAccess,
                notes: a.notes,
              }),
            });
          case 'update':
            only(T, 'update', a, ['id', 'name', 'tier', 'residualTier', 'status', 'website', 'contactEmail', 'dataAccess', 'notes']);
            return keelFetch(`/vendors/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: compact({
                name: a.name,
                tier: a.tier,
                residualTier: a.residualTier,
                status: a.status,
                website: a.website,
                contactEmail: a.contactEmail,
                dataAccess: a.dataAccess,
                notes: a.notes,
              }),
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/vendors/${seg(need(T, 'delete', 'id', a.id))}`, {
              method: 'DELETE',
            });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- People ---------------------------------------------------------------
  server.registerTool(
    'keel_people',
    {
      description:
        'Read and maintain the workspace personnel directory. Actions: "list" (optional "query" substring over full name and email), "get", "create", "update", "delete". Each person has "id", "source", "externalId", "email", "fullName", "jobTitle", "department", "groups", "managerEmail", "status" and "lastSyncedAt". "create" is an upsert keyed on email: re-sending an existing address updates that person rather than duplicating them, and the response includes "created". A person whose "source" is not "manual" is synced from an identity connector, so their profile is read-only here and an edit is refused naming the connector; their "status" can still be changed. DELETING IS NOT OFFBOARDING: a person who has left should be updated to "deprovisioned", which keeps the row and writes the audit entry an auditor asks for, whereas deleting removes the evidence they were ever in the directory. Every action except list and get needs the owner or admin role.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        id: idField('person'),
        query: z
          .string()
          .optional()
          .describe('list only: case-insensitive substring filter over full name and email.'),
        email: z
          .string()
          .optional()
          .describe('create only: the identity key (required). Update is addressed by "id".'),
        fullName: z.string().optional(),
        jobTitle: z.string().optional(),
        department: z.string().optional(),
        groups: z.array(z.string()).optional().describe('Group or team names.'),
        managerEmail: z.string().optional(),
        status: z.enum(['active', 'suspended', 'deprovisioned']).optional(),
        note: z
          .string()
          .optional()
          .describe('update only: recorded against a status change, e.g. why someone was offboarded.'),
        steps: z
          .array(z.string())
          .optional()
          .describe('update only: offboarding steps completed, recorded with a status change.'),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_people';
        const profile = {
          fullName: a.fullName,
          jobTitle: a.jobTitle,
          department: a.department,
          groups: a.groups,
          managerEmail: a.managerEmail,
          status: a.status,
        };
        switch (a.action) {
          case 'list':
            only(T, 'list', a, ['query']);
            return keelFetch(`/people${qs({ query: a.query })}`);
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/people/${seg(need(T, 'get', 'id', a.id))}`);
          case 'create':
            only(T, 'create', a, ['email', 'fullName', 'jobTitle', 'department', 'groups', 'managerEmail', 'status']);
            return keelFetch('/people', {
              method: 'POST',
              body: compact({ email: need(T, 'create', 'email', a.email), ...profile }),
            });
          case 'update':
            only(T, 'update', a, ['id', 'fullName', 'jobTitle', 'department', 'groups', 'managerEmail', 'status', 'note', 'steps']);
            return keelFetch(`/people/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: compact({ ...profile, note: a.note, steps: a.steps }),
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/people/${seg(need(T, 'delete', 'id', a.id))}`, { method: 'DELETE' });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- Policies -------------------------------------------------------------
  server.registerTool(
    'keel_policies',
    {
      description:
        'Read and maintain the workspace policies. Actions: "list" (optional "query" substring over the title), "get", "create", "update", "delete". "list" returns "id", "key", "title", "status", "version", "updatedAt", "approvedAt", "reviewDue" and "ownerMembershipId" (a workspace member id; keel_members maps it to a person); "get" adds "effectiveDate", the "markdown" body and the template "fields", so read one policy with "get" rather than trying to find its text in the list. "create" derives "key" from the title when you do not supply one, and a policy is identified by its key, so reusing a key targets the existing policy instead of making a second one. "update" sends only the fields you pass, merges "fields" onto the stored values rather than replacing them, and records a revision in the policy history attributed to the member the key acts as, exactly as a save in the app does. Set the owner on "update" with "ownerEmail" (the email of a workspace member) or "ownerMembershipId", not both; "create" takes no owner, status or dates, so create first and then update. Creating and updating need any role except auditor; deleting needs the owner or admin role and is irreversible, with no restore window and no way to reconstruct the body afterwards.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        id: idField('policy'),
        query: z
          .string()
          .optional()
          .describe('list only: case-insensitive substring filter over the policy title.'),
        title: z.string().optional().describe('Required for create.'),
        key: z
          .string()
          .optional()
          .describe('create only: stable slug, max 60 chars. Derived from the title when omitted.'),
        markdown: z.string().optional().describe('The policy body as Markdown, up to 200 KB.'),
        description: z
          .string()
          .optional()
          .describe('create only: used as the body when "markdown" is omitted.'),
        fields: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Template variable values. Up to 100 keys, values up to 5000 chars. On update these merge onto the stored values; a placeholder you do not mention keeps its value.',
          ),
        status: z.enum(['draft', 'in_review', 'approved', 'archived']).optional(),
        effectiveDate: clearableDate('update only: when the policy takes effect'),
        reviewDue: clearableDate('update only: when the policy is next due for review'),
        ownerMembershipId: z
          .string()
          .optional()
          .describe(
            'update only: workspace member id of the owner. Must be a member of this workspace or the whole document-control update is refused. Prefer ownerEmail.',
          ),
        ownerEmail: z
          .string()
          .nullable()
          .optional()
          .describe(
            'update only: email of the workspace member who owns the policy (see keel_members), or null to clear the owner. An address that matches no member is refused and nothing is written.',
          ),
        bump: z
          .enum(['major', 'minor'])
          .optional()
          .describe(
            'update only: how the revision is numbered in the policy history. Defaults to major.',
          ),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_policies';
        switch (a.action) {
          case 'list':
            only(T, 'list', a, ['query']);
            return keelFetch(`/policies${qs({ query: a.query })}`);
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/policies/${seg(need(T, 'get', 'id', a.id))}`);
          case 'create':
            only(T, 'create', a, ['title', 'key', 'markdown', 'description', 'fields']);
            return keelFetch('/policies', {
              method: 'POST',
              body: compact({
                title: need(T, 'create', 'title', a.title),
                key: a.key,
                markdown: a.markdown,
                description: a.description,
                fields: a.fields,
              }),
            });
          case 'update':
            only(T, 'update', a, ['id', 'title', 'markdown', 'fields', 'status', 'effectiveDate', 'reviewDue', 'ownerMembershipId', 'ownerEmail', 'bump']);
            return keelFetch(`/policies/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: compact({
                title: a.title,
                markdown: a.markdown,
                fields: a.fields,
                status: a.status,
                effectiveDate: a.effectiveDate,
                reviewDue: a.reviewDue,
                ownerMembershipId: a.ownerMembershipId,
                ownerEmail: a.ownerEmail,
                bump: a.bump,
              }),
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/policies/${seg(need(T, 'delete', 'id', a.id))}`, {
              method: 'DELETE',
            });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- Evidence -------------------------------------------------------------
  server.registerTool(
    'keel_evidence',
    {
      description:
        'Read and maintain collected evidence. Actions: "list" (optional "since" ISO date-time, returning only evidence collected strictly after it), "get", "create", "update", "delete". Each item has "id", "type" (file / link / attestation), "title", "description", "filename", "sizeBytes", "contentType", "url", "collectedAt", "expiresAt" and "controls" (the linked controls, as {"id","key"}); "get" also returns "ownerId". "create" attaches a URL as link evidence and covers LINK EVIDENCE ONLY — the REST API also accepts a file upload as multipart form data, which a stdio MCP server cannot stream, so upload files in the Keel app or against the REST API directly. A control named on "create" must exist in this workspace or the call fails and nothing is created. "update" sets or clears the review date and the owner, and links or unlinks controls with "linkControls" / "unlinkControls" (control ids or keys; every one must exist in this workspace or nothing changes). Title, description and the file itself are not editable in the app either, so replace an item by reporting it again. Evidence cannot be attached to a vendor. Deleting also removes the stored file and needs any role except auditor.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        id: idField('evidence'),
        since: z
          .string()
          .optional()
          .describe('list only: ISO-8601 date-time. Returns evidence collected strictly after it.'),
        url: z.string().optional().describe('create only: http(s) URL of the evidence (required).'),
        title: z.string().optional().describe('create only. Defaults to the URL hostname.'),
        description: z.string().optional().describe('create only.'),
        controlId: z.string().optional().describe('create only: control id to attach the evidence to.'),
        controlKey: z
          .string()
          .optional()
          .describe('create only: control key to attach to, resolved server-side. Use instead of controlId.'),
        linkControls: z
          .array(z.string())
          .max(200)
          .optional()
          .describe('update only: control ids or keys to link this evidence to. Already-linked ones are left alone.'),
        unlinkControls: z
          .array(z.string())
          .max(200)
          .optional()
          .describe('update only: control ids or keys to unlink. Ones not linked are left alone.'),
        expiresAt: clearableDate('update only: when this evidence goes stale'),
        ownerId: z
          .string()
          .nullable()
          .optional()
          .describe(
            'update only: workspace member id (see keel_members) answerable for keeping this current, or null to unown it. A member id from another workspace is refused.',
          ),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_evidence';
        switch (a.action) {
          case 'list':
            only(T, 'list', a, ['since']);
            return keelFetch(`/evidence${qs({ since: a.since })}`);
          case 'get':
            only(T, 'get', a, ['id']);
            return keelFetch(`/evidence/${seg(need(T, 'get', 'id', a.id))}`);
          case 'create':
            only(T, 'create', a, ['url', 'title', 'description', 'controlId', 'controlKey']);
            return keelFetch('/evidence', {
              method: 'POST',
              body: compact({
                url: need(T, 'create', 'url', a.url),
                title: a.title,
                description: a.description,
                controlId: a.controlId,
                controlKey: a.controlKey,
              }),
            });
          case 'update':
            only(T, 'update', a, ['id', 'expiresAt', 'ownerId', 'linkControls', 'unlinkControls']);
            return keelFetch(`/evidence/${seg(need(T, 'update', 'id', a.id))}`, {
              method: 'PATCH',
              body: compact({
                expiresAt: a.expiresAt,
                ownerId: a.ownerId,
                linkControls: a.linkControls,
                unlinkControls: a.unlinkControls,
              }),
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/evidence/${seg(need(T, 'delete', 'id', a.id))}`, {
              method: 'DELETE',
            });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );

  // --- Webhooks -------------------------------------------------------------
  server.registerTool(
    'keel_webhooks',
    {
      description:
        'Read and maintain the workspace webhook subscriptions. Actions: "list", "create", "delete". Each subscription has "id", "targetUrl", "event" and "createdVia"; the signing secret is never returned. There is no "get" and no "update", because the REST API has neither: read one by listing them, and replace a subscription by deleting it and creating another. "create" requires a public HTTPS URL — the API rejects http://, localhost and private network addresses — and event "all" receives every event. DELETING NEEDS THE OWNER OR ADMIN ROLE. That gate is new: this endpoint used to accept any valid key, so an integration running on a key created before keys carried an actor now gets 403 here and the key has to be re-created. Deleting is idempotent, so a success does not prove a subscription existed; list them to confirm.',
      inputSchema: z.strictObject({
        action: z.enum(['list', 'create', 'delete']),
        id: z.string().optional().describe('The subscription id. Required for delete.'),
        targetUrl: z
          .string()
          .url()
          .refine((u) => u.startsWith('https://'), {
            message: 'targetUrl must be an https:// URL. The Keel API rejects plain HTTP.',
          })
          .optional()
          .describe('create only: public HTTPS URL that will receive event POSTs.'),
        event: z
          .string()
          .optional()
          .describe('create only: event name to subscribe to (e.g. control.status_changed) or "all".'),
      }),
    },
    (a) =>
      tool(async () => {
        const T = 'keel_webhooks';
        switch (a.action) {
          case 'list':
            only(T, 'list', a, []);
            return keelFetch('/hooks');
          case 'create':
            only(T, 'create', a, ['targetUrl', 'event']);
            return keelFetch('/hooks', {
              method: 'POST',
              body: compact({
                targetUrl: need(T, 'create', 'targetUrl', a.targetUrl),
                event: a.event,
              }),
            });
          case 'delete':
            only(T, 'delete', a, ['id']);
            return keelFetch(`/hooks/${seg(need(T, 'delete', 'id', a.id))}`, { method: 'DELETE' });
        }
        throw new Error(`${T}: unknown action.`);
      }),
  );
}
