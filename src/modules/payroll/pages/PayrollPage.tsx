import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { Lock, Pencil } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency, formatDay } from "@/lib/utils";
import { formatMoney } from "@/lib/prospecting/contact";
import { fetchEmployees } from "@/lib/hr/queries";
import { fetchCompensation } from "@/lib/payroll/queries";
import type { Employee } from "@/types";

/** Folha de pagamento: remuneração é questão administrativo-financeira, visível só para CEO e Administração. */
export default function PayrollPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const canEdit = usePermission("edit", "payroll");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ base_salary: "", effective_from: "", notes: "" });

  const { data: employees = [] } = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const { data: compensation = [] } = useQuery({ queryKey: ["payroll", companyId], queryFn: () => fetchCompensation(companyId) });

  const byEmployee = useMemo(() => new Map(compensation.map((entry) => [entry.employee_id, entry])), [compensation]);
  const active = employees.filter((employee) => employee.status !== "desligado");
  const withSalary = active.filter((employee) => (byEmployee.get(employee.id)?.base_salary ?? 0) > 0);
  const monthly = withSalary.reduce((sum, employee) => sum + (byEmployee.get(employee.id)?.base_salary ?? 0), 0);
  const term = search.trim().toLowerCase();
  const rows = active.filter((employee) => !term || [employee.name, employee.department, employee.position].some((field) => (field ?? "").toLowerCase().includes(term)));

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const db = await getDb();
      const salary = Number(form.base_salary.replace(",", "."));
      if (!Number.isFinite(salary) || salary < 0) throw new Error("Informe um salário válido (zero ou maior).");
      const existing = byEmployee.get(editing.id);
      if (existing) {
        await db.execute("UPDATE employee_compensation SET base_salary=?, effective_from=?, notes=?, updated_by=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [salary, form.effective_from || null, form.notes.trim() || null, session.user.id, existing.id, companyId]);
      } else {
        await db.execute("INSERT INTO employee_compensation (id, company_id, employee_id, base_salary, effective_from, notes, updated_by) VALUES (?,?,?,?,?,?,?)", [uuidv4(), companyId, editing.id, salary, form.effective_from || null, form.notes.trim() || null, session.user.id]);
      }
      // O valor não vai para o histórico de atividades: o log é visível a outros papéis.
      await emit({ type: "payroll.salary_updated", companyId, actorId: session.user.id, entityType: "employee", entityId: editing.id, title: `Remuneração atualizada: ${editing.name}`, module: "payroll" });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["payroll"] }); setEditing(null); setError(""); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });

  function openEdit(employee: Employee) {
    const entry = byEmployee.get(employee.id);
    setForm({ base_salary: entry ? String(entry.base_salary) : "", effective_from: entry?.effective_from?.slice(0, 10) ?? "", notes: entry?.notes ?? "" });
    setError("");
    setEditing(employee);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Folha de pagamento" description="Remuneração dos colaboradores. Só a diretoria e a administração veem esta tela: o RH e o Financeiro não têm acesso." />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Folha mensal (salários base)" value={formatMoney(monthly)} hint={`${withSalary.length} colaboradores com salário cadastrado`} />
        <StatCard title="Colaboradores na folha" value={`${withSalary.length}/${active.length}`} hint="com salário cadastrado / ativos" />
        <StatCard title="Sem salário cadastrado" value={active.length - withSalary.length} hint={active.length - withSalary.length ? "Cadastre para entrar na soma da folha" : "Todos cadastrados"} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, setor ou cargo..." />

      {rows.length === 0 ? <EmptyState icon={Lock} title="Nenhum colaborador encontrado" description="Cadastre os colaboradores em Gestão de RH." /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>{["Colaborador", "Setor", "Cargo", "Salário base (mensal)", "Vigente desde", ""].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((employee) => {
                const entry = byEmployee.get(employee.id);
                return (
                  <tr key={employee.id}>
                    <td className="px-4 py-3 font-medium">{employee.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{employee.department ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{employee.position ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{entry && entry.base_salary > 0 ? formatCurrency(entry.base_salary) : <StatusBadge status="pendente" />}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(entry?.effective_from)}</td>
                    <td className="px-4 py-3 text-right">{canEdit && <button onClick={() => openEdit(employee)} aria-label={`Editar remuneração de ${employee.name}`} className="rounded-md border p-1.5 hover:bg-muted"><Pencil size={14} /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CrudDialog
          title={`Remuneração de ${editing.name}`}
          fields={[
            { key: "base_salary", label: "Salário base mensal (R$)", type: "number", required: true },
            { key: "effective_from", label: "Vigente desde", type: "date" },
            { key: "notes", label: "Observações", type: "textarea" },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setEditing(null)}
          onSubmit={() => save.mutate()}
          busy={save.isPending}
        >
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}
    </div>
  );
}
