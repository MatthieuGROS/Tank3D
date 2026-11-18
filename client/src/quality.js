// Réglages graphiques : préréglages, FPS max, résolution dynamique, panneau de configuration (F2).
// Les réglages sont enregistrés dans le navigateur (localStorage) ; le renderer s'abonne via onChange().

const KEY = 'tank3d.gfx.v2';

// Chaque préréglage décrit tous les réglages ; « custom » = réglages modifiés à la main.
export const PRESETS = {
  low:    { renderScale: 0.7,  shadows: 0, aa: false, ao: false, grade: false, bloom: false, reflections: false, detail: false, viewDist: 0.6, effects: 0.4, fpsCap: 60 },
  medium: { renderScale: 0.9,  shadows: 1, aa: false, ao: false, grade: false, bloom: false, reflections: true,  detail: true,  viewDist: 0.8, effects: 0.7, fpsCap: 60 },
  high:   { renderScale: 1,    shadows: 2, aa: true,  ao: false, grade: true,  bloom: true,  reflections: true,  detail: true,  viewDist: 1,   effects: 1,   fpsCap: 60 },
  ultra:  { renderScale: 1.25, shadows: 3, aa: true,  ao: true,  grade: true,  bloom: true,  reflections: true,  detail: true,  viewDist: 1.25, effects: 1,  fpsCap: 0 },
  real:   { renderScale: 1.5,  shadows: 3, aa: true,  ao: true,  grade: true,  bloom: true,  reflections: true,  detail: true,  viewDist: 1.5,  effects: 1,  fpsCap: 0, autoRes: false },
};
const PRESET_LABELS = { low: 'Économique', medium: 'Équilibré', high: 'Élevé', ultra: 'Ultra', real: 'Réaliste (PC puissant)' };
const SHADOW_LABELS = ['Désactivées', 'Basses', 'Moyennes', 'Hautes'];
const FPS_CHOICES = [30, 45, 60, 75, 90, 120, 144, 0];

const DEFAULTS = { preset: 'medium', ...PRESETS.medium, autoRes: true, showFps: false };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULTS, ...raw };
  } catch { /* stockage indisponible */ }
  return { ...DEFAULTS };
}

export const Q = {
  s: load(),
  dynScale: 1, // facteur de résolution dynamique (0.6..1), calculé par la mesure des FPS
  listeners: [],
  fps: 0,
  frameMs: 0,
  onChange(fn) { this.listeners.push(fn); },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* ignore */ } },
  set(patch, { custom = true } = {}) {
    Object.assign(this.s, patch);
    if (custom && !('preset' in patch)) this.s.preset = 'custom';
    this.save();
    this.dynScale = 1;
    for (const fn of this.listeners) fn(this.s);
    syncPanel();
  },
  applyPreset(name) {
    if (!PRESETS[name]) return;
    this.set({ preset: name, ...PRESETS[name] }, { custom: false });
  },

  // ---- limiteur de FPS : renvoie faux si la frame doit être sautée
  _lastRun: 0,
  shouldRun(now) {
    const cap = this.s.fpsCap;
    if (cap > 0 && now - this._lastRun < 1000 / cap - 1.5) return false;
    this._lastRun = now;
    return true;
  },

  // ---- mesure des FPS + résolution dynamique (appelé à chaque frame rendue)
  _acc: 0, _n: 0, _slow: 0, _fast: 0,
  measure(dtSec) {
    this._acc += dtSec;
    this._n++;
    if (this._acc < 0.5) return;
    this.fps = this._n / this._acc;
    this.frameMs = (this._acc / this._n) * 1000;
    this._acc = 0;
    this._n = 0;
    if (fpsEl) fpsEl.textContent = `${Math.round(this.fps)} FPS · ${this.frameMs.toFixed(1)} ms${this.s.autoRes && this.dynScale < 0.99 ? ` · rés. ${Math.round(this.dynScale * 100)}%` : ''}`;
    if (!this.s.autoRes) return;
    const target = this.s.fpsCap > 0 ? Math.min(this.s.fpsCap, 60) : 60;
    // trop lent pendant 1,5 s : on baisse la résolution ; confortablement rapide pendant 4 s : on la remonte
    if (this.fps < target * 0.82) { this._slow++; this._fast = 0; }
    else if (this.fps > target * 0.97) { this._fast++; this._slow = 0; }
    else { this._slow = this._fast = 0; }
    let next = this.dynScale;
    if (this._slow >= 3) { next = Math.max(0.55, this.dynScale - 0.1); this._slow = 0; }
    if (this._fast >= 8 && this.dynScale < 1) { next = Math.min(1, this.dynScale + 0.05); this._fast = 0; }
    if (next !== this.dynScale) {
      this.dynScale = next;
      for (const fn of this.listeners) fn(this.s);
    }
  },
};

// ------------------------------------------------------------------ interface
let panel = null, fpsEl = null, btn = null;
const controls = {};

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function row(label, hint, control) {
  return el('div', { className: 'gfx-row' }, el('div', { className: 'gfx-lab' }, el('b', { textContent: label }), el('small', { textContent: hint })), control);
}

function select(key, options, parse = (v) => v) {
  const s = el('select');
  for (const [value, text] of options) s.append(el('option', { value: String(value), textContent: text }));
  s.addEventListener('change', () => Q.set({ [key]: parse(s.value) }));
  controls[key] = (v) => { s.value = String(v); };
  return s;
}

function toggle(key) {
  const c = el('input', { type: 'checkbox' });
  c.addEventListener('change', () => Q.set({ [key]: c.checked }));
  controls[key] = (v) => { c.checked = !!v; };
  return el('label', { className: 'gfx-switch' }, c, el('i'));
}

function slider(key, min, max, step, fmt) {
  const out = el('output');
  const r = el('input', { type: 'range', min, max, step });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); });
  r.addEventListener('change', () => Q.set({ [key]: +r.value }));
  controls[key] = (v) => { r.value = v; out.textContent = fmt(v); };
  return el('div', { className: 'gfx-slider' }, r, out);
}

function syncPanel() {
  if (!panel) return;
  for (const [k, fn] of Object.entries(controls)) fn(Q.s[k]);
  for (const b of panel.querySelectorAll('[data-preset]')) b.classList.toggle('on', b.dataset.preset === Q.s.preset);
  if (fpsEl) fpsEl.classList.toggle('hidden', !Q.s.showFps);
}

export function toggleGfxPanel(force) {
  if (!panel) return;
  const open = force ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !open);
  if (open) syncPanel();
}

function build() {
  fpsEl = el('div', { id: 'fps-counter', className: 'hidden' });

  const presets = el('div', { className: 'gfx-presets' });
  for (const name of Object.keys(PRESETS)) {
    const b = el('button', { className: 'btn', textContent: PRESET_LABELS[name] });
    b.dataset.preset = name;
    b.addEventListener('click', () => Q.applyPreset(name));
    presets.append(b);
  }

  const pct = (v) => `${Math.round(v * 100)} %`;
  const rows = [
    row('Limite de FPS', 'Plafonne les images par seconde (moins de chauffe, batterie)', select('fpsCap', FPS_CHOICES.map((f) => [f, f ? `${f} FPS` : 'Illimité']), Number)),
    row('Résolution de rendu', 'Le réglage le plus efficace pour gagner des FPS', slider('renderScale', 0.5, 1.5, 0.05, pct)),
    row('Résolution adaptative', 'Baisse la résolution automatiquement si le jeu rame', toggle('autoRes')),
    row('Ombres', 'Coûteuses : à baisser en premier sur un petit PC', select('shadows', SHADOW_LABELS.map((t, i) => [i, t]), Number)),
    row('Anti-crénelage (MSAA)', 'Lisse les bords. Recharge la page', toggle('aa')),
    row('Occlusion ambiante (AO)', 'Ombres de contact dans les creux : relief très marqué. Gourmand', toggle('ao')),
    row('Étalonnage cinéma', 'Contraste, teintes chaudes/froides, vignettage, grain', toggle('grade')),
    row('Éclat lumineux (bloom)', 'Halo sur les tirs, explosions et reflets du soleil', toggle('bloom')),
    row('Reflets réalistes', 'Le ciel se reflète sur la peinture et le métal', toggle('reflections')),
    row('Détail des surfaces', 'Rugosité, usure, poussière et relief sur les matériaux', toggle('detail')),
    row('Distance d’affichage', 'Brouillard et portée de la caméra', slider('viewDist', 0.5, 1.5, 0.05, pct)),
    row('Densité des effets', 'Fumée, poussière, étincelles, débris', slider('effects', 0.2, 1, 0.1, pct)),
    row('Compteur de FPS', 'Affiche les FPS en haut à gauche', toggle('showFps')),
  ];

  panel = el('section', { id: 'gfx-panel', className: 'screen overlay hidden' },
    el('div', { className: 'panel gfx' },
      el('div', { className: 'eyebrow', textContent: 'Options · touche F2' }),
      el('h2', { textContent: 'Graphismes' }),
      presets,
      el('div', { className: 'gfx-rows' }, ...rows),
      el('div', { className: 'gfx-foot' },
        el('small', { textContent: 'Les changements s’appliquent tout de suite (sauf l’anti-crénelage). Ils sont enregistrés sur ce PC.' }),
        el('button', { className: 'btn primary', textContent: 'Fermer', onclick: () => toggleGfxPanel(false) }))));
  panel.addEventListener('keydown', (e) => { if (e.key !== 'F2' && e.key !== 'Escape') e.stopPropagation(); });
  panel.addEventListener('mousedown', (e) => { if (e.target === panel) toggleGfxPanel(false); });

  // la case « anti-crénelage » demande un rechargement : on le propose sans l'imposer
  const aaCheck = panel.querySelector('.gfx-rows .gfx-row:nth-child(5) input');
  aaCheck?.addEventListener('change', () => {
    if (confirm('L’anti-crénelage demande de recharger la page (il faudra se reconnecter). Recharger maintenant ?')) location.reload();
  });

  btn = el('button', { id: 'gfx-btn', className: 'btn ghost', textContent: '⚙ Graphismes · F2', onclick: () => toggleGfxPanel() });
  document.body.append(panel, btn, fpsEl);

  addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); toggleGfxPanel(); }
    else if (e.key === 'Escape' && !panel.classList.contains('hidden')) { e.stopPropagation(); toggleGfxPanel(false); }
  }, true);
  syncPanel();
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', build);
else build();
