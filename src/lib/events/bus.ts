import { getDb } from "@/lib/db/client";
import { v4 as uuidv4 } from "uuid";
import { isTauri } from "@/lib/runtime";

export interface DomainEvent {
  type: string;
  companyId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  title?: string;
  description?: string;
  module?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

type EventHandler = (e: DomainEvent) => void | Promise<void>;

const handlers: Record<string, EventHandler[]> = {};

export function on(type: string, fn: EventHandler): () => void {
  handlers[type] = [...(handlers[type] ?? []), fn];
  return () => {
    handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn);
  };
}

export async function emit(e: DomainEvent): Promise<void> {
  await writeActivity(e);
  const fns = handlers[e.type] ?? [];
  await Promise.all(fns.map((fn) => fn(e)));
}

async function writeActivity(e: DomainEvent): Promise<void> {
  // Browser preview has no SQLite; the activity feed is desktop-only.
  if (!isTauri()) return;
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO activities
         (id, company_id, entity_type, entity_id, action, title, description,
          actor_id, old_value_json, new_value_json, metadata_json, module, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        uuidv4(),
        e.companyId,
        e.entityType,
        e.entityId,
        e.type,
        e.title ?? null,
        e.description ?? null,
        e.actorId,
        e.oldValue ? JSON.stringify(e.oldValue) : null,
        e.newValue ? JSON.stringify(e.newValue) : null,
        e.metadata ? JSON.stringify(e.metadata) : null,
        e.module ?? null,
      ]
    );
  } catch (err) {
    console.error("[event-bus] writeActivity failed", err);
  }
}
