import { getDb } from "@/lib/db/client";
import type { Lead, PackagePrice, Project, RevenueForecast, RevenueScenario, ServicePackage } from "@/types";
import { SITE_PROJECT_NAME } from "./seed";

export async function fetchSiteProject(companyId: string): Promise<Project | null> {
  const projects = await (await getDb()).select<Project[]>(
    "SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
    [companyId],
  );
  return projects.find((project) => project.name.trim().toLowerCase() === SITE_PROJECT_NAME.toLowerCase()) ?? null;
}

export async function fetchLeads(companyId: string): Promise<Lead[]> {
  return (await getDb()).select<Lead[]>(
    "SELECT * FROM leads WHERE company_id=? AND deleted_at IS NULL ORDER BY priority_rank ASC",
    [companyId],
  );
}

export async function fetchServicePackages(companyId: string): Promise<ServicePackage[]> {
  return (await getDb()).select<ServicePackage[]>(
    "SELECT * FROM service_packages WHERE company_id=? AND deleted_at IS NULL ORDER BY sort_order ASC",
    [companyId],
  );
}

export async function fetchPackagePrices(companyId: string): Promise<PackagePrice[]> {
  return (await getDb()).select<PackagePrice[]>(
    "SELECT * FROM package_prices WHERE company_id=? AND deleted_at IS NULL ORDER BY segment ASC",
    [companyId],
  );
}

export async function fetchRevenueScenarios(companyId: string): Promise<RevenueScenario[]> {
  return (await getDb()).select<RevenueScenario[]>(
    "SELECT * FROM revenue_scenarios WHERE company_id=? AND deleted_at IS NULL ORDER BY conversion_rate ASC",
    [companyId],
  );
}

export async function fetchRevenueForecasts(companyId: string): Promise<RevenueForecast[]> {
  return (await getDb()).select<RevenueForecast[]>(
    "SELECT * FROM revenue_forecasts WHERE company_id=? ORDER BY potential_revenue DESC",
    [companyId],
  );
}
