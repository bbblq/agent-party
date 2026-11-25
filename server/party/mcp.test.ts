import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBlankCustomMap } from '../../shared/map';
import { MapManager } from './map-manager';
import { handleMcpRpc, resolveMcpAuth } from './mcp-server';
import { PetRegistry } from './pets';
import { PartyStore } from './store';
import { WorldSync } from './world-sync';

describe('MapManager + MCP Studio workflow & Admin live map switching', () => {
  let tmpDir = '';
  let mapManager: MapManager;
  let store: PartyStore;
  const adminKey = 'test-admin-secret-key';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ap-map-mcp-'));
    mapManager = new MapManager(tmpDir);
    const pets = new PetRegistry(tmpDir);
    store = new PartyStore({ dataDir: tmpDir, pets, mapManager });
  });

  afterEach(() => {
    store.flush();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('supports Studio ws_ token box-selection + MCP 4-way edits while blocking publish, and allows Admin live switching', async () => {
    const session = mapManager.createSession(createBlankCustomMap('测试园区', 80, 60, 'draft-1'));
    expect(session.studioToken.startsWith('ws_')).toBe(true);

    // User box-selects an empty courtyard region in UI
    mapManager.setSessionSelection(session.sessionId, {
      x: 10,
      y: 10,
      w: 16,
      h: 14,
      note: '在这里新建一个带东西朝向工位的部门房间',
      updatedAt: Date.now(),
    });

    const events: string[] = [];
    const unsub = mapManager.subscribeSession(session.sessionId, (ev) => {
      events.push(`${ev.type}:${ev.rev}`);
    });

    const fakeReq = {
      headers: { authorization: `Bearer ${session.studioToken}` },
    } as unknown as http.IncomingMessage;
    const auth = resolveMcpAuth(fakeReq, new URL('http://localhost/api/mcp'), adminKey, mapManager);
    expect(auth?.role).toBe('studio');
    expect(auth?.session?.sessionId).toBe(session.sessionId);

    // 1. tools/list omits map_publish_and_activate for ws_ studio tokens
    const listRes = await handleMcpRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth!, mapManager);
    const toolNames = ((listRes.body as { result: { tools: Array<{ name: string }> } }).result.tools).map((t) => t.name);
    expect(toolNames).toContain('map_get_selection');
    expect(toolNames).toContain('map_wait_next_task');
    expect(toolNames).toContain('map_complete_task');
    expect(toolNames).toContain('map_place_workstations');
    expect(toolNames).not.toContain('map_publish_and_activate');

    // 2. Read box-selection
    const selRes = await handleMcpRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_get_selection', arguments: {} } },
      auth!,
      mapManager,
    );
    const selJson = JSON.parse((selRes.body as { result: { content: Array<{ text: string }> } }).result.content[0].text);
    expect(selJson.selection.x).toBe(10);
    expect(selJson.selection.w).toBe(16);
    expect(selJson.selection.note).toContain('部门房间');

    // 3. Build room + 4-way island workstations
    await handleMcpRpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'map_build_room',
          arguments: { x: 10, y: 10, w: 16, h: 14, name: 'AI 研发一部', zoneKind: 'room' },
        },
      },
      auth!,
      mapManager,
    );

    const wsRes = await handleMcpRpc(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'map_place_workstations',
          arguments: { x: 12, y: 14, count: 4, facing: 'right', layout: 'island', cols: 2 },
        },
      },
      auth!,
      mapManager,
    );
    const wsJson = JSON.parse((wsRes.body as { result: { content: Array<{ text: string }> } }).result.content[0].text);
    expect(wsJson.ok).toBe(true);
    expect(wsJson.placed).toBe(4);
    expect(events.length).toBeGreaterThanOrEqual(2);

    // 4. Studio token CANNOT publish & switch live map
    const deniedRes = await handleMcpRpc(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'map_publish_and_activate', arguments: { mode: 'custom', name: '篡改线上' } },
      },
      auth!,
      mapManager,
    );
    expect((deniedRes.body as { result: { isError?: boolean } }).result.isError).toBe(true);
    expect(mapManager.getMode()).toBe('auto');

    unsub();

    // 5. Admin key CAN publish draft & switch live, updating PartyStore & WorldSync
    const worldSync = new WorldSync(store.toSnapshot(), { initialCustomMap: mapManager.getActiveDoc() });
    mapManager.onActiveChange(() => {
      worldSync.setCustomMap(mapManager.getActiveDoc());
      store.notifyMapChange();
    });

    const adminReq = {
      headers: { 'x-admin-key': adminKey },
    } as unknown as http.IncomingMessage;
    const adminAuth = resolveMcpAuth(
      adminReq,
      new URL(`http://localhost/api/mcp?session=${encodeURIComponent(session.sessionId)}`),
      adminKey,
      mapManager,
    );
    expect(adminAuth?.role).toBe('admin');

    const pubRes = await handleMcpRpc(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'map_publish_and_activate', arguments: { mode: 'custom', mapId: 'ai-campus', name: 'AI 校园版' } },
      },
      adminAuth!,
      mapManager,
    );
    const pubJson = JSON.parse((pubRes.body as { result: { content: Array<{ text: string }> } }).result.content[0].text);
    expect(pubJson.ok).toBe(true);
    expect(mapManager.getMode()).toBe('custom');
    expect(worldSync.sim.customMap?.id).toBe('ai-campus');

    const snapCustom = store.toSnapshot();
    expect(snapCustom.meta.mapMode).toBe('custom');
    expect(snapCustom.meta.activeMapId).toBe('ai-campus');
    expect(snapCustom.rooms.some((r) => r.name === 'AI 研发一部')).toBe(true);

    // 6. Switch back to default auto mode live
    mapManager.activate({ mode: 'auto' });
    expect(worldSync.sim.customMap).toBeNull();
    expect(store.toSnapshot().meta.mapMode).toBe('auto');
  });

  it('isolates per-user URL MCP sessions, wakes multi-box tasks from queue, and performs surgical confirm/revert', async () => {
    const sA = mapManager.createSession(createBlankCustomMap('用户A园区', 96, 64, 'a-map'));
    const sB = mapManager.createSession(createBlankCustomMap('用户B园区', 96, 64, 'b-map'));
    expect(sA.studioToken).not.toBe(sB.studioToken);

    // Dedicated URL token extraction without Authorization header
    const noHdrReq = { headers: {} } as unknown as http.IncomingMessage;
    const authA = resolveMcpAuth(noHdrReq, new URL(`http://localhost/api/mcp/${sA.studioToken}`), adminKey, mapManager);
    const authB = resolveMcpAuth(noHdrReq, new URL(`http://localhost/api/mcp/${sB.studioToken}`), adminKey, mapManager);
    expect(authA?.session?.sessionId).toBe(sA.sessionId);
    expect(authB?.session?.sessionId).toBe(sB.sessionId);

    // Initialize lights up presence.connected for user A only
    await handleMcpRpc(
      { jsonrpc: '2.0', id: 10, method: 'initialize', params: { clientInfo: { name: 'Cursor-AI' } } },
      authA!,
      mapManager,
    );
    expect(mapManager.getMcpPresence(sA.sessionId).connected).toBe(true);
    expect(mapManager.getMcpPresence(sA.sessionId).clientName).toBe('Cursor-AI');
    expect(mapManager.getMcpPresence(sB.sessionId).connected).toBe(false);

    // Start long-poll waiting for user A's click
    const waitPromise = handleMcpRpc(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'map_wait_next_task', arguments: { timeoutSec: 5 } } },
      authA!,
      mapManager,
    );
    expect(mapManager.getMcpPresence(sA.sessionId).listening).toBe(true);

    // User clicks "Send to AI" with 2 boxes at once (#1 west wing, #2 east wing)
    const enq1 = mapManager.enqueueTask(sA.sessionId, {
      instruction: '新建西区办公与东区茶水',
      boxes: [
        { x: 4, y: 4, w: 14, h: 12, note: '建西区部门房' },
        { x: 4, y: 20, w: 12, h: 10, note: '建茶水间' },
      ],
    });
    expect(enq1.ok).toBe(true);

    // Woken immediately!
    const wokenRes = await waitPromise;
    const wokenPayload = JSON.parse((wokenRes.body as { result: { content: Array<{ text: string }> } }).result.content[0].text);
    expect(wokenPayload.hasTask).toBe(true);
    expect(wokenPayload.boxes).toHaveLength(2);
    const task1Id = wokenPayload.taskId as string;

    // User immediately boxes another independent region on the far east and queues Task #2 while Task #1 is running
    const enq2 = mapManager.enqueueTask(sA.sessionId, {
      boxes: [{ x: 70, y: 6, w: 16, h: 12, note: '建东翼休息区' }],
    });
    expect(enq2.ok).toBe(true);
    if (enq2.ok) expect(enq2.task.status).toBe('queued');

    // AI edits both boxes for Task #1 and completes it -> enters 'review'
    await handleMcpRpc(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'map_build_room', arguments: { x: 4, y: 4, w: 14, h: 12, name: '西区房间' } } },
      authA!,
      mapManager,
    );
    await handleMcpRpc(
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'map_build_room', arguments: { x: 4, y: 20, w: 12, h: 10, name: '茶水房', zoneKind: 'cafe' } } },
      authA!,
      mapManager,
    );
    const comp1 = await handleMcpRpc(
      { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'map_complete_task', arguments: { taskId: task1Id, summary: '完成西区2个区域' } } },
      authA!,
      mapManager,
    );
    const comp1Json = JSON.parse((comp1.body as { result: { content: Array<{ text: string }> } }).result.content[0].text);
    expect(comp1Json.hasMoreQueued).toBe(true);

    // AI claims & finishes queued Task #2 in far east wing
    const wait2 = await handleMcpRpc(
      { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'map_wait_next_task', arguments: { timeoutSec: 5 } } },
      authA!,
      mapManager,
    );
    const task2Id = JSON.parse((wait2.body as { result: { content: Array<{ text: string }> } }).result.content[0].text).taskId as string;
    await handleMcpRpc(
      { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'map_build_room', arguments: { x: 70, y: 6, w: 16, h: 12, name: '东翼休息区', zoneKind: 'lounge' } } },
      authA!,
      mapManager,
    );
    await handleMcpRpc(
      { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'map_complete_task', arguments: { taskId: task2Id, summary: '完成东翼休息区' } } },
      authA!,
      mapManager,
    );

    // User accepts Task #2 and reverts Task #1 -> east wing room MUST remain while west wing rooms revert!
    const acc2 = mapManager.acceptTask(sA.sessionId, task2Id);
    expect(acc2.ok).toBe(true);
    const rev1 = mapManager.revertTask(sA.sessionId, task1Id);
    expect(rev1.ok).toBe(true);
    if (rev1.ok) {
      expect(rev1.doc.zones.some((z) => z.name === '东翼休息区')).toBe(true);
      expect(rev1.doc.zones.some((z) => z.name === '西区房间')).toBe(false);
      expect(rev1.doc.zones.some((z) => z.name === '茶水房')).toBe(false);
    }

    // Token rotation disconnects old token while keeping user B untouched
    const oldTokA = sA.studioToken;
    const rot = mapManager.rotateSessionToken(sA.sessionId);
    expect(rot.ok).toBe(true);
    expect(resolveMcpAuth(noHdrReq, new URL(`http://localhost/api/mcp/${oldTokA}`), adminKey, mapManager)).toBeNull();
    expect(resolveMcpAuth(noHdrReq, new URL(`http://localhost/api/mcp/${sB.studioToken}`), adminKey, mapManager)?.session?.sessionId).toBe(sB.sessionId);
  });
});
