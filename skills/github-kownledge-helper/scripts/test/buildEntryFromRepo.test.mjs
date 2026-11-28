// buildEntryFromRepo.test.mjs — 集成测试
// 用 tmpdir + 真 git 建一个 fixture 仓库，验证 buildEntryFromRepo 输出符合 manifest schema
// 已迁移到 node:test runner（node:assert/strict）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildEntryFromRepo } from '../lib/buildEntryFromRepo.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ghh-fixture-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  // 关键：buildEntryFromRepo 读 remote.origin.url → 必须设一个 fake remote
  git(dir, [
    'remote',
    'add',
    'origin',
    'https://github.com/example/fixture.git',
  ]);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  return { path: dir, sha };
}

describe('buildEntryFromRepo', () => {
  let fixture;
  let cleanup = (_p) => {};

  beforeEach(() => {
    fixture = makeFixtureRepo();
    cleanup = (p) => {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };
  });

  afterEach(() => {
    cleanup(fixture.path);
  });

  it('builds a manifest entry from a real git repo', () => {
    const entry = buildEntryFromRepo(fixture.path, {
      owner: 'example',
      repo: 'fixture',
      group: '',
      now: '2026-08-13T12:00:00+08:00',
    });

    assert.strictEqual(entry.name, 'fixture');
    assert.strictEqual(entry.owner, 'example');
    assert.strictEqual(entry.full_name, 'example/fixture');
    assert.strictEqual(entry.url, 'https://github.com/example/fixture.git');
    assert.strictEqual(entry.path, 'example__fixture');
    assert.strictEqual(entry.docs_path, 'docs/example__fixture');
    assert.strictEqual(entry.group, '');
    assert.strictEqual(entry.default_branch, 'main');
    assert.strictEqual(entry.added_at, '2026-08-13T12:00:00+08:00');
    assert.strictEqual(entry.last_pull_at, '2026-08-13T12:00:00+08:00');
    assert.strictEqual(entry.current_commit, fixture.sha);
    assert.deepStrictEqual(entry.tags, []);
    assert.strictEqual(entry.notes, '');
    assert.strictEqual(entry.current_commit_short, fixture.sha.slice(0, 7));
    assert.match(
      entry.current_commit_date,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it('honors group prefix in path / docs_path', () => {
    const entry = buildEntryFromRepo(fixture.path, {
      owner: 'example',
      repo: 'fixture',
      group: 'ai-app',
      now: '2026-08-13T12:00:00+08:00',
    });
    assert.strictEqual(entry.path, 'ai-app/example__fixture');
    assert.strictEqual(entry.docs_path, 'docs/ai-app/example__fixture');
    assert.strictEqual(entry.group, 'ai-app');
  });

  it('throws when remote.origin.url is missing', () => {
    // 新建一个无 remote 的 fixture
    const dir = mkdtempSync(join(tmpdir(), 'ghh-noremote-'));
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 't@t']);
    git(dir, ['config', 'user.name', 't']);
    writeFileSync(join(dir, 'a.md'), 'a');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'a']);
    try {
      assert.throws(
        () =>
          buildEntryFromRepo(dir, {
            owner: 'o',
            repo: 'r',
            group: '',
            now: '2026-08-13T12:00:00+08:00',
          }),
        /origin|url/i
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
