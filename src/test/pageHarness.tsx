// Renderiza uma página com React Query, sessão e rotas para os testes de tela (ambiente jsdom), e ações de usuário
// (clicar, digitar, escolher) dentro de act(). O banco vem de "@/test/mockDb" (vi.mock no arquivo de teste).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SessionContext } from "@/hooks/useSession";
import type { Role, Session } from "@/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Recharts (ResponsiveContainer) usa ResizeObserver, que o jsdom não tem.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

export function testSession(companyId: string, role: Role = "financeiro"): Session {
  return {
    user: { id: `test-user-${role}`, name: `Teste ${role}`, email: `${role}@teste.local` },
    membership: { id: `test-member-${companyId}-${role}`, company_id: companyId, user_id: `test-user-${role}`, role, scope: "setor" },
    company: { id: companyId, name: "Empresa de Teste" },
  } as unknown as Session;
}

export interface RenderedPage {
  container: HTMLDivElement;
  unmount: () => void;
  text: () => string;
  button: (label: string) => HTMLButtonElement | undefined;
}

export async function renderPage(node: ReactNode, options: { companyId: string; role?: Role; path?: string }): Promise<RenderedPage> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session: testSession(options.companyId, options.role), setSession: () => {} }}>
          <MemoryRouter initialEntries={[options.path ?? "/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{node}</MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    text: () => plain(container.textContent),
    button: (label: string) => findButton(container, label),
  };
}

/** Texto com espaços comuns (o Intl põe espaço não separável em "R$ 1,00"). */
export const plain = (value: string | null | undefined): string => (value ?? "").replace(/\u00a0/g, " ");

/** Primeiro botão cujo texto é (ou contém) o rótulo, ou cujo aria-label é o rótulo. */
export function findButton(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  const buttons = [...scope.querySelectorAll<HTMLButtonElement>("button")];
  return buttons.find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label) ?? buttons.find((item) => item.textContent?.includes(label));
}

export async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("elemento não encontrado");
  await act(async () => {
    element.click();
  });
}

/** Digita num input ou textarea (setter nativo + evento input, como o React espera). */
export async function type(element: Element | null | undefined, value: string): Promise<void> {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("campo não encontrado");
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function choose(element: Element | null | undefined, value: string): Promise<void> {
  if (!(element instanceof HTMLSelectElement)) throw new Error("seleção não encontrada");
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Campo (input/select/textarea) de um diálogo pelo texto do rótulo. */
export function fieldIn(scope: ParentNode, label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined {
  const labels = [...scope.querySelectorAll("label")];
  const match = labels.find((item) => item.firstChild?.textContent?.trim() === label) ?? labels.find((item) => item.textContent?.trim().startsWith(label));
  return match?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea") ?? undefined;
}

export function dialog(title: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role=dialog][aria-label="${title}"]`);
}
