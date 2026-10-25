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
    // Altura da janela (#root = 100%) e sem rolagem: só o main (e a lista de módulos da sidebar) rola, com o overscroll
    // contido para a rolagem não passar para a janela. `relative` no main: elemento absoluto da página (sr-only de
    // tabela e títulos dos gráficos) fica dentro da área que rola; sem isso ele saía da casca, a janela ganhava altura
    // para rolar e, rolando sobre a borda da sidebar, a casca inteira subia e só o fundo aparecia.
    <div className="relative flex h-full overflow-hidden bg-background">
      <Sidebar onSearch={() => setCmdOpen(true)} />

      <main className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {/* .app-content (globals.css): respiro de 24 px que cai para 12 px em janela estreita. */}
        <div className="app-content min-h-full">
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
