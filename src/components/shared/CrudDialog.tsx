import { X } from "lucide-react";

export interface CrudField {
  key: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface CrudDialogProps {
  title: string;
  fields: CrudField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  submitLabel?: string;
}

export function CrudDialog({ title, fields, values, onChange, onClose, onSubmit, busy, submitLabel = "Salvar" }: CrudDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className={`space-y-1.5 text-sm font-medium ${field.type === "textarea" ? "sm:col-span-2" : ""}`}>
              {field.label}
              {field.type === "select" ? (
                <select value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring">
                  {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : field.type === "textarea" ? (
                <textarea value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} rows={4} placeholder={field.placeholder} className="flex w-full resize-none rounded-md border bg-background px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" />
              ) : (
                <input type={field.type ?? "text"} value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} placeholder={field.placeholder} required={field.required} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" />
              )}
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">Cancelar</button>
          <button onClick={onSubmit} disabled={busy || fields.some((field) => field.required && !values[field.key]?.trim())} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
