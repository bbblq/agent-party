import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FURNITURE, type Dir, type FloorKind, type FurnitureKind, type WallStyle } from '../../client/src/art/api';
import { CORE_WALLS } from '../../client/src/world/layout/core';
import type { AreaKind, TileRect } from '../../client/src/world/layout/types';
import {
  DEFAULT_MAP_H,
  DEFAULT_MAP_W,
  FloorGridBuffer,
  MAX_MAP_ITEMS,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  buildCustomRoomWalls,
  clampMapDim,
  createStarterOfficeMap,
  parseCustomMapJson,
  resizeCustomMap,
  serializeCustomMapJson,
  validateMapPlayability,
  type CustomFurnitureItem,
  type CustomMapDocument,
  type CustomRug,
  type CustomSpawnPoint,
  type CustomWallBlock,
  type CustomWallItem,
  type CustomZone,
  type MapPresetSummary,
  type MapSelection,
  type MapValidationReport,
  type StudioMcpPresence,
  type StudioTaskBox,
  type StudioTaskSummary,
} from '../../shared/map';
import type { MapMode } from '../../shared/types';

export interface MapManifest {
  mode: MapMode;
  activeMapId: string | null;
  rev: number;
  presets: MapPresetSummary[];
}

export interface InternalStudioTask extends StudioTaskSummary {
  beforeDoc?: CustomMapDocument;
  beforeRev?: number;
  afterRev?: number;
  fullMapChanged?: boolean;
  addedIds: string[];
}

interface TaskWaiter {
  resolve: (task: StudioTaskSummary | null) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanupAbort?: () => void;
}

export interface StudioSessionEvent {
  type: 'init' | 'draft' | 'selection' | 'tasks' | 'presence';
  sessionId: string;
  rev: number;
  doc?: CustomMapDocument;
  patchRect?: TileRect;
  selection: MapSelection | null;
  draftBoxes?: StudioTaskBox[];
  draftInstruction?: string;
  summary: MapValidationReport;
  tasks?: StudioTaskSummary[];
  presence?: StudioMcpPresence;
  note?: string;
}

export interface StudioSession {
  sessionId: string;
  studioToken: string;
  doc: CustomMapDocument;
  rev: number;
  selection: MapSelection | null;
  draftBoxes: StudioTaskBox[];
  draftInstruction?: string;
  taskSeq: number;
  tasks: InternalStudioTask[];
  mcpClientName?: string;
  mcpTransport?: 'http' | 'stdio';
  mcpLastSeenAt: number;
  waiters: Set<TaskWaiter>;
  history: CustomMapDocument[];
  historyIndex: number;
  updatedAt: number;
  listeners: Set<(ev: StudioSessionEvent) => void>;
}

const MAX_HISTORY = 15;

export function cloneMapDoc(doc: CustomMapDocument): CustomMapDocument {
  return JSON.parse(JSON.stringify(doc)) as CustomMapDocument;
}

export function summarizePreset(doc: CustomMapDocument): MapPresetSummary {
  const desks = doc.furniture.filter(
    (f) => f.kind === 'desk' || f.kind === 'desk_back' || f.kind === 'desk_east' || f.kind === 'desk_west',
  ).length;
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    updatedAt: doc.updatedAt,
    ...(doc.author ? { author: doc.author } : {}),
    deskCount: desks,
    zoneCount: doc.zones.length,
  };
}

function sanitizeId(raw: string): string {
  const clean = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return clean || `map-${Date.now().toString(36)}`;
}

function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function wallRect(w: CustomWallBlock): TileRect {
  const h = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
  return { x: w.tx, y: w.ty, w: w.w, h };
}

function nextId(prefix: string, existing: Set<string>): string {
  let n = 1;
  while (existing.has(`${prefix}-${n}`)) n++;
  const id = `${prefix}-${n}`;
  existing.add(id);
  return id;
}

const DEFAULT_FLOOR_FOR_ZONE: Readonly<Record<AreaKind, FloorKind>> = {
  room: 'carpet',
  lounge: 'wood',
  cafe: 'tile_check',
  restroom: 'tile_white',
  reception: 'marble',
  arena: 'concrete',
  corridor: 'concrete',
};

const DEFAULT_WALL_FOR_ZONE: Readonly<Record<AreaKind, WallStyle>> = {
  room: CORE_WALLS.reception,
  lounge: CORE_WALLS.lounge,
  cafe: CORE_WALLS.cafe,
  restroom: CORE_WALLS.restroom,
  reception: CORE_WALLS.reception,
  arena: CORE_WALLS.arena,
  corridor: CORE_WALLS.reception,
};

export function opClearRegion(
  input: CustomMapDocument,
  rawRect: TileRect,
  fillFloor?: FloorKind,
): { doc: CustomMapDocument; patchRect: TileRect; removedCount: number } {
  const doc = cloneMapDoc(input);
  const x = Math.max(0, Math.min(doc.width - 1, Math.floor(rawRect.x)));
  const y = Math.max(0, Math.min(doc.height - 1, Math.floor(rawRect.y)));
  const w = Math.max(1, Math.min(doc.width - x, Math.ceil(rawRect.w)));
  const h = Math.max(1, Math.min(doc.height - y, Math.ceil(rawRect.h)));
  const rect: TileRect = { x, y, w, h };

  let removed = 0;
  doc.furniture = doc.furniture.filter((f) => {
    const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
    const hit = rectsOverlap(rect, { x: f.tx, y: f.ty, w: fp.w, h: fp.h });
    if (hit) removed++;
    return !hit;
  });

  doc.wallItems = doc.wallItems.filter((wi) => {
    const hit = wi.tx >= rect.x && wi.tx < rect.x + rect.w && wi.ty - 1 >= rect.y && wi.ty - 1 < rect.y + rect.h;
    if (hit) removed++;
    return !hit;
  });

  doc.rugs = doc.rugs.filter((r) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const hit = cx >= rect.x && cx < rect.x + rect.w && cy >= rect.y && cy < rect.y + rect.h;
    if (hit) removed++;
    return !hit;
  });

  doc.walls = doc.walls.filter((wall) => {
    const hit = rectsOverlap(rect, wallRect(wall));
    if (hit) removed++;
    return !hit;
  });

  doc.zones = doc.zones.filter((z) => {
    const cx = z.rect.x + z.rect.w / 2;
    const cy = z.rect.y + z.rect.h / 2;
    const hit = cx >= rect.x && cx < rect.x + rect.w && cy >= rect.y && cy < rect.y + rect.h;
    if (hit) removed++;
    return !hit;
  });

  doc.spawns = doc.spawns.filter((sp) => {
    const hit = sp.tx >= rect.x && sp.tx < rect.x + rect.w && sp.ty >= rect.y && sp.ty < rect.y + rect.h;
    if (hit) removed++;
    return !hit;
  });

  const buf = FloorGridBuffer.fromDocument(doc);
  buf.fillRect(rect.x, rect.y, rect.w, rect.h, { kind: fillFloor ?? doc.backgroundFloor });
  doc.floorPalette = buf.palette;
  doc.floorRows = buf.toRows();
  doc.updatedAt = Date.now();
  return { doc, patchRect: rect, removedCount: removed };
}

export function opPaintTiles(
  input: CustomMapDocument,
  ops: Array<{ kind?: 'rect' | 'tile'; x: number; y: number; w?: number; h?: number; floor: FloorKind; tint?: string; tint2?: string }>,
): { doc: CustomMapDocument; patchRect: TileRect } {
  const doc = cloneMapDoc(input);
  const buf = FloorGridBuffer.fromDocument(doc);
  let x0 = doc.width;
  let y0 = doc.height;
  let x1 = 0;
  let y1 = 0;
  for (const op of ops) {
    const px = Math.max(0, Math.min(doc.width - 1, Math.floor(op.x)));
    const py = Math.max(0, Math.min(doc.height - 1, Math.floor(op.y)));
    const pw = Math.max(1, Math.min(doc.width - px, Math.floor(op.w ?? 1)));
    const ph = Math.max(1, Math.min(doc.height - py, Math.floor(op.h ?? 1)));
    buf.fillRect(px, py, pw, ph, {
      kind: op.floor,
      ...(op.tint ? { tint: op.tint } : {}),
      ...(op.tint2 ? { tint2: op.tint2 } : {}),
    });
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px + pw);
    y1 = Math.max(y1, py + ph);
  }
  doc.floorPalette = buf.palette;
  doc.floorRows = buf.toRows();
  doc.updatedAt = Date.now();
  const patchRect = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 };
  return { doc, patchRect };
}

export function opBuildRoom(
  input: CustomMapDocument,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    id?: string;
    name?: string;
    zoneKind?: AreaKind;
    floorKind?: FloorKind;
    wallStyle?: WallStyle;
    doors?: Array<{ side: 'north' | 'south'; offset: number; w: number }>;
    addLightSwitch?: boolean;
    addWindows?: boolean;
    clearInside?: boolean;
  },
): { doc: CustomMapDocument; zone: CustomZone; patchRect: TileRect } {
  const x = Math.max(0, Math.min(input.width - 6, Math.floor(opts.x)));
  const y = Math.max(0, Math.min(input.height - 6, Math.floor(opts.y)));
  const w = Math.max(6, Math.min(input.width - x, Math.floor(opts.w)));
  const h = Math.max(6, Math.min(input.height - y, Math.floor(opts.h)));
  const rect: TileRect = { x, y, w, h };

  const base = opts.clearInside !== false ? opClearRegion(input, rect).doc : cloneMapDoc(input);
  const zoneKind: AreaKind = opts.zoneKind ?? 'room';
  const floorKind: FloorKind = opts.floorKind ?? DEFAULT_FLOOR_FOR_ZONE[zoneKind] ?? 'carpet';
  const wallStyle = opts.wallStyle ?? DEFAULT_WALL_FOR_ZONE[zoneKind] ?? CORE_WALLS.reception;
  const doors = opts.doors?.length
    ? opts.doors
    : [{ side: 'south' as const, offset: Math.max(1, Math.floor(w / 2) - 1), w: 2 }];

  const buf = FloorGridBuffer.fromDocument(base);
  buf.fillRect(x, y, w, h, { kind: floorKind });
  base.floorPalette = buf.palette;
  base.floorRows = buf.toRows();

  const existingZoneIds = new Set(base.zones.map((z) => z.id));
  const zoneId = opts.id?.trim() || nextId('zone', existingZoneIds);
  const zoneName = opts.name?.trim() || (zoneKind === 'room' ? `办公区 ${base.zones.length + 1}` : zoneKind);

  const walls = buildCustomRoomWalls(zoneId, x, y, w, h, wallStyle, doors);
  base.walls.push(...walls);

  const zone: CustomZone = {
    id: zoneId,
    name: zoneName,
    kind: zoneKind,
    rect,
    ...(opts.addLightSwitch ?? (zoneKind === 'room') ? { hasLightSwitch: true } : {}),
  };
  base.zones = [...base.zones.filter((z) => z.id !== zoneId), zone];

  const wiIds = new Set(base.wallItems.map((it) => it.id));
  base.wallItems.push({
    id: nextId(`${zoneId}-sign`, wiIds),
    kind: 'sign',
    tx: x + w / 2,
    ty: y + 2,
    on: 'face',
    zoneId,
  });

  if (opts.addWindows !== false && w >= 10) {
    base.wallItems.push({ id: nextId(`${zoneId}-win`, wiIds), kind: 'window', tx: x + 3, ty: y + 2, on: 'face', zoneId });
    base.wallItems.push({ id: nextId(`${zoneId}-win`, wiIds), kind: 'window', tx: x + w - 3, ty: y + 2, on: 'face', zoneId });
  }

  if (opts.addLightSwitch ?? zoneKind === 'room') {
    const sd = doors.find((d) => d.side === 'south');
    const swX = Math.max(x + 1, Math.min(x + w - 2, x + (sd ? sd.offset - 1 : Math.floor(w / 2) - 2)));
    base.wallItems.push({
      id: nextId(`${zoneId}-sw`, wiIds),
      kind: 'light_switch',
      tx: swX,
      ty: y + h,
      on: 'south',
      variant: 'on',
      zoneId,
    });
  }

  base.updatedAt = Date.now();
  return { doc: base, zone, patchRect: rect };
}

export function opPlaceWorkstations(
  input: CustomMapDocument,
  opts: {
    x: number;
    y: number;
    count: number;
    facing: Dir;
    layout?: 'row' | 'island';
    cols?: number;
    deskVariant?: string;
    chairVariant?: string;
  },
): { doc: CustomMapDocument; placed: number; patchRect: TileRect } {
  const doc = cloneMapDoc(input);
  const count = Math.max(1, Math.min(128, Math.floor(opts.count)));
  const startX = Math.max(0, Math.floor(opts.x));
  const startY = Math.max(0, Math.floor(opts.y));
  const layout = opts.layout ?? 'row';
  const deskVariant = opts.deskVariant ?? 'wood';
  const chairVariant = opts.chairVariant ?? 'black';
  const ids = new Set(doc.furniture.map((f) => f.id));

  let placed = 0;
  let maxX = startX;
  let maxY = startY;

  const pushPair = (deskKind: FurnitureKind, dx: number, dy: number, chairKind: FurnitureKind, cx: number, cy: number, dir: Dir) => {
    const dfp = FURNITURE[deskKind].footprint;
    const cfp = FURNITURE[chairKind].footprint;
    if (dx < 0 || dy < 0 || dx + dfp.w > doc.width || dy + dfp.h > doc.height) return false;
    if (cx < 0 || cy < 0 || cx + cfp.w > doc.width || cy + cfp.h > doc.height) return false;
    if (doc.furniture.length + 2 > MAX_MAP_ITEMS) return false;
    const deskId = nextId('desk', ids);
    const chairId = nextId('chair', ids);
    doc.furniture.push({ id: deskId, kind: deskKind, tx: dx, ty: dy, variant: deskVariant });
    doc.furniture.push({ id: chairId, kind: chairKind, tx: cx, ty: cy, variant: chairVariant, dir, deskId });
    maxX = Math.max(maxX, dx + dfp.w, cx + cfp.w);
    maxY = Math.max(maxY, dy + dfp.h, cy + cfp.h);
    placed++;
    return true;
  };

  if (opts.facing === 'up' || opts.facing === 'down') {
    const cols = Math.max(1, Math.floor(opts.cols ?? (layout === 'island' ? Math.ceil(count / 2) : count)));
    if (layout === 'island') {
      const pairsPerRow = cols;
      for (let i = 0; i < count; i++) {
        const groupIdx = Math.floor(i / (pairsPerRow * 2));
        const within = i % (pairsPerRow * 2);
        const col = within % pairsPerRow;
        const topHalf = within < pairsPerRow;
        const bx = startX + col * 3;
        const by = startY + groupIdx * 5;
        if (topHalf) {
          pushPair('desk_back', bx, by + 1, 'office_chair_front', bx, by, 'down');
        } else {
          pushPair('desk', bx, by + 2, 'office_chair', bx, by + 3, 'up');
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const bx = startX + col * 3;
        const by = startY + row * 3;
        if (opts.facing === 'up') {
          pushPair('desk', bx, by, 'office_chair', bx, by + 1, 'up');
        } else {
          pushPair('desk_back', bx, by + 1, 'office_chair_front', bx, by, 'down');
        }
      }
    }
  } else {
    const rows = Math.max(1, Math.floor(opts.cols ?? (layout === 'island' ? Math.ceil(count / 2) : count)));
    if (layout === 'island') {
      for (let i = 0; i < count; i++) {
        const groupIdx = Math.floor(i / (rows * 2));
        const within = i % (rows * 2);
        const row = within % rows;
        const leftHalf = within < rows;
        const bx = startX + groupIdx * 5;
        const by = startY + row * 3;
        if (leftHalf) {
          pushPair('desk_west', bx + 1, by, 'office_chair_right', bx, by, 'right');
        } else {
          pushPair('desk_east', bx + 2, by, 'office_chair_left', bx + 3, by, 'left');
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        const row = i % rows;
        const col = Math.floor(i / rows);
        const bx = startX + col * 3;
        const by = startY + row * 3;
        if (opts.facing === 'right') {
          // Sit left facing right into desk_west
          pushPair('desk_west', bx + 1, by, 'office_chair_right', bx, by, 'right');
        } else {
          // facing === 'left': Sit right facing left into desk_east
          pushPair('desk_east', bx, by, 'office_chair_left', bx + 1, by, 'left');
        }
      }
    }
  }

  doc.updatedAt = Date.now();
  return {
    doc,
    placed,
    patchRect: { x: startX, y: startY, w: Math.max(1, maxX - startX), h: Math.max(1, maxY - startY) },
  };
}

export function opPopulateZonePreset(
  input: CustomMapDocument,
  opts: { rect: TileRect; preset: 'office' | 'lounge' | 'cafe' | 'restroom' | 'reception' | 'arena'; name?: string; wallStyle?: WallStyle },
): { doc: CustomMapDocument; zone: CustomZone; patchRect: TileRect } {
  const zoneKind: AreaKind = opts.preset === 'office' ? 'room' : opts.preset;
  const built = opBuildRoom(input, {
    x: opts.rect.x,
    y: opts.rect.y,
    w: opts.rect.w,
    h: opts.rect.h,
    name: opts.name ?? (
      opts.preset === 'office' ? '研发办公区' :
      opts.preset === 'lounge' ? '休闲娱乐区' :
      opts.preset === 'cafe' ? '茶水咖啡区' :
      opts.preset === 'restroom' ? '洗手间' :
      opts.preset === 'reception' ? '企业前台' : '宝可梦竞技场'
    ),
    zoneKind,
    wallStyle: opts.wallStyle,
    addLightSwitch: opts.preset === 'office',
    addWindows: opts.preset !== 'arena',
    clearInside: true,
  });

  let doc = built.doc;
  const r = built.zone.rect;
  const fIds = new Set(doc.furniture.map((f) => f.id));
  const wIds = new Set(doc.wallItems.map((w) => w.id));

  if (opts.preset === 'office') {
    const innerX = r.x + 2;
    const innerY = r.y + 3;
    const availW = r.w - 4;
    const availH = r.h - 5;
    if (availW >= 4 && availH >= 4) {
      const cols = Math.max(1, Math.floor((availW + 1) / 3));
      const rows = Math.max(1, Math.floor((availH + 1) / 3));
      const res = opPlaceWorkstations(doc, {
        x: innerX,
        y: innerY,
        count: Math.min(24, cols * rows),
        facing: 'up',
        layout: rows >= 2 ? 'island' : 'row',
        cols,
      });
      doc = res.doc;
      fIds.clear();
      doc.furniture.forEach((f) => fIds.add(f.id));
    }
    doc.furniture.push({ id: nextId('plant', fIds), kind: 'plant_tall', tx: r.x + 1, ty: r.y + 2, variant: 'monstera' });
    doc.wallItems.push({ id: nextId('wb', wIds), kind: 'whiteboard', tx: r.x + Math.floor(r.w / 2), ty: r.y + 2, on: 'face', zoneId: built.zone.id });
  } else if (opts.preset === 'lounge') {
    doc.wallItems.push({ id: nextId('tv', wIds), kind: 'tv', tx: r.x + Math.floor(r.w / 2), ty: r.y + 2, on: 'face', zoneId: built.zone.id });
    if (r.w >= 8 && r.h >= 7) {
      doc.furniture.push({ id: nextId('sofa', fIds), kind: 'sofa', tx: r.x + Math.floor(r.w / 2) - 1, ty: r.y + 5, variant: 'down' });
      doc.furniture.push({ id: nextId('arcade', fIds), kind: 'arcade', tx: r.x + 1, ty: r.y + 2 });
      doc.furniture.push({ id: nextId('beanbag', fIds), kind: 'beanbag', tx: r.x + r.w - 3, ty: r.y + 3, variant: 'blue' });
    }
    if (r.w >= 12 && r.h >= 9) {
      doc.furniture.push({ id: nextId('pingpong', fIds), kind: 'pingpong_table', tx: r.x + 2, ty: r.y + r.h - 4 });
    }
  } else if (opts.preset === 'cafe') {
    doc.furniture.push({ id: nextId('coffee', fIds), kind: 'coffee_machine', tx: r.x + 2, ty: r.y + 2 });
    doc.furniture.push({ id: nextId('fridge', fIds), kind: 'fridge', tx: r.x + 4, ty: r.y + 2 });
    if (r.w >= 8) {
      doc.furniture.push({ id: nextId('water', fIds), kind: 'water_cooler', tx: r.x + r.w - 3, ty: r.y + 2 });
    }
    if (r.w >= 10 && r.h >= 8) {
      doc.furniture.push({ id: nextId('cafe-tbl', fIds), kind: 'cafe_table', tx: r.x + Math.floor(r.w / 2) - 1, ty: r.y + 5 });
      doc.furniture.push({ id: nextId('cafe-ch1', fIds), kind: 'cafe_chair', tx: r.x + Math.floor(r.w / 2) - 1, ty: r.y + 4, dir: 'down' });
      doc.furniture.push({ id: nextId('cafe-ch2', fIds), kind: 'cafe_chair', tx: r.x + Math.floor(r.w / 2), ty: r.y + 6, dir: 'up' });
    }
  } else if (opts.preset === 'restroom') {
    doc.furniture.push({ id: nextId('stall', fIds), kind: 'toilet_stall', tx: r.x + 1, ty: r.y + 2 });
    if (r.w >= 8) doc.furniture.push({ id: nextId('stall', fIds), kind: 'toilet_stall', tx: r.x + 3, ty: r.y + 2 });
    doc.furniture.push({ id: nextId('sink', fIds), kind: 'sink', tx: r.x + Math.max(1, r.w - 3), ty: r.y + 2 });
    doc.wallItems.push({ id: nextId('mirror', wIds), kind: 'mirror', tx: r.x + Math.max(1, r.w - 3) + 0.5, ty: r.y + 2, on: 'face', zoneId: built.zone.id });
  } else if (opts.preset === 'reception') {
    const cx = r.x + Math.floor(r.w / 2);
    doc.furniture.push({ id: nextId('desk-rec', fIds), kind: 'reception_desk', tx: Math.max(r.x + 1, cx - 2), ty: r.y + 3 });
    doc.furniture.push({ id: nextId('mat', fIds), kind: 'entrance_mat', tx: Math.max(r.x + 1, cx - 1), ty: r.y + r.h - 2, variant: 'blue', dir: 'up' });
    doc.spawns.push({ id: nextId('spawn', new Set(doc.spawns.map((s) => s.id))), tx: Math.max(r.x + 1, cx - 1), ty: r.y + r.h - 2, dir: 'up' });
  } else if (opts.preset === 'arena') {
    if (r.w >= 12 && r.h >= 9) {
      doc.furniture.push({ id: nextId('bench', fIds), kind: 'bench', tx: r.x + 2, ty: r.y + 2, variant: 'blue' });
      doc.furniture.push({ id: nextId('bench', fIds), kind: 'bench', tx: r.x + r.w - 4, ty: r.y + 2, variant: 'red' });
    }
  }

  doc.updatedAt = Date.now();
  return { doc, zone: built.zone, patchRect: r };
}

export function opMutateItems(
  input: CustomMapDocument,
  opts: {
    removeIds?: string[];
    addFurniture?: Array<Partial<CustomFurnitureItem> & { kind: FurnitureKind; tx: number; ty: number }>;
    addWallItems?: Array<Partial<CustomWallItem> & { kind: FurnitureKind; tx: number; ty: number; on: 'face' | 'south' }>;
    addRugs?: Array<Partial<CustomRug> & { x: number; y: number; w: number; h: number; color: string }>;
    addSpawns?: Array<Partial<CustomSpawnPoint> & { tx: number; ty: number }>;
    upsertZones?: CustomZone[];
  },
): { doc: CustomMapDocument; patchRect?: TileRect } {
  const doc = cloneMapDoc(input);
  let x0 = doc.width;
  let y0 = doc.height;
  let x1 = 0;
  let y1 = 0;
  const expand = (tx: number, ty: number, w = 2, h = 2) => {
    x0 = Math.min(x0, Math.floor(tx));
    y0 = Math.min(y0, Math.floor(ty));
    x1 = Math.max(x1, Math.ceil(tx + w));
    y1 = Math.max(y1, Math.ceil(ty + h));
  };

  if (opts.removeIds?.length) {
    const rm = new Set(opts.removeIds);
    for (const f of doc.furniture) if (rm.has(f.id)) expand(f.tx, f.ty);
    for (const wi of doc.wallItems) if (rm.has(wi.id)) expand(wi.tx, wi.ty - 1);
    for (const r of doc.rugs) if (rm.has(r.id)) expand(r.x, r.y, r.w, r.h);
    for (const z of doc.zones) if (rm.has(z.id)) expand(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
    doc.furniture = doc.furniture.filter((f) => !rm.has(f.id));
    doc.wallItems = doc.wallItems.filter((w) => !rm.has(w.id));
    doc.rugs = doc.rugs.filter((r) => !rm.has(r.id));
    doc.walls = doc.walls.filter((w) => !rm.has(w.id));
    doc.zones = doc.zones.filter((z) => !rm.has(z.id));
    doc.spawns = doc.spawns.filter((s) => !rm.has(s.id));
  }

  if (opts.addFurniture?.length) {
    const ids = new Set(doc.furniture.map((f) => f.id));
    for (const item of opts.addFurniture) {
      if (doc.furniture.length >= MAX_MAP_ITEMS) break;
      const id = item.id && !ids.has(item.id) ? item.id : nextId('f', ids);
      ids.add(id);
      doc.furniture.push({ ...item, id, tx: Math.floor(item.tx), ty: Math.floor(item.ty) });
      expand(item.tx, item.ty);
    }
  }

  if (opts.addWallItems?.length) {
    const ids = new Set(doc.wallItems.map((w) => w.id));
    for (const wi of opts.addWallItems) {
      const id = wi.id && !ids.has(wi.id) ? wi.id : nextId('wi', ids);
      ids.add(id);
      doc.wallItems.push({ ...wi, id });
      expand(wi.tx - 1, wi.ty - 2, 3, 3);
    }
  }

  if (opts.addRugs?.length) {
    const ids = new Set(doc.rugs.map((r) => r.id));
    for (const rug of opts.addRugs) {
      const id = rug.id && !ids.has(rug.id) ? rug.id : nextId('rug', ids);
      ids.add(id);
      doc.rugs.push({ ...rug, id });
      expand(rug.x, rug.y, rug.w, rug.h);
    }
  }

  if (opts.addSpawns?.length) {
    const ids = new Set(doc.spawns.map((s) => s.id));
    for (const sp of opts.addSpawns) {
      const id = sp.id && !ids.has(sp.id) ? sp.id : nextId('spawn', ids);
      ids.add(id);
      doc.spawns.push({ ...sp, id, tx: Math.floor(sp.tx), ty: Math.floor(sp.ty) });
      expand(sp.tx, sp.ty, 1, 1);
    }
  }

  if (opts.upsertZones?.length) {
    for (const z of opts.upsertZones) {
      doc.zones = [...doc.zones.filter((cur) => cur.id !== z.id), z];
      expand(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
    }
  }

  doc.updatedAt = Date.now();
  return {
    doc,
    ...(x1 > x0 && y1 > y0 ? { patchRect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } } : {}),
  };
}

export class MapManager {
  private readonly mapsDir: string;
  private readonly presetsDir: string;
  private readonly sessionsDir: string;
  private readonly manifestPath: string;
  private manifest: MapManifest;
  private readonly presets = new Map<string, CustomMapDocument>();
  private readonly sessions = new Map<string, StudioSession>();
  private readonly tokenToSession = new Map<string, string>();
  private readonly activeListeners = new Set<() => void>();

  constructor(dataDir: string) {
    this.mapsDir = join(dataDir, 'maps');
    this.presetsDir = join(this.mapsDir, 'presets');
    this.sessionsDir = join(this.mapsDir, 'sessions');
    this.manifestPath = join(this.mapsDir, 'manifest.json');
    mkdirSync(this.presetsDir, { recursive: true });
    mkdirSync(this.sessionsDir, { recursive: true });
    this.manifest = { mode: 'auto', activeMapId: null, rev: 1, presets: [] };
    this.load();
  }

  private load(): void {
    if (existsSync(this.manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.manifestPath, 'utf8')) as Partial<MapManifest>;
        this.manifest = {
          mode: raw.mode === 'custom' ? 'custom' : 'auto',
          activeMapId: typeof raw.activeMapId === 'string' ? raw.activeMapId : null,
          rev: typeof raw.rev === 'number' && raw.rev >= 1 ? raw.rev : 1,
          presets: Array.isArray(raw.presets) ? raw.presets : [],
        };
      } catch {
        // Fallback to clean manifest
      }
    }

    if (existsSync(this.presetsDir)) {
      for (const file of readdirSync(this.presetsDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const parsed = parseCustomMapJson(readFileSync(join(this.presetsDir, file), 'utf8'));
          if (parsed.ok) this.presets.set(parsed.doc.id, parsed.doc);
        } catch {
          // Skip corrupt preset file
        }
      }
    }

    if (this.presets.size === 0) {
      const starter = createStarterOfficeMap(2, DEFAULT_MAP_W, DEFAULT_MAP_H, 'Agent Party 标准大厦');
      starter.id = 'starter-campus';
      this.presets.set(starter.id, starter);
      writeFileSync(join(this.presetsDir, `${starter.id}.json`), serializeCustomMapJson(starter), 'utf8');
    }

    this.manifest.presets = [...this.presets.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarizePreset);

    if (this.manifest.mode === 'custom' && (!this.manifest.activeMapId || !this.presets.has(this.manifest.activeMapId))) {
      this.manifest.mode = 'auto';
      this.manifest.activeMapId = null;
    }

    if (existsSync(this.sessionsDir)) {
      for (const file of readdirSync(this.sessionsDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(readFileSync(join(this.sessionsDir, file), 'utf8')) as {
            sessionId?: string;
            studioToken?: string;
            doc?: unknown;
            rev?: number;
            taskSeq?: number;
            selection?: MapSelection | null;
            draftBoxes?: StudioTaskBox[];
            draftInstruction?: string;
            tasks?: InternalStudioTask[];
            updatedAt?: number;
          };
          if (!raw.sessionId || !raw.studioToken?.startsWith('ws_')) continue;
          const parsed = parseCustomMapJson(raw.doc);
          if (!parsed.ok) continue;
          const tasks: InternalStudioTask[] = Array.isArray(raw.tasks)
            ? raw.tasks.slice(-30).map((t) => ({
                ...t,
                // If server restarted while a task was running, re-queue it cleanly
                status: t.status === 'running' ? 'queued' : t.status,
                addedIds: Array.isArray(t.addedIds) ? t.addedIds : [],
                touchedRects: Array.isArray(t.touchedRects) ? t.touchedRects : [],
              }))
            : [];
          const session: StudioSession = {
            sessionId: raw.sessionId,
            studioToken: raw.studioToken,
            doc: parsed.doc,
            rev: typeof raw.rev === 'number' && raw.rev >= 1 ? raw.rev : 1,
            selection: raw.selection ?? null,
            draftBoxes: Array.isArray(raw.draftBoxes) ? raw.draftBoxes : [],
            ...(typeof raw.draftInstruction === 'string' && raw.draftInstruction.trim()
              ? { draftInstruction: raw.draftInstruction.trim().slice(0, 800) }
              : {}),
            taskSeq: typeof raw.taskSeq === 'number' ? raw.taskSeq : tasks.length,
            tasks,
            mcpLastSeenAt: 0,
            waiters: new Set(),
            history: [cloneMapDoc(parsed.doc)],
            historyIndex: 0,
            updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
            listeners: new Set(),
          };
          this.sessions.set(session.sessionId, session);
          this.tokenToSession.set(session.studioToken, session.sessionId);
        } catch {
          // Skip corrupt session file
        }
      }
    }

    this.saveManifest();
  }

  private saveManifest(): void {
    this.manifest.presets = [...this.presets.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarizePreset);
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf8');
  }

  private emitActive(): void {
    for (const cb of this.activeListeners) {
      try {
        cb();
      } catch {
        // ignore listener error
      }
    }
  }

  onActiveChange(cb: () => void): () => void {
    this.activeListeners.add(cb);
    return () => void this.activeListeners.delete(cb);
  }

  getMode(): MapMode {
    return this.manifest.mode;
  }

  getActiveMapId(): string | null {
    return this.manifest.activeMapId;
  }

  getRev(): number {
    return this.manifest.rev;
  }

  getActiveDoc(): CustomMapDocument | null {
    if (this.manifest.mode !== 'custom' || !this.manifest.activeMapId) return null;
    const d = this.presets.get(this.manifest.activeMapId);
    return d ? cloneMapDoc(d) : null;
  }

  getPreset(id: string): CustomMapDocument | null {
    const d = this.presets.get(id);
    return d ? cloneMapDoc(d) : null;
  }

  listPresets(): MapPresetSummary[] {
    return this.manifest.presets.map((p) => ({ ...p }));
  }

  getPublicState() {
    return {
      mode: this.manifest.mode,
      activeMapId: this.manifest.activeMapId,
      rev: this.manifest.rev,
      map: this.getActiveDoc(),
      presets: this.listPresets(),
    };
  }

  savePreset(
    rawDoc: unknown,
    opts?: { id?: string; name?: string },
  ): { ok: true; summary: MapPresetSummary; doc: CustomMapDocument } | { ok: false; error: string } {
    const parsed = parseCustomMapJson(rawDoc);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const doc = parsed.doc;
    if (opts?.id) doc.id = sanitizeId(opts.id);
    else doc.id = sanitizeId(doc.id);
    if (opts?.name?.trim()) doc.name = opts.name.trim().slice(0, 64);
    doc.width = clampMapDim(doc.width, DEFAULT_MAP_W);
    doc.height = clampMapDim(doc.height, DEFAULT_MAP_H);
    doc.updatedAt = Date.now();

    this.presets.set(doc.id, doc);
    writeFileSync(join(this.presetsDir, `${doc.id}.json`), serializeCustomMapJson(doc), 'utf8');

    const wasActive = this.manifest.mode === 'custom' && this.manifest.activeMapId === doc.id;
    if (wasActive) this.manifest.rev++;
    this.saveManifest();
    if (wasActive) this.emitActive();
    return { ok: true, summary: summarizePreset(doc), doc: cloneMapDoc(doc) };
  }

  activate(opts: { mode: MapMode; mapId?: string | null }): {
    ok: true;
    mode: MapMode;
    activeMapId: string | null;
    rev: number;
    doc: CustomMapDocument | null;
  } | { ok: false; error: string } {
    if (opts.mode === 'auto') {
      this.manifest.mode = 'auto';
      this.manifest.activeMapId = null;
      this.manifest.rev++;
      this.saveManifest();
      this.emitActive();
      return { ok: true, mode: 'auto', activeMapId: null, rev: this.manifest.rev, doc: null };
    }

    const targetId = opts.mapId || this.manifest.activeMapId || this.manifest.presets[0]?.id;
    if (!targetId || !this.presets.has(targetId)) {
      return { ok: false, error: '指定的自定义地图预设不存在。' };
    }
    this.manifest.mode = 'custom';
    this.manifest.activeMapId = targetId;
    this.manifest.rev++;
    this.saveManifest();
    this.emitActive();
    return {
      ok: true,
      mode: 'custom',
      activeMapId: targetId,
      rev: this.manifest.rev,
      doc: this.getActiveDoc(),
    };
  }

  deletePreset(id: string): { ok: true } | { ok: false; error: string } {
    if (!this.presets.has(id)) return { ok: false, error: '地图预设不存在。' };
    if (this.manifest.mode === 'custom' && this.manifest.activeMapId === id) {
      return { ok: false, error: '无法删除当前正在使用的地图，请先切换为默认模式或其他地图。' };
    }
    this.presets.delete(id);
    const file = join(this.presetsDir, `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
    this.saveManifest();
    return { ok: true };
  }

  // ---- Studio Sessions (Live Map Workshop + Isolated MCP Task Queue + Review/Revert)

  private saveSession(s: StudioSession): void {
    try {
      const payload = {
        sessionId: s.sessionId,
        studioToken: s.studioToken,
        doc: s.doc,
        rev: s.rev,
        taskSeq: s.taskSeq,
        selection: s.selection,
        draftBoxes: s.draftBoxes,
        ...(s.draftInstruction ? { draftInstruction: s.draftInstruction } : {}),
        tasks: s.tasks.slice(-30),
        updatedAt: s.updatedAt,
      };
      writeFileSync(join(this.sessionsDir, `${sanitizeId(s.sessionId)}.json`), JSON.stringify(payload), 'utf8');
    } catch {
      // ignore persistence error
    }
  }

  private toTaskSummary(t: InternalStudioTask): StudioTaskSummary {
    return {
      id: t.id,
      seq: t.seq,
      status: t.status,
      boxes: t.boxes.map((b) => ({ ...b })),
      ...(t.instruction ? { instruction: t.instruction } : {}),
      ...(t.aiSummary ? { aiSummary: t.aiSummary } : {}),
      createdAt: t.createdAt,
      ...(t.startedAt !== undefined ? { startedAt: t.startedAt } : {}),
      ...(t.completedAt !== undefined ? { completedAt: t.completedAt } : {}),
      touchedRects: t.touchedRects.map((r) => ({ ...r })),
    };
  }

  getTaskSummaries(sessionId: string): StudioTaskSummary[] {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    return s.tasks.slice(-30).map((t) => this.toTaskSummary(t));
  }

  getMcpPresence(sessionId: string, now = Date.now()): StudioMcpPresence {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return { connected: false, listening: false, lastSeenAt: 0, activeTaskId: null };
    }
    const running = s.tasks.find((t) => t.status === 'running') ?? null;
    const listening = s.waiters.size > 0 || running !== null;
    const connected = listening || (s.mcpLastSeenAt > 0 && now - s.mcpLastSeenAt < 45_000);
    return {
      connected,
      listening,
      ...(s.mcpClientName ? { clientName: s.mcpClientName } : {}),
      ...(s.mcpTransport ? { transport: s.mcpTransport } : {}),
      lastSeenAt: s.mcpLastSeenAt,
      activeTaskId: running?.id ?? null,
    };
  }

  touchMcpPresence(
    sessionId: string,
    info?: { clientName?: string; transport?: 'http' | 'stdio' },
  ): StudioMcpPresence {
    const s = this.sessions.get(sessionId);
    if (!s) return { connected: false, listening: false, lastSeenAt: 0, activeTaskId: null };
    const prev = this.getMcpPresence(sessionId);
    s.mcpLastSeenAt = Date.now();
    if (info?.clientName?.trim()) s.mcpClientName = info.clientName.trim().slice(0, 48);
    if (info?.transport) s.mcpTransport = info.transport;
    const next = this.getMcpPresence(sessionId);
    if (
      prev.connected !== next.connected ||
      prev.listening !== next.listening ||
      prev.clientName !== next.clientName ||
      prev.activeTaskId !== next.activeTaskId
    ) {
      this.emitSession(s, {
        type: 'presence',
        sessionId: s.sessionId,
        rev: s.rev,
        selection: s.selection,
        summary: validateMapPlayability(s.doc),
        presence: next,
      });
    }
    return next;
  }

  createSession(input?: unknown): StudioSession {
    let initialDocArg: unknown = input;
    let resumeToken = '';
    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      (input as { format?: string }).format !== 'agent-party-map@1' &&
      ('resumeToken' in input || 'doc' in input)
    ) {
      const obj = input as { doc?: unknown; resumeToken?: unknown };
      if (typeof obj.resumeToken === 'string') resumeToken = obj.resumeToken.trim();
      initialDocArg = obj.doc;
    }

    if (resumeToken.startsWith('ws_')) {
      const existing = this.getSessionByToken(resumeToken);
      if (existing) return existing;
    }

    let baseDoc: CustomMapDocument | null = null;
    if (initialDocArg) {
      const parsed = parseCustomMapJson(initialDocArg);
      if (parsed.ok) baseDoc = parsed.doc;
    }
    if (!baseDoc) {
      baseDoc = this.getActiveDoc() ?? cloneMapDoc(this.presets.values().next().value ?? createStarterOfficeMap());
    }
    const sessionId = `st_${randomBytes(6).toString('hex')}`;
    const studioToken = `ws_${randomBytes(12).toString('hex')}`;
    const session: StudioSession = {
      sessionId,
      studioToken,
      doc: baseDoc,
      rev: 1,
      selection: null,
      draftBoxes: [],
      taskSeq: 0,
      tasks: [],
      mcpLastSeenAt: 0,
      waiters: new Set(),
      history: [cloneMapDoc(baseDoc)],
      historyIndex: 0,
      updatedAt: Date.now(),
      listeners: new Set(),
    };
    this.sessions.set(sessionId, session);
    this.tokenToSession.set(studioToken, sessionId);
    this.saveSession(session);
    return session;
  }

  rotateSessionToken(sessionId: string): { ok: true; studioToken: string } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    this.tokenToSession.delete(s.studioToken);
    for (const w of s.waiters) {
      clearTimeout(w.timer);
      w.cleanupAbort?.();
      w.resolve(null);
    }
    s.waiters.clear();
    s.mcpLastSeenAt = 0;
    s.mcpClientName = undefined;
    s.mcpTransport = undefined;
    s.studioToken = `ws_${randomBytes(12).toString('hex')}`;
    this.tokenToSession.set(s.studioToken, s.sessionId);
    this.saveSession(s);
    this.emitSession(s, {
      type: 'presence',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      summary: validateMapPlayability(s.doc),
      presence: this.getMcpPresence(s.sessionId),
    });
    return { ok: true, studioToken: s.studioToken };
  }

  getSession(sessionId: string): StudioSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionByToken(token: string): StudioSession | null {
    const sid = this.tokenToSession.get(token.trim());
    return sid ? (this.sessions.get(sid) ?? null) : null;
  }

  private emitSession(session: StudioSession, ev: StudioSessionEvent): void {
    for (const cb of session.listeners) {
      try {
        cb(ev);
      } catch {
        // ignore closed listener
      }
    }
  }

  subscribeSession(sessionId: string, cb: (ev: StudioSessionEvent) => void): () => void {
    const s = this.sessions.get(sessionId);
    if (!s) return () => {};
    s.listeners.add(cb);
    return () => void s.listeners.delete(cb);
  }

  private claimNextQueuedTask(s: StudioSession): InternalStudioTask | null {
    const running = s.tasks.find((t) => t.status === 'running');
    if (running) return running;
    const next = s.tasks.find((t) => t.status === 'queued');
    if (!next) return null;
    next.status = 'running';
    next.startedAt = Date.now();
    next.beforeDoc = cloneMapDoc(s.doc);
    next.beforeRev = s.rev;
    next.addedIds = [];
    next.touchedRects = next.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    this.saveSession(s);
    this.emitSession(s, {
      type: 'tasks',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      summary: validateMapPlayability(s.doc),
      tasks: this.getTaskSummaries(s.sessionId),
      presence: this.getMcpPresence(s.sessionId),
    });
    return next;
  }

  enqueueTask(
    sessionId: string,
    input: {
      boxes?: Array<{ id?: string; label?: string; x: number; y: number; w: number; h: number; note?: string }>;
      instruction?: string;
    },
  ): { ok: true; task: StudioTaskSummary; tasks: StudioTaskSummary[]; presence: StudioMcpPresence } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    const rawBoxes = Array.isArray(input.boxes) ? input.boxes : [];
    if (!rawBoxes.length) return { ok: false, error: '请至少框选一个目标区块再发送给 AI。' };

    const seq = ++s.taskSeq;
    const boxes: StudioTaskBox[] = rawBoxes.slice(0, 24).map((b, idx) => {
      const x = Math.max(0, Math.min(s.doc.width - 1, Math.floor(Number(b.x ?? 0))));
      const y = Math.max(0, Math.min(s.doc.height - 1, Math.floor(Number(b.y ?? 0))));
      const w = Math.max(1, Math.min(s.doc.width - x, Math.ceil(Number(b.w ?? 1))));
      const h = Math.max(1, Math.min(s.doc.height - y, Math.ceil(Number(b.h ?? 1))));
      return {
        id: b.id?.trim() || `box-${seq}-${idx + 1}`,
        label: b.label?.trim() || `区块 #${idx + 1}`,
        x,
        y,
        w,
        h,
        ...(b.note?.trim() ? { note: b.note.trim().slice(0, 500) } : {}),
      };
    });

    const task: InternalStudioTask = {
      id: `task_${seq}`,
      seq,
      status: 'queued',
      boxes,
      ...(input.instruction?.trim() ? { instruction: input.instruction.trim().slice(0, 800) } : {}),
      createdAt: Date.now(),
      touchedRects: boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
      addedIds: [],
    };
    s.tasks.push(task);
    if (s.tasks.length > 40) {
      const dropIdx = s.tasks.findIndex((t) => t.status === 'accepted' || t.status === 'reverted' || t.status === 'cancelled');
      if (dropIdx >= 0) s.tasks.splice(dropIdx, 1);
    }

    // Wake oldest listening MCP waiter if idle
    if (!s.tasks.some((t) => t.status === 'running') && s.waiters.size > 0) {
      const waiter = s.waiters.values().next().value as TaskWaiter | undefined;
      if (waiter) {
        s.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.cleanupAbort?.();
        const claimed = this.claimNextQueuedTask(s);
        waiter.resolve(claimed ? this.toTaskSummary(claimed) : null);
      }
    } else {
      this.saveSession(s);
      this.emitSession(s, {
        type: 'tasks',
        sessionId: s.sessionId,
        rev: s.rev,
        selection: s.selection,
        summary: validateMapPlayability(s.doc),
        tasks: this.getTaskSummaries(s.sessionId),
        presence: this.getMcpPresence(s.sessionId),
      });
    }

    return {
      ok: true,
      task: this.toTaskSummary(task),
      tasks: this.getTaskSummaries(s.sessionId),
      presence: this.getMcpPresence(s.sessionId),
    };
  }

  waitForNextTask(
    sessionId: string,
    timeoutMs = 25_000,
    abortSignal?: AbortSignal,
  ): Promise<StudioTaskSummary | null> {
    const s = this.sessions.get(sessionId);
    if (!s) return Promise.resolve(null);
    this.touchMcpPresence(sessionId);

    const immediate = this.claimNextQueuedTask(s);
    if (immediate) return Promise.resolve(this.toTaskSummary(immediate));

    if (abortSignal?.aborted) return Promise.resolve(null);

    const clampedMs = Math.max(1000, Math.min(45_000, timeoutMs));
    return new Promise((resolve) => {
      const waiter: TaskWaiter = {
        resolve,
        timer: setTimeout(() => {
          s.waiters.delete(waiter);
          waiter.cleanupAbort?.();
          s.mcpLastSeenAt = Date.now();
          this.emitSession(s, {
            type: 'presence',
            sessionId: s.sessionId,
            rev: s.rev,
            selection: s.selection,
            summary: validateMapPlayability(s.doc),
            presence: this.getMcpPresence(s.sessionId),
          });
          resolve(null);
        }, clampedMs),
      };

      if (abortSignal) {
        const onAbort = () => {
          s.waiters.delete(waiter);
          clearTimeout(waiter.timer);
          this.emitSession(s, {
            type: 'presence',
            sessionId: s.sessionId,
            rev: s.rev,
            selection: s.selection,
            summary: validateMapPlayability(s.doc),
            presence: this.getMcpPresence(s.sessionId),
          });
          resolve(null);
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanupAbort = () => abortSignal.removeEventListener('abort', onAbort);
      }

      s.waiters.add(waiter);
      this.emitSession(s, {
        type: 'presence',
        sessionId: s.sessionId,
        rev: s.rev,
        selection: s.selection,
        summary: validateMapPlayability(s.doc),
        presence: this.getMcpPresence(s.sessionId),
      });
    });
  }

  completeTask(
    sessionId: string,
    taskId?: string,
    aiSummary?: string,
  ): { ok: true; task: StudioTaskSummary } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    const task = (taskId ? s.tasks.find((t) => t.id === taskId) : null)
      ?? s.tasks.find((t) => t.status === 'running')
      ?? s.tasks.find((t) => t.status === 'queued');
    if (!task) return { ok: false, error: '未找到对应的进行中任务。' };
    if (!task.beforeDoc) {
      task.beforeDoc = cloneMapDoc(s.doc);
      task.beforeRev = s.rev;
    }
    task.status = 'review';
    task.completedAt = Date.now();
    task.afterRev = s.rev;
    if (aiSummary?.trim()) task.aiSummary = aiSummary.trim().slice(0, 400);
    this.saveSession(s);
    this.emitSession(s, {
      type: 'tasks',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      summary: validateMapPlayability(s.doc),
      tasks: this.getTaskSummaries(s.sessionId),
      presence: this.getMcpPresence(s.sessionId),
    });
    return { ok: true, task: this.toTaskSummary(task) };
  }

  acceptTask(
    sessionId: string,
    taskId: string,
  ): { ok: true; task: StudioTaskSummary; tasks: StudioTaskSummary[] } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: '任务不存在。' };
    if (task.status !== 'review' && task.status !== 'running') {
      return { ok: false, error: '当前任务状态不需要确认。' };
    }
    task.status = 'accepted';
    delete task.beforeDoc;
    this.saveSession(s);
    this.emitSession(s, {
      type: 'tasks',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      summary: validateMapPlayability(s.doc),
      tasks: this.getTaskSummaries(s.sessionId),
      presence: this.getMcpPresence(s.sessionId),
    });
    return { ok: true, task: this.toTaskSummary(task), tasks: this.getTaskSummaries(s.sessionId) };
  }

  cancelTask(
    sessionId: string,
    taskId: string,
  ): { ok: true; task: StudioTaskSummary; tasks: StudioTaskSummary[] } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: '任务不存在。' };
    if (task.status !== 'queued') {
      return { ok: false, error: '仅排队中的任务可以取消。' };
    }
    task.status = 'cancelled';
    this.saveSession(s);
    this.emitSession(s, {
      type: 'tasks',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      summary: validateMapPlayability(s.doc),
      tasks: this.getTaskSummaries(s.sessionId),
    });
    return { ok: true, task: this.toTaskSummary(task), tasks: this.getTaskSummaries(s.sessionId) };
  }

  revertTask(
    sessionId: string,
    taskId: string,
  ): { ok: true; task: StudioTaskSummary; doc: CustomMapDocument; rev: number; tasks: StudioTaskSummary[] } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: '任务不存在。' };
    if (task.status !== 'review' || !task.beforeDoc) {
      return { ok: false, error: '仅待确认任务支持恢复原样。' };
    }

    const laterCompleted = s.tasks.some(
      (t) => t.id !== task.id && (t.status === 'running' || ((t.completedAt ?? 0) > (task.completedAt ?? 0) && t.status !== 'reverted')),
    );
    const sameDims = s.doc.width === task.beforeDoc.width && s.doc.height === task.beforeDoc.height;

    let restoredDoc: CustomMapDocument;
    if ((task.afterRev === s.rev && !laterCompleted) || task.fullMapChanged || !sameDims) {
      restoredDoc = cloneMapDoc(task.beforeDoc);
    } else {
      restoredDoc = this.surgicalRestoreRegions(s.doc, task.beforeDoc, task.touchedRects, new Set(task.addedIds));
    }

    task.status = 'reverted';
    const patchRect = this.boundingRect(task.touchedRects, restoredDoc.width, restoredDoc.height);
    delete task.beforeDoc;

    const updated = this.updateSessionDraft(sessionId, restoredDoc, {
      patchRect,
      note: `revert:T${task.seq}`,
      pushHistory: true,
    });
    if (!updated.ok) return updated;

    this.emitSession(s, {
      type: 'tasks',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      summary: updated.summary,
      tasks: this.getTaskSummaries(s.sessionId),
      presence: this.getMcpPresence(s.sessionId),
    });
    return {
      ok: true,
      task: this.toTaskSummary(task),
      doc: updated.doc,
      rev: updated.rev,
      tasks: this.getTaskSummaries(s.sessionId),
    };
  }

  private boundingRect(rects: readonly TileRect[], maxW: number, maxH: number): TileRect | undefined {
    if (!rects.length) return undefined;
    let x0 = maxW;
    let y0 = maxH;
    let x1 = 0;
    let y1 = 0;
    for (const r of rects) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return x1 > x0 && y1 > y0
      ? { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(maxW, x1) - Math.max(0, x0), h: Math.min(maxH, y1) - Math.max(0, y0) }
      : undefined;
  }

  private surgicalRestoreRegions(
    curDoc: CustomMapDocument,
    beforeDoc: CustomMapDocument,
    rects: readonly TileRect[],
    addedIds: Set<string>,
  ): CustomMapDocument {
    const out = cloneMapDoc(curDoc);
    const curBuf = FloorGridBuffer.fromDocument(out);
    const oldBuf = FloorGridBuffer.fromDocument(beforeDoc);

    for (const r of rects) {
      const rx0 = Math.max(0, Math.floor(r.x));
      const ry0 = Math.max(0, Math.floor(r.y));
      const rx1 = Math.min(out.width, Math.ceil(r.x + r.w));
      const ry1 = Math.min(out.height, Math.ceil(r.y + r.h));
      for (let y = ry0; y < ry1; y++) {
        for (let x = rx0; x < rx1; x++) {
          const entry = oldBuf.palette[oldBuf.getIndex(x, y)] ?? oldBuf.palette[0];
          curBuf.set(x, y, curBuf.ensurePaletteIndex(entry));
        }
      }
    }
    out.floorPalette = curBuf.palette;
    out.floorRows = curBuf.toRows();

    const hitsAny = (rect: TileRect) => rects.some((r) => rectsOverlap(r, rect));
    const furnRect = (f: CustomFurnitureItem): TileRect => {
      const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      return { x: f.tx, y: f.ty, w: fp.w, h: fp.h };
    };
    const wiRect = (wi: CustomWallItem): TileRect => ({ x: Math.floor(wi.tx), y: Math.floor(wi.ty) - 1, w: 1, h: 2 });
    const rugHit = (rug: CustomRug) => hitsAny({ x: Math.floor(rug.x + rug.w / 2), y: Math.floor(rug.y + rug.h / 2), w: 1, h: 1 });
    const zoneHit = (z: CustomZone) => hitsAny({ x: Math.floor(z.rect.x + z.rect.w / 2), y: Math.floor(z.rect.y + z.rect.h / 2), w: 1, h: 1 });
    const spawnRect = (sp: CustomSpawnPoint): TileRect => ({ x: sp.tx, y: sp.ty, w: 1, h: 1 });

    // 1. Remove items created by this task or touching its regions
    out.furniture = out.furniture.filter((f) => !addedIds.has(f.id) && !hitsAny(furnRect(f)));
    out.wallItems = out.wallItems.filter((w) => !addedIds.has(w.id) && !hitsAny(wiRect(w)));
    out.walls = out.walls.filter((w) => !addedIds.has(w.id) && !hitsAny(wallRect(w)));
    out.rugs = out.rugs.filter((r) => !addedIds.has(r.id) && !rugHit(r));
    out.zones = out.zones.filter((z) => !addedIds.has(z.id) && !zoneHit(z));
    out.spawns = out.spawns.filter((sp) => !addedIds.has(sp.id) && !hitsAny(spawnRect(sp)));

    // 2. Restore original items overlapping these regions
    const fIds = new Set(out.furniture.map((f) => f.id));
    for (const f of beforeDoc.furniture) {
      if (hitsAny(furnRect(f)) && !fIds.has(f.id)) {
        out.furniture.push(f);
        fIds.add(f.id);
      }
    }
    const wiIds = new Set(out.wallItems.map((w) => w.id));
    for (const w of beforeDoc.wallItems) {
      if (hitsAny(wiRect(w)) && !wiIds.has(w.id)) {
        out.wallItems.push(w);
        wiIds.add(w.id);
      }
    }
    const wallIds = new Set(out.walls.map((w) => w.id));
    for (const w of beforeDoc.walls) {
      if (hitsAny(wallRect(w)) && !wallIds.has(w.id)) {
        out.walls.push(w);
        wallIds.add(w.id);
      }
    }
    const rugIds = new Set(out.rugs.map((r) => r.id));
    for (const r of beforeDoc.rugs) {
      if (rugHit(r) && !rugIds.has(r.id)) {
        out.rugs.push(r);
        rugIds.add(r.id);
      }
    }
    const zoneIds = new Set(out.zones.map((z) => z.id));
    for (const z of beforeDoc.zones) {
      if (zoneHit(z) && !zoneIds.has(z.id)) {
        out.zones.push(z);
        zoneIds.add(z.id);
      }
    }
    const spIds = new Set(out.spawns.map((sp) => sp.id));
    for (const sp of beforeDoc.spawns) {
      if (hitsAny(spawnRect(sp)) && !spIds.has(sp.id)) {
        out.spawns.push(sp);
        spIds.add(sp.id);
      }
    }
    out.updatedAt = Date.now();
    return out;
  }

  private collectDocIds(doc: CustomMapDocument): Set<string> {
    const ids = new Set<string>();
    for (const f of doc.furniture) ids.add(f.id);
    for (const w of doc.wallItems) ids.add(w.id);
    for (const w of doc.walls) ids.add(w.id);
    for (const r of doc.rugs) ids.add(r.id);
    for (const z of doc.zones) ids.add(z.id);
    for (const s of doc.spawns) ids.add(s.id);
    return ids;
  }

  updateSessionDraft(
    sessionId: string,
    rawDoc: unknown,
    opts?: { patchRect?: TileRect; note?: string; pushHistory?: boolean },
  ): { ok: true; rev: number; doc: CustomMapDocument; summary: MapValidationReport } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    const parsed = parseCustomMapJson(rawDoc);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const next = parsed.doc;
    next.width = Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, next.width));
    next.height = Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, next.height));
    next.updatedAt = Date.now();

    // Track changes for any running task so surgical regional revert stays exact
    const running = s.tasks.find((t) => t.status === 'running');
    if (running) {
      if (next.width !== s.doc.width || next.height !== s.doc.height) {
        running.fullMapChanged = true;
      }
      if (opts?.patchRect) {
        running.touchedRects.push({ ...opts.patchRect });
      }
      const prevIds = this.collectDocIds(s.doc);
      const added = new Set(running.addedIds);
      for (const id of this.collectDocIds(next)) {
        if (!prevIds.has(id)) added.add(id);
      }
      running.addedIds = [...added];
    }

    if (opts?.pushHistory !== false) {
      s.history = s.history.slice(0, s.historyIndex + 1);
      s.history.push(cloneMapDoc(next));
      if (s.history.length > MAX_HISTORY) s.history.shift();
      s.historyIndex = s.history.length - 1;
    }

    s.doc = next;
    s.rev++;
    s.updatedAt = next.updatedAt;
    this.saveSession(s);
    const summary = validateMapPlayability(next);
    this.emitSession(s, {
      type: 'draft',
      sessionId: s.sessionId,
      rev: s.rev,
      doc: cloneMapDoc(next),
      patchRect: opts?.patchRect,
      selection: s.selection,
      summary,
      ...(opts?.note ? { note: opts.note } : {}),
    });
    return { ok: true, rev: s.rev, doc: cloneMapDoc(next), summary };
  }

  setSessionSelection(
    sessionId: string,
    selection: MapSelection | null,
    draftBoxes?: Array<{ id?: string; label?: string; x: number; y: number; w: number; h: number; note?: string }>,
    draftInstruction?: string,
  ): { ok: true; rev: number; selection: MapSelection | null; draftBoxes: StudioTaskBox[]; draftInstruction?: string } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };

    if (Array.isArray(draftBoxes)) {
      s.draftBoxes = draftBoxes.slice(0, 24).map((b, idx) => {
        const x = Math.max(0, Math.min(s.doc.width - 1, Math.floor(Number(b.x ?? 0))));
        const y = Math.max(0, Math.min(s.doc.height - 1, Math.floor(Number(b.y ?? 0))));
        const w = Math.max(1, Math.min(s.doc.width - x, Math.ceil(Number(b.w ?? 1))));
        const h = Math.max(1, Math.min(s.doc.height - y, Math.ceil(Number(b.h ?? 1))));
        return {
          id: b.id?.trim() || `draft-${idx + 1}`,
          label: b.label?.trim() || `区块 #${idx + 1}`,
          x,
          y,
          w,
          h,
          ...(b.note?.trim() ? { note: String(b.note).trim().slice(0, 500) } : {}),
        };
      });
    }

    if (typeof draftInstruction === 'string') {
      const clean = draftInstruction.trim().slice(0, 800);
      if (clean) s.draftInstruction = clean;
      else delete s.draftInstruction;
    }

    if (selection) {
      const x = Math.max(0, Math.min(s.doc.width - 1, Math.floor(selection.x)));
      const y = Math.max(0, Math.min(s.doc.height - 1, Math.floor(selection.y)));
      const w = Math.max(1, Math.min(s.doc.width - x, Math.ceil(selection.w)));
      const h = Math.max(1, Math.min(s.doc.height - y, Math.ceil(selection.h)));
      s.selection = {
        x,
        y,
        w,
        h,
        ...(selection.note ? { note: String(selection.note).slice(0, 500) } : {}),
        updatedAt: Date.now(),
      };
    } else if (s.draftBoxes.length > 0 && Array.isArray(draftBoxes)) {
      const b0 = s.draftBoxes[0];
      s.selection = {
        x: b0.x,
        y: b0.y,
        w: b0.w,
        h: b0.h,
        ...(b0.note ? { note: b0.note } : {}),
        updatedAt: Date.now(),
      };
    } else {
      s.selection = null;
    }

    s.updatedAt = Date.now();
    this.saveSession(s);
    this.emitSession(s, {
      type: 'selection',
      sessionId: s.sessionId,
      rev: s.rev,
      selection: s.selection,
      draftBoxes: s.draftBoxes,
      ...(s.draftInstruction ? { draftInstruction: s.draftInstruction } : {}),
      summary: validateMapPlayability(s.doc),
    });
    return {
      ok: true,
      rev: s.rev,
      selection: s.selection,
      draftBoxes: s.draftBoxes,
      ...(s.draftInstruction ? { draftInstruction: s.draftInstruction } : {}),
    };
  }

  undoSession(sessionId: string): { ok: true; rev: number; doc: CustomMapDocument; summary: MapValidationReport } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    if (s.historyIndex <= 0) return { ok: false, error: '已到最早一步，无法继续撤销。' };
    s.historyIndex--;
    const restored = cloneMapDoc(s.history[s.historyIndex]);
    s.doc = restored;
    s.rev++;
    s.updatedAt = Date.now();
    this.saveSession(s);
    const summary = validateMapPlayability(restored);
    this.emitSession(s, {
      type: 'draft',
      sessionId: s.sessionId,
      rev: s.rev,
      doc: cloneMapDoc(restored),
      selection: s.selection,
      summary,
      note: 'undo',
    });
    return { ok: true, rev: s.rev, doc: cloneMapDoc(restored), summary };
  }

  redoSession(sessionId: string): { ok: true; rev: number; doc: CustomMapDocument; summary: MapValidationReport } | { ok: false; error: string } {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Studio 会话不存在或已过期。' };
    if (s.historyIndex >= s.history.length - 1) return { ok: false, error: '已是最新状态，无法继续重做。' };
    s.historyIndex++;
    const restored = cloneMapDoc(s.history[s.historyIndex]);
    s.doc = restored;
    s.rev++;
    s.updatedAt = Date.now();
    this.saveSession(s);
    const summary = validateMapPlayability(restored);
    this.emitSession(s, {
      type: 'draft',
      sessionId: s.sessionId,
      rev: s.rev,
      doc: cloneMapDoc(restored),
      selection: s.selection,
      summary,
      note: 'redo',
    });
    return { ok: true, rev: s.rev, doc: cloneMapDoc(restored), summary };
  }

  resizeDoc(doc: CustomMapDocument, width: number, height: number): CustomMapDocument {
    return resizeCustomMap(doc, width, height);
  }
}
