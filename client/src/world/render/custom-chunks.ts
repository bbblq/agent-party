import { TILE, type ArtModule, type FloorKind } from '../../art/api';
import type { BuildingLayout } from '../layout/building';
import type { AreaLayout, FloorPatch, WallSegment } from '../layout/types';
import type { RoomState } from '../sim/room-state';
import type { WorldAssets } from '../assets';
import type { SeasonalTheme } from '../api';
import { WALL_MARGIN, makeCustomPlaceholderVis } from './custom-area-vis';
import { seasonalRugColor, seasonalWallStyle } from './seasonal';
import { pickWallArt, wallItemOrigin, wallSprites, type AreaVis, type WallVis } from './scene';

export const CHUNK_TILES = 32;
export const CHUNK_PX = CHUNK_TILES * TILE;
const MAX_CHUNKS = 64;
const OVERVIEW_MAX_PX = 1024;
const OVERVIEW_LOD_SCALE = 0.35;

interface ChunkEntry {
  key: string;
  cx: number;
  cy: number;
  floor: HTMLCanvasElement;
  walls: HTMLCanvasElement;
}

const FLOOR_FALLBACK: Readonly<Record<FloorKind, string>> = {
  grass: '#6f9a5a',
  sidewalk: '#b5b8c0',
  street: '#4a4e59',
  wood: '#b9895b',
  concrete: '#c9cfd8',
  marble: '#ded4be',
  tile_check: '#707b8c',
  tile_white: '#eef1f5',
  carpet: '#4d6f94',
};

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/**
 * Chunked offscreen renderer + Overview LOD cache for custom maps up to 512x512 tiles.
 * Avoids allocating monolithic full-world canvases that would exceed browser limits.
 */
export class CustomChunkCache {
  private chunks = new Map<string, ChunkEntry>();
  private overview: HTMLCanvasElement | null = null;
  private overviewDirty = true;
  private syncKey = '';

  private mapW = 0;
  private mapH = 0;
  private building: BuildingLayout | null = null;
  private areas: readonly AreaLayout[] = [];
  private common: AreaLayout | null = null;
  private theme: SeasonalTheme = 'none';
  private assets: WorldAssets | null = null;
  private assetsVersion = 0;

  sync(
    building: BuildingLayout,
    theme: SeasonalTheme,
    assets: WorldAssets | null,
    assetsVersion: number,
  ): void {
    const key = `${building.mapWidth ?? 0}x${building.mapHeight ?? 0}:${assetsVersion}:${theme}`;
    const docChanged = this.building !== building;
    this.building = building;
    this.mapW = building.mapWidth ?? building.rect?.w ?? building.cols * 16;
    this.mapH = building.mapHeight ?? building.rect?.h ?? 29;
    this.theme = theme;
    this.assets = assets;
    this.assetsVersion = assetsVersion;
    const list: AreaLayout[] = [...building.core, ...building.rooms];
    this.areas = list;
    this.common = building.core.find((a) => a.id === 'custom:common') ?? building.corridor ?? null;

    if (docChanged || key !== this.syncKey) {
      this.syncKey = key;
      this.invalidateAll();
    }
  }

  invalidateAll(): void {
    this.chunks.clear();
    this.overviewDirty = true;
  }

  invalidateRect(tileRect?: { x: number; y: number; w: number; h: number }): void {
    this.overviewDirty = true;
    if (!tileRect) {
      this.chunks.clear();
      return;
    }
    const cx0 = Math.floor(Math.max(0, tileRect.x) / CHUNK_TILES);
    const cy0 = Math.floor(Math.max(0, tileRect.y - 2) / CHUNK_TILES);
    const cx1 = Math.floor(Math.max(0, tileRect.x + tileRect.w) / CHUNK_TILES);
    const cy1 = Math.floor(Math.max(0, tileRect.y + tileRect.h + 2) / CHUNK_TILES);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        this.chunks.delete(`${cx},${cy}`);
      }
    }
  }

  drawFloors(
    art: ArtModule,
    ctx: CanvasRenderingContext2D,
    vx0: number,
    vy0: number,
    vx1: number,
    vy1: number,
    scale: number,
  ): void {
    if (!this.building) return;
    if (scale <= OVERVIEW_LOD_SCALE && this.mapW * TILE > CHUNK_PX * 2) {
      const ov = this.getOverviewCanvas();
      if (ov) {
        ctx.drawImage(ov, 0, 0, this.mapW * TILE, this.mapH * TILE);
        return;
      }
    }
    const maxCx = Math.max(0, Math.ceil(this.mapW / CHUNK_TILES) - 1);
    const maxCy = Math.max(0, Math.ceil(this.mapH / CHUNK_TILES) - 1);
    const cx0 = Math.max(0, Math.floor(vx0 / CHUNK_PX));
    const cy0 = Math.max(0, Math.floor(vy0 / CHUNK_PX));
    const cx1 = Math.min(maxCx, Math.floor(vx1 / CHUNK_PX));
    const cy1 = Math.min(maxCy, Math.floor(vy1 / CHUNK_PX));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const entry = this.getOrBakeChunk(art, cx, cy);
        ctx.drawImage(entry.floor, cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }
  }

  drawWalls(
    art: ArtModule,
    ctx: CanvasRenderingContext2D,
    vx0: number,
    vy0: number,
    vx1: number,
    vy1: number,
    scale: number,
  ): void {
    if (!this.building) return;
    if (scale <= OVERVIEW_LOD_SCALE && this.mapW * TILE > CHUNK_PX * 2) {
      // Overview already bakes simplified walls cleanly at LOD scale
      return;
    }
    const maxCx = Math.max(0, Math.ceil(this.mapW / CHUNK_TILES) - 1);
    const maxCy = Math.max(0, Math.ceil(this.mapH / CHUNK_TILES) - 1);
    const cx0 = Math.max(0, Math.floor(vx0 / CHUNK_PX));
    const cy0 = Math.max(0, Math.floor((vy0 - WALL_MARGIN) / CHUNK_PX));
    const cx1 = Math.min(maxCx, Math.floor(vx1 / CHUNK_PX));
    const cy1 = Math.min(maxCy, Math.floor(vy1 / CHUNK_PX));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const entry = this.getOrBakeChunk(art, cx, cy);
        ctx.drawImage(entry.walls, cx * CHUNK_PX, cy * CHUNK_PX - WALL_MARGIN);
      }
    }
  }

  getOverviewCanvas(): HTMLCanvasElement | null {
    if (!this.building || this.mapW <= 0 || this.mapH <= 0) return null;
    if (!this.overviewDirty && this.overview) return this.overview;
    const maxTiles = Math.max(this.mapW, this.mapH);
    const pxPerTile = Math.max(2, Math.floor(OVERVIEW_MAX_PX / maxTiles));
    const w = Math.min(OVERVIEW_MAX_PX, Math.max(32, this.mapW * pxPerTile));
    const h = Math.min(OVERVIEW_MAX_PX, Math.max(32, this.mapH * pxPerTile));
    const sx = w / this.mapW;
    const sy = h / this.mapH;

    if (!this.overview || this.overview.width !== w || this.overview.height !== h) {
      const [c] = createCanvas(w, h);
      this.overview = c;
    }
    const ctx = this.overview.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = FLOOR_FALLBACK.grass;
    ctx.fillRect(0, 0, w, h);

    if (this.common) {
      for (const f of this.common.floors) {
        ctx.fillStyle = FLOOR_FALLBACK[f.kind] ?? '#d0d5dd';
        ctx.fillRect(
          Math.floor((f.x / TILE) * sx),
          Math.floor((f.y / TILE) * sy),
          Math.max(1, Math.ceil((f.w / TILE) * sx)),
          Math.max(1, Math.ceil((f.h / TILE) * sy)),
        );
      }
      for (const rug of this.common.rugs) {
        ctx.fillStyle = seasonalRugColor(this.theme, rug.color);
        ctx.fillRect(
          Math.floor((rug.x / TILE) * sx),
          Math.floor((rug.y / TILE) * sy),
          Math.max(1, Math.ceil((rug.w / TILE) * sx)),
          Math.max(1, Math.ceil((rug.h / TILE) * sy)),
        );
      }
      for (const wall of this.common.walls) {
        ctx.fillStyle = wall.style.trim ?? wall.style.base;
        const hTiles = wall.kind === 'face' ? 2 : wall.kind === 'south' ? 1 : wall.h / TILE;
        ctx.fillRect(
          Math.floor((wall.x / TILE) * sx),
          Math.floor((wall.y / TILE) * sy),
          Math.max(1, Math.ceil((wall.w / TILE) * sx)),
          Math.max(1, Math.ceil(hTiles * sy)),
        );
      }
    }

    for (const area of this.areas) {
      if (area.id === 'custom:common') continue;
      if (area.kind === 'room') {
        const rx = Math.floor(area.rect.x * sx);
        const ry = Math.floor(area.rect.y * sy);
        const rw = Math.max(1, Math.ceil(area.rect.w * sx));
        const rh = Math.max(1, Math.ceil(area.rect.h * sy));
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = area.accentColor ?? '#ffe082';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
        if (area.accentColor) {
          ctx.strokeStyle = area.accentColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
        }
      }
      for (const f of area.furniture) {
        ctx.fillStyle = f.kind.startsWith('desk') ? '#6c513b' : '#53627a';
        ctx.fillRect(
          Math.floor((f.tx + 0.1) * sx),
          Math.floor((f.ty + 0.1) * sy),
          Math.max(1, Math.round(sx * 1.2)),
          Math.max(1, Math.round(sy * 1.1)),
        );
      }
    }

    this.overviewDirty = false;
    return this.overview;
  }

  private getOrBakeChunk(art: ArtModule, cx: number, cy: number): ChunkEntry {
    const key = `${cx},${cy}`;
    const hit = this.chunks.get(key);
    if (hit) {
      // Refresh LRU position
      this.chunks.delete(key);
      this.chunks.set(key, hit);
      return hit;
    }

    const tileX0 = cx * CHUNK_TILES;
    const tileY0 = cy * CHUNK_TILES;
    const chunkW = Math.min(CHUNK_TILES, Math.max(1, this.mapW - tileX0)) * TILE;
    const chunkH = Math.min(CHUNK_TILES, Math.max(1, this.mapH - tileY0)) * TILE;
    const px0 = tileX0 * TILE;
    const py0 = tileY0 * TILE;
    const px1 = px0 + chunkW;
    const py1 = py0 + chunkH;

    const [floorCanvas, fctx] = createCanvas(chunkW, chunkH);
    fctx.translate(-px0, -py0);
    fctx.fillStyle = FLOOR_FALLBACK.grass;
    fctx.fillRect(px0, py0, chunkW, chunkH);

    const [wallsCanvas, wctx] = createCanvas(chunkW, chunkH + WALL_MARGIN);
    wctx.translate(-px0, -py0 + WALL_MARGIN);

    const common = this.common;
    if (common) {
      // Paint intersecting floor patches
      for (const f of common.floors) {
        if (f.x >= px1 || f.x + f.w <= px0 || f.y >= py1 || f.y + f.h <= py0) continue;
        const ix0 = Math.max(px0, f.x);
        const ix1 = Math.min(px1, f.x + f.w);
        const iy0 = Math.max(py0, f.y);
        const iy1 = Math.min(py1, f.y + f.h);
        try {
          art.drawFloor(fctx, f.kind, ix0, iy0, ix1 - ix0, iy1 - iy0, {
            seed: f.seed,
            tint: f.tint,
            tint2: f.tint2,
          });
        } catch {
          fctx.fillStyle = FLOOR_FALLBACK[f.kind] ?? '#d9dde2';
          fctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
        }
      }

      // Apply optional zone floor tint
      for (const a of this.areas) {
        if (!a.floorTint) continue;
        const ax0 = a.rect.x * TILE;
        const ay0 = a.rect.y * TILE;
        const ax1 = ax0 + a.rect.w * TILE;
        const ay1 = ay0 + a.rect.h * TILE;
        if (ax0 >= px1 || ax1 <= px0 || ay0 >= py1 || ay1 <= py0) continue;
        tintRect(
          fctx,
          {
            x: Math.max(px0, ax0),
            y: Math.max(py0, ay0),
            w: Math.min(px1, ax1) - Math.max(px0, ax0),
            h: Math.min(py1, ay1) - Math.max(py0, ay0),
          },
          a.floorTint,
        );
      }

      // Paint intersecting rugs
      for (const rug of common.rugs) {
        if (rug.x >= px1 || rug.x + rug.w <= px0 || rug.y >= py1 || rug.y + rug.h <= py0) continue;
        const color = seasonalRugColor(this.theme, rug.color);
        try {
          art.drawRug(fctx, rug.x, rug.y, rug.w, rug.h, color, rug.seed);
        } catch {
          fctx.fillStyle = color;
          fctx.fillRect(rug.x, rug.y, rug.w, rug.h);
        }
      }

      // Paint intersecting walls (with vertical overlap for face walls & top margin)
      const order: Record<WallSegment['kind'], number> = { face: 0, south: 1, cap: 2 };
      const segs = common.walls
        .filter((w) => {
          const wh = w.kind === 'face' ? 2 * TILE : w.kind === 'south' ? TILE : w.h;
          return !(w.x >= px1 || w.x + w.w <= px0 || w.y >= py1 + WALL_MARGIN || w.y + wh <= py0 - WALL_MARGIN);
        })
        .sort((a, b) => order[a.kind] - order[b.kind]);
      for (const w of segs) {
        const styled = { ...w, style: seasonalWallStyle(this.theme, w.style) };
        try {
          if (styled.kind === 'face') {
            art.drawWallFace(wctx, styled.x, styled.y, styled.w, styled.style, styled.doorways ? { doorways: styled.doorways } : undefined);
          } else if (styled.kind === 'south') {
            art.drawSouthWall(wctx, styled.x, styled.y, styled.w, styled.style, styled.doorways ? { doorways: styled.doorways } : undefined);
          } else {
            art.drawWallTop(wctx, styled.x, styled.y, styled.w, styled.h, styled.style);
          }
        } catch {
          wctx.fillStyle = styled.style.base;
          wctx.fillRect(styled.x, styled.y, styled.w, styled.kind === 'face' ? 2 * TILE : styled.kind === 'south' ? TILE : styled.h);
        }
      }
    }

    // Paint static wall items (posters, paintings, sconces, etc.) falling within this chunk
    for (const area of this.areas) {
      for (const it of area.wallItems) {
        if (it.cx < px0 - 3 * TILE || it.cx > px1 + 3 * TILE || it.baseY < py0 - 3 * TILE || it.baseY > py1 + 3 * TILE) continue;
        if (isDynamicWallKind(it.kind)) continue;
        const vis: WallVis = {
          id: it.id,
          kind: it.kind,
          variant: it.variant,
          seed: hashWallSeed(area.id, it.id),
          cx: it.cx,
          baseY: it.baseY,
          on: it.on,
          order: it.order,
          areaId: area.id,
        };
        const sp = wallSprites(art, vis.kind, vis.variant, 0, vis.seed);
        if (!sp) continue;
        const o = wallItemOrigin(vis, sp.base);
        if (vis.kind === 'painting' || vis.kind === 'poster') {
          const tiles = Math.max(1, Math.round(sp.base.canvas.width / TILE));
          const ai = pickWallArt(this.assets, vis.kind, tiles, vis.variant, vis.seed);
          if (ai?.framed || (vis.kind === 'poster' && ai)) {
            const img = ai.framed ?? ai;
            wctx.drawImage(img.img, Math.round(vis.cx - img.w / 2), vis.baseY - 28);
            continue;
          }
        }
        wctx.drawImage(sp.base.canvas, o.x, o.y);
      }
    }

    const entry: ChunkEntry = { key, cx, cy, floor: floorCanvas, walls: wallsCanvas };
    this.chunks.set(key, entry);
    if (this.chunks.size > MAX_CHUNKS) {
      const oldestKey = this.chunks.keys().next().value;
      if (oldestKey !== undefined) this.chunks.delete(oldestKey);
    }
    return entry;
  }
}

function isDynamicWallKind(kind: string): boolean {
  return (
    kind === 'window' ||
    kind === 'clock' ||
    kind === 'whiteboard' ||
    kind === 'tv' ||
    kind === 'elevator' ||
    kind === 'light_switch' ||
    kind === 'sign' ||
    kind === 'mirror'
  );
}

function hashWallSeed(areaId: string, id: string): number {
  let h = 2166136261;
  const s = `${areaId}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tintRect(ctx: CanvasRenderingContext2D, px: { x: number; y: number; w: number; h: number }, color: string): void {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return;
  const n = parseInt(m[1], 16);
  const k = 0.1;
  const ch = (v: number) => Math.round(255 + (v - 255) * k);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  ctx.fillRect(px.x, px.y, px.w, px.h);
  ctx.restore();
}

export function buildCustomAreaVisListHelper(
  art: ArtModule,
  layout: AreaLayout,
  room: RoomState | undefined,
): AreaVis {
  return makeCustomPlaceholderVis(art, layout, room);
}
