#!/usr/bin/env node
// 脚本自检 —— 只测纯函数，不连网、不碰盘点库。
//
// 为什么必须有：这三个脚本共用 args.mjs 解析参数，而参数解析静默失效过一次——
// `Number('50MB')` 是 NaN，`size >= NaN` 恒假，`dup --min-size=50MB` 于是
// 「成功」返回 0 组、0 字节可回收，而实际有 541 组、261.6GB。
// 报错会被看见，NaN 不会。所以解析器必须有回归测试。
//
// 用法：node scripts/selftest.mjs     （退出码 0 = 全过）

import { parseArgs, num, parseSize } from './args.mjs';

let failed = 0, passed = 0;
const show = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v));
const eq = (name, got, want) => {
  const ok = Object.is(got, want);
  if (ok) { passed++; return; }
  failed++;
  console.error(`FAIL ${name}\n  得到 ${show(got)}\n  期望 ${show(want)}`);
};
const throws = (name, fn) => {
  try { fn(); } catch { passed++; return; }
  failed++;
  console.error(`FAIL ${name}：本该抛错，却没抛`);
};

// ---- parseSize：体积单位 ----
eq('50MB', parseSize('50MB', 0), 50 * 1024 ** 2);
eq('5GB', parseSize('5GB', 0), 5 * 1024 ** 3);
eq('5gb 小写', parseSize('5gb', 0), 5 * 1024 ** 3);
eq('1.5GB 小数', parseSize('1.5GB', 0), Math.floor(1.5 * 1024 ** 3));
eq('512B', parseSize('512B', 0), 512);
eq('纯字节数', parseSize('5368709120', 0), 5368709120);
eq('1T', parseSize('1T', 0), 1024 ** 4);
eq('1TB', parseSize('1TB', 0), 1024 ** 4);
eq('带空格 50 MB', parseSize('50 MB', 0), 50 * 1024 ** 2);
eq('没给值用默认', parseSize(undefined, 1024), 1024);

// 解析不出来必须抛错 —— 这条是整个自测的核心
throws('abc 不该被当成 0', () => parseSize('abc', 0));
throws('空串不该被当成 0', () => parseSize('', 0));
throws('负数不该通过', () => parseSize('-5GB', 0));
throws('未知单位不该通过', () => parseSize('50XB', 0));
throws('只写键不给值', () => parseSize(true, 0));

// ---- num：普通数字 ----
eq('默认', num(undefined, 7), 7);
eq('数字字符串', num('42', 0), 42);
throws('非数字要抛错', () => num('abc', 0));
throws('NaN 要抛错', () => num('NaN', 0));
throws('只写键不给值', () => num(true, 0));

// ---- parseArgs：参数抽取 ----
eq('--k=v', parseArgs(['--k=v'])['k'], 'v');
eq('--k 后跟独立值不并入', parseArgs(['--k', 'v'])['k'], true);
eq('非 -- 开头忽略', parseArgs(['stats', '--k=v'])['k'], 'v');
eq('没写就是没有', parseArgs([])['k'], undefined);
eq('后写的覆盖先写的', parseArgs(['--k=1', '--k=2'])['k'], '2');
eq('值里有等号', parseArgs(['--k=a=b'])['k'], 'a=b');

console.log(`${failed ? 'FAIL' : 'OK'}：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
