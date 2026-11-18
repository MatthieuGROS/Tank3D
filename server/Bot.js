// Bots : joueurs pilotés par le serveur. Ils produisent les mêmes commandes qu'un humain
// (f, t, tt, fire) et passent par la même simulation : aucun passe-droit.
//
// NavGrid : grille de navigation de la carte + recherche de chemin A*.
// BotBrain : choix d'objectif, conduite le long du chemin, visée et tir.
import { TICK_RATE } from '../shared/constants.js';
import { collideCircle, marchRay, heightAt } from '../shared/map.js';
import { angleDiff, clamp } from '../shared/tank.js';

const CELL = 2; // taille d'une case, en mètres
const SQRT2 = Math.SQRT2;

export class NavGrid {
  constructor(map, radius) {
    this.map = map;
    this.w = Math.ceil((map.halfX * 2) / CELL);
    this.h = Math.ceil((map.halfZ * 2) / CELL);
    this.blocked = new Uint8Array(this.w * this.h);
    const p = { x: 0, z: 0 };
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        p.x = this.cx(ix);
        p.z = this.cz(iz);
        // une case est libre si un char (avec une petite marge) y tient sans toucher le décor
        this.blocked[iz * this.w + ix] = collideCircle(p, radius + 0.4, map) ? 1 : 0;
      }
    }
    this.g = new Float32Array(this.w * this.h);
    this.from = new Int32Array(this.w * this.h);
    this.state = new Uint8Array(this.w * this.h);
  }

  cx(ix) { return -this.map.halfX + (ix + 0.5) * CELL; }
  cz(iz) { return -this.map.halfZ + (iz + 0.5) * CELL; }
  ix(x) { return clamp(Math.floor((x + this.map.halfX) / CELL), 0, this.w - 1); }
  iz(z) { return clamp(Math.floor((z + this.map.halfZ) / CELL), 0, this.h - 1); }

  isFree(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && !this.blocked[iz * this.w + ix];
  }

  // Case libre la plus proche d'un point (recherche en anneaux).
  nearestFree(x, z) {
    const ix = this.ix(x), iz = this.iz(z);
    for (let r = 0; r < 8; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) === r && this.isFree(ix + dx, iz + dz)) return (iz + dz) * this.w + ix + dx;
        }
      }
    }
    return -1;
  }

  // Peut-on rouler en ligne droite entre deux points ?
  walkable(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.isFree(this.ix(x0 + (x1 - x0) * t), this.iz(z0 + (z1 - z0) * t))) return false;
    }
    return true;
  }

  // A* sur 8 directions. Renvoie une liste de points {x, z}, ou [] si aucun chemin.
  path(sx, sz, gx, gz) {
    const start = this.nearestFree(sx, sz), goal = this.nearestFree(gx, gz);
    if (start < 0 || goal < 0) return [];
    const { w, g, from, state } = this;
    state.fill(0);
    const gxi = goal % w, gzi = (goal / w) | 0;
    const h = (i) => {
      const dx = Math.abs((i % w) - gxi), dz = Math.abs(((i / w) | 0) - gzi);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    const heap = [];
    const push = (i, f) => {
      let k = heap.length;
      heap.push([f, i]);
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (heap[parent][0] <= heap[k][0]) break;
        [heap[parent], heap[k]] = [heap[k], heap[parent]];
        k = parent;
      }
    };
    const pop = () => {
      const top = heap[0], lastItem = heap.pop();
      if (heap.length) {
        heap[0] = lastItem;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top[1];
    };

    g[start] = 0;
    from[start] = -1;
    state[start] = 1;
    push(start, h(start));
    while (heap.length) {
      const cur = pop();
      if (state[cur] === 2) continue;
      state[cur] = 2;
      if (cur === goal) break;
      const cxi = cur % w, czi = (cur / w) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cxi + dx, nz = czi + dz;
          if (!this.isFree(nx, nz)) continue;
          // pas de diagonale qui rase un coin d'obstacle
          if (dx && dz && (!this.isFree(cxi + dx, czi) || !this.isFree(cxi, czi + dz))) continue;
          const n = nz * w + nx;
          if (state[n] === 2) continue;
          const cost = g[cur] + (dx && dz ? SQRT2 : 1);
          if (state[n] === 1 && cost >= g[n]) continue;
          g[n] = cost;
          from[n] = cur;
          state[n] = 1;
          push(n, cost + h(n));
        }
      }
    }
    if (state[goal] !== 2) return [];
    const out = [];
    for (let i = goal; i !== -1; i = from[i]) out.push({ x: this.cx(i % w), z: this.cz((i / w) | 0) });
    return out.reverse();
  }
}

const rand = (a, b) => a + Math.random() * (b - a);
const REPATH_TICKS = 30;
const REACTION_TICKS = 0.45 * TICK_RATE; // temps entre « je te vois » et « je tire »
const AIM_ERROR = 0.045; // rad : imprécision de visée, retirée régulièrement

export class BotBrain {
  constructor() {
    this.role = Math.random() < 0.5 ? 'capture' : 'hunt';
    this.reset();
  }

  // Appelé à chaque début de manche.
  reset() {
    this.path = [];
    this.repath = Math.floor(rand(0, REPATH_TICKS));
    this.zoneOffset = { a: rand(0, Math.PI * 2), d: rand(0, 0.6) };
    this.stuck = 0;
    this.escape = 0;
    this.escapeTurn = 1;
    this.seen = 0;
    this.aimError = 0;
    this.aimTimer = 0;
  }

  // Renvoie la commande du tick pour le joueur-bot `p`.
  think(p, room, nav, def) {
    const me = p.tank, map = room.map;
    const cmd = { f: 0, t: 0, tt: 0, fire: false };

    // --- perception : ennemi détecté le plus proche, et le plus proche en vue directe
    // (un ennemi non détecté par l'équipe est invisible, pour les bots comme pour les joueurs)
    let nearest = null, nearestD = Infinity, target = null, targetD = Infinity;
    for (const o of room.roundPlayers()) {
      if (!o.alive || o.team === p.team || !o.spotted) continue;
      const dx = o.tank.x - me.x, dz = o.tank.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d < nearestD) { nearestD = d; nearest = o; }
      if (d < targetD && d < 75) {
        // relief : la ligne de tir part de l'altitude du canon et monte / descend vers la cible
        const oy = map.hills ? heightAt(me.x, me.z, map) + def.muzzleHeight : def.muzzleHeight;
        const dy = map.hills ? (heightAt(o.tank.x, o.tank.z, map) + 1 - oy) / d : 0;
        const clear = d < 5 || marchRay(me.x, oy, me.z, dx / d, dy, dz / d, d - 2.5, 1, map) >= d - 2.5;
        if (clear) { targetD = d; target = o; }
      }
    }

    // --- tourelle et tir
    if (target) {
      this.seen++;
      if (--this.aimTimer <= 0) {
        this.aimTimer = 40;
        this.aimError = rand(-AIM_ERROR, AIM_ERROR);
      }
      // on vise là où la cible sera quand l'obus arrivera
      const lead = targetD / def.shellSpeed;
      const tx = target.tank.x + Math.sin(target.tank.yaw) * target.tank.speed * lead;
      const tz = target.tank.z + Math.cos(target.tank.yaw) * target.tank.speed * lead;
      const diff = angleDiff(me.ty, Math.atan2(tx - me.x, tz - me.z) + this.aimError);
      cmd.tt = clamp(diff * 8, -1, 1);
      cmd.fire = this.seen > REACTION_TICKS && Math.abs(diff) < 0.03;
    } else {
      this.seen = 0;
      cmd.tt = clamp(angleDiff(me.ty, me.yaw) * 3, -1, 1); // tourelle dans l'axe de marche
    }

    // --- objectif
    const zone = map.zone;
    const enemyCapturing = room.zone.team && room.zone.team !== p.team && room.zone.progress > 0.35;
    let gx, gz, hold = false;
    if (this.role === 'capture' || !nearest || enemyCapturing) {
      gx = zone.x + Math.cos(this.zoneOffset.a) * zone.r * this.zoneOffset.d;
      gz = zone.z + Math.sin(this.zoneOffset.a) * zone.r * this.zoneOffset.d;
    } else {
      gx = nearest.tank.x;
      gz = nearest.tank.z;
      hold = !!target && targetD < 32; // à portée et en vue : on s'arrête pour tirer
    }

    // --- chemin
    if (--this.repath <= 0) {
      this.repath = REPATH_TICKS;
      this.path = nav.path(me.x, me.z, gx, gz);
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - me.x, this.path[0].z - me.z) < 2.5) this.path.shift();
    // on coupe les virages : on vise le point le plus lointain du chemin atteignable en ligne droite
    let wp = this.path[0];
    for (let i = Math.min(this.path.length - 1, 7); i > 0; i--) {
      if (nav.walkable(me.x, me.z, this.path[i].x, this.path[i].z)) {
        wp = this.path[i];
        break;
      }
    }

    // --- conduite
    if (this.escape > 0) {
      this.escape--;
      cmd.f = -1;
      cmd.t = this.escapeTurn;
    } else if (wp && !hold && Math.hypot(gx - me.x, gz - me.z) > 2.5) {
      const diff = angleDiff(me.yaw, Math.atan2(wp.x - me.x, wp.z - me.z));
      const off = Math.abs(diff);
      cmd.t = clamp(diff * 2.5, -1, 1);
      cmd.f = off < 0.5 ? 1 : off < 1.2 ? 0.45 : 0;
      // coincé (souvent contre un autre char) : petite marche arrière en tournant
      this.stuck = cmd.f > 0 && Math.abs(me.speed) < 0.6 && room.phase === 'playing' ? this.stuck + 1 : 0;
      if (this.stuck > 50) {
        this.stuck = 0;
        this.escape = 45;
        this.escapeTurn = Math.random() < 0.5 ? 1 : -1;
        this.repath = 0;
      }
    }
    return cmd;
  }
}
