// Números da home por setor no SQLite real (migrations aplicadas): somas, filtros por data/status e escopo por papel.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, TEST_ROLES, type TestDb } from "@/test/sqlite";
import type { DatabaseLike } from "@/lib/db/demo";
import { HOME_WIDGETS, roleHome } from "./roleHomes";
import { addDays, loadHomeMetrics, METRIC_LOADERS, type HomeContext, type HomeMetric } from "./metrics";
import type { Role } from "@/types";

const C = "test-company";
const TODAY = "2026-10-24";
// Meio-dia local de 24/10/2026.
const NOW = new Date(2026, 9, 24, 12, 0, 0);

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { companyId: C });
  await insertTestCompany(db, { companyId: "other-company", roles: ["ceo"] });
});

afterEach(() => db.close());

const day = (offset: number) => addDays(TODAY, offset);
/** Instante (ISO UTC) a `hours` horas de NOW. */
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const ctx = (role: Role, userId = `test-user-${role}`): HomeContext => ({ companyId: C, userId, role, today: TODAY, now: NOW });

async function put(table: string, row: Record<string, unknown>, target: DatabaseLike = db): Promise<void> {
  const columns = Object.keys(row);
  await target.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, Object.values(row));
}

async function metric(id: string, role: Role, userId?: string): Promise<HomeMetric> {
  const results = await loadHomeMetrics(db, ctx(role, userId), [HOME_WIDGETS[id]]);
  const result = results[id];
  if (!result) throw new Error(`sem resultado para ${id}`);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  return result.metric;
}

describe("catálogo de métricas", () => {
  it("todo widget de dado tem loader; atalho não tem", () => {
    for (const widget of Object.values(HOME_WIDGETS)) {
      expect(!!METRIC_LOADERS[widget.id], widget.id).toBe(widget.kind !== "shortcut");
    }
  });

  it.each(TEST_ROLES)("%s: banco vazio carrega todos os widgets sem erro", async (role) => {
    const results = await loadHomeMetrics(db, ctx(role), roleHome(role));
    for (const widget of roleHome(role).filter((item) => item.kind !== "shortcut")) {
      const result = results[widget.id];
      expect(result, widget.id).toBeDefined();
      expect(result.ok ? null : result.error, widget.id).toBeNull();
    }
    expect(Object.keys(results).some((id) => HOME_WIDGETS[id].kind === "shortcut")).toBe(false);
  });

  it("um loader que falha não derruba os outros", async () => {
    const broken: DatabaseLike = {
      select: async <T,>(sql: string, binds?: unknown[]) => {
        if (/from receivables/i.test(sql)) throw new Error("tabela indisponível");
        return db.select<T>(sql, binds);
      },
      execute: (sql: string, binds?: unknown[]) => db.execute(sql, binds),
    };
    const results = await loadHomeMetrics(broken, ctx("financeiro"), [HOME_WIDGETS["fin.overdueReceivables"], HOME_WIDGETS["fin.overduePayables"]]);
    expect(results["fin.overdueReceivables"]).toEqual({ ok: false, error: "tabela indisponível" });
    expect(results["fin.overduePayables"].ok).toBe(true);
  });

  it("addDays atravessa mês e ano", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("financeiro", () => {
  beforeEach(async () => {
    await put("receivables", { id: "r1", company_id: C, description: "Fatura 1", amount: 100, due_date: day(-1), status: "aberta" });
    await put("receivables", { id: "r2", company_id: C, description: "Fatura 2", amount: 200, received_amount: 50, due_date: day(-3), status: "recebida_parcial" });
    await put("receivables", { id: "r3", company_id: C, description: "Futuro", amount: 70.1, due_date: day(2), status: "aberta" });
    await put("receivables", { id: "r4", company_id: C, description: "Recebida", amount: 999, due_date: day(-5), status: "recebida", received_amount: 999 });
    await put("receivables", { id: "r5", company_id: C, description: "Cancelada", amount: 999, due_date: day(-5), status: "cancelada" });
    await put("receivables", { id: "r6", company_id: C, description: "Excluída", amount: 999, due_date: day(-5), status: "aberta", deleted_at: at(-1) });
    await put("receivables", { id: "r7", company_id: "other-company", description: "Outra empresa", amount: 999, due_date: day(-5), status: "aberta" });
    await put("receivables", { id: "r8", company_id: C, description: "Daqui a 7 dias", amount: 5, due_date: day(7), status: "aberta" });
    await put("payables", { id: "p1", company_id: C, description: "Aluguel", amount: 1500, due_date: day(-2), status: "aprovada" });
    await put("payables", { id: "p2", company_id: C, description: "Energia", amount: 300.55, paid_amount: 100.5, due_date: day(-1), status: "paga_parcial" });
    await put("payables", { id: "p3", company_id: C, description: "Internet", amount: 200, due_date: day(0), status: "aberta" });
    await put("payables", { id: "p4", company_id: C, description: "Fornecedor", amount: 80, due_date: day(6), status: "aberta" });
    await put("payables", { id: "p5", company_id: C, description: "Paga", amount: 999, due_date: day(-9), status: "paga", paid_amount: 999 });
  });

  it("a receber vencido: saldo (valor − recebido) das contas em aberto com vencimento passado", async () => {
    const result = await metric("fin.overdueReceivables", "financeiro");
    expect(result).toMatchObject({ value: 250, format: "money", tone: "danger" });
    expect(result.hint).toContain("2 contas");
  });

  it("a pagar vencido usa paid_amount e arredonda centavos", async () => {
    const result = await metric("fin.overduePayables", "financeiro");
    expect(result.value).toBe(1700.05);
  });

  it("contas a aprovar: abertas (sem aprovação)", async () => {
    expect((await metric("fin.payablesToApprove", "gerente")).value).toBe(2);
  });

  it("vencimentos dos próximos 7 dias: hoje até hoje+6, ordenados por data", async () => {
    const result = await metric("fin.dueNext7", "financeiro");
    expect(result.value).toBe(3);
    expect(result.items?.map((item) => item.id)).toEqual(["payable:p3", "receivable:r3", "payable:p4"]);
    expect(result.items?.[0].title).toContain("Internet");
  });

  it("fluxo dos próximos 7 dias: 7 pontos com entradas e saídas por dia; valor = saldo da semana", async () => {
    const result = await metric("fin.cashflow7", "financeiro");
    expect(result.chart?.points).toHaveLength(7);
    expect(result.chart?.series.map((series) => series.key)).toEqual(["entradas", "saidas"]);
    expect(result.chart?.points[0]).toMatchObject({ saidas: 200, entradas: 0 });
    expect(result.chart?.points[2]).toMatchObject({ entradas: 70.1 });
    expect(result.value).toBe(-209.9);
    expect(result.tone).toBe("danger");
  });

  it("extrato a conciliar e faturas em aberto", async () => {
    await put("bank_accounts", { id: "b1", company_id: C, name: "Conta" });
    await put("bank_transactions", { id: "t1", company_id: C, bank_account_id: "b1", posted_at: day(-1), amount: 100, status: "pendente" });
    await put("bank_transactions", { id: "t2", company_id: C, bank_account_id: "b1", posted_at: day(-1), amount: -40, status: "pendente" });
    await put("bank_transactions", { id: "t3", company_id: C, bank_account_id: "b1", posted_at: day(-1), amount: 10, status: "conciliada" });
    expect((await metric("bank.pendingReconciliation", "financeiro")).value).toBe(2);

    await put("invoices", { id: "i1", company_id: C, number: 1, status: "emitida", total: 1000, paid_amount: 0, due_date: day(-1) });
    await put("invoices", { id: "i2", company_id: C, number: 2, status: "paga_parcial", total: 500, paid_amount: 200, due_date: day(5) });
    await put("invoices", { id: "i3", company_id: C, number: 3, status: "paga", total: 900, paid_amount: 900 });
    await put("invoices", { id: "i4", company_id: C, number: 4, status: "rascunho", total: 900 });
    const invoices = await metric("invoices.open", "financeiro");
    expect(invoices).toMatchObject({ value: 1300, tone: "warning" });
    expect(invoices.hint).toContain("1 vencida");
  });
});

describe("comercial", () => {
  it("funil: soma das oportunidades abertas e valor ponderado", async () => {
    await put("opportunities", { id: "o1", company_id: C, title: "A", value: 1000, probability: 50, status: "open" });
    await put("opportunities", { id: "o2", company_id: C, title: "B", value: 3000, probability: 10, status: "open" });
    await put("opportunities", { id: "o3", company_id: C, title: "Ganha", value: 9999, probability: 100, status: "won" });
    const result = await metric("crm.pipeline", "comercial");
    expect(result).toMatchObject({ value: 4000, format: "money" });
    expect(result.hint).toContain("2 oportunidades");
    // Intl separa "R$" do número com espaço não separável.
    expect(result.hint?.replace(/\s/g, " ")).toContain("ponderado R$ 800,00");
  });

  it("follow-ups vencidos: comercial vê os seus; gerente vê os de todos; feitos e futuros ficam de fora", async () => {
    await put("customers", { id: "c1", company_id: C, name: "Padaria Central" });
    const base = { company_id: C, entity_type: "customer", entity_id: "c1", customer_id: "c1", kind: "ligacao" };
    await put("crm_activities", { ...base, id: "a1", subject: "Ligar de volta", due_at: at(-30), user_id: "test-user-comercial" });
    await put("crm_activities", { ...base, id: "a2", subject: "De outra pessoa", due_at: at(-5), user_id: "test-user-gerente" });
    await put("crm_activities", { ...base, id: "a3", subject: "Feita", due_at: at(-5), done_at: at(-1), user_id: "test-user-comercial" });
    await put("crm_activities", { ...base, id: "a4", subject: "Futura", due_at: at(5), user_id: "test-user-comercial" });
    await put("crm_activities", { ...base, id: "a5", subject: "Data só (ontem)", due_at: day(-1), user_id: "test-user-comercial", kind: "tarefa" });

    const mine = await metric("crm.followups", "comercial");
    expect(mine.value).toBe(2);
    expect(mine.items?.map((item) => item.id)).toEqual(["a1", "a5"]);
    expect(mine.items?.[0].detail).toContain("Padaria Central");
    expect(mine.tone).toBe("danger");

    expect((await metric("crm.followups", "gerente")).value).toBe(3);
  });

  it("vendas do mês: só pedidos confirmados, faturados ou entregues do mês corrente", async () => {
    await put("sales_orders", { id: "s1", company_id: C, number: 1, status: "confirmado", order_date: "2026-10-02", total: 1000 });
    await put("sales_orders", { id: "s2", company_id: C, number: 2, status: "faturado", order_date: "2026-10-20", total: 250.5 });
    await put("sales_orders", { id: "s3", company_id: C, number: 3, status: "rascunho", order_date: "2026-10-20", total: 999 });
    await put("sales_orders", { id: "s4", company_id: C, number: 4, status: "entregue", order_date: "2026-09-30", total: 999 });
    await put("sales_orders", { id: "s5", company_id: C, number: 5, status: "cancelado", order_date: "2026-10-21", total: 999 });
    const result = await metric("sales.monthOrders", "comercial");
    expect(result.value).toBe(1250.5);
    expect(result.hint).toContain("2 pedidos");
    expect((await metric("sales.toApprove", "gerente")).value).toBe(1);
  });

  it("propostas em aberto, clientes ativos e leads novos", async () => {
    await put("proposals", { id: "pr1", company_id: C, status: "enviada", value: 500, valid_until: day(-1) });
    await put("proposals", { id: "pr2", company_id: C, status: "rascunho", value: 300 });
    await put("proposals", { id: "pr3", company_id: C, status: "aceita", value: 999 });
    const proposals = await metric("crm.openProposals", "comercial");
    expect(proposals).toMatchObject({ value: 2, tone: "warning" });

    await put("customers", { id: "c1", company_id: C, name: "Ativo", status: "active" });
    await put("customers", { id: "c2", company_id: C, name: "Inativo", status: "inactive" });
    expect((await metric("crm.customers", "atendimento")).value).toBe(1);

    await put("leads", { id: "l1", company_id: C, name: "Lead novo", status: "novo", outreach_date: TODAY });
    await put("leads", { id: "l2", company_id: C, name: "Abordado", status: "abordado" });
    const leads = await metric("leads.new", "comercial");
    expect(leads.value).toBe(1);
    expect(leads.hint).toContain("1 com abordagem prevista para hoje");
  });
});

describe("estoque e compras", () => {
  it("itens abaixo do mínimo somam o saldo de todos os locais", async () => {
    await put("stock_locations", { id: "loc1", company_id: C, name: "Depósito" });
    await put("stock_locations", { id: "loc2", company_id: C, name: "Loja" });
    await put("inventory_items", { id: "it1", company_id: C, name: "Cabo HDMI", min_stock: 10, unit: "un" });
    await put("inventory_items", { id: "it2", company_id: C, name: "Mouse", min_stock: 5, unit: "un" });
    await put("inventory_items", { id: "it3", company_id: C, name: "Sem mínimo", min_stock: 0, unit: "un" });
    await put("inventory_items", { id: "it4", company_id: C, name: "Sem saldo", min_stock: 2, unit: "cx" });
    await put("stock_balances", { id: "sb1", company_id: C, item_id: "it1", location_id: "loc1", quantity: 3 });
    await put("stock_balances", { id: "sb2", company_id: C, item_id: "it1", location_id: "loc2", quantity: 2 });
    await put("stock_balances", { id: "sb3", company_id: C, item_id: "it2", location_id: "loc1", quantity: 5 });
    const result = await metric("inv.belowMin", "estoquista");
    expect(result.value).toBe(2);
    expect(result.items?.map((item) => item.id)).toEqual(["it4", "it1"]);
    expect(result.items?.[1].detail).toBe("Saldo 5 de mínimo 10 un");
  });

  it("compras a receber (atrasadas no aviso), a aprovar, inventários e custódias", async () => {
    await put("purchase_orders", { id: "po1", company_id: C, number: 1, status: "aprovado", expected_date: day(-2), total: 100 });
    await put("purchase_orders", { id: "po2", company_id: C, number: 2, status: "recebido_parcial", expected_date: day(3), total: 100 });
    await put("purchase_orders", { id: "po3", company_id: C, number: 3, status: "rascunho", total: 450 });
    await put("purchase_orders", { id: "po4", company_id: C, number: 4, status: "recebido", total: 100 });
    const receive = await metric("pur.toReceive", "estoquista");
    expect(receive).toMatchObject({ value: 2, tone: "warning" });
    expect(receive.hint).toContain("1 atrasado");
    expect((await metric("pur.toApprove", "gerente")).value).toBe(1);

    await put("inventory_counts", { id: "ic1", company_id: C, number: 1, status: "aberta" });
    await put("inventory_counts", { id: "ic2", company_id: C, number: 2, status: "concluida" });
    expect((await metric("inv.openCounts", "estoquista")).value).toBe(1);

    await put("custodies", { id: "cu1", company_id: C, holder_id: "test-user-tecnico", status: "em_custodia", due_back_at: at(-2) });
    await put("custodies", { id: "cu2", company_id: C, holder_id: "test-user-tecnico", status: "devolvido" });
    const custody = await metric("custody.active", "tecnico");
    expect(custody).toMatchObject({ value: 1, tone: "warning" });

    await put("products", { id: "pd1", company_id: C, name: "Produto", kind: "produto", active: 1 });
    await put("products", { id: "pd2", company_id: C, name: "Serviço", kind: "servico", active: 1 });
    await put("products", { id: "pd3", company_id: C, name: "Inativo", kind: "produto", active: 0 });
    const catalog = await metric("catalog.active", "produtos");
    expect(catalog.value).toBe(2);
    expect(catalog.hint).toBe("1 produto · 1 serviço");
  });
});

describe("operações, TI e auditoria", () => {
  it("chamados: a TI vê todos; os demais, só os que abriram", async () => {
    await put("tickets", { id: "tk1", company_id: C, subject: "Impressora", status: "aberto", opened_by: "test-user-atendimento", priority: "urgente" });
    await put("tickets", { id: "tk2", company_id: C, subject: "VPN", status: "em_atendimento", opened_by: "test-user-financeiro" });
    await put("tickets", { id: "tk3", company_id: C, subject: "Resolvido", status: "resolvido", opened_by: "test-user-atendimento" });
    expect((await metric("support.openTickets", "tecnico")).value).toBe(2);
    const own = await metric("support.openTickets", "atendimento");
    expect(own.value).toBe(1);
    expect(own.hint).toContain("que você abriu");
  });

  it("OS em aberto (atrasadas pelo SLA) e série dos últimos 7 dias", async () => {
    await put("work_orders", { id: "w1", company_id: C, number: "OS-1", status: "aberta", sla_due_at: at(-3), opened_at: at(-1) });
    await put("work_orders", { id: "w2", company_id: C, number: "OS-2", status: "em_execucao", opened_at: at(-48) });
    await put("work_orders", { id: "w3", company_id: C, number: "OS-3", status: "concluida", opened_at: at(-24 * 10) });
    const open = await metric("ops.openWorkOrders", "tecnico");
    expect(open).toMatchObject({ value: 2, tone: "warning" });
    expect(open.hint).toContain("1 atrasada");

    await put("tickets", { id: "tk1", company_id: C, subject: "Hoje", status: "aberto", opened_by: "test-user-atendimento", created_at: at(-1) });
    const week = await metric("ops.week", "tecnico");
    expect(week.chart?.points).toHaveLength(7);
    expect(week.chart?.points[6]).toMatchObject({ os: 1, chamados: 1 });
    expect(week.chart?.points[4]).toMatchObject({ os: 1 });
    expect(week.value).toBe(2);
    const managerWeek = await metric("ops.week", "gerente");
    expect(managerWeek.chart?.series.map((series) => series.key)).toEqual(["os"]);
  });

  it("últimas ações: auditoria + eventos só dos módulos que o papel vê (auditor não vê folha nem gestão de RH)", async () => {
    await put("audit_logs", { id: "al1", company_id: C, entity_type: "payable", action: "payable.approved", created_at: at(-3) });
    await put("activities", { id: "ac1", company_id: C, entity_type: "employee", entity_id: "e1", action: "payroll.updated", title: "Remuneração atualizada", module: "payroll", created_at: at(-1) });
    await put("activities", { id: "ac2", company_id: C, entity_type: "hr_request", entity_id: "r1", action: "hr_request.decided", title: "Solicitação aprovada", module: "hr_manage", created_at: at(-2) });
    await put("activities", { id: "ac3", company_id: C, entity_type: "invoice", entity_id: "i1", action: "invoice.issued", title: "Fatura emitida", module: "finance", created_at: at(-4) });
    await put("activities", { id: "ac4", company_id: C, entity_type: "x", entity_id: "x", action: "x.sem_modulo", title: "Sem módulo", created_at: at(-5) });
    const auditor = await metric("audit.recent", "auditor");
    expect(auditor.items?.map((item) => item.id)).toEqual(["audit:al1", "activity:ac3"]);
    const ceo = await metric("audit.recent", "ceo");
    expect(ceo.items?.map((item) => item.id)).toEqual(["activity:ac1", "activity:ac2", "audit:al1", "activity:ac3", "activity:ac4"]);
    expect(ceo.value).toBe(5);
  });

  it("últimas ações: eventos do Meu RH e de contas (telas que todos abrem) só para quem vê Gestão de RH e Usuários", async () => {
    // Meu RH e Configurações abrem para todos, mas os eventos delas são de outras pessoas (férias, horas, senhas).
    await put("activities", { id: "hr1", company_id: C, entity_type: "hr_request", entity_id: "r1", action: "hr_request.created", title: "Férias solicitada por Caio", module: "hr", created_at: at(-1) });
    await put("activities", { id: "hr2", company_id: C, entity_type: "hr_time_entry", entity_id: "h1", action: "hr_time_entry.created", title: "Banco de horas informado por Caio: +2h00", module: "hr", created_at: at(-2) });
    await put("activities", { id: "st1", company_id: C, entity_type: "user", entity_id: "test-user-comercial", action: "user.password_reset", title: "Senha redefinida: Caio", module: "settings", created_at: at(-3) });
    await put("activities", { id: "tk1", company_id: C, entity_type: "ticket", entity_id: "t1", action: "ticket.created", title: "Chamado aberto", module: "support", created_at: at(-4) });
    const ids = async (role: Role) => (await metric("audit.recent", role)).items?.map((item) => item.id);
    expect(await ids("tecnico")).toEqual(["activity:tk1"]);
    expect(await ids("auditor")).toEqual(["activity:st1", "activity:tk1"]);
    expect(await ids("ceo")).toEqual(["activity:hr1", "activity:hr2", "activity:st1", "activity:tk1"]);
  });

  it("últimas ações em pt-BR: tipo do registro e ação da trilha traduzidos (código cru só se for desconhecido)", async () => {
    await put("audit_logs", { id: "al1", company_id: C, entity_type: "payable", action: "payable.approved", created_at: at(-1) });
    await put("audit_logs", { id: "al2", company_id: C, entity_type: "algo_novo", action: "algo_novo.reprocessed", created_at: at(-2) });
    await put("activities", { id: "ac1", company_id: C, entity_type: "invoice", entity_id: "i1", action: "invoice.issued", title: "Fatura emitida", module: "finance", created_at: at(-3) });
    const items = (await metric("audit.recent", "auditor")).items ?? [];
    expect(items.map((item) => item.title)).toEqual(["Aprovação", "algo_novo.reprocessed", "Fatura emitida"]);
    expect(items.map((item) => item.detail?.split(" · ")[0])).toEqual(["Conta a pagar", "algo novo", "Fatura"]);
  });

  it("projetos ativos e tarefas abertas (atrasadas no aviso)", async () => {
    await put("projects", { id: "pj1", company_id: C, name: "Site", status: "andamento" });
    await put("projects", { id: "pj2", company_id: C, name: "Pausado", status: "pausado" });
    await put("tasks", { id: "ts1", company_id: C, title: "Atrasada", status: "aberta", due_date: day(-1) });
    await put("tasks", { id: "ts2", company_id: C, title: "Em andamento", status: "em_andamento" });
    await put("tasks", { id: "ts3", company_id: C, title: "Concluída", status: "concluida", due_date: day(-9) });
    expect((await metric("projects.active", "produtos")).value).toBe(1);
    const tasks = await metric("tasks.open", "produtos");
    expect(tasks).toMatchObject({ value: 2, tone: "warning" });
  });
});

describe("RH", () => {
  beforeEach(async () => {
    await put("employees", { id: "e-rh", company_id: C, user_id: "test-user-rh", name: "Ana RH", hire_date: "2020-01-10", status: "ativo", vacation_days_entitled: 30 });
    await put("employees", { id: "e-com", company_id: C, user_id: "test-user-comercial", name: "Caio Comercial", status: "ativo", vacation_days_entitled: 30 });
    await put("employees", { id: "e-new", company_id: C, name: "Novo", status: "ativo" });
    await put("employees", { id: "e-out", company_id: C, name: "Saindo", status: "desligado" });
    await put("hr_requests", { id: "q1", company_id: C, employee_id: "e-com", type: "ferias", start_date: "2026-11-10", end_date: "2026-11-19", days: 10, status: "pendente" });
    await put("hr_requests", { id: "q2", company_id: C, employee_id: "e-com", type: "ferias", start_date: "2026-03-02", end_date: "2026-03-06", days: 5, status: "aprovada" });
    await put("hr_requests", { id: "q3", company_id: C, employee_id: "e-rh", type: "folga", start_date: "2026-10-30", end_date: "2026-10-30", days: 1, status: "pendente" });
    await put("hr_requests", { id: "q4", company_id: C, employee_id: "e-rh", type: "ferias", start_date: day(-2), end_date: day(3), days: 6, status: "aprovada" });
    await put("hr_tasks", { id: "k1", company_id: C, employee_id: "e-new", title: "Exame admissional", status: "pendente", category: "admissao", due_date: day(-1) });
    await put("hr_tasks", { id: "k2", company_id: C, employee_id: "e-new", title: "Contrato", status: "concluida", category: "admissao" });
    await put("hr_tasks", { id: "k3", company_id: C, employee_id: "e-out", title: "Homologação", status: "pendente", category: "desligamento", due_date: day(2) });
    await put("hr_tasks", { id: "k4", company_id: C, employee_id: "e-com", title: "Atualizar endereço", status: "pendente", category: "geral", due_date: day(-3) });
    await put("hr_time_entries", { id: "h1", company_id: C, employee_id: "e-com", entry_date: day(-3), minutes: 120, status: "aprovada" });
    await put("hr_time_entries", { id: "h2", company_id: C, employee_id: "e-com", entry_date: day(-2), minutes: -30, status: "aprovada" });
    await put("hr_time_entries", { id: "h3", company_id: C, employee_id: "e-com", entry_date: day(-1), minutes: 45, status: "pendente" });
    await put("hr_time_entries", { id: "h4", company_id: C, employee_id: "e-rh", entry_date: day(-1), minutes: 60, status: "recusada" });
  });

  it("solicitações a decidir com nome e tipo; horas a aprovar; ciclo; ativos; pendências atrasadas", async () => {
    const requests = await metric("hr.pendingRequests", "rh");
    expect(requests.value).toBe(2);
    expect(requests.items?.map((item) => item.id)).toEqual(["q3", "q1"]);
    expect(requests.items?.[1].title).toBe("Caio Comercial · Férias");

    const hours = await metric("hr.timeBankPending", "rh");
    expect(hours.value).toBe(1);
    expect(hours.hint).toContain("+0h45");

    const cycle = await metric("hr.cycle", "rh");
    expect(cycle.value).toBe(2);
    expect(cycle.hint).toBe("1 admissão · 1 desligamento · 2 tarefas abertas");

    const active = await metric("hr.activeEmployees", "rh");
    expect(active.value).toBe(3);
    expect(active.hint).toContain("1 de férias hoje");

    expect((await metric("hr.lateTasks", "rh")).value).toBe(2);
  });

  it("Meu RH: férias disponíveis, pendências e saldo do banco de horas do próprio colaborador", async () => {
    // Checklist de admissão/desligamento é tarefa do RH, não pendência do colaborador.
    await put("hr_tasks", { id: "k5", company_id: C, employee_id: "e-com", title: "Recolher notebook", status: "pendente", category: "desligamento", due_date: day(-1) });
    await put("hr_tasks", { id: "k6", company_id: C, employee_id: "e-com", title: "Assinar contrato", status: "pendente", category: "admissao", due_date: day(1) });
    const vacation = await metric("hr.vacation", "comercial");
    expect(vacation).toMatchObject({ value: 15, format: "days" });
    const todos = await metric("hr.myTodos", "comercial");
    expect(todos).toMatchObject({ value: 1, tone: "warning" });
    const bank = await metric("hr.myTimeBank", "comercial");
    expect(bank).toMatchObject({ value: 90, format: "minutes" });
    expect(bank.hint).toContain("+0h45 em análise");
  });

  it("Meu RH sem cadastro de colaborador: zero, sem erro", async () => {
    const vacation = await metric("hr.vacation", "auditor");
    expect(vacation.value).toBe(0);
    expect(vacation.hint).toMatch(/cadastro/i);
  });

  it("folha mensal: salários base de quem não está desligado (só CEO e admin têm o widget)", async () => {
    await put("employee_compensation", { id: "pay1", company_id: C, employee_id: "e-rh", base_salary: 4000 });
    await put("employee_compensation", { id: "pay2", company_id: C, employee_id: "e-com", base_salary: 3500.5 });
    await put("employee_compensation", { id: "pay3", company_id: C, employee_id: "e-out", base_salary: 9999 });
    const payroll = await metric("payroll.monthly", "ceo");
    expect(payroll).toMatchObject({ value: 7500.5, format: "money" });
  });
});
