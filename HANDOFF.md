# HANDOFF: DropZone (for Saurabh)

Deadline: **Sat 24 Oct 2026, 00:30 IST (Fri 12:00 PT)**. After you submit, pin the judged links to a commit SHA (see the end of this file).

## What's done (as of the final push; latest SHAs are printed in the final summary)
**Links.** Website https://saurabh4269.github.io/dropzone-plus/ · **App (PWA)** https://saurabh4269.github.io/dropzone-plus/app/ · Judge demo https://saurabh4269.github.io/dropzone-plus/demo.html · 3D simulation https://saurabh4269.github.io/dropzone-plus/sim/ (if listed in the README) · Video https://vimeo.com/1238833557 · Sandbox https://github.com/saurabh4269/ring-partner-sandbox (v0.2.1)

**DropZone (main repo)**
- **Homeowner PWA (`/app/`)**, installable (manifest, icons, service worker, offline shell), built for 390 px.
  - **Onboarding:** welcome → Connect Ring (Partner-Initiated OAuth per the docs, Playground token, or a labelled demo home) → camera picker (names and online/offline, per the Ring UX guide) → notifications, Alexa heads-up and pet-door toggles → drag-to-mark drop zone with a name and description.
  - **Tabs:** Home (next drone, live CLEAR / NOT CLEAR / UNKNOWN, Alexa line, one-tap pet-door yes, HOLD, Check now / Live view), Zones (several zones, one default, hazards, audit and suggested safer spot), Deliveries (proof-of-drop photo and placement), Partners (real operators Amazon Prime Air, Wing, Zipline, Flytrex, Manna, labelled "Preview: no live integration yet, linking is simulated; not affiliated", with Learn more, consent, which zone, optional drop instructions, unlink), Settings (connection, toggles, theme, privacy, delete all data).
- **Ring account linking per the docs** (`lib/oauth.js`): PKCE S256, `state`, scope `ava.v1:read`, code exchange, `PATCH app-integrations {status: completed}`, and `DELETE` to unlink. It's unit-tested, but it has never run against Ring because hackathon entrants get no partner credentials. The **Playground-token onboarding** (`POST /api/ring/token`, localhost only) is the working path.
- **Proof of drop by before/after change detection** (`public/core/changes.js`), used in the demo, the PWA and live mode.
- **Zone audit suggests a safer zone** (`suggestZone`); one click applies it.
- **Detector vendored.** TF.js and the COCO-SSD model weights are in `public/vendor/` (Apache-2.0, ~19 MB), so there's no CDN dependency at runtime. The CDN is only a fallback.
- **Tests:** `npm test` has 55 (zone logic, advisory, every replay scenario, change detection, OAuth/PKCE, HMAC, Rekognition mapping and a live AWS test, the 3D sim model, LIVE-mode integration against ring-partner-sandbox). `npm run e2e` checks the website and demo, and `npm run e2e:app` walks the full PWA journey at 390×844. All pass locally and against Pages.
- **README:** hero image, labelled AI concept GIF, link table, an exact map of where the Ring API is called (file, function, trigger), a mermaid architecture diagram, real vs simulated, the PWA journey, and references (Ring docs, UX guide, ring-api-helloworld).
- **FRICTION.md:** 14 entries, every one with task, steps, expected, actual, severity, workaround and suggestion. New ones: the OAuth scope mismatch in the docs (`ava` vs `ava.v1:read`), two response shapes for app-integrations, and CORS plus no sandbox OAuth client.
- **CI** is ready in `ci/ci.yml`, but **you must enable it** (see below).

**ring-partner-sandbox (Open Source entry):** record/replay proxy fixtures with redaction, a composite GitHub Action (`action.yml`), examples (Node client, node:http and Python webhook receivers), an API coverage table, CONTRIBUTING, CHANGELOG, 33 tests, and the v0.2.1 release. CI is ready in `ci/ci.yml`.

## What YOU must do (in this order)

### 0. Turn on CI in both repos (2 min)
```bash
gh auth refresh -h github.com -s workflow
cd dropzone-plus && ./scripts/enable-ci.sh
cd ../ring-partner-sandbox && ./scripts/enable-ci.sh
```
Then check that the Actions tab is green in both repos. These commits come after any pinned SHA, which is harmless.

### 1. Get a Ring Playground token and record the real Ring segment (about 20 min)
**One command first:** `export RING_ACCESS_TOKEN=<token>; npm run playground`. It prints PASS/FAIL for every step (API, snapshot, WHEP live view in the PWA, detection on the live frame, advisory, DELETE) and saves screenshots to `/tmp/dropzone-playground-*.png`. Paste its output into the "Playground run" section below.

**Then for the video:** run `npm start`, open http://localhost:8787/app/ and choose **Use a Ring Developer Playground token** (paste the token). Pick the camera, draw the zone on the real Playground snapshot, then use **Check now** and **Live view**. The judge-demo LIVE panel at http://localhost:8787/demo.html also lists every Ring call with its status code.
1. Open https://developer.amazon.com/ring/console/playground and copy the access token. It lasts about 30 minutes, so do steps 2–5 straight away.
2. Check the API:
   ```bash
   cd dropzone-plus && export RING_ACCESS_TOKEN=<token>
   npm run ring:probe
   ```
   Paste the output to me, or into FRICTION.md if anything fails. The two things it confirms:
   - whether the Playground serves `image/download` snapshots
   - whether the device is `online`
3. Run `npm start` and open http://localhost:8787/demo.html. The badge should read **LIVE · Ring Partner API**.
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
| 0:20–0:35 | The DropZone page and the 4-step strip | "DropZone makes your Ring camera the eye on the drop zone. Ring sees it, Alexa tells the family, your devices help, and the drone carrier gets one bit: hold, or nothing." |
| 0:35–1:05 | **LIVE** segment: Discover, snapshot, draw zone, WHEP live frame analysed, Ring API calls panel | "This is the real Ring Partner API on the Ring Developer Playground: device discovery, history, a snapshot and WHEP live view. Frames run through on-device object detection against the zone I drew." |
| 1:05–1:50 | Replay scenario 1 at 10× with **Speak** on. Click **Yes** (or say "yes") at the pet-door prompt | "Replay mode, clearly labelled as simulated. The dog is in the zone. Alexa asks, I say yes, and the pet door goes come-in-only. At T-minus-60 a kid runs in, so the carrier gets a HOLD and waits a minute. The zone clears, the box drops, and Ring gives a proof-of-drop receipt." |
| 1:50–2:10 | Scenario 3 (pool): the audit warning, then the receipt "Landed next to the pool" | "Set-up includes a zone audit. The pool is inside downwash range, and DropZone tells you before a box goes swimming." |
| 2:10–2:30 | Scenario 2 (UNKNOWN) and the `/api/v1/advisory` JSON | "Safety by design. It's veto-only: the carrier can only ever get HOLD or nothing, never 'safe to land'. If the camera can't see, it says UNKNOWN, and everything falls back to today's behaviour. Labels only, no identities, no video leaves home." |
| 2:30–2:45 | The terminal running `npm run sim` showing an HMAC-verified webhook, and the MCP tool call | "Signed Ring webhooks, an MCP surface for an Alexa+ add-on, open source. DropZone." |

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
- **Name:** DropZone
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

### 5. Devpost text: what to update after round 3
- **Links:** add the **App (PWA)** link https://saurabh4269.github.io/dropzone-plus/app/ first, then the judge demo https://saurabh4269.github.io/dropzone-plus/demo.html and the website https://saurabh4269.github.io/dropzone-plus/. Root URLs with old `?scenario=` parameters still redirect to the demo.
- **What it does:** lead with the homeowner journey: install → connect Ring → mark and name your drop spot → link a drone partner → heads-up, HOLD and proof of drop. Then mention the zone audit with its suggested safer spot, and proof of drop by before/after change detection.
- **How we built it:**
  - Ring account linking implemented per the docs (Partner-Initiated OAuth 2.0 with PKCE). Say plainly that it's untested against Ring because entrants get no partner credentials, and that a Playground token works.
  - Detector vendored (no CDN).
  - 46 unit and integration tests plus two headless-Chrome end-to-end suites.
  - Ring UX design guide followed: device names, offline state, empty states, a skippable tutorial, in-app data deletion.
- **Built with (add):** Progressive Web App (Web App Manifest, Service Worker), OAuth 2.0 PKCE, WebRTC/WHEP, TensorFlow.js (vendored), Canvas change detection, three.js (3D simulation).
- **Testing instructions:** "Open https://saurabh4269.github.io/dropzone-plus/app/ on a phone or narrow window, then choose Try a demo home (simulated) → Backyard Cam → Continue → drag the zone → Save → Link a delivery partner → Amazon Prime Air (preview, simulated) → Link → Home → Simulate a drone delivery → tap Yes. For scripted scenarios use /demo.html."
- **Friction log:** now 14 complete entries.
- **Open Source entry:** ring-partner-sandbox v0.2.1 (record/replay fixtures, composite GitHub Action, examples, API coverage table, 33 tests).
- **Video:** consider a 20 s PWA segment (onboarding → mark zone → simulated delivery) before the replay demo.

## Playground run (real Ring Developer Playground)
- **Real Playground run, 23 Oct 2026 23:31 IST (`npm run playground`): 7 PASS · 1 FAIL · 1 INFO.**
  - PASS: users/me; devices (1 "Playground Device"); status; capabilities; event history (1 event after pressing Package in Playground step 3); PWA Check now (verdict UNKNOWN); carrier advisory.
  - INFO: snapshot download returns 403, so the verdict is UNKNOWN (correct behaviour).
  - FAIL: live view. WHEP POST returns 201 with an SDP answer, but no video frames arrive. The Playground's own Live Stream modal also stayed black on this machine.
- **Dry run against ring-partner-sandbox** (`RING_API_BASE=http://127.0.0.1:8686 RING_ACCESS_TOKEN=sandbox-token npm run playground`): **8 PASS · 0 FAIL · 1 SKIP.**
  - Passed: users/me, devices, status, capabilities, history, snapshot via 303, the PWA snapshot verdict, and the advisory.
  - Skipped: WHEP, because the mock can't stream video. The real Playground is the only way to verify WHEP plus live-frame detection.

## 3D simulation (added in round 3)
- https://saurabh4269.github.io/dropzone-plus/sim/: a three.js scene (vendored r170, MIT) with a fixed Ring camera view, a drone down-looking camera at about 13 ft, and an overview.
  - The real `evaluateZone`, `buildAdvisory` and `findNewObject` run on the projected scene.
  - Three scenarios: dog + kid, pool + gust, and an umbrella (stale survey: 3 holds, then the drone's own check aborts).
- [docs/COMPARISON.md](docs/COMPARISON.md) compares drone-side vision (OpenLander, MIT; MDPI Drones 8(1):21, Alsawy et al.) with the fixed home camera. The two are complementary.
  - The OpenLander ONNX model was smoke-tested offline on rendered drone views (umbrella: 38% obstacle; clear zone: 97.5% clear). That's a smoke test, not an evaluation, and the inference scripts aren't in the repo.
  - mdpi.com returned 403, so the comparison describes only the abstract (via Crossref).
- Video idea: 15 s of `/sim/` showing the umbrella case, where only one of the two cameras knows.

## AWS (real runs, 23 Oct 2026, us-east-1, via `aws login`)
- **Amazon Rekognition DetectLabels works.** Run it with `DZ_AWS=1 npm start`; code in `lib/rekognition.js`, endpoint `POST /api/vision/rekognition`. These are real outputs through the server endpoint:
  - Dog-on-lawn photo: `Dog 97.8%` (box), `potted plant 0.535`, giving the verdict NOT_CLEAR / PET_IN_ZONE in 533 ms.
  - 3D-sim Ring view (dog in the zone): labels `Grass 100%, Plant 100%, Field 99%, Tennis Ball 92%`, hazard hints `hot tub, pool, water`. The simulated dog was not detected, so a synthetic render isn't a fair test.
  - ring-partner-sandbox placeholder snapshot: labels `Text, Computer, Door…`, no detections, 160 ms.
  - `DZ_AWS=1 node --test test/rekognition.test.js` gives 2/2 pass, including the live call.
- **Amazon Bedrock does NOT work yet:** `ValidationException: Operation not allowed` (account verification). Don't claim it.
- **AWS Builder mini-challenge:** we can win only one mini-challenge, and Open Source is still the stronger entry. If you want to enter AWS Builder instead, the evidence is the README "AWS" section plus these outputs. Credentials were never written to the repo.

## Open source (separate repo)
- **https://github.com/saurabh4269/ring-partner-sandbox** (MIT, public, 23 tests). It's a local mock of the Ring Partner API with JSON:API shapes, the Bearer/`User-Agent`/`Hardware_Id` 406 rules, the 303 snapshot flow, and history with an `event_types` filter. It also includes a signed v1.1 webhook simulator covering all 10 event types, timed scenarios that keep history and webhooks consistent, and a verifier library (JS and Python) with middleware.
- It addresses exactly what the Playground lacks (a 30-minute token, no webhooks). DropZone's live mode was tested end to end against it: discovery, status, capabilities, history, snapshot, then COCO-SSD scoring and a signed webhook that triggers a re-check.
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
