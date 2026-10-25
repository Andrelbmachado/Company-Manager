// @vitest-environment jsdom
// Metadados de documentos editados na tabela: nome (todas as versões), observação e registro só com os dados.
// Permissão e pasta do setor conferidas na camada de dados. SQLite real e banco demo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { createMemoryFileBackend } from "@/lib/files/backend";
import { listFolderDocuments, listVersions, saveFile, setFileBackend } from "@/lib/files/store";
import type { DocumentRow } from "@/types";
import { saveDocumentMetadata } from "./metadata";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
const comercial = { role: "comercial" as const, userId: "test-user-comercial" };

beforeEach(() => setFileBackend(createMemoryFileBackend()));
afterEach(() => setFileBackend(null));

const byTitle = async (title: string) => (await listFolderDocuments(C)).find((doc) => doc.title === title);

describe("metadados de documentos na tabela", () => {
  it("cria registro só com os dados na pasta aberta e recusa nome repetido", async () => {
    await insertTestCompany(testDb());
    const { created } = await saveDocumentMetadata(C, comercial, "Comercial/Contratos", { created: [{ title: "Proposta Acme.pdf", description: "Aguardando assinatura" }], updated: [] });
    expect(created[0]).toMatchObject({ title: "Proposta Acme.pdf", folder: "Comercial/Contratos", file_path: "/Comercial/Contratos/Proposta Acme.pdf", type: "PDF", version: 1 });
    expect(await byTitle("Proposta Acme.pdf")).toMatchObject({ description: "Aguardando assinatura", uploaded_by: "test-user-comercial", storage_key: null });
    await expect(saveDocumentMetadata(C, comercial, "Comercial/Contratos", { created: [{ title: "proposta acme.pdf" }], updated: [] })).rejects.toThrow(/Já existe/);
    await expect(saveDocumentMetadata(C, comercial, "Comercial", { created: [{ title: "  " }], updated: [] })).rejects.toThrow(/nome/);
  });

  it("renomeia todas as versões e grava a observação", async () => {
    await insertTestCompany(testDb());
    const first = await saveFile(C, new File(["v1"], "Tabela.xlsx"), { userId: "test-user-comercial", folder: "Comercial" });
    const second = await saveFile(C, new File(["v2"], "Tabela.xlsx"), { userId: "test-user-comercial", folder: "Comercial" });
    await saveDocumentMetadata(C, comercial, "Comercial", { created: [], updated: [{ id: second.id, title: "Tabela de preços.xlsx", description: "Vigente em 2026" }] });
    const versions = await listVersions(second);
    expect(versions.map((doc) => doc.title)).toEqual(["Tabela de preços.xlsx", "Tabela de preços.xlsx"]);
    expect(versions.map((doc) => doc.description)).toEqual(["Vigente em 2026", "Vigente em 2026"]);
    expect(versions[1].id).toBe(first.id);
  });

  it("confere permissão, pasta do setor e não mexe em anexo de registro", async () => {
    await insertTestCompany(testDb());
    const finance = await saveFile(C, new File(["x"], "Fechamento.pdf"), { userId: "test-user-ceo", folder: "Financeiro" });
    const attachment = await saveFile(C, new File(["y"], "Contrato.pdf"), { userId: "test-user-ceo", entityType: "customer", entityId: "cli-1" });
    await expect(saveDocumentMetadata(C, comercial, "Financeiro", { created: [{ title: "A.pdf" }], updated: [] })).rejects.toThrow(/acesso/);
    await expect(saveDocumentMetadata(C, comercial, "", { created: [{ title: "A.pdf" }], updated: [] })).rejects.toThrow(/pasta/);
    await expect(saveDocumentMetadata(C, comercial, "Comercial", { created: [], updated: [{ id: finance.id, title: "B.pdf" }] })).rejects.toThrow(/acesso/);
    await expect(saveDocumentMetadata(C, { role: "ceo", userId: "test-user-ceo" }, "", { created: [], updated: [{ id: attachment.id, title: "C.pdf" }] })).rejects.toThrow(/ficha do registro/);
    await expect(saveDocumentMetadata(C, { role: "auditor", userId: "test-user-auditor" }, "Compartilhados", { created: [{ title: "D.pdf" }], updated: [] })).rejects.toThrow(/permissão/);
    await expect(saveDocumentMetadata(C, comercial, "Comercial", { created: [], updated: [{ id: "nao-existe", title: "E.pdf" }] })).rejects.toThrow(/não encontrado/);
  });

  it("lote com nome repetido ou vazio não grava nenhuma linha", async () => {
    await insertTestCompany(testDb());
    const sheet = await saveFile(C, new File(["v1"], "Tabela.xlsx"), { userId: "test-user-comercial", folder: "Comercial" });
    await expect(saveDocumentMetadata(C, comercial, "Comercial", { created: [{ title: "Ata.pdf" }, { title: "ata.PDF" }], updated: [] })).rejects.toThrow(/mais de uma linha/);
    await expect(saveDocumentMetadata(C, comercial, "Comercial", { created: [{ title: "Ata.pdf" }, { title: " " }], updated: [{ id: sheet.id, description: "Vigente" }] })).rejects.toThrow(/nome/);
    await expect(saveDocumentMetadata(C, comercial, "Comercial", { created: [], updated: [{ id: sheet.id, description: "Vigente" }, { id: "nao-existe", title: "X.pdf" }] })).rejects.toThrow(/não encontrado/);
    const docs = await listFolderDocuments(C);
    expect(docs.map((doc) => doc.title)).toEqual(["Tabela.xlsx"]);
    expect(docs[0].description ?? null).toBeNull();
  });

  it("funciona no banco demo do navegador", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/client", async () => {
      const { createDemoDb } = await import("@/lib/db/demo");
      const db = createDemoDb();
      return { getDb: async () => db, isTauriRuntime: () => false };
    });
    localStorage.clear();
    const { DEMO_COMPANY_ID } = await import("@/lib/db/demo");
    const metadata = await import("./metadata");
    const store = await import("@/lib/files/store");
    const { created } = await metadata.saveDocumentMetadata(DEMO_COMPANY_ID, { role: "ceo", userId: "demo-user" }, "Compartilhados", { created: [{ title: "Checklist.docx" }], updated: [] });
    await metadata.saveDocumentMetadata(DEMO_COMPANY_ID, { role: "ceo", userId: "demo-user" }, "Compartilhados", { created: [], updated: [{ id: created[0].id, description: "Revisar mensalmente" }] });
    const saved = (await store.listFolderDocuments(DEMO_COMPANY_ID)).find((doc: DocumentRow) => doc.id === created[0].id);
    expect(saved).toMatchObject({ title: "Checklist.docx", description: "Revisar mensalmente" });
    vi.doUnmock("@/lib/db/client");
  });
});
