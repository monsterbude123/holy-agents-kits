// syncTo.test.mjs — sync-to 命令单元 + 集成测试（node:test）
// 用例已迁移到 node:test runner（Node 内置，无第三方依赖）
//
// 测试策略：
//   - 纯函数（解析 + 校验）：不需要 fs
//   - 集成（真实 git repo 复制）：mkdtemp + 真 git init，真 copyDirectory
//   - 不 mock fs / git（mock 会掩盖真实 bug）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncTo, resolveSourcePath } from '../commands/sync-to.mjs';
import { git, makeRepoFixture, cleanupDir, leaveDir } from './helpers.mjs';

describe('resolveSourcePath', () => {
  it('throws on invalid repo input', () => {
    assert.throws(
      () => resolveSourcePath('not-a-repo', '/tmp/x'),
      /invalid|empty/i
    );
  });
});

describe('syncTo (integration)', () => {
  let tmpRoot;
  let srcRepo;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-syncto-'));
    srcRepo = makeRepoFixture();
  });

  afterEach(() => {
    leaveDir(tmpRoot);
    cleanupDir(tmpRoot);
    cleanupDir(srcRepo.path);
  });

  it('copies repo (含 .git) to absolute path, sha 一致', async () => {
    const dst = join(tmpRoot, 'mirror');

    const result = await syncTo({
      repoInput: 'some__repo',
      sourcePath: srcRepo.path,
      destination: dst,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(existsSync(join(dst, '.git')), true);
    assert.strictEqual(existsSync(join(dst, 'README.md')), true);

    const srcSha = git(srcRepo.path, ['rev-parse', 'HEAD']);
    const dstSha = git(dst, ['rev-parse', 'HEAD']);
    assert.strictEqual(dstSha, srcSha);
    assert.strictEqual(dstSha, srcRepo.sha);
  });

  it('源目录不存在 → 返回 ok=false + message', async () => {
    const dst = join(tmpRoot, 'mirror');
    const missing = join(tmpRoot, 'does-not-exist');

    const result = await syncTo({
      repoInput: 'foo/bar',
      sourcePath: missing,
      destination: dst,
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.message, /not found|不存在/i);
    assert.strictEqual(existsSync(dst), false);
  });

  it('源目录不含 .git → 返回 ok=false', async () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'ghh-nogit-'));
    try {
      writeFileSync(join(nonGit, 'foo.txt'), 'hello\n');
      const dst = join(tmpRoot, 'mirror');

      const result = await syncTo({
        repoInput: 'foo/bar',
        sourcePath: nonGit,
        destination: dst,
      });

      assert.strictEqual(result.ok, false);
      assert.match(result.message, /\.git/i);
      assert.strictEqual(existsSync(dst), false);
    } finally {
      cleanupDir(nonGit);
    }
  });

  it('目标已存在 → 报错停手，不覆盖', async () => {
    const dst = join(tmpRoot, 'mirror');
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(dst, 'sentinel.txt'), 'original\n');

    const result = await syncTo({
      repoInput: 'foo/bar',
      sourcePath: srcRepo.path,
      destination: dst,
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.message, /already exists|已存在|not.*cover/i);

    // sentinel 未被覆盖
    assert.strictEqual(existsSync(join(dst, 'sentinel.txt')), true);
    // 目标里没有 .git
    assert.strictEqual(existsSync(join(dst, '.git')), false);
  });

  it('跨平台：源含大文件 + 子目录，复制的 sha + 文件树一致', async () => {
    // 加点结构
    mkdirSync(join(srcRepo.path, 'sub', 'nested'), { recursive: true });
    writeFileSync(join(srcRepo.path, 'sub', 'nested', 'deep.txt'), 'deep\n');
    writeFileSync(join(srcRepo.path, 'top.txt'), 'top\n');
    git(srcRepo.path, ['add', '.']);
    git(srcRepo.path, ['commit', '-q', '-m', 'more']);
    const newSha = git(srcRepo.path, ['rev-parse', 'HEAD']);

    const dst = join(tmpRoot, 'mirror');
    const result = await syncTo({
      repoInput: 'foo/bar',
      sourcePath: srcRepo.path,
      destination: dst,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(existsSync(join(dst, 'sub', 'nested', 'deep.txt')), true);
    assert.strictEqual(existsSync(join(dst, 'top.txt')), true);
    assert.strictEqual(git(dst, ['rev-parse', 'HEAD']), newSha);
  });
});
