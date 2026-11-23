import type { AgentPetInfo, CodexV2Spec, CodexV2StateSpec, PmdAnimSpec } from '../../../../shared/types';
import type { Dir, Pose } from '../../art/api';
import type { Mode } from '../sim/behavior';

interface OpaqueBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
}

interface CachedPetEntry {
  img: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
  box: OpaqueBox | null;
  avatarUrl: string | null;
  waiters: Set<(url: string) => void>;
}

const DEFAULT_STATES: Record<string, CodexV2StateSpec> = {
  idle: { row: 0, columns: 6, frameDuration: 800 },
  'running-right': { row: 1, columns: 8, frameDuration: 130 },
  'running-left': { row: 2, columns: 8, frameDuration: 130 },
  waving: { row: 3, columns: 4, frameDuration: 160 },
  jumping: { row: 4, columns: 5, frameDuration: 150 },
  failed: { row: 5, columns: 8, frameDuration: 150 },
  waiting: { row: 6, columns: 6, frameDuration: 160 },
  running: { row: 7, columns: 6, frameDuration: 130 },
  review: { row: 8, columns: 6, frameDuration: 160 },
};

const TARGET_WORLD_HEIGHT = 28;
const MIN_SCALE = 0.14;
const MAX_SCALE = 0.32;

const cache = new Map<string, CachedPetEntry>();

function resolveSpec(spec?: CodexV2Spec): { fw: number; fh: number; cols: number; rows: number; states: Partial<Record<string, CodexV2StateSpec>> } {
  return {
    fw: spec?.frameWidth && spec.frameWidth > 0 ? spec.frameWidth : 192,
    fh: spec?.frameHeight && spec.frameHeight > 0 ? spec.frameHeight : 208,
    cols: spec?.gridColumns && spec.gridColumns > 0 ? spec.gridColumns : 8,
    rows: spec?.gridRows && spec.gridRows > 0 ? spec.gridRows : 11,
    states: spec?.states ?? DEFAULT_STATES,
  };
}

function measureFirstFrame(img: HTMLImageElement, fw: number, fh: number, smoothThumb: boolean, row = 0): { box: OpaqueBox; avatarUrl: string } {
  const sw = Math.min(fw, img.naturalWidth || fw);
  const sh = Math.min(fh, img.naturalHeight || fh);
  let box: OpaqueBox = {
    minX: Math.floor(sw * 0.2),
    maxX: Math.floor(sw * 0.8),
    minY: Math.floor(sh * 0.2),
    maxY: Math.floor(sh * 0.9),
    w: Math.max(1, Math.floor(sw * 0.6)),
    h: Math.max(1, Math.floor(sh * 0.7)),
  };
  let avatarUrl = '';

  try {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d');
    if (ctx) {
      const sy = Math.min(Math.max(0, row) * fh, Math.max(0, (img.naturalHeight || fh) - sh));
      ctx.drawImage(img, 0, sy, sw, sh, 0, 0, sw, sh);
      const data = ctx.getImageData(0, 0, sw, sh).data;
      let minX = sw;
      let minY = sh;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (data[(y * sw + x) * 4 + 3] > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= minX && maxY >= minY) {
        box = { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
      }

      const size = Math.max(box.w, box.h, 16);
      const pad = Math.round(size * 0.14);
      const cropSize = size + pad * 2;
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      const thumb = document.createElement('canvas');
      thumb.width = 64;
      thumb.height = 64;
      const tctx = thumb.getContext('2d');
      if (tctx) {
        tctx.imageSmoothingEnabled = smoothThumb;
        tctx.drawImage(
          c,
          cx - cropSize / 2,
          cy - cropSize / 2,
          cropSize,
          cropSize,
          0,
          0,
          64,
          64,
        );
        avatarUrl = thumb.toDataURL('image/png');
      }
    }
  } catch {
    // Fallback bounds already computed
  }

  return { box, avatarUrl };
}

function getOrLoad(spriteUrl: string, fw: number, fh: number, smoothThumb: boolean, row = 0): CachedPetEntry {
  const cacheKey = `${spriteUrl}|${fw}x${fh}|r${row}`;
  let entry = cache.get(cacheKey);
  if (entry) return entry;

  const img = new Image();
  entry = {
    img,
    loaded: false,
    failed: false,
    box: null,
    avatarUrl: null,
    waiters: new Set(),
  };
  cache.set(cacheKey, entry);

  img.onload = () => {
    entry!.loaded = true;
    const measured = measureFirstFrame(img, fw, fh, smoothThumb, row);
    entry!.box = measured.box;
    entry!.avatarUrl = measured.avatarUrl || null;
    if (entry!.avatarUrl) {
      for (const cb of entry!.waiters) cb(entry!.avatarUrl);
    }
    entry!.waiters.clear();
  };
  img.onerror = () => {
    entry!.failed = true;
    entry!.waiters.clear();
  };
  img.src = spriteUrl;
  return entry;
}

/**
 * Loads a cropped square thumbnail URL for a Codex V2 or PMD Pokémon pet.
 */
export function loadPetAvatarUrl(
  spriteUrl: string,
  spec: CodexV2Spec | undefined,
  onReady: (url: string) => void,
  pmd?: AgentPetInfo['pmd'],
): string | null {
  if (pmd) {
    const baseAnim = pmd.idle ?? pmd.walk;
    const entry = getOrLoad(baseAnim.url, baseAnim.frameWidth, baseAnim.frameHeight, false, 0);
    if (entry.avatarUrl) return entry.avatarUrl;
    if (!entry.failed) entry.waiters.add(onReady);
    return null;
  }
  const { fw, fh, states } = resolveSpec(spec);
  const idleRow = states.idle?.row ?? 0;
  const entry = getOrLoad(spriteUrl, fw, fh, true, idleRow);
  if (entry.avatarUrl) return entry.avatarUrl;
  if (!entry.failed) entry.waiters.add(onReady);
  return null;
}

export function stateKeyForPose(pose: Pose, dir: Dir, mode: Mode, lastHorizDir: 'left' | 'right'): string {
  if (pose === 'walk' || pose === 'run') {
    if (dir === 'right') return 'running-right';
    if (dir === 'left') return 'running-left';
    return lastHorizDir === 'left' ? 'running-left' : 'running-right';
  }
  if (pose === 'type') return 'running';
  if (pose === 'raise_hand' || mode === 'wait') return 'waiting';
  if (pose === 'play' || pose === 'cheer' || pose === 'laugh' || pose === 'game') return 'jumping';
  if (pose === 'talk' || pose === 'drink' || pose === 'use' || pose === 'stretch' || pose === 'rps' || pose === 'groom') return 'waving';
  if (pose === 'read') return 'review';
  if (pose === 'sulk') return 'failed';
  return 'idle';
}

function frameIndexForDurations(cols: number, frameDuration: number | number[], animT: number): number {
  const count = Math.max(1, cols);
  if (typeof frameDuration === 'number') {
    const dur = Math.max(40, frameDuration);
    return Math.floor(animT / dur) % count;
  }
  if (!frameDuration.length) return 0;
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.max(40, frameDuration[i % frameDuration.length] ?? 150);
  let t = ((animT % total) + total) % total;
  for (let i = 0; i < count; i++) {
    const d = Math.max(40, frameDuration[i % frameDuration.length] ?? 150);
    if (t < d) return i;
    t -= d;
  }
  return 0;
}

export interface ResolvedCodexFrame {
  row: number;
  col: number;
  flipX: boolean;
  offsetY: number;
}

export function resolveCodexFrame(opts: {
  pose: Pose;
  dir: Dir;
  mode: Mode;
  animT: number;
  lastHorizDir: 'left' | 'right';
  states: Partial<Record<string, CodexV2StateSpec>>;
  actualRows: number;
  actualCols: number;
}): ResolvedCodexFrame {
  const row9 = opts.states['look_directions_1_8']?.row ?? 9;
  const row10 = opts.states['look_directions_9_16']?.row ?? 10;
  const hasGazeRows = opts.actualRows > Math.max(row9, row10) && opts.actualCols >= 8;
  const t = Math.max(0, opts.animT);

  if (hasGazeRows) {
    if (opts.dir === 'up') {
      if (opts.pose === 'walk' || opts.pose === 'run') {
        const step = Math.floor(t / 140) % 4;
        if (step === 1) return { row: row10, col: 7, flipX: false, offsetY: -1.5 };
        if (step === 3) return { row: row10, col: 7, flipX: true, offsetY: -1.5 };
        return { row: row9, col: 0, flipX: false, offsetY: 0 };
      }
      if (opts.pose === 'type') {
        const step = Math.floor(t / 220) % 4;
        if (step === 1) return { row: row10, col: 7, flipX: false, offsetY: -0.6 };
        if (step === 3) return { row: row10, col: 7, flipX: true, offsetY: -0.6 };
        return { row: row9, col: 0, flipX: false, offsetY: 0 };
      }
      if (opts.pose === 'play' || opts.pose === 'cheer' || opts.pose === 'laugh' || opts.pose === 'game') {
        const step = Math.floor(t / 180) % 2;
        return { row: row9, col: 0, flipX: false, offsetY: step === 1 ? -2 : 0 };
      }
      const isActiveSubtle =
        opts.pose === 'talk' ||
        opts.pose === 'drink' ||
        opts.pose === 'use' ||
        opts.pose === 'stretch' ||
        opts.pose === 'rps' ||
        opts.pose === 'groom';
      const offsetY = isActiveSubtle && Math.floor(t / 300) % 2 === 1 ? -0.5 : 0;
      return { row: row9, col: 0, flipX: false, offsetY };
    }

    if (opts.dir === 'down' && (opts.pose === 'walk' || opts.pose === 'run')) {
      const step = Math.floor(t / 140) % 4;
      if (step === 1) return { row: row10, col: 1, flipX: false, offsetY: -1.5 };
      if (step === 3) return { row: row9, col: 7, flipX: false, offsetY: -1.5 };
      return { row: row10, col: 0, flipX: false, offsetY: 0 };
    }

    if ((opts.dir === 'right' || opts.dir === 'left') && opts.pose !== 'walk' && opts.pose !== 'run') {
      const row = opts.dir === 'right' ? row9 : row10;
      let offsetY = 0;
      if (opts.pose === 'play' || opts.pose === 'cheer' || opts.pose === 'laugh' || opts.pose === 'game') {
        offsetY = Math.floor(t / 180) % 2 === 1 ? -2 : 0;
      } else if (
        opts.pose === 'type' ||
        opts.pose === 'talk' ||
        opts.pose === 'drink' ||
        opts.pose === 'use' ||
        opts.pose === 'stretch' ||
        opts.pose === 'rps' ||
        opts.pose === 'groom'
      ) {
        offsetY = Math.floor(t / 220) % 2 === 1 ? -0.6 : 0;
      }
      return { row, col: 4, flipX: false, offsetY };
    }
  }

  if (!hasGazeRows && (opts.dir === 'right' || opts.dir === 'left') && opts.pose !== 'walk' && opts.pose !== 'run') {
    const dirKey = opts.dir === 'right' ? 'running-right' : 'running-left';
    const dirState = opts.states[dirKey] ?? DEFAULT_STATES[dirKey];
    if (dirState && dirState.row < opts.actualRows) {
      let offsetY = 0;
      if (opts.pose === 'play' || opts.pose === 'cheer' || opts.pose === 'laugh' || opts.pose === 'game') {
        offsetY = Math.floor(t / 180) % 2 === 1 ? -2 : 0;
      }
      return { row: dirState.row, col: 0, flipX: false, offsetY };
    }
  }

  const key = stateKeyForPose(opts.pose, opts.dir, opts.mode, opts.lastHorizDir);
  const specState = opts.states[key] ?? DEFAULT_STATES[key] ?? opts.states.idle ?? DEFAULT_STATES.idle;
  const maxRow = Math.max(0, opts.actualRows - 1);
  const maxCol = Math.max(0, opts.actualCols - 1);
  const row = Math.min(maxRow, Math.max(0, specState.row));
  const col = Math.min(maxCol, frameIndexForDurations(specState.columns, specState.frameDuration, t));
  return { row, col, flipX: false, offsetY: 0 };
}

export function pmdAnimForPose(pmd: NonNullable<AgentPetInfo['pmd']>, pose: Pose, mode: Mode, dir: Dir = 'down'): PmdAnimSpec {
  let anim: PmdAnimSpec;
  if (pose === 'walk' || pose === 'run') anim = pmd.walk;
  else if (pose === 'type') anim = pmd.work ?? pmd.hop ?? pmd.idle ?? pmd.walk;
  else if (pose === 'sleep') anim = pmd.sleep ?? pmd.idle ?? pmd.walk;
  else if (pose === 'sulk') anim = pmd.hurt ?? pmd.idle ?? pmd.walk;
  else if (pose === 'drink' || pose === 'use' || pose === 'read' || pose === 'talk') {
    anim = pmd.eat ?? pmd.hop ?? pmd.idle ?? pmd.walk;
  } else if (
    pose === 'play' ||
    pose === 'cheer' ||
    pose === 'laugh' ||
    pose === 'game' ||
    pose === 'stretch' ||
    pose === 'rps' ||
    pose === 'groom' ||
    pose === 'raise_hand' ||
    mode === 'wait'
  ) {
    anim = pmd.hop ?? pmd.idle ?? pmd.walk;
  } else {
    anim = pmd.idle ?? pmd.walk;
  }

  if (pose !== 'sleep' && dir !== 'down' && anim.rows < 5) {
    const multi = [pmd.idle, pmd.hop, pmd.walk].find((candidate): candidate is PmdAnimSpec => !!candidate && candidate.rows >= 5);
    if (multi) return multi;
  }
  return anim;
}

function pmdRowForDir(dir: Dir, rows: number): number {
  if (rows <= 1) return 0;
  // PMD SpriteCollab 8-direction row layout: 0=down, 2=right, 4=up, 6=left
  let want = 0;
  if (dir === 'right') want = 2;
  else if (dir === 'up') want = 4;
  else if (dir === 'left') want = 6;
  return want < rows ? want : 0;
}

export interface RenderedPetBox {
  bx: number;
  by: number;
  bw: number;
  bh: number;
  headY: number;
}

function drawPmdPokemonFrame(
  ctx: CanvasRenderingContext2D,
  pmd: NonNullable<AgentPetInfo['pmd']>,
  opts: { pose: Pose; dir: Dir; mode: Mode; animT: number },
  x: number,
  y: number,
): RenderedPetBox | null {
  const anim = pmdAnimForPose(pmd, opts.pose, opts.mode, opts.dir);
  const entry = getOrLoad(anim.url, anim.frameWidth, anim.frameHeight, false);
  if (!entry.loaded || entry.failed || !entry.box) {
    // Warm up walk sheet too so movement doesn't flicker
    if (anim.url !== pmd.walk.url) getOrLoad(pmd.walk.url, pmd.walk.frameWidth, pmd.walk.frameHeight, false);
    return null;
  }

  const maxCols = Math.max(1, Math.floor(entry.img.naturalWidth / anim.frameWidth));
  const maxRows = Math.max(1, Math.floor(entry.img.naturalHeight / anim.frameHeight));
  const col = Math.min(maxCols - 1, frameIndexForDurations(anim.frames, anim.durations, opts.animT));
  const row = Math.min(maxRows - 1, pmdRowForDir(opts.dir, Math.min(anim.rows, maxRows)));

  const sx = col * anim.frameWidth;
  const sy = row * anim.frameHeight;
  const box = entry.box;
  const scale = Math.max(0.75, Math.min(1.25, 26 / Math.max(1, box.h)));
  const anchorX = (box.minX + box.maxX) / 2;
  const anchorY = box.maxY;

  const dx = Math.round(x - anchorX * scale);
  const dy = Math.round(y - anchorY * scale);
  const dw = Math.round(anim.frameWidth * scale);
  const dh = Math.round(anim.frameHeight * scale);

  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(entry.img, sx, sy, anim.frameWidth, anim.frameHeight, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prevSmooth;

  const bx = dx + box.minX * scale;
  const by = dy + box.minY * scale;
  const bw = box.w * scale;
  const bh = box.h * scale;
  return { bx, by, bw, bh, headY: by };
}

/**
 * Draws an animated Codex V2 or PMD Pokémon pet frame at world coordinates (x, y).
 * Returns null while loading or on load failure so the caller can fall back cleanly.
 */
export function drawCodexPetFrame(
  ctx: CanvasRenderingContext2D,
  pet: AgentPetInfo,
  opts: { pose: Pose; dir: Dir; mode: Mode; animT: number; lastHorizDir: 'left' | 'right' },
  x: number,
  y: number,
): RenderedPetBox | null {
  if (pet.kind === 'pmd' && pet.pmd) {
    return drawPmdPokemonFrame(ctx, pet.pmd, opts, x, y);
  }

  const { fw, fh, cols, rows, states } = resolveSpec(pet.spec);
  const entry = getOrLoad(pet.spriteUrl, fw, fh, true);
  if (!entry.loaded || entry.failed || !entry.box) return null;

  const actualRows = Math.min(rows, Math.floor(entry.img.naturalHeight / fh));
  const actualCols = Math.min(cols, Math.floor(entry.img.naturalWidth / fw));
  if (actualRows <= 0 || actualCols <= 0) return null;

  const resolved = resolveCodexFrame({
    pose: opts.pose,
    dir: opts.dir,
    mode: opts.mode,
    animT: opts.animT,
    lastHorizDir: opts.lastHorizDir,
    states,
    actualRows,
    actualCols,
  });

  const sx = resolved.col * fw;
  const sy = resolved.row * fh;
  if (sx + fw > entry.img.naturalWidth || sy + fh > entry.img.naturalHeight) {
    return null;
  }

  const box = entry.box;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, TARGET_WORLD_HEIGHT / Math.max(1, box.h)));
  const anchorX = (box.minX + box.maxX) / 2;
  const anchorY = box.maxY;

  const dx = Math.round(x - anchorX * scale);
  const dy = Math.round(y - anchorY * scale);
  const drawY = Math.round(dy + resolved.offsetY);
  const dw = Math.round(fw * scale);
  const dh = Math.round(fh * scale);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if (resolved.flipX) {
    ctx.translate(Math.round(x * 2), 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(entry.img, sx, sy, fw, fh, dx, drawY, dw, dh);
  ctx.restore();

  const bx = dx + box.minX * scale;
  const by = drawY + box.minY * scale;
  const bw = box.w * scale;
  const bh = box.h * scale;
  return { bx, by, bw, bh, headY: by };
}
