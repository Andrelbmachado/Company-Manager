// @vitest-environment jsdom
// Telas de relatório com banco SQLite real: indicadores, abas, filtros e quem pode exportar.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addDays, monthOf } from "@/lib/reports/common";
import { todayIso } from "@/lib/utils";
import type { Role, Session } from "@/types";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

import AgingReportPage from "./AgingReportPage";
import DreReportPage from "./DreReportPage";
import ReportsPage from "./ReportsPage";
import SalesReportPage from "./SalesReportPage";
import StockReportPage from "./StockReportPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// O jsdom não tem ResizeObserver (o ResponsiveContainer do recharts usa); os gráficos não são conferidos aqui.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const C = "test-company";
const testDb = useTestDb();
let root: Root | null = null;
let container: HTMLDivElement;

function session(role: Role): Session {
  const stamp = "2026-01-01T00:00:00.000Z";
  return {
    user: { id: `test-user-${role}`, name: "Pessoa", email: "p@teste.local", status: "active", locale: "pt-BR", created_at: stamp, updated_at: stamp },
    membership: { id: "m-1", company_id: C, user_id: `test-user-${role}`, role, scope: "empresa", created_at: stamp, updated_at: stamp },
    company: { id: C, name: "Empresa Teste", settings_json: "{}", created_at: stamp, updated_at: stamp },
  } as Session;
}

async function render(page: ReactElement, role: Role) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <SessionContext.Provider value={{ session: session(role), setSession: () => undefined }}>{page}</SessionContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
}

async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}\n${container.textContent}`);
}

const text = () => container.textContent ?? "";
const buttons = () => Array.from(container.querySelectorAll("button"));
function button(label: string): HTMLButtonElement {
  const found = buttons().find((element) => (element.textContent ?? "").trim() === label || element.getAttribute("aria-label") === label);
  if (!found) throw new Error(`botão ${label} não encontrado`);
  return found;
}
async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

const today = todayIso();

beforeEach(async () => {
  const db = testDb();
  await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?), (?,?,?)", ["c1", C, "Alfa Ltda", "c2", C, "Beta ME"]);
  await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES (?,?,?)", ["s1", C, "Fornecedor Xis"]);
  await db.execute("INSERT INTO sales_orders (id, company_id, number, customer_id, seller_id, status, order_date, total) VALUES (?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?)", [
    "so1", C, 1, "c1", "test-user-comercial", "confirmado", today, 1500,
    "so2", C, 2, "c2", null, "entregue", today, 500,
  ]);
  await db.execute("INSERT INTO receivables (id, company_id, customer_id, description, amount, due_date, status) VALUES (?,?,?,?,?,?,?)", ["r1", C, "c1", "Parcela 1/2", 800, addDays(today, -40), "vencida"]);
  await db.execute("INSERT INTO payables (id, company_id, supplier_id, description, amount, due_date, status) VALUES (?,?,?,?,?,?,?)", ["p1", C, "s1", "Aluguel do galpão", 300, addDays(today, 5), "aberta"]);
  await db.execute("INSERT INTO finance_categories (id, company_id, code, name, kind, dre_group) VALUES (?,?,?,?,?,?)", ["cat1", C, "1.1", "Vendas", "receita", "receita"]);
  await db.execute("INSERT INTO receivables (id, company_id, description, amount, category_id, competence, status) VALUES (?,?,?,?,?,?,?)", ["r2", C, "Venda à vista", 2000, "cat1", monthOf(today), "recebida"]);
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES (?,?,?)", ["l1", C, "Depósito"]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, cost) VALUES (?,?,?,?), (?,?,?,?)", ["i1", C, "Cabo HDMI", 10, "i2", C, "Mouse parado", 20]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?,?,?,?,?), (?,?,?,?,?)", ["b1", C, "i1", "l1", 5, "b2", C, "i2", "l1", 3]);
  await db.execute("INSERT INTO stock_movements (id, company_id, item_id, type, quantity, from_location_id, created_at) VALUES (?,?,?,?,?,?,?)", ["m1", C, "i1", "saida", 2, "l1", new Date().toISOString()]);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("relatório de vendas", () => {
  it("mostra indicadores, troca de visão e oferece exportação para quem pode exportar", async () => {
    await render(<SalesReportPage />, "gerente");
    await until(() => text().includes("Ticket médio"), "indicadores");
    expect(container.querySelector("h1")?.textContent).toBe("Relatório de vendas");
    expect(text()).toMatch(/R\$\s2\.000,00/);
    await click(button("Por cliente"));
    await until(() => text().includes("Alfa Ltda"), "tabela por cliente");
    expect(text()).toContain("75,0%");
    await click(button("Por vendedor"));
    await until(() => text().includes("Teste comercial"), "tabela por vendedor");
    expect(text()).toContain("Sem vendedor");
    expect(buttons().some((element) => element.textContent?.includes("Excel"))).toBe(true);
  });

  it("comercial vê o relatório, mas não exporta", async () => {
    await render(<SalesReportPage />, "comercial");
    await until(() => text().includes("Ticket médio"), "indicadores");
    expect(buttons().some((element) => element.textContent?.includes("CSV"))).toBe(false);
  });
});

describe("contas a receber e a pagar", () => {
  it("aging a receber por faixa e troca para a pagar", async () => {
    await render(<AgingReportPage />, "financeiro");
    await until(() => text().includes("Vencido"), "indicadores");
    expect(container.querySelector("h1")?.textContent).toBe("Contas a receber e a pagar");
    expect(text()).toContain("31 a 60 dias");
    await click(button("Títulos"));
    await until(() => text().includes("Parcela 1/2"), "títulos a receber");
    await click(button("A pagar"));
    await until(() => text().includes("Aluguel do galpão"), "títulos a pagar");
    expect(text()).toContain("Fornecedor Xis");
  });
});

describe("giro de estoque", () => {
  it("lista o giro e filtra só os itens parados", async () => {
    await render(<StockReportPage />, "estoquista");
    await until(() => text().includes("Cabo HDMI"), "tabela");
    expect(container.querySelector("h1")?.textContent).toBe("Giro de estoque");
    expect(text()).toContain("Mouse parado");
    const onlyIdle = container.querySelector<HTMLInputElement>("#estoque-parados")!;
    await click(onlyIdle);
    await until(() => !text().includes("Cabo HDMI"), "filtro de parados");
    expect(text()).toContain("Mouse parado");
  });
});

describe("DRE", () => {
  it("mostra a estrutura com o mês atual", async () => {
    await render(<DreReportPage />, "financeiro");
    await until(() => text().includes("Resultado líquido"), "DRE");
    expect(container.querySelector("h1")?.textContent).toBe("DRE");
    expect(text()).toContain("1.1 Vendas");
    expect(text()).toContain("Receita bruta");
  });
});

describe("visão geral", () => {
  it("só mostra os relatórios que o papel pode abrir", async () => {
    await render(<ReportsPage />, "comercial");
    const links = () => Array.from(container.querySelectorAll("a")).map((link) => link.textContent ?? "");
    expect(links().some((label) => label.includes("Vendas"))).toBe(true);
    expect(links().some((label) => label.includes("DRE"))).toBe(false);
    act(() => root!.unmount());
    root = null;

    await render(<ReportsPage />, "estoquista");
    expect(links().some((label) => label.includes("Giro de estoque"))).toBe(true);
    expect(links().some((label) => label.includes("Vendas"))).toBe(false);
  });
});
