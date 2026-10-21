// localStorage-backed table store used when the app runs outside Tauri
// (browser preview, automated agents, UI tests). Same row shape as SQLite.

import { DEMO_COMPANY_ID, DEMO_USER_ID, demoSeed } from "./demoSeed";

export type Row = Record<string, unknown>;

const STORE_KEY = "cm_store_v1";

type Tables = Record<string, Row[]>;

let cache: Tables | null = null;

function load(): Tables {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    cache = raw ? (JSON.parse(raw) as Tables) : demoSeed();
  } catch {
    cache = demoSeed();
  }
  persist();
  return cache;
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: keep working in memory.
  }
}

export function browserSelect(table: string, companyId: string): Row[] {
  const rows = load()[table] ?? [];
  if (table === "users") return rows.filter((r) => !r.deleted_at);
  return rows.filter((r) => r.company_id === companyId && !r.deleted_at);
}

export function browserInsert(table: string, rows: Row[]): void {
  const tables = load();
  tables[table] = [...(tables[table] ?? []), ...rows];
  persist();
}

export function browserUpdate(table: string, id: string, patch: Row): void {
  const tables = load();
  tables[table] = (tables[table] ?? []).map((r) =>
    r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r
  );
  persist();
}

/** Wipe local data and restore the demo seed. */
export function browserReset(): void {
  cache = demoSeed();
  persist();
}

export { DEMO_COMPANY_ID, DEMO_USER_ID };
