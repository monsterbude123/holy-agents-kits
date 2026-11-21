#!/usr/bin/env node
// Rust 分册探测器：判一个已有 Rust 项目的形态与事实，供通用分发器
// （scripts/inspect-project.mjs）过滤本分册的适用清单条目。
//
//   node scripts/langs/rust/detect.mjs <project-dir>
//
// 打印 key=value 行（含 CONDITIONS=）。不写任何文件；不是 Rust 项目就如实报 BUILD_FILE=none。
// 注意：Cargo.toml 是 TOML，这里只做够用的行级解析（不引第三方解析器）。
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
const listDir = (d) => { try { return readdirSync(d); } catch { return []; } };

// ---- build file ------------------------------------------------------------
const cargo = read('Cargo.toml');
const hasCargo = existsSync(join(DIR, 'Cargo.toml'));
set('BUILD_FILE', hasCargo ? 'Cargo.toml' : '');
set('BUILD_TOOL', hasCargo ? 'cargo' : 'none');
set('HAS_LOCK', existsSync(join(DIR, 'Cargo.lock')) ? 'yes' : 'no');

// ---- package section -------------------------------------------------------
const pkgSection = cargo.match(/^\s*\[package\]([\s\S]*?)(?=^\s*\[)/m);
const body = pkgSection ? pkgSection[1] : '';
const crateName = body.match(/^\s*name\s*=\s*"([^"]+)"/m);
set('CRATE_NAME', crateName ? crateName[1] : '');
const edition = body.match(/^\s*edition\s*=\s*"([^"]+)"/m);
set('EDITION', edition ? edition[1] : '');
const rustVersion = body.match(/^\s*rust-version\s*=\s*"([^"]+)"/m);
set('RUST_VERSION', rustVersion ? rustVersion[1] : '');

// ---- workspace / members ---------------------------------------------------
const isWorkspace = /^\s*\[workspace\]/m.test(cargo);
set('HAS_WORKSPACE', isWorkspace ? 'yes' : 'no');
const members = cargo.match(/^\s*members\s*=\s*\[([\s\S]*?)\]/m);
set('MEMBER_COUNT', members ? (members[1].match(/"/g) || []).length / 2 : 0);
set('MEMBERS', members ? members[1].replace(/["'\s]/g, '') : '');

// ---- dependencies ----------------------------------------------------------
const depBlock = cargo.match(/^\s*\[dependencies\]([\s\S]*?)(?=^\s*\[)/m);
set('DEP_COUNT', depBlock ? (depBlock[1].match(/^\s*[A-Za-z0-9_-]+\s*=/gm) || []).length : 0);
const hasDevDeps = /^\s*\[dev-dependencies\]/m.test(cargo);
set('HAS_DEV_DEPS', hasDevDeps ? 'yes' : 'no');

// ---- layout ----------------------------------------------------------------
set('HAS_SRC_DIR', existsSync(join(DIR, 'src')) ? 'yes' : 'no');
set('HAS_TESTS_DIR', existsSync(join(DIR, 'tests')) ? 'yes' : 'no');
set('HAS_BENCH_DIR', existsSync(join(DIR, 'benches')) ? 'yes' : 'no');
const srcRs = existsSync(join(DIR, 'src')) ? listDir(join(DIR, 'src')).filter((f) => f.endsWith('.rs')).length : 0;
set('SRC_RS_COUNT', String(srcRs));
const testRs = existsSync(join(DIR, 'tests'))
  ? listDir(join(DIR, 'tests')).filter((f) => f.endsWith('.rs')).length
  : listDir(join(DIR, 'src')).filter((f) => f.endsWith('.rs')).length;
set('TEST_RS_COUNT', String(testRs));
set('HAS_TEST', testRs > 0 ? 'yes' : 'no');

// ---- conditions ------------------------------------------------------------
const conditions = new Set();
if (hasCargo) conditions.add('rust');
if (isWorkspace) conditions.add('workspace');
if (members && (members[1].match(/"/g) || []).length / 2 > 1) conditions.add('multi-crate');
if (testRs > 0) conditions.add('rust-test');
if (edition) conditions.add('edition-pinned');
if (hasDevDeps) conditions.add('dev-deps');
set('CONDITIONS', [...conditions].sort().join(','));

// ---- 输出事实 -------------------------------------------------------------
for (const [k, v] of Object.entries(facts)) console.log(`${k}=${v}`);
