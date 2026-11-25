import { TILE } from '../art/api';
import type { OfficeStore } from '../net/store';
import type { WorldApi } from '../world/api';
import { h } from './dom';

const MINI_W = 188;
const MINI_H = 128;

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly body: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private collapsed = true;
  private userToggled = false;
  private dragging = false;
  private raf = 0;

  constructor(
    private readonly world: WorldApi,
    private readonly store: OfficeStore,
  ) {
    this.toggleBtn = h('button', {
      class: 'ui-minimap__toggle',
      type: 'button',
      text: '🧭 小地图',
      on: {
        click: () => {
          this.userToggled = true;
          this.setCollapsed(!this.collapsed);
        },
      },
    }) as HTMLButtonElement;

    this.canvas = h('canvas', {
      class: 'ui-minimap__canvas',
      attrs: { width: String(MINI_W), height: String(MINI_H) },
    }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    this.body = h('div', { class: 'ui-minimap__body', hidden: true }, this.canvas);
    this.el = h('div', { class: 'ui-minimap' }, this.toggleBtn, this.body);

    const panAt = (ev: PointerEvent) => {
      const editor = this.world.editor;
      if (!editor) return;
      const rect = this.canvas.getBoundingClientRect();
      const b = editor.getMapBounds();
      const scale = Math.min(MINI_W / Math.max(1, b.w), MINI_H / Math.max(1, b.h));
      const drawW = b.w * scale;
      const drawH = b.h * scale;
      const ox = (MINI_W - drawW) / 2;
      const oy = (MINI_H - drawH) / 2;
      const rx = ((ev.clientX - rect.left) * (MINI_W / Math.max(1, rect.width)) - ox) / scale;
      const ry = ((ev.clientY - rect.top) * (MINI_H / Math.max(1, rect.height)) - oy) / scale;
      const tx = Math.max(0, Math.min(b.w, rx));
      const ty = Math.max(0, Math.min(b.h, ry));
      editor.panToWorld(tx * TILE, ty * TILE);
    };

    this.canvas.addEventListener('pointerdown', (ev) => {
      this.dragging = true;
      this.canvas.setPointerCapture?.(ev.pointerId);
      panAt(ev);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (this.dragging) panAt(ev);
    });
    const endDrag = () => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.body.hidden = c;
    this.toggleBtn.textContent = c ? '🧭 小地图' : '✕ 小地图';
  }

  render(): void {
    const editor = this.world.editor;
    if (!editor) {
      this.el.hidden = true;
      return;
    }
    const b = editor.getMapBounds();
    const isLarge = b.custom || b.w > 72 || this.store.snapshot?.meta.mapMode === 'custom';
    this.el.hidden = false;
    if (!this.userToggled) {
      this.setCollapsed(!isLarge);
    }
  }

  private draw(): void {
    if (this.collapsed || this.el.hidden) return;
    const editor = this.world.editor;
    if (!editor) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MINI_W, MINI_H);
    ctx.fillStyle = '#0c111d';
    ctx.fillRect(0, 0, MINI_W, MINI_H);

    const b = editor.getMapBounds();
    const scale = Math.min(MINI_W / Math.max(1, b.w), MINI_H / Math.max(1, b.h));
    const drawW = Math.max(1, b.w * scale);
    const drawH = Math.max(1, b.h * scale);
    const ox = (MINI_W - drawW) / 2;
    const oy = (MINI_H - drawH) / 2;

    const overview = editor.getOverviewCanvas();
    if (overview) {
      ctx.drawImage(overview, ox, oy, drawW, drawH);
    } else {
      ctx.fillStyle = '#25324a';
      ctx.fillRect(ox, oy, drawW, drawH);
    }

    const vr = editor.getViewportWorldRect();
    const rx = ox + (vr.x / TILE) * scale;
    const ry = oy + (vr.y / TILE) * scale;
    const rw = Math.max(6, (vr.w / TILE) * scale);
    const rh = Math.max(4, (vr.h / TILE) * scale);
    ctx.strokeStyle = '#52c4ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.fillStyle = 'rgba(82, 196, 255, 0.14)';
    ctx.fillRect(rx, ry, rw, rh);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }
}
