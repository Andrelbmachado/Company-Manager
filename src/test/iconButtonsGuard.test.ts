// Pedido de 2026-10-25 (itens 12 e 13): botões Editar, Atualizar e Adicionar são só ícone (nome no aria-label, dica
// no title e o texto num sr-only; use IconButton de components/shared/table) e o ícone de editar é o lápis saindo do
// quadrado (SquarePen = TABLE_ICONS.edit / EditIcon), nunca o lápis solto. project-manager fica de fora (é sincronizado).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "project-manager" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

const BUTTON_TEXT = /^(Editar|Atualizar|Adicionar)\b/;

function className(element: ts.JsxOpeningLikeElement): string {
  const attribute = element.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText() === "className");
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer ? attribute.initializer.getText() : "";
}

/** Texto dentro de um <button> que aparece na tela (fora de um sr-only). */
function insideVisibleButton(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isJsxElement(parent)) continue;
    if (className(parent.openingElement).includes("sr-only")) return false;
    if (parent.openingElement.tagName.getText() === "button") return true;
  }
  return false;
}

function textButtons(file: { path: string; text: string }): string[] {
  if (!file.path.endsWith(".tsx")) return [];
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const text = ts.isJsxText(node) ? node.text.trim() : ts.isStringLiteralLike(node) && ts.isJsxExpression(node.parent) ? node.text.trim() : null;
    if (text && BUTTON_TEXT.test(text) && insideVisibleButton(node)) {
      found.push(`${file.path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} "${text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("botões só com ícone e ícone de editar", () => {
  it("nenhum botão mostra o texto Editar, Atualizar ou Adicionar (o nome vai no aria-label/title e num sr-only)", () => {
    expect(files.flatMap(textButtons)).toEqual([]);
  });

  it("editar usa o lápis saindo do quadrado (SquarePen), não o lápis solto da lucide", () => {
    const pencil = /import\s*(?:type\s*)?\{[^}]*\b(Pencil|PencilLine|Pen|PenLine|Edit2|Edit3)\b[^}]*\}\s*from\s*["']lucide-react["']/;
    expect(files.filter((file) => pencil.test(file.text)).map((file) => file.path)).toEqual([]);
  });
});
