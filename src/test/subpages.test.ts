// Subpáginas dos módulos (src/app/subpages.ts): cada uma tem página provisória, rota com guarda de permissão,
// aba na navegação do módulo e comando na busca. As tarefas de cada módulo só trocam o conteúdo das páginas.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIONS, RESOURCES, can, visibleModules } from "@/lib/permissions/rbac";
import { TEST_ROLES } from "@/test/sqlite";
import {
  MODULE_SECTIONS,
  SUBPAGES,
  activeNavPath,
  canOpenSubpage,
  isDetailPage,
  moduleNavItems,
  sectionForPath,
  subpageRoutePath,
  type Subpage,
} from "@/app/subpages";

const source = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
const exists = (relative: string) => existsSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)));
const byPath = (path: string): Subpage => {
  const page = SUBPAGES.find((item) => item.path === path);
  if (!page) throw new Error(`Subpágina ausente: ${path}`);
  return page;
};

/** Rotas que as tarefas da Fase B usam (CRM, ERP, RH, importação, relatórios e backup). */
const REQUIRED_PATHS = [
  "/crm/clientes/:id",
  "/crm/contatos",
  "/crm/funil",
  "/crm/propostas",
  "/crm/propostas/:id",
  "/crm/atividades",
  "/crm/duplicados",
  "/catalog/tabelas-de-preco",
  "/sales/pedidos/:id",
  "/sales/faturas",
  "/sales/faturas/:id",
  "/purchasing/pedidos/:id",
  "/purchasing/recebimentos",
  "/purchasing/fornecedores",
  "/inventory/movimentacoes",
  "/inventory/transferencias",
  "/inventory/inventarios",
  "/inventory/inventarios/:id",
  "/inventory/reposicao",
  "/inventory/locais",
  "/finance/fluxo-de-caixa",
  "/finance/dre",
  "/finance/contas-bancarias",
  "/finance/conciliacao",
  "/finance/categorias",
  "/finance/recorrentes",
  "/hr/banco-de-horas",
  "/hr/manage/colaboradores/:id",
  "/hr/manage/banco-de-horas",
  "/hr/manage/admissoes",
  "/imports/historico",
  "/reports/vendas",
  "/reports/contas",
  "/reports/estoque",
  "/reports/dre",
  "/settings/backup",
];

describe("registro de subpáginas", () => {
  it("tem todas as rotas que as tarefas de CRM, ERP, RH, importação, relatórios e backup usam", () => {
    expect(SUBPAGES.map((page) => page.path)).toEqual(expect.arrayContaining(REQUIRED_PATHS));
    expect(new Set(SUBPAGES.map((page) => page.path)).size).toBe(SUBPAGES.length);
    expect(new Set(SUBPAGES.map((page) => page.page)).size).toBe(SUBPAGES.length);
  });

  it("cada subpágina fica dentro da raiz do seu módulo e o módulo existe em visibleModules", () => {
    const allModules = visibleModules("ceo");
    for (const section of MODULE_SECTIONS) expect(allModules, section.module).toContain(section.module);
    for (const page of SUBPAGES) {
      const section = MODULE_SECTIONS.find((item) => item.module === page.module);
      expect(section, page.path).toBeDefined();
      expect(page.path.startsWith(`${section!.rootPath}/`), page.path).toBe(true);
      expect(sectionForPath(page.path.replace(/:id/, "x"))?.module, page.path).toBe(page.module);
    }
  });

  it("exige só recursos e ações que existem no RBAC", () => {
    for (const page of SUBPAGES) {
      expect(page.requires.length, page.path).toBeGreaterThan(0);
      for (const requirement of page.requires) {
        expect(RESOURCES, page.path).toContain(requirement.resource);
        if (requirement.action) expect(ACTIONS, page.path).toContain(requirement.action);
      }
    }
  });

  it("cada subpágina tem página provisória com export default XxxPage, no módulo certo", () => {
    for (const page of SUBPAGES) {
      expect(exists(`modules/${page.page}`), page.page).toBe(true);
      const name = page.page.split("/").pop()!.replace(/\.tsx$/, "");
      expect(name, page.page).toMatch(/Page$/);
      expect(source(`modules/${page.page}`), page.page).toMatch(new RegExp(`export default function ${name}\\(`));
    }
  });

  it("listas aceitam subrotas (/*); detalhes (:id) não", () => {
    expect(subpageRoutePath(byPath("/finance/dre"))).toBe("/finance/dre/*");
    expect(subpageRoutePath(byPath("/crm/propostas/:id"))).toBe("/crm/propostas/:id");
    expect(isDetailPage(byPath("/crm/clientes/:id"))).toBe(true);
    expect(isDetailPage(byPath("/crm/funil"))).toBe(false);
  });

  it("as raízes dos módulos com subpáginas aceitam subrotas em routes.tsx e as subpáginas vêm do registro", () => {
    const routes = source("app/routes.tsx");
    for (const section of MODULE_SECTIONS.filter((item) => item.rootPath !== "/hr")) {
      expect(routes, section.module).toContain(`path="${section.rootPath}/*" element={<RequireModule module="${section.module}">`);
    }
    expect(routes).toContain(`path="/hr" element={<RequireModule module="hr">`);
    expect(routes).toMatch(/SUBPAGES\.map\(/);
  });
});

describe("quem abre cada subpágina", () => {
  it("CEO e Administração abrem todas", () => {
    for (const role of ["ceo", "admin"] as const) for (const page of SUBPAGES) expect(canOpenSubpage(role, page), `${role} ${page.path}`).toBe(true);
  });

  it("precisa ver o módulo e ter cada permissão exigida", () => {
    for (const role of TEST_ROLES) {
      const modules = visibleModules(role);
      for (const page of SUBPAGES) {
        const expected = modules.includes(page.module) && page.requires.every((item) => can(role, item.action ?? "view", item.resource));
        expect(canOpenSubpage(role, page), `${role} ${page.path}`).toBe(expected);
      }
    }
  });

  it("exemplos por setor", () => {
    expect(canOpenSubpage("financeiro", byPath("/finance/dre"))).toBe(true);
    expect(canOpenSubpage("financeiro", byPath("/finance/conciliacao"))).toBe(true);
    expect(canOpenSubpage("comercial", byPath("/finance/dre"))).toBe(false);
    expect(canOpenSubpage("comercial", byPath("/crm/funil"))).toBe(true);
    expect(canOpenSubpage("comercial", byPath("/crm/duplicados"))).toBe(true);
    expect(canOpenSubpage("atendimento", byPath("/crm/funil"))).toBe(false);
    expect(canOpenSubpage("atendimento", byPath("/crm/atividades"))).toBe(true);
    expect(canOpenSubpage("atendimento", byPath("/crm/duplicados"))).toBe(false);
    expect(canOpenSubpage("estoquista", byPath("/reports/estoque"))).toBe(true);
    expect(canOpenSubpage("estoquista", byPath("/reports/vendas"))).toBe(false);
    expect(canOpenSubpage("estoquista", byPath("/purchasing/fornecedores"))).toBe(true);
    expect(canOpenSubpage("comercial", byPath("/reports/vendas"))).toBe(true);
    expect(canOpenSubpage("rh", byPath("/hr/manage/banco-de-horas"))).toBe(true);
    expect(canOpenSubpage("tecnico", byPath("/hr/manage/banco-de-horas"))).toBe(false);
    expect(canOpenSubpage("tecnico", byPath("/hr/banco-de-horas"))).toBe(true);
    expect(TEST_ROLES.filter((role) => canOpenSubpage(role, byPath("/settings/backup")))).toEqual(["ceo", "admin"]);
  });
});

describe("navegação do módulo", () => {
  it("abas = raiz + subpáginas de lista que o papel abre (detalhes ficam de fora)", () => {
    const finance = moduleNavItems("financeiro", "finance").map((item) => item.label);
    expect(finance).toEqual(["Contas a pagar e receber", "Fluxo de caixa", "DRE", "Contas bancárias", "Conciliação", "Plano de contas", "Recorrências"]);
    const crm = moduleNavItems("atendimento", "crm").map((item) => item.path);
    expect(crm).toEqual(["/crm", "/crm/contatos", "/crm/atividades"]);
    expect(moduleNavItems("rh", "finance")).toEqual([]);
    expect(moduleNavItems("rh", "settings").map((item) => item.path)).toEqual(["/settings"]);
    expect(moduleNavItems("admin", "settings").map((item) => item.path)).toEqual(["/settings", "/settings/backup"]);
    for (const role of TEST_ROLES) {
      for (const section of MODULE_SECTIONS) {
        for (const item of moduleNavItems(role, section.module).slice(1)) {
          expect(canOpenSubpage(role, byPath(item.path)), `${role} ${item.path}`).toBe(true);
        }
      }
    }
  });

  it("aba ativa = caminho mais longo que contém a URL (detalhe acende a lista dele)", () => {
    const paths = ["/sales", "/sales/faturas"];
    expect(activeNavPath(paths, "/sales")).toBe("/sales");
    expect(activeNavPath(paths, "/sales/pedidos/12")).toBe("/sales");
    expect(activeNavPath(paths, "/sales/faturas")).toBe("/sales/faturas");
    expect(activeNavPath(["/sales/faturas", "/sales"], "/sales/faturas/9")).toBe("/sales/faturas");
    expect(activeNavPath(paths, "/salesforce")).toBeNull();
  });

  it("seção pela URL: o prefixo mais longo vence (/hr/manage antes de /hr)", () => {
    expect(sectionForPath("/hr/manage/banco-de-horas")?.module).toBe("hr_manage");
    expect(sectionForPath("/hr/banco-de-horas")?.module).toBe("hr");
    expect(sectionForPath("/hr")?.module).toBe("hr");
    expect(sectionForPath("/finance")?.module).toBe("finance");
    expect(sectionForPath("/opportunities")).toBeUndefined();
    expect(sectionForPath("/")).toBeUndefined();
  });

  it("a busca (CommandMenu) e o AppShell usam o registro", () => {
    expect(source("app/layout/CommandMenu.tsx")).toMatch(/SUBPAGES/);
    expect(source("app/layout/AppShell.tsx")).toMatch(/<ModuleNav \/>/);
  });
});
