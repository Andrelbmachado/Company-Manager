// Botões de barra de tabela só com ícone: o nome vai no aria-label e a dica no title. O nome também fica num texto
// sr-only dentro do botão (invisível): seletores por texto exato ("Editar") das telas e dos testes continuam valendo.
// Ícones padrão do app: Editar = lápis saindo do quadrado (SquarePen), Adicionar = +, Atualizar = setas em círculo,
// Filtrar = linhas de filtro, Salvar = disquete, Cancelar = X.
import type { ButtonHTMLAttributes } from "react";
import { ListFilter, Plus, RefreshCw, Save, SquarePen, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const TABLE_ICONS = {
  edit: SquarePen,
  add: Plus,
  refresh: RefreshCw,
  filter: ListFilter,
  save: Save,
  cancel: X,
} satisfies Record<string, LucideIcon>;

/** Ícone padrão de editar (lápis saindo do quadrado). */
export const EditIcon = SquarePen;

const BASE =
  "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const VARIANT = {
  default: "text-foreground hover:bg-muted",
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
} as const;

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Nome do botão (aria-label) e dica padrão. */
  label: string;
  icon: LucideIcon;
  variant?: keyof typeof VARIANT;
  /** Gira o ícone (atualizando, salvando...). */
  spinning?: boolean;
  iconSize?: number;
}

export function IconButton({ label, icon: Icon, variant = "default", spinning, iconSize = 16, title, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={title ?? label} className={cn(BASE, VARIANT[variant], className)} {...rest}>
      <Icon aria-hidden="true" size={iconSize} className={cn(spinning && "animate-spin")} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

export interface FilterButtonProps {
  open: boolean;
  onToggle: () => void;
  /** Filtros ativos: aparece como número no canto do botão. */
  activeCount: number;
  /** id da FilterBar (aria-controls). */
  controls?: string;
  disabled?: boolean;
  className?: string;
}

/** "Filtrar": abre/fecha a linha de filtros; com filtro ativo fica destacado e mostra quantos. */
export function FilterButton({ open, onToggle, activeCount, controls, disabled, className }: FilterButtonProps) {
  const title = activeCount ? `Filtrar (${activeCount} ${activeCount === 1 ? "filtro ativo" : "filtros ativos"})` : "Filtrar";
  return (
    <button
      type="button"
      aria-label="Filtrar"
      aria-expanded={open}
      aria-controls={controls}
      title={title}
      disabled={disabled}
      onClick={onToggle}
      data-active-filters={activeCount || undefined}
      className={cn(BASE, VARIANT.default, (open || activeCount > 0) && "border-primary/40 bg-primary/10 text-primary-text", className)}
    >
      <ListFilter aria-hidden="true" size={16} />
      <span className="sr-only">Filtrar</span>
      {activeCount > 0 && (
        <span aria-hidden="true" data-filter-count="" className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {activeCount}
        </span>
      )}
    </button>
  );
}
