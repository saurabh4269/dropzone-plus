// Proof of drop by change detection: compare a frame from just before the drop with one just after,
// find the largest new blob near the drop zone, and report where it is. No model and no "package"
// class needed, so it works on any Ring frame. Pure function on RGBA buffers (browser ImageData or tests).


export const CHANGE_DEFAULTS = Object.freeze({
  pixelThreshold: 48,   // max per-channel difference that counts as "changed"
  minBlobFrac: 0.0008,  // ignore specks smaller than this fraction of the frame
  maxGlobalFrac: 0.35,  // above this the whole scene changed (lighting, camera moved): don't guess
  searchMargin: 0.18,   // look this far (fraction of frame) around the zone and hazards
});

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} before
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} after  same size as before
 * @param {{zone:number[][], hazards?:{polygon:number[][]}[]}} area  normalised polygons
 * @returns {{ok:true, box:number[], blobFrac:number, globalFrac:number} | {ok:false, reason:string, globalFrac?:number}}
 */
export function findNewObject(before, after, { zone, hazards = [] }, opts = {}) {
  const o = { ...CHANGE_DEFAULTS, ...opts };
  const { width: w, height: h } = before;
  if (!w || !h || after.width !== w || after.height !== h) return { ok: false, reason: 'FRAME_SIZE_MISMATCH' };

  const mask = new Uint8Array(w * h);
  let changed = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const d = Math.max(Math.abs(before.data[p] - after.data[p]), Math.abs(before.data[p + 1] - after.data[p + 1]), Math.abs(before.data[p + 2] - after.data[p + 2]));
    if (d >= o.pixelThreshold) { mask[i] = 1; changed++; }
  }
  const globalFrac = changed / mask.length;
  if (globalFrac > o.maxGlobalFrac) return { ok: false, reason: 'SCENE_CHANGED', globalFrac };

  // Search window: bounding box of zone + hazards, expanded.
  const pts = [...zone, ...hazards.flatMap((hz) => hz.polygon)];
  const x0 = Math.max(0, Math.floor((Math.min(...pts.map((p) => p[0])) - o.searchMargin) * w));
  const x1 = Math.min(w - 1, Math.ceil((Math.max(...pts.map((p) => p[0])) + o.searchMargin) * w));
  const y0 = Math.max(0, Math.floor((Math.min(...pts.map((p) => p[1])) - o.searchMargin) * h));
  const y1 = Math.min(h - 1, Math.ceil((Math.max(...pts.map((p) => p[1])) + o.searchMargin) * h));

  // Connected components (4-neighbour) inside the window; keep the largest.
  const seen = new Uint8Array(w * h);
  let best = null;
  const stack = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x;
    if (!mask[i] || seen[i]) continue;
    let n = 0, bx0 = x, bx1 = x, by0 = y, by1 = y;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const jx = j % w, jy = (j - jx) / w;
      n++;
      if (jx < bx0) bx0 = jx; if (jx > bx1) bx1 = jx; if (jy < by0) by0 = jy; if (jy > by1) by1 = jy;
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= mask.length || seen[k] || !mask[k]) continue;
        const kx = k % w, ky = (k - kx) / w;
        if (Math.abs(kx - jx) > 1 || kx < x0 || kx > x1 || ky < y0 || ky > y1) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if (!best || n > best.n) best = { n, bx0, bx1, by0, by1 };
  }
  if (!best || best.n / mask.length < o.minBlobFrac) return { ok: false, reason: 'NOTHING_NEW_NEAR_ZONE', globalFrac };
  return {
    ok: true,
    box: [best.bx0 / w, best.by0 / h, (best.bx1 - best.bx0 + 1) / w, (best.by1 - best.by0 + 1) / h],
    blobFrac: best.n / mask.length,
    globalFrac,
  };
}

