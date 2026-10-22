// Semeia o projeto "Desenvolvimento de Site": projeto, tarefas, pacotes, preços, cenários, leads e previsão.
//
// - Roda uma vez por empresa (flag em `settings`) e é idempotente: IDs determinísticos (uuid v5)
//   + INSERT OR IGNORE, então repetir não duplica nada e nunca sobrescreve edições.
// - Mesmo SQL no SQLite (Tauri) e no banco demo do navegador (src/lib/db/demo.ts).
// - Dados vêm de data/siteProspecting.generated.ts (gerado por scripts/site-prospecting/build-seed.mjs).
import { v5 as uuidv5 } from "uuid";
import { getDb } from "@/lib/db/client";
import type { DatabaseLike } from "@/lib/db/demo";
import { emit } from "@/lib/events/bus";
import { computeForecasts, type ForecastLead } from "./forecast";
import type { Project, RevenueScenario, Session } from "@/types";

const NAMESPACE = "6f1c9a52-6a0e-4a43-9c58-0d4b9d3a1e77";
const LEAD_SOURCE = "Google Maps (SEM_SITE_sorocaba_filtrado.csv)";

export const SEED_SETTING_KEY = "seed.site_prospecting.v1";
export const SITE_PROJECT_NAME = "Desenvolvimento de Site";

const inflight = new Map<string, Promise<boolean>>();

function seedId(companyId: string, key: string): string {
  return uuidv5(`${companyId}:${key}`, NAMESPACE);
}

/** Garante o seed da empresa da sessão. Retorna true se importou agora, false se já estava feito. */
export function ensureSiteProspectingSeed(session: Session): Promise<boolean> {
  const companyId = session.company.id;
  let job = inflight.get(companyId);
  if (!job) {
    job = runSeed(session).finally(() => inflight.delete(companyId));
    inflight.set(companyId, job);
  }
  return job;
}

async function runSeed(session: Session): Promise<boolean> {
  const db = await getDb();
  const companyId = session.company.id;

  const settings = await db.select<{ key: string }[]>("SELECT * FROM settings WHERE company_id=?", [companyId]);
  if (settings.some((setting) => setting.key === SEED_SETTING_KEY)) return false;

  const data = await import("./data/siteProspecting.generated");

  // Projeto: reaproveita um já existente com o mesmo nome (criado à mão), senão cria.
  const projects = await db.select<Project[]>(
    "SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
    [companyId],
  );
  const existing = projects.find((project) => project.name.trim().toLowerCase() === SITE_PROJECT_NAME.toLowerCase());
  const projectId = existing?.id ?? seedId(companyId, "project:desenvolvimento-de-site");
  if (!existing) {
    await db.execute(
      "INSERT OR IGNORE INTO projects (id, company_id, name, status, budget, start_date, end_date, owner_id) VALUES (?,?,?,?,?,?,?,?)",
      [projectId, companyId, data.SITE_PROJECT.name, data.SITE_PROJECT.status, data.SITE_PROJECT.budget, data.SITE_PROJECT.start_date, data.SITE_PROJECT.end_date, session.user.id],
    );
  }

  // Pacotes e preços (estimativa)
  const packageIds = new Map<string, string>();
  for (const pkg of data.SITE_PACKAGES) {
    const id = seedId(companyId, `package:${pkg.code}`);
    packageIds.set(pkg.code, id);
    await db.execute(
      "INSERT OR IGNORE INTO service_packages (id, company_id, project_id, code, name, description, features_json, sort_order, is_estimate) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, companyId, projectId, pkg.code, pkg.name, pkg.description, JSON.stringify(pkg.features), pkg.sort_order, 1],
    );
  }
  for (const price of data.SITE_PRICES) {
    await db.execute(
      "INSERT OR IGNORE INTO package_prices (id, company_id, package_id, segment, setup_price, monthly_price, is_estimate) VALUES (?,?,?,?,?,?,?)",
      [seedId(companyId, `price:${price.package_code}:${price.segment}`), companyId, packageIds.get(price.package_code), price.segment, price.setup_price, price.monthly_price, 1],
    );
  }

  // Cenários de conversão
  const scenarios: RevenueScenario[] = [];
  for (const scenario of data.SITE_SCENARIOS) {
    const id = seedId(companyId, `scenario:${projectId}:${scenario.code}`);
    await db.execute(
      "INSERT OR IGNORE INTO revenue_scenarios (id, company_id, project_id, code, label, conversion_rate) VALUES (?,?,?,?,?,?)",
      [id, companyId, projectId, scenario.code, scenario.label, scenario.conversion_rate],
    );
    scenarios.push({ id, company_id: companyId, project_id: projectId, code: scenario.code, label: scenario.label, conversion_rate: scenario.conversion_rate, created_at: "", updated_at: "" });
  }

  // Leads (status padrão "novo")
  for (const lead of data.SITE_LEADS) {
    await db.execute(
      `INSERT OR IGNORE INTO leads
         (id, company_id, name, phone, source, status, score, project_id, category, business_type, whatsapp,
          google_rating, google_reviews, sem_site, online_presence, presence_kind, address, notes, source_url,
          package_id, estimated_setup, estimated_monthly, estimated_revenue, priority_rank, outreach_day, outreach_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        seedId(companyId, `lead:site:${lead.seq}`), companyId, lead.name, lead.phone, LEAD_SOURCE, "novo", lead.score, projectId,
        lead.category, lead.business_type, lead.whatsapp, lead.google_rating, lead.google_reviews, lead.sem_site,
        lead.online_presence, lead.presence_kind, lead.address, lead.notes, lead.source_url,
        packageIds.get(lead.package_code), lead.estimated_setup, lead.estimated_monthly, lead.estimated_revenue,
        lead.priority_rank, lead.outreach_day, lead.outreach_date,
      ],
    );
  }

  for (const task of data.SITE_TASKS) {
    await db.execute(
      "INSERT OR IGNORE INTO tasks (id, company_id, project_id, title, description, status, priority, due_date) VALUES (?,?,?,?,?,?,?,?)",
      [seedId(companyId, `task:${task.key}`), companyId, projectId, task.title, task.description, task.status, task.priority, task.due_date],
    );
  }

  await saveForecasts(db, companyId, projectId, scenarios, data.SITE_LEADS);

  await db.execute(
    "INSERT OR REPLACE INTO settings (id, company_id, key, value_json) VALUES (?,?,?,?)",
    [seedId(companyId, `setting:${SEED_SETTING_KEY}`), companyId, SEED_SETTING_KEY, JSON.stringify({ projectId, leads: data.SITE_LEADS.length, version: data.SITE_SEED_VERSION })],
  );

  await emit({
    type: "site_prospecting.seeded",
    companyId,
    actorId: session.user.id,
    entityType: "project",
    entityId: projectId,
    title: `Prospecção de sites importada: ${data.SITE_LEADS.length} leads, ${data.SITE_PACKAGES.length} pacotes, ${data.SITE_TASKS.length} tarefas`,
    module: "leads",
    metadata: { version: data.SITE_SEED_VERSION, estimate: true },
  });

  return true;
}

/** Grava (upsert) a previsão de receita de cada cenário. Usado pelo seed e por "Recalcular". */
export async function saveForecasts(
  db: DatabaseLike,
  companyId: string,
  projectId: string,
  scenarios: Pick<RevenueScenario, "id" | "code" | "conversion_rate">[],
  leads: ForecastLead[],
  knownSegments: string[] = [],
): Promise<void> {
  const scenarioIds = new Map(scenarios.map((scenario) => [scenario.code, scenario.id]));
  for (const row of computeForecasts(leads, scenarios, knownSegments)) {
    await db.execute(
      `INSERT OR REPLACE INTO revenue_forecasts
         (id, company_id, project_id, scenario_id, segment, leads_count, expected_closed, potential_setup, potential_monthly,
          potential_revenue, forecast_setup, forecast_monthly, forecast_revenue, is_estimate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        seedId(companyId, `forecast:${projectId}:${row.scenarioCode}:${row.segment ?? "total"}`), companyId, projectId,
        scenarioIds.get(row.scenarioCode), row.segment, row.leads_count, row.expected_closed, row.potential_setup,
        row.potential_monthly, row.potential_revenue, row.forecast_setup, row.forecast_monthly, row.forecast_revenue, 1,
      ],
    );
  }
}
