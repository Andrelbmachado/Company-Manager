// Registros que podem ter anexos (documents.entity_type): rótulo, recurso do RBAC que libera ver o anexo, tabela e
// coluna do nome mostrado, e a tela do registro. Tipo fora daqui só aparece para quem tem acesso total (CEO e admin).
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { PERMISSIONS, can, type Resource } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

type Row = Record<string, unknown>;

export interface AttachmentEntity {
  label: string;
  /** Ver o anexo exige `view` neste recurso (além de `view` em documents, na tela de Documentos). */
  resource: Resource;
  table: string;
  name: (row: Row) => string;
  /** Tela do registro, quando existe. */
  route?: (id: string) => string;
}

const text = (value: unknown) => (value == null ? "" : String(value));

export const ATTACHMENT_ENTITIES: Record<string, AttachmentEntity> = {
  customer: { label: "Cliente", resource: "customers", table: "customers", name: (row) => text(row.name), route: (id) => `/crm/clientes/${id}` },
  contact: { label: "Contato", resource: "customers", table: "contacts", name: (row) => text(row.name) },
  lead: { label: "Lead", resource: "leads", table: "leads", name: (row) => text(row.name) },
  opportunity: { label: "Oportunidade", resource: "opportunities", table: "opportunities", name: (row) => text(row.title) },
  proposal: {
    label: "Proposta",
    resource: "proposals",
    table: "proposals",
    name: (row) => text(row.title) || formatSequence("proposals", row.number as number | null),
    route: (id) => `/crm/propostas/${id}`,
  },
  ticket: { label: "Ticket", resource: "tickets", table: "tickets", name: (row) => text(row.subject) },
  work_order: { label: "Ordem de serviço", resource: "work_orders", table: "work_orders", name: (row) => text(row.number) },
  project: { label: "Projeto", resource: "projects", table: "projects", name: (row) => text(row.name) },
  product: { label: "Produto", resource: "products", table: "products", name: (row) => text(row.name) },
  supplier: { label: "Fornecedor", resource: "suppliers", table: "suppliers", name: (row) => text(row.name) },
  inventory_item: { label: "Item de estoque", resource: "inventory", table: "inventory_items", name: (row) => text(row.name) },
  sales_order: {
    label: "Pedido de venda",
    resource: "sales_orders",
    table: "sales_orders",
    name: (row) => formatSequence("sales_orders", row.number as number | null),
    route: (id) => `/sales/pedidos/${id}`,
  },
  invoice: {
    label: "Fatura",
    resource: "invoices",
    table: "invoices",
    name: (row) => formatSequence("invoices", row.number as number | null),
    route: (id) => `/sales/faturas/${id}`,
  },
  purchase_order: {
    label: "Pedido de compra",
    resource: "purchase_orders",
    table: "purchase_orders",
    name: (row) => formatSequence("purchase_orders", row.number as number | null),
    route: (id) => `/purchasing/pedidos/${id}`,
  },
  goods_receipt: {
    label: "Recebimento",
    resource: "purchase_orders",
    table: "goods_receipts",
    name: (row) => formatSequence("goods_receipts", row.number as number | null),
  },
  payable: { label: "Conta a pagar", resource: "payables", table: "payables", name: (row) => text(row.description) },
  receivable: { label: "Conta a receber", resource: "receivables", table: "receivables", name: (row) => text(row.description ?? row.ref_id) },
  employee: {
    label: "Colaborador",
    resource: "hr_admin",
    table: "employees",
    name: (row) => text(row.name),
    route: (id) => `/hr/manage/colaboradores/${id}`,
  },
};

export function attachmentEntity(entityType: string | null | undefined): AttachmentEntity | null {
  return (entityType && Object.prototype.hasOwnProperty.call(ATTACHMENT_ENTITIES, entityType) && ATTACHMENT_ENTITIES[entityType]) || null;
}

/** Rótulo do tipo de registro ("Cliente"); tipo desconhecido aparece como veio. */
export function attachmentEntityLabel(entityType: string): string {
  return attachmentEntity(entityType)?.label ?? entityType;
}

/** O papel pode ver anexos deste tipo de registro? Tipo desconhecido: só quem tem acesso total ("*"). */
export function canViewAttachmentsOf(role: Role, entityType: string): boolean {
  const entity = attachmentEntity(entityType);
  if (entity) return can(role, "view", entity.resource);
  return Boolean(PERMISSIONS[role]?.["*"]);
}

/** Nome de cada registro (id → nome) dos tipos pedidos. Tipos desconhecidos ou consultas que falham ficam de fora. */
export async function attachmentEntityNames(companyId: string, entityTypes: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const db = await getDb();
  for (const entityType of new Set(entityTypes)) {
    const entity = attachmentEntity(entityType);
    if (!entity) continue;
    try {
      // Tabela vem do registro fixo acima (nunca de dado do usuário). Sem filtro de excluídos: anexo de registro
      // excluído continua com nome.
      const rows = await db.select<Row[]>(`SELECT * FROM ${entity.table} WHERE company_id=?`, [companyId]);
      for (const row of rows) names.set(`${entityType}:${text(row.id)}`, entity.name(row) || text(row.id));
    } catch {
      // tabela indisponível (ex.: banco antigo): mostra só o id
    }
  }
  return names;
}
