// DropZone MCP protocol core: transport-agnostic JSON-RPC 2.0 handling for MCP.
// Used by the stdio server (mcp/dropzone-mcp.js) and the Streamable HTTP endpoint (POST /mcp in server.js).
// Spec: https://modelcontextprotocol.io/specification/2025-11-25

export const LATEST_PROTOCOL = '2025-11-25';
export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SERVER_INFO = { name: 'dropzone', title: 'DropZone', version: '0.2.0' };

export const TOOLS = [
  {
    name: 'get_dropzone_status',
    title: 'Drop zone status',
    description: 'Is the drone drop zone in the yard clear right now? Returns CLEAR, NOT_CLEAR or UNKNOWN with reasons, when it was observed and when it expires. Labels only (person/pet/vehicle/object), never identities.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_carrier_advisory',
    title: 'Carrier advisory',
    description: 'The advisory a drone carrier would receive: HOLD (please wait) or NO_ADVISORY. DropZone can only ask a drone to wait; the carrier keeps every flight decision.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function summarise(v, now = Date.now()) {
  if (!v) return 'UNKNOWN: DropZone has not looked at the drop zone yet.';
  const expired = v.stale_after && now > Date.parse(v.stale_after);
  const status = expired ? 'UNKNOWN (last look expired)' : v.status;
  const why = (v.reasons || []).map((r) => r.code + (r.label ? ` (${r.label}, ${r.where})` : '') + (r.detail ? `: ${r.detail}` : '')).join('; ');
  return `${status}${why ? '. ' + why : ''}. Observed ${v.observed_at || 'n/a'}, valid until ${v.stale_after || 'n/a'}, source ${v.source}.`;
}

const rpcError = (code, message) => Object.assign(new Error(message), { code });

/**
 * @param {{ getState: () => Promise<{verdict:any, delivery:any}>, getAdvisory: () => Promise<any> }} src
 */
export function createMcp(src) {
  async function callTool(name) {
    if (name === 'get_dropzone_status') {
      const s = await src.getState();
      return { content: [{ type: 'text', text: summarise(s.verdict) }], structuredContent: { verdict: s.verdict ?? null, delivery: s.delivery ?? null } };
    }
    if (name === 'get_carrier_advisory') {
      const a = await src.getAdvisory();
      return { content: [{ type: 'text', text: `${a.advice}${a.reason_codes?.length ? ' (' + a.reason_codes.join(', ') + ')' : ''}. ${a.disclaimer || ''}`.trim() }], structuredContent: a };
    }
    throw rpcError(-32602, `unknown tool ${name}`);
  }

  async function dispatch(msg) {
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST_PROTOCOL;
        return {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: 'Ask about the drone drop zone before a drone delivery. Advisory only: DropZone can ask a drone to wait, the carrier decides.',
        };
      }
      case 'tools/list': return { tools: TOOLS };
      case 'tools/call':
        try { return await callTool(msg.params?.name); }
        catch (e) {
          if (e.code) throw e;
          return { content: [{ type: 'text', text: `DropZone unavailable: ${e.message}. Treat the zone as UNKNOWN.` }], isError: true };
        }
      case 'ping': return {};
      default: throw rpcError(-32601, `method not found: ${msg.method}`);
    }
  }

  /** Returns a JSON-RPC response object, or null for notifications/responses. */
  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && msg.id !== undefined && msg.method === undefined) return null; // a response from the client
      return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'invalid request' } };
    }
    if (msg.id === undefined) return null; // notification, e.g. notifications/initialized
    try { return { jsonrpc: '2.0', id: msg.id, result: await dispatch(msg) }; }
    catch (e) { return { jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }; }
  }

  return { handle };
}
