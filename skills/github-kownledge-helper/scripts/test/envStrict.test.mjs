// envStrict.test.mjs — 严格环境加载层单测（node:test）
// 覆盖：env 缺失 / 绝对路径校验 / 路径不存在 / 缺 manifest.json（warn 不阻断）/ 正常解析 / 幂等 / 未知 key

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  load_env,
  get,
  _resetForTest,
  _setDotEnvForTest,
  _snapshot,
  LoadEnvError,
  SKILL_ENV,
  SKILL_ENV_STD,
} from '../lib/envStrict.mjs';
import { makeFakeRoot } from './helpers.mjs';

let savedEnv;
let savedEnvStd;

function setEnv(v) {
  if (v === undefined) {
    delete process.env[SKILL_ENV];
    delete process.env[SKILL_ENV_STD];
  } else {
    process.env[SKILL_ENV_STD] = v;
    process.env[SKILL_ENV] = v;
  }
}

beforeEach(() => {
  savedEnv = process.env[SKILL_ENV];
  savedEnvStd = process.env[SKILL_ENV_STD];
  _resetForTest();
  _setDotEnvForTest(false); // 默认测试隔离，避免意外读入本地 workspace 的 .agents/.env
});

afterEach(() => {
  setEnv(savedEnv);
  process.env[SKILL_ENV_STD] = savedEnvStd;
  _resetForTest();
});

describe('load_env', () => {
  it('throws when env var is unset and no .env exists', () => {
    setEnv(undefined);
    assert.throws(() => load_env(), LoadEnvError);
    assert.throws(() => load_env(), /未设置/);
  });

  it('throws when env var is empty string', () => {
    setEnv('   ');
    assert.throws(() => load_env(), LoadEnvError);
  });

  it('throws when path is not absolute', () => {
    setEnv('relative/path');
    assert.throws(() => load_env(), /不是绝对路径/);
  });

  it('throws when path does not exist', () => {
    // 跨平台：tmpdir() 下的绝对路径必定不存在（Windows / POSIX 均成立）
    setEnv(join(tmpdir(), 'ghh-does-not-exist-xyzzy'));
    assert.throws(() => load_env(), /路径不存在/);
  });

  it('warns but still initializes when path lacks manifest.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghh-loadenv-'));
    setEnv(dir); // dir 存在但不含 manifest.json（首装自举场景）
    const warns = [];
    const origWarn = console.warn;
    console.warn = (m) => warns.push(String(m));
    try {
      load_env();
    } finally {
      console.warn = origWarn;
    }
    assert.ok(
      warns.join('\n').includes('manifest.json'),
      '应提示缺 manifest.json 并建议 sync-manifest'
    );
    // 初始化照常完成，路径可用
    assert.strictEqual(get('project_root'), dir);
    assert.strictEqual(get('manifest_path'), join(dir, 'manifest.json'));
  });

  it('loads successfully with valid root', () => {
    const root = makeFakeRoot();
    setEnv(root);
    load_env();
    assert.strictEqual(get('project_root'), root);
    assert.strictEqual(get('repos_root'), join(root, 'repos'));
    assert.strictEqual(get('docs_root'), join(root, 'docs'));
    assert.strictEqual(get('manifest_path'), join(root, 'manifest.json'));
  });

  it('is idempotent (multiple load_env calls do not reset)', () => {
    const root = makeFakeRoot();
    setEnv(root);
    load_env();
    const first = get('project_root');
    setEnv(join(tmpdir(), 'ghh-different-root'));
    load_env(); // 应忽略
    assert.strictEqual(get('project_root'), first);
  });

  it('caches init error and rethrows it', () => {
    setEnv(undefined);
    assert.throws(() => load_env(), LoadEnvError);
    setEnv('also-bad');
    assert.throws(() => load_env(), LoadEnvError); // 同一错误再次抛
  });

  it('derives doc_map_scripts from DOC_MAP_MANAGER_SCRIPTS when set', () => {
    const root = makeFakeRoot();
    const customScripts = join(root, 'custom-scripts');
    process.env.DOC_MAP_MANAGER_SCRIPTS = customScripts;
    setEnv(root);
    load_env();
    assert.strictEqual(get('doc_map_scripts'), customScripts);
    delete process.env.DOC_MAP_MANAGER_SCRIPTS;
  });

  it('falls back to ~/.agents/skills/doc-map-manager/scripts', () => {
    const root = makeFakeRoot();
    delete process.env.DOC_MAP_MANAGER_SCRIPTS;
    setEnv(root);
    load_env();
    const expected = join(
      process.env.HOME ?? process.env.USERPROFILE ?? '',
      '.agents',
      'skills',
      'doc-map-manager',
      'scripts'
    );
    assert.strictEqual(get('doc_map_scripts'), expected);
  });
});

describe('get', () => {
  it('auto-initializes on first call', () => {
    const root = makeFakeRoot();
    setEnv(root);
    assert.strictEqual(_snapshot(), null);
    assert.strictEqual(get('project_root'), root);
    assert.notStrictEqual(_snapshot(), null);
  });

  it('throws on unknown key', () => {
    const root = makeFakeRoot();
    setEnv(root);
    load_env();
    assert.throws(() => get('nonexistent'), /unknown key/);
  });
});
