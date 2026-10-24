// Massa fixa dos testes de catálogo, vendas e compras (pricing, orders, receiving). Só INSERTs simples: roda no
// SQLite dos testes (createTestDb) e no banco demo do navegador (createDemoDb). Não é usado pelo app.
import type { DatabaseLike } from "@/lib/db/demo";

export interface TradeFixture {
  companyId: string;
  userId: string;
  customerId: string;
  otherCustomerId: string;
  supplierId: string;
  /** Depósito com saldo (switch 10, mouse 3). */
  locationId: string;
  /** Loja, sem saldo nenhum. */
  emptyLocationId: string;
  items: { switch: string; mouse: string };
  products: { switch: string; mouse: string; visita: string; inativo: string };
  priceLists: { padrao: string; revenda: string };
  categories: { receita: string; custo: string };
}

export async function seedTradeFixture(db: DatabaseLike, companyId: string, userId: string): Promise<TradeFixture> {
  const run = (sql: string, binds: unknown[]) => db.execute(sql, binds);
  const fx: TradeFixture = {
    companyId,
    userId,
    customerId: "fx-cust-1",
    otherCustomerId: "fx-cust-2",
    supplierId: "fx-sup-1",
    locationId: "fx-loc-1",
    emptyLocationId: "fx-loc-2",
    items: { switch: "fx-item-switch", mouse: "fx-item-mouse" },
    products: { switch: "fx-prod-switch", mouse: "fx-prod-mouse", visita: "fx-prod-visita", inativo: "fx-prod-inativo" },
    priceLists: { padrao: "fx-pl-padrao", revenda: "fx-pl-revenda" },
    categories: { receita: "fx-cat-1-1", custo: "fx-cat-3-1" },
  };

  await run("INSERT INTO finance_categories (id, company_id, code, name, kind, dre_group, position, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [fx.categories.receita, companyId, "1.1", "Venda de produtos", "receita", "receita", 1, 1]);
  await run("INSERT INTO finance_categories (id, company_id, code, name, kind, dre_group, position, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [fx.categories.custo, companyId, "3.1", "Custo das mercadorias", "despesa", "custo", 2, 1]);

  await run("INSERT INTO price_lists (id, company_id, name, is_default, active) VALUES (?, ?, ?, ?, ?)", [fx.priceLists.padrao, companyId, "Tabela padrão", 1, 1]);
  await run("INSERT INTO price_lists (id, company_id, name, is_default, active) VALUES (?, ?, ?, ?, ?)", [fx.priceLists.revenda, companyId, "Revenda", 0, 1]);

  await run("INSERT INTO customers (id, company_id, type, name, email, status, price_list_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [fx.customerId, companyId, "PJ", "Cliente Revenda", "compras@revenda.test", "active", fx.priceLists.revenda]);
  await run("INSERT INTO customers (id, company_id, type, name, email, status) VALUES (?, ?, ?, ?, ?, ?)", [fx.otherCustomerId, companyId, "PJ", "Cliente Final", "ti@final.test", "active"]);

  await run("INSERT INTO suppliers (id, company_id, name, document, terms) VALUES (?, ?, ?, ?, ?)", [fx.supplierId, companyId, "Distribuidora Teste", "11.222.333/0001-81", "28 dias"]);

  await run("INSERT INTO stock_locations (id, company_id, name, type) VALUES (?, ?, ?, ?)", [fx.locationId, companyId, "Depósito", "deposito"]);
  await run("INSERT INTO stock_locations (id, company_id, name, type) VALUES (?, ?, ?, ?)", [fx.emptyLocationId, companyId, "Loja", "loja"]);

  await run("INSERT INTO inventory_items (id, company_id, name, sku, unit, min_stock, cost) VALUES (?, ?, ?, ?, ?, ?, ?)", [fx.items.switch, companyId, "Switch 24 portas", "FX-SW", "un", 2, 2000]);
  await run("INSERT INTO inventory_items (id, company_id, name, sku, unit, min_stock, cost) VALUES (?, ?, ?, ?, ?, ?, ?)", [fx.items.mouse, companyId, "Mouse USB", "FX-MOUSE", "un", 5, 40]);
  await run("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?, ?, ?, ?, ?)", ["fx-bal-switch", companyId, fx.items.switch, fx.locationId, 10]);
  await run("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?, ?, ?, ?, ?)", ["fx-bal-mouse", companyId, fx.items.mouse, fx.locationId, 3]);

  const product = (id: string, sku: string, name: string, kind: string, unit: string, price: number, cost: number, itemId: string | null, active = 1) =>
    run("INSERT INTO products (id, company_id, sku, name, kind, unit, price, cost, tax_rate, inventory_item_id, revenue_category_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, companyId, sku, name, kind, unit, price, cost, 0, itemId, null, active]);
  await product(fx.products.switch, "FX-SW", "Switch 24 portas", "produto", "un", 3000, 2000, fx.items.switch);
  await product(fx.products.mouse, "FX-MOUSE", "Mouse USB", "produto", "un", 80, 40, fx.items.mouse);
  await product(fx.products.visita, "FX-VISITA", "Visita técnica", "servico", "visita", 250, 0, null);
  await product(fx.products.inativo, "FX-OLD", "Produto fora de linha", "produto", "un", 10, 5, null, 0);

  // Revenda: switch 10% abaixo. Padrão: mouse mais barato a partir de 10 unidades.
  await run("INSERT INTO price_list_items (id, company_id, price_list_id, product_id, price, min_qty) VALUES (?, ?, ?, ?, ?, ?)", ["fx-pli-1", companyId, fx.priceLists.revenda, fx.products.switch, 2700, 1]);
  await run("INSERT INTO price_list_items (id, company_id, price_list_id, product_id, price, min_qty) VALUES (?, ?, ?, ?, ?, ?)", ["fx-pli-2", companyId, fx.priceLists.padrao, fx.products.mouse, 70, 10]);
  await run("INSERT INTO price_list_items (id, company_id, price_list_id, product_id, price, min_qty) VALUES (?, ?, ?, ?, ?, ?)", ["fx-pli-3", companyId, fx.priceLists.padrao, fx.products.mouse, 65, 50]);

  return fx;
}
