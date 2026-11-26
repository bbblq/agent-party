import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentPetInfo, PmdAnimSpec, PokemonType } from '../../shared/types';
import rawPokedex from './pokemon-db.json';

const execFileAsync = promisify(execFile);

export const PMD_META_SCHEMA_VERSION = 2;

export interface PokemonEntry {
  id: number;
  dex: string;
  en: string;
  zh_hans?: string;
  zh_hant?: string;
  ja?: string;
  types?: PokemonType[];
}

export interface ParsedPmdAnim {
  name: string;
  frameWidth: number;
  frameHeight: number;
  durations: number[];
  rushFrame?: number;
  hitFrame?: number;
  returnFrame?: number;
}

export type EnsurePokemonResult =
  | { ok: true; pet: AgentPetInfo; pokemon: PokemonEntry }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_AVAILABLE' | 'FETCH_ERROR'; error: string; pokemon?: PokemonEntry };

const POKEDEX = rawPokedex as PokemonEntry[];
const SPRITE_MIRRORS = [
  process.env.SPRITECOLLAB_BASE_URL?.trim().replace(/\/+$/, ''),
  'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite',
  'https://cdn.jsdelivr.net/gh/PMDCollab/SpriteCollab@master/sprite',
].filter((v): v is string => !!v);

async function fetchRemoteBuffer(url: string): Promise<{ status: number; data: Buffer } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.status === 404) return { status: 404, data: Buffer.alloc(0) };
    if (res.ok) {
      return { status: res.status, data: Buffer.from(await res.arrayBuffer()) };
    }
  } catch {
    // Fall back to system curl (respects OS proxy such as Windows system proxy)
  }

  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-sS', '-L', '--max-time', '15', '-w', '\n%{http_code}', url],
      { encoding: 'buffer', maxBuffer: 15 * 1024 * 1024 },
    );
    const sep = stdout.lastIndexOf(0x0a);
    if (sep === -1) return null;
    const status = Number(stdout.subarray(sep + 1).toString('utf8').trim());
    const data = stdout.subarray(0, sep);
    if (!Number.isFinite(status) || status <= 0) return null;
    return { status, data };
  } catch {
    return null;
  }
}

async function fetchSpriteFile(dex: string, relPath: string): Promise<{ status: number; data: Buffer } | null> {
  let saw404 = false;
  for (const base of SPRITE_MIRRORS) {
    const res = await fetchRemoteBuffer(`${base}/${dex}/${relPath}`);
    if (!res) continue;
    if (res.status === 200 && res.data.length > 0) return res;
    if (res.status === 404) saw404 = true;
  }
  return saw404 ? { status: 404, data: Buffer.alloc(0) } : null;
}

export const POPULAR_DEX_IDS = [
  '0025', // 皮卡丘
  '0054', // 可达鸭
  '0094', // 耿鬼
  '0133', // 伊布
  '0143', // 卡比兽
  '0448', // 路卡利欧
  '0001', // 妙蛙种子
  '0004', // 小火龙
  '0007', // 杰尼龟
  '0039', // 胖丁
  '0150', // 超梦
  '0151', // 梦幻
] as const;

const SIGNATURE_WORK_ANIMS: Record<string, string[]> = {
  '0025': ['Shock', 'Attack', 'Charge'],
  '0039': ['Shoot', 'Attack', 'Charge'],
  '0054': ['Charge', 'Attack', 'Shoot'],
  '0094': ['Shoot', 'Attack', 'Charge'],
  '0001': ['Shoot', 'Attack', 'Charge'],
  '0004': ['Shoot', 'Attack', 'Charge'],
  '0007': ['Shoot', 'Attack', 'Charge'],
  '0133': ['Charge', 'Attack', 'Hop'],
  '0143': ['Slam', 'Attack', 'Charge'],
  '0150': ['Charge', 'Shoot', 'Attack'],
  '0151': ['Float', 'Charge', 'Attack'],
};

const SAFE_DEX_RE = /^\d{4}$/;
const SAFE_ANIM_FILE_RE = /^[A-Za-z]+-Anim\.png$/;

export function findPokemon(query: string): PokemonEntry | null {
  const raw = query.trim().toLowerCase().replace(/^pmd:/, '').replace(/^#/, '');
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    const byId = POKEDEX.find((p) => p.id === id);
    if (byId) return byId;
  }

  for (const p of POKEDEX) {
    if (
      p.zh_hans?.toLowerCase() === raw ||
      p.zh_hant?.toLowerCase() === raw ||
      p.en.toLowerCase() === raw ||
      p.ja?.toLowerCase() === raw
    ) {
      return p;
    }
  }

  for (const p of POKEDEX) {
    if (
      p.zh_hans?.toLowerCase().includes(raw) ||
      p.zh_hant?.toLowerCase().includes(raw) ||
      p.en.toLowerCase().includes(raw)
    ) {
      return p;
    }
  }

  return null;
}

export function searchPokemon(query = '', limit = 24): PokemonEntry[] {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) {
    const byDex = new Map(POKEDEX.map((p) => [p.dex, p]));
    return POPULAR_DEX_IDS.map((d) => byDex.get(d)).filter((p): p is PokemonEntry => !!p);
  }

  const out: PokemonEntry[] = [];
  const seen = new Set<number>();
  const isDigits = /^\d+$/.test(q);
  const numQ = isDigits ? Number(q) : -1;

  for (const p of POKEDEX) {
    if (
      (isDigits && (p.id === numQ || p.dex.includes(q))) ||
      p.zh_hans?.toLowerCase() === q ||
      p.zh_hant?.toLowerCase() === q ||
      p.en.toLowerCase() === q ||
      p.ja?.toLowerCase() === q
    ) {
      seen.add(p.id);
      out.push(p);
      if (out.length >= limit) return out;
    }
  }

  for (const p of POKEDEX) {
    if (seen.has(p.id)) continue;
    if (
      p.zh_hans?.toLowerCase().includes(q) ||
      p.zh_hant?.toLowerCase().includes(q) ||
      p.en.toLowerCase().includes(q) ||
      p.ja?.toLowerCase().includes(q)
    ) {
      seen.add(p.id);
      out.push(p);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

export function parseAnimDataXml(xml: string): Record<string, ParsedPmdAnim> {
  const anims: Record<string, ParsedPmdAnim> = {};
  const copies: Array<{ name: string; copyOf: string }> = [];

  const blocks = xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g);
  for (const m of blocks) {
    const body = m[1];
    const nameMatch = /<Name>\s*([^<]+?)\s*<\/Name>/.exec(body);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    const copyMatch = /<CopyOf>\s*([^<]+?)\s*<\/CopyOf>/.exec(body);
    if (copyMatch) {
      copies.push({ name, copyOf: copyMatch[1].trim() });
      continue;
    }

    const fwMatch = /<FrameWidth>\s*(\d+)\s*<\/FrameWidth>/.exec(body);
    const fhMatch = /<FrameHeight>\s*(\d+)\s*<\/FrameHeight>/.exec(body);
    if (!fwMatch || !fhMatch) continue;

    const frameWidth = Math.max(8, Number(fwMatch[1]));
    const frameHeight = Math.max(8, Number(fhMatch[1]));
    const rushMatch = /<RushFrame>\s*(\d+)\s*<\/RushFrame>/.exec(body);
    const hitMatch = /<HitFrame>\s*(\d+)\s*<\/HitFrame>/.exec(body);
    const returnMatch = /<ReturnFrame>\s*(\d+)\s*<\/ReturnFrame>/.exec(body);
    const durations: number[] = [];
    for (const dm of body.matchAll(/<Duration>\s*(\d+)\s*<\/Duration>/g)) {
      const ticks = Number(dm[1]);
      durations.push(Math.max(40, Math.round(ticks * 22)));
    }
    if (!durations.length) durations.push(160);

    anims[name] = {
      name,
      frameWidth,
      frameHeight,
      durations,
      ...(rushMatch ? { rushFrame: Number(rushMatch[1]) } : {}),
      ...(hitMatch ? { hitFrame: Number(hitMatch[1]) } : {}),
      ...(returnMatch ? { returnFrame: Number(returnMatch[1]) } : {}),
    };
  }

  for (const { name, copyOf } of copies) {
    const src = anims[copyOf];
    if (src) anims[name] = { ...src, name };
  }

  return anims;
}

function readPngHeight(buf: Buffer): number | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return buf.readUInt32BE(20);
}

const POKEDEX_BY_DEX = new Map(POKEDEX.map((p) => [p.dex, p]));
const ATTACK_ANIM_CANDIDATES = ['Attack', 'Strike', 'QuickStrike', 'Slam', 'Swing', 'Slice', 'MultiScratch', 'Punch', 'Kick'] as const;
const SHOOT_ANIM_CANDIDATES = ['Shoot', 'SpAttack', 'Emit', 'Beam', 'Shock'] as const;
const CHARGE_ANIM_CANDIDATES = ['Shock', 'Charge', 'Double', 'Rotate', 'Pose', 'Appeal', 'TailWhip', 'DeepBreath', 'Twirl'] as const;

export class PokemonService {
  private readonly dir: string;
  private readonly inflight = new Map<string, Promise<EnsurePokemonResult>>();
  private readonly upgrading = new Set<string>();
  private readonly upgradeListeners = new Set<(dex: string, pet: AgentPetInfo) => void>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'pokemon');
    mkdirSync(this.dir, { recursive: true });
  }

  onUpgrade(cb: (dex: string, pet: AgentPetInfo) => void): () => void {
    this.upgradeListeners.add(cb);
    return () => void this.upgradeListeners.delete(cb);
  }

  private scheduleBackgroundUpgrade(dex: string): void {
    if (process.env.VITEST === 'true' || this.upgrading.has(dex)) return;
    const entry = POKEDEX_BY_DEX.get(dex);
    if (!entry) return;
    this.upgrading.add(dex);
    void this.fetchAndCache(entry)
      .then((res) => {
        if (res.ok) {
          for (const cb of this.upgradeListeners) cb(dex, res.pet);
        }
      })
      .catch(() => {
        // Offline or unreachable: keep v1 cache intact
      })
      .finally(() => {
        this.upgrading.delete(dex);
      });
  }

  getCachedPet(idOrDex: string): AgentPetInfo | undefined {
    const dex = idOrDex.trim().replace(/^pmd:/i, '');
    if (!SAFE_DEX_RE.test(dex)) return undefined;
    const metaPath = join(this.dir, dex, 'pmd-meta.json');
    if (!existsSync(metaPath)) return undefined;
    try {
      const pet = JSON.parse(readFileSync(metaPath, 'utf8')) as AgentPetInfo;
      if (pet.hasBackView === undefined && pet.pmd) {
        pet.hasBackView = [pet.pmd.walk, pet.pmd.idle, pet.pmd.hop].some((a) => !!a && a.rows >= 5);
      }
      if (!pet.types?.length) {
        const entry = POKEDEX_BY_DEX.get(dex);
        if (entry?.types?.length) pet.types = entry.types;
      }
      if (pet.pmd && (pet.pmd.schemaVersion ?? 1) < PMD_META_SCHEMA_VERSION) {
        this.scheduleBackgroundUpgrade(dex);
      }
      return pet;
    } catch {
      return undefined;
    }
  }

  listCachedPets(): AgentPetInfo[] {
    if (!existsSync(this.dir)) return [];
    const out: AgentPetInfo[] = [];
    try {
      for (const entry of readdirSync(this.dir)) {
        const pet = this.getCachedPet(entry);
        if (pet) out.push(pet);
      }
    } catch {
      // ignore
    }
    return out;
  }

  getPngFile(dex: string, filename: string): string | null {
    if (!SAFE_DEX_RE.test(dex) || !SAFE_ANIM_FILE_RE.test(filename)) return null;
    const full = join(this.dir, dex, filename);
    return existsSync(full) ? full : null;
  }

  async ensurePokemonPet(query: string): Promise<EnsurePokemonResult> {
    const p = findPokemon(query);
    if (!p) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        error: `未在宝可梦图鉴中找到 "${query}"，请输入中文名、英文名或图鉴编号（如 皮卡丘 / Pikachu / 25）。`,
      };
    }

    const cached = this.getCachedPet(p.dex);
    if (cached) {
      return { ok: true, pet: cached, pokemon: p };
    }

    const existing = this.inflight.get(p.dex);
    if (existing) return existing;

    const task = this.fetchAndCache(p).finally(() => this.inflight.delete(p.dex));
    this.inflight.set(p.dex, task);
    return task;
  }

  private async fetchAndCache(p: PokemonEntry): Promise<EnsurePokemonResult> {
    if (!existsSync(this.dir)) {
      return { ok: false, code: 'FETCH_ERROR', pokemon: p, error: 'Pokemon cache directory unavailable' };
    }
    const folder = join(this.dir, p.dex);
    mkdirSync(folder, { recursive: true });

    let xml = '';
    const localXml = join(folder, 'AnimData.xml');
    if (existsSync(localXml)) {
      try {
        xml = readFileSync(localXml, 'utf8');
      } catch {
        xml = '';
      }
    }
    if (!xml) {
      const res = await fetchSpriteFile(p.dex, 'AnimData.xml');
      if (!res) {
        return {
          ok: false,
          code: 'FETCH_ERROR',
          pokemon: p,
          error: '下载宝可梦素材失败：无法连接 PMDCollab/SpriteCollab 素材库（请检查网络或代理设置）。',
        };
      }
      if (res.status === 404) {
        return {
          ok: false,
          code: 'NOT_AVAILABLE',
          pokemon: p,
          error: `【${p.zh_hans ?? p.en}】(#${p.dex}) 暂未收录在 PMDCollab/SpriteCollab 像素动作库中，换一只宝可梦试试吧！`,
        };
      }
      xml = res.data.toString('utf8');
      try {
        if (existsSync(folder)) writeFileSync(localXml, xml, 'utf8');
      } catch {
        // optional cache write
      }
    }

    const anims = parseAnimDataXml(xml);
    const workCandidates = SIGNATURE_WORK_ANIMS[p.dex] ?? ['Attack', 'Charge', 'Shoot', 'Strike', 'Hop'];
    const workName = workCandidates.find((name) => !!anims[name]);
    const sleepName = ['Sleep', 'EventSleep'].find((name) => !!anims[name]);
    const eatName = ['Eat', 'Pose'].find((name) => !!anims[name]);
    const attackName = ATTACK_ANIM_CANDIDATES.find((name) => !!anims[name]);
    const shootName = SHOOT_ANIM_CANDIDATES.find((name) => !!anims[name]);
    const chargeName =
      CHARGE_ANIM_CANDIDATES.find((name) => name !== shootName && !!anims[name]) ??
      CHARGE_ANIM_CANDIDATES.find((name) => !!anims[name]);
    const faintName = ['Faint'].find((name) => !!anims[name]);

    const animTasks = new Map<string, Promise<PmdAnimSpec | undefined>>();
    const buildAnim = (name: string): Promise<PmdAnimSpec | undefined> => {
      const cachedTask = animTasks.get(name);
      if (cachedTask) return cachedTask;
      const task = (async (): Promise<PmdAnimSpec | undefined> => {
        const info = anims[name];
        if (!info) return undefined;
        const filename = `${name}-Anim.png`;
        const localPath = join(folder, filename);
        let buf: Buffer;
        if (existsSync(localPath)) {
          buf = readFileSync(localPath);
        } else {
          const r = await fetchSpriteFile(p.dex, filename);
          if (!r || r.status !== 200 || !readPngHeight(r.data)) return undefined;
          buf = r.data;
          if (existsSync(folder)) writeFileSync(localPath, buf);
        }
        const imgH = readPngHeight(buf);
        if (!imgH) return undefined;
        const rows = Math.max(1, Math.round(imgH / info.frameHeight));
        return {
          url: `/api/pokemon/${p.dex}/${filename}`,
          frameWidth: info.frameWidth,
          frameHeight: info.frameHeight,
          frames: info.durations.length,
          durations: info.durations,
          rows,
          ...(info.rushFrame !== undefined ? { rushFrame: info.rushFrame } : {}),
          ...(info.hitFrame !== undefined ? { hitFrame: info.hitFrame } : {}),
          ...(info.returnFrame !== undefined ? { returnFrame: info.returnFrame } : {}),
        };
      })();
      animTasks.set(name, task);
      return task;
    };

    const [walk, idle, hop, hurt, sleep, eat, work, attack, shoot, charge, faint] = await Promise.all([
      buildAnim('Walk'),
      buildAnim('Idle'),
      buildAnim('Hop'),
      buildAnim('Hurt'),
      sleepName ? buildAnim(sleepName) : Promise.resolve(undefined),
      eatName ? buildAnim(eatName) : Promise.resolve(undefined),
      workName ? buildAnim(workName) : Promise.resolve(undefined),
      attackName ? buildAnim(attackName) : Promise.resolve(undefined),
      shootName ? buildAnim(shootName) : Promise.resolve(undefined),
      chargeName ? buildAnim(chargeName) : Promise.resolve(undefined),
      faintName ? buildAnim(faintName) : Promise.resolve(undefined),
    ]);

    const walkSpec = walk ?? idle ?? hop;
    if (!walkSpec) {
      return {
        ok: false,
        code: 'NOT_AVAILABLE',
        pokemon: p,
        error: `【${p.zh_hans ?? p.en}】缺少基础行走动画素材，请换一只宝可梦。`,
      };
    }

    const displayName = p.zh_hans ? `${p.zh_hans} (${p.en})` : p.en;
    const hasBackView = [walk, idle, hop].some((a) => !!a && a.rows >= 5);
    const pet: AgentPetInfo = {
      id: `pmd:${p.dex}`,
      displayName,
      kind: 'pmd',
      spriteUrl: (idle ?? walkSpec).url,
      hasBackView,
      ...(p.types?.length ? { types: p.types } : {}),
      pmd: {
        dex: p.dex,
        schemaVersion: PMD_META_SCHEMA_VERSION,
        walk: walkSpec,
        ...(idle ? { idle } : {}),
        ...(hop ? { hop } : {}),
        ...(sleep ? { sleep } : {}),
        ...(eat ? { eat } : {}),
        ...(work ? { work } : {}),
        ...(hurt ? { hurt } : {}),
        ...(attack ? { attack } : {}),
        ...(shoot ? { shoot } : {}),
        ...(charge ? { charge } : {}),
        ...(faint ? { faint } : {}),
      },
    };

    if (existsSync(folder)) {
      writeFileSync(join(folder, 'pmd-meta.json'), JSON.stringify(pet, null, 2), 'utf8');
    }
    return { ok: true, pet, pokemon: p };
  }
}
