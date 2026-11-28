// reposRootConfig.test.mjs — repos 根目录外置配置的路径解析契约
//
// 契约（本次变更）：
//   1. GITHUB_KNOWLEDGE_HELPER_REPOS_DIR 可把 repos 根目录移到项目根之外
//   2. manifest 的 path 字段改为「相对 repos 根」（xxx / group/xxx），不再带 repos/ 前缀
//   3. docs 仍留项目根（docs_root 不受此配置影响）
//
// 覆盖：envStrict 解析 / paths 解析 / buildEntry 生成的 path 语义

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  load_env,
  get,
  _resetForTest,
  _setDotEnvForTest,
} from '../lib/envStrict.mjs';
import { SKILL_ENV, SKILL_ENV_STD } from '../lib/envStrict.mjs';
import { makeFakeRoot, cleanupDir, makeRepoFixture } from './helpers.mjs';

const REPOS_DIR_ENV = 'GITHUB_KNOWLEDGE_HELPER_REPOS_DIR';

let savedRoot;
let savedRootStd;
let savedReposDir;

beforeEach(() => {
  savedRoot = process.env[SKILL_ENV];
  savedRootStd = process.env[SKILL_ENV_STD];
  savedReposDir = process.env[REPOS_DIR_ENV];
  _resetForTest();
  _setDotEnvForTest(false);
});

afterEach(() => {
  if (savedRoot === undefined) delete process.env[SKILL_ENV];
  else process.env[SKILL_ENV] = savedRoot;
  if (savedRootStd === undefined) delete process.env[SKILL_ENV_STD];
  else process.env[SKILL_ENV_STD] = savedRootStd;
  if (savedReposDir === undefined) delete process.env[REPOS_DIR_ENV];
  else process.env[REPOS_DIR_ENV] = savedReposDir;
  _resetForTest();
});

describe('GITHUB_KNOWLEDGE_HELPER_REPOS_DIR', () => {
  it('defaults repos_root to <project_root>/repos when unset', () => {
    const root = makeFakeRoot();
    process.env[SKILL_ENV_STD] = root;
    delete process.env[REPOS_DIR_ENV];
    load_env();
    assert.strictEqual(get('repos_root'), join(root, 'repos'));
  });

  it('uses the configured absolute dir as repos_root when set', () => {
    const root = makeFakeRoot();
    const external = join(tmpdir(), 'ghh-external-repos');
    mkdirSync(external, { recursive: true });
    process.env[SKILL_ENV_STD] = root;
    process.env[REPOS_DIR_ENV] = external;
    load_env();
    assert.strictEqual(get('repos_root'), external);
    cleanupDir(external);
  });

  it('leaves docs_root at the project root even when repos_root is external', () => {
    const root = makeFakeRoot();
    const external = join(tmpdir(), 'ghh-external-repos-2');
    mkdirSync(external, { recursive: true });
    process.env[SKILL_ENV_STD] = root;
    process.env[REPOS_DIR_ENV] = external;
    load_env();
    assert.strictEqual(get('docs_root'), join(root, 'docs'));
    cleanupDir(external);
  });

  it('throws when configured repos dir is not absolute', () => {
    const root = makeFakeRoot();
    process.env[SKILL_ENV_STD] = root;
    process.env[REPOS_DIR_ENV] = 'relative/repos';
    assert.throws(() => load_env(), /不是绝对路径/);
  });

  it('throws when configured repos dir does not exist', () => {
    const root = makeFakeRoot();
    process.env[SKILL_ENV_STD] = root;
    process.env[REPOS_DIR_ENV] = join(tmpdir(), 'ghh-does-not-exist-repos-xyzzy');
    assert.throws(() => load_env(), /路径不存在/);
  });
});

describe('manifest path 语义', () => {
  it('buildEntryFromRepo stores path relative to the repos root (no repos/ prefix)', async () => {
    const { buildEntryFromRepo } = await import('../lib/buildEntryFromRepo.mjs');
    const fixture = makeRepoFixture('ghh-path-');
    try {
      // buildEntryFromRepo 要求有 remote.origin.url
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'], {
        cwd: fixture.path,
        stdio: 'pipe',
      });
      const entry = buildEntryFromRepo(fixture.path, {
        owner: 'acme',
        repo: 'widget',
        group: '',
        now: '2026-11-29T00:00:00+08:00',
      });
      assert.strictEqual(entry.path, 'acme__widget');
      assert.strictEqual(entry.docs_path, 'docs/acme__widget');
    } finally {
      cleanupDir(fixture.path);
    }
  });

  it('buildEntryFromRepo keeps group as a path segment relative to the repos root', async () => {
    const { buildEntryFromRepo } = await import('../lib/buildEntryFromRepo.mjs');
    const fixture = makeRepoFixture('ghh-path-group-');
    try {
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'], {
        cwd: fixture.path,
        stdio: 'pipe',
      });
      const entry = buildEntryFromRepo(fixture.path, {
        owner: 'acme',
        repo: 'widget',
        group: 'ai-app',
        now: '2026-11-29T00:00:00+08:00',
      });
      assert.strictEqual(entry.path, 'ai-app/acme__widget');
      assert.strictEqual(entry.docs_path, 'docs/ai-app/acme__widget');
    } finally {
      cleanupDir(fixture.path);
    }
  });
});

describe('reposRoot 解析', () => {
  it('reposRoot() reflects the configured external dir', async () => {
    const root = makeFakeRoot();
    const external = join(tmpdir(), 'ghh-external-repos-3');
    mkdirSync(external, { recursive: true });
    process.env[SKILL_ENV_STD] = root;
    process.env[REPOS_DIR_ENV] = external;
    const { reposRoot, docsRoot } = await import('../lib/paths.mjs');
    assert.strictEqual(reposRoot(), external);
    assert.strictEqual(docsRoot(), join(root, 'docs'));
    cleanupDir(external);
  });

  it('reposRoot() follows the cwd project root, not a global .env (regression)', async () => {
    // 回归：repos 根属于项目自身，读 <project_root>/.agents/.env；
    // 若走 cwd 向上探测，tmpRoot 下会命中用户全局 ~/.agents/.env，
    // 把 repos 根解析到真实项目目录去。
    const tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-cwd-root-'));
    writeFileSync(join(tmpRoot, 'manifest.json'), '{"version":"1.1","repos":[]}');
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      const { reposRoot } = await import('../lib/paths.mjs');
      assert.strictEqual(reposRoot(), join(tmpRoot, 'repos'));
    } finally {
      process.chdir(cwd);
      cleanupDir(tmpRoot);
    }
  });

  it('reposRoot() reads REPOS_DIR_ENV from the project own .agents/.env', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-ownenv-'));
    writeFileSync(join(tmpRoot, 'manifest.json'), '{"version":"1.1","repos":[]}');
    const external = join(tmpdir(), 'ghh-external-repos-4');
    mkdirSync(external, { recursive: true });
    mkdirSync(join(tmpRoot, '.agents'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.agents', '.env'),
      `${REPOS_DIR_ENV}=${external}\n`
    );
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      const { reposRoot } = await import('../lib/paths.mjs');
      assert.strictEqual(reposRoot(), external);
    } finally {
      process.chdir(cwd);
      cleanupDir(tmpRoot);
      cleanupDir(external);
    }
  });
});

describe('query 命令的路径解析', () => {
  it('query --freshness 能在外置 repos 根下找到仓库（regression: 曾用 join(root, path)）', async () => {
    // 回归：query.mjs 曾用 join(projectRoot, repo.path) 拼仓库绝对路径，
    // repos 根外置后会解析到项目根下 → git 读不到 → 误报 DRIFT。
    const tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-q-ext-'));
    const external = join(tmpdir(), 'ghh-q-external-');
    mkdirSync(external, { recursive: true });
    mkdirSync(join(tmpRoot, '.agents'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.agents', '.env'),
      `${REPOS_DIR_ENV}=${external}\n`
    );

    // 在 external 下造一个真 git 仓
    const repoDir = join(external, 'acme__widget');
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repoDir, stdio: 'pipe' });
    writeFileSync(join(repoDir, 'README.md'), '# w\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir, encoding: 'utf-8',
    }).trim();

    writeFileSync(
      join(tmpRoot, 'manifest.json'),
      JSON.stringify({
        version: '1.1',
        updated_at: '2026-11-29T00:00:00+08:00',
        repo_count: 1,
        repos: [{
          name: 'widget', owner: 'acme', full_name: 'acme/widget',
          url: 'https://github.com/acme/widget.git',
          path: 'acme__widget',
          docs_path: 'docs/acme__widget',
          group: '', default_branch: 'main',
          added_at: '2026-11-29T00:00:00+08:00',
          last_pull_at: '2026-11-29T00:00:00+08:00',
          current_commit: sha,
          current_commit_short: sha.slice(0, 7),
          current_commit_date: '2026-11-29T00:00:00+08:00',
          tags: [], notes: '',
        }],
      }, null, 2)
    );

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      const { def } = await import('../commands/query.mjs');
      const out = [];
      const origLog = console.log;
      console.log = (m) => out.push(String(m));
      try {
        await def.run({}, ['acme/widget'], ['acme/widget', '--freshness']);
      } finally {
        console.log = origLog;
      }
      const text = out.join('\n');
      assert.match(text, /MATCH/, `应判定为 MATCH 而非 DRIFT，实际输出：\n${text}`);
    } finally {
      process.chdir(cwd);
      cleanupDir(tmpRoot);
      cleanupDir(external);
    }
  });
});
