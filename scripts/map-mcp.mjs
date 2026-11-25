#!/usr/bin/env node
// Agent Party 地图工坊 MCP Stdio <-> HTTP Bridge（零外部依赖，带在线心跳）
// 用法: node scripts/map-mcp.mjs --url http://127.0.0.1:4747 --token ws_xxx
// 或直接: node scripts/map-mcp.mjs --url http://127.0.0.1:4747/api/mcp/ws_xxx
import readline from 'node:readline';

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
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
