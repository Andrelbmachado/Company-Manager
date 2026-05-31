import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  // Generic
  active: "bg-emerald-100 text-emerald-700",
  inactive: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-700",
  // Leads
  novo: "bg-blue-100 text-blue-700",
  qualificado: "bg-indigo-100 text-indigo-700",
  descartado: "bg-gray-100 text-gray-500",
  convertido: "bg-emerald-100 text-emerald-700",
  // Opportunities
  qualificacao: "bg-yellow-100 text-yellow-700",
  proposta: "bg-orange-100 text-orange-700",
  negociacao: "bg-violet-100 text-violet-700",
  ganho: "bg-emerald-100 text-emerald-700",
  perdido: "bg-red-100 text-red-600",
  // Tickets
  aberto: "bg-blue-100 text-blue-700",
  em_atendimento: "bg-yellow-100 text-yellow-700",
  aguardando: "bg-orange-100 text-orange-600",
  resolvido: "bg-emerald-100 text-emerald-700",
  fechado: "bg-gray-100 text-gray-500",
  // Work orders
  atribuida: "bg-indigo-100 text-indigo-700",
  aguardando_peca: "bg-orange-100 text-orange-700",
  em_execucao: "bg-yellow-100 text-yellow-700",
  concluida: "bg-emerald-100 text-emerald-700",
  cancelada: "bg-red-100 text-red-600",
  // Finance
  aberta: "bg-blue-100 text-blue-700",
  aprovada: "bg-indigo-100 text-indigo-700",
  paga: "bg-emerald-100 text-emerald-700",
  recebida: "bg-emerald-100 text-emerald-700",
  vencida: "bg-red-100 text-red-600",
  // Projects
  planejado: "bg-gray-100 text-gray-700",
  andamento: "bg-blue-100 text-blue-700",
  pausado: "bg-yellow-100 text-yellow-700",
  // Tasks
  em_andamento: "bg-blue-100 text-blue-700",
  bloqueada: "bg-red-100 text-red-600",
  // Custody
  em_custodia: "bg-yellow-100 text-yellow-700",
  devolvido: "bg-emerald-100 text-emerald-700",
  consumido: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  suspended: "Suspenso",
  novo: "Novo",
  qualificado: "Qualificado",
  descartado: "Descartado",
  convertido: "Convertido",
  qualificacao: "Qualificação",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  aguardando: "Aguardando",
  resolvido: "Resolvido",
  fechado: "Fechado",
  atribuida: "Atribuída",
  aguardando_peca: "Aguard. peça",
  em_execucao: "Em execução",
  concluida: "Concluída",
  cancelada: "Cancelada",
  aberta: "Aberta",
  aprovada: "Aprovada",
  paga: "Paga",
  recebida: "Recebida",
  vencida: "Vencida",
  planejado: "Planejado",
  andamento: "Em andamento",
  pausado: "Pausado",
  em_andamento: "Em andamento",
  bloqueada: "Bloqueada",
  em_custodia: "Em custódia",
  devolvido: "Devolvido",
  consumido: "Consumido",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        style,
        className
      )}
    >
      {label}
    </span>
  );
}
