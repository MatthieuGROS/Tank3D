// État du jeu côté client + tout le « netcode » anti-latence :
//
//  1. PRÉDICTION : mon char est simulé localement, tout de suite, avec le même code que le
//     serveur (shared/tank.js). Je n'attends jamais la réponse du serveur pour bouger.
//  2. RÉCONCILIATION : à chaque instantané, je repars de l'état officiel du serveur et je
//     rejoue mes commandes qu'il n'a pas encore traitées. S'il reste un écart, il est
//     absorbé en douceur (pas de téléportation visible).
//  3. INTERPOLATION : les autres chars sont affichés avec un léger retard (≈ 70-100 ms),
//     entre deux instantanés reçus. Leur mouvement reste fluide même si un paquet arrive
//     en retard ; le retard s'adapte tout seul à la qualité du réseau.
import { TICK_MS, SNAPSHOT_INTERVAL, UNIT_TYPES, DEFAULT_TANK } from '/shared/constants.js';
import { DEFAULT_MAP, withBroken } from '/shared/map.js';
import { mapFor } from '/shared/campaign.js';
import { stepTank, angleDiff, lerp, lerpAngle, clamp } from '/shared/tank.js';
import { eqDef } from '/shared/equipment.js';

const SNAP_MS = TICK_MS * SNAPSHOT_INTERVAL;
const TELEPORT_DIST = 6; // au-delà, on ne lisse pas (réapparition)
const MAX_EXTRAPOLATION_TICKS = 6;

export class Game {
  constructor() {
    this.myId = null;
    this.myType = DEFAULT_TANK; // char que je pilote dans la manche en cours
    this.hostId = null;
    this.roster = new Map(); // id -> { name, team, kills, deaths }
    this.phase = 'lobby';
    this.paused = false; // partie en pause (hôte)
    this.timeLeft = 0;
    this.round = 0;
    this.score = { red: 0, blue: 0 };
    this.settings = { roundsToWin: 3, map: DEFAULT_MAP, mode: 'skirmish', mission: 'm1', difficulty: 'normal', laps: 2, raceMap: 'colline' };
    this.unlocked = ['m1']; // missions ouvertes à l'escouade (débloquées par l'un des joueurs présents)
    this.account = null; // { name, cleared: { m1: 1..3 }, xp, allTanks } : mon compte, mes étoiles et mon expérience
    this.debrief = null;
    this.campaign = null; // objectif, escouade, temps (snapshots de campagne)
    this.pickups = [];
    this.race = null; // course : horloge, tours et classement (snapshots)
    this.clockBase = 0; // horloge de course au dernier snapshot…
    this.clockAt = 0; // …et heure locale de sa réception
    this.held = false; // course : mon char est bloqué après un retour en piste
    this.broken = new Set(); // objets du décor détruits pendant la manche
    this.zone = { team: null, p: 0, c: false };

    this.snaps = [];
    this.latest = null;
    this.others = [];

    this.pred = null; // état prédit de mon char (tick courant)
    this.prev = null; // état prédit au tick précédent (pour lisser entre deux ticks)
    this.pending = []; // commandes envoyées, pas encore confirmées par le serveur
    this.seq = 0;
    this.err = { x: 0, z: 0, yaw: 0 }; // écart visuel restant à absorber

    this.timeOffset = null; // horloge locale - horloge serveur (ms)
    this.jitter = 0;
    this.interpDelay = 80;
    this.onSpawn = null;
  }

  get me() {
    return this.roster.get(this.myId);
  }

  // carte d'origine (décor complet) et carte en jeu (sans les objets détruits)
  get baseMap() {
    return mapFor(this.settings);
  }

  get map() {
    return withBroken(this.baseMap, this.broken);
  }

  // caractéristiques de mon char (pour la prédiction)
  // (avec les équipements montés pour la manche : le serveur les annonce dans l'état du salon)
  get def() {
    return eqDef(this.myType, this.me?.eq) ?? UNIT_TYPES[this.myType] ?? UNIT_TYPES[DEFAULT_TANK];
  }

  onState(msg) {
    this.hostId = msg.hostId;
    this.round = msg.round;
    this.score = msg.score;
    this.settings = msg.settings;
    this.phase = msg.phase;
    this.paused = !!msg.paused;
    this.unlocked = msg.unlocked ?? this.unlocked;
    this.debrief = msg.debrief;
    this.report = msg.report ?? null; // rapport de la dernière bataille d'escarmouche
    this.broken = new Set(msg.broken ?? []);
    this.roster = new Map(msg.players.map((p) => [p.id, p]));
  }

  onSnap(msg, now) {
    const snap = { tick: msg.tick, pl: new Map(msg.pl.map((p) => [p.id, p])) };
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latest = snap;
    this.phase = msg.ph;
    this.paused = !!msg.pa;
    this.timeLeft = msg.tl;
    this.zone = msg.zone;
    this.campaign = msg.cm ?? null;
    this.pickups = msg.pk ?? [];
    this.race = msg.rc ?? null;
    if (msg.rc) {
      this.clockBase = msg.rc.c;
      this.clockAt = now;
    }

    // Synchronisation d'horloge + mesure de la gigue pour régler le retard d'interpolation.
    const sample = now - msg.tick * TICK_MS;
    if (this.timeOffset === null || Math.abs(sample - this.timeOffset) > 300) {
      this.timeOffset = sample;
    } else {
      this.jitter += (Math.abs(sample - this.timeOffset) - this.jitter) * 0.05;
      this.timeOffset += (sample - this.timeOffset) * 0.03;
    }
    const wanted = clamp(SNAP_MS * 2 + this.jitter * 3, 70, 250);
    this.interpDelay += (wanted - this.interpDelay) * 0.02;

    this.others = [];
    for (const p of msg.pl) if (p.id !== this.myId) this.others.push({ x: p.x, z: p.z, r: (UNIT_TYPES[p.tk] ?? this.def).radius });

    const me = snap.pl.get(this.myId);
    if (me) this.myType = me.tk;
    if (me && me.al) {
      this.reconcile(me, msg.ack);
    } else {
      this.pred = null;
      this.pending.length = 0;
    }
  }

  reconcile(me, ack) {
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    const s = {
      x: me.x, z: me.z, yaw: me.yaw, speed: me.sp, ty: me.ty, reload: me.rl, rof: me.rf ?? 1, shots: me.bc ?? 0, aim: me.ad ?? 0,
      // course : altitude, vol, poussée reçue, turbo
      y: me.y ?? 0, vy: me.av ?? 0, air: me.av !== undefined, kx: me.kx ?? 0, kz: me.kz ?? 0, kw: me.kw ?? 0, boost: me.bs ?? 0,
    };
    this.held = !!me.hd;
    for (const cmd of this.pending) stepTank(s, cmd, this.def, this.map, this.others, cmd.frozen, cmd.clock);

    const old = this.pred;
    this.pred = s;
    if (!old) {
      this.prev = { ...s };
      this.err.x = this.err.z = this.err.yaw = 0;
      this.onSpawn?.(s);
      return;
    }
    const ex = old.x - s.x, ez = old.z - s.z, eyaw = angleDiff(s.yaw, old.yaw);
    if (ex * ex + ez * ez > TELEPORT_DIST * TELEPORT_DIST) {
      this.prev = { ...s };
      this.err.x = this.err.z = this.err.yaw = 0;
      this.onSpawn?.(s);
      return;
    }
    // L'image ne bouge pas : la correction passe dans `err`, qui fond ensuite vers zéro.
    this.err.x += ex;
    this.err.z += ez;
    this.err.yaw += eyaw;
    this.prev.x -= ex;
    this.prev.z -= ez;
    this.prev.yaw -= eyaw;
  }

  // Un tick local : envoie la commande et l'applique immédiatement. Renvoie true si on a tiré.
  localTick(cmd, net) {
    if (!this.pred || this.paused) return false; // en pause, le serveur ne simule plus rien
    cmd.seq = ++this.seq;
    cmd.frozen = this.phase === 'countdown' || this.held;
    cmd.clock = this.map.race ? this.raceClock(performance.now(), net.rtt) : 0; // portes et barres mobiles dépendent de l'horloge
    net.send({ type: 'in', seq: cmd.seq, f: cmd.f, t: cmd.t, tt: cmd.tt, fire: cmd.fire, rg: cmd.rg });
    this.pending.push(cmd);
    if (this.pending.length > 120) this.pending.shift();
    this.prev = { ...this.pred };
    return stepTank(this.pred, cmd, this.def, this.map, this.others, cmd.frozen, cmd.clock);
  }

  // Horloge de course estimée (ticks depuis le feu vert) à l'heure locale `now` ; `lead` = avance en ms
  // (la commande envoyée est traitée par le serveur environ un trajet plus tard).
  raceClock(now, lead = 0) {
    if (!this.race) return 0;
    const dt = this.paused ? 0 : Math.max(0, now - this.clockAt + lead);
    return Math.max(0, this.clockBase + dt / TICK_MS);
  }

  decayError(dt) {
    const k = Math.exp(-dt * 10);
    this.err.x *= k;
    this.err.z *= k;
    this.err.yaw *= k;
  }

  // Mon char à l'écran : interpolé entre les deux derniers ticks prédits (alpha = 0..1).
  ownView(alpha) {
    const a = this.prev, b = this.pred;
    return {
      x: lerp(a.x, b.x, alpha) + this.err.x,
      z: lerp(a.z, b.z, alpha) + this.err.z,
      yaw: lerpAngle(a.yaw, b.yaw, alpha) + this.err.yaw,
      ty: lerpAngle(a.ty, b.ty, alpha),
      speed: b.speed,
      y: lerp(a.y ?? 0, b.y ?? 0, alpha), air: !!b.air, vy: b.vy ?? 0, boost: b.boost > 0,
    };
  }

  // Tick serveur (fractionnaire) affiché en ce moment pour les autres joueurs.
  renderTick(now) {
    return (now - this.timeOffset - this.interpDelay) / TICK_MS;
  }

  // Un autre char à l'écran, interpolé dans le passé récent.
  remoteView(id, rt) {
    const snaps = this.snaps;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].tick > rt) i--;
    const a = snaps[i], b = snaps[i + 1];
    const pa = a.pl.get(id);

    if (!b) {
      // Plus rien de neuf du serveur : on prolonge brièvement le mouvement, puis on fige.
      if (!pa) return null;
      const before = snaps[i - 1];
      const pp = before?.pl.get(id);
      if (!pp || !pa.al || Math.hypot(pa.x - pp.x, pa.z - pp.z) > TELEPORT_DIST) return view(pa);
      const k = clamp(rt - a.tick, 0, MAX_EXTRAPOLATION_TICKS) / (a.tick - before.tick);
      return {
        x: pa.x + (pa.x - pp.x) * k,
        z: pa.z + (pa.z - pp.z) * k,
        yaw: pa.yaw + angleDiff(pp.yaw, pa.yaw) * k,
        ty: pa.ty + angleDiff(pp.ty, pa.ty) * k,
        speed: pa.sp,
        ...raceFields(pa),
      };
    }
    const pb = b.pl.get(id);
    if (!pa || !pb) return pb ? view(pb) : pa ? view(pa) : null;
    if (Math.hypot(pb.x - pa.x, pb.z - pa.z) > TELEPORT_DIST) return view(pb);
    const t = clamp((rt - a.tick) / (b.tick - a.tick), 0, 1);
    return {
      x: lerp(pa.x, pb.x, t),
      z: lerp(pa.z, pb.z, t),
      yaw: lerpAngle(pa.yaw, pb.yaw, t),
      ty: lerpAngle(pa.ty, pb.ty, t),
      speed: pb.sp,
      ...raceFields(pb, pa, t),
    };
  }
}

function view(p) {
  return { x: p.x, z: p.z, yaw: p.yaw, ty: p.ty, speed: p.sp, ...raceFields(p) };
}

// Course : altitude, vol et turbo d'un instantané (interpolés entre `a` et `b`). Rien hors course.
function raceFields(b, a = b, t = 1) {
  if (b.y === undefined) return {};
  return { y: lerp(a.y ?? b.y, b.y, t), air: b.av !== undefined, vy: b.av ?? 0, boost: b.bs > 0 };
}
