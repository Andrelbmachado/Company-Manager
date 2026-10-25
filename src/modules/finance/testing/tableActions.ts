// Ações de teste sobre uma EditableTable (financeiro, folha e compras): achar a tabela, o campo de uma célula pela
// linha (id gravado ou "nova") e coluna, digitar ou escolher e salvar esperando o fim do modo edição.
import { choose, click, findButton, type, until } from "@/test/pageHarness";

export function tableOf(scope: ParentNode, resource?: string): HTMLElement {
  const table = scope.querySelector<HTMLElement>(resource ? `[data-editable-table="${resource}"]` : "[data-editable-table]");
  if (!table) throw new Error(`tabela editável ${resource ?? ""} não encontrada`);
  return table;
}

/** Linha da tabela: id gravado ou "nova" (primeira linha nova, no topo). */
export function rowOf(table: Element, rowKey: string): HTMLTableRowElement | null {
  return table.querySelector<HTMLTableRowElement>(rowKey === "nova" ? "tr[data-new]" : `tr[data-row-key="${rowKey}"]`);
}

export function cellField(table: Element, rowKey: string, column: string): HTMLInputElement | HTMLSelectElement {
  const field = rowOf(table, rowKey)?.querySelector<HTMLInputElement | HTMLSelectElement>(`td[data-column="${column}"] input, td[data-column="${column}"] select`);
  if (!field) throw new Error(`campo ${column} da linha ${rowKey} não encontrado`);
  return field;
}

export function cellText(table: Element, rowKey: string, column: string): string {
  return (rowOf(table, rowKey)?.querySelector(`td[data-column="${column}"]`)?.textContent ?? "").replace(/ /g, " ").trim();
}

export async function editCell(table: Element, rowKey: string, column: string, value: string | boolean): Promise<void> {
  const field = cellField(table, rowKey, column);
  if (field instanceof HTMLSelectElement) await choose(field, String(value));
  else if (field.type === "checkbox") {
    if (field.checked !== value) await click(field);
  } else await type(field, String(value));
}

export async function startEditing(table: Element): Promise<void> {
  await click(findButton(table, "Editar"));
}

export async function addRow(table: Element): Promise<void> {
  await click(findButton(table, "Adicionar"));
}

/** Salva e espera a tabela sair do modo edição; erro da barra (role="alert") vira exceção com o texto. */
export async function saveTable(table: HTMLElement): Promise<void> {
  await click(findButton(table, "Salvar"));
  await until(() => table.dataset.editing !== "true" || Boolean(table.querySelector("[role=alert]")), "tabela salva");
  const alert = table.querySelector("[role=alert]");
  if (alert && table.dataset.editing === "true") throw new Error(alert.textContent ?? "erro ao salvar");
}

/** Mensagem de erro da barra da tabela depois de Salvar. */
export async function saveError(table: HTMLElement): Promise<string> {
  await click(findButton(table, "Salvar"));
  await until(() => Boolean(table.querySelector("[role=alert]")), "erro ao salvar");
  return table.querySelector("[role=alert]")?.textContent ?? "";
}
