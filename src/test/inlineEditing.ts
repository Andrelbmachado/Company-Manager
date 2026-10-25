// Contrato "edição direto na tabela" (Tarefa 6 do redesign): a tela tem EditableTable e Editar/Adicionar abrem a
// edição na própria linha, sem diálogo nem gaveta. Usado pelos editing.test.tsx de cada módulo.
import { expect } from "vitest";
import { click, findButton, until } from "./pageHarness";

const dialogs = () => [...document.querySelectorAll("[role=dialog], [aria-modal=true]")];

function exactButton(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label) ?? findButton(scope, label);
}

/** Barra da tabela (Editar, Adicionar, Cancelar...): os botões ficam no primeiro bloco, antes do <table>. */
function toolbarOf(table: HTMLElement): HTMLElement {
  return (table.firstElementChild as HTMLElement | null) ?? table;
}

/**
 * Para cada EditableTable na tela (ou só as `resources` pedidas): Editar entra no modo edição sem abrir diálogo;
 * Adicionar cria a linha nova (tr[data-new]) na própria tabela, também sem diálogo. Cancela no fim.
 */
export async function expectInlineEditing(container: ParentNode, resources?: readonly string[]): Promise<void> {
  await until(() => container.querySelectorAll("[data-editable-table]").length > 0, "tabela editável na tela");
  const tables = [...container.querySelectorAll<HTMLElement>("[data-editable-table]")];
  if (resources) expect(tables.map((table) => table.dataset.editableTable)).toEqual(expect.arrayContaining([...resources]));
  for (const table of tables) {
    if (resources && !resources.includes(table.dataset.editableTable ?? "")) continue;
    const name = table.dataset.editableTable;
    const edit = exactButton(toolbarOf(table), "Editar");
    expect(edit, `botão Editar em ${name}`).toBeDefined();
    await until(() => !edit!.disabled, `Editar habilitado em ${name}`);
    await click(edit);
    expect(table.dataset.editing, `modo edição em ${name}`).toBe("true");
    expect(dialogs(), `diálogo aberto por Editar em ${name}`).toHaveLength(0);
    await click(exactButton(toolbarOf(table), "Cancelar"));

    const add = exactButton(toolbarOf(table), "Adicionar");
    expect(add, `botão Adicionar em ${name}`).toBeDefined();
    expect(add!.disabled, `Adicionar habilitado em ${name}`).toBe(false);
    await click(add);
    expect(table.querySelector("tr[data-new]"), `linha nova em ${name}`).not.toBeNull();
    expect(dialogs(), `diálogo aberto por Adicionar em ${name}`).toHaveLength(0);
    await click(exactButton(toolbarOf(table), "Cancelar"));
    expect(exactButton(toolbarOf(table), "Atualizar"), `botão Atualizar em ${name}`).toBeDefined();
  }
}

/** Nenhum diálogo/gaveta aberto agora. */
export function expectNoDialog(where: string): void {
  expect(dialogs(), where).toHaveLength(0);
}
