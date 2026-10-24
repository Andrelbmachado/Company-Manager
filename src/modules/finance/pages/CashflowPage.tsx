// Fluxo de caixa: saldo das contas bancárias dia a dia, com o realizado (baixas e extrato conciliado) e o previsto
// (contas em aberto), agrupado por dia, semana ou mês. O cálculo fica em lib/erp/cashflow.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownCircle, ArrowUpCircle, Landmark, TrendingDown, TrendingUp } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { cashEvents, cashflow, groupCashflow, type CashEvent, type CashflowDay } from "@/lib/erp/cashflow";
import { addDays, addMonths, daysBetween, daysInMonth, monthLabel } from "@/lib/erp/financeCommon";
import { roundMoney, sumMoney } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorNote, Field, Money, errorMessage, inputClass, td, th, useFinanceLookups } from "../components/financeShared";

type Preset = "mes" | "30" | "90" | "mes-passado" | "ano" | "personalizado";
type Grouping = "day" | "week" | "month";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "mes", label: "Este mês" },
  { value: "30", label: "Próximos 30 dias" },
  { value: "90", label: "Próximos 90 dias" },
  { value: "mes-passado", label: "Mês passado" },
  { value: "ano", label: "Este ano" },
  { value: "personalizado", label: "Personalizado" },
];
const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];
const SOURCE_LABELS: Record<CashEvent["source"], string> = {
  settlement: "Baixa",
  legacy: "Baixa antiga",
  bank: "Extrato",
  payable: "Conta a pagar",
  receivable: "Conta a receber",
};

function presetRange(preset: Exclude<Preset, "personalizado">, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  const lastDay = (value: string) => `${value}-${String(daysInMonth(value)).padStart(2, "0")}`;
  if (preset === "30") return { from: today, to: addDays(today, 29) };
  if (preset === "90") return { from: today, to: addDays(today, 89) };
  if (preset === "mes-passado") {
    const previous = addMonths(month, -1);
    return { from: `${previous}-01`, to: lastDay(previous) };
  }
  if (preset === "ano") return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  return { from: `${month}-01`, to: lastDay(month) };
}

const autoGrouping = (from: string, to: string): Grouping => {
  const days = daysBetween(from, to) + 1;
  return days <= 45 ? "day" : days <= 180 ? "week" : "month";
};

interface Period {
  key: string;
  label: string;
  from: string;
  to: string;
  in: number;
  out: number;
  balance: number;
}

function periodsOf(days: CashflowDay[], grouping: Grouping): Period[] {
  if (grouping === "day") return days.map((day) => ({ key: day.date, label: formatDay(day.date).slice(0, 5), from: day.date, to: day.date, in: day.in, out: day.out, balance: day.balance }));
  return groupCashflow(days, grouping).map((period) => ({
    ...period,
    label: grouping === "month" ? monthLabel(period.key.slice(0, 7)) : `${formatDay(period.from).slice(0, 5)} a ${formatDay(period.to).slice(0, 5)}`,
  }));
}

export default function CashflowPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const today = todayIso();
  const lookups = useFinanceLookups(companyId);
  const [preset, setPreset] = useState<Preset>("mes");
  const [range, setRange] = useState(() => presetRange("mes", today));
  const [accountId, setAccountId] = useState("");
  const [includeForecast, setIncludeForecast] = useState(true);
  const [grouping, setGrouping] = useState<Grouping | "auto">("auto");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rangeValid = Boolean(range.from && range.to && range.from <= range.to);
  const { data, error, isLoading } = useQuery({
    queryKey: ["finance", companyId, "cashflow", range.from, range.to, accountId, includeForecast],
    enabled: rangeValid,
    queryFn: async () => {
      const db = await getDb();
      const options = { today, includeForecast, bankAccountId: accountId || null };
      const days = await cashflow(db, companyId, range.from, range.to, options);
      const events = (await cashEvents(db, companyId, options)).filter((event) => event.date >= range.from && event.date <= range.to);
      return { days, events };
    },
  });
  const days = data?.days ?? [];
  const events = data?.events ?? [];
  const effectiveGrouping = grouping === "auto" ? autoGrouping(range.from, range.to) : grouping;
  const periods = periodsOf(days, effectiveGrouping);

  const first = days[0];
  const opening = first ? roundMoney(first.balance - first.in + first.out) : 0;
  const closing = days.length ? days[days.length - 1].balance : 0;
  const totalIn = sumMoney(days.map((day) => day.in));
  const totalOut = sumMoney(days.map((day) => day.out));
  const forecastIn = sumMoney(days.map((day) => day.inForecast));
  const forecastOut = sumMoney(days.map((day) => day.outForecast));
  const lowest = days.reduce<CashflowDay | null>((min, day) => (!min || day.balance < min.balance ? day : min), null);
  const selected = periods.find((period) => period.key === selectedKey) ?? null;
  const selectedEvents = selected ? events.filter((event) => event.date >= selected.from && event.date <= selected.to) : [];
  const tableRows = periods.filter((period) => effectiveGrouping !== "day" || period.in !== 0 || period.out !== 0);

  const choosePreset = (value: Preset) => {
    setPreset(value);
    setSelectedKey(null);
    if (value !== "personalizado") setRange(presetRange(value, today));
  };
  const changeDate = (key: "from" | "to", value: string) => {
    setPreset("personalizado");
    setSelectedKey(null);
    setRange((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Fluxo de caixa" description="Saldo das contas bancárias com o realizado (baixas e extrato conciliado) e o previsto (contas em aberto)." />

      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        <Field label="Período">
          <select value={preset} onChange={(event) => choosePreset(event.target.value as Preset)} className={inputClass}>
            {PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="De">
          <input type="date" value={range.from} onChange={(event) => changeDate("from", event.target.value)} className={inputClass} />
        </Field>
        <Field label="Até">
          <input type="date" value={range.to} onChange={(event) => changeDate("to", event.target.value)} className={inputClass} />
        </Field>
        <Field label="Conta bancária">
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputClass}>
            <option value="">Todas as contas</option>
            {lookups.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </Field>
        <Field label="Agrupar por">
          <select value={grouping} onChange={(event) => { setGrouping(event.target.value as Grouping | "auto"); setSelectedKey(null); }} className={inputClass}>
            <option value="auto">Automático</option>
            {GROUPINGS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={includeForecast} onChange={(event) => setIncludeForecast(event.target.checked)} className="h-4 w-4" />
          Incluir previsto
        </label>
      </div>

      {!rangeValid && <ErrorNote message="Escolha a data inicial e uma data final igual ou depois dela." />}
      <ErrorNote message={error ? errorMessage(error) : null} />

      {rangeValid && !error && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard title="Saldo inicial" value={formatCurrency(opening)} subtitle={`Antes de ${formatDay(range.from)}`} icon={Landmark} />
            <KpiCard title="Entradas" value={formatCurrency(totalIn)} subtitle={includeForecast ? `${formatCurrency(forecastIn)} previstas` : "Só realizado"} icon={ArrowUpCircle} iconClassName="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" />
            <KpiCard title="Saídas" value={formatCurrency(totalOut)} subtitle={includeForecast ? `${formatCurrency(forecastOut)} previstas` : "Só realizado"} icon={ArrowDownCircle} iconClassName="bg-red-600/10 text-red-700 dark:text-red-400" />
            <KpiCard title="Saldo final" value={formatCurrency(closing)} subtitle={`Em ${formatDay(range.to)}`} icon={TrendingUp} />
            <KpiCard
              title="Menor saldo"
              value={formatCurrency(lowest?.balance ?? 0)}
              subtitle={lowest ? `Em ${formatDay(lowest.date)}${lowest.balance < 0 ? ": caixa negativo" : ""}` : undefined}
              icon={TrendingDown}
              iconClassName={lowest && lowest.balance < 0 ? "bg-red-600/10 text-red-700 dark:text-red-400" : undefined}
            />
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Calculando…</p>
          ) : days.length === 0 ? (
            <EmptyState icon={Landmark} title="Sem dados no período" />
          ) : (
            <>
              <section aria-label="Gráfico do fluxo de caixa" className="rounded-xl border p-4">
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={periods} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={12} />
                      <YAxis tickLine={false} axisLine={false} width={80} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value: number) => formatCurrency(value).replace(/,\d{2}$/, "")} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="in" name="Entradas" fill="currentColor" className="text-emerald-600 dark:text-emerald-400" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="out" name="Saídas" fill="currentColor" className="text-red-600 dark:text-red-400" radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="balance" name="Saldo" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {tableRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum movimento no período.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className={th}>Período</th>
                        <th className={cn(th, "text-right")}>Entradas</th>
                        <th className={cn(th, "text-right")}>Saídas</th>
                        <th className={cn(th, "text-right")}>Resultado</th>
                        <th className={cn(th, "text-right")}>Saldo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {tableRows.map((period) => (
                        <tr
                          key={period.key}
                          onClick={() => setSelectedKey(period.key === selectedKey ? null : period.key)}
                          className={cn("cursor-pointer hover:bg-muted/20", period.key === selectedKey && "bg-muted/40")}
                        >
                          <td className={td}>{effectiveGrouping === "day" ? formatDay(period.from) : period.label}</td>
                          <td className={cn(td, "text-right")}><Money value={period.in} /></td>
                          <td className={cn(td, "text-right")}><Money value={period.out} /></td>
                          <td className={cn(td, "text-right")}><Money value={period.in - period.out} signed /></td>
                          <td className={cn(td, "text-right font-medium", period.balance < 0 && "text-red-700 dark:text-red-400")}><Money value={period.balance} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {effectiveGrouping === "day" && <p className="text-xs text-muted-foreground">Dias sem movimento ficam fora da tabela. Clique num período para ver os movimentos.</p>}

              {selected && (
                <section aria-label="Movimentos do período" className="space-y-2">
                  <h2 className="text-sm font-semibold">Movimentos de {selected.from === selected.to ? formatDay(selected.from) : `${formatDay(selected.from)} a ${formatDay(selected.to)}`}</h2>
                  {selectedEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum movimento.</p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {selectedEvents.map((event, index) => (
                        <li key={`${event.source}-${event.refId}-${event.settlementId ?? index}`} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div>
                            <p className="font-medium">{event.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDay(event.date)} · {event.kind === "forecast" ? "Previsto" : "Realizado"} · {SOURCE_LABELS[event.source]}
                              {event.bankAccountId && ` · ${lookups.bankAccountName(event.bankAccountId)}`}
                            </p>
                          </div>
                          <Money value={event.amount} signed className="font-medium" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
