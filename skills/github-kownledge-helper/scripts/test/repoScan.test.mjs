// repoScan.test.mjs — repoScan 单元测试（node:test）
// 回归：SSH remote URL（git@host:owner/repo.git）此前被 split('/') 解析成坏 owner

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOrigin, scanRepos } from '../lib/repoScan.mjs';
import { SKILL_ENV, SKILL_ENV_STD, _resetForTest, _setDotEnvForTest } from '../lib/envStrict.mjs';

describe('parseOrigin', () => {
  it('parses SSH remote URL (git@host:owner/repo.git)', () => {
    assert.deepStrictEqual(
      parseOrigin('git@github.com:langchain-ai/langchain.git'),
      { owner: 'langchain-ai', repo: 'langchain' }
    );
  });

  it('parses https URL with .git suffix', () => {
    assert.deepStrictEqual(
      parseOrigin('https://github.com/facebook/react.git'),
      { owner: 'facebook', repo: 'react' }
    );
  });

  it('parses owner/repo shorthand (fallback path)', () => {
    assert.deepStrictEqual(parseOrigin('facebook/react'), {
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('keeps legacy split behavior for nested group paths', () => {
    // parseRepoInput 拒绝 3 段路径 → 走回退分支取最后两段
    assert.deepStrictEqual(parseOrigin('group/owner/repo.git'), {
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('returns null on malformed url', () => {
    assert.strictEqual(parseOrigin('single-segment'), null);
  });
});

describe('scanRepos', () => {
  it('returns [] when repos/ does not exist (first-run bootstrap)', () => {
    // 回归：首装根连 repos/ 都没有时，sync-manifest 应能自举写出空 manifest 而非 ENOENT 崩溃
    const root = mkdtempSync(join(tmpdir(), 'ghh-scanrepos-'));
    const savedStd = process.env[SKILL_ENV_STD];
    const saved = process.env[SKILL_ENV];
    _resetForTest();
    _setDotEnvForTest(false); // 测试隔离，不读本地 .agents/.env
    process.env[SKILL_ENV_STD] = root;
    process.env[SKILL_ENV] = root;
    try {
      assert.deepStrictEqual(scanRepos(), []);
    } finally {
      if (savedStd === undefined) delete process.env[SKILL_ENV_STD];
      else process.env[SKILL_ENV_STD] = savedStd;
      if (saved === undefined) delete process.env[SKILL_ENV];
      else process.env[SKILL_ENV] = saved;
      _resetForTest();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
