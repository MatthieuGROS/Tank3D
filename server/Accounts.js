// Comptes joueurs : pseudo + mot de passe, progression de campagne propre à chacun.
// Tout est enregistré sur le PC du serveur, dans accounts.json (à la racine du projet).
// Un compte n'accepte qu'une connexion à la fois.
//
// Format du fichier :
//   { "accounts": { "<pseudo en minuscules>": { name, salt, hash, created, progress: { cleared: { m1: 3, ... }, skin, tank, xp, credits, tanks } } } }
// `cleared[mission]` = difficulté la plus élevée réussie : 1 Recrue, 2 Vétéran, 3 Élite (= nombre d'étoiles).
// `skin` / `tank` = derniers skin et char choisis (voir shared/skins.js, shared/constants.js).
// `xp` = expérience totale (grade) ; `credits` = solde ; `tanks` = chars achetés au Store (shared/progress.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FILE = process.env.TANK3D_ACCOUNTS_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'accounts.json');

export const NAME_MAX = 16;
export const PASSWORD_MIN = 4;
const PASSWORD_MAX = 64;

const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');
export const accountKey = (name) => name.toLowerCase();

export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, NAME_MAX);
}

export class Accounts {
  constructor(file = FILE) {
    this.file = file;
    this.accounts = {};
    this.online = new Set(); // clés des comptes actuellement connectés
    try {
      this.accounts = JSON.parse(fs.readFileSync(file, 'utf8')).accounts ?? {};
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('  Fichier de comptes illisible :', err.message);
    }
  }

  // Connexion (ou création du compte si le pseudo est libre).
  // Renvoie { account, created } ou { error: message lisible }.
  login(rawName, rawPassword) {
    const name = cleanName(rawName);
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    if (!name) return { error: 'Choisis un pseudo.' };
    if (password.length < PASSWORD_MIN) return { error: `Mot de passe trop court (${PASSWORD_MIN} caractères minimum).` };
    if (password.length > PASSWORD_MAX) return { error: 'Mot de passe trop long.' };
    const key = accountKey(name);
    let account = this.accounts[key];
    let created = false;
    if (account) {
      const hash = Buffer.from(hashPassword(password, account.salt), 'hex');
      if (!crypto.timingSafeEqual(hash, Buffer.from(account.hash, 'hex'))) return { error: 'Mot de passe incorrect.' };
    } else {
      const salt = crypto.randomBytes(16).toString('hex');
      account = { name, salt, hash: hashPassword(password, salt), created: new Date().toISOString(), progress: { cleared: {} } };
      this.accounts[key] = account;
      created = true;
      this.save();
    }
    if (this.online.has(key)) return { error: `Le compte « ${account.name} » est déjà connecté.` };
    this.online.add(key);
    return { account, created };
  }

  logout(account) {
    if (account) this.online.delete(accountKey(account.name));
  }

  // Mission réussie à cette difficulté (1..3) : on garde la meilleure. Renvoie true si c'est un progrès.
  recordClear(account, missionId, level) {
    const cleared = account.progress.cleared;
    if ((cleared[missionId] ?? 0) >= level) return false;
    cleared[missionId] = level;
    this.save();
    return true;
  }

  // Skin choisi par le joueur (on le retrouve à la prochaine connexion).
  setSkin(account, skin) {
    if (!account || account.progress.skin === skin) return;
    account.progress.skin = skin;
    this.save();
  }

  // Char choisi par le joueur (on le retrouve à la prochaine connexion).
  setTank(account, tank) {
    if (!account || account.progress.tank === tank) return;
    account.progress.tank = tank;
    this.save();
  }

  // Crédits gagnés (ou perdus) : le solde ne descend jamais sous 0. Renvoie le nouveau solde.
  addCredits(account, amount) {
    account.progress.credits = Math.max(0, (account.progress.credits ?? 0) + Math.round(amount));
    this.save();
    return account.progress.credits;
  }

  // Achat d'un char au Store. Renvoie un message d'erreur, ou null si l'achat est fait.
  buyTank(account, type, price) {
    const pr = account.progress;
    if (pr.tanks?.includes(type)) return 'Tu possèdes déjà ce char.';
    if ((pr.credits ?? 0) < price) return 'Crédits insuffisants.';
    pr.credits -= price;
    pr.tanks = [...(pr.tanks ?? []), type];
    this.save();
    return null;
  }

  // Expérience gagnée en fin de partie ou de mission. Renvoie la nouvelle XP totale.
  addXp(account, amount) {
    account.progress.xp = (account.progress.xp ?? 0) + Math.max(0, Math.round(amount));
    this.save();
    return account.progress.xp;
  }

  save() {
    // écriture dans un fichier temporaire puis renommage : pas de fichier à moitié écrit en cas de coupure
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ accounts: this.accounts }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('  Impossible d’enregistrer les comptes :', err.message);
    }
  }
}
