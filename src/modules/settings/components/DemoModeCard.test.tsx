// Configurações > Modo demonstração: switch só para CEO e Administração; ligar semeia, desligar pergunta e apaga só
// os dados de exemplo (leads ficam). Banco SQLite real (mockDb), seeds de verdade.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, type TestDb } from "@/test/sqlite";
import { click, renderPage, type RenderedPage } from "@/test/pageHarness";
import { confirmAction } from "@/lib/confirm";
import { isDemoMode } from "@/lib/demo/demoMode";
import type { Role } from "@/types";
import { DemoModeCard } from "./DemoModeCard";

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

  for (const role of ["gerente", "financeiro", "atendimento", "auditor"] as Role[]) {
    it(`não aparece para ${role}`, async () => {
      await open(role);
      expect(toggle()).toBeNull();
      expect(page!.text()).not.toMatch(/Modo demonstração/);
    });
  }
});
