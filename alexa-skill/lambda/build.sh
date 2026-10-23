#!/usr/bin/env bash
# Copies the real DropZone engine into the Lambda bundle and zips it. Run from repo root or anywhere.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dz && mkdir -p dz/core
cp ../../public/core/*.js dz/core/
cp ../../public/scenarios.js dz/scenarios.js
npm install --omit=dev --no-audit --no-fund --silent
rm -f ../dropzone-lambda.zip
python3 -c "import shutil; shutil.make_archive('../dropzone-lambda', 'zip', '.')" && python3 - <<'PY'
import zipfile; z=zipfile.ZipFile("../dropzone-lambda.zip"); print(len(z.namelist()), "files")
PY
echo "built alexa-skill/dropzone-lambda.zip"
