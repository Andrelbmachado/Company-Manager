// Ponte com o Claude Code instalado no Mac (comandos claude_code_status e claude_code_ask, src-tauri/src/claude_code.rs).
// Com o `claude` instalado e logado, o assistente responde por ele, sem chave de API. No navegador não existe.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export interface ClaudeCodeStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  /** null = a versão instalada não informa (a pergunta mostra o erro, se houver). */
  logged_in: boolean | null;
  /** Por que não está disponível. */
  reason: string | null;
}

export interface ClaudeCodeReply {
  text: string;
  session_id: string;
}

export interface ClaudeCodeAsk {
  prompt: string;
  sessionId: string | null;
  systemPrompt: string;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Chave do React Query do status (Configurações e o Assistente usam a mesma). */
export const CLAUDE_CODE_STATUS_KEY = ["claude_code_status"] as const;

const BROWSER_REASON = "O Claude Code só funciona no app desktop.";

/** Mesma regra do Rust (is_valid_session_id): letras, números e hífen, começando por letra ou número. */
export function isValidClaudeSessionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(id);
}

function inTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error.trim() ? error : "Não foi possível falar com o Claude Code.";
}

export async function getClaudeCodeStatus(
  { invoke = tauriInvoke as Invoke, inTauri = inTauriRuntime() }: { invoke?: Invoke; inTauri?: boolean } = {},
): Promise<ClaudeCodeStatus> {
  if (!inTauri) return { available: false, path: null, version: null, logged_in: null, reason: BROWSER_REASON };
  try {
    return (await invoke("claude_code_status")) as ClaudeCodeStatus;
  } catch (error) {
    return { available: false, path: null, version: null, logged_in: null, reason: message(error) };
  }
}

export async function askClaudeCode(request: ClaudeCodeAsk, { invoke = tauriInvoke as Invoke }: { invoke?: Invoke } = {}): Promise<ClaudeCodeReply> {
  const sessionId = request.sessionId && isValidClaudeSessionId(request.sessionId) ? request.sessionId : null;
  try {
    return (await invoke("claude_code_ask", { prompt: request.prompt, sessionId, systemPrompt: request.systemPrompt })) as ClaudeCodeReply;
  } catch (error) {
    throw new Error(message(error));
  }
}
