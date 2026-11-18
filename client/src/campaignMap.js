// Carte de la campagne : les 12 missions sur un théâtre d'opérations (prairie, désert, neige),
// reliées par la route de l'escouade. Chaque mission affiche ses étoiles : une par niveau de
// difficulté réussi (★ Recrue, ★★ Vétéran, ★★★ Élite).
import { MISSIONS, CHAPTERS } from '/shared/campaign.js';
import { DIFFICULTIES, UNIT_TYPES } from '/shared/constants.js';

const NS = 'http://www.w3.org/2000/svg';
const ROMAN = ['I', 'II', 'III'];

// Position de chaque mission sur la carte (viewBox 1200 × 640).
const SPOTS = {
  m1: [95, 520], m2: [215, 420], m3: [120, 290], m4: [270, 165],
  m5: [470, 210], m6: [545, 395], m7: [670, 520], m8: [720, 285],
  m9: [880, 170], m10: [955, 375], m11: [1075, 500], m12: [1110, 245],
};

// Chaque chapitre : une bande de terrain, avec sa teinte.
const REGIONS = [
  { x0: 0, x1: 400, fill: '#26331d', light: '#31422a', label: '#9fbf7a' },
  { x0: 400, x1: 800, fill: '#3d3322', light: '#4c3f29', label: '#e0b872' },
  { x0: 800, x1: 1200, fill: '#2a333b', light: '#3a4651', label: '#b8d4ea' },
];

function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}

// Bruit déterministe : la carte est la même à chaque ouverture.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Courbe lisse passant par tous les points (Catmull-Rom -> Bézier).
function smoothPath(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Frontière ondulée entre deux chapitres.
function border(x) {
  const pts = [];
  for (let y = 0; y <= 640; y += 40) pts.push([x + Math.sin(y * 0.021 + x) * 16, y]);
  return pts;
}

// Fond de carte (dessiné une seule fois).
function drawTerrain(root) {
  const r = rng(7);
  const defs = svg('defs', {}, root);
  const grid = svg('pattern', { id: 'cm-grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' }, defs);
  svg('path', { d: 'M50 0H0V50', fill: 'none', stroke: 'rgba(233,229,211,0.06)', 'stroke-width': 1 }, grid);
  const glow = svg('radialGradient', { id: 'cm-glow' }, defs);
  svg('stop', { offset: '0', 'stop-color': '#f5b312', 'stop-opacity': 0.55 }, glow);
  svg('stop', { offset: '1', 'stop-color': '#f5b312', 'stop-opacity': 0 }, glow);

  // bandes de terrain
  const b1 = border(400), b2 = border(800);
  const band = (left, right, fill) => {
    const pts = [...(left ?? [[0, 0], [0, 640]]), ...[...(right ?? [[1200, 0], [1200, 640]])].reverse()];
    svg('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill }, root);
  };
  band(null, b1, REGIONS[0].fill);
  band(b1, b2, REGIONS[1].fill);
  band(b2, null, REGIONS[2].fill);

  // prairie : bosquets
  for (let i = 0; i < 70; i++) {
    const x = 15 + r() * 360, y = 15 + r() * 610;
    svg('circle', { cx: x, cy: y, r: 5 + r() * 9, fill: r() < 0.5 ? '#1f2b17' : '#2f3f24' }, root);
  }
  // prairie : rivière
  svg('path', { d: 'M0,380 C80,360 140,400 190,330 S300,250 405,280', fill: 'none', stroke: '#2f4a55', 'stroke-width': 7, 'stroke-linecap': 'round' }, root);

  // désert : dunes
  for (let i = 0; i < 42; i++) {
    const x = 420 + r() * 360, y = 25 + r() * 600, w = 20 + r() * 34;
    svg('path', { d: `M${x - w},${y} Q${x},${y - w * 0.45} ${x + w},${y}`, fill: 'none', stroke: r() < 0.5 ? '#59492e' : '#2f2718', 'stroke-width': 3 }, root);
  }
  // désert : oasis et pipeline
  svg('ellipse', { cx: 610, cy: 300, rx: 32, ry: 18, fill: '#2b4a4f' }, root);
  for (let i = 0; i < 6; i++) svg('circle', { cx: 590 + r() * 40, cy: 280 + r() * 40, r: 4, fill: '#344a22' }, root);
  svg('path', { d: 'M420,120 L560,140 L640,95 L790,115', fill: 'none', stroke: '#6d5f48', 'stroke-width': 4, 'stroke-dasharray': '14 4' }, root);

  // neige : montagnes, fleuve, ponts
  for (let i = 0; i < 26; i++) {
    const x = 820 + r() * 360, y = 30 + r() * 590, s = 14 + r() * 22;
    svg('polygon', { points: `${x - s},${y + s * 0.6} ${x},${y - s * 0.7} ${x + s},${y + s * 0.6}`, fill: '#3c4853' }, root);
    svg('polygon', { points: `${x - s * 0.3},${y - s * 0.28} ${x},${y - s * 0.7} ${x + s * 0.3},${y - s * 0.28}`, fill: '#b7c7d4', opacity: 0.8 }, root);
  }
  svg('path', { d: 'M1010,0 C990,120 1040,200 1010,320 S990,520 1030,640', fill: 'none', stroke: '#35576b', 'stroke-width': 12 }, root);
  for (const y of [110, 300, 470]) svg('rect', { x: 990, y, width: 50, height: 9, fill: '#6d6152' }, root);

  svg('rect', { width: 1200, height: 640, fill: 'url(#cm-grid)' }, root);
  svg('rect', { x: 1, y: 1, width: 1198, height: 638, class: 'cm-frame' }, root);

  // noms des chapitres
  CHAPTERS.forEach((name, i) => {
    const reg = REGIONS[i];
    const t = svg('text', { x: (reg.x0 + reg.x1) / 2, y: 40, 'text-anchor': 'middle', class: 'cm-chapter', fill: reg.label }, root);
    t.textContent = `${ROMAN[i]} · ${name}`;
  });
}

// Étoile à 5 branches centrée en (x, y).
function starPoints(x, y, R, r = R * 0.45) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r : R;
    pts.push(`${(x + Math.cos(a) * d).toFixed(1)},${(y + Math.sin(a) * d).toFixed(1)}`);
  }
  return pts.join(' ');
}

export class CampaignMap {
  constructor(svgEl, onFocus) {
    this.svg = svgEl;
    this.onFocus = onFocus;
    drawTerrain(svgEl);
    this.layer = svg('g', {}, svgEl);
  }

  // cleared = mes étoiles ; unlocked = missions ouvertes à l'escouade ;
  // selected = mission choisie par l'hôte ; focus = mission affichée dans le panneau.
  render({ cleared, unlocked, selected, focus }) {
    const g = this.layer;
    g.replaceChildren();
    const pts = MISSIONS.map((m) => SPOTS[m.id]);
    // la route : pleine jusqu'à la dernière mission ouverte, pointillée ensuite
    const lastOpen = MISSIONS.reduce((n, m, i) => (unlocked.includes(m.id) ? i : n), 0);
    svg('path', { d: smoothPath(pts), class: 'cm-route' }, g);
    if (lastOpen > 0) svg('path', { d: smoothPath(pts.slice(0, lastOpen + 1)), class: 'cm-route done' }, g);

    MISSIONS.forEach((m, i) => {
      const [x, y] = SPOTS[m.id];
      const open = unlocked.includes(m.id);
      const stars = cleared[m.id] ?? 0;
      const node = svg('g', {
        class: `cm-node${open ? '' : ' locked'}${m.id === focus ? ' focus' : ''}${m.id === selected ? ' selected' : ''}${m.boss ? ' boss' : ''}${stars ? ' cleared' : ''}`,
        transform: `translate(${x},${y})`, tabindex: 0, role: 'button', 'aria-label': `${m.name}, ${open ? `${stars} étoile${stars > 1 ? 's' : ''}` : 'verrouillée'}`,
      }, g);
      const R = m.boss ? 25 : 19;
      if (m.id === selected) svg('circle', { r: R + 26, fill: 'url(#cm-glow)', class: 'cm-pulse' }, node);
      svg('circle', { r: R + 12, class: 'cm-hit' }, node); // zone cliquable plus large
      if (m.boss) svg('polygon', { points: `0,${-R - 6} ${R + 6},0 0,${R + 6} ${-R - 6},0`, class: 'cm-ring' }, node);
      else svg('circle', { r: R + 4, class: 'cm-ring' }, node);
      svg('circle', { r: R, class: 'cm-disc' }, node);
      if (open) {
        const n = svg('text', { y: 6, 'text-anchor': 'middle', class: 'cm-num' }, node);
        n.textContent = String(i + 1);
      } else {
        // cadenas
        svg('path', { d: 'M-6,-2 v-5 a6,6 0 0 1 12,0 v5', class: 'cm-lock', fill: 'none' }, node);
        svg('rect', { x: -9, y: -2, width: 18, height: 13, rx: 2, class: 'cm-lockbody' }, node);
      }
      // trois étoiles au-dessus du pion
      for (let k = 0; k < 3; k++) {
        svg('polygon', { points: starPoints((k - 1) * 17, -R - 17 - (k === 1 ? 5 : 0), 8), class: `cm-star${k < stars ? ' on' : ''}` }, node);
      }
      const label = svg('text', { y: R + 22, 'text-anchor': 'middle', class: 'cm-label' }, node);
      label.textContent = m.name;
      if (m.boss) {
        const b = svg('text', { y: R + 37, 'text-anchor': 'middle', class: 'cm-bosslabel' }, node);
        b.textContent = `BOSS · ${UNIT_TYPES[m.boss].name}`;
      }
      const pickIt = () => this.onFocus(m.id);
      node.addEventListener('click', pickIt);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickIt();
        }
      });
    });
  }
}

// Détail d'une mission dans le panneau latéral : étoiles obtenues par difficulté.
export function difficultyRows(stars) {
  return Object.entries(DIFFICULTIES).map(([key, d]) => ({ key, name: d.name, need: d.stars, done: stars >= d.stars }));
}

export { ROMAN };
