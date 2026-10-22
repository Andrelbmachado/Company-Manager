import { useRequiredSession } from "./useSession";
import type { AccessContext } from "@/lib/departments/access";
import type { Session } from "@/types";

export function accessContextFromSession(session: Session): AccessContext {
  return {
    isAdmin: session.membership.role === "admin",
    memberships: session.departments ?? [],
  };
}

export function useDepartmentAccess(): AccessContext {
  return accessContextFromSession(useRequiredSession());
}
