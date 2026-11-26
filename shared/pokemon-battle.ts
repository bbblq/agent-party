// Pure battle rules, 1025-species National Dex types, 18x18 effectiveness matrix, and 3-archetype movesets.
// No Node or DOM APIs; safe to import in both server (WorldSync/Sim) and client (ArenaRenderer/Overlay).
import type { AgentInfo, ArenaEffectiveness, ArenaFxKind, PokemonType } from './types';

export interface PokemonTypeMeta {
  zh: string;
  shortZh: string;
  color: string;
  bg: string;
  defaultFx: ArenaFxKind;
}

const CODE_TO_TYPE: Record<string, PokemonType> = {
  a: 'normal',
  b: 'fire',
  c: 'water',
  d: 'electric',
  e: 'grass',
  f: 'ice',
  g: 'fighting',
  h: 'poison',
  i: 'ground',
  j: 'flying',
  k: 'psychic',
  l: 'bug',
  m: 'rock',
  n: 'ghost',
  o: 'dragon',
  p: 'dark',
  q: 'steel',
  r: 'fairy',
};

export const ALL_POKEMON_TYPES: readonly PokemonType[] = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];

export const POKEMON_TYPE_META: Record<PokemonType, PokemonTypeMeta> = {
  normal:   { zh: '一般', shortZh: '普', color: '#e2e8f0', bg: '#64748b', defaultFx: 'star' },
  fire:     { zh: '火',   shortZh: '火', color: '#ffedd5', bg: '#ea580c', defaultFx: 'fire' },
  water:    { zh: '水',   shortZh: '水', color: '#e0f2fe', bg: '#0284c7', defaultFx: 'water' },
  electric: { zh: '电',   shortZh: '电', color: '#422006', bg: '#eab308', defaultFx: 'thunder' },
  grass:    { zh: '草',   shortZh: '草', color: '#dcfce7', bg: '#16a34a', defaultFx: 'grass' },
  ice:      { zh: '冰',   shortZh: '冰', color: '#083344', bg: '#38bdf8', defaultFx: 'ice' },
  fighting: { zh: '格斗', shortZh: '格', color: '#fee2e2', bg: '#b91c1c', defaultFx: 'fighting' },
  poison:   { zh: '毒',   shortZh: '毒', color: '#f3e8ff', bg: '#9333ea', defaultFx: 'poison' },
  ground:   { zh: '地面', shortZh: '地', color: '#fef3c7', bg: '#b45309', defaultFx: 'ground' },
  flying:   { zh: '飞行', shortZh: '飞', color: '#eef2ff', bg: '#6366f1', defaultFx: 'slash' },
  psychic:  { zh: '超能', shortZh: '超', color: '#fce7f3', bg: '#db2777', defaultFx: 'psychic' },
  bug:      { zh: '虫',   shortZh: '虫', color: '#ecfccb', bg: '#65a30d', defaultFx: 'slash' },
  rock:     { zh: '岩石', shortZh: '岩', color: '#fef9c3', bg: '#854d0e', defaultFx: 'rock' },
  ghost:    { zh: '幽灵', shortZh: '鬼', color: '#ede9fe', bg: '#5b21b6', defaultFx: 'ghost' },
  dragon:   { zh: '龙',   shortZh: '龙', color: '#e0e7ff', bg: '#4338ca', defaultFx: 'dragon' },
  dark:     { zh: '恶',   shortZh: '恶', color: '#e5e7eb', bg: '#374151', defaultFx: 'ghost' },
  steel:    { zh: '钢',   shortZh: '钢', color: '#f1f5f9', bg: '#475569', defaultFx: 'beam' },
  fairy:    { zh: '妖精', shortZh: '妖', color: '#fdf2f8', bg: '#ec4899', defaultFx: 'fairy' },
};

// Packed 1..1025 National Dex primary+secondary type codes (2 chars per dex).
const DEX_TYPE_CODES =
  'ehehehb-b-bjc-c-c-l-l-ljlhlhlhajajaja-a-ajajh-h-d-d-i-i-h-h-hih-h-hir-r-b-b-ararhjhjehehehlelelhlhi-i-a-a-c-c-g-g-b-b-c-c-cgk-k-k-g-g-g-ehehehchchmimimib-b-ckckdqdqajajajc-cfh-h-c-cfnhnhnhmik-k-c-c-d-d-ekeki-i-g-g-a-h-h-imima-e-a-c-c-c-c-c-ckkrljfkd-b-l-a-c-cjcfa-a-c-d-b-a-mcmcmcmcmja-fjdjbjo-o-ojk-k-e-e-e-b-b-b-c-c-c-a-a-ajajljljlhlhhjcdcdd-r-arr-rjkjkjd-d-d-e-crcrm-c-ejejeja-e-e-ljcicik-p-pjckn-k-k-akl-lqa-ijqir-r-chlqlmlgpfa-a-b-bmfificmc-c-fjcjqjpbpbcoi-i-a-a-a-g-g-fkd-b-a-a-d-b-c-mimimpkjbjkee-e-e-b-bgbgc-cicip-p-a-a-l-l-ljl-lhcececee-epepajajcjcjkrkrkrlclje-ega-a-a-liljlna-a-a-g-g-arm-a-a-pnqrqmqmqmgkgkd-d-d-d-l-l-ehh-h-cpcpc-c-bibib-k-k-a-i-ioioe-epajoja-h-mkmkcicic-cpikikmememlmlc-c-a-a-n-n-n-n-ejk-p-k-f-f-fcfcfcc-c-c-cmc-o-o-ojqkqkqkm-f-q-okokc-i-ojqkk-e-e-eib-bgbgc-c-cqajajaja-acl-l-d-d-d-ehehm-m-mqmql-leljljljd-c-c-e-e-c-cia-njnja-a-n-pja-a-k-hphpqkqkm-kra-ajnpoioioia-g-gqi-i-hlhphghge-c-c-cjefefpfdqa-ime-d-b-rjlje-f-ijfia-kgmqn-fndnk-k-k-qocobqa-nok-c-c-p-e-a-kbe-e-e-b-bgbgc-c-c-a-a-a-a-a-p-p-e-e-b-b-c-c-k-k-ajajajd-d-m-m-m-kjkji-iqa-g-g-g-c-cicig-g-lelelelhlhlherere-e-c-ipipipb-b-e-lmlmpgpgkjn-n-cmcmmjmjh-h-p-p-a-a-k-k-k-k-k-k-cjcjf-f-f-aeaedjl-lqehehcncnc-ldldeqeqq-q-q-d-d-d-k-k-nbnbnbo-o-o-f-f-f-l-l-idg-g-o-ininpqpqa-ajajpjpjb-lqpopopolblbqgmgegj-djobodijofcgaklqe-e-egb-b-bkc-c-cpa-aiajbjbjl-l-ljbabar-r-r-e-e-g-gpa-k-k-qnqnqnr-r-r-r-pkpkmcmchchoc-c-dadamomomfmfr-gjdrmro-o-o-qrnenenenef-f-jojor-pjoimrknbcejejenb-b-bpc-c-crajajaja-a-l-ldldg-gfbjlrlrm-m-c-hchci-i-clcle-e-ererhbhbagage-e-e-r-akg-lclcninic-a-a-mja-bodqnrckaoneo-ogogdrkrercrk-k-kqknmhlglgd-qjeqpok-qrgnh-homqbnd-q-q-e-e-e-b-b-b-c-c-c-a-a-j-j-jql-lklkp-p-e-e-a-a-c-cmd-d-m-mbmbeoeoeoi-i-jcc-c-dhdhblblg-g-n-n-k-k-krprprprpaq-n-g-fkinr-r-g-d-flflm-f-kadpq-q-dodfcocfqoonononr-g-hog-gpped-o-f-n-keaklmiacnghphrje-e-epb-b-bnc-c-cga-a-l-l-l-lpd-dgdga-a-r-r-eaeaeaajm-m-m-b-bkbnd-d-djdjp-p-hahaenenieiem-e-ebl-lkk-k-rqrqrqc-c-jpc-c-qhqhoaq-mhmhn-n-jgf-f-ckc-ocgnhiaka-pqigrkepnrlgdiiqfcgdpjbhmdofofofn-qnpepfpipboprggodocoekeoenenhghkhre-qoeobodomkqka-hn';

const POKEMON_SLUG_DEX: Record<string, number> = {
  bulbasaur: 1,
  venusaur: 3,
  charmander: 4,
  charizard: 6,
  squirtle: 7,
  blastoise: 9,
  pikachu: 25,
  raichu: 26,
  vulpix: 37,
  ninetales: 38,
  jigglypuff: 39,
  meowth: 52,
  psyduck: 54,
  arcanine: 59,
  machamp: 68,
  slowpoke: 79,
  gengar: 94,
  magikarp: 129,
  gyarados: 130,
  lapras: 131,
  ditto: 132,
  eevee: 133,
  vaporeon: 134,
  jolteon: 135,
  flareon: 136,
  snorlax: 143,
  dragonite: 149,
  mewtwo: 150,
  mew: 151,
  chikorita: 152,
  cyndaquil: 155,
  totodile: 158,
  pichu: 172,
  togepi: 175,
  espeon: 196,
  umbreon: 197,
  tyranitar: 248,
  lugia: 249,
  treecko: 252,
  torchic: 255,
  mudkip: 258,
  gardevoir: 282,
  absol: 359,
  salamence: 373,
  metagross: 376,
  rayquaza: 384,
  turtwig: 387,
  chimchar: 390,
  piplup: 393,
  garchomp: 445,
  munchlax: 446,
  riolu: 447,
  lucario: 448,
  leafeon: 470,
  glaceon: 471,
  snivy: 495,
  tepig: 498,
  oshawott: 501,
  zorua: 570,
  zoroark: 571,
  chespin: 650,
  fennekin: 653,
  froakie: 656,
  greninja: 658,
  sylveon: 700,
  rowlet: 722,
  litten: 725,
  popplio: 728,
  mimikyu: 778,
  grookey: 810,
  scorbunny: 813,
  cinderace: 815,
  sobble: 816,
  sprigatito: 906,
  fuecoco: 909,
  quaxly: 912,
  pawmi: 921,
  fidough: 926,
  armarouge: 936,
  ceruledge: 937,
  tinkatink: 957,
  tinkaton: 959,
};

export function getPokemonTypesByDex(dex: number | string): PokemonType[] | null {
  const num = typeof dex === 'number' ? dex : Number(String(dex).trim().replace(/^pmd:/i, ''));
  if (!Number.isInteger(num) || num < 1 || num > 1025) return null;
  const idx = (num - 1) * 2;
  const t0 = CODE_TO_TYPE[DEX_TYPE_CODES[idx]];
  const t1 = CODE_TO_TYPE[DEX_TYPE_CODES[idx + 1]];
  if (!t0) return null;
  return t1 && t1 !== t0 ? [t0, t1] : [t0];
}

// Sparse standard 18x18 effectiveness matrix: only non-1.0 entries listed.
const TYPE_CHART: Record<PokemonType, Partial<Record<PokemonType, number>>> = {
  normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

export function rawTypeEffectiveness(atkType: PokemonType, defTypes: readonly PokemonType[]): number {
  const row = TYPE_CHART[atkType];
  let mult = 1;
  for (const dt of defTypes) {
    const m = row[dt];
    if (m !== undefined) mult *= m;
  }
  return mult;
}

export function arenaTypeMultiplier(
  atkType: PokemonType,
  defTypes: readonly PokemonType[],
): { mult: number; effectiveness: ArenaEffectiveness } {
  const raw = rawTypeEffectiveness(atkType, defTypes);
  if (raw === 0) return { mult: 0, effectiveness: 'immune' };
  if (raw >= 4) return { mult: 2.0, effectiveness: 'double_super' };
  if (raw >= 2) return { mult: 1.5, effectiveness: 'super' };
  if (raw <= 0.25) return { mult: 0.45, effectiveness: 'not_very' };
  if (raw <= 0.5) return { mult: 0.65, effectiveness: 'not_very' };
  return { mult: 1.0, effectiveness: 'normal' };
}

export type FighterArchetype = 'pokemon' | 'custom_pet' | 'human';

export interface FighterProfile {
  archetype: FighterArchetype;
  dex?: number;
  types: PokemonType[];
}

function hashText(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const HUMAN_SECONDARY_POOL: readonly PokemonType[] = [
  'fighting', 'fire', 'electric', 'psychic', 'steel', 'dark', 'fairy', 'ice', 'water',
];

function deriveCustomPetTypes(pet: NonNullable<AgentInfo['pet']>, seed: number): PokemonType[] {
  const rawId = pet.id.trim().toLowerCase().replace(/(?:-(?:2d|3d|v\d+))+$/g, '');
  if (rawId === 'dafeiyu' || rawId === 'dafeiyu-pet' || rawId === 'salted-fish') {
    return ['water', 'fighting'];
  }
  if (pet.types && pet.types.length > 0) {
    return pet.types.slice(0, 2);
  }
  const text = `${pet.id} ${pet.displayName ?? ''}`.toLowerCase();
  const hints: Array<[RegExp, PokemonType[]]> = [
    [/(fish|yu|鱼|aqua|sea|ocean|shark|whale|koi|octopus|crab|duck)/, ['water']],
    [/(dragon|drake|dino|wyvern|龙)/, ['dragon', 'fire']],
    [/(fire|flame|blaze|pyro|phoenix|火|炎)/, ['fire']],
    [/(cat|nyan|neko|dog|puppy|shiba|corgi|fox|bunny|rabbit|hamster|panda|sloth|bear|猫|狗|兔)/, ['normal', 'fairy']],
    [/(bot|robot|cyber|mech|drone|ai|chip|机|钢)/, ['steel', 'electric']],
    [/(ghost|spirit|phantom|shadow|bat|devil|魔|鬼)/, ['ghost', 'dark']],
    [/(bird|owl|crow|goose|eagle|chick|鸟|鹅)/, ['flying', 'normal']],
    [/(leaf|tree|sprout|slime|frog|grass|草|叶)/, ['grass']],
    [/(ice|snow|frost|penguin|冰|雪)/, ['ice', 'water']],
  ];
  for (const [re, ts] of hints) {
    if (re.test(text)) return ts;
  }
  const h = (hashText(rawId || 'pet') ^ (seed >>> 0)) >>> 0;
  const t0 = ALL_POKEMON_TYPES[h % ALL_POKEMON_TYPES.length];
  if ((h >>> 5) % 2 === 0) return [t0];
  let t1 = ALL_POKEMON_TYPES[(h >>> 8) % ALL_POKEMON_TYPES.length];
  if (t1 === t0) t1 = ALL_POKEMON_TYPES[(ALL_POKEMON_TYPES.indexOf(t0) + 5) % ALL_POKEMON_TYPES.length];
  return [t0, t1];
}

function deriveHumanTypes(info: FighterInfoLike): PokemonType[] {
  const tool = `${info.agentTool ?? ''} ${info.role ?? ''}`.toLowerCase();
  let primary: PokemonType | null = null;
  if (/claude/.test(tool)) primary = 'psychic';
  else if (/codex|openai/.test(tool)) primary = 'steel';
  else if (/antigravity|gemini/.test(tool)) primary = 'flying';
  else if (/cursor|windsurf|copilot/.test(tool)) primary = 'electric';
  else if (/workbuddy|wechat/.test(tool)) primary = 'fighting';

  const h = (hashText(`${info.id}:${info.name}`) ^ (info.seed >>> 0)) >>> 0;
  if (!primary) {
    primary = HUMAN_SECONDARY_POOL[h % HUMAN_SECONDARY_POOL.length];
  }
  let secondary = HUMAN_SECONDARY_POOL[((h >>> 6) + 3) % HUMAN_SECONDARY_POOL.length];
  if (secondary === primary) {
    secondary = HUMAN_SECONDARY_POOL[(HUMAN_SECONDARY_POOL.indexOf(primary) + 4) % HUMAN_SECONDARY_POOL.length];
  }
  return [primary, secondary];
}

export type FighterInfoLike = Pick<AgentInfo, 'id' | 'name' | 'seed' | 'pet'> &
  Partial<Pick<AgentInfo, 'role' | 'agentTool'>>;

export function resolveFighterProfile(info: FighterInfoLike): FighterProfile {
  const pet = info.pet;
  if (pet) {
    if (pet.pmd?.dex) {
      const dex = Number(pet.pmd.dex);
      const types = pet.types?.length ? pet.types.slice(0, 2) : (getPokemonTypesByDex(dex) ?? ['normal']);
      return { archetype: 'pokemon', dex: Number.isFinite(dex) ? dex : undefined, types };
    }
    const stripped = pet.id.trim().toLowerCase().replace(/^pmd:/, '').replace(/(?:-(?:2d|3d|v\d+))+$/g, '');
    if (/^\d{1,4}$/.test(stripped)) {
      const dex = Number(stripped);
      const types = pet.types?.length ? pet.types.slice(0, 2) : (getPokemonTypesByDex(dex) ?? ['normal']);
      return { archetype: 'pokemon', dex, types };
    }
    const mappedDex = POKEMON_SLUG_DEX[stripped];
    if (mappedDex) {
      const types = pet.types?.length ? pet.types.slice(0, 2) : (getPokemonTypesByDex(mappedDex) ?? ['normal']);
      return { archetype: 'pokemon', dex: mappedDex, types };
    }
    if (pet.kind === 'pmd') {
      return { archetype: 'pokemon', types: pet.types?.length ? pet.types.slice(0, 2) : ['normal'] };
    }
    return { archetype: 'custom_pet', types: deriveCustomPetTypes(pet, info.seed) };
  }

  return { archetype: 'human', types: deriveHumanTypes(info) };
}

export function resolveFighterTypes(info: FighterInfoLike): PokemonType[] {
  return resolveFighterProfile(info).types;
}

export interface BattleMove {
  id: string;
  name: string;
  type: PokemonType;
  category: 'physical' | 'special' | 'status';
  fx: ArenaFxKind;
  power?: number;
  sureHit?: boolean;
  buff?: {
    atk?: number;
    def?: number;
    eva?: number;
    heal?: number;
    text: string;
  };
}

const TYPE_MOVES: Record<PokemonType, { physical: BattleMove; special: BattleMove; status?: BattleMove }> = {
  normal: {
    physical: { id: 'body_slam', name: '泰山压顶！💥', type: 'normal', category: 'physical', fx: 'fighting', power: 18 },
    special:  { id: 'hyper_beam', name: '破坏光线！✨', type: 'normal', category: 'special', fx: 'beam', power: 20 },
    status:   { id: 'recover', name: '懒洋洋休息！💚', type: 'normal', category: 'status', fx: 'buff', buff: { heal: 14, text: '体力回复！💚' } },
  },
  fire: {
    physical: { id: 'fire_punch', name: '火焰拳！🔥', type: 'fire', category: 'physical', fx: 'fire', power: 18 },
    special:  { id: 'flamethrower', name: '喷射火焰！🔥', type: 'fire', category: 'special', fx: 'fire', power: 20 },
    status:   { id: 'sunny_charge', name: '烈日聚气！☀️', type: 'fire', category: 'status', fx: 'buff', buff: { atk: 1, text: '攻击提升！🔥' } },
  },
  water: {
    physical: { id: 'liquidation', name: '水流裂破！💧', type: 'water', category: 'physical', fx: 'water', power: 18 },
    special:  { id: 'hydro_pump', name: '高压水炮！💧', type: 'water', category: 'special', fx: 'water', power: 20 },
    status:   { id: 'aqua_ring', name: '水流环！🫧', type: 'water', category: 'status', fx: 'buff', buff: { heal: 12, def: 1, text: '回复+防御！🫧' } },
  },
  electric: {
    physical: { id: 'thunder_punch', name: '雷电拳！⚡', type: 'electric', category: 'physical', fx: 'thunder', power: 18 },
    special:  { id: 'thunderbolt', name: '十万伏特！⚡', type: 'electric', category: 'special', fx: 'thunder', power: 20 },
    status:   { id: 'charge', name: '充电蓄能！⚡', type: 'electric', category: 'status', fx: 'buff', buff: { atk: 1, text: '特攻大增！⚡' } },
  },
  grass: {
    physical: { id: 'leaf_blade', name: '叶刃斩！🍃', type: 'grass', category: 'physical', fx: 'grass', power: 18 },
    special:  { id: 'leaf_storm', name: '飞叶风暴！🍃', type: 'grass', category: 'special', fx: 'grass', power: 20 },
    status:   { id: 'synthesis', name: '光合作用！🌿', type: 'grass', category: 'status', fx: 'buff', buff: { heal: 15, text: '体力回复！🌿' } },
  },
  ice: {
    physical: { id: 'ice_shard', name: '冰砾突刺！❄️', type: 'ice', category: 'physical', fx: 'ice', power: 17 },
    special:  { id: 'ice_beam', name: '冰冻光束！❄️', type: 'ice', category: 'special', fx: 'ice', power: 20 },
  },
  fighting: {
    physical: { id: 'close_combat', name: '近身战！🥊', type: 'fighting', category: 'physical', fx: 'fighting', power: 20 },
    special:  { id: 'aura_sphere', name: '波导弹！💠', type: 'fighting', category: 'special', fx: 'fighting', power: 19, sureHit: true },
    status:   { id: 'bulk_up', name: '健美蓄力！💪', type: 'fighting', category: 'status', fx: 'buff', buff: { atk: 1, def: 1, text: '攻防提升！💪' } },
  },
  poison: {
    physical: { id: 'poison_jab', name: '毒击！☠️', type: 'poison', category: 'physical', fx: 'poison', power: 18 },
    special:  { id: 'sludge_bomb', name: '污泥炸弹！🧪', type: 'poison', category: 'special', fx: 'poison', power: 19 },
  },
  ground: {
    physical: { id: 'earthquake', name: '地震！💥', type: 'ground', category: 'physical', fx: 'ground', power: 20 },
    special:  { id: 'earth_power', name: '大地之力！🌍', type: 'ground', category: 'special', fx: 'ground', power: 19 },
  },
  flying: {
    physical: { id: 'brave_bird', name: '勇鸟猛攻！🪽', type: 'flying', category: 'physical', fx: 'slash', power: 20 },
    special:  { id: 'hurricane', name: '暴风！🌪️', type: 'flying', category: 'special', fx: 'slash', power: 19 },
    status:   { id: 'agility', name: '顺风加速！💨', type: 'flying', category: 'status', fx: 'buff', buff: { eva: 1, text: '闪避提升！💨' } },
  },
  psychic: {
    physical: { id: 'zen_headbutt', name: '意念头锤！🔮', type: 'psychic', category: 'physical', fx: 'psychic', power: 18 },
    special:  { id: 'psychic', name: '精神强念！🔮', type: 'psychic', category: 'special', fx: 'psychic', power: 20 },
    status:   { id: 'calm_mind', name: '冥想聚神！🧘', type: 'psychic', category: 'status', fx: 'buff', buff: { atk: 1, def: 1, text: '冥想强化！🧘' } },
  },
  bug: {
    physical: { id: 'x_scissor', name: '十字剪！✂️', type: 'bug', category: 'physical', fx: 'slash', power: 18 },
    special:  { id: 'bug_buzz', name: '虫鸣！🎵', type: 'bug', category: 'special', fx: 'psychic', power: 19 },
  },
  rock: {
    physical: { id: 'rock_slide', name: '岩崩！🪨', type: 'rock', category: 'physical', fx: 'rock', power: 19 },
    special:  { id: 'power_gem', name: '力量宝石！💎', type: 'rock', category: 'special', fx: 'rock', power: 19 },
  },
  ghost: {
    physical: { id: 'shadow_claw', name: '暗影爪！👻', type: 'ghost', category: 'physical', fx: 'ghost', power: 18 },
    special:  { id: 'shadow_ball', name: '暗影球！👻', type: 'ghost', category: 'special', fx: 'ghost', power: 20 },
  },
  dragon: {
    physical: { id: 'dragon_claw', name: '龙爪！🐉', type: 'dragon', category: 'physical', fx: 'slash', power: 19 },
    special:  { id: 'draco_meteor', name: '流星群！☄️', type: 'dragon', category: 'special', fx: 'dragon', power: 21 },
  },
  dark: {
    physical: { id: 'crunch', name: '咬碎！🌑', type: 'dark', category: 'physical', fx: 'slash', power: 18 },
    special:  { id: 'dark_pulse', name: '恶之波动！🌑', type: 'dark', category: 'special', fx: 'ghost', power: 19 },
  },
  steel: {
    physical: { id: 'iron_head', name: '铁头！⚙️', type: 'steel', category: 'physical', fx: 'fighting', power: 18 },
    special:  { id: 'flash_cannon', name: '加农光炮！✨', type: 'steel', category: 'special', fx: 'beam', power: 19 },
    status:   { id: 'iron_defense', name: '铁壁！🛡️', type: 'steel', category: 'status', fx: 'buff', buff: { def: 2, text: '防御大增！🛡️' } },
  },
  fairy: {
    physical: { id: 'play_rough', name: '嬉闹！✨', type: 'fairy', category: 'physical', fx: 'fairy', power: 18 },
    special:  { id: 'moonblast', name: '月亮之力！🌙', type: 'fairy', category: 'special', fx: 'fairy', power: 20 },
  },
};

const UNIVERSAL_STATUS_POOL: readonly BattleMove[] = [
  { id: 'swords_dance', name: '剑舞强化！⚔️', type: 'normal', category: 'status', fx: 'buff', buff: { atk: 2, text: '攻击大幅提升！⚔️' } },
  { id: 'double_team', name: '影子分身！💨', type: 'normal', category: 'status', fx: 'buff', buff: { eva: 1, text: '闪避提升！💨' } },
];

const DEX_SIGNATURE_MOVES: Record<number, BattleMove[]> = {
  1:   [{ id: 'vine_whip', name: '藤鞭连击！🌿', type: 'grass', category: 'physical', fx: 'grass', power: 18 }],
  4:   [{ id: 'ember_rush', name: '蓄能焰袭！🔥', type: 'fire', category: 'physical', fx: 'fire', power: 18 }],
  6:   [
    { id: 'flare_blitz', name: '闪焰冲锋！🔥', type: 'fire', category: 'physical', fx: 'fire', power: 21 },
    { id: 'blast_burn', name: '爆炸烈焰！🔥', type: 'fire', category: 'special', fx: 'fire', power: 21 },
    { id: 'dragon_claw_sig', name: '龙爪！🐉', type: 'dragon', category: 'physical', fx: 'slash', power: 18 },
  ],
  7:   [{ id: 'aqua_tail', name: '水流尾！💧', type: 'water', category: 'physical', fx: 'water', power: 18 }],
  25:  [
    { id: 'volt_tackle', name: '伏特攻击！⚡', type: 'electric', category: 'physical', fx: 'thunder', power: 21 },
    { id: 'thunderbolt_pika', name: '十万伏特！⚡', type: 'electric', category: 'special', fx: 'thunder', power: 20 },
    { id: 'iron_tail', name: '铁尾！⚙️', type: 'steel', category: 'physical', fx: 'slash', power: 18 },
  ],
  39:  [{ id: 'hyper_voice', name: '魅惑之声！🎵', type: 'fairy', category: 'special', fx: 'fairy', power: 19, sureHit: true }],
  54:  [
    { id: 'psyduck_hydro', name: '高压水炮！💧', type: 'water', category: 'special', fx: 'water', power: 20 },
    { id: 'psyduck_psy', name: '念力爆发！🔮', type: 'psychic', category: 'special', fx: 'psychic', power: 19 },
  ],
  94:  [
    { id: 'gengar_shadow', name: '暗影球！👻', type: 'ghost', category: 'special', fx: 'ghost', power: 20 },
    { id: 'gengar_sludge', name: '污泥炸弹！🧪', type: 'poison', category: 'special', fx: 'poison', power: 19 },
  ],
  130: [{ id: 'waterfall', name: '攀瀑！🌊', type: 'water', category: 'physical', fx: 'water', power: 20 }],
  133: [
    { id: 'swift', name: '高速星星！🌟', type: 'normal', category: 'special', fx: 'star', power: 18, sureHit: true },
    { id: 'quick_atk', name: '电光一闪！⚡', type: 'normal', category: 'physical', fx: 'slash', power: 17 },
    { id: 'bite', name: '咬住！🌑', type: 'dark', category: 'physical', fx: 'slash', power: 17 },
  ],
  143: [
    { id: 'heavy_slam', name: '泰山压顶！💥', type: 'normal', category: 'physical', fx: 'ground', power: 20 },
    { id: 'giga_impact', name: '终极冲击！💥', type: 'normal', category: 'physical', fx: 'fighting', power: 21 },
    { id: 'belly_rest', name: '睡觉回血！💤', type: 'normal', category: 'status', fx: 'buff', buff: { heal: 16, text: '体力大回复！💤' } },
  ],
  149: [{ id: 'outrage', name: '逆鳞！🐉', type: 'dragon', category: 'physical', fx: 'dragon', power: 21 }],
  150: [
    { id: 'psystrike', name: '精神击破！🔮', type: 'psychic', category: 'special', fx: 'psychic', power: 21 },
    { id: 'mewtwo_aura', name: '波导弹！💠', type: 'fighting', category: 'special', fx: 'fighting', power: 19, sureHit: true },
  ],
  151: [{ id: 'psychic_mew', name: '起源波动！✨', type: 'psychic', category: 'special', fx: 'fairy', power: 20 }],
  384: [{ id: 'dragon_ascent', name: '画龙点睛！🐉', type: 'flying', category: 'physical', fx: 'dragon', power: 21 }],
  445: [{ id: 'dragon_rush', name: '龙之俯冲！🐉', type: 'dragon', category: 'physical', fx: 'dragon', power: 20 }],
  448: [
    { id: 'lucario_aura', name: '波导弹！💠', type: 'fighting', category: 'special', fx: 'fighting', power: 20, sureHit: true },
    { id: 'meteor_mash', name: '彗星拳！⚙️', type: 'steel', category: 'physical', fx: 'fighting', power: 20 },
  ],
  658: [{ id: 'water_shuriken', name: '飞水手里剑！💧', type: 'water', category: 'special', fx: 'water', power: 20 }],
};

// Coverage move pool guarantees every fighter can hit Ghost/Steel/Normal/Flying/Ground targets.
const COVERAGE_POOL: readonly BattleMove[] = [
  { id: 'cov_dark', name: '暗袭要害！🌑', type: 'dark', category: 'physical', fx: 'slash', power: 17 },
  { id: 'cov_ice', name: '冰冻之风！❄️', type: 'ice', category: 'special', fx: 'ice', power: 17 },
  { id: 'cov_fairy', name: '魔法闪耀！✨', type: 'fairy', category: 'special', fx: 'fairy', power: 17 },
  { id: 'cov_rock', name: '尖石攻击！🪨', type: 'rock', category: 'physical', fx: 'rock', power: 18 },
  { id: 'cov_fire', name: '大字爆炎！🔥', type: 'fire', category: 'special', fx: 'fire', power: 18 },
];

const CUSTOM_PET_SIGNATURE_DAFEIYU: readonly BattleMove[] = [
  { id: 'dfy_rush', name: '咸鱼突刺！🐟', type: 'fighting', category: 'physical', fx: 'fighting', power: 19 },
  { id: 'dfy_water', name: '摸鱼水炮！💦', type: 'water', category: 'special', fx: 'water', power: 20 },
  { id: 'dfy_flip', name: '咸鱼翻身！🌊', type: 'water', category: 'physical', fx: 'water', power: 18 },
  { id: 'dfy_slack', name: '原地躺平！🐟', type: 'water', category: 'status', fx: 'buff', buff: { heal: 14, def: 1, text: '摸鱼回血！🐟' } },
];

const CUSTOM_PET_UNIVERSAL_ATTACKS: readonly BattleMove[] = [
  { id: 'pet_claw', name: '萌爪连击！🐾', type: 'dark', category: 'physical', fx: 'slash', power: 18 },
  { id: 'pet_pounce', name: '飞身肉球扑击！💥', type: 'normal', category: 'physical', fx: 'fighting', power: 18 },
  { id: 'pet_beam', name: '元气光波！✨', type: 'fairy', category: 'special', fx: 'fairy', power: 19 },
  { id: 'pet_tail', name: '摇尾连环撞！🌟', type: 'normal', category: 'physical', fx: 'star', power: 17 },
];

const CUSTOM_PET_STATUS_POOL: readonly BattleMove[] = [
  { id: 'pet_wink', name: '卖萌眨眼！✨', type: 'fairy', category: 'status', fx: 'buff', buff: { eva: 1, atk: 1, text: '气势+闪避！✨' } },
  { id: 'pet_roll', name: '打滚摸鱼！💚', type: 'normal', category: 'status', fx: 'buff', buff: { heal: 14, text: '元气回复！💚' } },
  { id: 'pet_puff', name: '炸毛威慑！⚡', type: 'electric', category: 'status', fx: 'buff', buff: { atk: 2, text: '攻击大增！⚡' } },
];

const HUMAN_PHYSICAL_POOL: readonly BattleMove[] = [
  { id: 'hum_keyboard', name: '键盘跳劈！⌨️', type: 'steel', category: 'physical', fx: 'fighting', power: 19 },
  { id: 'hum_doc', name: '需求文档暴扣！📄', type: 'rock', category: 'physical', fx: 'rock', power: 18 },
  { id: 'hum_slide', name: '滑铲赶工！🏃', type: 'fighting', category: 'physical', fx: 'fighting', power: 19 },
  { id: 'hum_merge', name: '强行 Merge 斩！⚔️', type: 'dark', category: 'physical', fx: 'slash', power: 18 },
];

const HUMAN_SPECIAL_POOL: readonly BattleMove[] = [
  { id: 'hum_hotfix', name: '线上热修光束！🚀', type: 'electric', category: 'special', fx: 'thunder', power: 20 },
  { id: 'hum_ddl', name: '死线精神冲击！🧠', type: 'psychic', category: 'special', fx: 'psychic', power: 20 },
  { id: 'hum_iced', name: '冰美式泼洒！☕', type: 'ice', category: 'special', fx: 'ice', power: 19 },
  { id: 'hum_rage', name: '红温怒火喷射！🔥', type: 'fire', category: 'special', fx: 'fire', power: 20 },
  { id: 'hum_bug', name: '祖传 Bug 暗影球！🐛', type: 'ghost', category: 'special', fx: 'ghost', power: 19 },
  { id: 'hum_beam', name: '架构重构炮！✨', type: 'steel', category: 'special', fx: 'beam', power: 20 },
  { id: 'hum_wind', name: '摸鱼风暴！🌪️', type: 'flying', category: 'special', fx: 'slash', power: 19 },
  { id: 'hum_water', name: '划水大浪！🌊', type: 'water', category: 'special', fx: 'water', power: 19 },
  { id: 'hum_fairy', name: '产品魔法画饼！🪄', type: 'fairy', category: 'special', fx: 'fairy', power: 19 },
];

const HUMAN_STATUS_POOL: readonly BattleMove[] = [
  { id: 'hum_coffee', name: '吨吨冰美式！☕', type: 'water', category: 'status', fx: 'buff', buff: { heal: 15, text: '咖啡回血！☕' } },
  { id: 'hum_fish', name: '带薪摸鱼护体！🐟', type: 'water', category: 'status', fx: 'buff', buff: { def: 2, text: '防御大增！🐟' } },
  { id: 'hum_crunch', name: '深夜爆肝模式！🔥', type: 'fire', category: 'status', fx: 'buff', buff: { atk: 2, text: '火力全开！🔥' } },
  { id: 'hum_dodge', name: '极限甩锅闪避！💨', type: 'flying', category: 'status', fx: 'buff', buff: { eva: 2, text: '闪避暴涨！💨' } },
];

function dedupMoves(moves: BattleMove[]): BattleMove[] {
  const seen = new Set<string>();
  const out: BattleMove[] = [];
  for (const m of moves) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export function buildFighterMoveset(info: FighterInfoLike): {
  profile: FighterProfile;
  attacks: BattleMove[];
  statuses: BattleMove[];
} {
  const profile = resolveFighterProfile(info);
  const { archetype, dex, types } = profile;
  const h = hashText(`${info.id}:${info.name}:${info.pet?.id ?? ''}`) >>> 0;

  if (archetype === 'human') {
    const attacks: BattleMove[] = [];
    for (const m of HUMAN_PHYSICAL_POOL) {
      if (types.includes(m.type)) attacks.push(m);
    }
    for (const m of HUMAN_SPECIAL_POOL) {
      if (types.includes(m.type)) attacks.push(m);
    }
    // Guarantee both a physical and special STAB/flavor option
    attacks.push(HUMAN_PHYSICAL_POOL[h % HUMAN_PHYSICAL_POOL.length]);
    attacks.push(HUMAN_SPECIAL_POOL[(h >>> 3) % HUMAN_SPECIAL_POOL.length]);
    for (const t of types) {
      const tm = TYPE_MOVES[t];
      if (tm) attacks.push(tm.physical, tm.special);
    }
    attacks.push(COVERAGE_POOL[(h >>> 6) % COVERAGE_POOL.length]);
    const st0 = HUMAN_STATUS_POOL[h % HUMAN_STATUS_POOL.length];
    const st1 = HUMAN_STATUS_POOL[(h + 1) % HUMAN_STATUS_POOL.length];
    return { profile, attacks: dedupMoves(attacks), statuses: dedupMoves([st0, st1]) };
  }

  if (archetype === 'custom_pet') {
    const petId = (info.pet?.id ?? '').toLowerCase();
    const attacks: BattleMove[] = [];
    const statuses: BattleMove[] = [];
    if (petId.includes('dafeiyu') || petId.includes('salted-fish')) {
      for (const m of CUSTOM_PET_SIGNATURE_DAFEIYU) {
        if (m.category === 'status') statuses.push(m);
        else attacks.push(m);
      }
    }
    for (const t of types) {
      const tm = TYPE_MOVES[t];
      if (tm) {
        attacks.push(tm.physical, tm.special);
        if (tm.status) statuses.push(tm.status);
      }
    }
    attacks.push(
      CUSTOM_PET_UNIVERSAL_ATTACKS[h % CUSTOM_PET_UNIVERSAL_ATTACKS.length],
      CUSTOM_PET_UNIVERSAL_ATTACKS[(h + 2) % CUSTOM_PET_UNIVERSAL_ATTACKS.length],
      COVERAGE_POOL[(h >>> 4) % COVERAGE_POOL.length],
    );
    statuses.push(CUSTOM_PET_STATUS_POOL[h % CUSTOM_PET_STATUS_POOL.length]);
    return { profile, attacks: dedupMoves(attacks), statuses: dedupMoves(statuses) };
  }

  // archetype === 'pokemon'
  const attacks: BattleMove[] = [];
  const statuses: BattleMove[] = [];
  if (dex && DEX_SIGNATURE_MOVES[dex]) {
    for (const m of DEX_SIGNATURE_MOVES[dex]) {
      if (m.category === 'status') statuses.push(m);
      else attacks.push(m);
    }
  }
  for (const t of types) {
    const tm = TYPE_MOVES[t];
    if (tm) {
      attacks.push(tm.physical, tm.special);
      if (tm.status) statuses.push(tm.status);
    }
  }
  const cov = COVERAGE_POOL.find((c) => !types.includes(c.type)) ?? COVERAGE_POOL[0];
  attacks.push(cov);
  statuses.push(UNIVERSAL_STATUS_POOL[h % UNIVERSAL_STATUS_POOL.length]);
  return { profile, attacks: dedupMoves(attacks), statuses: dedupMoves(statuses) };
}

export interface FighterBattleState {
  hp: number;
  types: PokemonType[];
  archetype: FighterArchetype;
  atkStage: number;
  defStage: number;
  evaStage: number;
  awakened: boolean;
  turnsTaken: number;
}

export function createFighterBattleState(info: FighterInfoLike): FighterBattleState {
  const profile = resolveFighterProfile(info);
  return {
    hp: 100,
    types: profile.types,
    archetype: profile.archetype,
    atkStage: 0,
    defStage: 0,
    evaStage: 0,
    awakened: false,
    turnsTaken: 0,
  };
}

export interface ResolvedTurnResult {
  move: BattleMove;
  damage: number;
  prevTargetHp: number;
  newTargetHp: number;
  effectiveness: ArenaEffectiveness;
  crit: boolean;
  dodged: boolean;
  buffText?: string;
  ko: boolean;
  attackerJustAwakened: boolean;
  defenderJustAwakened: boolean;
}

function clampStage(n: number, min = -1, max = 2): number {
  return Math.max(min, Math.min(max, n));
}

export function resolveBattleTurn(
  atkState: FighterBattleState,
  defState: FighterBattleState,
  atkInfo: FighterInfoLike,
  _defInfo: FighterInfoLike,
  rng: () => number = Math.random,
  opts?: { forceFinishIfLow?: boolean },
): ResolvedTurnResult {
  const loadout = buildFighterMoveset(atkInfo);
  atkState.turnsTaken += 1;

  let attackerJustAwakened = false;
  if (atkState.hp > 0 && atkState.hp <= 30 && !atkState.awakened) {
    atkState.awakened = true;
    attackerJustAwakened = true;
  }

  // Status move chance (~16% once battle is underway, when not at cap and not close to ending)
  const canBuff =
    atkState.turnsTaken >= 2 &&
    atkState.hp > 22 &&
    defState.hp > 20 &&
    loadout.statuses.length > 0 &&
    !opts?.forceFinishIfLow &&
    (atkState.atkStage < 2 || atkState.defStage < 2 || atkState.evaStage < 2 || atkState.hp <= 65);

  if (canBuff && rng() < 0.17) {
    const buffPool = loadout.statuses.filter((m) => !(m.buff?.heal && atkState.hp > 78));
    const chosenPool = buffPool.length > 0 ? buffPool : loadout.statuses;
    const move = chosenPool[Math.floor(rng() * chosenPool.length)];
    const buff = move.buff!;
    if (buff.atk) atkState.atkStage = clampStage(atkState.atkStage + buff.atk);
    if (buff.def) atkState.defStage = clampStage(atkState.defStage + buff.def);
    if (buff.eva) atkState.evaStage = clampStage(atkState.evaStage + buff.eva, 0, 2);
    let text = buff.text;
    if (buff.heal) {
      const before = atkState.hp;
      atkState.hp = Math.min(100, atkState.hp + buff.heal);
      const gained = atkState.hp - before;
      if (gained > 0) text = `+${gained} HP 💚`;
    }
    return {
      move,
      damage: 0,
      prevTargetHp: defState.hp,
      newTargetHp: defState.hp,
      effectiveness: 'normal',
      crit: false,
      dodged: false,
      buffText: text,
      ko: false,
      attackerJustAwakened,
      defenderJustAwakened: false,
    };
  }

  // Pick attacking move with anti-immunity smart selection
  const nonImmuneMoves = loadout.attacks.filter(
    (m) => arenaTypeMultiplier(m.type, defState.types).effectiveness !== 'immune',
  );
  const superMoves = nonImmuneMoves.filter((m) => {
    const eff = arenaTypeMultiplier(m.type, defState.types).effectiveness;
    return eff === 'super' || eff === 'double_super';
  });

  let move: BattleMove;
  if (nonImmuneMoves.length > 0 && rng() < 0.88) {
    if (superMoves.length > 0 && rng() < 0.65) {
      move = superMoves[Math.floor(rng() * superMoves.length)];
    } else {
      move = nonImmuneMoves[Math.floor(rng() * nonImmuneMoves.length)];
    }
  } else {
    move = loadout.attacks[Math.floor(rng() * loadout.attacks.length)];
  }

  const prevTargetHp = defState.hp;
  const { mult, effectiveness } = arenaTypeMultiplier(move.type, defState.types);

  if (effectiveness === 'immune') {
    return {
      move,
      damage: 0,
      prevTargetHp,
      newTargetHp: defState.hp,
      effectiveness: 'immune',
      crit: false,
      dodged: false,
      ko: false,
      attackerJustAwakened,
      defenderJustAwakened: false,
    };
  }

  // Dodge check (skipped for sure-hit moves or final forced hit)
  const dodgeChance = move.sureHit || opts?.forceFinishIfLow ? 0 : Math.min(0.22, 0.08 + defState.evaStage * 0.07);
  if (rng() < dodgeChance) {
    return {
      move,
      damage: 0,
      prevTargetHp,
      newTargetHp: defState.hp,
      effectiveness,
      crit: false,
      dodged: true,
      ko: false,
      attackerJustAwakened,
      defenderJustAwakened: false,
    };
  }

  const basePower = (move.power ?? 18) * (0.9 + rng() * 0.22);
  const stab = atkState.types.includes(move.type) ? 1.2 : 1.0;
  const crit = rng() < 0.12;
  const critMult = crit ? 1.5 : 1.0;
  const effAtkStage = crit ? Math.max(0, atkState.atkStage) : atkState.atkStage;
  const effDefStage = crit ? Math.min(0, defState.defStage) : defState.defStage;
  const atkMult = 1 + effAtkStage * 0.22;
  const defMult = 1 / (1 + effDefStage * 0.18);
  const awakenMult = atkState.awakened ? 1.35 : 1.0;

  const rawDamage = basePower * stab * mult * atkMult * defMult * awakenMult * critMult;
  const damage = Math.max(4, Math.min(52, Math.round(rawDamage)));
  defState.hp = Math.max(0, defState.hp - damage);

  let defenderJustAwakened = false;
  if (defState.hp > 0 && defState.hp <= 30 && !defState.awakened) {
    defState.awakened = true;
    defenderJustAwakened = true;
  }

  return {
    move,
    damage,
    prevTargetHp,
    newTargetHp: defState.hp,
    effectiveness,
    crit,
    dodged: false,
    ko: defState.hp <= 0,
    attackerJustAwakened,
    defenderJustAwakened,
  };
}
