// Home por setor: cada papel recebe só widgets do que pode ver, e os links levam a telas que ele abre.
import { describe, expect, it } from "vitest";
import { can, visibleModules } from "@/lib/permissions/rbac";
import { canOpenSubpage, SUBPAGES } from "@/app/subpages";
import { TEST_ROLES } from "@/test/sqlite";
import { HOME_WIDGETS, ROLE_HOMES, isPersonalWidget, roleHome, widgetVisible, type HomeWidget } from "./roleHomes";
import type { Role } from "@/types";

/** Subpágina cuja rota (com :id) casa com o caminho do widget. */
function subpageFor(path: string) {
  return SUBPAGES.find((page) => new RegExp(`^${page.path.replace(/:[^/]+/g, "[^/]+")}$`).test(path));
}

/** O papel abre o caminho? Módulo visível e, se for subpágina, a guarda dela (a mesma do routes.tsx). */
function opens(role: Role, widget: HomeWidget): boolean {
  if (!visibleModules(role).includes(widget.module)) return false;
  const page = subpageFor(widget.path);
  return page ? page.module === widget.module && canOpenSubpage(role, page) : true;
}

describe("roleHome", () => {
  it("cobre os 11 papéis", () => {
    expect(TEST_ROLES).toHaveLength(11);
    for (const role of TEST_ROLES) {
      expect(ROLE_HOMES[role], role).toBeDefined();
    }
  });

  it.each(TEST_ROLES)("%s: todo widget exige só o que o papel pode (nenhum vazamento)", (role) => {
    const widgets = roleHome(role);
    for (const widget of widgets) {
      expect(widget.requires.length, widget.id).toBeGreaterThan(0);
      for (const requirement of widget.requires) {
        expect(can(role, "view", requirement.resource), `${role} → ${widget.id} (${requirement.resource})`).toBe(true);
        expect(can(role, requirement.action ?? "view", requirement.resource), `${role} → ${widget.id} (${requirement.action} ${requirement.resource})`).toBe(true);
      }
    }
  });

  it.each(TEST_ROLES)("%s: todo widget leva a uma tela que o papel abre", (role) => {
    for (const widget of roleHome(role)) expect(opens(role, widget), `${role} → ${widget.id} (${widget.path})`).toBe(true);
  });

  it.each(TEST_ROLES)("%s: pelo menos 3 widgets do setor (o Meu RH tem tela própria)", (role) => {
    const widgets = roleHome(role);
    expect(widgets.length, role).toBeGreaterThanOrEqual(3);
    expect(widgets.some(isPersonalWidget), `${role}: Meu RH`).toBe(false);
  });

  it.each(TEST_ROLES)("%s: a configuração não esconde nada (todo widget listado para o papel é visível)", (role) => {
    // Se o RBAC mudar e um widget configurado deixar de ser visível, o teste aponta qual: ajuste ROLE_HOMES.
    for (const id of ROLE_HOMES[role]) expect(widgetVisible(role, HOME_WIDGETS[id]), `${role} → ${id}`).toBe(true);
    expect(roleHome(role).map((widget) => widget.id)).toEqual([...ROLE_HOMES[role]]);
  });

  it("ids de widget únicos por papel e todos no catálogo", () => {
    for (const role of TEST_ROLES) {
      const ids = ROLE_HOMES[role];
      expect(new Set(ids).size, role).toBe(ids.length);
      for (const id of ids) expect(HOME_WIDGETS[id], id).toBeDefined();
    }
    for (const [id, widget] of Object.entries(HOME_WIDGETS)) expect(widget.id).toBe(id);
  });

  it("roleHome filtra pelo RBAC mesmo se a configuração pedir mais (defesa em profundidade)", () => {
    const payroll = HOME_WIDGETS["payroll.monthly"];
    expect(widgetVisible("rh", payroll)).toBe(false);
    expect(widgetVisible("ceo", payroll)).toBe(true);
    expect(widgetVisible("estoquista", HOME_WIDGETS["fin.overdueReceivables"])).toBe(false);
  });

  it("cada setor tem o essencial dele", () => {
    const ids = (role: Role) => roleHome(role).map((widget) => widget.id);
    expect(ids("comercial")).toEqual(expect.arrayContaining(["crm.pipeline", "crm.followups"]));
    expect(ids("financeiro")).toEqual(expect.arrayContaining(["fin.overdueReceivables", "fin.overduePayables"]));
    expect(ids("estoquista")).toEqual(expect.arrayContaining(["pur.toReceive", "inv.openCounts"]));
    expect(ids("rh")).toEqual(expect.arrayContaining(["hr.pendingRequests", "hr.timeBankPending", "hr.cycle"]));
    expect(ids("tecnico")).toEqual(expect.arrayContaining(["support.openTickets", "ops.openWorkOrders"]));
    expect(ids("ceo")).toEqual(expect.arrayContaining(["payroll.monthly"]));
  });

  it("nenhuma home tem fluxo de 7 dias, abaixo do mínimo, últimas ações, atalhos ou Meu RH", () => {
    for (const role of TEST_ROLES) {
      const ids = roleHome(role).map((widget) => widget.id);
      for (const gone of ["fin.cashflow7", "inv.belowMin", "audit.recent"]) expect(ids, `${role}: ${gone}`).not.toContain(gone);
      expect(roleHome(role).filter((widget) => widget.kind === "shortcut"), role).toEqual([]);
      expect(roleHome(role).filter((widget) => widget.module === "hr"), role).toEqual([]);
    }
  });

  it("RH e CEO continuam com Solicitações de RH a decidir", () => {
    for (const role of ["rh", "ceo", "admin"] as const) expect(roleHome(role).map((widget) => widget.id), role).toContain("hr.pendingRequests");
  });

  it("RH não vê salário; só CEO e admin veem a folha na home", () => {
    for (const role of TEST_ROLES) {
      const hasPayroll = roleHome(role).some((widget) => widget.requires.some((requirement) => requirement.resource === "payroll"));
      expect(hasPayroll, role).toBe(role === "ceo" || role === "admin");
    }
  });
});
