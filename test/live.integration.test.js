// LIVE-mode integration: real server.js -> mock Ring Partner API (ring-partner-sandbox).
// Finds the sandbox via RING_SANDBOX_BIN, node_modules (devDependency) or a sibling checkout; skips if absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sign, ringEvent } from '../lib/webhook.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = [process.env.RING_SANDBOX_BIN, `${root}node_modules/ring-partner-sandbox/bin/ring-sandbox.js`, `${root}../ring-partner-sandbox/bin/ring-sandbox.js`].filter(Boolean);
const sandboxBin = candidates.find((p) => existsSync(p));
const skip = sandboxBin ? false : 'ring-partner-sandbox not found (npm i, or clone next to this repo)';

const port = () => 20000 + Math.floor(Math.random() * 20000);
const SBX = port(), APP = port();
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, headers) {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url, { headers }); if (r.status < 500) return; } catch {} await sleep(100); }
  throw new Error('timeout waiting for ' + url);
}

before(async () => {
  if (skip) return;
  procs.push(spawn(process.execPath, [sandboxBin, 'serve', '--port', String(SBX)], { stdio: 'ignore' }));
  await waitFor(`http://127.0.0.1:${SBX}/v1/users/me`);
  procs.push(spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(APP), RING_API_BASE: `http://127.0.0.1:${SBX}`, RING_ACCESS_TOKEN: 'sandbox-token', RING_WEBHOOK_SECRET: 'it-secret' } }));
  await waitFor(`http://127.0.0.1:${APP}/api/config`);
});
after(() => procs.forEach((p) => p.kill()));

const app = (p, o) => fetch(`http://127.0.0.1:${APP}${p}`, o);

test('config reports LIVE against a non-official (mock) API', { skip }, async () => {
  const c = await (await app('/api/config')).json();
  assert.equal(c.mode, 'live');
  assert.equal(c.ring.official, false);
});

test('discovery walks users/me, devices, status, capabilities, history', { skip }, async () => {
  const d = await (await app('/api/ring/discover')).json();
  for (const k of ['me', 'devices', 'status', 'capabilities', 'history']) assert.equal(d[k].ok, true, k);
  assert.equal(d.device.online, true);
  const calls = await (await app('/api/ring/calls')).json();
  assert.ok(calls.every((c) => c.status < 400));
});

test('snapshot follows the 303 and returns an image with X-Observed-At', { skip }, async () => {
  const r = await app('/api/ring/snapshot');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^image\//);
  assert.ok(Date.parse(r.headers.get('x-observed-at')));
  assert.ok((await r.arrayBuffer()).byteLength > 100);
  const calls = await (await app('/api/ring/calls')).json();
  assert.ok(calls.some((c) => c.status === 303 && /image\/download/.test(c.path)));
});

test('signed webhook is accepted, tampered one rejected, and it reaches SSE clients', { skip }, async () => {
  const ac = new AbortController();
  const sse = await app('/api/events', { signal: ac.signal });
  const reader = sse.body.getReader();
  const raw = JSON.stringify(ringEvent({ deviceId: 'dev', subType: 'human' }));
  assert.equal((await app('/webhooks/ring', { method: 'POST', body: raw, headers: { 'X-Signature': sign('wrong', raw) } })).status, 401);
  assert.equal((await app('/webhooks/ring', { method: 'POST', body: raw, headers: { 'X-Signature': sign('it-secret', raw) } })).status, 202);
  assert.equal((await (await app('/webhooks/ring', { method: 'POST', body: raw, headers: { 'X-Signature': sign('it-secret', raw) } })).json()).status, 'duplicate');
  let buf = '';
  while (!buf.includes('event: ring')) buf += new TextDecoder().decode((await reader.read()).value);
  assert.match(buf, /"sub_type":"human"/);
  ac.abort();
});

test('carrier advisory reflects the state the browser engine pushed', { skip }, async () => {
  const now = Date.now();
  const verdict = { status: 'NOT_CLEAR', reasons: [{ code: 'PET_IN_ZONE' }], objects: [], observed_at: new Date(now).toISOString(), stale_after: new Date(now + 90000).toISOString() };
  await app('/api/state', { method: 'POST', body: JSON.stringify({ verdict, delivery: { ref: 'IT-1' }, holdsIssued: 0 }) });
  const a = await (await app('/api/v1/advisory')).json();
  assert.equal(a.advice, 'HOLD');
  assert.equal(a.authorises_drop, false);
  assert.equal(a.delivery_ref, 'IT-1');
});
