// DropZone+ homeowner app (PWA). Hash-routed, no framework. Data stays on this device (localStorage).
// Ring access goes through the DropZone+ backend (Ring requires server-to-server calls; browsers are blocked by CORS).
// On static hosting there is no backend, so the app runs a clearly labelled demo home.

import { evaluateZone, freshen, auditZone, suggestZone, polygonCentroid, STATUS } from '../core/zone.js';
import { createSession, PHASE } from '../core/engine.js';
import { findNewObject } from '../core/changes.js';
import { W, H, drawYard, drawActor, drawPolygon, drawDetections, drawDrone, drawPackage, drawUnreadable } from '../scene.js';
import { loadDetector, detect } from '../detector.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDur = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------- store ----------------
const KEY = 'dropzone.app.v1';
const DEFAULTS = {
  onboarded: false,
  connection: null,        // { mode: 'demo' | 'live', method: 'demo' | 'oauth' | 'playground-token' | 'env-token', at }
  camera: null,            // { id, name }
  zones: [],               // { id, name, desc, polygon, hazards, cameraId, isDefault, createdAt }
  partners: {},            // { [id]: { linked, zoneId, shareInstructions, linkedAt } }
  settings: { notifications: false, alexa: true, petDoor: true, theme: 'system', speak: false },
  deliveries: [],          // receipts + proof images
};
const store = {
  data: (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return structuredClone(DEFAULTS); } })(),
  save() { localStorage.setItem(KEY, JSON.stringify(this.data)); },
  set(patch) { Object.assign(this.data, patch); this.save(); },
};
const S = () => store.data;

// ---------------- example partners (fictional, simulated) ----------------
const PARTNERS = [
  { id: 'skyhop', name: 'SkyHop Air', blurb: 'Groceries and pharmacy by drone, 30-minute windows.', color: '#7c5cff' },
  { id: 'parcelwing', name: 'ParcelWing', blurb: 'Small parcels from local stores, same day.', color: '#ff8a3d' },
  { id: 'neighborly', name: 'Neighborly Drone Co-op', blurb: 'Community-run deliveries between neighbours.', color: '#2fbf71' },
];

// ---------------- backend / camera ----------------
const env = { server: false, config: null };

async function probeServer() {
  try {
    const r = await fetch('../api/config', { cache: 'no-store' });
    if (r.ok) { env.server = true; env.config = await r.json(); }
  } catch { /* static hosting */ }
}

const DEMO_CAMERAS = [
  { id: 'demo-backyard', name: 'Backyard Cam', online: true },
  { id: 'demo-front', name: 'Front Door', online: false },
];
const isDemo = () => S().connection?.mode !== 'live';

async function listCameras() {
  if (isDemo()) return { devices: DEMO_CAMERAS };
  const r = await fetch('../api/ring/devices');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

// Demo yard: a drawn scene (simulated), with actors placed relative to the user's own zone.
const demo = { t: 0, actors: [], dropAt: null };
function demoActors(zone) {
  const [cx, cy] = zone ? polygonCentroid(zone) : [0.53, 0.69];
  const fy = cy + 0.03;
  return [
    { id: 'dog', label: 'dog', emoji: '🐕', size: 0.085, keys: [[0, cx, fy], [60, cx + 0.03, fy - 0.01], [120, cx - 0.02, fy + 0.01], [150, (cx + 0.13) / 2, (fy + 0.44) / 2], [200, 0.13, 0.44]], visible: [[0, 205]] },
    { id: 'kid', label: 'person', emoji: '🧒', size: 0.16, keys: [[380, 1.02, fy + 0.04], [415, cx + 0.07, fy + 0.03], [430, cx, fy + 0.02], [450, cx - 0.15, Math.min(0.95, fy + 0.16)], [480, 0.10, 0.95]], visible: [[380, 480]] },
  ];
}
function actorPos(a, t) {
  if (!a.visible.some(([x, y]) => t >= x && t <= y)) return null;
  const k = a.keys;
  if (t <= k[0][0]) return [k[0][1], k[0][2]];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const f = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return [k[i - 1][1] + (k[i][1] - k[i - 1][1]) * f, k[i - 1][2] + (k[i][2] - k[i - 1][2]) * f]; }
  return [k[k.length - 1][1], k[k.length - 1][2]];
}
const actorSize = (a, y) => a.size * (0.55 + 0.75 * y);
function demoDetections() {
  return demo.actors.flatMap((a) => {
    const p = actorPos(a, demo.t); if (!p || p[0] < 0 || p[0] > 1) return [];
    const s = actorSize(a, p[1]); const w = a.label === 'person' ? s * 0.55 : s;
    return [{ label: a.label, score: 0.9, box: [p[0] - w / 2, p[1] - s, w, s] }];
  });
}
function drawDemoYard(ctx, { withActors = true, packageAt = null } = {}) {
  drawYard(ctx);
  if (withActors) for (const a of demo.actors) { const p = actorPos(a, demo.t); if (p) drawActor(ctx, a.emoji, p[0], p[1], actorSize(a, p[1])); }
  if (packageAt) drawPackage(ctx, packageAt[0], packageAt[1]);
}

/** A still frame of the camera: { img (canvas|Image), observedAt, readable, reason, source } */
async function grabFrame(cameraId = S().camera?.id) {
  if (isDemo()) {
    if (cameraId === 'demo-front') return { readable: false, reason: 'This camera is offline (simulated).', observedAt: Date.now(), source: 'demo' };
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    drawDemoYard(c.getContext('2d'), { packageAt: delivery.droppedAt ? delivery.dropPoint : null });
    return { img: c, observedAt: Date.now(), readable: true, source: 'demo (simulated)' };
  }
  if (liveFrame?.video?.videoWidth) { // live WHEP stream running: analyse the current frame (always fresh)
    const v = liveFrame.video;
    const c = Object.assign(document.createElement('canvas'), { width: v.videoWidth, height: v.videoHeight });
    c.getContext('2d').drawImage(v, 0, 0);
    return { img: c, observedAt: Date.now(), readable: true, source: 'ring-live' };
  }
  try {
    const r = await fetch(`../api/ring/snapshot?device=${encodeURIComponent(cameraId)}`, { cache: 'no-store' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return { readable: false, reason: j.reason || `Ring snapshot unavailable (HTTP ${r.status})`, observedAt: Date.now(), source: 'ring-snapshot' }; }
    const observedAt = Date.parse(r.headers.get('X-Observed-At')) || Date.now();
    const img = await loadImg(URL.createObjectURL(await r.blob()));
    return { img, observedAt, readable: true, source: 'ring-snapshot' };
  } catch (e) { return { readable: false, reason: e.message, observedAt: Date.now(), source: 'ring-snapshot' }; }
}
function loadImg(url) { return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('image failed to load')); i.src = url; }); }
const imgW = (i) => i.naturalWidth || i.videoWidth || i.width;
const imgH = (i) => i.naturalHeight || i.videoHeight || i.height;
function fit(iw, ih) { const k = Math.min(W / iw, H / ih); return [(W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k]; }

/** Score a frame against a zone. Demo frames use scripted detections (labelled); live frames run COCO-SSD. */
async function scoreFrame(frame, zone) {
  if (!frame.readable) return evaluateZone({ detections: [], zone: zone.polygon, observedAt: frame.observedAt, media: { readable: false, reason: frame.reason }, source: frame.source });
  let detections;
  if (isDemo()) detections = demoDetections();
  else if (env.config?.vision?.rekognition?.enabled) { // AWS path: Amazon Rekognition on the server
    const c = document.createElement('canvas'); c.width = imgW(frame.img); c.height = imgH(frame.img); c.getContext('2d').drawImage(frame.img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const r = await fetch('../api/vision/rekognition', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (r.ok) { const [x, y, w, h] = fit(imgW(frame.img), imgH(frame.img)); detections = r.detections.map((d) => ({ ...d, box: [(x + d.box[0] * w) / W, (y + d.box[1] * h) / H, (d.box[2] * w) / W, (d.box[3] * h) / H] })); }
  }
  if (!isDemo() && !detections) {
    await loadDetector();
    const [x, y, w, h] = fit(imgW(frame.img), imgH(frame.img));
    detections = (await detect(frame.img)).map((p) => ({ label: p.class, score: p.score, box: [(x + p.bbox[0] * w / imgW(frame.img)) / W, (y + p.bbox[1] * h / imgH(frame.img)) / H, (p.bbox[2] * w / imgW(frame.img)) / W, (p.bbox[3] * h / imgH(frame.img)) / H] }));
  }
  const v = evaluateZone({ detections, zone: zone.polygon, observedAt: frame.observedAt, source: frame.source });
  v.scripted = isDemo();
  return v;
}

function paintFrame(ctx, frame, { zone, verdict, ghost, hazards, extra } = {}) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!frame) drawUnreadable(ctx, 'Loading camera…');
  else if (!frame.readable) drawUnreadable(ctx, frame.reason);
  else if (frame.live) frame.live(ctx);
  else ctx.drawImage(frame.img, ...fit(imgW(frame.img), imgH(frame.img)));
  for (const h of hazards || zone?.hazards || []) drawPolygon(ctx, h.polygon, { stroke: '#4cc3ff', fill: 'rgba(76,195,255,.15)', dash: [4, 4], label: h.kind });
  if (ghost) drawPolygon(ctx, ghost, { stroke: 'rgba(255,255,255,.9)', dash: [3, 6], width: 3, label: 'SUGGESTED', labelColor: '#111', labelBelow: true });
  if (zone) {
    const st = verdict ? freshen(verdict).status : null;
    const col = st === STATUS.CLEAR ? '#2fbf71' : st === STATUS.NOT_CLEAR ? '#ff5a4f' : st === STATUS.UNKNOWN ? '#f0b429' : '#1aa3ff';
    drawPolygon(ctx, zone.polygon, { stroke: col, fill: col + '22', dash: [12, 8], width: 5, label: zone.name.toUpperCase(), labelColor: '#111', labelBelow: true });
  }
  if (verdict && verdict.status !== STATUS.UNKNOWN) drawDetections(ctx, verdict.objects, { scripted: verdict.scripted });
  extra?.(ctx);
}

// ---------------- notifications / speech ----------------
async function notify(title, body) {
  if (!S().settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification(title, { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: 'dropzone' });
  else new Notification(title, { body });
}
function speak(text) {
  if (!S().settings.speak || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel(); speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { rate: 1.05 }));
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800); }

// ---------------- sheet ----------------
function openSheet(html, bind) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; bind?.($('#sheetBody')); $('#sheetBody').querySelector('button, a, input')?.focus(); }
function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; }
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

// ---------------- delivery (simulated partner, real or demo camera) ----------------
const delivery = { session: null, partner: null, zone: null, speed: 1, clock: null, timer: null, alexa: [], beforeFrame: null, droppedAt: null, dropPoint: null, lastVerdict: null };

function dNow() { return delivery.clock ? delivery.clock.base + (performance.now() - delivery.clock.real) * delivery.speed : Date.now(); }

function startDelivery(partnerId) {
  const zone = defaultZone();
  const partner = PARTNERS.find((p) => p.id === partnerId);
  stopDelivery();
  Object.assign(delivery, { partner, zone, speed: isDemo() ? 10 : 1, clock: { base: Date.now(), real: performance.now() }, alexa: [], beforeFrame: null, droppedAt: null, dropPoint: null, lastVerdict: null, lastNotified: null });
  delivery.dropPoint = (() => { const [cx, cy] = polygonCentroid(zone.polygon); return [cx, cy + 0.03]; })();
  demo.t = 0; demo.actors = demoActors(zone.polygon);
  delivery.session = createSession({
    zone: zone.polygon, hazards: zone.hazards || [], household: { hasPetDoor: S().settings.petDoor }, now: dNow,
    emit: (type, e) => onDeliveryEvent(type, e),
  });
  const etaMin = isDemo() ? 8 : 3;
  look().then(() => delivery.session.startDelivery({ etaAt: dNow() + etaMin * 60000, carrier: `${partner.name} (example, simulated)` }));
  let lastLook = 0;
  delivery.timer = setInterval(async () => {
    if (isDemo()) demo.t = (dNow() - delivery.clock.base) / 1000;
    const s = delivery.session.state;
    const lookEvery = isDemo() ? 10000 : 30000;
    if ((s.phase === PHASE.INBOUND || s.phase === PHASE.HOLDING) && dNow() - lastLook > lookEvery) { lastLook = dNow(); look(); }
    delivery.session.tick();
    if (s.phase === PHASE.DELIVERED && !s.receipt && !delivery.proofing && dNow() - delivery.droppedAt > 5000) proofOfDrop();
    renderLive();
  }, 250);
  renderRoute();
}
function stopDelivery() { clearInterval(delivery.timer); delivery.session = null; delivery.timer = null; }

async function look() {
  const z = delivery.zone || defaultZone();
  const frame = await grabFrame();
  delivery.lastFrame = frame;
  const v = await scoreFrame(frame, z);
  if (delivery.session) delivery.session.observe(v);
  delivery.lastVerdict = v;
  if (env.server) { // the server derives the carrier advisory (GET /api/v1/advisory) from this
    const st = delivery.session?.state;
    fetch('../api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: v, delivery: st?.delivery || null, holdsIssued: st?.holdsIssued || 0 }) }).catch(() => {});
  }
  return v;
}

async function onDeliveryEvent(type, e) {
  if (type === 'alexa' && e.kind === 'speech') {
    delivery.alexa.unshift({ at: dNow(), text: e.speech, prompt: e.prompt });
    if (S().settings.alexa) speak(e.speech);
    if (e.prompt) notify('Drone delivery', e.speech);
  }
  if (type === 'verdict' && e.verdict.status === STATUS.NOT_CLEAR && delivery.lastNotified !== 'NOT_CLEAR') { delivery.lastNotified = 'NOT_CLEAR'; notify('Drop zone not clear', e.verdict.reasons.map((r) => r.label || r.code).join(', ')); }
  if (type === 'verdict' && e.verdict.status !== STATUS.NOT_CLEAR) delivery.lastNotified = e.verdict.status;
  if (type === 'carrier' && e.kind === 'final-approach') {
    const f = await grabFrame(); if (f.readable) delivery.beforeFrame = small(f);
  }
  if (type === 'carrier' && e.kind === 'dropped') delivery.droppedAt = dNow();
  if (type === 'carrier' && e.kind === 'hold') notify('Drone holding', `${delivery.partner.name} (example) is waiting: ${e.advisory.reason_codes.join(', ')}`);
  renderLive();
}

const SW = 160, SH = 90;
function small(frame) {
  const c = Object.assign(document.createElement('canvas'), { width: SW, height: SH });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000'; x.fillRect(0, 0, SW, SH);
  const [a, b, w, h] = fit(imgW(frame.img), imgH(frame.img));
  x.drawImage(frame.img, a * SW / W, b * SH / H, w * SW / W, h * SH / H);
  return x.getImageData(0, 0, SW, SH);
}

async function proofOfDrop() {
  delivery.proofing = true;
  const z = delivery.zone;
  const after = await grabFrame();
  delivery.lastFrame = after; // the home tile shows the proof frame
  let found = { ok: false, reason: after.readable ? 'NO_REFERENCE_FRAME' : 'MEDIA_UNREADABLE' };
  if (after.readable && delivery.beforeFrame) found = findNewObject(delivery.beforeFrame, small(after), { zone: z.polygon, hazards: z.hazards || [] });
  // proof image: the after-frame with the zone and found box drawn on it
  let image = null;
  if (after.readable) {
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    paintFrame(c.getContext('2d'), after, { zone: z, extra: (ctx) => { if (found.ok) { const b = found.box; ctx.strokeStyle = '#3ee6ff'; ctx.lineWidth = 6; ctx.strokeRect(b[0] * W - 6, b[1] * H - 6, b[2] * W + 12, b[3] * H + 12); } } });
    const t = Object.assign(document.createElement('canvas'), { width: 480, height: 270 });
    t.getContext('2d').drawImage(c, 0, 0, 480, 270);
    image = t.toDataURL('image/jpeg', 0.72);
  }
  const r = delivery.session.recordDrop({ packageBox: found.ok ? found.box : null, observedAt: after.observedAt, source: after.source, method: 'change-detection', detail: found.ok ? null : found.reason });
  const rec = { id: uid(), at: Date.now(), partner: delivery.partner.name, partnerId: delivery.partner.id, zoneName: z.name, demo: isDemo(), receipt: r, image };
  S().deliveries.unshift(rec); S().deliveries = S().deliveries.slice(0, 30); store.save();
  notify('Package delivered', placementText(r));
  delivery.proofing = false;
  renderRoute();
}
const placementText = (r) => ({ in_zone: 'Landed inside your drop zone', outside_zone: 'Landed outside your drop zone', hazard: `Landed next to the ${r.hazard}`, unknown: 'Couldn’t confirm where it landed. Take a look.' })[r.placement];

// ---------------- zones ----------------
const defaultZone = () => S().zones.find((z) => z.isDefault) || S().zones[0] || null;

// ---------------- router ----------------
const routes = {};
function go(hash) { location.hash = hash; }
function setChrome({ title = 'DropZone+', tab = null, back = null, right = '' } = {}) {
  const onb = !tab && !back;
  $('#appbar').hidden = onb; $('#tabbar').hidden = !tab;
  $('#title').textContent = title;
  $('#backBtn').hidden = !back; $('#backBtn').onclick = () => (back === true ? history.back() : go(back));
  $('#appbarRight').innerHTML = right;
  document.querySelectorAll('.tabbar a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}
const ringLabel = () => (S().connection?.method === 'playground-token' ? 'Ring Playground' : env.config?.ring?.official === false ? 'mock Ring API' : 'Ring');
function connBadge() {
  const c = S().connection;
  if (!c) return '';
  return c.mode === 'live' ? `<span class="badge live">${ringLabel()} · live</span>` : '<span class="badge sim">Demo home · simulated</span>';
}
let cleanup = null;
function renderRoute() {
  cleanup?.(); cleanup = null;
  const [path, query] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const inOnboarding = parts[0] === 'onboarding' || (parts[0] === 'zones' && /onboarding=1/.test(query || ''));
  if (!S().onboarded && !inOnboarding) return go('#/onboarding/welcome');
  const key = parts[0] || 'home';
  const fn = routes[key] || routes.home;
  cleanup = fn(parts.slice(1), new URLSearchParams(query || '')) || null;
  $('#view').scrollTop = 0;
}
window.addEventListener('hashchange', () => { closeSheet(); renderRoute(); });
const view = (html) => { $('#view').innerHTML = html; return $('#view'); };
const viewEl = () => $('#view');

// ---------------- onboarding ----------------
const STEPS = ['welcome', 'connect', 'camera', 'permissions', 'zone', 'done'];
const progress = (step) => `<div class="progress" aria-label="Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}">${STEPS.map((s, i) => `<span class="${i <= STEPS.indexOf(step) ? 'on' : ''}"></span>`).join('')}</div>`;

routes.onboarding = ([step = 'welcome'], q) => {
  setChrome({});
  if (step === 'welcome') {
    view(`<section class="onb">${progress(step)}
      <img class="hero-icon" src="./icons/icon.svg" alt="" />
      <h2>Make your yard drone-ready</h2>
      <p class="mute">DropZone+ uses your Ring camera to check your drop spot before a delivery drone arrives.</p>
      <div class="value"><div class="i">◎</div><div><b>Save your drop spots</b><div class="mute small">Mark them on your camera view, like saved addresses.</div></div></div>
      <div class="value"><div class="i">🐕</div><div><b>Get a heads-up in time</b><div class="mute small">“Drone in 8 min, the dog is in the drop zone.”</div></div></div>
      <div class="value"><div class="i">⏸</div><div><b>Your drone partner waits if it’s busy</b><div class="mute small">They only ever get “hold” or nothing. Never video.</div></div></div>
      <div class="grow"></div>
      <div class="stack"><button class="primary block" id="go">Get started</button><a class="btn block ghost" href="../">What is DropZone+?</a></div>
    </section>`);
    $('#go').onclick = () => go('#/onboarding/connect');
    return;
  }
  if (step === 'connect') {
    const oauth = env.config?.oauth?.available;
    view(`<section class="onb">${progress(step)}
      <h2>Connect your Ring camera</h2>
      <p class="mute">You’ll sign in at Ring and choose which cameras DropZone+ can use. We never see your Ring password, and you can disconnect at any time.</p>
      <div class="stack">
        <button class="option ${oauth ? 'recommended' : ''}" id="oauth" ${oauth ? '' : 'disabled'}><span class="i">🔗</span><span><b>Link Ring account</b><span class="mute small">${oauth ? 'Opens Ring to approve access and pick cameras.' : 'Available once DropZone+ is listed in the Ring Appstore. Needs Ring partner credentials, which this build doesn’t have.'}</span></span></button>
        <button class="option" id="token" ${env.server ? '' : 'disabled'}><span class="i">🧪</span><span><b>Use a Ring Developer Playground token</b><span class="mute small">${env.server ? 'For developers: a simulated Ring doorbell. Tokens last about 30 minutes.' : 'Needs the DropZone+ server running on your computer (see README).'}</span></span></button>
        <button class="option recommended" id="demo"><span class="i">🏡</span><span><b>Try a demo home</b><span class="mute small">A simulated backyard camera. Nothing real is connected.</span></span></button>
      </div>
      <div class="grow"></div>
    </section>`);
    $('#oauth').onclick = () => { location.href = '../auth/ring/start'; };
    $('#demo').onclick = () => { store.set({ connection: { mode: 'demo', method: 'demo', at: Date.now() } }); go('#/onboarding/camera'); };
    $('#token').onclick = () => openSheet(`<h3>Ring Developer Playground</h3>
      <p class="mute small">Open developer.amazon.com/ring/console/playground, copy the access token and paste it here. It stays in the DropZone+ server’s memory on this computer only, and expires after about 30 minutes.</p>
      <label class="field">Access token<input type="password" id="tok" autocomplete="off" placeholder="Paste token" /></label>
      <p class="small" id="tokErr" style="color:var(--bad)"></p>
      <div class="btns"><button id="cancel">Cancel</button><button class="primary" id="save">Connect</button></div>`, (el) => {
      $('#cancel', el).onclick = closeSheet;
      $('#save', el).onclick = async () => {
        $('#save', el).disabled = true;
        const r = await fetch('../api/ring/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: $('#tok', el).value }) }).catch((e) => ({ ok: false, json: async () => ({ error: e.message }) }));
        if (!r.ok) { $('#tokErr', el).textContent = (await r.json()).error || 'Could not connect.'; $('#save', el).disabled = false; return; }
        store.set({ connection: { mode: 'live', method: 'playground-token', at: Date.now() } });
        closeSheet(); go('#/onboarding/linked?ok=1');
      };
    });
    return;
  }
  if (step === 'linked') {
    const ok = q.get('ok');
    if (ok && !S().connection) store.set({ connection: { mode: 'live', method: 'oauth', at: Date.now() } });
    view(`<section class="onb">${progress('connect')}
      <div class="empty"><div class="big">${ok ? '✅' : '⚠️'}</div><h2>${ok ? 'Ring connected' : 'Ring wasn’t connected'}</h2>
      <p class="mute">${ok ? 'DropZone+ can now see the cameras you shared.' : esc(q.get('error_description') || q.get('error') || 'Something went wrong.') + (q.get('error') === 'access_denied' ? ' If you have no cameras on a Ring plan, add one in the Ring app and try again.' : '')}</p></div>
      <div class="grow"></div><button class="primary block" id="next">${ok ? 'Choose a camera' : 'Back'}</button></section>`);
    $('#next').onclick = () => go(ok ? '#/onboarding/camera' : '#/onboarding/connect');
    return;
  }
  if (step === 'camera') {
    view(`<section class="onb">${progress(step)}<h2>Which camera sees your drop spot?</h2>
      <p class="mute">Pick the camera that looks at the place a drone would land: a lawn, a patio or the driveway.</p>
      <div class="list" id="cams"><div class="item"><span class="mute">Loading cameras…</span></div></div>
      <p class="mute small">To change which cameras are shared, use the Ring app.</p><div class="grow"></div></section>`);
    listCameras().then(({ devices }) => {
      if (!devices.length) { $('#cams').innerHTML = `<div class="empty"><p><b>No Ring cameras are connected to DropZone+ yet.</b></p><p class="mute small">Open the Ring app and add DropZone+ to a camera, then come back.</p></div>`; return; }
      $('#cams').innerHTML = devices.map((d) => `<button class="item" data-id="${esc(d.id)}" data-name="${esc(d.name)}" ${d.online === false ? 'aria-disabled="true"' : ''}><span class="dot ${d.online !== false ? 'on' : ''}"></span><span class="grow"><span class="t">${esc(d.name)}</span><span class="s">${d.online === false ? 'Offline: live view and checks are unavailable until it reconnects.' : 'Online'}${isDemo() ? ' · simulated' : ''}</span></span><span class="chev">›</span></button>`).join('');
      $('#cams').querySelectorAll('button').forEach((b) => (b.onclick = () => { if (b.getAttribute('aria-disabled')) return toast('That camera is offline'); store.set({ camera: { id: b.dataset.id, name: b.dataset.name } }); go('#/onboarding/permissions'); }));
    }).catch((e) => { $('#cams').innerHTML = `<div class="empty"><p><b>Couldn’t reach Ring.</b></p><p class="mute small">${esc(e.message)}. Playground tokens expire after about 30 minutes.</p><button id="retry">Reconnect</button></div>`; $('#retry').onclick = () => go('#/onboarding/connect'); });
    return;
  }
  if (step === 'permissions') {
    const st = S().settings;
    view(`<section class="onb">${progress(step)}<h2>How should we reach you?</h2>
      <div class="list">
        ${toggleRow('notifications', 'Phone notifications', 'When a drone is coming and your zone isn’t clear.', st.notifications)}
        ${toggleRow('alexa', 'Alexa heads-up', 'Simulated Alexa+ add-on: spoken heads-up and quick questions.', st.alexa)}
        ${toggleRow('petDoor', 'Smart pet door', 'Simulated: set to come-in-only, only after you say yes.', st.petDoor)}
      </div><div class="grow"></div><button class="primary block" id="next">Continue</button></section>`);
    bindToggles();
    $('#next').onclick = () => go('#/zones/edit/new?onboarding=1');
    return;
  }
  if (step === 'done') {
    view(`<section class="onb">${progress(step)}<div class="empty"><div class="big">🎉</div><h2>You’re set</h2>
      <p class="mute">“${esc(defaultZone()?.name)}” is your drop spot. Next, link a delivery partner so they can wait when your zone is busy.</p></div>
      <div class="grow"></div><div class="stack"><button class="primary block" id="partners">Link a delivery partner</button><button class="block" id="home">Go to home</button></div></section>`);
    store.set({ onboarded: true });
    $('#partners').onclick = () => go('#/partners');
    $('#home').onclick = () => go('#/home');
  }
};

function toggleRow(key, title, sub, on) {
  return `<div class="item"><span class="grow"><span class="t">${title}</span><span class="s" style="white-space:normal">${sub}</span></span><label class="switch"><input type="checkbox" data-key="${key}" ${on ? 'checked' : ''} aria-label="${title}" /><span></span></label></div>`;
}
function bindToggles(root = document) {
  root.querySelectorAll('input[data-key]').forEach((i) => (i.onchange = async () => {
    const key = i.dataset.key;
    if (key === 'notifications' && i.checked) {
      if (!('Notification' in window)) { toast('Notifications aren’t supported in this browser'); i.checked = false; return; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('Notifications are blocked in your browser settings'); i.checked = false; return; }
    }
    S().settings[key] = i.checked; store.save();
  }));
}

// ---------------- zone editor ----------------
routes.zones = ([sub, id], q) => {
  if (sub === 'edit') return zoneEditor(id, q.get('onboarding') === '1');
  setChrome({ title: 'Drop zones', tab: 'zones', right: connBadge() });
  const zones = S().zones;
  view(`${zones.length ? `<div class="list">${zones.map((z) => `<button class="item" data-id="${z.id}"><img class="thumb" alt="" src="${z.thumb || ''}" /><span class="grow"><span class="t">${esc(z.name)} ${z.isDefault ? '<span class="badge ok">Default</span>' : ''}</span><span class="s">${esc(z.desc || 'No description')}</span></span><span class="chev">›</span></button>`).join('')}</div>` : `<div class="card empty"><div class="big">◎</div><p><b>No drop zones yet</b></p><p class="mute small">Mark the spot on your camera view where a drone should leave packages.</p></div>`}
    <button class="primary block" id="add">＋ Add a drop zone</button>
    <p class="mute small" style="margin-top:12px">Tip: pick open, flat ground about 10 × 10 ft, away from pools, trees and overhangs.</p>`);
  viewEl().querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => go(`#/zones/edit/${b.dataset.id}`)));
  $('#add').onclick = () => go('#/zones/edit/new');
};

function zoneEditor(id, onboarding) {
  const existing = S().zones.find((z) => z.id === id);
  const z = existing ? structuredClone(existing) : { id: uid(), name: '', desc: '', polygon: [[0.40, 0.58], [0.62, 0.58], [0.65, 0.80], [0.37, 0.80]], hazards: [], cameraId: S().camera?.id, isDefault: !S().zones.length };
  setChrome({ title: existing ? 'Edit drop zone' : onboarding ? 'Mark your drop spot' : 'New drop zone', back: onboarding ? '#/onboarding/permissions' : '#/zones' });
  if (onboarding) $('#appbar').hidden = false;
  view(`${onboarding ? progress('zone') : ''}
    <p class="mute small">Drag the corners to outline where a drone should leave packages: about 10 × 10 ft of open, flat ground.</p>
    <div class="cam" id="cam"><canvas width="${W}" height="${H}"></canvas><span class="tag">${esc(S().camera?.name || 'Camera')}${isDemo() ? ' · simulated' : ''}</span></div>
    <div class="cam-actions"><button id="hz">🌊 Mark a pool or hazard</button><button id="refresh">↻ New snapshot</button></div>
    <div id="audit"></div>
    <div class="stack" style="margin-top:14px">
      <label class="field">Name<input type="text" id="name" maxlength="40" placeholder="e.g. Back lawn" value="${esc(z.name)}" /></label>
      <div class="chips" id="presets">${['Back lawn', 'Front lawn', 'Driveway', 'Patio'].map((n) => `<button class="chip" type="button" aria-pressed="${z.name === n}">${n}</button>`).join('')}</div>
      <label class="field">Describe the spot (optional)<textarea id="desc" maxlength="200" placeholder="e.g. Back lawn, left of the shed, away from the pool">${esc(z.desc)}</textarea></label>
      <p class="mute small" style="margin-top:-6px">Shown to partners as drop instructions only if you choose to share it when linking them.</p>
      <div class="item card tight" style="margin:0"><span class="grow"><span class="t">Default drop zone</span><span class="s">Used for deliveries unless a partner is set to another zone.</span></span><label class="switch"><input type="checkbox" id="def" ${z.isDefault ? 'checked' : ''} aria-label="Default drop zone" /><span></span></label></div>
      <button class="primary block" id="save">Save drop zone</button>
      ${existing ? '<button class="block danger" id="del">Delete this zone</button>' : ''}
    </div>`);
  const canvas = $('#cam canvas'); const ctx = canvas.getContext('2d');
  let frame = null, drag = null, suggestion = null;
  const editables = () => [{ poly: z.polygon, kind: 'zone' }, ...z.hazards.map((h) => ({ poly: h.polygon, kind: 'hazard' }))];
  const redraw = () => paintFrame(ctx, frame, { zone: { ...z, name: z.name || 'Drop zone' }, ghost: suggestion?.zone, extra: (c) => {
    for (const e of editables()) for (const [x, y] of e.poly) { c.beginPath(); c.arc(x * W, y * H, 16, 0, Math.PI * 2); c.fillStyle = e.kind === 'zone' ? '#fff' : '#4cc3ff'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#000a'; c.stroke(); }
  } });
  const renderAudit = () => {
    const findings = z.hazards.length ? auditZone(z.polygon, z.hazards) : [];
    suggestion = suggestZone(z.polygon, z.hazards);
    $('#audit').innerHTML = findings.map((f) => `<div class="audit-line ${f.level}">${f.level === 'ok' ? '✓' : '⚠'} ${esc(f.text)}</div>`).join('') + (suggestion ? `<div class="audit-line warn row"><span class="grow">💡 A safer spot is outlined in white.</span><button class="primary" id="apply">Use it</button></div>` : '');
    if (suggestion) $('#apply').onclick = () => { z.polygon = suggestion.zone; renderAudit(); redraw(); };
    redraw();
  };
  const pt = (ev) => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]; };
  canvas.addEventListener('pointerdown', (ev) => {
    const [x, y] = pt(ev); let best = null;
    for (const e of editables()) e.poly.forEach((p, i) => { const d = Math.hypot((p[0] - x) * 16, (p[1] - y) * 9); if (d < 0.9 && (!best || d < best.d)) best = { d, poly: e.poly, i }; });
    if (!best) { // drag the whole zone if the press is inside it
      const inside = (() => { let c = false; const P = z.polygon; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; })();
      if (inside) best = { whole: true, last: [x, y] };
    }
    if (best) { drag = best; canvas.setPointerCapture(ev.pointerId); ev.preventDefault(); }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const [x, y] = pt(ev).map((n) => Math.min(0.99, Math.max(0.01, n)));
    if (drag.whole) { const dx = x - drag.last[0], dy = y - drag.last[1]; z.polygon = z.polygon.map(([a, b]) => [a + dx, b + dy]); drag.last = [x, y]; }
    else drag.poly[drag.i] = [x, y];
    redraw();
  });
  canvas.addEventListener('pointerup', () => { if (drag) { drag = null; renderAudit(); } });
  $('#hz').onclick = () => openSheet(`<h3>What’s near the drop spot?</h3><p class="mute small">Mark it once. DropZone+ warns you if it’s inside downwash range (about 15 ft for water, 10 ft for other hazards).</p>
    <div class="chips">${['pool', 'pond', 'patio edge', 'trampoline', 'overhang'].map((k) => `<button class="chip" data-k="${k}">${k}</button>`).join('')}</div>`, (el) => el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
    const [cx] = polygonCentroid(z.polygon); const x0 = cx > 0.5 ? 0.08 : 0.68;
    z.hazards.push({ kind: b.dataset.k, polygon: [[x0, 0.5], [x0 + 0.22, 0.5], [x0 + 0.24, 0.66], [x0, 0.66]] });
    closeSheet(); renderAudit(); toast('Drag the blue corners onto the ' + b.dataset.k);
  })));
  const refresh = async () => { frame = null; redraw(); frame = await grabFrame(z.cameraId); redraw(); };
  $('#refresh').onclick = refresh;
  $('#presets').querySelectorAll('.chip').forEach((c) => (c.onclick = () => { $('#name').value = c.textContent; $('#presets').querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === c)); }));
  $('#save').onclick = () => {
    z.name = $('#name').value.trim(); z.desc = $('#desc').value.trim();
    if (!z.name) { $('#name').focus(); return toast('Give your drop zone a name'); }
    const makeDefault = $('#def').checked || !S().zones.filter((x) => x.id !== z.id).length;
    const t = Object.assign(document.createElement('canvas'), { width: 144, height: 81 });
    t.getContext('2d').drawImage(canvas, 0, 0, 144, 81);
    z.thumb = t.toDataURL('image/jpeg', 0.7);
    let zones = S().zones.filter((x) => x.id !== z.id).map((x) => (makeDefault ? { ...x, isDefault: false } : x));
    zones.push({ ...z, isDefault: makeDefault, cameraId: z.cameraId || S().camera?.id, updatedAt: Date.now(), createdAt: z.createdAt || Date.now() });
    store.set({ zones });
    toast(`Saved “${z.name}”`);
    go(onboarding ? '#/onboarding/done' : '#/zones');
  };
  if (existing) $('#del').onclick = () => {
    if (!confirm(`Delete “${z.name}”?`)) return;
    let zones = S().zones.filter((x) => x.id !== z.id);
    if (zones.length && !zones.some((x) => x.isDefault)) zones[0].isDefault = true;
    store.set({ zones }); go('#/zones');
  };
  demo.actors = demoActors(null); demo.t = 300; // demo yard with nobody in it while you edit
  refresh(); renderAudit();
}

// ---------------- home ----------------
routes.home = () => {
  setChrome({ title: 'Home', tab: 'home', right: connBadge() });
  const z = defaultZone();
  if (!z) { view(`<div class="card empty"><div class="big">◎</div><p><b>Add your drop spot first</b></p><button class="primary" onclick="location.hash='#/zones/edit/new'">Mark a drop zone</button></div>`); return; }
  view(`<div id="hero"></div>
    <div class="card tight">
      <div class="row" style="margin-bottom:8px"><span class="grow"><b>${esc(z.name)}</b> <span class="mute small">· ${esc(S().camera?.name || 'Camera')}</span></span><span class="small mute" id="obs"></span></div>
      <div class="cam" id="cam"><canvas width="${W}" height="${H}"></canvas><video playsinline muted autoplay></video><span class="tag" id="camTag"></span></div>
      <div class="cam-actions"><button id="check">Check now</button><button id="live">▶ Live view</button></div>
    </div>
    <div id="next"></div>
    <div class="sec-title">Helpers</div>
    <div class="list">${toggleRow('alexa', 'Alexa heads-up', 'Simulated Alexa+ add-on', S().settings.alexa)}${toggleRow('speak', 'Read heads-ups aloud here', 'Uses this phone’s speaker', S().settings.speak)}${toggleRow('petDoor', 'Smart pet door', 'Simulated · only after you say yes', S().settings.petDoor)}</div>`);
  bindToggles(viewEl());
  const ctx = $('#cam canvas').getContext('2d');
  let liveStop = null;
  $('#check').onclick = async () => { $('#check').disabled = true; await look(); $('#check').disabled = false; renderLive(); };
  $('#live').onclick = async () => {
    if (liveStop) { liveStop(); liveStop = null; $('#live').textContent = '▶ Live view'; return; }
    $('#live').textContent = '■ Stop';
    liveStop = isDemo() ? demoLive() : await ringLive($('#cam video'));
  };
  homeCtx = { ctx, z };
  if (!delivery.lastVerdict) look().then(renderLive); else renderLive();
  const raf = () => { renderCam(); homeRaf = requestAnimationFrame(raf); };
  let homeRaf = requestAnimationFrame(raf);
  return () => { cancelAnimationFrame(homeRaf); liveStop?.(); homeCtx = null; };
};
let homeCtx = null;
let liveFrame = null;
function demoLive() {
  const start = performance.now();
  if (!delivery.session) { demo.actors = demoActors(defaultZone().polygon); }
  liveFrame = { readable: true, live: (ctx) => { if (!delivery.session) demo.t = ((performance.now() - start) / 1000) * 3 % 240; drawDemoYard(ctx, { packageAt: delivery.droppedAt ? delivery.dropPoint : null }); if (delivery.session?.state.phase === PHASE.LANDING) { const eta = delivery.session.state.delivery.etaAt; const f = Math.min(1, Math.max(0, 1 - (eta - dNow()) / 60000)); const d = delivery.dropPoint; drawDrone(ctx, d[0] + (1 - f) * 0.3, 0.05 + f * (d[1] - 0.3), 0.7 + f * 0.6); } }, source: 'demo live (simulated)' };
  return () => { liveFrame = null; };
}
async function ringLive(video) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' }); // docs: recvonly only
  pc.ontrack = (e) => { if (e.track.kind === 'video') { video.srcObject = e.streams[0]; video.play().catch(() => {}); liveFrame = { readable: true, video, live: (ctx) => video.videoWidth && ctx.drawImage(video, ...fit(video.videoWidth, video.videoHeight)), source: 'ring-live' }; } };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, 3000); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && (clearTimeout(t), r()); });
  const res = await fetch(`../api/ring/whep?device=${encodeURIComponent(S().camera.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { toast(`Live view unavailable: ${j.error || res.status}`); pc.close(); return () => {}; }
  await pc.setRemoteDescription({ type: 'answer', sdp: j.sdpAnswer });
  const stop = () => { pc.close(); liveFrame = null; if (j.sessionUrl) fetch('../api/ring/whep', { method: 'DELETE', body: JSON.stringify({ sessionUrl: j.sessionUrl }) }).catch(() => {}); };
  const t = setTimeout(stop, 55000); // Ring caps sessions at 30-60 s
  return () => { clearTimeout(t); stop(); };
}
function renderCam() {
  if (!homeCtx) return;
  const z = homeCtx.z;
  const frame = liveFrame || delivery.lastFrame;
  const s = delivery.session?.state;
  paintFrame(homeCtx.ctx, frame, { zone: z, verdict: s?.verdict || delivery.lastVerdict, extra: (ctx) => {
    if (!liveFrame && s && isDemo()) {
      if (s.phase === PHASE.LANDING) { const f = Math.min(1, Math.max(0, 1 - (s.delivery.etaAt - dNow()) / 60000)); const d = delivery.dropPoint; drawDrone(ctx, d[0] + (1 - f) * 0.3, 0.05 + f * (d[1] - 0.3), 0.7 + f * 0.6); }
      if (s.phase === PHASE.HOLDING) drawDrone(ctx, 0.85, 0.06, 0.6);
    }
    const rb = s?.receipt?.package_box; if (rb) { ctx.strokeStyle = '#3ee6ff'; ctx.lineWidth = 5; ctx.strokeRect(rb[0] * W - 6, rb[1] * H - 6, rb[2] * W + 12, rb[3] * H + 12); }
  } });
  $('#camTag') && ($('#camTag').textContent = liveFrame ? (isDemo() ? 'Live · simulated' : `Live · ${ringLabel()}`) : frame ? (isDemo() ? 'Snapshot · simulated' : `Snapshot · ${ringLabel()}`) : '');
}
function renderLive() {
  if (!homeCtx) return;
  const s = delivery.session?.state;
  const v = freshen(s?.verdict || delivery.lastVerdict);
  const hero = $('#hero'); if (!hero) return;
  const reason = v.reasons?.length ? v.reasons.map((r) => { const o = (v.objects || []).find((x) => x.label === r.label); return r.label ? `${r.label} ${r.where === 'near' ? 'next to' : 'in'} the zone${o && !v.scripted ? ` (${Math.round(o.score * 100)}% sure)` : ''}` : r.code.replaceAll('_', ' ').toLowerCase(); }).join(', ') : v.status === STATUS.CLEAR ? 'Nothing in or near the zone' : '';
  let eta = '';
  if (s?.delivery) {
    const left = (s.delivery.etaAt - dNow()) / 1000;
    eta = s.phase === PHASE.INBOUND ? `<span class="small">Drone in</span><b>${fmtDur(left)}</b>` : s.phase === PHASE.HOLDING ? `<span class="small">Holding · new ETA</span><b>${fmtDur(left)}</b>` : s.phase === PHASE.LANDING ? `<span class="small">Landing</span><b>${fmtDur(left)}</b>` : `<span class="small">Delivered</span><b>📦</b>`;
  }
  const idle = !s;
  if (s?.receipt) { // after the drop, the result matters more than the live zone state
    const good = s.receipt.placement === 'in_zone';
    hero.className = `status-hero ${good ? 'CLEAR' : 'UNKNOWN'}`;
    hero.innerHTML = `<div class="k">${esc(delivery.partner.name)} · example partner</div><div class="v">DELIVERED</div><div class="r">${esc(placementText(s.receipt))}</div><div class="eta"><b>📦</b></div>${delivery.alexa[0] && S().settings.alexa ? `<div class="alexa"><span class="ring" aria-hidden="true"></span><div><div class="small mute">Alexa · simulated Alexa+ add-on</div>“${esc(delivery.alexa[0].text)}”</div></div>` : ''}`;
    $('#obs').textContent = '';
    return renderNext(s);
  }
  hero.className = `status-hero ${v.status}`;
  hero.innerHTML = `<div class="k">${idle ? 'Drop zone right now' : `${esc(delivery.partner.name)} · example partner`}</div><div class="v">${v.status.replace('_', ' ')}</div><div class="r">${esc(reason)}</div>${eta ? `<div class="eta">${eta}</div>` : ''}
    ${s && delivery.alexa[0] && S().settings.alexa ? `<div class="alexa"><span class="ring" aria-hidden="true"></span><div><div class="small mute">Alexa · simulated Alexa+ add-on</div>“${esc(delivery.alexa[0].text)}”</div></div>` : ''}
    ${s?.pendingPrompt ? `<div class="ask btns"><button class="primary" id="yes">Yes</button><button id="no">Not now</button></div>` : ''}`;
  if (s?.pendingPrompt) { $('#yes').onclick = () => { delivery.session.answer(s.pendingPrompt.id, true); renderLive(); }; $('#no').onclick = () => { delivery.session.answer(s.pendingPrompt.id, false); renderLive(); }; }
  $('#obs').textContent = v.observed_at ? `checked ${fmtTime(Date.parse(v.observed_at))}` : '';
  renderNext(s);
}
function renderNext(s) {
  const next = $('#next');
  const linked = PARTNERS.filter((p) => S().partners[p.id]?.linked);
  if (s && s.phase !== PHASE.DELIVERED) next.innerHTML = `<div class="card tight"><div class="row"><span class="grow small">${isDemo() ? 'Demo clock runs 10× faster. ' : ''}Holds requested: ${s.holdsIssued}/3 · Pet door: ${s.petDoor.mode.replace('_', '-')}</span><button class="danger" id="cancel">End</button></div>
      <div class="btns" style="margin-top:10px"><button id="ownerHold">✋ Ask the drone to wait</button><button id="wrong">Detection looks wrong</button></div>
      <p class="mute small" style="margin:8px 0 0">You can only ever ask it to wait. Its own sensors still decide when it’s safe.</p></div>`;
  else if (s?.receipt) next.innerHTML = `<div class="card"><h3>${placementText(s.receipt)}</h3><p class="mute small">Proof of drop saved in Deliveries.</p><div class="btns"><button onclick="location.hash='#/deliveries'">View proof</button><button class="primary" id="again">Done</button></div></div>`;
  else next.innerHTML = linked.length
    ? `<div class="card"><h3>No drone on the way</h3><p class="mute small">When a linked partner books a drone delivery, it shows up here. You can run a simulated one now.</p><button class="primary block" id="sim">Simulate a drone delivery</button></div>`
    : `<div class="card"><h3>No delivery partner linked</h3><p class="mute small">Link a drone delivery partner so they can wait when your zone is busy.</p><button class="primary block" onclick="location.hash='#/partners'">Link a partner</button></div>`;
  $('#cancel') && ($('#cancel').onclick = () => { stopDelivery(); renderRoute(); });
  $('#ownerHold') && ($('#ownerHold').onclick = () => { // veto-only: an owner can add a HOLD, never remove one
    const t = dNow();
    const v = { status: STATUS.NOT_CLEAR, reasons: [{ code: 'OWNER_REQUESTED_HOLD' }], objects: [], observed_at: new Date(t).toISOString(), evaluated_at: new Date(t).toISOString(), stale_after: new Date(t + 90000).toISOString(), source: 'owner' };
    delivery.session.observe(v); delivery.lastVerdict = v; toast('Asked the drone to wait (up to 90 s)'); renderLive();
  });
  $('#wrong') && ($('#wrong').onclick = () => openSheet(`<h3>What’s wrong?</h3><p class="mute small">Your answer stays on this phone and helps tune detection for your yard.</p><div class="stack"><button data-f="missed">It missed something in the zone</button><button data-f="false">Nothing is actually there</button><button data-f="zone">My zone is drawn wrong</button></div>`, (el) => el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
    (S().feedback ||= []).push({ at: Date.now(), kind: b.dataset.f, verdict: delivery.lastVerdict?.status, objects: (delivery.lastVerdict?.objects || []).map((o) => o.label) }); store.save(); closeSheet();
    if (b.dataset.f === 'missed') $('#ownerHold')?.click(); else if (b.dataset.f === 'zone') go('#/zones'); else toast('Thanks, noted');
  }))));
  $('#again') && ($('#again').onclick = () => { stopDelivery(); delivery.lastVerdict = null; renderRoute(); });
  $('#sim') && ($('#sim').onclick = () => linked.length > 1 ? openSheet(`<h3>Who’s delivering?</h3><div class="list">${linked.map((p) => `<button class="item" data-p="${p.id}"><span class="dot on" style="background:${p.color}"></span><span class="grow"><span class="t">${p.name}</span><span class="s">Example partner · simulated</span></span></button>`).join('')}</div>`, (el) => el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { closeSheet(); startDelivery(b.dataset.p); }))) : startDelivery(linked[0].id));
}

// ---------------- deliveries ----------------
routes.deliveries = ([id]) => {
  setChrome({ title: 'Deliveries', tab: 'deliveries', right: connBadge() });
  const list = S().deliveries;
  if (!list.length) { view(`<div class="card empty"><div class="big">▣</div><p><b>No deliveries yet</b></p><p class="mute small">After each drone drop you’ll see a proof-of-drop photo from your camera and where the package landed.</p></div>`); return; }
  view(`<div class="list">${list.map((d) => `<button class="item" data-id="${d.id}"><img class="thumb" alt="" src="${d.image || ''}" /><span class="grow"><span class="t">${placementText(d.receipt)}</span><span class="s">${esc(d.partner)} · ${esc(d.zoneName)} · ${fmtDate(d.at)}${d.demo ? ' · simulated' : ''}</span></span><span class="chev">›</span></button>`).join('')}</div>`);
  viewEl().querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => {
    const d = list.find((x) => x.id === b.dataset.id);
    openSheet(`<h3>${placementText(d.receipt)}</h3><p class="mute small">${esc(d.partner)} (example partner) · ${esc(d.zoneName)} · ${fmtDate(d.at)}</p>
      ${d.image ? `<img src="${d.image}" alt="Proof-of-drop photo" style="width:100%;border-radius:12px" />` : '<p class="mute">No readable photo for this drop.</p>'}
      <ul class="plain small"><li>Located by: ${d.receipt.package_box ? 'before/after change detection on your camera' : esc((d.receipt.detail || 'not located').replaceAll('_', ' ').toLowerCase())}</li><li>Holds requested: ${d.receipt.holds_requested}</li>${d.demo ? '<li>Demo home: simulated camera and partner</li>' : ''}</ul>
      <details><summary class="small mute">Receipt data</summary><pre>${esc(JSON.stringify(d.receipt, null, 2))}</pre></details><button class="block" id="close">Close</button>`, (el) => ($('#close', el).onclick = closeSheet));
  }));
};

// ---------------- partners ----------------
routes.partners = () => {
  setChrome({ title: 'Delivery partners', tab: 'partners', right: connBadge() });
  view(`<p class="mute small">Link the drone services you order from. A linked partner can ask “is the drop zone busy?” and gets a single answer: <b>hold</b> or <b>no advisory</b>.</p>
    <div class="list">${PARTNERS.map((p) => { const l = S().partners[p.id]; return `<button class="item" data-p="${p.id}"><span class="dot ${l?.linked ? 'on' : ''}" style="${l?.linked ? `background:${p.color}` : ''}"></span><span class="grow"><span class="t">${p.name} <span class="badge sim">Example · simulated</span></span><span class="s">${l?.linked ? `Linked · uses “${esc(S().zones.find((z) => z.id === l.zoneId)?.name || defaultZone()?.name || '')}”` : p.blurb}</span></span><span class="chev">›</span></button>`; }).join('')}</div>
    <p class="mute small">These partners are fictional examples that show how a real drone service could connect. No real delivery company is integrated.</p>`);
  viewEl().querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => partnerSheet(b.dataset.p)));
};
function partnerSheet(id) {
  const p = PARTNERS.find((x) => x.id === id);
  const l = S().partners[id] || {};
  const zones = S().zones;
  openSheet(`<h3>${p.name} <span class="badge sim">Example · simulated</span></h3><p class="mute">${p.blurb}</p>
    <div class="card tight"><b>What ${p.name} gets</b><ul class="plain small"><li><b>HOLD</b> or <b>NO_ADVISORY</b> shortly before landing, with a reason such as “pet in zone”</li><li>When that answer was observed and when it expires (about 90 seconds)</li><li id="instrLine">${l.shareInstructions ? 'Your zone name and description, as drop instructions' : 'Not your zone description (unless you turn it on below)'}</li></ul>
      <b>What they never get</b><ul class="plain small"><li>Video, photos or live view</li><li>Who is in your yard: only labels like “person” or “pet”</li><li>Any “safe to land” signal. Their drone’s own sensors stay in charge.</li></ul></div>
    <details class="small"><summary class="mute">Learn more: how the hold works</summary><p>About a minute before landing, the partner checks DropZone+. If your zone is busy they wait 60 seconds and check again, up to 3 times, then follow their own process. If DropZone+ can’t see the zone, they get “no advisory” and deliver exactly as they do today.</p><pre>{ "advice": "HOLD", "authorises_drop": false,\n  "reason_codes": ["PET_IN_ZONE"], "hold_seconds": 60,\n  "valid_until": "…" }</pre></details>
    <label class="field" style="margin-top:12px">Drop zone for ${p.name}<select id="zone">${zones.map((z) => `<option value="${z.id}" ${(l.zoneId || defaultZone()?.id) === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></label>
    <div class="item" style="padding-left:0;padding-right:0"><span class="grow"><span class="t">Share drop instructions</span><span class="s">Zone name and your description</span></span><label class="switch"><input type="checkbox" id="share" ${l.shareInstructions ? 'checked' : ''} aria-label="Share drop instructions" /><span></span></label></div>
    <div class="btns">${l.linked ? '<button class="danger" id="unlink">Unlink</button><button class="primary" id="save">Save</button>' : '<button id="cancel">Not now</button><button class="primary" id="save">Link partner</button>'}</div>`, (el) => {
    $('#share', el).onchange = (e) => ($('#instrLine', el).textContent = e.target.checked ? 'Your zone name and description, as drop instructions' : 'Not your zone description (unless you turn it on below)');
    $('#save', el).onclick = () => { S().partners[id] = { linked: true, zoneId: $('#zone', el).value, shareInstructions: $('#share', el).checked, linkedAt: l.linkedAt || Date.now() }; store.save(); closeSheet(); toast(`${p.name} linked (simulated)`); renderRoute(); };
    $('#cancel', el) && ($('#cancel', el).onclick = closeSheet);
    $('#unlink', el) && ($('#unlink', el).onclick = () => { delete S().partners[id]; store.save(); closeSheet(); toast(`${p.name} unlinked`); renderRoute(); });
  });
}

// ---------------- settings ----------------
routes.settings = () => {
  setChrome({ title: 'Settings', tab: 'settings', right: connBadge() });
  const c = S().connection || {};
  const method = { demo: 'Demo home (simulated)', oauth: 'Ring account (linked)', 'playground-token': 'Ring Developer Playground token', 'env-token': 'Ring token on the server' }[c.method] || 'Not connected';
  view(`<div class="sec-title">Ring</div>
    <div class="list"><div class="item"><span class="grow"><span class="t">${method}</span><span class="s">Camera: ${esc(S().camera?.name || '—')}</span></span></div>
      <button class="item" id="cam"><span class="grow"><span class="t">Change camera</span></span><span class="chev">›</span></button>
      <button class="item" id="disc"><span class="grow"><span class="t" style="color:var(--bad)">Disconnect Ring</span><span class="s">You can reconnect at any time</span></span></button></div>
    <div class="sec-title">Notifications & helpers</div>
    <div class="list">${toggleRow('notifications', 'Phone notifications', 'Zone not clear, drone holding, delivered', S().settings.notifications)}${toggleRow('alexa', 'Alexa heads-up', 'Simulated Alexa+ add-on', S().settings.alexa)}${toggleRow('speak', 'Read heads-ups aloud here', 'Uses this phone’s speaker', S().settings.speak)}${toggleRow('petDoor', 'Smart pet door', 'Simulated · come-in-only after your yes', S().settings.petDoor)}</div>
    <div class="sec-title">Appearance</div>
    <div class="list"><div class="item"><span class="grow"><span class="t">Theme</span></span><select id="theme" style="width:auto">${['system', 'dark', 'light'].map((t) => `<option ${S().settings.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="sec-title">Privacy</div>
    <div class="card small"><p><b>What stays on this phone:</b> your drop zones, partner choices, settings and proof-of-drop photos.</p><p><b>What DropZone+ sends to partners:</b> HOLD or NO_ADVISORY and reason codes. Drop instructions only if you turn them on.</p><p class="mute" style="margin:0">Camera frames are checked on this device or your DropZone+ server. No faces are recognised, and nobody is identified.</p></div>
    <div class="list"><button class="item" id="wipe"><span class="grow"><span class="t" style="color:var(--bad)">Delete all my data</span><span class="s">Zones, partners, history and settings on this device</span></span></button></div>
    <div class="sec-title">Help</div>
    <div class="list"><button class="item" id="tour"><span class="grow"><span class="t">Replay the welcome tour</span></span><span class="chev">›</span></button>
      <a class="item" href="../"><span class="grow"><span class="t">About DropZone+</span></span><span class="chev">›</span></a>
      <a class="item" href="../demo.html"><span class="grow"><span class="t">Interactive demo for judges</span><span class="s">Scripted scenarios and the technical view</span></span><span class="chev">›</span></a></div>
    <p class="mute small" style="text-align:center">DropZone+ · not affiliated with Ring, Amazon or any drone operator</p>`);
  bindToggles(viewEl());
  $('#theme').onchange = (e) => { S().settings.theme = e.target.value; store.save(); applyTheme(); };
  $('#cam').onclick = () => go('#/onboarding/camera');
  $('#tour').onclick = () => go('#/onboarding/welcome');
  $('#disc').onclick = async () => {
    if (!confirm('Disconnect Ring? Your zones stay saved.')) return;
    if (c.mode === 'live' && env.server) await fetch('../api/ring/token', { method: 'DELETE' }).catch(() => {});
    stopDelivery(); store.set({ connection: null, camera: null, onboarded: false }); go('#/onboarding/connect');
  };
  $('#wipe').onclick = () => { if (!confirm('Delete all DropZone+ data on this device? This can’t be undone.')) return; stopDelivery(); localStorage.removeItem(KEY); store.data = structuredClone(DEFAULTS); toast('All data deleted'); go('#/onboarding/welcome'); };
};

function applyTheme() {
  const t = S().settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

// ---------------- boot ----------------
(async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  await probeServer();
  // A live connection only survives while the server still holds a Ring token.
  if (S().connection?.mode === 'live' && !(env.config?.mode === 'live')) { store.set({ connection: { mode: 'demo', method: 'demo', at: Date.now() }, camera: null, onboarded: false }); toast('Ring session ended. Reconnect or use the demo home.'); }
  window.dropzoneApp = { store, delivery, startDelivery, go }; // test hook
  renderRoute();
})();
