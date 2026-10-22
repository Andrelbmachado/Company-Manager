import { describe, it, expect } from "vitest";
import { can, canAny, visibleModules } from "./rbac";
import type { Role } from "@/types";

describe("can", () => {
  it("admin tem acesso total via wildcard", () => {
    expect(can("admin", "delete", "finance")).toBe(true);
    expect(can("admin", "approve", "payables")).toBe(true);
    expect(can("admin", "transfer", "custody")).toBe(true);
  });

  it("concede ação permitida para o papel", () => {
    expect(can("comercial", "create", "customers")).toBe(true);
    expect(can("financeiro", "approve", "payables")).toBe(true);
    expect(can("estoquista", "transfer", "inventory")).toBe(true);
  });

  it("nega ação não permitida para o papel", () => {
    expect(can("comercial", "approve", "payables")).toBe(false);
    expect(can("tecnico", "delete", "customers")).toBe(false);
    expect(can("atendimento", "export", "finance")).toBe(false);
  });

  it("nega recurso não listado para o papel", () => {
    expect(can("atendimento", "view", "finance")).toBe(false);
    expect(can("estoquista", "view", "proposals")).toBe(false);
  });

  it("nega papel desconhecido", () => {
    expect(can("inexistente" as Role, "view", "customers")).toBe(false);
  });
});

describe("canAny", () => {
  it("true se qualquer ação for permitida", () => {
    expect(canAny("comercial", ["delete", "create"], "customers")).toBe(true);
  });

  it("false se nenhuma ação for permitida", () => {
    expect(canAny("atendimento", ["delete", "approve"], "finance")).toBe(false);
  });
});

describe("visibleModules", () => {
  it("sempre inclui o dashboard", () => {
    expect(visibleModules("atendimento")).toContain("dashboard");
  });

  it("admin enxerga todos os módulos mapeados", () => {
    const mods = visibleModules("admin");
    expect(mods).toEqual(
      expect.arrayContaining([
        "dashboard",
        "crm",
        "support",
        "operations",
        "projects",
        "inventory",
        "custody",
        "finance",
        "documents",
        "settings",
        "audit",
      ])
    );
  });

  it("financeiro enxerga finance mas não operations", () => {
    const mods = visibleModules("financeiro");
    expect(mods).toContain("finance");
    expect(mods).not.toContain("operations");
  });

  it("papel desconhecido só vê o dashboard", () => {
    expect(visibleModules("inexistente" as Role)).toEqual(["dashboard"]);
  });
});
