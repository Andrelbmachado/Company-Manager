// Tamanho mínimo da janela do app desktop: 1/5 da largura e 1/3 da altura do monitor atual (pedido do André),
// calculado no setup do Tauri (src-tauri/src/window_size.rs, com testes em Rust). O tauri.conf.json fica com o piso,
// para a janela nunca nascer com um mínimo maior que o calculado.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

interface WindowConf { minWidth?: number; minHeight?: number; width: number; height: number }
const windows = (JSON.parse(read("src-tauri/tauri.conf.json")) as { app: { windows: WindowConf[] } }).app.windows;
const rust = read("src-tauri/src/window_size.rs");
const lib = read("src-tauri/src/lib.rs");

const floor = (name: string) => Number(rust.match(new RegExp(`const ${name}: f64 = ([\\d.]+);`))?.[1]);

describe("tamanho mínimo da janela", () => {
  it("window_size.rs divide o monitor por 5 (largura) e por 3 (altura), com piso", () => {
    expect(floor("MIN_WIDTH_FLOOR")).toBeGreaterThan(0);
    expect(floor("MIN_HEIGHT_FLOOR")).toBeGreaterThan(0);
    expect(rust).toMatch(/\/ 5\.0/);
    expect(rust).toMatch(/\/ 3\.0/);
  });

  it("o tauri.conf.json usa o piso como mínimo (o setup sobe para 1/5 × 1/3 do monitor)", () => {
    expect(windows).toHaveLength(1);
    expect(windows[0].minWidth).toBe(floor("MIN_WIDTH_FLOOR"));
    expect(windows[0].minHeight).toBe(floor("MIN_HEIGHT_FLOOR"));
    // Um monitor pequeno (1280 × 800) já cabe: o piso não impede chegar a 1/5 × 1/3 dele.
    expect(floor("MIN_WIDTH_FLOOR")).toBeLessThanOrEqual(1280 / 5);
    expect(floor("MIN_HEIGHT_FLOOR")).toBeLessThanOrEqual(800 / 3);
  });

  it("o lib.rs aplica o mínimo no setup e quando a janela muda de monitor", () => {
    expect(lib).toMatch(/^mod window_size;/m);
    expect(lib).toMatch(/\.setup\(\|app\| \{[\s\S]*window_size::apply_to_main_window\(app\)/);
    expect(lib).toMatch(/\.on_window_event\(window_size::on_window_event\)/);
  });
});
