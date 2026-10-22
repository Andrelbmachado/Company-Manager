import { useMemo } from "react";
import { Package } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatMoney } from "@/lib/prospecting/contact";
import type { Lead, PackagePrice, ServicePackage } from "@/types";

function parseFeatures(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function PackagesPanel({ packages, prices, leads }: { packages: ServicePackage[]; prices: PackagePrice[]; leads: Lead[] }) {
  const priceFor = useMemo(() => new Map(prices.map((price) => [`${price.package_id}:${price.segment}`, price])), [prices]);
  const segments = useMemo(() => [...new Set(prices.map((price) => price.segment))].sort((a, b) => a.localeCompare(b, "pt-BR")), [prices]);
  const leadsBySegment = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) if (lead.category) counts.set(lead.category, (counts.get(lead.category) ?? 0) + 1);
    return counts;
  }, [leads]);

  if (packages.length === 0) {
    return <EmptyState icon={Package} title="Nenhum pacote cadastrado" description="Os pacotes são importados junto com os leads." />;
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2.5 text-sm text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-950/30 dark:text-yellow-200">
        <strong>Valores estimados.</strong> A Proposta Comercial não estava disponível quando a tabela foi criada; substitua pelos valores reais quando existirem.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {packages.map((pkg) => {
          const own = prices.filter((price) => price.package_id === pkg.id);
          const setups = own.map((price) => price.setup_price);
          const monthlies = own.map((price) => price.monthly_price);
          return (
            <article key={pkg.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold">{pkg.name}</h3>
                {pkg.is_estimate ? <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-yellow-800">estimativa</span> : null}
              </div>
              <p className="text-sm text-muted-foreground">{pkg.description}</p>
              {own.length > 0 && (
                <div className="text-sm">
                  <p><span className="text-muted-foreground">Implantação:</span> <strong>{formatMoney(Math.min(...setups))} a {formatMoney(Math.max(...setups))}</strong></p>
                  <p><span className="text-muted-foreground">Mensalidade:</span> <strong>{formatMoney(Math.min(...monthlies))} a {formatMoney(Math.max(...monthlies))}</strong></p>
                </div>
              )}
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {parseFeatures(pkg.features_json).map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            </article>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Segmento</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Leads</th>
              {packages.map((pkg) => <th key={pkg.id} className="px-4 py-3 text-left font-medium text-muted-foreground">{pkg.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {segments.map((segment) => (
              <tr key={segment}>
                <td className="px-4 py-2.5 font-medium">{segment}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{leadsBySegment.get(segment) ?? 0}</td>
                {packages.map((pkg) => {
                  const price = priceFor.get(`${pkg.id}:${segment}`);
                  return (
                    <td key={pkg.id} className="whitespace-nowrap px-4 py-2.5">
                      {price ? <>{formatMoney(price.setup_price)} <span className="text-muted-foreground">+ {formatMoney(price.monthly_price)}/mês</span></> : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Pacote sugerido por lead (estimativa): 200+ avaliações no Google → Premium com SEO; 50 a 199 → Com agendamento; menos de 50 ou sem avaliações → Básico.
      </p>
    </div>
  );
}
