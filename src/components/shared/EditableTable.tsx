// Tabela de dados com edição no próprio lugar (padrão do app: nada de modal ou painel lateral para editar).
// Barra: Editar (células viram campos), Adicionar (linha nova no topo, já em edição), Atualizar (refaz a consulta;
// com rascunho pendente pergunta antes), Salvar / Cancelar no modo edição. Editar e Adicionar seguem
// can(papel, "edit" | "create", resource); a tela que recebe o onSave continua tendo de conferir a permissão na
// camada de dados. Valores digitados passam pelo normalizador da importação (1.234,56 e 31/12/2025 funcionam).
import { useId, useState, type ReactNode } from "react";
import { Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { usePermission } from "@/hooks/usePermission";
import { confirmAction } from "@/lib/confirm";
import type { Resource } from "@/lib/permissions/rbac";
import { cn } from "@/lib/utils";
import { CellEditor, cellText, displayCell, type EditableColumn } from "./editable/cellEditors";
import { collectChanges, draftText, hasChanges, hiddenChangedRows, isRowChanged, useRowDrafts } from "./editable/useRowDrafts";

export type { ColumnKind, EditableColumn } from "./editable/cellEditors";

export interface EditableTableChanges<T> {
  /** Linhas existentes alteradas: só os campos que mudaram, mais o id. */
  updated: (Partial<T> & { id: string })[];
  /** Linhas novas: `newRow()` + o que foi digitado. */
  created: Partial<T>[];
}

export interface EditableTableProps<T extends { id: string }> {
  resource: Resource;
  rows: T[];
  columns: EditableColumn<T>[];
  /** Grava as alterações. Erro lançado aparece na barra e mantém o rascunho. Depois de salvar, a tabela chama onRefresh. */
  onSave(changes: EditableTableChanges<T>): Promise<void>;
  onRefresh(): Promise<unknown>;
  /** Valores iniciais da linha criada por Adicionar. */
  newRow?: () => Partial<T>;
  loading?: boolean;
  /** Nome da tabela para leitor de tela (ex.: "Clientes"). */
  label?: string;
  /** Título visível à esquerda da barra. */
  title?: ReactNode;
  /** Conteúdo extra da barra (filtros, Importar/Exportar...). */
  actions?: ReactNode;
  /** Ações de cada linha gravada (abrir ficha, excluir...), na última coluna. */
  rowActions?: (row: T) => ReactNode;
  emptyMessage?: string;
  className?: string;
}

const BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "inline-flex items-center gap-1.5 rounded-md border border-transparent bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const TH = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-muted-foreground";
const TD = "px-3 py-2 align-top";
const NO_EDIT = "Seu perfil não tem permissão para editar este cadastro.";
const NO_CREATE = "Seu perfil não tem permissão para adicionar neste cadastro.";

const numeric = (kind: string) => kind === "money" || kind === "number";
const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export function EditableTable<T extends { id: string }>({
  resource,
  rows,
  columns,
  onSave,
  onRefresh,
  newRow,
  loading,
  label,
  title,
  actions,
  rowActions,
  emptyMessage = "Nenhum registro.",
  className,
}: EditableTableProps<T>) {
  const canEdit = usePermission("edit", resource);
  const canCreate = usePermission("create", resource);
  const drafts = useRowDrafts<T>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"saving" | "refreshing" | null>(null);
  const [message, setMessage] = useState<{ kind: "status" | "error"; text: string } | null>(null);
  const tableId = useId();

  const created = drafts.state.created;
  const dirty = hasChanges(drafts.state, rows, columns);
  // Linhas alteradas que a tela deixou de mostrar (busca, filtro): continuam no rascunho e vão no Salvar.
  const hidden = hiddenChangedRows(drafts.state, rows, columns);
  const showActions = !!rowActions || (editing && created.length > 0);
  const columnCount = columns.length + (showActions ? 1 : 0);

  function startEditing() {
    setMessage(null);
    setEditing(true);
  }

  function add() {
    setMessage(null);
    drafts.addRow(newRow?.() ?? {});
    setEditing(true);
  }

  function cancel() {
    drafts.reset();
    setEditing(false);
    setMessage(null);
  }

  async function refreshRows(): Promise<boolean> {
    setBusy("refreshing");
    try {
      await onRefresh();
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, "Não foi possível atualizar a lista.") });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    if (dirty) {
      const discard = await confirmAction("Há alterações não salvas nesta tabela. Descartar as alterações e atualizar?", {
        title: "Alterações não salvas",
        okLabel: "Descartar e atualizar",
        cancelLabel: "Continuar editando",
      });
      if (!discard) return;
      drafts.reset();
      setEditing(false);
    }
    setMessage(null);
    await refreshRows();
  }

  async function save() {
    const changes = collectChanges(rows, columns, drafts.state, { edit: canEdit, create: canCreate });
    const failed = Object.keys(changes.errors).filter((rowKey) => Object.keys(changes.errors[rowKey]).length > 0);
    if (failed.length) {
      drafts.setErrors(changes.errors);
      const listed = new Set([...rows.map((row) => row.id), ...created.map((draft) => draft.key)]);
      const offList = failed.filter((rowKey) => !listed.has(rowKey)).length;
      const where = offList === 1 ? " Uma linha com erro está fora da lista atual (busca ou filtro)." : offList > 1 ? ` ${offList} linhas com erro estão fora da lista atual (busca ou filtro).` : "";
      setMessage({ kind: "error", text: `Corrija os campos marcados antes de salvar.${where}` });
      return;
    }
    if (!changes.updated.length && !changes.created.length) {
      cancel();
      setMessage({ kind: "status", text: "Nada foi alterado." });
      return;
    }
    setBusy("saving");
    setMessage(null);
    try {
      await onSave({ updated: changes.updated, created: changes.created });
    } catch (error) {
      setBusy(null);
      setMessage({ kind: "error", text: errorText(error, "Não foi possível salvar.") });
      return;
    }
    drafts.reset();
    setEditing(false);
    setBusy(null);
    const total = changes.updated.length + changes.created.length;
    setMessage({ kind: "status", text: total === 1 ? "1 linha salva." : `${total} linhas salvas.` });
    await refreshRows();
  }

  function renderRow(rowKey: string, values: Partial<T>, row: T | null, number: number) {
    const isNew = row === null;
    const changed = isNew || isRowChanged(drafts.state, row, columns);
    const rowEditable = editing && (isNew || canEdit);
    return (
      <tr key={rowKey} data-row-key={rowKey} data-new={isNew ? "true" : undefined} data-changed={changed ? "true" : undefined} className={cn(changed && "bg-muted")}>
        {columns.map((column, columnIndex) => {
          const value = values[column.key];
          const error = drafts.errors[rowKey]?.[column.key];
          return (
            <td
              key={column.key}
              data-column={column.key}
              className={cn(TD, !rowEditable && numeric(column.kind) && "text-right tabular-nums", changed && columnIndex === 0 && "shadow-[inset_3px_0_0_0_hsl(var(--primary))]")}
            >
              {rowEditable && !column.readOnly ? (
                <CellEditor
                  column={column}
                  text={draftText(drafts.state, rowKey, column, value)}
                  stored={cellText(column, value)}
                  label={`${column.header} (${isNew ? "nova linha" : `linha ${number}`})`}
                  error={error}
                  errorId={`${tableId}-${rowKey}-${column.key}-erro`}
                  onChange={(text) => drafts.setCell(rowKey, column.key, text, row ?? undefined)}
                />
              ) : row && column.render ? (
                column.render(row)
              ) : (
                displayCell(column, value)
              )}
            </td>
          );
        })}
        {showActions && (
          <td className={cn(TD, "w-px whitespace-nowrap text-right")}>
            {isNew ? (
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => drafts.removeCreated(rowKey)}>
                <Trash2 size={13} /> Descartar
              </button>
            ) : (
              rowActions?.(row)
            )}
          </td>
        )}
      </tr>
    );
  }

  return (
    <div className={cn("rounded-xl border bg-card", className)} data-editable-table={resource} data-editing={editing ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editing && (
            <button type="button" className={BUTTON} disabled={!canEdit || loading || busy !== null} title={canEdit ? undefined : NO_EDIT} onClick={startEditing}>
              <Pencil size={14} /> Editar
            </button>
          )}
          <button type="button" className={BUTTON} disabled={!canCreate || busy !== null} title={canCreate ? undefined : NO_CREATE} onClick={add}>
            <Plus size={14} /> Adicionar
          </button>
          {editing && (
            <>
              <button type="button" className={BUTTON} disabled={busy !== null} onClick={cancel}>
                <X size={14} /> Cancelar
              </button>
              <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void save()}>
                <Save size={14} /> {busy === "saving" ? "Salvando..." : "Salvar"}
              </button>
            </>
          )}
          <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void refresh()}>
            <RefreshCw size={14} className={cn(busy === "refreshing" && "animate-spin")} /> Atualizar
          </button>
        </div>
      </div>
      {message &&
        (message.kind === "error" ? (
          <p role="alert" className="px-4 pt-3 text-sm font-medium text-destructive">{message.text}</p>
        ) : (
          <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">{message.text}</p>
        ))}
      {hidden > 0 && (
        <p data-hidden-drafts="" aria-live="polite" className="px-4 pt-3 text-sm text-muted-foreground">
          {hidden === 1
            ? "1 linha alterada está fora da lista atual (busca ou filtro) e também será salva."
            : `${hidden} linhas alteradas estão fora da lista atual (busca ou filtro) e também serão salvas.`}
        </p>
      )}
      {/* relative: o "Ações" sr-only (position: absolute) fica preso à rolagem da tabela, não alarga a página. */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm" aria-label={label} aria-busy={loading || busy === "refreshing" ? true : undefined}>
          <thead className="bg-muted/30">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cn(TH, numeric(column.kind) && "text-right")} style={column.width ? { width: column.width } : undefined}>
                  {column.header}
                  {editing && column.required && !column.readOnly && <span aria-hidden="true"> *</span>}
                </th>
              ))}
              {showActions && (
                <th scope="col" className={TH}>
                  <span className="sr-only">Ações</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {created.map((draft) => renderRow(draft.key, draft.base, null, 0))}
            {rows.map((row, index) => renderRow(row.id, row, row, index + 1))}
            {!created.length && !rows.length && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Carregando..." : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
