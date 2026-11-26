import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Appearance, ArtModule, RoomTheme } from '../../client/src/art/api';
import { beijingHourBucket, beijingParts, isBeijingLunchTime, normalizeTimeHm } from '../../shared/beijing';
import { getLocale, setLocale, tr } from '../../shared/i18n';
import { DEFAULT_WORLD_OPTIONS, seasonalThemeFor } from '../../client/src/world/api';
import { effectiveHour } from '../../client/src/world/render/daylight';
import { groupRooms } from '../../client/src/ui/model';
import type { SpotDef } from '../../client/src/world/layout/types';
import { chooseSeat, lacksBackView } from '../../client/src/world/sim/behavior';
import { decodeAppearanceCode, encodeAppearanceCode } from '../../shared/appearance';
import { DUEL_COOLDOWN_MS, DUEL_DURATION_MS, isPokemonPet } from '../../client/src/world/sim/arena';
import { renderAdminHtml } from './admin-page';
import { renderCustomizeHtml } from './customize-page';
import { OfficeFeedTracker } from './feed';
import { slotAt } from '../../client/src/world/layout/geometry';
import { canEditCharacter } from '../../client/src/ui/character-model';
import { pmdAnimForPose, resolveCodexFrame } from '../../client/src/world/render/pet-sprites';
import { Sim } from '../../client/src/world/sim/sim';
import { parseBoundary, parseMultipart } from './multipart';
import { normalizeCodexSpec, PetRegistry, readSpriteDimensions, sanitizePetId } from './pets';
import { findPokemon, parseAnimDataXml, searchPokemon } from './pokemon';
import { DEFAULT_OFFICE_SETTINGS, DEFAULT_RECEPTION_SIGN, defaultCanDuel, formatCompanionName, normalizePublicUrl, PartyStore } from './store';
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
      expect(byId.get('dafeiyu')?.hasBackView).toBe(false);
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

    expect(
      resolveCodexFrame({
        pose: 'stand',
        dir: 'right',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'right',
        states: defaultStates,
        actualRows: 9,
        actualCols: 8,
      }),
    ).toEqual({ row: 1, col: 0, flipX: false, offsetY: 0 });
    expect(
      resolveCodexFrame({
        pose: 'stand',
        dir: 'left',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'left',
        states: defaultStates,
        actualRows: 9,
        actualCols: 8,
      }),
    ).toEqual({ row: 2, col: 0, flipX: false, offsetY: 0 });

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

  it('places companion pets in owner room with ownerId and nests them under owner in groupRooms', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    for (let i = 1; i <= 7; i++) {
      store.report({ id: `user-${i}`, name: `用户${i}`, status: 'working' });
    }
    store.report({ id: 'bbbliqi', name: 'bbbliqi', status: 'working', companionPetId: 'snorlax' });

    const snap = store.toSnapshot();
    const owner = snap.agents.find((a) => a.id === 'bbbliqi');
    const comp = snap.agents.find((a) => a.id === 'bbbliqi:pet');
    expect(owner).toBeTruthy();
    expect(comp).toBeTruthy();
    expect(comp?.ownerId).toBe('bbbliqi');
    expect(comp?.roomId).toBe(owner?.roomId);

    const groups = groupRooms(snap);
    const ownerNode = groups.flatMap((g) => g.nodes).find((n) => n.agent.id === 'bbbliqi');
    const topIds = groups.flatMap((g) => g.nodes).map((n) => n.agent.id);
    expect(topIds).not.toContain('bbbliqi:pet');
    expect(ownerNode?.subs.map((s) => s.id)).toEqual(['bbbliqi:pet']);
  });
});

describe('Pokémon Duel Arena layout, lifecycle & leaderboard persistence', () => {
  it('classifies Pokémon vs humans and non-Pokémon pets cleanly', () => {
    expect(isPokemonPet(undefined)).toBe(false);
    expect(isPokemonPet({ id: 'dafeiyu', kind: 'codex-v2', spriteUrl: '/x.png' })).toBe(false);
    expect(isPokemonPet({ id: 'psyduck-3d', kind: 'codex-v2', spriteUrl: '/x.webp' })).toBe(true);
    expect(isPokemonPet({ id: 'snorlax', kind: 'codex-v2', spriteUrl: '/x.webp' })).toBe(true);
    expect(isPokemonPet({ id: 'pmd:0006', kind: 'pmd', spriteUrl: '/x.png' })).toBe(true);
  });

  it('places bottom-right core:arena without colliding with 1..4 project rooms', () => {
    for (const roomCount of [1, 2, 3, 4]) {
      const dir = makeTempDir();
      const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
      const store = new PartyStore({ dataDir: dir, pets });
      for (let i = 0; i < roomCount * 6; i++) {
        store.report({ id: `m-${i}`, name: `成员${i}`, status: 'working' });
      }
      const sim = new Sim(stubArt, () => DEFAULT_WORLD_OPTIONS, null);
      sim.applySnapshot(store.toSnapshot(1_700_000_000_000), 1_700_000_000_000);
      const arena = sim.building.arena!;
      expect(arena).not.toBeNull();
      expect(arena.id).toBe('core:arena');
      expect(arena.spots.filter((s) => s.kind === 'arena_fight')).toHaveLength(2);
      expect(arena.spots.filter((s) => s.kind === 'arena_watch')).toHaveLength(6);

      const arenaSlot = slotAt(sim.building.cols - 1, 'south');
      for (const rs of sim.rooms.values()) {
        expect(rs.slot).not.toBe(arenaSlot);
        expect(rs.layout.rect.x !== arena.rect.x || rs.layout.rect.y !== arena.rect.y).toBe(true);
      }
    }
  });

  it('runs a 60s Pokémon-only duel with spectators and persists leaderboard', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    const t0 = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 60_000;
    store.report({ id: 'p-psy', name: '可达鸭选手', status: 'idle', petId: 'psyduck-3d' }, t0);
    store.report({ id: 'p-sno', name: '卡比兽选手', status: 'idle', petId: 'snorlax' }, t0);
    store.report({ id: 'p-fish', name: '大肥鱼观众', status: 'idle', petId: 'dafeiyu' }, t0);
    store.report({ id: 'p-human', name: '程序员小明', status: 'idle' }, t0);

    const sim = new Sim(stubArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null);
    sim.arena.onResult = (wId, wName, lId, lName, at) => {
      store.recordArenaResult(wId, wName, lId, lName, at);
    };
    sim.arena.onLeaderboardReset = (at) => {
      store.ensureArenaLeaderboardFresh(at);
    };
    sim.applySnapshot(store.toSnapshot(t0), t0);

    const res = sim.arena.triggerNow(t0 + 100);
    expect(res.ok).toBe(true);
    expect(sim.arena.state.phase).toBe('gather');
    expect([sim.arena.state.leftId, sim.arena.state.rightId].sort()).toEqual(['p-psy', 'p-sno']);
    expect(sim.arena.state.watchers.length).toBeGreaterThanOrEqual(1);
    expect(sim.arena.state.watchers).not.toContain('p-psy');
    expect(sim.arena.state.watchers).not.toContain('p-sno');

    // Step until fight begins
    let now = t0 + 100;
    for (let i = 0; i < 200 && sim.arena.state.phase === 'gather'; i++) {
      now += 150;
      sim.update(0.15, now);
    }
    expect(sim.arena.state.phase).toBe('fight');
    expect(sim.arena.state.endsAt - sim.arena.state.startedAt).toBe(DUEL_DURATION_MS);

    // Step across the 60s duel duration and verify FX + finish
    let sawFx = false;
    while (sim.arena.state.phase === 'fight' && now < sim.arena.state.endsAt + 1000) {
      now += 500;
      sim.update(0.25, now);
      if (sim.arena.state.fx) sawFx = true;
    }
    expect(sawFx).toBe(true);
    expect(sim.arena.state.phase).toBe('finish');
    expect(sim.arena.state.winnerId).toBeTruthy();
    expect(Math.min(sim.arena.state.leftHp, sim.arena.state.rightHp)).toBe(0);

    store.flush();
    const reloaded = new PartyStore({ dataDir: dir, pets });
    const lb = reloaded.getArenaLeaderboard();
    expect(lb).toHaveLength(2);
    expect(lb[0].wins).toBe(1);
    expect(lb[1].losses).toBe(1);

    // Finish phase -> idle schedules nextDuelAt and syncs it with time offset
    while (sim.arena.state.phase === 'finish') {
      now += 1000;
      sim.update(0.25, now);
    }
    expect(sim.arena.state.phase).toBe('idle');
    const synced = sim.arena.toSyncedState();
    expect(synced.nextDuelAt).toBeGreaterThan(now);

    const mirror = new Sim(stubArt, () => DEFAULT_WORLD_OPTIONS, null, { synced: true });
    mirror.arena.applySynced(synced, 5_000);
    expect(mirror.arena.state.nextDuelAt).toBe(synced.nextDuelAt! + 5_000);

    // Top-of-hour resets live & persisted leaderboard
    const nextHour = (Math.floor(now / 3_600_000) + 1) * 3_600_000 + 500;
    sim.update(0.1, nextHour);
    expect(sim.arena.state.leaderboard).toEqual([]);
    expect(store.getArenaLeaderboard(nextHour)).toEqual([]);
  });

  it('uses Beijing Time (UTC+8) consistently across hour buckets, daylight, seasonal themes, and supports officeSettings + event-driven arena sync', () => {
    // 2026-10-31 15:59:59 UTC = 2026-10-31 23:59:59 Beijing (October -> halloween)
    // 2026-10-31 16:00:00 UTC = 2026-11-01 00:00:00 Beijing (November -> christmas)
    const beforeMidnightBj = Date.UTC(2026, 9, 31, 15, 59, 59);
    const afterMidnightBj = Date.UTC(2026, 9, 31, 16, 0, 0);
    expect(beijingParts(afterMidnightBj)).toEqual({
      year: 2026,
      month: 10,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      fractionalHour: 0,
    });
    expect(beijingHourBucket(afterMidnightBj) - beijingHourBucket(beforeMidnightBj)).toBe(1);
    expect(seasonalThemeFor('auto', new Date(beforeMidnightBj))).toBe('halloween');
    expect(seasonalThemeFor('auto', new Date(afterMidnightBj))).toBe('christmas');
    expect(effectiveHour('auto', null, new Date(Date.UTC(2026, 5, 1, 4, 30, 0)))).toBeCloseTo(12.5);

    // Office global settings persist across PartyStore reloads and populate snapshot meta
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });
    expect(store.getOfficeSettings()).toEqual(DEFAULT_OFFICE_SETTINGS);
    expect(DEFAULT_OFFICE_SETTINGS).toMatchObject({
      lunchEnabled: true,
      lunchStart: '12:00',
      lunchEnd: '13:00',
    });
    store.setOfficeSettings({
      theme: 'none',
      daylight: 'night',
      liveliness: 'calm',
      bubbles: 'none',
      showNames: false,
      lunchEnabled: false,
      lunchStart: '11:45',
      lunchEnd: '13:15',
    });
    expect(store.toSnapshot().meta.officeSettings).toEqual({
      theme: 'none',
      daylight: 'night',
      liveliness: 'calm',
      bubbles: 'none',
      showNames: false,
      lunchEnabled: false,
      lunchStart: '11:45',
      lunchEnd: '13:15',
    });
    store.flush();
    const reloaded = new PartyStore({ dataDir: dir, pets });
    expect(reloaded.getOfficeSettings()).toEqual({
      theme: 'none',
      daylight: 'night',
      liveliness: 'calm',
      bubbles: 'none',
      showNames: false,
      lunchEnabled: false,
      lunchStart: '11:45',
      lunchEnd: '13:15',
    });

    // Event-driven WorldSync emits arena only when arena changes, driving browser Sim (synced: false)
    const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);
    store.report({ id: 'p-psy', name: '可达鸭', status: 'idle', petId: 'psyduck-3d' }, t0);
    store.report({ id: 'p-sno', name: '卡比兽', status: 'idle', petId: 'snorlax' }, t0);
    store.report({ id: 'h-1', name: '旁观小明', status: 'idle' }, t0);

    const ws = new WorldSync(store.toSnapshot(t0));
    const events: ReturnType<WorldSync['getArenaEvent']>[] = [];
    ws.onArena((ev) => events.push(ev));

    // Stepping without state transition emits 0 arena events
    ws.step(t0 + 250);
    const countAfterIdle = events.length;
    ws.step(t0 + 500);
    ws.step(t0 + 750);
    expect(events.length).toBe(countAfterIdle);

    // Triggering a duel emits an arena event
    const trig = ws.triggerArenaDuel();
    expect(trig.ok).toBe(true);
    expect(events.length).toBe(countAfterIdle + 1);

    // Local 60fps browser Sim consumes server arena event without server 10Hz frames
    const clientSim = new Sim(stubArt, () => DEFAULT_WORLD_OPTIONS, undefined, { synced: false });
    clientSim.applySnapshot(store.toSnapshot(t0), t0);
    clientSim.arena.applyRemoteArenaEvent(ws.getArenaEvent(), t0 + 100);
    expect(clientSim.arena.state.phase).toBe('gather');
    expect([clientSim.arena.state.leftId, clientSim.arena.state.rightId].sort()).toEqual(['p-psy', 'p-sno']);
  });

  it('starts duels even when a Pokemon is working, ignores mid-duel status flips, and avoids 10-0 loop with <2 Pokemon', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);
    // Exact scenario reported on public deployment: 1 working Pokemon + 1 idle Pokemon + 1 non-Pokemon + 1 human
    store.report({ id: 'human-1', name: '科比', status: 'idle' }, t0);
    store.report({ id: 'npc:fish', name: '蓝色大肥鱼', status: 'idle', petId: 'dafeiyu' }, t0);
    store.report({ id: 'npc:psy', name: '可达鸭', status: 'working', petId: 'psyduck-3d' }, t0);
    store.report({ id: 'npc:sno', name: '卡比兽', status: 'idle', petId: 'snorlax' }, t0);

    const sim = new Sim(stubArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null);
    sim.applySnapshot(store.toSnapshot(t0), t0);

    // Step past initial duel delay (max 18s) -> duel must start instead of looping 10s->0
    let now = t0;
    for (let i = 0; i < 100 && sim.arena.state.phase === 'idle'; i++) {
      now += 250;
      sim.update(0.25, now);
    }
    expect(sim.arena.state.phase).toBe('gather');
    expect(sim.arena.toSyncedState().nextDuelAt).toBeUndefined();
    expect([sim.arena.state.leftId, sim.arena.state.rightId].sort()).toEqual(['npc:psy', 'npc:sno']);

    // Reach fight phase
    for (let i = 0; i < 100 && sim.arena.state.phase === 'gather'; i++) {
      now += 200;
      sim.update(0.2, now);
    }
    expect(sim.arena.state.phase).toBe('fight');

    // Simulate NPC status toggling between working <-> idle mid-duel: must NOT cancel active duel
    store.report({ id: 'npc:sno', name: '卡比兽', status: 'working', petId: 'snorlax' }, now + 100);
    store.report({ id: 'npc:psy', name: '可达鸭', status: 'idle', petId: 'psyduck-3d' }, now + 100);
    sim.applySnapshot(store.toSnapshot(now + 100), now + 100);
    now += 200;
    sim.update(0.2, now);
    expect(sim.arena.state.phase).toBe('fight');

    // Only 1 Pokemon in the office -> nextDuelAt stays undefined (never exposes a looping 10s->0 countdown)
    store.report({ id: 'npc:psy', status: 'offline' }, now + 50);
    const soloSim = new Sim(stubArt, () => DEFAULT_WORLD_OPTIONS, null);
    soloSim.applySnapshot(store.toSnapshot(now + 100), now + 100);
    let tSolo = now + 100;
    for (let i = 0; i < 120; i++) {
      tSolo += 250;
      soloSim.update(0.25, tSolo);
    }
    expect(soloSim.arena.state.phase).toBe('idle');
    expect(soloSim.arena.toSyncedState().nextDuelAt).toBeUndefined();
  });

  it('enforces hasBackView strictly for non-Pokemon pets, supports 3m duel cooldown & admin canDuel override, and decodes AP1 appearance codes', () => {
    expect(DUEL_COOLDOWN_MS).toBe(180_000);

    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    // dafeiyu & psyduck-3d have hasBackView=false even with 11/9 rows; snorlax has hasBackView=true
    const dafeiyu = pets.getPet('dafeiyu');
    const psyduck = pets.getPet('psyduck-3d');
    const snorlax = pets.getPet('snorlax');
    expect(dafeiyu?.hasBackView).toBe(false);
    expect(psyduck?.hasBackView).toBe(false);
    expect(snorlax?.hasBackView).toBe(true);
    expect(lacksBackView(dafeiyu)).toBe(true);
    expect(lacksBackView(psyduck)).toBe(true);
    expect(lacksBackView(snorlax)).toBe(false);

    const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);
    // Customizer AP1 code for human member
    const code = encodeAppearanceCode({
      name: '科比',
      role: '全栈工程师',
      look: 'm',
      seed: 123456,
      parts: { hairStyle: 'spiky', topStyle: 'hoodie', top: '#e2604f', accessory: 'glasses' },
      companionPokemon: '皮卡丘',
    });
    const decoded = decodeAppearanceCode(code);
    expect(decoded?.name).toBe('科比');
    expect(decoded?.parts?.top).toBe('#e2604f');
    expect(decoded?.companionPokemon).toBe('皮卡丘');

    const repRes = store.report({ id: 'kobe', appearanceCode: code, status: 'idle', agentTool: 'Codex' }, t0);
    expect(repRes.ok).toBe(true);

    store.report({ id: 'fish', name: '大肥鱼', status: 'idle', petId: 'dafeiyu' }, t0);
    store.report({ id: 'sno', name: '卡比兽', status: 'idle', petId: 'snorlax' }, t0);

    // Default canDuel: human=false, dafeiyu=false, snorlax=true
    const snap1 = store.toSnapshot(t0);
    expect(snap1.agents.find((a) => a.id === 'kobe')?.canDuel).toBe(false);
    expect(snap1.agents.find((a) => a.id === 'kobe')?.parts?.top).toBe('#e2604f');
    expect(snap1.agents.find((a) => a.id === 'fish')?.canDuel).toBe(false);
    expect(snap1.agents.find((a) => a.id === 'sno')?.canDuel).toBe(true);

    // Non-back-view pet (dafeiyu) must never be allowed on ANY dir='up' seat/spot
    const sim = new Sim(stubArt, () => DEFAULT_WORLD_OPTIONS, null);
    sim.applySnapshot(snap1, t0);
    const fishChar = sim.chars.get('fish')!;
    const upSpot: SpotDef = { id: 'sofa-up', kind: 'sofa', areaId: 'core:lounge', tx: 5, ty: 8, x: 80, y: 128, dir: 'up', seated: true };
    const downSpot: SpotDef = { id: 'sofa-down', kind: 'sofa', areaId: 'core:lounge', tx: 5, ty: 6, x: 80, y: 96, dir: 'down', seated: true };
    expect(sim.canUseSeat(fishChar, upSpot)).toBe(false);
    expect(sim.canUseSeat(fishChar, downSpot)).toBe(true);

    // Admin enables Easter egg canDuel=true for human 'kobe' -> now kobe vs sno can duel!
    expect(store.setMemberCanDuel('kobe', true)).toEqual({ ok: true, canDuel: true });
    sim.applySnapshot(store.toSnapshot(t0 + 100), t0 + 100);
    const trig = sim.arena.triggerNow(t0 + 200);
    expect(trig.ok).toBe(true);
    expect([sim.arena.state.leftId, sim.arena.state.rightId].sort()).toEqual(['kobe', 'sno']);

    // Customizer HTML and report.mjs support --appearance
    expect(renderCustomizeHtml('https://agent.ipil.space')).toContain('像素小人捏脸工坊');
    expect(renderReportScript('https://agent.ipil.space')).toContain('--appearance');
  });

  it('assigns unique ap_... customize codes, resolves full profile by code/URL, and persists customize updates against stale heartbeats', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });
    const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);

    const r1 = store.report(
      {
        id: 'alice',
        name: 'Alice',
        role: '后端开发',
        status: 'idle',
        companionPetId: 'snorlax',
        companionPetName: '卡比兽',
        agentTool: 'Codex',
      },
      t0,
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const token = r1.member.editToken!;
    expect(token).toMatch(/^ap_[A-Za-z0-9]{12}$/);

    // Same token resolves from raw code or full URL
    const foundByCode = store.getMemberByEditToken(token);
    expect(foundByCode.ok).toBe(true);
    if (!foundByCode.ok) return;
    expect(foundByCode.member.name).toBe('Alice');
    expect(foundByCode.companionPetId).toBe('snorlax');
    expect(foundByCode.companionPetName).toBe('卡比兽');
    expect(foundByCode.resolvedParts.hairStyle).toBeTruthy();

    const foundByUrl = store.getMemberByEditToken(`https://agent.ipil.space/customize/${token}`);
    expect(foundByUrl.ok).toBe(true);
    expect(store.getMemberByEditToken('ap_notexists999')).toEqual({
      ok: false,
      statusCode: 404,
      error: '未找到该专属代码对应的成员，请确认代码是否正确（需先通过 AI 助手完成首次接入）。',
    });

    // Update name, role, look, hair, and remove companion via exclusive token
    const updated = store.updateMemberByEditToken(
      token,
      {
        name: 'Alice改',
        role: '架构师',
        look: 'f',
        parts: { hairStyle: 'ponytail', topStyle: 'jacket', top: '#2f3b55' },
        companionPetId: null,
      },
      t0 + 1000,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.member.name).toBe('Alice改');
    expect(updated.member.role).toBe('架构师');
    expect(updated.member.look).toBe('f');
    expect(updated.resolvedParts.hairStyle).toBe('ponytail');
    expect(updated.companionPetId).toBeUndefined();

    // Subsequent stale heartbeat from report.mjs must NOT revert name, role, or re-create deleted companion
    store.report(
      {
        id: 'alice',
        name: 'Alice',
        role: '后端开发',
        status: 'working',
        companionPetId: 'snorlax',
        companionPetName: '卡比兽',
        customizeCode: token,
      },
      t0 + 2000,
    );
    const snap = store.toSnapshot(t0 + 2000);
    const alice = snap.agents.find((a) => a.id === 'alice');
    expect(alice?.name).toBe('Alice改');
    expect(alice?.role).toBe('架构师');
    expect(alice?.status).toBe('working');
    expect(snap.agents.find((a) => a.id === 'alice:pet')).toBeUndefined();

    const customHtml = renderCustomizeHtml('https://agent.ipil.space', token);
    expect(customHtml).toContain(token);
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(customHtml);
    expect(scriptMatch).toBeTruthy();
    expect(() => new Function(scriptMatch![1])).not.toThrow();
    expect(renderReportScript('https://agent.ipil.space')).toContain('customizeCode');

    // Admin human NPC creation assigns ap_... code, respects initial parts, and can be customized by editToken
    const npcRes = store.createNpc(
      {
        name: '前台小美',
        role: '前台接待',
        avatarMode: 'human',
        look: 'f',
        seed: 999,
        parts: { hairStyle: 'bob', topStyle: 'blouse', accessory: 'bow' },
      },
      t0 + 3000,
    );
    expect(npcRes.ok).toBe(true);
    if (!npcRes.ok) return;
    const npcToken = npcRes.npc.editToken!;
    expect(npcToken).toMatch(/^ap_[A-Za-z0-9]{12}$/);
    expect(npcRes.npc.look).toBe('f');
    expect(npcRes.npc.parts?.hairStyle).toBe('bob');

    const loadedNpc = store.getMemberByEditToken(npcToken);
    expect(loadedNpc.ok).toBe(true);
    if (!loadedNpc.ok) return;
    expect(loadedNpc.member.isNpc).toBe(true);
    expect(loadedNpc.resolvedParts.hairStyle).toBe('bob');

    const editedNpc = store.updateMemberByEditToken(
      npcToken,
      {
        name: '前台小美改',
        role: '首席接待',
        parts: { hairStyle: 'long', topStyle: 'jacket', accessory: 'glasses' },
      },
      t0 + 4000,
    );
    expect(editedNpc.ok).toBe(true);
    if (!editedNpc.ok) return;
    expect(editedNpc.member.isNpc).toBe(true);
    expect(editedNpc.member.name).toBe('前台小美改');
    expect(editedNpc.resolvedParts.hairStyle).toBe('long');
    expect(store.getAdminState().npcs.some((n) => n.editToken === npcToken)).toBe(true);

    const adminHtml = renderAdminHtml();
    expect(adminHtml).toContain('npc-human-picker');
    expect(adminHtml).toContain('🎨 捏脸设置');
    const adminScript = /<script>([\s\S]*?)<\/script>/.exec(adminHtml);
    expect(adminScript).toBeTruthy();
    expect(() => new Function(adminScript![1])).not.toThrow();
  });

  it('keeps stable countdown across late join/snapshots, avoids gather twitching, and snaps fighters across fastForward', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);
    store.report({ id: 'npc:sno', name: '卡比兽', status: 'working', petId: 'snorlax' }, t0);
    store.report({ id: 'npc:psy', name: '可达鸭', status: 'working', petId: 'psyduck-3d' }, t0);

    const world = new WorldSync(store.toSnapshot(t0));
    const firstNext = world.sim.arena.toSyncedState().nextDuelAt!;
    expect(firstNext).toBeGreaterThan(t0);

    // Late-joining client receives live server timestamp t, so remaining countdown is accurate (never reset to initial)
    const laterNow = firstNext - 4_000;
    const lateEv = world.getArenaEvent(laterNow);
    expect(lateEv.t).toBe(laterNow);

    const clientSim = new Sim(stubArt, () => DEFAULT_WORLD_OPTIONS, null);
    clientSim.applySnapshot(store.toSnapshot(laterNow), laterNow);
    clientSim.update(0.1, laterNow + 100);
    clientSim.arena.applyRemoteArenaEvent(lateEv, laterNow + 100);
    expect(clientSim.arena.state.nextDuelAt! - (laterNow + 100)).toBe(4_000);

    // Subsequent snapshot + rebindRemoteParticipants never inflates nextDuelAt back to a stale timestamp
    const snapLater = store.toSnapshot(laterNow + 2_100);
    clientSim.applySnapshot(snapLater, laterNow + 2_100);
    clientSim.arena.rebindRemoteParticipants(laterNow + 2_100);
    expect(clientSim.arena.state.nextDuelAt! - (laterNow + 2_100)).toBe(2_000);

    // Server triggers duel -> gather phase: seated fighter's exit + go plan MUST NOT be reset on subsequent 60fps ticks
    const res = world.triggerArenaDuel();
    expect(res.ok).toBe(true);
    const gatherAt = Date.now();
    clientSim.arena.applyRemoteArenaEvent(world.getArenaEvent(gatherAt), gatherAt);
    const sno = clientSim.chars.get('npc:sno')!;
    const psy = clientSim.chars.get('npc:psy')!;
    const snoFirstStep = sno.step;
    const snoQueueLen = sno.queue.length;
    expect(snoQueueLen).toBeGreaterThan(0);

    // Run several 60fps ticks; ensureGather must not clear/re-dispatch while character is already exiting/walking to ring
    clientSim.update(0.016, gatherAt + 16);
    expect(sno.queue.length).toBeLessThanOrEqual(snoQueueLen);
    if (snoFirstStep) {
      expect(sno.step === snoFirstStep || sno.queue.length < snoQueueLen).toBe(true);
    }

    const ringSpots = [...clientSim.spots.ofKind('arena_fight')].sort((a, b) => a.tx - b.tx);

    // Even if client browser tab was hidden and fastForward runs mid-duel, fighters MUST stay on arena ring (never desk)
    clientSim.fastForward(gatherAt + 5_000);
    const leftId = clientSim.arena.state.leftId!;
    const rightId = clientSim.arena.state.rightId!;
    const leftChar = clientSim.chars.get(leftId)!;
    const rightChar = clientSim.chars.get(rightId)!;
    expect(Math.hypot(leftChar.x - ringSpots[0].x, leftChar.y - ringSpots[0].y)).toBeLessThanOrEqual(2);
    expect(Math.hypot(rightChar.x - ringSpots[1].x, rightChar.y - ringSpots[1].y)).toBeLessThanOrEqual(2);
    expect(leftChar.seated).toBe(false);
    expect(rightChar.seated).toBe(false);

    // Also advance server into fight phase and push to client where fighter was artificially seated at desk: update() snaps them to ring
    let now = gatherAt + 1_000;
    for (let i = 0; i < 40 && world.sim.arena.state.phase === 'gather'; i++) {
      now += 500;
      world.step(now);
    }
    expect(world.sim.arena.state.phase).toBe('fight');
    sno.seated = true;
    sno.x = 10;
    sno.y = 10;
    psy.seated = true;
    psy.x = 20;
    psy.y = 20;
    clientSim.arena.applyRemoteArenaEvent(world.getArenaEvent(now), now);
    clientSim.update(0.1, now + 50);
    expect(Math.hypot(leftChar.x - ringSpots[0].x, leftChar.y - ringSpots[0].y)).toBeLessThanOrEqual(2);
    expect(Math.hypot(rightChar.x - ringSpots[1].x, rightChar.y - ringSpots[1].y)).toBeLessThanOrEqual(2);
    expect(leftChar.dir).toBe('right');
    expect(rightChar.dir).toBe('left');
  });

  it('promotes hourly champion to prevChampion on hour rollover and persists across PartyStore reload', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    const hourH = Date.UTC(2026, 5, 1, 10, 15, 0);
    const hourHBucket = beijingHourBucket(hourH);
    const hourNext = hourH + 3_600_000;

    store.report({ id: 'p1', name: '皮卡丘', status: 'idle', petId: 'snorlax' }, hourH);
    store.report({ id: 'p2', name: '可达鸭', status: 'idle', petId: 'psyduck-3d' }, hourH);

    // Ensure store's bucket aligns to hourH before recording results
    store.ensureArenaLeaderboardFresh(hourH);
    store.recordArenaResult('p1', '皮卡丘', 'p2', '可达鸭', hourH + 1000);
    store.recordArenaResult('p1', '皮卡丘', 'p2', '可达鸭', hourH + 2000);
    expect(store.getPrevArenaChampion(hourH + 3000)).toBeNull();
    expect(store.getArenaLeaderboard(hourH + 3000)[0]).toMatchObject({ id: 'p1', name: '皮卡丘', wins: 2, losses: 0 });

    // Rollover to next hour promotes #1 to prevChampion and clears current leaderboard
    const prev = store.getPrevArenaChampion(hourNext);
    expect(prev).toEqual({ id: 'p1', name: '皮卡丘', wins: 2, losses: 0, hourBucket: hourHBucket });
    expect(store.getArenaLeaderboard(hourNext)).toEqual([]);

    // Flush and reload in a new PartyStore instance: prevChampion persists
    store.flush();
    const reloaded = new PartyStore({ dataDir: dir, pets });
    expect(reloaded.getPrevArenaChampion(hourNext)).toEqual({
      id: 'p1',
      name: '皮卡丘',
      wins: 2,
      losses: 0,
      hourBucket: hourHBucket,
    });

    // Also verify WorldSync emits arena event with prevChampion on hourly rollover AND preserves prevChampion across new duels
    const ws = new WorldSync(reloaded.toSnapshot(hourH), {
      initialLeaderboard: [
        { id: 'p2', name: '可达鸭', wins: 3, losses: 1 },
        { id: 'p1', name: '皮卡丘', wins: 1, losses: 3 },
      ],
      initialPrevChampion: prev,
    });
    const arenaEvents: Array<ReturnType<WorldSync['getArenaEvent']>> = [];
    ws.onArena((ev) => arenaEvents.push(ev));
    ws.step(hourH + 5_000);
    ws.step(hourNext + 5_000);
    const lastEv = arenaEvents.at(-1);
    expect(lastEv?.arena.leaderboard).toEqual([]);
    expect(lastEv?.arena.prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });

    // Stepping into next hour preserves prevChampion cleanly; whether an auto-duel already entered 'gather'
    // or we trigger one explicitly, prevChampion MUST stay intact across gather -> fight -> finish -> idle!
    let duelNow = hourNext + 5_000;
    if (ws.sim.arena.state.phase === 'idle') {
      const res = ws.sim.arena.triggerNow(duelNow);
      expect(res.ok).toBe(true);
    }
    expect(ws.sim.arena.state.phase).toBe('gather');
    expect(ws.sim.arena.toSyncedState().prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });

    while (ws.sim.arena.state.phase === 'gather' && duelNow < hourNext + 40_000) {
      duelNow += 250;
      ws.step(duelNow);
      expect(ws.sim.arena.toSyncedState().prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });
    }
    expect(ws.sim.arena.state.phase).toBe('fight');
    while (ws.sim.arena.state.phase === 'fight' && duelNow < hourNext + 140_000) {
      duelNow += 250;
      ws.step(duelNow);
      expect(ws.sim.arena.toSyncedState().prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });
    }
    expect(ws.sim.arena.state.phase).toBe('finish');
    while (ws.sim.arena.state.phase === 'finish' && duelNow < hourNext + 160_000) {
      duelNow += 250;
      ws.step(duelNow);
      expect(ws.sim.arena.toSyncedState().prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });
    }
    expect(ws.sim.arena.state.phase).toBe('idle');
    expect(ws.sim.arena.toSyncedState().prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });

    // Also verify triggerNow keeps prevChampion on a subsequent manual duel
    const trig = ws.sim.arena.triggerNow(duelNow + 100);
    expect(trig.ok).toBe(true);
    expect(ws.sim.arena.state.phase).toBe('gather');
    expect(ws.sim.arena.toSyncedState().prevChampion).toMatchObject({ id: 'p2', name: '可达鸭', wins: 3, losses: 1 });
  });

  it('supports self-service duel toggles, full 1025 Pokemon search in /customize, and redesigned Codex V2 upload UI in /admin', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
    pets.saveUploadedPet({ petId: 'my-custom-cat', displayName: '我的小猫', spriteBuffer: fakePng });

    // Default duel rules: human=false, uploaded/local pet=false, dafeiyu=false, builtin snorlax=true, system pmd=true
    expect(defaultCanDuel('human')).toBe(false);
    expect(defaultCanDuel('pet', 'my-custom-cat', pets.getPet('my-custom-cat'), pets.getPetSource('my-custom-cat'))).toBe(false);
    expect(defaultCanDuel('pet', 'dafeiyu', pets.getPet('dafeiyu'), pets.getPetSource('dafeiyu'))).toBe(false);
    expect(defaultCanDuel('pet', 'snorlax', pets.getPet('snorlax'), pets.getPetSource('snorlax'))).toBe(true);
    expect(defaultCanDuel('pet', 'pmd:0025', { id: 'pmd:0025', kind: 'pmd', spriteUrl: '' }, 'pmd')).toBe(true);

    const store = new PartyStore({ dataDir: dir, pets });
    const t0 = Date.UTC(2026, 5, 1, 14, 0, 0);
    const rep = store.report({ id: 'bob', name: 'Bob', status: 'idle', companionPetId: 'my-custom-cat', companionPetName: '小猫' }, t0);
    expect(rep.ok).toBe(true);
    if (!rep.ok) return;
    const token = rep.member.editToken!;

    // Default profile: human canDuel=false, uploaded companion companionCanDuel=false
    const prof1 = store.getMemberByEditToken(token);
    expect(prof1.ok).toBe(true);
    if (!prof1.ok) return;
    expect(prof1.canDuel).toBe(false);
    expect(prof1.companionCanDuel).toBe(false);
    expect(prof1.companionPetSource).toBe('uploaded');

    // User toggles self canDuel=true and companionCanDuel=true via /customize
    const upd1 = store.updateMemberByEditToken(token, { canDuel: true, companionCanDuel: true }, t0 + 1000);
    expect(upd1.ok).toBe(true);
    if (!upd1.ok) return;
    expect(upd1.canDuel).toBe(true);
    expect(upd1.companionCanDuel).toBe(true);

    // Switching companion to built-in Pokemon 'snorlax' without explicit companionCanDuel defaults to true
    const upd2 = store.updateMemberByEditToken(token, { canDuel: false, companionPetId: 'snorlax', companionPetName: '卡比兽' }, t0 + 2000);
    expect(upd2.ok).toBe(true);
    if (!upd2.ok) return;
    expect(upd2.canDuel).toBe(false);
    expect(upd2.companionCanDuel).toBe(true);

    // Validate /customize HTML & inline script syntax
    const customHtml = renderCustomizeHtml('https://agent.ipil.space', token);
    expect(customHtml).toContain('1025 只宝可梦');
    expect(customHtml).toContain('opt-self-duel');
    expect(customHtml).toContain('opt-pet-duel');
    expect(customHtml).toContain('随机男生');
    expect(customHtml).toContain('随机女生');
    expect(customHtml).toContain('自然唇色');
    expect(customHtml).toContain('红润唇色');
    const customScript = /<script>([\s\S]*?)<\/script>/.exec(customHtml);
    expect(customScript).toBeTruthy();
    expect(() => new Function(customScript![1])).not.toThrow();

    // Validate /admin HTML & inline script syntax
    const adminHtml = renderAdminHtml();
    expect(adminHtml).toContain('精灵图集图片');
    expect(adminHtml).toContain('动作配置文件 (pet.json)');
    expect(adminHtml).toContain('必填');
    expect(adminHtml).toContain('可选');
    expect(adminHtml).toContain('随机男生');
    expect(adminHtml).toContain('随机女生');
    expect(adminHtml).toContain('opt-lunch-enabled');
    expect(adminHtml).toContain('opt-lunch-start');
    expect(adminHtml).toContain('opt-lunch-end');
    const adminScript = /<script>([\s\S]*?)<\/script>/.exec(adminHtml);
    expect(adminScript).toBeTruthy();
    expect(() => new Function(adminScript![1])).not.toThrow();
  });

  it('tracks privacy-safe online/status/arena/champion broadcasts via OfficeFeedTracker without stale backfill', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    const t0 = Date.UTC(2026, 5, 1, 15, 0, 0);
    store.report({ id: 'pre', name: '早到员工', status: 'working' }, t0);
    const initialSnap = store.toSnapshot(t0);
    const world = new WorldSync(initialSnap);
    const tracker = new OfficeFeedTracker(initialSnap, world.getArenaEvent(t0));

    // Repeating initial snapshot/arena produces no stale backfill
    expect(tracker.diffSnapshot(initialSnap, t0 + 100)).toEqual([]);
    expect(tracker.diffArena(world.getArenaEvent(t0 + 100))).toEqual([]);

    // New member joins with companion pet: only primary member emits join broadcast (no companion duplicate, no sensitive fields)
    store.report({ id: 'alice', name: 'Alice', status: 'working', companionPetId: 'snorlax', companionPetName: '卡比兽' }, t0 + 1000);
    const joinItems = tracker.diffSnapshot(store.toSnapshot(t0 + 1000), t0 + 1000);
    expect(joinItems).toHaveLength(1);
    expect(joinItems[0]).toMatchObject({
      agentId: 'alice',
      agentName: 'Alice',
      activity: { icon: '🟢', text: '进入办公室开始办公' },
    });
    expect(joinItems[0].activity.detail).toBeUndefined();

    // Status transitions: working -> idle -> waiting -> working -> offline
    store.report({ id: 'alice', status: 'idle' }, t0 + 2000);
    const idleItems = tracker.diffSnapshot(store.toSnapshot(t0 + 2000), t0 + 2000);
    expect(idleItems[0].activity).toMatchObject({ icon: '☕', text: '结束手头工作，去休息区摸鱼了' });

    store.report({ id: 'alice', status: 'waiting' }, t0 + 3000);
    const waitItems = tracker.diffSnapshot(store.toSnapshot(t0 + 3000), t0 + 3000);
    expect(waitItems[0].activity).toMatchObject({ icon: '✋', text: '正在等待确认' });

    store.report({ id: 'alice', status: 'working' }, t0 + 4000);
    const workItems = tracker.diffSnapshot(store.toSnapshot(t0 + 4000), t0 + 4000);
    expect(workItems[0].activity).toMatchObject({ icon: '💻', text: '回到工位开始办公' });

    store.report({ id: 'alice', status: 'offline' }, t0 + 5000);
    const offItems = tracker.diffSnapshot(store.toSnapshot(t0 + 5000), t0 + 5000);
    expect(offItems).toHaveLength(1);
    expect(offItems[0].activity).toMatchObject({ icon: '👋', text: '离开了办公室' });

    // Arena duel start, finish, and prevChampion broadcasts (deduplicated across ticks)
    const startEv = {
      t: t0 + 6000,
      arena: {
        phase: 'gather' as const,
        matchId: 7,
        leftId: 'p1',
        leftName: '皮卡丘',
        leftHp: 100,
        rightId: 'p2',
        rightName: '可达鸭',
        rightHp: 100,
        startedAt: t0 + 6000,
        endsAt: t0 + 24000,
        durationMs: 60000,
        watchers: [],
        leaderboard: [],
        prevChampion: null,
      },
    };
    const startFeed = tracker.diffArena(startEv);
    expect(startFeed).toHaveLength(1);
    expect(startFeed[0]).toMatchObject({
      agentId: 'p1',
      agentName: '皮卡丘',
      roomName: '宝可梦决斗场',
      activity: { icon: '⚔️', text: '与 可达鸭 展开宝可梦决斗！' },
    });
    expect(tracker.diffArena({ ...startEv, arena: { ...startEv.arena, phase: 'fight' } })).toEqual([]);

    const finishEv = {
      t: t0 + 66000,
      arena: {
        ...startEv.arena,
        phase: 'finish' as const,
        winnerId: 'p1',
        winnerName: '皮卡丘',
        leaderboard: [{ id: 'p1', name: '皮卡丘', wins: 3, losses: 1 }],
      },
    };
    const finishFeed = tracker.diffArena(finishEv);
    expect(finishFeed).toHaveLength(1);
    expect(finishFeed[0].activity).toMatchObject({
      icon: '🏆',
      text: '击败 可达鸭 赢得决斗胜利（本小时 3胜1负）！',
    });
    expect(tracker.diffArena(finishEv)).toEqual([]);

    const champEv = {
      t: t0 + 3_600_000,
      arena: {
        ...finishEv.arena,
        phase: 'idle' as const,
        leaderboard: [],
        prevChampion: { id: 'p1', name: '皮卡丘', wins: 3, losses: 1, hourBucket: 999 },
      },
    };
    const champFeed = tracker.diffArena(champEv);
    expect(champFeed).toHaveLength(1);
    expect(champFeed[0].activity).toMatchObject({
      icon: '👑',
      text: '荣膺上届决斗场冠军（3胜1负）！',
    });
    expect(tracker.diffArena(champEv)).toEqual([]);
  });

  it('sends humans to break seats to eat quietly during lunch break (12:00-13:00 Beijing time) while keeping Pokémon & pets active', () => {
    expect(normalizeTimeHm(' 12：05 ', '12:00')).toBe('12:05');
    expect(normalizeTimeHm('invalid', '12:00')).toBe('12:00');
    // 2026-06-01 11:55, 12:05, 12:59, 13:00 Beijing Time = 03:55, 04:05, 04:59, 05:00 UTC
    const beforeLunch = Date.UTC(2026, 5, 1, 3, 55, 0);
    const duringLunch = Date.UTC(2026, 5, 1, 4, 5, 0);
    const endOfLunch = Date.UTC(2026, 5, 1, 5, 0, 0);
    expect(isBeijingLunchTime(beforeLunch)).toBe(false);
    expect(isBeijingLunchTime(duringLunch)).toBe(true);
    expect(isBeijingLunchTime(endOfLunch)).toBe(false);
    expect(isBeijingLunchTime(duringLunch, { lunchEnabled: false })).toBe(false);

    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    store.report({ id: 'h-work', name: '小明', status: 'working' }, beforeLunch);
    store.report({ id: 'h-wait', name: '小红', status: 'waiting' }, beforeLunch);
    store.report({ id: 'h-idle', name: '小刚', status: 'idle' }, beforeLunch);
    store.report({ id: 'p-sno', name: '卡比兽', status: 'working', petId: 'snorlax' }, beforeLunch);
    store.report({ id: 'p-psy', name: '可达鸭', status: 'idle', petId: 'psyduck-3d' }, beforeLunch);
    store.report({ id: 'p-fish', name: '大肥鱼', status: 'working', petId: 'dafeiyu' }, beforeLunch);

    const sim = new Sim(stubArt, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null);
    sim.applySnapshot(store.toSnapshot(beforeLunch), beforeLunch);

    let now = beforeLunch;
    for (let i = 0; i < 8; i++) {
      now += 250;
      sim.update(0.25, now);
    }
    const hWork = sim.chars.get('h-work')!;
    const hWait = sim.chars.get('h-wait')!;
    const hIdle = sim.chars.get('h-idle')!;
    const pSno = sim.chars.get('p-sno')!;
    const pFish = sim.chars.get('p-fish')!;
    expect(hWork.pose).toBe('type');
    expect(pSno.pose).toBe('type');
    expect(pFish.pose).toBe('type');

    // Cross into 12:05 Beijing Time (lunch begins)
    now = duringLunch;
    sim.update(0.25, now);
    for (let i = 0; i < 160; i++) {
      now += 250;
      sim.update(0.25, now);
    }

    for (const h of [hWork, hWait, hIdle]) {
      expect(sim.isCharacterOnLunch(h, now)).toBe(true);
      expect(h.seated).toBe(true);
      expect(h.pose).toBe('wait');
      expect(h.held).toBe('lunch');
      const spot = sim.spots.get(h.atSpot);
      expect(spot).toBeTruthy();
      expect(['cafe_seat', 'sofa', 'armchair', 'beanbag']).toContain(spot!.kind);
    }

    // Record positions and verify humans stay completely still even if status flips mid-lunch
    const snapCoords = [hWork, hWait, hIdle].map((c) => ({ x: c.x, y: c.y, atSpot: c.atSpot }));
    store.report({ id: 'h-work', status: 'idle' }, now + 500);
    store.report({ id: 'h-work', status: 'working' }, now + 1000);
    sim.applySnapshot(store.toSnapshot(now + 1000), now + 1000);
    for (let i = 0; i < 240; i++) {
      now += 250;
      sim.update(0.25, now);
    }
    [hWork, hWait, hIdle].forEach((c, idx) => {
      expect(c.x).toBe(snapCoords[idx].x);
      expect(c.y).toBe(snapCoords[idx].y);
      expect(c.atSpot).toBe(snapCoords[idx].atSpot);
      expect(c.pose).toBe('wait');
      expect(c.held).toBe('lunch');
    });

    // Meanwhile Pokémon and desktop pets remain active and can even duel in the Arena
    expect(sim.isCharacterOnLunch(pSno, now)).toBe(false);
    expect(sim.isCharacterOnLunch(pFish, now)).toBe(false);
    expect(pFish.pose).toBe('type');
    expect(pFish.held).not.toBe('lunch');
    if (sim.arena.state.phase === 'idle') {
      const arenaTrig = sim.arena.triggerNow(now + 100);
      expect(arenaTrig.ok).toBe(true);
    }
    expect(['gather', 'fight', 'finish']).toContain(sim.arena.state.phase);
    expect([sim.arena.state.leftId, sim.arena.state.rightId].sort()).toEqual(['p-psy', 'p-sno']);
    expect(sim.arena.state.watchers).not.toContain('h-work');
    expect(sim.arena.state.watchers).not.toContain('h-wait');
    expect(sim.arena.state.watchers).not.toContain('h-idle');

    // Cross 13:01 Beijing Time (lunch ends) -> humans walk back to desks and resume working
    now = endOfLunch + 60_000;
    sim.update(0.25, now);
    for (let i = 0; i < 160; i++) {
      now += 250;
      sim.update(0.25, now);
    }
    expect(sim.isCharacterOnLunch(hWork, now)).toBe(false);
    expect(hWork.atSpot).toBe(hWork.homeSpot);
    expect(hWork.pose).toBe('type');
    expect(hWork.held).toBe('none');
    expect(hWait.atSpot).toBe(hWait.homeSpot);
    expect(hWait.pose).toBe('raise_hand');

    // Turning lunchEnabled=false in admin settings disables lunch even during 12:00-13:00
    store.setOfficeSettings({ lunchEnabled: false });
    const simDisabled = new Sim(
      stubArt,
      () => ({
        ...DEFAULT_WORLD_OPTIONS,
        lunchEnabled: store.getOfficeSettings().lunchEnabled,
        lunchStart: store.getOfficeSettings().lunchStart,
        lunchEnd: store.getOfficeSettings().lunchEnd,
      }),
      null,
    );
    simDisabled.applySnapshot(store.toSnapshot(duringLunch), duringLunch);
    simDisabled.update(0.25, duringLunch + 250);
    expect(simDisabled.isLunchTime(duringLunch + 250)).toBe(false);
    expect(simDisabled.chars.get('h-work')!.pose).toBe('type');
  });

  it('parses SpriteCollab combat frame tags (RushFrame/HitFrame/ReturnFrame) and resolves PMD/Codex combat poses', () => {
    const parsed = parseAnimDataXml(`
      <AnimData>
        <Anims>
          <Anim>
            <Name>Attack</Name>
            <FrameWidth>80</FrameWidth>
            <FrameHeight>80</FrameHeight>
            <RushFrame>1</RushFrame>
            <HitFrame>3</HitFrame>
            <ReturnFrame>6</ReturnFrame>
            <Durations><Duration>2</Duration><Duration>4</Duration></Durations>
          </Anim>
          <Anim>
            <Name>Strike</Name>
            <CopyOf>Attack</CopyOf>
          </Anim>
          <Anim>
            <Name>Faint</Name>
            <FrameWidth>48</FrameWidth>
            <FrameHeight>48</FrameHeight>
            <Durations><Duration>8</Duration><Duration>12</Duration></Durations>
          </Anim>
        </Anims>
      </AnimData>
    `);
    expect(parsed.Attack).toMatchObject({ rushFrame: 1, hitFrame: 3, returnFrame: 6 });
    expect(parsed.Strike).toMatchObject({ name: 'Strike', rushFrame: 1, hitFrame: 3, returnFrame: 6 });
    expect(parsed.Faint).toMatchObject({ frameWidth: 48, frameHeight: 48 });

    const pmd = {
      dex: '0025',
      walk: { url: '/w.png', frameWidth: 32, frameHeight: 40, frames: 4, durations: [120], rows: 8 },
      idle: { url: '/i.png', frameWidth: 40, frameHeight: 56, frames: 2, durations: [200], rows: 8 },
      attack: { url: '/a.png', frameWidth: 80, frameHeight: 80, frames: 4, durations: [80], rows: 8, hitFrame: 2 },
      shoot: { url: '/s.png', frameWidth: 40, frameHeight: 56, frames: 4, durations: [80], rows: 8, hitFrame: 2 },
      charge: { url: '/c.png', frameWidth: 48, frameHeight: 64, frames: 4, durations: [80], rows: 8 },
      faint: { url: '/f.png', frameWidth: 48, frameHeight: 48, frames: 4, durations: [180], rows: 1 },
    };
    expect(pmdAnimForPose(pmd, 'stand', 'idle', 'right', 'attack_melee').url).toBe('/a.png');
    expect(pmdAnimForPose(pmd, 'stand', 'idle', 'right', 'attack_range').url).toBe('/s.png');
    expect(pmdAnimForPose(pmd, 'stand', 'idle', 'right', 'charge').url).toBe('/c.png');
    expect(pmdAnimForPose(pmd, 'stand', 'idle', 'right', 'faint').url).toBe('/f.png');

    expect(
      resolveCodexFrame({
        pose: 'stand',
        dir: 'right',
        mode: 'idle',
        animT: 0,
        lastHorizDir: 'right',
        states: {},
        actualRows: 11,
        actualCols: 8,
        combatPose: 'faint',
      }),
    ).toEqual({ row: 5, col: 7, flipX: false, offsetY: 2 });
  });

  it('runs a real HP=0 KO Arena battle preserving human & non-Pokémon pet Easter egg fighters', () => {
    const dir = makeTempDir();
    const pets = new PetRegistry(dir, null, null, join(process.cwd(), 'assets', 'default-pets'));
    const store = new PartyStore({ dataDir: dir, pets });

    // Non-lunch time in Beijing (10:00 Beijing = 02:00 UTC)
    const startAt = Date.UTC(2026, 5, 1, 2, 0, 0);
    store.report({ id: 'h-duel', name: '阿强', status: 'idle', agentTool: 'Claude Code', canDuel: true }, startAt);
    store.report({ id: 'dfy-duel', name: '大肥鱼', status: 'idle', petId: 'dafeiyu', canDuel: true }, startAt);

    const results: Array<{ winnerId: string; loserId: string }> = [];
    const ws = new WorldSync(store.toSnapshot(startAt), {
      onArenaResult: (winnerId, _wName, loserId) => {
        results.push({ winnerId, loserId });
      },
    });
    const trig = ws.sim.arena.triggerNow(startAt + 500);
    expect(trig.ok).toBe(true);
    expect(ws.sim.arena.state.leftTypes?.length).toBeGreaterThanOrEqual(1);
    expect(ws.sim.arena.state.rightTypes?.length).toBeGreaterThanOrEqual(1);

    let now = startAt + 500;
    let sawRichFx = false;
    let finishedEarlyOrAtEnd = false;
    const hChar = ws.sim.chars.get('h-duel')!;
    const dfyChar = ws.sim.chars.get('dfy-duel')!;
    for (let i = 0; i < 360; i++) {
      now += 250;
      ws.step(now);
      const st = ws.sim.arena.state;
      if (st.phase === 'fight' && st.fx) {
        // Fight exchanges clear head speech bubbles so move callouts don't overlap skill VFX/popups
        expect(hChar.sayUntil).toBe(0);
        expect(dfyChar.sayUntil).toBe(0);
      }
      if (st.fx && st.fx.category && st.fx.moveType && st.fx.effectiveness) {
        sawRichFx = true;
      }
      if (st.phase === 'finish') {
        finishedEarlyOrAtEnd = true;
        expect(Math.min(st.leftHp, st.rightHp)).toBe(0);
        expect(Math.max(st.leftHp, st.rightHp)).toBeGreaterThan(0);
        break;
      }
    }
    expect(sawRichFx).toBe(true);
    expect(finishedEarlyOrAtEnd).toBe(true);
    expect(results).toHaveLength(1);
    expect([results[0].winnerId, results[0].loserId].sort()).toEqual(['dfy-duel', 'h-duel']);
  });
});
