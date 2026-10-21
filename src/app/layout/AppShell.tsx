import { Outlet, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { CommandMenu } from "./CommandMenu";
import { AccountMenu } from "./AccountMenu";
import { NotificationsMenu } from "./NotificationsMenu";
import { setAgentNavigator } from "@/lib/agent/api";

const SIDEBAR_KEY = "cm_sidebar_collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const navigate = useNavigate();

  const toggleSidebar = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1");
      } catch {
        // ignore
      }
      return !v;
    });
  }, []);

  useEffect(() => {
    setAgentNavigator(navigate);
    return () => setAgentNavigator(null);
  }, [navigate]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleSidebar]);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          data-testid="topbar"
          className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur"
        >
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Abrir menu lateral" : "Fechar menu lateral"}
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            title={`${collapsed ? "Abrir" : "Fechar"} menu lateral (Ctrl+B)`}
            data-testid="sidebar-toggle"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ToggleIcon size={18} />
          </button>

          <div className="h-5 w-px bg-border" aria-hidden />

          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            data-testid="command-trigger"
            className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <Search size={14} />
            <span className="flex-1 text-left">Buscar módulos e ações...</span>
            <kbd className="rounded border bg-background px-1.5 text-[10px] font-medium">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu />
            <div className="mx-1 h-5 w-px bg-border" aria-hidden />
            <AccountMenu onOpenCommand={() => setCmdOpen(true)} />
          </div>
        </header>

        <main id="main" className="flex-1 overflow-y-auto" data-testid="main">
          <div className="mx-auto w-full max-w-7xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
