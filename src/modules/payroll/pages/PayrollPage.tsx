// Folha de pagamento: remuneração é questão administrativo-financeira, visível só para CEO e Administração. Salário,
// vigência e observações se editam na própria tabela (sem modal); a permissão também é conferida na gravação.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useLabel } from "@/lib/labels/useLabel";
import { formatMoney } from "@/lib/prospecting/contact";
import { formatCurrency } from "@/lib/utils";
import { fetchEmployees } from "@/lib/hr/queries";
import { fetchCompensation, monthlyPayroll } from "@/lib/payroll/queries";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useEditContext } from "@/modules/finance/data/useEditContext";
import { compensationRow, saveCompensationChanges, type CompensationRow } from "../data/compensationEditing";

export default function PayrollPage() {
  const ctx = useEditContext();
  const qc = useQueryClient();
  const companyId = ctx.companyId;
  const title = useLabel("module.payroll");
  const [search, setSearch] = useState("");

  const employeesQuery = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const compensationQuery = useQuery({ queryKey: ["payroll", companyId], queryFn: () => fetchCompensation(companyId) });
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const compensation = useMemo(() => compensationQuery.data ?? [], [compensationQuery.data]);

  const byEmployee = useMemo(() => new Map(compensation.map((entry) => [entry.employee_id, entry])), [compensation]);
  const active = employees.filter((employee) => employee.status !== "desligado");
  const withSalary = active.filter((employee) => (byEmployee.get(employee.id)?.base_salary ?? 0) > 0);
  const monthly = monthlyPayroll(employees, compensation);
  const term = search.trim().toLowerCase();
  const rows = active
    .filter((employee) => !term || [employee.name, employee.department, employee.position].some((field) => (field ?? "").toLowerCase().includes(term)))
    .map((employee) => compensationRow(employee, byEmployee.get(employee.id)));

  const columns = useMemo<EditableColumn<CompensationRow>[]>(() => {
    const names = new Map(employees.map((employee) => [employee.id, employee.name]));
    return [
      {
        key: "employee_id",
        header: "Colaborador",
        kind: "select",
        required: true,
        width: 220,
        options: active.map((employee) => ({ value: employee.id, label: employee.name })),
        render: (row) => <span className="font-medium">{names.get(row.employee_id) ?? "—"}</span>,
      },
      { key: "department", header: "Setor", kind: "text", readOnly: true },
      { key: "position", header: "Cargo", kind: "text", readOnly: true },
      { key: "base_salary", header: "Salário base (mensal)", kind: "money", render: (row) => (row.base_salary && row.base_salary > 0 ? formatCurrency(row.base_salary) : <StatusBadge status="pendente" />) },
      { key: "effective_from", header: "Vigente desde", kind: "date" },
      { key: "notes", header: "Observações", kind: "text", width: 220 },
    ];
  }, [employees, active]);

  async function save(changes: EditableTableChanges<CompensationRow>) {
    await saveCompensationChanges(await getDb(), ctx, changes);
    void qc.invalidateQueries({ queryKey: ["payroll"] });
    void qc.invalidateQueries({ queryKey: ["hr", "dashboard"] });
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Folha mensal (salários base)" value={formatMoney(monthly)} />
        <StatCard title="Colaboradores na folha" value={`${withSalary.length}/${active.length}`} />
        <StatCard title="Sem salário cadastrado" value={active.length - withSalary.length} />
      </div>

      <EditableTable<CompensationRow>
        actions={
          <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, setor ou cargo..." />
        }
        resource="payroll"
        label="Remuneração dos colaboradores"
        rows={rows}
        columns={columns}
        loading={employeesQuery.isLoading || compensationQuery.isLoading}
        onSave={save}
        onRefresh={() => Promise.all([qc.invalidateQueries({ queryKey: ["hr", "employees", companyId] }), qc.invalidateQueries({ queryKey: ["payroll", companyId] })])}
        emptyMessage={term ? "Nenhum colaborador encontrado" : "Nenhum colaborador"}
      />
    </div>
  );
}
