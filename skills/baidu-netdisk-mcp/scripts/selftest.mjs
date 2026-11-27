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

// ---- hashes：流式哈希与分块 ----
// 这一段是「百度 block_list 必须对得上」的护栏：片边界错一位，
// 服务端就整片拒收，而本地不报错 —— 属于静默错误。
{
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { digestFile, sha256File, md5File, sliceSizeFor, SLICE_BYTES } = await import('./hashes.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'bnm-selftest-'));
  const write = (name, buf) => { const p = join(dir, name); writeFileSync(p, buf); return p; };
  const md5b = (b) => createHash('md5').update(b).digest('hex');
  const sha = (b) => createHash('sha256').update(b).digest('hex');

  // 切片大小按会员等级。
  // 断言必须钉**绝对字节值**，不能写成 sliceSizeFor(x) === SLICE_BYTES.y ——
  // 那是同义反复：把常量改错，测试照样绿（变异检验实测：32MB 改成 30MB 竟然没红）。
  eq('普通用户 4MB', sliceSizeFor(0), 4 * 1024 * 1024);
  eq('会员 16MB', sliceSizeFor(1), 16 * 1024 * 1024);
  eq('超级会员 32MB', sliceSizeFor(2), 32 * 1024 * 1024);
  eq('svip 常量就是 32MB', SLICE_BYTES.svip, 32 * 1024 * 1024);
  eq('free 常量就是 4MB', SLICE_BYTES.free, 4 * 1024 * 1024);

  // 小文件：单片
  const small = Buffer.from('hello netdisk');
  const pSmall = write('small.bin', small);
  const dSmall = digestFile(pSmall, 4 * 1024 * 1024);
  eq('小文件片数', dSmall.blocks.length, 1);
  eq('小文件整文件md5', dSmall.md5, md5b(small));
  eq('小文件整文件sha256', dSmall.sha256, sha(small));
  eq('小文件片md5', dSmall.blockList[0], md5b(small));
  eq('小文件片sha256', dSmall.blocks[0].sha256, sha(small));

  // 恰好整片：不应多出空片
  const exact = Buffer.alloc(1024, 7);
  const pExact = write('exact.bin', exact);
  const dExact = digestFile(pExact, 1024);
  eq('恰好整片的片数', dExact.blocks.length, 1);
  eq('恰好整片的片大小', dExact.blocks[0].size, 1024);

  // 整片 + 1 字节：两片，第二片 1 字节
  const over = Buffer.alloc(1025, 7);
  const pOver = write('over.bin', over);
  const dOver = digestFile(pOver, 1024);
  eq('整片+1 的片数', dOver.blocks.length, 2);
  eq('末片大小', dOver.blocks[1].size, 1);
  eq('末片md5', dOver.blocks[1].md5, md5b(Buffer.alloc(1, 7)));

  // 多片跨界：每片 md5 必须等于手工按同样边界切出来的 md5
  const big = Buffer.alloc(4096 + 100);
  for (let i = 0; i < big.length; i++) big[i] = i % 253;
  const pBig = write('big.bin', big);
  const dBig = digestFile(pBig, 1024);
  eq('多片片数', dBig.blocks.length, 5);
  const manual = [];
  for (let o = 0; o < big.length; o += 1024) manual.push(md5b(big.subarray(o, Math.min(o + 1024, big.length))));
  eq('多片每片md5与手工一致', JSON.stringify(dBig.blockList), JSON.stringify(manual));
  eq('多片整文件md5', dBig.md5, md5b(big));
  eq('多片整文件sha256', dBig.sha256, sha(big));
  eq('多片片index连续', JSON.stringify(dBig.blocks.map((b) => b.index)), JSON.stringify([0, 1, 2, 3, 4]));

  // 非法切片大小必须抛错，不能死循环（守卫有测试守着）
  let threw = false;
  try { digestFile(pSmall, 0); } catch { threw = true; }
  eq('切片大小为 0 要抛错（否则死循环）', threw, true);

  // 单文件哈希与分块版必须一致（不能因为流式切分改了整体结果）
  eq('sha256File 与 digestFile 一致', sha256File(pBig), dBig.sha256);
  eq('md5File 与 digestFile 一致', md5File(pBig), dBig.md5);

  rmSync(dir, { recursive: true, force: true });
}

console.log(`${failed ? 'FAIL' : 'OK'}：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
