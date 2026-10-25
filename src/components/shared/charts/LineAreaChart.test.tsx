// Gráfico de linha compartilhado: cor própria por série (paleta --chart-1..6), gradiente da cor da linha embaixo de
// cada uma (id único por gráfico), previsão tracejada e respiro nas bordas para o primeiro e o último ponto.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Bar } from "recharts";
import { pathXs } from "@/test/charts";
import { CHART_MARGIN, CHART_PALETTE_SIZE, ChartLegend, LineAreaChart, X_PADDING, seriesColor, type LineAreaSeries } from "./LineAreaChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = [
  { mes: "jan", a: 10, b: 4, c: 1 },
  { mes: "fev", a: 14, b: 6, c: 3 },
  { mes: "mar", a: 9, b: 8, c: 5 },
  { mes: "abr", a: 18, b: 7, c: 4 },
  { mes: "mai", a: 21, b: 11, c: 9 },
];
const SERIES: LineAreaSeries[] = [
  { key: "a", label: "Realizado", dots: true },
  { key: "b", label: "Acumulado" },
  { key: "c", label: "Previsão", dashed: true },
];
const WIDTH = 600;
const HEIGHT = 300;
const Y_AXIS = 60;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: ReactNode): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const chart = (series = SERIES, extra?: ReactNode) => (
  <LineAreaChart data={DATA} xKey="mes" series={series} width={WIDTH} height={HEIGHT} yAxisWidth={Y_AXIS}>
    {extra}
  </LineAreaChart>
);

describe("LineAreaChart", () => {
  it("cada série tem uma cor própria da paleta de séries", () => {
    const view = mount(chart());
    const strokes = [...view.querySelectorAll(".recharts-line-curve")].map((curve) => curve.getAttribute("stroke"));
    expect(strokes).toEqual([seriesColor(0), seriesColor(1), seriesColor(2)]);
    expect(new Set(strokes).size).toBe(3);
    expect(strokes[0]).toBe("hsl(var(--chart-1))");
  });

  it("a paleta tem 6 cores, recomeça depois da sexta e aceita escolher a cor da série", () => {
    expect(CHART_PALETTE_SIZE).toBe(6);
    const all = Array.from({ length: 6 }, (_, index) => seriesColor(index));
    expect(new Set(all).size).toBe(6);
    expect(seriesColor(6)).toBe(seriesColor(0));
    const view = mount(chart([{ key: "a", label: "A", colorIndex: 4 }]));
    expect(view.querySelector(".recharts-line-curve")?.getAttribute("stroke")).toBe("hsl(var(--chart-5))");
  });

  it("embaixo de cada linha há um gradiente vertical da cor dela até transparente, com id único", () => {
    const view = mount(
      <>
        {chart()}
        {chart()}
      </>,
    );
    const gradients = [...view.querySelectorAll("linearGradient")];
    expect(gradients).toHaveLength(6);
    const ids = gradients.map((gradient) => gradient.id);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][\w-]*$/);

    const first = view.querySelectorAll(".recharts-wrapper")[0];
    const areas = [...first.querySelectorAll(".recharts-area-area")];
    expect(areas).toHaveLength(3);
    areas.forEach((area, index) => {
      const fill = area.getAttribute("fill") ?? "";
      const id = /^url\(#(.+)\)$/.exec(fill)?.[1];
      expect(id).toBeTruthy();
      const gradient = first.querySelector(`linearGradient[id="${id}"]`)!;
      expect(gradient.getAttribute("x1")).toBe("0");
      expect(gradient.getAttribute("x2")).toBe("0");
      expect(gradient.getAttribute("y1")).toBe("0");
      expect(gradient.getAttribute("y2")).toBe("1");
      const stops = [...gradient.querySelectorAll("stop")];
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of stops) expect(stop.getAttribute("stop-color")).toBe(seriesColor(index));
      const opacities = stops.map((stop) => Number(stop.getAttribute("stop-opacity")));
      expect(opacities[0]).toBeGreaterThan(0);
      expect(opacities[opacities.length - 1]).toBe(0);
      expect([...opacities].sort((a, b) => b - a)).toEqual(opacities);
    });
  });

  it("a área fica embaixo da linha até o pé do gráfico (também com valores negativos) e não tem traço próprio", () => {
    const negative = DATA.map((point, index) => ({ ...point, a: point.a - 15 * (index % 2) }));
    const view = mount(<LineAreaChart data={negative} xKey="mes" series={SERIES} width={WIDTH} height={HEIGHT} yAxisWidth={Y_AXIS} />);
    // Área só preenche (sem traço próprio): o traço é da linha, que aparece uma vez por série.
    expect(view.querySelectorAll(".recharts-area-curve")).toHaveLength(0);
    expect(view.querySelectorAll(".recharts-line")).toHaveLength(3);
    // O preenchimento desce até a base do eixo (y do pé da área = fim da área de plotagem), não só até o zero.
    const bottom = HEIGHT - CHART_MARGIN.bottom - 30;
    const d = view.querySelector(".recharts-area-area")?.getAttribute("d") ?? "";
    const ys = [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((match) => Number(match[2]));
    expect(Math.max(...ys)).toBeCloseTo(bottom, 0);
  });

  it("só a série de previsão é tracejada", () => {
    const view = mount(chart());
    const dashes = [...view.querySelectorAll(".recharts-line-curve")].map((curve) => curve.getAttribute("stroke-dasharray"));
    expect(dashes[0]).toBeNull();
    expect(dashes[1]).toBeNull();
    expect(dashes[2]).toBe("6 5");
  });

  it("o primeiro e o último ponto têm respiro e não encostam nas bordas do gráfico", () => {
    expect(X_PADDING).toBeGreaterThanOrEqual(16);
    const view = mount(chart());
    const xs = pathXs(view.querySelector(".recharts-line-curve")!.getAttribute("d"));
    expect(xs).toHaveLength(DATA.length);
    const plotLeft = CHART_MARGIN.left + Y_AXIS;
    const plotRight = WIDTH - CHART_MARGIN.right;
    expect(xs[0]).toBeCloseTo(plotLeft + X_PADDING, 0);
    expect(xs[xs.length - 1]).toBeCloseTo(plotRight - X_PADDING, 0);
    // O ponto destacado (raio 4) do último mês cabe inteiro dentro do SVG.
    expect(xs[xs.length - 1] + 4).toBeLessThan(WIDTH - 8);
  });

  it("desenha elementos extras (barras) entre as áreas e as linhas", () => {
    const view = mount(chart([{ key: "a", label: "Saldo" }], <Bar dataKey="b" name="Entradas" fill="currentColor" isAnimationActive={false} />));
    const area = view.querySelector(".recharts-area")!;
    const bar = view.querySelector(".recharts-bar")!;
    const line = view.querySelector(".recharts-line")!;
    expect(bar).toBeTruthy();
    expect(area.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("com aria-label, o gráfico vira uma imagem com nome acessível", () => {
    const view = mount(
      <LineAreaChart data={DATA} xKey="mes" series={SERIES} width={WIDTH} height={HEIGHT} ariaLabel="Balanço do ano" className="h-72" />,
    );
    const figure = view.querySelector("[role=img]");
    expect(figure?.getAttribute("aria-label")).toBe("Balanço do ano");
    expect(figure?.className).toContain("h-72");
  });
});

describe("ChartLegend", () => {
  it("mostra cada série com a cor da linha e a previsão tracejada", () => {
    const legend = document.createElement("div");
    legend.innerHTML = renderToStaticMarkup(<ChartLegend series={SERIES} />);
    expect([...legend.querySelectorAll("[data-legend]")].map((item) => item.textContent)).toEqual(["Realizado", "Acumulado", "Previsão"]);
    const lines = [...legend.querySelectorAll("line")];
    expect(lines.map((line) => line.getAttribute("stroke"))).toEqual([seriesColor(0), seriesColor(1), seriesColor(2)]);
    expect(lines.map((line) => line.getAttribute("stroke-dasharray"))).toEqual([null, null, "4 3"]);
  });
});

describe("tokens da paleta de séries", () => {
  const css = readFileSync(path.resolve(__dirname, "../../../styles/globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("--chart-1 a --chart-6 existem no tema claro e no escuro, com cor (saturação > 0) e distintas", () => {
    for (const selector of [":root", ".dark"]) {
      const values = Array.from({ length: 6 }, (_, index) => {
        const match = new RegExp(`--chart-${index + 1}:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%;`).exec(block(selector));
        expect(match, `${selector} --chart-${index + 1}`).toBeTruthy();
        expect(Number(match![2])).toBeGreaterThan(0);
        return match![0].split(":")[1].trim();
      });
      expect(new Set(values).size).toBe(6);
    }
  });
});

describe("uso do LineAreaChart", () => {
  const src = path.resolve(__dirname, "../../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "project-manager" ? [] : files(full);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });

  it("nenhuma tela desenha linha ou área do recharts direto (todo gráfico de linha passa pelo componente)", () => {
    const offenders = files(src)
      .filter((file) => !file.includes(`${path.sep}components${path.sep}shared${path.sep}charts${path.sep}`))
      .filter((file) => {
        const imports = [...readFileSync(file, "utf8").matchAll(/import\s*\{([^}]*)\}\s*from\s*"recharts"/g)].flatMap((match) => match[1].split(",").map((name) => name.trim()));
        return imports.some((name) => ["Line", "LineChart", "Area", "AreaChart"].includes(name));
      })
      .map((file) => path.relative(src, file));
    expect(offenders).toEqual([]);
  });
});
