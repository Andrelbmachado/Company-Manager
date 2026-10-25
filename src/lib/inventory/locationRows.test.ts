// Locais de estoque pela tabela editável: nome único (também entre linhas novas), linha nova com o id da tela, nada
// gravado se uma linha tem erro e permissão conferida na camada de dados.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { StockLocation } from "@/types";
import { archiveLocationRow, saveLocationRows } from "./locations";
import { PermissionError } from "./permission";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let companyId: string;
const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await seedStockFixture(db));
});

const locations = async () => db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]);

describe("saveLocationRows", () => {
  it("edita o que mudou e cria a linha nova com o id da tela (sem duplicar ao salvar de novo)", async () => {
    const changes = {
      updated: [{ id: "loc-b", address: "Rua XV, 100" }],
      created: [{ id: "loc-novo", name: " Van  01 ", type: "veiculo", address: null }],
    };
    const result = await saveLocationRows(db, companyId, estoquista, changes);
    expect(result).toEqual({ created: [{ id: "loc-novo", name: "Van 01" }], updated: [{ id: "loc-b", name: "Loja" }] });
    await saveLocationRows(db, companyId, estoquista, { updated: [], created: changes.created });
    expect((await locations()).map((row) => [row.id, row.name, row.type, row.address])).toEqual([
      ["loc-a", "Depósito Central", "deposito", null],
      ["loc-b", "Loja", "loja", "Rua XV, 100"],
      ["loc-novo", "Van 01", "veiculo", null],
    ]);
  });

  it("nome vazio ou repetido (sem diferenciar maiúsculas e acentos, inclusive entre linhas novas): nada é gravado", async () => {
    await expect(saveLocationRows(db, companyId, estoquista, { updated: [{ id: "loc-a", name: "" }], created: [] })).rejects.toThrow("Informe o nome do local.");
    await expect(
      saveLocationRows(db, companyId, estoquista, { updated: [{ id: "loc-b", address: "Centro" }], created: [{ id: "n1", name: "deposito central" }] }),
    ).rejects.toThrow('Já existe um local chamado "deposito central".');
    await expect(saveLocationRows(db, companyId, estoquista, { updated: [], created: [{ id: "n1", name: "Galpão" }, { id: "n2", name: "galpao" }] })).rejects.toThrow(/Já existe um local/);
    expect((await locations()).map((row) => row.address)).toEqual([null, null]);
    expect(await locations()).toHaveLength(2);
    // Trocar os nomes de dois locais numa gravação só vale.
    await saveLocationRows(db, companyId, estoquista, { updated: [{ id: "loc-a", name: "Loja" }, { id: "loc-b", name: "Depósito Central" }], created: [] });
    expect((await locations()).map((row) => row.id)).toEqual(["loc-b", "loc-a"]);
  });

  it("arquiva só local vazio, com permissão de excluir", async () => {
    await expect(archiveLocationRow(db, companyId, estoquista, "loc-a")).rejects.toThrow(/ainda tem/);
    await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-c', ?, 'Vazio')", [companyId]);
    await expect(archiveLocationRow(db, companyId, { role: "gerente", userId: "test-user-gerente" }, "loc-c")).rejects.toBeInstanceOf(PermissionError);
    await archiveLocationRow(db, companyId, estoquista, "loc-c");
    expect((await locations()).map((row) => row.id)).toEqual(["loc-a", "loc-b"]);
  });

  it("permissão na camada de dados: quem só consulta o estoque não grava", async () => {
    for (const role of ["gerente", "auditor", "tecnico"] as const) {
      const actor = { role, userId: `test-user-${role}` };
      await expect(saveLocationRows(db, companyId, actor, { updated: [{ id: "loc-a", name: "X" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
      await expect(saveLocationRows(db, companyId, actor, { updated: [], created: [{ id: "x", name: "X" }] })).rejects.toBeInstanceOf(PermissionError);
    }
    expect((await locations()).map((row) => row.name)).toEqual(["Depósito Central", "Loja"]);
  });
});
