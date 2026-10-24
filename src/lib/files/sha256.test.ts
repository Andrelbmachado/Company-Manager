import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, sha256Sync } from "./sha256";

const nodeSha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("sha256", () => {
  it("vetores conhecidos", async () => {
    expect(sha256Sync(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Sync(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("a versão em JS bate com o crypto do Node em tamanhos de borda do bloco (55, 56, 63, 64, 65...)", async () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256Sync(bytes), `tamanho ${length}`).toBe(nodeSha(bytes));
      expect(await sha256Hex(bytes), `tamanho ${length}`).toBe(nodeSha(bytes));
    }
  });

  it("view parcial de um buffer maior usa só os bytes da view", async () => {
    const buffer = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = buffer.subarray(2, 5);
    expect(await sha256Hex(view)).toBe(nodeSha(new Uint8Array([1, 2, 3])));
  });
});
