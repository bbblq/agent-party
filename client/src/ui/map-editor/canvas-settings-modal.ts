import type { FloorKind } from '../../art/api';
import {
  FLOOR_CATALOG,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  validateMapPlayability,
  type CustomMapDocument,
  type MapValidationReport,
} from '../../../../shared/map';

export type ResizeAnchor =
  | 'nw' | 'n' | 'ne'
  | 'w'  | 'c' | 'e'
  | 'sw' | 's' | 'se';

export interface CanvasSettingsActions {
  onApplyMeta: (name: string, author: string, bgFloor: FloorKind) => void;
  onResize: (width: number, height: number, anchor: ResizeAnchor) => void;
  onApplyTemplate: (template: 'starter' | 'blank' | 'room32' | 'server_live') => Promise<void> | void;
  onJumpToSpot: (tx: number, ty: number) => void;
}

export class CanvasSettingsModal {
  readonly el: HTMLElement;
  private doc: CustomMapDocument | null = null;
  private actions: CanvasSettingsActions | null = null;
  private anchor: ResizeAnchor = 'nw';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ms-modal-backdrop';
    this.el.hidden = true;
    this.el.addEventListener('click', (ev) => {
      if (ev.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(doc: CustomMapDocument, actions: CanvasSettingsActions): void {
    this.doc = doc;
    this.actions = actions;
    this.el.hidden = false;
    this.render();
  }

  close(): void {
    this.el.hidden = true;
  }

  private render(): void {
    const doc = this.doc;
    const actions = this.actions;
    if (!doc || !actions) return;

    const report: MapValidationReport = validateMapPlayability(doc);

    this.el.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'ms-modal ms-settings-modal';

    const header = document.createElement('div');
    header.className = 'ms-modal__header';
    header.innerHTML = `
      <div class="ms-modal__title">
        <span class="ms-px-icon">📐</span>
        <span>画布全局设置与可玩性体检</span>
      </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ms-btn ms-btn--ghost ms-btn--sm';
    closeBtn.textContent = '✕ 关闭';
    closeBtn.onclick = () => this.close();
    header.append(closeBtn);
    card.append(header);

    const body = document.createElement('div');
    body.className = 'ms-modal__body ms-settings-grid';

    // Left column: Canvas Meta & Resize
    const left = document.createElement('div');
    left.className = 'ms-settings-col';

    const metaBox = document.createElement('section');
    metaBox.className = 'ms-panel-box';
    metaBox.innerHTML = `<h4>地图基本属性</h4>`;

    const nameInput = document.createElement('input');
    nameInput.className = 'ms-input';
    nameInput.value = doc.name;
    nameInput.maxLength = 48;

    const authorInput = document.createElement('input');
    authorInput.className = 'ms-input';
    authorInput.value = doc.author ?? '';
    authorInput.placeholder = '可选：作者名称';
    authorInput.maxLength = 32;

    const bgSelect = document.createElement('select');
    bgSelect.className = 'ms-input';
    for (const fl of FLOOR_CATALOG) {
      const opt = document.createElement('option');
      opt.value = fl.id;
      opt.textContent = `${fl.name} (${fl.id})`;
      if (fl.id === doc.backgroundFloor) opt.selected = true;
      bgSelect.append(opt);
    }

    const applyMetaBtn = document.createElement('button');
    applyMetaBtn.type = 'button';
    applyMetaBtn.className = 'ms-btn ms-btn--primary ms-btn--sm';
    applyMetaBtn.textContent = '保存名称与背景设定';
    applyMetaBtn.onclick = () => {
      actions.onApplyMeta(
        nameInput.value.trim() || '未命名地图',
        authorInput.value.trim(),
        bgSelect.value as FloorKind,
      );
      this.close();
    };

    metaBox.append(
      this.fieldRow('地图名称', nameInput),
      this.fieldRow('作者署名', authorInput),
      this.fieldRow('默认外围地面', bgSelect),
      applyMetaBtn,
    );

    const sizeBox = document.createElement('section');
    sizeBox.className = 'ms-panel-box';
    sizeBox.innerHTML = `<h4>画布尺寸与扩缩容（${MIN_MAP_SIZE}~${MAX_MAP_SIZE} 格，当前 ${doc.width}×${doc.height}）</h4>`;

    const wInput = document.createElement('input');
    wInput.type = 'number';
    wInput.className = 'ms-input ms-input--num';
    wInput.min = String(MIN_MAP_SIZE);
    wInput.max = String(MAX_MAP_SIZE);
    wInput.value = String(doc.width);

    const hInput = document.createElement('input');
    hInput.type = 'number';
    hInput.className = 'ms-input ms-input--num';
    hInput.min = String(MIN_MAP_SIZE);
    hInput.max = String(MAX_MAP_SIZE);
    hInput.value = String(doc.height);

    const sizeRow = document.createElement('div');
    sizeRow.className = 'ms-inline-row';
    sizeRow.append(this.fieldRow('宽度 (格)', wInput), this.fieldRow('高度 (格)', hInput));

    const presets = document.createElement('div');
    presets.className = 'ms-preset-pills';
    for (const [label, pw, ph] of [
      ['32×24 小房间草稿', 32, 24],
      ['64×48 中型办公层', 64, 48],
      ['96×64 标准园区', 96, 64],
      ['160×96 大型园区', 160, 96],
      ['256×256 超大地图', 256, 256],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms-pill-btn';
      b.textContent = label;
      b.onclick = () => {
        wInput.value = String(pw);
        hInput.value = String(ph);
      };
      presets.append(b);
    }

    const anchorWrap = document.createElement('div');
    anchorWrap.className = 'ms-anchor-wrap';
    anchorWrap.innerHTML = `<span class="ms-field__label">已有内容对齐锚点</span>`;
    const anchorGrid = document.createElement('div');
    anchorGrid.className = 'ms-anchor-grid';
    const anchors: Array<[ResizeAnchor, string]> = [
      ['nw', '↖'], ['n', '↑'], ['ne', '↗'],
      ['w', '←'],  ['c', '•'], ['e', '→'],
      ['sw', '↙'], ['s', '↓'], ['se', '↘'],
    ];
    for (const [key, sym] of anchors) {
      const ab = document.createElement('button');
      ab.type = 'button';
      ab.className = `ms-anchor-btn ${this.anchor === key ? 'is-active' : ''}`;
      ab.textContent = sym;
      ab.title = `扩缩容时保留原有内容在「${key}」方向`;
      ab.onclick = () => {
        this.anchor = key;
        anchorGrid.querySelectorAll('.ms-anchor-btn').forEach((n) => n.classList.remove('is-active'));
        ab.classList.add('is-active');
      };
      anchorGrid.append(ab);
    }
    anchorWrap.append(anchorGrid);

    const resizeBtn = document.createElement('button');
    resizeBtn.type = 'button';
    resizeBtn.className = 'ms-btn ms-btn--primary ms-btn--sm';
    resizeBtn.textContent = '应用新画布尺寸（保留建筑）';
    resizeBtn.onclick = () => {
      const nw = Number(wInput.value);
      const nh = Number(hInput.value);
      actions.onResize(nw, nh, this.anchor);
      this.close();
    };

    sizeBox.append(sizeRow, presets, anchorWrap, resizeBtn);
    left.append(metaBox, sizeBox);

    // Right column: Templates & Playability Health Check
    const right = document.createElement('div');
    right.className = 'ms-settings-col';

    const tplBox = document.createElement('section');
    tplBox.className = 'ms-panel-box';
    tplBox.innerHTML = `<h4>快速重开 / 官方模板</h4><p class="ms-muted">替换当前标签页地图内容（支持 Ctrl+Z 一键撤销）</p>`;
    const tplBtns = document.createElement('div');
    tplBtns.className = 'ms-tpl-list';
    for (const [k, t] of [
      ['starter', '🏢 Agent Party 标准办公室 (96×64)'],
      ['room32', '🏠 空白小房间草稿 (32×24，方便画完贴入大图)'],
      ['blank', '🌿 空白可编辑草地画布'],
      ['server_live', '☁️ 从线上当前激活地图拉取拷贝 (按需单次)'],
    ] as const) {
      const tb = document.createElement('button');
      tb.type = 'button';
      tb.className = 'ms-btn ms-btn--sm';
      tb.textContent = t;
      tb.onclick = async () => {
        await actions.onApplyTemplate(k);
        this.close();
      };
      tplBtns.append(tb);
    }
    tplBox.append(tplBtns);

    const valBox = document.createElement('section');
    valBox.className = 'ms-panel-box';
    valBox.innerHTML = `
      <h4>可玩性与寻路体检 ${report.valid ? '<span class="ms-badge is-ok">✅ 通过</span>' : '<span class="ms-badge is-err">⚠️ 有阻断项</span>'}</h4>
      <div class="ms-stat-chips">
        <span>🪑 总工位 ${report.stats.desksTotal}</span>
        <span>⬆️北 ${report.stats.desksByDir.up} / ⬇️南 ${report.stats.desksByDir.down} / ⬅️西 ${report.stats.desksByDir.left} / ➡️东 ${report.stats.desksByDir.right}</span>
        <span>🐾 2D无背面宠物可用: <b>${report.stats.noBackViewSeats}</b></span>
        <span>☕ 休闲位 ${report.stats.leisureSpots}</span>
        <span>🚪 出生/电梯 ${report.stats.spawns + report.stats.elevators}</span>
        <span>⚔️ 决斗场 ${report.stats.hasArena ? '已配置' : '未配置'}</span>
      </div>
    `;
    const list = document.createElement('div');
    list.className = 'ms-val-list';
    for (const e of report.errors) {
      const d = document.createElement('div');
      d.className = 'ms-val-item is-err';
      d.textContent = `❌ ${e}`;
      list.append(d);
    }
    for (const w of report.warnings) {
      const d = document.createElement('div');
      d.className = 'ms-val-item is-warn';
      d.textContent = `⚠️ ${w}`;
      list.append(d);
    }
    for (const u of report.stats.unreachableSpots.slice(0, 12)) {
      const row = document.createElement('div');
      row.className = 'ms-val-item is-err';
      row.innerHTML = `<span>🚫 不可达互动点 ${u.kind} (${u.tx},${u.ty})</span>`;
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'ms-btn ms-btn--xs';
      jump.textContent = '定位';
      jump.onclick = () => {
        actions.onJumpToSpot(u.tx, u.ty);
        this.close();
      };
      row.append(jump);
      list.append(row);
    }
    if (!report.errors.length && !report.warnings.length && !report.stats.unreachableSpots.length) {
      const ok = document.createElement('div');
      ok.className = 'ms-val-item is-ok';
      ok.textContent = '✨ 全图所有工位、茶水休闲点与出生路径 100% 连通！';
      list.append(ok);
    }
    valBox.append(list);

    right.append(tplBox, valBox);
    body.append(left, right);
    card.append(body);
    this.el.append(card);
  }

  private fieldRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('label');
    row.className = 'ms-field';
    const span = document.createElement('span');
    span.className = 'ms-field__label';
    span.textContent = label;
    row.append(span, control);
    return row;
  }
}
