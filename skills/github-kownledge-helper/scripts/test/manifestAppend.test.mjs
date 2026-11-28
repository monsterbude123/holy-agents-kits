// manifestAppend.test.mjs — manifest 追加 / 去重 / 原子写
// 已迁移到 node:test runner（node:assert/strict）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, findByFullName } from '../lib/manifest.mjs';

function makeEntry(over = {}) {
  return {
    name: 'r',
    owner: 'o',
    full_name: 'o/r',
    url: 'https://github.com/o/r.git',
    path: 'repos/o__r',
    docs_path: 'docs/o__r',
    group: '',
    default_branch: 'main',
    added_at: '2026-08-13T12:00:00+08:00',
    last_pull_at: '2026-08-13T12:00:00+08:00',
    current_commit: 'a'.repeat(40),
    current_commit_short: 'aaaaaaa',
    current_commit_date: '2026-08-13T04:00:00+00:00',
    tags: [],
    notes: '',
    ...over,
  };
}

function emptyManifest() {
  return {
    version: '1.1',
    updated_at: '2026-08-13T12:00:00+08:00',
    repo_count: 0,
    repos: [],
  };
}

describe('manifest appendEntry', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ghh-mf-'));
    // 用 monkey-patch 不可行：库内部用 MANIFEST_PATH 常量
    // 改用直接写空 manifest 到 manifestPath
    // 但库从 process.cwd() 推算项目根 → 走测试运行器 cwd → MANIFEST_PATH 错
    // 解决：把 manifest.json copy 到当前 cwd，但会污染
    // 更稳：appendEntry 接受可选 manifestPath 参数；测试时显式传入
    // 这里先依赖库当前实现 → 测试要看库怎么定位
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends a new entry and bumps repo_count + updated_at', () => {
    // 用一个 stub manifest 函数，直接验证逻辑
    // 因为库实现还没出来，本测试用预期的 appendEntry(path, entry) 签名
    const m = emptyManifest();
    const e = makeEntry();
    const out = appendEntry(m, e, '2026-08-13T12:30:00+08:00');
    assert.strictEqual(out.repos.length, 1);
    assert.deepStrictEqual(out.repos[0], e);
    assert.strictEqual(out.repo_count, 1);
    assert.strictEqual(out.updated_at, '2026-08-13T12:30:00+08:00');
  });

  it('throws on duplicate full_name', () => {
    const m = emptyManifest();
    m.repos.push(makeEntry({ name: 'r' }));
    const dup = makeEntry({ name: 'r' });
    assert.throws(
      () => appendEntry(m, dup, '2026-08-13T12:30:00+08:00'),
      /duplicate|exists/i
    );
  });

  it('findByFullName returns entry or null', () => {
    const m = emptyManifest();
    const e = makeEntry({ full_name: 'foo/bar' });
    m.repos.push(e);
    assert.deepStrictEqual(findByFullName(m, 'foo/bar'), e);
    assert.strictEqual(findByFullName(m, 'x/y'), null);
  });
});
