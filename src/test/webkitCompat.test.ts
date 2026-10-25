// O app desktop roda no WebKit do próprio macOS (Tauri; mínimo macOS 12 no tauri.conf.json). Regex com lookbehind só
// existe a partir do Safari 16.4: num macOS 12 ou 13 sem essa atualização, a regex dá SyntaxError na hora de rodar (o
// build do Vite a troca por new RegExp) e a tela que a usa quebra inteira. Use lookahead ou outra forma.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "project-manager" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("compatibilidade com o WebKit do macOS 12", () => {
  it("nenhuma regex com lookbehind no código do app", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => /\(\?<[=!]/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
