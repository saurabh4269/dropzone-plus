#!/usr/bin/env bash
# Creates/updates the DropZone classic Alexa skill with SMAPI (ask-cli) and wires it to the Lambda.
# Needs: `ask configure` done once (Login with Amazon), AWS CLI with a default profile. No secrets in this repo.
set -euo pipefail
cd "$(dirname "$0")"
REGION=${AWS_REGION:-us-east-1}
FN=dropzone-alexa-skill
AWS=${AWS:-aws}
./lambda/build.sh
$AWS lambda update-function-code --region "$REGION" --function-name $FN --zip-file fileb://dropzone-lambda.zip >/dev/null
VENDOR=$(ask smapi list-vendors | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).vendors[0].id))")
if [ -f .skill-id ]; then SKILL_ID=$(cat .skill-id); ask smapi update-skill-manifest -s "$SKILL_ID" -g development --manifest "file:skill-package/skill.json"
else
  SKILL_ID=$(ask smapi create-skill-for-vendor --vendor-id "$VENDOR" --manifest "file:skill-package/skill.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).skillId))")
  echo "$SKILL_ID" > .skill-id
  $AWS lambda add-permission --region "$REGION" --function-name $FN --statement-id alexa-skill --action lambda:InvokeFunction --principal alexa-appkit.amazon.com --event-source-token "$SKILL_ID" >/dev/null
fi
sleep 5
for L in en-US en-IN; do ask smapi set-interaction-model -s "$SKILL_ID" -g development -l $L --interaction-model "file:skill-package/interactionModels/custom/$L.json"; done
sleep 20
ask smapi set-skill-enablement -s "$SKILL_ID" -g development || true
echo "skill $SKILL_ID deployed. Test: ask dialog -s $SKILL_ID -l en-US   or   ask smapi simulate-skill -s $SKILL_ID -l en-US --input-content 'ask drop zone is the yard clear' --device-locale en-US"
