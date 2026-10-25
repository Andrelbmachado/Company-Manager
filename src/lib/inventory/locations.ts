// Locais de estoque (depósito, almoxarifado, loja, veículo...): cadastro, resumo do que há em cada um e arquivamento.
// SQL nos padrões do banco demo; somas em TypeScript.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import { lineTotal, sumMoney } from "@/lib/money";
import type { InventoryCount, InventoryItem, StockBalance, StockLocation } from "@/types";
import { assertCan, assertCanSaveRows, type Actor } from "./permission";
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

const LOCATION_FIELDS = ["name", "type", "address"] as const;
type LocationField = (typeof LOCATION_FIELDS)[number];

export interface LocationRowChanges {
  updated: readonly (Partial<StockLocation> & { id: string })[];
  created: readonly Partial<StockLocation>[];
}

const cleanText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
};

/**
 * Grava a tabela de locais (Estoque > Locais): `updated` = só os campos alterados (e o id), `created` = linhas novas com
 * o id gerado pela tela (salvar de novo depois de uma falha não duplica). Exige `edit`/`create` em `inventory`. Tudo
 * é conferido antes de gravar (nome obrigatório e único entre os ativos, também entre as linhas novas): uma linha com
 * erro e nenhuma é gravada.
 */
export async function saveLocationRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  changes: LocationRowChanges,
): Promise<{ created: { id: string; name: string }[]; updated: { id: string; name: string }[] }> {
  assertCanSaveRows(actor, "inventory", "locais de estoque", changes);
  const current = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const byId = new Map(current.map((row) => [row.id, row]));
  const plans: { kind: "create" | "update"; id: string; name: string; type: string; address: string | null; fields: LocationField[] }[] = [];
  const valuesOf = (source: Partial<StockLocation>) => {
    const name = cleanText(source.name);
    if (!name) throw new StockError("nome_invalido", "Informe o nome do local.");
    return { name, type: cleanText(source.type) ?? "deposito", address: cleanText(source.address) };
  };

  for (const patch of changes.updated) {
    const row = byId.get(patch.id);
    if (!row) throw new StockError("local_invalido", "Local de estoque não encontrado (excluído ou de outra empresa). Atualize a lista.");
    const fields = LOCATION_FIELDS.filter((field) => field in patch);
    if (fields.length === 0) continue;
    plans.push({ kind: "update", id: row.id, fields, ...valuesOf({ ...row, ...Object.fromEntries(fields.map((field) => [field, patch[field]])) }) });
  }
  for (const row of changes.created) {
    const id = cleanText(row.id) ?? uuidv4();
    // Linha nova gravada numa tentativa anterior que falhou depois dela: não grava de novo.
    if ((await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    plans.push({ kind: "create", id, fields: [...LOCATION_FIELDS], ...valuesOf(row) });
  }

  const finalNames = new Map(current.map((row) => [row.id, nameKey(row.name)]));
  for (const plan of plans) finalNames.set(plan.id, nameKey(plan.name));
  for (const plan of plans) {
    if (!plan.fields.includes("name")) continue;
    if ([...finalNames.entries()].some(([id, key]) => id !== plan.id && key === nameKey(plan.name))) {
      throw new StockError("nome_repetido", `Já existe um local chamado "${plan.name}".`);
    }
  }

  const result = { created: [] as { id: string; name: string }[], updated: [] as { id: string; name: string }[] };
  for (const plan of plans) {
    if (plan.kind === "update") {
      await db.execute(`UPDATE stock_locations SET ${plan.fields.map((field) => `${field}=?`).join(", ")}, updated_at=datetime('now') WHERE company_id=? AND id=? AND deleted_at IS NULL`, [
        ...plan.fields.map((field) => plan[field]),
        companyId,
        plan.id,
      ]);
      result.updated.push({ id: plan.id, name: plan.name });
    } else {
      await db.execute("INSERT INTO stock_locations (id, company_id, name, type, address) VALUES (?, ?, ?, ?, ?)", [plan.id, companyId, plan.name, plan.type, plan.address]);
      result.created.push({ id: plan.id, name: plan.name });
    }
  }
  return result;
}

/** Arquiva o local pela tabela (exige `delete` em `inventory`); as regras de local vazio são as de archiveStockLocation. */
export async function archiveLocationRow(db: DatabaseLike, companyId: string, actor: Actor, locationId: string): Promise<void> {
  assertCan(actor, "delete", "inventory", "locais de estoque");
  await archiveStockLocation(db, { companyId, locationId });
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
