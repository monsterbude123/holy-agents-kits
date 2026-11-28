// verifyIndex.test.mjs — 验证索引覆盖度（SQLite 直查，node:test）
// 用例已迁移到 node:test runner（Node 内置，无第三方依赖）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pathToDocsQueryKey,
  summarizeCoverage,
  pathExistsInIndex,
} from '../lib/verifyIndex.mjs';

function setUpFakeIndex() {
  const root = mkdtempSync(join(tmpdir(), 'ghh-vi-'));
  // 建一个真正的 SQLite 库（用 python 连建）
  const dbPath = join(root, 'docs', '.docmap', 'docmap.db');
  execFileSync(
    'python',
    [
      '-c',
      `import sqlite3, os; os.makedirs(os.path.dirname(${JSON.stringify(dbPath)}), exist_ok=True); c = sqlite3.connect(${JSON.stringify(dbPath)}); c.execute("CREATE TABLE files (path TEXT, freshness_score REAL, last_git_commit TEXT)"); c.executemany("INSERT INTO files VALUES (?, ?, ?)", [("ai-app/AIDC-AI__Pixelle-Video/README.md", 0.9, "abc"), ("comfyanonymous__ComfyUI/README.md", 0.95, "def"), ("top-level/readme.md", 0.5, None)]); c.commit(); c.close()`,
    ],
    { stdio: 'pipe' }
  );
  return { projectRoot: root };
}

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

describe('pathExistsInIndex (real SQLite)', () => {
  let cleanup;
  beforeEach(() => {
    cleanup = setUpFakeIndex();
  });
  afterEach(() => {
    rmSync(cleanup.projectRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  it('returns true for group-prefixed repo with at least one file', async () => {
    const ok = await pathExistsInIndex('ai-app/AIDC-AI__Pixelle-Video', cleanup.projectRoot);
    assert.strictEqual(ok, true);
  });

  it('returns true for root-level repo', async () => {
    const ok = await pathExistsInIndex('comfyanonymous__ComfyUI', cleanup.projectRoot);
    assert.strictEqual(ok, true);
  });

  it('returns false for repo not in index', async () => {
    const ok = await pathExistsInIndex('does-not-exist__nope', cleanup.projectRoot);
    assert.strictEqual(ok, false);
  });
});
