// @vitest-environment jsdom
// Confirmação de ação irreversível: diálogo nativo (ask) no desktop, porque o window.confirm do WebView do Tauri não
// espera a resposta e a exclusão acontecia sem perguntar; window.confirm no navegador.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauriRuntime: vi.fn(), ask: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isTauriRuntime: mocks.isTauriRuntime, getDb: async () => ({}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));

import { confirmAction } from "./confirm";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("confirmAction", () => {
  it("no app: pergunta pelo diálogo nativo e devolve a resposta, sem window.confirm", async () => {
    mocks.isTauriRuntime.mockReturnValue(true);
    const native = vi.spyOn(window, "confirm");
    mocks.ask.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await confirmAction('Remover "Papel A4" do estoque?', { title: "Remover item", okLabel: "Remover" })).toBe(false);
    expect(await confirmAction("Arquivar o local?")).toBe(true);
    expect(mocks.ask).toHaveBeenNthCalledWith(1, 'Remover "Papel A4" do estoque?', { title: "Remover item", kind: "warning", okLabel: "Remover", cancelLabel: "Cancelar" });
    expect(mocks.ask).toHaveBeenNthCalledWith(2, "Arquivar o local?", { title: "Confirmar", kind: "warning", cancelLabel: "Cancelar" });
    expect(native).not.toHaveBeenCalled();
  });

  it("no navegador: window.confirm", async () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    const native = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(await confirmAction("Cancelar a contagem?")).toBe(true);
    expect(native).toHaveBeenCalledWith("Cancelar a contagem?");
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
