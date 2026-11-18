// Chargement des modèles 3D libres de droits (dossier client/models, voir LICENSE.txt).
// Chargés une fois au démarrage (top-level await) ; si un fichier manque, le char de code est utilisé à la place.
import { GLTFLoader } from '/vendor/three-addons/loaders/GLTFLoader.js';
import { OBJLoader } from '/vendor/three-addons/loaders/OBJLoader.js';

export const GLB = {};

async function load(key, url) {
  try {
    if (url.endsWith('.obj')) {
      GLB[key] = await new OBJLoader().loadAsync(url);
    } else {
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      GLB[key] = gltf.scene;
    }
  } catch (e) {
    console.warn(`Modèle ${url} indisponible, char de secours utilisé`, e);
  }
}

await Promise.all([
  load('heavy', '/models/heavy_tank00.glb'),
  load('recon', '/models/reconTank.obj'),
  load('boulder', '/models/ph/boulder_01/boulder_01.gltf'),
]);
