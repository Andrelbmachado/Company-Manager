// Telas de fora da casca (login, setup, troca de senha obrigatória) rolam no próprio contêiner: html, body e #root
// não rolam (globals.css), então sem ele o formulário ficava cortado numa janela baixa.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { AppRoutes } from "../routes";
import { ScrollScreen } from "./ScrollScreen";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
}

const classes = (element: Element | null) => element?.getAttribute("class")?.split(/\s+/) ?? [];

describe("ScrollScreen", () => {
  it("ocupa a altura da janela e rola sozinho, sem passar a rolagem para a janela", async () => {
    await render(<ScrollScreen><p>conteúdo</p></ScrollScreen>);
    const screen = container!.querySelector("[data-scroll-screen]");
    expect(classes(screen)).toEqual(expect.arrayContaining(["h-full", "overflow-y-auto", "overscroll-contain"]));
    expect(screen?.textContent).toBe("conteúdo");
  });

  it("sem sessão, o login e o setup ficam dentro do contêiner que rola", async () => {
    await render(
      <SessionContext.Provider value={{ session: null, setSession: () => {} }}>
        <MemoryRouter initialEntries={["/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </MemoryRouter>
      </SessionContext.Provider>,
    );
    const screen = container!.querySelector("[data-scroll-screen]");
    expect(screen).not.toBeNull();
    expect(screen?.parentElement).toBe(container);
  });
});
