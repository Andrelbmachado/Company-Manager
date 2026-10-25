// Contrato do redesign (Tarefa 6, grupo d): Documentos com os arquivos da pasta em EditableTable (metadados), ficha
// e Nova pasta no próprio lugar, sem diálogo. SQLite real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, findButton, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { createMemoryFileBackend } from "@/lib/files/backend";
import { listFolderDocuments, saveFile, setFileBackend } from "@/lib/files/store";
import { saveAreaLabels } from "@/lib/labels/store";
import DocumentsPage from "./pages/DocumentsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
let page: RenderedPage | null = null;

beforeEach(() => setFileBackend(createMemoryFileBackend()));
afterEach(() => {
  page?.unmount();
  page = null;
  setFileBackend(null);
});

const table = () => page!.container.querySelector<HTMLElement>('[data-editable-table="documents"]');
const field = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
const noDialog = () => expect(document.querySelector("[role=dialog]")).toBeNull();
const doc = async (title: string) => (await listFolderDocuments(C)).find((row) => row.title === title);

describe("Documentos: metadados direto na tabela", () => {
  it("adiciona registro e edita observação na tabela; ficha e nova pasta sem diálogo", async () => {
    await insertTestCompany(testDb(), { roles: ["comercial"] });
    await saveFile(C, new File(["olá"], "Briefing.txt"), { userId: "test-user-comercial", folder: "Comercial" });
    page = await renderPage(<DocumentsPage />, { companyId: C, role: "comercial" });
    await until(() => findButton(page!.container, "Comercial")?.closest("nav") === null, "pasta Comercial");
    await click(findButton(page.container, "Comercial"));
    await until(() => page!.text().includes("Briefing.txt") && !!table(), "tabela da pasta");

    await click(findButton(table()!, "Adicionar"));
    noDialog();
    await typeInto(field("Nome (nova linha)"), "Ata de reunião.docx");
    await typeInto(field("Observação (nova linha)"), "Kickoff NorteLog");
    await click(findButton(table()!, "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "registro salvo");
    expect(await doc("Ata de reunião.docx")).toMatchObject({ folder: "Comercial", description: "Kickoff NorteLog", storage_key: null });

    await until(() => page!.text().includes("Ata de reunião.docx"), "linha nova");
    await click(findButton(table()!, "Editar"));
    noDialog();
    const row = [...table()!.querySelectorAll<HTMLTableRowElement>("tr[data-row-key]")].find((item) => item.textContent?.includes("v1") && item.querySelector('[aria-label^="Nome"]') && (item.querySelector('[aria-label^="Nome"]') as HTMLInputElement).value === "Briefing.txt");
    await typeInto(row!.querySelector('td[data-column="description"] input'), "Versão para o cliente");
    await click(findButton(table()!, "Salvar"));
    await until(async () => (await doc("Briefing.txt"))?.description === "Versão para o cliente", "observação gravada");

    await click(findButton(table()!, "Briefing.txt"));
    await until(() => !!page!.container.querySelector("[data-document-panel]"), "ficha no lugar");
    noDialog();
    await click(findButton(page.container.querySelector("[data-document-panel]")!, "Editar dados"));
    noDialog();
    await typeInto(field("Nome do arquivo"), "Briefing final.txt");
    await click(findButton(page.container.querySelector('form[aria-label="Dados do documento"]')!, "Salvar"));
    await until(async () => !!(await doc("Briefing final.txt")), "renomeado pela ficha");

    await click(findButton(page.container, "Nova pasta"));
    noDialog();
    await typeInto(field("Nome da pasta"), "Propostas");
    await click(findButton(page.container, "Criar e abrir"));
    await until(() => !!page!.container.querySelector('nav [aria-current="location"]')?.textContent?.includes("Propostas"), "pasta nova aberta");
  });

  it("auditor só consulta: Editar e Adicionar desabilitados", async () => {
    await insertTestCompany(testDb(), { roles: ["auditor"] });
    await saveFile(C, new File(["x"], "Política.pdf"), { userId: "test-user-auditor", folder: "Compartilhados" });
    page = await renderPage(<DocumentsPage />, { companyId: C, role: "auditor" });
    await until(() => page!.text().includes("Compartilhados"), "pastas");
    await click(findButton(page.container, "Compartilhados"));
    await until(() => page!.text().includes("Política.pdf"), "arquivo");
    expect(findButton(table()!, "Editar")?.disabled).toBe(true);
    expect(findButton(table()!, "Adicionar")?.disabled).toBe(true);
  });

  it("o título vem do rótulo da área (Configurações)", async () => {
    await insertTestCompany(testDb());
    await saveAreaLabels(testDb(), C, { role: "ceo", userId: "test-user-ceo" }, { overrides: { "module.documents": "Arquivos" } });
    page = await renderPage(<DocumentsPage />, { companyId: C, role: "ceo" });
    await until(() => page!.container.querySelector("h1")?.textContent === "Arquivos", "título do módulo");
  });
});
