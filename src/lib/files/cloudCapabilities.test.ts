// O escopo do Tauri tem de liberar as mesmas pastas que detectCloudFolders acha (senão a pasta aparece e não abre),
// e nas pastas de nuvem o app só lê, lista e cria arquivo novo: nunca renomeia, apaga ou copia por cima.
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOUD_STORAGE_RELATIVE, detectCloudFolders, ICLOUD_RELATIVE } from "./cloudFolders";

interface Permission {
  identifier: string;
  allow?: { path: string }[];
}

const file = fileURLToPath(new NodeURL("../../../src-tauri/capabilities/default.json", import.meta.url));
const capability = JSON.parse(readFileSync(file, "utf8")) as { permissions: (string | Permission)[] };
const scoped = new Map(capability.permissions.filter((item): item is Permission => typeof item === "object").map((item) => [item.identifier, (item.allow ?? []).map((entry) => entry.path)]));

const HOME = "/Users/ana";
/** Todas as raízes que a detecção conhece, com $HOME no lugar da home. */
const roots = (() => {
  const all = [
    `${HOME}/${ICLOUD_RELATIVE}`,
    `${HOME}/${CLOUD_STORAGE_RELATIVE}`,
    ...detectCloudFolders(HOME, (path) => !path.includes("CloudStorage"), () => []).map((item) => item.path),
  ];
  return [...new Set(all)].map((path) => path.replace(HOME, "$HOME"));
})();

describe("capabilities das pastas de nuvem", () => {
  it("as raízes conhecidas são iCloud, CloudStorage e as pastas antigas na home", () => {
    expect(roots.sort()).toEqual(["$HOME/Dropbox", "$HOME/Google Drive", "$HOME/Library/CloudStorage", "$HOME/Library/Mobile Documents/com~apple~CloudDocs", "$HOME/OneDrive"]);
  });

  it("libera ler, listar, stat, lstat, exists e gravar arquivo novo dentro de cada raiz", () => {
    for (const root of roots) {
      for (const permission of ["fs:allow-read-file", "fs:allow-read-dir", "fs:allow-stat", "fs:allow-lstat", "fs:allow-exists", "fs:allow-write-file"]) {
        expect(scoped.get(permission), `${permission} ${root}`).toContain(`${root}/**`);
      }
      for (const permission of ["fs:allow-read-dir", "fs:allow-stat", "fs:allow-lstat", "fs:allow-exists"]) {
        expect(scoped.get(permission), `${permission} ${root}`).toContain(root);
      }
    }
  });

  it("não libera renomear, apagar, copiar, mkdir nem gravar texto nas pastas de nuvem", () => {
    for (const permission of ["fs:allow-remove", "fs:allow-rename", "fs:allow-copy-file", "fs:allow-mkdir", "fs:allow-write-text-file"]) {
      expect((scoped.get(permission) ?? []).filter((path) => path.startsWith("$HOME")), permission).toEqual([]);
    }
  });
});
