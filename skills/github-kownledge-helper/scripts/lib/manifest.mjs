// manifest.mjs — manifest.json 读写 + 追加/去重/查找
// 原子写入：写临时文件再 rename，避免半写状态

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { manifestPath, getProjectRoot } from './paths.mjs';

/**
 * @typedef {Object} RepoEntry
 * @property {string} name 仓库名（不含 owner）
 * @property {string} owner owner
 * @property {string} full_name owner/repo，去重键
 * @property {string} url clone url
 * @property {string} path 相对项目根的仓库路径
 * @property {string} docs_path 相对项目根的文档镜像路径
 * @property {string} group 聚合分组，顶层为空字符串
 * @property {string} default_branch 当前检出的分支名
 * @property {string} added_at 收录时间，ISO 8601 +08:00
 * @property {string} last_pull_at 最后 pull 时间，ISO 8601 +08:00
 * @property {string} current_commit 当前 commit full sha
 * @property {string} current_commit_short 当前 commit short sha
 * @property {string} current_commit_date 当前 commit 日期，ISO 8601
 * @property {string[]} tags 标签，用于分类检索
 * @property {string} notes 备注
 */

/**
 * @typedef {Object} Manifest
 * @property {string} version schema 版本
 * @property {string} updated_at 最后更新时间，ISO 8601 +08:00
 * @property {number} repo_count 仓库数量
 * @property {RepoEntry[]} repos 仓库列表
 */

/** 读取 manifest.json，解析为 Manifest 对象。cwd 决定项目根。 */
export function readManifest(cwd) {
  const path = cwd ? join(getProjectRoot(cwd), 'manifest.json') : manifestPath();
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 原子写入 manifest.json。
 * 先写 .tmp 临时文件，成功后 rename 覆盖正式文件。
 * cwd 决定项目根。
 */
export function writeManifest(manifest, cwd) {
  const path = cwd ? join(getProjectRoot(cwd), 'manifest.json') : manifestPath();
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

/** manifest.json 是否存在 */
export function manifestExists(cwd) {
  const path = cwd ? join(getProjectRoot(cwd), 'manifest.json') : manifestPath();
  return existsSync(path);
}

/** 按 full_name 查 entry。 */
export function findByFullName(m, fullName) {
  return m.repos.find((r) => r.full_name === fullName) ?? null;
}

/**
 * 追加 entry 到 manifest。重复 full_name 抛错。
 * 同时 bumps repo_count 与 updated_at。
 * 返回 mutate 后的同一 Manifest（in-place + return）。
 */
export function appendEntry(m, entry, now) {
  if (findByFullName(m, entry.full_name)) {
    throw new Error(`duplicate full_name: ${entry.full_name}`);
  }
  m.repos.push(entry);
  m.repo_count = m.repos.length;
  m.updated_at = now;
  return m;
}

/**
 * Merge 一条新的 git 实测 entry 到旧 entry：
 * - 保留 added_at / last_pull_at / tags / notes / group（属于运营元数据）
 * - 用 fresh 的 git 派生字段（branch / commit / commit_date / url）
 * - 当 commit 与旧不同时把 last_pull_at 拨到 now（视为检测到新 commit）
 * - 当 commit 与旧相同则保留 last_pull_at（sync-manifest 不算 update）
 */
export function mergeEntry(old, fresh, now) {
  const commitChanged = old.current_commit !== fresh.current_commit;
  return {
    name: fresh.name,
    owner: fresh.owner,
    full_name: fresh.full_name,
    url: fresh.url,
    path: fresh.path,
    docs_path: fresh.docs_path,
    group: old.group || fresh.group,
    default_branch: fresh.default_branch,
    added_at: old.added_at,
    last_pull_at: commitChanged ? now : old.last_pull_at,
    current_commit: fresh.current_commit,
    current_commit_short: fresh.current_commit_short,
    current_commit_date: fresh.current_commit_date,
    tags: old.tags,
    notes: old.notes,
  };
}

/** 按 path 稳定性排序 repos（顶层在前，组内按字典序） */
export function sortReposByPath(repos) {
  const GROUPS = ['ai-app', 'ai-prompt', 'ai-skills-sets'];
  const groupRank = (g) => {
    const idx = GROUPS.indexOf(g);
    return idx === -1 ? -1 : idx;
  };
  return [...repos].sort((a, b) => {
    const ga = groupRank(a.group);
    const gb = groupRank(b.group);
    if (ga !== gb) {
      if (ga === -1) return -1;
      if (gb === -1) return 1;
      return ga - gb;
    }
    return a.path.localeCompare(b.path);
  });
}
