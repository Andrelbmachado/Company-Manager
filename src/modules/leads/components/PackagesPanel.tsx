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
    for (const lead of leads) {
      const segment = lead.pricing_segment ?? lead.category;
      if (segment) counts.set(segment, (counts.get(segment) ?? 0) + 1);
    }
    return counts;
  }, [leads]);

  if (packages.length === 0) {
    return <EmptyState icon={Package} title="Nenhum pacote cadastrado" description="Os pacotes são importados junto com os leads." />;
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
        Preços fixos da Proposta Comercial: implantação de R$ 1.600 a R$ 12.000, mais mensalidade com fidelidade mínima de 12 meses. O Programa de Indicação vale para qualquer pacote.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {packages.map((pkg) => {
          const own = prices.filter((price) => price.package_id === pkg.id);
          const setups = own.map((price) => price.setup_price);
          const monthlies = own.map((price) => price.monthly_price);
          return (
            <article key={pkg.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
              <h3 className="text-lg font-semibold">{pkg.name}</h3>
              <p className="text-sm text-muted-foreground">{pkg.description}</p>
              {own.length > 0 && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p><span className="text-muted-foreground">Implantação</span> <strong>{formatMoney(Math.min(...setups))} a {formatMoney(Math.max(...setups))}</strong></p>
                  <p><span className="text-muted-foreground">Mensalidade</span> <strong>{formatMoney(Math.min(...monthlies))} a {formatMoney(Math.max(...monthlies))}</strong></p>
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
              {packages.map((pkg) => <th key={pkg.id} className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">{pkg.name} (implantação / mensal)</th>)}
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Escopo base do gerenciador</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {segments.map((segment) => {
              const scope = packages.map((pkg) => priceFor.get(`${pkg.id}:${segment}`)?.feature_note).find(Boolean);
              return (
                <tr key={segment}>
                  <td className="px-4 py-2.5 font-medium">{segment}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{leadsBySegment.get(segment) ?? 0}</td>
                  {packages.map((pkg) => {
                    const price = priceFor.get(`${pkg.id}:${segment}`);
                    return (
                      <td key={pkg.id} className="whitespace-nowrap px-4 py-2.5">
                        {price ? <>{formatMoney(price.setup_price)} <span className="text-muted-foreground">/ {formatMoney(price.monthly_price)}</span></> : "—"}
                      </td>
                    );
                  })}
                  <td className="min-w-64 px-4 py-2.5 text-muted-foreground">{scope ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Na estimativa de receita, cada lead entra com o Premium se tiver 200 ou mais avaliações no Google (operação movimentada, mais clientes para gerir) e com o Básico nos demais, já que nenhum tem site. O Essencial (só gerenciador) não é assumido.
        O escopo do gerenciador para buffet, veterinária e restaurante segue as definições do André; nos demais segmentos é o escopo base, a detalhar com o cliente.
      </p>
    </div>
  );
}
