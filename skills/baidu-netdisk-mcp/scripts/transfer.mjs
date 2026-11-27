#!/usr/bin/env node
// 传输层：上传 / 下载 / 哈希 / 台账。
//
// 为什么不用 bdpan CLI 当主通道：它不吐任何进度、远端上传期间文件不可见、
// 也没有断点续传（实测：强杀后远端无残留，重跑从头）。
// 百度原生分片协议全通（precreate → superfile2 分片 → create），
// 服务端还会告诉我们**还缺哪几片** —— 续传是服务端驱动的，不是我们自己猜的。
//
// 用法：
//   node scripts/transfer.mjs upload   --file=<本地> --remote=/apps/bdpan/x.zip [--slice=4MB] [--retry=3]
//   node scripts/transfer.mjs download --remote=/apps/bdpan/x.zip --to=<本地> [--expect-sha256=<hex>]
//   node scripts/transfer.mjs hash     --file=<本地> [--slice=4MB]
//   node scripts/transfer.mjs ledger   [--dir=<台账目录>]
//
// I/O：stdout 单行 JSON 信封；进度与日志走 stderr；成功退出 0、失败 1。

import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, appendFileSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs, num, parseSize } from './args.mjs';
import { digestFile, sha256File, SLICE_BYTES } from './hashes.mjs';
import { resolveToken, precreate, uploadSlice, createFile, downloadLink, listDir, XpanError } from './xpan-api.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = parseArgs(argv.slice(1));

const out = [];
const say = (...a) => { const s = a.map(String).join(' '); out.push(s); process.stderr.write(s + '\n'); };

const DEFAULT_SLICE = SLICE_BYTES.free; // 4MB：普通用户也能用的下限
const DEFAULT_STATE = join(homedir(), '.baidu-transfer-state');

// 百度只认这三种切片大小（按会员等级）。传别的，服务端会在某一片上拒收 ——
// 早失败比传到一半被拒好。
const LEGAL_SLICES = [SLICE_BYTES.free, SLICE_BYTES.vip, SLICE_BYTES.svip];
function checkSlice(size) {
  if (!LEGAL_SLICES.includes(size)) {
    throw new Error(
      `切片大小必须是 ${LEGAL_SLICES.map((s) => human(s)).join(' / ')} 之一（百度按会员等级限定），收到 ${human(size)}`,
    );
  }
  return size;
}

function human(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = Number(b) || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(1) + u[i];
}

// ---- 进度条（stderr，\r 原地刷新，节流 200ms） ----
// 速度用**滑动窗口**（最近 5 秒），不是全程平均——平均会把刚加速的一段抹平。
function makeProgress(total, label) {
  const started = Date.now();
  const samples = [];
  let lastPaint = 0;
  return {
    tick(done) {
      const now = Date.now();
      samples.push([now, done]);
      while (samples.length > 2 && now - samples[0][0] > 5000) samples.shift();
      if (now - lastPaint < 200) return;
      lastPaint = now;
      const secs = (now - started) / 1000;
      const win = samples.length > 1 ? (now - samples[0][0]) / 1000 : secs;
      const speed = win > 0 ? (done - samples[0][1]) / win : 0;
      const eta = speed > 0 ? Math.max(0, (total - done) / speed) : NaN;
      const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
      const width = 24;
      const filled = Math.round((pct / 100) * width);
      const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
      const etaTxt = Number.isFinite(eta) ? `ETA ${eta < 60 ? Math.ceil(eta) + 's' : Math.ceil(eta / 60) + 'm'}` : 'ETA --';
      process.stderr.write(`\r  [${bar}] ${pct.toFixed(1).padStart(5)}%  ${human(done)}/${human(total)}  ${human(speed)}/s  ${etaTxt}  ${label}   `);
    },
    done() {
      process.stderr.write('\r' + ' '.repeat(120) + '\r');
    },
  };
}

// ---- 状态文件（续传用） ----
// 关键：**每传完一片就落盘**。进程被杀 / 断网，下一次带上 uploadid 重跑，
// 服务端会回「还缺哪几片」，只补缺的。
function statePathFor(remote, dir) {
  const key = createHash('sha1').update(remote).digest('hex').slice(0, 16);
  return join(dir, `${key}.json`);
}
function readState(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
function writeState(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, p); // 原子替换：半截文件不会污染状态
}

// ---- 读文件的一段（按字节偏移） ----
function readSlice(file, offset, length) {
  const buf = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    const n = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, n);
  } finally { closeSync(fd); }
}

// ---- 重试（百度偶发瞬时故障，errno 31024 "app id is empty" 就是其中一种） ----
async function withRetry(fn, attempts, what) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts) {
        const wait = Math.min(2 ** i * 500, 8000);
        say(`  ${what} 第 ${i} 次失败（${e.message}），${Math.round(wait / 1000)}s 后重试`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ================= 上传 =================
async function cmdUpload() {
  const file = opt.file ? resolve(opt.file) : null;
  if (!file) throw new Error('需要 --file=<本地文件>');
  if (!existsSync(file)) throw new Error(`本地文件不存在：${file}`);
  const remote = opt.remote;
  if (!remote) throw new Error('需要 --remote=/apps/bdpan/<路径>');
  if (!remote.startsWith('/apps/bdpan/')) {
    throw new Error(`远端路径必须以 /apps/bdpan/ 开头（这是本账号的应用数据区）：${remote}`);
  }

  const token = resolveToken();
  const sliceSize = checkSlice(parseSize(opt.slice, DEFAULT_SLICE));
  const retries = num(opt.retry, 3);
  const stateDir = opt['state-dir'] ? resolve(opt['state-dir']) : DEFAULT_STATE;

  say(`上传 ${file} → ${remote}（切片 ${human(sliceSize)}）`);
  const t0 = Date.now();

  // 一次流式读，算出整文件 sha256 + 每片 md5（block_list 必须是标准 md5）
  const digest = digestFile(file, sliceSize);
  say(`  本地 sha256 ${digest.sha256.slice(0, 16)}… · ${digest.blocks.length} 片 · ${human(digest.size)}`);

  // 续传：带上次的 uploadid
  const sp = statePathFor(remote, stateDir);
  const prev = readState(sp);
  const pre = await withRetry(
    () => precreate(token, { path: remote, size: digest.size, blockList: digest.blockList, uploadid: prev?.uploadid }),
    retries, '预上传',
  );
  const resumed = !!prev?.uploadid;
  say(`  uploadid ${pre.uploadid.slice(0, 24)}… · 服务端要求传 ${pre.missing.length}/${digest.blocks.length} 片${resumed ? '（续传）' : ''}`);

  // 进度起点：已完成的片（服务端说不用传的）算已完成
  const doneSet = new Set(digest.blocks.map((_, i) => i).filter((i) => !pre.missing.includes(i)));
  let doneBytes = digest.blocks.filter((b) => doneSet.has(b.index)).reduce((a, b) => a + b.size, 0);
  const prog = makeProgress(digest.size, '上传中');
  prog.tick(doneBytes);

  for (const idx of pre.missing) {
    const meta = digest.blocks[idx];
    if (!meta) throw new Error(`服务端要第 ${idx} 片，但本地只有 ${digest.blocks.length} 片（切片大小对不上？）`);
    const buf = readSlice(file, idx * sliceSize, meta.size);
    const r = await withRetry(
      () => uploadSlice(token, { path: remote, uploadid: pre.uploadid, partseq: idx, buffer: buf }),
      retries, `第 ${idx} 片上传`,
    );
    // 服务端回传该片 md5 —— 与我们提交的必须一致，否则这片没被正确接收
    if (r.md5 && r.md5 !== meta.md5) {
      throw new Error(`第 ${idx} 片校验不符：提交 ${meta.md5.slice(0, 12)}… 服务端回 ${r.md5.slice(0, 12)}…`);
    }
    doneSet.add(idx);
    doneBytes += meta.size;
    writeState(sp, { remote, uploadid: pre.uploadid, done: [...doneSet].sort((a, b) => a - b), sliceSize, updatedAt: Date.now() });
    prog.tick(doneBytes);
  }
  prog.done();

  // 建档：正式生成网盘文件。返回的 md5 是**网盘侧闭源变种**，只作身份标识。
  const cr = await withRetry(
    () => createFile(token, { path: remote, size: digest.size, blockList: digest.blockList, uploadid: pre.uploadid }),
    retries, '建档',
  );
  // 端到端核对：建档成功不等于远端就是我们要的那份 —— 查一眼远端实际大小
  try {
    const remote = await listDir(token, remote.slice(0, remote.lastIndexOf('/')) || '/', 200);
    const hit = remote.find((i) => i.path === (cr.path || remote));
    if (hit && Number(hit.size) !== digest.size) {
      throw new Error(`远端大小对不上：本地 ${digest.size}，远端 ${hit.size}`);
    }
  } catch (e) {
    if (e.message.startsWith('远端大小对不上')) throw e;
    say(`  （远端大小核对跳过：${e.message}）`);
  }

  const seconds = (Date.now() - t0) / 1000;
  // 状态文件用完了：删掉，避免下次误当续传（网盘上已有完整文件）
  try { unlinkSync(sp); } catch {}

  const speed = digest.size / Math.max(seconds, 0.001);
  say(`  完成：${cr.path || remote} · ${human(digest.size)} · ${seconds.toFixed(1)}s · ${human(speed)}/s${resumed ? ' · 续传' : ''}`);
  say(`  网盘 md5（闭源变种，仅作身份标识）：${cr.md5 || '(无)'}`);

  const entry = {
    ts: new Date().toISOString(), op: 'upload', local: file, remote: cr.path || remote,
    bytes: digest.size, sha256: digest.sha256, md5_local: digest.md5,
    sliceSize, blockList: digest.blockList, blocks: digest.blocks,
    seconds: Number(seconds.toFixed(2)), speed_bps: Math.round(speed),
    netdisk_md5: cr.md5 || null, fs_id: cr.fs_id || null, resumed,
  };
  appendLedger(entry);

  return {
    remote: cr.path || remote, fs_id: cr.fs_id || null, bytes: digest.size,
    sha256: digest.sha256, blocks: digest.blocks.length, resumed,
    seconds: Number(seconds.toFixed(2)), speed_bps: Math.round(speed),
    netdisk_md5: cr.md5 || null,
  };
}

// ================= 下载 =================
async function cmdDownload() {
  const remote = opt.remote;
  const to = opt.to ? resolve(opt.to) : null;
  if (!remote) throw new Error('需要 --remote=/apps/bdpan/<路径>');
  if (!to) throw new Error('需要 --to=<本地路径>');

  const token = resolveToken();
  const parent = remote.slice(0, remote.lastIndexOf('/')) || '/';
  const name = remote.slice(remote.lastIndexOf('/') + 1);

  // 找 fsid（远端路径 → fsid）
  const items = await listDir(token, parent, 200);
  const hit = items.find((i) => i.path === remote);
  if (!hit) throw new Error(`远端找不到：${remote}`);

  const link = await downloadLink(token, hit.fs_id);
  const total = link.size || statSync(to, { throwIfNoEntry: false })?.size || 0;

  // 断点续传：本地 .part 已存在且没下完 → 用 Range 接着下
  const partPath = `${to}.part`;
  let done = 0;
  if (existsSync(partPath)) {
    const partSize = statSync(partPath).size;
    if (total && partSize > total) {
      // 本地残片比远端还大：本地坏了，续传会直接 416。丢掉重来。
      unlinkSync(partPath);
      say('  本地 .part 比远端还大（残片损坏），丢弃重来');
    } else {
      done = partSize;
      say(`  发现未完成的 .part（${human(done)}），从断点继续`);
    }
  }
  if (existsSync(to) && (!total || statSync(to).size === total)) {
    say(`  目标已存在且大小一致，跳过：${to}`);
    const sha = sha256File(to);
    if (opt['expect-sha256'] && opt['expect-sha256'] !== sha) {
      throw new Error(`已存在文件的 sha256 与期望不符：期望 ${opt['expect-sha256']}，实际 ${sha}`);
    }
    return { to, bytes: total, sha256: sha, skipped: true };
  }

  const headers = done > 0 ? { Range: `bytes=${done}-` } : {};
  const res = await fetch(link.dlink, { headers });
  if (!res.ok && res.status !== 206) {
    throw new XpanError(`下载 HTTP ${res.status}`, { status: res.status });
  }
  const contentLength = Number(res.headers.get('content-length') || 0);
  const grandTotal = total || (contentLength + done);

  mkdirSync(dirname(to), { recursive: true });
  const outStream = createWriteStream(partPath, { flags: done > 0 ? 'a' : 'w' });
  const prog = makeProgress(grandTotal, '下载中');
  prog.tick(done);
  const t0 = Date.now();
  let written = done;
  try {
    for await (const chunk of res.body) {
      if (!outStream.write(chunk)) await new Promise((r) => outStream.once('drain', r));
      written += chunk.length;
      prog.tick(written);
    }
  } finally {
    await new Promise((r) => outStream.end(r));
  }
  prog.done();
  renameSync(partPath, to);

  const seconds = (Date.now() - t0) / 1000;
  const speed = (written - done) / Math.max(seconds, 0.001);
  say(`  完成：${to} · ${human(written)} · ${seconds.toFixed(1)}s · ${human(speed)}/s${done > 0 ? '（续传）' : ''}`);

  // 校验：sha256 是我们的尺子（网盘 md5 复现不出来，不能用）
  const sha = sha256File(to);
  if (opt['expect-sha256']) {
    if (opt['expect-sha256'] !== sha) {
      throw new Error(`sha256 校验失败：期望 ${opt['expect-sha256']}，实际 ${sha}`);
    }
    say(`  sha256 校验通过：${sha}`);
  } else {
    say(`  sha256 ${sha}`);
  }

  const entry = {
    ts: new Date().toISOString(), op: 'download', remote, to,
    bytes: written, sha256: sha, netdisk_md5: link.netdiskMd5 || null,
    seconds: Number(seconds.toFixed(2)), speed_bps: Math.round(speed), resumed: done > 0,
  };
  appendLedger(entry);
  return { to, bytes: written, sha256: sha, seconds: Number(seconds.toFixed(2)), speed_bps: Math.round(speed), resumed: done > 0 };
}

// ================= 哈希 / 台账 =================
async function cmdHash() {
  const file = opt.file ? resolve(opt.file) : null;
  if (!file) throw new Error('需要 --file=<本地文件>');
  const sliceSize = checkSlice(parseSize(opt.slice, DEFAULT_SLICE));
  const d = digestFile(file, sliceSize);
  say(`  sha256 ${d.sha256}`);
  say(`  md5    ${d.md5}`);
  say(`  ${d.blocks.length} 片（每片 ${human(sliceSize)}）`);
  for (const b of d.blocks) say(`    #${b.index} ${human(b.size).padStart(8)}  md5 ${b.md5}  sha256 ${b.sha256.slice(0, 16)}…`);
  return { file, size: d.size, sha256: d.sha256, md5: d.md5, sliceSize, blocks: d.blocks, blockList: d.blockList };
}

function ledgerPath(dir) {
  return join(dir ? resolve(dir) : DEFAULT_STATE, 'ledger.jsonl');
}
function appendLedger(entry) {
  const p = ledgerPath(opt['ledger-dir'] || opt.dir);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(entry) + '\n');
}
function cmdLedger() {
  const p = ledgerPath(opt.dir);
  if (!existsSync(p)) { say(`台账不存在：${p}`); return { ledger: p, entries: [] }; }
  const entries = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const e of entries) {
    say(`  ${e.ts}  ${e.op}  ${human(e.bytes || 0).padStart(9)}  ${e.sha256 ? e.sha256.slice(0, 12) + '…' : ''}  ${e.remote || e.to || ''}`);
  }
  return { ledger: p, count: entries.length, entries };
}

// ---------- 分派 ----------
const COMMANDS = { upload: cmdUpload, download: cmdDownload, hash: cmdHash, ledger: cmdLedger };
try {
  if (!cmd || !COMMANDS[cmd]) {
    process.stderr.write('用法: transfer.mjs <upload|download|hash|ledger> [选项]\n');
    process.exit(1);
  }
  const data = await COMMANDS[cmd]();
  process.stdout.write(JSON.stringify({ ok: true, command: cmd, data }) + '\n');
  process.exit(0);
} catch (e) {
  if (out.length) process.stderr.write(out.join('\n') + '\n');
  process.stdout.write(JSON.stringify({ ok: false, error: e.message, detail: e.detail || null }) + '\n');
  process.exit(1);
}
