// Motor de estoque multi-local: toda entrada, saída, transferência e ajuste passa por aqui, grava a movimentação
// (stock_movements) e acerta os saldos por local (stock_balances) sem nunca deixar saldo negativo.
//
// Sem transação: o tauri-plugin-sql usa um pool de conexões (BEGIN e COMMIT podem cair em conexões diferentes) e o
// banco demo não tem transação. Por isso: (1) tudo é validado antes da primeira gravação; (2) cada saldo é gravado com
// "compare-and-set" (UPDATE ... WHERE quantity = <valor lido>), então se outra janela mexeu no saldo no meio do caminho
// a gravação é recusada em vez de passar do zero; (3) se um passo falhar, os passos já feitos são desfeitos.
// SQL só nos padrões do banco demo (SELECT * com WHERE col=?, uma linha por INSERT); somas e junções em TypeScript.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney } from "@/lib/money";
import type { InventoryItem, StockBalance, StockLocation, StockMovementType } from "@/types";

export type StockErrorCode =
  | "quantidade_invalida"
  | "saldo_insuficiente"
  | "locais_invalidos"
  | "mesmo_local"
  | "local_invalido"
  | "item_invalido"
  | "sem_itens"
  | "conflito"
  | "nome_invalido"
  | "nome_repetido"
  | "local_com_saldo"
  | "contagem_aberta"
  | "contagem_invalida"
  | "contagem_fechada"
  | "contagem_incompleta"
  | "item_repetido"
  | "valor_invalido";

/** Erro de regra de estoque, com mensagem pronta para a tela (pt-BR). */
export class StockError extends Error {
  readonly code: StockErrorCode;

  constructor(code: StockErrorCode, message: string) {
    super(message);
    this.name = "StockError";
    this.code = code;
  }
}

/** Quantidades com até 3 casas (metros, kg): sem isso 0,1 + 0,2 vira 0,30000000000000004. */
export function roundQty(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Number((Math.abs(value) * 1000).toPrecision(15)))) / 1000 || 0;
}

const QTY_FORMAT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** "1.234,5 cx" — quantidade para a tela. */
export function formatQty(value: number | null | undefined, unit?: string | null): string {
  const text = QTY_FORMAT.format(Number(value ?? 0));
  return unit ? `${text} ${unit}` : text;
}

/** Quantidade de uma movimentação: número finito e maior que zero (arredondado a 3 casas). */
export function validQuantity(value: number): number {
  const quantity = typeof value === "number" && Number.isFinite(value) ? roundQty(value) : Number.NaN;
  if (!(quantity > 0)) throw new StockError("quantidade_invalida", "Informe uma quantidade maior que zero.");
  return quantity;
}

export async function activeItem(db: DatabaseLike, companyId: string, itemId: string): Promise<InventoryItem> {
  const rows = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, itemId]);
  if (!rows[0]) throw new StockError("item_invalido", "Item não encontrado no estoque (excluído ou de outra empresa).");
  return rows[0];
}

export async function activeLocation(db: DatabaseLike, companyId: string, locationId: string): Promise<StockLocation> {
  const rows = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, locationId]);
  if (!rows[0]) throw new StockError("local_invalido", "Local de estoque não encontrado (excluído ou de outra empresa).");
  return rows[0];
}

/** Saldos do item em todos os locais da empresa. */
export async function itemBalances(db: DatabaseLike, companyId: string, itemId: string): Promise<StockBalance[]> {
  return db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=? AND item_id=?", [companyId, itemId]);
}

/** Saldo do item no local (0 quando o local ainda não tem o item). */
export function quantityAt(balances: readonly StockBalance[], locationId: string): number {
  return roundQty(Number(balances.find((row) => row.location_id === locationId)?.quantity ?? 0));
}

function checkDirection(type: StockMovementType, from: string | null, to: string | null): void {
  const ok =
    type === "entrada" ? !from && !!to
    : type === "saida" ? !!from && !to
    : type === "transferencia" ? !!from && !!to
    : type === "ajuste" ? !!from !== !!to
    : false;
  if (!ok) {
    const rule: Record<StockMovementType, string> = {
      entrada: "uma entrada precisa só do local de destino",
      saida: "uma saída precisa só do local de origem",
      transferencia: "uma transferência precisa do local de origem e do de destino",
      ajuste: "um ajuste usa só a origem (falta) ou só o destino (sobra)",
    };
    throw new StockError("locais_invalidos", `Locais incompatíveis com o tipo: ${rule[type] ?? "tipo de movimentação desconhecido"}.`);
  }
  if (from && from === to) throw new StockError("mesmo_local", "A origem e o destino são o mesmo local.");
}

function rowsAffected(result: unknown): number | null {
  const value = (result as { rowsAffected?: unknown } | null)?.rowsAffected;
  return typeof value === "number" ? value : null;
}

const CONFLICT_MESSAGE = "O saldo mudou enquanto a operação era gravada (outra janela ou pessoa mexeu no estoque). Confira os saldos e tente de novo.";

/** Grava o saldo novo só se ele ainda for o lido (compare-and-set). */
async function setBalance(db: DatabaseLike, companyId: string, balanceId: string, expected: number, next: number): Promise<void> {
  const result = await db.execute(
    "UPDATE stock_balances SET quantity=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND quantity=?",
    [next, companyId, balanceId, expected],
  );
  if (rowsAffected(result) === 0) throw new StockError("conflito", CONFLICT_MESSAGE);
}

type Undo = () => Promise<unknown>;

async function rollback(steps: Undo[]): Promise<void> {
  for (const step of [...steps].reverse()) {
    try {
      await step();
    } catch (error) {
      console.error("[estoque] falha ao desfazer um passo", error);
    }
  }
}

function insufficient(item: InventoryItem, location: StockLocation, available: number, requested: number): StockError {
  return new StockError(
    "saldo_insuficiente",
    `Saldo insuficiente de "${item.name}" em ${location.name}: disponível ${formatQty(available, item.unit)}, pedido ${formatQty(requested, item.unit)}.`,
  );
}

interface PlannedMovement {
  id: string;
  companyId: string;
  item: InventoryItem;
  type: StockMovementType;
  quantity: number;
  from: StockLocation | null;
  to: StockLocation | null;
  balances: StockBalance[];
  unitCost: number;
  refType: string;
  refId: string | null;
  userId: string | null;
  note: string | null;
}

/** Aplica uma movimentação já validada; cada passo feito entra em `undo`. */
async function applyMovement(db: DatabaseLike, plan: PlannedMovement, undo: Undo[]): Promise<void> {
  const { companyId, quantity } = plan;
  if (plan.from) {
    const row = plan.balances.find((balance) => balance.location_id === plan.from!.id);
    const available = roundQty(Number(row?.quantity ?? 0));
    if (!row || available < quantity) throw insufficient(plan.item, plan.from, available, quantity);
    const current = Number(row.quantity);
    const next = roundQty(available - quantity);
    await setBalance(db, companyId, row.id, current, next);
    undo.push(() => setBalance(db, companyId, row.id, next, current));
  }
  if (plan.to) {
    const row = plan.balances.find((balance) => balance.location_id === plan.to!.id);
    if (row) {
      const current = Number(row.quantity);
      const next = roundQty(current + quantity);
      await setBalance(db, companyId, row.id, current, next);
      undo.push(() => setBalance(db, companyId, row.id, next, current));
    } else {
      const balanceId = uuidv4();
      try {
        await db.execute(
          "INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
          [balanceId, companyId, plan.item.id, plan.to.id, quantity],
        );
      } catch (error) {
        // UNIQUE(item_id, location_id): outra gravação criou o saldo deste item neste local agora há pouco.
        if (/unique/i.test(String((error as Error)?.message ?? error))) throw new StockError("conflito", CONFLICT_MESSAGE);
        throw error;
      }
      // Saldo criado por esta operação: desfazer apaga a linha (só se ainda tiver a quantidade que ela gravou).
      undo.push(async () => {
        const result = await db.execute("DELETE FROM stock_balances WHERE company_id=? AND id=? AND quantity=?", [companyId, balanceId, quantity]);
        if (rowsAffected(result) === 0) throw new StockError("conflito", CONFLICT_MESSAGE);
      });
    }
  }
  await db.execute(
    `INSERT INTO stock_movements (id, company_id, item_id, type, quantity, from_location_id, to_location_id, ref_type, ref_id, user_id, note, unit_cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      plan.id,
      companyId,
      plan.item.id,
      plan.type,
      quantity,
      plan.from?.id ?? null,
      plan.to?.id ?? null,
      plan.refType,
      plan.refId,
      plan.userId,
      plan.note,
      plan.unitCost,
      new Date().toISOString(),
    ],
  );
  // Desfazer só acontece logo depois de um erro na mesma operação: a linha recém-criada some como se nunca tivesse existido.
  undo.push(() => db.execute("DELETE FROM stock_movements WHERE company_id=? AND id=?", [companyId, plan.id]));
}

export interface StockMovementInput {
  companyId: string;
  itemId: string;
  type: StockMovementType;
  /** Sempre positiva; o sentido vem dos locais. */
  quantity: number;
  /** Origem: saída, transferência e ajuste de falta. */
  fromLocationId?: string | null;
  /** Destino: entrada, transferência e ajuste de sobra. */
  toLocationId?: string | null;
  /** Custo unitário da movimentação (gravado em centavos); padrão = custo do item. */
  unitCost?: number | null;
  /** Origem do lançamento (goods_receipt, sales_order, inventory_count, transfer); padrão "manual". */
  refType?: string | null;
  refId?: string | null;
  userId?: string | null;
  note?: string | null;
  id?: string;
}

function plannedFrom(input: StockMovementInput, quantity: number, item: InventoryItem, from: StockLocation | null, to: StockLocation | null, balances: StockBalance[]): PlannedMovement {
  const itemCost = Number(item.cost ?? 0);
  const typed = typeof input.unitCost === "number" && Number.isFinite(input.unitCost) && input.unitCost >= 0 ? input.unitCost : null;
  // Dinheiro em centavos (AGENTS §4): o custo do item pode ter mais casas (cadastro antigo ou importado).
  const unitCost = roundMoney(typed ?? (Number.isFinite(itemCost) ? itemCost : 0));
  return {
    id: input.id ?? uuidv4(),
    companyId: input.companyId,
    item,
    type: input.type,
    quantity,
    from,
    to,
    balances,
    unitCost,
    refType: input.refType?.trim() || "manual",
    refId: input.refId ?? null,
    userId: input.userId ?? null,
    note: input.note?.trim() || null,
  };
}

/**
 * Grava uma movimentação (entrada, saída, transferência ou ajuste) e acerta os saldos dos locais. Recusa (StockError)
 * quantidade inválida, locais que não batem com o tipo, item ou local excluído/de outra empresa e saída maior que o
 * saldo do local de origem. Devolve o id da movimentação.
 */
export async function recordStockMovement(db: DatabaseLike, input: StockMovementInput): Promise<string> {
  return (await recordStockMovementUndoable(db, input)).id;
}

export interface RecordedMovement {
  id: string;
  /** Desfaz a movimentação (saldos de volta e a linha removida). Só para voltar uma operação maior que falhou logo depois. */
  undo: () => Promise<void>;
}

/**
 * Igual a `recordStockMovement`, mas devolve também como desfazer: para quem grava outros registros junto com a
 * movimentação (entrega de pedido de venda, recebimento e estorno de compra) e precisa voltar tudo se um deles falhar.
 */
export async function recordStockMovementUndoable(db: DatabaseLike, input: StockMovementInput): Promise<RecordedMovement> {
  const quantity = validQuantity(input.quantity);
  const fromId = input.fromLocationId || null;
  const toId = input.toLocationId || null;
  checkDirection(input.type, fromId, toId);
  const item = await activeItem(db, input.companyId, input.itemId);
  const from = fromId ? await activeLocation(db, input.companyId, fromId) : null;
  const to = toId ? await activeLocation(db, input.companyId, toId) : null;
  const balances = await itemBalances(db, input.companyId, item.id);
  if (from && quantityAt(balances, from.id) < quantity) throw insufficient(item, from, quantityAt(balances, from.id), quantity);

  const plan = plannedFrom(input, quantity, item, from, to, balances);
  const undo: Undo[] = [];
  try {
    await applyMovement(db, plan, undo);
  } catch (error) {
    await rollback(undo);
    throw error;
  }
  return { id: plan.id, undo: () => undoAll(undo) };
}

/** Desfaz todos os passos (em ordem inversa) e, se algum falhar, repassa o primeiro erro no fim. */
async function undoAll(steps: Undo[]): Promise<void> {
  let failure: unknown = null;
  for (const step of [...steps].reverse()) {
    try {
      await step();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

export interface TransferLine {
  itemId: string;
  quantity: number;
}

export interface TransferInput {
  companyId: string;
  fromLocationId: string;
  toLocationId: string;
  lines: readonly TransferLine[];
  userId?: string | null;
  note?: string | null;
}

export interface TransferResult {
  /** ref_id comum às movimentações desta transferência. */
  transferId: string;
  movementIds: string[];
}

/**
 * Transferência entre locais, com um ou vários itens. O mesmo item em duas linhas soma antes de conferir o saldo.
 * Tudo é conferido antes de gravar: se um item não tem saldo na origem, nada é transferido (nem as linhas boas).
 */
export async function transferStock(db: DatabaseLike, input: TransferInput): Promise<TransferResult> {
  if (input.lines.length === 0) throw new StockError("sem_itens", "Adicione pelo menos um item à transferência.");
  if (!input.fromLocationId || !input.toLocationId) throw new StockError("locais_invalidos", "Escolha o local de origem e o de destino.");
  if (input.fromLocationId === input.toLocationId) throw new StockError("mesmo_local", "A origem e o destino são o mesmo local.");

  const totals = new Map<string, number>();
  for (const line of input.lines) {
    if (!line.itemId) throw new StockError("item_invalido", "Escolha o item de cada linha.");
    totals.set(line.itemId, roundQty((totals.get(line.itemId) ?? 0) + validQuantity(line.quantity)));
  }
  const from = await activeLocation(db, input.companyId, input.fromLocationId);
  const to = await activeLocation(db, input.companyId, input.toLocationId);

  const transferId = uuidv4();
  const plans: PlannedMovement[] = [];
  const shortages: string[] = [];
  for (const [itemId, quantity] of totals) {
    const item = await activeItem(db, input.companyId, itemId);
    const balances = await itemBalances(db, input.companyId, itemId);
    const available = quantityAt(balances, from.id);
    if (available < quantity) shortages.push(`"${item.name}" (disponível ${formatQty(available, item.unit)}, pedido ${formatQty(quantity, item.unit)})`);
    plans.push(plannedFrom({ companyId: input.companyId, itemId, type: "transferencia", quantity, refType: "transfer", refId: transferId, userId: input.userId, note: input.note }, quantity, item, from, to, balances));
  }
  if (shortages.length > 0) {
    throw new StockError("saldo_insuficiente", `Saldo insuficiente em ${from.name}: ${shortages.join("; ")}. Nada foi transferido.`);
  }

  const undo: Undo[] = [];
  try {
    for (const plan of plans) await applyMovement(db, plan, undo);
  } catch (error) {
    await rollback(undo);
    throw error;
  }
  return { transferId, movementIds: plans.map((plan) => plan.id) };
}
