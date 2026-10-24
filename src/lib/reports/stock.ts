// Giro de estoque no período: saldo inicial e final reconstruídos do saldo atual (stock_balances) desfazendo as
// movimentações posteriores; giro = saídas ÷ saldo médio; cobertura = saldo final ÷ saída média por dia.
// Saída é a movimentação só com origem (venda, consumo, baixa), fora o ajuste de inventário. Transferência não muda o total.
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney, sumMoney } from "@/lib/money";
import { daysBetween, localDayOf, num, periodLabel, text, type DbRow, type ReportTable } from "./common";

export interface StockData {
  items: DbRow[];
  balances: DbRow[];
  movements: DbRow[];
}

export interface StockRow {
  itemId: string;
  name: string;
  sku: string | null;
  unit: string;
  cost: number;
  currentBalance: number;
  opening: number;
  closing: number;
  averageBalance: number;
  inQty: number;
  outQty: number;
  /** Saídas ÷ saldo médio; sem saldo médio → null. */
  turnover: number | null;
  /** Dias que o saldo final dura na saída média do período; sem saída → null. */
  coverageDays: number | null;
  lastMovement: string | null;
  /** Dias da última movimentação até o fim do período. */
  idleDays: number | null;
  /** Tem saldo e não saiu nada no período. */
  idle: boolean;
  value: number;
}

export interface StockReport {
  from: string;
  to: string;
  rows: StockRow[];
  totals: { items: number; value: number; idleItems: number; idleValue: number };
}

export async function loadStockData(db: DatabaseLike, companyId: string): Promise<StockData> {
  const [items, balances, movements] = await Promise.all([
    db.select<DbRow[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    db.select<DbRow[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]),
    db.select<DbRow[]>("SELECT * FROM stock_movements WHERE company_id=?", [companyId]),
  ]);
  return { items, balances, movements };
}

function qty(value: number): number {
  return Math.round(value * 1000) / 1000 || 0;
}

/** Efeito no saldo total do item: entra no destino, sai da origem (transferência soma zero). */
function delta(movement: DbRow): number {
  const quantity = num(movement.quantity);
  return (text(movement.to_location_id) ? quantity : 0) - (text(movement.from_location_id) ? quantity : 0);
}

function isInventoryAdjustment(movement: DbRow): boolean {
  return movement.type === "ajuste" || movement.ref_type === "inventory_count";
}

export function buildStockReport(data: StockData, options: { from: string; to: string }): StockReport {
  const { from, to } = options;
  const periodDays = Math.max(1, daysBetween(from, to) + 1);
  const balanceByItem = new Map<string, number>();
  for (const balance of data.balances) balanceByItem.set(String(balance.item_id), (balanceByItem.get(String(balance.item_id)) ?? 0) + num(balance.quantity));
  const movementsByItem = new Map<string, { movement: DbRow; day: string }[]>();
  for (const movement of data.movements) {
    const day = localDayOf(text(movement.created_at));
    if (!day) continue;
    const list = movementsByItem.get(String(movement.item_id)) ?? [];
    list.push({ movement, day });
    movementsByItem.set(String(movement.item_id), list);
  }

  const rows = data.items.map<StockRow>((item) => {
    const itemId = String(item.id);
    const movements = movementsByItem.get(itemId) ?? [];
    const currentBalance = qty(balanceByItem.get(itemId) ?? 0);
    const after = movements.filter(({ day }) => day > to);
    const within = movements.filter(({ day }) => day >= from && day <= to);
    const closing = qty(currentBalance - after.reduce((total, { movement }) => total + delta(movement), 0));
    const opening = qty(closing - within.reduce((total, { movement }) => total + delta(movement), 0));
    const plain = within.filter(({ movement }) => !isInventoryAdjustment(movement));
    const outQty = qty(plain.filter(({ movement }) => text(movement.from_location_id) && !text(movement.to_location_id)).reduce((total, { movement }) => total + num(movement.quantity), 0));
    const inQty = qty(plain.filter(({ movement }) => text(movement.to_location_id) && !text(movement.from_location_id)).reduce((total, { movement }) => total + num(movement.quantity), 0));
    const averageBalance = qty((opening + closing) / 2);
    const lastMovement = movements.filter(({ day }) => day <= to).reduce<string | null>((latest, { day }) => (latest === null || day > latest ? day : latest), null);
    const cost = num(item.cost);
    return {
      itemId,
      name: String(item.name ?? ""),
      sku: text(item.sku),
      unit: text(item.unit) ?? "un",
      cost,
      currentBalance,
      opening,
      closing,
      averageBalance,
      inQty,
      outQty,
      turnover: averageBalance > 0 ? Math.round((outQty / averageBalance) * 100) / 100 : null,
      coverageDays: outQty > 0 ? Math.round(Math.max(0, closing) / (outQty / periodDays)) : null,
      lastMovement,
      idleDays: lastMovement ? daysBetween(lastMovement, to) : null,
      idle: closing > 0 && outQty === 0,
      value: roundMoney(Math.max(0, closing) * cost),
    };
  });
  rows.sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1) || a.name.localeCompare(b.name, "pt-BR"));

  const idleRows = rows.filter((row) => row.idle);
  return {
    from,
    to,
    rows,
    totals: {
      items: rows.length,
      value: sumMoney(rows.map((row) => row.value)),
      idleItems: idleRows.length,
      idleValue: sumMoney(idleRows.map((row) => row.value)),
    },
  };
}

/** Tabela do giro (ou só dos itens parados), pronta para a tela e a exportação. */
export function stockTable(report: StockReport, options: { onlyIdle?: boolean } = {}): ReportTable {
  const rows = options.onlyIdle ? report.rows.filter((row) => row.idle) : report.rows;
  return {
    title: options.onlyIdle ? "Itens parados" : "Giro de estoque",
    subtitle: `${periodLabel(report.from, report.to)} · giro = saídas ÷ saldo médio`,
    fileName: `${options.onlyIdle ? "itens-parados" : "giro-de-estoque"}-${report.from}-a-${report.to}`,
    columns: [
      { key: "name", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "unit", label: "Unid.", kind: "text" },
      { key: "opening", label: "Saldo inicial", kind: "number" },
      { key: "inQty", label: "Entradas", kind: "number" },
      { key: "outQty", label: "Saídas", kind: "number" },
      { key: "closing", label: "Saldo final", kind: "number" },
      { key: "turnover", label: "Giro", kind: "number" },
      { key: "coverageDays", label: "Cobertura (dias)", kind: "integer" },
      { key: "lastMovement", label: "Última movimentação", kind: "date" },
      { key: "idleDays", label: "Dias sem movimento", kind: "integer" },
      { key: "value", label: "Valor em estoque (R$)", kind: "money" },
    ],
    rows: rows.map((row) => ({
      name: row.name,
      sku: row.sku,
      unit: row.unit,
      opening: row.opening,
      inQty: row.inQty,
      outQty: row.outQty,
      closing: row.closing,
      turnover: row.turnover,
      coverageDays: row.coverageDays,
      lastMovement: row.lastMovement,
      idleDays: row.idleDays,
      value: row.value,
    })),
    totals: { name: `Total (${rows.length} ${rows.length === 1 ? "item" : "itens"})`, value: sumMoney(rows.map((row) => row.value)) },
  };
}
