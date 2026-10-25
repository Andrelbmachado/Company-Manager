// Instrução do assistente e chamada à API compatível com OpenAI.
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantSystemPrompt, requestAssistantReply } from "./client";
import { ASSISTANT_PROVIDERS, type AssistantApiConfig } from "./config";

const API: AssistantApiConfig = { provider: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "sk-teste" };

afterEach(() => vi.unstubAllGlobals());

describe("assistente: instrução e API", () => {
  it("a instrução diz a área e que não há ferramentas nem acesso aos dados", () => {
    const prompt = assistantSystemPrompt("Comercial");
    expect(prompt).toMatch(/área Comercial/);
    expect(prompt).toMatch(/português do Brasil/);
    // Sem isso, pedido de "ler o arquivo" vira chamada de ferramenta falsa (<invoke name="Read">) no texto da resposta.
    expect(prompt).toMatch(/não tem ferramentas/);
    expect(prompt).toMatch(/banco de dados/);
  });

  it("API que responde sem texto: mensagem em pt-BR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) }));
    await expect(requestAssistantReply(API, "Comercial", [{ role: "user", content: "Oi" }], [])).resolves.toBe(
      "A API não retornou uma resposta de texto.",
    );
  });

  it("rótulo do provedor compatível com OpenAI tem acento", () => {
    expect(ASSISTANT_PROVIDERS.map((provider) => provider.label)).toContain("API compatível com OpenAI");
  });
});
