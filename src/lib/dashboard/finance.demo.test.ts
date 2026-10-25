// @vitest-environment jsdom
// Os números do topo do Dashboard também rodam no banco demo do navegador (SQL por padrões de texto, sem JOIN/SUM/<).
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_COMPANY_ID, createDemoDb } from "@/lib/db/demo";
import { addPayable, addReceivable, addRecurring, addSettlement, insertRow } from "@/test/financeFixtures";
import { setCompanySetting } from "@/lib/settings/companySettings";
import { AREA_PROFILE_SETTING } from "@/lib/labels/store";
import { todayIso } from "@/lib/utils";
import { activeWorkCount, annualBalance, loadDashboardOverview, monthResult, weekPayables, weekReceivables } from "./finance";

const C = "empresa-dashboard-demo";
const TODAY = "2026-10-21";

beforeEach(() => localStorage.clear());

describe("Dashboard financeiro no banco demo", () => {
  it("resultado do mês, semana, trabalhos ativos e balanço com recorrência", async () => {
    const db = createDemoDb();
    await addReceivable(db, C, { id: "r1", amount: 10000, due_date: "2026-10-02", status: "recebida", received_amount: 10000, received_at: "2026-10-02" });
    await addSettlement(db, C, { id: "s1", receivable_id: "r1", amount: 10000, paid_at: "2026-10-02" });
    await addPayable(db, C, { id: "p1", amount: 12500, due_date: "2026-10-03", status: "paga", paid_amount: 12500, paid_at: "2026-10-03" });
    await addReceivable(db, C, { id: "r2", amount: 300, due_date: TODAY });
    await addReceivable(db, C, { id: "r3", amount: 200, due_date: "2026-10-25" });
    await addReceivable(db, C, { id: "r4", amount: 999, due_date: "2026-10-26" });
    await addPayable(db, C, { id: "p2", amount: 80, due_date: "2026-10-22" });
    await addRecurring(db, C, { id: "rec", amount: 100, day_of_month: 5, start_date: "2026-01-01", last_competence: "2026-10" });
    await insertRow(db, "customers", { id: "c1", company_id: C, name: "Cliente" });
    await insertRow(db, "projects", { id: "pr1", company_id: C, name: "Caso 1", status: "andamento", customer_id: "c1" });
    await insertRow(db, "projects", { id: "pr2", company_id: C, name: "Caso 2", status: "planejado", customer_id: "c1" });
    await insertRow(db, "projects", { id: "pr3", company_id: C, name: "Encerrado", status: "concluido" });

    expect((await monthResult(db, C, "2026-10")).result).toBe(-2500);
    expect(await weekReceivables(db, C, TODAY)).toMatchObject({ total: 500, count: 2 });
    expect(await weekPayables(db, C, TODAY)).toMatchObject({ total: 80, count: 1 });
    expect(await activeWorkCount(db, C)).toBe(2);
    await setCompanySetting(db, C, AREA_PROFILE_SETTING, "advocacia");
    expect(await activeWorkCount(db, C)).toBe(1);

    const points = await annualBalance(db, C, 2026, { today: TODAY });
    expect(points[9]).toMatchObject({ realizado: -2500, acumulado: -2500, previsto: -2500 + 500 + 999 - 80 });
    expect(points[10]).toEqual({ month: "2026-11", realizado: null, acumulado: null, previsto: -100 });
  });

  it("empresa demo semeada: todos os números carregam sem erro de SQL do demo", async () => {
    const db = createDemoDb();
    const overview = await loadDashboardOverview(db, DEMO_COMPANY_ID, { today: todayIso(), finance: true, work: true });
    for (const [key, loaded] of Object.entries(overview)) expect(loaded, key).toMatchObject({ ok: true });
    expect(Object.keys(overview).sort()).toEqual(["activeWork", "balance", "month", "payables", "receivables"]);
  });
});
