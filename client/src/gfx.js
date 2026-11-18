// Matériaux réalistes (PBR) et détails de surface générés par code : aucun fichier image à charger.
//
// stdMat()  : MeshStandardMaterial + détail procédural dans le shader (bruit 3D en repère objet) :
//             variations de teinte et de rugosité, rayures fines, poussière sur les faces tournées vers le ciel,
//             petit relief (bump) calculé à l'écran. Sans UV : marche sur n'importe quelle géométrie.
// groundTexture() : texture de sol (herbe, sable, neige, terre) tuilable, dessinée sur un canvas.
import * as THREE from 'three';
import { TEX } from './textures.js';

// 1 = détail actif, 0 = coupé (réglage « Détail des surfaces »). Partagé par tous les matériaux.
export const DETAIL = { value: 1 };

const GLSL_DECL = `
varying vec3 vDPos;
uniform float uDetail;
uniform float uDScale;
uniform float uDStrength;
uniform float uDBump;
uniform vec3 uDust;
uniform float uDustAmt;
float dHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float dFbm(vec3 p) { return dNoise(p) * 0.5 + dNoise(p * 2.03) * 0.3 + dNoise(p * 4.1) * 0.2; }
// hauteur du relief : bruit, plus sillons de chenille (DKIND 1) ou plaques rivetées (DKIND 2)
float dHeight(vec3 p) {
  float h = dFbm(p * uDScale * 3.0);
#if DKIND == 1
  h += smoothstep(0.35, 0.9, sin(p.z * 22.0)) * 1.4;
#elif DKIND == 2
  vec3 q = abs(fract(p * 0.9) - 0.5);
  h += smoothstep(0.47, 0.5, max(q.x, max(q.y, q.z))) * 0.6;
#endif
  return h;
}
`;

const GLSL_COLOR = `
  float dG = dFbm(vDPos * uDScale);
  float dF = dNoise(vDPos * uDScale * 9.0);
  float dK = uDetail * uDStrength;
  diffuseColor.rgb *= mix(1.0, 0.66 + 0.7 * dG, dK) * mix(1.0, 0.82 + 0.36 * dF, dK);
`;

const GLSL_ROUGH = `
  roughnessFactor = clamp(roughnessFactor + (dG - 0.5) * 0.5 * dK + (dF - 0.5) * 0.15 * dK, 0.04, 1.0);
`;

const GLSL_BUMP = `
  if (uDetail * uDBump > 0.0) {
    float dh = dHeight(vDPos);
    vec2 dd = vec2(dFdx(dh), dFdy(dh));
    vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
    vec3 r1 = cross(q1, normal), r2 = cross(normal, q0);
    float det = dot(q0, r1);
    vec3 grad = sign(det) * (dd.x * r1 + dd.y * r2);
    normal = normalize(abs(det) * normal - uDBump * uDetail * grad);
  }
  // poussière : s'accumule sur les faces tournées vers le haut
  {
    float up = clamp(inverseTransformDirection(normal, viewMatrix).y, 0.0, 1.0);
    float dust = smoothstep(0.55, 1.0, up) * smoothstep(0.35, 0.75, dG) * uDustAmt * dK;
    diffuseColor.rgb = mix(diffuseColor.rgb, uDust, dust);
    roughnessFactor = mix(roughnessFactor, 0.95, dust);
  }
`;

// kind : 'paint' | 'track' | 'plate' | 'stone' ...  (influence le relief)
const KIND = { paint: 0, track: 1, plate: 2 };

export function addDetail(m, { scale = 1.3, strength = 0.8, bump = 0.0025, kind = 'paint', dust = 0xb5a27c, dustAmt = 0.5 } = {}) {
  const uniforms = {
    uDetail: DETAIL,
    uDScale: { value: scale },
    uDStrength: { value: strength },
    uDBump: { value: bump },
    uDust: { value: new THREE.Color(dust) },
    uDustAmt: { value: dustAmt },
  };
  const k = KIND[kind] ?? 0;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vDPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvDPos = position;');
    sh.fragmentShader = `#define DKIND ${k}\n` + GLSL_DECL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GLSL_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${GLSL_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GLSL_BUMP}`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}|det${k}`;
  m.userData.detail = uniforms;
  return m;
}

// Matériau PBR de base. `detail: false` pour les matériaux émissifs ou plats.
export function stdMat(color, extra = {}, detail = {}) {
  const { detail: useDetail = true, ...params } = extra;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...params });
  if (useDetail) addDetail(m, detail);
  return m;
}

// ---------------------------------------------------------------- textures de sol
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// bruit de valeur tuilable (période `p` cases)
function tileNoise(u, v, p, seed) {
  const x = u * p, y = v * p, xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash2(((xi + a) % p + p) % p, ((yi + b) % p + p) % p, seed);
  return (h(0, 0) * (1 - sx) + h(1, 0) * sx) * (1 - sy) + (h(0, 1) * (1 - sx) + h(1, 1) * sx) * sy;
}

const TEX_CACHE = new Map();

// style : 'grass' | 'sand' | 'snow' | 'dirt' ; renvoie une texture ~gris moyen (multipliée par la couleur de sommet).
export function groundTexture(style, size = 512) {
  const key = `${style}:${size}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const seed = style.length * 7 + 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = tileNoise(u, v, 4, seed) * 0.4 + tileNoise(u, v, 8, seed + 1) * 0.28 + tileNoise(u, v, 16, seed + 2) * 0.18 + tileNoise(u, v, 64, seed + 3) * 0.14;
      let l;
      if (style === 'grass') {
        const blades = tileNoise(u * 1, v * 24, 32, seed + 5); // brins étirés
        l = 0.38 + n * 0.5 + (blades - 0.5) * 0.2;
      } else if (style === 'sand') {
        const ripple = Math.sin((u * 6 + n * 2.5) * Math.PI * 2) * 0.5 + 0.5; // rides de vent
        l = 0.46 + n * 0.3 + ripple * 0.1 + (tileNoise(u, v, 128, seed + 7) - 0.5) * 0.14;
      } else if (style === 'snow') {
        l = 0.55 + n * 0.28 + (tileNoise(u, v, 128, seed + 9) - 0.5) * 0.12;
      } else {
        l = 0.4 + n * 0.5 + (tileNoise(u, v, 96, seed + 11) - 0.5) * 0.2;
      }
      const c = Math.max(0, Math.min(255, l * 255)) | 0;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  TEX_CACHE.set(key, tex);
  return tex;
}

// Matériau de sol : couleurs de sommet x texture ; la texture est lue à deux échelles
// pour casser la répétition. `tile` = taille (m) d'un motif.
function groundMatFallback(style, tile) {
  const tex = groundTexture(style);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.96, metalness: 0, bumpMap: tex, bumpScale: 1.6 });
  tex.repeat.set(1, 1);
  m.userData.tile = tile;
  addDetail(m, { scale: 0.18, strength: 0.35, bump: 0, kind: 'paint', dustAmt: 0 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    // UV monde : le motif garde la même taille quelle que soit la taille du maillage
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n\tvGUv = (modelMatrix * vec4(position, 1.0)).xz;`).replace('void main() {', 'varying vec2 vGUv;\nvoid main() {');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying vec2 vGUv;\nvoid main() {')
      .replace('#include <map_fragment>', `
        vec2 gUv = vGUv / ${tile.toFixed(1)};
        vec4 sampledDiffuseColor = texture2D( map, gUv ) * ( 0.55 + 0.9 * texture2D( map, gUv * 0.173 + vec2( 0.37, 0.61 ) ).r ) * 1.9;
        diffuseColor *= sampledDiffuseColor;`);
  };
  m.customProgramCacheKey = () => `ground:${tile}`;
  // bumpMap utilise vBumpMapUv : on le garde cohérent avec la même échelle
  m.bumpMap = null;
  return m;
}


// ---------------------------------------------------------------- matériaux PBR texturés

// Triplanar : la texture est projetée selon les 3 axes de l'objet (aucun UV nécessaire, pas d'étirement sur les boîtes).
// set : clé de TEX (textures.js). tile : taille (m) d'un motif. normalStrength : relief des normales.
const TP_DECL = `
varying vec3 vTPos;
varying vec3 vTNrm;
uniform sampler2D tpD, tpN, tpR;
uniform float tpTile, tpNorm, tpTint;
uniform mat3 normalMatrix;
`;
export function texMat(set, { color = 0xffffff, tile = 3, normal = 0.9, tint = 1, ...params } = {}, detail = { strength: 0.35, bump: 0 }) {
  const t = TEX[set];
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...params });
  addDetail(m, { scale: 0.9, ...detail });
  if (!t) return m; // texture absente : couleur unie
  const uniforms = { tpD: { value: t.d }, tpN: { value: t.n }, tpR: { value: t.r }, tpTile: { value: tile }, tpNorm: { value: normal }, tpTint: { value: tint } };
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vTPos;\nvarying vec3 vTNrm;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTPos = position; vTNrm = normal;');
    sh.fragmentShader = TP_DECL + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec3 tpW = pow(abs(vTNrm), vec3(4.0)); tpW /= (tpW.x + tpW.y + tpW.z);
        vec2 tpUx = vTPos.zy / tpTile, tpUy = vTPos.xz / tpTile, tpUz = vTPos.xy / tpTile;
        vec3 tpAlb = texture2D(tpD, tpUx).rgb * tpW.x + texture2D(tpD, tpUy).rgb * tpW.y + texture2D(tpD, tpUz).rgb * tpW.z;
        diffuseColor.rgb *= mix(vec3(1.0), tpAlb, 1.0) * mix(1.0, 1.0, tpTint);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = texture2D(tpR, tpUx).g * tpW.x + texture2D(tpR, tpUy).g * tpW.y + texture2D(tpR, tpUz).g * tpW.z;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nx = texture2D(tpN, tpUx).xyz * 2.0 - 1.0, ny = texture2D(tpN, tpUy).xyz * 2.0 - 1.0, nz = texture2D(tpN, tpUz).xyz * 2.0 - 1.0;
          vec3 pert = vec3(0.0, nx.y, nx.x) * tpW.x + vec3(ny.x, 0.0, ny.y) * tpW.y + vec3(nz.x, nz.y, 0.0) * tpW.z;
          normal = normalize(normal + normalMatrix * pert * tpNorm);
        }`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}|tp`;
  return m;
}

// Sol : deux textures (A = dominante, B = plaques de terre/boue) mélangées par un bruit à grande échelle,
// projetées à plat depuis le dessus (coordonnées monde). Garde la teinte des couleurs de sommet de la carte.
export function groundMat(setA, setB, tile = 6) {
  const A = TEX[setA], B = TEX[setB];
  if (!A || !B) return groundMatFallback(setA === 'snow' ? 'snow' : setA === 'sand' ? 'sand' : 'grass', tile);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  addDetail(m, { scale: 0.18, strength: 0, bump: 0, dustAmt: 0 });
  const uniforms = {
    gAD: { value: A.d }, gAN: { value: A.n }, gAR: { value: A.r }, gBD: { value: B.d }, gBN: { value: B.n }, gBR: { value: B.r },
    gTile: { value: tile },
  };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGUv = (modelMatrix * vec4(position, 1.0)).xz;')
      .replace('void main() {', 'varying vec2 vGUv;\nvoid main() {');
    sh.fragmentShader = `
      varying vec2 vGUv;
      uniform sampler2D gAD, gAN, gAR, gBD, gBN, gBR;
      uniform float gTile;
      vec3 gMix; vec3 gPert; float gRough;
    ` + sh.fragmentShader
      .replace('void main() {', 'void main() {\n  vec2 gUv = vGUv / gTile; vec2 gUv2 = vGUv / (gTile * 5.7) + vec2(0.37, 0.61);\n  float gn = dNoise(vec3(vGUv * 0.04, 1.7)) * 0.65 + dNoise(vec3(vGUv * 0.15, 4.3)) * 0.35;\n  float gMask = smoothstep(0.46, 0.62, gn);')
      .replace('#include <map_fragment>', `
        vec3 gA = texture2D(gAD, gUv).rgb * (0.65 + 0.7 * texture2D(gAD, gUv2).g);
        vec3 gB = texture2D(gBD, gUv).rgb * (0.65 + 0.7 * texture2D(gBD, gUv2).g);
        diffuseColor.rgb *= mix(gA, gB, gMask);`)
      .replace('#include <color_fragment>', '#ifdef USE_COLOR\n  diffuseColor.rgb *= mix(vec3(1.0), vColor / 0.33, 0.55);\n#endif')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(texture2D(gAR, gUv).g, texture2D(gBR, gUv).g, gMask);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 gnA = texture2D(gAN, gUv).xyz * 2.0 - 1.0, gnB = texture2D(gBN, gUv).xyz * 2.0 - 1.0;
          vec3 gn3 = mix(gnA, gnB, gMask);
          normal = normalize(normal + (viewMatrix * vec4(gn3.x, 0.0, gn3.y, 0.0)).xyz * 0.9);
        }`);
  };
  m.customProgramCacheKey = () => `ground2:${setA}:${setB}`;
  return m;
}
