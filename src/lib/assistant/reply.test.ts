// Resposta do assistente pelo provedor escolhido: Claude Code local (com sessão por conversa) ou API configurada.
import { describe, expect, it, vi } from "vitest";
import { requestReply, type ReplyInput } from "./reply";
import type { AssistantApiConfig } from "./config";

const UUID = "b211ae63-4cce-4686-9792-92c42f2c0621";
const NEW_UUID = "11111111-2222-3333-4444-555555555555";
const API: AssistantApiConfig = { provider: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKey: "sk-teste" };

function input(overrides: Partial<ReplyInput> = {}): ReplyInput {
  return {
    provider: { kind: "claude-code" },
    area: "Comercial",
    history: [{ author: "user", text: "Quais propostas vencem?" }],
    files: [],
    claudeSessionId: null,
    apiConfig: API,
    ...overrides,
  };
}

describe("resposta do assistente", () => {
  it("sem provedor devolve o motivo e não chama nada", async () => {
    const ask = vi.fn();
    const api = vi.fn();
    const result = await requestReply(input({ provider: { kind: "none", reason: "Configure o assistente." } }), { ask, api });
    expect(result).toEqual({ text: "Configure o assistente." });
    expect(ask).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("API: manda o histórico e os arquivos para a API configurada", async () => {
    const api = vi.fn().mockResolvedValue("Resposta da API");
    const history = [
      { author: "user" as const, text: "Oi" },
      { author: "assistant" as const, text: "Olá" },
      { author: "user" as const, text: "Resuma" },
    ];
    const result = await requestReply(input({ provider: { kind: "api" }, history }), { ask: vi.fn(), api });
    expect(result).toEqual({ text: "Resposta da API" });
    expect(api).toHaveBeenCalledWith(API, "Comercial", [
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá" },
      { role: "user", content: "Resuma" },
    ], []);
  });

  it("Claude Code, conversa nova: só a pergunta, sem sessão, com a instrução da área; devolve a sessão nova", async () => {
    const ask = vi.fn().mockResolvedValue({ text: "Duas propostas.", session_id: NEW_UUID });
    const result = await requestReply(input(), { ask, api: vi.fn() });
    expect(result).toEqual({ text: "Duas propostas.", claudeSessionId: NEW_UUID });
    const [args] = ask.mock.calls[0];
    expect(args.prompt).toBe("Quais propostas vencem?");
    expect(args.sessionId).toBeNull();
    expect(args.systemPrompt).toMatch(/Comercial/);
  });

  it("Claude Code com sessão: manda só a última pergunta e continua a sessão", async () => {
    const ask = vi.fn().mockResolvedValue({ text: "Sim.", session_id: UUID });
    const history = [
      { author: "user" as const, text: "Primeira" },
      { author: "assistant" as const, text: "Resposta" },
      { author: "user" as const, text: "E agora?" },
    ];
    const result = await requestReply(input({ history, claudeSessionId: UUID }), { ask, api: vi.fn() });
    expect(result).toEqual({ text: "Sim.", claudeSessionId: UUID });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({ prompt: "E agora?", sessionId: UUID });
  });

  it("Claude Code sem sessão numa conversa que já tinha mensagens (veio da API): manda o histórico junto", async () => {
    const ask = vi.fn().mockResolvedValue({ text: "Ok.", session_id: NEW_UUID });
    const history = [
      { author: "user" as const, text: "Pergunta pela API" },
      { author: "assistant" as const, text: "Resposta pela API" },
      { author: "user" as const, text: "Continue" },
    ];
    await requestReply(input({ history }), { ask, api: vi.fn() });
    const { prompt, sessionId } = ask.mock.calls[0][0];
    expect(sessionId).toBeNull();
    expect(prompt).toContain("Pergunta pela API");
    expect(prompt).toContain("Resposta pela API");
    expect(prompt.trim().endsWith("Continue")).toBe(true);
  });

  it("sessão que o Claude Code não acha mais (outro Mac, backup): recomeça com o histórico e devolve a sessão nova", async () => {
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new Error(`No conversation found with session ID: ${UUID}`))
      .mockResolvedValueOnce({ text: "Recomeçado.", session_id: NEW_UUID });
    const history = [
      { author: "user" as const, text: "Antes" },
      { author: "assistant" as const, text: "Resposta antiga" },
      { author: "user" as const, text: "Depois" },
    ];
    const result = await requestReply(input({ history, claudeSessionId: UUID }), { ask, api: vi.fn() });
    expect(result).toEqual({ text: "Recomeçado.", claudeSessionId: NEW_UUID });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0].sessionId).toBeNull();
    expect(ask.mock.calls[1][0].prompt).toContain("Resposta antiga");
  });

  it("outro erro do Claude Code sobe para a tela", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("Not logged in · Please run /login"));
    await expect(requestReply(input({ claudeSessionId: UUID }), { ask, api: vi.fn() })).rejects.toThrow("Not logged in");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("arquivo de texto anexado vai junto da pergunta", async () => {
    const ask = vi.fn().mockResolvedValue({ text: "Lido.", session_id: NEW_UUID });
    const file = new File(["cliente;valor\nAcme;100"], "vendas.csv", { type: "text/csv" });
    const image = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });
    await requestReply(input({ files: [file, image] }), { ask, api: vi.fn() });
    const { prompt } = ask.mock.calls[0][0];
    expect(prompt).toContain("Quais propostas vencem?");
    expect(prompt).toContain("Arquivo anexado: vendas.csv");
    expect(prompt).toContain("Acme;100");
    expect(prompt).toContain("foto.png");
  });
});
