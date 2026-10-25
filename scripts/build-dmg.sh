#!/usr/bin/env bash
# Gera o instalador DMG do Company Manager para macOS (não instala nada; para instalar use `npm run install:app`).
# Uso: npm run dmg [-- opções]
#   --install-deps  roda `npm ci` antes (máquina nova ou CI)
#   --no-finder     não usa o Finder (AppleScript) para arrumar a janela do DMG (sessão sem tela ou sem permissão de Automação)
#   outros argumentos vão para `tauri build` (ex.: --target universal-apple-darwin)
# Resultado: dist-installers/Company Manager_<versão>_<arquitetura>.dmg (uma única cópia; o build não deixa .app nem DMG sobrando).
set -euo pipefail

APP_NAME="Company Manager"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/dist-installers"
# Login rápido temporário (regra 2 do plano): se estiver ligado, o DMG entra em qualquer área sem senha.
QUICK_LOGIN_FILE="src/lib/dev/quickLogin.ts"
# Fora do iCloud Drive (o repositório fica em ~/Documents): build release em pasta sincronizada é lento e
# arquivos "só na nuvem" quebram o link. Mesmo diretório do scripts/install-app.sh, para reaproveitar a compilação.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/cm-target}"

INSTALL_DEPS=0
TAURI_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --install-deps) INSTALL_DEPS=1 ;;
    # Com CI definido, o bundler do Tauri pula o AppleScript do Finder (--skip-jenkins): o DMG continua com o app e o atalho Aplicativos.
    --no-finder) export CI=true ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) TAURI_ARGS+=("$arg") ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || { echo "O DMG só pode ser gerado no macOS." >&2; exit 1; }
cd "$ROOT"

detach_app_volumes() {
  local vol
  for vol in "/Volumes/${APP_NAME}"*; do
    if [ -d "$vol" ]; then hdiutil detach -quiet "$vol" || hdiutil detach -force -quiet "$vol" || true; fi
  done
}

# iCloud Drive: pede o download do que estiver "só na nuvem" antes de compilar.
if command -v brctl >/dev/null 2>&1; then
  for p in src src-tauri/src src-tauri/migrations src-tauri/icons src-tauri/capabilities index.html; do
    if [ -e "$p" ]; then brctl download "$p" >/dev/null 2>&1 || true; fi
  done
fi

if [ "$INSTALL_DEPS" = 1 ]; then npm ci; fi

# Volume de um build anterior interrompido faria o novo DMG montar como "Company Manager 1".
detach_app_volumes

STAMP="$(mktemp -t cm-dmg-stamp)"
WORK=""
MNT=""
cleanup() {
  if [ -n "$MNT" ] && [ -d "$MNT" ]; then hdiutil detach -quiet "$MNT" || hdiutil detach -force -quiet "$MNT" || true; rmdir "$MNT" 2>/dev/null || true; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  rm -f "$STAMP"
}
trap cleanup EXIT

npm run tauri build -- --bundles dmg ${TAURI_ARGS[@]+"${TAURI_ARGS[@]}"}

DMG="$(find "$CARGO_TARGET_DIR" -maxdepth 5 -path '*/release/bundle/dmg/*.dmg' -newer "$STAMP" -print -quit)"
[ -n "$DMG" ] || { echo "O build não gerou nenhum DMG em $CARGO_TARGET_DIR/**/release/bundle/dmg" >&2; exit 1; }
BUNDLE_DIR="$(dirname "$(dirname "$DMG")")"
FINAL="$OUT_DIR/$(basename "$DMG")"

# Limpa o app dentro do DMG. Checkout em pasta oculta no iCloud Drive (ex.: worktree em .claude/) fica com o flag
# "hidden" (o iCloud o recoloca segundos depois de um chflags na origem). O bundler copia o flag para o volume HFS+
# do DMG, onde ele vira FinderInfo no icon.icns, e o app falha no `codesign --verify --strict` (e na notarização).
# A assinatura não cobre esses atributos: abre a imagem em leitura-escrita, tira flag/FinderInfo do .app e recomprime.
WORK="$(mktemp -d -t cm-dmg-work)"
hdiutil convert -quiet "$DMG" -format UDRW -o "$WORK/rw.dmg"
MNT="$WORK/mnt"
mkdir "$MNT"
hdiutil attach -quiet -nobrowse -noautoopen -mountpoint "$MNT" "$WORK/rw.dmg"
chflags -R nohidden "$MNT/${APP_NAME}.app"
xattr -dr com.apple.FinderInfo "$MNT/${APP_NAME}.app" 2>/dev/null || true
rm -rf "$MNT/.fseventsd" "$MNT/.Trashes" "$MNT/.Spotlight-V100"
hdiutil detach -quiet "$MNT"
MNT=""
# A imagem final fica na pasta temporária até passar na autoverificação: se algo falhar, o trap a apaga
# e o DMG anterior de dist-installers/ continua lá (nunca sobra um DMG quebrado com cara de pronto).
NEW="$WORK/final.dmg"
hdiutil convert -quiet "$WORK/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$NEW"
rm -f "$WORK/rw.dmg"

# Uma cópia só (regra 1 do plano): sai o DMG do target e o .app que o bundler monta para gerá-lo.
rm -f "$DMG"
rm -rf "$BUNDLE_DIR/macos/${APP_NAME}.app"
detach_app_volumes

# Autoverificação: imagem íntegra e app assinado (ad-hoc), sem atributos estranhos, dentro dela.
hdiutil verify -quiet "$NEW"
MNT="$(mktemp -d -t cm-dmg-mnt)"
hdiutil attach -quiet -readonly -nobrowse -noautoopen -mountpoint "$MNT" "$NEW"
APP="$MNT/${APP_NAME}.app"
[ -d "$APP" ] || { echo "DMG sem ${APP_NAME}.app" >&2; exit 1; }
[ -L "$MNT/Applications" ] || { echo "DMG sem o atalho para Aplicativos" >&2; exit 1; }
codesign --verify --deep --strict "$APP"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
MIN_OS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist")"
ARCHS="$(lipo -archs "$APP/Contents/MacOS/company-manager")"
hdiutil detach -quiet "$MNT" && rmdir "$MNT" && MNT=""

# Passou: só agora troca o DMG anterior (uma única cópia em dist-installers/).
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/${APP_NAME}"_*.dmg
mv "$NEW" "$FINAL"
rm -rf "$WORK"
WORK=""

echo
echo "DMG pronto: $FINAL"
echo "  versão $VERSION · macOS $MIN_OS+ · $ARCHS · $(du -h "$FINAL" | cut -f1 | tr -d ' ') · sha256 $(shasum -a 256 "$FINAL" | cut -d' ' -f1)"
echo "  Assinatura ad-hoc (sem Apple Developer ID): em outro Mac o Gatekeeper bloqueia na 1ª abertura."
echo "  Liberar: Ajustes do Sistema > Privacidade e Segurança > \"Abrir Mesmo Assim\", ou"
echo "  xattr -dr com.apple.quarantine \"/Applications/${APP_NAME}.app\""

if [ -f "$QUICK_LOGIN_FILE" ] && grep -Eq '^export const DEV_QUICK_LOGIN[^=]*=[[:space:]]*true' "$QUICK_LOGIN_FILE"; then
  echo >&2
  echo "ATENÇÃO: o login rápido de desenvolvimento está ligado (DEV_QUICK_LOGIN = true em $QUICK_LOGIN_FILE)." >&2
  echo "  Com este DMG qualquer pessoa entra em qualquer área sem senha, e o primeiro login rápido cria contas" >&2
  echo "  dev.<papel>@company.local com senha fixa e grava dados de exemplo no banco. Não distribua fora da empresa;" >&2
  echo "  para desligar, ponha DEV_QUICK_LOGIN = false e gere o DMG de novo." >&2
fi
