// Disco e seletor de pasta das pastas de nuvem no app desktop (tauri-plugin-fs e tauri-plugin-dialog).
// capabilities/default.json libera ler (e gravar arquivo novo) nas pastas padrão do iCloud Drive, de
// ~/Library/CloudStorage (Google Drive, OneDrive, Dropbox) e nas pastas antigas na home; outra pasta só fica liberada
// quando a pessoa a escolhe no seletor (recursive: true), até fechar o app.
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, lstat, readDir, readFile, stat, writeFile, type FileInfo } from "@tauri-apps/plugin-fs";
import type { CloudEnv, CloudFileInfo, CloudFs } from "./cloudFolders";

const info = (value: FileInfo): CloudFileInfo => ({
  isDirectory: value.isDirectory,
  isFile: value.isFile,
  isSymlink: value.isSymlink,
  size: value.size,
  mtime: value.mtime ?? null,
});

export const tauriCloudFs: CloudFs = {
  async readDir(path) {
    return (await readDir(path)).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory, isFile: entry.isFile, isSymlink: entry.isSymlink }));
  },
  async stat(path) {
    return info(await stat(path));
  },
  async lstat(path) {
    return info(await lstat(path));
  },
  async exists(path) {
    return exists(path);
  },
  async readFile(path) {
    return readFile(path);
  },
  async writeNewFile(path, bytes) {
    await writeFile(path, bytes, { createNew: true });
  },
};

export const tauriCloudEnv: CloudEnv = {
  async homeDir() {
    return homeDir();
  },
  async pickFolder({ defaultPath, title }) {
    const chosen = await open({ directory: true, recursive: true, multiple: false, ...(defaultPath ? { defaultPath } : {}), ...(title ? { title } : {}) });
    return typeof chosen === "string" ? chosen : null;
  },
};
