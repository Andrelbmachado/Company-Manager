// Histórico de importações (import_batches): quando, qual cadastro, arquivo, resultado e os erros de cada uma.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileUp, History } from "lucide-react";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { entityLabel } from "@/lib/importexport/access";
import { errorsToCsv, type ImportRowError } from "@/lib/importexport/errors";
import { getEntity } from "@/lib/importexport/registry";
import { MAX_STORED_ERRORS } from "@/lib/importexport/runImport";
import { saveBlob } from "@/lib/importexport/saveFile";
import { can } from "@/lib/permissions/rbac";
import { formatDateTime } from "@/lib/utils";
import type { ImportBatch, Role } from "@/types";
import { ResultReport } from "../components/ResultReport";

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** datetime('now') do SQLite é UTC sem fuso: mostra no horário local. */
const when = (value: string | null | undefined) => (value ? formatDateTime(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) || value.includes("T") ? value : `${value.replace(" ", "T")}Z`) : "—");

const MODE_LABEL: Record<string, string> = { "skip-errors": "Importar as linhas certas", "all-or-nothing": "Tudo ou nada" };

export default function ImportHistoryPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [selected, setSelected] = useState<ImportBatch | null>(null);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["import-batches", session.company.id],
    queryFn: async () => {
      const rows = await (await getDb()).select<ImportBatch[]>("SELECT * FROM import_batches WHERE company_id=? AND deleted_at IS NULL", [session.company.id]);
      return [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
  });

  const entityKeys = useMemo(() => [...new Set(batches.map((batch) => batch.entity))].sort((a, b) => entityLabel(a).localeCompare(entityLabel(b), "pt-BR")), [batches]);
  const term = search.trim().toLowerCase();
  const visible = batches.filter((batch) => (!entityFilter || batch.entity === entityFilter) && (!term || `${batch.filename ?? ""} ${entityLabel(batch.entity)}`.toLowerCase().includes(term)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Histórico de importações"
        description="Cada importação e simulação feita, com o resultado e o relatório de erros."
        actions={
          can(role, "create", "imports") ? (
            <Link to="/imports" className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <FileUp size={14} aria-hidden="true" /> Nova importação
            </Link>
          ) : null
        }
      />
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar pelo arquivo ou cadastro...">
        {entityKeys.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Cadastro</span>
            <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Todos</option>
              {entityKeys.map((key) => (
                <option key={key} value={key}>{entityLabel(key)}</option>
              ))}
            </select>
          </label>
        )}
      </PageToolbar>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando...</p>
      ) : visible.length === 0 ? (
        <EmptyState icon={History} title={batches.length === 0 ? "Nenhuma importação ainda" : "Nada encontrado"} description={batches.length === 0 ? "As importações e simulações aparecem aqui, com o relatório de erros." : "Mude a busca ou o filtro."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Quando</th>
                <th scope="col" className="px-3 py-2 font-medium">Cadastro</th>
                <th scope="col" className="px-3 py-2 font-medium">Arquivo</th>
                <th scope="col" className="px-3 py-2 font-medium">Situação</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Linhas</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Novos</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Atualizados</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Com erro</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((batch) => (
                <tr key={batch.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSelected(batch)}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" onClick={(event) => { event.stopPropagation(); setSelected(batch); }} className="text-left font-medium hover:underline">
                      {when(batch.created_at)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{entityLabel(batch.entity)}</td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground" title={batch.filename ?? undefined}>
                    {batch.filename ?? "—"}
                    {batch.sheet_name ? ` · ${batch.sheet_name}` : ""}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={batch.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{batch.rows_total.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{batch.inserted.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{batch.updated.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{batch.rows_err.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <BatchDrawer batch={selected} onClose={() => setSelected(null)} isMine={selected.created_by === session.user.id} />}
    </div>
  );
}

function BatchDrawer({ batch, onClose, isMine }: { batch: ImportBatch; onClose: () => void; isMine: boolean }) {
  const entity = getEntity(batch.entity);
  const errors = parseJson<ImportRowError[]>(batch.errors_json, []);
  const mapping = parseJson<Record<string, string>>(batch.mapping_json, {});
  const labelOf = (field: string) => entity?.fields.find((candidate) => candidate.key === field)?.label ?? field;
  const truncated = batch.rows_err > 0 && errors.length >= MAX_STORED_ERRORS;

  async function downloadErrors() {
    const name = `erros-importacao-${batch.entity}-${String(batch.created_at).slice(0, 10)}.csv`;
    await saveBlob(new Blob([errorsToCsv(errors, labelOf)], { type: "text/csv;charset=utf-8" }), name);
  }

  return (
    <DetailDrawer title={batch.filename ?? "Importação"} subtitle={`${entityLabel(batch.entity)} · ${when(batch.created_at)}`} onClose={onClose}>
      <div className="space-y-6">
        <DetailGrid>
          <DetailItem label="Situação" value={<StatusBadge status={batch.status} />} />
          <DetailItem label="Formato" value={batch.format ? batch.format.toUpperCase() : null} />
          <DetailItem label="Aba" value={batch.sheet_name} />
          <DetailItem label="Se houvesse erro" value={MODE_LABEL[batch.mode] ?? batch.mode} />
          <DetailItem label="Feita por" value={isMine ? "Você" : batch.created_by ? "Outra pessoa da empresa" : null} />
          <DetailItem label="Concluída em" value={when(batch.finished_at)} />
        </DetailGrid>

        {entity ? (
          <ResultReport
            entity={entity}
            result={{
              status: batch.status,
              dryRun: Boolean(batch.dry_run),
              mode: batch.mode,
              total: batch.rows_total,
              ok: batch.rows_ok,
              inserted: batch.inserted,
              updated: batch.updated,
              rowsWithErrors: batch.rows_err,
              errors,
            }}
            onDownloadErrors={errors.length ? () => void downloadErrors() : undefined}
            storedErrorsNote={truncated ? `O histórico guarda os ${MAX_STORED_ERRORS.toLocaleString("pt-BR")} primeiros problemas.` : undefined}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Cadastro "{batch.entity}" não existe mais nesta versão.</p>
        )}

        {Object.keys(mapping).length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Colunas usadas</h3>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {Object.entries(mapping).map(([header, field]) => (
                <div key={header} className="flex gap-2">
                  <dt className="truncate text-muted-foreground" title={header}>{header}</dt>
                  <dd className="truncate">→ {labelOf(field)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </DetailDrawer>
  );
}
