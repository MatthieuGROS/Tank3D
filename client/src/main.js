// Chef d'orchestre du client : relie réseau, simulation, rendu, HUD et salon.
import {
  DT, TICK_RATE, TEAM_INFO, TANK_TYPES, UNIT_TYPES, DEFAULT_TANK, RULES, PICKUPS, DIFFICULTIES, arcRange, dispersionAngle,
} from '/shared/constants.js';
import { rankInfo, fmtCr } from '/shared/progress.js';
import { MAPS, marchRay, pointBlocked, heightAt, inBush } from '/shared/map.js';
import { getMission } from '/shared/campaign.js';
import { pointHitsTank, shellHeight, autoPitch } from '/shared/tank.js';
import { SKINS, DEFAULT_SKIN, unlockedSkins } from '/shared/skins.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';
import { Hub } from './ui/hub.js';
import { $, el, fmtInt, signed } from './ui/kit.js';
import { Chat } from './chat.js';

const unitDef = (type) => UNIT_TYPES[type] ?? TANK_TYPES[DEFAULT_TANK];
const ROMAN = ['I', 'II', 'III', 'IV'];
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const net = new Net();
const input = new Input();
const game = new Game();
const sfx = new Sfx();
const hud = new Hud();
const renderer = new Renderer($('game'));
const fx = new Effects(renderer.scene);
renderer.fx = fx;
const chat = new Chat((text) => net.send({ type: 'chat', text }));

let lanUrls = [];
let listener = { x: 0, z: 0 }; // position d'écoute (cible de la caméra)
let views = new Map();
let lost = false;
let debriefAt = 0; // le rapport de mission s'affiche après un court temps (explosion finale)
let newSkins = []; // skins débloqués pendant la mission en cours (annoncés au rapport)
let lastReward = null; // dernières récompenses reçues (XP + crédits), affichées au rapport de mission
const rewardsByReport = new Map(); // récompenses par rapport de bataille (escarmouche)
let reportSeen = 0; // rapport de bataille déjà refermé
let kicked = false; // exclu par l'hôte
let menuOpen = false; // menu en jeu (Échap)
let pickOpen = false; // choix d'équipe en cours de partie
let lobbyOpen = false; // salon rouvert pendant une partie (char, skin, équipe)
let hudActive = false; // HUD en jeu affiché
let firstState = true;
// caméra spectateur : joueur suivi, ou caméra libre (position, cap, plongée)
const spec = { free: false, id: null, x: 0, y: 30, z: 0, yaw: 0, pitch: -0.4 };
const keys = new Set(); // touches enfoncées (event.code), pour la caméra libre

const isCampaign = () => game.settings.mode === 'campaign';

function applyMap() {
  renderer.setMap(game.baseMap);
  renderer.setBroken(game.map, game.broken);
  hud.setMap(game.map);
  fx.map = game.map;
}

// ------------------------------------------------------- chiffres de dégâts
// Nombres flottants au-dessus de ce qu'on vient de toucher (char, unité ou objet du décor).
const dmgLayer = $('dmgnums');
const dmgNums = [];
function damageNumber(x, y, z, text, cls = '') {
  const e = el('div', `dn ${cls}`, text);
  dmgLayer.append(e);
  dmgNums.push({ e, x: x + (Math.random() - 0.5) * 1.2, y, z: z + (Math.random() - 0.5) * 1.2, t: 0 });
  if (dmgNums.length > 24) dmgNums.shift().e.remove();
}
function updateDamageNumbers(dt) {
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const n = dmgNums[i];
    n.t += dt;
    if (n.t > 1.2 || !hudActive) {
      n.e.remove();
      dmgNums.splice(i, 1);
      continue;
    }
    const s = renderer.project(n.x, n.y + n.t * 1.6, n.z);
    n.e.style.opacity = s.front ? String(Math.min(1, (1.2 - n.t) * 3)) : '0';
    n.e.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${n.t < 0.12 ? 1.5 - n.t * 4 : 1})`;
  }
}
// Mes tirs, ou ceux du joueur que j'observe (spectateur / char détruit).
const shotByWatched = (by) => by != null && by === (camId ?? game.myId);
// Journal des dégâts (Alt) : coups infligés par le char observé et coups qu'il reçoit.
function logDamage(ev) {
  const w = camId ?? game.myId;
  const dir = ev.by === w && ev.id !== w ? 'out' : ev.id === w ? 'in' : null;
  if (!dir) return;
  const other = dir === 'out' ? ev.id : ev.by; // l'autre char concerné (null : source inconnue)
  const p = other != null ? game.roster.get(other) : null;
  let name = 'Source inconnue';
  if (other === w) name = 'Toi-même';
  else if (p) name = p.unit ? unitDef(views.get(other)?.type ?? p.type).name : p.name;
  const me = game.roster.get(w);
  hud.logDamage({ dir, key: other, name, team: p?.team, d: ev.d, kill: ev.hp <= 0, ally: !!p && !!me && p.team === me.team && other !== w });
}
const DEBRIS = { crate: 0x8a6a42, tree: 0x5a7a3a, palm: 0x8a6a45, hedgehog: 0x45484c, column: 0xd6bf8e, wall: 0x9a9d9f, ruin: 0xd6bf8e };
applyMap();

// ------------------------------------------------------------ salon (hub)

const screens = {
  join: $('screen-join'), lobby: $('screen-lobby'), lost: $('screen-lost'), hud: $('hud'), debrief: $('screen-debrief'),
  pick: $('screen-pick'), menu: $('screen-menu'), report: $('screen-report'),
};
const myCleared = () => game.account?.cleared ?? {};

// Exclusion d'un joueur (hôte) : il est déconnecté et ne peut pas revenir avant une minute.
function kickPlayer(p) {
  if (p.bot || confirm(`Exclure ${p.name} ? Il ne pourra pas revenir avant une minute.`)) net.send({ type: 'kick', id: p.id });
}

// Le hub (hangar, opérations, boutique) vit dans ui/hub.js. main.js lui prête le réseau et les règles d'équipe.
const hub = new Hub({
  game,
  net,
  isCampaign,
  refresh: () => refreshUI(),
  lanUrls: () => lanUrls,
  logout: () => location.reload(), // on coupe la connexion (le compte se libère) et on revient à l'accueil
  chooseTeam: (team) => chooseTeam(team),
  canJoinTeam: () => canJoinTeam(),
  inMatch: () => inMatch(),
  nextGame: () => nextGame(),
  kick: kickPlayer,
  afterJoin: () => {
    lobbyOpen = false; // en cours de partie : retour au jeu (en spectateur jusqu'à la partie suivante)
    refreshUI();
  },
  backToGame: () => {
    lobbyOpen = false;
    refreshUI();
  },
});


// Récompenses d'une partie ou d'une mission : crédits et XP, ligne par ligne.
function renderRewards(box, rw) {
  box.classList.toggle('hidden', !rw);
  if (!rw) return;
  const column = (title, gained, unit, parts, foot) => {
    const col = el('div', 'rw-col');
    const head = el('div', 'rw-head', title);
    head.append(el('b', gained < 0 ? 'neg' : '', `${signed(gained)} ${unit}`));
    col.append(head);
    for (const [label, n] of parts) {
      const line = el('div', `rw-line${n < 0 ? ' neg' : ''}`);
      line.append(el('span', '', label), el('span', '', `${signed(n)} ${unit}`));
      col.append(line);
    }
    const f = el('div', 'rw-foot');
    f.innerHTML = foot;
    col.append(f);
    return col;
  };
  const r = rankInfo(rw.xp.total);
  const items = [
    column('Crédits', rw.cr.gained, 'cr', rw.cr.parts, `Solde : <b>${fmtCr(rw.cr.total)}</b>`),
    column('Expérience', rw.xp.gained, 'XP', rw.xp.parts, `${r.rank.name} · <b>${fmtInt(rw.xp.total)} XP</b>${r.next ? ` / ${fmtInt(r.next.xp)}` : ''}`),
  ];
  if (rw.rankUp) items.push(el('div', 'rw-up', `Promotion : ${rw.rankUp} !`));
  box.replaceChildren(...items);
}

// Rapport de bataille (fin d'une partie d'escarmouche).
function renderReport() {
  const r = game.report;
  const mine = r.players.find((p) => p.id === game.myId);
  $('rp-eyebrow').textContent = `Rapport de bataille · ${MAPS[r.map]?.name ?? ''}`;
  const won = mine && mine.team === r.winner;
  $('rp-title').textContent = mine ? (won ? 'Victoire' : 'Défaite') : `Victoire des ${TEAM_INFO[r.winner].label}`;
  $('rp-title').classList.toggle('fail', !!mine && !won);
  const score = $('rp-score');
  score.replaceChildren(el('span', 'c-red', TEAM_INFO.red.label), el('b', '', `${r.score.red} – ${r.score.blue}`), el('span', 'c-blue', TEAM_INFO.blue.label),
    el('span', '', `· ${r.rounds} manche${r.rounds > 1 ? 's' : ''}`));
  renderRewards($('rp-rewards'), rewardsByReport.get(r.id));
  const table = $('rp-table');
  table.innerHTML = '<tr><th>Équipage</th><th class="n">Destructions</th><th class="n">Pertes</th><th class="n">Dégâts</th></tr>';
  const order = (p) => (p.team === r.winner ? 0 : 1);
  for (const p of [...r.players].sort((a, b) => order(a) - order(b) || b.dmg - a.dmg)) {
    const tr = table.insertRow();
    if (p.id === game.myId) tr.className = 'me';
    const name = tr.insertCell();
    name.className = `c-${p.team}`;
    name.textContent = p.name;
    if (p.bot) name.append(el('small', '', 'bot'));
    for (const v of [p.kills, p.deaths, p.dmg]) {
      const td = tr.insertCell();
      td.textContent = fmtInt(v);
      td.className = 'n';
    }
  }
}

const diffByStars = (n) => Object.values(DIFFICULTIES).find((d) => d.stars === n)?.name ?? '';

// Bouton « Exclure » (hôte) : le joueur est déconnecté et ne peut pas revenir avant une minute.
function kickButton(p) {
  const b = el('button', 'kick', p.bot ? 'Retirer' : 'Exclure');
  b.title = `${p.bot ? 'Retirer' : 'Exclure'} ${p.name}`;
  b.addEventListener('click', () => {
    if (p.bot || confirm(`Exclure ${p.name} ? Il ne pourra pas revenir avant une minute.`)) net.send({ type: 'kick', id: p.id });
  });
  return b;
}

const inRoundNow = () => game.phase !== 'lobby' && !!game.latest?.pl.has(game.myId);
const aliveNow = () => !!game.latest?.pl.get(game.myId)?.al;
// spectateur : sans équipe, ou pas engagé dans la partie en cours (équipe choisie pour la suivante)
const isSpectator = () => !!game.me && (!game.me.team || !inRoundNow());

// Partie lancée : ses équipes sont figées jusqu'à la fin (toutes les manches). Ceux qui n'y jouent pas choisissent
// leur équipe pour la PROCHAINE partie, et regardent celle-ci en spectateurs.
const inMatch = () => game.phase !== 'lobby' && !!game.me?.im;
const canJoinTeam = () => !!game.me && !inMatch();
const nextGame = () => (isCampaign() ? 'prochaine mission' : 'prochaine partie');
const teamName = (team) => (isCampaign() ? 'l’escouade' : `les ${TEAM_INFO[team].label}`);

// Change d'équipe (null = spectateur). Un joueur de la partie en cours peut seulement en sortir (spectateur).
function chooseTeam(team) {
  const me = game.me;
  if (!me || team === me.team) return true;
  if (team && !canJoinTeam()) return false;
  if (inMatch() && !team && !confirm(`Tu quittes la ${isCampaign() ? 'mission' : 'partie'} en cours${aliveNow() ? ' (ton char disparaît)' : ''} et tu la regarderas en spectateur jusqu’à la fin. Continuer ?`)) return false;
  net.send({ type: 'team', team });
  return true;
}

// Panneau « partie en cours » : on regarde en spectateur ; on peut déjà choisir son équipe pour la partie suivante.
function renderPick() {
  const me = game.me, campaign = isCampaign();
  $('pick-title').textContent = me.team ? `Équipe pour la ${nextGame()}` : 'Partie en cours';
  $('pick-text').textContent = `${campaign ? 'Une mission' : 'Une partie'} est en cours entre les joueurs déjà engagés : tu la regardes en spectateur. `
    + (me.team ? `Tu joueras avec ${teamName(me.team)} à la ${nextGame()} (tu peux encore changer).` : `Choisis dès maintenant ton équipe pour la ${nextGame()}, ou reste simplement spectateur.`);
  $('pick-eyebrow').textContent = campaign ? 'Mission en cours' : `Partie en cours · manche ${game.round}`;
  document.querySelector('.pick-teams').classList.toggle('solo', campaign);
  for (const b of document.querySelectorAll('.pick-team')) {
    const team = b.dataset.team;
    const n = [...game.roster.values()].filter((p) => p.team === team && !p.unit).length;
    b.classList.toggle('hidden', campaign && team === 'red');
    b.replaceChildren(campaign ? 'Rejoindre l’escouade' : TEAM_INFO[team].label, el('small', '', me.team === team ? 'ton équipe' : `${n} / ${RULES.maxPlayersPerTeam}`));
    b.disabled = !canJoinTeam() || me.team === team || n >= RULES.maxPlayersPerTeam;
  }
  $('pick-spectate').textContent = me.team ? 'Annuler mon équipe' : 'Rester spectateur';
}

// Menu en jeu : reprendre, équipe, spectateur ; pour l'hôte : pause, fin de partie, exclusion.
function renderMenu(isHost) {
  const me = game.me, campaign = isCampaign();
  const live = ['countdown', 'playing', 'roundEnd'].includes(game.phase);
  $('menu-eyebrow').textContent = game.paused ? 'Menu · partie en pause' : 'Menu';
  $('menu-title').textContent = inMatch() ? (campaign ? 'Escouade' : TEAM_INFO[me.team].label) : 'Spectateur';
  $('menu-team').textContent = me.team ? `Équipe pour la ${nextGame()}` : campaign ? 'Rejoindre l’escouade (prochaine mission)' : 'Choisir une équipe (prochaine partie)';
  $('menu-team').classList.toggle('hidden', !canJoinTeam());
  $('menu-spectate').classList.toggle('hidden', !me.team);
  $('menu-spectate').textContent = inMatch() ? 'Quitter la partie (spectateur)' : 'Annuler mon équipe';
  $('menu-host').classList.toggle('hidden', !isHost);
  if (!isHost) return;
  $('menu-pause').textContent = game.paused ? 'Reprendre la partie' : 'Mettre en pause';
  $('menu-pause').disabled = !live;
  $('menu-abort').textContent = campaign ? 'Abandonner la mission' : 'Terminer la partie';
  const rows = [...game.roster.values()].filter((p) => !p.unit && p.id !== game.myId).map((p) => {
    const li = el('li');
    li.append(el('span', 'nm', p.name));
    if (p.bot) li.append(el('span', 'tg', 'bot'));
    li.append(p.team ? el('span', `tg ${p.team}`, campaign ? 'escouade' : TEAM_INFO[p.team].label) : el('span', 'tg', 'spectateur'));
    li.append(kickButton(p));
    return li;
  });
  if (!rows.length) rows.push(el('li', 'empty', 'Aucun autre joueur'));
  $('menu-players').replaceChildren(...rows);
}

function stars(n, max = 3) {
  return '★'.repeat(n) + '☆'.repeat(max - n);
}

function renderDebrief(isHost) {
  const d = game.debrief;
  if (!d) return;
  $('db-eyebrow').textContent = `Rapport de mission · ${d.name}`;
  const title = $('db-title');
  title.textContent = d.success ? 'Mission accomplie' : 'Mission échouée';
  title.classList.toggle('fail', !d.success);
  $('db-stars').replaceChildren(...[0, 1, 2].map((i) => el('span', i < d.stars ? 'on' : '', '★')));
  $('db-stars').classList.toggle('hidden', !d.success);
  const record = !!game.account && !!d.records?.includes(game.account.name);
  const best = myCleared()[d.mission] ?? 0;
  $('db-record').textContent = !d.success ? ''
    : record ? `Nouveau record enregistré sur ton compte : ${diffByStars(d.stars)} ${'★'.repeat(d.stars)}`
      : best > d.stars ? `Ta meilleure réussite reste ${diffByStars(best)} ${'★'.repeat(best)}.` : 'Déjà réussie à cette difficulté.';
  $('db-record').classList.toggle('new', record);
  $('db-unlock').textContent = newSkins.length ? `Nouveau skin débloqué : ${newSkins.map((id) => SKINS[id].name).join(', ')} · à équiper au salon` : '';
  $('db-unlock').classList.toggle('hidden', !newSkins.length);
  renderRewards($('db-rewards'), lastReward);
  const fact = (label, value, ok) => {
    const f = el('div', ok ? 'ok' : '', label);
    f.append(el('b', '', value));
    return f;
  };
  $('db-facts').replaceChildren(
    fact(`Temps · réf. ${fmtTime(d.par)}`, fmtTime(d.time), d.success && d.time <= d.par),
    fact('Chars perdus', String(d.losses ?? 0), d.success && !d.losses),
    d.success ? fact('Difficulté', DIFFICULTIES[d.difficulty]?.name ?? '', true) : fact('Cause', d.reason || '—'),
  );
  const table = $('db-table');
  table.innerHTML = '<tr><th>Équipage</th><th class="n">Destructions</th><th class="n">Pertes</th><th class="n">Dégâts</th></tr>';
  for (const p of [...d.players].sort((a, b) => b.dmg - a.dmg)) {
    const tr = table.insertRow();
    tr.insertCell().textContent = p.name + (p.bot ? ' (bot)' : '');
    for (const v of [p.kills, p.deaths, p.dmg]) {
      const td = tr.insertCell();
      td.textContent = v;
      td.className = 'n';
    }
  }
  $('db-next').classList.toggle('hidden', !isHost || !d.next);
  $('db-retry').classList.toggle('hidden', !isHost);
  $('db-lobby').classList.toggle('hidden', !isHost);
  $('db-retry').textContent = d.success ? 'Rejouer' : 'Réessayer';
  $('db-retry').classList.toggle('primary', !d.success);
  const hostName = game.roster.get(game.hostId)?.name ?? '?';
  $('db-wait').textContent = isHost ? (d.success && !d.next ? 'Campagne terminée. Bravo, commandant !' : '') : `En attente de ${hostName}…`;
}

// Rapport de bataille à afficher ? (au retour au salon, pour les joueurs de la partie, jusqu'à ce qu'ils le referment)
const reportShown = () => game.phase === 'lobby' && !!game.report && game.report.id !== reportSeen && game.report.players.some((p) => p.id === game.myId);

function refreshUI() {
  const me = game.me;
  const campaign = isCampaign();
  if (game.phase === 'lobby') menuOpen = pickOpen = lobbyOpen = false;
  // en cours de partie, tout le monde voit le jeu (les sans-équipe en spectateurs) ; le salon se rouvre à la demande
  const inLobby = !!me && (game.phase === 'lobby' || lobbyOpen);
  const inGame = !!me && !inLobby;
  const debrief = inGame && game.phase === 'debrief' && performance.now() >= debriefAt;
  if (debrief) menuOpen = pickOpen = false;
  const report = inLobby && reportShown();
  screens.join.classList.toggle('hidden', !!me || lost);
  screens.lobby.classList.toggle('hidden', !inLobby || lost);
  screens.hud.classList.toggle('hidden', !inGame || debrief || lost);
  screens.debrief.classList.toggle('hidden', !debrief || lost);
  screens.pick.classList.toggle('hidden', !inGame || !pickOpen || lost);
  screens.report.classList.toggle('hidden', !report || lost);
  screens.menu.classList.toggle('hidden', !inGame || !menuOpen || pickOpen || lost);
  if (lost) {
    $('lost-eyebrow').textContent = kicked ? 'Exclusion' : 'Liaison interrompue';
    $('lost-title').textContent = kicked ? 'Exclu de la partie' : 'Connexion perdue';
    $('lost-text').textContent = kicked ? 'L’hôte t’a retiré de la partie. Tu pourras revenir dans une minute.' : 'Le serveur ne répond plus. Vérifie qu’il est toujours lancé.';
  }
  screens.lost.classList.toggle('hidden', !lost);
  document.body.classList.toggle('mode-campaign', campaign);
  document.body.classList.toggle('mode-skirmish', !campaign);
  document.body.classList.toggle('in-hub', inLobby && !lost);
  hudActive = inGame && !debrief && !lost;
  input.enabled = hudActive && !menuOpen && !pickOpen && !game.paused;
  $('pause-banner').classList.toggle('hidden', !game.paused || !hudActive);
  chat.setVisible(!!me && !lost);
  if (!hudActive || menuOpen || pickOpen) setBigMap(false);
  applyMap();
  hud.setCampaignMode(campaign);
  if (!me) return;
  if (!inLobby) hub.reset();

  const isHost = game.hostId === game.myId;
  if (debrief) renderDebrief(isHost);
  if (report) renderReport();
  if (pickOpen) renderPick();
  if (menuOpen) renderMenu(isHost);
  $('pause-sub').textContent = isHost ? 'P › Reprendre la partie' : `Partie mise en pause par ${game.roster.get(game.hostId)?.name ?? 'l’hôte'}`;
  if (inLobby && !lost) hub.render();

  hud.setScore(game.score);
  hud.setRound(game.round, game.settings.roundsToWin);
}

$('name').value = localStorage.getItem('tank3d.name') || '';
if ($('name').value) $('password').focus();
$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  sfx.unlock();
  const name = $('name').value.trim();
  localStorage.setItem('tank3d.name', name);
  $('login-error').textContent = '';
  $('btn-login').disabled = true;
  try {
    await net.connect();
    net.send({ type: 'join', name, password: $('password').value });
  } catch {
    lost = true;
    refreshUI();
  }
});
// changer de compte : on coupe la connexion (le compte se libère) et on revient à l'accueil
$('rp-close').addEventListener('click', () => {
  reportSeen = game.report?.id ?? reportSeen;
  refreshUI();
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || lost || !game.me) return;
  if (bigMapOpen) setBigMap(false);
  else if (reportShown()) reportSeen = game.report.id;
  else if ((game.phase === 'lobby' || lobbyOpen) && hub.back()) { /* fenêtre ou page du hub refermée */ }
  else if (game.phase === 'lobby') return;
  else if (lobbyOpen) lobbyOpen = false;
  else if (pickOpen) pickOpen = false;
  else if (game.phase !== 'debrief' || performance.now() < debriefAt) menuOpen = !menuOpen;
  refreshUI();
});
for (const btn of document.querySelectorAll('.pick-team')) {
  btn.addEventListener('click', () => {
    if (!chooseTeam(btn.dataset.team)) return;
    pickOpen = false;
    refreshUI();
  });
}
$('pick-spectate').addEventListener('click', () => {
  if (!chooseTeam(null)) return;
  pickOpen = false;
  refreshUI();
});
$('pick-lobby').addEventListener('click', () => {
  pickOpen = false;
  lobbyOpen = true;
  refreshUI();
});
$('btn-menu').addEventListener('click', (e) => {
  e.currentTarget.blur();
  menuOpen = true;
  refreshUI();
});
$('menu-resume').addEventListener('click', () => {
  menuOpen = false;
  refreshUI();
});
$('menu-team').addEventListener('click', () => {
  menuOpen = false;
  pickOpen = true;
  refreshUI();
});
$('menu-spectate').addEventListener('click', () => {
  if (!chooseTeam(null)) return;
  menuOpen = false;
  refreshUI();
});
$('menu-lobby').addEventListener('click', () => {
  menuOpen = false;
  lobbyOpen = true;
  refreshUI();
});
$('menu-pause').addEventListener('click', () => net.send({ type: 'pause', on: !game.paused }));
$('menu-abort').addEventListener('click', () => {
  if (!confirm(isCampaign() ? 'Abandonner la mission et revenir au salon ?' : 'Terminer la partie et revenir au salon ?')) return;
  menuOpen = false;
  net.send({ type: 'abort' });
});
$('menu-logout').addEventListener('click', () => location.reload());
$('db-next').addEventListener('click', () => net.send({ type: 'debrief', action: 'next' }));
$('db-retry').addEventListener('click', () => net.send({ type: 'debrief', action: 'retry' }));
$('db-lobby').addEventListener('click', () => net.send({ type: 'debrief', action: 'lobby' }));
addEventListener('pointerdown', () => sfx.unlock());
addEventListener('keydown', () => sfx.unlock());

// ----------------------------------------------------------------- réseau

net.on('welcome', (msg) => {
  game.myId = msg.id;
  lanUrls = msg.lanUrls;
  $('btn-login').disabled = false;
  $('password').value = '';
});
net.on('loginError', (msg) => {
  $('login-error').textContent = msg.error;
  $('btn-login').disabled = false;
  $('password').select();
});
net.on('account', (msg) => {
  // nouveaux skins débloqués par cette progression : annoncés tout de suite et au rapport de mission
  if (game.account) {
    const before = new Set(unlockedSkins(game.account.cleared));
    for (const id of unlockedSkins(msg.cleared)) {
      if (before.has(id) || newSkins.includes(id)) continue;
      newSkins.push(id);
      hud.toast(`Skin débloqué : ${SKINS[id].name}`, 'green');
    }
  }
  game.account = { name: msg.name, cleared: msg.cleared, xp: msg.xp ?? 0, credits: msg.credits ?? 0, tanks: msg.tanks ?? [] };
  refreshUI();
});
// Récompenses de fin de partie ou de mission (XP + crédits, éventuelle promotion)
net.on('reward', (msg) => {
  lastReward = msg;
  rewardsByReport.set(msg.report, msg);
  hud.toast(`${signed(msg.cr.gained)} cr · +${fmtInt(msg.xp.gained)} XP`, msg.cr.gained >= 0 ? 'green' : 'red');
  if (msg.rankUp) hud.toast(`Promotion : ${msg.rankUp} !`, 'green');
  refreshUI();
});
net.on('bought', (msg) => {
  hub.onBought(msg);
  sfx.beep(true);
  refreshUI();
});
net.on('buyError', (msg) => {
  hub.onBuyError(msg);
  refreshUI();
});
net.on('state', (msg) => {
  game.onState(msg);
  // arrivée en cours de partie : on regarde en spectateur, avec le choix de rejoindre une équipe
  if (firstState && game.me) {
    firstState = false;
    if (game.phase !== 'lobby' && !game.me.team) pickOpen = true;
  }
  refreshUI();
});
net.on('kicked', () => (kicked = true));
net.on('chat', (msg) => {
  chat.add(msg);
  if (msg.id !== game.myId) sfx.chat();
});
net.on('mark', (msg) => {
  // un seul signalement actif par joueur : le nouveau remplace l'ancien
  const i = marks.findIndex((m) => m.by === msg.id);
  if (i >= 0) marks.splice(i, 1);
  marks.push({ key: ++markSeq, by: msg.id, name: msg.name, x: msg.x, z: msg.z, target: msg.target, age: 0, life: msg.target ? TARGET_LIFE : MARK_LIFE });
  sfx.mark(msg.target != null);
  if (msg.target != null) {
    const enemy = game.roster.get(msg.target);
    const enemyName = enemy ? (enemy.unit ? unitDef(views.get(msg.target)?.type ?? enemy.type).name : enemy.name) : 'un ennemi';
    hud.toast(`${msg.id === game.myId ? 'Tu cibles' : `${msg.name} cible`} ${enemyName}`, 'red');
  }
});
net.on('snap', (msg) => {
  const paused = game.paused;
  game.onSnap(msg, performance.now());
  if (paused !== game.paused) refreshUI();
});
net.on('ev', (msg) => msg.list.forEach(onEvent));
net.on('close', () => {
  lost = true;
  refreshUI();
});

// volume d'un son selon sa distance au joueur
function volumeAt(x, z) {
  const d = Math.hypot(x - listener.x, z - listener.z);
  return Math.max(0, 1 - d / 130) ** 2;
}

const REASONS = { elimination: 'Équipe adverse détruite', capture: 'Zone capturée', time: 'Temps écoulé' };

// Taille de l'explosion à la destruction d'une unité.
function wreckScale(type) {
  const def = unitDef(type);
  return def.boss ? 4.5 : def.structure ? 3.2 : 2.2;
}

function onEvent(ev) {
  switch (ev.k) {
    case 'shot': {
      if (ev.o === game.myId && fx.confirmLocalShell(ev.id, ev)) break; // déjà affiché par la prédiction
      const def = unitDef(game.roster.get(ev.o)?.type);
      const L = ev.L ?? def.barrelLength, speed = ev.sp ?? def.shellSpeed;
      fx.spawnShell(ev.id, ev.x, ev.y, ev.z, ev.dx, ev.dz, L, speed, ev.md ?? def.shellSpeed * def.shellLifeTicks * DT, ev.sz ?? 1, ev.vy, ev.g);
      const small = (ev.sz ?? 1) < 0.8;
      if (small) fx.sparks(ev.x + ev.dx * L, shellHeight(ev.y, L, ev.vy, ev.g), ev.z + ev.dz * L, 3, 0.4);
      else fx.muzzleFlash(ev.x + ev.dx * L, shellHeight(ev.y, L, ev.vy, ev.g), ev.z + ev.dz * L, ev.dx, ev.dz);
      renderer.fireKick(ev.o);
      sfx.shot(volumeAt(ev.x, ev.z) * (small ? 0.25 : 1));
      break;
    }
    case 'arc': {
      fx.spawnArcShell(ev.id, ev.x, ev.y, ev.z, ev.tx, ev.tz, ev.T / TICK_RATE, ev.pk, ev.r);
      fx.sparks(ev.x, ev.y, ev.z, 5, 0.6);
      for (let i = 0; i < 3; i++) fx.smoke(ev.x, ev.y, ev.z, false);
      renderer.fireKick(ev.o);
      sfx.mortar(volumeAt(ev.x, ev.z));
      // sifflement si l'obus tombe près de moi
      if (Math.hypot(ev.tx - listener.x, ev.tz - listener.z) < 25) setTimeout(() => sfx.whistle(), Math.max(0, (ev.T / TICK_RATE - 0.9) * 1000));
      break;
    }
    case 'boom': {
      fx.removeShell(ev.id);
      const scale = ev.r === 0 ? 0.3 : Math.min(2, (ev.r ?? RULES.splashRadius) / RULES.splashRadius);
      fx.explosion(ev.x, ev.y, ev.z, scale);
      if (ev.hit !== null) {
        fx.sparks(ev.x, ev.y, ev.z, ev.r === 0 ? 3 : 14, ev.r === 0 ? 0.5 : 1.2); // impact sur du blindage
        renderer.hitKick(ev.hit);
      }
      sfx.explosion(volumeAt(ev.x, ev.z) * (ev.r === 0 ? 0.15 : 0.7 * scale));
      break;
    }
    case 'gone':
      fx.removeShell(ev.id);
      break;
    case 'hp':
      if (ev.heal) break;
      if (ev.d > 0) logDamage(ev);
      if (shotByWatched(ev.by) && ev.d > 0) {
        const v = views.get(ev.id);
        if (v) damageNumber(v.x, v.gy + unitDef(v.type).height + 1.6, v.z, `-${ev.d}`, ev.hp <= 0 ? 'kill' : '');
      }
      // un char touché par mon équipe reste visible (barre de vie) 5 s, même dans un buisson
      if (ev.d > 0 && ev.by != null && game.roster.get(ev.by)?.team === game.me?.team) revealUntil.set(ev.id, time + REVEAL_SECONDS);
      if (ev.id === game.myId) {
        hud.damageFlash();
        renderer.shake = 0.7;
      } else if (ev.by === game.myId) {
        hud.hitMarker();
        sfx.hit();
      }
      break;
    case 'deflect': {
      const v = views.get(ev.id);
      if (v) fx.sparks(v.x, v.gy + 3, v.z, 6, 0.8);
      break;
    }
    case 'kill': {
      const victim = game.roster.get(ev.id);
      if (victim) hud.addKill(game.roster.get(ev.by), victim);
      const pos = views.get(ev.id);
      if (pos) {
        const scale = wreckScale(pos.type);
        fx.explosion(pos.x, 1.5, pos.z, scale);
        for (let i = 0; i < 10 * scale * 0.5; i++) fx.flame(pos.x + (Math.random() - 0.5) * scale, 1.2 + Math.random() * scale * 0.5, pos.z + (Math.random() - 0.5) * scale);
        renderer.hitKick(ev.id);
        sfx.explosion(Math.min(1, volumeAt(pos.x, pos.z) * scale * 0.5));
        if (scale > 3) renderer.shake = Math.max(renderer.shake, 1.2 * volumeAt(pos.x, pos.z));
      }
      break;
    }
    case 'pickup': {
      const pk = game.pickups.find((p) => p[0] === ev.id);
      const info = PICKUPS[ev.kind];
      if (pk) fx.burst(pk[2], pk[3], info.color);
      if (ev.by === game.myId) {
        hud.toast(info.name, 'green');
        sfx.pickup();
      } else {
        hud.toast(`${game.roster.get(ev.by)?.name ?? '?'} · ${info.name}`, '');
      }
      break;
    }
    case 'respawn': {
      const v = views.get(ev.id);
      if (ev.id === game.myId) {
        hud.announce('De retour au combat', '', 1.5);
        sfx.pickup();
      } else {
        hud.toast(`${game.roster.get(ev.id)?.name ?? '?'} revient au combat`, 'blue');
      }
      if (v) fx.burst(v.x, v.z, 0x6cc2ff, 0.8);
      break;
    }
    case 'wave':
      hud.announce(`Vague ${ev.n}`, ev.n === ev.total ? 'Dernière vague !' : `sur ${ev.total}`, 2.5);
      sfx.alarm();
      break;
    case 'boss':
      hud.announce(ev.text, ev.sub ?? '', 3);
      sfx.alarm();
      break;
    case 'toast':
      hud.toast(ev.text, ev.c);
      break;
    case 'objHit':
      fx.sparks(ev.x, ev.y, ev.z, 5, 0.6);
      if (shotByWatched(ev.by)) damageNumber(ev.x, ev.y + 1, ev.z, `-${ev.d}`, 'obj');
      break;
    case 'wreck': {
      const size = ev.kind === 'wall' || ev.kind === 'ruin' ? 1.4 : ev.kind === 'tree' || ev.kind === 'palm' ? 0.8 : 1;
      fx.debris(ev.x, Math.min(ev.h, 3) * 0.5, ev.z, DEBRIS[ev.kind] ?? 0x8a8070, size);
      fx.explosion(ev.x, 1, ev.z, 0.6 * size);
      sfx.explosion(volumeAt(ev.x, ev.z) * 0.6);
      if (shotByWatched(ev.by)) damageNumber(ev.x, Math.min(ev.h, 4) + 1.5, ev.z, 'Détruit', 'obj kill');
      break;
    }
    case 'pause':
      hud.toast(ev.on ? 'Partie en pause' : 'Reprise de la partie', ev.on ? '' : 'green');
      sfx.beep(!ev.on);
      break;
    case 'missionStart': {
      fx.clear();
      marks.length = 0;
      hud.clearDamageLog();
      debriefAt = 0;
      newSkins = [];
      lastReward = null;
      const m = getMission(ev.id);
      hud.announce(m.name, m.objective.label, 3);
      break;
    }
    case 'missionEnd':
      hud.announce(ev.success ? 'Mission accomplie' : 'Mission échouée', ev.success ? stars(ev.stars) : ev.reason, 3);
      if (ev.success) sfx.victory();
      else sfx.alarm();
      debriefAt = performance.now() + 2800;
      setTimeout(refreshUI, 2900);
      break;
    case 'roundStart':
      fx.clear();
      marks.length = 0;
      hud.clearDamageLog();
      hud.announce(`Manche ${ev.n}`, 'Préparez-vous', 3);
      break;
    case 'roundEnd':
      hud.setScore(ev.score);
      hud.announce(ev.winner ? `Victoire des ${TEAM_INFO[ev.winner].label}` : 'Égalité', REASONS[ev.reason] ?? '', 5);
      break;
    case 'matchEnd':
      hud.announce(`Les ${TEAM_INFO[ev.winner].label} l'emportent`, `${ev.score.red} – ${ev.score.blue}`, 8);
      break;
  }
}

// ------------------------------------------------- signalements et carte
// T : signale le point visé (ou l'ennemi visé, qui reçoit une cible à côté de sa barre de vie).
// M : carte en grand ; un clic y pose un signalement (sur un ennemi visible : il est ciblé).
const MARK_LIFE = 8, TARGET_LIFE = 12; // secondes
const marks = []; // { key, by, name, x, z, target, age, life }
let markSeq = 0;
let bigMapOpen = false;
let shownDots = []; // points de la mini-carte de la dernière image (pour viser à la souris sur la carte en grand)
let aimPoint = null; // point de l'écran visé (repère du canon, sinon centre de l'écran)
let seenEnemies = new Map(); // ennemis visibles cette image : id -> { x, z, sx, sy }

function setBigMap(on) {
  if (on === bigMapOpen) return;
  bigMapOpen = on;
  $('bigmap').classList.toggle('hidden', !on);
  hud.setBigMap(on ? $('bigmap-canvas') : null, Math.min(innerWidth - 60, innerHeight - 110, 900));
}
addEventListener('resize', () => {
  if (!bigMapOpen) return;
  bigMapOpen = false;
  setBigMap(true);
});

// Signale un point (x, z) et éventuellement un char ennemi.
function sendMark(x, z, target = null) {
  net.send({ type: 'mark', x, z, target });
}

function pingAhead() {
  const mine = views.get(game.myId);
  const aim = aimPoint ?? { x: innerWidth / 2, y: innerHeight / 2 };
  // ennemi le plus proche du point visé à l'écran (tolérance de quelques dizaines de pixels)
  let best = null, bestD = 70;
  for (const [id, e] of seenEnemies) {
    const d = Math.hypot(e.sx - aim.x, e.sy - aim.y);
    if (d < bestD) {
      bestD = d;
      best = { id, ...e };
    }
  }
  if (best) return sendMark(best.x, best.z, best.id);
  if (mine?.alive) {
    const d = game.def.weapon === 'mortar' ? arcRange(game.def, input.range) : impactDistance(mine, game.def);
    return sendMark(mine.x + Math.sin(mine.ty) * d, mine.z + Math.cos(mine.ty) * d);
  }
  // sans char : point du sol au centre de la caméra
  const cam = renderer.camera;
  const dir = cam.position.clone();
  cam.getWorldDirection(dir);
  if (dir.y > -0.02) return;
  const t = Math.min(200, -cam.position.y / dir.y);
  sendMark(cam.position.x + dir.x * t, cam.position.z + dir.z * t);
}

$('bigmap-canvas').addEventListener('pointerdown', (e) => {
  const w = hud.bigMapToWorld(e.clientX, e.clientY);
  if (!w) return;
  // clic près d'un ennemi visible : on le cible
  let best = null, bestD = 14 * w.perPx;
  for (const d of shownDots) {
    if (!d.enemy || !d.alive) continue;
    const dist = Math.hypot(d.x - w.x, d.z - w.z);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  if (best) sendMark(best.x, best.z, best.id);
  else sendMark(w.x, w.z);
});
$('bigmap-canvas').addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('keydown', (e) => {
  if (lost || !game.me) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Enter') {
    if (e.repeat) return;
    e.preventDefault(); // pas de clic sur le bouton qui a le focus
    chat.open();
    return;
  }
  if (!hudActive || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase(); // lettre affichée (M et T ne sont pas au même endroit en AZERTY / QWERTY)
  if (k === 'p') {
    // pause : réservée à l'hôte, pendant une partie en cours
    if (game.hostId !== game.myId) hud.toast('Seul l’hôte peut mettre la partie en pause', '');
    else if (['countdown', 'playing', 'roundEnd'].includes(game.phase)) net.send({ type: 'pause', on: !game.paused });
    return;
  }
  if (menuOpen || pickOpen) return;
  if (k === 'm') setBigMap(!bigMapOpen);
  else if (k === 't') pingAhead();
});

// Fait vieillir les signalements ; une cible disparaît avec l'ennemi.
function updateMarks(dt) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    m.age += dt;
    const v = m.target != null ? views.get(m.target) : null;
    if (m.target != null && (!v || !v.alive)) m.age = Math.max(m.age, m.life - 0.01);
    if (m.age >= m.life || game.phase === 'lobby') marks.splice(i, 1);
  }
}

// ----------------------------------------------------------- boucle de jeu

function onLocalFire() {
  const p = game.pred, def = game.def;
  if (def.weapon === 'mortar') {
    renderer.shake = 0.45; // l'obus en cloche part avec l'événement du serveur (arc)
    return;
  }
  const dx = Math.sin(p.ty), dz = Math.cos(p.ty), L = def.barrelLength;
  const { y0, vy, g } = shotProfile(p, def);
  fx.spawnLocalShell(p.x, y0, p.z, dx, dz, L, def.shellSpeed, def.shellSpeed * def.shellLifeTicks * DT, 1, vy, g);
  fx.muzzleFlash(p.x + dx * L, shellHeight(y0, L, vy, g), p.z + dz * L, dx, dz);
  renderer.fireKick(game.myId);
  renderer.shake = 0.3;
  renderer.kick = 1.1;
  sfx.shot(1);
}

// Altitude du canon et pente de l'obus (visée verticale automatique sur les cartes à relief ; vy absent sinon).
function shotProfile(p, def) {
  const map = game.map;
  if (!map.hills) return { y0: def.muzzleHeight, vy: undefined, g: 0 };
  const g = heightAt(p.x, p.z, map), y0 = def.muzzleHeight + g;
  const foes = [];
  for (const v of views.values()) if (v.alive && v.team !== game.me?.team && v.id !== game.myId) foes.push(v);
  return { y0, vy: autoPitch(p.x, p.z, p.ty, y0, foes, map, def.shellSpeed), g };
}

// Barres de vie : un char ennemi dans un buisson n'affiche pas la sienne, sauf 5 s après avoir été touché.
const REVEAL_SECONDS = 5;
const revealUntil = new Map(); // id -> instant (time) jusqu'auquel le char reste visible
const hiddenInBush = (v, ally, spectator) => !ally && !spectator && inBush(v.x, v.z, game.map) && !((revealUntil.get(v.id) ?? 0) > time);

// Y a-t-il une ligne de vue dégagée entre deux chars ?
function canSee(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 4) return true;
  const map = game.map;
  if (!map.hills) return marchRay(a.x, 2.2, a.z, dx / d, 0, dz / d, d - 2, 1, map) >= d - 2;
  const oy = heightAt(a.x, a.z, map) + 2.2;
  return marchRay(a.x, oy, a.z, dx / d, (heightAt(b.x, b.z, map) + 1.5 - oy) / d, dz / d, d - 2, 1, map) >= d - 2;
}

// Chars que je peux observer : tous les joueurs pour un spectateur, mes coéquipiers si mon char est détruit.
function watchList() {
  const spectator = isSpectator(), team = game.me?.team;
  return [...views.values()].filter((v) => v.alive && !v.unit && (spectator || v.team === team)).sort((a, b) => a.id - b.id);
}

// Passe au joueur observé suivant (step = ±1).
function cycleWatch(step) {
  const list = watchList();
  if (!list.length) return;
  const i = list.findIndex((v) => v.id === spec.id);
  spec.id = list[i < 0 ? 0 : (i + step + list.length) % list.length].id;
  spec.free = false;
}

// Qui la caméra suit-elle ? Moi si je suis en vie, sinon le joueur observé (au choix), sinon mon épave.
// null = caméra libre (spectateur) ou vue d'ensemble.
function cameraTarget() {
  if (game.phase === 'matchEnd' || game.phase === 'lobby') return null;
  if (game.phase === 'debrief' && performance.now() >= debriefAt) return null;
  const mine = views.get(game.myId);
  if (mine?.alive) return mine;
  if (spec.free && isSpectator()) return null;
  const list = watchList();
  const t = list.find((v) => v.id === spec.id) ?? list[0];
  if (t) {
    spec.id = t.id;
    return t;
  }
  return mine ?? null;
}

// Commandes de spectateur actives ? (en jeu, sans menu ouvert, sans char en vie)
const specControls = () => hudActive && !menuOpen && !pickOpen && !views.get(game.myId)?.alive && game.phase !== 'lobby';

function enterFreeCam() {
  const c = renderer.camera.position;
  Object.assign(spec, { free: true, x: c.x, y: Math.max(8, c.y), z: c.z, yaw: renderer.camYaw ?? 0, pitch: -0.35 });
}

const SPEC_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', (e) => {
  if (!specControls() || e.target.tagName === 'INPUT') return;
  if (SPEC_KEYS.has(e.code)) {
    keys.add(e.code);
    e.preventDefault();
  }
  if (e.repeat) return;
  if (e.code === 'KeyF' && isSpectator()) {
    if (spec.free) spec.free = false;
    else enterFreeCam();
  } else if (!spec.free && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
    cycleWatch(e.code === 'ArrowRight' ? 1 : -1);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// caméra libre : glisser à la souris pour regarder, molette pour monter / descendre
let drag = null;
renderer.gl.domElement.addEventListener('pointerdown', (e) => {
  if (spec.free && specControls()) drag = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag || !spec.free) return;
  spec.yaw -= (e.clientX - drag.x) * 0.004;
  spec.pitch = Math.max(-1.45, Math.min(0.6, spec.pitch - (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
renderer.gl.domElement.addEventListener('wheel', (e) => {
  if (spec.free && specControls()) spec.y = Math.max(2, Math.min(160, spec.y - e.deltaY * 0.03));
}, { passive: true });

// ------------------------------------------------------- scène du hub
// Au hangar et à la boutique, des panneaux couvrent les bords de l'écran : on décale l'image pour que le char
// se retrouve au milieu de l'espace libre (le glissement est progressif quand on change de page).
const stage = { l: 0, r: 0, t: 0, b: 0, z: 1 };
let garageSpin = 0; // le char se fait tourner à la souris (décalage ajouté au temps de la caméra du salon)
let garageDrag = null;

function frameStage(on, dt) {
  const target = on ? hub.insets() : { l: 0, r: 0, t: 0, b: 0, z: 1 };
  const goalZoom = on ? Math.max(0.7, Math.min(0.95, (innerHeight - target.t - target.b) / (innerHeight * 0.45))) : 1;
  const k = on ? 1 - Math.exp(-dt * 9) : 1; // hors du hub : retour immédiat à la vue normale
  for (const key of ['l', 'r', 't', 'b']) {
    const d = target[key] - stage[key];
    stage[key] = Math.abs(d) < 0.4 ? target[key] : stage[key] + d * k;
  }
  stage.z += (goalZoom - stage.z) * k;
  const cam = renderer.camera;
  if (on) {
    // la caméra du salon vise un peu sous le char : on redescend l'image d'autant
    const lift = innerHeight * 0.07;
    cam.zoom = stage.z;
    cam.setViewOffset(innerWidth, innerHeight, -(stage.l - stage.r) / 2, -(stage.t - stage.b) / 2 - lift, innerWidth, innerHeight);
  } else if (cam.view?.enabled || cam.zoom !== 1) {
    cam.zoom = 1;
    cam.clearViewOffset();
  }
}

const inGarage = () => !!game.me && game.phase === 'lobby' && !lost;
renderer.gl.domElement.addEventListener('pointerdown', (e) => {
  if (!inGarage()) return;
  garageDrag = { x: e.clientX, id: e.pointerId };
  renderer.gl.domElement.setPointerCapture(e.pointerId);
  document.body.classList.add('dragging');
});
renderer.gl.domElement.addEventListener('pointermove', (e) => {
  if (!garageDrag) return;
  garageSpin -= ((e.clientX - garageDrag.x) * 0.009) / 0.22; // 0,22 rad/s : vitesse de rotation de garageCamera
  garageDrag.x = e.clientX;
});
const endGarageDrag = () => {
  garageDrag = null;
  document.body.classList.remove('dragging');
};
renderer.gl.domElement.addEventListener('pointerup', endGarageDrag);
renderer.gl.domElement.addEventListener('pointercancel', endGarageDrag);

// Déplacement de la caméra libre (ZQSD au sol, Espace / C en hauteur, Maj pour aller vite).
function moveFreeCam(dt) {
  if (!specControls()) return;
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const v = (fast ? 70 : 28) * dt;
  const turn = 1.8 * dt;
  if (keys.has('ArrowLeft')) spec.yaw += turn;
  if (keys.has('ArrowRight')) spec.yaw -= turn;
  if (keys.has('ArrowUp')) spec.pitch = Math.min(0.6, spec.pitch + turn * 0.6);
  if (keys.has('ArrowDown')) spec.pitch = Math.max(-1.45, spec.pitch - turn * 0.6);
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sx = Math.sin(spec.yaw), cz = Math.cos(spec.yaw);
  spec.x += (sx * f - cz * r) * v;
  spec.z += (cz * f + sx * r) * v;
  spec.y += ((keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0)) * v * 0.7;
  const m = game.map;
  spec.x = Math.max(-m.halfX - 40, Math.min(m.halfX + 40, spec.x));
  spec.z = Math.max(-m.halfZ - 40, Math.min(m.halfZ + 40, spec.z));
  spec.y = Math.max(2 + heightAt(spec.x, spec.z, m), Math.min(160, spec.y));
}

let last = performance.now();
let acc = 0;
let time = 0;
let camId = null;
let lastCount = null;
let lastPhase = 'lobby';

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;

  // 1. Simulation à pas fixe (60 Hz) : envoi des commandes + prédiction de mon char
  acc += dt;
  while (acc >= DT) {
    acc -= DT;
    if (game.localTick(input.sample(), net)) onLocalFire();
  }
  game.decayError(dt);

  // 2. Position affichée de chaque char (et de chaque unité de campagne)
  views = new Map();
  if (game.latest && game.phase !== 'lobby') {
    const rt = game.renderTick(now);
    for (const [id, p] of game.latest.pl) {
      const v = id === game.myId && game.pred ? game.ownView(acc / DT) : game.remoteView(id, rt);
      if (!v) continue;
      const r = game.roster.get(id);
      v.id = id;
      v.gy = heightAt(v.x, v.z, game.map);
      v.hp = p.hp;
      v.maxHp = p.mh;
      v.alive = p.al;
      v.type = p.tk;
      v.shield = p.sh;
      v.respawn = p.rs;
      v.team = r?.team ?? 'red';
      v.skin = r?.skin ?? DEFAULT_SKIN;
      v.unit = !!r?.unit;
      v.obj = !!r?.obj;
      views.set(id, v);
    }
  }
  renderer.syncTanks(views, dt);
  renderer.syncPickups(game.phase === 'lobby' ? [] : game.pickups, time);

  // 3. Caméra (et char d'exposition quand on est au salon)
  const me = game.me;
  const garage = !!me && game.phase === 'lobby';
  renderer.setShowcase(garage ? hub.showcaseType() : null, garage ? me.team : null, garage ? me.skin ?? DEFAULT_SKIN : null);
  const target = cameraTarget();
  if (target) {
    renderer.followCamera(target.x, target.z, target.ty, dt, camId !== target.id);
    listener = target;
  } else if (spec.free && isSpectator() && hudActive) {
    moveFreeCam(dt);
    renderer.freeCamera(spec.x, spec.y, spec.z, spec.yaw, spec.pitch);
    listener = { x: spec.x, z: spec.z };
  } else if (garage) {
    renderer.garageCamera(time + garageSpin);
  } else {
    renderer.orbitCamera(time);
  }
  camId = target ? target.id : null;
  frameStage(garage && !lost, dt);

  // 4. Effets
  if (!game.paused) fx.update(dt); // en pause, les obus restent figés comme sur le serveur
  renderer.zone.update(game.zone.team, game.zone.p, game.zone.c, time);
  const mine = views.get(game.myId);
  sfx.engine(!!mine?.alive && input.enabled, mine ? Math.abs(mine.speed) / game.def.maxSpeed : 0);

  renderer.render();

  // 5. HUD
  if (hudActive) updateHud(dt, mine, target);
  updateDamageNumbers(dt);
}

// Point d'impact prévu de mon obus : on suit sa trajectoire jusqu'au premier obstacle ou char.
function impactDistance(mine, def, shot) {
  const dx = Math.sin(mine.ty), dz = Math.cos(mine.ty);
  for (let d = 0.5; d <= 140; d += 0.5) {
    const x = mine.x + dx * d, y = shellHeight(shot.y0, d, shot.vy, shot.g), z = mine.z + dz * d;
    if (pointBlocked(x, y, z, game.map)) return d;
    for (const v of views.values()) if (v.id !== game.myId && pointHitsTank(x, y, z, v, unitDef(v.type), v.gy)) return d;
  }
  return 140;
}

function updateHud(dt, mine, target) {
  const def = game.def;
  const campaign = isCampaign();
  hud.update(dt);
  hud.setTimer(game.timeLeft, game.phase);
  hud.setZone(campaign ? { ...game.zone, p: 0, c: false } : game.zone);
  const mission = campaign ? getMission(game.settings.mission) : null;

  // compte à rebours
  if (game.phase === 'countdown') {
    const n = Math.ceil(game.timeLeft / TICK_RATE);
    if (n > 0 && n !== lastCount) {
      lastCount = n;
      hud.announce(String(n), campaign ? mission.name : `Manche ${game.round}`, 1.2);
      sfx.beep(false);
    }
  } else if (lastPhase === 'countdown' && game.phase === 'playing') {
    lastCount = null;
    hud.announce(campaign ? 'En avant !' : 'Feu à volonté', campaign ? mission.objective.label : '', 1.6);
    sfx.beep(true);
  }
  lastPhase = game.phase;

  const counts = { red: { alive: 0, total: 0 }, blue: { alive: 0, total: 0 } };
  const tags = [];
  const dots = [];
  const myTeam = game.me?.team;
  const spectator = isSpectator();
  document.body.classList.toggle('spectating', spectator);
  let boss = null;
  updateMarks(dt);
  const targeted = new Set(marks.filter((m) => m.target != null).map((m) => m.target));
  seenEnemies = new Map();
  for (const v of views.values()) {
    const udef = unitDef(v.type);
    if (!v.unit) {
      counts[v.team].total++;
      if (v.alive) counts[v.team].alive++;
    }
    if (udef.boss && v.alive) boss = { name: udef.name, hp: v.hp, max: v.maxHp, shield: v.shield };
    const ally = v.team === myTeam;
    // les unités fixes restent sur la carte une fois repérées : on les montre toujours
    const visible = ally || spectator || !target || udef.static || (v.alive && canSee(target, v));
    if (visible) {
      dots.push({
        id: v.id, name: v.unit ? '' : game.roster.get(v.id)?.name, enemy: !ally && !spectator,
        x: v.x, z: v.z, ty: v.ty, team: v.team, me: v.id === game.myId, alive: v.alive,
        fixed: udef.static, obj: v.obj, size: udef.boss ? 4.5 : udef.structure ? 3 : udef.static ? 1.8 : undefined,
      });
    }
    if (v.alive && visible && !ally && !spectator) {
      const c = renderer.project(v.x, v.gy + udef.height * 0.5, v.z);
      if (c.front) seenEnemies.set(v.id, { x: v.x, z: v.z, sx: c.x, sy: c.y });
    }
    if (v.id === target?.id || !v.alive || !visible || udef.boss || hiddenInBush(v, ally, spectator)) continue;
    // étiquettes : joueurs, objectifs, et unités proches ou entamées
    const dist = target ? Math.hypot(v.x - target.x, v.z - target.z) : 0;
    const marked = targeted.has(v.id);
    if (v.unit && !v.obj && !marked && dist > 55 && v.hp >= v.maxHp) continue;
    const s = renderer.project(v.x, v.gy + udef.height + 1.4, v.z);
    const name = v.unit ? udef.name : game.roster.get(v.id)?.name ?? '';
    if (s.front) tags.push({ id: v.id, name, team: v.team, obj: v.obj, marked, hpRatio: v.hp / (v.maxHp || udef.maxHp), x: s.x, y: s.y });
  }
  // signalements de points dans le monde (les cibles, elles, s'affichent à côté de la barre de vie)
  const from = listener;
  const markTags = [];
  for (const m of marks) {
    if (m.target != null) continue;
    const s = renderer.project(m.x, 2.5, m.z);
    if (!s.front) continue;
    markTags.push({ key: m.key, name: m.by === game.myId ? 'Toi' : m.name, dist: Math.hypot(m.x - from.x, m.z - from.z), x: s.x, y: s.y, alpha: Math.min(1, (m.life - m.age) / 1.5) });
  }
  hud.setMarks(markTags);
  shownDots = dots;
  if (!campaign) hud.setAlive(counts);
  hud.setTags(tags);
  hud.drawMinimap(dots, game.zone, game.pickups, marks);
  if (campaign) {
    hud.setMission(`${mission.name} · ${DIFFICULTIES[game.settings.difficulty]?.name ?? ''}`, game.campaign);
    hud.setBoss(boss);
  }

  const latestMe = game.latest?.pl.get(game.myId);
  if (mine?.alive && game.pred) {
    const rof = game.pred.rof ?? 1;
    let reloadMax = def.reloadTicks * rof, extra = '';
    if (def.burst) {
      // rafales : le long rechargement suit le dernier obus ; on affiche les obus restants
      if (game.pred.reload > reloadMax) reloadMax = def.burst.pause * rof;
      extra = `obus ${def.burst.shots - (game.pred.shots ?? 0)}/${def.burst.shots}`;
    }
    let s, aimDist = 0, aimY = 0;
    $('help-range').classList.toggle('hidden', def.weapon !== 'mortar');
    if (def.weapon === 'mortar') {
      // obusier : point de chute au sol, à la portée réglée (A / E)
      const d = arcRange(def, input.range);
      const gx = mine.x + Math.sin(mine.ty) * d, gz = mine.z + Math.cos(mine.ty) * d;
      // le cercle au sol est le rayon de dispersion : l'obus retombe n'importe où à l'intérieur
      const R = Math.max(0.5, dispersionAngle(def, game.pred.aim ?? 0) * d);
      fx.aimRing(gx, gz, R);
      hud.setMapAim({ x: gx, z: gz, r: R });
      aimY = heightAt(gx, gz, game.map) + 0.3;
      s = renderer.project(gx, aimY, gz);
      aimDist = d;
      extra = `${Math.round(d)} m`;
    } else {
      fx.aimRing(null);
      hud.setMapAim(null);
      const shot = shotProfile(mine, def);
      const d = impactDistance(mine, def, shot);
      aimY = shellHeight(shot.y0, d, shot.vy, shot.g);
      s = renderer.project(mine.x + Math.sin(mine.ty) * d, aimY, mine.z + Math.cos(mine.ty) * d);
      aimDist = d;
    }
    hud.setStatus(def.name, mine.hp, mine.maxHp ?? def.maxHp, game.pred.reload, Math.round(reloadMax), extra);
    // l'anneau de visée a le rayon de dispersion à la distance de l'impact, converti en pixels
    let aimRadius = 0;
    if (s.front && def.acc && def.weapon !== 'mortar') {
      const R = dispersionAngle(def, game.pred.aim ?? 0) * aimDist;
      const ex = mine.x + Math.sin(mine.ty) * aimDist + Math.cos(mine.ty) * R;
      const ez = mine.z + Math.cos(mine.ty) * aimDist - Math.sin(mine.ty) * R;
      const e = renderer.project(ex, aimY, ez);
      aimRadius = e.front ? Math.hypot(e.x - s.x, e.y - s.y) : 0;
    }
    hud.setGunmark(s.front ? s : null, aimRadius);
    aimPoint = s.front ? s : null;
    hud.setSpectate('');
    // bonus actifs : ce qu'il reste en tirs faits (cadence, perforants) ou en impacts reçus (bouclier)
    const bf = latestMe?.bf ?? [0, 0, 0];
    const buffs = [['rapid', 'shots', 'tirs'], ['damage', 'shots', 'tirs'], ['shield', 'hits', 'impacts']]
      .map(([k, field, unit], i) => ({ ...PICKUPS[k], left: bf[i], max: PICKUPS[k][field], unit }))
      .filter((b) => b.left > 0);
    hud.setBuffs(buffs);
  } else {
    hud.setStatus(def.name, 0, def.maxHp, 0, def.reloadTicks);
    hud.setGunmark(null);
    hud.setMapAim(null);
    fx.aimRing(null);
    aimPoint = null;
    hud.setBuffs([]);
    const name = target && target.id !== game.myId ? game.roster.get(target.id)?.name : null;
    const watch = name ? ` · tu observes ${name}` : '';
    const several = watchList().length > 1;
    let text, hint = '';
    if (spectator) {
      const waiting = game.me?.team ? `Spectateur · ${campaign ? 'escouade' : TEAM_INFO[game.me.team].label} à la ${nextGame()} · ` : 'Spectateur · ';
      if (spec.free) {
        text = `${waiting}caméra libre`;
        hint = '<kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> se déplacer <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> ou souris : regarder '
          + '<kbd>Espace</kbd><kbd>C</kbd> monter / descendre <kbd>Maj</kbd> vite <kbd>F</kbd> suivre un joueur <kbd>Échap</kbd> menu';
      } else {
        text = `${waiting}${name ? `tu observes ${name}` : 'aucun joueur en vie'}`;
        hint = `${several ? '<kbd>←</kbd><kbd>→</kbd> changer de joueur ' : ''}<kbd>F</kbd> caméra libre <kbd>Échap</kbd> menu`;
      }
    } else {
      text = `Char détruit${watch}`;
      if (several) hint = '<kbd>←</kbd><kbd>→</kbd> changer de coéquipier';
    }
    hud.setSpectate(text, hint);
  }

  hud.setScoreboard(input.has('scores'), game.roster);
  hud.setDamageLog(input.has('dmglog'));
  hud.setNetInfo(`ping ${Math.round(net.rtt)} ms · tampon ${Math.round(game.interpDelay)} ms`);
}

refreshUI();
requestAnimationFrame(frame);
