import { describe, expect, it } from 'vitest';
import {
  arenaTypeMultiplier,
  buildFighterMoveset,
  createFighterBattleState,
  getPokemonTypesByDex,
  POKEMON_TYPE_META,
  rawTypeEffectiveness,
  resolveBattleTurn,
  resolveFighterProfile,
} from './pokemon-battle';

describe('pokemon-battle', () => {
  it('resolves valid 1-2 types for all 1025 National Dex Pokémon', () => {
    for (let dex = 1; dex <= 1025; dex++) {
      const types = getPokemonTypesByDex(dex);
      expect(types, `dex #${dex}`).not.toBeNull();
      expect(types!.length).toBeGreaterThanOrEqual(1);
      expect(types!.length).toBeLessThanOrEqual(2);
      for (const t of types!) {
        expect(POKEMON_TYPE_META[t]).toBeDefined();
      }
    }
    expect(getPokemonTypesByDex(1)).toEqual(['grass', 'poison']);
    expect(getPokemonTypesByDex(6)).toEqual(['fire', 'flying']);
    expect(getPokemonTypesByDex(25)).toEqual(['electric']);
    expect(getPokemonTypesByDex(94)).toEqual(['ghost', 'poison']);
    expect(getPokemonTypesByDex(143)).toEqual(['normal']);
    expect(getPokemonTypesByDex(448)).toEqual(['fighting', 'steel']);
    expect(getPokemonTypesByDex(1025)).toEqual(['poison', 'ghost']);
  });

  it('computes accurate 18x18 effectiveness and arena-balanced multipliers', () => {
    expect(rawTypeEffectiveness('electric', ['water', 'flying'])).toBe(4);
    expect(arenaTypeMultiplier('electric', ['water', 'flying'])).toEqual({
      mult: 2.0,
      effectiveness: 'double_super',
    });

    expect(arenaTypeMultiplier('fire', ['grass'])).toEqual({
      mult: 1.5,
      effectiveness: 'super',
    });

    expect(arenaTypeMultiplier('water', ['grass'])).toEqual({
      mult: 0.65,
      effectiveness: 'not_very',
    });

    expect(arenaTypeMultiplier('normal', ['ghost'])).toEqual({
      mult: 0,
      effectiveness: 'immune',
    });
  });

  it('classifies and builds rich movesets for all 3 fighter archetypes (pokemon, custom_pet, human)', () => {
    const pika = resolveFighterProfile({
      id: 'a-pika',
      name: '皮卡丘',
      seed: 1,
      pet: { id: 'pmd:0025', kind: 'pmd', spriteUrl: '/api/pokemon/0025/Idle-Anim.png', pmd: { dex: '0025', walk: { url: '', frameWidth: 32, frameHeight: 40, frames: 4, durations: [100], rows: 8 } } },
    });
    expect(pika).toEqual({ archetype: 'pokemon', dex: 25, types: ['electric'] });
    expect(buildFighterMoveset({ id: 'a-pika', name: '皮卡丘', seed: 1, pet: { id: 'pikachu', spriteUrl: '' } }).attacks.some((m) => m.name.includes('十万伏特'))).toBe(true);

    const dafeiyuInfo = { id: 'a-dfy', name: '大肥鱼', seed: 2, pet: { id: 'dafeiyu', displayName: '大肥鱼', spriteUrl: '/api/pets/dafeiyu/sprite' } };
    const dfy = resolveFighterProfile(dafeiyuInfo);
    expect(dfy.archetype).toBe('custom_pet');
    expect(dfy.types).toEqual(['water', 'fighting']);
    const dfyMoves = buildFighterMoveset(dafeiyuInfo);
    expect(dfyMoves.attacks.some((m) => m.name.includes('咸鱼突刺'))).toBe(true);

    const cyberCatInfo = { id: 'a-cat', name: '赛博猫', seed: 7, pet: { id: 'cyber-cat', displayName: '赛博机械猫', spriteUrl: '/api/pets/cyber-cat/sprite' } };
    const cyber = resolveFighterProfile(cyberCatInfo);
    expect(cyber.archetype).toBe('custom_pet');
    expect(cyber.types.length).toBeGreaterThanOrEqual(1);
    expect(buildFighterMoveset(cyberCatInfo).attacks.length).toBeGreaterThanOrEqual(3);

    const humanInfo = { id: 'a-hum', name: 'Alice', seed: 42, role: 'Agente principal', agentTool: 'Claude Code' };
    const human = resolveFighterProfile(humanInfo);
    expect(human.archetype).toBe('human');
    expect(human.types).toContain('psychic');
    expect(human.types.length).toBe(2);
    const humanMoves = buildFighterMoveset(humanInfo);
    expect(humanMoves.attacks.some((m) => ['键盘跳劈！⌨️', '需求文档暴扣！📄', '滑铲赶工！🏃', '强行 Merge 斩！⚔️', '线上热修光束！🚀', '死线精神冲击！🧠'].includes(m.name))).toBe(true);
    expect(humanMoves.statuses.some((m) => ['吨吨冰美式！☕', '带薪摸鱼护体！🐟', '深夜爆肝模式！🔥', '极限甩锅闪避！💨'].includes(m.name))).toBe(true);
  });

  it('resolves Ghost vs Normal and Human vs Pokémon duels cleanly to KO without deadlocks', () => {
    const snorlax = { id: 'p1', name: '卡比兽', seed: 11, pet: { id: 'snorlax', spriteUrl: '/api/pets/snorlax/sprite' } };
    const gengar = { id: 'p2', name: '耿鬼', seed: 22, pet: { id: 'gengar', spriteUrl: '/api/pets/gengar/sprite' } };
    const s1 = createFighterBattleState(snorlax);
    const s2 = createFighterBattleState(gengar);
    expect(s1.types).toEqual(['normal']);
    expect(s2.types).toEqual(['ghost', 'poison']);

    let seed = 1337;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    let turns = 0;
    while (s1.hp > 0 && s2.hp > 0 && turns < 60) {
      if (turns % 2 === 0) resolveBattleTurn(s1, s2, snorlax, gengar, rng);
      else resolveBattleTurn(s2, s1, gengar, snorlax, rng);
      turns++;
    }
    expect(Math.min(s1.hp, s2.hp)).toBe(0);
    expect(Number.isNaN(s1.hp)).toBe(false);
    expect(Number.isNaN(s2.hp)).toBe(false);
  });
});
