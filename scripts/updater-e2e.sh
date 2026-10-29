#!/usr/bin/env bash
# Teste de ponta a ponta do atualizador, com o app de teste de verdade ("Company Manager Teste", identificador
# com.company.manager.updatetest: banco e preferências próprios, nunca os do app de produção nem o de /Applications).
#
# Uso: scripts/updater-e2e.sh <pasta-de-trabalho> <old.app> <old.app.tar.gz> <old.app.tar.gz.sig> <versão-esperada>
#   <old.app>: build da versão inicial (npm run tauri build -- --bundles app --config src-tauri/tauri.updatetest.conf.json ...)
#   <versão-esperada>: versão publicada no canal de teste do GitHub (release "updater-test"), ex. 0.1.1-test.1
#
# Etapas:
#  1. instala a versão inicial numa pasta isolada e grava dados de controle no banco do app de teste;
#  2. cenários de falha contra um servidor local, com o binário real: sem atualização, versão inferior, falha de
#     conexão, pacote corrompido, download interrompido e falha de instalação (com rollback);
#  3. atualização real pelo GitHub Releases: o app acha a versão nova, o teste clica em "Atualizar" pelo DOM, o app
#     baixa, confere a assinatura, troca o bundle e reinicia; confere a versão nova rodando e os dados intactos.
# Relatório: <pasta-de-trabalho>/report.txt (linhas do app) e o resumo no fim da saída. Sai com erro se algo falhar.
set -euo pipefail

WORK="$1"; OLD_APP="$2"; OLD_PKG="$3"; OLD_SIG="$4"; EXPECTED="$5"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="com.company.manager.updatetest"
DATA="$HOME/Library/Application Support/$ID"
DB="$DATA/company-manager.db"
INSTALL_DIR="$WORK/install"
APP="$INSTALL_DIR/Company Manager Teste.app"
BIN="$APP/Contents/MacOS/company-manager"
SERVE="$WORK/serve"
PORT=48765
REPORT="$WORK/report.txt"
SUMMARY="$WORK/summary.txt"
FAILED=0
SERVER_PID=""

: > "$SUMMARY"
pass() { echo "PASS  $*" | tee -a "$SUMMARY"; }
fail() { echo "FAIL  $*" | tee -a "$SUMMARY"; FAILED=1; }
plist_version() { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist"; }
stop_app() { pkill -f "$INSTALL_DIR/.*/company-manager" >/dev/null 2>&1 || true; sleep 1; }
cleanup() { stop_app; [ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1 || true; chmod -R u+w "$INSTALL_DIR" 2>/dev/null || true; }
trap cleanup EXIT

# Espera uma linha no relatório que case com a regex (timeout em segundos).
wait_for() {
  local pattern="$1" timeout="${2:-60}" i
  for ((i = 0; i < timeout * 2; i++)); do
    grep -Eq "$pattern" "$REPORT" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

# Abre o app com o relatório zerado e, opcionalmente, outro endpoint.
launch() {
  local endpoint="${1:-}"
  stop_app
  : > "$REPORT"
  if [ -n "$endpoint" ]; then
    CM_UPDATE_AUTOTEST="$REPORT" CM_UPDATE_ENDPOINT="$endpoint" "$BIN" >>"$WORK/app.log" 2>&1 &
  else
    CM_UPDATE_AUTOTEST="$REPORT" "$BIN" >>"$WORK/app.log" 2>&1 &
  fi
}

latest_json() { # versão url assinatura
  printf '{"version":"%s","notes":"teste local","pub_date":"2026-10-28T00:00:00Z","platforms":{"darwin-aarch64":{"signature":"%s","url":"%s"}}}\n' "$1" "$3" "$2"
}

mkdir -p "$WORK" "$SERVE"
: > "$WORK/app.log"
[ "$(uname -m)" = "arm64" ] || { echo "Este teste usa o pacote darwin-aarch64." >&2; exit 1; }

# ---------- 1. Versão inicial isolada e dados de controle ----------
stop_app
rm -rf "$INSTALL_DIR" && mkdir -p "$INSTALL_DIR"
ditto "$OLD_APP" "$APP"
OLD_VERSION="$(plist_version)"
echo "Versão inicial instalada: $OLD_VERSION em $APP"

# Primeira abertura: cria o banco do app de teste e aplica as migrations.
launch "http://127.0.0.1:9/latest.json"
wait_for '^launch version=' 60 || { fail "app inicial não abriu"; exit 1; }
for _ in $(seq 1 60); do [ -f "$DB" ] && sqlite3 "$DB" "select count(*) from _sqlx_migrations" >/dev/null 2>&1 && break; sleep 1; done
sleep 3
stop_app
MIGRATIONS_BEFORE="$(sqlite3 "$DB" "select count(*) from _sqlx_migrations where success = 1")"
TOKEN="e2e-$(date +%s)"
sqlite3 "$DB" "create table if not exists updater_e2e_marker (token text primary key, created_at text); insert into updater_e2e_marker values ('$TOKEN', datetime('now'));"
printf '%s\n' "$TOKEN" > "$DATA/updater-e2e-preference.txt"
CHECK_SQL="select group_concat(token) from updater_e2e_marker"
MARKER_BEFORE="$(sqlite3 "$DB" "$CHECK_SQL")"
TABLES_BEFORE="$(sqlite3 "$DB" "select count(*) from sqlite_master where type = 'table'")"
echo "Dados de controle: token=$TOKEN migrations=$MIGRATIONS_BEFORE tabelas=$TABLES_BEFORE"

# ---------- 2. Cenários de falha (servidor local, binário real) ----------
cp "$OLD_PKG" "$SERVE/valid.tar.gz"
SIG="$(cat "$OLD_SIG")"
head -c 4096 "$OLD_PKG" > "$SERVE/corrupt.tar.gz"
head -c 200000 /dev/urandom >> "$SERVE/corrupt.tar.gz"
BASE="http://127.0.0.1:$PORT"
latest_json "$OLD_VERSION" "$BASE/valid.tar.gz" "$SIG" > "$SERVE/latest-same.json"
latest_json "0.0.1" "$BASE/valid.tar.gz" "$SIG" > "$SERVE/latest-lower.json"
latest_json "9.9.9" "$BASE/corrupt.tar.gz" "$SIG" > "$SERVE/latest-corrupt.json"
latest_json "9.9.9" "$BASE/truncated.tar.gz" "$SIG" > "$SERVE/latest-truncated.json"
latest_json "9.9.9" "$BASE/valid.tar.gz" "$SIG" > "$SERVE/latest-valid.json"
python3 -I "$ROOT/scripts/updater-e2e-server.py" "$PORT" "$SERVE" 2>>"$WORK/server.log" &
SERVER_PID=$!
sleep 1

APP_SUM_BEFORE="$(cd "$APP" && find . -type f -exec shasum {} + | sort | shasum | cut -c1-40)"
app_unchanged() { [ "$(cd "$APP" && find . -type f -exec shasum {} + | sort | shasum | cut -c1-40)" = "$APP_SUM_BEFORE" ]; }

launch "$BASE/latest-same.json"
if wait_for "^check current=$OLD_VERSION available=none" 60 && wait_for '^ui_state upToDate' 10; then pass "sem atualização: Atualizado, botão escondido"; else fail "sem atualização"; fi

launch "$BASE/latest-lower.json"
if wait_for '^check .* available=none' 60 && ! grep -q '^install_start' "$REPORT"; then pass "versão inferior (0.0.1) não é oferecida nem instalada"; else fail "versão inferior"; fi

launch "http://127.0.0.1:9/latest.json"
if wait_for '^check_error' 60 && wait_for '^ui_state error' 10; then pass "falha de conexão: erro mostrado ($(grep -m1 '^ui_state error' "$REPORT" | sed 's/.*message=//'))"; else fail "falha de conexão"; fi

launch "$BASE/latest-corrupt.json"
if wait_for '^install_error' 90 && app_unchanged && [ "$(plist_version)" = "$OLD_VERSION" ]; then
  pass "pacote corrompido recusado ($(grep -m1 '^install_error' "$REPORT" | cut -c15-90)); app intacto"
else fail "pacote corrompido"; fi

launch "$BASE/latest-truncated.json"
if wait_for '^install_error' 90 && app_unchanged; then pass "download interrompido: erro ($(grep -m1 '^install_error' "$REPORT" | cut -c15-90)); app intacto"; else fail "download interrompido"; fi

# Falha de instalação: pasta do app sem permissão de escrita (o plugin não consegue trocar o bundle).
launch "$BASE/latest-valid.json"
wait_for '^ui_state available' 60 || true
chmod a-w "$INSTALL_DIR"
if wait_for '^install_error' 90; then
  chmod u+w "$INSTALL_DIR"
  if app_unchanged && [ "$(plist_version)" = "$OLD_VERSION" ]; then
    pass "falha de instalação ($(grep -m1 '^install_error' "$REPORT" | cut -c15-90)); versão anterior preservada (rollback)"
  else fail "falha de instalação: app alterado"; fi
else chmod u+w "$INSTALL_DIR"; fail "falha de instalação: sem erro"; fi
stop_app
kill "$SERVER_PID" >/dev/null 2>&1 || true; SERVER_PID=""

# ---------- 3. Atualização real pelo GitHub Releases (canal de teste) ----------
launch ""
if wait_for "^check current=$OLD_VERSION available=$EXPECTED" 90; then pass "detectou $EXPECTED no GitHub (canal de teste)"; else fail "não detectou $EXPECTED"; fi
if wait_for '^ui_button_enabled true' 15; then pass "botão Atualizar habilitado e clicado pelo teste"; else fail "botão Atualizar"; fi
if wait_for "^download_verified" 300; then pass "download completo e assinatura minisign conferida ($(grep -m1 '^download_verified' "$REPORT" | sed 's/.*bytes=//') bytes)"; else fail "download/assinatura"; fi
if wait_for "^install_ok version=$EXPECTED" 60; then pass "bundle trocado ($(grep -m1 '^swap_ok' "$REPORT" | sed 's/^swap_ok //'))"; else fail "instalação"; fi
if wait_for "^launch version=$EXPECTED" 60; then pass "app reiniciou sozinho na versão $EXPECTED"; else fail "reinício na versão nova"; fi
if wait_for "^previous_removed from=$OLD_VERSION to=$EXPECTED ok=true" 10 && [ -z "$(find "$INSTALL_DIR" -maxdepth 1 -name '.*previous*')" ]; then
  pass "cópia anterior guardada até a versão nova abrir e só então apagada"
else fail "backup da versão anterior"; fi
DOWNLOAD_URL="$(grep -m1 '^install_start' "$REPORT" | sed 's/.*url=//')"
wait_for "^check current=$EXPECTED available=none" 60 || true
sleep 3

NEW_VERSION="$(plist_version)"
RUNNING="$(ps -axo command | grep -F "$BIN" | grep -v grep | head -1 || true)"
[ "$NEW_VERSION" = "$EXPECTED" ] && pass "Info.plist do app instalado: $NEW_VERSION" || fail "Info.plist: $NEW_VERSION"
[ -n "$RUNNING" ] && pass "processo da versão nova rodando ($BIN)" || fail "app não está rodando"
xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1 && fail "bundle novo ficou em quarentena" || pass "bundle novo sem quarentena (abre sem aviso do Gatekeeper)"
codesign --verify --deep "$APP" 2>/dev/null && pass "codesign --verify do bundle novo ok" || fail "codesign do bundle novo"
[ "$(find "$INSTALL_DIR" -maxdepth 1 -name '*.app' | wc -l | tr -d ' ')" = 1 ] && pass "uma única cópia do app na pasta (a antiga foi substituída)" || fail "sobrou cópia do app"
stop_app

MARKER_AFTER="$(sqlite3 "$DB" "$CHECK_SQL")"
MIGRATIONS_AFTER="$(sqlite3 "$DB" "select count(*) from _sqlx_migrations where success = 1")"
TABLES_AFTER="$(sqlite3 "$DB" "select count(*) from sqlite_master where type = 'table'")"
INTEGRITY="$(sqlite3 "$DB" "pragma integrity_check")"
if [ "$MARKER_AFTER" = "$MARKER_BEFORE" ] && [ "$(cat "$DATA/updater-e2e-preference.txt")" = "$TOKEN" ] && [ "$INTEGRITY" = ok ] \
  && [ "$MIGRATIONS_AFTER" -ge "$MIGRATIONS_BEFORE" ] && [ "$TABLES_AFTER" -ge "$TABLES_BEFORE" ]; then
  pass "dados preservados: token=$MARKER_AFTER, migrations $MIGRATIONS_BEFORE→$MIGRATIONS_AFTER, tabelas $TABLES_BEFORE→$TABLES_AFTER, integrity_check=$INTEGRITY"
else fail "dados: token=$MARKER_AFTER migrations=$MIGRATIONS_AFTER tabelas=$TABLES_AFTER integrity=$INTEGRITY"; fi

{
  echo "versão anterior: $OLD_VERSION"
  echo "versão instalada: $NEW_VERSION"
  echo "pacote baixado: $DOWNLOAD_URL"
} | tee -a "$SUMMARY"
cp "$REPORT" "$WORK/report-update.txt"
exit "$FAILED"
