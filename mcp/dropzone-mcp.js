#!/usr/bin/env node
// DropZone+ as an MCP server (stdio, JSON-RPC 2.0, no dependencies).
// Alexa+ add-ons are built on MCP; there is no public Alexa+ access for this hackathon, so this
// is how a (simulated) Alexa+ add-on or any MCP client (e.g. Claude Desktop) asks about the drop zone.
// It reads from a running DropZone+ server: DROPZONE_URL (default http://localhost:8787).

import { createInterface } from 'node:readline';

const BASE = process.env.DROPZONE_URL || 'http://localhost:8787';
const PROTOCOL = '2025-06-18';

const tools = [
  {
    name: 'get_dropzone_status',
    description: 'Is the drone drop zone in the yard clear right now? Returns CLEAR, NOT_CLEAR or UNKNOWN with reasons, when it was observed and when it expires. Labels only (person/pet/vehicle/object), never identities.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_carrier_advisory',
    description: 'The veto-only advisory a drone carrier would receive: HOLD (please wait) or NO_ADVISORY. It never authorises a drop.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function getJson(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

function summarise(v) {
  if (!v) return 'UNKNOWN: DropZone+ has not looked at the drop zone yet.';
  const expired = v.stale_after && Date.now() > Date.parse(v.stale_after);
  const status = expired ? 'UNKNOWN (last look expired)' : v.status;
  const why = (v.reasons || []).map((r) => r.code + (r.label ? ` (${r.label}, ${r.where})` : '') + (r.detail ? `: ${r.detail}` : '')).join('; ');
  return `${status}${why ? ' — ' + why : ''}. Observed ${v.observed_at || 'n/a'}, valid until ${v.stale_after || 'n/a'}, source ${v.source}.`;
}

async function callTool(name) {
  if (name === 'get_dropzone_status') {
    const s = await getJson('/api/state');
    return { content: [{ type: 'text', text: summarise(s.verdict) }], structuredContent: { verdict: s.verdict, delivery: s.delivery } };
  }
  if (name === 'get_carrier_advisory') {
    const a = await getJson('/api/v1/advisory');
    return { content: [{ type: 'text', text: `${a.advice}${a.reason_codes.length ? ' (' + a.reason_codes.join(', ') + ')' : ''}. ${a.disclaimer}` }], structuredContent: a };
  }
  throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'dropzone-plus', version: '0.1.0' }, instructions: 'Ask about the drone drop zone before a drone delivery. Advisory only.' };
    case 'tools/list':
      return { tools };
    case 'tools/call':
      try { return await callTool(msg.params?.name); }
      catch (e) { if (e.code) throw e; return { content: [{ type: 'text', text: `DropZone+ unavailable: ${e.message}. Treat the zone as UNKNOWN.` }], isError: true }; }
    case 'ping':
      return {};
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // notifications (e.g. notifications/initialized)
  try { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) }) + '\n'); }
  catch (e) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }) + '\n'); }
});
