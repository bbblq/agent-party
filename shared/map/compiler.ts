import { FURNITURE, TILE, type Dir, type FloorKind } from '../../client/src/art/api';
import { FOOT_DX, FOOT_DY } from '../../client/src/world/constants';
import { SEAT_FOOT_DY, SEATED_SORT_BIAS } from '../../client/src/world/layout/builder';
import type { BuildingLayout } from '../../client/src/world/layout/building';
import { ARENA_ID, CORE_WALLS } from '../../client/src/world/layout/core';
import { inRect } from '../../client/src/world/layout/geometry';
import type {
  AreaLayout,
  FloorPatch,
  FurniturePlacement,
  SpotDef,
  SpotKind,
  WallItemPlacement,
  WallSegment,
} from '../../client/src/world/layout/types';
import { BLOCKED, FREE, SEAT, WalkGrid } from '../../client/src/world/path/grid';
import { FloorGridBuffer, isWalkableFloorKind } from './codec';
import type { CustomFurnitureItem, CustomMapDocument, CustomWallBlock, CustomWallItem, CustomZone } from './types';

function mergeFloorPatches(buf: FloorGridBuffer): FloorPatch[] {
  const patches: FloorPatch[] = [];
  const { width, height } = buf;
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const idx = buf.getIndex(x, y);
      let x1 = x + 1;
      while (x1 < width && buf.getIndex(x1, y) === idx) x1++;
      const entry = buf.palette[idx] ?? buf.palette[0];
      patches.push({
        kind: entry.kind,
        x: x * TILE,
        y: y * TILE,
        w: (x1 - x) * TILE,
        h: TILE,
        seed: 101 + idx,
        ...(entry.tint ? { tint: entry.tint } : {}),
        ...(entry.tint2 ? { tint2: entry.tint2 } : {}),
      });
      x = x1;
    }
  }
  return patches;
}

function toWallSegment(w: CustomWallBlock): WallSegment {
  const doorways = w.doorways?.length
    ? w.doorways.map((d) => ({ x: (w.tx + d.offset) * TILE, w: d.w * TILE }))
    : undefined;
  if (w.kind === 'face') {
    return { kind: 'face', x: w.tx * TILE, y: w.ty * TILE, w: w.w * TILE, style: w.style, ...(doorways ? { doorways } : {}) };
  }
  if (w.kind === 'south') {
    return { kind: 'south', x: w.tx * TILE, y: w.ty * TILE, w: w.w * TILE, style: w.style, ...(doorways ? { doorways } : {}) };
  }
  return { kind: 'cap', x: w.tx * TILE, y: w.ty * TILE, w: w.w * TILE, h: w.h * TILE, style: w.style };
}

function applyWallToGrid(grid: WalkGrid, buf: FloorGridBuffer, w: CustomWallBlock): void {
  const h = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
  const x0 = Math.max(0, Math.floor(w.tx));
  const y0 = Math.max(0, Math.floor(w.ty));
  const x1 = Math.min(grid.w, Math.ceil(w.tx + w.w));
  const y1 = Math.min(grid.h, Math.ceil(w.ty + h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      grid.set(x, y, BLOCKED);
    }
  }
  if (w.doorways && (w.kind === 'face' || w.kind === 'south')) {
    for (const d of w.doorways) {
      const dx0 = Math.max(0, Math.floor(w.tx + d.offset));
      const dx1 = Math.min(grid.w, Math.ceil(w.tx + d.offset + d.w));
      for (let y = y0; y < y1; y++) {
        for (let x = dx0; x < dx1; x++) {
          grid.set(x, y, FREE);
        }
      }
    }
  }
}

function zoneContaining(zones: readonly CustomZone[], tx: number, ty: number): CustomZone | undefined {
  return zones.find((z) => inRect(z.rect, Math.floor(tx), Math.floor(ty)));
}

function deskCovering(
  furniture: readonly CustomFurnitureItem[],
  kind: 'desk' | 'desk_back' | 'desk_east' | 'desk_west',
  tx: number,
  ty: number,
): CustomFurnitureItem | undefined {
  const fp = FURNITURE[kind].footprint;
  return furniture.find(
    (f) => f.kind === kind && tx >= f.tx && tx < f.tx + fp.w && ty >= f.ty && ty < f.ty + fp.h,
  );
}

function nearestApproach(grid: WalkGrid, tx: number, ty: number, preferredDx = 0, preferredDy = 1): { tx: number; ty: number; dir: Dir } {
  const px = tx + preferredDx;
  const py = ty + preferredDy;
  if (grid.walkable(px, py)) {
    const dir: Dir = preferredDy > 0 ? 'up' : preferredDy < 0 ? 'down' : preferredDx > 0 ? 'left' : 'right';
    return { tx: px, ty: py, dir };
  }
  const cands: Array<[number, number, Dir]> = [
    [0, 1, 'up'],
    [0, -1, 'down'],
    [1, 0, 'left'],
    [-1, 0, 'right'],
  ];
  for (const [dx, dy, dir] of cands) {
    if (grid.walkable(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy, dir };
  }
  return { tx: Math.max(0, Math.min(grid.w - 1, px)), ty: Math.max(0, Math.min(grid.h - 1, py)), dir: 'up' };
}

function makeSeatSpot(
  id: string,
  kind: SpotKind,
  areaId: string,
  tx: number,
  ty: number,
  dir: Dir,
  furnitureId: string,
  opts: {
    dx?: number;
    dy?: number;
    deskId?: string;
    rank?: number;
    side?: 'S' | 'N';
    reservedFor?: string;
    tags?: string[];
  } = {},
): SpotDef {
  const base = (ty + 1) * TILE;
  return {
    id,
    kind,
    areaId,
    tx,
    ty,
    x: tx * TILE + TILE / 2 + (opts.dx ?? 0),
    y: base - SEAT_FOOT_DY + (opts.dy ?? 0),
    dir,
    seated: true,
    furnitureId,
    sortY: base + SEATED_SORT_BIAS,
    ...(opts.deskId ? { deskId: opts.deskId } : {}),
    ...(opts.rank !== undefined ? { rank: opts.rank } : {}),
    ...(opts.side ? { side: opts.side } : {}),
    ...(opts.reservedFor ? { reservedFor: opts.reservedFor } : {}),
    ...(opts.tags ? { tags: opts.tags } : {}),
  };
}

function makeStandSpot(
  id: string,
  kind: SpotKind,
  areaId: string,
  tx: number,
  ty: number,
  dir: Dir,
  opts: {
    dx?: number;
    dy?: number;
    x?: number;
    y?: number;
    furnitureId?: string;
    sortY?: number;
    group?: string;
    reservedFor?: string;
    tags?: string[];
  } = {},
): SpotDef {
  return {
    id,
    kind,
    areaId,
    tx,
    ty,
    x: opts.x ?? tx * TILE + FOOT_DX + (opts.dx ?? 0),
    y: opts.y ?? ty * TILE + FOOT_DY + (opts.dy ?? 0),
    dir,
    ...(opts.furnitureId ? { furnitureId: opts.furnitureId } : {}),
    ...(opts.sortY !== undefined ? { sortY: opts.sortY } : {}),
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.reservedFor ? { reservedFor: opts.reservedFor } : {}),
    ...(opts.tags ? { tags: opts.tags } : {}),
  };
}

export function compileCustomMap(doc: CustomMapDocument, version = 0): BuildingLayout {
  const buf = FloorGridBuffer.fromDocument(doc);
  const grid = new WalkGrid(doc.width, doc.height, version);

  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      const entry = buf.getEntry(x, y);
      grid.set(x, y, isWalkableFloorKind(entry.kind) ? FREE : BLOCKED);
    }
  }

  for (const w of doc.walls) {
    applyWallToGrid(grid, buf, w);
  }

  for (const f of doc.furniture) {
    const def = FURNITURE[f.kind];
    if (!def || def.mount !== 'floor') continue;
    const { w, h } = def.footprint;
    if (def.blocks) {
      grid.fill(f.tx, f.ty, w, h, BLOCKED);
    } else if (def.seat) {
      for (let yy = f.ty; yy < f.ty + h; yy++) {
        for (let xx = f.tx; xx < f.tx + w; xx++) {
          if (grid.get(xx, yy) === FREE) grid.set(xx, yy, SEAT);
        }
      }
    }
  }

  const areaMap = new Map<string, AreaLayout>();
  const ensureZoneArea = (z: CustomZone): AreaLayout => {
    let a = areaMap.get(z.id);
    if (!a) {
      a = {
        id: z.id,
        kind: z.kind,
        rect: { ...z.rect },
        floors: [],
        rugs: [],
        walls: [],
        wallItems: [],
        furniture: [],
        spots: [],
        walkable: [{ ...z.rect }],
        ...(z.floorTint ? { floorTint: z.floorTint } : {}),
      };
      areaMap.set(z.id, a);
    }
    return a;
  };

  for (const z of doc.zones) {
    ensureZoneArea(z);
  }

  const commonAreaId = 'custom:common';
  const commonArea: AreaLayout = {
    id: commonAreaId,
    kind: 'corridor',
    rect: { x: 0, y: 0, w: doc.width, h: doc.height },
    floors: mergeFloorPatches(buf),
    rugs: doc.rugs.map((r, i) => ({
      x: Math.round(r.x * TILE),
      y: Math.round(r.y * TILE),
      w: Math.round(r.w * TILE),
      h: Math.round(r.h * TILE),
      color: r.color,
      seed: r.seed ?? 700 + i,
    })),
    walls: doc.walls.map(toWallSegment),
    wallItems: [],
    furniture: [],
    spots: [],
    walkable: [{ x: 0, y: 0, w: doc.width, h: doc.height }],
  };

  const targetAreaFor = (tx: number, ty: number, preferredZoneId?: string): AreaLayout => {
    if (preferredZoneId && areaMap.has(preferredZoneId)) return areaMap.get(preferredZoneId)!;
    const z = zoneContaining(doc.zones, tx, ty);
    return z ? areaMap.get(z.id)! : commonArea;
  };

  // Wall items
  let elevSeq = 0;
  for (const wi of doc.wallItems) {
    const area = targetAreaFor(wi.tx, wi.ty - (wi.on === 'face' ? 1 : 0), wi.zoneId);
    const placed: WallItemPlacement = {
      id: wi.id,
      kind: wi.kind,
      ...(wi.variant ? { variant: wi.variant } : {}),
      cx: Math.round(wi.tx * TILE),
      baseY: Math.round(wi.ty * TILE),
      on: wi.on,
      order: 0.5,
    };
    area.wallItems.push(placed);
    if (wi.kind === 'sign' && !area.signId) {
      area.signId = wi.id;
    }

    const baseTx = Math.max(0, Math.min(doc.width - 1, Math.floor(wi.tx)));
    const frontTy = Math.max(0, Math.min(doc.height - 1, Math.floor(wi.ty)));
    if (wi.kind === 'elevator') {
      const lx = Math.max(0, Math.min(doc.width - 1, Math.floor(wi.tx - 0.5)));
      area.spots.push(
        makeStandSpot(`${wi.id}#spot`, 'elevator', area.id, lx, frontTy, 'up', {
          x: wi.tx * TILE,
          y: frontTy * TILE + 2,
          group: `elevator:${elevSeq++}`,
        }),
      );
    } else if (wi.kind === 'window') {
      area.spots.push(makeStandSpot(`${wi.id}#spot`, 'window', area.id, baseTx, frontTy, 'up', { dx: 8, dy: 1 }));
    } else if (wi.kind === 'whiteboard') {
      area.spots.push(makeStandSpot(`${wi.id}#spot`, 'whiteboard', area.id, baseTx, frontTy, 'up', { dx: 8, dy: 2 }));
    } else if (wi.kind === 'light_switch') {
      const swTy = wi.on === 'south' ? Math.max(0, frontTy - 2) : frontTy;
      area.spots.push(
        makeStandSpot(`${wi.id}#spot`, 'switch', area.id, baseTx, swTy, wi.on === 'south' ? 'down' : 'up', {
          dy: wi.on === 'south' ? -1 : -3,
        }),
      );
    }
  }

  // Track desk rank per area
  const deskRankByArea = new Map<string, number>();
  const nextRank = (areaId: string): number => {
    const n = deskRankByArea.get(areaId) ?? 0;
    deskRankByArea.set(areaId, n + 1);
    return n;
  };

  // Floor furniture + auto spots
  for (const f of doc.furniture) {
    const area = targetAreaFor(f.tx, f.ty);
    const placement: FurniturePlacement = {
      id: f.id,
      kind: f.kind,
      ...(f.variant ? { variant: f.variant } : {}),
      tx: f.tx,
      ty: f.ty,
      ...(f.dx !== undefined ? { dx: f.dx } : {}),
      ...(f.dy !== undefined ? { dy: f.dy } : {}),
      order: 0.5,
      ...(f.seat ? { seat: f.seat } : {}),
    };
    area.furniture.push(placement);

    const commonOpts = {
      ...(f.dx !== undefined ? { dx: f.dx } : {}),
      ...(f.dy !== undefined ? { dy: f.dy } : {}),
      ...(f.reservedFor ? { reservedFor: f.reservedFor } : {}),
      ...(f.tags ? { tags: f.tags } : {}),
    };

    switch (f.kind) {
      case 'office_chair': {
        const d = f.deskId
          ? doc.furniture.find((x) => x.id === f.deskId)
          : deskCovering(doc.furniture, 'desk', f.tx, f.ty - 1);
        area.spots.push(
          makeSeatSpot(`${f.id}#spot`, 'desk', area.id, f.tx, f.ty, f.dir ?? 'up', f.id, {
            ...commonOpts,
            deskId: d?.id,
            side: 'S',
            rank: nextRank(area.id),
          }),
        );
        break;
      }
      case 'office_chair_front': {
        const d = f.deskId
          ? doc.furniture.find((x) => x.id === f.deskId)
          : deskCovering(doc.furniture, 'desk_back', f.tx, f.ty + 1);
        area.spots.push(
          makeSeatSpot(`${f.id}#spot`, 'desk', area.id, f.tx, f.ty, f.dir ?? 'down', f.id, {
            ...commonOpts,
            deskId: d?.id,
            side: 'N',
            rank: nextRank(area.id),
          }),
        );
        break;
      }
      case 'office_chair_left': {
        const d = f.deskId
          ? doc.furniture.find((x) => x.id === f.deskId)
          : deskCovering(doc.furniture, 'desk_east', f.tx - 1, f.ty);
        area.spots.push(
          makeSeatSpot(`${f.id}#spot`, 'desk', area.id, f.tx, f.ty, f.dir ?? 'left', f.id, {
            ...commonOpts,
            deskId: d?.id,
            rank: nextRank(area.id),
          }),
        );
        break;
      }
      case 'office_chair_right': {
        const d = f.deskId
          ? doc.furniture.find((x) => x.id === f.deskId)
          : deskCovering(doc.furniture, 'desk_west', f.tx + 1, f.ty);
        area.spots.push(
          makeSeatSpot(`${f.id}#spot`, 'desk', area.id, f.tx, f.ty, f.dir ?? 'right', f.id, {
            ...commonOpts,
            deskId: d?.id,
            rank: nextRank(area.id),
          }),
        );
        break;
      }
      case 'stool':
        area.spots.push(makeSeatSpot(`${f.id}#spot`, 'stool', area.id, f.tx, f.ty, f.dir ?? 'down', f.id, commonOpts));
        break;
      case 'cafe_chair':
        area.spots.push(
          makeSeatSpot(
            `${f.id}#spot`,
            'cafe_seat',
            area.id,
            f.tx,
            f.ty,
            (f.variant as Dir) || f.dir || 'down',
            f.id,
            commonOpts,
          ),
        );
        break;
      case 'armchair':
        area.spots.push(
          makeSeatSpot(
            `${f.id}#spot`,
            area.kind === 'room' ? 'nook' : 'armchair',
            area.id,
            f.tx,
            f.ty,
            (f.variant as Dir) || f.dir || 'down',
            f.id,
            commonOpts,
          ),
        );
        break;
      case 'beanbag':
        area.spots.push(
          makeSeatSpot(
            `${f.id}#spot`,
            area.kind === 'room' ? 'nook' : 'beanbag',
            area.id,
            f.tx,
            f.ty,
            f.dir ?? 'down',
            f.id,
            commonOpts,
          ),
        );
        break;
      case 'sofa': {
        const dir: Dir = f.variant === 'up' ? 'up' : 'down';
        for (let i = 0; i < 3; i++) {
          area.spots.push(makeSeatSpot(`${f.id}#spot${i}`, 'sofa', area.id, f.tx + i, f.ty, dir, f.id, commonOpts));
        }
        break;
      }
      case 'bench':
        for (let i = 0; i < 2; i++) {
          area.spots.push(
            makeSeatSpot(`${f.id}#spot${i}`, 'bench', area.id, f.tx + i, f.ty, f.dir ?? 'down', f.id, commonOpts),
          );
        }
        break;
      case 'coffee_machine': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(
          makeStandSpot(`${f.id}#spot`, 'coffee', area.id, ap.tx, ap.ty, ap.dir, { furnitureId: f.id, dy: -3 }),
        );
        break;
      }
      case 'water_cooler': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(makeStandSpot(`${f.id}#spot`, 'water', area.id, ap.tx, ap.ty, ap.dir, { furnitureId: f.id, dy: -3 }));
        break;
      }
      case 'vending_machine': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(
          makeStandSpot(`${f.id}#spot`, 'snack', area.id, ap.tx, ap.ty, ap.dir, { furnitureId: f.id, dy: -3 }),
        );
        break;
      }
      case 'fridge': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(makeStandSpot(`${f.id}#spot`, 'fridge', area.id, ap.tx, ap.ty, ap.dir, { dy: -3 }));
        break;
      }
      case 'sink':
      case 'counter_sink': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(makeStandSpot(`${f.id}#spot`, 'sink', area.id, ap.tx, ap.ty, ap.dir, { dy: -3 }));
        break;
      }
      case 'arcade': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(makeStandSpot(`${f.id}#spot`, 'arcade', area.id, ap.tx, ap.ty, ap.dir, { dy: -3 }));
        break;
      }
      case 'bookshelf': {
        const ap = nearestApproach(grid, f.tx, f.ty, 0, 1);
        area.spots.push(makeStandSpot(`${f.id}#spot`, 'shelf', area.id, ap.tx, ap.ty, ap.dir, { dx: 8, dy: -2 }));
        break;
      }
      case 'toilet_stall': {
        const sy = Math.min(doc.height - 1, f.ty + 2);
        area.spots.push(
          makeStandSpot(`${f.id}#spot`, 'stall', area.id, f.tx, sy, 'up', {
            furnitureId: f.id,
            x: (f.tx + 1) * TILE,
            y: sy * TILE - 3,
            sortY: sy * TILE - 0.5,
          }),
        );
        break;
      }
      case 'pingpong_table': {
        const ly = Math.min(doc.height - 1, f.ty + 1);
        const ppY = ly * TILE + 5;
        const ppSort = (f.ty + 2) * TILE + SEATED_SORT_BIAS;
        const lxLeft = Math.max(0, f.tx - 1);
        const lxRight = Math.min(doc.width - 1, f.tx + 3);
        const grp = `pingpong:${f.id}`;
        area.spots.push(
          makeStandSpot(`${f.id}#spotL`, 'pingpong', area.id, lxLeft, ly, 'right', {
            x: f.tx * TILE - 8,
            y: ppY,
            group: grp,
            sortY: ppSort,
          }),
          makeStandSpot(`${f.id}#spotR`, 'pingpong', area.id, lxRight, ly, 'left', {
            x: (f.tx + 3) * TILE + 8,
            y: ppY,
            group: grp,
            sortY: ppSort,
          }),
        );
        break;
      }
      case 'entrance_mat':
        area.spots.push(
          makeStandSpot(`${f.id}#spot`, 'spawn', area.id, f.tx, f.ty, f.dir ?? 'down', {
            x: (f.tx + 1) * TILE,
            y: f.ty * TILE + FOOT_DY,
          }),
        );
        break;
      default:
        break;
    }
  }

  // Explicit spawn points
  for (const sp of doc.spawns) {
    const area = targetAreaFor(sp.tx, sp.ty);
    area.spots.push(makeStandSpot(sp.id, 'spawn', area.id, sp.tx, sp.ty, sp.dir ?? 'down'));
  }

  // Explicit spot overrides / additions
  if (doc.spots?.length) {
    for (const sp of doc.spots) {
      const area = targetAreaFor(sp.tx, sp.ty, sp.areaId);
      const next = sp.seated
        ? makeSeatSpot(sp.id, sp.kind, area.id, sp.tx, sp.ty, sp.dir, sp.furnitureId ?? sp.id, sp)
        : makeStandSpot(sp.id, sp.kind, area.id, sp.tx, sp.ty, sp.dir, sp);
      area.spots.push(next);
    }
  }

  // Arena zone auto-spots if not explicitly provided
  let arenaArea: AreaLayout | null = null;
  for (const z of doc.zones) {
    if (z.kind !== 'arena') continue;
    const area = areaMap.get(z.id)!;
    if (!arenaArea) arenaArea = area;
    const hasFight = area.spots.some((s) => s.kind === 'arena_fight');
    if (!hasFight && z.rect.w >= 10 && z.rect.h >= 8) {
      const cx = Math.floor(z.rect.x + z.rect.w / 2);
      const cy = Math.floor(z.rect.y + z.rect.h / 2);
      const lx = Math.max(z.rect.x + 1, cx - 4);
      const rx = Math.min(z.rect.x + z.rect.w - 2, cx + 3);
      area.spots.push(
        makeStandSpot(`${z.id}#fightL`, 'arena_fight', area.id, lx, cy, 'right', { group: 'arena:ring' }),
        makeStandSpot(`${z.id}#fightR`, 'arena_fight', area.id, rx, cy, 'left', { group: 'arena:ring' }),
      );
      const wyN = Math.max(z.rect.y + 2, cy - 3);
      const wyS = Math.min(z.rect.y + z.rect.h - 2, cy + 3);
      for (const [wx, wy, dir, idx] of [
        [lx - 1, wyN, 'down', 0],
        [lx + 1, wyN, 'down', 1],
        [rx - 1, wyN, 'down', 2],
        [rx + 1, wyN, 'down', 3],
        [lx, wyS, 'up', 4],
        [rx, wyS, 'up', 5],
      ] as const) {
        if (grid.walkable(wx, wy)) {
          area.spots.push(makeStandSpot(`${z.id}#watch${idx}`, 'arena_watch', area.id, wx, wy, dir, { group: 'arena:watch' }));
        }
      }
    }
  }

  // Ensure every project room zone has shade rect & deterministic fallback if no switch
  for (const z of doc.zones) {
    const area = areaMap.get(z.id)!;
    if (z.kind === 'room') {
      area.shade = {
        x: z.rect.x * TILE,
        y: z.rect.y * TILE,
        w: z.rect.w * TILE,
        h: z.rect.h * TILE,
      };
    }
  }

  const allAreas = [commonArea, ...areaMap.values()];
  const core: AreaLayout[] = [commonArea];
  const rooms: AreaLayout[] = [];
  for (const area of areaMap.values()) {
    if (area.kind === 'room') rooms.push(area);
    else core.push(area);
  }

  // Deduplicate spot IDs just in case user edited JSON manually
  const seenSpots = new Set<string>();
  const spots: SpotDef[] = [];
  for (const a of allAreas) {
    for (let i = 0; i < a.spots.length; i++) {
      let sp = a.spots[i];
      if (seenSpots.has(sp.id)) {
        sp = { ...sp, id: `${sp.id}#${spots.length}` };
        a.spots[i] = sp;
      }
      seenSpots.add(sp.id);
      spots.push(sp);
    }
  }

  // If custom map placed an arena area with id !== ARENA_ID, ArenaController will match either area.id or ARENA_ID
  if (arenaArea && arenaArea.id !== ARENA_ID) {
    // Keep area.id intact; ArenaController resolves dynamically from building.arena
  }

  const cols = Math.max(1, Math.ceil(doc.width / 16));
  const corridor = commonArea;

  return {
    cols,
    rect: { x: 0, y: 0, w: doc.width, h: doc.height },
    core,
    arena: arenaArea,
    corridor,
    rooms,
    grid,
    spots,
    custom: true,
    mapWidth: doc.width,
    mapHeight: doc.height,
    customDoc: doc,
  };
}

/** Helper to paint default room shell walls onto a CustomMapDocument (used by templates & MCP). */
export function buildCustomRoomWalls(
  idPrefix: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: CustomWallBlock['style'] = CORE_WALLS.reception,
  doors: Array<{ side: 'north' | 'south'; offset: number; w: number }> = [{ side: 'south', offset: Math.max(1, Math.floor(w / 2) - 1), w: 2 }],
): CustomWallBlock[] {
  const northDoors = doors.filter((d) => d.side === 'north').map((d) => ({ offset: d.offset, w: d.w }));
  const southDoors = doors.filter((d) => d.side === 'south').map((d) => ({ offset: d.offset, w: d.w }));
  const walls: CustomWallBlock[] = [
    {
      id: `${idPrefix}:north`,
      kind: 'face',
      tx: x,
      ty: y,
      w,
      h: 2,
      style,
      ...(northDoors.length ? { doorways: northDoors } : {}),
    },
    {
      id: `${idPrefix}:south`,
      kind: 'south',
      tx: x,
      ty: y + h - 1,
      w,
      h: 1,
      style,
      ...(southDoors.length ? { doorways: southDoors } : {}),
    },
    {
      id: `${idPrefix}:west`,
      kind: 'cap',
      tx: x,
      ty: y,
      w: 1,
      h,
      style,
    },
    {
      id: `${idPrefix}:east`,
      kind: 'cap',
      tx: x + w - 1,
      ty: y,
      w: 1,
      h,
      style,
    },
  ];
  return walls;
}

export function defaultFloorEntry(kind: FloorKind): { kind: FloorKind } {
  return { kind };
}
