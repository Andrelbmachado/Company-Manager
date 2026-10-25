// O seed de prospecção cria o projeto "Desenvolvimento de Site" na primeira sessão: o Dashboard já aberto tem de contar
// esse projeto em "Projetos ativos" sem precisar recarregar a tela.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/types";

const seed = vi.hoisted(() => ({ ensureSiteProspectingSeed: vi.fn<(session: Session) => Promise<boolean>>() }));
vi.mock("@/lib/prospecting/seed", () => seed);

const session = {
  user: { id: "u1", name: "CEO", email: "ceo@empresa.local" },
  company: { id: "c1", name: "Empresa" },
  membership: { id: "m1", role: "ceo" },
} as unknown as Session;
vi.mock("./useSession", () => ({ useRequiredSession: () => session }));

const { useProspectingBootstrap } = await import("./useProspectingBootstrap");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let client: QueryClient;

function Probe() {
  useProspectingBootstrap();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  client = new QueryClient();
  root = createRoot(document.createElement("div"));
  seed.ensureSiteProspectingSeed.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
});

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([filters]) => (filters as { queryKey: unknown[] }).queryKey[0]);

describe("useProspectingBootstrap", () => {
  it("depois de importar o seed, atualiza os números do Dashboard (projetos ativos) e as listas", async () => {
    seed.ensureSiteProspectingSeed.mockResolvedValue(true);
    const spy = vi.spyOn(client, "invalidateQueries");
    await mount();

    expect(seed.ensureSiteProspectingSeed).toHaveBeenCalledWith(session);
    const keys = invalidatedKeys(spy);
    expect(keys).toContain("dashboard-kpis");
    expect(keys).toContain("projects");
    expect(keys).toContain("leads");
  });

  it("seed já importado: não invalida nada", async () => {
    seed.ensureSiteProspectingSeed.mockResolvedValue(false);
    const spy = vi.spyOn(client, "invalidateQueries");
    await mount();

    expect(seed.ensureSiteProspectingSeed).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});
