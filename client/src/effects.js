// Effets visuels : obus, explosions, flammes de bouche, poussière, traces de chenilles,
// fumée, éclairs lumineux. Purement cosmétique : dégâts et impacts sont décidés par le serveur.
import * as THREE from 'three';
import { pointBlocked, heightAt } from '/shared/map.js';
import { shellHeight, arcPoint } from '/shared/tank.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const MAX_PARTICLES = 900;
const MARKS = 700; // nombre de traces de chenilles gardées au sol
const MARK_LIFE = 14; // secondes

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.map = null; // carte courante (pour faire disparaître les obus au contact du décor)
    this.particles = [];
    this.shells = new Map(); // id serveur (ou clé locale) -> obus affiché
    this.unconfirmed = []; // mes tirs prédits, en attente de confirmation du serveur
    this.localCount = 0;
    this.time = 0;
    this.warnings = [];
    this.geo = {
      blob: new THREE.IcosahedronGeometry(1, 0),
      shard: new THREE.TetrahedronGeometry(1, 0),
      ring: new THREE.RingGeometry(0.72, 1, 20).rotateX(-Math.PI / 2),
      cone: new THREE.ConeGeometry(0.45, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      shell: new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6).rotateX(Math.PI / 2),
      trail: new THREE.BoxGeometry(0.07, 0.07, 6).translate(0, 0, -3.5),
      glow: new THREE.IcosahedronGeometry(0.28, 0),
    };
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.55, depthWrite: false });
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.4, depthWrite: false });

    // Éclairs lumineux : quelques lampes créées une fois pour toutes puis réutilisées
    // (ajouter une lampe en cours de jeu obligerait à recompiler tous les shaders).
    this.lights = Array.from({ length: 4 }, () => {
      const l = new THREE.PointLight(0xffc070, 0, 45, 1.6);
      l.userData.left = 0;
      scene.add(l);
      return l;
    });
    this.nextLight = 0;

    // Traces de chenilles : un seul maillage de rectangles recyclés, avec transparence par sommet.
    const pos = new Float32Array(MARKS * 12);
    const col = new Float32Array(MARKS * 16);
    const index = [];
    for (let i = 0; i < MARKS; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(index);
    this.marks = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    scene.add(this.marks);
    this.markBorn = new Float32Array(MARKS).fill(-1e9);
    this.nextMark = 0;
  }

  // Hauteur du sol en (x, z) : 0 sur une carte plate.
  ground(x, z) {
    return this.map?.hills ? heightAt(x, z, this.map) : 0;
  }

  // ---------------------------------------------------------------- obus

  spawnShell(key, x, y, z, dx, dz, startDist, speed, maxDist, size = 1, vy, g = 0) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this.geo.shell, this.shellMat), new THREE.Mesh(this.geo.glow, this.glowMat), new THREE.Mesh(this.geo.trail, this.trailMat));
    mesh.rotation.order = 'YXZ'; // cap puis inclinaison
    mesh.rotation.y = Math.atan2(dx, dz);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    const s = { mesh, x, y, z, dx, dz, dist: startDist, speed, maxDist, age: 0, vy, g };
    mesh.position.set(x + dx * startDist, shellHeight(y, startDist, vy, g), z + dz * startDist);
    // carte à relief : l'obus est incliné selon sa pente
    if (vy !== undefined) mesh.rotation.x = -Math.atan(vy);
    this.shells.set(key, s);
    return s;
  }

  // Tir prédit localement : l'obus part tout de suite, sans attendre le serveur.
  spawnLocalShell(...args) {
    const key = `local${this.localCount++}`;
    this.spawnShell(key, ...args);
    this.unconfirmed.push(key);
  }

  // Le serveur confirme mon tir : on rattache l'obus déjà affiché à son identifiant officiel,
  // et on le recale sur la vraie trajectoire (la dispersion est tirée côté serveur).
  confirmLocalShell(id, ev) {
    while (this.unconfirmed.length) {
      const key = this.unconfirmed.shift();
      const s = this.shells.get(key);
      if (!s) continue;
      this.shells.delete(key);
      this.shells.set(id, s);
      if (ev) {
        s.dx = ev.dx;
        s.dz = ev.dz;
        s.vy = ev.vy;
        s.mesh.rotation.y = Math.atan2(ev.dx, ev.dz);
        s.mesh.rotation.x = ev.vy !== undefined ? -Math.atan(ev.vy) : 0;
      }
      return true;
    }
    return false;
  }

  // Obus de mortier : trajectoire en cloche + cercle rouge à l'endroit de l'impact.
  spawnArcShell(key, x, y, z, tx, tz, seconds, peak, radius) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this.geo.glow, this.shellMat), new THREE.Mesh(this.geo.glow, this.glowMat));
    mesh.children[0].scale.setScalar(1.3);
    mesh.children[1].scale.setScalar(2.2);
    this.scene.add(mesh);
    this.shells.set(key, { mesh, arc: { x, y, z, tx, tz, peak, y1: this.ground(tx, tz) + 0.3 }, T: seconds, age: 0, smoke: 0 });
    this.warning(tx, tz, radius, seconds);
  }

  // Cercle d'alerte au sol : se remplit jusqu'à l'impact.
  warning(x, z, radius, seconds) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a22, transparent: true, opacity: 0.85, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a22, transparent: true, opacity: 0.22, depthWrite: false }));
    const gy = this.ground(x, z);
    ring.position.set(x, gy + 0.14, z);
    disc.position.set(x, gy + 0.13, z);
    ring.renderOrder = disc.renderOrder = 2;
    this.scene.add(ring, disc);
    this.warnings.push({ ring, disc, left: seconds, max: seconds });
  }

  removeShell(key) {
    const s = this.shells.get(key);
    if (!s) return;
    this.scene.remove(s.mesh);
    this.shells.delete(key);
  }

  // ------------------------------------------------------------ particules

  // o : { geo, color, lit, x, y, z, vx, vy, vz, life, s0, s1, gravity, opacity, drag, flat, yaw }
  particle(o) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const opts = { color: o.color, transparent: true, opacity: o.opacity ?? 1, depthWrite: false, side: o.flat ? THREE.DoubleSide : THREE.FrontSide };
    const material = o.lit ? new THREE.MeshLambertMaterial({ ...opts, flatShading: true }) : new THREE.MeshBasicMaterial(opts);
    const mesh = new THREE.Mesh(o.geo ?? this.geo.blob, material);
    mesh.position.set(o.x, o.y, o.z);
    if (o.yaw !== undefined) mesh.rotation.y = o.yaw;
    else if (!o.flat) mesh.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
    mesh.scale.setScalar(o.s0);
    this.scene.add(mesh);
    this.particles.push({
      mesh, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0, life: o.life, max: o.life,
      s0: o.s0, s1: o.s1 ?? o.s0, gravity: o.gravity ?? 0, opacity: o.opacity ?? 1, drag: o.drag ?? 0,
      spin: o.flat || o.yaw !== undefined ? 0 : rnd(-3, 3),
    });
  }

  flashLight(x, y, z, intensity, seconds, color = 0xffc070) {
    const l = this.lights[this.nextLight++ % this.lights.length];
    l.position.set(x, y, z);
    l.color.set(color);
    l.intensity = intensity;
    l.userData.start = intensity;
    l.userData.left = l.userData.max = seconds;
  }

  sparks(x, y, z, count, power = 1) {
    for (let i = 0; i < count; i++) {
      this.particle({ geo: this.geo.shard, color: i % 3 ? 0xffd070 : 0xffffff, x, y, z, vx: rnd(-9, 9) * power, vy: rnd(2, 10) * power, vz: rnd(-9, 9) * power, life: rnd(0.25, 0.6), s0: 0.11, s1: 0.03, gravity: 24 });
    }
  }

  // Paillette dorée qui s'élève doucement en scintillant (skin de prestige)
  glint(x, y, z, color) {
    this.particle({ geo: this.geo.shard, color, x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0.7, 1.6), vz: rnd(-0.3, 0.3), life: rnd(0.7, 1.3), s0: 0.1, s1: 0.01, gravity: -0.4 });
  }

  // Onde de poussière au sol
  shockRing(x, z, size, color = 0xcdbf9a) {
    this.particle({ geo: this.geo.ring, flat: true, lit: true, color, x, y: this.ground(x, z) + 0.12, z, life: 0.45, s0: size * 0.25, s1: size, opacity: 0.5 });
  }

  explosion(x, y, z, scale = 1) {
    const g = this.geo;
    this.particle({ color: 0xfff2b0, x, y, z, life: 0.16, s0: 0.6 * scale, s1: 3.2 * scale });
    for (let i = 0; i < 7; i++) {
      this.particle({ color: i % 2 ? 0xff8a2a : 0xffc04a, x, y, z, vx: rnd(-5, 5) * scale, vy: rnd(1, 7) * scale, vz: rnd(-5, 5) * scale, life: rnd(0.25, 0.5), s0: 0.9 * scale, s1: 0.1 });
    }
    for (let i = 0; i < 6; i++) {
      this.particle({ color: 0x4a4a4a, lit: true, x, y, z, vx: rnd(-2, 2) * scale, vy: rnd(1.5, 4), vz: rnd(-2, 2) * scale, life: rnd(0.9, 1.6), s0: 0.6 * scale, s1: 2.4 * scale, opacity: 0.75, drag: 1.5 });
    }
    for (let i = 0; i < 8; i++) {
      this.particle({ geo: g.shard, color: 0x2c2c2c, lit: true, x, y, z, vx: rnd(-9, 9) * scale, vy: rnd(4, 11) * scale, vz: rnd(-9, 9) * scale, life: rnd(0.6, 1.1), s0: 0.22 * scale, s1: 0.18 * scale, gravity: 22 });
    }
    this.sparks(x, y, z, Math.round(8 * scale), scale);
    this.shockRing(x, z, 4.5 * scale);
    this.flashLight(x, y + 1, z, 260 * scale, 0.28);
  }

  muzzleFlash(x, y, z, dx, dz) {
    const yaw = Math.atan2(dx, dz);
    // dard de flamme dans l'axe du canon + deux jets latéraux (frein de bouche)
    this.particle({ geo: this.geo.cone, color: 0xfff2b0, x, y, z, yaw, life: 0.08, s0: 1.2, s1: 3.4 });
    this.particle({ geo: this.geo.cone, color: 0xffa040, x, y, z, yaw: yaw + 1.35, life: 0.07, s0: 0.7, s1: 1.9 });
    this.particle({ geo: this.geo.cone, color: 0xffa040, x, y, z, yaw: yaw - 1.35, life: 0.07, s0: 0.7, s1: 1.9 });
    this.particle({ color: 0xfff7d0, x, y, z, life: 0.07, s0: 0.5, s1: 1.3 });
    for (let i = 0; i < 6; i++) {
      this.particle({ color: 0xa8a8a8, lit: true, x, y, z, vx: dx * rnd(3, 12) + rnd(-1.5, 1.5), vy: rnd(0.3, 1.8), vz: dz * rnd(3, 12) + rnd(-1.5, 1.5), life: rnd(0.6, 1.1), s0: 0.3, s1: 1.5, opacity: 0.55, drag: 3 });
    }
    this.sparks(x + dx, y, z + dz, 4, 0.6);
    // le souffle soulève la poussière sous la bouche du canon
    this.shockRing(x + dx * 1.5, z + dz * 1.5, 3.4);
    for (let i = 0; i < 5; i++) this.dust(x + dx * rnd(0, 3) + rnd(-1, 1), z + dz * rnd(0, 3) + rnd(-1, 1), 1.3);
    this.flashLight(x + dx, y + 0.4, z + dz, 220, 0.12);
  }

  // Éclats d'un objet du décor qui s'effondre (caisse, arbre, muret…) : morceaux projetés qui retombent.
  debris(x, y, z, color, size = 1, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(2, 7) * size;
      this.particle({
        color, lit: true, x: x + rnd(-0.6, 0.6) * size, y: y + rnd(0, 1) * size, z: z + rnd(-0.6, 0.6) * size,
        vx: Math.cos(a) * v, vy: rnd(3, 8), vz: Math.sin(a) * v, gravity: 18, drag: 0.6,
        life: rnd(0.9, 1.5), s0: rnd(0.25, 0.6) * size, s1: rnd(0.15, 0.35) * size,
      });
    }
    for (let i = 0; i < 6 * size; i++) this.dust(x + rnd(-1.5, 1.5) * size, z + rnd(-1.5, 1.5) * size, 2.2 * size);
  }

  dust(x, z, size = 1) {
    this.particle({ color: 0xb9ab86, lit: true, x, y: this.ground(x, z) + 0.25, z, vx: rnd(-0.7, 0.7), vy: rnd(0.5, 1.6), vz: rnd(-0.7, 0.7), life: rnd(0.5, 0.9), s0: 0.2 * size, s1: 0.75 * size, opacity: 0.3, drag: 1 });
  }

  exhaust(x, y, z, vx, vz, strong) {
    this.particle({ color: strong ? 0x2e2e2e : 0x5a5a5a, lit: true, x, y, z, vx: vx + rnd(-0.3, 0.3), vy: rnd(0.8, 1.6), vz: vz + rnd(-0.3, 0.3), life: rnd(0.4, 0.8), s0: 0.12, s1: strong ? 0.75 : 0.45, opacity: strong ? 0.6 : 0.35, drag: 2 });
  }

  smoke(x, y, z, dark = true) {
    this.particle({ color: dark ? 0x2a2a2a : 0x6a6a6a, lit: true, x: x + rnd(-0.4, 0.4), y, z: z + rnd(-0.4, 0.4), vx: rnd(-0.4, 0.4), vy: rnd(2, 3.2), vz: rnd(-0.4, 0.4), life: rnd(1.6, 2.4), s0: 0.4, s1: 1.9, opacity: dark ? 0.7 : 0.45 });
  }

  flame(x, y, z) {
    this.particle({ color: Math.random() < 0.5 ? 0xff7a1e : 0xffc23a, x: x + rnd(-0.6, 0.6), y, z: z + rnd(-0.6, 0.6), vy: rnd(1.5, 3), life: rnd(0.3, 0.55), s0: rnd(0.35, 0.6), s1: 0.05 });
  }

  // Trace d'une chenille : rectangle sombre posé au sol, qui s'efface avec le temps.
  trackMark(x, z, yaw, width = 0.6, length = 0.5) {
    const i = this.nextMark++ % MARKS;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const pos = this.marks.geometry.attributes.position;
    const corners = [[-width / 2, -length / 2], [width / 2, -length / 2], [width / 2, length / 2], [-width / 2, length / 2]];
    corners.forEach(([lx, lz], k) => {
      const cx = x + lx * cos + lz * sin, cz = z - lx * sin + lz * cos;
      pos.setXYZ(i * 4 + k, cx, this.ground(cx, cz) + 0.045, cz);
    });
    pos.needsUpdate = true;
    this.markBorn[i] = this.time;
  }

  update(dt) {
    this.time += dt;
    for (const [key, s] of this.shells) {
      if (s.arc) {
        s.age += dt;
        const a = s.arc, t = Math.min(1, s.age / s.T);
        const p = arcPoint(a.x, a.y, a.z, a.tx, a.tz, t, a.peak, a.y1);
        s.mesh.position.set(p.x, p.y, p.z);
        s.smoke -= dt;
        if (s.smoke <= 0) {
          s.smoke = 0.05;
          this.particle({ color: 0x8a8a8a, lit: true, x: p.x, y: p.y, z: p.z, life: 0.6, s0: 0.25, s1: 0.8, opacity: 0.45 });
        }
        if (s.age > s.T + 0.5) this.removeShell(key);
        continue;
      }
      s.dist += s.speed * dt;
      s.age += dt;
      const x = s.x + s.dx * s.dist, z = s.z + s.dz * s.dist;
      const sy = shellHeight(s.y, s.dist, s.vy, s.g);
      s.mesh.position.set(x, sy, z);
      // l'obus disparaît au contact du décor ; l'explosion arrive avec l'événement serveur
      if (s.mesh.visible && this.map && pointBlocked(x, sy, z, this.map)) s.mesh.visible = false;
      const orphan = this.unconfirmed.includes(key) && s.age > 0.6;
      if (s.dist > s.maxDist || orphan) {
        this.removeShell(key);
        if (orphan) this.unconfirmed.splice(this.unconfirmed.indexOf(key), 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const t = 1 - p.life / p.max;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.05 + (this.map?.hills ? heightAt(p.mesh.position.x, p.mesh.position.z, this.map) : 0), p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      if (p.spin) p.mesh.rotation.x += p.spin * dt;
      p.mesh.scale.setScalar(p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t)));
      p.mesh.material.opacity = p.opacity * (1 - t * t);
    }

    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.left -= dt;
      const t = 1 - Math.max(0, w.left) / w.max;
      w.disc.scale.setScalar(Math.max(0.01, t));
      w.ring.material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(this.time * (6 + t * 10)));
      if (w.left <= -0.1) {
        this.scene.remove(w.ring, w.disc);
        w.ring.geometry.dispose();
        w.disc.geometry.dispose();
        w.ring.material.dispose();
        w.disc.material.dispose();
        this.warnings.splice(i, 1);
      }
    }

    for (const l of this.lights) {
      if (l.userData.left <= 0) continue;
      l.userData.left -= dt;
      l.intensity = l.userData.left > 0 ? l.userData.start * (l.userData.left / l.userData.max) ** 2 : 0;
    }

    const col = this.marks.geometry.attributes.color;
    for (let i = 0; i < MARKS; i++) {
      const age = this.time - this.markBorn[i];
      if (age > MARK_LIFE + 1) continue;
      const a = Math.max(0, 0.3 * (1 - age / MARK_LIFE));
      for (let k = 0; k < 4; k++) col.setXYZW(i * 4 + k, 0.12, 0.1, 0.07, a);
    }
    col.needsUpdate = true;
  }

  // Bonus ramassé / réapparition : anneau coloré qui s'élargit + étincelles.
  burst(x, z, color, size = 1) {
    this.particle({ geo: this.geo.ring, flat: true, color, x, y: this.ground(x, z) + 0.2, z, life: 0.6, s0: 0.5 * size, s1: 6 * size, opacity: 0.8 });
    for (let i = 0; i < 14; i++) {
      this.particle({ geo: this.geo.shard, color, x, y: 1, z, vx: rnd(-5, 5), vy: rnd(3, 9), vz: rnd(-5, 5), life: rnd(0.4, 0.8), s0: 0.16, s1: 0.04, gravity: 14 });
    }
    this.flashLight(x, 2, z, 120, 0.3, color);
  }

  // Point de chute visé par l'obusier du joueur : cercle blanc au sol (rayon du souffle). null = masqué.
  aimRing(x, z, radius) {
    if (!this.aim) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2), mat);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12).rotateX(-Math.PI / 2), mat);
      this.aim = new THREE.Group();
      this.aim.add(ring, dot);
      this.aim.renderOrder = 3;
      this.scene.add(this.aim);
    }
    this.aim.visible = x != null;
    if (x == null) return;
    this.aim.position.set(x, this.ground(x, z) + 0.16, z);
    this.aim.scale.setScalar(radius);
  }

  clear() {
    for (const key of [...this.shells.keys()]) this.removeShell(key);
    for (const w of this.warnings) this.scene.remove(w.ring, w.disc);
    this.warnings.length = 0;
    this.unconfirmed.length = 0;
    this.markBorn.fill(-1e9);
    this.marks.geometry.attributes.color.array.fill(0);
    this.marks.geometry.attributes.color.needsUpdate = true;
  }
}
