// Minimal Ring Partner API client (https://api.amazonvision.com, JSON:API).
// Used at runtime whenever RING_ACCESS_TOKEN (Ring Developer Playground token) is set.
// No SDK exists, so this is plain fetch with the headers Ring's WAF requires.

import { randomUUID } from 'node:crypto';

export const RING_API = process.env.RING_API_BASE || 'https://api.amazonvision.com';
const UA = 'DropZonePlus/0.1';
// Ring wants a stable per-user/device UUID. We derive one per process unless pinned.
const HARDWARE_ID = process.env.RING_HARDWARE_ID || randomUUID();

export class RingError extends Error {
  constructor(status, body, path) {
    super(`Ring API ${status} on ${path}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export function ringConfigured() {
  return Boolean(process.env.RING_ACCESS_TOKEN);
}

function headers(extra = {}) {
  const token = process.env.RING_ACCESS_TOKEN;
  if (!token) throw new RingError(401, 'RING_ACCESS_TOKEN not set (replay mode)', '-');
  return { Authorization: `Bearer ${token}`, 'User-Agent': UA, Hardware_Id: HARDWARE_ID, ...extra };
}

// Small call log so the UI can show exactly which Ring endpoints were hit and how they answered.
export const callLog = [];
function note(method, path, status, ms) {
  callLog.push({ at: new Date().toISOString(), method, path: path.replace(/security_token=[^&]+/, 'security_token=…'), status, ms });
  if (callLog.length > 50) callLog.shift();
}

async function call(method, path, { body, contentType = 'application/json', accept, redirect = 'follow' } = {}) {
  const t0 = Date.now();
  const res = await fetch(path.startsWith('http') ? path : RING_API + path, {
    method,
    headers: headers({ ...(body !== undefined ? { 'Content-Type': contentType } : {}), ...(accept ? { Accept: accept } : {}) }),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect,
  });
  note(method, path.replace(RING_API, ''), res.status, Date.now() - t0);
  return res;
}

async function json(method, path, opts) {
  const res = await call(method, path, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new RingError(res.status, data, path);
  return data;
}

export const ring = {
  me: () => json('GET', '/v1/users/me'),
  devices: () => json('GET', '/v1/devices?include=status,capabilities'),
  device: (id) => json('GET', `/v1/devices/${encodeURIComponent(id)}`),
  status: (id) => json('GET', `/v1/devices/${encodeURIComponent(id)}/status`),
  capabilities: (id) => json('GET', `/v1/devices/${encodeURIComponent(id)}/capabilities`),
  history: (id, { eventTypes } = {}) =>
    json('GET', `/v1/history/devices/${encodeURIComponent(id)}/events${eventTypes ? `?event_types=${encodeURIComponent(eventTypes)}` : ''}`),

  /**
   * Snapshot: POST image/download -> 303 -> GET signed download URL -> JPEG.
   * Returns { ok, bytes, contentType, mediaTimestamp, origin } or { ok:false, status, reason }.
   * A failure here is not an error for DropZone+: it becomes an UNKNOWN verdict.
   */
  async snapshot(id, { sinceMs = 10 * 60 * 1000 } = {}) {
    const end = Date.now();
    const req = { type: 'latest_in_range', start_timestamp: end - sinceMs, end_timestamp: end, image_options: { format: 'jpeg' } };
    const first = await call('POST', `/v1/devices/${encodeURIComponent(id)}/media/image/download`, { body: req, redirect: 'manual' });
    let res = first;
    if (first.status >= 300 && first.status < 400) {
      const loc = first.headers.get('location');
      if (!loc) return { ok: false, status: first.status, reason: 'redirect without Location' };
      const t0 = Date.now();
      // The signed URL carries its own auth; don't leak the bearer token to the download host.
      res = await fetch(loc, { headers: { 'User-Agent': UA, Hardware_Id: HARDWARE_ID } });
      note('GET', new URL(loc).pathname + new URL(loc).search, res.status, Date.now() - t0);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, reason: text.slice(0, 300) || res.statusText };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const ts = Number(res.headers.get('x-media-timestamp'));
    return {
      ok: true,
      bytes,
      contentType: res.headers.get('content-type') || 'image/jpeg',
      mediaTimestamp: Number.isFinite(ts) && ts > 0 ? ts : null,
      origin: res.headers.get('x-media-origin') || null,
    };
  },

  /** WHEP: forward the browser's SDP offer, return SDP answer + session URL. */
  async whepStart(id, sdpOffer) {
    const res = await call('POST', `/v1/devices/${encodeURIComponent(id)}/media/streaming/whep/sessions`, { body: sdpOffer, contentType: 'application/sdp' });
    const text = await res.text();
    if (!res.ok) throw new RingError(res.status, text, 'whep');
    const loc = res.headers.get('location');
    return { sdpAnswer: text, sessionUrl: loc ? new URL(loc, RING_API).toString() : null };
  },
  async whepStop(sessionUrl) {
    if (!sessionUrl || !sessionUrl.startsWith(RING_API)) throw new RingError(400, 'bad session url', 'whep');
    const res = await call('DELETE', sessionUrl);
    return { ok: res.ok, status: res.status };
  },
};

/** Pick the first camera-ish device (Playground gives one simulated DoorbellPro). */
export function pickDevice(devicesDoc) {
  const list = Array.isArray(devicesDoc?.data) ? devicesDoc.data : [];
  const preferred = process.env.RING_DEVICE_ID && list.find((d) => d.id === process.env.RING_DEVICE_ID);
  return preferred || list[0] || null;
}

export function summarizeDevice(d, included = []) {
  if (!d) return null;
  const a = d.attributes || {};
  const rel = (type) => included.find((i) => i.type === type && (i.id === d.id || i.relationships?.device?.data?.id === d.id));
  const status = rel('status') || rel('device_status');
  return {
    id: d.id,
    name: a.name || a.description || a.device_name || d.id,
    kind: a.kind || a.type || a.model || d.type,
    online: status?.attributes?.online ?? a.online ?? null,
    raw: d,
  };
}
