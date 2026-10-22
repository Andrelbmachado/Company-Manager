import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { useSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import type { ReactNode } from "react";

// Pages – lazy loaded
import { lazy, Suspense } from "react";

const LoginPage = lazy(() => import("@/modules/settings/pages/LoginPage"));
const SetupPage = lazy(() => import("@/modules/settings/pages/SetupPage"));

const DashboardPage = lazy(() => import("@/modules/dashboard/pages/DashboardPage"));
const CrmPage = lazy(() => import("@/modules/crm/pages/CrmPage"));
const OpportunitiesPage = lazy(() => import("@/modules/crm/pages/OpportunitiesPage"));
const SupportPage = lazy(() => import("@/modules/support/pages/SupportPage"));
const WorkOrdersPage = lazy(() => import("@/modules/operations/pages/WorkOrdersPage"));
const ProjectsPage = lazy(() => import("@/modules/projects/pages/ProjectsPage"));
const ProductDevelopmentPage = lazy(() => import("@/modules/products/pages/ProductDevelopmentPage"));
const InventoryPage = lazy(() => import("@/modules/inventory/pages/InventoryPage"));
const CustodyPage = lazy(() => import("@/modules/custody/pages/CustodyPage"));
const FinancePage = lazy(() => import("@/modules/finance/pages/FinancePage"));
const DocumentsPage = lazy(() => import("@/modules/documents/pages/DocumentsPage"));
const SettingsPage = lazy(() => import("@/modules/settings/pages/SettingsPage"));
const AuditPage = lazy(() => import("@/modules/settings/pages/AuditPage"));
const AssistantPage = lazy(() => import("@/modules/assistant/pages/AssistantPage"));

function Loader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function RequireModule({ module, children }: { module: string; children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/" replace />;
  return visibleModules(session.membership.role as Role).includes(module)
    ? children
    : <Navigate to="/" replace />;
}

export function AppRoutes() {
  const { session } = useSession();

  if (!session) {
    return (
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/crm/*" element={<RequireModule module="crm"><CrmPage /></RequireModule>} />
          <Route path="/opportunities/*" element={<RequireModule module="opportunities"><OpportunitiesPage /></RequireModule>} />
          <Route path="/support/*" element={<RequireModule module="support"><SupportPage /></RequireModule>} />
          <Route path="/work-orders/*" element={<RequireModule module="operations"><WorkOrdersPage /></RequireModule>} />
          <Route path="/projects/*" element={<RequireModule module="projects"><ProjectsPage /></RequireModule>} />
          <Route path="/products/*" element={<RequireModule module="products"><ProductDevelopmentPage /></RequireModule>} />
          <Route path="/inventory/*" element={<RequireModule module="inventory"><InventoryPage /></RequireModule>} />
          <Route path="/custody/*" element={<RequireModule module="custody"><CustodyPage /></RequireModule>} />
          <Route path="/finance/*" element={<RequireModule module="finance"><FinancePage /></RequireModule>} />
          <Route path="/documents/*" element={<RequireModule module="documents"><DocumentsPage /></RequireModule>} />
          <Route path="/settings/*" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />
          <Route path="/audit/*" element={<RequireModule module="audit"><AuditPage /></RequireModule>} />
          <Route path="/assistant/*" element={<RequireModule module="assistant"><AssistantPage /></RequireModule>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
