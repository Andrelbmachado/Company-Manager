// Configurações > Assistente IA: status do Claude Code local e escolha do provedor (automático, Claude Code ou API).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { getAssistantMode } from "@/lib/assistant/provider";
import { AssistantModeSettings } from "./AssistantModeSettings";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const testDb = useTestDb();
const COMPANY = "test-company";
const ME = "test-user-comercial";
let page: RenderedPage | null = null;

beforeEach(async () => {
  localStorage.clear();
  await insertTestCompany(testDb(), { companyId: COMPANY, roles: ["comercial"] });
});

afterEach(() => {
  page?.unmount();
  page = null;
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  tauri.invoke.mockReset();
});

async function open(): Promise<RenderedPage> {
  page = await renderPage(<AssistantModeSettings />, { companyId: COMPANY, role: "comercial", path: "/settings" });
  return page;
}

const modeSelect = () => document.querySelector<HTMLSelectElement>("select[aria-label='Assistente usado']");

describe("AssistantModeSettings", () => {
  it("mostra o Claude Code conectado com a versão e guarda a escolha da pessoa", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauri.invoke.mockResolvedValue({ available: true, path: "/opt/homebrew/bin/claude", version: "2.1.310", logged_in: true, reason: null });
    await open();
    await until(() => page!.text().includes("Claude Code conectado"), "status conectado");
    expect(page!.text()).toContain("2.1.310");
    expect(page!.text()).toMatch(/Em uso: Claude Code/);
    expect(modeSelect()?.value).toBe("auto");

    await choose(modeSelect(), "api");
    expect(getAssistantMode(ME)).toBe("api");
    await until(() => /Em uso: nenhum/.test(page!.text()), "sem chave de API, nada em uso");
  });

  it("sem o Claude Code mostra o motivo e verifica de novo no botão", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauri.invoke.mockResolvedValue({ available: false, path: null, version: null, logged_in: null, reason: "O Claude Code não foi encontrado neste Mac." });
    await open();
    await until(() => page!.text().includes("O Claude Code não foi encontrado neste Mac."), "motivo");
    expect(page!.text()).toContain("Claude Code não conectado");
    expect(tauri.invoke).toHaveBeenCalledTimes(1);

    tauri.invoke.mockResolvedValue({ available: true, path: "/Users/x/.local/bin/claude", version: "2.2.0", logged_in: true, reason: null });
    await click(page!.button("Verificar o Claude Code de novo"));
    await until(() => page!.text().includes("Claude Code conectado"), "conectado depois de verificar");
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
  });

  it("no navegador explica que é só no app desktop", async () => {
    await open();
    await until(() => page!.text().includes("app desktop"), "aviso do navegador");
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
