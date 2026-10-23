// DropZone+ 3D simulation: pure, deterministic scene model (no DOM, no three.js).
// Everything here is a function of (scenario, simulated time), so the page can scrub freely and the
// tests can run in Node. World units are metres; y is up; the house wall is the plane z = 0 and the
// yard extends towards +z. The real decision logic is imported, not re-implemented.

import { evaluateZone, pointInPolygon, distanceToPolygon, footprint } from '../core/zone.js';
import { buildAdvisory, ADVICE } from '../core/advisory.js';

export const T_MAX = 190;          // simulated seconds per run
export const NOMINAL_ETA = 112;    // when the drone would be over the drop point with no holds (T = 0)
export const HOLD_WINDOW = 12;     // seconds the simulated carrier hovers per HOLD (compressed for the sim)
export const POLL_FROM = 40;       // mission progress at which the carrier starts polling (≈ T-60 s at its speed)
export const SIM_EPOCH = Date.UTC(2026, 9, 24, 15, 0, 0);

const FT = 0.3048;
export const ZONE_CENTER = [1, 6.5];                 // [x, z]
export const ZONE_SIZE = 10 * FT;                  // 10 x 10 ft
const zh = ZONE_SIZE / 2;
export const ZONE_GROUND = [                       // [x, z] corners, clockwise from the camera's view
  [ZONE_CENTER[0] - zh, ZONE_CENTER[1] - zh], [ZONE_CENTER[0] + zh, ZONE_CENTER[1] - zh],
  [ZONE_CENTER[0] + zh, ZONE_CENTER[1] + zh], [ZONE_CENTER[0] - zh, ZONE_CENTER[1] + zh],
];
export const POOL = { x0: 3.6, x1: 7.6, z0: 4.2, z1: 9.4 };  // just outside the zone and outside the drone's FOV
export const POOL_GROUND = [[POOL.x0, POOL.z0], [POOL.x1, POOL.z0], [POOL.x1, POOL.z1], [POOL.x0, POOL.z1]];
export const PET_DOOR = [-4, 0];
export const YARD = { x0: -10, x1: 10, z1: 18 };

// Fixed Ring camera: on the house wall, 2.4 m up, wide lens (110° horizontal), 16:9.
export const RING_CAM = { pos: [0, 2.4, 0.15], target: [1.4, 0, 7.5], up: [0, 1, 0], hfov: 110, aspect: 16 / 9 };
// Drone down-looking camera: 4 m (13 ft) above the drop point, 60° FOV, square.
export const DRONE_CAM_ALT = 4;
export const DRONE_CAM = { hfov: 60, aspect: 1, up: [0, 0, -1] };

export const SCENARIOS = {
  'dog-kid': { title: 'Dog in the zone 30 s before arrival, kid crosses at T-60', dog: true, kid: true },
  'pool-gust': { title: 'Pool just outside the drone\'s view; downwash pushes the box toward it', gust: true },
  umbrella: { title: 'Stale survey: patio umbrella placed after the yard was mapped', umbrella: true },
};

// ---------- small vector helpers ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };

/** Vertical FOV (degrees) for a camera specified by horizontal FOV and aspect, as three.js expects. */
export function vfovDeg(hfov, aspect) {
  return (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI;
}

/**
 * Pinhole projection matching three.js PerspectiveCamera + lookAt.
 * Returns normalised image coords [u, v] (0..1, origin top-left) and depth, or null if behind the camera.
 */
export function project(cam, p) {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, cam.up));
  const u = cross(r, f);
  const d = sub(p, cam.pos);
  const zc = dot(d, f);
  if (zc <= 0.05) return null;
  const th = Math.tan((cam.hfov * Math.PI) / 360);
  const tv = th / cam.aspect;
  const x = dot(d, r) / (zc * th), y = dot(d, u) / (zc * tv);
  return { uv: [(x + 1) / 2, (1 - y) / 2], depth: zc };
}

/** Project a ground polygon ([x,z] pairs) to a normalised image polygon. */
export function projectGround(cam, poly) {
  return poly.map(([x, z]) => project(cam, [x, 0, z])?.uv).filter(Boolean);
}

/**
 * "Simulated ground-truth detector": project an axis-aligned 3D box (centre x/z on the ground, half-sizes,
 * height) and return its normalised 2D box [x, y, w, h] clipped to the frame, or null if not visible.
 * No occlusion and no misses: this is the best case for any detector, labelled as such in the UI.
 */
export function projectBox(cam, { x, z, hx, hz, h, y0 = 0 }) {
  const pts = [];
  for (const dx of [-hx, hx]) for (const dz of [-hz, hz]) for (const y of [y0, y0 + h]) {
    const pr = project(cam, [x + dx, y, z + dz]);
    if (pr) pts.push(pr.uv);
  }
  if (pts.length < 8) return null; // partly behind the camera: treat as not visible
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = clamp01(Math.min(...xs)), x1 = clamp01(Math.max(...xs));
  const y0b = clamp01(Math.min(...ys)), y1 = clamp01(Math.max(...ys));
  if (x1 - x0 < 1e-3 || y1 - y0b < 1e-3) return null;
  return [x0, y0b, x1 - x0, y1 - y0b];
}

// ---------- scripted actors ----------
function path(t, pts) { // pts: [[t, x, z], ...] piecewise linear
  if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, x0, z0] = pts[i - 1], [t1, x1, z1] = pts[i];
      const k = (t - t0) / (t1 - t0);
      return [lerp(x0, x1, k), lerp(z0, z1, k)];
    }
  }
  const l = pts[pts.length - 1];
  return [l[1], l[2]];
}

export const DOG_OUT = 82, DOG_ASKED = 85, DOG_YES = 93, DOG_CALLED = 102, DOG_IN = 112;
export const KID_FROM = 44, KID_TO = 68;

/** Positions of the people/pets/objects at time t. Each actor: {id, label, x, z, hx, hz, h, visible}. */
export function actorsAt(scenarioId, t) {
  const sc = SCENARIOS[scenarioId];
  const out = [];
  if (sc.dog) {
    const visible = t >= DOG_OUT && t < DOG_IN;
    const [px, pz] = PET_DOOR;
    let x, z;
    if (t < DOG_OUT + 8) [x, z] = path(t, [[DOG_OUT, px, pz + 0.4], [DOG_OUT + 8, 0.7, 6.2]]);
    else if (t < DOG_CALLED) { const k = t - DOG_OUT - 8; x = 0.7 + 0.5 * Math.sin(k * 0.6); z = 6.4 + 0.45 * Math.sin(k * 0.37 + 1); }
    else [x, z] = path(t, [[DOG_CALLED, 0.7 + 0.5 * Math.sin((DOG_CALLED - DOG_OUT - 8) * 0.6), 6.4 + 0.45 * Math.sin((DOG_CALLED - DOG_OUT - 8) * 0.37 + 1)], [DOG_IN, px, pz + 0.4]]);
    out.push({ id: 'dog', label: 'dog', x, z, hx: 0.45, hz: 0.45, h: 0.6, visible });
  }
  if (sc.kid) {
    const [x, z] = path(t, [[KID_FROM, -9, 7.1], [KID_FROM + 11, 1.2, 6.9], [KID_FROM + 16, 2.6, 11.5], [KID_TO, 8.5, 15.5]]);
    out.push({ id: 'kid', label: 'person', x, z, hx: 0.22, hz: 0.22, h: 1.25, visible: t >= KID_FROM && t <= KID_TO });
  }
  if (sc.umbrella) out.push({ id: 'umbrella', label: 'umbrella', x: 1.5, z: 7.0, hx: 1.1, hz: 1.1, h: 2.2, visible: true });
  return out;
}

// ---------- drone mission ----------
// Mission progress p (seconds of flight plan completed). Holds freeze p; the drone hovers.
export const P = { HOVER_POINT: 100, AT_4M: 112, CHECK_DONE: 116, RELEASE: 116, GONE: 140 };
const CRUISE_ALT = 30;
const START = [70, CRUISE_ALT, 75];
const EXIT = [-40, CRUISE_ALT, -60];

export function dronePose(p) {
  const [cx, cz] = ZONE_CENTER;
  if (p < P.HOVER_POINT) {
    const k = smooth(p / P.HOVER_POINT * 1.0) * 0.4 + (p / P.HOVER_POINT) * 0.6;
    return [lerp(START[0], cx, k), CRUISE_ALT, lerp(START[2], cz, k)];
  }
  if (p < P.AT_4M) return [cx, lerp(CRUISE_ALT, DRONE_CAM_ALT, smooth((p - P.HOVER_POINT) / (P.AT_4M - P.HOVER_POINT))), cz];
  if (p < P.RELEASE + 4) return [cx, DRONE_CAM_ALT, cz];
  if (p < P.RELEASE + 14) return [cx, lerp(DRONE_CAM_ALT, CRUISE_ALT, smooth((p - P.RELEASE - 4) / 10)), cz];
  const k = clamp01((p - P.RELEASE - 14) / (P.GONE - P.RELEASE - 14));
  return [lerp(cx, EXIT[0], k), CRUISE_ALT, lerp(cz, EXIT[2], k)];
}

export function droneCamAt(p) {
  const [x, y, z] = dronePose(p);
  return { ...DRONE_CAM, pos: [x, y - 0.3, z], target: [x, 0, z] };
}

const BOX = { hx: 0.25, hz: 0.2, h: 0.3 };  // a 50 x 40 x 30 cm parcel
/** Where the package is at time t, given the release time (null if never released). */
export function boxAt(scenarioId, t, tRelease) {
  if (tRelease == null || t < tRelease) return null;
  const sc = SCENARIOS[scenarioId];
  const [cx, cz] = ZONE_CENTER;
  const fall = 1.4;
  const drift = sc.gust ? 2.55 : 0.12;     // metres pushed toward the pool (+x) by downwash/gust
  const k = clamp01((t - tRelease) / fall);
  const slide = sc.gust ? clamp01((t - tRelease - fall) / 0.8) : 0;
  const x = cx + drift * (k * k) * 0.8 + drift * 0.2 * smooth(slide);
  const y = Math.max(0, (DRONE_CAM_ALT - 0.6) * (1 - k * k));
  return { id: 'box', label: 'package', x, z: cz + 0.1 * k, y0: y, ...BOX, landed: k >= 1 && (!sc.gust || slide >= 1) };
}

// ---------- detections ----------
export function detectionsFor(cam, actors) {
  const out = [];
  for (const a of actors) {
    if (!a.visible) continue;
    const box = projectBox(cam, a);
    if (box) out.push({ id: a.id, label: a.label, score: 0.92, box });
  }
  return out;
}

export const RING_ZONE = projectGround(RING_CAM, ZONE_GROUND);
export const RING_POOL = projectGround(RING_CAM, POOL_GROUND);

/** Drone-side "safe to drop" check: no obstacle inside the camera's ground footprint right now. */
export function droneCheck(p, actors) {
  const cam = droneCamAt(p);
  const dets = detectionsFor(cam, actors);
  return { safe: dets.length === 0, detections: dets, cam };
}

/** Footprint of the drone camera on the ground (metres, [x0,z0,x1,z1]). */
export function droneFootprint(p) {
  const cam = droneCamAt(p);
  const half = cam.pos[1] * Math.tan((cam.hfov * Math.PI) / 360);
  return [cam.pos[0] - half, cam.pos[2] - half, cam.pos[0] + half, cam.pos[2] + half];
}

/**
 * Run the whole scenario second by second (deterministic). Each step: Ring-view detections ->
 * real evaluateZone -> real buildAdvisory -> simulated carrier (hover on HOLD, else fly the plan).
 */
export function simulate(scenarioId) {
  const steps = [];
  const events = [];
  let p = 0, holdsIssued = 0, holdUntil = -1, aborted = false, tRelease = null, tAbort = null, droneOk = null;
  const ev = (t, kind, text) => events.push({ t, kind, text });
  const sc = SCENARIOS[scenarioId];
  if (sc.umbrella) ev(0, 'note', 'Patio umbrella was put up yesterday, after the drop point was mapped. The drone operator\'s map does not know.');
  if (sc.dog) {
    ev(DOG_OUT, 'ring', 'Dog walks out of the pet door into the yard.');
    ev(DOG_ASKED, 'alexa', 'Alexa (simulated): "Your drone delivery is about 30 seconds out and the dog is in the drop zone. Set the pet door to come-in-only?"');
    ev(DOG_YES, 'owner', 'Owner: "Yes." Pet door (simulated) set to come-in-only.');
    ev(DOG_CALLED, 'owner', 'Owner calls the dog in; it goes back through the pet door.');
  }
  for (let t = 0; t <= T_MAX; t++) {
    const actors = actorsAt(scenarioId, t);
    const detections = detectionsFor(RING_CAM, actors);
    const now = SIM_EPOCH + t * 1000;
    const verdict = evaluateZone({ detections, zone: RING_ZONE, observedAt: now, now, media: { readable: true }, source: 'sim-3d' });
    let advisory = null, moving = false, phase;
    const polling = !aborted && tRelease == null && p >= POLL_FROM && p < P.AT_4M && t >= holdUntil;
    if (polling) {
      advisory = buildAdvisory({ verdict, delivery: { ref: 'SIM-3D' }, now, holdsIssued });
      if (advisory.advice === ADVICE.HOLD) {
        holdsIssued++; holdUntil = t + HOLD_WINDOW;
        ev(t, 'carrier', `HOLD #${holdsIssued} (${advisory.reason_codes.join(', ')}): drone hovers ${HOLD_WINDOW} s.`);
      } else if (advisory.reason_codes.includes('HOLD_BUDGET_EXHAUSTED') && !steps.some((s) => s.advisory?.reason_codes.includes('HOLD_BUDGET_EXHAUSTED'))) {
        ev(t, 'carrier', 'Hold budget used up (3). NO_ADVISORY: the carrier falls back to its own sensors.');
      }
    }
    const holding = t < holdUntil;
    let check = null;
    if (!holding && !aborted && tRelease == null && p >= P.AT_4M && p < P.CHECK_DONE) {
      check = droneCheck(p, actors);
      if (droneOk === null || !check.safe) droneOk = check.safe;
      if (!check.safe) { aborted = true; tAbort = t; ev(t, 'drone', `Drone-side check at 13 ft: obstacle in view (${check.detections.map((d) => d.label).join(', ')}). Abort: wasted trip, package goes by ground.`); }
    }
    if (!holding && !aborted && tRelease == null && p >= P.RELEASE) {
      tRelease = t; ev(t, 'drone', 'Drone-side check clear (nothing inside its camera footprint). Package released from 13 ft.');
    }
    if (!holding) { moving = true; }
    phase = aborted ? 'ABORTED' : tRelease != null ? (p < P.RELEASE + 14 ? 'RELEASED' : 'DEPARTING')
      : holding ? 'HOLDING' : p < P.HOVER_POINT ? 'APPROACH' : p < P.AT_4M ? 'DESCENT' : 'DRONE CHECK';
    steps.push({ t, p, moving, holding, holdsIssued, verdict, advisory, detections, phase, aborted, check });
    if (moving) p = aborted && p < P.RELEASE ? P.RELEASE : p + 1;
  }
  events.sort((a, b) => a.t - b.t);
  return { scenarioId, steps, events, tRelease, tAbort };
}

/** Continuous mission progress at fractional time t (for smooth animation between simulated seconds). */
export function progressAt(run, t) {
  const i = Math.max(0, Math.min(run.steps.length - 1, Math.floor(t)));
  const s = run.steps[i];
  const next = run.steps[Math.min(run.steps.length - 1, i + 1)];
  return s.moving ? lerp(s.p, next.p, t - i) : s.p;
}

/** Same placement rule as core/engine.js recordDrop: hazard if within 0.03 of the pool polygon, else in/outside zone. */
export function classifyDrop(packageBox, { zone = RING_ZONE, hazards = [{ kind: 'pool', polygon: RING_POOL }] } = {}) {
  if (!packageBox) return { placement: 'unknown', hazard: null };
  const fp = footprint(packageBox);
  const hz = hazards.find((h) => distanceToPolygon(fp, h.polygon) < 0.03);
  if (hz) return { placement: 'hazard', hazard: hz.kind };
  return { placement: pointInPolygon(fp, zone) ? 'in_zone' : 'outside_zone', hazard: null };
}
