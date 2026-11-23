// Circuit de la Colline : la carte de la Colline, agrandie, taillée pour la course.
// Un tour d'environ 920 m : départ sur une grande ligne droite, virage à droite, droite le long du bord est
// puis chicane, deuxième grande droite vers l'ouest avec une rivière à sauter, montée sur la colline et
// descente vers la ligne d'arrivée. Les obstacles sont décrits en repère piste (abscisse s le long du circuit,
// décalage latéral off) : voir shared/race.js.
//
//   tapis turbo      petite flèche lumineuse au sol : turbo (×1,5 de vitesse maximale pendant 1,3 s)
//   tremplin         rampe : on décolle au bout, la hauteur et la distance dépendent de la vitesse
//   boue             ralentit, d'autant plus que le char est léger
//   rivière          mortelle : retour au dernier point de passage. Un tremplin la franchit, un ponton la contourne
//   portes           barrières coulissantes qui s'ouvrent et se ferment à intervalle régulier
//   barres mobiles   blocs qui traversent la piste
//   bumpers          plots rebondissants (flipper) : ils renvoient le char
import { layout, tree, rock, bld, rng } from '../props.js';
import { buildRace } from '../race.js';

const W = 26; // largeur de la piste

const CONTROLS = [
  [-70, -127], [-35, -127], [0, -127], [35, -127], [70, -127], [96, -119], [113, -98], [115, -70], [115, -40], [98, -12],
  [122, 16], [112, 44], [108, 70], [90, 100], [62, 116], [30, 119], [-5, 119], [-40, 119], [-70, 112], [-98, 92], [-110, 58],
  [-102, 24], [-78, 2], [-50, -10], [-42, -38], [-66, -60], [-94, -76], [-102, -100], [-92, -119],
];

const RACE = buildRace({
  controls: CONTROLS,
  width: W,
  startS: 62,
  laps: 2,
  // points de passage obligatoires, dans l'ordre (la ligne de départ est le point 0)
  cps: [150, 200, 250, 310, 360, 420, 458, 540, 600, 668, 725, 790, 850],
  pads: [
    { s: 88, len: 10, w: 12 }, // avant le tremplin de la boue
    { s: 238, len: 10, w: 12 },
    { s: 472, len: 10, w: 12 }, // avant le tremplin de la rivière
    { s: 772, len: 10, w: 12 }, // descente de la colline, loin de la porte qui suit
  ],
  ramps: [
    { s: 108, len: 8, w: 11, rise: 3.3 }, // saute-boue
    { s: 491, len: 9, w: 11, rise: 4.4 }, // saute-rivière
    { s: 734, len: 8, w: 12, rise: 3.0 }, // sommet de la colline
  ],
  mud: [
    { s: 123, len: 12, w: W + 6 }, // après le tremplin : en l'air on la passe, sinon on s'y enlise
    { s: 692, len: 12, w: W + 6 }, // montée vers la colline
  ],
  // rivière : eau de part et d'autre d'un ponton (décalage +16 à +24), prise en travers de la piste
  water: [
    { s: 504, off: -8.5, len: 10, w: 49 },
    { s: 504, off: 42, len: 10, w: 36 },
  ],
  gates: [
    { s: 214, open: 4.5, closed: 3, slide: 0.8, phase: 0 },
    { s: 652, open: 4.5, closed: 3, slide: 0.8, phase: 3 },
    { s: 832, open: 4.5, closed: 3, slide: 0.8, phase: 6 },
    { s: 504, off: 20, hw: 4.6, open: 3.2, closed: 3.4, slide: 0.7, phase: 1.5 }, // entrée du ponton
  ],
  sliders: [
    { s: 372, amp: 8, len: 8, period: 5, phase: 0 },
    { s: 394, amp: 8, len: 8, period: 5, phase: 2.5 },
  ],
  bumpers: [
    { s: 276, off: 8, r: 2.3 }, { s: 299, off: -8, r: 2.3 }, { s: 322, off: 8, r: 2.3 },
  ],
});

// Décor autour de la piste : arbres et rochers en bordure (ils bloquent), jamais sur un obstacle ni sur un autre bout du circuit.
function scenery() {
  const r = rng(2025);
  const t = RACE.track;
  const items = [];
  const near = (x, z, list, d) => list.some((o) => Math.hypot(o.x - x, o.z - z) < d);
  const keep = [...RACE.cps, ...RACE.ramps, ...RACE.gates, ...RACE.water, ...RACE.pads, ...RACE.bumpers];
  for (let s = 4; s < t.length; s += 11) {
    for (const side of [-1, 1]) {
      const off = side * (W / 2 + 4.5 + r() * 5);
      const p = t.at(s + (r() - 0.5) * 6);
      const x = Math.round((p.x - p.fz * off) * 10) / 10, z = Math.round((p.z + p.fx * off) * 10) / 10;
      if (Math.abs(x) > 143 || Math.abs(z) > 149) continue;
      if (near(x, z, keep, 24) || t.nearest(x, z).d < W / 2 + 3.5) continue;
      items.push(r() < 0.22 ? rock(x, z, 1.6 + r() * 1.4) : tree(x, z));
    }
  }
  // quelques arbres au cœur de l'infield, pour l'ambiance
  for (let i = 0; i < 40; i++) {
    const x = Math.round((-120 + r() * 240) * 10) / 10, z = Math.round((-135 + r() * 270) * 10) / 10;
    if (t.nearest(x, z).d < W / 2 + 12 || near(x, z, keep, 30)) continue;
    items.push(tree(x, z));
  }
  return items;
}

const START = RACE.cps[0];

export const COURSE_COLLINE = {
  name: 'La Colline · Circuit',
  desc: 'Un tour de 920 m : grandes lignes droites, tremplins, rivière à franchir, portes coulissantes, boue, bumpers et une montée sur la colline. Chaque tir pousse les rivaux, d’autant plus loin qu’ils sont légers.',
  theme: 'meadow',
  halfX: 150,
  halfZ: 156,
  wallHeight: 3,
  hills: [{ x: -65, z: -5, rx: 62, rz: 55, ix: 26, iz: 20, h: 5 }],
  ...layout(scenery(), [bld(-10, -149, 46, 5, 5), bld(52, -149, 20, 5, 4)]),
  playerSpawn: { x: START.x, z: START.z, yaw: Math.atan2(START.fx, START.fz) },
  race: RACE,
};
