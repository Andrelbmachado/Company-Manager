import { getDb } from "@/lib/db/client";
import { isTauri } from "@/lib/runtime";
import type { Notification, Session } from "@/types";
import { browserSelect, browserUpdate } from "./browserStore";

export async function listNotifications(session: Session): Promise<Notification[]> {
  if (!isTauri()) {
    return (browserSelect("notifications", session.company.id) as unknown as Notification[])
      .filter((n) => n.user_id === session.user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const db = await getDb();
  return db.select<Notification[]>(
    "SELECT * FROM notifications WHERE company_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30",
    [session.company.id, session.user.id]
  );
}

export async function markAllNotificationsRead(session: Session): Promise<void> {
  if (!isTauri()) {
    for (const n of await listNotifications(session)) browserUpdate("notifications", n.id, { is_read: 1 });
    return;
  }
  const db = await getDb();
  await db.execute("UPDATE notifications SET is_read=1 WHERE company_id=? AND user_id=?", [
    session.company.id,
    session.user.id,
  ]);
}
