// Demo data for the browser preview (no SQLite). Matches the demo login in
// src/lib/auth/login.ts so every page has something to show.

import type { Row } from "./browserStore";

export const DEMO_COMPANY_ID = "demo-company-0001";
export const DEMO_USER_ID = "demo-user-0001";

export function demoSeed(): Record<string, Row[]> {
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  const base = (id: string, createdOffset = 0) => ({
    id,
    company_id: DEMO_COMPANY_ID,
    created_at: day(createdOffset),
    updated_at: day(createdOffset),
    deleted_at: null,
  });

  return {
    users: [
      { id: DEMO_USER_ID, name: "Administrador Demo", email: "admin@companymanager.local", status: "active", created_at: day(-30), updated_at: day(-30), deleted_at: null },
      { id: "demo-user-0002", name: "Carlos Técnico", email: "carlos@companymanager.local", status: "active", created_at: day(-20), updated_at: day(-20), deleted_at: null },
    ],
    customers: [
      { ...base("demo-cust-1", -25), type: "PJ", name: "Alfa Engenharia Ltda", document: "11.222.333/0001-44", email: "contato@alfa.com.br", phone: "(11) 3333-1000", segment: "Construção", status: "active", address_json: "{}" },
      { ...base("demo-cust-2", -18), type: "PJ", name: "Beta Logística S.A.", document: "22.333.444/0001-55", email: "ti@betalog.com.br", phone: "(21) 3222-2000", segment: "Logística", status: "active", address_json: "{}" },
      { ...base("demo-cust-3", -7), type: "PF", name: "Juliana Pereira", document: "123.456.789-00", email: "juliana@gmail.com", phone: "(31) 99888-7766", segment: null, status: "active", address_json: "{}" },
    ],
    leads: [
      { ...base("demo-lead-1", -3), name: "Ricardo Lima", email: "ricardo@gamma.com.br", phone: "(11) 98888-1111", company_name: "Gamma Varejo", position: "Diretor de TI", source: "Site", status: "novo", score: 40, notes: null },
      { ...base("demo-lead-2", -2), name: "Fernanda Costa", email: "fernanda@delta.ind.br", phone: "(19) 97777-2222", company_name: "Delta Indústria", position: "Compradora", source: "Indicação", status: "qualificado", score: 75, notes: "Pediu proposta até o fim do mês" },
      { ...base("demo-lead-3", -1), name: "Paulo Mendes", email: "paulo@epsilon.com", phone: null, company_name: "Epsilon Tech", position: "CEO", source: "Feira", status: "novo", score: 20, notes: null },
    ],
    opportunities: [
      { ...base("demo-opp-1", -20), customer_id: "demo-cust-1", title: "Contrato de manutenção anual", value: 48000, stage: "proposta", probability: 50, expected_close_date: day(15).slice(0, 10), status: "open" },
      { ...base("demo-opp-2", -12), customer_id: "demo-cust-2", title: "Cabeamento galpão 3", value: 23500, stage: "negociacao", probability: 70, expected_close_date: day(7).slice(0, 10), status: "open" },
      { ...base("demo-opp-3", -5), customer_id: "demo-cust-3", title: "Rede residencial", value: 3200, stage: "qualificacao", probability: 30, expected_close_date: null, status: "open" },
      { ...base("demo-opp-4", -40), customer_id: "demo-cust-1", title: "Projeto CFTV", value: 15800, stage: "ganho", probability: 100, expected_close_date: day(-10).slice(0, 10), status: "won" },
    ],
    tickets: [
      { ...base("demo-tkt-1", -1), customer_id: "demo-cust-2", subject: "Switch do galpão 2 sem link", description: "Portas 1-12 apagadas", channel: "telefone", priority: "alta", status: "aberto", agent_id: DEMO_USER_ID, work_order_id: null },
      { ...base("demo-tkt-2", -4), customer_id: "demo-cust-1", subject: "Lentidão na VPN", description: null, channel: "email", priority: "media", status: "em_atendimento", agent_id: DEMO_USER_ID, work_order_id: null },
    ],
    work_orders: [
      { ...base("demo-wo-1", -6), number: "OS-0001", customer_id: "demo-cust-1", technician_id: "demo-user-0002", status: "em_execucao", priority: "media", opened_at: day(-6), labor_cost: 450, materials_cost: 180, checklist_json: "[]" },
    ],
    projects: [
      { ...base("demo-prj-1", -15), customer_id: "demo-cust-2", name: "Modernização da rede", status: "andamento", budget: 85000, start_date: day(-15).slice(0, 10), end_date: day(45).slice(0, 10) },
    ],
    inventory_items: [
      { ...base("demo-inv-1", -30), name: "Cabo de rede Cat6 (caixa 305m)", sku: "CAB-CAT6-305", category: "Cabos", unit: "cx", min_stock: 5, max_stock: 20, cost: 689.9, quantity: 3 },
      { ...base("demo-inv-2", -30), name: "Conector RJ45 Cat6", sku: "RJ45-CAT6", category: "Conectores", unit: "un", min_stock: 200, max_stock: 2000, cost: 1.2, quantity: 850 },
    ],
    custodies: [
      { ...base("demo-cus-1", -2), item_id: "demo-inv-2", holder_id: "demo-user-0002", quantity: 50, work_order_id: "demo-wo-1", checked_out_at: day(-2), due_back_at: day(5), status: "em_custodia" },
    ],
    payables: [
      { ...base("demo-pay-1", -10), description: "Aluguel escritório", amount: 4200, due_date: day(5).slice(0, 10), status: "aberta" },
      { ...base("demo-pay-2", -8), description: "Fornecedor de cabos", amount: 3449.5, due_date: day(12).slice(0, 10), status: "aprovada" },
    ],
    receivables: [
      { ...base("demo-rec-1", -9), customer_id: "demo-cust-1", ref_type: "Projeto CFTV", amount: 15800, due_date: day(3).slice(0, 10), status: "aberta" },
    ],
    documents: [
      { ...base("demo-doc-1", -14), title: "Contrato Alfa Engenharia", type: "Contrato", file_path: "/Documentos/contrato-alfa.pdf", version: 1, entity_type: "customer" },
    ],
    audit_logs: [
      { id: "demo-audit-1", company_id: DEMO_COMPANY_ID, user_id: DEMO_USER_ID, entity_type: "session", entity_id: DEMO_USER_ID, action: "auth.login", created_at: day(0) },
    ],
    notifications: [
      { id: "demo-ntf-1", company_id: DEMO_COMPANY_ID, user_id: DEMO_USER_ID, type: "stock", message: "Cabo de rede Cat6 abaixo do estoque mínimo", ref_type: "inventory_item", ref_id: "demo-inv-1", is_read: 0, created_at: day(0) },
      { id: "demo-ntf-2", company_id: DEMO_COMPANY_ID, user_id: DEMO_USER_ID, type: "ticket", message: "Novo ticket: Switch do galpão 2 sem link", ref_type: "ticket", ref_id: "demo-tkt-1", is_read: 0, created_at: day(-1) },
    ],
  };
}
