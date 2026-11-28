// queryRepo.test.mjs — query 的仓库定位与真 git 读取（node:test）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepo } from '../commands/query.mjs';
import { listTags } from '../lib/queryGit.mjs';
import { git, makeRepoFixture, cleanupDir } from './helpers.mjs';

function makeManifest(proj) {
  writeFileSync(
    join(proj, 'manifest.json'),
    JSON.stringify({
      version: '1.1',
      updated_at: '2026-08-13T12:00:00+08:00',
      repo_count: 2,
      repos: [
        {
          name: 'react',
          owner: 'facebook',
          full_name: 'facebook/react',
          url: 'https://github.com/facebook/react.git',
          path: 'repos/facebook__react',
          docs_path: 'docs/facebook__react',
          group: '',
          default_branch: 'main',
          added_at: '2026-08-13T12:00:00+08:00',
          last_pull_at: '2026-08-13T12:00:00+08:00',
          current_commit: 'a'.repeat(40),
          current_commit_short: 'aaaaaaa',
          current_commit_date: '2026-08-13T04:00:00+00:00',
          tags: [],
          notes: '',
        },
        {
          name: 'repo-in-group',
          owner: 'someone',
          full_name: 'someone/repo-in-group',
          url: 'https://github.com/someone/repo-in-group.git',
          path: 'repos/ai-app/someone__repo-in-group',
          docs_path: 'docs/ai-app/someone__repo-in-group',
          group: 'ai-app',
          default_branch: 'main',
          added_at: '2026-08-13T12:00:00+08:00',
          last_pull_at: '2026-08-13T12:00:00+08:00',
          current_commit: 'b'.repeat(40),
          current_commit_short: 'bbbbbbb',
          current_commit_date: '2026-08-13T04:00:00+00:00',
          tags: [],
          notes: '',
        },
      ],
    })
  );
}

describe('resolveRepo', () => {
  let proj;
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'ghh-qr-proj-'));
    makeManifest(proj);
  });
  afterEach(() => {
    cleanupDir(proj);
  });

  it('matches by full_name', () => {
    const r = resolveRepo('facebook/react', proj);
    assert.strictEqual(r?.full_name, 'facebook/react');
    assert.strictEqual(r?.path, 'repos/facebook__react');
  });

  it('matches by name', () => {
    const r = resolveRepo('react', proj);
    assert.strictEqual(r?.full_name, 'facebook/react');
  });

  it('matches entry in group', () => {
    const r = resolveRepo('someone/repo-in-group', proj);
    assert.strictEqual(r?.group, 'ai-app');
    assert.strictEqual(r?.path, 'repos/ai-app/someone__repo-in-group');
  });

  it('returns null on no match', () => {
    assert.strictEqual(resolveRepo('does-not-exist', proj), null);
  });
});

describe('query e2e (real git only)', () => {
  let fix;
  beforeEach(() => {
    fix = makeRepoFixture('ghh-qr-', 'c1 init');
  });
  afterEach(() => {
    cleanupDir(fix.path);
  });

  it('reads real git log via git.mjs', () => {
    const head = git(fix.path, ['rev-parse', '--short', 'HEAD']);
    const log = git(fix.path, ['log', '--oneline', '-20']);
    assert.match(head, /^[0-9a-f]{7,}$/);
    assert.ok(log.includes('c1 init'));
  });

  it('reads tag (none initially) and creates one', () => {
    const PAT = 'v' + '*';
    const tag = git(fix.path, ['tag', '--list', PAT]);
    assert.strictEqual(tag, '');
    git(fix.path, ['tag', 'v0.0.1']);
    const t2 = git(fix.path, ['tag', '--list', PAT]);
    assert.strictEqual(t2, 'v0.0.1');
  });

  it('listTags returns pointed commit for both lightweight and annotated tags', () => {
    // 第二个 commit：annotated tag 挂它上面；lightweight tag 挂首个 commit
    writeFileSync(join(fix.path, 'b.txt'), 'b\n');
    git(fix.path, ['add', '.']);
    git(fix.path, ['commit', '-q', '-m', 'c2 second']);
    const sha2 = git(fix.path, ['rev-parse', 'HEAD']);
    const sha1 = fix.sha;
    git(fix.path, ['tag', 'lw-1.0', sha1]); // lightweight
    git(fix.path, ['tag', '-a', '-m', 'release note', 'ann-1.0', sha2]); // annotated

    const tags = listTags(fix.path, null);
    assert.strictEqual(tags.length, 2);

    const lw = tags.find((t) => t.name === 'lw-1.0');
    assert.strictEqual(lw?.commit, sha1, 'lightweight tag 应指向所在 commit');
    assert.ok(lw?.date, 'lightweight tag 应有日期');
    assert.ok(lw?.subject, 'lightweight tag 应有主题');

    const ann = tags.find((t) => t.name === 'ann-1.0');
    assert.strictEqual(ann?.commit, sha2, 'annotated tag 应返回被指向 commit 的 sha');
    assert.strictEqual(ann?.subject, 'c2 second', 'annotated tag 主题应为 commit subject（非 tag message）');
    assert.ok(ann?.date);

    // pattern 过滤仍可用
    const filtered = listTags(fix.path, 'lw*');
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0]?.name, 'lw-1.0');
  });
});
