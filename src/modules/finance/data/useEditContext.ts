import { useRequiredSession } from "@/hooks/useSession";
import type { Role } from "@/types";
import type { EditContext } from "./guard";

/** Contexto de gravação (empresa, papel e usuário) da sessão atual. */
export function useEditContext(): EditContext {
  const session = useRequiredSession();
  return { companyId: session.company.id, role: session.membership.role as Role, userId: session.user.id };
}
