// La Colline : grande carte en portrait, équipes au nord et au sud.
// Une colline à pente douce, adossée au mur ouest, coupe la carte en deux : de son spawn, on ne voit
// pas le spawn d'en face. Son sommet plat porte la zone de capture. À l'est, une route longe une
// bande de buissons : un char peut s'y glisser (pas de collision) et on n'y voit plus sa barre de vie.
// Carte symétrique nord-sud (x, z) -> (x, -z).
import { mirrorZ, layout, bld, rock, tree, crate, bush, road } from '../props.js';

const HX = 90, HZ = 125;
const SPAWN_DX = [-3, 3, -9, 9, -15, 15, -21, 21];
const SPAWN_X = -30; // les spawns sont centrés sur la partie gauche (hors route)

// Une moitié (côté nord, z < 0) ; l'autre moitié par symétrie.
const HALF = [
  bld(-62, -100, 12, 9, 5), bld(8, -104, 10, 8, 5), // 2 bâtiments par camp
  rock(-60, -66, 2.8), rock(-8, -78, 2.4), rock(26, -58, 3), rock(-76, -96, 2.2),
  tree(-44, -84), tree(-20, -92), tree(14, -86), tree(40, -96), tree(-72, -76), tree(48, -70),
  crate(-64, -72, 3, 3), crate(24, -68, 3, 3),
];

export const COLLINE = {
  name: 'La Colline',
  desc: 'Grande carte en portrait. Une colline à pente douce sépare les deux camps ; des buissons cachent les chars sur le flanc est.',
  theme: 'meadow',
  halfX: HX,
  halfZ: HZ,
  wallHeight: 3,
  zone: { x: -15, z: 0, r: 12 },
  // pente douce : ~3,8 m de haut, adossée au mur ouest ; sommet plat (ellipse intérieure)
  hills: [{ x: -15, z: 0, rx: 75, rz: 46, ix: 58, iz: 27, h: 3.8 }],
  ...layout(mirrorZ(HALF), [road(79, 0, 22, 2 * HZ), bush(68, 0, 8, 130)]),
  spawns: {
    red: SPAWN_DX.map((dx) => ({ x: SPAWN_X + dx, z: -HZ + 7, yaw: 0 })),
    blue: SPAWN_DX.map((dx) => ({ x: SPAWN_X + dx, z: HZ - 7, yaw: Math.PI })),
  },
};
