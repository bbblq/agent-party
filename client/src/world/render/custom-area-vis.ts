import { FURNITURE, TILE, type ArtModule } from '../../art/api';
import { hash32 } from '../../../../shared/hash';
import type { AreaLayout } from '../layout/types';
import type { RoomState } from '../sim/room-state';
import { toWallVis, type AreaVis, type FurnVis, type WallVis } from './scene';

export const WALL_MARGIN = 16;

const DYNAMIC_WALL = new Set([
  'window',
  'clock',
  'whiteboard',
  'tv',
  'elevator',
  'light_switch',
  'sign',
  'mirror',
]);

let sharedEmptyCanvas: HTMLCanvasElement | null = null;
function emptyCanvas(): HTMLCanvasElement {
  if (!sharedEmptyCanvas) {
    sharedEmptyCanvas = document.createElement('canvas');
    sharedEmptyCanvas.width = 1;
    sharedEmptyCanvas.height = 1;
  }
  return sharedEmptyCanvas;
}

/** Lightweight AreaVis without large backing floor/wall canvases (chunks handle those). */
export function makeCustomPlaceholderVis(_art: ArtModule, layout: AreaLayout, room: RoomState | undefined): AreaVis {
  const r = layout.rect;
  const px = { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
  const wallItems: WallVis[] = [];
  let sign: WallVis | undefined;
  for (const it of layout.wallItems) {
    if (!DYNAMIC_WALL.has(it.kind)) continue;
    const vis = toWallVis(it, layout.id);
    if (it.kind === 'sign') sign = vis;
    else wallItems.push(vis);
  }
  const furniture: FurnVis[] = layout.furniture.map((f) => {
    const def = FURNITURE[f.kind];
    const ax = (f.tx + def.footprint.w / 2) * TILE + (f.dx ?? 0);
    const ay = (f.ty + def.footprint.h) * TILE + (f.dy ?? 0);
    const seatSpot = layout.spots.find((s) => s.deskId === f.id)?.id;
    return {
      id: f.id,
      kind: f.kind,
      ...(f.variant ? { variant: f.variant } : {}),
      seed: hash32(`${layout.id}:${f.id}`),
      ax,
      ay,
      order: f.order,
      areaId: layout.id,
      ...(seatSpot ? { seatSpot } : {}),
      states: [],
    };
  });
  const dummy = emptyCanvas();
  return {
    id: layout.id,
    layout,
    room,
    px,
    floor: dummy,
    walls: dummy,
    furniture,
    wallItems,
    sign,
    version: room ? room.version : 0,
  };
}
