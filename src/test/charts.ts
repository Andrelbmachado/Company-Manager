// O jsdom não faz layout: o ResponsiveContainer do recharts mede 0×0 e não desenha nada. Aqui ele passa a medir
// `width`×`height` (e ganha um ResizeObserver de mentira), para conferir o SVG do gráfico em teste de componente.
import { vi } from "vitest";

export function stubChartSize(width = 600, height = 288): () => void {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const measure = HTMLElement.prototype.getBoundingClientRect;
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("recharts-responsive-container")) {
      return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return measure.call(this);
  });
  return () => {
    spy.mockRestore();
    globalThis.ResizeObserver = original;
  };
}

/** Coordenadas x de um traço do SVG ("M x,y L x,y ..."). */
export function pathXs(d: string | null | undefined): number[] {
  return [...(d ?? "").matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((match) => Number(match[1]));
}
