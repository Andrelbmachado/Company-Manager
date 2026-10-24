// Anexos de um registro na tela: enviar (botão e arrastar), nova versão, recusa com motivo, baixar e remover.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { createMemoryFileBackend, type MemoryFileBackend } from "@/lib/files/backend";
import { setFileBackend } from "@/lib/files/store";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { DocumentRow, Session } from "@/types";
import { FileAttachments } from "./FileAttachments";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
const dialog = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
const fsPlugin = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", async (original) => ({ ...(await original<object>()), writeFile: fsPlugin.writeFile }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();
const C = "test-company";
const session = {
  user: { id: "test-user-comercial", name: "Teste comercial", email: "comercial@teste.local" },
  membership: { id: "test-member-test-company-comercial", company_id: C, user_id: "test-user-comercial", role: "comercial", scope: "setor" },
  company: { id: C, name: "Empresa de Teste" },
} as unknown as Session;

let root: Root;
let container: HTMLDivElement;
let memory: MemoryFileBackend;

async function render(canEdit: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ session, setSession: () => undefined }}>
          <FileAttachments entityType="customer" entityId="cli-1" canEdit={canEdit} />
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
}

beforeEach(async () => {
  memory = createMemoryFileBackend();
  setFileBackend(memory);
  await insertTestCompany(testDb(), { roles: ["ceo", "comercial"] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setFileBackend(null);
  document.body.innerHTML = "";
  vi.clearAllMocks();
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
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

async function choose(input: HTMLInputElement | null, files: File[]) {
  if (!input) throw new Error("campo de arquivo não encontrado");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function attachments(): Promise<DocumentRow[]> {
  return testDb().select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND entity_type='customer' AND entity_id='cli-1' ORDER BY version", [C]);
}

describe("FileAttachments", () => {
  it("mostra o estado vazio e, sem permissão, não oferece envio", async () => {
    await render(false);
    await until(() => text().includes("Nenhum anexo"), "estado vazio");
    expect(text()).toContain("Os arquivos deste registro vão aparecer aqui.");
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(container.querySelector('[data-entity-id="cli-1"]')).not.toBeNull();
  });

  it("envia pelo botão, recusa arquivo vazio com motivo e manda nova versão do mesmo arquivo", async () => {
    await render(true);
    await until(() => text().includes("Nenhum anexo"), "estado vazio");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Escolher arquivos para anexar"]');
    await choose(input, [new File(["proposta v1"], "Proposta.txt", { type: "text/plain" }), new File([], "vazio.txt")]);
    await until(() => text().includes("1 arquivo enviado"), "resumo do envio");
    expect(container.querySelector("[role=alert]")?.textContent).toContain('O arquivo "vazio.txt" está vazio (0 bytes).');
    expect(text()).toContain("Proposta.txt");
    expect(text()).toContain("v1 ·");

    const versionInput = container.querySelector<HTMLInputElement>('input[aria-label="Escolher arquivo da nova versão"]');
    await act(async () => button("Enviar nova versão de Proposta.txt")!.click());
    await choose(versionInput, [new File(["proposta v2"], "proposta-revisada.txt", { type: "text/plain" })]);
    await until(() => text().includes("v2 ·"), "nova versão na lista");
    expect(text()).toContain("1 como nova versão");
    const rows = await attachments();
    expect(rows.map((row) => [row.title, row.version])).toEqual([["Proposta.txt", 1], ["Proposta.txt", 2]]);
    expect(memory.keys()).toHaveLength(2);

    await act(async () => button("Versões de Proposta.txt")!.click());
    await until(() => container.querySelector('[aria-label="Histórico de versões"]')?.textContent?.includes("v1") ?? false, "histórico");
    expect(container.querySelector('[aria-label="Histórico de versões"]')!.textContent).toContain("Atual");
  });

  it("aceita arquivos arrastados e soltos", async () => {
    await render(true);
    await until(() => text().includes("Nenhum anexo"), "estado vazio");
    const zone = container.querySelector<HTMLElement>('section[data-entity-id="cli-1"]')!;
    const file = new File(["%PDF-1.4"], "Contrato.pdf", { type: "application/pdf" });
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "none" };
    await act(async () => {
      const enter = new Event("dragenter", { bubbles: true, cancelable: true });
      Object.defineProperty(enter, "dataTransfer", { value: dataTransfer });
      zone.dispatchEvent(enter);
    });
    expect(text()).toContain("Solte os arquivos para anexar");
    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      zone.dispatchEvent(drop);
    });
    await until(() => text().includes("Contrato.pdf"), "arquivo solto na lista");
    expect(text()).not.toContain("Solte os arquivos para anexar");
    expect((await attachments()).map((row) => row.mime)).toEqual(["application/pdf"]);
  });

  it("baixa pelo diálogo de salvar e remove com confirmação (exclusão lógica)", async () => {
    await render(true);
    await until(() => text().includes("Nenhum anexo"), "estado vazio");
    await choose(container.querySelector<HTMLInputElement>('input[aria-label="Escolher arquivos para anexar"]'), [new File(["conteúdo"], "Ata.txt")]);
    await until(() => text().includes("Ata.txt"), "anexo na lista");

    dialog.save.mockResolvedValueOnce("/tmp/Ata.txt");
    await act(async () => button("Baixar Ata.txt")!.click());
    await until(() => fsPlugin.writeFile.mock.calls.length === 1, "gravação do download");
    expect(new TextDecoder().decode(fsPlugin.writeFile.mock.calls[0][1] as Uint8Array)).toBe("conteúdo");

    await act(async () => button("Remover Ata.txt")!.click());
    const confirm = [...container.querySelectorAll("button")].find((element) => element.textContent === "Remover");
    await act(async () => confirm!.click());
    await until(() => text().includes("Nenhum anexo"), "lista vazia depois de remover");
    const [row] = await attachments();
    expect(row.deleted_at).toBeTruthy();
    expect(memory.keys()).toHaveLength(0);
  });

  it("pré-visualiza texto (inclusive o começo de um arquivo grande, sem estragar os acentos) e nunca oferece HTML", async () => {
    await render(true);
    await until(() => text().includes("Nenhum anexo"), "estado vazio");
    // ~420 KB de texto: a prévia mostra os primeiros 256 KB (262.144 bytes). "ação " tem 7 bytes; com o prefixo de
    // 4 bytes, o último byte da prévia é o primeiro dos 2 bytes de um "ã".
    const longText = `Ata ${"ação ".repeat(60_000)}`;
    expect((262_144 - 4) % 7).toBe(4);
    await choose(container.querySelector<HTMLInputElement>('input[aria-label="Escolher arquivos para anexar"]'), [
      new File([longText], "notas.txt", { type: "text/plain" }),
      new File(["<script>alert(1)</script>"], "pagina.html", { type: "text/html" }),
    ]);
    await until(() => text().includes("2 arquivos enviados"), "envio");
    expect(button("Visualizar pagina.html")).toBeNull();
    expect(button("Visualizar notas.txt")).not.toBeNull();

    await act(async () => button("Visualizar notas.txt")!.click());
    const preview = () => document.querySelector('[role="dialog"][aria-label="Pré-visualização: notas.txt"]');
    await until(() => Boolean(preview()?.querySelector("pre")), "texto da prévia");
    const shown = preview()!.querySelector("pre")!.textContent ?? "";
    expect(shown.startsWith("Ata ação ação")).toBe(true);
    expect(shown).not.toContain("Ã");
    expect(longText.startsWith(shown)).toBe(true);
    expect(preview()!.textContent).toContain("Mostrando os primeiros 256 KB");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
