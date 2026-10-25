// Rascunhos da EditableTable: o texto digitado em cada célula (por linha) e as linhas novas ainda não salvas.
// `collectChanges` é puro: converte os textos, devolve só o que mudou e os erros por célula.
import { useCallback, useMemo, useRef, useState } from "react";
import { cellText, parseCell, sameCellValue, type EditableColumn } from "./cellEditors";

export interface CreatedDraft<T> {
  /** Chave interna da linha nova (não vai para o onSave). */
  key: string;
  /** Valores iniciais de `newRow()`. */
  base: Partial<T>;
}

export interface DraftState<T> {
  /** Linha (id, ou a chave da linha nova) → coluna → texto digitado. Só células tocadas. */
  cells: Record<string, Record<string, string>>;
  created: CreatedDraft<T>[];
  /**
   * Cópia de cada linha existente na última vez que a pessoa mexeu nela. Se a tela deixar de mostrar a linha (busca,
   * filtro), o rascunho continua valendo (Atualizar avisa, Salvar grava) em vez de sumir em silêncio.
   */
  originals: Record<string, T>;
}

export type CellErrors = Record<string, Record<string, string>>;

export interface CollectedChanges<T> {
  updated: (Partial<T> & { id: string })[];
  created: Partial<T>[];
  errors: CellErrors;
}

const editable = <T,>(columns: EditableColumn<T>[]) => columns.filter((column) => !column.readOnly);

/** Texto atual da célula: o rascunho, se a pessoa mexeu, senão o valor gravado formatado. */
export function draftText<T>(state: DraftState<T>, rowKey: string, column: EditableColumn<T>, value: unknown): string {
  return state.cells[rowKey]?.[column.key] ?? cellText(column, value);
}

/** Linha existente com algum texto diferente do gravado. */
export function isRowChanged<T extends { id: string }>(state: DraftState<T>, row: T, columns: EditableColumn<T>[]): boolean {
  const cells = state.cells[row.id];
  if (!cells) return false;
  return editable(columns).some((column) => column.key in cells && cells[column.key] !== cellText(column, row[column.key]));
}

/**
 * Linhas existentes com rascunho: as da lista atual, na ordem dela, e depois as que a tela deixou de mostrar (busca,
 * filtro), pela cópia guardada quando a pessoa mexeu nelas.
 */
export function draftedRows<T extends { id: string }>(state: DraftState<T>, rows: T[]): { row: T; visible: boolean }[] {
  const listed = new Set(rows.map((row) => row.id));
  const visible = rows.filter((row) => state.cells[row.id]).map((row) => ({ row, visible: true }));
  const hidden = Object.keys(state.cells)
    .filter((key) => !listed.has(key) && state.originals[key])
    .map((key) => ({ row: state.originals[key], visible: false }));
  return [...visible, ...hidden];
}

export function hasChanges<T extends { id: string }>(state: DraftState<T>, rows: T[], columns: EditableColumn<T>[]): boolean {
  return state.created.length > 0 || draftedRows(state, rows).some(({ row }) => isRowChanged(state, row, columns));
}

/** Quantas linhas alteradas a tela não está mostrando agora (serão salvas junto). */
export function hiddenChangedRows<T extends { id: string }>(state: DraftState<T>, rows: T[], columns: EditableColumn<T>[]): number {
  return draftedRows(state, rows).filter(({ row, visible }) => !visible && isRowChanged(state, row, columns)).length;
}

/**
 * Monta o que vai para o onSave: linhas existentes só com os campos que mudaram (e o id), inclusive as que a tela
 * deixou de mostrar; linhas novas com `newRow()` + o que foi digitado. Célula inválida ou obrigatória vazia vira
 * erro e nada é salvo.
 */
export function collectChanges<T extends { id: string }>(
  rows: T[],
  columns: EditableColumn<T>[],
  state: DraftState<T>,
  allowed: { edit: boolean; create: boolean } = { edit: true, create: true },
): CollectedChanges<T> {
  const errors: CellErrors = {};
  const fail = (rowKey: string, columnKey: string, reason: string) => {
    (errors[rowKey] ??= {})[columnKey] = reason;
  };
  const updated: (Partial<T> & { id: string })[] = [];
  const created: Partial<T>[] = [];

  if (allowed.edit) {
    for (const { row } of draftedRows(state, rows)) {
      const cells = state.cells[row.id];
      const patch: Partial<T> = {};
      for (const column of editable(columns)) {
        if (!(column.key in cells)) continue;
        const original = row[column.key];
        if (cells[column.key] === cellText(column, original)) continue;
        const parsed = parseCell(column, cells[column.key], original);
        if (!parsed.ok) fail(row.id, column.key, parsed.reason);
        else if (!sameCellValue(column, parsed.value, original)) patch[column.key] = parsed.value as T[keyof T & string];
      }
      if (Object.keys(patch).length) updated.push({ ...patch, id: row.id });
    }
  }

  if (allowed.create) {
    for (const draft of state.created) {
      const cells = state.cells[draft.key] ?? {};
      const values: Partial<T> = { ...draft.base };
      for (const column of editable(columns)) {
        const original = draft.base[column.key];
        if (column.key in cells && cells[column.key] !== cellText(column, original)) {
          const parsed = parseCell(column, cells[column.key], original);
          if (!parsed.ok) fail(draft.key, column.key, parsed.reason);
          else values[column.key] = parsed.value as T[keyof T & string];
        } else if (column.required && (original === null || original === undefined || original === "")) {
          fail(draft.key, column.key, "Obrigatório");
        }
      }
      created.push(values);
    }
  }

  return { updated, created, errors };
}

const EMPTY = { cells: {}, created: [], originals: {} };

/** Estado dos rascunhos + erros por célula (limpos quando a pessoa mexe na célula). */
export function useRowDrafts<T extends { id: string }>() {
  const [state, setState] = useState<DraftState<T>>(EMPTY);
  const [errors, setErrors] = useState<CellErrors>({});
  const counter = useRef(0);

  /** `original` = a linha gravada (linha existente); guardada para o rascunho sobreviver se a tela a esconder. */
  const setCell = useCallback((rowKey: string, columnKey: string, text: string, original?: T) => {
    setState((current) => ({
      ...current,
      cells: { ...current.cells, [rowKey]: { ...current.cells[rowKey], [columnKey]: text } },
      originals: original ? { ...current.originals, [rowKey]: original } : current.originals,
    }));
    setErrors((current) => {
      if (!current[rowKey]?.[columnKey]) return current;
      const rowErrors = { ...current[rowKey] };
      delete rowErrors[columnKey];
      return { ...current, [rowKey]: rowErrors };
    });
  }, []);

  const addRow = useCallback((base: Partial<T>) => {
    counter.current += 1;
    const key = `nova-linha-${counter.current}`;
    setState((current) => ({ ...current, created: [{ key, base }, ...current.created] }));
    return key;
  }, []);

  const removeCreated = useCallback((key: string) => {
    setState((current) => {
      const cells = { ...current.cells };
      delete cells[key];
      return { ...current, cells, created: current.created.filter((draft) => draft.key !== key) };
    });
  }, []);

  const reset = useCallback(() => {
    setState(EMPTY);
    setErrors({});
  }, []);

  return useMemo(() => ({ state, errors, setErrors, setCell, addRow, removeCreated, reset }), [state, errors, setCell, addRow, removeCreated, reset]);
}
