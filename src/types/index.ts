// ── Core ──────────────────────────────────────────────────────────

export type Role =
  | "ceo"
  | "admin"
  | "gerente"
  | "tecnico"
  | "estoquista"
  | "financeiro"
  | "rh"
  | "comercial"
  | "atendimento"
  | "produtos"
  | "auditor";

export type Scope = "proprio" | "time" | "setor" | "empresa";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_path?: string | null;
  status: "active" | "suspended";
  locale: string;
  last_login_at?: string | null;
  /** 1 = precisa trocar a senha antes de usar o app (migration 0010). Ausente no banco demo antigo = 0. */
  must_change_password?: number;
  password_changed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Membership {
  id: string;
  company_id: string;
  user_id: string;
  role: Role;
  department_id?: string | null;
  scope: Scope;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Company {
  id: string;
  name: string;
  document?: string | null;
  settings_json: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Department {
  id: string;
  company_id: string;
  name: string;
  manager_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Session ────────────────────────────────────────────────────────

export interface Session {
  user: User;
  membership: Membership;
  company: Company;
}

// ── CRM ────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  company_id: string;
  type: "PF" | "PJ";
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address_json: string;
  segment?: string | null;
  owner_id?: string | null;
  status: "active" | "inactive";
  // Cadastro completo (migration 0008)
  trade_name?: string | null;
  state_registration?: string | null;
  website?: string | null;
  source?: string | null;
  notes?: string | null;
  payment_terms?: string | null;
  credit_limit?: number | null;
  price_list_id?: string | null;
  /** Cliente duplicado mesclado neste (0011); o mesclado também recebe deleted_at. */
  merged_into_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Contact {
  id: string;
  company_id: string;
  customer_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  // 0008
  is_primary: number;
  whatsapp?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** novo/abordado/interessado/fechado = funil de prospecção de sites; os demais são legados. */
export type LeadStatus =
  | "novo"
  | "abordado"
  | "interessado"
  | "fechado"
  | "qualificado"
  | "descartado"
  | "convertido";

/** Status do benefício do programa de indicação (NULL no lead = não é indicação). */
export type ReferralStatus = "pendente" | "concedido";

export type LeadPresenceKind = "site_quebrado" | "redes_agendamento" | "nenhuma";

export interface Lead {
  id: string;
  company_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status: LeadStatus;
  score: number;
  owner_id?: string | null;
  customer_id?: string | null;
  // Prospecção (migration 0003)
  project_id?: string | null;
  category?: string | null;
  /** Segmento de preço (a Proposta separa pet shop / banho e tosa / hotel da veterinária). */
  pricing_segment?: string | null;
  business_type?: string | null;
  whatsapp?: string | null;
  google_rating?: number | null;
  google_reviews?: number | null;
  sem_site: number;
  online_presence?: string | null;
  presence_kind?: LeadPresenceKind | null;
  address?: string | null;
  notes?: string | null;
  source_url?: string | null;
  package_id?: string | null;
  estimated_setup: number;
  estimated_monthly: number;
  estimated_revenue: number;
  priority_rank?: number | null;
  outreach_day?: number | null;
  outreach_date?: string | null;
  last_contact_at?: string | null;
  /** Quem indicou este lead. Benefícios só valem quando ele fecha o negócio. */
  referred_by?: string | null;
  referral_status?: ReferralStatus | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ServicePackage {
  id: string;
  company_id: string;
  project_id?: string | null;
  code: string;
  name: string;
  description?: string | null;
  features_json: string;
  sort_order: number;
  is_estimate: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PackagePrice {
  id: string;
  company_id: string;
  package_id: string;
  segment: string;
  setup_price: number;
  monthly_price: number;
  /** Escopo base do gerenciador no segmento (Essencial e Premium). */
  feature_note?: string | null;
  is_estimate: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface RevenueScenario {
  id: string;
  company_id: string;
  project_id?: string | null;
  code: string;
  label: string;
  conversion_rate: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** segment = null → linha de total geral do cenário. */
export interface RevenueForecast {
  id: string;
  company_id: string;
  project_id?: string | null;
  scenario_id: string;
  segment?: string | null;
  leads_count: number;
  expected_closed: number;
  potential_setup: number;
  potential_monthly: number;
  potential_revenue: number;
  forecast_setup: number;
  forecast_monthly: number;
  forecast_revenue: number;
  is_estimate: number;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  company_id: string;
  customer_id?: string | null;
  title: string;
  value: number;
  stage: "novo" | "qualificacao" | "proposta" | "negociacao" | "ganho" | "perdido";
  probability: number;
  expected_close_date?: string | null;
  owner_id?: string | null;
  lost_reason?: string | null;
  status: "open" | "won" | "lost";
  // 0008: oportunidade nascida de um lead
  lead_id?: string | null;
  contact_id?: string | null;
  source?: string | null;
  notes?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type ProposalStatus = "rascunho" | "enviada" | "aceita" | "recusada" | "expirada";

/** Proposta comercial. `value` continua sendo o total; os itens ficam em proposal_items (0008). */
export interface Proposal {
  id: string;
  company_id: string;
  opportunity_id?: string | null;
  value: number;
  items_json: string;
  version: number;
  status: ProposalStatus;
  document_id?: string | null;
  number?: number | null;
  title?: string | null;
  customer_id?: string | null;
  contact_id?: string | null;
  valid_until?: string | null;
  subtotal: number;
  discount: number;
  payment_terms?: string | null;
  notes?: string | null;
  sent_at?: string | null;
  decided_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ProposalItem extends LineItemBase {
  proposal_id: string;
}

export type CrmActivityKind = "ligacao" | "email" | "reuniao" | "nota" | "tarefa";
export type CrmEntityType = "customer" | "contact" | "lead" | "opportunity" | "proposal";

/** Atividade de CRM. Pendente = done_at NULL; atrasada = pendente com due_at no passado. */
export interface CrmActivity {
  id: string;
  company_id: string;
  entity_type: CrmEntityType;
  entity_id: string;
  customer_id?: string | null;
  contact_id?: string | null;
  kind: CrmActivityKind;
  subject?: string | null;
  body?: string | null;
  due_at?: string | null;
  done_at?: string | null;
  outcome?: string | null;
  user_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type BadgeTone = "info" | "success" | "warning" | "orange" | "danger" | "violet" | "neutral";

export interface Tag {
  id: string;
  company_id: string;
  name: string;
  color: BadgeTone;
  /** A que a tag se aplica (customer, lead, ...); null = qualquer. */
  entity_type?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface EntityTag {
  id: string;
  company_id: string;
  tag_id: string;
  entity_type: string;
  entity_id: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Filtro salvo de uma lista. user_id null = compartilhado com a empresa. */
export interface SavedView {
  id: string;
  company_id: string;
  user_id?: string | null;
  entity_type: string;
  name: string;
  filters_json: string;
  is_default: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Catálogo / Vendas / Compras (0008) ────────────────────────────
// Dinheiro em REAL com 2 casas (arredonde com src/lib/money.ts). Descontos são valores em R$; tax_rate é percentual.
// Totais: total = subtotal - discount + shipping + tax_total; item: total = qty * unit_price - discount.

export type ProductKind = "produto" | "servico";

export interface Product {
  id: string;
  company_id: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  kind: ProductKind;
  category?: string | null;
  unit: string;
  price: number;
  cost: number;
  tax_rate: number;
  barcode?: string | null;
  ncm?: string | null;
  service_code?: string | null;
  /** Liga o produto ao item de estoque (entrada/saída de mercadoria). */
  inventory_item_id?: string | null;
  revenue_category_id?: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PriceList {
  id: string;
  company_id: string;
  name: string;
  description?: string | null;
  is_default: number;
  valid_from?: string | null;
  valid_to?: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PriceListItem {
  id: string;
  company_id: string;
  price_list_id: string;
  product_id: string;
  price: number;
  min_qty: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Campos comuns de item de pedido, fatura, compra e proposta. */
export interface LineItemBase {
  id: string;
  company_id: string;
  product_id?: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  total: number;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Totais de pedido, fatura e compra. */
export interface DocumentTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax_total: number;
  total: number;
}

export type SalesOrderStatus = "rascunho" | "confirmado" | "faturado" | "entregue" | "cancelado";

export interface SalesOrder extends DocumentTotals {
  id: string;
  company_id: string;
  number: number;
  customer_id?: string | null;
  contact_id?: string | null;
  opportunity_id?: string | null;
  proposal_id?: string | null;
  price_list_id?: string | null;
  seller_id?: string | null;
  location_id?: string | null;
  status: SalesOrderStatus;
  order_date: string;
  delivery_date?: string | null;
  payment_terms?: string | null;
  installments: number;
  notes?: string | null;
  internal_notes?: string | null;
  confirmed_at?: string | null;
  invoiced_at?: string | null;
  delivered_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface SalesOrderItem extends LineItemBase {
  order_id: string;
  delivered_qty: number;
  invoiced_qty: number;
}

export type InvoiceStatus = "rascunho" | "emitida" | "paga_parcial" | "paga" | "vencida" | "cancelada";

/** Fatura. As parcelas são contas a receber (receivables.invoice_id + installment_number/installment_count). */
export interface Invoice extends DocumentTotals {
  id: string;
  company_id: string;
  number: number;
  sales_order_id?: string | null;
  customer_id?: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date?: string | null;
  installments: number;
  payment_terms?: string | null;
  payment_method?: string | null;
  paid_amount: number;
  category_id?: string | null;
  bank_account_id?: string | null;
  fiscal_number?: string | null;
  fiscal_series?: string | null;
  fiscal_key?: string | null;
  notes?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface InvoiceItem extends LineItemBase {
  invoice_id: string;
  sales_order_item_id?: string | null;
}

export type PurchaseOrderStatus = "rascunho" | "aprovado" | "enviado" | "recebido_parcial" | "recebido" | "cancelado";

export interface PurchaseOrder extends DocumentTotals {
  id: string;
  company_id: string;
  number: number;
  supplier_id?: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  /** Previsão de entrega. */
  expected_date?: string | null;
  location_id?: string | null;
  payment_terms?: string | null;
  installments: number;
  category_id?: string | null;
  cost_center_id?: string | null;
  notes?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  received_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PurchaseOrderItem extends LineItemBase {
  order_id: string;
  inventory_item_id?: string | null;
  received_qty: number;
}

export type GoodsReceiptStatus = "conferido" | "estornado";

/** Recebimento (entrada de mercadoria). */
export interface GoodsReceipt {
  id: string;
  company_id: string;
  number: number;
  purchase_order_id?: string | null;
  supplier_id?: string | null;
  location_id?: string | null;
  status: GoodsReceiptStatus;
  received_at: string;
  received_by?: string | null;
  supplier_invoice_number?: string | null;
  total: number;
  notes?: string | null;
  reversed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface GoodsReceiptItem {
  id: string;
  company_id: string;
  receipt_id: string;
  purchase_order_item_id?: string | null;
  inventory_item_id?: string | null;
  product_id?: string | null;
  qty: number;
  unit_cost: number;
  location_id?: string | null;
  stock_movement_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Support / Ops ──────────────────────────────────────────────────

export type TicketStatus = "aberto" | "em_atendimento" | "aguardando" | "resolvido" | "fechado";
export type Priority = "baixa" | "media" | "alta" | "urgente";

export interface Ticket {
  id: string;
  company_id: string;
  customer_id?: string | null;
  subject: string;
  description?: string | null;
  channel: string;
  priority: Priority;
  status: TicketStatus;
  sla_due_at?: string | null;
  agent_id?: string | null;
  opened_by?: string | null;
  requester_area?: string | null;
  work_order_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type WorkOrderStatus =
  | "aberta"
  | "atribuida"
  | "aguardando_peca"
  | "em_execucao"
  | "concluida"
  | "cancelada";

export interface WorkOrder {
  id: string;
  company_id: string;
  number: string;
  customer_id?: string | null;
  ticket_id?: string | null;
  project_id?: string | null;
  technician_id?: string | null;
  status: WorkOrderStatus;
  priority: Priority;
  sla_due_at?: string | null;
  opened_at: string;
  closed_at?: string | null;
  checklist_json: string;
  labor_cost: number;
  materials_cost: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Projects ──────────────────────────────────────────────────────

export type ProjectStatus = "planejado" | "andamento" | "pausado" | "concluido" | "cancelado";
export type TaskStatus = "aberta" | "em_andamento" | "concluida" | "bloqueada";

export interface Project {
  id: string;
  company_id: string;
  customer_id?: string | null;
  name: string;
  status: ProjectStatus;
  budget: number;
  start_date?: string | null;
  end_date?: string | null;
  owner_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type StageStatus = "a_seguir" | "em_andamento" | "concluida";

export interface ProjectStage {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  description?: string | null;
  position: number;
  status: StageStatus;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Task {
  id: string;
  company_id: string;
  project_id?: string | null;
  stage_id?: string | null;
  parent_task_id?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  assignee_id?: string | null;
  priority: Priority;
  due_date?: string | null;
  estimate_hours?: number | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Inventory / Custody ────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  company_id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  supplier_id?: string | null;
  unit: string;
  min_stock: number;
  max_stock?: number | null;
  cost: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface StockBalance {
  id: string;
  company_id: string;
  item_id: string;
  location_id: string;
  quantity: number;
  updated_at: string;
}

export interface StockLocation {
  id: string;
  company_id: string;
  name: string;
  type?: string | null;
  address?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type StockMovementType = "entrada" | "saida" | "transferencia" | "ajuste";

/**
 * Movimentação de estoque. `quantity` é sempre positiva; o sentido vem dos locais: entrada (to_location_id),
 * saída (from_location_id), transferência (from e to) e ajuste de inventário (to = sobra, from = falta).
 * ref_type/ref_id: origem (goods_receipt, sales_order, inventory_count...).
 */
export interface StockMovement {
  id: string;
  company_id: string;
  item_id: string;
  type: StockMovementType;
  quantity: number;
  from_location_id?: string | null;
  to_location_id?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  user_id?: string | null;
  note?: string | null;
  evidence_path?: string | null;
  /** Custo unitário da movimentação (0008). */
  unit_cost?: number | null;
  created_at: string;
}

export type InventoryCountStatus = "aberta" | "concluida" | "cancelada";

/** Inventário (contagem). O ajuste da diferença vira stock_movements (adjustment_movement_id). */
export interface InventoryCount {
  id: string;
  company_id: string;
  number: number;
  location_id?: string | null;
  status: InventoryCountStatus;
  started_at: string;
  finished_at?: string | null;
  counted_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface InventoryCountItem {
  id: string;
  company_id: string;
  count_id: string;
  item_id: string;
  location_id?: string | null;
  expected_qty: number;
  counted_qty?: number | null;
  adjustment_movement_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Supplier {
  id: string;
  company_id: string;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  terms?: string | null;
  rating?: number | null;
  // 0008
  trade_name?: string | null;
  contact_name?: string | null;
  address_json: string;
  state_registration?: string | null;
  website?: string | null;
  notes?: string | null;
  category?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type CustodyStatus = "em_custodia" | "devolvido" | "consumido" | "perdido";

export interface Custody {
  id: string;
  company_id: string;
  item_id?: string | null;
  holder_id: string;
  quantity: number;
  work_order_id?: string | null;
  checked_out_at: string;
  due_back_at?: string | null;
  returned_at?: string | null;
  status: CustodyStatus;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Finance ───────────────────────────────────────────────────────

/** paga_parcial / recebida_parcial = baixa parcial (paid_amount / received_amount menor que amount). */
export type FinancialStatus =
  | "aberta"
  | "aprovada"
  | "paga_parcial"
  | "paga"
  | "recebida_parcial"
  | "recebida"
  | "vencida"
  | "cancelada";

export interface CostCenter {
  id: string;
  company_id: string;
  name: string;
  department_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Colunas da 0008 comuns a contas a pagar e a receber. */
interface FinancialEntryExtras {
  category_id?: string | null;
  bank_account_id?: string | null;
  installment_number?: number | null;
  installment_count?: number | null;
  payment_method?: string | null;
  document_number?: string | null;
  issue_date?: string | null;
  /** Competência 'YYYY-MM' (regime de competência na DRE). */
  competence?: string | null;
  notes?: string | null;
  recurring_entry_id?: string | null;
}

export interface Payable extends FinancialEntryExtras {
  id: string;
  company_id: string;
  description: string;
  supplier_id?: string | null;
  amount: number;
  due_date?: string | null;
  status: FinancialStatus;
  cost_center_id?: string | null;
  approver_id?: string | null;
  paid_at?: string | null;
  paid_amount: number;
  ref_type?: string | null;
  ref_id?: string | null;
  purchase_order_id?: string | null;
  goods_receipt_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Receivable extends FinancialEntryExtras {
  id: string;
  company_id: string;
  customer_id?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  /** Descrição própria (0008). Antes a tela gravava a descrição em ref_id; a migração copiou. */
  description?: string | null;
  amount: number;
  due_date?: string | null;
  status: FinancialStatus;
  received_at?: string | null;
  received_amount: number;
  cost_center_id?: string | null;
  invoice_id?: string | null;
  sales_order_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type FinanceCategoryKind = "receita" | "despesa";
export type DreGroup = "receita" | "deducao" | "custo" | "despesa" | "financeiro" | "outros";

/** Plano de contas (hierárquico por parent_id). */
export interface FinanceCategory {
  id: string;
  company_id: string;
  parent_id?: string | null;
  code?: string | null;
  name: string;
  kind: FinanceCategoryKind;
  dre_group?: DreGroup | null;
  position: number;
  active: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type BankAccountKind = "corrente" | "poupanca" | "caixa" | "cartao" | "investimento";

export interface BankAccount {
  id: string;
  company_id: string;
  name: string;
  kind: BankAccountKind;
  bank_code?: string | null;
  bank_name?: string | null;
  agency?: string | null;
  account_number?: string | null;
  pix_key?: string | null;
  opening_balance: number;
  opening_date?: string | null;
  is_default: number;
  active: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type BankTransactionSource = "ofx" | "csv" | "manual";
export type BankTransactionStatus = "pendente" | "conciliada" | "ignorada";

/** Lançamento do extrato. amount positivo = entrada (crédito), negativo = saída (débito). */
export interface BankTransaction {
  id: string;
  company_id: string;
  bank_account_id: string;
  posted_at: string;
  amount: number;
  description?: string | null;
  memo?: string | null;
  /** Id do lançamento no OFX (único por conta). */
  fitid?: string | null;
  balance_after?: number | null;
  source: BankTransactionSource;
  status: BankTransactionStatus;
  payable_id?: string | null;
  receivable_id?: string | null;
  category_id?: string | null;
  import_batch_id?: string | null;
  reconciled_at?: string | null;
  reconciled_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Baixa (total ou parcial) de uma conta: exatamente um de payable_id / receivable_id. */
export interface FinanceSettlement {
  id: string;
  company_id: string;
  payable_id?: string | null;
  receivable_id?: string | null;
  amount: number;
  paid_at: string;
  bank_account_id?: string | null;
  bank_transaction_id?: string | null;
  payment_method?: string | null;
  interest: number;
  fine: number;
  discount: number;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type RecurringKind = "pagar" | "receber";
export type RecurringFrequency = "semanal" | "mensal" | "bimestral" | "trimestral" | "semestral" | "anual";

export interface RecurringEntry {
  id: string;
  company_id: string;
  kind: RecurringKind;
  description: string;
  amount: number;
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  start_date: string;
  end_date?: string | null;
  /** Competência do último lançamento gerado ('YYYY-MM'; semanal: 'YYYY-MM-DD'). */
  last_competence?: string | null;
  supplier_id?: string | null;
  customer_id?: string | null;
  category_id?: string | null;
  cost_center_id?: string | null;
  bank_account_id?: string | null;
  active: number;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type ImportMode = "all-or-nothing" | "skip-errors";
export type ImportBatchStatus = "concluida" | "com_erros" | "falhou" | "simulacao";

export interface ImportBatch {
  id: string;
  company_id: string;
  entity: string;
  filename?: string | null;
  sheet_name?: string | null;
  format?: string | null;
  mode: ImportMode;
  dry_run: number;
  status: ImportBatchStatus;
  rows_total: number;
  rows_ok: number;
  rows_err: number;
  inserted: number;
  updated: number;
  /** JSON: [{ row, field, message }]. */
  errors_json: string;
  /** JSON: { coluna do arquivo: campo }. */
  mapping_json: string;
  created_by?: string | null;
  created_at: string;
  finished_at?: string | null;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Documentos ────────────────────────────────────────────────────

/** Documento. Os bytes ficam fora do banco (desktop: $APPDATA/files; navegador: IndexedDB); aqui só metadados (0009). */
export interface DocumentRow {
  id: string;
  company_id: string;
  title: string;
  type?: string | null;
  /** Caminho lógico mostrado na tela (pasta + nome). */
  file_path: string;
  version: number;
  department_id?: string | null;
  tags_json: string;
  entity_type?: string | null;
  entity_id?: string | null;
  uploaded_by?: string | null;
  storage_key?: string | null;
  original_name?: string | null;
  mime?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
  parent_version_id?: string | null;
  folder?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Activities ─────────────────────────────────────────────────────

export interface Activity {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  title?: string | null;
  description?: string | null;
  actor_id?: string | null;
  module?: string | null;
  created_at: string;
}

// ── Notifications ──────────────────────────────────────────────────

export interface Notification {
  id: string;
  company_id: string;
  user_id: string;
  type?: string | null;
  message: string;
  ref_type?: string | null;
  ref_id?: string | null;
  is_read: number;
  created_at: string;
}

// ── RH ─────────────────────────────────────────────────────────────

export type EmployeeStatus = "ativo" | "em_ferias" | "afastado" | "desligado";
export type HrRequestType = "ferias" | "folga" | "atestado" | "outro";
export type HrRequestStatus = "pendente" | "aprovada" | "recusada";
export type HrAnnouncementCategory = "comunicado" | "politica" | "beneficio";
export type ContractType = "clt" | "pj" | "estagio" | "temporario";
export type HrTaskCategory = "geral" | "admissao" | "desligamento";

/** Cadastro do colaborador. Sem salário: remuneração não faz parte do RH deste sistema. */
export interface Employee {
  id: string;
  company_id: string;
  user_id?: string | null;
  name: string;
  email?: string | null;
  department?: string | null;
  position?: string | null;
  hire_date?: string | null;
  vacation_days_entitled: number;
  status: EmployeeStatus;
  // Admissão/desligamento e banco de horas (0008)
  document?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  contract_type?: ContractType | null;
  /** Jornada diária em minutos (banco de horas). */
  daily_minutes: number;
  manager_employee_id?: string | null;
  termination_date?: string | null;
  termination_reason?: string | null;
  notes?: string | null;
  // Dados de admissão (0011)
  rg?: string | null;
  pis?: string | null;
  /** JSON: { logradouro, numero, complemento, bairro, cidade, uf, cep }. */
  address_json?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface HrRequest {
  id: string;
  company_id: string;
  employee_id: string;
  type: HrRequestType;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string | null;
  status: HrRequestStatus;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface HrAnnouncement {
  id: string;
  company_id: string;
  title: string;
  body: string;
  category: HrAnnouncementCategory;
  pinned: number;
  published_by?: string | null;
  published_at: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Pendência de um colaborador ("o que ele precisa fazer"). */
export interface HrTask {
  id: string;
  company_id: string;
  employee_id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status: "pendente" | "concluida";
  /** Checklist do ciclo do colaborador (0008). */
  category: HrTaskCategory;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Remuneração do colaborador (folha de pagamento). Só CEO e Administração leem. */
export interface EmployeeCompensation {
  id: string;
  company_id: string;
  employee_id: string;
  base_salary: number;
  effective_from?: string | null;
  notes?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Banco de horas. minutes positivo = crédito (hora extra), negativo = débito. */
export interface HrTimeEntry {
  id: string;
  company_id: string;
  employee_id: string;
  entry_date: string;
  minutes: number;
  reason?: string | null;
  status: HrRequestStatus;
  decided_by?: string | null;
  decided_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}
