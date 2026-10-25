// Custódia de peça pela tabela editável: retirada com o id da tela (sem duplicar), devolução marca a data, tudo
// conferido antes de gravar e a permissão na camada de dados.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { Custody } from "@/types";
import { custodyCalendarItems, deleteCustody, listCustodies, saveCustodyRows } from "./custody";
import { PermissionError } from "./permission";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let companyId: string;
const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await seedStockFixture(db));
});

const all = async () => db.select<Custody[]>("SELECT * FROM custodies WHERE company_id=? ORDER BY created_at, id", [companyId]);

describe("saveCustodyRows", () => {
  it("registra a retirada com o id da tela, o responsável padrão (quem grava) e sem duplicar ao salvar de novo", async () => {
    const changes = { updated: [], created: [{ id: "cus-1", item_id: "item-1", quantity: 2, due_back_at: "2026-11-10" }] };
    expect(await saveCustodyRows(db, companyId, estoquista, changes)).toEqual({ created: ["cus-1"], updated: [] });
    await saveCustodyRows(db, companyId, estoquista, changes);
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "cus-1", item_id: "item-1", holder_id: "test-user-estoquista", quantity: 2, status: "em_custodia", due_back_at: "2026-11-10", returned_at: null });
    const [view] = await listCustodies(db, companyId);
    expect(view).toMatchObject({ id: "cus-1", item_name: "Cabo Cat6", holder_name: "Teste estoquista" });
  });

  it("uma linha com erro e nada é gravado", async () => {
    const ok = { id: "ok", item_id: "item-1", quantity: 1 };
    const save = (row: Record<string, unknown>) => saveCustodyRows(db, companyId, estoquista, { updated: [], created: [ok, { id: "x", item_id: "item-2", quantity: 1, ...row }] });
    await expect(save({ item_id: null })).rejects.toThrow(/Linha nova 2: escolha o item/);
    await expect(save({ quantity: 0 })).rejects.toThrow(/maior que zero/);
    await expect(save({ holder_id: "fora-da-empresa" })).rejects.toThrow(/não faz parte da empresa/);
    await expect(save({ status: "sumido" })).rejects.toThrow(/Status inválido/);
    await expect(save({ due_back_at: "2026-02-30" })).rejects.toThrow(/devolução prevista inválida/);
    await expect(save({ work_order_id: "os-de-outra" })).rejects.toThrow(/Ordem de serviço não encontrada/);
    expect(await all()).toHaveLength(0);
  });

  it("devolvido marca a devolução; voltar para em custódia limpa; só os campos alterados mudam", async () => {
    await saveCustodyRows(db, companyId, estoquista, { updated: [], created: [{ id: "cus-1", item_id: "item-3", quantity: 1, due_back_at: "2026-11-10" }] });
    await saveCustodyRows(db, companyId, estoquista, { updated: [{ id: "cus-1", status: "devolvido" }], created: [] });
    let [row] = await all();
    expect(row.status).toBe("devolvido");
    expect(row.returned_at).toBeTruthy();
    expect(row.due_back_at).toBe("2026-11-10");
    await saveCustodyRows(db, companyId, estoquista, { updated: [{ id: "cus-1", status: "em_custodia", quantity: 3 }], created: [] });
    [row] = await all();
    expect(row).toMatchObject({ status: "em_custodia", returned_at: null, quantity: 3, item_id: "item-3" });
  });

  it("permissão na camada de dados (gerente e técnico só consultam; excluir exige delete)", async () => {
    await saveCustodyRows(db, companyId, estoquista, { updated: [], created: [{ id: "cus-1", item_id: "item-1", quantity: 1 }] });
    for (const role of ["gerente", "tecnico", "auditor"] as const) {
      const actor = { role, userId: `test-user-${role}` };
      await expect(saveCustodyRows(db, companyId, actor, { updated: [], created: [{ id: "n", item_id: "item-1", quantity: 1 }] })).rejects.toBeInstanceOf(PermissionError);
      await expect(saveCustodyRows(db, companyId, actor, { updated: [{ id: "cus-1", quantity: 5 }], created: [] })).rejects.toBeInstanceOf(PermissionError);
      await expect(deleteCustody(db, companyId, actor, "cus-1")).rejects.toBeInstanceOf(PermissionError);
    }
    await deleteCustody(db, companyId, estoquista, "cus-1");
    expect((await all())[0].deleted_at).toBeTruthy();
    expect(await listCustodies(db, companyId)).toEqual([]);
  });
});

describe("custodyCalendarItems", () => {
  it("só o que está em custódia e tem devolução prevista; atrasado em vermelho", () => {
    const base = { company_id: companyId, holder_id: "u", quantity: 1, checked_out_at: "2026-10-01", created_at: "", updated_at: "", item_name: "Cabo", holder_name: "Ana" };
    const items = custodyCalendarItems(
      [
        { ...base, id: "a", status: "em_custodia", due_back_at: "2026-10-20" },
        { ...base, id: "b", status: "em_custodia", due_back_at: "2026-10-30T12:00:00.000Z" },
        { ...base, id: "c", status: "devolvido", due_back_at: "2026-10-30" },
        { ...base, id: "d", status: "em_custodia", due_back_at: null },
      ],
      new Date("2026-10-25T12:00:00Z"),
    );
    expect(items.map((item) => [item.id, item.start, item.allDay, item.title])).toEqual([
      ["a", "2026-10-20", true, "Cabo · Ana"],
      ["b", "2026-10-30", true, "Cabo · Ana"],
    ]);
    expect(items[0].color).not.toBe(items[1].color);
  });
});
