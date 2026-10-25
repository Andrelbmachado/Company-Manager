import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// design-system.html é a referência visual estática do app e "usa os tokens atuais" (AGENTS.md): quando o tema
// mudar em src/styles/globals.css ou as cores de estado em tailwind.config.js, a referência muda junto.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Variáveis CSS (`--nome: valor;`) dos blocos `:root` e `.dark`. */
function themeTokens(source: string): Record<":root" | ".dark", Record<string, string>> {
  const tokens = { ":root": {}, ".dark": {} } as Record<":root" | ".dark", Record<string, string>>;
  for (const [, selector, body] of source.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)) {
    for (const [, name, value] of body.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) {
      tokens[selector as ":root" | ".dark"][name] = value.trim();
    }
  }
  return tokens;
}

/** Cores de estado (`status: { danger: "#...", ... }`). */
function statusColors(source: string): Record<string, string> {
  const block = source.match(/status:\s*\{([^}]*)\}/)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/["']?([\w-]+)["']?\s*:\s*["'](#[0-9a-fA-F]{3,8})["']/g)].map(([, name, color]) => [name, color.toUpperCase()]));
}

describe("design-system.html", () => {
  it("tem os mesmos tokens claro e escuro do globals.css", () => {
    const app = themeTokens(read("src/styles/globals.css"));
    const reference = themeTokens(read("design-system.html"));
    expect(Object.keys(app[":root"]).length).toBeGreaterThan(20);
    expect(Object.keys(app[".dark"]).length).toBeGreaterThan(20);
    expect(reference).toEqual(app);
  });

  it("tem as mesmas cores de estado do tailwind.config.js", () => {
    const app = statusColors(read("tailwind.config.js"));
    expect(Object.keys(app)).toContain("neutral");
    expect(statusColors(read("design-system.html"))).toEqual(app);
  });
});
