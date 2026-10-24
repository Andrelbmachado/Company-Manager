// Aging de contas a receber e a pagar: saldo em aberto (valor − recebido/pago) por faixa de atraso numa data-base.
// Quitadas, canceladas, excluídas e saldo zerado ficam fora. Vence hoje = a vencer.
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney, sumMoney } from "@/lib/money";
import { dayLabel, daysBetween, localDayOf, num, sharePercent, text, type DbRow, type ReportTable } from "./common";

export type AgingSide = "receber" | "pagar";
export type AgingBucket = "a_vencer" | "1_30" | "31_60" | "61_90" | "90_mais" | "sem_vencimento";
export type AgingView = "faixas" | "parceiros" | "titulos";

export const AGING_BUCKETS: readonly { key: AgingBucket; label: string }[] = [
  { key: "a_vencer", label: "A vencer" },
  { key: "1_30", label: "1 a 30 dias" },
  { key: "31_60", label: "31 a 60 dias" },
  { key: "61_90", label: "61 a 90 dias" },
  { key: "90_mais", label: "Mais de 90 dias" },
  { key: "sem_vencimento", label: "Sem vencimento" },
];

const BUCKET_LABEL = new Map(AGING_BUCKETS.map((bucket) => [bucket.key, bucket.label]));
const CLOSED = new Set(["paga", "recebida", "cancelada"]);

export interface AgingData {
  receivables: DbRow[];
  payables: DbRow[];
  customers: Map<string, string>;
  suppliers: Map<string, string>;
}

export interface AgingEntry {
  id: string;
  description: string;
  partyId: string | null;
  party: string;
  dueDate: string | null;
  status: string;
  amount: number;
  settled: number;
  open: number;
  /** Dias de atraso na data-base (0 ou negativo = a vencer); sem vencimento → null. */
  daysOverdue: number | null;
  bucket: AgingBucket;
}

export interface AgingBucketRow {
  key: AgingBucket;
  label: string;
  count: number;
  total: number;
  share: number;
}

export interface AgingPartyRow {
  key: string;
  label: string;
  count: number;
  total: number;
  overdue: number;
  buckets: Record<AgingBucket, number>;
}

export interface AgingReport {
  side: AgingSide;
  asOf: string;
  count: number;
  total: number;
  overdue: number;
  entries: AgingEntry[];
  buckets: AgingBucketRow[];
  byParty: AgingPartyRow[];
}

function names(rows: DbRow[]): Map<string, string> {
  return new Map(rows.map((row) => [String(row.id), String(row.name ?? "")]));
}

export async function loadAgingData(db: DatabaseLike, companyId: string): Promise<AgingData> {
  const [receivables, payables, customers, suppliers] = await Promise.all([
    db.select<DbRow[]>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    db.select<DbRow[]>("SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    db.select<DbRow[]>("SELECT * FROM customers WHERE company_id=?", [companyId]),
    db.select<DbRow[]>("SELECT * FROM suppliers WHERE company_id=?", [companyId]),
  ]);
  return { receivables, payables, customers: names(customers), suppliers: names(suppliers) };
}

export function bucketOf(daysOverdue: number | null): AgingBucket {
  if (daysOverdue === null) return "sem_vencimento";
  if (daysOverdue <= 0) return "a_vencer";
  if (daysOverdue <= 30) return "1_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  return "90_mais";
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { a_vencer: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_mais": 0, sem_vencimento: 0 };
}

export function buildAgingReport(data: AgingData, side: AgingSide, asOf: string): AgingReport {
  const receber = side === "receber";
  const rows = receber ? data.receivables : data.payables;
  const parties = receber ? data.customers : data.suppliers;
  const none = receber ? "Sem cliente" : "Sem fornecedor";

  const entries = rows
    .filter((row) => !CLOSED.has(String(row.status)))
    .map<AgingEntry>((row) => {
      const amount = roundMoney(num(row.amount));
      const settled = roundMoney(num(receber ? row.received_amount : row.paid_amount));
      const dueDate = localDayOf(text(row.due_date));
      const daysOverdue = dueDate ? daysBetween(dueDate, asOf) : null;
      const partyId = text(receber ? row.customer_id : row.supplier_id);
      return {
        id: String(row.id),
        description: text(row.description) ?? text(row.ref_id) ?? (receber ? "Conta a receber" : "Conta a pagar"),
        partyId,
        party: partyId ? parties.get(partyId) || (receber ? "Cliente removido" : "Fornecedor removido") : none,
        dueDate,
        status: String(row.status),
        amount,
        settled,
        open: roundMoney(amount - settled),
        daysOverdue,
        bucket: bucketOf(daysOverdue),
      };
    })
    .filter((entry) => entry.open > 0)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.description.localeCompare(b.description, "pt-BR"));

  const total = sumMoney(entries.map((entry) => entry.open));
  const overdueEntries = entries.filter((entry) => (entry.daysOverdue ?? 0) > 0);
  const buckets = AGING_BUCKETS.map(({ key, label }) => {
    const inBucket = entries.filter((entry) => entry.bucket === key);
    const value = sumMoney(inBucket.map((entry) => entry.open));
    return { key, label, count: inBucket.length, total: value, share: sharePercent(value, total) };
  });

  const byPartyMap = new Map<string, { key: string; label: string; entries: AgingEntry[] }>();
  for (const entry of entries) {
    const key = entry.partyId ?? "none";
    const group = byPartyMap.get(key) ?? { key, label: entry.party, entries: [] };
    group.entries.push(entry);
    byPartyMap.set(key, group);
  }
  const byParty = [...byPartyMap.values()]
    .map<AgingPartyRow>((group) => {
      const perBucket = emptyBuckets();
      for (const { key } of AGING_BUCKETS) perBucket[key] = sumMoney(group.entries.filter((entry) => entry.bucket === key).map((entry) => entry.open));
      return {
        key: group.key,
        label: group.label,
        count: group.entries.length,
        total: sumMoney(group.entries.map((entry) => entry.open)),
        overdue: sumMoney(group.entries.filter((entry) => (entry.daysOverdue ?? 0) > 0).map((entry) => entry.open)),
        buckets: perBucket,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.label.localeCompare(b.label, "pt-BR"));

  return {
    side,
    asOf,
    count: entries.length,
    total,
    overdue: sumMoney(overdueEntries.map((entry) => entry.open)),
    entries,
    buckets,
    byParty,
  };
}

const SIDE_TITLE: Record<AgingSide, string> = { receber: "Contas a receber", pagar: "Contas a pagar" };
const VIEW_TITLE: Record<AgingView, string> = { faixas: "por faixa de atraso", parceiros: "por cliente", titulos: "títulos em aberto" };

/** Tabela de uma visão do aging (faixas, por cliente/fornecedor ou títulos), pronta para a tela e a exportação. */
export function agingTable(report: AgingReport, view: AgingView): ReportTable {
  const receber = report.side === "receber";
  const partyLabel = receber ? "Cliente" : "Fornecedor";
  const viewTitle = view === "parceiros" ? `por ${partyLabel.toLowerCase()}` : VIEW_TITLE[view];
  const base = {
    title: `${SIDE_TITLE[report.side]} ${viewTitle}`,
    subtitle: `Saldo em aberto em ${dayLabel(report.asOf)}`,
    fileName: `contas-a-${report.side}-${view}-em-${report.asOf}`,
  };

  if (view === "faixas") {
    return {
      ...base,
      columns: [
        { key: "label", label: "Faixa", kind: "text" },
        { key: "count", label: "Títulos", kind: "integer" },
        { key: "total", label: "Em aberto (R$)", kind: "money" },
        { key: "share", label: "Participação (%)", kind: "percent" },
      ],
      rows: report.buckets.map((bucket) => ({ label: bucket.label, count: bucket.count, total: bucket.total, share: bucket.share })),
      totals: { label: "Total", count: report.count, total: report.total, share: report.total ? 100 : 0 },
    };
  }

  if (view === "parceiros") {
    return {
      ...base,
      columns: [
        { key: "label", label: partyLabel, kind: "text" },
        { key: "count", label: "Títulos", kind: "integer" },
        ...AGING_BUCKETS.map(({ key, label }) => ({ key: `b_${key}`, label: `${label} (R$)`, kind: "money" as const })),
        { key: "overdue", label: "Vencido (R$)", kind: "money" },
        { key: "total", label: "Em aberto (R$)", kind: "money" },
      ],
      rows: report.byParty.map((row) => ({
        label: row.label,
        count: row.count,
        ...Object.fromEntries(AGING_BUCKETS.map(({ key }) => [`b_${key}`, row.buckets[key]])),
        overdue: row.overdue,
        total: row.total,
      })),
      totals: {
        label: "Total",
        count: report.count,
        ...Object.fromEntries(report.buckets.map((bucket) => [`b_${bucket.key}`, bucket.total])),
        overdue: report.overdue,
        total: report.total,
      },
    };
  }

  return {
    ...base,
    columns: [
      { key: "due_date", label: "Vencimento", kind: "date" },
      { key: "description", label: "Descrição", kind: "text" },
      { key: "party", label: partyLabel, kind: "text" },
      { key: "amount", label: "Valor (R$)", kind: "money" },
      { key: "settled", label: receber ? "Recebido (R$)" : "Pago (R$)", kind: "money" },
      { key: "open", label: "Em aberto (R$)", kind: "money" },
      { key: "days", label: "Dias de atraso", kind: "integer" },
      { key: "bucket", label: "Faixa", kind: "text" },
    ],
    rows: report.entries.map((entry) => ({
      due_date: entry.dueDate,
      description: entry.description,
      party: entry.party,
      amount: entry.amount,
      settled: entry.settled,
      open: entry.open,
      days: entry.daysOverdue !== null && entry.daysOverdue > 0 ? entry.daysOverdue : null,
      bucket: BUCKET_LABEL.get(entry.bucket),
    })),
    totals: {
      description: "Total",
      amount: sumMoney(report.entries.map((entry) => entry.amount)),
      settled: sumMoney(report.entries.map((entry) => entry.settled)),
      open: report.total,
    },
  };
}
