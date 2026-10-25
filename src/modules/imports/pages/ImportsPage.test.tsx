// Tela Importar dados ponta a ponta (SQLite de teste): cadastros conforme o papel, envio do CSV, colunas sugeridas,
// prévia com erro marcado, importação, resultado e histórico.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { saveAreaLabels } from "@/lib/labels/store";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { Role, Session } from "@/types";
import ImportHistoryPage from "./ImportHistoryPage";
import ImportsPage from "./ImportsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();

let root: Root | null = null;
let container: HTMLDivElement;

type Row = Record<string, unknown>;

async function renderPage(page: JSX.Element, role: Role, path = "/imports", seed?: (db: ReturnType<typeof testDb>, companyId: string) => Promise<void>) {
  const db = testDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: [role] });
  const userId = userIds[role]!;
  await seed?.(db, companyId);
  const session = {
    user: { id: userId, name: "Teste", email: "teste@teste.local" },
    membership: { id: `m-${role}`, company_id: companyId, user_id: userId, role, scope: "empresa" },
    company: { id: companyId, name: "Empresa de Teste" },
  } as unknown as Session;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session, setSession: () => {} }}>
          <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
  return { db, companyId, userId };
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function until(condition: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}\n${container.textContent}`);
}

const text = () => container.textContent ?? "";
/** Vermelho/verde de status puro fica sem contraste no tema escuro: todo texto nessas cores traz a variante clara. */
const withoutDarkVariant = () =>
  [...container.querySelectorAll<HTMLElement>(".text-status-danger, .text-status-success")]
    .filter((element) => !element.classList.contains(element.classList.contains("text-status-danger") ? "dark:text-red-400" : "dark:text-green-400"))
    .map((element) => `${element.className}: ${element.textContent}`);
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith(label));

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("elemento não encontrado");
  await act(async () => {
    element.click();
  });
}

async function upload(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("campo de arquivo não encontrado");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const CSV = [
  "Razão social;CNPJ;E-mail;Limite de crédito",
  "Padaria Pão Quente Ltda;11.222.333/0001-81;contato@paoquente.com.br;1.500,00",
  "Mercado Bom Preço;11.222.333/0001-00;compras@bompreco.com;",
  "Ana Souza;529.982.247-25;ana@exemplo.com;abc",
].join("\r\n");

describe("ImportsPage", () => {
  it("o título é o rótulo do módulo na área da empresa (editável em Configurações)", async () => {
    await renderPage(<ImportsPage />, "ceo", "/imports", async (db, companyId) => {
      await saveAreaLabels(db, companyId, { role: "ceo", userId: "test-user-ceo" }, { overrides: { "module.imports": "Trazer planilhas" } });
    });
    await until(() => container.querySelector("h1")?.textContent === "Trazer planilhas", "título com o rótulo da área");
  });

  it("lista só os cadastros que o papel pode criar", async () => {
    await renderPage(<ImportsPage />, "comercial");
    await until(() => text().includes("O que você vai importar?"), "escolha do cadastro");
    expect(text()).toContain("Clientes");
    expect(text()).toContain("Leads");
    expect(text()).not.toContain("Contas a pagar");
    expect(text()).not.toContain("Colaboradores");
  });

  it("importa um CSV: colunas sugeridas, prévia com erros marcados, resultado, relatório e histórico", async () => {
    const { db, companyId } = await renderPage(<ImportsPage />, "ceo", "/imports?entity=customers");
    await until(() => text().includes("Arraste a planilha"), "envio do arquivo");
    await upload(new File([CSV], "clientes.csv", { type: "text/csv" }));
    await until(() => text().includes("Colunas do arquivo") && text().includes("3 linhas"), "mapeamento");

    expect(container.querySelector<HTMLSelectElement>("#coluna-customers-name")?.value).toBe("Razão social");
    expect(container.querySelector<HTMLSelectElement>("#coluna-customers-document")?.value).toBe("CNPJ");
    expect(container.querySelector<HTMLSelectElement>("#coluna-customers-credit_limit")?.value).toBe("Limite de crédito");
    await until(() => container.querySelectorAll('[data-erro="sim"]').length === 2, "erros marcados na prévia");
    expect(text()).toContain("2 com erro");
    expect(withoutDarkVariant()).toEqual([]);

    await click(button("Importar 3 linhas"));
    await until(() => text().includes("Problemas encontrados"), "resultado");
    expect(text()).toContain("1 novo e 0 atualizados");
    expect(text()).toContain("Com erros");
    expect(withoutDarkVariant()).toEqual([]);
    const customers = await db.select<Row[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId]);
    expect(customers.map((row) => row.name)).toEqual(["Padaria Pão Quente Ltda"]);
    const batches = await db.select<Row[]>("SELECT * FROM import_batches WHERE company_id=?", [companyId]);
    expect(batches).toEqual([expect.objectContaining({ entity: "customers", filename: "clientes.csv", status: "com_erros", inserted: 1, rows_err: 2 })]);
    const activities = await db.select<Row[]>("SELECT * FROM activities WHERE company_id=? AND action=?", [companyId, "import.completed"]);
    expect(activities).toHaveLength(1);
  });

  it("simula sem gravar e importa depois pelo botão do resultado", async () => {
    const { db, companyId } = await renderPage(<ImportsPage />, "ceo", "/imports?entity=customers");
    await until(() => text().includes("Arraste a planilha"), "envio do arquivo");
    await upload(new File([CSV.split("\r\n").slice(0, 2).join("\r\n")], "um.csv"));
    await until(() => text().includes("Colunas do arquivo"), "mapeamento");
    await click(button("Simular"));
    await until(() => text().includes("Nada foi gravado"), "resultado da simulação");
    expect(await db.select<Row[]>("SELECT * FROM customers WHERE company_id=?", [companyId])).toHaveLength(0);
    await click(button("Importar agora"));
    await until(() => text().includes("Importação concluída"), "importação");
    expect(await db.select<Row[]>("SELECT * FROM customers WHERE company_id=?", [companyId])).toHaveLength(1);
  });

  it("arquivo em formato errado mostra o motivo", async () => {
    await renderPage(<ImportsPage />, "ceo", "/imports?entity=products");
    await until(() => text().includes("Arraste a planilha"), "envio do arquivo");
    await upload(new File(["x"], "dados.pdf"));
    await until(() => Boolean(container.querySelector('[role="alert"]')), "erro do arquivo");
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/\.pdf não é aceito/);
  });
});

describe("ImportHistoryPage", () => {
  it("lista as importações e abre o detalhe na própria página (sem diálogo) com os erros e as colunas usadas", async () => {
    await renderPage(<ImportHistoryPage />, "ceo", "/imports/historico", async (db, companyId) => {
      await db.execute(
        "INSERT INTO import_batches (id, company_id, entity, filename, format, mode, status, rows_total, rows_ok, rows_err, inserted, updated, errors_json, mapping_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ["b-1", companyId, "products", "produtos.xlsx", "xlsx", "skip-errors", "com_erros", 3, 2, 1, 2, 0, JSON.stringify([{ row: 4, field: "price", message: "Preço de venda: valor inválido", value: "abc" }]), JSON.stringify({ Preço: "price" })],
      );
    });
    await until(() => text().includes("produtos.xlsx"), "lista do histórico");
    expect(text()).toContain("Produtos e serviços");
    expect(text()).toContain("Com erros");
    await click(container.querySelector("tbody tr button"));
    await until(() => Boolean(container.querySelector('section[aria-label="produtos.xlsx"]')), "detalhe");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const detail = container.querySelector('section[aria-label="produtos.xlsx"]')!.textContent ?? "";
    expect(detail).toContain("Preço de venda: valor inválido");
    expect(detail).toContain("→ Preço de venda");
    expect(detail).toContain("Baixar relatório de erros (CSV)");
  });

  it("só mostra importações de cadastros que o papel pode ver (os erros trazem CPF, valores, nomes)", async () => {
    await renderPage(<ImportHistoryPage />, "comercial", "/imports/historico", async (db, companyId) => {
      const batch = (id: string, entity: string, filename: string, message: string) =>
        db.execute(
          "INSERT INTO import_batches (id, company_id, entity, filename, format, mode, status, rows_total, rows_ok, rows_err, inserted, updated, errors_json, mapping_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [id, companyId, entity, filename, "csv", "skip-errors", "com_erros", 2, 1, 1, 1, 0, JSON.stringify([{ row: 2, field: "document", message }]), "{}"],
        );
      await batch("b-1", "customers", "clientes.csv", "CPF/CNPJ inválido");
      await batch("b-2", "employees", "folha-colaboradores.csv", 'CPF inválido: "529.982.247-25"');
      await batch("b-3", "payables", "contas-a-pagar.csv", "Valor inválido");
      await batch("b-4", "removido", "antigo.csv", "Valor inválido");
    });
    await until(() => text().includes("clientes.csv"), "lista do histórico");
    expect(text()).not.toContain("folha-colaboradores.csv");
    expect(text()).not.toContain("contas-a-pagar.csv");
    expect(text()).not.toContain("antigo.csv");
  });
});
