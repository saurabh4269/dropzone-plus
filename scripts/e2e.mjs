#!/usr/bin/env node
// Browser end-to-end check of the replay demo, using a local Chrome over the DevTools protocol (no npm deps).
// Usage: npm run e2e            (starts server.js on a random port)
//        npm run e2e -- https://saurabh4269.github.io/dropzone-plus/   (check the deployed site)
// Saves screenshots to /tmp/dropzone-e2e-*.png. Exits non-zero on any failed check or page exception.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeBin = process.env.CHROME_BIN || ['google-chrome', 'chromium', 'chromium-browser'].find((b) => { try { execSync(`command -v ${b}`, { stdio: 'ignore' }); return true; } catch { return false; } });
if (!chromeBin) { console.log('SKIP: no Chrome/Chromium found (set CHROME_BIN)'); process.exit(0); }

let base = process.argv[2];
const kids = [];
if (!base) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  kids.push(spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: String(port), RING_ACCESS_TOKEN: '' }, stdio: 'ignore' }));
  base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await sleep(100); } }
}
const dport = 9300 + Math.floor(Math.random() * 500);
kids.push(spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dport}`, `--user-data-dir=/tmp/dz-e2e-${dport}`, 'about:blank'], { stdio: 'ignore' }));
const done = (code) => { kids.forEach((k) => k.kill('SIGKILL')); process.exit(code); };

let target;
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} if (!target) await sleep(200); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const exceptions = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { pending.get(d.id)?.(d.result); pending.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp('Runtime.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const text = (id) => `document.getElementById('${id}').innerText`;

const checks = [
  { name: 'saturday @T-1min: kid in zone -> HOLD', q: 'scenario=saturday&seek=425', expect: { statusBig: /NOT CLEAR/, adviceText: /HOLD/, holdsText: /1 \/ 3/, doorText: /in-only/ } },
  { name: 'saturday end: delivered in zone, door restored', q: 'scenario=saturday&seek=570', expect: { receiptBox: /inside the drop zone[\s\S]*change detection/, doorText: /normal/ } },
  { name: 'unknown: never CLEAR, no advisory', q: 'scenario=unknown&seek=200', expect: { statusBig: /UNKNOWN/, adviceText: /NO_ADVISORY/ } },
  { name: 'pool: audit warns, receipt by the pool', q: 'scenario=pool&seek=240', expect: { audit: /Pool is ~\d+ ft/, receiptBox: /next to the pool/ } },
  { name: 'pool + apply suggested zone: box lands in the new zone', q: 'scenario=pool', before: "document.querySelector('.suggest button').click(); window.dropzone.seek(240);", expect: { audit: /^(?![\s\S]*Suggested)[\s\S]*Pool is ~\d+ ft away/, receiptBox: /inside the drop zone/ } },
];
let failed = 0;
for (const c of checks) {
  await cdp('Page.navigate', { url: `${base}?${c.q}` });
  await sleep(1800);
  if (c.before) { await evaluate(c.before); await sleep(500); }
  const bad = [];
  for (const [elId, re] of Object.entries(c.expect)) { const v = await evaluate(text(elId)); if (!re.test(v || '')) bad.push(`${elId}=${JSON.stringify((v || '').slice(0, 80))}`); }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`/tmp/dropzone-e2e-${c.q.replace(/[^a-z0-9]+/gi, '-')}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${c.name}${bad.length ? '  ' + bad.join(' ') : ''}`);
  failed += bad.length ? 1 : 0;
}
if (exceptions.length) { console.log('page exceptions:', exceptions); failed++; }
console.log(failed ? `${failed} check(s) failed` : `all ${checks.length} browser checks passed`);
done(failed ? 1 : 0);
