// Registro dos módulos de CRM/ERP: recursos do RBAC, módulos visíveis e rota/navegação de cada módulo novo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIONS, PERMISSIONS, RESOURCES, can, visibleModules, type Resource } from "@/lib/permissions/rbac";
import { TEST_ROLES } from "@/test/sqlite";

const NEW_RESOURCES: Resource[] = ["products", "sales_orders", "invoices", "purchase_orders", "bank", "reports", "imports", "crm_activities", "suppliers"];

/** Módulo novo → recurso que libera o módulo, rota e página. */
const NEW_MODULES: { module: string; resource: Resource; path: string; page: string }[] = [
  { module: "catalog", resource: "products", path: "/catalog", page: "catalog/pages/CatalogPage.tsx" },
  { module: "sales", resource: "sales_orders", path: "/sales", page: "sales/pages/SalesPage.tsx" },
  { module: "purchasing", resource: "purchase_orders", path: "/purchasing", page: "purchasing/pages/PurchasingPage.tsx" },
  { module: "reports", resource: "reports", path: "/reports", page: "reports/pages/ReportsPage.tsx" },
  { module: "imports", resource: "imports", path: "/imports", page: "imports/pages/ImportsPage.tsx" },
];

const source = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

describe("RBAC dos recursos de CRM/ERP", () => {
  it("todo recurso novo existe na lista de recursos", () => {
    for (const resource of NEW_RESOURCES) expect(RESOURCES).toContain(resource);
  });

  it("CEO e Administração têm tudo nos recursos novos (curinga em PERMISSIONS)", () => {
    for (const role of ["ceo", "admin"] as const) {
      const perms = PERMISSIONS[role];
      for (const resource of NEW_RESOURCES) {
        const granted = perms[resource] ?? perms["*"];
        expect(granted, `${role}/${resource}`).toBeDefined();
        for (const action of ACTIONS) {
          expect(granted, `${role}/${resource}/${action}`).toContain(action);
          expect(can(role, action, resource), `${role}/${resource}/${action}`).toBe(true);
        }
      }
    }
  });

  it("matriz por setor: comercial vende, estoque cuida do catálogo e recebe compras, financeiro fatura e concilia", () => {
    expect(can("comercial", "create", "sales_orders")).toBe(true);
    expect(can("comercial", "edit", "sales_orders")).toBe(true);
    expect(can("comercial", "create", "crm_activities")).toBe(true);
    expect(can("comercial", "view", "products")).toBe(true);
    expect(can("comercial", "create", "products")).toBe(false);
    expect(can("comercial", "view", "bank")).toBe(false);

    expect(can("estoquista", "create", "products")).toBe(true);
    expect(can("estoquista", "edit", "products")).toBe(true);
    expect(can("estoquista", "receive", "purchase_orders")).toBe(true);
    expect(can("estoquista", "view", "purchase_orders")).toBe(true);
    expect(can("estoquista", "approve", "purchase_orders")).toBe(false);
    expect(can("estoquista", "view", "invoices")).toBe(false);

    for (const resource of ["invoices", "bank"] as const) {
      for (const action of ["view", "create", "edit", "delete", "approve", "export"] as const) expect(can("financeiro", action, resource), `${action}/${resource}`).toBe(true);
    }
    expect(can("financeiro", "view", "reports")).toBe(true);
    expect(can("financeiro", "export", "reports")).toBe(true);
    expect(can("financeiro", "create", "sales_orders")).toBe(false);
  });

  it("gerência vê o geral e aprova compras e vendas; auditoria só vê e exporta", () => {
    for (const resource of NEW_RESOURCES) expect(can("gerente", "view", resource), resource).toBe(true);
    expect(can("gerente", "approve", "purchase_orders")).toBe(true);
    expect(can("gerente", "approve", "sales_orders")).toBe(true);
    expect(can("gerente", "delete", "invoices")).toBe(false);

    for (const resource of NEW_RESOURCES) {
      expect(can("auditor", "view", resource), resource).toBe(true);
      for (const action of ["create", "edit", "delete", "approve", "receive"] as const) expect(can("auditor", action, resource), `${action}/${resource}`).toBe(false);
    }
    expect(can("auditor", "export", "invoices")).toBe(true);
  });

  it("RH não vê vendas, compras, banco nem relatórios; ninguém ganhou a folha por engano", () => {
    for (const resource of ["products", "sales_orders", "invoices", "purchase_orders", "bank", "reports", "crm_activities"] as const) {
      expect(can("rh", "view", resource), resource).toBe(false);
    }
    for (const role of TEST_ROLES.filter((r) => r !== "ceo" && r !== "admin")) expect(can(role, "view", "payroll"), role).toBe(false);
  });
});

describe("módulos novos registrados", () => {
  it("visibleModules mapeia as 5 rotas novas pelo recurso de cada uma", () => {
    for (const { module } of NEW_MODULES) expect(visibleModules("ceo"), module).toContain(module);
    for (const role of TEST_ROLES) {
      const visible = visibleModules(role);
      for (const { module, resource } of NEW_MODULES) {
        expect(visible.includes(module), `${role}/${module}`).toBe(can(role, "view", resource));
      }
    }
    expect(visibleModules("rh")).not.toContain("sales");
    expect(visibleModules("estoquista")).toEqual(expect.arrayContaining(["catalog", "purchasing", "imports"]));
    expect(visibleModules("financeiro")).toEqual(expect.arrayContaining(["sales", "reports", "imports"]));
  });

  it("cada módulo novo tem rota com RequireModule, item na Sidebar, comando no CommandMenu e página", () => {
    const routes = source("app/routes.tsx");
    const sidebar = source("app/layout/Sidebar.tsx");
    const commands = source("app/layout/CommandMenu.tsx");
    for (const { module, path, page } of NEW_MODULES) {
      expect(routes, module).toMatch(new RegExp(`path="${path}/\\*" element={<RequireModule module="${module}">`));
      expect(sidebar, module).toMatch(new RegExp(`module: "${module}",[^}]*path: "${path}"`));
      expect(commands, module).toMatch(new RegExp(`module: "${module}",[^}]*path: "${path}"`));
      expect(source(`modules/${page}`), page).toMatch(/export default function \w+Page\(/);
    }
  });
});

describe("registro do redesign (Tarefa 2): o que a Fase B usa sem tocar nos arquivos compartilhados", () => {
  it("Calendário: módulo de todos os papéis, rota /calendar com RequireModule, item em Visão Geral, comando na busca e página", () => {
    for (const role of TEST_ROLES) expect(visibleModules(role), role).toContain("calendar");
    expect(source("app/routes.tsx")).toMatch(/path="\/calendar\/\*" element={<RequireModule module="calendar">/);
    expect(source("app/layout/Sidebar.tsx")).toMatch(/module: "calendar",[^}]*path: "\/calendar",[^}]*group: "Visão Geral"/);
    expect(source("app/layout/CommandMenu.tsx")).toMatch(/module: "calendar",[^}]*path: "\/calendar"/);
    expect(source("modules/calendar/pages/CalendarPage.tsx")).toMatch(/export default function CalendarPage\(/);
  });

  it("Fornecedores: item em Logística apontando para a subpágina das Compras, exigindo ver fornecedores", () => {
    expect(source("app/layout/Sidebar.tsx")).toMatch(/module: "purchasing",[^}]*path: "\/purchasing\/fornecedores",[^}]*group: "Logística",[^}]*resource: "suppliers"/);
    // Quem vê fornecedores também abre as Compras (senão o atalho levaria de volta ao início).
    for (const role of TEST_ROLES) {
      if (can(role, "view", "suppliers")) expect(visibleModules(role), role).toContain("purchasing");
    }
  });

  it("Configurações tem a aba Área da empresa", () => {
    expect(source("app/subpages.ts")).toMatch(/path: "\/settings\/area", page: "settings\/pages\/AreaProfilePage.tsx", label: "Área da empresa"/);
    expect(source("modules/settings/pages/AreaProfilePage.tsx")).toMatch(/export default function AreaProfilePage\(/);
  });
});
