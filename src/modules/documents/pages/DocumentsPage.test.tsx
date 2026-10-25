// Tela de Documentos com SQLite real: pastas por setor, envio para a pasta do setor, detalhe com versões e anexos.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { createMemoryFileBackend } from "@/lib/files/backend";
import { saveFile, setFileBackend } from "@/lib/files/store";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { DocumentRow, Role, Session } from "@/types";
import DocumentsPage from "./DocumentsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();
const C = "test-company";

let root: Root;
let container: HTMLDivElement;

function sessionFor(role: Role): Session {
  return {
    user: { id: `test-user-${role}`, name: `Teste ${role}`, email: `${role}@teste.local` },
    membership: { id: `test-member-${C}-${role}`, company_id: C, user_id: `test-user-${role}`, role, scope: "setor" },
    company: { id: C, name: "Empresa de Teste" },
  } as unknown as Session;
}

async function render(role: Role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <SessionContext.Provider value={{ session: sessionFor(role), setSession: () => undefined }}>
            <DocumentsPage />
          </SessionContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
}

async function legacy(id: string, title: string, filePath: string, version = 1) {
  await testDb().execute("INSERT INTO documents (id, company_id, title, type, file_path, version) VALUES (?,?,?,?,?,?)", [id, C, title, "PDF", filePath, version]);
}

beforeEach(async () => {
  setFileBackend(createMemoryFileBackend());
  await insertTestCompany(testDb(), { roles: ["ceo", "comercial", "rh"] });
  await legacy("d-com", "Contrato NorteLog.pdf", "/Comercial/Contratos/Contrato NorteLog.pdf", 2);
  await legacy("d-fin", "Fechamento.pdf", "/Financeiro/Fechamento.pdf");
  await legacy("d-ti", "Relatório.pdf", "/TI e Operações/Relatório.pdf");
  await legacy("d-share", "Manual.pdf", "/Compartilhados/Manual.pdf");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setFileBackend(null);
  document.body.innerHTML = "";
});

async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}\n${container.textContent}`);
}

const text = () => container.textContent ?? "";
const buttonWith = (label: string) => [...container.querySelectorAll("button")].find((element) => element.textContent?.trim().startsWith(label)) ?? null;

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("elemento não encontrado");
  await act(async () => (element as HTMLElement).click());
}

describe("DocumentsPage", () => {
  it("o comercial vê só Comercial e Compartilhados, e o envio na raiz vai para /Comercial", async () => {
    await render("comercial");
    await until(() => text().includes("Compartilhados"), "pastas");
    expect(text()).toContain("Comercial");
    expect(text()).not.toContain("Financeiro");
    expect(text()).not.toContain("TI e Operações");
    expect(text()).toContain("vão para /Comercial");

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Escolher arquivos para enviar"]')!;
    Object.defineProperty(input, "files", { value: [new File(["olá"], "Briefing.txt", { type: "text/plain" })], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await until(() => text().includes("1 arquivo enviado"), "envio");
    const [saved] = await testDb().select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND title=?", [C, "Briefing.txt"]);
    expect(saved).toMatchObject({ folder: "Comercial", file_path: "/Comercial/Briefing.txt", uploaded_by: "test-user-comercial", version: 1 });

    await click(buttonWith("Comercial"));
    await until(() => text().includes("Briefing.txt"), "arquivo na pasta");
    expect(text()).toContain("Contratos");
  });

  it("abre o detalhe com versões; documento antigo sem arquivo avisa e não baixa", async () => {
    await render("comercial");
    await until(() => text().includes("Compartilhados"), "pastas");
    await click(buttonWith("Comercial"));
    await until(() => text().includes("Contratos"), "subpasta");
    await click(buttonWith("Contratos"));
    await until(() => text().includes("Contrato NorteLog.pdf"), "arquivo antigo");
    await click(buttonWith("Contrato NorteLog.pdf"));
    // Detalhe no próprio lugar, abaixo da tabela (sem painel lateral).
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const drawer = () => container.querySelector("[data-document-panel]");
    await until(() => drawer()?.textContent?.includes("Versões") ?? false, "detalhe");
    expect(drawer()!.textContent).toContain("Registro antigo, só com os dados");
    const download = [...drawer()!.querySelectorAll("button")].find((element) => element.textContent?.includes("Baixar"));
    expect(download?.disabled).toBe(true);
    // comercial não tem delete em documents
    expect([...drawer()!.querySelectorAll("button")].some((element) => element.textContent?.includes("Excluir"))).toBe(false);
  });

  it("na aba de anexos, mostra só os registros que o papel pode ver, com o nome do registro", async () => {
    const db = testDb();
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES (?,?,?,?)", ["cli-1", C, "PJ", "NorteLog"]);
    await saveFile(C, new File(["a"], "Contrato assinado.pdf"), { userId: "test-user-ceo", entityType: "customer", entityId: "cli-1" });
    await saveFile(C, new File(["b"], "Exame admissional.pdf"), { userId: "test-user-ceo", entityType: "employee", entityId: "emp-1" });

    await render("comercial");
    await until(() => text().includes("Compartilhados"), "pastas");
    await click(container.querySelector("#tab-documentos-anexos"));
    await until(() => text().includes("Contrato assinado.pdf"), "anexos");
    await until(() => text().includes("NorteLog"), "nome do cliente dono do anexo");
    expect(text()).not.toContain("Exame admissional.pdf");
    expect(container.querySelector('a[href="/crm/clientes/cli-1"]')).not.toBeNull();
  });
});
