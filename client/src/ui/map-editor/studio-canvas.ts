import * as artModule from '../../art';
import { FURNITURE, TILE, type ArtModule, type Dir, type FloorKind, type FurnitureKind, type WallStyle } from '../../art/api';
import type { BuildingLayout } from '../../world/layout/building';
import { drawArenaFloor } from '../../world/render/arena-render';
import { CustomChunkCache } from '../../world/render/custom-chunks';
import { makeCustomPlaceholderVis } from '../../world/render/custom-area-vis';
import { furnitureSprites, toWallVis, wallItemOrigin, wallSprites, type AreaVis, type FurnVis, type WallVis } from '../../world/render/scene';
import {
  FloorGridBuffer,
  compileCustomMap,
  isWalkableFloorKind,
  type CustomFurnitureItem,
  type CustomMapDocument,
  type CustomWallBlock,
  type MapClipboardPayload,
  type MapElementRef,
  type SpriteRot,
  type StudioTaskBox,
} from '../../../../shared/map';

const art: ArtModule = artModule;

export type StudioToolId =
  | 'select'
  | 'marquee'
  | 'brush'
  | 'bucket'
  | 'rect'
  | 'workstation'
  | 'stamp'
  | 'paste'
  | 'eraser'
  | 'eyedropper'
  | 'ai_box'
  | 'ref_move'
  | 'pan';

export interface RefImageState {
  img: HTMLImageElement;
  url: string;
  name: string;
  /** Floating-point tile coordinates (unclamped so oversized floorplans drag anywhere freely). */
  x: number;
  y: number;
  w: number;
  h: number;
  naturalRatio: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  staging: boolean;
  aboveMap: boolean;
  keepAspect: boolean;
}

export interface CanvasToolSettings {
  tool: StudioToolId;
  brushMode: 'floor' | 'wall' | 'doorway';
  brushSize: 1 | 2 | 3 | 5;
  floorKind: FloorKind;
  floorTint: string;
  wallKind: 'face' | 'south' | 'cap';
  wallStyle: WallStyle;
  rectMode: 'room' | 'floor' | 'rug' | 'zone';
  rectZoneKind: 'room' | 'lounge' | 'cafe' | 'restroom' | 'reception' | 'arena' | 'corridor';
  rugColor: string;
  stampTarget: 'furniture' | 'wallItem' | 'spawn';
  stampKind: FurnitureKind;
  stampVariant: string;
  stampRot: SpriteRot;
  stampFlipX: boolean;
  stampFlipY: boolean;
  wsFacing: Dir;
  wsLayout: 'row' | 'island';
  wsCount: number;
  wsDeskVariant: string;
  wsChairVariant: string;
  eraserMode: 'items' | 'floor' | 'all';
  showGrid: boolean;
  showWalkability: boolean;
  showZones: boolean;
}

export interface StudioCanvasCallbacks {
  getDoc: () => CustomMapDocument;
  onDocLivePreview: (doc: CustomMapDocument, dirtyRect?: { x: number; y: number; w: number; h: number }) => void;
  onDocCommit: (doc: CustomMapDocument, label: string, dirtyRect?: { x: number; y: number; w: number; h: number }) => void;
  getSelectedRefs: () => readonly MapElementRef[];
  onSetSelectedRefs: (refs: MapElementRef[], focusPrimary?: boolean) => void;
  getMarquee: () => { x: number; y: number; w: number; h: number } | null;
  onSetMarquee: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  getAiBoxes: () => readonly StudioTaskBox[];
  getActiveAiBoxId: () => string | null;
  onUpdateAiBoxes: (boxes: StudioTaskBox[], activeId: string | null) => void;
  getPasteClip: () => MapClipboardPayload | null;
  onStampPaste: (tx: number, ty: number) => void;
  onPickToolFromEyedropper: (patch: Partial<CanvasToolSettings>) => void;
  onDropAssetFromDock: (kind: string, tx: number, ty: number) => void;
  onRefChanged: () => void;
  onHoverTile: (tx: number, ty: number, inBounds: boolean) => void;
  onZoomChanged: (zoom: number) => void;
  onToolHotkey?: (tool: StudioToolId) => void;
}

type RefHandle = 'body' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState {
  mode:
    | 'pan'
    | 'brush_floor'
    | 'wall_line'
    | 'eraser'
    | 'rect'
    | 'marquee'
    | 'move_marquee'
    | 'move_items'
    | 'ai_draw'
    | 'ai_move'
    | 'ref_drag';
  startWx: number;
  startWy: number;
  startTx: number;
  startTy: number;
  curTx: number;
  curTy: number;
  curWx: number;
  curWy: number;
  lastTx: number;
  lastTy: number;
  shift: boolean;
  workingDoc?: CustomMapDocument;
  dirtyRect?: { x: number; y: number; w: number; h: number };
  origMarquee?: { x: number; y: number; w: number; h: number };
  origBox?: StudioTaskBox;
  refHandle?: RefHandle;
  origRef?: { x: number; y: number; w: number; h: number };
  moveSnapshots?: {
    furniture: Map<string, { tx: number; ty: number }>;
    wallItems: Map<string, { tx: number; ty: number }>;
    walls: Map<string, { tx: number; ty: number }>;
    rugs: Map<string, { x: number; y: number }>;
    zones: Map<string, { x: number; y: number }>;
    spawns: Map<string, { tx: number; ty: number }>;
  };
}

const RULER_PX = 22;

export class StudioCanvas {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly chunks = new CustomChunkCache();
  private compiled: BuildingLayout | null = null;
  private areas: AreaVis[] = [];
  private refImg: RefImageState | null = null;

  /** Camera top-left in world pixels, plus zoom factor (`scale = zoom`). */
  private camX = -48;
  private camY = -48;
  private zoom = 1.6;
  private spaceHeld = false;
  private pointerInside = false;
  private drag: DragState | null = null;
  private hoverTile = { tx: 0, ty: 0, inBounds: false };
  private rafPending = false;
  private dirtyCompiled = true;
  private ro: ResizeObserver | null = null;

  constructor(
    public settings: CanvasToolSettings,
    private readonly cb: StudioCanvasCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ms-canvas-host';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ms-canvas';
    this.canvas.tabIndex = 0;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.root.append(this.canvas);

    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resizeCanvas());
    this.ro.observe(this.root);
    this.resizeCanvas();
  }

  destroy(): void {
    this.ro?.disconnect();
  }

  getRefImage(): RefImageState | null {
    return this.refImg;
  }

  setRefImage(next: RefImageState | null): void {
    if (this.refImg && (!next || this.refImg.url !== next.url)) {
      if (this.refImg.url.startsWith('blob:')) URL.revokeObjectURL(this.refImg.url);
    }
    this.refImg = next;
    this.requestRender();
    this.cb.onRefChanged();
  }

  getZoom(): number {
    return this.zoom;
  }

  setZoom(nextZoom: number, pivotClientX?: number, pivotClientY?: number): void {
    const clamped = Math.max(0.15, Math.min(8, nextZoom));
    if (pivotClientX !== undefined && pivotClientY !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = pivotClientX - rect.left - RULER_PX;
      const sy = pivotClientY - rect.top - RULER_PX;
      const wx = this.camX + sx / this.zoom;
      const wy = this.camY + sy / this.zoom;
      this.zoom = clamped;
      this.camX = wx - sx / this.zoom;
      this.camY = wy - sy / this.zoom;
    } else {
      const cx = (this.canvas.clientWidth - RULER_PX) / 2;
      const cy = (this.canvas.clientHeight - RULER_PX) / 2;
      const wx = this.camX + cx / this.zoom;
      const wy = this.camY + cy / this.zoom;
      this.zoom = clamped;
      this.camX = wx - cx / this.zoom;
      this.camY = wy - cy / this.zoom;
    }
    this.cb.onZoomChanged(this.zoom);
    this.requestRender();
  }

  fitToMap(): void {
    const doc = this.cb.getDoc();
    const vw = Math.max(120, this.canvas.clientWidth - RULER_PX - 40);
    const vh = Math.max(120, this.canvas.clientHeight - RULER_PX - 40);
    const mw = doc.width * TILE;
    const mh = doc.height * TILE;
    const nextZoom = Math.max(0.2, Math.min(4, Math.min(vw / mw, vh / mh)));
    this.zoom = nextZoom;
    this.camX = mw / 2 - (this.canvas.clientWidth - RULER_PX) / (2 * this.zoom);
    this.camY = mh / 2 - (this.canvas.clientHeight - RULER_PX) / (2 * this.zoom);
    this.cb.onZoomChanged(this.zoom);
    this.requestRender();
  }

  centerOnTile(tx: number, ty: number): void {
    const vw = Math.max(120, this.canvas.clientWidth - RULER_PX);
    const vh = Math.max(120, this.canvas.clientHeight - RULER_PX);
    if (this.zoom < 1.5) this.zoom = 2;
    this.camX = (tx + 0.5) * TILE - vw / (2 * this.zoom);
    this.camY = (ty + 0.5) * TILE - vh / (2 * this.zoom);
    this.cb.onZoomChanged(this.zoom);
    this.requestRender();
  }

  invalidateMap(dirtyRect?: { x: number; y: number; w: number; h: number }): void {
    this.dirtyCompiled = true;
    if (dirtyRect) this.chunks.invalidateRect(dirtyRect);
    else this.chunks.invalidateAll();
    this.requestRender();
  }

  invalidateChunksOnly(dirtyRect?: { x: number; y: number; w: number; h: number }): void {
    this.dirtyCompiled = true;
    if (dirtyRect) this.chunks.invalidateRect(dirtyRect);
    this.requestRender();
  }

  requestRender(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.render();
    });
  }

  private resizeCanvas(): void {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.max(64, this.root.clientWidth);
    const h = Math.max(64, this.root.clientHeight);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.requestRender();
  }

  private ensureCompiled(doc: CustomMapDocument): BuildingLayout {
    if (this.dirtyCompiled || !this.compiled || this.compiled.customDoc !== doc) {
      this.compiled = compileCustomMap(doc, 1);
      this.chunks.sync(this.compiled, 'none', null, 0);
      this.areas = [...this.compiled.core, ...this.compiled.rooms].map((a) =>
        makeCustomPlaceholderVis(art, a, undefined),
      );
      this.dirtyCompiled = false;
    }
    return this.compiled;
  }

  private screenToWorld(clientX: number, clientY: number): { wx: number; wy: number; sx: number; sy: number } {
    const r = this.canvas.getBoundingClientRect();
    const sx = clientX - r.left - RULER_PX;
    const sy = clientY - r.top - RULER_PX;
    return {
      sx,
      sy,
      wx: this.camX + sx / this.zoom,
      wy: this.camY + sy / this.zoom,
    };
  }

  // ------------------------------------------------------------------ pointer & keyboard

  private bindEvents(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && !this.isTyping(ev.target)) {
        this.spaceHeld = true;
        this.canvas.style.cursor = 'grab';
      }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') {
        this.spaceHeld = false;
        this.updateCursor();
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) >= 4) {
          const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
          this.setZoom(this.zoom * factor, ev.clientX, ev.clientY);
        } else {
          this.camX += ev.deltaX / this.zoom;
          this.camY += ev.deltaY / this.zoom;
          this.requestRender();
        }
      },
      { passive: false },
    );

    this.canvas.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      const { wx, wy } = this.screenToWorld(ev.clientX, ev.clientY);
      const doc = this.cb.getDoc();
      const tx = Math.floor(wx / TILE);
      const ty = Math.floor(wy / TILE);
      this.hoverTile = { tx, ty, inBounds: tx >= 0 && ty >= 0 && tx < doc.width && ty < doc.height };
      this.requestRender();
    });

    this.canvas.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const kind = ev.dataTransfer?.getData('text/agent-party-asset');
      if (!kind) return;
      const { wx, wy } = this.screenToWorld(ev.clientX, ev.clientY);
      const tx = Math.floor(wx / TILE);
      const ty = Math.floor(wy / TILE);
      this.cb.onDropAssetFromDock(kind, tx, ty);
    });

    this.canvas.addEventListener('pointerenter', () => {
      this.pointerInside = true;
      this.requestRender();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.requestRender();
    });
    this.canvas.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    window.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    window.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
  }

  private isTyping(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  }

  private hitRefImage(wx: number, wy: number): RefHandle | null {
    const ref = this.refImg;
    if (!ref || !ref.visible) return null;
    if (!ref.staging && ref.locked && this.settings.tool !== 'ref_move') return null;

    const x0 = ref.x * TILE;
    const y0 = ref.y * TILE;
    const x1 = (ref.x + ref.w) * TILE;
    const y1 = (ref.y + ref.h) * TILE;
    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    const tol = Math.max(8 / this.zoom, 6);

    const handles: Array<[RefHandle, number, number]> = [
      ['nw', x0, y0],
      ['n', xm, y0],
      ['ne', x1, y0],
      ['e', x1, ym],
      ['se', x1, y1],
      ['s', xm, y1],
      ['sw', x0, y1],
      ['w', x0, ym],
    ];
    for (const [key, hx, hy] of handles) {
      if (Math.abs(wx - hx) <= tol && Math.abs(wy - hy) <= tol) return key;
    }
    if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) return 'body';
    return null;
  }

  private hitElement(doc: CustomMapDocument, wx: number, wy: number): MapElementRef | null {
    const tx = wx / TILE;
    const ty = wy / TILE;

    // 1. Spawns
    for (let i = doc.spawns.length - 1; i >= 0; i--) {
      const s = doc.spawns[i];
      if (s.hidden) continue;
      if (tx >= s.tx && tx <= s.tx + 1 && ty >= s.ty && ty <= s.ty + 1) {
        return { layer: 'spawn', id: s.id };
      }
    }

    // 2. Furniture (front-to-back by bottom Y)
    const furnSorted = [...doc.furniture]
      .filter((f) => !f.hidden)
      .sort((a, b) => {
        const fa = FURNITURE[a.kind]?.footprint ?? { w: 1, h: 1 };
        const fb = FURNITURE[b.kind]?.footprint ?? { w: 1, h: 1 };
        return b.ty + fb.h - (a.ty + fa.h);
      });
    for (const f of furnSorted) {
      const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      if (tx >= f.tx - 0.15 && tx <= f.tx + fp.w + 0.15 && ty >= f.ty - 0.5 && ty <= f.ty + fp.h + 0.1) {
        return { layer: 'furniture', id: f.id };
      }
    }

    // 3. Wall items
    for (let i = doc.wallItems.length - 1; i >= 0; i--) {
      const wi = doc.wallItems[i];
      if (wi.hidden) continue;
      const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
      const top = wi.on === 'south' ? wi.ty - 1 : wi.ty - 2;
      if (tx >= wi.tx - fw / 2 - 0.15 && tx <= wi.tx + fw / 2 + 0.15 && ty >= top && ty <= wi.ty + 0.15) {
        return { layer: 'wallItem', id: wi.id };
      }
    }

    // 4. Walls
    for (let i = doc.walls.length - 1; i >= 0; i--) {
      const w = doc.walls[i];
      if (w.hidden) continue;
      const h = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
      if (tx >= w.tx && tx <= w.tx + w.w && ty >= w.ty && ty <= w.ty + h) {
        return { layer: 'wall', id: w.id };
      }
    }

    // 5. Rugs
    for (let i = doc.rugs.length - 1; i >= 0; i--) {
      const r = doc.rugs[i];
      if (r.hidden) continue;
      if (tx >= r.x && tx <= r.x + r.w && ty >= r.y && ty <= r.y + r.h) {
        return { layer: 'rug', id: r.id };
      }
    }

    // 6. Zones
    for (let i = doc.zones.length - 1; i >= 0; i--) {
      const z = doc.zones[i];
      if (z.hidden) continue;
      if (tx >= z.rect.x && tx <= z.rect.x + z.rect.w && ty >= z.rect.y && ty <= z.rect.y + z.rect.h) {
        return { layer: 'zone', id: z.id };
      }
    }

    return null;
  }

  private onPointerDown(ev: PointerEvent): void {
    this.canvas.focus();
    const { wx, wy } = this.screenToWorld(ev.clientX, ev.clientY);
    const doc = this.cb.getDoc();
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);

    // 1. Middle mouse, Spacebar, or Hand tool -> Pan
    if (ev.button === 1 || this.spaceHeld || this.settings.tool === 'pan') {
      this.drag = {
        mode: 'pan',
        startWx: ev.clientX,
        startWy: ev.clientY,
        startTx: this.camX,
        startTy: this.camY,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
      };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (ev.button !== 0) return;

    // 2. Reference Image staging / unlocked -> HIGHEST HIT PRIORITY!
    const refHit = this.hitRefImage(wx, wy);
    if (refHit && this.refImg) {
      this.drag = {
        mode: 'ref_drag',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
        refHandle: refHit,
        origRef: { x: this.refImg.x, y: this.refImg.y, w: this.refImg.w, h: this.refImg.h },
      };
      return;
    }

    // 3. Alt+Click anywhere -> Eyedropper
    if (ev.altKey || this.settings.tool === 'eyedropper') {
      this.runEyedropper(doc, wx, wy, tx, ty);
      return;
    }

    // 4. Paste Stamp Mode
    if (this.settings.tool === 'paste') {
      this.cb.onStampPaste(tx, ty);
      return;
    }

    // 5. Workstation / Single Asset Stamp
    if (this.settings.tool === 'workstation') {
      const next = this.placeWorkstationStamp(doc, tx, ty);
      this.cb.onDocCommit(next, `放置工位组合 (${tx},${ty})`, { x: tx - 2, y: ty - 2, w: 8, h: 8 });
      return;
    }

    if (this.settings.tool === 'stamp') {
      const next = this.placeAssetStamp(doc, tx, ty, wx, wy);
      if (next) {
        this.cb.onDocCommit(next, `放置 ${this.settings.stampKind}`, { x: tx - 2, y: ty - 2, w: 6, h: 6 });
      }
      return;
    }

    // 6. Bucket Fill
    if (this.settings.tool === 'bucket') {
      const next = this.floodFillFloor(doc, tx, ty);
      if (next) {
        this.cb.onDocCommit(next, `油漆桶填充 ${this.settings.floorKind}`);
      }
      return;
    }

    // 7. Continuous Brush
    if (this.settings.tool === 'brush') {
      if (this.settings.brushMode === 'doorway') {
        const toggled = this.toggleWallDoorway(doc, tx, ty);
        if (toggled) {
          this.cb.onDocCommit(toggled, '切换门洞', { x: tx - 2, y: ty - 2, w: 5, h: 5 });
        }
        return;
      }
      if (this.settings.brushMode === 'wall') {
        this.drag = {
          mode: 'wall_line',
          startWx: wx,
          startWy: wy,
          startTx: tx,
          startTy: ty,
          curTx: tx,
          curTy: ty,
          curWx: wx,
          curWy: wy,
          lastTx: tx,
          lastTy: ty,
          shift: ev.shiftKey,
        };
        this.requestRender();
        return;
      }
      const work = structuredClone(doc) as CustomMapDocument;
      const dirty = this.paintFloorBrushAt(work, tx, ty);
      this.drag = {
        mode: 'brush_floor',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
        workingDoc: work,
        dirtyRect: dirty,
      };
      this.cb.onDocLivePreview(work, dirty);
      return;
    }

    // 8. Continuous Eraser
    if (this.settings.tool === 'eraser') {
      const work = structuredClone(doc) as CustomMapDocument;
      const dirty = this.eraseAt(work, tx, ty);
      this.drag = {
        mode: 'eraser',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
        workingDoc: work,
        dirtyRect: dirty,
      };
      this.cb.onDocLivePreview(work, dirty);
      return;
    }

    // 9. Rect Builder (Room / Floor Rect / Rug / Zone)
    if (this.settings.tool === 'rect') {
      this.drag = {
        mode: 'rect',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
      };
      this.requestRender();
      return;
    }

    // 10. Marquee Select
    if (this.settings.tool === 'marquee') {
      const curM = this.cb.getMarquee();
      if (curM && tx >= curM.x && tx < curM.x + curM.w && ty >= curM.y && ty < curM.y + curM.h) {
        this.drag = {
          mode: 'move_marquee',
          startWx: wx,
          startWy: wy,
          startTx: tx,
          startTy: ty,
          curTx: tx,
          curTy: ty,
          curWx: wx,
          curWy: wy,
          lastTx: tx,
          lastTy: ty,
          shift: ev.shiftKey,
          origMarquee: { ...curM },
        };
        return;
      }
      this.drag = {
        mode: 'marquee',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
      };
      this.cb.onSetMarquee({ x: tx, y: ty, w: 1, h: 1 });
      return;
    }

    // 11. AI Multi-Box Tool
    if (this.settings.tool === 'ai_box') {
      const boxes = [...this.cb.getAiBoxes()];
      const hitBox = [...boxes].reverse().find((b) => tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h);
      if (hitBox) {
        this.cb.onUpdateAiBoxes(boxes, hitBox.id);
        this.drag = {
          mode: 'ai_move',
          startWx: wx,
          startWy: wy,
          startTx: tx,
          startTy: ty,
          curTx: tx,
          curTy: ty,
          curWx: wx,
          curWy: wy,
          lastTx: tx,
          lastTy: ty,
          shift: ev.shiftKey,
          origBox: { ...hitBox },
        };
        return;
      }
      this.drag = {
        mode: 'ai_draw',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
      };
      return;
    }

    // 12. Select / Move Tool (V)
    const hit = this.hitElement(doc, wx, wy);
    if (!hit) {
      if (!ev.shiftKey) this.cb.onSetSelectedRefs([], false);
      this.drag = {
        mode: 'marquee',
        startWx: wx,
        startWy: wy,
        startTx: tx,
        startTy: ty,
        curTx: tx,
        curTy: ty,
        curWx: wx,
        curWy: wy,
        lastTx: tx,
        lastTy: ty,
        shift: ev.shiftKey,
      };
      this.cb.onSetMarquee({ x: tx, y: ty, w: 1, h: 1 });
      return;
    }

    let nextSel = [...this.cb.getSelectedRefs()];
    const already = nextSel.some((r) => r.layer === hit.layer && r.id === hit.id);
    if (ev.shiftKey) {
      nextSel = already ? nextSel.filter((r) => !(r.layer === hit.layer && r.id === hit.id)) : [...nextSel, hit];
      this.cb.onSetSelectedRefs(nextSel, true);
    } else if (!already) {
      // Auto-include group siblings if item belongs to a non-locked group when holding Alt/normal click
      const grpId = this.findElementGroupId(doc, hit);
      if (grpId) {
        const g = (doc.groups ?? []).find((x) => x.id === grpId);
        if (g?.locked) {
          this.cb.onSetSelectedRefs([hit], true);
          return;
        }
      }
      nextSel = [hit];
      this.cb.onSetSelectedRefs(nextSel, true);
    }

    // Check lock state
    const activeSel = ev.shiftKey ? nextSel : already ? nextSel : [hit];
    if (activeSel.length === 0) return;

    const work = structuredClone(doc) as CustomMapDocument;
    const snap = {
      furniture: new Map<string, { tx: number; ty: number }>(),
      wallItems: new Map<string, { tx: number; ty: number }>(),
      walls: new Map<string, { tx: number; ty: number }>(),
      rugs: new Map<string, { x: number; y: number }>(),
      zones: new Map<string, { x: number; y: number }>(),
      spawns: new Map<string, { tx: number; ty: number }>(),
    };
    const selKeys = new Set(activeSel.map((s) => `${s.layer}:${s.id}`));
    for (const f of work.furniture) if (selKeys.has(`furniture:${f.id}`) && !f.locked) snap.furniture.set(f.id, { tx: f.tx, ty: f.ty });
    for (const wi of work.wallItems) if (selKeys.has(`wallItem:${wi.id}`) && !wi.locked) snap.wallItems.set(wi.id, { tx: wi.tx, ty: wi.ty });
    for (const w of work.walls) if (selKeys.has(`wall:${w.id}`) && !w.locked) snap.walls.set(w.id, { tx: w.tx, ty: w.ty });
    for (const r of work.rugs) if (selKeys.has(`rug:${r.id}`) && !r.locked) snap.rugs.set(r.id, { x: r.x, y: r.y });
    for (const z of work.zones) if (selKeys.has(`zone:${z.id}`) && !z.locked) snap.zones.set(z.id, { x: z.rect.x, y: z.rect.y });
    for (const s of work.spawns) if (selKeys.has(`spawn:${s.id}`) && !s.locked) snap.spawns.set(s.id, { tx: s.tx, ty: s.ty });

    this.drag = {
      mode: 'move_items',
      startWx: wx,
      startWy: wy,
      startTx: tx,
      startTy: ty,
      curTx: tx,
      curTy: ty,
      curWx: wx,
      curWy: wy,
      lastTx: tx,
      lastTy: ty,
      shift: ev.shiftKey,
      workingDoc: work,
      moveSnapshots: snap,
    };
  }

  private onPointerMove(ev: PointerEvent): void {
    const doc = this.cb.getDoc();
    const { wx, wy } = this.screenToWorld(ev.clientX, ev.clientY);
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    const inBounds = tx >= 0 && ty >= 0 && tx < doc.width && ty < doc.height;
    this.hoverTile = { tx, ty, inBounds };
    this.cb.onHoverTile(tx, ty, inBounds);

    if (!this.drag) {
      this.updateCursor(wx, wy);
      if (this.settings.tool === 'stamp' || this.settings.tool === 'workstation' || this.settings.tool === 'paste' || this.settings.tool === 'brush') {
        this.requestRender();
      }
      return;
    }

    const d = this.drag;
    d.curWx = wx;
    d.curWy = wy;
    d.curTx = tx;
    d.curTy = ty;

    if (d.mode === 'pan') {
      const dx = (ev.clientX - d.startWx) / this.zoom;
      const dy = (ev.clientY - d.startWy) / this.zoom;
      this.camX = d.startTx - dx;
      this.camY = d.startTy - dy;
      this.requestRender();
      return;
    }

    if (d.mode === 'ref_drag' && this.refImg && d.origRef) {
      const dxT = (wx - d.startWx) / TILE;
      const dyT = (wy - d.startWy) / TILE;
      const o = d.origRef;
      const ref = this.refImg;
      const keep = ev.shiftKey ? !ref.keepAspect : ref.keepAspect;
      if (d.refHandle === 'body') {
        ref.x = o.x + dxT;
        ref.y = o.y + dyT;
      } else {
        let nx = o.x;
        let ny = o.y;
        let nw = o.w;
        let nh = o.h;
        const h = d.refHandle!;
        if (h.includes('w')) {
          nw = Math.max(1, o.w - dxT);
          nx = o.x + (o.w - nw);
        }
        if (h.includes('e')) nw = Math.max(1, o.w + dxT);
        if (h.includes('n')) {
          nh = Math.max(1, o.h - dyT);
          ny = o.y + (o.h - nh);
        }
        if (h.includes('s')) nh = Math.max(1, o.h + dyT);
        if (keep && (h === 'nw' || h === 'ne' || h === 'se' || h === 'sw')) {
          nh = Math.max(1, nw / ref.naturalRatio);
          if (h.includes('n')) ny = o.y + (o.h - nh);
        }
        ref.x = nx;
        ref.y = ny;
        ref.w = nw;
        ref.h = nh;
      }
      this.requestRender();
      this.cb.onRefChanged();
      return;
    }

    if (d.mode === 'brush_floor' && d.workingDoc) {
      if (tx !== d.lastTx || ty !== d.lastTy) {
        const steps = this.bresenham(d.lastTx, d.lastTy, tx, ty);
        for (const [bx, by] of steps) {
          const patch = this.paintFloorBrushAt(d.workingDoc, bx, by);
          d.dirtyRect = this.mergeRect(d.dirtyRect, patch);
        }
        d.lastTx = tx;
        d.lastTy = ty;
        this.cb.onDocLivePreview(d.workingDoc, d.dirtyRect);
      }
      return;
    }

    if (d.mode === 'eraser' && d.workingDoc) {
      if (tx !== d.lastTx || ty !== d.lastTy) {
        const steps = this.bresenham(d.lastTx, d.lastTy, tx, ty);
        for (const [bx, by] of steps) {
          const patch = this.eraseAt(d.workingDoc, bx, by);
          d.dirtyRect = this.mergeRect(d.dirtyRect, patch);
        }
        d.lastTx = tx;
        d.lastTy = ty;
        this.cb.onDocLivePreview(d.workingDoc, d.dirtyRect);
      }
      return;
    }

    if (d.mode === 'marquee') {
      const x0 = Math.min(d.startTx, tx);
      const y0 = Math.min(d.startTy, ty);
      const w = Math.abs(tx - d.startTx) + 1;
      const h = Math.abs(ty - d.startTy) + 1;
      this.cb.onSetMarquee({
        x: Math.max(0, x0),
        y: Math.max(0, y0),
        w: Math.max(1, Math.min(doc.width - Math.max(0, x0), w)),
        h: Math.max(1, Math.min(doc.height - Math.max(0, y0), h)),
      });
      this.requestRender();
      return;
    }

    if (d.mode === 'move_marquee' && d.origMarquee) {
      const dx = tx - d.startTx;
      const dy = ty - d.startTy;
      const nx = Math.max(0, Math.min(doc.width - d.origMarquee.w, d.origMarquee.x + dx));
      const ny = Math.max(0, Math.min(doc.height - d.origMarquee.h, d.origMarquee.y + dy));
      this.cb.onSetMarquee({ ...d.origMarquee, x: nx, y: ny });
      this.requestRender();
      return;
    }

    if (d.mode === 'ai_move' && d.origBox) {
      const dx = tx - d.startTx;
      const dy = ty - d.startTy;
      const boxes = this.cb.getAiBoxes().map((b) =>
        b.id === d.origBox!.id
          ? {
              ...b,
              x: Math.max(0, Math.min(doc.width - b.w, d.origBox!.x + dx)),
              y: Math.max(0, Math.min(doc.height - b.h, d.origBox!.y + dy)),
            }
          : b,
      );
      this.cb.onUpdateAiBoxes(boxes, d.origBox.id);
      this.requestRender();
      return;
    }

    if (d.mode === 'move_items' && d.workingDoc && d.moveSnapshots) {
      const dx = Math.round((wx - d.startWx) / TILE);
      const dy = Math.round((wy - d.startWy) / TILE);
      const work = d.workingDoc;
      const s = d.moveSnapshots;
      for (const f of work.furniture) {
        const o = s.furniture.get(f.id);
        if (!o) continue;
        const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
        f.tx = Math.max(0, Math.min(work.width - fp.w, o.tx + dx));
        f.ty = Math.max(0, Math.min(work.height - fp.h, o.ty + dy));
      }
      for (const wi of work.wallItems) {
        const o = s.wallItems.get(wi.id);
        if (!o) continue;
        const halfDx = Math.round(((wx - d.startWx) / TILE) * 2) / 2;
        wi.tx = Math.max(0, Math.min(work.width, o.tx + halfDx));
        wi.ty = Math.max(0, Math.min(work.height, o.ty + dy));
      }
      for (const w of work.walls) {
        const o = s.walls.get(w.id);
        if (!o) continue;
        w.tx = Math.max(0, Math.min(work.width - 1, o.tx + dx));
        w.ty = Math.max(0, Math.min(work.height - 1, o.ty + dy));
      }
      for (const r of work.rugs) {
        const o = s.rugs.get(r.id);
        if (!o) continue;
        r.x = Math.max(0, Math.min(work.width - r.w, o.x + dx));
        r.y = Math.max(0, Math.min(work.height - r.h, o.y + dy));
      }
      for (const z of work.zones) {
        const o = s.zones.get(z.id);
        if (!o) continue;
        z.rect.x = Math.max(0, Math.min(work.width - z.rect.w, o.x + dx));
        z.rect.y = Math.max(0, Math.min(work.height - z.rect.h, o.y + dy));
      }
      for (const sp of work.spawns) {
        const o = s.spawns.get(sp.id);
        if (!o) continue;
        sp.tx = Math.max(0, Math.min(work.width - 1, o.tx + dx));
        sp.ty = Math.max(0, Math.min(work.height - 1, o.ty + dy));
      }
      this.cb.onDocLivePreview(work);
      return;
    }

    this.requestRender();
  }

  private onPointerUp(_ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.updateCursor();

    if (d.mode === 'brush_floor' && d.workingDoc) {
      this.cb.onDocCommit(d.workingDoc, `涂抹 ${this.settings.floorKind}`, d.dirtyRect);
      return;
    }

    if (d.mode === 'eraser' && d.workingDoc) {
      this.cb.onDocCommit(d.workingDoc, '橡皮擦除', d.dirtyRect);
      return;
    }

    if (d.mode === 'wall_line') {
      const next = this.commitWallLine(this.cb.getDoc(), d.startTx, d.startTy, d.curTx, d.curTy);
      if (next) {
        const rect = {
          x: Math.min(d.startTx, d.curTx) - 1,
          y: Math.min(d.startTy, d.curTy) - 1,
          w: Math.abs(d.curTx - d.startTx) + 4,
          h: Math.abs(d.curTy - d.startTy) + 4,
        };
        this.cb.onDocCommit(next, '绘制墙体', rect);
      }
      return;
    }

    if (d.mode === 'rect') {
      const x = Math.max(0, Math.min(d.startTx, d.curTx));
      const y = Math.max(0, Math.min(d.startTy, d.curTy));
      const w = Math.max(1, Math.abs(d.curTx - d.startTx) + 1);
      const h = Math.max(1, Math.abs(d.curTy - d.startTy) + 1);
      const next = this.commitRectShape(this.cb.getDoc(), { x, y, w, h });
      this.cb.onDocCommit(next, `矩形绘制 (${w}×${h})`, { x: x - 1, y: y - 1, w: w + 2, h: h + 2 });
      return;
    }

    if (d.mode === 'ai_draw') {
      const doc = this.cb.getDoc();
      const x = Math.max(0, Math.min(doc.width - 1, Math.min(d.startTx, d.curTx)));
      const y = Math.max(0, Math.min(doc.height - 1, Math.min(d.startTy, d.curTy)));
      const w = Math.max(1, Math.min(doc.width - x, Math.abs(d.curTx - d.startTx) + 1));
      const h = Math.max(1, Math.min(doc.height - y, Math.abs(d.curTy - d.startTy) + 1));
      const boxes = [...this.cb.getAiBoxes()];
      const newBox: StudioTaskBox = {
        id: `box-${Date.now().toString(36)}-${boxes.length + 1}`,
        label: `区块 #${boxes.length + 1}`,
        x,
        y,
        w,
        h,
      };
      boxes.push(newBox);
      this.cb.onUpdateAiBoxes(boxes, newBox.id);
      this.requestRender();
      return;
    }

    if (d.mode === 'marquee') {
      const doc = this.cb.getDoc();
      const x = Math.max(0, Math.min(doc.width - 1, Math.min(d.startTx, d.curTx)));
      const y = Math.max(0, Math.min(doc.height - 1, Math.min(d.startTy, d.curTy)));
      const w = Math.max(1, Math.min(doc.width - x, Math.abs(d.curTx - d.startTx) + 1));
      const h = Math.max(1, Math.min(doc.height - y, Math.abs(d.curTy - d.startTy) + 1));
      if (this.settings.tool === 'select') {
        // Select all elements touching dragged rectangle in Move mode
        if (w <= 1 && h <= 1) {
          this.cb.onSetMarquee(null);
        } else {
          this.selectElementsInRect(doc, { x, y, w, h }, d.shift);
          this.cb.onSetMarquee(null);
        }
      } else {
        this.cb.onSetMarquee({ x, y, w, h });
      }
      this.requestRender();
      return;
    }

    if (d.mode === 'move_items' && d.workingDoc) {
      const moved = Math.abs(d.curWx - d.startWx) >= 3 || Math.abs(d.curWy - d.startWy) >= 3;
      if (moved) {
        this.cb.onDocCommit(d.workingDoc, '移动图层元素');
      } else {
        this.requestRender();
      }
      return;
    }

    this.requestRender();
  }

  private updateCursor(wx?: number, wy?: number): void {
    if (this.spaceHeld || this.settings.tool === 'pan') {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (wx !== undefined && wy !== undefined) {
      const refHit = this.hitRefImage(wx, wy);
      if (refHit) {
        const map: Record<RefHandle, string> = {
          body: 'move',
          nw: 'nwse-resize',
          se: 'nwse-resize',
          ne: 'nesw-resize',
          sw: 'nesw-resize',
          n: 'ns-resize',
          s: 'ns-resize',
          e: 'ew-resize',
          w: 'ew-resize',
        };
        this.canvas.style.cursor = map[refHit];
        return;
      }
    }
    this.canvas.style.cursor = this.settings.tool === 'select' ? 'default' : 'crosshair';
  }

  // ------------------------------------------------------------------ editing primitives

  private bresenham(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    let cx = x0;
    let cy = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      pts.push([cx, cy]);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
    return pts;
  }

  private mergeRect(
    a: { x: number; y: number; w: number; h: number } | undefined,
    b: { x: number; y: number; w: number; h: number },
  ): { x: number; y: number; w: number; h: number } {
    if (!a) return { ...b };
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.w, b.x + b.w);
    const y1 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private paintFloorBrushAt(doc: CustomMapDocument, tx: number, ty: number): { x: number; y: number; w: number; h: number } {
    const r = Math.floor(this.settings.brushSize / 2);
    const x0 = Math.max(0, tx - r);
    const y0 = Math.max(0, ty - r);
    const w = Math.min(doc.width - x0, this.settings.brushSize);
    const h = Math.min(doc.height - y0, this.settings.brushSize);
    if (w > 0 && h > 0) {
      const buf = FloorGridBuffer.fromDocument(doc);
      buf.fillRect(x0, y0, w, h, {
        kind: this.settings.floorKind,
        ...(this.settings.floorTint ? { tint: this.settings.floorTint } : {}),
      });
      doc.floorPalette = buf.palette;
      doc.floorRows = buf.toRows();
      doc.updatedAt = Date.now();
    }
    return { x: x0, y: y0, w: Math.max(1, w), h: Math.max(1, h) };
  }

  private floodFillFloor(doc: CustomMapDocument, sx: number, sy: number): CustomMapDocument | null {
    if (sx < 0 || sy < 0 || sx >= doc.width || sy >= doc.height) return null;
    const next = structuredClone(doc) as CustomMapDocument;
    const buf = FloorGridBuffer.fromDocument(next);
    const targetIdx = buf.getIndex(sx, sy);
    const newIdx = buf.ensurePaletteIndex({
      kind: this.settings.floorKind,
      ...(this.settings.floorTint ? { tint: this.settings.floorTint } : {}),
    });
    if (targetIdx === newIdx) return null;

    const w = next.width;
    const h = next.height;
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    queue[tail++] = sy * w + sx;
    visited[sy * w + sx] = 1;

    while (head < tail) {
      const idx = queue[head++];
      buf.data[idx] = newIdx;
      const x = idx % w;
      const y = Math.floor(idx / w);
      const tryPush = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const ni = ny * w + nx;
        if (visited[ni] || buf.data[ni] !== targetIdx) return;
        visited[ni] = 1;
        queue[tail++] = ni;
      };
      tryPush(x + 1, y);
      tryPush(x - 1, y);
      tryPush(x, y + 1);
      tryPush(x, y - 1);
    }

    next.floorPalette = buf.palette;
    next.floorRows = buf.toRows();
    next.updatedAt = Date.now();
    return next;
  }

  private eraseAt(doc: CustomMapDocument, tx: number, ty: number): { x: number; y: number; w: number; h: number } {
    const r = Math.floor(this.settings.brushSize / 2);
    const x0 = Math.max(0, tx - r);
    const y0 = Math.max(0, ty - r);
    const w = Math.max(1, Math.min(doc.width - x0, this.settings.brushSize));
    const h = Math.max(1, Math.min(doc.height - y0, this.settings.brushSize));
    const x1 = x0 + w;
    const y1 = y0 + h;
    const hits = (ax: number, ay: number, aw: number, ah: number) => ax < x1 && ax + aw > x0 && ay < y1 && ay + ah > y0;

    if (this.settings.eraserMode === 'items' || this.settings.eraserMode === 'all') {
      doc.furniture = doc.furniture.filter((f) => {
        if (f.locked) return true;
        const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
        return !hits(f.tx, f.ty, fp.w, fp.h);
      });
      doc.wallItems = doc.wallItems.filter((wi) => {
        if (wi.locked) return true;
        const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
        return !hits(wi.tx - fw / 2, wi.ty - 2, fw, 2);
      });
      doc.walls = doc.walls.filter((wl) => {
        if (wl.locked) return true;
        const wh = wl.kind === 'face' ? 2 : wl.kind === 'south' ? 1 : wl.h;
        return !hits(wl.tx, wl.ty, wl.w, wh);
      });
      doc.rugs = doc.rugs.filter((rg) => (rg.locked ? true : !hits(rg.x, rg.y, rg.w, rg.h)));
      doc.spawns = doc.spawns.filter((sp) => (sp.locked ? true : !hits(sp.tx, sp.ty, 1, 1)));
    }
    if (this.settings.eraserMode === 'floor' || this.settings.eraserMode === 'all') {
      const buf = FloorGridBuffer.fromDocument(doc);
      buf.fillRect(x0, y0, w, h, { kind: doc.backgroundFloor });
      doc.floorPalette = buf.palette;
      doc.floorRows = buf.toRows();
    }
    doc.updatedAt = Date.now();
    return { x: x0, y: y0, w, h };
  }

  private commitWallLine(doc: CustomMapDocument, x0: number, y0: number, x1: number, y1: number): CustomMapDocument | null {
    const next = structuredClone(doc) as CustomMapDocument;
    const lx = Math.max(0, Math.min(next.width - 1, Math.min(x0, x1)));
    const ly = Math.max(0, Math.min(next.height - 1, Math.min(y0, y1)));
    const rx = Math.max(0, Math.min(next.width - 1, Math.max(x0, x1)));
    const ry = Math.max(0, Math.min(next.height - 1, Math.max(y0, y1)));
    const w = Math.max(1, rx - lx + 1);
    const h = Math.max(1, ry - ly + 1);
    let kind = this.settings.wallKind;
    if (kind !== 'cap' && h > w && w === 1) kind = 'cap';
    const ids = new Set(next.walls.map((wl) => wl.id));
    let n = 1;
    while (ids.has(`wall-${n}`)) n++;
    next.walls.push({
      id: `wall-${n}`,
      kind,
      tx: lx,
      ty: ly,
      w: kind === 'cap' ? 1 : w,
      h: kind === 'face' ? 2 : kind === 'south' ? 1 : h,
      style: { ...this.settings.wallStyle },
    });
    next.updatedAt = Date.now();
    return next;
  }

  private toggleWallDoorway(doc: CustomMapDocument, tx: number, ty: number): CustomMapDocument | null {
    const next = structuredClone(doc) as CustomMapDocument;
    const wall = next.walls.find((w) => {
      if (w.kind === 'cap') return false;
      const wh = w.kind === 'face' ? 2 : 1;
      return tx >= w.tx && tx < w.tx + w.w && ty >= w.ty && ty < w.ty + wh;
    });
    if (!wall) return null;
    const offset = Math.max(0, Math.min(wall.w - 2, tx - wall.tx));
    const list = [...(wall.doorways ?? [])];
    const existingIdx = list.findIndex((d) => tx >= wall.tx + d.offset && tx < wall.tx + d.offset + d.w);
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
    } else {
      list.push({ offset, w: Math.min(2, wall.w) });
    }
    wall.doorways = list.length ? list : undefined;
    next.updatedAt = Date.now();
    return next;
  }

  private commitRectShape(doc: CustomMapDocument, rect: { x: number; y: number; w: number; h: number }): CustomMapDocument {
    const next = structuredClone(doc) as CustomMapDocument;
    const x = Math.max(0, Math.min(next.width - 1, rect.x));
    const y = Math.max(0, Math.min(next.height - 1, rect.y));
    const w = Math.max(1, Math.min(next.width - x, rect.w));
    const h = Math.max(1, Math.min(next.height - y, rect.h));

    if (this.settings.rectMode === 'floor') {
      const buf = FloorGridBuffer.fromDocument(next);
      buf.fillRect(x, y, w, h, {
        kind: this.settings.floorKind,
        ...(this.settings.floorTint ? { tint: this.settings.floorTint } : {}),
      });
      next.floorPalette = buf.palette;
      next.floorRows = buf.toRows();
    } else if (this.settings.rectMode === 'rug') {
      const ids = new Set(next.rugs.map((r) => r.id));
      let n = 1;
      while (ids.has(`rug-${n}`)) n++;
      next.rugs.push({ id: `rug-${n}`, x, y, w, h, color: this.settings.rugColor });
    } else if (this.settings.rectMode === 'zone') {
      const ids = new Set(next.zones.map((z) => z.id));
      let n = 1;
      while (ids.has(`zone-${n}`)) n++;
      next.zones.push({
        id: `zone-${n}`,
        name: `区域 ${next.zones.length + 1}`,
        kind: this.settings.rectZoneKind,
        rect: { x, y, w, h },
      });
    } else {
      // Full room shell (floor + 4 walls with doorway + zone + optional light switch + sign)
      const rw = Math.max(5, Math.min(next.width - x, w));
      const rh = Math.max(5, Math.min(next.height - y, h));
      const buf = FloorGridBuffer.fromDocument(next);
      buf.fillRect(x, y, rw, rh, {
        kind: this.settings.floorKind,
        ...(this.settings.floorTint ? { tint: this.settings.floorTint } : {}),
      });
      next.floorPalette = buf.palette;
      next.floorRows = buf.toRows();

      const zIds = new Set(next.zones.map((z) => z.id));
      let zn = 1;
      while (zIds.has(`zone-${zn}`)) zn++;
      const zid = `zone-${zn}`;
      next.zones.push({
        id: zid,
        name: `房间 ${next.zones.length + 1}`,
        kind: this.settings.rectZoneKind,
        rect: { x, y, w: rw, h: rh },
        ...(this.settings.rectZoneKind === 'room' ? { hasLightSwitch: true } : {}),
      });

      const doorOffset = Math.max(1, Math.floor(rw / 2) - 1);
      const st = { ...this.settings.wallStyle };
      next.walls.push(
        { id: `${zid}:north`, kind: 'face', tx: x, ty: y, w: rw, h: 2, style: st },
        { id: `${zid}:south`, kind: 'south', tx: x, ty: y + rh - 1, w: rw, h: 1, style: st, doorways: [{ offset: doorOffset, w: 2 }] },
        { id: `${zid}:west`, kind: 'cap', tx: x, ty: y, w: 1, h: rh, style: st },
        { id: `${zid}:east`, kind: 'cap', tx: x + rw - 1, ty: y, w: 1, h: rh, style: st },
      );
      if (rw >= 6) {
        next.wallItems.push({ id: `${zid}:sign`, kind: 'sign', tx: x + rw / 2, ty: y + 2, on: 'face', zoneId: zid });
      }
      if (this.settings.rectZoneKind === 'room') {
        next.wallItems.push({
          id: `${zid}:sw`,
          kind: 'light_switch',
          tx: Math.max(x + 1, x + doorOffset - 1),
          ty: y + rh,
          on: 'south',
          variant: 'on',
          zoneId: zid,
        });
      }
    }
    next.updatedAt = Date.now();
    return next;
  }

  private placeWorkstationStamp(doc: CustomMapDocument, tx: number, ty: number): CustomMapDocument {
    const next = structuredClone(doc) as CustomMapDocument;
    const ids = new Set(next.furniture.map((f) => f.id));
    const alloc = (p: string) => {
      let i = 1;
      while (ids.has(`${p}-${i}`)) i++;
      const id = `${p}-${i}`;
      ids.add(id);
      return id;
    };
    const count = Math.max(1, Math.min(8, this.settings.wsCount));
    const dv = this.settings.wsDeskVariant || 'wood';
    const cv = this.settings.wsChairVariant || 'black';
    const facing = this.settings.wsFacing;

    const addPair = (dk: FurnitureKind, dx: number, dy: number, ck: FurnitureKind, cx: number, cy: number, dir: Dir) => {
      const dfp = FURNITURE[dk].footprint;
      const cfp = FURNITURE[ck].footprint;
      if (dx < 0 || dy < 0 || dx + dfp.w > next.width || dy + dfp.h > next.height) return;
      if (cx < 0 || cy < 0 || cx + cfp.w > next.width || cy + cfp.h > next.height) return;
      const deskId = alloc('desk');
      const chairId = alloc('chair');
      next.furniture.push({ id: deskId, kind: dk, tx: dx, ty: dy, variant: dv });
      next.furniture.push({ id: chairId, kind: ck, tx: cx, ty: cy, variant: cv, dir, deskId });
    };

    for (let i = 0; i < count; i++) {
      if (facing === 'up') addPair('desk', tx + i * 3, ty, 'office_chair', tx + i * 3, ty + 1, 'up');
      else if (facing === 'down') addPair('desk_back', tx + i * 3, ty + 1, 'office_chair_front', tx + i * 3, ty, 'down');
      else if (facing === 'right') addPair('desk_west', tx + 1, ty + i * 3, 'office_chair_right', tx, ty + i * 3, 'right');
      else addPair('desk_east', tx, ty + i * 3, 'office_chair_left', tx + 1, ty + i * 3, 'left');
    }
    next.updatedAt = Date.now();
    return next;
  }

  private placeAssetStamp(doc: CustomMapDocument, tx: number, ty: number, wx: number, wy: number): CustomMapDocument | null {
    const next = structuredClone(doc) as CustomMapDocument;
    if (this.settings.stampTarget === 'spawn') {
      if (tx < 0 || ty < 0 || tx >= next.width || ty >= next.height) return null;
      const ids = new Set(next.spawns.map((s) => s.id));
      let i = 1;
      while (ids.has(`spawn-${i}`)) i++;
      next.spawns.push({ id: `spawn-${i}`, tx, ty, dir: this.settings.wsFacing });
      next.updatedAt = Date.now();
      return next;
    }

    const kind = this.settings.stampKind;
    const def = FURNITURE[kind];
    if (!def) return null;

    if (def.mount === 'wall' || this.settings.stampTarget === 'wallItem') {
      const ids = new Set(next.wallItems.map((w) => w.id));
      let i = 1;
      while (ids.has(`wi-${i}`)) i++;
      const halfX = Math.max(0, Math.min(next.width, Math.round((wx / TILE) * 2) / 2));
      const snapY = Math.max(0, Math.min(next.height, Math.round(wy / TILE)));
      next.wallItems.push({
        id: `wi-${i}`,
        kind,
        tx: halfX,
        ty: snapY,
        on: 'face',
        ...(this.settings.stampVariant ? { variant: this.settings.stampVariant } : {}),
        ...(this.settings.stampRot ? { rot: this.settings.stampRot } : {}),
        ...(this.settings.stampFlipX ? { flipX: true } : {}),
        ...(this.settings.stampFlipY ? { flipY: true } : {}),
      });
      next.updatedAt = Date.now();
      return next;
    }

    const ax = Math.max(0, Math.min(next.width - def.footprint.w, tx));
    const ay = Math.max(0, Math.min(next.height - def.footprint.h, ty));
    const ids = new Set(next.furniture.map((f) => f.id));
    let i = 1;
    while (ids.has(`f-${i}`)) i++;
    next.furniture.push({
      id: `f-${i}`,
      kind,
      tx: ax,
      ty: ay,
      ...(this.settings.stampVariant ? { variant: this.settings.stampVariant } : {}),
      ...(this.settings.stampRot ? { rot: this.settings.stampRot } : {}),
      ...(this.settings.stampFlipX ? { flipX: true } : {}),
      ...(this.settings.stampFlipY ? { flipY: true } : {}),
    });
    next.updatedAt = Date.now();
    return next;
  }

  private runEyedropper(doc: CustomMapDocument, wx: number, wy: number, tx: number, ty: number): void {
    const hit = this.hitElement(doc, wx, wy);
    if (hit?.layer === 'furniture') {
      const f = doc.furniture.find((x) => x.id === hit.id);
      if (f) {
        this.cb.onPickToolFromEyedropper({
          tool: 'stamp',
          stampTarget: 'furniture',
          stampKind: f.kind,
          stampVariant: f.variant ?? FURNITURE[f.kind]?.variants?.[0] ?? '',
          stampRot: f.rot ?? 0,
          stampFlipX: !!f.flipX,
          stampFlipY: !!f.flipY,
        });
        return;
      }
    }
    if (hit?.layer === 'wallItem') {
      const wi = doc.wallItems.find((x) => x.id === hit.id);
      if (wi) {
        this.cb.onPickToolFromEyedropper({
          tool: 'stamp',
          stampTarget: 'wallItem',
          stampKind: wi.kind,
          stampVariant: wi.variant ?? FURNITURE[wi.kind]?.variants?.[0] ?? '',
          stampRot: wi.rot ?? 0,
          stampFlipX: !!wi.flipX,
          stampFlipY: !!wi.flipY,
        });
        return;
      }
    }
    if (hit?.layer === 'wall') {
      const wl = doc.walls.find((x) => x.id === hit.id);
      if (wl) {
        this.cb.onPickToolFromEyedropper({
          tool: 'brush',
          brushMode: 'wall',
          wallKind: wl.kind,
          wallStyle: { ...wl.style },
        });
        return;
      }
    }
    if (tx >= 0 && ty >= 0 && tx < doc.width && ty < doc.height) {
      const buf = FloorGridBuffer.fromDocument(doc);
      const entry = buf.getEntry(tx, ty);
      this.cb.onPickToolFromEyedropper({
        tool: 'brush',
        brushMode: 'floor',
        floorKind: entry.kind,
        floorTint: entry.tint ?? '',
      });
    }
  }

  private selectElementsInRect(doc: CustomMapDocument, rect: { x: number; y: number; w: number; h: number }, append: boolean): void {
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    const hitRect = (ax: number, ay: number, aw: number, ah: number) => ax < x1 && ax + aw > rect.x && ay < y1 && ay + ah > rect.y;

    const found: MapElementRef[] = append ? [...this.cb.getSelectedRefs()] : [];
    const seen = new Set(found.map((r) => `${r.layer}:${r.id}`));
    const push = (layer: MapElementRef['layer'], id: string) => {
      if (!seen.has(`${layer}:${id}`)) {
        seen.add(`${layer}:${id}`);
        found.push({ layer, id });
      }
    };

    for (const f of doc.furniture) {
      if (f.hidden) continue;
      const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      if (hitRect(f.tx, f.ty, fp.w, fp.h)) push('furniture', f.id);
    }
    for (const wi of doc.wallItems) {
      if (wi.hidden) continue;
      const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
      if (hitRect(wi.tx - fw / 2, wi.ty - 2, fw, 2)) push('wallItem', wi.id);
    }
    for (const wl of doc.walls) {
      if (wl.hidden) continue;
      const wh = wl.kind === 'face' ? 2 : wl.kind === 'south' ? 1 : wl.h;
      if (hitRect(wl.tx, wl.ty, wl.w, wh)) push('wall', wl.id);
    }
    for (const r of doc.rugs) if (!r.hidden && hitRect(r.x, r.y, r.w, r.h)) push('rug', r.id);
    for (const sp of doc.spawns) if (!sp.hidden && hitRect(sp.tx, sp.ty, 1, 1)) push('spawn', sp.id);

    this.cb.onSetSelectedRefs(found, true);
  }

  private findElementGroupId(doc: CustomMapDocument, ref: MapElementRef): string | undefined {
    if (ref.layer === 'furniture') return doc.furniture.find((x) => x.id === ref.id)?.groupId;
    if (ref.layer === 'wallItem') return doc.wallItems.find((x) => x.id === ref.id)?.groupId;
    if (ref.layer === 'wall') return doc.walls.find((x) => x.id === ref.id)?.groupId;
    if (ref.layer === 'rug') return doc.rugs.find((x) => x.id === ref.id)?.groupId;
    if (ref.layer === 'zone') return doc.zones.find((x) => x.id === ref.id)?.groupId;
    if (ref.layer === 'spawn') return doc.spawns.find((x) => x.id === ref.id)?.groupId;
    return undefined;
  }

  // ------------------------------------------------------------------ rendering pipeline

  render(): void {
    const doc = this.cb.getDoc();
    const layout = this.ensureCompiled(doc);
    const { ctx, canvas } = this;
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const vx0 = this.camX;
    const vy0 = this.camY;
    const vx1 = this.camX + (cw - RULER_PX) / this.zoom;
    const vy1 = this.camY + (ch - RULER_PX) / this.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0e111a';
    ctx.fillRect(0, 0, cw, ch);

    // Clip viewport inside PS rulers
    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER_PX, RULER_PX, Math.max(0, cw - RULER_PX), Math.max(0, ch - RULER_PX));
    ctx.clip();
    ctx.translate(RULER_PX, RULER_PX);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    // Subtle canvas backdrop shadow & border
    ctx.fillStyle = '#080a10';
    ctx.fillRect(4, 4, doc.width * TILE, doc.height * TILE);

    // 1. Floors + Rugs via 32x32 chunk cache
    this.chunks.drawFloors(art, ctx, vx0, vy0, vx1, vy1, this.zoom);

    // Arena floor static visual preview
    if (layout.arena) {
      drawArenaFloor(ctx, layout.arena.rect, null as never, 0);
    }

    // 2. Reference image (if under walls/furniture)
    if (this.refImg && this.refImg.visible && !this.refImg.aboveMap && !this.refImg.staging) {
      this.drawRefImage(ctx, this.refImg);
    }

    // 3. Walls + Static wall items via chunks
    this.chunks.drawWalls(art, ctx, vx0, vy0, vx1, vy1, this.zoom);

    // 4. Dynamic wall items (windows, signs, clocks, switches, tvs, etc.)
    const dynamicKinds = new Set(['window', 'clock', 'whiteboard', 'tv', 'elevator', 'light_switch', 'sign', 'mirror']);
    for (const vis of this.areas) {
      for (const wi of vis.wallItems) {
        if (!dynamicKinds.has(wi.kind)) continue;
        this.drawStudioWallItem(ctx, wi, vis.layout.kind);
      }
    }

    // 5. Depth-sorted floor furniture
    const allFurn: Array<{ f: FurnVis; areaId: string }> = [];
    for (const vis of this.areas) {
      for (const f of vis.furniture) allFurn.push({ f, areaId: vis.id });
    }
    allFurn.sort((a, b) => a.f.ay - b.f.ay);
    for (const { f } of allFurn) {
      this.drawStudioFurniture(ctx, f);
    }

    // 6. Spawns
    for (const sp of doc.spawns) {
      if (sp.hidden) continue;
      const sx = sp.tx * TILE;
      const sy = sp.ty * TILE;
      ctx.fillStyle = 'rgba(72, 232, 144, 0.25)';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = '#62f5a6';
      ctx.lineWidth = Math.max(1 / this.zoom, 1);
      ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
    }

    // 7. Optional Overlays: Zones, Walkability Grid, Tile Grid
    if (this.settings.showZones || (this.settings.tool === 'rect' && (this.settings.rectMode === 'room' || this.settings.rectMode === 'zone'))) {
      for (const z of doc.zones) {
        if (z.hidden) continue;
        const zx = z.rect.x * TILE;
        const zy = z.rect.y * TILE;
        const zw = z.rect.w * TILE;
        const zh = z.rect.h * TILE;
        ctx.save();
        ctx.strokeStyle = z.accentColor ?? '#f2c14e';
        ctx.lineWidth = Math.max(1 / this.zoom, 1);
        ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
        ctx.strokeRect(zx, zy, zw, zh);
        ctx.restore();
        if (this.zoom >= 0.65) {
          ctx.fillStyle = 'rgba(14, 17, 26, 0.78)';
          const tw = Math.min(zw - 4, z.name.length * 7 + 8);
          ctx.fillRect(zx + 2, zy + 2, Math.max(24, tw), 11);
          ctx.fillStyle = z.accentColor ?? '#f2c14e';
          ctx.font = 'bold 7px monospace';
          ctx.fillText(z.name, zx + 5, zy + 10);
        }
      }
    }

    if (this.settings.showWalkability) {
      const tx0 = Math.max(0, Math.floor(vx0 / TILE));
      const ty0 = Math.max(0, Math.floor(vy0 / TILE));
      const tx1 = Math.min(doc.width - 1, Math.ceil(vx1 / TILE));
      const ty1 = Math.min(doc.height - 1, Math.ceil(vy1 / TILE));
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const w = layout.grid.get(tx, ty);
          ctx.fillStyle = w === 0 ? 'rgba(72, 240, 144, 0.14)' : w === 2 ? 'rgba(77, 238, 234, 0.28)' : 'rgba(255, 86, 102, 0.22)';
          ctx.fillRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
        }
      }
      for (const sp of layout.spots) {
        ctx.fillStyle = '#4deeea';
        ctx.fillRect(sp.tx * TILE + 6, sp.ty * TILE + 6, 4, 4);
      }
    }

    if (this.settings.showGrid && this.zoom >= 0.75) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      const gx0 = Math.max(0, Math.floor(vx0 / TILE));
      const gx1 = Math.min(doc.width, Math.ceil(vx1 / TILE));
      const gy0 = Math.max(0, Math.floor(vy0 / TILE));
      const gy1 = Math.min(doc.height, Math.ceil(vy1 / TILE));
      for (let x = gx0; x <= gx1; x++) {
        ctx.moveTo(x * TILE, gy0 * TILE);
        ctx.lineTo(x * TILE, gy1 * TILE);
      }
      for (let y = gy0; y <= gy1; y++) {
        ctx.moveTo(gx0 * TILE, y * TILE);
        ctx.lineTo(gx1 * TILE, y * TILE);
      }
      ctx.stroke();
    }

    // Canvas border frame
    ctx.strokeStyle = '#3c4664';
    ctx.lineWidth = 2 / this.zoom;
    ctx.strokeRect(0, 0, doc.width * TILE, doc.height * TILE);

    // 8. Reference image above map (when staging or top overlay) + interactive handles
    if (this.refImg && this.refImg.visible && (this.refImg.aboveMap || this.refImg.staging)) {
      this.drawRefImage(ctx, this.refImg);
    }
    if (this.refImg && this.refImg.visible && (this.refImg.staging || !this.refImg.locked || this.settings.tool === 'ref_move')) {
      this.drawRefHandles(ctx, this.refImg);
    }

    // 9. Selection outlines & AI boxes
    this.drawSelectedOutlines(ctx, doc);
    this.drawAiBoxes(ctx);

    const marquee = this.cb.getMarquee();
    if (marquee) {
      ctx.save();
      ctx.strokeStyle = '#4deeea';
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.setLineDash([5 / this.zoom, 4 / this.zoom]);
      ctx.strokeRect(marquee.x * TILE, marquee.y * TILE, marquee.w * TILE, marquee.h * TILE);
      ctx.fillStyle = 'rgba(77, 238, 234, 0.12)';
      ctx.fillRect(marquee.x * TILE, marquee.y * TILE, marquee.w * TILE, marquee.h * TILE);
      ctx.restore();
    }

    // 10. Live Tool Ghost Previews
    this.drawToolPreview(ctx, doc);

    ctx.restore();

    // 11. PS Rulers
    this.drawRulers(ctx, cw, ch);
  }

  private drawRefImage(ctx: CanvasRenderingContext2D, ref: RefImageState): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0.05, Math.min(1, ref.opacity));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ref.img, ref.x * TILE, ref.y * TILE, ref.w * TILE, ref.h * TILE);
    ctx.restore();
  }

  private drawRefHandles(ctx: CanvasRenderingContext2D, ref: RefImageState): void {
    const x0 = ref.x * TILE;
    const y0 = ref.y * TILE;
    const w = ref.w * TILE;
    const h = ref.h * TILE;
    const x1 = x0 + w;
    const y1 = y0 + h;
    const xm = x0 + w / 2;
    const ym = y0 + h / 2;

    ctx.save();
    ctx.strokeStyle = ref.staging ? '#f2c14e' : '#4deeea';
    ctx.lineWidth = 2 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
    ctx.strokeRect(x0, y0, w, h);
    ctx.setLineDash([]);

    const hs = Math.max(6 / this.zoom, 5);
    ctx.fillStyle = '#0e111a';
    ctx.strokeStyle = ref.staging ? '#f2c14e' : '#4deeea';
    ctx.lineWidth = 1.5 / this.zoom;
    for (const [hx, hy] of [
      [x0, y0], [xm, y0], [x1, y0], [x1, ym],
      [x1, y1], [xm, y1], [x0, y1], [x0, ym],
    ]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  private drawStudioFurniture(ctx: CanvasRenderingContext2D, f: FurnVis): void {
    const fs = furnitureSprites(art, f, 0);
    if (!fs) return;
    const dx = Math.round(f.ax - fs.base.ax);
    const dy = Math.round(f.ay - fs.base.ay);
    const hasXf = Boolean(f.rot || f.flipX || f.flipY);
    if (hasXf) {
      const cx = dx + fs.base.canvas.width / 2;
      const cy = dy + fs.base.canvas.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (f.rot) ctx.rotate((f.rot * Math.PI) / 180);
      if (f.flipX || f.flipY) ctx.scale(f.flipX ? -1 : 1, f.flipY ? -1 : 1);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(fs.base.canvas, dx, dy);
    if (fs.front?.canvas) {
      ctx.drawImage(fs.front.canvas, Math.round(f.ax - fs.front.ax), Math.round(f.ay - fs.front.ay));
    }
    if (hasXf) ctx.restore();
  }

  private drawStudioWallItem(ctx: CanvasRenderingContext2D, w: WallVis, _areaKind: string): void {
    const s = wallSprites(art, w.kind, w.variant === 'wide' ? undefined : w.variant, 0, w.seed);
    if (!s) return;
    const o = wallItemOrigin(w, s.base);
    const hasXf = Boolean(w.rot || w.flipX || w.flipY);
    if (hasXf) {
      const cx = o.x + s.base.canvas.width / 2;
      const cy = o.y + s.base.canvas.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (w.rot) ctx.rotate((w.rot * Math.PI) / 180);
      if (w.flipX || w.flipY) ctx.scale(w.flipX ? -1 : 1, w.flipY ? -1 : 1);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(s.base.canvas, o.x, o.y);
    if (hasXf) ctx.restore();
  }

  private drawSelectedOutlines(ctx: CanvasRenderingContext2D, doc: CustomMapDocument): void {
    const refs = this.cb.getSelectedRefs();
    if (!refs.length) return;
    ctx.save();
    ctx.strokeStyle = '#ffdf6b';
    ctx.lineWidth = 2 / this.zoom;
    for (const r of refs) {
      if (r.layer === 'furniture') {
        const f = doc.furniture.find((x) => x.id === r.id);
        if (!f) continue;
        const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
        ctx.strokeRect(f.tx * TILE, f.ty * TILE, fp.w * TILE, fp.h * TILE);
      } else if (r.layer === 'wallItem') {
        const wi = doc.wallItems.find((x) => x.id === r.id);
        if (!wi) continue;
        const fw = Math.max(1, FURNITURE[wi.kind]?.footprint.w ?? 1);
        const h = wi.on === 'south' ? 1 : 2;
        ctx.strokeRect((wi.tx - fw / 2) * TILE, (wi.ty - h) * TILE, fw * TILE, h * TILE);
      } else if (r.layer === 'wall') {
        const w = doc.walls.find((x) => x.id === r.id);
        if (!w) continue;
        const wh = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
        ctx.strokeRect(w.tx * TILE, w.ty * TILE, w.w * TILE, wh * TILE);
      } else if (r.layer === 'rug') {
        const rg = doc.rugs.find((x) => x.id === r.id);
        if (!rg) continue;
        ctx.strokeRect(rg.x * TILE, rg.y * TILE, rg.w * TILE, rg.h * TILE);
      } else if (r.layer === 'zone') {
        const z = doc.zones.find((x) => x.id === r.id);
        if (!z) continue;
        ctx.strokeRect(z.rect.x * TILE, z.rect.y * TILE, z.rect.w * TILE, z.rect.h * TILE);
      } else if (r.layer === 'spawn') {
        const sp = doc.spawns.find((x) => x.id === r.id);
        if (!sp) continue;
        ctx.strokeRect(sp.tx * TILE, sp.ty * TILE, TILE, TILE);
      }
    }
    ctx.restore();
  }

  private drawAiBoxes(ctx: CanvasRenderingContext2D): void {
    const boxes = this.cb.getAiBoxes();
    const activeId = this.cb.getActiveAiBoxId();
    for (const b of boxes) {
      const isAct = b.id === activeId;
      ctx.save();
      ctx.fillStyle = isAct ? 'rgba(98, 245, 166, 0.16)' : 'rgba(130, 170, 255, 0.12)';
      ctx.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
      ctx.strokeStyle = isAct ? '#62f5a6' : '#82aaff';
      ctx.lineWidth = (isAct ? 2.2 : 1.5) / this.zoom;
      ctx.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);

      ctx.fillStyle = isAct ? '#10291b' : '#182238';
      const label = `${b.label} (${b.w}×${b.h})${b.note ? ' · ' + b.note.slice(0, 14) : ''}`;
      ctx.fillRect(b.x * TILE, Math.max(0, b.y * TILE - 12), Math.max(54, label.length * 6.5), 11);
      ctx.fillStyle = isAct ? '#62f5a6' : '#b7d0ff';
      ctx.font = 'bold 7px monospace';
      ctx.fillText(label, b.x * TILE + 3, Math.max(8, b.y * TILE - 4));
      ctx.restore();
    }
  }

  private drawToolPreview(ctx: CanvasRenderingContext2D, doc: CustomMapDocument): void {
    const d = this.drag;
    const { tx, ty, inBounds } = this.hoverTile;

    if (d?.mode === 'rect' || d?.mode === 'ai_draw' || (d?.mode === 'wall_line')) {
      const x = Math.max(0, Math.min(d.startTx, d.curTx));
      const y = Math.max(0, Math.min(d.startTy, d.curTy));
      const w = Math.max(1, Math.abs(d.curTx - d.startTx) + 1);
      const h = Math.max(1, Math.abs(d.curTy - d.startTy) + 1);
      ctx.save();
      ctx.strokeStyle = d.mode === 'ai_draw' ? '#62f5a6' : '#f2c14e';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
      ctx.fillStyle = d.mode === 'ai_draw' ? 'rgba(98,245,166,0.18)' : 'rgba(242,193,78,0.18)';
      ctx.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
      ctx.fillStyle = '#0e111a';
      ctx.fillRect(x * TILE, Math.max(0, y * TILE - 13), 56, 12);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(`${w}×${h} 格`, x * TILE + 4, Math.max(9, y * TILE - 4));
      ctx.restore();
      return;
    }

    if (this.settings.tool === 'paste') {
      const clip = this.cb.getPasteClip();
      if (!clip) return;
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.translate(tx * TILE, ty * TILE);
      if (clip.hasFloor && clip.floorPalette?.length && clip.floorRows?.length) {
        ctx.fillStyle = 'rgba(77, 238, 234, 0.16)';
        ctx.fillRect(0, 0, clip.width * TILE, clip.height * TILE);
      }
      for (const w of clip.walls) {
        const wh = w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h;
        ctx.fillStyle = w.style.base;
        ctx.fillRect(w.tx * TILE, w.ty * TILE, w.w * TILE, wh * TILE);
      }
      for (const f of clip.furniture) {
        const fs = art.furnitureSprites(f.kind, f.variant, 0, { seed: 7 });
        if (fs?.base?.canvas) {
          const fp = FURNITURE[f.kind].footprint;
          const ax = (f.tx + fp.w / 2) * TILE + (f.dx ?? 0);
          const ay = (f.ty + fp.h) * TILE + (f.dy ?? 0);
          ctx.drawImage(fs.base.canvas, Math.round(ax - fs.base.ax), Math.round(ay - fs.base.ay));
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#62f5a6';
      ctx.lineWidth = 2 / this.zoom;
      ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
      ctx.strokeRect(0, 0, clip.width * TILE, clip.height * TILE);
      ctx.restore();
      return;
    }

    if (!inBounds || (!this.pointerInside && !d)) return;

    if (this.settings.tool === 'brush' || this.settings.tool === 'eraser') {
      const r = Math.floor(this.settings.brushSize / 2);
      const bx = Math.max(0, tx - r);
      const by = Math.max(0, ty - r);
      const bw = Math.min(doc.width - bx, this.settings.brushSize);
      const bh = Math.min(doc.height - by, this.settings.brushSize);
      ctx.save();
      ctx.strokeStyle = this.settings.tool === 'eraser' ? '#ff6470' : '#4deeea';
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.strokeRect(bx * TILE, by * TILE, bw * TILE, bh * TILE);
      ctx.restore();
    } else if (this.settings.tool === 'stamp') {
      const kind = this.settings.stampKind;
      const def = FURNITURE[kind];
      if (!def) return;
      ctx.save();
      ctx.globalAlpha = 0.72;
      const fs = art.furnitureSprites(kind, this.settings.stampVariant || undefined, 0, { seed: 42 });
      if (fs?.base?.canvas) {
        const ax = (tx + def.footprint.w / 2) * TILE;
        const ay = (ty + Math.max(1, def.footprint.h)) * TILE;
        const dx = Math.round(ax - fs.base.ax);
        const dy = Math.round(ay - fs.base.ay);
        const cx = dx + fs.base.canvas.width / 2;
        const cy = dy + fs.base.canvas.height / 2;
        ctx.translate(cx, cy);
        if (this.settings.stampRot) ctx.rotate((this.settings.stampRot * Math.PI) / 180);
        if (this.settings.stampFlipX || this.settings.stampFlipY) {
          ctx.scale(this.settings.stampFlipX ? -1 : 1, this.settings.stampFlipY ? -1 : 1);
        }
        ctx.translate(-cx, -cy);
        ctx.drawImage(fs.base.canvas, dx, dy);
      }
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.strokeRect(tx * TILE, ty * TILE, def.footprint.w * TILE, Math.max(1, def.footprint.h) * TILE);
      ctx.restore();
    } else if (this.settings.tool === 'workstation') {
      ctx.save();
      ctx.strokeStyle = '#62f5a6';
      ctx.lineWidth = 1.5 / this.zoom;
      const horiz = this.settings.wsFacing === 'up' || this.settings.wsFacing === 'down';
      for (let i = 0; i < this.settings.wsCount; i++) {
        const wx = horiz ? (tx + i * 3) * TILE : tx * TILE;
        const wy = horiz ? ty * TILE : (ty + i * 3) * TILE;
        ctx.strokeRect(wx, wy, 2 * TILE, 2 * TILE);
      }
      ctx.restore();
    }
  }

  private drawRulers(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
    ctx.save();
    // Ruler strips
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, cw, RULER_PX);
    ctx.fillRect(0, 0, RULER_PX, ch);
    ctx.strokeStyle = '#2d354c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER_PX, 0);
    ctx.lineTo(RULER_PX, ch);
    ctx.moveTo(0, RULER_PX);
    ctx.lineTo(cw, RULER_PX);
    ctx.stroke();

    // Corner tile unit label
    ctx.fillStyle = '#8b98b8';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('格', 5, 14);

    const stepTiles = this.zoom < 0.5 ? 16 : this.zoom < 1.1 ? 8 : 4;
    const minTx = Math.floor(this.camX / TILE / stepTiles) * stepTiles;
    const maxTx = Math.ceil((this.camX + (cw - RULER_PX) / this.zoom) / TILE);
    ctx.fillStyle = '#9aa7c7';
    ctx.strokeStyle = '#475272';
    ctx.font = '9px monospace';
    for (let t = minTx; t <= maxTx; t += stepTiles) {
      const sx = RULER_PX + (t * TILE - this.camX) * this.zoom;
      if (sx < RULER_PX || sx > cw) continue;
      ctx.beginPath();
      ctx.moveTo(sx, RULER_PX - 6);
      ctx.lineTo(sx, RULER_PX);
      ctx.stroke();
      ctx.fillText(String(t), sx + 2, 12);
    }

    const minTy = Math.floor(this.camY / TILE / stepTiles) * stepTiles;
    const maxTy = Math.ceil((this.camY + (ch - RULER_PX) / this.zoom) / TILE);
    for (let t = minTy; t <= maxTy; t += stepTiles) {
      const sy = RULER_PX + (t * TILE - this.camY) * this.zoom;
      if (sy < RULER_PX || sy > ch) continue;
      ctx.beginPath();
      ctx.moveTo(RULER_PX - 6, sy);
      ctx.lineTo(RULER_PX, sy);
      ctx.stroke();
      ctx.fillText(String(t), 2, sy + 9);
    }

    // Mouse hairline indicators on rulers
    const mx = RULER_PX + (this.hoverTile.tx * TILE - this.camX) * this.zoom;
    const my = RULER_PX + (this.hoverTile.ty * TILE - this.camY) * this.zoom;
    ctx.strokeStyle = '#4deeea';
    if (mx >= RULER_PX && mx <= cw) {
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, RULER_PX);
      ctx.stroke();
    }
    if (my >= RULER_PX && my <= ch) {
      ctx.beginPath();
      ctx.moveTo(0, my);
      ctx.lineTo(RULER_PX, my);
      ctx.stroke();
    }
    ctx.restore();
  }
}

void isWalkableFloorKind;
