import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import {
  LayoutDashboard,
  Users,
  Target,
  HeadphonesIcon,
  Wrench,
  FolderKanban,
  Package,
  Archive,
  Wallet,
  FileText,
  Settings,
  ShieldCheck,
  Building2,
} from "lucide-react";

interface NavItem {
  module: string;
  label: string;
  path: string;
  icon: React.ElementType;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { module: "dashboard", label: "Dashboard", path: "/", icon: LayoutDashboard, group: "Visão Geral" },
  { module: "crm", label: "CRM", path: "/crm", icon: Users, group: "Comercial" },
  { module: "crm", label: "Oportunidades", path: "/opportunities", icon: Target, group: "Comercial" },
  { module: "support", label: "Suporte", path: "/support", icon: HeadphonesIcon, group: "Operações" },
  { module: "operations", label: "Ordens de Serviço", path: "/work-orders", icon: Wrench, group: "Operações" },
  { module: "projects", label: "Projetos", path: "/projects", icon: FolderKanban, group: "Operações" },
  { module: "inventory", label: "Estoque", path: "/inventory", icon: Package, group: "Logística" },
  { module: "custody", label: "Custódia", path: "/custody", icon: Archive, group: "Logística" },
  { module: "finance", label: "Financeiro", path: "/finance", icon: Wallet, group: "Gestão" },
  { module: "documents", label: "Documentos", path: "/documents", icon: FileText, group: "Gestão" },
  { module: "audit", label: "Auditoria", path: "/audit", icon: ShieldCheck, group: "Gestão" },
  { module: "settings", label: "Configurações", path: "/settings", icon: Settings, group: "Sistema" },
];

export function Sidebar() {
  const session = useRequiredSession();
  const location = useLocation();
  const allowed = new Set(visibleModules(session.membership.role as Role));

  const visible = NAV_ITEMS.filter((item) => allowed.has(item.module));

  const groups: Record<string, NavItem[]> = {};
  for (const item of visible) {
    (groups[item.group] ??= []).push(item);
  }

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-sidebar select-none">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Building2 size={14} className="text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-foreground">Company</span>
          <span className="text-xs text-muted-foreground truncate max-w-[100px]">
            {session.company.name}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="mb-4">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group}
            </p>
            {items.map((item) => {
              const Icon = item.icon;
              const active =
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon size={15} className="shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t p-3">
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/60 cursor-pointer">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {session.user.name
              .split(" ")
              .slice(0, 2)
              .map((n) => n[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium truncate">{session.user.name}</span>
            <span className="text-[10px] text-muted-foreground capitalize">
              {session.membership.role}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
