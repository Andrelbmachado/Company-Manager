import type { ReactNode } from "react";
import { formatQty } from "@/lib/erp/stockPosting";
import { formatCurrency } from "@/lib/utils";
import type { LineItemBase } from "@/types";
import { TD, TH } from "./tradeKit";

interface ExtraColumn<T> {
  header: string;
  cell: (item: T) => ReactNode;
}

/** Itens gravados de pedido, fatura ou compra (somente leitura), com colunas extras opcionais (ex.: recebido). */
export function DocumentItemsTable<T extends LineItemBase>({ items, extra = [], priceLabel = "Preço unit." }: { items: readonly T[]; extra?: readonly ExtraColumn<T>[]; priceLabel?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className={TH}>#</th>
            <th className={TH}>Descrição</th>
            <th className={`${TH} text-right`}>Qtd.</th>
            {extra.map((column) => <th key={column.header} className={`${TH} text-right`}>{column.header}</th>)}
            <th className={`${TH} text-right`}>{priceLabel}</th>
            <th className={`${TH} text-right`}>Desconto</th>
            <th className={`${TH} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={item.id}>
              <td className={`${TD} text-muted-foreground`}>{item.position}</td>
              <td className={`${TD} font-medium`}>{item.description}</td>
              <td className={`${TD} text-right tabular-nums`}>{formatQty(Number(item.qty))} {item.unit}</td>
              {extra.map((column) => <td key={column.header} className={`${TD} text-right tabular-nums`}>{column.cell(item)}</td>)}
              <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(item.unit_price))}</td>
              <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{Number(item.discount) ? formatCurrency(Number(item.discount)) : "—"}</td>
              <td className={`${TD} text-right font-medium tabular-nums`}>{formatCurrency(Number(item.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
