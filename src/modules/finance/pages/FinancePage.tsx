import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { Button } from "@/components/ui/Button";
import { useEntityList, useUpdateEntity } from "@/hooks/useEntity";
import { usePermission } from "@/hooks/usePermission";
import { refLabel, type Row } from "@/lib/data/repository";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type Tab = "receivables" | "payables";

const isOverdue = (r: Row) =>
  !!r.due_date && ["aberta", "aprovada"].includes(String(r.status)) && String(r.due_date) < new Date().toISOString().slice(0, 10);

export default function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "payables" ? "payables" : "receivables";
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const { data: payables = [], isLoading: loadingPay } = useEntityList("payables");
  const { data: receivables = [], isLoading: loadingRec } = useEntityList("receivables");
  const updatePayable = useUpdateEntity("payables");
  const updateReceivable = useUpdateEntity("receivables");
  const canEditPay = usePermission("edit", "payables");
  const canEditRec = usePermission("edit", "receivables");

  const totalPayOpen = payables
    .filter((p) => ["aberta", "aprovada"].includes(String(p.status)))
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const totalRecOpen = receivables
    .filter((r) => r.status === "aberta")
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const balance = totalRecOpen - totalPayOpen;

  const isRec = tab === "receivables";
  const rows = (isRec ? receivables : payables).filter((r) =>
    matchesSearch(search, [r.description, r.ref_type, refLabel(r, "customer_id")])
  );

  const columns: Column<Row>[] = [
    {
      key: "desc",
      header: isRec ? "Cliente / referência" : "Descrição",
      cell: (r) =>
        isRec ? (
          <div>
            <p className="font-medium">{refLabel(r, "customer_id") || "Sem cliente"}</p>
            <p className="text-xs text-muted-foreground">{String(r.ref_type ?? "Manual")}</p>
          </div>
        ) : (
          <span className="font-medium">{String(r.description)}</span>
        ),
    },
    {
      key: "due_date",
      header: "Vencimento",
      cell: (r) => (
        <span className={cn("tabular-nums", isOverdue(r) ? "font-medium text-red-500" : "text-muted-foreground")}>
          {formatDate(r.due_date as string)}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={isOverdue(r) ? "vencida" : String(r.status)} /> },
    { key: "amount", header: "Valor", align: "right", cell: (r) => <span className="font-medium tabular-nums">{formatCurrency(Number(r.amount ?? 0))}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => {
        const settled = ["paga", "recebida", "cancelada"].includes(String(r.status));
        if (settled || !(isRec ? canEditRec : canEditPay)) return null;
        return (
          <Button
            size="sm"
            variant="ghost"
            data-testid="finance-settle"
            onClick={() =>
              isRec
                ? updateReceivable.mutate({ id: String(r.id), patch: { status: "recebida", received_at: new Date().toISOString() } })
                : updatePayable.mutate({ id: String(r.id), patch: { status: "paga", paid_at: new Date().toISOString() } })
            }
          >
            <CheckCircle2 size={14} />
            {isRec ? "Receber" : "Pagar"}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Contas a pagar e a receber"
        actions={
          <>
            <ImportExportActions entities={isRec ? ["receivables", "payables"] : ["payables", "receivables"]} />
            <NewButton entity={tab} onClick={() => setShowForm(true)} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard title="A receber (abertas)" value={formatCurrency(totalRecOpen)} icon={TrendingUp} iconClassName="bg-emerald-50 text-emerald-600" />
        <KpiCard title="A pagar (abertas)" value={formatCurrency(totalPayOpen)} icon={TrendingDown} iconClassName="bg-red-50 text-red-600" />
        <KpiCard
          title="Saldo projetado"
          value={formatCurrency(balance)}
          icon={Wallet}
          iconClassName={balance >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}
        />
      </div>

      <Toolbar count={rows.length}>
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Tipo de conta">
          {(["receivables", "payables"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`tab-${t}`}
              onClick={() => setParams({ tab: t }, { replace: true })}
              className={cn(
                "rounded-md px-4 py-1 text-sm font-medium transition-colors",
                tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "receivables" ? "A receber" : "A pagar"}
            </button>
          ))}
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar..." />
      </Toolbar>

      <DataTable
        testId={`${tab}-table`}
        columns={columns}
        rows={rows}
        getRowId={(r) => String(r.id)}
        isLoading={isRec ? loadingRec : loadingPay}
        empty={
          <EmptyState
            icon={isRec ? TrendingUp : TrendingDown}
            title={isRec ? "Nenhuma conta a receber" : "Nenhuma conta a pagar"}
          />
        }
      />

      <EntityFormDialog entity={tab} open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
