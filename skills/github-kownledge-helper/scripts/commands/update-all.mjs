// update-all.mjs — 批量更新（顺序拉取，禁止并发）
// 一次性回写 manifest；每仓结果即时输出（见 lib/updateLog.mjs）

import { readManifest, writeManifest } from '../lib/manifest.mjs';
import { nowIsoShanghai } from '../lib/time.mjs';
import { updateOne } from './update.mjs';

/**
 * 批量更新：顺序拉取（禁止并发），一次性回写 manifest。
 */
export async function updateAll() {
  const manifest = readManifest();
  const results = [];
  const total = manifest.repos.length;
  const startTs = Date.now();

  console.log(
    `=== update-all: ${total} repos, starting at ${nowIsoShanghai()} ===`
  );

  for (let i = 0; i < manifest.repos.length; i++) {
    const repo = manifest.repos[i];
    const r = await updateOne(repo, i + 1, total);
    results.push(r);

    // 阶段性进度（每 10 仓打一次 + 总耗时）
    if ((i + 1) % 10 === 0 || i === manifest.repos.length - 1) {
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      const okCount = results.filter((x) => x.ok).length;
      const changedCount = results.filter((x) => x.changed).length;
      const failCount = results.filter((x) => !x.ok).length;
      console.log(
        `--- progress: ${i + 1}/${total} done, ${elapsed}s elapsed (ok=${okCount} changed=${changedCount} fail=${failCount}) ---`
      );
    }
  }

  writeManifest(manifest);

  const totalTime = ((Date.now() - startTs) / 1000).toFixed(1);
  const okCount = results.filter((x) => x.ok).length;
  const changedCount = results.filter((x) => x.changed).length;
  const failCount = results.filter((x) => !x.ok).length;
  console.log(
    `=== UPDATE DONE: ${okCount} ok (${changedCount} changed), ${failCount} failed, ${totalTime}s ===`
  );
  return results;
}

/** 批量结果汇总表 */
function printResults(results) {
  let ok = 0;
  let changed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok && r.changed) {
      changed++;
      ok++;
      console.log(`✓ ${r.repo.full_name.padEnd(50)} ${r.before} -> ${r.after}`);
    } else if (r.ok) {
      ok++;
      console.log(`- ${r.repo.full_name.padEnd(50)} up to date (${r.after})`);
    } else {
      failed++;
      console.log(`✗ ${r.repo.full_name.padEnd(50)} ${r.message}`);
    }
  }
  console.log(
    `=== UPDATE DONE: ${ok} ok (${changed} changed), ${failed} failed ===`
  );
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'update-all',
  summary: '一键更新全部仓库（ff-only，顺序拉取）',
  booleans: [],
  strings: [],
  positionals: 0,
  async run() {
    const results = await updateAll();
    printResults(results);
  },
};
