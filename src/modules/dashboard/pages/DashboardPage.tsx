import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { can, hasFullTicketAccess, ROLE_LABELS } from "@/lib/permissions/rbac";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { ensureMyEmployee, fetchMyHrTasks, fetchMyRequests, fetchRequests } from "@/lib/hr/queries";
import { vacationBalance } from "@/lib/hr/rules";
import {
  Users,
  Wrench,
  Package,
  Wallet,
  HeadphonesIcon,
  TrendingUp,
  FolderKanban,
  Archive,
  CalendarDays,
  ClipboardCheck,
  UsersRound,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
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
  // RH no dashboard de todos: saldo de férias e pendências do próprio colaborador; o RH vê também as solicitações pendentes.
  const { data: hr } = useQuery({
    queryKey: ["hr", "dashboard", session.company.id, session.user.id, role],
    queryFn: async () => {
      const me = await ensureMyEmployee(session);
      const [mine, todos] = await Promise.all([fetchMyRequests(session.company.id, me.id), fetchMyHrTasks(session.company.id, me.id)]);
      const pendingRequests = can(role, "view", "hr_admin") ? (await fetchRequests(session.company.id)).filter((request) => request.status === "pendente").length : 0;
      return { available: vacationBalance(me, mine, new Date().getFullYear()).available, openTodos: todos.filter((todo) => todo.status === "pendente").length, pendingRequests };
    },
  });
  const hrCards = hr ? [
    { resource: "hr_self", title: "Férias disponíveis", value: `${hr.available} dias`, icon: CalendarDays },
    { resource: "hr_self", title: "Pendências de RH", value: hr.openTodos, icon: ClipboardCheck },
    { resource: "hr_admin", title: "Solicitações de RH a decidir", value: hr.pendingRequests, icon: UsersRound },
  ] : [];
  const cards = data ? [
    { resource: "customers", title: "Clientes", value: data.customers, icon: Users },
    { resource: "opportunities", title: "Oportunidades abertas", value: data.openOpportunities, icon: TrendingUp },
    { resource: "tickets", title: "Tickets abertos", value: data.openTickets, icon: HeadphonesIcon },
    { resource: "work_orders", title: "OS em aberto", value: data.openWorkOrders, icon: Wrench },
    { resource: "projects", title: "Projetos ativos", value: data.openProjects, icon: FolderKanban },
    { resource: "inventory", title: "Itens abaixo do minimo", value: data.itemsBelowMin, icon: Package },
    { resource: "custody", title: "Custódias de peças ativas", value: data.activeCustodies, icon: Archive },
    { resource: "payables", title: "A pagar (abertas)", value: data.openPayables, icon: Wallet },
    { resource: "receivables", title: "A receber (abertas)", value: data.openReceivables, icon: TrendingUp },
    ...hrCards,
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
            <div key={i} className="h-36 rounded-xl border bg-card animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => <KpiCard key={card.title} {...card} />)}
        </div>
      )}

      {showOperationalChart && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">{showTicketSeries ? "OS e Tickets" : "Ordens de servico"} - últimos 7 dias (dados de exemplo)</h2>
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
              <Bar dataKey="os" name="OS" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="os" position="top" fill="hsl(var(--muted-foreground))" fontSize={11} />
              </Bar>
              {showTicketSeries && (
                <Bar dataKey="tickets" name="Tickets" fill="hsl(var(--primary) / 0.4)" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="tickets" position="top" fill="hsl(var(--muted-foreground))" fontSize={11} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
