import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { ensureSiteProspectingSeed, SEED_SKIP_SETTING_KEY } from "@/lib/prospecting/seed";
import type { Session } from "@/types";
import SetupPage from "./SetupPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
// Hash rápido e previsível: aqui o assunto é o fluxo do Setup; o algoritmo é testado em lib/auth/hash.test.ts.
const { hashPassword } = vi.hoisted(() => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/auth/hash", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/hash")>()), hashPassword }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  hashPassword.mockReset().mockImplementation(async (password: string) => `pbkdf2$sha256$1$c2Fs$${btoa(password)}`);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/setup"]}><SetupPage /></MemoryRouter>);
  });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`campo #${id} não encontrado`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement | null) {
  if (!element) throw new Error("elemento não encontrado");
  await act(async () => {
    element.click();
  });
}

/** O envio do Setup encadeia várias gravações assíncronas: espera (dentro do act) até a tela mostrar o resultado. */
async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

const submit = () => click(container.querySelector<HTMLButtonElement>("button[type=submit]"));
const alertText = () => container.querySelector("[role=alert]")?.textContent ?? "";
const done = () => (container.textContent ?? "").includes("Empresa configurada!");

async function fillCompanyAndCeo() {
  await type("setup-company", "Minha Empresa Ltda");
  await submit();
  await type("setup-name", "André Machado");
  await type("setup-email", "Andre@MinhaEmpresa.com.br");
  await type("setup-password", "senha-do-ceo");
  await type("setup-password2", "senha-do-ceo");
}

async function count(sql: string): Promise<number> {
  const [row] = await testDb().select<{ n: number }[]>(sql);
  return row.n;
}

describe("SetupPage", () => {
  it("cria a empresa, o CEO e uma conta por setor com troca de senha obrigatória", async () => {
    await fillCompanyAndCeo();
    await click(container.querySelector<HTMLInputElement>("input[type=checkbox]"));
    await type("setup-sector-password", "inicial123");
    await submit();
    await until(done, "tela de conclusão");

    const db = testDb();
    const [company] = await db.select<{ id: string; name: string }[]>("SELECT id, name FROM companies");
    expect(company.name).toBe("Minha Empresa Ltda");
    const accounts = await db.select<{ email: string; role: string; must_change_password: number }[]>(
      "SELECT u.email, m.role, u.must_change_password FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.company_id = ? ORDER BY u.email",
      [company.id],
    );
    expect(accounts).toHaveLength(11);
    expect(accounts.find((account) => account.role === "ceo")).toEqual({ email: "andre@minhaempresa.com.br", role: "ceo", must_change_password: 0 });
    const sectors = accounts.filter((account) => account.role !== "ceo");
    expect(sectors.every((account) => account.email === `${account.role}@empresa.local` && account.must_change_password === 1)).toBe(true);
    expect(container.textContent).toContain("Contas dos setores (10)");
  });

  it("se o hash da senha do CEO falhar, nada é gravado e dá para tentar de novo (a empresa não fica sem CEO)", async () => {
    await fillCompanyAndCeo();
    hashPassword.mockRejectedValueOnce(new Error("Este navegador não oferece criptografia segura (WebCrypto)."));
    await submit();
    await until(() => alertText() !== "", "mensagem de erro");

    expect(alertText()).toContain("WebCrypto");
    expect(await count("SELECT count(*) AS n FROM companies")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM users")).toBe(0);

    await submit();
    await until(done, "tela de conclusão");
    expect(await count("SELECT count(*) AS n FROM companies")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM memberships WHERE role = 'ceo'")).toBe(1);
  });

  it("empresa nova começa limpa: sem a prospecção de sites da LeadingSites, a menos que marque", async () => {
    await fillCompanyAndCeo();
    const prospecting = container.querySelector<HTMLInputElement>("#setup-prospecting");
    expect(prospecting?.checked).toBe(false);
    await submit();
    await until(done, "tela de conclusão");

    const db = testDb();
    const [company] = await db.select<{ id: string }[]>("SELECT id FROM companies");
    const [ceo] = await db.select<{ id: string }[]>("SELECT id FROM users");
    expect(await count(`SELECT count(*) AS n FROM settings WHERE key = '${SEED_SKIP_SETTING_KEY}'`)).toBe(1);
    const session = { company: { id: company.id }, user: { id: ceo.id }, membership: { role: "ceo" } } as unknown as Session;
    expect(await ensureSiteProspectingSeed(session)).toBe(false);
    expect(await count("SELECT count(*) AS n FROM leads")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM projects")).toBe(0);
  });

  it("marcar a prospecção da LeadingSites deixa o seed rodar no primeiro acesso", async () => {
    await fillCompanyAndCeo();
    await click(container.querySelector<HTMLInputElement>("#setup-prospecting"));
    await submit();
    await until(done, "tela de conclusão");
    expect(await count("SELECT count(*) AS n FROM settings")).toBe(0);
  });

  it("recusa rodar quando a empresa já está cadastrada", async () => {
    await insertTestCompany(testDb(), { roles: ["ceo"] });
    await fillCompanyAndCeo();
    await submit();
    await until(() => alertText() !== "", "mensagem de erro");

    expect(alertText()).toContain("já está cadastrada");
    expect(await count("SELECT count(*) AS n FROM companies")).toBe(1);
    expect(hashPassword).not.toHaveBeenCalled();
  });
});
