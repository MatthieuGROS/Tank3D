// Un salon : joueurs, équipes, déroulement des manches et simulation autoritaire.
// Le serveur est seul juge : les clients n'envoient que leurs commandes.
// Trois modes : escarmouche (équipes contre équipes, en manches), campagne coopérative
// (missions contre l'IA, pilotées par server/Campaign.js) et course (chacun pour soi, server/Race.js).
import {
  TICK_MS, DT, TICK_RATE, SNAPSHOT_INTERVAL, TEAMS, TANK_TYPES, UNIT_TYPES, DEFAULT_TANK, RULES,
  DIFFICULTIES, CAMPAIGN_RULES, arcRange, arcFlight, faceCoef, dispersionAngle,
} from '../shared/constants.js';
import {
  rankIndex, RANKS, tankOwned, ownedTanks, tankPrice, fmtCr, skirmishXp, missionXp, skirmishCredits, missionCredits, sumParts,
} from '../shared/progress.js';
import { MAPS, RACE_MAPS, DEFAULT_MAP, DEFAULT_RACE_MAP, pointBlocked, withBroken, objectAt, objectKey, DESTRUCTIBLE, heightAt } from '../shared/map.js';
import { RACE_RULES, pushSpeed } from '../shared/race.js';
import { MISSIONS, MISSION_INDEX, mapFor, getMission } from '../shared/campaign.js';
import { createTankState, stepTank, sanitizeInput, pointHitsTank, shellHeight, arcPoint, autoPitch, scatter } from '../shared/tank.js';
import { detects, SPOT_LINGER, FIRE_REVEAL } from '../shared/vision.js';
import { NavGrid, BotBrain } from './Bot.js';
import { UnitBrain } from './Enemy.js';
import { Race } from './Race.js';
import { RaceBrain } from './RaceBot.js';
import { Campaign, isUnlocked } from './Campaign.js';
import { Accounts } from './Accounts.js';
import { SKINS, DEFAULT_SKIN, skinUnlocked } from '../shared/skins.js';

const BOT_NAMES = ['Sgt Morel', 'Cpl Vasseur', 'Lt Garnier', 'Adj Roche', 'Sgt Kessel', 'Cpl Dumas', 'Lt Brandt', 'Adj Ferrand',
  'Sgt Lorca', 'Cpl Niel', 'Lt Arago', 'Adj Colin', 'Sgt Verne', 'Cpl Malot', 'Lt Hugo', 'Adj Bazin'];

const SHELL_STEP = 0.25; // m, pas de test de collision des obus
const ALL_TANKS = process.env.TANK3D_UNLOCK === '1'; // tous les chars débloqués (tests)
const MODES = ['skirmish', 'campaign', 'race'];
const RACE_TEAM = 'red'; // en course tout le monde est dans la même « équipe » : chacun pour soi, personne n'est un ennemi caché
const VISION_INTERVAL = 3; // ticks entre deux calculs de détection (20 Hz)

export class Room {
  constructor({ lanUrls = [] } = {}) {
    this.lanUrls = lanUrls;
    this.players = new Map();
    this.nextId = 1;
    this.nextShellId = 1;
    this.hostId = null;
    this.settings = {
      roundsToWin: RULES.defaultRoundsToWin, map: DEFAULT_MAP, mode: 'skirmish', mission: MISSIONS[0].id, difficulty: 'normal',
      raceMap: DEFAULT_RACE_MAP, laps: RACE_RULES.defaultLaps,
    };
    // tant que l'hôte n'a pas choisi une autre mission, on propose la plus avancée débloquée
    this.autoMission = true;
    this.navs = new Map(); // grilles de navigation des bots, par carte et par taille de char
    this.tick = 0;
    this.events = [];
    this.timers = []; // actions différées (barrages d'artillerie)
    this.stateDirty = false;
    this.campaign = new Campaign(this);
    this.race = new Race(this);
    this.accounts = new Accounts();
    this.debrief = null;
    this.paused = false; // partie mise en pause par l'hôte
    this.broken = new Set(); // objets du décor détruits pendant la manche (clés objectKey)
    this.objHp = new Map(); // points de structure restants des objets entamés
    this.kicked = new Map(); // pseudo (minuscules) -> fin de l'exclusion (ms)
    this.report = null; // rapport de la dernière bataille d'escarmouche
    this.reportSeq = 0;
    this.toLobby();
  }

  get isCampaign() {
    return this.settings.mode === 'campaign';
  }

  get isRace() {
    return this.settings.mode === 'race';
  }

  // Carte d'origine (données fixes)
  get baseMap() {
    return mapFor(this.settings);
  }

  // Carte en jeu : sans les objets détruits pendant la manche
  get map() {
    return withBroken(this.baseMap, this.broken);
  }

  get nav() {
    return this.navFor(TANK_TYPES[DEFAULT_TANK].radius);
  }

  // Grille de navigation pour un char de ce rayon. En campagne, les unités fixes (tourelles,
  // bâtiments) comptent comme des obstacles.
  navFor(radius) {
    const mapKey = this.isCampaign ? `m:${this.settings.mission}` : this.settings.map;
    const key = `${mapKey}|${radius}`;
    if (!this.navs.has(key)) {
      let map = this.baseMap;
      if (this.isCampaign) {
        const fixed = getMission(this.settings.mission).units.filter((u) => UNIT_TYPES[u.t].static);
        map = { ...map, circles: [...map.circles, ...fixed.map((u) => ({ x: u.x, z: u.z, r: UNIT_TYPES[u.t].radius }))] };
      }
      this.navs.set(key, new NavGrid(map, radius));
    }
    return this.navs.get(key);
  }

  defOf(p) {
    return UNIT_TYPES[p.activeType] ?? TANK_TYPES[DEFAULT_TANK];
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  // Exécute fn dans `ticks` ticks (si la partie continue).
  later(ticks, fn) {
    this.timers.push({ at: this.tick + ticks, fn });
  }

  // ---------------------------------------------------------------- boucle

  start() {
    let last = performance.now();
    let acc = 0;
    setInterval(() => {
      const now = performance.now();
      acc = Math.min(acc + now - last, 250);
      last = now;
      while (acc >= TICK_MS) {
        this.step();
        acc -= TICK_MS;
      }
    }, 4);
  }

  step() {
    this.tick++;
    const live = this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'roundEnd';
    if (this.paused && !live) this.paused = false;
    if (this.paused) {
      // tout est figé : les actions différées glissent avec le temps de pause
      for (const t of this.timers) t.at++;
    } else if (live) {
      this.stepTanks();
      this.stepShells();
      if (this.tick % VISION_INTERVAL === 0) this.stepVision();
    }
    if (this.phase === 'playing' && !this.paused) {
      if (this.isCampaign) {
        if (this.timers.length) {
          const due = this.timers.filter((t) => t.at <= this.tick);
          this.timers = this.timers.filter((t) => t.at > this.tick);
          for (const t of due) t.fn();
        }
        this.campaign.step();
      } else if (this.isRace) {
        this.race.step();
      } else {
        this.stepZone();
        if (this.phase === 'playing') this.checkElimination();
      }
    }
    if (!this.paused) this.stepPhase();

    if (this.events.length) {
      this.broadcast({ type: 'ev', list: this.events });
      this.events = [];
    }
    if (this.stateDirty) this.broadcastState();
    if (this.tick % SNAPSHOT_INTERVAL === 0) this.sendSnapshots();
    if (this.tick % (5 * TICK_RATE) === 0) this.dropSilent();
  }

  // Un client qui ne donne plus signe de vie (Wi-Fi coupé, PC en veille) libère sa place et son
  // compte : sans cela, son compte resterait « déjà connecté ». Le navigateur répond tout seul aux
  // pings WebSocket, même onglet en arrière-plan.
  dropSilent() {
    const limit = Date.now() - 16000;
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      if (p.heard < limit) p.ws.terminate();
      else if (p.ws.readyState === 1) p.ws.ping();
    }
  }

  // ------------------------------------------------------------ connexions

  newPlayer(fields) {
    return {
      id: this.nextId++, ws: null, bot: false, unit: false, name: '', joined: false, team: null, type: DEFAULT_TANK, skin: DEFAULT_SKIN,
      kills: 0, deaths: 0, dmg: 0,
      inRound: false, alive: false, hp: 0, maxHp: 0, tank: null,
      queue: [], lastSeq: 0, lastQueuedSeq: 0, tokens: 0,
      ...fields,
    };
  }

  // local : le joueur est sur le PC qui fait tourner le serveur (il est l'hôte en priorité)
  addClient(ws, local = false) {
    const p = this.newPlayer({ ws, heard: Date.now(), local });
    ws.on('pong', () => (p.heard = Date.now()));
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') this.onMessage(p, msg);
    });
    ws.on('close', () => this.removePlayer(p));
    ws.on('error', () => {});
  }

  addBot(team) {
    if (this.teamMembers(team).length >= (this.isRace ? RACE_RULES.maxPlayers : RULES.maxPlayersPerTeam)) return;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextId}`;
    const p = this.newPlayer({ bot: true, brain: this.isRace ? new RaceBrain() : new BotBrain(), name, joined: true, team });
    this.players.set(p.id, p);
    this.stateDirty = true;
  }

  // Unité de campagne (ennemi, tourelle, structure, boss) : un « joueur » piloté par le serveur.
  spawnUnit(type, team, x, z, yaw, { mode, hpMul = 1, dmgMul = 1, rof = 1, skill, obj = false, tag = null }) {
    const def = UNIT_TYPES[type];
    const maxHp = Math.round(def.maxHp * hpMul);
    const p = this.newPlayer({
      bot: true, unit: true, joined: true, name: def.name, team, type, activeType: type,
      inRound: true, alive: true, hp: maxHp, maxHp, dmgMul, obj, tag,
      tank: createTankState(x, z, yaw),
      brain: new UnitBrain({ mode, home: { x, z }, skill }),
    });
    p.tank.ty = yaw;
    p.tank.rof = p.baseRof = rof;
    this.players.set(p.id, p);
    this.stateDirty = true;
    return p;
  }

  removeUnit(p) {
    if (this.players.delete(p.id)) this.stateDirty = true;
  }

  removePlayer(p) {
    this.accounts.logout(p.account);
    p.account = null;
    if (!this.players.delete(p.id)) return;
    if (!p.bot) console.log(`  - ${p.name} a quitté le salon`);
    if (p.inRound && p.alive && !this.isRace) this.events.push({ k: 'kill', by: null, id: p.id });
    if (p.inRound) this.checkSquadLeft();
    const humans = this.humans();
    if (this.hostId === p.id) this.hostId = (humans.find((h) => h.local) ?? humans[0])?.id ?? null;
    if (humans.length === 0) {
      // plus aucun humain : on vide le salon (bots compris)
      this.players.clear();
      this.autoMission = true;
      this.toLobby();
    }
    if (this.phase === 'lobby') this.checkMission();
    this.stateDirty = true;
  }

  // Un joueur quitte la manche en cours (passage en spectateur ou changement d'équipe) : son char
  // disparaît comme s'il avait été détruit, il entrera de nouveau à la prochaine manche s'il a une équipe.
  leaveRound(p) {
    if (!p.inRound) return;
    if (p.alive && !this.isRace) this.events.push({ k: 'kill', by: null, id: p.id });
    p.inRound = false;
    p.alive = false;
    p.respawn = 0;
    p.queue = [];
    this.checkSquadLeft();
  }

  // Campagne : si plus personne de l'escouade n'est en jeu, la mission échoue (sinon elle resterait bloquée).
  checkSquadLeft() {
    if (!this.isCampaign || this.phase === 'lobby' || this.phase === 'debrief' || this.campaign.done) return;
    if (!this.campaign.squad().length) this.campaign.finish(false, 'L’escouade a quitté le terrain');
  }

  // Exclusion par l'hôte : le joueur est déconnecté et ne peut pas revenir avant une minute.
  kick(target) {
    const until = Date.now() + 60000;
    if (target.account) this.kicked.set(target.account.name.toLowerCase(), until);
    console.log(`  x ${target.name} a été exclu par l'hôte`);
    this.events.push({ k: 'toast', text: `${target.name} a été exclu`, c: '' });
    this.send(target, { type: 'kicked' });
    target.ws?.close();
    this.removePlayer(target);
  }

  // ------------------------------------------------------------ comptes

  // Progression de son compte, envoyée au seul joueur concerné.
  sendAccount(p) {
    if (!p.account) return;
    const pr = p.account.progress;
    this.send(p, {
      type: 'account', name: p.account.name, cleared: pr.cleared, xp: pr.xp ?? 0,
      credits: pr.credits ?? 0, tanks: ownedTanks(pr, ALL_TANKS),
    });
  }

  canUseTank(p, type) {
    return Object.hasOwn(TANK_TYPES, type) && tankOwned(type, p.account?.progress, ALL_TANKS);
  }

  // Récompenses de fin de partie ou de mission : XP et crédits enregistrés sur le compte, puis le
  // détail est envoyé au joueur (rapport de bataille / rapport de mission).
  giveRewards(p, xpParts, crParts) {
    if (!p.account) return;
    const pr = p.account.progress;
    const before = rankIndex(pr.xp ?? 0);
    const xp = this.accounts.addXp(p.account, sumParts(xpParts));
    const credits = this.accounts.addCredits(p.account, sumParts(crParts));
    const after = rankIndex(xp);
    this.send(p, {
      type: 'reward', report: this.reportSeq,
      xp: { parts: xpParts, gained: sumParts(xpParts), total: xp },
      cr: { parts: crParts, gained: sumParts(crParts), total: credits },
      rankUp: after > before ? RANKS[after].name : null,
    });
    this.sendAccount(p);
    if (after > before) {
      this.events.push({ k: 'toast', text: `${p.name} est promu ${RANKS[after].name}`, c: 'green' });
      this.stateDirty = true; // le grade s'affiche à côté du pseudo
    }
  }

  // Fin d'une partie d'escarmouche : rapport de bataille pour tout le monde, récompenses pour
  // chaque joueur engagé jusqu'au bout.
  endSkirmish(winner) {
    this.reportSeq++;
    this.report = {
      id: this.reportSeq, winner, score: { ...this.score }, rounds: this.round, map: this.settings.map,
      players: this.teamMembers('red').concat(this.teamMembers('blue')).filter((p) => p.inMatch)
        .map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, kills: p.kills, deaths: p.deaths, dmg: Math.round(p.dmg ?? 0) })),
    };
    for (const p of this.humans()) {
      if (!p.inMatch || !p.team) continue;
      const won = p.team === winner;
      this.giveRewards(p,
        skirmishXp({ dmg: p.dmg, kills: p.kills, roundsWon: this.score[p.team], won }),
        skirmishCredits({ dmg: p.dmg, kills: p.kills, deaths: p.deaths, won }));
    }
  }

  // Fin de mission (réussie ou non) : récompenses pour chaque joueur de l'escouade.
  awardMission(result) {
    this.reportSeq++;
    const stars = DIFFICULTIES[this.settings.difficulty]?.stars ?? 1;
    for (const p of this.humans()) {
      if (!p.inMatch) continue;
      this.giveRewards(p,
        missionXp({ dmg: p.dmg, kills: p.kills, success: result.success, stars }),
        missionCredits({ success: result.success, stars: result.stars, prevStars: p.prevStars ?? 0 }));
    }
  }

  // Une mission est ouverte à l'escouade si l'un des joueurs présents l'a débloquée.
  missionOpen(id) {
    const humans = this.humans();
    if (!humans.length) return isUnlocked({}, id);
    return humans.some((p) => isUnlocked(p.account?.progress.cleared, id));
  }

  // Mission la plus avancée ouverte à l'escouade.
  latestMission() {
    return MISSIONS.filter((m) => this.missionOpen(m.id)).at(-1)?.id ?? MISSIONS[0].id;
  }

  // Par défaut, la mission proposée est la dernière débloquée ; si la mission choisie n'est plus ouverte
  // (son joueur est parti), on revient aussi à la plus avancée encore ouverte.
  checkMission() {
    if (this.autoMission || !this.missionOpen(this.settings.mission)) this.settings.mission = this.latestMission();
  }

  // Mission réussie avec `stars` étoiles (= difficulté) : chaque joueur qui l'a jouée l'enregistre
  // sur son compte. Renvoie les pseudos dont c'est un nouveau record.
  recordClear(missionId, stars) {
    const records = [];
    for (const p of this.humans()) {
      if (!p.account || !p.inRound) continue;
      if (this.accounts.recordClear(p.account, missionId, stars)) records.push(p.name);
      this.sendAccount(p);
    }
    return records;
  }

  onMessage(p, msg) {
    if (msg.type === 'join') {
      if (p.joined) return;
      const ban = typeof msg.name === 'string' ? this.kicked.get(msg.name.trim().toLowerCase()) : 0;
      if (ban > Date.now()) {
        this.send(p, { type: 'loginError', error: `Tu as été exclu par l'hôte. Réessaie dans ${Math.ceil((ban - Date.now()) / 1000)} s.` });
        return;
      }
      // connexion au compte (créé au premier passage) ; en cas d'erreur le joueur peut réessayer
      const res = this.accounts.login(msg.name, msg.password);
      if (res.error) {
        this.send(p, { type: 'loginError', error: res.error });
        return;
      }
      p.joined = true;
      p.account = res.account;
      p.name = res.account.name;
      // dernier skin choisi sur ce compte (s'il est toujours débloqué)
      const saved = res.account.progress.skin;
      if (skinUnlocked(saved, res.account.progress.cleared)) p.skin = saved;
      // dernier char choisi (s'il est toujours débloqué)
      if (this.canUseTank(p, res.account.progress.tank)) p.type = res.account.progress.tank;
      this.players.set(p.id, p);
      // le joueur du PC serveur reprend la main d'hôte dès qu'il se connecte
      if (this.hostId === null || (p.local && !this.players.get(this.hostId)?.local)) this.hostId = p.id;
      console.log(`  + ${p.name} a rejoint le salon${res.created ? ' (nouveau compte)' : ''}`);
      this.send(p, { type: 'welcome', id: p.id, lanUrls: this.lanUrls, created: res.created });
      this.sendAccount(p);
      if (this.phase === 'lobby') this.checkMission();
      this.stateDirty = true;
      return;
    }
    if (!p.joined) return;
    const isHost = p.id === this.hostId;

    switch (msg.type) {
      case 'in': {
        if (!p.inRound || !p.alive || !Number.isInteger(msg.seq) || msg.seq <= p.lastQueuedSeq) return;
        p.lastQueuedSeq = msg.seq;
        const inp = sanitizeInput(msg);
        inp.seq = msg.seq;
        p.queue.push(inp);
        if (p.queue.length > 60) p.queue.shift(); // client trop en avance : on jette le plus vieux
        break;
      }
      case 'ping':
        this.send(p, { type: 'pong', t: msg.t });
        break;
      case 'chat': {
        // message texte à tout le salon (limité en taille et en cadence)
        if (typeof msg.text !== 'string') return;
        const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
        if (!text || !this.allow(p, 'chatAt', 400)) return;
        this.broadcast({ type: 'chat', id: p.id, name: p.name, team: p.team, text });
        break;
      }
      case 'respawn':
        // course : retour au dernier point de passage (touche R), avec pénalité
        if (this.isRace && this.phase === 'playing' && p.inRound && p.race && !p.race.fin && this.allow(p, 'respawnAt', 2500)) this.race.respawn(p, 'manual');
        break;
      case 'mark': {
        // signalement sur la carte (point, ou char ennemi ciblé), envoyé aux seuls coéquipiers
        if (this.isRace) return;
        const x = Number(msg.x), z = Number(msg.z);
        if (!Number.isFinite(x) || !Number.isFinite(z) || !this.allow(p, 'markAt', 300)) return;
        const m = this.map;
        const target = this.players.get(msg.target);
        const out = {
          type: 'mark', id: p.id, name: p.name,
          x: +Math.max(-m.halfX, Math.min(m.halfX, x)).toFixed(1), z: +Math.max(-m.halfZ, Math.min(m.halfZ, z)).toFixed(1),
          target: target && target.alive && target.team !== p.team ? target.id : null,
        };
        for (const q of this.players.values()) if (q.team === p.team) this.send(q, out);
        break;
      }
      case 'team': {
        let team = msg.team === null ? null : TEAMS.includes(msg.team) ? msg.team : undefined;
        if (this.isCampaign && team) team = CAMPAIGN_RULES.playerTeam; // en campagne, tout le monde est dans l'escouade
        if (this.isRace && team) team = RACE_TEAM; // en course, tout le monde est sur la grille
        if (team === undefined || team === p.team) return;
        if (team && this.teamMembers(team).length >= (this.isRace ? RACE_RULES.maxPlayers : RULES.maxPlayersPerTeam)) return;
        // Partie lancée : les équipes de la partie sont figées jusqu'à sa fin (toutes les manches). Un joueur de la
        // partie ne peut que passer en spectateur, et n'y revient plus. Les autres (arrivés en cours de route, ou
        // sortis) peuvent choisir leur équipe pour la PROCHAINE partie : ils regardent celle-ci en spectateurs.
        if (this.phase !== 'lobby' && p.inMatch) {
          if (team !== null) return;
          this.leaveRound(p);
          p.inMatch = false;
        }
        p.team = team;
        this.stateDirty = true;
        break;
      }
      case 'kick': {
        // l'hôte exclut un joueur (humain) ; un bot est simplement retiré
        const target = this.players.get(msg.id);
        if (!isHost || !target || target === p || target.unit) return;
        if (target.bot) {
          this.leaveRound(target);
          this.removePlayer(target);
        } else {
          this.kick(target);
        }
        break;
      }
      case 'pause': {
        const live = this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'roundEnd';
        if (!isHost || !live || typeof msg.on !== 'boolean' || msg.on === this.paused) return;
        this.paused = msg.on;
        this.events.push({ k: 'pause', on: msg.on });
        this.stateDirty = true;
        break;
      }
      case 'tank':
        // le char se choisit au salon ; il s'applique à la prochaine manche
        // (seulement un char débloqué par son compte ; mémorisé pour les prochaines connexions)
        if (typeof msg.tank === 'string' && msg.tank !== p.type && this.canUseTank(p, msg.tank)) {
          p.type = msg.tank;
          this.accounts.setTank(p.account, msg.tank);
          this.stateDirty = true;
        }
        break;
      case 'buy': {
        // achat d'un char au Store avec ses crédits ; il est équipé aussitôt
        const type = msg.tank;
        if (!p.account || typeof type !== 'string' || !Object.hasOwn(TANK_TYPES, type) || !tankPrice(type)) return;
        const error = this.canUseTank(p, type) ? 'Tu possèdes déjà ce char.' : this.accounts.buyTank(p.account, type, tankPrice(type));
        if (error) {
          this.send(p, { type: 'buyError', tank: type, error });
          return;
        }
        console.log(`  $ ${p.name} achète le ${TANK_TYPES[type].name} (${fmtCr(tankPrice(type))})`);
        this.send(p, { type: 'bought', tank: type });
        this.sendAccount(p);
        p.type = type;
        this.accounts.setTank(p.account, type);
        this.stateDirty = true;
        break;
      }
      case 'skin':
        // skin débloqué par son compte uniquement ; mémorisé pour les prochaines connexions
        if (typeof msg.skin === 'string' && Object.hasOwn(SKINS, msg.skin) && msg.skin !== p.skin && skinUnlocked(msg.skin, p.account?.progress.cleared)) {
          p.skin = msg.skin;
          this.accounts.setSkin(p.account, msg.skin);
          this.stateDirty = true;
        }
        break;
      case 'settings':
        if (!isHost || this.phase !== 'lobby') return;
        if (Number.isInteger(msg.roundsToWin) && msg.roundsToWin >= 1 && msg.roundsToWin <= 9) this.settings.roundsToWin = msg.roundsToWin;
        if (typeof msg.map === 'string' && Object.hasOwn(MAPS, msg.map)) this.settings.map = msg.map;
        if (typeof msg.raceMap === 'string' && Object.hasOwn(RACE_MAPS, msg.raceMap)) this.settings.raceMap = msg.raceMap;
        if (MODES.includes(msg.mode) && msg.mode !== this.settings.mode) this.setMode(msg.mode);
        if (typeof msg.mission === 'string' && Object.hasOwn(MISSION_INDEX, msg.mission) && this.missionOpen(msg.mission)) {
          this.settings.mission = msg.mission;
          this.autoMission = msg.mission === this.latestMission();
        }
        if (Object.hasOwn(DIFFICULTIES, msg.difficulty)) this.settings.difficulty = msg.difficulty;
        if (RACE_RULES.laps.includes(msg.laps)) this.settings.laps = msg.laps;
        this.stateDirty = true;
        break;
      case 'addBot':
        if (isHost && this.phase === 'lobby' && TEAMS.includes(msg.team)) this.addBot(this.isCampaign ? CAMPAIGN_RULES.playerTeam : this.isRace ? RACE_TEAM : msg.team);
        break;
      case 'removeBot': {
        const bot = this.players.get(msg.id);
        if (isHost && this.phase === 'lobby' && bot?.bot && !bot.unit) this.removePlayer(bot);
        break;
      }
      case 'start':
        if (isHost && this.phase === 'lobby' && TEAMS.some((t) => this.teamMembers(t).length)) this.startMatch();
        break;
      case 'debrief':
        // fin de mission : l'hôte enchaîne (mission suivante, rejouer) ou revient au salon
        if (!isHost || this.phase !== 'debrief') return;
        if (msg.action === 'next' && this.debrief?.next && this.missionOpen(this.debrief.next)) {
          this.settings.mission = this.debrief.next;
          this.startMatch();
        } else if (msg.action === 'retry') {
          this.startMatch();
        } else if (msg.action === 'lobby') {
          this.toLobby();
        }
        break;
      case 'abort':
        if (isHost && this.phase !== 'lobby') this.toLobby();
        break;
    }
  }

  // Changer de mode : en campagne, tout le monde rejoint l'escouade et les bots d'en face partent.
  setMode(mode) {
    this.settings.mode = mode;
    if (mode === 'race') {
      // tout le monde sur la grille ; les bots reçoivent un pilote de course (dans la limite des places)
      let n = 0;
      for (const p of [...this.players.values()]) {
        if (p.unit) { this.players.delete(p.id); continue; }
        if (p.team && ++n > RACE_RULES.maxPlayers) {
          if (p.bot) this.players.delete(p.id);
          else p.team = null;
          continue;
        }
        if (p.team) p.team = RACE_TEAM;
        if (p.bot) p.brain = new RaceBrain();
      }
      return;
    }
    for (const p of this.players.values()) if (p.bot && !p.unit && !(p.brain instanceof BotBrain)) p.brain = new BotBrain();
    if (mode !== 'campaign') return;
    this.checkMission();
    for (const p of [...this.players.values()]) {
      if (p.bot && p.team !== CAMPAIGN_RULES.playerTeam) this.players.delete(p.id);
      else if (p.team) p.team = CAMPAIGN_RULES.playerTeam;
    }
  }

  send(p, obj) {
    if (p.ws?.readyState === 1) p.ws.send(JSON.stringify(obj));
  }

  // Anti-spam : au plus une action `key` toutes les `ms` millisecondes par joueur.
  allow(p, key, ms) {
    const now = Date.now();
    if (now - (p[key] ?? 0) < ms) return false;
    p[key] = now;
    return true;
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws?.readyState === 1) p.ws.send(data);
  }

  broadcastState() {
    this.stateDirty = false;
    this.broadcast({
      type: 'state',
      phase: this.phase,
      paused: this.paused,
      broken: [...this.broken],
      hostId: this.hostId,
      round: this.round,
      score: this.score,
      settings: this.settings,
      unlocked: MISSIONS.filter((m) => this.missionOpen(m.id)).map((m) => m.id), // missions ouvertes à l'escouade
      debrief: this.phase === 'debrief' ? this.debrief : null,
      report: this.report,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, team: p.team, type: p.type, skin: p.skin, bot: p.bot, unit: p.unit || undefined, obj: p.obj || undefined,
        kills: p.kills, deaths: p.deaths, im: p.inMatch || undefined,
        rk: p.account ? rankIndex(p.account.progress.xp ?? 0) : undefined, // grade
      })),
    });
  }

  sendSnapshots() {
    const msg = {
      tick: this.tick,
      ph: this.phase,
      pa: this.paused ? 1 : 0,
      tl: Number.isFinite(this.phaseTicks) ? this.phaseTicks : 0,
      zone: { team: this.zone.team, p: this.zone.progress, c: this.zone.contested },
      pl: this.roundPlayers().map((p) => {
        const o = {
          id: p.id, x: +p.tank.x.toFixed(3), z: +p.tank.z.toFixed(3), yaw: +p.tank.yaw.toFixed(4), sp: +p.tank.speed.toFixed(3),
          ty: +p.tank.ty.toFixed(4), rl: p.tank.reload, hp: p.hp, mh: p.maxHp, al: p.alive, tk: p.activeType,
        };
        if (p.tank.rof !== 1) o.rf = p.tank.rof;
        if (p.tank.shots) o.bc = p.tank.shots; // obus déjà tirés dans la rafale en cours
        if (p.tank.aim > 0.005) o.ad = +p.tank.aim.toFixed(3); // flou de visée (cercle de précision)
        if (p.buffs?.shield > 0 || p.invuln > 0 || this.campaign.isShielded(p)) o.sh = 1;
        if (p.buffs && (p.buffs.rapid || p.buffs.damage || p.buffs.shield)) o.bf = [p.buffs.rapid, p.buffs.damage, p.buffs.shield];
        if (!p.alive && p.respawn > 0) o.rs = p.respawn;
        if (p.buffs?.damage > 0) o.db = 1;
        if (p.spotted) o.vi = 1; // visible par l'équipe adverse
        if (this.isRace) {
          // course : altitude, vol, poussée reçue et turbo (même état que la simulation partagée)
          const t = p.tank;
          o.y = +t.y.toFixed(2);
          if (t.air) o.av = +t.vy.toFixed(2);
          if (t.kx || t.kz) { o.kx = +t.kx.toFixed(2); o.kz = +t.kz.toFixed(2); }
          if (t.kw) o.kw = +t.kw.toFixed(3);
          if (t.boost > 0) o.bs = t.boost;
          if (p.race?.hold > 0) o.hd = 1;
        }
        return o;
      }),
    };
    if (this.isCampaign && this.phase !== 'lobby') {
      msg.cm = this.campaign.info();
      msg.pk = this.campaign.pickups.map((pk) => [pk.id, pk.k, +pk.x.toFixed(2), +pk.z.toFixed(2)]);
    }
    if (this.isRace && this.phase !== 'lobby') msg.rc = this.race.info();
    const body = JSON.stringify(msg).slice(1);
    for (const p of this.players.values()) {
      // `ack` = dernière commande du joueur prise en compte : sert à la réconciliation côté client
      if (p.ws?.readyState === 1) p.ws.send(`{"type":"snap","ack":${p.lastSeq},${body}`);
    }
  }

  // --------------------------------------------------------------- phases

  teamMembers(team) {
    return [...this.players.values()].filter((p) => p.team === team && !p.unit);
  }

  // Équipiers engagés dans la partie en cours (figés au lancement, voir startMatch).
  matchMembers(team) {
    return this.teamMembers(team).filter((p) => p.inMatch);
  }

  roundPlayers() {
    return [...this.players.values()].filter((p) => p.inRound);
  }

  clearUnits() {
    for (const p of [...this.players.values()]) if (p.unit) this.players.delete(p.id);
  }

  toLobby() {
    this.phase = 'lobby';
    this.paused = false;
    this.resetDecor();
    this.phaseTicks = 0;
    this.round = 0;
    this.score = { red: 0, blue: 0 };
    this.shells = [];
    this.timers = [];
    this.zone = { team: null, progress: 0, contested: false };
    this.teamActive = { red: false, blue: false };
    this.debrief = null;
    this.campaign.done = true;
    this.race.done = true;
    this.checkMission(); // retour au salon : une mission vient peut-être d'être débloquée
    this.clearUnits();
    for (const p of this.players.values()) {
      p.inRound = false;
      p.alive = false;
      p.inMatch = false; // de retour au salon : chacun peut de nouveau choisir son équipe
    }
    this.stateDirty = true;
  }

  startMatch() {
    this.paused = false;
    this.round = 0;
    this.score = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.dmg = 0;
      // les équipes de la partie sont figées ici, jusqu'à la fin de la partie (toutes les manches)
      p.inMatch = !!p.team && !p.unit;
    }
    if (this.isCampaign) this.startMission();
    else if (this.isRace) this.startRace();
    else this.startRound();
  }

  // Place un membre d'équipe au départ d'une manche ou d'une mission.
  enterRound(p, x, z, yaw) {
    p.tank = createTankState(x, z, yaw);
    p.activeType = p.type; // le char reste le même pendant toute la manche
    p.maxHp = TANK_TYPES[p.type].maxHp;
    p.hp = p.maxHp;
    p.alive = true;
    p.inRound = true;
    p.queue = [];
    p.tokens = 0;
    p.lastQueuedSeq = p.lastSeq;
    p.respawn = 0;
    p.dmgMul = 1;
    p.seenTick = -Infinity; // personne n'est détecté en début de manche
    p.firedTick = -Infinity;
    p.spotted = false;
  }

  // Chaque manche (ou mission) repart d'un décor intact.
  resetDecor() {
    if (this.broken.size) this.stateDirty = true;
    this.broken = new Set();
    this.objHp = new Map();
  }

  startRound() {
    this.round++;
    this.resetDecor();
    this.shells = [];
    this.zone = { team: null, progress: 0, contested: false };
    for (const p of this.players.values()) p.inRound = false;
    for (const team of TEAMS) {
      const members = this.matchMembers(team);
      this.teamActive[team] = members.length > 0;
      members.forEach((p, i) => {
        const sp = this.map.spawns[team][i % this.map.spawns[team].length];
        this.enterRound(p, sp.x, sp.z, sp.yaw);
        if (p.bot && !(p.brain instanceof BotBrain)) p.brain = new BotBrain();
        p.brain?.reset();
      });
    }
    this.phase = 'countdown';
    this.phaseTicks = RULES.countdownTicks;
    this.events.push({ k: 'roundStart', n: this.round });
    this.stateDirty = true;
  }

  startMission() {
    this.round = 1;
    this.resetDecor();
    this.shells = [];
    this.timers = [];
    this.debrief = null;
    this.clearUnits();
    for (const p of this.players.values()) p.inRound = false;
    const team = CAMPAIGN_RULES.playerTeam;
    for (const p of this.matchMembers(team)) {
      this.enterRound(p, 0, 0, 0); // position définitive donnée par la campagne
      p.maxHp = p.hp = Math.round(p.maxHp * CAMPAIGN_RULES.playerHp);
      p.prevStars = p.account?.progress.cleared[this.settings.mission] ?? 0; // pour les primes de première réussite
      if (p.bot) p.brain = new UnitBrain({ mode: 'ally', home: { x: 0, z: 0 }, skill: { reaction: 0.4, aim: 0.035 } });
    }
    this.campaign.start(this.settings.mission, this.settings.difficulty);
    this.phase = 'countdown';
    this.phaseTicks = RULES.countdownTicks;
    const m = getMission(this.settings.mission);
    this.events.push({ k: 'missionStart', id: m.id });
    this.stateDirty = true;
  }

  // Course : tout le monde sur la grille, compte à rebours, puis feu vert (server/Race.js).
  startRace() {
    this.round = 1;
    this.resetDecor();
    this.shells = [];
    this.timers = [];
    this.debrief = null;
    this.clearUnits();
    for (const p of this.players.values()) p.inRound = false;
    for (const p of this.matchMembers(RACE_TEAM)) {
      p.maxHp = p.hp = TANK_TYPES[p.type].maxHp;
      if (p.bot) p.brain = new RaceBrain();
    }
    this.race.start(this.settings.laps);
    this.phase = 'countdown';
    this.phaseTicks = RULES.countdownTicks;
    this.events.push({ k: 'raceStart', laps: this.settings.laps });
    this.stateDirty = true;
  }

  endRace(result) {
    this.debrief = result;
    this.phase = 'debrief';
    this.phaseTicks = 0;
    this.events.push({ k: 'raceEnd', first: result.results[0]?.id ?? null });
    console.log(`  Course terminée : ${result.results.map((r) => `${r.rank}. ${r.name}`).join(', ')}`);
    this.stateDirty = true;
  }

  endMission(result) {
    this.debrief = result;
    this.phase = 'debrief';
    this.phaseTicks = 0;
    this.timers = [];
    this.events.push({ k: 'missionEnd', ...result });
    this.awardMission(result);
    console.log(`  Mission « ${result.name} » : ${result.success ? `réussie (${result.stars}★)` : 'échouée'}`);
    this.stateDirty = true;
  }

  endRound(winner, reason) {
    if (winner) this.score[winner]++;
    this.lastWinner = winner;
    this.phase = 'roundEnd';
    this.phaseTicks = RULES.roundEndTicks;
    this.events.push({ k: 'roundEnd', winner, reason, score: this.score });
    this.stateDirty = true;
  }

  stepPhase() {
    if (this.phase === 'lobby' || this.phase === 'debrief') return;
    if (--this.phaseTicks > 0) return;
    switch (this.phase) {
      case 'countdown':
        this.phase = 'playing';
        this.phaseTicks = this.isCampaign || this.isRace ? Infinity : RULES.roundTicks; // pas de limite de temps en campagne ni en course (voir Race)
        this.stateDirty = true;
        break;
      case 'playing': {
        // temps écoulé : l'équipe avec le plus de points de vie restants l'emporte
        const hp = { red: 0, blue: 0 };
        for (const p of this.roundPlayers()) if (p.alive) hp[p.team] += p.hp;
        this.endRound(hp.red > hp.blue ? 'red' : hp.blue > hp.red ? 'blue' : null, 'time');
        break;
      }
      case 'roundEnd':
        if (this.lastWinner && this.score[this.lastWinner] >= this.settings.roundsToWin) {
          this.phase = 'matchEnd';
          this.phaseTicks = RULES.matchEndTicks;
          this.events.push({ k: 'matchEnd', winner: this.lastWinner, score: this.score });
          this.endSkirmish(this.lastWinner);
          this.stateDirty = true;
        } else {
          this.startRound();
        }
        break;
      case 'matchEnd':
        this.toLobby();
        break;
    }
  }

  // ----------------------------------------------------------- simulation

  stepTanks() {
    const countdown = this.phase === 'countdown';
    const clock = this.isRace ? this.race.clock : 0;
    const all = this.roundPlayers();
    const discs = all.map((o) => ({ x: o.tank.x, z: o.tank.z, r: this.defOf(o).radius }));
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (!p.alive) continue;
      // Jeton = droit de simuler une commande. ~1 par tick, avec une petite réserve pour
      // absorber les paquets arrivés en rafale sans laisser un client accélérer le temps.
      p.tokens = Math.min(p.tokens + 1.1, 15);
      if (!p.bot && !p.queue.length) continue;
      const def = this.defOf(p);
      const frozen = countdown || p.race?.hold > 0; // course : bloqué un instant après un retour en piste
      const others = def.static ? null : discs.filter((_, j) => j !== i);
      if (p.bot) {
        const cmd = p.brain instanceof RaceBrain ? p.brain.think(p, this, def)
          : p.brain instanceof UnitBrain ? p.brain.think(p, this, def) : p.brain.think(p, this, this.nav, def);
        if (stepTank(p.tank, cmd, def, this.map, others, frozen, clock)) this.fire(p, def);
        discs[i].x = p.tank.x;
        discs[i].z = p.tank.z;
        continue;
      }
      while (p.queue.length && p.tokens >= 1) {
        const inp = p.queue.shift();
        p.tokens--;
        p.lastSeq = inp.seq;
        p.range = inp.rg;
        if (stepTank(p.tank, inp, def, this.map, others, frozen, clock)) this.fire(p, def);
      }
      discs[i].x = p.tank.x;
      discs[i].z = p.tank.z;
    }
  }

  // Détection (shared/vision.js) : p.spotted = visible par l'équipe adverse. Un char repéré par un seul
  // adversaire l'est pour toute l'équipe, et le reste SPOT_LINGER s après la dernière détection.
  // En campagne, tout le monde reste visible (missions, objectifs et IA n'en tiennent pas compte).
  stepVision() {
    const all = this.roundPlayers();
    if (this.isCampaign || this.isRace) {
      for (const p of all) p.spotted = true;
      return;
    }
    const linger = SPOT_LINGER * TICK_RATE, fireWin = FIRE_REVEAL * TICK_RATE;
    const eyes = new Map(all.map((p) => [p, {
      t: p.tank, dims: this.defOf(p), fired: this.tick - (p.firedTick ?? -Infinity) <= fireWin,
    }]));
    for (const p of all) {
      if (!p.alive) { p.spotted = false; continue; }
      const me = eyes.get(p);
      if (all.some((o) => o.alive && o.team !== p.team && detects(eyes.get(o), me, this.map))) p.seenTick = this.tick;
      p.spotted = this.tick - p.seenTick <= linger;
    }
  }

  // Multiplicateur de dégâts du tireur (difficulté pour l'IA, bonus « obus perforants » pour l'escouade).
  dmgMulOf(p) {
    return (p.dmgMul ?? 1) * (p.buffs?.damage > 0 ? 1.6 : 1);
  }

  // Tir d'une unité selon son arme : canon(s), rafales, mortier.
  fire(p, def) {
    if (def.weapon === null) return;
    p.firedTick = this.tick; // les buissons proches ne cachent plus le tireur (shared/vision.js)
    if (def.weapon === 'mortar') {
      // obusier d'un joueur : l'obus tombe dans l'axe du canon, à la portée qu'il a réglée
      const d = p.bot ? 40 : arcRange(def, p.range ?? 0.5);
      const aim = (p.bot && p.aimPoint) || { x: p.tank.x + Math.sin(p.tank.ty) * d, z: p.tank.z + Math.cos(p.tank.ty) * d };
      const err = this.shotError(p, def);
      if (err) {
        // l'obus retombe n'importe où dans le cercle de dispersion, autour du point visé
        aim.x += Math.cos(p.tank.ty) * err.h * d + Math.sin(p.tank.ty) * err.v * d;
        aim.z += -Math.sin(p.tank.ty) * err.h * d + Math.cos(p.tank.ty) * err.v * d;
      }
      const flight = arcFlight(def, Math.hypot(aim.x - p.tank.x, aim.z - p.tank.z));
      this.fireArc(p, aim.x, aim.z, { damage: def.shellDamage, splash: def.splash, flight });
      if (this.isCampaign && !p.unit) this.campaign.onFire(p);
      return;
    }
    const ty = p.tank.ty;
    const err = this.shotError(p, def);
    for (const off of def.barrels ?? [0]) {
      const a = ty + (def.spread ? (Math.random() * 2 - 1) * def.spread : 0);
      this.spawnShell(p, def, p.tank.x + Math.cos(ty) * off, p.tank.z - Math.sin(ty) * off, a, err);
    }
    if (this.isCampaign && !p.unit) this.campaign.onFire(p); // bonus comptés en tirs
    // (les rafales sont gérées par la simulation du char : shared/tank.js)
  }

  // Dispersion d'un tir de joueur : écart tiré au hasard dans le cercle de précision au moment du tir,
  // { h, v } en radians. Rien pour l'IA et les unités de campagne, qui ont leur propre imprécision.
  shotError(p, def) {
    if (p.bot || p.unit || !def.acc) return null;
    return scatter(dispersionAngle(def, p.tank.shotAim ?? 0));
  }

  // Salve en éventail (boss) : n obus répartis sur `spread` radians.
  fireFan(p, n, spread) {
    const def = this.defOf(p);
    for (let i = 0; i < n; i++) {
      const a = p.tank.ty + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
      this.spawnShell(p, def, p.tank.x, p.tank.z, a);
    }
  }

  spawnShell(p, def, x, z, angle, err = null) {
    // carte à relief : le canon part de l'altitude du sol, avec visée verticale automatique
    // (sans cible dans la ligne de tir, l'obus vole à hauteur commune au-dessus du sol `g`)
    let y0 = def.muzzleHeight, vy, g = 0;
    if (this.map.hills || this.map.race?.floor) { // circuit au-dessus du vide : la piste monte et descend aussi
      g = this.isRace ? p.tank.y : heightAt(x, z, this.map); // course : le canon part de l'altitude réelle du char (tremplins, vol)
      y0 += g;
      const foes = [];
      for (const o of this.roundPlayers()) if (o.alive && (this.isRace ? o !== p : o.team !== p.team)) foes.push(o.tank);
      vy = autoPitch(x, z, angle, y0, foes, this.map, def.shellSpeed); // visée sur la cible, avant dispersion
      if (vy !== undefined && err) vy += err.v;
    }
    if (err) angle += err.h;
    const s = {
      id: this.nextShellId++, owner: p.id, team: p.team, vy, g,
      x, y: y0, y0, z, dist: 0,
      dx: Math.sin(angle), dz: Math.cos(angle),
      speed: def.shellSpeed, damage: def.shellDamage * this.dmgMulOf(p), life: def.shellLifeTicks,
      splash: def.splash ?? RULES.splashRadius, splashDamage: (def.splashDamage ?? RULES.splashDamage) * this.dmgMulOf(p),
    };
    this.shells.push(s);
    const ev = { k: 'shot', id: s.id, o: p.id, x: +x.toFixed(2), y: +s.y.toFixed(2), z: +z.toFixed(2), dx: +s.dx.toFixed(4), dz: +s.dz.toFixed(4) };
    if (vy !== undefined) ev.vy = +vy.toFixed(4);
    else if (g) ev.g = +g.toFixed(2);
    if (p.unit) Object.assign(ev, { sp: def.shellSpeed, L: def.barrelLength, md: def.shellSpeed * def.shellLifeTicks * DT, sz: def.shellScale ?? 1 });
    else if (def.shellScale) ev.sz = def.shellScale;
    this.events.push(ev);
  }

  // Obus de mortier : tir en cloche vers un point, explose à l'arrivée (cercle d'alerte côté client).
  fireArc(p, tx, tz, { damage, splash, flight }) {
    const def = this.defOf(p);
    const m = this.map;
    tx = Math.max(-m.halfX, Math.min(m.halfX, tx));
    tz = Math.max(-m.halfZ, Math.min(m.halfZ, tz));
    const mul = this.dmgMulOf(p);
    const gy = heightAt(p.tank.x, p.tank.z, m), gt = heightAt(tx, tz, m); // 0 sur une carte plate
    const s = {
      id: this.nextShellId++, owner: p.id, team: p.team, arc: true, gt,
      x0: p.tank.x, y0: def.muzzleHeight + 0.5 + gy, z0: p.tank.z, tx, tz, t: 0, T: flight,
      peak: 12 + Math.hypot(tx - p.tank.x, tz - p.tank.z) * 0.12,
      x: p.tank.x, y: def.muzzleHeight + gy, z: p.tank.z,
      damage: 0, splash, splashDamage: damage * mul,
    };
    this.shells.push(s);
    this.events.push({ k: 'arc', id: s.id, o: p.id, x: +s.x0.toFixed(2), y: s.y0, z: +s.z0.toFixed(2), tx: +tx.toFixed(2), tz: +tz.toFixed(2), T: flight, pk: +s.peak.toFixed(2), r: splash });
  }

  stepShells() {
    if (!this.shells.length) return;
    const tanks = this.roundPlayers();
    const hills = !!this.map.hills;
    this.shells = this.shells.filter((s) => {
      if (s.arc) {
        if (++s.t < s.T) return true;
        s.x = s.tx;
        s.z = s.tz;
        s.y = s.gt + 0.3;
        this.explode(s, null);
        return false;
      }
      const steps = Math.ceil((s.speed * DT) / SHELL_STEP);
      const ds = (s.speed * DT) / steps;
      for (let i = 0; i < steps; i++) {
        s.x += s.dx * ds;
        s.z += s.dz * ds;
        s.dist += ds;
        s.y = shellHeight(s.y0, s.dist, s.vy, s.g);
        if (pointBlocked(s.x, s.y, s.z, this.map)) {
          this.hitDecor(s);
          this.explode(s, null);
          return false;
        }
        for (const p of tanks) {
          if (p.id !== s.owner && pointHitsTank(s.x, s.y, s.z, p.tank, this.defOf(p), this.isRace ? p.tank.y : hills ? heightAt(p.tank.x, p.tank.z, this.map) : 0)) {
            this.explode(s, p);
            return false;
          }
        }
      }
      if (--s.life <= 0) {
        this.events.push({ k: 'gone', id: s.id });
        return false;
      }
      return true;
    });
  }

  // Un obus percute le décor : un objet destructible perd des points de structure, puis s'effondre.
  hitDecor(s) {
    if (this.phase !== 'playing') return;
    const o = objectAt(s.x, s.y, s.z, this.map);
    const max = o && DESTRUCTIBLE[o.kind];
    if (!max) return;
    const key = objectKey(this.baseMap, o);
    if (!key) return;
    const dmg = Math.round(s.damage);
    const hp = (this.objHp.get(key) ?? max) - dmg;
    const at = { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) };
    this.events.push({ k: 'objHit', key, d: dmg, by: s.owner, ...at });
    if (hp > 0) {
      this.objHp.set(key, hp);
      return;
    }
    this.objHp.delete(key);
    this.broken.add(key);
    this.events.push({ k: 'wreck', key, kind: o.kind, x: o.x, z: o.z, h: o.h, by: s.owner });
    this.stateDirty = true; // la liste des objets détruits part avec l'état du salon
  }

  explode(s, victim) {
    this.events.push({ k: 'boom', id: s.id, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), hit: victim ? victim.id : null, r: s.splash });
    if (this.phase !== 'playing') return;
    if (this.isRace) {
      this.racePush(s, victim);
      return;
    }
    const canHurt = (p) => p.alive && p.id !== s.owner && (RULES.friendlyFire || p.team !== s.team);
    // direct : la face touchée dépend de la direction de l'obus ; souffle : de la direction explosion → char
    if (victim && canHurt(victim)) this.damage(victim, s.damage * faceCoef(this.defOf(victim), victim.tank.yaw, s.dx, s.dz), s.owner);
    if (!s.splash) return;
    for (const p of this.roundPlayers()) {
      if (p === victim || !canHurt(p)) continue;
      const d = Math.max(0, Math.hypot(p.tank.x - s.x, p.tank.z - s.z) - this.defOf(p).radius * 0.5);
      if (d < s.splash) this.damage(p, s.splashDamage * (1 - d / s.splash) * faceCoef(this.defOf(p), p.tank.yaw, p.tank.x - s.x, p.tank.z - s.z), s.owner);
    }
  }

  // Course : un obus ne fait aucun dégât, il pousse. Plus le char tireur est puissant (dégâts), plus la poussée est forte ;
  // plus le char touché est léger, plus il est repoussé loin. Le souffle pousse aussi, plus faiblement avec la distance.
  racePush(s, victim) {
    if (victim && victim.alive && victim.id !== s.owner) this.pushTank(victim, s.dx, s.dz, s.damage, s.owner);
    if (!s.splash) return;
    for (const p of this.roundPlayers()) {
      if (p === victim || !p.alive || p.id === s.owner) continue;
      const dx = p.tank.x - s.x, dz = p.tank.z - s.z;
      const d = Math.max(0, Math.hypot(dx, dz) - this.defOf(p).radius * 0.5);
      if (d < s.splash) this.pushTank(p, dx || s.dx, dz || s.dz, s.splashDamage * (1 - d / s.splash), s.owner);
    }
  }

  // Applique une poussée : vitesse = dégâts / poids. Un gros choc fait aussi décoller le char.
  pushTank(p, dx, dz, power, byId) {
    const v = pushSpeed(power, this.defOf(p).weight);
    if (v < 1) return;
    const d = Math.hypot(dx, dz) || 1, t = p.tank;
    t.kx += (dx / d) * v;
    t.kz += (dz / d) * v;
    const k = Math.hypot(t.kx, t.kz);
    if (k > RACE_RULES.maxKnock) { t.kx *= RACE_RULES.maxKnock / k; t.kz *= RACE_RULES.maxKnock / k; }
    // dérapage : la caisse part en toupie. Un coup de flanc fait beaucoup tourner, un coup dans l'axe un peu (côté au hasard).
    const side = (Math.cos(t.yaw) * dx - Math.sin(t.yaw) * dz) / d; // -1..1 : composante latérale de la poussée
    const sign = Math.abs(side) > 0.15 ? Math.sign(side) : Math.random() < 0.5 ? -1 : 1;
    const spin = sign * (0.35 + 0.65 * Math.abs(side)) * v * RACE_RULES.spinScale;
    t.kw = Math.max(-RACE_RULES.maxSpin, Math.min(RACE_RULES.maxSpin, (t.kw ?? 0) + spin));
    t.speed *= 0.45;
    if (v > 12 && !t.air) {
      t.air = true;
      t.vy = Math.min(4.5, v * 0.16);
      t.y += 0.05;
    }
    const by = this.players.get(byId);
    if (by?.race) by.race.pushes++;
    this.events.push({ k: 'push', id: p.id, by: byId, v: +v.toFixed(1) });
  }

  damage(p, amount, byId) {
    if (this.isCampaign) {
      p.brain?.alert?.(byId, this.tick);
      amount = this.campaign.modifyDamage(p, amount, byId);
    }
    // un char touché est détecté par l'équipe adverse pendant SPOT_LINGER s
    p.seenTick = this.tick;
    p.spotted = true;
    amount = Math.round(amount);
    if (amount <= 0) return;
    amount = Math.min(amount, p.hp);
    p.hp -= amount;
    const attacker = this.players.get(byId);
    if (attacker && attacker.team !== p.team) attacker.dmg = (attacker.dmg ?? 0) + amount;
    this.events.push({ k: 'hp', id: p.id, hp: p.hp, by: byId, d: amount });
    if (p.hp > 0) return;
    p.alive = false;
    p.tank.speed = 0;
    p.deaths++;
    if (attacker && attacker.team !== p.team) attacker.kills++;
    this.events.push({ k: 'kill', by: byId, id: p.id });
    if (this.isCampaign) this.campaign.onKill(p);
    this.stateDirty = true;
  }

  stepZone() {
    const zone = this.zone, z = this.map.zone;
    const count = { red: 0, blue: 0 };
    for (const p of this.roundPlayers()) {
      if (p.alive && Math.hypot(p.tank.x - z.x, p.tank.z - z.z) <= z.r) count[p.team]++;
    }
    zone.contested = count.red > 0 && count.blue > 0;
    if (zone.contested) return;
    const team = count.red ? 'red' : count.blue ? 'blue' : null;
    const rate = DT / RULES.captureSeconds;
    if (team) {
      const speed = rate * Math.min(2, 1 + 0.5 * (count[team] - 1));
      if (zone.team === team || zone.progress === 0) {
        zone.team = team;
        zone.progress = Math.min(1, zone.progress + speed);
      } else {
        // l'autre équipe avait commencé : on défait d'abord sa capture
        zone.progress = Math.max(0, zone.progress - speed * 2);
      }
    } else if (zone.progress > 0) {
      zone.progress = Math.max(0, zone.progress - rate * 0.5);
      if (zone.progress === 0) zone.team = null;
    }
    if (zone.progress >= 1) this.endRound(zone.team, 'capture');
  }

  checkElimination() {
    const alive = { red: 0, blue: 0 };
    for (const p of this.roundPlayers()) if (p.alive) alive[p.team]++;
    const redOut = this.teamActive.red && alive.red === 0;
    const blueOut = this.teamActive.blue && alive.blue === 0;
    if (!redOut && !blueOut) return;
    // une équipe absente au début de la manche (test en solo) ne compte pas comme éliminée
    const winner = redOut && blueOut ? null : redOut ? (this.teamActive.blue ? 'blue' : null) : (this.teamActive.red ? 'red' : null);
    this.endRound(winner, 'elimination');
  }
}

export { TICK_RATE };
