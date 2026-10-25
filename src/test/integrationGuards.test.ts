// Travas da integração dos branches (Tarefa 0): nenhum TODO(integração) sobrando, nenhuma confirmação pelo
// window.confirm (no WebView do desktop ele não espera a resposta: a exclusão acontecia sem perguntar; use
// confirmAction de src/lib/confirm.ts, o ConfirmDialog do CRM ou o botão de dois passos do Financeiro) e nenhum
// ImportExportButtons de cadastro sem importador (os botões ficariam sempre desativados na tela). Depois do redesign
// (Fase C), nenhuma tela usa CrudDialog nem DetailDrawer: edição e detalhe ficam na própria página.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "@/lib/importexport/registry";

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

  it("ImportExportButtons só aparece com cadastro registrado no motor de importação", () => {
    const unregistered: string[] = [];
    for (const file of files) {
      for (const match of file.text.matchAll(/<ImportExportButtons\s+entity=(\{[^}]*\}|"[^"]*")/g)) {
        const keys = [...match[1].matchAll(/"([a-z_]+)"/g)].map((key) => key[1]);
        for (const key of keys) if (!registry[key]) unregistered.push(`${file.path}: ${key}`);
      }
    }
    expect(unregistered).toEqual([]);
  });

  it("nenhuma tela edita ou mostra registro em modal de formulário ou gaveta lateral (redesign: tudo no próprio lugar)", () => {
    const offenders = files.filter((file) => file.path.startsWith(`modules${sep}`) && /from\s+["'][^"']*\/(CrudDialog|DetailDrawer)["']/.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
