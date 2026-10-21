import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { useCreateEntity, useRefOptions } from "@/hooks/useEntity";
import { getEntity, newLabel, writableFields, type EntityKey, type FieldDef } from "@/lib/data/entities";
import { coerceField } from "@/lib/data/values";
import type { Row } from "@/lib/data/repository";
import { cn } from "@/lib/utils";

interface EntityFormDialogProps {
  entity: EntityKey;
  open: boolean;
  onClose: () => void;
  /** Pre-filled values (raw strings or ids). */
  initial?: Record<string, string>;
  onCreated?: (row: Row) => void;
}

/** Creation form generated from the entity registry. */
export function EntityFormDialog({ entity, open, onClose, initial, onCreated }: EntityFormDialogProps) {
  const def = getEntity(entity);
  const fields = writableFields(def);
  const create = useCreateEntity(entity);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setValues({
      ...Object.fromEntries(fields.map((f) => [f.key, f.defaultValue !== undefined ? String(f.defaultValue) : ""])),
      ...initial,
    });
    setErrors({});
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const row: Row = {};
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === "ref") {
        if (values[f.key]) row[f.key] = values[f.key];
        else if (f.required) errs[f.key] = `${f.label} é obrigatório`;
        continue;
      }
      const res = coerceField(f, values[f.key]);
      if (res.error) errs[f.key] = res.error;
      else if (res.value !== null) row[f.key] = res.value;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const [created] = await create.mutateAsync([row]);
    onCreated?.(created);
    onClose();
  }

  const formId = `form-${entity}`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={newLabel(def)}
      testId={`create-dialog-${entity}`}
      className="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" form={formId} variant="primary" disabled={create.isPending} data-testid="create-submit">
            {create.isPending && <Loader2 size={14} className="animate-spin" />}
            Salvar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        {fields.map((f) => (
          <Field
            key={f.key}
            id={`${formId}-${f.key}`}
            label={f.label}
            required={f.required}
            error={errors[f.key]}
            className={cn((f.type === "longtext" || f.key === def.titleField) && "sm:col-span-2")}
          >
            <FieldInput
              id={`${formId}-${f.key}`}
              field={f}
              value={values[f.key] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            />
          </Field>
        ))}
        {create.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
            {String(create.error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function FieldInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const common = { id, name: field.key, "data-field": field.key, className: inputClass };
  switch (field.type) {
    case "enum":
      return (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          {!field.defaultValue && <option value="">—</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case "ref":
      return <RefSelect {...common} field={field} value={value} onChange={onChange} />;
    case "longtext":
      return (
        <textarea
          {...common}
          rows={3}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputClass, "h-auto resize-none py-2")}
        />
      );
    case "date":
    case "datetime":
      return (
        <input
          {...common}
          type={field.type === "date" ? "date" : "datetime-local"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          {...common}
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          inputMode={["number", "integer", "currency"].includes(field.type) ? "decimal" : undefined}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function RefSelect({
  field,
  value,
  onChange,
  ...rest
}: {
  id: string;
  name: string;
  className: string;
  "data-field": string;
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: options = [] } = useRefOptions(field.ref?.entity);
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={String(o.id)} value={String(o.id)}>
          {String(o[field.ref!.display] ?? o.id)}
        </option>
      ))}
    </select>
  );
}
