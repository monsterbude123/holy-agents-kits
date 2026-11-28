// envStrict.mjs — 严格环境加载层（github-kownledge-helper 专属）
//
// 与共享核心 env.mjs 的分工：
//   env.mjs       两技能共有 —— .env 解析（parseDotEnv）与向上探测（findEnvFile）
//   envStrict.mjs 本技能独有 —— 严格的项目根校验 + 路径白名单访问
// 严格层复用 env.mjs 的解析与探测原语，不存在两套解析逻辑。

import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { parseDotEnv, findEnvFile, SKILL_ENV, SKILL_ENV_STD } from './env.mjs';

/** 严格加载器允许的 key 白名单 */
export const ENV_KEYS = [
  'project_root',
  'repos_root',
  'docs_root',
  'manifest_path',
  'doc_map_scripts',
  'dot_env_path',
];

/** repos 根目录配置项：可把仓库本体放到项目根之外（如统一放 D:\workspace\GitHub） */
export const REPOS_DIR_ENV = 'GITHUB_KNOWLEDGE_HELPER_REPOS_DIR';

/**
 * 解析 repos 根目录。
 *
 * 归属原则：repos 根属于**项目自身**，配置读 <root>/.agents/.env，
 * 不走 cwd 向上探测 —— 否则在 tmpRoot 里跑测试时会命中用户全局
 * ~/.agents/.env，把 repos 根解析到真实项目目录去。
 *
 * 优先级：process.env > <root>/.agents/.env > <root>/repos
 */
export function resolveReposDir(root) {
  const fromEnv = String(process.env[REPOS_DIR_ENV] ?? '').trim();
  let configured = fromEnv;
  if (!configured) {
    const envFile = join(root, '.agents', '.env');
    if (existsSync(envFile)) {
      try {
        const parsed = parseDotEnv(readFileSync(envFile, 'utf-8'));
        configured = String(parsed[REPOS_DIR_ENV] ?? '').trim();
      } catch {
        /* 容错：读不到就退回默认 */
      }
    }
  }
  if (!configured) return join(root, 'repos');
  if (!isAbsolute(configured)) {
    throw new LoadEnvError(
      `${REPOS_DIR_ENV}=${configured} 不是绝对路径。必须是仓库根目录的绝对路径。`
    );
  }
  if (!existsSync(configured)) {
    throw new LoadEnvError(`${REPOS_DIR_ENV}=${configured} 路径不存在。`);
  }
  return configured;
}

export class LoadEnvError extends Error {
  constructor(msg) {
    super(`[load_env] ${msg}`);
    this.name = 'LoadEnvError';
  }
}

let strictCache = null; // 严格缓存
let strictError = null; // 首次初始化失败（缓存后重抛）
let dotEnvOverride = null; // 测试注入：字符串路径 / false=禁用 / null=自动探测

/** 严格加载器的 .env 定位：显式覆盖 > env 指向的项目根 > 向上递归探测 */
function resolveStrictEnvFile() {
  if (typeof dotEnvOverride === 'string') return dotEnvOverride;
  const envRoot = process.env[SKILL_ENV_STD] || process.env[SKILL_ENV];
  if (envRoot && isAbsolute(envRoot)) {
    const candidate = join(envRoot, '.agents', '.env');
    if (existsSync(candidate)) return candidate;
  }
  return findEnvFile(process.cwd());
}

/**
 * 严格初始化环境缓存。
 * - 幂等：重复调用只初始化一次
 * - 失败：抛 LoadEnvError（不静默吞），并缓存错误后续重抛
 */
export function load_env() {
  if (strictCache) return;
  if (strictError) throw strictError;

  try {
    let loadedDotEnvPath = null;

    if (dotEnvOverride !== false) {
      const dotEnvFile = resolveStrictEnvFile();
      if (dotEnvFile && existsSync(dotEnvFile)) {
        loadedDotEnvPath = dotEnvFile;
        const parsed = parseDotEnv(readFileSync(dotEnvFile, 'utf-8'));
        for (const [k, v] of Object.entries(parsed)) {
          if (process.env[k] === undefined || process.env[k] === '') {
            process.env[k] = v;
          }
        }
      }
    }

    const rawRoot = process.env[SKILL_ENV_STD] || process.env[SKILL_ENV];
    const root = rawRoot?.trim();

    if (!root) {
      throw new LoadEnvError(
        `${SKILL_ENV_STD} 未设置。请在 .agents/.env 中配置 ${SKILL_ENV_STD}="<项目根绝对路径>"，或在环境变量设置。`
      );
    }
    if (!isAbsolute(root)) {
      throw new LoadEnvError(
        `${SKILL_ENV_STD}=${root} 不是绝对路径。必须是项目根的绝对路径。`
      );
    }
    if (!existsSync(root)) {
      throw new LoadEnvError(`${SKILL_ENV_STD}=${root} 路径不存在。`);
    }
    if (!existsSync(join(root, 'manifest.json'))) {
      // 首装自举：manifest.json 由 sync-manifest 生成，缺失只提示不阻断初始化
      console.warn(
        `[load_env] ${root} 下暂无 manifest.json。首装请先运行 ` +
          `node scripts/cli.mjs sync-manifest 生成（将扫描 repos/ 下已有仓库，没有则生成空清单）。`
      );
    }

    const docMapScripts =
      process.env.DOC_MAP_MANAGER_SCRIPTS ??
      join(
        process.env.HOME ?? process.env.USERPROFILE ?? '',
        '.agents',
        'skills',
        'doc-map-manager',
        'scripts'
      );

    // repos 根目录：默认 <project_root>/repos，可用 REPOS_DIR_ENV 外置到任意绝对路径
    const reposRoot = resolveReposDir(root);

    strictCache = {
      project_root: root,
      repos_root: reposRoot,
      docs_root: join(root, 'docs'),
      manifest_path: join(root, 'manifest.json'),
      doc_map_scripts: docMapScripts,
      dot_env_path: loadedDotEnvPath ?? '',
    };
  } catch (e) {
    strictError = e;
    throw e;
  }
}

/**
 * 取路径缓存。load_env() 未初始化会自动调一次。
 * key 必须是 ENV_KEYS 之一；其他 key 抛 LoadEnvError。
 */
export function get(key) {
  if (!strictCache) load_env();
  if (!strictCache) throw new LoadEnvError('internal: cache not initialized');
  if (!ENV_KEYS.includes(key)) {
    throw new LoadEnvError(
      `unknown key "${key}"。允许：${ENV_KEYS.join(', ')}`
    );
  }
  return strictCache[key];
}

/** 测试辅助：清空严格缓存 */
export function _resetForTest() {
  strictCache = null;
  strictError = null;
  dotEnvOverride = null;
}

/** 测试辅助：设置 .env 覆盖路径或禁用 .env 加载 */
export function _setDotEnvForTest(override) {
  dotEnvOverride = override;
}

/** 测试/排查辅助：当前严格缓存快照 */
export function _snapshot() {
  return strictCache;
}

export { SKILL_ENV, SKILL_ENV_STD };
