// Character roster seed — EDIT THIS FILE to change the roster or grid.
//
// Order follows the in-game Ultimate character select screen with echo
// stacking turned off and all DLC owned:
//   - Fighters appear in fighter-number order, echo fighters directly after
//     their base fighter.
//   - The three Mii Fighters are always last (as in the game).
//   - Pokemon Trainer is ONE entry; Pyra & Mythra is ONE entry.
//
// gridRows is the number of boxes per row on the select screen. The layout
// below (13 x 6 rows + 8) was measured from the real CSS; change these
// numbers if you want a different arrangement.

export const gridRows = [13, 13, 13, 13, 13, 13, 8];

// name: display name. slug: stable id + image filename (DATA_DIR/images/<slug>.png).
// series: grouping label. is_dlc: Fighters Pass 1/2 (+ Piranha Plant).
// is_echo: echo fighter.
export const characters = [
  // Row 1
  { slug: 'mario', name: 'Mario', series: 'Super Mario' },
  { slug: 'donkey-kong', name: 'Donkey Kong', series: 'Donkey Kong' },
  { slug: 'link', name: 'Link', series: 'The Legend of Zelda' },
  { slug: 'samus', name: 'Samus', series: 'Metroid' },
  { slug: 'dark-samus', name: 'Dark Samus', series: 'Metroid', is_echo: true },
  { slug: 'yoshi', name: 'Yoshi', series: 'Yoshi' },
  { slug: 'kirby', name: 'Kirby', series: 'Kirby' },
  { slug: 'fox', name: 'Fox', series: 'Star Fox' },
  { slug: 'pikachu', name: 'Pikachu', series: 'Pokémon' },
  { slug: 'luigi', name: 'Luigi', series: 'Super Mario' },
  { slug: 'ness', name: 'Ness', series: 'EarthBound' },
  { slug: 'captain-falcon', name: 'Captain Falcon', series: 'F-Zero' },
  { slug: 'jigglypuff', name: 'Jigglypuff', series: 'Pokémon' },
  // Row 2
  { slug: 'peach', name: 'Peach', series: 'Super Mario' },
  { slug: 'daisy', name: 'Daisy', series: 'Super Mario', is_echo: true },
  { slug: 'bowser', name: 'Bowser', series: 'Super Mario' },
  { slug: 'ice-climbers', name: 'Ice Climbers', series: 'Ice Climbers' },
  { slug: 'sheik', name: 'Sheik', series: 'The Legend of Zelda' },
  { slug: 'zelda', name: 'Zelda', series: 'The Legend of Zelda' },
  { slug: 'dr-mario', name: 'Dr. Mario', series: 'Super Mario' },
  { slug: 'pichu', name: 'Pichu', series: 'Pokémon' },
  { slug: 'falco', name: 'Falco', series: 'Star Fox' },
  { slug: 'marth', name: 'Marth', series: 'Fire Emblem' },
  { slug: 'lucina', name: 'Lucina', series: 'Fire Emblem', is_echo: true },
  { slug: 'young-link', name: 'Young Link', series: 'The Legend of Zelda' },
  { slug: 'ganondorf', name: 'Ganondorf', series: 'The Legend of Zelda' },
  // Row 3
  { slug: 'mewtwo', name: 'Mewtwo', series: 'Pokémon' },
  { slug: 'roy', name: 'Roy', series: 'Fire Emblem' },
  { slug: 'chrom', name: 'Chrom', series: 'Fire Emblem', is_echo: true },
  { slug: 'mr-game-and-watch', name: 'Mr. Game & Watch', series: 'Game & Watch' },
  { slug: 'meta-knight', name: 'Meta Knight', series: 'Kirby' },
  { slug: 'pit', name: 'Pit', series: 'Kid Icarus' },
  { slug: 'dark-pit', name: 'Dark Pit', series: 'Kid Icarus', is_echo: true },
  { slug: 'zero-suit-samus', name: 'Zero Suit Samus', series: 'Metroid' },
  { slug: 'wario', name: 'Wario', series: 'Super Mario' },
  { slug: 'snake', name: 'Snake', series: 'Metal Gear' },
  { slug: 'ike', name: 'Ike', series: 'Fire Emblem' },
  { slug: 'pokemon-trainer', name: 'Pokémon Trainer', series: 'Pokémon' },
  { slug: 'diddy-kong', name: 'Diddy Kong', series: 'Donkey Kong' },
  // Row 4
  { slug: 'lucas', name: 'Lucas', series: 'EarthBound' },
  { slug: 'sonic', name: 'Sonic', series: 'Sonic' },
  { slug: 'king-dedede', name: 'King Dedede', series: 'Kirby' },
  { slug: 'olimar', name: 'Olimar', series: 'Pikmin' },
  { slug: 'lucario', name: 'Lucario', series: 'Pokémon' },
  { slug: 'rob', name: 'R.O.B.', series: 'R.O.B.' },
  { slug: 'toon-link', name: 'Toon Link', series: 'The Legend of Zelda' },
  { slug: 'wolf', name: 'Wolf', series: 'Star Fox' },
  { slug: 'villager', name: 'Villager', series: 'Animal Crossing' },
  { slug: 'mega-man', name: 'Mega Man', series: 'Mega Man' },
  { slug: 'wii-fit-trainer', name: 'Wii Fit Trainer', series: 'Wii Fit' },
  { slug: 'rosalina-and-luma', name: 'Rosalina & Luma', series: 'Super Mario' },
  { slug: 'little-mac', name: 'Little Mac', series: 'Punch-Out!!' },
  // Row 5
  { slug: 'greninja', name: 'Greninja', series: 'Pokémon' },
  { slug: 'palutena', name: 'Palutena', series: 'Kid Icarus' },
  { slug: 'pac-man', name: 'Pac-Man', series: 'Pac-Man' },
  { slug: 'robin', name: 'Robin', series: 'Fire Emblem' },
  { slug: 'shulk', name: 'Shulk', series: 'Xenoblade Chronicles' },
  { slug: 'bowser-jr', name: 'Bowser Jr.', series: 'Super Mario' },
  { slug: 'duck-hunt', name: 'Duck Hunt', series: 'Duck Hunt' },
  { slug: 'ryu', name: 'Ryu', series: 'Street Fighter' },
  { slug: 'ken', name: 'Ken', series: 'Street Fighter', is_echo: true },
  { slug: 'cloud', name: 'Cloud', series: 'Final Fantasy' },
  { slug: 'corrin', name: 'Corrin', series: 'Fire Emblem' },
  { slug: 'bayonetta', name: 'Bayonetta', series: 'Bayonetta' },
  { slug: 'inkling', name: 'Inkling', series: 'Splatoon' },
  // Row 6
  { slug: 'ridley', name: 'Ridley', series: 'Metroid' },
  { slug: 'simon', name: 'Simon', series: 'Castlevania' },
  { slug: 'richter', name: 'Richter', series: 'Castlevania', is_echo: true },
  { slug: 'king-k-rool', name: 'King K. Rool', series: 'Donkey Kong' },
  { slug: 'isabelle', name: 'Isabelle', series: 'Animal Crossing' },
  { slug: 'incineroar', name: 'Incineroar', series: 'Pokémon' },
  { slug: 'piranha-plant', name: 'Piranha Plant', series: 'Super Mario', is_dlc: true },
  { slug: 'joker', name: 'Joker', series: 'Persona', is_dlc: true },
  { slug: 'hero', name: 'Hero', series: 'Dragon Quest', is_dlc: true },
  { slug: 'banjo-and-kazooie', name: 'Banjo & Kazooie', series: 'Banjo-Kazooie', is_dlc: true },
  { slug: 'terry', name: 'Terry', series: 'Fatal Fury', is_dlc: true },
  { slug: 'byleth', name: 'Byleth', series: 'Fire Emblem', is_dlc: true },
  { slug: 'min-min', name: 'Min Min', series: 'ARMS', is_dlc: true },
  // Row 7
  { slug: 'steve', name: 'Steve', series: 'Minecraft', is_dlc: true },
  { slug: 'sephiroth', name: 'Sephiroth', series: 'Final Fantasy', is_dlc: true },
  { slug: 'pyra-and-mythra', name: 'Pyra & Mythra', series: 'Xenoblade Chronicles', is_dlc: true },
  { slug: 'kazuya', name: 'Kazuya', series: 'Tekken', is_dlc: true },
  { slug: 'sora', name: 'Sora', series: 'Kingdom Hearts', is_dlc: true },
  { slug: 'mii-brawler', name: 'Mii Brawler', series: 'Mii' },
  { slug: 'mii-swordfighter', name: 'Mii Swordfighter', series: 'Mii' },
  { slug: 'mii-gunner', name: 'Mii Gunner', series: 'Mii' },
];

// SmashWiki head-icon filenames that don't follow the plain "<Name>HeadSSBU.png"
// convention. Used by `npm run fetch-images`; a manual override in
// DATA_DIR/images/<slug>.png always wins over these.
export const imageFileOverrides = {
  rob: 'ROBHeadGreySSBU.png',
  'rosalina-and-luma': 'RosalinaHeadSSBU.png',
  'pokemon-trainer': 'PokémonTrainerHeadSSBU.png',
  'mr-game-and-watch': 'MrGame&WatchHeadSSBU.png',
  'banjo-and-kazooie': 'Banjo&KazooieHeadSSBU.png',
  'pyra-and-mythra': 'PyraHeadSSBU.png',
};
