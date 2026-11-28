// time.mjs — 时间格式化
// 统一 ISO 8601 +08:00（Asia/Shanghai）

/**
 * 返回当前时间的 ISO 8601 字符串，时区固定 +08:00。
 * 格式：YYYY-MM-DDTHH:mm:ss+08:00
 */
export function nowIsoShanghai() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const h = get('hour');
  const mi = get('minute');
  const s = get('second');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`;
}
