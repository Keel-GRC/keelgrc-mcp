#!/usr/bin/env node
/**
 * `keel_webhooks` "create" passes the signing secret through to the model (D827a).
 *
 * Drives the real handler from dist/ against a stubbed `fetch`, so no network and no
 * real key are involved. Asserts that a 201 carrying `secret` reaches the model with
 * every API field intact plus `secretNote`, that "list" output is not rewritten, and
 * that a body with no `secret` (a Keel deployment that predates signing) is passed
 * through byte for byte.
 *
 *   node scripts/webhook-secret-test.mjs
 */
import assert from 'node:assert/strict';

process.env.KEEL_API_KEY = 'webhook-secret-test-not-a-real-key';
const { registerTools, WEBHOOK_SECRET_NOTE } = await import('../dist/tools.js');

const handlers = {};
const descriptions = {};
registerTools({
  registerTool(name, config, handler) {
    handlers[name] = handler;
    descriptions[name] = config.description;
  },
});

assert.doesNotMatch(descriptions.keel_webhooks, /secret is never returned/, 'stale claim left in the description');
assert.match(descriptions.keel_webhooks, /shown ONCE/, 'the description must say the secret is shown once');
assert.match(descriptions.keel_webhooks, /x-keel-signature/, 'the description must name the signature header');

function stub(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

const SECRET = 'whsec_' + 'ab'.repeat(32);
const created = { id: '11111111-1111-4111-8111-111111111111', targetUrl: 'https://hooks.example.com/x', event: 'all', secret: SECRET };

// 1. create with a secret: every field kept, note added.
{
  const calls = stub(201, JSON.stringify(created));
  const result = await handlers.keel_webhooks({ action: 'create', targetUrl: created.targetUrl });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].url.endsWith('/api/v1/hooks'), `create went to ${calls[0].url}`);
  const out = JSON.parse(result.content[0].text);
  for (const [k, v] of Object.entries(created)) assert.equal(out[k], v, `field ${k} changed`);
  assert.equal(out.secretNote, WEBHOOK_SECRET_NOTE);
  assert.match(out.secretNote, /shown once/);
  assert.match(out.secretNote, /x-keel-signature/);
  assert.match(out.secretNote, /HMAC-SHA256/);
}

// 2. create against a Keel deployment with no secret: passed through unchanged.
{
  const legacy = JSON.stringify({ id: created.id, targetUrl: created.targetUrl, event: 'all' });
  stub(201, legacy);
  const result = await handlers.keel_webhooks({ action: 'create', targetUrl: created.targetUrl });
  assert.equal(result.content[0].text, legacy);
}

// 3. list is not rewritten.
{
  const listed = JSON.stringify({ hooks: [{ id: created.id, targetUrl: created.targetUrl, event: 'all', createdVia: 'zapier' }] });
  stub(200, listed);
  const result = await handlers.keel_webhooks({ action: 'list' });
  assert.equal(result.content[0].text, listed);
}

console.log('webhook-secret: ok (create surfaces the secret with its note; list and legacy create untouched)');
