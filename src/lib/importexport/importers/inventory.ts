// Estoque: cada linha é um item num local, com a quantidade contada. O item (inventory_items) é identificado pelo
// SKU, depois pelo nome; o mesmo item pode vir em várias linhas, uma por local. A quantidade vira saldo
// (stock_balances) e a diferença para o saldo anterior fica registrada como movimento de "ajuste", como na contagem
// de inventário. Linha sem quantidade só cadastra/atualiza o item.
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { DatabaseLike } from "@/lib/db/demo";
import { locationRef, supplierField, supplierRef } from "../refs";
import type { FieldDef, ImportEntity, RowIssue, UpsertContext } from "../registry";
import { decimal, money, optionalText, requiredText } from "../schema";
import { buildPlan, byAge, codeKey, diffColumns, keyOf, loadActive, loadRefs, stripEmpty, type PlannedRow, type TableEntitySpec } from "../tableEntity";
import { insertRows, sqliteNow, updateRows, type Row, type RowUpdate } from "../write";

const fields: FieldDef[] = [
  { key: "name", label: "Item", kind: "text", required: true, aliases: ["nome", "produto", "descrição", "material"], example: "Papel A4 (resma)" },
  { key: "sku", label: "Código (SKU)", kind: "text", aliases: ["sku", "código", "codigo", "cód", "referência"], example: "PAP-A4" },
  { key: "category", label: "Categoria", kind: "text", aliases: ["grupo", "família"], example: "Escritório" },
  { key: "unit", label: "Unidade", kind: "text", aliases: ["un", "unid", "unidade de medida"], example: "un" },
  { key: "quantity", label: "Quantidade", kind: "number", aliases: ["qtd", "qtde", "saldo", "estoque", "quantidade em estoque", "contagem"], example: "40" },
  { key: "location", label: "Local", kind: "text", aliases: ["local de estoque", "depósito", "deposito", "almoxarifado"], example: "Depósito principal", hint: "Nome de um local de estoque cadastrado" },
  { key: "min_stock", label: "Estoque mínimo", kind: "number", aliases: ["mínimo", "minimo", "ponto de pedido"], example: "10" },
  { key: "max_stock", label: "Estoque máximo", kind: "number", aliases: ["máximo", "maximo"], example: "100" },
  { key: "cost", label: "Custo unitário", kind: "money", aliases: ["custo", "preço de custo", "valor unitário"], example: "24,90" },
  supplierField(),
];

const schema = z
  .object({
    name: requiredText(200),
    sku: optionalText(60),
    category: optionalText(120),
    unit: optionalText(20),
    quantity: decimal(0).optional(),
    location: optionalText(200),
    min_stock: decimal(0).optional(),
    max_stock: decimal(0).optional(),
    cost: money({ min: 0 }).optional(),
    supplier: optionalText(200),
  })
  .superRefine((row, context) => {
    if (row.min_stock !== undefined && row.max_stock !== undefined && row.max_stock < row.min_stock) {
      context.addIssue({ code: "custom", path: ["max_stock"], message: "O estoque máximo é menor que o mínimo" });
    }
  });

export type InventoryImportRow = z.infer<typeof schema>;

const ITEM_COLUMNS = ["name", "sku", "category", "unit", "min_stock", "max_stock", "cost", "supplier_id"] as const;

/** Descrição do cadastro do item (sem local/quantidade, que vão para o saldo). */
const itemSpec: TableEntitySpec<InventoryImportRow> = {
  key: "inventory",
  label: "Estoque",
  resource: "inventory",
  table: "inventory_items",
  fields,
  schema,
  refs: [supplierRef(), locationRef()],
  keys: [
    { name: "SKU", fromRow: (row) => row.sku, fromDb: (row) => row.sku, compare: codeKey },
    { name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name },
  ],
  toColumns: (row, { refs }) => ({
    name: row.name,
    sku: row.sku,
    category: row.category,
    unit: row.unit,
    min_stock: row.min_stock,
    max_stock: row.max_stock,
    cost: row.cost,
    supplier_id: refs.supplier,
  }),
};

const LABEL_OF: Record<string, string> = { supplier_id: "supplier" };

const sameCell = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : keyOf(a) === keyOf(b));

interface InventoryPlan {
  issues: RowIssue[];
  /** Linhas aceitas, com o grupo do item (índice da primeira linha do mesmo item) e o local resolvido. */
  rows: Array<PlannedRow<InventoryImportRow> & { group: number; locationId: string | null }>;
}

/**
 * Plano do estoque: casa o item (buildPlan com repetição permitida), resolve o local (sem local, vale o único
 * local cadastrado) e confere que as linhas do mesmo item não trazem dados diferentes do item.
 */
async function planInventory(db: DatabaseLike, companyId: string, rows: InventoryImportRow[], userId: string | null = null): Promise<InventoryPlan> {
  const plan = await buildPlan(itemSpec, db, companyId, rows, { userId, allowRepeat: true });
  const issues = [...plan.issues];
  const locations = await loadActive(db, "stock_locations", companyId);
  const onlyLocation = locations.length === 1 ? String(locations[0].id) : null;
  const groups = new Map<string, number>();
  const firstColumns = new Map<number, Row>();
  const seenPlaces = new Map<string, number>();
  const accepted: InventoryPlan["rows"] = [];
  for (const item of plan.planned) {
    const group = item.existing ? (groups.get(String(item.existing.id)) ?? item.index) : (item.pendingOf ?? item.index);
    if (item.existing && !groups.has(String(item.existing.id))) groups.set(String(item.existing.id), item.index);
    let locationId = item.refs.location ?? null;
    if (!locationId && item.row.quantity !== undefined) {
      if (onlyLocation) locationId = onlyLocation;
      else {
        issues.push({
          index: item.index,
          field: "location",
          message: locations.length === 0 ? "Cadastre um local de estoque antes de importar quantidades" : "Informe o local: há mais de um local de estoque",
        });
        continue;
      }
    }
    const place = `${group}@${locationId ?? ""}`;
    if (locationId && seenPlaces.has(place)) {
      issues.push({ index: item.index, field: "location", message: "Mesmo item e local de outra linha da planilha", relatedIndex: seenPlaces.get(place) });
      continue;
    }
    const columns = stripEmpty(itemSpec.toColumns(item.row, { refs: item.refs, existing: item.existing, userId }));
    const first = firstColumns.get(group);
    if (first) {
      const column = ITEM_COLUMNS.find((name) => name in columns && name in first && !sameCell(columns[name], first[name]));
      if (column) {
        const field = LABEL_OF[column] ?? column;
        const label = fields.find((definition) => definition.key === field)?.label ?? field;
        issues.push({ index: item.index, field, message: `${label} diferente do mesmo item em outra linha`, relatedIndex: group });
        continue;
      }
      firstColumns.set(group, { ...first, ...columns });
    } else firstColumns.set(group, columns);
    if (locationId) seenPlaces.set(place, item.index);
    accepted.push({ ...item, group, locationId });
  }
  return { issues, rows: accepted };
}

const balanceKey = (itemId: string, locationId: string) => `${itemId}@${locationId}`;

export const entity: ImportEntity<InventoryImportRow> = {
  key: "inventory",
  label: "Estoque",
  description: "Itens de estoque com saldo por local (a diferença vira ajuste de inventário).",
  resource: "inventory",
  fields,
  schema,

  naturalKey(row) {
    const sku = codeKey(row.sku);
    const item = sku ? `sku:${sku}` : keyOf(row.name) ? `nome:${keyOf(row.name)}` : "";
    return item ? `${item}@${keyOf(row.location)}` : "";
  },

  async check(db, companyId, rows) {
    return (await planInventory(db, companyId, rows)).issues;
  },

  async upsert(db, companyId, rows, context: UpsertContext = {}) {
    const userId = context.userId ?? null;
    const plan = await planInventory(db, companyId, rows, userId);
    if (plan.issues.length) throw new Error(`${plan.issues.length} linha(s) não conferem mais com o banco: ${plan.issues[0].message}`);
    const now = sqliteNow();

    // 1) itens: uma gravação por item, com os dados de todas as suas linhas.
    const itemIdOf = new Map<number, string>();
    const merged = new Map<number, { existing: Row | null; columns: Row }>();
    for (const item of plan.rows) {
      const columns = stripEmpty(itemSpec.toColumns(item.row, { refs: item.refs, existing: item.existing, userId }));
      const current = merged.get(item.group);
      if (current) current.columns = { ...current.columns, ...columns };
      else merged.set(item.group, { existing: item.existing, columns });
    }
    const itemInserts: Row[] = [];
    const itemUpdates: RowUpdate[] = [];
    for (const [group, { existing, columns }] of merged) {
      if (existing) {
        itemIdOf.set(group, String(existing.id));
        const change = diffColumns(columns, existing, now);
        if (change) itemUpdates.push({ id: String(existing.id), ...change });
      } else {
        const id = uuidv4();
        itemIdOf.set(group, id);
        itemInserts.push({ ...columns, id, company_id: companyId });
      }
    }
    const inserted = plan.rows.filter((item) => !item.existing).length;
    const updated = plan.rows.length - inserted;

    // 2) saldos e movimentos de ajuste.
    const balances = new Map<string, Row>();
    for (const balance of await db.select<Row[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId])) {
      balances.set(balanceKey(String(balance.item_id), String(balance.location_id)), balance);
    }
    const costOf = (group: number) => {
      const cost = merged.get(group)?.columns.cost ?? merged.get(group)?.existing?.cost;
      return typeof cost === "number" ? cost : null;
    };
    const balanceInserts: Row[] = [];
    const balanceUpdates: RowUpdate[] = [];
    const movements: Row[] = [];
    for (const item of plan.rows) {
      if (item.row.quantity === undefined || !item.locationId) continue;
      const itemId = itemIdOf.get(item.group)!;
      const current = balances.get(balanceKey(itemId, item.locationId));
      const before = Number(current?.quantity ?? 0);
      const difference = Math.round((item.row.quantity - before) * 1e6) / 1e6;
      if (current) {
        const change = diffColumns({ quantity: item.row.quantity }, current, now);
        if (change) balanceUpdates.push({ id: String(current.id), ...change });
      } else {
        balanceInserts.push({ id: uuidv4(), company_id: companyId, item_id: itemId, location_id: item.locationId, quantity: item.row.quantity });
      }
      if (difference === 0) continue;
      movements.push({
        id: uuidv4(),
        company_id: companyId,
        item_id: itemId,
        type: "ajuste",
        quantity: Math.abs(difference),
        // Sobra entra no local (to); falta sai do local (from), como na contagem de inventário.
        from_location_id: difference < 0 ? item.locationId : null,
        to_location_id: difference > 0 ? item.locationId : null,
        unit_cost: costOf(item.group),
        ref_type: "import",
        ref_id: context.batchId ?? null,
        user_id: userId,
        note: difference < 0 ? "Importação de planilha: saída por ajuste" : "Importação de planilha: entrada por ajuste",
      });
    }
    if (context.dryRun) return { inserted, updated };

    const total = itemInserts.length + itemUpdates.length + balanceInserts.length + balanceUpdates.length + movements.length;
    let done = 0;
    const progress = (count: number) => {
      done += count;
      context.onProgress?.(done, total);
    };
    await insertRows(db, "inventory_items", itemInserts, context.journal, progress);
    await updateRows(db, "inventory_items", companyId, itemUpdates, context.journal, progress);
    await insertRows(db, "stock_balances", balanceInserts.map(stripEmpty), context.journal, progress);
    await updateRows(db, "stock_balances", companyId, balanceUpdates, context.journal, progress);
    await insertRows(db, "stock_movements", movements.map(stripEmpty), context.journal, progress);
    return { inserted, updated };
  },

  async exportData(db, companyId) {
    const items = (await loadActive(db, "inventory_items", companyId)).sort(byAge);
    const [suppliers, locations] = await loadRefs(db, companyId, [supplierRef(), locationRef()]);
    const balances = await db.select<Row[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
    const byItem = new Map<string, Row[]>();
    for (const balance of balances) {
      if (!locations.byId.has(String(balance.location_id))) continue;
      const list = byItem.get(String(balance.item_id)) ?? [];
      list.push(balance);
      byItem.set(String(balance.item_id), list);
    }
    const out: Record<string, unknown>[] = [];
    for (const item of items) {
      const supplier = item.supplier_id ? suppliers.byId.get(String(item.supplier_id)) : undefined;
      const base = {
        name: item.name,
        sku: item.sku ?? null,
        category: item.category ?? null,
        unit: item.unit ?? null,
        min_stock: item.min_stock ?? null,
        max_stock: item.max_stock ?? null,
        cost: item.cost ?? null,
        supplier: supplier ? supplier.name : null,
      };
      const places = (byItem.get(String(item.id)) ?? []).sort((a, b) =>
        String(locations.byId.get(String(a.location_id))?.name ?? "").localeCompare(String(locations.byId.get(String(b.location_id))?.name ?? ""), "pt-BR"),
      );
      if (places.length === 0) out.push({ ...base, quantity: null, location: null });
      for (const balance of places) out.push({ ...base, quantity: balance.quantity, location: locations.byId.get(String(balance.location_id))?.name ?? null });
    }
    return out;
  },
};
