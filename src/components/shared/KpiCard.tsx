import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: ReactNode;
  className?: string;
}

/** Menor tamanho (px) a que o valor encolhe para caber na largura do card. */
const MIN_VALUE_PX = 20;

/**
 * O texto passa da caixa por uma fração de pixel? clientWidth e scrollWidth são inteiros (186,75 e 187,09 px viram os
 * dois 187), mas 0,3 px a mais já mostra as reticências ("R$ 286.500,…"). Sem Range medível (jsdom), devolve false.
 */
function overflowsSubpixel(element: HTMLElement): boolean {
  const range = document.createRange();
  if (typeof range.getBoundingClientRect !== "function") return false;
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width > element.getBoundingClientRect().width;
}

/**
 * Card do topo das telas: só o título e o número grande (nada de texto embaixo do número). Valor comprido
 * (ex.: R$ 1.234.567,89 num card estreito) encolhe até caber; texto que nem com 20 px cabe (nome, assunto) é
 * cortado com reticências, com o valor inteiro na dica, em vez de vazar por cima dos cards vizinhos.
 */
export function KpiCard({ title, value, className }: KpiCardProps) {
  const valueRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const element = valueRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let width = -1;
    const fit = () => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      element.style.fontSize = "";
      if (!width || (element.scrollWidth <= width && !overflowsSubpixel(element))) return;
      const size = parseFloat(getComputedStyle(element).fontSize);
      let next = Math.max(MIN_VALUE_PX, Math.floor((size * width) / Math.max(width, element.scrollWidth)));
      element.style.fontSize = `${next}px`;
      // A conta proporcional usa larguras inteiras: confere com fração de pixel e desce 1 px enquanto ainda passar.
      while (next > MIN_VALUE_PX && overflowsSubpixel(element)) element.style.fontSize = `${--next}px`;
    };
    // A fonte de exibição costuma terminar de carregar depois da primeira medida: o texto alarga sem a caixa mudar de
    // tamanho (o ResizeObserver não percebe), então mede de novo quando as fontes terminam de carregar.
    const refit = () => {
      width = -1;
      fit();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    const fonts = document.fonts as FontFaceSet | undefined;
    let active = true;
    void fonts?.ready.then(() => {
      if (active) refit();
    });
    fonts?.addEventListener("loadingdone", refit);
    return () => {
      active = false;
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", refit);
    };
  }, [value]);

  return (
    <div className={cn("kpi-card flex min-w-0 flex-col gap-3 p-5", className)}>
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p
        ref={valueRef}
        data-kpi-value=""
        title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}
        className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[clamp(2rem,3vw,3rem)] font-bold leading-none tracking-tight tabular-nums"
      >
        {value}
      </p>
    </div>
  );
}
