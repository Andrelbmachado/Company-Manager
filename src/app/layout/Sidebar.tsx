import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { can, visibleModules } from "@/lib/permissions/rbac";
import { useAreaLabels } from "@/lib/labels/useLabel";
import type { LabelKey } from "@/lib/labels/profiles";
import { activeNavPath, type Requirement } from "../subpages";
import { AccountMenu } from "./AccountMenu";
import { AssistantLauncher } from "./AssistantLauncher";
import { RailTooltips } from "./RailTooltips";
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
/** Largura do trilho de ícones (sidebar recolhida). */
export const RAIL_WIDTH = 56;
/** Abaixo desta largura de janela a sidebar vira trilho sozinha; expandida, abre por cima do conteúdo. */
export const AUTO_RAIL_BELOW = 900;

/**
 * Sidebar: logo, busca, Assistente de IA, navegação por grupo e, no rodapé, o botão da conta (não há top bar).
 * Recolhida, vira um trilho só com os ícones (com nome acessível e dica ao lado); a escolha fica salva. Em janela
 * estreita ela recolhe sozinha sem mudar a escolha salva, e expandir abre a sidebar por cima do conteúdo.
 */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const session = useRequiredSession();
  const location = useLocation();
  const asideRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(() => readStored(SIDEBAR_COLLAPSED_KEY) === "true");
  const [width, setWidth] = useState(() => clampSidebarWidth(Number(readStored(SIDEBAR_WIDTH_KEY)) || DEFAULT_WIDTH));
  const [narrow, setNarrow] = useState(() => isNarrowWindow());
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const { label } = useAreaLabels();
  const role = session.membership.role as Role;
  const allowed = new Set(visibleModules(role));
  const overlay = narrow && overlayOpen;
  const rail = narrow ? !overlayOpen : collapsed;

  const visible = NAV_ITEMS.filter((item) => allowed.has(item.module) && (item.requires ?? []).every((need) => can(role, need.action ?? "view", need.resource)));
  // Item ativo: o caminho mais longo que contém a URL (/hr/banco-de-horas acende Meu RH; /hr/manage/..., Gestão de RH).
  const activePath = activeNavPath(visible.map((item) => item.path), location.pathname);
  const assistantVisible = allowed.has("assistant");

  const groups: Record<string, NavItem[]> = {};
  for (const item of visible) {
    (groups[item.group] ??= []).push(item);
  }

  useEffect(() => {
    function onResize() {
      setNarrow(isNarrowWindow());
      setWidth((currentWidth) => {
        const nextWidth = clampSidebarWidth(currentWidth);
        writeStored(SIDEBAR_WIDTH_KEY, String(nextWidth));
        return nextWidth;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A sidebar por cima do conteúdo fecha ao alargar a janela, ao navegar e com Esc.
  useEffect(() => {
    if (!narrow) setOverlayOpen(false);
  }, [narrow]);
  useEffect(() => {
    setOverlayOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!overlay) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOverlayOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay]);

  useEffect(() => {
    if (!resizing) return;

    function handlePointerMove(event: PointerEvent) {
      const nextWidth = clampSidebarWidth(event.clientX);
      setWidth(nextWidth);
      writeStored(SIDEBAR_WIDTH_KEY, String(nextWidth));
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
    // Em janela estreita o botão só abre/fecha a sidebar por cima; a escolha salva vale para a janela larga.
    if (narrow) {
      setOverlayOpen((open) => !open);
      return;
    }
    setCollapsed((current) => {
      writeStored(SIDEBAR_COLLAPSED_KEY, String(!current));
      return !current;
    });
  }

  const toggleLabel = rail ? "Expandir sidebar" : "Minimizar sidebar";
  const asideWidth = rail ? RAIL_WIDTH : overlay ? Math.min(Math.max(width, MIN_WIDTH), window.innerWidth - 40) : width;

  return (
    <>
      {/* Por cima do conteúdo: o espaço do trilho segura o lugar (o conteúdo não pula) e o fundo fecha ao clicar. */}
      {overlay && <div data-sidebar-spacer="" aria-hidden="true" style={{ width: RAIL_WIDTH }} className="h-full shrink-0" />}
      {overlay && <div aria-hidden="true" onClick={() => setOverlayOpen(false)} className="fixed inset-0 z-30 bg-black/40" />}
      <aside
        ref={asideRef}
        data-rail={rail ? "" : undefined}
        data-overlay={overlay ? "" : undefined}
        style={{ width: asideWidth }}
        className={cn(
          "relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar select-none",
          overlay && "fixed inset-y-0 left-0 z-40 shadow-2xl",
          !resizing && "transition-[width] duration-200",
        )}
      >
        {/* Alça de redimensionar: primeira no DOM (posição absoluta), para o botão da conta ser o último da sidebar. */}
        {!rail && !overlay && (
          <button
            type="button"
            aria-label="Redimensionar sidebar"
            title="Arraste para redimensionar"
            onPointerDown={() => setResizing(true)}
            className={cn("absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize transition-colors hover:bg-primary/40", resizing && "bg-primary/50")}
          />
        )}

        {/* Logo */}
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5", rail ? "justify-center px-2" : "px-3.5")}>
          <div className={cn("h-7 w-7 items-center justify-center rounded-lg bg-primary", rail ? "hidden" : "flex")}>
            <Building2 size={15} className="text-primary-foreground" />
          </div>
          <div className={cn("min-w-0 flex-1 flex-col leading-tight", rail ? "hidden" : "flex")}>
            <span className="truncate font-display text-base font-bold tracking-tight text-sidebar-accent-foreground">Company Manager</span>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={toggleLabel}
            aria-expanded={!rail}
            data-rail-tip={rail ? toggleLabel : undefined}
            title={rail ? undefined : toggleLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {rail ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        {/* Busca e Assistente de IA, acima da navegação */}
        <div className={cn("space-y-1 pb-2", rail ? "px-2" : "px-2.5")}>
          <SidebarSearch collapsed={rail} onOpen={onSearch} />
          {assistantVisible && <AssistantLauncher collapsed={rail} />}
        </div>

        {/* Nav */}
        {/* No trilho a barra de rolagem fica escondida: ocuparia 8 px dos 40 e tiraria os ícones do centro. */}
        <nav
          aria-label="Módulos"
          className={cn("flex-1 overflow-y-auto overscroll-contain py-3", rail ? "px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "px-2.5")}
        >
          {Object.entries(groups).map(([group, items]) => (
            // relative: o título sr-only do grupo (absoluto) fica dentro da lista que rola, não estica a sidebar.
            <div key={group} className={cn("relative space-y-1", rail ? "mb-3 border-b border-sidebar-border pb-3 last:mb-0 last:border-b-0 last:pb-0" : "mb-5")}>
              <p className={cn("px-2.5 pb-1.5 text-xs font-semibold text-muted-foreground", rail && "sr-only")}>
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
                    data-rail-tip={rail ? text : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      rail && "h-9 justify-center px-0 py-0",
                      active
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon size={rail ? 18 : 16} className="shrink-0" aria-hidden="true" />
                    <span className={rail ? "sr-only" : "min-w-0 truncate"}>{text}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Conta (no lugar onde ficava o assistente) */}
        <div className={cn("border-t border-sidebar-border", rail ? "p-2" : "p-2.5")}>
          <AccountMenu collapsed={rail} />
        </div>
      </aside>
      <RailTooltips container={asideRef} enabled={rail} />
    </>
  );
}

function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), Math.floor(window.innerWidth * 0.33));
}

function isNarrowWindow(): boolean {
  return window.innerWidth < AUTO_RAIL_BELOW;
}

// localStorage pode falhar (janela privada, armazenamento bloqueado): a sidebar abre no padrão e segue funcionando.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: a escolha vale só nesta sessão
  }
}
