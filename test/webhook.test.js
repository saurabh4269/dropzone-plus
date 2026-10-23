import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify, ringEvent, firstDelivery } from '../lib/webhook.js';

test('HMAC: verifies the exact raw bytes and rejects tampering or a wrong key', () => {
  const raw = JSON.stringify(ringEvent({ deviceId: 'dev1', subType: 'human' }));
  const sig = sign('k', raw);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verify('k', Buffer.from(raw), sig), true);
  assert.equal(verify('k', Buffer.from(raw.replace('human', 'other')), sig), false);
  assert.equal(verify('other-key', Buffer.from(raw), sig), false);
  assert.equal(verify('k', Buffer.from(raw), undefined), false);
  // re-serialised JSON with different whitespace must fail: verify first, parse second
  assert.equal(verify('k', Buffer.from(JSON.stringify(JSON.parse(raw), null, 1)), sig), false);
});

test('simulated events are Ring v1.1-shaped and marked simulated', () => {
  const e = ringEvent({ deviceId: 'dev1', subType: 'human', at: 1 });
  assert.equal(e.meta.version, '1.1');
  assert.equal(e.meta.simulated, true);
  assert.equal(e.data.type, 'motion_detected');
  assert.equal(e.data.attributes.sub_type, 'human');
  assert.equal(e.data.id, 'dev1_motion_detected_1');
});

test('duplicate request_id is processed once', () => {
  assert.equal(firstDelivery('abc'), true);
  assert.equal(firstDelivery('abc'), false);
});
