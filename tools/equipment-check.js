// Vérification des équipements, sans navigateur ni réseau :
//   1. les données (bonus croissants, effets qui existent bien sur chaque char compatible) ;
//   2. les règles des comptes (achat, fusion, montage, démontage) ;
//   3. l'intégration au salon (fiche équipée figée à l'entrée en manche, désactivée en course).
//
//   node tools/equipment-check.js
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { TANK_TYPES, faceCoef } from '../shared/constants.js';
import {
  EQUIPMENT, EQUIP_IDS, EQUIP_SLOTS, EQUIP_PRICE, eqKey, eqDef, equipMisfit, equipEffect, cleanLoadout,
} from '../shared/equipment.js';

const file = path.join(os.tmpdir(), `tank3d-equip-check-${process.pid}.json`);
process.env.TANK3D_ACCOUNTS_FILE = file;
const { Accounts } = await import('../server/Accounts.js');
const { Room } = await import('../server/Room.js');

let checks = 0;
const ok = (cond, text) => {
  checks++;
  assert.ok(cond, text);
};

// ------------------------------------------------------------ 1. données
for (const id of EQUIP_IDS) {
  const e = EQUIPMENT[id];
  ok(e.values.length === 3 && e.values[0] < e.values[1] && e.values[1] < e.values[2], `${id} : bonus croissants`);
  for (const [type, base] of Object.entries(TANK_TYPES)) {
    if (equipMisfit(id, base)) continue;
    for (let lv = 1; lv <= 3; lv++) {
      const d = eqDef(type, [eqKey(id, lv)]);
      ok(d !== base, `${id} niv ${lv} sur ${type} : la fiche change`);
      ok(Object.values(d).every((v) => !(typeof v === 'number' && !Number.isFinite(v))), `${id} sur ${type} : aucune valeur invalide`);
    }
  }
}
// le sens de chaque bonus
const std = TANK_TYPES.standard;
const one = (id, lv = 1) => eqDef('standard', [eqKey(id, lv)]);
ok(one('culasse').shellDamage > std.shellDamage, 'culasse : plus de dégâts');
ok(one('chargeur').reloadTicks < std.reloadTicks, 'chargeur : rechargement plus court');
ok(one('telemetre').acc.disp < std.acc.disp, 'télémètre : dispersion réduite');
ok(one('viseur').acc.aimTime < std.acc.aimTime, 'viseur : visée plus rapide');
ok(one('aero').shellSpeed > std.shellSpeed, 'aérodynamiques : obus plus rapides');
ok(one('explosive').splash > 3.5 && one('explosive').splashDamage > 150, 'charge explosive : souffle plus grand');
ok(one('blindage').maxHp > std.maxHp, 'blindage : plus de PV');
ok(faceCoef(one('plaque'), 0, 0, -1) === faceCoef(std, 0, 0, -1), 'plaque : l’avant ne change pas');
ok(faceCoef(one('plaque'), 0, 0, 1) < faceCoef(std, 0, 0, 1), 'plaque : l’arrière encaisse moins');
ok(one('turbo').maxSpeed > std.maxSpeed && one('chenilles').turnRate > std.turnRate && one('servo').turretRate > std.turretRate, 'mobilité');
ok(one('suspension').acc.move < std.acc.move && one('suspension').acc.hull < std.acc.hull, 'suspension : malus réduits');
ok(one('marche').reverseSpeed > std.reverseSpeed, 'marche arrière');
ok(eqDef('hornet', [eqKey('chargeur', 3)]).burst.pause < TANK_TYPES.hornet.burst.pause, 'chargeur : la pause de rafale raccourcit aussi');
ok(TANK_TYPES.standard.shellDamage === 340 && std.acc.disp === 1.2, 'la fiche d’origine n’est jamais modifiée');
// niveaux 2 et 3 : strictement meilleurs
ok(one('culasse', 3).shellDamage > one('culasse', 2).shellDamage && one('culasse', 2).shellDamage > one('culasse', 1).shellDamage, 'niveaux croissants');
// incompatibilités
ok(equipMisfit('aero', TANK_TYPES.artillery) && !equipMisfit('aero', std), 'aérodynamiques : pas sur le Tonnerre');
ok(equipMisfit('servo', TANK_TYPES.destroyer) && !equipMisfit('servo', std), 'servo : pas sur le Harpon');
ok(cleanLoadout('artillery', [eqKey('aero', 1), eqKey('turbo', 1)]).length === 1, 'un équipement incompatible est écarté');
ok(cleanLoadout('standard', [eqKey('turbo', 1), eqKey('turbo', 2)]).length === 1, 'pas deux fois le même équipement');
ok(cleanLoadout('standard', ['culasse:1', 'turbo:1', 'plaque:1', 'viseur:1']).length === EQUIP_SLOTS, `${EQUIP_SLOTS} emplacements au plus`);
ok(cleanLoadout('standard', ['inconnu:1', 'culasse:9', 42]).length === 0, 'clés invalides écartées');
ok(equipEffect('culasse', 2) === '+8 % dégâts par obus' && equipEffect('chargeur', 1) === '−6 % temps de rechargement', 'libellés d’effet');

// ------------------------------------------------------------ 2. comptes
const acc = new Accounts(file);
const { account } = acc.login('testeur', 'azerty');
account.progress.credits = EQUIP_PRICE * 6 + 5;
ok(acc.buyEquip(account, 'inconnu', EQUIP_PRICE) !== null, 'achat d’un équipement inconnu refusé');
for (let i = 0; i < 6; i++) ok(acc.buyEquip(account, i < 3 ? 'culasse' : 'turbo', EQUIP_PRICE) === null, `achat ${i + 1}`);
ok(account.progress.credits === 5 && acc.buyEquip(account, 'viseur', EQUIP_PRICE) !== null, 'crédits insuffisants');
const { stock, load } = acc.equipOf(account);
ok(stock['culasse:1'] === 3 && stock['turbo:1'] === 3, 'stock après achats');
ok(acc.mergeEquip(account, 'culasse', 1, 'standard') === null && stock['culasse:1'] === 1 && stock['culasse:2'] === 1, 'fusion 2 × niv 1 → niv 2');
ok(acc.mergeEquip(account, 'culasse', 2, 'standard') !== null, 'un seul niv 2 : fusion refusée');
ok(acc.mergeEquip(account, 'culasse', 3, 'standard') !== null, 'niveau 3 : déjà au maximum');
ok(acc.equip(account, 'standard', 'culasse:1') === null && load.standard[0] === 'culasse:1' && !stock['culasse:1'], 'montage retire du stock');
ok(acc.equip(account, 'standard', 'culasse:2') !== null, 'pas deux fois la même culasse sur un char');
ok(acc.equip(account, 'standard', 'inconnu:1') !== null, 'montage d’une clé inconnue refusé');
ok(acc.equip(account, 'standard', 'viseur:1') !== null, 'montage d’un exemplaire absent du stock refusé');
// fusion « sur place » : 1 en stock + celui monté sur le char
stock['culasse:1'] = 1;
ok(acc.mergeEquip(account, 'culasse', 1, 'standard') === null && load.standard[0] === 'culasse:2' && !stock['culasse:1'], 'fusion avec l’exemplaire monté : il garde son emplacement');
ok(acc.mergeEquip(account, 'culasse', 1, 'heavy') !== null, 'rien à fusionner ailleurs');
ok(acc.equip(account, 'artillery', 'turbo:1') === null, 'turbo sur le Tonnerre');
stock['aero:1'] = 1;
ok(acc.equip(account, 'artillery', 'aero:1') !== null && stock['aero:1'] === 1, 'aérodynamiques refusées sur le Tonnerre, le stock ne bouge pas');
stock['plaque:1'] = 2; stock['viseur:1'] = 1;
ok(acc.equip(account, 'standard', 'turbo:1') === null && acc.equip(account, 'standard', 'plaque:1') === null, 'montage jusqu’à 3 équipements');
ok(acc.equip(account, 'standard', 'viseur:1') !== null, 'quatrième équipement refusé');
ok(acc.unequip(account, 'standard', 'turbo:1') === null && stock['turbo:1'] >= 1, 'démontage : retour au stock');
ok(acc.unequip(account, 'standard', 'turbo:1') !== null, 'démonter deux fois refusé');
// persistance
const reread = new Accounts(file).accounts.testeur.progress.equip;
ok(JSON.stringify(reread.load.standard) === JSON.stringify(load.standard), 'enregistré dans accounts.json');

// ------------------------------------------------------------ 3. salon
const room = new Room();
const sent = [];
const fake = (name) => {
  const p = room.newPlayer({ ws: { readyState: 1, send: (d) => sent.push(JSON.parse(d)), on() {}, ping() {} } });
  room.onMessage(p, { type: 'join', name, password: 'azerty' });
  return p;
};
acc.logout(account);
room.accounts = new Accounts(file);
const p = fake('testeur');
ok(p.joined, 'connexion au salon');
// le joueur a la culasse niv 2 + plaque + (un exemplaire de plus) sur le Vanguard
room.accounts.equipOf(p.account).load.standard = ['culasse:2', 'plaque:1', 'blindage:3'];
p.team = 'red';
room.enterRound(p, 0, 0, 0);
const hp3 = Math.round(TANK_TYPES.standard.maxHp * 1.12);
ok(p.maxHp === hp3 && p.hp === hp3, `PV avec blindage niv 3 (${p.maxHp})`);
ok(room.defOf(p).shellDamage === eqDef('standard', ['culasse:2']).shellDamage, 'dégâts avec culasse niv 2');
// l'équipement change en cours de manche : pas d'effet avant la manche suivante
room.accounts.equipOf(p.account).load.standard = [];
ok(room.defOf(p).maxHp === hp3, 'la fiche est figée pour la manche');
room.enterRound(p, 0, 0, 0);
ok(p.maxHp === TANK_TYPES.standard.maxHp, 'manche suivante : char nu');
// course : désactivé
room.accounts.equipOf(p.account).load.standard = ['blindage:3'];
room.settings.mode = 'race';
room.enterRound(p, 0, 0, 0);
ok(p.maxHp === TANK_TYPES.standard.maxHp && !p.eq.length, 'course : équipements désactivés');
room.settings.mode = 'skirmish';
// messages réseau
sent.length = 0;
room.accounts.equipOf(p.account).stock['turbo:1'] = 1;
room.onMessage(p, { type: 'equip', tank: 'standard', key: 'turbo:1' });
ok(sent.some((m) => m.type === 'equipDone') && sent.some((m) => m.type === 'account' && m.equip.load.standard.includes('turbo:1')), 'montage par message');
room.players.get(p.id).equipAt = 0;
room.onMessage(p, { type: 'equip', tank: 'standard', key: 'inconnu:1' });
ok(sent.some((m) => m.type === 'equipError'), 'erreur renvoyée au joueur');
room.players.get(p.id).equipAt = 0;
room.onMessage(p, { type: 'equip', tank: 'hornet', key: 'turbo:1' });
ok(sent.filter((m) => m.type === 'equipError').length === 2, 'char non possédé : refusé');
p.account.progress.credits = EQUIP_PRICE;
p.equipAt = 0;
room.onMessage(p, { type: 'buyEquip', id: 'servo' });
ok(p.account.progress.credits === 0 && room.accounts.equipOf(p.account).stock['servo:1'] === 1, 'achat par message');

fs.rmSync(file, { force: true });
console.log(`  ✓ ${checks} vérifications`);
process.exit(0);
