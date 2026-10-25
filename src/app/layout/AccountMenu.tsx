import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronUp, HeadphonesIcon, LogOut, Moon, Settings, UserRoundCog } from "lucide-react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout } from "@/lib/auth/login";
import { ROLE_LABELS, visibleModules } from "@/lib/permissions/rbac";
import { getTheme, saveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { useDismiss } from "./useDismiss";

const ITEM = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted";

/**
 * Botão da conta no rodapé da sidebar (onde ficava o assistente). O menu abre para cima: nome e papel, Configurações
 * da conta, Notificações (com contador), switch Tema escuro, Suporte, Trocar usuário e Sair.
 */
export function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  // Mesma notificação de exemplo que ficava na top bar (a tabela notifications ainda não é alimentada por nada).
  const [unread, setUnread] = useState(1);
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
        title={collapsed ? session.user.name : undefined}
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
            "absolute z-50 w-72 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl",
            collapsed ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2",
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
                aria-label={unread ? `${unread} não lida` : "nenhuma não lida"}
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold",
                  unread ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {unread}
              </span>
            </button>
            {showNotifications && (
              <div className="mx-1 mb-1 overflow-hidden rounded-lg border bg-background">
                <button type="button" onClick={() => setUnread(0)} className="flex w-full gap-3 px-3 py-2.5 text-left hover:bg-muted/60">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", unread ? "bg-destructive" : "bg-muted-foreground/40")} />
                  <span>
                    <span className="block text-sm font-medium">Novo ticket aguardando atendimento</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {role === "tecnico"
                        ? "A equipe de Estoque abriu o ticket “Leitor de código sem conexão”."
                        : "Seu ticket “Acesso ao sistema interno” recebeu uma nova atualização."}
                    </span>
                    <span className="mt-1.5 block text-[11px] text-muted-foreground">Há 8 minutos</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setUnread(0)}
                  disabled={unread === 0}
                  className="w-full border-t px-3 py-2 text-center text-xs font-medium hover:bg-muted/60 disabled:text-muted-foreground disabled:hover:bg-transparent"
                >
                  Marcar todas como lidas
                </button>
              </div>
            )}

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
