// Décor low-poly généré à partir des données de la carte (shared/map.js).
// Les collisions viennent de ces mêmes données : ce qu'on voit = ce qui bloque.
import * as THREE from 'three';
import { TEAM_INFO } from '/shared/constants.js';
import { propBuilders } from './props.js';
import { heightAt } from '/shared/map.js';

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

  // Sol : grand plan avec des nuances par sommet
  const hills = !!map.hills;
  const groundSize = hills ? 2 * (Math.max(map.halfX, map.halfZ) + 190) : 520; // grande carte : l'horizon doit rester plein
  const groundSeg = hills ? Math.round(groundSize / 10) : 52;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, groundSeg, groundSeg).rotateX(-Math.PI / 2);
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < groundGeo.attributes.position.count; i++) {
    c.setHSL(theme.ground[0] + rand() * 0.04, theme.ground[1] + rand() * 0.08, theme.ground[2] + rand() * 0.07);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // carte à relief : le grand plan passe sous le maillage de l'arène (sinon les deux se disputent l'affichage)
  add(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 0, hills ? -0.08 : 0, 0, false);

  if (hills) {
    // Relief : l'arène est un maillage fin dont la hauteur suit heightAt (les collisions et les obus lisent la même fonction)
    const r2 = rng(777); // générateur à part : ne décale pas le décor tiré avec `rand`
    const nx = Math.round((map.halfX * 2) / 2.5), nz = Math.round((map.halfZ * 2) / 2.5);
    const geo = new THREE.PlaneGeometry(map.halfX * 2, map.halfZ * 2, nx, nz).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = [];
    const grass = new THREE.Color(), top = new THREE.Color(theme.hill), maxH = Math.max(...map.hills.map((o) => o.h));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z, map);
      pos.setY(i, h);
      grass.setHSL(theme.ground[0] + r2() * 0.03, theme.ground[1] + r2() * 0.06, theme.ground[2] + r2() * 0.05);
      grass.lerp(top, Math.min(0.6, (h / maxH) * 0.6)); // le sommet est plus clair
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

  // Murs d'enceinte
  const wallMat = mat(0x8a8f93);
  const t = 1.2, h = map.wallHeight;
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(map.halfX * 2 + t * 2, h, t), wallMat, 0, h / 2, s * (map.halfZ + t / 2));
    add(new THREE.BoxGeometry(t, h, map.halfZ * 2), wallMat, s * (map.halfX + t / 2), h / 2, 0);
  }

  // Obstacles rectangulaires
  const snowMat = mat(0xf4f8fb);
  const roofMat = mat(0x6a4a3c), concreteMat = mat(0x9a9d9f), trimMat = mat(0x55595c);
  const PROPS = propBuilders({ theme, group, mat, add, snowMat, concreteMat, trimMat });
  // éléments à plat (routes, ponts) : posés en premier, ils ne bloquent rien
  for (const f of map.flats ?? []) PROPS[f.kind]?.(f);
  const bushes = buildBushes(map, theme, mat, group);
  // maillages de chaque objet ('b3', 'c7'…) : pour masquer un objet détruit
  const objects = new Map();
  const track = (key, from) => objects.set(key, group.children.slice(from));
  map.boxes.forEach((b, i) => {
    const from = group.children.length;
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
    track(`b${i}`, from);
  });

  // Rochers et arbres
  const rockMat = mat(theme.rock), trunkMat = mat(0x6b4a2e), leafMat = mat(theme.leaf[0]), leafMat2 = mat(theme.leaf[1]);
  const duneMat = mat(theme.dune ?? 0xd6b679);
  map.circles.forEach((o, i) => {
    const from = group.children.length;
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
    track(`c${i}`, from);
  });

  // Décor lointain (hors arène, purement visuel)
  const hillMat = mat(theme.hill), farTree = mat(theme.farTree);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const d = Math.max(map.halfX, map.halfZ) + 70 + rand() * 90;
    const s = 18 + rand() * 30;
    add(new THREE.ConeGeometry(s, s * (0.5 + rand() * 0.4), 6), hillMat, Math.cos(a) * d, s * 0.2, Math.sin(a) * d, false);
  }
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.max(map.halfX, map.halfZ) + 25 + rand() * 60;
    const x = Math.cos(a) * d * 1.15, z = Math.sin(a) * d;
    if (Math.abs(x) < map.halfX + 5 && Math.abs(z) < map.halfZ + 5) continue;
    add(new THREE.ConeGeometry(2.4, 7, 6), farTree, x, 3.5, z, false);
  }

  // Zone de capture (ou d'extraction / à tenir en campagne) : absente sur certaines missions
  if (!map.zone) return { group, objects, bushes, zone: { update() {} } };
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

  return { group, objects, bushes, zone };
}

// Buissons : touffes de feuillage sans collision (shared/props.js : bush). Un char peut s'y cacher ;
// les touffes proches d'un char bougent un peu pour que le buisson ne paraisse pas figé.
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
        const mesh = new THREE.Mesh(geo, leaf[Math.floor(r() * leaf.length)]);
        mesh.scale.set(s, s * (1.15 + r() * 0.3), s);
        mesh.position.set(x, heightAt(x, z, map) + s * 0.95, z);
        mesh.rotation.y = r() * 6;
        mesh.receiveShadow = true;
        group.add(mesh);
        blobs.push({ mesh, x, z, phase: r() * 6.28, amp: 0, near: s + 2.4 });
      }
    }
  }
  return {
    // views : Map id -> { x, z, speed, alive } ; time en secondes
    update(views, time, dt) {
      if (!blobs.length) return;
      const ease = 1 - Math.exp(-dt * 5);
      for (const b of blobs) {
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
