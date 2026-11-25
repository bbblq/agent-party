import { FURNITURE, TILE, type Dir, type FloorKind, type FurnitureKind } from '../../art/api';
import { getSessionAdminKey } from '../../net/store';
import type { WorldApi } from '../../world/api';
import { CORE_WALLS } from '../../world/layout/core';
import type { AreaKind, TileRect } from '../../world/layout/types';
import {
  FloorGridBuffer,
  MAX_MAP_ITEMS,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  buildCustomRoomWalls,
  createStarterOfficeMap,
  parseCustomMapJson,
  resizeCustomMap,
  serializeCustomMapJson,
  validateMapPlayability,
  type CustomMapDocument,
  type MapSelection,
  type StudioMcpPresence,
  type StudioTaskSummary,
} from '../../../../shared/map';
import type { UiContext } from '../context';
import { h } from '../dom';
import './map-editor.css';

type EditorTool = 'pan' | 'box' | 'floor' | 'room' | 'wall' | 'desk4' | 'furn' | 'zone' | 'erase';

interface DraftBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
}

const SESSION_STORAGE_KEY = 'agent_party_studio_session_v1';

const FLOORS: Array<{ kind: FloorKind; label: string }> = [
  { kind: 'carpet', label: '办公地毯' },
  { kind: 'wood', label: '木地板' },
  { kind: 'marble', label: '大理石' },
  { kind: 'concrete', label: '水泥地' },
  { kind: 'tile_check', label: '棋盘砖' },
  { kind: 'tile_white', label: '白瓷砖' },
  { kind: 'sidewalk', label: '人行道' },
  { kind: 'street', label: '柏油路' },
  { kind: 'grass', label: '户外草地' },
];

const FURNITURE_PALETTE: Array<{ kind: FurnitureKind; label: string; isWall?: boolean; on?: 'face' | 'south' }> = [
  { kind: 'entrance_mat', label: '🚪 入口地垫(出生点)' },
  { kind: 'plant_tall', label: '🪴 高盆栽' },
  { kind: 'meeting_table', label: '🪑 会议桌' },
  { kind: 'sofa', label: '🛋️ 沙发' },
  { kind: 'armchair', label: '💺 单人扶手椅' },
  { kind: 'beanbag', label: '🟣 懒人沙发' },
  { kind: 'coffee_machine', label: '☕ 咖啡机' },
  { kind: 'water_cooler', label: '💧 饮水机' },
  { kind: 'fridge', label: '🧊 冰箱' },
  { kind: 'vending_machine', label: '🥤 自动售货机' },
  { kind: 'cafe_table', label: '🍽️ 餐桌' },
  { kind: 'cafe_chair', label: '🪑 餐椅' },
  { kind: 'arcade', label: '🕹️ 街机' },
  { kind: 'pingpong_table', label: '🏓 乒乓球桌' },
  { kind: 'toilet_stall', label: '🚻 隔间' },
  { kind: 'sink', label: '🚰 洗手池' },
  { kind: 'reception_desk', label: '🛎️ 前台桌' },
  { kind: 'whiteboard', label: '📋 白板(挂墙)', isWall: true, on: 'face' },
  { kind: 'tv', label: '📺 电视(挂墙)', isWall: true, on: 'face' },
  { kind: 'window', label: '🪟 窗户(挂墙)', isWall: true, on: 'face' },
];

const ZONES: Array<{ kind: AreaKind; label: string }> = [
  { kind: 'room', label: '办公区' },
  { kind: 'lounge', label: '休息区' },
  { kind: 'cafe', label: '茶水区' },
  { kind: 'restroom', label: '洗手间' },
  { kind: 'reception', label: '前台大厅' },
  { kind: 'arena', label: '宝可梦竞技场' },
];

const DIR_LABELS: Record<Dir, string> = {
  up: '↑ 面朝北(上)',
  right: '→ 面朝东(右)',
  down: '↓ 面朝南(下)',
  left: '← 面朝西(左)',
};

const DIR_ORDER: Dir[] = ['up', 'right', 'down', 'left'];

function cloneDoc(doc: CustomMapDocument): CustomMapDocument {
  return JSON.parse(JSON.stringify(doc)) as CustomMapDocument;
}

export class MapEditor {
  readonly el: HTMLElement;
  readonly reviewFloatEl: HTMLElement;
  private isOpen = false;
  private doc: CustomMapDocument | null = null;
  private sessionId = '';
  private studioToken = '';
  private sessionRev = 0;
  private sse: EventSource | null = null;
  private tool: EditorTool = 'box';
  private floorKind: FloorKind = 'carpet';
  private wallMode: 'face' | 'cap' | 'door' = 'face';
  private deskDir: Dir = 'up';
  private furnKind: FurnitureKind = 'entrance_mat';
  private zoneKind: AreaKind = 'room';
  private showWalkGrid = false;
  private selection: MapSelection | null = null;
  private draftBoxes: DraftBox[] = [];
  private draftBoxSeq = 0;
  private tasks: StudioTaskSummary[] = [];
  private presence: StudioMcpPresence = { connected: false, listening: false, lastSeenAt: 0, activeTaskId: null };
  private pairingOpen = true;
  private userToggledPairing = false;
  private endpointOrigin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:4747';
  private endpointCandidates: string[] = [];

  private dragStart: { tx: number; ty: number } | null = null;
  private hoverTile: { tx: number; ty: number } | null = null;
  private toolBtns = new Map<EditorTool, HTMLButtonElement>();
  private subOptionsEl: HTMLElement;
  private statusEl: HTMLElement;
  private statsEl: HTMLElement;
  private nameInput: HTMLInputElement;
  private widthInput: HTMLInputElement;
  private heightInput: HTMLInputElement;
  private overallInstructionInput: HTMLTextAreaElement;
  private boxCountEl: HTMLElement;
  private draftBoxesEl: HTMLElement;
  private sendAiBtn: HTMLButtonElement;
  private presenceCardEl: HTMLElement;
  private presenceTextEl: HTMLElement;
  private presenceSubEl: HTMLElement;
  private pairingDrawerEl: HTMLElement;
  private endpointChipsEl: HTMLElement;
  private endpointUrlEl: HTMLElement;
  private mcpJsonPreEl: HTMLElement;
  private tokenBadgeEl: HTMLElement;
  private autopilotBtn: HTMLButtonElement;
  private tasksListEl: HTMLElement;
  private publishAdminBtn: HTMLButtonElement;
  private walkToggleBtn: HTMLButtonElement;
  private offAfterFrame: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private presencePollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: UiContext,
    private readonly world: WorldApi,
  ) {
    this.statusEl = h('div', { class: 'map-studio__status', text: '准备就绪' });
    this.statsEl = h('div', { class: 'map-studio__badge', text: '尚未加载地图' });
    this.boxCountEl = h('span', { class: 'map-studio__badge', text: '已选 0 个区块' });
    this.presenceTextEl = h('span', { text: 'MCP 未连接' });
    this.presenceSubEl = h('div', { class: 'map-studio__badge', text: '专属会话隔离，不会串给其他人 AI' });
    this.tokenBadgeEl = h('div', { class: 'map-studio__badge', text: '等待生成专属令牌…' });
    this.endpointChipsEl = h('div', { class: 'map-studio__chips' });
    this.endpointUrlEl = h('div', { class: 'map-studio__badge', text: '专属 MCP 接口：生成中…', style: 'word-break:break-all;user-select:text;' });
    this.mcpJsonPreEl = h('pre', { class: 'map-studio__code' });

    const pairingToggleBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '🔌 接口配置',
      on: {
        click: () => {
          this.userToggledPairing = true;
          this.pairingOpen = !this.pairingOpen;
          this.pairingDrawerEl.hidden = !this.pairingOpen;
        },
      },
    });

    this.presenceCardEl = h(
      'div',
      { class: 'map-studio__presence' },
      h('div', { class: 'map-studio__presence-label' }, h('span', { class: 'map-studio__dot' }), this.presenceTextEl),
      pairingToggleBtn,
    );

    const copyUrlBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '复制接口 URL',
      on: { click: () => void this.copyEndpointUrl() },
    });

    const copyMcpBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '📋 复制 MCP JSON',
      on: { click: () => void this.copyMcpConfig() },
    });

    const rotateTokenBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '🔄 重置令牌',
      on: { click: () => void this.rotateToken() },
    });

    this.autopilotBtn = h('button', {
      class: 'map-studio__btn map-studio__btn--primary',
      type: 'button',
      text: '🤖 复制发给 AI 的完整接入指令（含 IP / 接口 / 自动配 MCP）',
      on: { click: () => void this.copyAutopilotPrompt() },
    }) as HTMLButtonElement;

    this.pairingDrawerEl = h(
      'div',
      { class: 'map-studio__section', hidden: false, style: 'background: rgba(11, 17, 30, 0.92);' },
      this.tokenBadgeEl,
      h('div', { class: 'map-studio__section-title', text: '服务端访问地址（跨机/Docker 请选局域网 IP）' }),
      this.endpointChipsEl,
      this.endpointUrlEl,
      h('div', { class: 'map-studio__section-title', text: 'MCP 客户端 JSON 配置（支持 HTTP URL 或 Node 脚本）' }),
      this.mcpJsonPreEl,
      this.autopilotBtn,
      h('div', { class: 'map-studio__row' }, copyMcpBtn, copyUrlBtn, rotateTokenBtn),
    );

    this.draftBoxesEl = h('div', { class: 'map-studio__boxes' });
    this.tasksListEl = h('div', { class: 'map-studio__tasks' });
    this.reviewFloatEl = h('div', { class: 'map-studio__review-float', hidden: true });

    this.nameInput = h('input', {
      class: 'map-studio__input',
      attrs: { type: 'text', placeholder: '地图名称' },
      on: {
        change: () => {
          if (!this.doc) return;
          this.doc.name = this.nameInput.value.trim() || '自定义地图';
          this.commitLocalEdit();
        },
      },
    }) as HTMLInputElement;

    this.widthInput = h('input', {
      class: 'map-studio__input',
      attrs: { type: 'number', min: String(MIN_MAP_SIZE), max: String(MAX_MAP_SIZE) },
    }) as HTMLInputElement;
    this.heightInput = h('input', {
      class: 'map-studio__input',
      attrs: { type: 'number', min: String(MIN_MAP_SIZE), max: String(MAX_MAP_SIZE) },
    }) as HTMLInputElement;

    const resizeBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '调整尺寸',
      on: { click: () => this.applyResize() },
    });

    const quickSizes = h(
      'div',
      { class: 'map-studio__chips' },
      ...[
        [64, 48],
        [96, 64],
        [128, 128],
        [256, 256],
        [512, 512],
      ].map(([w, ht]) =>
        h('button', {
          class: 'map-studio__chip',
          type: 'button',
          text: `${w}×${ht}`,
          on: {
            click: () => {
              this.widthInput.value = String(w);
              this.heightInput.value = String(ht);
              this.applyResize();
            },
          },
        }),
      ),
    );

    const toolsGrid = h('div', { class: 'map-studio__tools' });
    const toolDefs: Array<[EditorTool, string]> = [
      ['box', '📐 框选 AI (B)'],
      ['pan', '🖐️ 移动视角 (V)'],
      ['desk4', '💻 四向工位 (S)'],
      ['room', '🏠 建房间 (M)'],
      ['floor', '🧱 刷地面 (F)'],
      ['wall', '🧱 墙体/门 (W)'],
      ['furn', '🪑 家具/挂件 (P)'],
      ['zone', '🏷️ 功能区 (Z)'],
      ['erase', '🧹 橡皮擦 (E)'],
    ];
    for (const [id, label] of toolDefs) {
      const btn = h('button', {
        class: 'map-studio__tool-btn',
        type: 'button',
        text: label,
        on: { click: () => this.setTool(id) },
      }) as HTMLButtonElement;
      this.toolBtns.set(id, btn);
      toolsGrid.append(btn);
    }

    this.subOptionsEl = h('div', { class: 'map-studio__section' });

    this.overallInstructionInput = h('textarea', {
      class: 'map-studio__textarea',
      attrs: { placeholder: '补充整体修改要求（可选，如：统一风格、补齐走廊通道、各区域加植物）…' },
    }) as HTMLTextAreaElement;

    this.sendAiBtn = h('button', {
      class: 'map-studio__btn map-studio__btn--primary',
      type: 'button',
      text: '🚀 直接发送给 AI 修改 (0 个区块)',
      on: { click: () => void this.submitDraftBoxesToAi() },
    }) as HTMLButtonElement;

    const clearSelBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '清空选框',
      on: {
        click: () => {
          this.draftBoxes = [];
          this.selection = null;
          this.renderDraftBoxes();
          this.scheduleSelectionSync(true);
        },
      },
    });

    this.walkToggleBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '🚦 通行网格: 关',
      on: {
        click: () => {
          this.showWalkGrid = !this.showWalkGrid;
          this.walkToggleBtn.textContent = this.showWalkGrid ? '🚦 通行网格: 开' : '🚦 通行网格: 关';
        },
      },
    }) as HTMLButtonElement;

    const fileInput = h('input', {
      attrs: { type: 'file', accept: '.json,application/json', hidden: 'true' },
      on: {
        change: () => {
          const file = (fileInput as HTMLInputElement).files?.[0];
          if (file) void this.importJsonFile(file);
          (fileInput as HTMLInputElement).value = '';
        },
      },
    });

    const importBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '📂 导入 JSON',
      on: { click: () => (fileInput as HTMLInputElement).click() },
    });

    const downloadBtn = h('button', {
      class: 'map-studio__btn map-studio__btn--ok',
      type: 'button',
      text: '⬇️ 下载 JSON(发管理员)',
      on: { click: () => this.downloadJson() },
    });

    this.publishAdminBtn = h('button', {
      class: 'map-studio__btn map-studio__btn--primary',
      type: 'button',
      text: '🚀 管理员立即全员启用',
      hidden: true,
      on: { click: () => void this.publishAsAdmin() },
    }) as HTMLButtonElement;

    const undoBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '↩️ 撤销',
      on: { click: () => void this.remoteUndoRedo('undo') },
    });
    const redoBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '↪️ 重做',
      on: { click: () => void this.remoteUndoRedo('redo') },
    });
    const closeBtn = h('button', {
      class: 'map-studio__btn',
      type: 'button',
      text: '✕ 关闭',
      on: { click: () => this.close() },
    });

    this.el = h(
      'aside',
      { class: 'map-studio', hidden: true, role: 'region', attrs: { 'aria-label': '地图工坊' } },
      h(
        'div',
        { class: 'map-studio__head' },
        h('span', { class: 'map-studio__title', text: '🗺️ 地图工坊（最大 512×512）' }),
        h('div', { class: 'map-studio__row' }, undoBtn, redoBtn, closeBtn),
      ),
      h(
        'div',
        { class: 'map-studio__scroll' },
        h(
          'div',
          { class: 'map-studio__section' },
          this.presenceCardEl,
          this.presenceSubEl,
          this.pairingDrawerEl,
        ),
        h(
          'div',
          { class: 'map-studio__section' },
          h('div', { class: 'map-studio__section-title' }, h('span', { text: '📐 多框选协同 → 按键直发 AI' }), this.boxCountEl),
          this.draftBoxesEl,
          this.overallInstructionInput,
          h('div', { class: 'map-studio__row' }, this.sendAiBtn, clearSelBtn),
        ),
        h(
          'div',
          { class: 'map-studio__section' },
          h('div', { class: 'map-studio__section-title', text: '📋 AI 修改队列与确认审核' }),
          this.tasksListEl,
        ),
        h(
          'div',
          { class: 'map-studio__section' },
          h('div', { class: 'map-studio__section-title' }, h('span', { text: '绘图工具' }), this.walkToggleBtn),
          toolsGrid,
        ),
        this.subOptionsEl,
        h(
          'div',
          { class: 'map-studio__section' },
          h('div', { class: 'map-studio__section-title', text: '画布参数与尺寸（16 ~ 512 格）' }),
          this.nameInput,
          h(
            'div',
            { class: 'map-studio__row' },
            this.widthInput,
            h('span', { text: '×' }),
            this.heightInput,
            resizeBtn,
          ),
          quickSizes,
          this.statsEl,
        ),
      ),
      h(
        'div',
        { class: 'map-studio__foot' },
        this.statusEl,
        h('div', { class: 'map-studio__row', style: 'width:100%' }, fileInput, importBtn, downloadBtn, this.publishAdminBtn),
      ),
    );

    this.setTool('box');
    this.renderDraftBoxes();
    this.renderTasks();
    this.renderPresence();

    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (k === 'r' && this.tool === 'desk4') {
        e.preventDefault();
        const nextIdx = (DIR_ORDER.indexOf(this.deskDir) + 1) % DIR_ORDER.length;
        this.deskDir = DIR_ORDER[nextIdx];
        this.renderSubOptions();
      } else if (k === 'v') this.setTool('pan');
      else if (k === 'b') this.setTool('box');
      else if (k === 's') this.setTool('desk4');
      else if (k === 'm') this.setTool('room');
      else if (k === 'f') this.setTool('floor');
      else if (k === 'w') this.setTool('wall');
      else if (k === 'p') this.setTool('furn');
      else if (k === 'z') this.setTool('zone');
      else if (k === 'e') this.setTool('erase');
    });
  }

  get opened(): boolean {
    return this.isOpen;
  }

  async toggle(open?: boolean): Promise<void> {
    const next = open ?? !this.isOpen;
    if (next === this.isOpen) return;
    if (next) await this.open();
    else this.close();
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.hidden = false;
    this.publishAdminBtn.hidden = !getSessionAdminKey();
    this.setStatus('正在恢复或创建专属工坊会话…');

    const editor = this.world.editor;
    if (editor) {
      editor.setPointerIntercept((ev, kind, tile) => this.handleCanvasPointer(ev, kind, tile));
      this.offAfterFrame = editor.onAfterFrame((ctx, view) => this.drawCanvasOverlay(ctx, view));
    }

    await this.ensureSession();
    this.renderReviewFloat();
    if (!this.presencePollTimer) {
      this.presencePollTimer = setInterval(() => void this.refreshSessionMeta(), 12_000);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.reviewFloatEl.hidden = true;
    this.dragStart = null;
    this.hoverTile = null;
    if (this.presencePollTimer) {
      clearInterval(this.presencePollTimer);
      this.presencePollTimer = null;
    }
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    if (this.offAfterFrame) {
      this.offAfterFrame();
      this.offAfterFrame = null;
    }
    this.world.editor?.setPointerIntercept(null);
    this.world.editor?.setCustomMapPreview(null, { lockLiveSync: false });
  }

  private loadSavedToken(): string {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return '';
      const parsed = JSON.parse(raw) as { studioToken?: string };
      return typeof parsed.studioToken === 'string' && parsed.studioToken.startsWith('ws_') ? parsed.studioToken : '';
    } catch {
      return '';
    }
  }

  private saveSessionCredentials(): void {
    try {
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ sessionId: this.sessionId, studioToken: this.studioToken }),
      );
    } catch {
      // ignore storage quota errors
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId && this.studioToken) {
      this.connectSse();
      if (this.doc) this.applyPreview(this.doc);
      return;
    }
    try {
      const initial = this.world.editor?.getCustomMap() ?? createStarterOfficeMap();
      const resumeToken = this.loadSavedToken();
      const res = await fetch('/api/map/studio/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: initial, ...(resumeToken ? { resumeToken } : {}) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        sessionId: string;
        studioToken: string;
        rev: number;
        doc: CustomMapDocument;
        selection: MapSelection | null;
        tasks?: StudioTaskSummary[];
        presence?: StudioMcpPresence;
        endpoints?: { baseUrl?: string; lanUrl?: string | null };
      };
      this.sessionId = data.sessionId;
      this.studioToken = data.studioToken;
      this.sessionRev = data.rev;
      this.selection = data.selection;
      this.tasks = data.tasks ?? [];
      if (data.presence) this.presence = data.presence;
      this.setEndpoints(data.endpoints);
      this.saveSessionCredentials();
      this.applyDocState(data.doc);
      this.renderPresence();
      this.renderTasks();
      this.connectSse();
      this.setStatus('工坊就绪：请先复制上方接入指令发给 AI，连上即可网页一键派单');
    } catch {
      const fallback = this.world.editor?.getCustomMap() ?? createStarterOfficeMap();
      this.applyDocState(fallback);
      this.setStatus('离线本地编辑模式（可导出 JSON 发给管理员）');
    }
  }

  private async refreshSessionMeta(): Promise<void> {
    if (!this.isOpen || !this.sessionId || !this.studioToken) return;
    try {
      const res = await fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}?token=${encodeURIComponent(this.studioToken)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        rev: number;
        doc?: CustomMapDocument;
        tasks?: StudioTaskSummary[];
        presence?: StudioMcpPresence;
      };
      if (data.presence) {
        this.presence = data.presence;
        this.renderPresence();
      }
      if (data.tasks) {
        this.tasks = data.tasks;
        this.renderTasks();
        this.renderReviewFloat();
      }
      if (data.rev > this.sessionRev && data.doc) {
        this.sessionRev = data.rev;
        this.applyDocState(data.doc);
      }
    } catch {
      // ignore poll errors
    }
  }

  private connectSse(): void {
    if (!this.sessionId || !this.studioToken || typeof EventSource === 'undefined') return;
    this.sse?.close();
    const url = `/api/map/studio/${encodeURIComponent(this.sessionId)}/events?token=${encodeURIComponent(this.studioToken)}`;
    const es = new EventSource(url);
    this.sse = es;
    const onState = (ev: Event) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          rev: number;
          doc?: CustomMapDocument;
          patchRect?: TileRect;
          selection?: MapSelection | null;
          tasks?: StudioTaskSummary[];
          presence?: StudioMcpPresence;
          note?: string;
        };
        if (data.rev > this.sessionRev && data.doc) {
          this.sessionRev = data.rev;
          this.applyDocState(data.doc, data.patchRect);
          this.setStatus(`⚡ 地图已更新 #${data.rev}${data.note ? ` (${data.note})` : ''}`);
        }
        if (data.selection !== undefined) {
          this.selection = data.selection;
        }
        if (data.tasks) {
          this.tasks = data.tasks;
          this.renderTasks();
          this.renderReviewFloat();
        }
        if (data.presence) {
          this.presence = data.presence;
          this.renderPresence();
        }
      } catch {
        // ignore invalid event
      }
    };
    es.addEventListener('state', onState);
    es.addEventListener('draft', onState);
    es.addEventListener('selection', onState);
    es.addEventListener('tasks', onState);
    es.addEventListener('presence', onState);
  }

  private applyDocState(doc: CustomMapDocument, patchRect?: TileRect): void {
    this.doc = cloneDoc(doc);
    this.nameInput.value = doc.name;
    this.widthInput.value = String(doc.width);
    this.heightInput.value = String(doc.height);
    this.applyPreview(this.doc, patchRect);
    this.refreshStats();
  }

  private applyPreview(doc: CustomMapDocument, patchRect?: TileRect): void {
    const editor = this.world.editor;
    if (!editor) return;
    editor.setCustomMapPreview(doc, { lockLiveSync: true });
    if (patchRect) editor.invalidateRect(patchRect);
  }

  private refreshStats(): void {
    if (!this.doc) return;
    const report = validateMapPlayability(this.doc);
    const d = report.stats.desksByDir;
    const warnTxt = report.warnings.length ? ` | ⚠️ ${report.warnings.length} 警告` : ' | ✅ 可达性良好';
    this.statsEl.textContent = `${this.doc.width}×${this.doc.height} | 工位 ${report.stats.desksTotal} (↑${d.up} →${d.right} ↓${d.down} ←${d.left}) | 区域 ${report.stats.zones}${warnTxt}`;
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
  }

  private setEndpoints(ep?: { baseUrl?: string; lanUrl?: string | null }): void {
    const raw = [
      typeof location !== 'undefined' ? location.origin : '',
      ep?.baseUrl ?? '',
      ep?.lanUrl ?? '',
    ].filter((u): u is string => !!u && /^https?:\/\//.test(u));
    const uniq: string[] = [];
    for (const u of raw) {
      const clean = u.replace(/\/+$/, '');
      if (!uniq.includes(clean)) uniq.push(clean);
    }
    this.endpointCandidates = uniq.length ? uniq : [this.endpointOrigin];
    if (!this.endpointCandidates.includes(this.endpointOrigin)) {
      this.endpointOrigin = this.endpointCandidates[0];
    }
  }

  private dedicatedMcpUrl(): string {
    const origin = this.endpointOrigin.replace(/\/+$/, '');
    return this.studioToken ? `${origin}/api/mcp/${this.studioToken}` : `${origin}/api/mcp`;
  }

  private buildMcpConfigObject() {
    const url = this.dedicatedMcpUrl();
    return {
      mcpServers: {
        'agent-party-map': {
          url,
          command: 'node',
          args: ['<主目录>/.agent-party/map-mcp.mjs', '--url', url],
        },
      },
    };
  }

  private renderPairingInfo(): void {
    const shortSid = this.sessionId ? this.sessionId.slice(-6) : '------';
    const shortTok = this.studioToken ? `${this.studioToken.slice(0, 8)}…${this.studioToken.slice(-4)}` : '未生成';
    this.tokenBadgeEl.textContent = `隔离会话 #${shortSid} | 专属令牌 ${shortTok}（独立 URL 严格隔离，不会串给他人）`;

    this.endpointChipsEl.innerHTML = '';
    const list = this.endpointCandidates.length ? this.endpointCandidates : [this.endpointOrigin];
    for (const origin of list) {
      const isLan = !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(origin);
      const label = isLan ? `🌐 局域网 ${origin.replace(/^https?:\/\//, '')}` : `💻 本机 ${origin.replace(/^https?:\/\//, '')}`;
      this.endpointChipsEl.append(
        h('button', {
          class: `map-studio__chip${origin === this.endpointOrigin ? ' is-active' : ''}`,
          type: 'button',
          text: label,
          on: {
            click: () => {
              this.endpointOrigin = origin;
              this.renderPairingInfo();
            },
          },
        }),
      );
    }

    const mcpUrl = this.dedicatedMcpUrl();
    this.endpointUrlEl.textContent = `专属 MCP 接口：${mcpUrl}`;
    this.mcpJsonPreEl.textContent = JSON.stringify(this.buildMcpConfigObject(), null, 2);
  }

  private renderPresence(): void {
    const p = this.presence;
    const runningTask = this.tasks.find((t) => t.status === 'running');
    this.presenceCardEl.classList.toggle('is-connected', p.connected && !p.listening);
    this.presenceCardEl.classList.toggle('is-listening', p.listening);

    const shortSid = this.sessionId ? this.sessionId.slice(-6) : '------';
    if (!this.userToggledPairing) {
      this.pairingOpen = !p.listening;
      this.pairingDrawerEl.hidden = !this.pairingOpen;
    }
    this.renderPairingInfo();

    if (runningTask) {
      this.presenceTextEl.textContent = `AI 正在执行 #T${runningTask.seq}…`;
      this.presenceSubEl.textContent = `正在修改并实时渲染到地图上 (${p.clientName || 'MCP'}) · 可继续框选后续任务加入队列`;
    } else if (p.listening) {
      this.presenceTextEl.textContent = 'MCP 已连接 · AI 自动接单待命中';
      this.presenceSubEl.textContent = `已连接到 ${p.clientName || 'MCP 客户端'}（隔离会话 #${shortSid}），框选后点发送即刻开工`;
    } else if (p.connected) {
      this.presenceTextEl.textContent = `MCP 已连接 (${p.clientName || 'AI 客户端'})`;
      this.presenceSubEl.textContent = '已连上后台！请复制下方接入指令发给 AI 让它开启自动接单待命';
    } else {
      this.presenceTextEl.textContent = 'MCP 未连接';
      this.presenceSubEl.textContent = `请复制下方「完整接入指令」直接发给你的 AI（或手动填入下方 IP 与 MCP 接口地址）`;
    }
    this.renderSendButton();
  }

  private renderSendButton(): void {
    const running = this.tasks.some((t) => t.status === 'running');
    const n = this.draftBoxes.length;
    this.sendAiBtn.disabled = n === 0;
    this.sendAiBtn.textContent = running
      ? `➕ 加入 AI 修改队列 (${n} 个区块)`
      : `🚀 直接发送给 AI 修改 (${n} 个区块)`;
  }

  private renderDraftBoxes(): void {
    this.boxCountEl.textContent = `已选 ${this.draftBoxes.length} 个区块`;
    this.draftBoxesEl.innerHTML = '';
    if (!this.draftBoxes.length) {
      this.draftBoxesEl.append(
        h('div', {
          class: 'map-studio__badge',
          text: '使用「📐 框选 AI (B)」在画布拖拽，可连续框选 1 个或多个区块，填好需求后一键发送！',
        }),
      );
      this.renderSendButton();
      return;
    }

    for (let i = 0; i < this.draftBoxes.length; i++) {
      const box = this.draftBoxes[i];
      const idxLabel = `区块 #${i + 1}`;
      box.label = idxLabel;
      const focusBtn = h('button', {
        class: 'map-studio__btn',
        type: 'button',
        text: '🎯',
        attrs: { title: '定位到该区块' },
        on: { click: () => this.panToRect(box) },
      });
      const delBtn = h('button', {
        class: 'map-studio__btn',
        type: 'button',
        text: '✕',
        attrs: { title: '移除此选框' },
        on: {
          click: () => {
            this.draftBoxes = this.draftBoxes.filter((b) => b.id !== box.id);
            this.renderDraftBoxes();
          },
        },
      });
      const noteInp = h('input', {
        class: 'map-studio__input',
        attrs: {
          type: 'text',
          value: box.note,
          placeholder: `写下 ${idxLabel} 的修改需求（例如：改成面向东西双排工位 / 放茶水吧）`,
        },
        on: {
          input: () => {
            box.note = (noteInp as HTMLInputElement).value;
            if (i === this.draftBoxes.length - 1 && this.selection) {
              this.selection = { ...this.selection, note: box.note, updatedAt: Date.now() };
              this.scheduleSelectionSync();
            }
          },
        },
      });

      this.draftBoxesEl.append(
        h(
          'div',
          { class: 'map-studio__box-item' },
          h(
            'div',
            { class: 'map-studio__box-head' },
            h('span', { text: `${idxLabel} · (${box.x}, ${box.y}) ${box.w}×${box.h} 格` }),
            h('div', { class: 'map-studio__row' }, focusBtn, delBtn),
          ),
          noteInp,
        ),
      );
    }
    this.renderSendButton();
  }

  private renderTasks(): void {
    this.tasksListEl.innerHTML = '';
    const visible = [...this.tasks].reverse().slice(0, 8);
    if (!visible.length) {
      this.tasksListEl.append(h('div', { class: 'map-studio__badge', text: '暂无 AI 修改任务；支持同时发送多区块，或边改边继续框选排队' }));
      return;
    }

    for (const task of visible) {
      const cls =
        task.status === 'running'
          ? 'map-studio__task-card is-running'
          : task.status === 'review'
            ? 'map-studio__task-card is-review'
            : 'map-studio__task-card';
      const statusText =
        task.status === 'queued' ? '⏳ 排队中' :
        task.status === 'running' ? '⚡ AI 正在修改' :
        task.status === 'review' ? '👀 待你确认' :
        task.status === 'accepted' ? '✅ 已确认保留' :
        task.status === 'reverted' ? '↩️ 已恢复原样' : '🚫 已取消';

      const card = h(
        'div',
        { class: cls },
        h(
          'div',
          { class: 'map-studio__box-head' },
          h('span', { text: `#T${task.seq} ${statusText} · ${task.boxes.length} 区块` }),
          h('button', {
            class: 'map-studio__btn',
            type: 'button',
            text: '🎯',
            attrs: { title: '聚焦该任务区域' },
            on: {
              click: () => {
                if (task.boxes[0]) this.panToRect(task.boxes[0]);
              },
            },
          }),
        ),
      );

      const desc = task.aiSummary || task.instruction || task.boxes.map((b) => b.note || b.label).join('；');
      if (desc) {
        card.append(h('div', { class: 'map-studio__badge', text: desc }));
      }

      if (task.status === 'review') {
        const acceptBtn = h('button', {
          class: 'map-studio__btn map-studio__btn--ok',
          type: 'button',
          text: '✅ 确认修改',
          on: { click: () => void this.resolveTask(task.id, 'accept') },
        });
        const revertBtn = h('button', {
          class: 'map-studio__btn map-studio__btn--danger',
          type: 'button',
          text: '↩️ 恢复原样',
          on: { click: () => void this.resolveTask(task.id, 'revert') },
        });
        card.append(h('div', { class: 'map-studio__row' }, acceptBtn, revertBtn));
      } else if (task.status === 'queued') {
        const cancelBtn = h('button', {
          class: 'map-studio__btn',
          type: 'button',
          text: '取消排队',
          on: { click: () => void this.resolveTask(task.id, 'cancel') },
        });
        card.append(h('div', { class: 'map-studio__row' }, cancelBtn));
      }

      this.tasksListEl.append(card);
    }
    this.renderPresence();
  }

  private renderReviewFloat(): void {
    if (!this.isOpen) {
      this.reviewFloatEl.hidden = true;
      return;
    }
    const reviewTask = this.tasks.find((t) => t.status === 'review');
    const runningTask = this.tasks.find((t) => t.status === 'running');
    const queuedCount = this.tasks.filter((t) => t.status === 'queued').length;

    if (!reviewTask && !runningTask) {
      this.reviewFloatEl.hidden = true;
      return;
    }

    this.reviewFloatEl.innerHTML = '';
    this.reviewFloatEl.hidden = false;

    if (reviewTask) {
      this.reviewFloatEl.append(
        h('span', {
          text: `👀 #T${reviewTask.seq} AI 已改好并呈现在地图上${reviewTask.aiSummary ? `：${reviewTask.aiSummary}` : ''}${queuedCount ? `（另有 ${queuedCount} 个排队中）` : ''}`,
        }),
        h('button', {
          class: 'map-studio__btn',
          type: 'button',
          text: '🎯 定位',
          on: {
            click: () => {
              if (reviewTask.boxes[0]) this.panToRect(reviewTask.boxes[0]);
            },
          },
        }),
        h('button', {
          class: 'map-studio__btn map-studio__btn--ok',
          type: 'button',
          text: '✅ 确认修改',
          on: { click: () => void this.resolveTask(reviewTask.id, 'accept') },
        }),
        h('button', {
          class: 'map-studio__btn map-studio__btn--danger',
          type: 'button',
          text: '↩️ 恢复原样',
          on: { click: () => void this.resolveTask(reviewTask.id, 'revert') },
        }),
      );
    } else if (runningTask) {
      this.reviewFloatEl.append(
        h('span', {
          text: `⚡ AI 正在执行 #T${runningTask.seq} (${runningTask.boxes.length} 个区块)${queuedCount ? ` · 队列还有 ${queuedCount} 个` : ''}… 可继续框选其它区域`,
        }),
      );
    }
  }

  private panToRect(rect: { x: number; y: number; w: number; h: number }): void {
    this.world.editor?.panToWorld((rect.x + rect.w / 2) * TILE, (rect.y + rect.h / 2) * TILE);
  }

  private async submitDraftBoxesToAi(): Promise<void> {
    if (!this.draftBoxes.length) {
      this.setStatus('请先使用「📐 框选 AI (B)」在画布拖选至少 1 个区块');
      return;
    }
    if (!this.sessionId || !this.studioToken) {
      this.setStatus('尚未连接到后端工坊会话，请稍候重试');
      return;
    }
    const payloadBoxes = this.draftBoxes.map((b) => ({
      id: b.id,
      label: b.label,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      ...(b.note.trim() ? { note: b.note.trim() } : {}),
    }));
    const instruction = this.overallInstructionInput.value.trim();
    const res = await fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/tasks?token=${encodeURIComponent(this.studioToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxes: payloadBoxes, ...(instruction ? { instruction } : {}) }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      task?: StudioTaskSummary;
      tasks?: StudioTaskSummary[];
      presence?: StudioMcpPresence;
      error?: string;
    } | null;
    if (!res.ok || !data?.ok || !data.task) {
      this.setStatus(`派单失败: ${data?.error ?? `HTTP ${res.status}`}`);
      return;
    }
    this.draftBoxes = [];
    this.overallInstructionInput.value = '';
    if (data.tasks) this.tasks = data.tasks;
    if (data.presence) this.presence = data.presence;
    this.renderDraftBoxes();
    this.renderTasks();
    this.renderReviewFloat();
    this.setStatus(
      data.task.status === 'running'
        ? `⚡ 已派发 #T${data.task.seq} 给 AI 立即修改（可继续框选其他区块入队）`
        : this.presence.connected
          ? `⏳ #T${data.task.seq} 已入队，AI 正在或即将处理`
          : `⏳ #T${data.task.seq} 已入队，请确认你的 AI 已连接并开启 map_wait_next_task`,
    );
  }

  private async resolveTask(taskId: string, action: 'accept' | 'revert' | 'cancel'): Promise<void> {
    if (!this.sessionId || !this.studioToken) return;
    const res = await fetch(
      `/api/map/studio/${encodeURIComponent(this.sessionId)}/tasks/${encodeURIComponent(taskId)}/${action}?token=${encodeURIComponent(this.studioToken)}`,
      { method: 'POST' },
    );
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      doc?: CustomMapDocument;
      rev?: number;
      tasks?: StudioTaskSummary[];
      error?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      this.setStatus(`操作失败: ${data?.error ?? `HTTP ${res.status}`}`);
      return;
    }
    if (data.rev && data.rev > this.sessionRev && data.doc) {
      this.sessionRev = data.rev;
      this.applyDocState(data.doc);
      this.world.editor?.invalidateRect();
    }
    if (data.tasks) {
      this.tasks = data.tasks;
      this.renderTasks();
      this.renderReviewFloat();
    }
    this.setStatus(
      action === 'accept' ? '✅ 已确认保留该项 AI 修改' : action === 'revert' ? '↩️ 已精准恢复该区域修改前的原样' : '🚫 已取消排队任务',
    );
  }

  private async rotateToken(): Promise<void> {
    if (!this.sessionId || !this.studioToken) return;
    const res = await fetch(
      `/api/map/studio/${encodeURIComponent(this.sessionId)}/rotate-token?token=${encodeURIComponent(this.studioToken)}`,
      { method: 'POST' },
    );
    const data = (await res.json().catch(() => null)) as { ok?: boolean; studioToken?: string; error?: string } | null;
    if (!res.ok || !data?.ok || !data.studioToken) {
      this.setStatus(`重置令牌失败: ${data?.error ?? `HTTP ${res.status}`}`);
      return;
    }
    this.studioToken = data.studioToken;
    this.presence = { connected: false, listening: false, lastSeenAt: 0, activeTaskId: null };
    this.saveSessionCredentials();
    this.connectSse();
    this.renderPresence();
    this.setStatus('🔄 已生成全新隔离令牌，旧 AI 连接已失效，请重新复制 MCP 配置');
  }

  private scheduleSelectionSync(immediate = false): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (!this.sessionId || !this.studioToken) return;
    const run = () => {
      void fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/selection?token=${encodeURIComponent(this.studioToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.selection ? this.selection : { clear: true }),
      }).catch(() => {});
    };
    if (immediate) run();
    else this.syncTimer = setTimeout(run, 180);
  }

  private commitLocalEdit(patchRect?: TileRect): void {
    if (!this.doc) return;
    this.doc.updatedAt = Date.now();
    this.applyPreview(this.doc, patchRect);
    this.refreshStats();
    if (!this.sessionId || !this.studioToken) return;
    const snap = cloneDoc(this.doc);
    void fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}?token=${encodeURIComponent(this.studioToken)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: snap, patchRect }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { rev?: number } | null) => {
        if (res?.rev && res.rev > this.sessionRev) this.sessionRev = res.rev;
      })
      .catch(() => {});
  }

  private async remoteUndoRedo(kind: 'undo' | 'redo'): Promise<void> {
    if (!this.sessionId || !this.studioToken) return;
    const res = await fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/${kind}?token=${encodeURIComponent(this.studioToken)}`, {
      method: 'POST',
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; rev?: number; doc?: CustomMapDocument; error?: string } | null;
    if (data?.ok && data.doc) {
      this.sessionRev = Math.max(this.sessionRev, data.rev ?? this.sessionRev);
      this.applyDocState(data.doc);
      this.setStatus(kind === 'undo' ? '已撤销' : '已重做');
    } else if (data?.error) {
      this.setStatus(data.error);
    }
  }

  private setTool(t: EditorTool): void {
    this.tool = t;
    this.dragStart = null;
    for (const [id, btn] of this.toolBtns) {
      btn.classList.toggle('is-active', id === t);
    }
    this.renderSubOptions();
  }

  private renderSubOptions(): void {
    const wrap = this.subOptionsEl;
    wrap.innerHTML = '';
    if (this.tool === 'pan') {
      wrap.append(h('div', { class: 'map-studio__badge', text: '拖拽画布即可平移镜头，滚轮缩放。' }));
      return;
    }
    if (this.tool === 'box') {
      wrap.append(h('div', { class: 'map-studio__badge', text: '左键拖拽可连续框选 1 个或多个目标区域，填好要求后点击「直接发送给 AI 修改」。' }));
      return;
    }
    if (this.tool === 'floor') {
      wrap.append(h('div', { class: 'map-studio__section-title', text: '选择地面材质（点击或框拖铺设）' }));
      const chips = h('div', { class: 'map-studio__chips' });
      for (const f of FLOORS) {
        chips.append(h('button', {
          class: `map-studio__chip${this.floorKind === f.kind ? ' is-active' : ''}`,
          type: 'button',
          text: f.label,
          on: {
            click: () => {
              this.floorKind = f.kind;
              this.renderSubOptions();
            },
          },
        }));
      }
      wrap.append(chips);
      return;
    }
    if (this.tool === 'desk4') {
      wrap.append(h('div', { class: 'map-studio__section-title', text: '四向工位朝向（按 R 旋转）' }));
      const row = h('div', { class: 'map-studio__chips' });
      for (const d of DIR_ORDER) {
        row.append(h('button', {
          class: `map-studio__chip${this.deskDir === d ? ' is-active' : ''}`,
          type: 'button',
          text: DIR_LABELS[d],
          on: {
            click: () => {
              this.deskDir = d;
              this.renderSubOptions();
            },
          },
        }));
      }
      wrap.append(row);
      return;
    }
    if (this.tool === 'wall') {
      wrap.append(h('div', { class: 'map-studio__section-title', text: '墙体 / 门洞工具' }));
      const row = h('div', { class: 'map-studio__chips' });
      for (const [m, label] of [
        ['face', '北墙面 (2格高)'],
        ['cap', '竖墙/柱'],
        ['door', '切开门洞'],
      ] as const) {
        row.append(h('button', {
          class: `map-studio__chip${this.wallMode === m ? ' is-active' : ''}`,
          type: 'button',
          text: label,
          on: {
            click: () => {
              this.wallMode = m;
              this.renderSubOptions();
            },
          },
        }));
      }
      wrap.append(row);
      return;
    }
    if (this.tool === 'furn') {
      wrap.append(h('div', { class: 'map-studio__section-title', text: '家具与挂件库' }));
      const chips = h('div', { class: 'map-studio__chips' });
      for (const fp of FURNITURE_PALETTE) {
        chips.append(h('button', {
          class: `map-studio__chip${this.furnKind === fp.kind ? ' is-active' : ''}`,
          type: 'button',
          text: fp.label,
          on: {
            click: () => {
              this.furnKind = fp.kind;
              this.renderSubOptions();
            },
          },
        }));
      }
      wrap.append(chips);
      return;
    }
    if (this.tool === 'zone' || this.tool === 'room') {
      wrap.append(h('div', { class: 'map-studio__section-title', text: this.tool === 'room' ? '新房间功能类型（拖拽 >=6×6 格）' : '划定区划类型' }));
      const chips = h('div', { class: 'map-studio__chips' });
      for (const z of ZONES) {
        chips.append(h('button', {
          class: `map-studio__chip${this.zoneKind === z.kind ? ' is-active' : ''}`,
          type: 'button',
          text: z.label,
          on: {
            click: () => {
              this.zoneKind = z.kind;
              this.renderSubOptions();
            },
          },
        }));
      }
      wrap.append(chips);
      return;
    }
    wrap.append(h('div', { class: 'map-studio__badge', text: '点击或拖框删除范围内的家具、挂件、墙体与区域' }));
  }

  private handleCanvasPointer(
    ev: PointerEvent,
    kind: 'down' | 'move' | 'up',
    tile: { tx: number; ty: number; wx: number; wy: number },
  ): boolean {
    if (!this.doc) return false;
    if (ev.button === 1 || ev.button === 2 || ev.altKey) return false;
    const clampedX = Math.max(0, Math.min(this.doc.width - 1, tile.tx));
    const clampedY = Math.max(0, Math.min(this.doc.height - 1, tile.ty));
    this.hoverTile = { tx: clampedX, ty: clampedY };

    if (this.tool === 'pan') return false;

    if (kind === 'down') {
      if (ev.button !== 0) return false;
      this.dragStart = { tx: clampedX, ty: clampedY };
      if (this.tool === 'desk4') {
        this.stampWorkstation(clampedX, clampedY);
        this.dragStart = null;
      } else if (this.tool === 'furn') {
        this.stampFurniture(clampedX, clampedY);
        this.dragStart = null;
      }
      return true;
    }

    if (kind === 'move') {
      return !!this.dragStart;
    }

    if (kind === 'up' && this.dragStart) {
      const x0 = Math.min(this.dragStart.tx, clampedX);
      const y0 = Math.min(this.dragStart.ty, clampedY);
      const x1 = Math.max(this.dragStart.tx, clampedX);
      const y1 = Math.max(this.dragStart.ty, clampedY);
      const rect: TileRect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      this.dragStart = null;

      if (this.tool === 'box') {
        const boxId = `b_${++this.draftBoxSeq}`;
        const label = `区块 #${this.draftBoxes.length + 1}`;
        this.draftBoxes.push({ id: boxId, label, ...rect, note: '' });
        this.selection = { ...rect, updatedAt: Date.now() };
        this.renderDraftBoxes();
        this.scheduleSelectionSync(true);
        this.setStatus(`已添加 ${label} (${rect.x}, ${rect.y}) ${rect.w}×${rect.h} 格，可继续框选或点击发送给 AI`);
      } else if (this.tool === 'floor') {
        const buf = FloorGridBuffer.fromDocument(this.doc);
        buf.fillRect(rect.x, rect.y, rect.w, rect.h, { kind: this.floorKind });
        this.doc.floorPalette = buf.palette;
        this.doc.floorRows = buf.toRows();
        this.commitLocalEdit(rect);
      } else if (this.tool === 'room') {
        const rw = Math.max(6, rect.w);
        const rh = Math.max(6, rect.h);
        const rx = Math.min(this.doc.width - rw, rect.x);
        const ry = Math.min(this.doc.height - rh, rect.y);
        const buf = FloorGridBuffer.fromDocument(this.doc);
        const fl: FloorKind = this.zoneKind === 'lounge' ? 'wood' : this.zoneKind === 'cafe' ? 'tile_check' : this.zoneKind === 'restroom' ? 'tile_white' : 'carpet';
        buf.fillRect(rx, ry, rw, rh, { kind: fl });
        this.doc.floorPalette = buf.palette;
        this.doc.floorRows = buf.toRows();
        const zid = `zone-${Date.now().toString(36)}`;
        this.doc.walls.push(...buildCustomRoomWalls(zid, rx, ry, rw, rh, CORE_WALLS.reception));
        const zLabel = ZONES.find((z) => z.kind === this.zoneKind)?.label ?? '新建区域';
        this.doc.zones.push({
          id: zid,
          name: `${zLabel} ${this.doc.zones.length + 1}`,
          kind: this.zoneKind,
          rect: { x: rx, y: ry, w: rw, h: rh },
          ...(this.zoneKind === 'room' ? { hasLightSwitch: true } : {}),
        });
        this.commitLocalEdit({ x: rx, y: ry, w: rw, h: rh });
      } else if (this.tool === 'wall') {
        this.applyWallAction(rect);
      } else if (this.tool === 'zone') {
        const zLabel = ZONES.find((z) => z.kind === this.zoneKind)?.label ?? '区域';
        const zid = `zone-${Date.now().toString(36)}`;
        this.doc.zones.push({
          id: zid,
          name: `${zLabel} ${this.doc.zones.length + 1}`,
          kind: this.zoneKind,
          rect,
          ...(this.zoneKind === 'room' ? { hasLightSwitch: true } : {}),
        });
        this.commitLocalEdit(rect);
      } else if (this.tool === 'erase') {
        this.applyErase(rect);
      }
      return true;
    }

    return false;
  }

  private stampWorkstation(tx: number, ty: number): void {
    if (!this.doc || this.doc.furniture.length + 2 > MAX_MAP_ITEMS) return;
    const ts = Date.now().toString(36) + Math.floor(Math.random() * 999);
    const deskId = `desk-${ts}`;
    const chairId = `chair-${ts}`;
    if (this.deskDir === 'up') {
      this.doc.furniture.push(
        { id: deskId, kind: 'desk', tx, ty, variant: 'wood' },
        { id: chairId, kind: 'office_chair', tx, ty: ty + 1, variant: 'black', dir: 'up', deskId },
      );
    } else if (this.deskDir === 'down') {
      this.doc.furniture.push(
        { id: chairId, kind: 'office_chair_front', tx, ty, variant: 'black', dir: 'down', deskId },
        { id: deskId, kind: 'desk_back', tx, ty: ty + 1, variant: 'wood' },
      );
    } else if (this.deskDir === 'right') {
      this.doc.furniture.push(
        { id: chairId, kind: 'office_chair_right', tx, ty, variant: 'black', dir: 'right', deskId },
        { id: deskId, kind: 'desk_west', tx: tx + 1, ty, variant: 'wood' },
      );
    } else {
      this.doc.furniture.push(
        { id: deskId, kind: 'desk_east', tx, ty, variant: 'wood' },
        { id: chairId, kind: 'office_chair_left', tx: tx + 1, ty, variant: 'black', dir: 'left', deskId },
      );
    }
    this.commitLocalEdit({ x: tx - 1, y: ty - 1, w: 4, h: 4 });
  }

  private stampFurniture(tx: number, ty: number): void {
    if (!this.doc) return;
    const itemMeta = FURNITURE_PALETTE.find((f) => f.kind === this.furnKind);
    const id = `${this.furnKind}-${Date.now().toString(36)}`;
    if (itemMeta?.isWall) {
      this.doc.wallItems.push({
        id,
        kind: this.furnKind,
        tx: tx + 0.5,
        ty: ty + 1,
        on: itemMeta.on ?? 'face',
      });
    } else {
      this.doc.furniture.push({ id, kind: this.furnKind, tx, ty });
      if (this.furnKind === 'entrance_mat') {
        this.doc.spawns.push({ id: `spawn-${id}`, tx, ty, dir: 'up' });
      }
    }
    this.commitLocalEdit({ x: tx - 1, y: ty - 1, w: 4, h: 4 });
  }

  private applyWallAction(rect: TileRect): void {
    if (!this.doc) return;
    if (this.wallMode === 'door') {
      let carved = false;
      for (const w of this.doc.walls) {
        if (w.kind !== 'face' && w.kind !== 'south') continue;
        const hgt = w.kind === 'face' ? 2 : 1;
        if (rect.y + rect.h > w.ty && rect.y < w.ty + hgt && rect.x + rect.w > w.tx && rect.x < w.tx + w.w) {
          const offset = Math.max(0, rect.x - w.tx);
          const dw = Math.max(1, Math.min(w.w - offset, rect.w));
          w.doorways = [...(w.doorways ?? []), { offset, w: dw }];
          carved = true;
        }
      }
      if (carved) this.commitLocalEdit(rect);
      return;
    }
    const id = `wall-${Date.now().toString(36)}`;
    if (this.wallMode === 'face') {
      this.doc.walls.push({ id, kind: 'face', tx: rect.x, ty: rect.y, w: rect.w, h: 2, style: CORE_WALLS.reception });
    } else {
      this.doc.walls.push({ id, kind: 'cap', tx: rect.x, ty: rect.y, w: Math.max(1, rect.w), h: Math.max(1, rect.h), style: CORE_WALLS.reception });
    }
    this.commitLocalEdit(rect);
  }

  private applyErase(rect: TileRect): void {
    if (!this.doc) return;
    const overlap = (ax: number, ay: number, aw: number, ah: number) =>
      ax < rect.x + rect.w && ax + aw > rect.x && ay < rect.y + rect.h && ay + ah > rect.y;
    this.doc.furniture = this.doc.furniture.filter((f) => {
      const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      return !overlap(f.tx, f.ty, fp.w, fp.h);
    });
    this.doc.wallItems = this.doc.wallItems.filter((wi) => !overlap(Math.floor(wi.tx), Math.floor(wi.ty) - 1, 1, 2));
    this.doc.walls = this.doc.walls.filter((w) => !overlap(w.tx, w.ty, w.w, w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h));
    this.doc.spawns = this.doc.spawns.filter((s) => !overlap(s.tx, s.ty, 1, 1));
    if (rect.w >= 2 || rect.h >= 2) {
      this.doc.zones = this.doc.zones.filter((z) => {
        const cx = z.rect.x + z.rect.w / 2;
        const cy = z.rect.y + z.rect.h / 2;
        return !(cx >= rect.x && cx < rect.x + rect.w && cy >= rect.y && cy < rect.y + rect.h);
      });
    }
    this.commitLocalEdit(rect);
  }

  private applyResize(): void {
    if (!this.doc) return;
    const w = Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, Math.floor(Number(this.widthInput.value) || this.doc.width)));
    const ht = Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, Math.floor(Number(this.heightInput.value) || this.doc.height)));
    this.doc = resizeCustomMap(this.doc, w, ht);
    this.applyDocState(this.doc);
    this.commitLocalEdit({ x: 0, y: 0, w, h: ht });
    this.setStatus(`画布已调整为 ${w}×${ht} 格`);
  }

  private drawRectBadge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, zoom: number, color: string, fill: string, text: string): void {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(x * TILE, y * TILE, w * TILE, hgt * TILE);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5 / zoom, 1.5);
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(x * TILE, y * TILE, w * TILE, hgt * TILE);
    ctx.setLineDash([]);
    const fontPx = Math.max(10, Math.round(11 / Math.min(zoom, 1.2)));
    ctx.font = `bold ${fontPx}px sans-serif`;
    const tw = ctx.measureText(text).width + 8;
    const bh = fontPx + 5;
    ctx.fillStyle = color;
    ctx.fillRect(x * TILE, Math.max(0, y * TILE - bh), tw, bh);
    ctx.fillStyle = '#0b111e';
    ctx.fillText(text, x * TILE + 4, Math.max(fontPx, y * TILE - 3));
    ctx.restore();
  }

  private drawCanvasOverlay(ctx: CanvasRenderingContext2D, view: { zoom: number; ox: number; oy: number; dpr: number }): void {
    if (!this.doc) return;
    const editor = this.world.editor;

    if (this.showWalkGrid && editor && view.zoom >= 0.35) {
      const vr = editor.getViewportWorldRect();
      const x0 = Math.max(0, Math.floor(vr.x / TILE));
      const y0 = Math.max(0, Math.floor(vr.y / TILE));
      const x1 = Math.min(this.doc.width - 1, Math.ceil((vr.x + vr.w) / TILE));
      const y1 = Math.min(this.doc.height - 1, Math.ceil((vr.y + vr.h) / TILE));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 12_000) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const cell = editor.isWalkable(x, y);
            ctx.fillStyle = cell === 0 ? 'rgba(239, 68, 68, 0.28)' : cell === 2 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(74, 222, 128, 0.14)';
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
      }
    }

    // Active review / running / queued AI task overlays
    for (const task of this.tasks) {
      if (task.status !== 'queued' && task.status !== 'running' && task.status !== 'review') continue;
      const color = task.status === 'review' ? '#4ade80' : task.status === 'running' ? '#fbbf24' : '#a78bfa';
      const fill = task.status === 'review' ? 'rgba(74,222,128,0.12)' : task.status === 'running' ? 'rgba(251,191,36,0.14)' : 'rgba(167,139,250,0.12)';
      const tag = task.status === 'review' ? `👀 #T${task.seq} 待确认` : task.status === 'running' ? `⚡ #T${task.seq} 修改中` : `⏳ #T${task.seq} 排队`;
      task.boxes.forEach((b, i) => {
        this.drawRectBadge(ctx, b.x, b.y, b.w, b.h, view.zoom, color, fill, task.boxes.length > 1 ? `${tag}-${i + 1}` : tag);
      });
    }

    // Draft multi-box selections
    this.draftBoxes.forEach((b, i) => {
      this.drawRectBadge(ctx, b.x, b.y, b.w, b.h, view.zoom, '#38bdf8', 'rgba(82,196,255,0.16)', `#${i + 1}`);
    });

    // Active drag marquee or hover cursor preview
    if (this.dragStart && this.hoverTile) {
      const x0 = Math.min(this.dragStart.tx, this.hoverTile.tx);
      const y0 = Math.min(this.dragStart.ty, this.hoverTile.ty);
      const x1 = Math.max(this.dragStart.tx, this.hoverTile.tx);
      const y1 = Math.max(this.dragStart.ty, this.hoverTile.ty);
      ctx.save();
      ctx.fillStyle = this.tool === 'erase' ? 'rgba(239,68,68,0.22)' : 'rgba(250,204,21,0.18)';
      ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
      ctx.strokeStyle = this.tool === 'erase' ? '#f87171' : '#facc15';
      ctx.lineWidth = Math.max(1.5 / view.zoom, 1.5);
      ctx.strokeRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
      ctx.restore();
    } else if (this.hoverTile && this.tool !== 'pan') {
      const { tx, ty } = this.hoverTile;
      let pw = 1;
      let ph = 1;
      if (this.tool === 'desk4') {
        pw = 2;
        ph = 2;
      } else if (this.tool === 'furn') {
        const fp = FURNITURE[this.furnKind]?.footprint ?? { w: 1, h: 1 };
        pw = Math.max(1, fp.w);
        ph = Math.max(1, fp.h);
      }
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(1.2 / view.zoom, 1);
      ctx.strokeRect(tx * TILE, ty * TILE, pw * TILE, ph * TILE);
      ctx.restore();
    }
  }

  private async importJsonFile(file: File): Promise<void> {
    const text = await file.text();
    const parsed = parseCustomMapJson(text);
    if (!parsed.ok) {
      this.setStatus(`导入失败: ${parsed.error}`);
      return;
    }
    this.applyDocState(parsed.doc);
    this.commitLocalEdit({ x: 0, y: 0, w: parsed.doc.width, h: parsed.doc.height });
    this.setStatus(`已导入地图 ${parsed.doc.name}`);
  }

  private downloadJson(): void {
    if (!this.doc) return;
    const blob = new Blob([serializeCustomMapJson(this.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.doc.id || 'agent-party-map'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.setStatus('已导出 JSON（可发给系统管理员在后台实时切换）');
  }

  private async copyEndpointUrl(): Promise<void> {
    const url = this.dedicatedMcpUrl();
    await navigator.clipboard?.writeText(url).catch(() => {});
    this.setStatus(`已复制专属 MCP 接口地址：${url}`);
  }

  private async copyAutopilotPrompt(): Promise<void> {
    const origin = this.endpointOrigin.replace(/\/+$/, '');
    const mcpUrl = this.dedicatedMcpUrl();
    const setupMdUrl = `${origin}/map-studio-setup.md?token=${encodeURIComponent(this.studioToken)}&base=${encodeURIComponent(origin)}`;
    const text = [
      `请帮我接入 Agent Party 地图工坊（这是我的个人专属隔离会话，勿与其他人混用）并立即开启实时协同改图：`,
      ``,
      `1. 专属连接信息：`,
      `   - 服务端地址：${origin}`,
      `   - 专属 MCP 接口 (HTTP)：${mcpUrl}`,
      `   - 桥接脚本下载：${origin}/client-scripts/map-mcp.mjs`,
      `   - 隔离会话 ID：${this.sessionId}（Token：${this.studioToken}）`,
      ``,
      `2. 请先读取并执行完整接入协议：${setupMdUrl}`,
      `   - 若支持直接配置 MCP，请下载 map-mcp.mjs 到主目录 .agent-party/map-mcp.mjs，并将 agent-party-map (${mcpUrl}) 写入你的 MCP 配置；`,
      `   - 为了免重启立刻在当前页面生效，请立即调用 map_wait_next_task（或执行 node "<ABS_HOME>/.agent-party/map-mcp.mjs" --wait --url "${mcpUrl}"）进入自动接单待命状态，直到页面状态变为「🟢 MCP 已连接 · AI 自动接单待命中」。`,
    ].join('\n');
    await navigator.clipboard?.writeText(text).catch(() => {});
    this.setStatus('✅ 已复制发给 AI 的完整接入指令（含 IP、专属 MCP 接口与免重启自动接单流程）');
  }

  private async copyMcpConfig(): Promise<void> {
    await navigator.clipboard?.writeText(JSON.stringify(this.buildMcpConfigObject(), null, 2)).catch(() => {});
    this.setStatus('已复制标准 MCP JSON 配置（含专属隔离 URL，注意将 <主目录> 替换为真实绝对路径）');
  }

  private async publishAsAdmin(): Promise<void> {
    const key = getSessionAdminKey();
    if (!key || !this.doc) return;
    const res = await fetch('/api/admin/maps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': key,
      },
      body: JSON.stringify({ doc: this.doc, activate: true }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && data?.ok) {
      this.setStatus('✅ 已发布并实时切换为全员线上地图');
      this.close();
    } else {
      this.setStatus(`发布失败: ${data?.error ?? `HTTP ${res.status}`}`);
    }
  }
}

export function attachStudioQueryMode(editor: MapEditor, ctx: UiContext): void {
  if (typeof location === 'undefined') return;
  const params = new URLSearchParams(location.search);
  if (params.get('studio') === '1') {
    ctx.root.classList.add('is-studio-sidebar');
    void editor.open();
  }
}
