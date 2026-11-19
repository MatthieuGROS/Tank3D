// Commandes tactiles : joystick de conduite (gauche), joystick de tourelle (droite) + bouton de tir et
// quelques boutons d'action. Les joysticks sont « flottants » : ils apparaissent là où le pouce se pose.
//
// - Conduite et tourelle sont analogiques (le serveur accepte -1..1) : elles passent par input.touch.
// - Les actions ponctuelles (carte, signalement, chat, scores, retour en piste, changer de joueur observé…)
//   réutilisent les raccourcis clavier existants en émettant des événements clavier synthétiques :
//   aucune logique dupliquée dans main.js.
//
// Les commandes s'activent si l'écran principal est tactile (pointer: coarse), avec ?touch=1, ou dès le premier
// appui tactile (ordinateur à écran tactile). ?touch=0 les désactive.

const DEAD = 0.14; // zone morte du joystick (fraction du rayon)
const RADIUS = 58; // rayon de course du pouce (px)

const params = new URLSearchParams(location.search);
const forced = params.get('touch');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const shape = (v) => {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  const n = (a - DEAD) / (1 - DEAD);
  return Math.sign(v) * n * n * (3 - 2 * n) * 0.35 + Math.sign(v) * n * 0.65; // courbe douce, pleine course en bout
};

function key(type, code, k = code) {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true }));
}

// Joystick flottant sur une zone. onMove reçoit (x, y) dans -1..1 (y vers le bas), ou (0, 0) au relâchement.
class Stick {
  constructor(zone, onMove) {
    this.zone = zone;
    this.onMove = onMove;
    this.id = null;
    this.base = zone.querySelector('.ts-base');
    this.knob = zone.querySelector('.ts-knob');
    zone.addEventListener('pointerdown', (e) => this.down(e));
    zone.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(t, (e) => this.up(e));
  }

  down(e) {
    if (this.id !== null || e.target.closest('button')) return;
    this.id = e.pointerId;
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    const r = this.zone.getBoundingClientRect();
    this.cx = e.clientX;
    this.cy = e.clientY;
    this.base.style.left = `${this.cx - r.left}px`;
    this.base.style.top = `${this.cy - r.top}px`;
    this.zone.classList.add('active');
    this.move(e);
  }

  move(e) {
    if (e.pointerId !== this.id) return;
    let dx = e.clientX - this.cx, dy = e.clientY - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      // le pouce dépasse : le joystick suit (on ne reste jamais « coincé » au bord)
      this.cx += (dx / d) * (d - RADIUS);
      this.cy += (dy / d) * (d - RADIUS);
      dx = e.clientX - this.cx;
      dy = e.clientY - this.cy;
      const r = this.zone.getBoundingClientRect();
      this.base.style.left = `${this.cx - r.left}px`;
      this.base.style.top = `${this.cy - r.top}px`;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.onMove(clamp(dx / RADIUS, -1, 1), clamp(dy / RADIUS, -1, 1));
  }

  up(e) {
    if (e.pointerId !== this.id) return;
    this.id = null;
    this.zone.classList.remove('active');
    this.knob.style.transform = '';
    this.onMove(0, 0);
  }

  release() {
    if (this.id === null) return;
    try { this.zone.releasePointerCapture(this.id); } catch { /* déjà relâché */ }
    this.id = null;
    this.zone.classList.remove('active');
    this.knob.style.transform = '';
    this.onMove(0, 0);
  }
}

const stickHTML = (cls, label) => `<div class="ts-zone ${cls}" aria-hidden="true"><div class="ts-hint">${label}</div><div class="ts-base"><div class="ts-knob"></div></div></div>`;

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.on = false;
    this.axes = { f: 0, t: 0, aim: 0, fire: false, range: 0 };
    this.fireBtn = false;
    this.stickFire = false;

    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      ${stickHTML('ts-left', 'Conduite')}
      ${stickHTML('ts-right', 'Tourelle')}
      <button type="button" class="tb tb-fire" id="tb-fire" aria-label="Tirer"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></svg></button>
      <div class="tb-range" id="tb-range">
        <button type="button" class="tb" data-hold="rangeUp" aria-label="Portée plus longue">+</button>
        <button type="button" class="tb" data-hold="rangeDown" aria-label="Portée plus courte">−</button>
      </div>
      <div class="tb-side" id="tb-side">
        <button type="button" class="tb sm" data-tap="KeyM,m" aria-label="Carte">Carte</button>
        <button type="button" class="tb sm tb-skirmish" data-tap="KeyT,t" aria-label="Signaler">Signal</button>
        <button type="button" class="tb sm" data-chat aria-label="Chat">Chat</button>
        <button type="button" class="tb sm" data-hold-key="Tab" aria-label="Scores">Scores</button>
        <button type="button" class="tb sm tb-race" data-tap="KeyR,r" aria-label="Retour en piste">Piste</button>
      </div>
      <div class="tb-watch" id="tb-watch">
        <button type="button" class="tb sm" data-tap="ArrowLeft,ArrowLeft" aria-label="Joueur précédent">‹</button>
        <button type="button" class="tb sm" data-tap="KeyF,f" aria-label="Caméra libre / suivre">Cam</button>
        <button type="button" class="tb sm" data-tap="ArrowRight,ArrowRight" aria-label="Joueur suivant">›</button>
      </div>`;
    // `hidden` par défaut : si touch.css n'est pas chargée (cache, proxy…), rien ne s'affiche en vrac par-dessus le jeu
    // (touch.css redonne display: block / grid quand il le faut, ce qui l'emporte sur l'attribut)
    root.hidden = true;
    document.getElementById('hud').append(root);
    const hint = document.createElement('div');
    hint.id = 'rotate-hint';
    hint.hidden = true;
    hint.innerHTML = '<div><svg viewBox="0 0 24 24" width="64" height="64"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M4 12h-2M22 12h-2"/></svg><b>Tourne ton téléphone</b><span>Tank 3D se joue en mode paysage</span></div>';
    document.body.append(hint);
    this.root = root;

    this.left = new Stick(root.querySelector('.ts-left'), (x, y) => {
      this.axes.t = -shape(x);
      this.axes.f = -shape(y);
      this.free = { x, y };
    });
    this.right = new Stick(root.querySelector('.ts-right'), (x, y) => {
      this.axes.aim = -shape(x);
      this.stickFire = y < -0.78 && Math.abs(x) < 0.6; // pousser vers le haut = tirer (aimer et tirer d'un seul pouce)
    });

    const fire = root.querySelector('#tb-fire');
    fire.addEventListener('pointerdown', (e) => { try { fire.setPointerCapture(e.pointerId); } catch { /**/ } this.fireBtn = true; fire.classList.add('down'); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) fire.addEventListener(t, () => { this.fireBtn = false; fire.classList.remove('down'); });

    this.held = new Map(); // pointerId -> action relâchée à la fin de l'appui
    for (const b of root.querySelectorAll('[data-hold]')) this.bindHold(b, () => this.hold(b.dataset.hold, true), () => this.hold(b.dataset.hold, false));
    for (const b of root.querySelectorAll('[data-hold-key]')) {
      const code = b.dataset.holdKey;
      this.bindHold(b, () => key('keydown', code), () => key('keyup', code));
    }
    for (const b of root.querySelectorAll('[data-tap]')) {
      const [code, k] = b.dataset.tap.split(',');
      b.addEventListener('click', () => { key('keydown', code, k); key('keyup', code, k); });
    }
    root.querySelector('[data-chat]').addEventListener('click', () => key('keydown', 'Enter', 'Enter'));

    // fermer la carte en grand au toucher (pas de touche M sur mobile)
    document.getElementById('bm-close')?.addEventListener('click', () => { key('keydown', 'KeyM', 'm'); key('keyup', 'KeyM', 'm'); });

    this.rangeHeld = { rangeUp: false, rangeDown: false };

    // plein écran (absent sur iPhone) : on tente aussi de verrouiller le mode paysage
    const canFs = !!(document.documentElement.requestFullscreen);
    for (const b of document.querySelectorAll('.fs-toggle')) {
      if (!canFs) { b.remove(); continue; }
      b.addEventListener('click', async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else {
            await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
            await screen.orientation?.lock?.('landscape').catch(() => {});
          }
        } catch { /* refusé par le navigateur */ }
      });
    }

    if (forced === '0') return;
    if (forced === '1' || matchMedia('(pointer: coarse)').matches) this.enable();
    else addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.enable(); }, { passive: true });
  }

  bindHold(btn, down, up) {
    btn.addEventListener('pointerdown', (e) => { try { btn.setPointerCapture(e.pointerId); } catch { /**/ } btn.classList.add('down'); down(); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(t, () => { if (btn.classList.contains('down')) { btn.classList.remove('down'); up(); } });
  }

  hold(name, on) {
    this.rangeHeld[name] = on;
    this.axes.range = (this.rangeHeld.rangeUp ? 1 : 0) - (this.rangeHeld.rangeDown ? 1 : 0);
  }

  enable() {
    if (this.on) return;
    this.on = true;
    document.body.classList.add('touch');
    this.landscapeLock();
    this.input.touch = this.axes;
    document.getElementById('chat-input').placeholder = 'Message…';
    // touches synthétiques et canvas : pas de menu contextuel ni de sélection sur appui long
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Android : le verrouillage d'orientation n'est possible qu'en plein écran, déclenché par un geste de l'utilisateur.
  landscapeLock() {
    if (!document.documentElement.requestFullscreen || forced === '1') return;
    const go = async () => {
      removeEventListener('pointerup', go);
      if (document.fullscreenElement) return;
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await screen.orientation?.lock?.('landscape');
      } catch { /* refusé : l'indice « tourne ton téléphone » reste affiché en portrait */ }
    };
    addEventListener('pointerup', go);
  }

  // Appelé à chaque image : état d'affichage selon la partie en cours.
  update(state) {
    if (!this.on) return;
    const a = this.axes;
    a.fire = this.fireBtn || this.stickFire;
    if (!this.input.enabled) {
      // menu ouvert, pause… : on lâche tout pour ne pas repartir avec un pouce « fantôme »
      if (this.left.id !== null || this.right.id !== null || this.fireBtn) {
        this.left.release();
        this.right.release();
        this.fireBtn = false;
        this.stickFire = false;
        this.root.querySelector('#tb-fire').classList.remove('down');
      }
    }
    // caméra libre du spectateur : le joystick de gauche simule ZQSD (déplacement) et celui de droite les flèches
    this.root.classList.toggle('spectate', !!state.watching);
    this.root.classList.toggle('mortar', !!state.mortar);
    this.root.classList.toggle('race', !!state.race);
    if (state.freeCam && this.free) this.freeCamKeys(this.free, this.right.id !== null ? this.axes.aim : 0);
    else if (this.freeKeys?.size) this.freeCamKeys({ x: 0, y: 0 }, 0);
  }

  freeCamKeys({ x, y }, aim) {
    const want = new Set();
    if (this.left.id !== null) {
      if (y < -0.35) want.add('KeyW');
      if (y > 0.35) want.add('KeyS');
      if (x < -0.35) want.add('KeyA');
      if (x > 0.35) want.add('KeyD');
    }
    if (aim > 0.3) want.add('ArrowLeft');
    if (aim < -0.3) want.add('ArrowRight');
    this.freeKeys ??= new Set();
    for (const c of this.freeKeys) if (!want.has(c)) { key('keyup', c); this.freeKeys.delete(c); }
    for (const c of want) if (!this.freeKeys.has(c)) { key('keydown', c); this.freeKeys.add(c); }
  }
}
