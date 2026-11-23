import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppearanceParts } from '../../shared/appearance';
import { hash32 } from '../../shared/hash';
import type { Activity, AgentInfo, AgentStatus, OfficeSnapshot, RoomInfo } from '../../shared/types';
import type { PetRegistry } from './pets';
import { sanitizePetId } from './pets';

export type ReportStatus = 'working' | 'idle' | 'waiting' | 'offline' | 'session-end';

export interface SessionState {
  status: 'working' | 'waiting' | 'idle';
  agentTool?: string;
  lastSeenAt: number;
}

export interface MemberRecord {
  id: string;
  name: string;
  role: string;
  seed: number;
  look: 'f' | 'm';
  parts?: AppearanceParts;
  custom?: true;
  avatarMode: 'pet' | 'human';
  petId?: string;
  ownerId?: string;
  agentTool?: string;
  isNpc?: true;
  npcAuto?: boolean;
  npcNextToggleAt?: number;
  lastStatus: 'working' | 'waiting' | 'idle' | 'offline';
  statusSince: number;
  lastSeenAt: number;
  joinedAt: number;
  sessions: Record<string, SessionState>;
}

export interface BanRecord {
  id: string;
  name?: string;
  reason?: string;
  bannedAt: number;
}

export const DEFAULT_RECEPTION_SIGN = 'Agent Party';

export interface SiteSettings {
  publicUrl?: string;
  receptionSign?: string;
}

interface PersistedState {
  version: 1;
  members: MemberRecord[];
  banned: BanRecord[];
  settings?: SiteSettings;
}

export function normalizePublicUrl(raw: unknown): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return { ok: false, error: '请输入有效的 http:// 或 https:// 地址（例如 https://agent.example.com）。' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: '请输入有效的 http:// 或 https:// 地址（例如 https://agent.example.com）。' };
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
    return { ok: false, error: '请输入有效的 http:// 或 https:// 地址（例如 https://agent.example.com）。' };
  }
  return { ok: true, value: trimmed.replace(/\/+$/, '') };
}

export interface ReportInput {
  id: string;
  name?: string;
  role?: string;
  status?: string;
  petId?: string;
  companionPetId?: string;
  companionPetName?: string;
  agentTool?: string;
  tool?: string;
  sessionId?: string;
}

export type ReportResult =
  | { ok: true; member: MemberRecord; companion?: MemberRecord }
  | { ok: false; error: string; banned?: boolean; statusCode: number };

export function formatCompanionName(ownerName: string, petDisplayName?: string, customPetName?: string): string {
  const owner = ownerName.trim() || 'AI';
  const cleanPetDisplay = petDisplayName
    ? petDisplayName.replace(/\s*\([^)]*\)\s*$/, '').trim()
    : '';
  const base = (customPetName?.trim() || cleanPetDisplay || '桌宠').trim();
  const full = base.startsWith(`${owner}的`) ? base : `${owner}的${base}`;
  return full.slice(0, 32);
}

export interface StoreConfig {
  dataDir: string;
  workingTimeoutMs?: number;
  offlineTimeoutMs?: number;
  pets: PetRegistry;
}

const VALID_REPORT_STATUSES = new Set<string>(['working', 'idle', 'waiting', 'offline', 'session-end']);

function cleanText(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.replace(/[\r\n\t]+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function statusActivity(status: 'working' | 'waiting' | 'idle', at: number): Activity {
  if (status === 'working') {
    return { id: `st:${status}:${at}`, kind: 'edit', icon: '💻', text: '正在办公', at };
  }
  if (status === 'waiting') {
    return { id: `st:${status}:${at}`, kind: 'ask', icon: '✋', text: '等待确认', at };
  }
  return { id: `st:${status}:${at}`, kind: 'done', icon: '☕', text: '自由活动中', at };
}

function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

export class PartyStore {
  private readonly statePath: string;
  private readonly workingTimeoutMs: number;
  private readonly offlineTimeoutMs: number;
  private readonly pets: PetRegistry;
  private readonly members = new Map<string, MemberRecord>();
  private readonly banned = new Map<string, BanRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly startedAt = Date.now();
  private publicUrl: string | undefined;
  private receptionSign: string | undefined;
  private rev = 1;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(cfg: StoreConfig) {
    mkdirSync(cfg.dataDir, { recursive: true });
    this.statePath = join(cfg.dataDir, 'state.json');
    this.workingTimeoutMs = cfg.workingTimeoutMs ?? Number(process.env.WORKING_TIMEOUT_MS || 5 * 60_000);
    this.offlineTimeoutMs = cfg.offlineTimeoutMs ?? Number(process.env.OFFLINE_TIMEOUT_MS || 7 * 24 * 60 * 60_000);
    this.pets = cfg.pets;
    this.load();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  private emit(): void {
    this.rev++;
    this.scheduleSave();
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.error('[store] listener error', err);
      }
    }
  }

  private load(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<PersistedState>;
      if (Array.isArray(raw.members)) {
        for (const m of raw.members) {
          if (!m || typeof m.id !== 'string' || !m.id.trim()) continue;
          const rec: MemberRecord = {
            ...m,
            sessions: m.sessions && typeof m.sessions === 'object' ? m.sessions : {},
          };
          if (!rec.isNpc && !rec.ownerId && rec.lastStatus !== 'offline' && Object.keys(rec.sessions).length > 0) {
            this.recomputeEffectiveStatus(rec, rec.lastSeenAt || Date.now());
          }
          this.members.set(m.id, rec);
        }
      }
      if (Array.isArray(raw.banned)) {
        for (const b of raw.banned) {
          if (b && typeof b.id === 'string' && b.id.trim()) this.banned.set(b.id, b);
        }
      }
      if (raw.settings && typeof raw.settings.publicUrl === 'string') {
        const parsed = normalizePublicUrl(raw.settings.publicUrl);
        if (parsed.ok) this.publicUrl = parsed.value;
      }
      if (raw.settings && typeof raw.settings.receptionSign === 'string') {
        this.receptionSign = cleanText(raw.settings.receptionSign, 28);
      }
    } catch (err) {
      console.warn('[store] failed to load state.json, starting fresh', err);
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 300);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty && existsSync(this.statePath)) return;
    this.dirty = false;
    const settings: SiteSettings = {
      ...(this.publicUrl ? { publicUrl: this.publicUrl } : {}),
      ...(this.receptionSign ? { receptionSign: this.receptionSign } : {}),
    };
    const payload: PersistedState = {
      version: 1,
      members: [...this.members.values()],
      banned: [...this.banned.values()],
      ...(Object.keys(settings).length ? { settings } : {}),
    };
    const tmp = `${this.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, this.statePath);
  }

  /**
   * Handles status check-in / heartbeat from any AI Agent.
   * Strictly strips task/prompt/cwd/command fields for privacy.
   */
  report(raw: ReportInput, now = Date.now()): ReportResult {
    const id = cleanText(raw.id, 64);
    if (!id) {
      return { ok: false, error: 'Missing required field: id', statusCode: 400 };
    }
    if (this.banned.has(id)) {
      return { ok: false, error: '该成员已被管理员移出并封禁。', banned: true, statusCode: 403 };
    }

    const statusRaw = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : 'idle';
    if (!VALID_REPORT_STATUSES.has(statusRaw)) {
      return {
        ok: false,
        error: `Invalid status "${statusRaw}". Expected working | idle | waiting | offline | session-end.`,
        statusCode: 400,
      };
    }
    const status = statusRaw as ReportStatus;
    const name = cleanText(raw.name, 32);
    const role = cleanText(raw.role, 32);
    const toolName = cleanText(raw.agentTool ?? raw.tool, 24);
    const sessionId = cleanText(raw.sessionId, 64) ?? 'default';
    const petSlug = raw.petId ? sanitizePetId(raw.petId) : null;
    const companionPetSlug = raw.companionPetId ? sanitizePetId(raw.companionPetId) : null;
    const companionPetName = cleanText(raw.companionPetName, 24);

    let m = this.members.get(id);
    if (!m) {
      if (status === 'offline' || status === 'session-end') {
        return {
          ok: true,
          member: {
            id,
            name: name ?? id,
            role: role ?? 'AI 伙伴',
            seed: hash32(id),
            look: (hash32(`${id}:look`) & 1) === 0 ? 'f' : 'm',
            avatarMode: petSlug && this.pets.getPet(petSlug) ? 'pet' : 'human',
            ...(petSlug ? { petId: petSlug } : {}),
            ...(toolName ? { agentTool: toolName } : {}),
            lastStatus: 'offline',
            statusSince: now,
            lastSeenAt: now,
            joinedAt: now,
            sessions: {},
          },
        };
      }
      const hasPet = !!(petSlug && this.pets.getPet(petSlug));
      m = {
        id,
        name: name ?? id,
        role: role ?? 'AI 伙伴',
        seed: hash32(id),
        look: (hash32(`${id}:look`) & 1) === 0 ? 'f' : 'm',
        avatarMode: hasPet ? 'pet' : 'human',
        ...(hasPet && petSlug ? { petId: petSlug } : {}),
        ...(toolName ? { agentTool: toolName } : {}),
        lastStatus: status,
        statusSince: now,
        lastSeenAt: now,
        joinedAt: now,
        sessions: {
          [sessionId]: { status, ...(toolName ? { agentTool: toolName } : {}), lastSeenAt: now },
        },
      };
      this.members.set(id, m);
      const companion = this.syncCompanion(m, companionPetSlug, companionPetName, now);
      this.emit();
      return { ok: true, member: m, ...(companion ? { companion } : {}) };
    }

    // Protect NPCs and system-managed companion pets from being overwritten via /api/report
    if (m.isNpc || m.ownerId) {
      return { ok: false, error: '无法通过上报接口修改 NPC 或系统托管角色。', statusCode: 403 };
    }

    // Update profile metadata when provided (unless customized via web UI for name)
    if (name && !m.custom) m.name = name;
    if (role && !m.custom) m.role = role;
    if (petSlug && !m.custom && this.pets.getPet(petSlug)) {
      m.petId = petSlug;
      m.avatarMode = 'pet';
    }
    if (toolName) m.agentTool = toolName;
    m.lastSeenAt = now;

    if (status === 'offline') {
      m.sessions = {};
      if (m.lastStatus !== 'offline') {
        m.lastStatus = 'offline';
        m.statusSince = now;
      }
      this.syncCompanion(m, null, undefined, now);
      this.emit();
      return { ok: true, member: m };
    }

    if (status === 'session-end') {
      delete m.sessions[sessionId];
      this.recomputeEffectiveStatus(m, now);
      const companion = this.syncCompanion(m, companionPetSlug, companionPetName, now);
      this.emit();
      return { ok: true, member: m, ...(companion ? { companion } : {}) };
    }

    m.sessions[sessionId] = {
      status,
      agentTool: toolName ?? m.sessions[sessionId]?.agentTool ?? m.agentTool,
      lastSeenAt: now,
    };
    this.recomputeEffectiveStatus(m, now);
    const companion = this.syncCompanion(m, companionPetSlug, companionPetName, now);
    this.emit();
    return { ok: true, member: m, ...(companion ? { companion } : {}) };
  }

  private syncCompanion(
    owner: MemberRecord,
    petSlug: string | null,
    customPetName: string | undefined,
    now: number,
  ): MemberRecord | undefined {
    const compId = `${owner.id}:pet`;
    const existing = this.members.get(compId);

    if (owner.lastStatus === 'offline') {
      if (existing && existing.lastStatus !== 'offline') {
        existing.lastStatus = 'offline';
        existing.statusSince = now;
      }
      return undefined;
    }

    const pet = petSlug ? this.pets.getPet(petSlug) : undefined;
    if (!pet && !existing) return undefined;

    if (!existing && pet && petSlug) {
      const comp: MemberRecord = {
        id: compId,
        ownerId: owner.id,
        name: formatCompanionName(owner.name, pet.displayName, customPetName),
        role: `${owner.name}的伙伴`,
        seed: hash32(compId),
        look: 'f',
        avatarMode: 'pet',
        petId: petSlug,
        agentTool: '桌宠',
        lastStatus: 'idle',
        statusSince: now,
        lastSeenAt: now,
        joinedAt: owner.joinedAt + 1,
        sessions: {},
      };
      this.members.set(compId, comp);
      return comp;
    }

    if (existing) {
      existing.ownerId = owner.id;
      existing.lastSeenAt = now;
      if (existing.lastStatus === 'offline') {
        existing.lastStatus = 'idle';
        existing.statusSince = now;
      }
      if (!existing.custom) {
        existing.role = `${owner.name}的伙伴`;
        if (pet && petSlug) {
          existing.petId = petSlug;
          existing.avatarMode = 'pet';
          existing.name = formatCompanionName(owner.name, pet.displayName, customPetName);
        } else if (existing.petId) {
          const curPet = this.pets.getPet(existing.petId);
          if (curPet || customPetName) {
            existing.name = formatCompanionName(owner.name, curPet?.displayName, customPetName);
          }
        }
      }
      return existing;
    }

    return undefined;
  }

  private recomputeEffectiveStatus(m: MemberRecord, now: number): boolean {
    const ordered = Object.values(m.sessions).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
    let next: 'working' | 'waiting' | 'idle' = 'idle';
    let bestTool: string | undefined;

    for (const s of ordered) {
      if (s.status === 'working') {
        next = 'working';
        if (s.agentTool) bestTool = s.agentTool;
        break;
      }
    }
    if (next !== 'working') {
      for (const s of ordered) {
        if (s.status === 'waiting') {
          next = 'waiting';
          if (s.agentTool) bestTool = s.agentTool;
          break;
        }
      }
    }
    if (!bestTool) {
      for (const s of ordered) {
        if (s.agentTool) {
          bestTool = s.agentTool;
          break;
        }
      }
    }
    if (bestTool) m.agentTool = bestTool;

    const changed = m.lastStatus !== next;
    if (changed) {
      m.lastStatus = next;
      m.statusSince = now;
    }
    return changed;
  }

  /** Periodic sweeper for stale working sessions, long-offline cleanup, and auto NPC behavior. */
  sweep(now = Date.now()): boolean {
    let changed = false;
    for (const m of this.members.values()) {
      if (m.isNpc) {
        if (m.npcAuto && (!m.npcNextToggleAt || now >= m.npcNextToggleAt)) {
          const next: 'idle' | 'working' = m.lastStatus === 'working' ? 'idle' : 'working';
          m.lastStatus = next;
          m.statusSince = now;
          m.npcNextToggleAt = now + (next === 'working' ? 35_000 + Math.random() * 35_000 : 45_000 + Math.random() * 55_000);
          changed = true;
        }
        continue;
      }

      if (m.ownerId) {
        const owner = this.members.get(m.ownerId);
        if (!owner || owner.lastStatus === 'offline') {
          if (m.lastStatus !== 'offline') {
            m.lastStatus = 'offline';
            m.statusSince = now;
            changed = true;
          }
        }
        continue;
      }

      if (m.lastStatus === 'offline') continue;

      let sessionChanged = false;
      for (const [sid, s] of Object.entries(m.sessions)) {
        if ((s.status === 'working' || s.status === 'waiting') && now - s.lastSeenAt > this.workingTimeoutMs) {
          s.status = 'idle';
          sessionChanged = true;
        }
        // Clean up very old idle sessions except the latest
        if (Object.keys(m.sessions).length > 1 && now - s.lastSeenAt > this.workingTimeoutMs * 4) {
          delete m.sessions[sid];
          sessionChanged = true;
        }
      }
      if (sessionChanged) {
        if (this.recomputeEffectiveStatus(m, now)) changed = true;
      } else if ((m.lastStatus === 'working' || m.lastStatus === 'waiting') && now - m.lastSeenAt > this.workingTimeoutMs) {
        m.lastStatus = 'idle';
        m.statusSince = now;
        changed = true;
      }

      if (now - m.lastSeenAt > this.offlineTimeoutMs) {
        m.sessions = {};
        m.lastStatus = 'offline';
        m.statusSince = now;
        changed = true;
      }
    }

    if (changed) this.emit();
    return changed;
  }

  updateCharacter(
    id: string,
    patch: {
      name?: string;
      role?: string;
      seed?: number;
      parts?: AppearanceParts;
      petId?: string | null;
      avatarMode?: 'pet' | 'human';
    },
  ): { ok: true } | { ok: false; error: string; statusCode: number } {
    const m = this.members.get(id);
    if (!m) return { ok: false, error: '未找到该成员。', statusCode: 404 };

    const cleanName = cleanText(patch.name, 32);
    if (patch.name !== undefined && !cleanName) {
      return { ok: false, error: '昵称不能为空。', statusCode: 400 };
    }
    if (cleanName) m.name = cleanName;

    const cleanRole = cleanText(patch.role, 32);
    if (cleanRole) m.role = cleanRole;

    if (typeof patch.seed === 'number' && Number.isFinite(patch.seed)) {
      m.seed = patch.seed >>> 0;
    }
    if (patch.parts !== undefined) {
      m.parts = patch.parts;
    }

    if (patch.avatarMode === 'human') {
      m.avatarMode = 'human';
      delete m.petId;
    } else if (patch.avatarMode === 'pet' || patch.petId !== undefined) {
      if (patch.petId === null || patch.petId === '') {
        m.avatarMode = 'human';
        delete m.petId;
      } else if (typeof patch.petId === 'string') {
        const cleanPet = sanitizePetId(patch.petId);
        if (!cleanPet || !this.pets.getPet(cleanPet)) {
          return { ok: false, error: '所选桌宠不存在。', statusCode: 404 };
        }
        m.petId = cleanPet;
        m.avatarMode = 'pet';
      }
    }

    m.custom = true;
    this.emit();
    return { ok: true };
  }

  resetCharacter(id: string): { ok: true } | { ok: false; error: string; statusCode: number } {
    const m = this.members.get(id);
    if (!m) return { ok: false, error: '未找到该成员。', statusCode: 404 };
    delete m.parts;
    delete m.custom;
    delete m.petId;
    m.avatarMode = 'human';
    m.seed = hash32(m.id);
    this.emit();
    return { ok: true };
  }

  // ------------------------------------------------------------------ Admin controls

  kickMember(id: string): boolean {
    const existed = this.members.delete(id);
    let compRemoved = false;
    for (const [mid, m] of this.members) {
      if (m.ownerId === id) {
        this.members.delete(mid);
        compRemoved = true;
      }
    }
    if (existed || compRemoved) this.emit();
    return existed;
  }

  banMember(id: string, reason?: string, now = Date.now()): void {
    const existing = this.members.get(id);
    this.members.delete(id);
    for (const [mid, m] of this.members) {
      if (m.ownerId === id) this.members.delete(mid);
    }
    this.banned.set(id, {
      id,
      ...(existing?.name ? { name: existing.name } : {}),
      ...(cleanText(reason, 120) ? { reason: cleanText(reason, 120) } : {}),
      bannedAt: now,
    });
    this.emit();
  }

  unbanMember(id: string): boolean {
    const existed = this.banned.delete(id);
    if (existed) this.emit();
    return existed;
  }

  createNpc(input: {
    name: string;
    role?: string;
    avatarMode?: 'pet' | 'human';
    petId?: string;
    status?: 'idle' | 'working';
    npcAuto?: boolean;
    agentTool?: string;
  }, now = Date.now()): { ok: true; npc: MemberRecord } | { ok: false; error: string } {
    const name = cleanText(input.name, 32);
    if (!name) return { ok: false, error: 'NPC 昵称不能为空。' };

    const avatarMode = input.avatarMode === 'pet' ? 'pet' : 'human';
    let petId: string | undefined;
    if (avatarMode === 'pet') {
      const cleanPet = input.petId ? sanitizePetId(input.petId) : null;
      if (!cleanPet || !this.pets.getPet(cleanPet)) {
        return { ok: false, error: '请选择一个有效的 Codex V2 桌宠。' };
      }
      petId = cleanPet;
    }

    const id = `npc:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const status: 'idle' | 'working' = input.status === 'working' ? 'working' : 'idle';
    const npc: MemberRecord = {
      id,
      name,
      role: cleanText(input.role, 32) ?? '常驻 NPC',
      seed: randomSeed(),
      look: Math.random() < 0.5 ? 'f' : 'm',
      custom: true,
      avatarMode,
      ...(petId ? { petId } : {}),
      agentTool: cleanText(input.agentTool, 24) ?? 'NPC',
      isNpc: true,
      npcAuto: input.npcAuto ?? true,
      npcNextToggleAt: now + 35_000 + Math.random() * 45_000,
      lastStatus: status,
      statusSince: now,
      lastSeenAt: now,
      joinedAt: now,
      sessions: {},
    };
    this.members.set(id, npc);
    this.emit();
    return { ok: true, npc };
  }

  updateNpc(
    id: string,
    patch: {
      name?: string;
      role?: string;
      avatarMode?: 'pet' | 'human';
      petId?: string | null;
      status?: 'idle' | 'working';
      npcAuto?: boolean;
      reroll?: boolean;
      agentTool?: string;
    },
    now = Date.now(),
  ): { ok: true; npc: MemberRecord } | { ok: false; error: string; statusCode: number } {
    const m = this.members.get(id);
    if (!m || !m.isNpc) return { ok: false, error: '未找到该 NPC。', statusCode: 404 };

    if (patch.name !== undefined) {
      const n = cleanText(patch.name, 32);
      if (!n) return { ok: false, error: 'NPC 昵称不能为空。', statusCode: 400 };
      m.name = n;
    }
    if (patch.role !== undefined) {
      m.role = cleanText(patch.role, 32) ?? '常驻 NPC';
    }
    if (patch.agentTool !== undefined) {
      m.agentTool = cleanText(patch.agentTool, 24) ?? 'NPC';
    }
    if (patch.reroll) {
      m.seed = randomSeed();
      m.look = Math.random() < 0.5 ? 'f' : 'm';
      delete m.parts;
    }
    if (patch.avatarMode === 'human') {
      m.avatarMode = 'human';
      delete m.petId;
    } else if (patch.avatarMode === 'pet' || patch.petId !== undefined) {
      if (!patch.petId) {
        m.avatarMode = 'human';
        delete m.petId;
      } else {
        const cleanPet = sanitizePetId(patch.petId);
        if (!cleanPet || !this.pets.getPet(cleanPet)) {
          return { ok: false, error: '所选桌宠不存在。', statusCode: 400 };
        }
        m.avatarMode = 'pet';
        m.petId = cleanPet;
      }
    }
    if (patch.npcAuto !== undefined) {
      m.npcAuto = !!patch.npcAuto;
      if (m.npcAuto) m.npcNextToggleAt = now + 35_000;
    }
    if (patch.status === 'idle' || patch.status === 'working') {
      if (m.lastStatus !== patch.status) {
        m.lastStatus = patch.status;
        m.statusSince = now;
      }
    }
    m.lastSeenAt = now;
    this.emit();
    return { ok: true, npc: m };
  }

  deleteNpc(id: string): boolean {
    const m = this.members.get(id);
    if (!m || !m.isNpc) return false;
    this.members.delete(id);
    this.emit();
    return true;
  }

  getPublicUrl(): string | undefined {
    return this.publicUrl;
  }

  setPublicUrl(raw: unknown): { ok: true; publicUrl: string | null } | { ok: false; error: string } {
    const parsed = normalizePublicUrl(raw);
    if (!parsed.ok) return parsed;
    this.publicUrl = parsed.value;
    this.dirty = true;
    this.flush();
    return { ok: true, publicUrl: this.publicUrl ?? null };
  }

  getReceptionSign(): string {
    return this.receptionSign || DEFAULT_RECEPTION_SIGN;
  }

  setReceptionSign(raw: unknown): { ok: true; receptionSign: string } {
    this.receptionSign = cleanText(raw, 28);
    this.emit();
    this.flush();
    return { ok: true, receptionSign: this.getReceptionSign() };
  }

  getAdminState() {
    const members = [...this.members.values()]
      .filter((m) => !m.isNpc)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const npcs = [...this.members.values()]
      .filter((m) => m.isNpc)
      .sort((a, b) => b.joinedAt - a.joinedAt);
    const banned = [...this.banned.values()].sort((a, b) => b.bannedAt - a.bannedAt);
    return {
      members,
      npcs,
      banned,
      pets: this.pets.listPets(),
      settings: {
        publicUrl: this.publicUrl ?? '',
        receptionSign: this.receptionSign ?? '',
        effectiveReceptionSign: this.getReceptionSign(),
      },
    };
  }

  onlineCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.lastStatus !== 'offline') n++;
    return n;
  }

  toSnapshot(now = Date.now(), version = '1.0.0'): OfficeSnapshot {
    const online = [...this.members.values()]
      .filter((m) => m.lastStatus !== 'offline')
      .sort((a, b) => a.joinedAt - b.joinedAt);

    const primary = online.filter((m) => !m.ownerId);
    const DESKS_PER_ROOM = 6;
    const roomCount = Math.max(1, Math.ceil(primary.length / DESKS_PER_ROOM));
    const rooms: RoomInfo[] = [];
    for (let i = 0; i < roomCount; i++) {
      rooms.push({
        id: i === 0 ? 'office-main' : `office-${i + 1}`,
        name: i === 0 ? '办公区' : `办公区 ${i + 1}`,
        path: i === 0 ? '/office' : `/office-${i + 1}`,
        slot: i,
        seed: 42 + i * 17,
        createdAt: this.startedAt,
      });
    }

    const ownerRoomById = new Map<string, string>();
    primary.forEach((m, idx) => {
      const roomIdx = Math.floor(idx / DESKS_PER_ROOM);
      ownerRoomById.set(m.id, rooms[roomIdx]?.id ?? 'office-main');
    });

    const agents: AgentInfo[] = online.map((m) => {
      const roomId = m.ownerId
        ? (ownerRoomById.get(m.ownerId) ?? rooms[0].id)
        : (ownerRoomById.get(m.id) ?? rooms[0].id);
      const status: AgentStatus = m.lastStatus === 'offline' ? 'idle' : m.lastStatus;
      const pet = m.avatarMode === 'pet' && m.petId ? this.pets.getPet(m.petId) : undefined;
      const act = statusActivity(status === 'working' ? 'working' : status === 'waiting' ? 'waiting' : 'idle', m.statusSince);
      return {
        id: m.id,
        kind: 'main',
        roomId,
        name: m.name,
        look: m.look,
        role: m.role,
        sessionId: m.id,
        account: 'party',
        status,
        ...(status === 'waiting' ? { waitingFor: '等待用户确认' } : {}),
        activity: act,
        recent: [act],
        tasks: [],
        startedAt: m.joinedAt,
        lastEventAt: m.lastSeenAt,
        statusSince: m.statusSince,
        stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
        seed: m.seed,
        ...(m.parts ? { parts: m.parts } : {}),
        ...(m.custom ? { custom: true as const } : {}),
        ...(pet ? { pet } : {}),
        ...(m.ownerId ? { ownerId: m.ownerId } : {}),
        ...(m.agentTool ? { agentTool: m.agentTool } : {}),
      };
    });

    return {
      rev: this.rev,
      serverTime: now,
      rooms,
      agents,
      accounts: [],
      meta: {
        demo: false,
        sources: [],
        startedAt: this.startedAt,
        version,
        receptionSign: this.getReceptionSign(),
        terminal: false,
      },
    };
  }
}
