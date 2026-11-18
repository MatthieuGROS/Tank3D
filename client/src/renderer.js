// Scène Three.js : décor, chars (avec leur animation et leurs effets), caméra.
// Ne contient aucune règle de jeu.
import * as THREE from 'three';
import { TEAM_INFO, UNIT_TYPES, DEFAULT_TANK, PICKUPS } from '/shared/constants.js';
import { marchRay, pointBlocked, heightAt, inBush } from '/shared/map.js';
import { lerpAngle, angleDiff, clamp } from '/shared/tank.js';
import { SKINS, DEFAULT_SKIN } from '/shared/skins.js';
import { createTankModel, SKIN_TIME } from './models/tank.js';
import { createMapModel, THEMES } from './models/map.js';
import { Q } from './quality.js';
import { DETAIL } from './gfx.js';
import { EffectComposer } from '/vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/three-addons/postprocessing/OutputPass.js';
import { GTAOPass } from '/vendor/three-addons/postprocessing/GTAOPass.js';
import { ShaderPass } from '/vendor/three-addons/postprocessing/ShaderPass.js';

// Étalonnage « cinéma » (en HDR, avant le tone mapping) : contraste, teinte chaude des lumières / froide des ombres,
// vignettage et grain fin.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uAmount; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 warm = vec3(1.06, 1.0, 0.92), cool = vec3(0.92, 0.98, 1.08);
      vec3 col = c.rgb * mix(cool, warm, smoothstep(0.05, 0.9, l));
      col = mix(vec3(l), col, 1.08);                                   // saturation
      col = (col - 0.18) * 1.12 + 0.18;                                // contraste autour du gris moyen
      float v = smoothstep(1.05, 0.35, length(vUv - 0.5) * 1.35);
      col *= mix(1.0, v, 0.55 * uAmount);                              // vignettage
      col += (hash(vUv * 1000.0) - 0.5) * 0.025 * uAmount;             // grain
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

// Couleur du haut du ciel selon l'ambiance (l'horizon prend la couleur du brouillard)
const ZENITH = { meadow: 0x3f7cc4, desert: 0x5f9bd0, dusk: 0x3b4678, snow: 0x7fa6cf, blizzard: 0x8b98a4 };

// Dôme de ciel : dégradé horizon -> zénith, halo et disque du soleil. Les valeurs > 1 (soleil) alimentent le bloom et les reflets.
function makeSkyMaterial(horizon, zenith, sunDir, sunColor) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(horizon) },
      uZenith: { value: new THREE.Color(zenith) },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(sunColor) },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uHorizon, uZenith, uSunDir, uSunColor;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.3, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (smoothstep(0.9993, 0.9999, s) * 5.0 + pow(s, 60.0) * 0.5 + pow(s, 6.0) * 0.12);
        col = mix(col, uHorizon, exp(-max(h, 0.0) * 9.0) * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

const SKY = 0xa9cbe6;
const CAM_DIST = 12.5;
const CAM_PITCH = -0.17; // légère plongée
const CAM_TARGET_Y = 3.2;
const FX_RANGE = 120; // au-delà, on n'émet plus de poussière / fumée

export class Renderer {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: Q.s.aa, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = true;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 110, 330);
    this.pmrem = new THREE.PMREMGenerator(this.gl);
    this.envCache = new Map();
    this.theme = THEMES.meadow;
    this.themeKey = 'meadow';
    this.fogBase = [110, 330];
    this.composer = null;
    this.sky = null;

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

    this.pr = 0;
    this.shadowKey = '';
    Q.onChange(() => this.applyQuality());
    this.applyQuality();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const pr = this.pixelRatio();
    this.pr = pr;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(innerWidth, innerHeight, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  pixelRatio() {
    return Math.max(0.4, Math.min(devicePixelRatio, 2) * Q.s.renderScale * Q.dynScale);
  }

  // Applique les réglages graphiques (au démarrage et à chaque changement dans le panneau).
  applyQuality() {
    const s = Q.s;
    DETAIL.value = s.detail ? 1 : 0;

    // ombres : taille de la carte et filtrage
    const sun = this.sun;
    sun.castShadow = s.shadows > 0;
    const size = [512, 1024, 2048, 4096][s.shadows];
    const type = s.shadows >= 3 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const key = `${size}:${type}`;
    if (key !== this.shadowKey && s.shadows > 0) {
      this.shadowKey = key;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      if (this.gl.shadowMap.type !== type) {
        this.gl.shadowMap.type = type;
        this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      }
    }

    // reflets du ciel
    this.scene.environment = s.reflections ? this.envCache.get(this.themeKey) ?? null : null;
    this.hemi.intensity = this.theme.hemi[2] * (s.reflections ? 0.5 : 1);

    // distance d'affichage
    this.scene.fog.near = this.fogBase[0] * s.viewDist;
    this.scene.fog.far = this.fogBase[1] * s.viewDist * (this.fogBase[1] > 250 ? 1.45 : 1); // brume plus lointaine : les montagnes restent lisibles
    this.camera.far = Math.max(300, 600 * s.viewDist);
    this.camera.updateProjectionMatrix();

    // bloom : passe par un compositeur (rendu en demi-flottant, MSAA 4x si activé)
    const post = s.bloom || s.ao || s.grade;
    const postKey = `${s.bloom}${s.ao}${s.grade}${s.aa}`;
    if (this.composer && (!post || postKey !== this.postKey)) {
      this.composer.dispose();
      this.composer = null;
    }
    if (post && !this.composer) {
      this.postKey = postKey;
      const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: s.aa ? 4 : 0 });
      this.composer = new EffectComposer(this.gl, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (s.ao) {
        // occlusion ambiante : assombrit les creux (dessous des chars, pieds de murs, coins)
        const gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
        gtao.output = GTAOPass.OUTPUT.Default;
        gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.1, samples: 12 });
        this.composer.addPass(gtao);
      }
      if (s.bloom) {
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 1.1);
        this.composer.addPass(this.bloomPass);
      }
      if (s.grade) {
        this.gradePass = new ShaderPass(GradeShader);
        this.composer.addPass(this.gradePass);
      } else this.gradePass = null;
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  // Ciel + carte d'environnement (reflets) d'une ambiance, mis en cache.
  setSky(themeKey) {
    const theme = THEMES[themeKey] ?? THEMES.meadow;
    this.theme = theme;
    this.themeKey = themeKey;
    const zenith = ZENITH[themeKey] ?? ZENITH.meadow;
    const sunDir = this.sun.position.clone().normalize();
    const sunCol = new THREE.Color(theme.sun[0]);
    if (this.sky) { this.scene.remove(this.sky); this.sky.geometry.dispose(); this.sky.material.dispose(); }
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), makeSkyMaterial(theme.sky, zenith, sunDir, sunCol));
    this.sky.scale.setScalar(450);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.background = null;
    if (!this.envCache.has(themeKey)) {
      const envScene = new THREE.Scene();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), makeSkyMaterial(theme.sky, zenith, sunDir, sunCol));
      dome.scale.setScalar(50);
      envScene.add(dome);
      this.envCache.set(themeKey, this.pmrem.fromScene(envScene, 0.02).texture);
      dome.geometry.dispose();
      dome.material.dispose();
    }
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
    this.fogBase = theme.fog;
    this.scene.fog.color.set(theme.sky);
    this.hemi.color.set(theme.hemi[0]);
    this.hemi.groundColor.set(theme.hemi[1]);
    this.sun.color.set(theme.sun[0]);
    this.sun.intensity = theme.sun[1];
    this.setSky(THEMES[map.theme] ? map.theme : 'meadow');
    this.applyQuality();
    for (const pk of this.pickups.values()) this.scene.remove(pk.group);
    this.pickups.clear();
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

  makeTank(type, team, skin = DEFAULT_SKIN) {
    const idColor = TEAM_INFO[team]?.color ?? null;
    const t = {
      // sans équipe (salon) : vert kaki neutre
      model: createTankModel(type, idColor ?? 0x6f7a52, { skin: SKINS[skin] ?? SKINS[DEFAULT_SKIN], idColor }), type, team, skin, wrecked: false,
      recoil: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,
      lastSpeed: 0, lastYaw: null, accel: 0, wheel: 0, dust: 0, mark: 0, exhaust: 0, smoke: 0,
    };
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
    for (const [id, v] of views) {
      let t = this.tanks.get(id);
      if (!t || t.team !== v.team || t.type !== v.type || t.skin !== v.skin) {
        if (t) this.dropTank(t);
        t = this.makeTank(v.type, v.team, v.skin);
        this.tanks.set(id, t);
      }
      if (t.wrecked !== !v.alive) {
        t.wrecked = !v.alive;
        t.model.setWrecked(t.wrecked);
      }
      this.setBubble(t, !!v.shield && v.alive, (UNIT_TYPES[v.type] ?? UNIT_TYPES[DEFAULT_TANK]).radius, performance.now() / 1000);
      this.animateTank(t, v, dt, Math.hypot(v.x - cam.x, v.z - cam.z) < FX_RANGE);
    }
    this.mapModel?.bushes.update(views, performance.now() / 1000, dt);
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
    if (this.map?.hills) {
      const map = this.map, hl = m.trackX ?? 1.6, hz = 2;
      gy = heightAt(v.x, v.z, map);
      const front = heightAt(wx(0, hz), wz(0, hz), map), back = heightAt(wx(0, -hz), wz(0, -hz), map);
      const left = heightAt(wx(hl, 0), wz(hl, 0), map), right = heightAt(wx(-hl, 0), wz(-hl, 0), map);
      const k = Math.min(1, dt * 10);
      t.slopePitch = (t.slopePitch ?? 0) + (-Math.atan2(front - back, 2 * hz) - (t.slopePitch ?? 0)) * k;
      t.slopeRoll = (t.slopeRoll ?? 0) + (Math.atan2(left - right, 2 * hl) - (t.slopeRoll ?? 0)) * k;
      m.group.rotation.order = 'YXZ';
      m.group.rotation.x = t.slopePitch;
      m.group.rotation.z = t.slopeRoll;
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

    if (v.alive && !m.static) {
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
  followCamera(x, z, yaw, dt, snap) {
    this.camYaw = snap ? yaw : lerpAngle(this.camYaw, yaw, 1 - Math.exp(-dt * 9));
    const cp = Math.cos(CAM_PITCH);
    const dx = Math.sin(this.camYaw) * cp, dy = Math.sin(CAM_PITCH), dz = Math.cos(this.camYaw) * cp;
    // on rapproche la caméra si un obstacle se trouve entre elle et le char
    // (test aussi 1,3 m plus bas pour garder une marge au-dessus des obstacles)
    const low = (px, py, pz) => pointBlocked(px, py - 1.3, pz, this.map);
    const gy = heightAt(x, z, this.map); // la caméra suit le relief
    const free = marchRay(x, gy + CAM_TARGET_Y, z, -dx, -dy, -dz, CAM_DIST, 0.5, this.map, low);
    const wanted = Math.max(3, free < CAM_DIST ? free - 0.6 : CAM_DIST);
    this.camDist = wanted < this.camDist ? wanted : this.camDist + (wanted - this.camDist) * (1 - Math.exp(-dt * 4));
    if (this.map.hills) {
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
    const cp = Math.cos(pitch);
    this.camYaw = yaw;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(x + Math.sin(yaw) * cp, y + Math.sin(pitch), z + Math.cos(yaw) * cp);
  }

  // Salon : la caméra tourne lentement autour du char exposé.
  garageCamera(time) {
    const z = this.focus(), a = time * 0.22 + 0.6;
    const gy = heightAt(z.x, z.z, this.map); // la zone peut être au sommet d'une colline
    this.camera.position.set(z.x + Math.sin(a) * 11.5, gy + 3.6, z.z + Math.cos(a) * 11.5);
    // visée sous le char : il remonte entre le nom (en haut) et la fiche technique (en bas)
    this.camera.lookAt(z.x, gy + 0.2, z.z);
  }

  // Vue d'ensemble tournante (écran d'accueil, fin de partie).
  orbitCamera(time) {
    const a = time * 0.08;
    const r = Math.max(85, Math.max(this.map.halfX, this.map.halfZ) * 1.25);
    this.camera.position.set(Math.sin(a) * r, 48 + r * 0.1, Math.cos(a) * r);
    this.camera.lookAt(0, 0, 0);
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
    this.sky?.position.copy(this.camera.position);
    // résolution dynamique : on ne touche à la taille que si elle a vraiment changé
    if (Math.abs(this.pixelRatio() - this.pr) > 0.04) this.resize();
    if (this.gradePass) this.gradePass.uniforms.uTime.value = (performance.now() % 1000) / 1000;
    if (this.composer) this.composer.render();
    else this.gl.render(this.scene, this.camera);
  }
}
