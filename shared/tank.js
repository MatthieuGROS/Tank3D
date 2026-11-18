// Simulation d'un char : LE MÊME code tourne sur le serveur (autorité) et sur le client
// (prédiction). C'est ce qui permet au joueur de voir son char réagir instantanément
// sans divergence avec le serveur.

import { DT, ACCURACY } from './constants.js';
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
  // rof : multiplicateur de rechargement (bonus) ; aim : « flou » de visée restant (0 = canon réglé, voir stepTank)
  return { x, z, yaw, speed: 0, ty: yaw, reload: 0, rof: 1, aim: ACCURACY.spawnExtra };
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

  const ty0 = s.ty;
  s.ty = wrapAngle(s.ty + inp.tt * def.turretRate * DT);
  // canon en casemate : il suit la caisse et ne pivote que de ±traverse autour de son axe
  if (def.traverse != null) s.ty = wrapAngle(s.yaw + clamp(angleDiff(s.yaw, s.ty), -def.traverse, def.traverse));

  if (def.acc) {
    // Précision : le flou `aim` retombe avec le temps de visée, mais remonte aussitôt que le char
    // roule, pivote ou tourne sa tourelle (chaque malus est proportionnel à la vitesse du geste).
    const a = def.acc;
    const moving = clamp(Math.abs(s.speed) / def.maxSpeed, 0, 1);
    const turret = clamp(Math.abs(angleDiff(ty0, s.ty)) / (def.turretRate * DT), 0, 1);
    const hull = Math.abs(t);
    // comme dans WoT, les malus se combinent en quadrature (rouler ET tourner coûte moins que la somme)
    const disturbance = Math.hypot(a.move * moving, a.turret * turret, a.hull * hull);
    s.aim = ((s.aim ?? 0) * Math.exp((-ACCURACY.settle * DT) / a.aimTime));
    if (s.aim < 0.002) s.aim = 0;
    s.aim = Math.min(ACCURACY.maxExtra, Math.max(s.aim, disturbance));
  }

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
    // le tir part avec le flou de cet instant (`shotAim`) puis l'élargit pour le suivant
    s.shotAim = s.aim ?? 0;
    if (def.acc) s.aim = Math.min(ACCURACY.maxExtra, s.aim + ACCURACY.fireBloom);
    return true;
  }
  return false;
}

// Écart de tir aléatoire dans un disque de rayon `radius` (loi normale tronquée : la plupart des
// obus tombent près du centre, quelques-uns vers le bord). Renvoie { h, v } : écart horizontal et vertical.
export function scatter(radius) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(TAU * Math.random());
  for (let i = 0; i < 8; i++) {
    const h = gauss() / 2, v = gauss() / 2; // écart-type = ½ rayon
    if (h * h + v * v <= 1) return { h: h * radius, v: v * radius };
  }
  return { h: 0, v: 0 };
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
// hauteur de vol commune (au-dessus du sol `g` sous le tireur), sinon les canons hauts (char
// lourd, boss) passeraient au-dessus des chars bas.
export const SHELL_FLIGHT_Y = 1.5;
// Sur une carte à relief, un obus pointé sur une cible part de l'altitude réelle du canon et
// vole en ligne droite avec la pente `vy` (montée par mètre) : une colline peut l'arrêter.
export function shellHeight(y0, dist, vy, g = 0) {
  if (vy !== undefined) return y0 + vy * dist;
  const h = y0 - g;
  return g + (h <= SHELL_FLIGHT_Y ? h : Math.max(SHELL_FLIGHT_Y, h - dist * 0.25));
}

// Visée verticale automatique (cartes à relief) : on cherche le char ennemi que l'obus va
// croiser, en tenant compte de son déplacement pendant le vol (tir anticipé devant un char
// qui roule). L'obus est alors pointé sur l'endroit où sera ce char, en montée comme en
// descente. `targets` = liste de { x, z, yaw, speed } des ennemis vivants. Renvoie la pente
// `vy`, ou undefined si aucun char n'est dans la ligne de tir (vol à hauteur commune).
export const AUTO_AIM_CONE = 0.08; // rad (≈ 4,5°) : écart toléré au point de rencontre
export function autoPitch(x, z, ty, y0, targets, map, shellSpeed = 100) {
  const dx = Math.sin(ty), dz = Math.cos(ty), S = shellSpeed > 0 ? shellSpeed : 100;
  let best, bestS = Infinity;
  for (const o of targets) {
    const px = o.x - x, pz = o.z - z;
    const v = o.speed ?? 0, vx = Math.sin(o.yaw ?? 0) * v, vz = Math.cos(o.yaw ?? 0) * v;
    // instant où l'obus passe au plus près du char (mouvement relatif rectiligne)
    const wx = vx - dx * S, wz = vz - dz * S;
    const t = -(px * wx + pz * wz) / (wx * wx + wz * wz);
    if (!(t > 0)) continue;
    const s = S * t; // distance parcourue par l'obus à cet instant
    if (s < 3 || s > 170 || s >= bestS) continue;
    const fx = px + vx * t, fz = pz + vz * t; // position du char à ce moment-là
    if (Math.hypot(fx - dx * s, fz - dz * s) > Math.max(1.5, s * AUTO_AIM_CONE)) continue;
    bestS = s;
    best = (heightAt(x + fx, z + fz, map) + 1.0 - y0) / s;
  }
  return best === undefined ? undefined : clamp(best, -0.6, 0.6);
}

// Position d'un obus de mortier (tir en cloche) à l'instant t (0..1).
export function arcPoint(x0, y0, z0, x1, z1, t, peak, y1 = 0.3) {
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + 4 * peak * t * (1 - t), z: z0 + (z1 - z0) * t };
}
