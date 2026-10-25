// Ordens de serviço editadas direto na tabela: número automático, valores brasileiros (1.234,56 e 31/12/2025),
// concluir marca o encerramento, aba Calendário com os prazos e perfil sem permissão com os botões desabilitados.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { choose, click, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { insertTestCompany } from "@/test/sqlite";
import { todayIso } from "@/lib/utils";
import type { Role, WorkOrder } from "@/types";
import WorkOrdersPage from "./WorkOrdersPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;
let companyId: string;

beforeEach(async () => {
  const db = testDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["gerente", "auditor"] }));
  await db.execute("INSERT INTO work_orders (id, company_id, number, sla_due_at) VALUES ('wo-1', ?, 'OS-0007', ?)", [companyId, todayIso()]);
});

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

async function open(role: Role = "gerente") {
  page = await renderPage(<WorkOrdersPage />, { companyId, role, path: "/work-orders" });
  await until(() => page!.container.querySelector('tr[data-row-key="wo-1"]') !== null, "lista de OS");
  return page;
}

const table = () => page!.container.querySelector<HTMLElement>('[data-editable-table="work_orders"]')!;
const cell = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const order = async (where: string) => (await testDb().select<WorkOrder[]>(`SELECT * FROM work_orders WHERE ${where}`))[0];

describe("WorkOrdersPage — edição direto na tabela", () => {
  it("Adicionar sem número gera o próximo OS-NNNN e lê 1.234,56 e 31/12/2025", async () => {
    await open();
    await click(findButton(table(), "Adicionar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await type(cell("Mão de obra (nova linha)"), "1.234,56");
    await type(cell("Prazo (nova linha)"), "31/12/2025");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await order("number='OS-0008'")) !== undefined, "OS gravada");
    const created = await order("number='OS-0008'");
    expect(created).toMatchObject({ labor_cost: 1234.56, status: "aberta", priority: "media" });
    expect(String(created.sla_due_at).slice(0, 10)).toBe("2025-12-31");
  });

  it("concluir pela tabela marca o encerramento", async () => {
    await open();
    await click(findButton(table(), "Editar"));
    await choose(cell("Status (linha 1)"), "concluida");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await order("id='wo-1'")).status === "concluida", "status gravado");
    expect((await order("id='wo-1'")).closed_at).toBeTruthy();
  });

  it("aba Calendário mostra o prazo da OS em andamento; voltar para a Lista não perde o que foi digitado", async () => {
    await open();
    await click(findButton(table(), "Editar"));
    await type(cell("Mão de obra (linha 1)"), "250,00");
    await click(page!.container.querySelector("#tab-os-calendario"));
    await until(() => (page!.container.querySelector("#painel-os-calendario")?.textContent ?? "").includes("OS-0007"), "prazo no calendário");
    expect(table().closest("[hidden]")).not.toBeNull();

    await click(page!.container.querySelector("#tab-os-lista"));
    expect(table().closest("[hidden]")).toBeNull();
    expect(page!.container.querySelector("#painel-os-calendario")).toBeNull();
    expect(cell("Mão de obra (linha 1)")?.value).toBe("250,00");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await order("id='wo-1'")).labor_cost === 250, "mão de obra gravada");
  });

  it("auditor vê Editar e Adicionar desabilitados com o motivo", async () => {
    await open("auditor");
    expect(findButton(table(), "Editar")!.disabled).toBe(true);
    expect(findButton(table(), "Adicionar")!.disabled).toBe(true);
    expect(findButton(table(), "Editar")!.title).toMatch(/não tem permissão/);
  });
});
