import Database from "@tauri-apps/plugin-sql";
import { getDemoDb, type DatabaseLike } from "./demo";

let _db: DatabaseLike | null = null;

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function getDb(): Promise<DatabaseLike> {
  if (!_db) {
    _db = isTauriRuntime()
      ? await Database.load("sqlite:company-manager.db")
      : getDemoDb();
  }
  return _db;
}
