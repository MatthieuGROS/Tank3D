// Sons synthétisés avec WebAudio (aucun fichier audio). Le navigateur exige une action
// de l'utilisateur avant de jouer du son : unlock() est appelé au premier clic / appui.
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // moteur : son continu dont la hauteur suit la vitesse
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 45;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(lp).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  burst(volume, duration, freqFrom, freqTo) {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.01) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freqFrom, t);
    lp.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, duration);
  }

  tone(volume, duration, freqFrom, freqTo, type = 'sine') {
    const ctx = this.ctx;
    if (!ctx || volume <= 0.01) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  // volume 0..1 selon la distance
  shot(volume = 1) {
    this.burst(0.9 * volume, 0.35, 2600, 180);
    this.tone(0.8 * volume, 0.25, 140, 40);
  }

  explosion(volume = 1) {
    this.burst(1.0 * volume, 0.8, 1400, 60);
    this.tone(0.7 * volume, 0.5, 90, 30);
  }

  hit() {
    this.tone(0.35, 0.12, 1200, 900, 'triangle');
  }

  // départ d'un obus de mortier : « bloup » sourd
  mortar(volume = 1) {
    this.tone(0.6 * volume, 0.3, 160, 55);
    this.burst(0.35 * volume, 0.25, 900, 120);
  }

  // obus qui tombe tout près : sifflement descendant
  whistle() {
    this.tone(0.12, 0.85, 1500, 500, 'sine');
  }

  pickup() {
    this.tone(0.22, 0.12, 660, 660, 'triangle');
    setTimeout(() => this.tone(0.22, 0.2, 990, 990, 'triangle'), 90);
  }

  // annonce importante (vague, phase de boss)
  alarm() {
    for (let i = 0; i < 2; i++) setTimeout(() => this.tone(0.16, 0.22, 440, 330, 'sawtooth'), i * 260);
  }

  victory() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(0.2, i === 3 ? 0.6 : 0.18, f, f, 'triangle'), i * 140));
  }

  // signalement d'un coéquipier (T / carte) : double « bip » clair ; plus grave pour une cible ennemie
  mark(target = false) {
    const f = target ? 740 : 1180;
    this.tone(0.16, 0.09, f, f, 'triangle');
    setTimeout(() => this.tone(0.16, 0.14, f * 1.26, f * 1.26, 'triangle'), 80);
  }

  // nouveau message de chat
  chat() {
    this.tone(0.08, 0.06, 1400, 1400, 'sine');
  }

  beep(high) {
    this.tone(0.25, high ? 0.4 : 0.12, high ? 880 : 520, high ? 880 : 520, 'square');
  }

  engine(active, speedRatio) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(active ? 0.1 + 0.1 * speedRatio : 0, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(42 + 50 * speedRatio, t, 0.15);
  }
}
