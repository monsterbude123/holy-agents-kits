// paths.mjs — 项目路径解析（统一从 env 取，禁 process.env 直读）
//
// 设计：原实现用 import.meta.url 反推项目根（编译后位置一变就坏）。
// 现改造：所有路径一律经 load_env().get()，环境变量 GITHUB_KNOWLEDGE_HELPER_SPACE
// 提供项目根绝对路径，load_env 在首次 get 时自动初始化。
//
// 兼容：getProjectRoot(cwd) 仍保留「从 cwd 向上找 manifest.json」的探测能力，
// 用于测试在 tmpRoot 跑的 case；非空 cwd 时优先用 cwd 解析，回退到 env 提供的 root。
//
// 惰性：路径常量改为函数，导入本模块不再触发 env 初始化 → `cli.mjs --help` 无需配置即可跑。

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { get, load_env } from './envStrict.mjs';

/** env 提供的项目根（保证存在 + 含 manifest.json） */
export function projectRoot() {
  load_env();
  return get('project_root');
}

/** env 提供的 repos/ 根目录 */
export function reposRoot() {
  load_env();
  return get('repos_root');
}

/** env 提供的 docs/ 根目录 */
export function docsRoot() {
  load_env();
  return get('docs_root');
}

/** env 提供的 manifest.json 绝对路径 */
export function manifestPath() {
  load_env();
  return get('manifest_path');
}

// 聚合目录列表（用于推断 group 字段）
export const GROUPS = ['ai-app', 'ai-prompt', 'ai-skills-sets'];

/**
 * 解析项目根：cwd 不为空时从 cwd 向上找第一个含 manifest.json 的目录；
 * 找不到或 cwd 为空时回退到 env 提供的项目根。
 *
 * 用途：CLI 命令在项目根运行时，cwd 即项目根 → 直接返回；
 * 单元/集成测试在 tmpRoot 运行（process.chdir）时，自动定位到 tmpRoot。
 * 这样 lib 层函数不依赖全局状态，测试可安全在 tmp 跑。
 */
export function getProjectRoot(cwd = process.cwd()) {
  if (!cwd) return projectRoot();
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) return projectRoot(); // 兜底
    dir = parent;
  }
}

/** getProjectRoot 下的派生路径。 */
export function getProjectPaths(cwd = process.cwd()) {
  const root = getProjectRoot(cwd);
  return {
    root,
    repos: join(root, 'repos'),
    docs: join(root, 'docs'),
    manifest: join(root, 'manifest.json'),
  };
}
