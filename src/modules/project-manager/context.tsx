import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DatabaseLike } from "./db";
import { createProjectRepository, type ProjectRepository } from "./repository";

/** Troca de arquivo com o outro app (bundle JSON). Sem isto, os botões de importar/exportar não aparecem. */
export interface FileExchange {
  importLabel: string;
  exportLabel: string;
}

/** O que o app hospedeiro (Company Manager ou o shell standalone) injeta no módulo. */
export interface ProjectManagerHost {
  db: DatabaseLike;
  companyId: string;
  /** Usuário logado (owner dos projetos criados). null no app standalone. */
  userId: string | null;
  /** Pode editar etapas, tarefas e projetos. */
  canEdit: boolean;
  /** Pode criar projetos. Padrão: igual a canEdit. */
  canCreate?: boolean;
  fileExchange?: FileExchange;
}

interface ProjectManagerContextValue extends ProjectManagerHost {
  canCreate: boolean;
  repo: ProjectRepository;
}

const ProjectManagerContext = createContext<ProjectManagerContextValue | null>(null);

export function ProjectManagerProvider({ host, children }: { host: ProjectManagerHost; children: ReactNode }) {
  const { db, companyId, userId, canEdit, canCreate, fileExchange } = host;
  const value = useMemo<ProjectManagerContextValue>(
    () => ({ db, companyId, userId, canEdit, canCreate: canCreate ?? canEdit, fileExchange, repo: createProjectRepository(db, companyId, userId) }),
    [db, companyId, userId, canEdit, canCreate, fileExchange],
  );
  return <ProjectManagerContext.Provider value={value}>{children}</ProjectManagerContext.Provider>;
}

export function useProjectManager(): ProjectManagerContextValue {
  const value = useContext(ProjectManagerContext);
  if (!value) throw new Error("useProjectManager fora de ProjectManagerProvider");
  return value;
}
