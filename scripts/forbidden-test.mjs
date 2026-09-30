#!/usr/bin/env node
/**
 * A 403 from Keel reaches the client as an error carrying the API's own message.
 *
 * Drives the real `keel_people` "create" handler from dist/ against a stubbed
 * `fetch`, so no network and no real key are involved. The refusals checked are the
 * ones `/api/v1` sends from `_guards.ts`: a key whose member lacks the role, and a key
 * created before keys carried an actor.
 *
 *   node scripts/forbidden-test.mjs
 */
import assert from 'node:assert/strict';

process.env.KEEL_API_KEY = 'forbidden-test-not-a-real-key';
const { registerTools } = await import('../dist/tools.js');

const handlers = {};
const descriptions = {};
registerTools({
  registerTool(name, config, handler) {
    handlers[name] = handler;
    descriptions[name] = config.description;
  },
});

assert.match(
  descriptions.keel_people,
  /"create" included, needs an API key created by an owner or admin/,
  'keel_people must tell the model that create needs an owner or admin key',
);

const refusals = [
  'This action requires the owner or admin role.',
  'This API key was created before keys carried an actor, so it has no role and cannot perform role-gated actions. Create a replacement key in Integrations.',
];

for (const message of refusals) {
  let called = null;
  globalThis.fetch = async (url, init) => {
    called = { url: String(url), method: init?.method };
    return new Response(JSON.stringify({ error: 'forbidden', message }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await handlers.keel_people({ action: 'create', email: 'new.hire@example.com' });
  assert.equal(called?.method, 'POST');
  assert.ok(called.url.endsWith('/api/v1/people'), `create went to ${called.url}`);
  assert.equal(result.isError, true, 'a 403 must be an error result, not a success');
  const text = result.content[0].text;
  assert.ok(text.includes('403'), `the status is missing from: ${text}`);
  assert.ok(text.includes(message), `the API message is missing from: ${text}`);
}

console.log(`forbidden: ok (${refusals.length} refusals surfaced verbatim as errors)`);
