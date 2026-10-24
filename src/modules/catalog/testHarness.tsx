// Montagem das telas de Catálogo, Vendas e Compras nos testes (jsdom + SQLite de teste via vi.mock do client):
// sessão do papel pedido, roteador em memória e ajudantes para clicar, digitar e escolher em <select>.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionContext } from "@/hooks/useSession";
import type { Role, Session } from "@/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLDivElement;
  /** Caminho atual do roteador em memória. */
  path: () => string;
  unmount: () => void;
}

function PathProbe({ onPath }: { onPath: (path: string) => void }) {
  const location = useLocation();
  onPath(`${location.pathname}${location.search}`);
  return null;
}

export async function mountPage(options: { companyId: string; role: Role; path: string; routes: ReadonlyArray<{ path: string; element: ReactNode }> }): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let current = options.path;
  const session = {
    user: { id: `test-user-${options.role}`, name: `Teste ${options.role}`, email: `${options.role}@teste.local` },
    membership: { id: `test-member-${options.companyId}-${options.role}`, company_id: options.companyId, user_id: `test-user-${options.role}`, role: options.role, scope: "empresa" },
    company: { id: options.companyId, name: "Empresa de Teste" },
  } as unknown as Session;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session, setSession: () => undefined }}>
          <MemoryRouter initialEntries={[options.path]}>
            <PathProbe onPath={(path) => { current = path; }} />
            <Routes>
              {options.routes.map((route) => <Route key={route.path} path={route.path} element={route.element} />)}
              <Route path="*" element={<p>outra página</p>} />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
  return {
    container,
    path: () => current,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}\n${document.body.textContent?.slice(0, 1500)}`);
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("elemento não encontrado para clicar");
  await act(async () => {
    element.click();
  });
}

export async function typeInto(input: Element | null | undefined, value: string): Promise<void> {
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) throw new Error("campo não encontrado");
  const proto = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function choose(select: Element | null | undefined, value: string): Promise<void> {
  if (!(select instanceof HTMLSelectElement)) throw new Error("select não encontrado");
  if (![...select.options].some((option) => option.value === value)) throw new Error(`opção "${value}" não existe em ${select.getAttribute("aria-label") ?? "select"}`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function buttonIn(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  const buttons = [...scope.querySelectorAll("button")];
  return buttons.find((button) => button.textContent?.trim() === label) ?? buttons.find((button) => button.textContent?.includes(label));
}

export function dialog(title: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[role=dialog][aria-label="${title}"]`);
  if (!found) throw new Error(`diálogo "${title}" não aberto`);
  return found;
}

/** Campo de formulário pelo texto do <label> que o envolve. */
export function field<T extends Element = HTMLInputElement>(scope: ParentNode, label: string): T {
  const wrapper = [...scope.querySelectorAll("label")].find((item) => item.textContent?.trim().startsWith(label));
  const control = wrapper?.querySelector("input, select, textarea");
  if (!control) throw new Error(`campo "${label}" não encontrado`);
  return control as unknown as T;
}
