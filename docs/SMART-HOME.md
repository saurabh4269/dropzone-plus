# DropZone Home: Alexa Smart Home skill (virtual devices)

DropZone Home is an Alexa Smart Home (v3) skill with three **virtual** endpoints. No real hardware is switched: device state lives in the Lambda container's memory and resets on a cold start.

| Endpoint | Interface | Directives |
| --- | --- | --- |
| Yard Lights (`dz-yard-lights`) | Alexa.PowerController | TurnOn, TurnOff, ReportState |
| Sprinkler (`dz-sprinkler`) | Alexa.PowerController | TurnOn, TurnOff, ReportState |
| Pet Door (`dz-pet-door`) | Alexa.LockController | Lock, Unlock, ReportState |

Also handled: Alexa.Discovery Discover, Alexa.Authorization AcceptGrant, ErrorResponse (NO_SUCH_ENDPOINT, INVALID_DIRECTIVE).

- Skill ID (development stage): `amzn1.ask.skill.e684e387-9b1c-47e6-8802-8fa02967da81`, en-US.
- Lambda: `dropzone-home-smarthome`, us-east-1, Node.js 22, 128 MB, tag `project=dropzone`. Trigger scoped to the skill ID (principal alexa-connectedhome.amazon.com). No database, nothing always-on.
- Account linking: Login with Amazon, auth code grant, authorization URL https://www.amazon.com/ap/oa, token URL https://api.amazon.com/auth/o2/token, scope `profile`. Client ID and secret are read from an env file at deploy time and never committed.

## Code and tests

- `smart-home/lambda/index.mjs`: the handler.
- `npm run test:smarthome`: 5 unit tests (discovery, TurnOn and ReportState, TurnOff, Lock and Unlock, errors, AcceptGrant).
- `smart-home/invoke-check.sh`: invokes the deployed Lambda with sample directives.
- `smart-home/deploy.sh`: updates Lambda code, manifest and account linking.

## Live Lambda check (23 Oct 2026 23:57 IST)

```
Discover   Discover.Response Yard Lights, Sprinkler, Pet Door 
TurnOn     Response ["powerState=ON"] 
ReportState StateReport ["powerState=ON"] 
TurnOff    Response ["powerState=OFF"] 
Lock       Response ["lockState=LOCKED"] 
ReportState StateReport ["lockState=LOCKED"] 
```

## Linking it in the Alexa app

1. The LWA security profile must list these Allowed Return URLs: `https://pitangui.amazon.com/api/skill/link/M4WU32ZALOUT9`, `https://layla.amazon.com/api/skill/link/M4WU32ZALOUT9`, `https://alexa.amazon.co.jp/api/skill/link/M4WU32ZALOUT9`.
2. Alexa app (signed in with the same Amazon account as the developer console), More, Skills and Games, Your Skills, Dev, DropZone Home, Enable to Use, sign in with Amazon.
3. Discover devices. Yard Lights, Sprinkler and Pet Door appear.
4. Say "Alexa, turn on yard lights", "Alexa, turn off sprinkler", "Alexa, lock pet door".
