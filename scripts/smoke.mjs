#!/usr/bin/env node
/**
 * Smoke test: boot the BUILT server over stdio and assert it speaks MCP.
 *
 * This is deliberately not a unit test. The failure it exists to catch is the one a
 * typecheck cannot see and a user hits immediately: the published package starts,
 * writes something to stdout that is not a protocol frame, throws on boot, or
 * advertises a malformed tool list. Any of those makes the server unusable in every
 * client at once, and the publish workflow is the last place to notice.
 *
 * It runs against dist/, never src/, because dist/ is what npm ships. It needs no
 * network and no real API key: `initialize` and `tools/list` are answered locally,
 * and no tool is invoked.
 *
 *   node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version: EXPECTED_VERSION } = createRequire(import.meta.url)('../package.json');

const TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(`smoke: FAIL — ${message}`);
  process.exit(1);
}

const child = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
  // A dummy key: the server must boot without contacting anything. If it ever
  // starts making a network call at startup, this test is where that shows up.
  env: { ...process.env, KEEL_API_KEY: 'smoke-test-not-a-real-key' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));
child.on('error', (e) => fail(`could not spawn the server: ${e.message}`));

const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'keelgrc-mcp-smoke', version: '1.0.0' },
  },
});

setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}, 500);

setTimeout(() => {
  child.kill();

  const lines = stdout.split('\n').filter((l) => l.trim());
  // Every stdout line must be a JSON-RPC frame. A stray console.log here is not a
  // cosmetic problem: it corrupts the protocol stream and breaks the client.
  const frames = [];
  for (const line of lines) {
    try {
      frames.push(JSON.parse(line));
    } catch {
      fail(`non-protocol output on stdout: ${JSON.stringify(line.slice(0, 200))}`);
    }
  }

  const init = frames.find((f) => f.id === 1);
  if (!init) fail(`no initialize response.\nstdout: ${stdout}\nstderr: ${stderr}`);
  if (init.error) fail(`initialize returned an error: ${JSON.stringify(init.error)}`);

  const reported = init.result?.serverInfo?.version;
  if (reported !== EXPECTED_VERSION) {
    fail(
      `serverInfo.version is "${reported}" but package.json says "${EXPECTED_VERSION}". ` +
        'The handshake version must match the published version.',
    );
  }

  const list = frames.find((f) => f.id === 2);
  if (!list) fail(`no tools/list response.\nstdout: ${stdout}\nstderr: ${stderr}`);
  if (list.error) fail(`tools/list returned an error: ${JSON.stringify(list.error)}`);

  const tools = list.result?.tools ?? [];
  if (tools.length === 0) fail('the server advertised no tools');

  for (const t of tools) {
    if (typeof t.name !== 'string' || !t.name.startsWith('keel_')) {
      fail(`tool has an unexpected name: ${JSON.stringify(t.name)}`);
    }
    if (!t.description || t.description.length < 20) {
      fail(`tool "${t.name}" has no usable description — the model sees only this`);
    }
    if (!t.inputSchema || t.inputSchema.type !== 'object') {
      fail(`tool "${t.name}" has no object input schema`);
    }
  }

  console.log(
    `smoke: ok — keelgrc-mcp ${reported} initialised over stdio and advertised ${tools.length} tools`,
  );
  process.exit(0);
}, TIMEOUT_MS / 5);

setTimeout(() => fail('timed out waiting for the server'), TIMEOUT_MS).unref();
