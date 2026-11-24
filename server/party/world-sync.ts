import type { Appearance, ArtModule, RoomTheme } from '../../client/src/art/api';
import { DEFAULT_WORLD_OPTIONS } from '../../client/src/world/api';
import { PRE_DUEL_SYNC_LEAD_MS } from '../../client/src/world/sim/arena';
import { Sim } from '../../client/src/world/sim/sim';
import type { ArenaLeaderboardEntry, OfficeSnapshot, SyncedArenaEvent, SyncedArenaState, SyncedGathering, WorldSyncFrame } from '../../shared/types';

const HEADLESS_THEME: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

const HEADLESS_APPEARANCE: Appearance = {
  skin: '#f0c8a0',
  hair: '#3a2a20',
  hairStyle: 'short',
  eyes: '#222222',
  top: '#3f7fd8',
  topAccent: '#ffffff',
  topStyle: 'tshirt',
  bottom: '#333333',
  shoes: '#111111',
  accessory: 'none',
  accessoryColor: '#000000',
  lanyard: null,
  look: 'm',
};

const headlessArt = {
  appearanceFromSeed: () => HEADLESS_APPEARANCE,
  roomTheme: () => HEADLESS_THEME,
} as unknown as ArtModule;

function arenaSignature(a: SyncedArenaState): string {
  const lb = a.leaderboard.map((e) => `${e.id}:${e.wins}:${e.losses}`).join(',');
  return [
    a.phase,
    a.matchId,
    a.leftId ?? '',
    a.rightId ?? '',
    a.leftHp,
    a.rightHp,
    a.startedAt,
    a.endsAt,
    a.nextDuelAt ?? 0,
    a.winnerId ?? '',
    a.fx?.id ?? 0,
    lb,
  ].join('|');
}

export class WorldSync {
  readonly sim: Sim;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private latestSnapRev = 0;
  private latestFrame: WorldSyncFrame | null = null;
  private latestArenaEvent: SyncedArenaEvent;
  private lastArenaSig = '';
  private preDuelSyncedForAt = 0;
  private readonly listeners = new Set<(frame: WorldSyncFrame) => void>();
  private readonly arenaListeners = new Set<(ev: SyncedArenaEvent) => void>();
  private readonly preDuelListeners = new Set<(frame: WorldSyncFrame) => void>();

  constructor(
    initialSnapshot: OfficeSnapshot,
    opts?: {
      initialLeaderboard?: ArenaLeaderboardEntry[];
      onArenaResult?: (winnerId: string, winnerName: string, loserId: string, loserName: string, now?: number) => void;
      onArenaLeaderboardReset?: (now: number) => void;
    },
  ) {
    this.sim = new Sim(headlessArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null);
    if (opts?.initialLeaderboard) this.sim.arena.setLeaderboard(opts.initialLeaderboard);
    if (opts?.onArenaResult) this.sim.arena.onResult = opts.onArenaResult;
    if (opts?.onArenaLeaderboardReset) this.sim.arena.onLeaderboardReset = opts.onArenaLeaderboardReset;
    this.latestSnapRev = initialSnapshot.rev;
    const now = Date.now();
    this.sim.applySnapshot(initialSnapshot, now);
    this.sim.update(1 / 30, now);
    this.lastTickAt = now;
    const arena = this.sim.arena.toSyncedState();
    this.lastArenaSig = arenaSignature(arena);
    this.latestArenaEvent = { t: now, arena };
  }

  triggerArenaDuel(): { ok: boolean; error?: string } {
    const now = Date.now();
    const res = this.sim.arena.triggerNow(now);
    if (res.ok) this.syncArenaChange(now);
    return res;
  }

  onFrame(cb: (frame: WorldSyncFrame) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  onArena(cb: (ev: SyncedArenaEvent) => void): () => void {
    this.arenaListeners.add(cb);
    return () => void this.arenaListeners.delete(cb);
  }

  onPreDuelSync(cb: (frame: WorldSyncFrame) => void): () => void {
    this.preDuelListeners.add(cb);
    return () => void this.preDuelListeners.delete(cb);
  }

  getArenaEvent(): SyncedArenaEvent {
    return this.latestArenaEvent;
  }

  applySnapshot(snap: OfficeSnapshot, now = Date.now()): void {
    this.latestSnapRev = snap.rev;
    this.sim.applySnapshot(snap, now);
    this.syncArenaChange(now);
    if (this.listeners.size > 0) {
      this.latestFrame = this.buildFrame(now);
      this.emit();
    } else {
      this.latestFrame = null;
    }
  }

  step(now = Date.now()): WorldSyncFrame {
    const dt = this.lastTickAt ? Math.min(0.25, Math.max(0.01, (now - this.lastTickAt) / 1000)) : 0.25;
    this.lastTickAt = now;
    this.sim.update(dt, now);
    this.syncArenaChange(now);
    const preFrame = this.maybeEmitPreDuelSync(now);
    if (this.listeners.size > 0) {
      this.latestFrame = preFrame ?? this.buildFrame(now);
      this.emit();
      return this.latestFrame;
    }
    this.latestFrame = null;
    return preFrame ?? this.buildFrame(now);
  }

  start(intervalMs = 250): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => {
      this.step(Date.now());
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getFrame(): WorldSyncFrame {
    return this.buildFrame(Date.now());
  }

  private maybeEmitPreDuelSync(now: number): WorldSyncFrame | null {
    const arena = this.sim.arena.state;
    if (arena.phase !== 'idle' || !arena.nextDuelAt || arena.nextDuelAt <= 0) return null;
    if (now < arena.nextDuelAt - PRE_DUEL_SYNC_LEAD_MS) return null;
    if (this.preDuelSyncedForAt === arena.nextDuelAt) return null;
    this.preDuelSyncedForAt = arena.nextDuelAt;
    const frame = this.buildFrame(now);
    for (const cb of this.preDuelListeners) {
      try {
        cb(frame);
      } catch (err) {
        console.error('[world-sync] pre-duel listener error', err);
      }
    }
    return frame;
  }

  private syncArenaChange(now: number): void {
    const arena = this.sim.arena.toSyncedState();
    const sig = arenaSignature(arena);
    if (sig === this.lastArenaSig) return;
    this.lastArenaSig = sig;
    this.latestArenaEvent = { t: now, arena };
    for (const cb of this.arenaListeners) {
      try {
        cb(this.latestArenaEvent);
      } catch (err) {
        console.error('[world-sync] arena listener error', err);
      }
    }
  }

  private emit(): void {
    if (!this.latestFrame) return;
    for (const cb of this.listeners) {
      try {
        cb(this.latestFrame);
      } catch (err) {
        console.error('[world-sync] listener error', err);
      }
    }
  }

  private buildFrame(now: number): WorldSyncFrame {
    const chars = [...this.sim.chars.values()].map((ch) => ({
      id: ch.id,
      x: Math.round(ch.x * 10) / 10,
      y: Math.round(ch.y * 10) / 10,
      tx: ch.tx,
      ty: ch.ty,
      dir: ch.dir,
      pose: ch.pose,
      held: ch.held,
      seated: ch.seated,
      alpha: Math.round(ch.alpha * 100) / 100,
      visible: ch.visible,
      inside: ch.inside,
      leaving: ch.leaving,
      sortY: ch.sortY,
      offX: Math.round(ch.offX * 10) / 10,
      offY: Math.round(ch.offY * 10) / 10,
      mode: ch.mode,
      atSpot: ch.atSpot,
      homeSpot: ch.homeSpot,
      icon: ch.icon,
      iconAt: ch.iconAt,
      sayText: ch.sayText,
      sayAt: ch.sayAt,
      sayUntil: ch.sayUntil,
      chatEmoji: ch.chatEmoji,
      chatUntil: ch.chatUntil,
      animT: Math.round(ch.animT),
    }));

    const rooms = [...this.sim.rooms.values()]
      .filter((r) => !r.ghost)
      .map((r) => ({
        id: r.id,
        lightOn: r.lightOn,
        phase: r.phase,
      }));

    const gatherings: SyncedGathering[] = [...this.sim.social.gatherings].map((g) => ({
      kind: g.kind,
      phase: g.phase,
      startAt: g.startAt,
      members: g.members.map((m) => ({
        id: m.id,
        role: m.role,
        ...(m.left ? { left: true } : {}),
      })),
    }));

    return {
      t: now,
      rev: this.latestSnapRev,
      chars,
      rooms,
      elevators: this.sim.elevators.map((e) => Math.round(e.door * 100) / 100),
      machines: [...this.sim.machineUntil.entries()],
      stalls: [...this.sim.stallBusy],
      gatherings,
      arcadeSeed: this.sim.social.arcadeSeed(),
      tvScreen: this.sim.social.tvScreen(),
      arena: this.sim.arena.toSyncedState(),
    };
  }
}
