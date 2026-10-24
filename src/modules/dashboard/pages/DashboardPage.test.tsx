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
    expect(widgetText("payroll.monthly")).toContain("2 colaboradores ativos");
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
