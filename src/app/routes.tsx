import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { useSession } from "@/hooks/useSession";

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
const InventoryPage = lazy(() => import("@/modules/inventory/pages/InventoryPage"));
const CustodyPage = lazy(() => import("@/modules/custody/pages/CustodyPage"));
const FinancePage = lazy(() => import("@/modules/finance/pages/FinancePage"));
const DocumentsPage = lazy(() => import("@/modules/documents/pages/DocumentsPage"));
const SettingsPage = lazy(() => import("@/modules/settings/pages/SettingsPage"));
const AuditPage = lazy(() => import("@/modules/settings/pages/AuditPage"));

function Loader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
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
          <Route path="/crm/*" element={<CrmPage />} />
          <Route path="/opportunities/*" element={<OpportunitiesPage />} />
          <Route path="/support/*" element={<SupportPage />} />
          <Route path="/work-orders/*" element={<WorkOrdersPage />} />
          <Route path="/projects/*" element={<ProjectsPage />} />
          <Route path="/inventory/*" element={<InventoryPage />} />
          <Route path="/custody/*" element={<CustodyPage />} />
          <Route path="/finance/*" element={<FinancePage />} />
          <Route path="/documents/*" element={<DocumentsPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="/audit/*" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
