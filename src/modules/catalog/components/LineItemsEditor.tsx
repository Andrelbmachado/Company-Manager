// Itens de pedido (venda ou compra): produto do catálogo (ou item de estoque) ou linha avulsa, quantidade, preço,
// desconto em R$ e imposto em %. O preço vem sugerido (tabela de preço na venda, custo na compra) até a pessoa digitar
// outro; a validação de verdade fica em computeLines/quoteItems na gravação. Cabeçalho ordena e Filtrar esconde linhas
// só na vista (useDraftSortFilter: digitar não faz a linha pular); a gravação segue a ordem em que os itens entraram.
import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { IconButton, NoFilterMatchRow, SortableHeader, TABLE_ICONS, TableFilterBar, TableFilterButton, useDraftSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { lineTotal } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { INPUT, num } from "./tradeKit";

export interface EditableLine {
  key: string;
  /** Opção escolhida (ex.: "p:<produto>" ou "i:<item de estoque>"); vazio = linha avulsa. */
  ref: string;
  description: string;
  unit: string;
  qty: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  /** A pessoa digitou o preço: trocar a quantidade não reaplica a sugestão. */
  manualPrice: boolean;
}

export interface LineOption {
  ref: string;
  label: string;
  description: string;
  unit: string;
  taxRate: number;
  group?: string;
}

export function newLine(partial: Partial<EditableLine> = {}): EditableLine {
  return { key: uuidv4(), ref: "", description: "", unit: "un", qty: "1", unitPrice: "", discount: "", taxRate: "", manualPrice: false, ...partial };
}

export function lineAmount(line: EditableLine): number {
  const qty = num(line.qty, 0);
  const price = num(line.unitPrice, 0);
  return lineTotal(qty, price, num(line.discount, 0));
}

interface LineItemsEditorProps {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  options: readonly LineOption[];
  /** Preço sugerido para a opção e a quantidade (null = sem sugestão). */
  suggestPrice: (ref: string, qty: number) => number | null;
  priceLabel?: string;
  /** Permite linha sem produto (descrição e preço digitados). */
  allowFreeLines?: boolean;
  /** Mostra a coluna de imposto (%). */
  showTax?: boolean;
  disabled?: boolean;
}

const CELL = "px-2 py-2 align-top";
const SMALL_INPUT = `${INPUT} h-8 px-2`;

const TH = "px-2 py-2";

export function LineItemsEditor({ lines, onChange, options, suggestPrice, priceLabel = "Preço unit.", allowFreeLines = true, showTax = true, disabled }: LineItemsEditorProps) {
  const groups = Array.from(new Set(options.map((option) => option.group ?? "")));
  const columns = useMemo<SortFilterColumn<EditableLine>[]>(
    () => [
      { key: "ref", header: "Produto / serviço", kind: "select", options: [{ value: "", label: "Item avulso" }, ...options.map((option) => ({ value: option.ref, label: option.label }))] },
      { key: "description", header: "Descrição", kind: "text" },
      { key: "qty", header: "Qtd.", kind: "number", sortValue: (line) => num(line.qty, 0) },
      { key: "unit", header: "Un.", kind: "text" },
      { key: "unitPrice", header: priceLabel, kind: "money", sortValue: (line) => num(line.unitPrice, 0) },
      { key: "discount", header: "Desc. (R$)", kind: "money", sortValue: (line) => num(line.discount, 0) },
      ...(showTax ? [{ key: "taxRate", header: "Imp. %", kind: "percent" as const, sortValue: (line: EditableLine) => num(line.taxRate, 0) }] : []),
      { key: "total", header: "Total", kind: "money", sortValue: lineAmount },
    ],
    [options, priceLabel, showTax],
  );
  const view = useDraftSortFilter(lines, columns, (line) => line.key);
  const header = (key: string) => columns.find((column) => column.key === key)!.header;

  function update(key: string, patch: Partial<EditableLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function pick(line: EditableLine, ref: string) {
    const option = options.find((candidate) => candidate.ref === ref);
    if (!option) {
      update(line.key, { ref: "", manualPrice: true });
      return;
    }
    const suggested = suggestPrice(ref, num(line.qty, 1));
    update(line.key, {
      ref,
      description: option.description,
      unit: option.unit,
      taxRate: option.taxRate ? String(option.taxRate) : "",
      unitPrice: suggested != null ? String(suggested) : line.unitPrice,
      manualPrice: false,
    });
  }

  function changeQty(line: EditableLine, qty: string) {
    const patch: Partial<EditableLine> = { qty };
    if (line.ref && !line.manualPrice) {
      const suggested = suggestPrice(line.ref, num(qty, 1));
      if (suggested != null) patch.unitPrice = String(suggested);
    }
    update(line.key, patch);
  }

  return (
    <div className="space-y-3">
      <TableFilterBar view={view} className="rounded-xl border" />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <SortableHeader label={header("ref")} sortKey="ref" sort={view.sort} onSort={view.toggleSort} className={TH} />
              <SortableHeader label={header("description")} sortKey="description" sort={view.sort} onSort={view.toggleSort} className={TH} />
              <SortableHeader label={header("qty")} sortKey="qty" sort={view.sort} onSort={view.toggleSort} className={`w-20 ${TH}`} />
              <SortableHeader label={header("unit")} sortKey="unit" sort={view.sort} onSort={view.toggleSort} className={`w-16 ${TH}`} />
              <SortableHeader label={header("unitPrice")} sortKey="unitPrice" sort={view.sort} onSort={view.toggleSort} className={`w-28 ${TH}`} />
              <SortableHeader label={header("discount")} sortKey="discount" sort={view.sort} onSort={view.toggleSort} className={`w-24 ${TH}`} />
              {showTax && <SortableHeader label={header("taxRate")} sortKey="taxRate" sort={view.sort} onSort={view.toggleSort} className={`w-20 ${TH}`} />}
              <SortableHeader label={header("total")} sortKey="total" sort={view.sort} onSort={view.toggleSort} align="right" className={`w-28 ${TH}`} />
              <th className="w-10 px-2 py-2"><span className="sr-only">Remover</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {view.rows.map((line) => {
              // Número do item = posição na lista gravada (não muda ao ordenar ou filtrar).
              const index = lines.indexOf(line);
              return (
                <tr key={line.key}>
                  <td className={CELL}>
                    <select aria-label={`Produto do item ${index + 1}`} value={line.ref} disabled={disabled} onChange={(event) => pick(line, event.target.value)} className={SMALL_INPUT}>
                      {allowFreeLines ? <option value="">Item avulso</option> : <option value="" disabled>Escolha...</option>}
                      {groups.map((group) => {
                        const groupOptions = options.filter((option) => (option.group ?? "") === group);
                        const rendered = groupOptions.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>);
                        return group ? <optgroup key={group} label={group}>{rendered}</optgroup> : rendered;
                      })}
                    </select>
                  </td>
                  <td className={CELL}>
                    <input aria-label={`Descrição do item ${index + 1}`} value={line.description} disabled={disabled} onChange={(event) => update(line.key, { description: event.target.value })} className={SMALL_INPUT} />
                  </td>
                  <td className={CELL}>
                    <input aria-label={`Quantidade do item ${index + 1}`} inputMode="decimal" value={line.qty} disabled={disabled} onChange={(event) => changeQty(line, event.target.value)} className={SMALL_INPUT} />
                  </td>
                  <td className={CELL}>
                    <input aria-label={`Unidade do item ${index + 1}`} value={line.unit} disabled={disabled} onChange={(event) => update(line.key, { unit: event.target.value })} className={SMALL_INPUT} />
                  </td>
                  <td className={CELL}>
                    <input aria-label={`${priceLabel} do item ${index + 1}`} inputMode="decimal" value={line.unitPrice} disabled={disabled} onChange={(event) => update(line.key, { unitPrice: event.target.value, manualPrice: true })} className={SMALL_INPUT} />
                  </td>
                  <td className={CELL}>
                    <input aria-label={`Desconto do item ${index + 1}`} inputMode="decimal" value={line.discount} placeholder="0" disabled={disabled} onChange={(event) => update(line.key, { discount: event.target.value })} className={SMALL_INPUT} />
                  </td>
                  {showTax && (
                    <td className={CELL}>
                      <input aria-label={`Imposto do item ${index + 1}`} inputMode="decimal" value={line.taxRate} placeholder="0" disabled={disabled} onChange={(event) => update(line.key, { taxRate: event.target.value })} className={SMALL_INPUT} />
                    </td>
                  )}
                  <td className={`${CELL} pt-3.5 text-right tabular-nums`}>{formatCurrency(lineAmount(line))}</td>
                  <td className={CELL}>
                    <button type="button" aria-label={`Remover item ${index + 1}`} disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((candidate) => candidate.key !== line.key))} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {lines.length > 0 && !view.rows.length && <NoFilterMatchRow colSpan={showTax ? 9 : 8} />}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <IconButton label="Adicionar item" icon={TABLE_ICONS.add} disabled={disabled} onClick={() => onChange([...lines, newLine()])} />
        <TableFilterButton view={view} />
      </div>
    </div>
  );
}

export function TotalsSummary({ rows }: { rows: ReadonlyArray<{ label: string; value: number; strong?: boolean; negative?: boolean }> }) {
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 rounded-xl border bg-card p-4 text-sm">
      {rows.map((row) => (
        <div key={row.label} className={`flex justify-between gap-4 ${row.strong ? "border-t pt-2 text-base font-semibold" : ""}`}>
          <dt className={row.strong ? "" : "text-muted-foreground"}>{row.label}</dt>
          <dd className="tabular-nums">{row.negative && row.value > 0 ? "− " : ""}{formatCurrency(row.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
