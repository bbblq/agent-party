import { beijingHourBucket } from '../../../../shared/beijing';
import type { AgentPetInfo, ArenaFxKind, ArenaLeaderboardEntry, SyncedArenaEvent, SyncedArenaFx, SyncedArenaState } from '../../../../shared/types';
import { ARENA_ID } from '../layout/core';
import type { SpotDef } from '../layout/types';
import type { Character } from './character';
import type { Sim } from './sim';
import type { Step } from './steps';

export const DUEL_DURATION_MS = 60_000;
const GATHER_TIMEOUT_MS = 18_000;
const FINISH_HOLD_MS = 6_000;
const FX_DURATION_MS = 950;
const FIRST_DUEL_DELAY_MIN_MS = 12_000;
const FIRST_DUEL_DELAY_MAX_MS = 18_000;
const COOLDOWN_MIN_MS = 45_000;
const COOLDOWN_MAX_MS = 85_000;

const POKEMON_PET_IDS = new Set([
  'pikachu',
  'psyduck',
  'snorlax',
  'eevee',
  'gengar',
  'lucario',
  'charizard',
  'bulbasaur',
  'charmander',
  'squirtle',
  'jigglypuff',
  'meowth',
  'magikarp',
  'gyarados',
  'dragonite',
  'mew',
  'mewtwo',
  'munchlax',
  'mimikyu',
  'garchomp',
  'greninja',
  'umbreon',
  'sylveon',
  'gardevoir',
  'mudkip',
  'torchic',
  'treecko',
  'piplup',
  'rowlet',
  'cinderace',
  'tinkaton',
  'machamp',
  'blastoise',
  'venusaur',
  'arcanine',
  'lapras',
  'ditto',
  'togepi',
  'rayquaza',
  'lugia',
  'metagross',
  'tyranitar',
  'salamence',
  'scizor',
  'absol',
  'zorua',
  'zoroark',
  'riolu',
  'pichu',
  'raichu',
  'slowpoke',
  'vulpix',
  'ninetales',
  'espeon',
  'vaporeon',
  'jolteon',
  'flareon',
  'glaceon',
  'leafeon',
  'chikorita',
  'cyndaquil',
  'totodile',
  'turtwig',
  'chimchar',
  'oshawott',
  'snivy',
  'tepig',
  'froakie',
  'fennekin',
  'chespin',
  'litten',
  'popplio',
  'sobble',
  'grookey',
  'scorbunny',
  'sprigatito',
  'fuecoco',
  'quaxly',
  'pawmi',
  'fidough',
  'tinkatink',
  'ceruledge',
  'armarouge',
]);

/** 判断角色是否为宝可梦宠物（只有宝可梦可参与决斗，像素小人和大肥鱼等非宝可梦桌宠不参赛，只可围观）。 */
export function isPokemonPet(pet: AgentPetInfo | undefined): boolean {
  if (!pet) return false;
  const id = pet.id.trim().toLowerCase();
  if (!id) return false;
  if (pet.kind === 'pmd' || id.startsWith('pmd:')) return true;
  if (POKEMON_PET_IDS.has(id)) return true;
  const stripped = id.replace(/(?:-(?:2d|3d|v\d+))+$/g, '');
  return POKEMON_PET_IDS.has(stripped);
}

interface MoveDef {
  kind: ArenaFxKind;
  moveName: string;
}

const MOVES: readonly MoveDef[] = [
  { kind: 'thunder', moveName: '十万伏特！⚡' },
  { kind: 'fire', moveName: '喷射火焰！🔥' },
  { kind: 'water', moveName: '高压水炮！💧' },
  { kind: 'beam', moveName: '破坏光线！✨' },
  { kind: 'slash', moveName: '十字斩！⚔️' },
  { kind: 'star', moveName: '高速星星！🌟' },
];

const CHEER_LINES = [
  '好帅！！👏',
  '这招太顶了！🔥',
  '加油加油！📣',
  '稳住能翻盘！⚡',
  '绝地反击！😱',
  '神仙打架！✨',
];

function sayLine(ch: Character, text: string, ms: number, now: number): void {
  ch.sayText = text;
  ch.sayAt = now;
  ch.sayUntil = now + ms;
}

export class ArenaController {
  state: SyncedArenaState = {
    phase: 'idle',
    matchId: 0,
    leftHp: 100,
    rightHp: 100,
    startedAt: 0,
    endsAt: 0,
    durationMs: DUEL_DURATION_MS,
    watchers: [],
    leaderboard: [],
  };

  onResult?: (winnerId: string, winnerName: string, loserId: string, loserName: string, now?: number) => void;
  onLeaderboardReset?: (now: number) => void;

  private plannedWinner: 'left' | 'right' = 'left';
  private nextDuelAt = 0;
  private nextExchangeAt = 0;
  private nextCheerAt = 0;
  private fxSeq = 1;
  private internalClearing = false;
  private leaderboardHour = 0;
  private remoteDriven = false;
  private remoteParticipants = new Set<string>();
  private localWatchers: string[] = [];
  private lastRemoteMatchId = 0;
  private placedRemoteMatchId = 0;
  private lastRemotePhase: SyncedArenaState['phase'] = 'idle';
  private lastRemoteFxId = 0;

  constructor(private readonly sim: Sim) {}

  setLeaderboard(entries: readonly ArenaLeaderboardEntry[], now = Date.now()): void {
    this.leaderboardHour = beijingHourBucket(now);
    this.state.leaderboard = entries.map((e) => ({ ...e }));
  }

  isBusy(charId: string): boolean {
    if (this.state.phase === 'idle') return false;
    return (
      this.state.leftId === charId ||
      this.state.rightId === charId ||
      this.state.watchers.includes(charId)
    );
  }

  triggerNow(now: number): { ok: boolean; error?: string } {
    if (this.state.phase !== 'idle') {
      return { ok: false, error: '当前决斗场正在比赛中，请稍后再试。' };
    }
    const ok = this.tryStart(now);
    if (!ok) {
      return { ok: false, error: '当前空闲的宝可梦不足 2 只，暂时无法开启决斗。' };
    }
    return { ok: true };
  }

  update(now: number): void {
    if (this.sim.synced) return;

    const hour = beijingHourBucket(now);
    if (!this.leaderboardHour) {
      this.leaderboardHour = hour;
    } else if (hour !== this.leaderboardHour) {
      this.leaderboardHour = hour;
      if (this.state.leaderboard.length) {
        this.state.leaderboard = [];
        this.onLeaderboardReset?.(now);
      }
    }

    if (this.state.fx && now >= this.state.fx.until) {
      this.state.fx = undefined;
      if (this.state.phase === 'fight') {
        const leftCur = this.state.leftId ? this.sim.chars.get(this.state.leftId) : undefined;
        const rightCur = this.state.rightId ? this.sim.chars.get(this.state.rightId) : undefined;
        if (leftCur) leftCur.pose = 'stand';
        if (rightCur) rightCur.pose = 'stand';
      }
    }

    if (this.remoteDriven) {
      if (this.state.phase === 'fight' || this.state.phase === 'finish') {
        const leftCur = this.state.leftId ? this.sim.chars.get(this.state.leftId) : undefined;
        const rightCur = this.state.rightId ? this.sim.chars.get(this.state.rightId) : undefined;
        if (leftCur) leftCur.dir = 'right';
        if (rightCur) rightCur.dir = 'left';
      }
      return;
    }

    if (this.state.phase === 'idle') {
      if (!this.nextDuelAt) {
        this.nextDuelAt =
          now + FIRST_DUEL_DELAY_MIN_MS + Math.random() * (FIRST_DUEL_DELAY_MAX_MS - FIRST_DUEL_DELAY_MIN_MS);
        this.state.nextDuelAt = this.nextDuelAt;
        return;
      }
      this.state.nextDuelAt = this.nextDuelAt;
      if (now < this.nextDuelAt) return;
      if (!this.tryStart(now)) {
        this.nextDuelAt = now + 10_000;
        this.state.nextDuelAt = this.nextDuelAt;
      }
      return;
    }

    const left = this.state.leftId ? this.sim.chars.get(this.state.leftId) : undefined;
    const right = this.state.rightId ? this.sim.chars.get(this.state.rightId) : undefined;

    if (this.state.phase === 'gather') {
      if (!this.isParticipantValid(left) || !this.isParticipantValid(right)) {
        this.cancelMatch(now);
        return;
      }
      const spots = this.ringSpots();
      if (!spots) {
        this.cancelMatch(now);
        return;
      }
      const dLeft = Math.hypot(left!.x - spots.left.x, left!.y - spots.left.y);
      const dRight = Math.hypot(right!.x - spots.right.x, right!.y - spots.right.y);
      const timedOut = now >= this.state.startedAt + GATHER_TIMEOUT_MS;
      if ((dLeft <= 12 && dRight <= 12) || timedOut) {
        if (timedOut) {
          this.snapToSpot(left!, spots.left);
          this.snapToSpot(right!, spots.right);
        }
        this.beginFight(left!, right!, now);
      } else {
        this.inviteExtraWatchers(now);
      }
      return;
    }

    if (this.state.phase === 'fight') {
      if (!this.isParticipantValid(left) || !this.isParticipantValid(right)) {
        this.cancelMatch(now);
        return;
      }
      left!.dir = 'right';
      right!.dir = 'left';

      if (now >= this.state.endsAt) {
        this.finishMatch(left!, right!, now);
        return;
      }

      if (now >= this.nextExchangeAt) {
        this.runExchange(left!, right!, now);
        this.nextExchangeAt = now + 2_800 + Math.random() * 1_400;
      }
      if (now >= this.nextCheerAt) {
        this.runWatcherCheer(now);
        this.nextCheerAt = now + 4_200 + Math.random() * 2_800;
      }
      return;
    }

    if (this.state.phase === 'finish') {
      if (left) left.dir = 'right';
      if (right) right.dir = 'left';
      if (now >= this.state.endsAt) {
        this.endMatch(now);
      }
    }
  }

  onLeave(ch: Character, now: number): void {
    if (this.remoteDriven) {
      this.remoteParticipants.delete(ch.id);
      const wIdx = this.localWatchers.indexOf(ch.id);
      if (wIdx >= 0) this.localWatchers.splice(wIdx, 1);
      const swIdx = this.state.watchers.indexOf(ch.id);
      if (swIdx >= 0) this.state.watchers.splice(swIdx, 1);
      return;
    }
    if (this.internalClearing || this.state.phase === 'idle') return;
    const wIdx = this.state.watchers.indexOf(ch.id);
    if (wIdx >= 0) {
      this.state.watchers.splice(wIdx, 1);
      return;
    }
    if (ch.id === this.state.leftId || ch.id === this.state.rightId) {
      if (this.state.phase === 'gather' || this.state.phase === 'fight') {
        this.cancelMatch(now);
      } else if (this.state.phase === 'finish') {
        if (ch.id === this.state.leftId) this.state.leftId = undefined;
        if (ch.id === this.state.rightId) this.state.rightId = undefined;
      }
    }
  }

  /** 由服务端 authoritative SSE `arena` 事件驱动本地演播，无需 10Hz 全量帧同步。 */
  applyRemoteArenaEvent(ev: SyncedArenaEvent, now = Date.now()): void {
    this.remoteDriven = true;
    const prevMatchId = this.lastRemoteMatchId;
    const prevPhase = this.lastRemotePhase;
    const offset = now - ev.t;
    const incoming = ev.arena;

    this.applySynced(incoming, offset);
    if (incoming.phase !== 'idle' && incoming.matchId === prevMatchId && this.localWatchers.length > 0) {
      this.state.watchers = [...this.localWatchers];
    }

    if (incoming.phase === 'idle') {
      if (prevPhase !== 'idle' && this.remoteParticipants.size > 0) {
        this.releaseRemoteParticipants(now);
      }
      this.localWatchers = [];
      this.state.watchers = [];
      this.placedRemoteMatchId = 0;
      this.lastRemoteFxId = 0;
    } else if (incoming.phase === 'gather' || incoming.phase === 'fight') {
      const left = incoming.leftId ? this.sim.chars.get(incoming.leftId) : undefined;
      const right = incoming.rightId ? this.sim.chars.get(incoming.rightId) : undefined;
      const spots = this.ringSpots();

      if (incoming.matchId !== prevMatchId || this.placedRemoteMatchId !== incoming.matchId) {
        if (incoming.matchId !== prevMatchId) {
          this.releaseRemoteParticipants(now);
          this.localWatchers = [];
          this.lastRemoteFxId = 0;
        }
        if (spots && left && right) {
          if (incoming.phase === 'gather') {
            this.dispatchToSpot(left, spots.left, true, `${right.info.name}，来切磋一局！⚔️`, now);
            this.dispatchToSpot(right, spots.right, true, `正合我意，${left.info.name}！⚡`, now);
          } else {
            this.snapToSpot(left, spots.left);
            this.snapToSpot(right, spots.right);
          }
          this.remoteParticipants.add(left.id);
          this.remoteParticipants.add(right.id);
          this.placedRemoteMatchId = incoming.matchId;
          if (!this.localWatchers.length) {
            this.state.watchers = [];
            this.inviteWatchers(now, 4);
            this.localWatchers = [...this.state.watchers];
            for (const wid of this.localWatchers) this.remoteParticipants.add(wid);
          }
        }
      } else if (prevPhase === 'gather' && incoming.phase === 'fight' && spots && left && right) {
        if (Math.hypot(left.x - spots.left.x, left.y - spots.left.y) > 12) this.snapToSpot(left, spots.left);
        if (Math.hypot(right.x - spots.right.x, right.y - spots.right.y) > 12) this.snapToSpot(right, spots.right);
        left.dir = 'right';
        right.dir = 'left';
        sayLine(left, '决斗开始！⚔️', 2200, now);
        sayLine(right, '放马过来吧！🔥', 2200, now);
      }

      if (this.state.fx && this.state.fx.id !== this.lastRemoteFxId) {
        this.lastRemoteFxId = this.state.fx.id;
        const attacker = this.sim.chars.get(this.state.fx.fromId);
        const defender = this.sim.chars.get(this.state.fx.toId);
        if (attacker && !attacker.gone) {
          attacker.pose = 'play';
          sayLine(attacker, this.state.fx.moveName, 1900, now);
        }
        if (defender && !defender.gone && Math.random() < 0.7) {
          defender.pose = 'sulk';
          sayLine(defender, '唔！💥', 1200, now);
        }
        if (Math.random() < 0.45) {
          this.runWatcherCheer(now);
        }
      }
    } else if (incoming.phase === 'finish') {
      if (prevPhase !== 'finish') {
        const winner = incoming.winnerId ? this.sim.chars.get(incoming.winnerId) : undefined;
        const loserId = incoming.winnerId === incoming.leftId ? incoming.rightId : incoming.leftId;
        const loser = loserId ? this.sim.chars.get(loserId) : undefined;
        if (winner && !winner.gone) {
          winner.pose = 'cheer';
          winner.setIcon('star', FINISH_HOLD_MS, now);
          sayLine(winner, '赢了！🏆', 3200, now);
          this.sim.pushEffect({ kind: 'confetti', charId: winner.id, at: now });
        }
        if (loser && !loser.gone) {
          loser.pose = 'sulk';
          sayLine(loser, '下次一定赢回来…', 3000, now);
        }
        for (const id of this.localWatchers) {
          const w = this.sim.chars.get(id);
          if (w && !w.gone && !w.leaving) {
            w.pose = 'cheer';
            sayLine(w, `恭喜 ${incoming.winnerName || winner?.info.name || '冠军'}！👏`, 2400, now);
          }
        }
        if (this.state.fx) this.lastRemoteFxId = this.state.fx.id;
      }
    }

    this.lastRemoteMatchId = incoming.matchId;
    this.lastRemotePhase = incoming.phase;
  }

  private releaseRemoteParticipants(now: number): void {
    this.internalClearing = true;
    try {
      for (const id of this.remoteParticipants) {
        const c = this.sim.chars.get(id);
        if (!c || c.gone) continue;
        this.sim.clearPlan(c);
        c.nextOutingAt = now + 8_000 + Math.random() * 12_000;
      }
    } finally {
      this.internalClearing = false;
      this.remoteParticipants.clear();
    }
  }

  toSyncedState(): SyncedArenaState {
    return {
      ...this.state,
      ...(this.nextDuelAt ? { nextDuelAt: this.nextDuelAt } : {}),
      watchers: [...this.state.watchers],
      ...(this.state.fx ? { fx: { ...this.state.fx } } : {}),
      leaderboard: this.state.leaderboard.slice(0, 6).map((e) => ({ ...e })),
    };
  }

  applySynced(remote: SyncedArenaState, offset: number): void {
    this.nextDuelAt = remote.nextDuelAt ? remote.nextDuelAt + offset : 0;
    this.state = {
      ...remote,
      startedAt: remote.startedAt ? remote.startedAt + offset : 0,
      endsAt: remote.endsAt ? remote.endsAt + offset : 0,
      ...(this.nextDuelAt ? { nextDuelAt: this.nextDuelAt } : {}),
      watchers: [...remote.watchers],
      ...(remote.fx
        ? {
            fx: {
              ...remote.fx,
              at: remote.fx.at + offset,
              until: remote.fx.until + offset,
            },
          }
        : {}),
      leaderboard: remote.leaderboard.map((e) => ({ ...e })),
    };
  }

  // ------------------------------------------------------------------ internal lifecycle

  private isParticipantValid(ch: Character | undefined): boolean {
    return !!ch && !ch.gone && !ch.leaving && ch.mode === 'idle';
  }

  private ringSpots(): { left: SpotDef; right: SpotDef } | null {
    const spots = this.sim.spots
      .ofKind('arena_fight')
      .filter((s) => s.areaId === ARENA_ID)
      .sort((a, b) => a.tx - b.tx);
    if (spots.length < 2) return null;
    return { left: spots[0], right: spots[1] };
  }

  private tryStart(now: number): boolean {
    const spots = this.ringSpots();
    if (!spots) return false;

    const fighters: Character[] = [];
    for (const c of this.sim.chars.values()) {
      if (c.gone || c.leaving || c.arriving || c.inside) continue;
      if (c.mode !== 'idle') continue;
      if (!isPokemonPet(c.info.pet)) continue;
      fighters.push(c);
    }
    if (fighters.length < 2) return false;

    this.shuffle(fighters);
    const left = fighters[0];
    const right = fighters[1];

    // 先将两位选手置为 gather 状态，以免清空原闲逛计划时触发其他副作用
    this.state = {
      phase: 'gather',
      matchId: this.state.matchId + 1,
      leftId: left.id,
      leftName: left.info.name,
      leftHp: 100,
      rightId: right.id,
      rightName: right.info.name,
      rightHp: 100,
      startedAt: now,
      endsAt: now + GATHER_TIMEOUT_MS,
      durationMs: DUEL_DURATION_MS,
      watchers: [],
      leaderboard: this.state.leaderboard,
    };

    this.dispatchToSpot(left, spots.left, true, `${right.info.name}，来切磋一局！⚔️`, now);
    this.dispatchToSpot(right, spots.right, true, `正合我意，${left.info.name}！⚡`, now);
    this.inviteWatchers(now, 4);
    return true;
  }

  private dispatchToSpot(ch: Character, spot: SpotDef, run: boolean, line: string | null, now: number): boolean {
    this.internalClearing = true;
    try {
      this.sim.clearPlan(ch);
    } finally {
      this.internalClearing = false;
    }
    if (!this.sim.reserveTemp(ch, spot)) return false;

    const steps: Step[] = [];
    this.sim.pushLeave(ch, steps);
    steps.push({ t: 'go', tx: spot.tx, ty: spot.ty, fx: spot.x, fy: spot.y, dir: spot.dir, run });
    if (line) {
      steps.push({
        t: 'do',
        fn: () => {
          ch.dir = spot.dir;
          sayLine(ch, line, 2400, this.nowTime());
        },
      });
    } else {
      steps.push({
        t: 'do',
        fn: () => {
          ch.dir = spot.dir;
        },
      });
    }
    steps.push({ t: 'act', pose: 'stand', ms: 90_000 });
    ch.queue.push(...steps);
    if (!line) void now;
    return true;
  }

  private nowTime(): number {
    return this.sim.now || Date.now();
  }

  private inviteWatchers(now: number, limit: number): void {
    const watchSpots = this.sim.spots
      .ofKind('arena_watch')
      .filter((s) => s.areaId === ARENA_ID && this.sim.spots.isFree(s.id));
    if (!watchSpots.length) return;

    const cands: Character[] = [];
    for (const c of this.sim.chars.values()) {
      if (c.gone || c.leaving || c.arriving || c.inside) continue;
      if (c.mode !== 'idle') continue;
      if (this.isBusy(c.id)) continue;
      cands.push(c);
    }
    this.shuffle(cands);

    let added = 0;
    for (const c of cands) {
      if (added >= limit) break;
      const spot = watchSpots.find((s) => this.sim.spots.isFree(s.id, c.id) && this.sim.canUseSeat(c, s));
      if (!spot) continue;
      this.state.watchers.push(c.id);
      if (this.dispatchToSpot(c, spot, false, '有宝可梦决斗，去围观！🍿', now)) {
        added++;
      } else {
        const idx = this.state.watchers.indexOf(c.id);
        if (idx >= 0) this.state.watchers.splice(idx, 1);
      }
    }
  }

  private inviteExtraWatchers(now: number): void {
    if (this.state.watchers.length >= 4) return;
    this.inviteWatchers(now, 4 - this.state.watchers.length);
  }

  private snapToSpot(ch: Character, spot: SpotDef): void {
    ch.queue.length = 0;
    ch.step = null;
    if (ch.atSpot && ch.atSpot !== spot.id) this.sim.spots.release(ch.atSpot, ch.id);
    ch.atSpot = spot.id;
    ch.seated = false;
    ch.sortY = null;
    ch.placeAtTile(spot.tx, spot.ty);
    ch.x = spot.x;
    ch.y = spot.y;
    ch.dir = spot.dir;
    ch.queue.push({ t: 'act', pose: 'stand', ms: 90_000 });
  }

  private beginFight(left: Character, right: Character, now: number): void {
    this.plannedWinner = Math.random() < 0.5 ? 'left' : 'right';
    this.state.phase = 'fight';
    this.state.startedAt = now;
    this.state.endsAt = now + DUEL_DURATION_MS;
    this.state.leftHp = 100;
    this.state.rightHp = 100;
    left.dir = 'right';
    right.dir = 'left';
    sayLine(left, '决斗开始！⚔️', 2200, now);
    sayLine(right, '放马过来吧！🔥', 2200, now);
    this.nextExchangeAt = now + 2_200;
    this.nextCheerAt = now + 3_500;
  }

  private runExchange(left: Character, right: Character, now: number): void {
    const remaining = Math.max(0, this.state.endsAt - now);
    const atkSide: 'left' | 'right' =
      remaining < 6_000 ? this.plannedWinner : Math.random() < 0.5 ? 'left' : 'right';
    const attacker = atkSide === 'left' ? left : right;
    const defender = atkSide === 'left' ? right : left;
    const move = MOVES[Math.floor(Math.random() * MOVES.length)];

    const fx: SyncedArenaFx = {
      id: this.fxSeq++,
      kind: move.kind,
      fromId: attacker.id,
      toId: defender.id,
      moveName: move.moveName,
      at: now,
      until: now + FX_DURATION_MS,
    };
    this.state.fx = fx;

    attacker.pose = 'play';
    sayLine(attacker, move.moveName, 1900, now);
    if (Math.random() < 0.65) {
      defender.pose = 'sulk';
      sayLine(defender, '唔！💥', 1200, now);
    }

    const dmg = 7 + Math.floor(Math.random() * 10);
    const minFloor = atkSide === this.plannedWinner ? 12 : 18;
    if (atkSide === 'left') {
      this.state.rightHp = Math.max(minFloor, this.state.rightHp - dmg);
    } else {
      this.state.leftHp = Math.max(minFloor, this.state.leftHp - dmg);
    }
  }

  private runWatcherCheer(now: number): void {
    const arrived: Character[] = [];
    for (const id of this.state.watchers) {
      const w = this.sim.chars.get(id);
      if (w && !w.gone && !w.leaving && w.step?.t !== 'go') arrived.push(w);
    }
    if (!arrived.length) return;
    const picked = arrived[Math.floor(Math.random() * arrived.length)];
    picked.pose = Math.random() < 0.5 ? 'cheer' : 'laugh';
    sayLine(picked, CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)], 2200, now);
  }

  private finishMatch(left: Character, right: Character, now: number): void {
    const winSide = this.plannedWinner;
    const winner = winSide === 'left' ? left : right;
    const loser = winSide === 'left' ? right : left;

    if (winSide === 'left') {
      this.state.leftHp = Math.max(12, this.state.leftHp);
      this.state.rightHp = 0;
    } else {
      this.state.rightHp = Math.max(12, this.state.rightHp);
      this.state.leftHp = 0;
    }

    const finMove = MOVES[Math.floor(Math.random() * MOVES.length)];
    this.state.fx = {
      id: this.fxSeq++,
      kind: finMove.kind,
      fromId: winner.id,
      toId: loser.id,
      moveName: finMove.moveName,
      at: now,
      until: now + FX_DURATION_MS,
    };

    this.state.phase = 'finish';
    this.state.endsAt = now + FINISH_HOLD_MS;
    this.state.winnerId = winner.id;
    this.state.winnerName = winner.info.name;

    winner.pose = 'cheer';
    winner.setIcon('star', FINISH_HOLD_MS, now);
    sayLine(winner, '赢了！🏆', 3200, now);
    this.sim.pushEffect({ kind: 'confetti', charId: winner.id, at: now });

    loser.pose = 'sulk';
    sayLine(loser, '下次一定赢回来…', 3000, now);

    for (const id of this.state.watchers) {
      const w = this.sim.chars.get(id);
      if (w && !w.gone && !w.leaving) {
        w.pose = 'cheer';
        sayLine(w, `恭喜 ${winner.info.name}！👏`, 2400, now);
      }
    }

    this.applyResultToLeaderboard(winner.id, winner.info.name, loser.id, loser.info.name, now);
    this.onResult?.(winner.id, winner.info.name, loser.id, loser.info.name, now);
  }

  private applyResultToLeaderboard(winnerId: string, winnerName: string, loserId: string, loserName: string, now: number): void {
    const hour = beijingHourBucket(now);
    if (hour !== this.leaderboardHour) {
      this.leaderboardHour = hour;
      this.state.leaderboard = [];
    }
    const map = new Map(this.state.leaderboard.map((e) => [e.id, { ...e }]));
    const w = map.get(winnerId) ?? { id: winnerId, name: winnerName, wins: 0, losses: 0 };
    w.name = winnerName;
    w.wins += 1;
    map.set(winnerId, w);

    const l = map.get(loserId) ?? { id: loserId, name: loserName, wins: 0, losses: 0 };
    l.name = loserName;
    l.losses += 1;
    map.set(loserId, l);

    this.state.leaderboard = [...map.values()].sort(
      (a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name, 'zh-CN'),
    );
  }

  private cancelMatch(now: number): void {
    this.endMatch(now);
  }

  private endMatch(now: number): void {
    const participants = [
      this.state.leftId,
      this.state.rightId,
      ...this.state.watchers,
    ].filter((id): id is string => !!id);

    this.state.phase = 'idle';
    this.state.leftId = undefined;
    this.state.leftName = undefined;
    this.state.rightId = undefined;
    this.state.rightName = undefined;
    this.state.winnerId = undefined;
    this.state.winnerName = undefined;
    this.state.fx = undefined;
    this.state.watchers = [];
    this.state.leftHp = 100;
    this.state.rightHp = 100;
    this.nextDuelAt = now + COOLDOWN_MIN_MS + Math.random() * (COOLDOWN_MAX_MS - COOLDOWN_MIN_MS);
    this.state.nextDuelAt = this.nextDuelAt;

    this.internalClearing = true;
    try {
      for (const id of participants) {
        const c = this.sim.chars.get(id);
        if (!c || c.gone) continue;
        this.sim.clearPlan(c);
        c.nextOutingAt = now + 8_000 + Math.random() * 12_000;
      }
    } finally {
      this.internalClearing = false;
    }
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}
