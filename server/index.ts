// Agent Party — 多人实时 AI 虚拟办公室服务端（零外部运行时依赖）
//   npm run dev   -> tsx watch server/index.ts --dev (Vite middleware HMR)
//   npm start     -> node dist/server/index.js (静态托管 dist/client)
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { appearanceFromSeed } from '../client/src/art/character/appearance';
import { renderCharacter } from '../client/src/art/character/render';
import { decodeAppearanceCode, parseAppearanceParts, parseSeed } from '../shared/appearance';
import { createStaticHandler } from './http/static';
import { renderAdminHtml } from './party/admin-page';
import { renderReportScript, renderWatchScript } from './party/client-scripts';
import { renderCustomizeHtml } from './party/customize-page';
import { OfficeFeedTracker } from './party/feed';
import { MapManager } from './party/map-manager';
import { handleMcpRpc, renderMapMcpScript, renderMapStudioSetupMarkdown, resolveMcpAuth } from './party/mcp-server';
import { parseBoundary, parseMultipart } from './party/multipart';
import { MAX_PET_SPRITE_BYTES, PetRegistry } from './party/pets';
import { PokemonService, searchPokemon } from './party/pokemon';
import { renderSetupHtml, renderSetupMarkdown } from './party/setup-page';
import { PartyStore, type ReportInput } from './party/store';
import { WorldSync } from './party/world-sync';
import { validateMapPlayability } from '../shared/map';

const isDev = process.argv.includes('--dev');
const port = Number(process.env.PORT || process.env.HABBLAUD_PORT || 4747);
const host = process.env.HOST || process.env.HABBLAUD_HOST || '0.0.0.0';

function resolveRootDir(): string {
  const oneUp = join(import.meta.dirname, '..');
  const twoUp = join(import.meta.dirname, '..', '..');
  if (existsSync(join(oneUp, 'package.json'))) return oneUp;
  if (existsSync(join(twoUp, 'package.json'))) return twoUp;
  return process.cwd();
}

const rootDir = resolveRootDir();
const dataDir = process.env.AGENT_PARTY_DATA_DIR || join(rootDir, 'data');
mkdirSync(dataDir, { recursive: true });

function loadOrCreateAdminKey(): string {
  const fromEnv = (process.env.AGENT_PARTY_ADMIN_KEY || process.env.ADMIN_PASSWORD || '').trim();
  if (fromEnv) return fromEnv;
  const keyFile = join(dataDir, 'admin.key');
  if (existsSync(keyFile)) {
    const saved = readFileSync(keyFile, 'utf8').trim();
    if (saved) return saved;
  }
  const generated = randomBytes(12).toString('hex');
  writeFileSync(keyFile, `${generated}\n`, 'utf8');
  return generated;
}

const adminKey = loadOrCreateAdminKey();
const pokemon = new PokemonService(dataDir);
const pets = new PetRegistry(dataDir, undefined, pokemon, join(rootDir, 'assets', 'default-pets'));
const mapManager = new MapManager(dataDir);
const store = new PartyStore({ dataDir, pets, mapManager });
pokemon.onUpgrade(() => {
  pets.refresh();
  store.notifyMapChange();
});
const worldSync = new WorldSync(store.toSnapshot(), {
  initialLeaderboard: store.getArenaLeaderboard(),
  initialPrevChampion: store.getPrevArenaChampion(),
  initialCustomMap: mapManager.getActiveDoc(),
  onArenaResult: (wId, wName, lId, lName, now) => {
    const board = store.recordArenaResult(wId, wName, lId, lName, now);
    worldSync.sim.arena.setLeaderboard(board, now);
    worldSync.sim.arena.setPrevChampion(store.getPrevArenaChampion(now));
  },
  onArenaLeaderboardReset: (now) => {
    store.ensureArenaLeaderboardFresh(now);
    worldSync.sim.arena.setPrevChampion(store.getPrevArenaChampion(now));
  },
});
worldSync.start(250);
const feedTracker = new OfficeFeedTracker(store.toSnapshot(), worldSync.getArenaEvent());

mapManager.onActiveChange(() => {
  worldSync.setCustomMap(mapManager.getActiveDoc());
  store.notifyMapChange();
});

const sseClients = new Set<http.ServerResponse>();

function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastSse(event: string, data: unknown, droppable = false): void {
  if (!sseClients.size) return;
  const chunk = Buffer.from(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, 'utf8');
  for (const res of sseClients) {
    if (res.writableEnded || res.destroyed) {
      sseClients.delete(res);
      continue;
    }
    if (droppable && (res.writableNeedDrain || res.writableLength > 65_536)) {
      continue;
    }
    res.write(chunk);
  }
}

function broadcastSnapshot(): void {
  const snap = store.toSnapshot();
  worldSync.applySnapshot(snap);
  broadcastSse('snapshot', snap, false);
  const feedItems = feedTracker.diffSnapshot(snap);
  if (feedItems.length) broadcastSse('feed', feedItems, true);
}

store.onChange(() => {
  broadcastSnapshot();
});

worldSync.onArena((ev) => {
  broadcastSse('arena', ev, true);
  const feedItems = feedTracker.diffArena(ev);
  if (feedItems.length) broadcastSse('feed', feedItems, true);
});

const sweepTimer = setInterval(() => {
  store.sweep();
}, 30_000);

const keepaliveTimer = setInterval(() => {
  for (const res of sseClients) {
    if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n');
  }
}, 25_000);

function corsHeaders(extra: Record<string, string | number> = {}): Record<string, string | number> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key',
    ...extra,
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, corsHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  }));
  res.end(buf);
}

function sendText(res: http.ServerResponse, status: number, text: string, contentType: string): void {
  const buf = Buffer.from(text, 'utf8');
  res.writeHead(status, corsHeaders({
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  }));
  res.end(buf);
}

async function readBody(req: http.IncomingMessage, maxBytes = MAX_PET_SPRITE_BYTES + 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > maxBytes) throw new Error('Payload too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function readJson<T = Record<string, unknown>>(req: http.IncomingMessage, maxBytes = 512 * 1024): Promise<T> {
  const buf = await readBody(req, maxBytes);
  if (!buf.length) return {} as T;
  return JSON.parse(buf.toString('utf8')) as T;
}

function checkAdminAuth(req: http.IncomingMessage): boolean {
  const headerKey = typeof req.headers['x-admin-key'] === 'string' ? req.headers['x-admin-key'].trim() : '';
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const candidate = headerKey || bearer;
  if (!candidate) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(adminKey, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function getBaseUrl(req: http.IncomingMessage): string {
  const configured = store.getPublicUrl();
  if (configured) return configured;
  const envUrl = process.env.PUBLIC_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const protoHeader = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'].split(',')[0].trim() : '';
  const proto = protoHeader || 'http';
  const reqHost = (typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'].split(',')[0].trim() : '') || req.headers.host || `127.0.0.1:${port}`;
  return `${proto}://${reqHost}`;
}

function detectLanUrl(listenPort: number): string | null {
  try {
    const nets = networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      if (!ifaces) continue;
      for (const net of ifaces) {
        if (net.family === 'IPv4' && !net.internal && net.address) {
          return `http://${net.address}:${listenPort}`;
        }
      }
    }
  } catch {
    // ignore interface lookup error
  }
  return null;
}

function parseUrl(req: http.IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS' && p.startsWith('/api/')) {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }

  // ---- Health / Snapshot / World / Access
  if (method === 'GET' && p === '/api/health') {
    sendJson(res, 200, { ok: true, online: store.onlineCount(), pets: pets.listPets().length });
    return true;
  }

  if (method === 'GET' && p === '/api/snapshot') {
    sendJson(res, 200, store.toSnapshot());
    return true;
  }

  if (method === 'GET' && p === '/api/world') {
    sendJson(res, 200, worldSync.getFrame());
    return true;
  }

  if (method === 'GET' && p === '/api/arena') {
    sendJson(res, 200, worldSync.getArenaEvent());
    return true;
  }

  if (method === 'GET' && p === '/api/access') {
    sendJson(res, 200, {
      remote: false,
      local: true,
      permissions: false,
      messages: false,
      terminal: false,
      spawn: false,
      world: false,
    });
    return true;
  }

  // ---- SSE Stream (Snapshot + Event-Driven Arena Sync)
  if (method === 'GET' && p === '/api/stream') {
    res.writeHead(200, corsHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    }));
    res.flushHeaders?.();
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    writeSse(res, 'snapshot', store.toSnapshot());
    writeSse(res, 'arena', worldSync.getArenaEvent());
    return true;
  }

  // ---- Agent Status Report (Privacy-First: status only)
  if (method === 'POST' && p === '/api/report') {
    const body = await readJson<ReportInput & { pokemon?: string; companionPokemon?: string }>(req);
    const decodedApp = body.appearanceCode ? decodeAppearanceCode(body.appearanceCode) : null;
    if (decodedApp?.companionPokemon && !body.companionPokemon && !body.companionPetId) {
      body.companionPokemon = decodedApp.companionPokemon;
    }
    if (typeof body.pokemon === 'string' && body.pokemon.trim() && !body.petId) {
      const pRes = await pokemon.ensurePokemonPet(body.pokemon);
      if (pRes.ok) body.petId = pRes.pet.id;
    }
    if (typeof body.companionPokemon === 'string' && body.companionPokemon.trim() && !body.companionPetId) {
      const cRes = await pokemon.ensurePokemonPet(body.companionPokemon);
      if (cRes.ok) {
        body.companionPetId = cRes.pet.id;
        if (!body.companionPetName) {
          body.companionPetName = cRes.pokemon.zh_hans || cRes.pokemon.en;
        }
      }
    }
    const result = store.report(body);
    if (!result.ok) {
      sendJson(res, result.statusCode, { ok: false, error: result.error, ...(result.banned ? { banned: true } : {}) });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      id: result.member.id,
      name: result.member.name,
      status: result.member.lastStatus,
      ...(result.member.editToken
        ? {
            customizeCode: result.member.editToken,
            customizeUrl: `${getBaseUrl(req)}/customize/${result.member.editToken}`,
          }
        : {}),
      ...(result.companion
        ? {
            companion: {
              id: result.companion.id,
              name: result.companion.name,
              petId: result.companion.petId,
            },
          }
        : {}),
    });
    return true;
  }

  // ---- Built-in Pokémon Picker (SpriteCollab PMD 4-direction sprites)
  if (method === 'GET' && p === '/api/pokemon/search') {
    const q = url.searchParams.get('q') ?? '';
    sendJson(res, 200, { results: searchPokemon(q, 24) });
    return true;
  }

  if (method === 'POST' && p === '/api/pokemon/select') {
    const body = await readJson<{ query?: string }>(req);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      sendJson(res, 400, { ok: false, error: 'Missing query' });
      return true;
    }
    const r = await pokemon.ensurePokemonPet(query);
    if (!r.ok) {
      sendJson(res, r.code === 'FETCH_ERROR' ? 502 : 404, { ok: false, code: r.code, error: r.error });
      return true;
    }
    sendJson(res, 200, { ok: true, pet: r.pet, pokemon: r.pokemon });
    return true;
  }

  const pokePngMatch = /^\/api\/pokemon\/(\d{4})\/([A-Za-z]+-Anim\.png)$/.exec(p);
  if (method === 'GET' && pokePngMatch) {
    const filePath = pokemon.getPngFile(pokePngMatch[1], pokePngMatch[2]);
    if (!filePath) {
      sendJson(res, 404, { error: 'Pokemon sprite not found' });
      return true;
    }
    res.writeHead(200, corsHeaders({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800, immutable',
    }));
    createReadStream(filePath).pipe(res);
    return true;
  }

  // ---- Codex V2 Pets Catalog / Sprite / Upload
  if (method === 'GET' && p === '/api/pets') {
    pets.refresh();
    sendJson(res, 200, { pets: pets.listPets() });
    return true;
  }

  const petSpriteMatch = /^\/api\/pets\/([^/]+)\/sprite$/.exec(p);
  if (method === 'GET' && petSpriteMatch) {
    const id = decodeURIComponent(petSpriteMatch[1]);
    const file = pets.getPetSpriteFile(id);
    if (!file) {
      sendJson(res, 404, { error: 'Pet not found' });
      return true;
    }
    res.writeHead(200, corsHeaders({
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=604800, immutable',
    }));
    createReadStream(file.filePath).pipe(res);
    return true;
  }

  if (method === 'POST' && p === '/api/pets/upload') {
    const ct = req.headers['content-type'] ?? '';
    const boundary = parseBoundary(ct);
    if (boundary) {
      const raw = await readBody(req);
      const parsed = parseMultipart(raw, boundary);
      const sprite = parsed.files.sprite || parsed.files.file;
      if (!sprite) {
        sendJson(res, 400, { error: 'Missing multipart field "sprite"' });
        return true;
      }
      const petId = parsed.fields.petId || parsed.fields.id || sprite.filename.replace(/\.[^.]+$/, '');
      const petJson = parsed.files.petJson?.data ?? parsed.fields.petJson;
      const item = pets.saveUploadedPet({
        petId,
        displayName: parsed.fields.displayName || parsed.fields.name,
        petJsonRaw: petJson,
        spriteBuffer: sprite.data,
      });
      sendJson(res, 200, { ok: true, pet: item });
      return true;
    }

    const body = await readJson<{
      petId?: string;
      id?: string;
      displayName?: string;
      name?: string;
      petJson?: unknown;
      spriteBase64?: string;
    }>(req);
    if (!body.spriteBase64 || typeof body.spriteBase64 !== 'string') {
      sendJson(res, 400, { error: 'Expected multipart/form-data or JSON with spriteBase64' });
      return true;
    }
    const cleanB64 = body.spriteBase64.replace(/^data:[^;]+;base64,/, '');
    const spriteBuffer = Buffer.from(cleanB64, 'base64');
    const item = pets.saveUploadedPet({
      petId: body.petId || body.id || '',
      displayName: body.displayName || body.name,
      petJsonRaw: typeof body.petJson === 'string' ? body.petJson : body.petJson ? JSON.stringify(body.petJson) : undefined,
      spriteBuffer,
    });
    sendJson(res, 200, { ok: true, pet: item });
    return true;
  }

  // ---- Character / Pet Editor (Admin Auth Required)
  const charMatch = /^\/api\/agents\/([^/]+)\/character$/.exec(p);
  if (charMatch && (method === 'PUT' || method === 'DELETE')) {
    if (!checkAdminAuth(req)) {
      sendJson(res, 401, { error: '需要管理员登录权限才能修改角色或宠物信息。' });
      return true;
    }
    const id = decodeURIComponent(charMatch[1]);
    if (method === 'DELETE') {
      const r = store.resetCharacter(id);
      if (!r.ok) sendJson(res, r.statusCode, { error: r.error });
      else sendJson(res, 200, { ok: true });
      return true;
    }
    const body = await readJson<Record<string, unknown>>(req);
    const r = store.updateCharacter(id, body as Parameters<PartyStore['updateCharacter']>[1]);
    if (!r.ok) sendJson(res, r.statusCode, { error: r.error });
    else sendJson(res, 200, { ok: true });
    return true;
  }

  // ---- Setup, Self-Service Customizer & Client Scripts
  if (method === 'GET' && p === '/customize.html') {
    const initialCode = url.searchParams.get('code') ?? url.searchParams.get('token') ?? '';
    sendText(res, 200, renderCustomizeHtml(getBaseUrl(req), initialCode), 'text/html; charset=utf-8');
    return true;
  }
  const customizePageMatch = /^\/customize(?:\/([^/]+))?$/.exec(p);
  if (method === 'GET' && customizePageMatch) {
    const initialCode =
      (customizePageMatch[1] ? decodeURIComponent(customizePageMatch[1]) : '') ||
      url.searchParams.get('code') ||
      url.searchParams.get('token') ||
      '';
    sendText(res, 200, renderCustomizeHtml(getBaseUrl(req), initialCode), 'text/html; charset=utf-8');
    return true;
  }
  const profileMatch = /^\/api\/customize\/profile(?:\/([^/]+))?$/.exec(p);
  if (method === 'GET' && profileMatch) {
    const code =
      (profileMatch[1] ? decodeURIComponent(profileMatch[1]) : '') ||
      url.searchParams.get('code') ||
      url.searchParams.get('token') ||
      '';
    const r = store.getMemberByEditToken(code);
    if (!r.ok) {
      sendJson(res, r.statusCode, { ok: false, error: r.error });
      return true;
    }
    const base = getBaseUrl(req);
    sendJson(res, 200, {
      ok: true,
      profile: {
        id: r.member.id,
        name: r.member.name,
        role: r.member.role,
        ...(r.member.isNpc ? { isNpc: true } : {}),
        agentTool: r.member.agentTool,
        status: r.member.lastStatus,
        look: r.member.look,
        seed: r.member.seed,
        parts: r.resolvedParts,
        canDuel: r.canDuel,
        ...(r.companionPetId ? { companionPetId: r.companionPetId } : {}),
        ...(r.companionPetName ? { companionPetName: r.companionPetName } : {}),
        ...(r.companionFullName ? { companionFullName: r.companionFullName } : {}),
        ...(r.companionCanDuel !== undefined ? { companionCanDuel: r.companionCanDuel } : {}),
        ...(r.companionPetSource ? { companionPetSource: r.companionPetSource } : {}),
        customizeCode: r.member.editToken,
        customizeUrl: `${base}/customize/${r.member.editToken}`,
      },
    });
    return true;
  }
  if (method === 'POST' && p === '/api/customize/save') {
    const body = await readJson<{
      code?: string;
      name?: string;
      role?: string;
      look?: 'f' | 'm';
      seed?: number;
      parts?: unknown;
      canDuel?: boolean;
      companionPokemon?: string;
      companionCanDuel?: boolean;
    }>(req);
    const code = typeof body.code === 'string' ? body.code : '';
    const found = store.getMemberByEditToken(code);
    if (!found.ok) {
      sendJson(res, found.statusCode, { ok: false, error: found.error });
      return true;
    }

    let companionPetId: string | null | undefined;
    let companionPetName: string | undefined;
    if (body.companionPokemon !== undefined) {
      const rawPet = typeof body.companionPokemon === 'string' ? body.companionPokemon.trim() : '';
      if (!rawPet || /^(?:无|没有|不带|不用|取消|none)$/i.test(rawPet)) {
        companionPetId = null;
      } else if (
        rawPet === found.companionPetName ||
        rawPet === found.companionFullName ||
        rawPet === found.companionPetId
      ) {
        companionPetId = found.companionPetId;
        companionPetName = found.companionPetName;
      } else {
        const directPet = pets.getPet(rawPet);
        if (directPet) {
          companionPetId = rawPet;
          companionPetName = directPet.displayName;
        } else {
          const cRes = await pokemon.ensurePokemonPet(rawPet);
          if (!cRes.ok) {
            sendJson(res, 400, { ok: false, error: cRes.error || '未找到该宝可梦，请换一个名称或图鉴编号' });
            return true;
          }
          companionPetId = cRes.pet.id;
          companionPetName = cRes.pokemon.zh_hans || cRes.pokemon.en;
        }
      }
    }

    const updated = store.updateMemberByEditToken(code, {
      name: body.name,
      role: body.role,
      look: body.look,
      seed: body.seed,
      parts: body.parts,
      ...(typeof body.canDuel === 'boolean' ? { canDuel: body.canDuel } : {}),
      companionPetId,
      companionPetName,
      ...(typeof body.companionCanDuel === 'boolean' ? { companionCanDuel: body.companionCanDuel } : {}),
    });
    if (!updated.ok) {
      sendJson(res, updated.statusCode, { ok: false, error: updated.error });
      return true;
    }
    const base = getBaseUrl(req);
    sendJson(res, 200, {
      ok: true,
      profile: {
        id: updated.member.id,
        name: updated.member.name,
        role: updated.member.role,
        ...(updated.member.isNpc ? { isNpc: true } : {}),
        agentTool: updated.member.agentTool,
        status: updated.member.lastStatus,
        look: updated.member.look,
        seed: updated.member.seed,
        parts: updated.resolvedParts,
        canDuel: updated.canDuel,
        ...(updated.companionPetId ? { companionPetId: updated.companionPetId } : {}),
        ...(updated.companionPetName ? { companionPetName: updated.companionPetName } : {}),
        ...(updated.companionFullName ? { companionFullName: updated.companionFullName } : {}),
        ...(updated.companionCanDuel !== undefined ? { companionCanDuel: updated.companionCanDuel } : {}),
        ...(updated.companionPetSource ? { companionPetSource: updated.companionPetSource } : {}),
        customizeCode: updated.member.editToken,
        customizeUrl: `${base}/customize/${updated.member.editToken}`,
      },
    });
    return true;
  }
  if (method === 'GET' && p === '/api/character/frame') {
    const rawSeed = Number(url.searchParams.get('seed'));
    const seed = parseSeed(Number.isFinite(rawSeed) ? rawSeed : 0) ?? 20261124;
    const look = url.searchParams.get('look') === 'f' ? 'f' : 'm';
    let parts = undefined;
    const rawParts = url.searchParams.get('parts');
    if (rawParts) {
      try {
        parts = parseAppearanceParts(JSON.parse(rawParts)) ?? undefined;
      } catch {
        parts = undefined;
      }
    }
    const appearance = appearanceFromSeed(seed, { look, parts });
    const sprite = renderCharacter({ appearance, dir: 'down', pose: 'stand', frame: 0 });
    sendJson(res, 200, {
      width: sprite.buf.w,
      height: sprite.buf.h,
      rgbaBase64: Buffer.from(sprite.buf.data).toString('base64'),
    });
    return true;
  }
  if (method === 'GET' && p === '/setup') {
    sendText(res, 200, renderSetupHtml(getBaseUrl(req)), 'text/html; charset=utf-8');
    return true;
  }
  if (method === 'GET' && p === '/setup.md') {
    sendText(res, 200, renderSetupMarkdown(getBaseUrl(req)), 'text/markdown; charset=utf-8');
    return true;
  }
  if (method === 'GET' && p === '/map-studio-setup.md') {
    const token = (url.searchParams.get('token') ?? '').trim();
    const session = token.startsWith('ws_') ? mapManager.getSessionByToken(token) : null;
    if (!session) {
      sendJson(res, 401, { error: 'Invalid or missing studio token (?token=ws_...)' });
      return true;
    }
    const base = (url.searchParams.get('base') || getBaseUrl(req)).replace(/\/+$/, '');
    sendText(res, 200, renderMapStudioSetupMarkdown(base, session), 'text/markdown; charset=utf-8');
    return true;
  }
  if (method === 'GET' && p === '/client-scripts/report.mjs') {
    sendText(res, 200, renderReportScript(getBaseUrl(req)), 'text/javascript; charset=utf-8');
    return true;
  }
  if (method === 'GET' && p === '/client-scripts/watch.mjs') {
    sendText(res, 200, renderWatchScript(getBaseUrl(req)), 'text/javascript; charset=utf-8');
    return true;
  }
  if (method === 'GET' && p === '/client-scripts/map-mcp.mjs') {
    sendText(res, 200, renderMapMcpScript(getBaseUrl(req)), 'text/javascript; charset=utf-8');
    return true;
  }

  // ---- Public Active Map & Workshop Studio Sessions + Built-in MCP
  if (method === 'GET' && p === '/api/map') {
    sendJson(res, 200, mapManager.getPublicState());
    return true;
  }

  if (method === 'POST' && p === '/api/map/studio/session') {
    const body = await readJson<{ doc?: unknown; resumeToken?: string }>(req, 8 * 1024 * 1024);
    const session = mapManager.createSession(body);
    sendJson(res, 201, {
      sessionId: session.sessionId,
      studioToken: session.studioToken,
      rev: session.rev,
      doc: session.doc,
      selection: session.selection,
      tasks: mapManager.getTaskSummaries(session.sessionId),
      presence: mapManager.getMcpPresence(session.sessionId),
      endpoints: {
        baseUrl: getBaseUrl(req),
        lanUrl: detectLanUrl(port),
      },
      summary: validateMapPlayability(session.doc),
    });
    return true;
  }

  if (method === 'POST' && p === '/api/map/studio/heartbeat') {
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    const token = (typeof req.headers['x-studio-token'] === 'string' ? req.headers['x-studio-token'].trim() : '')
      || bearer
      || (url.searchParams.get('token')?.trim() ?? '');
    const session = token.startsWith('ws_') ? mapManager.getSessionByToken(token) : null;
    if (!session) {
      sendJson(res, 401, { error: 'Unauthorized studio session token' });
      return true;
    }
    const body = await readJson<{ clientName?: string; transport?: 'http' | 'stdio' }>(req, 32 * 1024);
    const presence = mapManager.touchMcpPresence(session.sessionId, {
      clientName: typeof body.clientName === 'string' ? body.clientName : undefined,
      transport: body.transport === 'stdio' ? 'stdio' : 'http',
    });
    sendJson(res, 200, { ok: true, presence });
    return true;
  }

  if (p.startsWith('/api/map/studio/')) {
    const m = /^\/api\/map\/studio\/([^/]+)(?:\/(.*))?$/.exec(p);
    if (!m) {
      sendJson(res, 404, { error: 'Invalid studio path' });
      return true;
    }
    const sid = decodeURIComponent(m[1]);
    const sub = m[2] ?? '';
    const session = mapManager.getSession(sid);
    if (!session) {
      sendJson(res, 404, { error: 'Studio 会话不存在或已过期。' });
      return true;
    }
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    const studioToken = (typeof req.headers['x-studio-token'] === 'string' ? req.headers['x-studio-token'].trim() : '')
      || bearer
      || (url.searchParams.get('token')?.trim() ?? '');
    const isAdmin = checkAdminAuth(req);
    const tokenMatch = studioToken && studioToken === session.studioToken;
    if (!isAdmin && !tokenMatch) {
      sendJson(res, 401, { error: 'Unauthorized studio session token' });
      return true;
    }

    if (method === 'GET' && sub === '') {
      sendJson(res, 200, {
        sessionId: session.sessionId,
        rev: session.rev,
        doc: session.doc,
        selection: session.selection,
        tasks: mapManager.getTaskSummaries(session.sessionId),
        presence: mapManager.getMcpPresence(session.sessionId),
        endpoints: {
          baseUrl: getBaseUrl(req),
          lanUrl: detectLanUrl(port),
        },
        summary: validateMapPlayability(session.doc),
      });
      return true;
    }

    if (method === 'PUT' && sub === '') {
      const body = await readJson<{ doc?: unknown; patchRect?: { x: number; y: number; w: number; h: number }; note?: string }>(req, 8 * 1024 * 1024);
      const resUpdate = mapManager.updateSessionDraft(sid, body.doc ?? body, {
        patchRect: body.patchRect,
        note: body.note,
      });
      sendJson(res, resUpdate.ok ? 200 : 400, resUpdate);
      return true;
    }

    if (method === 'POST' && sub === 'selection') {
      const body = await readJson<{ x?: number; y?: number; w?: number; h?: number; note?: string; clear?: boolean } | null>(req, 256 * 1024);
      const sel = !body || body.clear || body.x === undefined || body.y === undefined || body.w === undefined || body.h === undefined
        ? null
        : { x: Number(body.x), y: Number(body.y), w: Number(body.w), h: Number(body.h), ...(body.note ? { note: String(body.note) } : {}), updatedAt: Date.now() };
      const resSel = mapManager.setSessionSelection(sid, sel);
      sendJson(res, resSel.ok ? 200 : 400, resSel);
      return true;
    }

    if (method === 'POST' && sub === 'rotate-token') {
      const rotated = mapManager.rotateSessionToken(sid);
      sendJson(res, rotated.ok ? 200 : 400, rotated);
      return true;
    }

    if (method === 'POST' && sub === 'tasks') {
      const body = await readJson<{
        boxes?: Array<{ id?: string; label?: string; x: number; y: number; w: number; h: number; note?: string }>;
        instruction?: string;
      }>(req, 512 * 1024);
      const enq = mapManager.enqueueTask(sid, body);
      sendJson(res, enq.ok ? 201 : 400, enq);
      return true;
    }

    const taskActionMatch = /^tasks\/([^/]+)\/(accept|revert|cancel)$/.exec(sub);
    if (method === 'POST' && taskActionMatch) {
      const taskId = decodeURIComponent(taskActionMatch[1]);
      const action = taskActionMatch[2];
      const out = action === 'accept'
        ? mapManager.acceptTask(sid, taskId)
        : action === 'revert'
          ? mapManager.revertTask(sid, taskId)
          : mapManager.cancelTask(sid, taskId);
      sendJson(res, out.ok ? 200 : 400, out);
      return true;
    }

    if (method === 'POST' && sub === 'undo') {
      const resUndo = mapManager.undoSession(sid);
      sendJson(res, resUndo.ok ? 200 : 400, resUndo);
      return true;
    }

    if (method === 'POST' && sub === 'redo') {
      const resRedo = mapManager.redoSession(sid);
      sendJson(res, resRedo.ok ? 200 : 400, resRedo);
      return true;
    }

    if (method === 'GET' && sub === 'events') {
      res.writeHead(200, corsHeaders({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      }));
      res.flushHeaders?.();
      writeSse(res, 'state', {
        type: 'init',
        sessionId: session.sessionId,
        rev: session.rev,
        doc: session.doc,
        selection: session.selection,
        tasks: mapManager.getTaskSummaries(session.sessionId),
        presence: mapManager.getMcpPresence(session.sessionId),
        summary: validateMapPlayability(session.doc),
      });
      const unsub = mapManager.subscribeSession(sid, (ev) => {
        writeSse(res, ev.type, ev);
      });
      req.on('close', unsub);
      return true;
    }

    sendJson(res, 404, { error: 'Unknown studio endpoint' });
    return true;
  }

  if (p === '/api/mcp' || p.startsWith('/api/mcp/')) {
    if (method === 'GET') {
      sendJson(res, 200, { name: 'agent-party-map-mcp', ok: true, transport: 'streamable-http' });
      return true;
    }
    if (method === 'POST') {
      const auth = resolveMcpAuth(req, url, adminKey, mapManager);
      if (!auth) {
        sendJson(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized MCP token (provide ws_ studio token or admin key).' } });
        return true;
      }
      const rpc = await readJson(req, 8 * 1024 * 1024);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      const transport = req.headers['x-mcp-transport'] === 'stdio' ? 'stdio' : 'http';
      const reply = await handleMcpRpc(rpc, auth, mapManager, { signal: ac.signal, transport });
      if (reply.status === 204) {
        res.writeHead(204, corsHeaders());
        res.end();
        return true;
      }
      sendJson(res, reply.status, reply.body);
      return true;
    }
  }

  // ---- Admin Panel & Protected Admin APIs
  if (method === 'GET' && p === '/admin') {
    sendText(res, 200, renderAdminHtml(), 'text/html; charset=utf-8');
    return true;
  }

  if (p.startsWith('/api/admin/')) {
    if (!checkAdminAuth(req)) {
      sendJson(res, 401, { error: 'Unauthorized: invalid or missing admin key.' });
      return true;
    }

    if (method === 'GET' && p === '/api/admin/verify') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'GET' && p === '/api/admin/state') {
      pets.refresh();
      sendJson(res, 200, {
        ...store.getAdminState(),
        effectiveBaseUrl: getBaseUrl(req),
        envPublicUrl: process.env.PUBLIC_URL?.trim()?.replace(/\/+$/, '') || '',
      });
      return true;
    }

    if ((method === 'PUT' || method === 'PATCH') && p === '/api/admin/settings') {
      const body = await readJson<{
        publicUrl?: string | null;
        receptionSign?: string | null;
        officeSettings?: Record<string, unknown>;
        theme?: unknown;
        daylight?: unknown;
        liveliness?: unknown;
        bubbles?: unknown;
        showNames?: unknown;
        lunchEnabled?: unknown;
        lunchStart?: unknown;
        lunchEnd?: unknown;
      }>(req);
      if ('publicUrl' in body) {
        const r = store.setPublicUrl(body.publicUrl);
        if (!r.ok) {
          sendJson(res, 400, { error: r.error });
          return true;
        }
      }
      if ('receptionSign' in body) {
        store.setReceptionSign(body.receptionSign);
      }
      const officePatch: Record<string, unknown> =
        body.officeSettings && typeof body.officeSettings === 'object' ? { ...body.officeSettings } : {};
      for (const k of ['theme', 'daylight', 'liveliness', 'bubbles', 'showNames', 'lunchEnabled', 'lunchStart', 'lunchEnd'] as const) {
        if (k in body) officePatch[k] = body[k];
      }
      if (Object.keys(officePatch).length > 0) {
        store.setOfficeSettings(officePatch);
      }
      sendJson(res, 200, {
        ok: true,
        publicUrl: store.getPublicUrl() ?? '',
        effectiveBaseUrl: getBaseUrl(req),
        receptionSign: store.getReceptionSign(),
        officeSettings: store.getOfficeSettings(),
      });
      return true;
    }

    const duelMatch = /^\/api\/admin\/members\/([^/]+)\/duel$/.exec(p);
    if ((method === 'PATCH' || method === 'POST') && duelMatch) {
      const id = decodeURIComponent(duelMatch[1]);
      const body = await readJson<{ canDuel?: boolean }>(req);
      const r = store.setMemberCanDuel(id, !!body.canDuel);
      if (!r.ok) sendJson(res, r.statusCode, { error: r.error });
      else sendJson(res, 200, { ok: true, canDuel: r.canDuel });
      return true;
    }

    const kickMatch = /^\/api\/admin\/members\/([^/]+)\/kick$/.exec(p);
    if (method === 'POST' && kickMatch) {
      const id = decodeURIComponent(kickMatch[1]);
      const ok = store.kickMember(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true, ...store.getAdminLists() } : { error: 'Member not found' });
      return true;
    }

    const banMatch = /^\/api\/admin\/members\/([^/]+)\/ban$/.exec(p);
    if (method === 'POST' && banMatch) {
      const id = decodeURIComponent(banMatch[1]);
      const body = await readJson<{ reason?: string }>(req);
      store.banMember(id, body.reason);
      sendJson(res, 200, { ok: true, ...store.getAdminLists() });
      return true;
    }

    const unbanMatch = /^\/api\/admin\/bans\/([^/]+)$/.exec(p);
    if (method === 'DELETE' && unbanMatch) {
      const id = decodeURIComponent(unbanMatch[1]);
      const ok = store.unbanMember(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true, ...store.getAdminLists() } : { error: 'Ban record not found' });
      return true;
    }

    if (method === 'POST' && p === '/api/admin/npcs') {
      const body = await readJson<Parameters<PartyStore['createNpc']>[0]>(req);
      const r = store.createNpc(body);
      if (!r.ok) sendJson(res, 400, { error: r.error });
      else sendJson(res, 200, { ok: true, npc: { ...r.npc, canDuel: store.effectiveCanDuel(r.npc) } });
      return true;
    }

    const npcMatch = /^\/api\/admin\/npcs\/([^/]+)$/.exec(p);
    if (npcMatch && method === 'PATCH') {
      const id = decodeURIComponent(npcMatch[1]);
      const body = await readJson<Parameters<PartyStore['updateNpc']>[1]>(req);
      const r = store.updateNpc(id, body);
      if (!r.ok) sendJson(res, r.statusCode, { error: r.error });
      else sendJson(res, 200, { ok: true, npc: { ...r.npc, canDuel: store.effectiveCanDuel(r.npc) } });
      return true;
    }

    if (npcMatch && method === 'DELETE') {
      const id = decodeURIComponent(npcMatch[1]);
      const ok = store.deleteNpc(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true, deletedId: id } : { error: 'NPC not found' });
      return true;
    }

    if (method === 'POST' && p === '/api/admin/arena/start') {
      const r = worldSync.triggerArenaDuel();
      sendJson(res, r.ok ? 200 : 400, r);
      return true;
    }

    if (method === 'GET' && p === '/api/admin/maps') {
      sendJson(res, 200, mapManager.getPublicState());
      return true;
    }

    if (method === 'POST' && p === '/api/admin/maps') {
      const body = await readJson<{ doc?: unknown; id?: string; name?: string; activate?: boolean }>(req, 8 * 1024 * 1024);
      const saved = mapManager.savePreset(body?.doc ?? body, { id: body?.id, name: body?.name });
      if (!saved.ok) {
        sendJson(res, 400, saved);
        return true;
      }
      let active = null;
      if (body?.activate) {
        active = mapManager.activate({ mode: 'custom', mapId: saved.summary.id });
      }
      sendJson(res, 200, {
        ok: true,
        preset: saved.summary,
        doc: saved.doc,
        ...(active && active.ok ? { mode: active.mode, activeMapId: active.activeMapId, rev: active.rev } : {}),
        maps: mapManager.getPublicState(),
      });
      return true;
    }

    if (method === 'POST' && p === '/api/admin/maps/activate') {
      const body = await readJson<{ mode?: string; mapId?: string | null }>(req);
      const act = mapManager.activate({
        mode: body.mode === 'custom' ? 'custom' : 'auto',
        mapId: body.mapId ?? null,
      });
      sendJson(res, act.ok ? 200 : 400, act.ok ? { ...act, maps: mapManager.getPublicState() } : act);
      return true;
    }

    const adminMapMatch = /^\/api\/admin\/maps\/([^/]+)$/.exec(p);
    if (adminMapMatch) {
      const mapId = decodeURIComponent(adminMapMatch[1]);
      if (method === 'GET') {
        const doc = mapManager.getPreset(mapId);
        sendJson(res, doc ? 200 : 404, doc ? { ok: true, doc } : { error: 'Map preset not found' });
        return true;
      }
      if (method === 'DELETE') {
        const del = mapManager.deletePreset(mapId);
        sendJson(res, del.ok ? 200 : 400, del.ok ? { ok: true, maps: mapManager.getPublicState() } : del);
        return true;
      }
    }

    sendJson(res, 404, { error: 'Unknown admin endpoint' });
    return true;
  }

  return false;
}

const server = http.createServer();
let closeVite: (() => Promise<void>) | undefined;
let fallback: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void;

if (isDev) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: join(rootDir, 'vite.config.ts'),
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
  closeVite = () => vite.close();
  fallback = (req, res) => vite.middlewares(req, res);
} else {
  const serveStatic = createStaticHandler(join(rootDir, 'dist', 'client'));
  fallback = (req, res, url) => serveStatic(req, res, url.pathname);
}

server.on('request', (req, res) => {
  const url = parseUrl(req);
  void handleApi(req, res, url)
    .then((handled) => {
      if (!handled) fallback(req, res, url);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[server] error handling ${req.method} ${url.pathname}:`, msg);
      if (!res.headersSent) sendJson(res, 400, { error: msg });
      else res.destroy();
    });
});

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  console.log(`🏢 Agent Party 已启动: http://${displayHost}:${port}${isDev ? ' (dev)' : ''}`);
  console.log(`🤖 AI 接入指引: http://${displayHost}:${port}/setup`);
  console.log(`🛡️ 管理后台:    http://${displayHost}:${port}/admin`);
  console.log(`🔑 管理员密钥:  ${adminKey}`);
  console.log(`🐾 已加载桌宠:  ${pets.listPets().length} 个 (数据目录: ${dataDir})`);
});

function shutdown(): void {
  clearInterval(sweepTimer);
  clearInterval(keepaliveTimer);
  worldSync.stop();
  store.flush();
  for (const res of sseClients) res.end();
  sseClients.clear();
  void closeVite?.().finally(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
