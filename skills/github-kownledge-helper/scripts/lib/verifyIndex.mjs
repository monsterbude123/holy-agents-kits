// verifyIndex.mjs — 验证索引覆盖度（SQLite 直查）
// 替代 query-index.py --grab 模糊匹配，直接查 docs/.docmap/docmap.db 的 files.path
// 解决聚合目录（ai-app / ai-prompt / ai-skills-sets）的 false missing

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { querySqliteFull } from './docmapSqlite.mjs';

/**
 * @typedef {Object} IndexEntry
 * @property {string} repoKey 含 group 前缀（如 'ai-app/AIDC-AI__Pixelle-Video'）或顶层
 * @property {number} freshnessScore 0~1
 * @property {string} lastCommit
 */

/** 去掉 'docs/' 前缀：'docs/ai-app/X' → 'ai-app/X' */
export function pathToDocsQueryKey(docsPath) {
  return docsPath.replace(/^docs\//, '');
}

/** freshness 档位（与 doc-map-manager 阈值一致） */
function freshnessBucket(score) {
  if (score >= 0.7) return 'green';
  if (score >= 0.3) return 'yellow';
  return 'red';
}

/** 把 manifest repo 列表和 indexed 列表做覆盖度比对 */
export function summarizeCoverage(manifestKeys, indexed) {
  const indexedByKey = new Map();
  for (const e of indexed) {
    indexedByKey.set(e.repoKey, e);
  }

  let green = 0;
  let yellow = 0;
  let red = 0;
  const missing = [];

  for (const k of manifestKeys) {
    const e = indexedByKey.get(k);
    if (!e) {
      missing.push(k);
      continue;
    }
    const b = freshnessBucket(e.freshnessScore);
    if (b === 'green') green++;
    else if (b === 'yellow') yellow++;
    else red++;
  }

  return { total: manifestKeys.length, green, yellow, red, missing };
}

/** 一次性拉所有 indexed entries 做汇总（不走 query-index.py） */
export async function loadIndexEntries(projectRoot) {
  const dbPath = join(projectRoot, 'docs', '.docmap', 'docmap.db');
  if (!existsSync(dbPath)) return [];
  const stdout = await querySqliteFull(dbPath);
  try {
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}
