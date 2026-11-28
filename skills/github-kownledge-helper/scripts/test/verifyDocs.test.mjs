// verifyDocs.test.mjs — 验证 doc manager 索引状态（node:test）
// 用例已迁移到 node:test runner（Node 内置，无第三方依赖）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryIndexOutput } from '../lib/verifyDocs.mjs';

describe('parseQueryIndexOutput', () => {
  it('extracts hits from successful grab output', () => {
    // query-index.py --grab 真实输出片段
    // 注：path 段是 `owner__repo/file`（双下划线，非斜杠）—— 这是 docs/ 镜像目录结构
    const stdout = `
============================================================
  🟢 新鲜度: 1.00
  ## comfyanonymous__ComfyUI/README.md L3-L44 (score: 0.74)

  L3      > # ComfyUI
  L4      > The most powerful...
============================================================
  🟡 新鲜度: 0.55
  ## some__other_repo/AGENTS.md (score: 0.30)
`;
    const hits = parseQueryIndexOutput(stdout);
    assert.strictEqual(hits.length, 2);
    assert.strictEqual(hits[0]?.repo, 'comfyanonymous__ComfyUI');
    assert.strictEqual(hits[0]?.file, 'README.md');
    assert.strictEqual(hits[0]?.freshness, 'green');
    assert.strictEqual(hits[0]?.freshnessScore, 1.0);
    assert.strictEqual(hits[0]?.score, 0.74);
    assert.strictEqual(hits[1]?.repo, 'some__other_repo');
    assert.strictEqual(hits[1]?.freshness, 'yellow');
    assert.strictEqual(hits[1]?.freshnessScore, 0.55);
  });

  it('returns empty array on no match', () => {
    const stdout = 'No results found.\n';
    assert.deepStrictEqual(parseQueryIndexOutput(stdout), []);
  });

  it('handles 🔴 red freshness', () => {
    const stdout = `  🔴 新鲜度: 0.20\n  ## old__repo/README.md (score: 0.50)\n`;
    const hits = parseQueryIndexOutput(stdout);
    assert.strictEqual(hits[0]?.freshness, 'red');
    assert.ok(
      Math.abs((hits[0]?.freshnessScore ?? NaN) - 0.2) < 1e-9,
      `expected freshnessScore ≈ 0.2, got ${hits[0]?.freshnessScore}`
    );
  });
});
