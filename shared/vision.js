// Détection (dissimulation). Calculée par le serveur, partagée pour que les règles soient au même endroit.
//  - un char voit toujours ses alliés ;
//  - un ennemi est détecté s'il est à moins de SPOT_RANGE m d'un char de l'équipe adverse,
//    ou si un char adverse a une ligne de vue dégagée (ni décor, ni relief, ni buisson) sur l'un de ses
//    points de visée : centre, avant, arrière, tourelle ;
//  - un point de visée dans un buisson est caché (seule la règle des SPOT_RANGE m le révèle) ;
//  - le feuillage à moins de BUSH_CLEAR m de l'observateur ne gêne pas sa vue (on voit depuis son buisson) ;
//    au-delà, il bloque (une longue bande de buissons n'est transparente que sur ses 10 premiers mètres) ;
//  - un char qui vient de tirer (FIRE_REVEAL s) perd la protection des buissons à moins de BUSH_CLEAR m de lui ;
//  - un char touché est détecté SPOT_LINGER s (server/Room.js : damage) ;
//  - ce que voit un char, toute son équipe le voit ; un char reste détecté SPOT_LINGER s après la dernière détection.

import { pointBlocked, heightAt, inBush } from './map.js';

export const SPOT_RANGE = 20;   // m : détection automatique, même dans un buisson
export const BUSH_CLEAR = 10;   // m : feuillage ignoré autour de l'observateur (et autour d'un char qui tire)
export const SPOT_LINGER = 5;   // s : délai avant de redevenir invisible
export const FIRE_REVEAL = 1;   // s : après un tir, les buissons proches ne cachent plus le tireur
const BUSH_H = 3.2;             // hauteur du feuillage au-dessus du sol

// Ligne de vue d'un point (ax, ay, az) vers un point (bx, by, bz). `clearA` / `clearB` : distance
// horizontale autour de chaque extrémité où le feuillage est ignoré.
function lineOfSight(ax, ay, az, bx, by, bz, map, clearA, clearB) {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < 1) return true;
  const ux = dx / d, uz = dz / d, vy = (by - ay) / d;
  const bushes = !!map.flats?.some((f) => f.kind === 'bush');
  const end = d - 0.5; // les points de visée sont sur la caisse : on s'arrête juste avant
  for (let s = 1; s <= end; s += 1) {
    const x = ax + ux * s, y = ay + vy * s, z = az + uz * s;
    if (pointBlocked(x, y, z, map)) return false;
    // s = distance horizontale à l'observateur, d - s à la cible
    if (bushes && s > clearA && d - s > clearB && y < heightAt(x, z, map) + BUSH_H && inBush(x, z, map)) return false;
  }
  return true;
}

// Points de visée d'un char : centre, avant, arrière (caisse) et tourelle. dims = { radius, height }.
function aimPoints(t, dims, map) {
  const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
  const L = dims.radius * 1.1, hull = dims.height * 0.45;
  const pts = [
    [t.x, dims.height * 0.6, t.z],
    [t.x + fx * L, hull, t.z + fz * L],
    [t.x - fx * L, hull, t.z - fz * L],
    [t.x, dims.height * 0.9, t.z],
  ];
  for (const p of pts) p[1] += heightAt(p[0], p[2], map);
  return pts;
}

// L'observateur `a` voit-il la cible `b` ? a, b = { t: état du char {x, z, yaw}, dims: {radius, height} } ;
// b.fired = vient de tirer (les buissons proches ne le cachent plus).
export function detects(a, b, map) {
  if (Math.hypot(b.t.x - a.t.x, b.t.z - a.t.z) <= SPOT_RANGE) return true;
  const eyeY = heightAt(a.t.x, a.t.z, map) + a.dims.height * 0.9;
  const clearB = b.fired ? BUSH_CLEAR : 0;
  for (const [x, y, z] of aimPoints(b.t, b.dims, map)) {
    if (!b.fired && inBush(x, z, map)) continue; // point caché dans le feuillage
    if (lineOfSight(a.t.x, eyeY, a.t.z, x, y, z, map, BUSH_CLEAR, clearB)) return true;
  }
  return false;
}
