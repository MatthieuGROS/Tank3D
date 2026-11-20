// La Kasbah : très grande carte, le désert à l'ouest, la ville à l'est. Les équipes partent du nord
// et du sud : chacune a un flanc dans les dunes et un flanc dans les rues (symétrie (x, z) -> (x, -z)).
//
// Au centre, la kasbah se dresse sur un plateau, là où le sable rencontre le bitume. Sa grande zone de
// capture entoure le minaret, entre des maisons de terre crénelées. On y monte par quatre rampes douces ;
// partout ailleurs les flancs sont raides et freinent les chars.
//  - Ouest : crêtes de dunes en biais (positions « caisse cachée »), une grande dune étoilée, un plateau
//    rocheux, et un oued à sec creusé jusqu'au pied de la kasbah : on y roule à l'abri des tirs.
//  - Est : îlots d'immeubles percés de ruelles, un parc sur une butte (buissons), et une voie express en
//    tranchée le long de l'axe, coupée par un carrefour. Épaves et sacs de sable dans les rues.
import { mirrorZ, mirrorHillsZ, layout, hill, rng, bld, tower, adobe, ruin, mesa, rock, palm, tree, pond, crate, minaret,
  hulk, wreck, bus, sandbag, colonnade, derrick, bush, road, street } from '../props.js';

const PI = Math.PI;
const HX = 125, HZ = 105;
const SPAWN_DX = [-3, 3, -9, 9, -15, 15, -21, 21];
const PLATEAU = 5.5; // altitude du sommet de la kasbah

// ------------------------------------------------------------------ relief
const HILLS = mirrorHillsZ([
  // kasbah : plateau aux flancs raides + rampes douces vers les quatre points cardinaux
  hill(0, 0, 44, 34, 30, 22, PLATEAU),
  hill(0, 0, 62, 9, 30, 4, PLATEAU),
  hill(0, 0, 9, 62, 4, 22, PLATEAU),
  // oued à sec : de la muraille ouest jusqu'au pied de la kasbah
  hill(-96, 0, 34, 11, 30, 5, -3.5),
  // voie express en tranchée, coupée par un carrefour à x ≈ 92
  hill(76, 0, 14, 10, 11, 5, -3),
  hill(112, 0, 16, 10, 13, 5, -3),
  // dunes (côté nord, doublées au sud par symétrie) : crêtes en biais et une grande dune étoilée
  hill(-60, -50, 30, 9, 20, 2.5, 4.5, 0.45),
  hill(-98, -42, 24, 8, 14, 2, 4, -0.5),
  hill(-40, -80, 22, 8, 12, 2, 3.5, 0.2),
  hill(-75, -20, 18, 6, 10, 1.5, 3, 1.0),
  hill(-100, -82, 16, 13, 5, 4, 7),
  hill(-28, -42, 12, 6, 5, 1.5, 2.5, -0.8),
  // butte du parc, en ville
  hill(76, -58, 12, 11, 4, 3.5, 3),
]);

// ------------------------------------------------------------------ ville
// Îlot urbain de w × d : quatre parcelles séparées par des ruelles où un char se faufile.
// style : 'dense' (immeubles), 'low' (maisons basses), 'ruined' (immeubles et bâtiments effondrés).
function block(cx, cz, w, d, seed, style) {
  const r = rng(seed);
  const out = [];
  const alley = 7;
  const lw = (w - alley) / 2, ld = (d - alley) / 2;
  const merge = r() < 0.35; // deux parcelles réunies : un grand bâtiment, une ruelle de moins
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      if (merge && sx === 1) continue;
      const bw = merge ? w : lw, x = merge ? cx : cx + (sx * (alley + lw)) / 2;
      const z = cz + (sz * (alley + ld)) / 2;
      const roll = r();
      if (style === 'ruined' && roll < 0.45) {
        // immeuble effondré : pans de murs et gravats, on peut s'y abriter
        out.push(ruin(x - bw / 4, z, bw / 2, 1.6, 3.5), ruin(x + bw / 4, z + ld / 4, 1.6, ld / 2, 2.6), crate(x + bw / 5, z - ld / 4, 2.5, 2.5, 2));
      } else if (style === 'low' || (style === 'ruined' && roll < 0.75)) {
        out.push(bld(x, z, bw - 1, ld - 1, 5 + Math.round(r() * 3)));
      } else {
        out.push(tower(x, z, bw - 1, ld - 1, 11 + Math.round(r() * 12)));
      }
    }
  }
  return out;
}

const CITY = [
  // îlots : colonnes A (x 48), B (x 76), C (x 108) ; rangées 1 (z -26), 2 (z -58), 3 (z -89)
  block(48, -26, 16, 20, 11, 'ruined'), block(48, -58, 16, 20, 12, 'dense'), block(48, -89, 16, 18, 13, 'low'),
  block(76, -26, 20, 20, 21, 'dense'), block(76, -89, 20, 18, 23, 'dense'),
  block(108, -26, 20, 20, 31, 'dense'), block(108, -58, 20, 20, 32, 'ruined'), block(108, -89, 20, 18, 33, 'low'),
  // parc sur la butte (B2) : arbres, buissons, bassin
  tree(70, -62), tree(82, -64), tree(72, -50), tree(84, -52), tree(76, -66),
  bush(76, -57, 9, 6), bush(68, -55, 3, 8), pond(85, -58, 2.2),
  // rues : asphalte et ligne médiane
  street(61, -55, 10, 100), street(92, -55, 12, 100), street(84, -42, 82, 12), street(84, -74, 82, 12),
  // palmiers en bordure de la voie express
  palm(66, -13), palm(84, -13), palm(100, -13), palm(118, -13),
  // épaves et barricades
  bus(64, -42, 'z'), wreck(92, -36), wreck(88, -75, 'x'), wreck(58, -78), bus(102, -46, 'x'),
  sandbag(61, -34, 6, 1.4), sandbag(94, -66, 1.4, 6), sandbag(120, -42, 1.4, 6),
  wreck(80, -4, 'x'), // carcasse dans la tranchée
];

// ------------------------------------------------------------------ esplanade entre kasbah et ville
const ESPLANADE = [
  wreck(32, -22), hulk(30, -60), sandbag(36, -44, 6, 1.4), crate(38, -74, 3, 6), crate(30, -86),
  palm(26, -36), palm(34, -52),
];

// ------------------------------------------------------------------ kasbah (sommet du plateau)
const KASBAH_HALF = [
  adobe(-16, -8, 8, 6, 5), adobe(12, -10, 7, 8, 6), adobe(-13, -19, 7, 5, 4.5),
  adobe(21, -17, 6, 6, 8), adobe(-23, -15, 6, 7, 7), // bastions aux angles
  ruin(-27, -7, 1.6, 6, 3), ruin(27, -7, 1.6, 6, 3), // remparts éboulés au-dessus des rampes est et ouest
  crate(4, -16, 2.5, 2.5, 2.5), crate(-6, -9, 2.5, 2.5, 2.5),
  palm(-6, -15), palm(17, -24),
  ...colonnade(0, 0, 39, PI * 1.07, PI * 1.2, 3), // colonnes antiques sur le flanc ouest
];

// ------------------------------------------------------------------ désert
const DESERT = [
  mesa(-82, -64, 12, 9, 9), mesa(-76, -70, 6, 6, 6.5),
  rock(-30, -58, 2.6), rock(-48, -30, 2.2), rock(-112, -20, 3), rock(-58, -88, 2.4), rock(-118, -60, 2.8), rock(-90, -28, 2),
  hulk(-68, -34), hulk(-36, -38), hulk(-104, -60),
  ruin(-44, -64, 8, 1.6, 2.8), ruin(-112, -88, 1.6, 7, 3),
  derrick(-112, -100), crate(-104, -97, 3, 6),
  palm(-82, -6.5), palm(-92, -6),
];

export const KASBAH = {
  name: 'La Kasbah',
  desc: 'Très grande carte : dunes et oued à l’ouest, ville et voie express en tranchée à l’est. La kasbah perchée au centre porte une grande zone, au pied du minaret.',
  theme: 'desert',
  themeName: 'Désert · Ville',
  halfX: HX,
  halfZ: HZ,
  wallHeight: 3,
  zone: { x: 0, z: 0, r: 20 },
  // salon : le minaret occupe le centre de la zone ; le char d'exposition se pose au pied de la rampe nord,
  // sur un terrain plat dégagé sur 16 m (la caméra tourne à 11,5 m), face à la kasbah
  showcase: { x: -10, z: -38, yaw: 0.4 },
  hills: HILLS,
  // sol : le sable vire au bitume à l'est (client/src/models/map.js)
  paint: [{ x0: 24, x1: HX + 30, z0: -HZ - 8, z1: HZ + 8, soft: 18, hsl: [0.09, 0.05, 0.36] }],
  skyline: { x0: HX + 25, x1: HX + 110, z0: -HZ - 60, z1: HZ + 60, n: 26 }, // tours de la ville au loin
  ...layout(
    mirrorZ([CITY, ESPLANADE, KASBAH_HALF, DESERT]),
    // sur l'axe (un seul exemplaire) : minaret au cœur de la zone, mare au fond de l'oued
    minaret(0, 0, 2.2, 20), pond(-84, 0, 3.2), hulk(-104, 1.5),
    road(76, 0, 22, 8, 0x3f3f42), road(113, 0, 26, 8, 0x3f3f42), // chaussées au fond de la tranchée
  ),
  spawns: {
    red: SPAWN_DX.map((dx) => ({ x: dx * 1.5, z: -HZ + 8, yaw: 0 })),
    blue: SPAWN_DX.map((dx) => ({ x: dx * 1.5, z: HZ - 8, yaw: PI })),
  },
};
