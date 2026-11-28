// helpers.mjs — 测试夹具（真 git，不 mock fs / git / 子进程）
//
// 共享给多个测试套件，避免每个文件重复 ~30 行 fixture 代码。
// 注意：本文件不匹配 *.test.mjs，不会被 node --test 当作测试文件执行。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** 在指定目录跑一条 git 命令，返回 trim 后的 stdout */
export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/** 最小 git repo fixture（含 1 commit + fake origin） */
export function makeRepoFixture(prefix = 'ghh-src-', message = 'init') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# src\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', message]);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  return { path: dir, sha };
}

/**
 * 构造一个 bare remote fixture（本地 file:// 协议）。
 * 关键：bare repo 默认 HEAD 指向不存在的 ref，clone 时会报
 * "warning: remote HEAD refers to nonexistent ref"，rev-parse HEAD 失败
 * → 在 bare repo 显式设 HEAD 符号链接。
 */
export function makeBareRemote() {
  const dir = mkdtempSync(join(tmpdir(), 'ghh-bare-'));
  execFileSync('git', ['init', '--bare', '-q', dir], { stdio: 'pipe' });
  const seed = mkdtempSync(join(tmpdir(), 'ghh-seed-'));
  git(seed, ['init', '-q', '-b', 'main']);
  git(seed, ['config', 'user.email', 't@t']);
  git(seed, ['config', 'user.name', 't']);
  git(seed, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(seed, 'README.md'), '# fixture\n');
  git(seed, ['add', '.']);
  git(seed, ['commit', '-q', '-m', 'init']);
  git(seed, ['remote', 'add', 'origin', dir]);
  git(seed, ['push', '-q', 'origin', 'main']);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], {
    cwd: dir,
    stdio: 'pipe',
  });
  const sha = git(seed, ['rev-parse', 'HEAD']);
  rmSync(seed, { recursive: true, force: true });
  return { path: dir, sha };
}

/** 假项目根（含 manifest.json，供 env 加载器校验用） */
export function makeFakeRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'ghh-loadenv-'));
  writeFileSync(join(dir, 'manifest.json'), '{"version":"1.0","repos":[]}');
  return dir;
}

/** 递归删除 tmp 目录（抗 Windows EBUSY：maxRetries + retryDelay） */
export function cleanupDir(dir) {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    /* ignore */
  }
}

/** 若 cwd 落在待删目录内，先 chdir 离开（Windows 下 rmSync 会 EBUSY） */
export function leaveDir(dir) {
  const cwd = process.cwd();
  if (cwd === dir || cwd.startsWith(dir + '\\') || cwd.startsWith(dir + '/')) {
    process.chdir(tmpdir());
  }
}
