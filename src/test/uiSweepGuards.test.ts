// Travas da varredura do pedido de 2026-10-25, para não voltarem:
// - item 8: página sem subtítulo (PageHeader não tem descrição; nada de saudação com nome, papel ou empresa);
// - item 9: sem texto de ajuda (estado vazio curto, sem descrição; frases de instrução do pedido não voltam).
// Os botões só com ícone (itens 12 e 13) estão em iconButtonsGuard.test.ts e o gráfico de linha fora do componente
// compartilhado (itens 2 e 3) em components/shared/charts/LineAreaChart.test.tsx. project-manager fica de fora.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "project-manager" ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const files = ["modules", "app", "components"]
  .flatMap((dir) => sourceFiles(join(SRC, dir)))
  .map((path) => {
    const text = readFileSync(path, "utf8");
    return { path: relative(SRC, path), text, source: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) };
  });

type File = (typeof files)[number];

function where(file: File, node: ts.Node): string {
  return `${file.path}:${file.source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function opening(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

function attribute(element: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText() === name);
}

/** Elementos JSX de uma tag (ex.: "PageHeader", "table") no arquivo. */
function elements(file: File, tag: string): ts.Node[] {
  const found: ts.Node[] = [];
  walk(file.source, (node) => {
    const element = opening(node);
    if (element && element.tagName.getText() === tag) found.push(node);
  });
  return found;
}

/** Textos literais de um atributo (string direta ou ramos de um ternário/||). */
function literalTexts(initializer: ts.JsxAttributeValue | undefined): string[] {
  if (!initializer) return [];
  if (ts.isStringLiteral(initializer)) return [initializer.text];
  const texts: string[] = [];
  walk(initializer, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text);
  });
  return texts;
}

describe("item 8: páginas sem subtítulo", () => {
  it("o PageHeader não aceita descrição (só título e ações)", () => {
    const header = files.find((file) => file.path === join("components", "shared", "PageHeader.tsx"))!;
    expect(header.text).not.toMatch(/\bdescription\b/);
  });

  it("nenhuma tela passa descrição para o PageHeader", () => {
    const offenders = files.flatMap((file) => elements(file, "PageHeader").filter((node) => attribute(opening(node)!, "description")).map((node) => where(file, node)));
    expect(offenders).toEqual([]);
  });

  it("os subtítulos citados no pedido não voltam (papel · empresa, apresentação do setor, saudação do Meu RH)", () => {
    const banned = [/ROLE_HOME_INTRO/, /Aqui ficam suas/, /Visão geral: caixa/, /Ausências, reuniões e agendas conectadas/, /\$\{ROLE_LABELS\[[^\]]+\]\} · \$\{session\.company\.name\}/];
    const offenders = files.filter((file) => banned.some((pattern) => pattern.test(file.text))).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

describe("item 9: sem texto de ajuda desnecessário", () => {
  it("estado vazio não tem descrição e o título literal tem no máximo 4 palavras", () => {
    const emptyState = files.find((file) => file.path === join("components", "shared", "EmptyState.tsx"))!;
    expect(emptyState.text).not.toMatch(/\bdescription\b/);
    const offenders = files.flatMap((file) =>
      elements(file, "EmptyState").flatMap((node) => {
        const element = opening(node)!;
        const problems: string[] = [];
        if (attribute(element, "description")) problems.push(`${where(file, node)} descrição`);
        for (const title of literalTexts(attribute(element, "title")?.initializer)) {
          if (title.trim().split(/\s+/).length > 4) problems.push(`${where(file, node)} "${title}"`);
        }
        return problems;
      }),
    );
    expect(offenders).toEqual([]);
  });

  it("as frases de ajuda citadas no pedido e as instruções de uso dos botões não voltam", () => {
    const banned = [
      /Peça férias, folga ou envie/,
      /Quando o RH precisar de algo seu/,
      /Só os meus follow-ups<\/|> Só os meus follow-ups/,
      /ordenados por prioridade de abordagem/,
      /\bUse (Adicionar|Editar|Atualizar)\b/,
      /\bcom Adicionar\b/,
      /\(botão Editar\)/,
      /Respostas devem ser validadas/,
      /Consulte dados permitidos/,
      /Conexão pessoal usada somente/,
    ];
    const offenders = files.flatMap((file) => banned.filter((pattern) => pattern.test(file.text)).map((pattern) => `${file.path} ${pattern}`));
    expect(offenders).toEqual([]);
  });
});
