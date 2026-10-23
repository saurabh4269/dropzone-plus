// Drop-zone readiness: turns object detections on a Ring frame into
// CLEAR / NOT_CLEAR / UNKNOWN. Pure functions, shared by browser and server.
// All coordinates are normalised to the frame (0..1), so any resolution works.

export const STATUS = Object.freeze({ CLEAR: 'CLEAR', NOT_CLEAR: 'NOT_CLEAR', UNKNOWN: 'UNKNOWN' });

// Labels only. We never identify who a person is or which dog it is.
const CATEGORY = {
  person: 'person',
  dog: 'pet', cat: 'pet', bird: 'pet', horse: 'pet', sheep: 'pet', cow: 'pet',
  car: 'vehicle', truck: 'vehicle', bus: 'vehicle', motorcycle: 'vehicle', bicycle: 'vehicle',
  chair: 'object', bench: 'object', umbrella: 'object', 'potted plant': 'object',
  'sports ball': 'object', suitcase: 'object', backpack: 'object', skateboard: 'object',
  'dining table': 'object', couch: 'object', kite: 'object', frisbee: 'object',
};

export const REASON = {
  person: 'PERSON_IN_ZONE',
  pet: 'PET_IN_ZONE',
  vehicle: 'VEHICLE_IN_ZONE',
  object: 'OBJECT_IN_ZONE',
};

export const DEFAULTS = Object.freeze({
  minScore: 0.45,        // detector confidence floor
  nearMargin: 0.06,      // "near the zone" buffer, fraction of frame width
  overCoverage: 0.25,    // an object hiding >= 25% of the zone blocks it even if its feet are elsewhere
  ttlSec: 90,            // a verdict expires after this long
  maxFrameAgeSec: 120,   // frames older than this cannot produce CLEAR
});

export function categorize(label) {
  return CATEGORY[String(label || '').toLowerCase()] || null;
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPolygon(pt, poly) {
  if (pointInPolygon(pt, poly)) return 0;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(pt, poly[j], poly[i]));
  return d;
}

// Where an object touches the ground: bottom-centre of its box.
export function footprint(box) {
  const [x, y, w, h] = box;
  return [x + w / 2, y + h];
}

/** Fraction of the zone covered by a box (grid sampling; cheap and good enough at frame scale). */
export function zoneCoverage(box, poly, n = 12) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let inZone = 0, covered = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const pt = [x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)];
    if (!pointInPolygon(pt, poly)) continue;
    inZone++;
    if (pt[0] >= box[0] && pt[0] <= box[0] + box[2] && pt[1] >= box[1] && pt[1] <= box[1] + box[3]) covered++;
  }
  return inZone ? covered / inZone : 0;
}

export function polygonCentroid(poly) {
  const n = poly.length;
  return poly.reduce(([sx, sy], [x, y]) => [sx + x / n, sy + y / n], [0, 0]);
}

/**
 * @param {object} p
 * @param {Array<{label:string, score:number, box:number[]}>} p.detections
 * @param {number[][]} p.zone        drop-zone polygon, normalised
 * @param {string|number} p.observedAt  when the frame was captured
 * @param {number} [p.now]          ms epoch (injectable for tests/replay)
 * @param {{readable:boolean, reason?:string}} [p.media]
 * @param {string} p.source         'ring-snapshot' | 'ring-live' | 'replay' | 'upload'
 */
export function evaluateZone({ detections = [], zone, observedAt, now = Date.now(), media = { readable: true }, source, opts = {} }) {
  const o = { ...DEFAULTS, ...opts };
  const observedMs = observedAt ? new Date(observedAt).getTime() : NaN;
  const base = {
    observed_at: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
    evaluated_at: new Date(now).toISOString(),
    stale_after: Number.isFinite(observedMs) ? new Date(observedMs + o.ttlSec * 1000).toISOString() : null,
    source,
    objects: [],
    reasons: [],
  };

  // UNKNOWN is a first-class answer, never silently turned into CLEAR.
  if (!zone || zone.length < 3) return { ...base, status: STATUS.UNKNOWN, reasons: [{ code: 'NO_ZONE_DEFINED' }] };
  if (!media.readable) return { ...base, status: STATUS.UNKNOWN, reasons: [{ code: 'MEDIA_UNREADABLE', detail: media.reason || 'frame not available' }] };
  if (!Number.isFinite(observedMs)) return { ...base, status: STATUS.UNKNOWN, reasons: [{ code: 'NO_TIMESTAMP' }] };
  if ((now - observedMs) / 1000 > o.maxFrameAgeSec) return { ...base, status: STATUS.UNKNOWN, reasons: [{ code: 'FRAME_TOO_OLD', detail: `${Math.round((now - observedMs) / 1000)}s old` }] };

  for (const d of detections) {
    const category = categorize(d.label);
    if (!category || (d.score ?? 1) < o.minScore) continue;
    const fp = footprint(d.box);
    const dist = distanceToPolygon(fp, zone);
    const where = dist === 0 ? 'in' : zoneCoverage(d.box, zone) >= o.overCoverage ? 'over' : dist <= o.nearMargin ? 'near' : 'outside';
    base.objects.push({ label: d.label, category, score: round(d.score ?? 1), box: d.box.map(round), where });
  }

  // People and pets near the edge count (they move); static objects only count if inside.
  const blocking = base.objects.filter((ob) => ob.where === 'in' || ob.where === 'over' || (ob.where === 'near' && (ob.category === 'person' || ob.category === 'pet')));
  if (blocking.length) {
    const seen = new Set();
    for (const ob of blocking) {
      const code = REASON[ob.category];
      if (seen.has(code + ob.where)) continue;
      seen.add(code + ob.where);
      base.reasons.push({ code, label: ob.label, where: ob.where });
    }
    return { ...base, status: STATUS.NOT_CLEAR };
  }
  return { ...base, status: STATUS.CLEAR };
}

/** A verdict past its stale_after time degrades to UNKNOWN. */
export function freshen(verdict, now = Date.now()) {
  if (!verdict) return { status: STATUS.UNKNOWN, reasons: [{ code: 'NO_OBSERVATION' }], objects: [] };
  if (verdict.stale_after && now > new Date(verdict.stale_after).getTime() && verdict.status !== STATUS.UNKNOWN) {
    return { ...verdict, status: STATUS.UNKNOWN, reasons: [{ code: 'EXPIRED', detail: `was ${verdict.status}` }] };
  }
  return verdict;
}

/**
 * One-off zone audit: owner-marked hazards (pool, patio edge, overhang) vs the zone.
 * We do not infer water from pixels; the owner marks it once on a Ring snapshot.
 */
export function auditZone(zone, hazards = [], { frameWidthFt = 40 } = {}) {
  const findings = [];
  if (!zone || zone.length < 3) return [{ level: 'error', code: 'NO_ZONE_DEFINED', text: 'Draw the drop zone first.' }];
  const c = polygonCentroid(zone);
  for (const h of hazards) {
    const gap = Math.min(...h.polygon.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), distanceToPolygon(c, h.polygon));
    const overlaps = zone.some((p) => pointInPolygon(p, h.polygon)) || h.polygon.some((p) => pointInPolygon(p, zone));
    const ft = Math.round(gap * frameWidthFt);
    if (overlaps) findings.push({ level: 'error', code: 'HAZARD_OVERLAPS_ZONE', hazard: h.kind, text: `${cap(h.kind)} overlaps the drop zone.` });
    else if (ft < (/pool|pond|water/i.test(h.kind) ? 15 : 10)) findings.push({ level: 'warn', code: 'HAZARD_NEAR_ZONE', hazard: h.kind, text: `${cap(h.kind)} is ~${ft} ft from the drop point (rough, from the camera view). Downwash can push a box this far.` });
    else findings.push({ level: 'ok', code: 'HAZARD_OK', hazard: h.kind, text: `${cap(h.kind)} is ~${ft} ft away.` });
  }
  return findings;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function round(n) { return Math.round(n * 1000) / 1000; }
