// Documentos com arquivo real (Tarefa 6): bytes em disco por hash (dedupe), metadados e versões em `documents` (SQLite real).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const dialog = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
const fsPlugin = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", async (original) => ({ ...(await original<object>()), writeFile: fsPlugin.writeFile }));

import { insertTestCompany } from "@/test/sqlite";
import { useTestDb } from "@/test/mockDb";
import { createDiskFileBackend, type DiskFileBackend } from "@/test/fileBackend";
import type { DocumentRow } from "@/types";
import {
  DEFAULT_MAX_FILE_BYTES,
  FileStoreError,
  currentVersions,
  deleteFile,
  documentFolder,
  downloadFile,
  getMaxFileBytes,
  listAttachments,
  listFolderDocuments,
  listVersions,
  openFile,
  renameDocument,
  restoreVersion,
  sanitizeFileName,
  saveFile,
  setFileBackend,
  sha256Hex,
} from "./store";

const testDb = useTestDb();
const C = "test-company";
const U = "test-user-ceo";
let disk: DiskFileBackend;

beforeEach(async () => {
  disk = createDiskFileBackend();
  setFileBackend(disk);
  await insertTestCompany(testDb(), { roles: ["ceo", "comercial"] });
});

afterEach(() => {
  setFileBackend(null);
  disk.dispose();
  vi.clearAllMocks();
});

const file = (content: string | Uint8Array<ArrayBuffer>, name: string, type = "text/plain") => new File([content], name, { type });

async function rows(): Promise<DocumentRow[]> {
  return testDb().select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? ORDER BY created_at, version", [C]);
}

async function expectStoreError(promise: Promise<unknown>, code: FileStoreError["code"], message: RegExp) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(FileStoreError);
  expect((error as FileStoreError).code).toBe(code);
  expect((error as FileStoreError).message).toMatch(message);
}

describe("sanitizeFileName", () => {
  it("tira pastas e .. do nome (caminho Unix e Windows)", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\Windows\\boot.ini")).toBe("boot.ini");
    expect(sanitizeFileName("/var/tmp/../x")).toBe("x");
  });

  it("troca caracteres proibidos, tira controle e pontos/espaços das pontas", () => {
    expect(sanitizeFileName('a<b>:c|d?"e*.pdf')).toBe("a_b__c_d__e_.pdf");
    expect(sanitizeFileName("nota\u0000\u001f fiscal.pdf")).toBe("nota fiscal.pdf");
    expect(sanitizeFileName("fatura\u202Efdp.exe")).toBe("faturafdp.exe");
    expect(sanitizeFileName("  .env ")).toBe("env");
    expect(sanitizeFileName("relatório   final .pdf.")).toBe("relatório final .pdf");
  });

  it("nome vazio, só pontos ou reservado do Windows vira um nome seguro", () => {
    expect(sanitizeFileName("")).toBe("arquivo");
    expect(sanitizeFileName("..")).toBe("arquivo");
    expect(sanitizeFileName("../")).toBe("arquivo");
    expect(sanitizeFileName("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFileName("lpt1")).toBe("_lpt1");
  });

  it("mantém acentos (NFC) e corta nome longo preservando a extensão", () => {
    expect(sanitizeFileName("Cotação.xlsx")).toBe("Cotação.xlsx");
    const long = sanitizeFileName(`${"a".repeat(400)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(180);
    expect(long.endsWith(".pdf")).toBe(true);
  });
});

describe("saveFile", () => {
  it("grava os bytes em <empresa>/<sha[0..2]>/<sha> e a linha com storage_key, mime, tamanho e hash", async () => {
    const doc = await saveFile(C, file("olá, mundo", "../../Proposta.txt"), { userId: U, folder: "Comercial/Propostas" });
    const sha = await sha256Hex(new TextEncoder().encode("olá, mundo"));
    expect(doc).toMatchObject({
      company_id: C,
      title: "Proposta.txt",
      original_name: "../../Proposta.txt",
      type: "TXT",
      mime: "text/plain",
      size_bytes: new TextEncoder().encode("olá, mundo").length,
      sha256: sha,
      storage_key: `${C}/${sha.slice(0, 2)}/${sha}`,
      version: 1,
      parent_version_id: null,
      folder: "Comercial/Propostas",
      file_path: "/Comercial/Propostas/Proposta.txt",
      uploaded_by: U,
      entity_type: null,
      deleted_at: null,
    });
    expect(disk.listFiles()).toEqual([`${C}/${sha.slice(0, 2)}/${sha}`]);
    expect(await rows()).toHaveLength(1);
  });

  it("mesmo conteúdo duas vezes: 1 arquivo em disco, 2 linhas", async () => {
    await saveFile(C, file("conteúdo igual", "a.txt"), { userId: U, folder: "Compartilhados" });
    await saveFile(C, file("conteúdo igual", "b.txt"), { userId: U, folder: "Compartilhados" });
    await saveFile(C, file("conteúdo igual", "b.txt"), { userId: U, folder: "Compartilhados" });
    expect(disk.listFiles()).toHaveLength(1);
    const saved = await rows();
    expect(saved).toHaveLength(3);
    expect(new Set(saved.map((row) => row.storage_key)).size).toBe(1);
  });

  it("mesmo título com conteúdo novo vira a versão 2 (parent_version_id) e só a última aparece na lista", async () => {
    const v1 = await saveFile(C, file("primeira", "Contrato.pdf", "application/pdf"), { userId: U, folder: "Comercial" });
    const v2 = await saveFile(C, file("segunda", "contrato.PDF", "application/pdf"), { userId: U, folder: "Comercial" });
    expect(v2).toMatchObject({ version: 2, parent_version_id: v1.id, title: "Contrato.pdf", file_path: "/Comercial/Contrato.pdf" });
    expect(disk.listFiles()).toHaveLength(2);
    expect((await listVersions(v2)).map((doc) => doc.version)).toEqual([2, 1]);
    expect((await listVersions(v1)).map((doc) => doc.id)).toEqual([v2.id, v1.id]);
    expect((await listFolderDocuments(C)).map((doc) => doc.id)).toEqual([v2.id]);
  });

  it("versão é por pasta ou por registro: mesmo nome em outro lugar começa na v1", async () => {
    const a = await saveFile(C, file("x", "Ata.txt"), { userId: U, folder: "Comercial" });
    const b = await saveFile(C, file("y", "Ata.txt"), { userId: U, folder: "Financeiro" });
    const c = await saveFile(C, file("z", "Ata.txt"), { userId: U, entityType: "customer", entityId: "cli-1" });
    const d = await saveFile(C, file("w", "Ata.txt"), { userId: U, entityType: "customer", entityId: "cli-2" });
    const e = await saveFile(C, file("k", "Ata.txt"), { userId: U, entityType: "customer", entityId: "cli-1" });
    expect([a, b, c, d].map((doc) => doc.version)).toEqual([1, 1, 1, 1]);
    expect(e).toMatchObject({ version: 2, parent_version_id: c.id, entity_type: "customer", entity_id: "cli-1", folder: null });
    expect((await listAttachments(C, "customer", "cli-1")).map((doc) => doc.id)).toEqual([e.id]);
    expect((await listFolderDocuments(C)).map((doc) => doc.title).sort()).toEqual(["Ata.txt", "Ata.txt"]);
  });

  it("documento antigo (só metadados, pasta no file_path) ganha a nova versão", async () => {
    await testDb().execute("INSERT INTO documents (id, company_id, title, type, file_path, version) VALUES (?,?,?,?,?,?)", [
      "legado-1", C, "Política.pdf", "PDF", "/Compartilhados/Políticas/Política.pdf", 2,
    ]);
    const next = await saveFile(C, file("%PDF-1.4 nova", "Política.pdf", "application/pdf"), { userId: U, folder: "Compartilhados/Políticas" });
    expect(next).toMatchObject({ version: 3, parent_version_id: "legado-1", folder: "Compartilhados/Políticas" });
    expect((await listFolderDocuments(C)).map((doc) => doc.id)).toEqual([next.id]);
  });

  it("versionOf força a nova versão de um documento mesmo com outro nome de arquivo", async () => {
    const v1 = await saveFile(C, file("1", "Manual.txt"), { userId: U, folder: "Guias" });
    const v2 = await saveFile(C, file("2", "manual-revisado-final.txt"), { userId: U, versionOf: v1 });
    expect(v2).toMatchObject({ title: "Manual.txt", version: 2, parent_version_id: v1.id, folder: "Guias", original_name: "manual-revisado-final.txt" });
  });

  it("recusa arquivo de 0 bytes e acima do limite com mensagem, sem gravar nada", async () => {
    await expectStoreError(saveFile(C, file("", "vazio.txt"), { userId: U }), "empty", /vazio\.txt.*vazio/);
    await expectStoreError(
      saveFile(C, new File([new Uint8Array(DEFAULT_MAX_FILE_BYTES + 1)], "grande.bin"), { userId: U }),
      "too_large",
      /grande\.bin.*limite é 50 MB/,
    );
    await expectStoreError(saveFile(C, file("123456", "seis.txt"), { userId: U, maxBytes: 5 }), "too_large", /limite/);
    expect(await rows()).toHaveLength(0);
    expect(disk.listFiles()).toHaveLength(0);
  });

  it("o limite vem de settings (documents.max_file_mb) quando a empresa configurou", async () => {
    expect(await getMaxFileBytes(C)).toBe(DEFAULT_MAX_FILE_BYTES);
    await testDb().execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?,?,?,?)", ["s-1", C, "documents.max_file_mb", "2"]);
    expect(await getMaxFileBytes(C)).toBe(2 * 1024 * 1024);
    await expectStoreError(saveFile(C, new File([new Uint8Array(2 * 1024 * 1024 + 1)], "a.bin"), { userId: U }), "too_large", /limite é 2 MB/);
  });

  it("recusa empresa com caracteres de caminho", async () => {
    await expectStoreError(saveFile("../outra", file("x", "x.txt"), { userId: U }), "invalid", /empresa/i);
    expect(disk.listFiles()).toHaveLength(0);
  });

  it("normaliza a pasta (sem .., sem barras extras)", async () => {
    const doc = await saveFile(C, file("x", "x.txt"), { userId: U, folder: "/../Comercial//./Contratos/../" });
    expect(doc.folder).toBe("Comercial/Contratos");
    expect(documentFolder(doc)).toBe("Comercial/Contratos");
  });
});

describe("openFile e downloadFile", () => {
  it("round-trip: saveFile → openFile devolve bytes idênticos e o tipo", async () => {
    const bytes = Uint8Array.from({ length: 256 * 3 }, (_, i) => i % 256);
    const doc = await saveFile(C, new File([bytes], "binario.bin", { type: "application/octet-stream" }), { userId: U });
    const blob = await openFile(doc);
    expect(blob.type).toBe("application/octet-stream");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it("documento sem arquivo (registro antigo) avisa em vez de baixar", async () => {
    await testDb().execute("INSERT INTO documents (id, company_id, title, file_path) VALUES (?,?,?,?)", ["legado", C, "x.pdf", "/x.pdf"]);
    const [legacy] = await rows();
    await expectStoreError(openFile(legacy), "no_content", /não tem arquivo/);
  });

  it("arquivo alterado em disco é recusado como corrompido; ausente, como não encontrado", async () => {
    const doc = await saveFile(C, file("original", "a.txt"), { userId: U });
    writeFileSync(disk.pathFor(doc.storage_key!), "adulterado");
    await expectStoreError(openFile(doc), "corrupted", /corrompido/);
    await disk.remove(doc.storage_key!);
    await expectStoreError(openFile(doc), "missing", /não foi encontrado/);
  });

  it("storage_key adulterada no banco não sai da pasta de arquivos", async () => {
    const doc = await saveFile(C, file("x", "a.txt"), { userId: U });
    await expectStoreError(openFile({ ...doc, storage_key: "../../../etc/passwd" }), "invalid", /inválid/);
  });

  it("no desktop, downloadFile pede o destino (salvar como) e grava os bytes lá", async () => {
    const doc = await saveFile(C, file("baixar isto", "Relatório.txt"), { userId: U });
    dialog.save.mockResolvedValueOnce("/Users/x/Downloads/Relatório.txt");
    await expect(downloadFile(doc)).resolves.toBe(true);
    expect(dialog.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "Relatório.txt" }));
    expect(fsPlugin.writeFile).toHaveBeenCalledTimes(1);
    const [path, data] = fsPlugin.writeFile.mock.calls[0] as [string, Uint8Array];
    expect(path).toBe("/Users/x/Downloads/Relatório.txt");
    expect(new TextDecoder().decode(data)).toBe("baixar isto");

    dialog.save.mockResolvedValueOnce(null);
    await expect(downloadFile(doc)).resolves.toBe(false);
    expect(fsPlugin.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("deleteFile, renomear e restaurar", () => {
  it("soft delete; os bytes só somem quando nenhuma linha ativa usa o mesmo arquivo", async () => {
    const a = await saveFile(C, file("compartilhado", "a.txt"), { userId: U });
    const b = await saveFile(C, file("compartilhado", "b.txt"), { userId: U });
    await deleteFile(a, { userId: U });
    const [deletedA] = await testDb().select<DocumentRow[]>("SELECT * FROM documents WHERE id=?", [a.id]);
    expect(deletedA.deleted_at).toBeTruthy();
    expect(disk.listFiles()).toHaveLength(1);
    await deleteFile(b, { userId: U });
    expect(disk.listFiles()).toHaveLength(0);
    expect(await rows()).toHaveLength(2);
  });

  it("excluir o documento apaga todas as versões; excluir só uma versão religa a corrente", async () => {
    const v1 = await saveFile(C, file("1", "Plano.txt"), { userId: U });
    const v2 = await saveFile(C, file("2", "Plano.txt"), { userId: U });
    const v3 = await saveFile(C, file("3", "Plano.txt"), { userId: U });
    await deleteFile(v2, { userId: U, onlyThisVersion: true });
    expect((await listVersions(v3)).map((doc) => doc.version)).toEqual([3, 1]);
    expect((await listFolderDocuments(C)).map((doc) => doc.id)).toEqual([v3.id]);
    expect(disk.listFiles()).toHaveLength(2);

    await deleteFile(v1, { userId: U });
    expect(await listFolderDocuments(C)).toEqual([]);
    expect(disk.listFiles()).toHaveLength(0);
  });

  it("renomear muda todas as versões; nome já usado na pasta é recusado", async () => {
    const v1 = await saveFile(C, file("1", "Rascunho.txt"), { userId: U, folder: "Comercial" });
    const v2 = await saveFile(C, file("2", "Rascunho.txt"), { userId: U, folder: "Comercial" });
    await saveFile(C, file("3", "Outro.txt"), { userId: U, folder: "Comercial" });
    const renamed = await renameDocument(v2, "../Final.md", U);
    expect(renamed).toMatchObject({ title: "Final.md", type: "MD", file_path: "/Comercial/Final.md" });
    expect((await listVersions(v1)).map((doc) => [doc.title, doc.file_path])).toEqual([
      ["Final.md", "/Comercial/Final.md"],
      ["Final.md", "/Comercial/Final.md"],
    ]);
    await expectStoreError(renameDocument(renamed, "outro.TXT", U), "name_taken", /já existe/i);
  });

  it("restaurar uma versão antiga cria a versão seguinte com os mesmos bytes (sem novo arquivo)", async () => {
    const v1 = await saveFile(C, file("um", "Doc.txt"), { userId: U });
    await saveFile(C, file("dois", "Doc.txt"), { userId: U });
    const v3 = await restoreVersion(v1, U);
    expect(v3).toMatchObject({ version: 3, sha256: v1.sha256, storage_key: v1.storage_key, title: "Doc.txt" });
    expect(disk.listFiles()).toHaveLength(2);
    expect(new TextDecoder().decode(await (await openFile(v3)).arrayBuffer())).toBe("um");
  });
});

describe("currentVersions", () => {
  it("fica só com a ponta de cada corrente de versões", () => {
    const base = { company_id: C, file_path: "/x", tags_json: "[]", created_at: "", updated_at: "" };
    const list = [
      { ...base, id: "a1", title: "a", version: 1, parent_version_id: null },
      { ...base, id: "a2", title: "a", version: 2, parent_version_id: "a1" },
      { ...base, id: "b1", title: "b", version: 1, parent_version_id: null },
    ] as DocumentRow[];
    expect(currentVersions(list).map((doc) => doc.id)).toEqual(["a2", "b1"]);
  });
});
