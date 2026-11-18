// Vérification de la campagne, sans navigateur :
//   1. les données de chaque mission (rien dans un mur, tout est atteignable) ;
//   2. une partie simulée de chaque mission, avec des bots alliés à la place des joueurs.
//
//   node tools/campaign-check.js                 toutes les missions, 2 bots, difficulté Vétéran
//   node tools/campaign-check.js m4 m8 --bots 3 --diff hard
//   node tools/campaign-check.js --data          seulement la vérification des données
import os from 'node:os';
import path from 'node:path';
import { UNIT_TYPES, TICK_RATE } from '../shared/constants.js';
import { MISSIONS, getMission } from '../shared/campaign.js';
import { collideCircle } from '../shared/map.js';
import { NavGrid } from '../server/Bot.js';

process.env.TANK3D_ACCOUNTS_FILE = path.join(os.tmpdir(), 'tank3d-check-accounts.json'); // ne touche pas aux vrais comptes
const { Room } = await import('../server/Room.js');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const ids = args.filter((a, i) => /^m\d+$/.test(a) && !args[i - 1]?.startsWith('--'));
const missions = ids.length ? ids.map(getMission) : MISSIONS;
const bots = Number(opt('--bots', 2));
const diff = opt('--diff', 'normal');

// ------------------------------------------------------------- données
let problems = 0;
const fail = (m, text) => {
  problems++;
  console.log(`  ✗ ${m.id} ${m.name} : ${text}`);
};

for (const m of missions) {
  const map = m.map;
  const fixed = m.units.filter((u) => UNIT_TYPES[u.t].static);
  const navMap = { ...map, circles: [...map.circles, ...fixed.map((u) => ({ x: u.x, z: u.z, r: UNIT_TYPES[u.t].radius }))] };
  const nav = new NavGrid(navMap, 2.0);
  const inside = (x, z, r) => collideCircle({ x, z }, r, map);
  const reach = (x, z, label) => {
    const path = nav.path(map.playerSpawn.x, map.playerSpawn.z, x, z);
    const end = path[path.length - 1];
    if (!end || Math.hypot(end.x - x, end.z - z) > 14) fail(m, `${label} (${x}, ${z}) inaccessible depuis le départ`);
  };
  if (inside(map.playerSpawn.x, map.playerSpawn.z, 3)) fail(m, 'point de départ dans un obstacle');
  for (const u of m.units) {
    const def = UNIT_TYPES[u.t];
    if (!def) {
      fail(m, `type inconnu ${u.t}`);
      continue;
    }
    if (inside(u.x, u.z, def.radius)) fail(m, `${u.t} (${u.x}, ${u.z}) touche un obstacle`);
    for (const o of m.units) {
      if (o !== u && Math.hypot(o.x - u.x, o.z - u.z) < def.radius + UNIT_TYPES[o.t].radius && m.units.indexOf(o) > m.units.indexOf(u)) {
        fail(m, `${u.t} et ${o.t} se chevauchent en (${u.x}, ${u.z})`);
      }
    }
    if (!def.static) reach(u.x, u.z, u.t);
    else reach(u.x + def.radius + 3, u.z, `abords de ${u.t}`);
  }
  for (const p of m.pickups) {
    if (inside(p.x, p.z, 1.2)) fail(m, `bonus ${p.k} (${p.x}, ${p.z}) dans un obstacle`);
    else reach(p.x, p.z, `bonus ${p.k}`);
  }
  for (const e of m.entries) {
    if (inside(e.x, e.z, 2.5)) fail(m, `entrée (${e.x}, ${e.z}) dans un obstacle`);
    else reach(e.x, e.z, 'entrée de renforts');
  }
  if (map.zone) reach(map.zone.x, map.zone.z, 'zone');
}
console.log(problems ? `\n${problems} problème(s) dans les données.\n` : `Données : ${missions.length} missions OK.\n`);
if (args.includes('--data')) process.exit(problems ? 1 : 0);

// ------------------------------------------------------------ simulation
console.log(`Simulation : ${bots} bot(s) allié(s), difficulté ${diff}\n`);
const MAX_TICKS = 12 * 60 * TICK_RATE;
for (const m of missions) {
  const room = new Room();
  room.settings.mode = 'campaign';
  room.settings.mission = m.id;
  room.settings.difficulty = diff;
  for (let i = 0; i < bots; i++) room.addBot('blue');
  const started = performance.now();
  // qui fait mal à qui : dégâts reçus par l'escouade, par type d'unité ennemie
  const taken = {};
  let dealt = 0;
  const damage = room.damage.bind(room);
  room.damage = (p, amount, byId) => {
    const by = room.players.get(byId);
    const before = p.hp;
    damage(p, amount, byId);
    if (!p.unit && by) taken[by.activeType] = (taken[by.activeType] ?? 0) + (before - p.hp);
    if (p.unit && by && !by.unit) dealt += before - p.hp;
  };
  room.startMatch();
  let peak = 0, errors = 0;
  for (let t = 0; t < MAX_TICKS && room.phase !== 'debrief'; t++) {
    try {
      room.step();
    } catch (err) {
      if (errors++ === 0) console.log(`  ✗ ${m.id} : exception`, err);
      if (errors > 5) break;
    }
    peak = Math.max(peak, room.roundPlayers().length);
  }
  const d = room.debrief;
  const ms = performance.now() - started;
  const res = d ? `${d.success ? `réussie ${'★'.repeat(d.stars)}` : `échouée (${d.reason})`} en ${d.time} s, chars perdus ${d.losses}` : 'pas terminée en 12 min';
  const kills = d ? d.players.map((p) => p.kills).join('/') : '';
  const info = room.campaign.info();
  const where = d && !d.success ? ` · objectif : ${info.l} ${info.v}` : '';
  console.log(`  ${d?.success ? '✓' : '·'} ${m.id.padEnd(4)} ${m.name.padEnd(22)} ${res} · destructions ${kills} · unités max ${peak} · ${(ms / 1000).toFixed(1)} s de calcul${where}`);
  if (args.includes('--verbose')) console.log(`         dégâts infligés ${Math.round(dealt)} · reçus : ${Object.entries(taken).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}`);
}
process.exit(0);
