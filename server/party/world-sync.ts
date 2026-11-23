import type { Appearance, ArtModule, RoomTheme } from '../../client/src/art/api';
import { DEFAULT_WORLD_OPTIONS } from '../../client/src/world/api';
import { Sim } from '../../client/src/world/sim/sim';
import type { OfficeSnapshot, SyncedGathering, WorldSyncFrame } from '../../shared/types';

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

export class WorldSync {
  readonly sim: Sim;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private latestSnapRev = 0;
  private latestFrame: WorldSyncFrame;
  private readonly listeners = new Set<(frame: WorldSyncFrame) => void>();

  constructor(initialSnapshot: OfficeSnapshot) {
    this.sim = new Sim(headlessArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null);
    this.latestSnapRev = initialSnapshot.rev;
    const now = Date.now();
    this.sim.applySnapshot(initialSnapshot, now);
    this.sim.update(1 / 30, now);
    this.lastTickAt = now;
    this.latestFrame = this.buildFrame(now);
  }

  onFrame(cb: (frame: WorldSyncFrame) => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  applySnapshot(snap: OfficeSnapshot, now = Date.now()): void {
    this.latestSnapRev = snap.rev;
    this.sim.applySnapshot(snap, now);
    this.latestFrame = this.buildFrame(now);
    this.emit();
  }

  step(now = Date.now()): WorldSyncFrame {
    const dt = this.lastTickAt ? Math.min(0.25, Math.max(0.01, (now - this.lastTickAt) / 1000)) : 0.1;
    this.lastTickAt = now;
    this.sim.update(dt, now);
    this.latestFrame = this.buildFrame(now);
    this.emit();
    return this.latestFrame;
  }

  start(intervalMs = 100): void {
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
    return this.latestFrame;
  }

  private emit(): void {
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
    };
  }
}
