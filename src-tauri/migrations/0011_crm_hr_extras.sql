-- Complementos de CRM, RH e índices para as telas da Fase B (mesclagem de clientes, admissão, relatórios,
-- conciliação e versões de documento). Não muda dado existente: só colunas com DEFAULT NULL/'{}' e índices.
-- Convenções do 0001 (IDs TEXT, timestamps ISO, company_id, soft delete). Migrations anteriores não se editam.

-- CRM: mesclar clientes duplicados. O cliente mesclado recebe soft delete (deleted_at) e aponta para o que ficou;
-- contatos, oportunidades, atividades e o resto passam para o que ficou (mergeCustomers, Tarefa 7).
ALTER TABLE customers ADD COLUMN merged_into_id TEXT REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_customers_merged ON customers(merged_into_id);

-- RH: dados de admissão do colaborador (sem salário: remuneração continua só na 0007, lida pela folha).
-- address_json: { logradouro, numero, complemento, bairro, cidade, uf, cep }.
ALTER TABLE employees ADD COLUMN rg                      TEXT;
ALTER TABLE employees ADD COLUMN pis                     TEXT;
ALTER TABLE employees ADD COLUMN address_json            TEXT DEFAULT '{}';
ALTER TABLE employees ADD COLUMN emergency_contact_name  TEXT;
ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT;

-- Relatórios (vendas por vendedor), vínculos de estoque/financeiro e conciliação bancária.
CREATE INDEX IF NOT EXISTS idx_sales_orders_seller ON sales_orders(company_id, seller_id, order_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_payables_supplier ON payables(supplier_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_payable ON bank_transactions(payable_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_receivable ON bank_transactions(receivable_id);

-- Documentos: nova versão = mesmo título na mesma pasta (busca da versão anterior no upload).
CREATE INDEX IF NOT EXISTS idx_documents_folder_title ON documents(company_id, folder, title);
