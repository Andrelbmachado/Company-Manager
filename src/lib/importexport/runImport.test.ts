// Importação ponta a ponta no SQLite real: insere, reimporta sem duplicar, relatório por linha, tudo ou nada,
// simulação e histórico em import_batches.
import { describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { getEntity } from "./registry";
import { runImport, suggestMapping, validateRows, type ColumnMapping } from "./runImport";

type Row = Record<string, unknown>;

const HEADERS = ["Razão social", "CNPJ/CPF", "E-mail", "Telefone", "Limite"];
const MAPPING: ColumnMapping = { name: "Razão social", document: "CNPJ/CPF", email: "E-mail", phone: "Telefone", credit_limit: "Limite" };

const sheet = (...lines: string[][]) => lines.map((line) => Object.fromEntries(HEADERS.map((header, index) => [header, line[index] ?? ""])));

const THREE = sheet(
  ["Padaria Pão Quente Ltda", "11.222.333/0001-81", "Contato@PaoQuente.com.br", "11 3020-1188", "1.234,56"],
  ["Ana Souza", "529.982.247-25", "ana@exemplo.com", "(11) 99999-8888", ""],
  ["Mercado Bom Preço", "", "compras@bompreco.com", "", "R$ 10,00"],
);

async function setup(): Promise<{ db: TestDb; companyId: string; userId: string }> {
  const db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  return { db, companyId, userId: userIds.comercial! };
}

const customers = (db: TestDb, companyId: string) => db.select<Row[]>("SELECT * FROM customers WHERE company_id = ? AND deleted_at IS NULL ORDER BY name", [companyId]);
const batches = (db: TestDb) => db.select<Row[]>("SELECT * FROM import_batches ORDER BY created_at, rowid");

describe("runImport (clientes, SQLite real)", () => {
  it("importa 3 clientes e, reimportando o mesmo arquivo, atualiza os 3 sem duplicar", async () => {
    const { db, companyId, userId } = await setup();
    const first = await runImport("customers", MAPPING, THREE, { db, companyId, userId, mode: "skip-errors", dryRun: false, filename: "clientes.csv", format: "csv" });
    expect(first).toMatchObject({ ok: 3, inserted: 3, updated: 0, errors: [], status: "concluida" });

    let rows = await customers(db, companyId);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.name === "Padaria Pão Quente Ltda")).toMatchObject({
      document: "11.222.333/0001-81",
      email: "contato@paoquente.com.br",
      phone: "(11) 3020-1188",
      credit_limit: 1234.56,
      type: "PJ",
      status: "active",
    });
    expect(rows.find((row) => row.name === "Ana Souza")).toMatchObject({ type: "PF", document: "529.982.247-25", credit_limit: null });

    const second = await runImport("customers", MAPPING, THREE, { db, companyId, userId, mode: "skip-errors", dryRun: false });
    expect(second).toMatchObject({ ok: 3, inserted: 0, updated: 3, errors: [] });
    rows = await customers(db, companyId);
    expect(rows).toHaveLength(3);

    const history = await batches(db);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: first.batchId,
      company_id: companyId,
      entity: "customers",
      filename: "clientes.csv",
      format: "csv",
      mode: "skip-errors",
      dry_run: 0,
      status: "concluida",
      rows_total: 3,
      rows_ok: 3,
      rows_err: 0,
      inserted: 3,
      updated: 0,
      created_by: userId,
    });
    expect(JSON.parse(String(history[0].mapping_json))).toEqual({ "Razão social": "name", "CNPJ/CPF": "document", "E-mail": "email", Telefone: "phone", Limite: "credit_limit" });
    expect(history[0].finished_at).toBeTruthy();
  });

  it("acha o cadastro pelo CNPJ com outra máscara, pelo e-mail ou pelo nome; célula vazia não apaga", async () => {
    const { db, companyId, userId } = await setup();
    await runImport("customers", MAPPING, THREE, { db, companyId, userId, mode: "skip-errors", dryRun: false });
    const update = sheet(
      ["Padaria Pão Quente", "11222333000181", "", "", "2.000"],
      ["ANA SOUZA", "", "", "11 98888-7777", ""],
      ["Outro nome", "", "COMPRAS@bompreco.com", "", ""],
    );
    const result = await runImport("customers", MAPPING, update, { db, companyId, userId, mode: "skip-errors", dryRun: false });
    expect(result).toMatchObject({ inserted: 0, updated: 3, errors: [] });
    const rows = await customers(db, companyId);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.document === "11.222.333/0001-81")).toMatchObject({ name: "Padaria Pão Quente", email: "contato@paoquente.com.br", credit_limit: 2000 });
    expect(rows.find((row) => row.document === "529.982.247-25")).toMatchObject({ name: "ANA SOUZA", phone: "(11) 98888-7777", email: "ana@exemplo.com" });
    expect(rows.find((row) => row.email === "compras@bompreco.com")).toMatchObject({ name: "Outro nome", credit_limit: 10 });
  });

  it("dois cadastros com o mesmo nome e CNPJs diferentes não se misturam", async () => {
    const { db, companyId, userId } = await setup();
    await runImport("customers", MAPPING, sheet(["Acme", "11.222.333/0001-81"]), { db, companyId, userId, mode: "skip-errors", dryRun: false });
    const result = await runImport("customers", MAPPING, sheet(["Acme", "12.ABC.345/01DE-35"]), { db, companyId, userId, mode: "skip-errors", dryRun: false });
    expect(result).toMatchObject({ inserted: 1, updated: 0 });
    expect((await customers(db, companyId)).map((row) => row.document).sort()).toEqual(["11.222.333/0001-81", "12.ABC.345/01DE-35"]);
  });

  it("linha com e-mail inválido: pula a linha (com o número dela) ou, no tudo ou nada, não grava nada", async () => {
    const { db, companyId, userId } = await setup();
    const withBadEmail = [THREE[0], ...sheet(["Ana Souza", "", "ana@@exemplo", "", ""]), THREE[2]];
    const options = { db, companyId, userId, dryRun: false, rowNumbers: [2, 3, 5] };

    const strict = await runImport("customers", MAPPING, withBadEmail, { ...options, mode: "all-or-nothing" });
    expect(strict).toMatchObject({ ok: 0, inserted: 0, updated: 0, status: "falhou" });
    expect(strict.errors).toEqual([expect.objectContaining({ row: 3, field: "email", value: "ana@@exemplo" })]);
    expect(await customers(db, companyId)).toHaveLength(0);

    const lenient = await runImport("customers", MAPPING, withBadEmail, { ...options, mode: "skip-errors" });
    expect(lenient).toMatchObject({ ok: 2, inserted: 2, updated: 0, status: "com_erros" });
    expect(lenient.errors).toEqual([expect.objectContaining({ row: 3, field: "email", message: expect.stringMatching(/e-mail inválido/i) })]);
    expect(await customers(db, companyId)).toHaveLength(2);

    const history = await batches(db);
    expect(history.map((batch) => [batch.status, batch.rows_ok, batch.rows_err])).toEqual([
      ["falhou", 0, 1],
      ["com_erros", 2, 1],
    ]);
    expect(JSON.parse(String(history[1].errors_json))).toEqual([expect.objectContaining({ row: 3, field: "email" })]);
  });

  it("simulação conta novos e atualizados sem gravar e fica no histórico como simulação", async () => {
    const { db, companyId, userId } = await setup();
    await runImport("customers", MAPPING, THREE.slice(0, 1), { db, companyId, userId, mode: "skip-errors", dryRun: false });
    const dry = await runImport("customers", MAPPING, THREE, { db, companyId, userId, mode: "all-or-nothing", dryRun: true });
    expect(dry).toMatchObject({ ok: 3, inserted: 2, updated: 1, status: "simulacao", dryRun: true });
    expect(await customers(db, companyId)).toHaveLength(1);
    const [, simulation] = await batches(db);
    expect(simulation).toMatchObject({ status: "simulacao", dry_run: 1, mode: "all-or-nothing", inserted: 2, updated: 1 });
  });

  it("obrigatório vazio, valor ruim e linha repetida na planilha dão erro com o número da linha", async () => {
    const { db, companyId, userId } = await setup();
    const rows = sheet(
      ["", "11.222.333/0001-81"],
      ["Bom", "", "", "", "R$ 1.2O0,00"],
      ["Repetido", "529.982.247-25"],
      ["Repetido de novo", "52998224725"],
      ["CPF ruim", "123.456.789-00"],
    );
    const result = await runImport("customers", MAPPING, rows, { db, companyId, userId, mode: "skip-errors", dryRun: false });
    expect(result.ok).toBe(1);
    expect(result.errors.map((error) => [error.row, error.field])).toEqual([
      [2, "name"],
      [3, "credit_limit"],
      [5, ""],
      [6, "document"],
    ]);
    expect(result.errors[2].message).toMatch(/linha 4/);
  });

  it("mapeamento sem coluna obrigatória: nada é gravado e o lote falha com a explicação", async () => {
    const { db, companyId, userId } = await setup();
    const result = await runImport("customers", { email: "E-mail" }, THREE, { db, companyId, userId, mode: "skip-errors", dryRun: false });
    expect(result).toMatchObject({ ok: 0, status: "falhou" });
    expect(result.errors[0]).toMatchObject({ row: 0, message: expect.stringMatching(/Nome/) });
    expect(await customers(db, companyId)).toHaveLength(0);
  });

  it("falha do banco no meio da gravação desfaz tudo (mesmo pulando linhas com erro)", async () => {
    const { db, companyId, userId } = await setup();
    await runImport("customers", MAPPING, THREE.slice(0, 1), { db, companyId, userId, mode: "skip-errors", dryRun: false });
    const before = await customers(db, companyId);
    await db.execute("CREATE TRIGGER quebra_import BEFORE UPDATE ON customers BEGIN SELECT RAISE(ABORT, 'disco cheio'); END");
    const many = [...THREE, ...Array.from({ length: 700 }, (_, index) => ({ "Razão social": `Cliente ${index}`, "CNPJ/CPF": "", "E-mail": `c${index}@x.com`, Telefone: "", Limite: "" }))];
    many[0] = { ...many[0], Limite: "99" };
    const result = await runImport("customers", MAPPING, many, { db, companyId, userId, mode: "skip-errors", dryRun: false });
    expect(result).toMatchObject({ ok: 0, inserted: 0, updated: 0, status: "falhou" });
    expect(result.errors[0].message).toMatch(/disco cheio/);
    expect(await customers(db, companyId)).toEqual(before);
  });

  it("validateRows mostra a prévia sem tocar no banco", async () => {
    const preview = await validateRows(getEntity("customers")!, MAPPING, sheet(["Ok", "", "a@b.com"], ["", "", "x"]));
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0].value).toMatchObject({ name: "Ok", email: "a@b.com" });
    expect(preview.errors.map((error) => error.field).sort()).toEqual(["email", "name"]);
  });
});

describe("suggestMapping", () => {
  it("liga os cabeçalhos aos campos pelo rótulo, chave ou apelido, sem acento nem caixa", () => {
    const entity = getEntity("customers")!;
    expect(suggestMapping(entity, ["RAZAO SOCIAL", "cnpj", "E-mail", "Fone", "Coluna estranha", "Observacoes"])).toEqual({
      name: "RAZAO SOCIAL",
      document: "cnpj",
      email: "E-mail",
      phone: "Fone",
      notes: "Observacoes",
    });
  });

  it("não usa o mesmo cabeçalho para dois campos", () => {
    const entity = getEntity("customers")!;
    const mapping = suggestMapping(entity, ["Nome", "Nome fantasia"]);
    expect(mapping).toEqual({ name: "Nome", trade_name: "Nome fantasia" });
  });
});
