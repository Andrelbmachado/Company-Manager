import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { SUBPAGES, canOpenSubpage, subpageRoutePath, type Subpage } from "./subpages";
import { useSession } from "@/hooks/useSession";
import { visibleModules } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import type { ComponentType, LazyExoticComponent, ReactNode } from "react";

// Pages – lazy loaded
import { lazy, Suspense } from "react";

const LoginPage = lazy(() => import("@/modules/settings/pages/LoginPage"));
const SetupPage = lazy(() => import("@/modules/settings/pages/SetupPage"));

const DashboardPage = lazy(() => import("@/modules/dashboard/pages/DashboardPage"));
const CrmPage = lazy(() => import("@/modules/crm/pages/CrmPage"));
const LeadsPage = lazy(() => import("@/modules/leads/pages/LeadsPage"));
const MyHrPage = lazy(() => import("@/modules/hr/pages/MyHrPage"));
const HrManagePage = lazy(() => import("@/modules/hr/pages/HrManagePage"));
const PayrollPage = lazy(() => import("@/modules/payroll/pages/PayrollPage"));
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
const CatalogPage = lazy(() => import("@/modules/catalog/pages/CatalogPage"));
const SalesPage = lazy(() => import("@/modules/sales/pages/SalesPage"));
const PurchasingPage = lazy(() => import("@/modules/purchasing/pages/PurchasingPage"));
const ReportsPage = lazy(() => import("@/modules/reports/pages/ReportsPage"));
const ImportsPage = lazy(() => import("@/modules/imports/pages/ImportsPage"));
const CalendarPage = lazy(() => import("@/modules/calendar/pages/CalendarPage"));

// Subpáginas (src/app/subpages.ts): uma rota por item do registro, com a página carregada sob demanda.
// ChangePasswordPage fica fora: o App.tsx a importa direto (senão o Vite avisa que o import dinâmico não separa o chunk).
const SUBPAGE_LOADERS = import.meta.glob<{ default: ComponentType }>([
  "/src/modules/{crm,catalog,sales,purchasing,inventory,finance,hr,imports,reports,settings}/pages/*Page.tsx",
  "!/src/modules/settings/pages/ChangePasswordPage.tsx",
]);
const SUBPAGE_COMPONENTS = new Map<string, LazyExoticComponent<ComponentType>>(
  SUBPAGES.map((page) => {
    const loader = SUBPAGE_LOADERS[`/src/modules/${page.page}`];
    if (!loader) throw new Error(`Página da subpágina ${page.path} não encontrada: src/modules/${page.page}`);
    return [page.path, lazy(loader)];
  }),
);

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

/** Subpágina: precisa ver o módulo e ter cada permissão do registro; senão volta ao início. */
function RequireSubpage({ page, children }: { page: Subpage; children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/" replace />;
  return canOpenSubpage(session.membership.role as Role, page) ? children : <Navigate to="/" replace />;
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
          <Route path="/hr" element={<RequireModule module="hr"><MyHrPage /></RequireModule>} />
          <Route path="/hr/manage/*" element={<RequireModule module="hr_manage"><HrManagePage /></RequireModule>} />
          <Route path="/leads/*" element={<RequireModule module="leads"><LeadsPage /></RequireModule>} />
          <Route path="/opportunities/*" element={<RequireModule module="opportunities"><OpportunitiesPage /></RequireModule>} />
          <Route path="/support/*" element={<RequireModule module="support"><SupportPage /></RequireModule>} />
          <Route path="/work-orders/*" element={<RequireModule module="operations"><WorkOrdersPage /></RequireModule>} />
          <Route path="/projects/*" element={<RequireModule module="projects"><ProjectsPage /></RequireModule>} />
          <Route path="/products/*" element={<RequireModule module="products"><ProductDevelopmentPage /></RequireModule>} />
          <Route path="/inventory/*" element={<RequireModule module="inventory"><InventoryPage /></RequireModule>} />
          <Route path="/custody/*" element={<RequireModule module="custody"><CustodyPage /></RequireModule>} />
          <Route path="/finance/*" element={<RequireModule module="finance"><FinancePage /></RequireModule>} />
          <Route path="/payroll" element={<RequireModule module="payroll"><PayrollPage /></RequireModule>} />
          <Route path="/documents/*" element={<RequireModule module="documents"><DocumentsPage /></RequireModule>} />
          <Route path="/settings/*" element={<RequireModule module="settings"><SettingsPage /></RequireModule>} />
          <Route path="/audit/*" element={<RequireModule module="audit"><AuditPage /></RequireModule>} />
          {/* Conversa do assistente: sem id = nova conversa (criada na primeira pergunta). */}
          <Route path="/assistant/:conversationId?" element={<RequireModule module="assistant"><AssistantPage /></RequireModule>} />
          <Route path="/catalog/*" element={<RequireModule module="catalog"><CatalogPage /></RequireModule>} />
          <Route path="/sales/*" element={<RequireModule module="sales"><SalesPage /></RequireModule>} />
          <Route path="/purchasing/*" element={<RequireModule module="purchasing"><PurchasingPage /></RequireModule>} />
          <Route path="/reports/*" element={<RequireModule module="reports"><ReportsPage /></RequireModule>} />
          <Route path="/imports/*" element={<RequireModule module="imports"><ImportsPage /></RequireModule>} />
          <Route path="/calendar/*" element={<RequireModule module="calendar"><CalendarPage /></RequireModule>} />
          {SUBPAGES.map((page) => {
            const Page = SUBPAGE_COMPONENTS.get(page.path)!;
            return <Route key={page.path} path={subpageRoutePath(page)} element={<RequireSubpage page={page}><Page /></RequireSubpage>} />;
          })}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
