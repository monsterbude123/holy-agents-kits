// sync-to.mjs — sync-to 命令的 CLI 表面（镜像实现见 lib/mirror.mjs）
//
// 协议（见 references/workflows-sync-to.md）：
//   - 目标已存在 → 报错停手（不覆盖）
//   - 不写 manifest，不触发 doc-map-manager 索引（镜像 ≠ 收录）

import { join } from 'node:path';
import { parseRepoInput } from '../lib/parseRepoInput.mjs';
import { readManifest } from '../lib/manifest.mjs';
import { projectRoot, reposRoot } from '../lib/paths.mjs';
import { syncTo } from '../lib/mirror.mjs';

/**
 * 校验 repoInput 形式合法性（owner/repo 或 URL），返回 owner/repo。
 * 走 parseRepoInput 严格校验：非法输入直接抛错。
 * 真正的源路径解析在 CLI 入口用 readManifest 查 path。
 */
export function resolveSourcePath(repoInput, _defaultRoot) {
  if (!repoInput || !repoInput.trim()) {
    throw new Error('empty repo input');
  }
  parseRepoInput(repoInput); // 校验格式，非法抛错
  return repoInput;
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'sync-to <repo> <destination>',
  summary:
    '镜像仓库到任意绝对路径（含 .git，不写 manifest，不触发 doc 索引；目标已存在则报错停手）',
  booleans: [],
  strings: [],
  positionals: 2,
  async run(flags, positionals) {
    const [repo, destination] = positionals;
    let parsed;
    try {
      parsed = parseRepoInput(repo);
      resolveSourcePath(repo, process.cwd());
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }

    const manifest = readManifest();
    const entry = manifest.repos.find(
      (r) => r.full_name === `${parsed.owner}/${parsed.repo}`
    );
    if (!entry) {
      console.error(
        `✗ 未收录：${parsed.owner}/${parsed.repo}（按 full_name 在 manifest 中查不到）`
      );
      process.exit(1);
    }

    const sourcePath = join(reposRoot(), entry.path);
    console.log(`=== sync-to: ${repo} -> ${destination} ===`);
    console.log(`  source     : ${sourcePath}`);
    console.log(`  destination: ${destination}`);

    const r = await syncTo({ repoInput: repo, sourcePath, destination });

    console.log(`  ${r.message}`);
    if (!r.ok) {
      console.error(`✗ sync-to 失败：${r.message}`);
      process.exit(1);
    }
  },
};

export { syncTo };
