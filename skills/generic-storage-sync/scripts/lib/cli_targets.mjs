// cli_targets.mjs — 介质（target）解析与驱动发现 + target 三命令（零依赖）
//
// 口径（与 scripts/*.mjs 既有模块一致，不另立）：
//   - 介质来源：.agents/.env 的 STORAGE_TARGET_<ID>（值格式 <type>:<endpoint>）+ 索引 targets 表；
//     同名时索引优先。
//   - 介质 id = 变量名去掉 STORAGE_TARGET_ 前缀后的小写形式。
//   - 驱动实例化：local → LocalFsDriver；其它 type 动态发现兄弟技能里继承 BaseDriver 的实现，
//     未安装即明确报「驱动未安装」，绝不假装成功。
//   - 相对 endpoint 一律相对 PROJECT_ROOT 解析，绝不依赖进程 cwd。

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadEnv } from '../env.mjs';
import { BaseDriver, DriverError, DRIVER_ERROR_CODES as E } from '../driver_spi.mjs';
import { LocalFsDriver } from '../local_driver.mjs';
import { IndexStore } from '../index_store.mjs';
import { resolveBufferRoot, resolveGitPath } from '../buffer_pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = resolve(HERE, '..', '..');
export const TARGET_PREFIX = 'STORAGE_TARGET_';
export const TARGET_TYPES = ['local', 'sftp', 'smb', 'baidu', 'quark'];

/** 字节数格式化（淘汰清单 / 回收站占用用） */
export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KiB`;
  return `${(b / 1048576).toFixed(2)} MiB`;
}

/** 介质端点：绝对路径与 UNC 原样保留；相对路径相对 PROJECT_ROOT 解析 */
export function resolveEndpoint(endpoint, env = loadEnv()) {
  const raw = String(endpoint ?? '').trim();
  if (!raw) return '';
  const norm = raw.replace(/\\/g, '/');
  if (/^(?:\/|[A-Za-z]:\/)/.test(norm)) return norm;
  return resolve(env.PROJECT_ROOT || process.cwd(), raw);
}

/** 环境变量里的介质：STORAGE_TARGET_<ID> → id；值 <type>:<endpoint> */
export function envTargets(env = loadEnv()) {
  const out = [];
  for (const [key, value] of Object.entries(env.raw || {})) {
    if (!key.startsWith(TARGET_PREFIX)) continue;
    const id = key.slice(TARGET_PREFIX.length).toLowerCase();
    const raw = String(value ?? '').trim();
    const cut = raw.indexOf(':');
    if (!id || cut <= 0) continue;
    out.push({
      id,
      type: raw.slice(0, cut).trim().toLowerCase(),
      endpoint: raw.slice(cut + 1).trim(),
      enabled: true,
      source: 'env',
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** 介质清单：索引 targets ∪ 环境变量（同名索引优先） */
export function allTargets(store, env = loadEnv()) {
  const map = new Map(envTargets(env).map((t) => [t.id, t]));
  for (const t of store.listTargets()) {
    const base = map.get(t.id);
    map.set(t.id, { ...base, ...t, id: t.id, source: base ? 'index+env' : 'index' });
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 按 id 取介质（找不到即报错） */
export function resolveTargetSpec(id, store, env = loadEnv()) {
  const found = allTargets(store, env).find((t) => t.id === id);
  if (!found) throw new DriverError(E.GSS_E_NOT_FOUND, `未找到介质：${id}`);
  return found;
}

/** 默认介质：只有一个时直接用；多个必须显式指定 */
export function defaultTarget(store, env = loadEnv()) {
  const list = allTargets(store, env);
  if (list.length === 1) return list[0];
  if (list.length === 0) throw new DriverError(E.GSS_E_CONFIG, '未配置任何介质（.agents/.env 的 STORAGE_TARGET_<ID>）');
  throw new DriverError(E.GSS_E_CONFIG, `存在多个介质，请用 --target 指定：${list.map((t) => t.id).join(' / ')}`);
}

/** 本地缓冲盘 + 本地索引（CLI 统一入口） */
export function openStore(env = loadEnv()) {
  const rootDir = resolveBufferRoot();
  return { rootDir, store: new IndexStore({ rootDir }) };
}

/** 兄弟技能目录（外部驱动落位处） */
function siblingSkills() {
  const root = dirname(SKILL_ROOT);
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== basename(SKILL_ROOT))
      .map((e) => join(root, e.name));
  } catch {
    return [];
  }
}

/** 动态发现外部驱动：兄弟技能 scripts/ 下 *driver*.mjs 中继承 BaseDriver 且 driverType 匹配的类 */
export async function discoverDriverClass(type) {
  for (const dir of siblingSkills()) {
    const scriptsDir = join(dir, 'scripts');
    if (!existsSync(scriptsDir)) continue;
    for (const file of readdirSync(scriptsDir).filter((f) => /driver.*\.mjs$/i.test(f))) {
      let mod;
      try {
        mod = await import(pathToFileURL(join(scriptsDir, file)).href);
      } catch {
        continue;
      }
      for (const value of Object.values(mod)) {
        if (typeof value !== 'function' || !BaseDriver.prototype.isPrototypeOf(value.prototype)) continue;
        try {
          if (Object.create(value.prototype).driverType === type) return value;
        } catch {
          /* 探测失败即跳过该候选 */
        }
      }
    }
  }
  return null;
}

/** 驱动实例化：local → LocalFsDriver；其它 type 未安装则明确报错 */
export async function createDriver(spec, env = loadEnv()) {
  const endpoint = resolveEndpoint(spec.endpoint, env);
  if (spec.type === 'local') return new LocalFsDriver({ root: endpoint, endpoint });
  const cls = await discoverDriverClass(spec.type);
  if (!cls) {
    throw new DriverError(
      E.GSS_E_NOT_IMPLEMENTED,
      `该介质类型驱动未安装（type=${spec.type}），请由对应 Agent 按 references/driver-spi.md 实现后放入 skills 目录`
    );
  }
  return new cls({ root: endpoint, endpoint, ...(spec.options || {}) });
}

/** 仓库 fullName：优先 git remote origin，其次目录名 owner__repo */
export function deriveFullName(repoPath) {
  const dir = resolve(repoPath);
  const r = spawnSync(resolveGitPath(), ['config', '--get', 'remote.origin.url'], {
    cwd: dir, encoding: 'utf-8', shell: false, windowsHide: true,
  });
  const url = (r.stdout || '').trim().replace(/\/+$/, '');
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return `${m[1]}/${m[2]}`;
  const base = basename(dir);
  const i = base.indexOf('__');
  return i > 0 ? `${base.slice(0, i)}/${base.slice(i + 2)}` : base;
}

/** 介质快照命名 → 仓库（索引优先，其次按 <owner>__<repo>-<sha>.bundle 约定反推） */
export function slugToFullName(archiveName) {
  const slug = String(archiveName || '').replace(/\.bundle$/i, '').replace(/-[0-9a-f]{7,40}$/i, '');
  const i = slug.indexOf('__');
  return i > 0 ? `${slug.slice(0, i)}/${slug.slice(i + 2)}` : slug;
}

/** ================= target list ================= */
export const defList = {
  usage: 'target list',
  summary: '列出已配置介质（.agents/.env 变量 + 索引 targets 表）',
  booleans: [],
  strings: [],
  positionals: 0,
  async run() {
    const env = loadEnv();
    const { store } = openStore(env);
    const targets = allTargets(store, env);
    console.log('=== target list ===');
    if (!targets.length) {
      console.log('（未配置任何介质：在 .agents/.env 配 STORAGE_TARGET_<ID>，或用 target add 登记）');
      return;
    }
    for (const t of targets) {
      const endpoint = resolveEndpoint(t.endpoint, env);
      console.log(`  [${t.id}] type=${t.type} endpoint=${endpoint} 来源=${t.source}${t.enabled === false ? ' 已禁用' : ''}`);
    }
    console.log(`共 ${targets.length} 个介质`);
  },
};

/** ================= target add ================= */
export const defAdd = {
  usage: 'target add <id> --type <type> --endpoint <path>',
  summary: '登记介质（写入本地索引 targets 表）',
  booleans: [],
  strings: ['--type', '--endpoint'],
  positionals: 1,
  async run(flags, positionals) {
    const id = String(positionals[0] || '').trim();
    const type = String(flags.type || '').trim().toLowerCase();
    const endpoint = String(flags.endpoint || '').trim();
    if (!id) throw new Error('缺少介质 id');
    if (!TARGET_TYPES.includes(type)) throw new Error(`非法介质类型：${type}（可选：${TARGET_TYPES.join(' / ')}）`);
    if (!endpoint) throw new Error('缺少 --endpoint');
    const { store } = openStore();
    store.saveTarget({ id, type, endpoint, enabled: true, priority: 0 });
    console.log(`=== target add ===`);
    console.log(`已登记介质 ${id} (${type}) → ${endpoint}`);
    console.log(`索引：${store.indexPath}`);
  },
};

/** ================= target test ================= */
export const defTest = {
  usage: 'target test [id]',
  summary: '介质连通性探活（全部或指定 id）',
  booleans: [],
  strings: [],
  positionals: 1,
  async run(flags, positionals) {
    const env = loadEnv();
    const { store } = openStore(env);
    const targets = positionals.length
      ? [resolveTargetSpec(positionals[0], store, env)]
      : allTargets(store, env);
    console.log('=== target test ===');
    if (!targets.length) {
      console.log('（未配置任何介质）');
      return;
    }
    let failed = 0;
    for (const t of targets) {
      try {
        const driver = await createDriver(t, env);
        const r = await driver.ping();
        console.log(`  [${t.id}] ✓ ping ok (${r?.driverType || t.type}) root=${r?.root || ''}`);
      } catch (err) {
        failed++;
        console.log(`  [${t.id}] ✗ ${err?.message || err}`);
      }
    }
    console.log(`探活 ${targets.length} 个介质，失败 ${failed} 个`);
    if (failed) process.exitCode = 1;
  },
};

/** ================= target 命令组 ================= */
export const defTarget = {
  usage: 'target <list|add|test> [args]',
  summary: '介质管理：列表 / 登记 / 探活',
  subcommands: { list: defList, add: defAdd, test: defTest },
};
