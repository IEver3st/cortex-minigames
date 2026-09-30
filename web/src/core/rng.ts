// Seeded, versioned randomness. Every generated challenge flows through this so a seed reproduces
// the logical puzzle exactly. RNG_VERSION changes whenever the sequence for a given seed changes.

export const RNG_VERSION = 1;
export const MAX_SEED = 0x7fffffff;

export interface Rng {
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): T[];
  /** Independent child stream, so adding draws to one generator never shifts another. */
  fork(label: number): Rng;
}

function splitmix32(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const clean = Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED ? seed : 0;
  const init = splitmix32(clean ^ (RNG_VERSION << 24));
  // sfc32: small, fast, well distributed; seeded through splitmix to avoid weak low seeds.
  let a = init(), b = init(), c = init(), d = init();
  const raw = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return (out >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) raw();
  const rng: Rng = {
    seed: clean,
    next: raw,
    range: (min, max) => min + raw() * (max - min),
    int: (min, max) => min + Math.floor(raw() * (max - min + 1)),
    pick: (items) => items[Math.floor(raw() * items.length)],
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(raw() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
    fork: (label) => createRng((Math.imul(clean ^ 0x5bd1e995, 31) + label * 0x27d4eb2d) & MAX_SEED),
  };
  return rng;
}

export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] & MAX_SEED;
}
