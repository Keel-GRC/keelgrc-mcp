#!/usr/bin/env node
/**
 * `seg()` must never emit a path segment `fetch` would resolve as a dot segment or
 * collapse, because that sends the call to a different `/api/v1` route than the tool
 * meant. Runs against dist/, like the smoke test.
 *
 *   node scripts/seg-test.mjs
 */
import assert from 'node:assert/strict';
import { seg } from '../dist/api.js';

for (const bad of ['', '.', '..']) {
  assert.throws(() => seg(bad), /is not a valid id/, `seg(${JSON.stringify(bad)}) must throw`);
}

// Everything else is percent-encoded and stays inside its own segment.
const base = 'https://keel.invalid/api/v1/controls/';
for (const [id, want] of [
  ['3f0c2b1e-8a4d-4c1f-9b2e-0a1b2c3d4e5f', '3f0c2b1e-8a4d-4c1f-9b2e-0a1b2c3d4e5f'],
  ['iso-9001', 'iso-9001'],
  ['...', '...'],
  ['a/..', 'a%2F..'],
  ['../x', '..%2Fx'],
  ['%2e%2e', '%252e%252e'],
]) {
  assert.equal(seg(id), want);
  const url = new URL(`${base}${seg(id)}/crosswalks`);
  assert.ok(url.pathname.startsWith('/api/v1/controls/'), `${id} escaped to ${url.pathname}`);
  assert.ok(url.pathname.endsWith('/crosswalks'), `${id} resolved to ${url.pathname}`);
}

console.log('seg: ok (3 refused, 6 encoded and kept in their segment)');
