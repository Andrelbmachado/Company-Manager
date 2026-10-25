// Tela de Documentos com SQLite real: pastas por setor, envio para a pasta do setor, detalhe com versões e anexos,
// e pastas de nuvem conectadas lidas de uma pasta temporária de verdade (iCloud Drive e OneDrive falsos).
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { createMemoryFileBackend } from "@/lib/files/backend";
import { setCloudEnv, setCloudFs } from "@/lib/files/cloudFolders";
import { saveFile, setFileBackend } from "@/lib/files/store";
import { saveAreaLabels } from "@/lib/labels/store";
import { createNodeCloudFs, createTempHome, type TempHome } from "@/test/cloudFs";
import { useTestDb } from "@/test/mockDb";
import { type as typeInto } from "@/test/pageHarness";
import { insertTestCompany } from "@/test/sqlite";
import type { CloudFolder, DocumentRow, Role, Session } from "@/types";
import DocumentsPage from "./DocumentsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();
const C = "test-company";

let root: Root;
let container: HTMLDivElement;
let home: TempHome;
let picked: string | null = null;
const pickFolder = vi.fn(async (_options: { defaultPath?: string; title?: string }) => picked);
const ICLOUD = ["Library", "Mobile Documents", "com~apple~CloudDocs"];

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
  await insertTestCompany(testDb(), { roles: ["ceo", "comercial", "rh", "auditor"] });
  await legacy("d-com", "Contrato NorteLog.pdf", "/Comercial/Contratos/Contrato NorteLog.pdf", 2);
  await legacy("d-fin", "Fechamento.pdf", "/Financeiro/Fechamento.pdf");
  await legacy("d-ti", "Relatório.pdf", "/TI e Operações/Relatório.pdf");
  await legacy("d-share", "Manual.pdf", "/Compartilhados/Manual.pdf");
  home = createTempHome();
  const empresa = home.mkdir(...ICLOUD, "Empresa");
  mkdirSync(path.join(empresa, "Contratos"));
  writeFileSync(path.join(empresa, "Contratos", "Assinado.pdf"), "%PDF-1");
  writeFileSync(path.join(empresa, "Leia-me.txt"), "Olá da nuvem");
  writeFileSync(path.join(empresa, ".DS_Store"), "x");
  const fora = home.mkdir("Fora");
  symlinkSync(fora, path.join(empresa, "atalho-fora"));
  home.mkdir("Library", "CloudStorage", "OneDrive-Pessoal");
  picked = null;
  pickFolder.mockClear();
  setCloudFs(createNodeCloudFs());
  setCloudEnv({ homeDir: async () => home.home, pickFolder });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setFileBackend(null);
  setCloudFs(null);
  setCloudEnv(null);
  home.dispose();
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
  it("o título da página é o rótulo do módulo na área da empresa (editável em Configurações)", async () => {
    await saveAreaLabels(testDb(), C, { role: "ceo", userId: "test-user-ceo" }, { overrides: { "module.documents": "Arquivos da empresa" } });
    await render("comercial");
    await until(() => container.querySelector("h1")?.textContent === "Arquivos da empresa", "título com o rótulo da área");
  });

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

describe("DocumentsPage — anexos ordenam e filtram", () => {
  it("Registro ordena e filtra pelo nome mostrado (não pelo código do registro)", async () => {
    const db = testDb();
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES (?,?,?,?)", ["cli-1", C, "PJ", "NorteLog"]);
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES (?,?,?,?)", ["cli-2", C, "PJ", "Aurora Ltda"]);
    await saveFile(C, new File(["a"], "Contrato assinado.pdf"), { userId: "test-user-ceo", entityType: "customer", entityId: "cli-1" });
    await saveFile(C, new File(["b"], "Proposta.pdf"), { userId: "test-user-ceo", entityType: "customer", entityId: "cli-2" });

    await render("comercial");
    await until(() => text().includes("Compartilhados"), "pastas");
    await click(container.querySelector("#tab-documentos-anexos"));
    await until(() => text().includes("Aurora Ltda") && text().includes("NorteLog"), "anexos com o nome do registro");
    const panel = container.querySelector<HTMLElement>("#painel-documentos-anexos")!;
    const files = () => [...panel.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent?.trim());
    await click(panel.querySelector("th [data-sort-key='owner']"));
    expect(files()).toEqual(["Proposta.pdf", "Contrato assinado.pdf"]);
    await click(panel.querySelector("button[aria-label='Filtrar']"));
    const owner = panel.querySelector<HTMLInputElement>("[aria-label='Registro: contém']")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(owner, "norte");
    await act(async () => {
      owner.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(files()).toEqual(["Contrato assinado.pdf"]);
  });
});

describe("DocumentsPage — pastas de nuvem", () => {
  const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  async function connectRow(id: string, createdBy: string, localPath: string, label: string) {
    await testDb().execute("INSERT INTO cloud_folders (id, company_id, provider, label, local_path, created_by) VALUES (?,?,?,?,?,?)", [id, C, "icloud", label, localPath, createdBy]);
  }

  it("pastas internas usam o ícone chapado, sem gradiente nem azul", async () => {
    await render("ceo");
    await until(() => buttonWith("Financeiro") !== null, "pastas");
    expect(container.querySelectorAll("svg[data-folder-icon]").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toMatch(/bg-gradient|bg-blue|from-blue/);
  });

  it("Conectar nuvem acha iCloud e OneDrive, explica como instalar o que falta e conecta a pasta escolhida no seletor", async () => {
    await render("ceo");
    await until(() => text().includes("Compartilhados"), "pastas");
    await click(buttonWith("Conectar nuvem"));
    await until(() => text().includes("OneDrive (Pessoal)"), "detecção");
    expect(text()).toContain("iCloud Drive");
    expect(text()).toContain("Instale o Google Drive");
    expect(text()).toContain("Instale o Dropbox");

    picked = home.at(...ICLOUD, "Empresa");
    await click(byLabel("Escolher pasta: iCloud Drive"));
    expect(pickFolder).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: home.at(...ICLOUD) }));
    await until(() => (container.querySelector('[data-cloud-folder="Empresa"]') ?? null) !== null, "pasta conectada na grade");
    const [row] = await testDb().select<CloudFolder[]>("SELECT * FROM cloud_folders WHERE company_id=?", [C]);
    expect(row).toMatchObject({ provider: "icloud", label: "Empresa", local_path: home.at(...ICLOUD, "Empresa"), created_by: "test-user-ceo" });

    await click(container.querySelector('[data-cloud-folder="Empresa"]'));
    await until(() => text().includes("Leia-me.txt"), "arquivos da nuvem");
    expect(text()).toContain("Contratos");
    expect(text()).not.toContain(".DS_Store");
    expect(text()).not.toContain("atalho-fora");
    await click(buttonWith("Contratos"));
    await until(() => text().includes("Assinado.pdf"), "subpasta da nuvem");
    await click(buttonWith("Documentos /"));
    await until(() => text().includes("Compartilhados"), "volta às pastas");
  });

  it("abre um arquivo da nuvem e envia arquivo novo para a pasta conectada, sem sobrescrever", async () => {
    const root = home.at(...ICLOUD, "Empresa");
    await connectRow("nuvem-1", "test-user-comercial", root, "Empresa");
    await render("comercial");
    await until(() => container.querySelector('[data-cloud-folder="Empresa"]') !== null, "pasta conectada");
    await click(container.querySelector('[data-cloud-folder="Empresa"]'));
    await until(() => text().includes("Leia-me.txt"), "arquivos");

    await click(buttonWith("Leia-me.txt"));
    const dialog = () => container.querySelector('[role="dialog"]');
    await until(() => dialog()?.textContent?.includes("Olá da nuvem") ?? false, "pré-visualização");
    await click(dialog()!.querySelector('button[aria-label="Fechar"]'));

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Escolher arquivos para enviar à nuvem"]')!;
    Object.defineProperty(input, "files", { value: [new File(["versão nova"], "Leia-me.txt", { type: "text/plain" })], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await until(() => text().includes("1 arquivo enviado"), "envio para a nuvem");
    await until(() => text().includes("Leia-me (2).txt"), "arquivo novo na lista");
    expect(readFileSync(path.join(root, "Leia-me.txt"), "utf8")).toBe("Olá da nuvem");
    expect(readFileSync(path.join(root, "Leia-me (2).txt"), "utf8")).toBe("versão nova");

    // Arquivo vazio (ou pasta arrastada, que chega com 0 bytes) não vira arquivo na nuvem.
    Object.defineProperty(input, "files", { value: [new File([], "Vazio.txt", { type: "text/plain" })], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await until(() => container.querySelector('[role="alert"]')?.textContent?.includes("“Vazio.txt” está vazio") ?? false, "recusa do arquivo vazio");
    expect(readdirSync(root)).not.toContain("Vazio.txt");
  });

  it("cada setor só vê a pasta que conectou; quem vê tudo vê todas; pasta sumida dá erro legível", async () => {
    await connectRow("nuvem-ceo", "test-user-ceo", home.at(...ICLOUD, "Diretoria"), "Diretoria");
    await connectRow("nuvem-com", "test-user-comercial", home.at(...ICLOUD, "Empresa"), "Empresa");
    await render("comercial");
    await until(() => container.querySelector('[data-cloud-folder="Empresa"]') !== null, "pasta do comercial");
    expect(container.querySelector('[data-cloud-folder="Diretoria"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await render("ceo");
    await until(() => container.querySelector('[data-cloud-folder="Diretoria"]') !== null, "pasta do CEO");
    expect(container.querySelector('[data-cloud-folder="Empresa"]')).not.toBeNull();
    await click(container.querySelector('[data-cloud-folder="Diretoria"]'));
    await until(() => container.querySelector('[role="alert"]')?.textContent?.includes("Pasta não encontrada") ?? false, "erro da pasta sumida");
  });

  it("escolher de novo no seletor uma pasta já conectada só libera o acesso a ela, sem erro nem cadastro repetido", async () => {
    const root = home.at(...ICLOUD, "Empresa");
    await connectRow("nuvem-com", "test-user-comercial", root, "Empresa");
    await render("comercial");
    await until(() => container.querySelector('[data-cloud-folder="Empresa"]') !== null, "pasta conectada");
    await click(buttonWith("Conectar nuvem"));
    await until(() => text().includes("OneDrive (Pessoal)"), "detecção");

    picked = `${root}/`;
    await click(byLabel("Escolher pasta: iCloud Drive"));
    await until(() => text().includes("“Empresa” já estava conectada"), "aviso de acesso liberado");
    expect(container.querySelector('section[aria-label="Conectar nuvem"] [role="alert"]')).toBeNull();
    expect(await testDb().select<CloudFolder[]>("SELECT * FROM cloud_folders WHERE company_id=?", [C])).toHaveLength(1);
  });

  const connectedTable = () => container.querySelector('[data-editable-table="documents"]');
  const tableButton = (label: string) => [...(connectedTable()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((element) => element.textContent?.trim() === label);

  it("Auditoria só consulta as pastas conectadas: Editar e Adicionar desativados com a dica, sem Desconectar nem Escolher pasta", async () => {
    await connectRow("nuvem-com", "test-user-comercial", home.at(...ICLOUD, "Empresa"), "Empresa");
    await render("auditor");
    await until(() => container.querySelector('[data-cloud-folder="Empresa"]') !== null, "pasta conectada (Auditoria vê todas)");
    await click(buttonWith("Conectar nuvem"));
    await until(() => connectedTable()?.textContent?.includes("Empresa") ?? false, "tabela das pastas conectadas");
    expect(text()).toContain("Seu perfil consulta as pastas conectadas, mas não conecta pastas novas.");
    for (const label of ["Editar", "Adicionar"]) {
      expect(tableButton(label)?.disabled, label).toBe(true);
      expect(tableButton(label)?.title, label).toMatch(/não tem permissão/);
    }
    expect(tableButton("Atualizar")?.disabled).toBe(false);
    expect(byLabel("Desconectar Empresa")).toBeNull();
    expect(byLabel("Escolher pasta: iCloud Drive")).toBeNull();
  });

  it("renomeia a pasta conectada na própria tabela, sem abrir diálogo, e a grade passa a mostrar o nome novo", async () => {
    const root = home.at(...ICLOUD, "Empresa");
    await connectRow("nuvem-com", "test-user-comercial", root, "Empresa");
    await render("comercial");
    await until(() => container.querySelector('[data-cloud-folder="Empresa"]') !== null, "pasta conectada");
    await click(buttonWith("Conectar nuvem"));
    await until(() => connectedTable()?.textContent?.includes("Empresa") ?? false, "tabela das pastas conectadas");

    await click(tableButton("Editar"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await typeInto(connectedTable()!.querySelector('input[aria-label="Nome (linha 1)"]'), "Contratos da empresa");
    await click(tableButton("Salvar"));
    await until(() => container.querySelector('[data-cloud-folder="Contratos da empresa"]') !== null, "nome novo na grade");
    const [row] = await testDb().select<CloudFolder[]>("SELECT * FROM cloud_folders WHERE id=?", ["nuvem-com"]);
    expect(row).toMatchObject({ label: "Contratos da empresa", local_path: root, provider: "icloud" });
  });
});
