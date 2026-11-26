import type { StudioMcpPresence, StudioTaskBox, StudioTaskSummary } from '../../../../shared/map';
import { copyTextSafe } from './clipboard-http-utils';

export interface McpModalContext {
  sessionId: string;
  studioToken: string;
  endpoints: { baseUrl: string; lanUrl: string | null };
  presence: StudioMcpPresence;
  tasks: StudioTaskSummary[];
  draftBoxes: readonly StudioTaskBox[];
  draftInstruction: string;
  onRotateToken: () => Promise<void>;
  onConnectSession: () => Promise<void>;
  onToast: (msg: string) => void;
}

export class McpModal {
  readonly el: HTMLElement;
  private hostMode: 'auto' | 'lan' = 'auto';
  private activeTab: 'prompts' | 'config' | 'guide' = 'prompts';
  private lastCtx: McpModalContext | null = null;

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

  open(ctx: McpModalContext): void {
    this.lastCtx = ctx;
    this.el.hidden = false;
    this.render();
  }

  update(ctx: McpModalContext): void {
    this.lastCtx = ctx;
    if (this.isOpen) this.render();
  }

  close(): void {
    this.el.hidden = true;
  }

  private effectiveOrigin(ctx: McpModalContext): string {
    if (this.hostMode === 'lan' && ctx.endpoints.lanUrl) {
      return ctx.endpoints.lanUrl.replace(/\/+$/, '');
    }
    const raw = (ctx.endpoints.baseUrl || location.origin).replace(/\/+$/, '');
    if (ctx.endpoints.lanUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(raw)) {
      return ctx.endpoints.lanUrl.replace(/\/+$/, '');
    }
    return raw;
  }

  private render(): void {
    const ctx = this.lastCtx;
    if (!ctx) return;

    const origin = this.effectiveOrigin(ctx);
    const mcpUrl = `${origin}/api/mcp/${ctx.studioToken || '<尚未建立会话>'}`;
    const scriptUrl = `${origin}/client-scripts/map-mcp.mjs`;
    const setupMdUrl = `${origin}/map-studio-setup.md?token=${encodeURIComponent(ctx.studioToken || '')}&base=${encodeURIComponent(origin)}`;

    const boxSummary = ctx.draftBoxes.length
      ? `（当前已框选 ${ctx.draftBoxes.length} 个区块：${ctx.draftBoxes
          .map((b) => `${b.label}[${b.x},${b.y},${b.w}x${b.h}]${b.note ? `:${b.note}` : ''}`)
          .join('；')}）`
      : '';

    const startupPrompt = ctx.studioToken
      ? `我已在 Agent Party 地图工坊完成画布编辑与框选${boxSummary}，会话 ID：${ctx.sessionId}。\n请立即调用 agent-party-map MCP 的 map_get_context 和 map_get_selection 读取我当前画布上的所有框选坐标与备注要求，然后直接调用地图工具修改画布！${ctx.draftInstruction ? `\n总体要求：${ctx.draftInstruction}` : ''}`
      : '请先点击上方【连接实时 MCP 会话】获取专属令牌后再复制启动提示词。';

    const listenPrompt = ctx.studioToken
      ? `请调用 agent-party-map MCP 的 map_wait_next_task 开启实时地图工坊接单监听（会话 ${ctx.sessionId}）。收到我在网页端点击发送的框选任务后，按每个区块 note 修改地图，修改完调用 map_complete_task 提交给我预览确认，然后继续调用 map_wait_next_task 待命。`
      : '请先连接 MCP 会话。';

    const mcpJson = JSON.stringify(
      {
        mcpServers: {
          'agent-party-map': {
            url: mcpUrl,
            command: 'node',
            args: ['<绝对主目录>/.agent-party/map-mcp.mjs', '--url', mcpUrl],
          },
        },
      },
      null,
      2,
    );

    const cliWaitCmd = `curl -sL "${scriptUrl}" -o "$HOME/.agent-party/map-mcp.mjs" && node "$HOME/.agent-party/map-mcp.mjs" --wait --url "${mcpUrl}"`;

    const onboardPrompt = `请读取下面这条 Agent Party 地图工坊专属接入文档，下载本地桥接脚本并把 agent-party-map 写入你的 MCP 配置；配置好后请告诉我“已连接，等待启动指令”，或立即运行监听模式：\n${setupMdUrl}\n\n（注：如果所在机器无法直接访问 ${origin}，请确认端口连通；该令牌 ${ctx.studioToken} 仅绑定我个人画布。）`;

    const badgeClass = ctx.presence.listening
      ? 'is-listening'
      : ctx.presence.connected
        ? 'is-connected'
        : 'is-offline';
    const badgeLabel = ctx.presence.listening
      ? `🟢 MCP 监听待命中 (${ctx.presence.clientName || 'AI Agent'})`
      : ctx.presence.connected
        ? `🟢 MCP 已连接 (${ctx.presence.clientName || 'AI Agent'})`
        : ctx.studioToken
          ? '🟡 会话已就绪 · 等待 AI 调用 MCP 或粘贴启动提示词'
          : '⚪ 纯本地模式（按需连接 MCP）';

    this.el.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'ms-modal ms-mcp-modal';

    const header = document.createElement('div');
    header.className = 'ms-modal__header';
    header.innerHTML = `
      <div class="ms-modal__title">
        <span class="ms-px-icon">🤖</span>
        <span>MCP AI 协同中心与启动提示词</span>
      </div>
      <div class="ms-mcp-presence ${badgeClass}">${badgeLabel}</div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ms-btn ms-btn--ghost ms-btn--sm';
    closeBtn.textContent = '✕ 关闭';
    closeBtn.onclick = () => this.close();
    header.append(closeBtn);
    card.append(header);

    // HTTP LAN warning + Session bar
    const infoBar = document.createElement('div');
    infoBar.className = 'ms-mcp-infobar';
    const sidHtml = ctx.studioToken
      ? `<span>会话: <code>${ctx.sessionId}</code> · 令牌: <code>${ctx.studioToken.slice(0, 10)}…</code></span>`
      : '<span>当前为纯本地高速编辑，尚未向服务端申请 MCP 会话</span>';
    infoBar.innerHTML = `
      <div class="ms-mcp-infobar__row">
        <div class="ms-mcp-infobar__meta">${sidHtml}</div>
        <div class="ms-mcp-infobar__actions" data-slot="session-actions"></div>
      </div>
      <div class="ms-mcp-http-tip">
        💡 <b>内网 HTTP 兼容说明：</b>网页无法直接向你的 AI 客户端对话框自动输入消息，且浏览器在非 HTTPS 内网地址（如 <code>http://192.168.x.x</code>）下会禁用一键剪贴板 API。下方每个区域均配有<b>【降级一键复制 + 完整可手动 Ctrl+C 文本框】</b>；MCP 连接成功后，直接复制【启动提示词】发进你的 AI 对话框即可！
      </div>
    `;
    const actionsSlot = infoBar.querySelector('[data-slot="session-actions"]')!;
    if (!ctx.studioToken) {
      const connBtn = document.createElement('button');
      connBtn.type = 'button';
      connBtn.className = 'ms-btn ms-btn--primary ms-btn--sm';
      connBtn.textContent = '⚡ 立即连接 MCP 会话';
      connBtn.onclick = () => void ctx.onConnectSession();
      actionsSlot.append(connBtn);
    } else {
      if (ctx.endpoints.lanUrl) {
        const hostBtn = document.createElement('button');
        hostBtn.type = 'button';
        hostBtn.className = 'ms-btn ms-btn--sm';
        hostBtn.textContent = this.hostMode === 'lan' ? '🌐 地址: 局域网 IP' : '🏠 地址: 当前/本机';
        hostBtn.onclick = () => {
          this.hostMode = this.hostMode === 'lan' ? 'auto' : 'lan';
          this.render();
        };
        actionsSlot.append(hostBtn);
      }
      const rotBtn = document.createElement('button');
      rotBtn.type = 'button';
      rotBtn.className = 'ms-btn ms-btn--sm';
      rotBtn.textContent = '🔄 轮换令牌';
      rotBtn.onclick = () => void ctx.onRotateToken();
      actionsSlot.append(rotBtn);
    }
    card.append(infoBar);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'ms-tabs';
    for (const [key, label] of [
      ['prompts', '1️⃣ 对话框启动提示词 (推荐)'],
      ['config', '2️⃣ MCP JSON 配置与脚本'],
      ['guide', '3️⃣ AI 全自动接入指令'],
    ] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ms-tab ${this.activeTab === key ? 'is-active' : ''}`;
      btn.textContent = label;
      btn.onclick = () => {
        this.activeTab = key;
        this.render();
      };
      tabs.append(btn);
    }
    card.append(tabs);

    const body = document.createElement('div');
    body.className = 'ms-modal__body ms-mcp-body';

    const makeCopyBlock = (title: string, desc: string, value: string, rows = 4, badge?: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'ms-copy-block';
      const head = document.createElement('div');
      head.className = 'ms-copy-block__head';
      const left = document.createElement('div');
      left.innerHTML = `<div class="ms-copy-block__title">${badge ? `<span class="ms-tag">${badge}</span>` : ''}${title}</div><div class="ms-copy-block__desc">${desc}</div>`;
      const btns = document.createElement('div');
      btns.className = 'ms-copy-block__btns';

      const ta = document.createElement('textarea');
      ta.className = 'ms-copy-textarea';
      ta.readOnly = true;
      ta.rows = rows;
      ta.value = value;
      ta.addEventListener('click', () => {
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
      });

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'ms-btn ms-btn--sm';
      selectBtn.textContent = '全选文本';
      selectBtn.onclick = () => {
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
      };

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ms-btn ms-btn--primary ms-btn--sm';
      copyBtn.textContent = '📋 一键复制';
      copyBtn.onclick = async () => {
        const res = await copyTextSafe(value, ta);
        if (res.copied) {
          ctx.onToast(`✅ 已复制（${res.method === 'clipboard' ? '系统剪贴板' : 'HTTP 兼容剪贴板'}）`);
        } else {
          ctx.onToast('⚠️ 浏览器拦截了自动复制：已为您自动全选文本框，请直接按 Ctrl+C 手动复制');
        }
      };

      btns.append(selectBtn, copyBtn);
      head.append(left, btns);
      wrap.append(head, ta);
      return wrap;
    };

    if (this.activeTab === 'prompts') {
      body.append(
        makeCopyBlock(
          '对话框启动提示词 · 立即执行当前框选修改',
          '当你的 AI 客户端（Claude Code / Cursor / Antigravity / Codex）已连上 agent-party-map MCP，且你在画布用 AI 框选 (A) 画好了区块后，直接把这段发给 AI 对话框即可！无需提前挂起等待。',
          startupPrompt,
          4,
          '最常用',
        ),
      );
      body.append(
        makeCopyBlock(
          '持续接单监听提示词 · 网页一键连续派单',
          '若希望让 AI 保持后台挂起等待，随后直接在网页点击【发送给监听中的 AI】连续派单，发这段给 AI：',
          listenPrompt,
          4,
          '自动监听',
        ),
      );
    } else if (this.activeTab === 'config') {
      body.append(
        makeCopyBlock(
          'mcpServers 完整 JSON 配置（可直接手动复制到 .mcp.json / mcp_config.json / .cursor/mcp.json）',
          `专属 URL 与令牌已内置。若客户端支持 Streamable HTTP（url 字段）或仅支持本地命令（command + args），二选一或同时保留均可：`,
          mcpJson,
          9,
          '完整手动复制区',
        ),
      );
      body.append(
        makeCopyBlock(
          '终端下载桥接脚本并启动免重启监听',
          '若刚写完 JSON 配置不方便重启 IDE，直接在任意终端运行此命令即可让页面立即变为已连接状态：',
          cliWaitCmd,
          3,
          '命令行',
        ),
      );
    } else {
      body.append(
        makeCopyBlock(
          '首次接入 · 发给 AI 助手全自动完成下载与配置',
          '还没配置过 MCP 时，直接把下面这段自然语言指令复制发给你的 AI，它会自动拉取并写入配置文件：',
          onboardPrompt,
          5,
          '全自动配置',
        ),
      );
      body.append(
        makeCopyBlock(
          '接入协议文档地址（Setup Markdown URL）',
          '内网 HTTP 下可手动完整复制此链接给 AI 或浏览器打开查看：',
          setupMdUrl,
          2,
        ),
      );
    }

    card.append(body);
    this.el.append(card);
  }
}
