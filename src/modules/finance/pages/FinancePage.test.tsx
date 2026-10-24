// Contas a receber da tela Financeiro (legada): a descrição vai em `description` (0008), não mais em `ref_id`.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { Session } from "@/types";
import FinancePage from "./FinancePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();

let root: Root;
let container: HTMLDivElement;
let companyId: string;

const session = (id: string) =>
  ({
    user: { id: "test-user-financeiro", name: "Teste financeiro", email: "financeiro@teste.local" },
    membership: { id: `test-member-${id}-financeiro`, company_id: id, user_id: "test-user-financeiro", role: "financeiro", scope: "setor" },
    company: { id, name: "Empresa de Teste" },
  }) as unknown as Session;

interface ReceivableRow {
  id: string;
  description: string | null;
  ref_type: string | null;
  ref_id: string | null;
  amount: number;
}

beforeEach(async () => {
  const db = testDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
  // Gravado pela tela antiga depois da 0008: só ref_id, description NULL (a migração só copiou o que já existia).
  await db.execute("INSERT INTO receivables (id, company_id, ref_type, ref_id, amount, status) VALUES (?, ?, ?, ?, ?, ?)", ["rec-old", companyId, "Manual", "Contrato antigo", 500, "aberta"]);
  await db.execute("INSERT INTO receivables (id, company_id, description, ref_type, ref_id, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)", ["rec-new", companyId, "Parcela 1/3 da fatura", "invoice", "inv-1", 300, "aberta"]);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session: session(companyId), setSession: () => {} }}>
          <FinancePage />
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function until(condition: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("elemento não encontrado");
  await act(async () => {
    element.click();
  });
}

async function type(input: HTMLInputElement | null | undefined, value: string) {
  if (!input) throw new Error("campo não encontrado");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label || item.textContent?.includes(label));
const dialogInputs = (title: string) => [...container.querySelectorAll<HTMLInputElement>(`[role=dialog][aria-label="${title}"] input`)];
const receivable = async (id: string) => (await testDb().select<ReceivableRow[]>("SELECT * FROM receivables WHERE id = ?", [id]))[0];

describe("FinancePage (contas a receber)", () => {
  it("mostra a descrição nova e, nas contas antigas, o texto que ficou em ref_id", async () => {
    await until(() => text().includes("Contrato antigo") && text().includes("Parcela 1/3 da fatura"), "lista de contas a receber");
    expect(text()).not.toContain("inv-1");
  });

  it("conta nova grava a descrição em description (ref_id fica vazio)", async () => {
    await until(() => text().includes("Contrato antigo"), "lista de contas a receber");
    await click(button("Nova conta a receber"));
    const [description, amount] = dialogInputs("Novo lançamento");
    await type(description, "Mensalidade de novembro");
    await type(amount, "1250.5");
    await click(button("Salvar"));
    let id = "";
    await until(async () => {
      const rows = await testDb().select<ReceivableRow[]>("SELECT * FROM receivables WHERE description = ?", ["Mensalidade de novembro"]);
      id = rows[0]?.id ?? "";
      return id !== "";
    }, "conta gravada");
    expect(await receivable(id)).toMatchObject({ description: "Mensalidade de novembro", ref_type: "Manual", ref_id: null, amount: 1250.5 });
    await until(() => text().includes("Mensalidade de novembro"), "conta nova na lista");
  });

  it("editar grava description e não apaga a referência (ref_id)", async () => {
    await until(() => text().includes("Parcela 1/3 da fatura"), "lista de contas a receber");
    await click([...container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Parcela 1/3 da fatura")));
    await click(button("Editar"));
    const [description] = dialogInputs("Editar lançamento");
    await type(description, "Parcela 1/3 - renegociada");
    await click(button("Salvar"));
    await until(async () => (await receivable("rec-new")).description === "Parcela 1/3 - renegociada", "edição gravada");
    expect(await receivable("rec-new")).toMatchObject({ ref_type: "invoice", ref_id: "inv-1" });

    await until(() => text().includes("Contrato antigo"), "lista atualizada");
    await click([...container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Contrato antigo")));
    await click(button("Editar"));
    const [legacy] = dialogInputs("Editar lançamento");
    expect(legacy.value).toBe("Contrato antigo");
    await type(legacy, "Contrato antigo (revisado)");
    await click(button("Salvar"));
    await until(async () => (await receivable("rec-old")).description === "Contrato antigo (revisado)", "edição da conta antiga gravada");
  });
});
