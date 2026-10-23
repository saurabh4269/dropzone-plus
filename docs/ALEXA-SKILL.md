# DropZone classic Alexa skill

A classic Alexa custom skill, invocation name **drop zone**, backed by AWS Lambda (Node.js 22, `ask-sdk-core`). This is classic Alexa, not Alexa+.

What is real: the skill, the interaction model, the Lambda (`dropzone-alexa-skill`, us-east-1) and the DropZone zone engine it runs (`public/core/zone.js`, `advisory.js`, `alexa.js`, copied into the bundle at build time).

What is simulated, and the skill says so out loud:
- **Frame source.** Without `DROPZONE_URL`, the Lambda evaluates a replay frame (scripted detections from `public/scenarios.js`, scenario `DZ_SCENARIO`, second `DZ_T`). With `DROPZONE_URL` set to a public DropZone server, it reads `/api/state` instead; any error gives UNKNOWN, never CLEAR.
- **Devices.** Pet door, yard lights and sprinkler are the simulated devices from `public/core/`. They act only after the owner says yes.

## Intents

| Say | Intent | Result |
|---|---|---|
| "Alexa, ask drop zone is the yard clear" | CheckZoneIntent | Heads-up from the engine; offers the pet door if a pet is in the zone |
| "ask the drone to wait" | HoldDroneIntent | Builds the carrier advisory; HOLD only if NOT_CLEAR |
| "keep the dog inside" | PetDoorIntent | Asks first |
| "turn on the yard lights" | YardLightsIntent | Asks first |
| "pause the sprinklers" | SprinklerPauseIntent | Asks first |
| "yes" / "no" | AMAZON.YesIntent / NoIntent | Acts on the pending offer only on yes |

## Verified output

Direct `aws lambda invoke` of the deployed function with an Alexa request envelope (23 Oct 2026, 23:41 IST):

```
CheckZoneIntent: <speak>Heads up: your drone delivery is about 8 minutes away, and there's a dog in the drop zone. Want me to set the pet door to come-in-only until the drone has left? This is a simulated replay frame, not a live camera.</speak>  sessionAttributes: {pending: petdoor.in_only}
HoldDroneIntent: <speak>Okay. I've asked the drone to wait about 60 seconds because the drop zone isn't clear. The carrier still makes the final call. This is a simulated replay frame, not a live camera.</speak>
```

Deployed skill `amzn1.ask.skill.3b8cced3-4928-4a6b-8b52-a370dbeea345` (development stage, en-US and en-IN, testing enabled), Lambda trigger scoped to that skill ID. Real Alexa simulator run with `ask smapi simulate-skill` (23 Oct 2026, 23:49 IST); requests went through Alexa's own speech-to-intent and into the Lambda:

```
USER: ask drop zone is the yard clear
  status: SUCCESSFUL | request: CheckZoneIntent
  ALEXA: Heads up: your drone delivery is about 8 minutes away, and there's a dog in the drop zone. Want me to set the pet door to come-in-only until the drone has left? This is a simulated replay frame, not a live camera. 
USER: yes
  status: SUCCESSFUL | request: AMAZON.YesIntent
  ALEXA: Okay. The pet door is now come-in-only. I'll set it back once the drone has gone. This is a simulated device. 
USER: ask drop zone to ask the drone to wait
  status: SUCCESSFUL | request: HoldDroneIntent
  ALEXA: Okay. I've asked the drone to wait about 60 seconds because the drop zone isn't clear. The carrier still makes the final call. This is a simulated replay frame, not a live camera. 
USER: open drop zone
  status: SUCCESSFUL | request: LaunchRequest
  ALEXA: DropZone is watching your drop zone. Ask me if the yard is clear, or ask the drone to wait. 
USER: pause the sprinklers
  status: SUCCESSFUL | request: SprinklerPauseIntent
  ALEXA: Do you want me to pause the sprinklers until the drone has left? 
USER: no
  status: SUCCESSFUL | request: AMAZON.NoIntent
  ALEXA: Okay, I won't change anything.
```

Handler tests: `npm run test:alexa` (8 tests, real `ask-sdk-core` with request envelopes).

## Deploy

1. `ask configure --no-browser` once (Login with Amazon on the developer account).
2. `alexa-skill/deploy.sh` builds the bundle, updates the Lambda, creates the skill with SMAPI, grants `alexa-appkit.amazon.com` invoke permission scoped to the skill ID, uploads en-US and en-IN models and enables testing.
3. Test: `ask dialog -s <skill-id> -l en-US` or `ask smapi simulate-skill -s <skill-id> -g development --device-locale en-US --input-content "ask drop zone is the yard clear"`, or the Test tab of the Alexa developer console.
