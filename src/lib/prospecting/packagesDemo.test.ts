// @vitest-environment jsdom
// A gravação da tabela de preços por segmento também roda no banco demo do navegador (SQL só nos padrões do demo).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import type { PackagePrice, ServicePackage } from "@/types";
import { SITE_PACKAGES } from "./data/siteProspecting.generated";
import { packageFeatures, saveSegmentPrices, segmentPriceRows } from "./packages";

const C = DEMO_COMPANY_ID;

beforeEach(() => localStorage.clear());

async function seed() {
  const db = createDemoDb();
  for (const pkg of SITE_PACKAGES) {
    await db.execute("INSERT INTO service_packages (id, company_id, code, name, description, features_json, sort_order, is_estimate) VALUES (?,?,?,?,?,?,?,?)", [
      `pkg-${pkg.code}`,
      C,
      pkg.code,
      pkg.name,
      pkg.description,
      JSON.stringify(pkg.features),
      pkg.sort_order,
      0,
    ]);
    await db.execute("INSERT INTO package_prices (id, company_id, package_id, segment, setup_price, monthly_price, feature_note, is_estimate) VALUES (?,?,?,?,?,?,?,?)", [
      `price-${pkg.code}-pet`,
      C,
      `pkg-${pkg.code}`,
      "Pet",
      1000 * pkg.sort_order,
      100 * pkg.sort_order,
      pkg.code === "basico" ? null : "Prontuários",
      0,
    ]);
  }
  return db;
}

describe("preços por segmento no banco demo", () => {
  it("edita, adiciona e renomeia sem SQL fora dos padrões", async () => {
    const db = await seed();
    const actor = { role: "comercial" as const };
    await saveSegmentPrices(db, C, actor, { updated: [{ id: "Pet", premium_monthly: 399, feature_note: "Agenda" }], created: [] });
    await saveSegmentPrices(db, C, actor, {
      updated: [],
      created: [{ segment: "Academia", basico_setup: 1, basico_monthly: 2, essencial_setup: 3, essencial_monthly: 4, premium_setup: 5, premium_monthly: 6 }],
    });
    await saveSegmentPrices(db, C, actor, { updated: [{ id: "Academia", segment: "Academia de bairro" }], created: [] });

    const packages = await db.select<ServicePackage[]>("SELECT * FROM service_packages WHERE company_id=? AND deleted_at IS NULL ORDER BY sort_order ASC", [C]);
    const prices = await db.select<PackagePrice[]>("SELECT * FROM package_prices WHERE company_id=? AND deleted_at IS NULL", [C]);
    const leads = await db.select<{ pricing_segment: string | null; category: string | null }[]>("SELECT * FROM leads WHERE company_id=? AND deleted_at IS NULL", [C]);
    expect(segmentPriceRows(packages, prices, leads)).toEqual([
      expect.objectContaining({ segment: "Academia de bairro", basico_setup: 1, premium_monthly: 6, feature_note: null }),
      expect.objectContaining({ segment: "Pet", basico_monthly: 100, premium_monthly: 399, feature_note: "Agenda" }),
    ]);
    expect(prices.find((price) => price.package_id === "pkg-basico" && price.segment === "Pet")?.feature_note).toBeNull();
    expect(packageFeatures(packages)).toEqual(packageFeatures(SITE_PACKAGES));
  });
});
