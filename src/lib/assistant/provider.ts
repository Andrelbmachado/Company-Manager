// Qual provedor responde no assistente: Claude Code local (sem chave) ou a API configurada em Configurações.
import type { ClaudeCodeStatus } from "./claudeCode";

export type AssistantMode = "auto" | "claude-code" | "api";

export type ResolvedAssistant = { kind: "claude-code" } | { kind: "api" } | { kind: "none"; reason: string };

export const ASSISTANT_MODES: { id: AssistantMode; label: string }[] = [
  { id: "auto", label: "Automático (Claude Code quando disponível)" },
  { id: "claude-code", label: "Claude Code (local)" },
  { id: "api", label: "API configurada" },
];

const MODES = new Set<string>(ASSISTANT_MODES.map((mode) => mode.id));

function storageKey(userId: string): string {
  return `cm_assistant_mode_${userId}`;
}

export function getAssistantMode(userId: string): AssistantMode {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    return stored && MODES.has(stored) ? (stored as AssistantMode) : "auto";
  } catch {
    return "auto";
  }
}

export function saveAssistantMode(userId: string, mode: AssistantMode): void {
  localStorage.setItem(storageKey(userId), mode);
}

const NO_ASSISTANT =
  "Nenhum assistente conectado. No app desktop, instale o Claude Code e faça login no Terminal (claude), ou cadastre uma chave de API em Configurações.";
const NO_API_KEY = "A conexão de API ainda não foi configurada para esta conta. Cadastre a chave de API em Configurações.";

/**
 * Automático: Claude Code quando o `claude` está instalado e logado; senão a API, se tiver chave.
 * Escolha fixa: só aquele provedor (sem cair no outro sem a pessoa saber).
 */
export function resolveAssistantProvider(
  mode: AssistantMode,
  claude: ClaudeCodeStatus | null | undefined,
  apiConfigured: boolean,
): ResolvedAssistant {
  const claudeReady = Boolean(claude?.available);
  if (mode === "claude-code") {
    return claudeReady ? { kind: "claude-code" } : { kind: "none", reason: claude?.reason || "O Claude Code não foi encontrado neste Mac." };
  }
  if (mode === "api") return apiConfigured ? { kind: "api" } : { kind: "none", reason: NO_API_KEY };
  if (claudeReady) return { kind: "claude-code" };
  if (apiConfigured) return { kind: "api" };
  return { kind: "none", reason: NO_ASSISTANT };
}
