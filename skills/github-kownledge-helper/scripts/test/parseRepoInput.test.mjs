// parseRepoInput.test.mjs — parseRepoInput 单元测试
// 已迁移到 node:test runner（node:assert/strict）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoInput } from '../lib/parseRepoInput.mjs';

describe('parseRepoInput', () => {
  it('parses owner/repo shorthand', () => {
    assert.deepStrictEqual(parseRepoInput('facebook/react'), {
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('parses full https URL', () => {
    assert.deepStrictEqual(parseRepoInput('https://github.com/facebook/react'), {
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('parses .git URL', () => {
    assert.deepStrictEqual(
      parseRepoInput('https://github.com/facebook/react.git'),
      {
        owner: 'facebook',
        repo: 'react',
      }
    );
  });

  it('parses ssh git@ URL', () => {
    assert.deepStrictEqual(parseRepoInput('git@github.com:facebook/react.git'), {
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('accepts repo names with hyphens / dots / underscores', () => {
    assert.deepStrictEqual(parseRepoInput('comfyanonymous/ComfyUI'), {
      owner: 'comfyanonymous',
      repo: 'ComfyUI',
    });
    assert.deepStrictEqual(parseRepoInput('mr./do.something_repo'), {
      owner: 'mr.',
      repo: 'do.something_repo',
    });
  });

  it('trims surrounding whitespace', () => {
    assert.deepStrictEqual(parseRepoInput('  facebook/react  '), {
      owner: 'facebook',
      repo: 'react',
    });
  });

  it('throws on empty input', () => {
    assert.throws(() => parseRepoInput(''), /empty/i);
    assert.throws(() => parseRepoInput('   '), /empty/i);
  });

  it('throws on missing slash', () => {
    assert.throws(() => parseRepoInput('facebookreact'), /invalid/i);
  });

  it('throws on trailing slash', () => {
    assert.throws(() => parseRepoInput('facebook/react/'), /invalid/i);
  });

  it('throws on extra path segments', () => {
    assert.throws(() => parseRepoInput('facebook/react/tree/main'), /invalid/i);
  });

  it('throws on empty owner or repo', () => {
    assert.throws(() => parseRepoInput('/react'), /invalid/i);
    assert.throws(() => parseRepoInput('facebook/'), /invalid/i);
  });
});
