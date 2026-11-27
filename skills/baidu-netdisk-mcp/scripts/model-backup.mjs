#!/usr/bin/env node
// model-backup.mjs —— 模型加密压缩 → 上传百度网盘 的备份流水线
//
// 我们自己的模型备份方法（样例参考：references/model-backup-method.md）：
//   选模型 → 收集**同名附件** → zip 加密打包 → 上传 → 写台账
//
// 附件规则：同一目录下、与模型同名（含 .cm-info / .preview / .civitai 标记）的附属文件
// （元信息 json、预览图、说明 txt…）与模型本体打进同一个包。
//
// 压缩工具用 Info-ZIP 的 zip/unzip（跨平台：Linux/macOS 自带，Windows 用 GnuWin32 版），
// 不用 7-Zip —— 7-Zip 不是通用工具，且 -mhe（加密文件名头）只有 7z 格式支持。
//
// 用法：
//   node scripts/model-backup.mjs pick   --root=<模型库根目录> --include=loras --limit=2
//   node scripts/model-backup.mjs pack   --root=... --include=... --limit=2 --password=ai123456
//   node scripts/model-backup.mjs verify --pack=<本地.zip> --password=ai123456
//   node scripts/model-backup.mjs restore --pack=<本地.zip> --to=<还原目录> --password=ai123456
//   node scripts/model-backup.mjs upload --pack=<本地.zip> --remote=/apps/bdpan/model-backup/x.zip
//   node scripts/model-backup.mjs ledger --dir=<台账目录>
//
// 通用选项：--dry-run（只演练不写）、--json（stdout 单行 JSON 信封）
// 上传走 scripts/transfer.mjs（原生分片：进度 + 续传 + sha256 校验），
// 协议细节见 references/transfer-protocol.md。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync, writeFileSync, unlinkSync, renameSync, linkSync, copyFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, num } from './args.mjs';
import { sha256File } from './hashes.mjs';

// 解析可执行文件：Windows 上 Node 的 spawn 不走 shell，PATH 里的 shell 包装脚本
// （如用户主目录下的 bin/zip 包装脚本）无法被 spawnSync 执行 —— 必须指向真实的 .exe。
// 跨平台：Linux/macOS 直接用 PATH 里的 zip/unzip。
function resolveBin(name, envVar) {
  if (process.env[envVar]) return process.env[envVar];
  if (process.platform === 'win32') {
    // 安装根从环境变量取，不写死盘符：GnuWin32 装到别处也能找到
    for (const root of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (!root) continue;
      const p = join(root, 'GnuWin32', 'bin', name + '.exe');
      if (existsSync(p)) return p;
    }
  }
  return name;
}
const ZIP_BIN = resolveBin('zip', 'ZIP_BIN');
const UNZIP_BIN = resolveBin('unzip', 'UNZIP_BIN');
const DEFAULT_PASSWORD = process.env.MODEL_BACKUP_PASSWORD || 'ai123456';
// 模型库根与暂存目录都是机器本地配置，不写死默认路径：
// 命令行 > 环境变量 > 用户主目录下的约定位置。
// 暂存目录默认与模型库同盘（模型的父目录下的 .model-backup-packs）——
// 免得几个 GB 的包把系统盘写满；跨盘时用 MODEL_BACKUP_WORK 覆盖。
const DEFAULT_WORK = process.env.MODEL_BACKUP_WORK || join(homedir(), '.model-backup-packs');
function defaultWorkDir(root) {
  if (process.env.MODEL_BACKUP_WORK) return DEFAULT_WORK;
  try {
    const parent = dirname(resolve(root));
    if (parent && parent !== resolve(root)) return join(parent, '.model-backup-packs');
  } catch {}
  return DEFAULT_WORK;
}
function modelsRoot(opt) {
  const r = opt.root || process.env.MODEL_BACKUP_ROOT;
  if (!r) throw new Error('需要 --root=<模型库根目录>（或设环境变量 MODEL_BACKUP_ROOT）');
  return r;
}

const MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.gguf', '.pth', '.pt', '.bin', '.onnx']);
const ATTACH_EXTS = new Set(['.json', '.yaml', '.yml', '.txt', '.png', '.jpeg', '.jpg', '.info', '.md']);
const ATTACH_MARKERS = ['.cm-info', '.preview', '.civitai', '.info', '.metadata'];

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = parseArgs(argv.slice(1));
const dryRun = !!opt['dry-run'];
const asJson = !!opt.json;

const out = [];
const say = (...a) => { const s = a.map(String).join(' '); out.push(s); if (!asJson) process.stderr.write(s + '\n'); };
function human(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = Number(b) || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(1) + u[i];
}
// 归档名必须 ASCII：网盘路径、跨平台 shell、各家解压工具都更稳。
// 原名与 sha256 记在包内 manifest.json 和台账里，可完整还原。
function asciiName(name) {
  const stem = name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const ascii = stem.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  const h = createHash('sha1').update(stem).digest('hex').slice(0, 8);
  return (ascii || 'model') + '_' + h;
}

// ---- 文件名 → 模型 key ----
function modelKey(file) {
  const e = extname(file).toLowerCase();
  let stem = file.slice(0, file.length - e.length);
  for (const m of ATTACH_MARKERS) {
    if (stem.toLowerCase().endsWith(m)) { stem = stem.slice(0, stem.length - m.length); break; }
  }
  return stem;
}
const isModelFile = (f) => {
  const e = extname(f).toLowerCase();
  if (!MODEL_EXTS.has(e) || f.startsWith('.')) return false;
  if (/\.tmp\.part\d+$/i.test(f)) return false;   // 未下完的残片
  return true;
};
const isAttachFile = (f) => {
  const e = extname(f).toLowerCase();
  if (!ATTACH_EXTS.has(e)) return false;
  if (/\.tmp\.part\d+$/i.test(f)) return false;
  return true;
};

function collect(root, include, limit) {
  const groups = new Map();
  const skipDir = (d) => /(^|[\\/])(\.metadata-only|\.dedup_cache|\.git|node_modules|__pycache__)([\\/]|$)/i.test(d);
  const walk = (dir) => {
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = join(dir, it.name);
      if (it.isDirectory()) { if (!skipDir(p)) walk(p); continue; }
      if (!it.isFile()) continue;
      if (!isModelFile(it.name) && !isAttachFile(it.name)) continue;
      const key = join(dir, modelKey(it.name));
      if (!groups.has(key)) groups.set(key, { dir, model: null, attaches: [] });
      const g = groups.get(key);
      if (isModelFile(it.name)) { if (!g.model) g.model = p; }
      else g.attaches.push(p);
    }
  };
  walk(resolve(root));
  let list = [...groups.values()].filter((g) => g.model);
  if (include) {
    const needle = String(include).toLowerCase();
    list = list.filter((g) => g.model.toLowerCase().includes(needle));
  }
  list.sort((a, b) => a.model.localeCompare(b.model));
  if (limit > 0) list = list.slice(0, limit);
  return list;
}

function run(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: -1, stdout: '', stderr: `spawn ${bin} 失败: ${r.error.message}` };
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---- zip 加密打包 ----
// 关键约束：Info-ZIP 的 Windows（GnuWin32）构建是 ANSI 编译的，中文名会被存成
// `#U95ea#U4eae...` 转义，跨机器还原就废了。所以包内一律 ASCII 名，
// 原名与 sha256 记在包内 manifest.json（UTF-8），还原时按 manifest 还原。
// 暂存区用硬链接（同盘不占空间），跨盘自动退回复制。
function stage(group, stageDir) {
  rmrf(stageDir);
  mkdirSync(stageDir, { recursive: true });
  const src = [group.model, ...group.attaches];
  const files = [];
  const extCount = new Map();
  src.forEach((f, i) => {
    const orig = basename(f);
    const e = extname(orig).toLowerCase();
    const n = (extCount.get(e) || 0) + 1;
    extCount.set(e, n);
    const stored = i === 0 ? 'model' + e : (n === 1 ? 'model' + e : `model.${n}${e}`);
    const dst = join(stageDir, stored);
    try { linkSync(f, dst); } catch { copyFileSync(f, dst); }
    files.push({ stored, original: orig, size: statSync(f).size, sha256: sha256File(f) });
  });
  const manifest = {
    created_at: new Date().toISOString(),
    original_model_path: group.model,
    original_model_name: basename(group.model),
    original_dir: group.dir,
    files,
  };
  writeFileSync(join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function rmrf(p) {
  try { rmSync(p, { recursive: true, force: true }); } catch {}
}

function pack(group, packPath, password) {
  mkdirSync(dirname(packPath), { recursive: true });
  const stageDir = join(dirname(packPath), '.stage', asciiName(basename(group.model)));
  const manifest = stage(group, stageDir);
  try {
    const names = readdirSync(stageDir);
    // -P 传密码(ZipCrypto)；-X 去掉多余属性；-r 递归
    const args = ['-P', password, '-X', '-q', '-r', packPath, ...names];
    const r = run(ZIP_BIN, args, stageDir);
    if (r.code !== 0) {
      // zip 遇到问题只给 warning 时退出码仍是 0，必须再跑一次不安静的拿真实报错
      const v = run(ZIP_BIN, ['-P', password, '-X', '-r', packPath, ...names], stageDir);
      return { ok: false, code: v.code, msg: (v.stderr || v.stdout || '').trim(), manifest };
    }
    return { ok: true, code: r.code, msg: (r.stderr || '').trim(), manifest };
  } finally {
    rmrf(stageDir);
  }
}

// Git Bash 会把命令行里的 /apps/xxx 转成 <Git 安装目录>/apps/xxx（MSYS 路径转换）。
// 这里还原成网盘绝对路径，让脚本从 Git Bash 调用也安全。
function normalizeRemote(p) {
  let s = String(p).split('\\').join('/');
  const m = s.match(/^[A-Za-z]:\/.*?\/apps\/(bdpan\/.*)$/);
  if (m) s = '/apps/' + m[1];
  return s;
}


// ---- 子命令 ----
function cmdPick() {
  const root = modelsRoot(opt);
  const groups = collect(root, opt.include, num(opt.limit, 0));
  const rows = groups.map((g) => ({ model: g.model, bytes: statSync(g.model).size, attaches: g.attaches.map((f) => basename(f)) }));
  for (const r of rows) {
    say(`${human(r.bytes).padStart(9)}  ${r.model}`);
    for (const a of r.attaches) say(`${' '.repeat(9)}  + ${a}`);
  }
  say(`\n命中 ${rows.length} 组模型，共 ${human(rows.reduce((a, b) => a + b.bytes, 0))}`);
  return { count: rows.length, rows };
}

function cmdPack() {
  const root = modelsRoot(opt);
  const work = resolve(opt['work-dir'] || defaultWorkDir(root));
  const password = opt.password || DEFAULT_PASSWORD;
  const groups = collect(root, opt.include, num(opt.limit, 0));
  const results = [];
  for (const g of groups) {
    const name = asciiName(basename(g.model)) + '.zip';
    const packPath = join(work, name);
    if (dryRun) {
      say(`[dry-run] ${g.model} (+${g.attaches.length} 附件) -> ${packPath}`);
      results.push({ model: g.model, pack: packPath, dryRun: true });
      continue;
    }
    const t0 = Date.now();
    const p = pack(g, packPath, password);
    if (!p.ok) { say(`[FAIL] ${g.model}: ${p.msg}`); results.push({ model: g.model, ok: false, msg: p.msg }); continue; }
    const size = statSync(packPath).size;
    const secs = +((Date.now() - t0) / 1000).toFixed(1);
    say(`[OK] ${basename(g.model)} -> ${name}  ${human(size)}  ${secs}s  附件 ${g.attaches.length} 个`);
    const entry = {
      ts: new Date().toISOString(), model: g.model, pack: packPath, bytes: size,
      remote: null, sha256: sha256File(packPath), files: p.manifest.files, seconds: secs,
    };
    appendFileSync(join(work, 'ledger.jsonl'), JSON.stringify(entry) + '\n');
    results.push(entry);
  }
  return { count: results.length, results };
}

function cmdVerify() {
  const packPath = resolve(opt.pack);
  const password = opt.password || DEFAULT_PASSWORD;
  const r = run(UNZIP_BIN, ['-P', password, '-t', packPath]);
  say(`unzip -P****** -t ${basename(packPath)} -> exit=${r.code}`);
  if (r.stdout.trim()) say(r.stdout.trim().split('\n').slice(-4).join('\n'));
  if (r.code !== 0) throw new Error('校验失败：密码错或包已损坏');
  return { pack: packPath, ok: true, exit: r.code };
}

function cmdRestore() {
  const packPath = resolve(opt.pack);
  const password = opt.password || DEFAULT_PASSWORD;
  const to = resolve(opt.to || opt['work-dir'] || DEFAULT_WORK);
  if (dryRun) { say(`[dry-run] unzip -P****** ${basename(packPath)} -> ${to}`); return { dryRun: true, pack: packPath, to }; }
  mkdirSync(to, { recursive: true });
  const r = run(UNZIP_BIN, ['-P', password, '-o', packPath, '-d', to]);
  say(`unzip -> exit=${r.code}`);
  if (r.code !== 0) throw new Error('解压失败，密码可能不对');
  const mf = join(to, 'manifest.json');
  let manifest = null;
  if (existsSync(mf)) manifest = JSON.parse(readFileSync(mf, 'utf8'));
  if (!manifest) { say('包内无 manifest.json（不是本工具产出的包）'); return { pack: packPath, to, ok: false, why: 'no-manifest' }; }
  // 按 manifest 把 ASCII 暂存名还原成原始名，并逐个校验 sha256
  const bad = [];
  for (const f of manifest.files) {
    const src = join(to, f.stored);
    if (!existsSync(src)) { bad.push({ name: f.original, why: '缺失' }); continue; }
    if (sha256File(src) !== f.sha256) { bad.push({ name: f.original, why: 'sha256 不符' }); continue; }
    renameSync(src, join(to, f.original));
  }
  // 模型本体放回原目录（可选）
  let placed = null;
  if (opt['to-original'] && manifest.original_dir) {
    try {
      mkdirSync(manifest.original_dir, { recursive: true });
      const dst = join(manifest.original_dir, manifest.original_model_name);
      renameSync(join(to, manifest.original_model_name), dst);
      placed = dst;
      say(`模型本体已还原到原目录: ${dst}`);
    } catch (e) { say(`模型本体还原失败（文件可能已存在）: ${e.message}`); }
  }
  say(`sha256 校验: ${manifest.files.length - bad.length}/${manifest.files.length} 通过`);
  for (const b of bad) say(`  [BAD] ${b.name} ${b.why}`);
  return { pack: packPath, to, manifest, bad, placed, ok: bad.length === 0 };
}

function cmdUpload() {
  const packPath = resolve(opt.pack);
  if (!existsSync(packPath)) throw new Error('包不存在: ' + packPath);
  const remote = normalizeRemote(opt.remote || ('/apps/bdpan/model-backup/' + basename(packPath)));
  if (!remote.startsWith('/apps/bdpan/')) throw new Error('bdpan 只允许操作 /apps/bdpan/ 目录，当前: ' + remote);
  if (dryRun) { say(`[dry-run] transfer.mjs upload --file="${packPath}" --remote="${remote}"`); return { dryRun: true, pack: packPath, remote }; }

  // 走原生分片上传（不是 bdpan）：bdpan 是黑盒 —— 不吐进度、远端上传期间不可见、
  // 没有断点续传。原生协议按片推进，每片完成就是一个进度刻度，服务端还能告诉我们
  // 「还缺哪几片」，续传是服务端驱动的。详见 references/transfer-protocol.md。
  const transfer = join(dirname(fileURLToPath(import.meta.url)), 'transfer.mjs');
  const r = spawnSync(process.execPath, [transfer, 'upload',
    `--file=${packPath}`, `--remote=${remote}`, `--slice=${opt.slice || '4MB'}`],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.stderr) process.stderr.write(r.stderr);
  let payload = null;
  try { payload = JSON.parse((r.stdout || '').trim().split('\n').pop() || '{}'); } catch { payload = null; }
  if (!payload || payload.ok !== true) {
    throw new Error('上传失败: ' + ((payload && payload.error) || ('exit=' + r.status)));
  }
  const res = payload.data || {};

  // 回写台账
  const ledger = join(dirname(packPath), 'ledger.jsonl');
  if (existsSync(ledger)) {
    const lines = readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const hit = lines.find((e) => e.pack === packPath);
    if (hit) {
      hit.remote = res.remote || remote;
      hit.uploaded_at = new Date().toISOString();
      hit.upload_seconds = res.seconds;
      hit.upload_speed_bps = res.speed_bps;
      writeFileSync(ledger, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
  }
  return { pack: packPath, remote: res.remote || remote, sha256: res.sha256, bytes: res.bytes, seconds: res.seconds, speed_bps: res.speed_bps, resumed: res.resumed };
}

function cmdLedger() {
  const dir = resolve(opt.dir || DEFAULT_WORK);
  const f = join(dir, 'ledger.jsonl');
  if (!existsSync(f)) { say('台账不存在: ' + f); return { ledger: f, entries: [] }; }
  const entries = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const e of entries) say(`${e.ts}  ${human(e.bytes || 0).padStart(9)}  ${e.remote || '(未上传)'}  <- ${e.model}`);
  return { ledger: f, count: entries.length, entries };
}

const COMMANDS = { pick: cmdPick, pack: cmdPack, upload: cmdUpload, verify: cmdVerify, restore: cmdRestore, ledger: cmdLedger };
try {
  if (!cmd || !COMMANDS[cmd]) {
    process.stderr.write('用法: model-backup.mjs <pick|pack|upload|verify|restore|ledger> [选项]\n');
    process.exit(1);
  }
  const data = COMMANDS[cmd]();
  process.stdout.write(JSON.stringify({ ok: true, command: cmd, data }) + '\n');
  process.exit(0);
} catch (e) {
  if (out.length && !asJson) process.stderr.write(out.join('\n') + '\n');
  process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
  process.exit(1);
}
