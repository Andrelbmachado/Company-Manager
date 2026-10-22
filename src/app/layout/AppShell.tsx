import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { CommandMenu } from "./CommandMenu";
import { Bell, ChevronDown, HeadphonesIcon, LogOut, Moon, Settings, Sun, UserRound } from "lucide-react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { useProspectingBootstrap } from "@/hooks/useProspectingBootstrap";
import { logout } from "@/lib/auth/login";
import { ROLE_LABELS, visibleModules } from "@/lib/permissions/rbac";
import { getTheme, saveTheme, type Theme } from "@/lib/theme";
import type { Role } from "@/types";

export function AppShell() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<"notifications" | "account" | null>(null);
  const [notificationUnread, setNotificationUnread] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const menusRef = useRef<HTMLDivElement>(null);
  const session = useRequiredSession();
  const { setSession } = useSession();
  const navigate = useNavigate();
  useProspectingBootstrap();
  const canAccessSupport = visibleModules(session.membership.role as Role).includes("support");
  const initials = session.user.name
    .split(" ")
    .slice(0, 2)
    .map((name) => name[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      if (!menusRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    window.addEventListener("pointerdown", closeMenus);
    return () => window.removeEventListener("pointerdown", closeMenus);
  }, []);

  function handleLogout() {
    logout();
    setSession(null);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    saveTheme(nextTheme);
    setTheme(nextTheme);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6">
          <CommandMenu open={cmdOpen} onOpen={() => setCmdOpen(true)} onClose={() => setCmdOpen(false)} />

          <div ref={menusRef} className="relative flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
              title={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
              className="rounded-lg p-2 hover:bg-muted transition-colors"
            >
              {theme === "dark" ? <Sun size={16} className="text-muted-foreground" /> : <Moon size={16} className="text-muted-foreground" />}
            </button>
            <button
              onClick={() => setOpenMenu((menu) => menu === "notifications" ? null : "notifications")}
              aria-label="Notificacoes"
              className="relative rounded-lg p-2 hover:bg-muted transition-colors"
            >
              <Bell size={16} className="text-muted-foreground" />
              {notificationUnread && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-background bg-red-500" />}
            </button>
            <button
              onClick={() => setOpenMenu((menu) => menu === "account" ? null : "account")}
              aria-label="Abrir menu da conta"
              className="flex items-center gap-1 rounded-lg p-1 pr-1.5 hover:bg-muted transition-colors"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initials}
              </span>
              <ChevronDown size={13} className="text-muted-foreground" />
            </button>

            {openMenu === "notifications" && (
              <div className="absolute right-9 top-11 z-50 w-80 overflow-hidden rounded-xl border bg-popover shadow-xl">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="text-sm font-semibold">Notificacoes</p>
                  {notificationUnread && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">1 nova</span>}
                </div>
                <button
                  onClick={() => setNotificationUnread(false)}
                  className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/60"
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <span>
                    <span className="block text-sm font-medium">Novo ticket aguardando atendimento</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {session.membership.role === "tecnico"
                        ? "A equipe de Estoque abriu o ticket “Leitor de codigo sem conexao”."
                        : "Seu ticket “Acesso ao sistema interno” recebeu uma nova atualizacao."}
                    </span>
                    <span className="mt-2 block text-[11px] text-muted-foreground">Ha 8 minutos</span>
                  </span>
                </button>
                <button onClick={() => setNotificationUnread(false)} className="w-full border-t px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60">
                  Marcar todas como lidas
                </button>
              </div>
            )}

            {openMenu === "account" && (
              <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border bg-popover shadow-xl">
                <div className="border-b px-4 py-3">
                  <p className="truncate text-sm font-semibold">{session.user.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{session.user.email}</p>
                  <p className="mt-1 text-[11px] font-medium text-primary">{ROLE_LABELS[session.membership.role as Role]}</p>
                </div>
                <div className="p-1.5">
                  <button
                    onClick={() => { navigate("/settings"); setOpenMenu(null); }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                  >
                    <Settings size={15} className="text-muted-foreground" />
                    Configuracoes da conta
                  </button>
                  {canAccessSupport && (
                    <button
                      onClick={() => { navigate("/support"); setOpenMenu(null); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
                    >
                      <HeadphonesIcon size={15} className="text-muted-foreground" />
                      Suporte
                    </button>
                  )}
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10"
                  >
                    <LogOut size={15} />
                    Trocar usuario
                  </button>
                </div>
                <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
                  <UserRound size={13} />
                  Conta individual
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>

    </div>
  );
}
