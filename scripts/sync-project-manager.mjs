#!/usr/bin/env node
// Copia o módulo do Project Manager (fonte da verdade) para dentro do Company Manager:
//   <Project-Manager>/src/module  ->  src/modules/project-manager
// O módulo só importa pacotes que o Company Manager já tem (react, react-router-dom, @tanstack/react-query,
// lucide-react, zod, uuid, clsx, tailwind-merge) e usa imports relativos, então roda aqui sem adaptação.
// Uso: node scripts/sync-project-manager.mjs [--check]   (--check só compara e sai com erro se estiver desatualizado)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.env.PROJECT_MANAGER_DIR ?? join(homedir(), "Documents/Trabalho/Sites/Project-Manager"), "src/module");
const target = resolve(here, "../src/modules/project-manager");
const check = process.argv.includes("--check");
const NOTE = `Copiado de Project-Manager/src/module por scripts/sync-project-manager.mjs. NÃO edite aqui:\naltere no Project Manager e rode \`npm run sync:project-manager\`.\n`;

if (!existsSync(source)) {
  console.error(`Project Manager não encontrado em ${source} (defina PROJECT_MANAGER_DIR).`);
  process.exit(1);
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith(".test.ts") || entry.name === "VENDORED.md" ? [] : [path];
  });
}

const wanted = new Map(files(source).map((path) => [relative(source, path), readFileSync(path)]));
const current = existsSync(target) ? new Map(files(target).map((path) => [relative(target, path), readFileSync(path)])) : new Map();
const differs = wanted.size !== current.size || [...wanted].some(([name, content]) => !current.get(name)?.equals(content));

if (check) {
  console.log(differs ? "DESATUALIZADO: rode npm run sync:project-manager" : "src/modules/project-manager está em dia com o Project Manager.");
  process.exit(differs ? 1 : 0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.endsWith(".test.ts") && !(statSync(path).isFile() && path.endsWith("VENDORED.md")) });
writeFileSync(join(target, "VENDORED.md"), NOTE);
console.log(`Sincronizado: ${wanted.size} arquivos de ${source} para ${relative(resolve(here, ".."), target)}`);
