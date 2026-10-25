// Travas da integração dos branches (Tarefa 0): nenhum TODO(integração) sobrando e nenhuma confirmação pelo
// window.confirm (no WebView do desktop ele não espera a resposta: a exclusão acontecia sem perguntar). Use
// confirmAction de src/lib/confirm.ts, o ConfirmDialog do CRM ou o botão de dois passos do Financeiro.
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

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

describe("integração dos branches", () => {
  it("não sobra TODO(integração) no código", () => {
    expect(files.filter((file) => file.text.includes("TODO(integração)")).map((file) => file.path)).toEqual([]);
  });

  it("confirmações não usam window.confirm (só o fallback do navegador em lib/confirm.ts)", () => {
    const offenders = files.filter((file) => file.path !== join("lib", "confirm.ts") && /\bwindow\.confirm\s*\(/.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
