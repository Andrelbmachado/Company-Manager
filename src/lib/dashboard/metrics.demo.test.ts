// @vitest-environment jsdom
// A home de todos os papéis carrega no banco demo do navegador (só SQL nos padrões do demo), com e sem os dados de exemplo.
import { describe, expect, it, vi } from "vitest";
import { TEST_ROLES } from "@/test/sqlite";
import { todayIso } from "@/lib/utils";
import { roleHome } from "./roleHomes";
import { loadHomeMetrics } from "./metrics";
import type { Role } from "@/types";

vi.mock("@/lib/db/client", async () => {
  const { getDemoDb } = await import("@/lib/db/demo");
  return { getDb: async () => getDemoDb(), isTauriRuntime: () => false };
});

const DEMO_USERS: Record<Role, string> = {
  ceo: "demo-ceo",
  admin: "demo-admin",
  gerente: "demo-gerente",
  tecnico: "demo-tecnico",
  estoquista: "demo-estoquista",
  financeiro: "demo-financeiro",
  rh: "demo-rh",
  comercial: "demo-comercial",
  atendimento: "demo-atendimento",
  produtos: "demo-produtos",
  auditor: "demo-auditor",
};

async function loadAll() {
  const { DEMO_COMPANY_ID, getDemoDb } = await import("@/lib/db/demo");
  const failures: string[] = [];
  const values: Record<string, number> = {};
  for (const role of TEST_ROLES) {
    const ctx = { companyId: DEMO_COMPANY_ID, userId: DEMO_USERS[role], role, today: todayIso(), now: new Date() };
    const results = await loadHomeMetrics(getDemoDb(), ctx, roleHome(role));
    for (const [id, result] of Object.entries(results)) {
      if (!result.ok) failures.push(`${role} → ${id}: ${result.error}`);
      else values[`${role}:${id}`] = result.metric.value;
    }
  }
  return { failures, values };
}

describe("home por setor no banco demo", () => {
  it("todos os papéis carregam sem erro de SQL do demo (dados de fábrica do demo)", async () => {
    localStorage.clear();
    const { failures, values } = await loadAll();
    expect(failures).toEqual([]);
    // Dados de fábrica do demo: há férias da equipe, clientes e itens de estoque.
    expect(values["rh:hr.pendingRequests"]).toBeGreaterThan(0);
    expect(values["comercial:crm.customers"]).toBeGreaterThan(0);
  });

  it("e depois dos dados de exemplo de todas as áreas", async () => {
    localStorage.clear();
    const { runAreaSeeds } = await import("@/lib/dev/seeds");
    const { DEMO_COMPANY_ID } = await import("@/lib/db/demo");
    await runAreaSeeds(DEMO_COMPANY_ID);
    const { failures, values } = await loadAll();
    expect(failures).toEqual([]);
    expect(values["rh:hr.timeBankPending"]).toBeGreaterThan(0);
    expect(values["financeiro:bank.pendingReconciliation"]).toBeGreaterThanOrEqual(0);
    expect(values["comercial:crm.openProposals"]).toBeGreaterThan(0);
  });
});
