// Registro de desligamento no próprio lugar (sem janela por cima): data, motivo e observação. Data futura agenda;
// hoje ou passada efetiva. Com `employees`, escolhe quem sai; com `employee`, desliga essa pessoa.
import { useState, type FormEvent } from "react";
import { UserMinus } from "lucide-react";
import { TERMINATION_REASONS } from "@/lib/hr/employment";
import { formatDay } from "@/lib/utils";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT } from "./hrUi";

export interface TerminationDraft {
  employeeId: string;
  date: string;
  reason: string;
  notes: string;
}

interface TerminationFormProps {
  today: string;
  employees?: { id: string; name: string }[];
  employee?: { id: string; name: string };
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (draft: TerminationDraft) => void;
}

export function TerminationForm({ today, employees, employee, busy, error, onCancel, onSubmit }: TerminationFormProps) {
  const [employeeId, setEmployeeId] = useState(employee?.id ?? employees?.[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState<string>(TERMINATION_REASONS[0]);
  const [notes, setNotes] = useState("");
  const future = date > today;
  const title = employee ? `Registrar desligamento de ${employee.name}` : "Registrar desligamento";

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ employeeId, date, reason, notes });
  }

  return (
    <form onSubmit={submit} aria-label={title} data-termination-form className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 font-bold"><UserMinus size={16} aria-hidden="true" /> {title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {employees && (
          <label className="space-y-1.5 text-sm font-medium">
            <span>Colaborador</span>
            <select className={INPUT} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              {employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1.5 text-sm font-medium">
          <span>Data de saída</span>
          <input type="date" className={INPUT} value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>Motivo</span>
          <select className={INPUT} value={reason} onChange={(event) => setReason(event.target.value)}>
            {TERMINATION_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2 lg:col-span-4">
          <span>Observação (opcional)</span>
          <textarea rows={2} className="flex w-full resize-y rounded-md border bg-background px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" placeholder="Ex.: aviso prévio trabalhado, devolução do notebook combinada" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {date
          ? future
            ? `Fica agendado: a pessoa continua ativa até ${formatDay(date)} e passa a desligada nessa data. O checklist de saída começa agora.`
            : "A pessoa passa a desligada agora e o checklist de saída é criado."
          : "Informe a data de saída."}
      </p>
      {error && <p role="alert" className="text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancelar</button>
        <button type="submit" disabled={busy || !employeeId} className={BTN_PRIMARY}>{future ? "Agendar desligamento" : "Confirmar desligamento"}</button>
      </div>
    </form>
  );
}
