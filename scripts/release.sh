#!/usr/bin/env bash
# Build the Mac and Windows installers and publish them to stickies.lfiq.app.
#
#   npm run release            build, upload to R2, write latest.json
#   SKIP_BUILD=1 npm run release   upload what is already in dist/
#
# Installers go to R2 bucket stickies-releases under v<version>/; the download
# page (site/) reads latest.json, so publishing never needs a Worker deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET=stickies-releases
export CLOUDFLARE_ACCOUNT_ID=c16c7246ee0a89e6deafe19a74480c6a  # Left Field Investments
VERSION=$(node -p "require('./package.json').version")
RELEASED=$(date +%Y-%m-%d)

npm run test:generic

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  rm -rf dist
  npx electron-builder --mac --win --publish never
fi

FILES=(
  "mac arm64 Stickies-${VERSION}-mac-arm64.dmg"
  "mac x64 Stickies-${VERSION}-mac-x64.dmg"
  "windows x64 Stickies-${VERSION}-windows-x64-setup.exe"
)

entries=()
for row in "${FILES[@]}"; do
  read -r os arch name <<<"$row"
  path="dist/$name"
  [[ -f "$path" ]] || { echo "missing $path" >&2; exit 1; }
  key="v${VERSION}/${name}"
  size=$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path")
  sha=$(shasum -a 256 "$path" | cut -d' ' -f1)
  echo "uploading $key ($size bytes)"
  npx wrangler r2 object put "${BUCKET}/${key}" --file "$path" --content-type application/octet-stream --remote
  entries+=("{\"os\":\"$os\",\"arch\":\"$arch\",\"key\":\"$key\",\"size\":$size,\"sha256\":\"$sha\"}")
done

manifest=$(mktemp)
printf '{"version":"%s","released":"%s","files":[%s]}\n' "$VERSION" "$RELEASED" "$(IFS=,; echo "${entries[*]}")" > "$manifest"
npx wrangler r2 object put "${BUCKET}/latest.json" --file "$manifest" --content-type application/json --remote
rm -f "$manifest"
echo "published Stickies ${VERSION}: https://stickies.lfiq.app"
