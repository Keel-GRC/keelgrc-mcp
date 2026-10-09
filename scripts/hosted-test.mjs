#!/usr/bin/env node
/**
 * The library entry (`keelgrc-mcp/server`) that the hosted endpoint at
 * app.keelgrc.com/mcp is built on. Runs against dist/, like the smoke test.
 *
 * What it pins:
 *  - the hosted server registers the same tools as the stdio one (same `registerTools`);
 *  - each server sends ITS OWN key and nobody else's, which is the property the hosted
 *    endpoint rests on: one server per request, keyed by that request's bearer token;
 *  - a server built with no key refuses before any network call.
 */
import { createKeelMcpServer } from '../dist/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let failed = 0;
const must = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed++;
};

async function connect(apiKey, seen) {
  const server = createKeelMcpServer({
    apiKey,
    version: '0.0.0-test',
    baseUrl: 'https://keel.test/',
    fetch: async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.authorization });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'hosted-test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const seenA = [];
const seenB = [];
const a = await connect('key-a', seenA);
const b = await connect('key-b', seenB);

const tools = (await a.listTools()).tools.map((t) => t.name);
must('registers the keel tools', tools.includes('keel_whoami') && tools.includes('keel_controls'));
must('server reports its version', a.getServerVersion()?.version === '0.0.0-test');

await a.callTool({ name: 'keel_whoami', arguments: {} });
await b.callTool({ name: 'keel_whoami', arguments: {} });
must('A calls /api/v1/me on its base URL', seenA[0]?.url === 'https://keel.test/api/v1/me');
must('A sends only key A', seenA.length === 1 && seenA[0].auth === 'Bearer key-a');
must('B sends only key B', seenB.length === 1 && seenB[0].auth === 'Bearer key-b');

const seenNone = [];
const none = await connect('', seenNone);
const res = await none.callTool({ name: 'keel_whoami', arguments: {} });
must('no key -> tool error', res.isError === true);
must('no key -> no network call', seenNone.length === 0);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall hosted checks passed');
