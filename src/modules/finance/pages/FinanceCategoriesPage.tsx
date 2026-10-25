// Plano de contas (categorias de receita e despesa em árvore, com a linha da DRE) e centros de custo, editados na
// própria tabela. Regras (código único, sem ciclo, exclusão só sem uso) em lib/erp/financeSetup.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { categoryGroup, DRE_GROUP_LABELS, DRE_GROUPS } from "@/lib/erp/dre";
import { deleteCategory, deleteCostCenter } from "@/lib/erp/financeSetup";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import type { FinanceCategory, FinanceCategoryKind } from "@/types";
import { categoryRow, costCenterRow, saveCategoryChanges, saveCostCenterChanges, type CategoryRow, type CostCenterRow } from "../data/categoryEditing";
import { useEditContext } from "../data/useEditContext";
import { ConfirmButton, ErrorNote, Field, categoryLabel, categoryTree, errorMessage, inputClass, invalidateFinance, useFinanceLookups } from "../components/financeShared";

type Tab = "plano" | "centros";
const TABS = [
  { id: "plano", label: "Plano de contas" },
  { id: "centros", label: "Centros de custo" },
] as const;
const KIND_OPTIONS: { value: FinanceCategoryKind; label: string }[] = [
  { value: "receita", label: "Receita" },
  { value: "despesa", label: "Despesa" },
];
const DRE_OPTIONS = DRE_GROUPS.map((group) => ({ value: group, label: DRE_GROUP_LABELS[group] }));

interface Department {
  id: string;
  name: string;
  deleted_at?: string | null;
}

function categoryColumns(categories: FinanceCategory[], depthOf: Map<string, number>): EditableColumn<CategoryRow>[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const parentOptions = categoryTree(categories).map(({ category, depth }) => ({ value: category.id, label: `${"  ".repeat(depth)}${categoryLabel(category)}` }));
  return [
    { key: "code", header: "Código", kind: "text", placeholder: "4.1", width: 90 },
    {
      key: "name",
      header: "Categoria",
      kind: "text",
      required: true,
      width: 260,
      render: (row) => {
        const depth = depthOf.get(row.id) ?? 0;
        return <span className={cn(depth === 0 && "font-semibold", !row.active && "text-muted-foreground")} style={{ paddingLeft: `${depth * 1.25}rem` }}>{row.name}</span>;
      },
    },
    { key: "kind", header: "Tipo", kind: "select", options: KIND_OPTIONS },
    { key: "parent_id", header: "Categoria pai", kind: "select", options: parentOptions, render: (row) => (row.parent_id && byId.get(row.parent_id) ? categoryLabel(byId.get(row.parent_id)!) : <span className="text-muted-foreground">—</span>) },
    {
      key: "dre_group",
      header: "Linha da DRE",
      kind: "select",
      options: DRE_OPTIONS,
      placeholder: "Herdar",
      render: (row) => {
        if (row.dre_group) return DRE_GROUP_LABELS[row.dre_group];
        const inherited = categoryGroup(byId, row.id);
        return <span className="text-muted-foreground">{inherited ? `${DRE_GROUP_LABELS[inherited]} (herdada)` : "—"}</span>;
      },
    },
    { key: "position", header: "Ordem", kind: "number", width: 80 },
    { key: "active", header: "Ativa", kind: "bool" },
  ];
}

export default function FinanceCategoriesPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const lookups = useFinanceLookups(companyId);
  const canDelete = usePermission("delete", "finance");
  const [tab, setTab] = useState<Tab>("plano");
  const [kindFilter, setKindFilter] = useState<"" | FinanceCategoryKind>("");

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
  const tree = categoryTree(categories);
  const depthOf = useMemo(() => new Map(tree.map(({ category, depth }) => [category.id, depth])), [tree]);
  const categoryRows = tree.filter(({ category }) => !kindFilter || category.kind === kindFilter).map(({ category }) => categoryRow(category));
  const columns = useMemo(() => categoryColumns(categories, depthOf), [categories, depthOf]);
  const departmentOptions = departments.map((department) => ({ value: department.id, label: department.name }));
  const costCenterColumns: EditableColumn<CostCenterRow>[] = [
    { key: "name", header: "Centro de custo", kind: "text", required: true, width: 260 },
    { key: "department_id", header: "Departamento", kind: "select", options: departmentOptions, render: (row) => departments.find((department) => department.id === row.department_id)?.name ?? <span className="text-muted-foreground">—</span> },
  ];

  async function saveCategories(changes: EditableTableChanges<CategoryRow>) {
    await saveCategoryChanges(await getDb(), ctx, changes);
    invalidateFinance(qc, companyId);
  }

  async function saveCostCenters(changes: EditableTableChanges<CostCenterRow>) {
    await saveCostCenterChanges(await getDb(), ctx, changes);
    invalidateFinance(qc, companyId);
  }

  const remove = useMutation({
    mutationFn: async (target: { type: "category" | "costCenter"; id: string }) => {
      const db = await getDb();
      if (target.type === "category") await deleteCategory(db, companyId, target.id);
      else await deleteCostCenter(db, companyId, target.id);
    },
    onSuccess: () => invalidateFinance(qc, companyId),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Plano de contas" />

      <div>
        <TabList tabs={TABS} value={tab} onChange={(next) => { setTab(next); remove.reset(); }} label="Cadastros do financeiro" idPrefix="plano-de-contas" />
      </div>
      <ErrorNote message={remove.error ? errorMessage(remove.error) : null} />

      <TabPanel idPrefix="plano-de-contas" id={tab}>
        {tab === "plano" ? (
          <div className="space-y-3">
            <EditableTable<CategoryRow>
              resource="finance"
              label="Plano de contas"
              rows={categoryRows}
              columns={columns}
              newRow={() => ({ kind: kindFilter || "despesa", active: 1 })}
              onSave={saveCategories}
              onRefresh={() => qc.invalidateQueries({ queryKey: ["finance_categories", companyId] })}
              emptyMessage={kindFilter ? "Nenhuma categoria." : "Nenhuma categoria. Adicione as categorias de receita e de despesa (com código, ex.: 3, 3.1, 4, 4.1) para classificar os lançamentos e montar a DRE."}
              actions={
                <Field label="Tipo" className="flex-row items-center gap-2">
                  <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "" | FinanceCategoryKind)} className={inputClass}>
                    <option value="">Receitas e despesas</option>
                    <option value="receita">Receitas</option>
                    <option value="despesa">Despesas</option>
                  </select>
                </Field>
              }
              rowActions={
                canDelete
                  ? (row) => <ConfirmButton label="" ariaLabel={`Excluir ${row.name}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={15} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate({ type: "category", id: row.id })} />
                  : undefined
              }
            />
            <p className="text-sm text-muted-foreground">Linha da DRE vazia herda da categoria pai (ou do tipo). Categoria inativa não aparece para novos lançamentos, mas continua na DRE dos antigos.</p>
          </div>
        ) : (
          <EditableTable<CostCenterRow>
            resource="finance"
            label="Centros de custo"
            rows={lookups.costCenters.map(costCenterRow)}
            columns={costCenterColumns}
            onSave={saveCostCenters}
            onRefresh={() => qc.invalidateQueries({ queryKey: ["cost_centers", companyId] })}
            emptyMessage="Nenhum centro de custo. Centros de custo separam despesas por área (ex.: Comercial, Produção, TI)."
            rowActions={
              canDelete
                ? (row) => <ConfirmButton label="" ariaLabel={`Excluir ${row.name}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={15} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate({ type: "costCenter", id: row.id })} />
                : undefined
            }
          />
        )}
      </TabPanel>
    </div>
  );
}
