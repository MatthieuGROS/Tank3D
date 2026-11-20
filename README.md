# Tank 3D

Jeu de chars 3D multijoueur en réseau local (escarmouche en équipes, campagne coopérative ou course). Un joueur lance le serveur, les autres
ouvrent simplement une adresse dans leur navigateur (rien à installer chez eux).

## Jouer

1. **L'hôte** double-clique sur `start.bat` (ou lance `npm start`). Node.js doit être installé sur son PC.
2. La console affiche deux adresses :
   - `http://localhost:3000` pour l'hôte ;
   - `http://192.168.x.x:3000` à donner aux autres joueurs (même Wi-Fi / même réseau).
3. Chacun se connecte avec un pseudo et un mot de passe, puis choisit une équipe. L'hôte (premier arrivé) lance la partie.

### Comptes

- Le premier passage avec un pseudo libre **crée le compte** (mot de passe de 4 caractères minimum).
  Ensuite, il faut le même mot de passe pour s'y reconnecter (le pseudo ne tient pas compte des majuscules).
- Un compte ne peut être connecté qu'**une fois à la fois**. Si un PC perd la connexion, le compte
  se libère tout seul au bout de 15 s environ.
- Les comptes et leur progression sont enregistrés sur le PC du serveur, dans `accounts.json`
  (mots de passe stockés hachés). Supprimer ce fichier efface tous les comptes.
- Le mot de passe circule en clair sur le réseau local : n'utilisez pas un mot de passe important.

Si les autres n'arrivent pas à se connecter : au premier lancement, Windows demande
d'autoriser Node.js dans le pare-feu, il faut accepter pour les réseaux privés.

### Règles

- Une partie se joue en plusieurs manches (3 manches gagnantes par défaut, réglable dans le salon).
- Une manche se gagne en **détruisant tous les chars adverses** ou en **capturant la zone centrale**
  (20 s seul dans la zone, plus vite à plusieurs ; la capture est bloquée tant qu'un ennemi s'y trouve).
- Pas de réapparition pendant une manche : un char détruit observe ses coéquipiers.
- Au bout de 3 minutes, l'équipe à qui il reste le plus de blindage gagne la manche.
- **Chiffres de dégâts** : chaque obus qui touche affiche les dégâts infligés au-dessus de la cible (en rouge s'il la
  détruit). On voit ses propres tirs, ou ceux du joueur qu'on observe en spectateur.
- **Décor destructible** : caisses, arbres, palmiers, hérissons antichars, colonnes, murets et murs en ruine cèdent
  sous les obus (ils ont des points de structure : une caisse encaisse 2 tirs moyens, un muret 5). Bâtiments,
  rochers, plateaux, bunkers, pipelines, eau et dunes restent indestructibles. Le décor est remis à neuf à chaque
  manche (et à chaque mission en campagne).

### Commandes

| Touche | Action |
| --- | --- |
| Z Q S D | avancer / tourner / reculer |
| ← → | tourner la tourelle (appui bref = visée fine) |
| Espace ou ↑ | tirer |
| A / E | obusier Tonnerre : raccourcir / allonger la portée |
| Tab | tableau des scores |
| Échap | menu en jeu (équipe, spectateur, char ; pause, fin de partie et exclusion pour l'hôte) |

Le cercle blanc à l'écran indique où l'obus va frapper.

### Spectateurs et rôle de l'hôte

- **Équipes figées pendant toute la partie** : quand l'hôte lance, les joueurs qui ont une équipe sont engagés
  jusqu'à la fin de la partie (toutes les manches, ou la mission en campagne). Personne d'autre n'entre en jeu
  avant la partie suivante, pas même l'hôte. Un joueur engagé ne change pas d'équipe ; il peut seulement quitter
  la partie (il la regarde alors en spectateur).
- **Arriver en cours de partie** (ou ne pas y être engagé) : on la regarde en spectateur, et on peut déjà choisir
  son équipe pour la **partie suivante** (modifiable jusqu'à son lancement), ou rester simplement spectateur.
- **Mode spectateur** : <kbd>←</kbd> <kbd>→</kbd> pour passer d'un joueur à l'autre, <kbd>F</kbd> pour la
  **caméra libre** (ZQSD, flèches ou glisser à la souris pour regarder, Espace / C pour monter / descendre,
  molette pour la hauteur, Maj pour aller vite). Un char détruit peut aussi passer d'un coéquipier à l'autre.
- **Menu (Échap)** : choisir son équipe pour la partie suivante (spectateurs), quitter la partie en cours (joueurs),
  revenir au salon pour changer de char ou de skin.
- **L'hôte** peut en plus, depuis ce menu : **mettre la partie en pause** (tout est figé, chrono compris),
  **terminer la partie** (ou abandonner la mission), et **exclure** un joueur (aussi depuis le salon). Un joueur
  exclu ne peut pas revenir avant une minute.
- En campagne, si toute l'escouade quitte le terrain, la mission échoue.

### Jouer seul ou compléter les équipes

Dans le salon, l'hôte peut ajouter des bots dans chaque équipe avec le bouton **+ Bot**
(et les retirer avec la croix). Pour une partie solo : rejoins une équipe, ajoute des bots
en face (et à tes côtés si tu veux), puis lance.

## Course (chacun pour soi)

Mode **Course** (page **Opérations**), sur deux circuits : « La Colline · Circuit » (920 m par tour) et « Vertige Néon · Circuit » (2 070 m, suspendu au-dessus du vide, avec montées, descentes et grands sauts), 1 à 5 tours.
Pas d'équipes ni de points de vie : on franchit **tous les points de passage dans l'ordre** et on termine les tours avant les autres.

- **Tirs** : un obus ne blesse pas, il **pousse**. Plus le char tireur est puissant (dégâts) et plus le char touché est léger
  (champ `weight` dans `shared/constants.js`, affiché en tonnes dans la fiche du char), plus la poussée est forte (`pushSpeed` dans `shared/race.js`).
  Un Lynx touché par un Harpon est projeté à plus de 15 m, un Bastion à peine à quelques mètres.
- **Obstacles** : tapis turbo, tremplins (la vitesse fait la distance du saut), boue (ralentit surtout les chars légers), rivière
  (à sauter ou à contourner par le ponton ; à l'eau = retour au dernier point de passage, +3 s), portes coulissantes et barres mobiles
  (elles dépendent de l'horloge de course, partagée serveur / client), bumpers de flipper.
- **Vitesses resserrées** : en course les chars sont rapprochés autour d'une même vitesse (`raceDef`), sinon le Bastion n'aurait aucune chance face au Lynx.
- **R** : retour au dernier point de passage (+3 s). **Tab** : classement. Les bots savent courir (`server/RaceBot.js`).
- **Vertige Néon** (`shared/maps/course_neon.js`, décor dans `client/src/models/neon.js`) : pas de sol hors de la piste, on **tombe** et on repart du dernier point
  de passage (+3 s). Le sol est une grille de cases rastérisée à partir de bandes de piste (`strips`, qui permettent fourches, ponts étroits, sauts) ;
  l'altitude suit un profil `elev` ([[s, hauteur], …], lu par `floorHeight`) ;
  en plus des obstacles de la Colline : dalles qui s'effacent (`blinks`), lanceurs de gravité (`launch`), rotors (`spinners`), plots (`blocks`).
  Pas de garde-fous (`rails` existe mais reste vide). Un lanceur au bout d'une ligne droite ouvre un raccourci de 22 m d'abîme face au détour par le réacteur.
- Ajouter un circuit : décrire le tracé en repère piste (abscisse `s` le long du circuit, décalage latéral `off`) avec `buildRace()`
  (`shared/race.js`), voir `shared/maps/course_colline.js`, puis l'inscrire dans `RACE_MAPS` (`shared/map.js`).

## Campagne coopérative

Dans le salon, l'hôte choisit le mode **Campagne** (page **Opérations**). Tout le monde rejoint
la même escouade et affronte l'IA ensemble : 12 missions en 3 chapitres. Le chapitre I a une carte par mission ; les chapitres II et III se
jouent sur les cartes d'escarmouche **Oasis** et **Deux-Rives**, avec un décor et un déploiement
propres à chaque mission.

| Chapitre | Missions |
| --- | --- |
| I · Opération Aube (prairie) | Baptême du feu · Route des dépôts · Le Verrou · **Goliath** (boss) |
| II · Tempête de sable (carte Oasis : désert, crépuscule) | Mer de dunes · Batteries de l'oasis · Siège au crépuscule · **La Citadelle** (boss) |
| III · Hiver d'acier (carte Deux-Rives : neige, blizzard) | Les ponts gelés · Usine Kessel · Dernier rempart · **Léviathan** (boss final) |

- **Objectifs variés** : tout détruire, faire sauter des cibles (dépôts, batteries, usines), tenir une zone
  sous le feu, repousser des vagues, traverser la carte jusqu'à l'extraction, abattre un boss.
- **Ennemis** : chars légers, moyens et lourds (qui gardent leur position ou chargent), tourelles en
  casemate, nids de mitrailleuse (rafales), mortiers (tir en cloche par-dessus les obstacles : un
  **cercle rouge** au sol annonce l'impact, sors-en !), usines qui produisent des chars en continu.
- **Boss** à plusieurs phases : le Goliath (double canon, salves en éventail, escorte), la Citadelle
  (invulnérable tant que ses 4 générateurs de bouclier tiennent, barrages d'artillerie) et le
  Léviathan (tout à la fois, puis enragé).
- **Bonus** lâchés par les ennemis ou posés sur la carte : réparation, cadence rapide (10 tirs), obus
  perforants (6 tirs), bouclier (annule 4 impacts). Une jauge à côté du bonus montre
  ce qu'il reste. Un char ennemi qui lâche un bonus disparaît pour qu'on puisse le ramasser.
- **Tourelles alliées** (missions de défense) : à 0 PV elles sont hors service 20 s, puis repartent
  avec tout leur blindage (tout de suite entre deux vagues).
- **Pas de réapparition** : un char détruit reste hors combat et observe ses coéquipiers jusqu'à la fin
  de la mission. La mission échoue si toute l'escouade est détruite.
- **Difficulté** : Recrue, Vétéran, Élite. Le nombre d'ennemis et la résistance des boss s'adaptent
  à la taille de l'escouade. Seul ? Ajoute des **bots alliés** (ils visent les objectifs, ramassent les
  réparations et esquivent les mortiers).
- **Étoiles** : une par niveau de difficulté réussi : ★ Recrue, ★★ Vétéran, ★★★ Élite (on garde la
  meilleure). Réussir une mission, à n'importe quelle difficulté, débloque la suivante.
- **Progression par compte** : chaque joueur de l'escouade qui termine la mission l'enregistre sur son
  compte. L'escouade peut jouer toute mission débloquée par l'un des joueurs présents.
  Pour tout débloquer d'un coup (missions et chars) : lancer le serveur avec la variable `TANK3D_UNLOCK=1`.
- **Carte de campagne** : page **Opérations** du salon (mode Campagne). Les 12 missions sur la carte des
  3 chapitres, avec tes étoiles, les missions verrouillées et le détail par difficulté ; l'hôte y choisit la
  mission et la difficulté.

### Skins

Dans l'onglet **Peintures** du hangar, chaque joueur choisit le skin de son char parmi ceux qu'il a
débloqués (aperçu sur son char) ; cliquer un skin verrouillé affiche sa condition d'obtention et ta progression
(sans l'afficher sur le char). Le choix est enregistré sur le compte. Quel que soit le skin, les **bandes d'identification**, l'anneau de tourelle et le
**fanion d'antenne** restent aux couleurs de l'équipe : on reconnaît toujours un allié d'un ennemi.

| Skin | Comment l'obtenir |
| --- | --- |
| Réglementaire (couleurs d'équipe) | dès le départ |
| Olive de recrue | réussir « Baptême du feu » (campagne, au moins ★) |
| Libérateur (camouflage 4 tons, étoile sur les flancs) | réussir les 12 missions de la campagne, au moins ★ sur chacune |
| Givre (camouflage numérique d'hiver, chevrons de vétéran) | réussir les 12 missions en Vétéran, ★★ sur chacune |
| **Souverain** (laque noire, filets d'or animés, canon doré, lauriers, paillettes d'or) | réussir les 12 missions en Élite, ★★★ sur chacune |

### Le salon : hangar, opérations, boutique

Le salon se compose de trois pages, accessibles depuis la barre du haut (qui garde en permanence tes crédits, ton grade et ton XP) :

| Page | Contenu |
| --- | --- |
| **Hangar** | Ton char en 3D (glisse à la souris pour le faire tourner), sa fiche technique (jauges, dégâts reçus selon la face touchée), l'onglet Peintures, l'équipage à gauche, le **carrousel de chars** en bas (clic ou flèches ← → : un char à toi est équipé tout de suite, un char à acheter est seulement exposé) et le bouton de lancement |
| **Opérations** | Le mode (Escarmouche / Campagne), la carte avec un grand aperçu et le nombre de manches, ou la carte de campagne et la difficulté. Seul l'hôte change les réglages, les autres voient son choix |
| **Boutique** | Le catalogue des chars, filtrable, avec le char examiné en 3D et ses jauges **comparées au char équipé** ; l'achat demande une confirmation |

Échap revient d'une page ou d'une fenêtre à la précédente.

L'hôte choisit la carte, chaque joueur choisit son char.

| Carte | Particularité |
| --- | --- |
| Avant-poste (prairie) | village fortifié, zone centrale couverte par deux murets |
| Oasis (désert) | plateaux rocheux en hélice ; les **pipelines** et les mares arrêtent les chars mais pas les obus |
| Deux-Rives (neige) | une île entre deux bras de fleuve : on ne passe que par **4 ponts**, mais on tire par-dessus l'eau |
| La Kasbah (désert · ville) | très grande carte : dunes et **oued** à l'ouest, ville et **voie express en tranchée** à l'est ; grande zone sur le plateau de la kasbah, autour du minaret |

## Crédits, Store et expérience

À la fin de chaque partie d'escarmouche (jouée jusqu'au bout) et de chaque mission, chaque joueur gagne des
**crédits** (cr) et de l'**XP**. Un **rapport de bataille** (escarmouche) ou le rapport de mission (campagne)
détaille les gains ligne par ligne, avec le tableau des équipages.

### Crédits

| Escarmouche | Crédits |
| --- | --- |
| Participation (une fois par partie) | +200 |
| Char ennemi détruit | +1 000 |
| Dégâts infligés | +2 par point de dégât |
| Défaite | les gains ci-dessus sont **divisés par 2** |
| Son char détruit (réparations) | −500 à chaque fois |

| Campagne | Crédits |
| --- | --- |
| Première réussite de la mission en ★ / ★★ / ★★★ | +5 000 / +10 000 / +15 000, **cumulables** (réussir directement en Élite = 30 000 ; passer de ★ à ★★★ = 25 000) |
| Mission réussie sans nouvelle étoile | +2 000 |
| Mission échouée | +1 000 |
| Réparations | gratuites |

Le solde ne descend jamais sous 0.

### Store

Page **Boutique** du salon (ou « Voir à la boutique » sur la fiche d'un char pas encore acheté). On y parcourt tous les
chars avec leur modèle 3D et leurs caractéristiques ; un char acheté est équipé aussitôt (l'achat demande une
confirmation). La boutique est ouverte au salon, entre deux parties.

| Char | Rôle | Particularité | Prix |
| --- | --- | --- | --- |
| Vanguard | char moyen polyvalent | | fourni |
| Bastion | char lourd | | fourni |
| Lynx | char léger | | fourni |
| **Frelon** | harcèlement | **rafales de 3 obus** légers, puis 3,3 s de rechargement | 100 000 cr |
| **Harpon** | chasseur de chars | **pas de tourelle** : canon en casemate (±12°), obus très rapide (68 dégâts), silhouette basse | 200 000 cr |
| **Tonnerre** | obusier automoteur | **tir en cloche** par-dessus les obstacles, dégâts de zone, portée réglable (A / E) de 20 à 120 m ; un cercle blanc montre le point de chute, l'ennemi voit le cercle rouge d'alerte | 300 000 cr |

Le dernier char choisi est mémorisé sur le compte.

### Équipements

13 équipements améliorent un char (dégâts, cadence, précision, PV, vitesse…). Ils s'achètent à la **Boutique**, onglet
*Équipements*, **au niveau I uniquement, 20 000 cr pièce**. Ils se gèrent dans le **Hangar**, onglet *Équipement* :

- **3 emplacements par char**, un même équipement une seule fois par char. Un exemplaire monté quitte le stock (pour
  le mettre sur un autre char, on le démonte d'abord).
- **Fusion** : 2 exemplaires identiques du même niveau donnent 1 exemplaire du niveau suivant (jusqu'au niveau III).
  S'il n'y en a qu'un en stock, celui qui est monté sur le char regardé complète la fusion et garde son emplacement.
- Les niveaux ne sont pas des multiples fixes : chaque équipement a ses valeurs (`values` dans `shared/equipment.js`),
  par exemple Culasse +6 / +8 / +10 % de dégâts, Boîte marche arrière +20 / +30 / +40 %.
- Certains équipements vont mal avec certains chars (Obus aérodynamiques sur le Tonnerre, Servo de tourelle sur le
  Harpon) : ils sont refusés et grisés.
- Les équipements sont figés à l'entrée en manche (un changement s'applique à la manche suivante) et **désactivés en
  course**. Teintes des miniatures : gris (I), or (II), bleu diamant (III).

Techniquement, `eqDef(char, équipements)` (`shared/equipment.js`) fabrique la fiche du char équipé ; serveur et client
l'utilisent à la place de la fiche d'origine, donc la prédiction reste identique. Pour ajouter un équipement : une entrée
dans `EQUIPMENT` (valeurs, effet `apply`, éventuelle incompatibilité) et son icône dans `client/src/ui/equipIcons.js`.
`node tools/equipment-check.js` vérifie les règles sans navigateur.

### Expérience et grades

| Escarmouche | XP | Campagne | XP |
| --- | --- | --- | --- |
| Participation | 25 | Mission réussie | 100 / 150 / 200 (Recrue / Vétéran / Élite) |
| Dégâts infligés | 1 pour 2 dégâts | Dégâts infligés | 1 pour 4 dégâts |
| Destruction | 20 | Destruction | 10 |
| Manche gagnée | 25 | Mission échouée | 10 |
| Victoire | 75 | | |

L'XP fixe le **grade** (affiché dans le salon, la liste des équipes et le tableau des scores) :
Soldat (0), Caporal (500), Sergent (1 200), Adjudant (2 500), Lieutenant (4 000), Capitaine (6 000), Commandant (9 000), Colonel (13 000).
Les grades ne rapportent rien pour l'instant (récompenses à venir).

Tous les barèmes se règlent dans `shared/progress.js`, les prix dans `TANK_TYPES` (`shared/constants.js`).

## Organisation du code

```
shared/     code commun serveur + client
  constants.js   réglages du jeu : chars, unités de campagne, bonus, difficultés…
  map.js         liste des cartes d'escarmouche (MAPS) + collisions
  maps/          cartes composées avec la bibliothèque de décor (oasis.js, rives.js, kasbah.js…)
  props.js       bibliothèque de décor : maisons, rochers, eau, ponts, pipelines… + groupes et symétrie
  skins.js       skins des chars et leurs conditions de déblocage
  progress.js    expérience et grades, crédits (barèmes), chars possédés
  campaign.js    les 12 missions : cartes, unités, vagues, renforts, bonus (simples données)
  tank.js        simulation d'un char (un tick)
server/
  index.js       serveur web + WebSocket
  Accounts.js    comptes joueurs (pseudo + mot de passe, progression de campagne) dans accounts.json
  Room.js        salon, manches, simulation autoritaire, obus, zone
  Campaign.js    directeur de campagne : objectifs, vagues, boss, bonus, déblocage des missions
  Bot.js         bots d'escarmouche : grille de navigation, recherche de chemin, visée
  Enemy.js       IA de campagne : ennemis, tourelles, mortiers, boss, bots alliés
tools/
  campaign-check.js  vérifie les missions et les simule avec des bots (voir plus bas)
client/
  index.html       structure de tous les écrans
  style.css        thème (couleurs, boutons, panneaux), HUD en jeu, menus en jeu
  equipment.js     équipements : données, niveaux, fiche du char équipé (shared/) · equipIcons.js : leurs miniatures (client/src/ui/)
  hub.css          le salon : hangar, opérations, boutique
  src/main.js      relie tout
  src/ui/hub.js    le salon (3 pages) : ne connaît ni le réseau ni la 3D, main.js lui prête ce qu'il faut
  src/ui/kit.js    briques d'interface : icônes, classes de chars, jauges de caractéristiques
  src/ui/portraits.js  « photos » des modèles 3D de chars pour les cartes (suivent les modèles tout seuls)
  src/game.js      prédiction, réconciliation, interpolation
  src/renderer.js  scène 3D, caméra
  src/models/      modèles low-poly générés par code (chars, unités de campagne, décor et ambiances)
  src/effects.js   obus, explosions, poussière, traces de chenilles, fumée
  src/campaignMap.js  carte de la campagne (SVG) avec les étoiles de chaque mission
  src/audio.js, hud.js, input.js, net.js
```

### Comment la latence est gérée

- Le **serveur fait autorité** : il simule tout à 60 Hz et envoie l'état 30 fois par seconde.
- **Prédiction** : ton propre char est simulé chez toi immédiatement, avec exactement le même
  code que le serveur (`shared/tank.js`). Aucun délai entre la touche et le mouvement.
- **Réconciliation** : à chaque état reçu, le client repart de la position officielle et rejoue
  les commandes pas encore traitées. Un écart éventuel est résorbé en douceur.
- **Interpolation** : les autres chars sont affichés ~70 ms dans le passé, entre deux états
  reçus. Ce tampon s'allonge tout seul si le réseau devient irrégulier (affiché en haut à gauche).

### Pistes d'évolution

- **Nouveau char** : une entrée dans `TANK_TYPES` (`shared/constants.js`) + une fonction de modèle inscrite
  dans `TANK_MODELS` (`client/src/models/tank.js`) sous la même clé. Il apparaît alors dans le salon.
  Pour le vendre à la boutique : `price: 150000` (sans prix, il est fourni à tous). Sa carte, son portrait et sa classe
  (léger, moyen, lourd, chasseur, artillerie : déduite de `armor`, `traverse` et `weapon`) apparaissent d'eux-mêmes au salon. Armes possibles :
  `burst: { shots, pause }` (rafales), `traverse` (canon en casemate, débattement en rad), `weapon: 'mortar'` (obusier,
  avec `minRange`, `maxRange`, `splash`, `flightBase`, `flightPerM`).
- **Nouveau skin** : une entrée dans `SKINS` (`shared/skins.js`) avec ses couleurs et sa condition de
  déblocage (`unlock: { mission, stars }` pour une mission, `unlock: { all: n }` pour toute la campagne à n étoiles).
  Options (détaillées en tête du fichier) : `camo` (taches ou camouflage numérique), `filigree` (filets lumineux
  balayés par un reflet), `gloss` (laque), `parts` (canon, roues, chenilles…), `emblem` (étoile, chevrons, lauriers),
  `aura` (paillettes) et `legend` (présentation dorée au salon). Il apparaît au salon, et le rapport de mission l'annonce quand il est gagné.
- **Nouvelle carte** : un nouvel objet inscrit dans `MAPS` (`shared/map.js`). Le décor 3D, la mini-carte,
  l'aperçu du salon et la navigation des bots en découlent. Le plus simple : composer une moitié de carte
  avec `shared/props.js` et la dupliquer par `mirror()` (voir `shared/maps/oasis.js`). Un objet plus bas
  que 1,5 m bloque les chars mais pas les obus. Nouveau type d'objet : une fonction de rendu dans
  `client/src/models/props.js` et une couleur de plan dans `client/src/hud.js`.
- **Mission sur une carte existante** : `base: 'oasis'` dans `mission({...})`, puis `clear` pour retirer
  du décor et `boxes` / `circles` pour en ajouter.
- **Niveau des bots** : temps de réaction et imprécision en haut de `BotBrain` dans `server/Bot.js`.
- **Nouvelle mission** : un objet `mission({...})` dans `MISSIONS` (`shared/campaign.js`), le format est
  décrit en tête du fichier. Puis `node tools/campaign-check.js m13` vérifie que rien n'est coincé
  dans un mur, que tout est accessible, et fait jouer la mission par des bots alliés
  (options `--bots 3`, `--diff easy|normal|hard`, `--verbose` pour le détail des dégâts).
- **Nouvel ennemi ou boss** : une entrée dans `ENEMY_TYPES` (`shared/constants.js`), un modèle dans
  `client/src/models/units.js`, et pour un boss un scénario dans `BOSS_SCRIPTS` (`server/Campaign.js`).
- **Équilibrage de la campagne** : `DIFFICULTIES` et `CAMPAIGN_RULES` dans `shared/constants.js`.
- **Décor destructible** : la liste des objets destructibles et leurs points de structure est `DESTRUCTIBLE`
  (`shared/map.js`). Le serveur garde les objets détruits de la manche (`Room.broken`) et les envoie avec l'état ;
  serveur et clients jouent sur la carte « vivante » `withBroken(carte, détruits)`.
- **Nouveau mode de jeu** : les conditions de victoire sont dans `Room.js` (`stepZone`, `checkElimination`, `stepPhase`).
- **Visée à la souris** : la commande envoyée au serveur (`f`, `t`, `tt`, `fire`) est définie dans `sanitizeInput` et lue dans `stepTank`.
