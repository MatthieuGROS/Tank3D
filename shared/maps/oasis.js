// Oasis : désert, deux plateaux rocheux décalés en hélice autour d'une oasis en ruines.
// Les pipelines (bas) barrent la route aux chars mais pas aux obus : on tire par-dessus,
// on passe par les brèches. Les mares de l'oasis jouent le même rôle au centre.
import { mirror, layout, mesa, rock, dune, palm, pond, ruin, bld, crate, derrick, pipeline, colonnade, road } from '../props.js';

const PI = Math.PI;
const HX = 80, HZ = 52;
const SPAWN_Z = [-3, 3, -9, 9, -15, 15, -21, 21];

// Une moitié de la carte ; l'autre est obtenue par symétrie centrale.
const HALF = [
  // plateau nord (côté rouge) : bloc principal + marches
  mesa(-20, 33, 34, 16, 11), mesa(-12, 45, 18, 14, 12), mesa(-34, 28, 8, 8, 8),
  rock(-24, 22.5, 1.8),
  // oasis : mare, palmiers, ruines d'un temple autour de la zone
  pond(-14, 10, 5.5), palm(-20.5, 13), palm(-10, 17), palm(-19, 4.5), palm(-7.5, 9.5),
  ...colonnade(0, 0, 13.5, PI * 0.18, PI * 0.42, 3),
  ruin(0, 17, 9, 1.6, 3.2), ruin(-26, -14, 1.6, 8, 2.8),
  // pipeline ouest avec trois brèches
  ...pipeline(-48, -HZ, HZ, [[-28, -15], [9, 21], [39, HZ]]),
  // installations pétrolières et maisons de terre près de la base
  derrick(-60, 38), derrick(-38, -42),
  bld(-64, -38, 10, 8, 5), bld(-30, -31, 8, 8, 4), crate(-54, 4, 3, 6), crate(-56, -24),
  // dunes
  dune(-67, 46, 5), dune(-24, -45, 7), dune(-6, -32, 4.5), dune(-34, 6, 4.5), dune(-66, 28, 4),
  // pistes de sable (décor)
  road(-60, 0, 40, 7), road(-28, -8, 30, 6),
];
export const OASIS = {
  name: 'Oasis',
  desc: 'Plateaux en hélice autour d’une oasis en ruines. Les pipelines arrêtent les chars, pas les obus.',
  theme: 'desert',
  halfX: HX,
  halfZ: HZ,
  wallHeight: 3,
  zone: { x: 0, z: 0, r: 9 },
  ...layout(mirror(HALF)),
  spawns: {
    red: SPAWN_Z.map((z) => ({ x: -72, z, yaw: PI / 2 })),
    blue: SPAWN_Z.map((z) => ({ x: 72, z: -z, yaw: -PI / 2 })),
  },
};
