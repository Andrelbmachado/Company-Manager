// TEMPORÁRIO (dados de exemplo): estoque — uma contagem de inventário concluída (com ajuste de sobra e de falta),
// uma contagem aberta e uma transferência entre locais (se houver dois). Saldos acertados junto com cada movimentação.
// Precisa de itens com saldo; sem eles não grava nada (nem a flag).
import { getDb } from "@/lib/db/client";
import { nextSequenceNumber } from "@/lib/db/sequence";
import { applyStockMovement, hasSeedFlag, insertRows, memberFor, membersByRole, selectAll, selectRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "inventory";

interface LocationRow {
  id: string;
  name: string;
}
interface BalanceRow {
  id: string;
  item_id: string;
  location_id: string;
  quantity: number;
}
interface ItemRow {
  id: string;
  cost?: number | null;
}

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const locations = await selectRows<LocationRow>("stock_locations", companyId);
  const items = await selectRows<ItemRow>("inventory_items", companyId);
  const itemIds = new Set(items.map((item) => item.id));
  const balances = (await selectAll<BalanceRow>("stock_balances", companyId)).filter((row) => itemIds.has(row.item_id) && Number(row.quantity) > 0);
  if (locations.length === 0 || balances.length < 3) return;

  const db = await getDb();
  const members = await membersByRole(companyId);
  const stockUser = memberFor(members, "estoquista", "admin", "ceo");
  const costOf = new Map(items.map((item) => [item.id, Number(item.cost ?? 0)]));

  // Local com mais itens: é onde acontecem as contagens.
  const perLocation = new Map<string, BalanceRow[]>();
  for (const row of balances) perLocation.set(row.location_id, [...(perLocation.get(row.location_id) ?? []), row]);
  const [mainLocation, mainBalances] = [...perLocation.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  // ---- Contagem concluída: um item confere, um tem falta de 1 e outro sobra de 2 --------------------------------
  const done = mainBalances.slice(0, 3);
  const countedDone = [Number(done[0].quantity), Number(done[1].quantity) - 1, Number(done[2].quantity) + 2];
  const doneId = "dev-inventory-count-1";
  const doneNumber = await nextSequenceNumber(db, "inventory_counts", companyId);
  await insertRows("inventory_counts", companyId, [
    { id: doneId, number: doneNumber, location_id: mainLocation, status: "concluida", started_at: ts(-6, 8), finished_at: ts(-6, 11), counted_by: stockUser, notes: "Contagem mensal das prateleiras de rede." },
  ]);
  const doneItems: SeedRow[] = [];
  for (const [index, balance] of done.entries()) {
    const difference = countedDone[index] - Number(balance.quantity);
    let movementId: string | null = null;
    if (difference !== 0) {
      movementId = `dev-inventory-adjust-${index + 1}`;
      const applied = await applyStockMovement(companyId, {
        id: movementId,
        item_id: balance.item_id,
        type: "ajuste",
        quantity: Math.abs(difference),
        // Sobra entra no local (to); falta sai do local (from).
        from_location_id: difference < 0 ? mainLocation : null,
        to_location_id: difference > 0 ? mainLocation : null,
        unit_cost: costOf.get(balance.item_id) ?? 0,
        ref_type: "inventory_count",
        ref_id: doneId,
        user_id: stockUser,
        note: difference < 0 ? "Ajuste de inventário: falta" : "Ajuste de inventário: sobra",
        created_at: ts(-6, 11),
      });
      if (!applied) movementId = null;
    }
    doneItems.push({
      id: `${doneId}-item-${index + 1}`,
      count_id: doneId,
      item_id: balance.item_id,
      location_id: mainLocation,
      expected_qty: Number(balance.quantity),
      counted_qty: countedDone[index],
      adjustment_movement_id: movementId,
      notes: difference < 0 ? "Uma unidade não localizada." : difference > 0 ? "Caixa fechada encontrada no fundo da prateleira." : null,
    });
  }
  await insertRows("inventory_count_items", companyId, doneItems);

  // ---- Contagem aberta: dois itens já contados, um ainda não ------------------------------------------------------
  const current = new Map((await selectAll<BalanceRow>("stock_balances", companyId)).map((row) => [row.id, Number(row.quantity)]));
  const open = (mainBalances.length >= 6 ? mainBalances.slice(3, 6) : mainBalances.slice(0, 3)).map((row) => ({ ...row, quantity: current.get(row.id) ?? Number(row.quantity) }));
  const openId = "dev-inventory-count-2";
  await insertRows("inventory_counts", companyId, [
    { id: openId, number: await nextSequenceNumber(db, "inventory_counts", companyId), location_id: mainLocation, status: "aberta", started_at: ts(0, 8), counted_by: stockUser, notes: "Contagem rotativa de periféricos." },
  ]);
  await insertRows("inventory_count_items", companyId, open.map((balance, index) => ({
    id: `${openId}-item-${index + 1}`,
    count_id: openId,
    item_id: balance.item_id,
    location_id: mainLocation,
    expected_qty: Number(balance.quantity),
    counted_qty: index < 2 ? Number(balance.quantity) : null,
  })));

  // ---- Transferência de 2 unidades para o segundo local -------------------------------------------------------------
  const other = locations.find((location) => location.id !== mainLocation);
  const source = mainBalances.slice(3).find((row) => Number(row.quantity) >= 4) ?? mainBalances.find((row) => Number(row.quantity) >= 4);
  if (other && source) {
    await applyStockMovement(companyId, {
      id: "dev-inventory-transfer-1",
      item_id: source.item_id,
      type: "transferencia",
      quantity: 2,
      from_location_id: mainLocation,
      to_location_id: other.id,
      unit_cost: costOf.get(source.item_id) ?? 0,
      ref_type: "transfer",
      ref_id: null,
      user_id: stockUser,
      note: `Reposição do ${other.name}`,
      created_at: ts(-3, 15),
    });
  }

  await setSeedFlag(AREA, companyId);
}
