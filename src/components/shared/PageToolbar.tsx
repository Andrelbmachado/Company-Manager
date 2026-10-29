import { ListFilter, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageToolbarProps {
  /**
   * "table" (padrão): busca e filtros compactos para a barra do topo da tabela (`actions` da EditableTable ou a barra
   * da tabela comum), pedido do André (2026-10-29: nenhum filtro solto na tela). "page": barra própria acima de algo
   * que não é tabela (quadro, grade de pastas), com a linha embaixo.
   */
  variant?: "table" | "page";
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onFilterClick?: () => void;
  filterActive?: boolean;
  children?: ReactNode;
}

export function PageToolbar({
  variant = "table",
  search,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  onFilterClick,
  filterActive,
  children,
}: PageToolbarProps) {
  return (
    <div data-toolbar={variant} className={cn("flex flex-wrap items-center gap-2", variant === "page" ? "min-h-10 justify-between gap-3 border-b pb-4" : "min-w-0")}>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        {onSearchChange ? (
          <label className={cn("flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-background px-3 text-sm", variant === "page" ? "w-72 py-2" : "h-9 w-64")}>
            <Search size={14} className="shrink-0 text-muted-foreground" />
            <input
              value={search ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder.replace(/\.{3}|…$/, "")}
              className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
        ) : variant === "page" ? <span /> : null}
        {onFilterClick && (
          <button
            type="button"
            onClick={onFilterClick}
            aria-label="Filtrar resultados"
            title="Filtrar resultados"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              filterActive && "border-primary/40 bg-primary/10 text-primary-text"
            )}
          >
            <ListFilter size={16} />
          </button>
        )}
      </div>
      {children && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
