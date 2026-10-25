// Inventário (contagem física) por local: abre com o saldo do sistema, recebe as quantidades contadas e, ao concluir,
// vira movimentações de ajuste (falta sai do local, sobra entra) pelo motor de estoque (stock.ts).
// SQL nos padrões do banco demo; junções e contagens em TypeScript.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import type { InventoryCount, InventoryCountItem, InventoryItem, StockBalance, StockLocation } from "@/types";
import { insertWithNextNumber } from "./numbering";
import { byName, userNames } from "./queries";
import { activeItem, activeLocation, itemBalances, quantityAt, recordStockMovement, roundQty, StockError } from "./stock";

export async function loadCount(db: DatabaseLike, companyId: string, countId: string): Promise<InventoryCount> {
  const rows = await db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, countId]);
  if (!rows[0]) throw new StockError("contagem_invalida", "Contagem de inventário não encontrada.");
  return rows[0];
}

export function requireOpen(count: InventoryCount): void {
  if (count.status !== "aberta") {
    const state = count.status === "concluida" ? "concluída" : "cancelada";
    throw new StockError("contagem_fechada", `A contagem ${formatSequence("inventory_counts", count.number)} já está ${state}.`);
  }
}

async function countItemRows(db: DatabaseLike, companyId: string, countId: string): Promise<InventoryCountItem[]> {
  return db.select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE company_id=? AND count_id=? AND deleted_at IS NULL", [companyId, countId]);
}

async function loadCountItem(db: DatabaseLike, companyId: string, countItemId: string): Promise<{ row: InventoryCountItem; count: InventoryCount }> {
  const rows = await db.select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, countItemId]);
  if (!rows[0]) throw new StockError("contagem_invalida", "Item da contagem não encontrado.");
  return { row: rows[0], count: await loadCount(db, companyId, rows[0].count_id) };
}

export interface OpenCountInput {
  companyId: string;
  /** Id da contagem (o da linha nova da tabela); sem ele, é gerado. */
  id?: string | null;
  locationId: string;
  userId?: string | null;
  /** Itens a contar; sem a lista, entram todos os itens com saldo registrado no local. */
  itemIds?: readonly string[];
  notes?: string | null;
}

/** Abre uma contagem no local (uma aberta por local), guardando o saldo do sistema de cada item. */
export async function openInventoryCount(db: DatabaseLike, input: OpenCountInput): Promise<{ id: string; number: number }> {
  const { companyId } = input;
  const location = await activeLocation(db, companyId, input.locationId);
  const open = await db.select<InventoryCount[]>(
    "SELECT * FROM inventory_counts WHERE company_id=? AND location_id=? AND status='aberta' AND deleted_at IS NULL",
    [companyId, location.id],
  );
  if (open[0]) {
    throw new StockError("contagem_aberta", `Já existe a contagem ${formatSequence("inventory_counts", open[0].number)} aberta em ${location.name}. Conclua ou cancele antes de abrir outra.`);
  }

  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=? AND location_id=?", [companyId, location.id]);
  let items: InventoryItem[];
  if (input.itemIds) {
    items = [];
    for (const itemId of new Set(input.itemIds)) items.push(await activeItem(db, companyId, itemId));
  } else {
    const active = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
    const withBalance = new Set(balances.map((row) => row.item_id));
    items = active.filter((item) => withBalance.has(item.id));
  }

  const id = input.id || uuidv4();
  const now = new Date().toISOString();
  const number = await insertWithNextNumber(db, "inventory_counts", companyId, (candidate) =>
    db.execute(
      "INSERT INTO inventory_counts (id, company_id, number, location_id, status, started_at, counted_by, notes) VALUES (?, ?, ?, ?, 'aberta', ?, ?, ?)",
      [id, companyId, candidate, location.id, now, input.userId ?? null, input.notes?.trim() || null],
    ),
  );
  for (const item of [...items].sort(byName)) {
    await db.execute(
      "INSERT INTO inventory_count_items (id, company_id, count_id, item_id, location_id, expected_qty) VALUES (?, ?, ?, ?, ?, ?)",
      [uuidv4(), companyId, id, item.id, location.id, quantityAt(balances.filter((row) => row.item_id === item.id), location.id)],
    );
  }
  return { id, number };
}

/** Inclui um item na contagem aberta (o saldo esperado é o de agora no local). */
export async function addCountItem(db: DatabaseLike, input: { companyId: string; countId: string; itemId: string }): Promise<string> {
  const count = await loadCount(db, input.companyId, input.countId);
  requireOpen(count);
  const item = await activeItem(db, input.companyId, input.itemId);
  const existing = await countItemRows(db, input.companyId, count.id);
  if (existing.some((row) => row.item_id === item.id)) throw new StockError("item_repetido", `"${item.name}" já está nesta contagem.`);
  const expected = count.location_id ? quantityAt(await itemBalances(db, input.companyId, item.id), count.location_id) : 0;
  const id = uuidv4();
  await db.execute(
    "INSERT INTO inventory_count_items (id, company_id, count_id, item_id, location_id, expected_qty) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.companyId, count.id, item.id, count.location_id ?? null, expected],
  );
  return id;
}

/** Tira um item da contagem aberta (soft delete). */
export async function removeCountItem(db: DatabaseLike, input: { companyId: string; countItemId: string }): Promise<void> {
  const { row, count } = await loadCountItem(db, input.companyId, input.countItemId);
  requireOpen(count);
  await db.execute("UPDATE inventory_count_items SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [input.companyId, row.id]);
}

/** Quantidade contada (0 vale; null limpa). `notes` só muda quando informado. */
export async function setCountedQuantity(
  db: DatabaseLike,
  input: { companyId: string; countItemId: string; countedQty: number | null; notes?: string | null },
): Promise<void> {
  let counted: number | null = null;
  if (input.countedQty !== null) {
    counted = typeof input.countedQty === "number" && Number.isFinite(input.countedQty) ? roundQty(input.countedQty) : Number.NaN;
    if (!(counted >= 0)) throw new StockError("quantidade_invalida", "A quantidade contada deve ser um número igual ou maior que zero.");
  }
  const { row, count } = await loadCountItem(db, input.companyId, input.countItemId);
  requireOpen(count);
  if (input.notes === undefined) {
    await db.execute("UPDATE inventory_count_items SET counted_qty=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [counted, input.companyId, row.id]);
  } else {
    await db.execute("UPDATE inventory_count_items SET counted_qty=?, notes=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [
      counted,
      input.notes?.trim() || null,
      input.companyId,
      row.id,
    ]);
  }
}

/**
 * Só a observação do item da contagem. Separada da quantidade para não regravar `counted_qty` com o valor que a tela
 * tinha antes: uma quantidade gravada logo antes (outro campo, outra janela) não volta ao valor antigo.
 */
export async function setCountItemNote(db: DatabaseLike, input: { companyId: string; countItemId: string; notes: string | null }): Promise<void> {
  const { row, count } = await loadCountItem(db, input.companyId, input.countItemId);
  requireOpen(count);
  await db.execute("UPDATE inventory_count_items SET notes=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [input.notes?.trim() || null, input.companyId, row.id]);
}

/**
 * Conclui a contagem e ajusta o estoque do local. A diferença é calculada contra o saldo **atual** (o que entrou ou saiu
 * durante a contagem já está no saldo e não é ajustado de novo); o `expected_qty` final guarda esse saldo. Exige todos
 * os itens contados. Item já ajustado (conclusão interrompida e repetida) não é ajustado outra vez.
 */
export async function finishInventoryCount(
  db: DatabaseLike,
  input: { companyId: string; countId: string; userId?: string | null },
): Promise<{ movementIds: string[] }> {
  const { companyId } = input;
  const count = await loadCount(db, companyId, input.countId);
  requireOpen(count);
  const rows = await countItemRows(db, companyId, count.id);
  if (rows.length === 0) throw new StockError("sem_itens", "A contagem não tem itens. Adicione itens ou cancele a contagem.");

  const all = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=?", [companyId]);
  const items = new Map(all.map((item) => [item.id, item]));
  // Item excluído do estoque depois de entrar na contagem não pode mais ser movimentado: diga qual é.
  const gone = rows.filter((row) => !row.adjustment_movement_id && (!items.get(row.item_id) || items.get(row.item_id)!.deleted_at));
  if (gone.length > 0) {
    const names = gone.map((row) => `"${items.get(row.item_id)?.name ?? "Item removido"}"`).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const many = gone.length > 1;
    throw new StockError(
      "item_invalido",
      `${many ? "Os itens" : "O item"} ${names.join(", ")} ${many ? "foram excluídos" : "foi excluído"} do estoque. Retire${many ? "-os" : "-o"} da contagem antes de concluir.`,
    );
  }
  const missing = rows.filter((row) => row.counted_qty == null);
  if (missing.length > 0) {
    const names = missing.map((row) => items.get(row.item_id)?.name ?? row.item_id).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const shown = names.slice(0, 5).join(", ") + (names.length > 5 ? "…" : "");
    throw new StockError("contagem_incompleta", `Falta${missing.length > 1 ? "m" : ""} ${missing.length} ite${missing.length > 1 ? "ns" : "m"} sem contagem: ${shown}. Conte ou retire da contagem antes de concluir.`);
  }
  if (!count.location_id) throw new StockError("local_invalido", "A contagem não tem local de estoque.");
  const location = await activeLocation(db, companyId, count.location_id);

  const label = formatSequence("inventory_counts", count.number);
  const movementIds: string[] = [];
  for (const row of rows) {
    if (row.adjustment_movement_id) continue;
    const current = quantityAt(await itemBalances(db, companyId, row.item_id), location.id);
    const difference = roundQty(Number(row.counted_qty) - current);
    let movementId: string | null = null;
    if (difference !== 0) {
      movementId = await recordStockMovement(db, {
        companyId,
        itemId: row.item_id,
        type: "ajuste",
        quantity: Math.abs(difference),
        fromLocationId: difference < 0 ? location.id : null,
        toLocationId: difference > 0 ? location.id : null,
        refType: "inventory_count",
        refId: count.id,
        userId: input.userId ?? null,
        note: `Ajuste de inventário ${label}: ${difference < 0 ? "falta" : "sobra"}`,
      });
      movementIds.push(movementId);
    }
    await db.execute("UPDATE inventory_count_items SET expected_qty=?, adjustment_movement_id=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [
      current,
      movementId,
      companyId,
      row.id,
    ]);
  }
  await db.execute(
    "UPDATE inventory_counts SET status='concluida', finished_at=?, counted_by=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
    [new Date().toISOString(), count.counted_by ?? input.userId ?? null, companyId, count.id],
  );
  return { movementIds };
}

/** Cancela a contagem aberta (o estoque não muda). */
export async function cancelInventoryCount(db: DatabaseLike, input: { companyId: string; countId: string }): Promise<void> {
  const count = await loadCount(db, input.companyId, input.countId);
  requireOpen(count);
  await db.execute("UPDATE inventory_counts SET status='cancelada', updated_at=datetime('now') WHERE company_id=? AND id=?", [input.companyId, count.id]);
}

export interface InventoryCountSummary extends InventoryCount {
  location_name: string | null;
  item_count: number;
  counted_count: number;
  /**
   * Itens contados com quantidade diferente do saldo do sistema: na aberta, o saldo de agora (a mesma conta da folha e
   * da conclusão); na concluída, o saldo usado no ajuste (`expected_qty`).
   */
  divergent_count: number;
}

async function locationNames(db: DatabaseLike, companyId: string): Promise<Map<string, string>> {
  const rows = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=?", [companyId]);
  return new Map(rows.map((row) => [row.id, row.name]));
}

function isDivergent(row: InventoryCountItem, systemQty: number): boolean {
  return row.counted_qty != null && roundQty(Number(row.counted_qty)) !== roundQty(systemQty);
}

/** Contagens da empresa, da mais nova para a mais antiga. */
export async function listInventoryCounts(db: DatabaseLike, companyId: string): Promise<InventoryCountSummary[]> {
  const counts = await db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND deleted_at IS NULL ORDER BY number DESC", [companyId]);
  const items = await db.select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
  const names = await locationNames(db, companyId);
  const balanceAt = new Map<string, number>();
  for (const row of balances) balanceAt.set(`${row.item_id}|${row.location_id}`, roundQty((balanceAt.get(`${row.item_id}|${row.location_id}`) ?? 0) + Number(row.quantity ?? 0)));
  return counts.map((count) => {
    const mine = items.filter((row) => row.count_id === count.id);
    const systemQty = (row: InventoryCountItem) =>
      count.status === "aberta" && count.location_id ? balanceAt.get(`${row.item_id}|${count.location_id}`) ?? 0 : Number(row.expected_qty);
    return {
      ...count,
      location_name: count.location_id ? names.get(count.location_id) ?? null : null,
      item_count: mine.length,
      counted_count: mine.filter((row) => row.counted_qty != null).length,
      divergent_count: mine.filter((row) => isDivergent(row, systemQty(row))).length,
    };
  });
}

export interface InventoryCountLine extends InventoryCountItem {
  item_name: string;
  sku: string | null;
  unit: string;
  cost: number;
  /** Saldo do item no local agora (para conferir durante a contagem). */
  current_qty: number;
}

export interface InventoryCountDetail {
  count: InventoryCount & { location_name: string | null; counted_by_name: string | null };
  items: InventoryCountLine[];
}

/** Contagem com os itens (nome, SKU, unidade, saldo atual), ordenados por nome; null se não existe. */
export async function loadInventoryCount(db: DatabaseLike, companyId: string, countId: string): Promise<InventoryCountDetail | null> {
  const rows = await db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, countId]);
  const count = rows[0];
  if (!count) return null;
  const lines = await countItemRows(db, companyId, count.id);
  const allItems = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=?", [companyId]);
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const balances = count.location_id
    ? await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=? AND location_id=?", [companyId, count.location_id])
    : [];
  const names = await locationNames(db, companyId);
  const users = await userNames(db, count.counted_by ? [count.counted_by] : []);
  const items = lines
    .map<InventoryCountLine>((line) => {
      const item = itemsById.get(line.item_id);
      return {
        ...line,
        item_name: item?.name ?? "Item removido",
        sku: item?.sku ?? null,
        unit: item?.unit ?? "un",
        cost: Number(item?.cost ?? 0),
        current_qty: count.location_id ? quantityAt(balances.filter((row) => row.item_id === line.item_id), count.location_id) : 0,
      };
    })
    .sort((a, b) => a.item_name.localeCompare(b.item_name, "pt-BR"));
  return {
    count: {
      ...count,
      location_name: count.location_id ? names.get(count.location_id) ?? null : null,
      counted_by_name: count.counted_by ? users.get(count.counted_by) ?? null : null,
    },
    items,
  };
}
