import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { CommandMenu } from "./CommandMenu";
import { Bell, Search } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";

export function AppShell() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const session = useRequiredSession();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <Search size={14} />
            <span>Buscar...</span>
            <kbd className="ml-4 rounded bg-background border px-1.5 text-[10px] font-medium">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-3">
            <button className="relative rounded-lg p-2 hover:bg-muted transition-colors">
              <Bell size={16} className="text-muted-foreground" />
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {session.user.name
                .split(" ")
                .slice(0, 2)
                .map((n) => n[0])
                .join("")
                .toUpperCase()}
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
