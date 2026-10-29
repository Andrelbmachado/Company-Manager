// Importar pela Prospecção soma os leads novos aos que já existem, na prospecção padrão (SQLite real). O botão de importação é trocado por um
// que repete a ordem do ImportWizard: grava os leads sem campanha, refaz TODAS as consultas e só então avisa a tela.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQueryClient } from "@tanstack/react-query";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, plain, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { defaultCampaignId } from "@/lib/prospecting/campaigns";
import type { Lead } from "@/types";
import LeadsPage from "./LeadsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/components/shared/ImportExportButtons", () => ({ ImportExportButtons: FakeImportButton }));

function FakeImportButton({ onImported, importOpen }: { entity: string; onImported?: () => void; importOpen?: boolean }) {
  const qc = useQueryClient();
  const session = useRequiredSession();
  async function run() {
    const db = await getDb();
    await db.execute("INSERT INTO leads (id, company_id, name, status, estimated_revenue) VALUES (?, ?, ?, ?, ?)", ["imp-1", session.company.id, "Imobiliária Importada", "novo", 4000]);
    await qc.invalidateQueries();
    onImported?.();
  }
  // "Importar prospecção" (menu Nova prospecção) abre o assistente: aqui aparece o botão que simula a importação.
  return importOpen ? <button type="button" onClick={() => void run()}>Importar planilha de teste</button> : null;
}

const testDb = useTestDb();
let page: RenderedPage | null = null;
afterEach(() => {
  page?.unmount();
  page = null;
});

const OTHER = "camp-advogados";

async function seed(): Promise<string> {
  const db = testDb();
  const { companyId } = await insertTestCompany(db);
  await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at) VALUES (?, ?, ?, ?)", [defaultCampaignId(companyId), companyId, "Prospecção 1", "2026-09-01T10:00:00.000Z"]);
  await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at) VALUES (?, ?, ?, ?)", [OTHER, companyId, "Advogados", "2026-10-01T10:00:00.000Z"]);
  await db.execute("INSERT INTO leads (id, company_id, name, status, estimated_revenue, campaign_id) VALUES (?, ?, ?, ?, ?, ?)", ["a1", companyId, "Pet Shop Alfa", "novo", 1000, defaultCampaignId(companyId)]);
  await db.execute("INSERT INTO leads (id, company_id, name, status, estimated_revenue, campaign_id) VALUES (?, ?, ?, ?, ?, ?)", ["b1", companyId, "Escritório Silva", "abordado", 5000, OTHER]);
  return companyId;
}

const kpi = (container: HTMLElement, title: string) =>
  [...container.querySelectorAll<HTMLElement>(".kpi-card")].find((card) => plain(card.firstElementChild?.textContent) === title)?.querySelector("[data-kpi-value]")?.textContent;
const campaignOf = async (id: string) => (await testDb().select<Lead[]>("SELECT * FROM leads WHERE id=?", [id]))[0]?.campaign_id ?? null;

describe("Prospecção: importar pela tela", () => {
  it("Importar prospecção (no menu Nova prospecção) soma os leads importados aos que já existem, na prospecção padrão", async () => {
    const companyId = await seed();
    page = await renderPage(<LeadsPage />, { companyId, role: "comercial", path: "/leads" });
    await until(() => kpi(page!.container, "Leads") === "2" && page!.text().includes("Escritório Silva"), "todos os leads");

    await click(page.button("Nova prospecção"));
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => plain(item.textContent).trim() === "Importar prospecção"));
    await click(page.button("Importar planilha de teste"));

    await until(async () => (await campaignOf("imp-1")) !== null, "lead importado numa campanha");
    expect(await campaignOf("imp-1")).toBe(defaultCampaignId(companyId));
    await until(() => kpi(page!.container, "Leads") === "3" && page!.text().includes("Imobiliária Importada"), "lead importado somado à lista");
    expect(page.text()).toContain("Pet Shop Alfa");
    expect(await campaignOf("b1")).toBe(OTHER);
  });

  it("lead sem campanha que já existia vai para a campanha padrão ao abrir e aparece na lista", async () => {
    const companyId = await seed();
    await testDb().execute("INSERT INTO leads (id, company_id, name, status) VALUES (?, ?, ?, ?)", ["solto", companyId, "Lead Antigo", "novo"]);
    page = await renderPage(<LeadsPage />, { companyId, role: "comercial", path: "/leads" });

    await until(async () => (await campaignOf("solto")) !== null, "lead antigo numa campanha");
    expect(await campaignOf("solto")).toBe(defaultCampaignId(companyId));
    await until(() => kpi(page!.container, "Leads") === "3" && page!.text().includes("Lead Antigo"), "lead antigo na lista");
  });
});
