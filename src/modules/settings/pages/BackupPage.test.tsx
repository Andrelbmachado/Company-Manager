// Tela de backup: lista, backup manual, restauração (confirmar → restaurar → reiniciar) e erro sem reiniciar.
// Os comandos Tauri e os diálogos nativos são simulados; a lógica de arquivo é testada em Rust (src-tauri/src/backup.rs).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import type { Role, Session } from "@/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauriRuntime: vi.fn(),
  ask: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/Users/x/Library/Application Support/com.company.manager", join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask, save: mocks.save, open: mocks.open }));
vi.mock("@tauri-apps/plugin-fs", () => ({ remove: mocks.remove }));
vi.mock("@/lib/events/bus", () => ({ emit: mocks.emit }));
vi.mock("@/lib/db/client", () => ({ isTauriRuntime: mocks.isTauriRuntime, getDb: async () => ({}) }));

import BackupPage from "./BackupPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIR = "/Users/x/Library/Application Support/com.company.manager/backups";
const entry = (file: string, kind: string, created: Date) => ({
  path: `${DIR}/${file}`,
  file_name: file,
  size_bytes: 3 * 1024 * 1024,
  created_at: created.toISOString(),
  schema_version: 11,
  automatic: kind === "automatico",
  kind,
  files_count: 2,
});
const LIST = [entry("company-manager-20261024-090000-automatico.cmbackup", "automatico", new Date(2026, 9, 24, 9)), entry("company-manager-20261020-180000-manual.cmbackup", "manual", new Date(2026, 9, 20, 18))];

let root: Root | null = null;
let container: HTMLDivElement;

function session(role: Role): Session {
  const stamp = "2026-01-01T00:00:00.000Z";
  return {
    user: { id: "u-1", name: "Pessoa", email: "ceo@teste.local", status: "active", locale: "pt-BR", created_at: stamp, updated_at: stamp },
    membership: { id: "m-1", company_id: "c-1", user_id: "u-1", role, scope: "empresa", created_at: stamp, updated_at: stamp },
    company: { id: "c-1", name: "Empresa", settings_json: "{}", created_at: stamp, updated_at: stamp },
  } as Session;
}

async function render(role: Role = "ceo") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={{ session: session(role), setSession: () => undefined }}>
          <BackupPage />
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
}

async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}\n${container.textContent}`);
}

const text = () => container.textContent ?? "";
function button(label: string | RegExp): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((element) => (typeof label === "string" ? (element.getAttribute("aria-label") ?? element.textContent ?? "").includes(label) : label.test(element.getAttribute("aria-label") ?? element.textContent ?? "")));
  if (!found) throw new Error(`botão ${label} não encontrado`);
  return found;
}
async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.isTauriRuntime.mockReturnValue(true);
  mocks.emit.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "list_backups") return LIST;
    if (command === "backup_db") return entry("company-manager-20261024-100000-manual.cmbackup", "manual", new Date(2026, 9, 24, 10));
    if (command === "restore_db") return { restored_from: LIST[1].path, safety_backup: entry("x-antes.cmbackup", "antes_da_restauracao", new Date()), schema_version: 11, restart_required: true };
    return undefined;
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("BackupPage", () => {
  it("no navegador explica que é só no app desktop", async () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    await render();
    expect(text()).toContain("Disponível no app desktop");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("lista os backups com tipo, tamanho e a pasta onde ficam", async () => {
    await render();
    await until(() => text().includes("Backups guardados (2)"), "lista");
    expect(text()).toContain("Automático (diário)");
    expect(text()).toContain("Manual");
    expect(text()).toContain("3 MB");
    expect(text()).toContain(DIR);
    // Cards do topo: só título e número/data, nada de texto embaixo.
    const cards = [...document.querySelectorAll(".kpi-card")];
    expect(cards.length).toBe(3);
    for (const card of cards) expect(card.querySelectorAll("p").length).toBeLessThanOrEqual(2);
  });

  it("ordena pelo cabeçalho (Data pela cronologia) e filtra o Tipo pelo rótulo", async () => {
    await render();
    await until(() => text().includes("Backups guardados (2)"), "lista");
    const kinds = () => [...container.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[1]?.textContent);
    expect(kinds()).toEqual(["Automático (diário)", "Manual"]);
    await click(container.querySelector<HTMLElement>("th [data-sort-key='created_at']")!);
    expect(kinds()).toEqual(["Manual", "Automático (diário)"]);
    await click(button("Filtrar"));
    const manual = [...container.querySelectorAll("[data-filter-bar] label")].find((label) => label.textContent === "Manual")!;
    await click(manual.querySelector("input")!);
    expect(kinds()).toEqual(["Manual"]);
  });

  it("faz backup agora e registra no histórico", async () => {
    await render();
    await until(() => text().includes("Backups guardados (2)"), "lista");
    await click(button("Fazer backup agora"));
    await until(() => text().includes("Backup feito"), "aviso de sucesso");
    expect(mocks.invoke).toHaveBeenCalledWith("backup_db", { destPath: null, automatic: false });
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.created", companyId: "c-1", actorId: "u-1" }));
  });

  it("restaurar pede confirmação, restaura e reinicia o app", async () => {
    mocks.ask.mockResolvedValue(true);
    await render();
    await until(() => text().includes("Backups guardados (2)"), "lista");
    await click(button(/Restaurar o backup de 20\/10\/2026/));
    await until(() => mocks.invoke.mock.calls.some(([command]) => command === "restart_app"), "reinício");
    expect(mocks.ask).toHaveBeenCalledWith(expect.stringContaining("substituídos"), expect.objectContaining({ kind: "warning" }));
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.indexOf("restore_db")).toBeLessThan(commands.indexOf("restart_app"));
    expect(mocks.invoke).toHaveBeenCalledWith("restore_db", { srcPath: LIST[1].path });
  });

  it("cancelar a confirmação não restaura; erro do app aparece e o app não reinicia", async () => {
    mocks.ask.mockResolvedValueOnce(false);
    await render();
    await until(() => text().includes("Backups guardados (2)"), "lista");
    await click(button(/Restaurar o backup de 20\/10\/2026/));
    await until(() => mocks.ask.mock.calls.length === 1, "confirmação");
    expect(mocks.invoke).not.toHaveBeenCalledWith("restore_db", expect.anything());

    mocks.ask.mockResolvedValueOnce(true);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_backups") return LIST;
      if (command === "restore_db") throw "Este backup é de uma versão mais nova do Company Manager (banco na versão 12; este app vai até a 11). Atualize o app antes de restaurar.";
      return undefined;
    });
    await click(button(/Restaurar o backup de 20\/10\/2026/));
    await until(() => container.querySelector("[role=alert]") !== null, "erro");
    expect(container.querySelector("[role=alert]")?.textContent).toContain("versão mais nova");
    expect(mocks.invoke).not.toHaveBeenCalledWith("restart_app");
  });

  it("restaura de um arquivo escolhido e exclui backup guardado", async () => {
    mocks.ask.mockResolvedValue(true);
    mocks.open.mockResolvedValueOnce("/Users/x/Downloads/copia.cmbackup");
    await render();
    await until(() => text().includes("Backups guardados (2)"), "lista");
    await click(button("Restaurar de um arquivo"));
    await until(() => mocks.invoke.mock.calls.some(([command]) => command === "restart_app"), "reinício");
    expect(mocks.invoke).toHaveBeenCalledWith("restore_db", { srcPath: "/Users/x/Downloads/copia.cmbackup" });

    await click(button(/Excluir o backup de 24\/10\/2026/));
    await until(() => mocks.remove.mock.calls.length === 1, "exclusão");
    expect(mocks.remove).toHaveBeenCalledWith(LIST[0].path);
  });
});
