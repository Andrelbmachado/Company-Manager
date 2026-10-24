// TEMPORÁRIO (login rápido de desenvolvimento): dados de exemplo para todas as áreas, exceto leads.
// Idempotente: ids fixos + INSERT OR IGNORE + flag em `settings`. Para remover: apague a pasta src/lib/dev e o uso em LoginPage.
// Os seeds de área (src/lib/dev/seeds/<area>.ts) rodam depois, sempre, cada um com a sua flag.
import { getDb } from "@/lib/db/client";
import type { Role } from "@/types";
import { day, devUserId, insertRows as insert, ts, type SeedRow as Row } from "./seedUtils";
import { runAreaSeeds } from "./seeds";

export { devUserId } from "./seedUtils";

const FLAG = "seed.dev_data.v1";

/** Seed principal (uma vez por empresa) + seeds de área (mesmo com a flag principal já gravada). */
export async function seedDevData(companyId: string): Promise<void> {
  const db = await getDb();
  const done = await db.select<{ key: string }[]>("SELECT * FROM settings WHERE company_id=?", [companyId]);
  if (!done.some((row) => row.key === FLAG)) await seedCoreData(companyId);
  await runAreaSeeds(companyId);
}

async function seedCoreData(companyId: string): Promise<void> {
  const db = await getDb();
  const comercial = devUserId("comercial");
  const tecnico = devUserId("tecnico");
  const atendimento = devUserId("atendimento");
  const financeiro = devUserId("financeiro");
  const estoquista = devUserId("estoquista");
  const gerente = devUserId("gerente");
  const ceo = devUserId("ceo");

  // ---- CRM -----------------------------------------------------------------
  const customers: [string, string, string, string, string, string][] = [
    ["NorteLog Transportes", "contato@nortelog.com.br", "(11) 3020-1188", "Logística", "PJ", "41.805.229/0001-18"],
    ["Hospital São Lucas", "infra@saolucas.com.br", "(11) 4002-8922", "Saúde", "PJ", "22.680.114/0001-07"],
    ["Grupo Horizonte", "operacoes@horizonte.com.br", "(21) 3122-9090", "Indústria", "PJ", "08.214.665/0001-42"],
    ["Mercado Central", "administrativo@mercadocentral.com.br", "(31) 3222-7811", "Varejo", "PJ", "33.112.874/0001-90"],
    ["Conecta Educação", "ti@conecta.edu.br", "(41) 3333-0198", "Educação", "PJ", "17.554.320/0001-61"],
    ["Almeida & Ramos Consultoria", "contato@almeidaramos.com.br", "(51) 3021-5500", "Serviços", "PJ", "29.870.115/0001-33"],
    ["Studio Aurora", "financeiro@studioaurora.com.br", "(11) 99642-7100", "Criativo", "PF", "123.456.789-09"],
    ["Viva Condomínios", "atendimento@vivacondominios.com.br", "(19) 3234-2233", "Imobiliário", "PJ", "05.447.291/0001-08"],
    ["Clínica Bem Viver", "recepcao@clinicabemviver.com.br", "(15) 3222-4040", "Saúde", "PJ", "11.903.456/0001-72"],
    ["Padaria Pão de Ouro", "contato@paodeouro.com.br", "(15) 99811-2020", "Alimentação", "PJ", "44.210.987/0001-15"],
    ["Escola Aprender Mais", "secretaria@aprendermais.edu.br", "(15) 3233-7788", "Educação", "PJ", "02.331.668/0001-50"],
    ["AutoCenter Sorocaba", "oficina@autocentersor.com.br", "(15) 3228-5566", "Automotivo", "PJ", "36.774.120/0001-84"],
  ];
  await insert("customers", companyId, customers.map(([name, email, phone, segment, type, document], i) => ({
    id: `dev-customer-${i + 1}`, type, name, document, email, phone, segment, owner_id: comercial, status: "active", created_at: ts(-220 + i * 17),
  })));
  const contactNames = ["Marcos Pereira", "Dra. Helena Souza", "Roberto Lima", "Sandra Alves", "Prof. Eduardo Reis", "Luciana Ramos", "Aurora Mendes", "Fábio Teixeira"];
  await insert("contacts", companyId, contactNames.map((name, i) => ({
    id: `dev-contact-${i + 1}`, customer_id: `dev-customer-${i + 1}`, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@exemplo.com.br`, phone: `(11) 9${8000 + i * 137}-${1000 + i * 91}`, role: ["Diretor", "Gestora de TI", "Compras", "Administrativo", "Coordenador", "Sócia", "Proprietária", "Síndico"][i],
  })));
  const opps: [string, number, string, number, number, string, string][] = [
    ["Expansão de rede - Hospital São Lucas", 78000, "proposta", 65, 12, "open", "dev-customer-2"],
    ["Contrato de suporte NorteLog", 36000, "negociacao", 80, 7, "open", "dev-customer-1"],
    ["Implantação ERP Grupo Horizonte", 124000, "qualificacao", 35, 28, "open", "dev-customer-3"],
    ["Renovação do parque de máquinas", 48500, "novo", 20, 40, "open", "dev-customer-4"],
    ["Projeto Wi-Fi corporativo", 29500, "ganho", 100, -4, "won", "dev-customer-4"],
    ["Help desk mensal Conecta", 18500, "perdido", 0, -12, "lost", "dev-customer-5"],
    ["Backup em nuvem Clínica Bem Viver", 22400, "proposta", 55, 15, "open", "dev-customer-9"],
    ["Câmeras e controle de acesso - Viva", 41200, "negociacao", 70, 9, "open", "dev-customer-8"],
    ["Site e sistema de pedidos - Padaria", 16800, "qualificacao", 40, 21, "open", "dev-customer-10"],
    ["Rede da Escola Aprender Mais", 33900, "novo", 25, 35, "open", "dev-customer-11"],
    ["Manutenção preventiva AutoCenter", 12600, "ganho", 100, -9, "won", "dev-customer-12"],
    ["Consultoria de TI Almeida & Ramos", 27800, "proposta", 60, 18, "open", "dev-customer-6"],
  ];
  await insert("opportunities", companyId, opps.map(([title, value, stage, probability, close, status, customer_id], i) => ({
    id: `dev-opp-${i + 1}`, customer_id, title, value, stage, probability, expected_close_date: day(close), owner_id: comercial, status, created_at: ts(-60 + i * 4),
  })));
  await insert("proposals", companyId, [
    { id: "dev-prop-1", opportunity_id: "dev-opp-1", value: 78000, items_json: JSON.stringify([{ item: "Switches 24p", qty: 6, unit: 4200 }, { item: "Instalação", qty: 1, unit: 52800 }]), version: 2, status: "enviada" },
    { id: "dev-prop-2", opportunity_id: "dev-opp-2", value: 36000, items_json: JSON.stringify([{ item: "Suporte mensal 12x", qty: 12, unit: 3000 }]), version: 1, status: "aceita" },
    { id: "dev-prop-3", opportunity_id: "dev-opp-7", value: 22400, items_json: JSON.stringify([{ item: "Backup 5 TB/ano", qty: 1, unit: 22400 }]), version: 1, status: "rascunho" },
    { id: "dev-prop-4", opportunity_id: "dev-opp-12", value: 27800, items_json: JSON.stringify([{ item: "Consultoria 120h", qty: 120, unit: 231.67 }]), version: 3, status: "enviada" },
  ]);

  // ---- Suporte e operações -------------------------------------------------
  const tickets: [string, string, string, number, string, string, string][] = [
    ["Oscilação no link da matriz", "alta", "em_atendimento", -1, "dev-customer-1", "TI / Operações", tecnico],
    ["Impressora do financeiro sem conexão", "media", "aberto", -2, "dev-customer-4", "Contabilidade / Financeiro", financeiro],
    ["Liberação de acesso para novo colaborador", "baixa", "aguardando", -3, "dev-customer-3", "Comercial", comercial],
    ["Servidor de arquivos indisponível", "urgente", "resolvido", -5, "dev-customer-2", "Atendimento", atendimento],
    ["Atualização dos terminais de atendimento", "media", "aberto", -6, "dev-customer-5", "Atendimento", atendimento],
    ["Falha intermitente no backup", "alta", "fechado", -9, "dev-customer-1", "Gerência", gerente],
    ["Lentidão no sistema de vendas", "media", "em_atendimento", -4, "dev-customer-8", "Comercial", comercial],
    ["Troca de HD no caixa 3", "baixa", "aberto", 0, "dev-customer-10", "Atendimento", atendimento],
    ["Wi-Fi sem sinal na sala de reuniões", "media", "aguardando", -7, "dev-customer-9", "Gerência", gerente],
    ["Câmera 4 offline", "alta", "aberto", -1, "dev-customer-8", "TI / Operações", tecnico],
    ["Configuração de e-mail corporativo", "baixa", "resolvido", -11, "dev-customer-6", "Comercial", comercial],
    ["Atualizar antivírus dos notebooks", "media", "fechado", -15, "dev-customer-11", "TI / Operações", tecnico],
  ];
  await insert("tickets", companyId, tickets.map(([subject, priority, status, days, customer_id, requester_area, opened_by], i) => ({
    id: `dev-ticket-${i + 1}`, customer_id, subject, description: "Chamado registrado para acompanhamento da equipe técnica.", channel: "portal", priority, status, agent_id: tecnico, opened_by, requester_area, created_at: ts(days),
  })));
  const orders: [string, string, string, number, number, number, string][] = [
    ["OS-1001", "em_execucao", "alta", -3, 680, 240, "dev-customer-1"],
    ["OS-1002", "concluida", "urgente", -5, 920, 1350, "dev-customer-2"],
    ["OS-1003", "concluida", "alta", -9, 480, 0, "dev-customer-1"],
    ["OS-1004", "aguardando_peca", "media", -2, 120, 0, "dev-customer-4"],
    ["OS-1005", "atribuida", "baixa", -1, 0, 0, "dev-customer-5"],
    ["OS-1006", "em_execucao", "media", -4, 350, 410, "dev-customer-8"],
    ["OS-1007", "concluida", "baixa", -14, 200, 90, "dev-customer-12"],
    ["OS-1008", "atribuida", "alta", 0, 0, 0, "dev-customer-9"],
  ];
  await insert("work_orders", companyId, orders.map(([number, status, priority, days, labor_cost, materials_cost, customer_id], i) => ({
    id: `dev-wo-${i + 1}`, number, customer_id, technician_id: tecnico, status, priority, opened_at: ts(days), checklist_json: "[]", labor_cost, materials_cost, created_at: ts(days),
  })));

  // ---- Projetos (os do seed de prospecção ficam como estão) --------------------
  const projects: [string, string, number, number, number][] = [
    ["Modernização da infraestrutura NorteLog", "andamento", 145000, -45, 45],
    ["Implantação de chamados Conecta", "planejado", 42000, 7, 70],
    ["Wi-Fi corporativo Mercado Central", "concluido", 29500, -80, -4],
  ];
  await insert("projects", companyId, projects.map(([name, status, budget, start, end], i) => ({
    id: `dev-project-${i + 1}`, name, status, budget, start_date: day(start), end_date: day(end), owner_id: gerente, created_at: ts(start),
  })));
  const stageNames = ["Levantamento", "Execução", "Entrega"];
  const stageStatus = [["concluida", "em_andamento", "a_seguir"], ["a_seguir", "a_seguir", "a_seguir"], ["concluida", "concluida", "concluida"]];
  for (let p = 0; p < 3; p++) {
    await insert("project_stages", companyId, stageNames.map((name, s) => ({
      id: `dev-stage-${p + 1}-${s + 1}`, project_id: `dev-project-${p + 1}`, name, position: s + 1, status: stageStatus[p][s],
    })));
    await insert("tasks", companyId, stageNames.map((name, s) => ({
      id: `dev-task-${p + 1}-${s + 1}`, project_id: `dev-project-${p + 1}`, stage_id: `dev-stage-${p + 1}-${s + 1}`, title: `${name}: atividades principais`, status: stageStatus[p][s] === "concluida" ? "concluida" : stageStatus[p][s] === "em_andamento" ? "em_andamento" : "aberta", assignee_id: tecnico, priority: "media", due_date: day(10 + s * 15),
    })));
  }

  // ---- Estoque -----------------------------------------------------------------
  const suppliers: [string, string, string, string, string, number][] = [
    ["NetPrime Distribuidora", "41.805.229/0001-18", "vendas@netprime.com.br", "(11) 3090-8890", "Pagamento em 28 dias", 5],
    ["InfraSafe Equipamentos", "22.680.114/0001-07", "comercial@infrasafe.com.br", "(11) 4102-7721", "Pagamento em 21 dias", 4],
    ["ByteCenter Tecnologia", "08.214.665/0001-42", "pedidos@bytecenter.com.br", "(19) 3321-1190", "Pagamento em 35 dias", 4],
    ["Cabos & Cia", "50.118.730/0001-26", "vendas@cabosecia.com.br", "(15) 3232-6001", "À vista com 5% de desconto", 3],
    ["EnergiaPlus Nobreaks", "12.667.904/0001-39", "contato@energiaplus.com.br", "(11) 2100-4455", "Pagamento em 30 dias", 5],
  ];
  await insert("suppliers", companyId, suppliers.map(([name, document, email, phone, terms, rating], i) => ({ id: `dev-supplier-${i + 1}`, name, document, email, phone, terms, rating })));
  await insert("stock_locations", companyId, [
    { id: "dev-loc-1", name: "Depósito Central", type: "deposito", address: "Rua das Indústrias, 120 - Sorocaba/SP" },
    { id: "dev-loc-2", name: "Almoxarifado TI", type: "almoxarifado", address: "Sala 4, térreo" },
  ]);
  const items: [string, string, string, string, number, number, number, number][] = [
    ["Cabo de rede Cat6 - caixa 305m", "CAB-CAT6-305", "Cabos", "cx", 4, 890, 7, 1],
    ["Switch gerenciável 24 portas", "SW-GER-24", "Rede", "un", 3, 2180, 2, 2],
    ["Access Point Wi-Fi 6", "AP-WIFI6", "Rede", "un", 5, 1240, 4, 2],
    ["SSD NVMe 1 TB", "SSD-NVME-1T", "Armazenamento", "un", 6, 520, 11, 3],
    ["Mouse USB corporativo", "MOUSE-USB", "Periféricos", "un", 10, 48, 28, 3],
    ["Nobreak 1200 VA", "NOB-1200", "Energia", "un", 2, 930, 1, 5],
    ["Teclado ABNT2 USB", "TEC-ABNT2", "Periféricos", "un", 10, 62, 24, 3],
    ["Monitor 24\" Full HD", "MON-24FHD", "Periféricos", "un", 4, 780, 9, 3],
    ["Patch cord Cat6 1,5 m", "PC-CAT6-15", "Cabos", "un", 30, 12, 85, 4],
    ["Conector RJ45 (pacote 100)", "RJ45-100", "Cabos", "pct", 5, 74, 3, 4],
    ["Roteador Wi-Fi AX3000", "ROT-AX3000", "Rede", "un", 3, 690, 6, 1],
    ["Memória DDR4 16 GB", "MEM-DDR4-16", "Componentes", "un", 6, 340, 5, 3],
    ["Fonte ATX 500 W", "FNT-ATX500", "Componentes", "un", 4, 210, 8, 3],
    ["Câmera IP externa", "CAM-IP-EXT", "Segurança", "un", 4, 460, 3, 2],
    ["Rack 12U parede", "RACK-12U", "Infraestrutura", "un", 2, 1150, 2, 2],
    ["Pasta térmica 10 g", "PT-10G", "Componentes", "un", 8, 18, 14, 3],
  ];
  await insert("inventory_items", companyId, items.map(([name, sku, category, unit, min_stock, cost, , supplier], i) => ({
    id: `dev-item-${i + 1}`, name, sku, category, unit, min_stock, max_stock: min_stock * 4, cost, supplier_id: `dev-supplier-${supplier}`,
  })));
  await insert("stock_balances", companyId, items.map(([, , , , , , qty], i) => ({ id: `dev-balance-${i + 1}`, item_id: `dev-item-${i + 1}`, location_id: i % 2 ? "dev-loc-2" : "dev-loc-1", quantity: qty })));
  await insert("stock_movements", companyId, items.slice(0, 10).map(([, , , , , , qty], i) => ({
    id: `dev-move-${i + 1}`, item_id: `dev-item-${i + 1}`, type: "entrada", quantity: qty + 3, to_location_id: i % 2 ? "dev-loc-2" : "dev-loc-1", user_id: estoquista, note: "Entrada inicial", created_at: ts(-30 + i),
  })));
  await insert("custodies", companyId, [
    { id: "dev-custody-1", item_id: "dev-item-2", holder_id: tecnico, quantity: 1, status: "em_custodia", checked_out_at: ts(-3), due_back_at: ts(2) },
    { id: "dev-custody-2", item_id: "dev-item-3", holder_id: tecnico, quantity: 2, status: "em_custodia", checked_out_at: ts(-2), due_back_at: ts(5) },
    { id: "dev-custody-3", item_id: "dev-item-1", holder_id: tecnico, quantity: 1, status: "consumido", checked_out_at: ts(-8), due_back_at: null },
    { id: "dev-custody-4", item_id: "dev-item-14", holder_id: tecnico, quantity: 2, status: "em_custodia", checked_out_at: ts(-1), due_back_at: ts(7) },
  ]);

  // ---- Financeiro ------------------------------------------------------------------
  await insert("cost_centers", companyId, ["Operações", "Comercial", "Administrativo", "TI", "Marketing"].map((name, i) => ({ id: `dev-cc-${i + 1}`, name })));
  const payables: [string, number, string, number, number, number][] = [
    ["Licenças de software - mensalidade", 4850, "aberta", 5, 4, 5],
    ["Compra de equipamentos de rede", 12740, "aprovada", 9, 1, 1],
    ["Aluguel do escritório", 6800, "paga", -3, 3, 3],
    ["Serviços contábeis", 1900, "aberta", 12, 3, 3],
    ["Energia elétrica", 1320, "paga", -6, 3, 3],
    ["Internet dedicada", 2100, "aberta", 3, 4, 2],
    ["Combustível da frota", 980, "vencida", -4, 1, 3],
    ["Seguro empresarial", 3400, "aprovada", 18, 3, 5],
    ["Marketing - anúncios", 2500, "aberta", 8, 5, 3],
    ["Material de escritório", 420, "paga", -10, 3, 4],
    ["Manutenção de veículos", 1650, "aberta", 14, 1, 5],
    ["Treinamento da equipe", 3200, "aprovada", 20, 4, 2],
  ];
  await insert("payables", companyId, payables.map(([description, amount, status, due, cc, sup], i) => ({
    id: `dev-pay-${i + 1}`, description, supplier_id: `dev-supplier-${sup}`, amount, due_date: day(due), status, cost_center_id: `dev-cc-${cc}`, approver_id: status === "aberta" ? null : financeiro, paid_at: status === "paga" ? ts(due) : null,
  })));
  const receivables: [string, number, string, number, string][] = [
    ["Contrato NorteLog - parcela 5/12", 12500, "aberta", 4, "dev-customer-1"],
    ["Projeto Wi-Fi Mercado Central", 14750, "aberta", 8, "dev-customer-4"],
    ["Suporte Hospital São Lucas", 8900, "recebida", -4, "dev-customer-2"],
    ["Consultoria Grupo Horizonte", 22000, "aberta", 15, "dev-customer-3"],
    ["Manutenção preventiva AutoCenter", 12600, "recebida", -9, "dev-customer-12"],
    ["Contrato NorteLog - parcela 4/12", 12500, "recebida", -26, "dev-customer-1"],
    ["Help desk Conecta - atrasado", 6200, "vencida", -8, "dev-customer-5"],
    ["Implantação Viva Condomínios - entrada", 20600, "aberta", 6, "dev-customer-8"],
    ["Backup Clínica Bem Viver - sinal", 5600, "aberta", 11, "dev-customer-9"],
    ["Suporte Studio Aurora", 1800, "recebida", -2, "dev-customer-7"],
  ];
  await insert("receivables", companyId, receivables.map(([ref_id, amount, status, due, customer_id], i) => ({
    id: `dev-rec-${i + 1}`, customer_id, ref_type: "Contrato", ref_id, amount, due_date: day(due), status, received_at: status === "recebida" ? ts(due) : null,
  })));

  // ---- Documentos (metadados; ainda sem arquivo real) ----------------------------
  const docs: [string, string, number, number, string][] = [
    ["Contrato de suporte NorteLog.pdf", "PDF", 2, -15, "/Comercial/Contratos"],
    ["Relatório técnico - servidor Hospital São Lucas.pdf", "PDF", 1, -5, "/TI e Operações/Relatórios"],
    ["Proposta comercial Grupo Horizonte.pdf", "PDF", 3, -3, "/Comercial/Propostas"],
    ["Checklist de instalação Wi-Fi.docx", "DOCX", 1, -1, "/TI e Operações/Checklists"],
    ["Fechamento mensal.xlsx", "XLSX", 1, -8, "/Financeiro/Fechamentos"],
    ["Notas fiscais de entrada.zip", "ZIP", 1, -6, "/Financeiro/Notas fiscais"],
    ["Inventário de ativos.xlsx", "XLSX", 4, -4, "/Estoque/Inventários"],
    ["Tabela de fornecedores.xlsx", "XLSX", 2, -7, "/Estoque/Fornecedores"],
    ["Manual de onboarding.pdf", "PDF", 1, -30, "/Compartilhados/Guias"],
    ["Política de segurança.pdf", "PDF", 2, -12, "/Compartilhados/Políticas"],
    ["Procedimento de triagem.docx", "DOCX", 3, -2, "/Atendimento/Processos"],
    ["Relatório de auditoria.pdf", "PDF", 1, -14, "/Auditoria/Relatórios"],
    ["Roadmap de produtos.xlsx", "XLSX", 2, -3, "/Desenvolvimento de Produtos/Roadmaps"],
    ["Política de férias.pdf", "PDF", 1, -20, "/Recursos Humanos/Políticas"],
    ["Ficha de cadastro de colaborador.docx", "DOCX", 2, -45, "/Recursos Humanos/Modelos"],
  ];
  await insert("documents", companyId, docs.map(([title, type, version, days, dir], i) => ({
    id: `dev-doc-${i + 1}`, title, type, file_path: `${dir}/${title}`, version, uploaded_by: ceo, created_at: ts(days),
  })));

  // ---- RH e folha ---------------------------------------------------------------
  const roleEmployees: [Role, string, string][] = [
    ["ceo", "Diretoria", "CEO"], ["admin", "Administração", "Administrador"], ["gerente", "Gerência Geral", "Gerente geral"],
    ["tecnico", "TI / Operações", "Técnico"], ["estoquista", "Estoque", "Estoquista"], ["financeiro", "Financeiro", "Analista financeiro"],
    ["rh", "Recursos Humanos", "Analista de RH"], ["comercial", "Comercial", "Consultor comercial"], ["atendimento", "Atendimento", "Atendente"],
    ["produtos", "Desenvolvimento de Produtos", "Analista de produtos"], ["auditor", "Auditoria", "Auditor"],
  ];
  const nameRows = await db.select<{ id: string; name: string; email: string }[]>("SELECT id, name, email FROM users WHERE id LIKE 'dev-user-%'");
  const byId = new Map(nameRows.map((row) => [row.id, row]));
  const employees: Row[] = roleEmployees.map(([role, department, position], i) => {
    const user = byId.get(devUserId(role));
    return { id: `dev-emp-${role}`, user_id: user ? user.id : null, name: user?.name ?? position, email: user?.email ?? null, department, position, hire_date: day(-1800 + i * 150), vacation_days_entitled: 30, status: "ativo" };
  });
  const extra: [string, string, string][] = [["Camila Martins", "Comercial", "Consultora comercial"], ["Joana Ferraz", "Atendimento", "Atendente"], ["Pedro Antunes", "TI / Operações", "Técnico de campo"], ["Larissa Dias", "Financeiro", "Assistente financeiro"]];
  extra.forEach(([name, department, position], i) => employees.push({ id: `dev-emp-extra-${i + 1}`, user_id: null, name, email: `${name.toLowerCase().replace(" ", ".")}@empresa.local`, department, position, hire_date: day(-700 + i * 120), vacation_days_entitled: 30, status: "ativo" }));
  await insert("employees", companyId, employees);
  await insert("employee_compensation", companyId, employees.map((emp, i) => ({
    id: `dev-comp-${i + 1}`, employee_id: emp.id as string, base_salary: [18000, 11000, 9500, 4800, 3200, 4600, 4400, 5200, 2900, 5800, 6100, 3900, 2800, 4300, 4100][i % 15], effective_from: day(-365), notes: null, updated_by: ceo,
  })));
  await insert("hr_requests", companyId, [
    { id: "dev-hrreq-1", employee_id: "dev-emp-comercial", type: "ferias", start_date: day(53), end_date: day(62), days: 10, reason: "Férias de fim de ano", status: "pendente" },
    { id: "dev-hrreq-2", employee_id: "dev-emp-tecnico", type: "ferias", start_date: day(18), end_date: day(22), days: 5, reason: null, status: "aprovada", decided_by: devUserId("rh"), decided_at: ts(-2) },
    { id: "dev-hrreq-3", employee_id: "dev-emp-atendimento", type: "folga", start_date: day(8), end_date: day(8), days: 1, reason: "Compromisso pessoal", status: "pendente" },
    { id: "dev-hrreq-4", employee_id: "dev-emp-financeiro", type: "atestado", start_date: day(-7), end_date: day(-7), days: 1, reason: "Consulta médica", status: "aprovada", decided_by: devUserId("rh"), decided_at: ts(-6) },
    { id: "dev-hrreq-5", employee_id: "dev-emp-produtos", type: "ferias", start_date: day(-108), end_date: day(-99), days: 10, reason: null, status: "aprovada", decided_by: devUserId("rh"), decided_at: ts(-120) },
    { id: "dev-hrreq-6", employee_id: "dev-emp-extra-2", type: "ferias", start_date: day(30), end_date: day(44), days: 15, reason: "Viagem em família", status: "pendente" },
    { id: "dev-hrreq-7", employee_id: "dev-emp-extra-3", type: "folga", start_date: day(-3), end_date: day(-3), days: 1, reason: "Mudança", status: "recusada", decided_by: devUserId("rh"), decided_at: ts(-5), decision_note: "Equipe reduzida nesse dia." },
  ]);
  await insert("hr_announcements", companyId, [
    { id: "dev-hrann-1", title: "Solicitações de férias e folgas pelo Meu RH", body: "Abra a solicitação na página Meu RH, escolha o período e acompanhe a resposta ali mesmo.", category: "comunicado", pinned: 1, published_by: devUserId("rh"), published_at: ts(-5) },
    { id: "dev-hrann-2", title: "Mantenha seus dados cadastrais atualizados", body: "Confira telefone, endereço e contato de emergência. Se algo mudou, avise o RH.", category: "comunicado", pinned: 0, published_by: devUserId("rh"), published_at: ts(-12) },
    { id: "dev-hrann-3", title: "Política de férias", body: "As regras de marcação e fracionamento de férias estão na pasta Recursos Humanos em Documentos.", category: "politica", pinned: 0, published_by: devUserId("rh"), published_at: ts(-20) },
    { id: "dev-hrann-4", title: "Confraternização de fim de ano", body: "Reserve a data: a confraternização será na última sexta-feira de dezembro.", category: "evento", pinned: 0, published_by: devUserId("rh"), published_at: ts(-2) },
  ]);
  await insert("hr_tasks", companyId, [
    { id: "dev-hrtask-1", employee_id: "dev-emp-comercial", title: "Atualizar dados cadastrais", description: null, due_date: day(7), status: "pendente", created_by: devUserId("rh") },
    { id: "dev-hrtask-2", employee_id: "dev-emp-comercial", title: "Assinar a política de segurança da informação", description: null, due_date: day(14), status: "pendente", created_by: devUserId("rh") },
    { id: "dev-hrtask-3", employee_id: "dev-emp-tecnico", title: "Atualizar dados cadastrais", description: null, due_date: day(7), status: "concluida", created_by: devUserId("rh") },
    { id: "dev-hrtask-4", employee_id: "dev-emp-atendimento", title: "Atualizar dados cadastrais", description: null, due_date: day(-2), status: "pendente", created_by: devUserId("rh") },
    { id: "dev-hrtask-5", employee_id: "dev-emp-financeiro", title: "Assinar a política de segurança da informação", description: null, due_date: day(10), status: "pendente", created_by: devUserId("rh") },
  ]);

  // ---- Atividades e auditoria ----------------------------------------------------
  const acts: [string, string, string, string, string, number][] = [
    ["ticket", "dev-ticket-1", "ticket.created", "Ticket aberto pela área de TI / Operações", tecnico, -1],
    ["ticket", "dev-ticket-1", "ticket.diagnosis", "Verificado histórico de quedas e perda de pacotes no roteador principal.", tecnico, -1],
    ["ticket", "dev-ticket-4", "ticket.created", "Ticket aberto pela área de Atendimento", atendimento, -5],
    ["ticket", "dev-ticket-4", "ticket.resolved", "Volume reparado, serviço validado e acesso normalizado.", tecnico, -5],
    ["opportunity", "dev-opp-5", "opportunity.won", "Oportunidade ganha: Projeto Wi-Fi corporativo", comercial, -4],
  ];
  await insert("activities", companyId, acts.map(([entity_type, entity_id, action, title, actor_id, days], i) => ({ id: `dev-act-${i + 1}`, entity_type, entity_id, action, title, actor_id, created_at: ts(days, 10) })));
  const audits: [string, string, string, string, number][] = [
    ["user.login", "user", ceo, ceo, -1], ["payable.approved", "payable", "dev-pay-2", financeiro, -2], ["document.downloaded", "document", "dev-doc-1", comercial, -3],
    ["work_order.closed", "work_order", "dev-wo-2", tecnico, -5], ["settings.updated", "settings", "settings", ceo, -8], ["customer.updated", "customer", "dev-customer-3", comercial, -6],
  ];
  await insert("audit_logs", companyId, audits.map(([action, entity_type, entity_id, user_id, days], i) => ({ id: `dev-audit-${i + 1}`, user_id, entity_type, entity_id, action, created_at: ts(days) })));

  await db.execute("INSERT OR IGNORE INTO settings (id, company_id, key, value_json) VALUES (?,?,?,?)", [`dev-flag-${companyId}`, companyId, FLAG, "{}"]);
}
