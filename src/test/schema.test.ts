// Schema de CRM/ERP (0008) e documentos com arquivo (0009) no SQLite real, com as migrations aplicadas.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

const NEW_TABLES = [
  "products",
  "price_lists",
  "price_list_items",
  "sales_orders",
  "sales_order_items",
  "invoices",
  "invoice_items",
  "purchase_orders",
  "purchase_order_items",
  "goods_receipts",
  "goods_receipt_items",
  "finance_categories",
  "bank_accounts",
  "bank_transactions",
  "recurring_entries",
  "finance_settlements",
  "inventory_counts",
  "inventory_count_items",
  "crm_activities",
  "proposal_items",
  "tags",
  "entity_tags",
  "saved_views",
  "import_batches",
  "hr_time_entries",
];

async function columns(target: TestDb, table: string): Promise<string[]> {
  const rows = await target.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}

async function withCompany(): Promise<{ db: TestDb; companyId: string; userIds: Awaited<ReturnType<typeof insertTestCompany>>["userIds"] }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db);
  return { db, companyId, userIds };
}

describe("migrations 0008 (CRM/ERP) e 0009 (documentos)", () => {
  it("aplica 0008 e 0009 e cria as tabelas novas com as colunas-padrão", async () => {
    db = await createTestDb();
    expect(db.appliedVersions).toContain(8);
    expect(db.appliedVersions).toContain(9);
    const tables = (await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    for (const table of NEW_TABLES) {
      expect(tables, table).toContain(table);
      const cols = await columns(db, table);
      for (const col of ["id", "company_id", "created_at", "updated_at", "deleted_at"]) expect(cols, `${table}.${col}`).toContain(col);
    }
  });

  it("grava um produto e um pedido de venda com 2 itens e lê de volta", async () => {
    const { db, companyId, userIds } = await withCompany();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?, ?, ?)", ["cli-1", companyId, "Cliente Teste"]);
    await db.execute(
      "INSERT INTO products (id, company_id, sku, name, kind, unit, price, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["prod-1", companyId, "SKU-1", "Switch 24 portas", "produto", "un", 2180, 1500],
    );
    await db.execute(
      "INSERT INTO products (id, company_id, sku, name, kind, unit, price) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["prod-2", companyId, "SRV-1", "Instalação", "servico", "h", 150],
    );
    await db.execute(
      "INSERT INTO sales_orders (id, company_id, number, customer_id, seller_id, subtotal, discount, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["so-1", companyId, 1, "cli-1", userIds.comercial, 4660, 100, 4560],
    );
    await db.execute(
      "INSERT INTO sales_order_items (id, company_id, order_id, product_id, description, qty, unit_price, discount, total, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["soi-1", companyId, "so-1", "prod-1", "Switch 24 portas", 2, 2180, 0, 4360, 1],
    );
    await db.execute(
      "INSERT INTO sales_order_items (id, company_id, order_id, product_id, description, qty, unit_price, discount, total, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["soi-2", companyId, "so-1", "prod-2", "Instalação", 2, 150, 0, 300, 2],
    );

    const [order] = await db.select<Record<string, unknown>[]>("SELECT * FROM sales_orders WHERE id = ?", ["so-1"]);
    expect(order).toMatchObject({ number: 1, status: "rascunho", installments: 1, total: 4560, discount: 100, deleted_at: null });
    expect(order.order_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const items = await db.select<{ product_id: string; qty: number; total: number }[]>(
      "SELECT * FROM sales_order_items WHERE order_id = ? ORDER BY position",
      ["so-1"],
    );
    expect(items.map((item) => [item.product_id, item.qty, item.total])).toEqual([["prod-1", 2, 4360], ["prod-2", 2, 300]]);
    const [product] = await db.select<Record<string, unknown>[]>("SELECT * FROM products WHERE id = ?", ["prod-2"]);
    expect(product).toMatchObject({ kind: "servico", active: 1, cost: 0, tax_rate: 0 });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("numera pedidos, faturas e compras por empresa (o mesmo número pode existir em outra empresa)", async () => {
    const { db, companyId } = await withCompany();
    await insertTestCompany(db, { companyId: "outra", roles: ["ceo"] });
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["so-a", companyId, 1]);
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["so-b", "outra", 1]);
    await expect(db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["so-c", companyId, 1])).rejects.toThrow(/UNIQUE/);
    await db.execute("INSERT INTO invoices (id, company_id, number) VALUES (?, ?, ?)", ["inv-1", companyId, 1]);
    await expect(db.execute("INSERT INTO invoices (id, company_id, number) VALUES (?, ?, ?)", ["inv-2", companyId, 1])).rejects.toThrow(/UNIQUE/);
    await db.execute("INSERT INTO purchase_orders (id, company_id, number) VALUES (?, ?, ?)", ["po-1", companyId, 1]);
    await expect(db.execute("INSERT INTO purchase_orders (id, company_id, number) VALUES (?, ?, ?)", ["po-2", companyId, 1])).rejects.toThrow(/UNIQUE/);
  });

  it("SKU de produto é único por empresa (sem diferenciar caixa) só entre os não excluídos", async () => {
    const { db, companyId } = await withCompany();
    await db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p1", companyId, "ABC-1", "A"]);
    await expect(db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p2", companyId, "abc-1", "B"])).rejects.toThrow(/UNIQUE/);
    await db.execute("UPDATE products SET deleted_at = datetime('now') WHERE id = ?", ["p1"]);
    await db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p3", companyId, "ABC-1", "C"]);
    await db.execute("INSERT INTO products (id, company_id, name) VALUES (?, ?, ?)", ["p4", companyId, "Sem SKU"]);
    await db.execute("INSERT INTO products (id, company_id, name) VALUES (?, ?, ?)", ["p5", companyId, "Outro sem SKU"]);
  });

  it("fatura com parcelas: contas a receber ligadas à fatura, com número da parcela", async () => {
    const { db, companyId } = await withCompany();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?, ?, ?)", ["cli-1", companyId, "Cliente"]);
    await db.execute("INSERT INTO invoices (id, company_id, number, customer_id, installments, total) VALUES (?, ?, ?, ?, ?, ?)", ["inv-1", companyId, 1, "cli-1", 3, 1000]);
    const parts = [333.33, 333.33, 333.34];
    for (const [index, amount] of parts.entries()) {
      await db.execute(
        "INSERT INTO receivables (id, company_id, customer_id, invoice_id, description, amount, due_date, installment_number, installment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`rec-${index + 1}`, companyId, "cli-1", "inv-1", `Fatura 1 - parcela ${index + 1}/3`, amount, `2026-1${index}-10`, index + 1, 3],
      );
    }
    const [invoice] = await db.select<Record<string, unknown>[]>("SELECT * FROM invoices WHERE id = ?", ["inv-1"]);
    expect(invoice).toMatchObject({ status: "emitida", paid_amount: 0 });
    const [sum] = await db.select<{ total: number; n: number }[]>("SELECT round(sum(amount), 2) AS total, count(*) AS n FROM receivables WHERE invoice_id = ?", ["inv-1"]);
    expect(sum).toEqual({ total: 1000, n: 3 });
    const [first] = await db.select<Record<string, unknown>[]>("SELECT * FROM receivables WHERE id = ?", ["rec-1"]);
    expect(first).toMatchObject({ status: "aberta", received_amount: 0, installment_number: 1, installment_count: 3 });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("compra → recebimento → entrada no estoque e conta a pagar ligada", async () => {
    const { db, companyId, userIds } = await withCompany();
    await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES (?, ?, ?)", ["sup-1", companyId, "Fornecedor"]);
    await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES (?, ?, ?)", ["loc-1", companyId, "Depósito"]);
    await db.execute("INSERT INTO inventory_items (id, company_id, name, sku) VALUES (?, ?, ?, ?)", ["item-1", companyId, "Cabo", "CAB-1"]);
    await db.execute("INSERT INTO purchase_orders (id, company_id, number, supplier_id, location_id, expected_date, total) VALUES (?, ?, ?, ?, ?, ?, ?)", ["po-1", companyId, 1, "sup-1", "loc-1", "2026-11-05", 500]);
    await db.execute(
      "INSERT INTO purchase_order_items (id, company_id, order_id, inventory_item_id, description, qty, unit_price, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["poi-1", companyId, "po-1", "item-1", "Cabo", 10, 50, 500],
    );
    await db.execute("INSERT INTO goods_receipts (id, company_id, number, purchase_order_id, supplier_id, location_id, received_by, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["gr-1", companyId, 1, "po-1", "sup-1", "loc-1", userIds.estoquista, 250]);
    await db.execute(
      "INSERT INTO stock_movements (id, company_id, item_id, type, quantity, to_location_id, ref_type, ref_id, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["mov-1", companyId, "item-1", "entrada", 5, "loc-1", "goods_receipt", "gr-1", 50],
    );
    await db.execute(
      "INSERT INTO goods_receipt_items (id, company_id, receipt_id, purchase_order_item_id, inventory_item_id, qty, unit_cost, location_id, stock_movement_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["gri-1", companyId, "gr-1", "poi-1", "item-1", 5, 50, "loc-1", "mov-1"],
    );
    await db.execute("UPDATE purchase_order_items SET received_qty = ? WHERE id = ?", [5, "poi-1"]);
    await db.execute(
      "INSERT INTO payables (id, company_id, description, supplier_id, amount, due_date, purchase_order_id, goods_receipt_id, installment_number, installment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["pay-1", companyId, "Compra 1 - recebimento 1", "sup-1", 250, "2026-12-05", "po-1", "gr-1", 1, 1],
    );
    const [order] = await db.select<Record<string, unknown>[]>("SELECT * FROM purchase_orders WHERE id = ?", ["po-1"]);
    expect(order).toMatchObject({ status: "rascunho", expected_date: "2026-11-05" });
    const [receipt] = await db.select<Record<string, unknown>[]>("SELECT * FROM goods_receipts WHERE id = ?", ["gr-1"]);
    expect(receipt).toMatchObject({ status: "conferido" });
    const [payable] = await db.select<Record<string, unknown>[]>("SELECT * FROM payables WHERE id = ?", ["pay-1"]);
    expect(payable).toMatchObject({ status: "aberta", paid_amount: 0, goods_receipt_id: "gr-1" });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("transação bancária: o fitid do OFX não se repete na mesma conta", async () => {
    const { db, companyId } = await withCompany();
    await db.execute("INSERT INTO bank_accounts (id, company_id, name, opening_balance) VALUES (?, ?, ?, ?)", ["ba-1", companyId, "Conta corrente", 1000]);
    await db.execute("INSERT INTO bank_accounts (id, company_id, name) VALUES (?, ?, ?)", ["ba-2", companyId, "Caixa"]);
    const insertTx = (id: string, account: string, fitid: string | null) =>
      db.execute("INSERT INTO bank_transactions (id, company_id, bank_account_id, posted_at, amount, description, fitid, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, companyId, account, "2026-10-01", -120.5, "Tarifa", fitid, "ofx"]);
    await insertTx("tx-1", "ba-1", "F1");
    await expect(insertTx("tx-2", "ba-1", "F1")).rejects.toThrow(/UNIQUE/);
    await insertTx("tx-3", "ba-2", "F1");
    await insertTx("tx-4", "ba-1", null);
    await insertTx("tx-5", "ba-1", null);
    const [account] = await db.select<Record<string, unknown>[]>("SELECT * FROM bank_accounts WHERE id = ?", ["ba-2"]);
    expect(account).toMatchObject({ kind: "corrente", opening_balance: 0, active: 1, is_default: 0 });
    const [tx] = await db.select<Record<string, unknown>[]>("SELECT * FROM bank_transactions WHERE id = ?", ["tx-1"]);
    expect(tx).toMatchObject({ status: "pendente", amount: -120.5 });
  });

  it("recorrência gera no máximo um lançamento por competência", async () => {
    const { db, companyId } = await withCompany();
    await db.execute("INSERT INTO recurring_entries (id, company_id, kind, description, amount, start_date, day_of_month) VALUES (?, ?, ?, ?, ?, ?, ?)", ["rc-1", companyId, "pagar", "Aluguel", 6800, "2026-01-01", 5]);
    const insertPayable = (id: string, competence: string) =>
      db.execute("INSERT INTO payables (id, company_id, description, amount, recurring_entry_id, competence) VALUES (?, ?, ?, ?, ?, ?)", [id, companyId, "Aluguel", 6800, "rc-1", competence]);
    await insertPayable("pay-1", "2026-10");
    await expect(insertPayable("pay-2", "2026-10")).rejects.toThrow(/UNIQUE/);
    await insertPayable("pay-3", "2026-11");
    const [entry] = await db.select<Record<string, unknown>[]>("SELECT * FROM recurring_entries WHERE id = ?", ["rc-1"]);
    expect(entry).toMatchObject({ frequency: "mensal", active: 1 });
    await db.execute("INSERT INTO recurring_entries (id, company_id, kind, description, amount, start_date) VALUES (?, ?, ?, ?, ?, ?)", ["rc-2", companyId, "receber", "Mensalidade", 500, "2026-01-01"]);
    const insertReceivable = (id: string) =>
      db.execute("INSERT INTO receivables (id, company_id, description, amount, recurring_entry_id, competence) VALUES (?, ?, ?, ?, ?, ?)", [id, companyId, "Mensalidade", 500, "rc-2", "2026-10"]);
    await insertReceivable("rec-1");
    await expect(insertReceivable("rec-2")).rejects.toThrow(/UNIQUE/);
  });

  it("categorias financeiras hierárquicas e baixas parciais ligadas à conta bancária", async () => {
    const { db, companyId } = await withCompany();
    await db.execute("INSERT INTO finance_categories (id, company_id, name, kind) VALUES (?, ?, ?, ?)", ["cat-1", companyId, "Despesas operacionais", "despesa"]);
    await db.execute("INSERT INTO finance_categories (id, company_id, parent_id, name, kind, dre_group) VALUES (?, ?, ?, ?, ?, ?)", ["cat-2", companyId, "cat-1", "Aluguel", "despesa", "despesa"]);
    await db.execute("INSERT INTO bank_accounts (id, company_id, name) VALUES (?, ?, ?)", ["ba-1", companyId, "Conta"]);
    await db.execute("INSERT INTO payables (id, company_id, description, amount, category_id, bank_account_id) VALUES (?, ?, ?, ?, ?, ?)", ["pay-1", companyId, "Aluguel", 1000, "cat-2", "ba-1"]);
    await db.execute("INSERT INTO finance_settlements (id, company_id, payable_id, amount, paid_at, bank_account_id) VALUES (?, ?, ?, ?, ?, ?)", ["st-1", companyId, "pay-1", 400, "2026-10-05", "ba-1"]);
    await db.execute("UPDATE payables SET paid_amount = ?, status = ? WHERE id = ?", [400, "paga_parcial", "pay-1"]);
    const children = await db.select<{ id: string }[]>("SELECT id FROM finance_categories WHERE parent_id = ?", ["cat-1"]);
    expect(children).toEqual([{ id: "cat-2" }]);
    await expect(
      db.execute("INSERT INTO finance_categories (id, company_id, parent_id, name) VALUES (?, ?, ?, ?)", ["cat-x", companyId, "nao-existe", "X"]),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("CRM: atividades, itens de proposta, tags e lotes de importação", async () => {
    const { db, companyId, userIds } = await withCompany();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?, ?, ?)", ["cli-1", companyId, "Cliente"]);
    await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title) VALUES (?, ?, ?, ?)", ["opp-1", companyId, "cli-1", "Negócio"]);
    await db.execute("INSERT INTO proposals (id, company_id, opportunity_id, customer_id, number, title, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)", ["prop-1", companyId, "opp-1", "cli-1", 1, "Proposta", "2026-11-30"]);
    await db.execute("INSERT INTO proposal_items (id, company_id, proposal_id, description, qty, unit_price, total) VALUES (?, ?, ?, ?, ?, ?, ?)", ["pi-1", companyId, "prop-1", "Consultoria", 10, 200, 2000]);
    await db.execute(
      "INSERT INTO crm_activities (id, company_id, entity_type, entity_id, customer_id, kind, subject, due_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["act-1", companyId, "opportunity", "opp-1", "cli-1", "ligacao", "Retornar orçamento", "2026-10-30T14:00:00.000Z", userIds.comercial],
    );
    await db.execute("INSERT INTO tags (id, company_id, name) VALUES (?, ?, ?)", ["tag-1", companyId, "VIP"]);
    await expect(db.execute("INSERT INTO tags (id, company_id, name) VALUES (?, ?, ?)", ["tag-2", companyId, "vip"])).rejects.toThrow(/UNIQUE/);
    await db.execute("INSERT INTO entity_tags (id, company_id, tag_id, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)", ["et-1", companyId, "tag-1", "customer", "cli-1"]);
    await expect(
      db.execute("INSERT INTO entity_tags (id, company_id, tag_id, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)", ["et-2", companyId, "tag-1", "customer", "cli-1"]),
    ).rejects.toThrow(/UNIQUE/);
    await db.execute("INSERT INTO import_batches (id, company_id, entity, filename, rows_ok, rows_err, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)", ["ib-1", companyId, "customers", "clientes.csv", 3, 1, userIds.admin]);
    const [activity] = await db.select<Record<string, unknown>[]>("SELECT * FROM crm_activities WHERE id = ?", ["act-1"]);
    expect(activity).toMatchObject({ kind: "ligacao", done_at: null });
    const [proposal] = await db.select<Record<string, unknown>[]>("SELECT * FROM proposals WHERE id = ?", ["prop-1"]);
    expect(proposal).toMatchObject({ status: "rascunho", subtotal: 0, discount: 0, version: 1 });
    const [tag] = await db.select<Record<string, unknown>[]>("SELECT * FROM tags WHERE id = ?", ["tag-1"]);
    expect(tag).toMatchObject({ color: "neutral" });
    const [batch] = await db.select<Record<string, unknown>[]>("SELECT * FROM import_batches WHERE id = ?", ["ib-1"]);
    expect(batch).toMatchObject({ status: "concluida", mode: "skip-errors", dry_run: 0, errors_json: "[]" });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("colunas novas em tabelas antigas (ALTER TABLE ADD COLUMN)", async () => {
    db = await createTestDb();
    const expected: Record<string, string[]> = {
      payables: ["category_id", "bank_account_id", "installment_number", "installment_count", "paid_amount", "payment_method", "document_number", "issue_date", "competence", "notes", "ref_type", "ref_id", "purchase_order_id", "goods_receipt_id", "recurring_entry_id"],
      receivables: ["description", "category_id", "bank_account_id", "cost_center_id", "installment_number", "installment_count", "received_amount", "payment_method", "document_number", "issue_date", "competence", "notes", "invoice_id", "sales_order_id", "recurring_entry_id"],
      customers: ["trade_name", "state_registration", "website", "source", "notes", "payment_terms", "credit_limit", "price_list_id"],
      contacts: ["is_primary", "whatsapp", "notes"],
      suppliers: ["trade_name", "contact_name", "address_json", "state_registration", "website", "notes", "category"],
      opportunities: ["lead_id", "contact_id", "source", "notes", "closed_at"],
      proposals: ["number", "title", "customer_id", "contact_id", "valid_until", "subtotal", "discount", "payment_terms", "notes", "sent_at", "decided_at", "created_by"],
      stock_movements: ["unit_cost"],
      employees: ["document", "phone", "birth_date", "contract_type", "daily_minutes", "manager_employee_id", "termination_date", "termination_reason", "notes"],
      hr_tasks: ["category"],
      documents: ["storage_key", "original_name", "mime", "size_bytes", "sha256", "parent_version_id", "folder", "description", "entity_type", "entity_id"],
    };
    for (const [table, cols] of Object.entries(expected)) {
      const actual = await columns(db, table);
      for (const col of cols) expect(actual, `${table}.${col}`).toContain(col);
    }
  });

  it("documentos: versões encadeadas por parent_version_id e metadados do arquivo", async () => {
    const { db, companyId, userIds } = await withCompany();
    const insertDoc = (id: string, version: number, parent: string | null, sha: string) =>
      db.execute(
        "INSERT INTO documents (id, company_id, title, type, file_path, version, uploaded_by, storage_key, original_name, mime, size_bytes, sha256, parent_version_id, entity_type, entity_id, folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, companyId, "Contrato.pdf", "PDF", "/Comercial/Contrato.pdf", version, userIds.comercial, `${companyId}/${sha.slice(0, 2)}/${sha}`, "Contrato.pdf", "application/pdf", 1024, sha, parent, "customer", "cli-1", "/Comercial"],
      );
    await insertDoc("doc-1", 1, null, "ab".repeat(32));
    await insertDoc("doc-2", 2, "doc-1", "cd".repeat(32));
    const [latest] = await db.select<Record<string, unknown>[]>("SELECT * FROM documents WHERE parent_version_id = ?", ["doc-1"]);
    expect(latest).toMatchObject({ id: "doc-2", version: 2, size_bytes: 1024, mime: "application/pdf" });
    await expect(insertDoc("doc-3", 3, "nao-existe", "ef".repeat(32))).rejects.toThrow(/FOREIGN KEY/);
  });

  it("atualiza um banco antigo (até a 0007) sem perder dados e preenche os valores novos", async () => {
    db = await createTestDb({ upTo: 7 });
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await db.execute("INSERT INTO payables (id, company_id, description, amount, status) VALUES (?, ?, ?, ?, ?)", ["pay-paga", companyId, "Aluguel", 6800, "paga"]);
    await db.execute("INSERT INTO payables (id, company_id, description, amount, status) VALUES (?, ?, ?, ?, ?)", ["pay-aberta", companyId, "Energia", 300, "aberta"]);
    await db.execute("INSERT INTO receivables (id, company_id, ref_type, ref_id, amount, status) VALUES (?, ?, ?, ?, ?, ?)", ["rec-1", companyId, "Manual", "Consultoria de outubro", 1200, "recebida"]);
    await db.execute("INSERT INTO documents (id, company_id, title, file_path) VALUES (?, ?, ?, ?)", ["doc-1", companyId, "Antigo.pdf", "/Antigo.pdf"]);
    await db.migrate();
    expect(db.appliedVersions).toContain(9);
    const payables = await db.select<{ id: string; paid_amount: number }[]>("SELECT id, paid_amount FROM payables ORDER BY id");
    expect(payables).toEqual([{ id: "pay-aberta", paid_amount: 0 }, { id: "pay-paga", paid_amount: 6800 }]);
    const [receivable] = await db.select<Record<string, unknown>[]>("SELECT * FROM receivables WHERE id = ?", ["rec-1"]);
    expect(receivable).toMatchObject({ description: "Consultoria de outubro", received_amount: 1200, ref_id: "Consultoria de outubro" });
    const [doc] = await db.select<Record<string, unknown>[]>("SELECT * FROM documents WHERE id = ?", ["doc-1"]);
    expect(doc).toMatchObject({ title: "Antigo.pdf", storage_key: null, sha256: null, version: 1 });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("migration 0011 (mesclagem de clientes, admissão e índices das telas novas)", () => {
  it("cliente mesclado aponta para o que ficou (chave estrangeira) e colaborador ganha dados de admissão", async () => {
    const { db, companyId } = await withCompany();
    expect(db.appliedVersions).toContain(11);
    await db.execute("INSERT INTO customers (id, company_id, name, email) VALUES (?, ?, ?, ?)", ["keep", companyId, "NorteLog", "a@x.com"]);
    await db.execute("INSERT INTO customers (id, company_id, name, email, merged_into_id, deleted_at) VALUES (?, ?, ?, ?, ?, datetime('now'))", ["dup", companyId, "Nortelog", "A@X.com", "keep"]);
    const merged = await db.select<{ id: string; merged_into_id: string | null }[]>("SELECT id, merged_into_id FROM customers ORDER BY id");
    expect(merged).toEqual([{ id: "dup", merged_into_id: "keep" }, { id: "keep", merged_into_id: null }]);
    await expect(
      db.execute("INSERT INTO customers (id, company_id, name, merged_into_id) VALUES (?, ?, ?, ?)", ["dup-2", companyId, "X", "nao-existe"]),
    ).rejects.toThrow(/FOREIGN KEY/);

    await db.execute(
      "INSERT INTO employees (id, company_id, name, rg, pis, emergency_contact_name, emergency_contact_phone) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["emp-1", companyId, "Rafael Souza", "12.345.678-9", "123.45678.90-1", "Ana Souza", "(15) 99999-0000"],
    );
    const [employee] = await db.select<Record<string, unknown>[]>("SELECT * FROM employees WHERE id = ?", ["emp-1"]);
    expect(employee).toMatchObject({ rg: "12.345.678-9", pis: "123.45678.90-1", address_json: "{}", emergency_contact_name: "Ana Souza", emergency_contact_phone: "(15) 99999-0000" });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("cria os índices de relatórios, vínculos e versões de documento", async () => {
    db = await createTestDb();
    const indexes = (await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'index'")).map((row) => row.name);
    for (const name of [
      "idx_customers_merged",
      "idx_sales_orders_seller",
      "idx_stock_movements_ref",
      "idx_payables_supplier",
      "idx_crm_activities_contact",
      "idx_bank_transactions_payable",
      "idx_bank_transactions_receivable",
      "idx_documents_folder_title",
    ]) {
      expect(indexes, name).toContain(name);
    }
  });

  it("atualiza um banco até a 0010 sem perder dados", async () => {
    db = await createTestDb({ upTo: 10 });
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?, ?, ?)", ["cli-1", companyId, "Cliente antigo"]);
    await db.execute("INSERT INTO employees (id, company_id, name, document) VALUES (?, ?, ?, ?)", ["emp-1", companyId, "Colaborador antigo", "123.456.789-09"]);
    await db.migrate();
    expect(db.appliedVersions).toContain(11);
    const [customer] = await db.select<Record<string, unknown>[]>("SELECT * FROM customers WHERE id = ?", ["cli-1"]);
    expect(customer).toMatchObject({ name: "Cliente antigo", merged_into_id: null });
    const [employee] = await db.select<Record<string, unknown>[]>("SELECT * FROM employees WHERE id = ?", ["emp-1"]);
    expect(employee).toMatchObject({ name: "Colaborador antigo", document: "123.456.789-09", rg: null, address_json: "{}" });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });
});
