// Assistente de importação: cadastro → arquivo (CSV/XLSX, arrastar ou escolher) → aba → colunas (sugeridas) →
// prévia das 20 primeiras linhas com os erros marcados → simular ou importar → resultado com relatório de erros.
// Usado na tela Importar dados e no botão "Importar" das listas (cadastro fixo).
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, FileUp, FlaskConical, Loader2, Upload } from "lucide-react";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterButton, useSortFilter, type SortFilterColumn, type SortKind } from "@/components/shared/table";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { errorMessage, errorsToCsv, type ImportRowError } from "@/lib/importexport/errors";
import { exportFilename, templateFor, type ExportFormat } from "@/lib/importexport/export";
import { parseFile, type ParsedFile } from "@/lib/importexport/parse";
import type { FieldKind, ImportEntity } from "@/lib/importexport/registry";
import { missingRequired, runImport, suggestMapping, validateRows, type ColumnMapping, type ImportProgress, type ImportResult } from "@/lib/importexport/runImport";
import { saveBlob } from "@/lib/importexport/saveFile";
import { cn } from "@/lib/utils";
import type { ImportMode } from "@/types";
import { ColumnMapper } from "./ColumnMapper";
import { ResultReport } from "./ResultReport";

const PREVIEW_ROWS = 20;
const BUTTON = "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const ACCEPT = ".csv,.txt,.tsv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const PHASES: Record<ImportProgress["phase"], string> = {
  validando: "Conferindo os valores",
  conferindo: "Conferindo com os cadastros",
  gravando: "Gravando",
};

const MODES: { value: ImportMode; label: string; description: string }[] = [
  { value: "skip-errors", label: "Importar as linhas certas", description: "As linhas com erro ficam de fora e aparecem no relatório." },
  { value: "all-or-nothing", label: "Tudo ou nada", description: "Se alguma linha tiver erro, nada é gravado." },
];

export interface ImportWizardProps {
  /** Cadastros que a pessoa pode importar (já filtrados pela permissão). */
  entities: ImportEntity<unknown>[];
  initialEntity?: string | null;
  /** Cadastro fixo (botão Importar de uma lista): não mostra a escolha do cadastro. */
  lockEntity?: boolean;
  /** Depois de uma importação que gravou linhas. */
  onImported?: (result: ImportResult) => void;
  /** Mostra "Fechar" no resultado (assistente dentro de uma janela). */
  onClose?: () => void;
}

interface LoadedFile {
  name: string;
  parsed: ParsedFile;
}

export function ImportWizard({ entities, initialEntity, lockEntity, onImported, onClose }: ImportWizardProps) {
  const session = useRequiredSession();
  const queryClient = useQueryClient();
  const [entityKey, setEntityKey] = useState<string | null>(() => (initialEntity && entities.some((entity) => entity.key === initialEntity) ? initialEntity : entities.length === 1 ? entities[0].key : null));
  const entity = entities.find((candidate) => candidate.key === entityKey) ?? null;
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mode, setMode] = useState<ImportMode>("skip-errors");
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportRowError[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const sheet = file?.parsed.sheets[sheetIndex] ?? null;
  const missing = useMemo(() => (entity ? missingRequired(entity, mapping) : []), [entity, mapping]);
  const previewRows = useMemo(() => sheet?.rows.slice(0, PREVIEW_ROWS) ?? [], [sheet]);
  const previewNumbers = useMemo(() => sheet?.rowNumbers.slice(0, PREVIEW_ROWS) ?? [], [sheet]);

  // Prévia: normaliza e valida as primeiras linhas a cada mudança de coluna (sem banco).
  useEffect(() => {
    let cancelled = false;
    if (!entity || !sheet) {
      setPreview([]);
      return;
    }
    void validateRows(entity, mapping, previewRows, previewNumbers).then(({ errors }) => {
      if (!cancelled) setPreview(errors);
    });
    return () => {
      cancelled = true;
    };
  }, [entity, sheet, mapping, previewRows, previewNumbers]);

  function chooseEntity(key: string) {
    setEntityKey(key);
    setResult(null);
    setError(null);
    const next = entities.find((candidate) => candidate.key === key);
    if (next && sheet) setMapping(suggestMapping(next, sheet.headers));
  }

  async function loadFile(chosen: File | undefined | null) {
    if (!chosen || !entity) return;
    setError(null);
    setResult(null);
    setReading(true);
    try {
      const parsed = await parseFile(chosen);
      setFile({ name: chosen.name, parsed });
      setSheetIndex(0);
      setMapping(suggestMapping(entity, parsed.sheets[0].headers));
    } catch (failure) {
      setFile(null);
      setError(errorMessage(failure));
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  function chooseSheet(index: number) {
    if (!file || !entity) return;
    setSheetIndex(index);
    setMapping(suggestMapping(entity, file.parsed.sheets[index].headers));
  }

  async function downloadTemplate(format: ExportFormat) {
    if (!entity) return;
    try {
      await saveBlob(await templateFor(entity.key, format), exportFilename(entity.key, format, "template"));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function downloadErrors() {
    if (!entity || !result) return;
    const labelOf = (field: string) => entity.fields.find((candidate) => candidate.key === field)?.label ?? field;
    const base = exportFilename(entity.key, "csv").replace(/\.csv$/, "");
    try {
      await saveBlob(new Blob([errorsToCsv(result.errors, labelOf)], { type: "text/csv;charset=utf-8" }), `erros-${base}.csv`);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function run(dryRun: boolean) {
    if (!entity || !sheet || !file) return;
    setRunning(true);
    setError(null);
    setProgress(null);
    try {
      const db = await getDb();
      const outcome = await runImport(entity, mapping, sheet.rows, {
        db,
        companyId: session.company.id,
        userId: session.user.id,
        mode,
        dryRun,
        filename: file.name,
        sheetName: file.parsed.format === "xlsx" ? sheet.name : null,
        format: file.parsed.format,
        rowNumbers: sheet.rowNumbers,
        onProgress: setProgress,
      });
      setResult(outcome);
      if (!dryRun && outcome.inserted + outcome.updated > 0) {
        await emit({
          type: "import.completed",
          companyId: session.company.id,
          actorId: session.user.id,
          entityType: "import_batch",
          entityId: outcome.batchId,
          module: "imports",
          title: `Importação de ${entity.label}`,
          description: `${outcome.inserted} novos, ${outcome.updated} atualizados, ${outcome.rowsWithErrors} linhas com erro (${file.name})`,
          metadata: { entity: entity.key, filename: file.name, status: outcome.status },
        });
        await queryClient.invalidateQueries();
        onImported?.(outcome);
      } else if (!dryRun) {
        await queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function restart() {
    setFile(null);
    setResult(null);
    setError(null);
    setMapping({});
  }

  const step = !entity ? 0 : !file ? 1 : !result ? 2 : 3;
  const steps = ["Cadastro", "Arquivo", "Colunas e prévia", "Resultado"];
  const visibleSteps = lockEntity ? steps.slice(1) : steps;

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Etapas da importação">
        {visibleSteps.map((label) => {
          const index = steps.indexOf(label);
          return (
            <li key={label} aria-current={index === step ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1", index === step ? "border-primary bg-primary/10 font-semibold text-foreground" : index < step ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[10px]", index <= step ? "bg-primary text-primary-foreground" : "bg-muted")}>{visibleSteps.indexOf(label) + 1}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {step === 0 && (
        <section aria-labelledby="cadastro-titulo" className="space-y-3">
          <h3 id="cadastro-titulo" className="font-semibold">O que você vai importar?</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entities.map((candidate) => (
              <button key={candidate.key} type="button" onClick={() => chooseEntity(candidate.key)} className="rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-2">
                <span className="block font-medium">{candidate.label}</span>
                {candidate.description && <span className="mt-0.5 block text-xs text-muted-foreground">{candidate.description}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {entity && step === 1 && (
        <section aria-labelledby="arquivo-titulo" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="arquivo-titulo" className="font-semibold">
              Planilha de {entity.label.toLowerCase()}
            </h3>
            {!lockEntity && entities.length > 1 && (
              <button type="button" onClick={() => setEntityKey(null)} className={BUTTON}>
                <ArrowLeft size={14} aria-hidden="true" /> Trocar cadastro
              </button>
            )}
          </div>
          <div
            onDragOver={(event: DragEvent) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              setDragging(false);
              void loadFile(event.dataTransfer.files?.[0]);
            }}
            className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
          >
            {reading ? <Loader2 size={28} className="animate-spin text-muted-foreground" aria-hidden="true" /> : <FileUp size={28} className="text-muted-foreground" aria-hidden="true" />}
            <div>
              <p className="font-medium">{reading ? "Lendo o arquivo..." : "Arraste a planilha para cá"}</p>
              <p className="mt-1 text-xs text-muted-foreground">CSV ou .xlsx</p>
            </div>
            <label className={cn(PRIMARY, "cursor-pointer", reading && "pointer-events-none opacity-50")}>
              <Upload size={14} aria-hidden="true" /> Escolher arquivo
              <input ref={input} type="file" accept={ACCEPT} className="sr-only" disabled={reading} onChange={(event) => void loadFile(event.target.files?.[0])} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => void downloadTemplate("xlsx")} className={BUTTON}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Modelo Excel
            </button>
            <button type="button" onClick={() => void downloadTemplate("csv")} className={BUTTON}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Modelo CSV
            </button>
          </div>
        </section>
      )}

      {entity && file && sheet && step === 2 && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium" title={file.name}>{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {entity.label} · {sheet.rows.length.toLocaleString("pt-BR")} {sheet.rows.length === 1 ? "linha" : "linhas"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {file.parsed.sheets.length > 1 && (
                <label className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Aba</span>
                  <select value={sheetIndex} onChange={(event) => chooseSheet(Number(event.target.value))} className="h-8 rounded-md border bg-background px-2 text-sm">
                    {file.parsed.sheets.map((candidate, index) => (
                      <option key={candidate.name} value={index}>{candidate.name} ({candidate.rows.length})</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" onClick={restart} disabled={running} className={BUTTON}>Trocar arquivo</button>
            </div>
          </div>

          <ColumnMapper entity={entity} headers={sheet.headers} mapping={mapping} sample={sheet.rows[0]} onChange={(field, header) => setMapping((current) => ({ ...current, [field]: header }))} />

          <PreviewTable entity={entity} mapping={mapping} rows={previewRows} rowNumbers={previewNumbers} errors={preview} total={sheet.rows.length} />

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Se alguma linha tiver erro</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((option) => (
                <label key={option.value} className={cn("flex cursor-pointer gap-2 rounded-lg border p-3 text-sm", mode === option.value && "border-primary bg-primary/5")}>
                  <input type="radio" name="modo-importacao" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {missing.length > 0 && (
            <p role="alert" className="text-sm text-status-danger dark:text-red-400">
              Escolha a coluna de: {missing.map((field) => field.label).join(", ")}.
            </p>
          )}

          {running && progress && <ProgressBar progress={progress} />}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => void run(true)} disabled={running || missing.length > 0} className={BUTTON}>
              <FlaskConical size={14} aria-hidden="true" /> Simular
            </button>
            <button type="button" onClick={() => void run(false)} disabled={running || missing.length > 0} className={PRIMARY}>
              {running ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} Importar {sheet.rows.length.toLocaleString("pt-BR")} {sheet.rows.length === 1 ? "linha" : "linhas"}
            </button>
          </div>
        </div>
      )}

      {entity && result && step === 3 && (
        <div className="space-y-5">
          <ResultReport entity={entity} result={result} onDownloadErrors={result.errors.length ? () => void downloadErrors() : undefined} />
          {running && progress && <ProgressBar progress={progress} />}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setResult(null)} disabled={running} className={BUTTON}>
              <ArrowLeft size={14} aria-hidden="true" /> Voltar às colunas
            </button>
            <button type="button" onClick={restart} disabled={running} className={BUTTON}>Importar outro arquivo</button>
            {result.dryRun && (
              <button type="button" onClick={() => void run(false)} disabled={running || missing.length > 0} className={PRIMARY}>
                {running ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} Importar agora
              </button>
            )}
            {onClose && !result.dryRun && (
              <button type="button" onClick={onClose} className={PRIMARY}>Fechar</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: ImportProgress }) {
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div className="space-y-1" role="status">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{PHASES[progress.phase]}...</span>
        <span className="tabular-nums">
          {progress.done.toLocaleString("pt-BR")} de {progress.total.toLocaleString("pt-BR")}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={PHASES[progress.phase]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

interface PreviewTableProps {
  entity: ImportEntity<unknown>;
  mapping: ColumnMapping;
  rows: Record<string, string>[];
  rowNumbers: number[];
  errors: ImportRowError[];
  total: number;
}

interface PreviewRow {
  row: Record<string, string>;
  number: number;
  errors: ImportRowError[];
}

/** Como a prévia (texto cru do arquivo) compara cada tipo de campo: valor e data pelo que significam, o resto como texto. */
function previewKind(kind: FieldKind): SortKind {
  if (kind === "money") return "money";
  if (kind === "number") return "number";
  if (kind === "int") return "integer";
  if (kind === "date") return "date";
  return "text";
}

const PREVIEW_TH = "px-3 py-2";

/**
 * As primeiras linhas como vão entrar: célula com problema em vermelho (o motivo no título e na última coluna). Clique no
 * cabeçalho ordena pelo tipo do campo e Filtrar filtra por coluna (Problemas: "OK" ou o motivo).
 */
function PreviewTable({ entity, mapping, rows, rowNumbers, errors, total }: PreviewTableProps) {
  const fields = useMemo(() => entity.fields.filter((field) => mapping[field.key]), [entity, mapping]);
  const previewRows = useMemo<PreviewRow[]>(() => {
    const byRow = new Map<number, ImportRowError[]>();
    for (const error of errors) byRow.set(error.row, [...(byRow.get(error.row) ?? []), error]);
    return rows.map((row, index) => {
      const number = rowNumbers[index] ?? index + 2;
      return { row, number, errors: byRow.get(number) ?? [] };
    });
  }, [rows, rowNumbers, errors]);
  const columns = useMemo<SortFilterColumn<PreviewRow>[]>(
    () => [
      { key: "number", header: "Linha", kind: "integer", sortValue: (item) => item.number },
      ...fields.map<SortFilterColumn<PreviewRow>>((field) => ({
        key: `field:${field.key}`,
        header: field.label,
        kind: previewKind(field.kind),
        sortValue: (item) => item.row[mapping[field.key]!] || null,
      })),
      { key: "problems", header: "Problemas", kind: "text", sortValue: (item) => (item.errors.length ? item.errors.map((error) => error.message).join(" · ") : "OK") },
    ],
    [fields, mapping],
  );
  const view = useSortFilter(previewRows, columns);
  const rowsWithErrors = new Set(errors.map((error) => error.row)).size;

  return (
    <section aria-labelledby="previa-titulo" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="previa-titulo" className="font-semibold">Prévia</h3>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {Math.min(rows.length, total)} primeiras de {total.toLocaleString("pt-BR")} linhas ·{" "}
            <span className={rowsWithErrors ? "font-medium text-status-danger dark:text-red-400" : undefined}>
              {rowsWithErrors === 0 ? "nenhum erro nelas" : `${rowsWithErrors} com erro`}
            </span>
          </p>
          {fields.length > 0 && <TableFilterButton view={view} />}
        </div>
      </div>
      {fields.length === 0 ? (
        <p className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">Nenhuma coluna escolhida</p>
      ) : (
        <>
          <TableFilterBar view={view} className="rounded-lg border" />
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  {columns.map((column) => (
                    <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={view.sort} onSort={view.toggleSort} className={PREVIEW_TH} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map(({ row, number, errors: rowErrors }) => (
                  <tr key={number} className={cn("border-t", rowErrors.length > 0 && "bg-status-danger/5")}>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{number}</td>
                    {fields.map((field) => {
                      const problem = rowErrors.find((error) => error.field === field.key);
                      return (
                        <td key={field.key} title={problem?.message} className={cn("max-w-[14rem] truncate px-3 py-1.5", problem && "bg-status-danger/15 font-medium text-status-danger dark:text-red-400")} data-erro={problem ? "sim" : undefined}>
                          {row[mapping[field.key]!] || <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                    <td className="max-w-[24rem] whitespace-normal px-3 py-1.5 text-xs">
                      {rowErrors.length === 0 ? <span className="text-status-success dark:text-green-400">OK</span> : rowErrors.map((error) => error.message).join(" · ")}
                    </td>
                  </tr>
                ))}
                {!view.rows.length && <NoFilterMatchRow colSpan={columns.length} />}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default ImportWizard;
