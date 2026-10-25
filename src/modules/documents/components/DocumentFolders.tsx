import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cloud } from "lucide-react";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { CLOUD_PROVIDERS, canConnectCloudFolder, canSeeCloudFolder, cloudFoldersQueryKey, listCloudFolders } from "@/lib/files/cloudFolders";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { CloudConnectPanel } from "./CloudConnectPanel";
import { CloudFolderBrowser } from "./CloudFolderBrowser";
import { FolderBrowser } from "./FolderBrowser";
import { FolderIcon } from "./FolderIcon";

interface DocumentFoldersProps {
  role: Role;
  companyId: string;
  userId: string;
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Aba Pastas: pastas internas (FolderBrowser) e, ao lado delas na raiz, as pastas de nuvem conectadas, que abrem no
 * CloudFolderBrowser. As pastas de nuvem só existem no app desktop (no navegador o painel só explica).
 */
export function DocumentFolders({ role, companyId, userId, canUpload, canEdit, canDelete }: DocumentFoldersProps) {
  const desktop = isTauriRuntime();
  const [openId, setOpenId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const canConnect = canConnectCloudFolder(role);

  const cloud = useQuery({
    queryKey: cloudFoldersQueryKey(companyId),
    queryFn: async () => listCloudFolders(await getDb(), companyId),
    enabled: desktop,
  });
  const visible = useMemo(() => (cloud.data ?? []).filter((folder) => canSeeCloudFolder(role, userId, folder)), [cloud.data, role, userId]);
  const open = visible.find((folder) => folder.id === openId) ?? null;

  if (open) {
    return <CloudFolderBrowser key={open.id} folder={open} role={role} companyId={companyId} userId={userId} canUpload={canUpload} onExit={() => setOpenId(null)} />;
  }

  const tiles = visible.map((folder) => ({
    key: `nuvem-${folder.id}`,
    name: folder.label,
    element: (
      <button
        type="button"
        data-cloud-folder={folder.label}
        onClick={() => setOpenId(folder.id)}
        title={folder.local_path}
        className="group min-h-[9rem] rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-full flex-col items-center justify-center">
          <FolderIcon cloud />
          <span className="mt-3 w-full truncate text-sm font-medium">{folder.label}</span>
          <span className="text-[11px] text-muted-foreground">{(CLOUD_PROVIDERS[folder.provider] ?? CLOUD_PROVIDERS.outro).label}</span>
        </span>
      </button>
    ),
  }));

  return (
    <FolderBrowser
      role={role}
      companyId={companyId}
      userId={userId}
      canUpload={canUpload}
      canEdit={canEdit}
      canDelete={canDelete}
      rootTiles={tiles}
      rootActions={
        canConnect || visible.length > 0 ? (
          <button
            type="button"
            onClick={() => setConnecting((value) => !value)}
            aria-expanded={connecting}
            className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted", connecting && "bg-muted")}
          >
            <Cloud size={14} aria-hidden="true" /> Conectar nuvem
          </button>
        ) : null
      }
      rootPanel={
        connecting ? (
          <CloudConnectPanel companyId={companyId} role={role} userId={userId} folders={visible} canConnect={canConnect} onClose={() => setConnecting(false)} onChanged={() => cloud.refetch()} />
        ) : null
      }
    />
  );
}
