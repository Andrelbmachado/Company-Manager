// Uma resposta do assistente pelo provedor resolvido (provider.ts): Claude Code local, com sessão por conversa, ou a API.
import type { AssistantMessageAuthor } from "@/types";
import { assistantSystemPrompt, describeAttachments, requestAssistantReply } from "./client";
import { askClaudeCode, isValidClaudeSessionId, type ClaudeCodeAsk, type ClaudeCodeReply } from "./claudeCode";
import type { AssistantApiConfig } from "./config";
import type { ResolvedAssistant } from "./provider";

export interface ReplyInput {
  provider: ResolvedAssistant;
  area: string;
  /** Histórico gravado da conversa; a última é a pergunta de agora. */
  history: { author: AssistantMessageAuthor; text: string }[];
  /** Arquivos desta pergunta (o histórico só guarda o nome). */
  files: File[];
  claudeSessionId: string | null;
  apiConfig: AssistantApiConfig;
}

export interface ReplyResult {
  text: string;
  /** Sessão do Claude Code a guardar na conversa; ausente quando a resposta não veio do Claude Code. */
  claudeSessionId?: string;
}

export interface ReplyDeps {
  ask?: (request: ClaudeCodeAsk) => Promise<ClaudeCodeReply>;
  api?: typeof requestAssistantReply;
}

const SPEAKER: Record<AssistantMessageAuthor, string> = { user: "Usuário", assistant: "Assistente" };

/** Sessão nova numa conversa que já tinha mensagens (veio da API ou de outro Mac): o histórico vai como contexto. */
function withTranscript(earlier: ReplyInput["history"], question: string): string {
  if (earlier.length === 0) return question;
  const transcript = earlier.map((message) => `${SPEAKER[message.author]}: ${message.text}`).join("\n\n");
  return `Histórico desta conversa até aqui, para contexto:\n\n${transcript}\n\nNova mensagem do usuário:\n${question}`;
}

function isMissingSession(error: unknown): boolean {
  return error instanceof Error && /no conversation found|session.*not found/i.test(error.message);
}

export async function requestReply(input: ReplyInput, deps: ReplyDeps = {}): Promise<ReplyResult> {
  const { provider } = input;
  if (provider.kind === "none") return { text: provider.reason };
  if (provider.kind === "api") {
    const api = deps.api ?? requestAssistantReply;
    const messages = input.history.map((message) => ({ role: message.author, content: message.text }));
    return { text: await api(input.apiConfig, input.area, messages, input.files) };
  }

  const ask = deps.ask ?? ((request: ClaudeCodeAsk) => askClaudeCode(request));
  const last = input.history.at(-1);
  const question = [last?.text ?? "", ...(await describeAttachments(input.files))].filter(Boolean).join("\n\n");
  const earlier = input.history.slice(0, -1);
  const systemPrompt = assistantSystemPrompt(input.area);
  const session = input.claudeSessionId && isValidClaudeSessionId(input.claudeSessionId) ? input.claudeSessionId : null;

  if (session) {
    try {
      const reply = await ask({ prompt: question, sessionId: session, systemPrompt });
      return { text: reply.text, claudeSessionId: reply.session_id };
    } catch (error) {
      if (!isMissingSession(error)) throw error;
    }
  }
  const reply = await ask({ prompt: withTranscript(earlier, question), sessionId: null, systemPrompt });
  return { text: reply.text, claudeSessionId: reply.session_id };
}
