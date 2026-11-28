// mergeEntry.test.mjs — manifest merge 单元测试
// 已迁移到 node:test runner（node:assert/strict）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEntry } from '../lib/manifest.mjs';

function mkEntry(over = {}) {
  return {
    name: 'r',
    owner: 'o',
    full_name: 'o/r',
    url: 'https://github.com/o/r.git',
    path: 'repos/o__r',
    docs_path: 'docs/o__r',
    group: '',
    default_branch: 'main',
    added_at: '2026-08-01T00:00:00+08:00',
    last_pull_at: '2026-08-10T00:00:00+08:00',
    current_commit: 'OLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLD',
    current_commit_short: 'oldoldol',
    current_commit_date: '2026-08-01T00:00:00+00:00',
    tags: [],
    notes: '',
    ...over,
  };
}

describe('mergeEntry', () => {
  it('preserves added_at and last_pull_at when no commit change', () => {
    const old = mkEntry({
      added_at: '2026-08-01T00:00:00+08:00',
      last_pull_at: '2026-08-10T00:00:00+08:00',
      tags: ['manual-tag'],
      notes: 'manual note',
      current_commit: 'SAME-SAME-SAME-SAME-SAME-SAME-SAME-SAME-SAME',
    });
    const fresh = mkEntry({
      current_commit: 'SAME-SAME-SAME-SAME-SAME-SAME-SAME-SAME-SAME',
      current_commit_short: 'samesame',
      current_commit_date: '2026-08-15T00:00:00+00:00',
    });
    const out = mergeEntry(old, fresh, '2026-08-20T00:00:00+08:00');
    assert.strictEqual(out.added_at, '2026-08-01T00:00:00+08:00');
    assert.strictEqual(out.last_pull_at, '2026-08-10T00:00:00+08:00');
    assert.deepStrictEqual(out.tags, ['manual-tag']);
    assert.strictEqual(out.notes, 'manual note');
  });

  it('updates last_pull_at when commit changed', () => {
    const old = mkEntry({
      last_pull_at: '2026-08-10T00:00:00+08:00',
      current_commit: 'OLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLD',
    });
    const fresh = mkEntry({
      current_commit: 'NEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEW',
      current_commit_short: 'newnewne',
      current_commit_date: '2026-08-20T00:00:00+00:00',
    });
    const out = mergeEntry(old, fresh, '2026-08-20T00:00:00+08:00');
    assert.strictEqual(out.last_pull_at, '2026-08-20T00:00:00+08:00');
    assert.strictEqual(out.added_at, '2026-08-01T00:00:00+08:00');
  });

  it('updates git-derived fields from fresh', () => {
    const old = mkEntry({
      current_commit_short: 'oldoldol',
      default_branch: 'main',
    });
    const fresh = mkEntry({
      current_commit_short: 'newshort',
      current_commit_date: '2026-08-25T00:00:00+00:00',
      default_branch: 'master',
      url: 'https://github.com/o/r.git',
    });
    const out = mergeEntry(old, fresh, '2026-08-25T00:00:00+08:00');
    assert.strictEqual(out.current_commit_short, 'newshort');
    assert.strictEqual(out.current_commit_date, '2026-08-25T00:00:00+00:00');
    assert.strictEqual(out.default_branch, 'master');
  });

  it('preserves group from old', () => {
    const old = mkEntry({ group: 'ai-app' });
    const fresh = mkEntry({ group: '' });
    const out = mergeEntry(old, fresh, '2026-08-20T00:00:00+08:00');
    assert.strictEqual(out.group, 'ai-app');
  });

  it('preserves tags empty array from old', () => {
    const old = mkEntry({ tags: [] });
    const fresh = mkEntry({ tags: ['something'] });
    const out = mergeEntry(old, fresh, '2026-08-20T00:00:00+08:00');
    assert.deepStrictEqual(out.tags, []);
  });
});
