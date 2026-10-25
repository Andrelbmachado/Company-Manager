// Cadastro de itens do estoque pela tabela editável (Estoque > Itens): grava as linhas alteradas e as novas de uma vez.
// Tudo é conferido antes da primeira gravação (o plugin SQL não tem transação): se uma linha tem erro, nenhuma é
// gravada. A linha nova chega com o id gerado pela tela (newRow), então salvar de novo depois de uma falha não duplica.
// O saldo não muda por aqui: só por movimentação (entrada, saída, transferência ou inventário).
// SQL nos padrões do banco demo (SELECT * com WHERE col=?, uma linha por INSERT).
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney } from "@/lib/money";
import type { InventoryItem, Supplier } from "@/types";
import { assertCan, assertCanSaveRows, type Actor } from "./permission";
import { activeItem, roundQty, StockError } from "./stock";

export const ITEM_FIELDS = ["name", "sku", "category", "supplier_id", "unit", "min_stock", "max_stock", "cost"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];
export type ItemValues = Pick<InventoryItem, ItemField>;

/** Linha como a tabela entrega: campo apagado chega como null. */
export type ItemRowPatch = { id?: string } & { [K in ItemField]?: InventoryItem[K] | null };

export interface ItemRowChanges {
  updated: readonly (ItemRowPatch & { id: string })[];
  created: readonly ItemRowPatch[];
}

export interface SavedItem {
  id: string;
  name: string;
  /** Campos gravados (na criação, todos). */
  values: Partial<ItemValues>;
}

export interface ItemSaveResult {
  created: SavedItem[];
  updated: SavedItem[];
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const clean = String(value).replace(/\s+/g, " ").trim();
  return clean || null;
};

/** Número de uma célula já convertida pela tabela (ou texto, quando vem de outro código). Vazio = null. */
function numberOf(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new StockError("valor_invalido", `${label}: informe um número igual ou maior que zero (ex.: 12,5).`);
  return number;
}

function skuKey(sku: string | null | undefined): string {
  return (sku ?? "").trim().toLowerCase();
}

/**
 * Valores completos e conferidos de um item (os da linha gravada com os campos alterados por cima). O fornecedor só é
 * conferido quando é escolhido agora (`checkSupplier`): o item cujo fornecedor foi excluído depois continua editável.
 */
function checkedValues(source: ItemRowPatch, supplierIds: ReadonlySet<string>, where: string, checkSupplier: boolean): ItemValues {
  const name = text(source.name);
  if (!name) throw new StockError("valor_invalido", `${where}: informe o nome do item.`);
  const supplierId = text(source.supplier_id);
  if (checkSupplier && supplierId && !supplierIds.has(supplierId)) throw new StockError("valor_invalido", `${where}: fornecedor não encontrado (excluído ou de outra empresa).`);
  const minStock = roundQty(numberOf(source.min_stock, `${where}, estoque mínimo`) ?? 0);
  const max = numberOf(source.max_stock, `${where}, estoque máximo`);
  const maxStock = max == null ? null : roundQty(max);
  if (maxStock != null && maxStock < minStock) throw new StockError("valor_invalido", `${where}: o estoque máximo não pode ser menor que o mínimo.`);
  // Dinheiro em centavos (AGENTS §4): o mesmo valor que a tela mostra e que vai no pedido de compra da reposição.
  const cost = roundMoney(numberOf(source.cost, `${where}, custo`) ?? 0);
  return { name, sku: text(source.sku), category: text(source.category), supplier_id: supplierId, unit: text(source.unit) ?? "un", min_stock: minStock, max_stock: maxStock, cost };
}

interface Plan {
  kind: "create" | "update";
  id: string;
  values: ItemValues;
  /** Campos que mudam (na criação, todos). */
  fields: ItemField[];
}

/**
 * Grava a tabela de itens: `updated` (só os campos que mudaram, mais o id) e `created` (linhas novas, com o id da
 * tela). Exige `edit`/`create` em `inventory`. Recusa nome vazio, número negativo, máximo menor que o mínimo,
 * fornecedor de fora e SKU repetido entre os itens ativos (sem diferenciar maiúsculas), sem gravar nada.
 */
export async function saveInventoryItemRows(db: DatabaseLike, companyId: string, actor: Actor, changes: ItemRowChanges): Promise<ItemSaveResult> {
  assertCanSaveRows(actor, "inventory", "itens do estoque", changes);
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const suppliers = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const supplierIds = new Set(suppliers.map((row) => row.id));
  const byId = new Map(items.map((row) => [row.id, row]));
  const plans: Plan[] = [];

  for (const patch of changes.updated) {
    const current = byId.get(patch.id);
    if (!current) throw new StockError("item_invalido", "Item não encontrado no estoque (excluído ou de outra empresa). Atualize a lista.");
    const fields = ITEM_FIELDS.filter((field) => field in patch);
    if (fields.length === 0) continue;
    const merged: ItemRowPatch = { ...current, ...Object.fromEntries(fields.map((field) => [field, patch[field]])) };
    plans.push({ kind: "update", id: current.id, values: checkedValues(merged, supplierIds, `"${current.name}"`, fields.includes("supplier_id")), fields });
  }

  for (const [index, row] of changes.created.entries()) {
    const id = text(row.id) ?? uuidv4();
    // Linha nova já gravada numa tentativa anterior que falhou depois dela: não grava de novo.
    if (byId.has(id) || (await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    plans.push({ kind: "create", id, values: checkedValues(row, supplierIds, `Linha nova ${index + 1}`, true), fields: [...ITEM_FIELDS] });
  }

  // SKU único entre os itens ativos, já com o que vai ser gravado (inclusive duas linhas novas com o mesmo SKU).
  const finalSku = new Map(items.map((row) => [row.id, { name: row.name, sku: skuKey(row.sku) }]));
  for (const plan of plans) finalSku.set(plan.id, { name: plan.values.name, sku: skuKey(plan.values.sku) });
  for (const plan of plans) {
    if (!plan.fields.includes("sku") || !plan.values.sku) continue;
    const clash = [...finalSku.entries()].find(([id, row]) => id !== plan.id && row.sku === skuKey(plan.values.sku));
    if (clash) throw new StockError("valor_invalido", `Já existe um item com o SKU ${plan.values.sku}: ${clash[1].name}.`);
  }

  const result: ItemSaveResult = { created: [], updated: [] };
  for (const plan of plans) {
    if (plan.kind === "update") {
      const assignments = plan.fields.map((field) => `${field}=?`).join(", ");
      await db.execute(`UPDATE inventory_items SET ${assignments}, updated_at=datetime('now') WHERE id=? AND company_id=? AND deleted_at IS NULL`, [
        ...plan.fields.map((field) => plan.values[field]),
        plan.id,
        companyId,
      ]);
      result.updated.push({ id: plan.id, name: plan.values.name, values: Object.fromEntries(plan.fields.map((field) => [field, plan.values[field]])) });
    } else {
      const { values } = plan;
      await db.execute(
        "INSERT INTO inventory_items (id, company_id, name, sku, category, supplier_id, unit, min_stock, max_stock, cost) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [plan.id, companyId, values.name, values.sku, values.category, values.supplier_id, values.unit, values.min_stock, values.max_stock, values.cost],
      );
      result.created.push({ id: plan.id, name: values.name, values });
    }
  }
  return result;
}

/** Remove o item da lista (soft delete). O histórico de movimentações continua. Exige `delete` em `inventory`. */
export async function deleteInventoryItem(db: DatabaseLike, companyId: string, actor: Actor, itemId: string): Promise<InventoryItem> {
  assertCan(actor, "delete", "inventory", "itens do estoque");
  const item = await activeItem(db, companyId, itemId);
  await db.execute("UPDATE inventory_items SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [item.id, companyId]);
  return item;
}
