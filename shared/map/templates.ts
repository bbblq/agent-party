import { FURNITURE, type Dir, type RoomTheme } from '../../client/src/art/api';
import { assembleBuilding } from '../../client/src/world/layout/building';
import { CORE_WALLS } from '../../client/src/world/layout/core';
import { layoutProjectRoom } from '../../client/src/world/layout/room';
import { TILE } from '../../client/src/world/constants';
import { FloorGridBuffer, clampMapDim } from './codec';
import { buildCustomRoomWalls } from './compiler';
import {
  DEFAULT_MAP_H,
  DEFAULT_MAP_W,
  MAP_FORMAT,
  type CustomFurnitureItem,
  type CustomMapDocument,
  type CustomRug,
  type CustomWallBlock,
  type CustomWallItem,
  type CustomZone,
} from './types';

const FALLBACK_THEME: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

/** Blank editable park/campus canvas with a starter paved pad and entrance mat. */
export function createBlankCustomMap(
  name = '自定义办公园区',
  width = DEFAULT_MAP_W,
  height = DEFAULT_MAP_H,
  id = `map-${Date.now().toString(36)}`,
): CustomMapDocument {
  const w = clampMapDim(width, DEFAULT_MAP_W);
  const h = clampMapDim(height, DEFAULT_MAP_H);
  const buf = new FloorGridBuffer(w, h, [{ kind: 'grass' }]);

  const rw = Math.min(24, w - 4);
  const rh = Math.min(16, h - 4);
  const rx = Math.max(2, Math.floor((w - rw) / 2));
  const ry = Math.max(2, Math.floor((h - rh) / 2));
  buf.fillRect(rx, ry, rw, rh, { kind: 'marble' });

  const doorOffset = Math.max(2, Math.floor(rw / 2) - 1);
  const walls = buildCustomRoomWalls('starter', rx, ry, rw, rh, CORE_WALLS.reception, [
    { side: 'south', offset: doorOffset, w: 2 },
  ]);

  const spawnX = rx + doorOffset;
  const spawnY = ry + rh - 2;

  return {
    format: MAP_FORMAT,
    schemaVersion: 1,
    id,
    name,
    width: w,
    height: h,
    updatedAt: Date.now(),
    backgroundFloor: 'grass',
    floorPalette: buf.palette,
    floorRows: buf.toRows(),
    rugs: [
      { id: 'starter-rug', x: rx + 3, y: ry + 4, w: Math.max(4, rw - 6), h: Math.max(4, rh - 8), color: '#4f78b8', seed: 11 },
    ],
    walls,
    wallItems: [
      { id: 'starter-sign', kind: 'sign', tx: rx + rw / 2, ty: ry + 2, on: 'face', zoneId: 'zone-main' },
      { id: 'starter-win-1', kind: 'window', tx: rx + 3, ty: ry + 2, on: 'face', zoneId: 'zone-main' },
      { id: 'starter-win-2', kind: 'window', tx: rx + rw - 3, ty: ry + 2, on: 'face', zoneId: 'zone-main' },
      { id: 'starter-sw', kind: 'light_switch', tx: rx + doorOffset - 1, ty: ry + rh, on: 'south', variant: 'on', zoneId: 'zone-main' },
    ],
    furniture: [
      { id: 'starter-mat', kind: 'entrance_mat', tx: spawnX, ty: spawnY, variant: 'blue', dir: 'up' },
      { id: 'starter-desk-1', kind: 'desk', tx: rx + 4, ty: ry + 5, variant: 'wood' },
      { id: 'starter-chair-1', kind: 'office_chair', tx: rx + 4, ty: ry + 6, variant: 'black', dir: 'up' },
      { id: 'starter-desk-2', kind: 'desk_east', tx: rx + 8, ty: ry + 5, variant: 'white' },
      { id: 'starter-chair-2', kind: 'office_chair_left', tx: rx + 9, ty: ry + 5, variant: 'blue', dir: 'left' },
      { id: 'starter-desk-3', kind: 'desk_west', tx: rx + rw - 5, ty: ry + 5, variant: 'dark' },
      { id: 'starter-chair-3', kind: 'office_chair_right', tx: rx + rw - 6, ty: ry + 5, variant: 'green', dir: 'right' },
      { id: 'starter-plant-1', kind: 'plant_tall', tx: rx + 1, ty: ry + 2, variant: 'monstera' },
      { id: 'starter-coffee', kind: 'coffee_machine', tx: rx + rw - 3, ty: ry + 2 },
    ],
    zones: [
      {
        id: 'zone-main',
        name: '主办公大厅',
        kind: 'room',
        rect: { x: rx, y: ry, w: rw, h: rh },
        accentColor: '#3f7fd8',
        hasLightSwitch: true,
      },
    ],
    props: [],
    spawns: [{ id: 'main-spawn', tx: spawnX, ty: spawnY, dir: 'up' }],
  };
}

/** Pure empty grass-only canvas (ideal for scratch room tabs & cross-map assembly). */
export function createBlankGrassMap(
  width = 32,
  height = 24,
  name = '空白草地草稿',
  id = `map-${Date.now().toString(36)}`,
): CustomMapDocument {
  const w = clampMapDim(width, 32);
  const h = clampMapDim(height, 24);
  const buf = new FloorGridBuffer(w, h, [{ kind: 'grass' }]);
  return {
    format: MAP_FORMAT,
    schemaVersion: 1,
    id,
    name,
    width: w,
    height: h,
    updatedAt: Date.now(),
    backgroundFloor: 'grass',
    floorPalette: buf.palette,
    floorRows: buf.toRows(),
    rugs: [],
    walls: [],
    wallItems: [],
    furniture: [],
    zones: [],
    props: [],
    spawns: [],
  };
}

/** Converts the default built-in Agent Party office (with rooms & core areas) into a CustomMapDocument. */
export function createStarterOfficeMap(
  roomCount = 2,
  canvasWidth = DEFAULT_MAP_W,
  canvasHeight = DEFAULT_MAP_H,
  name = '默认办公室扩展模板',
): CustomMapDocument {
  const rooms = Array.from({ length: Math.max(1, roomCount) }, (_, i) =>
    layoutProjectRoom({ id: i === 0 ? 'office-main' : `office-${i + 1}`, slot: i, seed: 42 + i * 17 }, FALLBACK_THEME),
  );
  const b = assembleBuilding(Math.max(3, 2 + Math.ceil(rooms.length / 2) + 1), rooms, 0);
  const w = clampMapDim(Math.max(canvasWidth, b.rect.w + 16), DEFAULT_MAP_W);
  const h = clampMapDim(Math.max(canvasHeight, b.rect.h + 16), DEFAULT_MAP_H);
  const ox = Math.floor((w - b.rect.w) / 2);
  const oy = Math.floor((h - b.rect.h) / 2);

  const buf = new FloorGridBuffer(w, h, [{ kind: 'grass' }]);
  const rugs: CustomRug[] = [];
  const walls: CustomWallBlock[] = [];
  const wallItems: CustomWallItem[] = [];
  const furniture: CustomFurnitureItem[] = [];
  const zones: CustomZone[] = [];

  const allAreas = [...b.core, b.corridor, ...b.rooms];
  for (const area of allAreas) {
    for (const fl of area.floors) {
      const fx = ox + Math.round(fl.x / TILE);
      const fy = oy + Math.round(fl.y / TILE);
      const fw = Math.max(1, Math.round(fl.w / TILE));
      const fh = Math.max(1, Math.round(fl.h / TILE));
      buf.fillRect(fx, fy, fw, fh, {
        kind: fl.kind,
        ...(fl.tint ? { tint: fl.tint } : {}),
        ...(fl.tint2 ? { tint2: fl.tint2 } : {}),
      });
    }
    for (let i = 0; i < area.rugs.length; i++) {
      const r = area.rugs[i];
      rugs.push({
        id: `${area.id}#rug${i}`,
        x: ox + r.x / TILE,
        y: oy + r.y / TILE,
        w: r.w / TILE,
        h: r.h / TILE,
        color: r.color,
        seed: r.seed,
      });
    }
    for (let i = 0; i < area.walls.length; i++) {
      const seg = area.walls[i];
      if (seg.kind === 'cap') {
        walls.push({
          id: `${area.id}#wall${i}`,
          kind: 'cap',
          tx: ox + seg.x / TILE,
          ty: oy + seg.y / TILE,
          w: seg.w / TILE,
          h: seg.h / TILE,
          style: seg.style,
        });
      } else {
        walls.push({
          id: `${area.id}#wall${i}`,
          kind: seg.kind,
          tx: ox + seg.x / TILE,
          ty: oy + seg.y / TILE,
          w: seg.w / TILE,
          h: seg.kind === 'face' ? 2 : 1,
          style: seg.style,
          ...(seg.doorways?.length
            ? {
                doorways: seg.doorways.map((d) => ({
                  offset: (d.x - seg.x) / TILE,
                  w: d.w / TILE,
                })),
              }
            : {}),
        });
      }
    }
    for (const wi of area.wallItems) {
      wallItems.push({
        id: wi.id,
        kind: wi.kind,
        tx: ox + wi.cx / TILE,
        ty: oy + wi.baseY / TILE,
        on: wi.on,
        ...(wi.variant ? { variant: wi.variant } : {}),
        zoneId: area.id,
      });
    }
    for (const f of area.furniture) {
      let dir: Dir | undefined;
      if (f.kind === 'office_chair') dir = 'up';
      else if (f.kind === 'office_chair_front') dir = 'down';
      else if (f.kind === 'office_chair_left') dir = 'left';
      else if (f.kind === 'office_chair_right') dir = 'right';
      else if (f.variant === 'up' || f.variant === 'down' || f.variant === 'left' || f.variant === 'right') {
        dir = f.variant;
      }
      furniture.push({
        id: f.id,
        kind: f.kind,
        tx: ox + f.tx,
        ty: oy + f.ty,
        ...(f.variant ? { variant: f.variant } : {}),
        ...(f.dx !== undefined ? { dx: f.dx } : {}),
        ...(f.dy !== undefined ? { dy: f.dy } : {}),
        ...(dir ? { dir } : {}),
        ...(f.seat ? { seat: f.seat } : {}),
      });
    }

    const zoneNames: Record<string, string> = {
      'core:recepcao': '前台大厅',
      'core:banheiros': '洗手间',
      'core:copa': '茶水间',
      'core:lounge': '休息室',
      'core:arena': '宝可梦决斗场',
      'core:corredor': '中央走廊',
    };
    const isRoom = area.kind === 'room';
    const roomIdx = b.rooms.indexOf(area);
    zones.push({
      id: area.id,
      name: zoneNames[area.id] ?? (isRoom ? (roomIdx === 0 ? '办公区' : `办公区 ${roomIdx + 1}`) : area.id),
      kind: area.kind,
      rect: { x: ox + area.rect.x, y: oy + area.rect.y, w: area.rect.w, h: area.rect.h },
      ...(area.floorTint ? { floorTint: area.floorTint } : {}),
      ...(isRoom ? { accentColor: '#3f7fd8', hasLightSwitch: true } : {}),
    });
  }

  // Ensure entrance path outside west glass partition is walkable sidewalk
  buf.fillRect(Math.max(0, ox - 3), oy + 12, 4, 5, { kind: 'sidewalk' });
  const spawns = [{ id: 'west-entry', tx: Math.max(0, ox - 1), ty: oy + 14, dir: 'right' as Dir }];

  // Deduplicate furniture that might overlap footprint boundaries cleanly
  const seenBlocks = new Set<string>();
  const cleanFurniture = furniture.filter((f) => {
    const def = FURNITURE[f.kind];
    if (!def?.blocks) return true;
    for (let y = f.ty; y < f.ty + def.footprint.h; y++) {
      for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
        const k = `${x},${y}`;
        if (seenBlocks.has(k)) return false;
      }
    }
    for (let y = f.ty; y < f.ty + def.footprint.h; y++) {
      for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
        seenBlocks.add(`${x},${y}`);
      }
    }
    return true;
  });

  return {
    format: MAP_FORMAT,
    schemaVersion: 1,
    id: `office-${Date.now().toString(36)}`,
    name,
    width: w,
    height: h,
    updatedAt: Date.now(),
    backgroundFloor: 'grass',
    floorPalette: buf.palette,
    floorRows: buf.toRows(),
    rugs,
    walls,
    wallItems,
    furniture: cleanFurniture,
    zones,
    props: [],
    spawns,
  };
}
