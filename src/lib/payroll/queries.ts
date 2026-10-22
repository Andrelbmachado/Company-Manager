import { getDb } from "@/lib/db/client";
import type { Employee, EmployeeCompensation } from "@/types";

/** Remuneração dos colaboradores. Só chamar de telas protegidas pelo recurso `payroll` (CEO e Administração). */
export async function fetchCompensation(companyId: string): Promise<EmployeeCompensation[]> {
  return (await getDb()).select<EmployeeCompensation[]>("SELECT * FROM employee_compensation WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

/** Folha mensal: salários base de quem não está desligado. Uma única regra para a tela de Folha e para o Dashboard. */
export function monthlyPayroll(employees: Pick<Employee, "id" | "status">[], compensation: Pick<EmployeeCompensation, "employee_id" | "base_salary">[]): number {
  const active = new Set(employees.filter((employee) => employee.status !== "desligado").map((employee) => employee.id));
  return compensation.filter((entry) => active.has(entry.employee_id)).reduce((sum, entry) => sum + (entry.base_salary > 0 ? entry.base_salary : 0), 0);
}
