// Mode course : déroulement d'une course (points de passage, tours, classement, chutes, arrivée).
// La simulation des chars (physique, tremplins, poussée des tirs) est dans shared/tank.js et server/Room.js ;
// ce fichier ne gère que les règles. Le salon appelle start() au lancement et step() à chaque tick.
import { TICK_RATE, TANK_TYPES } from '../shared/constants.js';
import { RACE_RULES, surfaceAt, SURF_WATER, finishGrace, floorHeight } from '../shared/race.js';
import { heightAt } from '../shared/map.js';

export class Race {
  constructor(room) {
    this.room = room;
    this.clock = 0; // ticks depuis le feu vert
    this.done = true;
    this.firstFinish = 0; // clock du premier arrivé (0 : personne)
    this.endAt = 0;
    this.finished = 0;
  }

  get map() {
    return this.room.baseMap;
  }

  get race() {
    return this.map.race;
  }

  racers() {
    return this.room.roundPlayers();
  }

  // Place les concurrents sur la grille de départ (le compte à rebours est lancé par le salon).
  start(laps) {
    const race = this.race;
    this.laps = laps;
    this.clock = 0;
    this.done = false;
    this.firstFinish = 0;
    this.endAt = 0;
    this.finished = 0;
    const room = this.room;
    room.matchMembers('red').forEach((p, i) => {
      const g = race.grid(i);
      room.enterRound(p, g.x, g.z, g.yaw);
      p.tank.y = heightAt(g.x, g.z, this.map);
      p.race = {
        cp: 1, lap: 1, lastCp: 0, prevX: g.x, prevZ: g.z, fin: 0, pen: 0, hold: 0, lapStart: 0, lapTimes: [], pushes: 0,
        progressAt: 0, slot: i, falls: 0,
      };
    });
  }

  // Nombre de points de passage franchis depuis le départ (sert au classement).
  passed(p) {
    const n = this.race.cps.length, r = p.race;
    return (r.lap - 1) * n + (r.cp === 0 ? n : r.cp) - 1;
  }

  // Classement : arrivés d'abord (temps), puis par progression, puis par distance au prochain point.
  standings() {
    const race = this.race;
    return this.racers().filter((p) => p.race).map((p) => {
      const c = race.cps[p.race.cp];
      const score = p.race.fin ? 1e9 - p.race.fin : this.passed(p) * 1e4 - Math.hypot(p.tank.x - c.x, p.tank.z - c.z);
      return { p, score };
    }).sort((a, b) => b.score - a.score).map((o) => o.p);
  }

  step() {
    if (this.done) return;
    const race = this.race;
    this.clock++;
    const racers = this.racers().filter((p) => p.race);
    for (const p of racers) {
      const r = p.race, t = p.tank;
      if (r.hold > 0) r.hold--;
      // franchissement du point de passage attendu : on regarde si le segment de la dernière position à celle-ci traverse la ligne
      if (!r.fin) {
        const c = race.cps[r.cp];
        const u0 = (r.prevX - c.x) * c.fx + (r.prevZ - c.z) * c.fz, u1 = (t.x - c.x) * c.fx + (t.z - c.z) * c.fz;
        if (u0 < 0 && u1 >= 0 && (!race.floor || t.y > floorHeight(race, t.x, t.z) - 2)) { // (pas en chute libre dans le vide)
          const k = u0 / (u0 - u1);
          const x = r.prevX + (t.x - r.prevX) * k, z = r.prevZ + (t.z - r.prevZ) * k;
          if (Math.abs((x - c.x) * -c.fz + (z - c.z) * c.fx) <= c.hw) this.passCheckpoint(p);
        }
        // chute à l'eau (sauf en l'air : on peut survoler la rivière)
        if (!t.air && surfaceAt(race, t.x, t.z) & SURF_WATER) this.respawn(p, 'water');
        // bloqué depuis trop longtemps (surtout les bots) : retour au dernier point de passage
        if (p.bot && this.clock - r.progressAt > race.stuckTicks) this.respawn(p, 'stuck');
      }
      // chute dans le vide (circuit sans sol hors de la piste) : retour au dernier point de passage, même pour un arrivé
      if (race.floor && t.y < floorHeight(race, t.x, t.z) - race.floor.deathY) this.respawn(p, 'void'); // 17 m sous le sol le plus proche
      r.prevX = t.x;
      r.prevZ = t.z;
    }
    this.checkEnd(racers);
  }

  passCheckpoint(p) {
    const r = p.race, race = this.race, n = race.cps.length;
    const room = this.room;
    r.progressAt = this.clock;
    r.lastCp = r.cp;
    if (r.cp === 0) {
      // ligne d'arrivée : un tour de plus
      const lapTime = this.clock - r.lapStart;
      r.lapTimes.push(lapTime);
      r.lapStart = this.clock;
      if (r.lap >= this.laps) {
        this.finish(p);
        return;
      }
      r.lap++;
      room.events.push({ k: 'lap', id: p.id, lap: r.lap, time: lapTime });
    } else {
      room.events.push({ k: 'cp', id: p.id, n: r.cp, of: n });
    }
    r.cp = (r.cp + 1) % n;
  }

  finish(p) {
    const r = p.race;
    r.fin = this.clock + r.pen;
    r.cp = 0;
    this.finished++;
    if (!this.firstFinish) this.firstFinish = this.clock;
    this.room.events.push({ k: 'fin', id: p.id, rank: this.finished, time: r.fin });
    this.room.stateDirty = true;
  }

  // Retour au dernier point de passage franchi, à l'arrêt, avec une pénalité de temps.
  respawn(p, why) {
    const r = p.race, t = p.tank, race = this.race;
    if (!r || this.room.phase !== 'playing') return;
    const lat = ((r.slot % 5) - 2) * 4.5; // les chars ne se superposent pas
    const pos = race.respawnAt(r.lastCp, lat);
    Object.assign(t, {
      x: pos.x, z: pos.z, yaw: pos.yaw, ty: pos.yaw, speed: 0, kx: 0, kz: 0, kw: 0, vy: 0, air: false, boost: 0,
      y: heightAt(pos.x, pos.z, this.map),
    });
    r.prevX = pos.x;
    r.prevZ = pos.z;
    r.hold = RACE_RULES.respawnFreezeTicks;
    r.progressAt = this.clock;
    r.falls++;
    if (!r.fin) r.pen += RACE_RULES.respawnPenaltyTicks;
    p.queue = [];
    this.room.events.push({ k: 'rspawn', id: p.id, why, x: +pos.x.toFixed(1), z: +pos.z.toFixed(1) });
  }

  checkEnd(racers) {
    if (!racers.length) {
      this.room.toLobby();
      return;
    }
    const open = racers.filter((p) => !p.race.fin);
    if (!this.endAt) {
      const grace = this.firstFinish && this.clock - this.firstFinish >= finishGrace(this.firstFinish);
      if (!open.length || grace || this.clock >= RACE_RULES.maxTicks) this.endAt = this.clock + (open.length ? 0 : 3 * TICK_RATE);
    }
    if (this.endAt && this.clock >= this.endAt) this.end();
  }

  end() {
    this.done = true;
    const room = this.room, order = this.standings();
    const results = order.map((p, i) => ({
      id: p.id, name: p.name, bot: p.bot || undefined, type: p.activeType, rank: i + 1,
      time: p.race.fin || 0, laps: p.race.lapTimes.length, pen: p.race.pen, best: p.race.lapTimes.length ? Math.min(...p.race.lapTimes) : 0,
      pushes: p.race.pushes, falls: p.race.falls,
    }));
    const result = { race: true, name: this.map.name, laps: this.laps, time: this.clock, results };
    room.endRace(result);
  }

  // Résumé envoyé dans chaque instantané : horloge, tours, et un classement [id, tour, prochain point, arrivée, pénalité].
  info() {
    const left = this.firstFinish ? Math.max(0, finishGrace(this.firstFinish) - (this.clock - this.firstFinish)) : 0;
    return {
      c: this.clock, lp: this.laps, n: this.race.cps.length, g: left,
      pl: this.standings().map((p) => [p.id, p.race.lap, p.race.cp, p.race.fin, p.race.pen]),
    };
  }

  // Poids d'un char (tonnes) : sert aussi bien aux poussées qu'à l'affichage.
  weightOf(p) {
    return TANK_TYPES[p.activeType]?.weight ?? 30;
  }
}
