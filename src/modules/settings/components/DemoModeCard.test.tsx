// Configurações > Modo demonstração: switch só para CEO e Administração; ligar semeia, desligar pergunta e apaga só
// os dados de exemplo (leads ficam). Banco SQLite real (mockDb), seeds de verdade.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, type TestDb } from "@/test/sqlite";
import { click, findButton, renderPage, type RenderedPage } from "@/test/pageHarness";
import { confirmAction } from "@/lib/confirm";
import { isDemoMode } from "@/lib/demo/demoMode";
import { DEMO_EXCLUDED_TABLES } from "@/lib/demo/purge";
import { areaSeeds } from "@/lib/dev/seeds";
import type { Role } from "@/types";
import { DEMO_AREA_LABELS, DEMO_TABLE_LABELS, DemoModeCard } from "./DemoModeCard";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => false) }));

const testDb = useTestDb();
const COMPANY = "test-company";
let page: RenderedPage | null = null;

beforeEach(async () => {
  vi.mocked(confirmAction).mockReset().mockResolvedValue(false);
  await insertTestCompany(testDb(), { companyId: COMPANY });
});

afterEach(() => {
  page?.unmount();
  page = null;
});

/** Os seeds de verdade levam alguns segundos no jsdom: espera mais que o `until` do harness. */
async function eventually(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

async function open(role: Role): Promise<RenderedPage> {
  page = await renderPage(<DemoModeCard />, { companyId: COMPANY, role, path: "/settings" });
  return page;
}

const toggle = () => document.querySelector<HTMLButtonElement>("button[role=switch][aria-label='Modo demonstração']");
const count = async (db: TestDb, table: string) => (await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table}`))[0].n;

describe("DemoModeCard", () => {
  it("CEO liga (semeia) e desliga com confirmação (apaga os dados de exemplo e mantém os leads)", async () => {
    const db = testDb();
    await db.execute("INSERT INTO leads (id, company_id, name, status) VALUES ('lead-real', ?, 'Lead real', 'novo')", [COMPANY]);
    await open("ceo");
    await eventually(() => toggle()?.disabled === false, "switch liberado");
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");

    await click(toggle());
    await eventually(() => toggle()?.getAttribute("aria-checked") === "true" && toggle()?.disabled === false, "modo ligado");
    expect(page!.text()).toMatch(/registros de exemplo adicionados/);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(await count(db, "customers")).toBe(12);
    expect(await isDemoMode(db, COMPANY)).toBe(true);

    vi.mocked(confirmAction).mockResolvedValue(true);
    await click(toggle());
    await eventually(() => toggle()?.getAttribute("aria-checked") === "false" && toggle()?.disabled === false, "modo desligado");
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(page!.text()).toMatch(/registros de exemplo removidos/);
    expect(await count(db, "customers")).toBe(0);
    expect(await count(db, "leads")).toBe(1);
    expect(await isDemoMode(db, COMPANY)).toBe(false);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("se a pessoa desiste na confirmação, nada é apagado", async () => {
    const db = testDb();
    await open("admin");
    await eventually(() => toggle()?.disabled === false, "switch liberado");
    await click(toggle());
    await eventually(() => toggle()?.getAttribute("aria-checked") === "true" && toggle()?.disabled === false, "modo ligado");

    await click(toggle());
    await eventually(() => vi.mocked(confirmAction).mock.calls.length === 1, "confirmação");

    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    expect(await count(db, "customers")).toBe(12);
    expect(await isDemoMode(db, COMPANY)).toBe(true);
  });

  it("mostra quantos registros de exemplo ficaram presos a dados da pessoa", async () => {
    const db = testDb();
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('dev-customer-1', ?, 'PJ', 'Cliente exemplo')", [COMPANY]);
    await db.execute("INSERT INTO leads (id, company_id, name, status, customer_id) VALUES ('lead-real', ?, 'Lead real', 'novo', 'dev-customer-1')", [COMPANY]);
    await open("ceo");
    await eventually(() => /1 registro de exemplo/.test(page!.text()), "aviso do que sobrou");
    expect(page!.text()).toMatch(/clientes: 1/);
  });

  it("o aviso do que ficou dá o nome em português de cada tabela (ex.: recebimento de compra preso a uma baixa de verdade)", async () => {
    const db = testDb();
    await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES ('dev-supplier-x', ?, 'Fornecedor exemplo')", [COMPANY]);
    await db.execute("INSERT INTO purchase_orders (id, company_id, number, supplier_id) VALUES ('dev-po-x', ?, 1, 'dev-supplier-x')", [COMPANY]);
    await db.execute("INSERT INTO goods_receipts (id, company_id, number, purchase_order_id, supplier_id) VALUES ('dev-receipt-x', ?, 1, 'dev-po-x', 'dev-supplier-x')", [COMPANY]);
    await db.execute(
      "INSERT INTO payables (id, company_id, description, amount, supplier_id, purchase_order_id, goods_receipt_id, status) VALUES ('dev-payable-x', ?, 'Compra de exemplo', 500, 'dev-supplier-x', 'dev-po-x', 'dev-receipt-x', 'aberta')",
      [COMPANY],
    );
    // Baixa de verdade (uuid) numa conta de exemplo: a conta fica, e com ela o recebimento, o pedido e o fornecedor.
    await db.execute("INSERT INTO finance_settlements (id, company_id, payable_id, amount, paid_at) VALUES ('7d2e3f40-0000-4000-8000-000000000001', ?, 'dev-payable-x', 200, '2026-10-20')", [COMPANY]);
    await open("ceo");
    await eventually(() => /Ainda há 4 registros de exemplo/.test(page!.text()), "aviso do que sobrou");
    expect(page!.text()).toMatch(/recebimentos de compra: 1/);

    vi.mocked(confirmAction).mockResolvedValue(true);
    await click(findButton(document, "Remover agora"));
    await eventually(() => /ficaram porque dados seus apontam/.test(page!.text()), "resultado da limpeza");
    expect(page!.text()).toMatch(/recebimentos de compra: 1/);
    expect(page!.text()).not.toMatch(/goods|receipts|payables|purchase|suppliers/);
  });

  it("toda tabela que a limpeza alcança e toda área de exemplo têm nome em português", async () => {
    const db = testDb();
    const tables = await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const missing: string[] = [];
    for (const { name } of tables) {
      if ((DEMO_EXCLUDED_TABLES as readonly string[]).includes(name)) continue;
      const columns = (await db.select<{ name: string }[]>("SELECT name FROM pragma_table_info(?)", [name])).map((column) => column.name);
      if (columns.includes("id") && columns.includes("company_id") && !DEMO_TABLE_LABELS[name]) missing.push(name);
    }
    expect(missing, "tabela nova: dê a ela um nome em português em DEMO_TABLE_LABELS (DemoModeCard.tsx)").toEqual([]);
    expect(areaSeeds.map((area) => area.name).filter((name) => !DEMO_AREA_LABELS[name])).toEqual([]);
  });

  for (const role of ["gerente", "financeiro", "atendimento", "auditor"] as Role[]) {
    it(`não aparece para ${role}`, async () => {
      await open(role);
      expect(toggle()).toBeNull();
      expect(page!.text()).not.toMatch(/Modo demonstração/);
    });
  }
});
