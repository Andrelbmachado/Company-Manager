// Contrato do redesign (Tarefa 6, grupo d): contas em EditableTable dentro de Configurações (sem diálogo para criar,
// editar ou redefinir senha) e a auditoria sem painel lateral. SQLite real.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, findButton, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { listUsersAccess } from "./usersAccess";
import SettingsPage from "./pages/SettingsPage";
import AuditPage from "./pages/AuditPage";
import { saveAreaLabels } from "@/lib/labels/store";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const table = () => page!.container.querySelector<HTMLElement>('[data-editable-table="users"]');
const field = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const noDialog = () => expect(document.querySelector("[role=dialog]")).toBeNull();

describe("Configurações: contas direto na tabela", () => {
  it("cria conta com senha temporária, muda papel e redefine senha sem diálogo", async () => {
    await insertTestCompany(testDb());
    page = await renderPage(<SettingsPage />, { companyId: C, role: "admin" });
    await until(() => !!table() && page!.text().includes("Teste comercial"), "tabela de contas");

    await click(findButton(table()!, "Adicionar"));
    noDialog();
    await typeInto(field("Nome (nova linha)"), "Bruno Lima");
    await typeInto(field("E-mail (nova linha)"), "bruno@empresa.com");
    await choose(field("Papel (nova linha)"), "financeiro");
    await click(findButton(table()!, "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "conta salva");
    expect(page.text()).toContain("Senha temporária");
    expect((await listUsersAccess(C)).find((row) => row.email === "bruno@empresa.com")).toMatchObject({ name: "Bruno Lima", role: "financeiro", must_change_password: 1 });

    await until(() => page!.text().includes("Bruno Lima"), "linha nova gravada");
    await click(findButton(table()!, "Editar"));
    noDialog();
    const roleCell = table()!.querySelector<HTMLSelectElement>('tr[data-row-key="test-user-comercial"] td[data-column="role"] select');
    await choose(roleCell, "atendimento");
    await click(findButton(table()!, "Salvar"));
    await until(async () => (await listUsersAccess(C)).find((row) => row.id === "test-user-comercial")?.role === "atendimento", "papel gravado");

    await click(findButton(page.container, "Redefinir senha de Teste rh"));
    noDialog();
    await typeInto(field("Nova senha"), "senha-nova-123");
    await click(findButton(page.container.querySelector('[data-password-reset]')!, "Redefinir senha"));
    await until(() => page!.text().includes("Senha de Teste rh redefinida"), "senha redefinida");
    expect((await listUsersAccess(C)).find((row) => row.id === "test-user-rh")?.must_change_password).toBe(1);
  });

  it("Administração não vê o papel de CEO para conceder e não altera a conta do CEO", async () => {
    await insertTestCompany(testDb());
    page = await renderPage(<SettingsPage />, { companyId: C, role: "admin" });
    await until(() => !!table() && page!.text().includes("Teste ceo"), "tabela de contas");
    expect(findButton(page.container, "Redefinir senha de Teste ceo")).toBeUndefined();
    await click(findButton(table()!, "Adicionar"));
    const options = [...(field("Papel (nova linha)") as HTMLSelectElement).options].map((option) => option.value);
    expect(options).not.toContain("ceo");
  });
});

describe("Auditoria sem painel lateral", () => {
  it("mostra entidade, id e quem fez na própria linha; clicar não abre diálogo", async () => {
    await insertTestCompany(testDb());
    await testDb().execute("INSERT INTO audit_logs (id, company_id, user_id, entity_type, entity_id, action) VALUES (?,?,?,?,?,?)", ["a1", C, "test-user-financeiro", "invoice", "inv-42", "invoice.cancelled"]);
    page = await renderPage(<AuditPage />, { companyId: C, role: "auditor" });
    await until(() => page!.text().includes("invoice.cancelled"), "log");
    expect(page.text()).toContain("inv-42");
    expect(page.text()).toContain("Teste financeiro");
    await click(page.container.querySelector("tbody tr"));
    noDialog();
  });

  it("ordena pelo cabeçalho (Usuário pelo nome, Sistema incluído) e filtra por coluna, com período na Data/hora", async () => {
    await insertTestCompany(testDb());
    const log = (id: string, user: string | null, action: string, at: string) =>
      testDb().execute("INSERT INTO audit_logs (id, company_id, user_id, entity_type, entity_id, action, created_at) VALUES (?,?,?,?,?,?,?)", [id, C, user, "invoice", `inv-${id}`, action, at]);
    await log("a1", "test-user-financeiro", "invoice.cancelled", "2026-03-01 10:00:00");
    await log("a2", "test-user-admin", "user.created", "2026-03-02 10:00:00");
    await log("a3", null, "backup.created", "2026-01-15 03:00:00");
    page = await renderPage(<AuditPage />, { companyId: C, role: "auditor" });
    await until(() => page!.container.querySelectorAll("tbody tr").length === 3, "três eventos");
    const actions = () => [...page!.container.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);
    expect(actions()).toEqual(["user.created", "invoice.cancelled", "backup.created"]);

    await click(page.container.querySelector("th [data-sort-key='user']"));
    expect(actions()).toEqual(["backup.created", "user.created", "invoice.cancelled"]);

    await click(page.button("Filtrar"));
    await typeInto(field("Usuário: contém"), "financeiro");
    expect(actions()).toEqual(["invoice.cancelled"]);
    await typeInto(field("Usuário: contém"), "");
    expect((field("Data/hora: de") as HTMLInputElement).type).toBe("date");
    await typeInto(field("Data/hora: até"), "2026-02-28");
    expect(actions()).toEqual(["backup.created"]);
  });

  it("o título vem do rótulo da área (Configurações)", async () => {
    await insertTestCompany(testDb());
    await saveAreaLabels(testDb(), C, { role: "ceo", userId: "test-user-ceo" }, { overrides: { "module.audit": "Histórico de ações" } });
    page = await renderPage(<AuditPage />, { companyId: C, role: "auditor" });
    await until(() => page!.container.querySelector("h1")?.textContent === "Histórico de ações", "título do módulo");
  });
});
