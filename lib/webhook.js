// Ring webhook v1.1: HMAC-SHA256 over the raw body bytes, hex, header `X-Signature: sha256=<hex>`.
// The Playground cannot send webhooks, so scripts/simulate-events.js produces Ring-shaped,
// correctly signed payloads (labelled simulated) that go through this exact verifier.

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export function sign(secret, rawBody) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verify(secret, rawBody, header) {
  if (!secret || !header) return false;
  const got = Buffer.from(String(header).replace(/^sha256=/, ''), 'hex');
  const want = createHmac('sha256', secret).update(rawBody).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

const seen = new Set();
/** Idempotency on meta.request_id (Ring may redeliver). */
export function firstDelivery(requestId) {
  if (!requestId) return true;
  if (seen.has(requestId)) return false;
  seen.add(requestId);
  if (seen.size > 2000) seen.delete(seen.values().next().value);
  return true;
}

export function ringEvent({ deviceId, type = 'motion_detected', subType, accountId = 'ava1.ring.account.SIMULATED', at = Date.now() }) {
  return {
    meta: { version: '1.1', time: new Date().toISOString(), request_id: randomUUID(), account_id: accountId, simulated: true },
    data: {
      id: `${deviceId}_${type}_${at}`,
      type,
      attributes: { source: deviceId, source_type: 'devices', timestamp: at, ...(subType ? { sub_type: subType } : {}) },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
}
