// Directeur de campagne : interprète une mission de shared/campaign.js pendant la partie.
// Il fait apparaître les unités, déclenche vagues et renforts, gère les bonus,
// les scénarios des boss et décide de la victoire ou de l'échec.
// La simulation elle-même (chars, obus, dégâts) reste dans Room.js.
import { TICK_RATE, UNIT_TYPES, PICKUPS, DIFFICULTIES, CAMPAIGN_RULES as CR } from '../shared/constants.js';
import { MISSIONS, MISSION_INDEX, getMission } from '../shared/campaign.js';
import { createTankState } from '../shared/tank.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ progression

// Progression d'un compte : { cleared: { m1: 3, ... } } = difficulté la plus haute réussie
// (1 Recrue, 2 Vétéran, 3 Élite), c'est-à-dire le nombre d'étoiles. Voir server/Accounts.js.
// Une mission est jouable si la précédente est réussie, à n'importe quelle difficulté (ou si TANK3D_UNLOCK=1).
export function isUnlocked(cleared, id) {
  const i = MISSION_INDEX[id];
  if (i === undefined) return false;
  return i === 0 || process.env.TANK3D_UNLOCK === '1' || (cleared?.[MISSIONS[i - 1].id] ?? 0) > 0;
}

// --------------------------------------------------------------------- boss

// Chaque boss : un scénario appelé à chaque tick. `st` garde son état (phase, minuteries).
const BOSS_SCRIPTS = {
  // Goliath : double canon ; phase 2 salves en éventail ; phase 3 escorte légère et cadence accrue.
  goliath(c, boss, st) {
    const phase = c.bossPhase(boss, st, [
      null,
      'Le Goliath tire en éventail !',
      'Goliath acculé : il appelle son escorte !',
    ]);
    if (phase >= 2 && --st.volley <= 0) {
      st.volley = (phase === 3 ? 4.5 : 6.5) * TICK_RATE;
      c.room.fireFan(boss, 5, 0.55);
    }
    if (phase === 3) {
      boss.tank.rof = boss.baseRof * 0.65;
      if (--st.summon <= 0) {
        st.summon = 24 * TICK_RATE;
        c.summon(boss, 'light', 2 + Math.min(2, c.scale - 1), 4);
      }
    }
  },

  // Citadelle : invulnérable tant qu'un générateur tient ; barrages de mortier ; renforts en phase 2.
  citadel(c, boss, st) {
    const gens = c.units().filter((u) => u.alive && u.tag === 'gen').length;
    boss.shieldedBy = gens > 0 ? 'gen' : null;
    if (st.gens !== gens) {
      if (st.gens !== undefined && gens === 0) c.room.events.push({ k: 'boss', text: 'Bouclier de la Citadelle hors service !', sub: 'Feu à volonté' });
      st.gens = gens;
    }
    const phase = gens > 0 ? 1 : c.bossPhase(boss, st, [null, null, 'La Citadelle appelle des renforts !'], [1, 1.01, 0.5]);
    if (--st.barrage <= 0) {
      st.barrage = (phase === 3 ? 7 : 10) * TICK_RATE;
      c.barrage(boss, 2);
    }
    if (phase === 3 && --st.summon <= 0) {
      st.summon = 20 * TICK_RATE;
      c.summon(boss, 'standard', 2, 4);
    }
  },

  // Léviathan : barrages ; phase 2 éventail + escorte lourde ; phase 3 enragé.
  leviathan(c, boss, st) {
    const phase = c.bossPhase(boss, st, [
      null,
      'Le Léviathan déploie son escorte lourde !',
      'LÉVIATHAN ENRAGÉ',
    ]);
    if (--st.barrage <= 0) {
      st.barrage = (phase === 3 ? 6 : phase === 2 ? 8 : 10) * TICK_RATE;
      c.barrage(boss, phase === 3 ? 3 : 2);
    }
    if (phase >= 2 && --st.volley <= 0) {
      st.volley = (phase === 3 ? 4.5 : 6.5) * TICK_RATE;
      c.room.fireFan(boss, phase === 3 ? 7 : 5, 0.75);
    }
    if (phase >= 2 && !st.escort) {
      st.escort = true;
      c.summon(boss, 'heavy', 2, 4);
    }
    if (phase === 3) {
      boss.tank.rof = boss.baseRof * 0.5;
      if (--st.summon <= 0) {
        st.summon = 18 * TICK_RATE;
        c.summon(boss, 'light', 2, 5);
      }
    }
  },
};

// ------------------------------------------------------------------ directeur

export class Campaign {
  constructor(room) {
    this.room = room;
    this.m = null;
    this.done = true;
  }

  // Unités de campagne (ennemies et alliées fixes), vivantes ou non.
  units() {
    return [...this.room.players.values()].filter((p) => p.unit);
  }

  enemies() {
    return this.units().filter((p) => p.team === CR.enemyTeam);
  }

  // Escouade : joueurs humains et bots alliés (pas les tourelles alliées).
  squad() {
    return [...this.room.players.values()].filter((p) => !p.unit && p.inRound);
  }

  start(missionId, difficulty) {
    const room = this.room;
    const m = (this.m = getMission(missionId));
    this.diffKey = Object.hasOwn(DIFFICULTIES, difficulty) ? difficulty : 'normal';
    this.diff = DIFFICULTIES[this.diffKey];
    this.tick = 0;
    this.done = false;
    this.pickups = [];
    this.nextPickup = 1;
    this.hold = 0;
    this.reach = 0;
    this.waveIdx = 0;
    this.waveTimer = m.waves ? m.waves[0].delay * TICK_RATE : 0;
    this.waveIds = new Set();
    this.reinforceTimer = m.reinforce ? m.reinforce.first * TICK_RATE : 0;
    this.reinforceIdx = 0;
    this.reinforceIds = new Set();
    this.boss = null;
    this.bossState = null;
    this.deflectTick = -999;
    this.spawned = 0;
    this.summons = new Set();

    const squad = this.squad();
    this.scale = Math.max(1, squad.length);

    // l'escouade en formation au point de départ
    const sp = m.map.playerSpawn;
    const fx = Math.sin(sp.yaw), fz = Math.cos(sp.yaw);
    for (const p of squad) p.tank = null; // pas encore placés : ignorés par freeSpot
    squad.forEach((p, i) => {
      const lat = ((i % 4) - 1.5) * 6, back = Math.floor(i / 4) * 7;
      const pos = this.freeSpot(sp.x + fz * lat - fx * back, sp.z - fx * lat - fz * back, UNIT_TYPES[p.activeType].radius);
      p.tank = createTankState(pos.x, pos.z, sp.yaw);
      this.resetBuffs(p);
      p.respawn = 0;
    });

    for (const spec of m.units) this.spawnSpec(spec);
    for (const pk of m.pickups) this.addPickup(pk.k, pk.x, pk.z, false);
    this.room.zone = { team: null, progress: 0, contested: false };
  }

  resetBuffs(p) {
    p.buffs = { rapid: 0, damage: 0, shield: 0 }; // tirs / impacts restants
    p.shieldLast = null;
    p.invuln = 0;
    if (p.tank) p.tank.rof = 1;
  }

  // Case libre proche d'un point, loin des autres unités.
  freeSpot(x, z, radius) {
    const nav = this.room.navFor(radius);
    const others = this.room.roundPlayers().filter((o) => o.tank);
    for (let k = 0; k < 24; k++) {
      const a = k * 2.4, d = k === 0 ? 0 : 3 + k * 1.2;
      const cell = nav.nearestFree(x + Math.cos(a) * d, z + Math.sin(a) * d);
      if (cell < 0) continue;
      const cx = nav.cx(cell % nav.w), cz = nav.cz(Math.floor(cell / nav.w));
      if (others.every((o) => Math.hypot(o.tank.x - cx, o.tank.z - cz) > radius + UNIT_TYPES[o.activeType].radius + 1)) return { x: cx, z: cz };
    }
    return { x, z };
  }

  enemyOpts(type) {
    const def = UNIT_TYPES[type];
    const extra = 1 + (def.boss ? 0.4 : 0.12) * (this.scale - 1);
    return {
      hpMul: this.diff.hp * extra,
      dmgMul: this.diff.dmg,
      rof: this.diff.rof,
      skill: { reaction: this.diff.reaction, aim: this.diff.aim, lead: this.diff.lead },
    };
  }

  spawnSpec(spec) {
    const def = UNIT_TYPES[spec.t];
    const team = spec.team ?? CR.enemyTeam;
    const sp = this.m.map.playerSpawn;
    const yaw = spec.yaw ?? Math.atan2(sp.x - spec.x, sp.z - spec.z);
    const opts = team === CR.enemyTeam ? this.enemyOpts(spec.t)
      : { hpMul: def.static ? this.diff.allyHp : 1, dmgMul: 0.8, skill: { reaction: 0.4, aim: 0.04 } };
    const p = this.room.spawnUnit(spec.t, team, spec.x, spec.z, yaw, {
      ...opts,
      mode: def.static ? 'static' : spec.ai ?? 'guard',
      obj: !!spec.obj, tag: spec.tag ?? null,
    });
    if (team !== CR.enemyTeam && def.static) p.allyDown = 0; // tourelle alliée : jamais détruite, mise hors service
    if (spec.spawn) {
      p.spawner = spec.spawn;
      p.spawnTimer = spec.spawn.every * TICK_RATE * 0.5;
      p.children = new Set();
    }
    if (def.boss) {
      this.boss = p;
      this.bossState = { phase: 1, volley: 5 * TICK_RATE, barrage: 7 * TICK_RATE, summon: 0 };
    }
    this.spawned++;
    return p;
  }

  // Unité ennemie qui arrive en cours de partie (vague, renfort, escorte, usine).
  spawnAt(type, x, z, mode = 'assault') {
    const def = UNIT_TYPES[type];
    const pos = this.freeSpot(x, z, def.radius);
    const target = this.squad().find((p) => p.alive)?.tank ?? this.m.map.playerSpawn;
    const p = this.room.spawnUnit(type, CR.enemyTeam, pos.x, pos.z, Math.atan2(target.x - pos.x, target.z - pos.z), {
      ...this.enemyOpts(type), mode: def.static ? 'static' : mode,
    });
    this.spawned++;
    if (def.boss && !this.boss) {
      this.boss = p;
      this.bossState = { phase: 1, volley: 5 * TICK_RATE, barrage: 7 * TICK_RATE, summon: 0 };
    }
    return p;
  }

  // Plus on est nombreux, plus l'ennemi envoie de monde.
  scaled(n) {
    return Math.max(1, Math.round(n * (1 + 0.3 * (this.scale - 1))));
  }

  spawnGroup(group, ids, entryOffset) {
    const entries = this.m.entries;
    let j = entryOffset;
    for (const { t, n } of group) {
      const count = UNIT_TYPES[t].boss ? n : this.scaled(n);
      for (let i = 0; i < count; i++) {
        const e = entries[j++ % entries.length];
        ids.add(this.spawnAt(t, e.x + rand(-4, 4), e.z + rand(-4, 4)).id);
      }
    }
  }

  aliveIn(ids) {
    let n = 0;
    for (const id of ids) {
      const p = this.room.players.get(id);
      if (p?.alive) n++;
      else ids.delete(id);
    }
    return n;
  }

  // ----------------------------------------------------------------- boss

  // Calcule la phase (1..3) selon les PV et annonce les changements. `at` = seuils de PV.
  bossPhase(boss, st, texts, at = [1, 0.66, 0.33]) {
    const r = boss.hp / boss.maxHp;
    const phase = r <= at[2] ? 3 : r <= at[1] ? 2 : 1;
    if (phase > st.phase) {
      st.phase = phase;
      if (texts[phase - 1]) this.room.events.push({ k: 'boss', text: texts[phase - 1], sub: `Phase ${phase}` });
    }
    return st.phase;
  }

  // Pluie d'obus de mortier autour de chaque membre de l'escouade (impacts annoncés au sol).
  barrage(boss, perTarget) {
    const room = this.room;
    // seulement les chars à portée d'artillerie : on n'est pas pilonné dès le point de départ
    const targets = this.squad().filter((p) => p.alive && Math.hypot(p.tank.x - boss.tank.x, p.tank.z - boss.tank.z) < 95);
    targets.forEach((p, i) => {
      for (let k = 0; k < perTarget; k++) {
        const a = rand(0, Math.PI * 2), d = k === 0 ? rand(0, 3) : rand(4, 10);
        const x = p.tank.x + Math.sin(p.tank.yaw) * p.tank.speed * 1.4 + Math.cos(a) * d;
        const z = p.tank.z + Math.cos(p.tank.yaw) * p.tank.speed * 1.4 + Math.sin(a) * d;
        room.later((i * perTarget + k) * 7, () => boss.alive && room.fireArc(boss, x, z, { damage: 300, splash: 6, flight: 100 }));
      }
    });
  }

  summon(boss, type, n, cap) {
    const room = this.room;
    const count = Math.min(Math.max(0, cap - this.aliveIn(this.summons)), n);
    for (let i = 0; i < count; i++) {
      const a = boss.tank.yaw + Math.PI + rand(-1.2, 1.2);
      this.summons.add(this.spawnAt(type, boss.tank.x + Math.sin(a) * 10, boss.tank.z + Math.cos(a) * 10).id);
    }
    if (count) room.events.push({ k: 'toast', text: `Renforts : ${count} × ${UNIT_TYPES[type].name}`, c: 'red' });
  }

  // ---------------------------------------------------------------- bonus

  nearestPickup(x, z, kind, maxDist) {
    let best = null, bestD = maxDist;
    for (const pk of this.pickups) {
      const d = Math.hypot(pk.x - x, pk.z - z);
      if (pk.k === kind && d < bestD) {
        bestD = d;
        best = pk;
      }
    }
    return best;
  }

  addPickup(k, x, z, expires = true) {
    this.pickups.push({ id: this.nextPickup++, k, x, z, ttl: expires ? 30 * TICK_RATE : Infinity });
  }

  // Tourelle alliée remise en service, blindage plein.
  reactivate(u) {
    u.allyDown = 0;
    u.alive = true;
    u.hp = u.maxHp;
    u.tank.reload = 0;
    this.room.events.push({ k: 'respawn', id: u.id });
    this.room.events.push({ k: 'hp', id: u.id, hp: u.hp, by: null, heal: true });
    this.room.stateDirty = true;
  }

  // Bonus lâchés par une unité détruite ; renvoie leur nombre. Un char ennemi qui lâche un bonus
  // disparaît aussitôt (onKill) ; l'épave d'une unité fixe reste, le bonus est donc posé à côté.
  dropFrom(p) {
    const def = UNIT_TYPES[p.activeType];
    const chance = def.static ? CR.dropChance : CR.tankDropChance;
    const drops = def.boss ? ['repair', 'repair', 'shield'] : def.structure ? ['repair'] : Math.random() < chance ? [pick(['repair', 'repair', 'repair', 'rapid', 'damage', 'shield'])] : [];
    const sp = this.m.map.playerSpawn;
    const toward = Math.atan2(sp.z - p.tank.z, sp.x - p.tank.x); // du côté de l'escouade
    drops.forEach((k, i) => {
      const a = toward + (i / drops.length) * Math.PI * 2;
      const d = drops.length > 1 || def.static ? def.radius + 3 : 0;
      const pos = d ? this.freeSpot(p.tank.x + Math.cos(a) * d, p.tank.z + Math.sin(a) * d, 1.2) : p.tank;
      this.addPickup(k, pos.x, pos.z);
    });
    return drops.length;
  }

  applyPickup(p, pk) {
    const room = this.room;
    const info = PICKUPS[pk.k];
    switch (pk.k) {
      case 'repair':
        if (p.hp >= p.maxHp) return false;
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.45));
        room.events.push({ k: 'hp', id: p.id, hp: p.hp, by: null, heal: true });
        break;
      case 'rapid':
        p.buffs.rapid = info.shots;
        p.tank.rof = 0.5;
        break;
      case 'damage':
        p.buffs.damage = info.shots;
        break;
      case 'shield':
        p.buffs.shield = info.hits;
        p.shieldLast = null;
        break;
    }
    room.events.push({ k: 'pickup', id: pk.id, by: p.id, kind: pk.k });
    return true;
  }

  // --------------------------------------------------------------- dégâts

  // Renvoie les dégâts réellement subis (bouclier, invulnérabilité…).
  // La Citadelle est-elle protégée par ses générateurs ?
  isShielded(p) {
    return !!p.shieldedBy && this.units().some((u) => u.alive && u.tag === p.shieldedBy);
  }

  // Un tir de l'escouade : les bonus « cadence » et « perforants » s'usent d'un cran.
  onFire(p) {
    if (!p.buffs) return;
    if (p.buffs.rapid > 0 && --p.buffs.rapid === 0) p.tank.rof = 1;
    if (p.buffs.damage > 0) p.buffs.damage--;
  }

  modifyDamage(p, amount, byId) {
    if (p.invuln > 0) return 0;
    if (this.isShielded(p)) {
      if (this.tick - this.deflectTick > 2 * TICK_RATE) {
        this.deflectTick = this.tick;
        this.room.events.push({ k: 'toast', text: 'Bouclier actif · détruis les générateurs', c: 'blue' });
      }
      this.room.events.push({ k: 'deflect', id: p.id });
      return 0;
    }
    if (p.buffs?.shield > 0) {
      // bouclier : annule l'impact en entier. Les coups du même tireur à moins de 0,4 s
      // (rafale de mitrailleuse, obus + souffle) ne comptent que pour un impact.
      const last = p.shieldLast;
      if (!last || last.by !== byId || this.tick - last.t > 0.4 * TICK_RATE) p.buffs.shield--;
      p.shieldLast = { by: byId, t: this.tick };
      this.room.events.push({ k: 'deflect', id: p.id });
      return 0;
    }
    return amount;
  }

  onKill(p) {
    if (!p.unit) {
      // pas de réapparition en campagne : hors combat jusqu'à la fin de la mission
      this.resetBuffs(p);
      p.respawn = 0;
      return;
    }
    const def = UNIT_TYPES[p.activeType];
    if (p.allyDown !== undefined) {
      p.allyDown = CR.allyDownTicks;
      this.room.events.push({ k: 'toast', text: `${def.name} alliée hors service · retour dans ${CR.allyDownTicks / TICK_RATE} s`, c: 'red' });
      return;
    }
    const dropped = p.team === CR.enemyTeam ? this.dropFrom(p) : 0;
    // l'épave d'un char qui lâche un bonus disparaît presque aussitôt, sinon elle le recouvre
    if (!def.static) p.removeAt = this.tick + (dropped ? Math.round(0.3 * TICK_RATE) : CR.wreckTicks);
    if (p.obj) {
      const left = this.units().filter((u) => u.obj && u.alive).length;
      const total = this.units().filter((u) => u.obj).length;
      this.room.events.push({ k: 'toast', text: `${def.name} détruit · ${total - left} / ${total}`, c: 'amber' });
    }
    if (p === this.boss) this.room.events.push({ k: 'boss', text: `${def.name} détruit !`, sub: '' });
  }

  // Où les bots alliés vont quand il n'y a personne à combattre.
  allyGoal(p) {
    const m = this.m;
    if (m.map.zone && (m.objective.kind === 'hold' || m.objective.kind === 'reach')) return { ...m.map.zone, r: m.map.zone.r * 0.6 };
    // cibles de mission (ou générateurs du bouclier) : on se rapproche de la plus proche
    let best = null, bestD = Infinity;
    for (const u of this.units()) {
      if (!u.alive || !(u.obj || u.tag === 'gen')) continue;
      const d = Math.hypot(u.tank.x - p.tank.x, u.tank.z - p.tank.z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best ? { x: best.tank.x, z: best.tank.z, r: 28 } : null;
  }

  // ----------------------------------------------------------------- tick

  step() {
    if (this.done) return;
    const room = this.room, m = this.m;
    this.tick++;

    for (const p of this.squad()) if (p.alive && p.invuln > 0) p.invuln--;

    // tourelles alliées hors service : remises en marche au bout du délai
    for (const u of this.units()) {
      if (u.allyDown > 0 && !u.alive && --u.allyDown === 0) this.reactivate(u);
    }

    // épaves ennemies qui disparaissent
    for (const u of this.units()) {
      if (!u.alive && u.removeAt && this.tick >= u.removeAt) room.removeUnit(u);
    }

    // vagues ; entre deux vagues, un ravitaillement est largué au point de départ
    const waveClear = m.waves && this.waveIdx < m.waves.length && this.aliveIn(this.waveIds) === 0;
    if (waveClear && this.waveIdx > 0 && !this.resupplied) {
      this.resupplied = true;
      const sp = m.map.playerSpawn;
      const kinds = [...this.squad().map(() => 'repair'), pick(['rapid', 'damage', 'shield'])];
      kinds.forEach((k, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        const pos = this.freeSpot(sp.x + Math.cos(a) * 6, sp.z + Math.sin(a) * 6, 1);
        this.addPickup(k, pos.x, pos.z);
      });
      room.events.push({ k: 'toast', text: 'Ravitaillement largué au point de départ', c: 'green' });
      // entre deux vagues, le génie remet aussi les tourelles alliées en état
      for (const u of this.units()) {
        if (u.allyDown === undefined) continue;
        if (!u.alive) this.reactivate(u);
        else if (u.hp < u.maxHp) {
          u.hp = u.maxHp;
          room.events.push({ k: 'hp', id: u.id, hp: u.hp, by: null, heal: true });
        }
      }
    }
    if (waveClear && --this.waveTimer <= 0) {
      this.resupplied = false;
      const wave = m.waves[this.waveIdx];
      this.spawnGroup(wave.units, this.waveIds, this.waveIdx * 2);
      this.waveIdx++;
      room.events.push({ k: 'wave', n: this.waveIdx, total: m.waves.length });
      if (this.waveIdx < m.waves.length) this.waveTimer = m.waves[this.waveIdx].delay * TICK_RATE;
    }

    // renforts réguliers
    const rf = m.reinforce;
    if (rf && --this.reinforceTimer <= 0) {
      this.reinforceTimer = rf.every * TICK_RATE;
      if (this.aliveIn(this.reinforceIds) < this.scaled(rf.cap)) {
        const group = rf.groups[this.reinforceIdx++ % rf.groups.length];
        this.spawnGroup(group, this.reinforceIds, this.reinforceIdx);
        const boss = group.find((g) => UNIT_TYPES[g.t].boss);
        room.events.push(boss
          ? { k: 'boss', text: `Un ${UNIT_TYPES[boss.t].name} approche !`, sub: 'Alerte' }
          : { k: 'toast', text: 'Renforts ennemis en approche', c: 'red' });
      }
    }

    // usines
    for (const f of this.units()) {
      if (!f.spawner || !f.alive || --f.spawnTimer > 0) continue;
      f.spawnTimer = f.spawner.every * TICK_RATE;
      if (this.aliveIn(f.children) >= f.spawner.cap + Math.floor((this.scale - 1) * 0.5)) continue;
      const type = f.spawner.t[Math.floor(Math.random() * f.spawner.t.length)];
      const d = UNIT_TYPES[f.activeType].radius + 5;
      f.children.add(this.spawnAt(type, f.tank.x + Math.sin(f.tank.yaw) * d, f.tank.z + Math.cos(f.tank.yaw) * d).id);
      room.events.push({ k: 'toast', text: `L’usine produit un ${UNIT_TYPES[type].name}`, c: 'red' });
    }

    // boss
    if (this.boss?.alive) BOSS_SCRIPTS[this.boss.activeType]?.(this, this.boss, this.bossState);

    // bonus
    this.pickups = this.pickups.filter((pk) => {
      if (--pk.ttl <= 0) return false;
      for (const p of this.squad()) {
        if (p.alive && Math.hypot(p.tank.x - pk.x, p.tank.z - pk.z) < CR.pickupRadius + UNIT_TYPES[p.activeType].radius * 0.5) {
          if (this.applyPickup(p, pk)) return false;
        }
      }
      return true;
    });

    this.checkObjective();
    if (this.done) return;

    // échec : toute l'escouade est hors combat
    const squad = this.squad();
    if (squad.length && squad.every((p) => !p.alive)) this.finish(false, 'Escouade détruite');
  }

  checkObjective() {
    const m = this.m, o = m.objective, room = this.room;
    const enemies = this.enemies();
    switch (o.kind) {
      case 'destroy':
        if (enemies.every((u) => !u.alive) && !(m.waves && this.waveIdx < m.waves.length)) this.finish(true);
        break;
      case 'targets':
        if (this.units().filter((u) => u.obj).every((u) => !u.alive)) this.finish(true);
        break;
      case 'boss':
        if (this.boss && !this.boss.alive) this.finish(true);
        break;
      case 'waves':
        if (this.waveIdx >= m.waves.length && this.aliveIn(this.waveIds) === 0) this.finish(true);
        break;
      case 'hold':
      case 'reach': {
        const z = m.map.zone;
        const inZone = (p) => p.alive && Math.hypot(p.tank.x - z.x, p.tank.z - z.z) <= z.r;
        const squadIn = this.squad().filter(inZone).length;
        if (o.kind === 'hold') {
          const contested = enemies.some((u) => inZone(u) && !UNIT_TYPES[u.activeType].static);
          if (squadIn) this.hold++; // les ennemis dans la zone ne bloquent pas le compte à rebours
          room.zone = { team: CR.playerTeam, progress: this.hold / (o.seconds * TICK_RATE), contested: squadIn > 0 && contested };
          if (this.hold >= o.seconds * TICK_RATE) this.finish(true);
        } else {
          // extraction : tous les chars encore en vie de l'escouade doivent être dans la zone
          const alive = this.squad().filter((p) => p.alive).length;
          this.reach = alive && squadIn === alive ? this.reach + 1 : Math.max(0, this.reach - 2);
          room.zone = { team: CR.playerTeam, progress: Math.min(1, this.reach / (2 * TICK_RATE)), contested: false };
          if (this.reach >= 2 * TICK_RATE) this.finish(true);
        }
        break;
      }
    }
  }

  // Texte de l'objectif pour le HUD : { l: libellé, v: valeur, p: progression 0..1 }.
  info() {
    if (!this.m) return null;
    const m = this.m, o = m.objective;
    const squad = this.squad();
    const out = { l: o.label, v: '', p: 0, al: squad.filter((p) => p.alive).length, sq: squad.length, t: Math.floor(this.tick / TICK_RATE) };
    switch (o.kind) {
      case 'destroy': {
        const enemies = this.enemies();
        const left = enemies.filter((u) => u.alive).length;
        out.v = `${left} restant${left > 1 ? 's' : ''}`;
        out.p = enemies.length ? 1 - left / enemies.length : 0;
        break;
      }
      case 'targets': {
        const all = this.units().filter((u) => u.obj);
        const done = all.filter((u) => !u.alive).length;
        out.v = `${done} / ${all.length}`;
        out.p = all.length ? done / all.length : 0;
        break;
      }
      case 'hold': {
        const total = o.seconds * TICK_RATE;
        out.v = fmtTime(Math.ceil((total - this.hold) / TICK_RATE));
        out.p = this.hold / total;
        break;
      }
      case 'waves': {
        const left = this.aliveIn(this.waveIds);
        out.l = `Vague ${Math.max(1, this.waveIdx)} / ${m.waves.length}`;
        out.v = left ? `${left} ennemi${left > 1 ? 's' : ''}` : this.waveIdx < m.waves.length ? `Prochaine dans ${Math.ceil(this.waveTimer / TICK_RATE)} s` : '';
        out.p = (this.waveIdx - (left ? 1 : 0)) / m.waves.length;
        break;
      }
      case 'reach': {
        const z = m.map.zone;
        // on suit le char le plus en retard : c'est lui qui retient l'escouade
        const alive = this.squad().filter((p) => p.alive);
        const dists = alive.map((p) => Math.hypot(p.tank.x - z.x, p.tank.z - z.z) - z.r);
        const worst = dists.length ? Math.max(...dists) : Infinity;
        const inside = dists.filter((d) => d <= 0).length;
        const start = Math.hypot(m.map.playerSpawn.x - z.x, m.map.playerSpawn.z - z.z);
        out.v = !dists.length ? '' : inside ? `${inside} / ${dists.length} à l’extraction` : `${Math.round(worst)} m`;
        out.p = dists.length ? Math.max(0, Math.min(1, 1 - worst / start)) : 0;
        break;
      }
      case 'boss': {
        const b = this.boss;
        out.v = b?.shieldedBy ? ((n) => `Bouclier · ${n} générateur${n > 1 ? 's' : ''}`)(this.units().filter((u) => u.alive && u.tag === b.shieldedBy).length) : b ? `${Math.ceil((b.hp / b.maxHp) * 100)} %` : '';
        out.p = b ? 1 - b.hp / b.maxHp : 0;
        break;
      }
    }
    return out;
  }

  finish(success, reason = '') {
    if (this.done) return;
    this.done = true;
    const m = this.m, room = this.room;
    const time = this.tick / TICK_RATE;
    // une étoile par niveau de difficulté : Recrue ★, Vétéran ★★, Élite ★★★
    const stars = success ? this.diff.stars : 0;
    const records = success ? room.recordClear(m.id, stars) : [];
    const idx = MISSION_INDEX[m.id];
    room.endMission({
      success, reason, stars, time: Math.round(time), par: m.par, mission: m.id, name: m.name,
      losses: this.squad().filter((p) => !p.alive).length, difficulty: this.diffKey, records,
      next: success && idx + 1 < MISSIONS.length ? MISSIONS[idx + 1].id : null,
      players: this.squad().map((p) => ({ id: p.id, name: p.name, bot: p.bot, kills: p.kills, deaths: p.deaths, dmg: Math.round(p.dmg ?? 0) })),
    });
  }
}
