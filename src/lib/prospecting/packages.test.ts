// Pacotes e preços: comparativo de funções (✓/✕) derivado dos pacotes, resumo/preço dos cards e gravação da tabela de
// preços por segmento (SQLite real).
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { can } from "@/lib/permissions/rbac";
import type { PackagePrice, ServicePackage } from "@/types";
import { SITE_PACKAGES } from "./data/siteProspecting.generated";
import {
  formatPackagePrice,
  PACKAGE_CODES,
  packageFeatures,
  packageSummary,
  saveSegmentPrices,
  segmentPriceKey,
  segmentPriceRows,
  startingPrices,
} from "./packages";

const own = (code: string) => SITE_PACKAGES.find((pkg) => pkg.code === code)!.features.filter((feature) => !/^Tudo d/i.test(feature));

describe("packageFeatures", () => {
  const rows = packageFeatures(SITE_PACKAGES);
  const row = (feature: string) => rows.find((item) => item.feature === feature);

  it("uma linha por função, sem repetir e sem as linhas \"Tudo do ...\"", () => {
    const expected = [...own("basico"), ...own("essencial"), ...own("premium")];
    expect(rows.map((item) => item.feature)).toEqual(expected);
    expect(new Set(rows.map((item) => item.feature)).size).toBe(rows.length);
    expect(rows.some((item) => /^Tudo d/i.test(item.feature))).toBe(false);
  });

  it("as funções do Básico estão no Básico e no Premium (\"Tudo do Básico\"), não no Essencial", () => {
    for (const feature of own("basico")) expect(row(feature), feature).toEqual({ feature, basico: true, essencial: false, premium: true });
  });

  it("as funções do Essencial estão no Essencial e no Premium, não no Básico", () => {
    for (const feature of own("essencial")) expect(row(feature), feature).toEqual({ feature, basico: false, essencial: true, premium: true });
  });

  it("as funções só do Premium aparecem só nele", () => {
    expect(own("premium").length).toBeGreaterThan(0);
    for (const feature of own("premium")) expect(row(feature), feature).toEqual({ feature, basico: false, essencial: false, premium: true });
  });

  it("aceita as linhas de service_packages (features_json) e dá o mesmo resultado", () => {
    const fromDb = SITE_PACKAGES.map((pkg) => ({ code: pkg.code, name: pkg.name, features_json: JSON.stringify(pkg.features) }));
    expect(packageFeatures(fromDb)).toEqual(rows);
  });

  it("features_json inválido vira lista vazia, \"Tudo do\" de pacote que não existe fica como função comum e pacote fora dos três é ignorado", () => {
    const result = packageFeatures([
      { code: "basico", name: "Básico", features_json: "{quebrado" },
      { code: "essencial", name: "Essencial", features_json: JSON.stringify(["Painel", "Tudo do Ouro"]) },
      { code: "premium", name: "Premium", features_json: JSON.stringify(["Tudo do essencial", "SEO"]) },
      { code: "extra", name: "Extra", features_json: JSON.stringify(["Função avulsa"]) },
    ]);
    expect(result).toEqual([
      { feature: "Painel", basico: false, essencial: true, premium: true },
      { feature: "Tudo do Ouro", basico: false, essencial: true, premium: true },
      { feature: "SEO", basico: false, essencial: false, premium: true },
    ]);
  });

  it("tem exatamente as três colunas de pacote", () => {
    expect(PACKAGE_CODES).toEqual(["basico", "essencial", "premium"]);
    for (const item of rows) expect(Object.keys(item).sort()).toEqual(["basico", "essencial", "feature", "premium"]);
  });
});

describe("packageSummary", () => {
  it("é a primeira frase da descrição", () => {
    expect(packageSummary("Só o gerenciador: painel com login. Sem vitrine pública. Mensalidade com fidelidade.")).toBe("Só o gerenciador: painel com login.");
    expect(packageSummary("Vitrine e gerenciador juntos")).toBe("Vitrine e gerenciador juntos");
    expect(packageSummary(null)).toBe("");
    expect(packageSummary("  ")).toBe("");
    expect(packageSummary("Implantação de R$ 1.600 a R$ 12.000. Depois, mensalidade.")).toBe("Implantação de R$ 1.600 a R$ 12.000.");
    expect(packageSummary("Pronto! Em 30 dias? Sim.")).toBe("Pronto!");
    expect(packageSummary("Primeira linha.\nSegunda linha.")).toBe("Primeira linha.");
  });
});

describe("formatPackagePrice", () => {
  const text = (value: number) => formatPackagePrice(value).replace(/\u00a0/g, " ");

  it("sem centavos quando o valor é inteiro, com os centavos quando tem (nunca arredonda o preço)", () => {
    expect(text(149)).toBe("R$ 149");
    expect(text(1600)).toBe("R$ 1.600");
    expect(text(149.9)).toBe("R$ 149,90");
    expect(text(1234.567)).toBe("R$ 1.234,57");
    expect(text(0.1 + 0.2)).toBe("R$ 0,30");
  });
});

const price = (packageId: string, segment: string, setup: number, monthly: number, note: string | null = null): PackagePrice => ({
  id: `${packageId}-${segment}`,
  company_id: "c",
  package_id: packageId,
  segment,
  setup_price: setup,
  monthly_price: monthly,
  feature_note: note,
  is_estimate: 0,
  created_at: "",
  updated_at: "",
});

describe("startingPrices e segmentPriceRows", () => {
  const packages = [
    { id: "p-b", code: "basico", name: "Básico" },
    { id: "p-e", code: "essencial", name: "Essencial" },
  ];
  const prices = [price("p-b", "Restaurante", 2500, 179), price("p-b", "Pet", 2200, 149), price("p-e", "Pet", 4200, 249, "Prontuários")];

  it("o menor preço de implantação e de mensalidade do pacote; sem preço, null", () => {
    expect(startingPrices(prices, "p-b")).toEqual({ setup: 2200, monthly: 149 });
    expect(startingPrices(prices, "p-x")).toBeNull();
  });

  it("uma linha por segmento, em ordem alfabética, com os preços de cada pacote, o escopo e quantos leads usam o segmento", () => {
    const leads = [
      { pricing_segment: "Pet", category: "Veterinária" },
      { pricing_segment: null, category: "Pet" },
      { pricing_segment: "Restaurante", category: null },
    ];
    expect(segmentPriceRows(packages, prices, leads)).toEqual([
      { id: "Pet", segment: "Pet", leads: 2, basico_setup: 2200, basico_monthly: 149, essencial_setup: 4200, essencial_monthly: 249, feature_note: "Prontuários" },
      { id: "Restaurante", segment: "Restaurante", leads: 1, basico_setup: 2500, basico_monthly: 179, essencial_setup: null, essencial_monthly: null, feature_note: null },
    ]);
    expect(segmentPriceKey("premium", "monthly")).toBe("premium_monthly");
  });
});

describe("saveSegmentPrices (SQLite real)", () => {
  let db: TestDb;
  let companyId: string;
  const ids: Record<string, string> = {};

  async function insertPrice(code: string, segment: string, setup: number, monthly: number, note: string | null = null) {
    await db.execute(
      "INSERT INTO package_prices (id, company_id, package_id, segment, setup_price, monthly_price, feature_note, is_estimate) VALUES (?,?,?,?,?,?,?,0)",
      [`${code}-${segment}`, companyId, ids[code], segment, setup, monthly, note],
    );
  }

  const prices = () => db.select<PackagePrice[]>("SELECT * FROM package_prices WHERE company_id=? AND deleted_at IS NULL ORDER BY segment, package_id", [companyId]);
  const bySegment = async (segment: string) => {
    const rows = (await prices()).filter((row) => row.segment === segment);
    return Object.fromEntries(rows.map((row) => [Object.keys(ids).find((code) => ids[code] === row.package_id)!, row]));
  };
  const actor = { role: "comercial" as const };

  beforeEach(async () => {
    db = await createTestDb();
    ({ companyId } = await insertTestCompany(db, { roles: ["comercial", "financeiro"] }));
    for (const pkg of SITE_PACKAGES) {
      ids[pkg.code] = `pkg-${pkg.code}`;
      await db.execute("INSERT INTO service_packages (id, company_id, code, name, description, features_json, sort_order, is_estimate) VALUES (?,?,?,?,?,?,?,0)", [
        ids[pkg.code],
        companyId,
        pkg.code,
        pkg.name,
        pkg.description,
        JSON.stringify(pkg.features),
        pkg.sort_order,
      ]);
    }
    await insertPrice("basico", "Pet", 2200, 149);
    await insertPrice("essencial", "Pet", 4200, 249, "Prontuários");
    await insertPrice("premium", "Pet", 7800, 349, "Prontuários");
    await insertPrice("basico", "Buffet", 2000, 129);
    await db.execute("INSERT INTO leads (id, company_id, name, pricing_segment) VALUES (?,?,?,?)", ["lead-1", companyId, "Pet Feliz", "Pet"]);
  });

  it("atualiza só o preço alterado (valor arredondado em centavos)", async () => {
    const result = await saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Pet", basico_monthly: 1234.567 }], created: [] });
    expect(result).toEqual({ inserted: 0, updated: 1 });
    const pet = await bySegment("Pet");
    expect(pet.basico).toMatchObject({ setup_price: 2200, monthly_price: 1234.57 });
    expect(pet.essencial).toMatchObject({ setup_price: 4200, monthly_price: 249, feature_note: "Prontuários" });
    expect(pet.premium).toMatchObject({ setup_price: 7800, monthly_price: 349 });
  });

  it("o escopo do gerenciador vai para o Essencial e o Premium, nunca para o Básico", async () => {
    await saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Pet", feature_note: "Agenda e vacinas" }], created: [] });
    const pet = await bySegment("Pet");
    expect(pet.basico.feature_note).toBeNull();
    expect(pet.essencial.feature_note).toBe("Agenda e vacinas");
    expect(pet.premium.feature_note).toBe("Agenda e vacinas");
  });

  it("preço que faltava num segmento é criado quando vêm implantação e mensalidade; só um dos dois é erro", async () => {
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Buffet", essencial_setup: 3000 }], created: [] })).rejects.toThrow(/Essencial/);
    expect(await bySegment("Buffet")).not.toHaveProperty("essencial");

    const result = await saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Buffet", essencial_setup: 3000, essencial_monthly: 199 }], created: [] });
    expect(result).toEqual({ inserted: 1, updated: 0 });
    expect((await bySegment("Buffet")).essencial).toMatchObject({ setup_price: 3000, monthly_price: 199, is_estimate: 0 });
  });

  it("Adicionar cria o segmento com um preço por pacote", async () => {
    const created = {
      segment: "  Academia ",
      basico_setup: 1800,
      basico_monthly: 139,
      essencial_setup: 3900,
      essencial_monthly: 239,
      premium_setup: 6900,
      premium_monthly: 329,
      feature_note: "Alunos e treinos",
    };
    expect(await saveSegmentPrices(db, companyId, actor, { updated: [], created: [created] })).toEqual({ inserted: 3, updated: 0 });
    const academia = await bySegment("Academia");
    expect(academia.basico).toMatchObject({ setup_price: 1800, monthly_price: 139, feature_note: null, is_estimate: 0 });
    expect(academia.essencial).toMatchObject({ setup_price: 3900, monthly_price: 239, feature_note: "Alunos e treinos" });
    expect(academia.premium).toMatchObject({ setup_price: 6900, monthly_price: 329, feature_note: "Alunos e treinos" });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("segmento novo sem todos os preços, com nome vazio ou repetido (sem diferenciar maiúsculas) não grava nada", async () => {
    const full = { basico_setup: 1, basico_monthly: 1, essencial_setup: 1, essencial_monthly: 1, premium_setup: 1, premium_monthly: 1 };
    const before = await prices();
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [], created: [{ ...full, segment: "pet" }] })).rejects.toThrow(/Já existe/);
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [], created: [{ ...full, segment: " " }] })).rejects.toThrow(/nome do segmento/);
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [], created: [{ ...full, premium_monthly: null, segment: "Academia" }] })).rejects.toThrow(/Premium/);
    await expect(
      saveSegmentPrices(db, companyId, actor, { updated: [], created: [{ ...full, segment: "Academia" }, { ...full, segment: "academia" }] }),
    ).rejects.toThrow(/Já existe/);
    expect(await prices()).toEqual(before);
  });

  it("preço negativo ou inválido é recusado e nada é gravado", async () => {
    const before = await prices();
    await expect(
      saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Buffet", basico_setup: 999 }, { id: "Pet", basico_setup: -1 }], created: [] }),
    ).rejects.toThrow(/negativa/);
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Pet", basico_monthly: Number.NaN }], created: [] })).rejects.toThrow(/inválido/);
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Pet", basico_monthly: null }], created: [] })).rejects.toThrow(/Informe/);
    expect(await prices()).toEqual(before);
  });

  it("renomeia segmento que nenhum lead usa; segmento usado por lead não troca de nome", async () => {
    await saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Buffet", segment: "Buffet infantil" }], created: [] });
    expect(await bySegment("Buffet")).toEqual({});
    expect((await bySegment("Buffet infantil")).basico).toMatchObject({ setup_price: 2000, monthly_price: 129 });

    await expect(saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Pet", segment: "Pet shop" }], created: [] })).rejects.toThrow(/lead/);
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Buffet infantil", segment: "PET" }], created: [] })).rejects.toThrow(/Já existe/);
    expect(Object.keys(await bySegment("Pet")).sort()).toEqual(["basico", "essencial", "premium"]);
  });

  it("segmento que sumiu (outra pessoa mudou) pede para atualizar", async () => {
    await expect(saveSegmentPrices(db, companyId, actor, { updated: [{ id: "Hotel", basico_setup: 1 }], created: [] })).rejects.toThrow(/Atualizar/);
  });

  it("papel sem permissão de editar ou adicionar leads é barrado na camada de dados", async () => {
    expect(can("financeiro", "edit", "leads")).toBe(false);
    expect(can("financeiro", "create", "leads")).toBe(false);
    const before = await prices();
    await expect(saveSegmentPrices(db, companyId, { role: "financeiro" }, { updated: [{ id: "Pet", basico_setup: 1 }], created: [] })).rejects.toThrow(/permissão/);
    await expect(
      saveSegmentPrices(db, companyId, { role: "financeiro" }, { updated: [], created: [{ segment: "Academia", basico_setup: 1, basico_monthly: 1 }] }),
    ).rejects.toThrow(/permissão/);
    expect(await prices()).toEqual(before);
  });

  it("os tipos do banco servem de entrada (ServicePackage)", async () => {
    const packages = await db.select<ServicePackage[]>("SELECT * FROM service_packages WHERE company_id=? ORDER BY sort_order", [companyId]);
    expect(packageFeatures(packages)).toEqual(packageFeatures(SITE_PACKAGES));
    expect(segmentPriceRows(packages, await prices(), []).map((row) => row.segment)).toEqual(["Buffet", "Pet"]);
  });
});
