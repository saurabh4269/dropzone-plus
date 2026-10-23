#!/usr/bin/env node
// End-to-end walk through the homeowner PWA at phone size (390x844) with local Chrome over CDP.
// Onboarding (demo home) -> camera -> permissions -> draw/save zone -> link example partner ->
// simulated delivery (sped up) -> proof of drop in Deliveries. Screenshots: /tmp/dropzone-app-*.png
// Usage: npm run e2e:app            (starts server.js)   |   npm run e2e:app -- https://…/dropzone-plus/
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeBin = process.env.CHROME_BIN || ['google-chrome', 'chromium', 'chromium-browser'].find((b) => { try { execSync(`command -v ${b}`, { stdio: 'ignore' }); return true; } catch { return false; } });
if (!chromeBin) { console.log('SKIP: no Chrome/Chromium found'); process.exit(0); }
let base = process.argv[2];
const kids = [];
if (!base) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  kids.push(spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: String(port), RING_ACCESS_TOKEN: '' }, stdio: 'ignore' }));
  base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await sleep(100); } }
}
const dport = 9300 + Math.floor(Math.random() * 500);
kids.push(spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dport}`, `--user-data-dir=/tmp/dz-app-${dport}`, 'about:blank'], { stdio: 'ignore' }));
const done = (c) => { kids.forEach((k) => k.kill('SIGKILL')); process.exit(c); };
let target;
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} if (!target) await sleep(200); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { pending.get(d.id)?.(d.result); pending.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp('Runtime.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const ev = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const click = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true})()`);
const text = () => ev(`document.querySelector('#view').innerText`);
let n = 0, failed = 0;
const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`/tmp/dropzone-app-${String(++n).padStart(2, '0')}-${name}.png`, Buffer.from(s.data, 'base64')); };
const check = async (name, cond) => { const ok = await cond(); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

await cdp('Page.navigate', { url: `${base}app/` });
await sleep(1500);
await ev('localStorage.clear()'); await cdp('Page.reload'); await sleep(1500);
await check('welcome screen', async () => /drone-ready/.test(await text()));
await shot('welcome');
await click('#go'); await sleep(400);
await check('connect: demo option present, Ring link explained', async () => /demo home/i.test(await text()) && /Link Ring account/.test(await text()));
await shot('connect');
await click('#demo'); await sleep(600);
await check('camera list shows names + offline state', async () => /Backyard Cam/.test(await text()) && /Offline/.test(await text()));
await shot('camera');
await click('#cams button[data-id="demo-backyard"]'); await sleep(400);
await shot('permissions');
await click('#next'); await sleep(1200);
await check('zone editor shows camera + handles', async () => /Drag the corners/.test(await text()));
await click('#hz'); await sleep(300); await click('[data-k="pool"]'); await sleep(500);
await shot('zone-editor');
await click('#presets .chip'); await ev(`document.querySelector('#desc').value='Back lawn, left of the shed'`);
await click('#save'); await sleep(600);
await check('onboarding done', async () => /You’re set/.test(await text()));
await shot('done');
await click('#partners'); await sleep(500);
await shot('partners');
await click('[data-p="skyhop"]'); await sleep(400);
await shot('partner-sheet');
await click('#save'); await sleep(500);
await check('partner linked', async () => /Linked/.test(await text()));
await ev(`location.hash="#/home"`); await sleep(1200);
await shot('home-idle');
await click('#sim'); await sleep(1500);
await check('delivery inbound: NOT CLEAR + Alexa ask', async () => /NOT CLEAR/.test(await text()) && /Yes/.test(await text()));
await shot('home-inbound');
await click('#yes'); await sleep(300);
await click('#ownerHold'); await sleep(400);
await check('owner can ask the drone to wait (veto-only HOLD)', async () => /owner requested hold/i.test(await text()));
await shot('owner-hold');
await ev(`(()=>{const d=window.dropzoneApp.delivery; const now=d.clock.base+(performance.now()-d.clock.real)*d.speed; d.clock={base:now, real:performance.now()}; d.speed=60;})()`);
for (let i = 0; i < 40; i++) { await sleep(500); if (/Delivered|inside your drop zone|Landed/.test(await text())) break; }
await sleep(2500);
await shot('home-delivered');
await check('delivered with proof', async () => /Landed|Couldn’t confirm/.test(await text()));
await ev(`location.hash='#/deliveries'`); await sleep(600);
await check('history has the drop', async () => /Landed|Couldn’t confirm/.test(await text()));
await shot('deliveries');
await click('#view [data-id]'); await sleep(500); await shot('proof');
await ev(`location.hash='#/settings'`); await sleep(500); await shot('settings');
await check('settings shows privacy + delete', async () => /Delete all my data/.test(await text()));
await ev(`location.hash='#/zones'`); await sleep(400); await shot('zones');
const sw = await ev(`navigator.serviceWorker.getRegistration().then(r=>!!r)`);
await check('service worker registered', async () => sw);
const man = await ev(`fetch('manifest.webmanifest').then(r=>r.json()).then(m=>m.icons.length>=2 && m.display==='standalone')`);
await check('manifest installable fields', async () => man);
if (errors.length) { console.log('page exceptions:', errors); failed++; }
console.log(failed ? `${failed} check(s) failed` : 'all app checks passed');
done(failed ? 1 : 0);
