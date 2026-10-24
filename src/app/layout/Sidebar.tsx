import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import {
  LayoutDashboard,
  Users,
  Target,
  Megaphone,
  UserRound,
  UsersRound,
  HandCoins,
  Wrench,
  FolderKanban,
  Boxes,
  Package,
  Archive,
  Wallet,
  FileText,
  ShieldCheck,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  ShoppingCart,
  Tags,
  Truck,
  BarChart3,
  FileUp,
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
  { module: "hr", label: "Meu RH", path: "/hr", icon: UserRound, group: "Pessoas" },
  { module: "hr_manage", label: "Gestão de RH", path: "/hr/manage", icon: UsersRound, group: "Pessoas" },
  { module: "crm", label: "CRM", path: "/crm", icon: Users, group: "Comercial" },
  { module: "leads", label: "Prospecção", path: "/leads", icon: Megaphone, group: "Comercial" },
  { module: "opportunities", label: "Oportunidades", path: "/opportunities", icon: Target, group: "Comercial" },
  { module: "sales", label: "Vendas", path: "/sales", icon: ShoppingCart, group: "Comercial" },
  { module: "catalog", label: "Catálogo", path: "/catalog", icon: Tags, group: "Comercial" },
  { module: "operations", label: "Ordens de Serviço", path: "/work-orders", icon: Wrench, group: "Operações" },
  { module: "projects", label: "Project Manager", path: "/projects", icon: FolderKanban, group: "Operações" },
  { module: "products", label: "Desenv. de Produtos", path: "/products", icon: Boxes, group: "Produto" },
  { module: "inventory", label: "Estoque", path: "/inventory", icon: Package, group: "Logística" },
  { module: "custody", label: "Custódia de peça", path: "/custody", icon: Archive, group: "Logística" },
  { module: "purchasing", label: "Compras", path: "/purchasing", icon: Truck, group: "Logística" },
  { module: "finance", label: "Financeiro", path: "/finance", icon: Wallet, group: "Gestão" },
  { module: "payroll", label: "Folha de pagamento", path: "/payroll", icon: HandCoins, group: "Gestão" },
  { module: "documents", label: "Documentos", path: "/documents", icon: FileText, group: "Gestão" },
  { module: "reports", label: "Relatórios", path: "/reports", icon: BarChart3, group: "Gestão" },
  { module: "imports", label: "Importar dados", path: "/imports", icon: FileUp, group: "Gestão" },
  { module: "audit", label: "Auditoria", path: "/audit", icon: ShieldCheck, group: "Gestão" },
];

const SIDEBAR_WIDTH_KEY = "cm_sidebar_width";
const SIDEBAR_COLLAPSED_KEY = "cm_sidebar_collapsed";
const DEFAULT_WIDTH = 269;
const MIN_WIDTH = 230;
const COLLAPSED_WIDTH = 68;

export function Sidebar() {
  const session = useRequiredSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [width, setWidth] = useState(() => clampSidebarWidth(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || DEFAULT_WIDTH));
  const [resizing, setResizing] = useState(false);
  const allowed = new Set(visibleModules(session.membership.role as Role));

  const visible = NAV_ITEMS.filter((item) => allowed.has(item.module));
  const assistantVisible = allowed.has("assistant");

  const groups: Record<string, NavItem[]> = {};
  for (const item of visible) {
    (groups[item.group] ??= []).push(item);
  }

  useEffect(() => {
    function clampOnResize() {
      setWidth((currentWidth) => {
        const nextWidth = clampSidebarWidth(currentWidth);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
        return nextWidth;
      });
    }
    window.addEventListener("resize", clampOnResize);
    return () => window.removeEventListener("resize", clampOnResize);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    function handlePointerMove(event: PointerEvent) {
      const nextWidth = clampSidebarWidth(event.clientX);
      setWidth(nextWidth);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
    }
    function handlePointerUp() {
      setResizing(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizing]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(!current));
      return !current;
    });
  }

  return (
    <aside
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
      className={cn("relative flex h-full shrink-0 flex-col border-r bg-sidebar select-none", !resizing && "transition-[width] duration-200")}
    >
      {/* Logo */}
      <div className={cn("flex h-[4.2rem] shrink-0 items-center gap-2.5 border-b", collapsed ? "justify-center px-2.5" : "px-3.5")}>
        <div className={cn("h-8 w-8 items-center justify-center rounded-lg bg-primary", collapsed ? "hidden" : "flex")}>
          <Building2 size={17} className="text-primary-foreground" />
        </div>
        <div className={cn("min-w-0 flex-1 flex-col leading-tight", collapsed ? "hidden" : "flex")}>
          <span className="truncate font-display text-lg font-bold tracking-tight text-sidebar-accent-foreground">Company Manager</span>
        </div>
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expandir sidebar" : "Minimizar sidebar"}
          aria-label={collapsed ? "Expandir sidebar" : "Minimizar sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="mb-5 space-y-1">
            <p className={cn("px-2.5 pb-1.5 text-xs font-semibold text-muted-foreground", collapsed && "hidden")}>
              {group}
            </p>
            {items.map((item) => {
              const Icon = item.icon;
              const exact = item.path === "/" || item.path === "/hr";
              const active = exact ? location.pathname === item.path : location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.95rem] transition-colors",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {assistantVisible && (
        <div className="border-t p-2.5">
          <NavLink
            to="/assistant"
            title={collapsed ? "Assistente IA" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[0.95rem] transition-colors",
              collapsed && "justify-center px-0",
              location.pathname.startsWith("/assistant")
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            <Sparkles size={18} className="shrink-0" />
            {!collapsed && "Assistente IA"}
          </NavLink>
        </div>
      )}
      {!collapsed && (
        <button
          type="button"
          aria-label="Redimensionar sidebar"
          title="Arraste para redimensionar"
          onPointerDown={() => setResizing(true)}
          className={cn("absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize transition-colors hover:bg-primary/50", resizing && "bg-primary/60")}
        />
      )}
    </aside>
  );
}

function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), Math.floor(window.innerWidth * 0.33));
}
