// Pacotes e preços: três cards centralizados (nome → resumo → lista curta → preço por último, grande), comparativo de
// funções com ✓/✕ (uma linha por função, três colunas de pacote) e preços por segmento editáveis na própria tabela.
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, plain, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { SITE_PACKAGES } from "@/lib/prospecting/data/siteProspecting.generated";
import { CARD_FEATURE_LIMIT, packageFeatures, packagePricesQueryKey, packageSummary } from "@/lib/prospecting/packages";
import type { PackagePrice, Role, ServicePackage } from "@/types";
import { PackagesPanel } from "./PackagesPanel";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const SEGMENTS = [
  { segment: "Pet/Veterinária", setup: [2200, 4200, 7800], monthly: [149, 249, 349], note: "Prontuários e vacinas" },
  { segment: "Restaurante", setup: [2500, 4500, 8200], monthly: [179, 279, 379], note: "Cardápio e pedidos" },
];

async function seed(): Promise<string> {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { roles: ["comercial", "financeiro"] });
  for (const pkg of SITE_PACKAGES) {
    await db.execute("INSERT INTO service_packages (id, company_id, code, name, description, features_json, sort_order, is_estimate) VALUES (?,?,?,?,?,?,?,0)", [
      `pkg-${pkg.code}`,
      companyId,
      pkg.code,
      pkg.name,
      pkg.description,
      JSON.stringify(pkg.features),
      pkg.sort_order,
    ]);
    for (const item of SEGMENTS) {
      const index = pkg.sort_order - 1;
      await db.execute(
        "INSERT INTO package_prices (id, company_id, package_id, segment, setup_price, monthly_price, feature_note, is_estimate) VALUES (?,?,?,?,?,?,?,0)",
        [`price-${pkg.code}-${item.segment}`, companyId, `pkg-${pkg.code}`, item.segment, item.setup[index], item.monthly[index], pkg.code === "basico" ? null : item.note],
      );
    }
  }
  return companyId;
}

/** Como a LeadsPage: pacotes e preços vêm de consultas; o painel invalida a de preços depois de salvar. */
function Harness({ companyId }: { companyId: string }) {
  const { data: packages } = useQuery({
    queryKey: ["service-packages", companyId],
    queryFn: () => testDb().select<ServicePackage[]>("SELECT * FROM service_packages WHERE company_id=? AND deleted_at IS NULL ORDER BY sort_order ASC", [companyId]),
  });
  const { data: prices } = useQuery({
    queryKey: packagePricesQueryKey(companyId),
    queryFn: () => testDb().select<PackagePrice[]>("SELECT * FROM package_prices WHERE company_id=? AND deleted_at IS NULL ORDER BY segment ASC", [companyId]),
  });
  if (!packages || !prices) return <p>Carregando...</p>;
  return <PackagesPanel packages={packages} prices={prices} leads={[]} />;
}

async function open(role: Role = "comercial") {
  const companyId = await seed();
  page = await renderPage(<Harness companyId={companyId} />, { companyId, role });
  await until(() => page!.container.querySelectorAll("article[data-package]").length === 3, "cards dos pacotes");
  return { companyId, page };
}

/** Último trecho de texto visível dentro do elemento. */
function lastText(element: Element): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.trim()) last = node as Text;
  return last;
}

describe("PackagesPanel", () => {
  it("três cards, nesta ordem: nome, resumo, lista curta e o preço por último, grande", async () => {
    const { page } = await open();
    const cards = [...page.container.querySelectorAll<HTMLElement>("article[data-package]")];
    expect(cards.map((card) => card.dataset.package)).toEqual(["basico", "essencial", "premium"]);

    for (const [index, card] of cards.entries()) {
      const pkg = SITE_PACKAGES[index];
      const children = [...card.children];
      // Nada entre a lista e o preço, nem depois dele.
      expect(children).toHaveLength(4);
      expect(children[0].tagName).toBe("H3");
      expect(children[0].textContent).toBe(pkg.name);
      expect(children[1].textContent).toBe(packageSummary(pkg.description));
      expect(children[2].tagName).toBe("UL");
      expect(children[2].querySelectorAll("li").length).toBe(Math.min(pkg.features.length, CARD_FEATURE_LIMIT));

      const priceBlock = children[children.length - 1];
      expect(priceBlock.hasAttribute("data-package-price")).toBe(true);
      const value = card.querySelector("[data-package-price-value]")!;
      expect(value.contains(lastText(card))).toBe(true);
      expect(value.className).toMatch(/text-\[clamp\(1\.75rem,2\.6vw,2\.5rem\)\]/);
      expect(value.className).toContain("font-bold");
      // "a partir de": a menor mensalidade e a menor implantação entre os segmentos.
      expect(plain(value.textContent)).toBe(`R$ ${Math.min(...SEGMENTS.map((item) => item.monthly[index]))}/mês`);
      expect(plain(priceBlock.textContent)).toContain(`R$ ${Math.min(...SEGMENTS.map((item) => item.setup[index])).toLocaleString("pt-BR")}`);
    }
  });

  it("comparativo: uma linha por função e exatamente 3 colunas de pacote, com ✓ ou ✕", async () => {
    const { page } = await open();
    const table = page.container.querySelector<HTMLTableElement>('table[aria-label="Comparativo dos pacotes"]')!;
    expect(table).not.toBeNull();
    const columns = [...table.querySelectorAll("thead th[data-package-column]")];
    expect(columns.map((column) => column.textContent)).toEqual(["Básico", "Essencial", "Premium"]);

    const expected = packageFeatures(SITE_PACKAGES);
    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.querySelector("th")?.textContent)).toEqual(expected.map((item) => item.feature));
    for (const [index, row] of rows.entries()) {
      const cells = [...row.querySelectorAll("td")];
      expect(cells).toHaveLength(3);
      expect(cells.map((cell) => cell.getAttribute("data-included"))).toEqual([expected[index].basico, expected[index].essencial, expected[index].premium].map(String));
      expect(cells.map((cell) => cell.textContent)).toEqual(
        [expected[index].basico, expected[index].essencial, expected[index].premium].map((included) => (included ? "Incluído" : "Não incluído")),
      );
    }
  });

  it("preços por segmento numa tabela editável; sem permissão, Editar e Adicionar ficam desativados", async () => {
    const { page } = await open("financeiro");
    const table = page.container.querySelector('[data-editable-table="leads"]')!;
    expect(table.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(2);
    expect(page.button("Editar")?.disabled).toBe(true);
    expect(page.button("Adicionar")?.disabled).toBe(true);
    expect(page.button("Atualizar")?.disabled).toBe(false);
  });

  it("editar a mensalidade na própria tabela com valor em formato brasileiro grava o número certo", async () => {
    const { page, companyId } = await open();
    await click(page.button("Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(page.container.querySelector('[aria-label="Básico mensal (linha 1)"]'), "1.234,56");
    await click(page.button("Salvar"));
    await until(() => page.text().includes("1 linha salva."), "mensagem de salvo");

    const [row] = await testDb().select<PackagePrice[]>("SELECT * FROM package_prices WHERE company_id=? AND id=?", [companyId, "price-basico-Pet/Veterinária"]);
    expect(row.monthly_price).toBe(1234.56);
    expect(row.setup_price).toBe(2200);
    // Depois de salvar a tabela recarrega: o card do Básico passa a começar na outra mensalidade.
    await until(() => plain(page.container.querySelector('article[data-package="basico"] [data-package-price-value]')?.textContent) === "R$ 179/mês", "card atualizado");
  });

  it("preço com centavos aparece com centavos no card, igual à tabela (nunca arredondado)", async () => {
    const { page } = await open();
    await click(page.button("Editar"));
    await typeInto(page.container.querySelector('[aria-label="Básico mensal (linha 1)"]'), "99,90");
    await typeInto(page.container.querySelector('[aria-label="Básico implantação (linha 1)"]'), "1.999,99");
    await click(page.button("Salvar"));
    await until(() => page.text().includes("1 linha salva."), "mensagem de salvo");

    const card = page.container.querySelector('article[data-package="basico"]')!;
    await until(() => plain(card.querySelector("[data-package-price-value]")?.textContent) === "R$ 99,90/mês", "mensalidade com centavos no card");
    expect(plain(card.querySelector("[data-package-price]")?.textContent)).toContain("R$ 1.999,99");
    // Preço inteiro continua sem centavos.
    expect(plain(page.container.querySelector('article[data-package="essencial"] [data-package-price-value]')?.textContent)).toBe("R$ 249/mês");
  });
});
