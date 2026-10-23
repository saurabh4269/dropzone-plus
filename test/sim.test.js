import test from 'node:test';
import assert from 'node:assert/strict';
import {
  project, projectBox, vfovDeg, RING_CAM, RING_ZONE, RING_POOL, droneFootprint, POOL, P,
  simulate, classifyDrop, boxAt, actorsAt,
} from '../public/sim/model.js';
import { pointInPolygon } from '../public/core/zone.js';

test('vfovDeg matches the three.js convention', () => {
  assert.ok(Math.abs(vfovDeg(60, 1) - 60) < 1e-9);
  assert.ok(Math.abs(vfovDeg(110, 16 / 9) - 77.55) < 0.05);
});

test('project: camera target lands at image centre, points behind are null', () => {
  const c = project(RING_CAM, RING_CAM.target).uv;
  assert.ok(Math.abs(c[0] - 0.5) < 1e-9 && Math.abs(c[1] - 0.5) < 1e-9);
  assert.equal(project(RING_CAM, [0, 1, -5]), null);
});

test('projectBox returns a normalised box and footprint inside the projected zone for an object in the zone', () => {
  const b = projectBox(RING_CAM, { x: 1, z: 6.5, hx: 0.3, hz: 0.3, h: 0.6 });
  assert.equal(b.length, 4);
  b.forEach((v) => assert.ok(v >= 0 && v <= 1));
  assert.ok(pointInPolygon([b[0] + b[2] / 2, b[1] + b[3]], RING_ZONE));
});

test('pool is outside the drone camera footprint at 13 ft', () => {
  const [, , x1] = droneFootprint(P.AT_4M + 1);
  assert.ok(x1 < POOL.x0, `footprint edge ${x1} vs pool ${POOL.x0}`);
});

test('dog-kid: real advisory holds the drone three times, then it drops in the zone', () => {
  const run = simulate('dog-kid');
  assert.equal(run.steps.at(-1).holdsIssued, 3);
  assert.ok(run.tRelease > 112, 'holds delayed the drop past the nominal ETA');
  assert.ok(run.steps.some((s) => s.advisory?.reason_codes.includes('PET_IN_ZONE')));
  const b = boxAt('dog-kid', run.tRelease + 10, run.tRelease);
  assert.equal(classifyDrop(projectBox(RING_CAM, b)).placement, 'in_zone');
});

test('pool-gust: box blown next to the pool is classified as hazard', () => {
  const run = simulate('pool-gust');
  const b = boxAt('pool-gust', run.tRelease + 10, run.tRelease);
  assert.deepEqual(classifyDrop(projectBox(RING_CAM, b), { hazards: [{ kind: 'pool', polygon: RING_POOL }] }), { placement: 'hazard', hazard: 'pool' });
});

test('umbrella: hold budget exhausted, then the drone-side check aborts', () => {
  const run = simulate('umbrella');
  assert.equal(run.tRelease, null);
  assert.ok(run.tAbort > 0);
  assert.ok(run.steps.some((s) => s.advisory?.reason_codes.includes('HOLD_BUDGET_EXHAUSTED')));
});

test('simulation is deterministic', () => {
  assert.deepEqual(JSON.stringify(simulate('dog-kid').events), JSON.stringify(simulate('dog-kid').events));
  assert.deepEqual(actorsAt('dog-kid', 90.5), actorsAt('dog-kid', 90.5));
});
