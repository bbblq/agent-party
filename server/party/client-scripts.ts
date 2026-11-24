export function renderReportScript(defaultBaseUrl: string): string {
  return `#!/usr/bin/env node
// Agent Party 轻量状态同步脚本（跨平台、零依赖、仅上报 working/idle/waiting/session-end/offline 状态，绝不读取或发送具体工作内容）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.agent-party');
const CONFIG_PATH = join(DIR, 'config.json');
const THROTTLE_PATH = join(DIR, '.throttle.json');
const FALLBACK_URL = ${JSON.stringify(defaultBaseUrl)};

function loadJson(file) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  return null;
}

async function readStdinQuick() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let out = '';
    const timer = setTimeout(() => resolve(out), 80);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      out += chunk;
      if (out.length > 32768) {
        clearTimeout(timer);
        resolve(out);
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(out);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let status = 'working';
  let heartbeat = false;
  let verify = false;
  let cliTool = '';
  let cliSession = '';
  let cliCompanionPet = '';
  let cliCompanionName = '';
  let cliAppearance = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--heartbeat' || a === '-b') heartbeat = true;
    else if (a === '--verify' || a === '-v') verify = true;
    else if (a === '--tool' && args[i + 1]) cliTool = args[++i];
    else if (a === '--session' && args[i + 1]) cliSession = args[++i];
    else if (a === '--companion-pet' && args[i + 1]) cliCompanionPet = args[++i];
    else if (a === '--companion-name' && args[i + 1]) cliCompanionName = args[++i];
    else if ((a === '--appearance' || a === '--code') && args[i + 1]) cliAppearance = args[++i];
    else if (!a.startsWith('-')) status = a;
  }

  let cfg = loadJson(CONFIG_PATH) || {};
  if (cliAppearance) {
    const m = /\\bAP1:([A-Za-z0-9_-]+)/.exec(cliAppearance.trim());
    if (m) {
      try {
        let b64 = m[1].replaceAll('-', '+').replaceAll('_', '/');
        while (b64.length % 4) b64 += '=';
        const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        if (parsed && typeof parsed === 'object') {
          if (parsed.name) cfg.name = String(parsed.name).slice(0, 32);
          if (!cfg.id && cfg.name) cfg.id = cfg.name;
          if (parsed.role) cfg.role = String(parsed.role).slice(0, 32);
          if (parsed.look === 'f' || parsed.look === 'm') cfg.look = parsed.look;
          if (typeof parsed.seed === 'number') cfg.seed = parsed.seed >>> 0;
          if (parsed.parts && typeof parsed.parts === 'object') cfg.parts = parsed.parts;
          if (parsed.companionPokemon) cfg.companionPokemon = String(parsed.companionPokemon).slice(0, 40);
          if (parsed.companionPetId) cfg.companionPetId = String(parsed.companionPetId).slice(0, 48);
          if (parsed.companionPetName) cfg.companionPetName = String(parsed.companionPetName).slice(0, 24);
          cfg.appearanceCode = 'AP1:' + m[1];
          mkdirSync(DIR, { recursive: true });
          writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
        }
      } catch (err) {
        if (verify) {
          console.error('❌ 无法解析 AP1:... 捏脸代码:', err && err.message ? err.message : String(err));
          process.exit(1);
        }
      }
    }
  }
  const serverUrl = String(cfg.serverUrl || FALLBACK_URL).replace(/\\/+$/, '');
  const id = String(cfg.id || cfg.name || '').trim();
  if (!id) {
    if (verify) {
      console.error('❌ 未找到配置：请先创建 ' + CONFIG_PATH + ' 并设置 id/name');
      process.exit(1);
    }
    process.exit(0);
  }

  let stdinObj = {};
  const rawIn = await readStdinQuick();
  if (rawIn.trim()) {
    try {
      stdinObj = JSON.parse(rawIn);
    } catch {}
  }

  const sessionId = String(
    cliSession ||
      stdinObj.session_id ||
      stdinObj.conversation_id ||
      stdinObj.thread_id ||
      process.env.CLAUDE_SESSION_ID ||
      process.env.CODEX_THREAD_ID ||
      'default',
  ).slice(0, 64);

  const agentTool = String(cliTool || cfg.agentTool || '').trim();
  const companionPetId = String(cliCompanionPet || cfg.companionPetId || '').trim();
  const companionPetName = String(cliCompanionName || cfg.companionPetName || '').trim();
  const companionPokemon = String(cfg.companionPokemon || '').trim();

  if (heartbeat && !verify && status === 'working') {
    const now = Date.now();
    const t = loadJson(THROTTLE_PATH) || {};
    const key = sessionId + ':' + status;
    if (typeof t[key] === 'number' && now - t[key] < 25000) {
      process.exit(0);
    }
    try {
      mkdirSync(DIR, { recursive: true });
      t[key] = now;
      writeFileSync(THROTTLE_PATH, JSON.stringify(t), 'utf8');
    } catch {}
  }

  const payload = {
    id,
    name: cfg.name || id,
    role: cfg.role || 'AI 伙伴',
    status,
    sessionId,
    ...(cfg.look === 'f' || cfg.look === 'm' ? { look: cfg.look } : {}),
    ...(typeof cfg.seed === 'number' ? { seed: cfg.seed >>> 0 } : {}),
    ...(cfg.parts && typeof cfg.parts === 'object' ? { parts: cfg.parts } : {}),
    ...(cfg.appearanceCode ? { appearanceCode: cfg.appearanceCode } : {}),
    ...(cfg.petId ? { petId: cfg.petId } : {}),
    ...(companionPetId ? { companionPetId } : {}),
    ...(companionPetName ? { companionPetName } : {}),
    ...(companionPokemon && !companionPetId ? { companionPokemon } : {}),
    ...(agentTool ? { agentTool } : {}),
  };

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), verify ? 6000 : 3000);
    const res = await fetch(serverUrl + '/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const bodyText = verify ? await res.text() : '';
    if (!res.ok) {
      if (verify) {
        console.error('❌ 服务端返回 HTTP ' + res.status + ': ' + bodyText);
        process.exit(1);
      }
      return;
    }
    if (verify) {
      let parsed = {};
      try { parsed = JSON.parse(bodyText); } catch {}
      const compMsg = parsed.companion && parsed.companion.name ? (' + 伴随宠物「' + parsed.companion.name + '」') : '';
      console.log('✅ Agent Party 接入成功 (HTTP 200): ' + (parsed.name || id) + compMsg + ' [' + (parsed.status || status) + '] -> ' + serverUrl);
    }
  } catch (err) {
    if (verify) {
      console.error('❌ 无法连接服务器 (' + serverUrl + '): ' + (err && err.message ? err.message : String(err)));
      process.exit(1);
    }
  }
}

main().catch((err) => {
  if (process.argv.includes('--verify') || process.argv.includes('-v')) {
    console.error('❌ 执行异常:', err);
    process.exit(1);
  }
  process.exit(0);
});
`;
}

export function renderWatchScript(defaultBaseUrl: string): string {
  return `#!/usr/bin/env node
// Agent Party 全客户端高精状态守护脚本（零依赖，仅检测会话文件修改时间戳 mtimeMs，绝不读取任何对话内容）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HOME = homedir();
const DIR = join(HOME, '.agent-party');
const CONFIG_PATH = join(DIR, 'config.json');
const PID_PATH = join(DIR, 'watch.pid');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const FALLBACK_URL = ${JSON.stringify(defaultBaseUrl)};
const ACTIVE_WINDOW_MS = 12000;
const RECENT_STARTUP_MS = 2 * 60 * 1000;
const POLL_MS = 5000;
const WORKING_HEARTBEAT_MS = 25000;
const IDLE_KEEPALIVE_MS = 30 * 60 * 1000;
const MAX_SCAN_ENTRIES = 300;

const IGNORE_NAMES = new Set([
  'node_modules',
  '.git',
  'cache',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'Crashpad',
  'Service Worker',
  'blob_storage',
  'Session Storage',
  'Local Storage',
  'IndexedDB',
  'logs',
  'Logs',
  'tmp',
  'temp',
  'backups',
]);

const DISCOVER_IGNORE = new Set([
  '.agent-party',
  '.git',
  '.npm',
  '.cache',
  '.cargo',
  '.rustup',
  '.gradle',
  '.m2',
  '.vscode',
  '.vscode-extensions',
  'Google',
  'Microsoft',
  'Mozilla',
  'WeChat',
  'Tencent',
  'Discord',
  'Slack',
  'Electron',
  'npm',
  'Temp',
  'Packages',
  'CrashDumps',
]);

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function acquirePidLock() {
  mkdirSync(DIR, { recursive: true });
  if (existsSync(PID_PATH)) {
    try {
      const prevPid = Number(readFileSync(PID_PATH, 'utf8').trim());
      if (isPidAlive(prevPid)) {
        console.log('[agent-party watch] already running (PID ' + prevPid + '), exiting.');
        process.exit(0);
      }
    } catch {}
  }
  writeFileSync(PID_PATH, String(process.pid), 'utf8');
  const cleanup = () => {
    try {
      if (existsSync(PID_PATH) && Number(readFileSync(PID_PATH, 'utf8').trim()) === process.pid) {
        rmSync(PID_PATH, { force: true });
      }
    } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return {};
}

function newestMtime(dir, maxDepth, maxEntries = MAX_SCAN_ENTRIES) {
  if (!dir || !existsSync(dir)) return 0;
  let best = 0;
  let visited = 0;
  const walk = (cur, depth) => {
    if (visited >= maxEntries) return;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (visited >= maxEntries) break;
      if (IGNORE_NAMES.has(ent.name)) continue;
      visited++;
      const p = join(cur, ent.name);
      if (ent.isDirectory()) {
        if (depth < maxDepth) walk(p, depth + 1);
      } else if (ent.isFile()) {
        try {
          const mt = statSync(p).mtimeMs;
          if (mt > best) best = mt;
        } catch {}
      }
    }
  };
  walk(dir, 0);
  return best;
}

function appDataDirs(appName) {
  const plat = platform();
  const out = [];
  if (plat === 'win32') {
    if (process.env.APPDATA) out.push(join(process.env.APPDATA, appName));
    if (process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, appName));
  } else if (plat === 'darwin') {
    out.push(join(HOME, 'Library', 'Application Support', appName));
  } else {
    out.push(join(HOME, '.config', appName), join(HOME, '.local', 'share', appName));
  }
  return out;
}

function pushAppTargets(list, prefix, tool, appNames, depth = 2) {
  const seen = new Set();
  for (const appName of appNames) {
    for (const dir of appDataDirs(appName)) {
      if (!seen.has(dir)) {
        seen.add(dir);
        list.push({ key: prefix + '-' + seen.size, tool, dir, depth });
      }
    }
  }
}

function resolveTargets(cfg) {
  const list = [
    { key: 'claude', tool: 'Claude Code', dir: join(HOME, '.claude', 'projects'), depth: 2 },
    { key: 'codex', tool: 'Codex', dir: join(HOME, '.codex', 'sessions'), depth: 4 },
    { key: 'antigravity', tool: 'Antigravity', dir: join(HOME, '.gemini', 'antigravity', 'brain'), depth: 3 },
    { key: 'cursor-proj', tool: 'Cursor', dir: join(HOME, '.cursor', 'projects'), depth: 2 },
    { key: 'windsurf', tool: 'Windsurf', dir: join(HOME, '.codeium', 'windsurf', 'cascade'), depth: 2 },
    { key: 'opencode', tool: 'OpenCode', dir: join(HOME, '.local', 'share', 'opencode', 'storage'), depth: 3 },
    { key: 'trae-dot', tool: 'Trae', dir: join(HOME, '.trae', 'projects'), depth: 2 },
    { key: 'workbuddy-dot', tool: 'WorkBuddy', dir: join(HOME, '.workbuddy'), depth: 3 },
    { key: 'doubao-dot', tool: '豆包工作', dir: join(HOME, '.doubao'), depth: 3 },
    { key: 'marscode-dot', tool: '豆包工作', dir: join(HOME, '.marscode'), depth: 3 },
    { key: 'marvis-dot', tool: '马维斯', dir: join(HOME, '.marvis'), depth: 3 },
    { key: 'deepseek-dot', tool: 'DeepSeek', dir: join(HOME, '.deepseek'), depth: 3 },
  ];
  pushAppTargets(list, 'cursor-ws', 'Cursor', [join('Cursor', 'User', 'workspaceStorage')], 2);
  pushAppTargets(list, 'trae-ws', 'Trae', [join('Trae', 'User', 'workspaceStorage')], 2);
  pushAppTargets(list, 'workbuddy-app', 'WorkBuddy', ['WorkBuddy'], 2);
  pushAppTargets(list, 'doubao-app', '豆包工作', ['Doubao', 'MarsCode'], 2);
  pushAppTargets(list, 'marvis-app', '马维斯', ['Marvis'], 2);

  if (Array.isArray(cfg.watchDirs)) {
    cfg.watchDirs.forEach((entry, idx) => {
      if (entry && typeof entry.dir === 'string' && entry.dir.trim()) {
        list.push({
          key: 'custom-' + idx,
          tool: typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : (cfg.agentTool || 'AI Agent'),
          dir: entry.dir.trim(),
          depth: typeof entry.depth === 'number' && entry.depth >= 0 ? Math.min(5, entry.depth) : 3,
        });
      }
    });
  }
  return list;
}

function runDiscover() {
  const now = Date.now();
  const recentWindowMs = 5 * 60 * 1000;
  const candidates = [];
  const roots = [HOME];
  const plat = platform();
  if (plat === 'win32') {
    if (process.env.APPDATA) roots.push(process.env.APPDATA);
    if (process.env.LOCALAPPDATA) roots.push(process.env.LOCALAPPDATA);
  } else if (plat === 'darwin') {
    roots.push(join(HOME, 'Library', 'Application Support'));
  } else {
    roots.push(join(HOME, '.config'), join(HOME, '.local', 'share'));
  }

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let topEntries = [];
    try {
      topEntries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of topEntries) {
      if (!ent.isDirectory()) continue;
      if (root === HOME && !ent.name.startsWith('.')) continue;
      if (DISCOVER_IGNORE.has(ent.name) || IGNORE_NAMES.has(ent.name)) continue;
      const full = join(root, ent.name);
      const mt = newestMtime(full, 2, 120);
      if (mt && now - mt <= recentWindowMs) {
        candidates.push({ dir: full, ageSec: Math.max(0, Math.round((now - mt) / 1000)) });
      }
    }
  }
  candidates.sort((a, b) => a.ageSec - b.ageSec);
  console.log(JSON.stringify({ candidates: candidates.slice(0, 20) }, null, 2));
}

function startupPaths() {
  const plat = platform();
  if (plat === 'win32') {
    const appData = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
    return {
      kind: 'win32',
      file: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'agent-party-watch.vbs'),
    };
  }
  if (plat === 'darwin') {
    return {
      kind: 'darwin',
      file: join(HOME, 'Library', 'LaunchAgents', 'com.agent-party.watch.plist'),
    };
  }
  return {
    kind: 'linux',
    file: join(HOME, '.config', 'autostart', 'agent-party-watch.desktop'),
  };
}

function runInstallStartup() {
  const target = startupPaths();
  mkdirSync(join(target.file, '..'), { recursive: true });
  const nodeExe = process.execPath;
  if (target.kind === 'win32') {
    const vbs = 'Set WshShell = CreateObject("WScript.Shell")\\r\\nWshShell.Run """' + nodeExe + '"" ""' + SCRIPT_PATH + '""", 0, False\\r\\n';
    writeFileSync(target.file, vbs, 'utf8');
  } else if (target.kind === 'darwin') {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\\n' +
      '<plist version="1.0"><dict>\\n' +
      '  <key>Label</key><string>com.agent-party.watch</string>\\n' +
      '  <key>ProgramArguments</key><array><string>' + nodeExe + '</string><string>' + SCRIPT_PATH + '</string></array>\\n' +
      '  <key>RunAtLoad</key><true/>\\n' +
      '  <key>KeepAlive</key><true/>\\n' +
      '</dict></plist>\\n';
    writeFileSync(target.file, xml, 'utf8');
    try { execFileSync('launchctl', ['unload', target.file], { stdio: 'ignore' }); } catch {}
    try { execFileSync('launchctl', ['load', target.file], { stdio: 'ignore' }); } catch {}
  } else {
    const desktop =
      '[Desktop Entry]\\nType=Application\\nName=Agent Party Watch\\nExec="' + nodeExe + '" "' + SCRIPT_PATH + '"\\nX-GNOME-Autostart-enabled=true\\n';
    writeFileSync(target.file, desktop, 'utf8');
  }
  console.log('✅ 已配置开机静默自启: ' + target.file);
}

function runUninstallStartup() {
  const target = startupPaths();
  if (target.kind === 'darwin') {
    try { execFileSync('launchctl', ['unload', target.file], { stdio: 'ignore' }); } catch {}
  }
  rmSync(target.file, { force: true });
  console.log('✅ 已移除开机自启配置: ' + target.file);
}

function runStatus() {
  const cfg = loadConfig();
  let runningPid = null;
  if (existsSync(PID_PATH)) {
    const pid = Number(readFileSync(PID_PATH, 'utf8').trim());
    if (isPidAlive(pid)) runningPid = pid;
  }
  const existingDirs = resolveTargets(cfg).filter((t) => existsSync(t.dir)).map((t) => ({ tool: t.tool, dir: t.dir }));
  const target = startupPaths();
  console.log(JSON.stringify({
    running: !!runningPid,
    pid: runningPid,
    startupInstalled: existsSync(target.file),
    startupFile: target.file,
    configId: cfg.id || cfg.name || null,
    watchedDirs: existingDirs,
  }, null, 2));
}

const lastSent = new Map();
let lastKeepaliveAt = 0;

async function send(cfg, sessionId, agentTool, status) {
  const serverUrl = String(cfg.serverUrl || FALLBACK_URL).replace(/\\/+$/, '');
  const id = String(cfg.id || cfg.name || '').trim();
  if (!id) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(serverUrl + '/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        id,
        name: cfg.name || id,
        role: cfg.role || 'AI 伙伴',
        status,
        sessionId,
        agentTool,
        ...(cfg.petId ? { petId: cfg.petId } : {}),
        ...(cfg.companionPetId ? { companionPetId: cfg.companionPetId } : {}),
        ...(cfg.companionPetName ? { companionPetName: cfg.companionPetName } : {}),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function tick() {
  const cfg = loadConfig();
  if (!cfg.id && !cfg.name) return;
  const now = Date.now();
  const targets = resolveTargets(cfg);
  let anyWorking = false;

  for (const t of targets) {
    if (!existsSync(t.dir)) continue;
    const latest = newestMtime(t.dir, t.depth);
    if (!latest) continue;
    const active = now - latest <= ACTIVE_WINDOW_MS;
    if (active) anyWorking = true;
    const nextStatus = active ? 'working' : 'idle';
    const prev = lastSent.get(t.key);
    if (!prev && !active && now - latest > RECENT_STARTUP_MS) {
      continue;
    }
    const shouldSend = !prev || prev.status !== nextStatus || (active && now - prev.at >= WORKING_HEARTBEAT_MS);
    if (shouldSend) {
      lastSent.set(t.key, { status: nextStatus, at: now });
      await send(cfg, 'watch:' + t.key, t.tool, nextStatus);
      lastKeepaliveAt = now;
    }
  }

  if (!anyWorking && now - lastKeepaliveAt >= IDLE_KEEPALIVE_MS) {
    lastKeepaliveAt = now;
    await send(cfg, 'watch:keepalive', String(cfg.agentTool || 'AI Agent'), 'idle');
  }
}

const cmdArgs = process.argv.slice(2);
if (cmdArgs.includes('--discover')) {
  runDiscover();
} else if (cmdArgs.includes('--install-startup')) {
  runInstallStartup();
} else if (cmdArgs.includes('--uninstall-startup')) {
  runUninstallStartup();
} else if (cmdArgs.includes('--status')) {
  runStatus();
} else {
  acquirePidLock();
  console.log('[agent-party watch] running (mtime-only privacy mode, pid=' + process.pid + ')...');
  void tick();
  setInterval(() => void tick(), POLL_MS);
}
`;
}
