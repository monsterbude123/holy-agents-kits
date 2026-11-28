// buffer_pipeline.test.mjs — 打包流水线单测（真实 git 临时仓库 fixture，不 mock git/fs）
// mock git 会掩盖真实 bug（--all 丢 refs、verify 上下文、路径空格等），故一律用真 git。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bundleRevArgs, computeFileSha256, listBundleRefs, packBundle, resolveBufferRoot, verifyBundle } from '../buffer_pipeline.mjs';
import { _resetForTest } from '../env.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

/** 真实 git fixture：main 分支 + 第二分支 + tag */
function makeRepo(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  const cfg = ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'];
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'c1']);
  const baseSha = git(dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(dir, 'README.md'), '# fixture v2\n');
  git(dir, [...cfg, 'commit', '-q', '-am', 'c2']);
  git(dir, ['tag', 'v1.0.0']);
  git(dir, ['checkout', '-q', '-b', 'feature/x']);
  writeFileSync(join(dir, 'other.txt'), 'x\n');
  git(dir, ['add', '.']);
  git(dir, [...cfg, 'commit', '-q', '-m', 'c3']);
  git(dir, ['checkout', '-q', 'main']);
  return { path: dir, baseSha, headSha: git(dir, ['rev-parse', 'HEAD']) };
}

/** 定位系统 sha256sum：先 PATH，再从 git 安装目录派生（不硬编码本机绝对路径） */
function locateSha256sum() {
  const direct = spawnSync('sha256sum', ['--version'], { windowsHide: true, shell: false });
  if (!direct.error && direct.status === 0) return 'sha256sum';
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf-8', windowsHide: true, shell: false });
  const exe = (where.stdout || '').split(/\r?\n/).map((s) => s.trim()).find((s) => /git\.exe$/i.test(s));
  if (!exe) return null;
  const candidate = join(dirname(exe), '..', 'usr', 'bin', 'sha256sum.exe');
  return existsSync(candidate) ? candidate : null;
}

const lsOf = (root, suffix = '') => (existsSync(root) ? readdirSync(root) : []).filter((f) => f.endsWith(suffix));

describe('buffer_pipeline（真实 git fixture，不 mock git）', () => {
  let tmpRoot; let repo; let bufferRoot;
  const pack = (opts = {}) => packBundle(repo.path, { bufferRoot, entity: { fullName: 'acme/widget' }, ...opts });

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'gss-'));
    repo = makeRepo(tmpRoot, 'repo');
    bufferRoot = join(tmpRoot, 'buffer');
  });
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

  it('1 · --all 打包含 tag 与多分支（git bundle list-heads 断言）', async () => {
    const res = await pack();
    assert.equal(res.ok, true, res.error);
    const refs = listBundleRefs(repo.path, res.bundlePath).map((r) => r.ref);
    assert.ok(refs.includes('refs/heads/main'), `refs=${refs}`);
    assert.ok(refs.includes('refs/heads/feature/x'), `refs=${refs}`);
    assert.ok(refs.includes('refs/tags/v1.0.0'), `refs=${refs}`);
    assert.ok(refs.includes('HEAD'), `refs=${refs}`);
    assert.deepEqual(bundleRevArgs({}), ['--all']);
  });
  it('2 · SHA-256 与二次读盘 / 系统 sha256sum 一致，且返回字节大小', async () => {
    const res = await pack();
    assert.equal(res.ok, true, res.error);
    const bytes = readFileSync(res.bundlePath);
    assert.equal(res.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(res.sizeBytes, statSync(res.bundlePath).size);
    assert.ok(res.sizeBytes > 0);
    const sys = locateSha256sum();
    if (sys) {
      // GNU sha256sum 对含反斜杠的路径会加 '\' 行首转义标记，故按 64 位 hex 提取
      const out = execFileSync(sys, [res.bundlePath], { encoding: 'utf-8' });
      assert.equal(out.match(/[0-9a-f]{64}/i)?.[0], res.sha256);
    }
    assert.deepEqual(await computeFileSha256(res.bundlePath), { sha256: res.sha256, sizeBytes: res.sizeBytes });
  });
  it('3 · 成功打包：产物原子落缓冲根目录，.staging 无残卷', async () => {
    const res = await pack();
    assert.equal(res.ok, true, res.error);
    assert.equal(res.bundlePath, join(bufferRoot, res.archiveName));
    assert.ok(existsSync(res.bundlePath));
    assert.deepEqual(lsOf(join(bufferRoot, '.staging')), []);
  });
  it('4 · 失败（非 git 目录）：ok=false，.staging 与缓冲根均无残卷', async () => {
    const notRepo = join(tmpRoot, 'not-a-repo');
    mkdirSync(notRepo, { recursive: true });
    const res = await packBundle(notRepo, { bufferRoot, entity: { fullName: 'acme/widget' } });
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'precheck');
    assert.deepEqual(lsOf(join(bufferRoot, '.staging')), []);
    assert.deepEqual(lsOf(bufferRoot, '.bundle'), []);
  });
  it('5 · 失败（发布冲突）：ok=false，.staging 空，原路径未被破坏', async () => {
    const blocker = join(bufferRoot, 'acme__widget-blocked.bundle');
    mkdirSync(blocker, { recursive: true }); writeFileSync(join(blocker, 'keep.txt'), 'keep\n');
    const res = await pack({ entity: { fullName: 'acme/widget', archiveName: 'acme__widget-blocked.bundle' } });
    assert.equal(res.ok, false);
    assert.equal(res.stage, 'publish');
    assert.deepEqual(lsOf(join(bufferRoot, '.staging')), []);
    assert.equal(existsSync(join(blocker, 'keep.txt')), true);
  });
  it('6 · 仓库路径与缓冲根路径都含空格仍能打包', async () => {
    const repo2 = makeRepo(join(tmpRoot, 'my repo'), 'nested repo');
    const root2 = join(tmpRoot, 'buffer root');
    const res = await packBundle(repo2.path, { bufferRoot: root2, entity: { fullName: 'acme/widget' } });
    assert.equal(res.ok, true, res.error);
    assert.ok(existsSync(res.bundlePath));
    assert.deepEqual(lsOf(join(root2, '.staging')), []);
  });
  it('7 · 产物 git bundle verify 独立复核通过', async () => {
    const res = await pack();
    assert.equal(res.ok, true, res.error);
    const out = execFileSync('git', ['bundle', 'verify', res.bundlePath], { cwd: repo.path, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.match(out, /complete history|contains these/i);
    assert.equal(verifyBundle(repo.path, res.bundlePath).ok, true);
  });
  it('8 · 增量：baseCommitSha 存在时只含 HEAD（不含 tag），且可 verify', async () => {
    const res = await pack({ entity: { fullName: 'acme/widget', baseCommitSha: repo.baseSha } });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.incremental, true);
    assert.deepEqual(listBundleRefs(repo.path, res.bundlePath).map((r) => r.ref), ['HEAD']);
    assert.equal(verifyBundle(repo.path, res.bundlePath).ok, true);
    assert.deepEqual(bundleRevArgs({ baseCommitSha: 'abc123' }), ['HEAD', '^abc123']);
  });
  it('9 · 缓冲根取自 loadEnv().STORAGE_BUFFER_SPACE', async () => {
    const envRoot = join(tmpRoot, 'env buffer');
    const prev = process.env.STORAGE_BUFFER_SPACE;
    process.env.STORAGE_BUFFER_SPACE = envRoot; _resetForTest();
    try {
      assert.equal(resolveBufferRoot(), resolve(envRoot));
      const res = await packBundle(repo.path, { entity: { fullName: 'acme/widget' } });
      assert.equal(res.ok, true, res.error);
      assert.equal(res.bundlePath, join(envRoot, res.archiveName));
      assert.ok(existsSync(res.bundlePath));
    } finally {
      if (prev === undefined) delete process.env.STORAGE_BUFFER_SPACE;
      else process.env.STORAGE_BUFFER_SPACE = prev;
      _resetForTest();
    }
  });
});
