// Interface en jeu (éléments HTML par-dessus le canvas 3D).
import { TICK_RATE, TEAMS, TEAM_INFO, UNIT_TYPES, PICKUPS } from '/shared/constants.js';
import { RANKS } from '/shared/progress.js';

const $ = (id) => document.getElementById(id);

// Couleurs du plan par type d'objet (shared/props.js) ; défaut : bâtiment clair / rocher gris.
const PLAN_COLORS = {
  tree: 'rgba(110, 160, 80, 0.85)', palm: 'rgba(120, 165, 80, 0.85)', dune: 'rgba(200, 170, 110, 0.6)',
  water: 'rgba(80, 150, 200, 0.75)', pipe: 'rgba(200, 120, 60, 0.9)', mesa: 'rgba(170, 120, 80, 0.85)',
  hedgehog: 'rgba(90, 92, 96, 0.9)', column: 'rgba(225, 205, 160, 0.9)', ruin: 'rgba(225, 205, 160, 0.8)',
  bridge: 'rgba(150, 110, 70, 0.8)', road: 'rgba(200, 190, 160, 0.18)', bush: 'rgba(70, 140, 70, 0.55)',
};

// Dessine le plan d'une carte (obstacles) dans un canvas. Sert à la mini-carte et à l'aperçu du salon.
export function drawMapPlan(canvas, map, maxSize) {
  const scale = maxSize / Math.max(map.halfX, map.halfZ) / 2;
  canvas.width = Math.round(map.halfX * 2 * scale);
  canvas.height = Math.round(map.halfZ * 2 * scale);
  const g = canvas.getContext('2d');
  g.translate(canvas.width / 2, canvas.height / 2);
  g.scale(scale, scale);
  // relief : pied de la colline (pente) et sommet plat, en deux teintes
  for (const o of map.hills ?? []) {
    for (const [rx, rz, color] of [[o.rx, o.rz, 'rgba(150, 125, 85, 0.35)'], [o.ix, o.iz, 'rgba(190, 160, 105, 0.45)']]) {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(o.x, o.z, rx, rz, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const f of map.flats ?? []) {
    g.fillStyle = PLAN_COLORS[f.kind] ?? 'rgba(160, 150, 120, 0.3)';
    g.fillRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d);
  }
  for (const b of map.boxes) {
    g.fillStyle = PLAN_COLORS[b.kind] ?? 'rgba(214, 208, 184, 0.8)';
    g.fillRect(b.x - b.w / 2, b.z - b.d / 2, Math.max(b.w, 1), Math.max(b.d, 1));
  }
  for (const c of map.circles) {
    g.fillStyle = PLAN_COLORS[c.kind] ?? 'rgba(140, 138, 124, 0.85)';
    g.beginPath();
    g.arc(c.x, c.z, Math.max(c.r, 1), 0, Math.PI * 2);
    g.fill();
  }
  return scale;
}

// Ajoute zone de capture et bases de départ (aperçu du salon).
// En campagne (`mission`), on montre aussi les positions ennemies, alliées et le départ.
export function drawMapPreview(canvas, map, maxSize, mission = null) {
  const scale = drawMapPlan(canvas, map, maxSize);
  // la carte d'aperçu est large : une carte en portrait doit y tenir en entier, pas être rognée
  canvas.style.objectFit = map.halfZ > map.halfX ? 'contain' : '';
  const g = canvas.getContext('2d');
  g.lineWidth = 1.5 / scale;
  if (map.zone) {
    g.strokeStyle = '#f5b312';
    g.setLineDash([3, 2]);
    g.beginPath();
    g.arc(map.zone.x, map.zone.z, map.zone.r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  if (map.spawns) {
    for (const team of TEAMS) {
      g.fillStyle = TEAM_INFO[team].css;
      g.globalAlpha = 0.85;
      for (const s of map.spawns[team]) g.fillRect(s.x - 1.5, s.z - 1.5, 3, 3);
    }
  }
  if (mission) {
    for (const u of mission.units) {
      const def = UNIT_TYPES[u.t];
      g.fillStyle = u.team === 'blue' ? TEAM_INFO.blue.css : u.obj ? '#f5b312' : TEAM_INFO.red.css;
      const r = def.boss ? 4 : def.structure ? 3 : 2;
      if (def.static) g.fillRect(u.x - r, u.z - r, r * 2, r * 2);
      else {
        g.beginPath();
        g.arc(u.x, u.z, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    const sp = map.playerSpawn;
    g.fillStyle = '#e9e5d3';
    g.beginPath();
    g.moveTo(sp.x + Math.sin(sp.yaw) * 5, sp.z + Math.cos(sp.yaw) * 5);
    g.lineTo(sp.x + Math.sin(sp.yaw + 2.4) * 4, sp.z + Math.cos(sp.yaw + 2.4) * 4);
    g.lineTo(sp.x + Math.sin(sp.yaw - 2.4) * 4, sp.z + Math.cos(sp.yaw - 2.4) * 4);
    g.fill();
  }
  g.globalAlpha = 1;
}

export class Hud {
  constructor() {
    this.el = {
      scoreRed: $('score-red'), scoreBlue: $('score-blue'), timer: $('timer'), round: $('round-label'),
      aliveRed: $('alive-red'), aliveBlue: $('alive-blue'),
      cap: $('cap'), capLabel: $('cap-label'), capFill: $('cap-fill'),
      announce: $('announce'), main: $('announce-main'), sub: $('announce-sub'),
      feed: $('killfeed'), tags: $('tags'), gunmark: $('gunmark'), hitmarker: $('hitmarker'),
      vignette: $('vignette'), lowhp: $('lowhp'), hpFill: $('hp-fill'), hpText: $('hp-text'), tankName: $('tank-name'),
      reloadFill: $('reload-fill'), reloadText: $('reload-text'),
      spectate: $('spectate'), net: $('netinfo'), board: $('scoreboard'),
      scorebar: $('scorebar'), mission: $('mission'), mName: $('m-name'), mObj: $('m-obj'), mVal: $('m-val'), mFill: $('m-fill'),
      mLives: $('m-lives'), mTime: $('m-time'), boss: $('bossbar'), bossName: $('boss-name'), bossFill: $('boss-fill'), bossHp: $('boss-hp'),
      toasts: $('toasts'), buffs: $('buffs'), dmglog: $('dmglog'),
    };
    this.dlog = { rows: [], total: { out: 0, in: 0 }, dirty: true, shown: false };
    this.tags = new Map();
    this.announceLeft = 0;
    this.mm = $('minimap').getContext('2d');
    this.mmStatic = document.createElement('canvas');
    this.map = null;
    this.scale = 1;
  }

  setMap(map) {
    if (this.map === map) return;
    this.map = map;
    this.scale = drawMapPlan(this.mmStatic, map, 220);
    this.mm.canvas.width = this.mmStatic.width;
    this.mm.canvas.height = this.mmStatic.height;
  }

  // Mode campagne : panneau de mission à la place du tableau des scores.
  setCampaignMode(on) {
    this.el.scorebar.classList.toggle('hidden', on);
    this.el.mission.classList.toggle('hidden', !on);
    if (!on) this.el.boss.classList.add('hidden');
  }

  // info = { l: objectif, v: valeur, p: progression, al: chars en vie, sq: taille de l'escouade, t: secondes }
  setMission(name, info) {
    this.el.mName.textContent = name;
    if (!info) return;
    this.el.mObj.textContent = info.l;
    this.el.mVal.textContent = info.v;
    this.el.mFill.style.width = `${Math.min(1, info.p) * 100}%`;
    const key = `${info.al}/${info.sq}`;
    if (this.el.mLives.dataset.n !== key) {
      this.el.mLives.dataset.n = key;
      this.el.mLives.replaceChildren(...Array.from({ length: Math.min(info.sq, 12) }, (_, i) => {
        const t = document.createElement('i');
        if (i >= info.al) t.className = 'down';
        return t;
      }));
      this.el.mLives.title = `${info.al} char${info.al > 1 ? 's' : ''} en vie sur ${info.sq}`;
    }
    this.el.mTime.textContent = `${Math.floor(info.t / 60)}:${String(info.t % 60).padStart(2, '0')}`;
  }

  // boss = { name, hp, max, shield } ou null
  setBoss(boss) {
    this.el.boss.classList.toggle('hidden', !boss);
    if (!boss) return;
    this.el.bossName.textContent = boss.name;
    this.el.bossFill.style.width = `${(boss.hp / boss.max) * 100}%`;
    this.el.boss.classList.toggle('shielded', !!boss.shield);
    this.el.bossHp.textContent = boss.shield ? 'Bouclier actif' : `${Math.ceil(boss.hp)} / ${boss.max}`;
  }

  // Petit message temporaire sous le panneau de mission. c = red | blue | amber | green
  toast(text, c = '') {
    const row = document.createElement('div');
    row.textContent = text;
    row.className = c;
    this.el.toasts.append(row);
    setTimeout(() => row.remove(), 3500);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  // Bonus actifs (au-dessus du statut du char) : [{ name, css, left, max, unit }]
  // Une jauge à crans montre ce qu'il reste : un cran par tir (ou par impact pour le bouclier).
  setBuffs(list) {
    const key = list.map((b) => `${b.name}:${b.left}`).join('|');
    if (this.el.buffs.dataset.key === key) return;
    this.el.buffs.dataset.key = key;
    this.el.buffs.replaceChildren(...list.map((b) => {
      const d = document.createElement('div');
      d.style.setProperty('--c', b.css);
      const name = document.createElement('span');
      name.textContent = b.name;
      const gauge = document.createElement('i');
      for (let k = 0; k < b.max; k++) {
        const cell = document.createElement('b');
        if (k < b.left) cell.className = 'on';
        gauge.append(cell);
      }
      const count = document.createElement('em');
      count.textContent = `${b.left}/${b.max} ${b.unit}`;
      d.append(name, gauge, count);
      return d;
    }));
  }

  setScore(score) {
    this.el.scoreRed.textContent = score.red;
    this.el.scoreBlue.textContent = score.blue;
  }

  setRound(round, toWin) {
    this.el.round.textContent = `Manche ${round} · ${toWin} pour gagner`;
  }

  setTimer(ticks, phase) {
    const s = Math.max(0, Math.ceil(ticks / TICK_RATE));
    this.el.timer.textContent = phase === 'playing' ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '–:––';
  }

  // counts = { red: { alive, total }, blue: {...} }
  setAlive(counts) {
    for (const team of TEAMS) {
      const el = team === 'red' ? this.el.aliveRed : this.el.aliveBlue;
      const { alive, total } = counts[team];
      const key = `${alive}/${total}`;
      if (el.dataset.key === key) continue;
      el.dataset.key = key;
      el.replaceChildren(...Array.from({ length: total }, (_, i) => {
        const pip = document.createElement('i');
        if (i >= alive) pip.className = 'dead';
        return pip;
      }));
    }
  }

  setZone(zone) {
    const show = zone.p > 0 || zone.c;
    this.el.cap.classList.toggle('hidden', !show);
    if (!show) return;
    const info = zone.team ? TEAM_INFO[zone.team] : null;
    this.el.capLabel.textContent = zone.c ? 'Zone contestée' : info ? `Capture · ${info.label}` : '';
    this.el.capFill.style.width = `${zone.p * 100}%`;
    this.el.capFill.style.background = info ? info.css : '#fff';
  }

  announce(main, sub = '', seconds = 3) {
    this.el.main.textContent = main;
    this.el.sub.textContent = sub;
    this.announceLeft = seconds;
    // relance l'animation d'apparition
    this.el.announce.classList.remove('pop');
    void this.el.announce.offsetWidth;
    if (main) this.el.announce.classList.add('pop');
  }

  update(dt) {
    if (this.announceLeft > 0) {
      this.announceLeft -= dt;
      if (this.announceLeft <= 0) this.announce('', '', 0);
    }
  }

  addKill(killer, victim) {
    const row = document.createElement('div');
    const span = (text, cls) => {
      const s = document.createElement('span');
      s.textContent = text;
      s.className = cls;
      return s;
    };
    if (killer) row.append(span(killer.name, `c-${killer.team}`), span('▸', 'x'), span(victim.name, `c-${victim.team}`));
    else row.append(span(victim.name, `c-${victim.team}`), span('hors combat', 'x'));
    this.el.feed.append(row);
    setTimeout(() => row.remove(), 6000);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
  }

  // extra : texte ajouté à l'état du canon (obus restants d'une rafale, portée de l'obusier)
  setStatus(name, hp, maxHp, reload, reloadMax, extra = '') {
    const ratio = hp / maxHp;
    this.el.tankName.textContent = name;
    this.el.hpFill.style.width = `${ratio * 100}%`;
    this.el.hpFill.style.background = ratio > 0.5 ? '#9ccf4a' : ratio > 0.25 ? '#f5b312' : '#e4553f';
    this.el.hpText.textContent = hp;
    this.el.lowhp.classList.toggle('on', hp > 0 && ratio < 0.3);
    const ready = 1 - reload / reloadMax;
    this.el.reloadFill.style.width = `${ready * 100}%`;
    this.el.reloadText.textContent = (reload > 0 ? `${(reload / TICK_RATE).toFixed(1)} s` : 'Prêt') + (extra ? ` · ${extra}` : '');
    this.el.gunmark.style.setProperty('--p', ready);
    this.el.gunmark.classList.toggle('loading', reload > 0);
  }

  // list = [{ id, name, team, hpRatio, x, y }] déjà projetés à l'écran
  setTags(list) {
    const seen = new Set();
    for (const t of list) {
      seen.add(t.id);
      let el = this.tags.get(t.id);
      if (!el) {
        el = document.createElement('div');
        // .tgt : cible posée par un coéquipier (T ou carte), à côté de la barre de vie
        el.innerHTML = '<span></span><div class="hpline"><div class="track"><div></div></div>'
          + '<svg class="tgt" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="6.5"/>'
          + '<path d="M10 1v5M10 14v5M1 10h5M14 10h5"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/></svg></div>';
        el.fill = el.querySelector('.track > div');
        this.el.tags.append(el);
        this.tags.set(t.id, el);
      }
      el.className = `c-${t.team}${t.obj ? ' obj' : ''}${t.marked ? ' marked' : ''}`;
      el.firstChild.textContent = t.name;
      el.fill.style.width = `${t.hpRatio * 100}%`;
      el.style.left = `${t.x}px`;
      el.style.top = `${t.y}px`;
    }
    for (const [id, el] of this.tags) {
      if (seen.has(id)) continue;
      el.remove();
      this.tags.delete(id);
    }
  }

  // Signalements dans le monde : list = [{ key, name, dist, x, y, alpha }] déjà projetés à l'écran
  setMarks(list) {
    const layer = $('marks');
    this.markEls ??= new Map();
    const seen = new Set();
    for (const m of list) {
      seen.add(m.key);
      let el = this.markEls.get(m.key);
      if (!el) {
        el = document.createElement('div');
        el.append(document.createElement('span'), document.createElement('em'), document.createElement('i'));
        layer.append(el);
        this.markEls.set(m.key, el);
      }
      el.children[0].textContent = m.name;
      el.children[1].textContent = `${Math.round(m.dist)} m`;
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.style.opacity = m.alpha;
    }
    for (const [key, el] of this.markEls) {
      if (seen.has(key)) continue;
      el.remove();
      this.markEls.delete(key);
    }
  }

  // Carte en grand (M) : ouvre sur `canvas` à la taille `size` (px, plus grand côté), ou ferme (null).
  setBigMap(canvas, size = 0) {
    if (!canvas) {
      this.big = null;
      return;
    }
    const plan = document.createElement('canvas');
    const scale = drawMapPlan(plan, this.map, size);
    canvas.width = plan.width;
    canvas.height = plan.height;
    this.big = { g: canvas.getContext('2d'), plan, scale, map: this.map, size };
  }

  // Position monde (x, z) sous un point de l'écran de la carte en grand.
  bigMapToWorld(clientX, clientY) {
    const b = this.big;
    if (!b) return null;
    const r = b.g.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * b.g.canvas.width;
    const py = ((clientY - r.top) / r.height) * b.g.canvas.height;
    return { x: (px - b.g.canvas.width / 2) / b.scale, z: (py - b.g.canvas.height / 2) / b.scale, perPx: 1 / b.scale };
  }

  // Repère de visée : là où l'obus va frapper. L'anneau de rechargement a pour rayon (px) celui du cercle
  // de dispersion (rayon absent ou petit : taille minimale).
  setGunmark(pos, radius = 0) {
    const el = this.el.gunmark;
    el.style.display = pos ? '' : 'none';
    if (!pos) return;
    el.style.setProperty('--d', `${Math.max(34, radius * 2)}px`);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    this.el.hitmarker.style.left = el.style.left;
    this.el.hitmarker.style.top = el.style.top;
  }

  flash(el) {
    el.classList.add('on');
    void el.offsetWidth; // force le navigateur à prendre en compte l'état « on » avant le fondu
    requestAnimationFrame(() => el.classList.remove('on'));
  }

  hitMarker() {
    this.flash(this.el.hitmarker);
  }

  damageFlash() {
    this.flash(this.el.vignette);
  }

  // text : ligne principale (peut contenir un pseudo, donc en texte brut) ; hint : aide aux touches (HTML fixe)
  setSpectate(text, hint = '') {
    const key = `${text}|${hint}`;
    if (key === this.spectateKey) return;
    this.spectateKey = key;
    this.el.spectate.classList.toggle('hidden', !text);
    this.el.spectate.textContent = text || '';
    if (hint) {
      const small = document.createElement('small');
      small.innerHTML = hint;
      this.el.spectate.append(small);
    }
  }

  setNetInfo(text) {
    this.el.net.textContent = text;
  }

  // ---- journal des dégâts (Alt) ----
  // e = { dir: 'out' (infligés) | 'in' (reçus), name, team, d, kill, ally } ; des coups rapprochés sur le même char sont fusionnés.
  logDamage(e) {
    const log = this.dlog;
    const now = performance.now();
    const last = log.rows[log.rows.length - 1];
    if (last && last.dir === e.dir && last.key === e.key && now - last.at < 1200) {
      last.d += e.d;
      last.n++;
      last.kill ||= e.kill;
      last.at = now;
    } else {
      log.rows.push({ ...e, n: 1, at: now });
      if (log.rows.length > 40) log.rows.shift();
    }
    log.total[e.dir] += e.d;
    log.dirty = true;
  }

  clearDamageLog() {
    this.dlog.rows.length = 0;
    this.dlog.total = { out: 0, in: 0 };
    this.dlog.dirty = true;
  }

  setDamageLog(show) {
    const log = this.dlog;
    if (log.shown !== show) {
      log.shown = show;
      this.el.dmglog.classList.toggle('hidden', !show);
      if (show) log.dirty = true;
    }
    if (!show || !log.dirty) return;
    log.dirty = false;
    const div = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      if (text !== undefined) d.textContent = text;
      return d;
    };
    const stat = (cls, label, value) => {
      const d = div(cls, label);
      const b = document.createElement('b');
      b.textContent = value;
      d.prepend(b);
      return d;
    };
    const head = div('dl-head');
    head.append(stat('out', ' infligés', log.total.out), stat('in', ' reçus', log.total.in));
    const rows = div('dl-rows');
    for (const r of log.rows.slice(-14)) {
      const row = div(`dl-row ${r.dir}${r.kill ? ' kill' : ''}`);
      const who = div('who', r.name);
      if (r.team) who.className = `who c-${r.team}`;
      const note = r.kill ? (r.dir === 'out' ? 'détruit' : 't’a détruit') : r.n > 1 ? `×${r.n}` : r.ally ? 'allié' : '';
      if (note) {
        const s = document.createElement('small');
        s.textContent = note;
        who.append(s);
      }
      row.append(div('ar', r.dir === 'out' ? '▸' : '◂'), who, div('pts', `${r.dir === 'out' ? '+' : '−'}${r.d}`));
      rows.append(row);
    }
    const body = log.rows.length ? rows : div('dl-empty', 'Aucun impact pour le moment');
    this.el.dmglog.replaceChildren(head, body);
  }

  setScoreboard(show, roster) {
    this.el.board.classList.toggle('hidden', !show);
    if (!show) return;
    const table = document.createElement('table');
    table.innerHTML = '<tr><th>Équipage</th><th class="n">Destructions</th><th class="n">Pertes</th></tr>';
    const players = [...roster.values()].filter((p) => p.team && !p.unit).sort((a, b) => b.team.localeCompare(a.team) || b.kills - a.kills);
    for (const p of players) {
      const tr = table.insertRow();
      const name = tr.insertCell();
      name.textContent = p.name;
      name.className = `c-${p.team}`;
      if (p.rk != null) {
        const rank = document.createElement('small');
        rank.textContent = RANKS[p.rk].short;
        rank.title = RANKS[p.rk].name;
        name.prepend(rank, ' ');
      }
      if (p.bot) {
        const tag = document.createElement('small');
        tag.textContent = 'bot';
        name.append(tag);
      }
      for (const v of [p.kills, p.deaths]) {
        const td = tr.insertCell();
        td.textContent = v;
        td.className = 'n';
      }
    }
    const watchers = [...roster.values()].filter((p) => !p.team && !p.unit).map((p) => p.name);
    const foot = document.createElement('p');
    foot.className = 'board-spec';
    foot.textContent = watchers.length ? `Spectateurs : ${watchers.join(', ')}` : '';
    this.el.board.replaceChildren(table, foot);
  }

  // Cercle de dispersion de l'obusier sur la carte : { x, z, r } (monde), ou null.
  setMapAim(aim) {
    this.mapAim = aim;
  }

  // dots = [{ x, z, ty, team, me, alive, fixed, size, obj }] ; pickups = [[id, kind, x, z]]
  // marks = [{ x, z, age, life, target }] : signalements des coéquipiers (anneaux pulsés)
  drawMinimap(dots, zone, pickups = [], marks = []) {
    if (!this.map) return;
    this.drawPlan(this.mm, this.mmStatic, this.scale, dots, zone, pickups, marks);
    const b = this.big;
    if (b) {
      if (b.map !== this.map) this.setBigMap(b.g.canvas, b.size);
      this.drawPlan(this.big.g, this.big.plan, this.big.scale, dots, zone, pickups, marks, true);
    }
  }

  drawPlan(g, plan, scale, dots, zone, pickups, marks, big = false) {
    const cv = g.canvas, map = this.map;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(plan, 0, 0);
    g.translate(cv.width / 2, cv.height / 2);
    g.scale(scale, scale);
    const px = 1 / scale; // un pixel écran, en unités du monde

    const z = map.zone;
    if (z) {
      g.lineWidth = 0.8;
      g.strokeStyle = g.fillStyle = zone.team ? TEAM_INFO[zone.team].css : '#e9e5d3';
      g.globalAlpha = 0.15 + 0.35 * zone.p;
      g.beginPath();
      g.arc(z.x, z.z, z.r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
    }

    for (const [, kind, x, y] of pickups) {
      g.fillStyle = PICKUPS[kind]?.css ?? '#fff';
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      g.fillRect(-1.6, -1.6, 3.2, 3.2);
      g.restore();
    }

    // obusier : zone où l'obus peut tomber (rayon de dispersion), au moins visible sur la mini-carte
    const aim = this.mapAim;
    if (aim) {
      g.save();
      g.beginPath();
      g.arc(aim.x, aim.z, Math.max(aim.r, 2.5 * px), 0, Math.PI * 2);
      g.fillStyle = 'rgba(255, 90, 60, 0.18)';
      g.fill();
      g.lineWidth = 1.2 * px;
      g.strokeStyle = '#ff5a3c';
      g.stroke();
      g.restore();
    }

    for (const d of dots) {
      g.save();
      g.translate(d.x, d.z);
      g.globalAlpha = d.alive ? 1 : 0.35;
      g.fillStyle = d.obj && d.alive ? '#f5b312' : TEAM_INFO[d.team].css;
      if (d.fixed) {
        // tourelles et bâtiments : carrés (plus gros pour les objectifs et les boss)
        const r = d.size ?? 2;
        g.fillRect(-r, -r, r * 2, r * 2);
        if (d.obj && d.alive) {
          g.strokeStyle = '#fff';
          g.lineWidth = 0.8;
          g.strokeRect(-r - 1, -r - 1, r * 2 + 2, r * 2 + 2);
        }
      } else if (d.alive) {
        if (d.size) g.scale(d.size / 2, d.size / 2);
        // triangle orienté comme la tourelle (vue de dessus : +X à droite, +Z vers le bas)
        g.rotate(-d.ty);
        g.beginPath();
        g.moveTo(0, 3.8);
        g.lineTo(-2.3, -2.5);
        g.lineTo(2.3, -2.5);
        g.closePath();
        g.fill();
        if (d.me) {
          g.strokeStyle = '#fff';
          g.lineWidth = 1;
          g.stroke();
        }
      } else {
        g.fillRect(-1.5, -1.5, 3, 3);
      }
      g.restore();
      if (big && d.name && d.alive && !d.fixed) {
        // noms des joueurs sur la carte en grand
        g.save();
        g.translate(d.x, d.z);
        g.scale(px, px);
        g.font = '600 11px Bahnschrift, "Arial Narrow", sans-serif';
        g.textAlign = 'center';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(11, 13, 10, 0.85)';
        g.strokeText(d.name, 0, -12);
        g.fillStyle = d.me ? '#fff' : TEAM_INFO[d.team].css;
        g.fillText(d.name, 0, -12);
        g.restore();
      }
    }

    // signalements : losange + anneau qui s'élargit (rouge pour une cible ennemie)
    const t = performance.now() / 1000;
    for (const m of marks) {
      const fade = Math.min(1, (m.life - m.age) / 1.5);
      const color = m.target ? '#ff5a3c' : '#f5b312';
      g.save();
      g.translate(m.x, m.z);
      g.scale(px, px);
      g.globalAlpha = fade;
      g.strokeStyle = color;
      g.lineWidth = 2;
      const k = (t * 1.4) % 1;
      g.globalAlpha = fade * (1 - k);
      g.beginPath();
      g.arc(0, 0, (big ? 8 : 4) + k * (big ? 22 : 11), 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = fade;
      const s = big ? 6 : 3.5;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s, 0);
      g.lineTo(0, s);
      g.lineTo(-s, 0);
      g.closePath();
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = '#0b0d0a';
      g.stroke();
      if (big && m.name) {
        g.font = '600 11px Bahnschrift, "Arial Narrow", sans-serif';
        g.textAlign = 'center';
        g.fillStyle = color;
        g.fillText(m.name, 0, s + 13);
      }
      g.restore();
    }
  }
}
