// @vitest-environment jsdom
// As conversas do assistente também funcionam no banco demo do navegador (SQL nos padrões do demo.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { appendMessage, createConversation, getConversation, getMessages, listConversations, setClaudeSession } from "./conversations";

beforeEach(() => localStorage.clear());

describe("conversas do assistente no banco demo", () => {
  it("cria, grava mensagens, lista a mais recente primeiro e só do próprio usuário", async () => {
    const db = createDemoDb();
    const first = await createConversation(db, DEMO_COMPANY_ID, "demo-ceo", "Primeira");
    const second = await createConversation(db, DEMO_COMPANY_ID, "demo-ceo", "Segunda");
    await createConversation(db, DEMO_COMPANY_ID, "demo-admin", "De outra pessoa");
    await appendMessage(db, first, "user", "Oi");
    await appendMessage(db, first, "assistant", "Olá!");

    expect((await getMessages(db, first)).map((message) => message.text)).toEqual(["Oi", "Olá!"]);
    expect((await listConversations(db, DEMO_COMPANY_ID, "demo-ceo")).map((conversation) => conversation.title)).toEqual(["Primeira", "Segunda"]);
    expect(await getConversation(db, DEMO_COMPANY_ID, "demo-admin", second)).toBeNull();

    // Relido do localStorage (outra aba / recarregar a página).
    expect((await getMessages(createDemoDb(), first)).map((message) => message.author)).toEqual(["user", "assistant"]);
  });

  it("guarda o id da sessão do Claude Code na conversa", async () => {
    const db = createDemoDb();
    const id = await createConversation(db, DEMO_COMPANY_ID, "demo-ceo", "Claude");
    await setClaudeSession(db, id, "b211ae63-4cce-4686-9792-92c42f2c0621");
    expect((await getConversation(createDemoDb(), DEMO_COMPANY_ID, "demo-ceo", id))?.claude_session_id).toBe("b211ae63-4cce-4686-9792-92c42f2c0621");
  });
});
