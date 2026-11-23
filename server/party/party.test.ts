import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Appearance, ArtModule, RoomTheme } from '../../client/src/art/api';
import { getLocale, setLocale, tr } from '../../shared/i18n';
import { DEFAULT_WORLD_OPTIONS } from '../../client/src/world/api';
import type { SpotDef } from '../../client/src/world/layout/types';
import { chooseSeat, lacksBackView } from '../../client/src/world/sim/behavior';
import { canEditCharacter } from '../../client/src/ui/character-model';
import { pmdAnimForPose, resolveCodexFrame } from '../../client/src/world/render/pet-sprites';
import { Sim } from '../../client/src/world/sim/sim';
import { parseBoundary, parseMultipart } from './multipart';
import { normalizeCodexSpec, PetRegistry, readSpriteDimensions, sanitizePetId } from './pets';
import { findPokemon, parseAnimDataXml, searchPokemon } from './pokemon';
import { DEFAULT_RECEPTION_SIGN, formatCompanionName, normalizePublicUrl, PartyStore } from './store';
import { renderReportScript, renderWatchScript } from './client-scripts';
import { renderSetupMarkdown } from './setup-page';
import { WorldSync } from './world-sync';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-party-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

const stubArt = {
  appearanceFromSeed: () =>
    ({
      skin: '#f0c8a0',
      hair: '#3a2a20',
      hairStyle: 'short',
      eyes: '#222222',
      top: '#3f7fd8',
      topAccent: '#ffffff',
      topStyle: 'tshirt',
      bottom: '#333333',
      shoes: '#111111',
      accessory: 'none',
      accessoryColor: '#000000',
      lanyard: null,
      look: 'm',
    }) satisfies Appearance,
  roomTheme: () =>
    ({
      carpet: '#4f6d8f',
      carpet2: '#486685',
      wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
      accent: '#3f7fd8',
      deskVariant: 'wood',
      chairVariant: 'black',
    }) satisfies RoomTheme,
} as unknown as ArtModule;

describe('multipart parser', () => {
  it('parses text fields and preserves exact binary buffers', () => {
    const boundary = '----TestBoundary123';
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="petId"\r\n\r\npikachu\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sprite"; filename="spritesheet.png"\r\nContent-Type: image/png\r\n\r\n`),
      pngBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    expect(parseBoundary(`multipart/form-data; boundary=${boundary}`)).toBe(boundary);
    const parsed = parseMultipart(body, boundary);
    expect(parsed.fields.petId).toBe('pikachu');
    expect(parsed.files.sprite?.filename).toBe('spritesheet.png');
    expect(Buffer.compare(parsed.files.sprite!.data, pngBytes)).toBe(0);
  });
});

describe('Codex V2 PetRegistry & Pokémon lookup', () => {
  it('rejects path traversal and normalizes minimal pet.json', () => {
    expect(sanitizePetId('../evil')).toBeNull();
    expect(sanitizePetId('My_Pet-01')).toBe('my_pet-01');
    expect(sanitizePetId('pmd:0025')).toBe('pmd:0025');

    const spec = normalizeCodexSpec({ id: 'psyduck-2d-v2' });
    expect(spec.frameWidth).toBe(192);
    expect(spec.frameHeight).toBe(208);
    expect(spec.gridColumns).toBe(8);
    expect(spec.gridRows).toBe(11);
    expect(spec.states?.idle?.row).toBe(0);

    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
    const saved = pets.saveUploadedPet({
      petId: 'test-pet',
      displayName: '测试宠',
      spriteBuffer: fakePng,
    });
    expect(saved.id).toBe('test-pet');
    expect(pets.listPets().map((p) => p.id)).toContain('test-pet');
  });

  it('loads only bundled default pets (dafeiyu, psyduck-3d & snorlax) when AUTO_IMPORT_CODEX_PETS is unset', () => {
    const prevEnv = process.env.AUTO_IMPORT_CODEX_PETS;
    delete process.env.AUTO_IMPORT_CODEX_PETS;
    try {
      const dir = makeTempDir();
      const defaultPetsDir = join(process.cwd(), 'assets', 'default-pets');
      const pets = new PetRegistry(dir, undefined, null, defaultPetsDir);
      const list = pets.listPets();
      expect(list.map((p) => p.id).sort()).toEqual(['dafeiyu', 'psyduck-3d', 'snorlax']);
      const byId = new Map(list.map((p) => [p.id, p]));
      expect(byId.get('dafeiyu')?.source).toBe('builtin');
      expect(byId.get('dafeiyu')?.hasBackView).toBe(true);
      expect(byId.get('psyduck-3d')?.source).toBe('builtin');
      expect(byId.get('psyduck-3d')?.hasBackView).toBe(false);
      expect(byId.get('snorlax')?.source).toBe('builtin');
      expect(byId.get('snorlax')?.hasBackView).toBe(true);
    } finally {
      if (prevEnv === undefined) delete process.env.AUTO_IMPORT_CODEX_PETS;
      else process.env.AUTO_IMPORT_CODEX_PETS = prevEnv;
    }
  });

  it('finds Pokémon by Chinese, English, and Dex ID and parses AnimData.xml', () => {
    expect(findPokemon('皮卡丘')?.dex).toBe('0025');
    expect(findPokemon('#94')?.en).toBe('Gengar');
    expect(findPokemon('Lucario')?.dex).toBe('0448');
    expect(searchPokemon('').length).toBe(12);

    const xml = `<AnimData><Anims>
      <Anim><Name>Walk</Name><FrameWidth>32</FrameWidth><FrameHeight>40</FrameHeight><Durations><Duration>8</Duration><Duration>10</Duration></Durations></Anim>
      <Anim><Name>Hop</Name><CopyOf>Walk</CopyOf></Anim>
    </Anims></AnimData>`;
    const parsed = parseAnimDataXml(xml);
    expect(parsed.Walk.frameWidth).toBe(32);
    expect(parsed.Walk.durations.length).toBe(2);
    expect(parsed.Hop.frameHeight).toBe(40);
  });
});

describe('PartyStore privacy, multi-session aggregation, timeouts & admin', () => {
  it('strips task/prompt fields and aggregates multi-session statuses & agentTool', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const store = new PartyStore({ dataDir: dir, workingTimeoutMs: 10_000, offlineTimeoutMs: 60_000, pets });

    const t0 = 1_700_000_000_000;
    // Session A starts working in Codex (passing private task text which MUST be ignored)
    const r1 = store.report(
      {
        id: 'alice',
        name: 'Alice',
        role: '后端',
        status: 'working',
        agentTool: 'Codex',
        sessionId: 'sess-a',
        task: 'SECRET PROMPT /etc/passwd',
      } as unknown as Parameters<PartyStore['report']>[0],
      t0,
    );
    expect(r1.ok).toBe(true);

    let snap = store.toSnapshot(t0);
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0].status).toBe('working');
    expect(snap.agents[0].agentTool).toBe('Codex');
    expect(JSON.stringify(snap)).not.toContain('SECRET PROMPT');
    expect(JSON.stringify(snap)).not.toContain('/etc/passwd');

    // Switching to Session B (idle in Antigravity) MUST NOT cancel Session A's working status
    store.report({ id: 'alice', status: 'idle', agentTool: 'Antigravity', sessionId: 'sess-b' }, t0 + 1000);
    snap = store.toSnapshot(t0 + 1000);
    expect(snap.agents[0].status).toBe('working');
    expect(snap.agents[0].agentTool).toBe('Codex');

    // Ending Session A falls back cleanly to Session B's idle & Antigravity badge
    store.report({ id: 'alice', status: 'session-end', sessionId: 'sess-a' }, t0 + 2000);
    snap = store.toSnapshot(t0 + 2000);
    expect(snap.agents[0].status).toBe('idle');
    expect(snap.agents[0].agentTool).toBe('Antigravity');

    // Timeout sweeper transitions stale working -> idle and long-inactive -> offline
    store.report({ id: 'bob', name: 'Bob', status: 'working', sessionId: 'b1' }, t0);
    store.sweep(t0 + 15_000);
    expect(store.toSnapshot(t0 + 15_000).agents.find((a) => a.id === 'bob')?.status).toBe('idle');
    store.sweep(t0 + 70_000);
    expect(store.toSnapshot(t0 + 70_000).agents.find((a) => a.id === 'bob')).toBeUndefined();
  });

  it('supports admin kick, ban (blocks subsequent report with 403), unban, and NPC CRUD', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
    pets.saveUploadedPet({ petId: 'lucario', spriteBuffer: fakePng });

    const store = new PartyStore({ dataDir: dir, pets });
    store.report({ id: 'troll', name: 'Troll', status: 'working' });
    expect(store.onlineCount()).toBe(1);

    // Kick
    expect(store.kickMember('troll')).toBe(true);
    expect(store.onlineCount()).toBe(0);

    // Re-report then Ban
    store.report({ id: 'troll', name: 'Troll', status: 'working' });
    store.banMember('troll', '恶意刷屏');
    expect(store.onlineCount()).toBe(0);
    const blocked = store.report({ id: 'troll', status: 'working' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.statusCode).toBe(403);

    // Unban
    expect(store.unbanMember('troll')).toBe(true);
    expect(store.report({ id: 'troll', status: 'idle' }).ok).toBe(true);
    store.kickMember('troll');

    // Create human NPC and Codex V2 pet NPC
    const npcHuman = store.createNpc({ name: '路人甲', avatarMode: 'human', npcAuto: true });
    const npcPet = store.createNpc({ name: '路卡', avatarMode: 'pet', petId: 'lucario', status: 'idle', npcAuto: false });
    expect(npcHuman.ok && npcPet.ok).toBe(true);
    expect(store.onlineCount()).toBe(2);

    // NPCs never time out even far in the future
    store.sweep(Date.now() + 100 * 86_400_000);
    expect(store.onlineCount()).toBe(2);

    if (npcPet.ok) {
      const snapPet = store.toSnapshot().agents.find((a) => a.id === npcPet.npc.id);
      expect(snapPet?.pet?.id).toBe('lucario');
      expect(store.deleteNpc(npcPet.npc.id)).toBe(true);
    }
    expect(store.onlineCount()).toBe(1);
  });
});

describe('WorldSync authoritative Sim & client mirror sync', () => {
  it('syncs identical character positions and poses across multiple viewer Sims', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const store = new PartyStore({ dataDir: dir, pets });
    store.report({ id: 'u1', name: 'U1', status: 'working', agentTool: 'Codex' });
    store.report({ id: 'u2', name: 'U2', status: 'idle', agentTool: 'Antigravity' });

    const snap = store.toSnapshot();
    const ws = new WorldSync(snap);
    let frame = ws.getFrame();
    for (let i = 0; i < 40; i++) {
      frame = ws.step(Date.now() + (i + 1) * 100);
    }

    // Two independent viewer client Sims apply the same snapshot + WorldSyncFrame
    const viewerA = new Sim(stubArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null, { synced: true });
    const viewerB = new Sim(stubArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null, { synced: true });

    const nowA = Date.now();
    const nowB = nowA + 5000; // even with 5s local clock skew!
    viewerA.applySnapshot(snap, nowA);
    viewerA.applyWorldFrame(frame, nowA);
    viewerB.applySnapshot(snap, nowB);
    viewerB.applyWorldFrame(frame, nowB);

    const a1 = viewerA.chars.get('u1')!;
    const b1 = viewerB.chars.get('u1')!;
    expect(a1.x).toBe(b1.x);
    expect(a1.y).toBe(b1.y);
    expect(a1.pose).toBe(b1.pose);
    expect(a1.dir).toBe(b1.dir);

    const a2 = viewerA.chars.get('u2')!;
    const b2 = viewerB.chars.get('u2')!;
    expect(a2.x).toBe(b2.x);
    expect(a2.y).toBe(b2.y);
    expect(a2.pose).toBe(b2.pose);
  });
});

describe('Codex V2 & PMD directional sprite resolution', () => {
  const defaultStates = {
    idle: { row: 0, columns: 6, frameDuration: 800 },
    'running-right': { row: 1, columns: 8, frameDuration: 130 },
    'running-left': { row: 2, columns: 8, frameDuration: 130 },
    jumping: { row: 4, columns: 5, frameDuration: 150 },
    running: { row: 7, columns: 6, frameDuration: 130 },
    look_directions_1_8: { row: 9, columns: 8, frameDuration: 200 },
    look_directions_9_16: { row: 10, columns: 8, frameDuration: 200 },
  };

  it('uses rows 9 & 10 for back-facing desks, vertical walks, and side views on 11-row sheets', () => {
    expect(
      resolveCodexFrame({
        pose: 'type',
        dir: 'up',
        mode: 'work',
        animT: 0,
        lastHorizDir: 'right',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }),
    ).toEqual({ row: 9, col: 0, flipX: false, offsetY: 0 });

    expect(
      resolveCodexFrame({
        pose: 'sit',
        dir: 'up',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'right',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }),
    ).toEqual({ row: 9, col: 0, flipX: false, offsetY: 0 });

    // Upward walk cycles cleanly across back-facing gaze frames
    expect(
      [0, 140, 280, 420].map((animT) =>
        resolveCodexFrame({
          pose: 'walk',
          dir: 'up',
          mode: 'idle',
          animT,
          lastHorizDir: 'right',
          states: defaultStates,
          actualRows: 11,
          actualCols: 8,
        }),
      ),
    ).toEqual([
      { row: 9, col: 0, flipX: false, offsetY: 0 },
      { row: 10, col: 7, flipX: false, offsetY: -1.5 },
      { row: 9, col: 0, flipX: false, offsetY: 0 },
      { row: 10, col: 7, flipX: true, offsetY: -1.5 },
    ]);

    // Downward walk cycles cleanly across front-facing gaze frames
    expect(
      [0, 140, 280, 420].map((animT) =>
        resolveCodexFrame({
          pose: 'walk',
          dir: 'down',
          mode: 'idle',
          animT,
          lastHorizDir: 'right',
          states: defaultStates,
          actualRows: 11,
          actualCols: 8,
        }),
      ),
    ).toEqual([
      { row: 10, col: 0, flipX: false, offsetY: 0 },
      { row: 10, col: 1, flipX: false, offsetY: -1.5 },
      { row: 10, col: 0, flipX: false, offsetY: 0 },
      { row: 9, col: 7, flipX: false, offsetY: -1.5 },
    ]);

    // Stationary/playing sideways uses 90E and 270W gaze columns
    expect(
      resolveCodexFrame({
        pose: 'play',
        dir: 'right',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'right',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }),
    ).toEqual({ row: 9, col: 4, flipX: false, offsetY: 0 });
    expect(
      resolveCodexFrame({
        pose: 'sit',
        dir: 'left',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'left',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }),
    ).toEqual({ row: 10, col: 4, flipX: false, offsetY: 0 });

    // Horizontal walk & front-facing desk keep standard animated rows
    expect(
      resolveCodexFrame({
        pose: 'walk',
        dir: 'right',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'right',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }).row,
    ).toBe(1);
    expect(
      resolveCodexFrame({
        pose: 'walk',
        dir: 'left',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'left',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }).row,
    ).toBe(2);
    expect(
      resolveCodexFrame({
        pose: 'type',
        dir: 'down',
        mode: 'work',
        animT: 0,
        lastHorizDir: 'right',
        states: defaultStates,
        actualRows: 11,
        actualCols: 8,
      }).row,
    ).toBe(7);
  });

  it('keeps 9-row sheets safely in bounds and falls back to multi-dir PMD sheets when dir !== down', () => {
    const nineRow = resolveCodexFrame({
      pose: 'type',
      dir: 'up',
      mode: 'work',
      animT: 0,
      lastHorizDir: 'right',
      states: defaultStates,
      actualRows: 9,
      actualCols: 8,
    });
    expect(nineRow.row).toBe(7);
    expect(nineRow.row).toBeLessThan(9);

    const pmd = {
      dex: '0025',
      walk: { url: '/walk.png', frameWidth: 32, frameHeight: 32, frames: 4, rows: 8, durations: [120] },
      idle: { url: '/idle.png', frameWidth: 32, frameHeight: 32, frames: 4, rows: 8, durations: [200] },
      work: { url: '/work.png', frameWidth: 32, frameHeight: 32, frames: 4, rows: 1, durations: [120] },
    };
    expect(pmdAnimForPose(pmd, 'type', 'work', 'down').url).toBe('/work.png');
    expect(pmdAnimForPose(pmd, 'type', 'work', 'up').url).toBe('/idle.png');
  });

  it('detects PNG and WebP (VP8X/VP8L/VP8) dimensions and restricts no-back-view pets from up-facing seats', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(1536, 16);
    png.writeUInt32BE(2288, 20);
    expect(readSpriteDimensions(png)).toEqual({ width: 1536, height: 2288 });

    const vp8x = Buffer.alloc(30);
    vp8x.write('RIFF', 0, 'ascii');
    vp8x.write('WEBPVP8X', 8, 'ascii');
    vp8x.writeUIntLE(1536 - 1, 24, 3);
    vp8x.writeUIntLE(1872 - 1, 27, 3);
    expect(readSpriteDimensions(vp8x)).toEqual({ width: 1536, height: 1872 });

    const vp8l = Buffer.alloc(30);
    vp8l.write('RIFF', 0, 'ascii');
    vp8l.write('WEBPVP8L', 8, 'ascii');
    vp8l[20] = 0x2f;
    vp8l.writeUInt32LE((1535 & 0x3fff) | ((1871 & 0x3fff) << 14), 21);
    expect(readSpriteDimensions(vp8l)).toEqual({ width: 1536, height: 1872 });

    const vp8 = Buffer.alloc(30);
    vp8.write('RIFF', 0, 'ascii');
    vp8.write('WEBPVP8 ', 8, 'ascii');
    vp8[23] = 0x9d;
    vp8[24] = 0x01;
    vp8[25] = 0x2a;
    vp8.writeUInt16LE(1536, 26);
    vp8.writeUInt16LE(2288, 28);
    expect(readSpriteDimensions(vp8)).toEqual({ width: 1536, height: 2288 });

    expect(lacksBackView({ id: 'psyduck-3d', spriteUrl: '/a.webp', hasBackView: false })).toBe(true);
    expect(lacksBackView({ id: 'snorlax', spriteUrl: '/b.webp', hasBackView: true })).toBe(false);

    const spots: SpotDef[] = [
      { id: 'desk-up', kind: 'desk', areaId: 'r1', tx: 1, ty: 2, x: 16, y: 32, dir: 'up', seated: true, rank: 1 },
      { id: 'desk-down', kind: 'desk', areaId: 'r1', tx: 2, ty: 1, x: 32, y: 16, dir: 'down', seated: true, rank: 2 },
      { id: 'stand-1', kind: 'stand', areaId: 'r1', tx: 3, ty: 3, x: 48, y: 48, dir: 'down', seated: false },
    ];
    expect(chooseSeat(spots, () => true, 'main', { noBackView: true })?.id).toBe('desk-down');
    expect(chooseSeat(spots, (id) => id !== 'desk-down', 'main', { noBackView: true })?.id).toBe('stand-1');
  });
});

describe('Site publicUrl persistence and i18n Chinese/English fallback', () => {
  it('validates, normalizes, and persists publicUrl across PartyStore reloads', () => {
    expect(normalizePublicUrl('  https://agent.example.com///  ')).toEqual({ ok: true, value: 'https://agent.example.com' });
    expect(normalizePublicUrl('https://example.com/party/')).toEqual({ ok: true, value: 'https://example.com/party' });
    expect(normalizePublicUrl('   ')).toEqual({ ok: true, value: undefined });
    expect(normalizePublicUrl('ftp://invalid.com').ok).toBe(false);
    expect(normalizePublicUrl('not-a-url').ok).toBe(false);

    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const s1 = new PartyStore({ dataDir: dir, pets });
    const setRes = s1.setPublicUrl('https://party.example.com/');
    expect(setRes).toEqual({ ok: true, publicUrl: 'https://party.example.com' });

    const s2 = new PartyStore({ dataDir: dir, pets });
    expect(s2.getPublicUrl()).toBe('https://party.example.com');
    expect(s2.getAdminState().settings.publicUrl).toBe('https://party.example.com');

    expect(s2.setPublicUrl('')).toEqual({ ok: true, publicUrl: null });
    const s3 = new PartyStore({ dataDir: dir, pets });
    expect(s3.getPublicUrl()).toBeUndefined();

    expect(s3.getReceptionSign()).toBe(DEFAULT_RECEPTION_SIGN);
    expect(s3.toSnapshot().meta.receptionSign).toBe(DEFAULT_RECEPTION_SIGN);
    expect(s3.setReceptionSign('  摸鱼研究所  ')).toEqual({ ok: true, receptionSign: '摸鱼研究所' });
    expect(s3.toSnapshot().meta.receptionSign).toBe('摸鱼研究所');

    const s4 = new PartyStore({ dataDir: dir, pets });
    expect(s4.getReceptionSign()).toBe('摸鱼研究所');
    expect(s4.getAdminState().settings.receptionSign).toBe('摸鱼研究所');
    expect(s4.setReceptionSign('')).toEqual({ ok: true, receptionSign: DEFAULT_RECEPTION_SIGN });
  });

  it('renders Chinese UI labels and falls back to English instead of Portuguese', () => {
    const prev = getLocale();
    try {
      setLocale('zh-CN');
      expect(tr('Atividade')).toBe('动态');
      expect(tr('Posso ver junto? 📺')).toBe('算我一个一起看！📺');
      // Key present in EN but missing in ZH must fall back to EN, never raw PT
      expect(tr('Descurtir')).toBe('Unlike');
    } finally {
      setLocale(prev);
    }
  });
});

describe('Companion pet onboarding & industrial setup scripts', () => {
  it('formats companion names and ties companion lifecycle to owner', () => {
    expect(formatCompanionName('张三', '皮卡丘 (Pikachu)')).toBe('张三的皮卡丘');
    expect(formatCompanionName('张三', '卡比兽 (Snorlax)', '小卡比')).toBe('张三的小卡比');
    expect(formatCompanionName('张三', undefined, '张三的伊布')).toBe('张三的伊布');

    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
    pets.saveUploadedPet({ petId: 'lucario', displayName: '路卡利欧 (Lucario)', spriteBuffer: fakePng });

    const store = new PartyStore({ dataDir: dir, pets });
    const res = store.report({
      id: 'alice',
      name: '张三',
      role: '后端',
      status: 'working',
      agentTool: 'Codex',
      companionPetId: 'lucario',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.member.avatarMode).toBe('human');
      expect(res.companion?.name).toBe('张三的路卡利欧');
      expect(res.companion?.avatarMode).toBe('pet');
      expect(res.companion?.ownerId).toBe('alice');
    }

    const snap = store.toSnapshot();
    expect(snap.agents).toHaveLength(2);
    expect(snap.agents.map((a) => a.name)).toContain('张三的路卡利欧');

    // Companion goes offline with owner
    store.report({ id: 'alice', status: 'offline' });
    expect(store.toSnapshot().agents).toHaveLength(0);

    // Owner returns -> companion revives
    store.report({ id: 'alice', status: 'idle' });
    expect(store.toSnapshot().agents).toHaveLength(2);

    // Kicking owner removes companion too
    expect(store.kickMember('alice')).toBe(true);
    expect(store.toSnapshot().agents).toHaveLength(0);
  });

  it('uses PMD sleep/eat animations cleanly when available', () => {
    const pmd = {
      dex: '0025',
      walk: { url: '/w.png', frameWidth: 32, frameHeight: 32, frames: 4, rows: 8, durations: [120] },
      idle: { url: '/i.png', frameWidth: 32, frameHeight: 32, frames: 4, rows: 8, durations: [200] },
      sleep: { url: '/s.png', frameWidth: 32, frameHeight: 32, frames: 2, rows: 1, durations: [400] },
      eat: { url: '/e.png', frameWidth: 32, frameHeight: 32, frames: 2, rows: 8, durations: [200] },
    };
    expect(pmdAnimForPose(pmd, 'sleep', 'idle', 'up').url).toBe('/s.png');
    expect(pmdAnimForPose(pmd, 'drink', 'idle', 'down').url).toBe('/e.png');
  });

  it('generates hardened setup protocol and client scripts without tilde traps or external factory deps', () => {
    const r = renderReportScript('https://party.example.com');
    const w = renderWatchScript('https://party.example.com');
    const md = renderSetupMarkdown('https://party.example.com');

    expect(r).toContain('--verify');
    expect(r).toContain('companionPetId');
    expect(w).toContain('watch.pid');
    expect(w).toContain('watchDirs');
    expect(w).toContain('RECENT_STARTUP_MS');
    expect(w).toContain('--discover');
    expect(w).toContain('--install-startup');
    expect(w).toContain('--uninstall-startup');
    expect(w).toContain('--status');
    expect(w).toContain('WorkBuddy');
    expect(w).toContain('豆包工作');
    expect(w).toContain('马维斯');
    expect(w).toContain('DeepSeek');
    expect(w).toContain('agent-party-watch.vbs');
    expect(md).toContain('ABS_HOME');
    expect(md).toContain('--verify');
    expect(md).toContain('--discover');
    expect(md).toContain('--install-startup');
    expect(md).toContain('WorkBuddy');
    expect(md).toContain('豆包工作');
    expect(md).toContain('马维斯');
    expect(md).toContain('DeepSeek');
    expect(md).toContain('companionPetId');
    expect(md).toContain('UserPromptSubmit');
    expect(md).toContain('beforeSubmitPrompt');
    expect(md).toContain('【推荐】选一只宝可梦');
    expect(md).toContain('ask_question');
    expect(md).not.toContain('内置全方向');
    expect(md).not.toContain('node "~/.agent-party/report.mjs"');
    expect(md).not.toContain('pokemon-pet-factory');
  });

  it('prefers the most recently seen session agentTool when multiple idle sessions exist', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const store = new PartyStore({ dataDir: dir, pets });

    const t0 = 1_700_000_000_000;
    store.report({ id: 'bbbliqi', name: 'bbbliqi', status: 'idle', agentTool: 'Codex', sessionId: 'watch:codex' }, t0);
    store.report({ id: 'bbbliqi', name: 'bbbliqi', status: 'idle', agentTool: 'Antigravity', sessionId: 'watch:antigravity' }, t0 + 5000);
    expect(store.toSnapshot(t0 + 5000).agents[0].agentTool).toBe('Antigravity');
    store.flush();

    const reloaded = new PartyStore({ dataDir: dir, pets });
    expect(reloaded.toSnapshot(t0 + 6000).agents[0].agentTool).toBe('Antigravity');
  });

  it('prevents /api/report from tampering with NPCs or companions and gates UI editing behind admin auth', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null);
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
    pets.saveUploadedPet({ petId: 'lucario', displayName: '路卡利欧', spriteBuffer: fakePng });

    const store = new PartyStore({ dataDir: dir, pets });
    const npc = store.createNpc({ name: '守门卡比', avatarMode: 'pet', petId: 'lucario' });
    expect(npc.ok).toBe(true);
    if (npc.ok) {
      const spoofNpc = store.report({ id: npc.npc.id, name: '黑客', status: 'working' });
      expect(spoofNpc.ok).toBe(false);
      if (!spoofNpc.ok) expect(spoofNpc.statusCode).toBe(403);
    }

    store.report({ id: 'u1', name: '小明', status: 'idle', companionPetId: 'lucario' });
    const spoofComp = store.report({ id: 'u1:pet', name: '篡改名', status: 'working' });
    expect(spoofComp.ok).toBe(false);
    if (!spoofComp.ok) expect(spoofComp.statusCode).toBe(403);

    const agentSample = { id: 'u1', kind: 'main' as const, status: 'working' as const };
    const baseGate = { live: true, terminal: true, local: true, replaying: false, mock: false };
    expect(canEditCharacter(agentSample, { ...baseGate, admin: false })).toBe(false);
    expect(canEditCharacter(agentSample, { ...baseGate, admin: true })).toBe(true);
  });
});
