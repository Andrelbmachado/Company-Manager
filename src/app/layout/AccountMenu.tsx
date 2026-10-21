import { useNavigate } from "react-router-dom";
import { ChevronDown, Command, LogOut, Monitor, Moon, Settings, Sun, User } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/Menu";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout } from "@/lib/auth/login";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { cn, initials } from "@/lib/utils";
import { useState } from "react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  tecnico: "Técnico",
  estoquista: "Estoquista",
  financeiro: "Financeiro",
  comercial: "Comercial",
  atendimento: "Atendimento",
  auditor: "Auditor",
};

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

export function AccountMenu({ onOpenCommand }: { onOpenCommand: () => void }) {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const role = ROLE_LABELS[session.membership.role] ?? session.membership.role;

  return (
    <Menu
      testId="account-menu"
      className="w-64"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label="Conta"
          data-testid="account-menu-trigger"
          className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-muted"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initials(session.user.name)}
          </span>
          <span className="hidden flex-col items-start leading-tight md:flex">
            <span className="max-w-[140px] truncate text-xs font-medium">{session.user.name}</span>
            <span className="text-[10px] text-muted-foreground">{role}</span>
          </span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
              {initials(session.user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
            </div>
          </div>
          <div className="px-2 pb-2 text-xs text-muted-foreground">
            {role} · {session.company.name}
          </div>
          <MenuSeparator />
          <MenuItem testId="account-profile" icon={<User size={14} />} onSelect={() => { close(); navigate("/settings"); }}>
            Meu perfil
          </MenuItem>
          <MenuItem testId="account-settings" icon={<Settings size={14} />} onSelect={() => { close(); navigate("/settings"); }}>
            Configurações
          </MenuItem>
          <MenuItem testId="account-command" icon={<Command size={14} />} hint="⌘K" onSelect={() => { close(); onOpenCommand(); }}>
            Busca rápida
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Tema</MenuLabel>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1" role="radiogroup" aria-label="Tema">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                data-testid={`theme-${value}`}
                onClick={() => {
                  setTheme(value);
                  setThemeState(value);
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border py-1.5 text-[11px] transition-colors",
                  theme === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            testId="account-logout"
            destructive
            icon={<LogOut size={14} />}
            onSelect={() => {
              close();
              logout();
              setSession(null);
            }}
          >
            Sair
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
