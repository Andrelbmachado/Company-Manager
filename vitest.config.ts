import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// Testes de lógica rodam em Node (SQLite real via better-sqlite3, ver src/test/sqlite.ts).
// Testes de componente (*.test.tsx) rodam em jsdom.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.{ts,tsx}"],
    // e2e/ é do Playwright; a cópia do Project Manager é testada no repositório de origem.
    exclude: ["node_modules/**", "dist/**", "e2e/**", "src-tauri/**", "src/modules/project-manager/**"],
  },
});
