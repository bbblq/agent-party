import type http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Dir, FloorKind, FurnitureKind } from '../../client/src/art/api';
import type { AreaKind, TileRect } from '../../client/src/world/layout/types';
import { renderAsciiRegion, validateMapPlayability, type CustomMapDocument, type CustomZone } from '../../shared/map';
import {
  MapManager,
  opBuildRoom,
  opClearRegion,
  opMutateItems,
  opPaintTiles,
  opPlaceWorkstations,
  opPopulateZonePreset,
  type StudioSession,
} from './map-manager';

export interface McpAuthContext {
  role: 'admin' | 'studio';
  session: StudioSession | null;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const MCP_TOOLS = [
  {
    name: 'map_wait_next_task',
    description: '【自动接单监听】挂起等待用户在地图工坊点击「直接发送给 AI 修改」或队列中的下一个任务（长轮询默认 25 秒）。收到任务后请修改所有指定区块并调用 map_complete_task，随后继续调用本工具待命。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutSec: { type: 'number', description: '长轮询超时秒数（5~45，默认 25）。若超时无任务，请立即再次调用以保持在线待命。' },
      },
    },
  },
  {
    name: 'map_complete_task',
    description: '通知地图工坊当前任务已修改完成，界面会保留你的结果并提示用户「确认修改」或「恢复原样」。完成后请再次调用 map_wait_next_task 接收后续任务。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '要标记完成的任务 ID（可留空，自动匹配当前进行中任务）。' },
        summary: { type: 'string', description: '简述本轮修改内容，将展示在用户的待确认卡片上。' },
      },
    },
  },
  {
    name: 'map_list_tasks',
    description: '查看当前工坊会话的任务队列、待确认列表以及实时连接状态。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'map_get_context',
    description: '获取当前画布（或 Studio 草稿）概况：尺寸、区域列表、工位数量统计、通行验证结果，以及用户当前框选坐标和修改要求。',
    inputSchema: {
      type: 'object',
      properties: {
        mapId: { type: 'string', description: '管理员模式下可指定预设地图 ID；Studio 模式下默认操作绑定的工坊草稿。' },
      },
    },
  },
  {
    name: 'map_get_selection',
    description: '读取用户在地图工坊中框选的矩形范围 (x, y, w, h) 及附带修改说明 (note)，并渲染该框选区域及外扩 2 格的 ASCII 布局与清单。',
    inputSchema: {
      type: 'object',
      properties: {
        margin: { type: 'number', description: 'ASCII 预览周围额外扩展格数（默认 2，最大 8）。' },
      },
    },
  },
  {
    name: 'map_inspect_region',
    description: '检视指定矩形坐标 (x, y, w, h) 内的地形、墙体、门洞和家具清单（建议每次查看 <= 48x32 格，大图请按区块检视）。',
    inputSchema: {
      type: 'object',
      required: ['x', 'y', 'w', 'h'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_clear_region',
    description: '清空指定矩形区域内的家具/墙体/地毯/区域，并填充指定地面（默认使用背景草地）。',
    inputSchema: {
      type: 'object',
      required: ['x', 'y', 'w', 'h'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
        fillFloor: { type: 'string', enum: ['grass', 'sidewalk', 'street', 'wood', 'concrete', 'marble', 'tile_check', 'tile_white', 'carpet'] },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_paint_tiles',
    description: '在指定矩形批量刷地面材质（支持 grass/sidewalk/street/wood/concrete/marble/tile_check/tile_white/carpet）。',
    inputSchema: {
      type: 'object',
      required: ['ops'],
      properties: {
        ops: {
          type: 'array',
          items: {
            type: 'object',
            required: ['x', 'y', 'floor'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
              floor: { type: 'string' },
              tint: { type: 'string' },
              tint2: { type: 'string' },
            },
          },
        },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_build_room',
    description: '一键建造一个带外墙、门洞、地面、区划名称、窗户、铭牌与灯开关的完整房间。',
    inputSchema: {
      type: 'object',
      required: ['x', 'y', 'w', 'h'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
        name: { type: 'string' },
        zoneKind: { type: 'string', enum: ['room', 'lounge', 'cafe', 'restroom', 'reception', 'arena'] },
        floorKind: { type: 'string' },
        doors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              side: { type: 'string', enum: ['north', 'south'] },
              offset: { type: 'number' },
              w: { type: 'number' },
            },
          },
        },
        clearInside: { type: 'boolean' },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_place_workstations',
    description: '自动批量摆放 4 个朝向（up=北/down=南/left=西/right=东）或面对面岛台工位，自动匹配对应朝向桌椅。',
    inputSchema: {
      type: 'object',
      required: ['x', 'y', 'count', 'facing'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        count: { type: 'number' },
        facing: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        layout: { type: 'string', enum: ['row', 'island'] },
        cols: { type: 'number' },
        deskVariant: { type: 'string' },
        chairVariant: { type: 'string' },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_populate_zone',
    description: '在给定矩形一键生成完整主题功能区（office 办公区 / lounge 休息区 / cafe 茶水区 / restroom 洗手间 / reception 前台 / arena 决斗场）。',
    inputSchema: {
      type: 'object',
      required: ['x', 'y', 'w', 'h', 'preset'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
        preset: { type: 'string', enum: ['office', 'lounge', 'cafe', 'restroom', 'reception', 'arena'] },
        name: { type: 'string' },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_mutate_items',
    description: '精确增删家具、墙面挂件（窗户/白板/TV/铭牌/电灯开关）、地毯、出生点（入口地垫）或区划定义。',
    inputSchema: {
      type: 'object',
      properties: {
        removeIds: { type: 'array', items: { type: 'string' } },
        addFurniture: { type: 'array', items: { type: 'object' } },
        addWallItems: { type: 'array', items: { type: 'object' } },
        addRugs: { type: 'array', items: { type: 'object' } },
        addSpawns: { type: 'array', items: { type: 'object' } },
        upsertZones: { type: 'array', items: { type: 'object' } },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_resize',
    description: '无损调整画布宽高（支持 16x16 到 512x512 格）。',
    inputSchema: {
      type: 'object',
      required: ['width', 'height'],
      properties: {
        width: { type: 'number', minimum: 16, maximum: 512 },
        height: { type: 'number', minimum: 16, maximum: 512 },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_undo',
    description: '撤销 Studio 草稿最近一次修改。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'map_redo',
    description: '重做 Studio 草稿的撤销操作。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'map_validate',
    description: '运行编译与 BFS 全图可达性检查，报告四向工位数量、无背面宠物可用工位数、不可达点及警告。',
    inputSchema: {
      type: 'object',
      properties: {
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'map_publish_and_activate',
    description: '【仅管理员】将草稿或指定地图发布并实时切换线上模式（auto 默认动态模式 / custom 自定义地图）。普通工坊用户令牌将被拒绝。',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['auto', 'custom'] },
        mapId: { type: 'string' },
        name: { type: 'string' },
        fromSessionId: { type: 'string' },
      },
    },
  },
];

function extractToken(req: http.IncomingMessage, url: URL): string {
  const pathMatch = /^\/api\/mcp\/(ws_[A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (pathMatch) return pathMatch[1];
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const studioHdr = typeof req.headers['x-studio-token'] === 'string' ? req.headers['x-studio-token'].trim() : '';
  const adminHdr = typeof req.headers['x-admin-key'] === 'string' ? req.headers['x-admin-key'].trim() : '';
  const qToken = url.searchParams.get('token')?.trim() ?? '';
  return bearer || studioHdr || adminHdr || qToken;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function resolveMcpAuth(
  req: http.IncomingMessage,
  url: URL,
  adminKey: string,
  mapManager: MapManager,
): McpAuthContext | null {
  const token = extractToken(req, url);
  if (!token) return null;
  if (safeEqual(token, adminKey)) {
    const sid = url.searchParams.get('session')?.trim() ?? '';
    return {
      role: 'admin',
      session: sid ? mapManager.getSession(sid) : null,
    };
  }
  if (token.startsWith('ws_')) {
    const session = mapManager.getSessionByToken(token);
    if (!session) return null;
    return { role: 'studio', session };
  }
  return null;
}

function okText(data: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

export async function handleMcpRpc(
  rpc: JsonRpcRequest,
  auth: McpAuthContext,
  mapManager: MapManager,
  opts?: { signal?: AbortSignal; transport?: 'http' | 'stdio' },
): Promise<{ status: number; body?: unknown }> {
  const id = rpc.id ?? null;
  const method = rpc.method;

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    if (auth.session) {
      mapManager.touchMcpPresence(auth.session.sessionId, { transport: opts?.transport });
    }
    return { status: 204 };
  }

  if (method === 'initialize') {
    const clientInfo = rpc.params?.clientInfo as { name?: unknown } | undefined;
    const clientName = typeof clientInfo?.name === 'string' ? clientInfo.name : undefined;
    if (auth.session) {
      mapManager.touchMcpPresence(auth.session.sessionId, {
        clientName,
        transport: opts?.transport ?? 'http',
      });
    }
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, prompts: {} },
          serverInfo: {
            name: 'agent-party-map-mcp',
            version: '1.1.0',
          },
          instructions:
            'You are connected to an isolated Agent Party Map Studio session. To stay ready for live box-selection tasks clicked by the user, call `map_wait_next_task` in a loop. Whenever it returns `hasTask: true`, modify all boxes requested, call `map_complete_task({ taskId, summary })`, and immediately call `map_wait_next_task` again.',
        },
      },
    };
  }

  if (auth.session) {
    mapManager.touchMcpPresence(auth.session.sessionId, { transport: opts?.transport });
  }

  if (method === 'ping') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };
  }

  if (method === 'prompts/list') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'studio_autopilot',
              description: '开启地图工坊自动监听接单模式，持续接收画布框选并原地修改。',
            },
          ],
        },
      },
    };
  }

  if (method === 'prompts/get') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          description: '地图工坊自动监听接单指引',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: '请立即调用 map_wait_next_task 开启地图工坊实时接单监听。收到用户发来的多框选或单框选任务后：1）阅读每个区块坐标和 note；2）调用地图编辑工具完成修改；3）调用 map_complete_task 提交给用户预览确认；4）继续调用 map_wait_next_task 等待下一个任务。',
              },
            },
          ],
        },
      },
    };
  }

  if (method === 'tools/list') {
    const tools = auth.role === 'admin'
      ? MCP_TOOLS
      : MCP_TOOLS.filter((t) => t.name !== 'map_publish_and_activate');
    return { status: 200, body: { jsonrpc: '2.0', id, result: { tools } } };
  }

  if (method !== 'tools/call') {
    return {
      status: 200,
      body: { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(method)}` } },
    };
  }

  const params = rpc.params ?? {};
  const toolName = String(params.name ?? '');
  const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;

  const resolveTargetDoc = (requestedMapId?: unknown): { doc: CustomMapDocument; session: StudioSession | null; presetId: string | null } | { error: string } => {
    if (auth.role === 'studio') {
      if (!auth.session) return { error: 'Studio 会话已失效。' };
      return { doc: auth.session.doc, session: auth.session, presetId: null };
    }
    if (auth.session && typeof requestedMapId !== 'string') {
      return { doc: auth.session.doc, session: auth.session, presetId: null };
    }
    const mid = typeof requestedMapId === 'string' && requestedMapId.trim()
      ? requestedMapId.trim()
      : (mapManager.getActiveMapId() ?? mapManager.listPresets()[0]?.id ?? '');
    const preset = mid ? mapManager.getPreset(mid) : null;
    if (!preset) return { error: '未找到目标地图预设，请先在管理员面板创建预设或传入有效的 mapId。' };
    return { doc: preset, session: null, presetId: preset.id };
  };

  const commitDoc = (
    target: { session: StudioSession | null; presetId: string | null },
    nextDoc: CustomMapDocument,
    patchRect?: TileRect,
    note?: string,
  ) => {
    if (target.session) {
      return mapManager.updateSessionDraft(target.session.sessionId, nextDoc, { patchRect, note });
    }
    if (target.presetId) {
      return mapManager.savePreset(nextDoc, { id: target.presetId });
    }
    return { ok: false as const, error: '没有可写入的草稿或预设目标。' };
  };

  try {
    let toolResult: unknown;
    switch (toolName) {
      case 'map_wait_next_task': {
        if (!auth.session) {
          toolResult = errResult('当前 MCP 连接未绑定工坊 Studio 会话，无法监听框选任务。');
          break;
        }
        const timeoutSec = Math.max(5, Math.min(45, Number(args.timeoutSec ?? 25) || 25));
        const task = await mapManager.waitForNextTask(auth.session.sessionId, timeoutSec * 1000, opts?.signal);
        if (!task) {
          toolResult = okText({
            hasTask: false,
            status: 'idle_timeout',
            message: '当前暂无待处理修改任务。请立即再次调用 map_wait_next_task 保持在线待命。',
          });
          break;
        }
        const curSession = mapManager.getSession(auth.session.sessionId);
        const doc = curSession?.doc ?? auth.session.doc;
        const boxesDetail = task.boxes.map((b, idx) => {
          const rx = Math.max(0, b.x - 1);
          const ry = Math.max(0, b.y - 1);
          const rw = Math.min(doc.width - rx, Math.min(48, b.w + 2));
          const rh = Math.min(doc.height - ry, Math.min(32, b.h + 2));
          const inspected = renderAsciiRegion(doc, { x: rx, y: ry, w: rw, h: rh });
          return {
            index: idx + 1,
            label: b.label,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            note: b.note ?? '',
            ascii: inspected.ascii,
            zones: inspected.zones,
            furnitureCount: inspected.furniture.length,
          };
        });
        toolResult = okText({
          hasTask: true,
          taskId: task.id,
          seq: task.seq,
          instruction: task.instruction ?? '',
          mapSize: { width: doc.width, height: doc.height },
          boxes: boxesDetail,
          workflowInstructions:
            '请按照 instruction 与每个区块的 note 调用地图工具完成修改（修改会实时渲染在用户画面上），全部完成后调用 map_complete_task({ taskId, summary })，然后再次调用 map_wait_next_task 等待下一次指令。',
        });
        break;
      }

      case 'map_complete_task': {
        if (!auth.session) {
          toolResult = errResult('当前连接未绑定 Studio 会话。');
          break;
        }
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : undefined;
        const summary = typeof args.summary === 'string' ? args.summary : undefined;
        const completed = mapManager.completeTask(auth.session.sessionId, taskId, summary);
        if (!completed.ok) {
          toolResult = errResult(completed.error);
          break;
        }
        const hasMoreQueued = mapManager.getTaskSummaries(auth.session.sessionId).some((t) => t.status === 'queued');
        toolResult = okText({
          ok: true,
          task: completed.task,
          hasMoreQueued,
          nextAction: hasMoreQueued
            ? '队列中还有下一个待改任务，请立即调用 map_wait_next_task 获取并执行。'
            : '已提交给用户在地图上预览确认（确认/恢复原样），请继续调用 map_wait_next_task 待命。',
        });
        break;
      }

      case 'map_list_tasks': {
        if (!auth.session) {
          toolResult = errResult('当前连接未绑定 Studio 会话。');
          break;
        }
        toolResult = okText({
          sessionId: auth.session.sessionId,
          presence: mapManager.getMcpPresence(auth.session.sessionId),
          tasks: mapManager.getTaskSummaries(auth.session.sessionId),
        });
        break;
      }

      case 'map_get_context': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const report = validateMapPlayability(t.doc);
        toolResult = okText({
          scope: auth.role,
          sessionId: t.session?.sessionId ?? null,
          presetId: t.presetId,
          rev: t.session?.rev ?? mapManager.getRev(),
          activeOfficeMode: mapManager.getMode(),
          name: t.doc.name,
          width: t.doc.width,
          height: t.doc.height,
          zones: t.doc.zones,
          selection: t.session?.selection ?? null,
          draftBoxes: t.session?.draftBoxes ?? [],
          draftInstruction: t.session?.draftInstruction ?? '',
          queuedTasks: t.session ? mapManager.getTaskSummaries(t.session.sessionId).filter((tk) => tk.status === 'queued' || tk.status === 'running') : [],
          validation: report,
        });
        break;
      }

      case 'map_get_selection': {
        const sess = auth.session;
        if (!sess) {
          toolResult = errResult('当前连接未绑定地图工坊 Studio 会话（需要使用 ws_ 开头的工坊令牌）。');
          break;
        }
        const margin = Math.max(0, Math.min(8, Math.floor(Number(args.margin ?? 2))));
        const draftBoxes = sess.draftBoxes ?? [];
        const sel = sess.selection;
        if (!sel && draftBoxes.length === 0) {
          toolResult = okText({ selection: null, draftBoxes: [], message: '用户在工坊画布中尚未框选任何区域。' });
          break;
        }
        const primaryRect = sel ?? {
          x: draftBoxes[0].x,
          y: draftBoxes[0].y,
          w: draftBoxes[0].w,
          h: draftBoxes[0].h,
          ...(draftBoxes[0].note ? { note: draftBoxes[0].note } : {}),
          updatedAt: Date.now(),
        };
        const rx = Math.max(0, primaryRect.x - margin);
        const ry = Math.max(0, primaryRect.y - margin);
        const rw = Math.min(sess.doc.width - rx, primaryRect.w + margin * 2);
        const rh = Math.min(sess.doc.height - ry, primaryRect.h + margin * 2);
        const inspected = renderAsciiRegion(sess.doc, { x: rx, y: ry, w: rw, h: rh });
        const boxesDetail = draftBoxes.map((b, idx) => {
          const bx = Math.max(0, b.x - margin);
          const by = Math.max(0, b.y - margin);
          const bw = Math.min(sess.doc.width - bx, Math.min(48, b.w + margin * 2));
          const bh = Math.min(sess.doc.height - by, Math.min(32, b.h + margin * 2));
          const snap = renderAsciiRegion(sess.doc, { x: bx, y: by, w: bw, h: bh });
          return {
            index: idx + 1,
            id: b.id,
            label: b.label,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            note: b.note ?? '',
            ascii: snap.ascii,
            zones: snap.zones,
            furnitureCount: snap.furniture.length,
          };
        });
        toolResult = okText({
          selection: primaryRect,
          draftInstruction: sess.draftInstruction ?? '',
          draftBoxes: boxesDetail,
          inspectedRect: { x: rx, y: ry, w: rw, h: rh },
          ascii: inspected.ascii,
          legend: inspected.legend,
          furniture: inspected.furniture,
          wallItems: inspected.wallItems,
          walls: inspected.walls,
          spawns: inspected.spawns,
          zones: inspected.zones,
        });
        break;
      }

      case 'map_inspect_region': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const inspected = renderAsciiRegion(t.doc, {
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          w: Number(args.w ?? 32),
          h: Number(args.h ?? 24),
        });
        toolResult = okText(inspected);
        break;
      }

      case 'map_clear_region': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const rect: TileRect = {
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          w: Number(args.w ?? 1),
          h: Number(args.h ?? 1),
        };
        const res = opClearRegion(t.doc, rect, typeof args.fillFloor === 'string' ? (args.fillFloor as FloorKind) : undefined);
        const saved = commitDoc(t, res.doc, res.patchRect, 'map_clear_region');
        toolResult = saved.ok
          ? okText({ ok: true, removedCount: res.removedCount, patchRect: res.patchRect })
          : errResult(saved.error);
        break;
      }

      case 'map_paint_tiles': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const ops = Array.isArray(args.ops) ? args.ops : [];
        const res = opPaintTiles(
          t.doc,
          ops as Array<{ x: number; y: number; w?: number; h?: number; floor: FloorKind; tint?: string; tint2?: string }>,
        );
        const saved = commitDoc(t, res.doc, res.patchRect, 'map_paint_tiles');
        toolResult = saved.ok ? okText({ ok: true, patchRect: res.patchRect }) : errResult(saved.error);
        break;
      }

      case 'map_build_room': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const res = opBuildRoom(t.doc, {
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          w: Number(args.w ?? 12),
          h: Number(args.h ?? 10),
          name: typeof args.name === 'string' ? args.name : undefined,
          zoneKind: typeof args.zoneKind === 'string' ? (args.zoneKind as AreaKind) : undefined,
          floorKind: typeof args.floorKind === 'string' ? (args.floorKind as FloorKind) : undefined,
          doors: Array.isArray(args.doors) ? (args.doors as Array<{ side: 'north' | 'south'; offset: number; w: number }>) : undefined,
          clearInside: typeof args.clearInside === 'boolean' ? args.clearInside : true,
        });
        const saved = commitDoc(t, res.doc, res.patchRect, 'map_build_room');
        toolResult = saved.ok ? okText({ ok: true, zone: res.zone, patchRect: res.patchRect }) : errResult(saved.error);
        break;
      }

      case 'map_place_workstations': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const facing = (['up', 'down', 'left', 'right'].includes(String(args.facing)) ? String(args.facing) : 'up') as Dir;
        const res = opPlaceWorkstations(t.doc, {
          x: Number(args.x ?? 0),
          y: Number(args.y ?? 0),
          count: Number(args.count ?? 4),
          facing,
          layout: args.layout === 'island' ? 'island' : 'row',
          cols: typeof args.cols === 'number' ? args.cols : undefined,
          deskVariant: typeof args.deskVariant === 'string' ? args.deskVariant : undefined,
          chairVariant: typeof args.chairVariant === 'string' ? args.chairVariant : undefined,
        });
        const saved = commitDoc(t, res.doc, res.patchRect, 'map_place_workstations');
        toolResult = saved.ok
          ? okText({ ok: true, placed: res.placed, patchRect: res.patchRect })
          : errResult(saved.error);
        break;
      }

      case 'map_populate_zone': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const preset = String(args.preset ?? 'office') as 'office' | 'lounge' | 'cafe' | 'restroom' | 'reception' | 'arena';
        const res = opPopulateZonePreset(t.doc, {
          rect: {
            x: Number(args.x ?? 0),
            y: Number(args.y ?? 0),
            w: Number(args.w ?? 14),
            h: Number(args.h ?? 10),
          },
          preset,
          name: typeof args.name === 'string' ? args.name : undefined,
        });
        const saved = commitDoc(t, res.doc, res.patchRect, 'map_populate_zone');
        toolResult = saved.ok ? okText({ ok: true, zone: res.zone, patchRect: res.patchRect }) : errResult(saved.error);
        break;
      }

      case 'map_mutate_items': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const res = opMutateItems(t.doc, {
          removeIds: Array.isArray(args.removeIds) ? args.removeIds.map(String) : undefined,
          addFurniture: Array.isArray(args.addFurniture) ? (args.addFurniture as Array<{ kind: FurnitureKind; tx: number; ty: number }>) : undefined,
          addWallItems: Array.isArray(args.addWallItems) ? (args.addWallItems as Array<{ kind: FurnitureKind; tx: number; ty: number; on: 'face' | 'south' }>) : undefined,
          addRugs: Array.isArray(args.addRugs) ? (args.addRugs as Array<{ x: number; y: number; w: number; h: number; color: string }>) : undefined,
          addSpawns: Array.isArray(args.addSpawns) ? (args.addSpawns as Array<{ tx: number; ty: number }>) : undefined,
          upsertZones: Array.isArray(args.upsertZones) ? (args.upsertZones as CustomZone[]) : undefined,
        });
        const saved = commitDoc(t, res.doc, res.patchRect, 'map_mutate_items');
        toolResult = saved.ok ? okText({ ok: true, patchRect: res.patchRect }) : errResult(saved.error);
        break;
      }

      case 'map_resize': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        const resized = mapManager.resizeDoc(t.doc, Number(args.width ?? t.doc.width), Number(args.height ?? t.doc.height));
        const saved = commitDoc(t, resized, { x: 0, y: 0, w: resized.width, h: resized.height }, 'map_resize');
        toolResult = saved.ok
          ? okText({ ok: true, width: resized.width, height: resized.height })
          : errResult(saved.error);
        break;
      }

      case 'map_undo': {
        if (!auth.session) {
          toolResult = errResult('仅 Studio 草稿模式支持撤销。');
          break;
        }
        const res = mapManager.undoSession(auth.session.sessionId);
        toolResult = res.ok ? okText({ ok: true, rev: res.rev, validation: res.summary }) : errResult(res.error);
        break;
      }

      case 'map_redo': {
        if (!auth.session) {
          toolResult = errResult('仅 Studio 草稿模式支持重做。');
          break;
        }
        const res = mapManager.redoSession(auth.session.sessionId);
        toolResult = res.ok ? okText({ ok: true, rev: res.rev, validation: res.summary }) : errResult(res.error);
        break;
      }

      case 'map_validate': {
        const t = resolveTargetDoc(args.mapId);
        if ('error' in t) {
          toolResult = errResult(t.error);
          break;
        }
        toolResult = okText(validateMapPlayability(t.doc));
        break;
      }

      case 'map_publish_and_activate': {
        if (auth.role !== 'admin') {
          toolResult = errResult('权限不足：切换全员线上地图仅限系统管理员（需使用管理员密钥），工坊用户请导出 JSON 发送给管理员。');
          break;
        }
        const mode = args.mode === 'custom' ? 'custom' : 'auto';
        if (mode === 'auto') {
          const act = mapManager.activate({ mode: 'auto' });
          toolResult = act.ok ? okText({ ok: true, mode: 'auto', rev: act.rev }) : errResult(act.error);
          break;
        }
        let targetId = typeof args.mapId === 'string' && args.mapId.trim() ? args.mapId.trim() : undefined;
        const fromSid = typeof args.fromSessionId === 'string' && args.fromSessionId.trim()
          ? args.fromSessionId.trim()
          : auth.session?.sessionId;
        if (fromSid) {
          const s = mapManager.getSession(fromSid);
          if (!s) {
            toolResult = errResult(`Studio 会话 ${fromSid} 不存在。`);
            break;
          }
          const saved = mapManager.savePreset(s.doc, {
            ...(targetId ? { id: targetId } : {}),
            ...(typeof args.name === 'string' ? { name: args.name } : {}),
          });
          if (!saved.ok) {
            toolResult = errResult(saved.error);
            break;
          }
          targetId = saved.summary.id;
        }
        const act = mapManager.activate({ mode: 'custom', mapId: targetId });
        toolResult = act.ok
          ? okText({ ok: true, mode: act.mode, activeMapId: act.activeMapId, rev: act.rev })
          : errResult(act.error);
        break;
      }

      default:
        toolResult = errResult(`未知工具: ${toolName}`);
        break;
    }

    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: errResult(message),
      },
    };
  }
}

export function renderMapMcpScript(defaultBaseUrl: string): string {
  const safeBase = JSON.stringify(defaultBaseUrl);
  return `#!/usr/bin/env node
// Agent Party 地图工坊 MCP Bridge & 零重启直连客户端（零外部依赖）
import readline from 'node:readline';

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const rawUrl = (readArg('--url') || process.env.AGENT_PARTY_URL || ${safeBase}).replace(/\\/+$/, '');
const pathMatch = /^(https?:\\/\\/[^/]+)\\/api\\/mcp\\/(ws_[A-Za-z0-9_-]+)$/.exec(rawUrl);
const baseOrigin = pathMatch ? pathMatch[1] : rawUrl.replace(/\\/api\\/mcp$/, '');
const token = (readArg('--token') || process.env.AGENT_PARTY_TOKEN || (pathMatch ? pathMatch[2] : '')).trim();
const mcpEndpoint = token && token.startsWith('ws_') ? \`\${baseOrigin}/api/mcp/\${token}\` : \`\${baseOrigin}/api/mcp\`;

async function sendHeartbeat() {
  if (!token || !token.startsWith('ws_')) return;
  try {
    await fetch(\`\${baseOrigin}/api/map/studio/heartbeat\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Bearer \${token}\`,
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
      ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(\`HTTP \${res.status}: \${text}\`);
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
          process.stdout.write(\`\${text}\\n\`);
          clearInterval(hbTimer);
          process.exit(0);
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  clearInterval(hbTimer);
  process.stdout.write(JSON.stringify({ hasTask: false, status: 'wait_deadline_reached' }) + '\\n');
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
    console.error(\`Invalid JSON arguments: \${err instanceof Error ? err.message : String(err)}\`);
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
    process.stdout.write(\`\${text}\\n\`);
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
        ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
      },
      body: trimmed,
    });
    if (res.status === 204) return;
    const text = await res.text();
    if (text.trim()) process.stdout.write(\`\${text.trim()}\\n\`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: parsedId, error: { code: -32000, message: msg } }) + '\\n');
  }
});
`;
}

export function renderMapStudioSetupMarkdown(baseUrl: string, session: StudioSession): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const mcpUrl = `${cleanBase}/api/mcp/${session.studioToken}`;
  const scriptUrl = `${cleanBase}/client-scripts/map-mcp.mjs`;
  return `# Agent Party 地图工坊 — AI MCP 专属自动接入与协同协议

> 这是一份给 **AI 编程助手 / Agent**（Claude Code、Codex、Antigravity、Cursor、Windsurf、Trae、OpenCode 等）直接读取并执行的配置与实时协同协议。
> 该会话与你的 **个人专属隔离令牌** 绑定，**严格隔离，绝不会串给其他用户的 AI**。

## 1. 专属连接参数

- **服务端地址**：\`${cleanBase}\`
- **专属 MCP 接口 URL（Streamable HTTP）**：\`${mcpUrl}\`
- **专属隔离会话 ID**：\`${session.sessionId}\`
- **专属隔离令牌**：\`${session.studioToken}\`
- **本地桥接与直连脚本**：\`${scriptUrl}\`

---

## 2. 【立刻执行】下载脚本并写入 MCP 配置

1. 先获取用户真实主目录 \`ABS_HOME\`（Windows 下路径使用正斜杠 \`/\`，如 \`C:/Users/Alice\`；**严禁在 JSON 中写 \`~\`**）。
2. 创建目录并下载 \`map-mcp.mjs\`（零外部依赖）：
\`\`\`bash
curl -sL "${scriptUrl}" -o "<ABS_HOME>/.agent-party/map-mcp.mjs"
\`\`\`
3. 按你当前运行的工具，将下方 **\`agent-party-map\`** 服务合并写入 MCP 配置文件（保留用户原有配置）：
   - **Claude Code**：\`<ABS_HOME>/.claude.json\` 或项目 \`.mcp.json\`
   - **Cursor**：\`<ABS_HOME>/.cursor/mcp.json\`
   - **Antigravity / Gemini**：\`<ABS_HOME>/.gemini/antigravity/mcp_config.json\`
   - **Windsurf**：\`<ABS_HOME>/.codeium/windsurf/mcp_config.json\`
   - **Codex CLI**：\`<ABS_HOME>/.codex/config.toml\`（\`[mcp_servers.agent-party-map]\`）

**JSON 配置内容：**
\`\`\`json
{
  "mcpServers": {
    "agent-party-map": {
      "url": "${mcpUrl}",
      "command": "node",
      "args": ["<ABS_HOME>/.agent-party/map-mcp.mjs", "--url", "${mcpUrl}"]
    }
  }
}
\`\`\`
*(注意：若客户端只支持 \`url\` 或只支持 \`command\`+\`args\`，保留对应字段即可；\`${mcpUrl}\` 已内置专属令牌，无需额外 Header)*

---

## 3. 【开始使用】两种启动方式

- **方式 A · 连接后直接在对话框粘贴启动提示词（推荐，无需挂起等待）**：
  连接好上方 \`agent-party-map\` 后，直接在你与 AI 的聊天框发送：
  > 我已在 Agent Party 地图工坊完成框选（会话 \`${session.sessionId}\`），请调用 \`agent-party-map\` MCP 的 \`map_get_selection\` 查看我的所有框选与备注要求，然后直接调用地图工具修改画布！
- **方式 B · 后台自动接单监听（网页一键连续派单）**：
  在对话里让 AI 调用 \`map_wait_next_task\`，或直接运行终端脚本：
  \`\`\`bash
  node "<ABS_HOME>/.agent-party/map-mcp.mjs" --wait --url "${mcpUrl}"
  \`\`\`
  运行后网页端状态栏会**立刻变绿显示「🟢 MCP 已连接 · AI 自动接单待命中」**，用户随时在地图上连续框选多个区块并点击发送，该命令会毫秒级唤醒并返回 JSON 任务！

---

## 4. 收到任务后的修改与提交规范

无论通过原生 MCP 工具，还是通过 CLI \`node "<ABS_HOME>/.agent-party/map-mcp.mjs" --call <工具名> '<JSON参数>' --url "${mcpUrl}"\` 调用，流程均一致：

1. **看懂任务 JSON**：包含 \`taskId\`、\`instruction\`、以及 \`boxes\` 数组（每个框包含 \`x, y, w, h, note, ascii, zones\`）。
2. **常用高频工具**：
   - \`map_build_room\`：\`{"x":10,"y":10,"w":14,"h":12,"name":"AI 研发区","zoneKind":"room"}\`（zoneKind 可选 \`room|lounge|cafe|restroom|reception|arena\`）
   - \`map_place_workstations\`：\`{"x":12,"y":13,"count":6,"facing":"right","layout":"island","cols":3}\`（\`facing\` 支持四向 \`up|down|left|right\`；\`layout\` 支持 \`row|island\` 面对面工位岛）
   - \`map_populate_zone\`：\`{"x":30,"y":10,"w":14,"h":10,"preset":"lounge","name":"休闲吧"}\`（preset: \`office|lounge|cafe|restroom|reception|arena\`）
   - \`map_paint_tiles\` / \`map_clear_region\` / \`map_mutate_items\` / \`map_inspect_region\` / \`map_resize\`（最大 \`512×512\`）/ \`map_validate\`
3. **提交审核**：全部区块改完后（每次工具调用都会实时渲染到用户的地图画布上），务必调用：
   - \`map_complete_task\`：\`{"taskId":"<taskId>","summary":"已完成：..."}\`
   网页会立刻提示用户 **「✅ 确认修改」** 或 **「↩️ 恢复原样」**。
4. **继续待命**：提交完成后立刻重新运行 \`map_wait_next_task\`（或 \`--wait\`），无缝接收队列中的下一项或用户的下一次框选。
`;
}
