import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, MessageSquareOff, Paperclip, Send, Sparkles, X } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { getAssistantApiConfig, hasAssistantApiConfig } from "@/lib/assistant/config";
import { CLAUDE_CODE_STATUS_KEY, getClaudeCodeStatus } from "@/lib/assistant/claudeCode";
import { getAssistantMode, resolveAssistantProvider } from "@/lib/assistant/provider";
import { requestReply } from "@/lib/assistant/reply";
import {
  appendMessage,
  conversationsQueryKey,
  createConversation,
  getConversation,
  getMessages,
  setClaudeSession,
} from "@/lib/assistant/conversations";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

const SUGGESTIONS: Record<Role, string[]> = {
  ceo: ["Resuma os indicadores de todos os setores", "Quais áreas precisam de atenção?", "Crie um resumo executivo para a diretoria"],
  rh: ["Resuma as solicitações de RH pendentes", "Quais pendências de colaboradores estão atrasadas?", "Redija um comunicado para todos os colaboradores"],
  admin: ["Resuma os indicadores da empresa", "Quais áreas precisam de atenção?", "Crie um resumo executivo"],
  gerente: ["Liste os principais riscos operacionais", "Resuma os projetos ativos", "Quais chamados exigem prioridade?"],
  tecnico: ["Resuma os tickets em atendimento", "Crie um checklist de diagnóstico", "Quais OS aguardam ação técnica?"],
  estoquista: ["Quais itens estão abaixo do mínimo?", "Resuma as custódias de peças ativas", "Liste fornecedores por item crítico"],
  financeiro: ["Resuma contas a pagar e receber", "Quais vencimentos estão próximos?", "Calcule o saldo projetado"],
  comercial: ["Resuma oportunidades em negociação", "Quais propostas precisam de retorno?", "Organize o funil comercial"],
  atendimento: ["Resuma tickets abertos", "Quais chamados aguardam retorno?", "Crie uma resposta para o solicitante"],
  produtos: ["Resuma os produtos em desenvolvimento", "Quais entregas estão em validação?", "Liste os próximos marcos do roadmap"],
  auditor: ["Resuma os eventos recentes", "Liste operações sensíveis", "Quais documentos precisam de revisão?"],
};

const PROVIDER_BADGE = { "claude-code": "Claude Code", api: "API configurada", none: "Configurar assistente" } as const;
/** Marca de "enviando" de uma conversa que ainda não existe (primeira pergunta em /assistant). */
const NEW_CONVERSATION = "__nova__";

/**
 * Assistente de IA em /assistant/:conversationId?. Sem id é uma conversa nova: a primeira pergunta cria a conversa
 * (título = pergunta) e a URL passa a ter o id. Pergunta e resposta ficam gravadas (lib/assistant/conversations).
 */
export default function AssistantPage() {
  const session = useRequiredSession();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = session.membership.role as Role;
  const companyId = session.company.id;
  const userId = session.user.id;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Claude Code local (sem chave) quando instalado e logado; senão a API configurada (lib/assistant/provider).
  const claudeStatus = useQuery({ queryKey: CLAUDE_CODE_STATUS_KEY, queryFn: () => getClaudeCodeStatus(), staleTime: 60_000 });
  const mode = getAssistantMode(userId);
  const provider = resolveAssistantProvider(mode, claudeStatus.data, hasAssistantApiConfig(userId));
  // A conferência roda o `claude` algumas vezes (~1 s): até lá o selo não pede para configurar o que pode já estar pronto.
  const checkingClaude = claudeStatus.isLoading && mode !== "api";

  const conversation = useQuery({
    queryKey: ["assistant_conversation", companyId, userId, conversationId],
    queryFn: async () => getConversation(await getDb(), companyId, userId, conversationId!),
    enabled: Boolean(conversationId),
  });
  const messagesQuery = useQuery({
    queryKey: ["assistant_messages", companyId, conversationId],
    queryFn: async () => getMessages(await getDb(), conversationId!),
    enabled: Boolean(conversationId && conversation.data),
  });
  const notFound = Boolean(conversationId) && conversation.isSuccess && conversation.data === null;
  // Conversa da URL só recebe pergunta depois de confirmado que é da pessoa (getConversation): appendMessage não
  // confere o dono e o histórico inteiro vai para a API, então enviar antes disso gravaria e leria conversa alheia.
  const ready = !conversationId || Boolean(conversation.data);
  const messages = conversationId ? messagesQuery.data ?? [] : [];
  const sending = sendingFor !== null && sendingFor === (conversationId ?? NEW_CONVERSATION);
  const busy = sendingFor !== null;

  async function refresh(id: string) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["assistant_messages", companyId, id] }),
      qc.invalidateQueries({ queryKey: conversationsQueryKey(companyId, userId) }),
    ]);
  }

  async function submit(message = prompt) {
    const trimmed = message.trim();
    if ((!trimmed && files.length === 0) || sendingRef.current || !ready) return;
    sendingRef.current = true;
    const localFiles = [...files];
    const question = trimmed || "Analise os arquivos anexados.";
    // Os arquivos vão para a API só nesta pergunta; no histórico fica o nome deles.
    const stored = localFiles.length ? `${question}\n\nAnexos: ${localFiles.map((file) => file.name).join(", ")}` : question;
    setPrompt("");
    setFiles([]);
    setSendError(null);
    let id = conversationId;
    setSendingFor(id ?? NEW_CONVERSATION);
    try {
      const db = await getDb();
      if (!id) {
        id = await createConversation(db, companyId, userId, question);
        setSendingFor(id);
        navigate(`/assistant/${id}`);
      }
      await appendMessage(db, id, "user", stored);
      await refresh(id);
      const history = await getMessages(db, id);
      const status = await qc.ensureQueryData({ queryKey: CLAUDE_CODE_STATUS_KEY, queryFn: () => getClaudeCodeStatus(), staleTime: 60_000 });
      const claudeSessionId = (await getConversation(db, companyId, userId, id))?.claude_session_id ?? null;
      let reply: string;
      try {
        const result = await requestReply({
          provider: resolveAssistantProvider(getAssistantMode(userId), status, hasAssistantApiConfig(userId)),
          area: ROLE_LABELS[role],
          history: history.map((item) => ({ author: item.author, text: item.text })),
          files: localFiles,
          claudeSessionId,
          apiConfig: getAssistantApiConfig(userId),
        });
        reply = result.text;
        if (result.claudeSessionId !== claudeSessionId) await setClaudeSession(db, id, result.claudeSessionId);
      } catch (error) {
        reply = error instanceof Error ? error.message : "Não foi possível consultar o assistente.";
      }
      await appendMessage(db, id, "assistant", reply);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Não foi possível gravar a conversa.");
    } finally {
      sendingRef.current = false;
      setSendingFor(null);
      if (id) await refresh(id);
    }
  }

  return (
    <div className="-m-[var(--content-pad)] flex h-screen flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Sparkles size={17} />
          </div>
          <h1 className="min-w-0 truncate text-sm font-semibold">{conversation.data?.title ?? "Assistente de IA"}</h1>
        </div>
        <Link
          to="/settings"
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${checkingClaude ? "bg-muted text-muted-foreground" : provider.kind !== "none" ? "bg-status-success text-white" : "bg-status-warning text-status-warning-ink"}`}
        >
          {checkingClaude ? "Verificando…" : PROVIDER_BADGE[provider.kind]}
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notFound ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-8 text-center">
            <MessageSquareOff size={28} className="text-muted-foreground" />
            <h2 className="mt-4 text-title2 font-semibold">Conversa não encontrada</h2>
            <Link to="/assistant" className="mt-5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
              Nova conversa
            </Link>
          </div>
        ) : conversationId && (conversation.isLoading || messagesQuery.isLoading) ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">Carregando conversa…</p>
        ) : messages.length === 0 && !sending ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-8 pb-10 text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border bg-muted/40 text-foreground">
              <Bot size={24} />
            </div>
            <h2 className="text-title1 font-semibold tracking-tight">Como posso ajudar?</h2>
            <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
              {SUGGESTIONS[role].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void submit(suggestion)}
                  disabled={busy || !ready}
                  className="rounded-xl border px-3 py-3 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-7 px-6 py-8">
            {messages.map((message) => (
              <div key={message.id} className={`flex gap-3 ${message.author === "user" ? "justify-end" : ""}`}>
                {message.author === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                    <Sparkles size={15} />
                  </div>
                )}
                <div className={message.author === "user" ? "max-w-[80%] rounded-2xl bg-muted px-4 py-3" : "max-w-[85%] pt-1"}>
                  <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Sparkles size={15} />
                </div>
                <p className="pt-1 text-sm text-muted-foreground">Consultando assistente...</p>
              </div>
            )}
          </div>
        )}
      </div>

      {!notFound && (
        <div className="shrink-0 px-6 pb-5 pt-2">
          {sendError && <p role="alert" className="mx-auto mb-2 max-w-3xl text-sm text-destructive">{sendError}</p>}
          <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-2">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 px-2 pb-2">
                {files.map((file) => (
                  <span key={file.name} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                    <FileText size={12} />
                    {file.name}
                    <button type="button" aria-label={`Remover ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Anexar arquivos"
                title="Anexar arquivos"
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Paperclip size={18} />
              </button>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                aria-label="Mensagem para o assistente"
                placeholder="Pergunte sobre a sua área ou anexe um documento..."
                className="max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !ready || (!prompt.trim() && files.length === 0)}
                aria-label="Enviar"
                title="Enviar"
                className="rounded-xl bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                <Send size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
