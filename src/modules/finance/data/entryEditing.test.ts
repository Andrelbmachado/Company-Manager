// Gravação da tabela de contas: permissão conferida na camada de dados, só os campos alterados mudam, parcelas só
// ao adicionar e nenhuma gravação quando uma das linhas tem erro.
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addPayable, addReceivable } from "@/test/financeFixtures";
import type { Role } from "@/types";
import { saveEntryChanges } from "./entryEditing";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
type Row = Record<string, unknown>;

async function setup(role: Role = "financeiro") {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { companyId: "empresa-contas", roles: [role] });
  await addPayable(db, companyId, { id: "p1", description: "Aluguel", amount: 1000, due_date: "2099-01-10", document_number: "NF-1" });
  await addReceivable(db, companyId, { id: "r1", description: "Projeto", amount: 500, due_date: "2099-01-20" });
  return { db, ctx: { companyId, role, userId: `test-user-${role}` } };
}

const row = async (table: string, id: string) => (await testDb().select<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0];

describe("saveEntryChanges", () => {
  it("grava só os campos alterados e cria parcelas ao adicionar", async () => {
    const { db, ctx } = await setup();
    await saveEntryChanges(db, ctx, "payable", {
      updated: [{ id: "p1", amount: 1234.56, due_date: "2099-02-15" }],
      created: [{ description: "Notebook", amount: 1000, due_date: "2099-01-31", installments: 3, payment_method: "boleto" }],
    });
    expect(await row("payables", "p1")).toMatchObject({ description: "Aluguel", amount: 1234.56, due_date: "2099-02-15", document_number: "NF-1" });
    const parcels = await db.select<Row[]>("SELECT * FROM payables WHERE description LIKE 'Notebook%' ORDER BY installment_number");
    expect(parcels.map((item) => [item.description, item.amount, item.due_date, item.payment_method])).toEqual([
      ["Notebook (1/3)", 333.33, "2099-01-31", "boleto"],
      ["Notebook (2/3)", 333.33, "2099-02-28", "boleto"],
      ["Notebook (3/3)", 333.34, "2099-03-31", "boleto"],
    ]);
  });

  it("papel sem permissão é barrado antes de gravar", async () => {
    const { db, ctx } = await setup("auditor");
    await expect(saveEntryChanges(db, ctx, "receivable", { updated: [{ id: "r1", amount: 1 }], created: [] })).rejects.toThrow(/permissão para editar/);
    await expect(saveEntryChanges(db, ctx, "receivable", { updated: [], created: [{ description: "X", amount: 10 }] })).rejects.toThrow(/permissão para adicionar/);
    expect(await row("receivables", "r1")).toMatchObject({ amount: 500 });
  });

  it("gerente aprova contas a pagar mas não edita pela tabela", async () => {
    const { db, ctx } = await setup("gerente");
    await expect(saveEntryChanges(db, ctx, "payable", { updated: [{ id: "p1", description: "Outro" }], created: [] })).rejects.toThrow(/permissão/);
  });

  it("linha com erro não deixa as outras gravarem pela metade", async () => {
    const { db, ctx } = await setup();
    await expect(
      saveEntryChanges(db, ctx, "payable", {
        updated: [{ id: "p1", description: "Aluguel novo" }],
        created: [{ description: "Sem valor", amount: 0 }],
      }),
    ).rejects.toThrow("Sem valor: informe um valor maior que zero.");
    expect(await row("payables", "p1")).toMatchObject({ description: "Aluguel" });

    await expect(saveEntryChanges(db, ctx, "payable", { updated: [{ id: "p1", installments: 2 }], created: [] })).rejects.toThrow(/parcelas só ao adicionar/);
    await expect(saveEntryChanges(db, ctx, "payable", { updated: [{ id: "p1", competence: "10/2026" }], created: [] })).rejects.toThrow(/AAAA-MM/);
  });

  it("conta com baixa não fica abaixo do pago e conta cancelada não se edita", async () => {
    const { db, ctx } = await setup();
    await db.execute("UPDATE payables SET paid_amount = 400, status = 'paga_parcial' WHERE id = 'p1'");
    await expect(saveEntryChanges(db, ctx, "payable", { updated: [{ id: "p1", amount: 300 }], created: [] })).rejects.toThrow(/abaixo do já pago/);
    await db.execute("UPDATE receivables SET status = 'cancelada' WHERE id = 'r1'");
    await expect(saveEntryChanges(db, ctx, "receivable", { updated: [{ id: "r1", notes: "x" }], created: [] })).rejects.toThrow(/cancelada/);
  });
});
