// Progression des joueurs : expérience (XP) et grades, crédits et chars achetés.
// Simples données + calculs, partagés serveur + client.
//
// - L'XP fixe le grade (les récompenses de grade viendront plus tard).
// - Les crédits (cr) servent à acheter des chars au Store (champ `price` dans TANK_TYPES,
//   shared/constants.js). Un char sans prix est disponible pour tous dès le départ.
import { TANK_TYPES } from './constants.js';

// Grades, du plus bas au plus haut : XP totale nécessaire.
export const RANKS = [
  { name: 'Soldat', short: 'Sdt', xp: 0 },
  { name: 'Caporal', short: 'Cpl', xp: 500 },
  { name: 'Sergent', short: 'Sgt', xp: 1200 },
  { name: 'Adjudant', short: 'Adj', xp: 2500 },
  { name: 'Lieutenant', short: 'Lt', xp: 4000 },
  { name: 'Capitaine', short: 'Cne', xp: 6000 },
  { name: 'Commandant', short: 'Cdt', xp: 9000 },
  { name: 'Colonel', short: 'Col', xp: 13000 },
];

// Indice du grade pour cette XP.
export function rankIndex(xp = 0) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  return i;
}

// { rank, index, next (grade suivant ou null), progress 0..1 vers le suivant }
export function rankInfo(xp = 0) {
  const index = rankIndex(xp);
  const rank = RANKS[index], next = RANKS[index + 1] ?? null;
  const progress = next ? (xp - rank.xp) / (next.xp - rank.xp) : 1;
  return { rank, index, next, progress };
}

// ------------------------------------------------------------------ chars

export const tankPrice = (type) => TANK_TYPES[type]?.price ?? 0;

// Le joueur possède-t-il ce char ? `all` = tout débloqué (TANK3D_UNLOCK=1).
export function tankOwned(type, progress, all = false) {
  if (!TANK_TYPES[type]) return false;
  return all || !tankPrice(type) || !!progress?.tanks?.includes(type);
}

export const ownedTanks = (progress, all = false) => Object.keys(TANK_TYPES).filter((k) => tankOwned(k, progress, all));

export const fmtCr = (n) => `${Math.round(n).toLocaleString('fr-FR')} cr`;

// ---------------------------------------------------------------- récompenses
// Chaque barème renvoie le détail : [[libellé, montant], ...] (montants négatifs = pertes).

// XP d'une partie d'escarmouche terminée.
export function skirmishXp({ dmg = 0, kills = 0, roundsWon = 0, won = false }) {
  return [
    ['Participation', 25],
    ['Dégâts infligés', Math.round(dmg / 2)],
    ['Destructions', kills * 20],
    ['Manches gagnées', roundsWon * 25],
    ['Victoire', won ? 75 : 0],
  ].filter(([, n]) => n > 0);
}

// XP d'une mission de campagne (réussie ou non). stars = difficulté (1..3).
export function missionXp({ dmg = 0, kills = 0, success = false, stars = 1 }) {
  return [
    ['Mission accomplie', success ? [0, 100, 150, 200][stars] ?? 100 : 0],
    ['Dégâts infligés', Math.round(dmg / 4)],
    ['Destructions', kills * 10],
    ['Participation', success ? 0 : 10],
  ].filter(([, n]) => n > 0);
}

export const CREDITS = {
  participation: 200, // une fois par partie
  kill: 1000,
  perDamage: 2,
  repair: 500, // char détruit (escarmouche)
  starBonus: [0, 5000, 10000, 15000], // campagne : première réussite à ★, ★★, ★★★ (cumulables)
  missionWin: 2000, // campagne : réussite sans nouvelle étoile
  missionLoss: 1000, // campagne : mission échouée
};

// Crédits d'une partie d'escarmouche : gains (participation, destructions, dégâts) divisés par 2
// en cas de défaite, puis réparations pour chaque destruction de son char.
export function skirmishCredits({ dmg = 0, kills = 0, deaths = 0, won = false }) {
  const parts = [
    ['Participation', CREDITS.participation],
    [`Destructions (${kills} × ${CREDITS.kill.toLocaleString('fr-FR')})`, kills * CREDITS.kill],
    [`Dégâts infligés (${Math.round(dmg)} × ${CREDITS.perDamage})`, Math.round(dmg) * CREDITS.perDamage],
  ].filter(([, n]) => n > 0);
  const earned = parts.reduce((n, [, v]) => n + v, 0);
  if (!won) parts.push(['Défaite : gains divisés par 2', -Math.floor(earned / 2)]);
  if (deaths) parts.push([`Réparations (${deaths} × ${CREDITS.repair})`, -deaths * CREDITS.repair]);
  return parts;
}

// Crédits d'une mission : prime pour chaque nouvelle étoile obtenue (première réussite à cette
// difficulté), sinon un forfait de réussite ou d'échec. Pas de frais de réparation en campagne.
export function missionCredits({ success = false, stars = 0, prevStars = 0 }) {
  if (!success) return [['Mission échouée', CREDITS.missionLoss]];
  const parts = [];
  for (let s = prevStars + 1; s <= stars; s++) parts.push([`Première réussite ${'★'.repeat(s)}`, CREDITS.starBonus[s]]);
  return parts.length ? parts : [['Mission accomplie', CREDITS.missionWin]];
}

export const sumParts = (parts) => parts.reduce((n, [, v]) => n + v, 0);
