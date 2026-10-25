// Formulário do pedido de compra (novo ou rascunho): fornecedor, datas, local de entrada, condições e itens. Os itens
// podem ser produtos do catálogo, itens de estoque sem produto ou linhas avulsas; o preço sugerido é o custo atual.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Save } from "lucide-react";
import type { PurchaseOrderInput } from "@/lib/erp/receiving";
import { fail, isTrue } from "@/lib/erp/tradeDb";
import { orderTotals } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import { LineItemsEditor, TotalsSummary, newLine, type EditableLine, type LineOption } from "@/modules/catalog/components/LineItemsEditor";
import { BUTTON, ErrorNote, Field, INPUT, PRIMARY, byId, num, useInventoryItems, useLocations, useProducts, useSuppliers } from "@/modules/catalog/components/tradeKit";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types";

export interface PurchaseOrderForm {
  supplierId: string;
  orderDate: string;
  expectedDate: string;
  locationId: string;
  paymentTerms: string;
  installments: string;
  discount: string;
  shipping: string;
  notes: string;
}

export function emptyPurchaseOrderForm(supplierId = ""): PurchaseOrderForm {
  return { supplierId, orderDate: todayIso(), expectedDate: "", locationId: "", paymentTerms: "", installments: "1", discount: "", shipping: "", notes: "" };
}

export function purchaseOrderFormFrom(order: PurchaseOrder): PurchaseOrderForm {
  return {
    supplierId: order.supplier_id ?? "",
    orderDate: order.order_date?.slice(0, 10) ?? todayIso(),
    expectedDate: order.expected_date?.slice(0, 10) ?? "",
    locationId: order.location_id ?? "",
    paymentTerms: order.payment_terms ?? "",
    installments: String(order.installments ?? 1),
    discount: Number(order.discount) ? String(order.discount) : "",
    shipping: Number(order.shipping) ? String(order.shipping) : "",
    notes: order.notes ?? "",
  };
}

export function purchaseLinesFrom(items: readonly PurchaseOrderItem[]): EditableLine[] {
  if (items.length === 0) return [newLine()];
  return items.map((item) => newLine({
    ref: item.product_id ? `p:${item.product_id}` : item.inventory_item_id ? `i:${item.inventory_item_id}` : "",
    description: item.description,
    unit: item.unit,
    qty: String(item.qty),
    unitPrice: String(item.unit_price),
    discount: Number(item.discount) ? String(item.discount) : "",
    taxRate: Number(item.tax_rate) ? String(item.tax_rate) : "",
    manualPrice: true,
  }));
}

function isBlank(line: EditableLine): boolean {
  return !line.ref && !line.description.trim() && !line.unitPrice.trim();
}

interface PurchaseOrderEditorProps {
  companyId: string;
  initialForm: PurchaseOrderForm;
  initialLines: EditableLine[];
  onSave: (input: Omit<PurchaseOrderInput, "companyId">) => Promise<string>;
  onSaved: (orderId: string) => void;
  onCancel?: () => void;
  saveLabel?: string;
}

export function PurchaseOrderEditor({ companyId, initialForm, initialLines, onSave, onSaved, onCancel, saveLabel = "Salvar" }: PurchaseOrderEditorProps) {
  const [form, setForm] = useState(initialForm);
  const [lines, setLines] = useState(initialLines);
  const { data: suppliers = [] } = useSuppliers(companyId);
  const { data: products = [] } = useProducts(companyId);
  const { data: stockItems = [] } = useInventoryItems(companyId);
  const { data: locations = [] } = useLocations(companyId);
  const productsById = useMemo(() => byId(products), [products]);
  const stockById = useMemo(() => byId(stockItems), [stockItems]);
  const supplier = suppliers.find((row) => row.id === form.supplierId);

  const usedRefs = new Set(lines.map((line) => line.ref));
  const linkedItems = new Set(products.filter((product) => product.kind === "produto" && product.inventory_item_id).map((product) => product.inventory_item_id));
  const options: LineOption[] = [
    ...products
      .filter((product) => isTrue(product.active) || usedRefs.has(`p:${product.id}`))
      .map((product) => ({
        ref: `p:${product.id}`,
        label: `${product.name}${product.sku ? ` · ${product.sku}` : ""}${isTrue(product.active) ? "" : " (inativo)"}${product.kind === "produto" && !product.inventory_item_id ? " · sem estoque" : ""}`,
        description: product.name,
        unit: product.unit || "un",
        taxRate: 0,
        group: product.kind === "servico" ? "Serviços" : "Produtos do catálogo",
      })),
    ...stockItems
      .filter((item) => !linkedItems.has(item.id) || usedRefs.has(`i:${item.id}`))
      .map((item) => ({ ref: `i:${item.id}`, label: `${item.name}${item.sku ? ` · ${item.sku}` : ""}`, description: item.name, unit: item.unit || "un", taxRate: 0, group: "Itens de estoque (sem produto)" })),
  ];

  function costFor(ref: string): number | null {
    if (ref.startsWith("i:")) {
      const item = stockById.get(ref.slice(2));
      return item ? Number(item.cost ?? 0) : null;
    }
    if (ref.startsWith("p:")) {
      const product = productsById.get(ref.slice(2));
      if (!product) return null;
      const item = product.kind === "produto" && product.inventory_item_id ? stockById.get(product.inventory_item_id) : undefined;
      return Number(item?.cost ?? product.cost ?? 0);
    }
    return null;
  }

  const filled = lines.filter((line) => !isBlank(line));
  const totals = orderTotals(
    filled.map((line) => ({ qty: num(line.qty, 0), unit_price: num(line.unitPrice, 0), discount: num(line.discount, 0), tax_rate: num(line.taxRate, 0) })),
    { discount: num(form.discount, 0), shipping: num(form.shipping, 0) },
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!form.supplierId) fail("Escolha o fornecedor.");
      return onSave({
        supplierId: form.supplierId,
        orderDate: form.orderDate || todayIso(),
        expectedDate: form.expectedDate || null,
        locationId: form.locationId || null,
        paymentTerms: form.paymentTerms || supplier?.terms || null,
        installments: num(form.installments, Number.NaN),
        discount: num(form.discount, 0),
        shipping: num(form.shipping, 0),
        notes: form.notes,
        items: filled.map((line) => ({
          productId: line.ref.startsWith("p:") ? line.ref.slice(2) : null,
          inventoryItemId: line.ref.startsWith("i:") ? line.ref.slice(2) : null,
          description: line.description,
          unit: line.unit,
          qty: num(line.qty, Number.NaN),
          unitPrice: line.unitPrice.trim() ? num(line.unitPrice, Number.NaN) : null,
          discount: num(line.discount, 0),
          taxRate: num(line.taxRate, 0),
        })),
      });
    },
    onSuccess: onSaved,
  });

  const change = (patch: Partial<PurchaseOrderForm>) => setForm((current) => ({ ...current, ...patch }));

  return (
    <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fornecedor *" className="sm:col-span-2">
          <select value={form.supplierId} onChange={(event) => change({ supplierId: event.target.value })} className={INPUT} required>
            <option value="">Escolha o fornecedor...</option>
            {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}{row.document ? ` · ${row.document}` : ""}</option>)}
          </select>
          {supplier?.terms && <span className="block text-xs font-normal text-muted-foreground">Condição do fornecedor: {supplier.terms}</span>}
        </Field>
        <Field label="Local de entrada no estoque" className="sm:col-span-2">
          <select value={form.locationId} onChange={(event) => change({ locationId: event.target.value })} className={INPUT}>
            <option value="">Escolher no recebimento</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Data do pedido">
          <input type="date" value={form.orderDate} onChange={(event) => change({ orderDate: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Previsão de entrega">
          <input type="date" value={form.expectedDate} onChange={(event) => change({ expectedDate: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Parcelas a pagar">
          <input type="number" min={1} max={120} value={form.installments} onChange={(event) => change({ installments: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Condição de pagamento">
          <input value={form.paymentTerms} placeholder={supplier?.terms ?? "Ex.: 28 dias"} onChange={(event) => change({ paymentTerms: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Desconto do pedido (R$)">
          <input inputMode="decimal" value={form.discount} placeholder="0" onChange={(event) => change({ discount: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Frete (R$)">
          <input inputMode="decimal" value={form.shipping} placeholder="0" onChange={(event) => change({ shipping: event.target.value })} className={INPUT} />
        </Field>
      </div>

      <section className="space-y-3" aria-label="Itens do pedido">
        <h2 className="text-base font-semibold">Itens</h2>
        <LineItemsEditor lines={lines} onChange={setLines} options={options} suggestPrice={(ref) => costFor(ref)} priceLabel="Custo unit." />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Field label="Observações">
          <textarea rows={3} value={form.notes} onChange={(event) => change({ notes: event.target.value })} className={`${INPUT} h-auto resize-none py-2`} />
        </Field>
        <TotalsSummary rows={[
          { label: "Itens", value: totals.subtotal },
          { label: "Desconto", value: totals.discount, negative: true },
          { label: "Frete", value: totals.shipping },
          { label: "Impostos", value: totals.tax_total },
          { label: "Total", value: totals.total, strong: true },
        ]} />
      </div>

      <ErrorNote error={save.error} />
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        {onCancel && <button type="button" className={BUTTON} onClick={onCancel}>Cancelar</button>}
        <button type="submit" className={PRIMARY} disabled={save.isPending}><Save size={14} /> {saveLabel}</button>
      </div>
    </form>
  );
}
