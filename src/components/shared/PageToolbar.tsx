import { Search } from "lucide-react";
import type { ReactNode } from "react";

interface PageToolbarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
}

export function PageToolbar({ search, onSearchChange, searchPlaceholder = "Buscar...", children }: PageToolbarProps) {
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 border-b pb-4">
      {onSearchChange ? (
        <label className="flex w-72 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={search ?? ""}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      ) : <span />}
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
