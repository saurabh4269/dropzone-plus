#!/usr/bin/env node
// Drives public/sim/ in local headless Chrome over the DevTools protocol (no npm deps):
// checks each scenario's outcome, saves screenshots, and builds docs/sim-preview.gif (needs python3 + PIL).
// Usage: node scripts/render-sim.mjs            (checks + screenshots + GIF)
//        node scripts/render-sim.mjs --check    (checks + screenshots only)
import { spawn, execSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const checkOnly = process.argv.includes('--check');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeBin = process.env.CHROME_BIN || ['google-chrome', 'chromium', 'chromium-browser'].find((b) => { try { execSync(`command -v ${b}`, { stdio: 'ignore' }); return true; } catch { return false; } });
if (!chromeBin) { console.log('SKIP: no Chrome/Chromium found (set CHROME_BIN)'); process.exit(0); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(pub, p.endsWith('/') ? p + 'index.html' : p);
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/sim/`;

const dport = 9800 + Math.floor(Math.random() * 400);
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${dport}`, `--user-data-dir=/tmp/dz-sim-${dport}`, 'about:blank'], { stdio: 'ignore' });
const done = (code) => { chrome.kill('SIGKILL'); server.close(); process.exit(code); };

let target;
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).find((t) => t.type === 'page'); } catch {} if (!target) await sleep(200); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id) { pending.get(d.id)?.(d.result); pending.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp('Runtime.enable'); await cdp('Page.enable');
const W = 1500, H = 1010;
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (file) => writeFile(file, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const open = async (q) => { await cdp('Page.navigate', { url: `${base}?${q}` }); for (let i = 0; i < 50; i++) { if (await evaluate('!!window.sim')) break; await sleep(200); } await sleep(300); };

const checks = [
  { name: 'dog-kid: kid near T-60 -> NOT_CLEAR + HOLD', sc: 'dog-kid', t: 56, expect: (s) => s.status === 'NOT_CLEAR' && s.advice === 'HOLD' },
  { name: 'dog-kid: dog in zone -> HOLD #2', sc: 'dog-kid', t: 92, expect: (s) => s.status === 'NOT_CLEAR' && s.holds >= 2 },
  { name: 'dog-kid: receipt in_zone (real findNewObject)', sc: 'dog-kid', t: 185, expect: (s) => s.receipt?.placement === 'in_zone' },
  { name: 'pool-gust: receipt hazard pool', sc: 'pool-gust', t: 160, expect: (s) => s.receipt?.placement === 'hazard' && s.receipt.hazard === 'pool' },
  { name: 'umbrella: 3 holds then drone-side abort', sc: 'umbrella', t: 160, expect: (s) => s.holds === 3 && s.phase === 'ABORTED' },
];
let failed = 0;
await mkdir('/tmp/dz-sim', { recursive: true });
for (const c of checks) {
  await open(`scenario=${c.sc}&play=0`);
  const s = await evaluate(`window.sim.seek(${c.t})`);
  await sleep(250);
  const ok = c.expect(s);
  failed += ok ? 0 : 1;
  await shot(`/tmp/dz-sim/${c.sc}-${c.t}.png`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}${ok ? '' : '  ' + JSON.stringify(s) + ' ' + JSON.stringify(await evaluate('window.sim.receipt()'))}`);
}
// README screenshot: dog in the zone, both views
await open('scenario=dog-kid&play=0'); await evaluate('window.sim.seek(150.5)'); await sleep(300);
await shot(join(root, 'docs/sim-screenshot.png'));

if (!checkOnly && !failed) {
  // GIF: dog-kid run, sampled every 1.6 simulated seconds (≈16x real time at 10 fps), plus the pool receipt.
  const dir = '/tmp/dz-sim/frames'; await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  let n = 0;
  const grab = async (sc, times) => {
    await open(`scenario=${sc}&play=0`);
    for (const tt of times) { await evaluate(`window.sim.seek(${tt})`); await sleep(60); await shot(`${dir}/${String(n++).padStart(4, '0')}.png`); }
  };
  const range = (a, b, s) => Array.from({ length: Math.floor((b - a) / s) + 1 }, (_, i) => +(a + i * s).toFixed(2));
  await grab('dog-kid', [...range(44, 70, 1), ...range(80, 116, 1.2), ...range(128, 160, 0.5), ...Array(8).fill(176)]);
  await grab('pool-gust', [...range(104, 124, 0.5), ...Array(10).fill(140)]);
  execFileSync('python3', ['-I', '-c', `
import glob, sys
from PIL import Image
files = [f for i, f in enumerate(sorted(glob.glob(sys.argv[1] + '/*.png'))) if i % 3 != 2]  # keep < 4 MB
frames = []
for f in files:
    im = Image.open(f).convert('RGB').crop((0, 0, 1500, 636))  # header + the two camera views
    im = im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
    frames.append(im.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=100, loop=0, optimize=True)
`, dir, join(root, 'docs/sim-preview.gif')], { stdio: 'inherit' });
  console.log(`GIF: docs/sim-preview.gif (${n} frames)`);
}
if (errors.length) { console.log('page exceptions:', errors); failed++; }
console.log(failed ? `${failed} check(s) failed` : `all ${checks.length} sim checks passed`);
done(failed ? 1 : 0);
