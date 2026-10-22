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

export type FinancialStatus = "aberta" | "aprovada" | "paga" | "recebida" | "vencida" | "cancelada";

export interface Payable {
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
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Receivable {
  id: string;
  company_id: string;
  customer_id?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  amount: number;
  due_date?: string | null;
  status: FinancialStatus;
  received_at?: string | null;
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
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}
