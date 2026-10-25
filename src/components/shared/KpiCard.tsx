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
 * Card do topo das telas: só o título e o número grande (nada de texto embaixo do número). Valor comprido
 * (ex.: R$ 1.234.567,89 num card estreito) encolhe até caber, em vez de vazar ou ser cortado.
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
      if (!width || element.scrollWidth <= width) return;
      const size = parseFloat(getComputedStyle(element).fontSize);
      element.style.fontSize = `${Math.max(MIN_VALUE_PX, Math.floor((size * width) / element.scrollWidth))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className={cn("kpi-card flex min-w-0 flex-col gap-3 p-5", className)}>
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p ref={valueRef} data-kpi-value="" className="whitespace-nowrap font-display text-[clamp(2rem,3vw,3rem)] font-bold leading-none tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}
