#!/usr/bin/env bash
# Install the CI workflow. GitHub refuses workflow files from OAuth tokens without the `workflow` scope, so run first:
#   gh auth refresh -h github.com -s workflow
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .github/workflows
cp ci/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "CI: enable GitHub Actions (tests on Node 20/22, browser e2e)"
git push origin HEAD
