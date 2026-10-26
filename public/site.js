// DropZone website: hero loop, how it works frame, tagline reveal, scroll reveals, nav.
import { W, H, drawYard, drawActor, drawDrone, drawPackage, yardReady } from './scene.js';
import { DEFAULT_ZONE } from './scenarios.js';

window.__dzLanding = true;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, f) => a + (b - a) * f;
// Decelerating curve, the JS twin of cubic-bezier(0.22, 1, 0.36, 1).
const ease = (f) => 1 - (1 - f) ** 4;
const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));
const ZONE = DEFAULT_ZONE;
const FONT = 'Geist, system-ui, sans-serif';

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
  ask: '“Heads up: your drone delivery is about 8 minutes away, and there\'s a dog in the drop zone. Want me to set the pet door to come in only until the drone has left?”',
  ok: '“Okay. The pet door now lets the dog in but not out. I\'ll set it back once the drone has gone.”',
  hold: '“The drone is waiting about 60 seconds because someone is in the drop zone. It will try again after that.”',
  done: '“Your package was delivered inside the drop zone.”',
};

function heroState(t) {
  const s = {};
  if (t < 7.8) s.dog = { p: path(DOG, t), a: t > 7.3 ? 1 - seg(t, 7.3, 7.8) : 1 };
  else if (t > 19.3) s.dog = { p: DOG[0].slice(1), a: seg(t, 19.3, 20) };
  if (t >= 9.4 && t <= 12.0) s.kid = { p: path(KID, t), a: 1 };
  const dogIn = s.dog && t < 7.6 && t >= 0.8;
  const kidIn = s.kid && inZone(...s.kid.p);
  s.boxes = [];
  if (dogIn && s.dog.a > 0.5) s.boxes.push(['dog', ...boxOf('dog', ...s.dog.p)]);
  if (kidIn) s.boxes.push(['person', ...boxOf('kid', ...s.kid.p)]);
  if (t < 0.8 || t > 19.3) s.zone = ['checking', 'CHECKING', ''];
  else if (dogIn) s.zone = ['bad', 'NOT CLEAR', 'dog in the drop zone'];
  else if (kidIn) s.zone = ['bad', 'NOT CLEAR', 'person in the drop zone'];
  else if (t > 16) s.zone = ['ok', 'DELIVERED', 'inside the drop zone'];
  else s.zone = ['ok', 'CLEAR', ''];
  if (t < 7.6) s.eta = `Drone ${fmt(480 - t)} away`;
  else if (t < 10.3) s.eta = `Drone ${fmt(lerp(480 - 7.6, 60, seg(t, 7.6, 10.3)))} away`;
  else if (t < 12.8) s.eta = 'Drone holding 60 s';
  else if (t < 15.6) s.eta = 'Drone arriving';
  else s.eta = 'Delivered';
  s.adv = t < 10.3 ? ['', 'waiting'] : t < 12.8 ? ['hold', 'HOLD'] : ['ok', 'NO_ADVISORY'];
  s.holds = t < 10.3 ? '0 / 3' : '1 / 3';
  s.door = t >= 4.3 && t < 17 ? ['ring', 'come in only'] : ['', 'normal'];
  if (t >= 1.8 && t < 4.3) s.alexa = ['ask', SAY.ask];
  else if (t >= 4.3 && t < 7.6) s.alexa = ['ok', SAY.ok];
  else if (t >= 10.5 && t < 12.8) s.alexa = ['hold', SAY.hold];
  else if (t >= 16 && t < 18.6) s.alexa = ['done', SAY.done];
  s.press = t >= 3.9 && t < 4.3;
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
  const cam = $('#heroCam'), zone = $('#heroZone'), boxes = $('#heroBoxes'), status = $('#heroStatus'), eta = $('#heroEta'), bar = $('#heroBar');
  const alexa = $('#heroAlexa'), speech = $('#heroSpeech'), yes = $('#heroYes'), receipt = $('#heroReceipt');
  const pZone = $('#pZone'), pDoor = $('#pDoor'), pAdv = $('#pAdv'), pHolds = $('#pHolds');
  zone.setAttribute('points', ZONE.map(([x, y]) => `${x * W},${y * H}`).join(' '));
  const last = {};
  const set = (key, el, fn, val) => {
    const k = JSON.stringify(val); if (last[key] === k) return;
    const first = !(key in last); last[key] = k; fn(el, val);
    if (!first && el.tagName === 'DD') { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  };

  function render(t) {
    const s = heroState(t);
    drawYard(ctx, 'day');
    if (s.pkg) { ctx.save(); ctx.globalAlpha = s.pkg.a; drawPackage(ctx, DROP[0], s.pkg.y); ctx.restore(); }
    if (s.dog) { ctx.save(); ctx.globalAlpha = s.dog.a; drawActor(ctx, '🐕', s.dog.p[0], s.dog.p[1], SIZE.dog / 0.9 * per(s.dog.p[1])); ctx.restore(); }
    if (s.kid) drawActor(ctx, '🧒', s.kid.p[0], s.kid.p[1], SIZE.kid * per(s.kid.p[1]));
    if (s.drone) drawDrone(ctx, ...s.drone);
    set('zs', zone, (e, v) => (e.dataset.s = v), s.zone[0]);
    set('bx', boxes, (e, v) => {
      e.innerHTML = v.map(([l, x, y, w, h]) => `<rect class="box" x="${x * W}" y="${y * H}" width="${w * W}" height="${h * H}" rx="6"/><g class="boxlbl"><rect x="${x * W}" y="${y * H - 30}" width="${l.length * 10 + 46}" height="26" rx="4"/><text x="${x * W + 8}" y="${y * H - 11}">${l} ${l === 'dog' ? 94 : 91}%</text></g>`).join('');
    }, s.boxes.map((b) => [b[0], ...b.slice(1).map((n) => +n.toFixed(3))]));
    set('st', status, (e, v) => { e.dataset.s = v[0]; e.querySelector('b').textContent = v[1]; e.querySelector('.why').textContent = v[2]; }, s.zone);
    set('eta', eta, (e, v) => (e.textContent = v), s.eta);
    set('pz', pZone, (e, v) => { e.dataset.s = v[0]; e.textContent = v[0] === 'checking' ? 'checking' : v[1] === 'DELIVERED' ? 'CLEAR' : v[1]; }, s.zone.slice(0, 2));
    set('pd', pDoor, (e, v) => { e.dataset.s = v[0]; e.textContent = v[1]; }, s.door);
    set('pa', pAdv, (e, v) => { e.dataset.s = v[0]; e.textContent = v[1]; }, s.adv);
    set('ph', pHolds, (e, v) => (e.textContent = v), s.holds);
    set('al', alexa, (e, v) => {
      e.classList.toggle('on', !!v); e.classList.toggle('asking', v?.[0] === 'ask');
      if (v) speech.textContent = v[1];
    }, s.alexa || null);
    yes.classList.toggle('press', s.press);
    receipt.classList.toggle('on', s.receipt);
    bar.style.transform = `scaleX(${(t / LOOP).toFixed(4)})`;
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
  yardReady.then(() => { cam.classList.add('ready'); reduce.matches ? still() : (render(offset), start()); });
}

/* ---------- how it works: three stills, the sticky frame follows the active step ---------- */
const POOL = [[0.713, 0.275], [0.995, 0.36], [0.995, 0.578], [0.762, 0.538]];
const POOL_ZONE = [[0.53, 0.38], [0.68, 0.38], [0.70, 0.56], [0.51, 0.56]];
function poly(ctx, pts, stroke, fill, dash = [14, 9]) {
  ctx.save(); ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.setLineDash(dash); ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.stroke(); ctx.restore();
}
function tag(ctx, text, x, y, bg, fg = '#fff') {
  ctx.save(); ctx.font = `600 28px ${FONT}`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y - 38, tw + 24, 38, 6); ctx.fill();
  ctx.fillStyle = fg; ctx.fillText(text, x + 12, y - 10); ctx.restore();
}
function box(ctx, kind, label, x, y) {
  const [bx, by, bw, bh] = boxOf(kind, x, y);
  ctx.save(); ctx.strokeStyle = '#FF5A4F'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.roundRect(bx * W, by * H, bw * W, bh * H, 6); ctx.stroke(); ctx.restore();
  tag(ctx, label, bx * W, by * H - 4, '#FF5A4F');
}
function initStory() {
  const frame = $('#storyFrame'); if (!frame) return;
  const L = (c) => frame.querySelector(`.${c}`).getContext('2d');
  const dog = [0.535, 0.585], kid = [0.53, 0.6];
  const paint = () => {
    let c = L('l1'); drawYard(c, 'day');
    poly(c, POOL, '#F5B83D', 'rgba(245,184,61,.16)', [8, 8]); tag(c, 'Pool', POOL[0][0] * W + 16, POOL[0][1] * H + 40, '#F5B83D', '#000');
    poly(c, POOL_ZONE, '#FFFFFF', 'rgba(255,255,255,.12)'); tag(c, 'Back lawn', POOL_ZONE[0][0] * W, POOL_ZONE[0][1] * H - 8, '#FFFFFF', '#000');
    c = L('l2'); drawYard(c, 'day'); poly(c, ZONE, '#FF5A4F', 'rgba(255,90,79,.16)'); drawActor(c, '🐕', ...dog, 0.12 * per(dog[1])); box(c, 'dog', 'dog 94%', ...dog);
    c = L('l3'); drawYard(c, 'day'); poly(c, ZONE, '#FF5A4F', 'rgba(255,90,79,.16)'); drawActor(c, '🧒', ...kid, 0.2 * per(kid[1])); box(c, 'kid', 'person 91%', ...kid); drawDrone(c, 0.535, 0.1, 0.62);
  };
  paint(); yardReady.then(paint);
  if (document.fonts?.ready) document.fonts.ready.then(paint);

  const steps = $$('.step');
  const activate = (n) => { frame.dataset.step = n; steps.forEach((s) => s.classList.toggle('active', s.dataset.step === String(n))); };
  activate(1);
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) activate(e.target.dataset.step);
  }, { rootMargin: innerWidth < 960 ? '-62% 0px -22% 0px' : '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
}

/* ---------- tagline: each word brightens as it crosses a line 60% down the viewport ---------- */
function initTagline() {
  const p = $('#tagline'); if (!p) return;
  const wrapWords = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.append(part);
          else { const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.append(s); }
        });
        child.replaceWith(frag);
      } else if (child.nodeType === 1) wrapWords(child);
    }
  };
  wrapWords(p);
  const words = $$('.w', p);
  const hl = $('.hl', p);
  if (reduce.matches || !('IntersectionObserver' in window)) { words.forEach((w) => w.classList.add('on')); hl?.classList.add('on'); return; }
  const sync = () => hl?.classList.toggle('on', $$('.w', hl).every((w) => w.classList.contains('on')));
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      // Above the trigger line (or scrolled past the top) means read; below it means not yet.
      e.target.classList.toggle('on', e.isIntersecting || e.boundingClientRect.top < 0);
    }
    sync();
  }, { rootMargin: '0px 0px -40% 0px', threshold: 1 });
  words.forEach((w) => io.observe(w));
}

/* ---------- reveals ---------- */
function initReveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const groups = new Map();
  els.forEach((e) => { const p = e.parentElement; const i = groups.get(p) || 0; groups.set(p, i + 1); e.style.setProperty('--d', `${Math.min(i, 5) * 60}ms`); });
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

/* ---------- nav: scrolled state, current section, mobile sheet ---------- */
function initNav() {
  const nav = $('.nav'), sheet = $('#sheet'), toggle = $('.toggle'); if (!nav) return;
  const hero = $('.hero');
  new IntersectionObserver(([e]) => nav.classList.toggle('scrolled', !e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' }).observe(hero);

  const links = $$('a[href^="#"]', nav).concat($$('a.sl', sheet));
  const ids = [...new Set(links.map((a) => a.getAttribute('href').slice(1)))];
  const mark = (id) => links.forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === `#${id}` ? 'true' : 'false'));
  const spy = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) mark(e.target.id);
  }, { rootMargin: '-50% 0px -49% 0px' });
  ids.forEach((id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
  new IntersectionObserver(([e]) => { if (e.isIntersecting) mark(''); }, { rootMargin: '-50% 0px -49% 0px' }).observe(hero);

  // Sheet items arrive in reading order, 60 ms apart, capped at 400 ms in total.
  [...sheet.children].forEach((el, i) => el.style.setProperty('--d', `${Math.min(i * 60, 400)}ms`));
  const setOpen = (open) => {
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    sheet.inert = !open;
    document.documentElement.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('menu-open')));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setOpen(false); toggle.focus(); } });
  matchMedia('(min-width: 861px)').addEventListener?.('change', (m) => m.matches && setOpen(false));
}

initNav(); initReveal(); initHero(); initStory(); initTagline();
