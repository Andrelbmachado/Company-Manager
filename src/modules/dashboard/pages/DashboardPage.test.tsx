// Home por setor na tela: cada papel vê só os widgets dele (com os números do banco) e o Meu RH.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { roleHome } from "@/lib/dashboard/roleHomes";
import { addPayable, addReceivable, addSettlement, insertRow } from "@/test/financeFixtures";
import { setCompanySetting } from "@/lib/settings/companySettings";
import { AREA_PROFILE_SETTING, LABELS_SETTING } from "@/lib/labels/store";
import { todayIso } from "@/lib/utils";
import type { Role, Session } from "@/types";
import DashboardPage from "./DashboardPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();
let root: Root | null = null;
let container: HTMLDivElement;

beforeAll(() => {
  // O gráfico (recharts ResponsiveContainer) observa o tamanho do card; o jsdom não tem ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function sessionFor(role: Role): Session {
  const stamp = "2026-01-01T00:00:00.000Z";
  return {
    user: { id: `test-user-${role}`, name: `Teste ${role}`, email: `${role}@teste.local`, status: "active", locale: "pt-BR", created_at: stamp, updated_at: stamp },
    membership: { id: `test-member-test-company-${role}`, company_id: "test-company", user_id: `test-user-${role}`, role, scope: "setor", created_at: stamp, updated_at: stamp },
    company: { id: "test-company", name: "Empresa de Teste", settings_json: "{}", created_at: stamp, updated_at: stamp },
  } as Session;
}

async function render(role: Role, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const session = sessionFor(role);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session, setSession: () => undefined }}>
          <MemoryRouter>
            <DashboardPage />
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
}

/** Espera (dentro do act) as consultas terminarem: some o esqueleto de carregamento. */
async function settled(): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (container.querySelector("[data-widget]") && !container.querySelector(".animate-pulse")) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`A home não terminou de carregar: ${container.innerHTML.slice(0, 300)}`);
}

const shown = () => Array.from(container.querySelectorAll("[data-widget]")).map((element) => element.getAttribute("data-widget"));
const widgetText = (id: string) => container.querySelector(`[data-widget='${id}']`)?.textContent?.replace(/\s/g, " ") ?? "";

describe("DashboardPage (home por setor)", () => {
  it("comercial: só os widgets do comercial, com o funil do banco, e o Meu RH criado no primeiro acesso", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await db.execute("INSERT INTO opportunities (id, company_id, title, value, probability, status) VALUES (?,?,?,?,?,?)", ["o1", "test-company", "Site", 1000, 50, "open"]);
    await render("comercial");
    await settled();

    expect(shown().sort()).toEqual(roleHome("comercial").map((widget) => widget.id).sort());
    expect(shown()).not.toContain("fin.overdueReceivables");
    expect(widgetText("crm.pipeline")).toContain("R$ 1.000,00");
    expect(container.querySelector("[data-widget='crm.pipeline']")?.getAttribute("href")).toBe("/crm/funil");
    expect(container.querySelector("h1")?.textContent).toBe("Dashboard");

    const employees = await db.select<{ user_id: string }[]>("SELECT user_id FROM employees WHERE company_id=?", ["test-company"]);
    expect(employees.map((row) => row.user_id)).toEqual(["test-user-comercial"]);
    expect(widgetText("hr.vacation")).toContain("30 dias");
  });

  it("comercial: follow-ups vencidos são os do CRM (OverdueFollowUps), só os da pessoa e com Concluir na própria home", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await db.execute("INSERT INTO crm_activities (id, company_id, entity_type, entity_id, kind, subject, due_at, user_id) VALUES (?,?,?,?,?,?,?,?)", ["a1", "test-company", "customer", "c1", "ligacao", "Ligar para a Clínica Vida", "2020-01-01T12:00:00.000Z", "test-user-comercial"]);
    await db.execute("INSERT INTO crm_activities (id, company_id, entity_type, entity_id, kind, subject, due_at, user_id) VALUES (?,?,?,?,?,?,?,?)", ["a2", "test-company", "customer", "c1", "ligacao", "Follow-up de outra pessoa", "2020-01-01T12:00:00.000Z", "test-user-financeiro"]);
    await render("comercial");
    await settled();
    for (let attempt = 0; attempt < 300 && !widgetText("crm.followups").includes("Clínica Vida"); attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }

    const card = container.querySelector("[data-widget='crm.followups']");
    expect(card?.querySelector("section[aria-label='Follow-ups atrasados']")).toBeTruthy();
    expect(widgetText("crm.followups")).toContain("Ligar para a Clínica Vida");
    expect(widgetText("crm.followups")).not.toContain("outra pessoa");
    expect(Array.from(card?.querySelectorAll("button") ?? []).some((button) => button.textContent?.includes("Concluir"))).toBe(true);
  });

  it("financeiro: vencidos e fluxo da semana; nada de CRM nem de RH da equipe", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await db.execute("INSERT INTO receivables (id, company_id, description, amount, due_date, status) VALUES (?,?,?,?,?,?)", ["r1", "test-company", "Fatura", 450.25, "2020-01-01", "aberta"]);
    await render("financeiro");
    await settled();

    expect(shown()).toEqual(expect.arrayContaining(["fin.overdueReceivables", "fin.cashflow7", "fin.dueNext7"]));
    for (const forbidden of ["crm.pipeline", "hr.pendingRequests", "payroll.monthly", "inv.belowMin"]) expect(shown()).not.toContain(forbidden);
    expect(widgetText("fin.overdueReceivables")).toContain("R$ 450,25");
  });

  it("CEO: desligamento agendado cuja data passou é efetivado ao abrir a home (ativos e folha sem a pessoa)", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await db.execute("INSERT INTO employees (id, company_id, name, status, termination_date) VALUES (?,?,?,?,?)", ["e1", "test-company", "Ana", "ativo", null]);
    await db.execute("INSERT INTO employees (id, company_id, name, status, termination_date, termination_reason) VALUES (?,?,?,?,?,?)", ["e2", "test-company", "Bruno", "ativo", "2020-01-10", "Pedido de demissão"]);
    await db.execute("INSERT INTO employee_compensation (id, company_id, employee_id, base_salary) VALUES (?,?,?,?)", ["c1", "test-company", "e1", 3000]);
    await db.execute("INSERT INTO employee_compensation (id, company_id, employee_id, base_salary) VALUES (?,?,?,?)", ["c2", "test-company", "e2", 5000]);
    // Lista de colaboradores já em cache (Gestão de RH / Folha abertas antes): precisa recarregar depois.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["hr", "employees", "test-company"], []);
    await render("ceo", client);
    await settled();

    // Ana e o cadastro do próprio CEO (Meu RH); Bruno saiu em 2020 e não entra na folha.
    expect(widgetText("payroll.monthly")).toContain("R$ 3.000,00");
    // Card do topo só com título e número: o detalhe fica na dica e no nome acessível.
    expect(widgetText("payroll.monthly")).not.toContain("colaboradores ativos");
    expect(container.querySelector("[data-widget='payroll.monthly']")?.getAttribute("aria-label")).toContain("2 colaboradores ativos");
    const [bruno] = await db.select<{ status: string }[]>("SELECT status FROM employees WHERE id=?", ["e2"]);
    expect(bruno.status).toBe("desligado");
    expect(client.getQueryState(["hr", "employees", "test-company"])?.isInvalidated).toBe(true);
  });

  it("papel que não edita o RH não efetiva desligamento ao abrir a home", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await db.execute("INSERT INTO employees (id, company_id, name, status, termination_date) VALUES (?,?,?,?,?)", ["e2", "test-company", "Bruno", "ativo", "2020-01-10"]);
    await render("comercial");
    await settled();
    const [bruno] = await db.select<{ status: string }[]>("SELECT status FROM employees WHERE id=?", ["e2"]);
    expect(bruno.status).toBe("ativo");
  });

  it("RH: solicitações e ciclo do colaborador, sem folha", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("rh");
    await settled();
    expect(shown()).toEqual(expect.arrayContaining(["hr.pendingRequests", "hr.cycle", "hr.timeBankPending", "go.admission"]));
    expect(shown()).not.toContain("payroll.monthly");
  });
});

describe("DashboardPage (resumo do topo e balanço anual)", () => {
  const plainText = (value: string | null | undefined) => (value ?? "").replace(/\u00a0/g, " ").trim();
  const overviewCards = () =>
    Array.from(container.querySelectorAll("[data-overview] [data-card]")).map((card) => ({
      key: card.getAttribute("data-card"),
      title: plainText(card.querySelector(".kpi-card > :first-child")?.textContent),
      value: plainText(card.querySelector("[data-kpi-value]")?.textContent),
    }));

  async function overviewLoaded(): Promise<void> {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (container.querySelector("[data-overview]") && !container.querySelector("[data-overview] .animate-pulse") && !container.querySelector("[data-chart='balance'] .animate-pulse")) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    throw new Error(`O resumo do topo não carregou: ${container.innerHTML.slice(0, 300)}`);
  }

  /** Mês com R$ 1.000 recebidos e R$ 2.500 pagos hoje, R$ 300 a receber e R$ 120 a pagar hoje, um projeto em andamento. */
  async function seedMonth(db: ReturnType<typeof testDb>) {
    const today = todayIso();
    await insertTestCompany(db);
    await addReceivable(db, "test-company", { id: "r-recebida", amount: 1000, due_date: today, status: "recebida", received_amount: 1000, received_at: today });
    await addSettlement(db, "test-company", { id: "s-recebida", receivable_id: "r-recebida", amount: 1000, paid_at: today });
    await addPayable(db, "test-company", { id: "p-paga", amount: 2500, due_date: today, status: "paga", paid_amount: 2500, paid_at: today });
    await addReceivable(db, "test-company", { id: "r-semana", amount: 300, due_date: today });
    await addPayable(db, "test-company", { id: "p-semana", amount: 120, due_date: today, status: "aprovada" });
    await insertRow(db, "customers", { id: "c1", company_id: "test-company", name: "Cliente" });
    await insertRow(db, "projects", { id: "pr1", company_id: "test-company", name: "Site", status: "andamento", customer_id: "c1" });
    await insertRow(db, "projects", { id: "pr2", company_id: "test-company", name: "App", status: "planejado", customer_id: "c1" });
  }

  it("CEO: 4 cards (Dívida do mês quando negativo, semana a pagar e a receber, projetos ativos) e o gráfico do ano com 3 linhas", async () => {
    const db = testDb();
    await seedMonth(db);
    await render("ceo");
    await settled();
    await overviewLoaded();

    expect(overviewCards()).toEqual([
      { key: "result", title: "Dívida do mês", value: "R$ 1.500,00" },
      { key: "payables_week", title: "A pagar na semana", value: "R$ 120,00" },
      { key: "receivables_week", title: "A receber na semana", value: "R$ 300,00" },
      { key: "active_work", title: "Projetos ativos", value: "2" },
    ]);
    // Dívida é estado: o número vem com a cor de erro.
    expect(container.querySelector("[data-card='result'] [data-kpi-value] .text-destructive")).toBeTruthy();

    const chart = container.querySelector("[data-chart='balance']");
    expect(chart?.querySelector("h2")?.textContent).toContain("Balanço anual");
    expect(Array.from(chart?.querySelectorAll("[data-legend]") ?? []).map((item) => item.textContent)).toEqual(["Resultado do mês", "Acumulado no ano", "Previsão de receita"]);
    const rows = Array.from(chart?.querySelectorAll("table tbody tr") ?? []);
    expect(rows).toHaveLength(12);
    const month = Number(todayIso().slice(5, 7));
    expect(plainText(rows[month - 1].textContent)).toContain("-R$ 1.500,00");

    // O card "Projetos ativos" do topo substitui o indicador igual do setor.
    expect(shown()).not.toContain("projects.active");
  });

  it("todo card do topo da home tem só título e número (nada embaixo do número)", async () => {
    const db = testDb();
    await seedMonth(db);
    await render("ceo");
    await settled();
    await overviewLoaded();
    const cards = Array.from(container.querySelectorAll(".kpi-card"));
    expect(cards.length).toBeGreaterThan(8);
    for (const card of cards) {
      expect(card.children).toHaveLength(2);
      expect(card.children[1].hasAttribute("data-kpi-value")).toBe(true);
    }
  });

  it("advocacia: Lucro do mês quando positivo, Clientes ativos (clientes com caso ativo) e rótulo personalizado no gráfico", async () => {
    const db = testDb();
    await seedMonth(db);
    await addReceivable(db, "test-company", { id: "r-grande", amount: 5000, due_date: todayIso(), status: "recebida", received_amount: 5000, received_at: todayIso() });
    await setCompanySetting(db, "test-company", AREA_PROFILE_SETTING, "advocacia");
    await setCompanySetting(db, "test-company", LABELS_SETTING, { "dashboard.balance_chart": "Caixa do escritório" });
    await render("ceo");
    await settled();
    await overviewLoaded();

    expect(overviewCards()).toEqual([
      { key: "result", title: "Lucro do mês", value: "R$ 3.500,00" },
      { key: "payables_week", title: "A pagar na semana", value: "R$ 120,00" },
      { key: "receivables_week", title: "A receber na semana", value: "R$ 300,00" },
      { key: "active_work", title: "Clientes ativos", value: "1" },
    ]);
    expect(container.querySelector("[data-chart='balance'] h2")?.textContent).toContain("Caixa do escritório");
  });

  it("comercial não vê números do financeiro nem de projetos; produtos vê só os trabalhos ativos, sem gráfico", async () => {
    const db = testDb();
    await seedMonth(db);
    await render("comercial");
    await settled();
    expect(container.querySelector("[data-overview]")).toBeNull();
    expect(container.querySelector("[data-chart='balance']")).toBeNull();
    act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";

    await render("produtos");
    await settled();
    await overviewLoaded();
    expect(overviewCards()).toEqual([{ key: "active_work", title: "Projetos ativos", value: "2" }]);
    expect(container.querySelector("[data-chart='balance']")).toBeNull();
  });
});

