// Canvas drawing: the simulated yard (replay), plus overlays used in every mode
// (drop zone, hazards, detection boxes, drone, package).

export const W = 1280, H = 720;

export function drawYard(ctx) {
  // fence + hedge
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  sky.addColorStop(0, '#9fc3d9'); sky.addColorStop(1, '#cfe3ea');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.3);
  ctx.fillStyle = '#4c7a3a'; ctx.fillRect(0, H * 0.2, W, H * 0.12);
  for (let x = 0; x < W; x += 34) { ctx.fillStyle = x % 68 ? '#b79a74' : '#a88b66'; ctx.fillRect(x, H * 0.26, 30, H * 0.08); }
  // lawn
  const lawn = ctx.createLinearGradient(0, H * 0.33, 0, H);
  lawn.addColorStop(0, '#6f9d4a'); lawn.addColorStop(1, '#4f8a33');
  ctx.fillStyle = lawn; ctx.fillRect(0, H * 0.33, W, H);
  // mowing stripes
  ctx.globalAlpha = 0.06; ctx.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(W * (0.1 * i), H * 0.33); ctx.lineTo(W * (0.1 * i + 0.05), H * 0.33); ctx.lineTo(W * (0.12 * i - 0.2), H); ctx.lineTo(W * (0.12 * i - 0.25), H); ctx.fill(); }
  ctx.globalAlpha = 1;
  // house wall with pet door (left)
  ctx.fillStyle = '#d9cfc0'; ctx.beginPath(); ctx.moveTo(0, H * 0.18); ctx.lineTo(W * 0.16, H * 0.3); ctx.lineTo(W * 0.16, H * 0.5); ctx.lineTo(0, H * 0.62); ctx.fill();
  ctx.fillStyle = '#7b5a3c'; ctx.fillRect(W * 0.105, H * 0.36, W * 0.035, H * 0.08);
  ctx.fillStyle = '#5b412b'; ctx.fillRect(W * 0.11, H * 0.39, W * 0.025, H * 0.05);
  // patio slab
  ctx.fillStyle = '#b9b2a6'; ctx.beginPath(); ctx.moveTo(0, H * 0.62); ctx.lineTo(W * 0.16, H * 0.5); ctx.lineTo(W * 0.30, H * 0.52); ctx.lineTo(W * 0.18, H); ctx.lineTo(0, H); ctx.fill();
  // pool (right)
  ctx.fillStyle = '#e8e3da'; roundRect(ctx, W * 0.685, H * 0.485, W * 0.28, H * 0.19, 14); ctx.fill();
  const water = ctx.createLinearGradient(W * 0.7, H * 0.5, W * 0.95, H * 0.66);
  water.addColorStop(0, '#5fc3e4'); water.addColorStop(1, '#2b8fc0');
  ctx.fillStyle = water; roundRect(ctx, W * 0.70, H * 0.50, W * 0.25, H * 0.16, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(W * (0.72 + i * 0.05), H * 0.55); ctx.quadraticCurveTo(W * (0.74 + i * 0.05), H * 0.53, W * (0.76 + i * 0.05), H * 0.56); ctx.stroke(); }
  // tree
  ctx.fillStyle = '#6b4b2e'; ctx.fillRect(W * 0.3, H * 0.2, 14, H * 0.15);
  ctx.fillStyle = '#3e6b2c'; ctx.beginPath(); ctx.arc(W * 0.3 + 7, H * 0.17, 60, 0, Math.PI * 2); ctx.fill();
}

export function drawCameraChrome(ctx, { label, time, simulated }) {
  // doorbell-style fisheye vignette
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.font = '600 22px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(16, 16, ctx.measureText(label).width + 20, 34);
  ctx.fillStyle = '#fff'; ctx.fillText(label, 26, 41);
  if (time) { const tw = ctx.measureText(time).width; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W - tw - 36, 16, tw + 20, 34); ctx.fillStyle = '#fff'; ctx.fillText(time, W - tw - 26, 41); }
  if (simulated) {
    ctx.save(); ctx.font = '700 20px system-ui, sans-serif'; const t = 'SIMULATED FEED · REPLAY'; const tw = ctx.measureText(t).width;
    ctx.fillStyle = 'rgba(255,170,0,.9)'; ctx.fillRect(W / 2 - tw / 2 - 12, H - 46, tw + 24, 32); ctx.fillStyle = '#1b1300'; ctx.fillText(t, W / 2 - tw / 2, H - 23); ctx.restore();
  }
}

export function drawActor(ctx, emoji, x, y, size) {
  const px = size * H;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x * W, y * H, px * 0.4, px * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(emoji, x * W, y * H + px * 0.08);
  ctx.restore();
}

export function drawPolygon(ctx, poly, { stroke, fill, dash = [], width = 3, label, labelColor = '#fff' }) {
  if (!poly || poly.length < 2) return;
  ctx.save();
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
  if (poly.length > 2) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke();
  if (label) {
    const [x, y] = poly[0];
    ctx.font = '700 18px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.setLineDash([]); ctx.fillStyle = stroke; ctx.fillRect(x * W, y * H - 28, tw + 14, 26);
    ctx.fillStyle = labelColor; ctx.fillText(label, x * W + 7, y * H - 9);
  }
  ctx.restore();
}

export function drawDetections(ctx, objects, { scripted }) {
  ctx.save();
  for (const o of objects || []) {
    const [x, y, w, h] = o.box;
    const color = o.where === 'outside' ? 'rgba(255,255,255,.7)' : '#ff5a4f';
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash(scripted ? [6, 4] : []);
    ctx.strokeRect(x * W, y * H, w * W, h * H);
    ctx.setLineDash([]);
    const t = `${o.label} ${Math.round(o.score * 100)}%${scripted ? ' (scripted)' : ''}`;
    ctx.font = '600 16px system-ui, sans-serif';
    const tw = ctx.measureText(t).width;
    ctx.fillStyle = color; ctx.fillRect(x * W, y * H - 22, tw + 10, 22);
    ctx.fillStyle = '#111'; ctx.fillText(t, x * W + 5, y * H - 6);
  }
  ctx.restore();
}

export function drawDrone(ctx, x, y, scale = 1) {
  const cx = x * W, cy = y * H, s = 40 * scale;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(cx, cy + s * 2.6, s * 1.1, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 5 * scale;
  ctx.beginPath(); ctx.moveTo(cx - s, cy - s * 0.5); ctx.lineTo(cx + s, cy + s * 0.5); ctx.moveTo(cx + s, cy - s * 0.5); ctx.lineTo(cx - s, cy + s * 0.5); ctx.stroke();
  for (const [dx, dy] of [[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]]) { ctx.fillStyle = 'rgba(200,210,220,.7)'; ctx.beginPath(); ctx.ellipse(cx + dx * s, cy + dy * s, s * 0.55, s * 0.16, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#e9edf2'; roundRect(ctx, cx - s * 0.45, cy - s * 0.3, s * 0.9, s * 0.6, 8 * scale); ctx.fill();
  ctx.fillStyle = '#2b2f36'; ctx.fillRect(cx - s * 0.2, cy - s * 0.05, s * 0.4, s * 0.1);
  ctx.restore();
}

export function drawPackage(ctx, x, y) {
  const s = 34;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x * W, y * H, s * 0.8, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8975a'; ctx.fillRect(x * W - s / 2, y * H - s, s, s);
  ctx.fillStyle = '#a77a43'; ctx.fillRect(x * W - s / 2, y * H - s, s, 6);
  ctx.fillStyle = '#e6d3ae'; ctx.fillRect(x * W - 4, y * H - s, 8, s);
  ctx.restore();
}

export function drawUnreadable(ctx, reason) {
  ctx.fillStyle = '#15181d'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#9aa4b2'; ctx.font = '600 30px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('🔒  Frame not readable', W / 2, H / 2 - 10);
  ctx.font = '400 20px system-ui, sans-serif'; ctx.fillText(reason || '', W / 2, H / 2 + 26);
  ctx.textAlign = 'start';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
