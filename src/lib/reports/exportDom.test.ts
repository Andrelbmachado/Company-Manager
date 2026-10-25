// @vitest-environment jsdom
// Impressão (PDF pelo diálogo de impressão do sistema) e gravação do arquivo: diálogo nativo no app, download no navegador.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportTable } from "./common";

const mocks = vi.hoisted(() => ({ isTauriRuntime: vi.fn(), save: vi.fn(), writeFile: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isTauriRuntime: mocks.isTauriRuntime, getDb: async () => ({}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: mocks.writeFile }));

import { exportReport, printReport, saveReportFile } from "./export";

const TABLE: ReportTable = {
  title: "Giro de estoque",
  columns: [
    { key: "name", label: "Item", kind: "text" },
    { key: "value", label: "Valor (R$)", kind: "money" },
  ],
  rows: [{ name: "Cabo", value: 550 }],
  fileName: "giro-de-estoque-2026-09-21-a-2026-10-20",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  document.body.innerHTML = "<main id='app'>tela</main>";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("impressão", () => {
  it("monta só o relatório para a impressão e chama o diálogo do sistema", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await printReport(TABLE, { company: "Empresa" });
    expect(print).toHaveBeenCalledTimes(1);
    const root = document.getElementById("cm-print-root");
    expect(root?.innerHTML).toContain("Giro de estoque");
    expect(document.getElementById("cm-print-style")?.textContent).toContain("@media print");
    expect(document.getElementById("app")).not.toBeNull();

    await printReport({ ...TABLE, title: "Outro" });
    expect(document.querySelectorAll("#cm-print-root")).toHaveLength(1);
    expect(document.getElementById("cm-print-root")?.innerHTML).toContain("Outro");
  });

  it("erro do diálogo de impressão (app sem permissão) vira mensagem clara", async () => {
    vi.stubGlobal("print", () => Promise.reject(new Error("webview.print not allowed")));
    await expect(printReport(TABLE)).rejects.toThrow(/impressão/);
  });
});

describe("gravação do arquivo", () => {
  it("no app: diálogo Salvar com o nome sugerido e grava os bytes no caminho escolhido", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.save.mockResolvedValue("/Users/x/Documents/giro.csv");
    const path = await saveReportFile(`${TABLE.fileName}.csv`, "a;b\r\n", "csv");
    expect(path).toBe("/Users/x/Documents/giro.csv");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "giro-de-estoque-2026-09-21-a-2026-10-20.csv", filters: [expect.objectContaining({ extensions: ["csv"] })] }));
    const [writtenPath, bytes] = mocks.writeFile.mock.calls[0];
    expect(writtenPath).toBe("/Users/x/Documents/giro.csv");
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("a;b\r\n");
  });

  it("no app: cancelar o diálogo não grava nada", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.save.mockResolvedValue(null);
    expect(await saveReportFile("x.csv", "a", "csv")).toBeNull();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("no navegador: baixa o arquivo", async () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    const createObjectURL = vi.fn(() => "blob:relatorio");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicks: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    try {
      const name = await saveReportFile("relatorio.csv", "a;b", "csv");
      expect(name).toBe("relatorio.csv");
      expect(clicks).toEqual(["relatorio.csv"]);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(mocks.save).not.toHaveBeenCalled();
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  });

  it("exportReport escolhe o formato: CSV e XLSX gravam arquivo; PDF abre a impressão", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.save.mockImplementation(async (options: { defaultPath: string }) => `/tmp/${options.defaultPath}`);
    const print = vi.fn();
    vi.stubGlobal("print", print);

    expect(await exportReport(TABLE, "csv")).toBe(`/tmp/${TABLE.fileName}.csv`);
    expect(await exportReport(TABLE, "xlsx")).toBe(`/tmp/${TABLE.fileName}.xlsx`);
    const xlsxBytes = mocks.writeFile.mock.calls[1][1] as Uint8Array;
    expect(String.fromCharCode(xlsxBytes[0], xlsxBytes[1])).toBe("PK");
    expect(await exportReport(TABLE, "pdf")).toBeNull();
    expect(print).toHaveBeenCalledTimes(1);
  });
});
