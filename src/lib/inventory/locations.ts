// Locais de estoque (depósito, almoxarifado, loja, veículo...): cadastro, resumo do que há em cada um e arquivamento.
// SQL nos padrões do banco demo; somas em TypeScript.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import { lineTotal, sumMoney } from "@/lib/money";
import type { InventoryCount, InventoryItem, StockBalance, StockLocation } from "@/types";
import { byName } from "./queries";
import { activeLocation, formatQty, roundQty, StockError } from "./stock";

export const LOCATION_TYPES = [
  { value: "deposito", label: "Depósito" },
  { value: "almoxarifado", label: "Almoxarifado" },
  { value: "loja", label: "Loja" },
  { value: "veiculo", label: "Veículo" },
  { value: "terceiros", label: "Em terceiros" },
  { value: "outro", label: "Outro" },
] as const;

export function locationTypeLabel(type: string | null | undefined): string {
  return LOCATION_TYPES.find((option) => option.value === type)?.label ?? (type ? type : "Depósito");
}

function nameKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface LocationInput {
  companyId: string;
  /** Sem id: cria. */
  id?: string | null;
  name: string;
  type?: string | null;
  address?: string | null;
}

/** Cria ou edita um local. Nome obrigatório e único entre os locais ativos (sem diferenciar maiúsculas e acentos). */
export async function saveStockLocation(db: DatabaseLike, input: LocationInput): Promise<string> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new StockError("nome_invalido", "Informe o nome do local.");
  if (input.id) await activeLocation(db, input.companyId, input.id);
  const others = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [input.companyId]);
  if (others.some((row) => row.id !== input.id && nameKey(row.name) === nameKey(name))) {
    throw new StockError("nome_repetido", `Já existe um local chamado "${name}".`);
  }
  const type = input.type?.trim() || "deposito";
  const address = input.address?.trim() || null;
  if (input.id) {
    await db.execute("UPDATE stock_locations SET name=?, type=?, address=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [name, type, address, input.companyId, input.id]);
    return input.id;
  }
  const id = uuidv4();
  await db.execute("INSERT INTO stock_locations (id, company_id, name, type, address) VALUES (?, ?, ?, ?, ?)", [id, input.companyId, name, type, address]);
  return id;
}

async function openCountsAt(db: DatabaseLike, companyId: string, locationId: string): Promise<InventoryCount[]> {
  return db.select<InventoryCount[]>(
    "SELECT * FROM inventory_counts WHERE company_id=? AND location_id=? AND status='aberta' AND deleted_at IS NULL",
    [companyId, locationId],
  );
}

/**
 * Arquiva (soft delete) um local vazio: com saldo de item ativo ou com contagem aberta, recusa. Saldo de item excluído
 * não conta (como no resumo dos locais): ele não aparece em lugar nenhum e não pode mais ser movimentado.
 */
export async function archiveStockLocation(db: DatabaseLike, input: { companyId: string; locationId: string }): Promise<void> {
  const location = await activeLocation(db, input.companyId, input.locationId);
  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=? AND location_id=?", [input.companyId, location.id]);
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [input.companyId]);
  const active = new Set(items.map((item) => item.id));
  const stocked = balances.filter((row) => active.has(row.item_id) && roundQty(Number(row.quantity ?? 0)) !== 0);
  if (stocked.length > 0) {
    const total = roundQty(stocked.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0));
    throw new StockError(
      "local_com_saldo",
      `${location.name} ainda tem ${stocked.length} ite${stocked.length > 1 ? "ns" : "m"} em estoque (${formatQty(total)} unidades). Transfira ou dê baixa antes de arquivar.`,
    );
  }
  const open = await openCountsAt(db, input.companyId, location.id);
  if (open[0]) throw new StockError("contagem_aberta", `A contagem ${formatSequence("inventory_counts", open[0].number)} está aberta em ${location.name}. Conclua ou cancele antes de arquivar.`);
  await db.execute("UPDATE stock_locations SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [input.companyId, location.id]);
}

export interface LocationSummary extends StockLocation {
  /** Itens com saldo diferente de zero. */
  item_count: number;
  total_qty: number;
  /** Saldo × custo do item. */
  stock_value: number;
  open_count_id: string | null;
  open_count_number: number | null;
}

/** Locais ativos, por nome, com o que há em cada um e a contagem aberta (se houver). */
export async function listLocationSummaries(db: DatabaseLike, companyId: string): Promise<LocationSummary[]> {
  const locations = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const counts = await db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND status='aberta' AND deleted_at IS NULL", [companyId]);
  const costOf = new Map(items.map((item) => [item.id, Number(item.cost ?? 0) || 0]));
  return [...locations].sort(byName).map((location) => {
    const here = balances.filter((row) => row.location_id === location.id && costOf.has(row.item_id) && roundQty(Number(row.quantity ?? 0)) !== 0);
    const open = counts.filter((count) => count.location_id === location.id).sort((a, b) => a.number - b.number)[0];
    return {
      ...location,
      item_count: here.length,
      total_qty: roundQty(here.reduce((sum, row) => sum + Number(row.quantity), 0)),
      stock_value: sumMoney(here.map((row) => lineTotal(Number(row.quantity), costOf.get(row.item_id) ?? 0))),
      open_count_id: open?.id ?? null,
      open_count_number: open?.number ?? null,
    };
  });
}
