// Clavier. On lit la position PHYSIQUE des touches (event.code) : KeyW/KeyA/KeyS/KeyD
// correspondent à Z/Q/S/D sur un clavier AZERTY (et à W/A/S/D sur un QWERTY).
const BINDINGS = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowLeft: 'aimLeft',
  ArrowRight: 'aimRight',
  Space: 'fire',
  ArrowUp: 'fire',
  Tab: 'scores',
  AltLeft: 'dmglog', // maintenu : journal des dégâts infligés / reçus
  AltRight: 'dmglog',
  KeyQ: 'rangeDown', // A sur AZERTY : obusier, portée plus courte
  KeyE: 'rangeUp', // E : portée plus longue
};
const RANGE_STEP = 0.012; // réglage de portée par tick (toute la plage en ~1,4 s)
const AIM_RAMP_TICKS = 24; // un appui bref = visée fine, un appui long = vitesse max

export class Input {
  constructor() {
    this.down = new Set();
    this.enabled = false; // vrai quand on est en jeu (pas dans un menu)
    this.aimDir = 0;
    this.aimHeld = 0;
    this.range = 0.4; // réglage de portée de l'obusier (0..1), gardé d'une manche à l'autre
    this.touch = null; // commandes tactiles analogiques (voir touch.js)
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.down.clear());
  }

  onKey(e, isDown) {
    const action = BINDINGS[e.code];
    if (!action) return;
    if (!this.enabled || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      this.down.delete(action);
      return;
    }
    e.preventDefault();
    if (isDown) this.down.add(action);
    else this.down.delete(action);
  }

  has(action) {
    return this.enabled && this.down.has(action);
  }

  // Appelé une fois par tick de simulation : renvoie la commande à envoyer au serveur.
  sample() {
    const dir = (this.has('aimLeft') ? 1 : 0) - (this.has('aimRight') ? 1 : 0);
    this.aimHeld = dir !== 0 && dir === this.aimDir ? this.aimHeld + 1 : 0;
    this.aimDir = dir;
    const ramp = Math.min(1, 0.2 + (0.8 * this.aimHeld) / AIM_RAMP_TICKS);
    // tactile : joysticks analogiques (touch = { f, t, aim, fire, range }), le clavier garde la priorité s'il est utilisé
    const tc = this.enabled ? this.touch : null;
    const rdir = (this.has('rangeUp') ? 1 : 0) - (this.has('rangeDown') ? 1 : 0) || (tc?.range ?? 0);
    this.range = Math.min(1, Math.max(0, this.range + rdir * RANGE_STEP));
    return {
      f: (this.has('forward') ? 1 : 0) - (this.has('back') ? 1 : 0) || (tc?.f ?? 0),
      t: (this.has('left') ? 1 : 0) - (this.has('right') ? 1 : 0) || (tc?.t ?? 0),
      tt: dir * ramp || (tc?.aim ?? 0),
      fire: this.has('fire') || !!tc?.fire,
      rg: Math.round(this.range * 1000) / 1000,
    };
  }
}
