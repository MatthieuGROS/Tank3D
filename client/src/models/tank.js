// Modèles low-poly des chars, construits par code (aucun fichier 3D à charger).
// L'avant du char pointe vers +Z.
//
// Pour ajouter un char : écrire une fonction build…(color) qui assemble ses pièces avec kit()
// et renvoie finish(…), puis l'inscrire dans TANK_MODELS sous la même clé que dans TANK_TYPES.
// Hiérarchie commune : group (train de roulement) > body (caisse) > turret > barrel.
//
// Skins (shared/skins.js) : `look = { skin, idColor }`. Le skin repeint caisse, tourelle et pièces
// sombres ; les marques d'identification (mats.stripe : bandes de caisse, anneau de tourelle, et le
// fanion d'antenne) prennent la couleur de l'équipe `idColor`, pour reconnaître allié et ennemi.
import * as THREE from 'three';
import { UNIT_MODELS } from './units.js';
import { GLB } from './glb.js';
import { stdMat, addDetail } from '../gfx.js';
import { RoundedBoxGeometry } from '/vendor/three-addons/geometries/RoundedBoxGeometry.js';

// Boîte aux arêtes chanfreinées : les bords accrochent la lumière comme de la vraie tôle.
const box = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(0.045, Math.min(w, h, d) * 0.3));

const WRECK_COLOR = 0x26221f;

// Extrude un profil vu de côté (points [z, y]) sur une largeur donnée (axe X).
function profile(points, width) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// Extrude un contour vu de dessus (points [x, z]) vers le haut, de y = 0 à y = height.
// `bevel` chanfreine les arêtes (le contour grossit d'autant).
function plan(points, height, bevel = 0) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return geo;
}

const cylX = (r1, r2, len, seg) => new THREE.CylinderGeometry(r1, r2, len, seg * 2).rotateZ(Math.PI / 2); // axe X
const cylZ = (r1, r2, len, seg) => new THREE.CylinderGeometry(r1, r2, len, seg * 2).rotateX(Math.PI / 2); // axe Z (r1 vers l'avant)

const STRIPE_COLOR = 0xe9e4d2;

// ------------------------------------------------------------ peintures (skins)
// Tout est calculé dans le shader à partir de la position de chaque sommet : pas de texture
// ni d'UV, le motif suit les volumes de n'importe quelle pièce.
//  - camouflage (SKIN_CAMO) : taches de bruit 3D en 4 couleurs ; `pixel` (m) le découpe en
//    petits carrés (camouflage numérique) ;
//  - filets (SKIN_FILIGREE) : quadrillage de fines lignes en losanges, rétroéclairées (cœur
//    lumineux + halo qui déborde sur la peinture), qu'un reflet parcourt périodiquement de
//    l'avant vers l'arrière du char. Seules les lignes émettent de la lumière.
// uSkinOn = 0 (épave) : on revient à la couleur unie du matériau.
const SKIN_GLSL = `
uniform float uSkinOn;
varying vec3 vSkinPos;
#ifdef SKIN_CAMO
uniform float uCamoScale;
uniform float uCamoPixel;
uniform vec3 uCamoCols[4];
float camoHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float camoNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(camoHash(i), camoHash(i + vec3(1, 0, 0)), f.x), mix(camoHash(i + vec3(0, 1, 0)), camoHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(camoHash(i + vec3(0, 0, 1)), camoHash(i + vec3(1, 0, 1)), f.x), mix(camoHash(i + vec3(0, 1, 1)), camoHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float camoField(vec3 p) { return camoNoise(p) * 0.68 + camoNoise(p * 2.7) * 0.32; }
vec3 camoColor(vec3 p) {
  // léger décalage : une face pile sur une limite de case ne doit pas scintiller
  if (uCamoPixel > 0.0) p = (floor(p / uCamoPixel + 0.013) + 0.5) * uCamoPixel;
  p *= uCamoScale;
  vec3 c = uCamoCols[0];
  if (camoField(p) > 0.55) c = uCamoCols[1];
  if (camoField(p * 1.25 + vec3(13.7, 3.1, 5.3)) > 0.6) c = uCamoCols[2];
  if (camoField(p * 1.6 + vec3(31.2, 17.9, 8.4)) > 0.66) c = uCamoCols[3];
  return c;
}
#endif
#ifdef SKIN_FILIGREE
uniform vec3 uFiliColor;
uniform float uFiliCell;
uniform float uTime;
const float FILI_WIDTH = 0.016; // demi-épaisseur du trait (en fraction de losange)
const float FILI_HALO = 0.075;  // portée du halo lumineux autour du trait
// x : trait (1 sur la ligne, bords adoucis à l'écran) ; y : halo autour du trait.
// De loin, trait et halo s'estompent au lieu de s'épaissir (pas de bouillie de pixels).
vec2 filiLine(float v) {
  float d = abs(fract(v + 0.5) - 0.5);
  float w = fwidth(v);
  float core = (1.0 - smoothstep(FILI_WIDTH, FILI_WIDTH + w, d)) * clamp(FILI_WIDTH * 3.0 / max(w, 1e-4), 0.0, 1.0);
  float halo = 1.0 - smoothstep(FILI_WIDTH, FILI_HALO, d);
  halo *= halo * clamp(FILI_HALO * 1.2 / max(w, 1e-4), 0.0, 1.0);
  return vec2(core, halo);
}
// x : trait ; y : halo ; z : intensité du reflet qui balaie le char
vec3 filigree(vec3 p) {
  vec3 q = p / uFiliCell;
  // deux familles de plans obliques : des losanges sur toutes les faces (dessus, flancs, avant)
  vec2 lines = max(filiLine(q.x * 0.75 + q.y * 0.6 + q.z), filiLine(-q.x * 0.75 + q.y * 0.6 + q.z));
  float sweepZ = 4.5 - mod(uTime * 3.2, 15.0);
  float d = p.z - sweepZ - p.y * 0.35;
  return vec3(lines, exp(-d * d * 1.6));
}
#endif
`;

// Le reflet animé : une seule horloge partagée par tous les chars, avancée par le renderer.
export const SKIN_TIME = { value: 0 };

// Le skin repeint-il caisse et tourelle avec un matériau spécial (motif, laque) ?
const special = (skin) => !!(skin && (skin.camo || skin.filigree || skin.gloss));

// Matériau peint (camouflage et/ou filets) : couleurs assombries de `shade` (tourelle un ton
// plus sombre). Finition brillante si skin.gloss (laque).
function skinMaterial(skin, shade) {
  const camo = skin.camo, fili = skin.filigree;
  const baseColor = new THREE.Color(camo ? camo.colors[0] : skin.hull).multiplyScalar(shade);
  const m = skin.gloss
    ? new THREE.MeshPhysicalMaterial({ color: baseColor, flatShading: true, roughness: Math.max(0.12, 0.6 - skin.gloss / 140), metalness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12 })
    : new THREE.MeshStandardMaterial({ color: baseColor, flatShading: true, roughness: 0.62, metalness: 0.28 });
  const uniforms = { uSkinOn: { value: 1 }, uTime: SKIN_TIME };
  if (camo) {
    uniforms.uCamoScale = { value: 1 / (camo.scale ?? 1) };
    uniforms.uCamoPixel = { value: camo.pixel ?? 0 };
    uniforms.uCamoCols = { value: camo.colors.map((c) => new THREE.Color(c).multiplyScalar(shade)) };
  }
  if (fili) {
    uniforms.uFiliColor = { value: new THREE.Color(fili.color) };
    uniforms.uFiliCell = { value: fili.cell ?? 0.6 };
  }
  m.userData.skin = uniforms;
  const defines = `${camo ? '#define SKIN_CAMO\n' : ''}${fili ? '#define SKIN_FILIGREE\n' : ''}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vSkinPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSkinPos = position;');
    const diffuse = camo ? 'mix( diffuse, camoColor( vSkinPos ), uSkinOn )' : 'diffuse';
    let frag = sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( ${diffuse}, opacity );`);
    if (fili) {
      // filets rétroéclairés : la lumière vient des traits (or, halo qui déborde sur la laque).
      // Au repos ils luisent doucement ; la vague les fait flamboyer (cœur blanc-or, halo élargi)
      // et ne touche qu'à eux : la laque entre les lignes reste noire.
      frag = frag.replace('vec4 diffuseColor = vec4(', 'vec3 fili = filigree( vSkinPos ) * uSkinOn;\n\tvec4 diffuseColor = vec4(');
      frag = frag.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, uFiliColor * 0.3, fili.x );');
      frag = frag.replace('vec3 totalEmissiveRadiance = emissive;', [
        'vec3 totalEmissiveRadiance = emissive',
        '  + uFiliColor * fili.x * ( 0.5 + 1.6 * fili.z )',
        '  + vec3( 0.45, 0.4, 0.25 ) * fili.x * fili.z',
        '  + uFiliColor * fili.y * ( 0.12 + 0.75 * fili.z );',
      ].join('\n\t'));
    }
    sh.fragmentShader = defines + SKIN_GLSL + frag;
  };
  m.customProgramCacheKey = () => `skin:${!!camo}:${!!fili}:${!!skin.gloss}`;
  addDetail(m, { scale: 1.4, strength: skin.gloss ? 0.35 : 0.8, bump: skin.gloss ? 0 : 0.003 });
  return m;
}

// Pièce recolorée par un skin (skin.parts.metal, .wheel, .track, .canvas) : { color, gloss, glow }.
// gloss = brillance (reflets), glow = lueur propre (lisible même à l'ombre).
function partMaterial(mat, part, fallback) {
  if (!part) return mat(fallback);
  if (!part.gloss) return mat(part.color, part.glow ? { emissive: part.color, emissiveIntensity: part.glow } : undefined);
  return new THREE.MeshStandardMaterial({
    color: part.color, roughness: Math.max(0.1, 0.7 - part.gloss / 120), metalness: 0.75,
    emissive: part.color, emissiveIntensity: part.glow ?? 0,
  });
}

// Matériaux aux couleurs de l'équipe (ou du skin) + aide pour poser des pièces.
function kit(teamColor, { skin = null, idColor = null } = {}) {
  // peinture militaire : mate, légèrement métallique, avec usure et poussière (gfx.js)
  const mat = (color, extra) => stdMat(color, { roughness: 0.66, metalness: 0.22, flatShading: true, ...extra }, { scale: 1.5, strength: 0.85, bump: 0.003 });
  const base = new THREE.Color(skin?.hull ?? teamColor);
  // marques d'identification : couleur d'équipe légèrement lumineuse (lisible de loin,
  // au crépuscule, dans le blizzard). Sur la peinture d'équipe, la caisse suffit : bandes claires.
  const painted = skin?.hull != null && idColor != null;
  const id = painted ? new THREE.Color(idColor) : null;
  const mats = {
    hull: special(skin) ? skinMaterial(skin, 1) : mat(base),
    turret: special(skin) ? skinMaterial(skin, 0.88) : mat(skin?.turret ?? base.clone().multiplyScalar(0.82)),
    dark: mat(skin?.dark ?? base.clone().multiplyScalar(0.5)),
    stripe: painted ? mat(id, { emissive: id, emissiveIntensity: 0.3 }) : mat(STRIPE_COLOR),
    flag: mat(idColor ?? STRIPE_COLOR, { side: THREE.DoubleSide, emissive: idColor ?? 0, emissiveIntensity: idColor != null ? 0.35 : 0 }),
    track: skin?.parts?.track ? partMaterial(mat, skin.parts.track, 0x2a2c2e) : addDetail(new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.88, metalness: 0.5, flatShading: true }), { scale: 2.2, strength: 0.9, bump: 0.02, kind: 'track' }),
    wheel: skin?.parts?.wheel ? partMaterial(mat, skin.parts.wheel, 0x60666b) : mat(0x4a4f52, { roughness: 0.82, metalness: 0.3, flatShading: false }),
    metal: skin?.parts?.metal ? partMaterial(mat, skin.parts.metal, 0x3b4046) : stdMat(0x3b4046, { roughness: 0.38, metalness: 0.9 }, { scale: 2.5, strength: 0.6, bump: 0.0015, dustAmt: 0.15 }),
    lamp: new THREE.MeshStandardMaterial({ color: skin?.parts?.lamp ?? 0xfff3c4, emissive: skin?.parts?.lamp ?? 0xffe9a0, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0 }),
    canvas: skin?.parts?.canvas ? partMaterial(mat, skin.parts.canvas, 0x6b6448) : mat(0x6b6448, { roughness: 1, metalness: 0, flatShading: false }), // bâches, sacs, filets
  };
  if (skin?.emblem) {
    const e = skin.emblem;
    const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    mats.emblem = e.gloss
      ? new THREE.MeshStandardMaterial({ color: e.color, roughness: 0.25, metalness: 0.9, emissive: e.color, emissiveIntensity: e.glow ?? 0, ...offset })
      : mat(e.color, offset);
    mats.emblem.userData.kind = skin.emblem.kind ?? 'star';
  }
  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    // pièce camouflée : la géométrie est recalée dans le repère du parent pour que les taches
    // se suivent d'une pièce à l'autre (sinon chaque pièce aurait le même motif centré)
    if (material.userData.skin) {
      geo = geo.clone().translate(x, y, z);
      x = y = z = 0;
    }
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  return { mats, add };
}

// Roue porteuse avec un rayon visible (pour voir la roue tourner).
function roadWheel(add, mats, parent, geo, hubGeo, side, x, y, z) {
  const w = add(parent, geo, mats.wheel, side * x, y, z);
  add(w, hubGeo, mats.track, side * 0.08, 0, 0);
  return w;
}

// Fanion aux couleurs de l'équipe, accroché en haut d'une antenne (x, y = sommet, z), flottant vers l'arrière.
function pennant(add, mats, parent, x, y, z) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, -0.42);
  shape.lineTo(-0.75, -0.21);
  const geo = new THREE.ShapeGeometry(shape).rotateY(-Math.PI / 2); // plan YZ, pointe vers -Z
  const pole = parent.children[parent.children.length - 1]; // l'antenne vient d'être posée juste avant
  const flag = add(parent, geo, mats.flag, x, y, z);
  flag.rotation.y = 0.65; // déporté par le vent : visible aussi de face et de dos
  flag.castShadow = false;
  // antenne + fanion forment un mât qu'on peut rentrer dans le char (buisson : voir setMast)
  const mast = new THREE.Group();
  mast.name = 'mast';
  mast.userData.drop = Math.max(0.5, y - 0.6);
  parent.add(mast);
  mast.add(pole, flag);
  return flag;
}

// Étoile à 5 branches de rayon r centrée en (cx, cy).
function starShape(r, cx = 0, cy = 0) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, d = i % 2 ? r * 0.4 : r;
    shape[i ? 'lineTo' : 'moveTo'](cx + Math.sin(a) * d, cy + Math.cos(a) * d);
  }
  return shape;
}

// Chevron pointe en haut : sommet en y = top, demi-largeur w, épaisseur t.
function chevronShape(w, top, t) {
  const drop = w * 0.62;
  const shape = new THREE.Shape();
  [[-w, top - drop], [0, top], [w, top - drop], [w, top - drop - t], [0, top - t], [-w, top - drop - t]]
    .forEach(([px, py], i) => (i ? shape.lineTo(px, py) : shape.moveTo(px, py)));
  return shape;
}

// Feuille de laurier (ellipse pointue) de longueur len, centrée en (cx, cy), orientée selon angle.
function leafShape(len, width, cx, cy, angle) {
  const shape = new THREE.Shape();
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const u = Math.cos(t) * len * 0.5, v = Math.sin(t) * width * 0.5 * Math.abs(Math.cos(t * 0.5)) ** 0.3;
    shape[i ? 'lineTo' : 'moveTo'](cx + u * c - v * s, cy + u * s + v * c);
  }
  return shape;
}

// Couronne de lauriers : deux branches qui montent depuis le bas, ouvertes en haut.
function laurelShapes(size) {
  const shapes = [];
  const R = size * 1.12;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const phi = 0.32 + i * 0.36; // angle depuis le bas du cercle
      const x = side * Math.sin(phi) * R, y = -Math.cos(phi) * R;
      const tangent = Math.atan2(Math.sin(phi), side * Math.cos(phi)); // direction de la branche qui monte
      // une feuille de chaque côté de la branche, légèrement écartées
      shapes.push(leafShape(size * 0.42, size * 0.16, x + side * Math.sin(phi) * size * 0.08, y - Math.cos(phi) * size * 0.08, tangent - side * 0.45));
      shapes.push(leafShape(size * 0.37, size * 0.15, x - side * Math.sin(phi) * size * 0.08, y + Math.cos(phi) * size * 0.08, tangent + side * 0.45));
    }
  }
  return shapes;
}

// Dessins des insignes, dans un carré d'environ ±size.
const EMBLEMS = {
  // étoile cerclée
  star: (size) => [new THREE.ShapeGeometry(starShape(size)), new THREE.RingGeometry(size * 1.12, size * 1.3, 24)],
  // double chevron de vétéran surmonté d'une étoile
  chevrons: (size) => [
    new THREE.ShapeGeometry(starShape(size * 0.36, 0, size * 0.78)),
    new THREE.ShapeGeometry(chevronShape(size * 0.85, size * 0.32, size * 0.26)),
    new THREE.ShapeGeometry(chevronShape(size * 0.85, size * -0.12, size * 0.26)),
  ],
  // étoile dans une couronne de lauriers
  laurel: (size) => [new THREE.ShapeGeometry([starShape(size * 0.62, 0, size * 0.06), ...laurelShapes(size)])],
};

// Insigne du skin peint sur les deux flancs de la caisse, plats en x = ±x.
function emblems(add, mats, parent, x, y, z, size) {
  if (!mats.emblem) return;
  const geos = (EMBLEMS[mats.emblem.userData.kind] ?? EMBLEMS.star)(size);
  for (const side of [-1, 1]) {
    const rot = side * Math.PI / 2; // la face (+Z) regarde vers l'extérieur
    for (const geo of geos) {
      const m = add(parent, geo, mats.emblem, side * (x + 0.012), y, z);
      m.rotation.y = rot;
      m.castShadow = false;
    }
  }
}

// Assemble l'objet attendu par le renderer.
function finish({ mats, group, body, turret, barrel, wheels, turretY, ...rest }) {
  const original = Object.fromEntries(Object.entries(mats).map(([k, m]) => [k, m.color.clone()]));
  const glow = Object.fromEntries(Object.entries(mats).map(([k, m]) => [k, m.emissiveIntensity]));
  const masts = [];
  group.traverse((o) => o.name === 'mast' && masts.push(o));
  return {
    group,
    body,
    turret,
    barrel,
    wheels,
    barrelRestZ: barrel.position.z,
    ...rest, // wheelRadius, trackX, rearZ, exhausts, engine : repère du char
    // k = 0 : mât dressé ; k = 1 : mât rentré dans le char (invisible)
    setMast(k) {
      for (const m of masts) {
        m.position.y = -k * m.userData.drop;
        m.visible = k < 0.97;
      }
    },
    setWrecked(wrecked) {
      for (const [k, m] of Object.entries(mats)) {
        m.color.set(wrecked ? WRECK_COLOR : original[k]);
        m.emissiveIntensity = wrecked ? 0 : glow[k];
        if (m.userData.skin) m.userData.skin.uSkinOn.value = wrecked ? 0 : 1;
      }
      turret.rotation.z = wrecked ? 0.14 : 0;
      turret.position.y = wrecked ? turretY - 0.08 : turretY;
    },
    dispose() {
      group.traverse((o) => o.geometry?.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}

// ------------------------------------------------------------- Vanguard (moyen)

function buildStandard(teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const group = new THREE.Group();

  // Train de roulement (ne bascule pas avec la caisse)
  const wheels = [];
  const trackGeo = profile([[-2.5, 0.55], [-2.1, 0.02], [2.1, 0.02], [2.5, 0.55], [2.3, 0.95], [-2.3, 0.95]], 0.65);
  const wheelGeo = cylX(0.34, 0.34, 0.14, 8);
  const hubGeo = box(0.04, 0.5, 0.12);
  const sprocketGeo = cylX(0.25, 0.25, 0.14, 6);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * 1.2, 0, 0);
    for (let i = 0; i < 5; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, 1.55, 0.4, -1.7 + i * 0.85));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.55, 0.58, 2.2));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.55, 0.58, -2.2));
  }

  // Caisse (bascule à l'accélération, au freinage et au tir)
  const body = new THREE.Group();
  group.add(body);
  add(body, box(1.8, 0.6, 4.5), mats.dark, 0, 0.62, 0);
  add(body, profile([[-2.45, 0.92], [2.6, 0.92], [1.5, 1.5], [-2.15, 1.5]], 3.0), mats.hull);
  for (const side of [-1, 1]) {
    add(body, box(0.72, 0.08, 4.9), mats.dark, side * 1.22, 0.99, 0); // garde-boue
    add(body, box(0.22, 0.16, 0.1), mats.lamp, side * 1.0, 1.08, 2.36); // phare
    add(body, cylZ(0.1, 0.1, 0.5, 6), mats.metal, side * 0.9, 1.25, -2.45); // échappement
  }
  add(body, box(1.7, 0.1, 1.1), mats.dark, 0, 1.54, -1.45); // grille moteur
  add(body, box(0.5, 0.25, 0.7), mats.dark, 1.15, 1.6, 0.2); // caisse à outils
  add(body, box(3.02, 0.14, 0.3), mats.stripe, 0, 1.2, -1.9); // bande d'identification
  emblems(add, mats, body, 1.5, 1.22, -0.35, 0.21);

  // Tourelle (tourne sur Y)
  const turretY = 1.5;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  const turretGeo = new THREE.CylinderGeometry(0.95, 1.25, 0.75, 8).rotateY(Math.PI / 8).scale(1, 1, 1.18);
  add(turret, turretGeo, mats.turret, 0, 0.375, 0);
  add(turret, new THREE.CylinderGeometry(1.2, 1.27, 0.1, 8).rotateY(Math.PI / 8).scale(1, 1, 1.18), mats.stripe, 0, 0.08, 0);
  add(turret, box(0.95, 0.5, 0.5), mats.dark, 0, 0.36, 1.25); // masque du canon
  add(turret, new THREE.CylinderGeometry(0.32, 0.36, 0.12, 8), mats.dark, -0.35, 0.8, -0.3); // trappe
  add(turret, box(0.9, 0.3, 0.5), mats.dark, 0, 0.45, -1.35); // panier arrière
  add(turret, new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4), mats.metal, 0.65, 1.5, -0.9); // antenne
  pennant(add, mats, turret, 0.65, 2.25, -0.9);
  add(turret, box(0.1, 0.1, 0.7), mats.metal, 0.4, 0.88, 0.25); // mitrailleuse de toit

  // Canon (recule au tir)
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.36, 1.2);
  turret.add(barrel);
  add(barrel, cylZ(0.11, 0.14, 2.3, 8), mats.metal, 0, 0, 1.15);
  add(barrel, cylZ(0.19, 0.19, 0.4, 8), mats.metal, 0, 0, 2.3);

  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.34,
    trackX: 1.2,
    rearZ: -2.4,
    exhausts: [[-0.9, 1.25, -2.75], [0.9, 1.25, -2.75]],
    engine: [0, 1.7, -1.4],
  });
}

// ------------------------------------------------------------- Bastion (lourd)

function buildHeavy(teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const group = new THREE.Group();

  // Train de roulement : 7 galets par côté, à moitié cachés par des jupes de blindage
  const wheels = [];
  const trackGeo = profile([[-3.0, 0.6], [-2.55, 0.02], [2.55, 0.02], [3.0, 0.6], [2.75, 1.02], [-2.75, 1.02]], 0.78);
  const wheelGeo = cylX(0.36, 0.36, 0.16, 8);
  const hubGeo = box(0.04, 0.54, 0.13);
  const sprocketGeo = cylX(0.29, 0.29, 0.16, 7);
  const skirtGeo = box(0.08, 0.5, 1.34);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * 1.38, 0, 0);
    for (let i = 0; i < 7; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, 1.8, 0.42, -2.4 + i * 0.8));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.8, 0.62, 2.68));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.8, 0.62, -2.68));
    for (let i = 0; i < 4; i++) add(group, skirtGeo, mats.hull, side * 1.94, 0.86, -2.07 + i * 1.38); // jupes en 4 panneaux
  }

  // Caisse
  const body = new THREE.Group();
  group.add(body);
  add(body, box(2.1, 0.7, 5.5), mats.dark, 0, 0.68, 0);
  add(body, profile([[-2.9, 1.0], [3.05, 1.0], [1.75, 1.75], [-2.65, 1.75]], 3.5), mats.hull);
  add(body, profile([[1.8, 1.72], [2.95, 1.06], [3.08, 1.12], [1.95, 1.8]], 2.9), mats.dark); // surblindage du glacis
  for (const side of [-1, 1]) {
    add(body, box(0.62, 0.08, 6.1), mats.dark, side * 1.66, 1.06, 0); // garde-boue
    add(body, box(0.24, 0.18, 0.1), mats.lamp, side * 1.15, 1.32, 2.86); // phare
    add(body, box(0.34, 0.28, 0.08), mats.metal, side * 1.15, 1.32, 2.92).scale.set(1, 1, 0.4); // grille de phare
    add(body, cylZ(0.12, 0.12, 0.55, 6), mats.metal, side * 1.1, 1.45, -2.9); // échappement
    add(body, cylX(0.24, 0.24, 0.66, 8), mats.dark, side * 0.52, 1.3, -3.05); // fût de carburant (plaque arrière)
    add(body, box(0.1, 0.12, 0.5), mats.metal, side * 1.45, 1.1, 3.0); // crochet de remorquage
  }
  for (let i = 0; i < 5; i++) add(body, box(0.42, 0.08, 0.26), mats.track, -0.95 + i * 0.475, 1.5, 2.45).rotation.x = -0.52; // maillons de rechange
  add(body, box(2.4, 0.1, 1.5), mats.dark, 0, 1.79, -1.7); // grille moteur
  for (let i = 0; i < 4; i++) add(body, box(2.2, 0.06, 0.08), mats.metal, 0, 1.86, -2.25 + i * 0.36); // lames de la grille
  add(body, box(0.45, 0.2, 0.9), mats.dark, 1.45, 1.85, 0.0); // caisses à outils
  add(body, box(0.45, 0.2, 0.9), mats.dark, -1.45, 1.85, 0.0);
  add(body, box(3.52, 0.16, 0.34), mats.stripe, 0, 1.38, -2.3); // bande d'identification
  emblems(add, mats, body, 1.75, 1.43, 0.35, 0.24);

  // Tourelle anguleuse, plus large que haute
  const turretY = 1.75;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  const outline = [[-0.7, 1.7], [0.7, 1.7], [1.4, 0.6], [1.4, -1.15], [0.95, -1.6], [-0.95, -1.6], [-1.4, -1.15], [-1.4, 0.6]];
  add(turret, plan(outline, 0.9, 0.14), mats.turret, 0, 0.05, 0);
  add(turret, plan(outline.map(([x, z]) => [x * 1.1, z * 1.06]), 0.12), mats.stripe, 0, 0.02, 0);
  add(turret, box(1.15, 0.72, 0.5), mats.dark, 0, 0.47, 1.92); // masque du canon
  add(turret, new THREE.CylinderGeometry(0.36, 0.42, 0.32, 8), mats.turret, -0.6, 1.11, -0.45); // tourelleau du chef
  add(turret, new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), mats.dark, -0.6, 1.31, -0.45); // trappe du chef
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(turret, box(0.14, 0.1, 0.06), mats.lamp, -0.6 + Math.sin(a) * 0.4, 1.15, -0.45 + Math.cos(a) * 0.4).rotation.y = a; // épiscopes
  }
  add(turret, new THREE.CylinderGeometry(0.3, 0.33, 0.1, 8), mats.dark, 0.55, 1.0, -0.6); // trappe du chargeur
  add(turret, box(0.34, 0.3, 0.42), mats.dark, 0.75, 1.1, 0.75); // viseur
  add(turret, box(1.9, 0.38, 0.7), mats.canvas, 0, 0.55, -2.0); // bâches de la nuque
  add(turret, box(2.1, 0.06, 0.8), mats.metal, 0, 0.34, -2.0); // panier
  add(turret, new THREE.CylinderGeometry(0.02, 0.02, 1.7, 4), mats.metal, -1.0, 1.85, -1.3); // antennes
  pennant(add, mats, turret, -1.0, 2.7, -1.3);
  add(turret, new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), mats.metal, 1.0, 1.6, -1.3);
  add(turret, box(0.1, 0.1, 0.8), mats.metal, 0.55, 1.22, -0.25); // mitrailleuse de toit
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) { // lance-pots fumigènes
      const tube = add(turret, new THREE.CylinderGeometry(0.07, 0.07, 0.32, 6), mats.metal, side * (1.25 + i * 0.05), 0.82, 0.95 - i * 0.18);
      tube.rotation.set(0.7, 0, -side * 0.5);
    }
  }

  // Canon long avec extracteur de fumée et frein de bouche
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.47, 1.9);
  turret.add(barrel);
  add(barrel, cylZ(0.15, 0.19, 3.3, 8), mats.metal, 0, 0, 1.65);
  add(barrel, cylZ(0.24, 0.24, 0.5, 8), mats.metal, 0, 0, 1.45); // extracteur de fumée
  add(barrel, box(0.56, 0.3, 0.5), mats.metal, 0, 0, 3.35); // frein de bouche
  add(barrel, box(0.62, 0.08, 0.14), mats.dark, 0, 0, 3.3);

  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.36,
    trackX: 1.38,
    rearZ: -2.9,
    exhausts: [[-1.1, 1.45, -3.2], [1.1, 1.45, -3.2]],
    engine: [0, 1.95, -1.7],
  });
}

// ---------------------------------------------------------------- Lynx (léger)

function buildLight(teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const group = new THREE.Group();

  // Train de roulement : 4 grands galets type Christie
  const wheels = [];
  const trackGeo = profile([[-2.05, 0.48], [-1.7, 0.02], [1.75, 0.02], [2.15, 0.5], [1.95, 0.82], [-1.85, 0.82]], 0.5);
  const wheelGeo = cylX(0.37, 0.37, 0.12, 9);
  const hubGeo = box(0.04, 0.56, 0.1);
  const sprocketGeo = cylX(0.24, 0.24, 0.12, 6);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * 0.98, 0, 0);
    for (let i = 0; i < 4; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, 1.28, 0.42, -1.35 + i * 0.9));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.28, 0.52, 1.85));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.28, 0.5, -1.78));
  }

  // Caisse basse au glacis très incliné
  const body = new THREE.Group();
  group.add(body);
  add(body, box(1.45, 0.5, 3.7), mats.dark, 0, 0.55, 0);
  add(body, profile([[-1.95, 0.78], [2.2, 0.78], [0.95, 1.25], [-1.8, 1.25]], 2.5), mats.hull);
  for (const side of [-1, 1]) {
    add(body, box(0.55, 0.06, 4.2), mats.dark, side * 1.02, 0.84, 0.05); // garde-boue
    add(body, cylZ(0.11, 0.09, 0.16, 8), mats.lamp, side * 0.78, 1.08, 1.75); // phares ronds
    add(body, box(0.03, 0.2, 0.2), mats.metal, side * 0.66, 1.1, 1.78); // garde de phare
    add(body, box(0.28, 0.42, 0.14), mats.canvas, side * 0.75, 1.0, -2.0); // jerricans
    add(body, box(0.08, 0.1, 0.35), mats.metal, side * 0.55, 0.72, 2.25); // crochet de remorquage
  }
  add(body, cylX(0.12, 0.12, 0.8, 6), mats.metal, 0, 1.05, -1.98); // pot d'échappement
  add(body, box(1.4, 0.07, 0.8), mats.dark, 0, 1.28, -1.25); // grille moteur
  add(body, cylX(0.16, 0.16, 1.8, 8), mats.canvas, 0, 1.4, -1.65); // filet de camouflage roulé
  add(body, box(0.36, 0.12, 0.6), mats.dark, -0.97, 1.31, 0.25); // caisse à outils (sous le masque)
  add(body, box(2.52, 0.12, 0.26), mats.stripe, 0, 1.0, -1.45); // bande d'identification
  emblems(add, mats, body, 1.25, 1.05, 0.15, 0.15);

  // Petite tourelle hexagonale avec optique de reconnaissance
  const turretY = 1.25;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  add(turret, new THREE.CylinderGeometry(0.66, 0.86, 0.6, 6).rotateY(Math.PI / 6).scale(1, 1, 1.15), mats.turret, 0, 0.3, 0);
  add(turret, new THREE.CylinderGeometry(0.83, 0.88, 0.08, 6).rotateY(Math.PI / 6).scale(1, 1, 1.15), mats.stripe, 0, 0.06, 0);
  add(turret, box(0.5, 0.34, 0.36), mats.dark, 0, 0.3, 0.9); // masque du canon
  add(turret, box(0.36, 0.22, 0.3), mats.dark, 0.32, 0.71, 0.1); // optique
  add(turret, box(0.28, 0.12, 0.04), mats.lamp, 0.32, 0.72, 0.26); // vitre de l'optique
  add(turret, new THREE.CylinderGeometry(0.26, 0.28, 0.08, 8), mats.dark, -0.25, 0.64, -0.2); // trappe
  add(turret, box(0.75, 0.24, 0.4), mats.canvas, 0, 0.32, -1.05); // sac de nuque
  add(turret, new THREE.CylinderGeometry(0.015, 0.015, 2.6, 4), mats.metal, -0.45, 1.9, -0.6); // grande antenne
  pennant(add, mats, turret, -0.45, 3.2, -0.6);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) { // lance-pots fumigènes
      const tube = add(turret, new THREE.CylinderGeometry(0.055, 0.055, 0.24, 6), mats.metal, side * (0.72 + i * 0.04), 0.5, 0.45 - i * 0.14);
      tube.rotation.set(0.7, 0, -side * 0.5);
    }
  }

  // Canon fin et long
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.3, 0.95);
  turret.add(barrel);
  add(barrel, cylZ(0.07, 0.09, 2.3, 8), mats.metal, 0, 0, 1.15);
  add(barrel, cylZ(0.11, 0.11, 0.26, 8), mats.metal, 0, 0, 2.35);

  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.37,
    trackX: 0.98,
    rearZ: -1.9,
    exhausts: [[-0.35, 1.05, -2.15], [0.35, 1.05, -2.15]],
    engine: [0, 1.4, -1.25],
  });
}

// ------------------------------------------------------- Frelon (rafales de 3 obus)

function buildHornet(teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const group = new THREE.Group();

  // Train de roulement : 5 galets, chenilles étroites
  const wheels = [];
  const trackGeo = profile([[-2.2, 0.5], [-1.85, 0.02], [1.9, 0.02], [2.3, 0.52], [2.1, 0.86], [-2.0, 0.86]], 0.52);
  const wheelGeo = cylX(0.32, 0.32, 0.12, 8);
  const hubGeo = box(0.04, 0.46, 0.1);
  const sprocketGeo = cylX(0.24, 0.24, 0.12, 6);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * 1.08, 0, 0);
    for (let i = 0; i < 5; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, 1.38, 0.38, -1.6 + i * 0.78));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.38, 0.54, 2.0));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.38, 0.52, -1.95));
  }

  // Caisse fine, nez en pointe
  const body = new THREE.Group();
  group.add(body);
  add(body, box(1.6, 0.52, 4.0), mats.dark, 0, 0.58, 0);
  add(body, profile([[-2.1, 0.84], [2.35, 0.84], [1.25, 1.32], [-1.95, 1.32]], 2.7), mats.hull);
  add(body, profile([[1.3, 1.3], [2.3, 0.88], [2.38, 0.92], [1.4, 1.36]], 1.6), mats.dark); // plaque de glacis
  for (const side of [-1, 1]) {
    add(body, box(0.6, 0.06, 4.5), mats.dark, side * 1.1, 0.9, 0.05); // garde-boue
    add(body, box(0.2, 0.14, 0.1), mats.lamp, side * 0.75, 1.02, 2.05); // phare
    add(body, cylZ(0.09, 0.09, 0.42, 6), mats.metal, side * 0.7, 1.05, -2.2); // échappement
    // ailerons de caisse (bandes jaunes de « frelon » sur les garde-boue)
    for (let i = 0; i < 3; i++) add(body, box(0.55, 0.07, 0.22), mats.stripe, side * 1.1, 0.95, 1.4 - i * 0.5);
  }
  add(body, box(1.3, 0.08, 0.9), mats.dark, 0, 1.36, -1.3); // grille moteur
  add(body, box(2.72, 0.12, 0.26), mats.stripe, 0, 1.12, -1.6); // bande d'identification
  emblems(add, mats, body, 1.35, 1.1, 0.0, 0.16);

  // Tourelle basse et large, chargeur automatique en nuque
  const turretY = 1.32;
  const turret = new THREE.Group();
  turret.position.y = turretY;
  body.add(turret);
  const outline = [[-0.55, 1.05], [0.55, 1.05], [1.0, 0.35], [1.0, -0.7], [0.7, -1.0], [-0.7, -1.0], [-1.0, -0.7], [-1.0, 0.35]];
  add(turret, plan(outline, 0.55, 0.12), mats.turret, 0, 0.02, 0);
  add(turret, plan(outline.map(([x, z]) => [x * 1.08, z * 1.05]), 0.1), mats.stripe, 0, 0.0, 0);
  add(turret, box(1.5, 0.48, 0.75), mats.dark, 0, 0.3, -1.25); // chargeur (nuque)
  for (let i = 0; i < 3; i++) add(turret, cylX(0.1, 0.1, 1.55, 8), mats.metal, 0, 0.3, -1.05 - i * 0.22).scale.set(1, 0.6, 1); // obus visibles
  add(turret, box(0.6, 0.3, 0.42), mats.dark, 0, 0.3, 1.1); // masque
  add(turret, box(0.3, 0.2, 0.28), mats.dark, -0.5, 0.68, 0.15); // optique
  add(turret, box(0.24, 0.1, 0.04), mats.lamp, -0.5, 0.69, 0.3);
  add(turret, new THREE.CylinderGeometry(0.015, 0.015, 2.0, 4), mats.metal, 0.6, 1.5, -0.7); // antenne
  pennant(add, mats, turret, 0.6, 2.5, -0.7);

  // Canon court à frein de bouche perforé
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.3, 1.15);
  turret.add(barrel);
  add(barrel, cylZ(0.09, 0.11, 1.6, 8), mats.metal, 0, 0, 0.8);
  add(barrel, cylZ(0.14, 0.14, 0.4, 8), mats.metal, 0, 0, 1.6);
  for (let i = 0; i < 3; i++) add(barrel, box(0.32, 0.05, 0.06), mats.dark, 0, 0, 1.48 + i * 0.12);

  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.32,
    trackX: 1.08,
    rearZ: -2.05,
    exhausts: [[-0.7, 1.05, -2.45], [0.7, 1.05, -2.45]],
    engine: [0, 1.4, -1.3],
  });
}

// ------------------------------------------------- Harpon (chasseur de chars)

function buildDestroyer(teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const group = new THREE.Group();

  // Train de roulement long et bas : 6 galets
  const wheels = [];
  const trackGeo = profile([[-2.85, 0.55], [-2.45, 0.02], [2.5, 0.02], [2.9, 0.55], [2.65, 0.92], [-2.65, 0.92]], 0.66);
  const wheelGeo = cylX(0.34, 0.34, 0.14, 8);
  const hubGeo = box(0.04, 0.5, 0.12);
  const sprocketGeo = cylX(0.26, 0.26, 0.14, 6);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * 1.24, 0, 0);
    for (let i = 0; i < 6; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, 1.6, 0.4, -2.1 + i * 0.84));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.6, 0.58, 2.6));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.6, 0.58, -2.6));
  }

  // Caisse et casemate : un seul bloc aux flancs inclinés, très bas
  const body = new THREE.Group();
  group.add(body);
  add(body, box(1.9, 0.6, 5.3), mats.dark, 0, 0.62, 0);
  add(body, profile([[-2.8, 0.92], [2.95, 0.92], [1.9, 1.25], [-2.6, 1.25]], 3.1), mats.hull);
  // casemate : plan trapézoïdal (plus étroit en haut), glacis fuyant vers l'avant
  const casemate = profile([[-2.3, 0.0], [1.95, 0.0], [0.8, 0.72], [-2.0, 0.72]], 2.4);
  add(body, casemate, mats.turret, 0, 1.24, 0);
  add(body, profile([[-2.32, 0.0], [1.98, 0.0], [1.88, 0.06], [-2.32, 0.06]], 2.85), mats.stripe, 0, 1.2, 0); // liseré d'identification
  for (const side of [-1, 1]) {
    add(body, box(0.6, 0.07, 5.8), mats.dark, side * 1.3, 1.0, 0); // garde-boue
    add(body, box(0.22, 0.14, 0.1), mats.lamp, side * 1.05, 1.08, 2.92); // phare
    add(body, cylZ(0.11, 0.11, 0.5, 6), mats.metal, side * 0.95, 1.25, -2.85); // échappement
    // plaques de blindage additionnelles sur les flancs de la casemate
    add(body, box(0.06, 0.5, 1.6), mats.dark, side * 1.16, 1.5, -0.6).rotation.z = side * 0.32;
  }
  add(body, box(1.5, 0.08, 1.0), mats.dark, 0, 1.98, -1.4); // trappes de toit
  add(body, new THREE.CylinderGeometry(0.3, 0.34, 0.2, 8), mats.turret, -0.5, 2.05, -0.5); // tourelleau
  add(body, box(0.26, 0.08, 0.06), mats.lamp, -0.5, 2.12, -0.24); // épiscope
  add(body, cylX(0.15, 0.15, 2.0, 8), mats.canvas, 0, 1.4, -2.75); // filet roulé
  add(body, new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), mats.metal, 0.75, 2.6, -1.8); // antenne
  pennant(add, mats, body, 0.75, 3.3, -1.8);
  emblems(add, mats, body, 1.55, 1.1, -0.9, 0.2);

  // « Tourelle » = rotule du canon dans le glacis (ne pivote que de quelques degrés)
  const turretY = 1.5;
  const turret = new THREE.Group();
  turret.position.set(0, turretY, 1.3);
  body.add(turret);
  add(turret, new THREE.SphereGeometry(0.42, 8, 6), mats.dark, 0, 0, 0.1); // rotule
  add(turret, box(0.75, 0.55, 0.35), mats.turret, 0, 0, 0.35).rotation.x = 0.5; // masque en pente

  // Très long canon avec frein de bouche
  const barrel = new THREE.Group();
  barrel.position.set(0, 0, 0.45);
  turret.add(barrel);
  add(barrel, cylZ(0.1, 0.13, 3.2, 8), mats.metal, 0, 0, 1.6);
  add(barrel, cylZ(0.17, 0.17, 0.45, 8), mats.metal, 0, 0, 1.2); // extracteur de fumée
  add(barrel, box(0.36, 0.2, 0.42), mats.metal, 0, 0, 3.3); // frein de bouche

  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.34,
    trackX: 1.24,
    rearZ: -2.75,
    exhausts: [[-0.95, 1.25, -3.1], [0.95, 1.25, -3.1]],
    engine: [0, 1.6, -1.8],
  });
}

// ---------------------------------------------------- Tonnerre (obusier automoteur)

function buildArtillery(teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const group = new THREE.Group();

  const wheels = [];
  const trackGeo = profile([[-2.65, 0.55], [-2.25, 0.02], [2.3, 0.02], [2.7, 0.55], [2.45, 0.95], [-2.45, 0.95]], 0.66);
  const wheelGeo = cylX(0.35, 0.35, 0.14, 8);
  const hubGeo = box(0.04, 0.52, 0.12);
  const sprocketGeo = cylX(0.26, 0.26, 0.14, 6);
  for (const side of [-1, 1]) {
    add(group, trackGeo, mats.track, side * 1.24, 0, 0);
    for (let i = 0; i < 6; i++) wheels.push(roadWheel(add, mats, group, wheelGeo, hubGeo, side, 1.6, 0.41, -1.95 + i * 0.78));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.6, 0.6, 2.4));
    wheels.push(add(group, sprocketGeo, mats.wheel, side * 1.6, 0.6, -2.4));
  }

  // Caisse : moteur à l'avant, compartiment de combat à l'arrière
  const body = new THREE.Group();
  group.add(body);
  add(body, box(1.9, 0.62, 5.0), mats.dark, 0, 0.64, 0);
  add(body, profile([[-2.6, 0.95], [2.65, 0.95], [1.7, 1.42], [-2.6, 1.42]], 3.1), mats.hull);
  for (const side of [-1, 1]) {
    add(body, box(0.62, 0.07, 5.4), mats.dark, side * 1.3, 1.02, 0); // garde-boue
    add(body, box(0.22, 0.14, 0.1), mats.lamp, side * 1.05, 1.15, 2.6); // phare
    add(body, box(0.45, 0.35, 1.2), mats.dark, side * 1.3, 1.25, -1.6); // coffres à munitions
    add(body, box(0.1, 0.5, 0.12), mats.metal, side * 0.9, 0.7, -2.65); // bêches arrière
  }
  add(body, box(1.4, 0.08, 1.0), mats.dark, 0, 1.46, 1.6); // grille moteur (avant)
  add(body, cylZ(0.1, 0.1, 0.6, 6), mats.metal, 0.95, 1.55, 1.1); // échappement
  add(body, box(3.12, 0.12, 0.28), mats.stripe, 0, 1.2, 2.0); // bande d'identification
  // support de route du tube (à l'avant)
  add(body, box(0.1, 0.55, 0.1), mats.metal, -0.2, 1.7, 2.1);
  add(body, box(0.1, 0.55, 0.1), mats.metal, 0.2, 1.7, 2.1);
  emblems(add, mats, body, 1.55, 1.18, 0.6, 0.2);

  // Grande tourelle-caisson à l'arrière
  const turretY = 1.42;
  const turret = new THREE.Group();
  turret.position.set(0, turretY, -0.6);
  body.add(turret);
  const outline = [[-0.9, 1.3], [0.9, 1.3], [1.3, 0.7], [1.3, -1.5], [-1.3, -1.5], [-1.3, 0.7]];
  add(turret, plan(outline, 1.15, 0.1), mats.turret, 0, 0.02, 0);
  add(turret, plan(outline.map(([x, z]) => [x * 1.06, z * 1.04]), 0.1), mats.stripe, 0, 0.0, 0);
  add(turret, box(2.2, 0.1, 2.2), mats.dark, 0, 1.2, -0.35); // toit
  add(turret, new THREE.CylinderGeometry(0.3, 0.33, 0.22, 8), mats.dark, 0.6, 1.33, -0.6); // trappe
  add(turret, box(0.1, 0.1, 0.8), mats.metal, 0.6, 1.5, -0.4); // mitrailleuse de toit
  add(turret, box(0.9, 0.7, 0.4), mats.dark, 0, 0.62, 1.4); // masque
  add(turret, new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), mats.metal, -1.0, 1.95, -1.2); // antenne
  pennant(add, mats, turret, -1.0, 2.75, -1.2);
  for (const side of [-1, 1]) add(turret, box(0.06, 0.6, 1.4), mats.dark, side * 1.33, 0.6, -0.4); // plaques latérales

  // Tube pointé vers le ciel (pivot dans le masque) ; le groupe `barrel` recule le long du tube
  const elev = new THREE.Group();
  elev.position.set(0, 0.62, 1.45);
  elev.rotation.x = -0.42;
  turret.add(elev);
  const barrel = new THREE.Group();
  elev.add(barrel);
  add(barrel, cylZ(0.14, 0.17, 3.4, 8), mats.metal, 0, 0, 1.6);
  add(barrel, cylZ(0.24, 0.24, 0.9, 8), mats.metal, 0, 0, 0.3); // berceau / récupérateur
  add(barrel, box(0.5, 0.3, 0.45), mats.metal, 0, 0, 3.35); // frein de bouche

  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.35,
    trackX: 1.24,
    rearZ: -2.5,
    exhausts: [[0.95, 1.55, 1.45], [0.95, 1.55, 1.45]],
    engine: [0, 1.6, 1.6],
  });
}

// ------------------------------------------------------- char importé (.glb libre de droits)

// Sépare un maillage en 3 lots selon la zone de la palette de couleurs (UV) : rouge = peinture, gris = métal, sombre = le reste.
function splitByAtlas(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const out = { paint: [[], []], metal: [[], []], dark: [[], []] };
  for (let i = 0; i < pos.count; i += 3) {
    const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3, v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
    const k = u > 0.48 ? (v < 0.48 ? 'paint' : v > 0.52 ? 'metal' : 'dark') : 'dark';
    for (let j = 0; j < 3; j++) {
      out[k][0].push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
      out[k][1].push(nor.getX(i + j), nor.getY(i + j), nor.getZ(i + j));
    }
  }
  const res = {};
  for (const [k, [p, n]] of Object.entries(out)) {
    if (!p.length) continue;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    res[k] = bg;
  }
  return res;
}

// Habille un modèle importé avec les matériaux du jeu (couleur d'équipe, skins, usure).
// cfg : { hullLength } longueur de la caisse en mètres (le modèle est mis à l'échelle), trackX, wheelRadius.
function buildGlbTank(src, teamColor, look, cfg) {
  const { mats, add } = kit(teamColor, look);
  // géométries dans le repère du modèle, transformations des nœuds appliquées
  const parts = { chassis: [], turret: [] };
  let pivot = new THREE.Vector3(), muzzle = new THREE.Vector3();
  src.traverse((o) => {
    if (o.name === 'TurretPivot') pivot.setFromMatrixPosition(o.matrixWorld);
    if (o.name === 'Muzzle') muzzle.setFromMatrixPosition(o.matrixWorld);
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    let n = o, isTurret = false;
    while (n) { if (/turret/i.test(n.name)) isTurret = true; n = n.parent; }
    parts[isTurret ? 'turret' : 'chassis'].push(g);
  });
  // orientation : le canon doit viser +Z
  const a = Math.atan2(-(muzzle.x - pivot.x), muzzle.z - pivot.z);
  const place = new THREE.Matrix4().makeRotationY(a);
  const chassisBox = new THREE.Box3();
  for (const g of parts.chassis) { g.applyMatrix4(place); g.computeBoundingBox(); chassisBox.union(g.boundingBox); }
  for (const g of parts.turret) g.applyMatrix4(place);
  pivot.applyMatrix4(place);
  const k = cfg.hullLength / (chassisBox.max.z - chassisBox.min.z);
  const cx = (chassisBox.max.x + chassisBox.min.x) / 2, cz = (chassisBox.max.z + chassisBox.min.z) / 2, by = chassisBox.min.y;
  const fit = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-cx, -by, -cz));
  for (const g of [...parts.chassis, ...parts.turret]) g.applyMatrix4(fit);
  pivot.applyMatrix4(fit);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  for (const g0 of parts.chassis) {
    const sp = splitByAtlas(g0);
    if (sp.paint) add(body, sp.paint, mats.hull);
    if (sp.metal) add(body, sp.metal, mats.metal);
    if (sp.dark) add(body, sp.dark, mats.track);
  }
  const turretY = pivot.y;
  const turret = new THREE.Group();
  turret.position.set(pivot.x, pivot.y, pivot.z);
  body.add(turret);
  const barrel = new THREE.Group();
  const barrelStart = cfg.barrelStart ?? 1.4; // au-delà (en mètres devant le pivot), c'est le canon : il peut reculer
  barrel.position.set(0, 0, barrelStart);
  turret.add(barrel);
  for (const g0 of parts.turret) {
    g0.translate(-pivot.x, -pivot.y, -pivot.z);
    const sp = splitByAtlas(g0);
    for (const [kind, geo] of Object.entries(sp)) {
      const mat = kind === 'paint' ? mats.turret : kind === 'metal' ? mats.metal : mats.dark;
      // on coupe le canon du reste de la tourelle
      const p = geo.attributes.position, n = geo.attributes.normal;
      const front = [[], []], rest = [[], []];
      for (let i = 0; i < p.count; i += 3) {
        const zc = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        const dst = zc > barrelStart ? front : rest;
        for (let j = 0; j < 3; j++) {
          dst[0].push(p.getX(i + j), p.getY(i + j), p.getZ(i + j));
          dst[1].push(n.getX(i + j), n.getY(i + j), n.getZ(i + j));
        }
      }
      for (const [d, parent, dz] of [[rest, turret, 0], [front, barrel, -barrelStart]]) {
        if (!d[0].length) continue;
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(d[0], 3));
        bg.setAttribute('normal', new THREE.Float32BufferAttribute(d[1], 3));
        bg.translate(0, 0, dz);
        add(parent, bg, parent === barrel ? mats.metal : mat);
      }
    }
  }
  const half = cfg.hullLength / 2, width = (chassisBox.max.x - chassisBox.min.x) * k;
  // antenne + fanion d'équipe (le modèle n'en a pas)
  add(turret, new THREE.CylinderGeometry(0.02, 0.02, 1.7, 4), mats.metal, -width * 0.3, 1.2, -1.0);
  pennant(add, mats, turret, -width * 0.3, 2.05, -1.0);
  return finish({
    mats, group, body, turret, barrel, wheels: [], turretY,
    wheelRadius: cfg.wheelRadius, trackX: width * 0.38, rearZ: -half,
    exhausts: [[-0.7, 1.3, -half], [0.7, 1.3, -half]],
    engine: [0, 1.5, -half * 0.5],
  });
}

// Blindé de reconnaissance à 6 roues (« Recon Tank », MNDV.ecb, CC-BY 4.0 / CC0) : modèle OBJ en repère Blender (Z haut, avant = -Y).
// Chaque objet du fichier est repris tel quel ; les roues (3 essieux) tournent, le canon recule.
function buildReconTank(src, teamColor, look) {
  const { mats, add } = kit(teamColor, look);
  const S = 0.62; // échelle : coque ~4,3 m comme le Lynx
  const geos = {};
  src.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.rotateX(-Math.PI / 2); // Blender -> jeu : (x, y, z) -> (x, z, -y), l'avant (-Y) devient +Z
    g.scale(S, S, S);
    geos[o.name] = g;
  });
  const need = ['Cube_Cube.004', 'Cylinder', 'Cylinder.006', 'Cylinder.007', 'Cylinder.001', 'Cylinder.002'];
  if (need.some((n) => !geos[n])) throw new Error('Recon Tank : objets introuvables');
  geos.Cylinder.computeBoundingBox();
  const lift = -geos.Cylinder.boundingBox.min.y; // les roues touchent le sol (y = 0)
  for (const g of Object.values(geos)) g.translate(0, lift, 0);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // roues : un objet par essieu (les deux roues), pivot au centre de l'essieu
  const wheels = [];
  for (const n of ['Cylinder', 'Cylinder.006', 'Cylinder.007']) {
    const g = geos[n];
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    wheels.push(add(group, g, mats.track, c.x, c.y, c.z));
  }
  // caisse
  add(body, geos['Cube_Cube.004'], mats.hull);
  geos['Cube_Cube.004'].computeBoundingBox();
  const hb = geos['Cube_Cube.004'].boundingBox;
  for (const n of ['Cube.003_Cube.007', 'Cube.001_Cube.005']) if (geos[n]) add(body, geos[n], mats.dark);
  add(body, box(hb.max.x * 2 + 0.03, 0.12, 0.3), mats.stripe, 0, hb.min.y + (hb.max.y - hb.min.y) * 0.45, hb.min.z + (hb.max.z - hb.min.z) * 0.3); // bande d'identification

  // tourelle : pivot au centre de sa base
  geos['Cylinder.001'].computeBoundingBox();
  const tb = geos['Cylinder.001'].boundingBox;
  const pivot = new THREE.Vector3((tb.min.x + tb.max.x) / 2, tb.min.y, (tb.min.z + tb.max.z) / 2);
  const turretY = pivot.y;
  const turret = new THREE.Group();
  turret.position.copy(pivot);
  body.add(turret);
  for (const n of ['Cylinder.001', 'Cylinder.005', 'Cylinder.004', 'Cube.005_Cube.010', 'Cube.004_Cube.009']) {
    if (!geos[n]) continue;
    geos[n].translate(-pivot.x, -pivot.y, -pivot.z);
    add(turret, geos[n], n === 'Cylinder.001' || n === 'Cylinder.004' ? mats.turret : mats.dark);
  }
  // canon (recule au tir) : géométrie dans le repère de la tourelle, groupe à l'origine
  const barrel = new THREE.Group();
  turret.add(barrel);
  for (const n of ['Cylinder.002', 'Cylinder.003']) {
    if (!geos[n]) continue;
    geos[n].translate(-pivot.x, -pivot.y, -pivot.z);
    add(barrel, geos[n], mats.metal);
  }
  // antenne (dernier objet posé : pennant() la reprend) + fanion d'équipe
  let ax = -0.3, ay = 1.9, az = -0.6;
  if (geos['Cube.002_Cube.008']) {
    const g = geos['Cube.002_Cube.008'];
    g.translate(-pivot.x, -pivot.y, -pivot.z);
    g.computeBoundingBox();
    ax = (g.boundingBox.min.x + g.boundingBox.max.x) / 2; ay = g.boundingBox.max.y; az = (g.boundingBox.min.z + g.boundingBox.max.z) / 2;
    add(turret, g, mats.metal);
  }
  pennant(add, mats, turret, ax, ay, az);

  const rearZ = hb.min.z;
  return finish({
    mats, group, body, turret, barrel, wheels, turretY,
    wheelRadius: 0.84 * S, trackX: 1.6 * S, rearZ,
    exhausts: [[-0.5, hb.max.y - 0.2, rearZ], [0.5, hb.max.y - 0.2, rearZ]],
    engine: [0, hb.max.y, rearZ * 0.5],
  });
}

export const TANK_MODELS = {
  standard: buildStandard,
  light: GLB.recon ? (c, l) => { try { return buildReconTank(GLB.recon, c, l); } catch (e) { console.warn(e); return buildLight(c, l); } } : buildLight,
  heavy: GLB.heavy ? (c, l) => buildGlbTank(GLB.heavy, c, l, { hullLength: 6.0, wheelRadius: 0.36 }) : buildHeavy,
  hornet: buildHornet, destroyer: buildDestroyer, artillery: buildArtillery,
};

// Chars des joueurs + unités de campagne (tourelles, bâtiments, boss : models/units.js).
// `look` = { skin, idColor } : seulement pour les chars des joueurs (les unités gardent leur peinture).
export function createTankModel(type, teamColor, look) {
  if (TANK_MODELS[type]) return TANK_MODELS[type](teamColor, look);
  return (UNIT_MODELS[type] ?? buildStandard)(teamColor);
}

export { profile, plan, cylX, cylZ, kit, roadWheel, finish };
