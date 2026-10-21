import {
  Archive,
  FileText,
  FolderKanban,
  HeadphonesIcon,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  Target,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  /** Module key used by RBAC (`visibleModules`). */
  module: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: string;
}

/** Single source for the sidebar and the command menu. */
export const NAV_ITEMS: NavItem[] = [
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

export function isActivePath(itemPath: string, pathname: string): boolean {
  return itemPath === "/" ? pathname === "/" : pathname === itemPath || pathname.startsWith(itemPath + "/");
}
