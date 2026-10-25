import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Busca no topo da sidebar: abre o CommandMenu (o mesmo do atalho ⌘K / Ctrl+K). */
export function SidebarSearch({ collapsed, onOpen }: { collapsed: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Buscar"
      aria-keyshortcuts="Meta+K Control+K"
      title={collapsed ? "Buscar (⌘K)" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border bg-background/40 px-2.5 py-2 text-[0.95rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center border-transparent bg-transparent px-0",
      )}
    >
      <Search size={18} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Buscar</span>
          <kbd className="rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
        </>
      )}
    </button>
  );
}
