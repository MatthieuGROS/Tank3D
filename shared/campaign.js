// Campagne coopérative : 12 missions réparties en 3 chapitres.
// Tout est de la donnée : le serveur (server/Campaign.js) l'interprète, le client en tire
// le décor, la mini-carte et l'aperçu du salon.
//
// Une mission :
//   objective  { kind, label, seconds? }   kind = destroy | targets | hold | waves | reach | boss
//   map        carte au même format que shared/map.js (+ theme, playerSpawn, zone éventuelle)
//   base       carte d'escarmouche (clé de MAPS) sur laquelle se joue la mission, + clear / boxes / circles
//   units      unités posées au départ : { t: type, x, z, yaw?, ai?, obj?, team?, spawn? }
//                ai  = 'guard' (attend qu'on s'approche) | 'assault' (fonce) — défaut : guard
//                obj = cible de l'objectif « targets »     team 'blue' = allié
//                spawn = { every, t: [types], cap } : usine qui produit des chars
//   entries    points d'arrivée des renforts et des vagues
//   waves      [{ delay, units: [{ t, n }] }] : vague suivante `delay` s après la fin de la précédente
//   reinforce  { first, every, cap, groups: [[{ t, n }], ...] } : renforts réguliers (groupes en boucle)
//   pickups    bonus posés sur la carte : { k, x, z }
//   par        temps de référence (s) pour la 2e étoile
import { MAPS, RACE_MAPS, DEFAULT_RACE_MAP, collideCircle } from './map.js';
import { bld, wall, crate, rock, tree, dune } from './props.js';

const PI = Math.PI;
export const CHAPTERS = ['Opération Aube', 'Tempête de sable', 'Hiver d’acier'];

// --- unités
const u = (t, x, z, extra = {}) => ({ t, x, z, ...extra });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Décor aléatoire (mais identique pour tous) qui évite les points importants de la mission.
function scatter(map, seed, count, kinds, avoid) {
  const rand = rng(seed);
  const out = [];
  const probe = { x: 0, z: 0 };
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const x = (rand() * 2 - 1) * (map.halfX - 6), z = (rand() * 2 - 1) * (map.halfZ - 6);
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const r = kind === 'tree' ? 0.6 : kind === 'dune' ? 4 + rand() * 4 : 1.6 + rand() * 1.6;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r ?? 9) + r)) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 5)) continue;
    probe.x = x;
    probe.z = z;
    if (collideCircle(probe, r + 5, { ...map, circles: map.circles, halfX: 1e9, halfZ: 1e9 })) continue;
    out.push(kind === 'tree' ? tree(x, z) : kind === 'dune' ? dune(x, z, r) : rock(x, z, r));
  }
  return out;
}

// Assemble une mission : complète la carte (décor, bords, zone) à partir des données.
// Avec `base`, la mission se joue sur une carte d'escarmouche (MAPS) : `clear` y retire les objets
// dont le centre tombe dans un des disques { x, z, r }, `boxes` / `circles` en ajoutent.
function mission(m) {
  const base = m.base ? MAPS[m.base] : null;
  const keep = (o) => !(m.clear ?? []).some((c) => Math.hypot(o.x - c.x, o.z - c.z) < c.r);
  const map = {
    name: m.name, desc: m.brief, theme: m.theme ?? base?.theme, wallHeight: 3,
    halfX: base?.halfX ?? m.size[0], halfZ: base?.halfZ ?? m.size[1],
    zone: m.zone ?? null,
    boxes: [...(base?.boxes.filter(keep) ?? []), ...(m.boxes ?? [])],
    circles: [...(base?.circles.filter(keep) ?? []), ...(m.circles ?? [])],
    flats: [...(base?.flats?.filter(keep) ?? []), ...(m.flats ?? [])],
    playerSpawn: m.spawn,
  };
  const avoid = [
    { ...m.spawn, r: 16 },
    ...(m.units ?? []).map((p) => ({ x: p.x, z: p.z, r: 9 })),
    ...(m.entries ?? []).map((p) => ({ x: p.x, z: p.z, r: 10 })),
    ...(m.pickups ?? []).map((p) => ({ x: p.x, z: p.z, r: 5 })),
    ...(m.zone ? [{ x: m.zone.x, z: m.zone.z, r: m.zone.r + 6 }] : []),
  ];
  if (m.decor) map.circles = [...map.circles, ...scatter(map, m.decor.seed, m.decor.n, m.decor.kinds, avoid)];
  return { ...m, map, units: m.units ?? [], entries: m.entries ?? [], pickups: m.pickups ?? [] };
}

const MEADOW = ['rock', 'tree', 'tree'];

export const MISSIONS = [
  // ===================================================================== chapitre I
  mission({
    id: 'm1', chapter: 0, name: 'Baptême du feu', theme: 'meadow', par: 210,
    brief: 'Un avant-poste ennemi verrouille la vallée. Nettoie le village : chars, casemates et nid de mitrailleuse.',
    objective: { kind: 'destroy', label: 'Détruire toutes les forces ennemies' },
    size: [72, 46],
    spawn: { x: -62, z: 0, yaw: PI / 2 },
    boxes: [
      bld(-28, -20, 10, 12, 6), bld(-24, 22, 12, 8, 5), bld(8, -28, 12, 8, 6), bld(12, 24, 10, 10, 7), bld(38, -6, 10, 14, 6),
      wall(-10, 2, 2, 14), wall(26, 16, 14, 2), wall(50, -26, 2, 12),
      crate(-42, -9), crate(0, 10), crate(27, -18, 3, 6),
    ],
    units: [
      u('light', -8, -16, { ai: 'guard', yaw: -PI / 2 }), u('light', -4, 22, { ai: 'guard', yaw: -PI / 2 }),
      u('turret', 6, -2, { yaw: -PI / 2 }),
      u('mg', 21, -11, { yaw: -PI / 2 }),
      u('standard', 32, 8, { ai: 'guard', yaw: -PI / 2 }),
      u('turret', 54, 14, { yaw: -PI / 2 }), u('turret', 60, -16, { yaw: -PI / 2 }),
      u('standard', 58, -2, { ai: 'guard', yaw: -PI / 2 }),
    ],
    pickups: [{ k: 'repair', x: -36, z: 4 }, { k: 'damage', x: 18, z: 4 }],
    decor: { seed: 11, n: 16, kinds: MEADOW },
  }),

  mission({
    id: 'm2', chapter: 0, name: 'Route des dépôts', theme: 'meadow', par: 270,
    brief: 'Quatre dépôts de carburant alimentent les blindés adverses. Fais-les sauter avant que les renforts ne submergent ton escouade.',
    objective: { kind: 'targets', label: 'Détruire les dépôts de carburant' },
    size: [82, 52],
    spawn: { x: -72, z: -32, yaw: PI / 2 },
    boxes: [
      bld(-40, 10, 12, 10, 6), bld(-8, -10, 10, 14, 5), bld(30, 6, 14, 10, 6), bld(58, 36, 10, 8, 5),
      wall(-22, 32, 16, 2), wall(10, -40, 2, 14), wall(44, -20, 14, 2),
      crate(-54, -14), crate(16, 30, 3, 6), crate(64, 8),
    ],
    units: [
      u('depot', -14, 36, { obj: true }), u('depot', 22, -36, { obj: true }),
      u('depot', 50, 26, { obj: true }), u('depot', 70, -12, { obj: true }),
      u('turret', -6, 26, { yaw: -PI / 2 }), u('mg', 30, -28, { yaw: PI }),
      u('light', 14, -24, { ai: 'guard' }), u('standard', 58, 16, { ai: 'guard', yaw: -PI / 2 }),
      u('turret', 62, -24, { yaw: -PI / 2 }), u('light', 40, 40, { ai: 'guard' }),
    ],
    entries: [{ x: 76, z: 44 }, { x: 76, z: -44 }, { x: 74, z: 0 }],
    reinforce: { first: 25, every: 32, cap: 4, groups: [[{ t: 'light', n: 2 }], [{ t: 'standard', n: 1 }, { t: 'light', n: 1 }]] },
    pickups: [{ k: 'repair', x: -30, z: -30 }, { k: 'rapid', x: 4, z: 14 }, { k: 'repair', x: 40, z: -6 }],
    decor: { seed: 22, n: 20, kinds: MEADOW },
  }),

  mission({
    id: 'm3', chapter: 0, name: 'Le Verrou', theme: 'meadow', par: 120,
    brief: 'Le carrefour central est la clé du front. Tiens la zone 70 secondes : l’ennemi arrive de partout et ses mortiers pilonnent le secteur.',
    objective: { kind: 'hold', label: 'Tenir la zone', seconds: 70 },
    size: [66, 56],
    spawn: { x: -18, z: 0, yaw: PI / 2 },
    zone: { x: 0, z: 0, r: 10 },
    boxes: [
      wall(-12, 15, 12, 2), wall(12, -15, 12, 2), wall(15, 10, 2, 10), wall(-15, -10, 2, 10),
      bld(-38, 30, 10, 10, 6), bld(36, 32, 12, 8, 5), bld(-36, -32, 12, 8, 6), bld(36, -30, 10, 10, 6),
      crate(26, 2), crate(-26, -2), crate(0, 30, 6, 3), crate(0, -30, 6, 3),
    ],
    units: [
      u('turret', -7, 7, { team: 'blue', yaw: PI / 4 }), u('turret', 7, -7, { team: 'blue', yaw: PI * 0.75 }),
      u('mortar', 52, -44), u('mortar', -52, 44),
    ],
    entries: [{ x: 60, z: 6 }, { x: -60, z: -8 }, { x: 10, z: 50 }, { x: -12, z: -50 }, { x: 56, z: 46 }],
    reinforce: {
      first: 6, every: 15, cap: 6,
      groups: [[{ t: 'light', n: 2 }], [{ t: 'standard', n: 1 }, { t: 'light', n: 1 }], [{ t: 'light', n: 3 }], [{ t: 'heavy', n: 1 }, { t: 'light', n: 1 }]],
    },
    pickups: [{ k: 'repair', x: 0, z: 0 }, { k: 'shield', x: -30, z: 18 }, { k: 'rapid', x: 30, z: -18 }],
    decor: { seed: 33, n: 14, kinds: MEADOW },
  }),

  mission({
    id: 'm4', chapter: 0, name: 'Goliath', theme: 'meadow', par: 240, boss: 'goliath',
    brief: 'Le char super-lourd Goliath sort de son hangar. Double canon, salves en éventail, escorte rapide quand il est acculé. Abats-le.',
    objective: { kind: 'boss', label: 'Détruire le Goliath' },
    size: [62, 62],
    spawn: { x: 0, z: -50, yaw: 0 },
    circles: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rock(Math.cos((i / 8) * PI * 2 + PI / 8) * 26, Math.sin((i / 8) * PI * 2 + PI / 8) * 26, 3.4)),
    boxes: [wall(-40, 0, 2, 16), wall(40, 0, 2, 16), wall(0, 14, 10, 2), bld(-46, 44, 10, 10, 6), bld(46, 44, 10, 10, 6)],
    units: [
      u('goliath', 0, 42, { ai: 'assault', yaw: PI }),
      u('mg', -34, 30, { yaw: PI }), u('mg', 34, 30, { yaw: PI }),
    ],
    entries: [{ x: -52, z: 52 }, { x: 52, z: 52 }, { x: 0, z: 56 }],
    pickups: [{ k: 'repair', x: -48, z: -48 }, { k: 'repair', x: 48, z: -48 }, { k: 'damage', x: 0, z: 0 }, { k: 'shield', x: -50, z: 20 }, { k: 'rapid', x: 50, z: 20 }],
    decor: { seed: 44, n: 8, kinds: ['tree'] },
  }),

  // ==================================================================== chapitre II
  // Toutes les missions du chapitre se jouent sur la carte « Oasis » (shared/maps/oasis.js),
  // chacune avec ses ajouts de décor et son propre déploiement.
  mission({
    id: 'm5', chapter: 1, name: 'Mer de dunes', base: 'oasis', par: 260,
    brief: 'Traverse l’oasis jusqu’au point d’extraction derrière le pipeline est. Casemates, mitrailleuses et patrouilles t’attendent derrière chaque dune.',
    objective: { kind: 'reach', label: 'Toute l’escouade au point d’extraction' },
    spawn: { x: -72, z: 0, yaw: PI / 2 },
    zone: { x: 70, z: -15, r: 8 },
    circles: [dune(-60, -48, 4.5), dune(40, -50, 4), dune(-20, -24, 4), dune(20, 24, 4), dune(54, 46, 4)],
    units: [
      u('turret', -40, -22, { yaw: -PI / 2 }), u('light', -36, 14, { ai: 'guard' }), u('light', -30, -6, { ai: 'guard' }),
      u('mg', -14, -20, { yaw: -PI / 2 }), u('mortar', 14, 40), u('standard', 8, -21, { ai: 'guard' }),
      u('turret', 22, 6, { yaw: -PI / 2 }), u('mg', 40, 2, { yaw: -PI / 2 }), u('standard', 38, -14, { ai: 'guard' }),
      u('mortar', 62, 8), u('turret', 58, -16, { yaw: -PI / 2 }), u('heavy', 59, -22, { ai: 'guard', yaw: -PI / 2 }),
      u('light', 42, 22, { ai: 'guard' }),
    ],
    entries: [{ x: 76, z: 46 }, { x: 76, z: -48 }],
    reinforce: { first: 40, every: 45, cap: 3, groups: [[{ t: 'light', n: 2 }]] },
    pickups: [{ k: 'repair', x: -56, z: -12 }, { k: 'rapid', x: -22, z: 4 }, { k: 'repair', x: 28, z: 0 }, { k: 'shield', x: 42, z: -30 }],
  }),

  mission({
    id: 'm6', chapter: 1, name: 'Batteries de l’oasis', base: 'oasis', par: 280,
    brief: 'Cinq batteries de mortiers tiennent l’oasis sous leur feu. Repère les cercles rouges au sol, esquive, et réduis-les au silence.',
    objective: { kind: 'targets', label: 'Détruire les batteries de mortiers' },
    spawn: { x: -72, z: -20, yaw: PI / 2 },
    boxes: [wall(17, 38, 8, 1.6, 1.8), wall(61, -16, 1.6, 6, 1.8)],
    units: [
      u('mortar', 16, 32, { obj: true }), u('mortar', 62, 16, { obj: true }), u('mortar', 66, -16, { obj: true }),
      u('mortar', 72, -36, { obj: true }), u('mortar', 30, -14, { obj: true }),
      u('mg', 10, 24, { yaw: -PI / 2 }), u('turret', 56, 10, { yaw: -PI / 2 }), u('mg', 54, -30, { yaw: -PI / 2 }),
      u('light', -14, -12, { ai: 'guard' }), u('standard', 40, 2, { ai: 'guard', yaw: -PI / 2 }),
    ],
    entries: [{ x: 76, z: 48 }, { x: 76, z: -48 }, { x: 36, z: 49 }],
    reinforce: { first: 30, every: 30, cap: 4, groups: [[{ t: 'light', n: 2 }], [{ t: 'standard', n: 1 }, { t: 'light', n: 1 }]] },
    pickups: [{ k: 'repair', x: -42, z: -34 }, { k: 'shield', x: -24, z: 16 }, { k: 'repair', x: 22, z: -2 }, { k: 'damage', x: 62, z: -6 }],
  }),

  mission({
    id: 'm7', chapter: 1, name: 'Siège au crépuscule', base: 'oasis', theme: 'dusk', par: 300,
    brief: 'Les ruines de l’oasis doivent tenir jusqu’à l’aube. Cinq vagues d’assaut, de plus en plus lourdes. Nos tourelles couvrent les brèches.',
    objective: { kind: 'waves', label: 'Repousser les vagues' },
    spawn: { x: 0, z: -4, yaw: 0 },
    // le fortin : murs ajoutés autour des ruines du temple
    boxes: [wall(-21, -6, 2, 8), wall(21, 6, 2, 8), wall(-12, -22, 8, 2), wall(12, 22, 8, 2), crate(-20, 12), crate(20, -12)],
    units: [
      u('turret', -4, 8, { team: 'blue', yaw: -PI / 4 }), u('turret', -6, -8, { team: 'blue', yaw: PI * 0.75 }), u('turret', 8, -2, { team: 'blue', yaw: PI / 2 }),
      u('mg', 4, 10, { team: 'blue', yaw: 0 }),
    ],
    entries: [{ x: 74, z: 46 }, { x: -75, z: 40 }, { x: 75, z: -40 }, { x: -74, z: -46 }, { x: 4, z: 49 }, { x: -4, z: -49 }],
    // vagues allégées (le nombre d'ennemis est multiplié selon la taille de l'escouade)
    waves: [
      { delay: 5, units: [{ t: 'light', n: 3 }] },
      { delay: 8, units: [{ t: 'standard', n: 2 }, { t: 'light', n: 2 }] },
      { delay: 10, units: [{ t: 'heavy', n: 1 }, { t: 'light', n: 3 }, { t: 'mortar', n: 1 }] },
      { delay: 12, units: [{ t: 'standard', n: 2 }, { t: 'heavy', n: 1 }, { t: 'light', n: 1 }] },
      { delay: 14, units: [{ t: 'heavy', n: 2 }, { t: 'standard', n: 1 }, { t: 'light', n: 2 }] },
    ],
    pickups: [{ k: 'repair', x: -10, z: 0 }, { k: 'repair', x: 2, z: 4 }, { k: 'rapid', x: 0, z: -12 }, { k: 'shield', x: -8, z: 2 }],
  }),

  mission({
    id: 'm8', chapter: 1, name: 'La Citadelle', base: 'oasis', par: 300, boss: 'citadel',
    brief: 'La Citadelle verrouille le champ pétrolier est. Elle est intouchable tant que ses quatre générateurs alimentent son bouclier : détruis-les, puis abats la forteresse.',
    objective: { kind: 'boss', label: 'Détruire la Citadelle' },
    spawn: { x: -72, z: 0, yaw: PI / 2 },
    clear: [{ x: 54, z: -4, r: 3 }, { x: 56, z: 24, r: 3 }], // caisses à la place des générateurs
    boxes: [wall(58, 14, 10, 1.6), wall(58, -6, 10, 1.6)],
    units: [
      u('citadel', 66, 4, { ai: 'static', yaw: -PI / 2 }),
      u('generator', 40, 22, { tag: 'gen', obj: true }), u('generator', 70, 24, { tag: 'gen', obj: true }),
      u('generator', 54, -30, { tag: 'gen', obj: true }), u('generator', 70, -18, { tag: 'gen', obj: true }),
      u('turret', 28, 20, { yaw: -PI / 2 }), u('turret', 30, -16, { yaw: -PI / 2 }), u('mg', 77, 4, { yaw: -PI / 2 }),
    ],
    entries: [{ x: 76, z: 46 }, { x: 76, z: -48 }],
    pickups: [{ k: 'repair', x: -42, z: 14 }, { k: 'repair', x: -40, z: -18 }, { k: 'shield', x: -14, z: 0 }, { k: 'damage', x: 44, z: 48 }, { k: 'rapid', x: 40, z: -46 }],
  }),

  // =================================================================== chapitre III
  // Toutes les missions du chapitre se jouent sur la carte « Deux-Rives » (shared/maps/rives.js).
  mission({
    id: 'm9', chapter: 2, name: 'Les ponts gelés', base: 'rives', par: 300,
    brief: 'Pour avancer, il faut franchir les deux bras du fleuve. Des chars lourds tiennent chaque tête de pont, couverts par des mortiers sur les berges.',
    objective: { kind: 'destroy', label: 'Prendre les ponts' },
    spawn: { x: -70, z: 0, yaw: PI / 2 },
    circles: [rock(-12, 30, 2.6), rock(32, -30, 2.6), rock(40, 34, 2.4)],
    units: [
      u('heavy', -10, 22, { ai: 'guard', yaw: -PI / 2 }), u('light', -8, -32, { ai: 'guard', yaw: -PI / 2 }),
      u('mortar', 2, 46), u('turret', 4, 4, { yaw: -PI / 2 }), u('standard', -2, -24, { ai: 'guard', yaw: -PI / 2 }),
      u('heavy', 42, 28, { ai: 'guard', yaw: -PI / 2 }), u('mg', 35, -20, { yaw: -PI / 2 }), u('standard', 38, -10, { ai: 'guard', yaw: -PI / 2 }),
      u('mortar', 66, 20), u('heavy', 60, -14, { ai: 'guard', yaw: -PI / 2 }), u('turret', 70, 30, { yaw: -PI / 2 }),
      u('standard', 56, -22, { ai: 'guard' }), u('mortar', 62, -50),
    ],
    pickups: [{ k: 'repair', x: -50, z: 0 }, { k: 'shield', x: -6, z: -10 }, { k: 'repair', x: 6, z: -24 }, { k: 'damage', x: 46, z: 14 }, { k: 'repair', x: 66, z: -2 }],
  }),

  mission({
    id: 'm10', chapter: 2, name: 'Usine Kessel', base: 'rives', par: 300,
    brief: 'Sur la rive est, les usines Kessel crachent un blindé toutes les vingt secondes. Chaque minute perdue renforce l’ennemi : passe les ponts et vise les usines.',
    objective: { kind: 'targets', label: 'Détruire les usines' },
    spawn: { x: -70, z: 0, yaw: PI / 2 },
    clear: [{ x: 54, z: 42, r: 12 }, { x: 48, z: -35, r: 10 }], // la forêt et le hameau ont laissé place aux usines
    boxes: [crate(42, 40, 3, 6), crate(66, 32), crate(58, -46, 6, 3), wall(56, -26, 12, 1.6)],
    units: [
      u('factory', 56, 42, { obj: true, yaw: -PI / 2, spawn: { every: 20, t: ['light', 'standard'], cap: 2 } }),
      u('factory', 68, -10, { obj: true, yaw: -PI / 2, spawn: { every: 22, t: ['standard', 'heavy'], cap: 2 } }),
      u('factory', 48, -38, { obj: true, yaw: -PI / 2, spawn: { every: 20, t: ['light', 'light', 'standard'], cap: 2 } }),
      u('turret', 36, 32, { yaw: -PI / 2 }), u('turret', 36, -28, { yaw: -PI / 2 }), u('mg', 6, -24, { yaw: -PI / 2 }),
      u('mortar', 72, 24), u('standard', -4, 6, { ai: 'guard', yaw: -PI / 2 }),
    ],
    pickups: [{ k: 'repair', x: -56, z: 14 }, { k: 'rapid', x: -4, z: -6 }, { k: 'repair', x: 46, z: 12 }, { k: 'damage', x: 6, z: 28 }, { k: 'shield', x: -4, z: -28 }],
  }),

  mission({
    id: 'm11', chapter: 2, name: 'Dernier rempart', base: 'rives', theme: 'blizzard', par: 150,
    brief: 'Le blizzard couvre une offensive massive venue des deux rives. Tiens l’île 80 secondes. Les éclaireurs signalent un Goliath dans la colonne.',
    objective: { kind: 'hold', label: 'Tenir l’île', seconds: 80 },
    spawn: { x: 0, z: -6, yaw: 0 },
    zone: { x: 0, z: 0, r: 11 },
    boxes: [wall(-6, -10, 6, 1.6), wall(6, 10, 6, 1.6)],
    units: [
      u('turret', -6, -4, { team: 'blue', yaw: -PI / 2 }), u('turret', 6, 4, { team: 'blue', yaw: PI / 2 }),
      u('mg', 0, 4, { team: 'blue', yaw: PI / 4 }),
      u('mortar', 70, 48), u('mortar', -70, -48),
    ],
    entries: [{ x: 72, z: 10 }, { x: -72, z: -10 }, { x: 60, z: -50 }, { x: -60, z: 50 }, { x: 74, z: -28 }, { x: -74, z: 28 }],
    reinforce: {
      first: 8, every: 16, cap: 5,
      groups: [[{ t: 'light', n: 2 }], [{ t: 'standard', n: 2 }], [{ t: 'heavy', n: 1 }, { t: 'light', n: 1 }], [{ t: 'standard', n: 1 }, { t: 'heavy', n: 1 }], [{ t: 'goliath', n: 1 }], [{ t: 'light', n: 3 }]],
    },
    pickups: [{ k: 'repair', x: 0, z: 0 }, { k: 'shield', x: -4, z: -21 }, { k: 'damage', x: 6, z: 24 }, { k: 'repair', x: -8, z: 28 }],
  }),

  mission({
    id: 'm12', chapter: 2, name: 'Léviathan', base: 'rives', theme: 'blizzard', par: 360, boss: 'leviathan',
    brief: 'Le prototype Léviathan franchit le fleuve : double canon, barrages d’artillerie, escorte lourde. Quand il saigne, il devient fou. Mets fin à la guerre.',
    objective: { kind: 'boss', label: 'Détruire le Léviathan' },
    spawn: { x: -62, z: 0, yaw: PI / 2 },
    units: [
      u('leviathan', 62, 0, { ai: 'assault', yaw: -PI / 2 }),
      u('heavy', 56, 14, { ai: 'guard', yaw: -PI / 2 }), u('heavy', 56, -14, { ai: 'guard', yaw: -PI / 2 }),
      u('turret', 34, 40, { yaw: -PI / 2 }), u('turret', 34, -40, { yaw: -PI / 2 }),
    ],
    entries: [{ x: 74, z: 48 }, { x: 74, z: -48 }, { x: 73, z: 20 }],
    pickups: [
      { k: 'repair', x: -60, z: -30 }, { k: 'repair', x: -60, z: 30 }, { k: 'shield', x: 0, z: 0 },
      { k: 'damage', x: -6, z: -24 }, { k: 'rapid', x: 6, z: 24 }, { k: 'shield', x: -40, z: 0 },
    ],
  }),
];

export const MISSION_INDEX = Object.fromEntries(MISSIONS.map((m, i) => [m.id, i]));
export const getMission = (id) => MISSIONS[MISSION_INDEX[id]] ?? MISSIONS[0];

// Carte jouée selon les réglages du salon (escarmouche, mission de campagne ou circuit de course).
export function mapFor(settings) {
  if (settings?.mode === 'campaign') return getMission(settings.mission).map;
  if (settings?.mode === 'race') return RACE_MAPS[settings.raceMap] ?? RACE_MAPS[DEFAULT_RACE_MAP];
  return MAPS[settings?.map] ?? Object.values(MAPS)[0];
}
