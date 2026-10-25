// Confirmação de ação irreversível (excluir, arquivar, concluir/cancelar contagem...). No app desktop usa o diálogo
// nativo `ask` do plugin-dialog: o window.confirm do WebView do Tauri não espera a resposta e a ação acontecia sem
// perguntar. No navegador (modo demo), window.confirm. Dentro do CRM há também o ConfirmDialog (Modal.tsx) e, no
// Financeiro, o botão de dois passos (financeShared.tsx).
import { ask } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "@/lib/db/client";

export interface ConfirmOptions {
  /** Título da janela (desktop). Padrão: "Confirmar". */
  title?: string;
  /** Texto do botão que confirma (desktop), ex.: "Remover". */
  okLabel?: string;
  /** Texto do botão que desiste (desktop). Padrão: "Cancelar". */
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

/** Pergunta e devolve true só se a pessoa confirmou. */
export async function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (isTauriRuntime()) {
    return ask(message, {
      title: options.title ?? "Confirmar",
      kind: options.kind ?? "warning",
      ...(options.okLabel ? { okLabel: options.okLabel } : {}),
      cancelLabel: options.cancelLabel ?? "Cancelar",
    });
  }
  return window.confirm(message);
}
