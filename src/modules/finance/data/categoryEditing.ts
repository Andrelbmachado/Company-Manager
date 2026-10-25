// Plano de contas e centros de custo editados na própria tabela: permissão "finance" na camada de dados, campos
// alterados mesclados com o cadastro gravado, validação do lote (tipo da categoria pai, código repetido) antes da
// primeira gravação e saveCategory / saveCostCenter do lib/erp.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import { isTrue, loadCategories, type FinanceDb } from "@/lib/erp/financeCommon";
import { saveCategory, saveCostCenter, type CategoryInput } from "@/lib/erp/financeSetup";
import type { CostCenter, DreGroup, FinanceCategory, FinanceCategoryKind } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "./guard";

export interface CategoryRow {
  id: string;
  code: string | null;
  name: string;
  kind: FinanceCategoryKind;
  parent_id: string | null;
  dre_group: DreGroup | null;
  position: number | null;
  active: number;
}

export interface CostCenterRow {
  id: string;
  name: string;
  department_id: string | null;
}

export function categoryRow(category: FinanceCategory): CategoryRow {
  return {
    id: category.id,
    code: category.code ?? null,
    name: category.name,
    kind: category.kind,
    parent_id: category.parent_id ?? null,
    dre_group: category.dre_group ?? null,
    position: category.position ?? null,
    active: isTrue(category.active) ? 1 : 0,
  };
}

export const costCenterRow = (costCenter: CostCenter): CostCenterRow => ({ id: costCenter.id, name: costCenter.name, department_id: costCenter.department_id ?? null });

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);
const clean = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

function merged(values: Partial<CategoryRow>, current: FinanceCategory | undefined): CategoryInput {
  const take = <K extends keyof CategoryRow & keyof FinanceCategory>(key: K) => (has(values, key) ? values[key] : current?.[key]);
  return {
    name: clean(take("name")),
    kind: (take("kind") ?? "despesa") as FinanceCategoryKind,
    code: clean(take("code")) || null,
    parentId: clean(take("parent_id")) || null,
    dreGroup: (clean(take("dre_group")) || null) as DreGroup | null,
    position: take("position") == null ? null : Number(take("position")),
    active: has(values, "active") ? isTrue(values.active) : current ? isTrue(current.active) : true,
  };
}

/** Grava as alterações da tabela do plano de contas. */
export async function saveCategoryChanges(db: FinanceDb, ctx: EditContext, changes: EditableTableChanges<CategoryRow>): Promise<string[]> {
  requireTablePermission(ctx.role, "finance", changes);
  const categories = await loadCategories(db, ctx.companyId);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const work: { id?: string; input: CategoryInput }[] = [];
  for (const patch of changes.updated) {
    const current = byId.get(patch.id);
    if (!current) throw rowError(patch.name, "categoria não encontrada.");
    work.push({ id: current.id, input: merged(patch, current) });
  }
  for (const values of changes.created) work.push({ input: merged(values, undefined) });

  // Tipo final de cada categoria (com as mudanças do lote), para conferir o tipo da categoria pai.
  const finalKind = new Map(categories.map((category) => [category.id, category.kind]));
  for (const item of work) if (item.id) finalKind.set(item.id, item.input.kind);
  const codes = new Map<string, string>();
  for (const category of categories) if (category.code) codes.set(category.code.trim().toLowerCase(), category.id);
  for (const item of work) if (item.id) for (const [code, owner] of codes) if (owner === item.id) codes.delete(code);

  for (const item of work) {
    const label = item.input.name || "Linha nova";
    if (!item.input.name) throw rowError(label, "informe o nome da categoria.");
    if (item.input.kind !== "receita" && item.input.kind !== "despesa") throw rowError(label, "tipo inválido: receita ou despesa.");
    if (item.input.parentId) {
      if (item.input.parentId === item.id) throw rowError(label, "a categoria não pode ficar dentro dela mesma.");
      const parentKind = finalKind.get(item.input.parentId);
      if (!parentKind) throw rowError(label, "categoria pai não encontrada.");
      if (parentKind !== item.input.kind) throw rowError(label, "a categoria pai precisa ser do mesmo tipo (receita ou despesa).");
    }
    if (item.input.position != null && !Number.isFinite(item.input.position)) throw rowError(label, "ordem inválida.");
    const code = item.input.code?.toLowerCase();
    if (code) {
      if (codes.has(code)) throw rowError(label, `já existe uma categoria com o código ${item.input.code}.`);
      codes.set(code, item.id ?? label);
    }
  }

  const ids: string[] = [];
  for (const item of work) ids.push(await saveCategory(db, ctx.companyId, item.input, item.id));
  return ids;
}

/** Grava as alterações da tabela de centros de custo. */
export async function saveCostCenterChanges(db: FinanceDb, ctx: EditContext, changes: EditableTableChanges<CostCenterRow>): Promise<string[]> {
  requireTablePermission(ctx.role, "finance", changes);
  const current = await db.select<CostCenter[]>("SELECT * FROM cost_centers WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const work: { id?: string; name: string; departmentId: string | null }[] = [];
  for (const patch of changes.updated) {
    const row = current.find((item) => item.id === patch.id);
    if (!row) throw rowError(patch.name, "centro de custo não encontrado.");
    work.push({ id: row.id, name: clean(has(patch, "name") ? patch.name : row.name), departmentId: (has(patch, "department_id") ? patch.department_id : row.department_id) ?? null });
  }
  for (const values of changes.created) work.push({ name: clean(values.name), departmentId: values.department_id ?? null });
  for (const item of work) if (!item.name) throw rowError("Linha nova", "informe o nome do centro de custo.");
  const ids: string[] = [];
  for (const item of work) ids.push(await saveCostCenter(db, ctx.companyId, { name: item.name, departmentId: item.departmentId }, item.id));
  return ids;
}
