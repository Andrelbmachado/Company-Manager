import type { Payable, Receivable } from "@/types";

/** Status considerados "em aberto" para contas a pagar (ainda geram saída de caixa). */
export const OPEN_PAYABLE_STATUSES = ["aberta", "aprovada"] as const;

/** Status considerado "em aberto" para contas a receber (ainda gera entrada de caixa). */
export const OPEN_RECEIVABLE_STATUSES = ["aberta"] as const;

/** Soma dos valores das contas a pagar em aberto (status "aberta" ou "aprovada"). */
export function totalPayablesOpen(payables: Payable[]): number {
  return payables
    .filter((p) => (OPEN_PAYABLE_STATUSES as readonly string[]).includes(p.status))
    .reduce((sum, p) => sum + p.amount, 0);
}

/** Soma dos valores das contas a receber em aberto (status "aberta"). */
export function totalReceivablesOpen(receivables: Receivable[]): number {
  return receivables
    .filter((r) => (OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(r.status))
    .reduce((sum, r) => sum + r.amount, 0);
}

/**
 * Saldo projetado = total a receber em aberto - total a pagar em aberto.
 * Positivo indica caixa projetado positivo; negativo, déficit.
 */
export function projectedBalance(payables: Payable[], receivables: Receivable[]): number {
  return totalReceivablesOpen(receivables) - totalPayablesOpen(payables);
}
