// Estado do modo demonstração (chave `demo_mode` de `settings`), sem puxar os seeds: quem só precisa saber se o modo
// está ligado (ex.: notificações) importa daqui; demoMode.ts reexporta.
import type { DatabaseLike } from "@/lib/db/demo";
import { getCompanySetting } from "@/lib/settings/companySettings";

export const DEMO_MODE_KEY = "demo_mode";

function parseDemoMode(value: unknown): boolean {
  return value === true || value === "on";
}

/** O modo está ligado? Sem a chave gravada (empresa nova), desligado. */
export async function isDemoMode(db: DatabaseLike, companyId: string): Promise<boolean> {
  return parseDemoMode(await getCompanySetting(db, companyId, DEMO_MODE_KEY));
}
