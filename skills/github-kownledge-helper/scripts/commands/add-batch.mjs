// add-batch.mjs — 批量收录（顺序 + 断点续跑 + 汇总）
//
// 存在的理由：逐个手动跑 add，遇到大仓/慢速网络就得反复重跑，
// 且中途失败后无法从断点继续。这里把一批仓排成一条流水线：
//   · 顺序执行（rules.md §4.3：禁止并发打满网络）
//   · 已收录的跳过 → 天然断点续跑
//   · 单仓失败不中断整批
//   · 全部处理完收口 manifest（唯一事实源）+ docs 同步
//
// 用法：node scripts/cli.mjs add-batch <repo1> <repo2> ...

import { readManifest, findByFullName } from '../lib/manifest.mjs';
import { addRepo } from './add.mjs';
import { runSyncDocs } from './sync-docs.mjs';
import { parseRepoInput } from '../lib/parseRepoInput.mjs';
import { DEFAULT_CLONE_TIMEOUT_MS } from '../lib/cloneStrategy.mjs';

/**
 * 批量收录的核心逻辑（与 CLI 解耦，便于测试）。
 *
 * @param {object} opts
 * @param {string[]} opts.repos            仓库列表（owner/repo 或 URL）
 * @param {string}   opts.cwd              项目根
 * @param {(full: string) => Promise<{ok: boolean, message?: string}>} [opts.addOne]
 *        实际收录单个仓的函数（注入以便测试）
 * @param {(full: string) => boolean} [opts.isAlreadyCollected]
 *        判断是否已收录（注入以便测试）
 * @param {() => Promise<void>} [opts.finalize]
 *        收口动作（sync-manifest + sync-docs）
 * @returns {Promise<{total: number, okCount: number, failCount: number, skippedCount: number, results: Array}>}
 */
export async function runAddBatch(opts) {
  const {
    repos,
    cwd,
    // 默认实现必须惰性求值：解构期直接调 defaultFinalize(cwd) 会真的跑同步，
    // 测试注入不了 mock，也会让「空列表」这种无害调用产生副作用。
    addOne = (full, o) => defaultAddOne(full, o),
    isAlreadyCollected = (full) => defaultIsAlreadyCollected(cwd)(full),
    finalize = () => defaultFinalize(cwd),
    group,
    skipBuildIndex = true,
    shallowFirst = false,
    cloneTimeoutMs,
  } = opts;

  // 去重但保序
  const unique = [];
  const seen = new Set();
  for (const r of repos) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    unique.push(r);
  }

  const results = [];
  let okCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const full of unique) {
    if (isAlreadyCollected(full)) {
      skippedCount++;
      results.push({ repo: full, status: 'skipped', message: '已收录，跳过' });
      continue;
    }
    try {
      const res = await addOne(full, { group, skipBuildIndex, shallowFirst, cloneTimeoutMs });
      if (res?.ok) {
        okCount++;
        results.push({ repo: full, status: 'ok', message: res.message ?? '' });
      } else {
        failCount++;
        results.push({ repo: full, status: 'error', message: res?.message ?? '未知错误' });
      }
    } catch (e) {
      // 单仓失败不中断整批
      failCount++;
      results.push({ repo: full, status: 'error', message: e?.message ?? String(e) });
    }
  }

  // 收口：manifest 是唯一事实源
  let finalizeError = null;
  try {
    await finalize();
  } catch (e) {
    finalizeError = `收口失败：${e?.message ?? e}`;
    results.push({ repo: '(finalize)', status: 'error', message: finalizeError });
  }

  return { total: unique.length, okCount, failCount, skippedCount, results };
}

/** 默认：按 manifest 判断是否已收录 */
function defaultIsAlreadyCollected(cwd) {
  const manifest = readManifest(cwd);
  return (full) => {
    const parsed = parseRepoInput(full);
    const name = `${parsed.owner}/${parsed.repo}`;
    return !!findByFullName(manifest, name);
  };
}

/** 默认：调用 addRepo */
async function defaultAddOne(full, { group, skipBuildIndex, shallowFirst, cloneTimeoutMs }) {
  const parsed = parseRepoInput(full);
  return addRepo({
    owner: parsed.owner,
    repo: parsed.repo,
    cloneUrl: /^https?:\/\//.test(full) ? (full.endsWith('.git') ? full : full + '.git') : undefined,
    group,
    skipBuildIndex,
    shallowFirst,
    cloneTimeoutMs: cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
  });
}

/** 默认收口：docs 同步（manifest 已由 addRepo 增量写入） */
async function defaultFinalize(cwd) {
  runSyncDocs(cwd);
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'add-batch <repo...> [--group <group>] [--shallow] [--timeout <minutes>]',
  summary: '批量收录仓库（顺序执行、失败降级浅克隆、已收录自动跳过，支持断点续跑）',
  booleans: ['--shallow'],
  strings: ['--group', '--timeout'],
  positionals: 1,
  async run(flags, positionals) {
    const timeoutMin = flags.timeout ? Number(flags.timeout) : undefined;
    if (timeoutMin !== undefined && (!Number.isFinite(timeoutMin) || timeoutMin <= 0)) {
      return { ok: false, message: `--timeout 需要正数分钟，收到：${flags.timeout}` };
    }
    const report = await runAddBatch({
      repos: positionals,
      cwd: process.cwd(),
      group: flags.group,
      shallowFirst: flags.shallow === true,
      cloneTimeoutMs: timeoutMin ? timeoutMin * 60_000 : undefined,
    });

    console.log('');
    for (const r of report.results) {
      const mark = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
      console.log(`${mark} ${r.repo} — ${r.message}`);
    }
    console.log('');
    console.log(
      `批量收录完成：共 ${report.total}，成功 ${report.okCount}，跳过 ${report.skippedCount}，失败 ${report.failCount}`
    );
    return { ok: report.failCount === 0, message: '见上方逐仓结果', report };
  },
};
