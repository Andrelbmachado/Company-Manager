import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useRequiredSession } from "@/hooks/useSession";
import { getAssistantApiConfig, hasAssistantApiConfig } from "@/lib/assistant/config";
import { requestAssistantReply } from "@/lib/assistant/client";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { Bot, FileText, Paperclip, Send, Sparkles, X } from "lucide-react";
import type { Role } from "@/types";

interface ChatMessage {
  id: number;
  author: "user" | "assistant";
  text: string;
  files?: string[];
}

const SUGGESTIONS: Record<Role, string[]> = {
  ceo: ["Resuma os indicadores de todos os setores", "Quais areas precisam de atencao?", "Crie um resumo executivo para a diretoria"],
  rh: ["Resuma as solicitacoes de RH pendentes", "Quais pendencias de colaboradores estao atrasadas?", "Redija um comunicado para todos os colaboradores"],
  admin: ["Resuma os indicadores da empresa", "Quais areas precisam de atencao?", "Crie um resumo executivo"],
  gerente: ["Liste os principais riscos operacionais", "Resuma os projetos ativos", "Quais chamados exigem prioridade?"],
  tecnico: ["Resuma os tickets em atendimento", "Crie um checklist de diagnostico", "Quais OS aguardam acao tecnica?"],
  estoquista: ["Quais itens estao abaixo do minimo?", "Resuma as custódias de peças ativas", "Liste fornecedores por item critico"],
  financeiro: ["Resuma contas a pagar e receber", "Quais vencimentos estao proximos?", "Calcule o saldo projetado"],
  comercial: ["Resuma oportunidades em negociacao", "Quais propostas precisam de retorno?", "Organize o funil comercial"],
  atendimento: ["Resuma tickets abertos", "Quais chamados aguardam retorno?", "Crie uma resposta para o solicitante"],
  produtos: ["Resuma os produtos em desenvolvimento", "Quais entregas estao em validacao?", "Liste os proximos marcos do roadmap"],
  auditor: ["Resuma os eventos recentes", "Liste operacoes sensiveis", "Quais documentos precisam de revisao?"],
};

export default function AssistantPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const connected = hasAssistantApiConfig(session.user.id);

  async function submit(message = prompt) {
    const trimmed = message.trim();
    if ((!trimmed && files.length === 0) || sending) return;
    const localFiles = [...files];
    const userText = trimmed || "Analise os arquivos anexados.";
    const userMessage = { id: Date.now(), author: "user" as const, text: userText, files: localFiles.map((file) => file.name) };
    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    setFiles([]);
    setSending(true);
    let responseText = "";
    if (!connected) {
      responseText = "A conexao de API ainda nao foi configurada para esta conta. Cadastre a chave em Configuracoes para ativar respostas do assistente. Seus anexos permaneceram somente nesta conversa local.";
    } else {
      try {
        responseText = await requestAssistantReply(
          getAssistantApiConfig(session.user.id),
          ROLE_LABELS[role],
          [...messages, userMessage].map((item) => ({ role: item.author, content: item.text })),
          localFiles
        );
      } catch (error) {
        responseText = error instanceof Error ? error.message : "Nao foi possivel consultar a API configurada.";
      }
    }
    setMessages((current) => [...current, { id: Date.now() + 1, author: "assistant", text: responseText }]);
    setSending(false);
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles size={17} />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Assistente IA</h1>
            <p className="text-xs text-muted-foreground">Contexto restrito a {ROLE_LABELS[role]}</p>
          </div>
        </div>
        <Link
          to="/settings"
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${connected ? "bg-status-success text-white" : "bg-status-warning text-status-warning-ink"}`}
        >
          {connected ? "API configurada" : "Configurar API"}
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-8 pb-20 text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border bg-muted/40 text-primary">
              <Bot size={24} />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Como posso ajudar?</h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Consulte dados permitidos para sua area, resuma documentos ou anexe arquivos para contextualizar a conversa.
            </p>
            <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
              {SUGGESTIONS[role].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void submit(suggestion)}
                  className="rounded-xl border px-3 py-3 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-7 px-6 py-8 pb-36">
            {messages.map((message) => (
              <div key={message.id} className={`flex gap-3 ${message.author === "user" ? "justify-end" : ""}`}>
                {message.author === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles size={15} />
                  </div>
                )}
                <div className={message.author === "user" ? "max-w-[80%] rounded-2xl bg-muted px-4 py-3" : "max-w-[85%] pt-1"}>
                  <p className="text-sm leading-6">{message.text}</p>
                  {message.files && message.files.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.files.map((file) => (
                        <span key={file} className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
                          <FileText size={12} /> {file}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles size={15} />
                </div>
                <p className="pt-1 text-sm text-muted-foreground">Consultando assistente...</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-0 left-56 right-0 bg-gradient-to-t from-background via-background to-transparent px-6 pb-5 pt-12">
        <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border bg-background p-2 shadow-lg">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2">
              {files.map((file) => (
                <span key={file.name} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                  <FileText size={12} />
                  {file.name}
                  <button onClick={() => setFiles((current) => current.filter((item) => item !== file))}>
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
              onClick={() => fileInputRef.current?.click()}
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
              placeholder="Pergunte sobre sua area ou anexe um documento..."
              className="max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => void submit()}
              disabled={sending || (!prompt.trim() && files.length === 0)}
              className="rounded-xl bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <Send size={17} />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Respostas devem ser validadas antes de orientar decisoes operacionais.
        </p>
      </div>
    </div>
  );
}
