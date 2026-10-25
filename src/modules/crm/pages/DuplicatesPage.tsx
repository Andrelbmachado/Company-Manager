import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Merge } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SortableHeader, nextSort, sortRows, type SortFilterColumn, type SortState } from "@/components/shared/table";
import { getDb } from "@/lib/db/client";
import { findDuplicateCustomers, mergeCustomers, type DuplicateGroup, type DuplicateReason } from "@/lib/crm/dedupe";
import { cn, formatDay } from "@/lib/utils";
import type { Customer } from "@/types";
import { ConfirmDialog, errorText } from "../components/Modal";
import { BTN_PRIMARY, CARD, LINK, TD, TH, TONE_CLASS } from "../components/ui";
import { useAudit, useCrmSession, useCustomerMap, useInvalidateCrm } from "../components/useCrm";

const REASON_LABELS: Record<DuplicateReason, string> = { documento: "Mesmo CNPJ/CPF", email: "Mesmo e-mail", telefone: "Mesmo telefone" };

// Tabela do grupo: o cabeçalho ordena (Fica e Mesclar são escolhas, não ordenam). Não há filtro: cadastro escondido
// continuaria marcado para mesclar sem aparecer na tela.
const GROUP_COLUMNS: SortFilterColumn<Customer>[] = [
  { key: "keep", header: "Fica", kind: "text", sortable: false, filterable: false },
  { key: "merge", header: "Mesclar", kind: "text", sortable: false, filterable: false },
  { key: "name", header: "Cliente", kind: "text", sortValue: (customer) => [customer.name, customer.trade_name].filter(Boolean).join(" ") },
  { key: "document", header: "Documento", kind: "text" },
  { key: "email", header: "E-mail", kind: "text" },
  { key: "phone", header: "Telefone", kind: "text" },
  { key: "created_at", header: "Cadastrado em", kind: "datetime" },
];

/** Clientes duplicados (mesmo documento, e-mail ou telefone): escolher o cadastro que fica e mesclar os outros nele. */
export default function DuplicatesPage() {
  const { companyId } = useCrmSession();
  const { map: customers, isLoading: loadingCustomers } = useCustomerMap();
  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ["duplicates", companyId],
    queryFn: async () => findDuplicateCustomers(await getDb(), companyId),
  });

  return (
    <div className="space-y-6">
      <div>
        <Link to="/crm" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Clientes</Link>
        <PageHeader
          className="pt-2"
          title="Clientes duplicados"
        />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{errorText(error)}</p>}
      {isLoading || loadingCustomers ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl bg-muted/30" />)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon={Merge} title="Nenhum duplicado encontrado" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{groups.length} grupo(s) para revisar</p>
          {groups.map((group) => (
            <DuplicateGroupCard key={[group.keep, ...group.merge].sort().join(":")} group={group} customers={customers} />
          ))}
        </div>
      )}
    </div>
  );
}

function DuplicateGroupCard({ group, customers }: { group: DuplicateGroup; customers: Map<string, Customer> }) {
  const { userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const ids = [group.keep, ...group.merge];
  const [sort, setSort] = useState<SortState | null>(null);
  const groupCustomers = useMemo(
    () => [group.keep, ...group.merge].map((id) => customers.get(id)).filter((customer): customer is Customer => !!customer),
    [group, customers],
  );
  const rows = useMemo(() => sortRows(groupCustomers, GROUP_COLUMNS, sort), [groupCustomers, sort]);
  const [keep, setKeep] = useState(group.keep);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group.merge));
  const [confirming, setConfirming] = useState(false);
  const mergeIds = ids.filter((id) => id !== keep && selected.has(id));
  const keepName = customers.get(keep)?.name ?? "o cadastro escolhido";

  const merge = useMutation({
    mutationFn: async () => {
      const result = await mergeCustomers(await getDb(), keep, mergeIds, userId);
      await audit("customer.merged", "customer", keep, `Cadastros mesclados em ${keepName}`, {
        newValue: { keep, merged: result.merged, names: mergeIds.map((id) => customers.get(id)?.name ?? id) },
      });
      return result;
    },
    onSuccess: () => {
      invalidate();
      setConfirming(false);
    },
  });

  function chooseKeep(id: string) {
    setKeep(id);
    // O que sai de "fica" volta a ser mesclado por padrão.
    setSelected((current) => new Set([...current, keep].filter((item) => item !== id)));
  }

  return (
    <section className={cn(CARD, "overflow-hidden")} aria-label={`Grupo de duplicados de ${customers.get(group.keep)?.name ?? "cliente"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {group.reasons.map((reason) => (
            <span key={reason} className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", TONE_CLASS.warning)}>{REASON_LABELS[reason]}</span>
          ))}
        </div>
        <button type="button" onClick={() => setConfirming(true)} disabled={mergeIds.length === 0 || merge.isPending} className={BTN_PRIMARY}>
          <Merge size={14} /> Mesclar {mergeIds.length} em “{keepName}”
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              {GROUP_COLUMNS.map((column) => (
                <SortableHeader
                  key={column.key}
                  label={column.header}
                  sortKey={column.key}
                  sort={sort}
                  onSort={(key) => setSort((current) => nextSort(current, key))}
                  sortable={column.sortable !== false}
                  className={cn(TH, "text-sm")}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((customer) => (
              <tr key={customer.id} className={cn(customer.id === keep && "bg-primary/5")}>
                <td className={TD}>
                  <input type="radio" name={`fica-${group.keep}`} checked={customer.id === keep} onChange={() => chooseKeep(customer.id)} aria-label={`Manter ${customer.name}`} />
                </td>
                <td className={TD}>
                  <input
                    type="checkbox"
                    disabled={customer.id === keep}
                    checked={customer.id !== keep && selected.has(customer.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(customer.id);
                        else next.delete(customer.id);
                        return next;
                      })
                    }
                    aria-label={`Mesclar ${customer.name}`}
                  />
                </td>
                <td className={TD}>
                  <Link to={`/crm/clientes/${customer.id}`} className={LINK}>{customer.name}</Link>
                  {customer.trade_name && <p className="text-xs text-muted-foreground">{customer.trade_name}</p>}
                </td>
                <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{customer.document ?? "—"}</td>
                <td className={cn(TD, "text-muted-foreground")}>{customer.email ?? "—"}</td>
                <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{customer.phone ?? "—"}</td>
                <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{formatDay(customer.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {merge.error && !confirming && <p role="alert" className="px-5 pb-3 text-sm text-destructive">{errorText(merge.error)}</p>}
      {confirming && (
        <ConfirmDialog
          title="Mesclar cadastros"
          message={
            <div className="space-y-2">
              <p>
                {mergeIds.map((id) => customers.get(id)?.name ?? id).join(", ")} {mergeIds.length > 1 ? "serão mesclados" : "será mesclado"} em <strong>{keepName}</strong>.
              </p>
              <p className="text-muted-foreground">Não dá para desfazer.</p>
            </div>
          }
          confirmLabel="Mesclar"
          busy={merge.isPending}
          error={errorText(merge.error)}
          onConfirm={() => merge.mutate()}
          onClose={() => setConfirming(false)}
        />
      )}
      <div className="sr-only" aria-live="polite">{merge.isSuccess ? "Cadastros mesclados." : ""}</div>
      {rows.length < ids.length && <p className="px-5 pb-3 text-xs text-muted-foreground">Recarregue a página: o grupo mudou.</p>}
    </section>
  );
}
