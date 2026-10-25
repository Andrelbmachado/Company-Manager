// Ordens de serviço: lista com cliente, técnico e custo total; gravação pela tabela editável (número automático = próximo
// OS-NNNN livre, conclusão/cancelamento marca o encerramento) e itens da agenda de prazos. SQL nos padrões do banco
// demo; junções em TypeScript. A permissão (`work_orders`) é conferida aqui também, não só nos botões.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { CALENDAR_LATE, dayOf } from "@/lib/inventory/custody";
import { assertCanSaveRows, type Actor } from "@/lib/inventory/permission";
import { instant, userNames } from "@/lib/inventory/queries";
import { roundMoney } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import type { Priority, WorkOrder, WorkOrderStatus } from "@/types";

export class WorkOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkOrderError";
  }
}

export const WORK_ORDER_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "aberta", label: "Aberta" },
  { value: "atribuida", label: "Atribuída" },
  { value: "aguardando_peca", label: "Aguardando peça" },
  { value: "em_execucao", label: "Em execução" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

export const WORK_ORDER_PRIORITIES: { value: Priority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

const CLOSED: readonly string[] = ["concluida", "cancelada"];
export const isClosedWorkOrder = (status: string | null | undefined) => CLOSED.includes(String(status));

export interface WorkOrderView extends WorkOrder {
  customer_name: string | null;
  technician_name: string | null;
  total_cost: number;
}

/** OS ativas da empresa, da mais nova para a mais antiga, com cliente, técnico e custo total. */
export async function listWorkOrders(db: DatabaseLike, companyId: string): Promise<WorkOrderView[]> {
  const rows = await db.select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const customers = await db.select<{ id: string; name: string }[]>("SELECT * FROM customers WHERE company_id=?", [companyId]);
  const customerName = new Map(customers.map((row) => [row.id, row.name]));
  const names = await userNames(db, rows.map((row) => row.technician_id));
  return rows
    .filter((row) => !row.deleted_at)
    .map((row) => ({
      ...row,
      customer_name: row.customer_id ? customerName.get(row.customer_id) ?? null : null,
      technician_name: row.technician_id ? names.get(row.technician_id) ?? null : null,
      total_cost: roundMoney(Number(row.labor_cost ?? 0) + Number(row.materials_cost ?? 0)),
    }))
    .sort((a, b) => instant(b.opened_at) - instant(a.opened_at) || b.number.localeCompare(a.number, "pt-BR", { numeric: true }));
}

/** Próximo "OS-NNNN" depois do maior número no padrão (os fora do padrão não contam). */
export function nextWorkOrderNumber(numbers: Iterable<string | null | undefined>): string {
  let max = 0;
  for (const number of numbers) {
    const match = String(number ?? "").trim().match(/^OS-(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `OS-${String(max + 1).padStart(4, "0")}`;
}

export interface WorkOrderRowInput {
  id: string;
  number: string | null;
  customer_id: string | null;
  technician_id: string | null;
  status: string | null;
  priority: string | null;
  sla_due_at: string | null;
  labor_cost: number | null;
  materials_cost: number | null;
}

const FIELDS = ["number", "customer_id", "technician_id", "status", "priority", "sla_due_at", "labor_cost", "materials_cost"] as const;
type Field = (typeof FIELDS)[number];

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
};
const numberKey = (value: string) => value.trim().toLowerCase();

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
  closedAt: string | null | undefined;
}

/**
 * Grava a tabela de OS: `updated` = só os campos alterados (e o id), `created` = OS novas com o id da tela (salvar de
 * novo não duplica). Número vazio na OS nova = próximo OS-NNNN livre (contando as excluídas, por causa do UNIQUE).
 * Concluída/cancelada marca `closed_at`; reabrir limpa. Exige `edit`/`create` em `work_orders`; tudo conferido antes.
 */
export async function saveWorkOrderRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  changes: { updated: readonly (Partial<WorkOrderRowInput> & { id: string })[]; created: readonly Partial<WorkOrderRowInput>[] },
): Promise<{ created: string[]; updated: string[] }> {
  assertCanSaveRows(actor, "work_orders", "ordens de serviço", changes);
  const everything = await db.select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=?", [companyId]);
  const active = new Map(everything.filter((row) => !row.deleted_at).map((row) => [row.id, row]));
  const customers = await db.select<{ id: string; deleted_at?: string | null }[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const customerIds = new Set(customers.filter((row) => !row.deleted_at).map((row) => row.id));
  const members = await db.select<{ user_id: string; deleted_at?: string | null }[]>("SELECT * FROM memberships WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const memberIds = new Set(members.filter((row) => !row.deleted_at).map((row) => row.user_id));

  const validate = (source: Partial<WorkOrderRowInput>, context: string, fields: readonly Field[]): Record<Field, string | number | null> => {
    const status = clean(source.status) ?? "aberta";
    if (!WORK_ORDER_STATUSES.some((option) => option.value === status)) throw new WorkOrderError(`${context}: Status inválido (${status}).`);
    const priority = clean(source.priority) ?? "media";
    if (!WORK_ORDER_PRIORITIES.some((option) => option.value === priority)) throw new WorkOrderError(`${context}: Prioridade inválida (${priority}).`);
    const customerId = clean(source.customer_id);
    if (customerId && fields.includes("customer_id") && !customerIds.has(customerId)) throw new WorkOrderError(`${context}: Cliente não encontrado (excluído ou de outra empresa).`);
    const technicianId = clean(source.technician_id);
    if (technicianId && fields.includes("technician_id") && !memberIds.has(technicianId)) throw new WorkOrderError(`${context}: o técnico não faz parte da empresa.`);
    const due = clean(source.sla_due_at);
    if (due && !validDay(due)) throw new WorkOrderError(`${context}: Prazo inválido.`);
    const cost = (value: unknown, label: string) => {
      const amount = value === null || value === undefined || value === "" ? 0 : Number(value);
      if (!Number.isFinite(amount)) throw new WorkOrderError(`${context}: ${label} inválido.`);
      if (amount < 0) throw new WorkOrderError(`${context}: ${label} não pode ser negativo.`);
      return roundMoney(amount);
    };
    return {
      number: clean(source.number),
      customer_id: customerId,
      technician_id: technicianId,
      status,
      priority,
      sla_due_at: due,
      labor_cost: cost(source.labor_cost, "o custo de mão de obra"),
      materials_cost: cost(source.materials_cost, "o custo de materiais"),
    };
  };

  const plans: Plan[] = [];
  const now = new Date().toISOString();
  for (const patch of changes.updated) {
    const row = active.get(patch.id);
    if (!row) throw new WorkOrderError("Ordem de serviço não encontrada (excluída ou de outra empresa). Atualize a lista.");
    const fields = FIELDS.filter((field) => field in patch);
    if (fields.length === 0) continue;
    const merged = { ...row, ...Object.fromEntries(fields.map((field) => [field, patch[field]])) } as Partial<WorkOrderRowInput>;
    const values = validate(merged, row.number, fields);
    if (!values.number) throw new WorkOrderError(`${row.number}: Informe o número da OS.`);
    let closedAt: string | null | undefined;
    if (fields.includes("status") && values.status !== row.status) {
      if (isClosedWorkOrder(String(values.status)) && !isClosedWorkOrder(row.status)) closedAt = now;
      else if (!isClosedWorkOrder(String(values.status))) closedAt = null;
    }
    plans.push({ kind: "update", id: row.id, fields, values, closedAt });
  }
  const taken = new Set(everything.map((row) => row.number));
  for (const [index, row] of changes.created.entries()) {
    const id = clean(row.id) ?? uuidv4();
    if (everything.some((existing) => existing.id === id)) continue;
    const values = validate(row, `Linha nova ${index + 1}`, FIELDS);
    plans.push({ kind: "create", id, fields: [...FIELDS], values, closedAt: isClosedWorkOrder(String(values.status)) ? now : null });
  }
  // Números automáticos depois de conhecer os digitados (um digitado não é reaproveitado pela numeração).
  for (const plan of plans) if (plan.values.number) taken.add(String(plan.values.number));
  for (const plan of plans) {
    if (plan.kind === "create" && !plan.values.number) {
      plan.values.number = nextWorkOrderNumber(taken);
      taken.add(plan.values.number);
    }
  }

  const finalNumbers = new Map(everything.map((row) => [row.id, numberKey(row.number)]));
  for (const plan of plans) finalNumbers.set(plan.id, numberKey(String(plan.values.number)));
  for (const plan of plans) {
    if (!plan.fields.includes("number")) continue;
    const key = numberKey(String(plan.values.number));
    if ([...finalNumbers.entries()].some(([id, other]) => id !== plan.id && other === key)) {
      throw new WorkOrderError(`Já existe a OS ${plan.values.number} (os números não se repetem, nem os de OS excluídas).`);
    }
  }

  const result = { created: [] as string[], updated: [] as string[] };
  for (const plan of plans) {
    if (plan.kind === "update") {
      const sets = plan.fields.map((field) => `${field}=?`);
      const params: unknown[] = plan.fields.map((field) => plan.values[field]);
      if (plan.closedAt !== undefined) {
        sets.push("closed_at=?");
        params.push(plan.closedAt);
      }
      await db.execute(`UPDATE work_orders SET ${sets.join(", ")}, updated_at=datetime('now') WHERE company_id=? AND id=?`, [...params, companyId, plan.id]);
      result.updated.push(plan.id);
    } else {
      const { values } = plan;
      await db.execute(
        "INSERT INTO work_orders (id, company_id, number, customer_id, technician_id, status, priority, sla_due_at, labor_cost, materials_cost, opened_at, closed_at, checklist_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [plan.id, companyId, values.number, values.customer_id, values.technician_id, values.status, values.priority, values.sla_due_at, values.labor_cost, values.materials_cost, now, plan.closedAt ?? null, "[]"],
      );
      result.created.push(plan.id);
    }
  }
  return result;
}

/** Agenda de prazos: OS em andamento com prazo (dia inteiro); atrasada em vermelho. */
export function workOrderCalendarItems(rows: readonly WorkOrderView[], now = new Date()): { id: string; title: string; start: string; allDay: true; color?: string; sourceLabel: string }[] {
  const today = todayIso(now);
  return rows
    .filter((row) => !isClosedWorkOrder(row.status) && row.sla_due_at)
    .map((row) => {
      const start = dayOf(String(row.sla_due_at));
      return {
        id: row.id,
        title: `${row.number} · ${row.customer_name ?? "sem cliente"}`,
        start,
        allDay: true as const,
        color: start < today ? CALENDAR_LATE : undefined,
        sourceLabel: start < today ? "Prazo vencido" : "Prazo da OS",
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "pt-BR"));
}
