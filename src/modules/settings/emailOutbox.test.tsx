// Configurações > E-mails importantes: cada aviso pendente abre no app de e-mail (Cco) e sai da fila.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { notifyUsers } from "@/lib/notifications/notifications";
import { EmailOutboxCard } from "./components/EmailOutboxCard";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const C = "test-company";
let page: RenderedPage | null = null;
afterEach(() => {
  page?.unmount();
  page = null;
});

describe("EmailOutboxCard", () => {
  it("abre o aviso no app de e-mail com todos em Cco e tira da fila", async () => {
    const { userIds } = await insertTestCompany(testDb(), { companyId: C, roles: ["rh", "tecnico"] });
    await notifyUsers(testDb(), C, { userIds: Object.values(userIds) as string[], type: "x", title: "Plano de saúde", message: "Confirme", important: true });

    page = await renderPage(<EmailOutboxCard />, { companyId: C, role: "rh" });
    await until(() => page!.text().includes("Plano de saúde"), "aviso pendente");
    expect(page.text()).toMatch(/2 destinatários/);
    const link = page.container.querySelector<HTMLAnchorElement>("a[href^='mailto:']");
    expect(link?.getAttribute("href")).toContain("bcc=");

    await click(link!);
    await until(() => page!.text().includes("Nenhum e-mail pendente"), "fila vazia");
    const rows = await testDb().select<{ status: string }[]>("SELECT status FROM email_outbox");
    expect(rows.every((row) => row.status === "enviado")).toBe(true);
  });

  it("não aparece para quem não publica comunicados", async () => {
    await insertTestCompany(testDb(), { companyId: C, roles: ["tecnico"] });
    page = await renderPage(<EmailOutboxCard />, { companyId: C, role: "tecnico" });
    expect(page.text()).toBe("");
  });
});
