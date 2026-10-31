import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { listNotifications, markRead, notificationsQueryKey, unreadCount } from "@/lib/notifications/notifications";
import { cn } from "@/lib/utils";

/** "há 8 minutos", "há 3 horas", "há 2 dias" (o banco grava em ISO; o datetime('now') do SQLite vem sem fuso, em UTC). */
export function timeAgo(iso: string, now = new Date()): string {
  const value = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(value)) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - value) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

/** Não lidas da pessoa (bolinha no avatar e contador do item Notificações). */
export function useUnreadNotifications(companyId: string, userId: string): number {
  const { data = 0 } = useQuery({
    queryKey: [...notificationsQueryKey(companyId, userId), "unread"],
    queryFn: async () => unreadCount(await getDb(), companyId, userId),
    refetchInterval: 60_000,
  });
  return data;
}

/**
 * Lista das notificações dentro do menu da conta: comunicados do RH, decisões e pendências. Clicar marca como lida e abre
 * a tela da notificação; "Marcar todas como lidas" no rodapé.
 */
export function NotificationsPanel({ companyId, userId, onOpen }: { companyId: string; userId: string; onOpen: (path: string) => void }) {
  const qc = useQueryClient();
  const key = notificationsQueryKey(companyId, userId);
  const { data: items = [], isLoading, isError } = useQuery({
    queryKey: [...key, "list"],
    queryFn: async () => listNotifications(await getDb(), companyId, userId),
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: async (id?: string) => markRead(await getDb(), companyId, userId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const unread = items.filter((item) => !item.is_read).length;

  return (
    <div className="mx-1 mb-1 overflow-hidden rounded-lg border bg-background">
      {isLoading && <p className="px-3 py-2.5 text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="px-3 py-2.5 text-sm text-destructive">Não foi possível carregar as notificações.</p>}
      {!isLoading && !isError && items.length === 0 && <p className="px-3 py-2.5 text-sm text-muted-foreground">Nenhuma notificação.</p>}
      <ul className="max-h-80 divide-y overflow-y-auto overscroll-contain">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                if (!item.is_read) read.mutate(item.id);
                if (item.link) onOpen(item.link);
              }}
              className="flex w-full gap-3 px-3 py-2.5 text-left hover:bg-muted/60"
            >
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.is_read ? "bg-muted-foreground/40" : "bg-destructive")} aria-hidden="true" />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{item.title || item.message}</span>
                  {item.important ? <span className="shrink-0 rounded bg-destructive/10 px-1.5 text-caption font-semibold text-destructive">Importante</span> : null}
                </span>
                {item.title && <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{item.message}</span>}
                <span className="mt-1.5 block text-caption text-muted-foreground">{timeAgo(item.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => read.mutate(undefined)}
        disabled={unread === 0 || read.isPending}
        className="w-full border-t px-3 py-2 text-center text-xs font-medium hover:bg-muted/60 disabled:text-muted-foreground disabled:hover:bg-transparent"
      >
        Marcar todas como lidas
      </button>
    </div>
  );
}
