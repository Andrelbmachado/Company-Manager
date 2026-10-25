import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { IconButton, TABLE_ICONS } from "@/components/shared/table";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { getDb } from "@/lib/db/client";
import { confirmAction } from "@/lib/confirm";
import { emit } from "@/lib/events/bus";
import { AREA_PROFILES, AREA_PROFILE_LABELS, LABEL_DEFS, MAX_LABEL_LENGTH, labelFor, type AreaProfile } from "@/lib/labels/profiles";
import { loadAreaLabels, saveAreaLabels, type AreaLabelChanges } from "@/lib/labels/store";
import { areaLabelsQueryKey } from "@/lib/labels/useLabel";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

const NO_PERMISSION = "Só CEO e Administração mudam a área da empresa e os rótulos.";
const BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const INPUT = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Configurações > Área da empresa: a área (TI, advocacia, serviços, comércio ou personalizado) define os rótulos de
 * cards, gráficos e módulos; a tabela mostra cada rótulo e deixa sobrescrever no próprio lugar (Editar → Salvar).
 * Célula vazia = texto da área. Gravar exige `edit` em `settings` (também conferido em saveAreaLabels).
 */
export default function AreaProfilePage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const canEdit = usePermission("edit", "settings");
  const qc = useQueryClient();
  const queryKey = areaLabelsQueryKey(companyId);
  const settings = useQuery({ queryKey, queryFn: async () => loadAreaLabels(await getDb(), companyId) });
  const [drafts, setDrafts] = useState<Record<string, string> | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const profile: AreaProfile = settings.data?.profile ?? "ti";
  const overrides = settings.data?.overrides ?? {};
  // Sem o que está gravado (carregando ou erro de leitura) não se edita: Salvar gravaria a tabela vazia por cima.
  const loaded = settings.data !== undefined;
  const editing = drafts !== null;
  const dirty = editing && LABEL_DEFS.some((def) => (drafts[def.key] ?? "").trim() !== (overrides[def.key] ?? ""));

  const save = useMutation({
    mutationFn: async (changes: AreaLabelChanges) => {
      const saved = await saveAreaLabels(await getDb(), companyId, { role: session.membership.role as Role, userId: session.user.id }, changes);
      await emit({
        type: "settings.area_labels_updated",
        companyId,
        actorId: session.user.id,
        entityType: "company",
        entityId: companyId,
        title: changes.profile ? `Área da empresa: ${AREA_PROFILE_LABELS[changes.profile]}` : "Rótulos da área da empresa atualizados",
        module: "settings",
      });
      return saved;
    },
    onSuccess: (saved, changes) => {
      qc.setQueryData(queryKey, saved);
      void qc.invalidateQueries({ queryKey });
      if (changes.overrides !== undefined) setDrafts(null);
      setStatus(changes.profile ? "Área salva." : "Rótulos salvos.");
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : "Não foi possível salvar."),
  });

  function startEditing() {
    setStatus(null);
    setDrafts({ ...overrides });
  }

  function saveDrafts() {
    if (!drafts) return;
    // Texto igual ao da área não vira sobrescrita (se a área mudar depois, o rótulo acompanha).
    const next: Record<string, string> = {};
    for (const def of LABEL_DEFS) {
      const text = (drafts[def.key] ?? "").trim();
      if (text && text !== labelFor(def.key, profile, {})) next[def.key] = text;
    }
    save.mutate({ overrides: next });
  }

  async function refresh() {
    if (dirty && !(await confirmAction("Há rótulos alterados e não salvos. Descartar as alterações e atualizar?", { okLabel: "Descartar" }))) return;
    setDrafts(null);
    setStatus(null);
    await settings.refetch();
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Área da empresa" description="A área define os nomes de cards, gráficos e módulos. Ajuste qualquer rótulo na tabela." />

      <div className="rounded-xl border bg-card p-5">
        <label className="flex max-w-sm flex-col gap-1 text-xs font-medium">
          Área
          <select
            aria-label="Área da empresa"
            value={profile}
            disabled={!canEdit || save.isPending || !loaded}
            title={canEdit ? undefined : NO_PERMISSION}
            onChange={(event) => save.mutate({ profile: event.target.value as AreaProfile })}
            className={cn(INPUT, "font-normal disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {AREA_PROFILES.map((option) => (
              <option key={option} value={option}>{AREA_PROFILE_LABELS[option]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-base font-semibold">Rótulos</h2>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <button type="button" className={BUTTON} onClick={() => setDrafts({})}>
                  <RotateCcw size={14} /> Restaurar padrões
                </button>
                <IconButton label="Cancelar" icon={TABLE_ICONS.cancel} onClick={() => setDrafts(null)} />
                <IconButton label="Salvar" icon={TABLE_ICONS.save} variant="primary" disabled={save.isPending} onClick={saveDrafts} />
              </>
            ) : (
              <IconButton label="Editar" icon={TABLE_ICONS.edit} disabled={!canEdit || !loaded} title={canEdit ? undefined : NO_PERMISSION} onClick={startEditing} />
            )}
            <IconButton label="Atualizar" icon={TABLE_ICONS.refresh} onClick={() => void refresh()} />
          </div>
        </div>
        {status && <p role="status" className="px-4 pt-3 text-sm text-muted-foreground">{status}</p>}
        {settings.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando rótulos...</p>}
        {settings.isError && <p role="alert" className="p-4 text-sm text-destructive">Não foi possível ler os rótulos da empresa.</p>}
        {settings.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Onde aparece</th>
                  <th className="px-4 py-2 font-medium">Texto da área</th>
                  <th className="px-4 py-2 font-medium">Rótulo usado</th>
                </tr>
              </thead>
              <tbody>
                {LABEL_DEFS.map((def) => {
                  const areaText = labelFor(def.key, profile, {});
                  const draft = drafts?.[def.key] ?? "";
                  const changed = editing && draft.trim() !== (overrides[def.key] ?? "");
                  return (
                    <tr key={def.key} data-key={def.key} data-changed={changed ? "true" : undefined} className={cn("border-t", changed && "bg-muted/60")}>
                      <td className="px-4 py-2">
                        <span className="text-xs text-muted-foreground">{def.group} · </span>
                        {def.description}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{areaText}</td>
                      <td className="px-4 py-2">
                        {editing ? (
                          <input
                            aria-label={`Rótulo: ${def.description}`}
                            value={draft}
                            maxLength={MAX_LABEL_LENGTH}
                            placeholder={areaText}
                            onChange={(event) => setDrafts((current) => ({ ...(current ?? {}), [def.key]: event.target.value }))}
                            className={INPUT}
                          />
                        ) : (
                          <span className="font-medium">{labelFor(def.key, profile, overrides)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
