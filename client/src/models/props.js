// Rendu low-poly des objets de la bibliothèque de décor (shared/props.js).
// Une fonction par `kind` ; elle reçoit l'objet de la carte et pose ses maillages.
// Les volumes visibles collent aux volumes de collision (sauf détails décoratifs fins).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const seedOf = (o) => Math.round(o.x * 73 + o.z * 151 + 4099);

export function propBuilders({ theme, group, mat, add, snowMat, concreteMat, trimMat }) {
  const snowy = !!theme.snowy;
  const M = {
    water: mat(theme.water ?? 0x4a86a8, { transparent: true, opacity: 0.88 }),
    deep: mat(new THREE.Color(theme.water ?? 0x4a86a8).multiplyScalar(0.72).getHex()),
    shore: mat(snowy ? 0xcfd8de : new THREE.Color(theme.slab).multiplyScalar(0.85).getHex()),
    ice: mat(0xeef5fa),
    reed: mat(theme.leaf[1]),
    mesa: mat(theme.mesa ?? 0xc08a5a),
    mesaBand: mat(new THREE.Color(theme.mesa ?? 0xc08a5a).multiplyScalar(0.78).getHex()),
    mesaTop: mat(new THREE.Color(theme.mesa ?? 0xc08a5a).lerp(new THREE.Color(theme.slab), 0.45).getHex()),
    sandstone: mat(0xd6bf8e),
    sandstoneDark: mat(0xb89c6c),
    pipe: mat(0x7d8489),
    flange: mat(0x8f4f2c),
    steel: mat(0x45484c),
    rust: mat(0xc8792e),
    road: mat(theme.road ?? 0x9a8a68),
    plank: mat(0x7a5a3e),
    plankDark: mat(0x5c4330),
    palmTrunk: mat(0x8a6a45),
    palmLeaf: mat(snowy ? theme.leaf[0] : 0x5a8f3a),
    slit: mat(0x1f2124),
    adobe: [mat(0xc9a170), mat(0xd4b083), mat(0xb98f60)],
    adobeDark: mat(0xa27a4c),
    dome: mat(0x3f8f8a),
    gold: mat(0xd8b24a),
    tower: [mat(0xcfc6b4), mat(0xb7b2a6), mat(0xa9b3b8), mat(0xd8c3a0), mat(0x9fa6a0)],
    glass: mat(0x2e3a44),
    burnt: mat(0x2f2a27),
    scorched: mat(0x4a3b30),
    tire: mat(0x1c1c1e),
    car: [mat(0x7a3a2c), mat(0x8a7b5c), mat(0x40566a), mat(0x3b3430)],
    busBody: [mat(0xd8c9a0), mat(0x5f7d8c)],
    sand: [mat(0xb09b6c), mat(0x9f8a5e)],
    dash: mat(0xe8e2c8),
  };

  // Poutre entre deux points (cylindre orienté).
  const beam = (a, b, r, material) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = add(new THREE.CylinderGeometry(r, r, dir.length(), 5), material, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return m;
  };

  return {
    // ------------------------------------------------------------- boîtes
    // Plateau rocheux : falaise en strates, bandes plus sombres, sommet érodé.
    mesa(b) {
      const r = rng(seedOf(b));
      add(new THREE.BoxGeometry(b.w, b.h, b.d), M.mesa, b.x, b.h / 2, b.z);
      for (const y of [b.h * 0.3, b.h * 0.62]) add(new THREE.BoxGeometry(b.w + 0.35, 0.7, b.d + 0.35), M.mesaBand, b.x, y, b.z, false);
      add(new THREE.BoxGeometry(b.w - 0.6, 0.5, b.d - 0.6), snowy ? snowMat : M.mesaTop, b.x, b.h + 0.25, b.z, false);
      // éboulis au pied et blocs sur le sommet
      const n = Math.round((b.w + b.d) / 6);
      for (let i = 0; i < n; i++) {
        const s = 0.8 + r() * 1.4;
        const g = new THREE.IcosahedronGeometry(s, 0);
        const side = r() < 0.5;
        const x = side ? b.x + (r() - 0.5) * b.w : b.x + (r() < 0.5 ? -1 : 1) * (b.w / 2 + s * 0.2);
        const z = side ? b.z + (r() < 0.5 ? -1 : 1) * (b.d / 2 + s * 0.2) : b.z + (r() - 0.5) * b.d;
        add(g, M.mesaBand, x, s * 0.3, z, false).rotation.y = r() * 6;
        if (i % 2 === 0) add(new THREE.IcosahedronGeometry(s * 0.9, 0), M.mesa, b.x + (r() - 0.5) * (b.w - 3), b.h + s * 0.3, b.z + (r() - 0.5) * (b.d - 3), false);
      }
    },

    // Pipeline : tube sur supports, brides rouillées. Bas : les obus passent au-dessus.
    pipe(b) {
      const along = b.axis === 'x';
      const len = along ? b.w : b.d;
      const tube = add(new THREE.CylinderGeometry(0.55, 0.55, len, 10), M.pipe, b.x, 0.8, b.z);
      tube.rotation[along ? 'z' : 'x'] = Math.PI / 2;
      const n = Math.max(1, Math.round(len / 4));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        const x = along ? b.x + t : b.x, z = along ? b.z : b.z + t;
        add(new THREE.BoxGeometry(along ? 0.3 : 1.3, 0.35, along ? 1.3 : 0.3), M.steel, x, 0.17, z);
        if (i % 2 === 1) {
          const f = add(new THREE.CylinderGeometry(0.7, 0.7, 0.3, 10), M.flange, x, 0.8, z);
          f.rotation[along ? 'z' : 'x'] = Math.PI / 2;
        }
      }
    },

    // Eau (rivière, bassin) : surface, berge, glaçons si thème enneigé, roseaux sinon.
    water(o) {
      const r = rng(seedOf(o));
      if (o.r !== undefined) {
        add(new THREE.CircleGeometry(o.r + 0.8, 24).rotateX(-Math.PI / 2), M.shore, o.x, 0.04, o.z, false);
        add(new THREE.CircleGeometry(o.r, 24).rotateX(-Math.PI / 2), M.deep, o.x, 0.05, o.z, false);
        add(new THREE.CircleGeometry(o.r * 0.97, 24).rotateX(-Math.PI / 2), M.water, o.x, 0.07, o.z, false);
        if (!snowy) {
          for (let i = 0; i < 9; i++) {
            const a = r() * Math.PI * 2, d = o.r * (0.85 + r() * 0.2);
            add(new THREE.ConeGeometry(0.12, 1.2 + r() * 0.8, 4), M.reed, o.x + Math.cos(a) * d, 0.7, o.z + Math.sin(a) * d, false);
          }
        }
        return;
      }
      add(new THREE.BoxGeometry(o.w + 1.2, 0.04, o.d + 1.2), M.shore, o.x, 0.04, o.z, false);
      add(new THREE.BoxGeometry(o.w, 0.04, o.d), M.deep, o.x, 0.05, o.z, false);
      add(new THREE.BoxGeometry(o.w - 0.4, 0.04, o.d - 0.4), M.water, o.x, 0.08, o.z, false);
      if (snowy) {
        const n = Math.round((o.w * o.d) / 40);
        for (let i = 0; i < n; i++) {
          const s = 0.6 + r() * 1.4;
          const floe = add(new THREE.CylinderGeometry(s, s * 0.9, 0.12, 5 + Math.floor(r() * 3)), M.ice,
            o.x + (r() - 0.5) * (o.w - 2 * s), 0.12, o.z + (r() - 0.5) * (o.d - 2 * s), false);
          floe.rotation.y = r() * 6;
        }
      }
    },

    // Casemate de béton : meurtrière sombre, dalle débordante.
    bunker(b) {
      add(new THREE.BoxGeometry(b.w, b.h, b.d), concreteMat, b.x, b.h / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.04, 0.35, b.d + 0.04), M.slit, b.x, b.h - 0.75, b.z, false);
      add(new THREE.BoxGeometry(b.w + 0.6, 0.35, b.d + 0.6), snowy ? snowMat : trimMat, b.x, b.h + 0.17, b.z);
      add(new THREE.BoxGeometry(b.w + 0.3, 0.4, b.d + 0.3), trimMat, b.x, 0.2, b.z);
    },

    // Derrick : pylône en treillis sur sa plate-forme.
    derrick(b) {
      const half = b.w / 2 - 0.3, top = 0.6;
      add(new THREE.BoxGeometry(b.w, 0.6, b.d), M.steel, b.x, 0.3, b.z);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const at = (sx, sz, y) => {
        const k = 1 - (y / b.h) * (1 - top / half);
        return new THREE.Vector3(b.x + sx * half * k, y, b.z + sz * half * k);
      };
      for (const [sx, sz] of corners) beam(at(sx, sz, 0.6), at(sx, sz, b.h), 0.16, M.steel);
      for (const y of [3, 6.5, 10]) {
        for (let i = 0; i < 4; i++) {
          const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
          beam(at(ax, az, y), at(bx, bz, y), 0.09, M.rust);
          beam(at(ax, az, y), at(bx, bz, y + 3.4 > b.h ? b.h : y + 3.4), 0.06, M.steel);
        }
      }
      add(new THREE.BoxGeometry(1.8, 0.8, 1.8), M.rust, b.x, b.h + 0.4, b.z);
    },

    // Mur de grès effondré : créneaux irréguliers et gravats.
    ruin(b) {
      const r = rng(seedOf(b));
      const along = b.w >= b.d;
      const len = along ? b.w : b.d, n = Math.max(2, Math.round(len / 1.6)), seg = len / n;
      for (let i = 0; i < n; i++) {
        const h = b.h * (0.75 + r() * 0.35), t = -len / 2 + seg * (i + 0.5);
        add(new THREE.BoxGeometry(along ? seg + 0.02 : b.w, h, along ? b.d : seg + 0.02), i % 2 ? M.sandstone : M.sandstoneDark,
          along ? b.x + t : b.x, h / 2, along ? b.z : b.z + t);
      }
      for (let i = 0; i < n; i++) {
        const s = 0.25 + r() * 0.35, t = (r() - 0.5) * len, off = (r() < 0.5 ? -1 : 1) * (1.2 + r());
        add(new THREE.BoxGeometry(s * 2, s, s * 1.6), M.sandstoneDark, along ? b.x + t : b.x + off, s / 2, along ? b.z + off : b.z + t, false).rotation.y = r() * 3;
      }
    },

    // Immeuble : bandeaux de fenêtres sombres à chaque étage, vitrines au rez-de-chaussée, toit technique.
    tower(b) {
      const r = rng(seedOf(b));
      add(new THREE.BoxGeometry(b.w, b.h, b.d), M.tower[Math.floor(r() * M.tower.length)], b.x, b.h / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.08, 2.2, b.d + 0.08), M.glass, b.x, 1.5, b.z, false);
      for (let y = 4.4; y < b.h - 1.4; y += 3.2) add(new THREE.BoxGeometry(b.w + 0.06, 1.1, b.d + 0.06), M.glass, b.x, y, b.z, false);
      add(new THREE.BoxGeometry(b.w + 0.4, 0.5, b.d + 0.4), snowy ? snowMat : trimMat, b.x, b.h + 0.25, b.z);
      add(new THREE.BoxGeometry(2.2, 1.8, 2.2), trimMat, b.x - b.w / 5, b.h + 1.1, b.z + b.d / 5);
      if (r() < 0.6) add(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 8), M.steel, b.x + b.w / 5, b.h + 1.3, b.z - b.d / 5);
      else add(new THREE.CylinderGeometry(0.07, 0.07, 5, 4), M.steel, b.x + b.w / 4, b.h + 2.7, b.z - b.d / 4, false);
    },

    // Maison de terre : créneaux, porte et petites fenêtres sombres, poutres de bois en saillie.
    adobe(b) {
      const r = rng(seedOf(b));
      const wallM = M.adobe[Math.floor(r() * M.adobe.length)];
      add(new THREE.BoxGeometry(b.w, b.h, b.d), wallM, b.x, b.h / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.2, 0.25, b.d + 0.2), M.adobeDark, b.x, b.h - 0.1, b.z, false);
      // créneaux le long des quatre bords
      for (const [len, along] of [[b.w, true], [b.d, false]]) {
        const n = Math.max(3, Math.round(len / 1.3) | 1);
        for (let i = 0; i < n; i += 2) {
          const t = -len / 2 + ((i + 0.5) * len) / n;
          for (const s of [-1, 1]) {
            const x = along ? b.x + t : b.x + s * (b.w / 2 - 0.25), z = along ? b.z + s * (b.d / 2 - 0.25) : b.z + t;
            add(new THREE.BoxGeometry(along ? len / n : 0.5, 0.7, along ? 0.5 : len / n), wallM, x, b.h + 0.35, z, false);
          }
        }
      }
      // porte sur une grande face, fenêtres sur les deux
      const long = b.w >= b.d, face = long ? b.d / 2 : b.w / 2, len = long ? b.w : b.d;
      const at = (t, y, s, w, h) => add(new THREE.BoxGeometry(long ? w : 0.1, h, long ? 0.1 : w), M.slit,
        long ? b.x + t : b.x + s * (face + 0.03), y, long ? b.z + s * (face + 0.03) : b.z + t, false);
      at((r() - 0.5) * len * 0.5, 1.1, r() < 0.5 ? -1 : 1, 1.4, 2.2);
      for (const s of [-1, 1]) for (const t of [-len / 3, len / 3]) if (b.h > 4) at(t, b.h * 0.68, s, 0.7, 0.75);
      // poutres en saillie
      for (let i = 0; i < Math.round(len / 2.5); i++) {
        const t = -len / 2 + 1 + i * 2.5, s = i % 2 ? 1 : -1;
        const beam = add(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 4), M.plankDark,
          long ? b.x + t : b.x + s * (face + 0.3), b.h - 0.9, long ? b.z + s * (face + 0.3) : b.z + t, false);
        beam.rotation[long ? 'x' : 'z'] = Math.PI / 2;
      }
    },

    // Sacs de sable : deux rangs empilés et un rang de couronnement. Bas : les obus passent au-dessus.
    sandbag(b) {
      const r = rng(seedOf(b));
      const along = b.w >= b.d, len = along ? b.w : b.d, wid = along ? b.d : b.w;
      const n = Math.max(2, Math.round(len / 1.1));
      for (let row = 0; row < 3; row++) {
        const y = 0.22 + row * 0.42, k = row === 2 ? 0.6 : 1;
        for (let i = 0; i < n - (row % 2); i++) {
          const t = -len / 2 + ((i + 0.5 + (row % 2) * 0.5) * len) / n;
          const bag = add(new THREE.BoxGeometry(along ? len / n + 0.05 : wid * k, 0.42, along ? wid * k : len / n + 0.05),
            M.sand[(i + row) % 2], along ? b.x + t : b.x, y, along ? b.z : b.z + t, row === 0);
          bag.rotation.y = (r() - 0.5) * 0.12;
        }
      }
    },

    // Épave de voiture : caisse, habitacle, roues ; brûlée une fois sur deux.
    wreck(b) {
      const r = rng(seedOf(b));
      const along = b.d > b.w, L = Math.max(b.w, b.d), W = Math.min(b.w, b.d);
      const body = r() < 0.5 ? M.burnt : M.car[Math.floor(r() * M.car.length)];
      const box = (w, h, l, y, m, off = 0, shadow = true) =>
        add(new THREE.BoxGeometry(along ? w : l, h, along ? l : w), m, along ? b.x : b.x + off, y, along ? b.z + off : b.z, shadow);
      box(W, 0.6, L, 0.62, body);
      box(W * 0.86, 0.5, L * 0.48, 1.15, body === M.burnt ? M.scorched : M.glass, -L * 0.05);
      for (const sa of [-1, 1]) {
        for (const sl of [-1, 1]) {
          const wh = add(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 8), M.tire,
            along ? b.x + sa * W * 0.45 : b.x + sl * L * 0.32, 0.36, along ? b.z + sl * L * 0.32 : b.z + sa * W * 0.45, false);
          wh.rotation[along ? 'z' : 'x'] = Math.PI / 2;
        }
      }
    },

    // Bus abandonné : caisse haute, bandeau de vitres, roues.
    bus(b) {
      const r = rng(seedOf(b));
      const along = b.d > b.w, L = Math.max(b.w, b.d), W = Math.min(b.w, b.d);
      const body = M.busBody[Math.floor(r() * M.busBody.length)];
      add(new THREE.BoxGeometry(b.w, b.h - 0.5, b.d), body, b.x, 0.5 + (b.h - 0.5) / 2, b.z);
      add(new THREE.BoxGeometry(b.w + 0.06, 0.9, b.d + 0.06), M.glass, b.x, b.h - 1.0, b.z, false);
      add(new THREE.BoxGeometry(b.w + 0.1, 0.12, b.d + 0.1), trimMat, b.x, b.h, b.z, false);
      for (const sa of [-1, 1]) {
        for (const sl of [-0.33, 0.33]) {
          const wh = add(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 8), M.tire,
            along ? b.x + sa * W * 0.48 : b.x + sl * L, 0.5, along ? b.z + sl * L : b.z + sa * W * 0.48, false);
          wh.rotation[along ? 'z' : 'x'] = Math.PI / 2;
        }
      }
    },

    // ------------------------------------------------------------- disques
    // Minaret : fût octogonal, balcon, lanterne, coupole et flèche dorée.
    minaret(o) {
      const R = o.r, h1 = o.h * 0.68, h2 = o.h * 0.17;
      add(new THREE.CylinderGeometry(R * 1.25, R * 1.35, 1.2, 8), M.adobeDark, o.x, 0.6, o.z);
      add(new THREE.CylinderGeometry(R * 0.95, R, h1, 8), M.adobe[1], o.x, h1 / 2, o.z);
      add(new THREE.CylinderGeometry(R * 1.35, R * 0.95, 0.7, 8), M.adobeDark, o.x, h1 + 0.35, o.z);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(new THREE.BoxGeometry(0.25, 0.9, 0.25), M.adobeDark, o.x + Math.cos(a) * R * 1.25, h1 + 1.15, o.z + Math.sin(a) * R * 1.25, false);
      }
      add(new THREE.CylinderGeometry(R * 0.68, R * 0.72, h2, 8), M.adobe[0], o.x, h1 + 0.7 + h2 / 2, o.z);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
        add(new THREE.BoxGeometry(0.5, 1.2, 0.5), M.slit, o.x + Math.cos(a) * R * 0.62, h1 + 0.7 + h2 * 0.55, o.z + Math.sin(a) * R * 0.62, false);
      }
      const top = h1 + 0.7 + h2;
      add(new THREE.SphereGeometry(R * 0.78, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), snowy ? snowMat : M.dome, o.x, top, o.z);
      add(new THREE.CylinderGeometry(0.06, 0.12, 1.8, 5), M.gold, o.x, top + R * 0.78 + 0.8, o.z, false);
      add(new THREE.SphereGeometry(0.22, 6, 4), M.gold, o.x, top + R * 0.78 + 0.5, o.z, false);
    },

    // Carcasse de char calcinée : caisse, chenilles, tourelle de travers, canon tombant.
    hulk(o) {
      const r = rng(seedOf(o));
      const g = new THREE.Group();
      const part = (geo, m, x, y, z) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        return mesh;
      };
      part(new THREE.BoxGeometry(2.4, 0.9, 4.2), M.burnt, 0, 0.85, 0);
      for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.7, 0.85, 4.5), M.tire, s * 1.4, 0.45, 0);
      const turret = new THREE.Group();
      turret.position.set(0, 1.3, -0.3);
      turret.rotation.set((r() - 0.5) * 0.25, r() * 6, (r() - 0.5) * 0.3);
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 2), M.scorched);
      t1.position.y = 0.37;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.2, 6), M.burnt);
      barrel.rotation.x = Math.PI / 2 + 0.25 + r() * 0.2;
      barrel.position.set(0, 0.25, 2.3);
      for (const m of [t1, barrel]) m.castShadow = true;
      turret.add(t1, barrel);
      g.add(turret);
      g.position.set(o.x, -0.15, o.z); // un peu enfoncée dans le sable
      g.rotation.set((r() - 0.5) * 0.1, r() * 6, (r() - 0.5) * 0.12);
      group.add(g);
    },

    // Palmier : tronc incliné en segments, palmes retombantes.
    palm(o) {
      const r = rng(seedOf(o));
      const lean = r() * Math.PI * 2, tilt = 0.08 + r() * 0.1;
      let p = new THREE.Vector3(o.x, 0, o.z);
      for (let i = 0; i < 4; i++) {
        const q = p.clone().add(new THREE.Vector3(Math.cos(lean) * tilt * (i + 1) * 0.5, 1.6, Math.sin(lean) * tilt * (i + 1) * 0.5));
        beam(p, q, 0.32 - i * 0.04, M.palmTrunk);
        p = q;
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + r() * 0.4;
        const leaf = add(new THREE.BoxGeometry(3.2, 0.08, 0.7), M.palmLeaf, p.x + Math.cos(a) * 1.4, p.y - 0.35, p.z + Math.sin(a) * 1.4, false);
        leaf.rotation.set(0, -a, -0.45);
      }
      add(new THREE.SphereGeometry(0.45, 6, 4), M.palmTrunk, p.x, p.y, p.z, false);
    },

    // Colonne antique : fût, base, chapiteau (ou cassure si la colonne est tronquée).
    column(o) {
      const broken = o.h < 4.5;
      add(new THREE.BoxGeometry(2, 0.45, 2), M.sandstoneDark, o.x, 0.22, o.z);
      add(new THREE.CylinderGeometry(0.72, 0.85, o.h - (broken ? 0.45 : 0.9), 10), M.sandstone, o.x, 0.45 + (o.h - (broken ? 0.45 : 0.9)) / 2, o.z);
      if (!broken) add(new THREE.BoxGeometry(1.9, 0.45, 1.9), M.sandstoneDark, o.x, o.h - 0.22, o.z);
      else add(new THREE.CylinderGeometry(0.5, 0.72, 0.5, 6), M.sandstoneDark, o.x, o.h + 0.2, o.z, false).rotation.z = 0.35;
    },

    // Hérisson antichar : trois poutrelles croisées, plus bas que la ligne de tir.
    hedgehog(o) {
      const r = rng(seedOf(o));
      const g = new THREE.Group();
      for (const [rx, rz] of [[0.6, 0], [-0.6, 0], [0, 0.6]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.3, 0.22), M.steel);
        m.rotation.set(rx, 0, rz || (rx > 0 ? 0.9 : -0.9));
        m.castShadow = true;
        g.add(m);
      }
      g.position.set(o.x, 0.75, o.z);
      g.rotation.y = r() * 6;
      add(new THREE.CylinderGeometry(o.r * 0.9, o.r, 0.1, 6), snowy ? snowMat : M.shore, o.x, 0.05, o.z, false);
      group.add(g);
    },

    // ------------------------------------------------------------- à plat
    road(f) {
      add(new THREE.BoxGeometry(f.w, 0.03, f.d), f.color !== undefined ? mat(f.color) : M.road, f.x, 0.04, f.z, false);
      if (!f.dash) return;
      // ligne médiane en tirets le long du grand côté
      const along = f.w >= f.d, len = along ? f.w : f.d;
      for (let t = -len / 2 + 2; t < len / 2 - 1; t += 6) {
        add(new THREE.BoxGeometry(along ? 3 : 0.3, 0.02, along ? 0.3 : 3), M.dash, along ? f.x + t + 1.5 : f.x, 0.065, along ? f.z : f.z + t + 1.5, false);
      }
    },

    // Pont : tablier de planches, longerons, garde-corps sur les deux rives du passage.
    bridge(f) {
      const along = f.axis !== 'z'; // le tablier s'étend le long de X (traverse une rivière orientée en Z)
      const len = along ? f.w : f.d, wid = along ? f.d : f.w;
      const n = Math.round(len / 0.9);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (len * (i + 0.5)) / n;
        add(new THREE.BoxGeometry(along ? len / n - 0.08 : wid, 0.12, along ? wid : len / n - 0.08), i % 3 ? M.plank : M.plankDark,
          along ? f.x + t : f.x, 0.16, along ? f.z : f.z + t, false);
      }
      for (const s of [-1, 1]) {
        const ox = along ? 0 : s * (wid / 2 + 0.15), oz = along ? s * (wid / 2 + 0.15) : 0;
        add(new THREE.BoxGeometry(along ? len : 0.18, 0.16, along ? 0.18 : len), M.plankDark, f.x + ox, 1.05, f.z + oz, false);
        const posts = Math.round(len / 2);
        for (let i = 0; i <= posts; i++) {
          const t = -len / 2 + (len * i) / posts;
          add(new THREE.BoxGeometry(0.2, 1.1, 0.2), M.plankDark, along ? f.x + t : f.x + ox, 0.55, along ? f.z + oz : f.z + t, false);
        }
        if (snowy) add(new THREE.BoxGeometry(along ? len : 0.26, 0.08, along ? 0.26 : len), snowMat, f.x + ox, 1.17, f.z + oz, false);
      }
    },
  };
}
