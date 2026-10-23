# Friction log: DropZone+ (Ring track)

These are real pain points we hit while building, each with how we confirmed it. Severity: **High** = blocked or forced a redesign, **Med** = cost real time, **Low** = an annoyance.
Status labels: **Observed** = we reproduced it ourselves from this build machine. **Docs** = a discrepancy we confirmed by reading the official docs or sample. **Reported** = seen in the hackathon forum and not reproduced by us.

Machine and date: Linux, Node 22, 23 Oct 2026 (IST).

---

### 1. A 401 from the Ring API has an empty body, not a JSON:API error (Observed, Low)
- **Task:** handle an expired or invalid Playground token cleanly.
- **Steps:** `GET https://api.amazonvision.com/v1/users/me` and `GET /v1/devices` with an invalid bearer token (see `scripts/ring-probe.js`).
- **Expected:** the docs say "All errors follow JSON:API format", e.g. `{"errors":[{"status":"401","code":"UNAUTHORIZED",…}]}`.
- **Actual:** `401` with an empty body (our client logged `Ring API 401 on /v1/users/me: null`).
- **Workaround:** treat any 401 as "token expired" and tell the user Playground tokens last about 30 minutes.
- **Suggestion:** return the documented JSON:API error with a machine-readable `code` (`TOKEN_EXPIRED` vs `TOKEN_INVALID`). With a 30-minute token, that distinction is the most common error a Playground developer will see.

### 2. The official Hello World sends `sendrecv` audio, which the WHEP docs say will fail (Docs, Med)
- **Task:** start a WHEP live view.
- **Steps:** compared `AmazonAppDev/ring-api-helloworld` → `app/hooks/useWebRTCStream.ts` (`pc.addTransceiver('audio', { direction: 'sendrecv' })`) with the Live Video docs ("All media tracks must use recvonly … Using sendrecv or sendonly causes SDP negotiation to fail").
- **Expected:** the canonical starter matches the docs.
- **Actual:** the two contradict each other. A forum participant reported that recvonly worked.
- **Workaround:** both transceivers are `recvonly` in `public/app.js` (`startLive`).
- **Suggestion:** fix the sample. Developers copy it verbatim, and the failure appears as an opaque SDP or 500 error.

### 3. Required `User-Agent` and `Hardware_Id` headers are missing from the starter (Docs, Med)
- **Task:** make the first API call.
- **Steps:** the API reference says every request to `api.amazonvision.com` must include `User-Agent` and `Hardware_Id` (a UUID per user and device), or the WAF may return `406`. `grep` of ring-api-helloworld (TS and Python scripts) finds neither header.
- **Expected:** the starter shows the required headers.
- **Actual:** they are missing. It's also unclear whether a server-side app should use one Hardware_Id per process, per user, or per device.
- **Workaround:** `lib/ring.js` sends `User-Agent: DropZonePlus/0.1` and a UUID `Hardware_Id` (pinnable via `RING_HARDWARE_ID`).
- **Suggestion:** add the headers to the sample, and give one sentence on what Hardware_Id should be for a multi-user cloud backend.

### 4. The Playground cannot send webhooks, so event-driven apps can't be tested end to end (Docs/Reported, High)
- **Task:** re-check the drop zone when Ring reports motion (`motion_detected`, `sub_type: human`).
- **Expected:** a "send test webhook" button in the Playground.
- **Actual:** there is no webhook delivery from the Playground. The Package, Vehicle and Motion buttons start simulated live-view sessions instead (forum thread 45309).
- **Workaround:** we wrote `scripts/simulate-events.js`, which sends Ring v1.1-shaped, HMAC-signed events (marked `meta.simulated: true`) to our verifier (`lib/webhook.js`).
- **Suggestion:** add a Playground "fire webhook" control with a configurable URL and the developer's signing key. It's the single most useful addition for the "event-based triggers" category the track asks for.

### 5. The 30-minute Playground token has no refresh, so a hosted demo is impossible without replay (Reported/Docs, High)
- **Task:** keep a judge-accessible demo working through judging (9–20 Nov).
- **Expected:** a long-lived sandbox credential or refresh token for the Playground.
- **Actual:** the token lasts about 30 minutes with no refresh. Judges must not be asked to paste a token (forum 45541).
- **Workaround:** a labelled REPLAY mode is the default and the hosted site is static (GitHub Pages). LIVE mode turns on only when `RING_ACCESS_TOKEN` is present.
- **Suggestion:** offer a Playground refresh token, or a read-only "demo token" scoped to the simulated device that lasts weeks.

### 6. The snapshot download is a two-step 303 flow, and auth on the second hop is unspecified (Docs, Low)
- **Task:** fetch a JPEG frame for zone checks and proof-of-drop.
- **Steps:** `POST /v1/devices/{id}/media/image/download` → `303 See Other` → signed `GET /v1/download?security_token=…`.
- **Expected:** a clear statement on whether the bearer token should be sent to the download host.
- **Actual:** the docs show the Location URL but don't say. Generic HTTP clients differ: some forward `Authorization` across the redirect, some strip it.
- **Workaround:** `redirect: 'manual'`, then GET the signed URL **without** the bearer token (`lib/ring.js`). We use `X-Media-Timestamp` as the verdict's `observed_at`.
- **Suggestion:** document "do not send Authorization to the download URL" (or the opposite), and include a fetch/requests snippet.

### 7. There is no SDK, so every team re-implements the same client (Docs, Low)
- The docs say plainly: "There is no official Ring Partner SDK." Every team writes the same JSON:API unwrapping, header rules, 303 handling, WHEP negotiation and HMAC verification.
- **Suggestion:** a small official `@ring/partner-api` package (TS and Python) with those five things would pay for itself quickly.

### 8. A detection `sub_type` exists only on webhooks, never in history (Reported, Med)
- **Task:** score how often the zone is busy at delivery hours using history (zone audit).
- **Actual (forum 45309):** history rows don't carry `sub_type` (human, vehicle). Playground history holds only `on_demand` rows with empty `cv_detections`.
- **Workaround:** we dropped "busy-hours" scoring and run our own detector on frames.
- **Suggestion:** expose `sub_type` (and boxes, if available) in history events.

### 9. Alexa+ has no public developer surface (Reported, Med, Alexa+)
- **Task:** speak the heads-up and capture the owner's "yes" through Alexa.
- **Actual:** no Alexa+ toolkit or simulator access for participants (FAQ; forum 45255/45262).
- **Workaround:** a labelled "simulated Alexa+ add-on" (browser TTS plus consent buttons), plus an MCP server (`mcp/dropzone-mcp.js`) exposing the same capability through the protocol Alexa+ add-ons use.
- **Suggestion:** even a text-only add-on simulator that calls a developer's MCP endpoint would let Ring and Alexa teams show real integration.

### 10. Tooling: a GitHub OAuth token without `workflow` scope can't push a Pages Actions workflow (Observed, Low, GitHub)
- **Actual:** `refusing to allow an OAuth App to create or update workflow … without workflow scope`.
- **Workaround:** publish `public/` to a `gh-pages` branch (`scripts/deploy-pages.sh`).

### 11. AWS: no credentials and no credits left, so Bedrock is untested (Observed/Reported, Med, AWS)
- Credits closed on 7 Oct. New-account Bedrock quotas reportedly start at 0 (forum 45416/45474).
- **Workaround:** the Bedrock path (`lib/bedrock.js`, Nova Lite via the Converse API) is optional and off by default. The core works with in-browser TF.js.

---

## Feature requests

| Request | Why it matters | Priority |
|---|---|---|
| Playground webhook trigger (motion with `sub_type`, ding) | Event-driven apps are what the track rewards, but they can't be exercised end to end | High |
| Long-lived Playground or demo token | Judges and reviewers can't see live Ring data after 30 minutes | High |
| Write capability for owner-approved actions (lights, siren, chime) | "Ring meets other devices" today means Ring can only be an input. Example: flash the floodlight when the zone isn't clear | Medium |
| A "region of interest" or zone primitive in the API | Every yard-aware app needs a user-drawn zone; Ring already has motion zones internally | Medium |
| `sub_type` / detections in history | Enables historical analytics without re-running vision | Medium |
