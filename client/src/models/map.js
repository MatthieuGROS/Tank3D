// Décor low-poly généré à partir des données de la carte (shared/map.js).
// Les collisions viennent de ces mêmes données : ce qu'on voit = ce qui bloque.
import * as THREE from 'three';
import { TEAM_INFO } from '/shared/constants.js';
import { propBuilders } from './props.js';
import { heightAt, groundAt } from '/shared/map.js';
import { buildRaceScenery } from './race.js';
import { buildVoidWorld } from './neon.js';
import { BUSH_CLEAR } from '/shared/vision.js';

// Petit générateur pseudo-aléatoire déterministe : tout le monde voit le même décor.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BUILDING_COLORS = [0xcbb994, 0xb9a98f, 0xa9b0a4, 0xc4a07c];
const CRATE_COLORS = [0xc8792e, 0x2f8c84];

// Ambiances de carte : couleurs du sol, du ciel et de la lumière.
// water / mesa / road : eau, plateaux rocheux et pistes (objets de shared/props.js).
export const THEMES = {
  meadow: {
    sky: 0xa9cbe6, fog: [110, 330], ground: [0.24, 0.3, 0.36], slab: 0x8c8263, hill: 0x5f7d4f, farTree: 0x35633a,
    leaf: [0x3f7a3a, 0x4f8f42], rock: 0x7d7f80, water: 0x4a86a8, mesa: 0x9c8a70, road: 0x9a8a68, hemi: [0xdfeeff, 0x6b6a4a, 1.5], sun: [0xfff1d6, 2.2],
  },
  desert: {
    sky: 0xe9d6ae, fog: [100, 300], ground: [0.1, 0.42, 0.6], slab: 0xc7a56d, hill: 0xc49a5f, farTree: 0x8c7a4a,
    leaf: [0x7c8a3c, 0x8f9a48], rock: 0xa58a68, dune: 0xd6b679, water: 0x3fa3a6, mesa: 0xc08a5a, road: 0xb89462, hemi: [0xfff3dc, 0x9a7a4a, 1.6], sun: [0xfff0c8, 2.6],
  },
  dusk: {
    sky: 0xe39a6a, fog: [90, 280], ground: [0.08, 0.35, 0.42], slab: 0xa47a55, hill: 0x7a5a48, farTree: 0x4a3a30,
    leaf: [0x4f5a2e, 0x5f6a36], rock: 0x8a7a70, dune: 0xc4925f, water: 0x5a6f86, mesa: 0x9a5e44, road: 0x9a7050, hemi: [0xffc8a0, 0x4a3a40, 1.1], sun: [0xffa860, 2.0],
  },
  snow: {
    sky: 0xcbd8e4, fog: [100, 300], ground: [0.58, 0.12, 0.86], slab: 0xdfe5ea, hill: 0xe8eef2, farTree: 0x2f4f3f,
    leaf: [0x2f5a40, 0x3a6a4a], rock: 0x8a9096, snowy: true, water: 0x3a5f75, mesa: 0x8a9096, road: 0xaeb4b2, hemi: [0xeaf2ff, 0x8a96a0, 1.6], sun: [0xf2f6ff, 2.0],
  },
  // circuit au-dessus du vide : tout est dessiné dans models/neon.js ; ces valeurs règlent le ciel, la brume et la lumière
  neon: {
    sky: 0x120a26, fog: [220, 1000], ground: [0.65, 0.5, 0.1], slab: 0x1a2038, hill: 0x2a2a58, farTree: 0x2a2a58,
    leaf: [0x2a2a58, 0x2a2a58], rock: 0x2a3050, water: 0x1a2a58, mesa: 0x2a3050, road: 0x1a2038, hemi: [0x9db4ff, 0x4a2a7a, 1.55], sun: [0xbfd2ff, 1.7],
  },
  blizzard: {
    sky: 0x9fb0c0, fog: [40, 190], ground: [0.58, 0.1, 0.8], slab: 0xd2dae0, hill: 0xdce4ea, farTree: 0x2f4f3f,
    leaf: [0x2f5a40, 0x3a6a4a], rock: 0x7f868c, snowy: true, water: 0x35505f, mesa: 0x7f868c, road: 0xa3aaa9, hemi: [0xdde8f4, 0x707c88, 1.4], sun: [0xdfe8f4, 1.4],
  },
};

export function createMapModel(map) {
  const theme = THEMES[map.theme] ?? THEMES.meadow;
  const group = new THREE.Group();
  const rand = rng(1234);
  const mat = (color, extra) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const add = (geo, material, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Circuit au-dessus du vide : ni sol, ni murs, ni décor lointain (tout le décor est dans neon.js)
  const voidMap = !!map.race?.floor;
  const world = [];
  if (voidMap) buildVoidWorld({ map, theme, group, live: world });

  // Sol : grand plan avec des nuances par sommet
  const hills = !!map.hills;
  const groundSize = hills ? 2 * (Math.max(map.halfX, map.halfZ) + 190) : 520; // grande carte : l'horizon doit rester plein
  const groundSeg = hills ? Math.round(groundSize / 10) : 52;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, groundSeg, groundSeg).rotateX(-Math.PI / 2);
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < groundGeo.attributes.position.count; i++) {
    c.setHSL(theme.ground[0] + rand() * 0.04, theme.ground[1] + rand() * 0.08, theme.ground[2] + rand() * 0.07);
    paintGround(map, c, groundGeo.attributes.position.getX(i), groundGeo.attributes.position.getZ(i), rand);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // carte à relief : le grand plan passe sous le maillage de l'arène (sinon les deux se disputent l'affichage).
  // Avec des creux (oued, tranchée), il les masquerait : on le perce à l'emplacement de l'arène.
  const dips = hills && map.hills.some((o) => o.h < 0);
  if (!voidMap && dips) {
    const half = groundSize / 2;
    const frame = new THREE.Shape([new THREE.Vector2(-half, -half), new THREE.Vector2(half, -half), new THREE.Vector2(half, half), new THREE.Vector2(-half, half)]);
    frame.holes.push(new THREE.Path([new THREE.Vector2(-map.halfX, -map.halfZ), new THREE.Vector2(-map.halfX, map.halfZ), new THREE.Vector2(map.halfX, map.halfZ), new THREE.Vector2(map.halfX, -map.halfZ)]));
    const geo = new THREE.ShapeGeometry(frame).rotateX(Math.PI / 2);
    const fc = [];
    for (let i = 0; i < geo.attributes.position.count; i++) {
      c.setHSL(theme.ground[0] + rand() * 0.04, theme.ground[1] + rand() * 0.08, theme.ground[2] + rand() * 0.07);
      paintGround(map, c, geo.attributes.position.getX(i), geo.attributes.position.getZ(i), rand);
      fc.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    add(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0, -0.08, 0, false);
  } else if (!voidMap) add(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 0, hills ? -0.08 : 0, 0, false);

  if (voidMap) {
    // rien : le vide
  } else if (hills) {
    // Relief : l'arène est un maillage fin dont la hauteur suit heightAt (les collisions et les obus lisent la même fonction)
    const r2 = rng(777); // générateur à part : ne décale pas le décor tiré avec `rand`
    const nx = Math.round((map.halfX * 2) / 2.5), nz = Math.round((map.halfZ * 2) / 2.5);
    const geo = new THREE.PlaneGeometry(map.halfX * 2, map.halfZ * 2, nx, nz).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = [];
    const grass = new THREE.Color(), top = new THREE.Color(theme.hill), maxH = Math.max(1, ...map.hills.map((o) => o.h));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = groundAt(x, z, map); // relief naturel : les rampes de course ont leur propre maillage
      pos.setY(i, h);
      grass.setHSL(theme.ground[0] + r2() * 0.03, theme.ground[1] + r2() * 0.06, theme.ground[2] + r2() * 0.05);
      const painted = paintGround(map, grass, x, z, r2);
      if (h > 0) grass.lerp(top, Math.min(0.6, (h / maxH) * 0.6) * (1 - painted)); // le sommet est plus clair
      else if (h < 0) grass.multiplyScalar(1 + h * 0.045); // fond d'un creux : plus sombre
      cols.push(grass.r, grass.g, grass.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const terrain = add(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 0, 0, 0, false);
    terrain.receiveShadow = true;
  } else {
    // Dalle de terre battue sur l'arène
    add(new THREE.BoxGeometry(map.halfX * 2, 0.06, map.halfZ * 2), mat(theme.slab), 0, 0.0, 0, false);
  }

  // Murs d'enceinte (invisibles au-dessus du vide : on ne les atteint pas)
  const wallMat = mat(0x8a8f93);
  const t = 1.2, h = map.wallHeight;
  const lo = hills ? Math.min(0, ...map.hills.map((o) => o.h)) : 0; // un creux peut longer le mur : il descend jusqu'au fond
  if (!voidMap) {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(map.halfX * 2 + t * 2, h - lo, t), wallMat, 0, (h + lo) / 2, s * (map.halfZ + t / 2));
      add(new THREE.BoxGeometry(t, h - lo, map.halfZ * 2), wallMat, s * (map.halfX + t / 2), (h + lo) / 2, 0);
    }
  }

  // Obstacles rectangulaires
  const snowMat = mat(0xf4f8fb);
  const roofMat = mat(0x6a4a3c), concreteMat = mat(0x9a9d9f), trimMat = mat(0x55595c);
  const PROPS = propBuilders({ theme, group, mat, add, snowMat, concreteMat, trimMat });
  // carte à relief : un objet posé sur le sol (shared/map.js : settle) a `base` = altitude du sol et `h` absolu.
  // On le construit comme au niveau 0 (hauteur propre h - base), puis on remonte ses maillages de `base`.
  const local = (o) => (o.base ? { ...o, h: o.h - o.base } : o);
  const lift = (from, base) => {
    if (base) for (let k = from; k < group.children.length; k++) group.children[k].position.y += base;
  };
  // éléments à plat (routes, ponts) : posés en premier, ils ne bloquent rien
  for (const f of map.flats ?? []) {
    const from = group.children.length;
    PROPS[f.kind]?.(f);
    lift(from, f.base);
  }
  const bushes = buildBushes(map, theme, mat, group);
  // maillages de chaque objet ('b3', 'c7'…) : pour masquer un objet détruit
  const objects = new Map();
  const track = (key, from) => objects.set(key, group.children.slice(from));
  map.boxes.forEach((b0, i) => {
    const from = group.children.length;
    const b = local(b0);
    if (b.kind === 'building') {
      add(new THREE.BoxGeometry(b.w, b.h, b.d), mat(BUILDING_COLORS[i % BUILDING_COLORS.length]), b.x, b.h / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.8, 0.4, b.d + 0.8), theme.snowy ? snowMat : roofMat, b.x, b.h + 0.2, b.z);
      add(new THREE.BoxGeometry(1.6, 1, 1.6), trimMat, b.x + b.w / 4, b.h + 0.9, b.z - b.d / 5);
      add(new THREE.BoxGeometry(b.w + 0.3, 0.5, b.d + 0.3), trimMat, b.x, 0.25, b.z);
    } else if (b.kind === 'wall') {
      add(new THREE.BoxGeometry(b.w, b.h, b.d), concreteMat, b.x, b.h / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.3, 0.25, b.d + 0.3), trimMat, b.x, b.h + 0.12, b.z);
    } else if (PROPS[b.kind]) {
      PROPS[b.kind](b, i);
    } else {
      add(new THREE.BoxGeometry(b.w, b.h, b.d), mat(CRATE_COLORS[i % CRATE_COLORS.length]), b.x, b.h / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.15, 0.25, b.d + 0.15), trimMat, b.x, b.h - 0.12, b.z);
      add(new THREE.BoxGeometry(b.w + 0.15, 0.25, b.d + 0.15), trimMat, b.x, 0.12, b.z);
    }
    lift(from, b0.base);
    track(`b${i}`, from);
  });

  // Rochers et arbres
  const rockMat = mat(theme.rock), trunkMat = mat(0x6b4a2e), leafMat = mat(theme.leaf[0]), leafMat2 = mat(theme.leaf[1]);
  const duneMat = mat(theme.dune ?? 0xd6b679);
  map.circles.forEach((o0, i) => {
    const from = group.children.length;
    const o = local(o0);
    if (o.kind === 'dune') {
      // dune : demi-sphère aplatie (bloque les chars et les obus jusqu'à sa hauteur)
      const geo = new THREE.SphereGeometry(o.r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.scale(1, o.h / o.r, 1);
      const m = add(geo, duneMat, o.x, 0, o.z);
      m.rotation.y = rand() * 6;
    } else if (o.kind === 'rock') {
      const geo = new THREE.IcosahedronGeometry(o.r * 1.08, 0);
      const pos = geo.attributes.position;
      const r2 = rng(Math.round(o.x * 31 + o.z * 17 + 999));
      // même décalage pour les sommets confondus, sinon le rocher s'ouvre
      const moved = new Map();
      for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
        if (!moved.has(key)) moved.set(key, 0.85 + r2() * 0.3);
        const k = moved.get(key);
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const m = add(geo, rockMat, o.x, o.r * 0.25, o.z);
      m.rotation.y = r2() * 6;
      if (theme.snowy) add(new THREE.SphereGeometry(o.r * 0.8, 7, 3, 0, Math.PI * 2, 0, Math.PI / 3), snowMat, o.x, o.r * 0.55, o.z, false);
    } else if (PROPS[o.kind]) {
      PROPS[o.kind](o);
    } else {
      // feuillage au-dessus des chars : seul le tronc bloque
      add(new THREE.CylinderGeometry(0.35, 0.55, 3.8, 6), trunkMat, o.x, 1.9, o.z);
      add(new THREE.ConeGeometry(2.5, 3.6, 7), leafMat, o.x, 5.3, o.z);
      add(new THREE.ConeGeometry(1.8, 3.0, 7), leafMat2, o.x, 7.3, o.z);
      if (theme.snowy) add(new THREE.ConeGeometry(1.0, 1.4, 7), snowMat, o.x, 8.4, o.z, false);
    }
    lift(from, o0.base);
    track(`c${i}`, from);
  });

  // Décor lointain (hors arène, purement visuel)
  const hillMat = mat(theme.hill), farTree = mat(theme.farTree);
  for (let i = 0; i < (voidMap ? 0 : 26); i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const d = Math.max(map.halfX, map.halfZ) + 70 + rand() * 90;
    const s = 18 + rand() * 30;
    add(new THREE.ConeGeometry(s, s * (0.5 + rand() * 0.4), 6), hillMat, Math.cos(a) * d, s * 0.2, Math.sin(a) * d, false);
  }
  for (let i = 0; i < (voidMap ? 0 : 60); i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.max(map.halfX, map.halfZ) + 25 + rand() * 60;
    const x = Math.cos(a) * d * 1.15, z = Math.sin(a) * d;
    if (Math.abs(x) < map.halfX + 5 && Math.abs(z) < map.halfZ + 5) continue;
    add(new THREE.ConeGeometry(2.4, 7, 6), farTree, x, 3.5, z, false);
  }

  // Silhouettes de tours au loin (map.skyline = rectangle hors de l'arène où les semer), noyées dans la brume
  if (map.skyline) {
    const sk = map.skyline, r3 = rng(9090);
    const skyMats = [0x8d8f94, 0x9c9a92, 0x7f8790].map((col) => mat(new THREE.Color(col).lerp(new THREE.Color(theme.sky), 0.4).getHex())); // pâlies : elles sont loin
    for (let i = 0; i < sk.n; i++) {
      const w = 10 + r3() * 16, d = 10 + r3() * 16, hh = 22 + r3() * 50;
      const x = sk.x0 + r3() * (sk.x1 - sk.x0), z = sk.z0 + r3() * (sk.z1 - sk.z0);
      add(new THREE.BoxGeometry(w, hh, d), skyMats[i % skyMats.length], x, hh / 2, z, false);
      if (r3() < 0.4) add(new THREE.CylinderGeometry(0.2, 0.2, 10, 4), skyMats[0], x, hh + 5, z, false);
    }
  }

  // Course : piste, points de passage, tremplins, obstacles mobiles
  let race = map.race ? buildRaceScenery({ map, theme, group, mat, add }) : null;
  if (race && world.length) {
    // ciel, planètes, monolithes… : eux aussi s'animent avec le décor de course
    const raceUpdate = race.update;
    race = { update(clock, time, next) { raceUpdate(clock, time, next); for (const a of world) a.update(clock, time); } };
  }

  // Zone de capture (ou d'extraction / à tenir en campagne) : absente sur certaines missions
  if (!map.zone) return { group, objects, bushes, zone: { update() {} }, race };
  const z = map.zone;
  const gz = heightAt(z.x, z.z, map); // zone posée sur le sommet (plat) d'une colline
  const neutral = new THREE.Color(0xf2f2f2);
  const ringMat = new THREE.MeshBasicMaterial({ color: neutral, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const discMat = new THREE.MeshBasicMaterial({ color: neutral, transparent: true, opacity: 0.08, depthWrite: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: neutral, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const beaconMat = new THREE.MeshLambertMaterial({ color: neutral, emissive: neutral, emissiveIntensity: 0.5, flatShading: true });
  const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.35, z.r, 48).rotateX(-Math.PI / 2), ringMat);
  ring.position.set(z.x, gz + 0.08, z.z);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r - 0.35, 48).rotateX(-Math.PI / 2), discMat);
  disc.position.set(z.x, gz + 0.07, z.z);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(z.r, z.r, 1.6, 48, 1, true), haloMat);
  halo.position.set(z.x, gz + 0.8, z.z);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), beaconMat);
  beacon.position.set(z.x, gz + 7, z.z);
  group.add(ring, disc, halo, beacon);

  const target = new THREE.Color();
  const zone = {
    // team = équipe qui capture, progress = 0..1
    update(team, progress, contested, time) {
      target.copy(neutral);
      if (team) target.lerp(new THREE.Color(TEAM_INFO[team].color), 0.35 + 0.65 * progress);
      for (const m of [ringMat, discMat, haloMat, beaconMat]) m.color.lerp(target, 0.15);
      beaconMat.emissive.copy(beaconMat.color);
      discMat.opacity = 0.08 + 0.3 * progress;
      haloMat.opacity = contested ? 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(time * 10)) : 0.1;
      beacon.rotation.y = time * 1.2;
      beacon.position.y = gz + 7 + Math.sin(time * 2) * 0.4;
    },
  };

  return { group, objects, bushes, zone, race };
}

// Teinte du sol par régions (map.paint = [{ x0, x1, z0, z1, soft, hsl }], borne absente = infinie) :
// le sable vire au bitume, etc. Modifie `color` et renvoie le poids de la peinture (0..1).
function paintGround(map, color, x, z, rand) {
  if (!map.paint) return 0;
  let wMax = 0;
  for (const p of map.paint) {
    const s = p.soft ?? 10;
    const ramp = (v, a, b) => Math.min(a === undefined ? 1 : (v - a) / s + 0.5, b === undefined ? 1 : (b - v) / s + 0.5);
    const w = Math.max(0, Math.min(1, ramp(x, p.x0, p.x1), ramp(z, p.z0, p.z1)));
    if (w <= 0) continue;
    const target = new THREE.Color().setHSL(p.hsl[0] + rand() * 0.02, p.hsl[1] + rand() * 0.03, p.hsl[2] + rand() * 0.05);
    color.lerp(target, w);
    wMax = Math.max(wMax, w);
  }
  return wMax;
}

// Buissons : touffes de feuillage sans collision (shared/props.js : bush). Un char peut s'y cacher ;
// les touffes proches d'un char bougent un peu pour que le buisson ne paraisse pas figé.
// Les touffes à moins de BUSH_CLEAR m du char suivi par la caméra deviennent transparentes à 90 % :
// ce feuillage-là ne gêne pas sa vue (shared/vision.js).
function buildBushes(map, theme, mat, group) {
  const blobs = [];
  const leaf = [mat(theme.leaf[0]), mat(theme.leaf[1]), mat(0x4a8a40)];
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const r = rng(4242); // générateur à part : ne décale pas le décor tiré avec `rand`
  for (const f of map.flats ?? []) {
    if (f.kind !== 'bush') continue;
    const cols = Math.max(1, Math.round(f.w / 2.6)), rows = Math.max(1, Math.round(f.d / 2.6));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = f.x - f.w / 2 + ((i + 0.5 + (r() - 0.5) * 0.7) * f.w) / cols;
        const z = f.z - f.d / 2 + ((j + 0.5 + (r() - 0.5) * 0.7) * f.d) / rows;
        const s = 1.5 + r() * 0.7;
        // matériau propre à chaque touffe : elle peut s'effacer seule
        const mesh = new THREE.Mesh(geo, leaf[Math.floor(r() * leaf.length)].clone());
        mesh.scale.set(s, s * (1.15 + r() * 0.3), s);
        mesh.position.set(x, heightAt(x, z, map) + s * 0.95, z);
        mesh.rotation.y = r() * 6;
        mesh.receiveShadow = true;
        group.add(mesh);
        blobs.push({ mesh, x, z, phase: r() * 6.28, amp: 0, near: s + 2.4, alpha: 1 });
      }
    }
  }
  return {
    // views : Map id -> { x, z, speed, alive } ; time en secondes
    // viewer = { x, z } du char suivi par la caméra (ou null)
    update(views, time, dt, viewer = null) {
      if (!blobs.length) return;
      const ease = 1 - Math.exp(-dt * 5);
      const fade = 1 - Math.exp(-dt * 8);
      for (const b of blobs) {
        const near = viewer && (b.x - viewer.x) ** 2 + (b.z - viewer.z) ** 2 < BUSH_CLEAR * BUSH_CLEAR;
        const alpha = b.alpha + ((near ? 0.1 : 1) - b.alpha) * fade;
        b.alpha = Math.abs(alpha - 1) < 0.01 ? 1 : alpha;
        const m = b.mesh.material, see = b.alpha < 1;
        if (m.transparent !== see) {
          m.transparent = see;
          m.depthWrite = !see;
          m.needsUpdate = true;
        }
        m.opacity = b.alpha;
        let target = 0;
        for (const v of views.values()) {
          if (!v.alive) continue;
          const dx = v.x - b.x, dz = v.z - b.z;
          if (dx * dx + dz * dz < b.near * b.near) target = Math.max(target, 0.5 + Math.min(0.5, Math.abs(v.speed) / 10));
        }
        b.amp += (target - b.amp) * ease;
        const sway = 0.012 + b.amp * 0.09;
        b.mesh.rotation.z = Math.sin(time * 1.4 + b.phase) * 0.012 + Math.sin(time * 7 + b.phase) * (sway - 0.012);
        b.mesh.rotation.x = Math.cos(time * 5.3 + b.phase * 1.7) * b.amp * 0.07;
      }
    },
  };
}
