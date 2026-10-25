// Cabeçalho de coluna que ordena ao clicar (crescente → decrescente → sem ordenação). O estado vai em aria-sort no
// <th> (só na coluna ordenada, como pede o ARIA) e numa seta; sem ordenação a seta dupla só aparece no hover/foco.
import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortState } from "./sortFilter";

export interface SortableHeaderProps {
  /** Texto do cabeçalho (também o nome acessível do botão). */
  label: string;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  /** `false` mostra só o texto, sem botão. */
  sortable?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
  style?: CSSProperties;
  /** Depois do texto, dentro do botão (ex.: o "*" de obrigatório). */
  children?: ReactNode;
}

export const TH_CLASS = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-muted-foreground";

function hint(label: string, direction: "asc" | "desc" | null): string {
  if (direction === "asc") return `Ordenar por ${label} (decrescente)`;
  if (direction === "desc") return `Tirar a ordenação por ${label}`;
  return `Ordenar por ${label} (crescente)`;
}

export function SortableHeader({ label, sortKey, sort, onSort, sortable = true, align = "left", className, style, children }: SortableHeaderProps) {
  const direction = sort?.key === sortKey ? sort.direction : null;
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  if (!sortable) {
    return (
      <th scope="col" className={cn(TH_CLASS, alignClass, className)} style={style}>
        {label}
        {children}
      </th>
    );
  }
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  // Coluna à direita (números): seta antes do texto, para o texto alinhar com os valores.
  const arrow = (
    <Icon
      aria-hidden="true"
      size={12}
      className={cn("shrink-0", !direction && "opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60")}
    />
  );
  return (
    <th scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined} className={cn(TH_CLASS, alignClass, className)} style={style}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={hint(label, direction)}
        className={cn(
          "group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          direction && "text-foreground",
        )}
      >
        {align === "right" && arrow}
        {label}
        {children}
        {align !== "right" && arrow}
      </button>
    </th>
  );
}
