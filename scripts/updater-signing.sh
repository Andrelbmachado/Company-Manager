# Incluído por install-app.sh, build-dmg.sh e updater-e2e.sh (source). O tauri.conf.json pede os pacotes de
# atualização assinados (createUpdaterArtifacts); a chave privada fica fora do repositório, em
# ~/.tauri/company-manager-updater.key (no GitHub Actions, no segredo TAURI_SIGNING_PRIVATE_KEY).
# Com a chave: exporta para o `tauri build`. Sem ela: o build segue sem o pacote de atualização (UPDATER_ARGS).
UPDATER_KEY_FILE="${UPDATER_KEY_FILE:-$HOME/.tauri/company-manager-updater.key}"
UPDATER_ARGS=()
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$UPDATER_KEY_FILE" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY_FILE")"
  export TAURI_SIGNING_PRIVATE_KEY
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "Aviso: sem a chave do atualizador ($UPDATER_KEY_FILE); o build não gera o pacote de atualização." >&2
  UPDATER_ARGS=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi
