import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, MessageSquare, Plus, Sparkles } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { conversationsQueryKey, listConversations } from "@/lib/assistant/conversations";
import { cn } from "@/lib/utils";
import { useDismiss } from "./useDismiss";

/** Quantas conversas recentes o menu mostra. */
const RECENT_LIMIT = 8;

/**
 * "Assistente de IA" na sidebar, acima do Dashboard: menu com "Nova conversa" (vai para /assistant; a conversa é
 * criada na primeira pergunta) e as últimas conversas da pessoa (cada uma abre /assistant/:id).
 */
export function AssistantLauncher({ collapsed }: { collapsed: boolean }) {
  const session = useRequiredSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, open, () => setOpen(false));
  const companyId = session.company.id;
  const userId = session.user.id;
  const conversations = useQuery({
    queryKey: conversationsQueryKey(companyId, userId),
    queryFn: async () => listConversations(await getDb(), companyId, userId),
    enabled: open,
  });
  const recent = (conversations.data ?? []).slice(0, RECENT_LIMIT);
  const active = pathname === "/assistant" || pathname.startsWith("/assistant/");

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Assistente de IA"
        aria-expanded={open}
        aria-controls="assistant-menu"
        title={collapsed ? "Assistente de IA" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.95rem] transition-colors",
          collapsed && "justify-center px-0",
          active
            ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Sparkles size={18} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Assistente de IA</span>
            <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </>
        )}
      </button>

      {open && (
        <div
          id="assistant-menu"
          aria-label="Conversas do assistente"
          className={cn(
            "absolute z-50 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl",
            collapsed ? "left-full top-0 ml-2 w-64" : "left-0 right-0 top-full mt-1",
          )}
        >
          <div className="p-1.5">
            <button
              type="button"
              onClick={() => go("/assistant")}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted"
            >
              <Plus size={15} className="shrink-0 text-muted-foreground" />
              Nova conversa
            </button>
          </div>
          <div className="border-t p-1.5">
            <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-muted-foreground">Recentes</p>
            {conversations.isLoading && <p className="px-2.5 py-2 text-sm text-muted-foreground">Carregando…</p>}
            {conversations.isError && <p className="px-2.5 py-2 text-sm text-destructive">Não foi possível carregar as conversas.</p>}
            {conversations.isSuccess && recent.length === 0 && (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
            )}
            {recent.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => go(`/assistant/${conversation.id}`)}
                aria-current={pathname === `/assistant/${conversation.id}` ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted",
                  pathname === `/assistant/${conversation.id}` && "bg-muted font-medium",
                )}
              >
                <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{conversation.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
