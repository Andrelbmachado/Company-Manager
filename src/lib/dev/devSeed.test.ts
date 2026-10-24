import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import type { TestDb } from "@/test/sqlite";
import { DEV_AREAS, DEV_PASSWORD, devEmail } from "./quickLogin";
import { devUserId, seedDevData } from "./devSeed";
import { areaSeeds, runAreaSeeds } from "./seeds";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const COMPANY_ID = "dev-company";

/** Mesmo preparo de `devQuickLogin` (quickLogin.ts): empresa + uma conta por área. */
async function createDevCompany(db: TestDb): Promise<void> {
  await db.execute("INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)", [COMPANY_ID, "Minha Empresa"]);
  for (const area of DEV_AREAS) {
    const userId = devUserId(area.role);
    await db.execute("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", [
      userId,
      area.name,
      devEmail(area.role),
      `plain:${DEV_PASSWORD}`,
    ]);
    await db.execute("INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?,?,?,?,?)", [
      `dev-member-${area.role}`,
      COMPANY_ID,
      userId,
      area.role,
      ["ceo", "admin", "gerente"].includes(area.role) ? "empresa" : "setor",
    ]);
  }
}

// Linhas por empresa depois do seed principal (devSeed.ts) e dos seeds de área (seeds/*.ts), que também gravam em
// algumas destas tabelas: +4 contatos principais e +3 propostas (crm), +2 colaboradores e +7 tarefas de RH (hr),
// +3 contas a pagar (purchasing), +4 contas a receber (sales) e movimentações com os saldos novos que elas criam.
const EXPECTED: Record<string, number> = {
  customers: 12,
  contacts: 12,
  opportunities: 12,
  proposals: 7,
  tickets: 12,
  work_orders: 8,
  projects: 3,
  project_stages: 9,
  tasks: 9,
  suppliers: 5,
  stock_locations: 2,
  inventory_items: 16,
  stock_balances: 20,
  stock_movements: 19,
  custodies: 4,
  cost_centers: 5,
  payables: 15,
  receivables: 14,
  documents: 15,
  employees: 17,
  employee_compensation: 15,
  hr_requests: 7,
  hr_announcements: 4,
  hr_tasks: 12,
  activities: 5,
  audit_logs: 6,
  leads: 0,
};

async function count(db: TestDb, table: string): Promise<number> {
  const [row] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table}`);
  return row.n;
}

async function allTables(db: TestDb): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((row) => row.name);
}

/** Contagem de todas as tabelas (inclui as que os seeds de área criarem no futuro). */
async function snapshot(db: TestDb): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of await allTables(db)) result[table] = await count(db, table);
  return result;
}

describe("seedDevData", () => {
  it("cria os dados de exemplo esperados e roda de novo sem duplicar", async () => {
    const db = testDb();
    await createDevCompany(db);
    expect(DEV_AREAS).toHaveLength(11);

    await seedDevData(COMPANY_ID);
    const first = await snapshot(db);
    expect(first).toMatchObject({ ...EXPECTED, companies: 1, users: 11, memberships: 11 });
    const [flag] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM settings WHERE company_id = ? AND key = ?", [COMPANY_ID, "seed.dev_data.v1"]);
    expect(flag.n).toBe(1);

    await seedDevData(COMPANY_ID);
    expect(await snapshot(db)).toEqual(first);
  });

  it("não duplica nada mesmo sem as flags (ids fixos + INSERT OR IGNORE)", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    const first = await snapshot(db);

    await db.execute("DELETE FROM settings WHERE company_id = ?", [COMPANY_ID]);
    await seedDevData(COMPANY_ID);
    expect(await snapshot(db)).toEqual(first);
  });

  it("nunca semeia leads", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    expect(await count(db, "leads")).toBe(0);
  });

  it("grava tudo na empresa certa, liga colaboradores às contas e respeita as chaves estrangeiras", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);

    for (const table of await allTables(db)) {
      const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
      if (!cols.some((col) => col.name === "company_id") || (await count(db, table)) === 0) continue;
      const rows = await db.select<{ company_id: string }[]>(`SELECT DISTINCT company_id FROM ${table}`);
      expect(rows, table).toEqual([{ company_id: COMPANY_ID }]);
    }

    const linked = await db.select<{ id: string; user_id: string | null }[]>(
      "SELECT id, user_id FROM employees WHERE company_id = ? AND user_id IS NOT NULL ORDER BY id",
      [COMPANY_ID],
    );
    expect(linked).toHaveLength(DEV_AREAS.length);
    for (const area of DEV_AREAS) expect(linked).toContainEqual({ id: `dev-emp-${area.role}`, user_id: devUserId(area.role) });

    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("seeds de área (src/lib/dev/seeds/*.ts)", () => {
  it("são descobertos sozinhos, em ordem alfabética, e todos rodam sem erro", async () => {
    const names = areaSeeds.map((seed) => seed.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(["catalog", "crm", "finance", "hr", "imports", "inventory", "purchasing", "sales", "settlements"]));
    // Baixas e extrato dependem das contas de compras e vendas: rodam por último.
    expect(names.at(-1)).toBe("settlements");
    expect(names).not.toContain("index");

    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    const results = await runAreaSeeds(COMPANY_ID);
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.map((result) => result.name)).toEqual(names);
  });

  it("rodam também quando a flag principal já existe (cada área tem a sua)", async () => {
    const db = testDb();
    await createDevCompany(db);
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", ["flag-antiga", COMPANY_ID, "seed.dev_data.v1", "{}"]);
    await seedDevData(COMPANY_ID);
    expect(await count(db, "customers")).toBe(0);
    expect(await count(db, "finance_categories")).toBeGreaterThan(0);
    expect(await count(db, "products")).toBeGreaterThan(0);
    expect(await count(db, "import_batches")).toBeGreaterThan(0);
    // Sem clientes, fornecedores e colaboradores, as áreas que dependem deles esperam (sem flag) o próximo login.
    for (const table of ["sales_orders", "purchase_orders", "crm_activities", "inventory_counts", "hr_time_entries"]) expect(await count(db, table), table).toBe(0);
    for (const area of ["crm", "sales", "purchasing", "inventory", "hr"]) {
      const flags = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM settings WHERE company_id = ? AND key = ?", [COMPANY_ID, `seed.dev.${area}.v1`]);
      expect(flags[0].n, area).toBe(0);
    }
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("catálogo e financeiro trazem produtos, tabela de preço, plano de contas e contas bancárias", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    expect(await count(db, "products")).toBeGreaterThanOrEqual(10);
    expect(await count(db, "price_lists")).toBeGreaterThanOrEqual(1);
    expect(await count(db, "finance_categories")).toBeGreaterThanOrEqual(10);
    expect(await count(db, "bank_accounts")).toBeGreaterThanOrEqual(2);
    const children = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM finance_categories WHERE parent_id IS NOT NULL");
    expect(children[0].n).toBeGreaterThan(0);
    const linked = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM products WHERE inventory_item_id IS NOT NULL");
    expect(linked[0].n).toBeGreaterThan(0);
  });

  it("um seed de área que falha não derruba os outros nem o login", async () => {
    const db = testDb();
    await createDevCompany(db);
    // Empresa inexistente: as chaves estrangeiras fazem os inserts falharem; o erro volta no resultado.
    const results = await runAreaSeeds("empresa-que-nao-existe");
    expect(results.length).toBe(areaSeeds.length);
    expect(results.some((result) => !result.ok && typeof result.error === "string" && result.error.length > 0)).toBe(true);
  });
});

describe("dados de exemplo de CRM, vendas, compras, estoque, RH, importação e extrato", () => {
  type Row = Record<string, unknown>;
  const rows = (db: TestDb, sql: string, binds: unknown[] = []) => db.select<Row[]>(sql, binds);
  const money = (value: unknown) => Math.round(Number(value) * 100);
  const sumOf = (list: Row[], column: string) => list.reduce((total, row) => total + money(row[column]), 0);

  async function seeded(): Promise<TestDb> {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    return db;
  }

  it("trazem o que as telas novas mostram, com numeração 1, 2, 3... por documento", async () => {
    const db = await seeded();
    const minimum: Record<string, number> = {
      tags: 5, entity_tags: 5, saved_views: 2, crm_activities: 10, proposal_items: 6,
      sales_orders: 5, sales_order_items: 5, invoices: 2, invoice_items: 2,
      purchase_orders: 4, purchase_order_items: 4, goods_receipts: 2, goods_receipt_items: 2,
      inventory_counts: 2, inventory_count_items: 4, hr_time_entries: 8, import_batches: 3,
      recurring_entries: 4, finance_settlements: 5, bank_transactions: 10,
    };
    for (const [table, n] of Object.entries(minimum)) expect(await count(db, table), table).toBeGreaterThanOrEqual(n);

    const statuses = (await rows(db, "SELECT status FROM sales_orders ORDER BY number")).map((row) => row.status);
    expect(statuses).toEqual(["confirmado", "faturado", "entregue", "rascunho", "cancelado"]);
    expect((await rows(db, "SELECT DISTINCT status FROM purchase_orders ORDER BY status")).map((row) => row.status)).toEqual(["enviado", "rascunho", "recebido", "recebido_parcial"]);
    for (const table of ["sales_orders", "invoices", "purchase_orders", "goods_receipts", "inventory_counts", "proposals"]) {
      const numbers = (await rows(db, `SELECT number FROM ${table} ORDER BY number`)).map((row) => row.number);
      expect(numbers, table).toEqual(numbers.map((_, index) => index + 1));
    }
    // Propostas antigas ganharam título e cliente da oportunidade.
    expect(await rows(db, "SELECT id FROM proposals WHERE title IS NULL OR customer_id IS NULL")).toEqual([]);
    // Todo cliente tem exatamente um contato principal.
    const primaries = await rows(db, "SELECT customer_id, count(*) AS n FROM contacts WHERE is_primary = 1 GROUP BY customer_id");
    expect(primaries).toHaveLength(12);
    expect(primaries.every((row) => row.n === 1)).toBe(true);
    // Atividades atrasadas (abertas e vencidas) existem para a lista de pendências.
    expect((await rows(db, "SELECT id FROM crm_activities WHERE done_at IS NULL AND due_at < ?", [new Date().toISOString()])).length).toBeGreaterThan(0);
  });

  it("totais fecham: itens = subtotal, total = subtotal − desconto + frete + impostos, parcelas = fatura", async () => {
    const db = await seeded();
    for (const [table, items, key] of [["sales_orders", "sales_order_items", "order_id"], ["purchase_orders", "purchase_order_items", "order_id"], ["invoices", "invoice_items", "invoice_id"], ["proposals", "proposal_items", "proposal_id"]] as const) {
      for (const doc of await rows(db, `SELECT * FROM ${table} WHERE id LIKE 'dev-%-%-%'`)) {
        const lines = await rows(db, `SELECT * FROM ${items} WHERE ${key} = ?`, [doc.id]);
        if (table === "proposals" && lines.length === 0) continue;
        expect(lines.length, String(doc.id)).toBeGreaterThan(0);
        for (const line of lines) expect(money(line.total), String(line.id)).toBe(Math.max(0, Math.round(Number(line.qty) * Number(line.unit_price) * 100) - money(line.discount)));
        expect(sumOf(lines, "total"), String(doc.id)).toBe(money(doc.subtotal));
        const total = table === "proposals" ? doc.value : doc.total;
        const expected = money(doc.subtotal) - money(doc.discount) + (table === "proposals" ? 0 : money(doc.shipping) + money(doc.tax_total));
        expect(money(total), String(doc.id)).toBe(expected);
      }
    }
    for (const invoice of await rows(db, "SELECT * FROM invoices")) {
      const installments = await rows(db, "SELECT * FROM receivables WHERE invoice_id = ? ORDER BY installment_number", [invoice.id]);
      expect(installments.map((row) => row.installment_number)).toEqual(installments.map((_, index) => index + 1));
      expect(installments.every((row) => row.installment_count === invoice.installments)).toBe(true);
      expect(sumOf(installments, "amount"), String(invoice.id)).toBe(money(invoice.total));
      expect(sumOf(installments, "received_amount"), String(invoice.id)).toBe(money(invoice.paid_amount));
    }
    for (const receipt of await rows(db, "SELECT * FROM goods_receipts")) {
      const payables = await rows(db, "SELECT * FROM payables WHERE goods_receipt_id = ?", [receipt.id]);
      expect(payables.length, String(receipt.id)).toBeGreaterThan(0);
      expect(sumOf(payables, "amount"), String(receipt.id)).toBe(money(receipt.total));
    }
  });

  it("estoque: cada entrada, saída e ajuste tem origem e custo, e nenhum saldo fica negativo", async () => {
    const db = await seeded();
    expect(await rows(db, "SELECT id FROM stock_balances WHERE quantity < 0")).toEqual([]);
    for (const item of await rows(db, "SELECT * FROM goods_receipt_items")) {
      const [movement] = await rows(db, "SELECT * FROM stock_movements WHERE id = ?", [item.stock_movement_id]);
      expect(movement, String(item.id)).toMatchObject({ type: "entrada", quantity: item.qty, to_location_id: item.location_id, ref_type: "goods_receipt", ref_id: item.receipt_id, unit_cost: item.unit_cost });
    }
    const delivered = await rows(db, "SELECT * FROM stock_movements WHERE ref_type = 'sales_order'");
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every((row) => row.type === "saida" && row.from_location_id && !row.to_location_id && Number(row.unit_cost) > 0)).toBe(true);
    const counted = await rows(db, "SELECT * FROM inventory_count_items WHERE counted_qty IS NOT NULL AND counted_qty <> expected_qty");
    expect(counted.length).toBe(2);
    for (const item of counted) {
      const [movement] = await rows(db, "SELECT * FROM stock_movements WHERE id = ?", [item.adjustment_movement_id]);
      const missing = Number(item.counted_qty) < Number(item.expected_qty);
      expect(movement, String(item.id)).toMatchObject({ type: "ajuste", quantity: Math.abs(Number(item.counted_qty) - Number(item.expected_qty)), ref_type: "inventory_count" });
      expect(missing ? movement.from_location_id : movement.to_location_id).toBe(item.location_id);
      expect(missing ? movement.to_location_id : movement.from_location_id).toBeNull();
    }
    const [transfer] = await rows(db, "SELECT * FROM stock_movements WHERE type = 'transferencia'");
    expect(transfer.from_location_id).not.toBe(transfer.to_location_id);
    const [arrived] = await rows(db, "SELECT * FROM stock_balances WHERE item_id = ? AND location_id = ?", [transfer.item_id, transfer.to_location_id]);
    expect(Number(arrived.quantity)).toBeGreaterThanOrEqual(Number(transfer.quantity));
  });

  it("financeiro: toda conta paga ou recebida tem baixa no valor pago, e o extrato conciliado aponta para ela", async () => {
    const db = await seeded();
    for (const [table, status, paid, key] of [["payables", "paga", "paid_amount", "payable_id"], ["receivables", "recebida", "received_amount", "receivable_id"]] as const) {
      for (const row of await rows(db, `SELECT * FROM ${table} WHERE status = ?`, [status])) {
        const settlements = await rows(db, `SELECT * FROM finance_settlements WHERE ${key} = ?`, [row.id]);
        expect(settlements, String(row.id)).toHaveLength(1);
        expect(money(settlements[0].amount), String(row.id)).toBe(money(row[paid]));
        expect(money(row[paid]), String(row.id)).toBe(money(row.amount));
      }
    }
    const reconciled = await rows(db, "SELECT * FROM bank_transactions WHERE status = 'conciliada'");
    expect(reconciled.length).toBeGreaterThan(0);
    for (const transaction of reconciled) {
      expect(Boolean(transaction.payable_id) !== Boolean(transaction.receivable_id), String(transaction.id)).toBe(true);
      expect(Number(transaction.amount) < 0, String(transaction.id)).toBe(Boolean(transaction.payable_id));
      const [settlement] = await rows(db, "SELECT * FROM finance_settlements WHERE bank_transaction_id = ?", [transaction.id]);
      expect(money(settlement.amount)).toBe(Math.abs(money(transaction.amount)));
      expect(settlement.paid_at).toBe(transaction.posted_at);
    }
    expect((await rows(db, "SELECT DISTINCT status FROM bank_transactions ORDER BY status")).map((row) => row.status)).toEqual(["conciliada", "ignorada", "pendente"]);
    const fitids = await rows(db, "SELECT bank_account_id, fitid, count(*) AS n FROM bank_transactions GROUP BY bank_account_id, fitid HAVING n > 1");
    expect(fitids).toEqual([]);
    expect((await rows(db, "SELECT id FROM payables WHERE recurring_entry_id IS NOT NULL")).length).toBe(2);
  });

  it("RH: todos com dados de admissão, uma admissão e um desligamento com checklist, banco de horas com decididos e pendentes", async () => {
    const db = await seeded();
    expect(await rows(db, "SELECT id FROM employees WHERE rg IS NULL OR pis IS NULL OR address_json IS NULL OR address_json = '{}' OR emergency_contact_name IS NULL")).toEqual([]);
    const [leaver] = await rows(db, "SELECT * FROM employees WHERE status = 'desligado'");
    expect(leaver.termination_date).toBeTruthy();
    const categories = await rows(db, "SELECT category, count(*) AS n FROM hr_tasks GROUP BY category ORDER BY category");
    expect(categories).toEqual([{ category: "admissao", n: 4 }, { category: "desligamento", n: 3 }, { category: "geral", n: 5 }]);
    const entries = await rows(db, "SELECT * FROM hr_time_entries");
    expect(new Set(entries.map((row) => row.status))).toEqual(new Set(["pendente", "aprovada", "recusada"]));
    expect(entries.some((row) => Number(row.minutes) < 0)).toBe(true);
    expect(entries.every((row) => (row.status === "pendente") === (row.decided_by == null))).toBe(true);
    // Colaborador desligado não recebe lançamento novo de banco de horas.
    expect(entries.some((row) => row.employee_id === leaver.id)).toBe(false);
  });
});
