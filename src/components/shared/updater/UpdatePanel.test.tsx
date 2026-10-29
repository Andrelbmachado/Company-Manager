import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdater, type InstallEvent, type UpdaterBackend } from "@/lib/updater/updater";
import { UpdateBanner, UpdatePanel } from "./UpdatePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
});

async function mount(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

const text = () => container?.textContent ?? "";
const button = (name: string) => [...(container?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === name) ?? null;

function setup(availableVersion: string | null, install?: UpdaterBackend["install"]) {
  let finish: () => void = () => undefined;
  const backend: UpdaterBackend = {
    check: vi.fn(async () => ({ currentVersion: "0.1.0", availableVersion, notes: null, date: null })),
    install: install ?? vi.fn((onEvent: (event: InstallEvent) => void) => {
      onEvent({ event: "started", data: { contentLength: 200 } });
      onEvent({ event: "progress", data: { chunkLength: 50 } });
      return new Promise<void>((resolve) => { finish = resolve; });
    }),
    restart: vi.fn(async () => undefined),
  };
  return { backend, updater: createUpdater(backend, { storage: null, restartDelayMs: 0 }), finish: () => finish() };
}

describe("UpdatePanel", () => {
  it("sem versão nova: mostra Atualizado, a versão instalada e nenhum botão Atualizar", async () => {
    const { updater } = setup(null);
    await mount(<UpdatePanel updater={updater} />);
    await act(() => updater.check());
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Atualizado");
    expect(text()).toContain("Instalada: 0.1.0");
    expect(button("Atualizar")).toBeNull();
  });

  it("versão nova: mostra as duas versões; Atualizar baixa com porcentagem, instala e reinicia", async () => {
    const { updater, backend, finish } = setup("0.2.0");
    await mount(<UpdatePanel updater={updater} />);
    await act(() => updater.check());
    expect(text()).toContain("Disponível: 0.2.0");
    expect(button("Atualizar")?.disabled).toBe(false);
    expect(backend.install).not.toHaveBeenCalled();

    await act(async () => button("Atualizar")!.click());
    expect(text()).toContain("Baixando 25%");
    expect(container!.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
    await act(async () => {
      finish();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(backend.restart).toHaveBeenCalledTimes(1);
  });

  it("erro: mostra a mensagem e Tentar novamente", async () => {
    const { updater } = setup("0.2.0", vi.fn(async () => { throw new Error("Invalid signature"); }));
    await mount(<UpdatePanel updater={updater} />);
    await act(() => updater.check());
    await act(() => updater.install());
    expect(text()).toContain("A atualização falhou");
    expect(text()).toContain("integridade");
    expect(button("Tentar novamente")).not.toBeNull();
  });
});

describe("UpdateBanner", () => {
  it("fica escondido enquanto não há versão nova e aparece quando há", async () => {
    const { updater } = setup("0.2.0");
    await mount(<MemoryRouter initialEntries={["/"]}><UpdateBanner updater={updater} /></MemoryRouter>);
    expect(text()).toBe("");
    await act(() => updater.check());
    expect(button("Atualizar")).not.toBeNull();
  });
});
