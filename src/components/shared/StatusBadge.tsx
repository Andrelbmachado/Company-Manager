import { cn } from "@/lib/utils";

/**
 * Tags de status sólidas: cor forte, texto branco (amarelo usa texto escuro, pois branco sobre amarelo não passa em contraste).
 * Vermelho = erro/atraso/perda · Verde = concluído/ok · Amarelo = atenção · Laranja = aguardando · Azul = novo/aberto · Violeta = em avaliação · Cinza = neutro.
 */
const TONES = {
  danger: "bg-status-danger text-white",
  success: "bg-status-success text-white",
  warning: "bg-status-warning text-status-warning-ink",
  orange: "bg-status-orange text-white",
  info: "bg-status-info text-white",
  violet: "bg-status-violet text-white",
  neutral: "bg-status-neutral text-white",
} as const;

type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  // Genérico
  active: "success",
  inactive: "neutral",
  suspended: "danger",
  // Leads e oportunidades
  novo: "info",
  abordado: "warning",
  interessado: "violet",
  qualificado: "violet",
  descartado: "neutral",
  convertido: "success",
  qualificacao: "warning",
  proposta: "orange",
  negociacao: "violet",
  ganho: "success",
  perdido: "danger",
  // Indicação
  pendente: "warning",
  concedido: "success",
  // Tickets
  aberto: "info",
  em_atendimento: "warning",
  aguardando: "orange",
  resolvido: "success",
  fechado: "neutral",
  // Ordens de serviço
  atribuida: "violet",
  aguardando_peca: "orange",
  em_execucao: "warning",
  concluida: "success",
  cancelada: "danger",
  // Financeiro
  aberta: "info",
  aprovada: "violet",
  paga: "success",
  recebida: "success",
  vencida: "danger",
  // Projetos e tarefas
  planejado: "neutral",
  andamento: "info",
  pausado: "warning",
  concluido: "success",
  cancelado: "danger",
  em_andamento: "info",
  bloqueada: "danger",
  a_seguir: "neutral",
  // Prioridades
  baixa: "neutral",
  media: "info",
  alta: "orange",
  urgente: "danger",
  // Custódia
  em_custodia: "warning",
  devolvido: "success",
  consumido: "neutral",
  // RH
  comunicado: "info",
  politica: "violet",
  beneficio: "success",
  recusada: "danger",
  em_ferias: "info",
  afastado: "warning",
  desligado: "neutral",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  suspended: "Suspenso",
  novo: "Novo",
  abordado: "Abordado",
  interessado: "Interessado",
  qualificado: "Qualificado",
  descartado: "Descartado",
  convertido: "Convertido",
  qualificacao: "Qualificação",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
  pendente: "Pendente",
  concedido: "Concedido",
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
  concluido: "Concluído",
  cancelado: "Cancelado",
  em_andamento: "Em andamento",
  bloqueada: "Bloqueada",
  a_seguir: "A seguir",
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
  em_custodia: "Em custódia",
  devolvido: "Devolvido",
  consumido: "Consumido",
  comunicado: "Comunicado",
  politica: "Política",
  beneficio: "Benefício",
  recusada: "Recusada",
  em_ferias: "Em férias",
  afastado: "Afastado",
  desligado: "Desligado",
};

interface StatusBadgeProps {
  status: string;
  /** Força uma cor (ex.: "fechado" de lead é verde, o de ticket é cinza). */
  tone?: Tone;
  className?: string;
}

export function StatusBadge({ status, tone, className }: StatusBadgeProps) {
  const style = TONES[tone ?? STATUS_TONE[status] ?? "neutral"];
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", style, className)}>
      {label}
    </span>
  );
}
