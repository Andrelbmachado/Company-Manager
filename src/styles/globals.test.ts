// Base visual do app (globals.css + tailwind.config.js): tipografia de texto corrido no padrão do macOS.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import loadConfig from "tailwindcss/loadConfig";
import resolveConfig from "tailwindcss/resolveConfig";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const css = read("src/styles/globals.css");

/** Variáveis CSS de todos os blocos `:root` (o tema de cores e o de tipografia ficam em blocos separados). */
function rootTokens(source: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, body] of source.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const [, name, value] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
  }
  return tokens;
}

/** Corpo da regra cujo seletor é exatamente `selector` (ex.: "body", "html, body, #root"). */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&").replace(/,\s*/g, ",\\s*");
  const match = source.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, "m"));
  if (!match) throw new Error(`regra "${selector}" não encontrada no globals.css`);
  return match[1];
}

const px = (rem: string) => Number.parseFloat(rem) * 16;

type FontSize = [string, { lineHeight?: string; fontWeight?: string }];
const theme = resolveConfig(loadConfig(path.join(ROOT, "tailwind.config.js"))).theme as unknown as { fontSize: Record<string, FontSize> };

describe("tipografia (padrão Apple para macOS)", () => {
  const tokens = rootTokens(css);

  it("tokens de tamanho e entrelinha em :root: corpo 13/16, legendas 11/14 e 12/15, títulos maiores", () => {
    expect(px(tokens["text-body"])).toBe(13);
    expect(px(tokens["leading-body"])).toBe(16);
    expect(px(tokens["text-caption"])).toBe(11);
    expect(px(tokens["leading-caption"])).toBe(14);
    expect(px(tokens["text-callout"])).toBe(12);
    expect(px(tokens["leading-callout"])).toBe(15);
    // Títulos mantêm a hierarquia acima do corpo: 15 (title 3), 17 (title 2), 22 (title 1), 26 (large title).
    expect(px(tokens["text-title3"])).toBe(15);
    expect(px(tokens["text-title2"])).toBe(17);
    expect(px(tokens["text-title1"])).toBe(22);
    expect(px(tokens["text-large-title"])).toBe(26);
  });

  it("o body usa o corpo de texto (texto sem classe de tamanho também fica em 13/16)", () => {
    const body = rule(css, "body");
    expect(body).toMatch(/font-size:\s*var\(--text-body\)/);
    expect(body).toMatch(/line-height:\s*var\(--leading-body\)/);
  });

  it("text-sm é o corpo e text-xs a legenda: as telas já existentes encolhem sem mudar classe", () => {
    expect(theme.fontSize.sm).toEqual(["var(--text-body)", { lineHeight: "var(--leading-body)" }]);
    expect(theme.fontSize.xs).toEqual(["var(--text-caption)", { lineHeight: "var(--leading-caption)" }]);
    // text-base (títulos de seção e abas) e text-lg ficam acima do corpo.
    expect(theme.fontSize.base).toEqual(["var(--text-title3)", { lineHeight: "var(--leading-title3)" }]);
    expect(theme.fontSize.lg).toEqual(["var(--text-title2)", { lineHeight: "var(--leading-title2)" }]);
  });

  it("nomes semânticos para a varredura das telas: body, callout, caption e títulos", () => {
    expect(theme.fontSize.body).toEqual(["var(--text-body)", { lineHeight: "var(--leading-body)" }]);
    expect(theme.fontSize.callout).toEqual(["var(--text-callout)", { lineHeight: "var(--leading-callout)" }]);
    expect(theme.fontSize.caption).toEqual(["var(--text-caption)", { lineHeight: "var(--leading-caption)" }]);
    expect(theme.fontSize.title3[0]).toBe("var(--text-title3)");
    expect(theme.fontSize.title2[0]).toBe("var(--text-title2)");
    expect(theme.fontSize.title1[0]).toBe("var(--text-title1)");
    expect(theme.fontSize["large-title"][0]).toBe("var(--text-large-title)");
  });
});
