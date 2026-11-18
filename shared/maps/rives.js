// Deux-Rives : hiver, deux bras de fleuve encadrent une île où se trouve la zone.
// Les chars ne passent que par quatre ponts ; les obus, eux, traversent l'eau : les
// berges deviennent des positions de tir et chaque pont un goulet à forcer.
import { mirror, layout, river, bunker, wall, hedgehog, hedgeLine, grove, rock, crate, hamlet, road } from '../props.js';

const PI = Math.PI;
const HX = 78, HZ = 54;
const SPAWN_Z = [-3, 3, -9, 9, -15, 15, -21, 21];

// Une moitié : le bras est (x = 24) et sa berge ; la symétrie donne le bras ouest.
const HALF = [
  ...river(24, 10, -HZ, HZ, [{ z: 31, w: 10 }, { z: -20, w: 8 }]),
  // île : casemates et muret autour de la zone, hérissons en sortie de pont
  bunker(0, 15, 10, 4), wall(10, -3, 1.6, 9),
  hedgehog(14, 23), hedgehog(14, 39), hedgehog(14, -27), hedgehog(14, -12.5),
  ...grove(-6, 39, 8, 5, 7), rock(8, 47, 3), rock(-14, -44, 2.4),
  // berge est : forêt, hameau, défenses de tête de pont
  ...grove(54, 42, 11, 14, 21), ...grove(46, -2, 5, 3, 33),
  ...hamlet(46, -38),
  bunker(37, 22, 6, 4), ...hedgeLine(33, 2, 33, 12, 5),
  rock(41, 8, 3), rock(66, -42, 3), rock(36, -47, 2.2), crate(44, -6), crate(40, 46, 3, 6),
  // routes de la base vers les ponts (décor)
  road(50, 31, 42, 6), road(48, -20, 40, 6),
];

export const RIVES = {
  name: 'Deux-Rives',
  desc: 'Une île entre deux bras de fleuve, quatre ponts. Les obus franchissent l’eau, les chars non.',
  theme: 'snow',
  halfX: HX,
  halfZ: HZ,
  wallHeight: 3,
  zone: { x: 0, z: 0, r: 10 },
  ...layout(mirror(HALF)),
  spawns: {
    red: SPAWN_Z.map((z) => ({ x: -70, z, yaw: PI / 2 })),
    blue: SPAWN_Z.map((z) => ({ x: 70, z: -z, yaw: -PI / 2 })),
  },
};
