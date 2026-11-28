// query.test.mjs — query 的参数解析与输出格式化单测（node:test）

import { describe, it } from 'node:test';import assert from 'node:assert/strict';
import {
  parseQueryFlags,
  formatLog,
  formatTag,
  formatShow,
  formatGrab,
  formatRecent,
} from '../commands/query.mjs';

describe('parseQueryFlags', () => {
  it('parses log with limit', () => {
    const f = parseQueryFlags(['facebook/react', '--log', '--limit', '5']);
    assert.strictEqual(f.repo, 'facebook/react');
    assert.strictEqual(f.mode, 'log');
    assert.strictEqual(f.limit, 5);
  });

  it('parses tag with pattern', () => {
    const f = parseQueryFlags(['react', '--tag', 'v19x']);
    assert.strictEqual(f.mode, 'tag');
    assert.strictEqual(f.tag, 'v19x');
  });

  it('parses show with sha', () => {
    const f = parseQueryFlags(['react', '--show', 'abc1234']);
    assert.strictEqual(f.mode, 'show');
    assert.strictEqual(f.show, 'abc1234');
  });

  it('parses grab with question', () => {
    const f = parseQueryFlags(['react', '--grab', 'how']);
    assert.strictEqual(f.mode, 'grab');
    assert.strictEqual(f.grab, 'how');
  });

  it('parses freshness', () => {
    const f = parseQueryFlags(['react', '--freshness']);
    assert.strictEqual(f.mode, 'freshness');
  });

  it('parses all + recent + since', () => {
    const f = parseQueryFlags(['--all', '--recent', '--since', '2026-08-01']);
    assert.strictEqual(f.all, true);
    assert.strictEqual(f.mode, 'recent');
    assert.strictEqual(f.since, '2026-08-01');
  });

  it('throws when no mode specified', () => {
    assert.throws(() => parseQueryFlags(['--log']), /repo/i);
  });

  it('throws when all without recent', () => {
    assert.throws(() => parseQueryFlags(['--all', '--log']), /recent/i);
  });

  it('parses json flag', () => {
    const f = parseQueryFlags(['react', '--log', '--json']);
    assert.strictEqual(f.json, true);
  });
});

describe('formatLog', () => {
  it('formats log lines with header', () => {
    const out = formatLog('facebook/react', 'abc1234', '2026-08-13T12:00:00+08:00', [
      'abc1234 2026-08-12 18:20  Fix hydration',
      'def5678 2026-08-11 09:43  Bump deps',
    ]);
    assert.ok(out.includes('facebook/react log'));
    assert.ok(out.includes('HEAD=abc1234'));
    assert.ok(out.includes('last_pull_at=2026-08-13T12:00:00+08:00'));
    assert.ok(out.includes('abc1234 2026-08-12 18:20  Fix hydration'));
    assert.ok(out.includes('def5678 2026-08-11 09:43  Bump deps'));
  });

  it('shows empty state', () => {
    const out = formatLog('r', 'sha', 'now', []);
    assert.ok(out.includes('no commits'));
  });
});

describe('formatTag', () => {
  it('formats exact tag lookup', () => {
    const t = {
      name: 'v0.8.0',
      commit: '3d204dfdaaf09d67d49c7855630ef949754e0f8f',
      date: '2026-08-13T04:38:34Z',
      subject: 'Release v0.8.0',
    };
    const out = formatTag('vllm-project/vllm', t, '3d204dfd', 0);
    assert.ok(out.includes('v0.8.0'));
    assert.ok(out.includes('3d204dfdaaf09d67d49c7855630ef949754e0f8f'));
    assert.ok(out.includes('Release v0.8.0'));
  });

  it('formats tag list', () => {
    const tags = [
      { name: 'v0.8.0', commit: 'aaaa', date: '2026-08-01T00:00:00Z', subject: 'Release' },
      { name: 'v0.8.1', commit: 'bbbb', date: '2026-08-02T00:00:00Z', subject: 'hotfix' },
    ];
    const out = formatTag('r', null, 'aaaa', 0, tags);
    assert.ok(out.includes('2 matches'));    assert.ok(out.includes('v0.8.0'));
    assert.ok(out.includes('v0.8.1'));
  });
});

describe('formatShow', () => {
  it('formats show output', () => {
    const raw = [
      'commit abc1234def',
      'Author: x',
      'Date:   2026-08-12',
      '',
      '    Fix bug',
      '',
      ' file1.js | 2 +-',
      ' file2.js | 3 +++',
      ' 2 files changed',
    ].join('\n');
    const out = formatShow('facebook/react', 'abc1234', raw);
    assert.ok(out.includes('facebook/react show abc1234'));
    assert.ok(out.includes('Fix bug'));
    assert.ok(out.includes('file1.js'));
  });
});

describe('formatGrab', () => {
  it('shows no match state when stdout does not parse', () => {
    const stdout = 'nothing parseable here';
    const out = formatGrab('r', 'how', stdout);
    assert.ok(out.includes('r grab "how"'));
    assert.ok(out.includes('no match'));
  });
});

describe('formatRecent', () => {
  it('formats recent activity across repos', () => {
    const items = [
      { full_name: 'a/b', short: 'abc1234', date: '2026-08-13T04:00:00Z' },
      { full_name: 'c/d', short: 'def5678', date: '2026-08-12T22:00:00Z' },
    ];
    const out = formatRecent(items, '2026-08-06');
    assert.ok(out.includes('recent activity across 2 repos'));
    assert.ok(out.includes('a/b'));
    assert.ok(out.includes('abc1234'));
    assert.ok(out.includes('c/d'));
  });
});
