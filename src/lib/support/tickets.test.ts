// @vitest-environment jsdom
// Gravação dos tickets pela tabela editável e pela ficha do ticket, no SQLite real e no banco demo: permissão
// conferida na camada de dados, só os campos que mudaram e validação de assunto, prioridade e status.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import type { Ticket } from "@/types";
import { saveTicketChanges, TICKET_PRIORITY_OPTIONS, TICKET_STATUS_OPTIONS } from "./tickets";

const C = "test-company";
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
});

afterEach(() => db.close());

const actor = (role: "tecnico" | "comercial" | "atendimento") => ({ role, userId: `test-user-${role}` });

async function ticket(id: string, patch: Partial<Ticket> = {}): Promise<void> {
  await db.execute("INSERT INTO tickets (id, company_id, subject, priority, status, opened_by) VALUES (?,?,?,?,?,?)", [
    id, C, patch.subject ?? "Impressora", patch.priority ?? "media", patch.status ?? "aberto", patch.opened_by ?? "test-user-comercial",
  ]);
}

describe("saveTicketChanges", () => {
  it("cria ticket com quem abriu, área e status aberto; atualiza só os campos que mudaram", async () => {
    await ticket("t-1", { subject: "VPN caiu" });
    const result = await saveTicketChanges(db, C, actor("tecnico"), {
      created: [{ subject: "  Notebook sem som ", priority: "alta", description: "Sala 3" }],
      updated: [{ id: "t-1", status: "em_atendimento" }],
    });
    expect(result.created).toHaveLength(1);
    const [created] = await db.select<Ticket[]>("SELECT * FROM tickets WHERE id=?", [result.created[0]]);
    expect(created).toMatchObject({ subject: "Notebook sem som", priority: "alta", status: "aberto", description: "Sala 3", opened_by: "test-user-tecnico", requester_area: "TI / Operações" });
    const [updated] = await db.select<Ticket[]>("SELECT * FROM tickets WHERE id=?", ["t-1"]);
    expect(updated).toMatchObject({ subject: "VPN caiu", status: "em_atendimento", priority: "media" });
  });

  it("quem só abre ticket não edita (nem pela tabela) e o ticket novo dele sempre começa aberto", async () => {
    await ticket("t-1");
    await expect(saveTicketChanges(db, C, actor("comercial"), { created: [], updated: [{ id: "t-1", status: "resolvido" }] })).rejects.toThrow(/permissão/);
    expect((await db.select<Ticket[]>("SELECT * FROM tickets WHERE id=?", ["t-1"]))[0].status).toBe("aberto");

    const result = await saveTicketChanges(db, C, actor("comercial"), { created: [{ subject: "Sem acesso ao e-mail", status: "resolvido" }], updated: [] });
    expect((await db.select<Ticket[]>("SELECT * FROM tickets WHERE id=?", [result.created[0]]))[0]).toMatchObject({ status: "aberto", requester_area: "Comercial" });
  });

  it("recusa assunto vazio, prioridade ou status fora da lista e ticket de outra empresa", async () => {
    await ticket("t-1");
    await db.execute("INSERT INTO companies (id, name) VALUES (?,?)", ["outra", "Outra"]);
    await db.execute("INSERT INTO tickets (id, company_id, subject) VALUES (?,?,?)", ["t-x", "outra", "Alheio"]);
    await expect(saveTicketChanges(db, C, actor("tecnico"), { created: [{ subject: "   " }], updated: [] })).rejects.toThrow(/assunto/i);
    await expect(saveTicketChanges(db, C, actor("tecnico"), { created: [], updated: [{ id: "t-1", priority: "altissima" as Ticket["priority"] }] })).rejects.toThrow(/prioridade/i);
    await expect(saveTicketChanges(db, C, actor("tecnico"), { created: [], updated: [{ id: "t-1", status: "sumido" as Ticket["status"] }] })).rejects.toThrow(/status/i);
    await expect(saveTicketChanges(db, C, actor("tecnico"), { created: [], updated: [{ id: "t-x", subject: "Meu" }] })).rejects.toThrow(/não encontrado/);
    expect((await db.select<Ticket[]>("SELECT * FROM tickets WHERE id=?", ["t-x"]))[0].subject).toBe("Alheio");
  });

  it("opções de prioridade e status com rótulos em português", () => {
    expect(TICKET_PRIORITY_OPTIONS.map((option) => option.label)).toEqual(["Baixa", "Média", "Alta", "Urgente"]);
    expect(TICKET_STATUS_OPTIONS.map((option) => option.value)).toEqual(["aberto", "em_atendimento", "aguardando", "resolvido", "fechado"]);
  });

  it("funciona no banco demo do navegador", async () => {
    localStorage.clear();
    const demo = createDemoDb();
    const result = await saveTicketChanges(demo, DEMO_COMPANY_ID, { role: "tecnico", userId: "demo-user" }, { created: [{ subject: "Teclado", priority: "baixa" }], updated: [] });
    await saveTicketChanges(demo, DEMO_COMPANY_ID, { role: "tecnico", userId: "demo-user" }, { created: [], updated: [{ id: result.created[0], status: "resolvido", description: "Trocado" }] });
    const [saved] = await demo.select<Ticket[]>("SELECT * FROM tickets WHERE id=?", [result.created[0]]);
    expect(saved).toMatchObject({ subject: "Teclado", status: "resolvido", description: "Trocado", priority: "baixa" });
  });
});
