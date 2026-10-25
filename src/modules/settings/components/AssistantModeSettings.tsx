import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Terminal } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { hasAssistantApiConfig } from "@/lib/assistant/config";
import { CLAUDE_CODE_STATUS_KEY, getClaudeCodeStatus } from "@/lib/assistant/claudeCode";
import { ASSISTANT_MODES, getAssistantMode, resolveAssistantProvider, saveAssistantMode, type AssistantMode } from "@/lib/assistant/provider";
import { cn } from "@/lib/utils";

const IN_USE = { "claude-code": "Claude Code (local)", api: "API configurada", none: "nenhum" } as const;

/**
 * Configurações > Assistente IA: status do Claude Code instalado no Mac (responde sem chave de API) e qual provedor
 * o assistente usa. A escolha fica por usuário e vale na hora (lib/assistant/provider).
 */
export function AssistantModeSettings() {
  const session = useRequiredSession();
  const userId = session.user.id;
  const [mode, setMode] = useState<AssistantMode>(() => getAssistantMode(userId));
  const status = useQuery({ queryKey: CLAUDE_CODE_STATUS_KEY, queryFn: () => getClaudeCodeStatus(), staleTime: 60_000 });
  const claude = status.data;
  const resolved = resolveAssistantProvider(mode, claude, hasAssistantApiConfig(userId));

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Terminal size={16} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <span
                aria-hidden
                className={cn("h-2 w-2 shrink-0 rounded-full", claude?.available ? "bg-status-success" : "bg-muted-foreground/40")}
              />
              {status.isLoading ? "Procurando o Claude Code…" : claude?.available ? "Claude Code conectado" : "Claude Code não conectado"}
            </p>
            {claude && (
              <p className="truncate text-xs text-muted-foreground" title={claude.path ?? undefined}>
                {claude.available ? `Versão ${claude.version ?? "?"}` : claude.reason}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
          aria-label="Verificar o Claude Code de novo"
          title="Verificar o Claude Code de novo"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(status.isFetching && "animate-spin")} />
        </button>
      </div>
      <select
        value={mode}
        aria-label="Assistente usado"
        onChange={(event) => {
          const next = event.target.value as AssistantMode;
          saveAssistantMode(userId, next);
          setMode(next);
        }}
        className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {ASSISTANT_MODES.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">Em uso: {IN_USE[resolved.kind]}</p>
    </div>
  );
}
