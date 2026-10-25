// Movimentações e transferências pelas tabelas editáveis (Estoque > Movimentações e Transferências).
// Linha nova = lançamento pelo motor de estoque (stock.ts), com o id gerado pela tela: salvar de novo depois de uma
// falha não lança outra vez. O lote inteiro é conferido antes da primeira gravação (o plugin SQL não tem transação),
// inclusive o saldo, somando as linhas na ordem: uma linha sem saldo e nada é lançado. Lançamento já gravado não muda
// (o saldo já foi acertado): só a observação pode ser editada; para corrigir, lança-se um ajuste ou o movimento contrário.
// SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney } from "@/lib/money";
import type { InventoryItem, StockBalance, StockLocation, StockMovement } from "@/types";
import { assertCan, type Actor } from "./permission";
import type { MovementRow } from "./queries";
import { formatQty, recordStockMovement, roundQty, StockError, transferStock, validQuantity } from "./stock";

export type ManualMovementKind = "entrada" | "saida" | "ajuste_falta" | "ajuste_sobra";
export type MovementKind = ManualMovementKind | "transferencia";

export const MANUAL_MOVEMENT_KINDS: readonly { value: ManualMovementKind; label: string }[] = [
  { value: "entrada", label: "Entrada" },
  { value: "saida", label: "Saída" },
  { value: "ajuste_falta", label: "Ajuste: falta" },
  { value: "ajuste_sobra", label: "Ajuste: sobra" },
];

const LOCKED_MESSAGE =
  "Lançamento já gravado não muda (o saldo já foi acertado): aqui só a observação pode ser editada. Para corrigir quantidade, item ou local, lance um ajuste ou uma movimentação contrária.";

/** Tipo da linha da tabela: o tipo gravado mais o sentido (ajuste com origem = falta; com destino = sobra). */
export function movementKindOf(row: Pick<StockMovement, "type" | "from_location_id" | "to_location_id">): MovementKind {
  if (row.type === "ajuste") return row.from_location_id ? "ajuste_falta" : "ajuste_sobra";
  return row.type;
}

/** Sai do local (saída e ajuste de falta)? */
export function leavesLocation(kind: MovementKind | null | undefined): boolean {
  return kind === "saida" || kind === "ajuste_falta";
}

export interface MovementTableRow extends MovementRow {
  kind: MovementKind;
  /** Local da linha: a origem quando sai (e na transferência), o destino quando entra. */
  location_id: string | null;
  unit_cost: number | null;
}

export function toMovementTableRows(rows: readonly MovementRow[]): MovementTableRow[] {
  return rows.map((row) => {
    const kind = movementKindOf(row);
    return {
      ...row,
      kind,
      location_id: (leavesLocation(kind) || kind === "transferencia" ? row.from_location_id : row.to_location_id) ?? null,
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
    };
  });
}

export interface TransferTableRow {
  id: string;
  created_at: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  item_id: string | null;
  quantity: number | null;
  note: string | null;
  /** ref_id da transferência (as linhas de uma mesma transferência têm o mesmo). */
  transfer_id: string;
  item_name: string;
  item_unit: string;
  sku: string | null;
  from_name: string | null;
  to_name: string | null;
  user_name: string | null;
}

/** Uma linha por item transferido (as linhas de uma transferência ficam juntas, da mais recente para a mais antiga). */
export function toTransferTableRows(rows: readonly MovementRow[]): TransferTableRow[] {
  return rows
    .filter((row) => row.type === "transferencia")
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      from_location_id: row.from_location_id ?? null,
      to_location_id: row.to_location_id ?? null,
      item_id: row.item_id,
      quantity: Number(row.quantity),
      note: row.note ?? null,
      transfer_id: row.ref_type === "transfer" && row.ref_id ? row.ref_id : row.id,
      item_name: row.item_name,
      item_unit: row.item_unit,
      sku: row.sku,
      from_name: row.from_name,
      to_name: row.to_name,
      user_name: row.user_name,
    }));
}

export interface RowChanges<C> {
  updated: readonly ({ id: string } & Partial<C>)[];
  created: readonly Partial<C>[];
}

/** Campos de uma linha de movimentação, como a tabela entrega (já convertidos). */
export interface MovementInput {
  id: string;
  kind: string | null;
  item_id: string | null;
  location_id: string | null;
  quantity: number | null;
  unit_cost: number | null;
  note: string | null;
}

export interface TransferInputRow {
  id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  item_id: string | null;
  quantity: number | null;
  note: string | null;
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  return clean || null;
};

/** Itens e locais ativos e o saldo de cada item por local, para conferir o lote todo antes de gravar. */
async function loadContext(db: DatabaseLike, companyId: string) {
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const locations = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
  const itemById = new Map(items.map((row) => [row.id, row]));
  const locationById = new Map(locations.map((row) => [row.id, row]));
  const simulated = new Map<string, number>();
  for (const row of balances) simulated.set(`${row.item_id}|${row.location_id}`, roundQty(Number(row.quantity ?? 0)));
  return {
    item(id: string | null, where: string): InventoryItem {
      if (!id) throw new StockError("item_invalido", `${where}: escolha o item.`);
      const item = itemById.get(id);
      if (!item) throw new StockError("item_invalido", `${where}: item não encontrado no estoque (excluído ou de outra empresa).`);
      return item;
    },
    location(id: string | null, where: string, missing = "escolha o local"): StockLocation {
      if (!id) throw new StockError("locais_invalidos", `${where}: ${missing}.`);
      const location = locationById.get(id);
      if (!location) throw new StockError("local_invalido", `${where}: local de estoque não encontrado (excluído ou de outra empresa).`);
      return location;
    },
    /** Tira do saldo simulado (recusa sem saldo, como o motor faria na gravação). */
    take(item: InventoryItem, location: StockLocation, quantity: number, where: string): void {
      const key = `${item.id}|${location.id}`;
      const available = simulated.get(key) ?? 0;
      if (available < quantity) {
        throw new StockError(
          "saldo_insuficiente",
          `${where}: saldo insuficiente de "${item.name}" em ${location.name}: disponível ${formatQty(available, item.unit)}, pedido ${formatQty(quantity, item.unit)}.`,
        );
      }
      simulated.set(key, roundQty(available - quantity));
    },
    put(item: InventoryItem, location: StockLocation, quantity: number): void {
      const key = `${item.id}|${location.id}`;
      simulated.set(key, roundQty((simulated.get(key) ?? 0) + quantity));
    },
  };
}

function quantityOf(value: unknown, where: string): number {
  try {
    return validQuantity(typeof value === "number" ? value : Number.NaN);
  } catch {
    throw new StockError("quantidade_invalida", `${where}: informe uma quantidade maior que zero.`);
  }
}

/** Confere que só a observação muda e que cada lançamento existe; devolve as gravações a fazer. */
async function plannedNotes(db: DatabaseLike, companyId: string, updated: readonly ({ id: string } & { note?: string | null })[]) {
  const notes: { id: string; note: string | null }[] = [];
  for (const patch of updated) {
    if (Object.keys(patch).some((key) => key !== "id" && key !== "note")) throw new StockError("valor_invalido", LOCKED_MESSAGE);
    if (!("note" in patch)) continue;
    const [row] = await db.select<StockMovement[]>("SELECT * FROM stock_movements WHERE company_id=? AND id=?", [companyId, patch.id]);
    if (!row) throw new StockError("valor_invalido", "Movimentação não encontrada (de outra empresa ou removida). Atualize a lista.");
    notes.push({ id: row.id, note: text(patch.note) });
  }
  return notes;
}

async function writeNotes(db: DatabaseLike, companyId: string, notes: readonly { id: string; note: string | null }[]): Promise<string[]> {
  for (const { id, note } of notes) await db.execute("UPDATE stock_movements SET note=? WHERE company_id=? AND id=?", [note, companyId, id]);
  return notes.map((row) => row.id);
}

/**
 * Grava a tabela de movimentações: linhas novas viram entrada, saída ou ajuste (falta/sobra) no local escolhido, com o
 * custo digitado só na entrada (vazio = custo do item); linhas gravadas só mudam a observação. Lançar exige `create`
 * e mudar a observação exige `edit` em `inventory`.
 */
export async function saveMovementRows(db: DatabaseLike, companyId: string, actor: Actor, changes: RowChanges<MovementInput>): Promise<{ created: string[]; updated: string[] }> {
  if (changes.created.length > 0) assertCan(actor, "create", "inventory", "movimentações de estoque");
  if (changes.updated.length > 0) assertCan(actor, "edit", "inventory", "movimentações de estoque");
  const notes = await plannedNotes(db, companyId, changes.updated);
  const context = await loadContext(db, companyId);
  const plans: Parameters<typeof recordStockMovement>[1][] = [];

  for (const [index, row] of changes.created.entries()) {
    const where = `Linha nova ${index + 1}`;
    const id = text(row.id) ?? uuidv4();
    if ((await db.select<StockMovement[]>("SELECT * FROM stock_movements WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    const kind = text(row.kind);
    if (kind === "transferencia") throw new StockError("valor_invalido", `${where}: transferências são lançadas em Estoque › Transferências.`);
    if (!MANUAL_MOVEMENT_KINDS.some((option) => option.value === kind)) throw new StockError("valor_invalido", `${where}: escolha o tipo (entrada, saída ou ajuste).`);
    const item = context.item(text(row.item_id), where);
    const location = context.location(text(row.location_id), where);
    const quantity = quantityOf(row.quantity, where);
    const leaves = leavesLocation(kind as ManualMovementKind);
    if (leaves) context.take(item, location, quantity, where);
    else context.put(item, location, quantity);
    let unitCost: number | null = null;
    if (kind === "entrada" && row.unit_cost != null) {
      if (!Number.isFinite(row.unit_cost) || row.unit_cost < 0) throw new StockError("valor_invalido", `${where}: custo unitário deve ser um número igual ou maior que zero.`);
      unitCost = roundMoney(row.unit_cost);
    }
    plans.push({
      companyId,
      id,
      itemId: item.id,
      type: kind === "entrada" || kind === "saida" ? kind : "ajuste",
      quantity,
      fromLocationId: leaves ? location.id : null,
      toLocationId: leaves ? null : location.id,
      unitCost,
      refType: "manual",
      userId: actor.userId,
      note: text(row.note),
    });
  }

  const created: string[] = [];
  for (const plan of plans) created.push(await recordStockMovement(db, plan));
  return { created, updated: await writeNotes(db, companyId, notes) };
}

interface TransferGroup {
  id: string;
  from: StockLocation;
  to: StockLocation;
  note: string | null;
  lines: { itemId: string; quantity: number }[];
}

/**
 * Grava a tabela de transferências: cada linha nova é um item; linhas novas com a mesma origem, destino e observação
 * viram uma transferência só (ref_id = id da primeira linha). Linhas gravadas só mudam a observação. Transferir exige
 * `transfer` e mudar a observação exige `edit` em `inventory`.
 */
export async function saveTransferRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  changes: RowChanges<TransferInputRow>,
): Promise<{ transfers: { id: string; from_location_id: string; to_location_id: string; lines: number }[]; updated: string[] }> {
  if (changes.created.length > 0) assertCan(actor, "transfer", "inventory", "itens entre locais");
  if (changes.updated.length > 0) assertCan(actor, "edit", "inventory", "movimentações de estoque");
  const notes = await plannedNotes(db, companyId, changes.updated);
  const context = await loadContext(db, companyId);
  const groups = new Map<string, TransferGroup>();

  for (const [index, row] of changes.created.entries()) {
    const where = `Linha nova ${index + 1}`;
    const from = context.location(text(row.from_location_id), where, "escolha o local de origem");
    const to = context.location(text(row.to_location_id), where, "escolha o local de destino");
    if (from.id === to.id) throw new StockError("mesmo_local", `${where}: a origem e o destino são o mesmo local.`);
    const item = context.item(text(row.item_id), where);
    const quantity = quantityOf(row.quantity, where);
    const note = text(row.note);
    const key = JSON.stringify([from.id, to.id, note]);
    const group = groups.get(key) ?? { id: text(row.id) ?? uuidv4(), from, to, note, lines: [] };
    group.lines.push({ itemId: item.id, quantity });
    groups.set(key, group);
  }

  const pending: TransferGroup[] = [];
  for (const group of groups.values()) {
    // Transferência gravada numa tentativa anterior que falhou depois dela: não transfere de novo.
    const done = await db.select<StockMovement[]>("SELECT * FROM stock_movements WHERE company_id=? AND ref_type='transfer' AND ref_id=?", [companyId, group.id]);
    if (done.length > 0) continue;
    for (const [index, line] of group.lines.entries()) {
      const item = context.item(line.itemId, "Transferência");
      context.take(item, group.from, line.quantity, `Transferência de ${group.from.name} para ${group.to.name}, linha ${index + 1}`);
      context.put(item, group.to, line.quantity);
    }
    pending.push(group);
  }

  const transfers: { id: string; from_location_id: string; to_location_id: string; lines: number }[] = [];
  for (const group of pending) {
    await transferStock(db, { companyId, fromLocationId: group.from.id, toLocationId: group.to.id, lines: group.lines, userId: actor.userId, note: group.note, transferId: group.id });
    transfers.push({ id: group.id, from_location_id: group.from.id, to_location_id: group.to.id, lines: group.lines.length });
  }
  return { transfers, updated: await writeNotes(db, companyId, notes) };
}
