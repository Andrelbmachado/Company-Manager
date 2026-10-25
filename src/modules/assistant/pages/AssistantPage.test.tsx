// O Assistente de IA grava a conversa no banco (/assistant/:conversationId) e reabre o histórico dela.
import { act } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { appendMessage, createConversation, getConversation, getMessages, listConversations } from "@/lib/assistant/conversations";
import AssistantPage from "./AssistantPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const testDb = useTestDb();
const COMPANY = "test-company";
const ME = "test-user-comercial";
let page: RenderedPage | null = null;

beforeEach(async () => {
  localStorage.clear();
  await insertTestCompany(testDb(), { companyId: COMPANY, roles: ["comercial", "financeiro"] });
});

afterEach(() => {
  page?.unmount();
  page = null;
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  tauri.invoke.mockReset();
});

function Where() {
  return <p data-testid="onde">{useLocation().pathname}</p>;
}

async function open(path: string): Promise<RenderedPage> {
  page = await renderPage(
    <>
      <Routes>
        <Route path="/assistant/:conversationId?" element={<AssistantPage />} />
      </Routes>
      <Where />
    </>,
    { companyId: COMPANY, role: "comercial", path },
  );
  return page;
}

const where = () => document.querySelector("[data-testid=onde]")?.textContent;

describe("AssistantPage", () => {
  it("a primeira pergunta cria a conversa, grava pergunta e resposta e passa para /assistant/:id", async () => {
    await open("/assistant");
    await type(document.querySelector("textarea"), "Quais oportunidades estão paradas?");
    await click(page!.button("Enviar"));
    await until(async () => (await listConversations(testDb(), COMPANY, ME)).length === 1, "conversa criada");
    const [conversation] = await listConversations(testDb(), COMPANY, ME);
    expect(conversation.title).toBe("Quais oportunidades estão paradas?");
    await until(async () => (await getMessages(testDb(), conversation.id)).length === 2, "pergunta e resposta gravadas");
    const messages = await getMessages(testDb(), conversation.id);
    expect(messages.map((message) => message.author)).toEqual(["user", "assistant"]);
    // Sem chave de API configurada, a resposta explica o que falta (e também fica no histórico).
    expect(messages[1].text).toMatch(/API/);
    await until(() => where() === `/assistant/${conversation.id}`, "URL da conversa");
    await until(() => page!.text().includes("Quais oportunidades estão paradas?"), "pergunta na tela");
  });

  it("abre o histórico de uma conversa e continua nela", async () => {
    const id = await createConversation(testDb(), COMPANY, ME, "Funil");
    await appendMessage(testDb(), id, "user", "Resuma o funil");
    await appendMessage(testDb(), id, "assistant", "O funil tem 3 oportunidades.");
    await open(`/assistant/${id}`);
    await until(() => page!.text().includes("O funil tem 3 oportunidades."), "histórico");
    expect(page!.text()).toMatch(/Resuma o funil/);

    await type(document.querySelector("textarea"), "E as ganhas?");
    await click(page!.button("Enviar"));
    await until(async () => (await getMessages(testDb(), id)).length === 4, "nova pergunta e resposta na mesma conversa");
    expect(await listConversations(testDb(), COMPANY, ME)).toHaveLength(1);
  });

  it("conversa de outra pessoa não abre", async () => {
    const foreign = await createConversation(testDb(), COMPANY, "test-user-financeiro", "Particular");
    await appendMessage(testDb(), foreign, "user", "Segredo do financeiro");
    await open(`/assistant/${foreign}`);
    await until(() => page!.text().includes("Conversa não encontrada"), "aviso de conversa não encontrada");
    expect(page!.text()).not.toMatch(/Segredo do financeiro/);
  });

  it("não envia antes de confirmar que a conversa da URL é da pessoa (nem grava nem lê o histórico alheio)", async () => {
    const foreign = await createConversation(testDb(), COMPANY, "test-user-financeiro", "Particular");
    await appendMessage(testDb(), foreign, "user", "Segredo do financeiro");
    // Segura a conferência de dono (getConversation) para a tela ficar no "carregando".
    const db = testDb();
    const select = db.select.bind(db) as (sql: string, binds?: unknown[]) => Promise<unknown>;
    let release!: () => void;
    const ownerCheck = new Promise<void>((resolve) => (release = resolve));
    db.select = (async (sql: string, binds?: unknown[]) => {
      if (sql.includes("FROM assistant_conversations WHERE company_id=? AND user_id=? AND id=?")) await ownerCheck;
      return select(sql, binds);
    }) as typeof db.select;

    await open(`/assistant/${foreign}`);
    const textarea = document.querySelector("textarea");
    await type(textarea, "Mostre o histórico");
    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await click(page!.button("Enviar"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    release();
    await until(() => page!.text().includes("Conversa não encontrada"), "aviso de conversa não encontrada");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect((await getMessages(testDb(), foreign)).map((message) => message.text)).toEqual(["Segredo do financeiro"]);
    expect(await listConversations(testDb(), COMPANY, ME)).toEqual([]);
  });

  it("com o Claude Code instalado e logado, responde por ele (sem chave de API) e continua a mesma sessão", async () => {
    const session = "b211ae63-4cce-4686-9792-92c42f2c0621";
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const asks: Record<string, unknown>[] = [];
    tauri.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "claude_code_status") return { available: true, path: "/opt/homebrew/bin/claude", version: "2.1.310", logged_in: true, reason: null };
      if (command === "claude_code_ask") {
        asks.push(args!);
        return { text: `Resposta ${asks.length} do Claude Code`, session_id: session };
      }
      throw new Error(`comando inesperado: ${command}`);
    });

    await open("/assistant");
    await until(() => page!.text().includes("Claude Code"), "selo do Claude Code");
    await type(document.querySelector("textarea"), "Quais propostas vencem esta semana?");
    await click(page!.button("Enviar"));
    await until(async () => (await listConversations(testDb(), COMPANY, ME)).length === 1, "conversa criada");
    const [conversation] = await listConversations(testDb(), COMPANY, ME);
    await until(async () => (await getMessages(testDb(), conversation.id)).length === 2, "resposta gravada");
    expect((await getMessages(testDb(), conversation.id))[1].text).toBe("Resposta 1 do Claude Code");
    await until(async () => (await getConversation(testDb(), COMPANY, ME, conversation.id))?.claude_session_id === session, "sessão guardada");
    expect(asks[0]).toMatchObject({ prompt: "Quais propostas vencem esta semana?", sessionId: null });
    expect(String(asks[0].systemPrompt)).toMatch(/Comercial/);

    await until(() => page!.text().includes("Resposta 1 do Claude Code"), "resposta na tela");
    await type(document.querySelector("textarea"), "E a maior delas?");
    await click(page!.button("Enviar"));
    await until(async () => (await getMessages(testDb(), conversation.id)).length === 4, "segunda resposta");
    expect(asks[1]).toMatchObject({ prompt: "E a maior delas?", sessionId: session });
  });
});
