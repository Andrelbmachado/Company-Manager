-- CRM/ERP: catálogo e listas de preço, pedidos de venda e faturas, compras e recebimentos,
-- financeiro (plano de contas, contas bancárias, conciliação, recorrências, baixas), inventário de estoque,
-- CRM (atividades, itens de proposta, tags, segmentos salvos), RH (banco de horas) e lotes de importação.
--
-- Convenções do 0001: IDs TEXT (uuid gerado no app), timestamps TEXT ISO-8601, company_id, soft delete (deleted_at).
-- Dinheiro: REAL com 2 casas; o app arredonda para centavos antes de gravar (src/lib/money.ts).
-- Descontos são VALORES em R$ (não percentuais). tax_rate é percentual (5 = 5%). Quantidades em REAL.
-- Totais de pedido/fatura/compra: total = subtotal - discount + shipping + tax_total; subtotal = soma de items.total;
-- item: total = qty * unit_price - discount.
-- `number` é sequencial por empresa e conta também os excluídos (soft delete): próximo número com
-- nextSequenceNumber (src/lib/db/sequence.ts).
-- Sem CHECK de domínio: os valores aceitos estão em src/types/index.ts (mudar um CHECK exigiria recriar a tabela).
-- ALTER TABLE ADD COLUMN: com chaves estrangeiras ligadas, coluna com REFERENCES só pode ter DEFAULT NULL.

-- ----------------------------------------------------------------
-- FINANCEIRO: plano de contas e contas bancárias
-- ----------------------------------------------------------------
-- kind: receita | despesa. dre_group (linha da DRE): receita | deducao | custo | despesa | financeiro | outros.
CREATE TABLE IF NOT EXISTS finance_categories (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  parent_id     TEXT REFERENCES finance_categories(id),
  code          TEXT,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'despesa',
  dre_group     TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_finance_categories_company ON finance_categories(company_id, kind);
CREATE INDEX IF NOT EXISTS idx_finance_categories_parent ON finance_categories(parent_id);

-- kind: corrente | poupanca | caixa | cartao | investimento.
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'corrente',
  bank_code       TEXT,
  bank_name       TEXT,
  agency          TEXT,
  account_number  TEXT,
  pix_key         TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_date    TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts(company_id);

-- ----------------------------------------------------------------
-- CATÁLOGO: produtos/serviços e listas de preço
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_lists (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  description   TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,
  valid_from    TEXT,
  valid_to      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_lists_company ON price_lists(company_id);

-- kind: produto | servico. inventory_item_id liga o produto ao item de estoque (entrada/saída de mercadoria).
CREATE TABLE IF NOT EXISTS products (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  sku                 TEXT,
  name                TEXT NOT NULL,
  description         TEXT,
  kind                TEXT NOT NULL DEFAULT 'produto',
  category            TEXT,
  unit                TEXT NOT NULL DEFAULT 'un',
  price               REAL NOT NULL DEFAULT 0,
  cost                REAL NOT NULL DEFAULT 0,
  tax_rate            REAL NOT NULL DEFAULT 0,
  barcode             TEXT,
  ncm                 TEXT,
  service_code        TEXT,
  inventory_item_id   TEXT REFERENCES inventory_items(id),
  revenue_category_id TEXT REFERENCES finance_categories(id),
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);
-- SKU é a chave natural da importação: único por empresa entre os não excluídos, sem diferenciar maiúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_sku ON products(company_id, sku COLLATE NOCASE) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id, kind, active);
CREATE INDEX IF NOT EXISTS idx_products_item ON products(inventory_item_id);

CREATE TABLE IF NOT EXISTS price_list_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  price_list_id TEXT NOT NULL REFERENCES price_lists(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  price         REAL NOT NULL DEFAULT 0,
  min_qty       REAL NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_list_items ON price_list_items(price_list_id, product_id, min_qty) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON price_list_items(product_id);

-- Clientes: dados fiscais/comerciais e tabela de preço do cliente.
ALTER TABLE customers ADD COLUMN trade_name         TEXT;
ALTER TABLE customers ADD COLUMN state_registration TEXT;
ALTER TABLE customers ADD COLUMN website            TEXT;
ALTER TABLE customers ADD COLUMN source             TEXT;
ALTER TABLE customers ADD COLUMN notes              TEXT;
ALTER TABLE customers ADD COLUMN payment_terms      TEXT;
ALTER TABLE customers ADD COLUMN credit_limit       REAL;
ALTER TABLE customers ADD COLUMN price_list_id      TEXT REFERENCES price_lists(id);
CREATE INDEX IF NOT EXISTS idx_customers_document ON customers(company_id, document);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(company_id, email);

-- Contatos e fornecedores: campos de cadastro completos.
ALTER TABLE contacts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN whatsapp   TEXT;
ALTER TABLE contacts ADD COLUMN notes      TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_company_email ON contacts(company_id, email);

ALTER TABLE suppliers ADD COLUMN trade_name         TEXT;
ALTER TABLE suppliers ADD COLUMN contact_name       TEXT;
ALTER TABLE suppliers ADD COLUMN address_json       TEXT DEFAULT '{}';
ALTER TABLE suppliers ADD COLUMN state_registration TEXT;
ALTER TABLE suppliers ADD COLUMN website            TEXT;
ALTER TABLE suppliers ADD COLUMN notes              TEXT;
ALTER TABLE suppliers ADD COLUMN category           TEXT;
CREATE INDEX IF NOT EXISTS idx_suppliers_document ON suppliers(company_id, document);

-- ----------------------------------------------------------------
-- VENDAS: pedidos e faturas
-- ----------------------------------------------------------------
-- status: rascunho | confirmado | faturado | entregue | cancelado.
CREATE TABLE IF NOT EXISTS sales_orders (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  number          INTEGER NOT NULL,
  customer_id     TEXT REFERENCES customers(id),
  contact_id      TEXT REFERENCES contacts(id),
  opportunity_id  TEXT REFERENCES opportunities(id),
  proposal_id     TEXT REFERENCES proposals(id),
  price_list_id   TEXT REFERENCES price_lists(id),
  seller_id       TEXT REFERENCES users(id),
  location_id     TEXT REFERENCES stock_locations(id),
  status          TEXT NOT NULL DEFAULT 'rascunho',
  order_date      TEXT NOT NULL DEFAULT (date('now')),
  delivery_date   TEXT,
  payment_terms   TEXT,
  installments    INTEGER NOT NULL DEFAULT 1,
  subtotal        REAL NOT NULL DEFAULT 0,
  discount        REAL NOT NULL DEFAULT 0,
  shipping        REAL NOT NULL DEFAULT 0,
  tax_total       REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  notes           TEXT,
  internal_notes  TEXT,
  confirmed_at    TEXT,
  invoiced_at     TEXT,
  delivered_at    TEXT,
  cancelled_at    TEXT,
  cancel_reason   TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_sales_orders_company ON sales_orders(company_id, status, order_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  order_id      TEXT NOT NULL REFERENCES sales_orders(id),
  product_id    TEXT REFERENCES products(id),
  description   TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'un',
  qty           REAL NOT NULL DEFAULT 1,
  unit_price    REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  tax_rate      REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  delivered_qty REAL NOT NULL DEFAULT 0,
  invoiced_qty  REAL NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(order_id, position);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_product ON sales_order_items(product_id);

-- status: rascunho | emitida | paga_parcial | paga | vencida | cancelada.
-- As parcelas são contas a receber (receivables.invoice_id + installment_number/installment_count).
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  number          INTEGER NOT NULL,
  sales_order_id  TEXT REFERENCES sales_orders(id),
  customer_id     TEXT REFERENCES customers(id),
  status          TEXT NOT NULL DEFAULT 'emitida',
  issue_date      TEXT NOT NULL DEFAULT (date('now')),
  due_date        TEXT,
  installments    INTEGER NOT NULL DEFAULT 1,
  payment_terms   TEXT,
  payment_method  TEXT,
  subtotal        REAL NOT NULL DEFAULT 0,
  discount        REAL NOT NULL DEFAULT 0,
  shipping        REAL NOT NULL DEFAULT 0,
  tax_total       REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  paid_amount     REAL NOT NULL DEFAULT 0,
  category_id     TEXT REFERENCES finance_categories(id),
  bank_account_id TEXT REFERENCES bank_accounts(id),
  fiscal_number   TEXT,
  fiscal_series   TEXT,
  fiscal_key      TEXT,
  notes           TEXT,
  cancelled_at    TEXT,
  cancel_reason   TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id, status, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(sales_order_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  invoice_id          TEXT NOT NULL REFERENCES invoices(id),
  sales_order_item_id TEXT REFERENCES sales_order_items(id),
  product_id          TEXT REFERENCES products(id),
  description         TEXT NOT NULL,
  unit                TEXT NOT NULL DEFAULT 'un',
  qty                 REAL NOT NULL DEFAULT 1,
  unit_price          REAL NOT NULL DEFAULT 0,
  discount            REAL NOT NULL DEFAULT 0,
  tax_rate            REAL NOT NULL DEFAULT 0,
  total               REAL NOT NULL DEFAULT 0,
  position            INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, position);

-- ----------------------------------------------------------------
-- COMPRAS: pedidos de compra e recebimentos
-- ----------------------------------------------------------------
-- status: rascunho | aprovado | enviado | recebido_parcial | recebido | cancelado. expected_date = previsão de entrega.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  number          INTEGER NOT NULL,
  supplier_id     TEXT REFERENCES suppliers(id),
  status          TEXT NOT NULL DEFAULT 'rascunho',
  order_date      TEXT NOT NULL DEFAULT (date('now')),
  expected_date   TEXT,
  location_id     TEXT REFERENCES stock_locations(id),
  payment_terms   TEXT,
  installments    INTEGER NOT NULL DEFAULT 1,
  subtotal        REAL NOT NULL DEFAULT 0,
  discount        REAL NOT NULL DEFAULT 0,
  shipping        REAL NOT NULL DEFAULT 0,
  tax_total       REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  category_id     TEXT REFERENCES finance_categories(id),
  cost_center_id  TEXT REFERENCES cost_centers(id),
  notes           TEXT,
  approved_by     TEXT REFERENCES users(id),
  approved_at     TEXT,
  sent_at         TEXT,
  received_at     TEXT,
  cancelled_at    TEXT,
  cancel_reason   TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON purchase_orders(company_id, status, expected_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id),
  order_id          TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id        TEXT REFERENCES products(id),
  inventory_item_id TEXT REFERENCES inventory_items(id),
  description       TEXT NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'un',
  qty               REAL NOT NULL DEFAULT 1,
  unit_price        REAL NOT NULL DEFAULT 0,
  discount          REAL NOT NULL DEFAULT 0,
  tax_rate          REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  received_qty      REAL NOT NULL DEFAULT 0,
  position          INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(order_id, position);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_item ON purchase_order_items(inventory_item_id);

-- Recebimento (entrada de mercadoria). status: conferido | estornado.
CREATE TABLE IF NOT EXISTS goods_receipts (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(id),
  number                  INTEGER NOT NULL,
  purchase_order_id       TEXT REFERENCES purchase_orders(id),
  supplier_id             TEXT REFERENCES suppliers(id),
  location_id             TEXT REFERENCES stock_locations(id),
  status                  TEXT NOT NULL DEFAULT 'conferido',
  received_at             TEXT NOT NULL DEFAULT (datetime('now')),
  received_by             TEXT REFERENCES users(id),
  supplier_invoice_number TEXT,
  total                   REAL NOT NULL DEFAULT 0,
  notes                   TEXT,
  reversed_at             TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_order ON goods_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_company ON goods_receipts(company_id, received_at);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL REFERENCES companies(id),
  receipt_id             TEXT NOT NULL REFERENCES goods_receipts(id),
  purchase_order_item_id TEXT REFERENCES purchase_order_items(id),
  inventory_item_id      TEXT REFERENCES inventory_items(id),
  product_id             TEXT REFERENCES products(id),
  qty                    REAL NOT NULL DEFAULT 0,
  unit_cost              REAL NOT NULL DEFAULT 0,
  location_id            TEXT REFERENCES stock_locations(id),
  stock_movement_id      TEXT REFERENCES stock_movements(id),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_receipt ON goods_receipt_items(receipt_id);

-- ----------------------------------------------------------------
-- FINANCEIRO: recorrências, importações, extrato bancário, colunas novas em pagar/receber e baixas
-- ----------------------------------------------------------------
-- kind: pagar | receber. frequency: semanal | mensal | bimestral | trimestral | semestral | anual.
-- last_competence = competência ('YYYY-MM'; semanal: 'YYYY-MM-DD') do último lançamento gerado.
CREATE TABLE IF NOT EXISTS recurring_entries (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  kind            TEXT NOT NULL DEFAULT 'pagar',
  description     TEXT NOT NULL,
  amount          REAL NOT NULL DEFAULT 0,
  frequency       TEXT NOT NULL DEFAULT 'mensal',
  day_of_month    INTEGER,
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  last_competence TEXT,
  supplier_id     TEXT REFERENCES suppliers(id),
  customer_id     TEXT REFERENCES customers(id),
  category_id     TEXT REFERENCES finance_categories(id),
  cost_center_id  TEXT REFERENCES cost_centers(id),
  bank_account_id TEXT REFERENCES bank_accounts(id),
  active          INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_recurring_entries_company ON recurring_entries(company_id, kind, active);

-- Lote de importação CSV/XLSX. mode: all-or-nothing | skip-errors. status: concluida | com_erros | falhou | simulacao.
-- errors_json: [{ row, field, message }]; mapping_json: { coluna do arquivo: campo }.
CREATE TABLE IF NOT EXISTS import_batches (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  entity        TEXT NOT NULL,
  filename      TEXT,
  sheet_name    TEXT,
  format        TEXT,
  mode          TEXT NOT NULL DEFAULT 'skip-errors',
  dry_run       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'concluida',
  rows_total    INTEGER NOT NULL DEFAULT 0,
  rows_ok       INTEGER NOT NULL DEFAULT 0,
  rows_err      INTEGER NOT NULL DEFAULT 0,
  inserted      INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  errors_json   TEXT NOT NULL DEFAULT '[]',
  mapping_json  TEXT NOT NULL DEFAULT '{}',
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_import_batches_company ON import_batches(company_id, entity, created_at);

-- Contas a pagar: categoria, conta bancária, parcelas, baixa parcial, documento, competência e origem.
ALTER TABLE payables ADD COLUMN category_id        TEXT REFERENCES finance_categories(id);
ALTER TABLE payables ADD COLUMN bank_account_id    TEXT REFERENCES bank_accounts(id);
ALTER TABLE payables ADD COLUMN installment_number INTEGER;
ALTER TABLE payables ADD COLUMN installment_count  INTEGER;
ALTER TABLE payables ADD COLUMN paid_amount        REAL NOT NULL DEFAULT 0;
ALTER TABLE payables ADD COLUMN payment_method     TEXT;
ALTER TABLE payables ADD COLUMN document_number    TEXT;
ALTER TABLE payables ADD COLUMN issue_date         TEXT;
ALTER TABLE payables ADD COLUMN competence         TEXT;
ALTER TABLE payables ADD COLUMN notes              TEXT;
ALTER TABLE payables ADD COLUMN ref_type           TEXT;
ALTER TABLE payables ADD COLUMN ref_id             TEXT;
ALTER TABLE payables ADD COLUMN purchase_order_id  TEXT REFERENCES purchase_orders(id);
ALTER TABLE payables ADD COLUMN goods_receipt_id   TEXT REFERENCES goods_receipts(id);
ALTER TABLE payables ADD COLUMN recurring_entry_id TEXT REFERENCES recurring_entries(id);

-- Contas a receber: descrição própria (antes ia em ref_id), categoria, conta, parcelas da fatura e baixa parcial.
ALTER TABLE receivables ADD COLUMN description        TEXT;
ALTER TABLE receivables ADD COLUMN category_id        TEXT REFERENCES finance_categories(id);
ALTER TABLE receivables ADD COLUMN bank_account_id    TEXT REFERENCES bank_accounts(id);
ALTER TABLE receivables ADD COLUMN cost_center_id     TEXT REFERENCES cost_centers(id);
ALTER TABLE receivables ADD COLUMN installment_number INTEGER;
ALTER TABLE receivables ADD COLUMN installment_count  INTEGER;
ALTER TABLE receivables ADD COLUMN received_amount    REAL NOT NULL DEFAULT 0;
ALTER TABLE receivables ADD COLUMN payment_method     TEXT;
ALTER TABLE receivables ADD COLUMN document_number    TEXT;
ALTER TABLE receivables ADD COLUMN issue_date         TEXT;
ALTER TABLE receivables ADD COLUMN competence         TEXT;
ALTER TABLE receivables ADD COLUMN notes              TEXT;
ALTER TABLE receivables ADD COLUMN invoice_id         TEXT REFERENCES invoices(id);
ALTER TABLE receivables ADD COLUMN sales_order_id     TEXT REFERENCES sales_orders(id);
ALTER TABLE receivables ADD COLUMN recurring_entry_id TEXT REFERENCES recurring_entries(id);

-- Dados antigos: a tela Financeiro gravava a descrição do recebível em ref_id; contas já pagas/recebidas ficam quitadas.
UPDATE receivables SET description = ref_id WHERE description IS NULL AND ref_id IS NOT NULL;
UPDATE payables SET paid_amount = amount WHERE status = 'paga';
UPDATE receivables SET received_amount = amount WHERE status = 'recebida';

-- Recorrência: no máximo um lançamento por competência (inclui excluídos: lançamento apagado não volta sozinho).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payables_recurring ON payables(recurring_entry_id, competence) WHERE recurring_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_receivables_recurring ON receivables(recurring_entry_id, competence) WHERE recurring_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payables_category ON payables(company_id, category_id);
CREATE INDEX IF NOT EXISTS idx_payables_purchase ON payables(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receivables_category ON receivables(company_id, category_id);
CREATE INDEX IF NOT EXISTS idx_receivables_invoice ON receivables(invoice_id);
CREATE INDEX IF NOT EXISTS idx_receivables_customer ON receivables(customer_id);

-- Extrato bancário. amount: positivo = entrada (crédito), negativo = saída (débito). posted_at: 'YYYY-MM-DD'.
-- source: ofx | csv | manual. status: pendente | conciliada | ignorada. fitid = id do lançamento no OFX.
CREATE TABLE IF NOT EXISTS bank_transactions (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  posted_at       TEXT NOT NULL,
  amount          REAL NOT NULL DEFAULT 0,
  description     TEXT,
  memo            TEXT,
  fitid           TEXT,
  check_number    TEXT,
  balance_after   REAL,
  source          TEXT NOT NULL DEFAULT 'manual',
  status          TEXT NOT NULL DEFAULT 'pendente',
  payable_id      TEXT REFERENCES payables(id),
  receivable_id   TEXT REFERENCES receivables(id),
  category_id     TEXT REFERENCES finance_categories(id),
  import_batch_id TEXT REFERENCES import_batches(id),
  reconciled_at   TEXT,
  reconciled_by   TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
-- Reimportar o mesmo OFX não duplica: fitid único por conta (inclui excluídos).
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_transactions_fitid ON bank_transactions(bank_account_id, fitid) WHERE fitid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(company_id, bank_account_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(company_id, status);

-- Baixa (pagamento/recebimento total ou parcial) de uma conta: exatamente um de payable_id / receivable_id.
-- paid_at: 'YYYY-MM-DD'. amount = valor principal baixado; interest/fine/discount = juros, multa e desconto.
CREATE TABLE IF NOT EXISTS finance_settlements (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  payable_id          TEXT REFERENCES payables(id),
  receivable_id       TEXT REFERENCES receivables(id),
  amount              REAL NOT NULL DEFAULT 0,
  paid_at             TEXT NOT NULL,
  bank_account_id     TEXT REFERENCES bank_accounts(id),
  bank_transaction_id TEXT REFERENCES bank_transactions(id),
  payment_method      TEXT,
  interest            REAL NOT NULL DEFAULT 0,
  fine                REAL NOT NULL DEFAULT 0,
  discount            REAL NOT NULL DEFAULT 0,
  notes               TEXT,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_finance_settlements_payable ON finance_settlements(payable_id);
CREATE INDEX IF NOT EXISTS idx_finance_settlements_receivable ON finance_settlements(receivable_id);
CREATE INDEX IF NOT EXISTS idx_finance_settlements_company ON finance_settlements(company_id, paid_at);

-- ----------------------------------------------------------------
-- ESTOQUE: inventário (contagem) e custo da movimentação
-- ----------------------------------------------------------------
ALTER TABLE stock_movements ADD COLUMN unit_cost REAL;

-- status: aberta | concluida | cancelada. Ajuste da diferença vira stock_movements (adjustment_movement_id).
CREATE TABLE IF NOT EXISTS inventory_counts (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  number        INTEGER NOT NULL,
  location_id   TEXT REFERENCES stock_locations(id),
  status        TEXT NOT NULL DEFAULT 'aberta',
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  counted_by    TEXT REFERENCES users(id),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (company_id, number)
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL REFERENCES companies(id),
  count_id               TEXT NOT NULL REFERENCES inventory_counts(id),
  item_id                TEXT NOT NULL REFERENCES inventory_items(id),
  location_id            TEXT REFERENCES stock_locations(id),
  expected_qty           REAL NOT NULL DEFAULT 0,
  counted_qty            REAL,
  adjustment_movement_id TEXT REFERENCES stock_movements(id),
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count ON inventory_count_items(count_id);

-- ----------------------------------------------------------------
-- CRM: atividades, propostas com itens, oportunidades ligadas ao lead, tags e segmentos salvos
-- ----------------------------------------------------------------
-- entity_type: customer | contact | lead | opportunity | proposal. kind: ligacao | email | reuniao | nota | tarefa.
-- customer_id: cliente ligado (linha do tempo da ficha do cliente), quando houver. user_id = responsável.
-- Pendente = done_at NULL; atrasada = pendente com due_at no passado.
CREATE TABLE IF NOT EXISTS crm_activities (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  customer_id   TEXT REFERENCES customers(id),
  contact_id    TEXT REFERENCES contacts(id),
  kind          TEXT NOT NULL DEFAULT 'nota',
  subject       TEXT,
  body          TEXT,
  due_at        TEXT,
  done_at       TEXT,
  outcome       TEXT,
  user_id       TEXT REFERENCES users(id),
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_entity ON crm_activities(company_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_customer ON crm_activities(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_due ON crm_activities(company_id, user_id, done_at, due_at);

-- Propostas: número, cliente, validade e totais (value continua sendo o total). status: rascunho | enviada | aceita | recusada | expirada.
ALTER TABLE proposals ADD COLUMN number        INTEGER;
ALTER TABLE proposals ADD COLUMN title         TEXT;
ALTER TABLE proposals ADD COLUMN customer_id   TEXT REFERENCES customers(id);
ALTER TABLE proposals ADD COLUMN contact_id    TEXT REFERENCES contacts(id);
ALTER TABLE proposals ADD COLUMN valid_until   TEXT;
ALTER TABLE proposals ADD COLUMN subtotal      REAL NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN discount      REAL NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN payment_terms TEXT;
ALTER TABLE proposals ADD COLUMN notes         TEXT;
ALTER TABLE proposals ADD COLUMN sent_at       TEXT;
ALTER TABLE proposals ADD COLUMN decided_at    TEXT;
ALTER TABLE proposals ADD COLUMN created_by    TEXT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proposals_number ON proposals(company_id, number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_opportunity ON proposals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_proposals_customer ON proposals(customer_id);

CREATE TABLE IF NOT EXISTS proposal_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  proposal_id   TEXT NOT NULL REFERENCES proposals(id),
  product_id    TEXT REFERENCES products(id),
  description   TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'un',
  qty           REAL NOT NULL DEFAULT 1,
  unit_price    REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  tax_rate      REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposal_items_proposal ON proposal_items(proposal_id, position);

-- Oportunidade nascida de um lead (conversão lead → oportunidade → cliente).
ALTER TABLE opportunities ADD COLUMN lead_id    TEXT REFERENCES leads(id);
ALTER TABLE opportunities ADD COLUMN contact_id TEXT REFERENCES contacts(id);
ALTER TABLE opportunities ADD COLUMN source     TEXT;
ALTER TABLE opportunities ADD COLUMN notes      TEXT;
ALTER TABLE opportunities ADD COLUMN closed_at  TEXT;
CREATE INDEX IF NOT EXISTS idx_opportunities_lead ON opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id);

-- color: tom do StatusBadge (info | success | warning | orange | danger | violet | neutral).
-- entity_type: a que a tag se aplica (customer, lead, ...); NULL = qualquer.
CREATE TABLE IF NOT EXISTS tags (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT 'neutral',
  entity_type   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tags_name ON tags(company_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS entity_tags (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  tag_id        TEXT NOT NULL REFERENCES tags(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_tags ON entity_tags(tag_id, entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(company_id, entity_type, entity_id);

-- Segmento/filtro salvo de uma lista. user_id NULL = compartilhado com a empresa.
CREATE TABLE IF NOT EXISTS saved_views (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  user_id       TEXT REFERENCES users(id),
  entity_type   TEXT NOT NULL,
  name          TEXT NOT NULL,
  filters_json  TEXT NOT NULL DEFAULT '{}',
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_saved_views_entity ON saved_views(company_id, entity_type);

-- ----------------------------------------------------------------
-- RH: ciclo de admissão/desligamento e banco de horas (sem salário: remuneração continua só na 0007)
-- ----------------------------------------------------------------
-- contract_type: clt | pj | estagio | temporario. daily_minutes = jornada diária (banco de horas).
ALTER TABLE employees ADD COLUMN document            TEXT;
ALTER TABLE employees ADD COLUMN phone               TEXT;
ALTER TABLE employees ADD COLUMN birth_date          TEXT;
ALTER TABLE employees ADD COLUMN contract_type       TEXT;
ALTER TABLE employees ADD COLUMN daily_minutes       INTEGER NOT NULL DEFAULT 480;
ALTER TABLE employees ADD COLUMN manager_employee_id TEXT REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN termination_date    TEXT;
ALTER TABLE employees ADD COLUMN termination_reason  TEXT;
ALTER TABLE employees ADD COLUMN notes               TEXT;
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(company_id, email);

-- category: geral | admissao | desligamento (checklists do ciclo do colaborador).
ALTER TABLE hr_tasks ADD COLUMN category TEXT NOT NULL DEFAULT 'geral';

-- Banco de horas. minutes: positivo = crédito (hora extra), negativo = débito. status: pendente | aprovada | recusada.
CREATE TABLE IF NOT EXISTS hr_time_entries (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  entry_date    TEXT NOT NULL,
  minutes       INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente',
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_time_entries_employee ON hr_time_entries(employee_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_hr_time_entries_company ON hr_time_entries(company_id, status);
