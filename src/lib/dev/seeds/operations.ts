// TEMPORÁRIO (dados de exemplo): mais ordens de serviço (todas com prazo) e prazo nas do seed principal, para a tela de
// OS ter atrasadas, em dia e concluídas. Precisa de clientes de exemplo; sem eles não grava nada. Sem flag: só
// INSERT OR IGNORE de ids fixos e prazo em OS de exemplo que ainda não tem.
import { getDb } from "@/lib/db/client";
import { exampleRows, memberFor, membersByRole, ts, type SeedRow } from "../seedUtils";

/** [número, status, prioridade, aberta há (dias), prazo (dias a partir de hoje), mão de obra, materiais, checklist]. */
const ORDERS: [string, string, string, number, number, number, number, string[]][] = [
  ["OS-1009", "aberta", "media", -1, 3, 0, 0, ["Agendar visita", "Levantar equipamentos"]],
  ["OS-1010", "em_execucao", "alta", -6, -1, 540, 380, ["Trocar switch", "Testar links", "Atualizar inventário"]],
  ["OS-1011", "atribuida", "urgente", 0, 1, 0, 0, ["Diagnóstico remoto"]],
  ["OS-1012", "concluida", "media", -20, -15, 760, 220, ["Instalar câmeras", "Configurar gravador"]],
  ["OS-1013", "aguardando_peca", "alta", -8, 2, 260, 0, ["Aguardar fonte", "Substituir fonte"]],
  ["OS-1014", "cancelada", "baixa", -12, -5, 0, 0, ["Cliente desistiu"]],
];

export async function seed(companyId: string): Promise<void> {
  const customers = await exampleRows<{ id: string }>("customers", companyId);
  if (customers.length === 0) return;
  const db = await getDb();
  const members = await membersByRole(companyId);
  const technician = memberFor(members, "tecnico", "gerente", "admin");

  const rows: SeedRow[] = ORDERS.map(([number, status, priority, opened, due, labor, materials, checklist], index) => ({
    id: `dev-wo-extra-${index + 1}`,
    number,
    customer_id: customers[(index * 3) % customers.length].id,
    technician_id: technician,
    status,
    priority,
    opened_at: ts(opened),
    sla_due_at: ts(due, 18),
    closed_at: status === "concluida" ? ts(due - 1, 16) : null,
    checklist_json: JSON.stringify(checklist.map((title, position) => ({ title, done: status === "concluida" || position === 0 && status !== "aberta" }))),
    labor_cost: labor,
    materials_cost: materials,
    created_at: ts(opened),
  }));
  for (const row of rows) {
    await db.execute(
      `INSERT OR IGNORE INTO work_orders (${["company_id", ...Object.keys(row)].join(", ")}) VALUES (${["company_id", ...Object.keys(row)].map(() => "?").join(", ")})`,
      [companyId, ...Object.values(row)],
    );
  }

  // Prazo nas OS de exemplo que ainda não têm (as do seed principal): alguns dias depois da abertura.
  const orders = await exampleRows<{ id: string; sla_due_at?: string | null; opened_at?: string | null }>("work_orders", companyId);
  for (const [index, order] of orders.entries()) {
    if (order.sla_due_at || !order.opened_at) continue;
    const due = new Date(order.opened_at);
    due.setDate(due.getDate() + 3 + (index % 5));
    await db.execute("UPDATE work_orders SET sla_due_at=? WHERE company_id=? AND id=?", [due.toISOString(), companyId, order.id]);
  }
}
