// Meu RH: o exemplo do modo demonstração é opcional; se ele falhar, o cadastro da pessoa abre assim mesmo.
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { setCompanySetting } from "@/lib/settings/companySettings";
import type { Session } from "@/types";
import { ensureMyEmployee } from "./queries";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/dev/seeds/myHr", () => ({ seedMyHrDemo: async () => { throw new Error("banco travado"); } }));

const testDb = useTestDb();
const C = "test-company";

describe("ensureMyEmployee", () => {
  it("devolve o cadastro mesmo quando o exemplo do modo demonstração falha", async () => {
    const db = testDb();
    const { userIds } = await insertTestCompany(db, { companyId: C, roles: ["comercial"] });
    await setCompanySetting(db, C, "demo_mode", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = {
      user: { id: userIds.comercial, name: "Comercial", email: "comercial@teste.local" },
      membership: { id: "m", company_id: C, user_id: userIds.comercial, role: "comercial", scope: "setor" },
      company: { id: C, name: "Empresa de Teste" },
    } as unknown as Session;

    const me = await ensureMyEmployee(session);

    expect(me.user_id).toBe(userIds.comercial);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
