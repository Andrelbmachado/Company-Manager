// @vitest-environment jsdom
// Banco demo do navegador (localStorage): tabelas e defaults vêm das migrations; SQL fora dos padrões é erro, não dado errado.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, DEMO_STORAGE_KEY } from "./demo";

const C = DEMO_COMPANY_ID;
type Row = Record<string, unknown>;

beforeEach(() => localStorage.clear());

const MIGRATIONS = import.meta.glob<string>("/src-tauri/migrations/*.sql", { query: "?raw", import: "default", eager: true });
const migrationTables = () =>
  [...new Set(Object.values(MIGRATIONS).flatMap((sql) => [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map((match) => match[1])))];

describe("banco demo", () => {
  it("conhece toda tabela criada pelas migrations", async () => {
    const db = createDemoDb();
    const tables = migrationTables();
    expect(tables).toEqual(expect.arrayContaining(["products", "sales_orders", "bank_transactions", "crm_activities", "contacts", "proposals", "stock_locations", "stock_movements", "cost_centers"]));
    for (const table of tables.filter((name) => !["companies", "users", "audit_logs"].includes(name))) {
      await expect(db.select<Row[]>(`SELECT * FROM ${table} WHERE company_id=?`, [C]), table).resolves.toBeInstanceOf(Array);
    }
  });

  it("INSERT genérico aplica os DEFAULT das migrations e completa as colunas com NULL", async () => {
    const db = createDemoDb();
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["so-1", C, 1]);
    const [order] = await db.select<Row[]>("SELECT * FROM sales_orders WHERE company_id=? AND id=?", [C, "so-1"]);
    expect(order).toMatchObject({ status: "rascunho", installments: 1, subtotal: 0, total: 0, customer_id: null, deleted_at: null });
    expect(String(order.order_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(order.created_at).toBeTruthy();
    expect(Object.keys(order)).toEqual(expect.arrayContaining(["notes", "cancel_reason", "seller_id"]));
  });

  it("tabelas antigas aceitam as colunas novas (ex.: contas a pagar com categoria e baixa parcial)", async () => {
    const db = createDemoDb();
    await db.execute("INSERT INTO payables (id, company_id, description, amount, due_date, status, category_id, installment_number, installment_count) VALUES (?,?,?,?,?,?,?,?,?)", ["p1", C, "Aluguel", 1000, "2026-11-05", "aberta", "cat-1", 1, 2]);
    await db.execute("UPDATE payables SET paid_amount=?, status=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [400, "paga_parcial", "p1", C]);
    const [row] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]);
    expect(row).toMatchObject({ description: "Aluguel", category_id: "cat-1", installment_count: 2, paid_amount: 400, status: "paga_parcial", bank_account_id: null });

    await db.execute("INSERT INTO payables (id, company_id, description, amount, due_date, status) VALUES (?,?,?,?,?,?)", ["p2", C, "Legado", 50, null, "aberta"]);
    const [legacy] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p2"]);
    expect(legacy).toMatchObject({ description: "Legado", amount: 50, paid_amount: 0 });
  });

  it("linhas do seed ganham as colunas novas com os mesmos valores da migração 0008", async () => {
    const db = createDemoDb();
    const receivables = await db.select<Row[]>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC", [C]);
    const received = receivables.find((row) => row.status === "recebida");
    expect(received).toMatchObject({ received_amount: received?.amount });
    expect(receivables.every((row) => row.description === row.ref_id)).toBe(true);
    const payables = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL", [C]);
    expect(payables.find((row) => row.status === "paga")).toMatchObject({ paid_amount: 6800 });
    expect(payables.find((row) => row.status === "aberta")).toMatchObject({ paid_amount: 0 });
  });

  it("WHERE aceita literal (status='pendente') e literais mantêm maiúsculas", async () => {
    const db = createDemoDb();
    const result = await db.execute("UPDATE hr_requests SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=? AND status='pendente'", ["aprovada", "hrreq-1", C]);
    expect(result).toEqual({ rowsAffected: 1 });
    const again = await db.execute("UPDATE hr_requests SET status=? WHERE id=? AND company_id=? AND status='pendente'", ["recusada", "hrreq-1", C]);
    expect(again).toEqual({ rowsAffected: 0 });

    await db.execute("INSERT INTO tags (id, company_id, name, color) VALUES (?, ?, 'VIP', 'info')", ["t1", C]);
    const [tag] = await db.select<Row[]>("SELECT * FROM tags WHERE company_id=? AND name='VIP'", [C]);
    expect(tag).toMatchObject({ name: "VIP", color: "info" });

    await db.execute("INSERT INTO memberships (id, company_id, user_id, role, scope) VALUES (?, ?, ?, 'ceo', 'empresa')", ["m-novo", C, "u-novo"]);
    const [membership] = await db.select<Row[]>("SELECT * FROM memberships WHERE company_id=? AND id=?", [C, "m-novo"]);
    expect(membership).toMatchObject({ role: "ceo", scope: "empresa" });
  });

  it("count(*), ORDER BY e LIMIT nas tabelas novas", async () => {
    const db = createDemoDb();
    for (const [id, number] of [["a", 3], ["b", 1], ["c", 2]] as const) {
      await db.execute("INSERT INTO invoices (id, company_id, number, total) VALUES (?, ?, ?, ?)", [id, C, number, number * 10]);
    }
    expect(await db.select("SELECT count(*) AS n FROM invoices WHERE company_id=? AND deleted_at IS NULL", [C])).toEqual([{ n: 3 }]);
    const ordered = await db.select<Row[]>("SELECT * FROM invoices WHERE company_id=? ORDER BY number DESC LIMIT 2", [C]);
    expect(ordered.map((row) => row.number)).toEqual([3, 2]);
  });

  it("INSERT OR IGNORE não duplica e INSERT OR REPLACE substitui a linha inteira", async () => {
    const db = createDemoDb();
    await db.execute("INSERT OR IGNORE INTO products (id, company_id, name, price) VALUES (?, ?, ?, ?)", ["p1", C, "A", 10]);
    expect(await db.execute("INSERT OR IGNORE INTO products (id, company_id, name, price) VALUES (?, ?, ?, ?)", ["p1", C, "B", 20])).toEqual({ rowsAffected: 0 });
    await db.execute("INSERT OR REPLACE INTO products (id, company_id, name) VALUES (?, ?, ?)", ["p1", C, "C"]);
    const rows = await db.select<Row[]>("SELECT * FROM products WHERE company_id=?", [C]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "C", price: 0, kind: "produto" });
  });

  it("SQL que o demo não entende é erro (nunca grava ou devolve dado errado)", async () => {
    const db = createDemoDb();
    await expect(db.execute("UPDATE stock_balances SET quantity = quantity + ? WHERE id=?", [1, "balance-1"])).rejects.toThrow(/demo/i);
    await expect(db.select("SELECT * FROM sales_orders WHERE company_id=? AND total > ?", [C, 10])).rejects.toThrow(/demo/i);
    await expect(db.select("SELECT o.* FROM sales_orders o JOIN customers c ON c.id = o.customer_id WHERE o.company_id=?", [C])).rejects.toThrow(/demo/i);
    await expect(db.execute("INSERT INTO products (id, company_id, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", ["p1", C, "A"])).rejects.toThrow(/demo/i);
    await expect(db.execute("INSERT INTO tabela_que_nao_existe (id) VALUES (?)", ["x"])).rejects.toThrow(/demo/i);
  });

  it("telas legadas continuam iguais: contagens do dashboard, JOIN de tickets e padrões do INSERT antigo", async () => {
    const db = createDemoDb();
    expect(await db.select("SELECT COUNT(*) as n FROM customers WHERE company_id=? AND deleted_at IS NULL", [C])).toEqual([{ n: 8 }]);
    expect(await db.select("SELECT COUNT(*) as n FROM payables WHERE company_id=? AND status IN ('aberta','aprovada') AND deleted_at IS NULL", [C])).toEqual([{ n: 3 }]);
    await db.execute("INSERT INTO tickets (id, company_id, subject, description, priority, opened_by, requester_area) VALUES (?,?,?,?,?,?,?)", ["t-novo", C, "Teste", null, "baixa", "demo-ti", "TI"]);
    const tickets = await db.select<Row[]>("SELECT t.*, opener.name as opener_name, agent.name as agent_name FROM tickets t LEFT JOIN users opener ON opener.id = t.opened_by LEFT JOIN users agent ON agent.id = t.agent_id WHERE t.company_id=? AND t.deleted_at IS NULL ORDER BY t.created_at DESC", [C]);
    expect(tickets.find((row) => row.id === "t-novo")).toMatchObject({ channel: "portal", status: "aberto" });
    await db.execute("UPDATE tickets SET status='aberto', updated_at=datetime('now') WHERE id=?", ["ticket-4"]);
    const [reopened] = await db.select<Row[]>("SELECT * FROM tickets WHERE company_id=? AND id=?", [C, "ticket-4"]);
    expect(reopened.status).toBe("aberto");
    // WHERE que o demo não entende, em tabela legada: filtro antigo por empresa (não quebra a tela)
    expect((await db.select<Row[]>("SELECT * FROM customers WHERE company_id=? AND name LIKE ?", [C, "%a%"])).length).toBe(8);
  });

  it("tabelas novas: projeção de colunas, ORDER BY com várias colunas, coluna desconhecida e id repetido são erro", async () => {
    const db = createDemoDb();
    await db.execute("INSERT INTO finance_categories (id, company_id, name, kind, position) VALUES (?,?,?,?,?)", ["c2", C, "B", "receita", 1]);
    await db.execute("INSERT INTO finance_categories (id, company_id, name, kind, position) VALUES (?,?,?,?,?)", ["c1", C, "A", "despesa", 1]);
    await db.execute("INSERT INTO finance_categories (id, company_id, name, kind, position) VALUES (?,?,?,?,?)", ["c3", C, "C", "despesa", 0]);
    expect(await db.select("SELECT id, name FROM finance_categories WHERE company_id=? ORDER BY position ASC, name DESC", [C])).toEqual([
      { id: "c3", name: "C" },
      { id: "c2", name: "B" },
      { id: "c1", name: "A" },
    ]);
    await expect(db.execute("INSERT INTO finance_categories (id, company_id, name, nao_existe) VALUES (?,?,?,?)", ["c9", C, "X", 1])).rejects.toThrow(/demo/i);
    await expect(db.execute("UPDATE finance_categories SET nao_existe=? WHERE id=?", [1, "c1"])).rejects.toThrow(/demo/i);
    await expect(db.execute("INSERT INTO finance_categories (id, company_id, name) VALUES (?,?,?)", ["c1", C, "Dup"])).rejects.toThrow(/demo/i);
    await expect(db.select("SELECT sum(amount) AS total FROM bank_transactions WHERE company_id=?", [C])).rejects.toThrow(/demo/i);
    await expect(db.select("SELECT * FROM products WHERE company_id=? AND sku IN (?, ?)", [C, "a", "b"])).rejects.toThrow(/demo/i);
    await expect(db.select("SELECT * FROM products WHERE company_id=? OR sku=?", [C, "a"])).rejects.toThrow(/demo/i);
  });

  it("local de estoque do seed existe (saldos apontam para ele)", async () => {
    const db = createDemoDb();
    const [location] = await db.select<Row[]>("SELECT * FROM stock_locations WHERE company_id=? AND id=?", [C, "demo-stock-location"]);
    expect(location).toMatchObject({ name: "Depósito principal", deleted_at: null });
  });

  it("banco salvo antes das tabelas novas ganha tabelas e colunas ao abrir", async () => {
    const first = createDemoDb();
    await first.execute("INSERT INTO products (id, company_id, name) VALUES (?, ?, ?)", ["p1", C, "A"]);
    const saved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) ?? "{}") as Record<string, Row[]>;
    delete saved.products;
    delete saved.crm_activities;
    for (const row of saved.payables) {
      delete row.paid_amount;
      delete row.category_id;
    }
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));

    const reopened = createDemoDb();
    expect(await reopened.select("SELECT * FROM products WHERE company_id=?", [C])).toEqual([]);
    expect(await reopened.select("SELECT * FROM crm_activities WHERE company_id=?", [C])).toEqual([]);
    const payables = await reopened.select<Row[]>("SELECT * FROM payables WHERE company_id=?", [C]);
    expect(payables.length).toBeGreaterThan(0);
    for (const row of payables) {
      expect(row.paid_amount).toBe(row.status === "paga" ? row.amount : 0);
      expect(row).toHaveProperty("category_id", null);
    }
  });
});
