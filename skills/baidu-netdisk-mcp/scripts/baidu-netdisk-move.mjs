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

const CFG = process.env.ZCODE_CFG || localConfig().zcodeConfig
  || join(homedir(), '.zcode', 'cli', 'config.json');

const argv = process.argv.slice(2);
const opt = {};
for (const a of argv) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
}
const log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');

if (!opt.spec) {
  log('用法: node baidu-netdisk-move.mjs --spec=spec.json [--batch=10] [--async=0] [--result=out.json]');
  process.stdout.write(JSON.stringify({ ok: false, error: '缺少 --spec' }) + '\n');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(opt.spec, 'utf8'));
// 形状归一：数组 / {moves} / {phase1,phase2}（phase2 在 phase1 之后执行）
const phases = Array.isArray(raw)
  ? [raw]
  : (raw.moves ? [raw.moves] : [raw.phase1 || [], raw.phase2 || []].filter((p) => p.length));
const norm = (arr) => arr.map((x) => ({
  group: x.group || 'move',
  path: x.path ?? x.from,
  dest: x.dest ?? x.to,
  newname: x.newname ?? x.name,
}));

const BATCH = Number(opt.batch || 10);
const ASYNC = Number(opt.async ?? 0);

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

const callTool = async (name, args) => {
  const r = await mcp.call('tools/call', { name, arguments: args });
  const txt = (r.content || []).map((c) => c.text || '').join('');
  try { return JSON.parse(txt); } catch { return { errno: -1, show_msg: txt.slice(0, 200) }; }
};

async function pathExists(p) {
  const parent = p.slice(0, p.lastIndexOf('/')) || '/';
  const name = p.slice(p.lastIndexOf('/') + 1);
  const j = await callTool('file_list', { dir: parent, page: 1 });
  const items = j?.data?.list || [];
  return items.some((it) => it.filename === name);
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
await mcpStart();
const results = [];
let ok = 0, fail = 0;

for (const [pi, phase] of phases.entries()) {
  const items = norm(phase);
  log(`\n=== phase ${pi + 1}: ${items.length} 项 (async=${ASYNC}) ===`);
  for (const d of [...new Set(items.map((x) => x.dest))]) await ensureDir(d);

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const filelist = batch.map((x) => ({ path: x.path, dest: x.dest, newname: x.newname }));
    const j = await callTool('file_move', { async: ASYNC, ondup: 'skip', filelist: JSON.stringify(filelist) });
    const info = Array.isArray(j?.info) ? j.info : [];
    const byPath = new Map(info.map((it) => [it.path, it]));
    let bOk = 0, bBad = 0;

    for (const x of batch) {
      const it = byPath.get(x.path);
      let bad = !it || (it.errno !== undefined && it.errno !== 0);
      // errno -9 = 源不存在。多半是前一轮 async=1 的移动已延迟落地。
      // 回源/目标核对：源真不在、且目标已在 = 已完成（幂等）。
      if (bad && ASYNC === 0) {
        const srcGone = !(await pathExists(x.path));
        const dstThere = await pathExists(x.dest + '/' + x.newname);
        if (srcGone && dstThere) { bad = false; log(`    = 已就位 ${x.newname}`); }
      }
      results.push({ ...x, ok: !bad, to: it?.to_path, err: bad ? (it?.errno ?? 'no-info') : undefined });
      if (bad) { bBad++; fail++; log(`    FAIL ${x.path}  errno=${it?.errno ?? 'no-info'}`); }
      else { bOk++; ok++; }
    }
    log(`[batch ${Math.floor(i / BATCH) + 1}] ${batch.length} 项 -> 成功 ${bOk} 失败 ${bBad}`);
    await sleep(400);
  }
}

const failed = results.filter((r) => !r.ok);
if (opt.result) writeFileSync(opt.result, JSON.stringify({ ok: !failed.length, results }, null, 1));
log(`\nDONE ok=${ok} fail=${fail}`);
process.stdout.write(JSON.stringify({ ok: fail === 0, moved: ok, failed: fail, failures: failed }) + '\n');
try { mcp.child.kill(); } catch {}
process.exit(fail ? 1 : 0);
