// Ponte com os comandos Rust do Claude Code local (src-tauri/src/claude_code.rs).
import { describe, expect, it, vi } from "vitest";
import { askClaudeCode, getClaudeCodeStatus, isValidClaudeSessionId, type ClaudeCodeStatus } from "./claudeCode";

const UUID = "b211ae63-4cce-4686-9792-92c42f2c0621";

describe("Claude Code local", () => {
  it("id de sessão: letras, números e hífen, começando por letra ou número (igual ao Rust)", () => {
    expect(isValidClaudeSessionId(UUID)).toBe(true);
    for (const bad of ["", "--help", "-r", "a b", "abc;rm -rf ~", "../etc", "$(whoami)", "é1", "a".repeat(101)]) {
      expect(isValidClaudeSessionId(bad), bad).toBe(false);
    }
  });

  it("fora do app desktop não chama o Rust e diz por quê", async () => {
    const invoke = vi.fn();
    const status = await getClaudeCodeStatus({ invoke, inTauri: false });
    expect(invoke).not.toHaveBeenCalled();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/app desktop/);
  });

  it("no desktop devolve o status do Rust; falha do comando vira indisponível com o motivo", async () => {
    const found: ClaudeCodeStatus = { available: true, path: "/Users/x/.local/bin/claude", version: "2.1.310", logged_in: true, reason: null };
    const invoke = vi.fn().mockResolvedValue(found);
    expect(await getClaudeCodeStatus({ invoke, inTauri: true })).toEqual(found);
    expect(invoke).toHaveBeenCalledWith("claude_code_status");

    const broken = vi.fn().mockRejectedValue("comando não registrado");
    const status = await getClaudeCodeStatus({ invoke: broken, inTauri: true });
    expect(status).toMatchObject({ available: false, reason: "comando não registrado" });
  });

  it("pergunta com sessão só quando o id é válido", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: "Oi!", session_id: UUID });
    expect(await askClaudeCode({ prompt: "Olá", sessionId: UUID, systemPrompt: "Sistema" }, { invoke })).toEqual({ text: "Oi!", session_id: UUID });
    expect(invoke).toHaveBeenLastCalledWith("claude_code_ask", { prompt: "Olá", sessionId: UUID, systemPrompt: "Sistema" });
    await askClaudeCode({ prompt: "Olá", sessionId: "--help", systemPrompt: "Sistema" }, { invoke });
    expect(invoke).toHaveBeenLastCalledWith("claude_code_ask", { prompt: "Olá", sessionId: null, systemPrompt: "Sistema" });
  });

  it("erro do Rust chega como Error com a mensagem", async () => {
    const invoke = vi.fn().mockRejectedValue("No conversation found with session ID: x");
    await expect(askClaudeCode({ prompt: "Olá", sessionId: null, systemPrompt: "S" }, { invoke })).rejects.toThrow("No conversation found");
  });
});
