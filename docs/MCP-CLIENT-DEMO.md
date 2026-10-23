# MCP client demo: a real AI assistant calls DropZone

DropZone runs an MCP server (spec 2025-11-25) two ways, sharing one protocol core (`mcp/protocol.js`):

- **Streamable HTTP** at `POST /mcp` on the DropZone server (`mcp/http.js`). One JSON-RPC message per POST. Requests get `application/json`, notifications get `202`. `initialize` returns an `Mcp-Session-Id`, later requests send it back with `MCP-Protocol-Version`. `GET` returns 405 (no server-initiated stream), `DELETE` ends the session, a foreign `Origin` gets 403 (DNS rebinding guard), batches get 400.
- **stdio** (`mcp/dropzone-mcp.js`) for desktop clients that launch a process.

Tools: `get_dropzone_status` (CLEAR, NOT_CLEAR or UNKNOWN with reasons and expiry) and `get_carrier_advisory` (HOLD or NO_ADVISORY; `authorises_drop` is always false).

Alexa+ add-ons are built on MCP, but the Devpost FAQ says Alexa+ add-on tooling is a preview for select partners and participants cannot connect a self-hosted MCP server to a real Alexa+ device. So we show the same server through two real MCP clients.

## 1. Web MCP client

Open `http://localhost:8787/mcp/` after `npm start`. The page runs `initialize`, `notifications/initialized`, `tools/list` and `tools/call` over Streamable HTTP and prints every request and response. "Seed a replay verdict (simulated)" pushes a verdict computed by the real zone engine from scripted replay detections, so there is something to ask about.

## 2. Claude Code (real AI assistant app)

Config in the repo root, `.mcp.json`:

```json
{ "mcpServers": { "dropzone": { "type": "http", "url": "http://localhost:8787/mcp" } } }
```

Or add it once: `claude mcp add --transport http dropzone http://localhost:8787/mcp`

Claude Desktop (stdio), in `claude_desktop_config.json`:

```json
{ "mcpServers": { "dropzone": { "command": "node", "args": ["/path/to/dropzone-plus/mcp/dropzone-mcp.js"], "env": { "DROPZONE_URL": "http://localhost:8787" } } } }
```

### Recorded run (23 Oct 2026, 23:42 IST)

Setup: `npm start` (REPLAY mode, no Ring token), then a verdict was seeded from the `saturday` replay scenario at 20 s (dog in the zone). The frame and the carrier are **simulated**; the MCP traffic and the assistant are real.

Command:

```
claude -p "Is my drop zone clear? Use the dropzone MCP tools, and tell me what the carrier advisory says." \
  --mcp-config .mcp.json --strict-mcp-config \
  --allowedTools "mcp__dropzone__get_dropzone_status,mcp__dropzone__get_carrier_advisory" \
  --output-format stream-json --verbose
```

Transcript, extracted from the stream-json output (nothing edited except removing empty tool-search results):

```
[init] model=claude-opus-5-5 mcp_servers=[{"name": "dropzone", "status": "connected", "source": "dynamic"}]
[tool_use] ToolSearch {"query": "select:mcp__dropzone__get_dropzone_status,mcp__dropzone__get_carrier_advisory", "max_results": 2}
[tool_use] mcp__dropzone__get_dropzone_status {}
[tool_result] {"verdict":{"observed_at":"2026-10-23T18:12:04.370Z","evaluated_at":"2026-10-23T18:12:04.370Z","stale_after":"2026-10-23T18:13:34.370Z","source":"replay:saturday@20s (simulated)","objects":[{"label":"dog","category":"pet","score":0.9,"box":[0.484,0.606,0.091,0.091],"where":"in"}],"reasons":[{"code":"PET_IN_ZONE","label":"dog","where":"in"}],"status":"NOT_CLEAR"},"delivery":{"ref":"replay-demo","carrier":"demo (simulated)","etaAt":1792779604370}}
[tool_use] mcp__dropzone__get_carrier_advisory {}
[tool_result] {"schema":"dropzone-plus/advisory@1","advice":"HOLD","authorises_drop":false,"reason_codes":["PET_IN_ZONE"],"hold_seconds":60,"zone_status":"NOT_CLEAR","observed_at":"2026-10-23T18:12:04.370Z","valid_until":"2026-10-23T18:13:34.370Z","delivery_ref":"replay-demo","disclaimer":"Advisory only. Can request a delay, never authorises a drop. The aircraft's own detect-and-avoid remains authoritative. Absence of a HOLD is not a statement that the area is safe."}
[assistant]
**No, your drop zone isn't clear.** The status is **NOT_CLEAR** because the camera sees a **dog inside the zone** (90% confidence).

**Carrier advisory: HOLD.** It asks the drone to wait **60 seconds** before re-checking. The reason given is `PET_IN_ZONE`.

Some context:
- **Timing:** The reading was taken at 18:12:04 UTC and is only good until 18:13:34 UTC, so it goes stale after about 90 seconds. The delivery is due around 18:20 UTC, roughly 8 minutes after the reading, so there's time to bring the dog inside.
- **It can't stop the drone:** A HOLD only asks the drone to wait. The carrier makes the final call, and the drone's own obstacle detection is what actually decides. The reverse also holds: if there's no HOLD, that doesn't mean the area is safe.
- **Simulated data:** The source is labelled `replay:saturday@20s (simulated)` and the carrier is `demo (simulated)`. This looks like a demo replay rather than a live feed of your yard.

If you'd like, I can check again once the dog is out of the zone.
[result] success turns=4
```

Automated checks for the same endpoint: `node --test test/mcp.test.js` (initialize, session header, tools/list, tools/call, unknown tool error, DELETE, Origin, protocol header, GET 405, batch 400, stdio).
