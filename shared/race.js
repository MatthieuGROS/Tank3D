// Moteur du mode course : circuit, points de passage, obstacles et surfaces.
// Tout est donnée + fonctions pures : le MÊME code tourne sur le serveur (autorité), sur le client
// (prédiction + rendu) et dans les bots. Une carte de course est une carte normale (shared/map.js)
// avec un champ `race` en plus, construit par buildRace() à partir d'une description « en repère piste » :
// chaque objet se place à une abscisse `s` (mètres le long du circuit) et un décalage latéral `off`.
//
// Repère : le cap (fx, fz) vaut (sin yaw, cos yaw). L'axe latéral est v = (-fz, fx).
// Objets orientés (rampes, tapis, boue, eau) : centre (x, z), cap (fx, fz), len le long du cap, w en travers.
import { TICK_RATE } from './constants.js';

export const RACE_RULES = {
  gravity: 17, // m/s² en l'air
  laps: [1, 2, 3, 5],
  defaultLaps: 2,
  finishGraceTicks: 45 * TICK_RATE, // après le premier arrivé, les autres ont au moins ce temps pour finir (ou 40 % du temps du premier)
  maxTicks: 12 * 60 * TICK_RATE, // durée maximale d'une course
  respawnFreezeTicks: 45, // le char repart au point de contrôle, canon bloqué un instant
  boostTicks: 80, // durée d'un turbo (tapis)
  boostSpeed: 1.5, // vitesse maximale pendant le turbo
  boostAccel: 3.5,
  knockDecay: 2.3, // frottement de la poussée au sol (1/s)
  airDecay: 0.35,
  maxKnock: 46, // m/s : poussée maximale d'un tir
  pushScale: 1.4, // m/s de poussée par point de dégât et par tonne⁻¹ : v = dégâts / poids × pushScale
  // dérapage : un tir fait aussi tourner la caisse (rad/s), l'élan garde sa direction et le char glisse en travers
  spinScale: 0.22, // rad/s de rotation par m/s de poussée
  maxSpin: 7, // rad/s
  spinDecay: 2.6, // frottement de la rotation au sol (1/s)
  airSpinDecay: 0.6,
  maxPlayers: 8,
  launchVy: 11.5, // m/s : vitesse verticale donnée par un lanceur (plaque de gravité)
};

// Circuit au-dessus du vide (race.floor) : hors de la piste, il n'y a rien. Altitude « sol » d'une case vide.
export const VOID_Y = -1000;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ----------------------------------------------------------------------------- circuit
// Spline de Catmull-Rom (paramétrage centripète) fermée, rééchantillonnée à pas constant.
function crSegment(p0, p1, p2, p3, steps) {
  const d = (a, b) => Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1]));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const mix = (a, b, ta, tb, t) => {
    const k = tb === ta ? 0 : (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = t1 + ((t2 - t1) * i) / steps;
    const a1 = mix(p0, p1, t0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
    const b1 = mix(a1, a2, t0, t2, t), b2 = mix(a2, a3, t1, t3, t);
    out.push(mix(b1, b2, t1, t2, t));
  }
  return out;
}

export class Track {
  constructor(controls, ds = 1.5) {
    const n = controls.length;
    const dense = [];
    for (let i = 0; i < n; i++) {
      dense.push(...crSegment(controls[(i + n - 1) % n], controls[i], controls[(i + 1) % n], controls[(i + 2) % n], 48));
    }
    // longueur totale puis rééchantillonnage uniforme
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[dense.length];
    const N = Math.max(8, Math.round(total / ds));
    this.N = N;
    this.ds = total / N;
    this.length = total;
    this.xs = new Float64Array(N);
    this.zs = new Float64Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = i * this.ds;
      while (j + 1 < cum.length - 1 && cum[j + 1] < target) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const k = cum[j + 1] === cum[j] ? 0 : (target - cum[j]) / (cum[j + 1] - cum[j]);
      this.xs[i] = a[0] + (b[0] - a[0]) * k;
      this.zs[i] = a[1] + (b[1] - a[1]) * k;
    }
    this.tx = new Float64Array(N);
    this.tz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const dx = this.xs[(i + 1) % N] - this.xs[(i + N - 1) % N], dz = this.zs[(i + 1) % N] - this.zs[(i + N - 1) % N];
      const h = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / h;
      this.tz[i] = dz / h;
    }
  }

  // Point du circuit à l'abscisse s (mètres, modulo la longueur) : position et cap.
  at(s) {
    s = ((s % this.length) + this.length) % this.length;
    const f = s / this.ds, i = Math.floor(f) % this.N, k = f - Math.floor(f), j = (i + 1) % this.N;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * k, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * k;
    const h = Math.hypot(tx, tz) || 1;
    tx /= h;
    tz /= h;
    return { x: this.xs[i] + (this.xs[j] - this.xs[i]) * k, z: this.zs[i] + (this.zs[j] - this.zs[i]) * k, fx: tx, fz: tz, s };
  }

  // Échantillon le plus proche de (x, z). hint = indice proche (recherche locale ±win), sinon recherche complète.
  // Renvoie { i, s, lat (écart latéral signé), d (distance) }.
  nearest(x, z, hint = -1, win = 40) {
    let best = -1, bd = Infinity;
    const scan = (i) => {
      const dx = x - this.xs[i], dz = z - this.zs[i], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    };
    if (hint < 0) for (let i = 0; i < this.N; i++) scan(i);
    else for (let k = -win; k <= win; k++) scan((hint + k + this.N) % this.N);
    const lat = (x - this.xs[best]) * -this.tz[best] + (z - this.zs[best]) * this.tx[best];
    return { i: best, s: best * this.ds, lat, d: Math.sqrt(bd) };
  }

  // Points du tracé tous les `step` mètres (mini-carte, aperçu).
  points(step = 6) {
    const out = [];
    for (let s = 0; s < this.length; s += step) {
      const p = this.at(s);
      out.push([p.x, p.z]);
    }
    return out;
  }
}

// ----------------------------------------------------------------------------- construction
const place = (track, s, off = 0) => {
  const a = track.at(s);
  return { x: a.x - a.fz * off, z: a.z + a.fx * off, fx: a.fx, fz: a.fz, s };
};

// Bande de piste (circuit au-dessus du vide) : de s0 à s1, décalage `off` et largeur `w` varient en douceur
// de (off0, w0) à (off1, w1). Deux bandes qui se recouvrent forment une bifurcation, un trou entre elles est un vide.
export function stripAt(st, s) {
  const k = clamp((s - st.s0) / (st.s1 - st.s0 || 1), 0, 1), e = k * k * (3 - 2 * k);
  return { off: st.off0 + (st.off1 - st.off0) * e, w: st.w0 + (st.w1 - st.w0) * e };
}

// Tuile qui s'efface : présente pendant `up` ticks sur une période de `period`.
export const blinkUp = (b, clock) => (((clock + b.phase) % b.period) + b.period) % b.period < b.up;

// Sol d'un circuit au-dessus du vide : grille de cases de `cell` m (0 vide, 1 plein, 2+k tuile k), rastérisée
// une fois pour toutes à partir des bandes. Ce qu'on voit (ruban) est dessiné à partir des mêmes bandes.
function buildFloor(track, strips, blinks, solids, pad, deathY, elevAt) {
  const cell = 1;
  const pts = [];
  const eachSample = (fn) => {
    for (const st of strips) {
      for (let s = st.s0; ; s += 0.4) {
        const ss = Math.min(s, st.s1), p = track.at(ss), { off, w } = stripAt(st, ss);
        const n = Math.max(1, Math.ceil((w + 2 * pad) / 0.4));
        for (let j = 0; j <= n; j++) {
          const lat = off - w / 2 - pad + ((w + 2 * pad) * j) / n;
          fn(p.x - p.fz * lat, p.z + p.fx * lat, ss);
        }
        if (ss >= st.s1) break;
      }
    }
  };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  eachSample(grow);
  for (const r of solids) {
    const hl = r.len / 2 + 1, hw = r.w / 2 + 1;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) grow(r.x + r.fx * a * hl - r.fz * b * hw, r.z + r.fz * a * hl + r.fx * b * hw);
  }
  x0 = Math.floor(x0) - 2;
  z0 = Math.floor(z0) - 2;
  const nx = Math.ceil(x1 - x0) + 3, nz = Math.ceil(z1 - z0) + 3;
  const data = new Uint16Array(nx * nz);
  const hgt = new Float32Array(nx * nz).fill(NaN); // altitude du dessus du sol
  const idx = (x, z) => Math.floor((z - z0) / cell) * nx + Math.floor((x - x0) / cell);
  eachSample((x, z, ss) => { const c = idx(x, z); data[c] = 1; hgt[c] = elevAt(ss); });
  // rampes, plaques et lanceurs : toujours posés sur du solide (le sol ne se dérobe pas sous un tremplin)
  const stamp = (r, v, only = false) => {
    const R = Math.hypot(r.len, r.w) / 2 + 1;
    const hy = r.y ?? elevAt(r.s ?? track.nearest(r.x, r.z).s);
    for (let z = Math.floor(r.z - R); z <= r.z + R; z += cell) {
      for (let x = Math.floor(r.x - R); x <= r.x + R; x += cell) {
        const c = idx(x + cell / 2, z + cell / 2);
        if (!inRect(r, x + cell / 2, z + cell / 2)) continue;
        if (only && data[c] !== 1) continue;
        data[c] = v;
        if (Number.isNaN(hgt[c])) hgt[c] = hy;
      }
    }
  };
  for (const r of solids) stamp(r, 1);
  blinks.forEach((b, k) => stamp(b, 2 + k, true));
  // altitude hors du sol : on étale celle de la case pleine la plus proche sur 45 m (pente sous un char qui déborde,
  // inclinaison de la caisse sur un bord, hauteur de chute)
  let hmin = Infinity;
  let front = [];
  for (let c = 0; c < hgt.length; c++) if (!Number.isNaN(hgt[c])) { front.push(c); if (hgt[c] < hmin) hmin = hgt[c]; }
  for (let ring = 0; ring < 45 && front.length; ring++) {
    const next = [];
    for (const c of front) {
      const i = c % nx, j = (c - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a2 = i + di, b2 = j + dj;
        if (a2 < 0 || b2 < 0 || a2 >= nx || b2 >= nz) continue;
        const k = b2 * nx + a2;
        if (Number.isNaN(hgt[k])) { hgt[k] = hgt[c]; next.push(k); }
      }
    }
    front = next;
  }
  return { x0, z0, cell, nx, nz, data, hgt, hmin, blinks, deathY };
}

// Décrit un circuit complet. Voir shared/maps/course_colline.js pour un exemple.
// spec = { controls, width, startS, laps, cps:[s…], ramps, pads, mud, water, gates, sliders, bumpers }
// Circuit au-dessus du vide (voir shared/maps/course_neon.js) : en plus,
//   plates    plateformes libres (quais, tablier d'un saut)  strips    bandes de piste (stripAt) : hors d'elles, c'est le vide
//   blinks    tuiles qui s'effacent par intermittence      launch   lanceurs (plaques de gravité)
//   spinners  barres rotatives autour d'un pivot            rails    garde-fous le long d'un bord
//   blocks    plots fixes (chicanes)                        hollow   plages de s dont le ruban est remplacé par des tuiles
export function buildRace(spec) {
  const track = new Track(spec.controls);
  const W = spec.width;
  // position d'un objet : en repère piste (s, off) ou en coordonnées du monde (x, z, fx, fz)
  const at = (o) => (o.x !== undefined ? { x: o.x, z: o.z, fx: o.fx, fz: o.fz, s: track.nearest(o.x, o.z).s } : place(track, o.s, o.off ?? 0));
  const rect = (o, extra = {}) => ({ ...at(o), len: o.len, w: o.w, ...extra });
  const sec = (v) => Math.round(v * TICK_RATE);
  const voidMap = !!spec.strips;
  const strips = (spec.strips ?? []).map((o) => ({
    s0: Math.max(0, o.s0), s1: Math.min(o.s1, track.length), off0: o.off0 ?? o.off ?? 0, off1: o.off1 ?? o.off ?? 0, w0: o.w0 ?? o.w ?? W, w1: o.w1 ?? o.w ?? W,
  }));
  // bords extérieurs du sol à l'abscisse s (side = -1 : gauche, +1 : droite), ±Infinity s'il n'y a pas de piste
  const edgeAt = (s, side) => {
    let e = side < 0 ? Infinity : -Infinity;
    for (const st of strips) {
      if (s < st.s0 || s > st.s1) continue;
      const { off, w } = stripAt(st, s);
      e = side < 0 ? Math.min(e, off - w / 2) : Math.max(e, off + w / 2);
    }
    return e;
  };
  // zones praticables [bas, haut] (décalages latéraux) à l'abscisse s : sert aux robots pour choisir leur voie
  const spansAt = (s) => {
    const list = strips.filter((st) => s >= st.s0 && s <= st.s1).map((st) => {
      const { off, w } = stripAt(st, s);
      return [off - w / 2, off + w / 2];
    }).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const sp of list) {
      if (out.length && sp[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], sp[1]);
      else out.push(sp);
    }
    return out;
  };
  // profil d'altitude le long du circuit : [[s, hauteur], …] ; entre deux repères, une transition douce (plat à chaque repère)
  const keys = (spec.elev ?? []).slice().sort((a, b) => a[0] - b[0]);
  const elevAt = (s) => {
    if (!keys.length) return 0;
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (s <= keys[i][0]) {
        const [sa, ha] = keys[i - 1], [sb, hb] = keys[i], k = clamp((s - sa) / (sb - sa || 1), 0, 1);
        return ha + (hb - ha) * k * k * (3 - 2 * k);
      }
    }
    return keys[keys.length - 1][1];
  };
  const cpSpecs = [{ s: spec.startS, w: spec.startWidth }, ...spec.cps.map((c) => (typeof c === 'number' ? { s: c } : c))];
  const race = {
    track,
    width: W,
    length: track.length,
    laps: spec.laps ?? RACE_RULES.defaultLaps,
    startS: spec.startS,
    stuckTicks: sec(spec.stuckSeconds ?? 14), // un robot immobile plus longtemps que ça sans franchir de point de passage est ramené au dernier
    // le premier point (indice 0) est la ligne de départ / d'arrivée
    cps: cpSpecs.map((c, i) => {
      const w = c.w ?? spec.cpWidth ?? W;
      return {
        ...place(track, c.s), hw: w / 2 + (voidMap && c.w ? 1.5 : 3), i,
        safe: voidMap ? Math.max(0, w / 2 - 2.5) : Infinity, // décalage latéral maximal à la réapparition
      };
    }),
    ramps: (spec.ramps ?? []).map((o) => rect(o, { rise: o.rise })),
    pads: (spec.pads ?? []).map((o) => rect(o, { avoid: !!o.avoid })), // avoid : les robots n'y roulent pas (turbo qui mène au saut)
    mud: (spec.mud ?? []).map((o) => rect(o)),
    water: (spec.water ?? []).map((o) => rect(o)),
    launch: (spec.launch ?? []).map((o) => rect(o, { vy: o.vy ?? RACE_RULES.launchVy, kick: o.kick ?? 0 })),
    blinks: (spec.blinks ?? []).map((o) => rect(o, { period: sec(o.period ?? 4), up: sec(o.up ?? 2.4), phase: sec(o.phase ?? 0) })),
    spinners: (spec.spinners ?? []).map((o) => ({
      ...at(o), len: o.len ?? 30, thick: o.thick ?? 1.6, h: o.h ?? 2.2,
      period: sec(o.period ?? 7), phase: sec(o.phase ?? 0), dir: o.dir ?? 1,
    })),
    plates: spec.plates ?? [], // plateformes libres { x, z, fx, fz, len, w } (sol sans rapport avec le tracé : rampes de saut, quais)
    rails: spec.rails ?? [],
    blocks: (spec.blocks ?? []).map((o) => rect(o, { h: o.h ?? 2.4 })),
    hollow: spec.hollow ?? [],
    strips, edgeAt, spansAt, elevAt,
    bumpers: (spec.bumpers ?? []).map((o) => ({ ...at(o), r: o.r ?? 2.2 })),
    gates: (spec.gates ?? []).map((o) => {
      const open = sec(o.open ?? 4), closed = sec(o.closed ?? 3), slide = sec(o.slide ?? 0.8);
      return {
        ...place(track, o.s, o.off ?? 0), hw: o.hw ?? W / 2 + 2, thick: 1.8, h: 3.2,
        open, closed, slide, period: open + closed + 2 * slide, phase: sec(o.phase ?? 0),
      };
    }),
    sliders: (spec.sliders ?? []).map((o) => ({
      ...place(track, o.s, o.off ?? 0), off: o.off ?? 0, amp: o.amp ?? W / 2 - 4, len: o.len ?? 9, thick: o.thick ?? 2.6, h: 2.6,
      period: sec(o.period ?? 6), phase: sec(o.phase ?? 0),
    })),
  };
  // grille de départ : deux colonnes décalées, derrière la ligne
  race.grid = (i) => {
    const p = place(track, spec.startS - 12 - Math.floor(i / 2) * 9.5 - (i % 2) * 3.5, (i % 2 ? 1 : -1) * 5.5);
    return { x: p.x, z: p.z, yaw: Math.atan2(p.fx, p.fz) };
  };
  // point de réapparition au point de contrôle i (lat = décalage latéral pour ne pas empiler les chars)
  race.respawnAt = (cp, lat = 0) => {
    const c = race.cps[cp];
    lat = clamp(lat, -c.safe, c.safe); // sur un pont étroit, on ne réapparaît pas dans le vide
    const x = c.x - c.fz * lat, z = c.z + c.fx * lat;
    return { x, z, yaw: Math.atan2(c.fx, c.fz) };
  };

  // obstacles fixes d'un circuit au-dessus du vide : garde-fous et plots, sous forme de boîtes orientées (cf. dynBoxes)
  race.walls = [];
  for (const r of race.rails) {
    const step = 3;
    for (let s = r.s0 + step / 2; s < r.s1; s += step) {
      const e = edgeAt(s, r.side);
      if (!Number.isFinite(e)) continue;
      const p = place(track, s, e - r.side * 0.55);
      race.walls.push({ x: p.x, z: p.z, fx: -p.fz, fz: p.fx, hu: 0.4, hv: step / 2 + 0.15, h: 1.35, br: step / 2 + 0.6 });
    }
  }
  for (const b of race.blocks) race.walls.push({ x: b.x, z: b.z, fx: b.fx, fz: b.fz, hu: b.len / 2, hv: b.w / 2, h: b.h, br: Math.hypot(b.len, b.w) / 2 });

  if (voidMap) {
    // tout ce qui doit reposer sur du solide : tremplins, plaques, lanceurs, plots
    race.floor = buildFloor(track, strips, race.blinks, [...race.ramps, ...race.pads, ...race.launch, ...race.plates, ...race.blocks], spec.floorPad ?? 0.25, spec.deathDepth ?? 17, elevAt);
  }
  return race;
}

// Le point (x, z) repose-t-il sur du sol à l'instant `clock` ? (circuit au-dessus du vide ; toujours vrai ailleurs)
export function solidAt(race, x, z, clock = 0) {
  const f = race.floor;
  if (!f) return true;
  const i = Math.floor((x - f.x0) / f.cell), j = Math.floor((z - f.z0) / f.cell);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return false;
  const v = f.data[j * f.nx + i];
  return v < 2 ? v === 1 : blinkUp(f.blinks[v - 2], clock);
}

// Altitude du sol de course en (x, z) (interpolée entre les cases ; prolongée hors du sol par la case pleine la plus proche).
export function floorHeight(race, x, z) {
  const f = race.floor;
  const out = f.hmin - 30;
  const gx = (x - f.x0) / f.cell - 0.5, gz = (z - f.z0) / f.cell - 0.5;
  const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
  const v = (a, b) => {
    if (a < 0 || b < 0 || a >= f.nx || b >= f.nz) return out;
    const h = f.hgt[b * f.nx + a];
    return Number.isNaN(h) ? out : h;
  };
  const top = v(i, j) * (1 - tx) + v(i + 1, j) * tx, bot = v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx;
  return top * (1 - tz) + bot * tz;
}

// Lanceur sous le char, ou null.
export function launchAt(race, x, z) {
  for (const r of race.launch) if (inRect(r, x, z)) return r;
  return null;
}

// ----------------------------------------------------------------------------- géométrie orientée
export function inRect(r, x, z, margin = 0) {
  const dx = x - r.x, dz = z - r.z;
  const u = dx * r.fx + dz * r.fz, v = -dx * r.fz + dz * r.fx;
  return Math.abs(u) <= r.len / 2 + margin && Math.abs(v) <= r.w / 2 + margin;
}

// Hauteur ajoutée par les rampes en (x, z) (0 hors rampe). La pente monte dans le sens du cap, puis c'est le vide.
export function rampHeight(race, x, z) {
  let best = 0;
  for (const r of race.ramps) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > (r.len + r.w) * (r.len + r.w) / 4) continue;
    const u = dx * r.fx + dz * r.fz, v = -dx * r.fz + dz * r.fx;
    if (u < -r.len / 2 || u > r.len / 2 || Math.abs(v) > r.w / 2) continue;
    const h = (r.rise * (u + r.len / 2)) / r.len;
    if (h > best) best = h;
  }
  return best;
}

export const SURF_MUD = 1, SURF_PAD = 2, SURF_WATER = 4;
export function surfaceAt(race, x, z) {
  let s = 0;
  for (const r of race.mud) if (inRect(r, x, z)) { s |= SURF_MUD; break; }
  for (const r of race.pads) if (inRect(r, x, z)) { s |= SURF_PAD; break; }
  for (const r of race.water) if (inRect(r, x, z)) { s |= SURF_WATER; break; }
  return s;
}

// ----------------------------------------------------------------------------- obstacles mobiles
// Ouverture d'une porte à l'instant `clock` (ticks depuis le feu vert) : 1 ouverte, 0 fermée.
export function gateOpenness(g, clock) {
  const c = ((clock + g.phase) % g.period + g.period) % g.period;
  if (c < g.open) return 1;
  if (c < g.open + g.slide) return 1 - (c - g.open) / g.slide;
  if (c < g.open + g.slide + g.closed) return 0;
  return (c - g.open - g.slide - g.closed) / g.slide;
}

// Ticks avant que la porte ne change d'état (pour le feu : vert, orange, rouge) et état actuel.
export function gateInfo(g, clock) {
  const c = ((clock + g.phase) % g.period + g.period) % g.period;
  const o = gateOpenness(g, clock);
  let state, left;
  if (c < g.open) { state = 'open'; left = g.open - c; }
  else if (c < g.open + g.slide) { state = 'closing'; left = g.open + g.slide - c; }
  else if (c < g.open + g.slide + g.closed) { state = 'closed'; left = g.open + g.slide + g.closed - c; }
  else { state = 'opening'; left = g.period - c; }
  return { o, state, left };
}

// Décalage latéral d'une barre mobile à l'instant `clock`.
export const sliderOffset = (s, clock) => s.amp * Math.sin((TAU * (clock + s.phase)) / s.period);

// Angle d'une barre rotative (rad) : la barre est le segment qui passe par le pivot, de direction (-sin a, cos a).
export const spinnerAngle = (sp, clock) => (TAU * (clock + sp.phase) * sp.dir) / sp.period;

// Boîtes orientées solides à l'instant `clock` : { x, z, fx, fz, hu, hv, h } (demi-épaisseur le long du cap, demi-longueur en travers).
const dynCache = new WeakMap();
export function dynBoxes(race, clock) {
  const c = Math.floor(clock);
  const hit = dynCache.get(race);
  if (hit && hit.clock === c) return hit.list;
  const list = [];
  for (const g of race.gates) {
    const e = 1 - gateOpenness(g, c);
    if (e < 0.02) continue;
    for (const side of [-1, 1]) {
      const lat = side * (g.hw - (e * g.hw) / 2);
      list.push({ x: g.x - g.fz * lat, z: g.z + g.fx * lat, fx: g.fx, fz: g.fz, hu: g.thick / 2, hv: (e * g.hw) / 2, h: g.h });
    }
  }
  for (const s of race.sliders) {
    const lat = sliderOffset(s, c);
    list.push({ x: s.x - s.fz * lat, z: s.z + s.fx * lat, fx: s.fx, fz: s.fz, hu: s.thick / 2, hv: s.len / 2, h: s.h });
  }
  for (const sp of race.spinners) {
    const a = spinnerAngle(sp, c);
    list.push({ x: sp.x, z: sp.z, fx: Math.cos(a), fz: Math.sin(a), hu: sp.thick / 2, hv: sp.len / 2, h: sp.h, br: sp.len / 2 + sp.thick });
  }
  for (const w of race.walls) list.push(w);
  dynCache.set(race, { clock: c, list });
  return list;
}

// Repousse un disque (p.x, p.z, rayon r) hors d'une boîte orientée. Renvoie true s'il y a eu contact.
export function collideOBB(p, r, b) {
  const dx = p.x - b.x, dz = p.z - b.z;
  const u = dx * b.fx + dz * b.fz, v = -dx * b.fz + dz * b.fx;
  const cu = clamp(u, -b.hu, b.hu), cv = clamp(v, -b.hv, b.hv);
  const ou = u - cu, ov = v - cv, d2 = ou * ou + ov * ov;
  if (d2 >= r * r) return false;
  let pu, pv;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    pu = ou * k;
    pv = ov * k;
  } else if (b.hu - Math.abs(u) < b.hv - Math.abs(v)) {
    pu = (u < 0 ? -1 : 1) * (b.hu + r) - u;
    pv = 0;
  } else {
    pu = 0;
    pv = (v < 0 ? -1 : 1) * (b.hv + r) - v;
  }
  p.x += pu * b.fx - pv * b.fz;
  p.z += pu * b.fz + pv * b.fx;
  return true;
}

// ----------------------------------------------------------------------------- chars en course
// En course, les chars sont resserrés autour d'une vitesse commune : sans cela le Bastion (25 km/h)
// n'aurait aucune chance face au Lynx (65 km/h). La différence de gabarit passe par le poids (poussée
// des tirs, enlisement dans la boue) et par la maniabilité.
const raceDefs = new WeakMap();
export function raceDef(def) {
  let d = raceDefs.get(def);
  if (d) return d;
  d = {
    ...def,
    maxSpeed: 13.4 + (def.maxSpeed - 12.2) * 0.5,
    reverseSpeed: def.reverseSpeed,
    accel: 9 + (def.accel - 12) * 0.38,
    brake: 20 + (def.brake - 22) * 0.4,
    turnRate: 1.75 + (def.turnRate - 1.8) * 0.5,
  };
  raceDefs.set(def, d);
  return d;
}

// Vitesse conservée dans la boue : un char léger s'y enlise beaucoup plus qu'un lourd.
export const mudFactor = (def) => clamp(0.42 + (def.weight ?? 30) * 0.006, 0.45, 0.78);

// Vitesse de poussée (m/s) d'un obus de `damage` points sur un char de poids `weight` (tonnes).
export const pushSpeed = (damage, weight) => Math.min(RACE_RULES.maxKnock, (damage / Math.max(8, weight ?? 30)) * RACE_RULES.pushScale);

// Réglages de la course d'une carte ou null.
export const raceOf = (map) => map?.race ?? null;

// Temps laissé aux autres pour finir une fois le premier arrivé (ticks).
export const finishGrace = (firstFinishTicks) => Math.max(RACE_RULES.finishGraceTicks, Math.round(firstFinishTicks * 0.4));

// Couleurs d'identification des pilotes (une par place sur la grille) : nombre pour la 3D, texte pour l'interface.
export const RACE_COLORS = [
  [0xe2604f, '#e2604f'], [0x4f95e2, '#4f95e2'], [0x9ccf4a, '#9ccf4a'], [0xf5b312, '#f5b312'],
  [0xb06be0, '#b06be0'], [0x37d6d0, '#37d6d0'], [0xf08ac0, '#f08ac0'], [0xe9e5d3, '#e9e5d3'],
];
export const raceColor = (index) => RACE_COLORS[((index % RACE_COLORS.length) + RACE_COLORS.length) % RACE_COLORS.length];
