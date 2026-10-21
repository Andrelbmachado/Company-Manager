// Entity registry: the single source of truth for every module's data shape.
// It drives listing, creation forms, CSV/JSON import, export, CSV templates
// and the automation API exposed on `window.companyManager`.
// To add a new module, add an entry here first (see AGENTS.md).

import type { Resource } from "@/lib/permissions/rbac";

export type FieldType =
  | "text"
  | "longtext"
  | "email"
  | "phone"
  | "number"
  | "integer"
  | "currency"
  | "date"
  | "datetime"
  | "enum"
  | "ref";

export interface FieldOption {
  value: string;
  label: string;
}

export interface RefConfig {
  /** Referenced entity key. */
  entity: EntityKey;
  /** Columns tried, in order, to resolve an imported text value to an id. */
  matchBy: string[];
  /** Column shown to humans and written to exports. */
  display: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  ref?: RefConfig;
  /** Alternative CSV header names (any case/accent). */
  aliases?: string[];
  defaultValue?: string | number;
  /** Computed/derived: exported but never imported nor shown in forms. */
  readonly?: boolean;
  placeholder?: string;
}

export interface EntityDef {
  key: EntityKey;
  table: string;
  label: string;
  labelPlural: string;
  /** Route of the page that shows this entity. */
  path: string;
  resource: Resource;
  fields: FieldDef[];
  /** Field used as the human title of a row. */
  titleField: string;
  /** Default ordering, applied in memory: [field, direction]. */
  orderBy: [string, "asc" | "desc"];
  /** Import disabled (e.g. immutable audit trail). */
  importable?: boolean;
  /** Creation from the UI disabled. */
  creatable?: boolean;
  /** Fields used to detect duplicates on import. */
  dedupeBy?: string[];
  /** Auto-generated sequential code, e.g. OS-0001. */
  autoNumber?: { field: string; prefix: string };
  /** Event emitted on the bus when a row is created. */
  createdEvent: string;
  /** Grammatical gender of `label` ("Nova oportunidade"). */
  feminine?: boolean;
}

const opt = (pairs: [string, string][]): FieldOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const PRIORITY_OPTIONS = opt([
  ["baixa", "Baixa"],
  ["media", "Média"],
  ["alta", "Alta"],
  ["urgente", "Urgente"],
]);

export const LEAD_STATUS_OPTIONS = opt([
  ["novo", "Novo"],
  ["qualificado", "Qualificado"],
  ["descartado", "Descartado"],
  ["convertido", "Convertido"],
]);

export const OPPORTUNITY_STAGE_OPTIONS = opt([
  ["novo", "Novo"],
  ["qualificacao", "Qualificação"],
  ["proposta", "Proposta"],
  ["negociacao", "Negociação"],
  ["ganho", "Ganho"],
  ["perdido", "Perdido"],
]);

const CUSTOMER_REF: RefConfig = { entity: "customers", matchBy: ["id", "name", "document", "email"], display: "name" };

const ENTITY_LIST: EntityDef[] = [
  {
    key: "customers",
    table: "customers",
    label: "Cliente",
    labelPlural: "Clientes",
    path: "/crm",
    resource: "customers",
    titleField: "name",
    orderBy: ["name", "asc"],
    dedupeBy: ["document", "email"],
    createdEvent: "customer.created",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, aliases: ["razao social", "cliente", "empresa", "nome fantasia", "company"], placeholder: "Empresa XYZ Ltda" },
      { key: "type", label: "Tipo", type: "enum", options: opt([["PJ", "Pessoa Jurídica"], ["PF", "Pessoa Física"]]), defaultValue: "PJ", aliases: ["pessoa", "tipo pessoa"] },
      { key: "document", label: "CNPJ/CPF", type: "text", aliases: ["cnpj", "cpf", "documento", "doc"], placeholder: "00.000.000/0001-00" },
      { key: "email", label: "E-mail", type: "email", aliases: ["mail", "e mail"], placeholder: "contato@empresa.com" },
      { key: "phone", label: "Telefone", type: "phone", aliases: ["fone", "celular", "whatsapp", "telefone celular", "mobile"], placeholder: "(11) 99999-9999" },
      { key: "segment", label: "Segmento", type: "text", aliases: ["setor", "ramo", "industry"] },
      { key: "status", label: "Status", type: "enum", options: opt([["active", "Ativo"], ["inactive", "Inativo"]]), defaultValue: "active", aliases: ["situacao"] },
      { key: "created_at", label: "Cadastro", type: "datetime", readonly: true },
    ],
  },
  {
    key: "leads",
    table: "leads",
    label: "Lead",
    labelPlural: "Leads",
    path: "/opportunities?tab=leads",
    resource: "leads",
    titleField: "name",
    orderBy: ["created_at", "desc"],
    dedupeBy: ["email", "phone"],
    createdEvent: "lead.created",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, aliases: ["nome completo", "full name", "nome do contato", "nome contato", "lead", "first name"], placeholder: "Maria Souza" },
      { key: "email", label: "E-mail", type: "email", aliases: ["mail", "e mail", "email address"], placeholder: "maria@empresa.com" },
      { key: "phone", label: "Telefone", type: "phone", aliases: ["fone", "celular", "whatsapp", "mobile", "phone number", "telefone celular"], placeholder: "(11) 99999-9999" },
      { key: "company_name", label: "Empresa", type: "text", aliases: ["company", "organizacao", "organization", "razao social", "conta"] },
      { key: "position", label: "Cargo", type: "text", aliases: ["job title", "titulo", "funcao", "title", "role"] },
      { key: "source", label: "Origem", type: "text", aliases: ["fonte", "canal", "utm source", "lead source", "midia"], placeholder: "Site, indicação, feira..." },
      { key: "status", label: "Status", type: "enum", options: LEAD_STATUS_OPTIONS, defaultValue: "novo", aliases: ["situacao", "lead status"] },
      { key: "score", label: "Pontuação", type: "integer", defaultValue: 0, aliases: ["lead score", "nota", "pontos"] },
      { key: "notes", label: "Observações", type: "longtext", aliases: ["obs", "notas", "comentarios", "notes", "descricao"] },
      { key: "created_at", label: "Cadastro", type: "datetime", readonly: true },
    ],
  },
  {
    key: "opportunities",
    feminine: true,
    table: "opportunities",
    label: "Oportunidade",
    labelPlural: "Oportunidades",
    path: "/opportunities",
    resource: "opportunities",
    titleField: "title",
    orderBy: ["created_at", "desc"],
    createdEvent: "opportunity.created",
    fields: [
      { key: "title", label: "Título", type: "text", required: true, aliases: ["oportunidade", "negocio", "deal", "nome", "deal name"], placeholder: "Contrato de manutenção anual" },
      { key: "customer_id", label: "Cliente", type: "ref", ref: CUSTOMER_REF, aliases: ["empresa", "conta", "customer", "company"] },
      { key: "value", label: "Valor", type: "currency", defaultValue: 0, aliases: ["montante", "amount", "valor estimado", "deal value"] },
      { key: "stage", label: "Etapa", type: "enum", options: OPPORTUNITY_STAGE_OPTIONS, defaultValue: "novo", aliases: ["fase", "estagio", "pipeline stage", "deal stage"] },
      { key: "probability", label: "Probabilidade (%)", type: "integer", defaultValue: 0, aliases: ["probabilidade", "chance", "%"] },
      { key: "expected_close_date", label: "Previsão de fechamento", type: "date", aliases: ["data de fechamento", "fechamento", "close date"] },
      { key: "notes", label: "Observações", type: "longtext", aliases: ["obs", "notas", "descricao"] },
      { key: "created_at", label: "Cadastro", type: "datetime", readonly: true },
    ],
  },
  {
    key: "tickets",
    table: "tickets",
    label: "Ticket",
    labelPlural: "Tickets",
    path: "/support",
    resource: "tickets",
    titleField: "subject",
    orderBy: ["created_at", "desc"],
    createdEvent: "ticket.created",
    fields: [
      { key: "subject", label: "Assunto", type: "text", required: true, aliases: ["titulo", "problema", "title"], placeholder: "Descreva o problema" },
      { key: "customer_id", label: "Cliente", type: "ref", ref: CUSTOMER_REF, aliases: ["empresa", "customer"] },
      { key: "priority", label: "Prioridade", type: "enum", options: PRIORITY_OPTIONS, defaultValue: "media" },
      { key: "status", label: "Status", type: "enum", options: opt([["aberto", "Aberto"], ["em_atendimento", "Em atendimento"], ["aguardando", "Aguardando"], ["resolvido", "Resolvido"], ["fechado", "Fechado"]]), defaultValue: "aberto" },
      { key: "channel", label: "Canal", type: "text", defaultValue: "manual", aliases: ["origem"] },
      { key: "description", label: "Descrição", type: "longtext", aliases: ["detalhes", "obs"] },
      { key: "created_at", label: "Aberto em", type: "datetime", readonly: true },
    ],
  },
  {
    key: "work_orders",
    feminine: true,
    table: "work_orders",
    label: "Ordem de serviço",
    labelPlural: "Ordens de serviço",
    path: "/work-orders",
    resource: "work_orders",
    titleField: "number",
    orderBy: ["created_at", "desc"],
    autoNumber: { field: "number", prefix: "OS-" },
    dedupeBy: ["number"],
    createdEvent: "work_order.created",
    fields: [
      { key: "number", label: "Número", type: "text", aliases: ["os", "numero", "codigo"], placeholder: "Gerado automaticamente" },
      { key: "customer_id", label: "Cliente", type: "ref", ref: CUSTOMER_REF, aliases: ["empresa", "customer"] },
      { key: "status", label: "Status", type: "enum", options: opt([["aberta", "Aberta"], ["atribuida", "Atribuída"], ["aguardando_peca", "Aguardando peça"], ["em_execucao", "Em execução"], ["concluida", "Concluída"], ["cancelada", "Cancelada"]]), defaultValue: "aberta" },
      { key: "priority", label: "Prioridade", type: "enum", options: PRIORITY_OPTIONS, defaultValue: "media" },
      { key: "labor_cost", label: "Custo M.O.", type: "currency", defaultValue: 0, aliases: ["mao de obra", "custo mao de obra"] },
      { key: "materials_cost", label: "Custo materiais", type: "currency", defaultValue: 0, aliases: ["materiais", "custo material"] },
      { key: "opened_at", label: "Aberta em", type: "datetime", readonly: true },
    ],
  },
  {
    key: "projects",
    table: "projects",
    label: "Projeto",
    labelPlural: "Projetos",
    path: "/projects",
    resource: "projects",
    titleField: "name",
    orderBy: ["created_at", "desc"],
    createdEvent: "project.created",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, aliases: ["projeto", "titulo"], placeholder: "Implantação rede filial" },
      { key: "customer_id", label: "Cliente", type: "ref", ref: CUSTOMER_REF, aliases: ["empresa", "customer"] },
      { key: "status", label: "Status", type: "enum", options: opt([["planejado", "Planejado"], ["andamento", "Em andamento"], ["pausado", "Pausado"], ["concluido", "Concluído"], ["cancelado", "Cancelado"]]), defaultValue: "planejado" },
      { key: "budget", label: "Orçamento", type: "currency", defaultValue: 0, aliases: ["valor", "budget"] },
      { key: "start_date", label: "Início", type: "date", aliases: ["data inicio", "inicio"] },
      { key: "end_date", label: "Prazo", type: "date", aliases: ["data fim", "fim", "entrega"] },
    ],
  },
  {
    key: "inventory_items",
    table: "inventory_items",
    label: "Item de estoque",
    labelPlural: "Itens de estoque",
    path: "/inventory",
    resource: "inventory",
    titleField: "name",
    orderBy: ["name", "asc"],
    dedupeBy: ["sku"],
    createdEvent: "stock.item_created",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true, aliases: ["item", "produto", "descricao"], placeholder: "Cabo de rede Cat6" },
      { key: "sku", label: "SKU", type: "text", aliases: ["codigo", "cod", "referencia"], placeholder: "CAB-CAT6-01" },
      { key: "category", label: "Categoria", type: "text", aliases: ["grupo", "familia"], placeholder: "Cabos" },
      { key: "unit", label: "Unidade", type: "text", defaultValue: "un", aliases: ["un", "unid", "medida"] },
      { key: "min_stock", label: "Estoque mínimo", type: "number", defaultValue: 0, aliases: ["minimo", "estoque min"] },
      { key: "max_stock", label: "Estoque máximo", type: "number", aliases: ["maximo", "estoque max"] },
      { key: "cost", label: "Custo unitário", type: "currency", defaultValue: 0, aliases: ["custo", "preco de custo", "valor"] },
      { key: "quantity", label: "Saldo", type: "number", readonly: true },
    ],
  },
  {
    key: "custodies",
    feminine: true,
    table: "custodies",
    label: "Custódia",
    labelPlural: "Custódias",
    path: "/custody",
    resource: "custody",
    titleField: "item_id",
    orderBy: ["checked_out_at", "desc"],
    createdEvent: "custody.created",
    fields: [
      { key: "item_id", label: "Item", type: "ref", ref: { entity: "inventory_items", matchBy: ["id", "sku", "name"], display: "name" }, aliases: ["sku", "produto"] },
      { key: "holder_id", label: "Responsável", type: "ref", required: true, ref: { entity: "users", matchBy: ["id", "email", "name"], display: "name" }, aliases: ["tecnico", "usuario", "email responsavel"] },
      { key: "quantity", label: "Quantidade", type: "number", defaultValue: 1, aliases: ["qtd", "qtde"] },
      { key: "status", label: "Status", type: "enum", options: opt([["em_custodia", "Em custódia"], ["devolvido", "Devolvido"], ["consumido", "Consumido"], ["perdido", "Perdido"]]), defaultValue: "em_custodia" },
      { key: "checked_out_at", label: "Retirada", type: "datetime", aliases: ["data retirada"] },
      { key: "due_back_at", label: "Devolução prevista", type: "datetime", aliases: ["devolucao", "data devolucao"] },
    ],
  },
  {
    key: "payables",
    feminine: true,
    table: "payables",
    label: "Conta a pagar",
    labelPlural: "Contas a pagar",
    path: "/finance?tab=payables",
    resource: "payables",
    titleField: "description",
    orderBy: ["due_date", "asc"],
    createdEvent: "payable.created",
    fields: [
      { key: "description", label: "Descrição", type: "text", required: true, aliases: ["historico", "titulo", "fornecedor"], placeholder: "Aluguel escritório" },
      { key: "amount", label: "Valor", type: "currency", required: true, aliases: ["valor total", "montante"] },
      { key: "due_date", label: "Vencimento", type: "date", aliases: ["data vencimento", "vence em"] },
      { key: "status", label: "Status", type: "enum", options: opt([["aberta", "Aberta"], ["aprovada", "Aprovada"], ["paga", "Paga"], ["vencida", "Vencida"], ["cancelada", "Cancelada"]]), defaultValue: "aberta" },
    ],
  },
  {
    key: "receivables",
    feminine: true,
    table: "receivables",
    label: "Conta a receber",
    labelPlural: "Contas a receber",
    path: "/finance?tab=receivables",
    resource: "receivables",
    titleField: "ref_type",
    orderBy: ["due_date", "asc"],
    createdEvent: "receivable.created",
    fields: [
      { key: "customer_id", label: "Cliente", type: "ref", ref: CUSTOMER_REF, aliases: ["empresa", "sacado", "customer"] },
      { key: "ref_type", label: "Referência", type: "text", aliases: ["descricao", "historico", "origem"], placeholder: "Contrato, OS, projeto..." },
      { key: "amount", label: "Valor", type: "currency", required: true, aliases: ["valor total", "montante"] },
      { key: "due_date", label: "Vencimento", type: "date", aliases: ["data vencimento", "vence em"] },
      { key: "status", label: "Status", type: "enum", options: opt([["aberta", "Aberta"], ["recebida", "Recebida"], ["vencida", "Vencida"], ["cancelada", "Cancelada"]]), defaultValue: "aberta" },
    ],
  },
  {
    key: "documents",
    table: "documents",
    label: "Documento",
    labelPlural: "Documentos",
    path: "/documents",
    resource: "documents",
    titleField: "title",
    orderBy: ["created_at", "desc"],
    createdEvent: "document.created",
    fields: [
      { key: "title", label: "Título", type: "text", required: true, aliases: ["nome", "documento"], placeholder: "Contrato de prestação de serviço" },
      { key: "type", label: "Tipo", type: "text", aliases: ["categoria"], placeholder: "Contrato, laudo, NF..." },
      { key: "file_path", label: "Caminho do arquivo", type: "text", required: true, aliases: ["arquivo", "caminho", "path", "url"], placeholder: "/Documentos/contrato.pdf" },
      { key: "version", label: "Versão", type: "integer", defaultValue: 1, aliases: ["versao"] },
      { key: "entity_type", label: "Vinculado a", type: "text", aliases: ["entidade", "modulo"] },
      { key: "created_at", label: "Enviado em", type: "datetime", readonly: true },
    ],
  },
  {
    key: "audit_logs",
    table: "audit_logs",
    label: "Log de auditoria",
    labelPlural: "Logs de auditoria",
    path: "/audit",
    resource: "audit_logs",
    titleField: "action",
    orderBy: ["created_at", "desc"],
    importable: false,
    creatable: false,
    createdEvent: "audit.created",
    fields: [
      { key: "action", label: "Ação", type: "text", readonly: true },
      { key: "entity_type", label: "Entidade", type: "text", readonly: true },
      { key: "entity_id", label: "ID da entidade", type: "text", readonly: true },
      { key: "user_id", label: "Usuário", type: "text", readonly: true },
      { key: "created_at", label: "Data/hora", type: "datetime", readonly: true },
    ],
  },
  {
    key: "users",
    table: "users",
    label: "Usuário",
    labelPlural: "Usuários",
    path: "/settings",
    resource: "users",
    titleField: "name",
    orderBy: ["name", "asc"],
    importable: false,
    creatable: false,
    createdEvent: "user.created",
    fields: [
      { key: "name", label: "Nome", type: "text", readonly: true },
      { key: "email", label: "E-mail", type: "email", readonly: true },
    ],
  },
];

export type EntityKey =
  | "customers"
  | "leads"
  | "opportunities"
  | "tickets"
  | "work_orders"
  | "projects"
  | "inventory_items"
  | "custodies"
  | "payables"
  | "receivables"
  | "documents"
  | "audit_logs"
  | "users";

export const ENTITIES: Record<EntityKey, EntityDef> = Object.fromEntries(
  ENTITY_LIST.map((e) => [e.key, e])
) as Record<EntityKey, EntityDef>;

export function getEntity(key: EntityKey): EntityDef {
  const def = ENTITIES[key];
  if (!def) throw new Error(`Entidade desconhecida: ${key}`);
  return def;
}

export function isEntityKey(key: string): key is EntityKey {
  return key in ENTITIES;
}

/** Fields that can be written (forms and imports). */
export function writableFields(def: EntityDef): FieldDef[] {
  return def.fields.filter((f) => !f.readonly);
}

/** "Novo cliente", "Nova oportunidade". */
export function newLabel(def: EntityDef): string {
  return `${def.feminine ? "Nova" : "Novo"} ${def.label.toLowerCase()}`;
}

export function optionLabel(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return field.options?.find((o) => o.value === value)?.label ?? String(value);
}
