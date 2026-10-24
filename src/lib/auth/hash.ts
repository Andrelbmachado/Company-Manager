// Hash de senha. No app desktop: argon2id pelos comandos Rust `hash_password`/`verify_password` (src-tauri/src/lib.rs),
// no formato PHC ("$argon2id$v=19$m=...,t=...,p=...$sal$hash"). No navegador (banco demo) não há Rust: PBKDF2-SHA256
// via WebCrypto ("pbkdf2$sha256$<iterações>$<sal>$<hash>", base64). O formato vem no próprio texto guardado em
// users.password_hash, então contas antigas ("plain:<senha>") e hashes fracos são reconhecidos e trocados no login.
import { invoke } from "@tauri-apps/api/core";

export type PasswordHashAlgorithm = "argon2id" | "argon2" | "pbkdf2" | "plain" | "unknown";

export interface PasswordCheck {
  ok: boolean;
  /** Senha certa, mas guardada num formato que não é mais o padrão: o login regrava com hashPassword(). */
  needsRehash: boolean;
}

/** OWASP (2023) para PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BITS = 256;
/** Padrão do crate argon2 (Argon2id, m=19 MiB, t=2, p=1), o mínimo recomendado pela OWASP. */
const ARGON2_MIN = { m: 19_456, t: 2, p: 1 };

const DENIED: PasswordCheck = { ok: false, needsRehash: false };

/** Mesma checagem de lib/db/client.ts, sem importar o cliente do banco (o hash não depende dele). */
function hasNativeHasher(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function passwordHashAlgorithm(stored: string): PasswordHashAlgorithm {
  if (stored.startsWith("$argon2id$")) return "argon2id";
  if (stored.startsWith("$argon2")) return "argon2";
  if (stored.startsWith("pbkdf2$")) return "pbkdf2";
  if (stored.startsWith("plain:")) return "plain";
  return "unknown";
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Informe uma senha.");
  if (hasNativeHasher()) {
    try {
      return await invoke<string>("hash_password", { password });
    } catch (error) {
      // PBKDF2 também protege a senha; no próximo login o rehash tenta o argon2 de novo.
      console.warn("[auth] argon2 indisponível, usando PBKDF2", error);
    }
  }
  return pbkdf2Hash(password);
}

export async function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
  if (!password || !stored) return DENIED;
  switch (passwordHashAlgorithm(stored)) {
    case "plain": {
      const ok = constantTimeEqual(new TextEncoder().encode(stored.slice("plain:".length)), new TextEncoder().encode(password));
      return { ok, needsRehash: ok };
    }
    case "pbkdf2": {
      const parsed = parsePbkdf2(stored);
      if (!parsed) return DENIED;
      const ok = constantTimeEqual(await pbkdf2(password, parsed.salt, parsed.iterations, parsed.hash.length * 8), parsed.hash);
      return { ok, needsRehash: ok && (hasNativeHasher() || parsed.iterations < PBKDF2_ITERATIONS) };
    }
    case "argon2id":
    case "argon2": {
      // Sem o Rust (navegador) não há como conferir argon2; só acontece com um banco copiado do desktop.
      if (!hasNativeHasher()) return DENIED;
      let ok: boolean;
      try {
        ok = await invoke<boolean>("verify_password", { password, hash: stored });
      } catch (error) {
        throw new Error(`Não foi possível conferir a senha agora (${error instanceof Error ? error.message : String(error)}). Tente de novo.`);
      }
      return { ok, needsRehash: ok && argon2IsWeak(stored) };
    }
    default:
      return DENIED;
  }
}

function argon2IsWeak(stored: string): boolean {
  if (passwordHashAlgorithm(stored) !== "argon2id") return true;
  const params = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!params) return true;
  const [m, t, p] = params.slice(1).map(Number);
  return m < ARGON2_MIN.m || t < ARGON2_MIN.t || p < ARGON2_MIN.p;
}

async function pbkdf2Hash(password: string): Promise<string> {
  const salt = webCrypto().getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BITS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

type Bytes = Uint8Array<ArrayBuffer>;

async function pbkdf2(password: string, salt: Bytes, iterations: number, bits: number): Promise<Uint8Array> {
  const subtle = webCrypto().subtle;
  const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, bits));
}

function parsePbkdf2(stored: string): { iterations: number; salt: Bytes; hash: Bytes } | null {
  const [, digest, rounds, salt, hash, ...rest] = stored.split("$");
  if (digest !== "sha256" || rest.length || !/^\d+$/.test(rounds ?? "")) return null;
  const iterations = Number(rounds);
  const saltBytes = fromBase64(salt);
  const hashBytes = fromBase64(hash);
  if (!iterations || !saltBytes?.length || !hashBytes?.length) return null;
  return { iterations, salt: saltBytes, hash: hashBytes };
}

function webCrypto(): Crypto {
  // http fora de localhost não é "contexto seguro": o navegador esconde o crypto.subtle.
  if (!globalThis.crypto?.subtle) throw new Error("Este navegador não oferece criptografia segura (WebCrypto). Abra pelo app desktop ou por http://localhost.");
  return globalThis.crypto;
}

/** Compara sem sair no primeiro byte diferente (não vaza, pelo tempo, quanto do hash bateu). */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string | undefined): Bytes | null {
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
