// Deterministic pseudo-random numbers (mulberry32), so the demo data is identical on every machine and every run.
export function createRandom(seed = 20261104) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => Math.floor(next() * (max - min + 1)) + min;
  const pick = (list) => list[Math.floor(next() * list.length)];
  const chance = (p) => next() < p;
  /** entries: [[value, weight], ...] */
  const weighted = (entries) => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  };
  const shuffle = (list) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const sample = (list, count) => shuffle(list).slice(0, count);
  /** A short code drawn from an alphabet, for ids that must look random but be the same on every run. */
  const code = (alphabet, length) => Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
  return { next, int, pick, chance, weighted, shuffle, sample, code };
}
