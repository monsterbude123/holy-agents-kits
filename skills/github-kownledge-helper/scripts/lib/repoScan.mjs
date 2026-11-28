// repoScan.mjs — 扫描 repos/ 目录，收集 git 仓库的 owner/repo/group
//
// 规则（与 references/rules.md §3 一致）：
//   - 顶层目录 + 聚合目录（GROUPS）两层扫描
//   - 以 remote.origin.url 解析 owner/repo（不信任目录名）
//   - 跳过非 git 目录与无 origin 的目录

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { parseRepoInput } from './parseRepoInput.mjs';
import { reposRoot, GROUPS } from './paths.mjs';

/**
 * @typedef {Object} OwnerRepo
 * @property {string} owner
 * @property {string} repo
 * @property {string} group 顶层为 ''，聚合内为分组名
 */

/** 解析 origin url 为 owner/repo */
export function parseOrigin(url) {
  // 优先复用 parseRepoInput：正确处理 git@host: / ssh:// / https 全形态
  try {
    const { owner, repo } = parseRepoInput(url);
    return { owner, repo };
  } catch {
    /* 回退到既有 split 逻辑（嵌套分组路径等 parseRepoInput 不接受的形态） */
  }
  const clean = url.replace(/\.git$/, '');
  const parts = clean.split('/');
  if (parts.length < 2) return null;
  const repo = parts[parts.length - 1] ?? '';
  const owner = parts[parts.length - 2] ?? '';
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** 判断目录是否为 git 仓库（含 .git） */
export function isGitDir(absPath) {
  return existsSync(join(absPath, '.git'));
}

/** 目录 → OwnerRepo；非 git / 无 origin 返回 null */
function toOwnerRepo(absPath, group) {
  if (!isGitDir(absPath)) return null;
  const url = git(absPath, ['config', '--get', 'remote.origin.url']);
  if (!url) return null;
  const parsed = parseOrigin(url);
  if (!parsed) return null;
  return { owner: parsed.owner, repo: parsed.repo, group };
}

/** 扫描 repos/，收集每个 git 仓库的 owner/repo/group 列表；repos/ 不存在时返回空列表（首装自举） */
export function scanRepos() {
  const found = [];
  const root = reposRoot();

  // 顶层（repos/ 尚未创建 → 空清单，让 sync-manifest 仍可自举写出 manifest.json）
  let names = [];
  try {
    names = readdirSync(root);
  } catch (err) {
    if (err?.code === 'ENOENT') return found;
    throw err;
  }
  for (const name of names) {
    if (name === '.gitkeep') continue;
    if (GROUPS.includes(name)) continue;
    const hit = toOwnerRepo(join(root, name), '');
    if (hit) found.push(hit);
  }

  // 聚合目录
  for (const g of GROUPS) {
    const gPath = join(root, g);
    if (!existsSync(gPath)) continue;
    for (const name of readdirSync(gPath)) {
      const hit = toOwnerRepo(join(gPath, name), g);
      if (hit) found.push(hit);
    }
  }

  return found;
}

/** 收集 git 派生字段并构造 RepoEntry（不写 added_at/tags/notes） */
export function buildEntry(absPath, opts) {
  const url = git(absPath, ['config', '--get', 'remote.origin.url']);
  if (!url) return null;

  const branch = git(absPath, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const shaFull = git(absPath, ['rev-parse', 'HEAD']) || '';
  const shaShort = git(absPath, ['rev-parse', '--short', 'HEAD']) || '';
  const commitDate = git(absPath, ['log', '-1', '--format=%cI', 'HEAD']) || '';

  if (!shaFull) return null;
  const dir = opts.owner + '__' + opts.repo;
  // path 相对 repos 根（repos 根可配置到项目根之外，故不写死 repos/ 前缀）
  const path = opts.group ? opts.group + '/' + dir : dir;
  const docsPath = opts.group
    ? 'docs/' + opts.group + '/' + dir
    : 'docs/' + dir;

  return {
    name: opts.repo,
    owner: opts.owner,
    full_name: opts.owner + '/' + opts.repo,
    url,
    path,
    docs_path: docsPath,
    group: opts.group,
    default_branch: branch,
    added_at: opts.now,
    last_pull_at: opts.now,
    current_commit: shaFull,
    current_commit_short: shaShort,
    current_commit_date: commitDate,
    tags: [],
    notes: '',
  };
}

/** Drift 检测：列出 manifest commit 与 git HEAD 不一致的 repo */
export function detectDrift(old, current) {
  const drifts = [];
  for (const e of current) {
    const oldE = old.repos.find((r) => r.full_name === e.full_name);
    if (oldE && oldE.current_commit !== e.current_commit) {
      drifts.push({
        name: e.full_name,
        manifest: oldE.current_commit_short,
        head: e.current_commit_short,
      });
    }
  }
  return drifts;
}
