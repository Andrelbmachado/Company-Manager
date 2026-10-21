// Generic data access for every entity in the registry.
// Desktop (Tauri): SQLite via @tauri-apps/plugin-sql.
// Browser preview: localStorage store with the same row shape.

import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { isTauri } from "@/lib/runtime";
import type { Session } from "@/types";
import { getEntity, writableFields, type EntityDef, type EntityKey } from "./entities";
import { browserInsert, browserSelect, browserUpdate, type Row } from "./browserStore";

export type { Row };

/** Suffix of the virtual column holding a ref field's display value. */
export const LABEL_SUFFIX = "__label";

export function refLabel(row: Row, fieldKey: string): string {
  const v = row[fieldKey + LABEL_SUFFIX];
  return v === undefined || v === null ? "" : String(v);
}

async function selectRows(def: EntityDef, companyId: string): Promise<Row[]> {
  if (!isTauri()) return browserSelect(def.table, companyId);

  const db = await getDb();
  switch (def.key) {
    case "users":
      return db.select<Row[]>(
        `SELECT u.id, u.name, u.email, u.status, m.role
         FROM users u JOIN memberships m ON m.user_id = u.id
         WHERE m.company_id=? AND u.deleted_at IS NULL AND m.deleted_at IS NULL`,
        [companyId]
      );
    case "audit_logs":
      return db.select<Row[]>(
        "SELECT * FROM audit_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 1000",
        [companyId]
      );
    case "inventory_items":
      return db.select<Row[]>(
        `SELECT i.*, COALESCE(SUM(b.quantity), 0) as quantity
         FROM inventory_items i
         LEFT JOIN stock_balances b ON b.item_id = i.id AND b.company_id = i.company_id
         WHERE i.company_id=? AND i.deleted_at IS NULL
         GROUP BY i.id`,
        [companyId]
      );
    default:
      return db.select<Row[]>(
        `SELECT * FROM ${def.table} WHERE company_id=? AND deleted_at IS NULL`,
        [companyId]
      );
  }
}

function sortRows(def: EntityDef, rows: Row[]): Row[] {
  const [field, dir] = def.orderBy;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "pt-BR")) * sign;
  });
}

/** Attach `<field>__label` with the display value of every ref field. */
async function attachRefLabels(def: EntityDef, rows: Row[], companyId: string): Promise<Row[]> {
  const refFields = def.fields.filter((f) => f.type === "ref" && f.ref);
  if (!refFields.length || !rows.length) return rows;
  const lookups = await Promise.all(
    refFields.map(async (f) => {
      const refDef = getEntity(f.ref!.entity);
      const refRows = await selectRows(refDef, companyId);
      return [f, new Map(refRows.map((r) => [r.id, r[f.ref!.display]]))] as const;
    })
  );
  return rows.map((row) => {
    const out = { ...row };
    for (const [f, map] of lookups) {
      const id = row[f.key];
      if (id) out[f.key + LABEL_SUFFIX] = map.get(id) ?? null;
    }
    return out;
  });
}

export async function listEntity(key: EntityKey, companyId: string): Promise<Row[]> {
  const def = getEntity(key);
  const rows = await selectRows(def, companyId);
  return sortRows(def, await attachRefLabels(def, rows, companyId));
}

/** Rows of a ref'ed entity, for selects in forms and import resolution. */
export async function listRefOptions(key: EntityKey, companyId: string): Promise<Row[]> {
  return sortRows(getEntity(key), await selectRows(getEntity(key), companyId));
}

async function nextNumber(def: EntityDef, companyId: string, offset: number): Promise<string> {
  const { field, prefix } = def.autoNumber!;
  const rows = await selectRows(def, companyId);
  const max = rows.reduce((m, r) => {
    const n = parseInt(String(r[field] ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1 + offset).padStart(4, "0")}`;
}

/** Derived columns kept consistent regardless of where the row came from. */
function deriveColumns(def: EntityDef, row: Row): Row {
  if (def.key === "opportunities" && row.stage) {
    row.status = row.stage === "ganho" ? "won" : row.stage === "perdido" ? "lost" : "open";
  }
  return row;
}

/**
 * Insert one or more rows. Values must already be coerced (see values.ts).
 * Unknown keys are dropped; empty values fall back to column defaults.
 */
export async function insertEntities(
  key: EntityKey,
  session: Session,
  inputs: Row[],
  options: { emitEvents?: boolean } = {}
): Promise<Row[]> {
  const def = getEntity(key);
  const allowed = new Set([...writableFields(def).map((f) => f.key), ...(EXTRA_COLUMNS[key] ?? [])]);
  const companyId = session.company.id;
  const now = new Date().toISOString();
  const created: Row[] = [];

  let autoOffset = 0;
  for (const input of inputs) {
    const row: Row = { id: uuidv4(), company_id: companyId };
    for (const [k, v] of Object.entries(input)) {
      if (allowed.has(k) && v !== undefined && v !== null && v !== "") row[k] = v;
    }
    for (const f of writableFields(def)) {
      if (row[f.key] === undefined && f.defaultValue !== undefined) row[f.key] = f.defaultValue;
    }
    const ownerCol = OWNER_COLUMN[key];
    if (ownerCol && !row[ownerCol]) row[ownerCol] = session.user.id;
    if (def.autoNumber && !row[def.autoNumber.field]) {
      row[def.autoNumber.field] = await nextNumber(def, companyId, autoOffset++);
    }
    created.push(deriveColumns(def, row));
  }

  if (isTauri()) {
    const db = await getDb();
    for (const row of created) {
      const cols = Object.keys(row);
      await db.execute(
        `INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        cols.map((c) => row[c])
      );
    }
  } else {
    browserInsert(
      def.table,
      created.map((r) => ({ created_at: now, updated_at: now, deleted_at: null, ...r }))
    );
  }

  if (options.emitEvents !== false) {
    for (const row of created) {
      await emit({
        type: def.createdEvent,
        companyId,
        actorId: session.user.id,
        entityType: def.key,
        entityId: String(row.id),
        title: `${def.label} criado: ${String(row[def.titleField] ?? row.id)}`,
        module: def.key,
        newValue: row,
      });
    }
  }
  return created;
}

export async function insertEntity(key: EntityKey, session: Session, input: Row): Promise<Row> {
  const [row] = await insertEntities(key, session, [input]);
  return row;
}

export async function updateEntity(
  key: EntityKey,
  session: Session,
  id: string,
  patch: Row
): Promise<void> {
  const def = getEntity(key);
  const allowed = new Set([...writableFields(def).map((f) => f.key), ...(EXTRA_COLUMNS[key] ?? [])]);
  const clean = deriveColumns(
    def,
    Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)))
  );
  const cols = Object.keys(clean);
  if (!cols.length) return;

  if (isTauri()) {
    const db = await getDb();
    await db.execute(
      `UPDATE ${def.table} SET ${cols.map((c) => `${c}=?`).join(", ")}, updated_at=datetime('now')
       WHERE id=? AND company_id=?`,
      [...cols.map((c) => clean[c] ?? null), id, session.company.id]
    );
  } else {
    browserUpdate(def.table, id, clean);
  }

  await emit({
    type: `${def.key}.updated`,
    companyId: session.company.id,
    actorId: session.user.id,
    entityType: def.key,
    entityId: id,
    title: `${def.label} atualizado`,
    module: def.key,
    newValue: clean,
  });
}

/** Column stamped with the current user on creation. */
const OWNER_COLUMN: Partial<Record<EntityKey, string>> = {
  customers: "owner_id",
  leads: "owner_id",
  opportunities: "owner_id",
  projects: "owner_id",
  tickets: "agent_id",
  documents: "uploaded_by",
};

/** Columns writable by code paths (not shown in forms/imports). */
const EXTRA_COLUMNS: Partial<Record<EntityKey, string[]>> = {
  leads: ["customer_id", "owner_id"],
  opportunities: ["status", "owner_id", "lost_reason", "lead_id"],
  tickets: ["agent_id", "work_order_id"],
  work_orders: ["ticket_id", "project_id", "technician_id", "closed_at"],
  custodies: ["work_order_id", "returned_at"],
  customers: ["owner_id"],
  projects: ["owner_id"],
  payables: ["paid_at", "approver_id"],
  receivables: ["received_at"],
  documents: ["uploaded_by", "entity_id"],
};
