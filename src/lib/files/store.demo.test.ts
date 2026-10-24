// @vitest-environment jsdom
// O mesmo armazenamento no banco demo do navegador: documents é tabela "leniente" (WHERE não entendido vira filtro por
// empresa, em silêncio), então cada consulta do store precisa dar o resultado certo aqui também.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", async () => {
  const demo = await import("@/lib/db/demo");
  return {
    isTauriRuntime: () => false,
    getDb: async () => {
      state.db ??= demo.createDemoDb();
      return state.db;
    },
  };
});

import { DEMO_COMPANY_ID } from "@/lib/db/demo";
import type { DocumentRow } from "@/types";
import { createMemoryFileBackend, type MemoryFileBackend } from "./backend";
import { demoFileBackend } from "./demoStore";
import {
  deleteFile,
  listAllAttachments,
  listAttachments,
  listFolderDocuments,
  listVersions,
  openFile,
  readBlobText,
  renameDocument,
  restoreVersion,
  saveFile,
  setFileBackend,
} from "./store";

const C = DEMO_COMPANY_ID;
const U = "demo-ceo";
let memory: MemoryFileBackend;

beforeEach(() => {
  localStorage.clear();
  state.db = null;
  memory = createMemoryFileBackend();
  setFileBackend(memory);
});

const file = (content: string, name: string, type = "text/plain") => new File([content], name, { type });

describe("arquivos no banco demo", () => {
  it("lista os documentos do seed (sem arquivo) e versiona um deles ao enviar o mesmo nome na mesma pasta", async () => {
    const before = await listFolderDocuments(C);
    expect(before.length).toBeGreaterThanOrEqual(15);
    const seeded = before.find((doc) => doc.id === "doc-1")!;
    expect(seeded).toMatchObject({ version: 2, storage_key: null });

    const next = await saveFile(C, file("%PDF-1.4", "Contrato de suporte NorteLog.pdf", "application/pdf"), { userId: U, folder: "Comercial/Contratos" });
    expect(next).toMatchObject({ version: 3, parent_version_id: "doc-1", folder: "Comercial/Contratos" });
    const after = await listFolderDocuments(C);
    expect(after.map((doc) => doc.id)).toContain(next.id);
    expect(after.map((doc) => doc.id)).not.toContain("doc-1");
    expect((await listVersions(next)).map((doc) => doc.id)).toEqual([next.id, "doc-1"]);
  });

  it("anexos por registro: lista, versiona, renomeia, restaura e exclui", async () => {
    const a1 = await saveFile(C, file("um", "Ata.txt"), { userId: U, entityType: "customer", entityId: "customer-1" });
    const other = await saveFile(C, file("um", "Ata.txt"), { userId: U, entityType: "customer", entityId: "customer-2" });
    const a2 = await saveFile(C, file("dois", "Ata.txt"), { userId: U, entityType: "customer", entityId: "customer-1" });
    expect(a2).toMatchObject({ version: 2, parent_version_id: a1.id });
    expect(memory.keys()).toHaveLength(2);
    expect((await listAttachments(C, "customer", "customer-1")).map((doc) => doc.id)).toEqual([a2.id]);
    expect((await listAllAttachments(C)).map((doc) => doc.id).sort()).toEqual([a2.id, other.id].sort());
    expect((await listFolderDocuments(C)).some((doc) => doc.entity_type)).toBe(false);

    const renamed = await renameDocument(a2, "Ata de reunião.txt", U);
    expect((await listVersions(renamed)).map((doc) => doc.title)).toEqual(["Ata de reunião.txt", "Ata de reunião.txt"]);

    const a3 = await restoreVersion(a1, U);
    expect(a3).toMatchObject({ version: 3, title: "Ata de reunião.txt" });
    expect(await readBlobText(await openFile(a3))).toBe("um");

    await deleteFile(a3, { userId: U });
    expect(await listAttachments(C, "customer", "customer-1")).toEqual([]);
    // "um" continua usado pelo anexo do outro cliente; "dois" saiu junto com o documento.
    expect(memory.keys()).toHaveLength(1);
    const db = (state.db as { select<T>(sql: string, binds?: unknown[]): Promise<T> });
    const all = await db.select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND entity_id=?", [C, "customer-1"]);
    expect(all.every((doc) => doc.deleted_at)).toBe(true);
  });

  it("sem IndexedDB (navegador antigo, janela privada), o armazenamento do navegador cai para a memória e avisa", async () => {
    const backend = demoFileBackend();
    expect(backend.persistent).toBe(false);
    await backend.write("demo-company/ab/abc", new Uint8Array([1, 2, 3]));
    expect(await backend.exists("demo-company/ab/abc")).toBe(true);
    expect(Array.from(await backend.read("demo-company/ab/abc"))).toEqual([1, 2, 3]);
  });
});
