// O Assistente de IA grava a conversa no banco (/assistant/:conversationId) e reabre o histórico dela.
import { Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { appendMessage, createConversation, getMessages, listConversations } from "@/lib/assistant/conversations";
import AssistantPage from "./AssistantPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

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
});
