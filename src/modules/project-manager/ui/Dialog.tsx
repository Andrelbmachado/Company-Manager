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
}

const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** Modal de formulário: superfície opaca (card), borda e fundo escurecido. */
export function FormDialog({ title, description, fields, values, onChange, onClose, onSubmit, busy, submitLabel = "Salvar" }: FormDialogProps) {
  const invalid = fields.some((field) => field.required && !values[field.key]?.trim());
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => { event.preventDefault(); if (!invalid && !busy) onSubmit(); }}
        >
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
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={busy || invalid} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
