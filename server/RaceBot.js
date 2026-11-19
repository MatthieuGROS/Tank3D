// Pilote automatique du mode course : suit le circuit, freine pour les portes fermées, évite de se jeter
// à l'eau, et tire sur les rivaux qu'il a devant lui. Même interface que les autres cerveaux : think() renvoie
// la commande du tick.
import { angleDiff, clamp } from '../shared/tank.js';
import { gateOpenness, raceDef, sliderOffset, solidAt } from '../shared/race.js';
import { TICK_RATE } from '../shared/constants.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class RaceBrain {
  constructor() {
    this.hint = -1; // indice du circuit le plus proche (recherche locale)
    this.lane = rand(-5, 5); // couloir préféré (décalage latéral)
    this.skill = rand(0.88, 1); // vitesse de croisière relative
    this.aimTimer = 0;
    this.aimError = 0;
    this.stuck = 0;
    this.escape = 0;
    this.escapeTurn = 1;
    this.seen = 0;
    this.fork = Math.random(); // circuit au-dessus du vide : voie préférée aux fourches (0 = gauche, 1 = droite)
  }

  reset() {
    this.hint = -1;
    this.stuck = 0;
    this.escape = 0;
    this.seen = 0;
  }

  think(p, room, def) {
    const me = p.tank, race = room.baseMap.race, track = race.track;
    const cmd = { f: 0, t: 0, tt: 0, fire: false };
    if (!race) return cmd;
    const clock = room.race.clock;
    let near = track.nearest(me.x, me.z, this.hint, 45);
    if (near.d > 16) near = track.nearest(me.x, me.z, -1); // perdu (saut, projection) : on cherche sur tout le circuit
    this.hint = near.i;
    const s = near.s, speed = Math.abs(me.speed);

    // --- tir : le rival le plus proche, devant, à portée
    let target = null, targetD = 42;
    for (const o of room.roundPlayers()) {
      if (o === p || !o.alive) continue;
      const dx = o.tank.x - me.x, dz = o.tank.z - me.z, d = Math.hypot(dx, dz);
      if (d < targetD && Math.abs(angleDiff(me.yaw, Math.atan2(dx, dz))) < 1.1) { target = o; targetD = d; }
    }
    if (target && !me.air) {
      this.seen++;
      if (--this.aimTimer <= 0) {
        this.aimTimer = 45;
        this.aimError = rand(-0.05, 0.05);
      }
      const lead = targetD / def.shellSpeed;
      const tx = target.tank.x + Math.sin(target.tank.yaw) * target.tank.speed * lead;
      const tz = target.tank.z + Math.cos(target.tank.yaw) * target.tank.speed * lead;
      const diff = angleDiff(me.ty, Math.atan2(tx - me.x, tz - me.z) + this.aimError);
      cmd.tt = clamp(diff * 7, -1, 1);
      cmd.fire = clock > 5 * TICK_RATE && this.seen > 40 && Math.abs(diff) < 0.04 && Math.random() < 0.2; // pas de tir pendant le départ
    } else {
      this.seen = 0;
      cmd.tt = clamp(angleDiff(me.ty, me.yaw) * 3, -1, 1);
    }

    // --- cap : point du circuit situé devant, dans le couloir choisi (au centre près d'un tremplin ou d'un tapis)
    if (me.air) return cmd; // en vol on ne pilote plus
    // sur le quai d'un raccourci (hors du tracé) : on fonce vers le lanceur plutôt que de tomber dans le virage
    if (near.d > 12 && race.launch.length) {
      const L = race.launch.find((l) => (l.x - me.x) * Math.sin(me.yaw) + (l.z - me.z) * Math.cos(me.yaw) > 0 && Math.hypot(l.x - me.x, l.z - me.z) < 70);
      if (L) {
        cmd.f = 1;
        cmd.t = clamp(angleDiff(me.yaw, Math.atan2(L.x - me.x, L.z - me.z)) * 3, -1, 1);
        return cmd;
      }
    }
    // virage serré devant (angle parcouru sur les 26 m qui viennent) : on regarde moins loin, sinon on coupe l'intérieur du virage
    const hd = (ss) => { const q = track.at(ss); return Math.atan2(q.fx, q.fz); };
    const curve = Math.abs(angleDiff(hd(s + 6), hd(s + 32)));
    const look = clamp((11 + speed * 0.9) / (1 + curve * 2.4), 6.5, 11 + speed * 0.9);
    let lane = this.lane;
    for (const o of [...race.ramps, ...race.pads, ...race.launch]) {
      const ds = ((o.s - s + track.length / 2 + track.length) % track.length) - track.length / 2;
      if (o.avoid) {
        // turbo qui pousse vers un saut que les robots ne tentent pas : on le contourne
        if (ds > -14 && ds < 42 && Math.abs(lane - (o.off ?? 0)) < o.w / 2 + 3.5) lane = (lane >= 0 ? 1 : -1) * (o.w / 2 + 4.5);
      } else if (ds > -12 && ds < 38) lane = o.off ?? 0;
    }
    // barres mobiles : on passe du côté où il reste de la place quand on arrivera à leur hauteur
    for (const b of race.sliders) {
      const along = (b.x - me.x) * Math.sin(me.yaw) + (b.z - me.z) * Math.cos(me.yaw);
      if (along < -2 || along > 38) continue;
      const eta = (along / Math.max(speed, 6)) * TICK_RATE;
      const at = (b.off ?? 0) + sliderOffset(b, clock + eta), gap = b.len / 2 + 3.6;
      if (Math.abs(lane - at) < gap) lane = at > 0 ? at - gap : at + gap;
    }
    if (race.floor) lane = this.stayOnFloor(race, track, s, look, speed, clock, lane);
    else lane = clamp(lane, -race.width / 2 + 3, race.width / 2 - 3);
    const a = track.at(s + look);
    const tx = a.x - a.fz * lane, tz = a.z + a.fx * lane;
    const diff = angleDiff(me.yaw, Math.atan2(tx - me.x, tz - me.z));
    cmd.t = clamp(diff * 2.4, -1, 1);

    // --- vitesse : plein gaz en ligne droite, on lève le pied dans les virages serrés
    const ahead = track.at(s + 28);
    const bend = Math.max(curve * 0.7, Math.abs(angleDiff(Math.atan2(a.fx, a.fz), Math.atan2(ahead.fx, ahead.fz))));
    let throttle = Math.abs(diff) < 0.5 ? 1 : Math.abs(diff) < 1.2 ? 0.5 : 0.15;
    throttle = Math.min(throttle, 1 - clamp(bend - 0.55, 0, 0.42)) * this.skill;

    // --- portes : à l'approche (distance de freinage + marge), on s'arrête devant une porte qui sera fermée à notre arrivée
    const rdef = raceDef(def);
    for (const g of race.gates) {
      if (g.hw < 6) continue; // le ponton : les bots ne le prennent pas
      const dx = g.x - me.x, dz = g.z - me.z, along = dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw);
      if (along < 0 || along > speed * speed / (2 * rdef.brake * 0.7) + 25) continue;
      if (Math.abs(-dx * g.fz + dz * g.fx) > g.hw + 4) continue; // une porte sur l'autre voie d'une fourche
      const eta = (along / Math.max(speed, 4)) * TICK_RATE;
      if (gateOpenness(g, clock + eta) < 0.85 || gateOpenness(g, clock + eta + 25) < 0.85) {
        const vMax = Math.sqrt(2 * rdef.brake * 0.6 * Math.max(0, along - 7));
        throttle = Math.min(throttle, vMax / rdef.maxSpeed);
      }
    }
    cmd.f = throttle;

    // --- coincé (contre un autre char ou un obstacle) : un peu de marche arrière
    if (this.escape > 0) {
      this.escape--;
      cmd.f = -1;
      cmd.t = this.escapeTurn;
    } else {
      this.stuck = cmd.f > 0.3 && speed < 0.7 && room.phase === 'playing' ? this.stuck + 1 : 0;
      if (this.stuck > 50) {
        this.stuck = 0;
        this.escape = 40;
        this.escapeTurn = Math.random() < 0.5 ? 1 : -1;
      }
    }
    return cmd;
  }

  // Circuit au-dessus du vide : reste sur le sol (voie d'une fourche, ponts étroits) et évite les dalles qui vont disparaître.
  stayOnFloor(race, track, s, look, speed, clock, lane) {
    const spans = race.spansAt(s + look);
    if (spans.length) {
      const m = 3.4; // marge : un char large n'est pas sur le bord
      const fit = (l, sp) => clamp(l, Math.min(sp[0] + m, (sp[0] + sp[1]) / 2), Math.max(sp[1] - m, (sp[0] + sp[1]) / 2));
      const pref = Math.min(spans.length - 1, Math.round(this.fork * (spans.length - 1)));
      let best = lane, bd = Infinity;
      spans.forEach((sp, i) => {
        const l = fit(lane, sp), d = Math.abs(l - lane) + (i === pref ? 0 : 4);
        if (d < bd) { bd = d; best = l; }
      });
      lane = best;
    }
    if (race.blinks.length) {
      // y a-t-il des dalles dans les 70 m qui viennent ? alors on choisit la voie dont les dalles seront debout à notre passage
      const ahead = race.blinks.some((b) => {
        const d = ((b.s - s + track.length) % track.length);
        return d < 70;
      });
      if (ahead) {
        const v = Math.max(speed, 8);
        let best = lane, bc = Infinity;
        for (let k = -4; k <= 4; k++) {
          const cand = lane + k * 3, sp = race.spansAt(s + 12).find(([lo, hi]) => cand >= lo + 2 && cand <= hi - 2);
          if (!sp) continue;
          let cost = Math.abs(k) * 0.4 + (k === 0 ? 0 : 0.2);
          for (const d of [3, 8, 14, 20, 27]) {
            const p = track.at(s + d), x = p.x - p.fz * cand, z = p.z + p.fx * cand, t = clock + (d / v) * TICK_RATE;
            if (!solidAt(race, x, z, t)) cost += 6 - d * 0.1;
            else if (!solidAt(race, x, z, t + 24) || !solidAt(race, x, z, t - 12)) cost += 1.4; // trop juste
          }
          if (cost < bc) { bc = cost; best = cand; }
        }
        lane = best;
      }
    }
    return lane;
  }
}
