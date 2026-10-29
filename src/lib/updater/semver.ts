// Comparação de versões no Semantic Versioning 2.0 (precedência da seção 11): núcleo numérico, depois pre-release
// (versão sem pre-release é maior; identificadores numéricos comparam como número e ficam abaixo dos alfanuméricos).
// Metadados de build (+...) não contam. O Rust (tauri-plugin-updater) já recusa versões iguais ou menores; isto é a
// segunda trava no front-end, antes de habilitar o botão "Atualizar".

interface Parsed {
  core: [number, number, number];
  pre: string[];
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-.]+)?$/;

export function parseSemver(version: string): Parsed | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split(".") : [] };
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1, 0 ou 1. Lança erro se uma das versões não for semver válido. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) throw new Error(`Versão inválida: ${!left ? a : b}`);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const result = compareIdentifiers(left.pre[i], right.pre[i]);
    if (result) return result;
  }
  return Math.sign(left.pre.length - right.pre.length);
}

/** `candidate` é estritamente mais nova que `current`. Versão inválida conta como não mais nova. */
export function isNewerVersion(candidate: string, current: string): boolean {
  try {
    return compareSemver(candidate, current) > 0;
  } catch {
    return false;
  }
}
