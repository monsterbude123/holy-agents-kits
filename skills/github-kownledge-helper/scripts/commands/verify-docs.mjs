// verify-docs.mjs — 验证 doc map 索引状态
// 改用 SQLite 直查 files.path（替代 query-index.py --grab 模糊匹配）
// 解决聚合目录（ai-app / ai-prompt / ai-skills-sets）的 false missing

import { getProjectRoot } from '../lib/paths.mjs';
import { readManifest } from '../lib/manifest.mjs';
import {
  pathToDocsQueryKey,
  summarizeCoverage,
  loadIndexEntries,
} from '../lib/verifyIndex.mjs';

export async function runVerifyDocs(cwd = process.cwd()) {
  const root = getProjectRoot(cwd);
  const manifest = readManifest(cwd);
  const repoKeys = manifest.repos.map((r) => pathToDocsQueryKey(r.docs_path));
  const indexed = await loadIndexEntries(root);
  const summary = summarizeCoverage(repoKeys, indexed);

  console.log(
    '=== verify-docs: total=' +
      summary.total +
      ' \u{1F7E2}' +
      summary.green +
      ' \u{1F7E1}' +
      summary.yellow +
      ' \u{1F534}' +
      summary.red +
      ' (root=' +
      root +
      ') ==='
  );
  if (summary.missing.length) {
    console.log('MISSING (' + summary.missing.length + '):');
    for (const m of summary.missing) console.log('  - ' + m);
  }
  return {
    ok: summary.missing.length === 0 && summary.red === 0,
    total: summary.total,
    green: summary.green,
    yellow: summary.yellow,
    red: summary.red,
    missing: summary.missing,
  };
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'verify-docs',
  summary:
    '验证 doc manager 索引状态（每个收录仓 query 一次，汇总 🟢/🟡/🔴/missing）',
  booleans: [],
  strings: [],
  positionals: 0,
  async run() {
    const r = await runVerifyDocs();
    if (!r.ok) process.exit(1);
  },
};
