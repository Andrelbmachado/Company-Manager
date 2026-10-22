import { useMemo, useState } from "react";
import { Box, Boxes, MonitorSmartphone } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { cn } from "@/lib/utils";

type ProductType = "physical" | "digital";
type ProductStatus = "Descoberta" | "Em desenvolvimento" | "Em validação" | "Planejado";

interface ProductInitiative {
  id: string;
  name: string;
  type: ProductType;
  status: ProductStatus;
  owner: string;
  nextMilestone: string;
}

const PRODUCTS: ProductInitiative[] = [
  { id: "product-1", name: "Sensor de monitoramento Edge", type: "physical", status: "Em validação", owner: "Equipe Hardware", nextMilestone: "Lote piloto · 18 jun" },
  { id: "product-2", name: "Portal de gestão de dispositivos", type: "digital", status: "Em desenvolvimento", owner: "Equipe Plataforma", nextMilestone: "Beta interno · 24 jun" },
  { id: "product-3", name: "Gateway industrial compacto", type: "physical", status: "Descoberta", owner: "Equipe Hardware", nextMilestone: "Protótipo · 05 jul" },
  { id: "product-4", name: "Aplicativo de acompanhamento", type: "digital", status: "Planejado", owner: "Equipe Experiência", nextMilestone: "Kickoff · 12 jul" },
];

export default function ProductDevelopmentPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ProductType>("all");
  const [showFilters, setShowFilters] = useState(false);
  const filteredProducts = useMemo(() => PRODUCTS.filter((product) => {
    const query = normalizeSearch(search);
    const matchesSearch = [product.name, product.owner, product.status]
      .some((value) => normalizeSearch(value).includes(query));
    return matchesSearch && (typeFilter === "all" || product.type === typeFilter);
  }), [search, typeFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Desenvolvimento de Produtos"
        description="Roadmap de produtos físicos e digitais"
      />

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar produtos..."
        onFilterClick={() => setShowFilters((visible) => !visible)}
        filterActive={typeFilter !== "all"}
      />

      {showFilters && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3">
          <span className="mr-1 text-sm font-medium">Tipo</span>
          {([
            ["all", "Todos"],
            ["physical", "Físicos"],
            ["digital", "Digitais"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted",
                typeFilter === value && "border-primary/40 bg-primary/10 text-primary"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
        <Metric label="Iniciativas ativas" value={PRODUCTS.length} />
        <Metric label="Produtos físicos" value={PRODUCTS.filter((product) => product.type === "physical").length} />
        <Metric label="Produtos digitais" value={PRODUCTS.filter((product) => product.type === "digital").length} />
      </div>

      {filteredProducts.length === 0 ? (
        <EmptyState icon={Boxes} title="Nenhum produto encontrado" />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Produto</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Responsável</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Próximo marco</th>
              </tr>
            </thead>
            <tbody className="divide-y bg-background">
              {filteredProducts.map((product) => {
                const Icon = product.type === "physical" ? Box : MonitorSmartphone;
                return (
                  <tr key={product.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-medium">
                        <Icon size={15} className="text-primary" />
                        {product.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{product.type === "physical" ? "Físico" : "Digital"}</td>
                    <td className="px-4 py-3"><Status status={product.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{product.owner}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.nextMilestone}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-background px-4 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Status({ status }: { status: ProductStatus }) {
  return (
    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
      {status}
    </span>
  );
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
