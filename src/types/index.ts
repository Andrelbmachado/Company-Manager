// ── Core ──────────────────────────────────────────────────────────

export type Role =
  | "admin"
  | "gerente"
  | "tecnico"
  | "estoquista"
  | "financeiro"
  | "comercial"
  | "atendimento"
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
  slug?: string | null;
  manager_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ── Session ────────────────────────────────────────────────────────

export interface SessionDepartmentMembership {
  department: import("@/lib/departments/catalog").DepartmentSlug;
  role: "chefe" | "assistente" | "membro";
}

export interface Session {
  user: User;
  membership: Membership;
  company: Company;
  /** Departamentos do usuário (carregados no login). */
  departments?: SessionDepartmentMembership[];
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

export interface Lead {
  id: string;
  company_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status: "novo" | "qualificado" | "descartado" | "convertido";
  score: number;
  owner_id?: string | null;
  customer_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
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

export interface Task {
  id: string;
  company_id: string;
  project_id?: string | null;
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
