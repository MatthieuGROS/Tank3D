// Simulation d'un char : LE MÊME code tourne sur le serveur (autorité) et sur le client
// (prédiction). C'est ce qui permet au joueur de voir son char réagir instantanément
// sans divergence avec le serveur.

import { DT } from './constants.js';
import { collideCircle, collideDiscs, slopeAlong, heightAt } from './map.js';

const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
// Plus court écart angulaire pour aller de a vers b.
export const angleDiff = (a, b) => wrapAngle(b - a);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

// yaw = 0 regarde vers +Z ; l'avant vaut (sin yaw, cos yaw). yaw croissant = virage à gauche.
export function createTankState(x, z, yaw) {
  return { x, z, yaw, speed: 0, ty: yaw, reload: 0, rof: 1 }; // rof : multiplicateur de rechargement (bonus)
}

// Commande d'un tick : f = avancer (-1..1), t = tourner la caisse (-1..1, + = gauche),
// tt = tourner la tourelle (-1..1, + = gauche), fire = tirer.
export function sanitizeInput(raw) {
  const num = (v) => (Number.isFinite(v) ? clamp(v, -1, 1) : 0);
  // rg = réglage de portée de l'obusier (0..1)
  const rg = Number.isFinite(raw.rg) ? clamp(raw.rg, 0, 1) : 0.5;
  return { f: num(raw.f), t: num(raw.t), tt: num(raw.tt), fire: !!raw.fire, rg };
}

// Avance l'état `s` d'un tick. `others` = disques des autres chars. `frozen` = compte à rebours
// (seule la tourelle bouge). Renvoie true si le char a tiré pendant ce tick.
export function stepTank(s, inp, def, map, others, frozen) {
  const f = frozen ? 0 : inp.f;
  const t = frozen ? 0 : inp.t;

  let target = f > 0 ? f * def.maxSpeed : f * def.reverseSpeed;
  if (map.hills && target !== 0) {
    // relief : on freine en montée, on accélère un peu en descente
    const dir = target > 0 ? 1 : -1;
    const slope = slopeAlong(s.x, s.z, Math.sin(s.yaw) * dir, Math.cos(s.yaw) * dir, map);
    target *= clamp(1 - 1.3 * slope, 0.5, 1.25);
  }
  const speedingUp = target !== 0 && target * s.speed >= 0 && Math.abs(target) > Math.abs(s.speed);
  const maxDelta = (speedingUp ? def.accel : def.brake) * DT;
  s.speed += clamp(target - s.speed, -maxDelta, maxDelta);
  s.yaw = wrapAngle(s.yaw + t * def.turnRate * DT);

  if (s.speed !== 0) {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const ox = s.x, oz = s.z;
    s.x += fx * s.speed * DT;
    s.z += fz * s.speed * DT;
    let hit = collideCircle(s, def.radius, map);
    if (others && collideDiscs(s, def.radius, others)) {
      hit = true;
      collideCircle(s, def.radius, map);
    }
    if (hit) {
      // On ne garde que la vitesse réellement parcourue dans l'axe du char (glissement le long des murs).
      const along = ((s.x - ox) * fx + (s.z - oz) * fz) / DT;
      s.speed = s.speed > 0 ? clamp(along, 0, s.speed) : clamp(along, s.speed, 0);
    }
  }

  s.ty = wrapAngle(s.ty + inp.tt * def.turretRate * DT);
  // canon en casemate : il suit la caisse et ne pivote que de ±traverse autour de son axe
  if (def.traverse != null) s.ty = wrapAngle(s.yaw + clamp(angleDiff(s.yaw, s.ty), -def.traverse, def.traverse));

  if (s.reload > 0) s.reload--;
  if (inp.fire && !frozen && s.reload === 0) {
    let wait = def.reloadTicks * (s.rof ?? 1);
    if (def.burst) {
      // rafales : après le dernier obus, long rechargement (les nids de mitrailleuse gardent une pause fixe)
      s.shots = (s.shots ?? 0) + 1;
      if (s.shots >= def.burst.shots) {
        s.shots = 0;
        wait = def.burst.pause * (def.static ? 1 : s.rof ?? 1);
      }
    }
    s.reload = Math.max(1, Math.round(wait));
    return true;
  }
  return false;
}

// Un point 3D touche-t-il le char `t` ({x, z, yaw}) ? Caisse = boîte orientée, tourelle = cylindre.
// `gy` = hauteur du sol sous le char (0 sur une carte plate).
export function pointHitsTank(px, py, pz, t, def, gy = 0) {
  py -= gy;
  if (py < 0 || py > def.height) return false;
  const dx = px - t.x, dz = pz - t.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > def.hullHalfLen ** 2 + def.hullHalfWid ** 2 && d2 > def.turretRadius ** 2) return false;
  const sin = Math.sin(t.yaw), cos = Math.cos(t.yaw);
  if (py <= def.hullHeight) {
    const along = dx * sin + dz * cos;
    const side = dx * cos - dz * sin;
    return Math.abs(along) <= def.hullHalfLen && Math.abs(side) <= def.hullHalfWid;
  }
  return d2 <= def.turretRadius * def.turretRadius;
}

// Hauteur d'un obus après `dist` mètres : il quitte la bouche du canon puis descend vers une
// hauteur de vol commune, sinon les canons hauts (char lourd, boss) passeraient au-dessus des chars bas.
export const SHELL_FLIGHT_Y = 1.5;
// Sur une carte à relief, l'obus part de l'altitude réelle du canon et vole en ligne droite
// avec la pente `vy` (montée par mètre) : c'est ce qui permet à une colline de l'arrêter.
export function shellHeight(y0, dist, vy) {
  if (vy !== undefined) return y0 + vy * dist;
  return y0 <= SHELL_FLIGHT_Y ? y0 : Math.max(SHELL_FLIGHT_Y, y0 - dist * 0.25);
}

// Visée verticale automatique (cartes à relief) : s'il y a un char ennemi dans un cône étroit
// devant la tourelle, l'obus est pointé sur lui, en montée comme en descente. Sinon il part à
// plat. `targets` = liste de { x, z } des ennemis vivants. Renvoie la pente `vy`.
export const AUTO_AIM_CONE = 0.08; // rad (≈ 4,5°)
export function autoPitch(x, z, ty, y0, targets, map) {
  let best = 0, bestD = Infinity;
  for (const o of targets) {
    const dx = o.x - x, dz = o.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 3 || d > 170 || d >= bestD) continue;
    if (Math.abs(angleDiff(ty, Math.atan2(dx, dz))) > AUTO_AIM_CONE) continue;
    bestD = d;
    best = (heightAt(o.x, o.z, map) + 1.0 - y0) / d;
  }
  return clamp(best, -0.6, 0.6);
}

// Position d'un obus de mortier (tir en cloche) à l'instant t (0..1).
export function arcPoint(x0, y0, z0, x1, z1, t, peak, y1 = 0.3) {
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + 4 * peak * t * (1 - t), z: z0 + (z1 - z0) * t };
}
