// runBuildIndex.test.mjs — 索引失败可见性单测（node:test）
// spawn 通过参数注入（不 mock node:child_process 模块），断言语义与迁移前一致

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuildIndex } from '../lib/buildIndex.mjs';

class FakeChild extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  killed = false;
  kill() {
    this.killed = true;
  }
}

/** 记录调用参数的假 spawn */
function fakeSpawn(child) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return child;
  };
  fn.calls = calls;
  return fn;
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

const SCRIPTS_DIR = join(tmpdir(), 'ghh-docmap-scripts');
const DOCS_DIR = join(tmpdir(), 'ghh-docmap-docs');

describe('runBuildIndex', () => {
  let stderrLogs = [];
  let stdoutLogs = [];
  let origError;
  let origLog;

  beforeEach(() => {
    stderrLogs = [];
    stdoutLogs = [];
    origError = console.error;
    origLog = console.log;
    console.error = (m) => {
      stderrLogs.push(String(m));
    };
    console.log = (m) => {
      stdoutLogs.push(String(m));
    };
  });

  afterEach(() => {
    console.error = origError;
    console.log = origLog;
  });

  it('prints stderr and returns ok=false when build-index exits 1', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child);

    const p = runBuildIndex(SCRIPTS_DIR, DOCS_DIR, spawnFn);
    child.stderr.push(
      Buffer.from(
        'Traceback (most recent call last):\n  File "build-index.py" line 42\nKeyError: foo\n'
      )
    );
    child.stderr.push(null);
    child.stdout.push(null);
    await flushAsync();
    child.emit('close', 1);
    const r = await p;

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.reason, 'error');
    const all = stderrLogs.join('\n');
    assert.ok(all.includes('Traceback'), 'stderr 应透传 Traceback');
    assert.ok(all.includes('KeyError: foo'), 'stderr 应透传 KeyError');
    assert.ok(all.includes('exit 1'), '应提示 exit 1');
    assert.ok(all.includes('python'), '应提示可手动重跑的 python 命令');
  });

  it('prints process error on spawn ENOENT', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child);

    const p = runBuildIndex(SCRIPTS_DIR, DOCS_DIR, spawnFn);
    child.emit('error', new Error('spawn python ENOENT'));
    await flushAsync();
    child.emit('close', -1);
    const r = await p;

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'spawn-failed');
    const all = stderrLogs.join('\n');
    assert.ok(all.includes('ENOENT'), 'stderr 应透传 ENOENT');
  });

  it('returns ok=true on exit 0 with no stderr', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child);

    const p = runBuildIndex(SCRIPTS_DIR, DOCS_DIR, spawnFn);
    child.stdout.push(Buffer.from('indexed 12 paths\n'));
    child.stdout.push(null);
    child.stderr.push(null);
    await flushAsync();
    child.emit('close', 0);
    const r = await p;

    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.reason, 'success');
    assert.ok(
      stdoutLogs.some((l) => l.includes('indexed 12 paths')),
      'stdout 应透传索引输出'
    );
    assert.strictEqual(stderrLogs.join('\n'), '');
  });

  it('passes script path and --incremental flag to spawn', async () => {
    const child = new FakeChild();
    const spawnFn = fakeSpawn(child);

    const p = runBuildIndex(SCRIPTS_DIR, DOCS_DIR, spawnFn);
    child.emit('close', 0);
    await p;

    assert.strictEqual(spawnFn.calls.length, 1);
    const args = spawnFn.calls[0].args;
    assert.match(args[0], /build-index\.py$/);
    assert.strictEqual(args[1], '--incremental');
  });
});
