// Tags e segmentos salvos de clientes (SQLite real) e filtro da lista (regra pura).
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import {
  addTag,
  createTag,
  deleteSavedView,
  fetchEntityTags,
  fetchSavedViews,
  fetchTags,
  filterCustomers,
  parseCustomerFilters,
  removeTag,
  saveView,
} from "./segments";
import type { Customer } from "@/types";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial", "gerente"] });
  await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica Vida"]);
  return { db, companyId, seller: userIds.comercial!, manager: userIds.gerente! };
}

describe("tags", () => {
  it("criar reaproveita a tag com o mesmo nome (sem diferenciar maiúsculas); marcar não duplica; desmarcar faz soft delete", async () => {
    const { db, companyId, seller } = await setup();
    const vip = await createTag(db, companyId, "VIP", "success");
    expect(await createTag(db, companyId, " vip ", "danger")).toBe(vip);
    await expect(createTag(db, companyId, "  ", "info")).rejects.toThrow(/nome/i);
    expect((await fetchTags(db, companyId, "customer")).map((tag) => [tag.name, tag.color])).toEqual([["VIP", "success"]]);

    await addTag(db, companyId, vip, "customer", "cust-1", seller);
    await addTag(db, companyId, vip, "customer", "cust-1", seller);
    expect((await fetchEntityTags(db, companyId, "customer")).map((row) => [row.tag_id, row.entity_id])).toEqual([[vip, "cust-1"]]);

    await removeTag(db, companyId, vip, "customer", "cust-1");
    expect(await fetchEntityTags(db, companyId, "customer")).toEqual([]);
    await addTag(db, companyId, vip, "customer", "cust-1", seller);
    expect(await fetchEntityTags(db, companyId, "customer")).toHaveLength(1);
  });
});

describe("segmentos salvos", () => {
  it("cada um vê os seus e os compartilhados; filtros voltam como objeto", async () => {
    const { db, companyId, seller, manager } = await setup();
    const mine = await saveView(db, companyId, seller, "customer", "Saúde ativos", { segment: "Saúde", status: "active" });
    await saveView(db, companyId, null, "customer", "Todos VIP", { tagId: "t1" });
    await saveView(db, companyId, manager, "customer", "Do gerente", { ownerId: "me" });
    await saveView(db, companyId, seller, "opportunity", "Minhas abertas", { status: "open" });

    const views = await fetchSavedViews(db, companyId, "customer", seller);
    expect(views.map((view) => view.name)).toEqual(["Saúde ativos", "Todos VIP"]);
    expect(parseCustomerFilters(views[0].filters_json)).toEqual({ segment: "Saúde", status: "active" });
    await expect(saveView(db, companyId, seller, "customer", "", {})).rejects.toThrow(/nome/i);

    await deleteSavedView(db, companyId, mine);
    expect((await fetchSavedViews(db, companyId, "customer", seller)).map((view) => view.name)).toEqual(["Todos VIP"]);
  });

  it("filtros malformados viram filtro vazio", () => {
    expect(parseCustomerFilters("{oops")).toEqual({});
    expect(parseCustomerFilters('["a"]')).toEqual({});
    expect(parseCustomerFilters('{"segment": 3, "search": "ana"}')).toEqual({ search: "ana" });
  });
});

describe("filterCustomers", () => {
  const base = { company_id: "c", address_json: "{}", created_at: "", updated_at: "" };
  const customers = [
    { ...base, id: "a", name: "Clínica Vida", type: "PJ", status: "active", segment: "Saúde", email: "contato@vida.com", owner_id: "u1", document: "12.345.678/0001-90" },
    { ...base, id: "b", name: "Padaria Pão Quente", type: "PJ", status: "inactive", segment: "Varejo", owner_id: "u2", phone: "(15) 3333-4444" },
    { ...base, id: "c", name: "José da Silva", type: "PF", status: "active", segment: null, owner_id: null },
  ] as Customer[];
  const tagsByCustomer = new Map([["a", ["t1"]], ["b", ["t1", "t2"]]]);

  it("busca por nome, e-mail, documento ou telefone (sem acento e pontuação), segmento, tag, status e responsável", () => {
    const run = (filters: Parameters<typeof filterCustomers>[1]) => filterCustomers(customers, filters, { tagsByCustomer, userId: "u1" }).map((c) => c.id);
    expect(run({})).toEqual(["a", "b", "c"]);
    expect(run({ search: "clinica" })).toEqual(["a"]);
    expect(run({ search: "12345678" })).toEqual(["a"]);
    expect(run({ search: "3333-4444" })).toEqual(["b"]);
    expect(run({ search: "jose" })).toEqual(["c"]);
    expect(run({ segment: "Saúde" })).toEqual(["a"]);
    expect(run({ tagId: "t1" })).toEqual(["a", "b"]);
    expect(run({ tagId: "t2", status: "inactive" })).toEqual(["b"]);
    expect(run({ ownerId: "me" })).toEqual(["a"]);
    expect(run({ ownerId: "u2" })).toEqual(["b"]);
    expect(run({ ownerId: "none" })).toEqual(["c"]);
  });
});
