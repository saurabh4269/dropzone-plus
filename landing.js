// DropZone landing: hero loop, scroll story, reveals, in-page app.
import { W, H, drawYard, drawActor, drawDrone, drawPackage, yardReady } from './scene.js';
import { DEFAULT_ZONE } from './scenarios.js';

window.__dzLanding = true;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, f) => a + (b - a) * f;
const ease = (f) => (f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2);
const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));
const ZONE = DEFAULT_ZONE;

const ASPECT = { dog: 360 / 271, kid: 195 / 420 };
const SIZE = { dog: 0.12 * 0.9, kid: 0.2 };
const per = (y) => 0.55 + 0.75 * y;
function boxOf(kind, x, y) {
  const h = SIZE[kind] * per(y), w = h * ASPECT[kind] * (H / W);
  return [x - w / 2 - 0.006, y - h - 0.01, w + 0.012, h + 0.016];
}
function inZone(x, y) {
  let c = false;
  for (let i = 0, j = ZONE.length - 1; i < ZONE.length; j = i++) {
    const [xi, yi] = ZONE[i], [xj, yj] = ZONE[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function path(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const f = ease((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
    return [lerp(keys[i - 1][1], keys[i][1], f), lerp(keys[i - 1][2], keys[i][2], f)];
  }
  return keys[keys.length - 1].slice(1);
}

/* ---------- hero: one 20 s loop, a pure function of t ---------- */
const LOOP = 20;
const DOG = [[0, 0.535, 0.585], [5.0, 0.535, 0.585], [5.8, 0.47, 0.61], [7.6, 0.13, 0.735]];
const KID = [[9.4, 1.06, 0.66], [10.4, 0.6, 0.62], [10.9, 0.52, 0.6], [11.4, 0.38, 0.8], [12.0, 0.1, 0.98]];
const DROP = [0.535, 0.6];
const SAY = {
  ask: '“Heads up: your drone delivery is about 8 minutes away, and there\'s a dog in the drop zone. Want me to set the pet door to come-in-only until the drone has left?”',
  ok: '“Okay. The pet door is now come-in-only. I\'ll set it back once the drone has gone.”',
  hold: '“The drone is waiting about 60 seconds because there\'s someone in the drop zone. It will try again after that.”',
  done: '“Your package has been delivered to the drop zone.”',
};

function heroState(t) {
  const s = {};
  // dog
  if (t < 7.8) s.dog = { p: path(DOG, t), a: t > 7.3 ? 1 - seg(t, 7.3, 7.8) : 1 };
  else if (t > 19.3) s.dog = { p: DOG[0].slice(1), a: seg(t, 19.3, 20) };
  // kid
  if (t >= 9.4 && t <= 12.0) s.kid = { p: path(KID, t), a: 1 };
  const dogIn = s.dog && t < 7.6 && t >= 0.8;
  const kidIn = s.kid && inZone(...s.kid.p);
  s.boxes = [];
  if (dogIn && s.dog.a > 0.5) s.boxes.push(['dog', ...boxOf('dog', ...s.dog.p)]);
  if (kidIn) s.boxes.push(['person', ...boxOf('kid', ...s.kid.p)]);
  // zone status
  if (t < 0.8 || t > 19.3) s.zone = ['checking', 'Checking', ''];
  else if (dogIn) s.zone = ['bad', 'NOT CLEAR', 'dog in the drop zone'];
  else if (kidIn) s.zone = ['bad', 'NOT CLEAR', 'person in the drop zone'];
  else if (t > 16) s.zone = ['ok', 'Delivered', 'inside the drop zone'];
  else s.zone = ['ok', 'CLEAR', ''];
  // ETA
  if (t < 7.6) s.eta = `Drone ${fmt(480 - t)} away`;
  else if (t < 10.3) s.eta = `Drone ${fmt(lerp(480 - 7.6, 60, seg(t, 7.6, 10.3)))} away`;
  else if (t < 12.8) s.eta = 'Drone waiting 60 s';
  else if (t < 15.6) s.eta = 'Drone arriving';
  else s.eta = 'Delivered';
  // carrier
  s.adv = t < 10.3 ? ['', 'waiting'] : t < 12.8 ? ['hold', 'HOLD · PERSON_IN_ZONE'] : ['ok', 'NO_ADVISORY'];
  s.holds = t < 10.3 ? '0 / 3' : '1 / 3';
  s.door = t >= 4.3 && t < 17 ? ['ring', 'come-in-only'] : ['', 'normal'];
  // alexa
  if (t >= 1.8 && t < 4.3) s.alexa = ['ask', SAY.ask];
  else if (t >= 4.3 && t < 7.6) s.alexa = ['ok', SAY.ok];
  else if (t >= 10.5 && t < 12.8) s.alexa = ['hold', SAY.hold];
  else if (t >= 16 && t < 18.6) s.alexa = ['done', SAY.done];
  s.press = t >= 3.9 && t < 4.3;
  // drone + package
  if (t >= 13 && t < 17.4) {
    const down = seg(t, 13, 15.0), up = seg(t, 15.6, 17.4);
    const y = lerp(-0.12, 0.36, down) - lerp(0, 0.5, up);
    s.drone = [DROP[0], y, lerp(0.75, 1.05, down) - up * 0.2];
  }
  if (t >= 15.0) s.pkg = { a: t > 19.0 ? 1 - seg(t, 19.0, 19.6) : 1, y: lerp(0.5, DROP[1], seg(t, 15.0, 15.35)) };
  s.receipt = t >= 16.2 && t < 19.2;
  return s;
}
function fmt(sec) { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

function initHero() {
  const canvas = $('#heroCanvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const zone = $('#heroZone'), boxes = $('#heroBoxes'), status = $('#heroStatus'), eta = $('#heroEta'), bar = $('#heroTl i');
  const alexa = $('#heroAlexa'), speech = $('#heroSpeech'), yes = $('#heroYes'), receipt = $('#heroReceipt');
  const pZone = $('#pZone'), pDoor = $('#pDoor'), pAdv = $('#pAdv'), pHolds = $('#pHolds');
  zone.setAttribute('points', ZONE.map(([x, y]) => `${x * W},${y * H}`).join(' '));
  const last = {};
  const set = (key, el, fn, val) => { const k = JSON.stringify(val); if (last[key] === k) return; const first = !(key in last); last[key] = k; fn(el, val); if (!first && el.classList.contains('flashable')) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } };
  [pZone, pDoor, pAdv, pHolds].forEach((e) => e.classList.add('flashable'));

  function render(t) {
    const s = heroState(t);
    drawYard(ctx, 'day');
    if (s.pkg) { ctx.save(); ctx.globalAlpha = s.pkg.a; drawPackage(ctx, DROP[0], s.pkg.y); ctx.restore(); }
    if (s.dog) { ctx.save(); ctx.globalAlpha = s.dog.a; drawActor(ctx, '🐕', s.dog.p[0], s.dog.p[1], SIZE.dog / 0.9 * per(s.dog.p[1])); ctx.restore(); }
    if (s.kid) drawActor(ctx, '🧒', s.kid.p[0], s.kid.p[1], SIZE.kid * per(s.kid.p[1]));
    if (s.drone) drawDrone(ctx, ...s.drone);
    set('zs', zone, (e, v) => (e.dataset.s = v), s.zone[0]);
    set('bx', boxes, (e, v) => {
      e.innerHTML = v.map(([l, x, y, w, h]) => `<rect class="box" x="${x * W}" y="${y * H}" width="${w * W}" height="${h * H}" rx="6"/><g class="boxlbl"><rect x="${x * W}" y="${y * H - 30}" width="${l.length * 11 + 46}" height="26" rx="5"/><text x="${x * W + 8}" y="${y * H - 11}">${l} ${l === 'dog' ? 94 : 91}%</text></g>`).join('');
    }, s.boxes.map((b) => [b[0], ...b.slice(1).map((n) => +n.toFixed(3))]));
    set('st', status, (e, v) => { e.dataset.s = v[0]; e.querySelector('b').textContent = v[1]; e.querySelector('.why').textContent = v[2]; }, s.zone);
    set('eta', eta, (e, v) => (e.textContent = v), s.eta);
    set('pz', pZone, (e, v) => { e.dataset.s = v[0]; e.textContent = v[0] === 'checking' ? 'Checking' : v[1] === 'Delivered' ? 'CLEAR' : v[1]; }, s.zone.slice(0, 2));
    set('pd', pDoor, (e, v) => { e.dataset.s = v[0]; e.textContent = v[1]; }, s.door);
    set('pa', pAdv, (e, v) => { e.dataset.s = v[0]; e.textContent = v[1]; }, s.adv);
    set('ph', pHolds, (e, v) => (e.textContent = v), s.holds);
    set('al', alexa, (e, v) => {
      e.classList.toggle('on', !!v); e.classList.toggle('asking', v?.[0] === 'ask');
      if (v) speech.textContent = v[1];
    }, s.alexa || null);
    yes.classList.toggle('press', s.press);
    receipt.classList.toggle('on', s.receipt);
    bar.style.width = `${(t / LOOP) * 100}%`;
  }

  let t0 = null, raf = 0, visible = true, offset = 0;
  const loop = (now) => {
    if (t0 === null) t0 = now - offset * 1000;
    const t = ((now - t0) / 1000) % LOOP;
    offset = t; render(t);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (raf || reduce.matches || !visible || document.hidden) return; t0 = null; raf = requestAnimationFrame(loop); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  const still = () => { stop(); render(3.2); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }, { threshold: 0.05 }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduce.addEventListener?.('change', () => (reduce.matches ? still() : start()));
  render(0);
  yardReady.then(() => (reduce.matches ? still() : (render(offset), start())));

  // gentle tilt-in as the stage scrolls into place (desktop only)
  const stage = $('#heroStage');
  const tilt = () => {
    if (reduce.matches || innerWidth < 900 || innerWidth >= 1200) { stage.style.transform = ''; return; }
    const f = clamp(scrollY / 420);
    stage.style.transform = `rotateX(${lerp(10, 0, f).toFixed(2)}deg) scale(${lerp(0.96, 1, f).toFixed(4)})`;
  };
  addEventListener('scroll', () => requestAnimationFrame(tilt), { passive: true });
  addEventListener('resize', tilt); tilt();
}

/* ---------- story: four stills, sticky frame switches with the active step ---------- */
function zonePath(ctx, stroke, fill, dash = [14, 9]) {
  ctx.save(); ctx.beginPath();
  ZONE.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.setLineDash(dash); ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.stroke(); ctx.restore();
}
function box(ctx, kind, label, x, y) {
  const [bx, by, bw, bh] = boxOf(kind, x, y);
  ctx.save(); ctx.strokeStyle = '#ff5a4f'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.roundRect(bx * W, by * H, bw * W, bh * H, 8); ctx.stroke();
  ctx.font = '600 20px Inter, system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = '#ff5a4f'; ctx.beginPath(); ctx.roundRect(bx * W, by * H - 32, tw + 18, 28, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(label, bx * W + 9, by * H - 11); ctx.restore();
}
function initStory() {
  const frame = $('#storyFrame'); if (!frame) return;
  const L = (c) => frame.querySelector(`.${c}`).getContext('2d');
  const dog = [0.535, 0.585], kid = [0.53, 0.6];
  const paint = () => {
    let c = L('l1'); drawYard(c, 'day'); zonePath(c, '#ff5a4f', 'rgba(217,45,32,.16)'); drawActor(c, '🐕', ...dog, 0.12 * per(dog[1])); box(c, 'dog', 'dog 94%', ...dog);
    c = L('l2'); drawYard(c, 'day'); zonePath(c, '#ff5a4f', 'rgba(217,45,32,.12)'); drawActor(c, '🐕', ...dog, 0.12 * per(dog[1])); c.fillStyle = 'rgba(12,18,32,.28)'; c.fillRect(0, 0, W, H);
    c = L('l3a'); drawYard(c, 'dusk'); zonePath(c, 'rgba(255,200,90,.9)', 'rgba(255,200,90,.06)');
    c = L('l3b'); drawYard(c, 'dusk-lit'); zonePath(c, '#35d37f', 'rgba(32,200,110,.14)');
    c = L('l4'); drawYard(c, 'day'); zonePath(c, '#ff5a4f', 'rgba(217,45,32,.16)'); drawActor(c, '🧒', ...kid, 0.2 * per(kid[1])); box(c, 'kid', 'person 91%', ...kid); drawDrone(c, 0.535, 0.1, 0.62);
  };
  paint(); yardReady.then(paint);
  if (document.fonts?.ready) document.fonts.ready.then(paint);

  const steps = $$('.step');
  const activate = (n) => { frame.dataset.step = n; steps.forEach((s) => s.classList.toggle('active', s.dataset.step === String(n))); };
  activate(1);
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) activate(e.target.dataset.step);
  }, { rootMargin: innerWidth < 900 ? '-62% 0px -22% 0px' : '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
}

/* ---------- reveals + nav ---------- */
function initReveal() {
  const els = $$('.reveal');
  if (reduce.matches || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const groups = new Map();
  els.forEach((e) => { const p = e.parentElement; const i = groups.get(p) || 0; groups.set(p, i + 1); e.style.setProperty('--d', `${Math.min(i, 5) * 0.07}s`); });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}
function initNav() {
  const nav = $('.nav'); if (!nav) return;
  const f = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', f, { passive: true }); f();
}

/* ---------- the real app, inside the phone ---------- */
function initPhone() {
  const btn = $('#tryHere'), screen = $('#phone .screen'), poster = $('#phonePoster');
  if (!btn || !screen) return;
  let frame = null;
  const fit = () => { if (!frame) return; const k = screen.clientWidth / 390; frame.style.transform = `scale(${k})`; frame.style.height = `${(screen.clientHeight - 34) / k}px`; };
  const appURL = new URL('./app/', location.href);
  const guard = () => {
    try {
      const w = frame.contentWindow, path = w.location.pathname;
      if (!path.startsWith(appURL.pathname)) { location.href = w.location.href; return; }
      w.document.addEventListener('click', (ev) => {
        const a = ev.target.closest?.('a[href]'); if (!a) return;
        const u = new URL(a.href, w.location.href);
        if (u.origin !== location.origin || !u.pathname.startsWith(appURL.pathname)) { ev.preventDefault(); location.href = u.href; }
      }, true);
    } catch { /* cross-origin: leave it */ }
  };
  btn.addEventListener('click', () => {
    if (frame) { frame.remove(); frame = null; poster.hidden = false; btn.textContent = 'Try it on this page'; return; }
    frame = document.createElement('iframe');
    frame.src = appURL.href; frame.title = 'DropZone app'; frame.loading = 'eager';
    frame.addEventListener('load', guard);
    screen.appendChild(frame); poster.hidden = true; fit();
    btn.textContent = 'Show the screenshot';
  });
  addEventListener('resize', fit);
}

initNav(); initReveal(); initHero(); initStory(); initPhone();
