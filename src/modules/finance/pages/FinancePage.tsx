import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Wallet, TrendingDown, TrendingUp } from "lucide-react";
import type { Payable, Receivable } from "@/types";

type Tab = "payables" | "receivables";

export default function FinancePage() {
  const session = useRequiredSession();
  const [tab, setTab] = useState<Tab>("receivables");

  const { data: payables = [], isLoading: loadingPay } = useQuery({
    queryKey: ["payables", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Payable[]>(
        "SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC",
        [session.company.id]
      );
    },
  });

  const { data: receivables = [], isLoading: loadingRec } = useQuery({
    queryKey: ["receivables", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Receivable[]>(
        "SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC",
        [session.company.id]
      );
    },
  });

  const totalPayOpen = payables
    .filter((p) => ["aberta", "aprovada"].includes(p.status))
    .reduce((s, p) => s + p.amount, 0);

  const totalRecOpen = receivables
    .filter((r) => r.status === "aberta")
    .reduce((s, r) => s + r.amount, 0);

  const balance = totalRecOpen - totalPayOpen;

  return (
    <div className="space-y-6">
      <PageHeader title="Financeiro" description="Contas a pagar e a receber" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="A receber (abertas)"
          value={formatCurrency(totalRecOpen)}
          icon={TrendingUp}
          iconClassName="bg-emerald-50 text-emerald-600"
        />
        <KpiCard
          title="A pagar (abertas)"
          value={formatCurrency(totalPayOpen)}
          icon={TrendingDown}
          iconClassName="bg-red-50 text-red-600"
        />
        <KpiCard
          title="Saldo projetado"
          value={formatCurrency(balance)}
          icon={Wallet}
          iconClassName={balance >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {(["receivables", "payables"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-background shadow-sm" : "hover:text-foreground text-muted-foreground"
            }`}
          >
            {t === "receivables" ? "A Receber" : "A Pagar"}
          </button>
        ))}
      </div>

      {tab === "receivables" && (
        loadingRec ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />)}</div>
        ) : receivables.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Nenhuma conta a receber" />
        ) : (
          <FinanceTable rows={receivables.map((r) => ({ id: r.id, desc: r.ref_type ? `${r.ref_type} #${r.ref_id ?? ""}` : "Manual", amount: r.amount, due: r.due_date, status: r.status }))} />
        )
      )}

      {tab === "payables" && (
        loadingPay ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />)}</div>
        ) : payables.length === 0 ? (
          <EmptyState icon={TrendingDown} title="Nenhuma conta a pagar" />
        ) : (
          <FinanceTable rows={payables.map((p) => ({ id: p.id, desc: p.description, amount: p.amount, due: p.due_date, status: p.status }))} />
        )
      )}
    </div>
  );
}

function FinanceTable({ rows }: { rows: { id: string; desc: string; amount: number; due?: string | null; status: string }[] }) {
  return (
    <div className="rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Descrição</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Valor</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vencimento</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3 font-medium">{r.desc}</td>
              <td className="px-4 py-3">{formatCurrency(r.amount)}</td>
              <td className="px-4 py-3 text-muted-foreground">{r.due ? formatDate(r.due) : "—"}</td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
