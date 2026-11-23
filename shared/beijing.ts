/** 统一北京时间（UTC+8 / Asia/Shanghai）工具：不依赖宿主机或浏览器本地时区。 */
export const BEIJING_OFFSET_MS = 8 * 3_600_000;

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
