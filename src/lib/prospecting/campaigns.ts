// Campanhas de prospecção (migration 0012): cada lead pertence a uma campanha nomeada.
// A Tarefa 7 do redesign acrescenta aqui createCampaign, renameCampaign e campaignStats.
// Leads são dados reais: nada aqui apaga lead; o id da campanha padrão fica fora dos prefixos dev-/demo- que a
// limpeza do modo demonstração apaga. SQL nos padrões do banco demo.
import type { DatabaseLike } from "@/lib/db/demo";
import type { ProspectingCampaign } from "@/types";

export const DEFAULT_CAMPAIGN_NAME = "Prospecção 1";

/** Id da campanha padrão da empresa (o mesmo que o backfill da migration 0012 usa). */
export function defaultCampaignId(companyId: string): string {
  return `prospeccao-1-${companyId}`;
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
  let campaignId = (active.find((campaign) => campaign.id === defaultId) ?? active[0])?.id;
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
