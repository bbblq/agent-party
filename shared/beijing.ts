/** 统一北京时间（UTC+8 / Asia/Shanghai）工具：不依赖宿主机或浏览器本地时区。 */
export const BEIJING_OFFSET_MS = 8 * 3_600_000;

export const DEFAULT_LUNCH_START = '12:00';
export const DEFAULT_LUNCH_END = '13:00';

export interface BeijingParts {
  year: number;
  /** 0-indexed month (0 = January .. 11 = December) */
  month: number;
  /** 1-indexed day of month (1..31) */
  day: number;
  hour: number;
  minute: number;
  second: number;
  fractionalHour: number;
}

/** 当前时间戳所属的北京时间整点桶（整点加一，用于每小时决斗榜重置）。 */
export function beijingHourBucket(ms = Date.now()): number {
  return Math.floor((ms + BEIJING_OFFSET_MS) / 3_600_000);
}

/** 将 epoch ms 拆分为北京时间的年月日与时分秒。 */
export function beijingParts(ms = Date.now()): BeijingParts {
  const d = new Date(ms + BEIJING_OFFSET_MS);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour,
    minute,
    second,
    fractionalHour: hour + minute / 60 + second / 3600,
  };
}

/** 将用户输入规范化为 `HH:MM`（24 小时制）；无效时回退为 `fallback`。 */
export function normalizeTimeHm(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replaceAll('：', ':').trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(cleaned);
  if (!m) return fallback;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

/** 将 `HH:MM` 转换为从 00:00 起的分钟数。 */
export function parseMinutesHm(hm: string): number {
  const [hStr, mStr] = hm.split(':');
  return Number(hStr) * 60 + Number(mStr);
}

/** 判断指定时间戳按北京时间是否处于配置的午饭时间窗口 `[start, end)` 内（支持跨零点）。 */
export function isBeijingLunchTime(
  ms = Date.now(),
  opts?: { lunchEnabled?: boolean; lunchStart?: string; lunchEnd?: string },
): boolean {
  if (opts?.lunchEnabled === false) return false;
  const start = parseMinutesHm(normalizeTimeHm(opts?.lunchStart, DEFAULT_LUNCH_START));
  const end = parseMinutesHm(normalizeTimeHm(opts?.lunchEnd, DEFAULT_LUNCH_END));
  if (start === end) return false;
  const bp = beijingParts(ms);
  const cur = bp.hour * 60 + bp.minute;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}
