import { FURNITURE, type Dir, type FloorKind, type FurnitureKind, type WallPattern, type WallStyle } from '../../client/src/art/api';
import type { AreaKind, ExteriorProp, SpotKind } from '../../client/src/world/layout/types';
import {
  DEFAULT_MAP_H,
  DEFAULT_MAP_W,
  MAP_FORMAT,
  MAX_MAP_ITEMS,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  type CustomFurnitureItem,
  type CustomMapDocument,
  type CustomRug,
  type CustomSpawnPoint,
  type CustomSpotOverride,
  type CustomWallBlock,
  type CustomWallItem,
  type CustomZone,
  type FloorPaletteEntry,
} from './types';

const VALID_FLOORS = new Set<FloorKind>([
  'carpet',
  'wood',
  'tile_check',
  'tile_white',
  'concrete',
  'marble',
  'grass',
  'sidewalk',
  'street',
]);

const VALID_AREA_KINDS = new Set<AreaKind>([
  'reception',
  'restroom',
  'cafe',
  'lounge',
  'arena',
  'room',
  'corridor',
]);

const VALID_WALL_PATTERNS = new Set<WallPattern>([
  'plain',
  'stripes',
  'tiles',
  'wood_panel',
  'brick',
  'glass',
  'marble',
]);

const VALID_DIRS = new Set<Dir>(['up', 'down', 'left', 'right']);

const VALID_PROP_KINDS = new Set<ExteriorProp['kind']>([
  'tree',
  'pine',
  'bush',
  'flowers',
  'lamp',
  'bench',
  'rock',
  'hedge',
  'parasol',
  'totem',
  'paving',
]);

const VALID_SPOT_KINDS = new Set<SpotKind>([
  'desk',
  'stool',
  'nook',
  'stand',
  'switch',
  'whiteboard',
  'coffee',
  'water',
  'snack',
  'fridge',
  'cafe_seat',
  'sofa',
  'armchair',
  'beanbag',
  'bench',
  'pingpong',
  'arcade',
  'shelf',
  'window',
  'stall',
  'sink',
  'elevator',
  'talk',
  'watch',
  'arena_fight',
  'arena_watch',
  'spawn',
]);

export function clampMapDim(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, Math.round(n)));
}

export function isWalkableFloorKind(kind: FloorKind): boolean {
  return kind !== 'grass' && kind !== 'street';
}

/** Encode a row-major Uint16Array of palette indices into compact RLE strings. */
export function encodeFloorRows(data: Uint16Array, width: number, height: number): string[] {
  const rows: string[] = new Array(height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    const parts: string[] = [];
    let cur = data[base] ?? 0;
    let run = 1;
    for (let x = 1; x < width; x++) {
      const v = data[base + x] ?? 0;
      if (v === cur) {
        run++;
      } else {
        parts.push(run > 1 ? `${run}*${cur}` : String(cur));
        cur = v;
        run = 1;
      }
    }
    parts.push(run > 1 ? `${run}*${cur}` : String(cur));
    rows[y] = parts.join(',');
  }
  return rows;
}

/** Decode RLE floorRows into a flat Uint16Array(width * height). */
export function decodeFloorRows(rows: readonly string[], width: number, height: number, paletteLen: number): Uint16Array {
  if (rows.length !== height) {
    throw new Error(`floorRows length (${rows.length}) does not match map height (${height})`);
  }
  const out = new Uint16Array(width * height);
  const maxIdx = Math.max(0, paletteLen - 1);
  for (let y = 0; y < height; y++) {
    const line = rows[y];
    if (typeof line !== 'string' || !line.trim()) {
      throw new Error(`floorRows[${y}] is empty`);
    }
    let col = 0;
    const segs = line.split(',');
    for (const seg of segs) {
      const star = seg.indexOf('*');
      let run = 1;
      let val = 0;
      if (star >= 0) {
        run = Number(seg.slice(0, star));
        val = Number(seg.slice(star + 1));
      } else {
        val = Number(seg);
      }
      if (!Number.isInteger(run) || run <= 0 || run > width || !Number.isInteger(val) || val < 0 || val > maxIdx) {
        throw new Error(`Invalid RLE token "${seg}" at row ${y}`);
      }
      if (col + run > width) {
        throw new Error(`Row ${y} exceeds map width (${col + run} > ${width})`);
      }
      const base = y * width + col;
      out.fill(val, base, base + run);
      col += run;
    }
    if (col !== width) {
      throw new Error(`Row ${y} decoded ${col} tiles, expected ${width}`);
    }
  }
  return out;
}

/** Mutable tile buffer helper for map creation, brushes, and MCP mutations. */
export class FloorGridBuffer {
  readonly palette: FloorPaletteEntry[];
  readonly data: Uint16Array;

  constructor(
    readonly width: number,
    readonly height: number,
    palette: readonly FloorPaletteEntry[],
    data?: Uint16Array,
  ) {
    this.palette = palette.length ? palette.map((p) => ({ ...p })) : [{ kind: 'grass' }];
    this.data = data && data.length === width * height ? new Uint16Array(data) : new Uint16Array(width * height);
  }

  static fromDocument(doc: CustomMapDocument): FloorGridBuffer {
    const data = decodeFloorRows(doc.floorRows, doc.width, doc.height, doc.floorPalette.length);
    return new FloorGridBuffer(doc.width, doc.height, doc.floorPalette, data);
  }

  ensurePaletteIndex(entry: FloorPaletteEntry): number {
    const idx = this.palette.findIndex(
      (p) => p.kind === entry.kind && (p.tint ?? '') === (entry.tint ?? '') && (p.tint2 ?? '') === (entry.tint2 ?? ''),
    );
    if (idx >= 0) return idx;
    this.palette.push({
      kind: entry.kind,
      ...(entry.tint ? { tint: entry.tint } : {}),
      ...(entry.tint2 ? { tint2: entry.tint2 } : {}),
    });
    return this.palette.length - 1;
  }

  getIndex(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x] ?? 0;
  }

  getEntry(x: number, y: number): FloorPaletteEntry {
    return this.palette[this.getIndex(x, y)] ?? this.palette[0];
  }

  set(x: number, y: number, paletteIdx: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = paletteIdx;
  }

  fillRect(x: number, y: number, w: number, h: number, entry: FloorPaletteEntry): void {
    const idx = this.ensurePaletteIndex(entry);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.width;
      for (let xx = x0; xx < x1; xx++) {
        this.data[row + xx] = idx;
      }
    }
  }

  toRows(): string[] {
    return encodeFloorRows(this.data, this.width, this.height);
  }
}

export function cloneCustomMap(doc: CustomMapDocument): CustomMapDocument {
  return structuredClone(doc);
}

export function resizeCustomMap(
  doc: CustomMapDocument,
  nextWidth: number,
  nextHeight: number,
  offsetX = 0,
  offsetY = 0,
): CustomMapDocument {
  const w = clampMapDim(nextWidth, doc.width);
  const h = clampMapDim(nextHeight, doc.height);
  const ox = Math.round(offsetX);
  const oy = Math.round(offsetY);

  const src = FloorGridBuffer.fromDocument(doc);
  const dst = new FloorGridBuffer(w, h, src.palette);
  for (let y = 0; y < src.height; y++) {
    const ny = y + oy;
    if (ny < 0 || ny >= h) continue;
    for (let x = 0; x < src.width; x++) {
      const nx = x + ox;
      if (nx < 0 || nx >= w) continue;
      dst.set(nx, ny, src.getIndex(x, y));
    }
  }

  const inCanvas = (tx: number, ty: number, iw = 1, ih = 1) =>
    tx + iw > 0 && ty + ih > 0 && tx < w && ty < h;

  return {
    ...cloneCustomMap(doc),
    width: w,
    height: h,
    updatedAt: Date.now(),
    floorPalette: dst.palette,
    floorRows: dst.toRows(),
    rugs: doc.rugs
      .map((r) => ({ ...r, x: r.x + ox, y: r.y + oy }))
      .filter((r) => inCanvas(r.x, r.y, r.w, r.h)),
    walls: doc.walls
      .map((b) => ({ ...b, tx: b.tx + ox, ty: b.ty + oy }))
      .filter((b) => inCanvas(b.tx, b.ty, b.w, b.h)),
    wallItems: doc.wallItems
      .map((it) => ({ ...it, tx: it.tx + ox, ty: it.ty + oy }))
      .filter((it) => it.tx >= 0 && it.ty >= 0 && it.tx <= w && it.ty <= h),
    furniture: doc.furniture
      .map((f) => ({ ...f, tx: f.tx + ox, ty: f.ty + oy }))
      .filter((f) => {
        const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
        return f.tx >= 0 && f.ty >= 0 && f.tx + fp.w <= w && f.ty + fp.h <= h;
      }),
    zones: doc.zones
      .map((z) => {
        const x0 = Math.max(0, z.rect.x + ox);
        const y0 = Math.max(0, z.rect.y + oy);
        const x1 = Math.min(w, z.rect.x + ox + z.rect.w);
        const y1 = Math.min(h, z.rect.y + oy + z.rect.h);
        return { ...z, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
      })
      .filter((z) => z.rect.w > 0 && z.rect.h > 0),
    props: doc.props
      .map((p) => ({ ...p, x: p.x + ox * 16, y: p.y + oy * 16 }))
      .filter((p) => p.x >= -16 * 16 && p.y >= -16 * 16 && p.x <= (w + 16) * 16 && p.y <= (h + 16) * 16),
    spawns: doc.spawns
      .map((s) => ({ ...s, tx: s.tx + ox, ty: s.ty + oy }))
      .filter((s) => s.tx >= 0 && s.ty >= 0 && s.tx < w && s.ty < h),
    ...(doc.spots
      ? {
          spots: doc.spots
            .map((s) => ({ ...s, tx: s.tx + ox, ty: s.ty + oy }))
            .filter((s) => s.tx >= 0 && s.ty >= 0 && s.tx < w && s.ty < h),
        }
      : {}),
  };
}

function cleanStr(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\r\n\t]+/g, ' ').trim();
  return s ? s.slice(0, maxLen) : undefined;
}

function sanitizeWallStyle(raw: unknown): WallStyle {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const base = typeof o.base === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.base.trim()) ? o.base.trim() : '#e6e2da';
  const trim = typeof o.trim === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.trim.trim()) ? o.trim.trim() : undefined;
  const pattern = VALID_WALL_PATTERNS.has(o.pattern as WallPattern) ? (o.pattern as WallPattern) : 'plain';
  return {
    base,
    ...(trim ? { trim } : {}),
    pattern,
    ...(o.exterior === true ? { exterior: true } : {}),
  };
}

export function parseCustomMapJson(raw: unknown): { ok: true; doc: CustomMapDocument } | { ok: false; error: string } {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'Map payload must be a JSON object.' };
  }
  const r = obj as Record<string, unknown>;
  if (r.format !== MAP_FORMAT) {
    return { ok: false, error: `Unsupported map format: expected "${MAP_FORMAT}".` };
  }
  const width = Number(r.width ?? DEFAULT_MAP_W);
  const height = Number(r.height ?? DEFAULT_MAP_H);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_MAP_SIZE || height < MIN_MAP_SIZE || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE) {
    return { ok: false, error: `Map dimensions must be integers between ${MIN_MAP_SIZE} and ${MAX_MAP_SIZE} (got ${r.width}×${r.height}).` };
  }

  const rawPalette = Array.isArray(r.floorPalette) ? r.floorPalette : [];
  if (!rawPalette.length || rawPalette.length > 256) {
    return { ok: false, error: 'floorPalette must contain 1..256 entries.' };
  }
  const floorPalette: FloorPaletteEntry[] = [];
  for (let i = 0; i < rawPalette.length; i++) {
    const p = rawPalette[i];
    if (!p || typeof p !== 'object') return { ok: false, error: `Invalid floorPalette[${i}].` };
    const po = p as Record<string, unknown>;
    if (!VALID_FLOORS.has(po.kind as FloorKind)) {
      return { ok: false, error: `Invalid FloorKind "${String(po.kind)}" in floorPalette[${i}].` };
    }
    floorPalette.push({
      kind: po.kind as FloorKind,
      ...(typeof po.tint === 'string' && po.tint.trim() ? { tint: po.tint.trim().slice(0, 24) } : {}),
      ...(typeof po.tint2 === 'string' && po.tint2.trim() ? { tint2: po.tint2.trim().slice(0, 24) } : {}),
    });
  }

  if (!Array.isArray(r.floorRows)) {
    return { ok: false, error: 'Missing floorRows array.' };
  }
  try {
    decodeFloorRows(r.floorRows as string[], width, height, floorPalette.length);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const id = cleanStr(r.id, 64) || `map-${Date.now().toString(36)}`;
  const name = cleanStr(r.name, 48) || '自定义办公地图';
  const author = cleanStr(r.author, 32);
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : Date.now();
  const backgroundFloor = VALID_FLOORS.has(r.backgroundFloor as FloorKind) ? (r.backgroundFloor as FloorKind) : 'grass';

  const rugs: CustomRug[] = [];
  if (Array.isArray(r.rugs)) {
    for (const it of r.rugs.slice(0, MAX_MAP_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const x = Number(o.x);
      const y = Number(o.y);
      const w = Number(o.w);
      const h = Number(o.h);
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      rugs.push({
        id: cleanStr(o.id, 64) || `rug-${rugs.length}`,
        x,
        y,
        w,
        h,
        color: typeof o.color === 'string' && o.color.trim() ? o.color.trim().slice(0, 24) : '#5b7fa6',
        ...(typeof o.seed === 'number' && Number.isFinite(o.seed) ? { seed: Math.floor(o.seed) } : {}),
      });
    }
  }

  const walls: CustomWallBlock[] = [];
  if (Array.isArray(r.walls)) {
    for (const it of r.walls.slice(0, MAX_MAP_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      if (o.kind !== 'face' && o.kind !== 'south' && o.kind !== 'cap') continue;
      const tx = Number(o.tx);
      const ty = Number(o.ty);
      const w = Number(o.w);
      const h = Number(o.h ?? (o.kind === 'face' ? 2 : 1));
      if (![tx, ty, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      const doorways = Array.isArray(o.doorways)
        ? o.doorways
            .map((d) => {
              if (!d || typeof d !== 'object') return null;
              const dd = d as Record<string, unknown>;
              const offset = Number(dd.offset);
              const dw = Number(dd.w);
              if (!Number.isFinite(offset) || !Number.isFinite(dw) || dw <= 0) return null;
              return { offset, w: dw };
            })
            .filter((d): d is { offset: number; w: number } => !!d)
        : undefined;
      walls.push({
        id: cleanStr(o.id, 64) || `wall-${walls.length}`,
        kind: o.kind,
        tx,
        ty,
        w,
        h,
        style: sanitizeWallStyle(o.style),
        ...(doorways && doorways.length ? { doorways } : {}),
      });
    }
  }

  const furniture: CustomFurnitureItem[] = [];
  if (Array.isArray(r.furniture)) {
    for (const it of r.furniture.slice(0, MAX_MAP_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const kind = o.kind as FurnitureKind;
      const def = Object.hasOwn(FURNITURE, kind) ? FURNITURE[kind] : undefined;
      if (!def || def.mount !== 'floor') continue;
      const tx = Number(o.tx);
      const ty = Number(o.ty);
      if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx + def.footprint.w > width || ty + def.footprint.h > height) {
        continue;
      }
      furniture.push({
        id: cleanStr(o.id, 64) || `f-${furniture.length}`,
        kind,
        tx,
        ty,
        ...(typeof o.variant === 'string' && o.variant.trim() ? { variant: o.variant.trim().slice(0, 24) } : {}),
        ...(typeof o.dx === 'number' && Number.isFinite(o.dx) ? { dx: o.dx } : {}),
        ...(typeof o.dy === 'number' && Number.isFinite(o.dy) ? { dy: o.dy } : {}),
        ...(VALID_DIRS.has(o.dir as Dir) ? { dir: o.dir as Dir } : {}),
        ...(cleanStr(o.seat, 16) ? { seat: cleanStr(o.seat, 16) } : {}),
        ...(cleanStr(o.deskId, 64) ? { deskId: cleanStr(o.deskId, 64) } : {}),
        ...(cleanStr(o.reservedFor, 64) ? { reservedFor: cleanStr(o.reservedFor, 64) } : {}),
        ...(Array.isArray(o.tags) ? { tags: o.tags.map((t) => cleanStr(t, 24)).filter((t): t is string => !!t) } : {}),
      });
    }
  }

  const wallItems: CustomWallItem[] = [];
  if (Array.isArray(r.wallItems)) {
    for (const it of r.wallItems.slice(0, MAX_MAP_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const kind = o.kind as FurnitureKind;
      const def = Object.hasOwn(FURNITURE, kind) ? FURNITURE[kind] : undefined;
      if (!def || def.mount !== 'wall') continue;
      const tx = Number(o.tx);
      const ty = Number(o.ty);
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || ty < 0 || tx > width || ty > height) continue;
      wallItems.push({
        id: cleanStr(o.id, 64) || `w-${wallItems.length}`,
        kind,
        tx,
        ty,
        on: o.on === 'south' ? 'south' : 'face',
        ...(typeof o.variant === 'string' && o.variant.trim() ? { variant: o.variant.trim().slice(0, 24) } : {}),
        ...(cleanStr(o.zoneId, 64) ? { zoneId: cleanStr(o.zoneId, 64) } : {}),
      });
    }
  }

  const zones: CustomZone[] = [];
  if (Array.isArray(r.zones)) {
    for (const it of r.zones.slice(0, 512)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const rectRaw = o.rect && typeof o.rect === 'object' ? (o.rect as Record<string, unknown>) : null;
      if (!rectRaw) continue;
      const x = Math.max(0, Math.floor(Number(rectRaw.x)));
      const y = Math.max(0, Math.floor(Number(rectRaw.y)));
      const w = Math.min(width - x, Math.floor(Number(rectRaw.w)));
      const h = Math.min(height - y, Math.floor(Number(rectRaw.h)));
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      const kind = VALID_AREA_KINDS.has(o.kind as AreaKind) ? (o.kind as AreaKind) : 'room';
      zones.push({
        id: cleanStr(o.id, 64) || `zone-${zones.length}`,
        name: cleanStr(o.name, 40) || `区域 ${zones.length + 1}`,
        kind,
        rect: { x, y, w, h },
        ...(typeof o.accentColor === 'string' && o.accentColor.trim() ? { accentColor: o.accentColor.trim().slice(0, 24) } : {}),
        ...(typeof o.floorTint === 'string' && o.floorTint.trim() ? { floorTint: o.floorTint.trim().slice(0, 24) } : {}),
        ...(typeof o.hasLightSwitch === 'boolean' ? { hasLightSwitch: o.hasLightSwitch } : {}),
        ...(Array.isArray(o.tags) ? { tags: o.tags.map((t) => cleanStr(t, 24)).filter((t): t is string => !!t) } : {}),
      });
    }
  }

  const props: ExteriorProp[] = [];
  if (Array.isArray(r.props)) {
    for (const it of r.props.slice(0, MAX_MAP_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      if (!VALID_PROP_KINDS.has(o.kind as ExteriorProp['kind'])) continue;
      const x = Number(o.x);
      const y = Number(o.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      props.push({
        kind: o.kind as ExteriorProp['kind'],
        x,
        y,
        seed: typeof o.seed === 'number' && Number.isFinite(o.seed) ? Math.floor(o.seed) : props.length + 1,
      });
    }
  }

  const spawns: CustomSpawnPoint[] = [];
  if (Array.isArray(r.spawns)) {
    for (const it of r.spawns.slice(0, 128)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const tx = Math.floor(Number(o.tx));
      const ty = Math.floor(Number(o.ty));
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      spawns.push({
        id: cleanStr(o.id, 64) || `spawn-${spawns.length}`,
        tx,
        ty,
        ...(VALID_DIRS.has(o.dir as Dir) ? { dir: o.dir as Dir } : {}),
      });
    }
  }

  let spots: CustomSpotOverride[] | undefined;
  if (Array.isArray(r.spots)) {
    spots = [];
    for (const it of r.spots.slice(0, MAX_MAP_ITEMS)) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      if (!VALID_SPOT_KINDS.has(o.kind as SpotKind)) continue;
      const tx = Math.floor(Number(o.tx));
      const ty = Math.floor(Number(o.ty));
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      spots.push({
        id: cleanStr(o.id, 64) || `spot-${spots.length}`,
        kind: o.kind as SpotKind,
        ...(cleanStr(o.areaId, 64) ? { areaId: cleanStr(o.areaId, 64) } : {}),
        tx,
        ty,
        dir: VALID_DIRS.has(o.dir as Dir) ? (o.dir as Dir) : 'down',
        ...(typeof o.seated === 'boolean' ? { seated: o.seated } : {}),
        ...(cleanStr(o.furnitureId, 64) ? { furnitureId: cleanStr(o.furnitureId, 64) } : {}),
        ...(cleanStr(o.deskId, 64) ? { deskId: cleanStr(o.deskId, 64) } : {}),
        ...(cleanStr(o.group, 64) ? { group: cleanStr(o.group, 64) } : {}),
        ...(typeof o.rank === 'number' && Number.isFinite(o.rank) ? { rank: Math.floor(o.rank) } : {}),
        ...(cleanStr(o.reservedFor, 64) ? { reservedFor: cleanStr(o.reservedFor, 64) } : {}),
        ...(Array.isArray(o.tags) ? { tags: o.tags.map((t) => cleanStr(t, 24)).filter((t): t is string => !!t) } : {}),
      });
    }
  }

  return {
    ok: true,
    doc: {
      format: MAP_FORMAT,
      schemaVersion: 1,
      id,
      name,
      width,
      height,
      ...(author ? { author } : {}),
      updatedAt,
      backgroundFloor,
      floorPalette,
      floorRows: [...(r.floorRows as string[])],
      rugs,
      walls,
      wallItems,
      furniture,
      zones,
      props,
      spawns,
      ...(spots ? { spots } : {}),
    },
  };
}

export function serializeCustomMapJson(doc: CustomMapDocument, pretty = false): string {
  return JSON.stringify(doc, null, pretty ? 2 : undefined);
}
