import type { AgentStatus, FeedItem, OfficeSnapshot, SyncedArenaEvent } from '../../shared/types';

interface TrackedAgent {
  name: string;
  status: AgentStatus;
  roomId: string;
  roomName: string;
  ownerId?: string;
}

export class OfficeFeedTracker {
  private seq = 0;
  private prevAgents = new Map<string, TrackedAgent>();
  private announcedStartMatchId = 0;
  private announcedFinishMatchId = 0;
  private lastPrevChampKey = '';

  constructor(initialSnap: OfficeSnapshot, initialArena: SyncedArenaEvent) {
    this.seedSnapshot(initialSnap);
    this.seedArena(initialArena);
  }

  private seedSnapshot(snap: OfficeSnapshot): void {
    const roomNames = new Map(snap.rooms.map((r) => [r.id, r.name]));
    for (const a of snap.agents) {
      if (a.ownerId) continue;
      this.prevAgents.set(a.id, {
        name: a.name,
        status: a.status,
        roomId: a.roomId,
        roomName: roomNames.get(a.roomId) ?? '办公区',
        ownerId: a.ownerId,
      });
    }
  }

  private seedArena(ev: SyncedArenaEvent): void {
    const a = ev.arena;
    if ((a.phase === 'gather' || a.phase === 'fight') && a.matchId > 0) {
      this.announcedStartMatchId = a.matchId;
    }
    if (a.phase === 'finish' && a.matchId > 0) {
      this.announcedStartMatchId = a.matchId;
      this.announcedFinishMatchId = a.matchId;
    }
    if (a.prevChampion) {
      const c = a.prevChampion;
      this.lastPrevChampKey = `${c.id}:${c.hourBucket}:${c.wins}:${c.losses}`;
    }
  }

  private nextSnapId(now: number): string {
    return `party:snap:${++this.seq}:${now}`;
  }

  private nextArenaId(at: number): string {
    return `party:arena:${++this.seq}:${at}`;
  }

  diffSnapshot(snap: OfficeSnapshot, now = Date.now()): FeedItem[] {
    const roomNames = new Map(snap.rooms.map((r) => [r.id, r.name]));
    const nextAgents = new Map<string, TrackedAgent>();
    const items: FeedItem[] = [];

    for (const a of snap.agents) {
      if (a.ownerId) continue;
      const roomName = roomNames.get(a.roomId) ?? '办公区';
      nextAgents.set(a.id, {
        name: a.name,
        status: a.status,
        roomId: a.roomId,
        roomName,
        ownerId: a.ownerId,
      });

      const prev = this.prevAgents.get(a.id);
      if (!prev) {
        const id = this.nextSnapId(now);
        items.push({
          id,
          agentId: a.id,
          roomId: a.roomId,
          agentName: a.name,
          roomName,
          account: a.account,
          activity: {
            id,
            kind: 'other',
            icon: '🟢',
            text: a.status === 'working' ? '进入办公室开始办公' : '进入办公室',
            at: now,
          },
        });
        continue;
      }

      if (prev.status !== a.status) {
        let icon = '';
        let text = '';
        let kind: 'edit' | 'done' | 'ask' = 'done';
        if (a.status === 'working') {
          icon = '💻';
          text = '回到工位开始办公';
          kind = 'edit';
        } else if (a.status === 'idle') {
          icon = '☕';
          text = '结束手头工作，去休息区摸鱼了';
          kind = 'done';
        } else if (a.status === 'waiting') {
          icon = '✋';
          text = '正在等待确认';
          kind = 'ask';
        }
        if (text) {
          const id = this.nextSnapId(now);
          items.push({
            id,
            agentId: a.id,
            roomId: a.roomId,
            agentName: a.name,
            roomName,
            account: a.account,
            activity: { id, kind, icon, text, at: now },
          });
        }
      }
    }

    for (const [id, prev] of this.prevAgents) {
      if (!nextAgents.has(id)) {
        const itemId = this.nextSnapId(now);
        items.push({
          id: itemId,
          agentId: id,
          roomId: prev.roomId,
          agentName: prev.name,
          roomName: prev.roomName,
          activity: {
            id: itemId,
            kind: 'other',
            icon: '👋',
            text: '离开了办公室',
            at: now,
          },
        });
      }
    }

    this.prevAgents = nextAgents;
    return items;
  }

  diffArena(ev: SyncedArenaEvent): FeedItem[] {
    const a = ev.arena;
    const at = ev.t || Date.now();
    const items: FeedItem[] = [];

    if (
      (a.phase === 'gather' || a.phase === 'fight') &&
      a.matchId > 0 &&
      a.matchId !== this.announcedStartMatchId &&
      a.leftName &&
      a.rightName
    ) {
      this.announcedStartMatchId = a.matchId;
      const id = this.nextArenaId(at);
      items.push({
        id,
        agentId: a.leftId ?? 'arena',
        roomId: 'core:arena',
        agentName: a.leftName,
        roomName: '宝可梦决斗场',
        activity: {
          id,
          kind: 'other',
          icon: '⚔️',
          text: `与 ${a.rightName} 展开宝可梦决斗！`,
          at,
        },
      });
    }

    if (
      a.phase === 'finish' &&
      a.matchId > 0 &&
      a.matchId !== this.announcedFinishMatchId &&
      a.winnerId &&
      a.winnerName
    ) {
      this.announcedFinishMatchId = a.matchId;
      const loserName = a.winnerId === a.leftId ? (a.rightName ?? '对手') : (a.leftName ?? '对手');
      const rec = a.leaderboard.find((e) => e.id === a.winnerId);
      const suffix = rec ? `（本小时 ${rec.wins}胜${rec.losses}负）` : '';
      const id = this.nextArenaId(at);
      items.push({
        id,
        agentId: a.winnerId,
        roomId: 'core:arena',
        agentName: a.winnerName,
        roomName: '宝可梦决斗场',
        activity: {
          id,
          kind: 'other',
          icon: '🏆',
          text: `击败 ${loserName} 赢得决斗胜利${suffix}！`,
          at,
        },
      });
    }

    const champKey = a.prevChampion
      ? `${a.prevChampion.id}:${a.prevChampion.hourBucket}:${a.prevChampion.wins}:${a.prevChampion.losses}`
      : '';
    if (champKey && champKey !== this.lastPrevChampKey && a.prevChampion) {
      this.lastPrevChampKey = champKey;
      const c = a.prevChampion;
      const id = this.nextArenaId(at);
      items.push({
        id,
        agentId: c.id,
        roomId: 'core:arena',
        agentName: c.name,
        roomName: '宝可梦决斗场',
        activity: {
          id,
          kind: 'other',
          icon: '👑',
          text: `荣膺上届决斗场冠军（${c.wins}胜${c.losses}负）！`,
          at,
        },
      });
    }

    return items;
  }
}
