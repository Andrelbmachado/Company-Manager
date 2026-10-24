#!/usr/bin/env bash
# Compila o app e deixa UMA única cópia instalada em /Applications (remove a antiga e qualquer sobra de build/DMG).
set -euo pipefail

APP_NAME="Company Manager"
DEST="/Applications/${APP_NAME}.app"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/cm-target}"

cd "$(dirname "$0")/.."
npm run tauri build -- --bundles app

BUILT="$CARGO_TARGET_DIR/release/bundle/macos/${APP_NAME}.app"
[ -d "$BUILT" ] || { echo "Build não gerou $BUILT" >&2; exit 1; }

osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
sleep 1
pkill -x company-manager >/dev/null 2>&1 || true

rm -rf "$DEST"
ditto "$BUILT" "$DEST"
codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || true

# Uma cópia só: apaga a do build e instaladores de teste.
rm -rf "$BUILT" "$CARGO_TARGET_DIR/release/bundle/dmg"
rm -f "$HOME/Desktop/${APP_NAME}"_*.dmg
for vol in "/Volumes/${APP_NAME}"*; do [ -d "$vol" ] && hdiutil detach "$vol" >/dev/null 2>&1 || true; done

echo "Instalado: $DEST"
mdfind "kMDItemFSName == '${APP_NAME}.app'" | grep -v "$DEST" || true
