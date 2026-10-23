# HANDOFF: DropZone+ (for Saurabh)

Deadline: **Sat 24 Oct 2026, 00:30 IST (Fri 12:00 PT)**. After you submit, pin the judged links to a commit SHA (see the end of this file).

## What's done
- **App:** https://github.com/saurabh4269/dropzone-plus (MIT, public)
  - Replay mode, no token: three labelled-simulated scenarios run the full flow. The dog in the zone triggers an Alexa heads-up, the owner says yes, the pet door goes come-in-only, a kid at T−60 s triggers a carrier HOLD, the zone clears, the box drops and a proof-of-drop receipt is produced. The other two scenarios cover UNKNOWN (camera can't see) and a pool next to the drop point (zone audit, then a receipt showing the box by the pool).
  - Live mode: set `RING_ACCESS_TOKEN` and the server calls the Ring Partner API at runtime: users/me, devices, status, capabilities, history, image snapshot (303 flow) and the WHEP live view. Frames run through **real** in-browser object detection (TF.js COCO-SSD) and are scored against your drawn zone.
  - Ring webhooks: HMAC verification and idempotency, plus a signed event simulator (`npm run sim`).
  - Carrier contract `GET /api/v1/advisory` is veto-only (HOLD or NO_ADVISORY, `authorises_drop:false`).
  - MCP server (`mcp/dropzone-mcp.js`) as the "simulated Alexa+ add-on" surface.
  - Optional Amazon Bedrock (Nova Lite, Converse API) detector, off by default. When it's enabled, the UI uses it for Ring snapshots. It has been tested up to AWS authentication only.
  - "Test a photo" runs real detection on any uploaded yard photo. You can answer the Alexa prompt by voice in Chrome.
  - 16 unit tests (`npm test`) cover zone logic, the veto-only advisory, consent gating, the full delivery window, HMAC and idempotency.
- **Live demo (replay, static):** https://saurabh4269.github.io/dropzone-plus/. It is served from the `gh-pages` branch; republish with `./scripts/deploy-pages.sh`.
- **README.md** covers what, why (with sources), the policy stance, Ring API usage, what's real vs simulated, architecture and how to run it. **FRICTION.md** has 11 entries, each tagged Observed / Docs / Reported, plus feature requests.
- **Open Source mini-challenge repo:** ring-partner-sandbox (see below). DropZone+ LIVE mode was tested end to end against it (`RING_API_BASE=http://localhost:8686`).

## What YOU must do (in this order)

### 1. Get a Ring Playground token and record the real Ring segment (about 20 min)
1. Open https://developer.amazon.com/ring/console/playground and copy the access token. It lasts about 30 minutes, so do steps 2–5 straight away.
2. Check the API:
   ```bash
   cd dropzone-plus && export RING_ACCESS_TOKEN=<token>
   npm run ring:probe
   ```
   Paste the output to me, or into FRICTION.md if anything fails. The two things it confirms:
   - whether the Playground serves `image/download` snapshots
   - whether the device is `online`
3. Run `npm start` and open http://localhost:8787. The badge should read **LIVE · Ring Playground**.
   1. Click **Discover Ring device**. The "Ring API calls" panel lists each call and its status code.
   2. Click **Check zone now**. You should see a Ring snapshot with the zone overlaid.
   3. Click **Live view (WHEP)**, then **Analyse live frame**. In the Playground, press **Package / Motion** to make the simulated camera show something.
   4. Use **Edit zone** to draw a zone on the Ring frame.
   5. Click **Simulate drone order**, then in a second terminal run `RING_WEBHOOK_SECRET=dev-secret npm run sim -- human`. The timeline shows the signed webhook arriving and an automatic re-check.
4. Screen-record all of that. **This is the proof that the Ring API is used at runtime.** Ring's watermark on Playground media is allowed in the public video (forum 45541).
5. **A snapshot older than 120 s gives UNKNOWN on purpose.** The `latest_in_range` call returns the last recording, which can be minutes old. If the zone shows "frame too old", press a Playground button (Motion or Package) to make fresh media, or use WHEP and click **Analyse live frame**, which is always fresh.
6. If snapshots fail in the Playground (we couldn't test them without a token), the app shows UNKNOWN, which is correct behaviour. Use the WHEP live frame instead, and add a FRICTION entry with the exact status code.

### 2. Record the video (< 3 min, public YouTube or Vimeo, no third-party music or logos)
Script (about 2:45):
| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | News headlines about packages in pools (as links on screen) and the Amazon FAQ line "keep pets 10 ft away" | "Drone delivery is here. Every drop needs a clear 10-by-10 patch of yard, and today nobody checks it before the drone shows up. Dogs, kids, pools." |
| 0:20–0:35 | The DropZone+ page and the 4-step strip | "DropZone+ makes your Ring camera the eye on the drop zone. Ring sees it, Alexa tells the family, your devices help, and the drone carrier gets one bit: hold, or nothing." |
| 0:35–1:05 | **LIVE** segment: Discover, snapshot, draw zone, WHEP live frame analysed, Ring API calls panel | "This is the real Ring Partner API on the Ring Developer Playground: device discovery, history, a snapshot and WHEP live view. Frames run through on-device object detection against the zone I drew." |
| 1:05–1:50 | Replay scenario 1 at 10× with **Speak** on. Click **Yes** (or say "yes") at the pet-door prompt | "Replay mode, clearly labelled as simulated. The dog is in the zone. Alexa asks, I say yes, and the pet door goes come-in-only. At T-minus-60 a kid runs in, so the carrier gets a HOLD and waits a minute. The zone clears, the box drops, and Ring gives a proof-of-drop receipt." |
| 1:50–2:10 | Scenario 3 (pool): the audit warning, then the receipt "Landed next to the pool" | "Set-up includes a zone audit. The pool is inside downwash range, and DropZone+ tells you before a box goes swimming." |
| 2:10–2:30 | Scenario 2 (UNKNOWN) and the `/api/v1/advisory` JSON | "Safety by design. It's veto-only: the carrier can only ever get HOLD or nothing, never 'safe to land'. If the camera can't see, it says UNKNOWN, and everything falls back to today's behaviour. Labels only, no identities, no video leaves home." |
| 2:30–2:45 | The terminal running `npm run sim` showing an HMAC-verified webhook, and the MCP tool call | "Signed Ring webhooks, an MCP surface for an Alexa+ add-on, open source. DropZone+." |

Say "simulated" whenever the carrier, Alexa or the pet door is on screen. Don't show the Alexa+ logo (not permitted, forum 45450).

### 3. (Optional) AWS Builder: only if you have working AWS credentials
You need an AWS account with Bedrock access to `amazon.nova-lite-v1:0` in us-east-1. Then run:
```bash
npm i @aws-sdk/client-bedrock-runtime
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1
DZ_BEDROCK=1 npm start
```
The camera footer should read "detector: Amazon Bedrock …". A project can win only one mini-challenge, so **Open Source is the safer bet**: its repo is finished and tested.

### 4. Devpost form
- **Name:** DropZone+
- **Tagline:** Your Ring camera checks the drone drop zone before the drone arrives.
- **Track:** Ring. Mini-challenge: **Open Source** (with the separate repo below). AWS Builder is only worth entering if you get Bedrock running (see Risks).
- **Built with:** Ring Partner API, Ring Developer Playground, WebRTC/WHEP, Node.js, TensorFlow.js (COCO-SSD), Web Speech API, Model Context Protocol, GitHub Pages. Add Amazon Bedrock only if you tested it.
- **Story** (paste from the README sections): Why → Inspiration; What it does; Safety and policy design; How the Ring API is used → How we built it; FRICTION highlights → Challenges; Limitations and next steps → What's next.
- **Testing instructions for judges:** "Open https://saurabh4269.github.io/dropzone-plus/ and press Play (replay mode, simulated, no login). 'Test a photo' runs real in-browser detection on any yard photo. For live Ring: clone, `export RING_ACCESS_TOKEN=<Playground token>`, `npm start`."
- **Friction log:** link to FRICTION.md (pinned SHA).
- **Product feedback (required, one per tool):**
  - **Ring Partner API**
    - *Used for:* discovery, status, capabilities, history, image snapshots (zone checks and proof of drop), WHEP live view, the webhook format and HMAC.
    - *What worked:* JSON:API is consistent, the docs are thorough (multi-camera, error tables, the HMAC "verify raw bytes" warning), and WHEP is a clean standard.
    - *What needs work:* a 401 comes back with an empty body; the starter sample uses `sendrecv` audio and omits the required headers; there's no SDK; `sub_type` is missing from history; auth on the snapshot second hop is undocumented.
    - *Onboarding:* about 1 hour to the first call, mostly spent reconciling the sample with the docs.
    - *Would we build again?* Yes. A fixed ground-truth camera is uniquely valuable for physical-world apps.
  - **Ring Developer Playground**
    - *Used for:* the simulated DoorbellPro in live mode.
    - *What worked:* no hardware is needed, which made it possible to build from India at all.
    - *What needs work:* a 30-minute token with no refresh, no webhooks, one device, and thin history.
    - *Ask:* a webhook trigger and a long-lived demo token.
    - *Would we build again?* Yes, if webhooks are added.
  - **Alexa+**
    - *Used for:* a simulated add-on, plus an MCP server.
    - *Feedback:* there's no developer surface for participants; even a text-only add-on simulator calling our MCP would help.
  - **TensorFlow.js / COCO-SSD**
    - *Used for:* on-device detection.
    - *What worked:* it runs on frames locally with no data egress.
    - *What needs work:* there's no "package" class, and CDN loading takes a few seconds.
  - **GitHub Pages**
    - *Used for:* hosting the replay demo.
    - *What needs work:* an OAuth token without `workflow` scope can't push an Actions workflow, so we deploy from a branch.

## Open source (separate repo)
- **https://github.com/saurabh4269/ring-partner-sandbox** (MIT, public, 23 tests). It's a local mock of the Ring Partner API with JSON:API shapes, the Bearer/`User-Agent`/`Hardware_Id` 406 rules, the 303 snapshot flow, and history with an `event_types` filter. It also includes a signed v1.1 webhook simulator covering all 10 event types, timed scenarios that keep history and webhooks consistent, and a verifier library (JS and Python) with middleware.
- It addresses exactly what the Playground lacks (a 30-minute token, no webhooks). DropZone+'s live mode was tested end to end against it: discovery, status, capabilities, history, snapshot, then COCO-SSD scoring and a signed webhook that triggers a re-check.
- Enter it in the **Open Source mini-challenge** with a short blurb. "Built during the hackathon window; separate from the main entry; unofficial, shapes from the public docs."
- Before submitting, try it yourself: `node bin/ring-sandbox.js serve`, then `npm test`.

## Open risks
1. **The live Ring path has not been run against the real Playground** (there's no token on this machine). It was checked against the docs, against the real API with an invalid token (401 handled correctly), and end to end against the ring-partner-sandbox mock. Testing against the mock found and fixed a real bug: the JSON:API `included` lookup for device status. Snapshot availability for the Playground device is unconfirmed. If it fails, the app shows UNKNOWN, and you should use WHEP.
2. **WHEP from the browser** relies on STUN only. Some networks may need TURN. Sessions end after about 55 s.
3. **Bedrock is untested.** Don't claim it in Built With unless you run `DZ_BEDROCK=1` with real credentials.
4. **The carrier is simulated.** Some judges may discount that; the pitch should lead with household value.
5. **The COCO-SSD CDN** (jsDelivr) must be reachable. If it's blocked, photo and frame detection fail and the zone shows UNKNOWN.
6. **The GitHub Pages deploy is a branch push.** After the deadline, don't push to `gh-pages` or `main`, or pin the links to the SHA.

## Pin after submitting
```bash
git -C dropzone-plus rev-parse HEAD   # put https://github.com/saurabh4269/dropzone-plus/tree/<SHA> in Devpost
```
