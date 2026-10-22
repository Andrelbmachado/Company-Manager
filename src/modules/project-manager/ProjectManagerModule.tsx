import { Navigate, Route, Routes } from "react-router-dom";
import { ProjectManagerProvider, type ProjectManagerHost } from "./context";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectPage from "./pages/ProjectPage";

/**
 * Módulo integrável (autossuficiente: só importa react, react-router-dom, @tanstack/react-query, lucide-react, zod, uuid, clsx, tailwind-merge).
 * Monte dentro de uma rota splat do hospedeiro, por exemplo:
 *   <Route path="/projects/*" element={<ProjectManagerModule db={db} companyId={...} userId={...} canEdit />} />
 * Requisitos do hospedeiro: <QueryClientProvider> e um Router acima, Tailwind com os tokens shadcn e a paleta `status` (tailwind.config.js).
 */
export function ProjectManagerModule(host: ProjectManagerHost) {
  return (
    <ProjectManagerProvider host={host}>
      <Routes>
        <Route index element={<ProjectsPage />} />
        <Route path=":projectId" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </ProjectManagerProvider>
  );
}
