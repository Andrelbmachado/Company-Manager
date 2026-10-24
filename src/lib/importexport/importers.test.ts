// @vitest-environment jsdom
// Os 12 importers ponta a ponta: o modelo baixado importa sem erro, a exportação (CSV e XLSX) volta pela importação
// sem duplicar nada, no SQLite real e no banco demo do navegador. Mais as regras próprias de estoque e contas.
import { v4 as uuidv4 } from "uuid";
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { createTestDb, insertTestCompany } from "@/test/sqlite";
import { exportRows, templateFor, type ExportFormat } from "./export";
import { decodeText, parseFile, readBytes } from "./parse";
import { registry, type ImportEntity } from "./registry";
import { runImport, suggestMapping, type ImportResult } from "./runImport";

type Row = Record<string, unknown>;

beforeEach(() => localStorage.clear());

const KEYS = ["contacts", "customers", "employees", "inventory", "leads", "opportunities", "payables", "products", "projects", "receivables", "suppliers", "tickets"];

const TABLE: Record<string, string> = { inventory: "inventory_items" };
const tableOf = (key: string) => TABLE[key] ?? key;

/** Chaves do objeto zod (por baixo de superRefine/transform). */
function schemaKeys(schema: unknown): string[] {
  let current = schema as { _def?: { schema?: unknown }; shape?: Record<string, unknown> };
  while (current?._def?.schema) current = current._def.schema as typeof current;
  return Object.keys(current.shape ?? {});
}

async function insert(db: DatabaseLike, table: string, row: Row) {
  const columns = Object.keys(row);
  await db.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, Object.values(row));
}

/** Cadastros que os exemplos dos modelos citam (cliente, fornecedor, categorias, centro de custo, local). */
async function seedReferences(db: DatabaseLike, companyId: string) {
  await insert(db, "customers", { id: uuidv4(), company_id: companyId, name: "Padaria Pão Quente Ltda", document: "11.222.333/0001-81", type: "PJ" });
  await insert(db, "suppliers", { id: uuidv4(), company_id: companyId, name: "Distribuidora Central Ltda", document: "11.444.777/0001-61" });
  await insert(db, "finance_categories", { id: uuidv4(), company_id: companyId, name: "Aluguel", kind: "despesa" });
  await insert(db, "finance_categories", { id: uuidv4(), company_id: companyId, name: "Serviços", kind: "receita" });
  await insert(db, "cost_centers", { id: uuidv4(), company_id: companyId, name: "Administrativo" });
  await insert(db, "cost_centers", { id: uuidv4(), company_id: companyId, name: "Comercial" });
  const locations = await db.select<Row[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  if (!locations.some((location) => location.name === "Depósito principal")) {
    await insert(db, "stock_locations", { id: uuidv4(), company_id: companyId, name: "Depósito principal" });
  }
}

const count = async (db: DatabaseLike, table: string, companyId: string) =>
  (await db.select<Row[]>(`SELECT * FROM ${table} WHERE company_id=?${table === "stock_balances" || table === "stock_movements" ? "" : " AND deleted_at IS NULL"}`, [companyId])).length;

/** Importa um arquivo como a tela faz: lê, sugere o mapeamento pelos cabeçalhos e grava. */
async function importFile(
  entity: ImportEntity<unknown>,
  blob: Blob,
  name: string,
  db: DatabaseLike,
  companyId: string,
  userId: string | null,
  mode: "all-or-nothing" | "skip-errors" = "all-or-nothing",
): Promise<ImportResult> {
  const parsed = await parseFile(new File([blob], name));
  const [sheet] = parsed.sheets;
  const mapping = suggestMapping(entity, sheet.headers);
  return runImport(entity, mapping, sheet.rows, { db, companyId, userId, mode, dryRun: false, filename: name, format: parsed.format, rowNumbers: sheet.rowNumbers });
}

/** O demo traz fornecedores com CNPJ de mentira: a reimportação aponta (e pula) essas linhas, como faria com dado real. */
const KNOWN_DEMO_ERRORS = /^CPF\/CNPJ inválido/;

const textOf = async (blob: Blob) => decodeText(await readBytes(blob));

describe("registro: as 12 entidades", () => {
  it("existem, e o schema de cada uma tem exatamente os campos declarados", () => {
    expect(Object.keys(registry).sort()).toEqual(KEYS);
    for (const key of KEYS) {
      const entity = registry[key];
      expect(schemaKeys(entity.schema).sort(), key).toEqual(entity.fields.map((field) => field.key).sort());
      expect(entity.exportData, key).toBeTypeOf("function");
      for (const field of entity.fields) {
        if (field.kind === "enum") expect(field.options?.length, `${key}.${field.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("o cabeçalho do modelo é reconhecido inteiro pela sugestão de mapeamento", async () => {
    for (const key of KEYS) {
      const entity = registry[key];
      const parsed = await parseFile(new File([await templateFor(key, "csv")], "modelo.csv"));
      expect(parsed.sheets[0].headers, key).toEqual(entity.fields.map((field) => field.label));
      expect(suggestMapping(entity, parsed.sheets[0].headers), key).toEqual(Object.fromEntries(entity.fields.map((field) => [field.key, field.label])));
    }
  });
});

const backends: { name: string; open: () => Promise<{ db: DatabaseLike; companyId: string; userId: string | null }> }[] = [
  {
    name: "SQLite",
    open: async () => {
      const db = await createTestDb();
      const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo"] });
      return { db, companyId, userId: userIds.ceo! };
    },
  },
  { name: "demo", open: async () => ({ db: createDemoDb(), companyId: DEMO_COMPANY_ID, userId: null }) },
];

for (const backend of backends) {
  describe(`modelo → importação → exportação → reimportação (${backend.name})`, () => {
    for (const key of KEYS) {
      it(key, async () => {
        const { db, companyId, userId } = await backend.open();
        await seedReferences(db, companyId);
        const entity = registry[key];
        const table = tableOf(key);
        const before = await count(db, table, companyId);

        for (const format of ["csv", "xlsx"] as ExportFormat[]) {
          const result = await importFile(entity, await templateFor(key, format), `modelo.${format}`, db, companyId, userId);
          expect(result.errors, `${key} modelo ${format}`).toEqual([]);
          expect(result.inserted + result.updated, `${key} modelo ${format}`).toBe(1);
        }
        const afterTemplate = await count(db, table, companyId);
        expect(afterTemplate - before).toBeLessThanOrEqual(1);

        for (const format of ["csv", "xlsx"] as ExportFormat[]) {
          const exported = await exportRows(key, format, { db, companyId });
          const demo = backend.name === "demo";
          const result = await importFile(entity, exported, `exportado.${format}`, db, companyId, userId, demo ? "skip-errors" : "all-or-nothing");
          const errors = demo ? result.errors.filter((error) => !KNOWN_DEMO_ERRORS.test(error.message)) : result.errors;
          expect(errors, `${key} reimportação ${format}`).toEqual([]);
          expect(result.inserted, `${key} reimportação ${format}`).toBe(0);
          expect(await count(db, table, companyId), `${key} reimportação ${format}`).toBe(afterTemplate);
        }
      }, 20_000);
    }
  });
}

// ── regras próprias ───────────────────────────────────────────────

async function sqliteCompany() {
  const db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo"] });
  return { db, companyId, userId: userIds.ceo! };
}

const run = (key: string, mapping: Record<string, string>, rows: Row[], db: DatabaseLike, companyId: string, userId: string | null, mode: "all-or-nothing" | "skip-errors" = "all-or-nothing") =>
  runImport(key, mapping, rows as Record<string, string>[], { db, companyId, userId, mode, dryRun: false });

describe("estoque", () => {
  const MAPPING = { name: "Item", sku: "SKU", quantity: "Qtd", location: "Local", cost: "Custo" };

  it("quantidade vira saldo por local e a diferença vira movimento de ajuste ligado ao lote", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const main = uuidv4();
    const store = uuidv4();
    await insert(db, "stock_locations", { id: main, company_id: companyId, name: "Depósito principal" });
    await insert(db, "stock_locations", { id: store, company_id: companyId, name: "Loja" });

    const first = await run("inventory", MAPPING, [
      { Item: "Papel A4", SKU: "PAP-A4", Qtd: "40", Local: "Depósito principal", Custo: "24,90" },
      { Item: "Papel A4", SKU: "PAP-A4", Qtd: "5", Local: "Loja", Custo: "" },
      { Item: "Caneta azul", SKU: "CAN-AZ", Qtd: "", Local: "", Custo: "1,50" },
    ], db, companyId, userId);
    expect(first).toMatchObject({ errors: [], inserted: 3, updated: 0 });
    const items = await db.select<Row[]>("SELECT * FROM inventory_items WHERE company_id=? ORDER BY sku", [companyId]);
    expect(items.map((item) => [item.sku, item.cost])).toEqual([["CAN-AZ", 1.5], ["PAP-A4", 24.9]]);
    const paper = items.find((item) => item.sku === "PAP-A4")!;
    const balances = await db.select<Row[]>("SELECT * FROM stock_balances WHERE item_id=? ORDER BY quantity", [paper.id]);
    expect(balances.map((balance) => [balance.location_id, balance.quantity])).toEqual([[store, 5], [main, 40]]);
    let movements = await db.select<Row[]>("SELECT * FROM stock_movements WHERE item_id=? ORDER BY quantity", [paper.id]);
    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({ type: "ajuste", quantity: 40, to_location_id: main, from_location_id: null, ref_type: "import", ref_id: first.batchId, user_id: userId, unit_cost: 24.9 });

    // Recontagem: 25 no depósito (saem 15), loja igual (sem movimento).
    const second = await run("inventory", MAPPING, [
      { Item: "Papel A4", SKU: "pap-a4", Qtd: "25", Local: "depósito principal", Custo: "" },
      { Item: "Papel A4", SKU: "PAP-A4", Qtd: "5", Local: "Loja", Custo: "" },
    ], db, companyId, userId);
    expect(second).toMatchObject({ errors: [], inserted: 0, updated: 2 });
    expect((await db.select<Row[]>("SELECT * FROM stock_balances WHERE item_id=? AND location_id=?", [paper.id, main]))[0].quantity).toBe(25);
    movements = await db.select<Row[]>("SELECT * FROM stock_movements WHERE item_id=? AND ref_id=?", [paper.id, second.batchId]);
    expect(movements).toEqual([expect.objectContaining({ type: "ajuste", quantity: 15, from_location_id: main, to_location_id: null })]);
    expect(await count(db, "inventory_items", companyId)).toBe(2);
  });

  it("aponta local ambíguo, mesmo item e local repetidos e dados diferentes do mesmo item", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await insert(db, "stock_locations", { id: uuidv4(), company_id: companyId, name: "Depósito principal" });
    await insert(db, "stock_locations", { id: uuidv4(), company_id: companyId, name: "Loja" });
    const result = await run("inventory", MAPPING, [
      { Item: "Papel A4", SKU: "PAP-A4", Qtd: "10", Local: "", Custo: "" },
      { Item: "Toner", SKU: "TON-1", Qtd: "1", Local: "Loja", Custo: "100" },
      { Item: "Toner", SKU: "TON-1", Qtd: "2", Local: "Loja", Custo: "" },
      { Item: "Toner", SKU: "TON-1", Qtd: "3", Local: "Depósito principal", Custo: "120" },
      { Item: "Grampo", SKU: "GRA-1", Qtd: "3", Local: "Garagem", Custo: "" },
    ], db, companyId, userId, "skip-errors");
    expect(result.errors.map((error) => [error.row, error.field])).toEqual([
      [2, "location"],
      [4, ""],
      [5, "cost"],
      [6, "location"],
    ]);
    expect(result.errors[0].message).toMatch(/mais de um local/);
    expect(result.errors[2].message).toMatch(/Custo unitário diferente/);
    expect(result.errors[3].message).toMatch(/Nenhum cadastro de local de estoque com "Garagem"/);
    expect(result).toMatchObject({ inserted: 1, updated: 0 });
  });

  it("sem local na planilha, usa o único local cadastrado; sem nenhum local, pede para cadastrar", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const empty = await run("inventory", { name: "Item", quantity: "Qtd" }, [{ Item: "Papel", Qtd: "3" }], db, companyId, userId);
    expect(empty.errors[0].message).toMatch(/Cadastre um local/);
    const only = uuidv4();
    await insert(db, "stock_locations", { id: only, company_id: companyId, name: "Almoxarifado" });
    const result = await run("inventory", { name: "Item", quantity: "Qtd" }, [{ Item: "Papel", Qtd: "3" }], db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 1 });
    expect(await db.select<Row[]>("SELECT location_id, quantity FROM stock_balances WHERE company_id=?", [companyId])).toEqual([{ location_id: only, quantity: 3 }]);
  });

  it("falha no meio desfaz itens, saldos e movimentos", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await insert(db, "stock_locations", { id: uuidv4(), company_id: companyId, name: "Depósito principal" });
    await db.execute("CREATE TRIGGER fail_movement BEFORE INSERT ON stock_movements BEGIN SELECT RAISE(ABORT, 'falha simulada'); END");
    const result = await run("inventory", MAPPING, [{ Item: "Papel A4", SKU: "PAP-A4", Qtd: "40", Local: "Depósito principal", Custo: "" }], db, companyId, userId);
    expect(result.status).toBe("falhou");
    expect(result.errors[0].message).toMatch(/Nada desta importação foi gravado/);
    expect(await count(db, "inventory_items", companyId)).toBe(0);
    expect(await count(db, "stock_balances", companyId)).toBe(0);
  });
});

describe("contas a pagar e a receber", () => {
  it("situação Paga sem valor pago quita o total; valor parcial vira baixa parcial; categoria do tipo errado é erro", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await seedReferences(db, companyId);
    const mapping = { description: "Descrição", amount: "Valor", due_date: "Vencimento", status: "Situação", paid_amount: "Pago", category: "Categoria", supplier: "Fornecedor" };
    const result = await run("payables", mapping, [
      { Descrição: "Aluguel", Valor: "3.500,00", Vencimento: "10/11/2026", Situação: "Paga", Pago: "", Categoria: "Aluguel", Fornecedor: "11444777000161" },
      { Descrição: "Internet", Valor: "200", Vencimento: "15/11/2026", Situação: "", Pago: "50", Categoria: "", Fornecedor: "" },
      { Descrição: "Energia", Valor: "300", Vencimento: "20/11/2026", Situação: "", Pago: "", Categoria: "Serviços", Fornecedor: "" },
      { Descrição: "Água", Valor: "80", Vencimento: "20/11/2026", Situação: "", Pago: "90", Categoria: "", Fornecedor: "" },
    ], db, companyId, userId, "skip-errors");
    expect(result.errors.map((error) => [error.row, error.field])).toEqual([[4, "category"], [5, "paid_amount"]]);
    const rows = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? ORDER BY amount DESC", [companyId]);
    expect(rows.map((row) => [row.description, row.status, row.paid_amount, row.competence])).toEqual([
      ["Aluguel", "paga", 3500, "2026-11"],
      ["Internet", "paga_parcial", 50, "2026-11"],
    ]);
    expect(rows[0].supplier_id).toBeTruthy();
    expect(rows[0].category_id).toBeTruthy();
  });

  it("situação que contradiz o valor baixado é erro: Paga com valor menor sumiria com o resto da dívida", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const mapping = { description: "Descrição", amount: "Valor", status: "Situação", paid_amount: "Pago" };
    const result = await run("payables", mapping, [
      { Descrição: "Aluguel", Valor: "200", Situação: "Paga", Pago: "50" },
      { Descrição: "Internet", Valor: "200", Situação: "Paga em parte", Pago: "" },
      { Descrição: "Energia", Valor: "200", Situação: "Paga em parte", Pago: "200,00" },
      { Descrição: "Água", Valor: "200", Situação: "Paga", Pago: "200" },
      { Descrição: "Gás", Valor: "200", Situação: "Paga em parte", Pago: "80" },
    ], db, companyId, userId, "skip-errors");
    expect(result.errors.map((error) => [error.row, error.field])).toEqual([[2, "paid_amount"], [3, "paid_amount"], [4, "paid_amount"]]);
    expect(result.errors[0].message).toMatch(/Paga em parte/);
    expect(result).toMatchObject({ inserted: 2 });
    expect(await db.select<Row[]>("SELECT description, status, paid_amount FROM payables WHERE company_id=? ORDER BY paid_amount DESC", [companyId])).toEqual([
      { description: "Água", status: "paga", paid_amount: 200 },
      { description: "Gás", status: "paga_parcial", paid_amount: 80 },
    ]);
    const received = await run("receivables", { description: "Descrição", amount: "Valor", status: "Situação", received_amount: "Recebido" }, [
      { Descrição: "Mensalidade", Valor: "990", Situação: "Recebida", Recebido: "500" },
    ], db, companyId, userId, "skip-errors");
    expect(received.errors).toEqual([expect.objectContaining({ field: "received_amount", message: expect.stringMatching(/Recebida em parte/) })]);
  });

  it("conta a receber antiga (texto em ref_id) é reconhecida pela descrição exportada", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await insert(db, "receivables", { id: uuidv4(), company_id: companyId, ref_id: "Mensalidade outubro", amount: 990, due_date: "2026-10-10" });
    const exported = await exportRows("receivables", "csv", { db, companyId });
    expect(await textOf(exported)).toContain("Mensalidade outubro;990,00;10/10/2026");
    const result = await importFile(registry.receivables, exported, "receber.csv", db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 0, updated: 1 });
    expect(await count(db, "receivables", companyId)).toBe(1);
  });

  /** Fatura em 3 parcelas, todas com o mesmo nº do documento (como o faturamento gera). */
  async function threeInstallments(db: DatabaseLike, companyId: string) {
    const [customer] = await db.select<Row[]>("SELECT id FROM customers WHERE company_id=?", [companyId]);
    for (const number of [1, 2, 3]) {
      await insert(db, "receivables", {
        id: `fat-${number}`,
        company_id: companyId,
        customer_id: customer.id,
        description: `FAT-00001 - Padaria (${number}/3)`,
        amount: 400,
        due_date: `2026-1${number - 1}-10`,
        document_number: "FAT-00001",
        installment_number: number,
        installment_count: 3,
      });
    }
  }
  const installments = (db: DatabaseLike, companyId: string) =>
    db.select<Row[]>("SELECT id, description, amount, due_date, installment_number, installment_count FROM receivables WHERE company_id=? ORDER BY id", [companyId]);

  it("parcelas com o mesmo nº do documento: a exportação volta pela importação, cada parcela na sua conta", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await seedReferences(db, companyId);
    await threeInstallments(db, companyId);
    const before = await installments(db, companyId);
    for (const format of ["csv", "xlsx"] as ExportFormat[]) {
      const exported = await exportRows("receivables", format, { db, companyId });
      const result = await importFile(registry.receivables, exported, `receber.${format}`, db, companyId, userId);
      expect(result, format).toMatchObject({ errors: [], inserted: 0, updated: 3 });
    }
    expect(await installments(db, companyId)).toEqual(before);
  });

  it("sem a parcela, nº do documento de várias contas não atualiza a conta errada; com a parcela, atualiza a certa", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await seedReferences(db, companyId);
    await threeInstallments(db, companyId);
    const before = await installments(db, companyId);
    const mapping = { description: "Descrição", amount: "Valor", document_number: "Documento", customer: "Cliente" };
    const line = { Descrição: "Parcela renegociada", Valor: "450", Documento: "FAT-00001", Cliente: "11.222.333/0001-81" };
    const guess = await run("receivables", mapping, [line], db, companyId, userId, "skip-errors");
    expect(guess.errors).toEqual([expect.objectContaining({ row: 2, message: expect.stringMatching(/3 contas com o mesmo nº do documento.*Parcela/) })]);
    expect(await installments(db, companyId)).toEqual(before);

    const right = await run("receivables", { ...mapping, installment_number: "Parcela" }, [{ ...line, Parcela: "2" }], db, companyId, userId);
    expect(right).toMatchObject({ errors: [], inserted: 0, updated: 1 });
    const after = await installments(db, companyId);
    expect(after[1]).toMatchObject({ id: "fat-2", description: "Parcela renegociada", amount: 450, installment_number: 2 });
    expect([after[0], after[2]]).toEqual([before[0], before[2]]);
  });

  it("parcelas novas com o mesmo nº do documento entram como contas separadas", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await seedReferences(db, companyId);
    const mapping = { description: "Descrição", amount: "Valor", due_date: "Vencimento", document_number: "Documento", supplier: "Fornecedor", installment_number: "Parcela", installment_count: "Parcelas" };
    const line = { Descrição: "Compra de papel", Valor: "250", Documento: "NF 004521", Fornecedor: "11.444.777/0001-61", Parcelas: "2" };
    const result = await run("payables", mapping, [
      { ...line, Vencimento: "10/11/2026", Parcela: "1" },
      { ...line, Vencimento: "10/12/2026", Parcela: "2" },
    ], db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 2 });
    expect(await db.select<Row[]>("SELECT installment_number, installment_count, due_date FROM payables WHERE company_id=? ORDER BY due_date", [companyId])).toEqual([
      { installment_number: 1, installment_count: 2, due_date: "2026-11-10" },
      { installment_number: 2, installment_count: 2, due_date: "2026-12-10" },
    ]);
    const invalid = await run("payables", mapping, [{ ...line, Vencimento: "10/01/2027", Parcela: "3" }], db, companyId, userId, "skip-errors");
    expect(invalid.errors).toEqual([expect.objectContaining({ field: "installment_number", message: expect.stringMatching(/maior que o total de parcelas/) })]);
  });
});

describe("chaves de identificação", () => {
  it("e-mail compara inteiro: ana.paula@ e anapaula@ são pessoas diferentes; maiúscula não conta", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const mapping = { name: "Nome", email: "E-mail" };
    const first = await run("customers", mapping, [{ Nome: "Ana Paula", "E-mail": "ana.paula@x.com" }, { Nome: "Ana P.", "E-mail": "anapaula@x.com" }], db, companyId, userId);
    expect(first).toMatchObject({ errors: [], inserted: 2 });
    const again = await run("customers", mapping, [{ Nome: "Ana Paula Souza", "E-mail": "ANA.PAULA@X.COM" }, { Nome: "Outra", "E-mail": "ana_paula@x.com" }], db, companyId, userId);
    expect(again).toMatchObject({ errors: [], inserted: 1, updated: 1 });
    expect(await db.select<Row[]>("SELECT name, email FROM customers WHERE company_id=? ORDER BY email", [companyId])).toEqual([
      { name: "Ana Paula Souza", email: "ana.paula@x.com" },
      { name: "Outra", email: "ana_paula@x.com" },
      { name: "Ana P.", email: "anapaula@x.com" },
    ]);
  });

  it("cliente informado pelo e-mail: anapaula@ não aponta para o cadastro de ana.paula@", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await insert(db, "customers", { id: uuidv4(), company_id: companyId, name: "Ana Paula", email: "ana.paula@x.com" });
    const result = await run("opportunities", { title: "Título", customer: "Cliente" }, [{ Título: "Site", Cliente: "anapaula@x.com" }], db, companyId, userId, "skip-errors");
    expect(result.errors).toEqual([expect.objectContaining({ field: "customer", message: expect.stringMatching(/Nenhum cadastro de cliente/) })]);
    expect(await run("opportunities", { title: "Título", customer: "Cliente" }, [{ Título: "Site", Cliente: "Ana.Paula@X.com" }], db, companyId, userId)).toMatchObject({ errors: [], inserted: 1 });
  });

  it("SKU: pontuação conta (CAD-001 ≠ CAD001), maiúscula não (como o índice único)", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const mapping = { sku: "SKU", name: "Nome" };
    expect(await run("products", mapping, [{ SKU: "CAD-001", Nome: "Cadeira" }, { SKU: "CAD001", Nome: "Cadeira gamer" }], db, companyId, userId)).toMatchObject({ errors: [], inserted: 2 });
    const again = await run("products", mapping, [{ SKU: "cad-001", Nome: "Cadeira de escritório" }, { SKU: "CAD.001", Nome: "Cadeira infantil" }], db, companyId, userId);
    expect(again).toMatchObject({ errors: [], inserted: 1, updated: 1 });
    expect(await db.select<Row[]>("SELECT sku, name FROM products WHERE company_id=? ORDER BY name", [companyId])).toEqual([
      { sku: "cad-001", name: "Cadeira de escritório" },
      { sku: "CAD001", name: "Cadeira gamer" },
      { sku: "CAD.001", name: "Cadeira infantil" },
    ]);
  });

  it("estoque: SKU com pontuação diferente é outro item", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await insert(db, "stock_locations", { id: uuidv4(), company_id: companyId, name: "Depósito principal" });
    const result = await run("inventory", { name: "Item", sku: "SKU", quantity: "Qtd" }, [
      { Item: "Papel A4", SKU: "PAP-A4", Qtd: "10" },
      { Item: "Papel A4 premium", SKU: "PAPA4", Qtd: "5" },
    ], db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 2 });
    expect(await count(db, "inventory_items", companyId)).toBe(2);
  });

  it("contas: nº do documento compara com a pontuação (NF 10/01 ≠ NF 100/1)", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const mapping = { description: "Descrição", amount: "Valor", document_number: "Documento" };
    const result = await run("payables", mapping, [
      { Descrição: "Compra de papel", Valor: "100", Documento: "NF 10/01" },
      { Descrição: "Compra de toner", Valor: "300", Documento: "NF 100/1" },
    ], db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 2 });
    const again = await run("payables", mapping, [{ Descrição: "Compra de papel A4", Valor: "120", Documento: "nf 10/01" }], db, companyId, userId);
    expect(again).toMatchObject({ errors: [], inserted: 0, updated: 1 });
    expect(await count(db, "payables", companyId)).toBe(2);
  });
});

describe("oportunidades", () => {
  it("data de fechamento só quando a importação fecha a oportunidade; reimportar a ganha não inventa data", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const won = uuidv4();
    const open = uuidv4();
    const old = "2026-01-05 10:00:00";
    await insert(db, "opportunities", { id: won, company_id: companyId, title: "Wi-Fi", stage: "ganho", status: "won", probability: 100, updated_at: old });
    await insert(db, "opportunities", { id: open, company_id: companyId, title: "Rede", stage: "proposta", status: "open", probability: 60, updated_at: old });
    const result = await run("opportunities", { title: "Título", stage: "Etapa" }, [
      { Título: "Wi-Fi", Etapa: "Ganho" },
      { Título: "Rede", Etapa: "Perdido" },
    ], db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 0, updated: 2 });
    const rows = new Map((await db.select<Row[]>("SELECT * FROM opportunities WHERE company_id=?", [companyId])).map((row) => [row.id, row]));
    expect(rows.get(won)).toMatchObject({ status: "won", closed_at: null, updated_at: old });
    expect(rows.get(open)).toMatchObject({ status: "lost", probability: 0, closed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) });
  });
});

describe("casamento dentro da planilha", () => {
  it("dois clientes novos com o mesmo nome e CNPJs diferentes viram dois cadastros", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    const result = await run("customers", { name: "Nome", document: "CNPJ" }, [
      { Nome: "Acme", CNPJ: "11.222.333/0001-81" },
      { Nome: "Acme", CNPJ: "11.444.777/0001-61" },
    ], db, companyId, userId);
    expect(result).toMatchObject({ errors: [], inserted: 2 });
  });

  it("colaborador: jornada em horas vira minutos e volta em horas na exportação", async () => {
    const { db, companyId, userId } = await sqliteCompany();
    await run("employees", { name: "Nome", daily_hours: "Jornada" }, [{ Nome: "Ana", Jornada: "7,5" }], db, companyId, userId);
    const [employee] = await db.select<Row[]>("SELECT * FROM employees WHERE company_id=?", [companyId]);
    expect(employee.daily_minutes).toBe(450);
    const exported = await exportRows("employees", "csv", { db, companyId });
    expect((await textOf(exported)).split("\r\n")[1]).toContain(";7,5;");
  });
});
