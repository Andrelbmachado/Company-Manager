// Clientes duplicados: agrupamento por documento, e-mail e telefone normalizados; mesclagem move tudo para o que fica.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { findDuplicateCustomers, mergeCustomers, normalizeDocument, normalizeEmail, normalizePhone } from "./dedupe";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  return { db, companyId, userId: userIds.comercial! };
}

async function customer(target: TestDb, companyId: string, id: string, fields: Row = {}, createdAt = "2026-01-01 10:00:00") {
  const row: Row = { id, company_id: companyId, name: `Cliente ${id}`, created_at: createdAt, ...fields };
  const cols = Object.keys(row);
  await target.execute(`INSERT INTO customers (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((col) => row[col]));
}

describe("normalização", () => {
  it("e-mail em minúsculas e sem espaços; vazio vira null", () => {
    expect(normalizeEmail("  A@X.com ")).toBe("a@x.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("sem-arroba")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("telefone só com dígitos, sem DDI 55 nem zero de operadora; curto demais vira null", () => {
    expect(normalizePhone("(11) 99999-0000")).toBe("11999990000");
    expect(normalizePhone("+55 11 99999-0000")).toBe("11999990000");
    expect(normalizePhone("0 11 3333-4444")).toBe("1133334444");
    expect(normalizePhone("3333-4444")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("documento: CPF (11) ou CNPJ (14) só com dígitos; repetido ou de tamanho errado vira null", () => {
    expect(normalizeDocument("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizeDocument("123.456.789-09")).toBe("12345678909");
    expect(normalizeDocument("000.000.000-00")).toBeNull();
    expect(normalizeDocument("1234")).toBeNull();
  });
});

describe("findDuplicateCustomers", () => {
  it("agrupa a@x.com e A@X.com, mantém o cadastro mais antigo e ignora excluídos e outras empresas", async () => {
    const { db, companyId } = await setup();
    await customer(db, companyId, "c1", { email: "a@x.com" }, "2026-02-01 10:00:00");
    await customer(db, companyId, "c2", { email: "A@X.com" }, "2026-01-01 10:00:00");
    await customer(db, companyId, "c3", { email: "b@x.com" });
    await customer(db, companyId, "c4", { email: "a@x.com", deleted_at: "2026-03-01 10:00:00" });
    await insertTestCompany(db, { companyId: "outra", roles: ["admin"] });
    await customer(db, "outra", "o1", { email: "a@x.com" });

    const groups = await findDuplicateCustomers(db, companyId);
    expect(groups).toEqual([{ keep: "c2", merge: ["c1"], reasons: ["email"] }]);
  });

  it("junta por documento e telefone formatados de jeitos diferentes, inclusive em cadeia", async () => {
    const { db, companyId } = await setup();
    await customer(db, companyId, "c1", { document: "12.345.678/0001-90" }, "2026-01-01 10:00:00");
    await customer(db, companyId, "c2", { document: "12345678000190", phone: "(11) 99999-0000" }, "2026-01-02 10:00:00");
    await customer(db, companyId, "c3", { phone: "+55 11 99999-0000" }, "2026-01-03 10:00:00");
    await customer(db, companyId, "c4", { phone: "(11) 98888-0000" }, "2026-01-04 10:00:00");

    const groups = await findDuplicateCustomers(db, companyId);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep).toBe("c1");
    expect(groups[0].merge).toEqual(["c2", "c3"]);
    expect(groups[0].reasons).toEqual(["documento", "telefone"]);
  });
});

describe("mergeCustomers", () => {
  it("move contatos, oportunidades, propostas, atividades, pedidos, tags e documentos e faz soft delete dos mesclados", async () => {
    const { db, companyId, userId } = await setup();
    await customer(db, companyId, "keep", { email: "a@x.com" });
    await customer(db, companyId, "dup", { email: "A@X.com", phone: "(11) 99999-0000", document: "12.345.678/0001-90", segment: "Saúde" });
    await db.execute("INSERT INTO contacts (id, company_id, customer_id, name, is_primary) VALUES (?,?,?,?,?)", ["ct-keep", companyId, "keep", "Ana", 1]);
    await db.execute("INSERT INTO contacts (id, company_id, customer_id, name, is_primary) VALUES (?,?,?,?,?)", ["ct-dup", companyId, "dup", "Bruno", 1]);
    await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title) VALUES (?,?,?,?)", ["opp", companyId, "dup", "Site"]);
    await db.execute("INSERT INTO proposals (id, company_id, customer_id, number) VALUES (?,?,?,?)", ["prop", companyId, "dup", 1]);
    await db.execute("INSERT INTO crm_activities (id, company_id, entity_type, entity_id, customer_id, kind) VALUES (?,?,?,?,?,?)", ["act-1", companyId, "customer", "dup", "dup", "nota"]);
    await db.execute("INSERT INTO crm_activities (id, company_id, entity_type, entity_id, customer_id, kind) VALUES (?,?,?,?,?,?)", ["act-2", companyId, "opportunity", "opp", "dup", "ligacao"]);
    await db.execute("INSERT INTO sales_orders (id, company_id, number, customer_id) VALUES (?,?,?,?)", ["so", companyId, 1, "dup"]);
    await db.execute("INSERT INTO receivables (id, company_id, customer_id, amount, due_date) VALUES (?,?,?,?,?)", ["rec", companyId, "dup", 100, "2026-11-10"]);
    await db.execute("INSERT INTO leads (id, company_id, name, customer_id) VALUES (?,?,?,?)", ["lead", companyId, "Lead", "dup"]);
    await db.execute("INSERT INTO tags (id, company_id, name) VALUES (?,?,?)", ["tag-a", companyId, "VIP"]);
    await db.execute("INSERT INTO tags (id, company_id, name) VALUES (?,?,?)", ["tag-b", companyId, "Saúde"]);
    await db.execute("INSERT INTO entity_tags (id, company_id, tag_id, entity_type, entity_id) VALUES (?,?,?,?,?)", ["et-keep-a", companyId, "tag-a", "customer", "keep"]);
    await db.execute("INSERT INTO entity_tags (id, company_id, tag_id, entity_type, entity_id) VALUES (?,?,?,?,?)", ["et-dup-a", companyId, "tag-a", "customer", "dup"]);
    await db.execute("INSERT INTO entity_tags (id, company_id, tag_id, entity_type, entity_id) VALUES (?,?,?,?,?)", ["et-dup-b", companyId, "tag-b", "customer", "dup"]);
    await db.execute("INSERT INTO documents (id, company_id, title, type, file_path, entity_type, entity_id) VALUES (?,?,?,?,?,?,?)", ["doc", companyId, "Contrato.pdf", "PDF", "/Clientes/Contrato.pdf", "customer", "dup"]);

    const result = await mergeCustomers(db, "keep", ["dup"], userId);
    expect(result).toMatchObject({ keepId: "keep", merged: ["dup"] });

    const value = async (sql: string, binds: unknown[]) => (await db.select<Row[]>(sql, binds))[0];
    expect(await value("SELECT customer_id, is_primary FROM contacts WHERE id=?", ["ct-dup"])).toEqual({ customer_id: "keep", is_primary: 0 });
    expect(await value("SELECT is_primary FROM contacts WHERE id=?", ["ct-keep"])).toEqual({ is_primary: 1 });
    expect(await value("SELECT customer_id FROM opportunities WHERE id=?", ["opp"])).toEqual({ customer_id: "keep" });
    expect(await value("SELECT customer_id FROM proposals WHERE id=?", ["prop"])).toEqual({ customer_id: "keep" });
    expect(await value("SELECT entity_id, customer_id FROM crm_activities WHERE id=?", ["act-1"])).toEqual({ entity_id: "keep", customer_id: "keep" });
    expect(await value("SELECT entity_id, customer_id FROM crm_activities WHERE id=?", ["act-2"])).toEqual({ entity_id: "opp", customer_id: "keep" });
    expect(await value("SELECT customer_id FROM sales_orders WHERE id=?", ["so"])).toEqual({ customer_id: "keep" });
    expect(await value("SELECT customer_id FROM receivables WHERE id=?", ["rec"])).toEqual({ customer_id: "keep" });
    expect(await value("SELECT customer_id FROM leads WHERE id=?", ["lead"])).toEqual({ customer_id: "keep" });
    expect(await value("SELECT entity_id FROM documents WHERE id=?", ["doc"])).toEqual({ entity_id: "keep" });

    // Tag que o que fica já tinha não duplica (índice único das tags ativas); a outra passa para ele.
    const tags = await db.select<Row[]>("SELECT tag_id FROM entity_tags WHERE entity_type='customer' AND entity_id='keep' AND deleted_at IS NULL ORDER BY tag_id");
    expect(tags.map((row) => row.tag_id)).toEqual(["tag-a", "tag-b"]);
    expect(await value("SELECT deleted_at IS NOT NULL AS gone FROM entity_tags WHERE id=?", ["et-dup-a"])).toEqual({ gone: 1 });

    const kept = await value("SELECT * FROM customers WHERE id=?", ["keep"]);
    expect(kept).toMatchObject({ email: "a@x.com", phone: "(11) 99999-0000", document: "12.345.678/0001-90", segment: "Saúde", deleted_at: null });
    const merged = await value("SELECT * FROM customers WHERE id=?", ["dup"]);
    expect(merged.merged_into_id).toBe("keep");
    expect(merged.deleted_at).toBeTruthy();

    expect(await findDuplicateCustomers(db, companyId)).toEqual([]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
    const log = await db.select<Row[]>("SELECT * FROM crm_activities WHERE entity_type='customer' AND entity_id='keep' AND subject=?", ["Cadastros mesclados"]);
    expect(log).toHaveLength(1);
  });

  it("recusa mesclar o cliente nele mesmo, lista vazia, cliente excluído ou de outra empresa", async () => {
    const { db, companyId, userId } = await setup();
    await customer(db, companyId, "keep");
    await customer(db, companyId, "gone", { deleted_at: "2026-01-01 00:00:00" });
    await insertTestCompany(db, { companyId: "outra", roles: ["admin"] });
    await customer(db, "outra", "other");
    await expect(mergeCustomers(db, "keep", ["keep"], userId)).rejects.toThrow();
    await expect(mergeCustomers(db, "keep", [], userId)).rejects.toThrow();
    await expect(mergeCustomers(db, "keep", ["gone"], userId)).rejects.toThrow();
    await expect(mergeCustomers(db, "keep", ["other"], userId)).rejects.toThrow();
    await expect(mergeCustomers(db, "nope", ["keep"], userId)).rejects.toThrow();
  });
});
