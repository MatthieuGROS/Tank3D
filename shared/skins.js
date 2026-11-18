// Skins (apparences) des chars des joueurs. Simples données, partagées serveur + client.
//
// Un skin ne change que les couleurs de la caisse, de la tourelle et des pièces sombres ;
// les marques d'identification (bandes de caisse, anneau de tourelle, fanion d'antenne)
// gardent toujours la couleur de l'équipe : on reconnaît allié et ennemi quel que soit le skin.
//
// Champs :
//   name, desc     affichés au salon
//   hull           couleur de la caisse (null = couleur de l'équipe)
//   turret, dark   couleurs de la tourelle et des pièces sombres (par défaut : dérivées de hull)
//   camo           camouflage peint sur caisse et tourelle : { colors: [fond, tache, tache, tache], scale, pixel }
//                  scale = taille des taches (m) ; pixel = camouflage numérique en carrés de cette taille (m).
//                  La tourelle est un peu plus sombre que la caisse.
//   filigree       filets lumineux en losanges sur caisse et tourelle, balayés par un reflet animé :
//                  { color, cell } (cell = taille des losanges, m)
//   gloss          finition laquée de la caisse et de la tourelle (brillance, ~20 à 80)
//   parts          autres pièces repeintes : { metal, wheel, track, canvas: { color, gloss, glow }, lamp: couleur }
//                  (metal = canon, échappements, antennes ; glow = lueur propre)
//   emblem         insigne peint sur les flancs : { color, kind, gloss, glow } (kind : 'star' étoile
//                  cerclée, 'chevrons' double chevron étoilé, 'laurel' étoile dans une couronne de lauriers)
//   aura           couleur des paillettes qui s'élèvent du char en vie
//   legend         skin de prestige : nom doré et pastille animée au salon
//   swatch         fond CSS de la pastille du salon (par défaut : la couleur hull)
//   unlock         condition de déblocage, absente = disponible pour tous :
//                    { mission, stars }  réussir cette mission avec au moins `stars` étoiles
//                    { all: n }          réussir toutes les missions de la campagne avec au moins n étoiles
//   hint           texte affiché tant que le skin est verrouillé
import { MISSIONS } from './campaign.js';

export const SKINS = {
  team: {
    name: 'Réglementaire',
    desc: 'Peinture aux couleurs de l’équipe.',
  },
  olive: {
    name: 'Olive de recrue',
    desc: 'Vert olive mat sorti du dépôt. Rien de bien glorieux, mais c’est le tien.',
    hull: 0x5f6b3c,
    unlock: { mission: 'm1', stars: 1 },
    hint: 'Réussir « Baptême du feu » (campagne, au moins ★).',
  },
  liberator: {
    name: 'Libérateur',
    desc: 'Camouflage quatre tons et étoile de campagne sur les flancs : la marque de ceux qui ont mené l’escouade de la prairie jusqu’au Léviathan.',
    hull: 0x8f8259,
    dark: 0x34301f,
    camo: { colors: [0x8f8259, 0x4f5a34, 0x5c4330, 0x26261f], scale: 1.1 },
    emblem: { color: 0xe9e4d2 },
    swatch: 'radial-gradient(circle at 28% 30%, #26261f 0 18%, transparent 19%), radial-gradient(circle at 72% 66%, #5c4330 0 24%, transparent 25%), radial-gradient(circle at 70% 22%, #4f5a34 0 20%, transparent 21%), radial-gradient(circle at 25% 78%, #4f5a34 0 22%, transparent 23%), #8f8259',
    unlock: { all: 1 },
    hint: `Réussir les ${MISSIONS.length} missions de la campagne (au moins ★ sur chacune).`,
  },
  frost: {
    name: 'Givre',
    desc: 'Camouflage numérique d’hiver et chevrons de vétéran : forgé dans le blizzard de Kessel, réservé à ceux qui ont tout repris en Vétéran.',
    hull: 0xb9c0c6,
    dark: 0x30363c,
    camo: { colors: [0xb9c0c6, 0x818c95, 0x4b555e, 0x23282d], scale: 0.9, pixel: 0.2 },
    emblem: { color: 0x1c2024, kind: 'chevrons' },
    swatch: 'conic-gradient(from 90deg at 50% 50%, #818c95 0 25%, #b9c0c6 0 50%, #4b555e 0 75%, #23282d 0) 0 0 / 12px 12px, #b9c0c6',
    unlock: { all: 2 },
    hint: `Réussir les ${MISSIONS.length} missions de la campagne en Vétéran (au moins ★★ sur chacune).`,
  },
  sovereign: {
    name: 'Souverain',
    desc: 'Laque noire, filets d’or et canon doré. Le skin des commandants qui ont terminé toute la campagne en Élite : quand il passe, tout le monde sait.',
    hull: 0x121317,
    dark: 0x0b0b0e,
    gloss: 60,
    filigree: { color: 0xe0b04a, cell: 1.0 },
    parts: {
      metal: { color: 0xd9a21e, gloss: 90, specular: 0xfff2c0, glow: 0.22 },
      wheel: { color: 0x2a2b31, gloss: 40 },
      track: { color: 0x141518 },
      canvas: { color: 0x1c1d22 },
      lamp: 0xffd77a,
    },
    emblem: { color: 0xd9a63a, kind: 'laurel', gloss: 80, glow: 0.25 },
    aura: 0xffcf5a,
    legend: true,
    swatch: 'linear-gradient(115deg, transparent 30%, rgba(255, 220, 130, 0.75) 45%, transparent 60%) 0 0 / 300% 100%, repeating-linear-gradient(45deg, transparent 0 7px, #d9a63a 7px 8px), repeating-linear-gradient(-45deg, transparent 0 7px, #d9a63a 7px 8px), #121317',
    unlock: { all: 3 },
    hint: `Réussir les ${MISSIONS.length} missions de la campagne en Élite (★★★ sur chacune).`,
  },
};

export const DEFAULT_SKIN = 'team';

// Le joueur (ses étoiles de campagne `cleared`) a-t-il débloqué ce skin ?
export function skinUnlocked(id, cleared) {
  const skin = SKINS[id];
  if (!skin) return false;
  const u = skin.unlock;
  if (!u) return true;
  if (u.all) return MISSIONS.every((m) => (cleared?.[m.id] ?? 0) >= u.all);
  return (cleared?.[u.mission] ?? 0) >= u.stars;
}

export const unlockedSkins = (cleared) => Object.keys(SKINS).filter((id) => skinUnlocked(id, cleared));
