// Pastas de nuvem: detecção pelos caminhos padrão do Mac, caminho seguro (sem "..", sem seguir link para fora da pasta
// conectada) com arquivos de verdade numa pasta temporária, e o cadastro em cloud_folders no SQLite real.
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeCloudFs, createTempHome, type TempHome } from "@/test/cloudFs";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { CloudFolder, Role } from "@/types";
import {
  CloudFolderError,
  browseCloudFolder,
  canManageCloudFolder,
  canSeeCloudFolder,
  cloudSubpath,
  connectCloudFolder,
  defaultCloudLabel,
  detectCloudFolders,
  disconnectCloudFolder,
  listCloudFolder,
  listCloudFolders,
  normalizeLocalPath,
  openCloudFile,
  providerForPath,
  readCloudFile,
  sendToCloudFolder,
  updateCloudFolder,
  writeCloudFile,
} from "./cloudFolders";

const HOME = "/Users/ana";
const ICLOUD = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`;
const STORAGE = `${HOME}/Library/CloudStorage`;

/** exists/list sobre um conjunto de caminhos falsos. */
function fakeDisk(paths: string[]) {
  const set = new Set(paths);
  return {
    exists: (p: string) => set.has(p),
    list: (dir: string) => [...set].filter((p) => path.posix.dirname(p) === dir).map((p) => path.posix.basename(p)),
  };
}

describe("detectCloudFolders", () => {
  it("acha o iCloud Drive e as contas do OneDrive com caminhos falsos", () => {
    const disk = fakeDisk([ICLOUD, STORAGE, `${STORAGE}/OneDrive-Pessoal`, `${STORAGE}/OneDrive-EmpresaX`, `${STORAGE}/.DS_Store`]);
    expect(detectCloudFolders(HOME, disk.exists, disk.list)).toEqual([
      { provider: "icloud", path: ICLOUD, label: "iCloud Drive" },
      { provider: "onedrive", path: `${STORAGE}/OneDrive-EmpresaX`, label: "OneDrive (EmpresaX)" },
      { provider: "onedrive", path: `${STORAGE}/OneDrive-Pessoal`, label: "OneDrive (Pessoal)" },
    ]);
  });

  it("acha Google Drive e Dropbox em ~/Library/CloudStorage, na ordem iCloud, Google Drive, OneDrive, Dropbox", () => {
    const disk = fakeDisk([STORAGE, `${STORAGE}/Dropbox`, `${STORAGE}/GoogleDrive-ana@gmail.com`, `${STORAGE}/Box-Box`, ICLOUD, `${HOME}/Dropbox`]);
    expect(detectCloudFolders(`${HOME}/`, disk.exists, disk.list)).toEqual([
      { provider: "icloud", path: ICLOUD, label: "iCloud Drive" },
      { provider: "gdrive", path: `${STORAGE}/GoogleDrive-ana@gmail.com`, label: "Google Drive (ana@gmail.com)" },
      // ~/Dropbox antigo fica de fora quando o Dropbox já está no CloudStorage (é o mesmo, por atalho).
      { provider: "dropbox", path: `${STORAGE}/Dropbox`, label: "Dropbox" },
    ]);
  });

  it("sem listar o CloudStorage, ainda acha as pastas antigas na home; sem nada, devolve vazio", () => {
    const disk = fakeDisk([`${HOME}/Dropbox`, `${HOME}/Google Drive`]);
    expect(detectCloudFolders(HOME, disk.exists)).toEqual([
      { provider: "gdrive", path: `${HOME}/Google Drive`, label: "Google Drive" },
      { provider: "dropbox", path: `${HOME}/Dropbox`, label: "Dropbox" },
    ]);
    expect(detectCloudFolders(HOME, () => false, () => [])).toEqual([]);
  });

  it("diz de qual serviço é uma pasta e sugere o nome", () => {
    expect(providerForPath(HOME, `${ICLOUD}/Empresa`)).toBe("icloud");
    expect(providerForPath(HOME, `${STORAGE}/GoogleDrive-ana@gmail.com/My Drive/Empresa`)).toBe("gdrive");
    expect(providerForPath(HOME, `${STORAGE}/OneDrive-Pessoal`)).toBe("onedrive");
    expect(providerForPath(HOME, `${HOME}/Dropbox/Contratos`)).toBe("dropbox");
    expect(providerForPath(HOME, `${HOME}/Documents/Empresa`)).toBe("outro");
    expect(defaultCloudLabel(HOME, ICLOUD)).toBe("iCloud Drive");
    expect(defaultCloudLabel(HOME, `${STORAGE}/GoogleDrive-ana@gmail.com`)).toBe("Google Drive (ana@gmail.com)");
    expect(defaultCloudLabel(HOME, `${ICLOUD}/Empresa/Contratos`)).toBe("Contratos");
  });
});

describe("caminhos", () => {
  it("normaliza a pasta conectada e recusa caminho relativo, com '..' ou a raiz do disco", () => {
    expect(normalizeLocalPath(`${HOME}/Dropbox/`)).toBe(`${HOME}/Dropbox`);
    expect(normalizeLocalPath(`  ${ICLOUD}  `)).toBe(ICLOUD);
    for (const bad of ["", "Dropbox", "~/Dropbox", `${HOME}/../bruno`, `${HOME}/./Dropbox`, "/", `${HOME}/Library/Application Support/com.company.manager`]) {
      expect(() => normalizeLocalPath(bad), bad).toThrow(CloudFolderError);
    }
  });

  it("subpasta: só nomes simples, nunca '..', '.', caminho absoluto ou item oculto", () => {
    expect(cloudSubpath("")).toEqual([]);
    expect(cloudSubpath("Contratos/2026")).toEqual(["Contratos", "2026"]);
    expect(cloudSubpath(["Contratos", "2026"])).toEqual(["Contratos", "2026"]);
    for (const bad of ["../fora", "Contratos/../../fora", "/etc", "./x", ".ssh", "a\u0000b"]) {
      expect(() => cloudSubpath(bad), bad).toThrow(CloudFolderError);
    }
  });
});

describe("arquivos da pasta conectada (disco de verdade)", () => {
  const fs = createNodeCloudFs();
  let tmp: TempHome;
  let root: string;
  let outside: string;

  beforeEach(() => {
    tmp = createTempHome();
    root = tmp.mkdir("Library", "Mobile Documents", "com~apple~CloudDocs", "Empresa");
    outside = tmp.mkdir("Fora");
    writeFileSync(path.join(outside, "segredo.txt"), "não pode sair");
    mkdirSync(path.join(root, "Contratos"));
    writeFileSync(path.join(root, "Contratos", "Assinado.pdf"), "%PDF-1");
    writeFileSync(path.join(root, "Proposta.pdf"), "12345");
    writeFileSync(path.join(root, ".DS_Store"), "x");
    writeFileSync(path.join(root, ".Planilha.xlsx.icloud"), "x");
    symlinkSync(outside, path.join(root, "atalho-fora"));
    symlinkSync(path.join(outside, "segredo.txt"), path.join(root, "segredo.txt"));
    symlinkSync(path.join(root, "Contratos"), path.join(root, "atalho-dentro"));
  });

  afterEach(() => tmp.dispose());

  it("lista pastas primeiro, sem itens ocultos e sem links simbólicos; arquivo só na nuvem aparece marcado", async () => {
    const entries = await listCloudFolder(root, "", fs);
    expect(entries.map((entry) => entry.name)).toEqual(["Contratos", "Planilha.xlsx", "Proposta.pdf"]);
    expect(entries[0]).toMatchObject({ name: "Contratos", isDir: true });
    expect(entries[1]).toMatchObject({ name: "Planilha.xlsx", isDir: false, cloudOnly: true });
    expect(entries[2]).toMatchObject({ name: "Proposta.pdf", isDir: false, size: 5 });
    expect(entries[2].modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await listCloudFolder(root, "Contratos", fs)).map((entry) => entry.name)).toEqual(["Assinado.pdf"]);
  });

  it("recusa '..' e link simbólico para fora da pasta conectada (listar, ler e gravar)", async () => {
    await expect(listCloudFolder(root, "../Fora", fs)).rejects.toBeInstanceOf(CloudFolderError);
    await expect(listCloudFolder(root, "atalho-fora", fs)).rejects.toThrow(/link/i);
    await expect(listCloudFolder(root, "atalho-dentro", fs)).rejects.toThrow(/link/i);
    await expect(readCloudFile(root, "segredo.txt", fs)).rejects.toThrow(/link/i);
    await expect(readCloudFile(root, "../Fora/segredo.txt", fs)).rejects.toBeInstanceOf(CloudFolderError);
    await expect(writeCloudFile(root, "atalho-fora", "novo.txt", new TextEncoder().encode("x"), fs)).rejects.toThrow(/link/i);
    expect(readdirSync(outside)).toEqual(["segredo.txt"]);
  });

  it("lê arquivo de dentro; pasta, arquivo inexistente e só na nuvem dão erro legível", async () => {
    expect(new TextDecoder().decode(await readCloudFile(root, "Proposta.pdf", fs))).toBe("12345");
    expect(new TextDecoder().decode(await readCloudFile(root, ["Contratos", "Assinado.pdf"], fs))).toBe("%PDF-1");
    await expect(readCloudFile(root, "Contratos", fs)).rejects.toThrow(/não é um arquivo/);
    await expect(readCloudFile(root, "Nada.pdf", fs)).rejects.toThrow(/não encontrad/);
    await expect(listCloudFolder(tmp.at("Sumiu"), "", fs)).rejects.toThrow(/não encontrad/);
  });

  it("pela tela, só quem vê a pasta lista e abre, e só quem tem attach em documents envia", async () => {
    const folder = { id: "nuvem-1", company_id: "c", provider: "icloud", label: "Empresa", local_path: root, created_by: "test-user-comercial", created_at: "", updated_at: "" } as CloudFolder;
    const bytes = new TextEncoder().encode("x");
    const comercial = { role: "comercial" as Role, userId: "test-user-comercial" };
    expect((await browseCloudFolder(comercial, folder, "", fs)).map((entry) => entry.name)).toContain("Proposta.pdf");
    expect(new TextDecoder().decode(await openCloudFile(comercial, folder, "Proposta.pdf", fs))).toBe("12345");
    expect(await sendToCloudFolder(comercial, folder, "", "Novo.txt", bytes, { fs })).toBe("Novo.txt");

    const rh = { role: "rh" as Role, userId: "test-user-rh" };
    await expect(browseCloudFolder(rh, folder, "", fs)).rejects.toThrow(/acesso/);
    await expect(openCloudFile(rh, folder, "Proposta.pdf", fs)).rejects.toThrow(/acesso/);
    await expect(sendToCloudFolder(rh, folder, "", "x.txt", bytes, { fs })).rejects.toThrow(/permissão/);
    // Auditoria vê todas as pastas, mas não envia arquivo.
    const auditor = { role: "auditor" as Role, userId: "test-user-auditor" };
    expect((await browseCloudFolder(auditor, folder, "", fs)).length).toBeGreaterThan(0);
    await expect(sendToCloudFolder(auditor, folder, "", "x.txt", bytes, { fs })).rejects.toThrow(/permissão/);
    expect(readdirSync(root)).not.toContain("x.txt");
  });

  it("envia sem sobrescrever: nome repetido ganha (2), nome com caminho fica só com o nome", async () => {
    const bytes = new TextEncoder().encode("nova versão");
    expect(await writeCloudFile(root, "Contratos", "Assinado.pdf", bytes, fs)).toBe("Assinado (2).pdf");
    expect(await writeCloudFile(root, "Contratos", "Assinado.pdf", bytes, fs)).toBe("Assinado (3).pdf");
    expect(readFileSync(path.join(root, "Contratos", "Assinado.pdf"), "utf8")).toBe("%PDF-1");
    expect(readFileSync(path.join(root, "Contratos", "Assinado (2).pdf"), "utf8")).toBe("nova versão");
    expect(await writeCloudFile(root, "", "../../fora.txt", bytes, fs)).toBe("fora.txt");
    expect(readFileSync(path.join(root, "fora.txt"), "utf8")).toBe("nova versão");
  });
});

describe("cadastro das pastas conectadas (SQLite real)", () => {
  const C = "test-company";
  let db: TestDb;
  const actor = (role: Role) => ({ role, userId: `test-user-${role}` });

  beforeEach(async () => {
    db = await createTestDb();
    await insertTestCompany(db, { roles: ["ceo", "gerente", "comercial", "rh", "auditor"] });
  });

  afterEach(() => db.close());

  it("conecta com serviço e nome sugeridos, recusa a mesma pasta duas vezes e papel sem permissão", async () => {
    const folder = await connectCloudFolder(db, C, actor("comercial"), { localPath: `${ICLOUD}/`, home: HOME });
    expect(folder).toMatchObject({ company_id: C, provider: "icloud", label: "iCloud Drive", local_path: ICLOUD, created_by: "test-user-comercial" });
    expect((await listCloudFolders(db, C)).map((row) => row.id)).toEqual([folder.id]);

    await expect(connectCloudFolder(db, C, actor("ceo"), { localPath: ICLOUD, home: HOME })).rejects.toThrow(/já está conectada/);
    await expect(connectCloudFolder(db, C, actor("auditor"), { localPath: `${HOME}/Dropbox`, home: HOME })).rejects.toThrow(/permissão/);
    await expect(connectCloudFolder(db, C, actor("ceo"), { localPath: "Dropbox", home: HOME })).rejects.toBeInstanceOf(CloudFolderError);
    const named = await connectCloudFolder(db, C, actor("ceo"), { localPath: `${HOME}/Projetos`, label: "  Projetos da empresa  ", provider: "outro" });
    expect(named).toMatchObject({ provider: "outro", label: "Projetos da empresa" });
  });

  it("quem conectou e quem vê todas as pastas enxergam; os demais setores, não", async () => {
    const folder = (await connectCloudFolder(db, C, actor("comercial"), { localPath: ICLOUD, home: HOME })) as CloudFolder;
    const sees = (role: Role) => canSeeCloudFolder(role, `test-user-${role}`, folder);
    expect(["comercial", "ceo", "admin", "gerente", "auditor"].map((role) => sees(role as Role))).toEqual([true, true, true, true, true]);
    expect(sees("rh")).toBe(false);
    expect(canManageCloudFolder("comercial", "test-user-comercial", folder)).toBe(true);
    expect(canManageCloudFolder("gerente", "test-user-gerente", folder)).toBe(true);
    expect(canManageCloudFolder("auditor", "test-user-auditor", folder)).toBe(false);
    expect(canManageCloudFolder("rh", "test-user-rh", folder)).toBe(false);
  });

  it("renomeia e troca a pasta só quem pode; desconectar não apaga nada do disco e libera reconectar", async () => {
    const folder = await connectCloudFolder(db, C, actor("comercial"), { localPath: ICLOUD, home: HOME });
    const other = await connectCloudFolder(db, C, actor("comercial"), { localPath: `${HOME}/Dropbox`, home: HOME });
    await updateCloudFolder(db, C, actor("comercial"), folder.id, { label: "Contratos no iCloud" });
    await expect(updateCloudFolder(db, C, actor("rh"), folder.id, { label: "x" })).rejects.toThrow(/permissão/);
    await expect(updateCloudFolder(db, C, actor("comercial"), folder.id, { label: "   " })).rejects.toThrow(/nome/i);
    await expect(updateCloudFolder(db, C, actor("comercial"), folder.id, { local_path: `${HOME}/Dropbox/` })).rejects.toThrow(/já está conectada/);
    await expect(updateCloudFolder(db, C, actor("comercial"), folder.id, { local_path: "../x" })).rejects.toBeInstanceOf(CloudFolderError);
    await updateCloudFolder(db, C, actor("gerente"), folder.id, { local_path: `${ICLOUD}/Empresa`, provider: "icloud" });
    const [saved] = (await listCloudFolders(db, C)).filter((row) => row.id === folder.id);
    expect(saved).toMatchObject({ label: "Contratos no iCloud", local_path: `${ICLOUD}/Empresa` });

    await expect(disconnectCloudFolder(db, C, actor("rh"), other.id)).rejects.toThrow(/permissão/);
    await disconnectCloudFolder(db, C, actor("comercial"), other.id);
    expect((await listCloudFolders(db, C)).map((row) => row.id)).toEqual([folder.id]);
    const again = await connectCloudFolder(db, C, actor("comercial"), { localPath: `${HOME}/Dropbox`, home: HOME });
    expect(again.id).not.toBe(other.id);
    // Pasta de outra empresa não é encontrada.
    await expect(disconnectCloudFolder(db, "outra-empresa", actor("ceo"), folder.id)).rejects.toThrow(/não encontrada/);
  });
});
