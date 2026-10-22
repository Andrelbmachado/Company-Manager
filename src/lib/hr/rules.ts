// Regras de RH, puras (sem banco): dias de uma solicitação, saldo de férias, quem está de férias e tempo de empresa.
import type { Employee, HrRequest, HrRequestType } from "@/types";

export const REQUEST_TYPES: { value: HrRequestType; label: string }[] = [
  { value: "ferias", label: "Férias" },
  { value: "folga", label: "Folga" },
  { value: "atestado", label: "Atestado" },
  { value: "outro", label: "Outro" },
];

export const REQUEST_TYPE_LABEL: Record<HrRequestType, string> = Object.fromEntries(REQUEST_TYPES.map((type) => [type.value, type.label])) as Record<HrRequestType, string>;

const MS_PER_DAY = 86_400_000;

function utc(date: string): number {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Dias corridos entre duas datas, contando o primeiro e o último. Retorna 0 se o fim vier antes do início. */
export function inclusiveDays(start: string, end: string): number {
  const diff = Math.round((utc(end) - utc(start)) / MS_PER_DAY) + 1;
  return diff > 0 ? diff : 0;
}

export interface VacationBalance {
  entitled: number;
  /** Dias de férias aprovados que começam no ano. */
  used: number;
  /** Dias de férias pedidos e ainda sem resposta. */
  pending: number;
  /** Disponível = direito - aprovados - pendentes (o que ainda pode pedir). */
  available: number;
}

export function vacationBalance(employee: Pick<Employee, "vacation_days_entitled">, requests: Pick<HrRequest, "type" | "status" | "days" | "start_date">[], year: number): VacationBalance {
  const inYear = requests.filter((request) => request.type === "ferias" && Number(request.start_date.slice(0, 4)) === year);
  const used = inYear.filter((request) => request.status === "aprovada").reduce((sum, request) => sum + request.days, 0);
  const pending = inYear.filter((request) => request.status === "pendente").reduce((sum, request) => sum + request.days, 0);
  return { entitled: employee.vacation_days_entitled, used, pending, available: Math.max(0, employee.vacation_days_entitled - used - pending) };
}

/** Validação de uma nova solicitação. Retorna a mensagem de erro ou null. */
export function validateRequest(input: { type: HrRequestType; start: string; end: string }, balance: VacationBalance, today: string): string | null {
  if (!input.start || !input.end) return "Informe a data de início e a de fim.";
  const days = inclusiveDays(input.start, input.end);
  if (days === 0) return "A data de fim não pode ser anterior à de início.";
  if (input.type !== "atestado" && input.start < today) return "O início não pode estar no passado. Atestados podem ter data passada.";
  if (input.type === "ferias" && days > balance.available) return `Você tem ${balance.available} dia(s) de férias disponíveis e pediu ${days}.`;
  return null;
}

/**
 * Pode aprovar? Só pedidos pendentes e, para férias, só se os dias aprovados do ano do pedido mais os dele não passam do direito.
 * Retorna a mensagem de erro ou null.
 */
export function approvalError(
  request: Pick<HrRequest, "id" | "type" | "status" | "days" | "start_date" | "employee_id">,
  employee: Pick<Employee, "vacation_days_entitled"> | undefined,
  requests: Pick<HrRequest, "id" | "employee_id" | "type" | "status" | "days" | "start_date">[],
): string | null {
  if (request.status !== "pendente") return "Esta solicitação já foi decidida.";
  if (request.type !== "ferias" || !employee) return null;
  const year = Number(request.start_date.slice(0, 4));
  const approved = requests.filter((other) => other.id !== request.id && other.employee_id === request.employee_id).filter((other) => other.type === "ferias" && other.status === "aprovada" && Number(other.start_date.slice(0, 4)) === year);
  const used = approved.reduce((sum, other) => sum + other.days, 0);
  if (used + request.days > employee.vacation_days_entitled) return `Aprovar estes ${request.days} dia(s) passaria do direito de ${employee.vacation_days_entitled} dias em ${year} (já aprovados: ${used}).`;
  return null;
}

/** Colaborador com férias aprovadas cobrindo a data. */
export function isOnVacation(requests: Pick<HrRequest, "employee_id" | "type" | "status" | "start_date" | "end_date">[], employeeId: string, today: string): boolean {
  return requests.some((request) => request.employee_id === employeeId && request.type === "ferias" && request.status === "aprovada" && request.start_date <= today && today <= request.end_date);
}

/** "3 anos e 2 meses", "8 meses" ou "menos de 1 mês". */
export function tenureLabel(hireDate: string | null | undefined, today: string): string {
  if (!hireDate) return "—";
  const [hy, hm, hd] = hireDate.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - hy) * 12 + (tm - hm) - (td < hd ? 1 : 0);
  if (months < 1) return "menos de 1 mês";
  const years = Math.floor(months / 12);
  months %= 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (months) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  return parts.join(" e ");
}
