// IA des unités de campagne : chars ennemis, tourelles, mortiers, boss et alliés pilotés.
// Comme les bots d'escarmouche, elles produisent des commandes (f, t, tt, fire) qui passent
// par la même simulation que les joueurs. Seuls les mortiers ont un point de visée en plus.
//
// Comportements (`mode`) :
//   static   ne bouge pas (tourelles, structures, Citadelle)
//   guard    tient sa position et tire ; part à l'assaut si on l'approche ou le touche
//   assault  cherche le contact, s'arrête à portée pour tirer en se déportant un peu
//   ally     comme assault, mais rejoint l'objectif (zone) quand il n'y a personne à combattre
import { TICK_RATE } from '../shared/constants.js';
import { marchRay } from '../shared/map.js';
import { angleDiff, clamp, SHELL_FLIGHT_Y } from '../shared/tank.js';

const rand = (a, b) => a + Math.random() * (b - a);
const REPATH_TICKS = 30;
const SCAN_TICKS = 6;
const AGGRO = 50; // un garde se réveille si un ennemi passe à moins de 50 m en vue directe
const PROVOKE_TICKS = 12 * TICK_RATE; // le tireur reste repéré 12 s après son dernier impact

export class UnitBrain {
  // skill = { reaction (s), aim (rad) }
  constructor({ mode = 'assault', home, skill }) {
    this.mode = mode;
    this.home = home;
    this.skill = skill;
    this.awake = mode === 'assault' || mode === 'ally';
    this.path = [];
    this.repath = Math.floor(rand(0, REPATH_TICKS));
    this.scan = Math.floor(rand(0, SCAN_TICKS));
    this.target = null;
    this.visible = false;
    this.seen = 0;
    this.aimError = 0;
    this.aimTimer = 0;
    this.stuck = 0;
    this.escape = 0;
    this.escapeTurn = 1;
    this.jink = 0;
    this.jinkF = 0;
    this.lastKnown = null;
  }

  // Touché : un garde part à l'assaut, et le tireur devient une cible même au-delà de la portée de vue
  // (sinon on pourrait abattre un boss ou la Citadelle de l'autre bout de la carte sans qu'ils réagissent).
  alert(byId, tick) {
    if (this.mode === 'guard') this.awake = true;
    if (byId != null) this.provoked = { id: byId, until: tick + PROVOKE_TICKS };
  }

  // Cible : l'ennemi le plus « intéressant » (proche, en vue, de préférence pas un bâtiment).
  pick(p, room, def) {
    const me = p.tank, map = room.map;
    const mortar = def.weapon === 'mortar';
    let best = null, bestScore = Infinity, bestVisible = false, nearest = null, nearestD = Infinity;
    if (this.provoked && room.tick > this.provoked.until) this.provoked = null;
    // portée des obus : un tireur qui nous touche de plus loin que la vue reste à portée de riposte
    const maxReach = mortar ? def.range ?? 80 : Math.max(def.range ?? 80, (def.shellSpeed * def.shellLifeTicks) / TICK_RATE - 5);
    for (const o of room.roundPlayers()) {
      if (!o.alive || o.team === p.team) continue;
      const odef = room.defOf(o);
      const dx = o.tank.x - me.x, dz = o.tank.z - me.z;
      const d = Math.hypot(dx, dz);
      if (!odef.structure && d < nearestD) { nearestD = d; nearest = o; }
      const provoker = this.provoked?.id === o.id;
      if (d > (provoker ? maxReach : def.range ?? 80)) continue;
      if (mortar && d < def.minRange) continue;
      const reach = d - odef.radius * 0.6;
      const clear = d < 5 || marchRay(me.x, SHELL_FLIGHT_Y + 0.1, me.z, dx / d, 0, dz / d, reach, 1, map) >= reach;
      // un mortier tire sans voir, mais seulement sur une cible assez proche (repérée)
      if (!clear && !(mortar && d < 75)) continue;
      const shielded = room.campaign?.isShielded(o) ? 200 : 0; // inutile de tirer sur un bouclier
      // les alliés pilotés visent d'abord les objectifs de la mission (dépôts, usines, générateurs)
      const objective = this.mode === 'ally' && (o.obj || o.tag === 'gen') ? -45 : 0;
      const score = d + (odef.structure ? 35 : 0) + (odef.static ? 10 : 0) + (clear ? 0 : 20) + shielded + objective - (provoker ? 40 : 0);
      if (score < bestScore) { bestScore = score; best = o; bestVisible = clear; }
    }
    // un garde se réveille dès qu'un ennemi est proche et visible
    if (!this.awake && best && bestVisible && Math.hypot(best.tank.x - me.x, best.tank.z - me.z) < AGGRO) this.awake = true;
    if (best !== this.target) this.seen = 0;
    this.target = best;
    this.visible = !!best;
    this.nearest = nearest;
    if (best) this.lastKnown = { x: best.tank.x, z: best.tank.z };
  }

  think(p, room, def) {
    const me = p.tank;
    const cmd = { f: 0, t: 0, tt: 0, fire: false };
    if (def.weapon === null) {
      cmd.tt = 0.25; // structure : antenne / rotor qui tourne doucement
      return cmd;
    }
    if (--this.scan <= 0) {
      this.scan = SCAN_TICKS;
      this.pick(p, room, def);
    }
    if (this.target && !this.target.alive) this.target = null;

    // --- tourelle et tir
    const target = this.target;
    let targetD = Infinity;
    if (target) {
      const t = target.tank;
      targetD = Math.hypot(t.x - me.x, t.z - me.z);
      this.seen++;
      if (--this.aimTimer <= 0) {
        this.aimTimer = 40;
        this.aimError = rand(-this.skill.aim, this.skill.aim);
        // anticipation imparfaite : sans `lead` (alliés), elle reste parfaite
        const lead = this.skill.lead ?? 1;
        this.leadFactor = lead >= 1 ? 1 : clamp(lead + rand(-0.3, 0.3), 0, 1);
      }
      const flight = (def.weapon === 'mortar' ? def.flightTicks / TICK_RATE : targetD / def.shellSpeed) * (this.leadFactor ?? 1);
      const tx = t.x + Math.sin(t.yaw) * t.speed * flight;
      const tz = t.z + Math.cos(t.yaw) * t.speed * flight;
      const diff = angleDiff(me.ty, Math.atan2(tx - me.x, tz - me.z) + this.aimError);
      cmd.tt = clamp(diff * 8, -1, 1);
      const ready = this.seen > this.skill.reaction * TICK_RATE;
      if (def.weapon === 'mortar') {
        const spread = 1.5 + this.skill.aim * 40;
        p.aimPoint = { x: tx + rand(-spread, spread), z: tz + rand(-spread, spread) };
        cmd.fire = ready && Math.abs(diff) < 0.12;
      } else {
        const tol = clamp(Math.atan2(room.defOf(target).radius * 0.8, targetD), 0.02, 0.2);
        cmd.fire = ready && Math.abs(diff) < tol + (def.burst ? 0.05 : 0);
      }
    } else {
      this.seen = 0;
      // personne en vue : les unités mobiles regardent devant elles, les fixes balaient le secteur
      cmd.tt = def.static ? 0.15 * Math.sin(room.tick * 0.01 + p.id) : clamp(angleDiff(me.ty, me.yaw) * 3, -1, 1);
    }

    if (def.static || this.mode === 'static' || !this.awake) return cmd;

    // allié sous un obus de mortier annoncé : il sort du cercle d'impact
    if (this.mode === 'ally') {
      for (const s of room.shells) {
        if (!s.arc || s.team === p.team || s.T - s.t > 70) continue;
        const dx = s.tx - me.x, dz = s.tz - me.z;
        if (dx * dx + dz * dz > (s.splash + 1.5) ** 2) continue;
        const ahead = dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw) > 0;
        cmd.f = ahead ? -1 : 1;
        cmd.t = (dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw) > 0 ? 1 : -1) * 0.6;
        return cmd;
      }
    }

    // --- destination
    let gx, gz, hold = false;
    const holdRange = def.holdRange ?? (def.maxSpeed > 12 ? 26 : 34);
    const goal = this.mode === 'ally' ? room.campaign?.allyGoal(p) : null;
    // allié bien entamé : il va chercher une trousse de réparation proche
    const repair = this.mode === 'ally' && p.hp < p.maxHp * 0.5 ? room.campaign?.nearestPickup(me.x, me.z, 'repair', 50) : null;
    if (repair) {
      gx = repair.x;
      gz = repair.z;
    } else if (target && targetD < holdRange) {
      hold = true;
    } else if (target && (!goal || targetD < 45)) {
      gx = target.tank.x;
      gz = target.tank.z;
    } else if (goal) {
      gx = goal.x;
      gz = goal.z;
      if (Math.hypot(gx - me.x, gz - me.z) < goal.r) hold = true;
    } else if (this.nearest) {
      gx = this.nearest.tank.x;
      gz = this.nearest.tank.z;
    } else if (this.lastKnown) {
      gx = this.lastKnown.x;
      gz = this.lastKnown.z;
    } else {
      hold = true;
    }

    // --- en position : on se déporte de temps en temps pour ne pas être une cible fixe
    if (hold) {
      if (--this.jink <= 0) {
        this.jink = Math.floor(rand(50, 110));
        this.jinkF = Math.random() < 0.45 ? 0 : Math.random() < 0.5 ? 0.7 : -0.6;
      }
      if (this.escape > 0) {
        this.escape--;
        cmd.f = -1;
        cmd.t = this.escapeTurn;
      } else {
        cmd.f = this.jinkF;
        // caisse de biais vers la cible : présente le blindage avant, gêne la visée adverse
        if (target) cmd.t = clamp(angleDiff(me.yaw, Math.atan2(target.tank.x - me.x, target.tank.z - me.z) + 0.5) * 2, -1, 1);
      }
      return cmd;
    }

    // --- chemin
    const nav = room.navFor(def.radius);
    if (--this.repath <= 0 || !this.path.length) {
      this.repath = REPATH_TICKS + Math.floor(rand(0, 10));
      this.path = nav.path(me.x, me.z, gx, gz);
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - me.x, this.path[0].z - me.z) < 2.5) this.path.shift();
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
    } else if (wp) {
      const diff = angleDiff(me.yaw, Math.atan2(wp.x - me.x, wp.z - me.z));
      const off = Math.abs(diff);
      cmd.t = clamp(diff * 2.5, -1, 1);
      cmd.f = off < 0.5 ? 1 : off < 1.2 ? 0.45 : 0;
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
