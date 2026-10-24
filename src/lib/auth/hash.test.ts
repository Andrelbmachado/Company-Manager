import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, passwordHashAlgorithm, PBKDF2_ITERATIONS, verifyPassword } from "./hash";

// O comando nativo (argon2 no Rust) é simulado: o teste confere o contrato com o Tauri, não o argon2 em si.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

describe("no navegador (sem o app desktop): PBKDF2 via WebCrypto", () => {
  it("gera pbkdf2$sha256$<iterações>$<sal>$<hash>, com sal novo a cada vez", async () => {
    const first = await hashPassword("segredo123");
    const second = await hashPassword("segredo123");
    expect(first).toMatch(/^pbkdf2\$sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(first.split("$")[2]).toBe(String(PBKDF2_ITERATIONS));
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(first).not.toBe(second);
    expect(first).not.toContain("segredo123");
    expect(passwordHashAlgorithm(first)).toBe("pbkdf2");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("confere a senha certa (sem pedir rehash) e recusa a errada", async () => {
    const stored = await hashPassword("segredo123");
    await expect(verifyPassword("segredo123", stored)).resolves.toEqual({ ok: true, needsRehash: false });
    await expect(verifyPassword("segredo124", stored)).resolves.toEqual({ ok: false, needsRehash: false });
    await expect(verifyPassword("", stored)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it("senha legada plain: confere e pede rehash; senha errada não entra", async () => {
    await expect(verifyPassword("x", "plain:x")).resolves.toEqual({ ok: true, needsRehash: true });
    await expect(verifyPassword("y", "plain:x")).resolves.toEqual({ ok: false, needsRehash: false });
    await expect(verifyPassword("", "plain:")).resolves.toEqual({ ok: false, needsRehash: false });
    expect(passwordHashAlgorithm("plain:x")).toBe("plain");
  });

  it("PBKDF2 com menos iterações que o padrão atual confere e pede rehash", async () => {
    const stored = await hashPassword("segredo123");
    const [, digest, , salt] = stored.split("$");
    // Mesmo sal, 1000 iterações: recalcula o hash fraco com WebCrypto para simular uma conta antiga.
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("segredo123"), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: 1000 }, key, 256);
    const weak = `pbkdf2$${digest}$1000$${salt}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
    await expect(verifyPassword("segredo123", weak)).resolves.toEqual({ ok: true, needsRehash: true });
    await expect(verifyPassword("outra", weak)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it("formato desconhecido ou corrompido nunca entra", async () => {
    for (const stored of ["", "segredo123", "md5$abc", "pbkdf2$sha256$abc$AAAA$AAAA", "pbkdf2$sha1$1000$AAAA$AAAA", "pbkdf2$sha256$600000$!!$AAAA"]) {
      await expect(verifyPassword("segredo123", stored), stored).resolves.toEqual({ ok: false, needsRehash: false });
    }
    expect(passwordHashAlgorithm("md5$abc")).toBe("unknown");
  });

  it("hash argon2 do app desktop não é conferido no navegador", async () => {
    await expect(verifyPassword("segredo123", "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA")).resolves.toEqual({ ok: false, needsRehash: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("recusa gerar hash de senha vazia", async () => {
    await expect(hashPassword("")).rejects.toThrow(/senha/i);
  });
});

describe("no app desktop (Tauri): argon2id pelos comandos hash_password/verify_password", () => {
  const FAKE = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdGFsZWF0b3Jpbw$";
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockImplementation(async (command: string, args: { password: string; hash?: string }) => {
      if (command === "hash_password") return `${FAKE}${btoa(args.password)}`;
      if (command === "verify_password") return args.hash === `${FAKE}${btoa(args.password)}`;
      throw new Error(`comando inesperado: ${command}`);
    });
  });

  it("hashPassword usa o comando nativo e devolve o PHC do argon2id", async () => {
    const stored = await hashPassword("segredo123");
    expect(invoke).toHaveBeenCalledWith("hash_password", { password: "segredo123" });
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(passwordHashAlgorithm(stored)).toBe("argon2id");
  });

  it("verifyPassword de argon2id usa o comando nativo e não pede rehash", async () => {
    const stored = await hashPassword("segredo123");
    await expect(verifyPassword("segredo123", stored)).resolves.toEqual({ ok: true, needsRehash: false });
    await expect(verifyPassword("errada", stored)).resolves.toEqual({ ok: false, needsRehash: false });
    expect(invoke).toHaveBeenCalledWith("verify_password", { password: "segredo123", hash: stored });
  });

  it("plain: e PBKDF2 conferem e pedem rehash para argon2id", async () => {
    await expect(verifyPassword("x", "plain:x")).resolves.toEqual({ ok: true, needsRehash: true });
    vi.unstubAllGlobals();
    const pbkdf2 = await hashPassword("segredo123");
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    await expect(verifyPassword("segredo123", pbkdf2)).resolves.toEqual({ ok: true, needsRehash: true });
  });

  it("argon2id com parâmetros abaixo do padrão pede rehash", async () => {
    invoke.mockResolvedValueOnce(true);
    await expect(verifyPassword("segredo123", "$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$aGFzaA")).resolves.toEqual({ ok: true, needsRehash: true });
    invoke.mockResolvedValueOnce(true);
    await expect(verifyPassword("segredo123", "$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA")).resolves.toEqual({ ok: true, needsRehash: true });
  });

  it("se o comando nativo falhar ao gerar o hash, cai para PBKDF2 (a conta continua protegida)", async () => {
    invoke.mockRejectedValueOnce(new Error("command hash_password not found"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stored = await hashPassword("segredo123");
    expect(passwordHashAlgorithm(stored)).toBe("pbkdf2");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("se o comando nativo falhar ao conferir, avisa em vez de dizer que a senha está errada", async () => {
    invoke.mockRejectedValueOnce(new Error("falhou"));
    await expect(verifyPassword("segredo123", `${FAKE}aGFzaA`)).rejects.toThrow(/conferir a senha/i);
  });
});
