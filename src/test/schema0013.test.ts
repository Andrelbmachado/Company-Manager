// Migration 0013 no SQLite real: id da sessão do Claude Code local em cada conversa do assistente (--resume).
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

describe("migration 0013 (sessão do Claude Code na conversa)", () => {
  it("assistant_conversations ganha claude_session_id; conversas antigas ficam sem sessão", async () => {
    db = await createTestDb({ upTo: 12 });
    const { companyId } = await insertTestCompany(db, { roles: ["comercial"] });
    await db.execute(
      "INSERT INTO assistant_conversations (id, company_id, user_id, title) VALUES ('conversa-antiga', ?, 'test-user-comercial', 'Antes da 0013')",
      [companyId],
    );
    await db.migrate();
    expect(db.appliedVersions).toContain(13);
    const columns = (await db.select<{ name: string }[]>("PRAGMA table_info(assistant_conversations)")).map((row) => row.name);
    expect(columns).toContain("claude_session_id");
    const [row] = await db.select<{ title: string; claude_session_id: string | null }[]>(
      "SELECT title, claude_session_id FROM assistant_conversations WHERE id='conversa-antiga'",
    );
    expect(row).toEqual({ title: "Antes da 0013", claude_session_id: null });
  });
});
