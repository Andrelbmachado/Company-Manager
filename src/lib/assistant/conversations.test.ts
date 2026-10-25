// Histórico de conversas do Assistente de IA (tabelas assistant_conversations e assistant_messages, migration 0012).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import {
  DEFAULT_CONVERSATION_TITLE,
  appendMessage,
  conversationTitle,
  createConversation,
  getConversation,
  getMessages,
  listConversations,
} from "./conversations";

let db: TestDb;
let companyId: string;
let me: string;
let colleague: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["comercial", "financeiro"] }));
  me = "test-user-comercial";
  colleague = "test-user-financeiro";
});

afterEach(() => db.close());

describe("conversas do assistente", () => {
  it("cria a conversa, grava as mensagens em ordem e lista a mais recente primeiro, só do próprio usuário", async () => {
    const older = await createConversation(db, companyId, me, "Contas da semana");
    const newer = await createConversation(db, companyId, me);
    const other = await createConversation(db, companyId, colleague, "Conversa de outra pessoa");

    await appendMessage(db, older, "user", "Quais contas vencem hoje?");
    await appendMessage(db, older, "assistant", "Duas contas vencem hoje.");

    const messages = await getMessages(db, older);
    expect(messages.map((message) => [message.author, message.text])).toEqual([
      ["user", "Quais contas vencem hoje?"],
      ["assistant", "Duas contas vencem hoje."],
    ]);
    expect(messages.every((message) => message.conversation_id === older)).toBe(true);

    const mine = await listConversations(db, companyId, me);
    expect(mine.map((conversation) => conversation.id)).toEqual([older, newer]);
    expect(mine.map((conversation) => conversation.title)).toEqual(["Contas da semana", DEFAULT_CONVERSATION_TITLE]);
    expect(mine.some((conversation) => conversation.id === other)).toBe(false);
    expect((await listConversations(db, companyId, colleague)).map((conversation) => conversation.id)).toEqual([other]);
  });

  it("não mostra conversa de outra empresa nem excluída, e não abre conversa alheia", async () => {
    await insertTestCompany(db, { companyId: "outra-empresa", roles: ["comercial"] });
    const elsewhere = await createConversation(db, "outra-empresa", me, "Na outra empresa");
    const removed = await createConversation(db, companyId, me, "Excluída");
    await db.execute("UPDATE assistant_conversations SET deleted_at=datetime('now') WHERE id=?", [removed]);
    const kept = await createConversation(db, companyId, me, "Fica");
    const foreign = await createConversation(db, companyId, colleague, "Da colega");

    expect((await listConversations(db, companyId, me)).map((conversation) => conversation.id)).toEqual([kept]);
    expect(await getConversation(db, companyId, me, kept)).toMatchObject({ id: kept, title: "Fica" });
    expect(await getConversation(db, companyId, me, foreign)).toBeNull();
    expect(await getConversation(db, companyId, me, elsewhere)).toBeNull();
    expect(await getConversation(db, companyId, me, removed)).toBeNull();
  });

  it("recusa mensagem vazia, autor desconhecido e conversa que não existe", async () => {
    const id = await createConversation(db, companyId, me);
    await expect(appendMessage(db, id, "user", "   ")).rejects.toThrow(/vazia/);
    await expect(appendMessage(db, id, "sistema" as "user", "Oi")).rejects.toThrow(/autor/i);
    await expect(appendMessage(db, "nao-existe", "user", "Oi")).rejects.toThrow(/não encontrada/);
    expect(await getMessages(db, id)).toEqual([]);
  });

  it("o título vem da primeira pergunta, numa linha e encurtado", () => {
    expect(conversationTitle("  Resuma   as contas\n a pagar  ")).toBe("Resuma as contas a pagar");
    expect(conversationTitle("")).toBe(DEFAULT_CONVERSATION_TITLE);
    const long = conversationTitle("palavra ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });
});
