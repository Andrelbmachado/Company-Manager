// Formulário do pedido de venda (novo ou em edição): cliente, tabela de preço, datas, local de saída, condições e
// itens. O preço sugerido segue a mesma regra da gravação (effectivePriceList + faixa por quantidade).
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Save } from "lucide-react";
import type { SalesOrderInput } from "@/lib/erp/orders";
import { isPriceListValid, resolveUnitPrice } from "@/lib/erp/pricing";
import { fail, isTrue } from "@/lib/erp/tradeDb";
import { orderTotals } from "@/lib/money";
import { formatCurrency, todayIso } from "@/lib/utils";
import { LineItemsEditor, TotalsSummary, newLine, type EditableLine, type LineOption } from "@/modules/catalog/components/LineItemsEditor";
import { BUTTON, ErrorNote, Field, INPUT, PRIMARY, byId, num, useCustomers, useLocations, usePriceListItems, usePriceLists, useProducts } from "@/modules/catalog/components/tradeKit";
import type { PriceList, Product, SalesOrder, SalesOrderItem } from "@/types";

export interface SalesOrderForm {
  customerId: string;
  priceListId: string;
  orderDate: string;
  deliveryDate: string;
  locationId: string;
  paymentTerms: string;
  installments: string;
  discount: string;
  shipping: string;
  notes: string;
  internalNotes: string;
}

export function emptySalesOrderForm(customerId = ""): SalesOrderForm {
  return { customerId, priceListId: "", orderDate: todayIso(), deliveryDate: "", locationId: "", paymentTerms: "", installments: "1", discount: "", shipping: "", notes: "", internalNotes: "" };
}

export function salesOrderFormFrom(order: SalesOrder): SalesOrderForm {
  return {
    customerId: order.customer_id ?? "",
    priceListId: order.price_list_id ?? "",
    orderDate: order.order_date?.slice(0, 10) ?? todayIso(),
    deliveryDate: order.delivery_date?.slice(0, 10) ?? "",
    locationId: order.location_id ?? "",
    paymentTerms: order.payment_terms ?? "",
    installments: String(order.installments ?? 1),
    discount: Number(order.discount) ? String(order.discount) : "",
    shipping: Number(order.shipping) ? String(order.shipping) : "",
    notes: order.notes ?? "",
    internalNotes: order.internal_notes ?? "",
  };
}

export function salesLinesFrom(items: readonly SalesOrderItem[]): EditableLine[] {
  if (items.length === 0) return [newLine()];
  return items.map((item) => newLine({
    ref: item.product_id ? `p:${item.product_id}` : "",
    description: item.description,
    unit: item.unit,
    qty: String(item.qty),
    unitPrice: String(item.unit_price),
    discount: Number(item.discount) ? String(item.discount) : "",
    taxRate: Number(item.tax_rate) ? String(item.tax_rate) : "",
    manualPrice: true,
  }));
}

/** Linha vazia (sem produto, descrição nem preço) é ignorada ao gravar. */
function isBlank(line: EditableLine): boolean {
  return !line.ref && !line.description.trim() && !line.unitPrice.trim();
}

interface SalesOrderEditorProps {
  companyId: string;
  initialForm: SalesOrderForm;
  initialLines: EditableLine[];
  /** Grava; `confirm` = o botão "Salvar e confirmar". Devolve o id do pedido. */
  onSave: (input: Omit<SalesOrderInput, "companyId">, confirm: boolean) => Promise<string>;
  onSaved: (orderId: string) => void;
  onCancel?: () => void;
  /** Mostra "Salvar e confirmar" (pedido novo). */
  allowConfirm?: boolean;
  saveLabel?: string;
}

export function SalesOrderEditor({ companyId, initialForm, initialLines, onSave, onSaved, onCancel, allowConfirm, saveLabel = "Salvar" }: SalesOrderEditorProps) {
  const [form, setForm] = useState(initialForm);
  const [lines, setLines] = useState(initialLines);
  const { data: products = [] } = useProducts(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const { data: lists = [] } = usePriceLists(companyId);
  const { data: listItems = [] } = usePriceListItems(companyId);
  const { data: locations = [] } = useLocations(companyId);
  const productsById = useMemo(() => byId(products), [products]);
  const customersById = useMemo(() => byId(customers), [customers]);

  function effectiveList(next: SalesOrderForm): { list: PriceList | null; origin: string } {
    const day = next.orderDate || todayIso();
    const valid = (id: string | null | undefined) => (id ? lists.find((list) => list.id === id && isPriceListValid(list, day)) ?? null : null);
    const chosen = valid(next.priceListId);
    if (chosen) return { list: chosen, origin: "escolhida" };
    const ofCustomer = valid(customersById.get(next.customerId)?.price_list_id);
    if (ofCustomer) return { list: ofCustomer, origin: "do cliente" };
    const fallback = lists.filter((list) => isTrue(list.is_default) && isPriceListValid(list, day)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))[0] ?? null;
    return { list: fallback, origin: "padrão" };
  }

  const effective = effectiveList(form);

  function priceFor(list: PriceList | null, ref: string, qty: number): number | null {
    if (!ref.startsWith("p:")) return null;
    const product = productsById.get(ref.slice(2));
    if (!product) return null;
    const items = list ? listItems.filter((item) => item.price_list_id === list.id) : null;
    return resolveUnitPrice(product, items, qty).unitPrice;
  }

  /** Cliente, tabela ou data mudou: reaplica a sugestão nas linhas cujo preço a pessoa não digitou. */
  function changeForm(patch: Partial<SalesOrderForm>) {
    const next = { ...form, ...patch };
    setForm(next);
    if ("customerId" in patch || "priceListId" in patch || "orderDate" in patch) {
      const { list } = effectiveList(next);
      setLines((current) => current.map((line) => {
        if (line.manualPrice || !line.ref) return line;
        const price = priceFor(list, line.ref, num(line.qty, 1));
        return price == null ? line : { ...line, unitPrice: String(price) };
      }));
    }
  }

  const productOption = (product: Product): LineOption => ({
    ref: `p:${product.id}`,
    label: `${product.name}${product.sku ? ` · ${product.sku}` : ""}${isTrue(product.active) ? "" : " (inativo)"}`,
    description: product.name,
    unit: product.unit || "un",
    taxRate: Number(product.tax_rate) || 0,
    group: product.kind === "servico" ? "Serviços" : "Produtos",
  });
  const usedRefs = new Set(lines.map((line) => line.ref));
  const options = products.filter((product) => isTrue(product.active) || usedRefs.has(`p:${product.id}`)).map(productOption);

  const filled = lines.filter((line) => !isBlank(line));
  const totals = orderTotals(
    filled.map((line) => ({ qty: num(line.qty, 0), unit_price: num(line.unitPrice, 0), discount: num(line.discount, 0), tax_rate: num(line.taxRate, 0) })),
    { discount: num(form.discount, 0), shipping: num(form.shipping, 0) },
  );

  const save = useMutation({
    mutationFn: async (confirm: boolean) => {
      if (!form.customerId) fail("Escolha o cliente.");
      return onSave({
        customerId: form.customerId,
        priceListId: form.priceListId || null,
        orderDate: form.orderDate || todayIso(),
        deliveryDate: form.deliveryDate || null,
        locationId: form.locationId || null,
        paymentTerms: form.paymentTerms,
        installments: num(form.installments, Number.NaN),
        discount: num(form.discount, 0),
        shipping: num(form.shipping, 0),
        notes: form.notes,
        internalNotes: form.internalNotes,
        items: filled.map((line) => ({
          productId: line.ref.startsWith("p:") ? line.ref.slice(2) : null,
          description: line.description,
          unit: line.unit,
          qty: num(line.qty, Number.NaN),
          unitPrice: line.unitPrice.trim() ? num(line.unitPrice, Number.NaN) : null,
          discount: num(line.discount, 0),
          taxRate: num(line.taxRate, 0),
        })),
      }, confirm);
    },
    onSuccess: onSaved,
  });

  const customer = customersById.get(form.customerId);

  return (
    <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); save.mutate(false); }}>
      <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Cliente *" className="sm:col-span-2">
          <select value={form.customerId} onChange={(event) => changeForm({ customerId: event.target.value })} className={INPUT} required>
            <option value="">Escolha o cliente...</option>
            {customers.map((row) => <option key={row.id} value={row.id}>{row.name}{row.document ? ` · ${row.document}` : ""}</option>)}
          </select>
          {customer?.payment_terms && <span className="block text-xs font-normal text-muted-foreground">Condição do cliente: {customer.payment_terms}</span>}
        </Field>
        <Field label="Tabela de preço" className="sm:col-span-2">
          <select value={form.priceListId} onChange={(event) => changeForm({ priceListId: event.target.value })} className={INPUT}>
            <option value="">Automática (do cliente ou padrão)</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}{isTrue(list.active) ? "" : " (inativa)"}</option>)}
          </select>
          <span className="block text-xs font-normal text-muted-foreground">
            {effective.list ? `Preços da tabela "${effective.list.name}" (${effective.origin}); sem preço nela, o do catálogo.` : "Preços do catálogo."}
          </span>
        </Field>
        <Field label="Data do pedido">
          <input type="date" value={form.orderDate} onChange={(event) => changeForm({ orderDate: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Previsão de entrega">
          <input type="date" value={form.deliveryDate} onChange={(event) => changeForm({ deliveryDate: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Local de saída do estoque">
          <select value={form.locationId} onChange={(event) => changeForm({ locationId: event.target.value })} className={INPUT}>
            <option value="">Escolher na entrega</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Parcelas">
          <input type="number" min={1} max={120} value={form.installments} onChange={(event) => changeForm({ installments: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Condição de pagamento" className="sm:col-span-2">
          <input value={form.paymentTerms} placeholder={customer?.payment_terms ?? "Ex.: 30/60/90 dias"} onChange={(event) => changeForm({ paymentTerms: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Desconto do pedido (R$)">
          <input inputMode="decimal" value={form.discount} placeholder="0" onChange={(event) => changeForm({ discount: event.target.value })} className={INPUT} />
        </Field>
        <Field label="Frete (R$)">
          <input inputMode="decimal" value={form.shipping} placeholder="0" onChange={(event) => changeForm({ shipping: event.target.value })} className={INPUT} />
        </Field>
      </div>

      <section className="space-y-3" aria-label="Itens do pedido">
        <h2 className="text-base font-semibold">Itens</h2>
        <LineItemsEditor lines={lines} onChange={setLines} options={options} suggestPrice={(ref, qty) => priceFor(effective.list, ref, qty)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Observações (vão para o cliente)">
            <textarea rows={3} value={form.notes} onChange={(event) => changeForm({ notes: event.target.value })} className={`${INPUT} h-auto resize-none py-2`} />
          </Field>
          <Field label="Observações internas">
            <textarea rows={3} value={form.internalNotes} onChange={(event) => changeForm({ internalNotes: event.target.value })} className={`${INPUT} h-auto resize-none py-2`} />
          </Field>
        </div>
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
        <button type="submit" className={allowConfirm ? BUTTON : PRIMARY} disabled={save.isPending}><Save size={14} /> {saveLabel}</button>
        {allowConfirm && <button type="button" className={PRIMARY} disabled={save.isPending} onClick={() => save.mutate(true)}><Check size={14} /> Salvar e confirmar</button>}
      </div>
      {totals.total > 0 && Number.isInteger(num(form.installments, 0)) && num(form.installments, 0) > 1 && (
        <p className="text-right text-xs text-muted-foreground">{num(form.installments, 1)}x de cerca de {formatCurrency(totals.total / num(form.installments, 1))} no faturamento.</p>
      )}
    </form>
  );
}
