import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FolderOpen, RefreshCw, Unplug, X } from "lucide-react";
import { EditableTable, type EditableColumn } from "@/components/shared/EditableTable";
import { confirmAction } from "@/lib/confirm";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import {
  CLOUD_PROVIDER_ORDER,
  CLOUD_PROVIDERS,
  CloudFolderError,
  canManageCloudFolder,
  connectCloudFolder,
  describeCloudError,
  disconnectCloudFolder,
  getCloudEnv,
  normalizeLocalPath,
  pickerStartPath,
  scanCloudFolders,
  updateCloudFolder,
  type CloudFolderPatch,
  type DetectedCloudFolder,
} from "@/lib/files/cloudFolders";
import type { CloudFolder, CloudProvider, Role } from "@/types";
import { FolderIcon } from "./FolderIcon";

interface CloudConnectPanelProps {
  companyId: string;
  role: Role;
  userId: string;
  /** Pastas conectadas que a pessoa vê. */
  folders: CloudFolder[];
  /** create em documents: conectar pasta nova. Sem ela, o painel só lista. */
  canConnect: boolean;
  onClose: () => void;
  /** Recarrega a lista de pastas conectadas. */
  onChanged: () => Promise<unknown>;
}

const SERVICES: CloudProvider[] = ["icloud", "gdrive", "onedrive", "dropbox"];
const BUTTON = "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60";
const sameFolder = (a: string, b: string) => a.normalize("NFC").toLocaleLowerCase("pt-BR") === b.normalize("NFC").toLocaleLowerCase("pt-BR");

const COLUMNS: EditableColumn<CloudFolder>[] = [
  { key: "label", header: "Nome", kind: "text", required: true, placeholder: "Ex.: Contratos no iCloud" },
  { key: "provider", header: "Serviço", kind: "select", options: CLOUD_PROVIDER_ORDER.map((provider) => ({ value: provider, label: CLOUD_PROVIDERS[provider].label })) },
  { key: "local_path", header: "Pasta no Mac", kind: "text", required: true, placeholder: "/Users/voce/Library/CloudStorage/..." },
];

/**
 * Conectar nuvem sem login de terceiros: acha as pastas que o iCloud Drive, o Google Drive, o OneDrive e o Dropbox
 * sincronizam no Mac, abre o seletor de pasta já nelas e grava a escolhida em cloud_folders. O que não está instalado
 * vem com o passo a passo. Abaixo, as pastas conectadas, editáveis na própria tabela.
 */
export function CloudConnectPanel({ companyId, role, userId, folders, canConnect, onClose, onChanged }: CloudConnectPanelProps) {
  const desktop = isTauriRuntime();
  const actor = { role, userId };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "error"; text: string } | null>(null);

  const scan = useQuery({
    queryKey: ["documents", companyId, "cloud-detect"],
    queryFn: async () => {
      const home = await getCloudEnv().homeDir();
      return { home, detected: await scanCloudFolders(home) };
    },
    enabled: desktop && canConnect,
    retry: false,
    staleTime: 0,
  });
  const home = scan.data?.home ?? null;
  const detected: DetectedCloudFolder[] = scan.data?.detected ?? [];

  async function choose(startPath: string, title: string) {
    setMessage(null);
    const env = getCloudEnv();
    const chosen = await env.pickFolder({ defaultPath: startPath, title });
    if (!chosen) return;
    setBusy(true);
    try {
      const folder = await connectCloudFolder(await getDb(), companyId, actor, { localPath: chosen, home: home ?? (await env.homeDir()) });
      await emit({
        type: "documents.cloud_connected",
        companyId,
        actorId: userId,
        entityType: "cloud_folder",
        entityId: folder.id,
        title: `Pasta de nuvem conectada: ${folder.label}`,
        module: "documents",
        metadata: { provider: folder.provider, local_path: folder.local_path },
      });
      setMessage({ kind: "status", text: `“${folder.label}” conectada: aparece junto das pastas dos Documentos.` });
      await onChanged();
    } catch (error) {
      // Pasta fora das padrão perde o acesso ao reabrir o app; escolhê-la de novo no seletor já devolve o acesso.
      const already = error instanceof CloudFolderError && error.code === "duplicate" ? connectedAs(chosen) : null;
      if (already) setMessage({ kind: "status", text: `“${already.label}” já estava conectada: o acesso a ela foi liberado de novo.` });
      else setMessage({ kind: "error", text: describeCloudError(error) });
    } finally {
      setBusy(false);
    }
  }

  /** Pasta conectada (das que a pessoa vê) no caminho escolhido. */
  function connectedAs(localPath: string): CloudFolder | null {
    let normalized: string;
    try {
      normalized = normalizeLocalPath(localPath);
    } catch {
      return null;
    }
    return folders.find((folder) => sameFolder(folder.local_path, normalized)) ?? null;
  }

  async function disconnect(folder: CloudFolder) {
    const ok = await confirmAction(`Desconectar “${folder.label}”? Os arquivos continuam na pasta do Mac e na nuvem.`, { title: "Desconectar pasta", okLabel: "Desconectar" });
    if (!ok) return;
    try {
      await disconnectCloudFolder(await getDb(), companyId, actor, folder.id);
      await emit({ type: "documents.cloud_disconnected", companyId, actorId: userId, entityType: "cloud_folder", entityId: folder.id, title: `Pasta de nuvem desconectada: ${folder.label}`, module: "documents" });
      setMessage({ kind: "status", text: `“${folder.label}” desconectada.` });
      await onChanged();
    } catch (error) {
      setMessage({ kind: "error", text: describeCloudError(error) });
    }
  }

  async function save({ updated, created }: { updated: (Partial<CloudFolder> & { id: string })[]; created: Partial<CloudFolder>[] }) {
    const db = await getDb();
    try {
      for (const { id, ...patch } of updated) await updateCloudFolder(db, companyId, actor, id, patch as CloudFolderPatch);
      for (const row of created) await connectCloudFolder(db, companyId, actor, { localPath: String(row.local_path ?? ""), label: row.label ?? null, provider: row.provider ?? null, home });
    } catch (error) {
      throw new Error(describeCloudError(error));
    }
  }

  const isConnected = (path: string) => folders.some((folder) => sameFolder(folder.local_path, path));

  return (
    <section aria-label="Conectar nuvem" className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">Conectar nuvem</h2>
        <button type="button" onClick={onClose} aria-label="Fechar Conectar nuvem" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
      </div>

      {!desktop ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Disponível no app desktop.
        </p>
      ) : (
        <>
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" : "flex items-center gap-2 rounded-md border px-3 py-2 text-sm"}>
              {message.kind === "status" && <CheckCircle2 size={15} aria-hidden="true" />} {message.text}
            </p>
          )}
          {!canConnect ? (
            <p className="text-sm text-muted-foreground">Sem permissão para conectar.</p>
          ) : scan.isLoading ? (
            <p className="text-sm text-muted-foreground">Procurando as pastas de nuvem deste Mac…</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {SERVICES.map((provider) => {
                const items = detected.filter((item) => item.provider === provider);
                const info = CLOUD_PROVIDERS[provider];
                return (
                  <li key={provider} className="flex flex-wrap items-start gap-3 px-3 py-3">
                    <FolderIcon cloud className="h-6 w-8" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{info.label}</p>
                      {items.length === 0 ? (
                        <p className="mt-0.5 text-xs text-muted-foreground" title={info.install}>Não encontrado neste Mac.</p>
                      ) : (
                        <ul className="mt-1 space-y-2">
                          {items.map((item) => (
                            <li key={item.path} className="flex flex-wrap items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm">{item.label}{isConnected(item.path) && <span className="ml-2 text-xs text-muted-foreground">(conectada)</span>}</p>
                                <p className="truncate text-xs text-muted-foreground" title={item.path}>{item.path}</p>
                              </div>
                              <button type="button" disabled={busy} onClick={() => void choose(item.path, `Conectar pasta: ${item.label}`)} aria-label={`Escolher pasta: ${item.label}`} className={BUTTON}>
                                <FolderOpen size={14} aria-hidden="true" /> Escolher pasta
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {items.length === 0 && (
                      <button type="button" onClick={() => void scan.refetch()} disabled={scan.isFetching} className={BUTTON}>
                        <RefreshCw size={14} aria-hidden="true" /> Procurar de novo
                      </button>
                    )}
                  </li>
                );
              })}
              <li className="flex flex-wrap items-start gap-3 px-3 py-3">
                <FolderIcon className="h-6 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{CLOUD_PROVIDERS.outro.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Qualquer pasta do Mac.</p>
                </div>
                <button
                  type="button"
                  disabled={busy || !home}
                  onClick={() => home && void choose(pickerStartPath(home, "outro", detected), "Conectar outra pasta")}
                  aria-label={`Escolher pasta: ${CLOUD_PROVIDERS.outro.label}`}
                  className={BUTTON}
                >
                  <FolderOpen size={14} aria-hidden="true" /> Escolher pasta
                </button>
              </li>
            </ul>
          )}
          {scan.error ? <p role="alert" className="text-sm text-destructive">{describeCloudError(scan.error)}</p> : null}

          <EditableTable<CloudFolder>
            resource="documents"
            title={<span className="text-sm font-semibold">Pastas conectadas</span>}
            label="Pastas de nuvem conectadas"
            rows={folders}
            columns={COLUMNS}
            newRow={() => ({ provider: "outro" })}
            onSave={save}
            onRefresh={onChanged}
            emptyMessage="Nenhuma pasta conectada"
            rowActions={(folder) =>
              canManageCloudFolder(role, userId, folder) ? (
                <button type="button" onClick={() => void disconnect(folder)} aria-label={`Desconectar ${folder.label}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Unplug size={13} aria-hidden="true" /> Desconectar
                </button>
              ) : null
            }
          />
        </>
      )}
    </section>
  );
}
