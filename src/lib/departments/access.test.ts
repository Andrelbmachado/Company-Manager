import { describe, expect, it } from "vitest";
import {
  canDepartment, departmentAccess, projectFields, visibleCards, visibleDepartments,
  assertCanDepartment, DepartmentAccessError, type AccessContext,
} from "./access";
import { DEPARTMENTS, DEPARTMENT_SLUGS } from "./catalog";

const admin: AccessContext = { isAdmin: true, memberships: [] };
const rhChefe: AccessContext = { isAdmin: false, memberships: [{ department: "rh", role: "chefe" }] };
const rhAssist: AccessContext = { isAdmin: false, memberships: [{ department: "rh", role: "assistente" }] };
const mkt: AccessContext = { isAdmin: false, memberships: [{ department: "marketing", role: "membro" }] };
const nobody: AccessContext = { isAdmin: false, memberships: [] };

describe("catálogo", () => {
  it("tem 20 departamentos únicos, todos com cards", () => {
    expect(DEPARTMENTS).toHaveLength(20);
    expect(new Set(DEPARTMENT_SLUGS).size).toBe(20);
    for (const d of DEPARTMENTS) expect(d.cards.length).toBeGreaterThan(0);
  });
});

describe("matriz de permissões", () => {
  it("admin acessa tudo, em todos os departamentos", () => {
    for (const slug of DEPARTMENT_SLUGS) {
      expect(departmentAccess(admin, slug)).toBe("full");
      expect(canDepartment(admin, slug, "delete")).toBe(true);
    }
  });

  it("RH não vê nada de Marketing", () => {
    expect(departmentAccess(rhChefe, "marketing")).toBe("none");
    for (const card of DEPARTMENTS.find((d) => d.slug === "marketing")!.cards) {
      expect(canDepartment(rhChefe, "marketing", "view", card.resource)).toBe(false);
    }
    expect(visibleCards(rhChefe, "marketing")).toEqual([]);
  });

  it("Marketing vê somente férias/ausências do RH, em modo leitura", () => {
    expect(departmentAccess(mkt, "rh")).toBe("shared");
    expect(visibleCards(mkt, "rh").map((c) => c.resource)).toEqual(["ferias_ausencias"]);
    expect(canDepartment(mkt, "rh", "view", "folha")).toBe(false);
    expect(canDepartment(mkt, "rh", "view", "colaboradores")).toBe(false);
    expect(canDepartment(mkt, "rh", "edit", "ferias_ausencias")).toBe(false);
    expect(canDepartment(mkt, "rh", "view")).toBe(false);
  });

  it("projeção limitada remove motivo/status para Marketing", () => {
    const rows = [{ colaborador_nome: "Ana", tipo: "ferias", data_inicio: "2026-11-01", data_fim: "2026-11-15", motivo: "x", status: "aprovado" }];
    expect(projectFields(mkt, "rh", "ferias_ausencias", rows)).toEqual([
      { colaborador_nome: "Ana", tipo: "ferias", data_inicio: "2026-11-01", data_fim: "2026-11-15" },
    ]);
    expect(projectFields(rhAssist, "rh", "ferias_ausencias", rows)).toEqual(rows);
    expect(projectFields(nobody, "rh", "ferias_ausencias", rows)).toEqual([]);
  });

  it("papéis dentro do próprio departamento", () => {
    expect(canDepartment(rhChefe, "rh", "approve")).toBe(true);
    expect(canDepartment(rhChefe, "rh", "manage_members")).toBe(true);
    expect(canDepartment(rhAssist, "rh", "edit", "folha")).toBe(true);
    expect(canDepartment(rhAssist, "rh", "approve")).toBe(false);
    expect(canDepartment(rhAssist, "rh", "delete")).toBe(false);
    const membro: AccessContext = { isAdmin: false, memberships: [{ department: "ti", role: "membro" }] };
    expect(canDepartment(membro, "ti", "view")).toBe(true);
    expect(canDepartment(membro, "ti", "create")).toBe(false);
  });

  it("deny-by-default: sem grant, nenhum departamento vê outro", () => {
    for (const a of DEPARTMENT_SLUGS) {
      const ctx: AccessContext = { isAdmin: false, memberships: [{ department: a, role: "chefe" }] };
      for (const b of DEPARTMENT_SLUGS) {
        if (a === b) continue;
        const expected = a === "marketing" && b === "rh" ? "shared" : "none";
        expect(departmentAccess(ctx, b), `${a} -> ${b}`).toBe(expected);
      }
    }
  });

  it("sidebar mostra só departamentos próprios + compartilhados", () => {
    expect(visibleDepartments(nobody)).toEqual([]);
    expect(visibleDepartments(rhChefe).map((d) => d.slug)).toEqual(["rh"]);
    expect(visibleDepartments(mkt).map((d) => d.slug).sort()).toEqual(["marketing", "rh"]);
    expect(visibleDepartments(admin)).toHaveLength(20);
  });

  it("assertCanDepartment lança erro quando negado", () => {
    expect(() => assertCanDepartment(rhChefe, "marketing", "view", "campanhas")).toThrow(DepartmentAccessError);
    expect(() => assertCanDepartment(mkt, "rh", "view", "ferias_ausencias")).not.toThrow();
  });
});

describe("migrations espelham a config", () => {
  it("SQLite e Supabase contêm os 20 slugs e o grant marketing→rh", async () => {
    const fs = await import("node:fs");
    for (const f of ["src-tauri/migrations/0002_departments.sql", "supabase/migrations/20261022000000_departments_rls.sql"]) {
      const sql = fs.readFileSync(f, "utf8");
      for (const slug of DEPARTMENT_SLUGS) expect(sql, `${f}:${slug}`).toContain(`'${slug}'`);
      expect(sql).toMatch(/'marketing',\s*'rh',\s*'ferias_ausencias'/);
    }
  });
});
