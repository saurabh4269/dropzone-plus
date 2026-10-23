import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateZone, freshen, auditZone, STATUS } from '../public/core/zone.js';
import { buildAdvisory, ADVICE } from '../public/core/advisory.js';
import { createSession, PHASE } from '../public/core/engine.js';
import { headsUp } from '../public/core/alexa.js';

const zone = [[0.4, 0.6], [0.6, 0.6], [0.6, 0.8], [0.4, 0.8]];
const T = Date.parse('2026-10-23T18:00:00Z');
const dogIn = { label: 'dog', score: 0.9, box: [0.45, 0.6, 0.1, 0.1] }; // footprint (0.5, 0.7)
const chairFar = { label: 'chair', score: 0.9, box: [0.0, 0.1, 0.1, 0.1] };

test('dog inside zone -> NOT_CLEAR with PET_IN_ZONE', () => {
  const v = evaluateZone({ detections: [dogIn], zone, observedAt: T, now: T, source: 'test' });
  assert.equal(v.status, STATUS.NOT_CLEAR);
  assert.equal(v.reasons[0].code, 'PET_IN_ZONE');
});

test('object far away -> CLEAR', () => {
  const v = evaluateZone({ detections: [chairFar], zone, observedAt: T, now: T, source: 'test' });
  assert.equal(v.status, STATUS.CLEAR);
});

test('person just outside the edge counts, chair just outside does not', () => {
  const near = [0.62, 0.6, 0.05, 0.15]; // footprint (0.645, 0.75) ~0.045 from edge
  assert.equal(evaluateZone({ detections: [{ label: 'person', score: 0.9, box: near }], zone, observedAt: T, now: T }).status, STATUS.NOT_CLEAR);
  assert.equal(evaluateZone({ detections: [{ label: 'chair', score: 0.9, box: near }], zone, observedAt: T, now: T }).status, STATUS.CLEAR);
});

test('low-confidence detections are ignored', () => {
  const v = evaluateZone({ detections: [{ ...dogIn, score: 0.2 }], zone, observedAt: T, now: T });
  assert.equal(v.status, STATUS.CLEAR);
});

test('unreadable media / old frame / no zone -> UNKNOWN, never CLEAR', () => {
  assert.equal(evaluateZone({ detections: [], zone, observedAt: T, now: T, media: { readable: false, reason: 'E2EE' } }).status, STATUS.UNKNOWN);
  assert.equal(evaluateZone({ detections: [], zone, observedAt: T, now: T + 10 * 60000 }).status, STATUS.UNKNOWN);
  assert.equal(evaluateZone({ detections: [], zone: [], observedAt: T, now: T }).status, STATUS.UNKNOWN);
});

test('verdicts expire to UNKNOWN', () => {
  const v = evaluateZone({ detections: [], zone, observedAt: T, now: T });
  assert.equal(freshen(v, T + 30000).status, STATUS.CLEAR);
  assert.equal(freshen(v, T + 91000).status, STATUS.UNKNOWN);
});

test('advisory is veto-only: CLEAR and UNKNOWN both give NO_ADVISORY, never authorises', () => {
  const clear = evaluateZone({ detections: [], zone, observedAt: T, now: T });
  const unknown = evaluateZone({ detections: [], zone, observedAt: T, now: T, media: { readable: false } });
  const blocked = evaluateZone({ detections: [dogIn], zone, observedAt: T, now: T });
  for (const v of [clear, unknown]) {
    const a = buildAdvisory({ verdict: v, now: T });
    assert.equal(a.advice, ADVICE.NO_ADVISORY);
    assert.equal(a.authorises_drop, false);
  }
  const h = buildAdvisory({ verdict: blocked, now: T });
  assert.equal(h.advice, ADVICE.HOLD);
  assert.deepEqual(h.reason_codes, ['PET_IN_ZONE']);
  assert.equal(h.authorises_drop, false);
});

test('hold budget is bounded so a homeowner cannot block a delivery forever', () => {
  const blocked = evaluateZone({ detections: [dogIn], zone, observedAt: T, now: T });
  assert.equal(buildAdvisory({ verdict: blocked, now: T, holdsIssued: 3 }).advice, ADVICE.NO_ADVISORY);
});

test('Alexa heads-up only offers the pet door for pets', () => {
  const v = evaluateZone({ detections: [dogIn], zone, observedAt: T, now: T });
  const m = headsUp({ verdict: v, etaMin: 6, household: { hasPetDoor: true }, petDoor: true });
  assert.match(m.speech, /a dog in the drop zone/);
  assert.equal(m.prompt.action, 'petdoor.in_only');
  const p = evaluateZone({ detections: [{ ...dogIn, label: 'person' }], zone, observedAt: T, now: T });
  assert.equal(headsUp({ verdict: p, etaMin: 6, household: { hasPetDoor: true }, petDoor: true }).prompt, undefined);
});

test('full window: pet -> consent -> pet door; person at T-60 -> HOLD; clear -> drop; receipt; door restored', () => {
  let t = T;
  const events = [];
  const s = createSession({ zone, now: () => t, emit: (type, e) => events.push([type, e.kind]) });
  s.startDelivery({ etaAt: T + 8 * 60000 });
  s.observe(evaluateZone({ detections: [dogIn], zone, observedAt: t, now: t }));
  assert.equal(s.state.pendingPrompt.action, 'petdoor.in_only');
  assert.equal(s.answer('petdoor-in-only', true).ok, true);
  assert.equal(s.state.petDoor.mode, 'in_only');

  t = T + 7 * 60000; // T-60s, a person walks into the zone
  s.observe(evaluateZone({ detections: [{ ...dogIn, label: 'person' }], zone, observedAt: t, now: t }));
  s.tick();
  assert.equal(s.state.phase, PHASE.HOLDING);
  assert.equal(s.state.holdsIssued, 1);

  t += 60000; // hold expired, zone now clear
  s.observe(evaluateZone({ detections: [], zone, observedAt: t, now: t }));
  s.tick();
  assert.equal(s.state.phase, PHASE.LANDING);
  t = s.state.delivery.etaAt;
  s.tick();
  assert.equal(s.state.phase, PHASE.DELIVERED);
  const r = s.recordDrop({ packageBox: [0.48, 0.65, 0.04, 0.04], observedAt: t, source: 'test' });
  assert.equal(r.placement, 'in_zone');
  assert.equal(s.state.petDoor.mode, 'normal');
});

test('pet door refuses without explicit owner consent', () => {
  const s = createSession({ zone });
  assert.equal(s.state.petDoor.setInOnly({ ownerConsent: 'yes' }).ok, false);
});

test('zone audit flags a pool near the drop point', () => {
  const pool = { kind: 'pool', polygon: [[0.62, 0.62], [0.75, 0.62], [0.75, 0.75], [0.62, 0.75]] };
  const f = auditZone(zone, [pool]);
  assert.equal(f[0].code, 'HAZARD_NEAR_ZONE');
});

test('an object standing over most of the zone blocks it even if its feet are below', () => {
  const big = { label: 'dog', score: 0.95, box: [0.3, 0.2, 0.4, 0.75] }; // feet at y=0.95, below zone
  const v = evaluateZone({ detections: [big], zone, observedAt: T, now: T });
  assert.equal(v.status, STATUS.NOT_CLEAR);
  assert.equal(v.objects[0].where, 'over');
});
