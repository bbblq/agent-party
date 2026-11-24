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
  EYES,
  HAIR_FUN,
  HAIR_NATURAL,
  JACKET_COLORS,
  LIGHT_ACCENTS,
  SHIRT_COLORS,
  SHOES,
  SKINS,
  TIE_COLORS,
  TOP_COLORS,
} from '../../shared/world/appearance-flat';

function escapeHtmlAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const HAIR_COLOR_LIST = [...HAIR_NATURAL.map(([c]) => c), ...HAIR_FUN];
const EYE_COLOR_LIST = [...new Set(EYES)];
const BOTTOM_COLOR_LIST = BOTTOMS.map(([c]) => c);
const SHOE_COLOR_LIST = SHOES.map(([c]) => c);
const ACCENT_COLOR_LIST = [...new Set([...LIGHT_ACCENTS, ...TOP_COLORS])];

const STYLE_LABELS = {
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
  facialHair: {
    none: '无胡须',
    stubble: '胡茬',
    beard: '络腮胡',
    mustache: '八字胡',
    goatee: '山羊胡',
  },
};

export function renderCustomizeHtml(baseUrl: string, initialCode = ''): string {
  const safeBase = baseUrl.replace(/\/+$/, '');
  const initialCodeJson = JSON.stringify(initialCode.trim()).replaceAll('<', '\\u003c');
  const paletteData = JSON.stringify({
    serverUrl: safeBase,
    skins: SKINS,
    hairColors: HAIR_COLOR_LIST,
    hairStyles: HAIR_STYLES,
    eyes: EYE_COLOR_LIST,
    topStyles: TOP_STYLES,
    topColors: TOP_COLORS,
    shirtColors: SHIRT_COLORS,
    tieColors: TIE_COLORS,
    jacketColors: JACKET_COLORS,
    accentColors: ACCENT_COLOR_LIST,
    bottomStyles: BOTTOM_STYLES,
    bottomColors: BOTTOM_COLOR_LIST,
    shoeColors: SHOE_COLOR_LIST,
    accessories: ACCESSORIES,
    accColors: ACC_COLORS,
    facialHair: FACIAL_HAIR,
    labels: STYLE_LABELS,
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Party — 像素小人捏脸工坊</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c111b;
      --panel: #151c2c;
      --card: #111725;
      --border: #28334a;
      --text: #eef3ff;
      --muted: #93a2be;
      --accent: #52c4ff;
      --ok: #4ade80;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #17233a 0%, var(--bg) 62%);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap { max-width: 1060px; margin: 0 auto; padding: 20px 18px 48px; }
    .topbar {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 18px;
    }
    .title h1 { margin: 0; font-size: 22px; }
    .title p { margin: 3px 0 0; color: var(--muted); font-size: 13px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 8px 14px; border-radius: 9px; border: 1px solid var(--border);
      background: #1b2438; color: var(--text); font-size: 13px; font-weight: 600;
      cursor: pointer; text-decoration: none;
    }
    .btn:hover { border-color: var(--accent); }
    .btn-primary {
      background: linear-gradient(135deg, #2b8cff, #47c5ff);
      color: #051324; border: none;
    }
    .btn-ok {
      background: linear-gradient(135deg, #22c55e, #4ade80);
      color: #052010; border: none;
    }
    .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 7px; }
    .grid {
      display: grid; grid-template-columns: 320px 1fr; gap: 18px; align-items: start;
    }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 14px; padding: 16px;
    }
    .preview-box {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      background: linear-gradient(180deg, #1b2640 0%, #101624 100%);
      border: 1px solid rgba(82, 196, 255, 0.25);
      border-radius: 12px; padding: 18px 12px; margin-bottom: 14px;
    }
    canvas#preview {
      width: 168px; height: 238px; image-rendering: pixelated; image-rendering: crisp-edges;
      filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45));
    }
    .look-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
    .field { margin-bottom: 11px; }
    .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    input[type="text"], textarea {
      width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
      background: #0b101b; color: var(--text); font-size: 13px;
    }
    .section {
      background: var(--card); border: 1px solid var(--border);
      border-radius: 11px; padding: 12px 14px; margin-bottom: 12px;
    }
    .section h3 { margin: 0 0 10px; font-size: 13px; color: var(--accent); }
    .opt-row { margin-bottom: 10px; }
    .opt-row:last-child { margin-bottom: 0; }
    .opt-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; display: block; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      padding: 4px 9px; border-radius: 7px; border: 1px solid var(--border);
      background: #182135; color: var(--text); font-size: 12px; cursor: pointer;
    }
    .chip.active {
      border-color: var(--accent); background: rgba(82, 196, 255, 0.22); color: #fff; font-weight: 600;
    }
    .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
    .swatch {
      width: 24px; height: 24px; border-radius: 6px; border: 2px solid rgba(255,255,255,0.16);
      cursor: pointer; padding: 0;
    }
    .swatch.active {
      border-color: #ffffff; box-shadow: 0 0 0 2px var(--accent); transform: scale(1.08);
    }
    .code-box {
      margin-top: 12px; background: #0a0f18; border: 1px dashed rgba(82, 196, 255, 0.4);
      border-radius: 10px; padding: 10px 12px;
    }
    .code-box code {
      display: block; word-break: break-all; font-size: 11px; color: #bfe4ff;
      max-height: 70px; overflow-y: auto; margin-top: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .msg { font-size: 12px; margin-top: 8px; }
    .token-card {
      background: rgba(82, 196, 255, 0.08);
      border: 1px solid rgba(82, 196, 255, 0.35);
      border-radius: 11px;
      padding: 11px 12px;
      margin-bottom: 14px;
    }
    .token-card h3 {
      margin: 0 0 6px;
      font-size: 13px;
      color: var(--accent);
    }
    .identity-banner {
      margin-top: 8px;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid var(--border);
      color: var(--muted);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .identity-banner.ok {
      border-color: rgba(74, 222, 128, 0.45);
      background: rgba(20, 83, 45, 0.25);
      color: #dcfce7;
    }
    .identity-banner.err {
      border-color: rgba(248, 113, 113, 0.45);
      background: rgba(127, 29, 29, 0.25);
      color: #fecaca;
    }
    .pet-quick {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="title">
        <h1>🎨 像素小人捏脸工坊</h1>
        <p>输入你的专属后台代码（或通过专属链接直接进入）自动识别身份，捏脸修改后一键保存回办公室。</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" id="open-office-link" href="${escapeHtmlAttr(safeBase)}/" target="_blank">🏢 打开虚拟办公室大屏</a>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="token-card">
          <h3>🔑 身份识别（专属后台代码）</h3>
          <div style="display:flex;gap:6px">
            <input id="inp-token" type="text" placeholder="粘贴专属代码（如 ap_xxxxxx）或专属链接" value="${escapeHtmlAttr(initialCode)}" />
            <button class="btn btn-primary btn-sm" id="load-token-btn" type="button" style="white-space:nowrap">识别身份</button>
          </div>
          <div id="identity-banner" class="identity-banner">
            <span>粘贴接入后拿到的专属后台代码即可载入你的角色；或直接填写下方昵称保存。</span>
          </div>
          <div style="margin-top:8px;display:none" id="direct-link-row">
            <button class="btn btn-sm" id="copy-direct-link-btn" type="button" style="width:100%">🔗 复制专属捏脸链接</button>
          </div>
        </div>

        <div class="preview-box">
          <canvas id="preview" width="168" height="238"></canvas>
          <div class="look-row">
            <button class="btn btn-sm" id="look-m" type="button">👦 风格 A</button>
            <button class="btn btn-sm" id="look-f" type="button">👧 风格 B</button>
            <button class="btn btn-sm" id="reroll-btn" type="button">🎲 随机穿搭</button>
          </div>
        </div>

        <div class="field">
          <label for="inp-name">你的昵称（头顶显示）</label>
          <input id="inp-name" type="text" maxlength="24" placeholder="例如：小张 / Alice" />
        </div>
        <div class="field">
          <label for="inp-role">职位 / 岗位（可选）</label>
          <input id="inp-role" type="text" maxlength="32" placeholder="例如：全栈开发 / AI 伙伴" />
        </div>
        <div class="field">
          <label for="inp-pet">伴随宝可梦（填名字/编号；选“不带宠物”可移除）</label>
          <input id="inp-pet" type="text" maxlength="32" placeholder="例如：皮卡丘 / 可达鸭 / 耿鬼" />
          <div class="pet-quick" id="pet-quick-chips">
            <button class="chip" type="button" data-pet="皮卡丘">皮卡丘</button>
            <button class="chip" type="button" data-pet="可达鸭">可达鸭</button>
            <button class="chip" type="button" data-pet="耿鬼">耿鬼</button>
            <button class="chip" type="button" data-pet="伊布">伊布</button>
            <button class="chip" type="button" data-pet="卡比兽">卡比兽</button>
            <button class="chip" type="button" data-pet="喷火龙">喷火龙</button>
            <button class="chip" type="button" data-pet="路卡利欧">路卡利欧</button>
            <button class="chip" type="button" data-pet="">不带宠物</button>
          </div>
        </div>
        <div class="field">
          <label for="inp-server">后台服务器地址</label>
          <input id="inp-server" type="text" />
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
          <button class="btn btn-ok" id="send-btn" type="button">💾 保存修改到办公室后台</button>
          <button class="btn btn-primary" id="copy-code-btn" type="button">📋 复制 AP1:... 离线换装代码</button>
        </div>
        <div id="status-msg" class="msg"></div>

        <div class="code-box">
          <div style="font-size:12px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">
            <span>离线换装代码（无直连时可发回 AI 对话框应用）</span>
          </div>
          <code id="code-out"></code>
        </div>

        <div class="code-box" style="margin-top:10px;border-style:solid;border-color:var(--border)">
          <label for="code-import" style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">导入已有 AP1:... 离线代码继续修改：</label>
          <div style="display:flex;gap:6px">
            <input id="code-import" type="text" placeholder="粘贴 AP1:... 代码" />
            <button class="btn btn-sm" id="import-btn" type="button">载入</button>
          </div>
        </div>
      </div>

      <div class="card" id="controls"></div>
    </div>
  </div>

  <script>
    const DATA = ${paletteData};
    const INITIAL_CODE = ${initialCodeJson};
    const $ = (id) => document.getElementById(id);

    const state = {
      name: '',
      role: 'AI 伙伴',
      companionPokemon: '',
      look: 'm',
      seed: 20261124,
      parts: {
        skin: DATA.skins[1],
        hairStyle: 'short',
        hair: DATA.hairColors[0],
        facialHair: 'none',
        eyes: DATA.eyes[0],
        topStyle: 'hoodie',
        top: DATA.topColors[1],
        topAccent: DATA.accentColors[0],
        bottomStyle: 'pants',
        bottom: DATA.bottomColors[0],
        shoes: DATA.shoeColors[0],
        accessory: 'none',
        accessoryColor: DATA.accColors.glasses[0],
      },
    };

    const serverDefault = (typeof location !== 'undefined' && location.protocol.startsWith('http'))
      ? location.origin
      : DATA.serverUrl;
    $('inp-server').value = serverDefault;
    $('open-office-link').href = serverDefault + '/';

    function topPalettes(style) {
      if (style === 'shirt_tie') return { top: DATA.shirtColors, topAccent: DATA.tieColors };
      if (style === 'jacket') return { top: DATA.jacketColors, topAccent: DATA.accentColors };
      return { top: DATA.topColors, topAccent: DATA.accentColors };
    }

    function fitParts() {
      const tp = topPalettes(state.parts.topStyle);
      if (!tp.top.includes(state.parts.top)) state.parts.top = tp.top[0];
      if (!tp.topAccent.includes(state.parts.topAccent)) state.parts.topAccent = tp.topAccent[0];
      const ac = DATA.accColors[state.parts.accessory] || DATA.accColors.none;
      if (!ac.includes(state.parts.accessoryColor)) state.parts.accessoryColor = ac[0];
    }

    function utf8ToB64Url(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
    }

    function b64UrlToUtf8(b64u) {
      let b64 = b64u.replaceAll('-', '+').replaceAll('_', '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }

    function buildPayload() {
      const name = $('inp-name').value.trim();
      const role = $('inp-role').value.trim();
      const pet = $('inp-pet').value.trim();
      return {
        v: 1,
        ...(name ? { name } : {}),
        ...(role ? { role } : {}),
        look: state.look,
        seed: state.seed >>> 0,
        parts: { ...state.parts },
        ...(pet ? { companionPokemon: pet } : {}),
      };
    }

    function currentCode() {
      return 'AP1:' + utf8ToB64Url(JSON.stringify(buildPayload()));
    }

    function drawOfflineFallback() {
      const c = $('preview');
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      const S = 7;
      const px = (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x * S, y * S, w * S, h * S);
      };
      const p = state.parts;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(6 * S, 30 * S, 12 * S, 2 * S);
      // shoes
      px(8, 29, 3, 2, p.shoes);
      px(13, 29, 3, 2, p.shoes);
      // bottom
      if (p.bottomStyle === 'skirt') {
        px(8, 24, 8, 3, p.bottom);
        px(9, 27, 2, 2, p.skin);
        px(13, 27, 2, 2, p.skin);
      } else if (p.bottomStyle === 'shorts') {
        px(8, 24, 3, 3, p.bottom);
        px(13, 24, 3, 3, p.bottom);
        px(8, 24, 8, 1, p.bottom);
        px(9, 27, 2, 2, p.skin);
        px(13, 27, 2, 2, p.skin);
      } else {
        px(8, 24, 8, 2, p.bottom);
        px(8, 26, 3, 3, p.bottom);
        px(13, 26, 3, 3, p.bottom);
      }
      // top
      px(7, 18, 10, 6, p.top);
      px(6, 19, 1, 4, p.top);
      px(17, 19, 1, 4, p.top);
      px(6, 23, 1, 1, p.skin);
      px(17, 23, 1, 1, p.skin);
      if (p.topStyle === 'shirt_tie') px(11, 18, 2, 5, p.topAccent);
      else if (p.topStyle === 'hoodie') px(9, 18, 6, 2, p.topAccent);
      else if (p.topStyle === 'jacket') px(10, 18, 4, 6, p.topAccent);
      // head
      px(7, 8, 10, 9, p.skin);
      // eyes
      px(9, 12, 2, 2, p.eyes);
      px(13, 12, 2, 2, p.eyes);
      // hair
      if (p.hairStyle !== 'bald') {
        px(7, 6, 10, 3, p.hair);
        if (p.hairStyle === 'long' || p.hairStyle === 'bob' || p.hairStyle === 'wavy' || p.hairStyle === 'pigtails') {
          px(6, 8, 1, 9, p.hair);
          px(17, 8, 1, 9, p.hair);
        } else if (p.hairStyle === 'afro') {
          px(5, 5, 14, 5, p.hair);
        } else if (p.hairStyle === 'spiky' || p.hairStyle === 'mohawk') {
          px(9, 4, 6, 2, p.hair);
        }
      }
      // accessory
      if (p.accessory === 'glasses' || p.accessory === 'sunglasses') {
        const col = p.accessory === 'sunglasses' ? '#111827' : p.accessoryColor;
        px(8, 12, 3, 2, col);
        px(13, 12, 3, 2, col);
        px(11, 12, 2, 1, col);
      } else if (p.accessory === 'cap' || p.accessory === 'beanie') {
        px(7, 5, 10, 3, p.accessoryColor);
        if (p.accessory === 'cap') px(11, 7, 7, 1, p.accessoryColor);
      } else if (p.accessory === 'headphones') {
        px(6, 10, 1, 5, p.accessoryColor);
        px(17, 10, 1, 5, p.accessoryColor);
        px(7, 5, 10, 1, p.accessoryColor);
      } else if (p.accessory === 'bow') {
        px(14, 6, 4, 2, p.accessoryColor);
      }
    }

    let previewSeq = 0;
    async function refreshPreview() {
      $('code-out').textContent = currentCode();
      $('look-m').classList.toggle('btn-primary', state.look === 'm');
      $('look-f').classList.toggle('btn-primary', state.look === 'f');

      const seq = ++previewSeq;
      const base = ($('inp-server').value.trim() || serverDefault).replace(/\\/+$/, '');
      const qs = new URLSearchParams({
        seed: String(state.seed >>> 0),
        look: state.look,
        parts: JSON.stringify(state.parts),
      });
      try {
        const res = await fetch(base + '/api/character/frame?' + qs.toString());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (seq !== previewSeq || !data || !data.rgbaBase64) return;
        const bin = atob(data.rgbaBase64);
        const raw = new Uint8ClampedArray(bin.length);
        for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
        const off = document.createElement('canvas');
        off.width = data.width;
        off.height = data.height;
        off.getContext('2d').putImageData(new ImageData(raw, data.width, data.height), 0, 0);
        const c = $('preview');
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(off, 0, 0, c.width, c.height);
      } catch {
        if (seq === previewSeq) drawOfflineFallback();
      }
    }

    function renderControls() {
      fitParts();
      const tp = topPalettes(state.parts.topStyle);
      const accList = DATA.accColors[state.parts.accessory] || DATA.accColors.none;
      const groups = [
        {
          title: '肤色与面部',
          rows: [
            { key: 'skin', label: '肤色', kind: 'color', list: DATA.skins },
            { key: 'eyes', label: '瞳色', kind: 'color', list: DATA.eyes },
            { key: 'facialHair', label: '胡须', kind: 'style', list: DATA.facialHair },
          ],
        },
        {
          title: '发型与发色',
          rows: [
            { key: 'hairStyle', label: '发型', kind: 'style', list: DATA.hairStyles },
            { key: 'hair', label: '发色', kind: 'color', list: DATA.hairColors },
          ],
        },
        {
          title: '上衣穿搭',
          rows: [
            { key: 'topStyle', label: '款式', kind: 'style', list: DATA.topStyles },
            { key: 'top', label: '主色', kind: 'color', list: tp.top },
            { key: 'topAccent', label: '撞色 / 领带', kind: 'color', list: tp.topAccent },
          ],
        },
        {
          title: '下装与鞋子',
          rows: [
            { key: 'bottomStyle', label: '裤/裙款式', kind: 'style', list: DATA.bottomStyles },
            { key: 'bottom', label: '下装颜色', kind: 'color', list: DATA.bottomColors },
            { key: 'shoes', label: '鞋子颜色', kind: 'color', list: DATA.shoeColors },
          ],
        },
        {
          title: '头饰与眼镜',
          rows: [
            { key: 'accessory', label: '配饰', kind: 'style', list: DATA.accessories },
            ...(state.parts.accessory !== 'none'
              ? [{ key: 'accessoryColor', label: '配饰颜色', kind: 'color', list: accList }]
              : []),
          ],
        },
      ];

      const root = $('controls');
      root.innerHTML = '';
      for (const g of groups) {
        const sec = document.createElement('div');
        sec.className = 'section';
        const h3 = document.createElement('h3');
        h3.textContent = g.title;
        sec.append(h3);

        for (const r of g.rows) {
          const row = document.createElement('div');
          row.className = 'opt-row';
          const lbl = document.createElement('span');
          lbl.className = 'opt-label';
          lbl.textContent = r.label;
          const wrap = document.createElement('div');
          wrap.className = r.kind === 'color' ? 'swatches' : 'chips';

          for (const val of r.list) {
            const b = document.createElement('button');
            b.type = 'button';
            if (r.kind === 'color') {
              b.className = 'swatch' + (state.parts[r.key] === val ? ' active' : '');
              b.style.background = val;
              b.title = val;
            } else {
              b.className = 'chip' + (state.parts[r.key] === val ? ' active' : '');
              b.textContent = (DATA.labels[r.key] && DATA.labels[r.key][val]) || val;
            }
            b.addEventListener('click', () => {
              state.parts[r.key] = val;
              renderControls();
              void refreshPreview();
            });
            wrap.append(b);
          }
          row.append(lbl, wrap);
          sec.append(row);
        }
        root.append(sec);
      }
    }

    function randomizeLook() {
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      state.look = Math.random() < 0.5 ? 'm' : 'f';
      state.seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
      state.parts.skin = pick(DATA.skins);
      state.parts.hairStyle = pick(DATA.hairStyles);
      state.parts.hair = pick(DATA.hairColors);
      state.parts.eyes = pick(DATA.eyes);
      state.parts.topStyle = pick(DATA.topStyles);
      const tp = topPalettes(state.parts.topStyle);
      state.parts.top = pick(tp.top);
      state.parts.topAccent = pick(tp.topAccent);
      state.parts.bottomStyle = pick(DATA.bottomStyles);
      state.parts.bottom = pick(DATA.bottomColors);
      state.parts.shoes = pick(DATA.shoeColors);
      state.parts.accessory = Math.random() < 0.55 ? 'none' : pick(DATA.accessories);
      state.parts.accessoryColor = pick(DATA.accColors[state.parts.accessory] || DATA.accColors.none);
      state.parts.facialHair = state.look === 'm' && Math.random() < 0.25 ? pick(DATA.facialHair) : 'none';
      renderControls();
      void refreshPreview();
    }

    let recognizedCode = '';
    let recognizedUrl = '';

    function extractToken(raw) {
      const m = /(?:^|\\/|\\b)(ap_[A-Za-z0-9_-]{8,48})\\b/.exec(String(raw || '').trim());
      return m ? m[1] : '';
    }

    function syncPetQuickChips() {
      const cur = $('inp-pet').value.trim();
      const chips = $('pet-quick-chips').querySelectorAll('[data-pet]');
      for (const ch of chips) {
        const val = ch.getAttribute('data-pet') || '';
        ch.classList.toggle('active', val === cur);
      }
    }

    function setIdentityBanner(kind, htmlText) {
      const el = $('identity-banner');
      el.className = 'identity-banner' + (kind ? ' ' + kind : '');
      el.textContent = htmlText;
    }

    function applyProfile(profile) {
      recognizedCode = profile.customizeCode || '';
      recognizedUrl = profile.customizeUrl || (serverDefault + '/customize/' + recognizedCode);
      if (recognizedCode) $('inp-token').value = recognizedCode;
      $('inp-name').value = profile.name || '';
      $('inp-role').value = profile.role || '';
      $('inp-pet').value = profile.companionPetName || '';
      if (profile.look === 'f' || profile.look === 'm') state.look = profile.look;
      if (typeof profile.seed === 'number') state.seed = profile.seed >>> 0;
      if (profile.parts && typeof profile.parts === 'object') Object.assign(state.parts, profile.parts);
      syncPetQuickChips();
      renderControls();
      void refreshPreview();

      const petHint = profile.companionFullName
        ? (' · 宠物：' + profile.companionFullName)
        : (profile.companionPetName ? (' · 宠物：' + profile.companionPetName) : ' · 暂未携带宠物');
      setIdentityBanner('ok', '✅ 已识别：' + (profile.name || profile.id) + '（' + (profile.role || 'AI 伙伴') + '）' + petHint);
      $('direct-link-row').style.display = recognizedCode ? 'block' : 'none';

      if (recognizedCode && typeof history !== 'undefined' && typeof location !== 'undefined' && location.protocol.startsWith('http')) {
        const targetPath = '/customize/' + encodeURIComponent(recognizedCode);
        if (location.pathname !== targetPath) {
          history.replaceState(null, '', targetPath);
        }
      }
    }

    async function loadProfileByCode(rawCode, quietIfEmpty) {
      const token = extractToken(rawCode);
      if (!token) {
        if (!quietIfEmpty) {
          setIdentityBanner('err', '❌ 请输入有效的专属后台代码（格式如 ap_xxxxxxxxxxxx 或完整专属链接）');
        }
        return false;
      }
      recognizedCode = token;
      $('inp-token').value = token;
      const base = ($('inp-server').value.trim() || serverDefault).replace(/\\/+$/, '');
      setIdentityBanner('', '正在识别专属后台代码 ' + token + '…');
      try {
        const res = await fetch(base + '/api/customize/profile?code=' + encodeURIComponent(token));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.profile) {
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        applyProfile(data.profile);
        return true;
      } catch (err) {
        recognizedCode = '';
        recognizedUrl = '';
        $('direct-link-row').style.display = 'none';
        setIdentityBanner('err', '❌ 识别失败：' + (err && err.message ? err.message : String(err)));
        return false;
      }
    }

    $('look-m').addEventListener('click', () => { state.look = 'm'; void refreshPreview(); });
    $('look-f').addEventListener('click', () => { state.look = 'f'; void refreshPreview(); });
    $('reroll-btn').addEventListener('click', randomizeLook);
    $('inp-name').addEventListener('input', () => { $('code-out').textContent = currentCode(); });
    $('inp-role').addEventListener('input', () => { $('code-out').textContent = currentCode(); });
    $('inp-pet').addEventListener('input', () => {
      syncPetQuickChips();
      $('code-out').textContent = currentCode();
    });
    $('pet-quick-chips').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-pet]') : null;
      if (!btn) return;
      $('inp-pet').value = btn.getAttribute('data-pet') || '';
      syncPetQuickChips();
      $('code-out').textContent = currentCode();
    });
    $('load-token-btn').addEventListener('click', () => {
      void loadProfileByCode($('inp-token').value, false);
    });
    $('inp-token').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void loadProfileByCode($('inp-token').value, false);
      }
    });
    $('copy-direct-link-btn').addEventListener('click', async () => {
      const url = recognizedUrl || (serverDefault + '/customize/' + recognizedCode);
      const msg = $('status-msg');
      try {
        await navigator.clipboard.writeText(url);
        msg.style.color = 'var(--ok)';
        msg.textContent = '✅ 已复制专属捏脸直达链接：' + url;
      } catch {
        msg.style.color = '#fde047';
        msg.textContent = '你的专属捏脸链接：' + url;
      }
    });
    $('inp-server').addEventListener('change', () => {
      $('open-office-link').href = ($('inp-server').value.trim() || serverDefault).replace(/\\/+$/, '') + '/';
      void refreshPreview();
    });

    $('copy-code-btn').addEventListener('click', async () => {
      const code = currentCode();
      const msg = $('status-msg');
      try {
        await navigator.clipboard.writeText(code);
        msg.style.color = 'var(--ok)';
        msg.textContent = '✅ 已复制离线捏脸代码！直接粘贴发给你的 AI 助手对话框即可生效。';
      } catch {
        msg.style.color = '#fde047';
        msg.textContent = '请全选下方代码框内容复制并发送给你的 AI 助手。';
      }
    });

    $('send-btn').addEventListener('click', async () => {
      const msg = $('status-msg');
      const name = $('inp-name').value.trim();
      if (!name) {
        msg.style.color = '#ff8e99';
        msg.textContent = '❌ 请先填写你的昵称！';
        $('inp-name').focus();
        return;
      }
      const base = ($('inp-server').value.trim() || serverDefault).replace(/\\/+$/, '');
      const role = $('inp-role').value.trim() || 'AI 伙伴';
      const pet = $('inp-pet').value.trim();
      const token = recognizedCode || extractToken($('inp-token').value);
      msg.style.color = 'var(--muted)';
      msg.textContent = '正在保存你的形象与配置到虚拟办公室后台…';
      try {
        if (token) {
          const res = await fetch(base + '/api/customize/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              code: token,
              name,
              role,
              look: state.look,
              seed: state.seed >>> 0,
              parts: state.parts,
              companionPokemon: pet,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok || !data.profile) throw new Error(data.error || ('HTTP ' + res.status));
          applyProfile(data.profile);
          msg.style.color = 'var(--ok)';
          msg.textContent = '✅ 已保存成功！办公室大屏已实时更新你的形象、职位与伴随宝可梦。';
        } else {
          const code = currentCode();
          const res = await fetch(base + '/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              id: name,
              name,
              role,
              status: 'idle',
              appearanceCode: code,
              ...(pet ? { companionPokemon: pet } : {}),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
          if (data.customizeCode) {
            recognizedCode = data.customizeCode;
            recognizedUrl = data.customizeUrl || (base + '/customize/' + data.customizeCode);
            $('inp-token').value = recognizedCode;
            setIdentityBanner('ok', '✅ 已同步并绑定专属代码：' + recognizedCode + '（下次可用此代码或专属链接直接回来修改）');
            $('direct-link-row').style.display = 'block';
            if (typeof history !== 'undefined' && typeof location !== 'undefined' && location.protocol.startsWith('http')) {
              history.replaceState(null, '', '/customize/' + encodeURIComponent(recognizedCode));
            }
          }
          msg.style.color = 'var(--ok)';
          msg.textContent = '✅ 已同步到办公室后台！' + (data.customizeCode ? (' 你的专属后台代码：' + data.customizeCode) : '');
        }
      } catch (err) {
        msg.style.color = '#ff8e99';
        msg.textContent = '⚠️ 保存失败（' + err.message + '）';
      }
    });

    $('import-btn').addEventListener('click', () => {
      const raw = $('code-import').value.trim();
      const msg = $('status-msg');
      const m = /AP1:([A-Za-z0-9_-]+)/.exec(raw);
      if (!m) {
        msg.style.color = '#ff8e99';
        msg.textContent = '❌ 无效的 AP1:... 捏脸代码。';
        return;
      }
      try {
        const obj = JSON.parse(b64UrlToUtf8(m[1]));
        if (obj.name) $('inp-name').value = obj.name;
        if (obj.role) $('inp-role').value = obj.role;
        if (obj.companionPokemon) $('inp-pet').value = obj.companionPokemon;
        if (obj.look === 'f' || obj.look === 'm') state.look = obj.look;
        if (typeof obj.seed === 'number') state.seed = obj.seed >>> 0;
        if (obj.parts && typeof obj.parts === 'object') Object.assign(state.parts, obj.parts);
        syncPetQuickChips();
        renderControls();
        void refreshPreview();
        msg.style.color = 'var(--ok)';
        msg.textContent = '✅ 已载入离线捏脸代码，可继续微调或保存！';
      } catch {
        msg.style.color = '#ff8e99';
        msg.textContent = '❌ 解析捏脸代码失败。';
      }
    });

    syncPetQuickChips();
    renderControls();
    void refreshPreview();

    (function autoLoadInitialToken() {
      let candidate = extractToken(INITIAL_CODE);
      if (!candidate && typeof location !== 'undefined') {
        const pathMatch = /^\\/customize\\/([^/]+)$/.exec(location.pathname);
        if (pathMatch) candidate = extractToken(decodeURIComponent(pathMatch[1]));
        if (!candidate && location.search) {
          const sp = new URLSearchParams(location.search);
          candidate = extractToken(sp.get('code') || sp.get('token') || '');
        }
      }
      if (candidate) {
        void loadProfileByCode(candidate, true);
      }
    })();
  </script>
</body>
</html>`;
}
