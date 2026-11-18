// Bibliothèque d'objets de décor, pour composer des cartes sans tout réécrire à la main.
//
// Chaque objet est une simple donnée { kind, x, z, ... } :
//   - « boîte »   : w (largeur en X), d (profondeur en Z), h (hauteur)   -> map.boxes
//   - « disque »  : r (rayon), h                                          -> map.circles
//   - « à plat »  : flat: true, purement visuel, ne bloque rien          -> map.flats
// La hauteur h compte : un obus vole à ~1,5 m, donc un obstacle plus bas (pipeline, eau,
// hérisson) arrête les chars mais laisse passer les tirs.
//
// `layout([...])` range une liste d'objets (et de groupes d'objets) dans { boxes, circles, flats }.
// Le rendu de chaque `kind` est dans client/src/models/map.js, la mini-carte dans client/src/hud.js.

const PI = Math.PI;

// ------------------------------------------------------------------ objets simples
// boîtes
export const bld = (x, z, w, d, h = 6) => ({ kind: 'building', x, z, w, d, h });
export const wall = (x, z, w, d, h = 2.6) => ({ kind: 'wall', x, z, w, d, h });
export const crate = (x, z, w = 3, d = 3, h = 3) => ({ kind: 'crate', x, z, w, d, h });
export const bunker = (x, z, w = 8, d = 4, h = 2.4) => ({ kind: 'bunker', x, z, w, d, h }); // béton, meurtrière
export const ruin = (x, z, w, d, h = 3) => ({ kind: 'ruin', x, z, w, d, h }); // mur de grès effondré
export const mesa = (x, z, w, d, h = 11) => ({ kind: 'mesa', x, z, w, d, h }); // plateau rocheux en strates
export const derrick = (x, z) => ({ kind: 'derrick', x, z, w: 4.4, d: 4.4, h: 14 }); // derrick pétrolier
export const water = (x, z, w, d) => ({ kind: 'water', x, z, w, d, h: 0.2 }); // les obus passent au-dessus
// disques
export const rock = (x, z, r = 2.5) => ({ kind: 'rock', x, z, r, h: r * 1.3 });
export const tree = (x, z) => ({ kind: 'tree', x, z, r: 0.6, h: 6 }); // seul le tronc bloque
export const dune = (x, z, r = 7) => ({ kind: 'dune', x, z, r, h: 2.8 });
export const palm = (x, z) => ({ kind: 'palm', x, z, r: 0.5, h: 6 });
export const column = (x, z, h = 5.5) => ({ kind: 'column', x, z, r: 0.95, h }); // colonne antique
export const hedgehog = (x, z) => ({ kind: 'hedgehog', x, z, r: 1.1, h: 1.1 }); // hérisson antichar, bas
export const pond = (x, z, r = 5) => ({ kind: 'water', x, z, r, h: 0.2 });
// à plat (visuel)
export const road = (x, z, w, d) => ({ kind: 'road', flat: true, x, z, w, d });
export const bush = (x, z, w, d) => ({ kind: 'bush', flat: true, x, z, w, d }); // buisson : sans collision, cache les chars qui y entrent
export const bridge = (x, z, w, d, axis = 'x') => ({ kind: 'bridge', flat: true, x, z, w, d, axis }); // axis : sens du tablier

// ------------------------------------------------------------------ groupes d'objets

// Symétrie centrale : chaque objet est dupliqué en (-x, -z). Une carte d'escarmouche reste équitable.
export function mirror(list) {
  return list.flat(Infinity).flatMap((o) => [o, { ...o, x: -o.x, z: -o.z }]);
}

// Symétrie nord-sud : chaque objet est dupliqué en (x, -z). Pour les cartes en portrait à relief.
export function mirrorZ(list) {
  return list.flat(Infinity).flatMap((o) => [o, { ...o, z: -o.z }]);
}

// Pipeline posé sur des supports le long de Z (axis 'z') ou de X, de `a` à `b`, avec des brèches.
// gaps = [[début, fin], ...] le long de l'axe.
export function pipeline(at, a, b, gaps = [], axis = 'z') {
  const cuts = [a, ...gaps.flat(), b];
  const out = [];
  for (let i = 0; i < cuts.length; i += 2) {
    const [s, e] = [cuts[i], cuts[i + 1]];
    if (e - s < 1) continue;
    const mid = (s + e) / 2, len = e - s;
    out.push(axis === 'z'
      ? { kind: 'pipe', axis, x: at, z: mid, w: 1.4, d: len, h: 1.2 }
      : { kind: 'pipe', axis, x: mid, z: at, w: len, d: 1.4, h: 1.2 });
  }
  return out;
}

// Rivière droite le long de Z, centrée en x, de largeur `width`, coupée par des ponts.
// bridges = [{ z, w }] (w = largeur du passage). Bloque les chars, pas les obus.
export function river(x, width, from, to, bridges = []) {
  const sorted = [...bridges].sort((p, q) => p.z - q.z);
  const out = [];
  let s = from;
  for (const b of sorted) {
    if (b.z - b.w / 2 > s) out.push(water(x, (s + b.z - b.w / 2) / 2, width, b.z - b.w / 2 - s));
    out.push(bridge(x, b.z, width + 3, b.w, 'x'));
    s = b.z + b.w / 2;
  }
  if (to > s) out.push(water(x, (s + to) / 2, width, to - s));
  return out;
}

// Bosquet : `n` arbres (ou palmiers) tirés au hasard (mais toujours pareil) dans un disque.
export function grove(cx, cz, radius, n, seed, make = tree) {
  const rand = rng(seed);
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const a = rand() * PI * 2, d = Math.sqrt(rand()) * radius;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 5)) continue; // un char doit pouvoir s'y faufiler
    out.push(make(Math.round(x * 10) / 10, Math.round(z * 10) / 10));
  }
  return out;
}

// Arc de colonnes autour d'un point, de l'angle a0 à a1 (radians, 0 = +X).
export function colonnade(cx, cz, radius, a0, a1, n, h = 5.5) {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / Math.max(1, n - 1);
    return column(Math.round((cx + Math.cos(a) * radius) * 10) / 10, Math.round((cz + Math.sin(a) * radius) * 10) / 10, h - (i % 3 === 1 ? 2 : 0));
  });
}

// Ligne de hérissons antichars entre deux points, espacés de `gap` mètres.
export function hedgeLine(x0, z0, x1, z1, gap = 4) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / gap));
  return Array.from({ length: n + 1 }, (_, i) => hedgehog(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n));
}

// Hameau : une maison principale, une annexe et un muret de cour.
export function hamlet(x, z, sx = 1, sz = 1) {
  return [bld(x, z, 10, 8, 5), bld(x + 9 * sx, z + 7 * sz, 6, 6, 4), wall(x - 7 * sx, z + 6 * sz, 2, 8)];
}

// ------------------------------------------------------------------ mise en forme

// Range des objets dans les trois listes d'une carte.
export function layout(...lists) {
  const out = { boxes: [], circles: [], flats: [] };
  for (const o of lists.flat(Infinity)) {
    if (o.flat) out.flats.push(o);
    else if (o.r !== undefined) out.circles.push(o);
    else out.boxes.push(o);
  }
  return out;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
