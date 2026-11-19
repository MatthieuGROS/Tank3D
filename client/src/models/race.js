// Décor du mode course, construit à partir de map.race (shared/race.js) : ruban de piste, ligne de départ,
// points de passage, tremplins, tapis turbo, boue, rivière et ponton, portes coulissantes, barres mobiles, bumpers.
// Les formes suivent exactement les données de la simulation : ce qu'on voit est ce qui bloque, rampe ou ralentit.
import * as THREE from 'three';
import { groundAt } from '/shared/map.js';
import { gateInfo, sliderOffset } from '/shared/race.js';
import { buildVoidTrack } from './neon.js';

const C = (hex) => new THREE.Color(hex);

function canvasTexture(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Grille posée sur le sol dans un rectangle orienté { x, z, fx, fz, len, w } : y = relief + dy. UV : (v, u) normalisés.
function groundGrid(r, map, dy, nu = 6, nv = 3, lift = null) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = (i / nu - 0.5) * r.len, v = (j / nv - 0.5) * r.w;
      const x = r.x + u * r.fx - v * r.fz, z = r.z + u * r.fz + v * r.fx;
      pos.push(x, groundAt(x, z, map) + dy + (lift ? lift(i / nu) : 0), z);
      uv.push(j / nv, i / nu);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
      idx.push(a, b, c, b, d, c); // face visible vers le haut
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Ruban le long du circuit : lateral de a à b, y = relief + dy. `bands` : couleur par segment (fonction de l'indice).
function ribbon(track, map, a, b, dy, step, colorAt) {
  const pos = [], col = [], idx = [];
  const n = Math.floor(track.length / step);
  // plusieurs points en travers : sur un versant raide, une seule bande tendue d'un bord à l'autre flotterait au-dessus du terrain
  const cols = Math.max(1, Math.round((b - a) / 2)), row = cols + 1;
  for (let i = 0; i <= n; i++) {
    const p = track.at(i * step), c = colorAt(i);
    for (let j = 0; j <= cols; j++) {
      const lat = a + ((b - a) * j) / cols;
      const x = p.x - p.fz * lat, z = p.z + p.fx * lat;
      pos.push(x, groundAt(x, z, map) + dy, z);
      col.push(c.r, c.g, c.b);
    }
    if (i < n) {
      for (let j = 0; j < cols; j++) {
        const k = i * row + j;
        idx.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Segments (non indexés) pour des bandes régulières le long de la piste : bordures et tirets.
function stripes(track, map, lat0, lat1, from, to, period, duty, dy, colors) {
  const pos = [], col = [];
  let k = 0;
  for (let s = from; s + period * duty <= to; s += period, k++) {
    const c = colors[k % colors.length];
    const p0 = track.at(s), p1 = track.at(s + period * duty);
    const quad = [[p0, lat0], [p0, lat1], [p1, lat1], [p1, lat0]].map(([p, lat]) => {
      const x = p.x - p.fz * lat, z = p.z + p.fx * lat;
      return [x, groundAt(x, z, map) + dy, z];
    });
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...quad[i]);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRaceScenery({ map, theme, group, mat, add }) {
  const race = map.race, track = race.track, W = race.width;
  const yawOf = (r) => Math.atan2(r.fx, r.fz);
  const grp = new THREE.Group();
  group.add(grp);
  const live = []; // animations : { update(clock, time, next) }
  const neon = !!race.floor; // circuit au-dessus du vide : piste lumineuse (neon.js), obstacles aux couleurs néon

  // ---------------------------------------------------------------- piste
  if (neon) buildVoidTrack({ race, group: grp, live });
  if (!neon) {
    const asphalt = ribbon(track, map, -W / 2, W / 2, 0.1, 2, (i) => C(0x4b4e52).offsetHSL(0, 0, ((i * 7) % 5) * 0.004));
    const road = new THREE.Mesh(asphalt, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    road.receiveShadow = true;
    grp.add(road);
    const edges = stripes(track, map, -W / 2, -W / 2 + 0.9, 0, track.length, 4, 1, 0.14, [C(0xd8d4c4), C(0xc24a3a)]);
    const edges2 = stripes(track, map, W / 2 - 0.9, W / 2, 0, track.length, 4, 1, 0.14, [C(0xd8d4c4), C(0xc24a3a)]);
    const dashes = stripes(track, map, -0.25, 0.25, 0, track.length, 9, 0.38, 0.14, [C(0xe9d98a)]);
    const stripeMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const g of [edges, edges2, dashes]) {
      const m = new THREE.Mesh(g, stripeMat);
      m.receiveShadow = true;
      grp.add(m);
    }
  }

  // flèches de direction sur la piste
  const arrowTex = canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(240, 232, 190, 0.85)';
    g.beginPath();
    g.moveTo(w / 2, 6);
    g.lineTo(w - 8, h * 0.55);
    g.lineTo(w / 2 + 9, h * 0.55);
    g.lineTo(w / 2 + 9, h - 6);
    g.lineTo(w / 2 - 9, h - 6);
    g.lineTo(w / 2 - 9, h * 0.55);
    g.lineTo(8, h * 0.55);
    g.closePath();
    g.fill();
  }, false);
  const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const busy = [...race.ramps, ...race.pads, ...race.mud, ...race.water, ...race.gates, ...race.cps];
  for (let s = 20; s < track.length && !neon; s += 36) {
    const p = track.at(s);
    if (busy.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 24)) continue;
    const arrow = { x: p.x, z: p.z, fx: p.fx, fz: p.fz, len: 5.5, w: 4.5 };
    const m = new THREE.Mesh(groundGrid(arrow, map, 0.16, 2, 1), arrowMat);
    // l'UV monte avec u : la pointe de la flèche (haut du canevas) doit aller vers l'avant
    grp.add(m);
  }

  // ---------------------------------------------------------------- départ / arrivée
  const start = race.cps[0];
  const checker = canvasTexture(256, 32, (g, w, h) => {
    const n = 16;
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#101010' : '#f2f2f2';
      g.fillRect((i * w) / n, (j * h) / 2, w / n, h / 2);
    }
  });
  const line = new THREE.Mesh(groundGrid({ ...start, len: 3, w: W }, map, 0.17, 1, 8), new THREE.MeshBasicMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  grp.add(line);
  const gantry = new THREE.Group();
  const postMat = mat(0x3a3d42), bannerMat = new THREE.MeshLambertMaterial({ map: checker, emissive: 0x222222 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), postMat);
    post.position.set(side * (W / 2 + 1.4), 4.5, 0);
    post.castShadow = true;
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 4.4, 2.2, 0.8), bannerMat);
  beam.position.set(0, 8.2, 0);
  beam.castShadow = true;
  gantry.add(beam);
  gantry.position.set(start.x, groundAt(start.x, start.z, map), start.z);
  gantry.rotation.y = yawOf(start);
  grp.add(gantry);

  // ---------------------------------------------------------------- points de passage
  const cpMats = [], cps = [];
  race.cps.forEach((c, i) => {
    if (i === 0) return;
    const g = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color: neon ? 0x25e8ff : 0xf5b312, emissive: neon ? 0x0a6a7a : 0x6a4a00, flatShading: true });
    const plane = new THREE.MeshBasicMaterial({ color: 0x66ff9a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 6.5, 8), material);
      post.position.set(side * c.hw, 3.25, 0);
      post.castShadow = true;
      g.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), material);
      cap.position.set(side * c.hw, 6.8, 0);
      g.add(cap);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(c.hw * 2, 0.35, 0.35), material);
    bar.position.set(0, 6.4, 0);
    g.add(bar);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(c.hw * 2, 6.2), plane);
    sheet.position.set(0, 3.3, 0);
    g.add(sheet);
    g.position.set(c.x, groundAt(c.x, c.z, map), c.z);
    g.rotation.y = yawOf(c);
    grp.add(g);
    cps.push({ g, material, plane, i });
    cpMats.push(material);
  });

  // ---------------------------------------------------------------- tremplins
  const hazard = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = neon ? '#ff2f9e' : '#e8b21a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = neon ? '#150a20' : '#17150c';
    for (let k = -2; k < 6; k++) {
      g.beginPath();
      g.moveTo(k * 16, 0);
      g.lineTo(k * 16 + 8, 0);
      g.lineTo(k * 16 + 8 + h, h);
      g.lineTo(k * 16 + h, h);
      g.fill();
    }
  });
  const rampMat = new THREE.MeshLambertMaterial({ color: neon ? 0x2b3050 : 0x777b80, flatShading: true });
  for (const r of race.ramps) {
    const nu = Math.max(2, Math.round(r.len)), nv = 3;
    const top = groundGrid(r, map, 0.05, nu, nv, (f) => r.rise * f);
    const topMat = new THREE.MeshLambertMaterial({ map: hazard.clone(), flatShading: true, emissive: neon ? 0x40102c : 0x000000 });
    topMat.map.needsUpdate = true;
    topMat.map.repeat.set(Math.max(1, r.w / 5), Math.max(1, r.len / 3));
    const m = new THREE.Mesh(top, topMat);
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    // flancs et face avant : jupe verticale du dessus jusqu'au sol
    const pos = [];
    const corner = (u, v, f) => {
      const x = r.x + u * r.fx - v * r.fz, z = r.z + u * r.fz + v * r.fx, g0 = groundAt(x, z, map);
      return [x, g0 + 0.05 + r.rise * f, z, g0 - 0.3];
    };
    const edge = (a, b) => {
      for (let k = 0; k < 8; k++) {
        const p = [a[0] + (b[0] - a[0]) * (k / 8), a[1] + (b[1] - a[1]) * (k / 8), a[2] + (b[2] - a[2]) * (k / 8), a[3] + (b[3] - a[3]) * (k / 8)];
        const q = [a[0] + (b[0] - a[0]) * ((k + 1) / 8), a[1] + (b[1] - a[1]) * ((k + 1) / 8), a[2] + (b[2] - a[2]) * ((k + 1) / 8), a[3] + (b[3] - a[3]) * ((k + 1) / 8)];
        pos.push(p[0], p[1], p[2], p[0], p[3], p[2], q[0], q[1], q[2], q[0], q[1], q[2], p[0], p[3], p[2], q[0], q[3], q[2]);
      }
    };
    const A = corner(-r.len / 2, -r.w / 2, 0), B = corner(-r.len / 2, r.w / 2, 0), Cc = corner(r.len / 2, r.w / 2, 1), D = corner(r.len / 2, -r.w / 2, 1);
    edge(A, D);
    edge(B, Cc);
    edge(D, Cc);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.computeVertexNormals();
    const sides = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: neon ? 0x1c2038 : 0x6d7176, side: THREE.DoubleSide, flatShading: true }));
    sides.castShadow = true;
    grp.add(sides);
  }

  // ---------------------------------------------------------------- tapis turbo (chevrons qui défilent)
  const padTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#06222c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#37e6ff';
    g.lineWidth = 9;
    g.lineJoin = 'miter';
    for (let k = 0; k < 2; k++) {
      const y = k * 32 + 8;
      g.beginPath();
      g.moveTo(8, y + 22);
      g.lineTo(w / 2, y);
      g.lineTo(w - 8, y + 22);
      g.stroke();
    }
  });
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const r of race.pads) {
    padTex.repeat.set(1, r.len / 4);
    const m = new THREE.Mesh(groundGrid(r, map, 0.18, 5, 2), padMat);
    grp.add(m);
  }
  live.push({ update: (clock, time) => { padTex.offset.y = -(time * 1.6) % 1; } });

  // ---------------------------------------------------------------- boue
  const mudMat = new THREE.MeshLambertMaterial({ color: 0x5a432b, flatShading: true });
  for (const r of race.mud) {
    const nu = Math.round(r.len / 2), nv = Math.round(r.w / 2.5);
    const g = groundGrid(r, map, 0.12, nu, nv);
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + (((p.getX(i) * 12.9898 + p.getZ(i) * 78.233) % 1 + 1) % 1) * 0.3;
      col.push(0.27 * k, 0.19 * k, 0.12 * k);
      p.setY(i, p.getY(i) + (k - 0.85) * 0.12);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.receiveShadow = true;
    grp.add(m);
  }

  // ---------------------------------------------------------------- rivière et ponton
  const waterMat = new THREE.MeshLambertMaterial({ color: theme.water, transparent: true, opacity: 0.88, emissive: 0x0a2a3a });
  waterMat.polygonOffset = true;
  waterMat.polygonOffsetFactor = -4;
  waterMat.polygonOffsetUnits = -4;
  for (const r of race.water) {
    const m = new THREE.Mesh(groundGrid(r, map, 0.18, 2, 2), waterMat);
    m.receiveShadow = true;
    grp.add(m);
  }
  live.push({ update: (clock, time) => { waterMat.emissive.setRGB(0.04, 0.16 + 0.04 * Math.sin(time * 2), 0.22); waterMat.opacity = 0.86 + 0.04 * Math.sin(time * 1.3); } });
  // ponton : planches entre les deux plans d'eau (au décalage où les rectangles d'eau laissent un passage)
  for (const gate of race.gates) {
    if (gate.hw >= W / 2 || neon) continue;
    const deck = new THREE.Group();
    const len = 15;
    const planks = new THREE.Mesh(new THREE.BoxGeometry(gate.hw * 2 + 3.4, 0.3, len), mat(0x8a6a42));
    planks.position.set(0, 0.07, 0);
    planks.receiveShadow = true;
    deck.add(planks);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, len), mat(0x5a4328));
      rail.position.set(side * (gate.hw + 1.6), 1.0, 0);
      deck.add(rail);
    }
    deck.position.set(gate.x, groundAt(gate.x, gate.z, map), gate.z);
    deck.rotation.y = yawOf(gate);
    grp.add(deck);
  }

  // ---------------------------------------------------------------- portes coulissantes
  const gates = race.gates.map((g) => {
    const root = new THREE.Group();
    root.position.set(g.x, groundAt(g.x, g.z, map), g.z);
    root.rotation.y = yawOf(g);
    // néon : mur laser (translucide, lumineux) ; sinon barrière rayée
    const leafMat = neon
      ? new THREE.MeshBasicMaterial({ color: 0xff2d6a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ map: hazard.clone(), flatShading: true });
    if (!neon) {
      leafMat.map.needsUpdate = true;
      leafMat.map.repeat.set(2, 1);
      leafMat.map.rotation = Math.PI / 2;
    }
    const leaves = [-1, 1].map((side) => {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, g.h, g.thick), leafMat);
      leaf.castShadow = true;
      root.add(leaf);
      return { leaf, side };
    });
    const lights = [];
    for (const side of [-1, 1]) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, g.h + 1.6, 2.6), mat(neon ? 0x1c2036 : 0x34373b));
      housing.position.set(side * (g.hw + 1.3), (g.h + 1.6) / 2, 0);
      housing.castShadow = true;
      root.add(housing);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.5), new THREE.MeshBasicMaterial({ color: 0x40e060 }));
      lamp.position.set(side * (g.hw + 1.3), g.h + 2.1, 0);
      root.add(lamp);
      lights.push(lamp);
    }
    grp.add(root);
    return { g, leaves, lights };
  });
  live.push({
    update: (clock) => {
      for (const { g, leaves, lights } of gates) {
        const info = gateInfo(g, clock), e = 1 - info.o;
        for (const { leaf, side } of leaves) {
          leaf.visible = e > 0.02;
          leaf.scale.x = Math.max(0.001, e * g.hw);
          leaf.position.set(-side * (g.hw - (e * g.hw) / 2), g.h / 2, 0);
        }
        const warn = info.state === 'closing' || info.state === 'opening' || (info.state === 'open' && info.left < 72);
        const color = info.state === 'closed' ? 0xff3b2e : warn ? 0xffb020 : 0x40e060;
        for (const l of lights) l.material.color.setHex(color);
      }
    },
  });

  // ---------------------------------------------------------------- barres mobiles
  const sliders = race.sliders.map((s) => {
    const root = new THREE.Group();
    root.position.set(s.x, groundAt(s.x, s.z, map), s.z);
    root.rotation.y = yawOf(s);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(s.amp * 2 + s.len + 2, 0.25, 1.2), mat(0x34373b));
    rail.position.y = 0.2;
    root.add(rail);
    const bm = new THREE.MeshLambertMaterial({ map: hazard.clone(), flatShading: true });
    bm.map.needsUpdate = true;
    bm.map.repeat.set(2, 1);
    const block = new THREE.Mesh(new THREE.BoxGeometry(s.len, s.h, s.thick), bm);
    block.castShadow = true;
    root.add(block);
    grp.add(root);
    return { s, block };
  });
  live.push({
    update: (clock) => {
      for (const { s, block } of sliders) block.position.set(-sliderOffset(s, clock), s.h / 2, 0);
    },
  });

  // ---------------------------------------------------------------- bumpers
  const bumpers = race.bumpers.map((b) => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r * 1.15, 1.5, 16), mat(0x2d3034));
    base.position.y = 0.75;
    base.castShadow = true;
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xe4553f, emissive: 0x7a1f12 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.82, 0.32, 8, 20).rotateX(Math.PI / 2), ringMat);
    ring.position.y = 1.55;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.55, b.r * 0.7, 0.6, 14), new THREE.MeshLambertMaterial({ color: 0xf5b312, emissive: 0x7a5200 }));
    cap.position.y = 1.9;
    g.add(base, ring, cap);
    g.position.set(b.x, groundAt(b.x, b.z, map), b.z);
    grp.add(g);
    return { g, ringMat };
  });
  live.push({
    update: (clock, time) => {
      bumpers.forEach(({ g, ringMat }, i) => {
        const k = 1 + 0.05 * Math.sin(time * 5 + i);
        g.scale.set(k, 1, k);
        ringMat.emissive.setRGB(0.35 + 0.2 * Math.sin(time * 5 + i), 0.1, 0.06);
      });
    },
  });

  return {
    // Chaque image : horloge de course (ticks), temps (s), prochain point à franchir pour le joueur suivi (indice ou -1).
    update(clock, time, next = -1) {
      for (const a of live) a.update(clock, time);
      for (const c of cps) {
        const on = c.i === next;
        c.material.color.setHex(on ? 0x66ff9a : neon ? 0x25e8ff : 0xf5b312);
        c.material.emissive.setHex(on ? 0x1f8a46 : neon ? 0x0a6a7a : 0x6a4a00);
        c.plane.opacity = on ? 0.16 + 0.07 * Math.sin(time * 5) : 0;
      }
    },
  };
}
