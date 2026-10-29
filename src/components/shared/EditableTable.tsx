// Tabela de dados com edição no próprio lugar (padrão do app: nada de modal ou painel lateral para editar).
// Barra só com ícones (nome no aria-label, dica no title): Filtrar (linha de filtros por coluna), Editar (células
// viram campos), Adicionar (linha nova no topo, já em edição), Atualizar (refaz a consulta; com rascunho pendente
// pergunta antes), Salvar / Cancelar no modo edição. Clique no cabeçalho ordena (crescente → decrescente → ordem da
// tela). Filtro e ordenação usam o valor gravado (a linha não pula enquanto a pessoa digita) e não mexem no rascunho:
// linha alterada que o filtro esconde continua no Salvar. Editar e Adicionar seguem
// can(papel, "edit" | "create", resource); a tela que recebe o onSave continua tendo de conferir a permissão na
// camada de dados. Valores digitados passam pelo normalizador da importação (1.234,56 e 31/12/2025 funcionam).
import { useEffect, useId, useMemo, useState, type MutableRefObject, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { usePermission } from "@/hooks/usePermission";
import { confirmAction } from "@/lib/confirm";
import type { Resource } from "@/lib/permissions/rbac";
import { cn } from "@/lib/utils";
import { CellEditor, cellText, displayCell, type EditableColumn } from "./editable/cellEditors";
import { collectChanges, draftText, hasChanges, hiddenChangedRows, isRowChanged, useRowDrafts } from "./editable/useRowDrafts";
import { IconButton, NO_FILTER_MATCH, SortableHeader, TABLE_ICONS, TableFilterBar, TableFilterButton, TH_CLASS, useSortFilter, type SortFilterColumn } from "./table";

export type { ColumnKind, EditableColumn } from "./editable/cellEditors";

export interface EditableTableChanges<T> {
  /** Linhas existentes alteradas: só os campos que mudaram, mais o id. */
  updated: (Partial<T> & { id: string })[];
  /** Linhas novas: `newRow()` + o que foi digitado. */
  created: Partial<T>[];
}

/** Comandos da barra disparados de fora da tabela (ex.: menu "Nova prospecção" dos leads). */
export interface EditableTableController {
  /** Mesmo que o botão Adicionar (linha nova no topo, já em edição); sem permissão não faz nada. */
  add(): void;
  /** Mesmo que o botão Editar; sem permissão não faz nada. */
  edit(): void;
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
  /** Recebe os comandos Adicionar/Editar para quem está fora da tabela. */
  controller?: MutableRefObject<EditableTableController | null>;
}

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
  controller,
}: EditableTableProps<T>) {
  const canEdit = usePermission("edit", resource);
  const canCreate = usePermission("create", resource);
  const drafts = useRowDrafts<T>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"saving" | "refreshing" | null>(null);
  const [message, setMessage] = useState<{ kind: "status" | "error"; text: string } | null>(null);
  const tableId = useId();
  // `sortKind` troca só o tipo de ordenar/filtrar (o editor continua pelo `kind`).
  const sortColumns = useMemo<SortFilterColumn<T>[]>(() => columns.map((column) => (column.sortKind ? { ...column, kind: column.sortKind } : column)), [columns]);
  const view = useSortFilter(rows, sortColumns);
  const visibleRows = view.rows;

  const created = drafts.state.created;
  const dirty = hasChanges(drafts.state, rows, columns);
  // Linhas alteradas que a tela ou o filtro da tabela deixaram de mostrar: continuam no rascunho e vão no Salvar.
  const hidden = hiddenChangedRows(drafts.state, visibleRows, columns);
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

  useEffect(() => {
    if (!controller) return;
    controller.current = {
      add: () => {
        if (canCreate) add();
      },
      edit: () => {
        if (canEdit && !loading) startEditing();
      },
    };
    return () => {
      controller.current = null;
    };
  });

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
      const listed = new Set([...visibleRows.map((row) => row.id), ...created.map((draft) => draft.key)]);
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
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <TableFilterButton view={view} />
          {!editing && (
            <IconButton label="Editar" icon={TABLE_ICONS.edit} disabled={!canEdit || loading || busy !== null} title={canEdit ? undefined : NO_EDIT} onClick={startEditing} />
          )}
          <IconButton label="Adicionar" icon={TABLE_ICONS.add} disabled={!canCreate || busy !== null} title={canCreate ? undefined : NO_CREATE} onClick={add} />
          {editing && (
            <>
              <IconButton label="Cancelar" icon={TABLE_ICONS.cancel} disabled={busy !== null} onClick={cancel} />
              <IconButton
                label="Salvar"
                icon={busy === "saving" ? Loader2 : TABLE_ICONS.save}
                spinning={busy === "saving"}
                variant="primary"
                title={busy === "saving" ? "Salvando..." : undefined}
                aria-busy={busy === "saving" || undefined}
                disabled={busy !== null}
                onClick={() => void save()}
              />
            </>
          )}
          <IconButton label="Atualizar" icon={TABLE_ICONS.refresh} spinning={busy === "refreshing"} disabled={busy !== null} onClick={() => void refresh()} />
        </div>
      </div>
      <TableFilterBar view={view} />
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
                <SortableHeader
                  key={column.key}
                  label={column.header}
                  sortKey={column.key}
                  sort={view.sort}
                  onSort={view.toggleSort}
                  sortable={column.sortable !== false}
                  align={numeric(column.kind) ? "right" : "left"}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {editing && column.required && !column.readOnly && <span aria-hidden="true"> *</span>}
                </SortableHeader>
              ))}
              {showActions && (
                <th scope="col" className={TH_CLASS}>
                  <span className="sr-only">Ações</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {created.map((draft) => renderRow(draft.key, draft.base, null, 0))}
            {visibleRows.map((row, index) => renderRow(row.id, row, row, index + 1))}
            {!created.length && !visibleRows.length && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Carregando..." : rows.length ? NO_FILTER_MATCH : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
