#!/usr/bin/env node
// Agent Party 地图工坊 MCP Bridge & 零重启直连客户端（零外部依赖）
// 1) MCP Stdio Bridge: node map-mcp.mjs --url http://host:4747/api/mcp/ws_xxx
// 2) 零重启自动接单监听: node map-mcp.mjs --wait --url http://host:4747/api/mcp/ws_xxx
// 3) 零重启执行地图工具: node map-mcp.mjs --call map_build_room '{"x":10,"y":10,"w":14,"h":12}' --url http://host:4747/api/mcp/ws_xxx
import readline from 'node:readline';

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const rawUrl = (readArg('--url') || process.env.AGENT_PARTY_URL || 'http://127.0.0.1:4747').replace(/\/+$/, '');
const pathMatch = /^(https?:\/\/[^/]+)\/api\/mcp\/(ws_[A-Za-z0-9_-]+)$/.exec(rawUrl);
const baseOrigin = pathMatch ? pathMatch[1] : rawUrl.replace(/\/api\/mcp$/, '');
const token = (readArg('--token') || process.env.AGENT_PARTY_TOKEN || (pathMatch ? pathMatch[2] : '')).trim();
const mcpEndpoint = token && token.startsWith('ws_') ? `${baseOrigin}/api/mcp/${token}` : `${baseOrigin}/api/mcp`;

async function sendHeartbeat() {
  if (!token || !token.startsWith('ws_')) return;
  try {
    await fetch(`${baseOrigin}/api/map/studio/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ clientName: 'map-mcp-stdio', transport: 'stdio' }),
    });
  } catch {
    // ignore transient offline
  }
}

async function rpcCall(id, method, params) {
  const res = await fetch(mcpEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MCP-Transport': 'stdio',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

if (hasFlag('--wait')) {
  const maxWaitSec = Math.max(10, Math.min(3600, Number(readArg('--max-wait') || 600) || 600));
  const deadline = Date.now() + maxWaitSec * 1000;
  let seq = 1;
  void sendHeartbeat();
  const hbTimer = setInterval(() => void sendHeartbeat(), 15000);
  hbTimer.unref?.();

  try {
    await rpcCall(seq++, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'AI-Agent-Listener', version: '1.1.0' },
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  while (Date.now() < deadline) {
    try {
      const resp = await rpcCall(seq++, 'tools/call', {
        name: 'map_wait_next_task',
        arguments: { timeoutSec: 25 },
      });
      const text = resp?.result?.content?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed?.hasTask) {
          process.stdout.write(`${text}\n`);
          clearInterval(hbTimer);
          process.exit(0);
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  clearInterval(hbTimer);
  process.stdout.write(JSON.stringify({ hasTask: false, status: 'wait_deadline_reached' }) + '\n');
  process.exit(0);
}

const callTool = readArg('--call');
if (callTool) {
  const rawArgs = (() => {
    const idx = process.argv.indexOf('--call');
    const cand = idx >= 0 && idx + 2 < process.argv.length ? process.argv[idx + 2] : '{}';
    return cand.startsWith('--') ? '{}' : cand;
  })();
  let parsedArgs = {};
  try {
    parsedArgs = JSON.parse(rawArgs);
  } catch (err) {
    console.error(`Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  try {
    await rpcCall(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'AI-Agent-CLI', version: '1.1.0' },
    });
    const resp = await rpcCall(2, 'tools/call', { name: callTool, arguments: parsedArgs });
    const text = resp?.result?.content?.[0]?.text ?? JSON.stringify(resp);
    process.stdout.write(`${text}\n`);
    process.exit(resp?.result?.isError ? 1 : 0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void sendHeartbeat();
const hbTimer = setInterval(() => void sendHeartbeat(), 15000);
hbTimer.unref?.();

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsedId = null;
  try {
    parsedId = JSON.parse(trimmed).id ?? null;
  } catch {
    return;
  }
  try {
    const res = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Transport': 'stdio',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: trimmed,
    });
    if (res.status === 204) return;
    const text = await res.text();
    if (text.trim()) process.stdout.write(`${text.trim()}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: parsedId, error: { code: -32000, message: msg } }) + '\n');
  }
});
