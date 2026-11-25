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
  createBlankCustomMap,
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

type EditorTool = 'select' | 'pan' | 'box' | 'floor' | 'room' | 'wall' | 'desk4' | 'furn' | 'zone' | 'road' | 'measure' | 'erase';
type MapElementKind = 'zone' | 'furniture' | 'wall' | 'wallItem' | 'rug' | 'spawn' | 'reference';

interface ReferenceImageState {
  id: string;
  name: string;
  src: string;
  image: HTMLImageElement;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

interface SelectedMapElement {
  kind: MapElementKind;
  id: string;
}

interface ProjectTab {
  id: string;
  doc: CustomMapDocument;
}

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
const UI_FONT_SIZE_STORAGE_KEY = 'agent_party_map_ui_font_size';
type UiFontSize = 14 | 16 | 18 | 20;
const UI_FONT_SIZES: readonly UiFontSize[] = [14, 16, 18, 20];

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

function icon(name: string): string {
  const paths: Record<string, string> = {
    select: '<path d="M6 3l12 9-6 1.5L9 19z"/>',
    box: '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2"/>',
    terrain: '<path d="M4 17l5-9 5 5 3-4 4 8z"/><path d="M4 20h16"/>',
    road: '<path d="M7 3c8 4 2 14 10 18"/><path d="M4 3c8 4 2 14 10 18" stroke-dasharray="2 3"/>',
    poi: '<path d="M12 21s7-6.2 7-12A7 7 0 1 0 5 9c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2"/>',
    measure: '<path d="M4 17L17 4l3 3L7 20z"/><path d="M8 14l2 2m1-5l2 2m1-5l2 2"/>',
    pan: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 2z"/>',
    floor: '<path d="M4 5h16v14H4z"/><path d="M4 10h16M9 5v14m6-14v14"/>',
    wall: '<path d="M4 6h16v12H4z"/><path d="M4 10h16M4 14h16M8 6v4m8-4v4m-4 4v4"/>',
    erase: '<path d="M5 15L14 6l5 5-8 8H7z"/><path d="M11 19h9"/>',
    eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
    eyeOff: '<path d="M4 4l16 16M3 12s3-5 9-6c2 0 4 .6 5.5 1.5M21 12s-3 5-9 6c-2 0-4-.6-5.5-1.5"/>',
    lock: '<rect x="6" y="10" width="12" height="10"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="6" y="10" width="12" height="10"/><path d="M8 10V7a4 4 0 0 1 7-2"/>',
    chevron: '<path d="M8 10l4 4 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3m-8 0l1 13h8l1-13"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.box}</svg>`;
}

const ERASE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="3" fill="#252525"/><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7" fill="none" stroke="#F26D6D" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>')}") 4 4, default`;

const OFFICE_CHAIR_KIND_BY_DIR: Record<Dir, FurnitureKind> = {
  up: 'office_chair',
  down: 'office_chair_front',
  left: 'office_chair_left',
  right: 'office_chair_right',
};
const OFFICE_CHAIR_DIR_BY_KIND = new Map<FurnitureKind, Dir>(Object.entries(OFFICE_CHAIR_KIND_BY_DIR).map(([dir, kind]) => [kind, dir as Dir]));
const DESK_KIND_BY_DIR: Record<Dir, FurnitureKind> = {
  up: 'desk',
  down: 'desk_back',
  right: 'desk_east',
  left: 'desk_west',
};
const DESK_DIR_BY_KIND = new Map<FurnitureKind, Dir>(Object.entries(DESK_KIND_BY_DIR).map(([dir, kind]) => [kind, dir as Dir]));
const TOOL_LABELS: Record<EditorTool, string> = {
  select: '选择',
  box: '框选',
  floor: '地形',
  room: '区域',
  wall: '墙体',
  desk4: '工位',
  furn: 'POI',
  zone: '功能区',
  road: '道路',
  measure: '测距',
  erase: '删除',
  pan: '抓手',
};

function furnitureLabel(kind: FurnitureKind): string {
  return FURNITURE_PALETTE.find((item) => item.kind === kind)?.label.replace(/^\S+\s+/, '') ?? kind;
}

export class MapEditor {
  readonly el: HTMLElement;
  readonly toolbarEl: HTMLElement;
  readonly menuBarEl: HTMLElement;
  readonly contextBarEl: HTMLElement;
  readonly viewportTabsEl: HTMLElement;
  readonly viewportStatusEl: HTMLElement;
  readonly aiDockEl: HTMLElement;
  readonly reviewFloatEl: HTMLElement;
  onLayoutChange: (() => void) | null = null;
  private isOpen = false;
  private collapsed = false;
  private worldOptionsBefore: ReturnType<WorldApi['getOptions']> | null = null;
  private doc: CustomMapDocument | null = null;
  private sessionId = '';
  private studioToken = '';
  private sessionRev = 0;
  private sse: EventSource | null = null;
  private tool: EditorTool = 'select';
  private floorKind: FloorKind = 'carpet';
  private wallMode: 'face' | 'cap' | 'door' = 'face';
  private deskDir: Dir = 'up';
  private furnKind: FurnitureKind = 'entrance_mat';
  private zoneKind: AreaKind = 'room';
  private roadWidth = 2;
  private showWalkGrid = false;
  private selection: MapSelection | null = null;
  private selectedElement: SelectedMapElement | null = null;
  private measurement: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private referenceImage: ReferenceImageState | null = null;
  private referencePanelEl: HTMLElement;
  private referenceFileInput: HTMLInputElement;
  private hiddenLayers = new Set<string>();
  private lockedLayers = new Set<string>();
  private collapsedGroups = new Set<string>();
  private projectTabs: ProjectTab[] = [];
  private activeProjectId = '';
  private activeInspectorTab: 'inspector' | 'ai' = 'inspector';
  private activeBottomTab: 'layers' | 'tasks' = 'layers';
  private aiDockOpen = false;
  private uiFontSize: UiFontSize = 16;
  private draftBoxes: DraftBox[] = [];
  private draftBoxSeq = 0;
  private tasks: StudioTaskSummary[] = [];
  private presence: StudioMcpPresence = { connected: false, listening: false, lastSeenAt: 0, activeTaskId: null };
  private pairingOpen = false;
  private endpointOrigin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:4747';
  private endpointCandidates: string[] = [];

  private dragStart: { tx: number; ty: number } | null = null;
  private moveOrigin: { tx: number; ty: number } | null = null;
  private hoverTile: { tx: number; ty: number } | null = null;
  private spacePanning = false;
  private panDrag: { pointerId: number; x: number; y: number } | null = null;
  private toolBtns = new Map<EditorTool, HTMLButtonElement>();
  private subOptionsEl: HTMLElement;
  private currentToolEl: HTMLElement;
  private statusEl: HTMLElement;
  private statsEl: HTMLElement;
  private projectNameEl: HTMLElement;
  private coordinatesEl: HTMLElement;
  private saveStateEl: HTMLElement;
  private zoomEl: HTMLElement;
  private projectTabsEl: HTMLElement;
  private inspectorEl: HTMLElement;
  private layersEl: HTMLElement;
  private inspectorPanelEl: HTMLElement;
  private aiPanelEl: HTMLElement;
  private layersPanelEl: HTMLElement;
  private tasksPanelEl: HTMLElement;
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
  private offBeforeFrame: (() => void) | null = null;
  private offAfterFrame: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private presencePollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: UiContext,
    private readonly world: WorldApi,
  ) {
    try {
      const saved = Number(localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY));
      if (UI_FONT_SIZES.includes(saved as UiFontSize)) this.uiFontSize = saved as UiFontSize;
    } catch {}
    this.ctx.root.style.setProperty('--map-ui-font-size', `${this.uiFontSize}px`);
    this.statusEl = h('div', { class: 'map-studio__status', text: '准备就绪' });
    this.statsEl = h('div', { class: 'map-studio__badge', text: '尚未加载地图' });
    this.projectNameEl = h('span', { class: 'map-workspace__project', text: '地图工程' });
    this.coordinatesEl = h('span', { class: 'map-workspace__readout', text: 'X 0  Y 0' });
    this.saveStateEl = h('span', { class: 'map-workspace__save', text: '未连接' });
    this.zoomEl = h('span', { class: 'map-workspace__readout', text: '100%' });
    this.projectTabsEl = h('div', { class: 'map-viewport__tabs' });
    this.inspectorEl = h('div', { class: 'map-inspector' });
    this.layersEl = h('div', { class: 'map-layers' });
    this.referencePanelEl = h('div', { class: 'map-reference' });
    this.boxCountEl = h('span', { class: 'map-studio__badge', text: '已选 0 个区块' });
    this.presenceTextEl = h('span', { text: 'AI 未连接' });
    this.presenceSubEl = h('div', { class: 'map-studio__badge', text: '选区与任务进度仅属于当前地图草稿' });
    this.tokenBadgeEl = h('div', { class: 'map-studio__badge', text: '等待生成专属令牌…' });
    this.endpointChipsEl = h('div', { class: 'map-studio__chips' });
    this.endpointUrlEl = h('div', { class: 'map-studio__badge', text: '专属 MCP 接口：生成中…', style: 'word-break:break-all;user-select:text;' });
    this.mcpJsonPreEl = h('pre', { class: 'map-studio__code' });

    const pairingToggleBtn = h('button', {
      class: 'map-studio__btn map-studio__mcp-toggle',
      type: 'button',
      text: 'MCP 接入',
      attrs: { 'aria-expanded': 'false', 'aria-controls': 'map-studio-mcp' },
      on: { click: () => this.setPairingOpen(!this.pairingOpen) },
    });

    this.presenceCardEl = h(
      'div',
      { class: 'map-studio__presence' },
      h('div', { class: 'map-studio__presence-label' }, h('span', { class: 'map-studio__dot' }), this.presenceTextEl),
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
      { class: 'map-studio__mcp-popover', hidden: true, attrs: { id: 'map-studio-mcp' } },
      h(
        'div',
        { class: 'map-studio__mcp-head' },
        h('strong', { text: 'MCP 接入说明' }),
        h('button', { class: 'map-studio__btn', type: 'button', text: '关闭', on: { click: () => this.setPairingOpen(false) } }),
      ),
      h(
        'ol',
        { class: 'map-studio__steps' },
        h('li', { text: '点击“复制完整接入指令”，发给你的 AI。' }),
        h('li', { text: '确认 AI 已连接并开始自动接收任务。' }),
        h('li', { text: '回到页面框选地图，填写要求后发送。' }),
      ),
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

    const toolsGrid = h('div', { class: 'map-studio__tools', role: 'toolbar', attrs: { 'aria-label': '地图工具', 'aria-orientation': 'vertical' } });
    const makeToolButton = (id: EditorTool, iconName: string, description: string, grouped = false) => {
      const btn = h('button', {
        class: 'map-studio__tool-btn',
        type: 'button',
        attrs: { title: description, 'aria-label': description },
        on: { click: () => this.setTool(id) },
      }) as HTMLButtonElement;
      btn.innerHTML = icon(iconName) + `<span class="map-studio__tool-label">${TOOL_LABELS[id]}</span>` + (grouped ? '<span class="map-studio__tool-triangle"></span>' : '');
      this.toolBtns.set(id, btn);
      return btn;
    };
    toolsGrid.append(
      makeToolButton('select', 'select', '选择 / 移动 (V)'),
      makeToolButton('box', 'box', '框选地图区域 (B)'),
    );
    const terrainGroup = h('div', { class: 'map-studio__tool-wrap' });
    const terrainFlyout = h(
      'div',
      { class: 'map-studio__tool-flyout', hidden: true },
      makeToolButton('floor', 'floor', '地形填充 (F)'),
      makeToolButton('room', 'terrain', '区域绘制 (M)'),
      makeToolButton('zone', 'terrain', '功能区域 (Z)'),
    );
    const terrainDisclosure = h('button', {
      class: 'map-studio__tool-disclosure',
      type: 'button',
      attrs: { 'aria-label': '展开地形与区域工具', title: '地形与区域工具组' },
      on: { click: () => { terrainFlyout.hidden = !terrainFlyout.hidden; } },
    });
    terrainDisclosure.innerHTML = '<span class="map-studio__tool-triangle"></span>';
    terrainGroup.append(makeToolButton('floor', 'terrain', '地形 / 区域绘制 (F)', true), terrainDisclosure, terrainFlyout);
    toolsGrid.append(terrainGroup);
    toolsGrid.append(
      makeToolButton('road', 'road', '路径 / 道路连线 (L)'),
      makeToolButton('furn', 'poi', '放置 POI 地标 (P)'),
      makeToolButton('measure', 'measure', '测距 (U)'),
      makeToolButton('pan', 'pan', '抓手平移 (H / 空格 / 鼠标中键)'),
    );
    this.toolbarEl = h('aside', { class: 'map-studio__toolbar', hidden: true, role: 'region', attrs: { 'aria-label': '地图工具箱' } }, toolsGrid);

    const boxToolBtn = h('button', {
      class: 'map-studio__btn map-studio__ai-tool',
      type: 'button',
      text: '框选生成 AI 任务 (B)',
      attrs: { title: '框选生成 AI 任务 (B)', 'aria-label': '框选生成 AI 任务 (B)' },
      on: { click: () => this.setTool('box') },
    }) as HTMLButtonElement;

    this.currentToolEl = h('span', { class: 'map-context__current' });
    this.subOptionsEl = h('div', { class: 'map-context__options' });

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
      text: '清空框选',
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

    this.publishAdminBtn = h('button', {
      class: 'map-studio__btn map-studio__btn--primary',
      type: 'button',
      text: '🚀 管理员立即全员启用',
      hidden: true,
      on: { click: () => void this.publishAsAdmin() },
    }) as HTMLButtonElement;

    const collapseBtn = h('button', {
      class: 'map-studio__btn map-studio__collapse-btn',
      type: 'button',
      text: '»',
      attrs: { title: '收起地图工坊', 'aria-label': '收起地图工坊', 'aria-expanded': 'true' },
      on: { click: () => this.setCollapsed(!this.collapsed) },
    });
    const closeBtn = h('button', {
      class: 'map-studio__btn map-studio__close-btn',
      type: 'button',
      text: '✕',
      attrs: { title: '关闭地图工坊', 'aria-label': '关闭地图工坊' },
      on: { click: () => this.close() },
    });

    this.referenceFileInput = h('input', {
      attrs: { type: 'file', accept: 'image/*', hidden: 'true' },
      on: {
        change: () => {
          const file = this.referenceFileInput.files?.[0];
          if (file) void this.loadReferenceImage(file);
          this.referenceFileInput.value = '';
        },
      },
    }) as HTMLInputElement;

    const menuCommand = (label: string, action: () => void) => {
      const btn = h('button', { class: 'map-workspace__command', type: 'button', text: label, on: { click: () => {
        action();
        btn.closest('details')?.removeAttribute('open');
      } } });
      return btn;
    };
    const menu = (label: string, ...items: HTMLElement[]) => {
      const el = h(
        'details',
        { class: 'map-workspace__menu' },
        h('summary', { text: label }),
        h('div', { class: 'map-workspace__menu-pop' }, ...items),
      );
      el.addEventListener('toggle', () => {
        if (!el.open) return;
        for (const other of this.menuBarEl.querySelectorAll<HTMLDetailsElement>('.map-workspace__menu')) {
          if (other !== el) other.removeAttribute('open');
        }
        this.setPairingOpen(false);
      });
      return el;
    };
    const zoomOutBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', text: '−', attrs: { title: '缩小', 'aria-label': '缩小' }, on: { click: () => this.world.zoomBy(0.8) } });
    const zoomInBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', text: '+', attrs: { title: '放大', 'aria-label': '放大' }, on: { click: () => this.world.zoomBy(1.25) } });
    const fitBtn = h('button', { class: 'map-workspace__history-btn', type: 'button', text: '适应', attrs: { title: '适应整个地图', 'aria-label': '适应整个地图' }, on: { click: () => this.world.editor?.fitMap() } });
    const newTabBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', attrs: { title: '新建空白草稿', 'aria-label': '新建空白草稿' }, on: { click: () => this.createProjectTab() } });
    newTabBtn.innerHTML = icon('plus');
    const newGroupBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', attrs: { title: '新建区域图层组', 'aria-label': '新建区域图层组' }, on: { click: () => this.addZoneLayer() } });
    newGroupBtn.innerHTML = icon('plus');
    const newVectorBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', attrs: { title: '新建矢量地毯层', 'aria-label': '新建矢量地毯层' }, on: { click: () => this.addRugLayer() } });
    newVectorBtn.innerHTML = icon('terrain');
    const moveLayerUpBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', attrs: { title: '上移图层', 'aria-label': '上移图层' }, on: { click: () => this.reorderSelectedLayer(-1) } });
    moveLayerUpBtn.innerHTML = icon('up');
    const moveLayerDownBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', attrs: { title: '下移图层', 'aria-label': '下移图层' }, on: { click: () => this.reorderSelectedLayer(1) } });
    moveLayerDownBtn.innerHTML = icon('down');
    const deleteLayerBtn = h('button', { class: 'map-workspace__icon-btn', type: 'button', attrs: { title: '删除选中图层', 'aria-label': '删除选中图层' }, on: { click: () => this.deleteSelectedLayer() } });
    deleteLayerBtn.innerHTML = icon('trash');
    const undoBtn = h('button', { class: 'map-workspace__history-btn', type: 'button', text: '撤销', attrs: { title: '撤销 (Ctrl+Z)', 'aria-label': '撤销' }, on: { click: () => void this.remoteUndoRedo('undo') } });
    const redoBtn = h('button', { class: 'map-workspace__history-btn', type: 'button', text: '重做', attrs: { title: '重做 (Ctrl+Y)', 'aria-label': '重做' }, on: { click: () => void this.remoteUndoRedo('redo') } });
    const fontSizeSelect = h('select', {
      class: 'map-workspace__font-select',
      attrs: { title: '界面字号', 'aria-label': '界面字号' },
      on: { change: () => this.setUiFontSize(Number((fontSizeSelect as HTMLSelectElement).value) as UiFontSize) },
    });
    for (const size of UI_FONT_SIZES) fontSizeSelect.append(h('option', { text: `${size}px`, attrs: { value: String(size), selected: size === this.uiFontSize } }));

    this.menuBarEl = h(
      'header',
      { class: 'map-workspace__menubar', hidden: true },
      h(
        'div',
        { class: 'map-workspace__menus' },
        this.projectNameEl,
        menu('文件', menuCommand('新建空白草稿', () => this.createProjectTab()), menuCommand('导入 JSON', () => (fileInput as HTMLInputElement).click()), menuCommand('下载 JSON', () => this.downloadJson()), menuCommand('发布为线上地图', () => this.publishAdminBtn.click())),
        menu('地图', menuCommand('新建区域图层组', () => this.addZoneLayer()), menuCommand('新建矢量地毯层', () => this.addRugLayer()), menuCommand('放置工位 (K)', () => this.setTool('desk4')), menuCommand('墙体 / 门 (G)', () => this.setTool('wall')), menuCommand('删除工具 (E)', () => this.setTool('erase'))),
        menu('视图', menuCommand('添加参考图', () => this.referenceFileInput.click()), menuCommand('适应地图', () => this.world.editor?.fitMap()), menuCommand('切换通行网格', () => this.walkToggleBtn.click())),
        undoBtn,
        redoBtn,
        fileInput,
        this.referenceFileInput,
      ),
      h('div', { class: 'map-workspace__readouts' }, fontSizeSelect, zoomOutBtn, this.zoomEl, zoomInBtn, fitBtn, this.coordinatesEl, this.saveStateEl, pairingToggleBtn, closeBtn),
      this.pairingDrawerEl,
    );
    this.contextBarEl = h('div', { class: 'map-context', hidden: true }, this.currentToolEl, this.subOptionsEl);
    this.viewportTabsEl = h('div', { class: 'map-viewport', hidden: true }, this.projectTabsEl, newTabBtn);
    this.viewportStatusEl = h('div', { class: 'map-viewport__status', hidden: true }, h('span', { text: `网格 ${TILE}px · 吸附 1 格` }));

    this.inspectorPanelEl = h(
      'div',
      { class: 'map-studio__dock-panel map-studio__inspector-panel' },
      this.inspectorEl,
      this.referencePanelEl,
      h(
        'div',
        { class: 'map-studio__section map-studio__map-settings' },
        h('div', { class: 'map-studio__section-title', text: '画布尺寸' }),
        this.nameInput,
        h('div', { class: 'map-studio__row map-studio__dimensions' }, this.widthInput, h('span', { text: '×' }), this.heightInput, resizeBtn),
        quickSizes,
        this.statsEl,
      ),
    );
    this.tasksPanelEl = h('div', { class: 'map-ai-dock__tasks' }, h('div', { class: 'map-studio__section-title', text: 'AI 修改任务' }), this.tasksListEl);
    this.aiPanelEl = h(
      'div',
      { class: 'map-ai-dock__body', hidden: true },
      h(
        'div',
        { class: 'map-ai-dock__selection map-studio__section' },
        h('div', { class: 'map-studio__section-title', text: '选区与修改要求' }),
        boxToolBtn,
        this.presenceCardEl,
        this.presenceSubEl,
        this.draftBoxesEl,
        this.overallInstructionInput,
      ),
      this.tasksPanelEl,
    );
    this.layersPanelEl = h(
      'div',
      { class: 'map-studio__dock-panel map-studio__layers-panel' },
      this.layersEl,
      h('div', { class: 'map-layers__toolbar' }, newGroupBtn, newVectorBtn, moveLayerUpBtn, moveLayerDownBtn, deleteLayerBtn),
    );

    this.el = h(
      'aside',
      { class: 'map-studio', hidden: true, role: 'region', attrs: { 'aria-label': '属性与图层面板' } },
      h(
        'div',
        { class: 'map-studio__dock-tabs' },
        h('button', { class: 'map-studio__tab', type: 'button', text: '属性检查器', attrs: { 'data-inspector-tab': 'inspector' }, on: { click: () => this.setInspectorTab('inspector') } }),
        collapseBtn,
      ),
      this.inspectorPanelEl,
      h(
        'div',
        { class: 'map-studio__dock-tabs map-studio__dock-tabs--bottom' },
        h('button', { class: 'map-studio__tab', type: 'button', text: '地图图层', attrs: { 'data-bottom-tab': 'layers' }, on: { click: () => this.setBottomTab('layers') } }),
      ),
      this.layersPanelEl,
      h('div', { class: 'map-studio__foot' }, this.statusEl),
    );
    this.aiDockEl = h(
      'section',
      { class: 'map-ai-dock', hidden: true, attrs: { 'aria-label': 'AI 辅助工作台' } },
      h(
        'div',
        { class: 'map-ai-dock__bar' },
        h('button', { class: 'map-ai-dock__title map-ai-dock__title-btn', type: 'button', text: 'AI 辅助工作台', attrs: { 'aria-expanded': 'false' }, on: { click: () => this.setAiDockOpen(!this.aiDockOpen) } }),
        this.boxCountEl,
        h('div', { class: 'map-ai-dock__actions' }, this.sendAiBtn, clearSelBtn),
        h('button', { class: 'map-ai-dock__toggle', type: 'button', text: '展开', on: { click: () => this.setAiDockOpen(!this.aiDockOpen) } }),
      ),
      this.aiPanelEl,
    );

    this.setInspectorTab('inspector');
    this.setBottomTab('layers');
    this.setTool('select');
    this.renderDraftBoxes();
    this.renderTasks();
    this.renderPresence();
    this.renderInspector();
    this.renderLayers();
    this.renderReferencePanel();

    addEventListener('pointerdown', (e) => {
      if (!this.isOpen) return;
      const target = e.target as HTMLElement | null;
      const currentMenu = target?.closest('.map-workspace__menu');
      for (const open of this.menuBarEl.querySelectorAll<HTMLDetailsElement>('.map-workspace__menu[open]')) {
        if (open !== currentMenu) open.removeAttribute('open');
      }
      if (!target?.closest('.map-studio__mcp-popover') && !target?.closest('.map-studio__mcp-toggle')) this.setPairingOpen(false);
    }, { capture: true });
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const k = e.key.toLowerCase();
      if (k === ' ' && this.spacePanning) {
        e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const arrow = { arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] }[k] as [number, number] | undefined;
      if (arrow && this.tool === 'select' && this.selectedElement && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const position = this.selectedPosition();
        if (position) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.setSelectedPosition(position.x + arrow[0], position.y + arrow[1]);
        }
        return;
      }
      if (k === ' ') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        this.spacePanning = true;
        this.dragStart = null;
        this.syncCursor();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
        e.preventDefault();
        void this.remoteUndoRedo(k === 'z' && !e.shiftKey ? 'undo' : 'redo');
        return;
      }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'r' && this.tool === 'desk4') {
        e.preventDefault();
        const nextIdx = (DIR_ORDER.indexOf(this.deskDir) + 1) % DIR_ORDER.length;
        this.deskDir = DIR_ORDER[nextIdx];
        this.renderSubOptions();
        return;
      }
      const shortcuts: Record<string, EditorTool> = {
        v: 'select',
        b: 'box',
        h: 'pan',
        k: 'desk4',
        m: 'room',
        f: 'floor',
        l: 'road',
        g: 'wall',
        p: 'furn',
        u: 'measure',
        z: 'zone',
        e: 'erase',
      };
      const tool = shortcuts[k];
      if (tool) {
        e.preventDefault();
        this.setTool(tool);
      }
    }, { capture: true });
    addEventListener('keyup', (e) => {
      if (!this.isOpen || e.key !== ' ' || !this.spacePanning) return;
      e.preventDefault();
      this.spacePanning = false;
      this.panDrag = null;
      this.syncCursor();
    });
    addEventListener('blur', () => {
      if (!this.isOpen) return;
      this.spacePanning = false;
      this.panDrag = null;
      this.syncCursor();
    });
  }

  get opened(): boolean {
    return this.isOpen;
  }

  get panelCollapsed(): boolean {
    return this.collapsed;
  }

  private setUiFontSize(size: UiFontSize): void {
    this.uiFontSize = size;
    this.ctx.root.style.setProperty('--map-ui-font-size', `${size}px`);
    try {
      localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, String(size));
    } catch {}
  }

  private setInspectorTab(tab: 'inspector' | 'ai'): void {
    this.activeInspectorTab = tab;
    this.inspectorPanelEl.hidden = tab !== 'inspector';
    this.aiPanelEl.hidden = tab !== 'ai';
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]')) {
      btn.classList.toggle('is-active', btn.dataset.inspectorTab === tab);
    }
  }

  private setBottomTab(tab: 'layers' | 'tasks'): void {
    this.activeBottomTab = tab;
    this.layersPanelEl.hidden = tab !== 'layers';
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-bottom-tab]')) {
      btn.classList.toggle('is-active', btn.dataset.bottomTab === tab);
    }
  }

  private setAiDockOpen(open: boolean): void {
    this.aiDockOpen = open;
    const height = open ? Math.round(Math.min(window.innerHeight * 0.52, 440)) : 36;
    this.aiDockEl.classList.toggle('is-open', open);
    this.aiDockEl.style.height = `${height}px`;
    this.aiPanelEl.hidden = !open;
    const toggle = this.aiDockEl.querySelector<HTMLElement>('.map-ai-dock__toggle');
    if (toggle) toggle.textContent = open ? '收起' : '展开';
    this.aiDockEl.querySelector('.map-ai-dock__title-btn')?.setAttribute('aria-expanded', String(open));
    this.ctx.root.style.setProperty('--ai-dock-height', `${height}px`);
    this.onLayoutChange?.();
    this.world.editor?.fitMap();
  }

  private setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.el.classList.toggle('is-collapsed', collapsed);
    const btn = this.el.querySelector<HTMLButtonElement>('.map-studio__collapse-btn');
    if (btn) {
      btn.textContent = collapsed ? '«' : '»';
      btn.title = collapsed ? '展开地图工坊' : '收起地图工坊';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-expanded', String(!collapsed));
    }
    if (collapsed) this.setPairingOpen(false);
    this.onLayoutChange?.();
    if (!collapsed) this.world.editor?.fitMap();
  }

  private setPairingOpen(open: boolean): void {
    this.pairingOpen = open;
    this.pairingDrawerEl.hidden = !open;
    const btn = this.menuBarEl.querySelector<HTMLButtonElement>('.map-studio__mcp-toggle');
    btn?.setAttribute('aria-expanded', String(open));
  }

  private syncCursor(): void {
    if (this.panDrag) {
      this.world.editor?.setCursor('grabbing');
      return;
    }
    if (this.spacePanning || this.tool === 'pan') {
      this.world.editor?.setCursor('grab');
      return;
    }
    if (this.tool === 'select') {
      this.world.editor?.setCursor(this.dragStart ? 'move' : 'default');
      return;
    }
    const cursors: Record<EditorTool, string> = {
      select: 'default',
      box: 'crosshair',
      floor: 'cell',
      room: 'cell',
      wall: 'crosshair',
      desk4: 'copy',
      furn: 'copy',
      zone: 'cell',
      road: 'crosshair',
      measure: 'ew-resize',
      erase: ERASE_CURSOR,
      pan: 'grab',
    };
    this.world.editor?.setCursor(cursors[this.tool]);
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
    this.toolbarEl.hidden = false;
    this.menuBarEl.hidden = false;
    this.contextBarEl.hidden = false;
    this.viewportTabsEl.hidden = false;
    this.viewportStatusEl.hidden = false;
    this.aiDockEl.hidden = false;
    this.setAiDockOpen(this.aiDockOpen);
    this.worldOptionsBefore = this.world.getOptions();
    this.world.setOptions({ bubbles: 'none', showNames: false });
    this.world.editor?.setBackground('#181818');
    this.publishAdminBtn.hidden = !getSessionAdminKey();
    this.setStatus('正在恢复或创建专属工坊会话…');
    this.syncCursor();
    this.onLayoutChange?.();

    const editor = this.world.editor;
    if (editor) {
      editor.setPointerIntercept((ev, kind, tile) => this.handleCanvasPointer(ev, kind, tile));
      this.offBeforeFrame = editor.onBeforeFrame((ctx) => this.drawReferenceImage(ctx));
      this.offAfterFrame = editor.onAfterFrame((ctx, view) => {
        this.zoomEl.textContent = `${Math.round(view.zoom * 100)}%`;
        this.drawCanvasOverlay(ctx, view);
      });
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
    this.toolbarEl.hidden = true;
    this.menuBarEl.hidden = true;
    this.contextBarEl.hidden = true;
    this.viewportTabsEl.hidden = true;
    this.viewportStatusEl.hidden = true;
    this.aiDockEl.hidden = true;
    this.reviewFloatEl.hidden = true;
    this.setPairingOpen(false);
    this.dragStart = null;
    this.hoverTile = null;
    this.spacePanning = false;
    this.panDrag = null;
    this.world.editor?.setCursor(null);
    if (this.presencePollTimer) {
      clearInterval(this.presencePollTimer);
      this.presencePollTimer = null;
    }
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    if (this.offBeforeFrame) {
      this.offBeforeFrame();
      this.offBeforeFrame = null;
    }
    if (this.offAfterFrame) {
      this.offAfterFrame();
      this.offAfterFrame = null;
    }
    this.world.editor?.setPointerIntercept(null);
    this.world.editor?.setBackground(null);
    this.world.editor?.setCustomMapPreview(null, { lockLiveSync: false });
    if (this.worldOptionsBefore) {
      this.world.setOptions(this.worldOptionsBefore);
      this.worldOptionsBefore = null;
    }
    this.onLayoutChange?.();
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
      this.setStatus('工坊就绪：可框选地图并创建 AI 修改任务');
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
    const sizeChanged = this.doc?.width !== doc.width || this.doc?.height !== doc.height;
    if (!this.activeProjectId) this.activeProjectId = doc.id;
    this.doc = cloneDoc(doc);
    const tab = this.projectTabs.find((t) => t.id === this.activeProjectId);
    if (tab) tab.doc = cloneDoc(doc);
    else this.projectTabs.push({ id: this.activeProjectId, doc: cloneDoc(doc) });
    this.nameInput.value = doc.name;
    this.widthInput.value = String(doc.width);
    this.heightInput.value = String(doc.height);
    this.projectNameEl.textContent = `${doc.name} · ${doc.width}×${doc.height}`;
    this.saveStateEl.textContent = this.sessionId ? `已保存 · v${this.sessionRev}` : '本地编辑';
    if (this.selectedElement && !this.findMapElement(this.selectedElement)) this.selectedElement = null;
    this.applyPreview(this.doc, patchRect);
    this.refreshStats();
    this.renderProjectTabs();
    this.renderInspector();
    this.renderLayers();
    if (sizeChanged) this.world.editor?.fitMap();
  }

  private applyPreview(doc: CustomMapDocument, patchRect?: TileRect): void {
    const editor = this.world.editor;
    if (!editor) return;
    const preview = cloneDoc(doc);
    const visible = (group: string, kind: string, id: string) => !this.hiddenLayers.has(`group:${group}`) && !this.hiddenLayers.has(`${kind}:${id}`);
    preview.zones = preview.zones.filter((item) => visible('zones', 'zone', item.id));
    preview.furniture = preview.furniture.filter((item) => visible('furniture', 'furniture', item.id));
    preview.walls = preview.walls.filter((item) => visible('walls', 'wall', item.id));
    preview.wallItems = preview.wallItems.filter((item) => visible('walls', 'wallItem', item.id));
    preview.rugs = preview.rugs.filter((item) => visible('rugs', 'rug', item.id));
    preview.spawns = preview.spawns.filter((item) => visible('spawns', 'spawn', item.id));
    editor.setCustomMapPreview(preview, { lockLiveSync: true });
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
    this.statusEl.title = msg;
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
    this.renderPairingInfo();

    if (runningTask) {
      this.presenceTextEl.textContent = `AI 正在执行 #T${runningTask.seq}…`;
      this.presenceSubEl.textContent = '正在修改当前选区，可继续框选后续任务';
    } else if (p.listening) {
      this.presenceTextEl.textContent = 'AI 已连接 · 等待任务';
      this.presenceSubEl.textContent = `${p.clientName || 'AI 客户端'} · 当前草稿 #${shortSid}`;
    } else if (p.connected) {
      this.presenceTextEl.textContent = `AI 已连接 (${p.clientName || 'AI 客户端'})`;
      this.presenceSubEl.textContent = '连接已建立，等待 AI 开始接收任务';
    } else {
      this.presenceTextEl.textContent = 'AI 未连接';
      this.presenceSubEl.textContent = '未连接时，选区会保留在当前草稿';
    }
    this.renderSendButton();
  }

  private renderSendButton(): void {
    const running = this.tasks.some((t) => t.status === 'running');
    const n = this.draftBoxes.length;
    this.sendAiBtn.disabled = n === 0;
    this.sendAiBtn.textContent = running ? `加入队列 (${n})` : `发给 AI (${n})`;
  }

  private renderDraftBoxes(): void {
    this.boxCountEl.textContent = `已选 ${this.draftBoxes.length} 个区块`;
    this.draftBoxesEl.innerHTML = '';
    if (!this.draftBoxes.length) {
      this.draftBoxesEl.append(
        h('div', {
          class: 'map-studio__badge',
          text: '按 B 切换框选，在画布拖拽可连续选择多个区块；填好需求后一键发送。',
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
      this.setStatus('请先按 B 切换框选，在画布拖选至少 1 个区块');
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

  private createProjectTab(): void {
    const id = `map-${Date.now().toString(36)}`;
    const doc = createBlankCustomMap(`未命名地图 ${this.projectTabs.length + 1}`, 96, 64, id);
    doc.rugs = [];
    doc.walls = [];
    doc.wallItems = [];
    doc.zones = [];
    doc.furniture = doc.furniture.filter((item) => item.kind === 'entrance_mat');
    this.projectTabs.push({ id, doc });
    this.switchProjectTab(id);
  }

  private switchProjectTab(id: string): void {
    if (id === this.activeProjectId) return;
    const tab = this.projectTabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeProjectId = id;
    this.selectedElement = null;
    this.applyDocState(tab.doc);
    this.commitLocalEdit({ x: 0, y: 0, w: tab.doc.width, h: tab.doc.height });
  }

  private closeProjectTab(id: string): void {
    if (this.projectTabs.length <= 1) {
      this.setStatus('至少保留一个地图草稿');
      return;
    }
    const index = this.projectTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.projectTabs.splice(index, 1);
    if (this.activeProjectId === id) {
      const next = this.projectTabs[Math.max(0, index - 1)] ?? this.projectTabs[0];
      this.switchProjectTab(next.id);
    } else {
      this.renderProjectTabs();
    }
    this.setStatus('已关闭地图草稿');
  }

  private renderProjectTabs(): void {
    this.projectTabsEl.innerHTML = '';
    for (const tab of this.projectTabs) {
      const closeBtn = h('button', {
        class: 'map-viewport__tab-close',
        type: 'button',
        text: '×',
        attrs: { title: this.projectTabs.length <= 1 ? '至少保留一个地图草稿' : `关闭 ${tab.doc.name}`, 'aria-label': `关闭 ${tab.doc.name}`, disabled: this.projectTabs.length <= 1 },
        on: {
          click: (ev) => {
            ev.stopPropagation();
            this.closeProjectTab(tab.id);
          },
        },
      });
      this.projectTabsEl.append(h(
        'div',
        { class: `map-viewport__tab-wrap${tab.id === this.activeProjectId ? ' is-active' : ''}` },
        h('button', {
          class: `map-viewport__tab${tab.id === this.activeProjectId ? ' is-active' : ''}`,
          type: 'button',
          text: tab.doc.name,
          attrs: { title: `${tab.doc.name} · ${tab.doc.width}×${tab.doc.height}` },
          on: { click: () => this.switchProjectTab(tab.id) },
        }),
        closeBtn,
      ));
    }
  }

  private findMapElement(selection: SelectedMapElement | null): unknown {
    if (selection?.kind === 'reference') return this.referenceImage;
    if (!this.doc || !selection) return null;
    if (selection.kind === 'zone') return this.doc.zones.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === 'furniture') return this.doc.furniture.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === 'wall') return this.doc.walls.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === 'wallItem') return this.doc.wallItems.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === 'rug') return this.doc.rugs.find((item) => item.id === selection.id) ?? null;
    return this.doc.spawns.find((item) => item.id === selection.id) ?? null;
  }

  private selectMapElement(kind: MapElementKind, id: string): void {
    this.selectedElement = { kind, id };
    if (kind === 'reference') {
      this.setInspectorTab('inspector');
      this.renderInspector();
      return;
    }
    const group = kind === 'zone' ? 'zones' : kind === 'furniture' ? 'furniture' : kind === 'rug' ? 'rugs' : kind === 'spawn' ? 'spawns' : 'walls';
    this.collapsedGroups.delete(group);
    this.setInspectorTab('inspector');
    this.renderInspector();
    this.renderLayers();
    const row = [...this.layersEl.querySelectorAll<HTMLElement>('[data-layer-kind][data-layer-id]')].find((el) => el.dataset.layerKind === kind && el.dataset.layerId === id);
    row?.scrollIntoView({ block: 'nearest' });
  }

  private furnitureRect(item: CustomMapDocument['furniture'][number]): TileRect {
    const visual = this.world.editor?.getFurnitureVisualRect(item.id);
    if (visual) return visual;
    const fp = FURNITURE[item.kind]?.footprint ?? { w: 1, h: 1 };
    return { x: item.tx, y: item.ty, w: fp.w, h: fp.h };
  }

  private selectedPosition(): { x: number; y: number } | null {
    const selection = this.selectedElement;
    const item = this.findMapElement(selection) as Record<string, unknown> | null;
    if (!selection || !item) return null;
    if (selection.kind === 'reference') {
      const ref = item as unknown as ReferenceImageState;
      return { x: ref.x, y: ref.y };
    }
    if (selection.kind === 'zone') {
      const rect = item.rect as TileRect;
      return { x: rect.x, y: rect.y };
    }
    if (selection.kind === 'rug') return { x: item.x as number, y: item.y as number };
    return { x: item.tx as number, y: item.ty as number };
  }

  private wallItemRect(item: CustomMapDocument['wallItems'][number]): TileRect {
    const visual = this.world.editor?.getWallItemVisualRect(item.id);
    if (visual) return visual;
    return { x: Math.floor(item.tx), y: Math.floor(item.ty) - 1, w: 1, h: 2 };
  }

  private selectedRect(): TileRect | null {
    const selection = this.selectedElement;
    const item = this.findMapElement(selection) as Record<string, unknown> | null;
    if (!selection || !item) return null;
    if (selection.kind === 'reference') {
      const ref = item as unknown as ReferenceImageState;
      return { x: ref.x, y: ref.y, w: ref.w, h: ref.h };
    }
    if (selection.kind === 'zone') return { ...(item.rect as TileRect) };
    if (selection.kind === 'rug') return { x: item.x as number, y: item.y as number, w: item.w as number, h: item.h as number };
    if (selection.kind === 'wall') {
      const h = item.kind === 'face' ? 2 : item.kind === 'south' ? 1 : (item.h as number);
      return { x: item.tx as number, y: item.ty as number, w: item.w as number, h };
    }
    if (selection.kind === 'wallItem') return this.wallItemRect(item as unknown as CustomMapDocument['wallItems'][number]);
    if (selection.kind === 'furniture') return this.furnitureRect(item as unknown as CustomMapDocument['furniture'][number]);
    return { x: item.tx as number, y: item.ty as number, w: 1, h: 1 };
  }

  private isElementLocked(kind: MapElementKind, id: string): boolean {
    if (kind === 'reference') return this.referenceImage?.locked ?? false;
    const group = kind === 'zone' ? 'zones' : kind === 'furniture' ? 'furniture' : kind === 'rug' ? 'rugs' : kind === 'spawn' ? 'spawns' : 'walls';
    return this.lockedLayers.has(`group:${group}`) || this.lockedLayers.has(`${kind}:${id}`);
  }

  private toggleLayerVisibility(key: string): void {
    if (this.hiddenLayers.has(key)) this.hiddenLayers.delete(key);
    else this.hiddenLayers.add(key);
    if (this.doc) this.applyPreview(this.doc);
    this.renderLayers();
  }

  private toggleLayerLock(key: string): void {
    if (this.lockedLayers.has(key)) this.lockedLayers.delete(key);
    else this.lockedLayers.add(key);
    this.renderLayers();
    this.renderInspector();
  }

  private addZoneLayer(): void {
    if (!this.doc) return;
    const w = Math.min(12, this.doc.width);
    const h = Math.min(8, this.doc.height);
    const id = `zone-${Date.now().toString(36)}`;
    this.doc.zones.push({ id, name: `区域 ${this.doc.zones.length + 1}`, kind: 'room', rect: { x: Math.max(0, Math.floor((this.doc.width - w) / 2)), y: Math.max(0, Math.floor((this.doc.height - h) / 2)), w, h }, hasLightSwitch: true });
    this.selectMapElement('zone', id);
    this.commitLocalEdit(this.doc.zones[this.doc.zones.length - 1].rect);
  }

  private addRugLayer(): void {
    if (!this.doc) return;
    const w = Math.min(8, this.doc.width);
    const h = Math.min(6, this.doc.height);
    const id = `rug-${Date.now().toString(36)}`;
    const rect = { x: Math.max(0, Math.floor((this.doc.width - w) / 2)), y: Math.max(0, Math.floor((this.doc.height - h) / 2)), w, h };
    this.doc.rugs.push({ id, ...rect, color: '#2680EB' });
    this.selectMapElement('rug', id);
    this.commitLocalEdit(rect);
  }

  private reorderSelectedLayer(direction: -1 | 1): void {
    const selection = this.selectedElement;
    if (selection?.kind === 'reference') return;
    if (!this.doc || !selection || this.isElementLocked(selection.kind, selection.id)) return;
    const list = selection.kind === 'zone' ? this.doc.zones : selection.kind === 'furniture' ? this.doc.furniture : selection.kind === 'wall' ? this.doc.walls : selection.kind === 'wallItem' ? this.doc.wallItems : selection.kind === 'rug' ? this.doc.rugs : this.doc.spawns;
    const index = list.findIndex((item) => item.id === selection.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]];
    this.commitLocalEdit(this.selectedRect() ?? undefined);
  }

  private deleteSelectedLayer(): void {
    const selection = this.selectedElement;
    if (selection?.kind === 'reference') {
      this.clearReferenceImage();
      return;
    }
    if (!this.doc || !selection || this.isElementLocked(selection.kind, selection.id)) return;
    const rect = this.selectedRect() ?? undefined;
    if (selection.kind === 'zone') this.doc.zones = this.doc.zones.filter((item) => item.id !== selection.id);
    else if (selection.kind === 'furniture') this.doc.furniture = this.doc.furniture.filter((item) => item.id !== selection.id);
    else if (selection.kind === 'wall') this.doc.walls = this.doc.walls.filter((item) => item.id !== selection.id);
    else if (selection.kind === 'wallItem') this.doc.wallItems = this.doc.wallItems.filter((item) => item.id !== selection.id);
    else if (selection.kind === 'rug') this.doc.rugs = this.doc.rugs.filter((item) => item.id !== selection.id);
    else this.doc.spawns = this.doc.spawns.filter((item) => item.id !== selection.id);
    this.selectedElement = null;
    this.commitLocalEdit(rect);
  }

  private async loadReferenceImage(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.setStatus('请选择图片文件');
      return;
    }
    const src = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (this.referenceImage) URL.revokeObjectURL(this.referenceImage.src);
      const naturalW = image.naturalWidth / TILE;
      const naturalH = image.naturalHeight / TILE;
      const mapW = this.doc?.width ?? 96;
      const mapH = this.doc?.height ?? 64;
      const scale = Math.min(1, (mapW * 0.6) / naturalW, (mapH * 0.6) / naturalH);
      const w = naturalW * scale;
      const h = naturalH * scale;
      this.referenceImage = {
        id: 'reference',
        name: file.name,
        src,
        image,
        x: (mapW - w) / 2,
        y: (mapH - h) / 2,
        w,
        h,
        opacity: 0.35,
        visible: true,
        locked: false,
      };
      this.selectMapElement('reference', 'reference');
      this.renderReferencePanel();
      this.setStatus('已添加本地参考图，未上传服务器');
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      this.setStatus('图片读取失败');
    };
    image.src = src;
  }

  private clearReferenceImage(): void {
    if (!this.referenceImage) return;
    URL.revokeObjectURL(this.referenceImage.src);
    this.referenceImage = null;
    if (this.selectedElement?.kind === 'reference') this.selectedElement = null;
    this.renderReferencePanel();
    this.renderInspector();
    this.setStatus('已移除参考图');
  }

  private renderReferencePanel(): void {
    this.referencePanelEl.innerHTML = '';
    const ref = this.referenceImage;
    const addBtn = h('button', { class: 'map-studio__btn', type: 'button', text: ref ? '替换参考图' : '添加参考图', on: { click: () => this.referenceFileInput.click() } });
    this.referencePanelEl.append(h('div', { class: 'map-studio__section-title' }, h('span', { text: '参考图（仅本地）' }), addBtn));
    if (!ref) {
      this.referencePanelEl.append(h('div', { class: 'map-studio__badge', text: '用于对照编辑，不会上传或写入地图 JSON' }));
      return;
    }
    const deleteBtn = h('button', { class: 'map-studio__btn', type: 'button', text: '移除', on: { click: () => this.clearReferenceImage() } });
    const lockBtn = h('button', { class: 'map-studio__btn', type: 'button', text: ref.locked ? '解锁' : '锁定', on: { click: () => {
      ref.locked = !ref.locked;
      this.renderReferencePanel();
      this.renderInspector();
    } } });
    const visibleBtn = h('button', { class: 'map-studio__btn', type: 'button', text: ref.visible ? '隐藏' : '显示', on: { click: () => {
      ref.visible = !ref.visible;
      this.renderReferencePanel();
    } } });
    const opacityValue = h('span', { class: 'map-reference__opacity-value', text: `${Math.round(ref.opacity * 100)}%` });
    const opacity = h('input', { class: 'map-reference__opacity', attrs: { type: 'range', min: '0', max: '1', step: '0.01', value: String(ref.opacity), 'aria-label': '参考图不透明度' }, on: {
      input: () => {
        ref.opacity = Number((opacity as HTMLInputElement).value);
        opacityValue.textContent = `${Math.round(ref.opacity * 100)}%`;
      },
      change: () => this.renderInspector(),
    } });
    this.referencePanelEl.append(
      h('div', { class: 'map-reference__name', text: ref.name, attrs: { title: ref.name } }),
      h('div', { class: 'map-reference__opacity-row' }, opacity, opacityValue),
      h('div', { class: 'map-studio__row' }, lockBtn, visibleBtn, deleteBtn),
    );
  }

  private renderInspector(): void {
    this.inspectorEl.innerHTML = '';
    const selection = this.selectedElement;
    const item = this.findMapElement(selection);
    if (!this.doc || !selection || !item) {
      this.inspectorEl.append(h('div', { class: 'map-inspector__empty', text: '在画布或图层树中选择一个地图元素' }));
      return;
    }
    const locked = this.isElementLocked(selection.kind, selection.id);
    const field = (label: string, control: HTMLElement) => h('label', { class: 'map-inspector__field' }, h('span', { text: label }), control);
    const text = (label: string, value: string, change?: (value: string) => void) => {
      const input = h('input', { class: 'map-studio__input', attrs: { type: 'text', value, readonly: !change }, on: { change: () => change?.((input as HTMLInputElement).value) } });
      this.inspectorEl.append(field(label, input));
    };
    const number = (label: string, value: number, change: (value: number) => void) => {
      const input = h('input', { class: 'map-studio__input', attrs: { type: 'number', value: String(value), step: '1' }, on: { change: () => change(Number((input as HTMLInputElement).value) || 0) } });
      this.inspectorEl.append(field(label, input));
    };
    const color = (label: string, value: string | undefined, change: (value: string) => void) => {
      const input = h('input', { class: 'map-studio__color', attrs: { type: 'color', value: value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2680EB' }, on: { change: () => change((input as HTMLInputElement).value) } });
      this.inspectorEl.append(field(label, input));
    };
    const select = <T extends string>(label: string, value: T, options: readonly [T, string][], change: (value: T) => void) => {
      const input = h('select', { class: 'map-studio__select', on: { change: () => change((input as HTMLSelectElement).value as T) } }) as HTMLSelectElement;
      for (const [id, labelText] of options) input.append(h('option', { text: labelText, attrs: { value: id, selected: id === value } }));
      this.inspectorEl.append(field(label, input));
    };
    const position = this.selectedPosition();
    const heading = selection.kind === 'furniture' || selection.kind === 'wallItem' ? furnitureLabel((item as { kind: FurnitureKind }).kind) : selection.kind;
    this.inspectorEl.append(h('div', { class: 'map-inspector__heading', text: `当前选中：${heading}` }));
    text('名称 ID', selection.id);
    if (position) {
      number('X', position.x, (x) => this.setSelectedPosition(x, position.y));
      number('Y', position.y, (y) => this.setSelectedPosition(position.x, y));
    }
    if (selection.kind === 'reference') {
      const ref = item as unknown as ReferenceImageState;
      text('参考图名称', ref.name, (value) => { ref.name = value.trim() || ref.name; this.renderReferencePanel(); });
      text('图片尺寸', `${ref.w.toFixed(1)} × ${ref.h.toFixed(1)} 格`);
      const opacityValue = h('span', { text: `${Math.round(ref.opacity * 100)}%` });
      const opacity = h('input', { class: 'map-reference__opacity', attrs: { type: 'range', min: '0', max: '1', step: '0.01', value: String(ref.opacity), 'aria-label': '参考图不透明度' }, on: {
        input: () => {
          ref.opacity = Number((opacity as HTMLInputElement).value);
          opacityValue.textContent = `${Math.round(ref.opacity * 100)}%`;
          this.renderReferencePanel();
        },
      } });
      this.inspectorEl.append(field('不透明度', h('div', { class: 'map-reference__opacity-row' }, opacity, opacityValue)));
    } else if (selection.kind === 'zone') {
      const zone = item as CustomMapDocument['zones'][number];
      text('区域名称', zone.name, (value) => { zone.name = value.trim() || zone.name; this.commitLocalEdit(zone.rect); });
      select('区域类型', zone.kind, ZONES.map((z) => [z.kind, z.label] as [AreaKind, string]), (value) => { zone.kind = value; this.commitLocalEdit(zone.rect); });
      color('填充色', zone.floorTint, (value) => { zone.floorTint = value; this.commitLocalEdit(zone.rect); });
      color('描边色', zone.accentColor, (value) => { zone.accentColor = value; this.commitLocalEdit(zone.rect); });
      text('自定义标签', (zone.tags ?? []).join(', '), (value) => { zone.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean); this.commitLocalEdit(zone.rect); });
    } else if (selection.kind === 'furniture') {
      const furniture = item as CustomMapDocument['furniture'][number];
      text('POI 类型', furniture.kind);
      const chairDir = OFFICE_CHAIR_DIR_BY_KIND.get(furniture.kind);
      const deskDir = DESK_DIR_BY_KIND.get(furniture.kind);
      const directionalVariant = furniture.kind === 'cafe_chair' || furniture.kind === 'armchair' || furniture.kind === 'sofa';
      const direction = chairDir ?? deskDir ?? (directionalVariant ? ((furniture.variant as Dir | undefined) ?? 'down') : undefined);
      if (direction) {
        const directions = furniture.kind === 'sofa' ? (['up', 'down'] as Dir[]) : DIR_ORDER;
        select('旋转角度', direction, directions.map((d) => [d, DIR_LABELS[d]] as [Dir, string]), (value) => {
          if (chairDir) furniture.kind = OFFICE_CHAIR_KIND_BY_DIR[value];
          else if (deskDir) furniture.kind = DESK_KIND_BY_DIR[value];
          else furniture.variant = value;
          furniture.dir = value;
          const fp = FURNITURE[furniture.kind].footprint;
          if (this.doc) {
            furniture.tx = Math.max(0, Math.min(this.doc.width - fp.w, furniture.tx));
            furniture.ty = Math.max(0, Math.min(this.doc.height - fp.h, furniture.ty));
          }
          this.commitLocalEdit();
        });
      }
      if (furniture.kind === 'entrance_mat') {
        select('出生朝向', furniture.dir ?? 'down', DIR_ORDER.map((d) => [d, DIR_LABELS[d]] as [Dir, string]), (value) => { furniture.dir = value; this.commitLocalEdit(); });
      }
      const variants = FURNITURE[furniture.kind].variants;
      if (variants?.length && !directionalVariant) {
        const current = furniture.variant && variants.includes(furniture.variant) ? furniture.variant : variants[0];
        select('填充 / 样式', current, variants.map((variant) => [variant, variant] as [string, string]), (value) => { furniture.variant = value; this.commitLocalEdit(); });
      }
      text('自定义标签', (furniture.tags ?? []).join(', '), (value) => { furniture.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean); this.commitLocalEdit(); });
    } else if (selection.kind === 'wall') {
      const wall = item as CustomMapDocument['walls'][number];
      text('墙体类型', wall.kind);
      color('填充色', wall.style.base, (value) => { wall.style.base = value; this.commitLocalEdit(); });
      color('描边色', wall.style.trim, (value) => { wall.style.trim = value; this.commitLocalEdit(); });
      select('描边样式', wall.style.pattern ?? 'plain', [['plain', '实色'], ['stripes', '条纹'], ['tiles', '砖块'], ['wood_panel', '木板'], ['brick', '砖墙'], ['glass', '玻璃'], ['marble', '大理石']], (value) => { wall.style.pattern = value; this.commitLocalEdit(); });
    } else if (selection.kind === 'wallItem') {
      const wallItem = item as CustomMapDocument['wallItems'][number];
      text('挂件类型', wallItem.kind);
      select('安装墙面', wallItem.on, [['face', '北墙面'], ['south', '南墙面']], (value) => { wallItem.on = value; this.commitLocalEdit(); });
      const variants = FURNITURE[wallItem.kind].variants;
      if (variants?.length) {
        const current = wallItem.variant && variants.includes(wallItem.variant) ? wallItem.variant : variants[0];
        select('填充 / 样式', current, variants.map((variant) => [variant, variant] as [string, string]), (value) => { wallItem.variant = value; this.commitLocalEdit(); });
      }
    } else if (selection.kind === 'rug') {
      const rug = item as CustomMapDocument['rugs'][number];
      color('填充色', rug.color, (value) => { rug.color = value; this.commitLocalEdit(); });
    } else {
      const spawn = item as CustomMapDocument['spawns'][number];
      select('出生朝向', spawn.dir ?? 'up', DIR_ORDER.map((d) => [d, DIR_LABELS[d]] as [Dir, string]), (value) => { spawn.dir = value; this.commitLocalEdit(); });
    }
    if (locked) {
      for (const input of this.inspectorEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) input.disabled = true;
    }
  }

  private setSelectedPosition(x: number, y: number): void {
    const selection = this.selectedElement;
    const item = this.findMapElement(selection);
    if (!this.doc || !selection || !item || this.isElementLocked(selection.kind, selection.id)) return;
    if (selection.kind === 'reference') {
      const ref = item as unknown as ReferenceImageState;
      ref.x = Math.max(0, Math.min(this.doc.width - ref.w, x));
      ref.y = Math.max(0, Math.min(this.doc.height - ref.h, y));
      this.renderInspector();
      this.renderReferencePanel();
      return;
    }
    if (selection.kind === 'zone') {
      const zone = item as CustomMapDocument['zones'][number];
      zone.rect.x = Math.max(0, Math.min(this.doc.width - zone.rect.w, Math.round(x)));
      zone.rect.y = Math.max(0, Math.min(this.doc.height - zone.rect.h, Math.round(y)));
    } else if (selection.kind === 'furniture') {
      const furniture = item as CustomMapDocument['furniture'][number];
      const fp = FURNITURE[furniture.kind]?.footprint ?? { w: 1, h: 1 };
      furniture.tx = Math.max(0, Math.min(this.doc.width - fp.w, Math.round(x)));
      furniture.ty = Math.max(0, Math.min(this.doc.height - fp.h, Math.round(y)));
    } else if (selection.kind === 'wall') {
      const wall = item as CustomMapDocument['walls'][number];
      wall.tx = Math.max(0, Math.min(this.doc.width - wall.w, Math.round(x)));
      wall.ty = Math.max(0, Math.min(this.doc.height - wall.h, Math.round(y)));
    } else if (selection.kind === 'wallItem') {
      const wallItem = item as CustomMapDocument['wallItems'][number];
      wallItem.tx = Math.max(0, Math.min(this.doc.width, Math.round(x)));
      wallItem.ty = Math.max(0, Math.min(this.doc.height, Math.round(y)));
    } else if (selection.kind === 'rug') {
      const rug = item as CustomMapDocument['rugs'][number];
      rug.x = Math.max(0, Math.min(this.doc.width - rug.w, Math.round(x)));
      rug.y = Math.max(0, Math.min(this.doc.height - rug.h, Math.round(y)));
    } else {
      const spawn = item as CustomMapDocument['spawns'][number];
      spawn.tx = Math.max(0, Math.min(this.doc.width - 1, Math.round(x)));
      spawn.ty = Math.max(0, Math.min(this.doc.height - 1, Math.round(y)));
    }
    this.commitLocalEdit();
  }

  private renderLayers(): void {
    this.layersEl.innerHTML = '';
    if (!this.doc) return;
    const groups = [
      { id: 'zones', label: '功能区域', items: this.doc.zones.map((item) => ({ kind: 'zone' as const, id: item.id, name: item.name, icon: 'terrain' })) },
      { id: 'walls', label: '墙体与挂件', items: [...this.doc.walls.map((item) => ({ kind: 'wall' as const, id: item.id, name: `墙体 · ${item.kind}`, icon: 'wall' })), ...this.doc.wallItems.map((item) => ({ kind: 'wallItem' as const, id: item.id, name: furnitureLabel(item.kind), icon: 'poi' }))] },
      { id: 'furniture', label: 'POI 与家具', items: this.doc.furniture.map((item) => ({ kind: 'furniture' as const, id: item.id, name: furnitureLabel(item.kind), icon: 'poi' })) },
      { id: 'rugs', label: '矢量地毯', items: this.doc.rugs.map((item) => ({ kind: 'rug' as const, id: item.id, name: '矢量地毯', icon: 'terrain' })) },
      { id: 'spawns', label: '出生点', items: this.doc.spawns.map((item) => ({ kind: 'spawn' as const, id: item.id, name: '出生点', icon: 'select' })) },
    ];
    const action = (name: string, label: string, onClick: () => void) => {
      const btn = h('button', { class: 'map-layers__action', type: 'button', attrs: { title: label, 'aria-label': label }, on: { click: (ev) => { ev.stopPropagation(); onClick(); } } });
      btn.innerHTML = icon(name);
      return btn;
    };
    for (const group of groups) {
      const groupKey = `group:${group.id}`;
      const collapsed = this.collapsedGroups.has(group.id);
      const head = h('div', { class: 'map-layers__group' });
      const chevron = action('chevron', collapsed ? '展开分组' : '折叠分组', () => {
        if (this.collapsedGroups.has(group.id)) this.collapsedGroups.delete(group.id);
        else this.collapsedGroups.add(group.id);
        this.renderLayers();
      });
      chevron.classList.toggle('is-collapsed', collapsed);
      head.append(
        chevron,
        action(this.hiddenLayers.has(groupKey) ? 'eyeOff' : 'eye', '切换分组显示', () => this.toggleLayerVisibility(groupKey)),
        action(this.lockedLayers.has(groupKey) ? 'lock' : 'unlock', '切换分组锁定', () => this.toggleLayerLock(groupKey)),
        h('span', { class: 'map-layers__name', text: `${group.label} (${group.items.length})` }),
      );
      this.layersEl.append(head);
      if (collapsed) continue;
      for (const item of group.items) {
        const key = `${item.kind}:${item.id}`;
        const row = h('div', {
          class: `map-layers__row${this.selectedElement?.kind === item.kind && this.selectedElement.id === item.id ? ' is-selected' : ''}${this.hiddenLayers.has(key) || this.hiddenLayers.has(groupKey) ? ' is-hidden' : ''}`,
          attrs: { 'data-layer-kind': item.kind, 'data-layer-id': item.id, title: item.id },
          on: { click: () => this.selectMapElement(item.kind, item.id) },
        });
        row.append(
          action(this.hiddenLayers.has(key) ? 'eyeOff' : 'eye', '切换图层显示', () => this.toggleLayerVisibility(key)),
          action(this.lockedLayers.has(key) ? 'lock' : 'unlock', '切换图层锁定', () => this.toggleLayerLock(key)),
          h('span', { class: 'map-layers__type' }),
          h('span', { class: 'map-layers__name', text: item.name }),
        );
        (row.querySelector('.map-layers__type') as HTMLElement).innerHTML = icon(item.icon);
        this.layersEl.append(row);
      }
    }
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
    const tab = this.projectTabs.find((t) => t.id === this.activeProjectId);
    if (tab) tab.doc = cloneDoc(this.doc);
    this.applyPreview(this.doc, patchRect);
    this.refreshStats();
    this.renderProjectTabs();
    this.renderInspector();
    this.renderLayers();
    if (!this.sessionId || !this.studioToken) {
      this.saveStateEl.textContent = '本地编辑';
      return;
    }
    this.saveStateEl.textContent = '同步中…';
    const snap = cloneDoc(this.doc);
    void fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}?token=${encodeURIComponent(this.studioToken)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: snap, patchRect }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { rev?: number } | null) => {
        if (res?.rev && res.rev > this.sessionRev) this.sessionRev = res.rev;
        this.saveStateEl.textContent = res?.rev ? `已保存 · v${this.sessionRev}` : '本地修改';
      })
      .catch(() => {
        this.saveStateEl.textContent = '同步失败';
      });
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
    this.currentToolEl.textContent = `当前：${TOOL_LABELS[t]}`;
    this.dragStart = null;
    this.moveOrigin = null;
    this.panDrag = null;
    this.measurement = null;
    for (const flyout of this.toolbarEl.querySelectorAll<HTMLElement>('.map-studio__tool-flyout')) flyout.hidden = true;
    if (t === 'box') this.setAiDockOpen(true);
    else if (t === 'select') this.setInspectorTab('inspector');
    for (const [id, btn] of this.toolBtns) {
      btn.classList.toggle('is-active', id === t);
      btn.setAttribute('aria-pressed', String(id === t));
    }
    this.syncCursor();
    this.renderSubOptions();
  }

  private renderSubOptions(): void {
    const wrap = this.subOptionsEl;
    wrap.innerHTML = '';
    const note = (text: string) => wrap.append(h('span', { class: 'map-context__note', text }));
    const select = <T extends string>(label: string, value: T, options: readonly [T, string][], change: (value: T) => void) => {
      const input = h('select', { class: 'map-studio__select', on: { change: () => change((input as HTMLSelectElement).value as T) } }) as HTMLSelectElement;
      for (const [id, text] of options) input.append(h('option', { text, attrs: { value: id, selected: id === value } }));
      wrap.append(h('label', { class: 'map-context__field', text: label }, input));
    };
    if (this.tool === 'select') {
      note('单击选择，拖动或方向键逐格移动；WASD 平移视口');
      return;
    }
    if (this.tool === 'pan') {
      note('左键 / 空格 / 中键拖动 · WASD 平移 · 滚轮缩放');
      return;
    }
    if (this.tool === 'box') {
      note('拖拽创建地图选区，可连续添加后在右侧生成 AI 修改任务');
      return;
    }
    if (this.tool === 'measure') {
      note('拖拽测量两点距离 · 单位：格与像素');
      return;
    }
    if (this.tool === 'road') {
      select('道路材质', this.floorKind === 'sidewalk' ? 'sidewalk' : 'street', [['street', '柏油路'], ['sidewalk', '人行道']], (value) => { this.floorKind = value; });
      const width = h('input', { class: 'map-studio__input', attrs: { type: 'number', min: '1', max: '8', value: String(this.roadWidth) }, on: { change: () => {
        this.roadWidth = Math.max(1, Math.min(8, Number((width as HTMLInputElement).value) || 1));
      } } });
      wrap.append(h('label', { class: 'map-context__field', text: '路宽' }, width), h('span', { class: 'map-context__note', text: '格' }));
      return;
    }
    if (this.tool === 'floor') {
      select('地形材质', this.floorKind, FLOORS.map((f) => [f.kind, f.label] as [FloorKind, string]), (value) => { this.floorKind = value; });
      note('拖拽填充 · 吸附 1 格');
      return;
    }
    if (this.tool === 'furn') {
      select('POI 类型', this.furnKind, FURNITURE_PALETTE.map((f) => [f.kind, f.label.replace(/^\S+\s+/, '')] as [FurnitureKind, string]), (value) => { this.furnKind = value; });
      note('单击放置');
      return;
    }
    if (this.tool === 'desk4') {
      select('工位朝向', this.deskDir, DIR_ORDER.map((d) => [d, DIR_LABELS[d]] as [Dir, string]), (value) => { this.deskDir = value; });
      note('R 旋转');
      return;
    }
    if (this.tool === 'wall') {
      select('墙体模式', this.wallMode, [['face', '北墙面'], ['cap', '竖墙 / 柱'], ['door', '门洞']], (value) => { this.wallMode = value; });
      return;
    }
    if (this.tool === 'zone' || this.tool === 'room') {
      select('区域类型', this.zoneKind, ZONES.map((z) => [z.kind, z.label] as [AreaKind, string]), (value) => { this.zoneKind = value; });
      note(this.tool === 'room' ? '拖拽绘制区域（至少 6×6 格）' : '拖拽划定功能区域');
      return;
    }
    note('点击或拖框删除地图元素');
  }

  private hitMapElement(tx: number, ty: number): SelectedMapElement | null {
    if (!this.doc) return null;
    for (let i = this.doc.furniture.length - 1; i >= 0; i--) {
      const item = this.doc.furniture[i];
      const rect = this.furnitureRect(item);
      if (tx >= rect.x && tx < rect.x + rect.w && ty >= rect.y && ty < rect.y + rect.h) return { kind: 'furniture', id: item.id };
    }
    for (let i = this.doc.wallItems.length - 1; i >= 0; i--) {
      const item = this.doc.wallItems[i];
      const rect = this.wallItemRect(item);
      if (tx >= rect.x && tx < rect.x + rect.w && ty >= rect.y && ty < rect.y + rect.h) return { kind: 'wallItem', id: item.id };
    }
    for (let i = this.doc.walls.length - 1; i >= 0; i--) {
      const item = this.doc.walls[i];
      const h = item.kind === 'face' ? 2 : item.kind === 'south' ? 1 : item.h;
      if (tx >= item.tx && tx < item.tx + item.w && ty >= item.ty && ty < item.ty + h) return { kind: 'wall', id: item.id };
    }
    for (let i = this.doc.rugs.length - 1; i >= 0; i--) {
      const item = this.doc.rugs[i];
      if (tx >= item.x && tx < item.x + item.w && ty >= item.y && ty < item.y + item.h) return { kind: 'rug', id: item.id };
    }
    const spawn = this.doc.spawns.find((item) => item.tx === tx && item.ty === ty);
    if (spawn) return { kind: 'spawn', id: spawn.id };
    for (let i = this.doc.zones.length - 1; i >= 0; i--) {
      const item = this.doc.zones[i];
      if (tx >= item.rect.x && tx < item.rect.x + item.rect.w && ty >= item.rect.y && ty < item.rect.y + item.rect.h) return { kind: 'zone', id: item.id };
    }
    const ref = this.referenceImage;
    if (ref?.visible && tx >= ref.x && tx < ref.x + ref.w && ty >= ref.y && ty < ref.y + ref.h) return { kind: 'reference', id: ref.id };
    return null;
  }

  private handleCanvasPointer(
    ev: PointerEvent,
    kind: 'down' | 'move' | 'up' | 'cancel',
    tile: { tx: number; ty: number; wx: number; wy: number },
  ): boolean {
    if (!this.doc) return false;
    const panButton = kind === 'down' && ev.button === 1;
    const wantsPan = this.panDrag !== null || panButton || ((this.spacePanning || this.tool === 'pan') && !ev.altKey);
    if (wantsPan) {
      if (kind === 'down') {
        if (ev.button !== 0 && ev.button !== 1) return false;
        this.panDrag = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY };
        this.dragStart = null;
        this.hoverTile = null;
        this.syncCursor();
        try {
          (ev.currentTarget as HTMLCanvasElement | null)?.setPointerCapture(ev.pointerId);
        } catch {}
        return true;
      }
      if (!this.panDrag || ev.pointerId !== this.panDrag.pointerId) return false;
      if (kind === 'move') {
        this.world.editor?.panBy(ev.clientX - this.panDrag.x, ev.clientY - this.panDrag.y);
        this.panDrag = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY };
        return true;
      }
      this.panDrag = null;
      this.syncCursor();
      return true;
    }
    if (ev.button === 1 || ev.button === 2 || ev.altKey) return false;
    const clampedX = Math.max(0, Math.min(this.doc.width - 1, tile.tx));
    const clampedY = Math.max(0, Math.min(this.doc.height - 1, tile.ty));
    this.hoverTile = { tx: clampedX, ty: clampedY };
    this.coordinatesEl.textContent = `X ${clampedX}  Y ${clampedY}`;

    if (this.tool === 'select' && kind !== 'cancel') {
      if (kind === 'down') {
        if (ev.button !== 0) return false;
        const hit = this.hitMapElement(clampedX, clampedY);
        if (hit) this.selectMapElement(hit.kind, hit.id);
        else {
          this.selectedElement = null;
          this.renderInspector();
          this.renderLayers();
        }
        this.dragStart = { tx: clampedX, ty: clampedY };
        this.moveOrigin = { tx: clampedX, ty: clampedY };
        this.syncCursor();
        return true;
      }
      if (kind === 'move') return !!this.dragStart;
      if (kind === 'up' && this.dragStart && this.moveOrigin) {
        const position = this.selectedPosition();
        const dx = clampedX - this.moveOrigin.tx;
        const dy = clampedY - this.moveOrigin.ty;
        this.dragStart = null;
        this.moveOrigin = null;
        this.syncCursor();
        if (position && (dx || dy)) this.setSelectedPosition(position.x + dx, position.y + dy);
        return true;
      }
    }
    if (this.tool === 'measure' && kind !== 'cancel') {
      if (kind === 'down') {
        if (ev.button !== 0) return false;
        this.dragStart = { tx: clampedX, ty: clampedY };
        this.measurement = { x0: clampedX, y0: clampedY, x1: clampedX, y1: clampedY };
        return true;
      }
      if (kind === 'move' && this.measurement) {
        this.measurement = { ...this.measurement, x1: clampedX, y1: clampedY };
        return true;
      }
      if (kind === 'up' && this.measurement) {
        this.measurement = { ...this.measurement, x1: clampedX, y1: clampedY };
        this.dragStart = null;
        return true;
      }
    }
    if (kind === 'cancel') {
      this.dragStart = null;
      this.moveOrigin = null;
      this.measurement = null;
      this.syncCursor();
      return true;
    }
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
      const origin = this.dragStart;
      const x0 = Math.min(origin.tx, clampedX);
      const y0 = Math.min(origin.ty, clampedY);
      const x1 = Math.max(origin.tx, clampedX);
      const y1 = Math.max(origin.ty, clampedY);
      const rect: TileRect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      this.dragStart = null;

      if (this.tool === 'road') {
        this.applyRoad(origin.tx, origin.ty, clampedX, clampedY);
      } else if (this.tool === 'box') {
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

  private applyRoad(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.doc) return;
    const buf = FloorGridBuffer.fromDocument(this.doc);
    const kind = this.floorKind === 'sidewalk' ? 'sidewalk' : 'street';
    const palette = buf.ensurePaletteIndex({ kind });
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const offset = Math.floor((this.roadWidth - 1) / 2);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (let oy = -offset; oy < this.roadWidth - offset; oy++) {
        for (let ox = -offset; ox < this.roadWidth - offset; ox++) buf.set(x + ox, y + oy, palette);
      }
    }
    this.doc.floorPalette = buf.palette;
    this.doc.floorRows = buf.toRows();
    this.commitLocalEdit({ x: Math.min(x0, x1) - this.roadWidth, y: Math.min(y0, y1) - this.roadWidth, w: Math.abs(x1 - x0) + this.roadWidth * 2 + 1, h: Math.abs(y1 - y0) + this.roadWidth * 2 + 1 });
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
    this.selectMapElement(itemMeta?.isWall ? 'wallItem' : 'furniture', id);
    this.commitLocalEdit({ x: tx - 1, y: ty - 1, w: 4, h: 4 });
  }

  private applyWallAction(rect: TileRect): void {
    if (!this.doc) return;
    if (this.wallMode === 'door') {
      let carved = false;
      for (const w of this.doc.walls) {
        if (this.isElementLocked('wall', w.id)) continue;
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
      return this.isElementLocked('furniture', f.id) || !overlap(f.tx, f.ty, fp.w, fp.h);
    });
    this.doc.wallItems = this.doc.wallItems.filter((wi) => this.isElementLocked('wallItem', wi.id) || !overlap(Math.floor(wi.tx), Math.floor(wi.ty) - 1, 1, 2));
    this.doc.walls = this.doc.walls.filter((w) => this.isElementLocked('wall', w.id) || !overlap(w.tx, w.ty, w.w, w.kind === 'face' ? 2 : w.kind === 'south' ? 1 : w.h));
    this.doc.spawns = this.doc.spawns.filter((s) => this.isElementLocked('spawn', s.id) || !overlap(s.tx, s.ty, 1, 1));
    if (rect.w >= 2 || rect.h >= 2) {
      this.doc.zones = this.doc.zones.filter((z) => {
        if (this.isElementLocked('zone', z.id)) return true;
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

  private drawReferenceImage(ctx: CanvasRenderingContext2D): void {
    const ref = this.referenceImage;
    if (!ref?.visible) return;
    ctx.save();
    ctx.globalAlpha = ref.opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ref.image, ref.x * TILE, ref.y * TILE, ref.w * TILE, ref.h * TILE);
    ctx.restore();
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

    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.72)';
    ctx.lineWidth = Math.max(1 / view.zoom, 1);
    ctx.strokeRect(0, 0, this.doc.width * TILE, this.doc.height * TILE);
    ctx.restore();

    const selected = this.selectedRect();
    if (selected) {
      const pad = selected.w <= 2 && selected.h <= 2 ? 0.35 : 0.12;
      let { x, y } = selected;
      const w = selected.w + pad * 2;
      const h = selected.h + pad * 2;
      x -= pad;
      y -= pad;
      if (this.tool === 'select' && this.dragStart && this.moveOrigin && this.hoverTile) {
        x += this.hoverTile.tx - this.moveOrigin.tx;
        y += this.hoverTile.ty - this.moveOrigin.ty;
      }
      ctx.save();
      ctx.fillStyle = 'rgba(38, 128, 235, 0.1)';
      ctx.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(3 / view.zoom, 3);
      ctx.strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
      ctx.strokeStyle = '#2680EB';
      ctx.lineWidth = Math.max(1.5 / view.zoom, 1.5);
      ctx.strokeRect(x * TILE, y * TILE, w * TILE, h * TILE);
      const handle = 5 / view.zoom;
      ctx.fillStyle = '#2680EB';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1 / view.zoom, 1);
      for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        ctx.fillRect(hx * TILE - handle / 2, hy * TILE - handle / 2, handle, handle);
        ctx.strokeRect(hx * TILE - handle / 2, hy * TILE - handle / 2, handle, handle);
      }
      ctx.restore();
    }
    if (this.measurement) {
      const m = this.measurement;
      const tiles = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
      ctx.save();
      ctx.strokeStyle = '#2680EB';
      ctx.fillStyle = '#2680EB';
      ctx.lineWidth = Math.max(1.5 / view.zoom, 1.5);
      ctx.beginPath();
      ctx.moveTo((m.x0 + 0.5) * TILE, (m.y0 + 0.5) * TILE);
      ctx.lineTo((m.x1 + 0.5) * TILE, (m.y1 + 0.5) * TILE);
      ctx.stroke();
      const fontPx = Math.max(10, 12 / Math.min(view.zoom, 1.5));
      ctx.font = `600 ${fontPx}px sans-serif`;
      ctx.fillText(`${tiles.toFixed(1)} 格 · ${Math.round(tiles * TILE)} px`, (m.x1 + 0.75) * TILE, (m.y1 + 0.5) * TILE);
      ctx.restore();
    }

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
    if (this.dragStart && this.hoverTile && this.tool !== 'select' && this.tool !== 'measure') {
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
  if (location.pathname === '/map' || location.pathname.startsWith('/map/') || params.get('studio') === '1') {
    ctx.root.classList.add('is-studio-sidebar');
    void editor.open();
  }
}
