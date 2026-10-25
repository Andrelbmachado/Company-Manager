// Contrato da Tarefa 6 do redesign (grupo b: financeiro, folha e compras), usado pelos editing.test.tsx de cada pasta:
// toda lista da tela é uma EditableTable e clicar em Editar ou Adicionar não abre modal nem painel lateral; nenhum
// arquivo da pasta usa CrudDialog ou DetailDrawer (confirmação é o botão de dois passos ou confirmAction).
import { expect } from "vitest";
import { click, findButton, until, type RenderedPage } from "@/test/pageHarness";

const BUTTON_TEXT = (button: HTMLButtonElement) => button.textContent?.trim() ?? "";

/** Botão da barra da tabela (texto exato, para não pegar ações das linhas). */
export function toolbarButton(table: Element, label: string): HTMLButtonElement | undefined {
  return [...table.querySelectorAll<HTMLButtonElement>("button")].find((button) => BUTTON_TEXT(button) === label);
}

export function editableTables(scope: ParentNode = document): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>("[data-editable-table]")];
}

/**
 * Espera a(s) tabela(s) da tela, clica em Editar e em Adicionar em cada uma (quando o papel pode) e confere que nenhum
 * `role="dialog"` apareceu. Devolve quantas tabelas deixaram editar e adicionar.
 */
export async function expectInlineEditing(view: RenderedPage, what: string, minTables = 1): Promise<number> {
  await until(() => editableTables(view.container).length >= minTables, `${what}: tabela editável`);
  await until(() => editableTables(view.container).every((table) => !table.querySelector('table[aria-busy="true"]')), `${what}: tabela carregada`);
  let editable = 0;
  for (const table of editableTables(view.container)) {
    const edit = toolbarButton(table, "Editar");
    const add = toolbarButton(table, "Adicionar");
    expect(edit, `${what}: botão Editar`).toBeDefined();
    expect(add, `${what}: botão Adicionar`).toBeDefined();
    expect(findButton(table, "Atualizar"), `${what}: botão Atualizar`).toBeDefined();
    if (edit && !edit.disabled) await click(edit);
    expect(document.querySelector("[role=dialog]"), `${what}: Editar não abre modal`).toBeNull();
    if (add && !add.disabled) {
      await click(add);
      expect(table.querySelector("tr[data-new]"), `${what}: linha nova na própria tabela`).not.toBeNull();
    }
    expect(document.querySelector("[role=dialog]"), `${what}: Adicionar não abre modal`).toBeNull();
    if (edit && !edit.disabled && add && !add.disabled) editable++;
  }
  return editable;
}

/** Arquivos .tsx da pasta (sem testes) que ainda importam CrudDialog ou DetailDrawer. */
export function filesWithDialogs(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([path]) => !/\.test\.tsx?$/.test(path))
    .filter(([, text]) => /\b(CrudDialog|DetailDrawer)\b/.test(text))
    .map(([path]) => path);
}
