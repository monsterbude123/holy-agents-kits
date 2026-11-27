// 三个脚本共用的参数解析。
//
// 为什么要抽出来：解析逻辑原本在 db/move/model-backup 里各抄一份，
// 三份的严格程度不一样，于是同一个坑踩了两次——
//   db.mjs 的 dup 用 Number('50MB') 得 NaN，`size >= NaN` 恒假，dup 永远返回 0 组；
//   db.mjs 的 big 查表漏了 'GB' 键，回落成倍率 1，阈值从 5GB 变成 5 字节。
// 两处都不报错、退出码 0，看起来就是「没找到重复/没有大目录」——静默假结论。
//
// 规矩：**数字和体积解析不出来就抛错**。宁可命令失败，也不要成功但没做事。

// 只认 --key 与 --key=value。带值不加引号也能收（--path=/课程）。
export function parseArgs(list) {
  const opt = {};
  for (const a of list) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
  }
  return opt;
}

// 普通数字。解析不出来（或只写了键没写值）就报错，不要静默返回 NaN。
export function num(v, d) {
  if (v === undefined) return d;
  if (v === true) throw new Error('参数缺值：需要一个数字');
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`参数需要数字，收到：${v}`);
  return n;
}

const SIZE_UNITS = {
  B: 1, K: 1024, KB: 1024, M: 1024 ** 2, MB: 1024 ** 2,
  G: 1024 ** 3, GB: 1024 ** 3, T: 1024 ** 4, TB: 1024 ** 4,
};

// 体积：50MB / 5gb / 1.5GB / 5368709120 都认（大小写不敏感）。
// 解析不出来就报错——阈值一旦变成 NaN，筛选条件恒假，结果是「空」而不是「错」。
export function parseSize(v, d) {
  if (v === undefined) return d;
  if (v === true) throw new Error('参数缺值：需要一个体积');
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(String(v).trim());
  if (!m) throw new Error(`无法解析体积：${v}`);
  const unit = (m[2] || 'B').toUpperCase();
  const mult = SIZE_UNITS[unit];
  if (mult === undefined) throw new Error(`无法解析体积单位：${v}（支持 B/K/KB/M/MB/G/GB/T/TB）`);
  return Math.floor(Number(m[1]) * mult);
}
