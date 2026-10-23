#!/usr/bin/env bash
# Invokes the deployed Lambda with sample v3 directives (Discovery, TurnOn, Lock, ReportState) and prints the replies.
set -euo pipefail
cd "$(dirname "$0")"
FN=dropzone-home-smarthome; REGION=${AWS_REGION:-us-east-1}
mk() { node --input-type=module -e "import {dir} from './test/samples.mjs'; process.stdout.write(JSON.stringify(dir(...process.argv.slice(1))))" "$@"; }
run() { mk "$@" > /tmp/dz-in.json; aws lambda invoke --region $REGION --function-name $FN --cli-binary-format raw-in-base64-out --payload file:///tmp/dz-in.json /tmp/dz-out.json >/dev/null
  node -e "const r=require('/tmp/dz-out.json');const e=r.event;console.log('$2'.padEnd(10),e.header.name,e.payload.endpoints?e.payload.endpoints.map(x=>x.friendlyName).join(', '):JSON.stringify((r.context?.properties||[]).filter(p=>p.namespace!=='Alexa.EndpointHealth').map(p=>p.name+'='+p.value)), e.payload.type||'')"; }
run Alexa.Discovery Discover
run Alexa.PowerController TurnOn dz-yard-lights
run Alexa ReportState dz-yard-lights
run Alexa.PowerController TurnOff dz-sprinkler
run Alexa.LockController Lock dz-pet-door
run Alexa ReportState dz-pet-door
