// @vitest-environment jsdom
// O cadastro das pastas de nuvem também roda no banco demo do navegador, que não aplica o UNIQUE da pasta por empresa:
// a duplicata tem de ser barrada no TypeScript.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { connectCloudFolder, disconnectCloudFolder, listCloudFolders, updateCloudFolder } from "./cloudFolders";

const C = DEMO_COMPANY_ID;
const CEO = { role: "ceo" as const, userId: "demo-ceo" };
const ICLOUD = "/Users/ana/Library/Mobile Documents/com~apple~CloudDocs";

beforeEach(() => localStorage.clear());

describe("pastas de nuvem no banco demo", () => {
  it("conecta, barra a duplicata, renomeia e desconecta", async () => {
    const db = createDemoDb();
    const folder = await connectCloudFolder(db, C, CEO, { localPath: ICLOUD, home: "/Users/ana" });
    expect(folder).toMatchObject({ provider: "icloud", label: "iCloud Drive" });
    await expect(connectCloudFolder(db, C, CEO, { localPath: `${ICLOUD}/`, home: "/Users/ana" })).rejects.toThrow(/já está conectada/);

    await updateCloudFolder(db, C, CEO, folder.id, { label: "Empresa" });
    const reopened = createDemoDb();
    expect((await listCloudFolders(reopened, C)).map((row) => [row.id, row.label])).toEqual([[folder.id, "Empresa"]]);

    await disconnectCloudFolder(reopened, C, CEO, folder.id);
    expect(await listCloudFolders(createDemoDb(), C)).toEqual([]);
  });
});
