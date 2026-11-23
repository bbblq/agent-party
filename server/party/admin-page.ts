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
    .btn:hover { border-color: var(--accent); }
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
    .upload-box {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px dashed var(--border);
      background: #0b0f17;
      margin-bottom: 14px;
    }
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
            <div class="upload-box">
              <span class="muted">或直接上传本地桌宠（.webp / .png + 可选 pet.json）：</span>
              <input id="up-id" type="text" placeholder="petId (如 pikachu)" style="width:140px" />
              <input id="up-name" type="text" placeholder="显示名称" style="width:140px" />
              <input id="up-sprite" type="file" accept=".webp,.png,image/webp,image/png" />
              <input id="up-json" type="file" accept=".json,application/json" title="可选 pet.json" />
              <button class="btn btn-sm" id="up-btn" type="button">上传桌宠</button>
            </div>
          </div>

          <div id="npc-err" class="err" hidden></div>
          <button class="btn btn-primary" type="submit">➕ 生成 NPC 并加入办公室</button>
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
    const KEY_STORAGE = 'agent_party_admin_key';
    let adminKey = sessionStorage.getItem(KEY_STORAGE) || '';
    let npcMode = 'pokemon';
    let selectedPetId = '';
    let selectedPokemonPetId = '';
    let cachedPets = [];
    const thumbCache = new Map();

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
      return new Promise((resolve) => {
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
    }

    function renderPetGrid(pets) {
      cachedPets = pets;
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
          renderPetGrid(cachedPets);
        });
        grid.append(btn);
      }
    }

    function statusPill(st) {
      const map = { working: '工作中', idle: '自由活动', waiting: '等待确认', offline: '已离线' };
      return '<span class="pill ' + esc(st) + '">' + esc(map[st] || st) + '</span>';
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

      renderPetGrid(data.pets || []);
      if (!$('poke-chips').children.length) void searchPokeChips('');

      // NPCs
      const npcs = data.npcs || [];
      $('npc-count').textContent = String(npcs.length);
      const npcBody = $('npc-tbody');
      npcBody.innerHTML = npcs.length
        ? npcs.map((n) => {
            const lookLabel = n.avatarMode === 'pet' ? ('🐾 ' + esc(n.petId)) : '🧑 像素小人';
            const modeLabel = n.npcAuto ? '自动劳逸结合' : '固定状态';
            return '<tr>' +
              '<td><strong>' + esc(n.name) + '</strong><div class="muted">' + esc(n.role) + '</div></td>' +
              '<td>' + lookLabel + '</td>' +
              '<td>' + modeLabel + '</td>' +
              '<td>' + statusPill(n.lastStatus) + '</td>' +
              '<td><div class="actions">' +
                '<button class="btn btn-sm" data-npc-toggle="' + esc(n.id) + '" data-next="' + (n.lastStatus === 'working' ? 'idle' : 'working') + '">' + (n.lastStatus === 'working' ? '去摸鱼' : '去办公') + '</button>' +
                (n.avatarMode === 'human' ? '<button class="btn btn-sm" data-npc-reroll="' + esc(n.id) + '">换个造型</button>' : '') +
                '<button class="btn btn-sm btn-danger" data-npc-del="' + esc(n.id) + '">删除</button>' +
              '</div></td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="5" class="muted">暂无常驻 NPC</td></tr>';

      // Real members
      const members = data.members || [];
      $('member-count').textContent = String(members.length);
      const mBody = $('member-tbody');
      mBody.innerHTML = members.length
        ? members.map((m) => {
            const lookLabel = m.avatarMode === 'pet' ? ('🐾 ' + esc(m.petId)) : '🧑 像素小人';
            const ownerSub = m.ownerId ? (' · 伴随宠物 (所属 ' + esc(m.ownerId) + ')') : '';
            return '<tr>' +
              '<td><strong>' + esc(m.name) + '</strong><div class="muted">ID: ' + esc(m.id) + ' · ' + esc(m.role) + ownerSub + '</div></td>' +
              '<td>' + (m.agentTool ? '<span class="pill tool">' + esc(m.agentTool) + '</span>' : '<span class="muted">-</span>') + '</td>' +
              '<td>' + lookLabel + '</td>' +
              '<td>' + statusPill(m.lastStatus) + '</td>' +
              '<td class="muted">' + fmtTime(m.lastSeenAt) + '</td>' +
              '<td><div class="actions">' +
                '<button class="btn btn-sm btn-warn" data-kick="' + esc(m.id) + '">移出</button>' +
                '<button class="btn btn-sm btn-danger" data-ban="' + esc(m.id) + '">移出并封禁</button>' +
              '</div></td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="6" class="muted">暂无成员接入</td></tr>';

      // Bans
      const bans = data.banned || [];
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

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        npcMode = btn.dataset.mode;
        document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        $('npc-pokemon-picker').hidden = npcMode !== 'pokemon';
        $('npc-pet-picker').hidden = npcMode !== 'pet';
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

    $('refresh-btn').addEventListener('click', () => void loadState());

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

    $('up-btn').addEventListener('click', async () => {
      const sprite = $('up-sprite').files[0];
      const petId = ($('up-id').value.trim() || (sprite ? sprite.name.replace(/\\.[^.]+$/, '') : '')).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const errEl = $('npc-err');
      errEl.hidden = true;
      if (!sprite || !petId) {
        errEl.textContent = '请填写 petId 并选择 spritesheet (.webp/.png) 文件。';
        errEl.hidden = false;
        return;
      }
      const fd = new FormData();
      fd.append('petId', petId);
      if ($('up-name').value.trim()) fd.append('displayName', $('up-name').value.trim());
      fd.append('sprite', sprite);
      const jsonFile = $('up-json').files[0];
      if (jsonFile) fd.append('petJson', jsonFile);
      try {
        const res = await fetch('/api/pets/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '上传失败');
        selectedPetId = data.pet.id;
        $('up-id').value = '';
        $('up-name').value = '';
        $('up-sprite').value = '';
        $('up-json').value = '';
        await loadState();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    });

    $('npc-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = $('npc-err');
      errEl.hidden = true;
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
        ...(isPetMode ? { petId: chosenPetId } : {}),
        status: beh === 'working' ? 'working' : 'idle',
        npcAuto: beh === 'auto',
      };
      try {
        await api('/api/admin/npcs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        $('npc-name').value = '';
        await loadState();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    });

    document.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      try {
        if (btn.dataset.kick) {
          await api('/api/admin/members/' + encodeURIComponent(btn.dataset.kick) + '/kick', { method: 'POST' });
          await loadState();
        } else if (btn.dataset.ban) {
          await api('/api/admin/members/' + encodeURIComponent(btn.dataset.ban) + '/ban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: '管理员移出并封禁' }),
          });
          await loadState();
        } else if (btn.dataset.unban) {
          await api('/api/admin/bans/' + encodeURIComponent(btn.dataset.unban), { method: 'DELETE' });
          await loadState();
        } else if (btn.dataset.npcDel) {
          await api('/api/admin/npcs/' + encodeURIComponent(btn.dataset.npcDel), { method: 'DELETE' });
          await loadState();
        } else if (btn.dataset.npcToggle) {
          await api('/api/admin/npcs/' + encodeURIComponent(btn.dataset.npcToggle), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: btn.dataset.next, npcAuto: false }),
          });
          await loadState();
        } else if (btn.dataset.npcReroll) {
          await api('/api/admin/npcs/' + encodeURIComponent(btn.dataset.npcReroll), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reroll: true }),
          });
          await loadState();
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
