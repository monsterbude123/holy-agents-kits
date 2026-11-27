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

// ---- transfer 的续传状态逻辑 ----
// 这三个函数直接决定「续传会不会用错内容」，是数据正确性相关的新逻辑，必须有测试。
{
  const { mkdtempSync, writeFileSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { statePathFor, readState, writeState } = await import('./transfer.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'bnm-state-'));
  const REMOTE = '/apps/bdpan/model-backup/x.zip';

  // 同一个远端路径 → 同一个状态文件（否则续传找不到自己）
  const p1 = statePathFor(REMOTE, dir);
  const p2 = statePathFor(REMOTE, dir);
  eq('同一远端路径状态文件一致', p1, p2);
  if (statePathFor('/apps/bdpan/model-backup/y.zip', dir) === p1) {
    console.error('FAIL 不同远端路径的状态文件应该不同');
    failed++;
  } else passed++;

  // 写 → 读回一致
  const obj = { remote: REMOTE, uploadid: 'U1', done: [0, 1, 2], sliceSize: 4194304, sha256: 'abc123' };
  writeState(p1, obj);
  eq('状态写入读回一致', JSON.stringify(readState(p1)), JSON.stringify(obj));

  // 原子写：不留 .tmp 残留
  const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  eq('原子写不留 .tmp 残留', leftovers.length, 0);

  // 坏文件要容忍（返回 null），不能抛
  writeFileSync(p1, '{ 这不是合法 JSON');
  eq('坏状态文件返回 null 而不是抛错', readState(p1), null);

  // 状态文件不存在也要返回 null
  eq('状态文件不存在返回 null', readState(join(dir, 'nope.json')), null);

  rmSync(dir, { recursive: true, force: true });
}

// ---- transfer 的分片偏移与并发锁 ----
{
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { readSlice, acquireLock, releaseLock } = await import('./transfer.mjs');
  const { digestFile } = await import('./hashes.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'bnm-slice-'));
  // 造一个跨多片、末片不满的内容
  const data = Buffer.alloc(4096 + 777);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) % 251;
  const fp = join(dir, 's.bin');
  writeFileSync(fp, data);
  const md5b = (b) => createHash('md5').update(b).digest('hex');

  // **上传就是按「第 idx 片 = 从 idx*sliceSize 处取 sliceSize 字节」取的**。
  // 偏移算错 → 传到服务端的是错位的片 → 拼出来的文件损坏，且不报错。
  // 这里逐片对拍：readSlice 取出来的内容 md5 必须等于 digestFile 报的该片 md5。
  const SLICE = 1024;
  const d = digestFile(fp, SLICE);
  let mismatch = 0;
  for (const b of d.blocks) {
    const got = md5b(readSlice(fp, b.index * SLICE, b.size));
    if (got !== b.md5) mismatch++;
  }
  eq('分片偏移逐片对拍全对（0 处错位）', mismatch, 0);
  eq('对拍覆盖了全部片', d.blocks.length, 5);

  // 末片不满：最后一片只有 777 字节，读出来也得是那 777 字节
  eq('末片长度正确', readSlice(fp, 4 * SLICE, 777).length, 777);

  // 并发锁：第二个进程应当拿不到
  const lock = join(dir, 'x.lock');
  acquireLock(lock);
  let locked = false;
  try { acquireLock(lock); } catch { locked = true; }
  eq('并发时第二个拿不到锁', locked, true);
  releaseLock(lock);
  let relocked = false;
  try { acquireLock(lock); releaseLock(lock); relocked = true; } catch {}
  eq('释放后能重新拿到锁', relocked, true);

  // 僵尸锁（持有者已死）要能回收
  const zombie = join(dir, 'z.lock');
  writeFileSync(zombie, JSON.stringify({ pid: 999999, at: Date.now() }));
  let recovered = false;
  try { acquireLock(zombie); releaseLock(zombie); recovered = true; } catch {}
  eq('僵尸锁（进程已死）可回收', recovered, true);

  rmSync(dir, { recursive: true, force: true });
}

console.log(`${failed ? 'FAIL' : 'OK'}：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
