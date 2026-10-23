// Delivery-window orchestrator: Ring verdicts in; Alexa heads-ups, pet-door requests,
// carrier advisories and drop receipts out. Clock is injected so replay can run fast.

import { STATUS, freshen, pointInPolygon, footprint, distanceToPolygon } from './zone.js';
import { buildAdvisory, ADVICE } from './advisory.js';
import { headsUp, holdNotice, confirmation, deliveryDone, deviceOffers } from './alexa.js';
import { createPetDoor } from './petdoor.js';
import { createYardLights } from './lights.js';
import { createSprinkler } from './sprinkler.js';

// Restore window for every device change, even if we never hear "delivered".
const SAFETY_MS = 15 * 60000;

export const PHASE = Object.freeze({ IDLE: 'idle', INBOUND: 'inbound', HOLDING: 'holding', LANDING: 'landing', DELIVERED: 'delivered', DIVERTED: 'diverted' });

export function createSession({ zone, hazards = [], household = { hasPetDoor: true }, emit = () => {}, now = () => Date.now() }) {
  const s = {
    zone, hazards, household,
    phase: PHASE.IDLE,
    delivery: null,
    verdict: null,
    advisory: null,
    holdsIssued: 0,
    pendingPrompt: null,
    promptQueue: [],     // later questions wait their turn; Alexa asks one at a time
    receipt: null,
    announcedFor: null,
    timeline: [],
  };
  const petDoor = createPetDoor({ onChange: (e) => log('petdoor', e) });
  s.petDoor = petDoor;
  const lights = createYardLights({ onChange: (e) => log('lights', e) });
  s.lights = lights;
  const sprinkler = createSprinkler({ onChange: (e) => log('sprinkler', e), nextRunAt: household.sprinklerRunsAt ?? null });
  s.sprinkler = sprinkler;

  function log(type, data) {
    const entry = { at: new Date(now()).toISOString(), type, ...data };
    s.timeline.push(entry);
    emit(type, entry, s);
  }

  function etaMin() { return s.delivery ? (s.delivery.etaAt - now()) / 60000 : null; }

  function maybeAnnounce(force = false) {
    if (!s.delivery || ![PHASE.INBOUND, PHASE.HOLDING].includes(s.phase)) return;
    const v = freshen(s.verdict, now());
    const key = v.status === STATUS.NOT_CLEAR ? v.status + ':' + (v.reasons?.[0]?.code || '') : v.status; // UNKNOWN for a new reason isn't news
    if (!force && key === s.announcedFor) return;
    // Only speak up on the first look and when things get worse/unknown; "now clear" is a quiet card update.
    if (!force && s.announcedFor && v.status === STATUS.CLEAR) { s.announcedFor = key; log('alexa', { kind: 'card', card: { title: 'Drop zone clear', body: 'The drop zone is clear again.' } }); return; }
    s.announcedFor = key;
    const msg = headsUp({ verdict: v, etaMin: etaMin(), household: s.household, petDoor: s.household.hasPetDoor && petDoor.mode === 'normal' });
    if (!msg) return;
    if (msg.prompt && s.pendingPrompt) { // keep the open question; ask this one next
      const { prompt, ...rest } = msg;
      log('alexa', { kind: 'speech', ...rest });
      enqueue(prompt, prompt.question);
      return;
    }
    if (msg.prompt) s.pendingPrompt = msg.prompt;
    log('alexa', { kind: 'speech', ...msg });
  }

  function enqueue(prompt, speech) {
    if (s.pendingPrompt?.id === prompt.id || s.promptQueue.some((q) => q.prompt.id === prompt.id)) return;
    if (!s.pendingPrompt) { s.pendingPrompt = prompt; log('alexa', { kind: 'speech', speech, prompt }); }
    else s.promptQueue.push({ prompt, speech });
  }

  function askNext() {
    const q = s.promptQueue.shift();
    if (q) { s.pendingPrompt = q.prompt; log('alexa', { kind: 'speech', speech: q.speech, prompt: q.prompt }); }
  }

  // Devices that help the household clear the spot. Each is offered only when it applies.
  function offerDevices() {
    const end = (s.delivery?.etaAt || now()) + SAFETY_MS;
    const msg = deviceOffers({ household: s.household, lightsOff: lights.mode === 'off', sprinklerRunsAt: sprinkler.mode === 'scheduled' ? sprinkler.nextRunAt : null, now: now(), windowEnd: end });
    for (const m of msg) enqueue(m.prompt, m.speech);
  }

  return {
    state: s,
    startDelivery({ etaAt, carrier = 'Simulated carrier', ref = 'SIM-' + Math.random().toString(36).slice(2, 8).toUpperCase() }) {
      s.delivery = { etaAt, originalEtaAt: etaAt, carrier, ref };
      s.phase = PHASE.INBOUND;
      s.holdsIssued = 0;
      s.receipt = null;
      s.announcedFor = null;
      log('delivery', { kind: 'started', carrier, ref, eta: new Date(etaAt).toISOString() });
      maybeAnnounce(true);
      offerDevices();
    },
    observe(verdict) {
      s.verdict = verdict;
      log('verdict', { verdict });
      maybeAnnounce();
      s.advisory = buildAdvisory({ verdict, delivery: s.delivery, now: now(), holdsIssued: s.holdsIssued });
    },
    answer(promptId, yes) {
      const p = s.pendingPrompt;
      if (!p || p.id !== promptId) return { ok: false, error: 'NO_SUCH_PROMPT' };
      s.pendingPrompt = null;
      log('owner', { kind: 'answer', prompt: p.id, yes });
      if (!yes) { log('alexa', { kind: 'speech', speech: 'Okay, I won\'t change anything.' }); askNext(); return { ok: true }; }
      let res = { ok: false };
      const until = (s.delivery?.etaAt || now()) + SAFETY_MS; // safety restore even if we never hear "delivered"
      if (p.action === 'petdoor.in_only') res = petDoor.setInOnly({ ownerConsent: true, until, at: now() });
      else if (p.action === 'lights.on') res = lights.turnOn({ ownerConsent: true, until, at: now() });
      else if (p.action === 'sprinkler.pause') res = sprinkler.pause({ ownerConsent: true, until, at: now() });
      log('alexa', { kind: 'speech', speech: confirmation(p.action, res.ok) });
      askNext();
      return res;
    },
    /** Advance the simulated carrier. The carrier consults the advisory at T-60s and on each hold expiry. */
    tick() {
      petDoor.tick(now()); lights.tick(now()); sprinkler.tick(now());
      if (!s.delivery) return;
      const t = now();
      s.advisory = buildAdvisory({ verdict: s.verdict, delivery: s.delivery, now: t, holdsIssued: s.holdsIssued });
      if ((s.phase === PHASE.INBOUND || s.phase === PHASE.HOLDING) && t >= s.delivery.etaAt - 60000) {
        const adv = s.advisory;
        if (adv.advice === ADVICE.HOLD) {
          s.holdsIssued += 1;
          s.delivery.etaAt = t + 60000 + adv.hold_seconds * 1000;
          s.phase = PHASE.HOLDING;
          log('carrier', { kind: 'hold', advisory: adv, newEta: new Date(s.delivery.etaAt).toISOString(), holds: s.holdsIssued });
          log('alexa', { kind: 'speech', ...holdNotice({ verdict: freshen(s.verdict, t), holdSeconds: adv.hold_seconds }) });
        } else {
          s.phase = PHASE.LANDING;
          log('carrier', { kind: 'final-approach', advisory: adv, note: 'No HOLD; carrier proceeds under its own detect-and-avoid.' });
        }
      }
      if (s.phase === PHASE.LANDING && t >= s.delivery.etaAt) {
        s.phase = PHASE.DELIVERED;
        log('carrier', { kind: 'dropped' });
      }
    },
    /** Post-drop proof from a Ring frame: where did the box end up? */
    recordDrop({ packageBox, observedAt, snapshotUrl, source, method = packageBox ? 'provided' : 'none', detail = null }) {
      let placement = 'unknown', hazard = null;
      if (packageBox) {
        const fp = footprint(packageBox);
        const hz = s.hazards.find((h) => distanceToPolygon(fp, h.polygon) < 0.03);
        if (hz) { placement = 'hazard'; hazard = hz.kind; }
        else placement = pointInPolygon(fp, s.zone) ? 'in_zone' : 'outside_zone';
      }
      s.receipt = {
        schema: 'dropzone-plus/receipt@1',
        delivery_ref: s.delivery?.ref,
        placement, hazard,
        observed_at: observedAt ? new Date(observedAt).toISOString() : null,
        snapshot: snapshotUrl || null,
        source,
        method,           // 'change-detection' | 'provided' | 'none'
        package_box: packageBox ? packageBox.map((n) => Math.round(n * 1000) / 1000) : null,
        detail,
        holds_requested: s.holdsIssued,
      };
      petDoor.restore('drone departed', now());
      lights.restore('drone departed', now());
      sprinkler.restore('drone departed', now());
      s.phase = PHASE.DELIVERED;
      log('receipt', { receipt: s.receipt });
      log('alexa', { kind: 'speech', speech: deliveryDone(s.receipt) });
      return s.receipt;
    },
  };
}
