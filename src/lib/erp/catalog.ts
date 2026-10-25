// Catálogo: produtos e serviços (SKU único por empresa sem diferenciar maiúsculas) e tabelas de preço com faixas por
// quantidade mínima. O banco demo não aplica UNIQUE: a chave natural (SKU; tabela + produto + quantidade) é conferida
// aqui antes de gravar.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney } from "@/lib/money";
import type { InventoryItem, PriceList, PriceListItem, Product, ProductKind } from "@/types";
import { activeRow, activeRows, activeRowsBy, cleanText, fail, insertRow, isIsoDay, isTrue, nowIso, updateRow } from "./tradeDb";

export interface ProductInput {
  name: string;
  sku?: string | null;
  kind: ProductKind;
  category?: string | null;
  unit?: string | null;
  price: number;
  cost?: number | null;
  /** Percentual (5 = 5%). */
  taxRate?: number | null;
  description?: string | null;
  barcode?: string | null;
  ncm?: string | null;
  serviceCode?: string | null;
  inventoryItemId?: string | null;
  revenueCategoryId?: string | null;
  active?: boolean;
  /** Produto sem item de estoque: cria um com o mesmo nome, SKU, unidade, categoria e custo e liga ao produto. */
  createStockItem?: boolean;
}

const sameSku = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.toLowerCase();

/** Cadastra (sem `productId`) ou atualiza um produto/serviço. Devolve o id. */
export async function saveProduct(db: DatabaseLike, companyId: string, input: ProductInput, productId?: string): Promise<string> {
  const name = cleanText(input.name) ?? fail("Informe o nome do produto ou serviço.");
  if (input.kind !== "produto" && input.kind !== "servico") fail("Escolha se é produto ou serviço.");
  const price = Number(input.price);
  const cost = Number(input.cost ?? 0);
  const taxRate = Number(input.taxRate ?? 0);
  if (!Number.isFinite(price) || price < 0) fail("O preço não pode ser negativo.");
  if (!Number.isFinite(cost) || cost < 0) fail("O custo não pode ser negativo.");
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) fail("O imposto deve ficar entre 0% e 100%.");

  const existing = productId ? (await activeRow<Product>(db, "products", companyId, productId)) ?? fail("Produto não encontrado.") : null;
  const sku = cleanText(input.sku);
  if (sku) {
    const clash = (await activeRows<Product>(db, "products", companyId)).find((product) => product.id !== productId && sameSku(product.sku, sku));
    if (clash) fail(`Já existe um produto com o SKU "${sku}" (${clash.name}).`);
  }
  let inventoryItemId: string | null = null;
  if (input.kind === "produto" && input.inventoryItemId) {
    if (!(await activeRow<InventoryItem>(db, "inventory_items", companyId, input.inventoryItemId))) fail("Item de estoque não encontrado.");
    inventoryItemId = input.inventoryItemId;
  }
  if (input.revenueCategoryId && !(await activeRow(db, "finance_categories", companyId, input.revenueCategoryId))) fail("Categoria de receita não encontrada.");

  const unit = cleanText(input.unit) ?? "un";
  const category = cleanText(input.category);
  const now = nowIso();
  if (input.kind === "produto" && !inventoryItemId && input.createStockItem) {
    inventoryItemId = uuidv4();
    await insertRow(db, "inventory_items", { id: inventoryItemId, company_id: companyId, name, sku, category, unit, min_stock: 0, cost: roundMoney(cost), created_at: now, updated_at: now });
  }

  const row = {
    sku,
    name,
    description: cleanText(input.description),
    kind: input.kind,
    category,
    unit,
    price: roundMoney(price),
    cost: roundMoney(cost),
    tax_rate: taxRate,
    barcode: cleanText(input.barcode),
    ncm: cleanText(input.ncm),
    service_code: cleanText(input.serviceCode),
    inventory_item_id: inventoryItemId,
    revenue_category_id: input.revenueCategoryId ?? null,
    active: input.active === false ? 0 : 1,
    updated_at: now,
  };
  if (existing) {
    await updateRow(db, "products", companyId, existing.id, row);
    return existing.id;
  }
  const id = uuidv4();
  await insertRow(db, "products", { id, company_id: companyId, ...row, created_at: now });
  return id;
}

export async function setProductActive(db: DatabaseLike, companyId: string, productId: string, active: boolean): Promise<void> {
  if (!(await activeRow<Product>(db, "products", companyId, productId))) fail("Produto não encontrado.");
  await updateRow(db, "products", companyId, productId, { active: active ? 1 : 0, updated_at: nowIso() });
}

/** Exclusão (soft delete) do produto e dos preços dele nas tabelas. Pedidos antigos continuam com a descrição. */
export async function deleteProduct(db: DatabaseLike, companyId: string, productId: string): Promise<void> {
  if (!(await activeRow<Product>(db, "products", companyId, productId))) fail("Produto não encontrado.");
  const now = nowIso();
  await updateRow(db, "products", companyId, productId, { deleted_at: now, updated_at: now });
  for (const item of await activeRowsBy<PriceListItem>(db, "price_list_items", companyId, "product_id", productId)) {
    await updateRow(db, "price_list_items", companyId, item.id, { deleted_at: now, updated_at: now });
  }
}

export interface PriceListInput {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
}

/** Cadastra ou atualiza a tabela. Marcar como padrão tira a marca das outras (só uma padrão por empresa). */
export async function savePriceList(db: DatabaseLike, companyId: string, input: PriceListInput, priceListId?: string): Promise<string> {
  const name = cleanText(input.name) ?? fail("Informe o nome da tabela.");
  const validFrom = cleanText(input.validFrom);
  const validTo = cleanText(input.validTo);
  if (validFrom && !isIsoDay(validFrom)) fail("Início da vigência inválido.");
  if (validTo && !isIsoDay(validTo)) fail("Fim da vigência inválido.");
  if (validFrom && validTo && validTo < validFrom) fail("A vigência termina antes de começar.");
  if (priceListId && !(await activeRow<PriceList>(db, "price_lists", companyId, priceListId))) fail("Tabela de preço não encontrada.");

  const now = nowIso();
  if (input.isDefault) {
    for (const other of await activeRows<PriceList>(db, "price_lists", companyId)) {
      if (other.id !== priceListId && isTrue(other.is_default)) await updateRow(db, "price_lists", companyId, other.id, { is_default: 0, updated_at: now });
    }
  }
  const row = { name, description: cleanText(input.description), is_default: input.isDefault ? 1 : 0, valid_from: validFrom, valid_to: validTo, active: input.active === false ? 0 : 1, updated_at: now };
  if (priceListId) {
    await updateRow(db, "price_lists", companyId, priceListId, row);
    return priceListId;
  }
  const id = uuidv4();
  await insertRow(db, "price_lists", { id, company_id: companyId, ...row, created_at: now });
  return id;
}

/** Exclusão (soft delete) da tabela e dos preços dela. Cliente que apontava para ela passa a usar a padrão. */
export async function deletePriceList(db: DatabaseLike, companyId: string, priceListId: string): Promise<void> {
  if (!(await activeRow<PriceList>(db, "price_lists", companyId, priceListId))) fail("Tabela de preço não encontrada.");
  const now = nowIso();
  await updateRow(db, "price_lists", companyId, priceListId, { deleted_at: now, is_default: 0, updated_at: now });
  for (const item of await activeRowsBy<PriceListItem>(db, "price_list_items", companyId, "price_list_id", priceListId)) {
    await updateRow(db, "price_list_items", companyId, item.id, { deleted_at: now, updated_at: now });
  }
}

export interface PriceListItemInput {
  priceListId: string;
  productId: string;
  price: number;
  /** A partir de quantas unidades vale o preço (1 = sempre). */
  minQty?: number;
}

export async function savePriceListItem(db: DatabaseLike, companyId: string, input: PriceListItemInput, itemId?: string): Promise<string> {
  if (!(await activeRow<PriceList>(db, "price_lists", companyId, input.priceListId))) fail("Tabela de preço não encontrada.");
  if (!(await activeRow<Product>(db, "products", companyId, input.productId))) fail("Produto não encontrado.");
  const price = Number(input.price);
  const minQty = Number(input.minQty ?? 1);
  if (!Number.isFinite(price) || price < 0) fail("O preço não pode ser negativo.");
  if (!Number.isFinite(minQty) || minQty <= 0) fail("A quantidade mínima deve ser maior que zero.");
  const items = await activeRowsBy<PriceListItem>(db, "price_list_items", companyId, "price_list_id", input.priceListId);
  if (itemId && !items.some((item) => item.id === itemId)) fail("Preço não encontrado nesta tabela.");
  if (items.some((item) => item.id !== itemId && item.product_id === input.productId && Number(item.min_qty) === minQty)) {
    fail("Esta tabela já tem preço para esse produto a partir dessa quantidade.");
  }
  const now = nowIso();
  const row = { product_id: input.productId, price: roundMoney(price), min_qty: minQty, updated_at: now };
  if (itemId) {
    await updateRow(db, "price_list_items", companyId, itemId, row);
    return itemId;
  }
  const id = uuidv4();
  await insertRow(db, "price_list_items", { id, company_id: companyId, price_list_id: input.priceListId, ...row, created_at: now });
  return id;
}

export async function removePriceListItem(db: DatabaseLike, companyId: string, itemId: string): Promise<void> {
  if (!(await activeRow<PriceListItem>(db, "price_list_items", companyId, itemId))) fail("Preço não encontrado.");
  const now = nowIso();
  await updateRow(db, "price_list_items", companyId, itemId, { deleted_at: now, updated_at: now });
}

/**
 * Preço da tabela = preço do catálogo × (1 + percentual/100), para cada produto ativo (ou só de um tipo), a partir de
 * 1 unidade: cria o preço que falta e atualiza o que existe. Faixas de quantidade maiores ficam como estão.
 */
export async function applyPercentToPriceList(
  db: DatabaseLike,
  companyId: string,
  priceListId: string,
  percent: number,
  options: { kind?: ProductKind } = {},
): Promise<{ created: number; updated: number }> {
  if (!Number.isFinite(percent) || percent <= -100 || percent > 1000) fail("Percentual inválido: use um valor acima de -100% (ex.: -10 para 10% abaixo do catálogo).");
  if (!(await activeRow<PriceList>(db, "price_lists", companyId, priceListId))) fail("Tabela de preço não encontrada.");
  const products = (await activeRows<Product>(db, "products", companyId)).filter((product) => isTrue(product.active) && (!options.kind || product.kind === options.kind));
  const items = await activeRowsBy<PriceListItem>(db, "price_list_items", companyId, "price_list_id", priceListId);
  const now = nowIso();
  let created = 0;
  let updated = 0;
  for (const product of products) {
    const price = roundMoney(Number(product.price) * (1 + percent / 100));
    const base = items.find((item) => item.product_id === product.id && Number(item.min_qty) === 1);
    if (base) {
      await updateRow(db, "price_list_items", companyId, base.id, { price, updated_at: now });
      updated += 1;
    } else {
      await insertRow(db, "price_list_items", { id: uuidv4(), company_id: companyId, price_list_id: priceListId, product_id: product.id, price, min_qty: 1, created_at: now, updated_at: now });
      created += 1;
    }
  }
  return { created, updated };
}
