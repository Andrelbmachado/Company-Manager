// Fluxo de caixa na tela: saldo inicial da conta, realizado (baixa) e previsto (conta em aberto), detalhe do dia.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addReceivable, addSettlement } from "@/test/financeFixtures";
import { click, plain, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { todayIso } from "@/lib/utils";
import { CHART_MARGIN, X_PADDING, seriesColor } from "@/components/shared/charts/LineAreaChart";
import { pathXs, stubChartSize } from "@/test/charts";
import CashflowPage from "./CashflowPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

let restoreChart: (() => void) | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  restoreChart?.();
  restoreChart = null;
});

/** Valor do card do topo pelo título (o card só tem título e número). */
const kpi = (scope: ParentNode, title: string) =>
  plain([...scope.querySelectorAll(".kpi-card")].find((card) => card.firstElementChild?.textContent === title)?.querySelector("[data-kpi-value]")?.textContent);

describe("CashflowPage", () => {
  it("mostra saldo inicial, entradas realizadas e previstas e o detalhe do dia", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-fluxo", roles: ["financeiro"] });
    const month = todayIso().slice(0, 7);
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", opening_balance: 1000, opening_date: "2020-01-01", is_default: 1 });
    await addReceivable(db, companyId, { id: "r1", description: "Venda balcão", amount: 500, status: "recebida", received_amount: 500, received_at: `${month}-01` });
    await addSettlement(db, companyId, { id: "s1", receivable_id: "r1", amount: 500, paid_at: `${month}-01`, bank_account_id: "banco" });
    await addReceivable(db, companyId, { id: "r2", description: "Mensalidade cliente", amount: 300, due_date: `${month}-28` });

    page = await renderPage(<CashflowPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("R$ 1.800,00"), "saldo final com o previsto");
    expect(kpi(view.container, "Saldo inicial")).toBe("R$ 1.000,00");
    expect(kpi(view.container, "Entradas")).toBe("R$ 800,00");

    await click([...view.container.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes(`01/${month.slice(5, 7)}/${month.slice(0, 4)}`)));
    await until(() => view.text().includes("Venda balcão"), "movimento do dia");
    expect(view.text()).toContain("Realizado · Baixa · Banco Principal");

    await click([...view.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")][0]);
    await until(() => kpi(view.container, "Saldo final") === "R$ 1.500,00" && kpi(view.container, "Entradas") === "R$ 500,00", "só realizado");
  });

  it("gráfico: saldo em linha colorida com gradiente embaixo, barras de entradas e saídas e o último dia com respiro", async () => {
    restoreChart = stubChartSize(640, 288);
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-fluxo-grafico", roles: ["financeiro"] });
    const month = todayIso().slice(0, 7);
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", opening_balance: 1000, opening_date: "2020-01-01", is_default: 1 });
    await addReceivable(db, companyId, { id: "r1", description: "Venda balcão", amount: 500, status: "recebida", received_amount: 500, received_at: `${month}-01` });
    await addSettlement(db, companyId, { id: "s1", receivable_id: "r1", amount: 500, paid_at: `${month}-01`, bank_account_id: "banco" });

    page = await renderPage(<CashflowPage />, { companyId });
    const view = page;
    await until(() => view.container.querySelector("[aria-label='Gráfico do fluxo de caixa'] .recharts-line-curve") !== null, "gráfico desenhado");
    const chart = view.container.querySelector("[aria-label='Gráfico do fluxo de caixa']")!;

    const line = chart.querySelector(".recharts-line-curve")!;
    expect(line.getAttribute("stroke")).toBe(seriesColor(0));
    const area = chart.querySelector(".recharts-area-area")!;
    const id = /^url\(#(.+)\)$/.exec(area.getAttribute("fill") ?? "")?.[1];
    const stops = [...(chart.querySelector(`linearGradient[id="${id}"]`)?.querySelectorAll("stop") ?? [])];
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const stop of stops) expect(stop.getAttribute("stop-color")).toBe(seriesColor(0));
    expect(chart.querySelectorAll(".recharts-bar")).toHaveLength(2);

    const xs = pathXs(line.getAttribute("d"));
    expect(xs[xs.length - 1]).toBeLessThanOrEqual(640 - CHART_MARGIN.right - X_PADDING + 0.5);
    const legend = [...chart.querySelectorAll("li")].map((item) => item.textContent?.trim());
    expect(legend).toEqual(["Entradas", "Saídas", "Saldo"]);
    expect(chart.querySelector("li:last-child line")?.getAttribute("stroke")).toBe(seriesColor(0));
  });
});
