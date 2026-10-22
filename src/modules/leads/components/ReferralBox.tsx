import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { formatMoney } from "@/lib/prospecting/contact";
import { REFERRAL_RULES, referralStatusFor, referredDiscount } from "@/lib/prospecting/referral";
import type { Lead } from "@/types";

interface ReferralBoxProps {
  lead: Lead;
  canEdit: boolean;
  /** Nomes para sugerir no campo (clientes e leads já cadastrados). */
  suggestions: string[];
  onSaved: (lead: Lead) => void;
}

/** Campo "indicado por" + status do benefício. Os benefícios só valem quando este lead fecha o negócio. */
export function ReferralBox({ lead, canEdit, suggestions, onSaved }: ReferralBoxProps) {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(lead.referred_by ?? "");
  const listId = `referral-names-${lead.id}`;
  const discount = referredDiscount(lead.estimated_setup);
  const dirty = draft.trim() !== (lead.referred_by ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const referredBy = draft.trim() || null;
      const status = referralStatusFor(lead.status, referredBy);
      await (await getDb()).execute("UPDATE leads SET referred_by=?, referral_status=?, updated_at=datetime('now') WHERE id=?", [referredBy, status, lead.id]);
      await emit({
        type: "lead.referral_changed",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "lead",
        entityId: lead.id,
        title: referredBy ? `Indicação registrada em ${lead.name}: indicado por ${referredBy}` : `Indicação removida de ${lead.name}`,
        module: "leads",
        oldValue: { referred_by: lead.referred_by ?? null },
        newValue: { referred_by: referredBy },
      });
      return { ...lead, referred_by: referredBy, referral_status: status };
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["leads", session.company.id] });
      onSaved(updated);
    },
  });

  const granted = lead.referral_status === "concedido";

  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Programa de indicação</h3>
      {save.isError && <p role="alert" className="text-sm font-medium text-status-danger dark:text-red-400">Não foi possível salvar: {save.error instanceof Error ? save.error.message : String(save.error)}</p>}
      <div className="mt-3 flex gap-2">
        <input
          list={listId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!canEdit}
          placeholder="Indicado por (nome de quem indicou)"
          aria-label="Indicado por"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <datalist id={listId}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist>
        {canEdit && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Salvar
          </button>
        )}
      </div>
      {lead.referred_by ? (
        <div className="mt-3 space-y-1.5 text-sm">
          <p>
            <span className={granted ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-amber-700 dark:text-amber-400"}>
              {granted ? "Benefício concedido" : "Benefício pendente"}
            </span>{" "}
            <span className="text-muted-foreground">{granted ? "o indicado fechou o negócio." : "só vale quando o indicado fechar (contrato assinado e pago)."}</span>
          </p>
          <p className="text-muted-foreground">
            Indicado: {REFERRAL_RULES.referredSetupDiscount * 100}% de desconto no setup, {formatMoney(discount)} sobre {formatMoney(lead.estimated_setup)}.
          </p>
          <p className="text-muted-foreground">
            Quem indicou ({lead.referred_by}): {REFERRAL_RULES.monthsPerClosed} mês grátis na mensalidade por indicado fechado, com bônus nos níveis da aba Indicações.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Sem indicação. Se este lead veio de alguém, registre quem indicou: os benefícios só valem se ele fechar.</p>
      )}
    </section>
  );
}
