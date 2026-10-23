import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNewObject } from '../public/core/changes.js';
import { createSession } from '../public/core/engine.js';

const W = 160, H = 90;
function frame(fill = [80, 140, 60]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...fill, 255], i * 4);
  return { width: W, height: H, data };
}
function paint(f, [x, y, w, h], rgb) {
  for (let yy = Math.round(y * H); yy < Math.round((y + h) * H); yy++)
    for (let xx = Math.round(x * W); xx < Math.round((x + w) * W); xx++) f.data.set([...rgb, 255], (yy * W + xx) * 4);
  return f;
}
const zone = [[0.4, 0.6], [0.6, 0.6], [0.6, 0.8], [0.4, 0.8]];
const pool = { kind: 'pool', polygon: [[0.7, 0.5], [0.9, 0.5], [0.9, 0.66], [0.7, 0.66]] };

test('finds a new box inside the zone and the engine places it in_zone', () => {
  const after = paint(frame(), [0.48, 0.66, 0.05, 0.08], [200, 150, 90]);
  const r = findNewObject(frame(), after, { zone });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.box[0] - 0.48) < 0.02 && Math.abs(r.box[2] - 0.05) < 0.02);
  const s = createSession({ zone, hazards: [pool] });
  assert.equal(s.recordDrop({ packageBox: r.box, observedAt: Date.now(), source: 'test' }).placement, 'in_zone');
});

test('a box that lands by the pool is placed as hazard', () => {
  const after = paint(frame(), [0.70, 0.52, 0.04, 0.07], [200, 150, 90]);
  const r = findNewObject(frame(), after, { zone, hazards: [pool] });
  assert.equal(r.ok, true);
  const s = createSession({ zone, hazards: [pool] });
  assert.equal(s.recordDrop({ packageBox: r.box, observedAt: Date.now(), source: 'test' }).placement, 'hazard');
});

test('noise specks and far-away changes are ignored', () => {
  const after = paint(frame(), [0.02, 0.02, 0.01, 0.02], [255, 255, 255]); // far corner, tiny
  assert.equal(findNewObject(frame(), after, { zone }).reason, 'NOTHING_NEW_NEAR_ZONE');
});

test('whole-scene change (lighting / camera moved) refuses to guess', () => {
  assert.equal(findNewObject(frame(), frame([10, 10, 10]), { zone }).reason, 'SCENE_CHANGED');
});

test('size mismatch is rejected', () => {
  assert.equal(findNewObject(frame(), { width: 10, height: 10, data: new Uint8ClampedArray(400) }, { zone }).reason, 'FRAME_SIZE_MISMATCH');
});
