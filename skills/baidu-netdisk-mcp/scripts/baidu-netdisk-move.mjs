#!/usr/bin/env node
// 百度网盘移动执行器 —— 读 spec，幂等地执行 file_move，逐项核对落地情况。
//
// 为什么不用 MCP 工具直接调：
//   1) file_move 的 async=1 只是「受理」，文件可能几分钟后才落地，errno=0 不代表搬成功；
//   2) 超大目录（>100GB）用 async=0 同步模式会被拒（errno -8），只能异步提交后轮询；
//   3) 批量调用要拆小批 + 逐项解析 info[]，出错时能精确知道哪几项没动。
//
// 用法:
//   node baidu-netdisk-move.mjs --spec=spec.json [--batch=10] [--async=0|1]
// spec 支持两种形状：[ {from,to,name} ] 或 { moves:[...], phase1:[...], phase2:[...] }
// 字段名 from/to/name 会归一为 path/dest/newname。
//
// I/O：stdout 单行 JSON 信封；进度与核对日志走 stderr；成功退出 0、失败 1。

import { spawn } from 'node:child_process';

// 机器本地配置解析：环境变量 → <技能目录>/config.json → 默认值。
// config.json 不入库不分发（见仓 .gitignore），只放本机路径。
import { fileURLToPath } from 'node:url';
const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
function localConfig() {
  try { return JSON.parse(readFileSync(join(SKILL_DIR, 'config.json'), 'utf8')); }
  catch { return {}; }
}
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs, num } from './args.mjs';

const CFG = process.env.ZCODE_CFG || localConfig().zcodeConfig
  || join(homedir(), '.zcode', 'cli', 'config.json');

const argv = process.argv.slice(2);
const opt = parseArgs(argv);
const log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');

if (!opt.spec) {
  log('用法: node baidu-netdisk-move.mjs --spec=spec.json [--batch=10] [--async=0] [--result=out.json]');
  process.stdout.write(JSON.stringify({ ok: false, error: '缺少 --spec' }) + '\n');
  process.exit(1);
}

// ---------- MCP 桥 ----------
let mcp = null;
async function mcpStart() {
  if (mcp) return;
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  const e = cfg.mcp.servers['baidu-server'];
  if (!e) throw new Error('配置里没有 baidu-server');
  const q = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';
  const cmdline = e.args ? [q(e.command), ...e.args.map(q)].join(' ') : q(e.command);
  const child = spawn(cmdline, { shell: true, windowsHide: true });
  let buf = '';
  const pending = new Map();
  let id = 100;
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const ln = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!ln.trim()) continue;
      let m;
      try { m = JSON.parse(ln); } catch { continue; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params) => new Promise((res, rej) => {
    const i = id++;
    pending.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 600000);
  });
  await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'netdisk-move', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  mcp = { child, call };
}

// 从一段可能夹杂多个 JSON 的文本里，扫出**第一个 JSON 对象**。
// 按花括号配对计数，跳过字符串字面量里的花括号。
// 返回 { json, depth }：depth > 0 表示文本**被截断**、还缺 depth 个右花括号。
function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), depth: 0 };
    }
  }
  return { json: text.slice(start), depth };
}

// 宽松解析：MCP 的 file_move 返回实测**末尾少一个 `}`**（花括号 2 vs 1），
// 而且返回可能由多个 content 块拼成、前面还带换行。
// 直接 JSON.parse(整段) 会失败 → 真实 errno/info 全丢，只剩一句「no-info」。
// 修法：按括号配对扫出第一个 JSON 对象；若还缺右括号就补齐再 parse。
function parseLoose(raw) {
  const got = extractJson(raw);
  if (!got) return null;
  for (const cand of [got.json, raw.trim()]) {
    if (!cand) continue;
    try { return JSON.parse(cand); } catch { /* 试补括号 */ }
    const g2 = extractJson(cand);
    if (g2 && g2.depth > 0) {
      try { return JSON.parse(g2.json + '}'.repeat(g2.depth)); } catch { /* 继续 */ }
    }
  }
  return null;
}

const callTool = async (name, args) => {
  const r = await mcp.call('tools/call', { name, arguments: args });
  // MCP 的返回是**若干个 content 块**拼起来的：可能前面带换行、可能**含多个 JSON 对象**、
  // 可能**末尾被截断**。直接 JSON.parse(整段) 会失败 → 真实的 errno/info 全被丢掉，
  // 只剩一句「no-info」（连「整批被拒」都看不出来）。
  const raw = (r.content || []).map((c) => c.text || '').join('');
  const loose = parseLoose(raw);
  if (loose) return loose;
  const txt = raw.trim();
  try { return JSON.parse(txt); } catch { /* 不是 JSON → 看是不是被包在错误里 */ }
  // MCP 会把参数校验失败包成 `params error: (response.body:{...})`，
  // 里面那个 JSON 才是真正的服务端返回 —— 挖出来，否则调用失败会被
  // 幂等回查掩盖成「已就位」（实测 335 项全「成功」，其实一次都没发出去）。
  const m = /params error:.*response\.body:(\{.*\})\s*\)/s.exec(txt);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  return { errno: -1, show_msg: txt.slice(0, 200) };
};

// 列出某目录下的全部文件名（**必须翻页**）：网盘 file_list 每页只有 10 条
// （见 references/api-quirks.md），只查第 1 页的话，条目超过 10 个的目录永远查不到
// → 幂等回查失效 → 已经搬成功的文件被误报成失败（实测 335 项里 85 项被误报）。
// 结果按目录缓存：一次搬几百个文件、目标又是同一个目录时，
// 逐项翻页会变成几百轮 API 调用（实测跑 10 分钟没跑完）。
const dirCache = new Map();
async function dirNames(parent) {
  if (dirCache.has(parent)) return dirCache.get(parent);
  const names = new Set();
  for (let page = 1; page <= 100; page++) {
    const j = await callTool('file_list', { dir: parent, page });
    const items = j?.data?.list || [];
    if (!items.length) break;
    // 百度网盘的文件名**大小写不敏感**：`instantID_x` 与 `instantid_x` 视为同名，
    // 搬过去会报 errno -8。所以比较一律归一化成小写。
    for (const it of items) if (it.filename) names.add(it.filename.toLowerCase());
    if (items.length < 10) break;                 // 不满页 = 最后一页
  }
  dirCache.set(parent, names);
  return names;
}

async function pathExists(p) {
  const parent = p.slice(0, p.lastIndexOf('/')) || '/';
  const name = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  return (await dirNames(parent)).has(name);
}

async function ensureDir(path) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const seg of parts) {
    cur += '/' + seg;
    // rtype=0：冲突就返回冲突，绝不创建 _时间戳 重命名副本
    await callTool('make_dir', { path: cur, rtype: '0' });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 执行 ----------
// 包 try/catch：契约是「stdout 一定是一行 JSON 信封，失败 exit=1」。
// 不包的话任何异常都变成裸堆栈，调用方拿到空 stdout。
const results = [];
let ok = 0, fail = 0;
try {
  const BATCH = num(opt.batch, 10);
  const ASYNC = num(opt.async, 0);

  // 形状归一：数组 / {moves} / {phase1,phase2}（phase2 在 phase1 之后执行）
  const raw = JSON.parse(readFileSync(opt.spec, 'utf8'));
  const phases = Array.isArray(raw)
    ? [raw]
    : (raw.moves ? [raw.moves] : [raw.phase1 || [], raw.phase2 || []].filter((p) => p.length));
  const norm = (arr) => arr.map((x) => ({
    group: x.group || 'move',
    path: x.path ?? x.from,
    dest: x.dest ?? x.to,
    newname: x.newname ?? x.name,
  }));

  await mcpStart();

  for (const [pi, phase] of phases.entries()) {
    const items = norm(phase);
    log(`\n=== phase ${pi + 1}: ${items.length} 项 (async=${ASYNC}) ===`);
    for (const d of [...new Set(items.map((x) => x.dest))]) await ensureDir(d);

    // 目录级移动（async=1）逐个提交：批量里只要有一个超大目录，整批会被服务端拒
    // （errno 12 + info 为空），同批的小目录也一起失败 —— 实测 3 个目录一批，
    // 744GB 那个把另外两个一起拖下水了（逐个提交后两个都成了）。
    const step = ASYNC === 1 ? 1 : BATCH;
    for (let i = 0; i < items.length; i += step) {
      const batch = items.slice(i, i + step);
      const filelist = batch.map((x) => ({ path: x.path, dest: x.dest, newname: x.newname }));
      const j = await callTool('file_move', { async: ASYNC, ondup: 'skip', filelist: JSON.stringify(filelist) });
      // async=1 只是**受理**，落地可能几分钟后 —— 轮询到「源消失」再判定，
      // 否则会把「已受理但还没搬完」误报成失败（也拿不到真实结果）。
      if (ASYNC === 1) {
        const deadline = Date.now() + num(opt['wait-timeout'], 30) * 60 * 1000;
        for (const x of batch) {
          const srcDir = x.path.slice(0, x.path.lastIndexOf('/')) || '/';
          while (Date.now() < deadline) {
            if (!(await pathExists(x.path))) break;      // 源没了 = 落地了
            dirCache.delete(srcDir);                    // 源目录在变，缓存要失效
            await sleep(5000);
          }
          dirCache.delete(srcDir);
        }
      }
      const info = Array.isArray(j?.info) ? j.info : [];
      const byPath = new Map(info.map((it) => [it.path, it]));
      // async=1 受理成功时返回 **taskid 且 info 为空** —— 这是「已提交、未落地」，
      // 不是失败。批完之后若源仍在，报「已提交未落地」而不是「失败」。
      const submitted = !!(j && j.taskid) || (j && j.errno === 0 && !info.length);
      // 整批被拒（参数错、批次过大…）：这是**调用没发出去**，不是「已完成」。
      // 必须硬失败 —— 否则幂等回查会把它变成「已就位」，335 项全绿而一次都没传。
      if (j && j.errno !== undefined && j.errno !== 0 && j.errno !== 12 && !info.length) {
        throw new Error(`file_move 被拒：errno=${j.errno} ${j.show_msg || ''}`.trim());
      }
      let bOk = 0, bBad = 0;

      for (const x of batch) {
        const it = byPath.get(x.path);
        let bad = !it || (it.errno !== undefined && it.errno !== 0);
        // errno -9 = 源不存在。多半是前一轮 async=1 的移动已延迟落地。
        // 回源/目标核对：源真不在、且目标已在 = 已完成（幂等）。
        //
        // 目标里要查**两个名字**：
        //   · x.newname —— 本次 spec 指定的目标名
        //   · 源文件的**原名** —— 上一轮已经搬过的话，隔离区里放的是原名
        //     （同名副本在 spec 里被加了 __2/__3 后缀，按后缀名查会查不到 → 误报失败）
        if (bad) {
          const srcGone = !(await pathExists(x.path));
          const srcBase = x.path.slice(x.path.lastIndexOf('/') + 1);
          const dstThere = await pathExists(x.dest + '/' + x.newname)
            || (srcBase !== x.newname && await pathExists(x.dest + '/' + srcBase));
          if (srcGone && dstThere) { bad = false; log(`    = 已就位 ${x.newname}`); }
        }
        results.push({ ...x, ok: !bad, to: it?.to_path,
          err: bad ? (submitted ? '已提交未落地' : (it?.errno ?? 'no-info')) : undefined });
        if (bad) { bBad++; fail++; log(`    FAIL ${x.path}  errno=${it?.errno ?? 'no-info'}`); }
        else { bOk++; ok++; }
      }
      log(`[batch ${Math.floor(i / BATCH) + 1}] ${batch.length} 项 -> 成功 ${bOk} 失败 ${bBad}`);
      // 目标目录的内容每批都在变 → 缓存必须失效，否则「目标已在」永远按搬之前的旧列表判，
      // 已经就位的文件会被误报成失败（实测 335 项里 11 项误报）。
      for (const d of new Set(batch.map((x) => x.dest))) dirCache.delete(d);
      await sleep(400);
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (opt.result) writeFileSync(opt.result, JSON.stringify({ ok: !failed.length, results }, null, 1));
  log(`\nDONE ok=${ok} fail=${fail}`);
  process.stdout.write(JSON.stringify({ ok: fail === 0, moved: ok, failed: fail, failures: failed }) + '\n');
  try { mcp?.child.kill(); } catch {}
  process.exit(fail ? 1 : 0);
} catch (e) {
  // 中途失败也要留下「已经搬了哪些」的记录：调用方据此判断该不该重跑。
  const failed = results.filter((r) => !r.ok);
  if (opt.result) { try { writeFileSync(opt.result, JSON.stringify({ ok: false, error: e.message, results }, null, 1)); } catch {} }
  log(`ERROR ${e.message}`);
  process.stdout.write(JSON.stringify({ ok: false, error: e.message, moved: ok, failed: fail, failures: failed, results }) + '\n');
  try { mcp?.child.kill(); } catch {}
  process.exit(1);
}
