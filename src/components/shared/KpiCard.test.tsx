// Card do topo das telas: só título e número grande (nada de texto embaixo do número). StatCard é o mesmo card.
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiCard } from "./KpiCard";
import { StatCard } from "./StatCard";

function render(node: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(node);
  return host;
}

describe("KpiCard", () => {
  it("não renderiza texto além do título e do valor", () => {
    const host = render(<KpiCard title="A receber" value="R$ 1.234,56" />);
    const texts = [...host.querySelectorAll("*")].filter((element) => element.children.length === 0).map((element) => element.textContent?.trim()).filter(Boolean);
    expect(texts).toEqual(["A receber", "R$ 1.234,56"]);
    expect(host.textContent).toBe("A receber" + "R$ 1.234,56");
  });

  it("valor grande (clamp de 2rem a 3rem) e aceita valor com marcação (ex.: número em vermelho)", () => {
    const host = render(<KpiCard title="Vencido" value={<span className="text-destructive">3</span>} />);
    const value = host.querySelector("[data-kpi-value]");
    expect(value?.className).toContain("text-[clamp(2rem,3vw,3rem)]");
    expect(value?.textContent).toBe("3");
    expect(host.querySelector(".text-destructive")).not.toBeNull();
  });

  it("a API não tem subtítulo, tendência, dica, ícone nem gráfico", () => {
    // @ts-expect-error subtitle saiu da API
    render(<KpiCard title="a" value={1} subtitle="x" />);
    // @ts-expect-error trend saiu da API
    render(<KpiCard title="a" value={1} trend={{ value: 1, label: "x" }} />);
    // @ts-expect-error hint (do StatCard antigo) não existe
    render(<StatCard title="a" value={1} hint="x" />);
    // @ts-expect-error kind (do StatCard antigo) não existe
    render(<StatCard title="a" value="x" kind="text" />);
    expect(StatCard).toBe(KpiCard);
  });
});
