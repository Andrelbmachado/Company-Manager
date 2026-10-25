// Diálogo de lançamento no banco de horas: hora extra (crédito) ou compensação (débito), com a duração digitada
// do jeito que a pessoa fala ("1:30", "2h", "45min", "1,5"). O sinal vem do tipo, não do texto.
import { useState } from "react";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { formatMinutes, parseDuration } from "@/lib/hr/timebank";
import { DialogError } from "./hrUi";

export interface TimeEntryDraft {
  employeeId: string;
  date: string;
  minutes: number | null;
  reason: string;
}

interface TimeEntryDialogProps {
  title: string;
  today: string;
  /** Com lista: escolhe o colaborador. Sem lista: lança para `employeeId`. */
  employees?: { id: string; name: string }[];
  employeeId?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  /** Texto de ajuda abaixo dos campos (ex.: "O RH vai aprovar"). */
  help?: string;
  onClose: () => void;
  onSubmit: (draft: TimeEntryDraft) => void;
}

const KINDS = [
  { value: "credito", label: "Hora extra (crédito)" },
  { value: "debito", label: "Compensação / folga (débito)" },
];

/** Minutos do lançamento a partir do tipo e do texto (texto sempre lido sem sinal). */
export function draftMinutes(kind: string, duration: string): number | null {
  const parsed = parseDuration(duration);
  if (parsed === null) return null;
  return (kind === "debito" ? -1 : 1) * Math.abs(parsed);
}

export function TimeEntryDialog({ title, today, employees, employeeId, submitLabel = "Lançar", busy, error, help, onClose, onSubmit }: TimeEntryDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({ employee_id: employees?.[0]?.id ?? employeeId ?? "", kind: "credito", date: today, duration: "", reason: "" });
  const minutes = draftMinutes(values.kind, values.duration);
  const fields: CrudField[] = [
    ...(employees ? [{ key: "employee_id", label: "Colaborador", type: "select" as const, options: employees.map((employee) => ({ value: employee.id, label: employee.name })) }] : []),
    { key: "kind", label: "Tipo", type: "select", options: KINDS },
    { key: "date", label: "Data", type: "date", required: true },
    { key: "duration", label: "Duração", placeholder: "1:30, 2h, 45min", required: true },
    { key: "reason", label: "Motivo", type: "textarea", required: true, placeholder: "Ex.: fechamento do mês, entrega para cliente, folga combinada" },
  ];

  return (
    <CrudDialog
      title={title}
      fields={fields}
      values={values}
      onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
      onClose={onClose}
      onSubmit={() => onSubmit({ employeeId: values.employee_id, date: values.date, minutes, reason: values.reason })}
      busy={busy || !values.employee_id}
      submitLabel={submitLabel}
    >
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {values.duration.trim()
          ? minutes === null ? "Duração não reconhecida. Use 1:30, 2h, 2h15, 45min ou 1,5." : `Vai lançar ${formatMinutes(minutes)} no banco de horas.`
          : "Hora extra só até hoje; compensação pode ser combinada para os próximos dias."}
        {help ? ` ${help}` : ""}
      </p>
      <DialogError message={error ?? ""} />
    </CrudDialog>
  );
}
