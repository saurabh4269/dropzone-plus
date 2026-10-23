// DropZone 3D simulation page: renders the deterministic model (model.js) with three.js from three cameras,
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
const LIGHT = matchMedia('(prefers-color-scheme: light)');

// ---------- renderers and cameras ----------
function makeRenderer(canvas, w, h) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
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

// ---------- textures (CC0, see ./tex/CREDITS.md) ----------
const loader = new THREE.TextureLoader();
const load = (name) => loader.loadAsync(`./tex/${name}.jpg`);
const [skyT, grassC, grassN, fenceC, fenceN, sidingC, sidingN, patioN, copingC, copingN] = await Promise.all(
  ['sky', 'grass_col', 'grass_nor', 'fence_col', 'fence_nor', 'siding_col', 'siding_nor', 'patio_nor', 'coping_col', 'coping_nor'].map(load));
// tiled(map, repeatX, repeatY, rotation): a per-surface copy so each surface keeps real-world texel size
function tiled(src, rx, ry, rot = 0, color = false) {
  const t = src.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.center.set(0.5, 0.5); t.rotation = rot;
  t.anisotropy = 8; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
const pbr = (src, nor, rx, ry, opts = {}) => new THREE.MeshStandardMaterial({
  map: tiled(src, rx, ry, opts.rot, true), normalMap: tiled(nor, rx, ry, opts.rot), normalScale: new THREE.Vector2(opts.ns ?? 1, opts.ns ?? 1),
  roughness: opts.rough ?? 0.9, metalness: 0, color: opts.tint ?? 0xffffff,
});

// ---------- scene ----------
const scene = new THREE.Scene();
skyT.mapping = THREE.EquirectangularReflectionMapping; skyT.colorSpace = THREE.SRGBColorSpace;
scene.background = skyT;
scene.environment = skyT;
scene.environmentIntensity = 0.7;
scene.backgroundIntensity = 0.95;
scene.fog = new THREE.Fog(0xc4d3e0, 70, 260);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x50602e, 0.35));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-9, 22, 16); sun.target.position.set(0, 0, 8); scene.add(sun, sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });
function box(w, h, d, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z); parent.add(m); return m;
}
function add(geo, material, x, y, z, parent = scene) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y, z); parent.add(m); return m;
}
function onLayer1(o) { o.layers.set(1); o.traverse((c) => c.layers.set(1)); return o; }
// deterministic pseudo-random in [0,1)
const rnd = (i) => { const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return h - Math.floor(h); };

// ground: textured lawn inside the fence with faint mowing stripes, rougher grass outside
const GRASS_M = 1.6; // metres per grass tile
{
  const W = YARD.x1 - YARD.x0, n = 10;
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W / n, YARD.z1),
      pbr(grassC, grassN, W / n / GRASS_M, YARD.z1 / GRASS_M, { tint: i % 2 ? 0xffffff : 0xdfe9cf, rough: 0.95 }));
    s.rotation.x = -Math.PI / 2; s.position.set(YARD.x0 + ((i + 0.5) * W) / n, 0, YARD.z1 / 2); scene.add(s);
  }
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), pbr(grassC, grassN, 400 / 2.4, 400 / 2.4, { tint: 0xbfcf9f, rough: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
}
// patio slab by the house
box(7, 0.05, 2.4, pbr(copingC, copingN, 7 / 2.4, 2.4 / 2.4, { tint: 0xe4e0d8, rough: 0.85 }), -2.5, 0.025, 1.2);

// drop zone: painted 10 x 10 ft square with a centre mark
{
  const [cx, cz] = ZONE_CENTER, s = ZONE_SIZE, w = 0.07, paint = mat(0xf4f4ee, { roughness: 0.7 });
  box(s, 0.01, w, paint, cx, 0.01, cz - s / 2); box(s, 0.01, w, paint, cx, 0.01, cz + s / 2);
  box(w, 0.01, s, paint, cx - s / 2, 0.01, cz); box(w, 0.01, s, paint, cx + s / 2, 0.01, cz);
  const c1 = box(0.9, 0.01, 0.07, paint, cx, 0.011, cz); c1.rotation.y = Math.PI / 4;
  const c2 = box(0.9, 0.01, 0.07, paint, cx, 0.011, cz); c2.rotation.y = -Math.PI / 4;
}
// pool: paver coping frame, tiled basin, glossy water reflecting the sky
{
  const w = POOL.x1 - POOL.x0, d = POOL.z1 - POOL.z0, cx = (POOL.x0 + POOL.x1) / 2, cz = (POOL.z0 + POOL.z1) / 2, c = 0.35;
  const cop = (len, deep, x, z) => box(len, 0.08, deep, pbr(copingC, copingN, len / 1.2, deep / 1.2, { tint: 0xf2efe8, rough: 0.8 }), x, 0.04, z);
  cop(w + 2 * c, c, cx, POOL.z0 - c / 2); cop(w + 2 * c, c, cx, POOL.z1 + c / 2);
  cop(c, d, POOL.x0 - c / 2, cz); cop(c, d, POOL.x1 + c / 2, cz);
  box(w, 0.04, d, mat(0x7fc6dc, { roughness: 0.6 }), cx, 0.0, cz); // basin floor seen through the water
  const water = box(w, 0.02, d, new THREE.MeshPhysicalMaterial({
    color: 0x1f8fbf, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.9, clearcoat: 1, clearcoatRoughness: 0.05,
    normalMap: tiled(patioN, w / 1.5, d / 1.5), normalScale: new THREE.Vector2(0.25, 0.25),
  }), cx, 0.055, cz);
  water.receiveShadow = true;
}
// fence: continuous vertical boards (textured), posts and a top cap
{
  const H = 1.7, BOARD = 1.1; // metres per texture tile
  const panel = (len, x, z, alongX) => {
    const m = pbr(fenceC, fenceN, len / BOARD, H / BOARD, { rot: Math.PI / 2, rough: 0.85, tint: 0xf0e4d6 });
    box(alongX ? len : 0.04, H, alongX ? 0.04 : len, m, x, H / 2, z);
    const cap = mat(0x6e5440, { roughness: 0.8 });
    box(alongX ? len : 0.09, 0.05, alongX ? 0.09 : len, cap, x, H + 0.025, z);
  };
  panel(YARD.x1 - YARD.x0, 0, YARD.z1, true); panel(YARD.z1, YARD.x0, YARD.z1 / 2, false); panel(YARD.z1, YARD.x1, YARD.z1 / 2, false);
  const post = mat(0x6e5440, { roughness: 0.8 });
  for (let x = YARD.x0; x <= YARD.x1 + 1e-6; x += 2.5) box(0.1, H + 0.15, 0.1, post, x, (H + 0.15) / 2, YARD.z1 - 0.05);
  for (let z = 2.5; z <= YARD.z1; z += 2.5) { box(0.1, H + 0.15, 0.1, post, YARD.x0 + 0.05, (H + 0.15) / 2, z); box(0.1, H + 0.15, 0.1, post, YARD.x1 - 0.05, (H + 0.15) / 2, z); }
}
// house wall with lap siding, back door, window, pet door, and the Ring camera on the wall
{
  box(20.4, 3.4, 0.3, pbr(sidingC, sidingN, 20.4 / 1.4, 3.4 / 1.4, { rot: Math.PI / 2, tint: 0xf3ece0, rough: 0.75 }), 0, 1.7, -0.15);
  box(20.8, 0.3, 1.2, mat(0x4a4f55, { roughness: 0.9 }), 0, 3.5, -0.3); // eave
  const trim = mat(0xf7f7f4, { roughness: 0.5 });
  box(1.0, 2.1, 0.06, mat(0x5d4532, { roughness: 0.6 }), -5.4, 1.05, 0.02); // back door
  box(1.16, 0.08, 0.08, trim, -5.4, 2.14, 0.03); box(0.08, 2.14, 0.08, trim, -5.94, 1.07, 0.03); box(0.08, 2.14, 0.08, trim, -4.86, 1.07, 0.03);
  add(new THREE.SphereGeometry(0.035, 12, 8), mat(0xc9a04a, { metalness: 1, roughness: 0.3 }), -5.05, 1.0, 0.07);
  box(1.8, 1.1, 0.04, new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.1, clearcoat: 1 }), 3.2, 1.7, 0.02); // glass
  box(1.96, 0.08, 0.1, trim, 3.2, 2.29, 0.05); box(1.96, 0.1, 0.12, trim, 3.2, 1.11, 0.06);
  box(0.08, 1.2, 0.1, trim, 2.26, 1.7, 0.05); box(0.08, 1.2, 0.1, trim, 4.14, 1.7, 0.05); box(0.05, 1.1, 0.06, trim, 3.2, 1.7, 0.04);
  box(0.46, 0.56, 0.05, mat(0x3a3a3a, { roughness: 0.5 }), PET_DOOR[0], 0.3, 0.02); box(0.36, 0.44, 0.06, mat(0x5b6770, { roughness: 0.3, transparent: true, opacity: 0.9 }), PET_DOOR[0], 0.28, 0.03);
  const cam = new THREE.Group();
  box(0.12, 0.16, 0.08, mat(0x1d2127, { roughness: 0.4 }), 0, 0, 0, cam);
  add(new THREE.CircleGeometry(0.025, 16), mat(0x0a0c10, { roughness: 0.1 }), 0, 0.02, 0.041, cam);
  cam.position.set(RING_CAM.pos[0], RING_CAM.pos[1], 0.04); scene.add(cam);
}
// planting: hedge-like shrub clusters along the fence and a few trees beyond it
function bush(x, y, z, r, seed, parent = scene) {
  const g = new THREE.Group();
  const greens = [0x35602a, 0x3f6f2f, 0x2f5524, 0x4a7a34];
  const n = 4 + Math.floor(rnd(seed) * 3);
  for (let k = 0; k < n; k++) {
    const geo = new THREE.IcosahedronGeometry(r * (0.55 + rnd(seed + k) * 0.45), 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const f = 1 + (rnd(seed * 31 + i) - 0.5) * 0.18; pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f); }
    geo.computeVertexNormals();
    const a = rnd(seed + k * 7) * Math.PI * 2, d = r * 0.55 * rnd(seed + k * 3);
    add(geo, mat(greens[(seed + k) % 4], { roughness: 0.95 }), Math.cos(a) * d, r * (0.6 + rnd(seed + k * 5) * 0.4), Math.sin(a) * d, g);
  }
  g.position.set(x, y, z); parent.add(g); return g;
}
for (let i = 0; i < 16; i++) bush(-9.2 + i * 1.22, 0, 17.35 - (i % 2) * 0.25, 0.55 + rnd(i) * 0.25, i + 1);
for (let i = 0; i < 6; i++) { bush(-9.35, 0, 9 + i * 1.4, 0.5 + rnd(i + 40) * 0.2, i + 40); bush(9.35, 0, 11 + i * 1.2, 0.5 + rnd(i + 60) * 0.2, i + 60); }
function tree(x, z, h, seed) {
  add(new THREE.CylinderGeometry(0.12, 0.18, h * 0.55, 10), mat(0x5a4330, { roughness: 1 }), x, h * 0.275, z);
  bush(x, h * 0.42, z, h * 0.28, seed);
}
[[-7, 22, 7, 3], [-1.5, 24, 8.5, 9], [5, 21.5, 6.5, 17], [11.5, 19, 7.5, 23], [-12.5, 15, 6, 29]].forEach(([x, z, h, s]) => tree(x, z, h, s));

// ---------- actors ----------
const cap = (r, len, color, x, y, z, parent, rz = 0, rx = 0) => {
  const m = add(new THREE.CapsuleGeometry(r, len, 6, 14), color, x, y, z, parent); m.rotation.z = rz; m.rotation.x = rx; return m;
};
function makeDog() {
  // golden retriever-ish: capsule body, legs, head with snout and ears; faces +x
  const g = new THREE.Group(), fur = mat(0xb98446, { roughness: 0.95 }), dark = mat(0x2a1d14, { roughness: 0.6 }), light = mat(0xd2a466, { roughness: 0.95 });
  cap(0.15, 0.42, fur, 0, 0.47, 0, g, Math.PI / 2);
  cap(0.12, 0.12, light, 0.28, 0.58, 0, g, -0.9); // chest / neck
  add(new THREE.SphereGeometry(0.13, 18, 14), fur, 0.42, 0.7, 0, g);
  cap(0.065, 0.1, light, 0.55, 0.66, 0, g, Math.PI / 2);
  add(new THREE.SphereGeometry(0.03, 10, 8), dark, 0.64, 0.67, 0, g);
  for (const z of [-0.1, 0.1]) { const e = cap(0.045, 0.1, mat(0x9a6a36, { roughness: 0.95 }), 0.38, 0.66, z, g, 0.2); e.rotation.x = z > 0 ? 0.35 : -0.35; }
  for (const [x, z] of [[0.2, 0.08], [0.2, -0.08], [-0.22, 0.08], [-0.22, -0.08]]) cap(0.05, 0.24, fur, x, 0.17, z, g);
  cap(0.035, 0.28, fur, -0.42, 0.62, 0, g, 0.9);
  scene.add(g); return g;
}
function makeKid() {
  // child in a red hoodie and jeans, no face detail
  const g = new THREE.Group(), hoodie = mat(0xc63a3a, { roughness: 0.9 }), jeans = mat(0x34507e, { roughness: 0.9 }), skin = mat(0xd9a77f, { roughness: 0.7 });
  cap(0.15, 0.3, hoodie, 0, 0.78, 0, g);
  for (const z of [-0.2, 0.2]) cap(0.05, 0.32, hoodie, 0, 0.76, z, g, 0, z > 0 ? -0.12 : 0.12);
  add(new THREE.SphereGeometry(0.12, 18, 14), skin, 0, 1.16, 0, g);
  const hair = add(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0x3b2a1e, { roughness: 0.9 }), 0, 1.17, 0, g); hair.rotation.z = 0.25;
  for (const z of [-0.07, 0.07]) { cap(0.06, 0.34, jeans, 0, 0.3, z, g); box(0.16, 0.06, 0.09, mat(0xeeeeee, { roughness: 0.6 }), 0.03, 0.03, z, g); }
  scene.add(g); return g;
}
function makeUmbrella() {
  const g = new THREE.Group(), metal = mat(0xd8dadc, { metalness: 0.8, roughness: 0.35 });
  add(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 10), metal, 0, 1.05, 0, g);
  const c = add(new THREE.ConeGeometry(1.15, 0.45, 16, 1, true), mat(0xe9e2d0, { side: THREE.DoubleSide, roughness: 0.95 }), 0, 2.05, 0, g);
  c.castShadow = true;
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 24), mat(0xf4f4f2, { roughness: 0.4 }), 0, 0.72, 0, g); // little table
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10), metal, 0, 0.36, 0, g);
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), metal, 0, 0.01, 0, g);
  scene.add(g); return g;
}
const actorMeshes = { dog: makeDog(), kid: makeKid(), umbrella: makeUmbrella() };

function makeDrone() {
  const g = new THREE.Group(), shell = mat(0xeef1f4, { roughness: 0.35, metalness: 0.1 }), grey = mat(0x3d444c, { roughness: 0.5, metalness: 0.3 });
  const body = add(new THREE.SphereGeometry(0.4, 24, 16), shell, 0, 0, 0, g); body.scale.set(1, 0.32, 1);
  add(new THREE.CylinderGeometry(0.16, 0.18, 0.1, 18), grey, 0, -0.14, 0, g);
  const rotors = [];
  for (const [x, z] of [[0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]]) {
    const arm = add(new THREE.CylinderGeometry(0.035, 0.035, 1.06, 10), grey, x / 2, 0.03, z / 2, g);
    arm.rotation.z = Math.PI / 2; arm.rotation.y = Math.atan2(-z, x); arm.rotation.order = 'YZX';
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 14), grey, x, 0.06, z, g);
    const r = add(new THREE.CylinderGeometry(0.42, 0.42, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.28, roughness: 0.5, depthWrite: false }), x, 0.12, z, g);
    rotors.push(r);
    add(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: x > 0 ? 0x2ecc71 : 0xe74c3c, emissive: x > 0 ? 0x2ecc71 : 0xe74c3c, emissiveIntensity: 1.5 }), x, -0.01, z, g);
  }
  const cardboard = mat(0xb68b5a, { roughness: 0.95 });
  const pkg = box(0.5, 0.3, 0.4, cardboard, 0, -0.45, 0, g);
  box(0.51, 0.31, 0.06, mat(0x8a6236, { roughness: 0.7 }), 0, 0, 0, pkg);
  scene.add(g); return { g, rotors, pkg };
}
const drone = makeDrone();
const groundBox = box(0.5, 0.3, 0.4, mat(0xb68b5a, { roughness: 0.95 }), 0, 0, 0); groundBox.visible = false;
const tape = box(0.51, 0.31, 0.06, mat(0x8a6236, { roughness: 0.7 }), 0, 0, 0, groundBox); tape.visible = true;

// shadows: everything solid casts and receives (sprites, particles and lines excluded)
scene.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

// downwash: ground ring + dust/grass particles
const washRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
washRing.rotation.x = -Math.PI / 2; scene.add(washRing);
const N_PART = 260;
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_PART * 3), 3));
const parts = new THREE.Points(partGeo, new THREE.PointsMaterial({ color: 0xc9d6a8, size: 0.06, transparent: true, opacity: 0.85, depthWrite: false }));
scene.add(parts);
// real shadow mapping now draws the drone's shadow; keep a faint contact blur only when it is low
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false }));
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
  shadow.visible = dy < 14; shadow.position.set(dx, 0.015, dz); shadow.material.opacity = 0.14 * Math.max(0, 1 - dy / 8);
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
rt.texture.colorSpace = THREE.SRGBColorSpace;
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
  const lt = LIGHT.matches;
  ctx.fillStyle = lt ? 'rgba(255,255,255,.84)' : 'rgba(8,12,18,.72)'; ctx.fillRect(0, 0, W, 50);
  ctx.fillStyle = lt ? '#121821' : '#ffd54a'; ctx.font = '700 16px system-ui, sans-serif'; ctx.fillText(text, 12, 21);
  ctx.fillStyle = lt ? '#3d4756' : '#e8eef5'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText(sub, 12, 41);
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
  if (active) droneR.render(scene, droneCam); else { droneR.setClearColor(LIGHT.matches ? 0xdfe5ec : 0x2a3038); droneR.clear(); }

  // Ring overlay
  const ro = $('ringOv').getContext('2d'), W = 960, H = 540;
  ro.clearRect(0, 0, W, H);
  drawPoly(ro, RING_POOL, W, H, '#4fc3f7', [6, 5], 'hazard: pool (owner-marked)');
  drawPoly(ro, RING_ZONE, W, H, '#ffd54a', [10, 6], 'drop zone (owner-drawn)');
  const ringDets = detectionsFor(RING_CAM, actors);
  drawDets(ro, ringDets, W, H, () => '#ff8a65');
  banner(ro, W, 'FIXED RING CAMERA', 'House wall, 2.4 m up, 110° wide lens · boxes = ground-truth detector from the model');

  // Drone overlay
  const dov = $('droneOv').getContext('2d'), D = 540;
  dov.clearRect(0, 0, D, D);
  if (active) {
    const cam = droneCamAt(p);
    const dDets = detectionsFor(cam, actors);
    drawDets(dov, dDets, D, D, () => '#ff5252');
    const safe = dDets.length === 0;
    banner(dov, D, 'DRONE DOWN-LOOKING CAMERA', `${cam.pos[1].toFixed(1)} m up, 60° FOV · footprint ≈ ${(2 * cam.pos[1] * Math.tan(Math.PI / 6)).toFixed(1)} m wide`);
    dov.fillStyle = safe ? 'rgba(46,160,67,.9)' : 'rgba(218,54,51,.92)'; dov.fillRect(0, D - 64, D, 64);
    dov.fillStyle = '#fff'; dov.font = '700 18px system-ui, sans-serif';
    dov.fillText(safe ? 'Drone-side check: nothing in view → safe to drop' : `Drone-side check: ${dDets.map((d) => d.label).join(', ')} in view → ABORT`, 12, D - 38);
    dov.font = '13px system-ui, sans-serif'; dov.fillText(droneFootprint(p)[2] < POOL.x0 ? 'The pool is outside this field of view: the drone cannot see it.' : 'Pool at the edge of view now; at 13 ft it drops out of view.', 12, D - 16);
  } else {
    banner(dov, D, 'DRONE DOWN-LOOKING CAMERA', 'Active only on final approach (≈ 13 ft above the drop point)');
    dov.fillStyle = LIGHT.matches ? '#5b6675' : '#8b949e'; dov.font = '600 18px system-ui, sans-serif';
    const msg = p < P.HOVER_POINT ? `Not yet over the drop point (${String(step?.phase || "approaching").toLowerCase()})` : step?.aborted ? 'Aborted: leaving with the package' : 'Departed';
    dov.fillText(msg, 24, D / 2);
  }
  const oo = $('overOv').getContext('2d');
  oo.clearRect(0, 0, 960, 540);
  banner(oo, 960, 'OVERVIEW (not a sensor)', 'Magenta square = drone camera footprint during the final approach');

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
