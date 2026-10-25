import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { can, visibleModules } from "@/lib/permissions/rbac";
import { useAreaLabels } from "@/lib/labels/useLabel";
import type { LabelKey } from "@/lib/labels/profiles";
import { activeNavPath, type Requirement } from "../subpages";
import { AccountMenu } from "./AccountMenu";
import { AssistantLauncher } from "./AssistantLauncher";
import { SidebarSearch } from "./SidebarSearch";
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
  ShoppingCart,
  Tags,
  Truck,
  BarChart3,
  FileUp,
  CalendarDays,
  Factory,
} from "lucide-react";

interface NavItem {
  module: string;
  /** Nome do item: vem do perfil de área (Configurações > Área da empresa), com o texto padrão de profiles.ts. */
  labelKey: LabelKey;
  path: string;
  icon: React.ElementType;
  group: string;
  /** Permissões além de ver o módulo (item que aponta para uma subpágina, como Fornecedores). */
  requires?: readonly Requirement[];
}

const NAV_ITEMS: NavItem[] = [
  { module: "dashboard", labelKey: "module.dashboard", path: "/", icon: LayoutDashboard, group: "Visão Geral" },
  { module: "calendar", labelKey: "module.calendar", path: "/calendar", icon: CalendarDays, group: "Visão Geral" },
  { module: "hr", labelKey: "module.hr", path: "/hr", icon: UserRound, group: "Pessoas" },
  { module: "hr_manage", labelKey: "module.hr_manage", path: "/hr/manage", icon: UsersRound, group: "Pessoas" },
  { module: "crm", labelKey: "module.crm", path: "/crm", icon: Users, group: "Comercial" },
  { module: "leads", labelKey: "module.leads", path: "/leads", icon: Megaphone, group: "Comercial" },
  { module: "opportunities", labelKey: "module.opportunities", path: "/opportunities", icon: Target, group: "Comercial" },
  { module: "sales", labelKey: "module.sales", path: "/sales", icon: ShoppingCart, group: "Comercial" },
  { module: "catalog", labelKey: "module.catalog", path: "/catalog", icon: Tags, group: "Comercial" },
  { module: "operations", labelKey: "module.operations", path: "/work-orders", icon: Wrench, group: "Operações" },
  { module: "projects", labelKey: "module.projects", path: "/projects", icon: FolderKanban, group: "Operações" },
  { module: "products", labelKey: "module.products", path: "/products", icon: Boxes, group: "Produto" },
  { module: "inventory", labelKey: "module.inventory", path: "/inventory", icon: Package, group: "Logística" },
  { module: "custody", labelKey: "module.custody", path: "/custody", icon: Archive, group: "Logística" },
  { module: "purchasing", labelKey: "module.purchasing", path: "/purchasing", icon: Truck, group: "Logística" },
  // Lista de fornecedores das Compras (subpágina /purchasing/fornecedores), com atalho próprio em Logística.
  { module: "purchasing", labelKey: "module.suppliers", path: "/purchasing/fornecedores", icon: Factory, group: "Logística", requires: [{ resource: "suppliers" }] },
  { module: "finance", labelKey: "module.finance", path: "/finance", icon: Wallet, group: "Gestão" },
  { module: "payroll", labelKey: "module.payroll", path: "/payroll", icon: HandCoins, group: "Gestão" },
  { module: "documents", labelKey: "module.documents", path: "/documents", icon: FileText, group: "Gestão" },
  { module: "reports", labelKey: "module.reports", path: "/reports", icon: BarChart3, group: "Gestão" },
  { module: "imports", labelKey: "module.imports", path: "/imports", icon: FileUp, group: "Gestão" },
  { module: "audit", labelKey: "module.audit", path: "/audit", icon: ShieldCheck, group: "Gestão" },
];

const SIDEBAR_WIDTH_KEY = "cm_sidebar_width";
const SIDEBAR_COLLAPSED_KEY = "cm_sidebar_collapsed";
const DEFAULT_WIDTH = 269;
const MIN_WIDTH = 230;
const COLLAPSED_WIDTH = 68;

/** Sidebar: logo, busca, Assistente de IA, navegação por grupo e, no rodapé, o botão da conta (não há top bar). */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const session = useRequiredSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [width, setWidth] = useState(() => clampSidebarWidth(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || DEFAULT_WIDTH));
  const [resizing, setResizing] = useState(false);
  const { label } = useAreaLabels();
  const role = session.membership.role as Role;
  const allowed = new Set(visibleModules(role));

  const visible = NAV_ITEMS.filter((item) => allowed.has(item.module) && (item.requires ?? []).every((need) => can(role, need.action ?? "view", need.resource)));
  // Item ativo: o caminho mais longo que contém a URL (/hr/banco-de-horas acende Meu RH; /hr/manage/..., Gestão de RH).
  const activePath = activeNavPath(visible.map((item) => item.path), location.pathname);
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
      className={cn("relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar select-none", !resizing && "transition-[width] duration-200")}
    >
      {/* Alça de redimensionar: primeira no DOM (posição absoluta), para o botão da conta ser o último da sidebar. */}
      {!collapsed && (
        <button
          type="button"
          aria-label="Redimensionar sidebar"
          title="Arraste para redimensionar"
          onPointerDown={() => setResizing(true)}
          className={cn("absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize transition-colors hover:bg-primary/40", resizing && "bg-primary/50")}
        />
      )}

      {/* Logo */}
      <div className={cn("flex h-[4.2rem] shrink-0 items-center gap-2.5", collapsed ? "justify-center px-2.5" : "px-3.5")}>
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

      {/* Busca e Assistente de IA, acima da navegação */}
      <div className="space-y-1 px-2.5 pb-2">
        <SidebarSearch collapsed={collapsed} onOpen={onSearch} />
        {assistantVisible && <AssistantLauncher collapsed={collapsed} />}
      </div>

      {/* Nav */}
      <nav aria-label="Módulos" className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="mb-5 space-y-1">
            <p className={cn("px-2.5 pb-1.5 text-xs font-semibold text-muted-foreground", collapsed && "hidden")}>
              {group}
            </p>
            {items.map((item) => {
              const Icon = item.icon;
              const active = item.path === activePath;
              const text = label(item.labelKey);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={collapsed ? text : undefined}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.95rem] transition-colors",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && text}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Conta (no lugar onde ficava o assistente) */}
      <div className="border-t border-sidebar-border p-2.5">
        <AccountMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}

function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), Math.floor(window.innerWidth * 0.33));
}
