import { TILE } from '../../art/api';
import { POKEMON_TYPE_META } from '../../../../shared/pokemon-battle';
import type { PokemonType, SyncedArenaState } from '../../../../shared/types';
import type { Camera } from '../camera';
import type { TileRect } from '../layout/types';
import type { Sim } from '../sim/sim';
import type { Particles } from './particles';

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export interface ArenaFxTracker {
  lastFxId: number;
  lastCritFxId?: number;
  lastWinnerMatchId: number;
}

export function drawArenaFloor(
  ctx: CanvasRenderingContext2D,
  rect: TileRect,
  state: SyncedArenaState,
  now: number,
): void {
  const ox = rect.x * TILE;
  const oy = rect.y * TILE;
  const T = (n: number) => Math.round(n * TILE);

  const active = state.phase === 'fight';
  const pulse = active ? 0.55 + Math.sin(now / 180) * 0.25 : 0.28;

  ctx.save();

  // 深绿战术场地底垫
  ctx.fillStyle = '#254a36';
  ctx.fillRect(ox + T(1.5), oy + T(2.3), T(13), T(8.1));
  ctx.strokeStyle = '#d4af4f';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + T(1.5) + 0.5, oy + T(2.3) + 0.5, T(13) - 1, T(8.1) - 1);

  // 红蓝对战主场地
  const cx0 = ox + T(2.4);
  const cy0 = oy + T(3.6);
  const cw = T(11.2);
  const ch = T(5.2);
  ctx.fillStyle = 'rgba(220, 74, 86, 0.22)';
  ctx.fillRect(cx0, cy0, cw / 2, ch);
  ctx.fillStyle = 'rgba(72, 148, 240, 0.22)';
  ctx.fillRect(cx0 + cw / 2, cy0, cw / 2, ch);

  // 场边白线与中线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cw - 1, ch - 1);
  ctx.beginPath();
  ctx.moveTo(cx0 + cw / 2, cy0);
  ctx.lineTo(cx0 + cw / 2, cy0 + ch);
  ctx.stroke();

  // 中央经典精灵球圆环
  const mx = cx0 + cw / 2;
  const my = cy0 + ch / 2;
  const r = 13;
  ctx.beginPath();
  ctx.arc(mx, my, r, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = `rgba(226, 74, 74, ${0.42 + pulse * 0.35})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = `rgba(244, 246, 250, ${0.42 + pulse * 0.3})`;
  ctx.fill();

  ctx.strokeStyle = 'rgba(28, 34, 48, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mx - r, my);
  ctx.lineTo(mx + r, my);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(mx, my, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 左右红蓝阵脚光环（选手站位）
  const leftPadX = ox + T(4.5);
  const rightPadX = ox + T(11.5);
  const padY = oy + T(6.5);
  ctx.fillStyle = `rgba(248, 113, 113, ${pulse * 0.45})`;
  ctx.beginPath();
  ctx.ellipse(leftPadX, padY, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(96, 165, 250, ${pulse * 0.45})`;
  ctx.beginPath();
  ctx.ellipse(rightPadX, padY, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 观众席虚线角标（北侧 & 南侧）
  ctx.fillStyle = 'rgba(255, 245, 210, 0.28)';
  for (const [tx, ty] of [
    [3, 3],
    [5, 3],
    [10, 3],
    [12, 3],
    [4, 9],
    [8, 9],
  ] as const) {
    ctx.fillRect(ox + tx * TILE + 4, oy + ty * TILE + 8, 8, 3);
  }

  // 右下角排行榜小木牌/奖台装饰物
  const standX = ox + T(13.2);
  const standY = oy + T(9.4);
  ctx.fillStyle = '#5c4228';
  ctx.fillRect(standX + 5, standY + 8, 2, 7);
  ctx.fillRect(standX + 15, standY + 8, 2, 7);
  ctx.fillStyle = '#334155';
  ctx.fillRect(standX, standY, 22, 10);
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 1;
  ctx.strokeRect(standX + 0.5, standY + 0.5, 21, 9);
  ctx.fillStyle = '#fde047';
  ctx.fillRect(standX + 4, standY + 3, 14, 1.5);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(standX + 4, standY + 6, 10, 1);

  ctx.restore();
}

/** 门口左侧墙上的上届冠军荣耀牌匾（世界坐标，绘于墙面之上，与右侧倒计时电视对称）。 */
export function drawArenaChampionPlaque(
  ctx: CanvasRenderingContext2D,
  rect: TileRect,
  _state: SyncedArenaState,
  _now: number,
): void {
  const ox = rect.x * TILE;
  const oy = rect.y * TILE;
  const x = Math.round(ox + 1.35 * TILE);
  const y = Math.round(oy + 0.22 * TILE);
  const w = 64;
  const h = 24;

  ctx.save();
  // 墙面投影
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fillRect(x + 1, y + 2, w, h);

  // 牌匾暗蓝金属底板 + 金色边框
  ctx.fillStyle = '#1b2436';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#d4af4f';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // 内框深色底面
  ctx.fillStyle = '#0f1829';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

  // 顶部金色细线装饰
  ctx.fillStyle = 'rgba(250, 204, 21, 0.32)';
  ctx.fillRect(x + 3, y + 2, w - 6, 1);

  // 四角金色铆钉
  ctx.fillStyle = '#facc15';
  ctx.fillRect(x + 2.5, y + 2.5, 1.5, 1.5);
  ctx.fillRect(x + w - 4, y + 2.5, 1.5, 1.5);
  ctx.fillRect(x + 2.5, y + h - 4, 1.5, 1.5);
  ctx.fillRect(x + w - 4, y + h - 4, 1.5, 1.5);

  ctx.restore();
}

/** 门口右侧墙上的挂壁倒计时电视机（世界坐标，绘于墙面之上）。 */
export function drawArenaWallTv(
  ctx: CanvasRenderingContext2D,
  rect: TileRect,
  state: SyncedArenaState,
  now: number,
): void {
  const ox = rect.x * TILE;
  const oy = rect.y * TILE;
  const x = Math.round(ox + 11.05 * TILE);
  const y = Math.round(oy + 0.22 * TILE);
  const w = 52;
  const h = 24;

  ctx.save();
  // 墙面投影
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fillRect(x + 1, y + 2, w, h);

  // 电视金属外框
  ctx.fillStyle = '#1b2436';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // 液晶屏幕底色
  ctx.fillStyle = '#091526';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 5);

  // 扫描线微弱高光
  ctx.fillStyle = 'rgba(148, 197, 255, 0.06)';
  for (let sy = y + 3; sy < y + h - 4; sy += 3) {
    ctx.fillRect(x + 2, sy, w - 4, 1);
  }

  // 右下角状态指示灯（备战绿色 / 决斗红色闪烁）
  const active = state.phase === 'fight' || state.phase === 'gather';
  const blink = !active || Math.floor(now / 350) % 2 === 0;
  ctx.fillStyle = active ? (blink ? '#ef4444' : '#7f1d1d') : '#22c55e';
  ctx.fillRect(x + w - 5, y + h - 3, 2, 1.5);
  ctx.restore();
}

export function drawArenaEffects(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  particles: Particles,
  now: number,
  tracker: ArenaFxTracker,
): void {
  const st = sim.arena.state;
  if (st.phase === 'finish' && st.winnerId && st.matchId !== tracker.lastWinnerMatchId) {
    tracker.lastWinnerMatchId = st.matchId;
    const w = sim.chars.get(st.winnerId);
    if (w) particles.confetti(w.x, w.y - 16);
  }

  const fx = st.fx;
  if (!fx || now < fx.at || now > fx.until) return;
  const from = sim.chars.get(fx.fromId);
  const to = sim.chars.get(fx.toId);
  if (!from || !to) return;

  const span = Math.max(1, fx.until - fx.at);
  const p = Math.max(0, Math.min(1, (now - fx.at) / span));
  const hitR = fx.hitRatio ?? 0.38;
  const sx = from.x;
  const sy = from.y - 11;
  const tx = to.x;
  const ty = to.y - 11;

  if (fx.id !== tracker.lastFxId && p >= hitR * 0.85) {
    tracker.lastFxId = fx.id;
    if (fx.category === 'status') {
      particles.sparkle(sx, sy - 4);
    } else if (!fx.dodged && fx.effectiveness !== 'immune') {
      particles.sparkle(to.x, to.y - 10);
      if (fx.crit || fx.effectiveness === 'double_super' || fx.effectiveness === 'super') {
        particles.confetti(to.x, to.y - 14);
      }
    }
  }

  // Missile progress reaches target at hitR; impact burst runs from hitR to 1.0
  const flyU = Math.max(0, Math.min(1, (p - 0.06) / Math.max(0.12, hitR - 0.04)));
  const hitP = p < hitR ? 0 : (p - hitR) / Math.max(0.08, 1 - hitR);

  ctx.save();
  switch (fx.kind) {
    case 'thunder': {
      const boltEndU = Math.min(1, p / Math.max(0.15, hitR));
      const ex = sx + (tx - sx) * boltEndU;
      const ey = sy + (ty - sy) * boltEndU;
      const alpha = p < 0.8 ? 1 : (1 - p) / 0.2;
      ctx.strokeStyle = `rgba(253, 224, 71, ${alpha})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const u = (i / steps) * boltEndU;
        const jx = sx + (tx - sx) * u + Math.sin(now / 26 + i * 3.1) * 5;
        const jy = sy + (ty - sy) * u + (Math.cos(now / 22 + i * 2.7) * 6 - 3);
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(250, 204, 21, ${1 - hitP})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(tx, ty, 5 + hitP * 15, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'fire': {
      const cx = sx + (tx - sx) * flyU;
      const cy = sy + (ty - sy) * flyU - Math.sin(flyU * Math.PI) * 9;
      if (p <= hitR + 0.12) {
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(249, 115, 22, ${1 - hitP})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + hitP * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(253, 224, 71, ${(1 - hitP) * 0.45})`;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 + hitP * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'water': {
      const waveEnd = Math.min(1, p / Math.max(0.15, hitR));
      const a = p < 0.78 ? 0.92 : (1 - p) / 0.22;
      ctx.strokeStyle = `rgba(56, 189, 248, ${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (let i = 1; i <= 8; i++) {
        const u = (i / 8) * waveEnd;
        ctx.lineTo(
          sx + (tx - sx) * u,
          sy + (ty - sy) * u + Math.sin(u * Math.PI * 3 - p * 12) * 3,
        );
      }
      ctx.stroke();

      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(186, 230, 253, ${1 - hitP})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + hitP * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'grass': {
      for (let i = 0; i < 4; i++) {
        const u = Math.max(0, Math.min(1, (p - i * 0.05) / Math.max(0.15, hitR)));
        if (p > hitR + 0.18 + i * 0.04) continue;
        const lx = sx + (tx - sx) * u;
        const ly = sy + (ty - sy) * u - Math.sin(u * Math.PI) * 10 + (i - 1.5) * 2.5;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(p * 18 + i * 1.4);
        ctx.fillStyle = i % 2 === 0 ? '#4ade80' : '#16a34a';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.6, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(74, 222, 128, ${1 - hitP})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 + hitP * 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'ice': {
      for (let i = 0; i < 3; i++) {
        const u = Math.max(0, Math.min(1, (p - i * 0.04) / Math.max(0.15, hitR)));
        if (p <= hitR + 0.12) {
          const ix = sx + (tx - sx) * u + (i - 1) * 2;
          const iy = sy + (ty - sy) * u + (i - 1) * 3;
          ctx.fillStyle = '#bae6fd';
          ctx.beginPath();
          ctx.moveTo(ix + 4, iy);
          ctx.lineTo(ix, iy - 2.5);
          ctx.lineTo(ix - 3, iy);
          ctx.lineTo(ix, iy + 2.5);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(125, 211, 252, ${1 - hitP})`;
        ctx.lineWidth = 1.6;
        const rad = 4 + hitP * 12;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (k * Math.PI) / 3 + hitP * 0.6;
          const px = tx + Math.cos(ang) * rad;
          const py = ty + Math.sin(ang) * rad;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
      break;
    }

    case 'fighting': {
      if (p >= hitR * 0.72) {
        const bp = (p - hitR * 0.72) / Math.max(0.1, 1 - hitR * 0.72);
        const a = 1 - bp;
        ctx.strokeStyle = `rgba(251, 146, 60, ${a})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 + bp * 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(254, 240, 138, ${a})`;
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4 + 0.2;
          ctx.beginPath();
          ctx.moveTo(tx + Math.cos(ang) * (3 + bp * 4), ty + Math.sin(ang) * (3 + bp * 4));
          ctx.lineTo(tx + Math.cos(ang) * (8 + bp * 10), ty + Math.sin(ang) * (8 + bp * 10));
          ctx.stroke();
        }
      }
      break;
    }

    case 'poison': {
      const cx = sx + (tx - sx) * flyU;
      const cy = sy + (ty - sy) * flyU - Math.sin(flyU * Math.PI) * 12;
      if (p <= hitR + 0.1) {
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e9d5ff';
        ctx.beginPath();
        ctx.arc(cx - 1.5, cy - 1.5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hitP > 0 && !fx.dodged) {
        for (let i = 0; i < 5; i++) {
          const ang = (i * Math.PI * 2) / 5 + 0.4;
          const r = 3 + hitP * 11;
          ctx.fillStyle = `rgba(192, 132, 252, ${1 - hitP})`;
          ctx.beginPath();
          ctx.arc(tx + Math.cos(ang) * r, ty + Math.sin(ang) * r, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    case 'ground': {
      const spikes = 4;
      for (let i = 1; i <= spikes; i++) {
        const thresh = (i / (spikes + 1)) * Math.max(0.25, hitR + 0.12);
        if (p < thresh) continue;
        const fade = Math.max(0, 1 - Math.max(0, p - 0.65) / 0.35);
        const gx = sx + (tx - sx) * (i / spikes);
        const gy = from.y + (to.y - from.y) * (i / spikes) - 2;
        ctx.fillStyle = `rgba(217, 119, 6, ${fade})`;
        ctx.beginPath();
        ctx.moveTo(gx - 3, gy);
        ctx.lineTo(gx, gy - 8);
        ctx.lineTo(gx + 3, gy);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }

    case 'rock': {
      const cx = sx + (tx - sx) * flyU;
      const cy = sy + (ty - sy) * flyU - Math.sin(flyU * Math.PI) * 16;
      if (p <= hitR + 0.1) {
        ctx.fillStyle = '#a16207';
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy + 2);
        ctx.lineTo(cx - 2, cy - 4);
        ctx.lineTo(cx + 4, cy - 2);
        ctx.lineTo(cx + 3, cy + 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(217, 119, 6, ${1 - hitP})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 + hitP * 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'ghost': {
      const cx = sx + (tx - sx) * flyU;
      const cy = sy + (ty - sy) * flyU + Math.sin(flyU * Math.PI * 2) * 3;
      if (p <= hitR + 0.12) {
        ctx.fillStyle = 'rgba(109, 40, 217, 0.85)';
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ddd6fe';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(139, 92, 246, ${1 - hitP})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + hitP * 15, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'psychic': {
      for (let i = 0; i < 3; i++) {
        const u = Math.max(0, Math.min(1, p * 1.25 - i * 0.12));
        const rx = sx + (tx - sx) * Math.min(1, u / Math.max(0.2, hitR + 0.15));
        const ry = sy + (ty - sy) * Math.min(1, u / Math.max(0.2, hitR + 0.15));
        const a = Math.max(0, 1 - p) * 0.85;
        ctx.strokeStyle = `rgba(244, 114, 182, ${a})`;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(rx, ry, 4 + u * 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'dragon': {
      const k = Math.min(1, p / Math.max(0.15, hitR));
      const mx = sx + (tx - sx) * k;
      const my = sy + (ty - sy) * k - Math.sin(k * Math.PI) * 18;
      if (p <= hitR + 0.14) {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(mx, my);
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(129, 140, 248, ${1 - hitP})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + hitP * 17, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'fairy': {
      for (let i = 0; i < 5; i++) {
        const u = Math.max(0, Math.min(1, flyU * 1.15 - i * 0.06));
        const px = sx + (tx - sx) * u + Math.sin(u * 8 + i) * 4;
        const py = sy + (ty - sy) * u - Math.sin(u * Math.PI) * 14 + (i - 2) * 2;
        ctx.fillStyle = i % 2 === 0 ? '#f472b6' : '#fef08a';
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hitP > 0 && !fx.dodged) {
        ctx.strokeStyle = `rgba(244, 114, 182, ${1 - hitP})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + hitP * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'buff': {
      const a = p < 0.7 ? 0.9 : (1 - p) / 0.3;
      for (let i = 0; i < 2; i++) {
        const ringP = (p + i * 0.35) % 1;
        ctx.strokeStyle = `rgba(74, 222, 128, ${a * (1 - ringP * 0.6)})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(sx, from.y - 3 - ringP * 18, 10 - ringP * 3, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'beam': {
      const alpha = p < 0.7 ? 0.92 : (1 - p) / 0.3;
      const endU = Math.min(1, p / Math.max(0.15, hitR));
      ctx.strokeStyle = `rgba(192, 132, 252, ${alpha})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (tx - sx) * endU, sy + (ty - sy) * endU);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }

    case 'slash': {
      if (p >= hitR * 0.65) {
        const sp = (p - hitR * 0.65) / Math.max(0.1, 1 - hitR * 0.65);
        const a = 1 - sp;
        ctx.strokeStyle = `rgba(248, 113, 113, ${a})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(tx - 9, ty - 9);
        ctx.lineTo(tx + 9, ty + 9);
        ctx.moveTo(tx + 9, ty - 9);
        ctx.lineTo(tx - 9, ty + 9);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }

    case 'star': {
      for (let i = 0; i < 4; i++) {
        const u = Math.max(0, Math.min(1, flyU * 1.15 - i * 0.06));
        const px = sx + (tx - sx) * u + Math.sin(u * 6 + i) * 3;
        const py = sy + (ty - sy) * u - Math.sin(u * Math.PI) * 14 + (i - 1.5) * 2.5;
        ctx.fillStyle = i % 2 === 0 ? '#fde047' : '#ffffff';
        ctx.fillRect(Math.round(px) - 1.5, Math.round(py) - 1.5, 3, 3);
      }
      break;
    }
  }
  ctx.restore();
}

export function drawArenaOverlay(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  camera: Camera,
  now: number,
  reserve?: (x: number, y: number, w: number, h: number) => void,
): void {
  const arena = sim.building.arena;
  if (!arena) return;
  const r = arena.rect;
  const dpr = camera.dpr;
  const t = camera.transform();
  const k = t.scale / dpr;
  const ox = t.ox / dpr;
  const oy = t.oy / dpr;
  const zoom = camera.zoom;
  const sx = (wx: number) => wx * k + ox;
  const sy = (wy: number) => wy * k + oy;

  const st = sim.arena.state;
  // 顶部对决牌水平居中于决斗场区域（1.35..5.35 为左墙冠军牌，11.05..14.3 为右墙倒计时电视）
  const centerX = sx((r.x + r.w / 2) * TILE);
  const maxBannerW = Math.max(96, Math.round(9.6 * TILE * k));
  const topY = sy((r.y + (st.phase === 'idle' ? 0.95 : 2.35)) * TILE);

  const leftX = sx(r.x * TILE);
  const rightX = sx((r.x + r.w) * TILE);
  const topBound = sy(r.y * TILE);
  const botBound = sy((r.y + r.h) * TILE);
  if (rightX < -160 || leftX > camera.viewW + 160 || botBound < -80 || topBound > camera.viewH + 80) {
    return;
  }

  ctx.save();
  ctx.textBaseline = 'middle';

  // ---- 顶部对决牌子：XXX vs XXX + 倒计时 / 血条
  let bannerBotY = topY + 12;
  if (st.phase === 'idle') {
    const label = '⚡ 宝可梦决斗场';
    ctx.font = `700 ${zoom < 1.35 ? 10.5 : 12}px ${UI_FONT}`;
    const w = Math.ceil(ctx.measureText(label).width) + 18;
    const h = zoom < 1.35 ? 20 : 23;
    const bx = Math.round(centerX - w / 2);
    const by = Math.round(topY - h / 2);
    ctx.fillStyle = 'rgba(20, 26, 40, 0.88)';
    ctx.strokeStyle = 'rgba(212, 175, 79, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fde68a';
    ctx.textAlign = 'center';
    ctx.fillText(label, centerX, by + h / 2 + 0.5);
    reserve?.(bx, by, w, h);
    bannerBotY = by + h;
  } else {
    const leftName = st.leftName ?? '红方';
    const rightName = st.rightName ?? '蓝方';
    const secLeft = st.phase === 'fight' ? Math.max(0, Math.ceil((st.endsAt - now) / 1000)) : 0;
    const mm = String(Math.floor(secLeft / 60)).padStart(2, '0');
    const ss = String(secLeft % 60).padStart(2, '0');
    const statusText =
      st.phase === 'gather'
        ? '入场准备中…'
        : st.phase === 'finish'
          ? `🏆 ${st.winnerName ?? leftName} 获胜！`
          : `⏱ ${mm}:${ss}`;

    const compact = zoom < 1.35;
    if (compact) {
      const txt = `⚔️ ${leftName} vs ${rightName} · ${st.phase === 'fight' ? `${mm}:${ss}` : st.phase === 'finish' ? `🏆${st.winnerName}` : '准备'}`;
      ctx.font = `700 10.5px ${UI_FONT}`;
      const w = Math.min(maxBannerW, Math.ceil(ctx.measureText(txt).width) + 16);
      const h = 20;
      const bx = Math.round(centerX - w / 2);
      const by = Math.round(topY - h / 2);
      ctx.fillStyle = 'rgba(15, 22, 36, 0.92)';
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(txt, centerX, by + h / 2 + 0.5, w - 8);
      reserve?.(bx, by, w, h);
      bannerBotY = by + h;
    } else {
      const leftTypes = st.leftTypes ?? [];
      const rightTypes = st.rightTypes ?? [];
      const badgeCountL = Math.min(2, leftTypes.length);
      const badgeCountR = Math.min(2, rightTypes.length);
      const boxW = Math.max(196, Math.min(276, maxBannerW, Math.round(6.6 * TILE * k)));
      const boxH = 38;
      const bx = Math.round(centerX - boxW / 2);
      const by = Math.round(topY - boxH / 2 + 2);
      reserve?.(bx, by, boxW, boxH);
      bannerBotY = by + boxH;

      ctx.fillStyle = 'rgba(13, 19, 32, 0.92)';
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.88)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      const drawTypePills = (types: readonly PokemonType[], startX: number, y: number, alignRight: boolean): number => {
        const pillW = 13;
        const pillH = 11;
        const gap = 2;
        const total = types.slice(0, 2);
        let curX = alignRight ? startX - total.length * (pillW + gap) + gap : startX;
        for (const tp of total) {
          const meta = POKEMON_TYPE_META[tp];
          ctx.fillStyle = meta.bg;
          ctx.beginPath();
          ctx.roundRect(curX, y - pillH / 2, pillW, pillH, 3);
          ctx.fill();
          ctx.font = `700 8.5px ${UI_FONT}`;
          ctx.fillStyle = meta.color;
          ctx.textAlign = 'center';
          ctx.fillText(meta.shortZh, curX + pillW / 2, y + 0.5);
          curX += pillW + gap;
        }
        return total.length ? total.length * (pillW + gap) + 2 : 0;
      };

      // 名字行：红方[属性] VS [属性]蓝方
      const rowY = by + 12;
      const lBadgeW = drawTypePills(leftTypes, bx + 8, rowY, false);
      const rBadgeW = drawTypePills(rightTypes, bx + boxW - 8, rowY, true);
      const leftSideMax = Math.max(24, Math.floor((boxW - 44) / 2 - badgeCountL * 15));
      const rightSideMax = Math.max(24, Math.floor((boxW - 44) / 2 - badgeCountR * 15));
      void lBadgeW;
      void rBadgeW;

      ctx.font = `700 11px ${UI_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fca5a5';
      ctx.fillText(leftName, centerX - 14, rowY, leftSideMax);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.font = `800 10.5px ${UI_FONT}`;
      ctx.fillText('VS', centerX, rowY);

      ctx.font = `700 11px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(rightName, centerX + 14, rowY, rightSideMax);

      // 与命中帧同步的平滑血条
      let dispLeftHp = st.leftHp;
      let dispRightHp = st.rightHp;
      const curFx = st.fx;
      if (curFx && now >= curFx.at && now <= curFx.until && curFx.prevTargetHp !== undefined) {
        const span = Math.max(1, curFx.until - curFx.at);
        const u = (now - curFx.at) / span;
        const hitR = curFx.hitRatio ?? 0.38;
        const ease = u < hitR ? 0 : Math.min(1, (u - hitR) / 0.22);
        if (curFx.toId === st.leftId) {
          dispLeftHp = curFx.prevTargetHp + (st.leftHp - curFx.prevTargetHp) * ease;
        } else if (curFx.toId === st.rightId) {
          dispRightHp = curFx.prevTargetHp + (st.rightHp - curFx.prevTargetHp) * ease;
        }
      }

      // 下方血条 + 倒计时/结果
      const barY = by + 24;
      const barW = Math.floor((boxW - 86) / 2);
      const barH = 6;
      const lx0 = bx + 10;
      const rx0 = bx + boxW - 10 - barW;

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(lx0, barY, barW, barH);
      ctx.fillRect(rx0, barY, barW, barH);

      const lw = Math.round((barW * Math.max(0, Math.min(100, dispLeftHp))) / 100);
      ctx.fillStyle = dispLeftHp > 35 ? '#ef4444' : '#f97316';
      ctx.fillRect(lx0 + (barW - lw), barY, lw, barH);

      const rw = Math.round((barW * Math.max(0, Math.min(100, dispRightHp))) / 100);
      ctx.fillStyle = dispRightHp > 35 ? '#3b82f6' : '#f97316';
      ctx.fillRect(rx0, barY, rw, barH);

      ctx.font = `700 10px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = st.phase === 'finish' ? '#fde047' : '#e2e8f0';
      ctx.fillText(statusText, centerX, barY + barH / 2 + 0.5, 72);
    }
  }

  // ---- 招式播报条（替代选手头顶说话气泡） + 伤害 / 属性克制 / 暴击 / 闪避 / Buff 飘字
  const activeFx = st.fx;
  if (st.phase === 'fight' && activeFx && now >= activeFx.at && now <= activeFx.until && zoom >= 0.7) {
    const span = Math.max(1, activeFx.until - activeFx.at);
    const u = (now - activeFx.at) / span;
    const hitR = activeFx.hitRatio ?? 0.38;
    const fromChar = sim.chars.get(activeFx.fromId);
    const toChar = sim.chars.get(activeFx.toId);
    const attackerName = fromChar?.info.name ?? (activeFx.fromId === st.leftId ? st.leftName ?? '红方' : st.rightName ?? '蓝方');

    // 1) 顶部 VS 横幅下方招式播报条（绝不遮挡选手与技能特效）
    const stripAlpha = u > 0.82 ? Math.max(0, (1 - u) / 0.18) : Math.min(1, u / 0.12);
    const moveText = `${attackerName} ▸ ${activeFx.moveName}`;
    const stripFont = `700 ${zoom < 1.35 ? 9.5 : 10.5}px ${UI_FONT}`;
    ctx.font = stripFont;
    const stripW = Math.min(maxBannerW, Math.ceil(ctx.measureText(moveText).width) + 20);
    const stripH = zoom < 1.35 ? 16 : 18;
    const stripX = Math.round(centerX - stripW / 2);
    const stripY = Math.round(bannerBotY + 3);
    const accentBg = activeFx.moveType ? POKEMON_TYPE_META[activeFx.moveType].bg : '#facc15';
    ctx.save();
    ctx.globalAlpha = stripAlpha;
    ctx.fillStyle = 'rgba(13, 19, 32, 0.88)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(stripX, stripY, stripW, stripH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accentBg;
    ctx.beginPath();
    ctx.roundRect(stripX, stripY, 4, stripH, [6, 0, 0, 6]);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(moveText, centerX + 2, stripY + stripH / 2 + 0.5, stripW - 14);
    ctx.restore();
    reserve?.(stripX, stripY, stripW, stripH);

    // 预留双方与技能弹道走廊，防止围观群众气泡侵入战场
    if (fromChar && toChar) {
      const fxMinX = Math.round(sx(Math.min(fromChar.x, toChar.x) - 10));
      const fxMaxX = Math.round(sx(Math.max(fromChar.x, toChar.x) + 10));
      const fxTopY = Math.round(sy(Math.min(fromChar.y, toChar.y) - 24));
      const fxBotY = Math.round(sy(Math.max(fromChar.y, toChar.y)));
      reserve?.(fxMinX, fxTopY, Math.max(16, fxMaxX - fxMinX), Math.max(16, fxBotY - fxTopY));
    }

    const drawFloatText = (text: string, wx: number, wy: number, fill: string, fontPx: number, alpha: number) => {
      if (alpha <= 0.02) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${fontPx}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 14, 24, 0.92)';
      ctx.strokeText(text, wx, wy);
      ctx.fillStyle = fill;
      ctx.fillText(text, wx, wy);
      ctx.restore();
      const tw = Math.ceil(ctx.measureText(text).width) + 6;
      reserve?.(Math.round(wx - tw / 2), Math.round(wy - fontPx / 2 - 2), tw, fontPx + 4);
    };

    if (activeFx.category === 'status' && fromChar && u >= 0.25) {
      const popU = (u - 0.25) / 0.75;
      const alpha = popU > 0.75 ? (1 - popU) / 0.25 : 1;
      const outDir = activeFx.fromId === st.leftId ? -1 : 1;
      const fxX = sx(fromChar.x + outDir * 9);
      const fxY = sy(fromChar.y - 30) - popU * 14;
      drawFloatText(activeFx.buffText ?? '状态提升！⬆️', fxX, fxY, '#4ade80', zoom < 1.35 ? 10.5 : 12, alpha);
    } else if (toChar && u >= hitR && activeFx.category !== 'status') {
      const popU = (u - hitR) / Math.max(0.1, 1 - hitR);
      const alpha = popU > 0.75 ? (1 - popU) / 0.25 : 1;
      const outDir = activeFx.toId === st.leftId ? -1 : 1;
      const popX = sx(toChar.x + outDir * 9);
      const popY = sy(toChar.y - 31) - popU * 16;
      const basePx = zoom < 1.35 ? 11 : 13;

      if (activeFx.dodged) {
        drawFloatText('💨 闪避！', popX, popY, '#7dd3fc', basePx, alpha);
      } else if (activeFx.effectiveness === 'immune') {
        drawFloatText('🛡️ 没有效果', popX, popY, '#94a3b8', basePx, alpha);
      } else {
        const dmg = activeFx.damage ?? 0;
        let subLabel = '';
        let subColor = '#fde047';
        let dmgColor = '#ffffff';
        if (activeFx.crit) {
          subLabel = '💥 会心一击！';
          subColor = '#fde047';
          dmgColor = '#fde047';
        } else if (activeFx.effectiveness === 'double_super') {
          subLabel = '🔥 效果拔群！×2';
          subColor = '#fb923c';
          dmgColor = '#fb7185';
        } else if (activeFx.effectiveness === 'super') {
          subLabel = '⚡ 效果绝佳！';
          subColor = '#fb923c';
          dmgColor = '#fda4af';
        } else if (activeFx.effectiveness === 'not_very') {
          subLabel = '💧 效果不好…';
          subColor = '#93c5fd';
          dmgColor = '#cbd5e1';
        }
        drawFloatText(`-${dmg}`, popX, popY, dmgColor, activeFx.crit ? basePx + 2 : basePx, alpha);
        let nextY = popY - (basePx + 1);
        if (subLabel) {
          drawFloatText(subLabel, popX, nextY, subColor, Math.max(9.5, basePx - 2), alpha);
          nextY -= Math.max(10, basePx - 1);
        }
        if (activeFx.awakenText) {
          drawFloatText(activeFx.awakenText, popX, nextY, '#fb923c', Math.max(9.5, basePx - 2), alpha);
        }
      }
    }
  }

  // ---- 门口左侧墙上「上届冠军」牌匾文字
  const plaqueLeft = sx(r.x * TILE + 1.35 * TILE + 2);
  const plaqueTop = sy(r.y * TILE + 0.22 * TILE + 2);
  const plaqueW = 60 * k;
  const plaqueH = 20 * k;
  if (plaqueW >= 24 && plaqueH >= 8) {
    const plaqueCx = plaqueLeft + plaqueW / 2;
    const compactPlaque = plaqueW < 52;
    const header = compactPlaque ? '🏆上届' : '🏆 上届冠军';
    const headerFont = Math.max(7, Math.min(10, Math.round(plaqueH * 0.28)));
    ctx.textAlign = 'center';

    if (st.prevChampion) {
      const score = `${st.prevChampion.wins}胜${st.prevChampion.losses}负`;
      if (plaqueH >= 24 && !compactPlaque) {
        const nameFont = Math.max(8, Math.min(11.5, Math.round(plaqueH * 0.30)));
        const scoreFont = Math.max(7.5, Math.min(10.5, Math.round(plaqueH * 0.25)));
        ctx.font = `700 ${headerFont}px ${UI_FONT}`;
        ctx.fillStyle = '#fde047';
        ctx.fillText(header, plaqueCx, plaqueTop + plaqueH * 0.20, plaqueW - 4);

        ctx.font = `700 ${nameFont}px ${UI_FONT}`;
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(st.prevChampion.name, plaqueCx, plaqueTop + plaqueH * 0.52, plaqueW - 4);

        ctx.font = `700 ${scoreFont}px ${UI_FONT}`;
        ctx.fillStyle = '#86efac';
        ctx.fillText(score, plaqueCx, plaqueTop + plaqueH * 0.82, plaqueW - 4);
      } else {
        const bodyFont = Math.max(7.5, Math.min(11, Math.round(plaqueH * 0.34)));
        ctx.font = `700 ${headerFont}px ${UI_FONT}`;
        ctx.fillStyle = '#fde047';
        ctx.fillText(header, plaqueCx, plaqueTop + plaqueH * 0.30, plaqueW - 3);

        ctx.font = `700 ${bodyFont}px ${UI_FONT}`;
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(compactPlaque ? st.prevChampion.name : `${st.prevChampion.name} ${score}`, plaqueCx, plaqueTop + plaqueH * 0.72, plaqueW - 3);
      }
    } else {
      const bodyFont = Math.max(7.5, Math.min(11, Math.round(plaqueH * 0.32)));
      ctx.font = `700 ${headerFont}px ${UI_FONT}`;
      ctx.fillStyle = '#fde047';
      ctx.fillText(header, plaqueCx, plaqueTop + plaqueH * 0.30, plaqueW - 3);

      ctx.font = `600 ${bodyFont}px ${UI_FONT}`;
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('虚位以待', plaqueCx, plaqueTop + plaqueH * 0.72, plaqueW - 3);
    }
    reserve?.(plaqueLeft - 2, plaqueTop - 2, plaqueW + 4, plaqueH + 4);
  }

  // ---- 门口右侧墙上电视机屏幕文字（下场比赛倒计时 秒）
  const tvLeft = sx(r.x * TILE + 11.05 * TILE + 2);
  const tvTop = sy(r.y * TILE + 0.22 * TILE + 2);
  const tvW = 48 * k;
  const tvH = 19 * k;
  if (tvW >= 26 && tvH >= 10) {
    const tvCx = tvLeft + tvW / 2;
    let line1 = '下场比赛';
    let line2 = '待机中';
    let line2Color = '#86efac';

    if (st.phase === 'idle') {
      if (st.nextDuelAt && st.nextDuelAt > 0) {
        if (st.nextDuelAt > now) {
          const sec = Math.max(0, Math.ceil((st.nextDuelAt - now) / 1000));
          line1 = tvW >= 54 ? '下场倒计时' : '下场';
          line2 = tvW >= 42 ? `${sec} 秒` : `${sec}s`;
          line2Color = sec <= 10 ? '#fde047' : '#4ade80';
        } else {
          line1 = tvW >= 54 ? '即将开赛' : '开赛';
          line2 = tvW >= 42 ? '0 秒' : '0s';
          line2Color = '#fde047';
        }
      } else {
        line1 = tvW >= 54 ? '等待宝可梦' : '待机';
        line2 = tvW >= 48 ? '需≥2只参赛' : '等选手';
        line2Color = '#94a3b8';
      }
    } else if (st.phase === 'gather') {
      line1 = tvW >= 54 ? '即将开赛' : '开赛';
      line2 = '入场中';
      line2Color = '#fde047';
    } else if (st.phase === 'fight') {
      const secLeft = Math.max(0, Math.ceil((st.endsAt - now) / 1000));
      line1 = tvW >= 54 ? '🔴 决斗中' : '决斗中';
      line2 = tvW >= 48 ? `余 ${secLeft} 秒` : `${secLeft}s`;
      line2Color = '#fca5a5';
    } else if (st.phase === 'finish') {
      line1 = tvW >= 54 ? '本场结束' : '结束';
      line2 = '🏆 胜负已分';
      line2Color = '#fde047';
    }

    ctx.textAlign = 'center';
    const f1 = Math.max(7.5, Math.min(10.5, Math.round(tvH * 0.28)));
    const f2 = Math.max(8.5, Math.min(13.5, Math.round(tvH * 0.42)));
    ctx.font = `600 ${f1}px ${UI_FONT}`;
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(line1, tvCx, tvTop + tvH * 0.3, tvW - 4);

    ctx.font = `800 ${f2}px ${UI_FONT}`;
    ctx.fillStyle = line2Color;
    ctx.fillText(line2, tvCx, tvTop + tvH * 0.71, tvW - 4);
    reserve?.(tvLeft - 2, tvTop - 2, tvW + 4, tvH + 4);
  }

  // ---- 右下角小排行榜牌子（含上届冠军）
  if (zoom >= 0.55) {
    const boardRows = st.leaderboard.slice(0, 3);
    const small = zoom < 1.35;
    const width = small ? 128 : 168;
    const rowH = small ? 13 : 15;
    const champH = small ? 15 : 17;
    const headerH = small ? 16 : 19;
    const height = champH + headerH + Math.max(1, boardRows.length) * rowH + 4;
    const anchorX = sx((r.x + r.w - 0.8) * TILE);
    const anchorY = sy((r.y + r.h - 1.1) * TILE);
    const px = Math.round(anchorX - width);
    const py = Math.round(anchorY - height);

    ctx.fillStyle = 'rgba(15, 22, 36, 0.9)';
    ctx.strokeStyle = 'rgba(212, 175, 79, 0.82)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.roundRect(px, py, width, height, 6);
    ctx.fill();
    ctx.stroke();
    reserve?.(px, py, width, height);

    // 上届冠军展示行
    const champY = py + (small ? 9 : 10);
    ctx.font = `700 ${small ? 8.5 : 9.5}px ${UI_FONT}`;
    if (st.prevChampion) {
      const champScore = `${st.prevChampion.wins}胜${st.prevChampion.losses}负`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fde047';
      ctx.fillText(`👑 上届: ${st.prevChampion.name}`, px + 6, champY, width - 48);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#86efac';
      ctx.fillText(champScore, px + width - 6, champY);
    } else {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fde047';
      ctx.fillText('👑 上届冠军', px + 6, champY, width - 54);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('虚位以待', px + width - 6, champY);
    }

    // 分隔线
    const divY = py + champH;
    ctx.fillStyle = 'rgba(212, 175, 79, 0.25)';
    ctx.fillRect(px + 6, divY, width - 12, 1);

    const headY = divY + (small ? 8 : 9);
    ctx.font = `700 ${small ? 9.5 : 10.5}px ${UI_FONT}`;
    ctx.fillStyle = '#fde047';
    ctx.textAlign = 'left';
    ctx.fillText(small ? '🏆 本小时榜' : '🏆 本小时决斗榜', px + 6, headY);

    ctx.font = `500 ${small ? 9 : 10}px ${UI_FONT}`;
    const listTop = divY + headerH + 2;
    if (!boardRows.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('暂无战绩（等待开赛）', px + 6, listTop + 3, width - 12);
    } else {
      boardRows.forEach((entry, idx) => {
        const y = listTop + 3 + idx * rowH;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
        const score = `${entry.wins}胜${entry.losses}负`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(`${medal}${entry.name}`, px + 6, y, width - 52);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#93c5fd';
        ctx.fillText(score, px + width - 6, y);
      });
    }
  }

  ctx.restore();
}
