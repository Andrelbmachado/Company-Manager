import { ListFilter, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageToolbarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onFilterClick?: () => void;
  filterActive?: boolean;
  children?: ReactNode;
}

export function PageToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  onFilterClick,
  filterActive,
  children,
}: PageToolbarProps) {
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        {onSearchChange ? (
          <label className="flex w-72 min-w-0 max-w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
            <Search size={14} className="shrink-0 text-muted-foreground" />
            <input
              value={search ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
        ) : <span />}
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
