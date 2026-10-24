// Restauração de um `.cmbackup` (só no app desktop). O comando `restore_db` (src-tauri/src/backup.rs) confere o arquivo
// inteiro antes de mudar algo (zip, banco íntegro, versão do schema não mais nova que a do app, migrations da mesma
// cópia do app), guarda um backup "antes de restaurar" e grava o banco do backup numa transação só. Depois o app
// precisa reiniciar para reabrir o banco e aplicar as migrations que faltarem a um backup antigo.
import { invoke } from "@tauri-apps/api/core";
import type { RestoreInfo } from "@/types";
import { backupAvailable, DESKTOP_ONLY_MESSAGE } from "./backup";

export async function restartApp(): Promise<void> {
  await invoke("restart_app");
}

/**
 * Restaura o backup de `path` e, por padrão, reinicia o app em seguida. Rejeita com o texto do erro do app
 * (arquivo corrompido, versão mais nova, outra cópia do app); nesse caso o banco atual não foi alterado.
 */
export async function restoreFromFile(path: string, options: { restart?: boolean } = {}): Promise<RestoreInfo> {
  if (!backupAvailable()) throw new Error(DESKTOP_ONLY_MESSAGE);
  const info = await invoke<RestoreInfo>("restore_db", { srcPath: path });
  if (options.restart ?? true) await restartApp();
  return info;
}
