// Modo demonstração (switch em Configurações, só CEO e Administração; Tarefa 10 do redesign).
// Ligar: cria as contas de exemplo (sem senha) e roda todos os seeds de src/lib/dev (ids dev-*/demo-*, nunca leads).
// Desligar: apaga essas linhas (purge.ts), menos leads e contas. Estado em `settings` (chave "demo_mode", JSON true/false).
// Só no app desktop: a limpeza lê o schema do SQLite; no navegador o banco demo é todo de demonstração.
import type { DatabaseLike } from "@/lib/db/demo";
import { emit } from "@/lib/events/bus";
import { can } from "@/lib/permissions/rbac";
import { getCompanySetting, setCompanySetting } from "@/lib/settings/companySettings";
import { seedDevData } from "@/lib/dev/devSeed";
import { DISABLED_PASSWORD_HASH, ensureDevAccounts } from "@/lib/dev/devAccounts";
import { countDemoRows, purgeDemoData } from "./purge";
import type { Role } from "@/types";

export { DEMO_EXCLUDED_TABLES } from "./purge";

export const DEMO_MODE_KEY = "demo_mode";

export interface DemoModeResult {
  /** Ligar: linhas de exemplo novas (0 se já estava tudo lá). */
  inserted?: number;
  /** Ligar: áreas cujo seed falhou (as outras rodam assim mesmo). */
  failed?: { name: string; error: string }[];
  /** Desligar: linhas de exemplo apagadas. */
  removed?: number;
  /** Desligar: linhas de exemplo que ficaram porque dados da pessoa apontam para elas. */
  kept?: number;
  keptByTable?: Record<string, number>;
}

function parseDemoMode(value: unknown): boolean {
  return value === true || value === "on";
}

/** O modo está ligado? Sem a chave gravada (empresa nova), desligado. */
export async function isDemoMode(db: DatabaseLike, companyId: string): Promise<boolean> {
  return parseDemoMode(await getCompanySetting(db, companyId, DEMO_MODE_KEY));
}

/**
 * Liga ou desliga o modo. Atenção: os seeds gravam pelo `getDb()` (src/lib/dev), então `db` tem de ser o mesmo banco
 * (no app, sempre é). Ligar duas vezes não duplica nada (ids fixos + INSERT OR IGNORE); desligar com o modo já
 * desligado só tenta de novo apagar o que sobrou.
 */
export async function setDemoMode(db: DatabaseLike, companyId: string, on: boolean): Promise<DemoModeResult> {
  if (on) {
    const before = await countDemoRows(db, companyId);
    await ensureDevAccounts(db, companyId, DISABLED_PASSWORD_HASH);
    const areas = await seedDevData(companyId);
    const after = await countDemoRows(db, companyId);
    await setCompanySetting(db, companyId, DEMO_MODE_KEY, true);
    const failed = areas.filter((area) => !area.ok).map((area) => ({ name: area.name, error: area.error ?? "erro desconhecido" }));
    return { inserted: Math.max(0, after.total - before.total), failed };
  }
  const purge = await purgeDemoData(db, companyId);
  await setCompanySetting(db, companyId, DEMO_MODE_KEY, false);
  return { removed: purge.removed, kept: purge.kept, keptByTable: purge.keptByTable };
}

/** Pela tela: confere a permissão também aqui (não só no switch) e registra quem ligou ou desligou. */
export async function changeDemoMode(db: DatabaseLike, companyId: string, actor: { role: Role; userId: string }, on: boolean): Promise<DemoModeResult> {
  if (!can(actor.role, "edit", "demo_mode")) throw new Error("Só o CEO e a Administração ligam ou desligam o modo demonstração.");
  const result = await setDemoMode(db, companyId, on);
  await emit({
    type: on ? "settings.demo_mode.on" : "settings.demo_mode.off",
    companyId,
    actorId: actor.userId,
    entityType: "settings",
    entityId: DEMO_MODE_KEY,
    title: on ? "Modo demonstração ligado" : "Modo demonstração desligado",
    module: "settings",
    metadata: on ? { inserted: result.inserted ?? 0 } : { removed: result.removed ?? 0, kept: result.kept ?? 0 },
  });
  return result;
}

export interface DemoModeInitResult {
  companyId: string;
  removed: number;
  kept: number;
}

/**
 * Primeira abertura depois da atualização que trouxe o modo demonstração (App.tsx, só desktop): empresa sem a chave
 * `demo_mode` (o login rápido antigo gravava dados de exemplo direto no banco) fica com o modo desligado, sem os dados
 * fictícios e com os leads. Empresa que já tem a chave não é tocada; rodar de novo não faz nada.
 */
export async function initDemoMode(db: DatabaseLike): Promise<DemoModeInitResult[]> {
  const companies = await db.select<{ id: string }[]>("SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at ASC");
  const results: DemoModeInitResult[] = [];
  for (const { id } of companies) {
    if ((await getCompanySetting(db, id, DEMO_MODE_KEY)) !== undefined) continue;
    const purge = await purgeDemoData(db, id);
    await setCompanySetting(db, id, DEMO_MODE_KEY, false);
    results.push({ companyId: id, removed: purge.removed, kept: purge.kept });
  }
  return results;
}
