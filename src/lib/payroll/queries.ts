import { getDb } from "@/lib/db/client";
import type { EmployeeCompensation } from "@/types";

/** Remuneração dos colaboradores. Só chamar de telas protegidas pelo recurso `payroll` (CEO e Administração). */
export async function fetchCompensation(companyId: string): Promise<EmployeeCompensation[]> {
  return (await getDb()).select<EmployeeCompensation[]>("SELECT * FROM employee_compensation WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}
