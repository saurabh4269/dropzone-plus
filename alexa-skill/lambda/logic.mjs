// DropZone classic Alexa skill: pure conversation logic (no ask-sdk here, so it is easy to test).
// Zone verdicts come from the real DropZone engine (public/core, copied to ./dz at build time).
// Frame source: if DROPZONE_URL is set, the live DropZone server's /api/state; otherwise a
// SIMULATED replay frame (scripted detections from public/scenarios.js), and the skill says so.
// Pet door, yard lights and sprinkler are SIMULATED devices (public/core/*.js): no real hardware.

import { evaluateZone, freshen } from './dz/core/zone.js';
import { buildAdvisory } from './dz/core/advisory.js';
import { headsUp, confirmation } from './dz/core/alexa.js';
import { SCENARIOS, DEFAULT_ZONE, scriptedDetections } from './dz/scenarios.js';

export const SIM_NOTE = 'This is a simulated replay frame, not a live camera.';

/** Picks a replay frame: scenario id + simulated second (env-tunable for the demo). */
export function replayVerdict({ scenario = process.env.DZ_SCENARIO || 'saturday', t = Number(process.env.DZ_T ?? 20), now = Date.now() } = {}) {
  const scn = SCENARIOS.find((s) => s.id === scenario) || SCENARIOS[0];
  const media = scn.id === 'unknown' ? { readable: false, reason: 'replay: camera view unavailable' } : { readable: true };
  const v = evaluateZone({ detections: scriptedDetections(scn, t), zone: DEFAULT_ZONE, observedAt: now, now, media, source: `replay:${scn.id}@${t}s (simulated)` });
  return { verdict: v, simulated: true, household: { hasPetDoor: true, hasYardLights: true, hasSprinkler: true } };
}

export async function currentVerdict({ fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const base = process.env.DROPZONE_URL;
  if (base) {
    try {
      const r = await fetchImpl(base.replace(/\/$/, '') + '/api/state');
      if (r.ok) {
        const s = await r.json();
        return { verdict: s.verdict ? freshen(s.verdict, now) : null, delivery: s.delivery, simulated: false, household: { hasPetDoor: true, hasYardLights: true, hasSprinkler: true } };
      }
    } catch { /* fall through to UNKNOWN: never CLEAR on error */ }
    return { verdict: null, simulated: false, household: {} };
  }
  return replayVerdict({ now });
}

/** "Is the yard clear?" -> { speech, reprompt?, pending? } */
export function checkZoneReply({ verdict, simulated, household }, { etaMin = 8 } = {}) {
  const tail = simulated ? ' ' + SIM_NOTE : '';
  if (!verdict) return { speech: "I can't see the drop zone right now, so I can't say it's clear. Please take a quick look at the yard." + tail, end: true };
  const h = headsUp({ verdict, etaMin, household, petDoor: household?.hasPetDoor });
  if (h?.prompt) return { speech: h.speech + tail, reprompt: h.prompt.question, pending: h.prompt.action };
  return { speech: h.speech + tail, end: true };
}

/** "Ask the drone to wait" -> the advisory a carrier would get. DropZone can only ask it to wait. */
export function holdReply({ verdict, delivery, simulated }) {
  const a = buildAdvisory({ verdict, delivery });
  const tail = simulated ? ' ' + SIM_NOTE : '';
  if (a.advice === 'HOLD') return { speech: `Okay. I've asked the drone to wait about ${a.hold_seconds} seconds because the drop zone isn't clear. The carrier still makes the final call.${tail}`, advisory: a, end: true };
  if (a.zone_status === 'UNKNOWN') return { speech: `I can't see the drop zone, so I have nothing to tell the drone. It will follow the carrier's own checks.${tail}`, advisory: a, end: true };
  return { speech: `The drop zone looks clear, so there's no reason to hold the drone.${tail}`, advisory: a, end: true };
}

export const OFFERS = {
  'petdoor.in_only': 'Do you want me to set the pet door to come-in-only until the drone has left?',
  'lights.on': 'Do you want me to turn on the yard lights until the drone has left?',
  'sprinkler.pause': 'Do you want me to pause the sprinklers until the drone has left?',
};

/** Owner said yes/no to a pending device action. Devices are simulated and only act on yes. */
export function consentReply(pending, yes) {
  if (!pending || !OFFERS[pending]) return { speech: "There's nothing waiting for a yes or no. You can ask me if the yard is clear.", end: false, reprompt: 'Ask me if the yard is clear.' };
  if (!yes) return { speech: "Okay, I won't change anything.", end: true };
  return { speech: confirmation(pending, true) + ' This is a simulated device.', end: true, acted: pending };
}
