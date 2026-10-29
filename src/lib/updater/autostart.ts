// Liga o atualizador quando o app desktop abre (App.tsx). No teste de ponta a ponta (scripts/updater-e2e.sh, variável
// CM_UPDATE_AUTOTEST) cada estado vai para o relatório e o teste clica no botão "Atualizar" de verdade, pelo DOM,
// assim que ele aparece.
import { appUpdater, autotestEnabled, autotestLog, type AppUpdater } from "./updater";

export function startAppUpdater(updater: AppUpdater = appUpdater()): void {
  void autotestEnabled().then((enabled) => {
    if (enabled) watchForAutotest(updater);
    updater.start();
  });
}

function watchForAutotest(updater: AppUpdater): void {
  let clicked = false;
  let last = "";
  updater.subscribe(() => {
    const state = updater.getState();
    const line = `ui_state ${state.status} current=${state.currentVersion ?? "?"}` +
      ("availableVersion" in state ? ` available=${state.availableVersion}` : "") +
      (state.status === "error" ? ` message=${state.message}` : "");
    if (line === last || state.status === "downloading") {
      if (state.status === "downloading" && !last.startsWith("ui_state downloading")) autotestLog((last = line));
      return;
    }
    autotestLog((last = line));
    if (state.status === "available" && !clicked) {
      // Espera o React desenhar o botão e clica nele, como a pessoa faria.
      setTimeout(() => {
        const button = document.querySelector<HTMLButtonElement>('[data-updater-action="install"]');
        autotestLog(`ui_button_enabled ${button ? !button.disabled : "missing"}`);
        if (button && !button.disabled) {
          clicked = true;
          button.click();
        }
      }, 500);
    }
  });
}
