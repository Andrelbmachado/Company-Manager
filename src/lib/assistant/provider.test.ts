// @vitest-environment jsdom
// Escolha do provedor do assistente: Claude Code local quando disponível, senão a API configurada.
import { beforeEach, describe, expect, it } from "vitest";
import { getAssistantMode, resolveAssistantProvider, saveAssistantMode } from "./provider";
import type { ClaudeCodeStatus } from "./claudeCode";

const CLAUDE_ON: ClaudeCodeStatus = { available: true, path: "/opt/homebrew/bin/claude", version: "2.1.310", logged_in: true, reason: null };
const CLAUDE_OFF: ClaudeCodeStatus = { available: false, path: null, version: null, logged_in: null, reason: "O Claude Code não foi encontrado neste Mac." };

beforeEach(() => localStorage.clear());

describe("provedor do assistente", () => {
  it("automático: Claude Code quando disponível, senão a API, senão explica o que falta", () => {
    expect(resolveAssistantProvider("auto", CLAUDE_ON, true)).toEqual({ kind: "claude-code" });
    expect(resolveAssistantProvider("auto", CLAUDE_ON, false)).toEqual({ kind: "claude-code" });
    expect(resolveAssistantProvider("auto", CLAUDE_OFF, true)).toEqual({ kind: "api" });
    expect(resolveAssistantProvider("auto", undefined, true)).toEqual({ kind: "api" });
    const none = resolveAssistantProvider("auto", CLAUDE_OFF, false);
    expect(none.kind).toBe("none");
    expect(none.kind === "none" && none.reason).toMatch(/Claude Code/);
    expect(none.kind === "none" && none.reason).toMatch(/API/);
  });

  it("escolha fixa: respeita o que a pessoa escolheu e diz quando não dá", () => {
    expect(resolveAssistantProvider("api", CLAUDE_ON, true)).toEqual({ kind: "api" });
    const noKey = resolveAssistantProvider("api", CLAUDE_ON, false);
    expect(noKey.kind === "none" && noKey.reason).toMatch(/chave de API/);
    expect(resolveAssistantProvider("claude-code", CLAUDE_ON, true)).toEqual({ kind: "claude-code" });
    const missing = resolveAssistantProvider("claude-code", CLAUDE_OFF, true);
    expect(missing.kind === "none" && missing.reason).toMatch(/não foi encontrado/);
  });

  it("a escolha fica por usuário; padrão e valor estranho = automático", () => {
    expect(getAssistantMode("u1")).toBe("auto");
    saveAssistantMode("u1", "api");
    expect(getAssistantMode("u1")).toBe("api");
    expect(getAssistantMode("u2")).toBe("auto");
    localStorage.setItem("cm_assistant_mode_u3", "qualquer");
    expect(getAssistantMode("u3")).toBe("auto");
  });
});
