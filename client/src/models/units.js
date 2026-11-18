// Modèles des unités de campagne : tourelle, mitrailleuse, mortier, dépôt, générateur,
// usine et les trois boss. Même hiérarchie que les chars (group > body > turret > barrel),
// mêmes outils (models/tank.js). Les unités fixes n'ont pas de chenilles (`static`).
import * as THREE from 'three';
import { stdMat } from '../gfx.js';
import { profile, plan, cylX, cylZ, kit, roadWheel, finish } from './tank.js';

const STATIC_FIELDS = { wheelRadius: 1, trackX: 0, rearZ: 0, static: true };

function concreteMats(mats) {
  const m = (color) => stdMat(color, { roughness: 0.78, metalness: 0.12, flatShading: true }, { scale: 1.1, strength: 0.9, bump: 0.003 });
  mats.concrete = m(0x9a9a92);
  mats.concrete2 = m(0x7c7d77);
  mats.sand = m(0xb59f6e);
  return mats;
}

// Couronne de sacs de sable.
function sandbags(add, mats, parent, radius, rows = 2, count = 12) {
  const geo = new THREE.BoxGeometry(1.0, 0.42, 0.55);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < count; i++) {
      const a = ((i + (r % 2) * 0.5) / count) * Math.PI * 2;
      add(parent, geo, mats.sand, Math.sin(a) * radius, 0.21 + r * 0.4, Math.cos(a) * radius).rotation.y = a;
    }
  }
}

const fixed = (rest) => ({ wheels: [], ...STATIC_FIELDS, exhausts: [[0, 2, 0], [0, 2, 0]], ...rest });

function buildTurret(teamColor) {
  const { mats, add } = kit(teamColor);
  concreteMats(mats);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  add(body, new THREE.CylinderGeometry(2.0, 2.35, 1.7, 8).rotateY(Math.PI / 8), mats.concrete, 0, 0.85, 0);
  add(body, new THREE.CylinderGeometry(2.1, 2.1, 0.18, 8).rotateY(Math.PI / 8), mats.stripe, 0, 1.6, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(body, new THREE.BoxGeometry(0.5, 1.2, 0.5), mats.concrete2, Math.sin(a) * 2.15, 0.6, Math.cos(a) * 2.15);
  }
  const turretY = 1.6;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  add(turret, new THREE.CylinderGeometry(0.95, 1.3, 0.95, 8), mats.turret, 0, 0.48, 0);
  add(turret, new THREE.BoxGeometry(0.8, 0.5, 0.6), mats.dark, 0, 0.75, 0.95);
  add(turret, new THREE.BoxGeometry(0.3, 0.2, 0.3), mats.lamp, -0.5, 1.05, 0.4);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.75, 1.0);
  turret.add(barrel);
  add(barrel, cylZ(0.12, 0.15, 2.0, 8), mats.metal, 0, 0, 1.0);
  add(barrel, cylZ(0.2, 0.2, 0.3, 8), mats.metal, 0, 0, 1.95);
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [0, 2.2, -0.4] }));
}

function buildMG(teamColor) {
  const { mats, add } = kit(teamColor);
  concreteMats(mats);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  sandbags(add, mats, body, 1.75, 2, 11);
  add(body, new THREE.CylinderGeometry(0.25, 0.35, 0.8, 6), mats.metal, 0, 0.4, 0);
  const turretY = 0.9;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  add(turret, new THREE.BoxGeometry(1.3, 0.8, 0.12), mats.turret, 0, 0.55, 0.45); // bouclier
  add(turret, new THREE.BoxGeometry(0.5, 0.35, 0.8), mats.dark, 0, 0.55, 0);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.55, 0.4);
  turret.add(barrel);
  for (const side of [-1, 1]) add(barrel, cylZ(0.05, 0.06, 1.3, 6), mats.metal, side * 0.12, 0, 0.65);
  add(barrel, new THREE.BoxGeometry(0.4, 0.22, 0.18), mats.metal, 0, -0.18, 0.1); // chargeur
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [0, 1.2, 0] }));
}

function buildMortar(teamColor) {
  const { mats, add } = kit(teamColor);
  concreteMats(mats);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  sandbags(add, mats, body, 1.9, 2, 12);
  add(body, new THREE.CylinderGeometry(1.2, 1.3, 0.2, 8), mats.dark, 0, 0.1, 0);
  for (let i = 0; i < 3; i++) add(body, cylZ(0.14, 0.14, 0.5, 6), mats.metal, -1.1 + i * 0.3, 0.3, -1.1).rotation.x = -1.2; // obus en réserve
  const turretY = 0.2;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  add(turret, new THREE.BoxGeometry(1.1, 0.12, 1.1), mats.turret, 0, 0.06, 0); // plaque de base
  for (const side of [-1, 1]) add(turret, new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), mats.metal, side * 0.35, 0.5, 0.5).rotation.x = -0.5; // bipied
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.3, 0);
  barrel.rotation.x = -0.95; // tube pointé vers le ciel
  turret.add(barrel);
  add(barrel, cylZ(0.2, 0.24, 1.9, 10), mats.turret, 0, 0, 0.95);
  add(barrel, cylZ(0.26, 0.26, 0.2, 10), mats.metal, 0, 0, 1.85);
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [0, 1.0, 0] }));
}

function buildDepot(teamColor) {
  const { mats, add } = kit(teamColor);
  concreteMats(mats);
  mats.hazard = stdMat(0xf5b312, { roughness: 0.6, metalness: 0.1, flatShading: true });
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  add(body, new THREE.BoxGeometry(5.4, 0.3, 5.4), mats.concrete, 0, 0.15, 0);
  for (const [x, z, r, h] of [[-1.3, -1.2, 1.25, 3.0], [1.35, -1.0, 1.1, 2.6], [0, 1.4, 1.3, 3.2]]) {
    add(body, new THREE.CylinderGeometry(r, r, h, 10), mats.hull, x, 0.3 + h / 2, z);
    add(body, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.3, 10), mats.hazard, x, 0.3 + h * 0.7, z);
    add(body, new THREE.SphereGeometry(r, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), mats.turret, x, 0.3 + h, z);
  }
  add(body, cylX(0.12, 0.12, 2.8, 6), mats.metal, 0, 1.0, -1.1);
  add(body, cylZ(0.12, 0.12, 2.6, 6), mats.metal, -0.6, 0.7, 0.1);
  const turretY = 3.6;
  const turret = new THREE.Group();
  turret.position.set(0, turretY, 1.4);
  body.add(turret);
  add(turret, new THREE.BoxGeometry(0.25, 0.25, 0.25), mats.lamp, 0, 0.35, 0); // balise
  const barrel = new THREE.Group();
  turret.add(barrel);
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [0, 3.2, 0] }));
}

function buildGenerator(teamColor) {
  const { mats, add } = kit(teamColor);
  concreteMats(mats);
  // les bobines bleues font office de « lampe » : elles s'éteignent quand le générateur saute
  mats.lamp = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x4fb4ff, emissiveIntensity: 1.6, roughness: 0.3, flatShading: true });
  const glow = mats.lamp;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  add(body, new THREE.BoxGeometry(4.4, 1.2, 4.4), mats.concrete, 0, 0.6, 0);
  add(body, new THREE.BoxGeometry(3.2, 1.4, 3.2), mats.hull, 0, 1.9, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(body, new THREE.BoxGeometry(0.5, 2.4, 0.5), mats.metal, Math.sin(a) * 1.9, 1.2, Math.cos(a) * 1.9);
  }
  add(body, new THREE.CylinderGeometry(0.5, 0.7, 1.4, 8), mats.metal, 0, 3.3, 0);
  for (let i = 0; i < 3; i++) add(body, new THREE.TorusGeometry(0.75 - i * 0.08, 0.1, 5, 12).rotateX(Math.PI / 2), glow, 0, 2.9 + i * 0.35, 0);
  const turretY = 4.0;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  add(turret, new THREE.OctahedronGeometry(0.45, 0), glow, 0, 0.3, 0);
  for (const a of [0.8, -0.8]) add(turret, new THREE.BoxGeometry(1.8, 0.1, 0.18), mats.metal, 0, 0.1, 0).rotation.y = a;
  const barrel = new THREE.Group();
  turret.add(barrel);
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [0, 3.8, 0] }));
}

function buildFactory(teamColor) {
  const { mats, add } = kit(teamColor);
  concreteMats(mats);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  add(body, new THREE.BoxGeometry(10.2, 5.2, 8.2), mats.concrete, 0, 2.6, 0);
  add(body, new THREE.BoxGeometry(10.6, 0.5, 8.6), mats.dark, 0, 5.4, 0);
  // toits en dents de scie
  for (let i = 0; i < 3; i++) add(body, profile([[-1.3, 5.6], [1.3, 5.6], [1.3, 6.6], [-1.3, 7.5]], 9.6), mats.hull, 0, 0, -2.6 + i * 2.6);
  add(body, new THREE.BoxGeometry(5.2, 3.6, 0.3), mats.track, 0, 1.8, 4.15); // porte du hangar
  for (let i = 0; i < 6; i++) add(body, new THREE.BoxGeometry(5.0, 0.08, 0.32), mats.metal, 0, 0.4 + i * 0.55, 4.2);
  add(body, new THREE.BoxGeometry(6.2, 0.4, 0.4), mats.stripe, 0, 3.9, 4.2);
  add(body, new THREE.CylinderGeometry(0.6, 0.8, 5.5, 8), mats.concrete2, 3.6, 7.0, -2.8); // cheminée
  add(body, new THREE.CylinderGeometry(0.65, 0.65, 0.4, 8), mats.stripe, 3.6, 9.2, -2.8);
  for (const side of [-1, 1]) add(body, new THREE.BoxGeometry(0.4, 0.3, 0.15), mats.lamp, side * 3.2, 4.4, 4.25);
  const turretY = 5.7;
  const turret = new THREE.Group();
  turret.position.set(-3, turretY, 1.5);
  body.add(turret);
  add(turret, new THREE.CylinderGeometry(0.1, 0.1, 1.2, 4), mats.metal, 0, 0.6, 0);
  add(turret, new THREE.BoxGeometry(1.8, 0.8, 0.12), mats.metal, 0, 1.3, 0).rotation.x = 0.4; // radar
  const barrel = new THREE.Group();
  turret.add(barrel);
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [3.6, 9.6, -2.8] }));
}

// Char de boss paramétrable (Goliath, Léviathan).
function buildBossTank(teamColor, P) {
  const { mats, add } = kit(new THREE.Color(teamColor).multiplyScalar(P.shade));
  mats.lamp.color.set(P.lamp);
  mats.lamp.emissive.set(P.lamp);
  const group = new THREE.Group();
  const L = P.len / 2, W = P.wid / 2;
  const wheels = [];
  const trackW = P.wid * 0.2;
  const trackX = W - trackW / 2;
  const trackGeo = profile([[-L, 0.8], [-L + 0.6, 0.02], [L - 0.6, 0.02], [L, 0.8], [L - 0.3, 1.35], [-L + 0.3, 1.35]], trackW);
  const wheelGeo = cylX(0.5, 0.5, 0.2, 9);
  const hubGeo = new THREE.BoxGeometry(0.05, 0.75, 0.16);
  const skirtGeo = new THREE.BoxGeometry(0.1, 0.7, (P.len - 1) / 5 - 0.1);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * trackX, 0, 0);
    for (let i = 0; i < P.wheels; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, W + 0.05, 0.55, -L + 1.0 + (i * (P.len - 2)) / (P.wheels - 1)));
    for (let i = 0; i < 5; i++) add(group, skirtGeo, mats.hull, side * (W + 0.18), 1.1, -L + 0.5 + ((i + 0.5) * (P.len - 1)) / 5);
  }
  const body = new THREE.Group();
  group.add(body);
  const top = P.hullH;
  add(body, new THREE.BoxGeometry(P.wid - trackW * 2 + 0.2, 1.0, P.len - 0.8), mats.dark, 0, 0.9, 0);
  add(body, profile([[-L + 0.1, 1.3], [L + 0.1, 1.3], [L - 1.6, top], [-L + 0.4, top]], P.wid + 0.3), mats.hull);
  add(body, new THREE.BoxGeometry(P.wid + 0.4, 0.18, 0.4), mats.stripe, 0, 1.75, -L + 0.8);
  for (const side of [-1, 1]) {
    add(body, new THREE.BoxGeometry(0.3, 0.22, 0.12), mats.lamp, side * (W - 0.5), 1.6, L + 0.12);
    add(body, cylZ(0.16, 0.16, 0.7, 6), mats.metal, side * (W - 0.8), top - 0.2, -L - 0.2);
  }
  add(body, new THREE.BoxGeometry(P.wid - 1, 0.15, 2), mats.dark, 0, top + 0.05, -L + 1.6);
  if (P.pods) {
    // lance-roquettes dorsaux (barrages d'artillerie)
    for (const side of [-1, 1]) {
      const pod = add(body, new THREE.BoxGeometry(1.2, 0.9, 1.8), mats.turret, side * (W - 0.9), top + 0.45, -L + 1.6);
      for (let i = 0; i < 4; i++) add(pod, cylZ(0.13, 0.13, 0.2, 6), mats.track, ((i % 2) - 0.5) * 0.5, (Math.floor(i / 2) - 0.5) * 0.4, 0.91);
    }
  }
  if (P.spikes) {
    for (let i = 0; i < 5; i++) add(body, new THREE.ConeGeometry(0.18, 0.8, 4).rotateX(Math.PI / 2), mats.metal, -W + 0.8 + (i * (P.wid - 1.6)) / 4, 1.2, L + 0.4);
  }
  const turretY = top;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  const R = P.turretR;
  const outline = [[-R * 0.55, R * 1.05], [R * 0.55, R * 1.05], [R, R * 0.3], [R, -R * 0.7], [R * 0.65, -R * 1.05], [-R * 0.65, -R * 1.05], [-R, -R * 0.7], [-R, R * 0.3]];
  add(turret, plan(outline, P.turretH, 0.15), mats.turret, 0, 0.05, 0);
  add(turret, plan(outline.map(([x, z]) => [x * 1.06, z * 1.04]), 0.14), mats.stripe, 0, 0.02, 0);
  add(turret, new THREE.BoxGeometry(R * 1.3, P.turretH * 0.7, 0.7), mats.dark, 0, P.barrelY, R * 1.05);
  add(turret, new THREE.CylinderGeometry(0.5, 0.55, 0.4, 8), mats.turret, -R * 0.45, P.turretH + 0.2, -R * 0.3);
  add(turret, new THREE.BoxGeometry(0.5, 0.4, 0.5), mats.dark, R * 0.5, P.turretH + 0.2, R * 0.3);
  add(turret, new THREE.BoxGeometry(R * 1.6, 0.5, 0.9), mats.canvas, 0, P.turretH * 0.6, -R * 1.2);
  add(turret, new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), mats.metal, -R * 0.7, P.turretH + 1.1, -R * 0.8);
  add(turret, new THREE.BoxGeometry(0.4, 0.2, 0.08), mats.lamp, R * 0.5, P.turretH + 0.25, R * 0.56);
  const barrel = new THREE.Group();
  barrel.position.set(0, P.barrelY, R * 1.1);
  turret.add(barrel);
  const len = P.barrelLen - R * 1.1;
  for (const off of P.barrels) {
    add(barrel, cylZ(0.17, 0.22, len, 8), mats.metal, off, 0, len / 2);
    add(barrel, cylZ(0.3, 0.3, 0.6, 8), mats.metal, off, 0, len * 0.35);
    add(barrel, new THREE.BoxGeometry(0.55, 0.36, 0.55), mats.metal, off, 0, len - 0.2);
  }
  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.5, trackX, rearZ: -L,
    exhausts: [[-(W - 0.8), top - 0.2, -L - 0.5], [W - 0.8, top - 0.2, -L - 0.5]],
    engine: [0, top + 0.3, -L + 1.6],
  });
}

const buildGoliath = (c) => buildBossTank(c, {
  len: 8.6, wid: 5.6, hullH: 2.25, turretR: 2.2, turretH: 1.3, barrelY: 0.75, barrelLen: 6.0, barrels: [-0.55, 0.55],
  wheels: 8, shade: 0.8, lamp: 0xffd36a,
});

const buildLeviathan = (c) => buildBossTank(c, {
  len: 10, wid: 6.4, hullH: 2.5, turretR: 2.6, turretH: 1.5, barrelY: 0.9, barrelLen: 7.0, barrels: [-0.7, 0.7],
  wheels: 9, shade: 0.55, lamp: 0xff3b2a, pods: true, spikes: true,
});

function buildCitadel(teamColor) {
  const { mats, add } = kit(new THREE.Color(teamColor).multiplyScalar(0.75));
  concreteMats(mats);
  mats.lamp.color.set(0xff5a3a);
  mats.lamp.emissive.set(0xff5a3a);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  add(body, new THREE.CylinderGeometry(5.6, 6.6, 3.0, 6), mats.concrete, 0, 1.5, 0);
  add(body, new THREE.CylinderGeometry(5.0, 5.6, 1.0, 6), mats.concrete2, 0, 3.5, 0);
  add(body, new THREE.CylinderGeometry(5.65, 5.65, 0.3, 6), mats.stripe, 0, 2.9, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add(body, new THREE.BoxGeometry(1.0, 0.8, 0.6), mats.concrete2, Math.sin(a) * 5.3, 4.2, Math.cos(a) * 5.3).rotation.y = a; // créneaux
    if (i % 2) add(body, new THREE.BoxGeometry(0.4, 0.25, 0.1), mats.lamp, Math.sin(a) * 6.05, 2.2, Math.cos(a) * 6.05).rotation.y = a;
  }
  for (const side of [-1, 1]) {
    const pod = add(body, new THREE.BoxGeometry(1.6, 1.4, 1.6), mats.hull, side * 4.0, 4.6, -2.5);
    for (let i = 0; i < 4; i++) add(pod, new THREE.CylinderGeometry(0.2, 0.2, 0.4, 6), mats.track, ((i % 2) - 0.5) * 0.7, 0.8, (Math.floor(i / 2) - 0.5) * 0.7);
  }
  const turretY = 4.0;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  add(turret, new THREE.SphereGeometry(3.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.turret, 0, 0, 0);
  add(turret, new THREE.BoxGeometry(4.2, 1.4, 1.4), mats.dark, 0, 0.6, 2.9);
  add(turret, new THREE.CylinderGeometry(0.5, 0.6, 0.6, 8), mats.dark, -1.2, 3.4, -0.5);
  add(turret, new THREE.BoxGeometry(0.6, 0.3, 0.1), mats.lamp, 0, 1.9, 2.75);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.6, 3.5);
  turret.add(barrel);
  for (const off of [-1.1, 0, 1.1]) {
    add(barrel, cylZ(0.2, 0.26, 3.7, 8), mats.metal, off, 0, 1.85);
    add(barrel, new THREE.BoxGeometry(0.6, 0.4, 0.5), mats.metal, off, 0, 3.5);
  }
  return finish(fixed({ mats, group, body, turret, barrel, turretY, engine: [-4, 5.5, -2.5] }));
}

export const UNIT_MODELS = {
  turret: buildTurret, mg: buildMG, mortar: buildMortar,
  depot: buildDepot, generator: buildGenerator, factory: buildFactory,
  goliath: buildGoliath, leviathan: buildLeviathan, citadel: buildCitadel,
};
