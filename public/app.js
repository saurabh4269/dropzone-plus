import { evaluateZone, freshen, auditZone, STATUS } from './core/zone.js';
import { createSession, PHASE } from './core/engine.js';
import { SCENARIOS, DEFAULT_ZONE, actorAt, sizeAt, scriptedDetections } from './scenarios.js';
import { W, H, drawYard, drawCameraChrome, drawActor, drawPolygon, drawDetections, drawDrone, drawPackage, drawUnreadable } from './scene.js';
import { loadDetector, detect } from './detector.js';

const $ = (id) => document.getElementById(id);
const cv = $('cam');
const ctx = cv.getContext('2d');

const app = {
  mode: 'replay',          // 'replay' | 'live'
  server: false,           // is server.js behind us (vs static hosting)?
  view: 'scene',           // 'scene' (replay yard) | 'image' (Ring snapshot / upload) | 'video' (WHEP)
  scn: SCENARIOS[0],
  simT: 0, simBase: 0, playing: false, speed: 10,
  zone: DEFAULT_ZONE, hazards: [],
  session: null,
  image: null, imageLabel: '', imageRect: null,
  last: null,              // last observation inputs, so zone edits re-score immediately
  edit: null, editPts: [],
  nextObsAt: 0, dropAt: null, receiptPending: false,
  speak: false,
  pc: null, whepUrl: null, liveTimer: null, windowTimer: null,
  handledEvents: new Set(),
};

const now = () => (app.mode === 'replay' && app.view !== 'image' ? app.simBase + app.simT * 1000 : Date.now());
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDur = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- session + events ----------
function newSession() {
  app.session = createSession({ zone: app.zone, hazards: app.hazards, household: { hasPetDoor: true }, emit: onEvent, now });
  $('timeline').innerHTML = '';
  $('receiptBox').textContent = 'No delivery yet.';
  $('promptBox').classList.add('hidden');
  $('speechText').textContent = '“Alexa” lines appear here.';
  app.receiptPending = false;
  app._lastStatus = null;
  renderAudit();
}

function onEvent(type, e) {
  let text = '';
  if (type === 'verdict') {
    const v = e.verdict;
    const prev = app._lastStatus;
    app._lastStatus = v.status + (v.reasons[0]?.code || '');
    pushState();
    if (prev === app._lastStatus) return; // only log changes
    text = `Zone ${v.status.replace('_', ' ')}${v.reasons.length ? ' · ' + v.reasons.map((r) => r.code + (r.label ? `(${r.label})` : '')).join(', ') : ''} [${v.source}]`;
  } else if (type === 'alexa') {
    if (e.kind === 'speech') {
      say(e.speech);
      text = `“${e.speech}”`;
      if (e.prompt) { $('promptQ').textContent = e.prompt.question; $('promptBox').classList.remove('hidden'); $('promptBox').dataset.id = e.prompt.id; }
    } else text = e.card?.body || '';
  } else if (type === 'owner') {
    $('promptBox').classList.add('hidden');
    text = `Owner answered ${e.yes ? 'YES' : 'NO'}${app._autoAnswer ? ' (auto-answered in replay)' : ''}`;
  } else if (type === 'petdoor') {
    $('doorText').textContent = e.mode.replace('_', '-');
    text = `Pet door → ${e.mode.replace('_', '-')} (${e.why})`;
  } else if (type === 'carrier') {
    if (e.kind === 'hold') text = `Carrier checked advisory at T−60 s: HOLD ${e.advisory.reason_codes.join(', ')} → waits ${e.advisory.hold_seconds}s (hold ${e.holds}/3)`;
    else if (e.kind === 'final-approach') text = `Carrier checked advisory: ${e.advisory.advice} → final approach under its own detect-and-avoid`;
    else if (e.kind === 'dropped') { text = 'Package released'; app.dropAt = now(); app.receiptPending = true; }
  } else if (type === 'delivery') {
    text = `Drone order (${e.carrier}, ref ${e.ref}) · ETA ${fmtTime(Date.parse(e.eta))}`;
  } else if (type === 'receipt') {
    renderReceipt(e.receipt);
    text = `Proof of drop: ${e.receipt.placement}${e.receipt.hazard ? ' (' + e.receipt.hazard + ')' : ''}`;
  } else if (type === 'ring') {
    text = e.text;
  }
  if (!text) return;
  const li = document.createElement('li');
  li.innerHTML = `<time>${fmtTime(Date.parse(e.at) || now())}</time><span class="k">${type}</span><span></span>`;
  li.lastChild.textContent = text;
  $('timeline').prepend(li);
}

function say(text) {
  $('speechText').textContent = `“${text}”`;
  if (!app.speak || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  const show = document.querySelector('.show');
  u.onstart = () => show.classList.add('speaking');
  u.onend = () => show.classList.remove('speaking');
  speechSynthesis.speak(u);
}

let pushTimer;
function pushState() {
  if (!app.server) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const s = app.session.state;
    fetch('./api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: s.verdict, delivery: s.delivery, holdsIssued: s.holdsIssued }) }).catch(() => {});
  }, 150);
}

// ---------- observation ----------
function observe({ detections, media = { readable: true }, observedAt, source, scripted = false }) {
  app.last = { detections, media, observedAt, source, scripted };
  const v = evaluateZone({ detections, zone: app.zone, observedAt, now: now(), media, source });
  v.scripted = scripted;
  app.session.observe(v);
  if (app._photoPending) { app._photoPending = false; app.session.startDelivery({ etaAt: Date.now() + 8 * 60000, carrier: 'Simulated carrier' }); }
  $('srcLabel').textContent = `source: ${source}`;
  $('obsLabel').textContent = `observed: ${observedAt ? fmtTime(observedAt) : '—'} · expires ${v.stale_after ? fmtTime(Date.parse(v.stale_after)) : '—'}`;
  $('detLabel').textContent = `detector: ${scripted ? 'scripted (replay, not a model)' : source === 'replay' ? '—' : 'COCO-SSD in browser'}`;
  return v;
}

function rescore() {
  if (!app.last) return;
  app.session.state.zone = app.zone;
  app.session.state.hazards = app.hazards;
  observe({ ...app.last, observedAt: app.last.observedAt });
}

// ---------- replay ----------
function loadScenario(id) {
  stopLive();
  app.scn = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
  app.view = 'scene';
  app.zone = app.scn.zone || DEFAULT_ZONE;
  app.hazards = app.scn.hazards || [];
  app.simT = 0;
  app.simBase = Date.now();
  app.nextObsAt = 0;
  app.dropAt = null;
  app.playing = false;
  app.handledEvents = new Set();
  $('playBtn').textContent = '▶ Play';
  $('scenarioBlurb').textContent = app.scn.blurb;
  $('doorText').textContent = 'normal';
  newSession();
  replayObserve();
  app.session.startDelivery({ etaAt: app.simBase + app.scn.etaSec * 1000, carrier: 'Simulated carrier' });
}

function replayObserve() {
  observe({ detections: scriptedDetections(app.scn, app.simT), media: app.scn.media || { readable: true }, observedAt: now(), source: 'replay', scripted: true });
}

function replayStep(dt) {
  if (!app.playing || app.view !== 'scene') return;
  app.simT += dt * app.speed;
  if (app.simT >= app.nextObsAt) { replayObserve(); app.nextObsAt = app.simT + 10; } // one frame every 10 simulated seconds
  for (const ev of app.scn.events) {
    if (app.simT >= ev.t && !app.handledEvents.has(ev)) {
      app.handledEvents.add(ev);
      if (ev.type === 'answer' && app.session.state.pendingPrompt?.id === ev.prompt) { app._autoAnswer = ev.auto; app.session.answer(ev.prompt, ev.yes); app._autoAnswer = false; }
    }
  }
  app.session.tick();
  if (app.receiptPending && now() - app.dropAt > 5000) {
    app.receiptPending = false;
    const d = app.scn.drop;
    const box = d.unseen ? null : [d.at[0] - 0.02, d.at[1] - 0.045, 0.04, 0.045];
    app.session.recordDrop({ packageBox: box, observedAt: now(), source: d.unseen ? 'replay (frame unreadable)' : 'replay' });
  }
  if (app.simT >= app.scn.durationSec) { app.playing = false; $('playBtn').textContent = '▶ Play'; }
}

// Jump the replay forward (deterministic), e.g. ?seek=420 for screenshots and the demo video.
function seek(sec) {
  const keep = app.speed;
  app.speed = 1; app.playing = true;
  while (app.simT < sec) replayStep(1);
  app.speed = keep; app.playing = false;
}

// ---------- drawing ----------
function draw() {
  ctx.clearRect(0, 0, W, H);
  const s = app.session.state;
  const v = freshen(s.verdict, now());
  if (app.view === 'scene') {
    if (app.scn.media && !app.scn.media.readable) drawUnreadable(ctx, app.scn.media.reason);
    else {
      drawYard(ctx);
      for (const a of app.scn.actors) { const p = actorAt(a, app.simT); if (p) drawActor(ctx, a.emoji, p.x, p.y, sizeAt(a, p.y)); }
    }
  } else if (app.view === 'video') {
    const vid = $('liveVideo');
    if (vid.videoWidth) app.imageRect = fitRect(vid.videoWidth, vid.videoHeight), ctx.drawImage(vid, ...app.imageRect);
  } else if (app.image) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(app.image, ...app.imageRect);
  } else {
    drawUnreadable(ctx, app.last?.media?.reason || (app.mode === 'live' ? 'Waiting for a Ring frame…' : ''));
  }

  for (const h of app.hazards) drawPolygon(ctx, h.polygon, { stroke: '#4cc3ff', fill: 'rgba(76,195,255,.15)', dash: [4, 4], label: h.kind });
  const color = v.status === STATUS.CLEAR ? '#2fbf71' : v.status === STATUS.NOT_CLEAR ? '#ff5a4f' : '#f0b429';
  drawPolygon(ctx, app.zone, { stroke: color, fill: color + '18', dash: [12, 8], width: 4, label: 'DROP ZONE · ' + v.status.replace('_', ' '), labelColor: '#111', labelBelow: true });
  if (v.status !== STATUS.UNKNOWN || v.reasons?.[0]?.code === 'EXPIRED') drawDetections(ctx, s.verdict?.objects, { scripted: s.verdict?.scripted });

  // drone + package (replay only; live drops come from a real snapshot)
  if (app.view === 'scene' && s.delivery) {
    const d = app.scn.drop.at;
    const eta = s.delivery.etaAt;
    if (s.phase === PHASE.LANDING) { const f = Math.min(1, Math.max(0, 1 - (eta - now()) / 60000)); drawDrone(ctx, d[0] + (1 - f) * 0.3, 0.05 + f * (d[1] - 0.3), 0.7 + f * 0.6); }
    if (s.phase === PHASE.HOLDING) drawDrone(ctx, 0.85, 0.06, 0.6);
    if (s.phase === PHASE.DELIVERED) {
      if (!app.scn.media || app.scn.media.readable) drawPackage(ctx, d[0], d[1]);
      const lift = Math.min(1, (now() - (app.dropAt || now())) / 20000);
      if (lift < 1) drawDrone(ctx, d[0] + lift * 0.4, d[1] - 0.25 - lift * 0.4, 1.2 - lift * 0.5);
    }
  }
  if (app.edit) drawPolygon(ctx, app.editPts, { stroke: '#fff', dash: [2, 4], width: 2 });
  const label = app.view === 'scene' ? 'Backyard cam · simulated' : app.view === 'video' ? 'Ring live view (WHEP)' : app.imageLabel;
  drawCameraChrome(ctx, { label, time: fmtTime(now()), simulated: app.view === 'scene' });
}

function fitRect(iw, ih) {
  const k = Math.min(W / iw, H / ih);
  const w = iw * k, h = ih * k;
  return [(W - w) / 2, (H - h) / 2, w, h];
}

function renderCards() {
  const s = app.session.state;
  const v = freshen(s.verdict, now());
  const big = $('statusBig');
  big.textContent = v.status.replace('_', ' ');
  big.className = 'status ' + v.status.toLowerCase();
  $('reasonText').textContent = v.reasons?.length ? v.reasons.map((r) => r.code.replaceAll('_', ' ').toLowerCase() + (r.label ? ` · ${r.label}` : '') + (r.detail ? ` · ${r.detail}` : '')).join('; ') : v.status === STATUS.CLEAR ? 'nothing in or near the zone' : '—';
  let eta = 'No delivery inbound';
  if (s.delivery) {
    const left = (s.delivery.etaAt - now()) / 1000;
    eta = s.phase === PHASE.INBOUND ? `🚁 Drone in ${fmtDur(left)}` : s.phase === PHASE.HOLDING ? `⏸ Carrier holding · new ETA ${fmtDur(left)}` : s.phase === PHASE.LANDING ? `🛬 Final approach · ${fmtDur(left)}` : '📦 Delivered';
  }
  $('etaText').textContent = eta;
  const adv = s.advisory || { advice: 'NO_ADVISORY' };
  $('phaseText').textContent = s.phase;
  $('adviceText').textContent = adv.advice;
  $('adviceText').className = adv.advice;
  $('holdsText').textContent = `${s.holdsIssued} / 3`;
  $('advJson').textContent = JSON.stringify(adv, null, 2);
  $('clockText').textContent = app.mode === 'replay' && app.view === 'scene' ? `simulated clock ${fmtTime(now())} · ${app.speed}×` : fmtTime(now());
}

function renderAudit() {
  const box = $('audit');
  box.innerHTML = '';
  const f = app.hazards.length ? auditZone(app.zone, app.hazards) : [{ level: 'ok', text: 'Zone audit: no hazards marked. Outline a pool, pond or hard patio edge once with “Mark hazard”.' }];
  for (const x of f) { const d = document.createElement('div'); d.className = x.level; d.textContent = (x.level === 'ok' ? '✓ ' : '⚠ ') + x.text + (x.code === 'HAZARD_NEAR_ZONE' ? ' Suggest moving the zone away from it.' : ''); box.append(d); }
}

function renderReceipt(r) {
  const label = { in_zone: 'Landed inside the drop zone', outside_zone: 'Landed OUTSIDE the drop zone', hazard: `Landed next to the ${r.hazard}`, unknown: 'Placement not confirmed (no readable frame / owner to verify)' }[r.placement];
  $('receiptBox').innerHTML = `<div class="place ${r.placement}"></div><div class="fine"></div>${r.snapshot ? `<img alt="Ring proof-of-drop snapshot" src="${r.snapshot}">` : ''}<details><summary>receipt JSON</summary><pre></pre></details>`;
  $('receiptBox').querySelector('.place').textContent = label;
  $('receiptBox').querySelector('.fine').textContent = `ref ${r.delivery_ref} · observed ${r.observed_at ? fmtTime(Date.parse(r.observed_at)) : '—'} · source ${r.source} · holds requested ${r.holds_requested}`;
  $('receiptBox').querySelector('pre').textContent = JSON.stringify(r, null, 2);
}

// ---------- images: Ring snapshots, live frames, uploads ----------
async function analyseImage(el, { label, observedAt, source }) {
  $('detLabel').textContent = 'detector: loading COCO-SSD…';
  await loadDetector();
  const iw = el.naturalWidth || el.videoWidth, ih = el.naturalHeight || el.videoHeight;
  const rect = fitRect(iw, ih);
  const preds = await detect(el);
  const detections = preds.map((p) => ({ label: p.class, score: p.score, box: [(rect[0] + p.bbox[0] * rect[2] / iw) / W, (rect[1] + p.bbox[1] * rect[3] / ih) / H, (p.bbox[2] * rect[2] / iw) / W, (p.bbox[3] * rect[3] / ih) / H] }));
  if (el.tagName === 'IMG') { app.image = el; app.imageRect = rect; app.imageLabel = label; if (app.view !== 'video') app.view = 'image'; }
  return observe({ detections, observedAt, source });
}

async function ringSnapshot() {
  const t0 = Date.now();
  try {
    const res = await fetch('./api/ring/snapshot');
    refreshCalls();
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      app.view = 'image'; app.image = null;
      return observe({ detections: [], media: { readable: false, reason: `Ring snapshot unavailable (${j.status || res.status}): ${j.reason || ''}`.slice(0, 160) }, observedAt: t0, source: 'ring-snapshot' });
    }
    const observedAt = Date.parse(res.headers.get('X-Observed-At')) || t0;
    const url = URL.createObjectURL(await res.blob());
    const img = await loadImg(url);
    const v = await analyseImage(img, { label: 'Ring snapshot · Ring Partner API', observedAt, source: 'ring-snapshot' });
    return { v, url, observedAt };
  } catch (e) {
    return observe({ detections: [], media: { readable: false, reason: e.message }, observedAt: t0, source: 'ring-snapshot' });
  }
}

function loadImg(url) {
  return new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => bad(new Error('could not load image')); i.src = url; });
}

async function startLive() {
  stopLive();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  app.pc = pc;
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' }); // docs say recvonly; the sample's sendrecv is not needed
  const vid = $('liveVideo');
  pc.ontrack = (e) => { if (e.streams[0] && e.track.kind === 'video') { vid.srcObject = e.streams[0]; vid.play().catch(() => {}); app.view = 'video'; $('frameBtn').disabled = false; } };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, 3000); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && (clearTimeout(t), r()); });
  const res = await fetch('./api/ring/whep', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
  refreshCalls();
  const j = await res.json();
  if (!res.ok) { onEvent('ring', { text: `WHEP failed: ${j.error}` }); stopLive(); return; }
  app.whepUrl = j.sessionUrl;
  await pc.setRemoteDescription({ type: 'answer', sdp: j.sdpAnswer });
  onEvent('ring', { text: 'Live view started (WHEP). Sessions are capped at ~30–60 s.' });
  app.liveTimer = setTimeout(stopLive, 55000);
}

function stopLive() {
  clearTimeout(app.liveTimer);
  if (app.pc) { app.pc.close(); app.pc = null; }
  if (app.whepUrl) { fetch('./api/ring/whep', { method: 'DELETE', body: JSON.stringify({ sessionUrl: app.whepUrl }) }).catch(() => {}); app.whepUrl = null; }
  if (app.view === 'video') app.view = app.image ? 'image' : 'scene';
  $('frameBtn').disabled = true;
}

async function refreshCalls() {
  if (!app.server || app.mode !== 'live') return;
  const calls = await fetch('./api/ring/calls').then((r) => r.json()).catch(() => []);
  $('ringCalls').textContent = calls.slice(-14).reverse().map((c) => `${c.at.slice(11, 19)}  ${c.method.padEnd(6)} ${String(c.status).padEnd(4)} ${String(c.ms).padStart(5)}ms  ${c.path}`).join('\n') || 'no calls yet';
}

// ---------- zone editing ----------
function canvasPoint(ev) {
  const r = cv.getBoundingClientRect();
  // canvas is object-fit: contain inside the stage
  const k = Math.min(r.width / W, r.height / H);
  const ox = (r.width - W * k) / 2, oy = (r.height - H * k) / 2;
  return [Math.min(1, Math.max(0, (ev.clientX - r.left - ox) / (W * k))), Math.min(1, Math.max(0, (ev.clientY - r.top - oy) / (H * k)))];
}

function toggleEdit(kind) {
  const btn = kind === 'zone' ? $('editZoneBtn') : $('hazardBtn');
  if (app.edit === kind) {
    if (app.editPts.length >= 3) {
      if (kind === 'zone') { app.zone = app.editPts; if (app.mode === 'live') localStorage.setItem('dz.zone', JSON.stringify(app.zone)); }
      else {
        const k = (prompt('What is it? (e.g. pool, pond, patio edge, overhang)', 'pool') || 'hazard').trim();
        app.hazards = [...app.hazards, { kind: k, polygon: app.editPts }];
        if (app.mode === 'live') localStorage.setItem('dz.hazards', JSON.stringify(app.hazards));
      }
      renderAudit();
      rescore();
    }
    app.edit = null; app.editPts = [];
    btn.classList.remove('active'); btn.textContent = kind === 'zone' ? '✏️ Edit zone' : '🌊 Mark hazard';
    $('editHint').classList.add('hidden');
    return;
  }
  if (app.edit) toggleEdit(app.edit);
  app.edit = kind; app.editPts = [];
  app.playing = false; $('playBtn').textContent = '▶ Play';
  btn.classList.add('active'); btn.textContent = '✔ Done';
  $('editHint').textContent = kind === 'zone' ? 'Click the corners of the ~10×10 ft drop area, then press “Done”.' : 'Click around the pool / pond / hard edge, then press “Done”.';
  $('editHint').classList.remove('hidden');
}

// ---------- wiring ----------
function wire() {
  const sel = $('scenarioSel');
  for (const s of SCENARIOS) sel.append(new Option(s.title, s.id));
  sel.onchange = () => loadScenario(sel.value);
  $('playBtn').onclick = () => {
    if (app.view !== 'scene') loadScenario(app.scn.id);
    if (app.simT >= app.scn.durationSec) loadScenario(app.scn.id);
    app.playing = !app.playing;
    $('playBtn').textContent = app.playing ? '⏸ Pause' : '▶ Play';
  };
  $('restartBtn').onclick = () => loadScenario(app.scn.id);
  $('speedSel').onchange = (e) => (app.speed = Number(e.target.value));
  for (const id of ['speakChk', 'speakChk2']) $(id).onchange = (e) => { app.speak = e.target.checked; if (!app.speak) speechSynthesis?.cancel(); };
  $('yesBtn').onclick = () => app.session.answer($('promptBox').dataset.id, true);
  $('noBtn').onclick = () => app.session.answer($('promptBox').dataset.id, false);
  $('editZoneBtn').onclick = () => toggleEdit('zone');
  $('hazardBtn').onclick = () => toggleEdit('hazard');
  cv.onclick = (ev) => { if (app.edit) app.editPts = [...app.editPts, canvasPoint(ev)]; };
  $('fileIn').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    app.playing = false; $('playBtn').textContent = '▶ Play';
    stopLive();
    const img = await loadImg(URL.createObjectURL(f));
    photoSession();
    const v = await analyseImage(img, { label: 'Your photo · real detection', observedAt: Date.now(), source: 'upload' });
    onEvent('ring', { text: `Photo analysed in-browser: ${v.objects.length} object(s) found → ${v.status}` });
    e.target.value = '';
  };

  // live controls
  $('discoverBtn').onclick = discover;
  $('snapBtn').onclick = ringSnapshot;
  $('liveBtn').onclick = () => startLive().catch((e) => onEvent('ring', { text: 'Live view error: ' + e.message }));
  $('frameBtn').onclick = () => analyseImage($('liveVideo'), { label: 'Ring live frame', observedAt: Date.now(), source: 'ring-live' });
  $('orderBtn').onclick = () => {
    app.session.startDelivery({ etaAt: Date.now() + 3 * 60000, carrier: 'Simulated carrier' });
    clearInterval(app.windowTimer);
    app.windowTimer = setInterval(() => { const p = app.session.state.phase; if (p === PHASE.INBOUND || p === PHASE.HOLDING) ringSnapshot(); }, 30000);
    ringSnapshot();
  };
  $('proofBtn').onclick = async () => {
    const r = await ringSnapshot();
    app.session.recordDrop({ packageBox: null, observedAt: r?.observedAt || Date.now(), snapshotUrl: r?.url, source: 'ring-snapshot' });
  };
}

// A photo test gets its own session (real clock, drone 8 min out) so Alexa reacts to the photo's verdict.
function photoSession() {
  app.view = 'image';
  if (app.mode !== 'replay') return;
  app.playing = false; $('playBtn').textContent = '▶ Play';
  newSession();
  $('doorText').textContent = 'normal';
  app._photoPending = true;
}

// ?photo=<image url> runs the real detector on any CORS-readable image (handy for demos and tests).
async function analysePhotoUrl(url) {
  try {
    const img = await loadImg(url);
    photoSession();
    const v = await analyseImage(img, { label: 'Photo · real detection', observedAt: Date.now(), source: 'upload' });
    onEvent('ring', { text: `Photo analysed in-browser: ${v.objects.length} object(s) → ${v.status}` });
  } catch (e) { onEvent('ring', { text: 'Photo failed: ' + e.message }); }
}

async function discover() {
  const j = await fetch('./api/ring/discover').then((r) => r.json()).catch((e) => ({ error: e.message }));
  refreshCalls();
  const d = j.device;
  const ok = (x) => (x?.ok ? '✓' : `✗ ${x?.status || ''}`);
  $('deviceBox').textContent = d ? `Device: ${d.name} (${d.kind}) · id ${d.id} · online: ${d.online ?? 'n/a'}  |  users/me ${ok(j.me)} · devices ${ok(j.devices)} · status ${ok(j.status)} · capabilities ${ok(j.capabilities)} · history ${ok(j.history)} (${j.history?.data?.data?.length ?? 0} events)` : `No device: ${j.devices?.error || j.error || 'unknown error'}`;
  onEvent('ring', { text: d ? `Ring device discovered: ${d.name}` : 'Ring discovery failed (token expired? Playground tokens last ~30 min)' });
}

function connectEvents() {
  if (!app.server) return;
  const es = new EventSource('./api/events');
  es.addEventListener('ring', (m) => {
    const e = JSON.parse(m.data);
    onEvent('ring', { text: `Ring webhook ${e.type}${e.sub_type ? ' · ' + e.sub_type : ''}${e.simulated ? ' (simulated, HMAC-verified)' : ' (HMAC-verified)'}` });
    const p = app.session.state.phase;
    if (app.mode === 'live' && (p === PHASE.INBOUND || p === PHASE.HOLDING)) ringSnapshot(); // event-triggered re-check
  });
}

let lastFrame = performance.now();
function loop(t) {
  const dt = Math.min(0.1, (t - lastFrame) / 1000);
  lastFrame = t;
  replayStep(dt);
  if (app.mode === 'live' || app.view !== 'scene') app.session.tick();
  draw();
  renderCards();
  requestAnimationFrame(loop);
}

async function boot() {
  wire();
  const cfg = await fetch('./api/config').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  app.server = Boolean(cfg);
  const forceReplay = new URLSearchParams(location.search).has('replay');
  if (cfg?.mode === 'live' && !forceReplay) {
    app.mode = 'live';
    $('modeBadge').textContent = 'LIVE · Ring Playground';
    $('modeBadge').className = 'badge live';
    $('replayControls').classList.add('hidden');
    $('liveControls').classList.remove('hidden');
    $('ringPanel').classList.remove('hidden');
    app.zone = JSON.parse(localStorage.getItem('dz.zone') || 'null') || DEFAULT_ZONE;
    app.hazards = JSON.parse(localStorage.getItem('dz.hazards') || '[]');
    app.view = 'image';
    newSession();
    discover().then(ringSnapshot);
  } else {
    const q = new URLSearchParams(location.search);
    const scn = q.get('scenario');
    if (scn) $('scenarioSel').value = scn;
    loadScenario(scn || SCENARIOS[0].id);
    if (q.has('speed')) { app.speed = Number(q.get('speed')) || 10; $('speedSel').value = String(app.speed); }
    if (q.has('seek')) seek(Number(q.get('seek')));
    if (q.has('autoplay')) { app.playing = true; $('playBtn').textContent = '⏸ Pause'; }
    if (q.get('photo')) analysePhotoUrl(q.get('photo'));
  }
  connectEvents();
  requestAnimationFrame(loop);
}

boot();
