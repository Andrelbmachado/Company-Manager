import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { isTauri } from "@/lib/runtime";
import { listEntity } from "@/lib/data/repository";
import { toCsv } from "@/lib/csv";
import { saveTextFile } from "@/lib/data/importExport";
import { Button } from "@/components/ui/Button";
import { Download } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import {
  Users,
  Wrench,
  Package,
  Wallet,
  HeadphonesIcon,
  TrendingUp,
  FolderKanban,
  Archive,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface DashboardKpis {
  customers: number;
  openTickets: number;
  openWorkOrders: number;
  itemsBelowMin: number;
  openPayables: number;
  openReceivables: number;
  openProjects: number;
  activeCustodies: number;
}

async function fetchKpis(companyId: string): Promise<DashboardKpis> {
  if (!isTauri()) return fetchKpisFromStore(companyId);
  const db = await getDb();
  const [[cust], [tickets], [wo], [items], [pay], [rec], [proj], [cust2]] =
    await Promise.all([
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM customers WHERE company_id=? AND deleted_at IS NULL",
        [companyId]
      ),
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM tickets WHERE company_id=? AND status NOT IN ('resolvido','fechado') AND deleted_at IS NULL",
        [companyId]
      ),
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM work_orders WHERE company_id=? AND status NOT IN ('concluida','cancelada') AND deleted_at IS NULL",
        [companyId]
      ),
      db.select<[{ n: number }]>(
        `SELECT COUNT(*) as n FROM inventory_items i
         JOIN (SELECT item_id, SUM(quantity) qty FROM stock_balances WHERE company_id=? GROUP BY item_id) b ON b.item_id=i.id
         WHERE i.company_id=? AND b.qty < i.min_stock AND i.deleted_at IS NULL`,
        [companyId, companyId]
      ),
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM payables WHERE company_id=? AND status IN ('aberta','aprovada') AND deleted_at IS NULL",
        [companyId]
      ),
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM receivables WHERE company_id=? AND status='aberta' AND deleted_at IS NULL",
        [companyId]
      ),
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM projects WHERE company_id=? AND status IN ('planejado','andamento') AND deleted_at IS NULL",
        [companyId]
      ),
      db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM custodies WHERE company_id=? AND status='em_custodia' AND deleted_at IS NULL",
        [companyId]
      ),
    ]);

  return {
    customers: cust.n,
    openTickets: tickets.n,
    openWorkOrders: wo.n,
    itemsBelowMin: items.n,
    openPayables: pay.n,
    openReceivables: rec.n,
    openProjects: proj.n,
    activeCustodies: cust2.n,
  };
}

// Browser preview: same KPIs computed from the local store.
async function fetchKpisFromStore(companyId: string): Promise<DashboardKpis> {
  const [customers, tickets, wo, items, pay, rec, proj, cust] = await Promise.all(
    (["customers", "tickets", "work_orders", "inventory_items", "payables", "receivables", "projects", "custodies"] as const).map(
      (k) => listEntity(k, companyId)
    )
  );
  return {
    customers: customers.length,
    openTickets: tickets.filter((t) => !["resolvido", "fechado"].includes(String(t.status))).length,
    openWorkOrders: wo.filter((o) => !["concluida", "cancelada"].includes(String(o.status))).length,
    itemsBelowMin: items.filter((i) => Number(i.quantity ?? 0) < Number(i.min_stock ?? 0)).length,
    openPayables: pay.filter((p) => ["aberta", "aprovada"].includes(String(p.status))).length,
    openReceivables: rec.filter((r) => r.status === "aberta").length,
    openProjects: proj.filter((p) => ["planejado", "andamento"].includes(String(p.status))).length,
    activeCustodies: cust.filter((c) => c.status === "em_custodia").length,
  };
}

const KPI_LABELS: [keyof DashboardKpis, string][] = [
  ["customers", "Clientes"],
  ["openTickets", "Tickets abertos"],
  ["openWorkOrders", "OS em aberto"],
  ["openProjects", "Projetos ativos"],
  ["itemsBelowMin", "Itens abaixo do mínimo"],
  ["activeCustodies", "Custódias ativas"],
  ["openPayables", "Contas a pagar abertas"],
  ["openReceivables", "Contas a receber abertas"],
];

const WEEK_DATA = [
  { day: "Seg", os: 4, tickets: 7 },
  { day: "Ter", os: 6, tickets: 5 },
  { day: "Qua", os: 3, tickets: 9 },
  { day: "Qui", os: 8, tickets: 4 },
  { day: "Sex", os: 5, tickets: 6 },
  { day: "Sáb", os: 2, tickets: 2 },
  { day: "Dom", os: 1, tickets: 1 },
];

export default function DashboardPage() {
  const session = useRequiredSession();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-kpis", session.company.id],
    queryFn: () => fetchKpis(session.company.id),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Visão geral de ${session.company.name}`}
        actions={
          <Button
            disabled={!data}
            data-testid="export-button"
            onClick={() =>
              data &&
              saveTextFile(
                `indicadores-${new Date().toISOString().slice(0, 10)}.csv`,
                toCsv(["Indicador", "Valor"], KPI_LABELS.map(([k, label]) => [label, data[k]]))
              )
            }
          >
            <Download size={14} />
            Exportar indicadores
          </Button>
        }
      />

      {isLoading || !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Clientes" value={data.customers} icon={Users} iconClassName="bg-blue-50 text-blue-600" />
          <KpiCard title="Tickets abertos" value={data.openTickets} icon={HeadphonesIcon} iconClassName="bg-yellow-50 text-yellow-600" />
          <KpiCard title="OS em aberto" value={data.openWorkOrders} icon={Wrench} iconClassName="bg-orange-50 text-orange-600" />
          <KpiCard title="Projetos ativos" value={data.openProjects} icon={FolderKanban} iconClassName="bg-indigo-50 text-indigo-600" />
          <KpiCard title="Itens abaixo do mín." value={data.itemsBelowMin} icon={Package} iconClassName="bg-red-50 text-red-600" />
          <KpiCard title="Custódias ativas" value={data.activeCustodies} icon={Archive} iconClassName="bg-purple-50 text-purple-600" />
          <KpiCard title="A pagar (abertas)" value={data.openPayables} icon={Wallet} iconClassName="bg-rose-50 text-rose-600" />
          <KpiCard title="A receber (abertas)" value={data.openReceivables} icon={TrendingUp} iconClassName="bg-emerald-50 text-emerald-600" />
        </div>
      )}

      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">OS e Tickets — últimos 7 dias</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={WEEK_DATA} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid hsl(var(--border))",
              }}
            />
            <Bar dataKey="os" name="OS" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="tickets" name="Tickets" fill="hsl(var(--primary) / 0.4)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
