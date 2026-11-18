// Portraits des chars : chaque modèle 3D est photographié une fois (vue trois-quarts, fond transparent) puis
// resservi comme image dans les cartes du hangar et de la boutique.
// Les modèles viennent directement de models/tank.js : si le rendu des chars évolue, les portraits suivent.
import * as THREE from 'three';
import { TEAM_INFO } from '/shared/constants.js';
import { SKINS, DEFAULT_SKIN } from '/shared/skins.js';
import { createTankModel } from '../models/tank.js';

const W = 480, H = 270;
let gl = null, scene = null, camera = null;

function setup() {
  const canvas = document.createElement('canvas');
  gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1);
  gl.setSize(W, H, false);
  gl.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x6b6a4a, 1.7));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(-6, 9, 7);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffb36b, 1.1);
  rim.position.set(7, 3, -6);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(26, W / H, 0.5, 200);
}

const cache = new Map(); // clé -> dataURL
const waiting = new Map(); // clé -> Promise
const queue = [];
let busy = false;

function key(type, skin, team) {
  return `${type}|${skin}|${team ?? ''}`;
}

function shoot(type, skin, team) {
  if (!gl) setup();
  const idColor = TEAM_INFO[team]?.color ?? null;
  const model = createTankModel(type, idColor ?? 0x6f7a52, { skin: SKINS[skin] ?? SKINS[DEFAULT_SKIN], idColor });
  const g = model.group;
  g.rotation.y = 0;
  scene.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // trois-quarts avant, légèrement plongeant ; la distance suit la taille du char pour qu'il remplisse le cadre
  const dir = new THREE.Vector3(0.95, 0.36, 1.15).normalize();
  let dist = Math.max(size.x, size.z, size.y * 1.6) / Math.tan((camera.fov * Math.PI) / 360);
  // cadrage : on projette les huit coins de la boîte du char et on ajuste la distance, puis le centrage,
  // pour qu'il remplisse la carte quelle que soit sa taille
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const look = new THREE.Vector3(center.x, center.y - size.y * 0.05, center.z);
  const measure = () => {
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (const c of corners) {
      const p = c.clone().project(camera);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1 };
  };
  camera.clearViewOffset();
  for (let i = 0; i < 4; i++) {
    const m = measure();
    dist *= Math.max((m.x1 - m.x0) / 2 / 0.86, (m.y1 - m.y0) / 2 / 0.8);
  }
  const m = measure();
  camera.setViewOffset(W, H, ((m.x0 + m.x1) / 2) * (W / 2), (-(m.y0 + m.y1) / 2) * (H / 2) + H * 0.03, W, H);
  gl.render(scene, camera);
  const url = gl.domElement.toDataURL('image/png');
  scene.remove(g);
  model.dispose();
  return url;
}

function pump() {
  if (busy) return;
  busy = true;
  const run = () => {
    const job = queue.shift();
    if (!job) {
      busy = false;
      return;
    }
    try {
      const url = shoot(job.type, job.skin, job.team);
      cache.set(job.key, url);
      job.resolve(url);
    } catch (err) {
      console.error('Portrait impossible :', err);
      job.resolve(null);
    }
    waiting.delete(job.key);
    setTimeout(run, 16); // une photo par image : le salon reste fluide
  };
  setTimeout(run, 0);
}

// Portrait d'un char (promesse d'une image PNG en data URL, null en cas d'échec).
export function portrait(type, skin = DEFAULT_SKIN, team = null) {
  const k = key(type, skin, team);
  if (cache.has(k)) return Promise.resolve(cache.get(k));
  if (waiting.has(k)) return waiting.get(k);
  const p = new Promise((resolve) => queue.push({ key: k, type, skin, team, resolve }));
  waiting.set(k, p);
  pump();
  return p;
}

export const portraitNow = (type, skin = DEFAULT_SKIN, team = null) => cache.get(key(type, skin, team)) ?? null;

// Met l'image d'un <img> quand elle est prête (la carte garde son fond en attendant).
export function loadPortrait(img, type, skin, team) {
  const k = key(type, skin, team);
  img.dataset.k = k;
  const ready = cache.get(k);
  if (ready) {
    img.src = ready;
    img.classList.add('ready');
    return;
  }
  img.classList.remove('ready');
  portrait(type, skin, team).then((url) => {
    if (url && img.dataset.k === k) {
      img.src = url;
      img.classList.add('ready');
    }
  });
}
