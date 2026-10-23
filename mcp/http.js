// MCP Streamable HTTP transport (spec 2025-11-25) for DropZone, mounted at /mcp by server.js.
// POST: one JSON-RPC message per request; requests get application/json, notifications get 202.
// GET: 405 (this server does not open server-initiated SSE streams). DELETE: ends the session.
// https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http

import { randomUUID } from 'node:crypto';
import { createMcp, SUPPORTED_PROTOCOLS } from './protocol.js';

const sessions = new Map(); // id -> { protocolVersion, createdAt }
const MAX_SESSIONS = 500;

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (Claude Code, curl) send no Origin
  try {
    const o = new URL(origin);
    const host = (req.headers.host || '').split(':')[0];
    const extra = (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return ['localhost', '127.0.0.1', '[::1]', host].includes(o.hostname) || extra.includes(origin);
  } catch { return false; }
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

/**
 * @param {{ getState: () => Promise<any>, getAdvisory: () => Promise<any>, readBody: (req:any) => Promise<Buffer> }} deps
 */
export function createMcpHttpHandler(deps) {
  const mcp = createMcp(deps);
  return async function mcpHttp(req, res) {
    // DNS-rebinding protection required by the spec: validate Origin.
    if (!originAllowed(req)) return reply(res, 403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'origin not allowed' } });

    if (req.method === 'GET') return reply(res, 405, undefined, { Allow: 'POST, DELETE' });
    if (req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id'];
      if (!sid || !sessions.has(sid)) return reply(res, 404, undefined);
      sessions.delete(sid);
      return reply(res, 204, undefined);
    }
    if (req.method !== 'POST') return reply(res, 405, undefined, { Allow: 'POST, DELETE' });

    let msg;
    try { msg = JSON.parse((await deps.readBody(req)).toString('utf8')); }
    catch { return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    if (Array.isArray(msg)) return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batching is not supported in 2025-11-25' } });

    const isInit = msg?.method === 'initialize';
    const sid = req.headers['mcp-session-id'];
    if (!isInit) {
      if (sid && !sessions.has(sid)) return reply(res, 404, { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32001, message: 'session not found; initialize again' } });
      const pv = req.headers['mcp-protocol-version'];
      if (pv && !SUPPORTED_PROTOCOLS.includes(pv)) return reply(res, 400, { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32000, message: `unsupported MCP-Protocol-Version ${pv}` } });
    }

    const out = await mcp.handle(msg);
    if (!out) return reply(res, 202, undefined);
    const headers = {};
    if (isInit && out.result) {
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
      const id = randomUUID();
      sessions.set(id, { protocolVersion: out.result.protocolVersion, createdAt: Date.now() });
      headers['Mcp-Session-Id'] = id;
    }
    return reply(res, 200, out, headers);
  };
}
