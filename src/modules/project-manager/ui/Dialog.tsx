import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Ocupa a linha inteira. */
  wide?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Casca de modal acessível: foco entra no diálogo, Tab fica preso nele, Esc fecha e o foco volta para
 * quem abriu. Superfície opaca (card) sobre fundo escurecido.
 */
function ModalShell({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea");
    (first ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
    // onClose é recriado a cada render do pai; o foco inicial deve rodar só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface FormDialogProps {
  title: string;
  fields: FieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  submitLabel?: string;
  /** Texto de apoio abaixo do título. */
  description?: string;
  /** Erro ao salvar: aparece dentro do diálogo, onde a pessoa está olhando. */
  error?: string;
}

/** Modal de formulário. */
export function FormDialog({ title, description, fields, values, onChange, onClose, onSubmit, busy, submitLabel = "Salvar", error }: FormDialogProps) {
  const invalid = fields.some((field) => field.required && !values[field.key]?.trim());
  return (
    <ModalShell title={title} description={description} onClose={onClose}>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!invalid && !busy) onSubmit(); }}>
        {fields.map((field) => (
          <label key={field.key} className={`space-y-1.5 text-sm font-medium ${field.type === "textarea" || field.wide ? "sm:col-span-2" : ""}`}>
            {field.label}
            {field.type === "select" ? (
              <select value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} className={inputClass}>
                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.type === "textarea" ? (
              <textarea value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} rows={3} placeholder={field.placeholder} className={`${inputClass} h-auto resize-none py-2`} />
            ) : (
              <input type={field.type ?? "text"} value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} placeholder={field.placeholder} required={field.required} className={inputClass} />
            )}
          </label>
        ))}
        {error && <p role="alert" className="text-sm font-medium text-status-danger dark:text-red-400 sm:col-span-2">{error}</p>}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={busy || invalid} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{submitLabel}</button>
        </div>
      </form>
    </ModalShell>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}

/** Confirmação de ação destrutiva (remover etapa ou tarefa). O botão destrutivo é vermelho sólido. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose, busy }: ConfirmDialogProps) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="mt-4 text-sm text-muted-foreground">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Cancelar</button>
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-md bg-status-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{confirmLabel}</button>
      </div>
    </ModalShell>
  );
}
