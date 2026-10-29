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
  payables: 71,
  receivables: 56,
  documents: 15,
  employees: 17,
  employee_compensation: 15,
  hr_requests: 99,
  hr_announcements: 4,
  hr_tasks: 56,
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

  it("financeiro: a última competência de cada recorrência é a da conta ligada a ela, mesmo na virada do mês", async () => {
    // 29/10: as licenças (vencimento em 5 dias) caem em novembro. Se a recorrência dissesse "outubro", gerar novembro
    // de novo bateria no índice único (recurring_entry_id, competence) da conta que já existe.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 29, 10));
    try {
      const db = await seeded();
      const linked = await rows(db, "SELECT p.id, p.competence, r.last_competence FROM payables p JOIN recurring_entries r ON r.id = p.recurring_entry_id ORDER BY p.id");
      expect(linked.map((row) => row.competence).sort()).toEqual(["2026-10", "2026-11"]);
      for (const row of linked) expect(row.last_competence, String(row.id)).toBe(row.competence);
    } finally {
      vi.useRealTimers();
    }
  });

  it("balanço anual varia todo mês, com meses no vermelho e no verde; RH e calendário cheios para o Meu RH", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 29, 10));
    try {
      const db = await seeded();
      const { annualBalance } = await import("@/lib/dashboard/finance");
      const months = await annualBalance(db, COMPANY_ID, 2026, { today: "2026-10-29" });
      const realized = months.map((month) => month.realizado).filter((value): value is number => value !== null);
      expect(realized.length).toBe(10);
      expect(realized.filter((value) => value < 0).length).toBeGreaterThanOrEqual(3);
      expect(realized.filter((value) => value > 0).length).toBeGreaterThanOrEqual(3);
      // Não há dois meses seguidos iguais (o gráfico não fica reto de janeiro a agosto).
      for (let index = 1; index < realized.length; index++) expect(realized[index], `mês ${index + 1}`).not.toBe(realized[index - 1]);

      const approved = await rows(db, "SELECT * FROM hr_requests WHERE status = 'aprovada'");
      expect(new Set(approved.map((row) => row.employee_id)).size).toBeGreaterThanOrEqual(10);
      const pending = await rows(db, "SELECT * FROM hr_requests WHERE status = 'pendente'");
      expect(pending.length).toBeGreaterThanOrEqual(10);
      const events = await rows(db, "SELECT * FROM calendar_events WHERE deleted_at IS NULL");
      expect(events.length).toBeGreaterThanOrEqual(15);
      // Leads nunca entram nos dados de exemplo.
      expect(await count(db, "leads")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("RH: todos com dados de admissão, uma admissão e um desligamento com checklist, banco de horas com decididos e pendentes", async () => {
    const db = await seeded();
    expect(await rows(db, "SELECT id FROM employees WHERE rg IS NULL OR pis IS NULL OR address_json IS NULL OR address_json = '{}' OR emergency_contact_name IS NULL")).toEqual([]);
    const [leaver] = await rows(db, "SELECT * FROM employees WHERE status = 'desligado'");
    expect(leaver.termination_date).toBeTruthy();
    const categories = await rows(db, "SELECT category, count(*) AS n FROM hr_tasks GROUP BY category ORDER BY category");
    expect(categories).toEqual([{ category: "admissao", n: 4 }, { category: "desligamento", n: 3 }, { category: "geral", n: 49 }]);
    const entries = await rows(db, "SELECT * FROM hr_time_entries");
    expect(new Set(entries.map((row) => row.status))).toEqual(new Set(["pendente", "aprovada", "recusada"]));
    expect(entries.some((row) => Number(row.minutes) < 0)).toBe(true);
    expect(entries.every((row) => (row.status === "pendente") === (row.decided_by == null))).toBe(true);
    // Colaborador desligado não recebe lançamento novo de banco de horas.
    expect(entries.some((row) => row.employee_id === leaver.id)).toBe(false);
  });
});

describe("no app desktop, os dados de exemplo só usam registros de exemplo", () => {
  type Row = Record<string, unknown>;

  // Registros de quem já usa o app (ids que vêm antes de "dev-" na ordem, como um uuid "0..."): o login rápido roda no
  // banco de verdade e não pode mexer neles nem pendurar pedido, fatura, tag, atividade, documento, baixa ou extrato neles.
  const REAL: [table: string, row: Row][] = [
    ["users", { id: "0-real-user", name: "Pessoa Real", email: "pessoa@empresa-real.com.br", password_hash: "plain:segredo" }],
    ["memberships", { id: "0-real-member", company_id: COMPANY_ID, user_id: "0-real-user", role: "comercial", scope: "setor" }],
    ["customers", { id: "0-real-customer", company_id: COMPANY_ID, type: "PJ", name: "Cliente Real Ltda", email: "contato@cliente-real.com.br" }],
    ["opportunities", { id: "0-real-opp", company_id: COMPANY_ID, customer_id: "0-real-customer", title: "Oportunidade real", value: 1000, stage: "novo", status: "open" }],
    ["proposals", { id: "0-real-proposal", company_id: COMPANY_ID, opportunity_id: "0-real-opp", value: 1000, status: "rascunho" }],
    ["employees", { id: "0-real-employee", company_id: COMPANY_ID, name: "Funcionária Real", email: "funcionaria@empresa-real.com.br", status: "ativo" }],
    ["suppliers", { id: "0-real-supplier", company_id: COMPANY_ID, name: "Fornecedor Real" }],
    ["stock_locations", { id: "0-real-location", company_id: COMPANY_ID, name: "Depósito real" }],
    ["inventory_items", { id: "0-real-item", company_id: COMPANY_ID, name: "Switch do depósito real", sku: "SW-GER-24", cost: 100 }],
    ["stock_balances", { id: "0-real-balance", company_id: COMPANY_ID, item_id: "0-real-item", location_id: "0-real-location", quantity: 50 }],
    ["bank_accounts", { id: "0-real-bank", company_id: COMPANY_ID, name: "Conta real", is_default: 1 }],
    ["payables", { id: "0-real-payable", company_id: COMPANY_ID, description: "Aluguel da sala", supplier_id: "0-real-supplier", amount: 1000, status: "paga", paid_amount: 1000, due_date: "2026-01-05", paid_at: "2026-01-05T12:00:00.000Z" }],
    ["receivables", { id: "0-real-receivable", company_id: COMPANY_ID, customer_id: "0-real-customer", description: "Serviço real", amount: 500, status: "recebida", received_amount: 500, due_date: "2026-01-10", received_at: "2026-01-10T12:00:00.000Z" }],
  ];
  const REAL_IDS = new Set(REAL.map(([, row]) => String(row.id)));

  async function realRows(db: TestDb): Promise<Row[]> {
    const result: Row[] = [];
    for (const [table, row] of REAL) result.push(...(await db.select<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [row.id])));
    return result;
  }

  it("não altera registros reais nem liga dados de exemplo a eles", async () => {
    const db = testDb();
    await createDevCompany(db);
    for (const [table, row] of REAL) {
      const cols = Object.keys(row);
      await db.execute(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((col) => row[col]));
    }
    const before = await realRows(db);

    await seedDevData(COMPANY_ID);

    expect(await realRows(db)).toEqual(before);
    const links: string[] = [];
    for (const table of await allTables(db)) {
      for (const row of await db.select<Row[]>(`SELECT * FROM ${table}`)) {
        if (REAL_IDS.has(String(row.id))) continue;
        for (const [col, value] of Object.entries(row)) if (typeof value === "string" && REAL_IDS.has(value)) links.push(`${table}.${col} (${String(row.id)}) -> ${value}`);
      }
    }
    expect(links).toEqual([]);

    // Os dados de exemplo continuam saindo inteiros, só em cima dos registros de exemplo.
    const flags = await db.select<{ key: string }[]>("SELECT key FROM settings WHERE company_id = ? AND key LIKE 'seed.dev.%' ORDER BY key", [COMPANY_ID]);
    expect(flags.map((row) => row.key)).toEqual(areaSeeds.map((seed) => `seed.dev.${seed.name}.v1`).sort());
    for (const [table, n] of Object.entries({ sales_orders: 5, invoices: 2, purchase_orders: 4, goods_receipts: 2, inventory_counts: 2, crm_activities: 10, hr_time_entries: 8 })) {
      expect(await count(db, table), table).toBe(n);
    }
  });
});
