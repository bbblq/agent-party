import * as artModule from '../../art';
import { TILE, type ArtModule, type FloorKind, type FurnitureKind, type WallPattern } from '../../art/api';
import {
  FULL_ASSET_CATALOG,
  type AssetCatalogEntry,
  type AssetPassability,
  type SpriteRot,
} from '../../../../shared/map';
import { drawArenaFloor } from '../../world/render/arena-render';
import { copyTextSafe } from './clipboard-http-utils';
import './map-editor.css';

export const ASSET_PICK_CHANNEL = 'agent_party_studio_pick';
export const ASSET_PICK_STORAGE_KEY = 'agent_party_studio_pick_v1';

export interface BroadcastAssetPick {
  id: string;
  variant?: string;
  rot?: SpriteRot;
  flipX?: boolean;
  flipY?: boolean;
  ts: number;
}

const art: ArtModule = artModule;

export interface AssetPickSelection {
  entry: AssetCatalogEntry;
  variant?: string;
  rot?: SpriteRot;
  flipX?: boolean;
  flipY?: boolean;
}

export class AssetCatalogView {
  readonly el: HTMLElement;
  private query = '';
  private categoryFilter = '全部';
  private passFilter: 'all' | AssetPassability = 'all';
  private interactiveFilter: 'all' | 'interactive' | 'decor' = 'all';
  private rotFilter: 'all' | 'native' | 'group' = 'all';
  private cardState = new Map<string, { variant?: string; rot: SpriteRot; flipX: boolean; flipY: boolean }>();
  private previewCache = new Map<string, string>();
  private gridEl!: HTMLElement;
  private countEl!: HTMLElement;
  private searchInput!: HTMLInputElement;

  constructor(
    private readonly callbacks: {
      onPick: (pick: AssetPickSelection) => void;
      onBackToCanvas: () => void;
      onToast: (msg: string) => void;
    },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'ms-catalog-view';
    this.el.hidden = true;
    this.buildShell();
  }

  show(): void {
    this.el.hidden = false;
    this.renderCards();
  }

  hide(): void {
    this.el.hidden = true;
  }

  private buildShell(): void {
    const categories = ['全部', ...Array.from(new Set(FULL_ASSET_CATALOG.map((e) => e.category)))];

    const top = document.createElement('div');
    top.className = 'ms-catalog-top';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ms-catalog-top__title';
    titleWrap.innerHTML = `
      <span class="ms-px-icon">📖</span>
      <div>
        <h2>Agent Party 全素材图鉴百科</h2>
        <p>共收录 ${FULL_ASSET_CATALOG.length} 项官方素材（地面材质 / 墙体纹样 / 51 种家具与墙饰 / 功能分区与出生点），包含通行属性、互动机制与多朝向/分组旋转说明。</p>
      </div>
    `;

    const backLink = document.createElement('a');
    backLink.className = 'ms-btn ms-btn--primary';
    backLink.href = '/map';
    backLink.textContent = '🎨 前往地图工坊画布';
    backLink.onclick = (ev) => {
      if (this.callbacks.onBackToCanvas) {
        ev.preventDefault();
        this.callbacks.onBackToCanvas();
      }
    };

    top.append(titleWrap, backLink);

    const filters = document.createElement('div');
    filters.className = 'ms-catalog-filters';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'ms-catalog-search';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'ms-input';
    this.searchInput.placeholder = '🔍 搜索素材 ID（如 desk, coffee, toilet）、中文名、互动方式...';
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      this.renderCards();
    });
    this.countEl = document.createElement('span');
    this.countEl.className = 'ms-catalog-count';
    searchWrap.append(this.searchInput, this.countEl);

    const catRow = document.createElement('div');
    catRow.className = 'ms-pill-row';
    for (const cat of categories) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-pill-btn ${this.categoryFilter === cat ? 'is-active' : ''}`;
      b.textContent = cat;
      b.onclick = () => {
        this.categoryFilter = cat;
        catRow.querySelectorAll('.ms-pill-btn').forEach((n) => n.classList.remove('is-active'));
        b.classList.add('is-active');
        this.renderCards();
      };
      catRow.append(b);
    }

    const attrRow = document.createElement('div');
    attrRow.className = 'ms-catalog-attr-filters';

    const passSel = this.makeSelect(
      [
        ['all', '通行性：全部'],
        ['walkable', '✅ 可自由穿过'],
        ['seat', '🪑 座位（可落座）'],
        ['blocked', '🚫 阻挡通行'],
        ['non_walkable_floor', '⛔ 户外不可走地面'],
      ],
      (v) => {
        this.passFilter = v as typeof this.passFilter;
        this.renderCards();
      },
    );

    const interSel = this.makeSelect(
      [
        ['all', '互动性：全部'],
        ['interactive', '⚡ 仅可互动素材'],
        ['decor', '🎨 纯装饰 / 结构素材'],
      ],
      (v) => {
        this.interactiveFilter = v as typeof this.interactiveFilter;
        this.renderCards();
      },
    );

    const rotSel = this.makeSelect(
      [
        ['all', '旋转朝向：全部'],
        ['native', '🔄 原生自带多朝向'],
        ['group', '📐 通过属性/图层分组旋转镜像'],
      ],
      (v) => {
        this.rotFilter = v as typeof this.rotFilter;
        this.renderCards();
      },
    );

    attrRow.append(passSel, interSel, rotSel);
    filters.append(searchWrap, catRow, attrRow);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'ms-catalog-grid';

    this.el.append(top, filters, this.gridEl);
  }

  private makeSelect(options: Array<[string, string]>, onChange: (v: string) => void): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'ms-input ms-input--sm';
    for (const [val, label] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      sel.append(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  private renderCards(): void {
    const items = FULL_ASSET_CATALOG.filter((e) => {
      if (this.categoryFilter !== '全部' && e.category !== this.categoryFilter) return false;
      if (this.passFilter !== 'all' && e.passability !== this.passFilter) return false;
      if (this.interactiveFilter === 'interactive' && !e.interactive) return false;
      if (this.interactiveFilter === 'decor' && e.interactive) return false;
      if (this.rotFilter === 'native' && e.rotatable === 'group_transform') return false;
      if (this.rotFilter === 'group' && e.rotatable !== 'group_transform') return false;
      if (this.query) {
        const hay = `${e.id} ${e.name} ${e.category} ${e.interactionDesc} ${e.rotationDesc} ${e.spotKind ?? ''}`.toLowerCase();
        if (!hay.includes(this.query)) return false;
      }
      return true;
    });

    this.countEl.textContent = `显示 ${items.length} / ${FULL_ASSET_CATALOG.length} 项`;
    this.gridEl.innerHTML = '';

    for (const entry of items) {
      const curState = this.cardState.get(entry.id) ?? {
        variant: entry.variants[0],
        rot: 0 as SpriteRot,
        flipX: false,
        flipY: false,
      };
      this.cardState.set(entry.id, curState);

      const card = document.createElement('article');
      card.className = 'ms-asset-card';

      // Preview box
      const stage = document.createElement('div');
      stage.className = 'ms-asset-card__stage';
      const img = document.createElement('img');
      img.className = 'ms-asset-card__img';
      img.alt = entry.name;
      img.src = this.renderPreviewDataUrl(entry, curState.variant, curState.rot, curState.flipX, curState.flipY);

      const stageBadge = document.createElement('span');
      stageBadge.className = 'ms-asset-card__size';
      const mountLabel =
        entry.mount === 'wall' ? '墙饰' : entry.mount === 'tile' ? '铺设' : entry.mount === 'zone' ? '区域' : '地面';
      stageBadge.textContent = `${mountLabel} · ${entry.footprint.w}×${entry.footprint.h || 1}格`;

      const quickXf = document.createElement('div');
      quickXf.className = 'ms-asset-card__xf';
      const rotBtn = document.createElement('button');
      rotBtn.type = 'button';
      rotBtn.className = 'ms-btn ms-btn--xs';
      rotBtn.title = '预览旋转 90°';
      rotBtn.textContent = curState.rot ? `↻${curState.rot}°` : '↻';
      rotBtn.onclick = () => {
        curState.rot = (((curState.rot + 90) % 360) as SpriteRot);
        img.src = this.renderPreviewDataUrl(entry, curState.variant, curState.rot, curState.flipX, curState.flipY);
        rotBtn.textContent = curState.rot ? `↻${curState.rot}°` : '↻';
      };
      const flipBtn = document.createElement('button');
      flipBtn.type = 'button';
      flipBtn.className = `ms-btn ms-btn--xs ${curState.flipX ? 'is-active' : ''}`;
      flipBtn.title = '预览水平镜像';
      flipBtn.textContent = '⇄';
      flipBtn.onclick = () => {
        curState.flipX = !curState.flipX;
        flipBtn.classList.toggle('is-active', curState.flipX);
        img.src = this.renderPreviewDataUrl(entry, curState.variant, curState.rot, curState.flipX, curState.flipY);
      };
      quickXf.append(rotBtn, flipBtn);
      stage.append(img, stageBadge, quickXf);

      // Meta & specs
      const info = document.createElement('div');
      info.className = 'ms-asset-card__body';

      const head = document.createElement('div');
      head.className = 'ms-asset-card__head';
      const titleEl = document.createElement('h3');
      titleEl.textContent = entry.name;
      const idBtn = document.createElement('button');
      idBtn.type = 'button';
      idBtn.className = 'ms-code-chip';
      idBtn.title = '点击复制素材 ID';
      idBtn.textContent = entry.id;
      idBtn.onclick = async () => {
        const res = await copyTextSafe(entry.id);
        this.callbacks.onToast(res.copied ? `📋 已复制素材 ID: ${entry.id}` : `请手动复制 ID: ${entry.id}`);
      };
      head.append(titleEl, idBtn);

      // Variants selector
      let varRow: HTMLElement | null = null;
      if (entry.variants.length > 0) {
        varRow = document.createElement('div');
        varRow.className = 'ms-asset-card__variants';
        for (const v of entry.variants) {
          const vb = document.createElement('button');
          vb.type = 'button';
          vb.className = `ms-var-pill ${curState.variant === v ? 'is-active' : ''}`;
          vb.textContent = v;
          vb.onclick = () => {
            curState.variant = v;
            varRow!.querySelectorAll('.ms-var-pill').forEach((n) => n.classList.remove('is-active'));
            vb.classList.add('is-active');
            img.src = this.renderPreviewDataUrl(entry, curState.variant, curState.rot, curState.flipX, curState.flipY);
          };
          varRow.append(vb);
        }
      }

      const passTag =
        entry.passability === 'walkable'
          ? '<span class="ms-spec-tag is-pass">✅ 可穿过</span>'
          : entry.passability === 'seat'
            ? '<span class="ms-spec-tag is-seat">🪑 座位(可坐)</span>'
            : entry.passability === 'non_walkable_floor'
              ? '<span class="ms-spec-tag is-block">⛔ 户外不可走</span>'
              : '<span class="ms-spec-tag is-block">🚫 阻挡通行</span>';

      const interTag = entry.interactive
        ? `<span class="ms-spec-tag is-inter">⚡ 可互动${entry.spotKind ? ` (${entry.spotKind})` : ''}</span>`
        : '<span class="ms-spec-tag is-decor">🎨 纯装饰/结构</span>';

      const rotTag =
        entry.rotatable === 'native_4way'
          ? '<span class="ms-spec-tag is-rot">🔄 原生四向旋转</span>'
          : entry.rotatable === 'variant_4way'
            ? '<span class="ms-spec-tag is-rot">🔄 变体四向旋转</span>'
            : entry.rotatable === 'native_2way'
              ? '<span class="ms-spec-tag is-rot">↔️ 原生双向</span>'
              : '<span class="ms-spec-tag is-group">📐 支持图层/属性旋转镜像</span>';

      const tagsEl = document.createElement('div');
      tagsEl.className = 'ms-asset-card__tags';
      tagsEl.innerHTML = `${passTag}${interTag}${rotTag}`;

      const descList = document.createElement('div');
      descList.className = 'ms-asset-card__specs';
      descList.innerHTML = `
        <div><b>通行：</b>${entry.passabilityLabel}</div>
        <div><b>互动：</b>${entry.interactionDesc}</div>
        <div><b>旋转：</b>${entry.rotationDesc}</div>
        ${entry.tips ? `<div class="ms-asset-tip">💡 ${entry.tips}</div>` : ''}
      `;

      const footer = document.createElement('div');
      footer.className = 'ms-asset-card__footer';
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'ms-btn ms-btn--primary ms-btn--sm ms-btn--full';
      useBtn.textContent = '🎨 选用此素材去画布放置';
      useBtn.onclick = () => {
        this.callbacks.onPick({
          entry,
          variant: curState.variant,
          rot: curState.rot,
          flipX: curState.flipX,
          flipY: curState.flipY,
        });
      };
      footer.append(useBtn);

      info.append(head);
      if (varRow) info.append(varRow);
      info.append(tagsEl, descList, footer);

      card.append(stage, info);
      this.gridEl.append(card);
    }
  }

  private renderPreviewDataUrl(
    entry: AssetCatalogEntry,
    variant: string | undefined,
    rot: SpriteRot,
    flipX: boolean,
    flipY: boolean,
  ): string {
    const key = `${entry.id}:${variant ?? ''}:${rot}:${flipX ? 1 : 0}:${flipY ? 1 : 0}`;
    const hit = this.previewCache.get(key);
    if (hit) return hit;

    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const drawWithXf = (drawFn: (g: CanvasRenderingContext2D, cx: number, cy: number) => void) => {
      ctx.save();
      ctx.translate(48, 48);
      if (rot) ctx.rotate((rot * Math.PI) / 180);
      if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      drawFn(ctx, 0, 0);
      ctx.restore();
    };

    try {
      if (entry.section === 'furniture') {
        const fs = art.furnitureSprites(entry.kindKey as FurnitureKind, variant, 0, { seed: 42 });
        if (fs?.base?.canvas) {
          const sp = fs.base.canvas;
          const sw = fs.front ? Math.max(sp.width, fs.front.canvas.width) : sp.width;
          const sh = fs.front ? Math.max(sp.height, fs.front.canvas.height) : sp.height;
          const scale = Math.min(3, Math.max(1, Math.floor(72 / Math.max(sw, sh))));
          drawWithXf((g) => {
            g.drawImage(sp, Math.round((-sp.width * scale) / 2), Math.round((-sp.height * scale) / 2), sp.width * scale, sp.height * scale);
            if (fs.front?.canvas) {
              g.drawImage(
                fs.front.canvas,
                Math.round((-fs.front.canvas.width * scale) / 2),
                Math.round((-fs.front.canvas.height * scale) / 2),
                fs.front.canvas.width * scale,
                fs.front.canvas.height * scale,
              );
            }
          });
        }
      } else if (entry.section === 'floor') {
        const tmp = document.createElement('canvas');
        tmp.width = TILE * 3;
        tmp.height = TILE * 3;
        const tctx = tmp.getContext('2d')!;
        tctx.imageSmoothingEnabled = false;
        art.drawFloor(tctx, entry.kindKey as FloorKind, 0, 0, tmp.width, tmp.height, { seed: 101 });
        drawWithXf((g) => {
          g.drawImage(tmp, -36, -36, 72, 72);
        });
      } else if (entry.section === 'wall') {
        const tmp = document.createElement('canvas');
        tmp.width = TILE * 3;
        tmp.height = TILE * 2;
        const tctx = tmp.getContext('2d')!;
        tctx.imageSmoothingEnabled = false;
        const pat = ((variant as WallPattern) || 'plain');
        const style = { base: '#e6e2da', trim: '#707b8c', pattern: pat };
        if (entry.id === 'wall:face') art.drawWallFace(tctx, 0, 0, tmp.width, style);
        else if (entry.id === 'wall:south') art.drawSouthWall(tctx, 0, 8, tmp.width, style);
        else art.drawWallTop(tctx, 16, 0, 16, tmp.height, style);
        drawWithXf((g) => {
          g.drawImage(tmp, -36, -24, 72, 48);
        });
      } else if (entry.id === 'zone:arena') {
        const tmp = document.createElement('canvas');
        tmp.width = 96;
        tmp.height = 96;
        const tctx = tmp.getContext('2d')!;
        tctx.imageSmoothingEnabled = false;
        tctx.fillStyle = '#363b47';
        tctx.fillRect(4, 12, 88, 72);
        drawArenaFloor(tctx, { x: 0, y: 0, w: 6, h: 6 }, null as never, 0);
        drawWithXf((g) => g.drawImage(tmp, -48, -48, 96, 96));
      } else {
        drawWithXf((g) => {
          if (entry.id === 'spawn:point') {
            g.fillStyle = '#1d3c2b';
            g.fillRect(-20, -20, 40, 40);
            g.strokeStyle = '#62f5a6';
            g.lineWidth = 3;
            g.strokeRect(-18, -18, 36, 36);
            g.fillStyle = '#62f5a6';
            g.font = 'bold 20px monospace';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            const arrow = variant === 'up' ? '↑' : variant === 'left' ? '←' : variant === 'right' ? '→' : '↓';
            g.fillText(arrow, 0, 2);
          } else {
            g.fillStyle = 'rgba(242, 193, 78, 0.22)';
            g.fillRect(-34, -26, 68, 52);
            g.strokeStyle = '#f2c14e';
            g.lineWidth = 3;
            g.setLineDash([6, 4]);
            g.strokeRect(-34, -26, 68, 52);
            g.setLineDash([]);
            g.fillStyle = '#f2c14e';
            g.font = 'bold 11px monospace';
            g.textAlign = 'center';
            g.fillText(entry.kindKey.toUpperCase(), 0, 4);
          }
        });
      }
    } catch {
      ctx.fillStyle = '#2d3548';
      ctx.fillRect(16, 16, 64, 64);
    }

    const url = c.toDataURL();
    this.previewCache.set(key, url);
    return url;
  }
}

/**
 * Mount the Asset Encyclopedia as a dedicated full-screen page on `/map/assets`.
 * Clicking any asset's pick button syncs to open `/map` tabs via BroadcastChannel/localStorage
 * or opens `/map?pick=<id>` directly if visited standalone.
 */
export function startAssetCatalogPage(): void {
  document.title = 'Agent Party — 全素材图鉴百科';
  document.body.classList.add('ms-catalog-standalone-body');
  const worldCanvas = document.getElementById('world');
  if (worldCanvas) worldCanvas.style.display = 'none';
  const root = document.getElementById('ui') ?? document.body;
  root.className = 'ms-catalog-page-root';
  root.innerHTML = '';

  const toastEl = document.createElement('div');
  toastEl.className = 'ms-toast';
  toastEl.hidden = true;
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 3400);
  };

  let bc: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(ASSET_PICK_CHANNEL);
    }
  } catch {
    bc = null;
  }

  const view = new AssetCatalogView({
    onPick: (pick) => {
      const payload: BroadcastAssetPick = {
        id: pick.entry.id,
        ...(pick.variant ? { variant: pick.variant } : {}),
        ...(pick.rot ? { rot: pick.rot } : {}),
        ...(pick.flipX ? { flipX: true } : {}),
        ...(pick.flipY ? { flipY: true } : {}),
        ts: Date.now(),
      };
      bc?.postMessage(payload);
      try {
        localStorage.setItem(ASSET_PICK_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore quota errors
      }
      if (window.opener && !window.opener.closed) {
        toast(`✅ 已同步素材「${pick.entry.name}」到地图工坊标签页，切换回去即可直接放置！`);
        try {
          window.opener.focus();
        } catch {
          // ignore cross-window focus block
        }
      } else {
        const q = new URLSearchParams({ pick: pick.entry.id });
        if (pick.variant) q.set('variant', pick.variant);
        location.href = `/map?${q.toString()}`;
      }
    },
    onBackToCanvas: () => {
      if (window.opener && !window.opener.closed) {
        window.close();
      } else {
        location.href = '/map';
      }
    },
    onToast: toast,
  });

  view.show();
  root.append(view.el, toastEl);
}
