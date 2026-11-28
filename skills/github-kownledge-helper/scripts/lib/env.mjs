// env.mjs — 纯原生零依赖环境加载器（零构建 / 零 node_modules）
//
// 同源约定（GHK-07 / TKT-01）
//   本文件在两个技能中**逐字节一致**：
//     - github-kownledge-helper/scripts/lib/env.mjs
//     - generic-storage-sync/scripts/env.mjs
//   两技能物理隔离、零 import 依赖（TKT-09），因此「共用一份实现」只能靠同源同行为 +
//   同步维护；**任何改动必须同步两处**，否则解析逻辑分叉。
//
// 能力（本文件 = 两技能共享的解析/探测核心）
//   parseDotEnv(content)   解析 .env 文本：# 注释 / 空行 / 单双引号 / 值内含 '='
//   findEnvFile(startDir)  向上递归探测 .agents/.env（兼容同目录 .env）
//   loadEnv(options)       宽松加载：process.env > 文件 > 默认值
//
// 双拼写兼容：GITHUB_KNOWLEDGE_HELPER_SPACE（标准）/ GITHUB_KOWNLEDGE_HELPER_SPACE（旧）
//
// 注：github-kownledge-helper 侧的**严格**加载层（路径白名单 + 项目根校验）在
//     envStrict.mjs；本文件提供它所依赖的解析与探测原语，故不存在两套解析逻辑。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SKILL_ENV_STD = 'GITHUB_KNOWLEDGE_HELPER_SPACE';
export const SKILL_ENV = 'GITHUB_KOWNLEDGE_HELPER_SPACE'; // 兼容旧拼写

let lenientCache = null; // loadEnv 缓存

/**
 * 解析 .env 文件内容为键值对字典。
 * 支持 # 注释、空行、单/双引号包裹、值内含 '='。
 */
export function parseDotEnv(content) {
  const result = {};
  for (const rawLine of String(content ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * 向上递归寻找 .env 配置文件。
 * 优先 <dir>/.agents/.env，其次 <dir>/.env；逐级向上直到根目录。
 */
export function findEnvFile(startDir = process.cwd()) {
  let curr = resolve(startDir);
  while (true) {
    const candidate = join(curr, '.agents', '.env');
    if (existsSync(candidate)) return candidate;
    const directCandidate = join(curr, '.env');
    if (existsSync(directCandidate)) return directCandidate;
    const parent = resolve(curr, '..');
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

/**
 * 宽松加载：process.env > .env 文件 > 默认值。
 * options.envFile 指定文件；options.startDir 指定探测起点；options.forceReload 强制重载。
 */
export function loadEnv(options = {}) {
  if (lenientCache && !options.forceReload) return lenientCache;

  const envFile = options.envFile || findEnvFile(options.startDir || process.cwd());
  let fileConfig = {};

  if (envFile && existsSync(envFile)) {
    try {
      fileConfig = parseDotEnv(readFileSync(envFile, 'utf-8'));
    } catch {
      // 容错读取
    }
  }

  // process.env > fileConfig > 默认回退
  const getVal = (key, fallback = '') => {
    return process.env[key] || fileConfig[key] || fallback;
  };

  const projectRoot = getVal(SKILL_ENV_STD, getVal(SKILL_ENV, process.cwd()));
  const bufferSpace = getVal('STORAGE_BUFFER_SPACE', join(projectRoot, 'buffer'));
  const maxRetained = parseInt(getVal('STORAGE_MAX_RETAINED_SNAPSHOTS', '2'), 10) || 2;
  const trashTtlDays = parseInt(getVal('STORAGE_TRASH_TTL_DAYS', '7'), 10) || 7;
  const autoTrash = getVal('STORAGE_AUTO_TRASH_ON_PUSH', 'true') !== 'false';

  lenientCache = {
    PROJECT_ROOT: projectRoot,
    STORAGE_BUFFER_SPACE: bufferSpace,
    STORAGE_MAX_RETAINED_SNAPSHOTS: maxRetained,
    STORAGE_TRASH_TTL_DAYS: trashTtlDays,
    STORAGE_AUTO_TRASH_ON_PUSH: autoTrash,
    ENV_FILE_PATH: envFile || '',
    raw: { ...fileConfig, ...process.env },
  };

  return lenientCache;
}

/** 测试辅助：清空宽松加载缓存 */
export function _resetForTest() {
  lenientCache = null;
}
