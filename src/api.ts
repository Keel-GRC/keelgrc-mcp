/**
 * Transport for the Keel MCP server: one authenticated call to `/api/v1`, and the
 * small helpers the tool layer builds requests out of.
 *
 * Nothing here knows what a policy or a risk is. Keeping it that way is what makes
 * the tool layer a mapping onto the REST contract rather than a second vocabulary
 * that can drift from it.
 */

/**
 * Drop trailing slashes. A loop rather than `/\/+$/`: that regex backtracks
 * quadratically on a long run of slashes, and `baseUrl` is library input.
 */
function trimSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

const BASE_URL = trimSlashes(process.env.KEEL_BASE_URL || 'https://app.keelgrc.com');
const API_KEY = process.env.KEEL_API_KEY?.trim() ?? '';

/** The origin every request goes to. Exported so the boot banner can print it. */
export const baseUrl = BASE_URL;

/** Drop undefined entries so an optional field is omitted rather than sent as null. */
export function compact(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

/** `?a=b` from the defined entries only, or '' when nothing is set. */
export function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * Assert a field the chosen action needs, and fail with a message the model can act on.
 *
 * A resource tool takes one flat argument set covering every action, so "which
 * fields are required" is a property of the action rather than of the schema. The
 * schema cannot express that, so this does, and the message names the tool, the
 * action and the field. A bare "missing id" leaves the model guessing which of its
 * several calls went wrong.
 */
export function need<T>(tool: string, action: string, field: string, value: T | undefined): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${tool}: the "${action}" action requires "${field}".`);
  }
  return value;
}

/**
 * Refuse arguments the chosen action does not send.
 *
 * The input schema is strict, so a name no action knows is already a validation
 * error. That leaves a name some OTHER action of the same tool takes: `title` on a
 * task update, `controlKey` on an evidence update. Each case below builds its request
 * from a fixed list, so such an argument used to vanish while the call reported
 * success. This makes it an error naming the argument and what the action accepts.
 */
export function only(
  tool: string,
  action: string,
  args: Record<string, unknown>,
  accepted: readonly string[],
): void {
  const stray = Object.keys(args).filter(
    (k) => k !== 'action' && args[k] !== undefined && !accepted.includes(k),
  );
  if (stray.length > 0) {
    throw new Error(
      `${tool}: the "${action}" action does not take ${stray.map((k) => `"${k}"`).join(', ')}. ` +
        (accepted.length ? `It accepts: ${accepted.join(', ')}.` : 'It takes no other arguments.'),
    );
  }
}

/**
 * Path-safe id segment. Ids are uuids, but a model will send whatever it has.
 *
 * `encodeURIComponent` leaves "." and ".." as they are, and `fetch` resolves them as
 * dot segments: `/controls/../crosswalks` goes to `/api/v1/crosswalks`, a different
 * route from the one the tool meant. An empty segment collapses the path the same way.
 * No Keel id or framework key is any of the three, so they are refused here rather than
 * sent somewhere else.
 */
export function seg(id: string): string {
  if (id === '' || id === '.' || id === '..') {
    throw new Error(
      `${JSON.stringify(id)} is not a valid id. Keel ids and framework keys are never empty, "." or "..".`,
    );
  }
  return encodeURIComponent(id);
}

/** One authenticated call to `/api/v1`: the raw response body, or a throw on non-2xx. */
export type KeelFetch = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<string>;

export interface KeelClientOptions {
  /** A workspace API key. Empty means every call throws with a message saying so. */
  apiKey: string;
  /** Workspace origin, e.g. https://app.keelgrc.com. Trailing slashes are dropped. */
  baseUrl?: string;
  /** The fetch to use. The hosted server passes one that stays inside its own Worker. */
  fetch?: typeof fetch;
}

/**
 * Build a `KeelFetch` bound to one API key.
 *
 * The stdio server builds one from the environment at boot. The hosted server at
 * app.keelgrc.com/mcp builds one per request from the caller's own bearer token, so a
 * key never outlives the request that carried it and two callers never share one.
 */
export function createKeelFetch(opts: KeelClientOptions): KeelFetch {
  const key = opts.apiKey.trim();
  const origin = trimSlashes(opts.baseUrl || 'https://app.keelgrc.com');
  return async (path, init) => {
    if (!key) {
      throw new Error(
        'No Keel API key. Create an API key under Integrations in your Keel workspace and set KEEL_API_KEY (stdio) or send it as a bearer token (hosted).',
      );
    }
    // The global is read at call time, not captured here, so a test or polyfill that
    // replaces `fetch` after this module loads is still the one used.
    const res = await (opts.fetch ?? fetch)(`${origin}/api/v1${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${key}`,
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
  };
}

/** The stdio server's client: key and origin from the environment. */
export const keelFetch: KeelFetch = createKeelFetch({ apiKey: API_KEY, baseUrl: BASE_URL });

/** Wrap a tool body so any error surfaces to the client as an isError text result. */
export async function tool(run: () => Promise<string>) {
  try {
    return { content: [{ type: 'text' as const, text: await run() }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: (e as Error).message }],
    };
  }
}
