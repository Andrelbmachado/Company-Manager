// Configurações da empresa na tabela `settings` (uma linha por company_id + key, valor em JSON em value_json).
// Usado pelo perfil de área (`company.area_profile`, `company.labels`) e pelo modo demonstração (`demo_mode`).
// SQL nos padrões do banco demo, que não aplica o UNIQUE (company_id, key): por isso procura antes de inserir.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";

interface SettingRow {
  id: string;
  value_json?: string | null;
}

async function findSetting(db: DatabaseLike, companyId: string, key: string): Promise<SettingRow | undefined> {
  const rows = await db.select<SettingRow[]>("SELECT * FROM settings WHERE company_id=? AND key=?", [companyId, key]);
  return rows[0];
}

/** Valor gravado (JSON já lido), ou undefined se a chave não existe ou o JSON está quebrado. */
export async function getCompanySetting(db: DatabaseLike, companyId: string, key: string): Promise<unknown> {
  const row = await findSetting(db, companyId, key);
  if (!row || row.value_json == null) return undefined;
  try {
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return undefined;
  }
}

/** Grava (cria ou atualiza a mesma linha) o valor da chave como JSON. */
export async function setCompanySetting(db: DatabaseLike, companyId: string, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value ?? null);
  const now = new Date().toISOString();
  if (!(await findSetting(db, companyId, key))) {
    // OR IGNORE: se outra gravação criou a linha entre a busca e aqui (SQLite), o UPDATE abaixo vale.
    await db.execute("INSERT OR IGNORE INTO settings (id, company_id, key, value_json, updated_at) VALUES (?,?,?,?,?)", [uuidv4(), companyId, key, json, now]);
  }
  await db.execute("UPDATE settings SET value_json=?, updated_at=? WHERE company_id=? AND key=?", [json, now, companyId, key]);
}
