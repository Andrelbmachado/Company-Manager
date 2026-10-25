// Mapeamento das colunas: para cada campo do cadastro, qual coluna do arquivo traz o valor (já vem sugerido).
// Cabeçalho ordena e Filtrar esconde campos só na vista (trocar a coluna não faz a linha pular).
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterButton, useDraftSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { fieldInstructions } from "@/lib/importexport/export";
import type { FieldDef, ImportEntity } from "@/lib/importexport/registry";
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

interface FieldRow {
  key: string;
  field: FieldDef;
  label: string;
  header: string;
  sample: string;
}

const COLUMNS: SortFilterColumn<FieldRow>[] = [
  { key: "label", header: "Campo", kind: "text" },
  { key: "header", header: "Coluna da planilha", kind: "text" },
  { key: "sample", header: "Exemplo da 1ª linha", kind: "text" },
];
const rowKey = (row: FieldRow) => row.key;

export function ColumnMapper({ entity, headers, mapping, sample, onChange }: ColumnMapperProps) {
  const used = new Map<string, string>();
  for (const field of entity.fields) {
    const header = mapping[field.key];
    if (header) used.set(header, field.label);
  }
  const ignored = headers.filter((header) => !used.has(header));
  const mappedCount = entity.fields.filter((field) => mapping[field.key]).length;
  const rows: FieldRow[] = entity.fields.map((field) => {
    const header = mapping[field.key] ?? "";
    return { key: field.key, field, label: field.label, header, sample: header ? sample?.[header] ?? "" : "" };
  });
  const view = useDraftSortFilter(rows, COLUMNS, rowKey);

  return (
    <section aria-labelledby="mapeamento-titulo" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="mapeamento-titulo" className="font-semibold">Colunas do arquivo</h3>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {mappedCount} de {entity.fields.length} campos com coluna · <span aria-hidden="true">*</span> obrigatório
          </p>
          <TableFilterButton view={view} />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <TableFilterBar view={view} />
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <SortableHeader label="Campo" sortKey="label" sort={view.sort} onSort={view.toggleSort} className="px-3 py-2" />
              <SortableHeader label="Coluna da planilha" sortKey="header" sort={view.sort} onSort={view.toggleSort} className="w-[40%] px-3 py-2" />
              <SortableHeader label="Exemplo da 1ª linha" sortKey="sample" sort={view.sort} onSort={view.toggleSort} className="hidden px-3 py-2 md:table-cell" />
            </tr>
          </thead>
          <tbody>
            {view.rows.map(({ field, header }) => {
              const id = `coluna-${entity.key}-${field.key}`;
              const missing = field.required && !header;
              return (
                <tr key={field.key} className={cn("border-t", missing && "bg-status-danger/10")}>
                  <td className="px-3 py-2 align-top">
                    <label htmlFor={id} className="font-medium" title={fieldInstructions(field)}>
                      {field.label}
                      {field.required && <span className="text-status-danger dark:text-red-400" aria-label="obrigatório"> *</span>}
                    </label>
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
                    {missing && <p className="mt-1 text-xs text-status-danger dark:text-red-400">Obrigatório</p>}
                  </td>
                  <td className="hidden max-w-[16rem] truncate px-3 py-2 align-top text-muted-foreground md:table-cell" title={header ? sample?.[header] : undefined}>
                    {header ? sample?.[header] || "(vazio)" : "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length > 0 && !view.rows.length && <NoFilterMatchRow colSpan={3} />}
          </tbody>
        </table>
      </div>
      {ignored.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Não importadas: {ignored.join(", ")}
        </p>
      )}
    </section>
  );
}

export default ColumnMapper;
