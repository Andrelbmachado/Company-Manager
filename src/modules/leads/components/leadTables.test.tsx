// Tabelas de Indicações e de Previsão da prospecção: clique no cabeçalho ordena e Filtrar filtra por coluna. Na tabela
// por segmento, a linha Total fica no topo e sai quando o filtro esconde segmentos (não soma o que não está na tela).
import { afterEach, describe, expect, it } from "vitest";
import { click, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import type { Lead, RevenueScenario } from "@/types";
import { ForecastPanel } from "./ForecastPanel";
import { ReferralPanel } from "./ReferralPanel";

let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const lead = (id: string, patch: Partial<Lead>): Lead =>
  ({ id, name: id, status: "novo", referred_by: null, referral_status: null, estimated_setup: 0, estimated_monthly: 0, estimated_revenue: 0, pricing_segment: null, category: null, ...patch }) as Lead;

const cellTexts = (table: Element, column = 0) => [...table.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[column]?.textContent);

describe("ReferralPanel", () => {
  it("quem indicou ordena por fechadas e os indicados filtram por quem indicou", async () => {
    const leads = [
      lead("Padaria", { referred_by: "Carla", status: "fechado", referral_status: "concedido", estimated_setup: 1000 }),
      lead("Mercado", { referred_by: "Bruno", status: "novo" }),
      lead("Farmácia", { referred_by: "Carla", status: "fechado", referral_status: "concedido", estimated_setup: 500 }),
      lead("Oficina", { referred_by: "Bruno", status: "fechado", referral_status: "concedido", estimated_setup: 200 }),
      lead("Clínica", { referred_by: "Ana", status: "novo" }),
    ];
    page = await renderPage(<ReferralPanel leads={leads} />, { companyId: "empresa-1" });
    const [referrers, referred] = [...document.querySelectorAll("table")];
    await click(referrers.querySelector("th [data-sort-key='closed']"));
    await click(referrers.querySelector("th [data-sort-key='closed']"));
    expect(cellTexts(referrers)).toEqual(["Carla", "Bruno", "Ana"]);

    const filters = [...document.querySelectorAll<HTMLButtonElement>("button[aria-label='Filtrar']")];
    expect(filters).toHaveLength(2);
    await click(filters[1]);
    await typeInto(document.querySelector('[aria-label="Indicado por: contém"]'), "bru");
    expect(cellTexts(referred)).toEqual(["Mercado", "Oficina"]);
    expect(cellTexts(referrers)).toEqual(["Carla", "Bruno", "Ana"]);
  });
});

describe("ForecastPanel", () => {
  const scenarios = [
    { id: "pess", label: "Pessimista", conversion_rate: 0.1 },
    { id: "otim", label: "Otimista", conversion_rate: 0.5 },
  ] as RevenueScenario[];
  const leads = [
    lead("A", { pricing_segment: "Clínicas", estimated_setup: 1000, estimated_monthly: 100, estimated_revenue: 2200 }),
    lead("B", { pricing_segment: "Advocacia", estimated_setup: 3000, estimated_monthly: 300, estimated_revenue: 6600 }),
    lead("C", { pricing_segment: "Clínicas", estimated_setup: 1000, estimated_monthly: 100, estimated_revenue: 2200 }),
  ];

  it("segmentos ordenam pelo cabeçalho com o Total fixo no topo; filtro tira o Total", async () => {
    page = await renderPage(<ForecastPanel scenarios={scenarios} leads={leads} />, { companyId: "empresa-1" });
    const segments = [...document.querySelectorAll("table")][1];
    await click(segments.querySelector("th [data-sort-key='segment']"));
    expect(cellTexts(segments)).toEqual(["Total", "Advocacia", "Clínicas"]);
    await click(segments.querySelector("th [data-sort-key='leads_count']"));
    await click(segments.querySelector("th [data-sort-key='leads_count']"));
    expect(cellTexts(segments)).toEqual(["Total", "Clínicas", "Advocacia"]);

    const filter = [...document.querySelectorAll<HTMLButtonElement>("button[aria-label='Filtrar']")][1];
    await click(filter);
    await typeInto(document.querySelector('[aria-label="Segmento: contém"]'), "adv");
    expect(cellTexts(segments)).toEqual(["Advocacia"]);
  });

  it("cenários ordenam pela receita", async () => {
    page = await renderPage(<ForecastPanel scenarios={scenarios} leads={leads} />, { companyId: "empresa-1" });
    const table = document.querySelector("table")!;
    await click(table.querySelector("th [data-sort-key='forecast_revenue']"));
    await click(table.querySelector("th [data-sort-key='forecast_revenue']"));
    expect(cellTexts(table)).toEqual(["Otimista", "Pessimista"]);
  });
});
