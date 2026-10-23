// Every replay scenario, run headless through the real engine at 1 simulated second per step.
// Guards the demo storyline: if a rule change alters what judges see, these fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, DEFAULT_ZONE, scriptedDetections } from '../public/scenarios.js';
import { evaluateZone, auditZone, STATUS } from '../public/core/zone.js';
import { createSession, PHASE } from '../public/core/engine.js';

function run(scn, { answer = true } = {}) {
  const base = Date.parse('2026-10-24T10:00:00Z');
  let t = 0;
  const now = () => base + t * 1000;
  const zone = scn.zone || DEFAULT_ZONE;
  const log = [];
  const s = createSession({ zone, hazards: scn.hazards, now, emit: (type, e) => log.push({ t, type, ...e }) });
  const look = () => s.observe(evaluateZone({ detections: scriptedDetections(scn, t), zone, observedAt: now(), now: now(), media: scn.media, source: 'replay' }));
  look();
  s.startDelivery({ etaAt: now() + scn.etaSec * 1000 });
  const done = new Set();
  let droppedAt = null;
  for (t = 1; t <= scn.durationSec; t++) {
    if (t % 10 === 0) look();
    for (const ev of scn.events) if (t >= ev.t && !done.has(ev)) { done.add(ev); if (ev.type === 'answer' && s.state.pendingPrompt?.id === ev.prompt) s.answer(ev.prompt, answer && ev.yes); }
    s.tick();
    if (s.state.phase === PHASE.DELIVERED && droppedAt === null) droppedAt = t;
    if (droppedAt !== null && t === droppedAt + 5 && !s.state.receipt) {
      const d = scn.drop;
      s.recordDrop({ packageBox: d.unseen ? null : [d.at[0] - 0.02, d.at[1] - 0.045, 0.04, 0.045], observedAt: now(), source: 'replay' });
    }
  }
  return { s, log, droppedAt };
}

const byId = Object.fromEntries(SCENARIOS.map((x) => [x.id, x]));

test('saturday: pet prompt -> pet door in-only -> one HOLD for the kid -> delivered in zone -> door restored', () => {
  const { s, log } = run(byId.saturday);
  const kinds = log.map((e) => `${e.type}:${e.kind || e.mode || ''}`);
  assert.ok(log.some((e) => e.type === 'alexa' && /dog in the drop zone/.test(e.speech || '')), 'Alexa names the dog');
  assert.ok(kinds.includes('petdoor:in_only'));
  assert.equal(s.state.holdsIssued, 1);
  const hold = log.find((e) => e.type === 'carrier' && e.kind === 'hold');
  assert.deepEqual(hold.advisory.reason_codes, ['PERSON_IN_ZONE']);
  assert.equal(hold.advisory.authorises_drop, false);
  assert.equal(s.state.receipt.placement, 'in_zone');
  assert.equal(s.state.petDoor.mode, 'normal');
});

test('saturday without owner consent: pet door never moves', () => {
  const { s, log } = run(byId.saturday, { answer: false });
  assert.ok(!log.some((e) => e.type === 'petdoor'));
  assert.equal(s.state.petDoor.mode, 'normal');
});

test('unknown: never CLEAR, carrier gets NO_ADVISORY (status quo), receipt unconfirmed', () => {
  const { s, log } = run(byId.unknown);
  assert.ok(log.filter((e) => e.type === 'verdict').every((e) => e.verdict.status === STATUS.UNKNOWN));
  const fa = log.find((e) => e.type === 'carrier' && e.kind === 'final-approach');
  assert.equal(fa.advisory.advice, 'NO_ADVISORY');
  assert.equal(s.state.holdsIssued, 0);
  assert.equal(s.state.receipt.placement, 'unknown');
});

test('pool: audit warns before delivery; no hold; receipt says the box is by the pool', () => {
  const scn = byId.pool;
  assert.ok(auditZone(scn.zone, scn.hazards).some((f) => f.code === 'HAZARD_NEAR_ZONE' || f.code === 'HAZARD_OVERLAPS_ZONE'));
  const { s } = run(scn);
  assert.equal(s.state.holdsIssued, 0);
  assert.equal(s.state.receipt.placement, 'hazard');
  assert.equal(s.state.receipt.hazard, 'pool');
});
