// Ordens de serviço pela tabela editável: número automático (próximo OS-NNNN livre), conclusão marca a data, tudo
// conferido antes de gravar e a permissão na camada de dados.
import { beforeEach, describe, expect, it } from "vitest";
import { PermissionError } from "@/lib/inventory/permission";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { WorkOrder } from "@/types";
import { listWorkOrders, nextWorkOrderNumber, saveWorkOrderRows, workOrderCalendarItems } from "./workOrders";

let db: TestDb;
let companyId: string;
const gerente = { role: "gerente" as const, userId: "test-user-gerente" };

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["gerente", "tecnico", "atendimento", "estoquista"] }));
  await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('cli-1', ?, 'pj', 'Padaria Sol')", [companyId]);
});

const all = async () => db.select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=? ORDER BY number", [companyId]);

describe("nextWorkOrderNumber", () => {
  it("próximo número livre depois do maior OS-NNNN (ignora números fora do padrão)", () => {
    expect(nextWorkOrderNumber([])).toBe("OS-0001");
    expect(nextWorkOrderNumber(["OS-0001", "OS-0007", "Especial", "os-0003"])).toBe("OS-0008");
    expect(nextWorkOrderNumber(["OS-9999"])).toBe("OS-10000");
  });
});

describe("saveWorkOrderRows", () => {
  it("cria com número automático e o id da tela; salvar de novo não duplica; número digitado vale", async () => {
    const changes = {
      updated: [],
      created: [
        { id: "wo-a", customer_id: "cli-1", priority: "alta", sla_due_at: "2026-11-05", labor_cost: 150.5 },
        { id: "wo-b", number: " os-especial ", technician_id: "test-user-tecnico" },
        { id: "wo-c" },
      ],
    };
    expect((await saveWorkOrderRows(db, companyId, gerente, changes)).created).toEqual(["wo-a", "wo-b", "wo-c"]);
    await saveWorkOrderRows(db, companyId, gerente, changes);
    const rows = await all();
    expect(rows.map((row) => [row.id, row.number, row.status, row.priority, row.technician_id ?? null])).toEqual([
      ["wo-a", "OS-0001", "aberta", "alta", null],
      ["wo-c", "OS-0002", "aberta", "media", null],
      ["wo-b", "os-especial", "aberta", "media", "test-user-tecnico"],
    ]);
    expect(rows[0]).toMatchObject({ customer_id: "cli-1", sla_due_at: "2026-11-05", labor_cost: 150.5, materials_cost: 0 });
    const [view] = (await listWorkOrders(db, companyId)).filter((row) => row.id === "wo-a");
    expect(view).toMatchObject({ customer_name: "Padaria Sol", total_cost: 150.5 });
  });

  it("número repetido (também de OS excluída), status, prioridade, custo negativo e data inválida: nada é gravado", async () => {
    await db.execute("INSERT INTO work_orders (id, company_id, number, deleted_at) VALUES ('old', ?, 'OS-0001', datetime('now'))", [companyId]);
    const save = (row: Record<string, unknown>) => saveWorkOrderRows(db, companyId, gerente, { updated: [], created: [{ id: "ok" }, { id: "x", ...row }] });
    await expect(save({ number: "os-0001" })).rejects.toThrow(/Já existe a OS os-0001/i);
    await expect(save({ status: "parada" })).rejects.toThrow(/Status inválido/);
    await expect(save({ priority: "altissima" })).rejects.toThrow(/Prioridade inválida/);
    await expect(save({ materials_cost: -1 })).rejects.toThrow(/não pode ser negativo/);
    await expect(save({ sla_due_at: "2026-13-01" })).rejects.toThrow(/Prazo inválido/);
    await expect(save({ customer_id: "cli-x" })).rejects.toThrow(/Cliente não encontrado/);
    await expect(save({ technician_id: "fora" })).rejects.toThrow(/não faz parte da empresa/);
    expect((await all()).filter((row) => !row.deleted_at)).toHaveLength(0);
    await saveWorkOrderRows(db, companyId, gerente, { updated: [], created: [{ id: "n1" }] });
    expect((await all()).find((row) => row.id === "n1")?.number).toBe("OS-0002");
  });

  it("concluída ou cancelada marca o encerramento; reabrir limpa; só os campos alterados mudam", async () => {
    await saveWorkOrderRows(db, companyId, gerente, { updated: [], created: [{ id: "wo-a", labor_cost: 10, materials_cost: 5 }] });
    await saveWorkOrderRows(db, companyId, gerente, { updated: [{ id: "wo-a", status: "concluida" }], created: [] });
    let [row] = await all();
    expect(row.status).toBe("concluida");
    expect(row.closed_at).toBeTruthy();
    expect(row).toMatchObject({ labor_cost: 10, materials_cost: 5 });
    await saveWorkOrderRows(db, companyId, gerente, { updated: [{ id: "wo-a", status: "em_execucao", number: "OS-0042" }], created: [] });
    [row] = await all();
    expect(row).toMatchObject({ status: "em_execucao", closed_at: null, number: "OS-0042" });
    await expect(saveWorkOrderRows(db, companyId, gerente, { updated: [{ id: "wo-a", number: "  " }], created: [] })).rejects.toThrow(/Informe o número/);
  });

  it("permissão: técnico edita mas não cria; atendimento cria mas não edita; estoquista nada", async () => {
    await saveWorkOrderRows(db, companyId, gerente, { updated: [], created: [{ id: "wo-a" }] });
    const tecnico = { role: "tecnico" as const, userId: "test-user-tecnico" };
    const atendimento = { role: "atendimento" as const, userId: "test-user-atendimento" };
    const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };
    await saveWorkOrderRows(db, companyId, tecnico, { updated: [{ id: "wo-a", status: "em_execucao" }], created: [] });
    await expect(saveWorkOrderRows(db, companyId, tecnico, { updated: [], created: [{ id: "n" }] })).rejects.toBeInstanceOf(PermissionError);
    await saveWorkOrderRows(db, companyId, atendimento, { updated: [], created: [{ id: "wo-b" }] });
    await expect(saveWorkOrderRows(db, companyId, atendimento, { updated: [{ id: "wo-a", priority: "alta" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
    await expect(saveWorkOrderRows(db, companyId, estoquista, { updated: [{ id: "wo-a", priority: "alta" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
    expect((await all()).map((row) => [row.id, row.status, row.priority])).toEqual([
      ["wo-a", "em_execucao", "media"],
      ["wo-b", "aberta", "media"],
    ]);
  });
});

describe("workOrderCalendarItems", () => {
  it("OS em andamento com prazo, por dia; encerrada fica de fora; atrasada em vermelho", () => {
    const base = { company_id: "c", opened_at: "", checklist_json: "[]", labor_cost: 0, materials_cost: 0, created_at: "", updated_at: "", priority: "media" as const, customer_name: "Padaria Sol", technician_name: null, total_cost: 0 };
    const items = workOrderCalendarItems(
      [
        { ...base, id: "a", number: "OS-0001", status: "aberta", sla_due_at: "2026-10-20" },
        { ...base, id: "b", number: "OS-0002", status: "em_execucao", sla_due_at: "2026-10-28 15:00:00" },
        { ...base, id: "c", number: "OS-0003", status: "concluida", sla_due_at: "2026-10-28" },
        { ...base, id: "d", number: "OS-0004", status: "aberta", sla_due_at: null },
      ],
      new Date("2026-10-25T12:00:00Z"),
    );
    expect(items.map((item) => [item.id, item.start, item.title])).toEqual([
      ["a", "2026-10-20", "OS-0001 · Padaria Sol"],
      ["b", "2026-10-28", "OS-0002 · Padaria Sol"],
    ]);
    expect(items[0].color).not.toBe(items[1].color);
  });
});
