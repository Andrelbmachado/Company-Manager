import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRequiredSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { Command } from "cmdk";
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
  Sparkles,
} from "lucide-react";

const COMMANDS = [
  { module: "dashboard", label: "Dashboard", path: "/", icon: LayoutDashboard },
  { module: "crm", label: "CRM / Clientes", path: "/crm", icon: Users },
  { module: "opportunities", label: "Oportunidades", path: "/opportunities", icon: Target },
  { module: "support", label: "Suporte / Tickets", path: "/support", icon: HeadphonesIcon },
  { module: "operations", label: "Ordens de Serviço", path: "/work-orders", icon: Wrench },
  { module: "projects", label: "Projetos", path: "/projects", icon: FolderKanban },
  { module: "inventory", label: "Estoque", path: "/inventory", icon: Package },
  { module: "custody", label: "Custódia", path: "/custody", icon: Archive },
  { module: "finance", label: "Financeiro", path: "/finance", icon: Wallet },
  { module: "documents", label: "Documentos", path: "/documents", icon: FileText },
  { module: "audit", label: "Auditoria", path: "/audit", icon: ShieldCheck },
  { module: "settings", label: "Configurações", path: "/settings", icon: Settings },
  { module: "assistant", label: "Assistente IA", path: "/assistant", icon: Sparkles },
];

interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
}

export function CommandMenu({ open, onClose }: CommandMenuProps) {
  const navigate = useNavigate();
  const session = useRequiredSession();
  const [search, setSearch] = useState("");
  const allowed = new Set(visibleModules(session.membership.role as Role));

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <div className="flex items-center border-b px-3">
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Buscar módulos e ações..."
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado.
            </Command.Empty>
            <Command.Group heading="Navegar">
              {COMMANDS.filter((cmd) => allowed.has(cmd.module)).map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <Command.Item
                    key={cmd.path}
                    value={cmd.label}
                    onSelect={() => {
                      navigate(cmd.path);
                      onClose();
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent data-[selected]:bg-accent"
                  >
                    <Icon size={14} className="text-muted-foreground" />
                    {cmd.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground flex gap-4">
            <span>↑↓ navegar</span>
            <span>↵ selecionar</span>
            <span>esc fechar</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
