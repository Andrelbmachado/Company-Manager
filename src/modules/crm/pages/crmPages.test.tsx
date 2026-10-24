// Telas do CRM no jsdom com SQLite real (mockDb): ficha do cliente, funil (arrastar e ganhar), proposta, duplicados
// e conversão de lead. O foco é o caminho da tela até o banco; as regras ficam nos testes de src/lib/crm.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { Lead, Session } from "@/types";
import { LeadsPanel } from "@/modules/leads/components/LeadsPanel";
import CustomerDetailPage from "./CustomerDetailPage";
import DuplicatesPage from "./DuplicatesPage";
import PipelineBoardPage from "./PipelineBoardPage";
import ProposalEditorPage from "./ProposalEditorPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();
const USER = "test-user-comercial";
type Row = Record<string, unknown>;

let root: Root | null = null;
let container: HTMLDivElement;
let companyId: string;

const session = (id: string) =>
  ({
    user: { id: USER, name: "Pessoa Comercial", email: "comercial@teste.local" },
    membership: { id: `test-member-${id}-comercial`, company_id: id, user_id: USER, role: "comercial", scope: "setor" },
    company: { id, name: "Empresa de Teste" },
  }) as unknown as Session;

beforeEach(async () => {
  ({ companyId } = await insertTestCompany(testDb(), { roles: ["comercial"] }));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function renderAt(path: string, routePath: string, element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session: session(companyId), setSession: () => {} }}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={routePath} element={element} />
              <Route path="*" element={<p data-testid="outra-rota">outra rota</p>} />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
}

async function until(condition: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}\n${(container.textContent ?? "").slice(0, 600)}`);
}

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("elemento não encontrado");
  await act(async () => {
    element.click();
  });
}

async function type(input: Element | null | undefined, value: string) {
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error("campo não encontrado");
  const proto = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Evento de arrastar com um dataTransfer mínimo (o jsdom não tem DragEvent). */
async function drag(type: "dragstart" | "dragover" | "drop" | "dragend", target: Element | null | undefined, data: Map<string, string>) {
  if (!target) throw new Error(`alvo do ${type} não encontrado`);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", effectAllowed: "all", dropEffect: "none" },
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
}

const text = () => (container.textContent ?? "").replace(/\s+/g, " ");
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) ?? [...scope.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
const dialog = (title: string) => container.querySelector(`[role=dialog][aria-label="${title}"]`);
const one = async <T,>(sql: string, binds: unknown[]) => (await testDb().select<T[]>(sql, binds))[0];

describe("telas do CRM", () => {
  it("ficha do cliente: abas e contato novo vira o principal", async () => {
    await testDb().execute("INSERT INTO customers (id, company_id, name, segment, owner_id) VALUES (?,?,?,?,?)", ["cust-1", companyId, "Clínica Vida", "Saúde", USER]);
    await renderAt("/crm/clientes/cust-1", "/crm/clientes/:id", <CustomerDetailPage />);
    await until(() => container.querySelector("h1")?.textContent === "Clínica Vida", "ficha carregada");
    const tabs = [...container.querySelectorAll("[role=tab]")].map((tab) => tab.textContent);
    // Comercial vê faturas (invoices: view), então também a aba Financeiro.
    expect(tabs).toEqual(["Resumo", "Contatos", "Oportunidades", "Propostas", "Atividades", "Documentos", "Financeiro"]);

    await click([...container.querySelectorAll("[role=tab]")].find((tab) => tab.textContent === "Contatos"));
    await until(() => text().includes("Nenhum contato"), "aba de contatos");
    await click(button("Novo contato"));
    const inputs = dialog("Novo contato")!.querySelectorAll("input");
    await type(inputs[0], "Ana Souza");
    await type(inputs[1], "Gerente");
    await click(button("Salvar", dialog("Novo contato")!));
    await until(() => text().includes("Ana Souza"), "contato na lista");
    expect(await one<Row>("SELECT * FROM contacts WHERE customer_id=?", ["cust-1"])).toMatchObject({ name: "Ana Souza", role: "Gerente", is_primary: 1 });
  });

  it("funil: arrastar muda a etapa e soltar em Ganho fecha com cliente novo", async () => {
    await testDb().execute("INSERT INTO opportunities (id, company_id, title, value, stage, probability, status, owner_id) VALUES (?,?,?,?,?,?,?,?)", ["opp-1", companyId, "Site novo", 3000, "novo", 10, "open", USER]);
    await renderAt("/crm/funil", "/crm/funil", <PipelineBoardPage />);
    await until(() => !!container.querySelector('[role=button][aria-label^="Site novo"]'), "cartão no funil");
    const data = new Map<string, string>();
    const card = () => container.querySelector('[role=button][aria-label^="Site novo"]');
    const column = (label: string) => container.querySelector(`section[aria-label^="${label}:"]`);

    await drag("dragstart", card(), data);
    await drag("dragover", column("Proposta"), data);
    await drag("drop", column("Proposta"), data);
    await until(async () => (await one<Row>("SELECT * FROM opportunities WHERE id=?", ["opp-1"]))?.stage === "proposta", "etapa gravada");
    expect(await one<Row>("SELECT * FROM opportunities WHERE id=?", ["opp-1"])).toMatchObject({ stage: "proposta", probability: 50, status: "open" });

    await until(() => column("Proposta")?.textContent?.includes("Site novo") ?? false, "cartão na coluna Proposta");
    await drag("dragstart", card(), data);
    await drag("drop", column("Ganho"), data);
    await until(() => !!dialog("Ganhar oportunidade"), "diálogo de ganho");
    await click(button("Marcar como ganha"));
    await until(() => !!dialog("Oportunidade ganha"), "confirmação do ganho");
    const won = await one<Row>("SELECT * FROM opportunities WHERE id=?", ["opp-1"]);
    expect(won).toMatchObject({ stage: "ganho", status: "won", probability: 100 });
    expect(await one<Row>("SELECT * FROM customers WHERE id=?", [won.customer_id])).toMatchObject({ name: "Site novo", owner_id: USER });
  });

  it("proposta nova: item avulso, total na tela e gravação com número", async () => {
    await testDb().execute("INSERT INTO customers (id, company_id, name, payment_terms) VALUES (?,?,?,?)", ["cust-1", companyId, "Clínica Vida", "30 dias"]);
    await renderAt("/crm/propostas/nova?cliente=cust-1", "/crm/propostas/:id", <ProposalEditorPage />);
    await until(() => container.querySelector("h1")?.textContent === "Nova proposta", "editor carregado");
    await click(button("Item avulso"));
    await type(container.querySelector('input[aria-label="Descrição do item 1"]'), "Implantação do site");
    await type(container.querySelector('input[aria-label="Quantidade do item 1"]'), "2");
    await type(container.querySelector('input[aria-label="Preço unitário do item 1"]'), "1.234,50");
    await until(() => text().includes("2.469,00"), "total calculado");
    await click(button("Criar proposta"));
    await until(async () => !!(await one<Row>("SELECT * FROM proposals WHERE company_id=?", [companyId])), "proposta gravada");
    const proposal = await one<Row>("SELECT * FROM proposals WHERE company_id=?", [companyId]);
    expect(proposal).toMatchObject({ number: 1, customer_id: "cust-1", value: 2469, status: "rascunho", payment_terms: "30 dias", created_by: USER });
    expect(await one<Row>("SELECT * FROM proposal_items WHERE proposal_id=?", [proposal.id])).toMatchObject({ description: "Implantação do site", qty: 2, unit_price: 1234.5, total: 2469 });
    await until(() => container.querySelector("h1")?.textContent === "PROP-00001", "editor da proposta salva");
  });

  it("duplicados: mescla o cadastro novo no mais antigo", async () => {
    await testDb().execute("INSERT INTO customers (id, company_id, name, email, created_at) VALUES (?,?,?,?,?)", ["old", companyId, "Clínica Vida", "contato@vida.com", "2026-01-01 10:00:00"]);
    await testDb().execute("INSERT INTO customers (id, company_id, name, email, created_at) VALUES (?,?,?,?,?)", ["new", companyId, "Clinica Vida Ltda", "CONTATO@vida.com", "2026-05-01 10:00:00"]);
    await renderAt("/crm/duplicados", "/crm/duplicados", <DuplicatesPage />);
    await until(() => text().includes("Mesmo e-mail"), "grupo de duplicados");
    await click(button("Mesclar 1 em"));
    await click(button("Mesclar", dialog("Mesclar cadastros")!));
    await until(async () => !!(await one<Row>("SELECT * FROM customers WHERE id=?", ["new"]))?.deleted_at, "mesclagem gravada");
    expect(await one<Row>("SELECT * FROM customers WHERE id=?", ["new"])).toMatchObject({ merged_into_id: "old" });
    await until(() => text().includes("Nenhum duplicado encontrado"), "lista vazia depois de mesclar");
  });

  it("lead: converter em oportunidade e abrir no funil", async () => {
    await testDb().execute("INSERT INTO leads (id, company_id, name, status, estimated_revenue, owner_id) VALUES (?,?,?,?,?,?)", ["lead-1", companyId, "Pet Shop Amigo", "interessado", 4800, USER]);
    const [lead] = await testDb().select<Lead[]>("SELECT * FROM leads WHERE id=?", ["lead-1"]);
    await renderAt("/leads", "/leads", <LeadsPanel leads={[lead!]} packages={[]} loading={false} />);
    await click([...container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Pet Shop Amigo")));
    await until(() => !!button("Converter em oportunidade"), "botão de conversão");
    await click(button("Converter em oportunidade"));
    await until(() => !!container.querySelector("[data-testid=outra-rota]"), "navegou para o funil");
    expect(await one<Row>("SELECT * FROM opportunities WHERE lead_id=?", ["lead-1"])).toMatchObject({ title: "Pet Shop Amigo", stage: "qualificacao", value: 4800, status: "open" });
    expect(await one<Row>("SELECT * FROM leads WHERE id=?", ["lead-1"])).toMatchObject({ status: "convertido" });
  });
});
