import { describe, expect, it, vi } from "vitest";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { useTestDb } from "@/test/mockDb";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();

describe("useTestDb + vi.mock(\"@/lib/db/client\")", () => {
  it("getDb() devolve o banco de teste e isTauriRuntime() é true", async () => {
    expect(isTauriRuntime()).toBe(true);
    const db = await getDb();
    expect(db).toBe(testDb());
    await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", ["c1", "Empresa"]);
    const rows = await testDb().select<{ id: string }[]>("SELECT id FROM companies");
    expect(rows).toEqual([{ id: "c1" }]);
  });

  it("zera o banco entre os testes", async () => {
    const db = await getDb();
    const [row] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM companies");
    expect(row.n).toBe(0);
  });
});
