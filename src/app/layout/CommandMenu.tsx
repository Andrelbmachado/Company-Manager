import { useNavigate } from "react-router-dom";
import { useRequiredSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { SUBPAGES, canOpenSubpage, isDetailPage, sectionOf } from "../subpages";
import { Command } from "cmdk";
import { useModalFocus } from "@/components/shared/useModalFocus";
import {
  LayoutDashboard,
  Users,
  Target,
  Megaphone,
  UserRound,
  UsersRound,
  HandCoins,
  HeadphonesIcon,
  Wrench,
  FolderKanban,
  Boxes,
  Package,
  Archive,
  Wallet,
  FileText,
  Settings,
  ShieldCheck,
  Sparkles,
  Search,
  ShoppingCart,
  Tags,
  Truck,
  BarChart3,
  FileUp,
} from "lucide-react";

const COMMANDS = [
  { module: "dashboard", label: "Dashboard", path: "/", icon: LayoutDashboard },
  { module: "hr", label: "Meu RH", path: "/hr", icon: UserRound },
  { module: "hr_manage", label: "Gestão de RH", path: "/hr/manage", icon: UsersRound },
  { module: "crm", label: "CRM / Clientes", path: "/crm", icon: Users },
  { module: "leads", label: "Prospecção de Sites", path: "/leads", icon: Megaphone },
  { module: "opportunities", label: "Oportunidades", path: "/opportunities", icon: Target },
  { module: "sales", label: "Vendas (pedidos e faturas)", path: "/sales", icon: ShoppingCart },
  { module: "catalog", label: "Catálogo de produtos e serviços", path: "/catalog", icon: Tags },
  { module: "support", label: "Suporte / Tickets", path: "/support", icon: HeadphonesIcon },
  { module: "operations", label: "Ordens de Serviço", path: "/work-orders", icon: Wrench },
  { module: "projects", label: "Project Manager (projetos)", path: "/projects", icon: FolderKanban },
  { module: "products", label: "Desenvolvimento de Produtos", path: "/products", icon: Boxes },
  { module: "inventory", label: "Estoque", path: "/inventory", icon: Package },
  { module: "custody", label: "Custódia de peça", path: "/custody", icon: Archive },
  { module: "purchasing", label: "Compras (pedidos e recebimento)", path: "/purchasing", icon: Truck },
  { module: "finance", label: "Financeiro", path: "/finance", icon: Wallet },
  { module: "payroll", label: "Folha de pagamento", path: "/payroll", icon: HandCoins },
  { module: "documents", label: "Documentos", path: "/documents", icon: FileText },
  { module: "reports", label: "Relatórios", path: "/reports", icon: BarChart3 },
  { module: "imports", label: "Importar dados (planilhas)", path: "/imports", icon: FileUp },
  { module: "audit", label: "Auditoria", path: "/audit", icon: ShieldCheck },
  { module: "settings", label: "Configurações", path: "/settings", icon: Settings },
  { module: "assistant", label: "Assistente de IA (nova conversa)", path: "/assistant", icon: Sparkles },
];

const MODULE_ICONS = new Map(COMMANDS.map((cmd) => [cmd.module, cmd.icon]));

/** Subpáginas de lista do registro (src/app/subpages.ts) que o papel abre: "Módulo › Página", com o ícone do módulo. */
function subpageCommands(role: Role) {
  return SUBPAGES.filter((page) => !isDetailPage(page) && canOpenSubpage(role, page)).map((page) => ({
    module: page.module,
    label: `${sectionOf(page.module)?.title ?? page.module} › ${page.label}`,
    path: page.path,
    icon: MODULE_ICONS.get(page.module) ?? Search,
  }));
}

interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
}

/** Busca (módulos e páginas que o papel abre). Aberta pelo botão Buscar da sidebar ou por ⌘K / Ctrl+K. */
export function CommandMenu({ open, onClose }: CommandMenuProps) {
  if (!open) return null;
  return <CommandPalette onClose={onClose} />;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const session = useRequiredSession();
  const panel = useModalFocus<HTMLDivElement>(onClose);
  const role = session.membership.role as Role;
  const allowed = new Set(visibleModules(role));
  const commands = [...COMMANDS.filter((cmd) => allowed.has(cmd.module)), ...subpageCommands(role)];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-4 pt-[14vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Buscar" className="w-full max-w-xl overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <Command shouldFilter className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <div className="flex items-center gap-2 border-b px-4">
            <Search size={16} className="shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Buscar módulos e páginas..."
              className="flex h-12 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">esc</kbd>
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado.
            </Command.Empty>
            <Command.Group heading="Navegar">
              {commands.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <Command.Item
                    key={cmd.path}
                    value={cmd.label}
                    onSelect={() => {
                      navigate(cmd.path);
                      onClose();
                    }}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-accent data-[selected=true]:bg-accent"
                  >
                    <Icon size={15} className="text-muted-foreground" />
                    {cmd.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
          <div className="flex gap-4 border-t px-3 py-2 text-[10px] text-muted-foreground">
            <span>↑↓ navegar</span>
            <span>↵ selecionar</span>
            <span>esc fechar</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
