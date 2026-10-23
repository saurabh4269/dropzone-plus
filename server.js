#!/usr/bin/env node
// DropZone+ server. Zero runtime dependencies (Node >= 20).
//  - serves the web app (public/)
//  - LIVE mode (RING_ACCESS_TOKEN set): proxies Ring Partner API calls so the token never reaches the browser
//  - receives HMAC-signed Ring webhooks and fans them out over SSE
//  - exposes the carrier-facing, veto-only advisory at GET /api/v1/advisory

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ring, ringConfigured, pickDevice, summarizeDevice, callLog, RingError } from './lib/ring.js';
import { verify, firstDelivery } from './lib/webhook.js';
import { buildAdvisory } from './public/core/advisory.js';
import { bedrockAvailable, describeWithBedrock } from './lib/bedrock.js';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const WEBHOOK_SECRET = process.env.RING_WEBHOOK_SECRET || 'dev-secret';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// Latest state pushed by the browser-side engine (single-household demo server).
let latest = { verdict: null, delivery: null, holdsIssued: 0 };
let cachedDeviceId = process.env.RING_DEVICE_ID || null;
const sseClients = new Set();

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(isBuf || typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('body too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

function broadcast(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) c.write(line);
}

async function deviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  const doc = await ring.devices();
  const d = pickDevice(doc);
  if (!d) throw new RingError(404, 'no devices on this account', '/v1/devices');
  cachedDeviceId = d.id;
  return d.id;
}

async function attempt(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, status: e.status || 500, error: e.message }; }
}

const routes = {
  'GET /api/config': async () => ({
    mode: ringConfigured() ? 'live' : 'replay',
    ring: { configured: ringConfigured(), api: 'https://api.amazonvision.com' },
    webhook: { endpoint: '/webhooks/ring', secretIsDefault: !process.env.RING_WEBHOOK_SECRET },
    vision: { browser: 'coco-ssd (TensorFlow.js)', bedrock: await bedrockAvailable() },
  }),

  // Discovery: every call is attempted and reported separately, because Playground endpoints fail independently.
  'GET /api/ring/discover': async () => {
    if (!ringConfigured()) return { mode: 'replay' };
    const me = await attempt(() => ring.me());
    const devices = await attempt(() => ring.devices());
    const dev = devices.ok ? pickDevice(devices.data) : null;
    if (dev) cachedDeviceId = dev.id;
    const id = dev?.id;
    const [status, capabilities, history] = id
      ? await Promise.all([attempt(() => ring.status(id)), attempt(() => ring.capabilities(id)), attempt(() => ring.history(id, { eventTypes: 'motion,ding,on_demand' }))])
      : [null, null, null];
    return { mode: 'live', me, devices, device: summarizeDevice(dev, devices.data?.included), status, capabilities, history };
  },

  'GET /api/ring/snapshot': async (req, res) => {
    if (!ringConfigured()) return send(res, 409, { readable: false, reason: 'replay mode: no Ring token' });
    let snap;
    try { snap = await ring.snapshot(await deviceId()); }
    catch (e) { return send(res, 502, { readable: false, reason: e.message }); }
    if (!snap.ok) return send(res, 502, { readable: false, status: snap.status, reason: snap.reason });
    send(res, 200, snap.bytes, {
      'Content-Type': snap.contentType,
      'X-Observed-At': new Date(snap.mediaTimestamp || Date.now()).toISOString(),
      'X-Observed-At-Source': snap.mediaTimestamp ? 'ring:x-media-timestamp' : 'server-receipt-time',
      'X-Media-Origin': snap.origin || '',
    });
  },

  'POST /api/ring/whep': async (req, res) => {
    const sdp = (await readBody(req)).toString('utf8');
    return ring.whepStart(await deviceId(), sdp);
  },
  'DELETE /api/ring/whep': async (req) => {
    const { sessionUrl } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    return ring.whepStop(sessionUrl);
  },
  'GET /api/ring/calls': async () => callLog,

  // Browser engine reports its current verdict; the carrier reads the derived advisory.
  'POST /api/state': async (req) => {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    latest = { verdict: body.verdict ?? latest.verdict, delivery: body.delivery ?? latest.delivery, holdsIssued: body.holdsIssued ?? latest.holdsIssued };
    return { ok: true };
  },
  'GET /api/state': async () => latest,
  'GET /api/v1/advisory': async (req, res) => {
    const adv = buildAdvisory({ verdict: latest.verdict, delivery: latest.delivery, holdsIssued: latest.holdsIssued });
    send(res, 200, adv, { 'Access-Control-Allow-Origin': '*' });
  },

  // Optional AWS path: Amazon Bedrock (Nova) describes a frame. Off unless AWS credentials + DZ_BEDROCK=1.
  'POST /api/vision/bedrock': async (req) => {
    const body = await readBody(req, 8_000_000);
    return describeWithBedrock(body, req.headers['content-type'] || 'image/jpeg');
  },

  'POST /webhooks/ring': async (req, res) => {
    const raw = await readBody(req);
    if (!verify(WEBHOOK_SECRET, raw, req.headers['x-signature'])) return send(res, 401, { error: 'bad signature' });
    const evt = JSON.parse(raw.toString('utf8'));
    if (!firstDelivery(evt?.meta?.request_id)) return send(res, 200, { status: 'duplicate' });
    broadcast('ring', { type: evt.data?.type, sub_type: evt.data?.attributes?.sub_type, at: evt.data?.attributes?.timestamp, simulated: Boolean(evt.meta?.simulated) });
    send(res, 202, { status: 'accepted' }); // ack well inside Ring's 5 s budget
  },

  'GET /api/events': async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hello\n\n');
    sseClients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 20000);
    req.on('close', () => { clearInterval(ka); sseClients.delete(res); });
  },
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'forbidden' });
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return serveStatic(req, res);
  try {
    const out = await handler(req, res);
    if (!res.headersSent && out !== undefined) send(res, 200, out);
  } catch (e) {
    const status = e instanceof RingError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 500;
    if (!res.headersSent) send(res, status, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`DropZone+ on http://localhost:${PORT}  mode=${ringConfigured() ? 'LIVE (Ring Playground token present)' : 'REPLAY (no RING_ACCESS_TOKEN)'}`);
});
