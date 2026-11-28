// verifyIndex.test.mjs — 验证索引覆盖度（node:test）
// 用例已迁移到 node:test runner（Node 内置，无第三方依赖）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pathToDocsQueryKey,
  summarizeCoverage,
} from '../lib/verifyIndex.mjs';

describe('pathToDocsQueryKey', () => {
  it('strips docs/ prefix', () => {
    assert.strictEqual(
      pathToDocsQueryKey('docs/comfyanonymous__ComfyUI'),
      'comfyanonymous__ComfyUI'
    );
  });

  it('keeps group prefix', () => {
    assert.strictEqual(
      pathToDocsQueryKey('docs/ai-app/AIDC-AI__Pixelle-Video'),
      'ai-app/AIDC-AI__Pixelle-Video'
    );
  });

  it('returns input unchanged if no docs/ prefix', () => {
    assert.strictEqual(
      pathToDocsQueryKey('already/clean/path'),
      'already/clean/path'
    );
  });
});

describe('summarizeCoverage', () => {
  it('reports manifest repo as missing when no match in index', () => {
    const manifestKeys = ['comfyanonymous__ComfyUI'];
    const indexed = [
      { repoKey: 'comfyanonymous__ComfyUI', freshnessScore: 0.95, lastCommit: 'def' },
    ];
    const s = summarizeCoverage(manifestKeys, indexed);
    assert.strictEqual(s.total, 1);
    assert.strictEqual(s.green, 1);
    assert.deepStrictEqual(s.missing, []);
  });

  it('flags missing for group-prefixed repo when present in index', () => {
    const manifestKeys = ['ai-app/AIDC-AI__Pixelle-Video'];
    const indexed = [
      { repoKey: 'ai-app/AIDC-AI__Pixelle-Video', freshnessScore: 0.9, lastCommit: 'abc' },
    ];
    const s = summarizeCoverage(manifestKeys, indexed);
    assert.deepStrictEqual(s.missing, []);
  });

  it('reports missing when manifest key not in indexed', () => {
    const manifestKeys = ['does-not-exist__nope'];
    const indexed = [];
    const s = summarizeCoverage(manifestKeys, indexed);
    assert.deepStrictEqual(s.missing, ['does-not-exist__nope']);
  });

  it('splits freshness by score threshold', () => {
    const manifestKeys = ['a', 'b', 'c'];
    const indexed = [
      { repoKey: 'a', freshnessScore: 0.9, lastCommit: '' },
      { repoKey: 'b', freshnessScore: 0.5, lastCommit: '' },
      { repoKey: 'c', freshnessScore: 0.1, lastCommit: '' },
    ];
    const s = summarizeCoverage(manifestKeys, indexed);
    assert.strictEqual(s.green, 1);
    assert.strictEqual(s.yellow, 1);
    assert.strictEqual(s.red, 1);
  });
});
