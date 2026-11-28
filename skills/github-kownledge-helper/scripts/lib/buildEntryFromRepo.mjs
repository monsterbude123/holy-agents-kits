// buildEntryFromRepo.mjs — 从已 clone 的 git 仓库构造 manifest RepoEntry

import { execFileSync } from 'node:child_process';

/**
 * 从已 clone 的 git 仓库构造 manifest 条目。
 * 失败：仓库不存在 / 不是 git 仓库 / 没有 remote.origin.url。
 */
export function buildEntryFromRepo(absPath, opts) {
  const url = gitOrEmpty(absPath, ['config', '--get', 'remote.origin.url']);
  if (!url) {
    throw new Error(
      `no remote.origin.url in ${absPath}（未 clone 或 origin 未设置）`
    );
  }

  const branch = gitOrEmpty(absPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const shaFull = gitOrEmpty(absPath, ['rev-parse', 'HEAD']);
  const shaShort = gitOrEmpty(absPath, ['rev-parse', '--short', 'HEAD']);
  const commitDate = gitOrEmpty(absPath, ['log', '-1', '--format=%cI', 'HEAD']);

  if (!shaFull || !branch) {
    throw new Error(`git rev-parse failed in ${absPath}`);
  }

  const dir = `${opts.owner}__${opts.repo}`;
  const path = opts.group
    ? `repos/${opts.group}/${dir}`
    : `repos/${dir}`;
  const docsPath = opts.group
    ? `docs/${opts.group}/${dir}`
    : `docs/${dir}`;

  return {
    name: opts.repo,
    owner: opts.owner,
    full_name: `${opts.owner}/${opts.repo}`,
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

function gitOrEmpty(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
