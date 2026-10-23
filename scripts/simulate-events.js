#!/usr/bin/env node
// SIMULATED Ring webhook feeder. The Ring Playground cannot emit webhooks, so this posts
// Ring v1.1-shaped, HMAC-signed events to DropZone's /webhooks/ring endpoint.
// Usage: RING_WEBHOOK_SECRET=dev-secret node scripts/simulate-events.js [motion|human|other_motion|ding] [url]

import { sign, ringEvent } from '../lib/webhook.js';

const kind = process.argv[2] || 'motion';
const url = process.argv[3] || `http://localhost:${process.env.PORT || 8787}/webhooks/ring`;
const secret = process.env.RING_WEBHOOK_SECRET || 'dev-secret';
const deviceId = process.env.RING_DEVICE_ID || 'ava1.ring.device.SIMULATED';

const evt = kind === 'ding'
  ? ringEvent({ deviceId, type: 'button_press' })
  : ringEvent({ deviceId, type: 'motion_detected', subType: kind === 'motion' ? 'motion' : kind });
const raw = JSON.stringify(evt);
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sign(secret, raw) }, body: raw });
console.log(res.status, await res.text());
