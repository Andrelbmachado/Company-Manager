// Rotas das subpáginas de verdade (AppRoutes + AppShell): a página certa abre para quem pode, e quem não pode volta ao início.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import type { Role, Session } from "@/types";
import { AppRoutes } from "./routes";

// O seed de prospecção e o Dashboard leem o banco; aqui o assunto é só o roteamento.
vi.mock("@/hooks/useProspectingBootstrap", () => ({ useProspectingBootstrap: () => undefined }));
vi.mock("@/modules/dashboard/pages/DashboardPage", () => ({ default: () => <p data-testid="inicio">Painel inicial</p> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function sessionFor(role: Role): Session {
  const stamp = "2026-01-01T00:00:00.000Z";
  return {
    user: { id: `u-${role}`, name: "Pessoa Teste", email: `${role}@teste.local`, status: "active", locale: "pt-BR", created_at: stamp, updated_at: stamp },
    membership: { id: `m-${role}`, company_id: "c-1", user_id: `u-${role}`, role, scope: "empresa", created_at: stamp, updated_at: stamp },
    company: { id: "c-1", name: "Empresa Teste", settings_json: "{}", created_at: stamp, updated_at: stamp },
  } as Session;
}

async function openAs(role: Role, path: string): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const session = sessionFor(role);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={{ session, setSession: () => undefined }}>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
}

/** Páginas são lazy: espera (dentro do act) até aparecer o título ou o painel inicial. */
async function settled(): Promise<{ heading: string | null; home: boolean }> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const heading = container.querySelector("main h1")?.textContent ?? null;
    const home = container.querySelector("[data-testid=inicio]") !== null;
    if (heading || home) return { heading, home };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Nada carregou em ${container.innerHTML.slice(0, 300)}`);
}

describe("rotas das subpáginas", () => {
  it.each<[Role, string, string]>([
    ["financeiro", "/finance/dre", "DRE"],
    ["financeiro", "/finance/conciliacao", "Conciliação bancária"],
    ["comercial", "/crm/funil", "Funil de vendas"],
    ["comercial", "/crm/clientes/cli-1", "Ficha do cliente"],
    ["comercial", "/crm/propostas/nova", "Nova proposta"],
    ["comercial", "/crm/propostas/prop-1", "Proposta"],
    ["estoquista", "/inventory/inventarios/inv-1", "Contagem de inventário"],
    ["estoquista", "/purchasing/fornecedores", "Fornecedores"],
    ["estoquista", "/reports/estoque", "Giro de estoque"],
    ["rh", "/hr/manage/banco-de-horas", "Banco de horas da equipe"],
    ["tecnico", "/hr/banco-de-horas", "Meu banco de horas"],
    ["admin", "/settings/backup", "Backup e restauração"],
  ])("%s abre %s", async (role, path, title) => {
    await openAs(role, path);
    const { heading, home } = await settled();
    expect(home).toBe(false);
    expect(heading).toBe(title);
  });

  it.each<[Role, string]>([
    ["comercial", "/finance/dre"],
    ["atendimento", "/crm/funil"],
    ["auditor", "/crm/duplicados"],
    ["estoquista", "/reports/vendas"],
    ["rh", "/settings/backup"],
    ["tecnico", "/hr/manage/banco-de-horas"],
  ])("%s não abre %s e volta ao início", async (role, path) => {
    await openAs(role, path);
    const { home } = await settled();
    expect(home).toBe(true);
  });

  it("mostra as abas do módulo e marca a da página atual", async () => {
    await openAs("financeiro", "/finance/dre");
    await settled();
    const nav = container.querySelector("nav[aria-label='Seções de Financeiro']");
    expect(nav).not.toBeNull();
    const links = Array.from(nav!.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual(["Contas a pagar e receber", "Fluxo de caixa", "DRE", "Contas bancárias", "Conciliação", "Plano de contas", "Recorrências"]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent)).toEqual(["DRE"]);
  });

  it("detalhe acende a aba da lista; módulo sem subpágina visível não mostra abas", async () => {
    await openAs("comercial", "/crm/propostas/prop-1");
    await settled();
    const current = container.querySelector("nav[aria-label='Seções de CRM'] a[aria-current=page]");
    expect(current?.textContent).toBe("Propostas");
    act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";

    await openAs("tecnico", "/settings/backup");
    const { home } = await settled();
    expect(home).toBe(true);
    expect(container.querySelector("nav[aria-label^='Seções de']")).toBeNull();
  });
});
