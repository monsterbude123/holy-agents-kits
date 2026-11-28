// queryRepo.test.mjs — query 的仓库定位与真 git 读取（node:test）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepo } from '../commands/query.mjs';
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
});
