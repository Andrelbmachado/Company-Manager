import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guarda a configuração do instalador macOS (DMG): se alguém mexer no tauri.conf.json ou no
// script sem querer, o teste avisa antes de um build release de vários minutos.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

interface TauriConf {
  version: string;
  productName: string;
  bundle: {
    active: boolean;
    category?: string;
    macOS?: {
      minimumSystemVersion?: string;
      signingIdentity?: string | null;
      dmg?: {
        windowSize?: { width: number; height: number };
        appPosition?: { x: number; y: number };
        applicationFolderPosition?: { x: number; y: number };
      };
    };
  };
}

const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json")) as TauriConf;
const pkg = JSON.parse(read("package.json")) as { version: string; scripts: Record<string, string> };

describe("empacotamento DMG (macOS)", () => {
  it("tauri.conf.json declara categoria, macOS mínimo, assinatura ad-hoc e layout do DMG", () => {
    expect(tauriConf.bundle.active).toBe(true);
    expect(tauriConf.bundle.category).toBe("Business");
    expect(tauriConf.bundle.macOS?.minimumSystemVersion).toBe("12.0");
    // "-" = assinatura ad-hoc: o .app abre no Apple Silicon sem conta Apple Developer
    // (o Gatekeeper ainda avisa até haver Developer ID + notarização).
    expect(tauriConf.bundle.macOS?.signingIdentity).toBe("-");
    const dmg = tauriConf.bundle.macOS?.dmg;
    expect(dmg?.windowSize).toEqual({ width: 660, height: 400 });
    expect(dmg?.appPosition).toEqual({ x: 180, y: 170 });
    expect(dmg?.applicationFolderPosition).toEqual({ x: 480, y: 170 });
  });

  it("versão é a mesma no tauri.conf.json, package.json e Cargo.toml (nome do DMG usa a do Tauri)", () => {
    const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];
    expect(tauriConf.version).toBe(pkg.version);
    expect(cargoVersion).toBe(pkg.version);
  });

  it("npm run dmg chama scripts/build-dmg.sh, que existe, é executável e tem sintaxe bash válida", () => {
    expect(pkg.scripts.dmg).toBe("scripts/build-dmg.sh");
    const script = path.join(ROOT, "scripts/build-dmg.sh");
    expect(statSync(script).mode & 0o111).not.toBe(0);
    expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
  });

  it("o script gera só o DMG, fora do iCloud, e deixa uma única cópia em dist-installers/", () => {
    const script = read("scripts/build-dmg.sh");
    expect(script).toMatch(/--bundles dmg/);
    expect(script).toMatch(/CARGO_TARGET_DIR="\$\{CARGO_TARGET_DIR:-\$HOME\/cm-target\}"/);
    expect(script).toMatch(/dist-installers/);
    // Regra 1 do plano: não sobra .app de build nem DMG duplicado.
    expect(script).toMatch(/rm -rf "\$BUNDLE_DIR\/macos\/\$\{APP_NAME\}\.app"/);
    expect(read(".gitignore")).toMatch(/^dist-installers\/$/m);
  });

  it("o script limpa flag 'hidden'/FinderInfo do app dentro do DMG e confere a assinatura em modo estrito", () => {
    const script = read("scripts/build-dmg.sh");
    // Checkout em pasta oculta no iCloud (worktree em .claude/) gera DMG com app "sujo" (FinderInfo no icon.icns);
    // o iCloud recoloca o flag na origem, então a limpeza tem de ser no app já dentro do DMG.
    expect(script).toMatch(/hdiutil convert -quiet "\$DMG" -format UDRW/);
    expect(script).toMatch(/chflags -R nohidden "\$MNT\/\$\{APP_NAME\}\.app"/);
    expect(script).toMatch(/xattr -dr com\.apple\.FinderInfo "\$MNT\/\$\{APP_NAME\}\.app"/);
    expect(script).toMatch(/-format UDZO/);
    expect(script).toMatch(/codesign --verify --deep --strict/);
  });
});
