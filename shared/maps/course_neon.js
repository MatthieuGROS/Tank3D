// Vertige Néon : un circuit de science-fiction suspendu au-dessus du vide, avec du relief : lacets en montée jusqu'à un
// sommet à 34 m, saut géant, longue descente, puis réacteur, abîme et fourche. Il n'y a de sol que sous la piste :
// hors de la piste on tombe, et on réapparaît au dernier point de passage. PAS de garde-fous : c'est le principe.
// Le tour (environ 2 070 m) se fait dans le sens des aiguilles d'une montre vue de dessus (z vers le bas).
//
// Déroulé d'un tour :
//   le quai          grille de départ à plat, tapis turbo, trois plots en slalom
//   les lacets       la piste monte en trois étages (deux épingles à cheveux), portique laser, tapis turbo contre la pente
//   le sommet        plateau à 34 m, deux tapis turbo, puis un lanceur de gravité : 34 m de vide, atterrissage 6 m plus bas
//   la descente      200 m de pente à 25 %, de plus en plus vite ; bumpers de flipper dans les virages
//   champ clignotant damier de dalles qui s'effacent à tour de rôle : on lit le rythme et on louvoie
//   le choix         tout droit : un tapis turbo puis un lanceur qui catapulte de l'autre côté de 22 m d'abîme (raccourci
//                    de 160 m) ; ou virage à droite par le réacteur, la voie « sage »
//   le réacteur      anneau autour d'un cœur d'énergie, balayé par deux rotors (ils projettent les chars dans le vide)
//   la montée ouest  remontée sinueuse jusqu'à 24 m, deux tapis turbo, un tremplin, 16 m d'abîme
//   la fourche       pont étroit (rapide, et à portée des tirs) ou voie large (barres mobiles, portique), puis la descente vers le quai
//
//   tapis turbo   flèches lumineuses : turbo (×1,5 de vitesse maximale pendant 1,3 s)
//   lanceur       plaque de gravité : projette le char à la verticale et lui donne de l'élan (en l'air on ne freine plus)
//   dalle         s'efface périodiquement (elle clignote avant de disparaître)
//   rotor         barre rotative autour d'un pivot
// Les obstacles sont décrits en repère piste (abscisse s le long du circuit, décalage latéral off : voir shared/race.js),
// ou en coordonnées du monde pour les plateformes libres (plates). L'altitude suit `elev` (repères [s, hauteur]).
import { buildRace, Track } from '../race.js';

const W = 26; // largeur de la piste « normale »
const D2R = Math.PI / 180;

// ----------------------------------------------------------------------------- tracé (x vers l'est, z vers le sud)
const line = (x0, z0, x1, z1, step = 45) => {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  return Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]); // sans le point d'arrivée
};
const arc = (cx, cz, r, a0, a1, n) => Array.from({ length: n }, (_, i) => {
  const a = (a0 + ((a1 - a0) * i) / n) * D2R;
  return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
}); // sans le point d'arrivée

const TOP = -205, BOT = 190, RS = 34; // RS : rayon des épingles
const J1 = -48, LEG1 = -70, LEG2 = -110, J2 = -132, UZ = 110, RC = (LEG1 + LEG2) / 2; // le choix et le réacteur
const SX = 232; // x du flanc du sommet
const LX = -278; // x du bord ouest
const CONTROLS = [
  ...line(-150, TOP, 100, TOP, 50), // le quai puis le premier étage
  ...arc(100, TOP + RS, RS, -90, 90, 6), // première épingle (à droite)
  ...line(100, TOP + 2 * RS, 10, TOP + 2 * RS, 45), // deuxième étage, vers l'ouest
  ...arc(10, TOP + 3 * RS, RS, -90, -270, 6), // deuxième épingle (à gauche)
  ...line(10, TOP + 4 * RS, 170, TOP + 4 * RS, 53), // troisième étage, vers l'est
  ...arc(170, TOP + 4 * RS + (SX - 170), SX - 170, -90, 0, 5), // virage vers le flanc du sommet
  ...line(SX, TOP + 4 * RS + (SX - 170), SX, 59, 34), // le plateau, le saut
  [SX + 6, 100], [SX - 8, 140], [SX - 40, 168], [SX - 80, 184], // la descente
  ...line(130, BOT, J1, BOT, 36), // champ clignotant puis ligne droite du choix
  ...arc(J1, BOT - 22, 22, 90, 180, 3), // entrée du réacteur
  ...line(LEG1, BOT - 22, LEG1, UZ, 29),
  ...arc(RC, UZ, 20, 0, -180, 6), // l'anneau
  ...line(LEG2, UZ, LEG2, BOT - 22, 29),
  ...arc(J2, BOT - 22, 22, 0, 90, 3), // sortie du réacteur
  ...line(J2, BOT, -170, BOT, 38),
  [-210, 184], [-248, 160], [-272, 120], // la montée ouest, qui s'enroule
  ...line(LX, 90, LX, 0, 45),
  [LX + 6, -50], [LX + 14, -100], [LX + 22, -148], [LX + 50, -183], [-215, TOP + 8], [-185, TOP + 2], // la fourche puis la descente vers le quai
];

// abscisse (m) du point de piste le plus proche du point (x, z) : permet de décrire le circuit avec des coordonnées du monde
const probe = new Track(CONTROLS);
const S = (x, z) => probe.nearest(x, z).s;
const LENGTH = probe.length;

// ----------------------------------------------------------------------------- repères (abscisses)
const sStart = S(-80, TOP);
const sGiantA = S(SX, 25), sGiantB = S(SX, 59); // le saut géant : 34 m de vide
const sFieldA = S(112, BOT), sFieldB = S(18, BOT); // champ clignotant (le ruban est remplacé par des dalles)
const sJ1 = S(J1, BOT); // début du virage vers le réacteur
const sLeg1 = S(LEG1, BOT - 22), sRing0 = S(LEG1, UZ), sRing1 = S(LEG2, UZ), sLeg2 = S(LEG2, BOT - 22);
const sJ2 = S(J2, BOT);
const JUMP_Z = 78; // milieu du tremplin de l'abîme (long de 9 m) : le vide commence juste au bout
const sRamp = S(LX, JUMP_Z), sGapA = S(LX, JUMP_Z - 5), sGapB = S(LX, JUMP_Z - 21); // 16 m de vide
const sForkA = S(LX, 10), sForkB = S(LX + 14, -100);

// profil d'altitude : plat au départ, montée en lacets jusqu'au sommet (34 m), saut, descente jusqu'au champ (0),
// montée ouest jusqu'à 24 m, puis retour à plat vers le quai
const elev = [
  [0, 0], [S(80, TOP), 0],
  [S(SX, 0), 34], [S(SX, 20), 34],
  [sGiantB, 28], [S(135, BOT), 0],
  [S(-150, BOT), 0], [S(LX + 4, 100), 24],
  [S(LX + 4, -40), 24], [S(-195, TOP + 4), 0],
  [LENGTH, 0],
];

// ----------------------------------------------------------------------------- bandes de piste
const strips = [];
const span = (s0, s1, w0, w1 = w0, off0 = 0, off1 = off0) => strips.push({ s0, s1, w0, w1, off0, off1 });
span(0, sGiantA, W);
span(sGiantB, sJ1 - 30, W);
span(sJ1 - 30, sJ1 + 8, W, 18); // la piste se resserre à l'approche du virage
span(sJ1 + 8, sRing0 - 24, 18);
span(sRing0 - 24, sRing0 + 2, 18, 30); // l'anneau du réacteur est plus large
span(sRing0 + 2, sRing1 - 2, 30);
span(sRing1 - 2, sRing1 + 24, 30, 18);
span(sRing1 + 24, sJ2 - 8, 18);
span(sJ2 - 8, sJ2 + 30, 18, W);
span(sJ2 + 30, sGapA, W);
span(sGapB, sForkA, W); // atterrissage du saut
// la fourche : le pont étroit (à gauche, vers l'extérieur) et la voie large (à droite) s'écartent, puis se rejoignent
const FORK = 30;
span(sForkA, sForkA + FORK, W, 8, 0, -19); // pont
span(sForkA, sForkA + FORK, W, 20, 0, 9.5); // voie large
span(sForkA + FORK, sForkB - FORK, 8, 8, -19, -19);
span(sForkA + FORK, sForkB - FORK, 20, 20, 9.5, 9.5);
span(sForkB - FORK, sForkB, 8, W, -19, 0);
span(sForkB - FORK, sForkB, 20, W, 9.5, 0);
span(sForkB, LENGTH, W);

// ----------------------------------------------------------------------------- champ clignotant
// Quatre colonnes de dalles par rangée. Les colonnes sont décalées d'une seconde : à tout instant, deux colonnes ou plus
// sont debout. Les rangées se décalent de 0,55 s : une onde qui avance à 15 m/s. Plus lent, plus rapide, il faut louvoyer.
const FIELD_COLS = 4, FIELD_ROWS = 12;
const fieldLen = sFieldB - sFieldA;
const blinks = [];
for (let r = 0; r < FIELD_ROWS; r++) {
  for (let c = 0; c < FIELD_COLS; c++) {
    blinks.push({
      s: sFieldA + ((r + 0.5) * fieldLen) / FIELD_ROWS,
      off: -W / 2 + ((c + 0.5) * W) / FIELD_COLS,
      len: fieldLen / FIELD_ROWS - 0.5, w: W / FIELD_COLS - 0.5,
      period: 4, up: 2.5, phase: (r * 0.55 + c * 1.0) % 4,
    });
  }
}

// ----------------------------------------------------------------------------- le choix : quai du saut au-dessus de l'abîme
const GAP_X0 = J1 - 31, GAP_X1 = J1 - 53; // bord du quai et bord de l'atterrissage (22 m de vide)
const plates = [
  { x: (GAP_X0 + J1 + 23) / 2, z: BOT, fx: -1, fz: 0, len: J1 + 23 - GAP_X0, w: 20 }, // quai d'envol (avec le tapis et le lanceur)
  { x: (GAP_X1 + J2 - 10) / 2, z: BOT, fx: -1, fz: 0, len: GAP_X1 - (J2 - 10), w: 20 }, // atterrissage
];

const RACE = buildRace({
  controls: CONTROLS,
  width: W,
  startWidth: 30,
  startS: sStart,
  laps: 2,
  strips,
  plates,
  blinks,
  elev,
  hollow: [[sFieldA, sFieldB]],
  stuckSeconds: 50, // le réacteur fait 330 m sans point de passage (le raccourci le saute)
  // points de passage obligatoires, dans l'ordre
  cps: [
    S(40, TOP), S(100 + RS, TOP + RS), S(30, TOP + 2 * RS), S(10 - RS, TOP + 3 * RS), S(80, TOP + 4 * RS), S(SX, 0),
    S(SX + 4, 92), S(SX - 52, 176), S(130, BOT), S(8, BOT), S(-162, BOT), S(-262, 138), S(LX, 14), S(LX + 14, -100), S(LX + 40, -178),
  ],
  pads: [
    { s: S(-66, TOP), len: 12, w: 12 }, // juste après la ligne : tout le monde part en turbo
    { s: S(0, TOP), len: 10, w: 8 },
    { s: S(60, TOP + 2 * RS), len: 10, w: 10 }, // lacets : un turbo contre la pente
    { s: S(40, TOP + 4 * RS), len: 10, w: 10 },
    { s: S(120, TOP + 4 * RS), len: 10, w: 12 },
    { s: sGiantA - 16, len: 10, w: 12 }, // plateau du sommet : deux tapis avant le lanceur
    { s: sGiantA - 32, len: 10, w: 12 },
    { s: S(SX - 30, 176), len: 10, w: 12 }, // descente
    { x: J1 + 48, z: BOT, fx: -1, fz: 0, len: 12, w: 8, avoid: true }, // le choix : la voie centrale pousse vers le saut (les robots l'évitent)
    { s: sRamp - 14, len: 10, w: 12 }, // abîme : deux tapis
    { s: sRamp - 28, len: 10, w: 12 },
    { s: S(LX + 12, -60), len: 10, w: 7, off: -19 }, // le pont
  ],
  launch: [
    { s: sGiantA - 1.5, len: 3, w: 14, vy: 14, kick: 22 }, // le saut géant
    { x: GAP_X0 + 1.5, z: BOT, fx: -1, fz: 0, len: 3, w: 14, vy: 13, kick: 21 }, // le raccourci
  ],
  ramps: [
    { s: sRamp, len: 9, w: 12, rise: 4.4 },
  ],
  blocks: [
    { s: S(-35, TOP), off: -8, len: 4, w: 4, h: 3 }, // slalom du quai
    { s: S(-5, TOP) + 6, off: 8, len: 4, w: 4, h: 3 },
    { s: S(40, TOP), off: -7, len: 4, w: 4, h: 3 },
  ],
  gates: [
    { s: S(130, TOP + 4 * RS), hw: W / 2 + 2, open: 4, closed: 2.6, slide: 0.6, phase: 0 }, // troisième étage
    { s: sForkA + FORK + 14, off: 9.5, hw: 10.5, open: 3.6, closed: 2.6, slide: 0.6, phase: 1.8 }, // voie large
    { s: S(LEG1, 140), hw: 9.5, open: 3.4, closed: 2.4, slide: 0.6, phase: 0.6 }, // entrée du réacteur
  ],
  sliders: [
    { s: sForkA + FORK + 34, off: 9.5, amp: 5, len: 8, period: 4.2, phase: 0 },
    { s: sForkA + FORK + 50, off: 9.5, amp: 5, len: 8, period: 4.2, phase: 2.1 },
  ],
  spinners: [
    // les deux rotors font une croix ; ils tournent dans le sens de la course (ils rattrapent les chars par derrière)
    { x: RC, z: UZ, fx: 1, fz: 0, len: 52, thick: 1.8, h: 2.4, period: 6, phase: 0, dir: -1 },
    { x: RC, z: UZ, fx: 1, fz: 0, len: 52, thick: 1.8, h: 2.4, period: 6, phase: 1.5, dir: -1 },
  ],
  bumpers: [
    { s: S(SX + 4, 104), off: 6, r: 2.3 }, { s: S(SX - 10, 140), off: -6, r: 2.3 }, { s: S(SX - 56, 178), off: 6, r: 2.3 },
  ],
  rails: [], // jamais de murs sur les bords : si on tombe, on repart du dernier point de passage
});

const START = RACE.cps[0];

export const COURSE_NEON = {
  name: 'Vertige Néon · Circuit',
  desc: 'Un tour de 2 070 m au-dessus du vide, façon science-fiction : montée en lacets jusqu’à 34 m, saut géant de 34 m, descente à 25 %, dalles qui s’effacent, réacteur et ses rotors, abîme, fourche pont/voie large. Aucun garde-fou : si on tombe, on repart du dernier point de passage. Au choix à mi-parcours : tout droit et un lanceur de gravité pour sauter 22 m d’abîme (raccourci d’environ 160 m), ou le détour par le réacteur. Chaque tir pousse les rivaux.',
  theme: 'neon',
  halfX: 330,
  halfZ: 250,
  wallHeight: 3,
  boxes: [],
  circles: [],
  flats: [],
  playerSpawn: { x: START.x, z: START.z, yaw: Math.atan2(START.fx, START.fz) },
  race: RACE,
};
export { LENGTH };
