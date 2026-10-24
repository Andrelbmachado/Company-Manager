/**
 * Dinheiro em R$ com 2 casas. Toda conta passa por centavos inteiros para não acumular erro de ponto flutuante
 * (0,1 + 0,2), e o arredondamento é "meio para longe do zero" (1,005 → 1,01; -1,005 → -1,01).
 * Descontos são valores em R$; tax_rate é percentual (5 = 5%). Ver migration 0008.
 */

/** Centavos de um valor já multiplicado por 100. toPrecision(15) tira o ruído binário (1,005 × 100 = 100,4999…). */
function centsOf(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Valor inválido: ${value}`);
  const cents = Math.round(Number((Math.abs(value) * 100).toPrecision(15)));
  return value < 0 ? -cents || 0 : cents;
}

export function toCents(value: number): number {
  return centsOf(value);
}

export function fromCents(cents: number): number {
  return cents / 100 || 0;
}

export function roundMoney(value: number): number {
  return fromCents(centsOf(value));
}

export function sumMoney(values: readonly number[]): number {
  return fromCents(values.reduce((total, value) => total + centsOf(value), 0));
}

/** value × percent / 100, arredondado (percentOf(1000, 10) = 100). */
export function percentOf(value: number, percent: number): number {
  return roundMoney((value * percent) / 100);
}

/** Total do item: quantidade × preço unitário − desconto (em R$), nunca negativo. */
export function lineTotal(qty: number, unitPrice: number, discount = 0): number {
  return fromCents(Math.max(0, centsOf(qty * unitPrice) - centsOf(discount)));
}

export interface LineInput {
  qty: number;
  unit_price: number;
  /** Desconto do item em R$. */
  discount?: number | null;
  /** Percentual de imposto do item (5 = 5%), somado em tax_total. */
  tax_rate?: number | null;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax_total: number;
  total: number;
}

/**
 * Totais de pedido, fatura, compra ou proposta: subtotal = soma dos itens; total = subtotal − desconto + frete + impostos.
 * tax_total vem de `tax_total` quando informado; senão, da soma de tax_rate de cada item sobre o total do item.
 */
export function orderTotals(
  items: readonly LineInput[],
  options: { discount?: number | null; shipping?: number | null; tax_total?: number | null } = {}
): OrderTotals {
  const lines = items.map((item) => lineTotal(item.qty, item.unit_price, item.discount ?? 0));
  const subtotal = sumMoney(lines);
  const discount = roundMoney(options.discount ?? 0);
  const shipping = roundMoney(options.shipping ?? 0);
  const tax_total =
    options.tax_total != null
      ? roundMoney(options.tax_total)
      : sumMoney(items.map((item, index) => percentOf(lines[index], item.tax_rate ?? 0)));
  const total = fromCents(Math.max(0, toCents(subtotal) - toCents(discount) + toCents(shipping) + toCents(tax_total)));
  return { subtotal, discount, shipping, tax_total, total };
}

/** Divide o total em parcelas de centavos iguais; a última absorve a diferença, e a soma é exatamente o total. */
export function splitInstallments(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Número de parcelas inválido: ${count}`);
  const cents = centsOf(total);
  const base = Math.trunc(cents / count);
  return Array.from({ length: count }, (_, index) => fromCents(index === count - 1 ? cents - base * (count - 1) : base));
}
