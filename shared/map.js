// Définition des cartes + fonctions de collision.
// Une carte est une simple donnée : pour en ajouter une, créer un autre objet du même
// format et l'inscrire dans MAPS (en bas de la liste). Le salon la proposera tout seul.
// Les cartes plus riches (shared/maps/*.js) sont composées avec la bibliothèque shared/props.js.
// Repère : sol dans le plan XZ, Y vers le haut. Les obstacles sont des boîtes alignées
// sur les axes (boxes) ou des cylindres (circles), chacun avec une hauteur h.

import { OASIS } from './maps/oasis.js';
import { RIVES } from './maps/rives.js';
import { COLLINE } from './maps/colline.js';

// Symétrie centrale : chaque obstacle est dupliqué en (-x, -z) pour une carte équitable.
function mirror(list) {
  return list.flatMap((o) => [o, { ...o, x: -o.x, z: -o.z }]);
}

const SPAWN_Z = [-3, 3, -9, 9, -15, 15, -21, 21];

const OUTPOST = {
  name: 'Avant-poste',
  desc: 'Village fortifié symétrique. La zone centrale est couverte par deux murets.',
  halfX: 60,
  halfZ: 45,
  wallHeight: 3,
  zone: { x: 0, z: 0, r: 9 },
  boxes: mirror([
    { kind: 'building', x: -30, z: -15, w: 10, d: 14, h: 6 },
    { kind: 'building', x: -22, z: 20, w: 14, d: 8, h: 5 },
    { kind: 'building', x: -5, z: -28, w: 12, d: 8, h: 7 },
    { kind: 'wall', x: -13, z: 0, w: 2, d: 12, h: 2.6 },
    { kind: 'crate', x: -8, z: 14, w: 3, d: 3, h: 3 },
    { kind: 'crate', x: -40, z: 5, w: 3, d: 6, h: 3 },
  ]),
  circles: mirror([
    { kind: 'rock', x: -18, z: -32, r: 2.5, h: 3.2 },
    { kind: 'rock', x: -36, z: -30, r: 3, h: 3.9 },
    { kind: 'rock', x: -12, z: 33, r: 2.2, h: 2.9 },
    { kind: 'rock', x: -44, z: 28, r: 2.8, h: 3.6 },
    { kind: 'rock', x: -3, z: -12, r: 1.8, h: 2.3 },
    { kind: 'tree', x: -48, z: -38, r: 0.6, h: 6 },
    { kind: 'tree', x: -25, z: 38, r: 0.6, h: 6 },
    { kind: 'tree', x: -34, z: 10, r: 0.6, h: 6 },
    { kind: 'tree', x: -15, z: -20, r: 0.6, h: 6 },
    { kind: 'tree', x: -56, z: 32, r: 0.6, h: 6 },
    { kind: 'tree', x: -6, z: 40, r: 0.6, h: 6 },
    { kind: 'tree', x: -42, z: -14, r: 0.6, h: 6 },
  ]),
  spawns: {
    red: SPAWN_Z.map((z) => ({ x: -52, z, yaw: Math.PI / 2 })),
    blue: SPAWN_Z.map((z) => ({ x: 52, z: -z, yaw: -Math.PI / 2 })),
  },
};

export const MAPS = { outpost: OUTPOST, oasis: OASIS, rives: RIVES, colline: COLLINE };
export const DEFAULT_MAP = 'outpost';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------ décor destructible
// Objets qu'un obus peut détruire, avec leurs points de structure. Les autres (bâtiments, rochers,
// plateaux, eau, dunes, bunkers, pipelines…) sont indestructibles.
export const DESTRUCTIBLE = { crate: 60, tree: 35, palm: 35, hedgehog: 90, column: 110, wall: 140, ruin: 160 };

// Identifiant stable d'un objet de la carte d'origine : 'b3' (4e boîte) ou 'c7' (8e disque).
export function objectKey(baseMap, o) {
  const i = baseMap.boxes.indexOf(o);
  if (i >= 0) return `b${i}`;
  const j = baseMap.circles.indexOf(o);
  return j >= 0 ? `c${j}` : null;
}

// Carte « vivante » : la carte d'origine sans les objets détruits (broken = Set de clés).
// Le résultat est mis en cache : même carte + mêmes destructions = même objet (comparaison par ===).
const liveCache = new WeakMap();
export function withBroken(map, broken) {
  if (!broken?.size) return map;
  const key = [...broken].sort().join(',');
  const hit = liveCache.get(map);
  if (hit?.key === key) return hit.live;
  const live = {
    ...map,
    base: map,
    boxes: map.boxes.filter((_, i) => !broken.has(`b${i}`)),
    circles: map.circles.filter((_, i) => !broken.has(`c${i}`)),
  };
  liveCache.set(map, { key, live });
  return live;
}

// Objet du décor qui contient ce point 3D (ou null : sol, bords, rien).
export function objectAt(x, y, z, map) {
  for (const b of map.boxes) {
    if (y < b.h && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b;
  }
  for (const c of map.circles) {
    if (y < c.h && (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return c;
  }
  return null;
}

// Repousse un disque (p.x, p.z, rayon r) hors des obstacles et des bords. Renvoie true s'il y a eu contact.
export function collideCircle(p, r, map) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of map.boxes) {
      const hx = b.w / 2, hz = b.d / 2;
      const dx = p.x - b.x, dz = p.z - b.z;
      const ox = dx - clamp(dx, -hx, hx), oz = dz - clamp(dz, -hz, hz);
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        p.x += ox * push;
        p.z += oz * push;
      } else if (hx - Math.abs(dx) < hz - Math.abs(dz)) {
        p.x = b.x + (dx < 0 ? -1 : 1) * (hx + r);
      } else {
        p.z = b.z + (dz < 0 ? -1 : 1) * (hz + r);
      }
    }
    if (collideDiscs(p, r, map.circles)) hit = true;
  }
  const mx = map.halfX - r, mz = map.halfZ - r;
  if (p.x < -mx) { p.x = -mx; hit = true; } else if (p.x > mx) { p.x = mx; hit = true; }
  if (p.z < -mz) { p.z = -mz; hit = true; } else if (p.z > mz) { p.z = mz; hit = true; }
  return hit;
}

// Repousse un disque hors d'une liste de disques {x, z, r}.
export function collideDiscs(p, r, discs) {
  let hit = false;
  for (const c of discs) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const min = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    hit = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2), push = (min - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    } else {
      p.x += min;
    }
  }
  return hit;
}

// ------------------------------------------------------------ relief (optionnel)
// map.hills = [{ x, z, rx, rz, ix, iz, h }] : colline en ellipses concentriques. Dans l'ellipse
// intérieure (ix, iz) le sommet est plat à la hauteur h ; entre les deux ellipses, pente douce
// jusqu'au sol (hauteur 0) sur l'ellipse extérieure (rx, rz). Une carte sans `hills` est plate :
// toutes les fonctions ci-dessous renvoient alors tout de suite le résultat d'avant.
export function heightAt(x, z, map) {
  const hills = map.hills;
  if (!hills) return 0;
  let best = 0;
  for (const o of hills) {
    const ux = x - o.x, uz = z - o.z;
    const dO = Math.sqrt((ux / o.rx) ** 2 + (uz / o.rz) ** 2);
    if (dO >= 1) continue;
    const dI = Math.sqrt((ux / o.ix) ** 2 + (uz / o.iz) ** 2);
    let t = 1;
    if (dI > 1) t = ((1 - dO) * dI) / (dI - dO); // 1 au bord du sommet, 0 au pied
    const h = o.h * t * t * (3 - 2 * t);
    if (h > best) best = h;
  }
  return best;
}

// Pente du sol (montée / distance) dans la direction (fx, fz) unitaire.
export function slopeAlong(x, z, fx, fz, map) {
  const e = 1.5;
  return (heightAt(x + fx * e, z + fz * e, map) - heightAt(x, z, map)) / e;
}

// Le point (x, z) est-il dans un buisson (map.flats de genre 'bush', sans collision), ou à moins de `margin` m de l'un d'eux ?
export function inBush(x, z, map, margin = 0) {
  const flats = map.flats;
  if (!flats) return false;
  for (const f of flats) {
    if (f.kind === 'bush' && Math.abs(x - f.x) < f.w / 2 + margin && Math.abs(z - f.z) < f.d / 2 + margin) return true;
  }
  return false;
}

// Un point 3D est-il dans le décor (sol, bords, obstacle) ? Sert aux obus, à la caméra, aux lignes de vue.
export function pointBlocked(x, y, z, map) {
  if (map.hills ? y <= heightAt(x, z, map) : y <= 0) return true;
  if (Math.abs(x) >= map.halfX || Math.abs(z) >= map.halfZ) return y < map.wallHeight || Math.abs(x) > map.halfX + 30 || Math.abs(z) > map.halfZ + 30;
  for (const b of map.boxes) {
    if (y < b.h && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return true;
  }
  for (const c of map.circles) {
    if (y < c.h) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
  }
  return false;
}

// Avance le long d'un rayon par petits pas ; renvoie la distance du premier point bloqué (ou maxDist).
// `extra(x, y, z)` permet d'ajouter un test (ex. chars).
export function marchRay(ox, oy, oz, dx, dy, dz, maxDist, step, map, extra) {
  for (let d = step; d <= maxDist; d += step) {
    const x = ox + dx * d, y = oy + dy * d, z = oz + dz * d;
    if (pointBlocked(x, y, z, map) || (extra && extra(x, y, z))) return d;
  }
  return maxDist;
}
