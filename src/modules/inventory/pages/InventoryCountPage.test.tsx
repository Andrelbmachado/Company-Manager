// /inventory/inventarios/nova: só quem tem `create` em inventory abre contagem (a rota só exige `view`).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { Role, Session } from "@/types";
import InventoryCountPage from "./InventoryCountPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function sessionFor(role: Role, companyId: string): Session {
  return {
    user: { id: `test-user-${role}`, name: `Teste ${role}`, email: `${role}@teste.local` },
    membership: { id: `test-member-${companyId}-${role}`, company_id: companyId, user_id: `test-user-${role}`, role, scope: "setor" },
    company: { id: companyId, name: "Empresa de Teste" },
  } as unknown as Session;
}

async function openAs(role: Role) {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { roles: [role] });
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-1', ?, 'Depósito')", [companyId]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={{ session: sessionFor(role, companyId), setSession: () => undefined }}>
          <MemoryRouter initialEntries={["/inventory/inventarios/nova"]}>
            <Routes>
              <Route path="/inventory/inventarios/:id" element={<InventoryCountPage />} />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    if (container.querySelector("h1")) break;
  }
}

const openButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Abrir contagem"));

describe("InventoryCountPage em /inventory/inventarios/nova", () => {
  it.each<Role>(["gerente", "auditor", "tecnico"])("%s (só consulta o estoque) não vê o formulário de abrir contagem", async (role) => {
    await openAs(role);
    expect(container.querySelector("h1")?.textContent).toBe("Nova contagem de inventário");
    expect(openButton()).toBeUndefined();
    expect(container.querySelector("#new-count-location")).toBeNull();
    expect(container.textContent).toContain("não abre contagem");
  });

  it("estoquista abre a contagem no local escolhido", async () => {
    await openAs("estoquista");
    expect(openButton()).toBeDefined();
    expect(container.querySelector("#new-count-location")).not.toBeNull();
  });
});
