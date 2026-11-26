import { FURNITURE, type Dir, type FurnitureKind } from '../../client/src/art/api';
import type { TileRect } from '../../client/src/world/layout/types';
import { cloneCustomMap, decodeFloorRows, encodeFloorRows, FloorGridBuffer } from './codec';
import type {
  CustomFurnitureItem,
  CustomLayerGroup,
  CustomMapDocument,
  CustomRug,
  CustomSpawnPoint,
  CustomWallBlock,
  CustomWallItem,
  CustomZone,
  FloorPaletteEntry,
  SpriteRot,
} from './types';

export type TransformOp = 'rot90' | 'rot270' | 'flipX' | 'flipY';

export type MapElementLayerType = 'furniture' | 'wallItem' | 'wall' | 'rug' | 'zone' | 'spawn';

export interface MapElementRef {
  layer: MapElementLayerType;
  id: string;
}

export const CLIPBOARD_FORMAT = 'agent-party-clipboard@2' as const;

export interface MapClipboardPayload {
  format: typeof CLIPBOARD_FORMAT;
  copiedAt: number;
  sourceName: string;
  width: number;
  height: number;
  hasFloor: boolean;
  floorPalette?: FloorPaletteEntry[];
  floorRows?: string[];
  groups: CustomLayerGroup[];
  furniture: CustomFurnitureItem[];
  wallItems: CustomWallItem[];
  walls: CustomWallBlock[];
  rugs: CustomRug[];
  zones: CustomZone[];
  spawns: CustomSpawnPoint[];
}

const DESK_CYCLE: readonly FurnitureKind[] = ['desk', 'desk_east', 'desk_back', 'desk_west'];
const CHAIR_CYCLE: readonly FurnitureKind[] = ['office_chair', 'office_chair_right', 'office_chair_down' as never];
const OFFICE_CHAIR_CYCLE: readonly FurnitureKind[] = [
  'office_chair',
  'office_chair_right',
  'office_chair_front',
  'office_chair_left',
];
const VARIANT_DIR_CYCLE: readonly Dir[] = ['up', 'right', 'down', 'left'];
void CHAIR_CYCLE;

function rotateDir(dir: Dir | undefined, op: TransformOp): Dir | undefined {
  if (!dir) return undefined;
  const idx = VARIANT_DIR_CYCLE.indexOf(dir);
  if (idx < 0) return dir;
  if (op === 'rot90') return VARIANT_DIR_CYCLE[(idx + 1) % 4];
  if (op === 'rot270') return VARIANT_DIR_CYCLE[(idx + 3) % 4];
  if (op === 'flipX') {
    if (dir === 'left') return 'right';
    if (dir === 'right') return 'left';
    return dir;
  }
  if (dir === 'up') return 'down';
  if (dir === 'down') return 'up';
  return dir;
}

function addVisualTransform(
  item: { rot?: SpriteRot; flipX?: boolean; flipY?: boolean },
  op: TransformOp,
): { rot?: SpriteRot; flipX?: boolean; flipY?: boolean } {
  let rot: number = item.rot ?? 0;
  let flipX = item.flipX === true;
  let flipY = item.flipY === true;
  const flippedAxis = flipX !== flipY;
  if (op === 'rot90') {
    rot = (rot + (flippedAxis ? 270 : 90)) % 360;
  } else if (op === 'rot270') {
    rot = (rot + (flippedAxis ? 90 : 270)) % 360;
  } else if (op === 'flipX') {
    if (rot === 90 || rot === 270) flipY = !flipY;
    else flipX = !flipX;
  } else if (op === 'flipY') {
    if (rot === 90 || rot === 270) flipX = !flipX;
    else flipY = !flipY;
  }
  const norm = (((rot % 360) + 360) % 360) as SpriteRot;
  return {
    ...(norm !== 0 ? { rot: norm } : {}),
    ...(flipX ? { flipX: true } : {}),
    ...(flipY ? { flipY: true } : {}),
  };
}

/**
 * Transform a furniture item's kind/variant/dir natively when directional art exists,
 * or attach visual `rot`/`flipX`/`flipY` otherwise so ANY furniture item can rotate/mirror.
 */
export function transformFurnitureAppearance(
  f: CustomFurnitureItem,
  op: TransformOp,
): { item: CustomFurnitureItem; usedNative: boolean } {
  const next: CustomFurnitureItem = { ...f };

  // 1. 4-way native desks
  const deskIdx = DESK_CYCLE.indexOf(f.kind);
  if (deskIdx >= 0) {
    let ni = deskIdx;
    if (op === 'rot90') ni = (deskIdx + 1) % 4;
    else if (op === 'rot270') ni = (deskIdx + 3) % 4;
    else if (op === 'flipX') {
      if (f.kind === 'desk_east') ni = DESK_CYCLE.indexOf('desk_west');
      else if (f.kind === 'desk_west') ni = DESK_CYCLE.indexOf('desk_east');
    } else if (op === 'flipY') {
      if (f.kind === 'desk') ni = DESK_CYCLE.indexOf('desk_back');
      else if (f.kind === 'desk_back') ni = DESK_CYCLE.indexOf('desk');
    }
    next.kind = DESK_CYCLE[ni];
    next.dir = rotateDir(f.dir, op);
    return { item: next, usedNative: true };
  }

  // 2. 4-way native office chairs
  const chairIdx = OFFICE_CHAIR_CYCLE.indexOf(f.kind);
  if (chairIdx >= 0) {
    let ni = chairIdx;
    if (op === 'rot90') ni = (chairIdx + 1) % 4;
    else if (op === 'rot270') ni = (chairIdx + 3) % 4;
    else if (op === 'flipX') {
      if (f.kind === 'office_chair_left') ni = OFFICE_CHAIR_CYCLE.indexOf('office_chair_right');
      else if (f.kind === 'office_chair_right') ni = OFFICE_CHAIR_CYCLE.indexOf('office_chair_left');
    } else if (op === 'flipY') {
      if (f.kind === 'office_chair') ni = OFFICE_CHAIR_CYCLE.indexOf('office_chair_front');
      else if (f.kind === 'office_chair_front') ni = OFFICE_CHAIR_CYCLE.indexOf('office_chair');
    }
    next.kind = OFFICE_CHAIR_CYCLE[ni];
    next.dir = rotateDir(f.dir, op) ?? VARIANT_DIR_CYCLE[ni];
    return { item: next, usedNative: true };
  }

  // 3. 4-way variant chairs (cafe_chair, armchair)
  if (f.kind === 'cafe_chair' || f.kind === 'armchair') {
    const curDir = (VARIANT_DIR_CYCLE.includes(f.variant as Dir) ? (f.variant as Dir) : f.dir ?? 'down');
    const nd = rotateDir(curDir, op) ?? 'down';
    next.variant = nd;
    next.dir = nd;
    return { item: next, usedNative: true };
  }

  // 4. Glass partition ('h' <-> 'v')
  if (f.kind === 'glass_partition') {
    if ((op === 'rot90' || op === 'rot270') && (f.variant === 'h' || f.variant === 'v' || !f.variant)) {
      next.variant = f.variant === 'v' ? 'h' : 'v';
      return { item: next, usedNative: true };
    }
    if (f.variant === 'end') {
      const xf = addVisualTransform(next, op);
      delete next.rot;
      delete next.flipX;
      delete next.flipY;
      Object.assign(next, xf);
      return { item: next, usedNative: false };
    }
  }

  // 5. Sofa ('down' <-> 'up' on vertical flip, visual rot for 90 deg)
  if (f.kind === 'sofa' && op === 'flipY') {
    next.variant = f.variant === 'up' ? 'down' : 'up';
    next.dir = next.variant as Dir;
    return { item: next, usedNative: true };
  }
  if (f.kind === 'sofa' && (op === 'rot90' || op === 'rot270') && (next.rot === 180 || next.rot === undefined)) {
    // Allow 90/270 visual rotation cleanly
  }

  // 6. All other items: attach sprite rot / flipX / flipY so any element can rotate or mirror
  const xf = addVisualTransform(next, op);
  delete next.rot;
  delete next.flipX;
  delete next.flipY;
  Object.assign(next, xf);
  if (next.dir) next.dir = rotateDir(next.dir, op);
  return { item: next, usedNative: false };
}

function transformRectInBox(
  x: number,
  y: number,
  w: number,
  h: number,
  boxW: number,
  boxH: number,
  op: TransformOp,
): { x: number; y: number; w: number; h: number } {
  switch (op) {
    case 'rot90':
      return { x: boxH - (y + h), y: x, w: h, h: w };
    case 'rot270':
      return { x: y, y: boxW - (x + w), w: h, h: w };
    case 'flipX':
      return { x: boxW - (x + w), y, w, h };
    case 'flipY':
      return { x, y: boxH - (y + h), w, h };
  }
}

function getGroupDescendantIds(doc: CustomMapDocument, rootGroupId: string): Set<string> {
  const out = new Set<string>([rootGroupId]);
  const groups = doc.groups ?? [];
  let added = true;
  while (added) {
    added = false;
    for (const g of groups) {
      if (g.parentId && out.has(g.parentId) && !out.has(g.id)) {
        out.add(g.id);
        added = true;
      }
    }
  }
  return out;
}

export function resolveRefsWithGroups(
  doc: CustomMapDocument,
  refs: readonly MapElementRef[],
  groupIds: readonly string[] = [],
): { refs: MapElementRef[]; groupSet: Set<string> } {
  const allGroups = new Set<string>();
  for (const gid of groupIds) {
    for (const d of getGroupDescendantIds(doc, gid)) allGroups.add(d);
  }
  const seen = new Set<string>();
  const out: MapElementRef[] = [];
  const push = (layer: MapElementLayerType, id: string) => {
    const key = `${layer}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ layer, id });
  };

  for (const r of refs) push(r.layer, r.id);
  if (allGroups.size > 0) {
    for (const f of doc.furniture) if (f.groupId && allGroups.has(f.groupId)) push('furniture', f.id);
    for (const w of doc.wallItems) if (w.groupId && allGroups.has(w.groupId)) push('wallItem', w.id);
    for (const w of doc.walls) if (w.groupId && allGroups.has(w.groupId)) push('wall', w.id);
    for (const r of doc.rugs) if (r.groupId && allGroups.has(r.groupId)) push('rug', r.id);
    for (const z of doc.zones) if (z.groupId && allGroups.has(z.groupId)) push('zone', z.id);
    for (const s of doc.spawns) if (s.groupId && allGroups.has(s.groupId)) push('spawn', s.id);
  }
  return { refs: out, groupSet: allGroups };
}

export function computeRefsBounds(doc: CustomMapDocument, refs: readonly MapElementRef[]): TileRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const expand = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  const setByLayer = new Map<MapElementLayerType, Set<string>>();
  for (const r of refs) {
    let s = setByLayer.get(r.layer);
    if (!s) setByLayer.set(r.layer, (s = new Set()));
    s.add(r.id);
  }
  for (const f of doc.furniture) {
    if (!setByLayer.get('furniture')?.has(f.id)) continue;
    const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
    expand(f.tx, f.ty, fp.w, fp.h);
  }
  for (const wi of doc.wallItems) {
    if (!setByLayer.get('wallItem')?.has(wi.id)) continue;
    const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
    expand(wi.tx - fw / 2, wi.ty - (wi.on === 'face' ? 2 : 1), fw, wi.on === 'face' ? 2 : 1);
  }
  for (const w of doc.walls) {
    if (!setByLayer.get('wall')?.has(w.id)) continue;
    const h = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
    expand(w.tx, w.ty, w.w, h);
  }
  for (const r of doc.rugs) {
    if (!setByLayer.get('rug')?.has(r.id)) continue;
    expand(r.x, r.y, r.w, r.h);
  }
  for (const z of doc.zones) {
    if (!setByLayer.get('zone')?.has(z.id)) continue;
    expand(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
  }
  for (const s of doc.spawns) {
    if (!setByLayer.get('spawn')?.has(s.id)) continue;
    expand(s.tx, s.ty, 1, 1);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Transform selected elements or an entire layer group around its bounding box center:
 * rotates/mirrors coordinates AND applies native directional mapping or sprite rot/flipX/flipY.
 */
export function transformSelectionInDoc(
  input: CustomMapDocument,
  refs: readonly MapElementRef[],
  op: TransformOp,
  groupIds: readonly string[] = [],
): CustomMapDocument {
  const doc = cloneCustomMap(input);
  const { refs: expanded } = resolveRefsWithGroups(doc, refs, groupIds);
  const box = computeRefsBounds(doc, expanded);
  if (!box) return doc;

  const setByLayer = new Map<MapElementLayerType, Set<string>>();
  for (const r of expanded) {
    let s = setByLayer.get(r.layer);
    if (!s) setByLayer.set(r.layer, (s = new Set()));
    s.add(r.id);
  }

  doc.furniture = doc.furniture.map((f) => {
    if (!setByLayer.get('furniture')?.has(f.id)) return f;
    const oldFp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
    const rel = transformRectInBox(f.tx - box.x, f.ty - box.y, oldFp.w, oldFp.h, box.w, box.h, op);
    const { item, usedNative } = transformFurnitureAppearance(f, op);
    const newFp = FURNITURE[item.kind]?.footprint ?? oldFp;
    let ntx: number;
    let nty: number;
    if (usedNative) {
      ntx = Math.round(box.x + rel.x);
      nty = Math.round(box.y + rel.y);
    } else {
      // Non-directional items keep their footprint aspect; anchor via rotated center
      const cx = rel.x + rel.w / 2;
      const cy = rel.y + rel.h / 2;
      ntx = Math.round(box.x + cx - newFp.w / 2);
      nty = Math.round(box.y + cy - newFp.h / 2);
    }
    ntx = Math.max(0, Math.min(doc.width - newFp.w, ntx));
    nty = Math.max(0, Math.min(doc.height - newFp.h, nty));
    return { ...item, tx: ntx, ty: nty };
  });

  doc.wallItems = doc.wallItems.map((wi) => {
    if (!setByLayer.get('wallItem')?.has(wi.id)) return wi;
    const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
    const fh = wi.on === 'face' ? 2 : 1;
    const rel = transformRectInBox(wi.tx - fw / 2 - box.x, wi.ty - fh - box.y, fw, fh, box.w, box.h, op);
    const xf = addVisualTransform(wi, op);
    const next: CustomWallItem = {
      ...wi,
      tx: Math.max(0, Math.min(doc.width, Math.round((box.x + rel.x + rel.w / 2) * 2) / 2)),
      ty: Math.max(0, Math.min(doc.height, Math.round((box.y + rel.y + rel.h) * 2) / 2)),
      on: op === 'flipY' || ((op === 'rot90' || op === 'rot270') && wi.rot === undefined) ? wi.on : wi.on,
      ...xf,
    };
    if (xf.rot === undefined) delete next.rot;
    if (!xf.flipX) delete next.flipX;
    if (!xf.flipY) delete next.flipY;
    return next;
  });

  doc.walls = doc.walls.map((w) => {
    if (!setByLayer.get('wall')?.has(w.id)) return w;
    const oldH = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
    const rel = transformRectInBox(w.tx - box.x, w.ty - box.y, w.w, oldH, box.w, box.h, op);
    const next: CustomWallBlock = {
      ...w,
      tx: Math.max(0, Math.min(doc.width - 1, Math.round(box.x + rel.x))),
      ty: Math.max(0, Math.min(doc.height - 1, Math.round(box.y + rel.y))),
      w: Math.max(1, Math.round(rel.w)),
      h: Math.max(1, Math.round(rel.h)),
    };
    if ((op === 'rot90' || op === 'rot270') && (w.kind === 'face' || w.kind === 'south') && rel.w <= 2 && rel.h > 2) {
      next.kind = 'cap';
      delete next.doorways;
    } else if (op === 'flipX' && next.doorways?.length) {
      next.doorways = next.doorways.map((d) => ({
        offset: Math.max(0, w.w - (d.offset + d.w)),
        w: d.w,
      }));
    }
    return next;
  });

  doc.rugs = doc.rugs.map((r) => {
    if (!setByLayer.get('rug')?.has(r.id)) return r;
    const rel = transformRectInBox(r.x - box.x, r.y - box.y, r.w, r.h, box.w, box.h, op);
    return {
      ...r,
      x: Math.max(0, Math.min(doc.width - 1, Math.round(box.x + rel.x))),
      y: Math.max(0, Math.min(doc.height - 1, Math.round(box.y + rel.y))),
      w: Math.max(1, Math.round(rel.w)),
      h: Math.max(1, Math.round(rel.h)),
    };
  });

  doc.zones = doc.zones.map((z) => {
    if (!setByLayer.get('zone')?.has(z.id)) return z;
    const rel = transformRectInBox(z.rect.x - box.x, z.rect.y - box.y, z.rect.w, z.rect.h, box.w, box.h, op);
    return {
      ...z,
      rect: {
        x: Math.max(0, Math.min(doc.width - 1, Math.round(box.x + rel.x))),
        y: Math.max(0, Math.min(doc.height - 1, Math.round(box.y + rel.y))),
        w: Math.max(1, Math.round(rel.w)),
        h: Math.max(1, Math.round(rel.h)),
      },
    };
  });

  doc.spawns = doc.spawns.map((s) => {
    if (!setByLayer.get('spawn')?.has(s.id)) return s;
    const rel = transformRectInBox(s.tx - box.x, s.ty - box.y, 1, 1, box.w, box.h, op);
    return {
      ...s,
      tx: Math.max(0, Math.min(doc.width - 1, Math.round(box.x + rel.x))),
      ty: Math.max(0, Math.min(doc.height - 1, Math.round(box.y + rel.y))),
      ...(s.dir ? { dir: rotateDir(s.dir, op) } : {}),
    };
  });

  doc.updatedAt = Date.now();
  return doc;
}

/**
 * Copy arbitrary selected elements / layer groups (normalized to top-left 0,0) for cross-map paste.
 */
export function copySelectionToClipboard(
  doc: CustomMapDocument,
  refs: readonly MapElementRef[],
  groupIds: readonly string[] = [],
): MapClipboardPayload | null {
  const { refs: expanded, groupSet } = resolveRefsWithGroups(doc, refs, groupIds);
  const box = computeRefsBounds(doc, expanded);
  if (!box) return null;

  const setByLayer = new Map<MapElementLayerType, Set<string>>();
  for (const r of expanded) {
    let s = setByLayer.get(r.layer);
    if (!s) setByLayer.set(r.layer, (s = new Set()));
    s.add(r.id);
  }

  const ox = Math.floor(box.x);
  const oy = Math.floor(box.y);

  const furniture = doc.furniture
    .filter((f) => setByLayer.get('furniture')?.has(f.id))
    .map((f) => ({ ...structuredClone(f), tx: f.tx - ox, ty: f.ty - oy }));
  const wallItems = doc.wallItems
    .filter((w) => setByLayer.get('wallItem')?.has(w.id))
    .map((w) => ({ ...structuredClone(w), tx: w.tx - ox, ty: w.ty - oy }));
  const walls = doc.walls
    .filter((w) => setByLayer.get('wall')?.has(w.id))
    .map((w) => ({ ...structuredClone(w), tx: w.tx - ox, ty: w.ty - oy }));
  const rugs = doc.rugs
    .filter((r) => setByLayer.get('rug')?.has(r.id))
    .map((r) => ({ ...structuredClone(r), x: r.x - ox, y: r.y - oy }));
  const zones = doc.zones
    .filter((z) => setByLayer.get('zone')?.has(z.id))
    .map((z) => ({
      ...structuredClone(z),
      rect: { x: z.rect.x - ox, y: z.rect.y - oy, w: z.rect.w, h: z.rect.h },
    }));
  const spawns = doc.spawns
    .filter((s) => setByLayer.get('spawn')?.has(s.id))
    .map((s) => ({ ...structuredClone(s), tx: s.tx - ox, ty: s.ty - oy }));

  const referencedGroups = new Set<string>(groupSet);
  for (const it of [...furniture, ...wallItems, ...walls, ...rugs, ...zones, ...spawns]) {
    if (it.groupId) referencedGroups.add(it.groupId);
  }
  const groups = (doc.groups ?? []).filter((g) => referencedGroups.has(g.id)).map((g) => ({ ...g }));

  return {
    format: CLIPBOARD_FORMAT,
    copiedAt: Date.now(),
    sourceName: doc.name,
    width: Math.max(1, Math.ceil(box.x + box.w) - ox),
    height: Math.max(1, Math.ceil(box.y + box.h) - oy),
    hasFloor: false,
    groups,
    furniture,
    wallItems,
    walls,
    rugs,
    zones,
    spawns,
  };
}

/**
 * Copy a complete rectangular region (floors + walls + wallItems + furniture + rugs + zones + spawns + groups)
 * so users can design a room in one map and paste the entire room cleanly into another map.
 */
export function copyRectToClipboard(doc: CustomMapDocument, rawRect: TileRect, includeFloor = true): MapClipboardPayload | null {
  const x = Math.max(0, Math.min(doc.width - 1, Math.floor(rawRect.x)));
  const y = Math.max(0, Math.min(doc.height - 1, Math.floor(rawRect.y)));
  const w = Math.max(1, Math.min(doc.width - x, Math.ceil(rawRect.w)));
  const h = Math.max(1, Math.min(doc.height - y, Math.ceil(rawRect.h)));
  const x1 = x + w;
  const y1 = y + h;

  const overlaps = (ax: number, ay: number, aw: number, ah: number) =>
    ax < x1 && ax + aw > x && ay < y1 && ay + ah > y;

  let floorPalette: FloorPaletteEntry[] | undefined;
  let floorRows: string[] | undefined;
  if (includeFloor) {
    const src = FloorGridBuffer.fromDocument(doc);
    const dst = new FloorGridBuffer(w, h, [src.getEntry(x, y)]);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = dst.ensurePaletteIndex(src.getEntry(x + xx, y + yy));
        dst.set(xx, yy, idx);
      }
    }
    floorPalette = dst.palette;
    floorRows = dst.toRows();
  }

  const furniture = doc.furniture
    .filter((f) => {
      const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      return overlaps(f.tx, f.ty, fp.w, fp.h);
    })
    .map((f) => ({ ...structuredClone(f), tx: f.tx - x, ty: f.ty - y }));

  const wallItems = doc.wallItems
    .filter((wi) => wi.tx >= x && wi.tx <= x1 && wi.ty >= y && wi.ty <= y1 + 1)
    .map((wi) => ({ ...structuredClone(wi), tx: wi.tx - x, ty: wi.ty - y }));

  const walls = doc.walls
    .map((wall): CustomWallBlock | null => {
      const wh = wall.kind === 'face' ? 2 : wall.kind === 'south' ? 1 : wall.h;
      if (!overlaps(wall.tx, wall.ty, wall.w, wh)) return null;
      const cx0 = Math.max(x, wall.tx);
      const cy0 = Math.max(y, wall.ty);
      const cx1 = Math.min(x1, wall.tx + wall.w);
      const cy1 = Math.min(y1, wall.ty + wh);
      const cw = cx1 - cx0;
      const ch = cy1 - cy0;
      if (cw <= 0 || ch <= 0) return null;
      const doorways = wall.doorways
        ?.map((d) => {
          const dAbs0 = wall.tx + d.offset;
          const dAbs1 = dAbs0 + d.w;
          const ic0 = Math.max(cx0, dAbs0);
          const ic1 = Math.min(cx1, dAbs1);
          return ic1 > ic0 ? { offset: ic0 - cx0, w: ic1 - ic0 } : null;
        })
        .filter((d): d is { offset: number; w: number } => !!d);
      return {
        ...structuredClone(wall),
        tx: cx0 - x,
        ty: cy0 - y,
        w: cw,
        h: wall.kind === 'face' ? 2 : wall.kind === 'south' ? 1 : ch,
        ...(doorways?.length ? { doorways } : {}),
      };
    })
    .filter((wall): wall is CustomWallBlock => !!wall);

  const rugs = doc.rugs
    .filter((r) => overlaps(r.x, r.y, r.w, r.h))
    .map((r) => ({ ...structuredClone(r), x: r.x - x, y: r.y - y }));

  const zones = doc.zones
    .filter((z) => overlaps(z.rect.x, z.rect.y, z.rect.w, z.rect.h))
    .map((z) => {
      const zx0 = Math.max(x, z.rect.x);
      const zy0 = Math.max(y, z.rect.y);
      const zx1 = Math.min(x1, z.rect.x + z.rect.w);
      const zy1 = Math.min(y1, z.rect.y + z.rect.h);
      return {
        ...structuredClone(z),
        rect: { x: zx0 - x, y: zy0 - y, w: Math.max(1, zx1 - zx0), h: Math.max(1, zy1 - zy0) },
      };
    });

  const spawns = doc.spawns
    .filter((sp) => sp.tx >= x && sp.tx < x1 && sp.ty >= y && sp.ty < y1)
    .map((sp) => ({ ...structuredClone(sp), tx: sp.tx - x, ty: sp.ty - y }));

  const usedGroups = new Set<string>();
  for (const it of [...furniture, ...wallItems, ...walls, ...rugs, ...zones, ...spawns]) {
    if (it.groupId) usedGroups.add(it.groupId);
  }
  const groups = (doc.groups ?? []).filter((g) => usedGroups.has(g.id)).map((g) => ({ ...g }));

  return {
    format: CLIPBOARD_FORMAT,
    copiedAt: Date.now(),
    sourceName: doc.name,
    width: w,
    height: h,
    hasFloor: includeFloor,
    ...(floorPalette ? { floorPalette } : {}),
    ...(floorRows ? { floorRows } : {}),
    groups,
    furniture,
    wallItems,
    walls,
    rugs,
    zones,
    spawns,
  };
}

/** Transform a clipboard stamp payload in-place so users can rotate/flip before pasting across maps. */
export function transformClipboardPayload(clip: MapClipboardPayload, op: TransformOp): MapClipboardPayload {
  const w = clip.width;
  const h = clip.height;
  const nextW = op === 'rot90' || op === 'rot270' ? h : w;
  const nextH = op === 'rot90' || op === 'rot270' ? w : h;

  let floorRows = clip.floorRows ? [...clip.floorRows] : undefined;
  const floorPalette = clip.floorPalette ? clip.floorPalette.map((p) => ({ ...p })) : undefined;
  if (clip.hasFloor && floorPalette && floorRows && floorRows.length === h) {
    const src = decodeFloorRows(floorRows, w, h, floorPalette.length);
    const dst = new Uint16Array(nextW * nextH);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = src[y * w + x] ?? 0;
        let nx = x;
        let ny = y;
        if (op === 'rot90') {
          nx = h - 1 - y;
          ny = x;
        } else if (op === 'rot270') {
          nx = y;
          ny = w - 1 - x;
        } else if (op === 'flipX') {
          nx = w - 1 - x;
        } else if (op === 'flipY') {
          ny = h - 1 - y;
        }
        dst[ny * nextW + nx] = val;
      }
    }
    floorRows = encodeFloorRows(dst, nextW, nextH);
  }

  // Wrap inside synthetic CustomMapDocument to reuse transformSelectionInDoc exact geometry rules
  const synthetic: CustomMapDocument = {
    format: 'agent-party-map@1',
    schemaVersion: 1,
    id: 'clip',
    name: 'clip',
    width: Math.max(16, nextW + 8),
    height: Math.max(16, nextH + 8),
    updatedAt: clip.copiedAt,
    backgroundFloor: 'grass',
    floorPalette: [{ kind: 'grass' }],
    floorRows: Array.from({ length: Math.max(16, nextH + 8) }, () => `${Math.max(16, nextW + 8)}*0`),
    rugs: clip.rugs.map((r) => ({ ...r })),
    walls: clip.walls.map((wl) => ({ ...wl })),
    wallItems: clip.wallItems.map((wi) => ({ ...wi })),
    furniture: clip.furniture.map((f) => ({ ...f })),
    zones: clip.zones.map((z) => ({ ...z, rect: { ...z.rect } })),
    props: [],
    spawns: clip.spawns.map((s) => ({ ...s })),
    groups: clip.groups.map((g) => ({ ...g })),
  };
  const allRefs: MapElementRef[] = [
    ...synthetic.furniture.map((x) => ({ layer: 'furniture' as const, id: x.id })),
    ...synthetic.wallItems.map((x) => ({ layer: 'wallItem' as const, id: x.id })),
    ...synthetic.walls.map((x) => ({ layer: 'wall' as const, id: x.id })),
    ...synthetic.rugs.map((x) => ({ layer: 'rug' as const, id: x.id })),
    ...synthetic.zones.map((x) => ({ layer: 'zone' as const, id: x.id })),
    ...synthetic.spawns.map((x) => ({ layer: 'spawn' as const, id: x.id })),
  ];
  // Compute transform relative to exact clipboard box (0,0,w,h)
  const outDoc = cloneCustomMap(synthetic);
  if (allRefs.length > 0) {
    outDoc.furniture = synthetic.furniture.map((f) => {
      const oldFp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      const rel = transformRectInBox(f.tx, f.ty, oldFp.w, oldFp.h, w, h, op);
      const { item, usedNative } = transformFurnitureAppearance(f, op);
      const newFp = FURNITURE[item.kind]?.footprint ?? oldFp;
      const ntx = usedNative ? Math.round(rel.x) : Math.round(rel.x + rel.w / 2 - newFp.w / 2);
      const nty = usedNative ? Math.round(rel.y) : Math.round(rel.y + rel.h / 2 - newFp.h / 2);
      return {
        ...item,
        tx: Math.max(0, Math.min(nextW - newFp.w, ntx)),
        ty: Math.max(0, Math.min(nextH - newFp.h, nty)),
      };
    });
    outDoc.wallItems = synthetic.wallItems.map((wi) => {
      const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
      const fh = wi.on === 'face' ? 2 : 1;
      const rel = transformRectInBox(wi.tx - fw / 2, wi.ty - fh, fw, fh, w, h, op);
      const xf = addVisualTransform(wi, op);
      const next: CustomWallItem = {
        ...wi,
        tx: Math.max(0, Math.min(nextW, Math.round((rel.x + rel.w / 2) * 2) / 2)),
        ty: Math.max(0, Math.min(nextH, Math.round((rel.y + rel.h) * 2) / 2)),
        ...xf,
      };
      if (xf.rot === undefined) delete next.rot;
      if (!xf.flipX) delete next.flipX;
      if (!xf.flipY) delete next.flipY;
      return next;
    });
    outDoc.walls = synthetic.walls.map((wl) => {
      const oldH = wl.kind === 'face' ? 2 : wl.kind === 'south' ? 1 : wl.h;
      const rel = transformRectInBox(wl.tx, wl.ty, wl.w, oldH, w, h, op);
      const nw: CustomWallBlock = {
        ...wl,
        tx: Math.max(0, Math.round(rel.x)),
        ty: Math.max(0, Math.round(rel.y)),
        w: Math.max(1, Math.round(rel.w)),
        h: Math.max(1, Math.round(rel.h)),
      };
      if ((op === 'rot90' || op === 'rot270') && (wl.kind === 'face' || wl.kind === 'south') && rel.w <= 2 && rel.h > 2) {
        nw.kind = 'cap';
        delete nw.doorways;
      } else if (op === 'flipX' && nw.doorways?.length) {
        nw.doorways = nw.doorways.map((d) => ({ offset: Math.max(0, wl.w - (d.offset + d.w)), w: d.w }));
      }
      return nw;
    });
    outDoc.rugs = synthetic.rugs.map((r) => {
      const rel = transformRectInBox(r.x, r.y, r.w, r.h, w, h, op);
      return { ...r, x: Math.max(0, Math.round(rel.x)), y: Math.max(0, Math.round(rel.y)), w: Math.max(1, Math.round(rel.w)), h: Math.max(1, Math.round(rel.h)) };
    });
    outDoc.zones = synthetic.zones.map((z) => {
      const rel = transformRectInBox(z.rect.x, z.rect.y, z.rect.w, z.rect.h, w, h, op);
      return { ...z, rect: { x: Math.max(0, Math.round(rel.x)), y: Math.max(0, Math.round(rel.y)), w: Math.max(1, Math.round(rel.w)), h: Math.max(1, Math.round(rel.h)) } };
    });
    outDoc.spawns = synthetic.spawns.map((s) => {
      const rel = transformRectInBox(s.tx, s.ty, 1, 1, w, h, op);
      return { ...s, tx: Math.max(0, Math.round(rel.x)), ty: Math.max(0, Math.round(rel.y)), ...(s.dir ? { dir: rotateDir(s.dir, op) } : {}) };
    });
  }

  return {
    ...clip,
    width: nextW,
    height: nextH,
    ...(floorPalette ? { floorPalette } : {}),
    ...(floorRows ? { floorRows } : {}),
    furniture: outDoc.furniture,
    wallItems: outDoc.wallItems,
    walls: outDoc.walls,
    rugs: outDoc.rugs,
    zones: outDoc.zones,
    spawns: outDoc.spawns,
  };
}

function allocId(prefix: string, used: Set<string>): string {
  let i = 1;
  while (used.has(`${prefix}-${i}`)) i++;
  const id = `${prefix}-${i}`;
  used.add(id);
  return id;
}

/**
 * Paste a clipboard payload into any target CustomMapDocument at tile `(anchorTx, anchorTy)`,
 * generating fresh unique IDs while preserving internal `groupId` / `deskId` / `zoneId` relationships.
 */
export function pasteClipboardIntoDoc(
  input: CustomMapDocument,
  clip: MapClipboardPayload,
  anchorTx: number,
  anchorTy: number,
  opts: { pasteFloor?: boolean; wrapInGroupName?: string } = {},
): { doc: CustomMapDocument; insertedRefs: MapElementRef[]; insertedGroupIds: string[] } {
  const doc = cloneCustomMap(input);
  const ox = Math.floor(anchorTx);
  const oy = Math.floor(anchorTy);
  const insertedRefs: MapElementRef[] = [];
  const insertedGroupIds: string[] = [];

  if ((opts.pasteFloor ?? clip.hasFloor) && clip.floorPalette?.length && clip.floorRows?.length) {
    try {
      const patchBuf = decodeFloorRows(clip.floorRows, clip.width, clip.height, clip.floorPalette.length);
      const dstBuf = FloorGridBuffer.fromDocument(doc);
      for (let py = 0; py < clip.height; py++) {
        const ty = oy + py;
        if (ty < 0 || ty >= doc.height) continue;
        for (let px = 0; px < clip.width; px++) {
          const tx = ox + px;
          if (tx < 0 || tx >= doc.width) continue;
          const entry = clip.floorPalette[patchBuf[py * clip.width + px] ?? 0] ?? clip.floorPalette[0];
          dstBuf.set(tx, ty, dstBuf.ensurePaletteIndex(entry));
        }
      }
      doc.floorPalette = dstBuf.palette;
      doc.floorRows = dstBuf.toRows();
    } catch {
      // ignore malformed floor patch
    }
  }

  const existingIds = new Set<string>([
    ...(doc.groups ?? []).map((g) => g.id),
    ...doc.furniture.map((x) => x.id),
    ...doc.wallItems.map((x) => x.id),
    ...doc.walls.map((x) => x.id),
    ...doc.rugs.map((x) => x.id),
    ...doc.zones.map((x) => x.id),
    ...doc.spawns.map((x) => x.id),
  ]);

  const groupIdMap = new Map<string, string>();
  const nextGroups = [...(doc.groups ?? [])];
  for (const g of clip.groups) {
    const nid = allocId('grp', existingIds);
    groupIdMap.set(g.id, nid);
    insertedGroupIds.push(nid);
  }
  for (const g of clip.groups) {
    const nid = groupIdMap.get(g.id)!;
    const nextParent = g.parentId ? groupIdMap.get(g.parentId) : undefined;
    nextGroups.push({
      ...g,
      id: nid,
      ...(nextParent ? { parentId: nextParent } : {}),
    });
  }

  let fallbackGroupId: string | undefined;
  if (opts.wrapInGroupName && insertedGroupIds.length === 0) {
    fallbackGroupId = allocId('grp', existingIds);
    nextGroups.push({ id: fallbackGroupId, name: opts.wrapInGroupName });
    insertedGroupIds.push(fallbackGroupId);
  }
  if (nextGroups.length) doc.groups = nextGroups;

  const zoneIdMap = new Map<string, string>();
  for (const z of clip.zones) {
    const nx = Math.max(0, z.rect.x + ox);
    const ny = Math.max(0, z.rect.y + oy);
    const nx1 = Math.min(doc.width, z.rect.x + ox + z.rect.w);
    const ny1 = Math.min(doc.height, z.rect.y + oy + z.rect.h);
    if (nx1 <= nx || ny1 <= ny) continue;
    const nid = allocId('zone', existingIds);
    zoneIdMap.set(z.id, nid);
    const mappedGroup = (z.groupId ? groupIdMap.get(z.groupId) : undefined) ?? fallbackGroupId;
    doc.zones.push({
      ...structuredClone(z),
      id: nid,
      rect: { x: nx, y: ny, w: nx1 - nx, h: ny1 - ny },
      ...(mappedGroup ? { groupId: mappedGroup } : {}),
    });
    insertedRefs.push({ layer: 'zone', id: nid });
  }

  for (const r of clip.rugs) {
    const nx = r.x + ox;
    const ny = r.y + oy;
    if (nx + r.w <= 0 || ny + r.h <= 0 || nx >= doc.width || ny >= doc.height) continue;
    const nid = allocId('rug', existingIds);
    const mappedGroup = (r.groupId ? groupIdMap.get(r.groupId) : undefined) ?? fallbackGroupId;
    doc.rugs.push({
      ...structuredClone(r),
      id: nid,
      x: Math.max(0, nx),
      y: Math.max(0, ny),
      w: Math.min(doc.width - Math.max(0, nx), nx + r.w - Math.max(0, nx)),
      h: Math.min(doc.height - Math.max(0, ny), ny + r.h - Math.max(0, ny)),
      ...(mappedGroup ? { groupId: mappedGroup } : {}),
    });
    insertedRefs.push({ layer: 'rug', id: nid });
  }

  for (const w of clip.walls) {
    const wh = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
    const nx = w.tx + ox;
    const ny = w.ty + oy;
    if (nx + w.w <= 0 || ny + wh <= 0 || nx >= doc.width || ny >= doc.height) continue;
    const cx0 = Math.max(0, nx);
    const cy0 = Math.max(0, ny);
    const cx1 = Math.min(doc.width, nx + w.w);
    const cy1 = Math.min(doc.height, ny + wh);
    if (cx1 <= cx0 || cy1 <= cy0) continue;
    const nid = allocId('wall', existingIds);
    const mappedGroup = (w.groupId ? groupIdMap.get(w.groupId) : undefined) ?? fallbackGroupId;
    doc.walls.push({
      ...structuredClone(w),
      id: nid,
      tx: cx0,
      ty: cy0,
      w: cx1 - cx0,
      h: w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : cy1 - cy0,
      ...(mappedGroup ? { groupId: mappedGroup } : {}),
    });
    insertedRefs.push({ layer: 'wall', id: nid });
  }

  const furnIdMap = new Map<string, string>();
  const pendingChairs: CustomFurnitureItem[] = [];
  for (const f of clip.furniture) {
    const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
    const nx = Math.round(f.tx + ox);
    const ny = Math.round(f.ty + oy);
    if (nx < 0 || ny < 0 || nx + fp.w > doc.width || ny + fp.h > doc.height) continue;
    const nid = allocId('f', existingIds);
    furnIdMap.set(f.id, nid);
    const mappedGroup = (f.groupId ? groupIdMap.get(f.groupId) : undefined) ?? fallbackGroupId;
    const item: CustomFurnitureItem = {
      ...structuredClone(f),
      id: nid,
      tx: nx,
      ty: ny,
      ...(mappedGroup ? { groupId: mappedGroup } : {}),
    };
    if (item.deskId) pendingChairs.push(item);
    doc.furniture.push(item);
    insertedRefs.push({ layer: 'furniture', id: nid });
  }
  for (const ch of pendingChairs) {
    if (ch.deskId && furnIdMap.has(ch.deskId)) ch.deskId = furnIdMap.get(ch.deskId);
    else delete ch.deskId;
  }

  for (const wi of clip.wallItems) {
    const nx = wi.tx + ox;
    const ny = wi.ty + oy;
    if (nx < 0 || nx > doc.width || ny < 0 || ny > doc.height) continue;
    const nid = allocId('wi', existingIds);
    const mappedGroup = (wi.groupId ? groupIdMap.get(wi.groupId) : undefined) ?? fallbackGroupId;
    const mappedZone = wi.zoneId ? zoneIdMap.get(wi.zoneId) : undefined;
    doc.wallItems.push({
      ...structuredClone(wi),
      id: nid,
      tx: nx,
      ty: ny,
      ...(mappedZone ? { zoneId: mappedZone } : {}),
      ...(mappedGroup ? { groupId: mappedGroup } : {}),
    });
    insertedRefs.push({ layer: 'wallItem', id: nid });
  }

  for (const sp of clip.spawns) {
    const nx = Math.round(sp.tx + ox);
    const ny = Math.round(sp.ty + oy);
    if (nx < 0 || nx >= doc.width || ny < 0 || ny >= doc.height) continue;
    const nid = allocId('spawn', existingIds);
    const mappedGroup = (sp.groupId ? groupIdMap.get(sp.groupId) : undefined) ?? fallbackGroupId;
    doc.spawns.push({
      ...structuredClone(sp),
      id: nid,
      tx: nx,
      ty: ny,
      ...(mappedGroup ? { groupId: mappedGroup } : {}),
    });
    insertedRefs.push({ layer: 'spawn', id: nid });
  }

  doc.updatedAt = Date.now();
  return { doc, insertedRefs, insertedGroupIds };
}

/** Clear all objects inside a tile rectangle and fill the floor with `fillFloor`. */
export function clearRectInDoc(
  input: CustomMapDocument,
  rawRect: TileRect,
  fillFloor?: CustomMapDocument['backgroundFloor'],
): CustomMapDocument {
  const doc = cloneCustomMap(input);
  const x = Math.max(0, Math.min(doc.width - 1, Math.floor(rawRect.x)));
  const y = Math.max(0, Math.min(doc.height - 1, Math.floor(rawRect.y)));
  const w = Math.max(1, Math.min(doc.width - x, Math.ceil(rawRect.w)));
  const h = Math.max(1, Math.min(doc.height - y, Math.ceil(rawRect.h)));
  const x1 = x + w;
  const y1 = y + h;
  const overlaps = (ax: number, ay: number, aw: number, ah: number) =>
    ax < x1 && ax + aw > x && ay < y1 && ay + ah > y;

  const buf = FloorGridBuffer.fromDocument(doc);
  buf.fillRect(x, y, w, h, { kind: fillFloor ?? doc.backgroundFloor });
  doc.floorPalette = buf.palette;
  doc.floorRows = buf.toRows();

  doc.furniture = doc.furniture.filter((f) => {
    const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
    return !overlaps(f.tx, f.ty, fp.w, fp.h);
  });
  doc.wallItems = doc.wallItems.filter((wi) => !(wi.tx >= x && wi.tx <= x1 && wi.ty >= y && wi.ty <= y1 + 1));
  doc.walls = doc.walls.filter((wl) => {
    const wh = wl.kind === 'face' ? 2 : wl.kind === 'south' ? 1 : wl.h;
    return !overlaps(wl.tx, wl.ty, wl.w, wh);
  });
  doc.rugs = doc.rugs.filter((rg) => !overlaps(rg.x, rg.y, rg.w, rg.h));
  doc.spawns = doc.spawns.filter((sp) => !(sp.tx >= x && sp.tx < x1 && sp.ty >= y && sp.ty < y1));
  doc.updatedAt = Date.now();
  return doc;
}
