// Custódia de peça (peças e ativos em posse de alguém): lista com nomes, gravação pela tabela editável (retirada com o
// id da tela, devolução marca a data), exclusão e itens da agenda de devoluções. SQL nos padrões do banco demo; junções
// em TypeScript. A permissão (`custody`) é conferida aqui também, não só nos botões.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { todayIso } from "@/lib/utils";
import type { Custody, CustodyStatus, InventoryItem, WorkOrder } from "@/types";
import { assertCan, assertCanSaveRows, type Actor } from "./permission";
import { instant, userNames } from "./queries";
import { StockError } from "./stock";

export const CUSTODY_STATUSES: { value: CustodyStatus; label: string }[] = [
  { value: "em_custodia", label: "Em custódia" },
  { value: "devolvido", label: "Devolvido" },
  { value: "consumido", label: "Consumido" },
  { value: "perdido", label: "Perdido" },
];

export interface CustodyView extends Custody {
  item_name: string | null;
  holder_name: string | null;
  work_order_number?: string | null;
}

/** Custódias ativas da empresa, da retirada mais recente para a mais antiga, com item, responsável e OS. */
export async function listCustodies(db: DatabaseLike, companyId: string): Promise<CustodyView[]> {
  const rows = await db.select<Custody[]>("SELECT * FROM custodies WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=?", [companyId]);
  const orders = await db.select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=?", [companyId]);
  const itemName = new Map(items.map((item) => [item.id, item.name]));
  const orderNumber = new Map(orders.map((order) => [order.id, order.number]));
  const names = await userNames(db, rows.map((row) => row.holder_id));
  return rows
    .filter((row) => !row.deleted_at)
    .map((row) => ({
      ...row,
      item_name: row.item_id ? itemName.get(row.item_id) ?? "Item removido" : null,
      holder_name: names.get(row.holder_id) ?? null,
      work_order_number: row.work_order_id ? orderNumber.get(row.work_order_id) ?? null : null,
    }))
    .sort((a, b) => instant(b.checked_out_at) - instant(a.checked_out_at) || b.id.localeCompare(a.id));
}

export interface CustodyRowInput {
  id: string;
  item_id: string | null;
  holder_id: string | null;
  quantity: number | null;
  status: string | null;
  due_back_at: string | null;
  work_order_id: string | null;
}

const FIELDS = ["item_id", "holder_id", "quantity", "status", "due_back_at", "work_order_id"] as const;
type Field = (typeof FIELDS)[number];

const cleanId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

/** "YYYY-MM-DD" de verdade (31/02 não passa); timestamp vale pelo dia. */
function validDay(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

interface Plan {
  kind: "create" | "update";
  id: string;
  fields: Field[];
  values: Record<Field, string | number | null>;
  returnedAt: string | null | undefined;
}

/**
 * Grava a tabela de custódias: `updated` = só os campos alterados (e o id), `created` = retiradas novas com o id da
 * tela (salvar de novo não duplica; responsável padrão = quem grava). Devolvido marca `returned_at`; voltar para em
 * custódia limpa. Exige `edit`/`create` em `custody`; tudo conferido antes de gravar.
 */
export async function saveCustodyRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  changes: { updated: readonly (Partial<CustodyRowInput> & { id: string })[]; created: readonly Partial<CustodyRowInput>[] },
): Promise<{ created: string[]; updated: string[] }> {
  assertCanSaveRows(actor, "custody", "custódias de peça", changes);
  const current = await db.select<Custody[]>("SELECT * FROM custodies WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const byId = new Map(current.filter((row) => !row.deleted_at).map((row) => [row.id, row]));
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const itemsById = new Map(items.filter((item) => !item.deleted_at).map((item) => [item.id, item]));
  const members = await db.select<{ user_id: string; deleted_at?: string | null }[]>("SELECT * FROM memberships WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const memberIds = new Set(members.filter((row) => !row.deleted_at).map((row) => row.user_id));
  const orders = await db.select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const orderIds = new Set(orders.filter((order) => !order.deleted_at).map((order) => order.id));

  const validate = (source: Partial<CustodyRowInput>, context: string, fields: readonly Field[]): Record<Field, string | number | null> => {
    const itemId = cleanId(source.item_id);
    if (!itemId) throw new StockError("item_invalido", `${context}: escolha o item.`);
    if (fields.includes("item_id") && !itemsById.has(itemId)) throw new StockError("item_invalido", `${context}: item não encontrado no estoque (excluído?).`);
    const holderId = cleanId(source.holder_id);
    if (!holderId) throw new StockError("responsavel_invalido", `${context}: escolha o responsável.`);
    if (fields.includes("holder_id") && !memberIds.has(holderId)) throw new StockError("responsavel_invalido", `${context}: o responsável não faz parte da empresa.`);
    const quantity = Number(source.quantity);
    if (source.quantity === null || source.quantity === undefined || !Number.isFinite(quantity) || quantity <= 0) {
      throw new StockError("quantidade_invalida", `${context}: a quantidade deve ser maior que zero.`);
    }
    const status = cleanId(source.status) ?? "em_custodia";
    if (!CUSTODY_STATUSES.some((option) => option.value === status)) throw new StockError("status_invalido", `${context}: Status inválido (${status}).`);
    const due = cleanId(source.due_back_at);
    if (due && !validDay(due)) throw new StockError("data_invalida", `${context}: data de devolução prevista inválida.`);
    const workOrderId = cleanId(source.work_order_id);
    if (workOrderId && fields.includes("work_order_id") && !orderIds.has(workOrderId)) {
      throw new StockError("os_invalida", `${context}: Ordem de serviço não encontrada (excluída ou de outra empresa).`);
    }
    return { item_id: itemId, holder_id: holderId, quantity: Math.round(quantity * 1000) / 1000, status, due_back_at: due, work_order_id: workOrderId };
  };

  const plans: Plan[] = [];
  const now = new Date().toISOString();
  for (const patch of changes.updated) {
    const row = byId.get(patch.id);
    if (!row) throw new StockError("custodia_invalida", "Custódia não encontrada (excluída ou de outra empresa). Atualize a lista.");
    const fields = FIELDS.filter((field) => field in patch);
    if (fields.length === 0) continue;
    const merged = { ...row, ...Object.fromEntries(fields.map((field) => [field, patch[field]])) } as Partial<CustodyRowInput>;
    const values = validate(merged, `"${itemsById.get(row.item_id ?? "")?.name ?? "Custódia"}"`, fields);
    let returnedAt: string | null | undefined;
    if (fields.includes("status") && values.status !== row.status) {
      if (values.status === "devolvido") returnedAt = now;
      else if (values.status === "em_custodia") returnedAt = null;
    }
    plans.push({ kind: "update", id: row.id, fields, values, returnedAt });
  }
  for (const [index, row] of changes.created.entries()) {
    const id = cleanId(row.id) ?? uuidv4();
    if ((await db.select<Custody[]>("SELECT * FROM custodies WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    const values = validate({ ...row, holder_id: cleanId(row.holder_id) ?? actor.userId }, `Linha nova ${index + 1}`, FIELDS);
    plans.push({ kind: "create", id, fields: [...FIELDS], values, returnedAt: values.status === "devolvido" ? now : null });
  }

  const result = { created: [] as string[], updated: [] as string[] };
  for (const plan of plans) {
    if (plan.kind === "update") {
      const sets = plan.fields.map((field) => `${field}=?`);
      const params: unknown[] = plan.fields.map((field) => plan.values[field]);
      if (plan.returnedAt !== undefined) {
        sets.push("returned_at=?");
        params.push(plan.returnedAt);
      }
      await db.execute(`UPDATE custodies SET ${sets.join(", ")}, updated_at=datetime('now') WHERE company_id=? AND id=?`, [...params, companyId, plan.id]);
      result.updated.push(plan.id);
    } else {
      const { values } = plan;
      await db.execute(
        "INSERT INTO custodies (id, company_id, item_id, holder_id, quantity, status, due_back_at, work_order_id, checked_out_at, returned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [plan.id, companyId, values.item_id, values.holder_id, values.quantity, values.status, values.due_back_at, values.work_order_id, now, plan.returnedAt ?? null],
      );
      result.created.push(plan.id);
    }
  }
  return result;
}

/** Remove (soft delete) o registro de custódia; exige `delete` em `custody`. */
export async function deleteCustody(db: DatabaseLike, companyId: string, actor: Actor, custodyId: string): Promise<void> {
  assertCan(actor, "delete", "custody", "custódias de peça");
  await db.execute("UPDATE custodies SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [companyId, custodyId]);
}

/** Dia ("YYYY-MM-DD") de uma data ou de um timestamp (no fuso local). */
export function dayOf(value: string): string {
  if (value.length > 10 && /\d{2}:\d{2}/.test(value)) {
    const moment = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
    if (!Number.isNaN(moment.getTime())) return todayIso(moment);
  }
  return value.slice(0, 10);
}

/**
 * Cor do item atrasado na agenda: estado de erro, pelo token do tema (tema monocromático, cor só onde é estado). O que
 * está no prazo fica sem cor (a neutra do calendário).
 */
export const CALENDAR_LATE = "hsl(var(--destructive))";

/** Agenda de devoluções: o que está em custódia com devolução prevista (dia inteiro); atrasado em vermelho. */
export function custodyCalendarItems(rows: readonly CustodyView[], now = new Date()): { id: string; title: string; start: string; allDay: true; color?: string; sourceLabel: string }[] {
  const today = todayIso(now);
  return rows
    .filter((row) => row.status === "em_custodia" && row.due_back_at)
    .map((row) => {
      const start = dayOf(String(row.due_back_at));
      return {
        id: row.id,
        title: `${row.item_name ?? "Peça"} · ${row.holder_name ?? "sem responsável"}`,
        start,
        allDay: true as const,
        color: start < today ? CALENDAR_LATE : undefined,
        sourceLabel: start < today ? "Devolução atrasada" : "Devolução prevista",
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
