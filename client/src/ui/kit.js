// Petites briques d'interface partagées : création d'éléments, icônes, jauges de caractéristiques.
import { tankStats, tankAccuracy, FACE_DAMAGE } from '/shared/constants.js';

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Élément construit depuis un fragment de balisage (icônes SVG).
export function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR');
export const signed = (n) => `${n < 0 ? '−' : '+'}${fmtInt(Math.abs(n))}`;
export const fmtCoef = (n) => `×${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------- icônes
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" width="1em" height="1em" fill="currentColor" aria-hidden="true">${body}</svg>`;
export const ICON = {
  lock: svg('<path d="M7 10V8a5 5 0 0 1 10 0v2h1.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H7Zm2 0h6V8a3 3 0 0 0-6 0v2Zm3 4a1.6 1.6 0 0 0-.8 3v1.6h1.6V17a1.6 1.6 0 0 0-.8-3Z"/>'),
  coin: svg('<path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 2a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm-.9 3.2v1.2c-1.5.2-2.4 1.1-2.4 2.3 0 1.4 1.1 2 2.6 2.4 1 .3 1.4.5 1.4.9s-.4.7-1.2.7c-.9 0-1.5-.3-1.9-.9l-1.3.9c.5.8 1.3 1.3 2.4 1.5v1.1h1.6v-1.2c1.6-.2 2.5-1.1 2.5-2.4 0-1.3-1-1.9-2.6-2.3-1-.3-1.4-.5-1.4-.9 0-.4.4-.7 1.1-.7.7 0 1.2.2 1.6.7l1.2-.9c-.5-.6-1.2-1-2.1-1.2V7.7h-1.5Z"/>'),
  check: svg('<path d="m9.5 16.6-4.1-4.1-1.9 1.9 6 6L21 8.9 19.1 7z"/>'),
  copy: svg('<path d="M8 3h10a2 2 0 0 1 2 2v12h-2V5H8V3Zm-3 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>'),
  power: svg('<path d="M11 2h2v10h-2V2Zm-5 4.3 1.4 1.4a7 7 0 1 0 9.2 0L18 6.3A9 9 0 1 1 6 6.3Z"/>'),
  back: svg('<path d="m14.5 5-7 7 7 7 1.5-1.5-5.5-5.5L16 6.5 14.5 5Z"/>'),
  chevron: svg('<path d="m9.5 5 7 7-7 7L8 17.5l5.5-5.5L8 6.5 9.5 5Z"/>'),
  user: svg('<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z"/>'),
  garage: svg('<path d="M3 10.5 12 4l9 6.5V20h-2v-8H5v8H3v-9.5ZM7 14h10v2H7v-2Zm0 3h10v2H7v-2Z"/>'),
  map: svg('<path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V6l5-2Zm1 2.4v11.1l4 1.3V7.7l-4-1.3Z"/>'),
  cart: svg('<path d="M3 4h2.4l.5 2H21l-2 8H8l.4 2H19v2H6.7L4.3 6H3V4Zm6 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>'),
  skirmish: svg('<path d="M4 4h5l2 3 2-3h7v6l-3 2 3 2v6h-7l-2-3-2 3H4v-6l3-2-3-2V4Z"/>'),
  campaign: svg('<path d="M12 2 9.4 8.3 2.5 9l5.2 4.6L6 20.5l6-3.5 6 3.5-1.7-6.9L21.5 9l-6.9-.7L12 2Z"/>'),
  star: svg('<path d="M12 2 9.4 8.3 2.5 9l5.2 4.6L6 20.5l6-3.5 6 3.5-1.7-6.9L21.5 9l-6.9-.7L12 2Z"/>'),
  crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z"/>'),
  bot: svg('<path d="M11 2h2v2.1h3.5A2.5 2.5 0 0 1 19 6.6V9h1.5v4H19v3.4a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.4V13H3.5V9H5V6.6A2.5 2.5 0 0 1 7.5 4.1H11V2Zm-2.3 8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm6.6 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z"/>'),
  eye: svg('<path d="M12 5c5 0 8.7 3.6 10 7-1.3 3.4-5 7-10 7S3.3 15.4 2 12c1.3-3.4 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>'),
  x: svg('<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/>'),
};

// ------------------------------------------------- classes de chars
// Silhouettes de profil (vue de côté, canon vers la droite) pour reconnaître d'un coup d'œil le type de char.
const TRACKS = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
const CLASS_ART = {
  light: TRACKS(7, 16, 34, 5) + '<path d="M9 16 12 12.5H36L39 16Z"/><path d="M18 12.5 20 8H29L31 12.5Z"/><rect x="30" y="9" width="16" height="1.7"/>',
  medium: TRACKS(5, 15, 38, 6) + '<path d="M7 15 10 11H38L41 15Z"/><path d="M16 11 19 5.5H31L34 11Z"/><rect x="33" y="6.8" width="14" height="2.3"/>',
  heavy: TRACKS(3, 14, 42, 8) + '<path d="M5 14 8 9.5H40L43 14Z"/><path d="M12 9.5 16 3H32L36 9.5Z"/><rect x="34" y="4.4" width="14" height="3.4"/>',
  destroyer: TRACKS(5, 15, 38, 6) + '<path d="M6 15 8 9.5H29L42 13V15Z"/><rect x="26" y="9.4" width="21" height="2.2"/>',
  artillery: TRACKS(5, 15, 38, 6) + '<path d="M7 15 10 12H38L41 15Z"/><path d="M11 12 13 5H31L33 12Z"/><rect x="26" y="3" width="19" height="2.8" transform="rotate(-26 27 5)"/>',
};
export const CLASSES = {
  light: 'Léger', medium: 'Moyen', heavy: 'Lourd', destroyer: 'Chasseur', artillery: 'Artillerie',
};

// Classe d'un char, déduite de ses caractéristiques : un nouveau char est classé tout seul.
export function tankClass(def) {
  if (def.weapon === 'mortar') return 'artillery';
  if (def.traverse) return 'destroyer';
  return def.armor ?? 'medium';
}

export const classIcon = (kind) => html(`<svg class="cls-ico" viewBox="0 0 48 24" fill="currentColor" aria-hidden="true">${CLASS_ART[kind] ?? CLASS_ART.medium}</svg>`);

// Insigne de grade : chevrons empilés (un de plus à chaque grade), étoile pour le dernier.
export function rankBadge(index, max = 7) {
  const n = Math.min(index, 5);
  let body = '';
  for (let i = 0; i < n; i++) body += `<path d="M4 ${16 - i * 3.2} 12 ${10.5 - i * 3.2} 20 ${16 - i * 3.2} 20 ${13.4 - i * 3.2} 12 ${7.9 - i * 3.2} 4 ${13.4 - i * 3.2}Z" opacity="${0.55 + (i / Math.max(n, 1)) * 0.45}"/>`;
  if (!n) body = '<rect x="9" y="10" width="6" height="6" rx="1" transform="rotate(45 12 13)" opacity="0.7"/>';
  if (index >= max) body += '<path d="M12 1.5 13.4 4.6 16.8 5 14.3 7.3 15 10.6 12 8.9 9 10.6 9.7 7.3 7.2 5 10.6 4.6Z"/>';
  return html(`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`);
}

// ------------------------------------------------------- jauges
// Cinq jauges (blindage, puissance, cadence, vitesse, maniabilité) créées une seule fois puis mises à jour :
// le remplissage glisse d'un char à l'autre. Avec un char de référence, un repère montre où il se situe.
export class StatBars {
  constructor(container) {
    this.root = container;
    this.rows = null;
  }

  update(def, against = null) {
    const now = tankStats(def);
    const ref = against ? tankStats(against) : null;
    if (!this.rows) {
      this.rows = now.map(([label]) => {
        const row = el('div', 'stat');
        const fill = el('i', 'fill');
        const diff = el('i', 'diff');
        const mark = el('i', 'mark');
        const track = el('div', 'bar');
        track.append(diff, fill, mark);
        const name = el('span', 'stat-name', label);
        const val = el('span', 'stat-value');
        const delta = el('em', 'stat-delta');
        row.append(name, track, val, delta);
        this.root.append(row);
        return { row, fill, diff, mark, val, delta };
      });
    }
    now.forEach(([, value, text], i) => {
      const r = this.rows[i];
      const w = Math.min(1, value) * 100;
      r.fill.style.width = `${w}%`;
      r.val.textContent = text;
      if (ref) {
        const rw = Math.min(1, ref[i][1]) * 100;
        const d = w - rw;
        r.mark.style.display = '';
        r.mark.style.left = `${rw}%`;
        r.diff.style.left = `${Math.min(w, rw)}%`;
        r.diff.style.width = `${Math.abs(d)}%`;
        r.diff.className = `diff ${d >= 0 ? 'up' : 'down'}`;
        r.diff.style.display = Math.abs(d) < 0.5 ? 'none' : '';
        r.delta.textContent = Math.abs(d) < 0.5 ? '=' : `${d > 0 ? '▲' : '▼'}`;
        r.delta.className = `stat-delta ${Math.abs(d) < 0.5 ? '' : d > 0 ? 'up' : 'down'}`;
      } else {
        r.mark.style.display = 'none';
        r.diff.style.display = 'none';
        r.delta.textContent = '';
        r.delta.className = 'stat-delta';
      }
    });
  }
}

// Dégâts reçus selon la face touchée (coefficients de FACE_DAMAGE) : vert = protégé, rouge = vulnérable.
export function faceChips(def) {
  const row = def.face ?? (def.armor && FACE_DAMAGE[def.armor]);
  if (!row) return null;
  const wrap = el('div', 'faces');
  for (const [key, label] of [['front', 'Avant'], ['side', 'Flancs'], ['rear', 'Arrière']]) {
    const v = row[key];
    const chip = el('div', `face ${v < 1 ? 'good' : v > 1 ? 'bad' : ''}`);
    chip.append(el('small', '', label), el('b', '', fmtCoef(v)));
    wrap.append(chip);
  }
  return wrap;
}

// Détail de la précision (dispersion, temps de visée, malus de mouvement) : un volet replié par défaut,
// pour ne pas surcharger la fiche. Créé une fois, puis mis à jour (il garde son état ouvert / fermé).
export class AccuracyPanel {
  constructor(container) {
    this.root = el('details', 'acc');
    const head = el('summary');
    head.append(el('span', '', 'Détail de la précision'), html(ICON.chevron));
    this.list = el('div', 'acc-list');
    this.note = el('p', 'acc-note', 'Le cercle de visée se resserre quand le char est immobile et s’élargit en roulant, en pivotant ou en tournant la tourelle. Chaque tir l’élargit aussi.');
    this.root.append(head, this.list, this.note);
    container.append(this.root);
  }

  update(def) {
    const rows = tankAccuracy(def);
    this.root.classList.toggle('hidden', !rows);
    if (!rows) return;
    this.list.replaceChildren(...rows.map(([label, value, severity, hint]) => {
      const row = el('div', 'acc-row');
      row.title = hint;
      const meter = el('i', 'acc-meter');
      meter.style.setProperty('--v', severity);
      row.append(el('span', 'acc-name', label), el('b', 'acc-val', value), meter);
      return row;
    }));
  }
}

// Remet les enfants d'un conteneur dans l'ordre voulu sans les recréer (les images ne rechargent pas).
export function reorder(container, nodes) {
  nodes.forEach((n, i) => {
    if (container.children[i] !== n) container.insertBefore(n, container.children[i] ?? null);
  });
  while (container.children.length > nodes.length) container.lastElementChild.remove();
}
