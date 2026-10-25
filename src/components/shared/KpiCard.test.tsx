// Card do topo das telas: só título e número grande (nada de texto embaixo do número). StatCard é o mesmo card.
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderPage } from "@/test/pageHarness";
import { KpiCard } from "./KpiCard";
import { StatCard } from "./StatCard";

function render(node: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(node);
  return host;
}

const valueOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-kpi-value]")!;

/** Larguras do valor do card (o jsdom não faz layout) e fonte computada de 48 px; devolve quem desfaz. */
function stubMeasures(widths: { client: number; scroll: number }): () => void {
  const isValue = (element: unknown) => element instanceof HTMLElement && element.hasAttribute("data-kpi-value");
  const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!.get!;
  const scrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!.get!;
  const computed = window.getComputedStyle.bind(window);
  const spies = [
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return isValue(this) ? widths.client : clientWidth.call(this);
    }),
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
      return isValue(this) ? widths.scroll : scrollWidth.call(this);
    }),
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => (isValue(element) ? ({ fontSize: "48px" } as CSSStyleDeclaration) : computed(element, pseudo))),
  ];
  return () => {
    for (const spy of spies) spy.mockRestore();
  };
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

  it("valor comprido demais nunca vaza do card: corta com reticências e mostra o texto inteiro na dica", () => {
    const host = render(<KpiCard title="Próximo passo" value="Ligar para confirmar a proposta revisada de implantação" />);
    const value = host.querySelector<HTMLElement>("[data-kpi-value]")!;
    expect(value.className).toContain("overflow-hidden");
    expect(value.className).toContain("text-ellipsis");
    expect(value.getAttribute("title")).toBe("Ligar para confirmar a proposta revisada de implantação");
    expect(render(<KpiCard title="Vencido" value={<span>3</span>} />).querySelector("[data-kpi-value]")?.hasAttribute("title")).toBe(false);
  });

  it("valor mais largo que o card encolhe a fonte (até 20 px); valor que cabe fica no tamanho padrão", async () => {
    const widths = { client: 100, scroll: 300 };
    const restore = stubMeasures(widths);
    try {
      const wide = await renderPage(<KpiCard title="Saldo" value="R$ 1.234.567,89" />, { companyId: "empresa-1" });
      expect(valueOf(wide.container).style.fontSize).toBe("20px");
      wide.unmount();

      widths.scroll = 140;
      const medium = await renderPage(<KpiCard title="Saldo" value="R$ 12.345,67" />, { companyId: "empresa-1" });
      expect(valueOf(medium.container).style.fontSize).toBe("34px");
      medium.unmount();

      widths.scroll = 80;
      const fits = await renderPage(<KpiCard title="Saldo" value="R$ 10,00" />, { companyId: "empresa-1" });
      expect(valueOf(fits.container).style.fontSize).toBe("");
      fits.unmount();
    } finally {
      restore();
    }
  });

  it("mede de novo quando a fonte de exibição termina de carregar (o texto alarga sem a caixa mudar de tamanho)", async () => {
    const widths = { client: 124, scroll: 120 };
    const restore = stubMeasures(widths);
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      const page = await renderPage(<KpiCard title="Contato principal" value="Nenhum" />, { companyId: "empresa-1" });
      expect(valueOf(page.container).style.fontSize).toBe("");

      // Com a fonte carregada, "Nenhum" passa a ocupar 129 px numa caixa de 124 px.
      widths.scroll = 129;
      await act(async () => {
        fonts.dispatchEvent(new Event("loadingdone"));
      });
      expect(valueOf(page.container).style.fontSize).toBe("46px");
      page.unmount();
    } finally {
      delete (document as { fonts?: unknown }).fonts;
      restore();
    }
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
