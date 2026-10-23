// DropZone+ 3D simulation page: renders the deterministic model (model.js) with three.js from three cameras,
// feeds the Ring-view detections to the real core logic, and runs the real proof-of-drop on rendered frames.
import * as THREE from '../vendor/three/three.module.min.js';
import {
  T_MAX, NOMINAL_ETA, SCENARIOS, ZONE_CENTER, ZONE_SIZE, POOL, PET_DOOR, YARD, RING_CAM, DRONE_CAM_ALT, P,
  RING_ZONE, RING_POOL, vfovDeg, actorsAt, dronePose, droneCamAt, droneFootprint, boxAt, detectionsFor,
  simulate, progressAt, classifyDrop,
} from './model.js';
import { findNewObject } from '../core/changes.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const runs = Object.fromEntries(Object.keys(SCENARIOS).map((id) => [id, simulate(id)]));
let scenario = SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'dog-kid';
let t = Math.min(T_MAX, Math.max(0, Number(params.get('t')) || 0));
let playing = params.get('play') !== '0';
let speed = Number(params.get('speed')) || 4;
const receipts = {};

// ---------- renderers and cameras ----------
function makeRenderer(canvas, w, h) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  return r;
}
const ringR = makeRenderer($('ringGl'), 960, 540);
const droneR = makeRenderer($('droneGl'), 540, 540);
const overR = makeRenderer($('overGl'), 960, 540);

const ringCam = new THREE.PerspectiveCamera(vfovDeg(RING_CAM.hfov, RING_CAM.aspect), RING_CAM.aspect, 0.05, 400);
ringCam.position.set(...RING_CAM.pos); ringCam.up.set(...RING_CAM.up); ringCam.lookAt(...RING_CAM.target);
const droneCam = new THREE.PerspectiveCamera(vfovDeg(60, 1), 1, 0.05, 200);
droneCam.up.set(0, 0, -1);
const overCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 600);
overCam.position.set(11, 9, 19); overCam.lookAt(-0.5, 1.5, 5);
overCam.layers.enable(1);

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9cbe8);
scene.fog = new THREE.Fog(0xa9cbe8, 60, 220);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6b2a, 1.4));
const sun = new THREE.DirectionalLight(0xfff3dd, 1.6); sun.position.set(-8, 20, 12); scene.add(sun);

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function box(w, h, d, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z); parent.add(m); return m;
}
function onLayer1(o) { o.layers.set(1); o.traverse((c) => c.layers.set(1)); return o; }

// ground: lawn inside the fence, rougher grass outside
const lawn = new THREE.Mesh(new THREE.PlaneGeometry(YARD.x1 - YARD.x0, YARD.z1), mat(0x5f9a3c));
lawn.rotation.x = -Math.PI / 2; lawn.position.set(0, 0, YARD.z1 / 2); scene.add(lawn);
const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x4e7d33));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
for (let i = 0; i < 14; i++) { // mowing stripes
  const s = new THREE.Mesh(new THREE.PlaneGeometry((YARD.x1 - YARD.x0) / 14, YARD.z1), mat(i % 2 ? 0x67a243 : 0x5c963a));
  s.rotation.x = -Math.PI / 2; s.position.set(YARD.x0 + ((i + 0.5) * (YARD.x1 - YARD.x0)) / 14, 0.002, YARD.z1 / 2); scene.add(s);
}
// patio slab by the house
box(7, 0.04, 2.4, 0xb9b2a5, -2.5, 0.02, 1.2);

// drop zone: painted 10 x 10 ft square with a centre mark
{
  const [cx, cz] = ZONE_CENTER, s = ZONE_SIZE, w = 0.07, paint = mat(0xf4f4ee);
  box(s, 0.01, w, paint, cx, 0.01, cz - s / 2); box(s, 0.01, w, paint, cx, 0.01, cz + s / 2);
  box(w, 0.01, s, paint, cx - s / 2, 0.01, cz); box(w, 0.01, s, paint, cx + s / 2, 0.01, cz);
  const c1 = box(0.9, 0.01, 0.07, paint, cx, 0.011, cz); c1.rotation.y = Math.PI / 4;
  const c2 = box(0.9, 0.01, 0.07, paint, cx, 0.011, cz); c2.rotation.y = -Math.PI / 4;
}
// pool: coping, water, darker inner wall
{
  const w = POOL.x1 - POOL.x0, d = POOL.z1 - POOL.z0, cx = (POOL.x0 + POOL.x1) / 2, cz = (POOL.z0 + POOL.z1) / 2;
  box(w + 0.5, 0.08, d + 0.5, 0xe7e2d6, cx, 0.04, cz);
  box(w, 0.09, d, mat(0x2f9fd6, { emissive: 0x0b3b5c }), cx, 0.05, cz);
  box(w - 0.8, 0.095, 0.08, 0x8fd3f2, cx, 0.052, cz - 0.6); box(w - 1.4, 0.095, 0.06, 0x8fd3f2, cx + 0.2, 0.052, cz + 1.1);
}
// fence
{
  const wood = mat(0x9a7652);
  const rail = (len, x, z, alongX) => { for (const y of [0.45, 1.35]) box(alongX ? len : 0.06, 0.1, alongX ? 0.06 : len, wood, x, y, z); };
  rail(YARD.x1 - YARD.x0, 0, YARD.z1, true); rail(YARD.z1, YARD.x0, YARD.z1 / 2, false); rail(YARD.z1, YARD.x1, YARD.z1 / 2, false);
  for (let x = YARD.x0; x <= YARD.x1 + 1e-6; x += 0.5) box(0.12, 1.6, 0.04, wood, x, 0.8, YARD.z1);
  for (let z = 0.5; z <= YARD.z1; z += 0.5) { box(0.04, 1.6, 0.12, wood, YARD.x0, 0.8, z); box(0.04, 1.6, 0.12, wood, YARD.x1, 0.8, z); }
}
// house wall with back door, window, pet door, and the Ring camera on the wall
{
  box(20.4, 3.4, 0.3, 0xe9dcc6, 0, 1.7, -0.15);
  box(20.8, 0.3, 1.2, 0x6d4c41, 0, 3.5, -0.3); // eave
  box(1.0, 2.1, 0.06, 0x7b5e45, -5.4, 1.05, 0.02); // back door
  box(1.8, 1.1, 0.06, 0x9cc7e0, 3.2, 1.7, 0.02); box(1.9, 0.08, 0.1, 0xffffff, 3.2, 1.12, 0.05);
  box(0.46, 0.56, 0.05, 0x3a3a3a, PET_DOOR[0], 0.3, 0.02); box(0.36, 0.44, 0.06, 0x5b6770, PET_DOOR[0], 0.28, 0.03);
  const cam = new THREE.Group();
  box(0.12, 0.16, 0.08, 0x222831, 0, 0, 0, cam); box(0.06, 0.06, 0.02, 0x4fc3f7, 0, 0.01, 0.05, cam);
  cam.position.set(RING_CAM.pos[0], RING_CAM.pos[1], 0.04); scene.add(cam);
  // owner-visible Ring frustum hint in the overview only
}
// some deterministic shrubs along the fence
for (let i = 0; i < 9; i++) {
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + (i % 3) * 0.15, 0), mat(0x3f7a2e));
  b.position.set(-8.6 + i * 2.1, 0.45, 17.2 - (i % 2) * 0.3); scene.add(b);
}

// ---------- actors ----------
function makeDog() {
  const g = new THREE.Group(), fur = mat(0x9b6a3c), dark = mat(0x4b3020);
  box(0.62, 0.26, 0.26, fur, 0, 0.42, 0, g); box(0.24, 0.22, 0.2, fur, 0.38, 0.6, 0, g); box(0.1, 0.08, 0.1, dark, 0.53, 0.56, 0, g);
  for (const [x, z] of [[0.22, 0.09], [0.22, -0.09], [-0.22, 0.09], [-0.22, -0.09]]) box(0.07, 0.3, 0.07, fur, x, 0.15, z, g);
  const tail = box(0.24, 0.05, 0.05, fur, -0.4, 0.6, 0, g); tail.rotation.z = 0.7;
  scene.add(g); return g;
}
function makeKid() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.45, 4, 8), mat(0xd94848)); body.position.y = 0.72; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat(0xe9b98f)); head.position.y = 1.12; g.add(head);
  for (const x of [-0.07, 0.07]) box(0.09, 0.42, 0.09, 0x2b4c8c, x, 0.21, 0, g);
  scene.add(g); return g;
}
function makeUmbrella() {
  const g = new THREE.Group();
  box(0.05, 2.1, 0.05, 0xdddddd, 0, 1.05, 0, g);
  const c = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.5, 8, 1, true), mat(0xf2a33a, { side: THREE.DoubleSide })); c.position.y = 2.05; g.add(c);
  box(0.8, 0.04, 0.8, 0xffffff, 0, 0.72, 0, g); box(0.05, 0.7, 0.05, 0xffffff, 0, 0.36, 0, g); // little table
  scene.add(g); return g;
}
const actorMeshes = { dog: makeDog(), kid: makeKid(), umbrella: makeUmbrella() };

function makeDrone() {
  const g = new THREE.Group(), white = mat(0xf2f4f7), grey = mat(0x56606b);
  box(0.7, 0.2, 0.7, white, 0, 0, 0, g); box(0.3, 0.1, 0.3, grey, 0, -0.14, 0, g);
  const rotors = [];
  for (const [x, z] of [[0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]]) {
    const arm = box(1.0, 0.06, 0.08, grey, x / 2, 0.05, z / 2, g); arm.rotation.y = Math.atan2(-z, x);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 20), new THREE.MeshLambertMaterial({ color: 0x222222, transparent: true, opacity: 0.45 }));
    r.position.set(x, 0.1, z); g.add(r); rotors.push(r);
    box(0.05, 0.05, 0.05, x > 0 ? 0x2ecc71 : 0xe74c3c, x, 0.0, z, g);
  }
  const pkg = box(0.5, 0.3, 0.4, 0xc49a6c, 0, -0.45, 0, g);
  scene.add(g); return { g, rotors, pkg };
}
const drone = makeDrone();
const groundBox = box(0.5, 0.3, 0.4, 0xc49a6c, 0, 0, 0); groundBox.visible = false;
const tape = box(0.51, 0.02, 0.07, 0x6b4a2b, 0, 0.155, 0, groundBox); tape.visible = true;

// downwash: ground ring + dust/grass particles
const washRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
washRing.rotation.x = -Math.PI / 2; scene.add(washRing);
const N_PART = 260;
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_PART * 3), 3));
const parts = new THREE.Points(partGeo, new THREE.PointsMaterial({ color: 0xe6f2c8, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
scene.add(parts);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

// drone camera footprint on the ground (overview only)
const fpGeo = new THREE.BufferGeometry(); fpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
const footprintLine = onLayer1(new THREE.Line(fpGeo, new THREE.LineBasicMaterial({ color: 0xff3df5 })));
scene.add(footprintLine);

// ---------- pose the whole scene for time tt ----------
function pose(sc, tt) {
  const run = runs[sc];
  for (const [id, m] of Object.entries(actorMeshes)) m.visible = false;
  const now = actorsAt(sc, tt), ahead = actorsAt(sc, tt + 0.25);
  for (const a of now) {
    const m = actorMeshes[a.id]; if (!m) continue;
    m.visible = a.visible; m.position.set(a.x, 0, a.z);
    const b = ahead.find((o) => o.id === a.id);
    if (b && Math.hypot(b.x - a.x, b.z - a.z) > 1e-3) m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  }
  const p = progressAt(run, tt);
  const [dx, dy, dz] = dronePose(p);
  drone.g.position.set(dx, dy, dz);
  drone.rotors.forEach((r, i) => (r.rotation.y = tt * 40 + i));
  drone.pkg.visible = run.tRelease == null || tt < run.tRelease;
  const b = boxAt(sc, tt, run.tRelease);
  groundBox.visible = !!b;
  if (b) { groundBox.position.set(b.x, b.y0 + b.h / 2, b.z); groundBox.rotation.y = Math.min(1, (tt - run.tRelease) / 2) * 0.5; }
  // downwash strength grows as the drone gets low
  const k = Math.max(0, Math.min(1, (10 - dy) / 6));
  washRing.visible = parts.visible = k > 0.01;
  shadow.visible = dy < 14; shadow.position.set(dx, 0.015, dz); shadow.material.opacity = 0.3 * Math.max(0, 1 - dy / 14);
  if (k > 0.01) {
    const ph = (tt * 0.9) % 1;
    washRing.position.set(dx, 0.03, dz);
    washRing.scale.setScalar(1 + ph * 3.2 * k); washRing.material.opacity = 0.45 * (1 - ph) * k;
    const pos = partGeo.attributes.position.array;
    for (let i = 0; i < N_PART; i++) {
      const h = Math.sin(i * 12.9898) * 43758.5453, ang = (i * 2.399963) % (Math.PI * 2), phase = h - Math.floor(h);
      const f = (tt * 0.7 + phase) % 1;
      const rr = 0.4 + f * 4.2 * k;
      pos[i * 3] = dx + Math.cos(ang) * rr; pos[i * 3 + 2] = dz + Math.sin(ang) * rr;
      pos[i * 3 + 1] = 0.05 + Math.sin(f * Math.PI) * 0.5 * k * (0.4 + (i % 5) / 5);
    }
    partGeo.attributes.position.needsUpdate = true;
    parts.material.opacity = 0.85 * k;
  }
  // drone camera
  const dc = droneCamAt(p);
  droneCam.position.set(...dc.pos); droneCam.lookAt(...dc.target);
  const [x0, z0, x1, z1] = droneFootprint(p);
  fpGeo.attributes.position.array.set([x0, 0.03, z0, x1, 0.03, z0, x1, 0.03, z1, x0, 0.03, z1, x0, 0.03, z0]);
  fpGeo.attributes.position.needsUpdate = true;
  footprintLine.visible = droneActive(sc, tt);
  return { p, actors: now, box: b };
}
function droneActive(sc, tt) {
  const run = runs[sc], p = progressAt(run, tt);
  return p >= P.HOVER_POINT && p < P.RELEASE + 6;
}

// ---------- proof of drop on rendered 160x90 Ring frames ----------
const rt = new THREE.WebGLRenderTarget(160, 90);
function ringFrame(sc, tt) {
  pose(sc, tt);
  ringR.setRenderTarget(rt); ringR.render(scene, ringCam); ringR.setRenderTarget(null);
  const raw = new Uint8Array(160 * 90 * 4);
  ringR.readRenderTargetPixels(rt, 0, 0, 160, 90, raw);
  const data = new Uint8ClampedArray(raw.length); // GL rows are bottom-up; flip to image order
  for (let y = 0; y < 90; y++) data.set(raw.subarray((89 - y) * 640, (90 - y) * 640), y * 640);
  return { width: 160, height: 90, data };
}
function receiptFor(sc) {
  if (receipts[sc]) return receipts[sc];
  const run = runs[sc];
  if (run.tRelease == null) return (receipts[sc] = { placement: 'not_dropped', detail: 'Drone aborted; nothing to locate.' });
  const before = ringFrame(sc, run.tRelease - 18), after = ringFrame(sc, run.tRelease + 22);
  // A parcel 9 m from a 110° lens is only a few pixels at 160x90, so the blob floor is halved (documented on the page).
  const found = findNewObject(before, after, { zone: RING_ZONE, hazards: [{ kind: 'pool', polygon: RING_POOL }] }, { minBlobFrac: 0.0004 });
  const placed = found.ok ? classifyDrop(found.box) : { placement: 'unknown', hazard: null };
  receipts[sc] = { ...placed, found, before, after };
  pose(scenario, t);
  return receipts[sc];
}

// ---------- overlays ----------
function drawPoly(ctx, poly, W, H, color, dash, label) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
  ctx.beginPath(); poly.forEach(([u, v], i) => (i ? ctx.lineTo(u * W, v * H) : ctx.moveTo(u * W, v * H))); ctx.closePath(); ctx.stroke();
  if (label) { const [u, v] = poly.reduce(([a, b], [x, y]) => [Math.min(a, x), Math.max(b, y)], [1, 0]); tag(ctx, label, u * W, v * H + 4, color, false); }
  ctx.restore();
}
function tag(ctx, text, x, y, color, above = true) {
  ctx.font = '600 15px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = color; ctx.fillRect(x, above ? y - 20 : y, w, 20);
  ctx.fillStyle = '#0b0f14'; ctx.fillText(text, x + 5, above ? y - 5 : y + 15);
}
function drawDets(ctx, dets, W, H, colorFor) {
  for (const d of dets) {
    const [x, y, w, h] = d.box, c = colorFor(d);
    ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.strokeRect(x * W, y * H, w * W, h * H);
    tag(ctx, `${d.label} ${d.score.toFixed(2)}`, x * W, Math.max(20, y * H), c);
  }
}
function banner(ctx, W, text, sub) {
  ctx.fillStyle = 'rgba(8,12,18,.72)'; ctx.fillRect(0, 0, W, 50);
  ctx.fillStyle = '#ffd54a'; ctx.font = '700 16px system-ui, sans-serif'; ctx.fillText(text, 12, 21);
  ctx.fillStyle = '#e8eef5'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText(sub, 12, 41);
}

// ---------- UI ----------
const sel = $('scenario');
for (const [id, s] of Object.entries(SCENARIOS)) sel.add(new Option(s.title, id, false, id === scenario));
sel.onchange = () => { scenario = sel.value; t = 0; playing = true; syncUrl(); };
$('play').onclick = () => { playing = !playing; if (playing && t >= T_MAX) t = 0; };
$('scrub').max = T_MAX;
$('scrub').oninput = (e) => { t = Number(e.target.value); playing = false; };
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => { speed = Number(b.dataset.speed); };
function syncUrl() { const u = new URL(location.href); u.searchParams.set('scenario', scenario); history.replaceState(null, '', u); }

const fmtT = (tt) => { const d = Math.round(tt - NOMINAL_ETA); return d < 0 ? `T−${-d}s` : `T+${d}s`; };
const STATUS_TXT = { CLEAR: 'CLEAR', NOT_CLEAR: 'NOT CLEAR', UNKNOWN: 'UNKNOWN' };

function thumb(canvasId, img) {
  const c = $(canvasId); if (!img) { c.getContext('2d').clearRect(0, 0, c.width, c.height); return; }
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
}

function frame() {
  const run = runs[scenario];
  const step = run.steps[Math.max(0, Math.min(run.steps.length - 1, Math.floor(t) || 0))] || run.steps[0];
  const { p, actors } = pose(scenario, t);
  ringR.render(scene, ringCam);
  overR.render(scene, overCam);
  const active = droneActive(scenario, t);
  if (active) droneR.render(scene, droneCam); else { droneR.setClearColor(0x161b22); droneR.clear(); }

  // Ring overlay
  const ro = $('ringOv').getContext('2d'), W = 960, H = 540;
  ro.clearRect(0, 0, W, H);
  drawPoly(ro, RING_POOL, W, H, '#4fc3f7', [6, 5], 'hazard: pool (owner-marked)');
  drawPoly(ro, RING_ZONE, W, H, '#ffd54a', [10, 6], 'drop zone (owner-drawn)');
  const ringDets = detectionsFor(RING_CAM, actors);
  drawDets(ro, ringDets, W, H, () => '#ff8a65');
  banner(ro, W, 'FIXED RING CAMERA · SIMULATED 3D SCENE', 'House wall, 2.4 m up, 110° wide lens · boxes = simulated ground-truth detector');

  // Drone overlay
  const dov = $('droneOv').getContext('2d'), D = 540;
  dov.clearRect(0, 0, D, D);
  if (active) {
    const cam = droneCamAt(p);
    const dDets = detectionsFor(cam, actors);
    drawDets(dov, dDets, D, D, () => '#ff5252');
    const safe = dDets.length === 0;
    banner(dov, D, 'DRONE DOWN-LOOKING CAMERA · SIMULATED', `${cam.pos[1].toFixed(1)} m up, 60° FOV · footprint ≈ ${(2 * cam.pos[1] * Math.tan(Math.PI / 6)).toFixed(1)} m wide`);
    dov.fillStyle = safe ? 'rgba(46,160,67,.9)' : 'rgba(218,54,51,.92)'; dov.fillRect(0, D - 64, D, 64);
    dov.fillStyle = '#fff'; dov.font = '700 18px system-ui, sans-serif';
    dov.fillText(safe ? 'Drone-side check: nothing in view → safe to drop' : `Drone-side check: ${dDets.map((d) => d.label).join(', ')} in view → ABORT`, 12, D - 38);
    dov.font = '13px system-ui, sans-serif'; dov.fillText(droneFootprint(p)[2] < POOL.x0 ? 'The pool is outside this field of view: the drone cannot see it.' : 'Pool at the edge of view now; at 13 ft it drops out of view.', 12, D - 16);
  } else {
    banner(dov, D, 'DRONE DOWN-LOOKING CAMERA · SIMULATED', 'Active only on final approach (≈ 13 ft above the drop point)');
    dov.fillStyle = '#8b949e'; dov.font = '600 18px system-ui, sans-serif';
    const msg = p < P.HOVER_POINT ? `Not yet over the drop point (${String(step?.phase || "approaching").toLowerCase()})` : step?.aborted ? 'Aborted: leaving with the package' : 'Departed';
    dov.fillText(msg, 24, D / 2);
  }
  const oo = $('overOv').getContext('2d');
  oo.clearRect(0, 0, 960, 540);
  banner(oo, 960, 'OVERVIEW (not a sensor) · SIMULATED 3D SCENE', 'Magenta square = drone camera footprint during the final approach');

  // Status panel
  const v = step.verdict;
  $('clock').textContent = `t = ${t.toFixed(1)} s · ${fmtT(t)} vs nominal ETA · ${speed}×`;
  $('scrub').value = t;
  $('play').textContent = playing ? '❚❚ Pause' : '▶ Play';
  document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  $('verdict').textContent = STATUS_TXT[v.status];
  $('verdict').className = `verdict ${v.status}`;
  $('reasons').textContent = v.reasons.map((r) => `${r.code}${r.where ? ` (${r.where})` : ''}`).join(', ') || 'no people, pets or objects in or near the zone';
  const lastAdv = [...run.steps.slice(0, step.t + 1)].reverse().find((s) => s.advisory)?.advisory;
  $('advice').textContent = lastAdv ? `${lastAdv.advice}${lastAdv.reason_codes.length ? ` · ${lastAdv.reason_codes.join(', ')}` : ''}` : 'not polled yet (carrier polls from ≈ T−60 s)';
  $('advice').className = lastAdv?.advice === 'HOLD' ? 'hold' : '';
  $('holds').textContent = `${step.holdsIssued} / 3`;
  $('phase').textContent = step.phase + (step.holding ? ' (hovering on HOLD)' : '');
  $('alt').textContent = `${dronePose(p)[1].toFixed(1)} m`;
  $('events').innerHTML = run.events.filter((e) => e.t <= t).map((e) => `<li class="${e.kind}"><b>${fmtT(e.t)}</b> ${e.text}</li>`).join('');
  $('events').scrollTop = 1e6;

  // Receipt (real findNewObject on rendered 160x90 Ring frames)
  const rc = $('receipt');
  const doneAt = run.tRelease != null ? run.tRelease + 22 : run.tAbort;
  if (doneAt != null && t >= doneAt) {
    const r = receiptFor(scenario);
    rc.hidden = false;
    thumb('before', r.before); thumb('after', r.after);
    const txt = { in_zone: 'Box is inside the drop zone.', hazard: `Box landed next to the ${r.hazard}! Alexa: "Your package landed near the pool."`, outside_zone: 'Box is outside the drop zone.', unknown: 'Drop not confirmed.', not_dropped: 'No drop: the drone aborted and the package goes by ground.' }[r.placement];
    $('receiptText').textContent = `${txt}${r.found?.ok ? ` (change-detection box ${r.found.box.map((n) => n.toFixed(3)).join(', ')})` : ''}`;
    rc.className = `receipt ${r.placement}`;
  } else rc.hidden = true;

  window.__simState = { t, scenario, status: v.status, advice: lastAdv?.advice || null, holds: step.holdsIssued, phase: step.phase, receipt: receipts[scenario] ? { placement: receipts[scenario].placement, hazard: receipts[scenario].hazard } : null };
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) { t += dt * speed; if (t >= T_MAX) { t = T_MAX; playing = false; } }
  frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.sim = {
  seek(tt) { t = Math.max(0, Math.min(T_MAX, tt)); playing = false; frame(); return window.__simState; },
  setScenario(id) { scenario = id; sel.value = id; t = 0; frame(); },
  play() { playing = true; }, pause() { playing = false; },
  receipt: (id = scenario) => { const r = receiptFor(id); return { placement: r.placement, hazard: r.hazard, found: r.found && { ok: r.found.ok, box: r.found.box, reason: r.found.reason } }; },
  runs,
};
