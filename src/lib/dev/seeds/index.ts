// TEMPORÁRIO (login rápido de desenvolvimento): seeds de área. Cada arquivo src/lib/dev/seeds/<area>.ts exporta
// `export async function seed(companyId: string): Promise<void>` e é descoberto sozinho (nenhum arquivo compartilhado
// precisa mudar). Regras: ids fixos "dev-<area>-...", INSERT OR IGNORE, flag própria em settings (seedUtils.ts), SQL que
// o banco demo entende e nunca leads. Rodam em ordem alfabética, depois do seed principal (devSeed.ts).

export type AreaSeedFn = (companyId: string) => Promise<void>;

export interface AreaSeed {
  name: string;
  seed: AreaSeedFn;
}

export interface AreaSeedResult {
  name: string;
  ok: boolean;
  error?: string;
}

const modules = import.meta.glob<{ seed?: AreaSeedFn }>(["./*.ts", "!./index.ts", "!./*.test.ts"], { eager: true });

export const areaSeeds: AreaSeed[] = Object.entries(modules)
  .flatMap(([file, module]) => (typeof module.seed === "function" ? [{ name: file.replace(/^\.\//, "").replace(/\.ts$/, ""), seed: module.seed }] : []))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** Roda todos os seeds de área; um que falha não impede os outros (o erro volta no resultado e no console). */
export async function runAreaSeeds(companyId: string): Promise<AreaSeedResult[]> {
  const results: AreaSeedResult[] = [];
  for (const { name, seed } of areaSeeds) {
    try {
      await seed(companyId);
      results.push({ name, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dev seed] ${name}: ${message}`);
      results.push({ name, ok: false, error: message || "erro desconhecido" });
    }
  }
  return results;
}
