// Gravação da tabela editável de leads (Prospecção). Mudar o status registra o último contato (Novo zera) e recalcula o
// benefício da indicação (só "concedido" quando o indicado fecha); lead novo entra na campanha da linha ou na padrão.
// Leads são dados reais: aqui só se cria e edita, nunca se apaga. SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { clean, nowIso, parseMoneyInput } from "@/lib/crm/queries";
import { ensureDefaultCampaign } from "@/lib/prospecting/campaigns";
import { LEAD_STATUSES, PRESENCE_LABELS } from "@/lib/prospecting/contact";
import { referralStatusFor } from "@/lib/prospecting/referral";
import type { Lead } from "@/types";
import { assertChanges, type EditActor, type RowChanges, type SaveResult } from "./guard";

const TEXT_FIELDS = ["name", "email", "phone", "whatsapp", "source", "category", "business_type", "pricing_segment", "online_presence", "address", "notes", "source_url", "outreach_date", "referred_by", "owner_id", "customer_id", "package_id", "campaign_id", "presence_kind", "status"] as const;
const MONEY_FIELDS = ["estimated_setup", "estimated_monthly", "estimated_revenue"] as const;
const NUMBER_FIELDS = ["priority_rank", "outreach_day", "google_rating", "google_reviews", "score", "sem_site"] as const;

type Field = (typeof TEXT_FIELDS)[number] | (typeof MONEY_FIELDS)[number] | (typeof NUMBER_FIELDS)[number];
type Values = Partial<Record<Field | "last_contact_at" | "referral_status", string | number | null>>;

const STATUS_VALUES = LEAD_STATUSES.map((status) => status.value as string);

/** Normaliza só os campos presentes na linha; lança erro em português no primeiro inválido. */
function leadValues(row: Partial<Lead>, prefix: string): Values {
  const values: Values = {};
  const source = row as Record<string, unknown>;
  for (const field of TEXT_FIELDS) if (field in source) values[field] = clean(source[field]);
  for (const field of MONEY_FIELDS) {
    if (!(field in source)) continue;
    const value = parseMoneyInput(source[field]) ?? 0;
    if (value < 0) throw new Error(`${prefix}o valor estimado não pode ser negativo.`);
    values[field] = value;
  }
  for (const field of NUMBER_FIELDS) {
    if (!(field in source)) continue;
    const raw = source[field];
    const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error(`${prefix}número inválido em ${field}.`);
    values[field] = field === "sem_site" || field === "score" ? (value ?? 0) : value;
  }
  if ("name" in values && !values.name) throw new Error(`${prefix}informe o nome do lead.`);
  if ("status" in values && !STATUS_VALUES.includes(String(values.status))) throw new Error(`${prefix}status inválido.`);
  if (values.presence_kind && !(String(values.presence_kind) in PRESENCE_LABELS)) throw new Error(`${prefix}presença online inválida.`);
  if (values.outreach_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(values.outreach_date))) throw new Error(`${prefix}data de abordagem inválida.`);
  if (values.email) values.email = String(values.email).toLowerCase();
  return values;
}

/**
 * Leads: existentes mudam só os campos alterados (status → último contato e indicação); novos nascem com status
 * Novo, quem cadastrou de responsável e a campanha da linha (ou a padrão da empresa).
 */
export async function saveLeadRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Lead>): Promise<SaveResult> {
  assertChanges(actor, changes, "leads");
  const updates: { id: string; values: Values }[] = [];
  for (const patch of changes.updated) {
    const [current] = (await db.select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND id=?", [companyId, patch.id])).filter((row) => row.id === patch.id && !row.deleted_at);
    if (!current) throw new Error("Lead não encontrado (ou excluído). Atualize a lista.");
    const values = leadValues(patch, `${current.name}: `);
    const status = "status" in values ? String(values.status) : current.status;
    if ("status" in values && status !== current.status) values.last_contact_at = status === "novo" ? null : nowIso();
    if ("status" in values || "referred_by" in values) {
      const referredBy = "referred_by" in values ? (values.referred_by as string | null) : (current.referred_by ?? null);
      values.referral_status = referralStatusFor(status, referredBy);
    }
    updates.push({ id: patch.id, values });
  }
  const creations = changes.created.map((row, index) => {
    const values = leadValues({ status: "novo", ...row, name: row.name ?? "" }, changes.created.length > 1 ? `Linha nova ${index + 1}: ` : "");
    values.owner_id = values.owner_id ?? actor.userId;
    values.referral_status = referralStatusFor(String(values.status ?? "novo"), (values.referred_by as string | null) ?? null);
    values.last_contact_at = values.status && values.status !== "novo" ? nowIso() : null;
    return values;
  });

  for (const { id, values } of updates) {
    const fields = Object.keys(values);
    if (fields.length === 0) continue;
    await db.execute(`UPDATE leads SET ${fields.map((field) => `${field}=?`).join(", ")}, updated_at=? WHERE company_id=? AND id=?`, [...Object.values(values), nowIso(), companyId, id]);
  }
  const created: string[] = [];
  const fallbackCampaign = creations.some((values) => !values.campaign_id) ? await ensureDefaultCampaign(db, companyId) : null;
  for (const values of creations) {
    const id = uuidv4();
    const row: Record<string, string | number | null> = { estimated_setup: 0, estimated_monthly: 0, estimated_revenue: 0, sem_site: 0, score: 0, ...values, campaign_id: values.campaign_id ?? fallbackCampaign };
    const columns = Object.keys(row);
    const now = nowIso();
    await db.execute(`INSERT INTO leads (id, company_id, ${columns.join(", ")}, created_at, updated_at) VALUES (${["?", "?", ...columns.map(() => "?"), "?", "?"].join(", ")})`, [id, companyId, ...Object.values(row), now, now]);
    created.push(id);
  }
  return { created, updated: updates.map((item) => item.id) };
}
