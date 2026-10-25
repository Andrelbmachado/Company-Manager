// @vitest-environment jsdom
// As gravações das tabelas editáveis de Logística também rodam no banco demo do navegador (localStorage), que só entende
// SQL simples: SQL fora dos padrões é erro.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { deleteSupplierRow, saveSupplierRows, toSupplierTableRows } from "@/lib/erp/supplierRows";
import { listWorkOrders, saveWorkOrderRows } from "@/lib/operations/workOrders";
import type { Supplier } from "@/types";
import { saveCountLineRows, saveCountRows } from "./countRows";
import { deleteCustody, listCustodies, saveCustodyRows } from "./custody";
import { loadInventoryCount } from "./counts";
import { deleteInventoryItem, saveInventoryItemRows } from "./items";
import { archiveLocationRow, saveLocationRows } from "./locations";
import { saveMovementRows, saveTransferRows } from "./movementRows";
import { loadStockSnapshot } from "./queries";

const C = DEMO_COMPANY_ID;
const MAIN = "demo-stock-location";
const admin = { role: "admin" as const, userId: "demo-admin" };

beforeEach(() => localStorage.clear());

describe("tabelas editáveis de Logística no banco demo", () => {
  it("itens, locais, movimentações e transferências", async () => {
    const db = createDemoDb();
    await saveInventoryItemRows(db, C, admin, { updated: [{ id: "item-5", cost: 50.5 }], created: [{ id: "novo-item", name: "Parafuso", unit: "cx" }] });
    await saveLocationRows(db, C, admin, { updated: [], created: [{ id: "novo-local", name: "Van 1", type: "veiculo" }] });
    await saveMovementRows(db, C, admin, { updated: [], created: [{ id: "mov-1", kind: "entrada", item_id: "novo-item", location_id: MAIN, quantity: 10, unit_cost: 2 }] });
    await saveTransferRows(db, C, admin, { updated: [], created: [{ id: "tr-1", item_id: "novo-item", from_location_id: MAIN, to_location_id: "novo-local", quantity: 4 }] });
    await saveTransferRows(db, C, admin, { updated: [], created: [{ id: "tr-1", item_id: "novo-item", from_location_id: MAIN, to_location_id: "novo-local", quantity: 4 }] });
    await saveMovementRows(db, C, admin, { updated: [{ id: "mov-1", note: "NF 123" }], created: [] });
    const snapshot = await loadStockSnapshot(db, C);
    const item = snapshot.items.find((row) => row.id === "novo-item")!;
    expect(item.byLocation[MAIN]).toBe(6);
    expect(item.byLocation["novo-local"]).toBe(4);
    expect(snapshot.items.find((row) => row.id === "item-5")!.cost).toBe(50.5);
    await expect(archiveLocationRow(db, C, admin, "novo-local")).rejects.toThrow(/ainda tem/);
    await deleteInventoryItem(db, C, admin, "novo-item");
  });

  it("contagens pela lista e pela folha", async () => {
    const db = createDemoDb();
    const { created } = await saveCountRows(db, C, admin, { updated: [], created: [{ id: "cnt-1", location_id: MAIN, notes: "Mensal" }] });
    expect(created[0]).toEqual({ id: "cnt-1", number: 1 });
    const detail = await loadInventoryCount(db, C, "cnt-1");
    const line = detail!.items[0];
    await saveCountLineRows(db, C, admin, "cnt-1", { updated: [{ id: line.id, counted_qty: 3, notes: "ok" }], created: [] });
    await saveCountRows(db, C, admin, { updated: [{ id: "cnt-1", notes: "Mensal (refeita)" }], created: [] });
    const after = await loadInventoryCount(db, C, "cnt-1");
    expect(after!.count.notes).toBe("Mensal (refeita)");
    expect(after!.items.find((row) => row.id === line.id)).toMatchObject({ counted_qty: 3, notes: "ok" });
  });

  it("custódia, ordens de serviço e fornecedores", async () => {
    const db = createDemoDb();
    await saveCustodyRows(db, C, admin, { updated: [{ id: "custody-1", status: "devolvido" }], created: [{ id: "cus-novo", item_id: "item-5", quantity: 2, due_back_at: "2026-11-10" }] });
    const custodies = await listCustodies(db, C);
    expect(custodies.find((row) => row.id === "custody-1")?.returned_at).toBeTruthy();
    expect(custodies.find((row) => row.id === "cus-novo")).toMatchObject({ item_name: "Mouse USB corporativo", holder_id: "demo-admin" });
    await deleteCustody(db, C, admin, "cus-novo");
    expect((await listCustodies(db, C)).some((row) => row.id === "cus-novo")).toBe(false);

    await saveWorkOrderRows(db, C, admin, { updated: [{ id: "wo-1", status: "concluida" }], created: [{ id: "wo-novo", customer_id: "customer-1", sla_due_at: "2026-11-01" }] });
    const orders = await listWorkOrders(db, C);
    expect(orders.find((row) => row.id === "wo-novo")).toMatchObject({ number: "OS-0006", status: "aberta" });
    expect(orders.find((row) => row.id === "wo-1")?.closed_at).toBeTruthy();

    await saveSupplierRows(db, C, admin, { updated: [{ id: "supplier-1", cidade: "Barueri" }], created: [{ id: "sup-novo", name: "Nova Distribuidora", document: "45.723.174/0001-10" }] });
    const suppliers = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [C]);
    const rows = toSupplierTableRows(suppliers, []);
    expect(rows.find((row) => row.id === "supplier-1")?.cidade).toBe("Barueri");
    await deleteSupplierRow(db, C, admin, "sup-novo");
    expect((await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [C])).some((row) => row.id === "sup-novo")).toBe(false);
  });
});
