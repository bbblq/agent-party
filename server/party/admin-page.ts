import {
  ACCESSORIES,
  BOTTOM_STYLES,
  FACIAL_HAIR,
  HAIR_STYLES,
  TOP_STYLES,
} from '../../shared/appearance';
import {
  ACC_COLORS,
  BOTTOMS,
  HAIR_FUN,
  HAIR_NATURAL,
  JACKET_COLORS,
  SHIRT_COLORS,
  SKINS,
  TOP_COLORS,
} from '../../shared/world/appearance-flat';

const ADMIN_CUSTOMIZE_DATA = JSON.stringify({
  skins: SKINS,
  hairStyles: HAIR_STYLES,
  hairColors: [...HAIR_NATURAL.map(([c]) => c), ...HAIR_FUN],
  facialHair: FACIAL_HAIR,
  topStyles: TOP_STYLES,
  topColors: TOP_COLORS,
  shirtColors: SHIRT_COLORS,
  jacketColors: JACKET_COLORS,
  bottomStyles: BOTTOM_STYLES,
  bottomColors: BOTTOMS.map(([c]) => c),
  accessories: ACCESSORIES,
  accColors: ACC_COLORS,
  labels: {
    hairStyle: {
      short: '短发',
      buzz: '寸头',
      spiky: '刺猬头',
      side_part: '偏分',
      curly: '卷发',
      afro: '爆炸头',
      bob: '波波头',
      long: '长发',
      ponytail: '马尾',
      bun: '丸子头',
      pigtails: '双马尾',
      mohawk: '莫西干',
      bald: '光头',
      wavy: '大波浪',
    },
    facialHair: {
      none: '无胡须',
      stubble: '胡茬',
      beard: '络腮胡',
      mustache: '八字胡',
      goatee: '山羊胡',
    },
    topStyle: {
      tshirt: 'T 恤',
      hoodie: '连帽卫衣',
      shirt_tie: '衬衫领带',
      sweater: '针织毛衣',
      jacket: '夹克外套',
      blouse: '翻领衬衫',
      polo: 'Polo 衫',
    },
    bottomStyle: {
      pants: '长裤',
      shorts: '短裤',
      skirt: '短裙',
    },
    accessory: {
      none: '无配饰',
      glasses: '框架眼镜',
      sunglasses: '墨镜',
      headphones: '头戴耳机',
      cap: '鸭舌帽',
      beanie: '针织帽',
      earrings: '耳环',
      bow: '蝴蝶结',
    },
  },
}).replaceAll('<', '\\u003c');

export function renderAdminHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Party — 管理员控制台</title>
  <link rel="icon" href="/assets/brand/favicon-32.png" type="image/png" sizes="32x32" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #0e121b;
      --panel: #161c29;
      --panel-2: #1d2536;
      --border: #2b354b;
      --text: #eef3ff;
      --muted: #93a1be;
      --accent: #52c4ff;
      --danger: #ff5c6c;
      --warn: #fbbf24;
      --ok: #4ade80;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #19243a 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
    }
    .wrap {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 20px 64px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 24px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    h1 { margin: 0; font-size: 24px; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    .muted { color: var(--muted); font-size: 13px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) { border-color: var(--accent); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 8px; }
    .btn-primary {
      background: linear-gradient(135deg, #2b8cff, #47c5ff);
      color: #061322;
      border: none;
    }
    .btn-danger {
      background: rgba(255, 92, 108, 0.14);
      border-color: rgba(255, 92, 108, 0.45);
      color: #ff9ba5;
    }
    .btn-warn {
      background: rgba(251, 191, 36, 0.14);
      border-color: rgba(251, 191, 36, 0.45);
      color: #fde68a;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .auth-box {
      max-width: 440px;
      margin: 72px auto;
    }
    label {
      display: block;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input[type="text"], input[type="password"], select {
      width: 100%;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0b0f17;
      color: var(--text);
      font-size: 14px;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .tabs {
      display: inline-flex;
      background: #0b0f17;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 3px;
      gap: 4px;
      margin-bottom: 14px;
    }
    .tab {
      padding: 6px 12px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .tab.active {
      background: var(--panel-2);
      color: var(--accent);
    }
    .pet-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .pet-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 8px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0b0f17;
      cursor: pointer;
      color: var(--text);
      font-size: 12px;
      text-align: center;
    }
    .pet-card.active {
      border-color: var(--accent);
      background: rgba(82, 196, 255, 0.12);
    }
    .pet-thumb {
      width: 48px;
      height: 48px;
      object-fit: contain;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    th { color: var(--muted); font-weight: 600; font-size: 12px; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.08);
    }
    .pill.working { background: rgba(74, 222, 128, 0.15); color: #86efac; }
    .pill.idle { background: rgba(82, 196, 255, 0.15); color: #7dd3fc; }
    .pill.waiting { background: rgba(251, 191, 36, 0.15); color: #fde68a; }
    .pill.offline { background: rgba(148, 163, 184, 0.14); color: #94a3b8; }
    .pill.tool { background: rgba(167, 139, 250, 0.18); color: #ddd6fe; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .err { color: #ff8e99; font-size: 13px; margin-top: 8px; }
    .upload-panel {
      padding: 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: #0b0f17;
      margin-bottom: 14px;
    }
    .upload-panel-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 10px;
    }
    .upload-drops {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .upload-drop {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      border-radius: 10px;
      background: var(--panel);
      border: 1px dashed var(--border);
    }
    .upload-drop.required {
      border-color: rgba(82, 196, 255, 0.5);
      background: rgba(82, 196, 255, 0.05);
    }
    .upload-drop-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .badge-req {
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(82, 196, 255, 0.16);
      color: var(--accent);
    }
    .badge-opt {
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(148, 163, 184, 0.16);
      color: var(--muted);
    }
    .file-input-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .file-pick-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .file-status {
      font-size: 12px;
      color: var(--muted);
      word-break: break-all;
    }
    .file-status.ready { color: var(--ok); }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="login-view" class="card auth-box">
      <h2>🔐 管理员登录</h2>
      <p class="muted" style="margin-top:0">请输入启动服务端时控制台打印的管理员密钥（或 <code>AGENT_PARTY_ADMIN_KEY</code>）。</p>
      <form id="login-form">
        <label for="admin-key">管理员密钥</label>
        <input id="admin-key" type="password" placeholder="输入管理员密钥..." autocomplete="current-password" required />
        <div id="login-err" class="err" hidden></div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="btn btn-primary" type="submit">进入控制台</button>
          <a class="btn" href="/">返回大屏</a>
        </div>
      </form>
    </div>

    <div id="app-view" hidden>
      <div class="topbar">
        <div class="title">
          <h1>🛡️ Agent Party 管理后台</h1>
        </div>
        <div class="actions">
          <a class="btn" href="/setup" target="_blank">🔗 接入文档</a>
          <button class="btn" id="refresh-btn" type="button">🔄 刷新</button>
          <a class="btn" href="/">🏢 查看大屏</a>
          <button class="btn btn-danger" id="logout-btn" type="button">退出登录</button>
        </div>
      </div>

      <div class="card">
        <h2>🌐 站点与接入地址设置</h2>
        <p class="muted" style="margin-top:0">
          设置同事通过 <code>/setup</code> 和 <code>/setup.md</code> 接入时使用的公网或局域网访问地址（例如部署在反向代理后的域名）。
          当前生效地址：<code id="effective-base-url">-</code>
          · <a href="/setup" target="_blank" style="color:var(--accent)">查看 /setup</a>
          · <a href="/setup.md" target="_blank" style="color:var(--accent)">查看 /setup.md</a>
        </p>
        <form id="settings-form">
          <label for="site-public-url">自定义接入根地址（支持 http:// 或 https://，留空则自动识别当前访问域名）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="site-public-url" type="text" placeholder="例如：https://agent.yourdomain.com（留空则自动跟随当前访问域名）" style="flex:1;min-width:260px" />
            <button class="btn btn-primary" type="submit">保存地址</button>
            <button class="btn" id="fill-origin-btn" type="button">填入当前页面地址</button>
            <button class="btn" id="clear-url-btn" type="button">恢复自动识别</button>
          </div>
          <div id="settings-msg" class="muted" style="margin-top:8px" hidden></div>
        </form>
        <form id="sign-form" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <label for="site-reception-sign">
            🪧 接待大厅黑板文字（当前大屏显示：<code id="effective-reception-sign">Agent Party</code>）
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="site-reception-sign" type="text" maxlength="28" placeholder="默认：Agent Party（支持中英文 / 团队名，实时生效）" style="flex:1;min-width:260px" />
            <button class="btn btn-primary" type="submit">保存黑板文字</button>
            <button class="btn" id="reset-sign-btn" type="button">恢复默认</button>
          </div>
          <div id="sign-msg" class="muted" style="margin-top:8px" hidden></div>
        </form>
      </div>

      <div class="card">
        <h2>🎨 大屏全局外观与显示设置</h2>
        <p class="muted" style="margin-top:0">
          统一控制所有观众端办公室大屏的节日主题、昼夜光照、角色活跃度与显示开关；所有时间（昼夜循环、节日日历、决斗排行榜整点清零）均严格按<strong>北京时间（UTC+8）</strong>计算。
        </p>
        <form id="office-settings-form">
          <div class="row">
            <div>
              <label for="opt-theme">节日主题</label>
              <select id="opt-theme">
                <option value="auto">自动跟随日历（10月万圣 / 11-12月圣诞 / 其余经典）</option>
                <option value="none">经典原版办公室</option>
                <option value="christmas">圣诞节主题 🎄</option>
                <option value="halloween">万圣节主题 🎃</option>
              </select>
            </div>
            <div>
              <label for="opt-daylight">昼夜光照模式</label>
              <select id="opt-daylight">
                <option value="auto">自动跟随北京时间（UTC+8）</option>
                <option value="day">常亮白天 ☀️</option>
                <option value="night">常暗夜晚 🌙</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div>
              <label for="opt-liveliness">摸鱼活跃度</label>
              <select id="opt-liveliness">
                <option value="lively">活跃（积极闲逛与互动）</option>
                <option value="normal">适中</option>
                <option value="calm">安静（少走动）</option>
              </select>
            </div>
            <div>
              <label for="opt-bubbles">活动状态气泡</label>
              <select id="opt-bubbles">
                <option value="important">仅显示重要状态</option>
                <option value="all">显示全部活动气泡</option>
                <option value="none">隐藏活动气泡</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:12px">
            <label style="display:inline-flex;align-items:center;gap:8px;margin:0;cursor:pointer;color:var(--text)">
              <input id="opt-show-names" type="checkbox" style="width:auto" checked />
              <span>显示人物与宠物头顶名称</span>
            </label>
            <button class="btn btn-primary" type="submit">保存大屏设置</button>
            <button class="btn" id="reset-office-btn" type="button">恢复默认</button>
          </div>
          <div id="office-msg" class="muted" style="margin-top:8px" hidden></div>
        </form>
      </div>

      <div class="card">
        <h2>🗺️ 地图模式与预设版本管理（支持最大 512×512）</h2>
        <p class="muted" style="margin-top:0">
          切换全局线上地图仅限管理员操作。普通成员可在主界面打开<strong>「🗺️ 地图工坊」</strong>或使用支持 MCP 的 AI 框选编辑并下载 <code>.json</code> 发给您上传。
        </p>
        <div class="row" style="align-items:center;margin-bottom:10px">
          <div>
            <span class="muted">当前运行模式：</span>
            <strong id="map-mode-badge">—</strong>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn" id="map-auto-btn" type="button">🏢 切回默认模式（按人数自动生成）</button>
            <button class="btn" id="map-copy-mcp-btn" type="button">⚙️ 复制管理员 MCP 配置</button>
          </div>
        </div>
        <div class="row" style="align-items:end;margin-bottom:12px">
          <div>
            <label for="map-upload-file">上传自定义地图 (.json)</label>
            <input id="map-upload-file" type="file" accept=".json,application/json" />
          </div>
          <div>
            <label for="map-upload-name">自定义名称（可选）</label>
            <input id="map-upload-name" type="text" placeholder="留空沿用文件内名称" />
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <label style="display:inline-flex;align-items:center;gap:6px;margin:0;cursor:pointer;color:var(--text)">
              <input id="map-upload-activate" type="checkbox" style="width:auto" checked />
              <span>上传后立即全员启用</span>
            </label>
            <button class="btn btn-primary" id="map-upload-btn" type="button">上传并保存</button>
          </div>
        </div>
        <div id="map-msg" class="muted" style="margin-bottom:8px" hidden></div>
        <table>
          <thead>
            <tr>
              <th>地图名称 / ID</th>
              <th>尺寸</th>
              <th>区域 / 工位</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="maps-tbody"></tbody>
        </table>
      </div>

      <div class="card">
        <h2>✨ 创建常驻 NPC（人 / 宝可梦 / Codex V2 桌宠）</h2>
        <p class="muted" style="margin-top:0">新建的 NPC 会立刻出现在虚拟办公室中，可以自由摸鱼（打乒乓球、喝咖啡、玩街机）或坐在工位办公。</p>
        <div class="tabs">
          <button class="tab active" type="button" data-mode="pokemon">⚡ 宝可梦 (SpriteCollab)</button>
          <button class="tab" type="button" data-mode="pet">🐾 Codex V2 桌宠</button>
          <button class="tab" type="button" data-mode="human">🧑 像素小人</button>
        </div>

        <form id="npc-form">
          <div class="row">
            <div>
              <label for="npc-name">NPC 昵称</label>
              <input id="npc-name" type="text" placeholder="例如：值班皮卡丘 / 小摸鱼" required maxlength="32" />
            </div>
            <div>
              <label for="npc-role">角色 / 签名</label>
              <input id="npc-role" type="text" value="常驻 NPC" maxlength="32" />
            </div>
            <div>
              <label for="npc-tool">显示工具标签</label>
              <input id="npc-tool" type="text" value="NPC" maxlength="24" />
            </div>
            <div>
              <label for="npc-behavior">行动模式</label>
              <select id="npc-behavior">
                <option value="auto">自动劳逸结合（摸鱼+办公轮换）</option>
                <option value="idle">一直自由活动（打乒乓/喝咖啡/逛街机）</option>
                <option value="working">一直坐在工位办公</option>
              </select>
            </div>
          </div>

          <div id="npc-pokemon-picker">
            <label for="poke-query">搜索任意宝可梦（中文名 / 英文名 / 图鉴编号）</label>
            <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
              <input id="poke-query" type="text" placeholder="例如：皮卡丘 / 耿鬼 / 伊布 / 25" style="max-width:300px" />
              <button class="btn btn-sm" id="poke-search-btn" type="button">搜索</button>
            </div>
            <div id="poke-chips" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"></div>
            <div id="poke-selected" class="muted" style="margin-bottom:10px">未选择宝可梦（点击上方按钮快速拉取并选中）</div>
          </div>

          <div id="npc-pet-picker" hidden>
            <label>选择 Codex V2 桌宠</label>
            <div id="pet-grid" class="pet-grid"></div>
            <div class="upload-panel">
              <div class="upload-panel-title">📤 上传 / 导入自定义 Codex V2 桌宠</div>
              <div class="row" style="margin-bottom:12px">
                <div>
                  <label for="up-id">桌宠 ID（英文/数字，留空自动用图片文件名）</label>
                  <input id="up-id" type="text" placeholder="例如：my-pikachu" maxlength="48" />
                </div>
                <div>
                  <label for="up-name">显示名称（可选，展示在列表与角色名）</label>
                  <input id="up-name" type="text" placeholder="例如：我的皮卡丘" maxlength="48" />
                </div>
              </div>
              <div class="upload-drops">
                <div class="upload-drop required">
                  <div class="upload-drop-head">
                    <span>🖼️ 1. 精灵图集图片</span>
                    <span class="badge-req">必填</span>
                  </div>
                  <div class="muted" style="font-size:12px">上传 <code>.webp</code> 或 <code>.png</code> 格式的动作精灵图（spritesheet）</div>
                  <div class="file-pick-row">
                    <label for="up-sprite" class="btn btn-sm" style="margin:0;color:var(--text)">选择图片文件</label>
                    <input id="up-sprite" class="file-input-hidden" type="file" accept=".webp,.png,image/webp,image/png" />
                    <span id="up-sprite-name" class="file-status">未选择文件</span>
                  </div>
                </div>
                <div class="upload-drop">
                  <div class="upload-drop-head">
                    <span>⚙️ 2. 动作配置文件 (pet.json)</span>
                    <span class="badge-opt">可选</span>
                  </div>
                  <div class="muted" style="font-size:12px">可不传（默认按标准 Codex V2 网格切帧）；自定义帧尺寸时再上传</div>
                  <div class="file-pick-row">
                    <label for="up-json" class="btn btn-sm" style="margin:0;color:var(--text)">选择 pet.json</label>
                    <input id="up-json" class="file-input-hidden" type="file" accept=".json,application/json" />
                    <span id="up-json-name" class="file-status">未选择，使用默认配置</span>
                    <button class="btn btn-sm" id="up-json-clear" type="button" hidden>清除</button>
                  </div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" id="up-btn" type="button">⬆️ 上传并导入桌宠</button>
                <span id="up-msg" class="muted"></span>
              </div>
            </div>
          </div>

          <div id="npc-human-picker" hidden style="margin-bottom:14px;padding:14px;border-radius:12px;background:#0b0f17;border:1px solid var(--border)">
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
              <div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:160px">
                <canvas id="npc-human-preview" width="96" height="136" style="image-rendering:pixelated;border-radius:10px;background:#141b2b;border:1px solid var(--border)"></canvas>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
                  <button class="btn btn-sm btn-primary" id="npc-look-m" type="button">👦 随机男生</button>
                  <button class="btn btn-sm" id="npc-look-f" type="button">👧 随机女生</button>
                  <button class="btn btn-sm" id="npc-look-reroll" type="button">🎲 全随机</button>
                </div>
              </div>
              <div style="flex:1;min-width:260px">
                <div class="row" style="margin-bottom:10px">
                  <div>
                    <label for="npc-part-skin">肤色</label>
                    <select id="npc-part-skin"></select>
                  </div>
                  <div>
                    <label for="npc-part-look">唇色</label>
                    <select id="npc-part-look">
                      <option value="m">自然唇色</option>
                      <option value="f">红润唇色</option>
                    </select>
                  </div>
                  <div>
                    <label for="npc-part-hairStyle">发型</label>
                    <select id="npc-part-hairStyle"></select>
                  </div>
                  <div>
                    <label for="npc-part-hair">发色</label>
                    <select id="npc-part-hair"></select>
                  </div>
                </div>
                <div class="row" style="margin-bottom:10px">
                  <div>
                    <label for="npc-part-facialHair">胡须</label>
                    <select id="npc-part-facialHair"></select>
                  </div>
                  <div>
                    <label for="npc-part-topStyle">上衣款式</label>
                    <select id="npc-part-topStyle"></select>
                  </div>
                  <div>
                    <label for="npc-part-top">上衣主色</label>
                    <select id="npc-part-top"></select>
                  </div>
                  <div>
                    <label for="npc-part-bottomStyle">裤/裙款式</label>
                    <select id="npc-part-bottomStyle"></select>
                  </div>
                </div>
                <div class="row" style="margin-bottom:0">
                  <div>
                    <label for="npc-part-bottom">下装颜色</label>
                    <select id="npc-part-bottom"></select>
                  </div>
                  <div>
                    <label for="npc-part-accessory">配饰</label>
                    <select id="npc-part-accessory"></select>
                  </div>
                  <div style="display:flex;align-items:flex-end">
                    <span class="muted">生成后可在下方列表中复制专属代号或点「🎨 捏脸设置」精修全套细节。</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="npc-err" class="err" hidden></div>
          <div id="npc-created-msg" class="muted" hidden style="margin:6px 0 10px"></div>
          <label style="display:inline-flex;align-items:center;gap:8px;margin:4px 0 12px;cursor:pointer;color:var(--text)">
            <input id="npc-can-duel" type="checkbox" style="width:auto" checked />
            <span>⚔️ 允许参加宝可梦决斗（宝可梦默认开启，人类或其他桌宠开启后可作为彩蛋上场对战）</span>
          </label>
          <div>
            <button class="btn btn-primary" id="npc-submit-btn" type="submit">➕ 生成 NPC 并加入办公室</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>🤖 活跃 NPC 列表 (<span id="npc-count">0</span>)</h2>
        <table>
          <thead>
            <tr>
              <th>昵称 / 角色</th>
              <th>形象</th>
              <th>行为模式</th>
              <th>当前状态</th>
              <th>决斗资格</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="npc-tbody"></tbody>
        </table>
      </div>

      <div class="card">
        <h2>👥 已接入成员管理 (<span id="member-count">0</span>)</h2>
        <table>
          <thead>
            <tr>
              <th>昵称 / ID</th>
              <th>接入工具</th>
              <th>形象</th>
              <th>状态</th>
              <th>决斗资格</th>
              <th>最近活跃</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="member-tbody"></tbody>
        </table>
      </div>

      <div class="card">
        <h2>🚫 封禁名单 (<span id="ban-count">0</span>)</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>原昵称</th>
              <th>原因</th>
              <th>封禁时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="ban-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const NPC_CUST = ${ADMIN_CUSTOMIZE_DATA};
    const KEY_STORAGE = 'agent_party_admin_key';
    let adminKey = sessionStorage.getItem(KEY_STORAGE) || '';
    let npcMode = 'pokemon';
    let selectedPetId = '';
    let selectedPokemonPetId = '';
    let cachedPets = [];
    let petGridRendered = false;
    let adminState = { npcs: [], members: [], banned: [] };
    const thumbCache = new Map();
    const thumbPromiseCache = new Map();

    const $ = (id) => document.getElementById(id);

    function esc(s) {
      return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    }

    function fmtTime(ms) {
      if (!ms) return '-';
      return new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    }

    async function api(path, opts = {}) {
      const headers = Object.assign({ 'x-admin-key': adminKey }, opts.headers || {});
      const res = await fetch(path, { ...opts, headers });
      if (res.status === 401) {
        sessionStorage.removeItem(KEY_STORAGE);
        adminKey = '';
        showLogin('密钥错误或已失效，请重新登录。');
        throw new Error('Unauthorized');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    function showLogin(msg = '') {
      $('login-view').hidden = false;
      $('app-view').hidden = true;
      $('login-err').hidden = !msg;
      $('login-err').textContent = msg;
    }

    function cropPetThumb(pet) {
      if (thumbCache.has(pet.spriteUrl)) return Promise.resolve(thumbCache.get(pet.spriteUrl));
      if (thumbPromiseCache.has(pet.spriteUrl)) return thumbPromiseCache.get(pet.spriteUrl);
      const p = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const fw = pet.spec?.frameWidth || 192;
            const fh = pet.spec?.frameHeight || 208;
            const c = document.createElement('canvas');
            c.width = 48;
            c.height = 48;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, fw, fh, 0, 0, 48, 48);
            const url = c.toDataURL('image/png');
            thumbCache.set(pet.spriteUrl, url);
            resolve(url);
          } catch {
            resolve('');
          }
        };
        img.onerror = () => resolve('');
        img.src = pet.spriteUrl;
      });
      thumbPromiseCache.set(pet.spriteUrl, p);
      return p;
    }

    function defaultPetDuelFor(pet) {
      if (!pet) return false;
      if (pet.source === 'uploaded' || pet.source === 'local') return false;
      return pet.id !== 'dafeiyu';
    }

    function renderPetGrid(pets) {
      cachedPets = pets;
      petGridRendered = true;
      const grid = $('pet-grid');
      if (!pets.length) {
        grid.innerHTML = '<div class="muted">暂无可用的 Codex V2 桌宠，可先在下方上传。</div>';
        return;
      }
      if (!selectedPetId || !pets.some((p) => p.id === selectedPetId)) {
        selectedPetId = pets[0].id;
      }
      grid.innerHTML = '';
      for (const p of pets) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pet-card' + (p.id === selectedPetId ? ' active' : '');
        const img = document.createElement('img');
        img.className = 'pet-thumb';
        img.alt = p.displayName || p.id;
        cropPetThumb(p).then((url) => { if (url) img.src = url; });
        const label = document.createElement('span');
        label.textContent = p.displayName || p.id;
        btn.append(img, label);
        btn.addEventListener('click', () => {
          selectedPetId = p.id;
          if (npcMode === 'pet') {
            $('npc-can-duel').checked = defaultPetDuelFor(p);
          }
          renderPetGrid(cachedPets);
        });
        grid.append(btn);
      }
    }

    function statusPill(st) {
      const map = { working: '工作中', idle: '自由活动', waiting: '等待确认', offline: '已离线' };
      return '<span class="pill ' + esc(st) + '">' + esc(map[st] || st) + '</span>';
    }

    function duelToggleHtml(item) {
      return item.canDuel
        ? '<button class="btn btn-sm" style="border-color:rgba(250,204,21,0.55);color:#fde047" data-duel-toggle="' + esc(item.id) + '" data-duel-next="false">⚔️ 参战中</button>'
        : '<button class="btn btn-sm" style="opacity:0.78" data-duel-toggle="' + esc(item.id) + '" data-duel-next="true">🍿 仅围观 (点此开启)</button>';
    }

    function renderNpcs() {
      const npcs = adminState.npcs || [];
      $('npc-count').textContent = String(npcs.length);
      const npcBody = $('npc-tbody');
      npcBody.innerHTML = npcs.length
        ? npcs.map((n) => {
            const lookLabel = n.avatarMode === 'pet' ? ('🐾 ' + esc(n.petId)) : '🧑 像素小人';
            const modeLabel = n.npcAuto ? '自动劳逸结合' : '固定状态';
            const codeHint = n.editToken ? (' · 代号: <code>' + esc(n.editToken) + '</code>') : '';
            const custBtn = n.avatarMode === 'human' && n.editToken
              ? '<a class="btn btn-sm btn-primary" href="/customize/' + encodeURIComponent(n.editToken) + '" target="_blank">🎨 捏脸设置</a>'
              : '';
            return '<tr>' +
              '<td><strong>' + esc(n.name) + '</strong><div class="muted">' + esc(n.role) + codeHint + '</div></td>' +
              '<td>' + lookLabel + '</td>' +
              '<td>' + modeLabel + '</td>' +
              '<td>' + statusPill(n.lastStatus) + '</td>' +
              '<td>' + duelToggleHtml(n) + '</td>' +
              '<td><div class="actions">' +
                '<button class="btn btn-sm" data-npc-toggle="' + esc(n.id) + '" data-next="' + (n.lastStatus === 'working' ? 'idle' : 'working') + '">' + (n.lastStatus === 'working' ? '去摸鱼' : '去办公') + '</button>' +
                custBtn +
                (n.avatarMode === 'human' ? '<button class="btn btn-sm" data-npc-reroll="' + esc(n.id) + '">换个造型</button>' : '') +
                '<button class="btn btn-sm btn-danger" data-npc-del="' + esc(n.id) + '">删除</button>' +
              '</div></td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="6" class="muted">暂无常驻 NPC</td></tr>';
    }

    function renderMembers() {
      const members = adminState.members || [];
      $('member-count').textContent = String(members.length);
      const mBody = $('member-tbody');
      mBody.innerHTML = members.length
        ? members.map((m) => {
            const lookLabel = m.avatarMode === 'pet' ? ('🐾 ' + esc(m.petId)) : '🧑 像素小人';
            const ownerSub = m.ownerId ? (' · 伴随宠物 (所属 ' + esc(m.ownerId) + ')') : '';
            const codeHint = !m.ownerId && m.editToken ? (' · 代号: <code>' + esc(m.editToken) + '</code>') : '';
            const custBtn = !m.ownerId && m.editToken
              ? '<a class="btn btn-sm" href="/customize/' + encodeURIComponent(m.editToken) + '" target="_blank">🎨 捏脸</a>'
              : '';
            return '<tr>' +
              '<td><strong>' + esc(m.name) + '</strong><div class="muted">ID: ' + esc(m.id) + ' · ' + esc(m.role) + ownerSub + codeHint + '</div></td>' +
              '<td>' + (m.agentTool ? '<span class="pill tool">' + esc(m.agentTool) + '</span>' : '<span class="muted">-</span>') + '</td>' +
              '<td>' + lookLabel + '</td>' +
              '<td>' + statusPill(m.lastStatus) + '</td>' +
              '<td>' + duelToggleHtml(m) + '</td>' +
              '<td class="muted">' + fmtTime(m.lastSeenAt) + '</td>' +
              '<td><div class="actions">' +
                custBtn +
                '<button class="btn btn-sm btn-warn" data-kick="' + esc(m.id) + '">移出</button>' +
                '<button class="btn btn-sm btn-danger" data-ban="' + esc(m.id) + '">移出并封禁</button>' +
              '</div></td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="7" class="muted">暂无成员接入</td></tr>';
    }

    function renderBans() {
      const bans = adminState.banned || [];
      $('ban-count').textContent = String(bans.length);
      const bBody = $('ban-tbody');
      bBody.innerHTML = bans.length
        ? bans.map((b) =>
            '<tr>' +
              '<td><code>' + esc(b.id) + '</code></td>' +
              '<td>' + esc(b.name || '-') + '</td>' +
              '<td class="muted">' + esc(b.reason || '-') + '</td>' +
              '<td class="muted">' + fmtTime(b.bannedAt) + '</td>' +
              '<td><button class="btn btn-sm" data-unban="' + esc(b.id) + '">解封</button></td>' +
            '</tr>'
          ).join('')
        : '<tr><td colspan="5" class="muted">封禁名单为空</td></tr>';
    }

    async function loadState() {
      const data = await api('/api/admin/state');
      $('login-view').hidden = true;
      $('app-view').hidden = false;

      $('site-public-url').value = (data.settings && data.settings.publicUrl) || '';
      $('effective-base-url').textContent = data.effectiveBaseUrl || window.location.origin;
      $('site-reception-sign').value = (data.settings && data.settings.receptionSign) || '';
      $('effective-reception-sign').textContent = (data.settings && data.settings.effectiveReceptionSign) || 'Agent Party';
      const os = (data.settings && data.settings.officeSettings) || {};
      $('opt-theme').value = os.theme || 'auto';
      $('opt-daylight').value = os.daylight || 'auto';
      $('opt-liveliness').value = os.liveliness || 'lively';
      $('opt-bubbles').value = os.bubbles || 'important';
      $('opt-show-names').checked = os.showNames !== false;

      cachedPets = data.pets || [];
      if (!selectedPetId && cachedPets.length) selectedPetId = cachedPets[0].id;
      petGridRendered = false;
      if (npcMode === 'pet') renderPetGrid(cachedPets);
      if (!$('poke-chips').children.length) void searchPokeChips('');

      adminState = {
        npcs: data.npcs || [],
        members: data.members || [],
        banned: data.banned || [],
        maps: data.maps || { mode: 'auto', activeMapId: null, rev: 1, presets: [] },
      };
      renderMaps();
      renderNpcs();
      renderMembers();
      renderBans();
    }

    function renderMaps() {
      const ms = adminState.maps || { mode: 'auto', activeMapId: null, rev: 1, presets: [] };
      const activePreset = (ms.presets || []).find((p) => p.id === ms.activeMapId);
      $('map-mode-badge').textContent = ms.mode === 'custom' && activePreset
        ? '自定义地图 · ' + activePreset.name + ' (' + activePreset.width + '×' + activePreset.height + ')'
        : '默认自动模式（根据在线人数动态扩缩容）';
      const tbody = $('maps-tbody');
      const list = ms.presets || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">暂无预设地图</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      for (const p of list) {
        const isActive = ms.mode === 'custom' && ms.activeMapId === p.id;
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.innerHTML = '<strong>' + esc(p.name) + '</strong>' + (isActive ? ' <span class="badge ok">当前线上生效</span>' : '') + '<div class="muted" style="font-size:12px">' + esc(p.id) + '</div>';
        const tdSize = document.createElement('td');
        tdSize.textContent = p.width + ' × ' + p.height + ' 格';
        const tdStats = document.createElement('td');
        tdStats.textContent = p.zoneCount + ' 区域 / ' + p.deskCount + ' 工位';
        const tdAct = document.createElement('td');
        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        if (!isActive) {
          const actBtn = document.createElement('button');
          actBtn.type = 'button';
          actBtn.className = 'btn btn-sm btn-primary';
          actBtn.textContent = '实时启用';
          actBtn.addEventListener('click', () => void activateMapPreset(p.id));
          btnWrap.append(actBtn);
        }
        const dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn btn-sm';
        dlBtn.textContent = '下载 JSON';
        dlBtn.addEventListener('click', () => void downloadMapPreset(p.id));
        btnWrap.append(dlBtn);
        if (!isActive) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn-sm btn-danger';
          delBtn.textContent = '删除';
          delBtn.addEventListener('click', () => void deleteMapPreset(p.id));
          btnWrap.append(delBtn);
        }
        tdAct.append(btnWrap);
        tr.append(tdName, tdSize, tdStats, tdAct);
        tbody.append(tr);
      }
    }

    async function activateMapPreset(mapId) {
      const msg = $('map-msg');
      msg.hidden = false;
      msg.textContent = '正在实时切换线上地图…';
      try {
        const res = await api('/api/admin/maps/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mapId ? { mode: 'custom', mapId } : { mode: 'auto' }),
        });
        if (res && res.maps) {
          adminState.maps = res.maps;
          renderMaps();
          msg.textContent = mapId ? '✅ 已实时切换为自定义地图' : '✅ 已切回默认自动扩容模式';
        }
      } catch (err) {
        msg.textContent = '❌ 切换失败：' + err.message;
      }
    }

    async function downloadMapPreset(mapId) {
      try {
        const res = await api('/api/admin/maps/' + encodeURIComponent(mapId));
        if (!res || !res.doc) return;
        const blob = new Blob([JSON.stringify(res.doc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = mapId + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        alert(err.message);
      }
    }

    async function deleteMapPreset(mapId) {
      if (!confirm('确认删除地图预设 ' + mapId + ' 吗？')) return;
      try {
        const res = await api('/api/admin/maps/' + encodeURIComponent(mapId), { method: 'DELETE' });
        if (res && res.maps) {
          adminState.maps = res.maps;
          renderMaps();
        }
      } catch (err) {
        alert(err.message);
      }
    }

    $('map-auto-btn').addEventListener('click', () => void activateMapPreset(null));

    $('map-copy-mcp-btn').addEventListener('click', async () => {
      const origin = window.location.origin;
      const cfg = {
        mcpServers: {
          'agent-party-map-admin': {
            url: origin + '/api/mcp',
            headers: { Authorization: 'Bearer ' + adminKey },
            stdioFallback: {
              command: 'node',
              args: ['scripts/map-mcp.mjs', '--url', origin, '--token', adminKey],
            },
          },
        },
      };
      await navigator.clipboard?.writeText(JSON.stringify(cfg, null, 2)).catch(() => {});
      const msg = $('map-msg');
      msg.hidden = false;
      msg.textContent = '✅ 已复制管理员 MCP 配置（含全员切换权限）';
    });

    $('map-upload-btn').addEventListener('click', async () => {
      const file = $('map-upload-file').files?.[0];
      const msg = $('map-msg');
      if (!file) {
        msg.hidden = false;
        msg.textContent = '请先选择一个 .json 地图文件。';
        return;
      }
      try {
        const text = await file.text();
        const doc = JSON.parse(text);
        const customName = $('map-upload-name').value.trim();
        const activate = $('map-upload-activate').checked;
        msg.hidden = false;
        msg.textContent = '正在校验并上传地图…';
        const res = await api('/api/admin/maps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc, ...(customName ? { name: customName } : {}), activate }),
        });
        if (res && res.maps) {
          adminState.maps = res.maps;
          renderMaps();
          msg.textContent = activate ? '✅ 上传成功并已实时设为线上地图' : '✅ 已保存到地图预设列表';
          $('map-upload-file').value = '';
          $('map-upload-name').value = '';
        }
      } catch (err) {
        msg.hidden = false;
        msg.textContent = '❌ 上传失败：' + err.message;
      }
    });

    async function searchPokeChips(q = '') {
      const res = await fetch('/api/pokemon/search?q=' + encodeURIComponent(q));
      const data = await res.json().catch(() => ({}));
      const list = data.results || [];
      const wrap = $('poke-chips');
      wrap.innerHTML = '';
      for (const p of list.slice(0, 12)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm';
        b.textContent = '#' + p.dex + ' ' + (p.zh_hans || p.en);
        b.addEventListener('click', () => void selectPokemonForNpc(p.dex, p.zh_hans || p.en));
        wrap.append(b);
      }
    }

    async function selectPokemonForNpc(query, label) {
      const status = $('poke-selected');
      status.textContent = '正在从 SpriteCollab 拉取 ' + (label || query) + '…';
      try {
        const res = await fetch('/api/pokemon/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        const data = await res.json();
        if (!res.ok || !data.pet) throw new Error(data.error || '拉取失败');
        selectedPokemonPetId = data.pet.id;
        status.textContent = '✅ 已就绪：' + data.pet.displayName + ' (' + data.pet.id + ')';
        if (!$('npc-name').value.trim()) {
          $('npc-name').value = data.pokemon?.zh_hans || data.pet.displayName || '';
        }
      } catch (e) {
        status.textContent = '❌ ' + e.message;
      }
    }

    $('poke-search-btn').addEventListener('click', () => void searchPokeChips($('poke-query').value.trim()));
    $('poke-query').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void searchPokeChips($('poke-query').value.trim());
      }
    });

    const npcHumanState = {
      look: 'm',
      seed: 20261124,
      parts: {
        skin: NPC_CUST.skins[1] || NPC_CUST.skins[0],
        hairStyle: 'short',
        hair: NPC_CUST.hairColors[0],
        facialHair: 'none',
        topStyle: 'hoodie',
        top: NPC_CUST.topColors[1] || NPC_CUST.topColors[0],
        bottomStyle: 'pants',
        bottom: NPC_CUST.bottomColors[0],
        accessory: 'none',
      },
    };

    function npcTopPalette(style) {
      if (style === 'shirt_tie') return NPC_CUST.shirtColors;
      if (style === 'jacket') return NPC_CUST.jacketColors;
      return NPC_CUST.topColors;
    }

    function fillNpcSelect(selectId, list, labelMap, selectedVal, isColor) {
      const sel = $(selectId);
      if (!sel) return;
      sel.innerHTML = '';
      list.forEach((val, idx) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = isColor
          ? ('色号 #' + (idx + 1) + ' (' + val + ')')
          : ((labelMap && labelMap[val]) || val);
        sel.append(opt);
      });
      sel.value = list.includes(selectedVal) ? selectedVal : list[0];
    }

    let npcPreviewSeq = 0;
    async function refreshNpcHumanPreview() {
      const c = $('npc-human-preview');
      if (!c) return;
      $('npc-look-m').classList.toggle('btn-primary', npcHumanState.look === 'm');
      $('npc-look-f').classList.toggle('btn-primary', npcHumanState.look === 'f');
      const seq = ++npcPreviewSeq;
      const qs = new URLSearchParams({
        seed: String(npcHumanState.seed >>> 0),
        look: npcHumanState.look,
        parts: JSON.stringify(npcHumanState.parts),
      });
      try {
        const res = await fetch('/api/character/frame?' + qs.toString());
        if (!res.ok) return;
        const data = await res.json();
        if (seq !== npcPreviewSeq || !data || !data.rgbaBase64) return;
        const bin = atob(data.rgbaBase64);
        const raw = new Uint8ClampedArray(bin.length);
        for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
        const off = document.createElement('canvas');
        off.width = data.width;
        off.height = data.height;
        off.getContext('2d').putImageData(new ImageData(raw, data.width, data.height), 0, 0);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(off, 0, 0, c.width, c.height);
      } catch {}
    }

    function syncNpcHumanControls(shouldRefreshPreview = true) {
      const tp = npcTopPalette(npcHumanState.parts.topStyle);
      if (!tp.includes(npcHumanState.parts.top)) npcHumanState.parts.top = tp[0];
      fillNpcSelect('npc-part-skin', NPC_CUST.skins, null, npcHumanState.parts.skin, true);
      if ($('npc-part-look')) $('npc-part-look').value = npcHumanState.look;
      fillNpcSelect('npc-part-hairStyle', NPC_CUST.hairStyles, NPC_CUST.labels.hairStyle, npcHumanState.parts.hairStyle, false);
      fillNpcSelect('npc-part-hair', NPC_CUST.hairColors, null, npcHumanState.parts.hair, true);
      fillNpcSelect('npc-part-facialHair', NPC_CUST.facialHair, NPC_CUST.labels.facialHair, npcHumanState.parts.facialHair, false);
      fillNpcSelect('npc-part-topStyle', NPC_CUST.topStyles, NPC_CUST.labels.topStyle, npcHumanState.parts.topStyle, false);
      fillNpcSelect('npc-part-top', tp, null, npcHumanState.parts.top, true);
      fillNpcSelect('npc-part-bottomStyle', NPC_CUST.bottomStyles, NPC_CUST.labels.bottomStyle, npcHumanState.parts.bottomStyle, false);
      fillNpcSelect('npc-part-bottom', NPC_CUST.bottomColors, null, npcHumanState.parts.bottom, true);
      fillNpcSelect('npc-part-accessory', NPC_CUST.accessories, NPC_CUST.labels.accessory, npcHumanState.parts.accessory, false);
      $('npc-look-m').classList.toggle('btn-primary', npcHumanState.look === 'm');
      $('npc-look-f').classList.toggle('btn-primary', npcHumanState.look === 'f');
      if (shouldRefreshPreview) void refreshNpcHumanPreview();
    }

    function randomizeNpcHuman(preset) {
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const look = preset || (Math.random() < 0.5 ? 'm' : 'f');
      const maleHairs = ['short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'mohawk', 'bald'].filter((x) => NPC_CUST.hairStyles.includes(x));
      const femaleHairs = ['bob', 'long', 'ponytail', 'bun', 'pigtails', 'wavy', 'curly', 'short'].filter((x) => NPC_CUST.hairStyles.includes(x));
      const maleTops = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'polo'].filter((x) => NPC_CUST.topStyles.includes(x));
      const femaleTops = ['blouse', 'sweater', 'hoodie', 'tshirt', 'jacket', 'polo'].filter((x) => NPC_CUST.topStyles.includes(x));
      const maleBottoms = ['pants', 'shorts'].filter((x) => NPC_CUST.bottomStyles.includes(x));
      const femaleBottoms = ['skirt', 'pants', 'shorts'].filter((x) => NPC_CUST.bottomStyles.includes(x));
      const maleAccs = ['glasses', 'sunglasses', 'headphones', 'cap', 'beanie'].filter((x) => NPC_CUST.accessories.includes(x));
      const femaleAccs = ['glasses', 'sunglasses', 'headphones', 'beanie', 'earrings', 'bow'].filter((x) => NPC_CUST.accessories.includes(x));

      npcHumanState.look = look;
      npcHumanState.seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
      npcHumanState.parts.skin = pick(NPC_CUST.skins);
      npcHumanState.parts.hairStyle = pick(look === 'f' && femaleHairs.length ? femaleHairs : (maleHairs.length ? maleHairs : NPC_CUST.hairStyles));
      npcHumanState.parts.hair = pick(NPC_CUST.hairColors);
      npcHumanState.parts.facialHair = look === 'm' && Math.random() < 0.25 ? pick(NPC_CUST.facialHair) : 'none';
      npcHumanState.parts.topStyle = pick(look === 'f' && femaleTops.length ? femaleTops : (maleTops.length ? maleTops : NPC_CUST.topStyles));
      npcHumanState.parts.top = pick(npcTopPalette(npcHumanState.parts.topStyle));
      npcHumanState.parts.bottomStyle = pick(look === 'f' && femaleBottoms.length ? femaleBottoms : (maleBottoms.length ? maleBottoms : NPC_CUST.bottomStyles));
      npcHumanState.parts.bottom = pick(NPC_CUST.bottomColors);
      const accPool = look === 'f' && femaleAccs.length ? femaleAccs : (maleAccs.length ? maleAccs : NPC_CUST.accessories);
      npcHumanState.parts.accessory = Math.random() < 0.5 ? 'none' : pick(accPool);
      syncNpcHumanControls(npcMode === 'human');
    }

    ['skin', 'hairStyle', 'hair', 'facialHair', 'topStyle', 'top', 'bottomStyle', 'bottom', 'accessory'].forEach((key) => {
      const sel = $('npc-part-' + key);
      if (!sel) return;
      sel.addEventListener('change', () => {
        npcHumanState.parts[key] = sel.value;
        if (key === 'topStyle') {
          const tp = npcTopPalette(npcHumanState.parts.topStyle);
          if (!tp.includes(npcHumanState.parts.top)) npcHumanState.parts.top = tp[0];
          fillNpcSelect('npc-part-top', tp, null, npcHumanState.parts.top, true);
        }
        void refreshNpcHumanPreview();
      });
    });

    if ($('npc-part-look')) {
      $('npc-part-look').addEventListener('change', () => {
        npcHumanState.look = $('npc-part-look').value === 'f' ? 'f' : 'm';
        void refreshNpcHumanPreview();
      });
    }

    $('npc-look-m').addEventListener('click', () => randomizeNpcHuman('m'));
    $('npc-look-f').addEventListener('click', () => randomizeNpcHuman('f'));
    $('npc-look-reroll').addEventListener('click', () => randomizeNpcHuman());

    syncNpcHumanControls(false);

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        npcMode = btn.dataset.mode;
        document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        $('npc-pokemon-picker').hidden = npcMode !== 'pokemon';
        $('npc-pet-picker').hidden = npcMode !== 'pet';
        $('npc-human-picker').hidden = npcMode !== 'human';
        if (npcMode === 'pet' && !petGridRendered) renderPetGrid(cachedPets);
        if (npcMode === 'human') void refreshNpcHumanPreview();
        if (npcMode === 'pokemon') {
          $('npc-can-duel').checked = true;
        } else if (npcMode === 'human') {
          $('npc-can-duel').checked = false;
        } else {
          const curPet = cachedPets.find((p) => p.id === selectedPetId);
          $('npc-can-duel').checked = defaultPetDuelFor(curPet);
        }
      });
    });

    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      adminKey = $('admin-key').value.trim();
      if (!adminKey) return;
      try {
        await loadState();
        sessionStorage.setItem(KEY_STORAGE, adminKey);
      } catch (e) {
        if (e.message !== 'Unauthorized') showLogin(e.message);
      }
    });

    $('logout-btn').addEventListener('click', () => {
      sessionStorage.removeItem(KEY_STORAGE);
      adminKey = '';
      showLogin();
    });

    $('refresh-btn').addEventListener('click', async () => {
      const btn = $('refresh-btn');
      btn.disabled = true;
      btn.textContent = '🔄 刷新中…';
      try {
        await loadState();
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 刷新';
      }
    });

    async function savePublicUrl(urlValue) {
      const msgEl = $('settings-msg');
      msgEl.hidden = false;
      msgEl.style.color = 'var(--muted)';
      msgEl.textContent = '正在保存…';
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicUrl: urlValue }),
        });
        $('site-public-url').value = res.publicUrl || '';
        $('effective-base-url').textContent = res.effectiveBaseUrl || window.location.origin;
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = '✅ 已保存，/setup 与 /setup.md 已实时生效';
      } catch (e) {
        msgEl.style.color = '#ff8e99';
        msgEl.textContent = '❌ ' + e.message;
      }
    }

    $('settings-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      void savePublicUrl($('site-public-url').value.trim());
    });

    $('fill-origin-btn').addEventListener('click', () => {
      $('site-public-url').value = window.location.origin;
    });

    $('clear-url-btn').addEventListener('click', () => {
      $('site-public-url').value = '';
      void savePublicUrl('');
    });

    async function saveReceptionSign(signValue) {
      const msgEl = $('sign-msg');
      msgEl.hidden = false;
      msgEl.style.color = 'var(--muted)';
      msgEl.textContent = '正在保存…';
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receptionSign: signValue }),
        });
        $('site-reception-sign').value = signValue ? (res.receptionSign || '') : '';
        $('effective-reception-sign').textContent = res.receptionSign || 'Agent Party';
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = '✅ 黑板文字已实时同步到大屏：' + (res.receptionSign || 'Agent Party');
      } catch (e) {
        msgEl.style.color = '#ff8e99';
        msgEl.textContent = '❌ ' + e.message;
      }
    }

    $('sign-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      void saveReceptionSign($('site-reception-sign').value.trim());
    });

    $('reset-sign-btn').addEventListener('click', () => {
      $('site-reception-sign').value = '';
      void saveReceptionSign('');
    });

    async function saveOfficeSettings(patch) {
      const msgEl = $('office-msg');
      msgEl.hidden = false;
      msgEl.style.color = 'var(--muted)';
      msgEl.textContent = '正在保存大屏全局设置…';
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ officeSettings: patch }),
        });
        const os = res.officeSettings || {};
        $('opt-theme').value = os.theme || 'auto';
        $('opt-daylight').value = os.daylight || 'auto';
        $('opt-liveliness').value = os.liveliness || 'lively';
        $('opt-bubbles').value = os.bubbles || 'important';
        $('opt-show-names').checked = os.showNames !== false;
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = '✅ 已保存，所有大屏画面已实时更新';
      } catch (e) {
        msgEl.style.color = '#ff8e99';
        msgEl.textContent = '❌ ' + e.message;
      }
    }

    $('office-settings-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      void saveOfficeSettings({
        theme: $('opt-theme').value,
        daylight: $('opt-daylight').value,
        liveliness: $('opt-liveliness').value,
        bubbles: $('opt-bubbles').value,
        showNames: $('opt-show-names').checked,
      });
    });

    $('reset-office-btn').addEventListener('click', () => {
      void saveOfficeSettings({
        theme: 'auto',
        daylight: 'auto',
        liveliness: 'lively',
        bubbles: 'important',
        showNames: true,
      });
    });

    function updateFilePickLabels() {
      const sprite = $('up-sprite').files && $('up-sprite').files[0];
      const spriteLabel = $('up-sprite-name');
      if (sprite) {
        const kb = Math.max(1, Math.round(sprite.size / 1024));
        spriteLabel.textContent = sprite.name + ' (' + kb + ' KB)';
        spriteLabel.classList.add('ready');
      } else {
        spriteLabel.textContent = '未选择文件';
        spriteLabel.classList.remove('ready');
      }
      const jf = $('up-json').files && $('up-json').files[0];
      const jsonLabel = $('up-json-name');
      const clearBtn = $('up-json-clear');
      if (jf) {
        jsonLabel.textContent = jf.name;
        jsonLabel.classList.add('ready');
        clearBtn.hidden = false;
      } else {
        jsonLabel.textContent = '未选择，使用默认配置';
        jsonLabel.classList.remove('ready');
        clearBtn.hidden = true;
      }
    }

    $('up-sprite').addEventListener('change', updateFilePickLabels);
    $('up-json').addEventListener('change', updateFilePickLabels);
    $('up-json-clear').addEventListener('click', () => {
      $('up-json').value = '';
      updateFilePickLabels();
    });

    $('up-btn').addEventListener('click', async () => {
      const btn = $('up-btn');
      const upMsg = $('up-msg');
      const sprite = $('up-sprite').files[0];
      const petId = ($('up-id').value.trim() || (sprite ? sprite.name.replace(/\\.[^.]+$/, '') : '')).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const errEl = $('npc-err');
      errEl.hidden = true;
      upMsg.textContent = '';
      if (!sprite || !petId) {
        errEl.textContent = '请填写桌宠 ID 并选择精灵图集图片 (.webp / .png)。';
        errEl.hidden = false;
        return;
      }
      const fd = new FormData();
      fd.append('petId', petId);
      if ($('up-name').value.trim()) fd.append('displayName', $('up-name').value.trim());
      fd.append('sprite', sprite);
      const jsonFile = $('up-json').files[0];
      if (jsonFile) fd.append('petJson', jsonFile);
      btn.disabled = true;
      btn.textContent = '上传中…';
      try {
        const res = await fetch('/api/pets/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '上传失败');
        selectedPetId = data.pet.id;
        const idx = cachedPets.findIndex((p) => p.id === data.pet.id);
        if (idx >= 0) cachedPets[idx] = data.pet;
        else cachedPets.push(data.pet);
        cachedPets.sort((a, b) => (a.displayName || a.id).localeCompare(b.displayName || b.id, 'zh-CN'));
        $('up-id').value = '';
        $('up-name').value = '';
        $('up-sprite').value = '';
        $('up-json').value = '';
        updateFilePickLabels();
        renderPetGrid(cachedPets);
        if (npcMode === 'pet') $('npc-can-duel').checked = defaultPetDuelFor(data.pet);
        upMsg.style.color = 'var(--ok)';
        upMsg.textContent = '✅ 已导入「' + (data.pet.displayName || data.pet.id) + '」并选中';
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = '⬆️ 上传并导入桌宠';
      }
    });

    $('npc-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = $('npc-err');
      const createdEl = $('npc-created-msg');
      const submitBtn = $('npc-submit-btn');
      errEl.hidden = true;
      if (createdEl) createdEl.hidden = true;
      const beh = $('npc-behavior').value;
      const isPetMode = npcMode === 'pet' || npcMode === 'pokemon';
      const chosenPetId = npcMode === 'pokemon' ? selectedPokemonPetId : selectedPetId;
      if (isPetMode && !chosenPetId) {
        errEl.textContent = npcMode === 'pokemon' ? '请先点击选择一只宝可梦！' : '请先选择一个 Codex V2 桌宠！';
        errEl.hidden = false;
        return;
      }
      const body = {
        name: $('npc-name').value.trim(),
        role: $('npc-role').value.trim() || '常驻 NPC',
        agentTool: $('npc-tool').value.trim() || 'NPC',
        avatarMode: isPetMode ? 'pet' : 'human',
        ...(isPetMode
          ? { petId: chosenPetId }
          : { look: npcHumanState.look, seed: npcHumanState.seed >>> 0, parts: npcHumanState.parts }),
        canDuel: $('npc-can-duel').checked,
        status: beh === 'working' ? 'working' : 'idle',
        npcAuto: beh === 'auto',
      };
      submitBtn.disabled = true;
      submitBtn.textContent = '生成中…';
      try {
        const res = await api('/api/admin/npcs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        $('npc-name').value = '';
        if (res && res.npc) {
          adminState.npcs.unshift(res.npc);
          renderNpcs();
        }
        if (createdEl && res && res.npc && res.npc.editToken) {
          const code = res.npc.editToken;
          createdEl.hidden = false;
          createdEl.style.color = 'var(--ok)';
          createdEl.innerHTML = '✅ 已创建 <strong>' + esc(res.npc.name) + '</strong> · 专属代号: <code>' + esc(code) + '</code> · <a href="/customize/' + encodeURIComponent(code) + '" target="_blank" style="color:var(--accent)">打开专属捏脸页面 🎨</a>';
        }
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '➕ 生成 NPC 并加入办公室';
      }
    });

    document.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn || btn.disabled) return;
      try {
        if (btn.dataset.duelToggle) {
          const id = btn.dataset.duelToggle;
          const next = btn.dataset.duelNext === 'true';
          const target = adminState.npcs.find((n) => n.id === id) || adminState.members.find((m) => m.id === id);
          const prevVal = target ? !!target.canDuel : !next;
          if (target) target.canDuel = next;
          btn.disabled = true;
          btn.style.borderColor = next ? 'rgba(250,204,21,0.55)' : '';
          btn.style.color = next ? '#fde047' : '';
          btn.style.opacity = next ? '' : '0.78';
          btn.textContent = next ? '⚔️ 参战中' : '🍿 仅围观 (点此开启)';
          btn.dataset.duelNext = next ? 'false' : 'true';
          try {
            const r = await api('/api/admin/members/' + encodeURIComponent(id) + '/duel', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ canDuel: next }),
            });
            if (target && typeof r.canDuel === 'boolean') target.canDuel = r.canDuel;
          } catch (err) {
            if (target) target.canDuel = prevVal;
            renderNpcs();
            renderMembers();
            throw err;
          } finally {
            btn.disabled = false;
          }
        } else if (btn.dataset.kick) {
          const id = btn.dataset.kick;
          const orig = btn.textContent;
          btn.disabled = true;
          btn.textContent = '移出中…';
          try {
            const res = await api('/api/admin/members/' + encodeURIComponent(id) + '/kick', { method: 'POST' });
            adminState = { npcs: res.npcs || [], members: res.members || [], banned: res.banned || [] };
            renderNpcs();
            renderMembers();
            renderBans();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = orig;
            throw err;
          }
        } else if (btn.dataset.ban) {
          const id = btn.dataset.ban;
          const orig = btn.textContent;
          btn.disabled = true;
          btn.textContent = '处理中…';
          try {
            const res = await api('/api/admin/members/' + encodeURIComponent(id) + '/ban', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: '管理员移出并封禁' }),
            });
            adminState = { npcs: res.npcs || [], members: res.members || [], banned: res.banned || [] };
            renderNpcs();
            renderMembers();
            renderBans();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = orig;
            throw err;
          }
        } else if (btn.dataset.unban) {
          const id = btn.dataset.unban;
          const orig = btn.textContent;
          btn.disabled = true;
          btn.textContent = '解封中…';
          try {
            const res = await api('/api/admin/bans/' + encodeURIComponent(id), { method: 'DELETE' });
            adminState = { npcs: res.npcs || [], members: res.members || [], banned: res.banned || [] };
            renderNpcs();
            renderMembers();
            renderBans();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = orig;
            throw err;
          }
        } else if (btn.dataset.npcDel) {
          const id = btn.dataset.npcDel;
          const orig = btn.textContent;
          btn.disabled = true;
          btn.textContent = '删除中…';
          try {
            await api('/api/admin/npcs/' + encodeURIComponent(id), { method: 'DELETE' });
            adminState.npcs = adminState.npcs.filter((n) => n.id !== id);
            renderNpcs();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = orig;
            throw err;
          }
        } else if (btn.dataset.npcToggle) {
          const id = btn.dataset.npcToggle;
          const orig = btn.textContent;
          btn.disabled = true;
          btn.textContent = '切换中…';
          try {
            const res = await api('/api/admin/npcs/' + encodeURIComponent(id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: btn.dataset.next, npcAuto: false }),
            });
            if (res && res.npc) {
              const idx = adminState.npcs.findIndex((n) => n.id === id);
              if (idx >= 0) adminState.npcs[idx] = res.npc;
              renderNpcs();
            }
          } catch (err) {
            btn.disabled = false;
            btn.textContent = orig;
            throw err;
          }
        } else if (btn.dataset.npcReroll) {
          const id = btn.dataset.npcReroll;
          const orig = btn.textContent;
          btn.disabled = true;
          btn.textContent = '更换中…';
          try {
            const res = await api('/api/admin/npcs/' + encodeURIComponent(id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reroll: true }),
            });
            if (res && res.npc) {
              const idx = adminState.npcs.findIndex((n) => n.id === id);
              if (idx >= 0) adminState.npcs[idx] = res.npc;
              renderNpcs();
            }
          } catch (err) {
            btn.disabled = false;
            btn.textContent = orig;
            throw err;
          }
        }
      } catch (e) {
        alert(e.message);
      }
    });

    if (adminKey) {
      loadState().catch(() => {});
    }
  </script>
</body>
</html>`;
}
