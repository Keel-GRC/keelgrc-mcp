#!/usr/bin/env node
/**
 * `keel_webhooks` "create" and "rotate" pass the signing secret through to the model
 * (keelgrc-v1 D827a, D829a, D830a).
 *
 * Drives the real handler from dist/ against a stubbed `fetch`, so no network and no
 * real key are involved. Asserts that a 201 carrying `secret` reaches the model with
 * every API field intact plus `secretNote`, that "rotate" POSTs to
 * `/hooks/{id}/rotate` with no body and passes the new secret and its expiry through
 * with the rotate note, that "list" output is not rewritten, that a body with no
 * `secret` (a Keel deployment that predates signing) is passed through byte for byte,
 * and that the notes and the description describe the `v1=` signature and the event and
 * subscription id headers.
 *
 *   node scripts/webhook-secret-test.mjs
 */
import assert from 'node:assert/strict';

process.env.KEEL_API_KEY = 'webhook-secret-test-not-a-real-key';
const { registerTools, WEBHOOK_SECRET_NOTE, WEBHOOK_ROTATE_NOTE } = await import('../dist/tools.js');

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
for (const text of [descriptions.keel_webhooks, WEBHOOK_SECRET_NOTE, WEBHOOK_ROTATE_NOTE]) {
  assert.match(text, /"v1="/, 'must describe the v1= signature format');
  assert.match(text, /x-keel-event-id/, 'must name the event id header');
  assert.match(text, /x-keel-subscription-id/, 'must name the subscription id header');
  assert.match(text, /any "v1=" value/, 'must say a receiver accepts any v1= value');
  assert.doesNotMatch(text, /\u2014/, 'no em dashes in tool text');
}
assert.match(descriptions.keel_webhooks, /"rotate"/, 'the description must name the rotate action');
assert.match(descriptions.keel_webhooks, /origin \(https:\/\/host\)/, 'the description must say non-managers see the origin only');
assert.match(WEBHOOK_ROTATE_NOTE, /previousSecretExpiresAt/, 'the rotate note must name the expiry');
assert.match(WEBHOOK_ROTATE_NOTE, /shown once/, 'the rotate note must say the secret is shown once');

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

// 3. rotate: POST /hooks/{id}/rotate with no body, secret and expiry kept, rotate note added.
{
  const rotated = { id: created.id, secret: 'whsec_' + 'cd'.repeat(32), previousSecretExpiresAt: '2026-10-01T12:00:00.000Z' };
  const calls = stub(200, JSON.stringify(rotated));
  const result = await handlers.keel_webhooks({ action: 'rotate', id: created.id });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].url.endsWith(`/api/v1/hooks/${created.id}/rotate`), `rotate went to ${calls[0].url}`);
  assert.equal(calls[0].body, undefined, 'rotate must send no body');
  const out = JSON.parse(result.content[0].text);
  for (const [k, v] of Object.entries(rotated)) assert.equal(out[k], v, `field ${k} changed`);
  assert.equal(out.secretNote, WEBHOOK_ROTATE_NOTE);
}

// 4. rotate needs an id and takes nothing else.
{
  const calls = stub(200, '{}');
  const noId = await handlers.keel_webhooks({ action: 'rotate' });
  assert.equal(noId.isError, true);
  assert.match(noId.content[0].text, /requires "id"/);
  const stray = await handlers.keel_webhooks({ action: 'rotate', id: created.id, targetUrl: created.targetUrl });
  assert.equal(stray.isError, true);
  assert.match(stray.content[0].text, /does not take "targetUrl"/);
  assert.equal(calls.length, 0, 'a refused rotate must not reach the API');
}

// 5. list is not rewritten.
{
  const listed = JSON.stringify({ hooks: [{ id: created.id, targetUrl: created.targetUrl, event: 'all', createdVia: 'zapier' }] });
  stub(200, listed);
  const result = await handlers.keel_webhooks({ action: 'list' });
  assert.equal(result.content[0].text, listed);
}

console.log('webhook-secret: ok (create and rotate surface the secret with their notes; list and legacy create untouched)');
