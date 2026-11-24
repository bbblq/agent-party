import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentPetInfo, CodexV2Spec, CodexV2StateSpec } from '../../shared/types';
import type { PokemonService } from './pokemon';

export const MAX_PET_SPRITE_BYTES = 10 * 1024 * 1024;

export interface PetCatalogItem extends AgentPetInfo {
  description?: string;
  source: 'builtin' | 'uploaded' | 'local';
}

interface InternalPetRecord {
  item: PetCatalogItem;
  spritePath: string;
  contentType: 'image/webp' | 'image/png';
}

const DEFAULT_STATES: Record<string, CodexV2StateSpec> = {
  idle: { row: 0, columns: 6, frameDuration: 800 },
  'running-right': { row: 1, columns: 8, frameDuration: 130 },
  'running-left': { row: 2, columns: 8, frameDuration: 130 },
  waving: { row: 3, columns: 4, frameDuration: 160 },
  jumping: { row: 4, columns: 5, frameDuration: 150 },
  failed: { row: 5, columns: 8, frameDuration: 150 },
  waiting: { row: 6, columns: 6, frameDuration: 160 },
  running: { row: 7, columns: 6, frameDuration: 130 },
  review: { row: 8, columns: 6, frameDuration: 160 },
};

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
const PMD_ID_RE = /^pmd:(\d{4})$/i;

export function sanitizePetId(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (PMD_ID_RE.test(trimmed)) return trimmed;
  if (!SAFE_ID_RE.test(trimmed)) return null;
  return trimmed;
}

function readFileHead(filePath: string, bytes = 64): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function detectSpriteMime(buf: Buffer): 'image/webp' | 'image/png' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function readSpriteDimensions(buf: Buffer): { width: number; height: number } | null {
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (
    buf.length >= 30 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const chunk = buf.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') {
      const width = 1 + buf.readUIntLE(24, 3);
      const height = 1 + buf.readUIntLE(27, 3);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8L' && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }

  return null;
}

export function normalizeCodexSpec(raw: unknown): CodexV2Spec {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const frameWidth = typeof obj.frameWidth === 'number' && obj.frameWidth > 0 ? Math.round(obj.frameWidth) : 192;
  const frameHeight = typeof obj.frameHeight === 'number' && obj.frameHeight > 0 ? Math.round(obj.frameHeight) : 208;
  const gridColumns = typeof obj.gridColumns === 'number' && obj.gridColumns > 0 ? Math.round(obj.gridColumns) : 8;
  const gridRows = typeof obj.gridRows === 'number' && obj.gridRows > 0 ? Math.round(obj.gridRows) : 11;

  const states: Partial<Record<string, CodexV2StateSpec>> = { ...DEFAULT_STATES };
  if (obj.states && typeof obj.states === 'object') {
    for (const [k, v] of Object.entries(obj.states as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const sv = v as Record<string, unknown>;
      if (typeof sv.row === 'number' && typeof sv.columns === 'number' && sv.row >= 0 && sv.columns > 0) {
        let frameDuration: number | number[] = 160;
        if (typeof sv.frameDuration === 'number' && sv.frameDuration > 0) {
          frameDuration = sv.frameDuration;
        } else if (Array.isArray(sv.frameDuration) && sv.frameDuration.length > 0) {
          const nums = sv.frameDuration.filter((n): n is number => typeof n === 'number' && n > 0);
          if (nums.length > 0) frameDuration = nums;
        }
        states[k] = {
          row: Math.round(sv.row),
          columns: Math.round(sv.columns),
          frameDuration,
        };
      }
    }
  }

  return { frameWidth, frameHeight, gridColumns, gridRows, states };
}

export class PetRegistry {
  private readonly uploadedDir: string;
  private readonly defaultPetsDir: string | null;
  private readonly localCodexDir: string | null;
  private readonly pokemon: PokemonService | null;
  private cache = new Map<string, InternalPetRecord>();

  constructor(
    dataDir: string,
    localCodexDir?: string | null,
    pokemon?: PokemonService | null,
    defaultPetsDir?: string | null,
  ) {
    this.uploadedDir = join(dataDir, 'pets');
    mkdirSync(this.uploadedDir, { recursive: true });
    this.pokemon = pokemon ?? null;
    this.defaultPetsDir = defaultPetsDir ?? null;
    if (localCodexDir === null) {
      this.localCodexDir = null;
    } else if (localCodexDir !== undefined) {
      this.localCodexDir = localCodexDir;
    } else {
      const enabled = process.env.AUTO_IMPORT_CODEX_PETS === '1';
      this.localCodexDir = enabled ? join(homedir(), '.codex', 'pets') : null;
    }
    this.refresh();
  }

  refresh(): void {
    const next = new Map<string, InternalPetRecord>();
    if (this.defaultPetsDir && existsSync(this.defaultPetsDir)) {
      this.scanDir(this.defaultPetsDir, 'builtin', next);
    }
    if (this.localCodexDir && existsSync(this.localCodexDir)) {
      this.scanDir(this.localCodexDir, 'local', next);
    }
    if (existsSync(this.uploadedDir)) {
      this.scanDir(this.uploadedDir, 'uploaded', next);
    }
    this.cache = next;
  }

  private scanDir(dir: string, source: 'builtin' | 'uploaded' | 'local', target: Map<string, InternalPetRecord>): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const id = sanitizePetId(entry);
      if (!id) continue;
      const folder = join(dir, entry);
      try {
        if (!statSync(folder).isDirectory()) continue;
      } catch {
        continue;
      }

      const jsonPath = join(folder, 'pet.json');
      let parsed: Record<string, unknown> = {};
      if (existsSync(jsonPath)) {
        try {
          parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      }

      const preferred = typeof parsed.spritesheetPath === 'string' ? parsed.spritesheetPath : '';
      const candidates = [preferred, 'spritesheet.webp', 'spritesheet.png'].filter(Boolean);
      let spritePath: string | null = null;
      let contentType: 'image/webp' | 'image/png' = 'image/webp';
      let dims: { width: number; height: number } | null = null;
      for (const rel of candidates) {
        if (rel.includes('..') || rel.includes('/') || rel.includes('\\')) continue;
        const full = join(folder, rel);
        if (existsSync(full)) {
          try {
            const st = statSync(full);
            if (!st.isFile() || st.size <= 0 || st.size > MAX_PET_SPRITE_BYTES) continue;
            const head = readFileHead(full, 64);
            const mime = detectSpriteMime(head);
            if (!mime) continue;
            spritePath = full;
            contentType = mime;
            dims = readSpriteDimensions(head);
            break;
          } catch {
            continue;
          }
        }
      }
      if (!spritePath) continue;

      let mtime = 1;
      try {
        mtime = Math.floor(statSync(spritePath).mtimeMs);
      } catch {
        mtime = 1;
      }

      const displayName =
        (typeof parsed.displayName === 'string' && parsed.displayName.trim()) ||
        (typeof parsed.name === 'string' && parsed.name.trim()) ||
        id;
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : undefined;
      const spec = normalizeCodexSpec(parsed);
      const row9 = spec.states?.['look_directions_1_8']?.row ?? 9;
      const row10 = spec.states?.['look_directions_9_16']?.row ?? 10;
      if (dims) {
        const actualRows = Math.floor(dims.height / spec.frameHeight);
        if (actualRows > 0) spec.gridRows = Math.min(spec.gridRows, actualRows);
      }
      const isPmdSheet =
        (typeof parsed.author === 'string' && /pmdcollab|spritecollab/i.test(parsed.author)) ||
        (typeof parsed.description === 'string' && /pmdcollab|spritecollab/i.test(parsed.description));
      let hasBackView = false;
      if (typeof parsed.hasBackView === 'boolean') {
        hasBackView = parsed.hasBackView;
      } else if (isPmdSheet) {
        if (dims) {
          const actualRows = Math.floor(dims.height / spec.frameHeight);
          const actualCols = Math.floor(dims.width / spec.frameWidth);
          hasBackView = actualRows > Math.max(row9, row10) && actualCols >= 8;
        } else {
          const hasGazeState = !!(spec.states?.['look_directions_1_8'] && spec.states?.['look_directions_9_16']);
          hasBackView = spec.gridRows >= 11 && hasGazeState;
        }
      }

      target.set(id, {
        item: {
          id,
          displayName: displayName.slice(0, 60),
          ...(description ? { description: description.slice(0, 200) } : {}),
          spriteUrl: `/api/pets/${encodeURIComponent(id)}/sprite?v=${mtime}`,
          hasBackView,
          spec,
          source,
        },
        spritePath,
        contentType,
      });
    }
  }

  listPets(): PetCatalogItem[] {
    return [...this.cache.values()]
      .map((r) => r.item)
      .sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id, 'zh-CN'));
  }

  getPet(id: string | null | undefined): AgentPetInfo | undefined {
    if (!id) return undefined;
    const clean = sanitizePetId(id);
    if (!clean) return undefined;
    if (clean.startsWith('pmd:') && this.pokemon) {
      return this.pokemon.getCachedPet(clean);
    }
    const rec = this.cache.get(clean);
    if (!rec) return undefined;
    const { id: petId, displayName, spriteUrl, hasBackView, spec } = rec.item;
    return { id: petId, displayName, kind: 'codex-v2', spriteUrl, ...(hasBackView !== undefined ? { hasBackView } : {}), spec };
  }

  getPetSource(rawId: string | null | undefined): 'builtin' | 'uploaded' | 'local' | 'pmd' | undefined {
    if (!rawId) return undefined;
    const clean = sanitizePetId(rawId);
    if (!clean) return undefined;
    if (PMD_ID_RE.test(clean)) return 'pmd';
    return this.cache.get(clean)?.item.source;
  }

  getPetSpriteFile(id: string): { filePath: string; contentType: 'image/webp' | 'image/png' } | null {
    const clean = sanitizePetId(id);
    if (!clean) return null;
    const rec = this.cache.get(clean);
    if (!rec) return null;
    return { filePath: rec.spritePath, contentType: rec.contentType };
  }

  saveUploadedPet(input: {
    petId: string;
    displayName?: string;
    petJsonRaw?: string | Buffer;
    spriteBuffer: Buffer;
  }): PetCatalogItem {
    const id = sanitizePetId(input.petId);
    if (!id || id.startsWith('pmd:')) throw new Error('Invalid petId: use 1-48 chars of a-z, 0-9, -, _.');
    if (!input.spriteBuffer.length) throw new Error('Empty sprite file.');
    if (input.spriteBuffer.length > MAX_PET_SPRITE_BYTES) {
      throw new Error('Sprite file exceeds 10MB limit.');
    }

    const mime = detectSpriteMime(input.spriteBuffer);
    if (!mime) {
      throw new Error('Unsupported sprite format: expected valid WebP or PNG image.');
    }

    let parsedMeta: Record<string, unknown> = {};
    if (input.petJsonRaw) {
      try {
        const text = Buffer.isBuffer(input.petJsonRaw) ? input.petJsonRaw.toString('utf8') : input.petJsonRaw;
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object') parsedMeta = obj as Record<string, unknown>;
      } catch {
        throw new Error('Invalid pet.json: must be valid JSON.');
      }
    }

    const ext = mime === 'image/png' ? 'png' : 'webp';
    const spriteFilename = `spritesheet.${ext}`;
    const folder = join(this.uploadedDir, id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, spriteFilename), input.spriteBuffer);

    const spec = normalizeCodexSpec(parsedMeta);
    const displayName =
      (input.displayName && input.displayName.trim()) ||
      (typeof parsedMeta.displayName === 'string' && parsedMeta.displayName.trim()) ||
      (typeof parsedMeta.name === 'string' && parsedMeta.name.trim()) ||
      id;

    const savedMeta = {
      ...parsedMeta,
      id,
      petId: id,
      displayName: displayName.slice(0, 60),
      spritesheetPath: spriteFilename,
      spriteVersionNumber: 2,
      frameWidth: spec.frameWidth,
      frameHeight: spec.frameHeight,
      gridColumns: spec.gridColumns,
      gridRows: spec.gridRows,
      states: spec.states,
    };
    writeFileSync(join(folder, 'pet.json'), JSON.stringify(savedMeta, null, 2), 'utf8');

    this.refresh();
    const rec = this.cache.get(id);
    if (!rec) throw new Error('Failed to register uploaded pet.');
    return rec.item;
  }
}
