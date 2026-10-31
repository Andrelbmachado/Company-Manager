// Configurações > E-mails importantes: os avisos importantes (comunicados do RH marcados como importantes) que ainda
// não saíram por e-mail. O app não guarda senha de e-mail: cada aviso abre no app de e-mail da pessoa com todos em Cco
// (src/lib/notifications/email.ts) e sai da fila; "Descartar" tira sem enviar. Só para quem publica comunicados.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { getDb } from "@/lib/db/client";
import { buildMailto, discardEmails, emailOutboxQueryKey, markEmailsSent, pendingEmailGroups } from "@/lib/notifications/email";
import { formatDay } from "@/lib/utils";

export function EmailOutboxCard() {
  const session = useRequiredSession();
  const allowed = usePermission("create", "hr_admin");
  const companyId = session.company.id;
  const qc = useQueryClient();
  const key = emailOutboxQueryKey(companyId);
  const { data: groups = [], isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => pendingEmailGroups(await getDb(), companyId),
    enabled: allowed,
  });
  const done = useMutation({
    mutationFn: async ({ ids, sent }: { ids: string[]; sent: boolean }) => (sent ? markEmailsSent : discardEmails)(await getDb(), companyId, ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });

  if (!allowed) return null;
  return (
    <section aria-labelledby="email-outbox" className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Mail size={18} className="text-primary-text" />
        </div>
        <div>
          <h3 id="email-outbox" className="text-sm font-semibold">E-mails importantes</h3>
          <p className="text-xs text-muted-foreground">Avisos importantes saem pelo seu app de e-mail, com todos em cópia oculta.</p>
        </div>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível carregar a fila de e-mails.</p>}
      {!isLoading && !isError && groups.length === 0 && <p className="text-sm text-muted-foreground">Nenhum e-mail pendente.</p>}
      <ul className="divide-y rounded-lg border">
        {groups.map((group) => (
          <li key={group.ids[0]} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{group.subject}</p>
              <p className="text-xs text-muted-foreground">
                {group.recipients.length} {group.recipients.length === 1 ? "destinatário" : "destinatários"} · {formatDay(group.created_at)}
              </p>
            </div>
            <a
              href={buildMailto(group)}
              onClick={() => done.mutate({ ids: group.ids, sent: true })}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Enviar pelo app de e-mail
            </a>
            <button type="button" onClick={() => done.mutate({ ids: group.ids, sent: false })} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">
              Descartar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
