import { useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { appUpdater, progressPercent, type AppUpdater, type UpdateState } from "@/lib/updater/updater";
import { cn } from "@/lib/utils";

export function useUpdateState(updater: AppUpdater = appUpdater()): UpdateState {
  return useSyncExternalStore(updater.subscribe, updater.getState, updater.getState);
}

function statusText(state: UpdateState): string {
  switch (state.status) {
    case "idle":
    case "checking":
      return "Verificando atualizações…";
    case "upToDate":
      return "Atualizado";
    case "available":
      return "Atualização disponível";
    case "downloading": {
      const percent = progressPercent(state);
      return percent === null ? "Baixando…" : `Baixando ${percent}%`;
    }
    case "installing":
      return "Instalando…";
    case "done":
      return "Concluído. Reiniciando…";
    case "error":
      return state.phase === "check" ? "Não foi possível verificar" : "A atualização falhou";
  }
}

function availableVersion(state: UpdateState): string | null {
  return "availableVersion" in state ? state.availableVersion : null;
}

/** Botão principal: "Atualizar" (só com versão mais nova) ou "Tentar novamente" (depois de um erro). */
function UpdateAction({ state, updater }: { state: UpdateState; updater: AppUpdater }) {
  if (state.status === "available") {
    return (
      <button
        type="button"
        data-updater-action="install"
        onClick={() => void updater.install()}
        className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Download size={14} />
        Atualizar
      </button>
    );
  }
  if (state.status === "error") {
    return (
      <button
        type="button"
        data-updater-action="retry"
        onClick={() => void updater.retry()}
        className="flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <RotateCw size={14} />
        Tentar novamente
      </button>
    );
  }
  return null;
}

function StatusIcon({ state }: { state: UpdateState }) {
  if (state.status === "error") return <AlertCircle size={16} className="shrink-0 text-destructive" />;
  if (state.status === "upToDate" || state.status === "done") return <CheckCircle2 size={16} className="shrink-0 text-emerald-700 dark:text-emerald-400" />;
  if (state.status === "available") return <Download size={16} className="shrink-0 text-primary-text" />;
  return <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" />;
}

/** Configurações > Atualizações: versão instalada, versão disponível, estado, progresso e o botão "Atualizar". */
export function UpdatePanel({ updater = appUpdater() }: { updater?: AppUpdater }) {
  const state = useUpdateState(updater);
  const available = availableVersion(state);
  const percent = progressPercent(state);
  const busy = state.status === "checking" || state.status === "downloading" || state.status === "installing" || state.status === "done";

  return (
    <div className="space-y-3" data-updater-status={state.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusIcon state={state} />
          <div className="min-w-0">
            <p className="text-sm font-medium" role="status">{statusText(state)}</p>
            <p className="text-xs text-muted-foreground">
              Instalada: {state.currentVersion ?? "—"}
              {available && <> · Disponível: {available}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <UpdateAction state={state} updater={updater} />
          {(state.status === "upToDate" || state.status === "available" || state.status === "idle") && (
            <button
              type="button"
              onClick={() => void updater.check()}
              disabled={busy}
              aria-label="Verificar atualizações agora"
              title="Verificar atualizações agora"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>
      {state.status === "downloading" && (
        <div
          role="progressbar"
          aria-label="Download da atualização"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className={cn("h-full rounded-full bg-primary transition-[width]", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
      )}
      {state.status === "error" && <p className="text-xs text-destructive">{state.message}</p>}
    </div>
  );
}

/**
 * Aviso no rodapé da janela, em qualquer tela (inclusive no login): aparece só quando há versão nova ou uma
 * atualização em andamento. A verificação em si é silenciosa.
 */
export function UpdateBanner({ updater = appUpdater() }: { updater?: AppUpdater }) {
  const state = useUpdateState(updater);
  // Em Configurações o mesmo painel já aparece no cartão "Atualizações".
  const onSettings = useLocation().pathname === "/settings";
  const visible = !onSettings && state.status === "available" || state.status === "downloading" || state.status === "installing" || state.status === "done" || (state.status === "error" && state.phase === "install");
  if (!visible) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-lg">
      <UpdatePanel updater={updater} />
    </div>
  );
}
