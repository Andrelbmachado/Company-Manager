// Substituto de "@/lib/db/client" nos testes: getDb() devolve o banco SQLite de teste do momento.
// Uso, no arquivo de teste:
//   vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
//   const testDb = useTestDb();            // banco novo (migrations aplicadas) a cada teste
//   it("...", async () => { const db = testDb(); ... });
import { afterEach, beforeEach } from "vitest";
import { createTestDb, type CreateTestDbOptions, type TestDb } from "./sqlite";

let current: TestDb | null = null;

function requireCurrent(): TestDb {
  if (!current) throw new Error("Banco de teste não iniciado: chame useTestDb() no topo do arquivo de teste.");
  return current;
}

/** Mesmo contrato de lib/db/client.ts. */
export async function getDb(): Promise<TestDb> {
  return requireCurrent();
}

/** Nos testes o código segue o caminho do app desktop (SQLite real), não o do banco demo. */
export function isTauriRuntime(): boolean {
  return true;
}

/** Cria um banco novo antes de cada teste e fecha depois. Devolve uma função que lê o banco do teste atual. */
export function useTestDb(options: CreateTestDbOptions = {}): () => TestDb {
  beforeEach(async () => {
    current?.close();
    current = await createTestDb(options);
  });
  afterEach(() => {
    current?.close();
    current = null;
  });
  return requireCurrent;
}
