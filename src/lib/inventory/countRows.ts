// Inventário pelas tabelas editáveis (Estoque › Inventário): a lista abre contagens e muda a observação; a folha de
// uma contagem aberta recebe o contado e a observação de cada item e inclui itens. Linhas novas usam o id gerado pela
// tela (salvar de novo depois de uma falha não duplica); tudo é conferido antes de gravar (uma linha com erro e nenhuma
// é gravada); a permissão é conferida aqui também, não só nos botões.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import type { InventoryCount, InventoryCountItem, StockLocation } from "@/types";
import { loadCount, openInventoryCount, requireOpen } from "./counts";
import { assertCanSaveRows, type Actor } from "./permission";
import { activeItem, activeLocation, itemBalances, quantityAt, roundQty, StockError } from "./stock";

export interface RowChanges<Row> {
  updated: readonly (Partial<Row> & { id: string })[];
  created: readonly Partial<Row>[];
}

const cleanText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
};

const newRowLabel = (index: number) => `Linha nova ${index + 1}`;

export const COUNT_LOCATION_LOCKED = "O local de uma contagem não muda depois de aberta. Cancele a contagem e abra outra no local certo.";
export const COUNT_ITEM_LOCKED = "O item da linha não muda. Inclua o item certo numa linha nova e deixe esta sem contagem (ou conte zero).";

export interface CountRowInput {
  id: string;
  location_id: string | null;
  notes: string | null;
}

/**
 * Lista de contagens: `created` abre uma contagem no local da linha (com os itens que têm saldo lá e o saldo de agora),
 * `updated` muda só a observação. Exige `create`/`edit` em `inventory`.
 */
export async function saveCountRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  changes: RowChanges<CountRowInput>,
): Promise<{ created: { id: string; number: number }[]; updated: string[] }> {
  assertCanSaveRows(actor, "inventory", "contagens de inventário", changes);

  const notesUpdates: { id: string; notes: string | null }[] = [];
  for (const patch of changes.updated) {
    const count = await loadCount(db, companyId, patch.id);
    if ("location_id" in patch && (patch.location_id ?? null) !== (count.location_id ?? null)) throw new StockError("contagem_travada", COUNT_LOCATION_LOCKED);
    if ("notes" in patch) notesUpdates.push({ id: count.id, notes: cleanText(patch.notes) });
  }

  const opens: { id: string; locationId: string; notes: string | null }[] = [];
  const openRows = await db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND status='aberta' AND deleted_at IS NULL", [companyId]);
  const pickedLocations = new Map<string, StockLocation>();
  for (const [index, row] of changes.created.entries()) {
    const id = cleanText(row.id);
    if (id && (await db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    const locationId = cleanText(row.location_id);
    if (!locationId) throw new StockError("local_invalido", `${newRowLabel(index)}: escolha o local da contagem.`);
    const location = await activeLocation(db, companyId, locationId);
    const open = openRows.find((count) => count.location_id === location.id);
    if (open) {
      throw new StockError(
        "contagem_aberta",
        `Já existe a contagem ${formatSequence("inventory_counts", open.number)} aberta em ${location.name}. Conclua ou cancele antes de abrir outra.`,
      );
    }
    if (pickedLocations.has(location.id)) throw new StockError("contagem_repetida", `Há duas contagens novas em ${location.name}. Abra só uma por local.`);
    pickedLocations.set(location.id, location);
    opens.push({ id: id ?? "", locationId: location.id, notes: cleanText(row.notes) });
  }

  const result = { created: [] as { id: string; number: number }[], updated: [] as string[] };
  for (const update of notesUpdates) {
    await db.execute("UPDATE inventory_counts SET notes=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [update.notes, companyId, update.id]);
    result.updated.push(update.id);
  }
  for (const open of opens) {
    result.created.push(await openInventoryCount(db, { companyId, id: open.id || null, locationId: open.locationId, notes: open.notes, userId: actor.userId }));
  }
  return result;
}

export interface CountLineInput {
  id: string;
  item_id: string | null;
  counted_qty: number | null;
  notes: string | null;
}

function countedValue(value: unknown, context: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  const counted = Number.isFinite(number) ? roundQty(number) : Number.NaN;
  if (!(counted >= 0)) throw new StockError("quantidade_invalida", `${context}: a quantidade contada deve ser um número igual ou maior que zero.`);
  return counted;
}

/**
 * Folha da contagem aberta: `updated` grava contado (null limpa) e observação, `created` inclui o item da linha (saldo
 * esperado = o de agora no local) já com o contado digitado. O item de uma linha não muda. Exige `edit`/`create` em
 * `inventory`.
 */
export async function saveCountLineRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  countId: string,
  changes: RowChanges<CountLineInput>,
): Promise<{ created: string[]; updated: string[] }> {
  assertCanSaveRows(actor, "inventory", "contagens de inventário", changes);
  const count = await loadCount(db, companyId, countId);
  requireOpen(count);
  const lines = await db.select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE company_id=? AND count_id=? AND deleted_at IS NULL", [companyId, count.id]);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const itemsInCount = new Set(lines.map((line) => line.item_id));

  const updates: { id: string; fields: ("counted_qty" | "notes")[]; counted_qty: number | null; notes: string | null }[] = [];
  for (const patch of changes.updated) {
    const line = byId.get(patch.id);
    if (!line) throw new StockError("contagem_invalida", "Item da contagem não encontrado (retirado ou de outra contagem). Atualize a folha.");
    if ("item_id" in patch && patch.item_id !== line.item_id) throw new StockError("contagem_travada", COUNT_ITEM_LOCKED);
    const item = await activeItem(db, companyId, line.item_id).catch(() => null);
    const context = item ? `"${item.name}"` : "Item removido";
    const fields = (["counted_qty", "notes"] as const).filter((field) => field in patch);
    if (fields.length === 0) continue;
    updates.push({
      id: line.id,
      fields: [...fields],
      counted_qty: "counted_qty" in patch ? countedValue(patch.counted_qty, context) : line.counted_qty ?? null,
      notes: "notes" in patch ? cleanText(patch.notes) : line.notes ?? null,
    });
  }

  const inserts: { id: string; itemId: string; expected: number; counted: number | null; notes: string | null }[] = [];
  for (const [index, row] of changes.created.entries()) {
    const id = cleanText(row.id);
    if (id && (await db.select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    const itemId = cleanText(row.item_id);
    if (!itemId) throw new StockError("item_invalido", `${newRowLabel(index)}: escolha o item.`);
    const item = await activeItem(db, companyId, itemId);
    if (itemsInCount.has(item.id)) throw new StockError("item_repetido", `"${item.name}" já está nesta contagem.`);
    itemsInCount.add(item.id);
    const expected = count.location_id ? quantityAt(await itemBalances(db, companyId, item.id), count.location_id) : 0;
    inserts.push({ id: id ?? uuidv4(), itemId: item.id, expected, counted: countedValue(row.counted_qty, `"${item.name}"`), notes: cleanText(row.notes) });
  }

  const result = { created: [] as string[], updated: [] as string[] };
  for (const update of updates) {
    await db.execute(`UPDATE inventory_count_items SET ${update.fields.map((field) => `${field}=?`).join(", ")}, updated_at=datetime('now') WHERE company_id=? AND id=?`, [
      ...update.fields.map((field) => update[field]),
      companyId,
      update.id,
    ]);
    result.updated.push(update.id);
  }
  for (const insert of inserts) {
    await db.execute(
      "INSERT INTO inventory_count_items (id, company_id, count_id, item_id, location_id, expected_qty, counted_qty, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [insert.id, companyId, count.id, insert.itemId, count.location_id ?? null, insert.expected, insert.counted, insert.notes],
    );
    result.created.push(insert.id);
  }
  return result;
}
