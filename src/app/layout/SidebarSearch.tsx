import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Busca no topo da sidebar: abre o CommandMenu (o mesmo do atalho ⌘K / Ctrl+K). No trilho, só o ícone com dica. */
export function SidebarSearch({ collapsed, onOpen }: { collapsed: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Buscar"
      aria-keyshortcuts="Meta+K Control+K"
      data-rail-tip={collapsed ? "Buscar (⌘K)" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border bg-background/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "h-9 justify-center border-transparent bg-transparent px-0 py-0",
      )}
    >
      <Search size={collapsed ? 18 : 16} className="shrink-0" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="rounded border bg-background px-1.5 text-caption font-medium text-muted-foreground">⌘K</kbd>
        </>
      )}
    </button>
  );
}
