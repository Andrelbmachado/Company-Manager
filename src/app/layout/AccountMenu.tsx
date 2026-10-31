import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronUp, CloudDownload, HeadphonesIcon, LogOut, Moon, Settings, UserRoundCog } from "lucide-react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout } from "@/lib/auth/login";
import { ROLE_LABELS, visibleModules } from "@/lib/permissions/rbac";
import { getTheme, saveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { useDismiss } from "./useDismiss";
import { NotificationsPanel, useUnreadNotifications } from "./NotificationsPanel";
import { isTauriRuntime } from "@/lib/db/client";
import { appUpdater, type UpdateState } from "@/lib/updater/updater";
import { useUpdateState } from "@/components/shared/updater/UpdatePanel";

const ITEM = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted";

/** Resultado curto ao lado de "Verificar atualizações" (a versão nova abre o aviso com o botão Atualizar). */
function updateHint(state: UpdateState): string | null {
  switch (state.status) {
    case "checking":
      return "Verificando…";
    case "upToDate":
      return "Atualizado";
    case "available":
      return `${state.availableVersion} disponível`;
    case "downloading":
    case "installing":
    case "done":
      return "Atualizando…";
    case "error":
      return "Erro";
    default:
      return null;
  }
}

/** Item "Verificar atualizações" do menu da conta (só no app desktop). */
function CheckUpdatesItem() {
  const updater = appUpdater();
  const state = useUpdateState(updater);
  const hint = updateHint(state);
  const busy = ["checking", "downloading", "installing", "done"].includes(state.status);
  return (
    <button type="button" onClick={() => void updater.check()} disabled={busy} className={cn(ITEM, "disabled:opacity-70")}>
      <CloudDownload size={15} className="shrink-0 text-muted-foreground" />
      <span className="flex-1">Verificar atualizações</span>
      {hint && (
        <span
          role="status"
          className={cn("shrink-0 text-xs", state.status === "available" ? "font-medium text-primary-text" : state.status === "error" ? "text-destructive" : "text-muted-foreground")}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

/**
 * Botão da conta no rodapé da sidebar (onde ficava o assistente). O menu abre para cima: nome e papel, Configurações
 * da conta, Notificações (com contador), switch Tema escuro, Verificar atualizações (desktop), Suporte, Trocar usuário e Sair.
 */
export function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const unread = useUnreadNotifications(session.company.id, session.user.id);
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, open, () => setOpen(false));
  const role = session.membership.role as Role;
  const modules = visibleModules(role);
  const initials = session.user.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name[0])
    .join("")
    .toUpperCase();

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  function signOut() {
    setOpen(false);
    logout();
    setSession(null);
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    saveTheme(next);
    setTheme(next);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Abrir menu da conta"
        aria-expanded={open}
        aria-controls="account-menu"
        data-rail-tip={collapsed ? session.user.name : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-sidebar-accent",
          collapsed && "justify-center px-0",
          open && "bg-sidebar-accent",
        )}
      >
        {/* Borda: no tema claro bg-muted e a sidebar são o mesmo cinza (93%) e o círculo sumia. */}
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-muted text-xs font-semibold text-foreground">
          {initials}
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-destructive" />}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-sidebar-accent-foreground">{session.user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{ROLE_LABELS[role]}</span>
            </span>
            <ChevronUp size={15} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </>
        )}
      </button>

      {/* Depois do botão no DOM (o CSS é que o põe acima): Tab a partir do botão entra no menu, na ordem. */}
      {open && (
        <div
          id="account-menu"
          aria-label="Conta"
          className={cn(
            "absolute z-50 w-72 overflow-y-auto overscroll-contain rounded-xl border bg-popover text-popover-foreground shadow-xl",
            // Janela pequena (até 1/5 × 1/3 da tela): o menu não passa da janela (o switch do tema ficava fora dela no
            // trilho e o topo sumia ao abrir para cima); o que não couber rola por dentro.
            collapsed
              ? "bottom-0 left-full ml-2 max-h-[calc(100vh-1rem)] max-w-[calc(100vw-4.5rem)]"
              : "bottom-full left-0 mb-2 max-h-[calc(100vh-5rem)] max-w-[calc(100vw-1.5rem)]",
          )}
        >
          <div className="border-b px-4 py-3">
            <p className="truncate text-sm font-semibold">{session.user.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{session.user.email}</p>
            <p className="mt-1 text-xs font-medium text-foreground">{ROLE_LABELS[role]}</p>
          </div>

          <div className="p-1.5">
            {modules.includes("settings") && (
              <button type="button" onClick={() => go("/settings")} className={ITEM}>
                <Settings size={15} className="shrink-0 text-muted-foreground" />
                Configurações da conta
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowNotifications((value) => !value)}
              aria-label="Notificações"
              aria-expanded={showNotifications}
              className={ITEM}
            >
              <Bell size={15} className="shrink-0 text-muted-foreground" />
              <span className="flex-1">Notificações</span>
              <span
                aria-label={unread ? `${unread} ${unread === 1 ? "não lida" : "não lidas"}` : "nenhuma não lida"}
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-caption font-semibold",
                  unread ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {unread}
              </span>
            </button>
            {showNotifications && <NotificationsPanel companyId={session.company.id} userId={session.user.id} onOpen={go} />}

            <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm">
              <Moon size={15} className="shrink-0 text-muted-foreground" />
              <span className="flex-1">Tema escuro</span>
              <button
                type="button"
                role="switch"
                aria-checked={theme === "dark"}
                aria-label="Tema escuro"
                onClick={toggleTheme}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
                  theme === "dark" ? "border-primary bg-primary" : "border-input bg-muted",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full transition-transform",
                    theme === "dark" ? "translate-x-[1.1rem] bg-primary-foreground" : "translate-x-0.5 bg-muted-foreground",
                  )}
                />
              </button>
            </div>

            {isTauriRuntime() && <CheckUpdatesItem />}

            {modules.includes("support") && (
              <button type="button" onClick={() => go("/support")} className={ITEM}>
                <HeadphonesIcon size={15} className="shrink-0 text-muted-foreground" />
                Suporte
              </button>
            )}
          </div>

          <div className="border-t p-1.5">
            <button type="button" onClick={signOut} className={ITEM}>
              <UserRoundCog size={15} className="shrink-0 text-muted-foreground" />
              Trocar usuário
            </button>
            <button type="button" onClick={signOut} className={cn(ITEM, "text-destructive hover:bg-destructive/10")}>
              <LogOut size={15} className="shrink-0" />
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
