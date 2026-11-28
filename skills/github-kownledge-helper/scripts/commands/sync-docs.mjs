// sync-docs.mjs — 按 manifest 同步顶层文档到 docs/
// 白名单：仅主版本文档，排除多语言变体避免索引污染

import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from '../lib/paths.mjs';
import { readManifest } from '../lib/manifest.mjs';

// 文档白名单（精确匹配，避免 README.zh.md 等多语言变体污染索引）
const WHITELIST = [
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
  'SECURITY.md',
  'DEVELOPMENT.md',
  'MAINTAINERS.md',
  'GEMINI.md',
  'SOUL.md',
];

/** 执行文档同步。cwd 决定项目根（CLI 默认项目根，测试可传 tmpRoot） */
export function runSyncDocs(cwd = process.cwd()) {
  const root = getProjectRoot(cwd);
  const manifest = readManifest(cwd);
  let copied = 0;
  let skipped = 0;

  for (const repo of manifest.repos) {
    const srcDir = join(root, repo.path);
    const dstDir = join(root, repo.docs_path);

    if (!existsSync(srcDir)) {
      console.log(`MISS-SRC | ${repo.full_name} | ${srcDir}`);
      continue;
    }

    mkdirSync(dstDir, { recursive: true });

    let n = 0;
    for (const fname of WHITELIST) {
      const srcFile = join(srcDir, fname);
      if (existsSync(srcFile)) {
        copyFileSync(srcFile, join(dstDir, fname));
        n++;
        copied++;
      }
    }
    console.log(`SYNC | ${repo.full_name} | ${n} docs -> ${repo.docs_path}`);
    if (n === 0) skipped++;
  }

  console.log(
    `=== DOCS SYNCED: ${copied} files, ${skipped} repos with 0 docs ===`
  );
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage: 'sync-docs',
  summary: '按 manifest 同步顶层文档到 docs/',
  booleans: [],
  strings: [],
  positionals: 0,
  run() {
    runSyncDocs();
  },
};
