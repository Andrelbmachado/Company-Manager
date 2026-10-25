// Formulário na própria página (Tarefa 6 do redesign: nada de diálogo para editar). Mesmos tipos de campo do antigo
// formulário em diálogo, dentro de um <form> com título, Salvar e Cancelar; quem chama decide onde ele aparece (no lugar
// do bloco Cadastro da ficha, no painel de detalhes, no topo do funil).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BTN_PRIMARY, BTN_SECONDARY } from "./ui";

export interface InlineField {
  key: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

const CONTROL = "flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring";

interface InlineFormProps {
  /** Título visível e nome acessível do formulário. */
  title: string;
  fields: InlineField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy?: boolean;
  submitLabel?: string;
  /** Ajuda ou erro entre os campos e os botões. */
  children?: ReactNode;
  className?: string;
}

export function InlineForm({ title, fields, values, onChange, onSubmit, onCancel, busy, submitLabel = "Salvar", children, className }: InlineFormProps) {
  const missing = fields.some((field) => field.required && !values[field.key]?.trim());
  return (
    <form
      aria-label={title}
      className={cn("space-y-4 rounded-xl border bg-card p-5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !missing) onSubmit();
      }}
    >
      <h2 className="font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key} className={cn("space-y-1.5 text-sm font-medium", field.type === "textarea" && "sm:col-span-2 lg:col-span-3")}>
            {field.label}
            {field.type === "select" ? (
              <select value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} className={CONTROL}>
                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.type === "textarea" ? (
              <textarea value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} rows={3} placeholder={field.placeholder} className={cn(CONTROL, "h-auto resize-y py-2")} />
            ) : (
              <input type={field.type ?? "text"} value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} placeholder={field.placeholder} required={field.required} className={CONTROL} />
            )}
          </label>
        ))}
      </div>
      {children}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancelar</button>
        <button type="submit" disabled={busy || missing} className={BTN_PRIMARY}>{submitLabel}</button>
      </div>
    </form>
  );
}
