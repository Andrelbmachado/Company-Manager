import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import { EditIcon } from "@/components/shared/table";
import { campaignNameProblem, CAMPAIGN_NAME_MAX, nextCampaignName } from "@/lib/prospecting/campaigns";
import type { ProspectingCampaign } from "@/types";

const FIELD = "h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const BUTTON = "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

interface CampaignBarProps {
  campaigns: ProspectingCampaign[];
  selected: ProspectingCampaign | null;
  onSelect: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  /** Grava a campanha nova (a página escolhe a criada). Erro lançado aparece no próprio campo. */
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
  loading?: boolean;
}

type Mode = { kind: "view" } | { kind: "create" | "rename"; name: string };

/** Seletor da prospecção + "Nova prospecção" e "Renomear", com o nome digitado no próprio lugar (sem diálogo). */
export function CampaignBar({ campaigns, selected, onSelect, canCreate, canEdit, onCreate, onRename, loading = false }: CampaignBarProps) {
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setMode({ kind: "view" });
    setError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode.kind === "view" || saving) return;
    const renaming = mode.kind === "rename" ? selected : null;
    if (mode.kind === "rename" && !renaming) return close();
    if (renaming && mode.name.trim() === renaming.name) return close();
    const problem = campaignNameProblem(mode.name, campaigns, renaming?.id);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      if (renaming) await onRename(renaming.id, mode.name);
      else await onCreate(mode.name);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  if (mode.kind !== "view") {
    const creating = mode.kind === "create";
    return (
      <form onSubmit={submit} className="flex flex-wrap items-start gap-2" noValidate>
        <div className="flex flex-col gap-1">
          <input
            aria-label={creating ? "Nome da nova prospecção" : "Nome da prospecção"}
            value={mode.name}
            maxLength={CAMPAIGN_NAME_MAX}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setMode({ ...mode, name: event.target.value });
              setError(null);
            }}
            onKeyDown={onKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "campaign-name-error" : undefined}
            className={`${FIELD} w-64`}
          />
          {error && <p id="campaign-name-error" role="alert" className="max-w-64 text-xs text-destructive">{error}</p>}
        </div>
        <button type="submit" disabled={saving} className={PRIMARY}>{creating ? "Criar" : "Salvar"}</button>
        <button type="button" disabled={saving} onClick={close} className={BUTTON}>Cancelar</button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Prospecção"
        value={selected?.id ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        disabled={campaigns.length === 0}
        className={`${FIELD} max-w-64 font-medium`}
      >
        {campaigns.length === 0 && <option value="">{loading ? "Carregando…" : "Nenhuma prospecção"}</option>}
        {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select>
      <button
        type="button"
        aria-label="Renomear prospecção"
        title={canEdit ? "Renomear prospecção" : "Sem permissão para renomear prospecções"}
        disabled={!canEdit || !selected}
        onClick={() => selected && setMode({ kind: "rename", name: selected.name })}
        className={`${BUTTON} px-2.5`}
      >
        <EditIcon size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        title={canCreate ? undefined : "Sem permissão para criar prospecções"}
        disabled={!canCreate}
        onClick={() => setMode({ kind: "create", name: nextCampaignName(campaigns) })}
        className={BUTTON}
      >
        <Plus size={15} /> Nova prospecção
      </button>
    </div>
  );
}
