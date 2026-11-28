// env.test.mjs — generic-storage-sync 原生 .agents/.env 加载器单测（node:test）
//
// 隔离要点：loadEnv() 默认从 process.cwd() 向上探测 .agents/.env，会读到仓库真实配置
// 与用户主目录下的配置，导致断言失真。因此所有用例一律用 options.startDir /
// options.envFile 指向临时目录，并在 afterEach 中 _resetForTest() + 清理临时目录。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import {
  parseDotEnv,
  findEnvFile,
  loadEnv,
  _resetForTest,
  SKILL_ENV,
  SKILL_ENV_STD,
} from '../env.mjs';

const MANAGED_KEYS = [
  SKILL_ENV_STD,
  SKILL_ENV,
  'STORAGE_BUFFER_SPACE',
  'STORAGE_MAX_RETAINED_SNAPSHOTS',
  'STORAGE_TRASH_TTL_DAYS',
  'STORAGE_AUTO_TRASH_ON_PUSH',
];

let tmpRoot;
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(MANAGED_KEYS.map((k) => [k, process.env[k]]));
  for (const key of MANAGED_KEYS) delete process.env[key];
  _resetForTest();
  tmpRoot = mkdtempSync(join(tmpdir(), 'gss-'));
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetForTest();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** 在 dir 下写一份 .agents/.env，返回文件路径 */
function writeAgentsEnv(dir, content) {
  mkdirSync(join(dir, '.agents'), { recursive: true });
  const envPath = join(dir, '.agents', '.env');
  writeFileSync(envPath, content, 'utf-8');
  return envPath;
}

describe('parseDotEnv', () => {
  it('跳过 # 注释行与空行', () => {
    const parsed = parseDotEnv(['# 注释行', '', '   ', 'KEY=VALUE', '# 尾注释'].join('\n'));
    assert.deepStrictEqual(parsed, { KEY: 'VALUE' });
  });

  it('去除单引号 / 双引号包裹并保留内部空格', () => {
    const parsed = parseDotEnv(['A="带 空格"', "B='单引号值'", 'C=裸值'].join('\n'));
    assert.strictEqual(parsed.A, '带 空格');
    assert.strictEqual(parsed.B, '单引号值');
    assert.strictEqual(parsed.C, '裸值');
  });

  it('值内含 = 不被截断', () => {
    const parsed = parseDotEnv('TOKEN=abc=def==');
    assert.strictEqual(parsed.TOKEN, 'abc=def==');
  });

  it('无 = 的行被忽略，空值保留为空串', () => {
    const parsed = parseDotEnv(['BROKEN', 'EMPTY=', '=NO_KEY'].join('\n'));
    assert.deepStrictEqual(parsed, { EMPTY: '' });
  });
});

describe('findEnvFile', () => {
  it('命中 startDir 同级的 .agents/.env', () => {
    const expected = writeAgentsEnv(tmpRoot, 'A=1\n');
    assert.strictEqual(findEnvFile(tmpRoot), expected);
  });

  it('向上递归探测命中父目录的 .agents/.env', () => {
    const expected = writeAgentsEnv(tmpRoot, 'A=1\n');
    const deep = join(tmpRoot, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    assert.strictEqual(findEnvFile(deep), expected);
  });

  it('同级 .agents/.env 优先于同级 .env', () => {
    const expected = writeAgentsEnv(tmpRoot, 'A=1\n');
    writeFileSync(join(tmpRoot, '.env'), 'A=2\n', 'utf-8');
    assert.strictEqual(findEnvFile(tmpRoot), expected);
  });

  it('探测链上没有 .env 时返回 null', () => {
    const driveRoot = parse(tmpdir()).root;
    assert.strictEqual(existsSync(join(driveRoot, '.agents', '.env')), false);
    assert.strictEqual(existsSync(join(driveRoot, '.env')), false);
    assert.strictEqual(findEnvFile(driveRoot), null);
  });
});

describe('loadEnv', () => {
  it('process.env 优先级高于文件配置', () => {
    const envFile = writeAgentsEnv(tmpRoot, `${SKILL_ENV_STD}="from-file"\n`);
    process.env[SKILL_ENV_STD] = 'from-process-env';
    const env = loadEnv({ envFile, forceReload: true });
    assert.strictEqual(env.PROJECT_ROOT, 'from-process-env');
  });

  it('envFile 指定但不存在的文件时回退默认值', () => {
    const missing = join(tmpRoot, 'no-such-file.env');
    const env = loadEnv({ envFile: missing, forceReload: true });
    assert.strictEqual(env.ENV_FILE_PATH, missing);
    assert.strictEqual(env.PROJECT_ROOT, process.cwd());
    assert.strictEqual(env.STORAGE_BUFFER_SPACE, join(process.cwd(), 'buffer'));
    assert.strictEqual(env.STORAGE_MAX_RETAINED_SNAPSHOTS, 2);
    assert.strictEqual(env.STORAGE_TRASH_TTL_DAYS, 7);
    assert.strictEqual(env.STORAGE_AUTO_TRASH_ON_PUSH, true);
  });

  it('探测链上没有 .env 时回退默认值', () => {
    const driveRoot = parse(tmpdir()).root;
    const env = loadEnv({ startDir: driveRoot, forceReload: true });
    assert.strictEqual(env.ENV_FILE_PATH, '');
    assert.strictEqual(env.STORAGE_MAX_RETAINED_SNAPSHOTS, 2);
    assert.strictEqual(env.STORAGE_TRASH_TTL_DAYS, 7);
  });

  it('startDir 指向临时目录时只读取该目录的配置', () => {
    const dirA = join(tmpRoot, 'a');
    const dirB = join(tmpRoot, 'b');
    writeAgentsEnv(dirA, `${SKILL_ENV_STD}="${dirA}"\n`);
    writeAgentsEnv(dirB, `${SKILL_ENV_STD}="${dirB}"\n`);
    const envA = loadEnv({ startDir: dirA, forceReload: true });
    assert.strictEqual(envA.PROJECT_ROOT, dirA);
    assert.strictEqual(envA.ENV_FILE_PATH, join(dirA, '.agents', '.env'));
    const envB = loadEnv({ startDir: dirB, forceReload: true });
    assert.strictEqual(envB.PROJECT_ROOT, dirB);
    assert.strictEqual(envB.ENV_FILE_PATH, join(dirB, '.agents', '.env'));
  });

  it('forceReload 绕过缓存，未强制重载时返回上一次结果', () => {
    const dirA = join(tmpRoot, 'a');
    const dirB = join(tmpRoot, 'b');
    writeAgentsEnv(dirA, `${SKILL_ENV_STD}="${dirA}"\n`);
    writeAgentsEnv(dirB, `${SKILL_ENV_STD}="${dirB}"\n`);
    assert.strictEqual(loadEnv({ startDir: dirA, forceReload: true }).PROJECT_ROOT, dirA);
    assert.strictEqual(loadEnv({ startDir: dirB }).PROJECT_ROOT, dirA); // 命中缓存
    assert.strictEqual(loadEnv({ startDir: dirB, forceReload: true }).PROJECT_ROOT, dirB);
  });

  it('从文件派生存储配置项', () => {
    const envFile = writeAgentsEnv(
      tmpRoot,
      [
        'STORAGE_BUFFER_SPACE="./buffer-space"',
        'STORAGE_MAX_RETAINED_SNAPSHOTS=5',
        'STORAGE_TRASH_TTL_DAYS=14',
        'STORAGE_AUTO_TRASH_ON_PUSH=false',
      ].join('\n'),
    );
    const env = loadEnv({ envFile, forceReload: true });
    assert.strictEqual(env.STORAGE_BUFFER_SPACE, './buffer-space');
    assert.strictEqual(env.STORAGE_MAX_RETAINED_SNAPSHOTS, 5);
    assert.strictEqual(env.STORAGE_TRASH_TTL_DAYS, 14);
    assert.strictEqual(env.STORAGE_AUTO_TRASH_ON_PUSH, false);
  });
});
