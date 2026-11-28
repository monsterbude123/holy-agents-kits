// env.test.mjs — 共享环境核心单测（node:test）
// 覆盖：.env 文本解析 / .agents/.env 加载 / process.env 优先级

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseDotEnv } from '../lib/env.mjs';
import {
  load_env,
  get,
  _resetForTest,
  _setDotEnvForTest,
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

describe('parseDotEnv', () => {
  it('parses basic key-value pairs, comments, quotes and spaces', () => {
    const raw = `
      # 这是一个注释行
      KEY1=VALUE1
      KEY2="quoted value with space"
      KEY3='single quoted'
      EMPTY_LINE=

      # 另一个注释
      KEY4=   spaced value
    `;
    const parsed = parseDotEnv(raw);
    assert.strictEqual(parsed.KEY1, 'VALUE1');
    assert.strictEqual(parsed.KEY2, 'quoted value with space');
    assert.strictEqual(parsed.KEY3, 'single quoted');
    assert.strictEqual(parsed.EMPTY_LINE, '');
    assert.strictEqual(parsed.KEY4, 'spaced value');
  });
});

describe('load_env with .agents/.env', () => {
  it('loads environment from .agents/.env file', () => {
    const root = makeFakeRoot();
    const agentsDir = join(root, '.agents');
    mkdirSync(agentsDir);
    const envFile = join(agentsDir, '.env');
    writeFileSync(
      envFile,
      `GITHUB_KNOWLEDGE_HELPER_SPACE="${root}"\nDOC_MAP_MANAGER_SCRIPTS="${join(root, 'custom-scripts')}"\n`
    );

    setEnv(undefined);
    _setDotEnvForTest(envFile);
    load_env();

    assert.strictEqual(get('project_root'), root);
    assert.strictEqual(get('dot_env_path'), envFile);
    assert.strictEqual(get('doc_map_scripts'), join(root, 'custom-scripts'));
  });

  it('prefers explicit process.env over .agents/.env', () => {
    const root1 = makeFakeRoot();
    const root2 = makeFakeRoot();
    const envFile = join(root1, '.env');
    writeFileSync(envFile, `GITHUB_KNOWLEDGE_HELPER_SPACE="${root1}"\n`);

    setEnv(root2);
    _setDotEnvForTest(envFile);
    load_env();

    assert.strictEqual(get('project_root'), root2);
  });
});
