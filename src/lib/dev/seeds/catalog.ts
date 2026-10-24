// TEMPORÁRIO (dados de exemplo): catálogo de produtos e serviços e tabelas de preço.
// Produtos com SKU igual ao de um item de estoque da empresa ficam ligados a ele (inventory_item_id).
import { roundMoney } from "@/lib/money";
import { exampleRows, hasSeedFlag, insertRows, setSeedFlag, type SeedRow } from "../seedUtils";

const AREA = "catalog";

type ProductSeed = [sku: string, name: string, kind: "produto" | "servico", category: string, unit: string, price: number, cost: number];

const PRODUCTS: ProductSeed[] = [
  ["SW-GER-24", "Switch gerenciável 24 portas", "produto", "Rede", "un", 3290, 2180],
  ["AP-WIFI6", "Access Point Wi-Fi 6", "produto", "Rede", "un", 1890, 1240],
  ["ROT-AX3000", "Roteador Wi-Fi AX3000", "produto", "Rede", "un", 1090, 690],
  ["CAB-CAT6-305", "Cabo de rede Cat6 - caixa 305 m", "produto", "Cabos", "cx", 1290, 890],
  ["SSD-NVME-1T", "SSD NVMe 1 TB", "produto", "Armazenamento", "un", 799, 520],
  ["NOB-1200", "Nobreak 1200 VA", "produto", "Energia", "un", 1390, 930],
  ["MON-24FHD", "Monitor 24\" Full HD", "produto", "Periféricos", "un", 1190, 780],
  ["MOUSE-USB", "Mouse USB corporativo", "produto", "Periféricos", "un", 79, 48],
  ["CAM-IP-EXT", "Câmera IP externa", "produto", "Segurança", "un", 720, 460],
  ["SRV-VISITA", "Visita técnica", "servico", "Serviços", "visita", 280, 0],
  ["SRV-HORA", "Hora técnica", "servico", "Serviços", "h", 160, 0],
  ["SRV-PONTO", "Instalação de ponto de rede", "servico", "Serviços", "ponto", 190, 35],
  ["SRV-FIREWALL", "Configuração de firewall", "servico", "Serviços", "un", 950, 0],
  ["SRV-SUP-MENSAL", "Suporte mensal (contrato)", "servico", "Contratos", "mês", 3000, 0],
];

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const items = await exampleRows<{ id: string; sku: string | null }>("inventory_items", companyId);
  const itemBySku = new Map(items.filter((item) => item.sku).map((item) => [String(item.sku).toUpperCase(), item.id]));

  const products: SeedRow[] = PRODUCTS.map(([sku, name, kind, category, unit, price, cost], index) => ({
    id: `dev-catalog-product-${index + 1}`,
    sku,
    name,
    kind,
    category,
    unit,
    price,
    cost,
    tax_rate: 0,
    inventory_item_id: kind === "produto" ? (itemBySku.get(sku) ?? null) : null,
    active: 1,
  }));
  await insertRows("products", companyId, products);

  await insertRows("price_lists", companyId, [
    { id: "dev-catalog-pricelist-1", name: "Tabela padrão", description: "Preço de venda do catálogo", is_default: 1, active: 1 },
    { id: "dev-catalog-pricelist-2", name: "Tabela revenda", description: "Revendas e parceiros: 10% abaixo da tabela padrão", is_default: 0, active: 1 },
  ]);

  const resale: SeedRow[] = PRODUCTS.map(([, , , , , price], index) => ({
    id: `dev-catalog-pli-${index + 1}`,
    price_list_id: "dev-catalog-pricelist-2",
    product_id: `dev-catalog-product-${index + 1}`,
    price: roundMoney(price * 0.9),
    min_qty: 1,
  }));
  // Preço por volume na tabela padrão: a partir de 10 mouses.
  resale.push({ id: "dev-catalog-pli-101", price_list_id: "dev-catalog-pricelist-1", product_id: "dev-catalog-product-8", price: 69, min_qty: 10 });
  await insertRows("price_list_items", companyId, resale);

  await setSeedFlag(AREA, companyId);
}
