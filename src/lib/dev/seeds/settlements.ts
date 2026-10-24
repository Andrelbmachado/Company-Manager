// TEMPORÁRIO (dados de exemplo): baixas, recorrências e extrato. Roda por último (ordem alfabética), depois de compras
// e vendas: cada conta paga ou recebida ganha a sua baixa (finance_settlements); as mais recentes aparecem no extrato
// da conta padrão já conciliadas, e o extrato tem lançamentos pendentes e um ignorado para a tela de conciliação.
// Precisa de uma conta bancária; sem ela não grava nada (nem a flag).
import { getDb } from "@/lib/db/client";
import { roundMoney } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import { day, hasSeedFlag, insertRows, memberFor, membersByRole, selectRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "settlements";

interface AccountRow {
  id: string;
  is_default?: number | boolean | string | null;
}
interface CodeRow {
  id: string;
  code?: string | null;
}
interface PayableRow {
  id: string;
  description?: string | null;
  amount: number;
  status: string;
  due_date?: string | null;
  paid_at?: string | null;
  paid_amount?: number | null;
  payment_method?: string | null;
  recurring_entry_id?: string | null;
}
interface ReceivableRow {
  id: string;
  description?: string | null;
  ref_id?: string | null;
  amount: number;
  status: string;
  due_date?: string | null;
  received_at?: string | null;
  received_amount?: number | null;
  payment_method?: string | null;
  customer_id?: string | null;
}

interface Settled {
  kind: "payable" | "receivable";
  id: string;
  label: string;
  amount: number;
  date: string;
  method: string;
}

const isTrue = (value: unknown) => value === 1 || value === true || value === "1" || value === "true";

/** 'YYYY-MM-DD' local de um timestamp ISO ou de uma data; senão, a data de reserva. */
function localDay(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : todayIso(parsed);
}

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const accounts = await selectRows<AccountRow>("bank_accounts", companyId);
  if (accounts.length === 0) return;
  const account = (accounts.find((item) => isTrue(item.is_default)) ?? accounts[0]).id;

  const db = await getDb();
  const members = await membersByRole(companyId);
  const finance = memberFor(members, "financeiro", "admin", "ceo");
  const categories = await selectRows<CodeRow>("finance_categories", companyId);
  const category = (code: string) => categories.find((item) => item.code === code)?.id ?? null;
  const costCenters = await selectRows<{ id: string; name: string }>("cost_centers", companyId);
  const costCenter = (name: string) => costCenters.find((item) => item.name === name)?.id ?? costCenters[0]?.id ?? null;
  const customers = await selectRows<{ id: string }>("customers", companyId);

  // ---- Recorrências -----------------------------------------------------------------------------------------------
  const competence = day(0).slice(0, 7);
  const recurring: SeedRow[] = [
    { id: "dev-settlements-recurring-1", kind: "pagar", description: "Aluguel do escritório", amount: 6800, frequency: "mensal", day_of_month: 5, start_date: day(-400), category_id: category("4.1"), cost_center_id: costCenter("Administrativo"), bank_account_id: account, last_competence: competence },
    { id: "dev-settlements-recurring-2", kind: "pagar", description: "Licenças de software - mensalidade", amount: 4850, frequency: "mensal", day_of_month: 10, start_date: day(-200), category_id: category("4.3"), cost_center_id: costCenter("TI"), bank_account_id: account, last_competence: competence },
    { id: "dev-settlements-recurring-3", kind: "pagar", description: "Seguro empresarial", amount: 3400, frequency: "anual", day_of_month: 20, start_date: day(-345), category_id: category("4"), cost_center_id: costCenter("Administrativo"), bank_account_id: account, last_competence: null, notes: "Renovação anual da apólice." },
    { id: "dev-settlements-recurring-4", kind: "receber", description: "Suporte mensal (contrato)", amount: 3000, frequency: "mensal", day_of_month: 15, start_date: day(-120), customer_id: customers[0]?.id ?? null, category_id: category("1.3"), bank_account_id: account, last_competence: competence },
  ];
  await insertRows("recurring_entries", companyId, recurring.map((row) => ({ active: 1, created_by: finance, ...row })));

  const payables = await selectRows<PayableRow>("payables", companyId);
  const receivables = await selectRows<ReceivableRow>("receivables", companyId);

  // Contas antigas de aluguel e licenças passam a vir da recorrência (uma por competência).
  for (const [recurringId, prefix] of [["dev-settlements-recurring-1", "Aluguel"], ["dev-settlements-recurring-2", "Licenças de software"]] as const) {
    const match = payables.find((row) => !row.recurring_entry_id && (row.description ?? "").startsWith(prefix));
    if (!match) continue;
    await db.execute("UPDATE payables SET recurring_entry_id=?, competence=? WHERE company_id=? AND id=? AND recurring_entry_id IS NULL", [
      recurringId,
      (match.due_date ?? day(0)).slice(0, 7),
      companyId,
      match.id,
    ]);
  }

  // ---- Baixas das contas pagas e recebidas ------------------------------------------------------------------------
  const existing = await selectRows<{ id: string; payable_id?: string | null; receivable_id?: string | null }>("finance_settlements", companyId);
  const settledPayables = new Set(existing.map((row) => row.payable_id).filter(Boolean));
  const settledReceivables = new Set(existing.map((row) => row.receivable_id).filter(Boolean));
  const settled: Settled[] = [];
  for (const row of payables) {
    if (row.status !== "paga" || settledPayables.has(row.id)) continue;
    const amount = roundMoney(Number(row.paid_amount) || Number(row.amount));
    if (!(Number(row.paid_amount) > 0)) {
      await db.execute("UPDATE payables SET paid_amount=? WHERE company_id=? AND id=? AND paid_amount=?", [amount, companyId, row.id, 0]);
    }
    settled.push({ kind: "payable", id: row.id, label: row.description ?? "Pagamento", amount, date: localDay(row.paid_at, row.due_date ?? day(0)), method: row.payment_method ?? "boleto" });
  }
  for (const row of receivables) {
    if (row.status !== "recebida" || settledReceivables.has(row.id)) continue;
    const amount = roundMoney(Number(row.received_amount) || Number(row.amount));
    if (!(Number(row.received_amount) > 0)) {
      await db.execute("UPDATE receivables SET received_amount=? WHERE company_id=? AND id=? AND received_amount=?", [amount, companyId, row.id, 0]);
    }
    settled.push({ kind: "receivable", id: row.id, label: row.description ?? row.ref_id ?? "Recebimento", amount, date: localDay(row.received_at, row.due_date ?? day(0)), method: row.payment_method ?? "pix" });
  }

  // As 8 baixas mais recentes (até 90 dias) já aparecem no extrato, conciliadas.
  const since = day(-90);
  const inStatement = new Set(
    [...settled].filter((item) => item.date >= since).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((item) => `${item.kind}:${item.id}`),
  );
  for (const item of settled) {
    const prefix = item.kind === "payable" ? "pay" : "rec";
    const transactionId = inStatement.has(`${item.kind}:${item.id}`) ? `dev-settlements-tx-${prefix}-${item.id}` : null;
    if (transactionId) {
      await insertRows("bank_transactions", companyId, [{
        id: transactionId,
        bank_account_id: account,
        posted_at: item.date,
        amount: item.kind === "payable" ? -item.amount : item.amount,
        description: `${item.kind === "payable" ? "PAGAMENTO" : "CRÉDITO"} ${item.method.toUpperCase()} - ${item.label}`.slice(0, 120),
        fitid: `DEV-${prefix.toUpperCase()}-${item.id}`,
        source: "ofx",
        status: "conciliada",
        payable_id: item.kind === "payable" ? item.id : null,
        receivable_id: item.kind === "receivable" ? item.id : null,
        reconciled_at: ts(Math.min(0, Math.round((Date.parse(item.date) - Date.parse(day(0))) / 86_400_000) + 1), 9),
        reconciled_by: finance,
      }]);
    }
    await insertRows("finance_settlements", companyId, [{
      id: `dev-settlements-${prefix}-${item.id}`,
      payable_id: item.kind === "payable" ? item.id : null,
      receivable_id: item.kind === "receivable" ? item.id : null,
      amount: item.amount,
      paid_at: item.date,
      bank_account_id: account,
      bank_transaction_id: transactionId,
      payment_method: item.method,
      interest: 0,
      fine: 0,
      discount: 0,
      notes: null,
      created_by: finance,
    }]);
  }

  // ---- Extrato: pendentes para conciliar e um ignorado -------------------------------------------------------------
  const open = receivables.find((row) => row.status === "aberta");
  const statement: SeedRow[] = [
    { id: "dev-settlements-tx-pending-1", posted_at: day(-1), amount: -89.9, description: "TARIFA PACOTE DE SERVIÇOS", fitid: "DEV-PEND-1", status: "pendente", category_id: category("5.1") },
    { id: "dev-settlements-tx-pending-2", posted_at: day(-2), amount: 42.17, description: "RENDIMENTO APLICAÇÃO AUTOMÁTICA", fitid: "DEV-PEND-2", status: "pendente", category_id: category("5.2") },
    { id: "dev-settlements-tx-ignored-1", posted_at: day(-5), amount: -5000, description: "TRANSFERÊNCIA ENTRE CONTAS PRÓPRIAS", fitid: "DEV-IGN-1", status: "ignorada", memo: "Movimentação entre contas da empresa." },
  ];
  if (open) {
    statement.push({ id: "dev-settlements-tx-pending-3", posted_at: day(0), amount: roundMoney(Number(open.amount)), description: `PIX RECEBIDO - ${open.description ?? "cliente"}`.slice(0, 120), fitid: "DEV-PEND-3", status: "pendente", memo: "Valor igual a uma conta a receber em aberto." });
  }
  await insertRows("bank_transactions", companyId, statement.map((row) => ({ bank_account_id: account, source: "ofx", ...row })));

  await setSeedFlag(AREA, companyId);
}
