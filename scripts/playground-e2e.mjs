#!/usr/bin/env node
// End-to-end check against the Ring Developer Playground (or ring-partner-sandbox), one command:
//   RING_ACCESS_TOKEN=<playground token> npm run playground
//   RING_API_BASE=http://127.0.0.1:8686 RING_ACCESS_TOKEN=sandbox-token npm run playground   (mock)
// 1) Ring Partner API directly: users/me, devices, status, capabilities, history, snapshot (303)
// 2) The real PWA in headless Chrome against server.js: Check now (snapshot) -> Live view (WHEP) ->
//    detection on the live frame -> carrier advisory -> live session closed (DELETE).
// Prints PASS / FAIL / SKIP / INFO per step. Never prints the token. Screenshots: /tmp/dropzone-playground-*.png
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ring, pickDevice, summarizeDevice, RING_API } from '../lib/ring.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (status, step, detail = '') => { results.push({ status, step, detail }); console.log(`${status.padEnd(5)} ${step}${detail ? '  · ' + detail : ''}`); };
const official = RING_API === 'https://api.amazonvision.com';

if (!process.env.RING_ACCESS_TOKEN) {
  console.log('Set RING_ACCESS_TOKEN (Ring Developer Playground token: developer.amazon.com/ring/console/playground).');
  console.log('To dry-run against the mock: RING_API_BASE=http://127.0.0.1:8686 RING_ACCESS_TOKEN=sandbox-token npm run playground');
  process.exit(2);
}
console.log(`Target: ${official ? 'Ring Partner API (api.amazonvision.com)' : `mock Ring API at ${RING_API}`}\n`);

// ---------- 1. Ring API directly ----------
let device = null;
try { const me = await ring.me(); log('PASS', 'GET /v1/users/me', `account ${String(me?.data?.id || '').slice(0, 18)}…`); }
catch (e) { log('FAIL', 'GET /v1/users/me', `${e.status} ${e.status === 401 ? '(token expired? Playground tokens last ~30 min)' : e.message.slice(0, 80)}`); }
try {
  const doc = await ring.devices();
  const d = pickDevice(doc);
  device = summarizeDevice(d, doc.included);
  device ? log('PASS', 'GET /v1/devices', `${doc.data.length} device(s); using "${device.name}" (online: ${device.online})`) : log('FAIL', 'GET /v1/devices', 'no devices');
} catch (e) { log('FAIL', 'GET /v1/devices', `${e.status}`); }
if (device) {
  try { const s = await ring.status(device.id); log('PASS', 'GET /v1/devices/{id}/status', JSON.stringify(s?.data?.attributes || {}).slice(0, 60)); } catch (e) { log('FAIL', 'GET status', `${e.status}`); }
  try { const c = await ring.capabilities(device.id); log('PASS', 'GET /v1/devices/{id}/capabilities', Object.keys(c?.data?.attributes || {}).join(', ').slice(0, 70)); } catch (e) { log('FAIL', 'GET capabilities', `${e.status}`); }
  try { const h = await ring.history(device.id, { eventTypes: 'motion,ding,on_demand' }); const n = Array.isArray(h?.data) ? h.data.length : 0; log(n ? 'PASS' : 'INFO', 'GET /v1/history/devices/{id}/events', `${n} event(s)${n ? '' : ' (Playground history is often empty: expected)'}`); } catch (e) { log('INFO', 'GET history', `${e.status} (history is thin in the Playground)`); }
  try {
    const snap = await ring.snapshot(device.id);
    if (snap.ok) { writeFileSync('/tmp/dropzone-playground-snapshot.jpg', snap.bytes); log('PASS', 'POST media/image/download → 303 → GET', `${snap.bytes.length} bytes, origin ${snap.origin || 'n/a'}, frame age ${snap.mediaTimestamp ? Math.round((Date.now() - snap.mediaTimestamp) / 1000) + 's' : 'n/a'}`); }
    else log('INFO', 'POST media/image/download', `not available (${snap.status}): ${String(snap.reason).slice(0, 80)}. DropZone+ reports UNKNOWN for this; live view still works`);
  } catch (e) { log('INFO', 'POST media/image/download', `${e.status || ''} ${e.message.slice(0, 80)}`); }
}

// ---------- 2. PWA in headless Chrome against server.js ----------
const chromeBin = process.env.CHROME_BIN || ['google-chrome', 'chromium', 'chromium-browser'].find((b) => { try { execSync(`command -v ${b}`, { stdio: 'ignore' }); return true; } catch { return false; } });
if (!device || !chromeBin) {
  log('SKIP', 'PWA live path', !device ? 'no device' : 'no Chrome found');
} else {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const kids = [spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })];
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/config'); break; } catch { await sleep(100); } }
  const dport = 9300 + Math.floor(Math.random() * 500);
  kids.push(spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${dport}`, `--user-data-dir=/tmp/dz-pg-${dport}`, 'about:blank'], { stdio: 'ignore' }));
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} if (!target) await sleep(200); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { pending.get(d.id)?.(d.result); pending.delete(d.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`/tmp/dropzone-playground-${name}.png`, Buffer.from(s.data, 'base64')); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: `${base}/app/` }); await sleep(1200);
  const seed = { onboarded: true, connection: { mode: 'live', method: 'playground-token', at: Date.now() }, camera: { id: device.id, name: device.name },
    zones: [{ id: 'z1', name: 'Front path', desc: 'In front of the door', polygon: [[0.35, 0.55], [0.65, 0.55], [0.7, 0.9], [0.3, 0.9]], hazards: [], cameraId: device.id, isDefault: true }],
    partners: { skyhop: { linked: true, zoneId: 'z1' } }, settings: { notifications: false, alexa: true, petDoor: true, theme: 'dark', speak: false }, deliveries: [] };
  await ev(`localStorage.setItem('dropzone.app.v1', ${JSON.stringify(JSON.stringify(seed))}); location.hash='#/home'; location.reload(); true`);
  await sleep(6000); // first snapshot + COCO-SSD load
  const hero = await ev(`document.querySelector('#hero')?.innerText || ''`);
  const tag = await ev(`document.querySelector('#camTag')?.innerText || ''`);
  /CLEAR|UNKNOWN/.test(hero) ? log('PASS', 'PWA: Check now (Ring snapshot) → verdict', `${hero.split('\n')[1] || ''} · ${tag}`) : log('FAIL', 'PWA: snapshot verdict', hero.slice(0, 80));
  await shot('1-home');

  await ev(`document.querySelector('#live').click(); true`);
  let vw = 0;
  for (let i = 0; i < 30 && !vw; i++) { await sleep(500); vw = await ev(`document.querySelector('#cam video')?.videoWidth || 0`); }
  const calls = async () => ev(`fetch('/api/ring/calls').then(r=>r.json())`);
  const whepCall = (await calls()).reverse().find((c) => /whep\/sessions/.test(c.path) && c.method === 'POST');
  if (vw) log('PASS', 'PWA: Live view (WHEP, recvonly) → video frames', `${vw}px wide, POST ${whepCall?.status}`);
  else if (!official && whepCall?.status === 501) log('SKIP', 'PWA: Live view (WHEP)', 'not mocked by ring-partner-sandbox (501): run against the real Playground');
  else log('FAIL', 'PWA: Live view (WHEP)', `no video; POST whep → ${whepCall?.status ?? 'not called'}`);
  await shot('2-live');

  if (vw) {
    await ev(`document.querySelector('#check').click(); true`); await sleep(4000);
    const st = await ev(`fetch('/api/state').then(r=>r.json())`);
    st?.verdict?.source === 'ring-live' ? log('PASS', 'PWA: detection on the live frame (COCO-SSD) → verdict', `${st.verdict.status}, ${st.verdict.objects.length} object(s)`) : log('FAIL', 'PWA: detection on live frame', JSON.stringify(st?.verdict?.source));
    await shot('3-live-checked');
  }
  const adv = await ev(`fetch('/api/v1/advisory').then(r=>r.json())`);
  adv?.schema === 'dropzone-plus/advisory@1' && adv.authorises_drop === false ? log('PASS', 'GET /api/v1/advisory (carrier, veto-only)', `${adv.advice} · zone ${adv.zone_status}`) : log('FAIL', 'advisory', JSON.stringify(adv).slice(0, 80));
  if (vw) {
    await ev(`document.querySelector('#live').click(); true`); await sleep(1500);
    const del = (await calls()).reverse().find((c) => c.method === 'DELETE');
    del ? log('PASS', 'WHEP session closed (DELETE)', `${del.status}`) : log('FAIL', 'WHEP DELETE', 'not called');
  }
  kids.forEach((k) => k.kill('SIGKILL'));
}

const fails = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${results.filter((r) => r.status === 'PASS').length} pass · ${fails} fail · ${results.filter((r) => r.status === 'SKIP').length} skip · ${results.filter((r) => r.status === 'INFO').length} info`);
writeFileSync('/tmp/dropzone-playground-results.json', JSON.stringify({ at: new Date().toISOString(), target: official ? 'ring-playground' : RING_API, results }, null, 2));
process.exit(fails ? 1 : 0);
