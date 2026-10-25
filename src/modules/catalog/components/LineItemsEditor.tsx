// Itens de pedido (venda ou compra): produto do catálogo (ou item de estoque) ou linha avulsa, quantidade, preço,
// desconto em R$ e imposto em %. O preço vem sugerido (tabela de preço na venda, custo na compra) até a pessoa digitar
// outro; a validação de verdade fica em computeLines/quoteItems na gravação.
import { Plus, Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { lineTotal } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { BUTTON, INPUT, num } from "./tradeKit";

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

export function LineItemsEditor({ lines, onChange, options, suggestPrice, priceLabel = "Preço unit.", allowFreeLines = true, showTax = true, disabled }: LineItemsEditorProps) {
  const groups = Array.from(new Set(options.map((option) => option.group ?? "")));

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
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Produto / serviço</th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Descrição</th>
              <th className="w-20 px-2 py-2 text-left font-medium text-muted-foreground">Qtd.</th>
              <th className="w-16 px-2 py-2 text-left font-medium text-muted-foreground">Un.</th>
              <th className="w-28 px-2 py-2 text-left font-medium text-muted-foreground">{priceLabel}</th>
              <th className="w-24 px-2 py-2 text-left font-medium text-muted-foreground">Desc. (R$)</th>
              {showTax && <th className="w-20 px-2 py-2 text-left font-medium text-muted-foreground">Imp. %</th>}
              <th className="w-28 px-2 py-2 text-right font-medium text-muted-foreground">Total</th>
              <th className="w-10 px-2 py-2"><span className="sr-only">Remover</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => (
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
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" disabled={disabled} onClick={() => onChange([...lines, newLine()])} className={BUTTON}>
        <Plus size={14} /> Adicionar item
      </button>
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
