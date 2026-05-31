import { useRequiredSession } from "./useSession";
import { can, canAny } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

type Action = Parameters<typeof can>[1];
type Resource = Parameters<typeof can>[2];

export function usePermission(action: Action, resource: Resource): boolean {
  const session = useRequiredSession();
  return can(session.membership.role as Role, action, resource);
}

export function usePermissionAny(actions: Action[], resource: Resource): boolean {
  const session = useRequiredSession();
  return canAny(session.membership.role as Role, actions, resource);
}
