// API pública do módulo Project Manager (o que um hospedeiro como o Company Manager pode importar).
export { ProjectManagerModule } from "./ProjectManagerModule";
export type { FileExchange, ProjectManagerHost } from "./context";
export type { DatabaseLike } from "./db";
export { buildFlow, deriveStageStatus, type Flow, type FlowStep } from "./flow";
export { createProjectRepository, type ProjectRepository } from "./repository";
export {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  exportBundle,
  importBundle,
  parseBundle,
  type ImportSummary,
  type ProjectBundle,
} from "./integration/bundle";
export * from "./types";

/** Descritor para registrar o módulo na navegação do hospedeiro. */
export const projectManagerManifest = {
  key: "project-manager",
  label: "Project Manager",
  path: "/projects",
  /** Recurso de RBAC do Company Manager que controla a visibilidade. */
  resource: "projects",
} as const;
