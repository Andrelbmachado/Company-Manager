// Importação de colaboradores: validação da linha (zod) e gravação no SQLite real (atualiza por e-mail/CPF, não apaga).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { EMPLOYEE_IMPORT_FIELDS, employeeImportEntity, employeeImportSchema, employeeNaturalKey, upsertEmployees, type EmployeeImportRow } from "./employeeImport";
import { parseAddress } from "./employees";
import type { Employee } from "@/types";

const C = "test-company";
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { companyId: C });
});

afterEach(() => db.close());

const employees = () => db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [C]);
const parse = (raw: Record<string, unknown>) => employeeImportSchema.parse(raw) as EmployeeImportRow;

describe("linha da planilha", () => {
  it("aceita rótulos e chaves das listas, datas dd/mm/aaaa e números do Excel", () => {
    const row = parse({ name: " Ana ", email: "ANA@X.COM", contract_type: "Estágio", status: "ativo", hire_date: "01/03/2024", vacation_days_entitled: "30", numero: 100, uf: "sp" });
    expect(row).toMatchObject({ name: "Ana", email: "ana@x.com", contract_type: "estagio", status: "ativo", hire_date: "2024-03-01", vacation_days_entitled: 30, numero: "100", uf: "sp", document: null });
  });

  it("recusa CPF, CEP, UF, contrato e e-mail inválidos e linha sem nome", () => {
    for (const raw of [{ name: "" }, { name: "A", document: "123" }, { name: "A", cep: "1803" }, { name: "A", uf: "São Paulo" }, { name: "A", contract_type: "freela" }, { name: "A", email: "x@" }]) {
      expect(employeeImportSchema.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
    }
  });

  it("chave natural: e-mail, senão CPF, senão nome", () => {
    expect(employeeNaturalKey({ name: "A", email: "a@x.com", document: "123.456.789-09" })).toBe("email:a@x.com");
    expect(employeeNaturalKey({ name: "A", email: null, document: "123.456.789-09" })).toBe("cpf:12345678909");
    expect(employeeNaturalKey({ name: " Ana ", email: null, document: null })).toBe("nome:ana");
  });

  it("entidade no formato do registro, com recurso de RH e sem salário", () => {
    expect(employeeImportEntity).toMatchObject({ key: "employees", resource: "hr_admin" });
    expect(EMPLOYEE_IMPORT_FIELDS.map((field) => field.key)).not.toContain("salary");
    expect(new Set(EMPLOYEE_IMPORT_FIELDS.map((field) => field.key)).size).toBe(EMPLOYEE_IMPORT_FIELDS.length);
  });
});

describe("gravação", () => {
  it("cria, depois atualiza pelo e-mail ou CPF só os campos preenchidos, sem duplicar", async () => {
    const first = await upsertEmployees(db, C, [
      parse({ name: "Ana Lima", email: "ana@x.com", department: "Comercial", cidade: "Sorocaba", uf: "sp" }),
      parse({ name: "Bruno Reis", document: "123.456.789-09", position: "Técnico" }),
      parse({ name: "Ana Lima", email: "ANA@x.com", position: "Vendedora" }),
    ]);
    // A 3ª linha repete a Ana (mesmo e-mail): completa o cadastro criado na 1ª e conta uma vez só.
    expect(first).toEqual({ inserted: 2, updated: 0 });

    const second = await upsertEmployees(db, C, [
      parse({ name: "Ana Lima", email: "ana@x.com", phone: "(15) 99999-0000", bairro: "Centro" }),
      parse({ name: "Bruno R.", document: "12345678909", contract_type: "PJ" }),
      parse({ name: "Carla Dias" }),
    ]);
    expect(second).toEqual({ inserted: 1, updated: 2 });

    const [ana, bruno, carla] = await employees();
    expect(ana).toMatchObject({ email: "ana@x.com", department: "Comercial", position: "Vendedora", phone: "(15) 99999-0000", status: "ativo" });
    expect(parseAddress(ana.address_json)).toMatchObject({ cidade: "Sorocaba", uf: "SP", bairro: "Centro" });
    expect(bruno).toMatchObject({ name: "Bruno R.", position: "Técnico", contract_type: "pj" });
    expect(carla).toMatchObject({ name: "Carla Dias", vacation_days_entitled: 30, daily_minutes: 480 });
  });

  it("sem e-mail nem CPF, nome igual atualiza o cadastro existente", async () => {
    await upsertEmployees(db, C, [parse({ name: "Davi Costa", department: "TI" })]);
    expect(await upsertEmployees(db, C, [parse({ name: "davi costa", position: "Suporte" })])).toEqual({ inserted: 0, updated: 1 });
    expect(await employees()).toHaveLength(1);
    expect((await employees())[0]).toMatchObject({ department: "TI", position: "Suporte" });
  });
});
