// Consultas compartilhadas pelas telas do CRM (TanStack Query). queryKey = [recurso, empresa, ...]; depois de gravar,
// invalide pelo prefixo com invalidateCrm().
import { useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { can, type Action, type Resource } from "@/lib/permissions/rbac";
import { fetchActivities, type ActivityFilter } from "@/lib/crm/activities";
import { fetchCompanyUsers, fetchContacts, fetchCustomers, fetchOpportunities, fetchPriceLists, fetchProducts, fetchProposals } from "@/lib/crm/queries";
import { fetchEntityTags, fetchSavedViews, fetchTags, tagsByEntity } from "@/lib/crm/segments";
import type { Role } from "@/types";

export function useCrmSession() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  return {
    session,
    companyId: session.company.id,
    userId: session.user.id,
    role,
    can: (action: Action, resource: Resource) => can(role, action, resource),
  };
}

export const crmKeys = {
  customers: (companyId: string) => ["customers", companyId] as const,
  contacts: (companyId: string, customerId?: string) => (customerId ? (["contacts", companyId, customerId] as const) : (["contacts", companyId] as const)),
  opportunities: (companyId: string) => ["opportunities", companyId] as const,
  proposals: (companyId: string) => ["proposals", companyId] as const,
  activities: (companyId: string) => ["crm-activities", companyId] as const,
  tags: (companyId: string) => ["tags", companyId] as const,
  entityTags: (companyId: string, entityType: string) => ["entity-tags", companyId, entityType] as const,
  savedViews: (companyId: string, entityType: string) => ["saved-views", companyId, entityType] as const,
  users: (companyId: string) => ["company-users", companyId] as const,
  products: (companyId: string) => ["products", companyId] as const,
  priceLists: (companyId: string) => ["price-lists", companyId] as const,
};

export type CrmArea = "customers" | "contacts" | "opportunities" | "proposals" | "activities" | "tags" | "views" | "leads" | "sales";

/** Invalida as listas do CRM (e do funil de leads) depois de uma gravação. Sem área, invalida todas. */
export function invalidateCrm(qc: QueryClient, companyId: string, ...what: CrmArea[]) {
  const all = what.length === 0;
  const keys: Record<string, readonly unknown[][]> = {
    customers: [["customers", companyId], ["customer", companyId], ["customer-finance", companyId], ["duplicates", companyId]],
    contacts: [["contacts", companyId]],
    opportunities: [["opportunities", companyId]],
    proposals: [["proposals", companyId], ["proposal", companyId]],
    activities: [["crm-activities", companyId], ["overdue-follow-ups", companyId]],
    tags: [["tags", companyId], ["entity-tags", companyId]],
    views: [["saved-views", companyId]],
    leads: [["leads", companyId]],
    sales: [["sales-orders", companyId], ["sales_orders", companyId]],
  };
  for (const [name, list] of Object.entries(keys)) {
    if (!all && !what.includes(name as CrmArea)) continue;
    for (const queryKey of list) void qc.invalidateQueries({ queryKey });
  }
}

export function useInvalidateCrm() {
  const qc = useQueryClient();
  const { companyId } = useCrmSession();
  return (...what: CrmArea[]) => invalidateCrm(qc, companyId, ...what);
}

export function useCustomers(enabled = true) {
  const { companyId } = useCrmSession();
  return useQuery({ queryKey: crmKeys.customers(companyId), queryFn: async () => fetchCustomers(await getDb(), companyId), enabled });
}

export function useCustomerMap() {
  const query = useCustomers();
  const map = useMemo(() => new Map((query.data ?? []).map((customer) => [customer.id, customer])), [query.data]);
  return { ...query, map };
}

export function useContacts(customerId?: string) {
  const { companyId } = useCrmSession();
  return useQuery({ queryKey: crmKeys.contacts(companyId, customerId), queryFn: async () => fetchContacts(await getDb(), companyId, customerId) });
}

export function useOpportunities(enabled = true) {
  const { companyId } = useCrmSession();
  return useQuery({ queryKey: crmKeys.opportunities(companyId), queryFn: async () => fetchOpportunities(await getDb(), companyId), enabled });
}

export function useProposals(enabled = true) {
  const { companyId } = useCrmSession();
  return useQuery({ queryKey: crmKeys.proposals(companyId), queryFn: async () => fetchProposals(await getDb(), companyId), enabled });
}

export function useActivities(filter: ActivityFilter = {}, enabled = true) {
  const { companyId } = useCrmSession();
  return useQuery({
    queryKey: [...crmKeys.activities(companyId), filter.customerId ?? null, filter.entityType ?? null, filter.entityId ?? null],
    queryFn: async () => fetchActivities(await getDb(), companyId, filter),
    enabled,
  });
}

export function useCompanyUsers() {
  const { companyId } = useCrmSession();
  const query = useQuery({ queryKey: crmKeys.users(companyId), queryFn: async () => fetchCompanyUsers(await getDb(), companyId) });
  const names = useMemo(() => new Map((query.data ?? []).map((user) => [user.id, user.name])), [query.data]);
  return { ...query, names };
}

export function useProducts(enabled = true) {
  const { companyId } = useCrmSession();
  return useQuery({ queryKey: crmKeys.products(companyId), queryFn: async () => fetchProducts(await getDb(), companyId), enabled });
}

export function useTags(entityType = "customer") {
  const { companyId } = useCrmSession();
  const tags = useQuery({ queryKey: [...crmKeys.tags(companyId), entityType], queryFn: async () => fetchTags(await getDb(), companyId, entityType) });
  const links = useQuery({ queryKey: crmKeys.entityTags(companyId, entityType), queryFn: async () => fetchEntityTags(await getDb(), companyId, entityType) });
  const byEntity = useMemo(() => tagsByEntity(links.data ?? []), [links.data]);
  const byId = useMemo(() => new Map((tags.data ?? []).map((tag) => [tag.id, tag])), [tags.data]);
  return { tags: tags.data ?? [], byEntity, byId, isLoading: tags.isLoading || links.isLoading };
}

export function useSavedViews(entityType: string) {
  const { companyId, userId } = useCrmSession();
  return useQuery({ queryKey: [...crmKeys.savedViews(companyId, entityType), userId], queryFn: async () => fetchSavedViews(await getDb(), companyId, entityType, userId) });
}

export function usePriceLists(enabled = true) {
  const { companyId } = useCrmSession();
  return useQuery({ queryKey: crmKeys.priceLists(companyId), queryFn: async () => fetchPriceLists(await getDb(), companyId), enabled });
}

/** Registro de auditoria (tabela activities) depois de uma gravação feita na tela. Falha aqui não desfaz a gravação. */
export function useAudit() {
  const { companyId, userId } = useCrmSession();
  return (type: string, entityType: string, entityId: string, title: string, extra: { oldValue?: unknown; newValue?: unknown; module?: string } = {}) =>
    emit({ type, companyId, actorId: userId, entityType, entityId, title, module: extra.module ?? "crm", oldValue: extra.oldValue, newValue: extra.newValue }).catch((error: unknown) => {
      console.error("[crm] auditoria", error);
    });
}

/** Nome legível de um registro do CRM (para a linha do tempo e as atividades). */
export function useEntityNames() {
  const { can } = useCrmSession();
  const customers = useCustomers();
  const opportunities = useOpportunities(can("view", "opportunities"));
  const proposals = useProposals(can("view", "proposals"));
  const contacts = useContacts();
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const row of customers.data ?? []) names.set(`customer:${row.id}`, row.name);
    for (const row of opportunities.data ?? []) names.set(`opportunity:${row.id}`, row.title);
    for (const row of proposals.data ?? []) names.set(`proposal:${row.id}`, row.title ?? `Proposta ${row.number ?? ""}`.trim());
    for (const row of contacts.data ?? []) names.set(`contact:${row.id}`, row.name);
    const customerOf = new Map((customers.data ?? []).map((row) => [row.id, row.name]));
    return {
      name: (type: string, id: string) => names.get(`${type}:${id}`) ?? null,
      customer: (id: string | null | undefined) => (id ? customerOf.get(id) ?? null : null),
    };
  }, [customers.data, opportunities.data, proposals.data, contacts.data]);
}
