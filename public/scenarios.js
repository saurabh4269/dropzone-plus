// REPLAY scenarios. Everything here is SIMULATED and labelled as such in the UI:
// the yard is a drawn scene, actor positions are scripted, and the "detections" are derived
// from those scripted positions (not from a vision model). Times are simulated seconds.
// Coordinates: normalised frame, (x, y) = where the actor touches the ground.

export const DEFAULT_ZONE = [[0.43, 0.58], [0.63, 0.58], [0.66, 0.80], [0.40, 0.80]];

const POOL = { kind: 'pool', polygon: [[0.70, 0.50], [0.92, 0.50], [0.95, 0.66], [0.70, 0.66]] };

export const SCENARIOS = [
  {
    id: 'saturday',
    title: 'Dog in the zone, then a kid at T−1 min',
    blurb: 'Drone ordered, 8 min out. The dog is lying in the drop zone. Alexa asks; the owner says yes; the pet door goes come-in-only. Later a kid runs through at T−60 s, so the carrier gets a HOLD.',
    etaSec: 480,
    durationSec: 600,
    hazards: [],
    actors: [
      { id: 'dog', label: 'dog', emoji: '🐕', size: 0.085, keys: [[0, 0.52, 0.70], [60, 0.55, 0.69], [120, 0.50, 0.71], [150, 0.36, 0.60], [200, 0.13, 0.44]], visible: [[0, 205]] },
      { id: 'kid', label: 'person', emoji: '🧒', size: 0.16, keys: [[380, 1.02, 0.74], [415, 0.60, 0.73], [430, 0.52, 0.72], [450, 0.38, 0.86], [480, 0.10, 0.95]], visible: [[380, 480]] },
    ],
    events: [
      { t: 35, type: 'answer', prompt: 'petdoor-in-only', yes: true, auto: true },
    ],
    drop: { at: [0.53, 0.70] },
  },
  {
    id: 'unknown',
    title: 'Camera can\'t see (offline / end-to-end encrypted)',
    blurb: 'The frame can\'t be read. DropZone says UNKNOWN, never CLEAR. Alexa asks someone to look; the carrier gets NO_ADVISORY and flies exactly as it would today.',
    etaSec: 240,
    durationSec: 320,
    hazards: [],
    media: { readable: false, reason: 'Video is end-to-end encrypted (simulated)' },
    actors: [],
    events: [],
    drop: { at: [0.52, 0.69], unseen: true },
  },
  {
    id: 'pool',
    title: 'Pool right next to the drop point',
    blurb: 'The zone audit warns that the pool is inside downwash range and suggests a safer spot. Play as-is: the box ends up by the pool, and proof-of-drop (before/after change detection) catches it. Or press “Apply suggestion” first and replay.',
    etaSec: 180,
    durationSec: 260,
    hazards: [POOL],
    zone: [[0.50, 0.52], [0.68, 0.52], [0.70, 0.68], [0.48, 0.68]],
    actors: [],
    events: [],
    drop: { at: [0.715, 0.60] },
  },
  {
    id: 'dusk',
    title: 'Dusk: too dark to see, sprinklers due mid-drop',
    blurb: 'Evening delivery, 5 min out. The camera can\'t read the zone in this light, and the sprinklers are scheduled to run at T−20 s. Alexa asks; the owner says yes; the yard lights come on and the next sprinkler run is paused. All three devices are simulated.',
    etaSec: 300,
    durationSec: 400,
    hazards: [],
    lowLight: true,                      // simulated: frames are unreadable until the yard lights are on
    household: { hasPetDoor: true, hasYardLights: true, hasSprinkler: true, lowLight: true },
    sprinklerAtSec: 280,                 // simulated irrigation schedule
    actors: [],
    events: [
      { t: 15, type: 'answer', prompt: 'lights-on', yes: true, auto: true },
      { t: 30, type: 'answer', prompt: 'sprinkler-pause', yes: true, auto: true },
    ],
    drop: { at: [0.53, 0.70] },
  },
];

/** Household for a scenario run that started at `base` (ms). Simulated devices only. */
export function scenarioHousehold(scn, base) {
  const h = { hasPetDoor: true, ...(scn.household || {}) };
  if (Number.isFinite(scn.sprinklerAtSec)) h.sprinklerRunsAt = base + scn.sprinklerAtSec * 1000;
  return h;
}

/** What the (simulated) camera can read right now. At dusk it needs the yard lights on. */
export function replayMedia(scn, state) {
  if (scn.lowLight && state?.lights?.mode !== 'on') return { readable: false, reason: 'Too dark to read the drop zone (simulated dusk)' };
  return scn.media || { readable: true };
}

function lerp(a, b, t) { return a + (b - a) * t; }

export function actorAt(actor, t) {
  const vis = actor.visible.some(([a, b]) => t >= a && t <= b);
  if (!vis) return null;
  const k = actor.keys;
  if (t <= k[0][0]) return { x: k[0][1], y: k[0][2] };
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const f = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return { x: lerp(k[i - 1][1], k[i][1], f), y: lerp(k[i - 1][2], k[i][2], f) };
    }
  }
  const last = k[k.length - 1];
  return { x: last[1], y: last[2] };
}

/** Perspective: things further up the frame look smaller. */
export function sizeAt(actor, y) { return actor.size * (0.55 + 0.75 * y); }

/** Scripted detections derived from actor positions (clearly not a model output). */
export function scriptedDetections(scn, t) {
  const out = [];
  for (const a of scn.actors) {
    const p = actorAt(a, t);
    if (!p || p.x < 0 || p.x > 1) continue;
    const s = sizeAt(a, p.y);
    const w = a.label === 'person' ? s * 0.55 : s;
    out.push({ label: a.label, score: 0.9, box: [p.x - w / 2, p.y - s, w, s], scripted: true });
  }
  return out;
}
