#!/usr/bin/env node
// Exercise every Ring Partner API endpoint DropZone uses and print what came back.
// Usage: RING_ACCESS_TOKEN=... node scripts/ring-probe.js   (writes snapshot to /tmp/dropzone-probe.jpg)
import { writeFile } from 'node:fs/promises';
import { ring, pickDevice, summarizeDevice, callLog } from '../lib/ring.js';

if (!process.env.RING_ACCESS_TOKEN) { console.error('Set RING_ACCESS_TOKEN (Ring Developer Playground token).'); process.exit(1); }
const step = async (name, fn) => { try { const r = await fn(); console.log(`✓ ${name}`); return r; } catch (e) { console.log(`✗ ${name}: ${e.message}`); return null; } };

const me = await step('GET /v1/users/me', () => ring.me());
if (me) console.log('  account:', me?.data?.id);
const devs = await step('GET /v1/devices', () => ring.devices());
const dev = pickDevice(devs);
console.log('  device:', JSON.stringify(summarizeDevice(dev, devs?.included))?.slice(0, 300));
if (dev) {
  const st = await step('GET status', () => ring.status(dev.id));
  console.log('  status:', JSON.stringify(st?.data?.attributes ?? st)?.slice(0, 300));
  const cap = await step('GET capabilities', () => ring.capabilities(dev.id));
  console.log('  capabilities:', JSON.stringify(cap?.data?.attributes ?? cap)?.slice(0, 400));
  const h = await step('GET history', () => ring.history(dev.id, { eventTypes: 'motion,ding,on_demand' }));
  console.log('  history events:', Array.isArray(h?.data) ? h.data.length : h, JSON.stringify(h?.data?.[0] ?? null)?.slice(0, 300));
  const snap = await step('POST image/download (snapshot)', () => ring.snapshot(dev.id));
  if (snap?.ok) { await writeFile('/tmp/dropzone-probe.jpg', snap.bytes); console.log(`  snapshot ${snap.bytes.length} bytes, ts=${snap.mediaTimestamp}, origin=${snap.origin} -> /tmp/dropzone-probe.jpg`); }
  else console.log('  snapshot not readable:', snap?.status, snap?.reason);
}
console.log('\nCall log:'); for (const c of callLog) console.log(`  ${c.method} ${c.status} ${c.ms}ms ${c.path}`);
