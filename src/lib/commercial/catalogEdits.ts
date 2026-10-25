// Gravação das tabelas editáveis do catálogo: produtos/serviços, tabelas de preço e os preços de cada tabela.
// Permissão do recurso products; todas as linhas validadas antes de gravar (SKU e faixa de preço repetidos dentro da
// mesma gravação também). A regra continua em lib/erp/catalog.ts.
import type { DatabaseLike } from "@/lib/db/demo";
import { savePriceList, savePriceListItem, saveProduct, type ProductInput } from "@/lib/erp/catalog";
import { activeRow, activeRows, activeRowsBy, cleanText, isIsoDay } from "@/lib/erp/tradeDb";
import type { PriceList, PriceListItem, Product } from "@/types";
import { assertChanges, isOn, type EditActor, type RowChanges, type SaveResult } from "./guard";

/** Valor da coluna "Item de estoque" que cria um item novo com os dados do produto. */
export const NEW_STOCK_ITEM = "__novo__";

const num = (value: unknown, fallback = 0) => (value === null || value === undefined || value === "" ? fallback : Number(value));
const prefixFor = (index: number, total: number) => (total > 1 ? `Linha nova ${index + 1}: ` : "");

function productInput(row: Partial<Product>): ProductInput {
  const stock = row.inventory_item_id ?? null;
  return {
    name: String(row.name ?? ""),
    sku: row.sku ?? null,
    kind: row.kind ?? "produto",
    category: row.category ?? null,
    unit: row.unit ?? "un",
    price: num(row.price),
    cost: num(row.cost),
    taxRate: num(row.tax_rate),
    description: row.description ?? null,
    barcode: row.barcode ?? null,
    ncm: row.ncm ?? null,
    serviceCode: row.service_code ?? null,
    inventoryItemId: stock === NEW_STOCK_ITEM ? null : stock,
    revenueCategoryId: row.revenue_category_id ?? null,
    active: row.active === undefined ? true : isOn(row.active),
    createStockItem: stock === NEW_STOCK_ITEM,
  };
}

function checkProduct(input: ProductInput, prefix: string): void {
  if (!cleanText(input.name)) throw new Error(`${prefix}informe o nome do produto ou serviço.`);
  if (input.kind !== "produto" && input.kind !== "servico") throw new Error(`${prefix}escolha se é produto ou serviço.`);
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error(`${prefix}o preço não pode ser negativo.`);
  if (!Number.isFinite(Number(input.cost)) || Number(input.cost) < 0) throw new Error(`${prefix}o custo não pode ser negativo.`);
  const tax = Number(input.taxRate);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error(`${prefix}o imposto deve ficar entre 0% e 100%.`);
}

/** Produtos: existentes mesclam atual + alterado; novos nascem produto, "un", ativos (e podem criar o item de estoque). */
export async function saveProductRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Product>): Promise<SaveResult> {
  assertChanges(actor, changes, "products");
  const all = await activeRows<Product>(db, "products", companyId);
  const updates: { id: string; input: ProductInput }[] = [];
  for (const patch of changes.updated) {
    const current = all.find((product) => product.id === patch.id);
    if (!current) throw new Error("Produto não encontrado (ou excluído). Atualize a lista.");
    const input = productInput({ ...current, ...patch });
    checkProduct(input, `${current.name}: `);
    updates.push({ id: patch.id, input });
  }
  const creations = changes.created.map((row, index) => {
    const input = productInput(row);
    checkProduct(input, prefixFor(index, changes.created.length));
    return input;
  });
  // SKU único: confere o resultado final (gravados + alterados + novos) antes de qualquer escrita.
  const finalSkus = new Map<string, string>();
  const changed = new Map(updates.map((item) => [item.id, item.input]));
  const entries: [string, string | null | undefined, string][] = [
    ...all.map((product): [string, string | null | undefined, string] => [product.id, changed.get(product.id)?.sku ?? (changed.has(product.id) ? null : product.sku), changed.get(product.id)?.name ?? product.name]),
    ...creations.map((input, index): [string, string | null | undefined, string] => [`novo-${index}`, input.sku, input.name]),
  ];
  for (const [id, sku, name] of entries) {
    const key = cleanText(sku)?.toLowerCase();
    if (!key) continue;
    const other = finalSkus.get(key);
    if (other && other !== id) throw new Error(`Já existe um produto com o SKU "${cleanText(sku)}" (${name}).`);
    finalSkus.set(key, id);
  }
  for (const { id, input } of updates) await saveProduct(db, companyId, input, id);
  const created: string[] = [];
  for (const input of creations) created.push(await saveProduct(db, companyId, input));
  return { created, updated: updates.map((item) => item.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// Tabelas de preço
// ---------------------------------------------------------------------------------------------------------------

interface ListPlan {
  id?: string;
  input: { name: string; description: string | null; isDefault: boolean; validFrom: string | null; validTo: string | null; active: boolean };
}

function listInput(row: Partial<PriceList>, prefix: string): ListPlan["input"] {
  const name = cleanText(row.name);
  if (!name) throw new Error(`${prefix}informe o nome da tabela.`);
  const validFrom = cleanText(row.valid_from);
  const validTo = cleanText(row.valid_to);
  if (validFrom && !isIsoDay(validFrom)) throw new Error(`${prefix}início da vigência inválido.`);
  if (validTo && !isIsoDay(validTo)) throw new Error(`${prefix}fim da vigência inválido.`);
  if (validFrom && validTo && validTo < validFrom) throw new Error(`${prefix}a vigência termina antes de começar.`);
  return { name, description: cleanText(row.description), isDefault: isOn(row.is_default), validFrom, validTo, active: row.active === undefined ? true : isOn(row.active) };
}

/** Tabelas de preço: só uma padrão por empresa (marcar outra tira a marca da antiga; duas na mesma gravação é erro). */
export async function savePriceListRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<PriceList>): Promise<SaveResult> {
  assertChanges(actor, changes, "products");
  const plans: ListPlan[] = [];
  for (const patch of changes.updated) {
    const current = await activeRow<PriceList>(db, "price_lists", companyId, patch.id);
    if (!current) throw new Error("Tabela de preço não encontrada (ou excluída). Atualize a lista.");
    plans.push({ id: patch.id, input: listInput({ ...current, ...patch }, `${current.name}: `) });
  }
  changes.created.forEach((row, index) => plans.push({ input: listInput(row, prefixFor(index, changes.created.length)) }));
  const newDefaults = plans.filter((plan) => plan.input.isDefault && (!plan.id || "is_default" in (changes.updated.find((row) => row.id === plan.id) ?? {})));
  if (newDefaults.length > 1) throw new Error("Só uma tabela pode ser a padrão: marque apenas uma.");
  const result: SaveResult = { created: [], updated: [] };
  // A que vira padrão grava por último, para a marca não ser tirada por outra linha da mesma gravação.
  for (const plan of [...plans].sort((a, b) => Number(newDefaults.includes(a)) - Number(newDefaults.includes(b)))) {
    const id = await savePriceList(db, companyId, plan.input, plan.id);
    (plan.id ? result.updated : result.created).push(id);
  }
  return result;
}

/** Preços de uma tabela: produto obrigatório, preço ≥ 0, quantidade mínima > 0 e sem repetir produto + quantidade. */
export async function savePriceListItemRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<PriceListItem>, options: { priceListId: string }): Promise<SaveResult> {
  assertChanges(actor, changes, "products");
  if (!(await activeRow<PriceList>(db, "price_lists", companyId, options.priceListId))) throw new Error("Tabela de preço não encontrada (ou excluída).");
  const items = await activeRowsBy<PriceListItem>(db, "price_list_items", companyId, "price_list_id", options.priceListId);
  const products = await activeRows<Product>(db, "products", companyId);
  const nameOf = (id: string) => products.find((product) => product.id === id)?.name ?? "produto";
  const check = (row: Partial<PriceListItem>, prefix: string) => {
    const productId = cleanText(row.product_id);
    if (!productId) throw new Error(`${prefix}escolha o produto.`);
    if (!products.some((product) => product.id === productId)) throw new Error(`${prefix}produto não encontrado.`);
    const price = num(row.price, NaN);
    if (!Number.isFinite(price) || price < 0) throw new Error(`${prefix}informe um preço (zero ou mais).`);
    const minQty = num(row.min_qty, 1);
    if (!Number.isFinite(minQty) || minQty <= 0) throw new Error(`${prefix}a quantidade mínima deve ser maior que zero.`);
    return { priceListId: options.priceListId, productId, price, minQty };
  };
  const updates = changes.updated.map((patch) => {
    const current = items.find((item) => item.id === patch.id);
    if (!current) throw new Error("Preço não encontrado nesta tabela. Atualize a lista.");
    return { id: patch.id, input: check({ ...current, ...patch }, `${nameOf(current.product_id)}: `) };
  });
  const creations = changes.created.map((row, index) => check(row, prefixFor(index, changes.created.length)));
  const changed = new Map(updates.map((item) => [item.id, item.input]));
  const final = [...items.map((item) => changed.get(item.id) ?? { productId: item.product_id, minQty: Number(item.min_qty) }), ...creations];
  const seen = new Set<string>();
  for (const entry of final) {
    const key = `${entry.productId}|${entry.minQty}`;
    if (seen.has(key)) throw new Error(`Esta tabela já tem preço para ${nameOf(entry.productId)} a partir de ${entry.minQty} un.`);
    seen.add(key);
  }
  for (const { id, input } of updates) await savePriceListItem(db, companyId, input, id);
  const created: string[] = [];
  for (const input of creations) created.push(await savePriceListItem(db, companyId, input));
  return { created, updated: updates.map((item) => item.id) };
}
