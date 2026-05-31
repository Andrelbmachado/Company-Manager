import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { can, hasFullTicketAccess, ROLE_LABELS } from "@/lib/permissions/rbac";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard, type KpiTimelinePoint } from "@/components/shared/KpiCard";
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
  ReferenceLine,
} from "recharts";
import type { Role } from "@/types";

interface DashboardKpis {
  customers: number;
  openOpportunities: number;
  openTickets: number;
  openWorkOrders: number;
  itemsBelowMin: number;
  openPayables: number;
  openReceivables: number;
  openProjects: number;
  activeCustodies: number;
}

async function fetchKpis(companyId: string, role: Role, userId: string): Promise<DashboardKpis> {
  const db = await getDb();
  const count = (resource: Parameters<typeof can>[2], query: string, values: unknown[]) => {
    return can(role, "view", resource)
      ? db.select<[{ n: number }]>(query, values)
      : Promise.resolve([{ n: 0 }] as [{ n: number }]);
  };
  const [[cust], [opps], [tickets], [wo], [items], [pay], [rec], [proj], [cust2]] =
    await Promise.all([
      count(
        "customers",
        "SELECT COUNT(*) as n FROM customers WHERE company_id=? AND deleted_at IS NULL",
        [companyId]
      ),
      count(
        "opportunities",
        "SELECT COUNT(*) as n FROM opportunities WHERE company_id=? AND status='open' AND deleted_at IS NULL",
        [companyId]
      ),
      count(
        "tickets",
        `SELECT COUNT(*) as n FROM tickets WHERE company_id=? ${hasFullTicketAccess(role) ? "" : "AND opened_by=?"} AND status NOT IN ('resolvido','fechado') AND deleted_at IS NULL`,
        hasFullTicketAccess(role) ? [companyId] : [companyId, userId]
      ),
      count(
        "work_orders",
        "SELECT COUNT(*) as n FROM work_orders WHERE company_id=? AND status NOT IN ('concluida','cancelada') AND deleted_at IS NULL",
        [companyId]
      ),
      count(
        "inventory",
        `SELECT COUNT(*) as n FROM inventory_items i
         JOIN (SELECT item_id, SUM(quantity) qty FROM stock_balances WHERE company_id=? GROUP BY item_id) b ON b.item_id=i.id
         WHERE i.company_id=? AND b.qty < i.min_stock AND i.deleted_at IS NULL`,
        [companyId, companyId]
      ),
      count(
        "payables",
        "SELECT COUNT(*) as n FROM payables WHERE company_id=? AND status IN ('aberta','aprovada') AND deleted_at IS NULL",
        [companyId]
      ),
      count(
        "receivables",
        "SELECT COUNT(*) as n FROM receivables WHERE company_id=? AND status='aberta' AND deleted_at IS NULL",
        [companyId]
      ),
      count(
        "projects",
        "SELECT COUNT(*) as n FROM projects WHERE company_id=? AND status IN ('planejado','andamento') AND deleted_at IS NULL",
        [companyId]
      ),
      count(
        "custody",
        "SELECT COUNT(*) as n FROM custodies WHERE company_id=? AND status='em_custodia' AND deleted_at IS NULL",
        [companyId]
      ),
    ]);

  return {
    customers: cust.n,
    openOpportunities: opps.n,
    openTickets: tickets.n,
    openWorkOrders: wo.n,
    itemsBelowMin: items.n,
    openPayables: pay.n,
    openReceivables: rec.n,
    openProjects: proj.n,
    activeCustodies: cust2.n,
  };
}

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
  const role = session.membership.role as Role;
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-kpis", session.company.id, role, session.user.id],
    queryFn: () => fetchKpis(session.company.id, role, session.user.id),
    refetchInterval: 30_000,
  });
  const cards = data ? [
    { resource: "customers", title: "Clientes", value: data.customers, icon: Users, iconClassName: "bg-blue-50 text-blue-600", timeline: monthly(data.customers, [0.74, 0.82, 0.91, 1]) },
    { resource: "opportunities", title: "Oportunidades abertas", value: data.openOpportunities, icon: TrendingUp, iconClassName: "bg-cyan-50 text-cyan-600", timeline: monthly(data.openOpportunities, [0.5, 0.75, 0.62, 1]) },
    { resource: "tickets", title: "Tickets abertos", value: data.openTickets, icon: HeadphonesIcon, iconClassName: "bg-yellow-50 text-yellow-600", timeline: monthly(data.openTickets, [0.68, 1.15, 0.84, 1]) },
    { resource: "work_orders", title: "OS em aberto", value: data.openWorkOrders, icon: Wrench, iconClassName: "bg-orange-50 text-orange-600", timeline: monthly(data.openWorkOrders, [0.7, 0.86, 1.12, 1]) },
    { resource: "projects", title: "Projetos ativos", value: data.openProjects, icon: FolderKanban, iconClassName: "bg-indigo-50 text-indigo-600", timeline: monthly(data.openProjects, [0.58, 0.72, 0.86, 1]) },
    { resource: "inventory", title: "Itens abaixo do minimo", value: data.itemsBelowMin, icon: Package, iconClassName: "bg-red-50 text-red-600", timeline: monthly(data.itemsBelowMin, [1.42, 1.18, 1.08, 1]) },
    { resource: "custody", title: "Custodias ativas", value: data.activeCustodies, icon: Archive, iconClassName: "bg-purple-50 text-purple-600", timeline: monthly(data.activeCustodies, [0.72, 0.92, 1.15, 1]) },
    { resource: "payables", title: "A pagar (abertas)", value: data.openPayables, icon: Wallet, iconClassName: "bg-rose-50 text-rose-600", timeline: monthly(data.openPayables, [1.2, 1.08, 0.96, 1]) },
    { resource: "receivables", title: "A receber (abertas)", value: data.openReceivables, icon: TrendingUp, iconClassName: "bg-emerald-50 text-emerald-600", timeline: monthly(data.openReceivables, [0.66, 0.84, 0.9, 1]) },
  ].filter((card) => can(role, "view", card.resource as Parameters<typeof can>[2]) && (card.resource !== "tickets" || role === "tecnico")) : [];
  const showTicketSeries = role === "tecnico";
  const showOperationalChart = showTicketSeries || can(role, "view", "work_orders");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${ROLE_LABELS[role]} · ${session.company.name}`}
      />

      {isLoading || !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-52 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => <KpiCard key={card.title} {...card} />)}
        </div>
      )}

      {showOperationalChart && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">{showTicketSeries ? "OS e Tickets" : "Ordens de servico"} - ultimos 7 dias</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={WEEK_DATA} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={true} />
              <XAxis 
                dataKey="day" 
                tick={{ fontSize: 12 }} 
                axisLine={{ stroke: 'hsl(var(--border))' }} 
                tickLine={{ stroke: 'hsl(var(--border))' }} 
              />
              <YAxis 
                tick={{ fontSize: 12 }} 
                axisLine={{ stroke: 'hsl(var(--border))' }} 
                tickLine={{ stroke: 'hsl(var(--border))' }} 
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                }}
              />
              {/* Linha horizontal para indicar valor-chave (ex: Meta/Média) */}
              <ReferenceLine y={5} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ position: 'top', value: 'Meta (5)', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
              <Bar dataKey="os" name="OS" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              {showTicketSeries && <Bar dataKey="tickets" name="Tickets" fill="hsl(var(--primary) / 0.4)" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function monthly(value: number, multipliers: number[]): KpiTimelinePoint[] {
  return multipliers.map((multiplier, index) => ({
    week: `S${index + 1}`,
    value: Math.max(0, Math.round(value * multiplier)),
  }));
}
