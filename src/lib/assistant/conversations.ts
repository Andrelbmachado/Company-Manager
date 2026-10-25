// Histórico do Assistente de IA (tabelas assistant_conversations e assistant_messages, migration 0012).
// SQL nos padrões do banco demo (sem JOIN/LIMIT com bind): roda igual no desktop e no navegador.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { AssistantConversation, AssistantMessage, AssistantMessageAuthor } from "@/types";

export type Conversation = AssistantConversation;
export type Message = AssistantMessage;

export const DEFAULT_CONVERSATION_TITLE = "Nova conversa";
const TITLE_MAX_LENGTH = 60;
const AUTHORS: readonly AssistantMessageAuthor[] = ["user", "assistant"];

/** Chave do React Query da lista de conversas (sidebar e AssistantPage invalidam a mesma). */
export function conversationsQueryKey(companyId: string, userId: string): readonly string[] {
  return ["assistant_conversations", companyId, userId];
}

let lastStamp = 0;

/**
 * Instante ISO estritamente crescente: pergunta e resposta gravadas no mesmo milissegundo ainda saem em ordem, e a
 * conversa movimentada por último fica em primeiro na lista (datetime('now') do SQLite só tem segundos).
 */
function nextStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

/** Título a partir da primeira pergunta: uma linha, espaços simples, no máximo 60 caracteres. */
export function conversationTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return DEFAULT_CONVERSATION_TITLE;
  return line.length <= TITLE_MAX_LENGTH ? line : `${line.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/** Conversas da pessoa nesta empresa, da movimentada por último para a mais antiga. */
export async function listConversations(db: DatabaseLike, companyId: string, userId: string): Promise<Conversation[]> {
  return db.select<Conversation[]>(
    "SELECT * FROM assistant_conversations WHERE company_id=? AND user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC",
    [companyId, userId],
  );
}

/** A conversa, se for da própria pessoa nesta empresa e não estiver excluída; senão null. */
export async function getConversation(db: DatabaseLike, companyId: string, userId: string, conversationId: string): Promise<Conversation | null> {
  const rows = await db.select<Conversation[]>(
    "SELECT * FROM assistant_conversations WHERE company_id=? AND user_id=? AND id=? AND deleted_at IS NULL",
    [companyId, userId, conversationId],
  );
  return rows[0] ?? null;
}

/** Cria a conversa e devolve o id. */
export async function createConversation(db: DatabaseLike, companyId: string, userId: string, title?: string): Promise<string> {
  const id = uuidv4();
  const stamp = nextStamp();
  await db.execute(
    "INSERT INTO assistant_conversations (id, company_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, companyId, userId, conversationTitle(title ?? ""), stamp, stamp],
  );
  return id;
}

/** Grava uma mensagem no fim da conversa e a marca como movimentada agora. */
export async function appendMessage(db: DatabaseLike, conversationId: string, author: AssistantMessageAuthor, text: string): Promise<void> {
  if (!AUTHORS.includes(author)) throw new Error(`Autor de mensagem inválido: ${String(author)}`);
  const body = text.trim();
  if (!body) throw new Error("Mensagem vazia: escreva algo antes de enviar.");
  const [conversation] = await db.select<Conversation[]>(
    "SELECT * FROM assistant_conversations WHERE id=? AND deleted_at IS NULL",
    [conversationId],
  );
  if (!conversation) throw new Error("Conversa não encontrada.");
  const stamp = nextStamp();
  await db.execute(
    "INSERT INTO assistant_messages (id, conversation_id, author, text, created_at) VALUES (?, ?, ?, ?, ?)",
    [uuidv4(), conversationId, author, body, stamp],
  );
  await db.execute("UPDATE assistant_conversations SET updated_at=? WHERE id=?", [stamp, conversationId]);
}

/** Mensagens da conversa, da primeira para a última. Quem chama confere antes que a conversa é da pessoa (getConversation). */
export async function getMessages(db: DatabaseLike, conversationId: string): Promise<Message[]> {
  return db.select<Message[]>("SELECT * FROM assistant_messages WHERE conversation_id=? ORDER BY created_at ASC", [conversationId]);
}
