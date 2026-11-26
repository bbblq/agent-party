import * as artModule from '../../art';
import type { ArtModule, Dir, FloorKind, FurnitureKind, WallPattern } from '../../art/api';
import {
  FLOOR_CATALOG,
  FULL_ASSET_CATALOG,
  FURNITURE_CATALOG,
  WALL_PATTERNS,
  clampMapDim,
  clearRectInDoc,
  cloneCustomMap,
  copyRectToClipboard,
  copySelectionToClipboard,
  createBlankGrassMap,
  createStarterOfficeMap,
  parseCustomMapJson,
  pasteClipboardIntoDoc,
  resizeCustomMap,
  serializeCustomMapJson,
  transformClipboardPayload,
  transformSelectionInDoc,
  type CustomLayerGroup,
  type CustomMapDocument,
  type MapClipboardPayload,
  type MapElementRef,
  type SpriteRot,
  type StudioMcpPresence,
  type StudioTaskBox,
  type StudioTaskSummary,
  type TransformOp,
} from '../../../../shared/map';
import {
  ASSET_PICK_CHANNEL,
  ASSET_PICK_STORAGE_KEY,
  type BroadcastAssetPick,
} from './asset-catalog-view';
import { CanvasSettingsModal, type ResizeAnchor } from './canvas-settings-modal';
import {
  copyTextSafe,
  loadMapClipboard,
  onMapClipboardChange,
  saveMapClipboard,
} from './clipboard-http-utils';
import { McpModal } from './mcp-modal';
import {
  StudioCanvas,
  type CanvasToolSettings,
  type RefImageState,
  type StudioToolId,
} from './studio-canvas';
import './map-editor.css';

const art: ArtModule = artModule;
const DRAFTS_STORAGE_KEY = 'agent_party_map_studio_drafts_v2';
const STUDIO_TOKEN_STORAGE_KEY = 'agent_party_map_studio_token_v2';
const MAX_HISTORY = 80;

interface MapTabDraft {
  tabId: string;
  doc: CustomMapDocument;
  history: CustomMapDocument[];
  historyIndex: number;
  aiBoxes: StudioTaskBox[];
  activeAiBoxId: string | null;
  aiInstruction: string;
}

interface StoredTabsPayload {
  activeTabId: string;
  tabs: Array<{ id: string; doc: CustomMapDocument }>;
}

const TOOL_DEFS: Array<{ id: StudioToolId; key: string; icon: string; name: string }> = [
  { id: 'select', key: 'V', icon: '🖱️', name: '移动 / 选择' },
  { id: 'marquee', key: 'M', icon: '⬚', name: '矩形选框 (支持跨地图复制)' },
  { id: 'brush', key: 'B', icon: '🖌️', name: '连续画笔 (地面/墙体/开门)' },
  { id: 'rect', key: 'R', icon: '🧱', name: '矩形建房 / 区域 / 地毯' },
  { id: 'workstation', key: 'K', icon: '💻', name: '工位组合印章' },
  { id: 'stamp', key: 'P', icon: '🪑', name: '家具 / 墙饰印章' },
  { id: 'eraser', key: 'E', icon: '🧹', name: '连续橡皮擦' },
  { id: 'eyedropper', key: 'I', icon: '💉', name: '吸管取样 (Alt)' },
  { id: 'ai_box', key: 'A', icon: '🤖', name: 'AI MCP 框选区块' },
  { id: 'ref_move', key: 'O', icon: '🖼️', name: '参考图拖拽缩放' },
  { id: 'pan', key: 'H', icon: '✋', name: '抓手平移 (Space)' },
];

export class MapStudioApp {
  private readonly root: HTMLElement;
  private tabs: MapTabDraft[] = [];
  private activeTabId = '';
  private selectedRefs: MapElementRef[] = [];
  private selectedGroupId: string | null = null;
  private marquee: { x: number; y: number; w: number; h: number } | null = null;
  private pasteClip: MapClipboardPayload | null = loadMapClipboard();
  private layerFilter = '';

  // Optional MCP / Server Session (lazy, never touches live Office SSE)
  private sessionId = '';
  private studioToken = '';
  private endpoints: { baseUrl: string; lanUrl: string | null } = {
    baseUrl: typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:4747',
    lanUrl: null,
  };
  private presence: StudioMcpPresence = { connected: false, listening: false, lastSeenAt: 0, activeTaskId: null };
  private tasks: StudioTaskSummary[] = [];
  private studioSse: EventSource | null = null;
  private mcpPushTimer: number | null = null;
  private selPushTimer: number | null = null;

  private readonly settings: CanvasToolSettings = {
    tool: 'select',
    brushMode: 'floor',
    brushSize: 1,
    floorKind: 'carpet',
    floorTint: '',
    wallKind: 'face',
    wallStyle: { base: '#e6e2da', trim: '#707b8c', pattern: 'plain' },
    rectMode: 'room',
    rectZoneKind: 'room',
    rugColor: '#5b7fa6',
    stampTarget: 'furniture',
    stampKind: 'desk',
    stampVariant: 'wood',
    stampRot: 0,
    stampFlipX: false,
    stampFlipY: false,
    wsFacing: 'up',
    wsLayout: 'row',
    wsCount: 2,
    wsDeskVariant: 'wood',
    wsChairVariant: 'black',
    eraserMode: 'items',
    showGrid: false,
    showWalkability: false,
    showZones: false,
  };

  private canvasEngine!: StudioCanvas;
  private mcpModal = new McpModal();
  private settingsModal = new CanvasSettingsModal();
  private publishModalEl!: HTMLElement;
  private ioModalEl!: HTMLElement;

  // Collapsible workspace panels for maximum canvas room
  private leftCollapsed = false;
  private rightCollapsed = false;

  // Layout containers
  private tabsBarEl!: HTMLElement;
  private headerActionsEl!: HTMLElement;
  private optionsBarEl!: HTMLElement;
  private leftToolsEl!: HTMLElement;
  private paletteDockEl!: HTMLElement;
  private refHudEl!: HTMLElement;
  private aiBarEl!: HTMLElement;
  private inspectorEl!: HTMLElement;
  private layersEl!: HTMLElement;
  private statusLeftEl!: HTMLElement;
  private statusRightEl!: HTMLElement;
  private expandLeftBtn!: HTMLButtonElement;
  private expandRightBtn!: HTMLButtonElement;
  private toastEl!: HTMLElement;
  private workspaceEl!: HTMLElement;
  private refFileInput!: HTMLInputElement;
  private jsonFileInput!: HTMLInputElement;
  private paletteTab: 'floors' | 'walls' | 'work' | 'decor' | 'rest' = 'work';
  private toastTimer = 0;

  constructor(_opts: { initialView?: 'canvas' | 'catalog' } = {}) {
    document.title = 'Agent Party — 地图工坊';
    document.body.classList.add('ms-studio-body');
    const existingCanvas = document.getElementById('world');
    if (existingCanvas) existingCanvas.style.display = 'none';
    const uiEl = document.getElementById('ui');
    this.root = uiEl ?? document.body;
    this.root.className = 'ms-root';
    this.root.innerHTML = '';

    this.loadInitialTabs();
    this.buildLayout();
    this.bindGlobalKeys();
    this.bindExternalAssetPickers();

    onMapClipboardChange((next) => {
      this.pasteClip = next;
      this.renderOptionsBar();
    });

    requestAnimationFrame(() => this.canvasEngine.fitToMap());

    // Quietly resume MCP session ONLY if user previously created one in localStorage
    const savedToken = localStorage.getItem(STUDIO_TOKEN_STORAGE_KEY);
    if (savedToken?.startsWith('ws_')) {
      void this.ensureMcpSession(savedToken, true);
    }
  }

  private get activeTab(): MapTabDraft {
    return this.tabs.find((t) => t.tabId === this.activeTabId) ?? this.tabs[0];
  }

  private get doc(): CustomMapDocument {
    return this.activeTab.doc;
  }

  // ------------------------------------------------------------------ Persistence (100% Pure Local)

  private loadInitialTabs(): void {
    try {
      const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredTabsPayload;
        if (Array.isArray(parsed?.tabs) && parsed.tabs.length > 0) {
          for (const t of parsed.tabs.slice(0, 8)) {
            const p = parseCustomMapJson(t.doc);
            if (p.ok) {
              this.tabs.push({
                tabId: t.id || `tab-${this.tabs.length + 1}`,
                doc: p.doc,
                history: [cloneCustomMap(p.doc)],
                historyIndex: 0,
                aiBoxes: [],
                activeAiBoxId: null,
                aiInstruction: '',
              });
            }
          }
          if (this.tabs.length > 0) {
            this.activeTabId = this.tabs.some((x) => x.tabId === parsed.activeTabId)
              ? parsed.activeTabId
              : this.tabs[0].tabId;
            return;
          }
        }
      }
    } catch {
      // ignore corrupted drafts
    }

    const starter = createStarterOfficeMap(2, 96, 64, 'Agent Party 标准园区');
    this.tabs = [
      {
        tabId: 'tab-main',
        doc: starter,
        history: [cloneCustomMap(starter)],
        historyIndex: 0,
        aiBoxes: [],
        activeAiBoxId: null,
        aiInstruction: '',
      },
    ];
    this.activeTabId = 'tab-main';
    this.saveTabsToLocal();
  }

  private saveTabsToLocal(): void {
    try {
      const payload: StoredTabsPayload = {
        activeTabId: this.activeTabId,
        tabs: this.tabs.map((t) => ({ id: t.tabId, doc: t.doc })),
      };
      localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota overflow
    }
  }

  private commitDocChange(next: CustomMapDocument, label: string, dirtyRect?: { x: number; y: number; w: number; h: number }): void {
    const tab = this.activeTab;
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(cloneCustomMap(next));
    if (tab.history.length > MAX_HISTORY) tab.history.shift();
    tab.historyIndex = tab.history.length - 1;
    tab.doc = next;

    if (dirtyRect) this.canvasEngine.invalidateChunksOnly(dirtyRect);
    else this.canvasEngine.invalidateMap();

    this.saveTabsToLocal();
    this.renderTopTabs();
    this.renderInspector();
    this.renderLayers();
    this.renderStatusBar(label);
    this.scheduleSyncDraftToMcp();
  }

  private undo(): void {
    const tab = this.activeTab;
    if (tab.historyIndex <= 0) {
      this.toast('已是最早一步');
      return;
    }
    tab.historyIndex--;
    tab.doc = cloneCustomMap(tab.history[tab.historyIndex]);
    this.canvasEngine.invalidateMap();
    this.saveTabsToLocal();
    this.renderTopTabs();
    this.renderInspector();
    this.renderLayers();
    this.toast('↶ 已撤销');
    this.scheduleSyncDraftToMcp();
  }

  private redo(): void {
    const tab = this.activeTab;
    if (tab.historyIndex >= tab.history.length - 1) {
      this.toast('已是最新状态');
      return;
    }
    tab.historyIndex++;
    tab.doc = cloneCustomMap(tab.history[tab.historyIndex]);
    this.canvasEngine.invalidateMap();
    this.saveTabsToLocal();
    this.renderTopTabs();
    this.renderInspector();
    this.renderLayers();
    this.toast('↷ 已重做');
    this.scheduleSyncDraftToMcp();
  }

  // ------------------------------------------------------------------ Layout construction

  private buildLayout(): void {
    // 1. Top Pixel Bar
    const topBar = document.createElement('header');
    topBar.className = 'ms-topbar';

    const brand = document.createElement('div');
    brand.className = 'ms-brand';
    brand.innerHTML = `<span class="ms-brand__logo">🧱</span><span class="ms-brand__text">AGENT PARTY 地图工坊</span>`;

    this.tabsBarEl = document.createElement('div');
    this.tabsBarEl.className = 'ms-map-tabs';

    this.headerActionsEl = document.createElement('div');
    this.headerActionsEl.className = 'ms-top-actions';

    topBar.append(brand, this.tabsBarEl, this.headerActionsEl);

    // 2. Contextual Options Bar (PS style)
    this.optionsBarEl = document.createElement('div');
    this.optionsBarEl.className = 'ms-options-bar';

    // 3. Main PS 3-Column Workspace
    this.workspaceEl = document.createElement('div');
    this.workspaceEl.className = 'ms-workspace';

    // Left: Tools + Swatch/Asset Dock
    const leftArea = document.createElement('aside');
    leftArea.className = 'ms-left-area';
    this.leftToolsEl = document.createElement('div');
    this.leftToolsEl.className = 'ms-tool-strip';
    this.paletteDockEl = document.createElement('div');
    this.paletteDockEl.className = 'ms-palette-dock';
    leftArea.append(this.leftToolsEl, this.paletteDockEl);

    // Center: Canvas + Floating Reference Staging Bar + Collapsible AI Tray + Status Strip
    const centerArea = document.createElement('main');
    centerArea.className = 'ms-center-area';

    this.refHudEl = document.createElement('div');
    this.refHudEl.className = 'ms-ref-hud';
    this.refHudEl.hidden = true;

    this.canvasEngine = new StudioCanvas(this.settings, {
      getDoc: () => this.doc,
      onDocLivePreview: (workDoc, dirty) => {
        this.activeTab.doc = workDoc;
        if (dirty) this.canvasEngine.invalidateChunksOnly(dirty);
        else this.canvasEngine.invalidateMap();
      },
      onDocCommit: (next, label, dirty) => this.commitDocChange(next, label, dirty),
      getSelectedRefs: () => this.selectedRefs,
      onSetSelectedRefs: (refs) => {
        this.selectedRefs = refs;
        if (refs.length > 0) this.selectedGroupId = null;
        this.canvasEngine.requestRender();
        this.renderInspector();
        this.renderLayers();
        this.renderOptionsBar();
      },
      getMarquee: () => this.marquee,
      onSetMarquee: (rect) => {
        this.marquee = rect;
        this.renderOptionsBar();
      },
      getAiBoxes: () => this.activeTab.aiBoxes,
      getActiveAiBoxId: () => this.activeTab.activeAiBoxId,
      onUpdateAiBoxes: (boxes, activeId) => {
        this.activeTab.aiBoxes = boxes;
        this.activeTab.activeAiBoxId = activeId;
        this.renderAiDock();
        this.scheduleSyncSelectionToMcp();
      },
      getPasteClip: () => this.pasteClip,
      onStampPaste: (tx, ty) => this.performPasteAt(tx, ty),
      onPickToolFromEyedropper: (patch) => {
        Object.assign(this.settings, patch);
        this.setTool(patch.tool ?? this.settings.tool);
        this.toast(`💉 已吸取素材：${patch.stampKind || patch.floorKind || patch.wallKind}`);
      },
      onDropAssetFromDock: (rawId, tx, ty) => this.handleDockDrop(rawId, tx, ty),
      onRefChanged: () => {
        this.renderRefHud();
        this.renderLayers();
      },
      onHoverTile: (tx, ty, inBounds) => this.renderStatusCoord(tx, ty, inBounds),
      onZoomChanged: () => this.renderStatusBar(),
    });

    this.aiBarEl = document.createElement('div');
    this.aiBarEl.className = 'ms-ai-dock';
    this.aiBarEl.hidden = true;

    this.statusLeftEl = document.createElement('div');
    this.statusLeftEl.className = 'ms-float-status-left';

    this.statusRightEl = document.createElement('div');
    this.statusRightEl.className = 'ms-float-status-right';

    this.expandLeftBtn = document.createElement('button');
    this.expandLeftBtn.type = 'button';
    this.expandLeftBtn.className = 'ms-btn ms-btn--xs ms-expand-pill is-left';
    this.expandLeftBtn.textContent = '▶ 素材';
    this.expandLeftBtn.title = '展开左侧素材面板 (Tab)';
    this.expandLeftBtn.hidden = true;
    this.expandLeftBtn.onclick = () => this.toggleLeftPanel(false);

    this.expandRightBtn = document.createElement('button');
    this.expandRightBtn.type = 'button';
    this.expandRightBtn.className = 'ms-btn ms-btn--xs ms-expand-pill is-right';
    this.expandRightBtn.textContent = '◀ 属性/图层';
    this.expandRightBtn.title = '展开右侧属性与图层面板 (Tab)';
    this.expandRightBtn.hidden = true;
    this.expandRightBtn.onclick = () => this.toggleRightPanel(false);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'ms-canvas-wrap';
    canvasWrap.append(
      this.refHudEl,
      this.expandLeftBtn,
      this.expandRightBtn,
      this.canvasEngine.root,
      this.aiBarEl,
      this.statusLeftEl,
      this.statusRightEl,
    );
    centerArea.append(canvasWrap);

    // Right: Inspector (top, pure element/group only!) + Layers & Groups (bottom)
    const rightArea = document.createElement('aside');
    rightArea.className = 'ms-right-dock';
    this.inspectorEl = document.createElement('section');
    this.inspectorEl.className = 'ms-inspector';
    this.layersEl = document.createElement('section');
    this.layersEl.className = 'ms-layers';
    rightArea.append(this.inspectorEl, this.layersEl);

    this.workspaceEl.append(leftArea, centerArea, rightArea);

    // 5. Hidden file inputs + Toast + Modals
    this.refFileInput = document.createElement('input');
    this.refFileInput.type = 'file';
    this.refFileInput.accept = 'image/*';
    this.refFileInput.hidden = true;
    this.refFileInput.addEventListener('change', () => {
      const f = this.refFileInput.files?.[0];
      if (f) this.importReferenceFile(f);
      this.refFileInput.value = '';
    });

    this.jsonFileInput = document.createElement('input');
    this.jsonFileInput.type = 'file';
    this.jsonFileInput.accept = 'application/json,.json';
    this.jsonFileInput.hidden = true;
    this.jsonFileInput.addEventListener('change', async () => {
      const f = this.jsonFileInput.files?.[0];
      if (f) {
        const text = await f.text();
        const parsed = parseCustomMapJson(text);
        if (!parsed.ok) this.toast(`❌ JSON 解析失败: ${parsed.error}`);
        else {
          this.commitDocChange(parsed.doc, `导入 JSON: ${parsed.doc.name}`);
          this.canvasEngine.fitToMap();
          this.toast(`✅ 已导入地图 ${parsed.doc.name}`);
        }
      }
      this.jsonFileInput.value = '';
    });

    this.publishModalEl = document.createElement('div');
    this.publishModalEl.className = 'ms-modal-backdrop';
    this.publishModalEl.hidden = true;

    this.ioModalEl = document.createElement('div');
    this.ioModalEl.className = 'ms-modal-backdrop';
    this.ioModalEl.hidden = true;

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'ms-toast';
    this.toastEl.hidden = true;

    this.root.append(
      topBar,
      this.optionsBarEl,
      this.workspaceEl,
      this.mcpModal.el,
      this.settingsModal.el,
      this.publishModalEl,
      this.ioModalEl,
      this.refFileInput,
      this.jsonFileInput,
      this.toastEl,
    );

    this.renderAll();
  }

  private renderAll(): void {
    this.renderTopTabs();
    this.renderHeaderActions();
    this.renderLeftTools();
    this.renderPaletteDock();
    this.renderOptionsBar();
    this.renderRefHud();
    this.renderInspector();
    this.renderLayers();
    this.renderAiDock();
    this.renderStatusBar();
  }

  // ------------------------------------------------------------------ Top Tabs & Header

  private renderTopTabs(): void {
    this.tabsBarEl.innerHTML = '';
    for (const tab of this.tabs) {
      const btn = document.createElement('div');
      btn.className = `ms-map-tab ${tab.tabId === this.activeTabId ? 'is-active' : ''}`;
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'ms-map-tab__btn';
      title.textContent = `${tab.doc.name} (${tab.doc.width}×${tab.doc.height})`;
      title.onclick = () => this.switchTab(tab.tabId);
      btn.append(title);

      if (this.tabs.length > 1) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ms-map-tab__close';
        x.textContent = '×';
        x.title = '关闭此草稿标签';
        x.onclick = (ev) => {
          ev.stopPropagation();
          this.closeTab(tab.tabId);
        };
        btn.append(x);
      }
      this.tabsBarEl.append(btn);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'ms-btn ms-btn--xs ms-btn--addtab';
    addBtn.textContent = '+ 新建草稿/小房间';
    addBtn.title = '新建一张空白小房间草稿（32×24），画好后可 Ctrl+C 跨地图粘贴回主图！';
    addBtn.onclick = () => this.createNewDraftTab();
    this.tabsBarEl.append(addBtn);
  }

  private renderHeaderActions(): void {
    this.headerActionsEl.innerHTML = '';

    const mk = (label: string, cls: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-btn ms-btn--sm ${cls}`;
      b.textContent = label;
      b.title = title;
      b.onclick = onClick;
      return b;
    };

    const mcpLabel = this.presence.listening
      ? '🟢 MCP 监听中'
      : this.presence.connected
        ? '🟢 MCP 已连'
        : '🤖 MCP 协同';

    const catalogLink = document.createElement('a');
    catalogLink.className = 'ms-btn ms-btn--sm ms-btn--cyan';
    catalogLink.href = '/map/assets';
    catalogLink.target = '_blank';
    catalogLink.rel = 'noopener noreferrer';
    catalogLink.title = '在独立页面打开完整素材图鉴百科 (/map/assets)';
    catalogLink.textContent = '📖 素材百科 ↗';

    this.headerActionsEl.append(
      mk(`📐 画布 ${this.doc.width}×${this.doc.height}`, '', '画布尺寸、名称、背景与可玩性体检', () => this.openCanvasSettings()),
      catalogLink,
      mk('🖼️ 导入参考图', '', '导入本地平面图进行自由拖拽缩放定位与临摹', () => this.refFileInput.click()),
      mk(mcpLabel, this.presence.connected ? 'ms-btn--green' : '', '打开 MCP AI 协同中心、启动提示词与内网手动复制区', () => {
        void this.openMcpModal();
      }),
      mk('↶', '', '撤销 (Ctrl+Z)', () => this.undo()),
      mk('↷', '', '重做 (Ctrl+Y / Ctrl+Shift+Z)', () => this.redo()),
      mk('📂 导入/导出', '', 'JSON 导入导出、PNG 导出或从服务器拉取线上地图', () => this.openIoModal()),
      mk('🚀 发布', 'ms-btn--primary', '管理员发布并设为线上激活地图', () => this.openPublishModal()),
    );

    const homeLink = document.createElement('a');
    homeLink.className = 'ms-btn ms-btn--sm';
    homeLink.href = '/';
    homeLink.textContent = '🏢 返回前台';
    this.headerActionsEl.append(homeLink);
  }

  private switchTab(tabId: string): void {
    if (this.activeTabId === tabId) return;
    this.activeTabId = tabId;
    this.selectedRefs = [];
    this.selectedGroupId = null;
    this.marquee = null;
    this.canvasEngine.invalidateMap();
    this.canvasEngine.fitToMap();
    this.renderAll();
    this.saveTabsToLocal();
  }

  private closeTab(tabId: string): void {
    if (this.tabs.length <= 1) return;
    this.tabs = this.tabs.filter((t) => t.tabId !== tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[0].tabId;
      this.canvasEngine.invalidateMap();
      this.canvasEngine.fitToMap();
    }
    this.saveTabsToLocal();
    this.renderAll();
  }

  private createNewDraftTab(): void {
    const idx = this.tabs.length + 1;
    const roomDoc = createBlankGrassMap(32, 24, `小房间草稿 #${idx}`);
    const tabId = `tab-${Date.now().toString(36)}`;
    this.tabs.push({
      tabId,
      doc: roomDoc,
      history: [cloneCustomMap(roomDoc)],
      historyIndex: 0,
      aiBoxes: [],
      activeAiBoxId: null,
      aiInstruction: '',
    });
    this.activeTabId = tabId;
    this.selectedRefs = [];
    this.selectedGroupId = null;
    this.marquee = null;
    this.saveTabsToLocal();
    this.canvasEngine.invalidateMap();
    this.canvasEngine.fitToMap();
    this.renderAll();
    this.toast('🏠 已新建 32×24 小房间草稿：画好后框选按 Ctrl+C，切回主图即可跨地图粘贴！');
  }

  // ------------------------------------------------------------------ Standalone Catalog Cross-Tab Sync & Collapsible Panels

  private bindExternalAssetPickers(): void {
    const apply = (pick: Partial<BroadcastAssetPick> | null | undefined) => {
      if (!pick?.id) return;
      this.applyExternalAssetPick(pick as BroadcastAssetPick);
    };

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(ASSET_PICK_CHANNEL);
        bc.onmessage = (ev) => apply(ev.data as BroadcastAssetPick);
      }
    } catch {
      // ignore unsupported BroadcastChannel
    }

    window.addEventListener('storage', (ev) => {
      if (ev.key === ASSET_PICK_STORAGE_KEY && ev.newValue) {
        try {
          apply(JSON.parse(ev.newValue) as BroadcastAssetPick);
        } catch {
          // ignore
        }
      }
    });

    const params = new URLSearchParams(location.search);
    const pickId = params.get('pick');
    if (pickId) {
      apply({ id: pickId, variant: params.get('variant') || undefined, ts: Date.now() });
      history.replaceState(null, '', '/map');
    }
  }

  private applyExternalAssetPick(pick: BroadcastAssetPick): void {
    const e = FULL_ASSET_CATALOG.find((x) => x.id === pick.id);
    if (!e) return;
    if (e.section === 'floor') {
      this.settings.floorKind = e.kindKey as FloorKind;
      this.settings.brushMode = 'floor';
      this.setTool('brush');
    } else if (e.section === 'wall') {
      this.settings.brushMode = 'wall';
      this.settings.wallKind = e.id === 'wall:south' ? 'south' : e.id === 'wall:cap' ? 'cap' : 'face';
      if (pick.variant) this.settings.wallStyle.pattern = pick.variant as WallPattern;
      this.setTool('brush');
    } else if (e.id === 'spawn:point') {
      this.settings.stampTarget = 'spawn';
      this.setTool('stamp');
    } else if (e.section === 'special') {
      this.settings.rectMode = 'zone';
      this.settings.rectZoneKind = e.kindKey as CanvasToolSettings['rectZoneKind'];
      this.setTool('rect');
    } else {
      this.settings.stampTarget = e.mount === 'wall' ? 'wallItem' : 'furniture';
      this.settings.stampKind = e.kindKey as FurnitureKind;
      this.settings.stampVariant = pick.variant ?? '';
      this.settings.stampRot = pick.rot ?? 0;
      this.settings.stampFlipX = !!pick.flipX;
      this.settings.stampFlipY = !!pick.flipY;
      this.setTool('stamp');
    }
    this.renderPaletteDock();
    this.toast(`🎨 已从百科选用：${e.name} (${e.id})`);
  }

  private toggleLeftPanel(collapsed = !this.leftCollapsed): void {
    this.leftCollapsed = collapsed;
    this.workspaceEl.classList.toggle('is-left-collapsed', collapsed);
    this.paletteDockEl.hidden = collapsed;
    this.expandLeftBtn.hidden = !collapsed;
    requestAnimationFrame(() => this.canvasEngine.requestRender());
  }

  private toggleRightPanel(collapsed = !this.rightCollapsed): void {
    this.rightCollapsed = collapsed;
    this.workspaceEl.classList.toggle('is-right-collapsed', collapsed);
    this.expandRightBtn.hidden = !collapsed;
    requestAnimationFrame(() => this.canvasEngine.requestRender());
  }

  // ------------------------------------------------------------------ Tools & Options Strip

  private setTool(tool: StudioToolId): void {
    this.settings.tool = tool;
    this.renderLeftTools();
    this.renderOptionsBar();
    this.renderAiDock();
    this.canvasEngine.requestRender();
    this.renderStatusBar();
  }

  private renderLeftTools(): void {
    this.leftToolsEl.innerHTML = '';
    for (const t of TOOL_DEFS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-tool-btn ${this.settings.tool === t.id ? 'is-active' : ''}`;
      b.title = `${t.name} [${t.key}]`;
      b.innerHTML = `<span class="ms-tool-btn__ico">${t.icon}</span><span class="ms-tool-btn__key">${t.key}</span>`;
      b.onclick = () => this.setTool(t.id);
      this.leftToolsEl.append(b);
    }
  }

  private renderOptionsBar(): void {
    const o = this.optionsBarEl;
    o.innerHTML = '';
    const t = this.settings.tool;

    const addBadge = (text: string) => {
      const s = document.createElement('span');
      s.className = 'ms-opt-badge';
      s.textContent = text;
      o.append(s);
    };

    const addBtn = (text: string, active: boolean, onClick: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-btn ms-btn--xs ${active ? 'ms-btn--cyan' : ''} ${cls}`;
      b.textContent = text;
      b.onclick = onClick;
      o.append(b);
    };

    if (t === 'select') {
      addBadge('🖱️ 移动与变换');
      if (this.selectedRefs.length || this.selectedGroupId) {
        addBadge(`已选 ${this.selectedRefs.length} 项${this.selectedGroupId ? ' (分组)' : ''}`);
        addBtn('↻ 顺时针90°', false, () => this.transformCurrent('rot90'));
        addBtn('↺ 逆时针90°', false, () => this.transformCurrent('rot270'));
        addBtn('⇄ 水平镜像', false, () => this.transformCurrent('flipX'));
        addBtn('⇅ 垂直镜像', false, () => this.transformCurrent('flipY'));
        addBtn('📁 编组 (Ctrl+G)', false, () => this.groupCurrentSelection());
        addBtn('📋 复制 (Ctrl+C)', false, () => this.copyCurrentToClipboard());
        addBtn('🗑️ 删除 (Del)', false, () => this.deleteCurrentSelection(), 'ms-btn--danger');
      } else {
        addBadge('点击元素选中并直接拖动 · Shift 多选 · 空处拖拽框选');
      }
      if (this.pasteClip) {
        addBtn(`📌 粘贴剪贴板 (${this.pasteClip.width}×${this.pasteClip.height})`, false, () => this.enterPasteMode(), 'ms-btn--primary');
      }
    } else if (t === 'marquee') {
      addBadge('⬚ 矩形选区');
      if (this.marquee) {
        addBadge(`当前选区: ${this.marquee.x},${this.marquee.y} (${this.marquee.w}×${this.marquee.h})`);
        addBtn('📋 复制整片区域(含地板+墙+家具)', false, () => this.copyMarqueeToClipboard(), 'ms-btn--primary');
        addBtn('🤖 转为 AI 框选', false, () => this.convertMarqueeToAiBox());
        addBtn('🧹 清空选区内容', false, () => this.clearMarqueeRegion(), 'ms-btn--danger');
        addBtn('取消选区', false, () => {
          this.marquee = null;
          this.renderOptionsBar();
          this.canvasEngine.requestRender();
        });
      } else {
        addBadge('在画布拖拽拉出矩形选区，可整片跨地图复制整个房间！');
      }
    } else if (t === 'brush') {
      addBadge('🖌️ 连续画笔');
      addBtn('地面刷写', this.settings.brushMode === 'floor', () => {
        this.settings.brushMode = 'floor';
        this.renderOptionsBar();
      });
      addBtn('墙体拉线', this.settings.brushMode === 'wall', () => {
        this.settings.brushMode = 'wall';
        this.renderOptionsBar();
      });
      addBtn('点击开/关门洞', this.settings.brushMode === 'doorway', () => {
        this.settings.brushMode = 'doorway';
        this.renderOptionsBar();
      });
      if (this.settings.brushMode === 'floor') {
        addBadge('笔刷大小:');
        for (const sz of [1, 2, 3, 5] as const) {
          addBtn(`${sz}×${sz}`, this.settings.brushSize === sz, () => {
            this.settings.brushSize = sz;
            this.renderOptionsBar();
          });
        }
        addBadge(`材质: ${this.settings.floorKind}`);
      } else if (this.settings.brushMode === 'wall') {
        for (const [k, l] of [['face', '北墙(2格)'], ['south', '南矮墙(1格)'], ['cap', '侧墙(1格)']] as const) {
          addBtn(l, this.settings.wallKind === k, () => {
            this.settings.wallKind = k;
            this.renderOptionsBar();
          });
        }
      }
    } else if (t === 'rect') {
      addBadge('🧱 矩形快速生成');
      for (const [k, l] of [['room', '完整房间(墙+门+地)'], ['floor', '地面矩形'], ['rug', '地毯'], ['zone', '逻辑区域框']] as const) {
        addBtn(l, this.settings.rectMode === k, () => {
          this.settings.rectMode = k;
          this.renderOptionsBar();
        });
      }
      if (this.settings.rectMode === 'room' || this.settings.rectMode === 'zone') {
        const sel = document.createElement('select');
        sel.className = 'ms-input ms-input--xs';
        for (const [zk, zn] of [
          ['room', '工作室 room'],
          ['arena', '宝可梦决斗场 arena'],
          ['cafe', '茶水区 cafe'],
          ['lounge', '休闲区 lounge'],
          ['reception', '前台 reception'],
          ['restroom', '洗手间 restroom'],
        ] as const) {
          const opt = document.createElement('option');
          opt.value = zk;
          opt.textContent = zn;
          if (this.settings.rectZoneKind === zk) opt.selected = true;
          sel.append(opt);
        }
        sel.onchange = () => (this.settings.rectZoneKind = sel.value as CanvasToolSettings['rectZoneKind']);
        o.append(sel);
      }
    } else if (t === 'workstation') {
      addBadge('💻 工位组合印章 (R 键切四向)');
      for (const [d, l] of [['up', '⬆️面北'], ['down', '⬇️面南(2D宠物)'], ['left', '⬅️面西'], ['right', '➡️面东']] as const) {
        addBtn(l, this.settings.wsFacing === d, () => {
          this.settings.wsFacing = d;
          this.renderOptionsBar();
        });
      }
      addBadge('组数:');
      for (const n of [1, 2, 3, 4]) {
        addBtn(`${n}组`, this.settings.wsCount === n, () => {
          this.settings.wsCount = n;
          this.renderOptionsBar();
        });
      }
    } else if (t === 'stamp') {
      addBadge(`🪑 印章: ${this.settings.stampKind}`);
      addBtn('↻ 旋转90° (R)', false, () => this.rotateStampPreview());
      addBtn(`⇄ 镜像X${this.settings.stampFlipX ? ' ✓' : ''}`, this.settings.stampFlipX, () => {
        this.settings.stampFlipX = !this.settings.stampFlipX;
        this.renderOptionsBar();
        this.canvasEngine.requestRender();
      });
      addBtn(`⇅ 镜像Y${this.settings.stampFlipY ? ' ✓' : ''}`, this.settings.stampFlipY, () => {
        this.settings.stampFlipY = !this.settings.stampFlipY;
        this.renderOptionsBar();
        this.canvasEngine.requestRender();
      });
    } else if (t === 'paste') {
      addBadge(`📌 正在粘贴「${this.pasteClip?.sourceName ?? ''}」(${this.pasteClip?.width ?? 0}×${this.pasteClip?.height ?? 0}) · 点击画布落位 · Esc 退出`);
      addBtn('↻ 旋转90° (R)', false, () => this.transformPasteClip('rot90'));
      addBtn('⇄ 水平镜像 (X)', false, () => this.transformPasteClip('flipX'));
      addBtn('⇅ 垂直镜像 (Y)', false, () => this.transformPasteClip('flipY'));
      addBtn('取消粘贴', false, () => this.setTool('select'));
    } else if (t === 'eraser') {
      addBadge('🧹 连续橡皮擦');
      for (const [m, l] of [['items', '只擦物件/墙/家具'], ['floor', '恢复背景地面'], ['all', '全部清空']] as const) {
        addBtn(l, this.settings.eraserMode === m, () => {
          this.settings.eraserMode = m;
          this.renderOptionsBar();
        });
      }
    } else if (t === 'ai_box') {
      addBadge('🤖 AI 框选：拖拽画多个区域框，写好备注后可在底部一键派单或复制对话框启动提示词');
    } else if (t === 'ref_move') {
      addBadge('🖼️ 参考图模式：直接拖动或拉四角/四边控制点调整位置与比例');
    } else {
      addBadge('✋ 拖拽平移视角 · 滚轮缩放到光标位置');
    }
  }

  // ------------------------------------------------------------------ Palette / Quick Assets Dock

  private renderPaletteDock(): void {
    const el = this.paletteDockEl;
    el.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'ms-dock-head';
    head.innerHTML = `<span>素材库 (点击/拖入)</span>`;
    const headBtns = document.createElement('div');
    headBtns.className = 'ms-dock-head__btns';
    const moreLink = document.createElement('a');
    moreLink.className = 'ms-btn ms-btn--xs';
    moreLink.href = '/map/assets';
    moreLink.target = '_blank';
    moreLink.rel = 'noopener noreferrer';
    moreLink.title = '独立页面查看完整图鉴百科';
    moreLink.textContent = '百科';
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'ms-btn ms-btn--xs';
    hideBtn.textContent = '◀';
    hideBtn.title = '收起左侧素材面板 (Tab)';
    hideBtn.onclick = () => this.toggleLeftPanel(true);
    headBtns.append(moreLink, hideBtn);
    head.append(headBtns);
    el.append(head);

    const tabs = document.createElement('div');
    tabs.className = 'ms-mini-tabs';
    for (const [k, l] of [
      ['work', '办公'],
      ['rest', '茶水休闲'],
      ['decor', '装饰墙饰'],
      ['floors', '地面'],
      ['walls', '墙体'],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-mini-tab ${this.paletteTab === k ? 'is-active' : ''}`;
      b.textContent = l;
      b.onclick = () => {
        this.paletteTab = k;
        this.renderPaletteDock();
      };
      tabs.append(b);
    }
    el.append(tabs);

    const grid = document.createElement('div');
    grid.className = 'ms-swatch-grid';

    if (this.paletteTab === 'floors') {
      for (const fl of FLOOR_CATALOG) {
        grid.append(this.makeFloorTileBtn(fl.id as FloorKind, fl.name));
      }
    } else if (this.paletteTab === 'walls') {
      for (const pat of WALL_PATTERNS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `ms-swatch-btn ${this.settings.tool === 'brush' && this.settings.brushMode === 'wall' && this.settings.wallStyle.pattern === pat ? 'is-active' : ''}`;
        b.textContent = pat;
        b.title = `墙体纹样 ${pat}`;
        b.onclick = () => {
          this.settings.wallStyle = { ...this.settings.wallStyle, pattern: pat };
          this.settings.brushMode = 'wall';
          this.setTool('brush');
          this.renderPaletteDock();
        };
        grid.append(b);
      }
    } else {
      const catFilter =
        this.paletteTab === 'work'
          ? new Set(['工位桌椅', '前台走廊'])
          : this.paletteTab === 'rest'
            ? new Set(['茶水餐饮', '休闲娱乐', '卫浴设施'])
            : new Set(['办公收纳', '绿植隔断', '墙面门窗']);
      const list = FURNITURE_CATALOG.filter((f) => catFilter.has(f.category));
      for (const item of list) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `ms-asset-thumb ${this.settings.tool === 'stamp' && this.settings.stampKind === item.id ? 'is-active' : ''}`;
        card.title = `${item.name} (${item.id})\n${item.passabilityLabel}\n可点击选用或直接拖到画布`;
        card.draggable = true;
        card.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/agent-party-asset', item.id);
        });

        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 40;
        iconCanvas.height = 40;
        const ictx = iconCanvas.getContext('2d')!;
        ictx.imageSmoothingEnabled = false;
        const fs = art.furnitureSprites(item.kindKey as FurnitureKind, item.variants[0], 0, { seed: 42 });
        if (fs?.base?.canvas) {
          const sp = fs.base.canvas;
          const sc = Math.min(2, Math.max(0.9, 34 / Math.max(sp.width, sp.height)));
          ictx.drawImage(
            sp,
            Math.round((40 - sp.width * sc) / 2),
            Math.round((40 - sp.height * sc) / 2),
            Math.round(sp.width * sc),
            Math.round(sp.height * sc),
          );
        }

        const label = document.createElement('span');
        label.textContent = item.name.split('·')[0].split('(')[0].trim();
        card.append(iconCanvas, label);
        card.onclick = () => {
          this.settings.stampTarget = item.mount === 'wall' ? 'wallItem' : 'furniture';
          this.settings.stampKind = item.kindKey as FurnitureKind;
          this.settings.stampVariant = item.variants[0] ?? '';
          this.settings.stampRot = 0;
          this.settings.stampFlipX = false;
          this.settings.stampFlipY = false;
          this.setTool('stamp');
          this.renderPaletteDock();
        };
        grid.append(card);
      }
    }

    el.append(grid);
  }

  private makeFloorTileBtn(kind: FloorKind, name: string): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ms-asset-thumb ${this.settings.tool === 'brush' && this.settings.brushMode === 'floor' && this.settings.floorKind === kind ? 'is-active' : ''}`;
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    try {
      art.drawFloor(ctx, kind, 0, 0, 40, 40, { seed: 101 });
    } catch {
      ctx.fillStyle = '#556';
      ctx.fillRect(0, 0, 40, 40);
    }
    const label = document.createElement('span');
    label.textContent = name;
    b.append(c, label);
    b.onclick = () => {
      this.settings.floorKind = kind;
      this.settings.brushMode = 'floor';
      this.setTool('brush');
      this.renderPaletteDock();
    };
    return b;
  }

  private handleDockDrop(rawId: string, tx: number, ty: number): void {
    const entry = FULL_ASSET_CATALOG.find((e) => e.id === rawId);
    if (!entry || entry.section !== 'furniture') return;
    this.settings.stampTarget = entry.mount === 'wall' ? 'wallItem' : 'furniture';
    this.settings.stampKind = entry.kindKey as FurnitureKind;
    this.settings.stampVariant = entry.variants[0] ?? '';
    const next = cloneCustomMap(this.doc);
    if (entry.mount === 'wall') {
      const ids = new Set(next.wallItems.map((x) => x.id));
      let i = 1;
      while (ids.has(`wi-${i}`)) i++;
      next.wallItems.push({
        id: `wi-${i}`,
        kind: entry.kindKey as FurnitureKind,
        tx: Math.max(0, Math.min(next.width, tx + 0.5)),
        ty: Math.max(0, Math.min(next.height, ty + 1)),
        on: 'face',
        ...(entry.variants[0] ? { variant: entry.variants[0] } : {}),
      });
    } else {
      const ids = new Set(next.furniture.map((x) => x.id));
      let i = 1;
      while (ids.has(`f-${i}`)) i++;
      const ax = Math.max(0, Math.min(next.width - entry.footprint.w, tx));
      const ay = Math.max(0, Math.min(next.height - entry.footprint.h, ty));
      next.furniture.push({
        id: `f-${i}`,
        kind: entry.kindKey as FurnitureKind,
        tx: ax,
        ty: ay,
        ...(entry.variants[0] ? { variant: entry.variants[0] } : {}),
      });
    }
    this.commitDocChange(next, `拖放放置 ${entry.name}`, { x: tx - 1, y: ty - 1, w: 4, h: 4 });
  }

  // ------------------------------------------------------------------ Reference Image Staging (Requirement #5)

  private importReferenceFile(file: File): void {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
      const targetW = Math.min(this.doc.width * 0.85, Math.max(12, img.naturalWidth / 16));
      const targetH = targetW / ratio;
      const state: RefImageState = {
        img,
        url,
        name: file.name,
        x: Math.round((this.doc.width - targetW) / 2),
        y: Math.round((this.doc.height - targetH) / 2),
        w: targetW,
        h: targetH,
        naturalRatio: ratio,
        opacity: 0.58,
        visible: true,
        locked: false,
        staging: true,
        aboveMap: true,
        keepAspect: true,
      };
      this.canvasEngine.setRefImage(state);
      this.setTool('ref_move');
      this.toast('🖼️ 参考图已导入！请自由拖动位置与 8 角缩放，满意后点击【✅ 确认放置并锁定】');
    };
    img.src = url;
  }

  private renderRefHud(): void {
    const ref = this.canvasEngine.getRefImage();
    if (!ref || (!ref.staging && ref.locked)) {
      this.refHudEl.hidden = true;
      return;
    }
    this.refHudEl.hidden = false;
    this.refHudEl.innerHTML = '';

    const badge = document.createElement('span');
    badge.className = 'ms-ref-hud__title';
    badge.textContent = ref.staging
      ? `🖼️ 待确认放置「${ref.name}」· (${ref.x.toFixed(1)}, ${ref.y.toFixed(1)}) ${ref.w.toFixed(1)}×${ref.h.toFixed(1)}格`
      : `🔓 参考图调整中「${ref.name}」`;

    const opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.min = '10';
    opSlider.max = '95';
    opSlider.value = String(Math.round(ref.opacity * 100));
    opSlider.title = '透明度';
    opSlider.oninput = () => {
      ref.opacity = Number(opSlider.value) / 100;
      this.canvasEngine.requestRender();
    };

    const aspectBtn = document.createElement('button');
    aspectBtn.type = 'button';
    aspectBtn.className = `ms-btn ms-btn--xs ${ref.keepAspect ? 'ms-btn--cyan' : ''}`;
    aspectBtn.textContent = ref.keepAspect ? '🔒 锁定比例' : '🔓 自由比例';
    aspectBtn.onclick = () => {
      ref.keepAspect = !ref.keepAspect;
      this.renderRefHud();
    };

    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'ms-btn ms-btn--xs';
    fitBtn.textContent = '📐 适配画布';
    fitBtn.onclick = () => {
      const w = this.doc.width;
      const h = w / ref.naturalRatio;
      ref.x = 0;
      ref.y = (this.doc.height - h) / 2;
      ref.w = w;
      ref.h = h;
      this.canvasEngine.requestRender();
      this.renderRefHud();
    };

    const zBtn = document.createElement('button');
    zBtn.type = 'button';
    zBtn.className = 'ms-btn ms-btn--xs';
    zBtn.textContent = ref.aboveMap ? '⬆️ 顶层描图' : '⬇️ 垫底参考';
    zBtn.onclick = () => {
      ref.aboveMap = !ref.aboveMap;
      this.canvasEngine.requestRender();
      this.renderRefHud();
    };

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ms-btn ms-btn--primary ms-btn--xs';
    confirmBtn.textContent = '✅ 确认放置并锁定';
    confirmBtn.onclick = () => {
      ref.staging = false;
      ref.locked = true;
      ref.aboveMap = false;
      if (this.settings.tool === 'ref_move') this.setTool('brush');
      this.canvasEngine.requestRender();
      this.renderRefHud();
      this.renderLayers();
      this.toast('✅ 参考图已确认并锁定到底层，随时可在右侧【图层】面板点击重新调整');
    };

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ms-btn ms-btn--danger ms-btn--xs';
    removeBtn.textContent = '🗑️ 移除';
    removeBtn.onclick = () => {
      this.canvasEngine.setRefImage(null);
      if (this.settings.tool === 'ref_move') this.setTool('select');
    };

    this.refHudEl.append(badge, opSlider, aspectBtn, fitBtn, zBtn, confirmBtn, removeBtn);
  }

  // ------------------------------------------------------------------ Pure Element/Group Inspector (Requirement #6 & #7)

  private renderInspector(): void {
    const el = this.inspectorEl;
    el.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'ms-panel-head';
    head.innerHTML = `<span>🔍 属性检查器</span>`;
    const collapseBtn = this.makeMiniBtn('收起 ▶', () => this.toggleRightPanel(true), '', '收起右侧属性与图层面板 (Tab)');
    head.append(collapseBtn);
    el.append(head);

    const body = document.createElement('div');
    body.className = 'ms-inspector__body';

    // Case 1: Layer Group selected
    if (this.selectedGroupId) {
      const grp = (this.doc.groups ?? []).find((g) => g.id === this.selectedGroupId);
      if (grp) {
        const count = this.countGroupMembers(grp.id);
        body.innerHTML = `
          <div class="ms-insp-title">📁 图层分组 · ${grp.name}</div>
          <div class="ms-insp-sub">包含 ${count} 个直接成员 · 整组可同时旋转/镜像/跨地图复制</div>
        `;
        const nameInput = document.createElement('input');
        nameInput.className = 'ms-input ms-input--sm';
        nameInput.value = grp.name;
        nameInput.onchange = () => {
          const next = cloneCustomMap(this.doc);
          const g = next.groups?.find((x) => x.id === grp.id);
          if (g) g.name = nameInput.value.trim() || g.name;
          this.commitDocChange(next, '重命名分组');
        };
        body.append(this.makePropField('分组名称', nameInput));
        body.append(this.makeTransformPanel(grp));
        body.append(this.makeAttachedTransformControls({
          rot: grp.rot,
          flipX: grp.flipX,
          flipY: grp.flipY,
          title: '🧩 分组附加视觉属性（继承给所有组内成员，无原生旋转素材也能生效）',
          onUpdate: (patch) => {
            const next = cloneCustomMap(this.doc);
            const g = next.groups?.find((x) => x.id === grp.id);
            if (!g) return;
            if (patch.rot) g.rot = patch.rot;
            else delete g.rot;
            if (patch.flipX) g.flipX = true;
            else delete g.flipX;
            if (patch.flipY) g.flipY = true;
            else delete g.flipY;
            this.commitDocChange(next, '更新分组附加旋转/镜像');
          },
        }));

        const ops = document.createElement('div');
        ops.className = 'ms-btn-row';
        const copyGrpBtn = this.makeMiniBtn('📋 复制整组 (可贴其他地图)', () => this.copyCurrentToClipboard(), 'ms-btn--primary');
        const ungroupBtn = this.makeMiniBtn('🔓 解散分组', () => this.ungroupId(grp.id));
        ops.append(copyGrpBtn, ungroupBtn);
        body.append(ops);
        el.append(body);
        return;
      }
    }

    // Case 2: Multiple items selected
    if (this.selectedRefs.length > 1) {
      body.innerHTML = `
        <div class="ms-insp-title">✨ 已多选 ${this.selectedRefs.length} 个元素</div>
        <div class="ms-insp-sub">支持一键旋转/镜像整个选区、编组管理或跨地图复制！</div>
      `;
      body.append(this.makeTransformPanel(undefined));
      const row = document.createElement('div');
      row.className = 'ms-btn-row';
      row.append(
        this.makeMiniBtn('📁 编为图层组 (Ctrl+G)', () => this.groupCurrentSelection(), 'ms-btn--primary'),
        this.makeMiniBtn('📋 复制 (Ctrl+C)', () => this.copyCurrentToClipboard()),
        this.makeMiniBtn('🗑️ 删除', () => this.deleteCurrentSelection(), 'ms-btn--danger'),
      );
      body.append(row);
      el.append(body);
      return;
    }

    // Case 3: Single element selected
    if (this.selectedRefs.length === 1) {
      const ref = this.selectedRefs[0];
      const item = this.findRefObject(ref);
      if (item) {
        body.append(this.buildSingleElementInspector(ref, item));
        el.append(body);
        return;
      }
    }

    // Empty state (NO global canvas size here per Requirement #6!)
    body.innerHTML = `
      <div class="ms-insp-empty">
        <div>点击画布或右侧图层列表中的任意元素/分组以查看属性与附加旋转/镜像。</div>
        <div class="ms-muted">（全局画布尺寸、地图名称、默认背景与体检已移至顶栏 <b>📐 画布设置</b> 按钮）</div>
      </div>
    `;
    el.append(body);
  }

  private buildSingleElementInspector(ref: MapElementRef, item: Record<string, unknown>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ms-insp-stack';

    const title = document.createElement('div');
    title.className = 'ms-insp-title';
    title.textContent = `${ref.layer.toUpperCase()} · ${String(item.kind ?? item.name ?? item.id)}`;
    wrap.append(title);

    // Group assignment selector
    const grpSel = document.createElement('select');
    grpSel.className = 'ms-input ms-input--sm';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '（未分组）';
    grpSel.append(noneOpt);
    for (const g of this.doc.groups ?? []) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `📁 ${g.name}`;
      if (item.groupId === g.id) opt.selected = true;
      grpSel.append(opt);
    }
    grpSel.onchange = () => {
      const next = cloneCustomMap(this.doc);
      const target = this.findRefObjectInDoc(next, ref);
      if (target) {
        if (grpSel.value) target.groupId = grpSel.value;
        else delete target.groupId;
        this.commitDocChange(next, '更改所属分组');
      }
    };
    wrap.append(this.makePropField('所属分组', grpSel));

    // Transform panel for furniture, wallItem, wall, rug, zone, spawn
    wrap.append(this.makeTransformPanel(item as { rot?: SpriteRot; flipX?: boolean; flipY?: boolean }));
    if (ref.layer === 'furniture' || ref.layer === 'wallItem') {
      const m = item as { rot?: SpriteRot; flipX?: boolean; flipY?: boolean };
      wrap.append(this.makeAttachedTransformControls({
        rot: m.rot,
        flipX: m.flipX,
        flipY: m.flipY,
        title: '🧩 元素自身附加视觉旋转 / 镜像',
        onUpdate: (patch) => {
          const next = cloneCustomMap(this.doc);
          const target = this.findRefObjectInDoc(next, ref);
          if (!target) return;
          if (patch.rot) target.rot = patch.rot;
          else delete target.rot;
          if (patch.flipX) target.flipX = true;
          else delete target.flipX;
          if (patch.flipY) target.flipY = true;
          else delete target.flipY;
          this.commitDocChange(next, '更新元素附加旋转/镜像');
        },
      }));
    }

    // Variant selector if furniture / wallItem has variants
    if ((ref.layer === 'furniture' || ref.layer === 'wallItem') && typeof item.kind === 'string') {
      const def = FULL_ASSET_CATALOG.find((e) => e.id === item.kind);
      if (def && def.variants.length > 0) {
        const varSel = document.createElement('select');
        varSel.className = 'ms-input ms-input--sm';
        for (const v of def.variants) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v;
          if (item.variant === v) opt.selected = true;
          varSel.append(opt);
        }
        varSel.onchange = () => {
          const next = cloneCustomMap(this.doc);
          const target = this.findRefObjectInDoc(next, ref);
          if (target) {
            target.variant = varSel.value;
            this.commitDocChange(next, `切换变体 ${varSel.value}`);
          }
        };
        wrap.append(this.makePropField('样式变体', varSel));
      }
    }

    // Zone name / kind / accentColor editor
    if (ref.layer === 'zone') {
      const zName = document.createElement('input');
      zName.className = 'ms-input ms-input--sm';
      zName.value = String(item.name ?? '');
      zName.onchange = () => {
        const next = cloneCustomMap(this.doc);
        const z = next.zones.find((x) => x.id === ref.id);
        if (z) {
          z.name = zName.value.trim() || z.name;
          this.commitDocChange(next, '修改区域名称');
        }
      };
      wrap.append(this.makePropField('区域名称', zName));
    }

    // Wall pattern editor
    if (ref.layer === 'wall') {
      const patSel = document.createElement('select');
      patSel.className = 'ms-input ms-input--sm';
      const st = item.style as { pattern?: WallPattern; base: string; trim?: string };
      for (const p of WALL_PATTERNS) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (st.pattern === p) opt.selected = true;
        patSel.append(opt);
      }
      patSel.onchange = () => {
        const next = cloneCustomMap(this.doc);
        const wl = next.walls.find((x) => x.id === ref.id);
        if (wl) {
          wl.style = { ...wl.style, pattern: patSel.value as WallPattern };
          this.commitDocChange(next, '修改墙面材质');
        }
      };
      wrap.append(this.makePropField('墙面纹样', patSel));
    }

    const row = document.createElement('div');
    row.className = 'ms-btn-row';
    row.append(
      this.makeMiniBtn('📋 复制', () => this.copyCurrentToClipboard()),
      this.makeMiniBtn('🗑️ 删除', () => this.deleteCurrentSelection(), 'ms-btn--danger'),
    );
    wrap.append(row);
    return wrap;
  }

  private makeTransformPanel(targetMeta?: { rot?: SpriteRot; flipX?: boolean; flipY?: boolean }): HTMLElement {
    const box = document.createElement('div');
    box.className = 'ms-transform-box';
    const metaInfo = targetMeta
      ? `角度 ${targetMeta.rot ?? 0}°${targetMeta.flipX ? ' · 水平镜像' : ''}${targetMeta.flipY ? ' · 垂直镜像' : ''}`
      : '统一几何与附加变换';
    box.innerHTML = `<div class="ms-transform-box__head"><span>🔄 选区 / 整组坐标旋转与镜像</span><small>${metaInfo}</small></div>`;
    const grid = document.createElement('div');
    grid.className = 'ms-transform-grid';
    grid.append(
      this.makeMiniBtn('↻ 顺90°', () => this.transformCurrent('rot90')),
      this.makeMiniBtn('↺ 逆90°', () => this.transformCurrent('rot270')),
      this.makeMiniBtn('⇄ 水平镜像', () => this.transformCurrent('flipX')),
      this.makeMiniBtn('⇅ 垂直镜像', () => this.transformCurrent('flipY')),
    );
    box.append(grid);
    return box;
  }

  private makeAttachedTransformControls(opts: {
    rot?: SpriteRot;
    flipX?: boolean;
    flipY?: boolean;
    title: string;
    onUpdate: (patch: { rot?: SpriteRot; flipX?: boolean; flipY?: boolean }) => void;
  }): HTMLElement {
    const box = document.createElement('div');
    box.className = 'ms-transform-box';
    const head = document.createElement('div');
    head.className = 'ms-transform-box__head';
    head.innerHTML = `<span>${opts.title}</span>`;
    box.append(head);

    const rotRow = document.createElement('div');
    rotRow.className = 'ms-btn-row';
    for (const deg of [0, 90, 180, 270] as const) {
      const active = (opts.rot ?? 0) === deg;
      rotRow.append(
        this.makeMiniBtn(
          `${deg}°`,
          () => opts.onUpdate({ rot: deg === 0 ? undefined : deg, flipX: opts.flipX, flipY: opts.flipY }),
          active ? 'ms-btn--cyan' : '',
        ),
      );
    }
    rotRow.append(
      this.makeMiniBtn(
        '⇄ 镜像X',
        () => opts.onUpdate({ rot: opts.rot, flipX: !opts.flipX, flipY: opts.flipY }),
        opts.flipX ? 'ms-btn--cyan' : '',
      ),
      this.makeMiniBtn(
        '⇅ 镜像Y',
        () => opts.onUpdate({ rot: opts.rot, flipX: opts.flipX, flipY: !opts.flipY }),
        opts.flipY ? 'ms-btn--cyan' : '',
      ),
      this.makeMiniBtn('重置', () => opts.onUpdate({})),
    );
    box.append(rotRow);
    return box;
  }

  // ------------------------------------------------------------------ PS Layers & Groups Tree (Requirement #7)

  private renderLayers(): void {
    const el = this.layersEl;
    el.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'ms-panel-head';
    head.innerHTML = `<span>🗂️ 图层与分组</span>`;
    el.append(head);

    const toolbar = document.createElement('div');
    toolbar.className = 'ms-layer-toolbar';
    toolbar.append(
      this.makeMiniBtn('+ 新建组', () => this.createEmptyGroup(), '', '新建空白图层分组'),
      this.makeMiniBtn('编组', () => this.groupCurrentSelection(), '', '将当前选中项编为新组 (Ctrl+G)'),
      this.makeMiniBtn('📋 复制', () => this.copyCurrentToClipboard(), '', '复制选中元素或分组 (Ctrl+C)'),
      this.makeMiniBtn('📌 粘贴', () => this.enterPasteMode(), '', '将剪贴板内容以印章方式贴入当前地图 (Ctrl+V)'),
    );
    el.append(toolbar);

    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'ms-input ms-input--xs ms-layer-filter';
    filterInput.placeholder = '过滤图层名称 / ID...';
    filterInput.value = this.layerFilter;
    filterInput.oninput = () => {
      this.layerFilter = filterInput.value.trim().toLowerCase();
      this.renderLayerListOnly(listWrap);
    };
    el.append(filterInput);

    const listWrap = document.createElement('div');
    listWrap.className = 'ms-layer-list';
    this.renderLayerListOnly(listWrap);
    el.append(listWrap);
  }

  private renderLayerListOnly(container: HTMLElement): void {
    container.innerHTML = '';

    // 1. Pinned Reference Image Row
    const ref = this.canvasEngine.getRefImage();
    if (ref) {
      const rRow = document.createElement('div');
      rRow.className = `ms-layer-row is-ref ${this.settings.tool === 'ref_move' ? 'is-selected' : ''}`;
      const label = document.createElement('span');
      label.className = 'ms-layer-row__name';
      label.textContent = `🖼️ 参考图: ${ref.name}`;
      label.onclick = () => {
        ref.locked = false;
        this.setTool('ref_move');
        this.renderRefHud();
      };

      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'ms-ico-btn';
      eye.textContent = ref.visible ? '👁' : '🙈';
      eye.onclick = () => {
        ref.visible = !ref.visible;
        this.canvasEngine.requestRender();
        this.renderLayerListOnly(container);
      };

      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'ms-ico-btn';
      lockBtn.textContent = ref.locked ? '🔒 调整' : '🔓 锁定';
      lockBtn.onclick = () => {
        ref.locked = !ref.locked;
        if (!ref.locked) this.setTool('ref_move');
        else if (this.settings.tool === 'ref_move') this.setTool('select');
        this.renderRefHud();
        this.renderLayerListOnly(container);
      };
      rRow.append(label, eye, lockBtn);
      container.append(rRow);
    }

    // 2. Layer Groups
    const groups = this.doc.groups ?? [];
    for (const grp of groups) {
      const gRow = document.createElement('div');
      gRow.className = `ms-layer-group-row ${this.selectedGroupId === grp.id ? 'is-selected' : ''}`;

      const colBtn = document.createElement('button');
      colBtn.type = 'button';
      colBtn.className = 'ms-ico-btn';
      colBtn.textContent = grp.collapsed ? '▶' : '▼';
      colBtn.onclick = () => {
        const next = cloneCustomMap(this.doc);
        const g = next.groups?.find((x) => x.id === grp.id);
        if (g) g.collapsed = !g.collapsed;
        this.activeTab.doc = next;
        this.renderLayerListOnly(container);
      };

      const xfText = `${grp.rot ? `↻${grp.rot}°` : ''}${grp.flipX ? '⇄' : ''}${grp.flipY ? '⇅' : ''}`;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'ms-layer-row__name';
      nameSpan.textContent = `📁 ${grp.name} (${this.countGroupMembers(grp.id)})${xfText ? ` [${xfText}]` : ''}`;
      nameSpan.onclick = () => {
        this.selectedGroupId = grp.id;
        this.selectedRefs = [];
        this.canvasEngine.requestRender();
        this.renderInspector();
        this.renderLayers();
        this.renderOptionsBar();
      };

      const eyeBtn = document.createElement('button');
      eyeBtn.type = 'button';
      eyeBtn.className = 'ms-ico-btn';
      eyeBtn.textContent = grp.visible === false ? '🙈' : '👁';
      eyeBtn.onclick = () => {
        const next = cloneCustomMap(this.doc);
        const g = next.groups?.find((x) => x.id === grp.id);
        if (g) g.visible = g.visible === false ? undefined : false;
        this.commitDocChange(next, '切换分组显隐');
      };

      const rotFastBtn = document.createElement('button');
      rotFastBtn.type = 'button';
      rotFastBtn.className = 'ms-ico-btn';
      rotFastBtn.title = '顺时针旋转整组 90°';
      rotFastBtn.textContent = '↻';
      rotFastBtn.onclick = () => {
        this.selectedGroupId = grp.id;
        this.transformCurrent('rot90');
      };

      const copyGrpBtn = document.createElement('button');
      copyGrpBtn.type = 'button';
      copyGrpBtn.className = 'ms-ico-btn';
      copyGrpBtn.title = '复制整组（可跨地图粘贴）';
      copyGrpBtn.textContent = '📋';
      copyGrpBtn.onclick = () => {
        this.selectedGroupId = grp.id;
        this.selectedRefs = [];
        this.copyCurrentToClipboard();
      };

      gRow.append(colBtn, nameSpan, rotFastBtn, copyGrpBtn, eyeBtn);
      container.append(gRow);

      if (!grp.collapsed) {
        const children = this.collectAllLayerEntries().filter((e) => e.groupId === grp.id);
        for (const ch of children) {
          if (this.layerFilter && !ch.label.toLowerCase().includes(this.layerFilter)) continue;
          container.append(this.buildElementLayerRow(ch, true));
        }
      }
    }

    // 3. Ungrouped elements (most recent first, capped cleanly at 160 rows with filter)
    const ungrouped = this.collectAllLayerEntries().filter((e) => !e.groupId);
    const filtered = this.layerFilter
      ? ungrouped.filter((e) => e.label.toLowerCase().includes(this.layerFilter))
      : ungrouped;
    for (const item of filtered.slice(-160).reverse()) {
      container.append(this.buildElementLayerRow(item, false));
    }
  }

  private buildElementLayerRow(
    item: { ref: MapElementRef; label: string; hidden: boolean; locked: boolean; xfBadge: string },
    indented: boolean,
  ): HTMLElement {
    const isSel = this.selectedRefs.some((r) => r.layer === item.ref.layer && r.id === item.ref.id);
    const row = document.createElement('div');
    row.className = `ms-layer-row ${indented ? 'is-indented' : ''} ${isSel ? 'is-selected' : ''}`;

    const name = document.createElement('span');
    name.className = 'ms-layer-row__name';
    name.textContent = `${item.label}${item.xfBadge ? ` [${item.xfBadge}]` : ''}`;
    name.onclick = (ev) => {
      this.selectedGroupId = null;
      if (ev.shiftKey) {
        this.selectedRefs = isSel
          ? this.selectedRefs.filter((r) => !(r.layer === item.ref.layer && r.id === item.ref.id))
          : [...this.selectedRefs, item.ref];
      } else {
        this.selectedRefs = [item.ref];
      }
      this.canvasEngine.requestRender();
      this.renderInspector();
      this.renderLayers();
      this.renderOptionsBar();
    };

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'ms-ico-btn';
    eye.textContent = item.hidden ? '🙈' : '👁';
    eye.onclick = () => {
      const next = cloneCustomMap(this.doc);
      const o = this.findRefObjectInDoc(next, item.ref);
      if (o) {
        if (o.hidden) delete o.hidden;
        else o.hidden = true;
        this.commitDocChange(next, '切换图层可见性');
      }
    };

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'ms-ico-btn';
    lock.textContent = item.locked ? '🔒' : '🔓';
    lock.onclick = () => {
      const next = cloneCustomMap(this.doc);
      const o = this.findRefObjectInDoc(next, item.ref);
      if (o) {
        if (o.locked) delete o.locked;
        else o.locked = true;
        this.commitDocChange(next, '切换图层锁定');
      }
    };

    row.append(name, eye, lock);
    return row;
  }

  private collectAllLayerEntries(): Array<{
    ref: MapElementRef;
    label: string;
    groupId?: string;
    hidden: boolean;
    locked: boolean;
    xfBadge: string;
  }> {
    const out: Array<{
      ref: MapElementRef;
      label: string;
      groupId?: string;
      hidden: boolean;
      locked: boolean;
      xfBadge: string;
    }> = [];
    const xfStr = (o: { rot?: SpriteRot; flipX?: boolean; flipY?: boolean }) =>
      `${o.rot ? `↻${o.rot}°` : ''}${o.flipX ? '⇄' : ''}${o.flipY ? '⇅' : ''}`;

    for (const z of this.doc.zones) {
      out.push({ ref: { layer: 'zone', id: z.id }, label: `📦 ${z.name}`, groupId: z.groupId, hidden: !!z.hidden, locked: !!z.locked, xfBadge: '' });
    }
    for (const sp of this.doc.spawns) {
      out.push({ ref: { layer: 'spawn', id: sp.id }, label: `🚪 出生点 (${sp.tx},${sp.ty})`, groupId: sp.groupId, hidden: !!sp.hidden, locked: !!sp.locked, xfBadge: '' });
    }
    for (const wl of this.doc.walls) {
      out.push({ ref: { layer: 'wall', id: wl.id }, label: `🧱 墙(${wl.kind}) ${wl.tx},${wl.ty}`, groupId: wl.groupId, hidden: !!wl.hidden, locked: !!wl.locked, xfBadge: '' });
    }
    for (const wi of this.doc.wallItems) {
      out.push({ ref: { layer: 'wallItem', id: wi.id }, label: `🖼️ ${wi.kind} (${wi.tx},${wi.ty})`, groupId: wi.groupId, hidden: !!wi.hidden, locked: !!wi.locked, xfBadge: xfStr(wi) });
    }
    for (const r of this.doc.rugs) {
      out.push({ ref: { layer: 'rug', id: r.id }, label: `🟫 地毯 ${r.w}×${r.h}`, groupId: r.groupId, hidden: !!r.hidden, locked: !!r.locked, xfBadge: '' });
    }
    for (const f of this.doc.furniture) {
      out.push({ ref: { layer: 'furniture', id: f.id }, label: `🪑 ${f.kind} (${f.tx},${f.ty})`, groupId: f.groupId, hidden: !!f.hidden, locked: !!f.locked, xfBadge: xfStr(f) });
    }
    return out;
  }

  private countGroupMembers(gid: string): number {
    const count = (arr: ReadonlyArray<{ groupId?: string }>) => arr.filter((x) => x.groupId === gid).length;
    return (
      count(this.doc.furniture) +
      count(this.doc.wallItems) +
      count(this.doc.walls) +
      count(this.doc.rugs) +
      count(this.doc.zones) +
      count(this.doc.spawns)
    );
  }

  // ------------------------------------------------------------------ Actions: Groups, Transforms, Cross-Map Copy/Paste

  private createEmptyGroup(): void {
    const next = cloneCustomMap(this.doc);
    const groups = [...(next.groups ?? [])];
    const gid = `grp-${Date.now().toString(36)}`;
    groups.push({ id: gid, name: `图层组 ${groups.length + 1}` });
    next.groups = groups;
    this.selectedGroupId = gid;
    this.selectedRefs = [];
    this.commitDocChange(next, '新建图层组');
  }

  private groupCurrentSelection(): void {
    if (!this.selectedRefs.length) {
      this.createEmptyGroup();
      return;
    }
    const next = cloneCustomMap(this.doc);
    const groups = [...(next.groups ?? [])];
    const gid = `grp-${Date.now().toString(36)}`;
    groups.push({ id: gid, name: `组合图层 ${groups.length + 1}` });
    next.groups = groups;
    for (const ref of this.selectedRefs) {
      const obj = this.findRefObjectInDoc(next, ref);
      if (obj) obj.groupId = gid;
    }
    this.selectedGroupId = gid;
    this.selectedRefs = [];
    this.commitDocChange(next, `已编组 (${groups[groups.length - 1].name})`);
  }

  private ungroupId(gid: string): void {
    const next = cloneCustomMap(this.doc);
    for (const arr of [next.furniture, next.wallItems, next.walls, next.rugs, next.zones, next.spawns]) {
      for (const item of arr) {
        if (item.groupId === gid) delete item.groupId;
      }
    }
    next.groups = (next.groups ?? []).filter((g) => g.id !== gid);
    if (this.selectedGroupId === gid) this.selectedGroupId = null;
    this.commitDocChange(next, '已解散分组');
  }

  private transformCurrent(op: TransformOp): void {
    if (this.settings.tool === 'stamp' && !this.selectedRefs.length && !this.selectedGroupId) {
      if (op === 'rot90') this.rotateStampPreview();
      else if (op === 'flipX') this.settings.stampFlipX = !this.settings.stampFlipX;
      else if (op === 'flipY') this.settings.stampFlipY = !this.settings.stampFlipY;
      this.canvasEngine.requestRender();
      return;
    }
    const gids = this.selectedGroupId ? [this.selectedGroupId] : [];
    if (!this.selectedRefs.length && !gids.length) {
      this.toast('请先选中需要旋转或镜像的元素 / 图层分组');
      return;
    }
    const next = transformSelectionInDoc(this.doc, this.selectedRefs, op, gids);
    this.commitDocChange(next, `执行变换: ${op}`);
  }

  private rotateStampPreview(): void {
    if (this.settings.tool === 'workstation') {
      const dirs: Dir[] = ['up', 'right', 'down', 'left'];
      this.settings.wsFacing = dirs[(dirs.indexOf(this.settings.wsFacing) + 1) % 4];
      this.renderOptionsBar();
      this.canvasEngine.requestRender();
      return;
    }
    const deskMap: Partial<Record<FurnitureKind, FurnitureKind>> = {
      desk: 'desk_east',
      desk_east: 'desk_back',
      desk_back: 'desk_west',
      desk_west: 'desk',
      office_chair: 'office_chair_right',
      office_chair_right: 'office_chair_front',
      office_chair_front: 'office_chair_left',
      office_chair_left: 'office_chair',
    };
    const nextKind = deskMap[this.settings.stampKind];
    if (nextKind) {
      this.settings.stampKind = nextKind;
    } else if (this.settings.stampKind === 'cafe_chair' || this.settings.stampKind === 'armchair') {
      const dirs: Dir[] = ['up', 'right', 'down', 'left'];
      const cur = dirs.includes(this.settings.stampVariant as Dir) ? (this.settings.stampVariant as Dir) : 'down';
      this.settings.stampVariant = dirs[(dirs.indexOf(cur) + 1) % 4];
    } else if (this.settings.stampKind === 'glass_partition') {
      this.settings.stampVariant = this.settings.stampVariant === 'v' ? 'h' : 'v';
    } else {
      this.settings.stampRot = (((this.settings.stampRot + 90) % 360) as SpriteRot);
    }
    this.renderOptionsBar();
    this.canvasEngine.requestRender();
  }

  private copyCurrentToClipboard(): void {
    if (this.marquee && !this.selectedRefs.length && !this.selectedGroupId) {
      this.copyMarqueeToClipboard();
      return;
    }
    const gids = this.selectedGroupId ? [this.selectedGroupId] : [];
    const payload = copySelectionToClipboard(this.doc, this.selectedRefs, gids);
    if (!payload) {
      this.toast('请先选中元素、图层分组或使用矩形选框 (M) 框选后再复制');
      return;
    }
    this.pasteClip = payload;
    saveMapClipboard(payload);
    this.renderOptionsBar();
    this.toast(`📋 已复制到跨地图剪贴板（${payload.furniture.length} 家具 / ${payload.walls.length} 墙体），可切换到任意地图标签按 Ctrl+V 粘贴！`);
  }

  private copyMarqueeToClipboard(): void {
    if (!this.marquee) return;
    const payload = copyRectToClipboard(this.doc, this.marquee, true);
    if (!payload) return;
    this.pasteClip = payload;
    saveMapClipboard(payload);
    this.renderOptionsBar();
    this.toast(`📋 已整块复制 ${payload.width}×${payload.height}（含地板+墙体+家具+区域），切换到任意地图按 Ctrl+V 粘贴！`);
  }

  private enterPasteMode(): void {
    const clip = loadMapClipboard() ?? this.pasteClip;
    if (!clip) {
      this.toast('剪贴板为空，请先复制选区、元件或分组');
      return;
    }
    this.pasteClip = clip;
    this.setTool('paste');
    this.toast(`📌 已进入粘贴印章模式：移动鼠标预览，按 R 旋转 / X,Y 镜像，左键点击即可贴入当前地图！`);
  }

  private duplicateCurrentInPlace(): void {
    const gids = this.selectedGroupId ? [this.selectedGroupId] : [];
    const payload = copySelectionToClipboard(this.doc, this.selectedRefs, gids);
    if (!payload) {
      this.toast('请先选中需要原地复制的元素或分组');
      return;
    }
    // Find current top-left bounds so we offset +1,+1 neatly
    let minX = Infinity;
    let minY = Infinity;
    const expand = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    };
    const allRefs = this.selectedRefs.length ? this.selectedRefs : this.collectAllLayerEntries().filter((e) => e.groupId && gids.includes(e.groupId)).map((e) => e.ref);
    for (const r of allRefs) {
      const o = this.findRefObject(r);
      if (!o) continue;
      if (r.layer === 'zone') expand((o.rect as { x: number; y: number }).x, (o.rect as { x: number; y: number }).y);
      else if (r.layer === 'rug') expand(Number(o.x), Number(o.y));
      else expand(Number(o.tx), Number(o.ty));
    }
    const anchorX = Number.isFinite(minX) ? Math.floor(minX) + 1 : 2;
    const anchorY = Number.isFinite(minY) ? Math.floor(minY) + 1 : 2;
    const res = pasteClipboardIntoDoc(this.doc, payload, anchorX, anchorY);
    this.selectedRefs = res.insertedRefs;
    this.selectedGroupId = res.insertedGroupIds[0] ?? null;
    this.commitDocChange(res.doc, `原地复制 (${res.insertedRefs.length} 项)`);
    this.toast(`📋 已原地偏移复制 ${res.insertedRefs.length} 项`);
  }

  private transformPasteClip(op: TransformOp): void {
    if (!this.pasteClip) return;
    this.pasteClip = transformClipboardPayload(this.pasteClip, op);
    this.renderOptionsBar();
    this.canvasEngine.requestRender();
  }

  private performPasteAt(tx: number, ty: number): void {
    if (!this.pasteClip) return;
    const res = pasteClipboardIntoDoc(this.doc, this.pasteClip, tx, ty, {
      pasteFloor: this.pasteClip.hasFloor,
      wrapInGroupName: `粘贴区块 (${this.pasteClip.sourceName})`,
    });
    this.selectedRefs = res.insertedRefs;
    this.selectedGroupId = res.insertedGroupIds[0] ?? null;
    this.commitDocChange(res.doc, `跨地图粘贴 (${tx},${ty})`);
    this.setTool('select');
    this.toast(`✅ 已粘贴 ${res.insertedRefs.length} 个元素！`);
  }

  private deleteCurrentSelection(): void {
    if (!this.selectedRefs.length && !this.selectedGroupId) return;
    const next = cloneCustomMap(this.doc);
    const killKeys = new Set(this.selectedRefs.map((r) => `${r.layer}:${r.id}`));
    const gid = this.selectedGroupId;
    next.furniture = next.furniture.filter((x) => !killKeys.has(`furniture:${x.id}`) && (!gid || x.groupId !== gid));
    next.wallItems = next.wallItems.filter((x) => !killKeys.has(`wallItem:${x.id}`) && (!gid || x.groupId !== gid));
    next.walls = next.walls.filter((x) => !killKeys.has(`wall:${x.id}`) && (!gid || x.groupId !== gid));
    next.rugs = next.rugs.filter((x) => !killKeys.has(`rug:${x.id}`) && (!gid || x.groupId !== gid));
    next.zones = next.zones.filter((x) => !killKeys.has(`zone:${x.id}`) && (!gid || x.groupId !== gid));
    next.spawns = next.spawns.filter((x) => !killKeys.has(`spawn:${x.id}`) && (!gid || x.groupId !== gid));
    if (gid) next.groups = (next.groups ?? []).filter((g) => g.id !== gid);
    this.selectedRefs = [];
    this.selectedGroupId = null;
    this.commitDocChange(next, '删除选中元素');
  }

  private clearMarqueeRegion(): void {
    if (!this.marquee) return;
    const rect = { ...this.marquee };
    const next = clearRectInDoc(this.doc, rect, this.doc.backgroundFloor);
    this.marquee = null;
    this.commitDocChange(next, '清空选区内容', rect);
  }

  private convertMarqueeToAiBox(): void {
    if (!this.marquee) return;
    const box: StudioTaskBox = {
      id: `box-${Date.now().toString(36)}`,
      label: `区块 #${this.activeTab.aiBoxes.length + 1}`,
      ...this.marquee,
    };
    this.activeTab.aiBoxes = [...this.activeTab.aiBoxes, box];
    this.activeTab.activeAiBoxId = box.id;
    this.marquee = null;
    this.setTool('ai_box');
    this.renderAiDock();
    this.scheduleSyncSelectionToMcp();
  }

  // ------------------------------------------------------------------ Bottom AI Box Dock (Requirement #8)

  private renderAiDock(): void {
    const el = this.aiBarEl;
    el.innerHTML = '';
    const tab = this.activeTab;
    const reviewTask = this.tasks.find((t) => t.status === 'review');
    const shouldShow = this.settings.tool === 'ai_box' || tab.aiBoxes.length > 0 || !!reviewTask;
    el.hidden = !shouldShow;
    if (!shouldShow) return;

    const top = document.createElement('div');
    top.className = 'ms-ai-dock__top';

    const title = document.createElement('span');
    title.className = 'ms-ai-dock__title';
    title.textContent = `🤖 AI 框选队列 (${tab.aiBoxes.length})`;

    const instInput = document.createElement('input');
    instInput.className = 'ms-input ms-input--xs ms-ai-dock__inst';
    instInput.placeholder = '输入给 AI 的整体说明（例如：把框选1改为咖啡区，框选2排布6个面对面工位）';
    instInput.value = tab.aiInstruction;
    instInput.oninput = () => {
      tab.aiInstruction = instInput.value;
      this.scheduleSyncSelectionToMcp();
    };

    const copyPromptBtn = document.createElement('button');
    copyPromptBtn.type = 'button';
    copyPromptBtn.className = 'ms-btn ms-btn--xs ms-btn--cyan';
    copyPromptBtn.textContent = '📋 复制启动提示词 (推荐)';
    copyPromptBtn.title = '连接 MCP 后，复制这段提示词发给 AI 对话框立即读取框选修改';
    copyPromptBtn.onclick = async () => {
      await this.ensureMcpSession();
      this.scheduleSyncSelectionToMcp(true);
      await this.openMcpModal();
    };

    const sendListenBtn = document.createElement('button');
    sendListenBtn.type = 'button';
    sendListenBtn.className = 'ms-btn ms-btn--primary ms-btn--xs';
    sendListenBtn.textContent = '🚀 发送给监听中的 AI';
    sendListenBtn.onclick = () => void this.dispatchAiTask();

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ms-btn ms-btn--xs';
    clearBtn.textContent = '清空框选';
    clearBtn.onclick = () => {
      tab.aiBoxes = [];
      tab.activeAiBoxId = null;
      this.renderAiDock();
      this.canvasEngine.requestRender();
      this.scheduleSyncSelectionToMcp();
    };

    top.append(title, instInput, copyPromptBtn, sendListenBtn, clearBtn);
    el.append(top);

    if (tab.aiBoxes.length > 0) {
      const strip = document.createElement('div');
      strip.className = 'ms-ai-boxes-strip';
      for (const b of tab.aiBoxes) {
        const chip = document.createElement('div');
        chip.className = `ms-ai-box-chip ${tab.activeAiBoxId === b.id ? 'is-active' : ''}`;
        chip.innerHTML = `<span>${b.label} [${b.x},${b.y} ${b.w}×${b.h}]</span>`;
        const noteIn = document.createElement('input');
        noteIn.className = 'ms-input ms-input--xs';
        noteIn.placeholder = '区块要求...';
        noteIn.value = b.note ?? '';
        noteIn.oninput = () => {
          b.note = noteIn.value;
          this.canvasEngine.requestRender();
          this.scheduleSyncSelectionToMcp();
        };
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ms-ico-btn';
        del.textContent = '×';
        del.onclick = () => {
          tab.aiBoxes = tab.aiBoxes.filter((x) => x.id !== b.id);
          this.renderAiDock();
          this.canvasEngine.requestRender();
          this.scheduleSyncSelectionToMcp();
        };
        chip.onclick = () => {
          tab.activeAiBoxId = b.id;
          this.canvasEngine.requestRender();
        };
        chip.append(noteIn, del);
        strip.append(chip);
      }
      el.append(strip);
    }

    if (reviewTask) {
      const revBar = document.createElement('div');
      revBar.className = 'ms-ai-review-bar';
      revBar.innerHTML = `<span>✨ AI 已完成任务 #${reviewTask.seq}：${reviewTask.aiSummary || '请检查画布修改效果'}</span>`;
      revBar.append(
        this.makeMiniBtn('✅ 确认保留', () => void this.resolveReviewTask(reviewTask.id, 'accept'), 'ms-btn--primary'),
        this.makeMiniBtn('↩️ 恢复修改前原样', () => void this.resolveReviewTask(reviewTask.id, 'revert'), 'ms-btn--danger'),
      );
      el.append(revBar);
    }
  }

  // ------------------------------------------------------------------ Status Bar

  private renderStatusCoord(tx: number, ty: number, inBounds: boolean): void {
    const coordEl = this.statusLeftEl.querySelector('[data-slot="coord"]');
    if (coordEl) {
      coordEl.textContent = inBounds ? `X=${tx}, Y=${ty}` : `(${tx}, ${ty}) 越界`;
    }
  }

  private renderStatusBar(_hint?: string): void {
    this.statusLeftEl.innerHTML = '';
    const coord = document.createElement('span');
    coord.dataset.slot = 'coord';
    coord.textContent = 'X=0, Y=0';
    const dim = document.createElement('span');
    dim.className = 'ms-status-mode';
    dim.textContent = `${this.doc.width}×${this.doc.height}`;
    this.statusLeftEl.append(coord, dim);

    this.statusRightEl.innerHTML = '';
    const mkToggle = (label: string, active: boolean, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ms-btn ms-btn--xs ${active ? 'ms-btn--cyan' : ''}`;
      b.textContent = label;
      b.onclick = fn;
      return b;
    };

    const zoomTxt = document.createElement('span');
    zoomTxt.className = 'ms-zoom-label';
    zoomTxt.textContent = `${Math.round(this.canvasEngine.getZoom() * 100)}%`;

    this.statusRightEl.append(
      mkToggle('# 网格', this.settings.showGrid, () => {
        this.settings.showGrid = !this.settings.showGrid;
        this.canvasEngine.requestRender();
        this.renderStatusBar();
      }),
      mkToggle('🚦 热区', this.settings.showWalkability, () => {
        this.settings.showWalkability = !this.settings.showWalkability;
        this.canvasEngine.requestRender();
        this.renderStatusBar();
      }),
      mkToggle('📦 分区框', this.settings.showZones, () => {
        this.settings.showZones = !this.settings.showZones;
        this.canvasEngine.requestRender();
        this.renderStatusBar();
      }),
      mkToggle('适屏', false, () => this.canvasEngine.fitToMap()),
      mkToggle('−', false, () => this.canvasEngine.setZoom(this.canvasEngine.getZoom() / 1.25)),
      zoomTxt,
      mkToggle('+', false, () => this.canvasEngine.setZoom(this.canvasEngine.getZoom() * 1.25)),
    );
  }

  // ------------------------------------------------------------------ Modals (Canvas Settings, I/O, MCP, Admin Publish)

  private openCanvasSettings(): void {
    this.settingsModal.open(this.doc, {
      onApplyMeta: (name, author, bgFloor) => {
        const next = cloneCustomMap(this.doc);
        next.name = name;
        if (author) next.author = author;
        else delete next.author;
        next.backgroundFloor = bgFloor;
        this.commitDocChange(next, `更新画布属性: ${name}`);
        this.renderHeaderActions();
      },
      onResize: (width, height, anchor) => {
        const nw = clampMapDim(width, this.doc.width);
        const nh = clampMapDim(height, this.doc.height);
        const dx = nw - this.doc.width;
        const dy = nh - this.doc.height;
        const [ox, oy] = this.computeAnchorOffset(dx, dy, anchor);
        const next = resizeCustomMap(this.doc, nw, nh, ox, oy);
        this.commitDocChange(next, `调整画布尺寸 ${nw}×${nh}`);
        this.canvasEngine.fitToMap();
        this.renderHeaderActions();
      },
      onApplyTemplate: async (tpl) => {
        if (tpl === 'starter') {
          this.commitDocChange(createStarterOfficeMap(2, 96, 64, 'Agent Party 标准园区'), '套用标准办公模板');
        } else if (tpl === 'room32') {
          this.commitDocChange(createBlankGrassMap(32, 24, '独立小房间草稿'), '新建 32×24 空白小房间');
        } else if (tpl === 'blank') {
          this.commitDocChange(createBlankGrassMap(this.doc.width, this.doc.height, this.doc.name), '清空为空白画布');
        } else if (tpl === 'server_live') {
          try {
            const res = await fetch('/api/map');
            const data = (await res.json()) as { map?: CustomMapDocument | null };
            if (data.map) {
              const p = parseCustomMapJson(data.map);
              if (p.ok) {
                this.commitDocChange(p.doc, `拉取线上地图: ${p.doc.name}`);
                this.toast('✅ 已单次拷贝当前线上地图到本地画布！');
              }
            } else {
              this.toast('ℹ️ 线上当前为默认自动建筑模式，已为您载入标准园区模板');
              this.commitDocChange(createStarterOfficeMap(2, 96, 64, '标准园区副本'), '载入标准模板');
            }
          } catch {
            this.toast('❌ 拉取线上地图失败，请确认网络畅通');
          }
        }
        this.canvasEngine.fitToMap();
      },
      onJumpToSpot: (tx, ty) => this.canvasEngine.centerOnTile(tx, ty),
    });
  }

  private computeAnchorOffset(dx: number, dy: number, anchor: ResizeAnchor): [number, number] {
    const ox = anchor.includes('e') ? dx : anchor === 'n' || anchor === 'c' || anchor === 's' ? Math.round(dx / 2) : 0;
    const oy = anchor.includes('s') ? dy : anchor === 'w' || anchor === 'c' || anchor === 'e' ? Math.round(dy / 2) : 0;
    return [ox, oy];
  }

  private openIoModal(): void {
    const el = this.ioModalEl;
    el.hidden = false;
    el.innerHTML = '';
    el.onclick = (ev) => {
      if (ev.target === el) el.hidden = true;
    };

    const card = document.createElement('div');
    card.className = 'ms-modal ms-io-modal';
    card.innerHTML = `<div class="ms-modal__header"><div class="ms-modal__title">📂 导入 / 导出地图数据</div><button type="button" class="ms-btn ms-btn--ghost ms-btn--sm" data-close="1">✕ 关闭</button></div>`;
    card.querySelector('[data-close]')?.addEventListener('click', () => (el.hidden = true));

    const body = document.createElement('div');
    body.className = 'ms-modal__body ms-io-body';

    const btnRow = document.createElement('div');
    btnRow.className = 'ms-btn-row';
    btnRow.append(
      this.makeMiniBtn('💾 导出 JSON 文件', () => {
        const blob = new Blob([serializeCustomMapJson(this.doc, true)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${this.doc.id || 'agent-party-map'}.json`;
        a.click();
        this.toast('✅ JSON 文件已导出');
      }, 'ms-btn--primary'),
      this.makeMiniBtn('📂 从本地导入 JSON 文件', () => {
        el.hidden = true;
        this.jsonFileInput.click();
      }),
      this.makeMiniBtn('🖼️ 导出画布 PNG', () => {
        const a = document.createElement('a');
        a.href = this.canvasEngine.canvas.toDataURL('image/png');
        a.download = `${this.doc.id || 'map-preview'}.png`;
        a.click();
      }),
    );

    const ta = document.createElement('textarea');
    ta.className = 'ms-copy-textarea';
    ta.rows = 10;
    ta.value = serializeCustomMapJson(this.doc, true);

    const importTextBtn = this.makeMiniBtn('📥 从上方文本框导入覆盖当前地图', () => {
      const parsed = parseCustomMapJson(ta.value);
      if (!parsed.ok) {
        this.toast(`❌ JSON 格式错误: ${parsed.error}`);
        return;
      }
      this.commitDocChange(parsed.doc, '导入文本 JSON');
      el.hidden = true;
      this.canvasEngine.fitToMap();
      this.toast('✅ 已导入地图 JSON');
    });

    const copyJsonBtn = this.makeMiniBtn('📋 复制 JSON', async () => {
      const res = await copyTextSafe(ta.value, ta);
      this.toast(res.copied ? '✅ 已复制完整地图 JSON' : '⚠️ 已为您全选文本框，请按 Ctrl+C 复制');
    });

    body.append(btnRow, ta, this.wrapRow(copyJsonBtn, importTextBtn));
    card.append(body);
    el.append(card);
  }

  private openPublishModal(): void {
    const el = this.publishModalEl;
    el.hidden = false;
    el.innerHTML = '';
    el.onclick = (ev) => {
      if (ev.target === el) el.hidden = true;
    };

    const card = document.createElement('div');
    card.className = 'ms-modal ms-pub-modal';
    card.innerHTML = `<div class="ms-modal__header"><div class="ms-modal__title">🚀 发布地图并同步至前台办公室</div><button type="button" class="ms-btn ms-btn--ghost ms-btn--sm" data-close="1">✕ 关闭</button></div>`;
    card.querySelector('[data-close]')?.addEventListener('click', () => (el.hidden = true));

    const body = document.createElement('div');
    body.className = 'ms-modal__body ms-insp-stack';

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'ms-input';
    keyInput.placeholder = '输入管理员密钥 (data/admin.key 或已登录管理后台可留空)';

    const nameInput = document.createElement('input');
    nameInput.className = 'ms-input';
    nameInput.value = this.doc.name;

    const statusOut = document.createElement('div');
    statusOut.className = 'ms-muted';

    const pubBtn = this.makeMiniBtn('🚀 保存预设并立即在线启用此地图', async () => {
      statusOut.textContent = '⏳ 正在发布...';
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (keyInput.value.trim()) headers['X-Admin-Key'] = keyInput.value.trim();
        const nextDoc = { ...cloneCustomMap(this.doc), name: nameInput.value.trim() || this.doc.name };
        const res = await fetch('/api/admin/maps/presets', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: nextDoc.id, name: nextDoc.name, activate: true, doc: nextDoc }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          statusOut.textContent = `❌ 发布失败: ${data.error || res.statusText}`;
          return;
        }
        statusOut.textContent = '✅ 已成功发布并上线！前台办公室现已生效。';
        this.toast('🚀 地图已上线！');
      } catch (err) {
        statusOut.textContent = `❌ 网络请求失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    }, 'ms-btn--primary');

    body.append(
      this.makePropField('发布名称', nameInput),
      this.makePropField('管理员密钥', keyInput),
      pubBtn,
      statusOut,
    );
    card.append(body);
    el.append(card);
  }

  // ------------------------------------------------------------------ Lazy On-Demand MCP Connection

  private async ensureMcpSession(resumeToken?: string, quiet = false): Promise<boolean> {
    if (this.sessionId && this.studioToken) return true;
    try {
      const res = await fetch('/api/map/studio/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resumeToken ? { resumeToken } : { doc: this.doc }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        sessionId: string;
        studioToken: string;
        presence?: StudioMcpPresence;
        tasks?: StudioTaskSummary[];
        endpoints?: { baseUrl: string; lanUrl: string | null };
      };
      this.sessionId = data.sessionId;
      this.studioToken = data.studioToken;
      if (data.presence) this.presence = data.presence;
      if (data.tasks) this.tasks = data.tasks;
      if (data.endpoints) this.endpoints = data.endpoints;
      localStorage.setItem(STUDIO_TOKEN_STORAGE_KEY, data.studioToken);
      this.connectStudioSse();
      this.renderHeaderActions();
      this.scheduleSyncDraftToMcp(true);
      this.scheduleSyncSelectionToMcp(true);
      return true;
    } catch {
      if (!quiet) this.toast('❌ 连接服务端 MCP 会话失败');
      return false;
    }
  }

  private connectStudioSse(): void {
    this.studioSse?.close();
    if (!this.sessionId || !this.studioToken) return;
    const es = new EventSource(`/api/map/studio/${encodeURIComponent(this.sessionId)}/events?token=${encodeURIComponent(this.studioToken)}`);
    this.studioSse = es;
    const handleEv = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          doc?: CustomMapDocument;
          patchRect?: { x: number; y: number; w: number; h: number };
          tasks?: StudioTaskSummary[];
          presence?: StudioMcpPresence;
        };
        if (msg.presence) {
          this.presence = msg.presence;
          this.renderHeaderActions();
        }
        if (msg.tasks) {
          this.tasks = msg.tasks;
          this.renderAiDock();
        }
        if (msg.type === 'draft' && msg.doc) {
          const parsed = parseCustomMapJson(msg.doc);
          if (parsed.ok) {
            this.commitDocChangeFromRemote(parsed.doc, msg.patchRect);
          }
        }
        if (this.mcpModal.isOpen) {
          this.mcpModal.update(this.buildMcpModalCtx());
        }
      } catch {
        // ignore parse glitch
      }
    };
    es.addEventListener('draft', handleEv);
    es.addEventListener('tasks', handleEv);
    es.addEventListener('presence', handleEv);
  }

  private commitDocChangeFromRemote(next: CustomMapDocument, dirtyRect?: { x: number; y: number; w: number; h: number }): void {
    const tab = this.activeTab;
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(cloneCustomMap(next));
    if (tab.history.length > MAX_HISTORY) tab.history.shift();
    tab.historyIndex = tab.history.length - 1;
    tab.doc = next;
    if (dirtyRect) this.canvasEngine.invalidateChunksOnly(dirtyRect);
    else this.canvasEngine.invalidateMap();
    this.saveTabsToLocal();
    this.renderTopTabs();
    this.renderInspector();
    this.renderLayers();
    this.toast('🤖 AI 已实时更新画布内容');
  }

  private scheduleSyncDraftToMcp(immediate = false): void {
    if (!this.sessionId || !this.studioToken) return;
    if (this.mcpPushTimer) clearTimeout(this.mcpPushTimer);
    const send = () => {
      void fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Token': this.studioToken,
        },
        body: JSON.stringify({ doc: this.doc }),
      }).catch(() => {});
    };
    if (immediate) send();
    else this.mcpPushTimer = window.setTimeout(send, 400);
  }

  private scheduleSyncSelectionToMcp(immediate = false): void {
    if (!this.sessionId || !this.studioToken) return;
    if (this.selPushTimer) clearTimeout(this.selPushTimer);
    const send = () => {
      const boxes = this.activeTab.aiBoxes;
      const b0 = boxes[0];
      void fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/selection`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Token': this.studioToken,
        },
        body: JSON.stringify({
          ...(b0 ? { x: b0.x, y: b0.y, w: b0.w, h: b0.h, note: b0.note } : { clear: true }),
          draftBoxes: boxes,
          instruction: this.activeTab.aiInstruction,
        }),
      }).catch(() => {});
    };
    if (immediate) send();
    else this.selPushTimer = window.setTimeout(send, 200);
  }

  private buildMcpModalCtx() {
    return {
      sessionId: this.sessionId,
      studioToken: this.studioToken,
      endpoints: this.endpoints,
      presence: this.presence,
      tasks: this.tasks,
      draftBoxes: this.activeTab.aiBoxes,
      draftInstruction: this.activeTab.aiInstruction,
      onRotateToken: async () => {
        if (!this.sessionId) return;
        const res = await fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/rotate-token`, {
          method: 'POST',
          headers: { 'X-Studio-Token': this.studioToken },
        });
        const data = (await res.json()) as { ok?: boolean; studioToken?: string };
        if (data.ok && data.studioToken) {
          this.studioToken = data.studioToken;
          localStorage.setItem(STUDIO_TOKEN_STORAGE_KEY, data.studioToken);
          this.connectStudioSse();
          this.mcpModal.update(this.buildMcpModalCtx());
          this.toast('🔄 令牌已刷新');
        }
      },
      onConnectSession: async () => {
        const ok = await this.ensureMcpSession();
        if (ok) {
          this.mcpModal.update(this.buildMcpModalCtx());
          this.toast('✅ 已建立专属 MCP 会话，可复制下方启动提示词发给 AI');
        }
      },
      onToast: (m: string) => this.toast(m),
    };
  }

  private async openMcpModal(): Promise<void> {
    await this.ensureMcpSession(undefined, true);
    this.mcpModal.open(this.buildMcpModalCtx());
  }

  private async dispatchAiTask(): Promise<void> {
    if (!this.activeTab.aiBoxes.length) {
      this.toast('请先使用左侧【🤖 AI 框选 (A)】在画布框出目标区域');
      return;
    }
    const ok = await this.ensureMcpSession();
    if (!ok) return;
    await this.scheduleSyncSelectionToMcp(true);
    const res = await fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': this.studioToken },
      body: JSON.stringify({
        boxes: this.activeTab.aiBoxes,
        instruction: this.activeTab.aiInstruction,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; tasks?: StudioTaskSummary[]; error?: string };
    if (!res.ok || !data.ok) {
      this.toast(`❌ 发送失败: ${data.error || res.statusText}`);
      return;
    }
    if (data.tasks) this.tasks = data.tasks;
    this.renderAiDock();
    if (!this.presence.listening) {
      this.toast('⏳ 任务已入队：如 AI 尚未挂起监听，可点【📋 复制启动提示词】发进 AI 对话框让它立即执行！');
    } else {
      this.toast('🚀 已实时派发给正在监听中的 AI！');
    }
  }

  private async resolveReviewTask(taskId: string, action: 'accept' | 'revert'): Promise<void> {
    if (!this.sessionId) return;
    const res = await fetch(`/api/map/studio/${encodeURIComponent(this.sessionId)}/tasks/${encodeURIComponent(taskId)}/${action}`, {
      method: 'POST',
      headers: { 'X-Studio-Token': this.studioToken },
    });
    const data = (await res.json()) as { ok?: boolean; tasks?: StudioTaskSummary[]; doc?: CustomMapDocument };
    if (data.tasks) this.tasks = data.tasks;
    if (action === 'revert' && data.doc) {
      const p = parseCustomMapJson(data.doc);
      if (p.ok) this.commitDocChange(p.doc, '恢复 AI 修改前原样');
    }
    this.renderAiDock();
    this.toast(action === 'accept' ? '✅ 已确认保留 AI 修改' : '↩️ 已还原至修改前状态');
  }

  // ------------------------------------------------------------------ Keyboard Shortcuts

  private bindGlobalKeys(): void {
    window.addEventListener('keydown', (ev) => {
      const t = ev.target as HTMLElement | null;
      const typing =
        t && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);
      if (typing) return;

      if (ev.key === 'Tab') {
        ev.preventDefault();
        const bothCollapsed = this.leftCollapsed && this.rightCollapsed;
        this.toggleLeftPanel(!bothCollapsed);
        this.toggleRightPanel(!bothCollapsed);
        return;
      }

      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        this.redo();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'c') {
        ev.preventDefault();
        this.copyCurrentToClipboard();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'v') {
        ev.preventDefault();
        this.enterPasteMode();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'd') {
        ev.preventDefault();
        this.duplicateCurrentInPlace();
        return;
      }
      if (mod && ev.key.toLowerCase() === 'g') {
        ev.preventDefault();
        this.groupCurrentSelection();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (this.selectedRefs.length || this.selectedGroupId) {
          ev.preventDefault();
          this.deleteCurrentSelection();
        }
        return;
      }
      if (ev.key === 'Escape') {
        if (this.settings.tool === 'paste') this.setTool('select');
        else if (this.marquee) {
          this.marquee = null;
          this.canvasEngine.requestRender();
          this.renderOptionsBar();
        }
        return;
      }

      const k = ev.key.toLowerCase();
      if (k === 'r' && (this.settings.tool === 'stamp' || this.settings.tool === 'workstation')) {
        ev.preventDefault();
        this.rotateStampPreview();
        return;
      }
      if (k === 'r' && this.settings.tool === 'paste') {
        ev.preventDefault();
        this.transformPasteClip('rot90');
        return;
      }
      if (k === 'x' && this.settings.tool === 'paste') {
        ev.preventDefault();
        this.transformPasteClip('flipX');
        return;
      }
      if (k === 'y' && this.settings.tool === 'paste') {
        ev.preventDefault();
        this.transformPasteClip('flipY');
        return;
      }

      const toolMap: Record<string, StudioToolId> = {
        v: 'select',
        m: 'marquee',
        b: 'brush',
        r: 'rect',
        k: 'workstation',
        p: 'stamp',
        e: 'eraser',
        i: 'eyedropper',
        a: 'ai_box',
        o: 'ref_move',
        h: 'pan',
      };
      if (!mod && toolMap[k]) {
        this.setTool(toolMap[k]);
      }
    });
  }

  // ------------------------------------------------------------------ Helpers

  private findRefObject(ref: MapElementRef): Record<string, unknown> | undefined {
    return this.findRefObjectInDoc(this.doc, ref) as Record<string, unknown> | undefined;
  }

  private findRefObjectInDoc(doc: CustomMapDocument, ref: MapElementRef): Record<string, unknown> | undefined {
    const arr =
      ref.layer === 'furniture'
        ? doc.furniture
        : ref.layer === 'wallItem'
          ? doc.wallItems
          : ref.layer === 'wall'
            ? doc.walls
            : ref.layer === 'rug'
              ? doc.rugs
              : ref.layer === 'zone'
                ? doc.zones
                : doc.spawns;
    return arr.find((x) => x.id === ref.id) as unknown as Record<string, unknown> | undefined;
  }

  private makePropField(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('label');
    row.className = 'ms-field';
    const span = document.createElement('span');
    span.className = 'ms-field__label';
    span.textContent = label;
    row.append(span, control);
    return row;
  }

  private makeMiniBtn(text: string, onClick: () => void, cls = '', title = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ms-btn ms-btn--xs ${cls}`;
    b.textContent = text;
    if (title) b.title = title;
    b.onclick = onClick;
    return b;
  }

  private wrapRow(...children: HTMLElement[]): HTMLElement {
    const d = document.createElement('div');
    d.className = 'ms-btn-row';
    d.append(...children);
    return d;
  }

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, 3600);
  }
}

export function startMapStudio(opts: { initialView?: 'canvas' | 'catalog' } = {}): void {
  const studio = new MapStudioApp({ initialView: opts.initialView ?? 'canvas' });
  Object.assign(window, { agentPartyStudio: studio });
}
