// Conifères réalistes générés par code : tronc en écorce de pin (texture PBR réelle) et étages d'aiguilles
// (texture d'aiguilles dessinée sur un canvas, découpée par transparence). Matériaux partagés par tous les arbres.
import * as THREE from 'three';
import { texMat } from '../gfx.js';

let needleTex = null;

// Texture d'aiguilles : fines branches retombantes (alpha), tuilable en largeur.
function needles() {
  if (needleTex) return needleTex;
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, len = 22 + r() * 46, a = Math.PI / 2 + (r() - 0.5) * 0.9;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    const g = 60 + r() * 70, l = 16 + r() * 22;
    ctx.strokeStyle = `hsl(${95 + r() * 30}, ${38 + r() * 20}%, ${l}%)`;
    ctx.lineWidth = 2 + r() * 2.2;
    for (const wx of [0, -S, S]) { // tuilable horizontalement
      ctx.beginPath(); ctx.moveTo(x + wx, y); ctx.lineTo(x + wx + dx, y + dy); ctx.stroke();
      // aiguilles latérales
      for (let k = 1; k < 5; k++) {
        const t = k / 5, px = x + wx + dx * t, py = y + dy * t, sl = len * 0.28 * (1 - t * 0.5);
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + sl, py + sl * 0.5); ctx.moveTo(px, py); ctx.lineTo(px - sl, py + sl * 0.5); ctx.stroke();
      }
    }
  }
  needleTex = new THREE.CanvasTexture(cv);
  needleTex.wrapS = needleTex.wrapT = THREE.RepeatWrapping;
  needleTex.colorSpace = THREE.SRGBColorSpace;
  needleTex.anisotropy = 8;
  return needleTex;
}

const cache = new Map();

// Matériaux d'un conifère pour une ambiance (feuillage teinté ; neige = voile blanc).
export function pineMaterials(theme) {
  const key = `${theme.leaf[0]}:${!!theme.snowy}`;
  if (cache.has(key)) return cache.get(key);
  const tint = new THREE.Color(0x9aa98a).lerp(new THREE.Color(theme.leaf[0]), 0.2).multiplyScalar(1.15);
  if (theme.snowy) tint.lerp(new THREE.Color(0xe8eeee), 0.5);
  const make = (c) => new THREE.MeshStandardMaterial({ map: needles(), color: c, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  const mats = {
    leafA: make(tint),
    leafB: make(tint.clone().multiplyScalar(0.82)),
    bark: texMat('bark', { color: 0xd9cfc6, tile: 1.6, normal: 1.2 }),
  };
  cache.set(key, mats);
  return mats;
}

// Ajoute un conifère de hauteur ~h à (x, z) via add(geo, mat, x, y, z, castShadow). Renvoie les mailles créées.
export function buildPine(add, mats, x, z, rand, h = 8.5) {
  const s = h / 8.5, rot = rand() * 6.28;
  const out = [];
  const tr = new THREE.CylinderGeometry(0.16 * s, 0.5 * s, h * 0.95, 10, 4);
  out.push(add(tr, mats.bark, x, (h * 0.95) / 2, z));
  const tiers = 8;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = (3.0 - 2.5 * t) * s * (0.9 + rand() * 0.2);
    const ch = (2.3 - 0.9 * t) * s;
    const y = (2.0 + t * (h - 3.6)) * 1;
    const geo = new THREE.ConeGeometry(r, ch, 22, 1, true);
    geo.scale(1, 1, 1);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 4, uv.getY(k) * 1.4);
    const m = add(geo, i % 2 ? mats.leafA : mats.leafB, x, y + ch / 2, z);
    m.rotation.y = rot + i * 1.3;
    out.push(m);
  }
  return out;
}
