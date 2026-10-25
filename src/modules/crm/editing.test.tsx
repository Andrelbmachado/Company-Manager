// Contrato da Tarefa 6 (grupo comercial) no CRM: clientes, contatos, oportunidades, atividades e propostas são
// EditableTable; Editar/Adicionar não abrem diálogo; a ficha do cliente edita o cadastro no próprio lugar; detalhes da
// oportunidade (lista e funil) e o "Adicionar" do funil ficam na página; a agenda tem a visão de calendário.
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { expectInlineEditing, expectNoDialog } from "@/test/inlineEditing";
import { click, findButton, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { createActivity } from "@/lib/crm/activities";
import { saveProposal } from "@/lib/crm/proposals";
import { saveAreaLabels } from "@/lib/labels/store";
import ActivitiesPage from "./pages/ActivitiesPage";
import ContactsPage from "./pages/ContactsPage";
import CrmPage from "./pages/CrmPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import OpportunitiesPage from "./pages/OpportunitiesPage";
import PipelineBoardPage from "./pages/PipelineBoardPage";
import ProposalsPage from "./pages/ProposalsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
const USER = "test-user-ceo";
let companyId: string;
let page: RenderedPage | null = null;

beforeEach(async () => {
  ({ companyId } = await insertTestCompany(testDb(), { roles: ["ceo"] }));
  const db = testDb();
  await db.execute("INSERT INTO customers (id, company_id, name, segment, owner_id, status) VALUES (?,?,?,?,?,?)", ["cust-1", companyId, "Clínica Vida", "Saúde", USER, "active"]);
  await db.execute("INSERT INTO contacts (id, company_id, customer_id, name, role, is_primary) VALUES (?,?,?,?,?,?)", ["cont-1", companyId, "cust-1", "Ana Souza", "Gerente", 1]);
  await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title, value, stage, probability, status, owner_id) VALUES (?,?,?,?,?,?,?,?,?)", ["opp-1", companyId, "cust-1", "Site novo", 3000, "novo", 10, "open", USER]);
  await saveProposal(db, companyId, USER, { title: "Proposta do site", customer_id: "cust-1", opportunity_id: "opp-1", items: [{ description: "Site", qty: 1, unit_price: 3000 }] });
  await createActivity(db, companyId, USER, { entity_type: "customer", entity_id: "cust-1", customer_id: "cust-1", kind: "ligacao", subject: "Ligar para a Clínica Vida", due_at: new Date(Date.now() + 86_400_000).toISOString() });
});

afterEach(() => {
  page?.unmount();
  page = null;
});

const open = (path: string, routePath: string, element: ReactNode) =>
  renderPage(
    <Routes>
      <Route path={routePath} element={element} />
      <Route path="*" element={<p data-testid="outra-rota">outra rota</p>} />
    </Routes>,
    { companyId, role: "ceo", path },
  );
const tab = (label: string) => [...page!.container.querySelectorAll("[role=tab]")].find((item) => item.textContent === label);

describe("CRM: edição direto na tabela", () => {
  it("clientes", async () => {
    page = await open("/crm", "/crm", <CrmPage />);
    await until(() => page!.text().includes("Clínica Vida"), "lista de clientes");
    await expectInlineEditing(page.container, ["customers"]);
  });

  it("clientes: título da página é o rótulo do módulo na área da empresa (editável em Configurações)", async () => {
    await saveAreaLabels(testDb(), companyId, { role: "ceo", userId: USER }, { overrides: { "module.crm": "Carteira de clientes" } });
    page = await open("/crm", "/crm", <CrmPage />);
    await until(() => page!.container.querySelector("h1")?.textContent === "Carteira de clientes", "título com o rótulo da área");
  });

  it("ficha do cliente: cadastro editável no lugar e abas em tabela", async () => {
    page = await open("/crm/clientes/cust-1", "/crm/clientes/:id", <CustomerDetailPage />);
    await until(() => page!.container.querySelector("h1")?.textContent === "Clínica Vida", "ficha carregada");
    await click(findButton(page.container, "Editar cadastro"));
    await until(() => Boolean(page!.container.querySelector("form[aria-label='Editar cadastro de Clínica Vida']")), "cadastro em edição na página");
    expectNoDialog("Editar cadastro");
    await click(findButton(page.container.querySelector("form[aria-label='Editar cadastro de Clínica Vida']")!, "Cancelar"));

    await click(tab("Contatos"));
    await until(() => page!.text().includes("Ana Souza"), "aba de contatos");
    await expectInlineEditing(page.container, ["customers"]);
    await click(tab("Oportunidades"));
    await until(() => page!.text().includes("Site novo"), "aba de oportunidades");
    await expectInlineEditing(page.container, ["opportunities"]);
    await click(tab("Propostas"));
    await until(() => page!.text().includes("Proposta do site"), "aba de propostas");
    await expectInlineEditing(page.container, ["proposals"]);
    await click(tab("Atividades"));
    await until(() => page!.text().includes("Ligar para a Clínica Vida"), "aba de atividades");
    await expectInlineEditing(page.container, ["crm_activities"]);
  });

  it("contatos", async () => {
    page = await open("/crm/contatos", "/crm/contatos", <ContactsPage />);
    await until(() => page!.text().includes("Ana Souza"), "lista de contatos");
    await expectInlineEditing(page.container, ["customers"]);
  });

  it("oportunidades: tabela e detalhes na página", async () => {
    page = await open("/opportunities", "/opportunities", <OpportunitiesPage />);
    await until(() => page!.text().includes("Site novo"), "lista de oportunidades");
    await expectInlineEditing(page.container, ["opportunities"]);
    await click(page.container.querySelector("[aria-label='Detalhes de Site novo']"));
    await until(() => Boolean(page!.container.querySelector("[aria-label='Detalhes: Site novo']")), "detalhes da oportunidade");
    expectNoDialog("detalhes da oportunidade");
    await click(findButton(page.container.querySelector("[aria-label='Detalhes: Site novo']")!, "Editar oportunidade"));
    await until(() => Boolean(page!.container.querySelector("form[aria-label='Editar oportunidade Site novo']")), "edição da oportunidade no painel");
    expectNoDialog("Editar oportunidade");
  });

  it("oportunidades: título da página vem do perfil da área (advocacia: Novos casos)", async () => {
    await saveAreaLabels(testDb(), companyId, { role: "ceo", userId: USER }, { profile: "advocacia" });
    page = await open("/opportunities", "/opportunities", <OpportunitiesPage />);
    await until(() => page!.container.querySelector("h1")?.textContent === "Novos casos", "título do perfil advocacia");
  });

  it("funil: Adicionar e detalhes sem diálogo", async () => {
    page = await open("/crm/funil", "/crm/funil", <PipelineBoardPage />);
    await until(() => Boolean(page!.container.querySelector('[role=button][aria-label^="Site novo"]')), "cartão no funil");
    await click(findButton(page.container.querySelector('section[aria-label^="Proposta:"]')!, "Adicionar"));
    await until(() => Boolean(page!.container.querySelector("form[aria-label='Nova oportunidade em Proposta']")), "formulário na página");
    expectNoDialog("Adicionar no funil");
    await click(page.container.querySelector('[role=button][aria-label^="Site novo"]'));
    await until(() => Boolean(page!.container.querySelector("[aria-label='Detalhes: Site novo']")), "detalhes no funil");
    expectNoDialog("detalhes no funil");
  });

  it("atividades: tabela e calendário", async () => {
    page = await open("/crm/atividades", "/crm/atividades", <ActivitiesPage />);
    await until(() => page!.text().includes("Ligar para a Clínica Vida"), "lista de atividades");
    await expectInlineEditing(page.container, ["crm_activities"]);
    await click(findButton(page.container, "Calendário"));
    await until(() => Boolean(page!.container.querySelector("[aria-label='Agenda do CRM']")), "calendário das atividades");
    expect(page.text()).toContain("Ligar para a Clínica Vida");
  });

  it("propostas", async () => {
    page = await open("/crm/propostas", "/crm/propostas", <ProposalsPage />);
    await until(() => page!.text().includes("Proposta do site"), "lista de propostas");
    await expectInlineEditing(page.container, ["proposals"]);
  });
});
