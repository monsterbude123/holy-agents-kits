// add.e2e.test.mjs — add 命令端到端测试（node:test）
// 用本地 fixture 仓库（fake remote via file://）+ tmp 项目目录，验证 add 完整流程
// 用例已迁移到 node:test runner（Node 内置，无第三方依赖）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRepo } from '../commands/add.mjs';
import { makeBareRemote, cleanupDir, leaveDir } from './helpers.mjs';

describe('addRepo (e2e)', () => {
  let tmpRoot;
  let remote;

  beforeEach(() => {
    // 模拟一个最小项目根
    tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-proj-'));
    mkdirSync(join(tmpRoot, 'repos'), { recursive: true });
    mkdirSync(join(tmpRoot, 'docs'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'manifest.json'),
      JSON.stringify(
        {
          version: '1.1',
          updated_at: '2026-08-13T12:00:00+08:00',
          repo_count: 0,
          repos: [],
        },
        null,
        2
      )
    );
    remote = makeBareRemote();
  });

  afterEach(() => {
    // Windows 上 git 可能短暂持有 .git/ 内部文件句柄 → 先 chdir 离开再删
    leaveDir(tmpRoot);
    cleanupDir(tmpRoot);
    cleanupDir(remote.path);
  });

  it('clones a new repo, syncs docs, appends to manifest', async () => {
    // 切换 cwd 到 tmpRoot，让 paths.mjs 反推的项目根是 tmpRoot
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      const result = await addRepo({
        owner: 'o',
        repo: 'fixture',
        cloneUrl: `file://${remote.path}`,
        skipBuildIndex: true,
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.fullName, 'o/fixture');

      // 1. 仓库已 clone
      const repoPath = join(tmpRoot, 'repos/o__fixture');
      assert.strictEqual(existsSync(join(repoPath, '.git')), true);
      assert.ok(
        readFileSync(join(repoPath, 'README.md'), 'utf-8').includes('# fixture'),
        'expected cloned README.md to contain "# fixture"'
      );

      // 2. 文档已同步
      const docsPath = join(tmpRoot, 'docs/o__fixture');
      assert.strictEqual(existsSync(join(docsPath, 'README.md')), true);

      // 3. manifest 已追加
      const m = JSON.parse(readFileSync(join(tmpRoot, 'manifest.json'), 'utf-8'));
      assert.strictEqual(m.repo_count, 1);
      assert.strictEqual(m.repos[0]?.full_name, 'o/fixture');
      assert.strictEqual(m.repos[0]?.current_commit, remote.sha);
    } finally {
      process.chdir(cwd);
    }
  });

  it('refuses to add a duplicate full_name', async () => {
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      // 第一次添加
      const first = await addRepo({
        owner: 'o',
        repo: 'fixture',
        cloneUrl: `file://${remote.path}`,
        skipBuildIndex: true,
      });
      assert.strictEqual(first.ok, true);

      // 第二次同名
      const result = await addRepo({
        owner: 'o',
        repo: 'fixture',
        cloneUrl: `file://${remote.path}`,
        skipBuildIndex: true,
      });
      assert.strictEqual(result.ok, false);
      assert.match(result.message, /duplicate|exists/i);
    } finally {
      process.chdir(cwd);
    }
  });

  it('does a full clone by default (not --depth 1)', async () => {
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await addRepo({
        owner: 'o',
        repo: 'fixture',
        cloneUrl: `file://${remote.path}`,
        skipBuildIndex: true,
      });
      const repoPath = join(tmpRoot, 'repos/o__fixture');
      // 完整克隆 → .git/shallow 不存在
      const shallowFile = join(repoPath, '.git', 'shallow');
      assert.strictEqual(existsSync(shallowFile), false);
    } finally {
      process.chdir(cwd);
    }
  });
});
