import Database from "@tauri-apps/plugin-sql";
import { getDemoDb, type DatabaseLike } from "./demo";

// Guarda a promessa, não o banco: as chamadas que chegam juntas ao abrir o app (senhas antigas, limpeza do modo
// demonstração, revalidação da sessão) esperam o mesmo load. Com dois loads ao mesmo tempo, o segundo podia usar o
// banco antes de o primeiro terminar as migrations (o plugin só roda as migrations no primeiro load).
let _db: Promise<DatabaseLike> | null = null;

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function getDb(): Promise<DatabaseLike> {
  if (!_db) {
    const loading = (async (): Promise<DatabaseLike> => (isTauriRuntime() ? Database.load("sqlite:company-manager.db") : getDemoDb()))();
    // Não abriu: a próxima chamada tenta de novo.
    loading.catch(() => {
      if (_db === loading) _db = null;
    });
    _db = loading;
  }
  return _db;
}
