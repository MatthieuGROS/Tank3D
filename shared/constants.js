// Constantes partagées entre le serveur (Node) et le client (navigateur).
// Tout ce qui touche à l'équilibrage du jeu se règle ici.

export const TICK_RATE = 60; // simulation à pas fixe, identique des deux côtés
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_INTERVAL = 2; // un instantané tous les 2 ticks = 30 Hz
export const DEFAULT_PORT = 3000;

export const TEAMS = ['red', 'blue'];
export const TEAM_INFO = {
  red: { label: 'Rouges', color: 0xc24a3a, css: '#e2604f' },
  blue: { label: 'Bleus', color: 0x3a74c2, css: '#4f95e2' },
};

// Types de chars. Pour en ajouter un : nouvelle entrée ici + un modèle côté client.
export const TANK_TYPES = {
  standard: {
    name: 'Vanguard',
    armor: 'medium', // classe de blindage : voir FACE_DAMAGE
    role: 'Char moyen polyvalent',
    desc: 'Équilibré en tout : bon blindage, canon fiable, mobilité correcte.',
    maxHp: 1100,
    radius: 2.0, // rayon de collision au sol
    maxSpeed: 44 / 3.6, // m/s (44 km/h)
    reverseSpeed: 6,
    accel: 12,
    brake: 22,
    turnRate: 1.8, // rad/s (caisse)
    turretRate: 1.7, // rad/s (tourelle)
    reloadTicks: 120, // 2 s → 1020 DPM
    shellSpeed: 100, // m/s
    shellDamage: 340,
    shellLifeTicks: 150,
    muzzleHeight: 1.85,
    barrelLength: 3.5,
    // boîte de touche (obus)
    hullHalfLen: 2.5,
    hullHalfWid: 1.5,
    hullHeight: 1.5,
    turretRadius: 1.2,
    height: 2.3,
  },
  heavy: {
    name: 'Bastion',
    armor: 'heavy', // classe de blindage : voir FACE_DAMAGE
    role: "Char lourd d'assaut",
    desc: 'Blindage massif et canon dévastateur, mais lent à manœuvrer et à recharger.',
    maxHp: 1700,
    radius: 2.3,
    maxSpeed: 7,
    reverseSpeed: 4,
    accel: 7,
    brake: 18,
    turnRate: 1.2,
    turretRate: 1.1,
    reloadTicks: 240, // 4 s
    shellSpeed: 110,
    shellDamage: 550,
    shellLifeTicks: 150,
    muzzleHeight: 2.2,
    barrelLength: 5.3,
    hullHalfLen: 3.0,
    hullHalfWid: 1.85,
    hullHeight: 1.75,
    turretRadius: 1.6,
    height: 2.8,
  },
  light: {
    name: 'Lynx',
    armor: 'light', // classe de blindage : voir FACE_DAMAGE
    role: 'Char léger de reconnaissance',
    desc: 'Rapide et nerveux, tir rapide mais peu puissant. Ne supporte pas les coups.',
    maxHp: 650,
    radius: 1.6,
    maxSpeed: 15 + 7 / 3.6, // 61 km/h
    reverseSpeed: 8,
    accel: 20,
    brake: 30,
    turnRate: 2.6,
    turretRate: 2.6,
    reloadTicks: 90, // 1,5 s
    shellSpeed: 120,
    shellDamage: 200,
    shellLifeTicks: 120,
    muzzleHeight: 1.55,
    barrelLength: 3.4,
    hullHalfLen: 2.1,
    hullHalfWid: 1.3,
    hullHeight: 1.25,
    turretRadius: 0.95,
    height: 1.9,
  },

  // ---- chars à acheter au Store (price = prix en crédits, voir shared/progress.js)
  hornet: {
    name: 'Frelon',
    armor: 'light', // classe de blindage : voir FACE_DAMAGE
    role: 'Char de harcèlement',
    desc: 'Tire des rafales de 3 obus légers, puis recharge longuement. Vif et piquant, mais fragile.',
    trait: 'Rafales de 3 obus',
    price: 100000,
    maxHp: 850,
    radius: 1.75,
    maxSpeed: 55 / 3.6,
    reverseSpeed: 7,
    accel: 17,
    brake: 28,
    turnRate: 2.3,
    turretRate: 2.3,
    reloadTicks: 14, // entre deux obus d'une rafale
    burst: { shots: 3, pause: 200 }, // après le 3e obus : 3,3 s de rechargement
    shellSpeed: 115,
    shellDamage: 170,
    shellLifeTicks: 110,
    splash: 2.5,
    splashDamage: 60,
    shellScale: 0.8,
    muzzleHeight: 1.65,
    barrelLength: 3.0,
    hullHalfLen: 2.2,
    hullHalfWid: 1.4,
    hullHeight: 1.3,
    turretRadius: 1.0,
    height: 2.0,
  },
  destroyer: {
    name: 'Harpon',
    armor: 'medium', // classe de blindage : voir FACE_DAMAGE
    role: 'Chasseur de chars',
    desc: 'Pas de tourelle : le canon est fixé dans la caisse et ne pivote que de quelques degrés. Obus très rapide et dévastateur, silhouette basse.',
    trait: 'Canon en casemate (±12°)',
    price: 200000,
    maxHp: 1200,
    radius: 2.1,
    maxSpeed: 40 / 3.6,
    reverseSpeed: 6.5,
    accel: 11,
    brake: 22,
    turnRate: 1.75,
    turretRate: 0.8,
    traverse: 0.21, // débattement du canon de part et d'autre de l'axe de la caisse (rad)
    reloadTicks: 210, // 3,5 s
    shellSpeed: 160,
    shellDamage: 680,
    shellLifeTicks: 140,
    muzzleHeight: 1.55,
    barrelLength: 5.2,
    hullHalfLen: 2.8,
    hullHalfWid: 1.55,
    hullHeight: 1.6,
    turretRadius: 1.1,
    height: 2.0,
  },
  artillery: {
    name: 'Tonnerre',
    armor: 'artillery', // classe de blindage : voir FACE_DAMAGE
    role: "Obusier automoteur",
    desc: 'Tire en cloche par-dessus les obstacles, avec dégâts de zone. A / E pour régler la portée. Les ennemis voient arriver l’obus.',
    trait: 'Tir indirect, portée réglable',
    price: 300000,
    weapon: 'mortar',
    maxHp: 950,
    radius: 2.0,
    maxSpeed: 36 / 3.6,
    reverseSpeed: 6,
    accel: 10,
    brake: 22,
    turnRate: 1.6,
    turretRate: 1.3,
    reloadTicks: 270, // 4,5 s
    shellSpeed: 0,
    shellDamage: 500, // dégâts au point d'impact, décroissants jusqu'au bord du souffle
    shellLifeTicks: 0,
    splash: 6.5,
    minRange: 20,
    maxRange: 120,
    flightBase: 50, // durée de vol : flightBase + flightPerM × distance (ticks)
    flightPerM: 0.45,
    muzzleHeight: 2.0,
    barrelLength: 3.6,
    hullHalfLen: 2.6,
    hullHalfWid: 1.55,
    hullHeight: 1.4,
    turretRadius: 1.35,
    height: 2.7,
  },
};
// Coefficient de dégâts selon la face de la caisse touchée (classe de blindage × face).
// Les unités sans `armor` (tourelles, structures, boss) ne sont pas concernées.
export const FACE_DAMAGE = {
  //          Avant  Côté  Arrière
  light:     { front: 1,   side: 1,   rear: 1.1 },
  medium:    { front: 0.9, side: 1,   rear: 1.2 },
  heavy:     { front: 0.7, side: 0.9, rear: 1.3 },
  artillery: { front: 1,   side: 1,   rear: 1.1 },
};

// Face touchée : angle entre la direction d'où vient le coup et l'avant de la caisse.
// Avant ±45°, arrière ±45° derrière, côtés entre les deux.
export function hitFace(yaw, fromDx, fromDz) {
  // (fromDx, fromDz) : vecteur du tireur / de l'explosion vers le char
  const cos = -(Math.sin(yaw) * fromDx + Math.cos(yaw) * fromDz) / (Math.hypot(fromDx, fromDz) || 1);
  // cos > 0 : le coup arrive par l'avant
  return cos > Math.SQRT1_2 ? 'front' : cos < -Math.SQRT1_2 ? 'rear' : 'side';
}

export function faceCoef(def, yaw, fromDx, fromDz) {
  const row = def.armor && FACE_DAMAGE[def.armor];
  return row ? row[hitFace(yaw, fromDx, fromDz)] : 1;
}

export const DEFAULT_TANK = 'standard';

// Jauges affichées dans le salon : [libellé, remplissage 0..1, valeur lisible],
// calculées à partir des vraies valeurs du char.
export function tankStats(def) {
  const fr = (v, digits = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits });
  // un cycle de tir : un obus, ou une rafale complète puis le rechargement long
  const shots = def.burst?.shots ?? 1;
  const cycle = (def.burst ? (shots - 1) * def.reloadTicks + def.burst.pause : def.reloadTicks) / TICK_RATE;
  const dpm = (def.shellDamage * shots * 60) / cycle; // DPM = dégâts par minute
  const power = def.burst ? `${shots} × ${def.shellDamage}` : def.weapon === 'mortar' ? `${def.shellDamage} en zone` : `${def.shellDamage} dégâts`;
  return [
    ['Blindage', def.maxHp / 1800, `${def.maxHp} PV`],
    ['Puissance de feu', (def.shellDamage * shots) / 700, power],
    ['Cadence', 1.5 / cycle, `${fr(cycle, 1)} s · ${fr(dpm)} DPM`],
    ['Vitesse', def.maxSpeed / 18, `${fr(def.maxSpeed * 3.6)} km/h`],
    ['Maniabilité', def.turnRate / 2.8, `${fr((def.turnRate * 180) / Math.PI)}°/s`],
  ];
}

// Portée de tir d'un obusier pour un réglage 0..1, et durée de vol de l'obus (ticks).
export const arcRange = (def, setting) => def.minRange + (def.maxRange - def.minRange) * setting;
export const arcFlight = (def, dist) => def.flightTicks ?? Math.round(def.flightBase + def.flightPerM * dist);

export const RULES = {
  countdownTicks: 3 * TICK_RATE,
  roundTicks: 180 * TICK_RATE,
  roundEndTicks: 5 * TICK_RATE,
  matchEndTicks: 8 * TICK_RATE,
  defaultRoundsToWin: 3,
  captureSeconds: 20, // avec un seul char dans la zone
  friendlyFire: false,
  splashRadius: 3.5,
  splashDamage: 150,
  maxPlayersPerTeam: 8,
};

// ======================================================================= campagne
// Unités réservées à la campagne (ennemis, tourelles, structures, boss). Elles passent par
// la même simulation que les chars (shared/tank.js) : une tourelle est un « char » immobile.
// Champs en plus des chars :
//   static     ne roule pas            weapon   'cannon' (défaut) | 'mortar' | null (aucune arme)
//   structure  bâtiment sans arme      boss     barre de vie géante + scénario (server/Campaign.js)
//   range      portée de tir des IA    barrels  décalages latéraux des canons (tir simultané)
//   splash / splashDamage   souffle de l'obus     shellScale  taille visuelle de l'obus
//   burst      { shots, pause } : rafales (mitrailleuse)       spread  imprécision propre de l'arme (rad)
const STATIC = { maxSpeed: 0, reverseSpeed: 0, accel: 0, brake: 60, turnRate: 0, static: true };

export const ENEMY_TYPES = {
  turret: {
    ...STATIC, name: 'Tourelle', desc: 'Casemate bétonnée armée d’un canon.',
    maxHp: 900, radius: 2.3, turretRate: 1.25, reloadTicks: 170,
    shellSpeed: 95, shellDamage: 240, shellLifeTicks: 110, muzzleHeight: 2.35, barrelLength: 3.0,
    hullHalfLen: 2.2, hullHalfWid: 2.2, hullHeight: 1.7, turretRadius: 1.35, height: 3.0, range: 78,
  },
  mg: {
    ...STATIC, name: 'Mitrailleuse', desc: 'Nid de sacs de sable. Rafales rapides, courte portée.',
    maxHp: 550, radius: 1.9, turretRate: 2.4, reloadTicks: 9, burst: { shots: 7, pause: 100 }, spread: 0.04,
    shellSpeed: 140, shellDamage: 25, shellLifeTicks: 40, muzzleHeight: 1.45, barrelLength: 1.7,
    splash: 0, splashDamage: 0, shellScale: 0.45,
    hullHalfLen: 1.8, hullHalfWid: 1.8, hullHeight: 1.1, turretRadius: 0.8, height: 1.9, range: 52,
  },
  mortar: {
    ...STATIC, name: 'Mortier', desc: 'Tir en cloche par-dessus les obstacles. Un cercle rouge annonce l’impact.',
    weapon: 'mortar', maxHp: 700, radius: 2.0, turretRate: 1.4, reloadTicks: 270,
    shellSpeed: 0, shellDamage: 340, shellLifeTicks: 0, muzzleHeight: 1.6, barrelLength: 1.9,
    splash: 6.5, splashDamage: 300, flightTicks: 110, minRange: 16,
    hullHalfLen: 2.0, hullHalfWid: 2.0, hullHeight: 1.0, turretRadius: 0.9, height: 2.2, range: 115,
  },
  depot: {
    ...STATIC, name: 'Dépôt de carburant', structure: true, weapon: null,
    maxHp: 1300, radius: 2.8, turretRate: 0, reloadTicks: 1, shellSpeed: 0, shellDamage: 0, shellLifeTicks: 0,
    muzzleHeight: 1, barrelLength: 0, hullHalfLen: 2.8, hullHalfWid: 2.8, hullHeight: 3.2, turretRadius: 1, height: 3.2,
  },
  generator: {
    ...STATIC, name: 'Générateur de bouclier', structure: true, weapon: null,
    maxHp: 1500, radius: 2.4, turretRate: 0.8, reloadTicks: 1, shellSpeed: 0, shellDamage: 0, shellLifeTicks: 0,
    muzzleHeight: 1, barrelLength: 0, hullHalfLen: 2.3, hullHalfWid: 2.3, hullHeight: 2.6, turretRadius: 1.2, height: 4.2,
  },
  factory: {
    ...STATIC, name: 'Usine de blindés', structure: true, weapon: null,
    maxHp: 2600, radius: 5.4, turretRate: 0, reloadTicks: 1, shellSpeed: 0, shellDamage: 0, shellLifeTicks: 0,
    muzzleHeight: 1, barrelLength: 0, hullHalfLen: 5.2, hullHalfWid: 4.2, hullHeight: 6, turretRadius: 1, height: 6,
  },
  goliath: {
    name: 'GOLIATH', desc: 'Char super-lourd à double canon.', boss: true,
    maxHp: 8500, radius: 3.4, maxSpeed: 5.5, reverseSpeed: 3, accel: 5, brake: 14, turnRate: 0.85, turretRate: 0.95,
    reloadTicks: 175, shellSpeed: 95, shellDamage: 210, shellLifeTicks: 170, muzzleHeight: 3.0, barrelLength: 6.0,
    barrels: [-0.55, 0.55], splash: 4.5, splashDamage: 140, shellScale: 1.5,
    hullHalfLen: 4.3, hullHalfWid: 2.8, hullHeight: 2.4, turretRadius: 2.3, height: 3.9, range: 90, holdRange: 30,
  },
  citadel: {
    ...STATIC, name: 'CITADELLE', desc: 'Forteresse blindée protégée par un bouclier.', boss: true,
    maxHp: 11500, radius: 6.6, turretRate: 0.6, reloadTicks: 200,
    shellSpeed: 100, shellDamage: 180, shellLifeTicks: 170, muzzleHeight: 4.6, barrelLength: 7.2,
    barrels: [-1.1, 0, 1.1], splash: 4.5, splashDamage: 120, shellScale: 1.6,
    hullHalfLen: 6.2, hullHalfWid: 6.2, hullHeight: 4.0, turretRadius: 4.0, height: 6.6, range: 80,
  },
  leviathan: {
    name: 'LÉVIATHAN', desc: 'Le prototype ultime. Personne n’en est revenu.', boss: true,
    maxHp: 14000, radius: 3.9, maxSpeed: 6.5, reverseSpeed: 4, accel: 6, brake: 16, turnRate: 0.9, turretRate: 1.0,
    reloadTicks: 160, shellSpeed: 105, shellDamage: 180, shellLifeTicks: 170, muzzleHeight: 3.4, barrelLength: 7.0,
    barrels: [-0.7, 0.7], splash: 5, splashDamage: 160, shellScale: 1.7,
    hullHalfLen: 5.0, hullHalfWid: 3.2, hullHeight: 2.7, turretRadius: 2.7, height: 4.4, range: 95, holdRange: 28,
  },
};

// Toutes les unités pilotables par la simulation : chars des joueurs + unités de campagne.
export const UNIT_TYPES = { ...TANK_TYPES, ...ENEMY_TYPES };

// Bonus ramassables (lâchés par les ennemis détruits ou posés sur la carte).
// Les bonus temporaires s'usent au nombre de tirs, pas au temps :
//   shots = tirs faits par le joueur, hits = impacts reçus (une rafale ou un souffle = un seul impact).
export const PICKUPS = {
  repair: { name: 'Réparation', color: 0x5fd35a, css: '#7be06f' }, // +45 % du blindage
  rapid: { name: 'Cadence rapide', color: 0xf5b312, css: '#f5b312', shots: 10 }, // rechargement x0,5
  damage: { name: 'Obus perforants', color: 0xe4553f, css: '#ff7a63', shots: 6 }, // dégâts x1,6
  shield: { name: 'Bouclier', color: 0x4fb4ff, css: '#6cc2ff', hits: 4 }, // annule entièrement 4 impacts
};

// dmg / hp : multiplicateurs ennemis ; rof : rechargement ennemi (x1,3 = 30 % plus lent) ;
// reaction : délai avant le premier tir (s) ; aim : imprécision de visée (rad) ;
// lead : part moyenne de l'anticipation du mouvement de la cible (1 = parfaite, 0 = vise où elle est)
// → un char rapide qui change de direction peut esquiver.
// allyHp : multiplicateur de blindage des tourelles / nids alliés (ils encaissent les vagues)
export const DIFFICULTIES = {
  easy: { name: 'Recrue', stars: 1, dmg: 0.35, hp: 0.75, rof: 1.5, reaction: 1.0, aim: 0.13, lead: 0.3, allyHp: 1.6 },
  normal: { name: 'Vétéran', stars: 2, dmg: 0.5, hp: 0.9, rof: 1.3, reaction: 0.7, aim: 0.1, lead: 0.45, allyHp: 2.2 },
  hard: { name: 'Élite', stars: 3, dmg: 0.62, hp: 1.1, rof: 1.18, reaction: 0.45, aim: 0.075, lead: 0.6, allyHp: 2.8 },
};

export const CAMPAIGN_RULES = {
  playerTeam: 'blue',
  enemyTeam: 'red',
  wreckTicks: 8 * TICK_RATE, // une épave de char ennemi disparaît au bout de 8 s
  dropChance: 0.25, // tourelles / nids ennemis
  tankDropChance: 0.5, // chars ennemis
  pickupRadius: 3.2,
  playerHp: 1.5, // blindage renforcé des chars de l'escouade (face au nombre)
  // tourelle ou nid allié à 0 PV : hors service pendant ce délai, puis réactivé avec tout son blindage
  // (et tout de suite entre deux vagues)
  allyDownTicks: 20 * TICK_RATE,
};
