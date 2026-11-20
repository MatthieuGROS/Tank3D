// Miniatures des équipements : des icônes vectorielles 64×64 (contour noir épais, une face claire et une face
// sombre), teintées selon le niveau : gris (I), or (II), bleu diamant (III). Une seule forme par équipement,
// seules les couleurs changent. Les couleurs de cadre et de pastille sont dans hub.css (.eq-ico.t1/.t2/.t3).
import { el, html } from './kit.js';

// b = face claire, d = face sombre, l = reflets, f = pièces intermédiaires
const TIER = [
  null,
  { b: '#9aa1a8', d: '#5d646b', l: '#d2d7db', f: '#6b737a' },
  { b: '#e2a929', d: '#9a6710', l: '#fbdc7a', f: '#c98f1c' },
  { b: '#46bdf2', d: '#1b6fae', l: '#c3f0ff', f: '#35a6dc' },
];
const O = '#14181b'; // contour

const pt = (cx, cy, r, a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
const f1 = (n) => n.toFixed(1);
const star = (cx, cy, ro, ri, n) => {
  const s = [];
  for (let i = 0; i < n * 2; i++) {
    const q = pt(cx, cy, i % 2 ? ri : ro, -90 + (i * 180) / n);
    s.push(`${f1(q[0])},${f1(q[1])}`);
  }
  return s.join(' ');
};
// Flèche courbe de rotation sur un cercle de rayon R, de l'angle a0 à a1 (degrés, sens horaire).
const arc = (a0, a1, R, p) => {
  const A = pt(32, 32, R, a0), B = pt(32, 32, R, a1), r = (a1 * Math.PI) / 180;
  const t = [-Math.sin(r), Math.cos(r)], n = [Math.cos(r), Math.sin(r)];
  const tip = [B[0] + t[0] * 8, B[1] + t[1] * 8], c1 = [B[0] + n[0] * 7, B[1] + n[1] * 7], c2 = [B[0] - n[0] * 7, B[1] - n[1] * 7];
  const d = `M${f1(A[0])} ${f1(A[1])}A${R} ${R} 0 0 1 ${f1(B[0])} ${f1(B[1])}`;
  return `<path d="${d}" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round"/>`
    + `<polygon points="${f1(tip[0])},${f1(tip[1])} ${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])}" fill="${p.l}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="${p.l}" stroke-width="4" stroke-linecap="round"/>`;
};

const ART = {
  culasse: (p) => `
    <rect x="3" y="26" width="19" height="12" rx="2" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <rect x="5" y="28.5" width="14" height="2.5" fill="${p.l}"/>
    <path d="M46 15 55 5" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
    <path d="M46 15 55 5" stroke="${p.d}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="56" cy="5.5" r="4" fill="${p.l}" stroke="${O}" stroke-width="2.5"/>
    <rect x="19" y="14" width="32" height="38" rx="4" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <path d="M19 40H51V48a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4Z" fill="${p.d}"/>
    <rect x="19" y="14" width="32" height="38" rx="4" fill="none" stroke="${O}" stroke-width="2.5"/>
    <circle cx="35" cy="30" r="10" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="35" cy="30" r="5" fill="${p.l}" stroke="${O}" stroke-width="2"/>
    <circle cx="24" cy="19" r="1.8" fill="${p.l}"/><circle cx="46" cy="19" r="1.8" fill="${p.l}"/><circle cx="24" cy="46" r="1.8" fill="${p.l}"/><circle cx="46" cy="46" r="1.8" fill="${p.l}"/>`,
  chargeur: (p) => {
    let h = `<circle cx="32" cy="32" r="27" fill="${p.b}" stroke="${O}" stroke-width="2.5"/><path d="M32 5a27 27 0 0 1 0 54Z" fill="${p.d}"/><circle cx="32" cy="32" r="27" fill="none" stroke="${O}" stroke-width="2.5"/>`;
    for (let i = 0; i < 6; i++) {
      const q = pt(32, 32, 16, i * 60 - 90);
      h += `<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="6" fill="${i === 0 ? p.l : O}" stroke="${O}" stroke-width="2"/>`;
      if (i) h += `<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="2.5" fill="${p.f}"/>`;
    }
    return `${h}<circle cx="32" cy="32" r="5" fill="${p.l}" stroke="${O}" stroke-width="2"/>`;
  },
  telemetre: (p) => `
    <path d="M32 3V13M32 51V61M3 32H13M51 32H61" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
    <path d="M32 3V13M32 51V61M3 32H13M51 32H61" stroke="${p.l}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="21" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <path d="M32 11a21 21 0 0 1 0 42Z" fill="${p.d}"/>
    <circle cx="32" cy="32" r="21" fill="none" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="12" fill="${O}"/><circle cx="32" cy="32" r="12" fill="none" stroke="${p.l}" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="3.5" fill="${p.l}"/>`,
  viseur: (p) => `
    <rect x="16" y="38" width="14" height="10" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <rect x="10" y="48" width="26" height="6" rx="1.5" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <rect x="4" y="24" width="8" height="16" rx="2" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <rect x="10" y="22" width="36" height="20" rx="4" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <path d="M10 33H46V38a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="${p.d}"/>
    <rect x="10" y="22" width="36" height="20" rx="4" fill="none" stroke="${O}" stroke-width="2.5"/>
    <path d="M46 17 58 13V51L46 47Z" fill="${p.d}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="58" cy="32" rx="3.5" ry="18" fill="${p.l}" stroke="${O}" stroke-width="2.5"/>
    <rect x="17" y="25" width="22" height="3" rx="1.5" fill="${p.l}"/>`,
  aero: (p) => `
    <path d="M3 18H19M1 32H8M3 46H19" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
    <path d="M3 18H19M1 32H8M3 46H19" stroke="${p.l}" stroke-width="4" stroke-linecap="round"/>
    <path d="M14 22H36C47 22 56 27 61 32 56 37 47 42 36 42H14Z" fill="${p.b}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M14 32H61C56 37 47 42 36 42H14Z" fill="${p.d}"/>
    <rect x="25" y="22" width="5" height="20" fill="${p.d}" stroke="${O}" stroke-width="2"/>
    <rect x="10" y="22" width="5" height="20" rx="1.5" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <path d="M33 26H46" stroke="${p.l}" stroke-width="3" stroke-linecap="round"/>
    <path d="M14 22H36C47 22 56 27 61 32 56 37 47 42 36 42H14Z" fill="none" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>`,
  explosive: (p) => `
    <polygon points="${star(32, 32, 29, 17, 9)}" fill="${p.b}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <polygon points="${star(32, 32, 18, 10, 9)}" fill="${p.d}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="32" cy="32" r="6.5" fill="${p.l}" stroke="${O}" stroke-width="2.5"/>`,
  blindage: (p) => `
    <path d="M32 5 54 13v19c0 12-10 22-22 27C20 54 10 44 10 32V13Z" fill="${p.b}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M32 5 54 13v19c0 12-10 22-22 27Z" fill="${p.d}"/>
    <path d="M32 12 47 17.5V32c0 8.5-6.5 15.5-15 19.5C23.5 47.5 17 40.5 17 32V17.5Z" fill="none" stroke="${p.l}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M22 30h20" stroke="${O}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M22 36h20" stroke="${p.l}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="22" cy="21" r="2" fill="${p.l}"/><circle cx="42" cy="21" r="2" fill="${p.l}"/>
    <path d="M32 5 54 13v19c0 12-10 22-22 27C20 54 10 44 10 32V13Z" fill="none" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>`,
  plaque: (p) => `
    <rect x="6" y="8" width="12" height="44" rx="3" fill="${p.f}" stroke="${O}" stroke-width="2.5"/>
    <rect x="46" y="8" width="12" height="44" rx="3" fill="${p.f}" stroke="${O}" stroke-width="2.5"/>
    <rect x="16" y="10" width="32" height="42" rx="4" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <rect x="29.5" y="3" width="5" height="18" rx="1.5" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="28" r="9" fill="${p.f}" stroke="${O}" stroke-width="2.5"/>
    <rect x="10" y="48" width="44" height="11" rx="2.5" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <rect x="12" y="50" width="40" height="3" fill="${p.l}"/>
    <circle cx="16" cy="55.5" r="1.8" fill="${p.l}"/><circle cx="32" cy="55.5" r="1.8" fill="${p.l}"/><circle cx="48" cy="55.5" r="1.8" fill="${p.l}"/>`,
  turbo: (p) => `
    <circle cx="32" cy="32" r="26" fill="none" stroke="${O}" stroke-width="9" stroke-dasharray="7.2 6.4"/>
    <circle cx="32" cy="32" r="26" fill="none" stroke="${p.d}" stroke-width="5" stroke-dasharray="7.2 6.4"/>
    <circle cx="32" cy="32" r="21" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <path d="M32 11a21 21 0 0 1 0 42Z" fill="${p.d}"/>
    <circle cx="32" cy="32" r="21" fill="none" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="32" r="14" fill="${p.f}" stroke="${O}" stroke-width="2"/>
    <path d="M36 18 25 34h7l-3 13 12-18h-7Z" fill="${p.l}" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>`,
  chenilles: (p) => `
    <rect x="4" y="14" width="56" height="26" rx="13" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <rect x="4" y="14" width="56" height="26" rx="13" fill="none" stroke="${p.l}" stroke-width="2.5" stroke-dasharray="3 4.5"/>
    <circle cx="17" cy="27" r="7" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="27" r="6" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="47" cy="27" r="7" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="17" cy="27" r="2" fill="${O}"/><circle cx="32" cy="27" r="2" fill="${O}"/><circle cx="47" cy="27" r="2" fill="${O}"/>
    <path d="M8 50H56" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
    <polygon points="4,50 13,44 13,56" fill="${p.l}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <polygon points="60,50 51,44 51,56" fill="${p.l}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M10 50H54" stroke="${p.l}" stroke-width="4"/>`,
  servo: (p) => `${arc(200, 310, 24, p)}${arc(20, 130, 24, p)}
    <rect x="29" y="14" width="6" height="18" rx="1.5" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="34" r="11" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <path d="M32 23a11 11 0 0 1 0 22Z" fill="${p.d}"/>
    <circle cx="32" cy="34" r="11" fill="none" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="34" r="3.5" fill="${p.l}"/>`,
  suspension: (p) => `
    <rect x="14" y="4" width="36" height="8" rx="2" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <polyline points="32,12 20,19 44,26 20,33 44,40 32,46" fill="none" stroke="${O}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="32,12 20,19 44,26 20,33 44,40 32,46" fill="none" stroke="${p.l}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>
    <rect x="26" y="44" width="12" height="6" fill="${p.d}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="55" r="7" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <circle cx="32" cy="55" r="2.5" fill="${O}"/>`,
  marche: (p) => `
    <circle cx="32" cy="32" r="27" fill="${p.b}" stroke="${O}" stroke-width="2.5"/>
    <path d="M32 5a27 27 0 0 1 0 54Z" fill="${p.d}"/>
    <circle cx="32" cy="32" r="27" fill="none" stroke="${O}" stroke-width="2.5"/>
    <polygon points="10,32 28,15 28,25 52,25 52,39 28,39 28,49" fill="${p.l}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>`,
};

// Marquage SVG d'une icône d'équipement au niveau voulu (1..3).
export const equipIcon = (id, level = 1) => `<svg viewBox="0 0 64 64" aria-hidden="true">${ART[id]?.(TIER[level] ?? TIER[1]) ?? ''}</svg>`;

// Vignette : icône dans un cadre teinté par le niveau, pastille du niveau en coin (I / II / III).
const ROMAN = ['', 'I', 'II', 'III'];
export function equipTile(id, level = 1, cls = '') {
  const t = el('div', `eq-ico t${level}${cls ? ` ${cls}` : ''}`);
  t.append(html(equipIcon(id, level)), el('span', 'lv', ROMAN[level]));
  return t;
}
