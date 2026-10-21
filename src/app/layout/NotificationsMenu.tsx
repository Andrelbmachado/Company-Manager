import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { Menu } from "@/components/ui/Menu";
import { useRequiredSession } from "@/hooks/useSession";
import { listNotifications, markAllNotificationsRead } from "@/lib/data/notifications";
import { cn, formatDateTime } from "@/lib/utils";

export function NotificationsMenu() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const queryKey = ["notifications", session.company.id, session.user.id];
  const { data: items = [] } = useQuery({
    queryKey,
    queryFn: () => listNotifications(session),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: () => markAllNotificationsRead(session),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const unread = items.filter((n) => !n.is_read).length;

  return (
    <Menu
      testId="notifications-menu"
      className="w-80"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={unread ? `Notificações (${unread} não lidas)` : "Notificações"}
          data-testid="notifications-trigger"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
        >
          <Bell size={16} className="text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      )}
    >
      {() => (
        <>
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-medium">Notificações</span>
            {unread > 0 && (
              <button
                type="button"
                data-testid="notifications-mark-read"
                onClick={() => markRead.mutate()}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck size={12} />
                Marcar como lidas
              </button>
            )}
          </div>
          <div className="-mx-1 my-1 h-px bg-border" />
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="flex gap-2 rounded-md px-2 py-2 hover:bg-muted">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-primary")} />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug">{n.message}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Menu>
  );
}
