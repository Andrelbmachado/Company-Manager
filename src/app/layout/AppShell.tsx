import { Outlet } from "react-router-dom";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { CommandMenu } from "./CommandMenu";
import { ModuleNav } from "./ModuleNav";
import { useProspectingBootstrap } from "@/hooks/useProspectingBootstrap";

/** Carregando da página (o código de cada módulo vem sob demanda na primeira visita), só na área do conteúdo. */
function PageLoading() {
  return (
    <div data-page-loading="" role="status" aria-label="Carregando" className="flex min-h-[50vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/**
 * Casca do app sem top bar: a sidebar tem busca, Assistente de IA, navegação e conta (tema, notificações, sair);
 * o conteúdo ocupa a altura toda da janela. A página carrega dentro do próprio Suspense: na primeira visita a um
 * módulo a sidebar e as abas ficam na tela (o Suspense das rotas, fora da casca, cobria a janela toda).
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
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      <CommandMenu open={cmdOpen} onClose={closeCommandMenu} />
    </div>
  );
}
