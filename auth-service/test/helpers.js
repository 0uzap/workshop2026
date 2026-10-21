// Vecteurs biométriques synthétiques pour les tests

// Générateur pseudo-aléatoire déterministe (mulberry32)
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
};

const normalize = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

// Vecteurs de graines différentes : quasi orthogonaux (personnes différentes)
const unitVector = (seed) => {
  const rand = prng(seed);
  return normalize(Array.from({ length: 128 }, rand));
};

// Variante bruitée d'un vecteur (même personne, autre capture)
const jitter = (v, amount, seed) => {
  const noise = unitVector(1000 + seed);
  return normalize(v.map((x, i) => x + amount * noise[i]));
};

module.exports = { unitVector, jitter };
