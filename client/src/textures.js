// Textures PBR (Poly Haven, CC0, 1K) : couleur + normales + rugosité. Chargées une fois au démarrage.
import * as THREE from 'three';

// nom court -> fichier dans client/textures
export const SETS = {
  grass: 'grass_ground', mud: 'brown_mud_dry', sand: 'coast_sand_01', crack: 'dry_ground_01', burnt: 'burned_ground_01',
  snow: 'snow_02', dirt: 'dirt', plaster: 'damaged_plaster', plaster2: 'rough_plaster_broken', brick: 'broken_brick_wall',
  concrete: 'rough_concrete', blocks: 'concrete_block_wall', roof: 'rusty_corrugated_iron', rust: 'rusty_painted_metal',
  bark: 'pine_bark', rock: 'mossy_rock',
};

export const TEX = {};
const loader = new THREE.TextureLoader();

function prep(t, srgb) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

async function loadSet(key, file) {
  try {
    const [d, n, r] = await Promise.all(['diff', 'nor', 'rough'].map((k) => loader.loadAsync(`/textures/${file}_${k}.jpg`)));
    TEX[key] = { d: prep(d, true), n: prep(n, false), r: prep(r, false) };
  } catch (e) {
    console.warn(`Texture ${file} indisponible`, e);
  }
}

await Promise.all(Object.entries(SETS).map(([k, f]) => loadSet(k, f)));
