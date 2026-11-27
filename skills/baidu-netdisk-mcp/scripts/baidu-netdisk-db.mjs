#!/usr/bin/env node
// 百度网盘本地盘点库 —— 网络只用来灌数据，所有分析在本地 SQLite 算。
//
// 反复调网盘 API 是盘点这类任务最贵的一环；灌一次库，之后 stats/du/big/dup/deep/plan 全是本地查询。
//
// 用法（子命令 + 选项，见 --help）：
//   scan   --roots="/课程|/我的资源" --depth=5 --max-dirs=1500 [--force] [--fresh-hours=24]
//   stats | du --path=/课程 --depth=2 | big --min=5GB | dup --min-size=50MB
//   deep --max-depth=5 | find --name=safetensors --path=/AI模型仓库
//   dump --path=/课程 --out=tree.json | plan --spec=spec.json | reset
//
// I/O：stdout 单行 JSON 信封；人读表格与进度走 stderr；成功退出 0、失败 1。

import { spawn } from 'node:child_process';

// 机器本地配置解析：环境变量 → <技能目录>/config.json → 默认值。
// config.json 不入库不分发（见仓 .gitignore），只放本机路径。
import { fileURLToPath } from 'node:url';
const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
function localConfig() {
  try { return JSON.parse(readFileSync(join(SKILL_DIR, 'config.json'), 'utf8')); }
  catch { return {}; }
}
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs, num, parseSize } from './args.mjs';

const CFG = process.env.ZCODE_CFG || localConfig().zcodeConfig
  || join(homedir(), '.zcode', 'cli', 'config.json');
const DB_PATH = process.env.BAIDU_DB || localConfig().inventoryDb
  || join(homedir(), '.zcode', 'cache', 'baidu-netdisk.db');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = parseArgs(argv.slice(1));

const out = [];
const say = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));

function human(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, n = Number(b) || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + u[i];
}

const HELP = [
  '百度网盘本地盘点库',
  '',
  '  scan   --roots="/a|/b" --depth=N --max-dirs=N [--force] [--fresh-hours=N]   灌库（增量）',
  '  stats                        一级目录体量排行',
  '  du     --path=/x --depth=N   任意子树体量汇总',
  '  big    --min=5GB             大目录排行',
  '  dup    --min-size=50MB      md5 重复检测',
  '  deep   --max-depth=5        路径过深的文件',
  '  find   --name=xxx --path=/x 文件名检索',
  '  dump   --path=/x --out=f.json 导出子树',
  '  plan   --spec=s.json --out=p.json  校验移动计划并生成 {path,dest,newname}',
  '  reset                       清空缓存',
].join('\n');

if (!cmd || cmd === '--help' || cmd === '-h') {
  process.stderr.write(HELP + '\n');
  process.stdout.write(JSON.stringify({ ok: true, data: { help: HELP.split('\n') } }) + '\n');
  process.exit(0);
}

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec([
  'PRAGMA journal_mode=WAL',
  `CREATE TABLE IF NOT EXISTS nodes (
     path TEXT PRIMARY KEY, parent TEXT, name TEXT, is_dir INTEGER, size INTEGER DEFAULT 0,
     md5 TEXT DEFAULT '', mtime INTEGER DEFAULT 0, depth INTEGER,
     complete INTEGER DEFAULT 1, scanned_at INTEGER, walk_depth INTEGER DEFAULT -1)`,
  'CREATE INDEX IF NOT EXISTS ix_parent ON nodes(parent)',
  "CREATE INDEX IF NOT EXISTS ix_md5 ON nodes(md5) WHERE md5 <> ''",
  'CREATE INDEX IF NOT EXISTS ix_size ON nodes(size)',
  `CREATE TABLE IF NOT EXISTS scans (
     id INTEGER PRIMARY KEY, root TEXT, max_depth INTEGER, dirs INTEGER, files INTEGER,
     bytes INTEGER, at INTEGER)`,
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
].join('; '));

// 迁移：老库补列（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）
const cols = db.prepare('PRAGMA table_info(nodes)').all().map((c) => c.name);
if (!cols.includes('walk_depth')) db.exec('ALTER TABLE nodes ADD COLUMN walk_depth INTEGER DEFAULT -1');

const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- MCP 桥 ----------
let mcp = null;
async function mcpStart() {
  if (mcp) return;
  const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
  const e = cfg.mcp.servers['baidu-server'];
  if (!e) throw new Error('配置里没有 baidu-server（ZCode config.json 的 mcp.servers）');
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
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 120000);
  });
  await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'netdisk-db', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  mcp = { child, call };
}

const PAGE_SIZE = 10; // 百度网盘 file_list 每页只有 10 条，必须翻到空页
async function listDir(dir) {
  const acc = [];
  for (let page = 1; page <= 400; page++) {
    const r = await mcp.call('tools/call', { name: 'file_list', arguments: { dir, page } });
    const txt = (r.content || []).map((c) => c.text || '').join('');
    let items = [];
    try { items = JSON.parse(txt)?.data?.list || []; } catch {}
    if (!items.length) break;
    acc.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return acc;
}
const isDir = (n) => Number(n.category) === 6 && !n.md5; // category 不可靠，目录 md5 为空

const upsertStmt = db.prepare(
  'INSERT INTO nodes(path,parent,name,is_dir,size,md5,mtime,depth,complete,scanned_at,walk_depth) VALUES(?,?,?,?,?,?,?,?,?,?,?) ' +
  'ON CONFLICT(path) DO UPDATE SET parent=excluded.parent, name=excluded.name, is_dir=excluded.is_dir, ' +
  'size=excluded.size, md5=excluded.md5, mtime=excluded.mtime, depth=excluded.depth, ' +
  'complete=excluded.complete, scanned_at=excluded.scanned_at, walk_depth=excluded.walk_depth');

// ---------- scan ----------
async function doScan() {
  await mcpStart();
  const roots = (opt.roots || '/').split('|').filter(Boolean);
  const maxDepth = num(opt.depth, 3);
  const maxDirs = num(opt['max-dirs'], 400);
  const freshHours = num(opt['fresh-hours'], 24);
  const force = !!opt.force;
  const freshCut = nowSec() - freshHours * 3600;

  let dirs = 0, files = 0, bytes = 0, skipped = 0, capped = false;
  const walk = async (dir, depth) => {
    if (depth > maxDepth || dirs >= maxDirs) {
      upsertStmt.run(dir, dir.slice(0, dir.lastIndexOf('/')) || '/', dir.split('/').pop(), 1, 0, '', 0, depth, 0, nowSec(), -1);
      capped = true;
      return;
    }
    // 只有「探到的层数够深 + 够新」才跳过。
    // 只记 scanned_at 的话根目录一命中新鲜就整棵短路，深灌永远不发生。
    const need = maxDepth - depth;
    const prev = db.prepare('SELECT scanned_at, walk_depth FROM nodes WHERE path=?').get(dir);
    if (!force && prev && prev.scanned_at > freshCut && (prev.walk_depth ?? -1) >= need) { skipped++; dirs++; return; }
    let items = [];
    try { items = await listDir(dir); } catch { items = []; }
    dirs++;
    upsertStmt.run(dir, dir.slice(0, dir.lastIndexOf('/')) || '/', dir.split('/').pop(), 1, 0, '', 0, depth, 1, nowSec(), need);
    for (const it of items) {
      const isd = isDir(it);
      const sz = isd ? 0 : Number(it.size || 0);
      // 子目录的 scanned_at 先置 0：它只是「被父目录发现了」，还没被真正 list 过。
      // 若这里盖上 now，下一轮增量会把它误判为新鲜而跳过。
      upsertStmt.run(it.path, dir, it.filename || it.path.split('/').pop(), isd ? 1 : 0, sz, it.md5 || '', 0, depth + 1, isd ? 0 : 1, isd ? 0 : nowSec(), -1);
      if (isd) await walk(it.path, depth + 1);
      else { files++; bytes += sz; }
    }
  };
  for (const r of roots) await walk(r, 0);
  db.prepare('INSERT INTO scans(root,max_depth,dirs,files,bytes,at) VALUES(?,?,?,?,?,?)')
    .run(roots.join('|'), maxDepth, dirs, files, bytes, nowSec());
  db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run('last_scan', String(nowSec()));
  say(`scan done: dirs=${dirs} (fresh-skipped ${skipped}${capped ? ', 撞上限提前截断' : ''}) files=${files} bytes=${human(bytes)} -> ${DB_PATH}`);
  return { dirs, files, bytes, skipped, capped, db: DB_PATH, maxDepth };
}

// ---------- 查询 ----------
// 目录体积不预存（深层文件扫到才知道），按 parent + 绝对层数自底向上汇总。
// 别用递归 CTE：祖先-后代组合全展开再 JOIN 文件，几十万行起步直接卡死。
let _sizes = null;
function dirSizes() {
  if (_sizes) return _sizes;
  const bytes = new Map();
  const files = new Map();
  for (const r of db.prepare("SELECT parent, COUNT(*) c, COALESCE(SUM(size),0) b FROM nodes WHERE is_dir=0 GROUP BY parent").all()) {
    bytes.set(r.parent, r.b);
    files.set(r.parent, r.c);
  }
  // 按「绝对层数」倒序（路径里的斜杠数），不能用 depth 列 ——
  // depth 记的是相对扫描根的层数，不同 root 扫出来的父子层数会错位，汇总就失真。
  const dirs = db.prepare(
    "SELECT path, parent FROM nodes WHERE is_dir=1 " +
    "ORDER BY (LENGTH(path) - LENGTH(REPLACE(path, '/', ''))) DESC").all();
  for (const d of dirs) {
    const b = bytes.get(d.path) || 0;
    const c = files.get(d.path) || 0;
    bytes.set(d.path, b);
    files.set(d.path, c);
    if (d.parent && d.parent !== d.path) { // 根目录的 parent 是自己，会加两遍
      bytes.set(d.parent, (bytes.get(d.parent) || 0) + b);
      files.set(d.parent, (files.get(d.parent) || 0) + c);
    }
  }
  _sizes = new Map(dirs.map((d) => [d.path, { bytes: bytes.get(d.path) || 0, files: files.get(d.path) || 0 }]));
  return _sizes;
}
function duRows(prefix, depth) {
  const sizes = dirSizes();
  const res = [];
  const base = prefix.endsWith('/') ? prefix : prefix + '/';
  for (const [dir, v] of sizes) {
    if (dir !== prefix && !dir.startsWith(base)) continue;
    const rel = dir.slice(prefix.length).replace(/^\//, '');
    const lvl = rel ? rel.split('/').length : 0;
    if (lvl <= depth) res.push({ dir, files: v.files, bytes: v.bytes });
  }
  return res.sort((a, b) => b.bytes - a.bytes);
}

function cmdStats() {
  const last = db.prepare("SELECT v FROM meta WHERE k='last_scan'").get()?.v;
  const tot = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(size),0) b FROM nodes WHERE is_dir=0').get();
  const dcount = db.prepare('SELECT COUNT(*) c FROM nodes WHERE is_dir=1').get().c;
  const sizes = dirSizes();
  const tops = db.prepare("SELECT path FROM nodes WHERE is_dir=1 AND parent='/'").all();
  const rows = tops.map((t) => ({ path: t.path, ...(sizes.get(t.path) || { bytes: 0, files: 0 }) }))
    .sort((a, b) => b.bytes - a.bytes);
  say(`\n库: ${DB_PATH}`);
  say(last ? `上次扫描: ${new Date(Number(last) * 1000).toLocaleString('zh-CN')}` : '尚未扫描');
  say(`已入库: ${dcount} 目录 / ${tot.c} 文件 / ${human(tot.b)}\n=== 一级目录（按体积）===`);
  for (const r of rows) say(`${human(r.bytes).padStart(9)}  ${String(r.files).padStart(6)} 文件  ${r.path}`);
  return { db: DB_PATH, lastScan: last ? Number(last) : null, dirs: dcount, files: tot.c, bytes: tot.b, top: rows };
}

function cmdDu() {
  const p = opt.path || '/';
  const d = num(opt.depth, 2);
  const rows = duRows(p, d);
  say(`\n=== ${p} (深度 ${d}) ===`);
  for (const r of rows) say(`${human(r.bytes).padStart(9)}  ${String(r.files).padStart(6)} 文件  ${r.dir}`);
  return { path: p, depth: d, rows };
}

function cmdBig() {
  const thr = parseSize(opt.min, 5 * 1024 ** 3);
  const rows = [...dirSizes().entries()].filter(([, v]) => v.bytes >= thr)
    .sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 80)
    .map(([dir, v]) => ({ dir, ...v }));
  say(`\n=== > ${human(thr)} 的目录 (按已灌库内容实时汇总) ===`);
  for (const r of rows) say(`${human(r.bytes).padStart(9)}  ${String(r.files).padStart(5)} 文件  ${r.dir}`);
  return { threshold: thr, rows };
}

function cmdDup() {
  const minSize = parseSize(opt['min-size'], 1024);
  const raw = db.prepare([
    'SELECT md5, COUNT(*) n, MAX(size) sz, GROUP_CONCAT(path, char(10)) paths',
    "FROM nodes WHERE is_dir=0 AND md5<>'' AND size>=?",
    'GROUP BY md5 HAVING n>1 ORDER BY (MAX(size)*(COUNT(*)-1)) DESC',
  ].join('\n')).all(minSize);
  let total = 0;
  const groups = raw.map((r) => {
    const waste = r.sz * (r.n - 1);
    total += waste;
    const paths = r.paths.split('\n');
    say('', `${human(waste).padStart(9)} 可回收  x${r.n}  md5=${r.md5}  单份 ${human(r.sz)}`);
    for (const p of paths.slice(0, 6)) say(`    ${p}`);
    if (paths.length > 6) say(`    ... 还有 ${paths.length - 6} 个`);
    return { md5: r.md5, count: r.n, size: r.sz, waste, paths };
  });
  say(`\n合计可回收: ${human(total)}`);
  return { groups: groups.length, reclaimable: total, items: groups };
}

function cmdDeep() {
  const md = num(opt['max-depth'], 4);
  const rows = db.prepare('SELECT path,size,depth FROM nodes WHERE is_dir=0 AND depth>? ORDER BY depth DESC LIMIT 60').all(md);
  const total = db.prepare('SELECT COUNT(*) c FROM nodes WHERE is_dir=0 AND depth>?').get(md).c;
  say(`\n=== 路径层级 > ${md} 的文件 (共 ${total} 个) ===`);
  for (const r of rows) say(`${String(r.depth).padStart(2)}层 ${human(r.size).padStart(9)}  ${r.path}`);
  return { maxDepth: md, total, rows };
}

function cmdFind() {
  const name = opt.name || '';
  const p = opt.path || '/';
  const rows = db.prepare("SELECT path,size,md5 FROM nodes WHERE is_dir=0 AND path LIKE ? AND path LIKE ? ORDER BY size DESC LIMIT 200")
    .all('%' + p + '%', '%' + name + '%');
  say(`\n=== 匹配 "${name}" 于 ${p}: ${rows.length} 条 ===`);
  for (const r of rows) say(`${human(r.size).padStart(9)}  ${r.path}`);
  return { name, path: p, rows };
}

function cmdDump() {
  const p = opt.path || '/';
  const rows = db.prepare('SELECT * FROM nodes WHERE path=? OR path LIKE ? ORDER BY path').all(p, p === '/' ? '/%' : p + '/%');
  const file = opt.out || ('dump' + (p === '/' ? '_root' : '_' + p.replace(/[^\w]/g, '_')) + '.json');
  writeFileSync(file, JSON.stringify(rows, null, 1));
  say(`导出 ${rows.length} 行 -> ${file}`);
  return { path: p, rows: rows.length, file };
}

// ---------- plan：先在本地缓存里校验移动计划，不碰网盘 ----------
function cmdPlan() {
  const specPath = opt.spec;
  if (!specPath) throw new Error('用法: plan --spec=xxx.json [--out=move_plan.json]');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const moves = spec.moves || spec.phase1 || [];
  const sizes = dirSizes();
  // 白名单要含**文件**：重复副本清理搬的是文件，只收目录的话
  // 每一项都会被判「未命中缓存」，计划直接空掉（实测 335 项全被拒）。
  const known = new Set(db.prepare('SELECT path FROM nodes').all().map((r) => r.path));
  const fileRow = (p) => db.prepare('SELECT size, is_dir FROM nodes WHERE path=?').get(p);
  const accepted = [];
  const rejected = [];
  say(`\n=== 移动计划校验 (${moves.length} 项) ===`);
  for (const m of moves) {
    const from = m.path ?? m.from;
    const to = m.dest ?? m.to;
    const name = m.newname ?? m.name;
    if (!known.has(from)) { rejected.push({ from, reason: '源路径不在缓存里(未扫描?)' }); say(`  ?? ${from}  未命中缓存`); continue; }
    // 目录用汇总体量，文件用自身大小
    const row = fileRow(from);
    const v = sizes.get(from) || (row && !row.is_dir
      ? { bytes: Number(row.size || 0), files: 1 }
      : { bytes: 0, files: 0 });
    say(`${human(v.bytes).padStart(9)}  ${String(v.files).padStart(6)} 文件  ${from}`);
    say(`${''.padStart(9)}  ${''.padStart(6)}        -> ${to}/${name}`);
    accepted.push({ group: m.group || 'move', path: from, dest: to, newname: name, bytes: v.bytes, files: v.files });
  }
  const total = accepted.reduce((a, b) => a + b.bytes, 0);
  const dests = [...new Set(accepted.map((o) => o.dest))];
  for (const d of dests) if (!known.has(d)) say(`  注意: 目标目录尚未存在, 会新建: ${d}`);
  say(`\n合计移动: ${human(total)}  (${accepted.length} 项有效${rejected.length ? `, ${rejected.length} 项未命中缓存` : ''})`);
  const file = opt.out || 'move_plan.json';
  writeFileSync(file, JSON.stringify(accepted, null, 1));
  say(`计划已写入 ${file}`);
  return { accepted: accepted.length, rejected, bytes: total, dests, file, moves: accepted };
}

function cmdReset() {
  db.exec('DELETE FROM nodes; DELETE FROM scans;');
  say('已清空缓存');
  return { cleared: true };
}

// ---------- 分派 ----------
let data = null;
try {
  if (cmd === 'scan') data = await doScan();
  else if (cmd === 'stats') data = cmdStats();
  else if (cmd === 'du') data = cmdDu();
  else if (cmd === 'big') data = cmdBig();
  else if (cmd === 'dup') data = cmdDup();
  else if (cmd === 'deep') data = cmdDeep();
  else if (cmd === 'find') data = cmdFind();
  else if (cmd === 'dump') data = cmdDump();
  else if (cmd === 'plan') data = cmdPlan();
  else if (cmd === 'reset') data = cmdReset();
  else throw new Error('未知子命令：' + cmd + '\n' + HELP);
} catch (e) {
  if (out.length) process.stderr.write(out.join('\n') + '\n');
  process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
  process.exit(1);
}
process.stderr.write(out.join('\n') + '\n');
process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
if (mcp) {
  // Windows 上 shell:true 会留下 cmd.exe + node 两层，kill 父进程杀不掉子进程，
  // 管道不关事件循环就退不出去 —— 必须显式 exit。
  try { mcp.child.kill(); } catch {}
}
process.exit(0);
