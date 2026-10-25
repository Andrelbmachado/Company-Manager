// Pacotes e preços: três cards centralizados (nome → resumo → lista curta → preço por último, grande), comparativo de
// funções com ✓/✕ e os preços por segmento editáveis na própria tabela. Funções e preços saem de service_packages /
// package_prices (src/lib/prospecting/packages.ts); nada de preço escrito na tela.
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Package, X } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type ChoiceOption, type SortFilterColumn } from "@/components/shared/table";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import {
  CARD_FEATURE_LIMIT,
  formatPackagePrice,
  PACKAGE_CODES,
  packageFeatures,
  packagePricesQueryKey,
  packageSummary,
  parsePackageFeatures,
  saveSegmentPrices,
  segmentPriceKey,
  segmentPriceRows,
  startingPrices,
  type PackageCode,
  type PackageFeatureRow,
  type SegmentPriceRow,
} from "@/lib/prospecting/packages";
import type { Lead, PackagePrice, Role, ServicePackage } from "@/types";

const DEFAULT_NAMES: Record<PackageCode, string> = { basico: "Básico", essencial: "Essencial", premium: "Premium" };
const NO_LEADS: Lead[] = [];
/** Comparativo: cada pacote ordena e filtra por incluído / não incluído (o mesmo texto que o leitor de tela ouve). */
const INCLUDED_CHOICES: ChoiceOption[] = [
  { value: "true", label: "Incluído" },
  { value: "false", label: "Não incluído" },
];
/** Preço grande que cabe no card mesmo na janela mínima do app (1024 px, três cards lado a lado). */
const PRICE_VALUE = "whitespace-nowrap font-display text-[clamp(1.75rem,2.6vw,2.5rem)] font-bold leading-tight tracking-tight tabular-nums";

function PackageCard({ pkg, prices }: { pkg: ServicePackage; prices: PackagePrice[] }) {
  const summary = packageSummary(pkg.description);
  const features = parsePackageFeatures(pkg.features_json).slice(0, CARD_FEATURE_LIMIT);
  const start = startingPrices(prices, pkg.id);
  return (
    <article data-package={pkg.code} className="flex min-w-0 flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center md:max-w-sm md:flex-1">
      <h3 className="text-xl font-semibold">{pkg.name}</h3>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      {features.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      )}
      <div data-package-price="" className="mt-auto w-full border-t pt-4">
        {start ? (
          <>
            <p className="text-xs text-muted-foreground">Implantação a partir de {formatPackagePrice(start.setup)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Mensalidade a partir de</p>
            <p data-package-price-value="" className={PRICE_VALUE}>
              {formatPackagePrice(start.monthly)}
              <span className="text-base font-medium text-muted-foreground">/mês</span>
            </p>
          </>
        ) : (
          <p data-package-price-value="" className={PRICE_VALUE}>
            Sob consulta
          </p>
        )}
      </div>
    </article>
  );
}

export function PackagesPanel({ packages, prices, leads = NO_LEADS }: { packages: ServicePackage[]; prices: PackagePrice[]; leads?: Lead[] }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();

  const features = useMemo(() => packageFeatures(packages), [packages]);
  const featureColumns = useMemo<SortFilterColumn<PackageFeatureRow>[]>(
    () => [
      { key: "feature", header: "Função", kind: "text" },
      ...PACKAGE_CODES.map<SortFilterColumn<PackageFeatureRow>>((code) => ({
        key: `pacote:${code}`,
        header: packages.find((pkg) => pkg.code === code)?.name ?? DEFAULT_NAMES[code],
        kind: "select",
        options: INCLUDED_CHOICES,
        sortValue: (row) => String(row[code]),
      })),
    ],
    [packages],
  );
  const featureView = useSortFilter(features, featureColumns);
  const rows = useMemo(() => segmentPriceRows(packages, prices, leads), [packages, prices, leads]);
  const columns = useMemo<EditableColumn<SegmentPriceRow>[]>(
    () => [
      { key: "segment", header: "Segmento", kind: "text", required: true },
      { key: "leads", header: "Leads", kind: "number", readOnly: true },
      ...packages.flatMap<EditableColumn<SegmentPriceRow>>((pkg) => [
        { key: segmentPriceKey(pkg.code, "setup"), header: `${pkg.name} implantação`, kind: "money", required: true },
        { key: segmentPriceKey(pkg.code, "monthly"), header: `${pkg.name} mensal`, kind: "money", required: true },
      ]),
      { key: "feature_note", header: "Escopo do gerenciador", kind: "text", width: 360 },
    ],
    [packages],
  );

  if (packages.length === 0) {
    return <EmptyState icon={Package} title="Nenhum pacote cadastrado" description="Os pacotes são importados junto com os leads." />;
  }

  async function save(changes: EditableTableChanges<SegmentPriceRow>) {
    await saveSegmentPrices(await getDb(), companyId, { role: session.membership.role as Role }, changes);
  }

  return (
    <div className="space-y-8">
      <section aria-label="Pacotes" className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:flex-row md:justify-center">
        {packages.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} prices={prices} />
        ))}
      </section>

      {features.length > 0 && (
        <section className="mx-auto w-full max-w-5xl rounded-xl border bg-card">
          <TableFilterToolbar view={featureView} />
          <TableFilterBar view={featureView} />
          <div className="overflow-x-auto">
            <table aria-label="Comparativo dos pacotes" className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  {featureColumns.map((column) => (
                    <SortableHeader
                      key={column.key}
                      label={column.header}
                      sortKey={column.key}
                      sort={featureView.sort}
                      onSort={featureView.toggleSort}
                      align={column.key === "feature" ? "left" : "center"}
                      className={column.key === "feature" ? "px-4 py-3 text-sm" : "w-28 px-4 py-3 text-sm font-semibold text-foreground"}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {featureView.rows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      {row.feature}
                    </th>
                    {PACKAGE_CODES.map((code) => (
                      <td key={code} data-included={String(row[code])} className="px-4 py-2.5 text-center">
                        {row[code] ? <Check aria-hidden="true" size={16} className="mx-auto" /> : <X aria-hidden="true" size={16} className="mx-auto text-muted-foreground" />}
                        <span className="sr-only">{row[code] ? "Incluído" : "Não incluído"}</span>
                      </td>
                    ))}
                  </tr>
                ))}
                {!featureView.rows.length && <NoFilterMatchRow colSpan={featureColumns.length} />}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <EditableTable<SegmentPriceRow>
        resource="leads"
        title="Preços por segmento"
        label="Preços por segmento"
        rows={rows}
        columns={columns}
        newRow={() => ({ leads: 0, feature_note: null })}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey: packagePricesQueryKey(companyId) })}
        emptyMessage="Nenhum preço cadastrado."
      />
    </div>
  );
}
