import { TILE } from '../../art/api';
import type { SyncedArenaState } from '../../../../shared/types';
import type { Camera } from '../camera';
import type { TileRect } from '../layout/types';
import type { Sim } from '../sim/sim';
import type { Particles } from './particles';

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export interface ArenaFxTracker {
  lastFxId: number;
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

  if (fx.id !== tracker.lastFxId) {
    tracker.lastFxId = fx.id;
    particles.sparkle(to.x, to.y - 10);
  }

  const span = Math.max(1, fx.until - fx.at);
  const p = Math.max(0, Math.min(1, (now - fx.at) / span));
  const sx = from.x;
  const sy = from.y - 11;
  const tx = to.x;
  const ty = to.y - 11;

  ctx.save();
  switch (fx.kind) {
    case 'thunder': {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const steps = 6;
      for (let i = 1; i < steps; i++) {
        const u = i / steps;
        const jx = sx + (tx - sx) * u + (Math.sin(now / 28 + i * 3.1) * 5);
        const jy = sy + (ty - sy) * u + (Math.cos(now / 22 + i * 2.7) * 6 - 3);
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(tx, ty);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = `rgba(250, 204, 21, ${1 - p})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 5 + p * 14, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'fire': {
      const k = Math.min(1, p / 0.65);
      const cx = sx + (tx - sx) * k;
      const cy = sy + (ty - sy) * k - Math.sin(k * Math.PI) * 10;
      if (p < 0.72) {
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (p >= 0.5) {
        const bp = (p - 0.5) / 0.5;
        ctx.strokeStyle = `rgba(249, 115, 22, ${1 - bp})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, ty, 4 + bp * 15, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'water': {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (let i = 1; i <= 8; i++) {
        const u = i / 8;
        ctx.lineTo(
          sx + (tx - sx) * u,
          sy + (ty - sy) * u + Math.sin(u * Math.PI * 3 - p * 10) * 3,
        );
      }
      ctx.stroke();

      ctx.strokeStyle = `rgba(186, 230, 253, ${1 - p})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 4 + p * 13, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'beam': {
      const alpha = p < 0.7 ? 0.92 : (1 - p) / 0.3;
      ctx.strokeStyle = `rgba(192, 132, 252, ${alpha})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (tx - sx) * Math.min(1, p * 2.5), sy + (ty - sy) * Math.min(1, p * 2.5));
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }

    case 'slash': {
      const a = 1 - p;
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
      break;
    }

    case 'star': {
      for (let i = 0; i < 4; i++) {
        const u = Math.max(0, Math.min(1, p * 1.25 - i * 0.08));
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
  // 留出右侧挂壁倒计时电视（11.05..14.3 格）空间，将顶部对决牌居中在左侧至大门上方（5.6 格处）
  const centerX = sx((r.x + 5.65) * TILE);
  const maxBannerW = Math.max(96, Math.round(9.6 * TILE * k));
  const topY = sy((r.y + 1.05) * TILE);

  if (centerX < -240 || centerX > camera.viewW + 240 || topY < -80 || topY > camera.viewH + 120) {
    return;
  }

  ctx.save();
  ctx.textBaseline = 'middle';

  // ---- 顶部对决牌子：XXX vs XXX + 倒计时 / 血条
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
    } else {
      const boxW = Math.max(168, Math.min(248, maxBannerW, Math.round(5.7 * TILE * k)));
      const boxH = 38;
      const bx = Math.round(centerX - boxW / 2);
      const by = Math.round(topY - boxH / 2 + 2);
      reserve?.(bx, by, boxW, boxH);

      ctx.fillStyle = 'rgba(13, 19, 32, 0.92)';
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.88)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      // 名字行：红方 VS 蓝方
      const rowY = by + 12;
      const sideMax = Math.floor((boxW - 44) / 2);
      ctx.font = `700 11px ${UI_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fca5a5';
      ctx.fillText(leftName, centerX - 15, rowY, sideMax);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.font = `800 10.5px ${UI_FONT}`;
      ctx.fillText('VS', centerX, rowY);

      ctx.font = `700 11px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(rightName, centerX + 15, rowY, sideMax);

      // 下方血条 + 倒计时/结果
      const barY = by + 24;
      const barW = Math.floor((boxW - 86) / 2);
      const barH = 6;
      const lx0 = bx + 10;
      const rx0 = bx + boxW - 10 - barW;

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(lx0, barY, barW, barH);
      ctx.fillRect(rx0, barY, barW, barH);

      const lw = Math.round((barW * Math.max(0, Math.min(100, st.leftHp))) / 100);
      ctx.fillStyle = st.leftHp > 35 ? '#ef4444' : '#f97316';
      ctx.fillRect(lx0 + (barW - lw), barY, lw, barH);

      const rw = Math.round((barW * Math.max(0, Math.min(100, st.rightHp))) / 100);
      ctx.fillStyle = st.rightHp > 35 ? '#3b82f6' : '#f97316';
      ctx.fillRect(rx0, barY, rw, barH);

      ctx.font = `700 10px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = st.phase === 'finish' ? '#fde047' : '#e2e8f0';
      ctx.fillText(statusText, centerX, barY + barH / 2 + 0.5, 72);
    }
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
      if (st.nextDuelAt && st.nextDuelAt > now) {
        const sec = Math.max(0, Math.ceil((st.nextDuelAt - now) / 1000));
        line1 = tvW >= 54 ? '下场倒计时' : '下场';
        line2 = tvW >= 42 ? `${sec} 秒` : `${sec}s`;
        line2Color = sec <= 10 ? '#fde047' : '#4ade80';
      } else {
        line1 = tvW >= 54 ? '下场倒计时' : '下场';
        line2 = '准备中';
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

  // ---- 右下角小排行榜牌子
  if (zoom >= 0.85) {
    const boardRows = st.leaderboard.slice(0, 3);
    const small = zoom < 1.35;
    const width = small ? 112 : 148;
    const rowH = small ? 13 : 15;
    const height = (small ? 18 : 22) + Math.max(1, boardRows.length) * rowH + 4;
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

    ctx.font = `700 ${small ? 9.5 : 10.5}px ${UI_FONT}`;
    ctx.fillStyle = '#fde047';
    ctx.textAlign = 'left';
    ctx.fillText(small ? '🏆 本小时榜' : '🏆 本小时决斗榜', px + 7, py + (small ? 10 : 12));

    ctx.font = `500 ${small ? 9 : 10}px ${UI_FONT}`;
    if (!boardRows.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('暂无战绩（等待开赛）', px + 7, py + (small ? 22 : 26), width - 14);
    } else {
      boardRows.forEach((entry, idx) => {
        const y = py + (small ? 22 : 26) + idx * rowH;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
        const score = `${entry.wins}胜${entry.losses}负`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(`${medal}${entry.name}`, px + 6, y, width - 54);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#93c5fd';
        ctx.fillText(score, px + width - 6, y);
      });
    }
  }

  ctx.restore();
}
