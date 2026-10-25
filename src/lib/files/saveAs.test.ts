// @vitest-environment jsdom
// "Salvar como" único do app (documentos, PDF da proposta, exportações e relatórios): diálogo nativo no desktop,
// download no navegador.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauriRuntime: vi.fn(), save: vi.fn(), writeFile: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isTauriRuntime: mocks.isTauriRuntime, getDb: async () => ({}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: mocks.writeFile }));

import { saveBlobAs } from "./saveAs";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("saveBlobAs", () => {
  it("no app: diálogo Salvar com nome, título e filtro; grava os bytes no caminho escolhido e devolve o caminho", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.save.mockResolvedValue("/Users/x/Documents/proposta.pdf");
    const path = await saveBlobAs(new Blob(["%PDF-1.4"], { type: "application/pdf" }), "proposta.pdf", { title: "Salvar proposta", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    expect(path).toBe("/Users/x/Documents/proposta.pdf");
    expect(mocks.save).toHaveBeenCalledWith({ title: "Salvar proposta", defaultPath: "proposta.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    const [target, bytes] = mocks.writeFile.mock.calls[0];
    expect(target).toBe("/Users/x/Documents/proposta.pdf");
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("%PDF-1.4");
  });

  it("no app: cancelar o diálogo não grava nada e devolve null", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.save.mockResolvedValue(null);
    expect(await saveBlobAs(new Blob(["a"]), "a.csv")).toBeNull();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("no navegador: baixa com o nome sugerido e devolve o nome", async () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const clicks: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    try {
      expect(await saveBlobAs(new Blob(["a"]), "clientes.xlsx")).toBe("clientes.xlsx");
      expect(clicks).toEqual(["clientes.xlsx"]);
      expect(document.querySelectorAll("a")).toHaveLength(0);
      expect(mocks.save).not.toHaveBeenCalled();
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  });
});
