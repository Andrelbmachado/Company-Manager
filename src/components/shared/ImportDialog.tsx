import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { useRequiredSession } from "@/hooks/useSession";
import { useCreateEntity } from "@/hooks/useEntity";
import { getEntity, writableFields, type EntityKey } from "@/lib/data/entities";
import {
  autoMapHeaders,
  exportFileName,
  loadImportContext,
  planImport,
  readTabular,
  saveTextFile,
  templateCsv,
  type ColumnMapping,
  type ImportContext,
  type Tabular,
} from "@/lib/data/importExport";
import { cn } from "@/lib/utils";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Target entities; the first is the default. */
  entities: EntityKey[];
}

type Step = "upload" | "map" | "done";

export function ImportDialog({ open, onClose, entities }: ImportDialogProps) {
  const session = useRequiredSession();
  const [entity, setEntity] = useState<EntityKey>(entities[0]);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [data, setData] = useState<Tabular | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [ctx, setCtx] = useState<ImportContext | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [inserted, setInserted] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useCreateEntity(entity);
  const def = getEntity(entity);
  const fields = writableFields(def);

  useEffect(() => {
    if (!open) return;
    setEntity(entities[0]);
    setStep("upload");
    setData(null);
    setFileName("");
    setError("");
    setCtx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-map and reload context whenever the file or the target entity changes.
  useEffect(() => {
    if (!data) return;
    setMapping(autoMapHeaders(def, data.headers));
    setCtx(null);
    loadImportContext(def, session.company.id).then(setCtx, (e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, entity]);

  const plan = useMemo(
    () => (data && ctx ? planImport(def, data, mapping, ctx, { skipDuplicates }) : null),
    [def, data, mapping, ctx, skipDuplicates]
  );

  const missingRequired = fields.filter((f) => f.required && !mapping.includes(f.key));

  async function handleFile(file: File) {
    setError("");
    try {
      const text = await file.text();
      const parsed = readTabular(text, file.name);
      if (!parsed.headers.length) throw new Error("Arquivo vazio.");
      if (!parsed.rows.length) throw new Error("O arquivo só tem cabeçalho, nenhuma linha de dados.");
      setFileName(file.name);
      setData(parsed);
      setStep("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleImport() {
    if (!plan) return;
    await create.mutateAsync(plan.toInsert);
    setInserted(plan.toInsert.length);
    setStep("done");
  }

  const footer =
    step === "map" ? (
      <>
        <Button onClick={() => setStep("upload")}>Voltar</Button>
        <Button
          variant="primary"
          data-testid="import-confirm"
          disabled={!plan || !plan.toInsert.length || missingRequired.length > 0 || create.isPending}
          onClick={handleImport}
        >
          {create.isPending && <Loader2 size={14} className="animate-spin" />}
          Importar {plan?.toInsert.length ?? 0} {plan?.toInsert.length === 1 ? "registro" : "registros"}
        </Button>
      </>
    ) : step === "done" ? (
      <Button variant="primary" onClick={onClose} data-testid="import-finish">Concluir</Button>
    ) : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Importar ${entities.length > 1 ? "dados" : def.labelPlural.toLowerCase()}`}
      description="CSV (separado por vírgula, ponto e vírgula ou tab) ou JSON"
      className="max-w-2xl"
      testId="import-dialog"
      footer={footer}
    >
      {entities.length > 1 && step !== "done" && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-medium">Importar como</span>
          <div className="flex gap-1 rounded-lg border bg-muted/40 p-1" role="tablist">
            {entities.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={entity === k}
                data-testid={`import-target-${k}`}
                onClick={() => setEntity(k)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  entity === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {getEntity(k).labelPlural}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "upload" && (
        <div className="space-y-4">
          <button
            type="button"
            data-testid="import-dropzone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40"
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileUp size={18} />
            </span>
            <span className="text-sm font-medium">Arraste o arquivo aqui ou clique para escolher</span>
            <span className="text-xs text-muted-foreground">.csv, .txt ou .json</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.json,text/csv,application/json"
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>
              Colunas reconhecidas: {fields.map((f) => f.label + (f.required ? "*" : "")).join(", ")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              data-testid="import-template"
              onClick={() => saveTextFile(exportFileName(def, "template"), templateCsv(def))}
            >
              <Download size={14} />
              Modelo
            </Button>
          </div>
        </div>
      )}

      {step === "map" && data && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{fileName}</span> · {data.rows.length} linhas. Confira para qual campo vai cada coluna.
          </p>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm" data-testid="import-mapping">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="h-9 px-3 text-left font-medium">Coluna do arquivo</th>
                  <th className="h-9 px-3 text-left font-medium">Exemplo</th>
                  <th className="h-9 w-56 px-3 text-left font-medium">Campo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.headers.map((h, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium">{h || <em className="text-muted-foreground">sem nome</em>}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-muted-foreground">
                      {data.rows.find((r) => r[i])?.[i] ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        aria-label={`Campo para a coluna ${h}`}
                        data-testid={`import-map-${i}`}
                        value={mapping[i] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => m.map((v, idx) => (idx === i ? e.target.value || null : v)))
                        }
                        className={cn(inputClass, "h-8")}
                      >
                        <option value="">Ignorar</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequired.length > 0 && (
            <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle size={14} />
              Associe uma coluna ao campo obrigatório: {missingRequired.map((f) => f.label).join(", ")}
            </p>
          )}

          {def.dedupeBy?.length ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
                data-testid="import-skip-duplicates"
                className="h-4 w-4 rounded border"
              />
              Ignorar duplicados (mesmo{" "}
              {def.dedupeBy.map((k) => fields.find((f) => f.key === k)?.label.toLowerCase()).join(" ou ")})
            </label>
          ) : null}

          {!plan ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Analisando...
            </p>
          ) : (
            <div className="space-y-2" data-testid="import-summary">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Prontas" value={plan.toInsert.length} tone="ok" />
                <Stat label="Com erro" value={plan.errorCount} tone={plan.errorCount ? "error" : "muted"} />
                <Stat label="Duplicadas" value={plan.duplicateCount} tone="muted" />
              </div>
              {plan.rows.some((r) => r.errors.length || r.warnings.length) && (
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2 text-xs">
                  {plan.rows
                    .filter((r) => r.errors.length || r.warnings.length)
                    .slice(0, 50)
                    .map((r) => (
                      <li key={r.line} className={r.errors.length ? "text-destructive" : "text-muted-foreground"}>
                        Linha {r.line}: {[...r.errors, ...r.warnings].join("; ")}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="import-result">
          <CheckCircle2 size={40} className="text-emerald-500" />
          <p className="font-medium">
            {inserted} {inserted === 1 ? "registro importado" : "registros importados"} em {def.labelPlural}
          </p>
          {plan && (plan.errorCount > 0 || plan.duplicateCount > 0) && (
            <p className="text-sm text-muted-foreground">
              {plan.errorCount} com erro e {skipDuplicates ? plan.duplicateCount : 0} duplicadas foram ignoradas.
            </p>
          )}
        </div>
      )}

      {(error || create.error) && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error || String(create.error)}
        </p>
      )}
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "error" | "muted" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
