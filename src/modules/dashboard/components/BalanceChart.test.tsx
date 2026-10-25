// Balanço anual da home no gráfico de linha compartilhado: três cores (realizado, acumulado, previsão tracejada),
// gradiente da cor de cada linha embaixo dela e o último mês com respiro da borda direita.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnnualBalancePoint } from "@/lib/dashboard/finance";
import { CHART_MARGIN, X_PADDING, seriesColor } from "@/components/shared/charts/LineAreaChart";
import { pathXs, stubChartSize } from "@/test/charts";
import { BalanceChart } from "./BalanceChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WIDTH = 720;
const LABELS = { title: "Balanço anual", realized: "Resultado do mês", accumulated: "Acumulado no ano", forecast: "Previsão de receita" };

/** Ano de 2026 com hoje em junho: realizado e acumulado até junho, previsão de maio (emenda) até dezembro. */
const POINTS: AnnualBalancePoint[] = Array.from({ length: 12 }, (_, index) => {
  const month = `2026-${String(index + 1).padStart(2, "0")}`;
  const closed = index <= 5;
  return { month, realizado: closed ? 100 * (index + 1) : null, acumulado: closed ? 50 * (index + 1) * (index + 2) : null, previsto: 100 * (index + 1) };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let restore: (() => void) | null = null;

beforeEach(() => {
  restore = stubChartSize(WIDTH, 288);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  restore?.();
  root = host = restore = null;
});

function mount(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<BalanceChart points={POINTS} today="2026-06-15" labels={LABELS} />));
  return host;
}

describe("BalanceChart", () => {
  it("cada linha tem uma cor da paleta de séries, com a previsão tracejada, e a legenda usa as mesmas cores", () => {
    const view = mount();
    const curves = [...view.querySelectorAll("[data-chart='balance'] .recharts-line-curve")];
    expect(curves.map((curve) => curve.getAttribute("stroke"))).toEqual([seriesColor(0), seriesColor(1), seriesColor(2)]);
    expect(curves.map((curve) => curve.getAttribute("stroke-dasharray"))).toEqual([null, null, "6 5"]);
    const legend = [...view.querySelectorAll("[data-chart='balance'] header li")];
    expect(legend.map((item) => item.textContent)).toEqual(["Resultado do mês", "Acumulado no ano", "Previsão de receita"]);
    expect(legend.map((item) => item.querySelector("line")?.getAttribute("stroke"))).toEqual([seriesColor(0), seriesColor(1), seriesColor(2)]);
  });

  it("embaixo de cada linha há um gradiente da cor dela", () => {
    const view = mount();
    const areas = [...view.querySelectorAll("[data-chart='balance'] .recharts-area-area")];
    expect(areas).toHaveLength(3);
    areas.forEach((area, index) => {
      const id = /^url\(#(.+)\)$/.exec(area.getAttribute("fill") ?? "")?.[1];
      const stops = [...(view.querySelector(`linearGradient[id="${id}"]`)?.querySelectorAll("stop") ?? [])];
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of stops) expect(stop.getAttribute("stop-color")).toBe(seriesColor(index));
    });
  });

  it("dezembro (último ponto da previsão) fica com respiro da borda direita", () => {
    const view = mount();
    const forecast = view.querySelectorAll("[data-chart='balance'] .recharts-line-curve")[2];
    const xs = pathXs(forecast.getAttribute("d"));
    expect(xs.length).toBeGreaterThan(1);
    expect(xs[xs.length - 1]).toBeCloseTo(WIDTH - CHART_MARGIN.right - X_PADDING, 0);
  });
});
