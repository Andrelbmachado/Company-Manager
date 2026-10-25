// Mapeamento das colunas: para cada campo do cadastro, qual coluna do arquivo traz o valor (já vem sugerido).
import { fieldInstructions } from "@/lib/importexport/export";
import type { ImportEntity } from "@/lib/importexport/registry";
import type { ColumnMapping } from "@/lib/importexport/runImport";
import { cn } from "@/lib/utils";

interface ColumnMapperProps {
  entity: ImportEntity<unknown>;
  headers: string[];
  mapping: ColumnMapping;
  /** Primeira linha de dados, para mostrar um exemplo do que vem em cada coluna. */
  sample?: Record<string, string>;
  onChange: (fieldKey: string, header: string | null) => void;
}

const SELECT = "h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export function ColumnMapper({ entity, headers, mapping, sample, onChange }: ColumnMapperProps) {
  const used = new Map<string, string>();
  for (const field of entity.fields) {
    const header = mapping[field.key];
    if (header) used.set(header, field.label);
  }
  const ignored = headers.filter((header) => !used.has(header));
  const mappedCount = entity.fields.filter((field) => mapping[field.key]).length;

  return (
    <section aria-labelledby="mapeamento-titulo" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="mapeamento-titulo" className="font-semibold">Colunas do arquivo</h3>
        <p className="text-xs text-muted-foreground">
          {mappedCount} de {entity.fields.length} campos com coluna · <span aria-hidden="true">*</span> obrigatório
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Campo</th>
              <th scope="col" className="w-[40%] px-3 py-2 font-medium">Coluna da planilha</th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Exemplo da 1ª linha</th>
            </tr>
          </thead>
          <tbody>
            {entity.fields.map((field) => {
              const id = `coluna-${entity.key}-${field.key}`;
              const header = mapping[field.key] ?? "";
              const missing = field.required && !header;
              return (
                <tr key={field.key} className={cn("border-t", missing && "bg-status-danger/10")}>
                  <td className="px-3 py-2 align-top">
                    <label htmlFor={id} className="font-medium">
                      {field.label}
                      {field.required && <span className="text-status-danger dark:text-red-400" aria-label="obrigatório"> *</span>}
                    </label>
                    <p className="mt-0.5 text-xs text-muted-foreground">{fieldInstructions(field)}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      id={id}
                      value={header}
                      onChange={(event) => onChange(field.key, event.target.value || null)}
                      aria-invalid={missing || undefined}
                      className={cn(SELECT, missing && "border-status-danger")}
                    >
                      <option value="">— não importar —</option>
                      {headers.map((option) => (
                        <option key={option} value={option}>
                          {option}
                          {used.has(option) && used.get(option) !== field.label ? ` (já usada em ${used.get(option)})` : ""}
                        </option>
                      ))}
                    </select>
                    {missing && <p className="mt-1 text-xs text-status-danger dark:text-red-400">Escolha a coluna deste campo obrigatório.</p>}
                  </td>
                  <td className="hidden max-w-[16rem] truncate px-3 py-2 align-top text-muted-foreground md:table-cell" title={header ? sample?.[header] : undefined}>
                    {header ? sample?.[header] || "(vazio)" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ignored.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Colunas do arquivo que não serão importadas: {ignored.join(", ")}.
        </p>
      )}
    </section>
  );
}

export default ColumnMapper;
