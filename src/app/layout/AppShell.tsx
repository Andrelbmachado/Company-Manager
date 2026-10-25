import { Outlet } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { CommandMenu } from "./CommandMenu";
import { ModuleNav } from "./ModuleNav";
import { useProspectingBootstrap } from "@/hooks/useProspectingBootstrap";

/**
 * Casca do app sem top bar: a sidebar tem busca, Assistente de IA, navegação e conta (tema, notificações, sair);
 * o conteúdo ocupa a altura toda da janela.
 */
export function AppShell() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const closeCommandMenu = useCallback(() => setCmdOpen(false), []);
  useProspectingBootstrap();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
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
      <Sidebar onSearch={() => setCmdOpen(true)} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="min-h-full p-6">
          <ModuleNav />
          <Outlet />
        </div>
      </main>

      <CommandMenu open={cmdOpen} onClose={closeCommandMenu} />
    </div>
  );
}
