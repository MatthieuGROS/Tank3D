// Scène Three.js : décor, chars (avec leur animation et leurs effets), caméra.
// Ne contient aucune règle de jeu.
import * as THREE from 'three';
import { TEAM_INFO, UNIT_TYPES, DEFAULT_TANK, PICKUPS } from '/shared/constants.js';
import { marchRay, pointBlocked, heightAt, inBush } from '/shared/map.js';
import { lerpAngle, angleDiff, clamp } from '/shared/tank.js';
import { SKINS, DEFAULT_SKIN } from '/shared/skins.js';
import { createTankModel, SKIN_TIME } from './models/tank.js';
import { createMapModel, THEMES } from './models/map.js';

const SKY = 0xa9cbe6;
const CAM_DIST = 12.5;
const CAM_PITCH = -0.17; // légère plongée
const CAM_TARGET_Y = 3.2;
const FX_RANGE = 120; // au-delà, on n'émet plus de poussière / fumée
const GHOST_LAYER = 1; // calque des chars ennemis détectés, redessinés en silhouette derrière le décor
const TANK_LAYER = 2; // calque de tous les chars : la silhouette n'apparaît pas à travers un autre char

export class Renderer {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true }); // stencil : silhouettes
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    // Silhouettes : 1) on marque (stencil) les pixels où un char, quel qu'il soit, est réellement visible ;
    // 2) on dessine la silhouette de l'ennemi là où il est derrière le décor (profondeur plus grande) et non marqué.
    this.ghostMark = new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, depthFunc: THREE.LessEqualDepth,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    });
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0xff5a3c, transparent: true, opacity: 0.45, fog: false, depthWrite: false, depthFunc: THREE.GreaterDepth,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp, // chaque pixel une seule fois
    });
    this.ghostCount = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 110, 330);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 600);
    this.camYaw = 0;
    this.camDist = CAM_DIST;
    this.shake = 0;
    this.kick = 0; // recul de caméra au tir

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b6a4a, 1.5);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2));
    sun.position.set(45, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 65, bottom: -65, near: 10, far: 200 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);

    this.fx = null; // branché par main.js
    this.map = null;
    this.mapModel = null;
    this.zone = null;
    this.tanks = new Map(); // id -> état d'affichage d'un char
    this.showcase = null; // char exposé dans le salon
    this.pickups = new Map(); // bonus ramassables affichés
    this.v = new THREE.Vector3();
    this.bubbleGeo = new THREE.IcosahedronGeometry(1, 2);

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.gl.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // Change de carte : on reconstruit tout le décor à partir des données.
  setMap(map) {
    if (this.baseMap === map) return;
    this.baseMap = map;
    this.brokenKey = null;
    if (this.mapModel) {
      this.scene.remove(this.mapModel.group);
      this.mapModel.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this.map = map;
    this.sun.position.set(45, 80, 30); // cadre d'ombre par défaut (il suit le joueur sur les cartes à relief)
    this.sun.target.position.set(0, 0, 0);
    // ambiance de la carte : ciel, brouillard, lumière
    const theme = THEMES[map.theme] ?? THEMES.meadow;
    this.scene.background.set(theme.sky);
    this.scene.fog.color.set(theme.sky);
    [this.scene.fog.near, this.scene.fog.far] = theme.fog;
    this.hemi.color.set(theme.hemi[0]);
    this.hemi.groundColor.set(theme.hemi[1]);
    this.hemi.intensity = theme.hemi[2];
    this.sun.color.set(theme.sun[0]);
    this.sun.intensity = theme.sun[1];
    for (const pk of this.pickups.values()) this.scene.remove(pk.group);
    this.pickups.clear();
    // circuit au-dessus du vide : le ciel et les planètes sont loin, la caméra voit plus loin (et un peu moins près)
    this.camera.far = map.race?.floor ? 1500 : 600;
    this.camera.near = map.race?.floor ? 0.5 : 0.3;
    this.camera.updateProjectionMatrix();
    this.mapModel = createMapModel(map);
    this.zone = this.mapModel.zone;
    this.scene.add(this.mapModel.group);
  }

  // Objets du décor détruits : masqués (ils réapparaissent à la manche suivante). `live` = carte sans eux.
  setBroken(live, broken) {
    this.map = live;
    if (this.brokenKey === live) return;
    this.brokenKey = live;
    for (const [key, meshes] of this.mapModel.objects) {
      const on = !broken.has(key);
      for (const m of meshes) m.visible = on;
    }
  }

  // ------------------------------------------------------------------ chars

  // color : couleur d'identification d'un pilote de course (sinon celle de son équipe)
  makeTank(type, team, skin = DEFAULT_SKIN, color = null) {
    const idColor = color ?? TEAM_INFO[team]?.color ?? null;
    const t = {
      // sans équipe (salon) : vert kaki neutre
      model: createTankModel(type, idColor ?? 0x6f7a52, { skin: SKINS[skin] ?? SKINS[DEFAULT_SKIN], idColor }), type, team, skin, color, wrecked: false,
      recoil: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,
      lastSpeed: 0, lastYaw: null, accel: 0, wheel: 0, dust: 0, mark: 0, exhaust: 0, smoke: 0,
    };
    t.model.group.traverse((o) => o.layers.enable(TANK_LAYER));
    this.scene.add(t.model.group);
    return t;
  }

  dropTank(t) {
    this.scene.remove(t.model.group);
    t.model.dispose();
    t.bubble?.material.dispose();
  }

  // Bulle de bouclier (bonus, invulnérabilité, Citadelle protégée par ses générateurs).
  setBubble(t, on, radius, time) {
    if (on && !t.bubble) {
      t.bubble = new THREE.Mesh(this.bubbleGeo, new THREE.MeshBasicMaterial({ color: 0x6cc2ff, transparent: true, opacity: 0.18, depthWrite: false }));
      t.bubble.scale.set(radius * 1.35, radius * 1.05, radius * 1.35);
      t.bubble.position.y = radius * 0.35;
      t.model.group.add(t.bubble);
    }
    if (!t.bubble) return;
    t.bubble.visible = on;
    if (on) t.bubble.material.opacity = 0.14 + 0.08 * Math.sin(time * 6);
  }

  // views : Map id -> { x, z, yaw, ty, speed, hp, alive, team, type, skin } ; crée, anime et retire les chars.
  syncTanks(views, dt) {
    for (const [id, t] of this.tanks) {
      if (views.has(id)) continue;
      this.dropTank(t);
      this.tanks.delete(id);
    }
    const cam = this.camera.position;
    SKIN_TIME.value = performance.now() / 1000; // reflets animés des skins
    let ghosts = 0;
    for (const [id, v] of views) {
      let t = this.tanks.get(id);
      if (!t || t.team !== v.team || t.type !== v.type || t.skin !== v.skin || t.color !== (v.color ?? null)) {
        if (t) this.dropTank(t);
        t = this.makeTank(v.type, v.team, v.skin, v.color ?? null);
        this.tanks.set(id, t);
      }
      if (t.wrecked !== !v.alive) {
        t.wrecked = !v.alive;
        t.model.setWrecked(t.wrecked);
      }
      this.setBubble(t, !!v.shield && v.alive, (UNIT_TYPES[v.type] ?? UNIT_TYPES[DEFAULT_TANK]).radius, performance.now() / 1000);
      // char ennemi non détecté : invisible, et sans poussière ni fumée qui le trahiraient
      t.model.group.visible = !v.hidden;
      // char ennemi détecté : sa silhouette reste visible derrière le décor (passe GHOST_LAYER de render())
      const ghost = !!v.ghost;
      if (t.ghost !== ghost) {
        t.ghost = ghost;
        t.model.group.traverse((o) => (ghost ? o.layers.enable(GHOST_LAYER) : o.layers.disable(GHOST_LAYER)));
      }
      if (ghost) {
        ghosts++;
        this.ghostMat.color.set(TEAM_INFO[v.team]?.color ?? 0xff5a3c);
      }
      this.animateTank(t, v, dt, !v.hidden && Math.hypot(v.x - cam.x, v.z - cam.z) < FX_RANGE);
    }
    // bushViewer = char suivi par la caméra (main.js) : le feuillage autour de lui devient transparent
    this.ghostCount = ghosts;
    this.mapModel?.bushes.update(views, performance.now() / 1000, dt, this.bushViewer?.alive ? this.bushViewer : null);
  }

  animateTank(t, v, dt, emit) {
    const m = t.model, fx = this.fx;
    const sin = Math.sin(v.yaw), cos = Math.cos(v.yaw);
    // repère du char -> monde
    const wx = (lx, lz) => v.x + lx * cos + lz * sin;
    const wz = (lx, lz) => v.z - lx * sin + lz * cos;
    const speed = v.alive ? v.speed : 0;
    const moved = Math.abs(speed) * dt;

    // relief : le char suit le sol et s'incline sur la pente (0 partout sur une carte plate)
    let gy = 0;
    const race = !!this.map?.race;
    if (this.map?.hills || race) {
      const map = this.map, hl = m.trackX ?? 1.6, hz = 2;
      gy = race && v.y !== undefined ? v.y : heightAt(v.x, v.z, map); // course : l'altitude vient de la simulation (vol, tremplin)
      const front = heightAt(wx(0, hz), wz(0, hz), map), back = heightAt(wx(0, -hz), wz(0, -hz), map);
      const left = heightAt(wx(hl, 0), wz(hl, 0), map), right = heightAt(wx(-hl, 0), wz(-hl, 0), map);
      const k = Math.min(1, dt * 10);
      // en vol le nez suit la trajectoire (monte puis plonge) ; au sol la caisse suit la pente
      const pitchGoal = race && v.air ? clamp(-Math.atan2(v.vy ?? 0, Math.max(6, Math.abs(speed))), -0.75, 0.75) : -Math.atan2(front - back, 2 * hz);
      const rollGoal = race && v.air ? 0 : Math.atan2(left - right, 2 * hl);
      const kk = race && v.air ? Math.min(1, dt * 5) : k;
      t.slopePitch = (t.slopePitch ?? 0) + (pitchGoal - (t.slopePitch ?? 0)) * kk;
      t.slopeRoll = (t.slopeRoll ?? 0) + (rollGoal - (t.slopeRoll ?? 0)) * kk;
      m.group.rotation.order = 'YXZ';
      m.group.rotation.x = t.slopePitch;
      m.group.rotation.z = t.slopeRoll;
    }
    if (race) {
      // atterrissage : poussière et secousse proportionnelles à la vitesse d'impact
      if (v.air) t.lastVy = v.vy ?? 0;
      else if (t.wasAir) this.onLand?.(v, Math.max(0, -(t.lastVy ?? 0)), gy);
      t.wasAir = !!v.air;
    }
    m.group.position.set(v.x, gy, v.z);
    m.group.rotation.y = v.yaw;
    // buisson : le drapeau descend pour ne pas dépasser du feuillage ; il remonte à plus de 2 m
    if (this.map?.flats) {
      const to = v.alive && inBush(v.x, v.z, this.map, 2) ? 1 : 0;
      const k0 = t.mast ?? 0, k = k0 + (to - k0) * Math.min(1, dt * 4);
      const next = Math.abs(to - k) < 0.005 ? to : k;
      if (next !== k0) m.setMast?.(next);
      t.mast = next;
    }
    m.turret.rotation.y = v.ty - v.yaw;
    t.recoil *= Math.exp(-dt * 9);
    m.barrel.position.z = m.barrelRestZ - t.recoil;

    // roues
    t.wheel += (speed * dt) / m.wheelRadius;
    for (const w of m.wheels) w.rotation.x = t.wheel;

    // suspension : la caisse pique du nez au freinage, se cabre à l'accélération, penche en virage
    if (dt > 0) {
      // bornée et lissée : un choc contre un mur ne doit pas faire sauter la caisse
      const accel = clamp((speed - t.lastSpeed) / dt, -25, 25);
      t.accel += (accel - t.accel) * Math.min(1, dt * 6);
      const yawRate = t.lastYaw === null ? 0 : angleDiff(t.lastYaw, v.yaw) / dt;
      const pitchTarget = v.alive ? clamp(-t.accel * 0.004, -0.045, 0.045) : 0.03;
      const rollTarget = v.alive ? clamp(yawRate * speed * 0.003, -0.035, 0.035) : -0.04;
      t.pitchV += ((pitchTarget - t.pitch) * 110 - t.pitchV * 11) * dt;
      t.rollV += ((rollTarget - t.roll) * 110 - t.rollV * 11) * dt;
      t.pitch = clamp(t.pitch + t.pitchV * dt, -0.1, 0.1);
      t.roll = clamp(t.roll + t.rollV * dt, -0.1, 0.1);
      m.body.rotation.x = t.pitch;
      m.body.rotation.z = t.roll;
    }
    t.lastSpeed = speed;
    t.lastYaw = v.yaw;
    if (!emit) return;

    // skin de prestige : paillettes dorées qui s'élèvent du char
    const aura = SKINS[t.skin]?.aura;
    if (aura && v.alive) {
      t.glint = (t.glint ?? 0) - dt;
      if (t.glint <= 0) {
        t.glint = 0.07 + Math.random() * 0.08;
        const lx = (Math.random() * 2 - 1) * m.trackX * 1.15, lz = (Math.random() * 2 - 1) * -m.rearZ;
        fx.glint(wx(lx, lz), gy + 0.9 + Math.random() * 1.4, wz(lx, lz), aura);
      }
    }

    if (race && v.boost && v.alive && !v.air) {
      // turbo : flammes à l'échappement
      t.boostFx = (t.boostFx ?? 0) - dt;
      if (t.boostFx <= 0) {
        t.boostFx = 0.035;
        for (const [ex, ey, ez] of m.exhausts) fx.flame(wx(ex, ez), gy + ey, wz(ex, ez));
      }
    }
    if (v.alive && !m.static && !v.air) {
      const dir = Math.sign(speed) || 1;
      // traces de chenilles
      t.mark += moved;
      if (t.mark > 0.55) {
        t.mark = 0;
        fx.trackMark(wx(m.trackX, 0), wz(m.trackX, 0), v.yaw);
        fx.trackMark(wx(-m.trackX, 0), wz(-m.trackX, 0), v.yaw);
      }
      // poussière soulevée derrière les chenilles
      t.dust += moved;
      if (t.dust > 1.1 && Math.abs(speed) > 2) {
        t.dust = 0;
        const side = Math.random() < 0.5 ? 1 : -1;
        fx.dust(wx(side * m.trackX, m.rearZ * dir), wz(side * m.trackX, m.rearZ * dir), 0.7 + Math.abs(speed) * 0.06);
      }
      // échappement : plus dense et plus noir quand on accélère
      const pushing = t.accel * dir > 2;
      t.exhaust -= dt;
      if (t.exhaust <= 0) {
        t.exhaust = pushing ? 0.05 : Math.abs(speed) > 1 ? 0.12 : 0.3;
        const [ex, ey, ez] = m.exhausts[Math.random() < 0.5 ? 0 : 1];
        fx.exhaust(wx(ex, ez), gy + ey, wz(ex, ez), -sin * 1.5, -cos * 1.5, pushing);
      }
    }
    // fumée de dégâts, puis épave en feu
    const ratio = v.hp / (v.maxHp ?? (UNIT_TYPES[v.type] ?? UNIT_TYPES[DEFAULT_TANK]).maxHp);
    t.smoke -= dt;
    if (t.smoke <= 0 && (!v.alive || ratio < 0.5)) {
      const [ex, ey, ez] = m.engine;
      const x = wx(ex, ez), z = wz(ex, ez);
      if (!v.alive) {
        t.smoke = 0.16;
        fx.smoke(x, gy + ey, z, true);
        fx.flame(wx(0, 0.3), gy + 1.7, wz(0, 0.3));
      } else {
        t.smoke = ratio < 0.25 ? 0.14 : 0.3;
        fx.smoke(x, gy + ey, z, ratio < 0.25);
        if (ratio < 0.25 && Math.random() < 0.25) fx.sparks(x, gy + ey, z, 2, 0.4);
      }
    }
  }

  // Tir : recul du canon + la caisse encaisse le coup à l'opposé de la direction du tir.
  fireKick(id) {
    const t = this.tanks.get(id);
    if (!t) return;
    t.recoil = 0.6;
    const rel = t.model.turret.rotation.y;
    t.pitchV -= Math.cos(rel) * 1.9;
    t.rollV += Math.sin(rel) * 1.9;
  }

  // Impact reçu : secousse dans une direction aléatoire.
  hitKick(id) {
    const t = this.tanks.get(id);
    if (!t) return;
    t.pitchV += (Math.random() - 0.5) * 3;
    t.rollV += (Math.random() - 0.5) * 3;
  }

  // Char d'exposition dans le salon (null pour le retirer).
  setShowcase(type, team, skin) {
    const s = this.showcase;
    if (!s || s.type !== type || s.team !== team || s.skin !== skin) {
      if (s) this.dropTank(s);
      this.showcase = type ? this.makeTank(type, team, skin) : null;
    }
    if (this.showcase) {
      // replacé à chaque image : la carte peut changer pendant qu'on est au salon
      const c = this.focus();
      this.showcase.model.group.position.set(c.x, heightAt(c.x, c.z, this.map), c.z);
      this.showcase.model.group.rotation.y = c.yaw ?? 0;
    }
  }

  // Point mis en valeur au salon : départ de la mission en campagne, zone centrale sinon.
  focus() {
    return this.map.playerSpawn ?? this.map.zone ?? { x: 0, z: 0 };
  }

  // Bonus : caisses flottantes qui tournent, avec un faisceau lumineux. list = [[id, kind, x, z]]
  syncPickups(list, time) {
    const seen = new Set();
    for (const [id, kind, x, z] of list) {
      seen.add(id);
      let pk = this.pickups.get(id);
      if (!pk) {
        const color = PICKUPS[kind]?.color ?? 0xffffff;
        const group = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshLambertMaterial({ color: 0x2a2f24, flatShading: true }));
        const glow = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.9, flatShading: true });
        const bandA = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.32, 1.16), glow);
        const bandB = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.16, 1.16), glow);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 7, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 3.5;
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
        ring.position.y = 0.08;
        const spin = new THREE.Group();
        spin.add(box, bandA, bandB);
        box.castShadow = true;
        group.add(spin, beam, ring);
        group.position.set(x, 0, z);
        this.scene.add(group);
        pk = { group, spin, phase: id * 1.7 };
        this.pickups.set(id, pk);
      }
      pk.spin.position.y = 1.4 + Math.sin(time * 2.5 + pk.phase) * 0.25;
      pk.spin.rotation.y = time * 1.6 + pk.phase;
      pk.spin.rotation.x = 0.4;
    }
    for (const [id, pk] of this.pickups) {
      if (seen.has(id)) continue;
      this.scene.remove(pk.group);
      pk.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.pickups.delete(id);
    }
  }

  // ----------------------------------------------------------------- caméra

  // Caméra à la 3e personne derrière la tourelle de la cible.
  // y / speedRatio : course. y = altitude du char (la caméra la suit avec retard : on voit le saut), speedRatio = vitesse / vitesse max (champ de vision).
  followCamera(x, z, yaw, dt, snap, y, speedRatio = 0) {
    this.camYaw = snap ? yaw : lerpAngle(this.camYaw, yaw, 1 - Math.exp(-dt * 9));
    const cp = Math.cos(CAM_PITCH);
    const dx = Math.sin(this.camYaw) * cp, dy = Math.sin(CAM_PITCH), dz = Math.cos(this.camYaw) * cp;
    // on rapproche la caméra si un obstacle se trouve entre elle et le char
    // (test aussi 1,3 m plus bas pour garder une marge au-dessus des obstacles)
    // course : les tremplins ne bloquent pas la caméra (sinon elle se retrouve dans le char pendant un saut)
    if (this.map.race && this.camMapSrc !== this.map) {
      this.camMapSrc = this.map;
      this.camMap = { ...this.map, race: undefined };
    }
    const cmap = this.map.race ? this.camMap : this.map;
    const low = (px, py, pz) => pointBlocked(px, py - 1.3, pz, cmap);
    let gy = heightAt(x, z, this.map); // la caméra suit le relief
    if (this.map.race && y !== undefined) {
      this.camBase = snap || this.camBase === undefined ? y : this.camBase + (y - this.camBase) * (1 - Math.exp(-dt * (y > this.camBase ? 5 : 3.2)));
      gy = this.camBase;
    }
    this.setFov(this.map.race ? 58 + 15 * clamp(speedRatio - 0.55, 0, 0.9) : 58);
    const free = marchRay(x, gy + CAM_TARGET_Y, z, -dx, -dy, -dz, CAM_DIST, 0.5, cmap, low);
    const wanted = Math.max(3, free < CAM_DIST ? free - 0.6 : CAM_DIST);
    this.camDist = wanted < this.camDist ? wanted : this.camDist + (wanted - this.camDist) * (1 - Math.exp(-dt * 4));
    if (this.map.hills || this.map.race) {
      // grande carte : le cadre d'ombre suit le joueur au lieu de couvrir toute la carte
      this.sun.position.set(x + 45, 80, z + 30);
      this.sun.target.position.set(x, 0, z);
    }
    const s = this.shake;
    this.shake *= Math.exp(-dt * 8);
    this.kick *= Math.exp(-dt * 7);
    const dist = this.camDist + this.kick;
    this.camera.position.set(
      x - dx * dist + (Math.random() - 0.5) * s,
      gy + CAM_TARGET_Y - dy * dist + (Math.random() - 0.5) * s,
      z - dz * dist + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(x + dx * 10, gy + CAM_TARGET_Y + dy * 10 + this.kick * 0.6, z + dz * 10);
  }

  // Caméra libre (spectateur) : position et orientation (cap, plongée) données directement.
  freeCamera(x, y, z, yaw, pitch) {
    this.setFov(58);
    const cp = Math.cos(pitch);
    this.camYaw = yaw;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(x + Math.sin(yaw) * cp, y + Math.sin(pitch), z + Math.cos(yaw) * cp);
  }

  // Salon : la caméra tourne lentement autour du char exposé.
  garageCamera(time) {
    this.setFov(58);
    const z = this.focus(), a = time * 0.22 + 0.6;
    const gy = heightAt(z.x, z.z, this.map); // la zone peut être au sommet d'une colline
    this.camera.position.set(z.x + Math.sin(a) * 11.5, gy + 3.6, z.z + Math.cos(a) * 11.5);
    // visée sous le char : il remonte entre le nom (en haut) et la fiche technique (en bas)
    this.camera.lookAt(z.x, gy + 0.2, z.z);
  }

  // Vue d'ensemble tournante (écran d'accueil, fin de partie).
  orbitCamera(time) {
    this.setFov(58);
    const a = time * 0.08;
    const r = Math.max(85, Math.max(this.map.halfX, this.map.halfZ) * 1.25);
    this.camera.position.set(Math.sin(a) * r, 48 + r * 0.1, Math.cos(a) * r);
    this.camera.lookAt(0, 0, 0);
  }

  setFov(fov) {
    if (Math.abs(this.camera.fov - fov) < 0.02) return;
    this.camera.fov += (fov - this.camera.fov) * 0.15;
    this.camera.updateProjectionMatrix();
  }

  // Course : anime le décor du circuit (portes, barres, tapis, point de passage à franchir).
  updateRace(clock, time, next) {
    this.mapModel?.race?.update(clock, time, next);
  }

  // Monde -> pixels écran. `front` est faux si le point est derrière la caméra.
  project(x, y, z) {
    this.v.set(x, y, z).project(this.camera);
    return {
      x: (this.v.x * 0.5 + 0.5) * innerWidth,
      y: (-this.v.y * 0.5 + 0.5) * innerHeight,
      front: this.v.z < 1,
    };
  }

  render() {
    const gl = this.gl, scene = this.scene, cam = this.camera;
    gl.render(scene, cam);
    if (!this.ghostCount) return;
    // silhouettes des ennemis détectés : deux passes sur leur seul calque, sans effacer l'image ni la profondeur
    const mask = cam.layers.mask, bg = scene.background;
    gl.autoClear = false;
    gl.shadowMap.autoUpdate = false;
    scene.background = null;
    cam.layers.set(TANK_LAYER);
    scene.overrideMaterial = this.ghostMark;
    gl.render(scene, cam);
    cam.layers.set(GHOST_LAYER);
    scene.overrideMaterial = this.ghostMat;
    gl.render(scene, cam);
    scene.overrideMaterial = null;
    cam.layers.mask = mask;
    scene.background = bg;
    gl.shadowMap.autoUpdate = true;
    gl.autoClear = true;
  }
}
