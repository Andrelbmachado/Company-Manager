import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

import { RESOURCES } from "@/lib/permissions/rbac";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, listMigrations } from "@/test/sqlite";
import { ATTACHMENT_ENTITIES, attachmentEntityLabel, attachmentEntityNames, canViewAttachmentsOf } from "./entities";

const testDb = useTestDb();

describe("registros com anexos", () => {
  it("cada tipo aponta para um recurso do RBAC e uma tabela das migrations", () => {
    const tables = new Set(listMigrations().flatMap((migration) => [...migration.sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map((match) => match[1])));
    for (const [type, entity] of Object.entries(ATTACHMENT_ENTITIES)) {
      expect(RESOURCES, type).toContain(entity.resource);
      expect(tables.has(entity.table), `${type} → ${entity.table}`).toBe(true);
    }
  });

  it("ver anexo segue o recurso do registro; tipo desconhecido só para acesso total", () => {
    expect(canViewAttachmentsOf("comercial", "customer")).toBe(true);
    expect(canViewAttachmentsOf("estoquista", "customer")).toBe(false);
    expect(canViewAttachmentsOf("rh", "employee")).toBe(true);
    expect(canViewAttachmentsOf("financeiro", "employee")).toBe(false);
    expect(canViewAttachmentsOf("financeiro", "invoice")).toBe(true);
    expect(canViewAttachmentsOf("ceo", "tipo_novo")).toBe(true);
    expect(canViewAttachmentsOf("admin", "tipo_novo")).toBe(true);
    expect(canViewAttachmentsOf("gerente", "tipo_novo")).toBe(false);
    expect(canViewAttachmentsOf("auditor", "constructor")).toBe(false);
    expect(attachmentEntityLabel("customer")).toBe("Cliente");
    expect(attachmentEntityLabel("tipo_novo")).toBe("tipo_novo");
  });

  it("acha o nome dos registros (inclusive número formatado) e ignora tipo desconhecido", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES (?,?,?,?)", ["cli-1", companyId, "PJ", "NorteLog"]);
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?,?,?)", ["pv-1", companyId, 12]);
    const names = await attachmentEntityNames(companyId, ["customer", "sales_order", "tipo_novo", "customer"]);
    expect(names.get("customer:cli-1")).toBe("NorteLog");
    expect(names.get("sales_order:pv-1")).toBe("PV-00012");
    expect([...names.keys()].some((key) => key.startsWith("tipo_novo:"))).toBe(false);
  });
});
