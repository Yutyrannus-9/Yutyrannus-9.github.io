#!/bin/sh
# Build the public site and publish it to the gh-pages branch (GitHub Pages).
#   npm run deploy:pages
set -eu
cd "$(dirname "$0")/.."
PUBLIC_SITE=1 SITE_URL=https://yutyrannus-9.github.io npm run build:draft
node scripts/check-links.mjs
# Safety: MRI display volumes never ship unless mri.professionalRead is true
# (public/brain/mri exists locally for dev, so Astro copies it into dist).
if ! grep -Eq 'professionalRead:[[:space:]]*true' src/data/site.ts; then rm -rf dist/brain/mri; fi
touch dist/.nojekyll   # GitHub Pages' Jekyll would drop the _astro/ folder
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -R dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="Joel Jaramillo" -c user.email="Jjarami001@citymail.cuny.edu" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "$REMOTE" gh-pages
echo "Deployed to gh-pages"
