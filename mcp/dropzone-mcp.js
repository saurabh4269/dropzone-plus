#!/usr/bin/env node
// DropZone as an MCP server over stdio (JSON-RPC 2.0, newline-delimited, no dependencies).
// The same protocol core also serves Streamable HTTP at POST /mcp on the DropZone server.
// Alexa+ add-ons are built on MCP; there is no public Alexa+ access for this hackathon, so this
// is how an MCP client (Claude Code, Claude Desktop, the /mcp/ web client) asks about the drop zone.
// It reads from a running DropZone server: DROPZONE_URL (default http://localhost:8787).

import { createInterface } from 'node:readline';
import { createMcp } from './protocol.js';

const BASE = process.env.DROPZONE_URL || 'http://localhost:8787';

async function getJson(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

const mcp = createMcp({ getState: () => getJson('/api/state'), getAdvisory: () => getJson('/api/v1/advisory') });

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
  const out = await mcp.handle(msg);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
});
