// Diálogo de registro de desligamento (data, motivo e observação). Data futura agenda; hoje ou passada efetiva.
import { useState } from "react";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { TERMINATION_REASONS } from "@/lib/hr/employment";
import { formatDay } from "@/lib/utils";
import { DialogError } from "./hrUi";

export interface TerminationDraft {
  employeeId: string;
  date: string;
  reason: string;
  notes: string;
}

interface TerminationDialogProps {
  today: string;
  /** Com lista: escolhe quem sai. Sem lista: desliga `employee`. */
  employees?: { id: string; name: string }[];
  employee?: { id: string; name: string };
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (draft: TerminationDraft) => void;
}

export function TerminationDialog({ today, employees, employee, busy, error, onClose, onSubmit }: TerminationDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({ employee_id: employee?.id ?? employees?.[0]?.id ?? "", date: today, reason: TERMINATION_REASONS[0], notes: "" });
  const fields: CrudField[] = [
    ...(employees ? [{ key: "employee_id", label: "Colaborador", type: "select" as const, options: employees.map((item) => ({ value: item.id, label: item.name })) }] : []),
    { key: "date", label: "Data de saída", type: "date", required: true },
    { key: "reason", label: "Motivo", type: "select", options: TERMINATION_REASONS.map((reason) => ({ value: reason, label: reason })) },
    { key: "notes", label: "Observação (opcional)", type: "textarea", placeholder: "Ex.: aviso prévio trabalhado, devolução do notebook combinada" },
  ];
  const future = values.date > today;
  return (
    <CrudDialog
      title={employee ? `Registrar desligamento de ${employee.name}` : "Registrar desligamento"}
      fields={fields}
      values={values}
      onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
      onClose={onClose}
      onSubmit={() => onSubmit({ employeeId: values.employee_id, date: values.date, reason: values.reason, notes: values.notes })}
      busy={busy || !values.employee_id}
      submitLabel={future ? "Agendar desligamento" : "Registrar desligamento"}
    >
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {values.date
          ? future
            ? `Fica agendado: a pessoa continua ativa até ${formatDay(values.date)} e passa a desligada nessa data. O checklist de saída começa agora.`
            : "A pessoa passa a desligada agora e o checklist de saída é criado."
          : "Informe a data de saída."}
      </p>
      <DialogError message={error ?? ""} />
    </CrudDialog>
  );
}
