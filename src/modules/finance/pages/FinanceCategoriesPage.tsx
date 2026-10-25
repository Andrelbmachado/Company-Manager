// Plano de contas (categorias de receita e despesa em árvore, com a linha da DRE) e centros de custo.
// Regras (código único, sem ciclo, exclusão só sem uso) em lib/erp/financeSetup.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ListTree, Pencil, Plus, Trash2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { categoryGroup, DRE_GROUP_LABELS, DRE_GROUPS } from "@/lib/erp/dre";
import { isTrue } from "@/lib/erp/financeCommon";
import { deleteCategory, deleteCostCenter, saveCategory, saveCostCenter } from "@/lib/erp/financeSetup";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import type { CostCenter, DreGroup, FinanceCategory, FinanceCategoryKind } from "@/types";
import {
  ConfirmButton,
  ErrorNote,
  Field,
  categoryLabel,
  categoryOptions,
  categoryTree,
  errorMessage,
  inputClass,
  invalidateFinance,
  primaryButton,
  secondaryButton,
  td,
  th,
  useFinanceLookups,
  withEmpty,
} from "../components/financeShared";

type Tab = "plano" | "centros";
const TABS = [
  { id: "plano", label: "Plano de contas" },
  { id: "centros", label: "Centros de custo" },
] as const;
const KIND_LABELS: Record<FinanceCategoryKind, string> = { receita: "Receita", despesa: "Despesa" };
const YES_NO = [
  { value: "1", label: "Sim" },
  { value: "0", label: "Não" },
];

interface Department {
  id: string;
  name: string;
  deleted_at?: string | null;
}

const iconButton = "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground";

export default function FinanceCategoriesPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const lookups = useFinanceLookups(companyId);
  const canCreate = usePermission("create", "finance");
  const canEdit = usePermission("edit", "finance");
  const canDelete = usePermission("delete", "finance");
  const [tab, setTab] = useState<Tab>("plano");
  const [kindFilter, setKindFilter] = useState<"" | FinanceCategoryKind>("");
  const [categoryForm, setCategoryForm] = useState<{ id: string | null; values: Record<string, string> } | null>(null);
  const [costCenterForm, setCostCenterForm] = useState<{ id: string | null; values: Record<string, string> } | null>(null);

  const { data: departments = [] } = useQuery({
    queryKey: ["finance", companyId, "departments"],
    queryFn: async () => {
      try {
        const rows = await (await getDb()).select<Department[]>("SELECT * FROM departments WHERE company_id=?", [companyId]);
        return rows.filter((row) => !row.deleted_at).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      } catch {
        return [];
      }
    },
  });

  const categories = lookups.categories;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const tree = categoryTree(categories).filter(({ category }) => !kindFilter || category.kind === kindFilter);

  const openCategory = (category: FinanceCategory | null, parent?: FinanceCategory) =>
    setCategoryForm({
      id: category?.id ?? null,
      values: {
        name: category?.name ?? "",
        code: category?.code ?? "",
        kind: category?.kind ?? parent?.kind ?? (kindFilter || "despesa"),
        parent_id: category?.parent_id ?? parent?.id ?? "",
        dre_group: category?.dre_group ?? "",
        position: category ? String(category.position ?? 0) : "0",
        active: category ? (isTrue(category.active) ? "1" : "0") : "1",
      },
    });
  const openCostCenter = (costCenter: CostCenter | null) => setCostCenterForm({ id: costCenter?.id ?? null, values: { name: costCenter?.name ?? "", department_id: costCenter?.department_id ?? "" } });

  const saveCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!categoryForm) return "";
      const values = categoryForm.values;
      return saveCategory(
        await getDb(),
        companyId,
        {
          name: values.name,
          kind: values.kind as FinanceCategoryKind,
          code: values.code,
          parentId: values.parent_id || null,
          dreGroup: (values.dre_group || null) as DreGroup | null,
          position: Number(values.position || 0),
          active: values.active === "1",
        },
        categoryForm.id ?? undefined,
      );
    },
    onSuccess: () => {
      invalidateFinance(qc, companyId);
      setCategoryForm(null);
    },
  });
  const saveCostCenterMutation = useMutation({
    mutationFn: async () => {
      if (!costCenterForm) return "";
      return saveCostCenter(await getDb(), companyId, { name: costCenterForm.values.name, departmentId: costCenterForm.values.department_id || null }, costCenterForm.id ?? undefined);
    },
    onSuccess: () => {
      invalidateFinance(qc, companyId);
      setCostCenterForm(null);
    },
  });
  const remove = useMutation({
    mutationFn: async (target: { type: "category" | "costCenter"; id: string }) => {
      const db = await getDb();
      if (target.type === "category") await deleteCategory(db, companyId, target.id);
      else await deleteCostCenter(db, companyId, target.id);
    },
    onSuccess: () => invalidateFinance(qc, companyId),
  });
  const toggleActive = useMutation({
    mutationFn: async (category: FinanceCategory) =>
      saveCategory(
        await getDb(),
        companyId,
        { name: category.name, kind: category.kind, code: category.code, parentId: category.parent_id ?? null, dreGroup: category.dre_group ?? null, position: category.position, active: !isTrue(category.active) },
        category.id,
      ),
    onSuccess: () => invalidateFinance(qc, companyId),
  });

  const editingCategory = categoryForm?.id ? byId.get(categoryForm.id) : undefined;
  const parentOptions = categoryOptions(categories.filter((category) => category.id !== categoryForm?.id && (!categoryForm || category.kind === categoryForm.values.kind)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plano de contas"
        description="Categorias de receita e despesa usadas nos lançamentos e na DRE, e os centros de custo."
        actions={
          <>
            {canCreate && (
              <button type="button" onClick={() => (tab === "plano" ? openCategory(null) : openCostCenter(null))} className={primaryButton}>
                <Plus size={14} aria-hidden="true" /> {tab === "plano" ? "Nova categoria" : "Novo centro de custo"}
              </button>
            )}
          </>
        }
      />

      <div>
        <TabList tabs={TABS} value={tab} onChange={setTab} label="Cadastros do financeiro" idPrefix="plano-de-contas" />
      </div>
      <ErrorNote message={remove.error ? errorMessage(remove.error) : toggleActive.error ? errorMessage(toggleActive.error) : null} />

      <TabPanel idPrefix="plano-de-contas" id={tab}>
        {tab === "plano" ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Tipo">
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "" | FinanceCategoryKind)} className={inputClass}>
                  <option value="">Receitas e despesas</option>
                  <option value="receita">Receitas</option>
                  <option value="despesa">Despesas</option>
                </select>
              </Field>
            </div>
            {tree.length === 0 ? (
              <EmptyState icon={ListTree} title="Nenhuma categoria" description="Crie as categorias (ex.: 3 Receitas › 3.1 Vendas; 4 Despesas › 4.1 Aluguel) para classificar os lançamentos e montar a DRE." />
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className={th}>Categoria</th>
                      <th className={th}>Tipo</th>
                      <th className={th}>Linha da DRE</th>
                      <th className={th}>Status</th>
                      <th className={th}><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tree.map(({ category, depth }) => {
                      const group = categoryGroup(byId, category.id);
                      return (
                        <tr key={category.id} className={cn(!isTrue(category.active) && "text-muted-foreground")}>
                          <td className={td} style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
                            <span className={cn(depth === 0 && "font-semibold")}>{categoryLabel(category)}</span>
                          </td>
                          <td className={td}>{KIND_LABELS[category.kind]}</td>
                          <td className={td}>
                            {category.dre_group ? DRE_GROUP_LABELS[category.dre_group] : <span className="text-muted-foreground">{group ? `${DRE_GROUP_LABELS[group]} (herdada)` : "—"}</span>}
                          </td>
                          <td className={td}><StatusBadge status={isTrue(category.active) ? "active" : "inactive"} /></td>
                          <td className={cn(td, "whitespace-nowrap text-right")}>
                            <span className="inline-flex items-center gap-1">
                              {canCreate && (
                                <button type="button" onClick={() => openCategory(null, category)} className={iconButton} aria-label={`Nova subcategoria de ${category.name}`} title="Nova subcategoria">
                                  <Plus size={15} aria-hidden="true" />
                                </button>
                              )}
                              {canEdit && (
                                <button type="button" onClick={() => toggleActive.mutate(category)} className={cn(secondaryButton, "py-1")}>
                                  {isTrue(category.active) ? "Desativar" : "Ativar"}
                                </button>
                              )}
                              {canEdit && (
                                <button type="button" onClick={() => openCategory(category)} className={iconButton} aria-label={`Editar ${category.name}`} title="Editar">
                                  <Pencil size={15} aria-hidden="true" />
                                </button>
                              )}
                              {canDelete && (
                                <ConfirmButton label="" ariaLabel={`Excluir ${category.name}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={15} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate({ type: "category", id: category.id })} />
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : lookups.costCenters.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhum centro de custo" description="Centros de custo separam despesas por área (ex.: Comercial, Produção, TI)." />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className={th}>Centro de custo</th>
                  <th className={th}>Departamento</th>
                  <th className={th}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lookups.costCenters.map((costCenter) => (
                  <tr key={costCenter.id}>
                    <td className={cn(td, "font-medium")}>{costCenter.name}</td>
                    <td className={td}>{departments.find((department) => department.id === costCenter.department_id)?.name ?? "—"}</td>
                    <td className={cn(td, "whitespace-nowrap text-right")}>
                      <span className="inline-flex items-center gap-1">
                        {canEdit && (
                          <button type="button" onClick={() => openCostCenter(costCenter)} className={iconButton} aria-label={`Editar ${costCenter.name}`} title="Editar">
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                        )}
                        {canDelete && (
                          <ConfirmButton label="" ariaLabel={`Excluir ${costCenter.name}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={15} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate({ type: "costCenter", id: costCenter.id })} />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabPanel>

      {categoryForm && (
        <CrudDialog
          title={categoryForm.id ? "Editar categoria" : "Nova categoria"}
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "code", label: "Código", placeholder: "4.1" },
            { key: "kind", label: "Tipo", type: "select", options: [{ value: "receita", label: "Receita" }, { value: "despesa", label: "Despesa" }] },
            { key: "parent_id", label: "Categoria pai", type: "select", options: withEmpty(parentOptions, "Nenhuma (categoria principal)") },
            { key: "dre_group", label: "Linha da DRE", type: "select", options: withEmpty(DRE_GROUPS.map((group) => ({ value: group, label: DRE_GROUP_LABELS[group] })), "Herdar (da categoria pai ou do tipo)") },
            { key: "position", label: "Ordem", type: "number" },
            { key: "active", label: "Ativa", type: "select", options: YES_NO },
          ]}
          values={categoryForm.values}
          onChange={(key, value) =>
            setCategoryForm((current) => current && { ...current, values: { ...current.values, [key]: value, ...(key === "kind" ? { parent_id: "" } : {}) } })
          }
          onClose={() => setCategoryForm(null)}
          onSubmit={() => saveCategoryMutation.mutate()}
          busy={saveCategoryMutation.isPending}
        >
          {editingCategory && !isTrue(editingCategory.active) && <p className="mt-4 text-sm text-muted-foreground">Categoria inativa não aparece nos formulários de lançamento, mas continua na DRE dos lançamentos antigos.</p>}
          <ErrorNote message={saveCategoryMutation.error ? errorMessage(saveCategoryMutation.error) : null} />
        </CrudDialog>
      )}

      {costCenterForm && (
        <CrudDialog
          title={costCenterForm.id ? "Editar centro de custo" : "Novo centro de custo"}
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "department_id", label: "Departamento", type: "select", options: withEmpty(departments.map((department) => ({ value: department.id, label: department.name }))) },
          ]}
          values={costCenterForm.values}
          onChange={(key, value) => setCostCenterForm((current) => current && { ...current, values: { ...current.values, [key]: value } })}
          onClose={() => setCostCenterForm(null)}
          onSubmit={() => saveCostCenterMutation.mutate()}
          busy={saveCostCenterMutation.isPending}
        >
          <ErrorNote message={saveCostCenterMutation.error ? errorMessage(saveCostCenterMutation.error) : null} />
        </CrudDialog>
      )}
    </div>
  );
}
