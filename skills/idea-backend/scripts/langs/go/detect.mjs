#!/usr/bin/env node
// Go 分册探测器：判一个已有 Go 项目的形态与事实，供通用分发器
// （scripts/inspect-project.mjs）过滤本分册的适用清单条目。
//
//   node scripts/langs/go/detect.mjs <project-dir>
//
// 打印 key=value 行（含 CONDITIONS=）。不写任何文件；不是 Go 项目就如实报 BUILD_FILE=none。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--'));
if (!dirArg) {
  console.error('usage: detect.mjs <project-dir>');
  process.exit(2);
}
const DIR = resolve(dirArg);

const facts = {};
const set = (k, v) => { facts[k] = v === undefined || v === null ? '' : String(v); };
const read = (f) => { try { return readFileSync(join(DIR, f), 'utf8'); } catch { return ''; } };

// ---- build file ------------------------------------------------------------
const hasMod = existsSync(join(DIR, 'go.mod'));
const hasSum = existsSync(join(DIR, 'go.sum'));
set('BUILD_FILE', hasMod ? 'go.mod' : '');
set('BUILD_TOOL', hasMod ? 'go-modules' : 'none');
set('HAS_SUM', hasSum ? 'yes' : 'no');

const gomod = read('go.mod');

// ---- module & versions -----------------------------------------------------
const moduleName = gomod.match(/^\s*module\s+(\S+)/m);
set('MODULE_NAME', moduleName ? moduleName[1] : '');

const goDirective = gomod.match(/^go\s+(\d+(?:\.\d+)?)/m);
set('GO_VERSION', goDirective ? goDirective[1] : '');

const toolchain = gomod.match(/^toolchain\s+(\S+)/m);
set('TOOLCHAIN', toolchain ? toolchain[1] : '');

// ---- workspace -------------------------------------------------------------
set('HAS_WORKSPACE', existsSync(join(DIR, 'go.work')) ? 'yes' : 'no');

// ---- layout ----------------------------------------------------------------
// Go 没有固定源码目录约定：包就是目录，*.go 文件所在处即一个包。
function walkGoFiles(dir, depth = 0, acc = []) {
  if (depth > 3) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue;
    const sub = join(dir, e.name);
    if (readdirSyncSafe(sub).some((f) => f.endsWith('.go'))) acc.push(sub);
    walkGoFiles(sub, depth + 1, acc);
  }
  return acc;
}
function readdirSyncSafe(d) { try { return readdirSync(d); } catch { return []; } }

const pkgDirs = walkGoFiles(DIR);
const rootHasGo = readdirSyncSafe(DIR).some((f) => f.endsWith('.go'));
set('PKG_DIR_COUNT', String(pkgDirs.length + (rootHasGo ? 1 : 0)));
set('PKG_DIRS', pkgDirs.slice(0, 20).map((p) => p.replace(DIR, '.').replace(/\\/g, '/')).join(',') + (pkgDirs.length > 20 ? ',…' : ''));
set('HAS_CMD_DIR', existsSync(join(DIR, 'cmd')) ? 'yes' : 'no');
set('HAS_INTERNAL_DIR', existsSync(join(DIR, 'internal')) ? 'yes' : 'no');
set('HAS_VENDOR', existsSync(join(DIR, 'vendor')) ? 'yes' : 'no');

// ---- tests -----------------------------------------------------------------
let testFiles = 0;
for (const d of [DIR, ...pkgDirs]) {
  testFiles += readdirSyncSafe(d).filter((f) => f.endsWith('_test.go')).length;
}
set('TEST_FILE_COUNT', String(testFiles));
set('HAS_TEST', testFiles > 0 ? 'yes' : 'no');

// ---- conditions ------------------------------------------------------------
const conditions = new Set();
if (hasMod) conditions.add('go');
if (existsSync(join(DIR, 'go.work'))) conditions.add('workspace');
if (pkgDirs.length + (rootHasGo ? 1 : 0) > 1) conditions.add('multi-package');
if (testFiles > 0) conditions.add('go-test');
if (goDirective) conditions.add('go-version-pinned');
if (existsSync(join(DIR, 'vendor'))) conditions.add('vendored');
set('CONDITIONS', [...conditions].sort().join(','));

// ---- 输出事实 -------------------------------------------------------------
for (const [k, v] of Object.entries(facts)) console.log(`${k}=${v}`);
