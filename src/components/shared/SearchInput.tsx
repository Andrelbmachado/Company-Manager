import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/Field";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Buscar...", className }: SearchInputProps) {
  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        role="searchbox"
        aria-label={placeholder}
        data-testid="list-search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, "pl-8")}
      />
    </div>
  );
}

/** Case/accent-insensitive match of `query` against any of the given values. */
export function matchesSearch(query: string, values: unknown[]): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return values.some((v) => v !== null && v !== undefined && fold(String(v)).includes(q));
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
