// Opções de "produto ou item" das tabelas de Compras (lista de pedidos e itens do pedido): produtos do catálogo e itens
// de estoque sem produto, no formato de valor das colunas ("p:<id>" / "i:<id>").
import { useMemo } from "react";
import { isTrue } from "@/lib/erp/tradeDb";
import { useInventoryItems, useProducts } from "@/modules/catalog/components/tradeKit";

export interface ItemOption {
  value: string;
  label: string;
}

export function usePurchaseItemOptions(companyId: string, used: readonly (string | null)[] = []) {
  const { data: products = [] } = useProducts(companyId);
  const { data: stockItems = [] } = useInventoryItems(companyId);
  const usedKey = used.join("|");
  return useMemo(() => {
    const usedRefs = new Set(usedKey.split("|"));
    const linked = new Set(products.filter((product) => product.kind === "produto" && product.inventory_item_id).map((product) => product.inventory_item_id));
    const options: ItemOption[] = [
      ...products
        .filter((product) => isTrue(product.active) || usedRefs.has(`p:${product.id}`))
        .map((product) => ({
          value: `p:${product.id}`,
          label: `${product.name}${product.sku ? ` · ${product.sku}` : ""}${isTrue(product.active) ? "" : " (inativo)"}${product.kind === "servico" ? " · serviço" : product.inventory_item_id ? "" : " · sem estoque"}`,
        })),
      ...stockItems
        .filter((item) => !linked.has(item.id) || usedRefs.has(`i:${item.id}`))
        .map((item) => ({ value: `i:${item.id}`, label: `${item.name}${item.sku ? ` · ${item.sku}` : ""} · item de estoque` })),
    ];
    const names = new Map<string, string>([
      ...products.map((product) => [`p:${product.id}`, product.name] as [string, string]),
      ...stockItems.map((item) => [`i:${item.id}`, item.name] as [string, string]),
    ]);
    return { options, nameOf: (ref: string | null | undefined) => (ref ? names.get(ref) ?? null : null) };
  }, [products, stockItems, usedKey]);
}
