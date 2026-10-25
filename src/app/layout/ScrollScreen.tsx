import type { ReactNode } from "react";

/**
 * Contêiner de rolagem das telas de fora da casca (login, setup, troca de senha obrigatória). A janela não rola
 * (html, body e #root travados em globals.css): cada tela rola no próprio contêiner, sem levar a janela junto.
 */
export function ScrollScreen({ children }: { children: ReactNode }) {
  return (
    <div data-scroll-screen="" className="h-full overflow-y-auto overscroll-contain">
      {children}
    </div>
  );
}
