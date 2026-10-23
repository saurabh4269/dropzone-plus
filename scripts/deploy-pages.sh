#!/usr/bin/env bash
# Publish public/ (replay mode, no server, no token) to the gh-pages branch -> GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
git subtree split --prefix public -b gh-pages-tmp
git push -f origin gh-pages-tmp:gh-pages
git branch -D gh-pages-tmp
