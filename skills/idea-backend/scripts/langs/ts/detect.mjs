#!/usr/bin/env node
// TS 分册探测器：判一个已有 TS 项目的形态与事实，供通用分发器
// （scripts/inspect-project.mjs）过滤本分册的适用清单条目。
//
//   node scripts/langs/ts/detect.mjs <project-dir>
//
// 打印 key=value 行（含 CONDITIONS=，逗号分隔的条件集合）。不写任何文件；
// 不是 TS 项目就如实报 SHAPE=unknown。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--'));
if (!dirArg) {
  console.error('usage: detect.mjs <project-dir>');
  process.exit(2);
}
const DIR = resolve(dirArg);

// tsconfig.json is JSONC (comments allowed) — strip them before parsing.
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 1; }
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (c === '/' && next === '*') { inBlock = true; i += 1; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function readJson(file) {
  try {
    return JSON.parse(stripJsonComments(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

const facts = {};
const set = (k, v) => { facts[k] = v === undefined || v === null ? '' : String(v); };

set('PROJECT_DIR', DIR);

// ---- tsconfig ------------------------------------------------------------
const tsconfigFiles = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => /^tsconfig.*\.json$/.test(f)).sort()
  : [];
set('TS_CONFIG_FILES', tsconfigFiles.join(',') || '');
set('HAS_TS_CONFIG', tsconfigFiles.length ? 'yes' : 'no');

let ts = {};
const primary = tsconfigFiles.find((f) => f === 'tsconfig.json') ?? tsconfigFiles[0];
if (primary) {
  const parsed = readJson(join(DIR, primary));
  if (parsed) {
    ts = parsed;
    // a build tsconfig may extend the main one — merge its compilerOptions
    const ext = parsed.extends;
    if (ext && typeof ext === 'string' && !ext.startsWith('@')) {
      const parent = readJson(join(DIR, ext));
      if (parent) ts = { ...parent, ...parsed, compilerOptions: { ...parent.compilerOptions, ...parsed.compilerOptions } };
    }
  }
}
const co = ts.compilerOptions ?? {};
set('MODULE_MODE', co.module ?? '');
set('MODULE_RESOLUTION', co.moduleResolution ?? '');
set('STRICT', co.strict === true ? 'true' : co.strict === false ? 'false' : 'unset');
set('TARGET', co.target ?? '');
set('JSX', co.jsx ?? 'none');
set('PATHS', co.paths && Object.keys(co.paths).length ? 'yes' : 'no');
set('NO_EMIT', co.noEmit === true ? 'true' : 'false');
set('TYPES', Array.isArray(co.types) ? co.types.join(',') : '');

// ---- package.json --------------------------------------------------------
const pkg = readJson(join(DIR, 'package.json')) ?? {};
const scripts = pkg.scripts ?? {};
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
set('PACKAGE_TYPE', pkg.type ?? 'commonjs');
set('TYPESCRIPT_VERSION', deps.typescript ?? '');

// ---- package manager -----------------------------------------------------
// package.json's "packageManager" field is the authoritative answer; the
// lockfiles are the fallback. Both being present (npm + pnpm) is itself a
// smell worth reporting — the IDE's Package manager setting follows one of
// them, and the team may be using a different one.
const LOCKFILES = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
};
const presentLockfiles = Object.keys(LOCKFILES).filter((f) => existsSync(join(DIR, f)));
const pmField = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
const pmFromField = pmField.split('@')[0] || '';
const pmFromLock = presentLockfiles.length ? LOCKFILES[presentLockfiles[0]] : '';
const pm = pmFromField || pmFromLock || 'npm';
set('PACKAGE_MANAGER', pm);
set('PACKAGE_MANAGER_PINNED', pmFromField ? pmField.split('@')[1] || 'yes' : 'no');
set('LOCKFILES', presentLockfiles.join(',') || '');
set('LOCKFILE', presentLockfiles.find((f) => LOCKFILES[f] === pm) ?? presentLockfiles[0] ?? '');
set('MULTIPLE_LOCKFILES', presentLockfiles.length > 1 ? 'yes' : 'no');

// ---- workspace / monorepo ------------------------------------------------
const workspaceGlobs = [];
if (existsSync(join(DIR, 'pnpm-workspace.yaml'))) {
  try {
    const raw = readFileSync(join(DIR, 'pnpm-workspace.yaml'), 'utf8');
    const section = raw.split(/^packages\s*:/m)[1] ?? '';
    for (const line of section.split('\n')) {
      // stop at the next top-level key (allowBuilds:, catalog:, ...)
      if (/^[A-Za-z]/.test(line)) break;
      const m = line.match(/^\s*-\s*(.+)$/);
      if (m) workspaceGlobs.push(m[1].trim());
    }
  } catch { /* unreadable */ }
}
const pkgWorkspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
set('WORKSPACE', workspaceGlobs.length || pkgWorkspaces.length ? 'yes' : 'no');
set('WORKSPACE_GLOBS', [...workspaceGlobs, ...pkgWorkspaces].join(',') || '');
const workspacePkgs = existsSync(join(DIR, 'packages')) ? readdirSync(join(DIR, 'packages')) : [];
set('WORKSPACE_PACKAGES', workspacePkgs.length ? workspacePkgs.join(',') : '');

// test runner: an explicit dependency wins over the script text
let runner = 'none';
if (deps.vitest) runner = 'vitest';
else if (deps.jest) runner = 'jest';
else if (/vitest/.test(scripts.test ?? '')) runner = 'vitest';
else if (/jest/.test(scripts.test ?? '')) runner = 'jest';
set('TEST_RUNNER', runner);

// the test entry point: "test" is not the only valid name — a project may
// expose test:all / test:unit:all and still have a perfectly good gate.
// Prefer the conventional full-suite entry over any test:* side script.
const testScriptNames = Object.keys(scripts).filter((k) => k === 'test' || k.startsWith('test:'));
const PREFERRED_TEST = ['test', 'test:all', 'test:unit:all', 'test:unit', 'test:ci', 'test:full'];
const testScript = PREFERRED_TEST.find((k) => testScriptNames.includes(k))
  ?? testScriptNames.find((k) => /^test(:(all|unit|ci|full))/.test(k))
  ?? testScriptNames[0];
set('TEST_SCRIPT', testScript ?? '');
set('TEST_SCRIPTS', testScriptNames.length);

// the typecheck entry point: projects that wrap `tsc --noEmit` behind a script
// (to pin heap limits, scope the files, or fail early) are the norm
const typecheckScript = Object.keys(scripts).find((k) => k === 'typecheck' || k.startsWith('typecheck:'));
set('TYPECHECK_ENTRY', typecheckScript || (co.noEmit === true ? 'tsc --noEmit' : ''));

// is the TypeScript ESLint rule set actually wired in?
const eslintCfgFile = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts']
  .find((f) => existsSync(join(DIR, f)));
let eslintTsWiring = 'none';
if (eslintCfgFile) {
  const text = readFileSync(join(DIR, eslintCfgFile), 'utf8');
  if (/tseslint\.configs\./.test(text)) eslintTsWiring = 'tseslint-meta';
  // covers the split packages (@typescript-eslint/parser) and the
  // FlatCompat bridge ("plugin:@typescript-eslint/recommended")
  else if (/@typescript-eslint/.test(text)) eslintTsWiring = 'split-packages';
}
set('ESLINT_TS_WIRING', eslintTsWiring);

// package.json "type" must agree with the tsconfig module mode
{
  const type = pkg.type ?? 'commonjs';
  const bundler = co.moduleResolution === 'bundler' || ['preserve', 'esnext'].includes(co.module ?? '');
  const esm = ['nodenext', 'node16', 'node18', 'node20'];
  const cjs = ['commonjs', 'node16', 'node18', 'node20'];
  const ok = bundler
    || (type === 'module' ? esm.includes(co.module ?? '') : cjs.includes(co.module ?? ''));
  set('MODULE_TYPE_COMPAT', ok ? 'yes' : 'no');
}

// build mode
const BUNDLER_RE = /vite|webpack|rollup|esbuild|next\s+build|nuxt\s+build/;
let build = 'none';
if (co.noEmit === true && BUNDLER_RE.test(scripts.build ?? '')) build = 'bundler';
else if (co.noEmit === true) build = 'tsc-typecheck';
else if (/tsc\s+-b|tsc\s+-p|tsc\s*$/.test(scripts.build ?? '')) build = 'tsc-build';
else if (BUNDLER_RE.test(scripts.build ?? '')) build = 'bundler';
set('BUILD_MODE', build);

// ---- eslint / prettier / node --------------------------------------------
const eslintCfg = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts']
  .find((f) => existsSync(join(DIR, f)));
set('ESLINT_CONFIG', eslintCfg ?? '');
const prettierCfg = ['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml',
  '.prettierrc.json5', 'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs']
  .find((f) => existsSync(join(DIR, f)));
set('PRETTIER_CONFIG', prettierCfg ?? '');

let pin = '';
try { pin = readFileSync(join(DIR, '.nvmrc'), 'utf8').trim().replace(/^v/, ''); } catch { /* none */ }
set('NODE_PIN', pin);
set('NODE_MATCHES_PIN', pin ? (pin === process.versions.node ? 'yes' : 'no') : 'unknown');

// @types/node must describe the runtime that actually executes
const atNode = deps['@types/node'] ?? '';
const atNodeInstalled = (() => {
  try {
    return JSON.parse(readFileSync(join(DIR, 'node_modules', '@types', 'node', 'package.json'), 'utf8')).version;
  } catch { return ''; }
})();
set('AT_TYPES_NODE', atNodeInstalled || atNode);
set('AT_TYPES_NODE_MATCHES_PIN',
  pin && atNodeInstalled
    ? (atNodeInstalled.split('.')[0] === pin.split('.')[0] ? 'yes' : 'no')
    : 'unknown');

// ---- multiple tsconfigs ---------------------------------------------------
set('TS_CONFIG_COUNT', String(tsconfigFiles.length));
set('TS_CONFIG_EXTENDS_MAIN', tsconfigFiles
  .filter((f) => f !== primary)
  .map((f) => {
    const p = readJson(join(DIR, f));
    return `${f}->${typeof p?.extends === 'string' ? p.extends : 'none'}`;
  })
  .join(','));

// ---- shape ----------------------------------------------------------------
let shape = 'unknown';
if (co.moduleResolution === 'bundler' || co.jsx) shape = 'web';
else if (['nodenext', 'node16', 'node20', 'node18'].includes(co.module ?? '')) shape = 'node';
else if (pkg.type === 'module' || deps.typescript) shape = 'node';
set('SHAPE', shape);

// ---- conditions（供分发器按条件过滤本分册清单） ---------------------------
// 每条清单条目的 applies_to 是一个条件列表；命中任意一个即适用（"any" 恒适用）。
const conditions = new Set();
if (tsconfigFiles.length) conditions.add('tsconfig');
if (existsSync(join(DIR, 'package.json'))) conditions.add('js-project');
if (shape === 'node') conditions.add('node');
if (shape === 'web') conditions.add('web');
if (runner === 'vitest') conditions.add('vitest');
if (runner === 'jest') conditions.add('jest');
if (build === 'tsc-build') conditions.add('tsc-build');
if (build === 'bundler') conditions.add('bundler');
if (build === 'tsc-typecheck') conditions.add('tsc-typecheck');
if (pm && pm !== 'npm') conditions.add(pm);
if (workspaceGlobs.length || pkgWorkspaces.length) conditions.add('workspace');
if (tsconfigFiles.length > 1) conditions.add('multi-tsconfig');
set('CONDITIONS', [...conditions].sort().join(','));

// ---- 输出事实 -------------------------------------------------------------
for (const [k, v] of Object.entries(facts)) console.log(`${k}=${v}`);
