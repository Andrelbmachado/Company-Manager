// Remuneração editada na própria tabela da Folha: permissão "payroll" (só CEO e Administração) conferida na camada
// de dados, uma remuneração por colaborador (grava ou atualiza) e evento sem o valor (o histórico é visível a outros
// papéis).
import { v4 as uuidv4 } from "uuid";
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import type { DatabaseLike } from "@/lib/db/demo";
import { emit } from "@/lib/events/bus";
import { roundMoney } from "@/lib/money";
import type { Employee, EmployeeCompensation } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "@/modules/finance/data/guard";

export interface CompensationRow {
  /** Id do colaborador (uma linha por colaborador). */
  id: string;
  employee_id: string;
  department: string | null;
  position: string | null;
  base_salary: number | null;
  effective_from: string | null;
  notes: string | null;
}

export function compensationRow(employee: Employee, entry: EmployeeCompensation | undefined): CompensationRow {
  return {
    id: employee.id,
    employee_id: employee.id,
    department: employee.department ?? null,
    position: employee.position ?? null,
    base_salary: entry ? Number(entry.base_salary) : null,
    effective_from: entry?.effective_from ? entry.effective_from.slice(0, 10) : null,
    notes: entry?.notes ?? null,
  };
}

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);
const clean = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** Grava as alterações da tabela da folha (todas as linhas conferidas antes da primeira gravação). */
export async function saveCompensationChanges(db: DatabaseLike, ctx: EditContext, changes: EditableTableChanges<CompensationRow>): Promise<number> {
  requireTablePermission(ctx.role, "payroll", changes);
  const employees = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const entries = await db.select<EmployeeCompensation[]>("SELECT * FROM employee_compensation WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const byEmployee = new Map(entries.map((entry) => [entry.employee_id, entry]));
  const nameOf = (id: string) => employees.find((employee) => employee.id === id)?.name ?? "Colaborador";
  const work = new Map<string, { salary: number; effectiveFrom: string | null; notes: string | null }>();

  const plan = (employeeId: string, values: Partial<CompensationRow>, label: string) => {
    if (!employees.some((employee) => employee.id === employeeId)) throw rowError(label, "colaborador não encontrado.");
    if (work.has(employeeId)) throw rowError(label, "colaborador repetido: uma remuneração por colaborador.");
    const current = byEmployee.get(employeeId);
    const salary = has(values, "base_salary") ? values.base_salary : current?.base_salary;
    if (salary === null || salary === undefined || !Number.isFinite(Number(salary)) || Number(salary) < 0) throw rowError(label, "informe um salário válido (zero ou maior).");
    work.set(employeeId, {
      salary: roundMoney(Number(salary)),
      effectiveFrom: (has(values, "effective_from") ? values.effective_from : current?.effective_from) ?? null,
      notes: clean(has(values, "notes") ? values.notes : current?.notes) || null,
    });
  };

  for (const patch of changes.updated) {
    const label = nameOf(patch.id);
    if (has(patch, "employee_id") && patch.employee_id !== patch.id) throw rowError(label, "o colaborador da linha não muda. Para outro colaborador, use Adicionar.");
    plan(patch.id, patch, label);
  }
  for (const values of changes.created) {
    const employeeId = clean(values.employee_id);
    if (!employeeId) throw rowError("Linha nova", "escolha o colaborador.");
    plan(employeeId, values, nameOf(employeeId));
  }

  for (const [employeeId, item] of work) {
    const existing = byEmployee.get(employeeId);
    if (existing) {
      await db.execute("UPDATE employee_compensation SET base_salary=?, effective_from=?, notes=?, updated_by=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [item.salary, item.effectiveFrom, item.notes, ctx.userId, existing.id, ctx.companyId]);
    } else {
      await db.execute("INSERT INTO employee_compensation (id, company_id, employee_id, base_salary, effective_from, notes, updated_by) VALUES (?,?,?,?,?,?,?)", [uuidv4(), ctx.companyId, employeeId, item.salary, item.effectiveFrom, item.notes, ctx.userId]);
    }
    // O valor não vai para o histórico de atividades: o log é visível a outros papéis.
    await emit({ type: "payroll.salary_updated", companyId: ctx.companyId, actorId: ctx.userId, entityType: "employee", entityId: employeeId, title: `Remuneração atualizada: ${nameOf(employeeId)}`, module: "payroll" });
  }
  return work.size;
}
