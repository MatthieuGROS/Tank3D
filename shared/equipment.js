// Équipements : achetés à la boutique (niveau 1), fusionnés pour monter de niveau, puis montés sur un char
// (3 emplacements par char, un même équipement une seule fois). Données + calculs, partagés serveur + client :
// `eqDef` fabrique la fiche d'un char « équipé », et c'est cette fiche que la simulation utilise partout
// (serveur autoritaire ET prédiction du client), comme pour un char nu.
//
// - Boutique : niveau 1 seulement, EQUIP_PRICE crédits pièce.
// - Fusion : 2 équipements identiques du même niveau → 1 du niveau suivant (jusqu'au niveau 3).
// - Un exemplaire est soit en stock, soit monté sur UN char : pour l'équiper ailleurs, on le démonte d'abord.
// - Course : les équipements sont désactivés (le mode a ses propres règles de conduite).
//
// Format d'un exemplaire : la clé `id:niveau` (ex. 'culasse:2').
// Compte (server/Accounts.js) : progress.equip = { stock: { 'culasse:1': 2 }, load: { standard: ['culasse:2', 'turbo:1'] } }
import { TANK_TYPES, FACE_DAMAGE, RULES } from './constants.js';

export const EQUIP_PRICE = 20000; // prix d'un équipement de niveau 1
export const EQUIP_SLOTS = 3; // emplacements par char
export const EQUIP_MAX_LEVEL = 3;
export const MERGE_COST = 2; // exemplaires nécessaires pour monter d'un niveau

export const EQUIP_GROUPS = ['Puissance de feu', 'Défense', 'Mobilité'];

// values : bonus aux niveaux 1, 2, 3 (fraction). sign : +1 augmente la stat, −1 la réduit.
// label : texte de l'effet (« +8 % <label> »). misfit(def) : raison d'incompatibilité avec un char, ou null.
// apply(d, v) : modifie la copie `d` de la fiche du char pour un bonus `v`.
export const EQUIPMENT = {
  culasse: {
    name: 'Culasse renforcée', group: 0, sign: 1, values: [0.06, 0.08, 0.10], label: 'dégâts par obus',
    desc: 'Une culasse plus résistante encaisse des charges plus fortes : chaque obus frappe plus fort.',
    apply: (d, v) => { d.shellDamage *= 1 + v; },
  },
  chargeur: {
    name: 'Chargeur automatique', group: 0, sign: -1, values: [0.06, 0.08, 0.10], label: 'temps de rechargement',
    desc: 'Un mécanisme de chargement assisté : le canon est prêt plus tôt (la pause entre deux rafales aussi).',
    apply: (d, v) => {
      d.reloadTicks *= 1 - v;
      if (d.burst) d.burst = { ...d.burst, pause: d.burst.pause * (1 - v) };
    },
  },
  telemetre: {
    name: 'Télémètre', group: 0, sign: -1, values: [0.08, 0.11, 0.14], label: 'dispersion',
    desc: 'Une mesure de distance précise resserre le cercle de visée au repos.',
    apply: (d, v) => { d.acc = { ...d.acc, disp: d.acc.disp * (1 - v) }; },
  },
  viseur: {
    name: 'Viseur stabilisé', group: 0, sign: -1, values: [0.10, 0.14, 0.18], label: 'temps de visée',
    desc: 'Le cercle de visée se resserre plus vite après un tir ou un mouvement.',
    apply: (d, v) => { d.acc = { ...d.acc, aimTime: d.acc.aimTime * (1 - v) }; },
  },
  aero: {
    name: 'Obus aérodynamiques', group: 0, sign: 1, values: [0.10, 0.15, 0.20], label: 'vitesse des obus',
    desc: 'Des obus plus rapides : moins de temps de vol, donc moins d’anticipation sur les cibles qui bougent.',
    misfit: (def) => (def.weapon === 'mortar' ? 'Tir en cloche : sans effet' : null),
    apply: (d, v) => { d.shellSpeed *= 1 + v; },
  },
  explosive: {
    name: 'Charge explosive', group: 0, sign: 1, values: [0.10, 0.15, 0.20], label: 'rayon et dégâts du souffle',
    desc: 'Le souffle de l’obus s’étend plus loin et frappe plus fort, autour du point d’impact.',
    apply: (d, v) => {
      d.splash = (d.splash ?? RULES.splashRadius) * (1 + v);
      if (d.weapon === 'mortar') d.shellDamage *= 1 + v; // les dégâts d’un obus de mortier sont ses dégâts de souffle
      else d.splashDamage = (d.splashDamage ?? RULES.splashDamage) * (1 + v);
    },
  },
  blindage: {
    name: 'Blindage additionnel', group: 1, sign: 1, values: [0.06, 0.09, 0.12], label: 'PV max',
    desc: 'Des plaques supplémentaires boulonnées sur la caisse : le char encaisse davantage avant de sauter.',
    apply: (d, v) => { d.maxHp = Math.round(d.maxHp * (1 + v)); },
  },
  plaque: {
    name: 'Plaque arrière', group: 1, sign: -1, values: [0.10, 0.15, 0.20], label: 'dégâts reçus par l’arrière',
    desc: 'Renforce le point faible de la caisse : les coups reçus par l’arrière font moins mal.',
    apply: (d, v) => {
      const row = { ...(d.face ?? FACE_DAMAGE[d.armor] ?? { front: 1, side: 1, rear: 1 }) };
      row.rear *= 1 - v;
      d.face = row;
    },
  },
  turbo: {
    name: 'Moteur turbo', group: 2, sign: 1, values: [0.06, 0.09, 0.12], label: 'vitesse max',
    desc: 'Un moteur plus puissant : le char atteint une vitesse de pointe plus élevée.',
    apply: (d, v) => { d.maxSpeed *= 1 + v; },
  },
  chenilles: {
    name: 'Chenilles larges', group: 2, sign: 1, values: [0.10, 0.15, 0.20], label: 'rotation de la caisse',
    desc: 'Une meilleure adhérence : le char pivote plus vite sur lui-même.',
    apply: (d, v) => { d.turnRate *= 1 + v; },
  },
  servo: {
    name: 'Servo de tourelle', group: 2, sign: 1, values: [0.10, 0.15, 0.20], label: 'rotation de la tourelle',
    desc: 'Une motorisation assistée : la tourelle suit la cible plus vite.',
    misfit: (def) => (def.traverse ? 'Canon en casemate : sans tourelle' : null),
    apply: (d, v) => { d.turretRate *= 1 + v; },
  },
  suspension: {
    name: 'Suspension stabilisée', group: 2, sign: -1, values: [0.15, 0.22, 0.30], label: 'malus de précision en mouvement',
    desc: 'Le canon reste mieux réglé quand le char roule, pivote ou tourne sa tourelle.',
    apply: (d, v) => {
      const a = d.acc;
      d.acc = { ...a, move: a.move * (1 - v), turret: a.turret * (1 - v), hull: a.hull * (1 - v) };
    },
  },
  marche: {
    name: 'Boîte marche arrière', group: 2, sign: 1, values: [0.20, 0.30, 0.40], label: 'vitesse en marche arrière',
    desc: 'Une marche arrière enfin digne de ce nom : pour se dégager sans tourner le dos à l’ennemi.',
    apply: (d, v) => { d.reverseSpeed *= 1 + v; },
  },
};

export const EQUIP_IDS = Object.keys(EQUIPMENT);

// ------------------------------------------------------------------ exemplaires
export const eqKey = (id, level) => `${id}:${level}`;

// { id, level } d'une clé, ou null si elle n'existe pas.
export function parseEq(key) {
  if (typeof key !== 'string') return null;
  const [id, l] = key.split(':');
  const level = Number(l);
  if (!Object.hasOwn(EQUIPMENT, id) || !Number.isInteger(level) || level < 1 || level > EQUIP_MAX_LEVEL) return null;
  return { id, level };
}

export const equipValue = (id, level) => EQUIPMENT[id].values[level - 1];

// « +8 % dégâts par obus » : l'effet d'un équipement à un niveau.
export function equipEffect(id, level) {
  const e = EQUIPMENT[id], pct = Math.round(equipValue(id, level) * 100);
  return `${e.sign > 0 ? '+' : '−'}${pct} % ${e.label}`;
}

// Raison pour laquelle cet équipement ne va pas sur ce char, ou null s'il est compatible.
export const equipMisfit = (id, def) => EQUIPMENT[id].misfit?.(def) ?? null;

// Chars sur lesquels l'équipement ne va pas : [{ type, reason }].
export const equipMisfits = (id) => Object.entries(TANK_TYPES).map(([type, def]) => ({ type, reason: equipMisfit(id, def) })).filter((m) => m.reason);

// Équipements valides d'un char : clés connues, compatibles, un seul par équipement, EQUIP_SLOTS au plus.
export function cleanLoadout(type, keys) {
  const def = TANK_TYPES[type];
  const out = [], seen = new Set();
  if (!def || !Array.isArray(keys)) return out;
  for (const key of keys) {
    const e = parseEq(key);
    if (!e || seen.has(e.id) || equipMisfit(e.id, def) || out.length >= EQUIP_SLOTS) continue;
    seen.add(e.id);
    out.push(key);
  }
  return out;
}

// ------------------------------------------------------------------ fiche équipée
const cache = new Map();

// Fiche d'un char de joueur avec ses équipements. Sans équipement : la fiche d'origine (même objet).
// Les fiches équipées sont mises en cache : la simulation peut l'appeler à chaque tick.
export function eqDef(type, keys) {
  const base = TANK_TYPES[type];
  if (!base || !keys?.length) return base;
  const ck = `${type}|${keys.join(',')}`;
  let d = cache.get(ck);
  if (d) return d;
  const clean = cleanLoadout(type, keys);
  if (!clean.length) {
    cache.set(ck, base);
    return base;
  }
  d = { ...base };
  for (const key of clean) {
    const { id, level } = parseEq(key);
    EQUIPMENT[id].apply(d, equipValue(id, level));
  }
  cache.set(ck, d);
  return d;
}
