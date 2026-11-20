// Le « hub » : tout ce que le joueur voit entre deux parties, organisé comme un vrai jeu en trois pages.
//   Hangar      mon char (carrousel), sa fiche, ses peintures, l'équipage, et le bouton de lancement
//   Opérations  le mode, la carte d'escarmouche ou la mission de campagne, la difficulté
//   Boutique    le catalogue des chars, comparés au char équipé, avec confirmation d'achat
// Le hub ne connaît ni le réseau ni la 3D : main.js lui prête ce dont il a besoin (`ctx`) et lui demande
// seulement quel char exposer (showcaseType) et quelles marges laisser autour de lui (insets).
import { TEAMS, TEAM_INFO, TANK_TYPES, UNIT_TYPES, DEFAULT_TANK, RULES, DIFFICULTIES } from '/shared/constants.js';
import { RANKS, rankInfo, tankOwned, tankPrice, fmtCr } from '/shared/progress.js';
import { MAPS, RACE_MAPS } from '/shared/map.js';
import { MISSIONS, CHAPTERS, getMission } from '/shared/campaign.js';
import { SKINS, DEFAULT_SKIN, skinUnlocked, unlockedSkins } from '/shared/skins.js';
import { EQUIPMENT, EQUIP_IDS, EQUIP_GROUPS, EQUIP_PRICE, EQUIP_SLOTS, EQUIP_MAX_LEVEL, MERGE_COST, eqKey, parseEq, equipEffect, equipMisfit, equipMisfits, cleanLoadout, eqDef } from '/shared/equipment.js';
import { drawMapPreview } from '../hud.js';
import { CampaignMap, difficultyRows } from '../campaignMap.js';
import { $, el, html, fmtInt, ICON, CLASSES, tankClass, classIcon, rankBadge, StatBars, AccuracyPanel, faceChips, reorder } from './kit.js';
import { loadPortrait } from './portraits.js';
import { equipTile } from './equipIcons.js';

const TANK_KEYS = Object.keys(TANK_TYPES);
const MAP_KEYS = Object.keys(MAPS);
const SKIN_KEYS = Object.keys(SKINS);
const ROMAN = ['I', 'II', 'III', 'IV'];
const THEME = {
  meadow: { name: 'Prairie', css: 'linear-gradient(160deg, #3b5230, #1d2a19)' },
  desert: { name: 'Désert', css: 'linear-gradient(160deg, #6d5630, #2e2414)' },
  snow: { name: 'Neige', css: 'linear-gradient(160deg, #56677a, #1f2a35)' },
  neon: { name: 'Néon', css: 'linear-gradient(160deg, #6a1b8a, #0a1a3a 60%, #0a3a4a)' },
};
const themeOf = (map) => THEME[map.theme] ?? THEME.meadow;
const stars = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(max - n);

export class Hub {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = $('screen-lobby');
    this.page = 'hangar';
    this.tab = 'specs';
    this.tankFocus = null; // char regardé (peut être verrouillé : on le voit, sans pouvoir le prendre)
    this.skinFocus = null; // skin verrouillé sélectionné : on lit sa condition, sans l'afficher sur le char
    this.storeFocus = null;
    this.storeTab = 'tanks'; // boutique : 'tanks' (chars) ou 'equip' (équipements)
    this.storeEq = EQUIP_IDS[0]; // équipement regardé à la boutique
    this.eqSig = null; // signature de l'onglet Équipement du hangar (il ne se reconstruit que s'il change)
    this.eqNote = null; // { text, cls } sous l'onglet Équipement du hangar
    this.filter = 'all';
    this.buying = false; // achat envoyé, réponse attendue
    this.note = null; // { text, cls } sous le bouton d'achat
    this.mapFocus = null; // mission détaillée sur la carte de campagne
    this.dirty = true;
    this.ins = { l: 0, r: 0, t: 0, b: 0 };
    this.shots = {}; // aperçus de carte déjà dessinés
    this.specBars = new StatBars($('sheet-stats'));
    this.storeBars = new StatBars($('store-stats'));
    this.specAcc = new AccuracyPanel($('sheet-acc'));
    this.storeAcc = new AccuracyPanel($('store-acc'));
    this.campaignMap = new CampaignMap($('cmap'), (id) => {
      this.mapFocus = id;
      this.render();
    });
    this.buildCarousel();
    this.buildSkins();
    this.buildStore();
    this.buildEquipShop();
    this.buildOps();
    this.bind();
    addEventListener('resize', () => (this.dirty = true));
    $('screen-lobby').addEventListener('scroll', () => (this.dirty = true), { passive: true }); // hub empilé : le cadrage suit le défilement
  }

  // ------------------------------------------------------------ état commun
  get game() { return this.ctx.game; }
  get net() { return this.ctx.net; }
  get campaign() { return this.ctx.isCampaign(); }
  get race() { return this.game.settings.mode === 'race'; }
  get running() { return this.game.phase !== 'lobby'; }
  get isHost() { return this.game.hostId === this.game.myId; }
  owned = (type) => tankOwned(type, { tanks: this.game.account?.tanks ?? [] });
  equipped = () => this.game.me?.type ?? DEFAULT_TANK;
  cleared = () => this.game.account?.cleared ?? {};

  // ---- équipements : stock du compte et équipements montés sur chaque char
  stock = () => this.game.account?.equip?.stock ?? {};
  loadout = (type) => cleanLoadout(type, this.game.account?.equip?.load?.[type]);
  // fiche d'un char avec ses équipements montés (jauges du hangar)
  fitted = (type) => eqDef(type, this.loadout(type));
  // exemplaires d'un équipement (tous niveaux) : { stock, mounted } ; mounted = montés sur un char quelconque
  haveOf(id) {
    let stock = 0, mounted = 0;
    for (const [k, n] of Object.entries(this.stock())) if (parseEq(k)?.id === id) stock += n;
    for (const keys of Object.values(this.game.account?.equip?.load ?? {})) mounted += keys.filter((k) => parseEq(k)?.id === id).length;
    return { stock, mounted };
  }
  stockTotal = () => Object.values(this.stock()).reduce((n, v) => n + v, 0);

  // Char exposé dans le hangar : celui regardé, sinon celui équipé.
  shownTank() {
    const eq = this.equipped();
    if (this.tankFocus === eq) this.tankFocus = null;
    return this.tankFocus ?? eq;
  }

  // Char exposé en 3D : en boutique, celui qu'on examine.
  showcaseType() {
    return this.page === 'store' && this.storeTab === 'tanks' ? this.storeFocus ?? this.shownTank() : this.shownTank();
  }

  // Ordre d'affichage : mes chars, puis ceux à acheter du moins cher au plus cher.
  order() {
    const mine = TANK_KEYS.filter((k) => this.owned(k));
    const rest = TANK_KEYS.filter((k) => !this.owned(k)).sort((a, b) => tankPrice(a) - tankPrice(b));
    return [...mine, ...rest];
  }

  // ---------------------------------------------------------- navigation
  setPage(page) {
    if (page === 'store' && this.running) return;
    if (page === 'store') {
      this.storeFocus ??= this.order().find((k) => !this.owned(k)) ?? this.shownTank();
      this.note = null;
      this.buying = false;
    }
    this.page = page;
    this.dirty = true;
    this.ctx.refresh();
  }

  openStore(type) {
    if (type) this.storeFocus = type;
    this.storeTab = 'tanks';
    this.setPage('store');
  }

  openEquipShop(id) {
    if (id) this.storeEq = id;
    this.storeTab = 'equip';
    this.setPage('store');
  }

  // Échap : ferme la fenêtre, puis la page. Renvoie true si quelque chose a été fermé.
  back() {
    if (!$('modal').classList.contains('hidden')) {
      this.closeModal();
      return true;
    }
    if (this.page !== 'hangar') {
      this.setPage('hangar');
      return true;
    }
    return false;
  }

  reset() {
    // retour au salon après une partie, ou changement de compte
    this.page = 'hangar';
    this.closeModal();
  }

  // Marges laissées autour du char 3D (px) : le char se cadre au milieu de l'espace libre.
  insets() {
    if (this.dirty) {
      this.dirty = false;
      const rect = (id) => {
        const e = $(id);
        return e && e.offsetParent ? e.getBoundingClientRect() : null;
      };
      // le haut de l'espace libre est le bas du bandeau de nom du char
      let top = $('hub-top').getBoundingClientRect().bottom;
      let l = 0, r = 0, b = 0;
      if (this.page === 'hangar' || this.page === 'store') {
        const hangar = this.page === 'hangar';
        const n = rect(hangar ? 'np' : 'snp');
        // chaque panneau grignote le côté dont il est le plus proche ; un panneau pleine largeur (mobile, hub empilé) ne laisse que le haut
        for (const id of hangar ? ['crew', 'sheet'] : ['store-list', 'store-detail']) {
          const p = rect(id);
          if (!p || p.width > innerWidth * 0.7) continue;
          if (p.left + p.width / 2 < innerWidth / 2) l = Math.max(l, p.right);
          else r = Math.max(r, innerWidth - p.left);
        }
        const d = hangar ? rect('dock') : null;
        if (d) b = innerHeight - d.top;
        if (n) {
          if (n.width > innerWidth * 0.7 && getComputedStyle($('screen-lobby')).display === 'flex') {
            // hub empilé : le char occupe la zone du bandeau de nom, qui défile avec la page
            top = Math.max(top, n.top);
            b = Math.max(b, innerHeight - Math.max(top + 120, n.bottom));
          } else top = Math.max(top, n.bottom - 14);
        }
      }
      this.ins = { l, r, t: top, b };
      if (b) document.documentElement.style.setProperty('--dock-h', `${Math.round(b)}px`); // le chat se pose au-dessus du bandeau
    }
    return this.ins;
  }

  // ----------------------------------------------------------- construction
  buildCarousel() {
    this.cards = new Map();
    for (const type of TANK_KEYS) {
      const def = TANK_TYPES[type];
      const card = el('button', 'tcard');
      card.type = 'button';
      card.dataset.type = type;
      const art = el('div', 'tc-art');
      const img = el('img', 'tc-img');
      img.alt = '';
      img.draggable = false;
      art.append(img, el('div', 'tc-shadow'));
      const badge = el('span', 'tc-badge');
      const info = el('div', 'tc-info');
      const cls = tankClass(def);
      const top = el('div', 'tc-top');
      top.append(classIcon(cls), el('b', '', def.name));
      const foot = el('div', 'tc-foot');
      info.append(top, foot);
      card.append(art, badge, info);
      card.addEventListener('click', () => this.pickTank(type));
      loadPortrait(img, type, DEFAULT_SKIN, null);
      this.cards.set(type, { card, badge, foot, img });
    }
    this.sep = el('div', 'car-sep');
    this.sep.append(el('span', '', 'À débloquer'));
  }

  buildSkins() {
    this.tiles = new Map();
    for (const id of SKIN_KEYS) {
      const skin = SKINS[id];
      const tile = el('button', `stile${skin.legend ? ' legend' : ''}`);
      tile.type = 'button';
      const art = el('div', 'st-art');
      const sw = el('div', 'st-sw');
      if (skin.hull != null) sw.style.setProperty('--sw', skin.swatch ?? `#${skin.hull.toString(16).padStart(6, '0')}`);
      else sw.classList.add('team');
      const img = el('img', 'st-img');
      img.alt = '';
      img.draggable = false;
      const lock = el('span', 'st-lock');
      lock.append(html(ICON.lock));
      art.append(sw, img, lock);
      const name = el('b', 'st-name', skin.name);
      const state = el('small', 'st-state');
      tile.append(art, name, state);
      tile.addEventListener('click', () => this.pickSkin(id));
      this.tiles.set(id, { tile, img, state });
    }
    $('skin-grid').replaceChildren(...[...this.tiles.values()].map((t) => t.tile));
  }

  buildStore() {
    this.shop = new Map();
    for (const type of TANK_KEYS) {
      const def = TANK_TYPES[type];
      const card = el('button', 'scard');
      card.type = 'button';
      const img = el('img', 'tc-img');
      img.alt = '';
      img.draggable = false;
      const art = el('div', 'tc-art');
      art.append(img, el('div', 'tc-shadow'));
      const cls = tankClass(def);
      const head = el('div', 'sc-head');
      head.append(classIcon(cls), el('span', 'sc-class', CLASSES[cls]));
      const name = el('b', 'sc-name', def.name);
      const role = el('small', 'sc-role', def.role);
      const tag = el('span', 'sc-tag');
      card.append(art, head, name, role, tag);
      card.addEventListener('click', () => {
        this.storeFocus = type;
        this.note = null;
        this.render();
      });
      loadPortrait(img, type, DEFAULT_SKIN, null);
      this.shop.set(type, { card, tag });
    }
    $('store-grid').replaceChildren(...[...this.shop.values()].map((s) => s.card));
  }

  // Catalogue des équipements : une carte par équipement, rangées par famille.
  buildEquipShop() {
    this.eqCards = new Map();
    const groups = EQUIP_GROUPS.map((name) => {
      const box = el('div', 'eq-group');
      box.append(el('div', 'sub-head', name));
      const grid = el('div', 'store-grid');
      box.append(grid);
      return { box, grid };
    });
    for (const id of EQUIP_IDS) {
      const e = EQUIPMENT[id];
      const card = el('button', 'scard ecard');
      card.type = 'button';
      const tag = el('span', 'sc-tag');
      const have = el('small', 'eq-have');
      card.append(equipTile(id, 1, 'big'), el('b', 'sc-name', e.name), el('small', 'sc-role', equipEffect(id, 1)), tag, have);
      card.addEventListener('click', () => {
        this.storeEq = id;
        this.note = null;
        this.render();
      });
      groups[e.group].grid.append(card);
      this.eqCards.set(id, { card, tag, have });
    }
    $('eq-shop').replaceChildren(...groups.map((g) => g.box));
  }

  buildOps() {
    this.mapCards = new Map();
    for (const key of MAP_KEYS) {
      const map = MAPS[key];
      const card = el('button', 'mcard');
      card.type = 'button';
      const art = el('div', 'mc-art');
      art.style.background = themeOf(map).css;
      const canvas = el('canvas');
      drawMapPreview(canvas, map, 300);
      art.append(canvas);
      const row = el('div', 'mc-info');
      row.append(el('b', '', map.name), el('small', '', map.themeName ?? themeOf(map).name));
      card.append(art, row);
      card.addEventListener('click', () => {
        if (this.isHost && !this.running) this.net.send({ type: 'settings', map: key });
      });
      this.mapCards.set(key, card);
    }
    $('map-grid').replaceChildren(...this.mapCards.values());
    this.raceCards = new Map();
    for (const key of Object.keys(RACE_MAPS)) {
      const map = RACE_MAPS[key];
      const card = el('button', 'mcard');
      card.type = 'button';
      const art = el('div', 'mc-art');
      art.style.background = themeOf(map).css;
      const canvas = el('canvas');
      drawMapPreview(canvas, map, 300);
      art.append(canvas);
      const row = el('div', 'mc-info');
      row.append(el('b', '', map.name), el('small', '', `${Math.round(map.race.length)} m par tour`));
      card.append(art, row);
      card.addEventListener('click', () => {
        if (this.isHost && !this.running) this.net.send({ type: 'settings', raceMap: key });
      });
      this.raceCards.set(key, card);
    }
    $('race-grid').replaceChildren(...this.raceCards.values());
    const challenge = (icon, title, text) => {
      const li = el('li');
      li.append(el('i', '', icon), el('b', '', title), el('span', '', text));
      return li;
    };
    const tip = {
      pad: challenge('⚡', 'Tapis turbo', 'Une flèche lumineuse au sol : turbo pendant 1,3 s.'),
      ramp: challenge('◢', 'Tremplins', 'Plus tu vas vite, plus tu voles loin. Prends un turbo juste avant.'),
      gate: challenge('▮', 'Portes et barres', 'Elles s’ouvrent et se ferment : attends le feu vert ou passe entre les barres.'),
      mud: challenge('≈', 'Boue', 'Elle ralentit, surtout les chars légers. Un tremplin permet de la survoler.'),
      water: challenge('≋', 'Rivière', 'Saute-la ou prends le ponton (et sa porte). À l’eau : retour au dernier point, +3 s.'),
      bump: challenge('●', 'Bumpers', 'Des plots rebondissants qui te renvoient comme une bille de flipper.'),
      shot: challenge('✦', 'Tirs', 'Aucun dégât : un tir pousse. Plus le char tireur est puissant et le char touché léger, plus il est repoussé loin.'),
      void: challenge('⌵', 'Le vide', 'Pas de sol hors de la piste : on tombe, et on repart du dernier point de passage (+3 s). Un tir bien placé suffit.'),
      launch: challenge('⇧', 'Lanceurs', 'Une plaque de gravité te catapulte et te donne de l’élan : c’est elle qui ouvre le raccourci au-dessus de l’abîme.'),
      tile: challenge('▦', 'Dalles', 'Elles clignotent avant de disparaître : lis le rythme, change de colonne.'),
      rotor: challenge('✢', 'Rotors', 'Les barres du réacteur tournent autour du cœur d’énergie et te jettent dans le vide si elles te cueillent.'),
    };
    this.raceTips = {
      meadow: [tip.pad, tip.ramp, tip.gate, tip.mud, tip.water, tip.bump, tip.shot],
      void: [tip.void, tip.pad, tip.launch, tip.tile, tip.rotor, tip.ramp, tip.gate, tip.bump, tip.shot],
    };
    const diffs = Object.entries(DIFFICULTIES).map(([key, d]) => {
      const b = el('button', 'diff-btn');
      b.type = 'button';
      b.dataset.v = key;
      b.append(el('small', '', '★'.repeat(d.stars)), el('b', '', d.name), el('em', ''));
      b.addEventListener('click', () => this.net.send({ type: 'settings', difficulty: key }));
      return b;
    });
    $('difficulty').replaceChildren(...diffs);
  }

  bind() {
    for (const b of $('hub-nav').children) b.addEventListener('click', () => this.setPage(b.dataset.page));
    for (const b of $('sheet-tabs').children) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.render();
      });
    }
    $('btn-logout').addEventListener('click', () => this.ctx.logout());
    $('sheet-to-store').addEventListener('click', () => this.openStore(this.shownTank()));
    $('launch-op').addEventListener('click', () => this.setPage('ops'));
    $('ops-close').addEventListener('click', () => this.setPage('hangar'));
    $('store-close').addEventListener('click', () => this.setPage('hangar'));
    $('btn-start').addEventListener('click', () => this.net.send({ type: 'start' }));
    $('btn-back-game').addEventListener('click', () => this.ctx.backToGame());
    $('btn-spectate').addEventListener('click', () => this.ctx.chooseTeam(null));
    $('car-prev').addEventListener('click', () => this.browse(-1));
    $('car-next').addEventListener('click', () => this.browse(1));
    $('invite-copy').addEventListener('click', () => {
      const addr = this.ctx.lanUrls()[0];
      if (!addr) return;
      navigator.clipboard?.writeText(addr).then(() => this.flash($('invite-copy'), 'Copié !'), () => {});
    });
    for (const b of document.querySelectorAll('.join-team')) {
      b.addEventListener('click', () => {
        if (this.ctx.chooseTeam(b.dataset.team)) this.ctx.afterJoin();
      });
    }
    for (const b of document.querySelectorAll('.add-bot')) b.addEventListener('click', () => this.net.send({ type: 'addBot', team: b.dataset.team }));
    for (const b of $('mode').children) b.addEventListener('click', () => this.net.send({ type: 'settings', mode: b.dataset.v }));
    for (const b of $('rounds').children) b.addEventListener('click', () => this.net.send({ type: 'settings', roundsToWin: Number(b.dataset.v) }));
    for (const b of $('race-laps').children) b.addEventListener('click', () => this.net.send({ type: 'settings', laps: Number(b.dataset.v) }));
    $('cs-pick').addEventListener('click', () => {
      this.net.send({ type: 'settings', mission: this.mapFocus });
      this.setPage('hangar');
    });
    $('store-action').addEventListener('click', () => this.storeAction());
    for (const b of $('store-tabs').children) {
      b.addEventListener('click', () => {
        this.storeTab = b.dataset.s;
        this.note = null;
        this.render();
      });
    }
    $('eq-to-store').addEventListener('click', () => this.openEquipShop());
    $('eq-manage').addEventListener('click', () => {
      this.tab = 'equip';
      this.setPage('hangar');
    });
    for (const b of $('store-filters').children) {
      b.addEventListener('click', () => {
        this.filter = b.dataset.f;
        this.render();
      });
    }
    $('modal-cancel').addEventListener('click', () => this.closeModal());
    $('modal-ok').addEventListener('click', () => this.confirmBuy());
    $('modal').addEventListener('pointerdown', (e) => {
      if (e.target === $('modal')) this.closeModal();
    });
    // flèches : parcourir les chars sans quitter le clavier (hangar) ; boutique : même chose sur le catalogue
    addEventListener('keydown', (e) => {
      if (this.root.classList.contains('hidden') || !this.ctx.game.me) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!$('modal').classList.contains('hidden')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation(); // pas d'ouverture du chat par la même touche
          this.confirmBuy();
        }
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const step = e.key === 'ArrowRight' ? 1 : -1;
      if (this.page === 'hangar') this.browse(step);
      else if (this.page === 'store' && this.storeTab === 'equip') {
        this.storeEq = EQUIP_IDS[(EQUIP_IDS.indexOf(this.storeEq) + step + EQUIP_IDS.length) % EQUIP_IDS.length];
        this.note = null;
        this.render();
      } else if (this.page === 'store') {
        const keys = this.storeKeys();
        this.storeFocus = keys[(keys.indexOf(this.storeFocus) + step + keys.length) % keys.length];
        this.note = null;
        this.render();
      }
    });
  }

  flash(button, text) {
    const old = button.dataset.label ?? button.textContent;
    button.dataset.label = old;
    button.classList.add('flash');
    button.querySelector('b').textContent = text;
    setTimeout(() => {
      button.classList.remove('flash');
      button.querySelector('b').textContent = this.ctx.lanUrls()[0]?.replace('http://', '') ?? '';
    }, 1200);
  }

  // ---------------------------------------------------------------- actions
  // Un char à moi est équipé tout de suite ; un char à acheter est seulement exposé.
  pickTank(type) {
    if (!this.game.me) return;
    this.tankFocus = type;
    this.skinFocus = null;
    if (this.owned(type)) this.net.send({ type: 'tank', tank: type });
    this.render();
    this.scrollToCard(type);
  }

  // Centre la carte du char dans le carrousel (sans faire défiler la page).
  scrollToCard(type, instant = false) {
    const c = this.cards.get(type)?.card, row = $('carousel');
    if (!c) return;
    row.scrollTo({ left: c.offsetLeft - (row.clientWidth - c.offsetWidth) / 2, behavior: instant ? 'instant' : 'smooth' });
  }

  browse(step) {
    const keys = this.order();
    this.pickTank(keys[(keys.indexOf(this.shownTank()) + step + keys.length) % keys.length]);
  }

  // Skin à moi : équipé ; skin verrouillé : on lit sa condition.
  pickSkin(id) {
    if (skinUnlocked(id, this.cleared())) {
      this.skinFocus = null;
      this.net.send({ type: 'skin', skin: id });
    } else {
      this.skinFocus = id === this.skinFocus ? null : id;
    }
    this.render();
  }

  storeAction() {
    if (this.storeTab === 'equip') {
      if ((this.game.account?.credits ?? 0) >= EQUIP_PRICE) this.openModal();
      return;
    }
    const type = this.storeFocus;
    if (this.owned(type)) {
      this.pickTank(type);
      this.note = { text: `${TANK_TYPES[type].name} équipé.`, cls: 'good' };
      this.render();
      return;
    }
    if ((this.game.account?.credits ?? 0) < tankPrice(type)) return;
    this.openModal();
  }

  openModal() {
    const equip = this.storeTab === 'equip';
    const type = this.storeFocus, def = equip ? null : TANK_TYPES[type];
    const credits = this.game.account?.credits ?? 0, price = equip ? EQUIP_PRICE : tankPrice(type);
    this.buying = false;
    $('modal-title').textContent = 'Confirmer l’achat';
    const img = equip ? equipTile(this.storeEq, 1) : el('img', 'tc-img ready');
    if (!equip) loadPortrait(img, type, DEFAULT_SKIN, null);
    const lines = el('div', 'mo-lines');
    const line = (label, value, cls = '') => {
      const l = el('div', `mo-line ${cls}`);
      l.append(el('span', '', label), el('b', '', value));
      return l;
    };
    lines.append(line('Prix', fmtCr(price)), line('Solde actuel', fmtCr(credits)), line('Solde après achat', fmtCr(credits - price), 'after'));
    const head = el('div', 'mo-head');
    head.append(img, el('div', 'mo-name'));
    if (equip) head.lastChild.append(el('small', '', `Équipement · niveau I · ${equipEffect(this.storeEq, 1)}`), el('b', '', EQUIPMENT[this.storeEq].name));
    else head.lastChild.append(el('small', '', def.role), el('b', '', def.name));
    $('modal-body').replaceChildren(head, lines);
    $('modal-ok').disabled = false;
    $('modal-ok').textContent = 'Acheter';
    $('modal').classList.remove('hidden');
    $('modal-ok').focus();
  }

  closeModal() {
    $('modal').classList.add('hidden');
    this.buying = false;
  }

  confirmBuy() {
    if ($('modal').classList.contains('hidden') || this.buying) return;
    this.buying = true;
    $('modal-ok').disabled = true;
    $('modal-ok').textContent = 'Achat en cours…';
    if (this.storeTab === 'equip') this.net.send({ type: 'buyEquip', id: this.storeEq });
    else this.net.send({ type: 'buy', tank: this.storeFocus });
  }

  onBought(msg) {
    this.closeModal();
    this.note = { text: `${TANK_TYPES[msg.tank].name} acheté et équipé !`, cls: 'good' };
    this.tankFocus = null;
    this.storeFocus = msg.tank;
    this.dirty = true;
  }

  onBuyError(msg) {
    this.closeModal();
    this.note = { text: msg.error, cls: 'bad' };
  }

  // Équipements : réponse du serveur à un achat, une fusion, un montage ou un démontage.
  onEquipDone(msg) {
    this.closeModal();
    const note = { text: msg.text, cls: 'good' };
    if (msg.op === 'buyEquip') this.note = note;
    else this.eqNote = note;
    this.eqSig = null;
  }

  onEquipError(msg) {
    this.closeModal();
    this.note = this.eqNote = { text: msg.error, cls: 'bad' };
    this.eqSig = null;
  }

  // -------------------------------------------------------------- affichage
  render() {
    const g = this.game, me = g.me;
    if (!me) return;
    const root = this.root;
    root.dataset.page = this.page;
    document.body.dataset.hubPage = this.page; // le chat se déplace selon la page
    root.classList.toggle('running', this.running);
    root.classList.toggle('is-host', this.isHost);
    if (this.running && this.page === 'store') this.page = 'hangar';
    this.dirty = true;
    this.renderTop();
    this.renderCrew();
    this.renderNameplates();
    this.renderSheet();
    this.renderCarousel();
    this.renderLaunch();
    for (const p of ['hangar', 'ops', 'store']) $(`page-${p}`).classList.toggle('hidden', p !== this.page);
    if (this.page === 'ops') this.renderOps();
    if (this.page === 'store') this.renderStore();
  }

  renderTop() {
    const acc = this.game.account;
    for (const b of $('hub-nav').children) {
      b.classList.toggle('on', b.dataset.page === this.page);
      if (b.dataset.page === 'store') b.disabled = this.running;
    }
    $('nav-ops-sub').textContent = this.campaign ? 'Campagne' : this.race ? 'Course' : 'Escarmouche';
    if (!acc) return;
    $('account-name').textContent = acc.name;
    const r = rankInfo(acc.xp);
    $('account-rank').textContent = r.next ? `${r.rank.name} · ${fmtInt(acc.xp)} / ${fmtInt(r.next.xp)} XP` : `${r.rank.name} · ${fmtInt(acc.xp)} XP`;
    $('account-xp').style.width = `${r.progress * 100}%`;
    $('account-xp').parentElement.title = r.next ? `Prochain grade : ${r.next.name}` : 'Grade maximal';
    $('account-badge').replaceChildren(rankBadge(r.index, RANKS.length - 1));
    $('account-stars').textContent = `${MISSIONS.reduce((n, m) => n + (this.cleared()[m.id] ?? 0), 0)} / ${MISSIONS.length * 3}`;
    $('account-credits').textContent = fmtInt(acc.credits);
    $('account-credits').title = fmtCr(acc.credits);
  }

  // ---- équipage
  renderCrew() {
    const g = this.game, me = g.me, campaign = this.campaign, race = this.race, host = this.isHost, running = this.running;
    let total = 0;
    for (const team of TEAMS) {
      const members = [...g.roster.values()].filter((p) => p.team === team && !p.unit);
      total += members.length;
      const rows = members.map((p) => this.memberRow(p, host, running));
      if (!rows.length) rows.push(el('li', 'empty', 'Personne pour l’instant'));
      $(`list-${team}`).replaceChildren(...rows);
      $(`count-${team}`).textContent = `${members.length} / ${RULES.maxPlayersPerTeam}`;
      const full = members.length >= RULES.maxPlayersPerTeam;
      const squad = document.querySelector(`.squad.${team}`);
      squad.classList.toggle('hidden', (campaign && team === 'red') || (race && team === 'blue'));
      squad.querySelector('.squad-name').textContent = campaign ? 'Escouade' : race ? 'Pilotes' : TEAM_INFO[team].label;
      const join = document.querySelector(`.join-team[data-team=${team}]`);
      join.disabled = me.team === team || full || !this.ctx.canJoinTeam();
      join.textContent = me.team === team ? (campaign ? 'Tu es dans l’escouade' : race ? 'Tu es sur la grille' : 'Tu es dans l’équipe') : campaign ? 'Rejoindre l’escouade' : race ? 'Prendre le départ' : 'Rejoindre';
      const bot = document.querySelector(`.add-bot[data-team=${team}]`);
      bot.classList.toggle('hidden', !host || running);
      bot.disabled = full;
      bot.title = campaign ? 'Ajouter un bot allié' : race ? 'Ajouter un pilote bot' : 'Ajouter un bot dans cette équipe';
    }
    $('crew-title').textContent = campaign ? 'Escouade' : race ? 'Grille de départ' : 'Équipages';
    $('crew-count').textContent = `${[...g.roster.values()].filter((p) => !p.unit).length} en ligne`;
    const spec = [...g.roster.values()].filter((p) => !p.team && !p.unit).map((p) => this.memberRow(p, host, running));
    if (!spec.length) spec.push(el('li', 'empty', 'Personne'));
    $('spectators').replaceChildren(...spec);
    $('btn-spectate').disabled = !me.team;
    const addr = this.ctx.lanUrls()[0];
    $('invite-copy').classList.toggle('hidden', !addr);
    if (!$('invite-copy').classList.contains('flash')) $('lobby-addr').textContent = addr ? addr.replace('http://', '') : '';
    this.teamTotal = total;
  }

  memberRow(p, host, running) {
    const g = this.game;
    const li = el('li', p.id === g.myId ? 'me' : '');
    if (p.rk != null) {
      const rk = el('span', 'rk');
      rk.title = RANKS[p.rk].name;
      rk.append(rankBadge(p.rk, RANKS.length - 1));
      li.append(rk);
    } else if (p.bot) {
      const rk = el('span', 'rk bot');
      rk.append(html(ICON.bot));
      li.append(rk);
    }
    li.append(el('span', 'nm', p.name));
    if (p.id === g.hostId) li.append(el('span', 'tg host', 'hôte'));
    if (p.bot) li.append(el('span', 'tg', 'bot'));
    if (running && !p.im && p.team) li.append(el('span', 'tg', 'suivante'));
    if (host && p.id !== g.myId && (!p.bot || !running)) {
      const b = el('button', 'kick');
      b.type = 'button';
      b.title = `${p.bot ? 'Retirer' : 'Exclure'} ${p.name}`;
      b.append(html(ICON.x));
      b.addEventListener('click', () => this.ctx.kick(p));
      li.append(b);
    }
    return li;
  }

  // ---- bandeaux de nom du char (hangar et boutique)
  renderNameplates() {
    const type = this.showcaseType(), def = TANK_TYPES[type], cls = tankClass(def);
    const locked = !this.owned(type);
    for (const [pre, on] of [['np', this.page === 'hangar'], ['snp', this.page === 'store']]) {
      if (!on) continue;
      if (pre === 'snp' && this.storeTab === 'equip') {
        // boutique d'équipements : le bandeau nomme l'équipement regardé (le char exposé reste celui du hangar)
        const e = EQUIPMENT[this.storeEq];
        $('snp-class').replaceChildren(el('span', '', `Équipement · ${EQUIP_GROUPS[e.group]}`));
        $('snp-name').textContent = e.name;
        $('snp-name').classList.remove('locked');
        const c = el('span', 'chip lock');
        c.append(html(ICON.coin), fmtCr(EQUIP_PRICE));
        $('snp-sub').replaceChildren(el('span', 'chip', equipEffect(this.storeEq, 1)), c);
        continue;
      }
      $(`${pre}-class`).replaceChildren(classIcon(cls), el('span', '', `${CLASSES[cls]} · ${def.role}`));
      $(`${pre}-name`).textContent = def.name;
      $(`${pre}-name`).classList.toggle('locked', locked);
      const sub = $(`${pre}-sub`);
      sub.replaceChildren();
      if (def.trait) sub.append(el('span', 'chip', def.trait));
      if (locked) {
        const c = el('span', 'chip lock');
        c.append(html(ICON.lock), `À acheter · ${fmtCr(tankPrice(type))}`);
        sub.append(c);
      } else if (type === this.equipped()) {
        const c = el('span', 'chip ok');
        c.append(html(ICON.check), 'Équipé');
        sub.append(c);
      }
    }
  }

  // ---- fiche technique et peintures
  renderSheet() {
    for (const b of $('sheet-tabs').children) b.classList.toggle('on', b.dataset.tab === this.tab);
    $('tab-specs').classList.toggle('hidden', this.tab !== 'specs');
    $('tab-equip').classList.toggle('hidden', this.tab !== 'equip');
    $('tab-skins').classList.toggle('hidden', this.tab !== 'skins');
    const type = this.shownTank(), base = TANK_TYPES[type], free = this.owned(type);
    // les jauges montrent le char avec ses équipements ; le repère indique où il en serait sans
    const def = free ? this.fitted(type) : base, fitted = def !== base;
    $('sheet-desc').textContent = base.desc;
    $('sheet-perf').textContent = fitted ? 'Performances · équipé' : 'Performances';
    this.specBars.update(def, fitted ? base : null);
    this.specAcc.update(def);
    const faces = faceChips(def);
    $('sheet-faces').replaceChildren(...(faces ? [el('div', 'sub-head', 'Dégâts reçus selon la face touchée'), faces] : []));
    $('sheet-lock').classList.toggle('hidden', free);
    $('sheet-lock-text').textContent = free ? '' : `Pas encore dans ton hangar · ${fmtCr(tankPrice(type))}`;
    $('sheet-to-store').disabled = this.running;
    this.renderSkins(type);
    this.renderEquip(type, free);
  }

  // ---- onglet Équipement du hangar : emplacements du char et stock du compte
  renderEquip(type, owned) {
    const keys = owned ? this.loadout(type) : [];
    $('equip-count').textContent = `${keys.length}/${EQUIP_SLOTS}`;
    if (this.tab !== 'equip') return;
    const stock = this.stock();
    const sig = JSON.stringify([type, owned, keys, stock, this.race, this.running, this.eqNote]);
    if (sig === this.eqSig) return; // rien n'a changé : on garde les boutons (un clic ne se perd pas dans une reconstruction)
    this.eqSig = sig;
    const def = TANK_TYPES[type];
    $('eq-intro').textContent = `Monte jusqu’à ${EQUIP_SLOTS} équipements différents sur le ${def.name}. Un exemplaire monté quitte le stock ; deux exemplaires identiques du même niveau fusionnent en un niveau supérieur.`;
    const lock = this.race ? 'Course : les équipements sont désactivés dans ce mode.'
      : this.running ? 'Partie en cours : les changements prendront effet à la prochaine manche.' : '';
    $('eq-lock').classList.toggle('hidden', !lock);
    $('eq-lock-text').textContent = lock;
    const send = (msg) => this.net.send({ ...msg, tank: type });

    // emplacements
    $('eq-slots-count').textContent = `${keys.length} / ${EQUIP_SLOTS}`;
    const slots = [];
    for (let i = 0; i < EQUIP_SLOTS; i++) {
      const key = keys[i];
      const b = el('button', `eq-slot${key ? ' full' : ''}`);
      b.type = 'button';
      b.disabled = !owned || !key;
      if (key) {
        const { id, level } = parseEq(key);
        b.title = 'Démonter';
        b.append(equipTile(id, level), el('b', '', EQUIPMENT[id].name), el('small', '', equipEffect(id, level)));
        b.addEventListener('click', () => send({ type: 'unequip', key }));
      } else {
        const ico = el('div', 'eq-ico empty');
        ico.append(html('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>'));
        b.append(ico, el('b', '', 'Libre'), el('small', '', owned ? 'Emplacement vide' : '—'));
      }
      slots.push(b);
    }
    $('eq-slots').replaceChildren(...slots);

    // stock : un exemplaire par ligne (équipement + niveau), rangé par équipement puis niveau décroissant
    const entries = Object.entries(stock).filter(([k, n]) => n > 0 && parseEq(k))
      .sort(([a], [b]) => EQUIP_IDS.indexOf(parseEq(a).id) - EQUIP_IDS.indexOf(parseEq(b).id) || parseEq(b).level - parseEq(a).level);
    $('eq-stock-count').textContent = `${entries.reduce((n, [, c]) => n + c, 0)} pièce(s)`;
    $('eq-empty').classList.toggle('hidden', entries.length > 0);
    const rows = entries.map(([key, count]) => {
      const { id, level } = parseEq(key);
      const misfit = equipMisfit(id, def);
      const mountedSame = keys.find((k) => parseEq(k).id === id);
      const row = el('div', `eq-row${misfit ? ' misfit' : ''}`);
      const info = el('div', 'eq-info');
      info.append(
        el('b', '', EQUIPMENT[id].name),
        el('small', 'eq-meta', `Niveau ${'I'.repeat(level)}${count > 1 ? ` · ×${count} en stock` : ''}`),
        el('small', misfit ? 'bad' : '', misfit ?? equipEffect(id, level)),
      );
      const actions = el('div', 'eq-actions');
      const mount = el('button', 'btn', 'Monter');
      mount.type = 'button';
      mount.disabled = !owned || !!misfit || !!mountedSame || keys.length >= EQUIP_SLOTS;
      mount.title = !owned ? 'Ce char n’est pas dans ton hangar' : misfit ?? (mountedSame ? 'Cet équipement est déjà monté sur ce char' : keys.length >= EQUIP_SLOTS ? 'Plus d’emplacement libre : démonte-en un' : `Monter sur le ${def.name}`);
      mount.addEventListener('click', () => send({ type: 'equip', key }));
      actions.append(mount);
      // fusion : 2 exemplaires du stock, ou 1 du stock + celui monté sur ce char (il garde son emplacement)
      if (level < EQUIP_MAX_LEVEL && (count >= MERGE_COST || (count === MERGE_COST - 1 && keys.includes(key)))) {
        const merge = el('button', 'btn primary', `Fusionner → niv. ${'I'.repeat(level + 1)}`);
        merge.type = 'button';
        merge.title = count >= MERGE_COST ? `${MERGE_COST} exemplaires du stock` : 'Avec l’exemplaire monté sur ce char';
        merge.addEventListener('click', () => send({ type: 'mergeEquip', id, level }));
        actions.append(merge);
      }
      row.append(equipTile(id, level), info, actions);
      return row;
    });
    $('eq-stock').replaceChildren(...rows);
    $('eq-note').textContent = this.eqNote?.text ?? '';
    $('eq-note').className = `eq-note ${this.eqNote?.cls ?? ''}`;
  }

  renderSkins(type) {
    const me = this.game.me, cleared = this.cleared();
    const equipped = me.skin ?? DEFAULT_SKIN;
    if (this.skinFocus === equipped) this.skinFocus = null;
    const shown = this.skinFocus ?? equipped;
    const teamKey = me.team ?? null;
    for (const id of SKIN_KEYS) {
      const t = this.tiles.get(id), open = skinUnlocked(id, cleared);
      t.tile.classList.toggle('on', id === equipped);
      t.tile.classList.toggle('focus', id === shown && id !== equipped);
      t.tile.classList.toggle('locked', !open);
      t.state.textContent = id === equipped ? 'Équipé' : open ? 'Disponible' : 'Verrouillé';
      // aperçu sur le char courant : seulement pour les peintures que le joueur possède
      if (open && this.tab === 'skins') {
        const k = `${type}|${teamKey}`;
        if (t.img.dataset.for !== k) {
          t.img.dataset.for = k;
          loadPortrait(t.img, type, id, SKINS[id].hull == null ? teamKey ?? 'red' : null);
        }
      }
    }
    const skin = SKINS[shown], open = skinUnlocked(shown, cleared);
    $('skin-count').textContent = `${unlockedSkins(cleared).length}/${SKIN_KEYS.length}`;
    const name = $('skin-name');
    name.textContent = skin.name;
    name.classList.toggle('legend', !!skin.legend && open);
    $('skin-desc').textContent = open ? skin.desc : skin.desc;
    const pr = $('skin-progress');
    pr.classList.toggle('hidden', open);
    if (!open) {
      const p = this.skinProgress(shown);
      pr.replaceChildren(el('div', 'sp-hint', skin.hint ?? '?'));
      if (p) {
        const bar = el('div', 'bar');
        const fill = el('i', 'fill');
        fill.style.width = `${(p.have / p.need) * 100}%`;
        bar.append(fill);
        const line = el('div', 'sp-line');
        line.append(el('span', '', p.label), el('b', '', `${p.have} / ${p.need}`));
        pr.append(line, bar);
      }
    }
  }

  skinProgress(id) {
    const u = SKINS[id].unlock, cleared = this.cleared();
    if (!u) return null;
    if (u.all) {
      return { have: MISSIONS.filter((m) => (cleared[m.id] ?? 0) >= u.all).length, need: MISSIONS.length, label: `Missions réussies en ${stars(u.all).replace(/☆/g, '')}` };
    }
    return { have: Math.min(cleared[u.mission] ?? 0, u.stars), need: u.stars, label: `${getMission(u.mission).name} · étoiles` };
  }

  // ---- carrousel de chars
  renderCarousel() {
    const equipped = this.equipped(), shown = this.shownTank(), credits = this.game.account?.credits ?? 0;
    const order = this.order();
    const nodes = [];
    let sepDone = false;
    for (const type of order) {
      const c = this.cards.get(type), open = this.owned(type), price = tankPrice(type);
      if (!open && !sepDone) {
        sepDone = true;
        nodes.push(this.sep);
      }
      c.card.classList.toggle('on', type === shown);
      c.card.classList.toggle('equipped', type === equipped);
      c.card.classList.toggle('locked', !open);
      c.card.classList.toggle('short', !open && credits < price);
      c.badge.replaceChildren();
      c.badge.className = 'tc-badge';
      c.foot.replaceChildren();
      if (type === equipped) {
        c.badge.classList.add('ok');
        c.badge.append(html(ICON.check));
        c.foot.append(el('span', 'ok', 'Équipé'));
      } else if (open) {
        c.foot.append(el('span', '', 'Dans le hangar'));
      } else {
        c.badge.classList.add('lock');
        c.badge.append(html(ICON.lock));
        const p = el('span', 'price');
        p.append(html(ICON.coin), fmtInt(price));
        c.foot.append(p);
      }
      if (open) {
        // emplacements d'équipement occupés (losanges)
        const pips = el('span', 'eq-pips');
        pips.title = 'Équipements montés';
        const n = this.loadout(type).length;
        for (let i = 0; i < EQUIP_SLOTS; i++) pips.append(el('i', i < n ? 'on' : ''));
        c.foot.append(pips);
      }
      nodes.push(c.card);
    }
    reorder($('carousel'), nodes);
    if (this.lastShown !== shown && this.page === 'hangar') {
      this.scrollToCard(shown, this.lastShown === undefined);
      this.lastShown = shown;
    }
    $('car-count').textContent = `${order.filter((k) => this.owned(k)).length} / ${TANK_KEYS.length}`;
  }

  // ---- lancement
  renderLaunch() {
    const g = this.game, me = g.me, campaign = this.campaign, race = this.race, host = this.isHost, running = this.running;
    const hostName = g.roster.get(g.hostId)?.name ?? '?';
    let mode, title, detail, thumb;
    if (race) {
      const map = g.map;
      mode = 'Course';
      title = map.name;
      detail = `${g.settings.laps} tour${g.settings.laps > 1 ? 's' : ''} · ${Math.round(map.race.length)} m`;
      thumb = ['r', g.settings.raceMap, () => drawMapPreview($('launch-thumb'), map, 160)];
    } else if (campaign) {
      const m = getMission(g.settings.mission);
      mode = `Campagne · Chapitre ${ROMAN[m.chapter]}`;
      title = m.name;
      detail = `${DIFFICULTIES[g.settings.difficulty]?.name ?? ''} · ${stars(DIFFICULTIES[g.settings.difficulty]?.stars ?? 1)}`;
      thumb = ['m', m.id, () => drawMapPreview($('launch-thumb'), m.map, 160, m)];
    } else {
      const map = g.map;
      mode = 'Escarmouche';
      title = map.name;
      detail = `Premier à ${g.settings.roundsToWin} manche${g.settings.roundsToWin > 1 ? 's' : ''}`;
      thumb = ['s', g.settings.map, () => drawMapPreview($('launch-thumb'), map, 160)];
    }
    $('launch-mode').textContent = mode;
    $('launch-map').textContent = title;
    $('launch-detail').textContent = detail;
    if (this.shots.launch !== thumb[0] + thumb[1]) {
      this.shots.launch = thumb[0] + thumb[1];
      thumb[2]();
    }
    const start = $('btn-start');
    start.classList.toggle('hidden', running);
    $('btn-back-game').classList.toggle('hidden', !running);
    const label = campaign ? 'Lancer la mission' : race ? 'Lancer la course' : 'Lancer la partie';
    start.querySelector('span').textContent = host ? label : `En attente de ${hostName}`;
    start.disabled = !host || this.teamTotal === 0;
    $('lobby-hint').textContent = running
      ? (this.ctx.inMatch() ? `${campaign ? 'Mission' : race ? 'Course' : 'Partie'} en cours : ${race ? 'la grille est figée' : 'les équipes sont figées'} jusqu’à la fin.`
        : `${campaign ? 'Mission' : race ? 'Course' : 'Partie'} en cours : tu la regardes en spectateur. ${race ? 'Prends ta place sur la grille' : 'Choisis ton équipe'} pour la ${this.ctx.nextGame()}.`)
      : host
        ? (this.teamTotal === 0 ? (campaign ? 'Rejoins l’escouade pour lancer la mission.' : race ? 'Prends le départ pour lancer la course.' : 'Rejoins une équipe pour pouvoir lancer.')
          : campaign ? 'Escouade prête : vérifie la mission et lance.' : race ? 'Seul ? Ajoute des pilotes bots pour une vraie course.' : me.team ? 'Seul ? Ajoute des bots en face et lance.' : 'Rejoins une équipe pour jouer.')
        : `L’hôte, ${hostName}, choisit l’opération et lance la partie.`;
  }

  // ---- page Opérations
  renderOps() {
    const g = this.game, host = this.isHost, running = this.running, campaign = this.campaign;
    const lockOps = !host || running;
    for (const b of $('mode').children) {
      b.classList.toggle('on', b.dataset.v === g.settings.mode);
      b.disabled = lockOps;
    }
    $('ops-note').textContent = running ? 'Une partie est en cours : les réglages sont figés jusqu’à son terme.'
      : host ? '' : 'Seul l’hôte choisit l’opération. Tu vois ici son choix.';
    $('ops-note').classList.toggle('hidden', !running && host);
    if (this.race) {
      this.renderRaceOps(lockOps);
    } else if (!campaign) {
      const map = g.map;
      for (const [key, card] of this.mapCards) {
        card.classList.toggle('on', key === g.settings.map);
        card.disabled = lockOps;
      }
      if (this.shots.map !== g.settings.map) {
        this.shots.map = g.settings.map;
        drawMapPreview($('map-preview'), map, 520);
        $('map-art').style.background = themeOf(map).css;
      }
      $('map-name').textContent = map.name;
      $('map-desc').textContent = map.desc;
      $('map-tags').replaceChildren(el('span', 'chip', themeOf(map).name), el('span', 'chip', `${map.halfX * 2} × ${map.halfZ * 2} m`), el('span', 'chip', 'Jusqu’à 8 contre 8'));
      for (const b of $('rounds').children) {
        b.classList.toggle('on', Number(b.dataset.v) === g.settings.roundsToWin);
        b.disabled = lockOps;
      }
    } else {
      this.renderCampaign(lockOps);
    }
  }

  renderRaceOps(lockOps) {
    const g = this.game, map = g.map, race = map.race;
    for (const [key, card] of this.raceCards) {
      card.classList.toggle('on', key === g.settings.raceMap);
      card.disabled = lockOps;
    }
    if (this.shots.race !== g.settings.raceMap) {
      this.shots.race = g.settings.raceMap;
      drawMapPreview($('race-preview'), map, 620);
      $('race-art').style.background = themeOf(map).css;
      // légende et conseils propres au circuit (le circuit au-dessus du vide n'a ni boue ni rivière)
      const floor = !!race.floor;
      $('race-challenges').replaceChildren(...this.raceTips[floor ? 'void' : 'meadow'].map((li) => li.cloneNode(true)));
      $('race-legend').innerHTML = floor
        ? '<span><i class="lg-route"></i>Piste</span><span><i class="lg-ramp"></i>Tremplin</span><span><i class="lg-pad"></i>Turbo</span><span><i class="lg-launch"></i>Lanceur</span><span><i class="lg-tile"></i>Dalle</span><span><i class="lg-gate"></i>Porte / barre</span>'
        : '<span><i class="lg-route"></i>Circuit</span><span><i class="lg-ramp"></i>Tremplin</span><span><i class="lg-pad"></i>Turbo</span><span><i class="lg-mud"></i>Boue</span><span><i class="lg-water"></i>Rivière</span><span><i class="lg-gate"></i>Porte / barre</span>';
    }
    $('race-name').textContent = map.name;
    $('race-desc').textContent = map.desc;
    $('race-tags').replaceChildren(el('span', 'chip', themeOf(map).name), el('span', 'chip', `${Math.round(race.length)} m par tour`),
      el('span', 'chip', `${race.cps.length - 1} points de passage`), el('span', 'chip', 'Jusqu’à 8 pilotes'));
    for (const b of $('race-laps').children) {
      b.classList.toggle('on', Number(b.dataset.v) === g.settings.laps);
      b.disabled = lockOps;
    }
  }

  renderCampaign(lockOps) {
    const g = this.game, cleared = this.cleared(), unlocked = g.unlocked;
    if (!this.mapFocus) this.mapFocus = g.settings.mission;
    this.campaignMap.render({ cleared, unlocked, selected: g.settings.mission, focus: this.mapFocus });
    const total = MISSIONS.reduce((n, m) => n + (cleared[m.id] ?? 0), 0);
    $('cmap-total').replaceChildren(el('b', '', `${total}`), el('span', '', ` / ${MISSIONS.length * 3} ★`),
      el('small', '', `${MISSIONS.filter((m) => cleared[m.id]).length} / ${MISSIONS.length} missions réussies`));
    const m = getMission(this.mapFocus), idx = MISSIONS.indexOf(m);
    const open = unlocked.includes(m.id), got = cleared[m.id] ?? 0;
    $('cs-chapter').textContent = `Chapitre ${ROMAN[m.chapter]} · ${CHAPTERS[m.chapter]} · Mission ${idx + 1}`;
    $('cs-name').textContent = m.name;
    $('cs-stars').replaceChildren(...[0, 1, 2].map((i) => el('span', i < got ? 'on' : '', '★')));
    if (m.boss) $('cs-stars').append(el('em', 'boss-tag', `Boss · ${UNIT_TYPES[m.boss].name}`));
    if (this.shots.cs !== m.id) {
      this.shots.cs = m.id;
      drawMapPreview($('cs-preview'), m.map, 360, m);
    }
    $('cs-brief').textContent = open ? m.brief : 'Mission verrouillée : réussis la mission précédente (à n’importe quelle difficulté) pour l’ouvrir.';
    $('cs-obj').replaceChildren(...(open ? [el('span', '', 'Objectif'), el('b', '', m.objective.label)] : []));
    $('cs-obj').classList.toggle('hidden', !open);
    const rows = difficultyRows(got);
    for (const b of $('difficulty').children) {
      const key = b.dataset.v, row = rows.find((r) => r.key === key);
      b.classList.toggle('on', key === g.settings.difficulty);
      b.classList.toggle('done', row.done);
      b.querySelector('em').textContent = row.done ? '✓ Réussie' : '—';
      b.disabled = lockOps;
    }
    const byMate = open && !got && idx > 0 && !cleared[MISSIONS[idx - 1].id];
    $('cs-note').textContent = byMate ? 'Ouverte grâce à un équipier : réussis-la pour l’ajouter à ta progression.'
      : m.id === g.settings.mission ? 'Mission actuellement choisie pour l’escouade.' : '';
    const pick = $('cs-pick');
    pick.classList.toggle('hidden', !this.isHost);
    pick.disabled = this.running || !open || m.id === g.settings.mission;
    pick.textContent = m.id === g.settings.mission ? 'Mission choisie' : open ? 'Choisir cette mission' : 'Verrouillée';
  }

  // ---- page Boutique
  storeKeys() {
    return this.order().filter((k) => (this.filter === 'buy' ? !this.owned(k) : this.filter === 'own' ? this.owned(k) : true));
  }

  renderStore() {
    const credits = this.game.account?.credits ?? 0, equipped = this.equipped();
    $('store-credits').textContent = fmtInt(credits);
    const equip = this.storeTab === 'equip';
    for (const b of $('store-tabs').children) b.classList.toggle('on', b.dataset.s === this.storeTab);
    $('store-equip-count').textContent = this.stockTotal() ? this.stockTotal() : '';
    // chars ou équipements : on n'affiche que l'un des deux catalogues et sa fiche
    for (const id of ['store-filters', 'store-grid']) $(id).classList.toggle('hidden', equip);
    $('eq-shop').classList.toggle('hidden', !equip);
    $('eq-detail').classList.toggle('hidden', !equip);
    for (const id of ['store-compare', 'store-stats', 'store-faces', 'store-acc']) $(id).classList.toggle('hidden', equip);
    if (equip) {
      this.renderStoreEquip(credits);
      return;
    }
    const keys = this.storeKeys();
    if (!keys.includes(this.storeFocus) && keys.length) this.storeFocus = keys[0];
    for (const b of $('store-filters').children) {
      b.classList.toggle('on', b.dataset.f === this.filter);
      const n = b.dataset.f === 'buy' ? TANK_KEYS.filter((k) => !this.owned(k)).length : b.dataset.f === 'own' ? TANK_KEYS.filter((k) => this.owned(k)).length : TANK_KEYS.length;
      b.querySelector('small').textContent = n;
    }
    const nodes = [];
    for (const type of this.order()) {
      const s = this.shop.get(type), open = this.owned(type), price = tankPrice(type);
      const visible = keys.includes(type);
      s.card.classList.toggle('hidden', !visible);
      s.card.classList.toggle('on', type === this.storeFocus);
      s.card.classList.toggle('locked', !open);
      s.card.classList.toggle('equipped', type === equipped);
      s.tag.className = `sc-tag${open ? ' own' : credits < price ? ' short' : ''}`;
      s.tag.replaceChildren();
      if (open) s.tag.append(type === equipped ? 'Équipé' : 'Possédé');
      else s.tag.append(html(ICON.coin), fmtInt(price));
      nodes.push(s.card);
    }
    reorder($('store-grid'), nodes);
    $('store-empty').classList.toggle('hidden', keys.length > 0);

    const type = this.storeFocus;
    if (!type) return;
    const def = TANK_TYPES[type], open = this.owned(type), price = tankPrice(type), cls = tankClass(def);
    $('store-class').replaceChildren(classIcon(cls), el('span', '', `${CLASSES[cls]} · ${def.role}`));
    $('store-name').textContent = def.name;
    $('store-trait').textContent = def.trait ?? '';
    $('store-trait').classList.toggle('hidden', !def.trait);
    $('store-desc').textContent = def.desc;
    const eqDef = TANK_TYPES[equipped];
    const compare = type !== equipped;
    this.storeBars.update(def, compare ? eqDef : null);
    this.storeAcc.update(def);
    $('store-compare').textContent = compare ? `Comparé à ${eqDef.name} (équipé)` : 'Ton char équipé';
    const faces = faceChips(def);
    $('store-faces').replaceChildren(...(faces ? [faces] : []));
    $('store-price').replaceChildren(open ? el('b', 'own', price ? 'Dans ton hangar' : 'Fourni') : (() => {
      const w = el('b');
      w.append(html(ICON.coin), fmtInt(price));
      return w;
    })());
    $('store-wallet-bar').classList.toggle('hidden', open);
    if (!open) {
      $('store-wallet-fill').style.width = `${Math.min(1, credits / price) * 100}%`;
      $('store-wallet-text').textContent = credits >= price ? `Solde après achat : ${fmtCr(credits - price)}` : `Il te manque ${fmtCr(price - credits)}`;
      $('store-wallet-text').classList.toggle('short', credits < price);
    }
    const action = $('store-action');
    if (open) {
      action.textContent = type === equipped ? 'Équipé' : 'Équiper ce char';
      action.disabled = type === equipped;
    } else {
      action.textContent = credits >= price ? `Acheter · ${fmtCr(price)}` : 'Crédits insuffisants';
      action.disabled = credits < price;
    }
    action.classList.toggle('ready', !open && credits >= price);
    $('store-note').textContent = this.note?.text ?? '';
    $('store-note').className = this.note?.cls ?? '';
  }

  // ---- boutique : catalogue et fiche des équipements (achat au niveau I, prix unique)
  renderStoreEquip(credits) {
    const id = this.storeEq, e = EQUIPMENT[id];
    $('store-empty').classList.add('hidden');
    $('store-trait').classList.add('hidden');
    for (const [key, c] of this.eqCards) {
      const have = this.haveOf(key), total = have.stock + have.mounted;
      c.card.classList.toggle('on', key === id);
      c.tag.className = `sc-tag${credits < EQUIP_PRICE ? ' short' : ''}`;
      c.tag.replaceChildren(html(ICON.coin), fmtInt(EQUIP_PRICE));
      c.have.className = `eq-have${total ? ' on' : ''}`;
      c.have.textContent = total ? `Possédé ×${total}` : 'Pas encore possédé';
    }
    $('store-class').replaceChildren(el('span', '', `Équipement · ${EQUIP_GROUPS[e.group]}`));
    $('store-name').textContent = e.name;
    $('store-desc').textContent = e.desc;
    $('eq-levels').replaceChildren(...[1, 2, 3].map((lv) => {
      const row = el('div', 'eq-level');
      const text = el('div');
      text.append(el('b', '', equipEffect(id, lv)), el('small', '', lv === 1 ? 'Achat à la boutique' : `Fusion de ${MERGE_COST} équipements niveau ${'I'.repeat(lv - 1)}`));
      row.append(equipTile(id, lv), text);
      return row;
    }));
    const misfits = equipMisfits(id);
    $('eq-compat').replaceChildren(...(misfits.length
      ? misfits.map((m) => {
        const chip = el('span', 'chip bad', `${TANK_TYPES[m.type].name} · ${m.reason.toLowerCase()}`);
        return chip;
      })
      : [el('span', 'chip ok', 'Compatible avec tous les chars')]));
    const have = this.haveOf(id), levels = [1, 2, 3].map((lv) => [lv, this.stock()[eqKey(id, lv)] ?? 0]).filter(([, n]) => n > 0);
    const parts = [...levels.map(([lv, n]) => `${n} × niveau ${'I'.repeat(lv)}`)];
    if (have.mounted) parts.push(`${have.mounted} monté${have.mounted > 1 ? 's' : ''} sur un char`);
    $('eq-owned').textContent = parts.length ? parts.join(' · ') : 'Aucun exemplaire.';
    $('store-price').replaceChildren((() => {
      const w = el('b');
      w.append(html(ICON.coin), fmtInt(EQUIP_PRICE));
      return w;
    })());
    $('store-wallet-bar').classList.remove('hidden');
    $('store-wallet-fill').style.width = `${Math.min(1, credits / EQUIP_PRICE) * 100}%`;
    $('store-wallet-text').textContent = credits >= EQUIP_PRICE ? `Solde après achat : ${fmtCr(credits - EQUIP_PRICE)}` : `Il te manque ${fmtCr(EQUIP_PRICE - credits)}`;
    $('store-wallet-text').classList.toggle('short', credits < EQUIP_PRICE);
    const action = $('store-action');
    action.textContent = credits >= EQUIP_PRICE ? `Acheter · ${fmtCr(EQUIP_PRICE)}` : 'Crédits insuffisants';
    action.disabled = credits < EQUIP_PRICE;
    action.classList.toggle('ready', credits >= EQUIP_PRICE);
    $('store-note').textContent = this.note?.text ?? '';
    $('store-note').className = this.note?.cls ?? '';
  }
}
