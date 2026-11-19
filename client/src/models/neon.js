// Décor du circuit « Vertige Néon » (carte de course au-dessus du vide, race.floor) : ciel d'espace, planètes, mer de grille
// très loin en dessous, ruban de piste lumineux, dalles qui s'effacent, lanceurs, rotors, garde-fous holographiques.
// Les formes suivent les données de la simulation (shared/race.js) : ce qu'on voit est ce qui porte, bloque ou projette.
import * as THREE from 'three';
import { stripAt, blinkUp, spinnerAngle, solidAt, floorHeight } from '/shared/race.js';

const C = (hex) => new THREE.Color(hex);
const CYAN = 0x25e8ff, MAGENTA = 0xff2fb8, AMBER = 0xffb02e, VIOLET = 0x8a5cff;
const DECK_Y = 0.02; // dessus du sol de course : le char roule à y = 0

export function canvasTexture(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

// Couleur néon qui glisse du cyan au magenta le long du tour (deux fois par tour).
const hueAt = (s, L) => new THREE.Color().setHSL(0.5 + 0.34 * (0.5 + 0.5 * Math.sin((Math.PI * 4 * s) / L + 0.6)), 1, 0.56);

// Ruban : `samples` = [{ p (point de piste), s, link }], `rows` = lignes de sommets en travers { lat(sm), y(sm), color(sm), u(sm) }.
function ribbon(samples, rows, vScale = 6) {
  const pos = [], col = [], uv = [], idx = [];
  const R = rows.length;
  for (const sm of samples) {
    for (const row of rows) {
      const lat = row.lat(sm);
      pos.push(sm.p.x - sm.p.fz * lat, row.y(sm), sm.p.z + sm.p.fx * lat);
      const c = row.color ? row.color(sm) : { r: 1, g: 1, b: 1 };
      col.push(c.r, c.g, c.b);
      uv.push(row.u ? row.u(sm) : lat / 6, sm.s / vScale);
    }
  }
  for (let i = 0; i + 1 < samples.length; i++) {
    if (!samples[i].link) continue;
    for (let j = 0; j < R - 1; j++) {
      const k = i * R + j;
      idx.push(k, k + 1, k + R, k + 1, k + R + 1, k + R);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Bandes de piste privées des plages « creuses » (champ de dalles) : [[a, b], …]
function clipped(st, hollow) {
  let list = [[st.s0, st.s1]];
  for (const [ha, hb] of hollow) {
    list = list.flatMap(([a, b]) => (hb <= a || ha >= b ? [[a, b]] : [[a, Math.min(b, ha)], [Math.max(a, hb), b]].filter(([x, y]) => y - x > 0.5)));
  }
  return list;
}

// Dalle rectangulaire orientée (quai, tuile, plot) : boîte sombre + arête lumineuse. `r` = { x, z, fx, fz, len, w }.
function slab(r, thick, topY, bodyMat, edgeColor, edgeOpacity = 1, baseY = 0) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(r.w, thick, r.len), bodyMat);
  body.position.y = topY - thick / 2;
  body.receiveShadow = true;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(r.w, thick, r.len)),
    new THREE.LineBasicMaterial({ color: edgeColor, transparent: edgeOpacity < 1, opacity: edgeOpacity }),
  );
  edges.position.y = body.position.y;
  g.add(body, edges);
  g.position.set(r.x, baseY, r.z);
  g.rotation.y = Math.atan2(r.fx, r.fz);
  return { g, body, edges };
}

// ----------------------------------------------------------------------------- le monde autour du circuit
export function buildVoidWorld({ map, theme, group, live }) {
  const race = map.race, track = race.track, L = race.length;
  const rand = rng(90210);

  // Ciel : dôme dégradé (indigo en haut, lueur magenta à l'horizon, abîme bleu nuit en dessous)
  {
    const geo = new THREE.SphereGeometry(950, 32, 20);
    const pos = geo.attributes.position, cols = [];
    const top = C(0x050616), mid = C(0x2b0f45), glow = C(0x6a1b7a), low = C(0x04122a);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 950;
      const c = new THREE.Color();
      if (y > 0) c.copy(glow).lerp(mid, Math.min(1, y * 3.2)).lerp(top, Math.min(1, Math.max(0, y - 0.15) * 1.6));
      else c.copy(glow).lerp(low, Math.min(1, -y * 2.4));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    group.add(dome);
  }

  // Étoiles
  {
    const n = 2600, pos = [], col = [];
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, y = rand() * 2 - 1, r = Math.sqrt(1 - y * y), d = 900;
      pos.push(Math.cos(a) * r * d, y * d, Math.sin(a) * r * d);
      const k = 0.5 + rand() * 0.5, tint = rand();
      col.push(tint < 0.15 ? 0.5 * k : k, tint < 0.15 ? 0.9 * k : k, tint > 0.9 ? 0.6 * k : k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.1, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
    stars.renderOrder = -9;
    group.add(stars);
  }

  // Planètes : une géante à anneaux, une lune. Fausses (sans éclairage) : on ne s'en approche jamais.
  const planetTex = (seed, hues) => canvasTexture(512, 256, (g, w, h) => {
    const r = rng(seed);
    const grd = g.createLinearGradient(0, 0, 0, h);
    hues.forEach((c, i) => grd.addColorStop(i / (hues.length - 1), c));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,30'},${0.03 + r() * 0.06})`;
      g.fillRect(0, r() * h, w, 2 + r() * 14);
    }
  }, false);
  const planet = (x, y, z, radius, tex, ring) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    m.position.set(x, y, z);
    group.add(m);
    // voile atmosphérique
    const halo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.06, 32, 16), new THREE.MeshBasicMaterial({ color: 0x7aa8ff, transparent: true, opacity: 0.12, side: THREE.BackSide, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.copy(m.position);
    group.add(halo);
    if (ring) {
      const rg = new THREE.RingGeometry(radius * 1.35, radius * 2.15, 96, 1);
      const rtex = canvasTexture(256, 8, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, 0);
        for (const [t, a] of [[0, 0], [0.08, 0.5], [0.3, 0.2], [0.42, 0.6], [0.6, 0.15], [0.8, 0.5], [1, 0]]) grd.addColorStop(t, `rgba(220,200,255,${a})`);
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }, false);
      const uv = rg.attributes.uv, p = rg.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - radius * 1.35) / (radius * 0.8), 0.5);
      const rm = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: rtex, transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false }));
      rm.position.copy(m.position);
      rm.rotation.x = Math.PI / 2 - 0.42;
      rm.rotation.z = 0.35;
      group.add(rm);
    }
    return m;
  };
  planet(380, 190, -620, 170, planetTex(5, ['#3a2a7a', '#7a4fd0', '#e08ad0', '#5a3aa0', '#1d1450']), true);
  planet(-560, 120, 380, 70, planetTex(11, ['#e8d8b0', '#b9895a', '#7a5a45', '#d9b080']), false);
  planet(-120, 430, -700, 28, planetTex(23, ['#9fe8ff', '#4a9ad8', '#1d3a78']), false);

  // Mer de grille, très loin en dessous : donne la mesure de la chute
  const gridTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#04081a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(37, 232, 255, 0.55)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.strokeStyle = 'rgba(138, 92, 255, 0.28)';
    g.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
    }
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.9 }));
  gridTex.repeat.set(80, 80);
  sea.position.y = -105;
  group.add(sea);
  const sea2 = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: gridTex.clone(), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  sea2.material.map.needsUpdate = true;
  sea2.material.map.repeat.set(20, 20);
  sea2.position.y = -60;
  group.add(sea2);
  live.push({ update: (clock, time) => { sea2.material.map.offset.set((time * 0.012) % 1, (time * 0.02) % 1); } });

  // Monolithes flottants (hors de la piste) : arêtes lumineuses, lente rotation
  const mono = [];
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x141a30, flatShading: true });
  for (let i = 0, tries = 0; i < 46 && tries < 600; tries++) {
    const a = rand() * Math.PI * 2, d = 30 + rand() * 330;
    const x = Math.cos(a) * d * 1.15 - 10, z = Math.sin(a) * d * 0.95;
    const near = track.nearest(x, z);
    if (near.d < 38) continue;
    const y = -75 + rand() * 175, s = 4 + rand() * 12;
    const geo = rand() < 0.5 ? new THREE.BoxGeometry(s, s * (1 + rand() * 3), s) : new THREE.OctahedronGeometry(s * 0.9, 0);
    const m = new THREE.Mesh(geo, bodyMat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: hueAt(near.s, L) }));
    m.add(edges);
    m.position.set(x, y, z);
    m.rotation.set(rand() * 6, rand() * 6, rand() * 6);
    group.add(m);
    mono.push({ m, ax: (rand() - 0.5) * 0.3, ay: (rand() - 0.5) * 0.4, y0: y, ph: rand() * 6 });
    i++;
  }
  live.push({ update: (clock, time) => { for (const o of mono) { o.m.rotation.x = o.ax * time + o.ph; o.m.rotation.y = o.ay * time; o.m.position.y = o.y0 + Math.sin(time * 0.3 + o.ph) * 2; } } });

  // Colonnes de lumière à l'horizon
  const beamMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rand() * 0.3, d = 330 + rand() * 120;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 4, 520, 10, 1, true), beamMat(i % 2 ? MAGENTA : CYAN));
    m.position.set(Math.cos(a) * d, 150, Math.sin(a) * d * 0.9);
    group.add(m);
  }

  // Pylônes sous la piste : s'enfoncent dans la brume (ils donnent l'impression d'une structure immense)
  {
    const base = new THREE.CylinderGeometry(1.1, 2.4, 1, 6).translate(0, -0.5, 0); // longueur 1, mise à l'échelle selon l'altitude
    const spots = [];
    for (let s = 20; s < L; s += 52) {
      const spans = race.spansAt(s);
      if (!spans.length || race.hollow.some(([a, b]) => s > a - 4 && s < b + 4)) continue;
      const [lo, hi] = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const p = track.at(s), lat = (lo + hi) / 2;
      spots.push([p.x - p.fz * lat, p.z + p.fx * lat, race.elevAt(s)]);
    }
    const inst = new THREE.InstancedMesh(base, new THREE.MeshLambertMaterial({ color: 0x1a2038, flatShading: true }), spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3();
    spots.forEach(([x, z, h], i) => {
      m4.compose(one.set(x, h - 1.2, z), q, new THREE.Vector3(1, h + 75, 1)); // du dessous de la piste jusqu'à -75 (dans la brume)
      inst.setMatrixAt(i, m4);
    });
    group.add(inst);
  }
}

// ----------------------------------------------------------------------------- la piste, les dalles, les obstacles propres au vide
export function buildVoidTrack({ race, group, live }) {
  const track = race.track, L = race.length;
  const E = (sm) => race.elevAt(sm.s); // altitude de la piste sous un échantillon
  const gridTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#0d1428';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(70, 100, 160, 0.10)';
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
    g.strokeStyle = 'rgba(90, 150, 255, 0.35)';
    g.lineWidth = 3;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.strokeStyle = 'rgba(90, 150, 255, 0.14)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  const deckMat = new THREE.MeshLambertMaterial({ map: gridTex, vertexColors: false, color: 0xb8c4e8, side: THREE.DoubleSide });
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x0a0f20, side: THREE.DoubleSide });
  const glowCore = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const glowHalo = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const chevTex = canvasTexture(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(37, 232, 255, 0.9)';
    g.lineWidth = 7;
    g.lineJoin = 'miter';
    for (let k = 0; k < 2; k++) {
      const y = k * 64 + 10;
      g.beginPath(); g.moveTo(8, y + 30); g.lineTo(w / 2, y); g.lineTo(w - 8, y + 30); g.stroke();
    }
  });
  const flowMat = new THREE.MeshBasicMaterial({ map: chevTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  live.push({ update: (clock, time) => { chevTex.offset.y = -(time * 0.9) % 1; } });

  // ----- ruban de chaque bande
  const STEP = 1.5;
  race.strips.forEach((st, k) => {
    const dy = DECK_Y + k * 0.012; // les bandes qui se recouvrent (fourche) ne se disputent pas la profondeur
    for (const [a, b] of clipped(st, race.hollow)) {
      const n = Math.max(2, Math.ceil((b - a) / STEP));
      const samples = [];
      for (let i = 0; i <= n; i++) {
        const s = a + ((b - a) * i) / n, p = track.at(s), { off, w } = stripAt(st, s);
        samples.push({ p, s, off, w, link: i < n });
      }
      const lat = (f) => (sm) => sm.off + f * sm.w / 2;
      group.add(Object.assign(new THREE.Mesh(ribbon(samples, [
        { lat: lat(-1), y: (sm) => dy + E(sm), u: (sm) => (sm.off - sm.w / 2) / 6 },
        { lat: lat(1), y: (sm) => dy + E(sm), u: (sm) => (sm.off + sm.w / 2) / 6 },
      ]), deckMat), { receiveShadow: true }));
      // flèches qui défilent au centre des bandes assez larges
      if (st.w0 > 14 && st.w1 > 14) {
        group.add(new THREE.Mesh(ribbon(samples, [
          { lat: (sm) => sm.off - 2.4, y: (sm) => dy + E(sm) + 0.03, u: () => 0 },
          { lat: (sm) => sm.off + 2.4, y: (sm) => dy + E(sm) + 0.03, u: () => 1 },
        ], 8), flowMat));
      }
      // bords : jupe sombre, filet lumineux et halo (seulement là où il n'y a rien au-delà : pas de trait au milieu d'une fourche)
      for (const side of [-1, 1]) {
        const edge = (sm) => sm.off + side * sm.w / 2;
        const open = samples.map((sm) => {
          const lt = edge(sm) + side * 1.6;
          return !solidAt(race, sm.p.x - sm.p.fz * lt, sm.p.z + sm.p.fx * lt, 0);
        });
        const segs = samples.map((sm, i) => ({ ...sm, link: sm.link && open[i] && open[i + 1] }));
        const inward = -side;
        const color = (k2) => (sm) => hueAt(sm.s, L).multiplyScalar(k2);
        group.add(new THREE.Mesh(ribbon(segs, [
          { lat: (sm) => edge(sm) + inward * 0.62, y: (sm) => dy + E(sm) + 0.02, color: color(1.25) },
          { lat: (sm) => edge(sm) + inward * 0.12, y: (sm) => dy + E(sm) + 0.02, color: color(1.25) },
        ]), glowCore));
        group.add(new THREE.Mesh(ribbon(segs, [
          { lat: (sm) => edge(sm) + inward * 2.6, y: (sm) => dy + E(sm) + 0.02, color: color(0) },
          { lat: (sm) => edge(sm) + inward * 0.4, y: (sm) => dy + E(sm) + 0.02, color: color(0.5) },
          { lat: (sm) => edge(sm) - inward * 1.8, y: (sm) => dy + E(sm) + 0.02, color: color(0) },
        ]), glowHalo));
        group.add(new THREE.Mesh(ribbon(segs, [
          { lat: edge, y: (sm) => dy + E(sm), color: undefined },
          { lat: edge, y: (sm) => dy + E(sm) - 1.7 },
        ]), skirtMat));
        group.add(new THREE.Mesh(ribbon(segs, [
          { lat: edge, y: (sm) => dy + E(sm) - 0.9, color: color(1) },
          { lat: edge, y: (sm) => dy + E(sm) - 1.1, color: color(1) },
        ]), glowCore));
      }
    }
  });

  // ----- plateformes libres (quais) : dalles à arêtes lumineuses
  const slabMat = new THREE.MeshLambertMaterial({ map: gridTex, color: 0xb8c4e8 });
  for (const r of race.plates) {
    const m = slab(r, 1.6, DECK_Y + 0.05, slabMat, CYAN, 1, floorHeight(race, r.x, r.z));
    slabMat.map.repeat.set(1, 1);
    group.add(m.g);
  }

  // ----- dalles clignotantes
  const tileMat = new THREE.MeshLambertMaterial({ color: 0x3a3f7a, map: gridTex, emissive: 0x1a0a3a });
  const tiles = race.blinks.map((b, i) => {
    const by = floorHeight(race, b.x, b.z);
    const t = slab(b, 0.7, DECK_Y + 0.03, tileMat, MAGENTA, 1, by);
    const glowMat = new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 0.5, b.len - 0.5).rotateX(-Math.PI / 2), glowMat);
    glow.position.y = DECK_Y + 0.06;
    t.g.add(glow);
    group.add(t.g);
    // fantôme : le contour de la dalle reste visible quand elle est effacée, pour qu'on voie quand elle revient
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(b.w - 0.3, b.len - 0.3).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color: 0x7a2a8a, transparent: true, opacity: 0.45 }));
    ghost.position.set(b.x, by + DECK_Y + 0.05, b.z);
    ghost.rotation.y = Math.atan2(b.fx, b.fz);
    group.add(ghost);
    return { b, t, glowMat, ghost, i };
  });
  live.push({
    update: (clock, time) => {
      for (const { b, t, glowMat, ghost } of tiles) {
        const up = blinkUp(b, clock);
        t.g.visible = up;
        ghost.visible = !up;
        if (!up) continue;
        const left = b.up - ((((clock + b.phase) % b.period) + b.period) % b.period); // ticks avant de disparaître
        const warn = left < 36;
        glowMat.opacity = warn ? (Math.floor(time * 14) % 2 ? 0.9 : 0.1) : 0.34;
        glowMat.color.setHex(warn ? 0xff3b3b : MAGENTA);
        t.edges.material.color.setHex(warn ? 0xff3b3b : MAGENTA);
      }
    },
  });

  // ----- plots (chicanes)
  const blockMat = new THREE.MeshLambertMaterial({ color: 0x1b2140, flatShading: true });
  for (const b of race.blocks) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.len), blockMat);
    body.position.y = b.h / 2;
    body.castShadow = body.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: AMBER }));
    edges.position.y = b.h / 2;
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 0.6, b.len - 0.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    cap.position.y = b.h + 0.03;
    g.add(body, edges, cap);
    g.position.set(b.x, floorHeight(race, b.x, b.z), b.z);
    g.rotation.y = Math.atan2(b.fx, b.fz);
    group.add(g);
  }

  // ----- garde-fous holographiques
  {
    const samples = [];
    const panel = [], top = [];
    for (const r of race.rails) {
      const list = [];
      for (let s = r.s0; s <= r.s1 + 0.01; s += 2) {
        const ss = Math.min(s, r.s1), e = race.edgeAt(ss, r.side);
        const ok = Number.isFinite(e);
        const p = track.at(ss);
        list.push({ p, s: ss, off: ok ? e - r.side * 0.55 : 0, link: ok, ok });
        if (ss >= r.s1) break;
      }
      for (let i = 0; i < list.length; i++) list[i].link = list[i].ok && i + 1 < list.length && list[i + 1].ok;
      samples.push(list);
    }
    const panelMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const topMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (const list of samples) {
      const col = (k) => (sm) => hueAt(sm.s, L).multiplyScalar(k);
      group.add(new THREE.Mesh(ribbon(list, [
        { lat: (sm) => sm.off, y: (sm) => DECK_Y + E(sm), color: col(0.3) },
        { lat: (sm) => sm.off, y: (sm) => 1.3 + E(sm), color: col(1) },
      ]), panelMat));
      group.add(new THREE.Mesh(ribbon(list, [
        { lat: (sm) => sm.off - 0.22, y: (sm) => 1.3 + E(sm), color: col(1.3) },
        { lat: (sm) => sm.off + 0.22, y: (sm) => 1.3 + E(sm), color: col(1.3) },
      ]), topMat));
    }
  }

  // ----- lanceurs de gravité : plaque, anneaux qui montent, colonne de lumière
  const launchTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#220a2e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff4fd0';
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(8, h - 8); g.lineTo(w / 2, 14); g.lineTo(w - 8, h - 8); g.stroke();
  });
  const launchers = race.launch.map((r) => {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.35, Math.max(r.len, 3)), new THREE.MeshBasicMaterial({ map: launchTex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    launchTex.repeat.set(Math.max(1, r.w / 4), 1);
    plate.position.y = DECK_Y + 0.12;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(r.w, 8) * 0.5, Math.min(r.w, 8) * 0.5, 16, 24, 1, true), new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 8;
    const rings = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(Math.min(r.w, 8) * 0.5, 0.18, 6, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7ae0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(m);
      return m;
    });
    g.add(plate, beam);
    g.position.set(r.x, floorHeight(race, r.x, r.z), r.z);
    g.rotation.y = Math.atan2(r.fx, r.fz);
    group.add(g);
    return { rings, beam };
  });
  live.push({
    update: (clock, time) => {
      launchTex.offset.y = -(time * 1.4) % 1;
      for (const { rings, beam } of launchers) {
        beam.material.opacity = 0.1 + 0.05 * Math.sin(time * 6);
        rings.forEach((m, i) => {
          const k = (time * 1.1 + i / 3) % 1;
          m.position.y = 0.3 + k * 12;
          m.material.opacity = (1 - k) * 0.9;
          m.scale.setScalar(1 - k * 0.35);
        });
      }
    },
  });

  // ----- rotors
  const hazard = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#1a0a22';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff3d6e';
    for (let k = -2; k < 6; k++) {
      g.beginPath(); g.moveTo(k * 16, 0); g.lineTo(k * 16 + 8, 0); g.lineTo(k * 16 + 8 + h, h); g.lineTo(k * 16 + h, h); g.fill();
    }
  });
  const spinners = race.spinners.map((sp) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(sp.thick, sp.h, sp.len), new THREE.MeshLambertMaterial({ map: hazard.clone(), emissive: 0x551020, flatShading: true }));
    bar.material.map.needsUpdate = true;
    bar.material.map.repeat.set(1, sp.len / 6);
    bar.position.set(sp.x, floorHeight(race, sp.x, sp.z) + sp.h / 2 + 0.05, sp.z);
    bar.castShadow = true;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(sp.thick + 1.2, 0.5, sp.len), new THREE.MeshBasicMaterial({ color: 0xff3d6e, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = -sp.h / 2 + 0.2;
    bar.add(glow);
    group.add(bar);
    return { sp, bar };
  });
  live.push({ update: (clock) => { for (const { sp, bar } of spinners) bar.rotation.y = -spinnerAngle(sp, clock); } });
  // cœur d'énergie au centre des rotors
  const cores = new Set();
  for (const sp of race.spinners) {
    const key = `${sp.x},${sp.z}`;
    if (cores.has(key)) continue;
    cores.add(key);
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 120, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    core.position.y = 34;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 120, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    inner.position.y = 34;
    const rings = [0, 1, 2, 3].map((i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.22, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7af8ff }));
      m.position.y = 2 + i * 3.6;
      g.add(m);
      return m;
    });
    g.add(core, inner);
    g.position.set(sp.x, floorHeight(race, sp.x, sp.z), sp.z);
    group.add(g);
    live.push({
      update: (clock, time) => {
        core.material.opacity = 0.32 + 0.1 * Math.sin(time * 5);
        rings.forEach((m, i) => { m.position.y = 2 + ((time * 2.5 + i * 3.6) % 14.4); m.scale.setScalar(1 + 0.25 * Math.sin(time * 4 + i)); });
      },
    });
  }
}
