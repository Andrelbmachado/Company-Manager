// TEMPORÁRIO (dados de exemplo): movimento de caixa de todos os meses, para o balanço anual do Dashboard (e fluxo de
// caixa, DRE e relatórios) variar mês a mês, com meses no vermelho e meses no verde. De novembro do ano passado até
// hoje as contas ficam recebidas/pagas (realizado; a baixa vem do seed settlements, que roda depois); do resto do ano
// em diante ficam em aberto (previsão). Valores fixos por mês do ano, sem sorteio: rodar de novo dá o mesmo gráfico.
// Precisa de clientes e fornecedores de exemplo; sem eles não grava nada (nem a flag).
import { day, exampleRows, hasSeedFlag, insertRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "balance";

/** Entradas e saídas de cada mês do ano (jan → dez). Resultado: −, +, −, +, −, −, +, −, +, −, +, −. */
const INCOME = [38_400, 52_150, 31_900, 64_300, 45_200, 29_750, 71_480, 40_100, 56_900, 33_250, 61_700, 47_300];
const EXPENSE = [44_900, 39_200, 42_650, 48_100, 51_300, 41_900, 46_200, 58_400, 37_600, 49_800, 43_100, 52_900];
/** Partes de cada total: [fração, dia do mês, descrição]. */
const INCOME_PARTS: [number, number, string][] = [
  [0.45, 6, "Contrato de suporte"],
  [0.35, 14, "Projeto de infraestrutura"],
  [0.2, 24, "Serviços avulsos"],
];
const EXPENSE_PARTS: [number, number, string][] = [
  [0.4, 5, "Folha e encargos"],
  [0.25, 12, "Compra de equipamentos"],
  [0.2, 19, "Fornecedores de serviços"],
  [0.15, 27, "Impostos e taxas"],
];
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

const offsetOf = (date: string) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${day(0)}T12:00:00Z`)) / 86_400_000);
const cents = (value: number) => Math.round(value * 100) / 100;

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;
  const customers = await exampleRows<{ id: string }>("customers", companyId);
  const suppliers = await exampleRows<{ id: string }>("suppliers", companyId);
  if (customers.length === 0 || suppliers.length === 0) return;

  const today = day(0);
  const year = Number(today.slice(0, 4));
  const months: string[] = [];
  for (let month = 11; month <= 12; month++) months.push(`${year - 1}-${String(month).padStart(2, "0")}`);
  for (let month = 1; month <= 12; month++) months.push(`${year}-${String(month).padStart(2, "0")}`);

  const receivables: SeedRow[] = [];
  const payables: SeedRow[] = [];
  months.forEach((month, monthIndex) => {
    const index = Number(month.slice(5)) - 1;
    const label = MONTH.format(new Date(`${month}-01T00:00:00Z`));
    INCOME_PARTS.forEach(([share, dayOfMonth, description], part) => {
      const due = `${month}-${String(dayOfMonth).padStart(2, "0")}`;
      const amount = cents(INCOME[index] * share);
      const done = due <= today;
      receivables.push({
        id: `dev-balance-rec-${month}-${part + 1}`,
        customer_id: customers[(monthIndex + part) % customers.length].id,
        ref_type: "Contrato",
        description: `${description} - ${label}`,
        amount,
        due_date: due,
        status: done ? "recebida" : "aberta",
        received_at: done ? ts(offsetOf(due), 11) : null,
        received_amount: done ? amount : 0,
      });
    });
    EXPENSE_PARTS.forEach(([share, dayOfMonth, description], part) => {
      const due = `${month}-${String(dayOfMonth).padStart(2, "0")}`;
      const amount = cents(EXPENSE[index] * share);
      const done = due <= today;
      payables.push({
        id: `dev-balance-pay-${month}-${part + 1}`,
        supplier_id: suppliers[(monthIndex + part) % suppliers.length].id,
        description: `${description} - ${label}`,
        amount,
        due_date: due,
        status: done ? "paga" : "aberta",
        paid_at: done ? ts(offsetOf(due), 15) : null,
        paid_amount: done ? amount : 0,
      });
    });
  });
  await insertRows("receivables", companyId, receivables);
  await insertRows("payables", companyId, payables);
  await setSeedFlag(AREA, companyId);
}
