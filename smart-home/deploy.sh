#!/usr/bin/env bash
# Deploys the DropZone Home Smart Home (v3) skill: Lambda code + SMAPI manifest + account linking.
# Needs: `ask configure` done once, AWS CLI default profile, and an LWA env file (LWA_CLIENT_ID, LWA_CLIENT_SECRET)
# at $LWA_ENV (default /workspace/secrets/lwa.env). No secrets live in this repo; the secret is written to a
# mode-600 temp file only for the SMAPI call and deleted right after.
set -euo pipefail
cd "$(dirname "$0")"
REGION=${AWS_REGION:-us-east-1}; FN=dropzone-home-smarthome; LWA_ENV=${LWA_ENV:-/workspace/secrets/lwa.env}
(cd lambda && python3 -c "import zipfile;z=zipfile.ZipFile('../dropzone-home-lambda.zip','w');z.write('index.mjs')")
aws lambda update-function-code --region "$REGION" --function-name $FN --zip-file fileb://dropzone-home-lambda.zip >/dev/null
SID=$(cat .skill-id)
ask smapi update-skill-manifest -s "$SID" -g development --manifest "file:skill-package/skill.json"
umask 077; TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
( set -a; . "$LWA_ENV"; set +a; node -e '
const j={accountLinkingRequest:{type:"AUTH_CODE",authorizationUrl:"https://www.amazon.com/ap/oa",accessTokenUrl:"https://api.amazon.com/auth/o2/token",clientId:process.env.LWA_CLIENT_ID,clientSecret:process.env.LWA_CLIENT_SECRET,accessTokenScheme:"HTTP_BASIC",scopes:["profile"],domains:[],defaultTokenExpirationInSeconds:3600}};
require("fs").writeFileSync(process.argv[1],JSON.stringify(j));' "$TMP" )
ask smapi update-account-linking-info -s "$SID" -g development --account-linking-request "file:$TMP"
./invoke-check.sh
