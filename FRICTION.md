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
- **Severity:** Low. Cost about 15 minutes to tell expired from invalid tokens.
- **Workaround:** treat any 401 as "token expired" and tell the user Playground tokens last about 30 minutes.
- **Suggestion:** return the documented JSON:API error with a machine-readable `code` (`TOKEN_EXPIRED` vs `TOKEN_INVALID`). With a 30-minute token, that distinction is the most common error a Playground developer will see.

### 2. The official Hello World sends `sendrecv` audio, which the WHEP docs say will fail (Docs, Med)
- **Task:** start a WHEP live view.
- **Steps:** compared `AmazonAppDev/ring-api-helloworld` → `app/hooks/useWebRTCStream.ts` (`pc.addTransceiver('audio', { direction: 'sendrecv' })`) with the Live Video docs ("All media tracks must use recvonly … Using sendrecv or sendonly causes SDP negotiation to fail").
- **Expected:** the canonical starter matches the docs.
- **Actual:** the two contradict each other. A forum participant reported that recvonly worked.
- **Severity:** Medium. Copying the official sample verbatim would break live view.
- **Workaround:** both transceivers are `recvonly` in `public/app.js` (`startLive`).
- **Suggestion:** fix the sample. Developers copy it verbatim, and the failure appears as an opaque SDP or 500 error.

### 3. Required `User-Agent` and `Hardware_Id` headers are missing from the starter (Docs, Med)
- **Task:** make the first API call.
- **Steps:** the API reference says every request to `api.amazonvision.com` must include `User-Agent` and `Hardware_Id` (a UUID per user and device), or the WAF may return `406`. `grep` of ring-api-helloworld (TS and Python scripts) finds neither header.
- **Expected:** the starter shows the required headers.
- **Actual:** they are missing. It's also unclear whether a server-side app should use one Hardware_Id per process, per user, or per device.
- **Severity:** Medium. A missing header gives an opaque 406 from the WAF.
- **Workaround:** `lib/ring.js` sends `User-Agent: DropZonePlus/0.1` and a UUID `Hardware_Id` (pinnable via `RING_HARDWARE_ID`).
- **Suggestion:** add the headers to the sample, and give one sentence on what Hardware_Id should be for a multi-user cloud backend.

### 4. The Playground cannot send webhooks, so event-driven apps can't be tested end to end (Docs/Reported, High)
- **Task:** re-check the drop zone as soon as Ring reports motion (`motion_detected` with `sub_type: human`) while a drone is inbound.
- **Steps:** read the Notifications docs (webhook URL is configured during partner onboarding / Development Portal), looked for a webhook trigger in the Ring Developer Playground, and pressed its Package, Vehicle and Motion buttons.
- **Expected:** a way to make the Playground send a signed test webhook to a developer URL.
- **Actual:** the Playground sends no webhooks. Its buttons only start simulated live-view sessions and write `on_demand` history rows (also reported in forum thread 45309).
- **Severity:** High. The track's "event-based triggers" path can't be exercised against Ring at all.
- **Workaround:** `scripts/simulate-events.js` posts Ring v1.1-shaped, HMAC-signed events (marked `meta.simulated: true`) through our real verifier in `lib/webhook.js`. We then turned this into the open-source [ring-partner-sandbox](https://github.com/saurabh4269/ring-partner-sandbox).
- **Suggestion:** add a Playground "Send test webhook" control (event type, `sub_type`, target URL, signed with the developer's key).

### 5. The 30-minute Playground token has no refresh, so a hosted demo can't stay live (Docs/Observed, High)
- **Task:** keep a judge-accessible demo of the live Ring path working through judging (9–20 Nov).
- **Steps:** read the Playground and Authentication docs; checked whether the Playground issues a refresh token or a longer-lived credential.
- **Expected:** a long-lived sandbox credential, or a refresh token, for the simulated device.
- **Actual:** an access token of about 30 minutes, with no refresh. Judges must not be asked to paste a token (forum 45541).
- **Severity:** High. A hosted live demo is impossible; we had to design a separate replay/demo path.
- **Workaround:** the hosted site (GitHub Pages) runs a labelled replay demo and a labelled "demo home" in the PWA. LIVE mode turns on only when a token is supplied locally (env var or the PWA's Playground-token onboarding step).
- **Suggestion:** a read-only "demo token" scoped to the Playground device that lasts weeks, or Playground refresh tokens.

### 6. The snapshot download is a two-step 303 flow, and auth on the second hop is unspecified (Docs, Low)
- **Task:** fetch a JPEG frame for zone checks and proof-of-drop.
- **Steps:** `POST /v1/devices/{id}/media/image/download` → `303 See Other` → signed `GET /v1/download?security_token=…`.
- **Expected:** a clear statement on whether the bearer token should be sent to the download host.
- **Actual:** the docs show the Location URL but don't say. Generic HTTP clients differ: some forward `Authorization` across the redirect, some strip it.
- **Severity:** Low. Cost about 20 minutes and could leak a bearer token to another host.
- **Workaround:** `redirect: 'manual'`, then GET the signed URL **without** the bearer token (`lib/ring.js`). We use `X-Media-Timestamp` as the verdict's `observed_at`.
- **Suggestion:** document "do not send Authorization to the download URL" (or the opposite), and include a fetch/requests snippet.

### 7. There is no SDK, so every team re-implements the same client (Docs, Medium)
- **Task:** call the Ring Partner API from Node with correct headers, JSON:API unwrapping, the 303 snapshot flow, WHEP and webhook verification.
- **Steps:** looked for an official SDK (npm, PyPI, the docs "SDKs and Libraries" section).
- **Expected:** a small official client library, as most partner APIs provide.
- **Actual:** the docs state "There is no official Ring Partner SDK." We wrote `lib/ring.js` (≈130 lines), `lib/webhook.js` and `lib/oauth.js` from scratch, and found one bug (JSON:API `included` lookup) only by testing against our own mock.
- **Severity:** Medium. About 2 hours of boilerplate that every team repeats.
- **Workaround:** zero-dependency client in `lib/`, tested against ring-partner-sandbox.
- **Suggestion:** an official `@ring/partner-api` package (TS and Python) covering headers, JSON:API includes, the snapshot redirect, WHEP and HMAC verification.

### 8. Detection `sub_type` exists only on webhooks, never in event history (Docs/Reported, Medium)
- **Task:** score how often the drop zone is busy at typical delivery hours (part of the zone audit), from Ring event history.
- **Steps:** compared the Event History and Motion Detection docs; checked the history payload fields.
- **Expected:** history events carry the same `sub_type` (human / vehicle / other) that `motion_detected` webhooks carry.
- **Actual:** `sub_type` appears only on the webhook. History rows don't carry it, and Playground history holds only `on_demand` rows with empty `cv_detections` (forum 45309).
- **Severity:** Medium. We cut the "busy hours" feature.
- **Workaround:** run our own detector on snapshots instead.
- **Suggestion:** include `sub_type` (and boxes, if available) in history events.

### 9. Alexa+ has no developer surface for participants (Reported, Medium, Alexa+)
- **Task:** speak the drone heads-up on an Echo and capture the owner's "yes" for the pet door.
- **Steps:** read the hackathon FAQ and forum threads 45255 and 45262 about Alexa+ toolkit/simulator access.
- **Expected:** a way to test an Alexa+ add-on (even text-only).
- **Actual:** no toolkit, CLI or simulator access for participants.
- **Severity:** Medium. The Alexa leg of "Ring meets Alexa" can only be simulated.
- **Workaround:** a labelled "simulated Alexa+ add-on" (utterances and consent prompts, browser TTS), plus an MCP server (`mcp/dropzone-mcp.js`) exposing the capability through the protocol Alexa+ add-ons use.
- **Suggestion:** a text-only add-on simulator that calls a developer's MCP endpoint.

### 10. GitHub token without `workflow` scope can't push CI or Pages workflows (Observed, Low, GitHub)
- **Task:** add GitHub Actions for tests and a Pages deploy.
- **Steps:** committed `.github/workflows/pages.yml` and ran `git push` with the `gh` CLI's OAuth token.
- **Expected:** the push succeeds, or the CLI warns at login that workflows need an extra scope.
- **Actual:** `refusing to allow an OAuth App to create or update workflow … without workflow scope`.
- **Severity:** Low. It cost a redesign of the deploy (to a `gh-pages` branch) and left CI unpushed.
- **Workaround:** `scripts/deploy-pages.sh` publishes `public/` to `gh-pages`; the CI workflow is kept at `ci/ci.yml` with `scripts/enable-ci.sh` to install it after `gh auth refresh -s workflow`.
- **Suggestion:** have `gh auth login` mention the `workflow` scope when the user picks "repo" scopes.

### 11. New AWS account: Bedrock blocked during account verification; credits closed (Observed, Medium, AWS)
- **Task:** use Amazon Bedrock (Nova Lite, Converse API) as an optional frame detector, next to Amazon Rekognition.
- **Steps:** implemented `lib/bedrock.js`; signed in with `aws login` (default profile, us-east-1); called Converse with a JPEG at 22:56 IST on 23 Oct 2026. Rekognition `DetectLabels` on the same account worked first time.
- **Expected:** Bedrock usable like Rekognition, or a clear in-console message about how long verification takes.
- **Actual:** the CLI first reported "account is being verified (normally < 2 hours)". Our SDK call then returned `ValidationException: Operation not allowed`, an error that doesn't say verification is the cause. The hackathon credit form had closed on 7 Oct, and the forum reports new accounts with 0 Bedrock quota (45416/45474).
- **Severity:** Medium. The Bedrock path can't be verified before the deadline, so we don't claim it.
- **Workaround:** ship Amazon Rekognition as the AWS runtime path (`lib/rekognition.js`, verified). Bedrock stays optional and off by default.
- **Suggestion:** return an explicit `AccountVerificationPending` error code from Bedrock while verification is pending, and give hackathon entrants a Bedrock sandbox quota.

### 12. A partner PWA can't call Ring from the browser, and account linking can't be tried without partner credentials (Docs, Medium)
- **Task:** build the homeowner app as an installable PWA with a real "Connect Ring" step.
- **Steps:** read "Partner-Initiated OAuth 2.0" and the warning that requests to `api.amazonvision.com` and `oauth.ring.com` must be server-to-server; checked what credentials the Playground provides.
- **Expected:** a sandbox OAuth client (`client_id`, `client_secret`, localhost redirect URI) for Playground users.
- **Actual:** browsers are blocked by CORS, and the OAuth flow needs credentials issued only during partner onboarding. The Playground gives only a bearer token.
- **Severity:** Medium. The real linking UX can be built but not run.
- **Workaround:** the PWA talks to the DropZone+ backend. `lib/oauth.js` implements the documented flow (PKCE S256, `state`, scope, code exchange, `PATCH app-integrations`) and is unit-tested against a fake token endpoint. Onboarding offers a Playground-token fallback and a labelled demo home.
- **Suggestion:** give Playground users a sandbox OAuth client with a localhost redirect URI.

### 13. The OAuth docs disagree on the scope value (Docs, Low)
- **Task:** build the Partner-Initiated authorize URL.
- **Steps:** read the "Authorization request parameters" table and the Python example and the token-response example on the same page.
- **Expected:** one scope string used consistently.
- **Actual:** the table says "Only the scope `ava.v1:read` is supported currently", but the example code builds `&scope=ava` and the example token response shows `"scope": "ava"`.
- **Severity:** Low. A wrong guess means an `invalid_scope` error at Ring with no way to test it from the Playground.
- **Workaround:** we follow the table (`ava.v1:read`) in `lib/oauth.js` and assert it in `test/oauth.test.js`.
- **Suggestion:** align the example code and response with the table.

### 14. App Integrations PATCH response shown in two different shapes (Docs, Low)
- **Task:** parse the response of `PATCH /v1/accounts/me/app-integrations` after linking.
- **Steps:** compared the "Confirm Account Link" section with the App Integrations reference.
- **Expected:** one response format.
- **Actual:** one section shows a plain object `{"account_identifier", "status", "updated_at"}`; the reference shows a JSON:API envelope `{"data": {"type": "app-integrations", "attributes": {…}}, "meta": {…}}`.
- **Severity:** Low. Parsing code has to handle both.
- **Workaround:** we only check the HTTP status (`res.ok`) and don't depend on the body.
- **Suggestion:** document a single shape (JSON:API, like the rest of the API).

## Feature requests

| Request | Why it matters | Priority |
|---|---|---|
| Playground webhook trigger (motion with `sub_type`, ding) | Event-driven apps are what the track rewards, but they can't be exercised end to end | High |
| Long-lived Playground or demo token | Judges and reviewers can't see live Ring data after 30 minutes | High |
| Write capability for owner-approved actions (lights, siren, chime) | "Ring meets other devices" today means Ring can only be an input. Example: flash the floodlight when the zone isn't clear | Medium |
| A "region of interest" or zone primitive in the API | Every yard-aware app needs a user-drawn zone; Ring already has motion zones internally | Medium |
| `sub_type` / detections in history | Enables historical analytics without re-running vision | Medium |
