// update.mjs — 按 manifest 拉取仓库并回写状态
// 规则（与 references/rules.md §4 一致）：
//   - ff-only：遇非快进不重置，报告状态
//   - 顺序执行：禁止并发
//   - 失败不静默：clone/pull 失败必须报告
//   - 浅克隆优先：shallow 仓库 fetch 时拿不到老历史，但 ff-only pull 不需要
// 长过程：每个阶段（start / fetch / pull / done）必须即时打日志，否则用户视角卡死。

import { join } from 'node:path';
import { reposRoot } from '../lib/paths.mjs';
import { git, gitStream } from '../lib/git.mjs';
import { readManifest, writeManifest } from '../lib/manifest.mjs';
import { nowIsoShanghai } from '../lib/time.mjs';
import { logStart, logResult, isProgressBar } from '../lib/updateLog.mjs';

/**
 * 更新单个仓库：git fetch + git pull --ff-only + 回写 manifest
 * 不强推，遇非快进/网络失败返回 ok=false + 详细 message
 */
export async function updateOne(repo, idx, total) {
  const absPath = join(reposRoot(), repo.path);
  const before = git(absPath, ['rev-parse', '--short', 'HEAD']);

  logStart(idx, total, repo, before);

  // 1. fetch（流式，长过程）
  const fetchRes = await gitStream(
    absPath,
    ['fetch', 'origin', '--progress'],
    (line, stream) => {
      // 静默进度条，错误透出
      if (isProgressBar(line)) return;
      console.log(`  [${repo.name}/fetch] ${line}`);
    },
    { label: repo.name, timeoutMs: 3 * 60_000 }
  );
  if (!fetchRes.ok) {
    const msg =
      fetchRes.exitReason === 'timeout'
        ? `fetch timeout (3min)`
        : `fetch failed (exit ${fetchRes.code})`;
    const r = {
      repo, ok: false, before, after: before, changed: false, message: msg,
    };
    logResult(idx, total, r);
    return r;
  }

  // 2. pull --ff-only（短命令，可批式）
  const pullRes = await gitStream(
    absPath,
    ['pull', '--ff-only'],
    (line) => {
      // pull 短，几乎无输出；透出 stderr
      console.log(`  [${repo.name}/pull] ${line}`);
    },
    { label: repo.name, timeoutMs: 60_000 }
  );
  if (!pullRes.ok) {
    const msg =
      pullRes.exitReason === 'timeout'
        ? `pull timeout (1min)`
        : `pull --ff-only failed (exit ${pullRes.code})`;
    const r = {
      repo, ok: false, before, after: before, changed: false, message: msg,
    };
    logResult(idx, total, r);
    return r;
  }

  // 3. 读取新状态
  const after = git(absPath, ['rev-parse', '--short', 'HEAD']);
  const shaFull = git(absPath, ['rev-parse', 'HEAD']);
  const commitDate = git(absPath, ['log', '-1', '--format=%cI', 'HEAD']);
  const changed = before !== after;

  // 4. 回写 manifest
  repo.current_commit = shaFull;
  repo.current_commit_short = after;
  repo.current_commit_date = commitDate;
  repo.last_pull_at = nowIsoShanghai();

  const r = {
    repo, ok: true, before, after, changed,
    message: changed ? `updated ${before} -> ${after}` : 'already up to date',
  };
  logResult(idx, total, r);
  return r;
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'update <repo>',
  summary: '更新单个仓库（full_name，如 bytedance/deer-flow）',
  booleans: [],
  strings: [],
  positionals: 1,
  async run(flags, positionals) {
    const repo = positionals[0];
    const manifest = readManifest();
    const idx = manifest.repos.findIndex(
      (r) => r.full_name === repo || r.path.endsWith(repo) || r.name === repo
    );
    if (idx === -1) {
      console.log(`NOT FOUND: ${repo}（按 full_name / path / name 匹配均无）`);
      return;
    }
    await updateOne(manifest.repos[idx], idx + 1, manifest.repos.length);
    // updateOne 已自带阶段日志（start/fetch/pull/done），单仓不再额外汇总
    writeManifest(manifest);
  },
};
