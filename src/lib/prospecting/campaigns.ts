// Campanhas de prospecção (migration 0012): cada lead pertence a uma campanha nomeada ("Prospecção 1", "Advogados"...).
// Leads são dados reais: nada aqui apaga lead nem campanha; ids de campanha ficam fora dos prefixos dev-/demo- que a
// limpeza do modo demonstração apaga. SQL nos padrões do banco demo (soma e contagem em TypeScript); o demo não
// aplica UNIQUE, então o nome repetido é conferido aqui antes de gravar.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { sumMoney } from "@/lib/money";
import { can } from "@/lib/permissions/rbac";
import type { Lead, ProspectingCampaign, Role } from "@/types";

export const DEFAULT_CAMPAIGN_NAME = "Prospecção 1";

/** Id da campanha padrão da empresa (o mesmo que o backfill da migration 0012 usa). */
export function defaultCampaignId(companyId: string): string {
  return `prospeccao-1-${companyId}`;
}

/** Campanha padrão entre as ativas (da mais antiga para a mais nova): a "Prospecção 1" da empresa, senão a mais antiga. */
export function pickDefaultCampaign<T extends Pick<ProspectingCampaign, "id">>(active: readonly T[], companyId: string): T | undefined {
  return active.find((campaign) => campaign.id === defaultCampaignId(companyId)) ?? active[0];
}

/**
 * Campanha padrão da empresa: a "Prospecção 1" (ou, se ela não estiver ativa, a campanha ativa mais antiga). Sem
 * nenhuma campanha ativa, cria (ou restaura) a "Prospecção 1". Leads da empresa sem campanha vão para ela.
 * Idempotente; roda depois do seed de prospecção e ao abrir a Prospecção.
 */
export async function ensureDefaultCampaign(db: DatabaseLike, companyId: string): Promise<string> {
  const defaultId = defaultCampaignId(companyId);
  const active = await db.select<ProspectingCampaign[]>(
    "SELECT * FROM prospecting_campaigns WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC",
    [companyId],
  );
  let campaignId = pickDefaultCampaign(active, companyId)?.id;
  if (!campaignId) {
    const now = new Date().toISOString();
    const existing = await db.select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE id=?", [defaultId]);
    if (existing.length > 0) {
      await db.execute("UPDATE prospecting_campaigns SET deleted_at=NULL, updated_at=? WHERE id=?", [now, defaultId]);
    } else {
      await db.execute("INSERT OR IGNORE INTO prospecting_campaigns (id, company_id, name, created_at, updated_at) VALUES (?,?,?,?,?)", [
        defaultId,
        companyId,
        DEFAULT_CAMPAIGN_NAME,
        now,
        now,
      ]);
    }
    campaignId = defaultId;
  }
  await db.execute("UPDATE leads SET campaign_id=? WHERE company_id=? AND campaign_id IS NULL", [campaignId, companyId]);
  return campaignId;
}

export const CAMPAIGN_NAME_MAX = 80;

/** Quem grava (opcional): com `role`, a permissão em `leads` é conferida aqui também, não só na tela. */
export interface CampaignActor {
  role?: Role;
}

export interface CampaignStats {
  leads: number;
  /** Leads que já saíram de "novo" (abordados, interessados, fechados, convertidos...). */
  contacted: number;
  /** Leads fechados (ganhos). */
  won: number;
  /** Soma do potencial estimado do 1º ano (R$). */
  potential: number;
}

type NamedCampaign = Pick<ProspectingCampaign, "id" | "name">;

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

function requireLeadsPermission(actor: CampaignActor | undefined, action: "create" | "edit"): void {
  if (actor?.role && !can(actor.role, action, "leads")) {
    throw new Error(action === "create" ? "Sem permissão para criar prospecções." : "Sem permissão para renomear prospecções.");
  }
}

/** Problema do nome (vazio, comprido, repetido entre as campanhas ativas) ou null. `exceptId` = a própria campanha. */
export function campaignNameProblem(name: string, campaigns: readonly NamedCampaign[], exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Dê um nome à prospecção.";
  if (trimmed.length > CAMPAIGN_NAME_MAX) return `O nome pode ter até ${CAMPAIGN_NAME_MAX} caracteres.`;
  if (campaigns.some((campaign) => campaign.id !== exceptId && sameName(campaign.name, trimmed))) return `Já existe uma prospecção chamada "${trimmed}".`;
  return null;
}

/** Nome sugerido para a próxima campanha: "Prospecção N", depois da maior numeração e da quantidade de campanhas. */
export function nextCampaignName(campaigns: readonly NamedCampaign[]): string {
  const numbers = campaigns.map((campaign) => Number(/^prospec[cç][aã]o\s+(\d+)$/i.exec(campaign.name.trim())?.[1] ?? 0));
  let next = Math.max(campaigns.length, ...numbers) + 1;
  while (campaigns.some((campaign) => sameName(campaign.name, `Prospecção ${next}`))) next += 1;
  return `Prospecção ${next}`;
}

/** Campanhas ativas da empresa, da mais antiga para a mais nova. */
export async function listCampaigns(db: DatabaseLike, companyId: string): Promise<ProspectingCampaign[]> {
  return db.select<ProspectingCampaign[]>(
    "SELECT * FROM prospecting_campaigns WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC",
    [companyId],
  );
}

/** Cria uma campanha vazia e devolve o id (uuid: nunca começa com dev-/demo-). */
export async function createCampaign(db: DatabaseLike, companyId: string, name: string, actor?: CampaignActor): Promise<string> {
  requireLeadsPermission(actor, "create");
  const problem = campaignNameProblem(name, await listCampaigns(db, companyId));
  if (problem) throw new Error(problem);
  const id = uuidv4();
  // created_at em ISO com milissegundos: duas campanhas criadas no mesmo segundo continuam em ordem na lista.
  const now = new Date().toISOString();
  await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at, updated_at) VALUES (?,?,?,?,?)", [
    id,
    companyId,
    name.trim(),
    now,
    now,
  ]);
  return id;
}

/** Renomeia a campanha; os leads continuam nela (só o nome muda). `companyId` restringe à empresa da sessão. */
export async function renameCampaign(db: DatabaseLike, id: string, name: string, scope: CampaignActor & { companyId?: string } = {}): Promise<void> {
  requireLeadsPermission(scope, "edit");
  const [campaign] = await db.select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE id=? AND deleted_at IS NULL", [id]);
  if (!campaign || (scope.companyId && campaign.company_id !== scope.companyId)) throw new Error("Prospecção não encontrada.");
  const problem = campaignNameProblem(name, await listCampaigns(db, campaign.company_id), id);
  if (problem) throw new Error(problem);
  await db.execute("UPDATE prospecting_campaigns SET name=?, updated_at=? WHERE id=? AND company_id=?", [
    name.trim(),
    new Date().toISOString(),
    id,
    campaign.company_id,
  ]);
}

/** Números da campanha a partir dos leads (não excluídos) dela. */
export function summarizeCampaignLeads(leads: readonly Pick<Lead, "status" | "estimated_revenue">[]): CampaignStats {
  return {
    leads: leads.length,
    contacted: leads.filter((lead) => lead.status !== "novo").length,
    won: leads.filter((lead) => lead.status === "fechado").length,
    potential: sumMoney(leads.map((lead) => Number(lead.estimated_revenue) || 0)),
  };
}

/** Números da campanha: só leads da mesma empresa da campanha (a FK de `campaign_id` não confere a empresa). */
export async function campaignStats(db: DatabaseLike, campaignId: string): Promise<CampaignStats> {
  const [campaign] = await db.select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE id=?", [campaignId]);
  if (!campaign) return summarizeCampaignLeads([]);
  const rows = await db.select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND campaign_id=? AND deleted_at IS NULL", [campaign.company_id, campaignId]);
  return summarizeCampaignLeads(rows);
}

/**
 * Leads da empresa sem campanha (ex.: acabaram de ser importados pela tela da Prospecção) vão para a campanha
 * escolhida. Devolve quantos mudaram.
 */
export async function assignLeadsWithoutCampaign(db: DatabaseLike, companyId: string, campaignId: string): Promise<number> {
  const campaigns = await listCampaigns(db, companyId);
  if (!campaigns.some((campaign) => campaign.id === campaignId)) throw new Error("Prospecção não encontrada.");
  const orphans = await db.select<Lead[]>("SELECT id FROM leads WHERE company_id=? AND campaign_id IS NULL AND deleted_at IS NULL", [companyId]);
  if (orphans.length === 0) return 0;
  await db.execute("UPDATE leads SET campaign_id=?, updated_at=? WHERE company_id=? AND campaign_id IS NULL AND deleted_at IS NULL", [
    campaignId,
    new Date().toISOString(),
    companyId,
  ]);
  return orphans.length;
}
