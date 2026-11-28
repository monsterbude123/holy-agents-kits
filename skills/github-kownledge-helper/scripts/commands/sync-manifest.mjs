// sync-manifest.mjs — 扫描 repos/ 重建 manifest.json（merge 模式）
// 规则（与 references/rules.md §3 一致）：
//   - 保留旧 entry 的 added_at / last_pull_at / tags / notes / group
//   - 用 fresh 的 git 派生字段（branch / commit / commit_date / url）
//   - commit changed → last_pull_at 拨到 now
//   - commit unchanged → last_pull_at 保留
//   - 按 path 稳定排序，最小化 diff
//   - --dry-run：只打印概要不写
//   - --rebuild：丢弃旧元数据（仅灾难恢复使用）

import { join } from 'node:path';
import { reposRoot } from '../lib/paths.mjs';
import {
  readManifest,
  writeManifest,
  mergeEntry,
  sortReposByPath,
} from '../lib/manifest.mjs';
import { nowIsoShanghai } from '../lib/time.mjs';
import { scanRepos, buildEntry, detectDrift } from '../lib/repoScan.mjs';

/**
 * 主入口：扫 repos/ → merge 旧 manifest → 写回。
 * cwd：决定项目根。
 * options.dryRun：不写盘，只打印概要
 * options.rebuild：丢弃旧元数据（tags / notes / last_pull_at / added_at）
 */
export function runSyncManifest(cwd = process.cwd(), options = {}) {
  const old = readManifest(cwd);
  const now = nowIsoShanghai();
  const scanned = scanRepos();

  const freshEntries = [];
  for (const s of scanned) {
    const abs = join(reposRoot(), s.group, s.owner + '__' + s.repo);
    const e = buildEntry(abs, { owner: s.owner, repo: s.repo, group: s.group, now });
    if (e) freshEntries.push(e);
  }

  // Drift 检测
  const drifts = detectDrift(old, freshEntries);

  // Merge
  const merged = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const fresh of freshEntries) {
    const oldE = old.repos.find((r) => r.full_name === fresh.full_name);
    if (!oldE) {
      // 新增：用 fresh（含 now as added_at / last_pull_at）
      merged.push(fresh);
      added++;
    } else if (options.rebuild) {
      // 强制 rebuild 旧 entry
      merged.push(fresh);
      if (oldE.current_commit !== fresh.current_commit) updated++;
      else unchanged++;
    } else {
      const m = mergeEntry(oldE, fresh, now);
      merged.push(m);
      if (oldE.current_commit !== fresh.current_commit) updated++;
      else unchanged++;
    }
  }

  // 检测被移除的
  const removed = old.repos.filter(
    (r) => !freshEntries.find((e) => e.full_name === r.full_name)
  );

  // 排序
  const sorted = sortReposByPath(merged);

  const result = {
    total: sorted.length,
    added,
    updated,
    unchanged,
    removed: removed.length,
    drifts: drifts.map((d) => d.name + ': manifest=' + d.manifest + ' git=' + d.head),
  };

  // 打印
  console.log('=== sync-manifest ===');
  console.log('total:    ' + sorted.length);
  console.log('added:    ' + added);
  console.log('updated:  ' + updated);
  console.log('unchanged:' + unchanged);
  console.log('removed:  ' + removed.length);
  if (drifts.length > 0) {
    console.log('drift:');
    for (const d of drifts) {
      console.log('  [drift] ' + d.name + ' manifest=' + d.manifest + ' git=' + d.head);
    }
  }

  if (options.dryRun) {
    console.log('(dry-run, not written)');
    return result;
  }

  const manifest = {
    version: '1.1',
    updated_at: now,
    repo_count: sorted.length,
    repos: sorted,
  };
  writeManifest(manifest, cwd);
  console.log('manifest.json written: ' + sorted.length + ' repos');
  return result;
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'sync-manifest [--dry-run] [--rebuild]',
  summary:
    '扫描 repos/ 重建 manifest.json（merge 模式：保留 added_at/last_pull_at/tags/notes）',
  booleans: ['--dry-run', '--rebuild'],
  strings: [],
  positionals: 0,
  run(flags) {
    runSyncManifest(process.cwd(), {
      dryRun: flags['dry-run'],
      rebuild: flags.rebuild,
    });
  },
};
