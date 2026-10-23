// MCP server: Streamable HTTP (POST /mcp, spec 2025-11-25) and stdio, against a real DropZone server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let srv;

before(async () => {
  srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), RING_ACCESS_TOKEN: '', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { srv.stdout.on('data', (d) => String(d).includes('DropZone on') && res()); srv.on('exit', rej); });
});
after(() => srv.kill());

async function post(body, headers = {}) {
  const r = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  return { r, j: r.status === 202 || r.status === 204 ? null : await r.json() };
}

test('Streamable HTTP: initialize -> initialized -> tools/list -> tools/call', async () => {
  const { r, j } = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(r.status, 200);
  assert.equal(j.result.protocolVersion, '2025-11-25');
  assert.ok(j.result.capabilities.tools);
  const sid = r.headers.get('mcp-session-id');
  assert.ok(sid);
  const h = { 'Mcp-Session-Id': sid, 'MCP-Protocol-Version': '2025-11-25' };
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, h)).r.status, 202);
  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h);
  assert.deepEqual(list.j.result.tools.map((t) => t.name), ['get_dropzone_status', 'get_carrier_advisory']);
  const call = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_dropzone_status', arguments: {} } }, h);
  assert.match(call.j.result.content[0].text, /^UNKNOWN/); // nothing observed yet: never CLEAR by default
  const adv = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_carrier_advisory', arguments: {} } }, h);
  assert.equal(adv.j.result.structuredContent.authorises_drop, false);
  const bad = await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }, h);
  assert.equal(bad.j.error.code, -32602);
  const del = await fetch(BASE + '/mcp', { method: 'DELETE', headers: h });
  assert.equal(del.status, 204);
  assert.equal((await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, h)).r.status, 404);
});

test('Streamable HTTP: rejects foreign Origin, bad protocol header, GET, batches', async () => {
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' })).r.status, 403);
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' })).r.status, 400);
  assert.equal((await fetch(BASE + '/mcp')).status, 405);
  assert.equal((await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).r.status, 400);
});

test('Streamable HTTP: status reflects a pushed verdict', async () => {
  const now = Date.now();
  const verdict = { status: 'NOT_CLEAR', reasons: [{ code: 'PET_IN_ZONE', label: 'pet', where: 'in the zone' }], observed_at: new Date(now).toISOString(), stale_after: new Date(now + 90000).toISOString(), source: 'test (simulated)' };
  await fetch(BASE + '/api/state', { method: 'POST', body: JSON.stringify({ verdict }) });
  const { j } = await post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_carrier_advisory', arguments: {} } });
  assert.equal(j.result.structuredContent.advice, 'HOLD');
  assert.deepEqual(j.result.structuredContent.reason_codes, ['PET_IN_ZONE']);
});

test('stdio server answers initialize and tools/list', async () => {
  const p = spawn(process.execPath, ['mcp/dropzone-mcp.js'], { env: { ...process.env, DROPZONE_URL: BASE } });
  const lines = [];
  p.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  for (let i = 0; i < 50 && lines.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  p.kill(); await once(p, 'exit');
  const [a, b] = lines.map((l) => JSON.parse(l));
  assert.equal(a.result.protocolVersion, '2025-11-25');
  assert.equal(b.result.tools.length, 2);
});
